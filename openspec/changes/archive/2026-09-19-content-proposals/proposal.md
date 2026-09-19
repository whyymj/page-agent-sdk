# content-proposals:内容提案-评审-应用通道(数据槽之外的受控内容修改)

> **状态**:✅ 已实施(2026-09-19,随 4.22.0 发布;12/12 任务勾,commit 3f9dae1/master bb21feb;残项 = 真 LLM 基线采集已转 deferred;2026-09-19 归档)。前置 action-host-semantics 已同日归档于本目录。
> 来源 = 学习门户「笔记编辑 + AI 提案修改」真集成审阅:门户为「AI 帮我改这段笔记」手搓了 ~200 行(propose 工具 schema/非阻塞语义/互斥拒绝/diff 面板/绑定校验/相同内容语义),没有一件能从 SDK 拿到;且 `propose_note_edit` 要求模型**重发完整源文**(23KB 笔记 ≈ 每提案上万 token,且有 max_tokens 截断风险 —— 截断提案过不了校验,整轮白跑)。SDK 在 dataOps 侧早已把同款问题解干净(hash 乐观锁 + patch/append 分块),但只对 JSON 数据槽生效。定级 minor(纯加法面)。

## 现状勘察证据

- **SDK 全部写通道绑定 dataOps**(CLAUDE.md 数据槽操作:bind + schema 白名单 + 快照栈 + 乐观锁):内容不在数据槽时(笔记文件/CMS 文章/配置文件/代码片段,真相源在宿主或服务端),AI 只能「讲」不能「动」—— 宿主要有 AI 辅助修改就得手搓整条提案链。
- **html-subagent 的 code-as-data-asset 是同族需求被硬塞进数据槽的形态**(`data.code` 资产 + vfs 工作副本 + checkout/commit):证明内容修改需求真实存在,只是现有实现要求内容必须表现为 schema 声明的 JSON 字段。
- **SDK 已有的「人审」面全部 JSON 取向**:`approval`(`approval.ts`,ApprovalBar + `previewWrite` = write 工专享的 dryRun old→new 摘要);`bulkGuard`(组件节点数量纲)。整篇 Markdown 的逐行评审两者都给不了。
- **门户实测的非阻塞提案是对的**(add-ai-assisted-note-editing proposal 明确否决了阻塞式 approval):评审面板在宿主页里(不在聊天里)、用户可能永远不点 —— SDK 工具看门狗(`toolTimeoutMs` 120s,集成方工具含 actions)与「用户不点就挂死」两坑都被非阻塞语义绕开。
- **乐观锁哲学已有完整先例可平移**:`read` 附 hash → 写携带 → 不匹配显式拒(conflictWatchFields 体系);大 code 分块写入 = set 首块 + append 逐块(4.1+)。

## 修法(三段式)

### S1 通道本体:`proposals` 顶层选项(配置即开关,无 capabilities 旗标 —— 同 actions/subagents 哲学)

```ts
createChatSdk({
  proposals: {
    /** 读通道:返回当前内容(SDK 计算 hash;null = 当前无可编辑对象,工具内如实报) */
    read: () => Promise<{ content: string; label?: string } | null>,
    /** 评审回调:SDK 已校验基底 hash、已应用 ops、已算 diff 统计;宿主渲染面板。
     *  返回字符串回灌模型(非阻塞契约:面板打开即返回,勿等待用户裁决 —— 看门狗与挂死双坑的既定答案) */
    onProposal: (p: ReviewableProposal) => string | Promise<string>,
    toolName?: string,        // 默认 'propose_content'
    readToolName?: string,    // 默认 'read_content'(宿主已有读工具时可只配 propose 侧)
    contentKind?: string,     // 如 'wiki 笔记源 Markdown(含 frontmatter)',进工具 description
    maxPending?: number,      // 默认 1:新提案替换旧提案(旧案留痕),防面板堆积
  },
})

// 公共面
sdk.resolveProposal(id, 'applied' | 'discarded', detail?)  // 宿主面板裁决后回传
sdk.proposals                                                // 待审提案只读视图
```

装配时自动注册两工具(不配 `proposals` = 零注册零开销,模型不知道能力存在 —— 门户「生产不注册」门控同款):

- `read_content` → 调宿主 `read()` → `{ content, hash, label }` 回灌(hash 供提案基底锚定)。
- `propose_content({ summary, baseHash, ops? | content? })`:
  - **二选一**:`ops`(增量提案,S1 核心)或 `content`(全量提案,小内容直发);
  - SDK 重读基底算 hash,**与 `baseHash` 不匹配 → recoverable 错误「基底已变,请重读」**(乐观锁哲学平移:防「读旧版改新版」静默漂移);
  - `ops` 由 SDK 纯函数应用:`replace({find, with})`(字面锚,**必须唯一命中**;0 或 ≥2 命中报错指明第几个 op)/ `insertAfter|insertBefore({anchor, text})` / `append({text})`;任一 op 失败整案拒(原子,镜像 write patches);
  - 应用产物 + `lineDiff` 统计进 pending 态 → 调 `onProposal`;**相同基底 + 相同产物 → 显式拒且不动在审面板**(修门户观察 1:门户实现相同内容会先丢掉在审面板,文案却只说「未打开」)。

