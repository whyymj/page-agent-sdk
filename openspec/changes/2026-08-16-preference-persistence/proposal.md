# preference-persistence:跨会话用户偏好记忆

## 为什么

agent 每个会话都从零认识用户:周一说过「别用紫色」,周三新开会话又收到紫色方案,用户被迫反复重申设计口味。现有四个"记忆"维度没有覆盖这一层:

| | 谁写的 | 粒度 | 生命周期 |
|---|---|---|---|
| `memory` | 集成方写死 | 全局指令 | 集成方管理 |
| `craftNotes`(__pgNotes) | 子 agent 收口提炼 | 单组件 | 随 data 持久化 |
| mission | 首条 user 消息 capture | 单会话目标 | 会话内 pin |
| **用户偏好(本 change)** | **agent 观察用户** | **用户级** | **跨会话** |

HTML 专题页场景最直接:配色口味/文案风格/密度偏好这类信号在对话里自然出现,但轮次结束即丢。

## 方案

### 1. 存储层(`src/core/backends/preferenceStore.ts`,照抄 skillStore 模式)

- 复用 `StorageBackend` 四后端(indexed 默认/local/session/memory 降级),key 前缀 `v:1::pref-store::`,**与 storage 选项独立**(storage:false 也持久化)
- 配置组 `preferenceStorage?: { id?, backend?, dbName? }` —— 与 `skillStorage` 完全对称;id 不传默认按 agentId 隔离,传固定串跨 agent 共享
- 条目:

```ts
interface PersistedPreference {
  id: string                 // 稳定 id(同 topic 合并时保留)
  content: string            // 一句话中性陈述(用户视角,如「不用紫色,偏好低饱和」)
  topic: string              // 枚举:color|copy|layout|interaction|tech|other
  sourceSessionId: string
  sourceRound: number
  createdAt: number
  updatedAt: number
}
```

- **同类合并 = 后说覆盖前说**:写入时同 topic 已有条目 → 覆盖 content/updatedAt(用户改主意不并存,防 prompt 自相矛盾);topic 用枚举防自由词爆炸导致永不合并
- FIFO 上限默认 20 条(超限按 updatedAt 删最旧);偏好段 token 始终有界(~200 token)

### 2. 捕获(`src/core/harness/preferences.ts`,三层信号宁漏勿误)

| 档 | 信号 | 例 | 处理 |
|---|---|---|---|
| 强 | 显式命令正则 | 「记住:以后文案都要短」 | 直接提取冒号后句子存,**零 LLM** |
| 中 | 模式词初筛命中 | 「别用紫色」「太花了」 | 异步调 `summaryLlmInvoke` 提炼一次(JSON:captured/content/topic);prompt 核心判定 = **持久口味 vs 本轮任务指令**(「把这个改成红色」不是偏好) |
| 弱 | agent 行为推断 | 连续 3 次改掉渐变 | **不捕获**(推断链长,学错成本 > 收益) |

- 触发点 **afterAgent**(收口后 fire-and-forget,不阻塞返回;失败静默 debugLog 留痕)
- 每条 user 消息只处理一次(记录已扫到的 message index)
- 降级:summaryLlmInvoke 不可用 → 只强信号生效
- `maxEntries:0` / `capabilities.preferences:false` → 捕获与注入全关

### 3. 注入(同中间件 augmentPrompt pin 段)

```
## 用户偏好(跨会话沉淀;除非用户本轮另有指示,遵守以下偏好)
- 颜色:不用紫色,偏好低饱和
- 文案:简洁短句
```

- **异步 store → 同步注入**:中间件持内存 cache,createChatSdk mount(本就 async)时 `await store.ready` 拉一次 list 填充;之后 put/remove 同步更新 cache —— augmentPrompt 读 cache 零 await
- pin 段天然跨压缩(同 mission:每轮重建进 system prompt,不在 messages 里)

### 4. 开关与 API

- `capabilities: { preferences: true }` **opt-in**(自动写用户浏览器的自学习能力默认关)
- `sdk.getPreferences(): PersistedPreference[]`(同步,读内存 cache)
- `sdk.removePreference(id): Promise<boolean>` / `sdk.clearPreferences(): Promise<void>`(学错了可删)
- DebugDrawer「Agent 信息」tab 加只读「用户偏好」小节(条目 + topic 标签;新增 ~4 文案键)

## 影响面

| 文件 | 改动 |
|---|---|
| `src/core/backends/preferenceStore.ts` | 新建(skillStore 模式复制) |
| `src/core/harness/preferences.ts` | 新建(中间件 + 强/中信号捕获 + 提炼 prompt + 注入段) |
| `src/core/capabilities.ts` | +`{ name: 'preferences', defaultOn: false }` |
| `src/core/sdk/createChatSdk.ts` | 装配(store/中间件/mount 预载)+ 3 个 API + preferenceStorage 选项 |
| `src/core/index.ts` + `types/index.d.ts` | 导出双侧同步 |
| `src/core/components/messages.ts` + `DebugDrawer.vue` | 偏好小节文案 + 渲染 |
| `src/core/__tests__/modules/sec-84.ts` | 新建:强信号正则/中信号初筛纯函数/合并 FIFO/注入段拼接/降级 |
| `tests/e2e/preferences.mjs` | 新建:顶层 API/强信号捕获落库(stub)/capabilities 关 |
| README 双侧 + usage-guide 双侧 + CLAUDE.md + CHANGELOG | 文档四层 |

## 非目标

- 弱信号行为推断(明确不做;学错一条假偏好,之后每个会话都带着跑)
- 偏好编辑 UI 面板(只做 DebugDrawer 只读视图 + API;按需后补)
- 冲突双方保留(后说直接覆盖前说,简单;原始对话本就在会话历史里可查)
- 跨 agent 自动共享(默认按 agentId 隔离;手动指定 storeId 共享,同 skillStorage 语义)
