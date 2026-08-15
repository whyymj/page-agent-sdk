/**
 * 测试模块:JSON 驱动的响应式页面
 *
 * 设计:window.page 是一个普通对象 { title, theme, components[] }(非 reactive,展示 SDK 不依赖 Vue 响应式)。
 * 配置:普通对象经 data 的 bind 字段直连 SDK,pageSchema 作为 schema 声明形状
 * (字段 .describe() 自动注入 systemPrompt「可操作数据」段 + 作为写入校验 schema)。
 * Agent 通过 write 修改 page 字段,集成方监听 onEvent('data_change') 触发 tick 重渲染画布。
 *
 * components 是 discriminated union(by type),写入时强校验,Agent 传错类型会收到清晰错误。
 * 容器组件(card/carousel/waterfall)带 children 数组(z.lazy 递归),支持任意层级嵌套;
 * custom 为纯代码组件(code 字段 → 装配期自动挂 html 子 agent,委派生成/精修)。
 */
import { z } from 'zod'

/** 组件类型(手动声明:z.lazy 递归类型需显式注解,卡片/轮播/瀑布流 children 可嵌套任意组件) */
export type PageComponent =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string }
  | { type: 'button'; label: string; variant?: 'primary' | 'secondary' | 'ghost' }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'list'; items: string[] }
  | { type: 'card'; title: string; text: string; children?: PageComponent[] }
  | { type: 'carousel'; children: PageComponent[] }
  | { type: 'waterfall'; columns?: number; children: PageComponent[] }
  | { type: 'custom'; name?: string; code: string }

/** 组件 schema:按 type 区分的联合,每个类型有各自字段;容器 children 递归引用自身 */
export const componentSchema: z.ZodType<PageComponent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().describe('标题文本'),
    level: z.number().int().min(1).max(6).optional().describe('层级 1-6,默认 2'),
  }),
  z.object({
    type: z.literal('paragraph'),
    text: z.string().describe('段落文本'),
  }),
  z.object({
    type: z.literal('button'),
    label: z.string().describe('按钮文字'),
    variant: z.enum(['primary', 'secondary', 'ghost']).optional().describe('样式,默认 primary'),
  }),
  z.object({
    type: z.literal('image'),
    src: z.string().describe('图片地址'),
    alt: z.string().optional().describe('替代文字'),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string()).describe('列表项'),
  }),
  z.object({
    type: z.literal('card'),
    title: z.string().describe('卡片标题'),
    text: z.string().describe('卡片正文'),
    children: z.array(z.lazy(() => componentSchema)).optional().describe('子组件(可嵌套任意组件)'),
  }),
  z.object({
    type: z.literal('carousel'),
    children: z.array(z.lazy(() => componentSchema)).describe('轮播子组件(每项一页)'),
  }),
  z.object({
    type: z.literal('waterfall'),
    columns: z.number().int().min(2).max(4).optional().describe('瀑布流列数 2-4,默认 2'),
    children: z.array(z.lazy(() => componentSchema)).describe('瀑布流子组件'),
  }),
  z.object({
    type: z.literal('custom'),
    name: z.string().optional().describe('组件名(便于定位,如 "啤酒杯动效")'),
    code: z.string().describe('完整 HTML 代码(自包含片段,可含 style/script)'),
  }),
])

export const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  theme: z.enum(['light', 'dark']).describe('页面主题:light 或 dark'),
  components: z.array(componentSchema).describe('组件数组(页面内容;容器组件 children 可嵌套)'),
})

export type PageData = z.infer<typeof pageSchema>

/** 初始示例页面(含卡片/瀑布流/轮播嵌套示例;纯代码 custom 组件由 Agent 按需创建) */
export const initialPage: PageData = {
  title: '示例页面',
  theme: 'light',
  components: [
    { type: 'heading', text: '你好,页面内 Agent', level: 1 },
    {
      type: 'paragraph',
      text: '这个页面由 window.page 的 JSON 驱动。通过右侧对话框告诉 Agent 要怎么改,左侧会实时更新。',
    },
    { type: 'button', label: '主要按钮', variant: 'primary' },
    { type: 'button', label: '次要按钮', variant: 'secondary' },
    {
      type: 'card',
      title: '组合卡片',
      text: '卡片可以嵌套子组件:',
      children: [
        { type: 'paragraph', text: '我是卡片内的段落子组件。' },
        { type: 'button', label: '卡内按钮', variant: 'ghost' },
      ],
    },
    {
      type: 'waterfall',
      columns: 2,
      children: [
        { type: 'card', title: '瀑布卡片 A', text: '瀑布流子项,自动分列排布。' },
        {
          type: 'card',
          title: '瀑布卡片 B',
          text: '带子组件的卡片:',
          children: [{ type: 'list', items: ['子列表项 1', '子列表项 2'] }],
        },
      ],
    },
    {
      type: 'carousel',
      children: [
        { type: 'card', title: '轮播第 1 页', text: '轮播容器,每项一页,可前后切换。' },
        { type: 'card', title: '轮播第 2 页', text: '第二页内容,同样是嵌套的卡片组件。' },
      ],
    },
    { type: 'list', items: ['需求收集', '方案设计', '编码实现'] },
  ],
}

/** page-builder skill 全文:教 Agent 如何编辑页面(组件类型等业务知识;字段说明由 data schema .describe() 自动注入,此处不重复) */
export const pageBuilderSkillContent = `# 页面构建 Skill(window.page)

左侧页面由 \`window.page\` 这个 JSON 对象驱动,结构:{ title, theme, components[] }。

## 组件类型(每个组件对象的格式)
- 标题:{ "type": "heading", "text": "标题", "level": 1 }   // level 1-6 可选
- 段落:{ "type": "paragraph", "text": "段落文本" }
- 按钮:{ "type": "button", "label": "按钮文字", "variant": "primary" }   // variant: primary|secondary|ghost 可选
- 图片:{ "type": "image", "src": "https://...", "alt": "说明" }
- 列表:{ "type": "list", "items": ["项A", "项B"] }
- 卡片:{ "type": "card", "title": "标题", "text": "正文", "children": [...] }   // children 可选,嵌套子组件
- 轮播:{ "type": "carousel", "children": [卡片, 卡片, ...] }   // 每项一页
- 瀑布流:{ "type": "waterfall", "columns": 2, "children": [卡片, ...] }   // columns 2-4 可选
- 纯代码:{ "type": "custom", "name": "组件名", "code": "<完整 HTML>" }   // 复杂动效/自由布局用;优先委派 html 子 agent 生成

## 嵌套与层级
- 容器组件(card/carousel/waterfall)的 children 是组件数组,可任意层级嵌套
- 组件路径:顶层 components.N,嵌套子组件 components.N.children.M,再深依次 .children.K
- 调整层级优先 move 一步原子:patch({op:"move", jsonPath:"源路径", value:"目标数组路径"}),如同数组则重排;不要 append+remove 两步(第二步索引可能算错)
- 容器内调序:同数组 move(value 传目标下标位置)

## 修改要点
- 改单个组件优先用增量 patch(只发改动部分),避免整体重传 \`components\` 大数组被截断
- 校验失败会返回具体错误,按提示修正 type/字段后重试
- ⚠️ 字段以 schema 声明为准:schema 没有的字段(如给 button 加 style)会收到 SCHEMA_STRIP 错误 —— 此时如实告知用户该组件类型不支持此属性,不要猜测写入或编造成功
`
