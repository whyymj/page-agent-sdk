# dialog-i18n Phase 2:调试/技能面板文案 + 默认 systemPrompt 语言策略

## 为什么

Phase 1(3.20.0)覆盖聊天面 13 组件,留两块割裂:

1. **DebugDrawer / SkillPanel / CodePreview 仍硬编码中文** —— en locale 用户打开「更多→调试」或「Skill 管理」,面板内 ~120 条文案(tab 名/过滤器/状态标签/表单校验/空态/按钮 title)全中文;CodePreview 的复制/新窗口/关闭 title 与 CSS 示例文案同漏。另发现 Phase 1 漏网 1 处:ChatInput 焦点 chip ✕ 的 `title="移除此焦点"`(`removeFocus` 键已存在,只是没接线)。
2. **默认 systemPrompt 与 UI 语言不一致** —— `dialog.locale:'en-US'` 只换 UI 皮;未传 systemPrompt 时 agent 仍拿中文 `DEFAULT_SYSTEM_PROMPT`(身份 + reliableWriteRules 全中文)→ 英文界面里 agent 用中文回复,这是英文用户最直接可感知的割裂。

## 方案

### 1. 面板文案接入 messages(机制零新增,Phase 1 直铺)

- `messages.ts` 扩键 ~120(平铺,沿用现有解析:messages 覆盖 > locale 包 > zh 缺省;含插值的存词条壳,组件侧拼接):
  - **DebugDrawer**(~90 键):6 tab 名 / 7 过滤器标签 / 日志空态×2 / 视图切换(卡片视图↔请求体)/ 原始 JSON 展开 / 复制 / 状态标签(待办/进行中/完成/运行中/错误)/ 流程节拍(第 N 轮/准备/N 工具/N 消息/N 个工具调用/N 步)/ trace 指标名(轮次/总耗时/平均/工具/压缩)/ 上下文面板(占用/估算 token/窗口/阈值/分类构成/最近压缩)/ 子 agent 面板(组件锁/运行中/历史/步骤/收起)/ Agent 信息(基本信息/工具/技能/可操作数据/子 Agent/MCP/Verify/任务清单/持久指令/上轮压缩的 ~30 个 kv 标签与值词)/ skill 加载错误 2 条 / formatTime('zh-CN' → locale)
  - **SkillPanel**(~25 键):面板标题/关闭/创建↔编辑态/三个表单 label+placeholder/保存↔添加/取消编辑/已创建列表/空态/编辑/删除按钮+title/校验错误 3 条/覆盖提示/底部提示段
  - **CodePreview**(~6 键):复制代码/已复制/新窗口打开/关闭/CSS 示例标题与正文
  - **ChatInput 补漏**:chip ✕ title 接既有 `removeFocus` 键
- 接线:三组件均为纯 props(不经 chatContext),增 `messages?: Partial<DialogMessages>` prop,withDefaults 缺省 `MESSAGES_ZH_CN`(独立复用零配置,同 MessageActions 模式);ChatDialog 挂载点传 `ctx.messages`。

### 2. 默认 systemPrompt 语言策略(窄切面)

- `promptBuilder.ts` 增 `DEFAULT_SYSTEM_PROMPT_EN`(身份段英译 + `systemPromptHelpers.reliableWriteRulesEn`)+ `buildSystemPrompt({ systemPrompt?, appendReliableWriteRules?, locale? })`:
  - 未传 systemPrompt + locale='en-US' → 英文默认 prompt(末尾一句 "Respond in English" 锚定输出语言)
  - 自定义 systemPrompt + append 追加 → en locale 追加 `reliableWriteRulesEn`(自定义 prompt 语言是集成方的事,但 SDK 追加的规则段应跟 UI 语言)
- `createChatSdk` 装配点把 `dialog.locale` 传入;`systemPromptHelpers.reliableWriteRulesEn` / `DEFAULT_SYSTEM_PROMPT_EN` 导出(集成方英文场景复用)。
- **不动**:工具 schema 描述(usageHints 注入的工具用法仍是中文,LLM 对中文描述理解无碍;量 ~14 工具全量描述,登记 deferred 待海外用户实际反馈 agent 输出语言问题再启)。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/core/components/messages.ts` | +~120 键 × 双包 |
| `src/core/components/DebugDrawer.vue` / `SkillPanel.vue` / `CodePreview.vue` | messages prop + 文案替换 |
| `src/core/components/ChatInput.vue` | chip ✕ title 接线(1 处) |
| `src/core/components/ChatDialog.vue` | 三挂载点传 `ctx.messages` |
| `src/core/sdk/promptBuilder.ts` | DEFAULT_SYSTEM_PROMPT_EN + buildSystemPrompt locale 参数 |
| `src/core/presets.ts` | `systemPromptHelpers.reliableWriteRulesEn` |
| `src/core/sdk/createChatSdk.ts` | buildSystemPrompt 调用点传 dialog.locale |
| `src/core/index.ts` + `types/index.d.ts` | 导出同步 |
| `src/core/__tests__/modules/sec-83.ts` | 扩:新键集一致 / EN prompt 内容锚定 / buildSystemPrompt locale 分支 |
| `tests/browser/i18n.spec.ts` | 扩:DebugDrawer en 文案 / zh 默认回归 |

## 非目标

- 工具 schema 描述国际化(deferred,触发条件:海外集成方反馈 agent 输出语言异常)
- autoTitle 已按 locale 切 prompt(Phase 1 已做),不动
- 新语言包(zh/en 之外按需后加,机制天然支持)
