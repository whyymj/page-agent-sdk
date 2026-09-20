/**
 * take_screenshot(page-screenshot)—— agent 的「视觉查看」工具(domInspect 族)。
 *
 * 三模式:selector 局部 DOM / fullPage 整页 / 默认当前视口。渲染默认 vendor 的 html-to-image
 * (SVG foreignObject 路线,宿主 CSP 禁 SVG data URL 时经 screenshot.renderer 钩子逃生);
 * 产物过压缩闸(复用 imageInput canvas 管线,长边 ≤1568 jpeg q0.85);**base64 绝不进工具结果
 * content**(offload 阈值 2 万字符远小于任何截图,进 content 即被毁成文本文件)——
 * vision 主模型经 onShot 回调走「合成 user 消息带图 parts」通道(sdk 层 middleware 注入,
 * 免疫 trimContextIfNeeded/offload 两处字符串化),非 vision 经 describe 转述回灌纯文本。
 *
 * 工具为 sdk 层工厂(闭包 imagePipeline/vfs/事件面),静态 domTool.ts 放不下这些依赖;
 * 注入条件 = caps.domInspect && (vision || images.describe),装配于 createChatSdk。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as htmlToImage from 'html-to-image'
import { compressImage } from './imageInput'
import type { AgentImage } from '../types'

/** 截图长边上限(与图片输入压缩闸同口径) */
export const SCREENSHOT_MAX_EDGE = 1568
/** fullPage 高度上限:超长文档(万级 px)渲染耗时/内存失控,拒并提示分段 selector */
export const SCREENSHOT_MAX_FULLPAGE_HEIGHT = 32768

/** 渲染器签名(默认 html-to-image 包装;宿主 screenshot.renderer / selftest fake 注入同形) */
export type ScreenshotRenderer = (el: Element, opts: { width?: number; height?: number }) => Promise<string>

/** 默认渲染器:html-to-image toPng(pixelRatio 1 控体积;宽高覆盖用于视口/整页裁切)。
 *  cacheBust 不开(2026-09-19):bust 给每张跨域图追加时间戳 query,绕过浏览器缓存全量重拉 ——
 *  连环截图时上游(picsum→fastly 等)压力翻倍,实测间歇性拒连(ERR_CONNECTION_CLOSED → html-to-image
 *  reject [object Event],complex-demo 会话 5 连败根因);截图对图源缓存新鲜度不敏感,复用缓存更稳 */
async function defaultRender(el: Element, opts: { width?: number; height?: number }): Promise<string> {
  return htmlToImage.toPng(el as HTMLElement, { width: opts.width, height: opts.height, pixelRatio: 1 })
}

/** 聚焦取景 selector(纯函数):低代码宿主通用约定 —— 组件 DOM 带 data-path=<数据路径>(complex-demo/
 * editor 类选中拾取用),聚焦 path 可直接映射为精确取景锚点;值含引号/反斜杠时转义防属性选择器注入 */
