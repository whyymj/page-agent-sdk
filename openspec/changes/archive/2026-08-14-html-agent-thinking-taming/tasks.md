# Tasks: html-agent-thinking-taming

> 实施任务清单。`/opsx:apply` 按此执行。**minor**(向后兼容)。A task 规格化 → B validate jsonPath → C 写前简述 → D 文档 → E 发布。

## 阶段 A:主 agent task 规格化(①)

- [ ] A1 `src/core/presets.ts` htmlPageOrchestrator 加【task 规格化】条(4 要素 + 不含技术实现 + ❌/✅ 示例)
- [ ] A2 `src/core/sdk/htmlSubagent.ts` 子 agent prompt:收规格后照做;缺规格按字面意图选简单方案不纠结风格
- [ ] A3 selftest(sec-31 扩展):htmlPageOrchestrator 含规格条 + 4 要素 + 示例

## 阶段 B:validate_code jsonPath(②,工具根治)

- [ ] B1 `src/core/sdk/htmlSubagent.ts` createHtmlValidateToolsMiddleware:schema 加 `jsonPath`;接收可选 `getController`(可变槽,装配期注入)
- [ ] B2 `src/core/sdk/createChatSdk.ts` 装配 `_codeAsset` 时(codeAssetConfigs 处理,line ~871-878),同源注入 getController 给 validate 中间件(复用 codeAssetMiddleware 的 getController)
- [ ] B3 实现:jsonPath → getController().get().bind → getByPath → validateHtmlFormat;不存在/非 string → 友好错误
- [ ] B4 `src/core/sdk/htmlSubagent.ts` htmlSystemPrompt:新建组件 `validate_code({jsonPath:'components.N.code'})`(零重传);原 validate content 强化条简化(优先 jsonPath/path,content 兜底)
- [ ] B5 selftest(validate 中间件扩展):jsonPath 校验 data code 通过 / 不存在错误 / 旧 path/content 零回归

## 阶段 C:写前简述(③)

- [ ] C1 `src/core/sdk/htmlSubagent.ts` htmlSystemPrompt 简洁思考段加「写前简述」条(1-2 句方案 → 实现 → 照做不权衡)
- [ ] C2 selftest 或人工核对:prompt 含条

## 阶段 D:文档(④)

- [ ] D1 `doc/usage-guide.md`(+.en):html 子 agent 推荐强指令遵循模型(deepseek-v4 / claude / gpt-4o);flash 类放大思考;高频场景建议非 flash
- [ ] D2 `CLAUDE.md` 子 agent 段:真 LLM 调优复盘(flash 过度思考现象 + ①②③ 治理 + 模型因素)
- [ ] D3 README 中英文(若必要):html 子 agent 模型建议一行

## 阶段 E:发布(minor,用户确认后)

> 原「阶段 E 无 html agent 降级」已移至 `html-subagent-open-schema`(编排自适应注入 B 阶段)。本 change A-D + 发布。

- [ ] E1 develop 实施 + commit;openspec 归档 `git add -f openspec/changes/archive/2026-08-14-html-agent-thinking-taming/`;README 全景盘点同步
- [ ] E2 `npm version minor --no-git-tag-version`
- [ ] E3 发布前必跑顺序全绿(selftest + e2e + browser + types + size + exports)
- [ ] E4 `./scripts/publish-github.sh "release x.x.0: html 子 agent 过度思考治理(task 规格化 + validate jsonPath + 写前简述)"` 推双远程
- [ ] E5 `npm publish` + CDN 验证

## 验证门禁

- **A**:htmlPageOrchestrator 含规格条(selftest)+ 真 LLM 规格 task 不穷举装饰
- **B**:validate jsonPath(selftest 往返 + 旧用法零回归)+ 真 LLM validate 次数降(无需重传)
- **C**:写前简述(selftest/核对)+ 真 LLM 实现纠结减
- **零回归**:现有 html-page-demo + complex-demo e2e/browser 全 pass
- **模型对比(④,D 后手动)**:flash vs 强模型(deepseek-v4/claude)思考质量对比,记录结论

## 前置说明

- 工作区已有未 commit 改动(F1/F2/F3 框架缺陷修复 + complex-demo 接入 + 视觉装饰/validate 强化先行迭代),本 change 在其 commit 后独立批次,勿混批
- 本 change ①③提示词增强与先行迭代的视觉装饰/validate 强化条协同(②实施后 validate content 条简化)
- 与 html-subagent-open-schema(编排自动注入)递进:可同批或先后实施(①改 htmlPageOrchestrator 内容,独立于编排注入方式)
