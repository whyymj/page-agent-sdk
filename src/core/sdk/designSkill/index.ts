/**
 * 内置设计品味 skill:web-design-engineer(html-design-skill)
 *
 * vendored from ConardLi garden-skills v1.2.2(MIT)· © ConardLi
 * 上游:https://github.com/ConardLi/garden-skills/tree/main/skills/web-design-engineer
 * vendored: 2026-08-27 · 主文适配版 skillDoc.ts(三处嫁接)+ references 29 文件原样 references.ts
 *
 * 分工:html-fragment skill 管「落地规范」(schema/资产模型/校验),本 skill 管「设计品味」
 * (反 AI 俗套 / 设计系统先声明 / oklch 配色 / 25 风格配方 / 5 维自评),并列挂载于 html 子 agent。
 * 渐进披露:system 索引只多一行(name+description);主文 33K 仅在子 agent load_skill 时进上下文,
 * 29 个参考(120K)再按需单个取回 —— 不整包灌。
 *
 * 上游升级:node scripts/gen-design-skill.mjs <新skill目录> 刷 references + 手工对齐 skillDoc 适配。
 */
import type { SkillSpec } from '../../harness/skills'
import { designSkillDoc } from './skillDoc'
import { DESIGN_REFERENCES } from './references'

/** skill 名(load_skill 入参;与上游 SKILL.md frontmatter name 一致) */
export const DESIGN_SKILL_NAME = 'web-design-engineer'

/** 构造内置设计品味 skill(无参数:纯品味知识,与 root/codeField 路径无关,装配期重建无需触碰) */
export function buildDesignSkill(): SkillSpec {
  return {
    name: DESIGN_SKILL_NAME,
    description:
      'Design taste & anti-cliché system: declare the design system (palette/type/spacing/motion) before coding, avoid AI-default aesthetics (purple gradients/emoji icons/Inter), 25 named style recipes (linear/apple-hig/muji/pentagram/bloomberg-terminal…), 5-dimension critique. Load BEFORE starting any design-heavy visual work.',
    getContent: () => designSkillDoc,
    references: DESIGN_REFERENCES,
  }
}
