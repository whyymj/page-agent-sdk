# Tasks

- [x] messages.ts 扩键:DebugDrawer(~90)/ SkillPanel(~25)/ CodePreview(~6)双包对齐 + DialogMessages 接口
- [x] DebugDrawer 转换:tab/过滤器/状态标签/trace 指标/上下文/子 agent/Agent 信息 kv/skill 错误/formatTime locale;messages prop withDefaults 缺省中文
- [x] SkillPanel 转换:表单 label/placeholder/校验错误/按钮 title/列表空态/底部提示
- [x] CodePreview 转换:4 个 title + CSS 示例文案;ChatInput chip ✕ title 接既有 removeFocus 键
- [x] ChatDialog 三挂载点传 ctx.messages(DebugDrawer/SkillPanel;CodePreview 在 MessageContent,经 props 链或 ctx)
- [x] promptBuilder:DEFAULT_SYSTEM_PROMPT_EN + buildSystemPrompt locale 参数(默认 prompt / 追加规则段两分支);presets reliableWriteRulesEn;createChatSdk 接线;导出双侧同步
- [x] selftest 扩 sec-83:新键集 zh/en 一致 / buildSystemPrompt en 分支(默认 EN prompt + 自定义追加 EN 规则)/ zh 零回归
- [x] browser 扩 i18n.spec:en locale 下 DebugDrawer tab+过滤器英文 / SkillPanel 英文 / zh 默认回归零变化
- [x] 文档:README 双侧 DialogConfig 表补语言策略一句 + usage-guide 双侧 + CHANGELOG;门禁三绿

> 工具 schema 描述语言登记 deferred.md(触发:海外用户反馈 agent 输出语言异常)。
