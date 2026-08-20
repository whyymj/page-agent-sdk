# Tasks(atomic-tree-add,按依赖序;目标仓库 editor_fangzhou;已过怀疑论评审回改)

## Phase 1:预校验(execute 前零副作用拦截)

- [ ] 从 addComponentTree 抽出 `validateTreeSpec(targetId, components)`:
  - [ ] tolerant name 匹配先解析真实 name(现有逻辑前置,未命中错误附 available 清单 —— 现有行为保留)
  - [ ] name ∈ comListsData 清单 / platform 兼容
  - [ ] **spec 字段类型校验**(label/style/props/children 类型,pageData.js:297-303 现有逻辑纳入聚合错误,评审补)
  - [ ] 叶子组件不带 children;每层 children 数 ≤ childLimit(递归累加);**viableCount 语义随迁**:只统计 name 可解析到组件库条目的规格(pageData.js:277-281,防注定失败规格误报超限)
  - [ ] 目标容器:存在 / 非叶子 / 现有 child 数 + 新增数 ≤ childLimit
- [ ] 错误聚合:列出**全部**问题(不只第一个),结构化 error 返回,零添加
- [ ] 元数据缺失(menu.leaf/childLimit)→ 乐观放行(现状语义保留);错误文案与 prompt 措辞写明「预校验通过 ≠ 必成功」

## Phase 2:执行 + 反向补偿

- [ ] execute 段记录 addedIds(按添加序,**顶层节点即可** —— 删顶层即整树移除,不逆序全删,减少历史条数)
- [ ] **补偿触发条件:Phase A 通过后,Phase B 任何 result.error 均视为失败 → 整批回滚**(评审补,定义明确防实施歧义)
- [ ] 回滚:对顶层 addedIds 调编辑器原生删除 → error 含「已回滚 N 个」+ 失败节点定位
- [ ] 补偿自身失败 → 升级文案「部分已添加且回滚失败」列 addedIds,不静默
- [ ] 补偿语义说明(注释):undo 栈 2N 条历史 / useComponent 统计不回滚(预期管理)/ 补偿不触发二次交互(已核实)
- [ ] 全成功 → 摘要(各节点 id/path)

## Phase 3:提示词 + 手动回归

- [ ] `prompt.js` add_component_tree 描述补「整批预校验,失败零残留;运行时失败自动回滚」+ 元数据残余窗口措辞
- [ ] 手动用例(C-10):
  - [ ] 预校验失败(叶子带 children / name 编造 / 超限)→ 页面零变化 + 错误列全部问题
  - [ ] **运行时失败(桩注入,评审 1-4)**:monkey-patch getBaseNode 第 N 次调用抛错 → 自动回滚,页面回到执行前(自然构造不出 —— Phase A/B 判定输入相同)
  - [ ] 正常整棵树 → 全部落地
- [ ] commit + push feature 分支(node10 PATH;lint-staged 钩子)
