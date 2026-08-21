# Tasks(edge-hardening,四项独立可并行,按序收口;已过怀疑论评审回改)

## ① approval 生命周期收口(D-08)✅(2026-08-21)

- [x] 核实代码(评审已替核):abort 联动自动拒(approval.ts:65-71 / humanConfirm.ts:86-92)+ SDK 收口(switchSession runSerial+abortAllActive / resetSession 首行 abortAllActive)+ UI 层(ChatHeader 先 useChat.reset)+ sec-52 既有 —— **机制存在且完整**
- [x] e2e(hang-feedback):approval 挂起(不 resolve)→ switchSession → **有界收口 0ms < 5s 不永挂** + sessionId 已换新会话就绪;经 stream 路径(不经 send 的 runSerial 闸)
- [ ] 程序化 send+switchSession 的 runSerial 互等死锁窗口:send 在途等 approval(永不超时)+ switchSession 排队 → 互等 —— 留 browser(human-confirm-demo UI 路径)/真 UI 验证;暴露即按「挂起有界收口三契约」修(评审预期缺陷形态,已留痕)
- [ ] browser e2e(human-confirm-demo):删除确认弹窗出现 → 清空会话 → 弹窗消失,新对话不受影响(UI 交互用例待跑)

## ② editor 批量删除失败隔离(C-08)✅(2026-08-21)

- [x] 核实 deleteComponent(ids[]) 现状(评审已替核):单删循环,未命中记 error 继续下一个 = 「跳过坏的删好的」部分成功
- [x] 定语义并实施:预检全部 id,任一不存在 → 整批拒 + 结构化错误(missing 列表);prompt.js 描述同步
- [x] 顺带补 nodeInfo 就绪检查(本文件唯一缺该检查的入口)
- [ ] 手动用例:混入编造 id → 零删除 + 错误指明;全部有效 → 正常删(待 dev server)

## ③ 模糊指代纪律(B-01/B-06)✅(2026-08-21)

- [x] editor prompt:「指代不明 → 先 list_components 列候选或说明推断依据,禁止未定位就 write/add;一句话里多个组件用 id 区分」
- [ ] 真 LLM 观察(场景脚本化固定问法;≥5-10 次才可量化):定位正确率;不达标 → deferred 登记「write 前未 read 提示」机制化(触发条件:实测瞎改案例)

## ④ 防套取提示(H-02)✅(2026-08-21)

- [x] SDK DEFAULT_SYSTEM_PROMPT + DEFAULT_SYSTEM_PROMPT_EN 双语追加防泄露句
- [x] editor prompt 同句(prompt.js)
- [x] selftest(sec-31):默认 prompt 含该句 —— 断言完整原句(全句 includes,zh/en 各一);e2e systemprompt 已核实无全文等值断言无需适配
- [x] 残留风险定级 P3 记录(proposal 已说明)

## 收口

- [x] CHANGELOG [Unreleased];计数同步(2687/902/102);三绿 + browser 102
- [x] editor 侧改动随 feature 分支提交(与 atomic-tree-add 同批,gitlab 网络恢复后推)
