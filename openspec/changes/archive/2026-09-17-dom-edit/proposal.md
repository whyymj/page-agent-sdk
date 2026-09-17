# dom-edit:DOM 编辑工具族(宿主页面受控写通道)

> **状态**:✅ 已实施(2026-09-17,随 4.17.0 发布;commit 见 tasks.md 注记)。
> 用户提问「是否有对 dom 进行属性/内容操作的能力?例如修改 dom 样式、内容,以及 dom 增删改查、dom 层级嵌套修改等;没有就补充工具,并将工具集成到对应 skill」直接驱动。

## 现状勘察证据

- DOM 面**全只读**(domTool.ts):`get_dom`(结构)/`read_page`(正文)/`dom_search`/`dom_info`(经 dom-inspect skill 按需注入)/`take_screenshot`(截图,4.16);写入能力零。
- `eval_script` 是 Worker 沙箱(src/core/tools/sandbox.ts)摸不到 DOM;`actions` 是集成方写死代码非 agent 通用操作面。
- SDK 立身契约「改数据必经写工具(schema+快照+乐观锁)」(CLAUDE.md 数据槽操作)—— **对数据驱动页面,DOM 是渲染产物,直改是错层**(重渲染洗掉 + 绕过全部安全网)。
- 4.15/4.16 开出「宿主页面伴随」场景族(page-quote/read_page/pageContext/take_screenshot):文档站等**无 data.bind** 的页面,页面本身就是操作对象 —— 写通道的合法落点。

## 修法(三段式)

### S1 工具本体(`src/core/tools/domEdit.ts`)

- `dom_edit({ patches, dryRun? })`:**统一批工具**(镜像 write patches 设计语言,非细粒分工具 —— 批量原子/dryRun/快照全套语义一次到位)。op 判别联合:`set_text`/`set_html`/`set_attr`/`remove_attr`/`add_class`/`remove_class`/`set_style`/`insert`(anchor+position before|after|prepend|append|replace)/`remove`/`move`(selector+to+position,环守卫「不能移进自己子孙」)/`highlight`(color/scroll/note)。
- `dom_restore`:批快照逆序回放(栈 20;`data-pg-snap` 标记 + outerHTML;STALE 如实报)。
- **纯函数域**:`validateDomPatches`(危险闸静态校验,可单测)/ `domPatchSchema`(zod discriminatedUnion)。

### S2 装配与纪律(`capabilities.domEdit` opt-in,requires domInspect)

- 注册表 19→20(opt-in 第 7 个);`createChatSdk` 进 `domToolsForPool`;onEdit 留痕 debugLogs `stage:'dom_edit'`。
- **写纪律工具内建**:①唯一匹配(querySelectorAll 恰 1,多匹配拒);②危险闸(insert 拒 script/iframe/object/embed/link/meta/base、写 attr 拒 on*、URL 拒 javascript:/vbscript:);③ SDK 自身 DOM 拒改(SDK_UI_SELECTOR);④快照单根 256KB 上限。
- **原子批**:解析阶段(①-③全 selector 预检)任一失败整批拒零部分应用;应用阶段残留失败风险(快照超限)有回滚出口文案。

### S3 skill 集成 + demo(用户点名「集成到对应 skill」)

- dom-inspect skill:patches 用法段 + 写纪律(变体 `withDomEdit`)。
- page-analysis skill:问题分型增「操作类」路线(变体 `withDomEdit`)。
- usageHints:domEdit 开 → 批量编辑一行(装了就教;反面是未装不教)。
- docs-demo:`domEdit:true` + `🖍 高亮表格` quickAction;browser e2e 高亮/回滚全链。

## 设计决策点

- **D1 统一批 vs 细粒分工具 → 统一批**:`write({patches})` 已验证的设计语言(原子/回滚/dryRun 一次到位);11 个 op 判别联合比 11 个工具省常驻 schema。
- **D2 能力开关 → opt-in + requires domInspect**:宿主页面 mutation 必须显式开启;写页面必须先能定位页面(draftWrite requires dataOps+vfs 同款)。
- **D3 安全模型 → 页面稳定性闸,非安全沙箱**:LLM 信任模型与数据面等同(codeAsset 代码字段本就允许 script);闸只防**无意**脚本执行/改坏 SDK 自身;明示文档「非安全沙箱」。
- **D4 快照 → outerHTML 回放**:页面非结构化数据无 schema 可依,快照栈是安全网(restore_data 同族);元素身份不保留(outerHTML 回放)如实文档化。
- **D5 不持久化**:页面最终形态归集成方(会话临时态,刷新即失)—— 持久化 = 侵入宿主,红线。

## 范围红线(不做)

- **划词原文范围高亮**(text range/Ranges API,引用块 → 原文高亮跳转)→ deferred。
- **改动持久化/会话恢复**(刷新保留 agent 的 DOM 改动)→ deferred。
- **框架管理区域冲突检测**(探测 Vue/React 管辖区并拒改)→ deferred(探测不可靠,文档明示边界)。
- **MutationObserver 外发 dom_change 事件**(集成方观察面)→ 观察需求出现再做(debugLogs 留痕先行)。

## 验收门禁

selftest 3573(sec-128 ×31)/ e2e 1162(dom-edit.mjs ×11)/ browser 164(docs-demo +2)/ exports/types/size/counts 全绿;`npm pack` 无泄漏。
