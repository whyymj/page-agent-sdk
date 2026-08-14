# Proposal: real-llm-hardening(真 LLM 全场景回归驱动加固,3.10.0)

来源:complex-demo 挂 UI 规范 skill 后,deepseek-v4-flash + modelverse 10 场景真 LLM 回归(本地脚本 _real-llm-uispec.mjs,gitignore)。

## 修复(全部实测驱动)
1. stream 启动闸(P1-7b):streamer.stream() 等响应头阶段假死(fetch 默认无超时)→ use_html 委派挂 17min;race 超时与 stall 同阈值
2. 子步骤永 running 兜底扫尾:子 agent 中断时 tool_call 子步骤无配对 tool_result → UI spinner 永转;finishRound 递归置 error
3. 过程性收口回灌:flash 中途输出「我先看看…稍后委派」即收口任务零落地;detectTransitionalReply 有界回灌 ≤2
4. DSML 单竖线变体解析:flash 泄漏 <｜DSML｜invoke> 变体 parse null → 乱码当结论;剥离归一 + 闭合宽化
5. 视觉锚引用规范:task 规格化锚 hex 取自规范 skill 定义值(勿自造近似色);规范 skill 双挂模式(主给准锚 + 子照生成)

## 同批
normalizeBaseUrl 相对路径容错(三处构造点)/ htmlFragmentSkill 导出 / 新建路径样本式调研 / patch op move(3.8.0 线)/ examples 优化

## 验证
10 场景链路全通(委派/落地/规范传递/精修/调序/删除/恢复/开放指令);残余 3 断言为 flash 细节保真(强模型建议已文档化)。selftest 1967 / e2e 596 / browser 54。
