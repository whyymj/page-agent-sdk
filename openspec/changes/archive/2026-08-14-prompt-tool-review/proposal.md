# Proposal: prompt-tool-review(默认提示词审查修复 + move op)

来源:全量审查默认 systemPrompt(DEFAULT/usageHints/html/orchestrator)+ 工具描述与装配面。

## 修复(提示词与工具面一致性)

- **Bug:draftWrite 提示在 simple 模式教 LLM 调不存在的工具**(SIMPLE_HIDDEN 滤除 draft_write/draft_commit,但 usageHints 照常注入用法)→ `rc.draftWrite && !simple` 守卫
- spawn 提示过时(「只读工具」)→ 补 writablePaths 授写说明 + spawn_agents 并行(注明并行不可授写)
- reliableWriteRules 补第 6 条:乐观锁冲突(VERSION_CONFLICT/挂起)的行为预期
- htmlSystemPrompt「write + set」措辞 → 「write(set/patch 增量或整体)」

## 新增:patch op `move`

`{op:'move', jsonPath: 源数组元素路径, value: 目标路径字符串}`:同数组 = 重排一步(替代双 set 交换,索引易错),跨数组 = 移动(替代 append+remove 两步非原子)。目标两种形态:数组本身(追加;不存在且父级为对象时自动建数组,与 setByPath 语义一致)/数组内下标(插入,越界 clamp)。目标下标按移除源后解释。仅支持数组元素。目标路径同样过 isPathAllowed 白名单。进 patches 原子批。新导出 `moveByPath` 纯函数。

## 测试

selftest +10(moveByPath 重排/跨数组/自动建/clamp/错误面×3 + write 集成 + 白名单拒)→ 1957;e2e +3(move 场景:重排 + 跨数组移容器)→ 583。
