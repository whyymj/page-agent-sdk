# Tasks(tool-call-economy 缩水版;SDK 侧)

> 2026-08-23 评审回改:C2 可先行(不等挖掘);C1 视挖掘;C3 已转留档。

## Phase 0:离线挖掘(零产品代码)

- [x] 挖掘脚本(本地 `tests/runtime/_real-llm-mine.mjs`,gitignored):解析诊断导出 debugLogs 工具序列,2-gram 统计;产出 `mining-report.md` 存本 change 目录(2026-08-23,36 调用/3 invoke,editor 真实会话)
- [x] 裁决:**C2 做**(第一性支持);**C1/并行轴/C3 全部转留档**(读→读 11.1% 且同 path 重复读 0、root 读 40% 是首查需要非浪费、query·search→read 配对 0/0)—— 见 mining-report.md「Phase 0 裁决」表

## Phase 1:C2 错误即向导 + 同参重复检测(可先行)

- [x] 错误即向导(零格式变化,`ERROR: {json}` 单行契约不动,建议全走既有 hint 字段):read 缺失路径 → `PATH_NOT_FOUND` + 父级实况(数组→有效索引范围/对象→实际键集/非容器→引导 read 顶层;从 bind 实时取不硬编码)+ 早于 setBaseline(失败读不吸收宿主改动);read PATH_DENIED → 追加父级实际键集(键打错场景);SCHEMA_INVALID/PATCH 族既有 hint 已含违例 details,不加
- [x] 同参重复检测(createAgent 结果回灌点,每 invoke streak + 成功清零):同工具同参连续失败 ≥2 → 结果尾附「同参数已连续失败 N 次…」(追加在尾部,ERROR: 前缀首位不动;deferred 循环/终止面 #1 并入收口)
- [x] 红线测试(sec-103):建议/提醒文案不含「未写入/无需删除」活性词;ERROR: 前缀保持;focus ask-user 分支未动(sec-54 负向断言天然不涉)
- [x] selftest(sec-103,20 项,总 2873)+ e2e 940 全绿(C2 为工具结果内容增强,零轮次结构变化,e2e 既有断言天然免疫)

## Phase 2:C1 read 结构预告 —— ❌ 数据不支持,转留档(2026-08-23 挖掘裁决)

读→读邻接仅 11.1%、同 path 重复读 0、root 读 40% 为新会话首查需要 —— 探路浪费信号不成立,骨架行 token 反向风险不划算。红线设计(hash= 禁用/投影后取值/offload 场景)已沉淀在本提案与 deferred 条目,重启时直接取。

## Phase 3:并行轴 —— ❌ 不显著,留档(独立读邻接 4 次/36 调用)

## Phase 4:门禁与文档

- [x] 文档:CHANGELOG [Unreleased](C2 两件)+ CLAUDE.md 计数(2873/940);usage-guide 中英文一行(read 缺失路径建议 + 同参失败提醒)
- [ ] `--baseline-diff` 门禁(C2 理论上零轮次影响,跑一次 uispec 确认 toolCount/token 不回归后归档;真 LLM 环境可用时)
