# Proposal: context-economy-phase2(上下文经济性二阶段 + agent 自感知预算)

来源:3.10.2 一阶段(S4 prompt tokens -19%)后,真 LLM 基线显示新瓶颈:**S1 单场景 28 工具轮 / 507K prompt tokens** —— 消息累积占大头,压缩触发太晚(flash contextWindow 1M × ratio 0.5 = 500K 才触发,上下文没爆但成本爆)。另:用户 mid-turn 提出三项「让 agent 感知自身消耗与循环」的想法(单轮 token 提示/上限、重复计数提醒)尚未实施,同属本主题。

## A. 压缩触发加成本维度(消息累积压缩提前)

现状 `shouldTriggerCompression`(contextIndex.ts:114):token 模式 = `window × summaryThresholdRatio`(默认 0.5)。超大窗口模型(≥512K)下 0.5×1M=500K 才首压,前 28 轮全部原文重发,prompt 成本线性膨胀。

方案:新增 `promptSoftCapTokens` —— **实际 token 用量超 softCap 即触发压缩,与 ratio 阈值取或**。默认值策略:窗口 ≥320K 的模型自动应用 softCap 160K(开箱即用,方向是省钱且压缩有 preserveLastToolResults/workingMemory 双保护,丢细节风险低);小窗口模型零变化(ratio 仍先生效)。`contextOptions.promptSoftCapTokens` 显式可覆盖(设 0 关)。

## B. 工具面瘦身二批

一阶段只压了 top 3(write/query_data/edit_data -40%)。二批压 advanced 可见面剩余长描述:`eval_script`(505)/`draft_commit`(379)/`set_data`(312)/`draft_write`(306)/`inspect_env`(260)/`get_data`(248)/`query_data` 剩余/`search_data`(211)/`history_data`(193)/`edit_data`/`get_dom`(183)。原则不变:**工具描述只写「何时用 + 关键参数」,教程归 usageHints 按 toolMode 注入**(simple 模式不见 advanced 工具,不该为其描述买单)。

## C. agent 自感知预算(用户三项想法落地)

- **C1 轮次/token 消耗提示**:工具轮次达 `maxToolRounds` 70%,或单轮 prompt tokens 超 softCap 一半时,system 段注入一行「⏳ 本任务已用 X/Y 工具轮、累计 ~ZK tokens,接近预算请收敛收口」。走 augmentPrompt 一次性轻注入,零额外 LLM 调用。
- **C2 重复计数提醒**:写工具同一路径连续失败 ≥2 次时,错误回灌 message 附加「(对该路径第 N 次失败:连续失败建议先 read 重新核对实际值,或 restore_data 回退后再改)」;规划整表重写超 `maxPlanRevisions` 的回灌同样附「第 N 版计划」计数 —— 让 agent「意识到自己已经反复了多次,适可而止」。
- **C3 单轮 token 上限**(opt-in):`roundTokenBudget` —— 单次 agent invoke 累计 token 超限 → 中断收口(emit observable 事件 + 提示性收口文本),与 automation 的全局 `tokenBudget` 正交(后者默认关、整会话语义)。

## D. 真 LLM 复测量化

A/B/C 落地后 `_real-llm-uispec.mjs` 复测 S1(长链)/S7(多组件),对比基线:28 轮 / 507K prompt tokens / 单场景耗时。验证编排纪律(3.10 新建直接委派)+ softCap 提前压缩的轮次与 token 双降。

## 非目标

- 不改 vfs 大结果外存阈值(一阶段已评估,杠杆小)
- 不做提示词分级按需切换(复杂 vs 简单流程)—— 留观察,先看 softCap + 自感知提示的实际效果
- 不动 maxMemoryRounds 默认 30(OOM 层,与 prompt 成本正交)
