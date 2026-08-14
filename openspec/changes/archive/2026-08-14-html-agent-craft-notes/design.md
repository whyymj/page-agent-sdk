# Design: html-agent-craft-notes

## 1. 数据模型

```
components[i] = {
  ..., code: '<html>...',        // 资产(现有)
  __pgId: 'c_abc123',            // 组件稳定映射键(现有)
  __pgNotes: [                   // 新增:工匠笔记(FIFO ≤5,每条 ≤200 字)
    '[note] 液面 height keyframes 4.2s 循环(0→42% 倒满/70→86% 归零);装饰仅灯串+光斑 2 类',
    '[note] 用户反馈:动效偏慢,已从 5s 调到 4.2s',
  ],
}
```

- `__pgNotes: string[]`;每条含原始 `[note] ` 前缀(注入时直接用,可辨识来源)
- **不进 schema**:框架直改 bind;LLM write 时 `__pg*` 段被 isPathAllowed 拒(现有守卫),safeParse strip 不影响(框架字段)

## 2. 沉淀链(afterAgent)

```
子 agent 收口(最终 assistant 回复含 [note] 行)
  └─ codeAssetMiddleware.afterAgent(现有 commit 后追加)
       ├─ 提取:state.messages 末尾 assistant 文本中所有 /^-?\s*\[note\]\s*/im 行
       ├─ 归属:touched vfs 文件 → __pgId → data 组件(与 commit 同映射)
       │   ├─ touched 多组件且均有 [note]:全部 append(无法区分归属时逐组件同 append?
       │   │   —— 单组件 task 是主流;多组件时只 append 到「地图中提及 name/索引的组件」,
       │   │      提取行内含组件名(name: 前缀)则精确归属,否则只给首个 touched)
       ├─ FIFO:push 后 length > 5 → shift;每条 slice(0, 200)
       └─ markDataDirty(随现有调用,checkpoint 增量保存笔记)
```

- **边界**:verify 门禁失败/abort 的轮次 afterAgent 仍会跑(commit 有校验兜底);笔记提取同跑无害(半成品轮的 [note] 一般无)—— 与 commit 校验不同,笔记不做门禁(笔记本身是记录,非产物)
- **去重**:同轮同组件重复 [note] 行去重(Set)

## 3. 注入链(augmentPrompt)

现有「组件代码文件地图」每组件行后追加:

```
- beer [3] → html/c_abc.html
  📝 笔记×2(最近):液面 height keyframes 4.2s 循环(0→42% 倒满…)
```

- 只注最近 1 条 + 总数(`笔记×N`);全文不注(防地图膨胀)
- 地图头补一句引导:「📝 笔记 = 前任维护者交接(设计决策/用户反馈/踩坑),改该组件时遵循」

## 4. 子 agent 侧约定(htmlSystemPrompt)

「交付」段加:收尾回复末尾附 1 行 `[note] 实现要点`(给下次维护者的交接:关键设计决策 / 用户偏好 / 踩坑;一行内,不展开)。

## 5. write 整对象替换时笔记保留(核对项)

场景:主 agent `write patch set components.0 = {...}`(如调换顺序)整对象替换 → safeParse strip `__pg*` → supplementPgId 补 `__pgId`。**实现时核对 supplementPgId 现行为**:
- 若按位置/内容恢复旧 `__pgId` → 同路径恢复 `__pgNotes`(从替换前旧值,需在 afterWrite 前取;若实现取不到,接受丢失并在 tasks 标注)
- 若重新生成 `__pgId` → 现状 checkout 映射已断(已有问题),本 change 不扩大,`__pgNotes` 同命运

## 6. 主 agent 偏好转述(presets)

htmlOrchestratorPrompt【委派 task 规格化】末尾补:

> ⑤ 历史偏好(可选):聊天上下文中有与该组件相关的用户历史偏好/反馈(如「用户偏好深色系」「上轮嫌动画太快」),提炼一句附 task 末尾(新子 agent 无记忆,全靠 task)。

## 7. 配置面

```ts
createHtmlSubagent({ writablePaths: ['components'], craftNotes?: boolean })  // 默认 true
```

- `_codeAsset.craftNotes` 透传 codeAssetMiddleware;false → afterAgent 不提取 + 地图不注笔记(完全零开销)

## 8. 测试设计

- **selftest(sec-72 扩展)**:① afterAgent 后 `__pgNotes` 沉淀([note] 提取)② FIFO >5 shift + 200 截断 ③ 无 [note] 不沉淀 ④ augmentPrompt 地图含「📝」行 ⑤ read 投影不见 `__pgNotes`(`__pg*` 现成,断言延续)⑥ craftNotes:false 零沉淀零注入
- **e2e(capability-packs 扩展)**:stub 子 agent 返回含 [note] → data JSON 含 `__pgNotes`;二次 stub 委派 → 子 agent 消息流含笔记(经 augmentPrompt)
- **browser(html-page-demo)**:mock 脚本子收口含 [note] → 主 data tab(JSON.stringify(bind))可见 `__pgNotes`
- **真 LLM 复验**:同组件二次精修(改 beer 液体色),观察子 agent 思考是否引用笔记(「按笔记保持 4.2s 循环」)而非重新推演