export function focusShotSelector(path: string): string {
  const v = String(path ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `[data-path="${v}"]`
}

/** 取景范围内 iframe 数量(纯函数;node/duck 桩无 querySelectorAll 时返回 0 不炸)。
 *  iframe 内部(代码组件沙箱等跨 frame 内容)截图捕获不到 —— 结果预警的判定源(2026-09-20) */
export function countIframesIn(root: Element | null | undefined): number {
  try {
    if (!root || typeof (root as Element).querySelectorAll !== 'function') return 0
    return (root as Element).querySelectorAll('iframe').length
  } catch {
    return 0
  }
}

/** dataUri → Blob(compressImage 复用桥;atob 手解避免依赖 WhatWG fetch data: 支持) */
function dataUriToBlob(dataUri: string): Blob {
  const [head, data] = dataUri.split(',', 2)
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const bin = atob(data ?? '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export type ScreenshotMode = 'selector' | 'fullPage' | 'viewport'

/** 三模式目标解析(纯函数,selftest 直测;doc duck-typing 只需 querySelector/documentElement/窗口尺寸) */
export function resolveScreenshotTarget(
  doc: { querySelector?: (sel: string) => Element | null },
  win: { innerWidth?: number; innerHeight?: number },
  args: { selector?: string; fullPage?: boolean },
): { ok: true; mode: ScreenshotMode; el: Element | null; width?: number; height?: number } | { ok: false; error: string } {
  if (args.selector) {
    let el: Element | null = null
    try { el = doc.querySelector?.(args.selector) ?? null } catch { el = null }
    if (!el) return { ok: false, error: `未找到匹配元素:selector="${args.selector}"(可先用 dom_search 定位)` }
    return { ok: true, mode: 'selector', el }
  }
  // 视口/整页都以 documentElement 为渲染根,靠宽高覆盖区分;el 由调用侧传 documentElement(此函数不直取,保纯度)
  const w = typeof win.innerWidth === 'number' ? win.innerWidth : undefined
  const h = args.fullPage ? undefined : (typeof win.innerHeight === 'number' ? win.innerHeight : undefined)
  return { ok: true, mode: args.fullPage ? 'fullPage' : 'viewport', el: null, width: w, height: h }
}

export interface ScreenshotToolDeps {
  /** 自定义渲染器(宿主 screenshot.renderer;缺省 html-to-image) */
  render?: ScreenshotRenderer
  /** 截图落 vfs(sdk 层:写 userImages/<id> 返回 ref;未接时省略 vfsRef) */
  stow?: (image: AgentImage) => string | undefined
  /** 主模型是否多模态(活值:getVision 闭包) */
  getVision: () => boolean
  /** 识图转述(非 vision;来自 options.images.describe) */
  describe?: (image: AgentImage, context: { text: string }) => Promise<string>
  /** 截图产出回调(sdk 层:合成消息队列 + tool_result 事件 image 字段) */
  onShot?: (image: AgentImage, meta: { mode: ScreenshotMode | 'url'; selector?: string }) => void
  /** 渲染根元素(视口/整页模式;生产传 document.documentElement,selftest 注入) */
  getRootEl?: () => Element | null
  /** 当前生效聚焦焦点(sdk 层注入 core.getFocus;缺省 = 无聚焦感知,行为不变) */
  getActiveFocus?: () => { path: string } | undefined
  /** 聚焦 path → DOM selector 自定义映射(宿主 data-path 约定不同时覆盖;缺省 = [data-path="<path>"] 探测) */
  focusSelector?: (path: string) => string | undefined
}

/**
 * 创建截图工具。装配条件由 createChatSdk 判定(domInspect && (vision || describe));
 * 运行时二次守卫(setLlm 降级后工具仍在池):无消费方时诚实拒绝文案,不留静默空图。
 */
export function createScreenshotTool(deps: ScreenshotToolDeps) {
  const render = deps.render ?? defaultRender
  return tool(
    async (args) => {
      if (typeof document === 'undefined') {
        return 'ERROR: take_screenshot 仅在浏览器环境可用(当前运行在 node/服务端,无 DOM)。'
      }
      // 聚焦取景锚定(2026-09-19,真机 dump 驱动:指代问句「这是啥/这里画的是啥」时模型截视口/整页漫游,
      // 焦点组件从未进画幅):缺省 selector 且有聚焦焦点 → 探测宿主 DOM 锚点(默认 [data-path=焦点路径],
      // 低代码宿主通用约定;focusSelector 可覆盖),命中即精确截取聚焦组件;未命中回退视口并提示手动指定。
      // fullPage 显式指定 = 用户要整页,不抢
      let focusNote = ''
      let effectiveArgs = args
      if (!args.selector && !args.fullPage) {
        const focus = deps.getActiveFocus?.()
        if (focus?.path) {
          const sel = deps.focusSelector ? deps.focusSelector(focus.path) : focusShotSelector(focus.path)
          let hit = false
          if (sel) { try { hit = !!document.querySelector(sel) } catch { hit = false } }
          if (hit) {
            effectiveArgs = { ...args, selector: sel }
            focusNote = `(取景=聚焦组件 ${focus.path},data-path 锚定)`
          } else {
            focusNote = `(当前聚焦 ${focus.path},但未在 DOM 找到对应锚点,已回退视口;要精确截取可传 selector)`
          }
        }
      }
      const resolved = resolveScreenshotTarget(document, typeof window !== 'undefined' ? window : {}, effectiveArgs)
      if (!resolved.ok) return `ERROR: ${resolved.error}`
      const rootEl = resolved.el ?? deps.getRootEl?.() ?? document.documentElement
      // iframe 盲区预警(2026-09-20 真机 dump 驱动):代码组件沙箱等 iframe 内容截图捕不到(图里只有外壳/空白),
      // 工具却报「成功」—— 主 agent 连试 4 次截图(含同参重复)才发现。渲染/压缩失败路径同样携带(盲区与成败无关)。
      const iframeCount = countIframesIn(rootEl)
      const iframeNote = iframeCount > 0
        ? `⚠️ 取景范围内含 ${iframeCount} 个 iframe:跨 frame 内容(如代码组件沙箱)截图捕获不到,图里只会是其外壳/空白区域 —— 验证 iframe 内部请走数据侧核对(read/validate_code/get_dom),勿再对同一区域重复截图。`
        : ''
      // fullPage:documentElement 布局高只有视口高,须显式传 scrollHeight 才能截到整页;
      // 同时做高度守卫(超长文档渲染耗时/内存失控,拒并提示分段)
      let renderOpts: { width?: number; height?: number } = { width: resolved.width, height: resolved.height }
      if (resolved.mode === 'fullPage') {
        const docH = Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0)
        if (docH > SCREENSHOT_MAX_FULLPAGE_HEIGHT) {
          return `ERROR: 整页高度 ${docH}px 超上限 ${SCREENSHOT_MAX_FULLPAGE_HEIGHT}(超长文档渲染会卡死页面)。请改用 selector 分段截取关键区域。`
        }
        renderOpts = { width: resolved.width, height: docH }
      }
      let pngDataUri: string
      try {
        pngDataUri = await render(rootEl, renderOpts)
      } catch (e) {
        // foreignObject/CSP 限制、跨域图污染 canvas 等渲染失败:可读降级 + 缩小范围建议
        return `ERROR: 截图渲染失败(${e instanceof Error ? e.message : String(e)})${focusNote}.常见原因:宿主页面 CSP 禁止 SVG data URL / 跨域图片污染画布 / 元素含无法克隆的内容。建议:① 改用 selector 缩小到目标区域;② 结构验证可改用 get_dom / dom_info(rect+styles);③ 宿主可配 screenshot.renderer 自定义渲染器绕过。${iframeNote}`
      }
      // 压缩闸:dataUri → Blob → compressImage(jpeg q0.85 ≤1568,产物含 thumb/dims/bytes)
      let image: AgentImage
      try {
        image = await compressImage(dataUriToBlob(pngDataUri), { name: `screenshot-${resolved.mode}.png` })
      } catch (e) {
        return `ERROR: 截图压缩失败(${e instanceof Error ? e.message : String(e)}),未投递。${iframeNote}`
      }
      const vfsRef = deps.stow?.(image)
      const meta = { mode: resolved.mode, ...(effectiveArgs.selector ? { selector: effectiveArgs.selector } : {}) }
      const vision = deps.getVision()
      // ① vision 主模型:经 onShot 进合成 user 消息通道(图不进本结果)。子 agent 截图同样回流主循环
      // (其 wrapModelCall 属子栈不消费,图随队列在主循环下一次模型调用出现 —— 与委派结论回流同理)
      if (vision) deps.onShot?.(image, meta)
      // ② 非 vision:describe 转述回灌纯文本(图不直发)
      let description: string | undefined
      if (!vision) {
        if (!deps.describe) {
          return 'ERROR: 截图已生成但主模型不支持图片(vision=false)且未配置 images.describe,无处投递。请换多模态模型 / LLMConfig.vision:true / 配置 images.describe(集成方识图旁路)。'
        }
        try {
          description = await deps.describe(image, { text: `页面截图(${resolved.mode}${args.selector ? ` ${args.selector}` : ''})` })
        } catch (e) {
          description = undefined
          void e
        }
      }
      const delivered = vision ? 'vision-image(随后的图片消息)' : description ? 'describe-text(转述如下)' : 'none'
      const lines = [
        `截图完成(${resolved.mode}${effectiveArgs.selector ? ` selector="${effectiveArgs.selector}"` : ''}):${image.width}x${image.height},${Math.round((image.bytes ?? 0) / 1024)}KB(jpeg 压缩后)${focusNote}`,
        vfsRef ? `原图已存 vfs:${vfsRef}` : 'vfs 未开启,原图仅本轮内存',
        `投递形态:${delivered}`,
      ]
      // iframe 盲区预警(2026-09-20 真机 dump 驱动):iframeNote 在 rootEl 解析后已算好(成功/失败路径共用)
      if (iframeNote) lines.push(iframeNote)
      if (description) lines.push(`识图转述:${description}`)
      return lines.join('\n')
    },
    {
      name: 'take_screenshot',
      description:
        '截取当前页面图像查看(视觉验证:布局/样式/渲染效果)。聚焦态下**不传 selector 默认截取聚焦组件**(宿主 data-path 锚定 —— 指代问句「这是啥/这里画的是啥」优先此取景,整页截图仅在用户明确要求时用)。selector 截取指定元素区域;fullPage 截整页(超长文档会被拒,改用 selector 分段);都不传且无聚焦截当前视口。只读;截图经压缩后投递(多模态主模型直看图,纯文本模型自动走识图转述)。',
      schema: z.object({
        selector: z.string().optional().describe('CSS 选择器:截取该元素区域(先用 dom_search 定位更稳)'),
        fullPage: z.boolean().optional().describe('截取整个页面(默认 false = 当前视口)'),
      }),
    },
  )
}


/**
 * view_image:查看一张图片 URL(4.23,真机 dump 驱动)—— 页面数据里读到的图(轮播某帧/商品图/封面)
 * **原图直投**,不做截图渲染:模型服务端拉图,CORS/画布污染/渲染失败/自动轮播已切帧 整类问题都不存在。
 * 与 take_screenshot 分工:截图看「渲染后的组件」(布局/叠加文案),view_image 看「这张图本身」;
 * 多帧组件问特定帧(「第一张图」)时用对应 slide 的 URL,勿截当前渲染帧(autoplay 可能已轮播)。
 * node 环境可用(无 DOM 依赖);装配条件 = vision 主模型或 images.describe(与视觉消费方一致,不要求 domInspect)。
 */
/** blob → dataUri(跨环境:FileReader 优先,降级 arrayBuffer+btoa 分块;node/browser 均可) */
export async function blobToDataUri(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error('FileReader 读取失败'))
      fr.readAsDataURL(blob)
    })
  }
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192))
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`
}

export function createViewImageTool(deps: Pick<ScreenshotToolDeps, 'getVision' | 'describe' | 'onShot'> & {
  /** 客户端图片抓取(默认全局 fetch;测试注入桩保密闭性)。返回 Response 同形或 null(失败/不支持) */
  clientFetch?: (url: string) => Promise<Response | null>
}) {
  const doFetch = deps.clientFetch ?? (async (url: string) => {
    try { return await fetch(url, { mode: 'cors' }) } catch { return null }
  })
  return tool(
    async (args: { url: string }) => {
      const url = String(args?.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) {
        return 'ERROR: view_image 只接受 http(s) 图片 URL(如 read 到的 props.image / slides[n].image)。本地文件/base64 不收(用户贴图走输入通道);要看渲染后的组件用 take_screenshot。'
      }
      // 客户端优先物化(2026-09-20,deepseek 真机 400 驱动:「Failed to download image from <url>」——
      // 模型服务端拉图会失败〔上游限流对服务商出口/热链保护等〕;浏览器侧同源 CORS 全开时先抓成 dataUri,
      // 供应商无需再下载。物化失败(无 CORS/网络)才回退 URL 直投,由服务端再试)
      let dataUri: string | undefined
      try {
        const resp = await doFetch(url)
        if (resp?.ok) {
          const blob = await resp.blob()
          if (blob.size > 0 && blob.size <= 20 * 1024 * 1024 && String(blob.type).startsWith('image/')) {
            dataUri = await blobToDataUri(blob)
          }
        }
      } catch { /* 物化失败 → URL 直投兜底 */ }
      const image: AgentImage = { id: `viewimg-${Date.now().toString(36)}`, url, name: 'view_image', ...(dataUri ? { dataUri } : {}) }
      const deliverNote = dataUri ? '已客户端物化为 dataUri(供应商无需下载)' : 'URL 直投(客户端物化不可用,由模型服务端拉图;若供应商下载失败会报错,届时改用 take_screenshot)'
      if (deps.getVision()) {
        deps.onShot?.(image, { mode: 'url' })
        return `已请求查看图片(${deliverNote}):${url}。注意:看到的是图片本身(全分辨率),不是页面渲染态;若要对比页面叠加文案/布局,另用 take_screenshot。`
      }
      if (!deps.describe) {
        return 'ERROR: 主模型不支持图片(vision=false)且未配置 images.describe,无法查看图片。请换多模态模型 / llm.vision:true / 配置 images.describe。'
      }
      try {
        const description = await deps.describe(image, { text: `查看图片:${url}` })
        return `图片转述(${url}):${description}`
      } catch (e) {
        return `ERROR: 图片转述失败(${e instanceof Error ? e.message : String(e)});可换 take_screenshot 看渲染区域。`
      }
    },
    {
      name: 'view_image',
      description: '查看一张图片 URL 的内容(页面数据里读到的图:轮播某一帧/商品图/封面等)。优先客户端物化直投(全分辨率原图,非截图渲染);问「第 N 张图/这张图画的是啥」且手里有该图 URL 时优先用它,不要截当前渲染帧(自动轮播可能已切到别的帧)。若供应商下载 URL 失败(报 Failed to download image),改用 take_screenshot 看渲染区域。参数 url 须为 http(s)。',
      schema: z.object({ url: z.string().min(8).describe('图片的 http(s) URL(来自 read 结果,如 slides[0].image)') }),
    },
  )
}
