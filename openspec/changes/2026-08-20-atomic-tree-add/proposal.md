# Proposal: atomic-tree-add(editor add_component_tree 原子化:dry-run 预校验 + 失败补偿)

> 状态:**规划完成,未实施,已过怀疑论评审回改**(现状描述纠正、「90% 前置拦截」降格、运行时失败用例改桩注入、补偿触发条件/viableCount/字段校验补全)。优先级 P1。**目标仓库:editor_fangzhou**(规划存 SDK 仓库 openspec 统一管理)。对应反思 G4 / 用例集 C-10。

## Why(反思结论 G4,2026-08-20)

`addComponentTree` 现状(评审核实,**非「逐节点走原生添加流程」**):`getBaseNode` 生成节点后**直接 push 到 parent.child**(pageData.js:310-324;对比 addComponent 走 `editor.ema.fire('commponent.addOne')` 事件流,pageData.js:212);平台/容器检查是工具层复刻(pageData.js:307-309、judgeContainer 349-359),不是原生流程内置。

**半棵树核实(属实)**:嵌套层判定失败 → 节点已 push、children 被跳过并保留节点(pageData.js:229 注释、333-335,result.error 后直接 return);兄弟节点失败不中断(addTreeNode 每节点独立返回 error,specs.map 继续跑完,pageData.js:287)。用例 C-10 期望「整批失败或明确报告哪些没加」—— 现状只有后者,页面处于半棵树状态,兜底仅 Ctrl+Z(多节点要多步撤销,运营易懵)。

失败来源分析(评审 1-3 降格:**不是 90% 可前置拦截**):

| 失败类型 | 可否预知 |
|---|---|
| name 不在组件库清单 | ✅ 可预校验 |
| platform 不兼容 | ✅ 可预校验 |
| spec 字段类型(label/style/props/children 类型,pageData.js:297-303) | ✅ 可预校验(评审补) |
| 叶子组件带 children / 容器 childLimit 超限 | ⚠️ **半可预校验**:Phase A 只能靠 `menu.leaf`/`menu.childLimit` 元数据,而元数据随服务端可能缺(pageData.js:345-346)—— 缺失时现状乐观放行,且 Phase B 的 judgeContainer 用同一份信号(新节点 node.leaf 恒 undefined,**Phase A 拦不住的 Phase B 同样拦不住**) |
| 目标容器不存在/非容器 | ✅ 可预校验 |
| modifyNodeId/$set 抛异常等运行时异常 | ❌ 不可预知(兜底补偿;评审核实:Phase A 通过后真正能触发补偿的只剩这类罕见路径) |

## What Changes(editor_fangzhou `pageData.js`)

### 两段式执行

```
addComponentTree(targetId, components):
  Phase A validate(纯检查,零副作用):
    - 递归遍历入参树:tolerant name 匹配先解析成真实 name(现有逻辑前置)/ name ∈ comListsData 清单 /
      platform 兼容 / spec 字段类型(label/style/props/children)递归校验 /
      叶子(清单标记 leaf)不带 children / 每层 children 数 ≤ childLimit
    - childLimit 预检沿用 viableCount 语义:只统计「name 可解析到组件库条目」的规格
      (pageData.js:277-281 现有逻辑随迁 —— 避免把注定失败的规格算进限额误报超限)
    - 目标容器:存在 / 非叶子 / 现有 child 数 + 新增数 ≤ childLimit
    - 任一不过 → 返回结构化 error(列全部问题,不只第一个),零添加
  Phase B execute(逐节点添加):
    - 记录 addedIds 按序(顶层节点 id 即可 —— 删顶层即整树移除,不逆序全删,减少历史条数)
    - **补偿触发条件(评审补,明确定义):Phase A 通过后,Phase B 任何 result.error 均视为失败 → 整批回滚**
    - 回滚:对本批顶层 addedIds 调编辑器原生删除
    - 返回 error(含失败节点 + 「已回滚 N 个已添加节点」)
    - 全部成功 → 返回成功摘要(各节点 id/path)
```

依赖可得性(评审 1-2):校验逻辑本来就全部在 pageData.js 内联,`window.comListsData`/`window.platform` 全局可读 —— 抽出成本低,耦合不低估也不高估。

### 补偿语义说明(写进错误文案 + 注释)

- 补偿走**编辑器原生删除**(保持暂存/历史/统计一致),undo 栈会多出「添加+补偿删除」记录(N 节点 = 2N 条历史);错误文案明示「已自动回滚,无需手动撤销」。
- **补偿不触发二次交互(评审核实)**:原生 move.node 删除链路无确认弹窗;approval 弹窗在 SDK 工具层只对 delete_component 工具名生效,补偿在 editor 内部直接执行不经过 SDK 工具 → 无弹窗。删除命中当前选中节点会 `select.noOne`(Scene.vue:470-472),补偿路径天然覆盖。
- **useComponent 统计残留(评审补)**:getBaseNode 每节点调 useComponent(node.id) 上报统计,回滚后统计不回滚 —— 可接受,写入补偿语义说明做预期管理。
- **元数据缺失残余窗口(评审 1-3)**:menu.leaf/childLimit 缺失时乐观放行 —— prompt 措辞与错误文案写明「预校验通过 ≠ 必成功」,不让 LLM 以为预检过了就稳。
- 补偿本身失败(极端:删除也异常)→ 错误升级为「部分节点已添加且回滚失败,请手动删除:list」,列 addedIds —— 绝不静默。

## Impact

| 项 | 变更 |
|---|---|
| editor `pageData.js` | addComponentTree 两段式重构;validate 纯函数抽出(可单测);viableCount 语义随迁 |
| editor `prompt.js` | add_component_tree 工具描述补「整批预校验,失败零残留;运行时失败自动回滚」+ 元数据缺失残余窗口措辞 |
| 测试 | editor 无测试基建 → 手动用例 C-10;**运行时失败用例改桩注入**(评审 1-4:monkey-patch getBaseNode 第 N 次调用抛错 —— Phase A/B 判定输入相同时,自然构造不出运行时失败) |
| 依赖 | 编辑器原生删除接口可传 id 直接删(deleteComponent 封装已在用) |

## 非目标(Non-goals)

- 不做 undo 栈合并(编辑器历史粒度不动)
- 不改 add_component 单节点语义
- 不补齐服务端元数据(leaf/childLimit 缺失的乐观放行残余窗口接受并明示)
- 不在 SDK 侧做任何改动(纯 editor 集成层)