### S2 裁决闭环与可观测

- `proposal_pending` / `proposal_resolved` 事件(SdkEvent 加法面);`resolveProposal` 后**下一轮注入一次性结局段**(「上一提案已被用户应用/放弃(+detail)」—— 复用 hostNotice 的 pin 段 + afterAgent 清除模式):闭环「改好了吗」,模型不再凭重读猜。
- `inspect().proposals`(pending 列表 + 会话累计 applied/discarded)+ debugLogs `stage:'proposal'` 留痕(提案/替换/拒绝/裁决)。
- propose 工具自动打 `deferredWrite` 语义(action-host-semantics D):零工具门禁事实清单注记「待用户确认」口径直接继承,不重复实现。
- usageHints:proposals 配置时注入一行纪律(先 read_content 取 hash → 增量用 ops 勿全量重发 → 提案仅送达,点应用才生效)。

### S3 导出与 demo

- 导出纯函数 `lineDiff`(前后缀修剪 + 中段 LCS + 大输入回退 —— 门户 `note-diff.js` 同款算法,**主包与 headless 双侧**:非 UI 纯函数)+ `applyProposalOps`(测试缝)。
- `examples/proposals-demo`:页面 = 一篇 Markdown(textarea 持真相)+ SDK + 宿主 diff 评审面板(复用 lineDiff);演示「AI 修正勘误 → 提案 → 人审 → 应用 → 回写 textarea」全链。
- 不做 SDK 内置评审面板 UI(面板归宿主页 —— 门户实证体验更好的是页面里面板非聊天里面板;chat 侧 ApprovalBar 集成路线入 deferred)。

## 设计决策点

- **D1 增量 ops 而非 diff/patch 文本格式**:unified diff 由模型生成易错(行号漂移/hunk 语法);字面锚 `find` 唯一命中纪律与 dataOps 的「read 后写」哲学同构(锚 = 真实基底上的真实文本),错误可指名道姓回灌自纠。token 成本与改动量成正比而非文档大小 —— 这是 B 缺口的核心收益。
- **D2 hash 锚定基底而非内容比对**:模型读到的基底可能在提案前被宿主/用户改掉;hash 不匹配显式拒 + 引导重读,与 conflictWatchFields「陈旧基线显式拦下」同族,绝不静默覆盖。
- **D3 SDK 应用 ops、宿主落地写**:SDK 把 ops 变成「完整新内容 + diff 统计」交给面板,**写回动作永远在宿主**(宿主有自己的校验/审计/权限链 —— 门户的 PUT 通道全套校验原样生效)。SDK 零持久化零写。
- **D4 非阻塞而非 approval 阻塞**:门户实测结论 + 看门狗边界;approval 的 host-rendered 预览扩展(阻塞式评审白得 ApprovalBar 全套)作为互补路线入 deferred,触发条件 = 有集成方要 chat 内评审。
- **D5 不建 `capabilities.proposals` 旗标**:配置即开关(同 actions/subagents/skills),不加第三个开关面 —— 「不出让用户疑惑的配置项」既定哲学。
- **D6 与 html-subagent 的关系 = 正交不合并**:code-as-data-asset 内容在数据槽内(走既有全套契约),本通道内容在数据槽外(宿主真相源);合并会同时破坏两边的校验链。未来若要互通,是独立 change。

## 范围红线

- 不做 SDK 内置评审面板/ApprovalBar 集成(deferred);不做多文件批量提案;不做提案排队/历史回放(裁决即出队);不做 ops 之上的「二次编辑提案」(要改去宿主编辑器 —— 门户同款边界)。
- 不动 dataOps 写通道与 html-subagent;不做服务端任何事(写回 API 归宿主)。
- `read_content` v1 不分页(宿主内容典型 <100KB;超长内容分页读 + 分块 append 的完整大文本协议,首个真实需求出现再立项,deferred 登记)。

## 验收门禁

- selftest:`lineDiff` 矩阵(同文/增/删/换/修剪/大输入回退)/ `applyProposalOps`(唯一锚/0 命中/多命中指名/原子全拒)/ hash 不匹配拒 / maxPending 替换留痕 / 相同产物拒且不动在审 / 未配置零注册。
- e2e:装配反射(inspect().proposals + 工具面)/ Stub ReAct 一轮(read→propose ops→onProposal 收到完整产物与统计)/ resolveProposal → 事件 + 下轮结局注入 / 裁决后 pending 出队。
- browser:proposals-demo 面板真渲染 diff 行 + 应用回写 textarea + 放弃不动。
- 真 LLM(docs-qa 族加场景):增量提案 token 对比全量提案(基线 --baseline-diff 守不劣化)。
- 门禁全绿 + 计数同步 + 双 d.ts(新选项/事件/导出);发布前询问用户。
