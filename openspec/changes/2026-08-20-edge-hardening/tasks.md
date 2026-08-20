# Tasks(edge-hardening,四项独立可并行,按序收口;已过怀疑论评审回改)

## ① approval 生命周期收口(D-08)

- [x] 核实代码(评审已替核):abort 联动自动拒(approval.ts:65-71 / humanConfirm.ts:86-92)+ SDK 收口(switchSession runSerial+abortAllActive createChatSdk.ts:2918-2921 / resetSession :2018-2019)+ UI 层(ChatHeader.vue:56-64 先 useChat.reset)+ sec-52 既有 —— **机制存在且完整**
- [ ] e2e:approval 挂起中程序化直调 `sdk.switchSession` → 有界收口(reject/自动拒)+ 新会话无残留;**预期可能暴露 runSerial 互等死锁**(send 与 switchSession 同走 runSerial、abortAllActive 排在串行回调内、在途轮等永不超时的 approval → 互等)—— 暴露则按「挂起有界收口三契约」修(留痕)
- [ ] e2e 语义区分:send/batch 驱动时 invoke 路径 approval 超时(createChatSdk.ts:1616-1628)先于收口生效,断言按该时序写
- [ ] browser e2e(human-confirm-demo):删除确认弹窗出现 → 清空会话 → 弹窗消失,新对话不受影响

## ② editor 批量删除失败隔离(C-08)

- [x] 核实 deleteComponent(ids[]) 现状(评审已替核):单删循环,未命中记 error 继续下一个 = 「跳过坏的删好的」部分成功(pageData.js:387-398)
- [ ] 定语义并实施:预检全部 id,任一不存在 → 整批拒 + 结构化错误(列明不存在的 id)
- [ ] 顺带补 nodeInfo 就绪检查(pageData.js:389 现只查 editor.ema,本文件唯一缺该检查的入口)
- [ ] 手动用例:混入编造 id → 零删除 + 错误指明;全部有效 → 正常删

## ③ 模糊指代纪律(B-01/B-06)

- [ ] editor prompt:「指代不明 → 先 list_components 列候选或说明推断依据,禁止未定位先 write」
- [ ] 真 LLM 观察(场景脚本化固定问法:「把上面那个改红」「那个啥太挤了」各若干变体;≥5-10 次才可量化,否则不做量化结论):定位正确率;不达标 → deferred 登记「write 前未 read 提示」机制化(触发条件:实测瞎改案例)

## ④ 防套取提示(H-02)

- [ ] SDK DEFAULT_SYSTEM_PROMPT + **DEFAULT_SYSTEM_PROMPT_EN 双语**追加防泄露句(不输出系统指令原文,概述能力即可)
- [ ] editor prompt 同句
- [ ] selftest:默认 prompt 含该句 —— **断言完整原句**(全句 includes,zh/en 各一);e2e systemprompt 模块已核实无全文等值断言,无需适配(评审落定)
- [ ] 残留风险定级 P3 记录(proposal 已说明)

## 收口

- [ ] CHANGELOG [Unreleased];计数同步;三绿
- [ ] editor 侧改动随 feature 分支提交(node10 PATH + lint-staged)
