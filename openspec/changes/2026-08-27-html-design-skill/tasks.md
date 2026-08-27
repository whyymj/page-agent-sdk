# Tasks:html-design-skill(内置 web-design-engineer)

## Phase 1:vendoring + 装配(测试先行)

- [ ] 1. selftest 红测:`createHtmlSubagent()` 默认 skills 数组含 design skill(name/description 形态)+ `design:false` 不挂 + `design:<SkillSpec>` 替换;references 数量 = 35(含 style-recipes/INDEX)且各带 description
- [ ] 2. vendoring:`src/core/sdk/designSkill/` 落 SKILL.md(适配三处嫁接:无网事实/task 为准、保守默认+假设说明、自包含组件形态)+ references/ 35 文件原文内联;文件头 MIT attribution(© ConardLi + 上游 URL + v1.2.2)
- [ ] 3. API:`createHtmlSubagent({ design?: boolean | SkillSpec })` 缺省 true;追加在用户 skills 之后;与 usedDefaultSkill 逻辑合流(skills 未传 = [htmlFragment, design])
- [ ] 4. 编排引导:装 design 时委派 task 规格化补「设计/视觉类先 load_skill 设计技能」一句
- [ ] 5. types 同步:`HtmlSubagentConfig.design` 进 types/index.d.ts + headless.d.ts;src/core/index.ts 导出无新面(skill 不导出)

## Phase 2:门禁与验证

- [ ] 6. selftest 主文锚点断言(嫁接三处文案:task 为准/保守默认/自包含)+ load_skill 渐进披露(references 不进主文)
- [ ] 7. e2e subagents 模块:design 装配反射(默认/关闭/替换三态)
- [ ] 8. browser html-page 回归(装配零破坏)
- [ ] 9. size-check + npm pack dry-run(包体增量记录;超限执行降级精选预案并回 proposal 备案)
- [ ] 10. 真 LLM 观察项:html-page 一场景看子 agent 是否 load_skill + 产出对比,报告留 local/(不设硬阈值)
- [ ] 11. 文档:README 中英(致谢段 + design 配置)+ usage-guide + CLAUDE.md html 子 agent 段 + CHANGELOG(minor,默认行为变化注明);计数同步
