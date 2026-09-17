/**
 * 页面锚点(page-context)—— 每轮 system 注入当前页 title + URL。
 *
 * 文档站/页面问答场景:用户问「这篇文档/这个页面」时 agent 不必先调 inspect_env 探测
 * 自己在哪页。pin 段(PIN_SEGMENT_NAMES 登记)保跨压缩存活;子 agent 不继承(主栈中间件
 * 天然不进子栈,与 intentGuard 同款 —— 委派 prompt 已带任务描述,页面锚点与子任务无直接关联,
 * 省 token;确需页面内容时其工具面声明后可自调 read_page)。
 *
 * 中间件本身不摸 document(浏览器全局):页面信息经 getPageInfo 注入,由 createChatSdk
 * 装配侧提供(node/headless 环境返回 null 自然降级为不注入)。
 */
import type { Middleware } from './middleware'

/** 页面锚点信息(装配侧从 document/location 读;不可得返回 null) */
export interface PageInfo {
  title: string
  url: string
}

export interface PageContextDeps {
  /** 每轮读当前页信息(实时:SPA 路由切换后下轮自动跟随;返回 null → 本轮不注入) */
  getPageInfo: () => PageInfo | null
  /** read_page 是否在工具面(conditions 尾行;domInspect 关时不引导调不存在的工具) */
  canReadPage: boolean
}

/** 段文案:锚点事实 + 条件化工具指引(只递信号,不禁工具) */
function buildSegment(info: PageInfo, canReadPage: boolean): string {
  const lines = ['[当前页面] 用户正在浏览:', `- 标题:${info.title}`, `- URL:${info.url}`, '用户问题通常针对此页面内容。']
  if (canReadPage) {
    lines.push('需要页面正文时用 read_page 读取纯文本(长文按 hasMore 分页续读);读结构用 get_dom。')
  }
  return lines.join('\n')
}

/** 创建页面锚点中间件(capabilities.pageContext,opt-in 默认关) */
export function createPageContextMiddleware(deps: PageContextDeps): Middleware {
  return {
    name: 'pageContext',
    augmentPrompt: () => {
      const info = deps.getPageInfo()
      if (!info) return undefined
      return buildSegment(info, deps.canReadPage)
    },
  }
}
