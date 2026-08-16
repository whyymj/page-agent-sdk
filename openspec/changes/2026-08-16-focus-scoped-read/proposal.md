# Proposal: focus-scoped-read(聚焦模式下 read 空参默认返回焦点子树)

## Why(真实用户反馈,2026-08-16)

用户操作:聚焦 `components.5` → 问「这里是啥」→ agent 调 `read({})` → **全量 dump 整页主数据**(title/theme/全部 9 个组件 + 嵌套 children),而非焦点子树。

用户疑问:「不应该是基于 focus 的路径 read 吗」。

现状是**显式设计缝隙**(`src/core/harness/focus.ts:27` 注释):三层收敛「提示 + 子树 schema 视野 + 写越界拒」中,**读工具刻意不限制**("用户仍需看全量上下文")。设计初衷成立(回答"和整页风格协调吗"类问题需要全量),但默认值错了:

1. **token 浪费**:聚焦精修的核心收益是收敛上下文;每次空参 read 全量 dump 把收益打穿(复杂页面单次 read 数千 token)
2. **直觉违背**:用户聚焦 = 「我在问这个东西」;agent 却把整页搬进上下文
3. **实测教训**:focus 提示段(「仅操作聚焦子树」针对写)没能引导模型自觉带 jsonPath —— 引导应放在**工具结果级**(3.4 立项教训:工具层反馈比 system prompt 引导强)

## What Changes

**核心语义:聚焦激活时,`read` 空参(`{}`/只带 fields 等裁剪参数)默认返回聚焦子树;显式路径读完全自由(「读不限制」设计保留)。**

1. **参数改写**(focus 中间件 `wrapToolCall`,dataOps 零改动):
   - 工具 = `read` 且 `!jsonPath && !jsonPaths` 且有活动焦点 → 注入 `jsonPaths: focuses.map(f => f.path)`
   - 复用现有多路径读:返回头 `多路径读取(共 N 项,hash=xxx)` 自带整体 hash(autoLock 语义不变;聚焦下整体写本就被 strict 拒,无锁路径依赖)
   - 多焦点(multi-focus)→ 全部焦点路径都在默认返回内
2. **结果前置教学行**(wrapToolCall 后处理 content):
   `【聚焦模式】read 未带路径 → 默认返回聚焦子树(components.5);需要全量主数据时显式列顶层键 read({jsonPaths:['title','components']})`
   —— 教 agent(与用户)如何显式取全量;工具结果级反馈闭环
3. **提示层同步**:focus 注入段补一句「read 不带路径默认只返回聚焦子树」(与工具行为一致,防提示与行为打架)
4. **子 agent 继承**:子栈焦点继承现状已生效 → 子 agent 的空参 read 同样收敛(顺带收益)

### 明确不做(Non-goals)

- `query_data` / `search_data` / `get_data` 不改(它们本身就是显式定位;query 命中已过大文本摘要)
- 显式 `jsonPath` 读不限制(聚焦外路径照读,「用户仍需看全量上下文」的设计自由保留)
- 不新增「读全量」专用参数 —— 显式列顶层键(`jsonPaths:['title','components']`)已可达

## Impact

- 代码面:`src/core/harness/focus.ts` 单文件(wrapToolCall 加 read 空参分支 + 提示段一句);dataOps 不动
- 行为变化:聚焦激活时的 `read({})` 返回内容收窄(聚焦本就是用户主动选择的精修态,语义更贴合功能承诺);非聚焦态零变化
- 测试:selftest(focus 中间件:空参 read 注入焦点路径 + 教学行 + 显式路径不受影响)+ browser(page-demo 拾取聚焦 → 问这里 → 断言 read 回灌为子树)
- 风险:依赖「多路径读」现有格式;hash 语义不变;预计低风险
