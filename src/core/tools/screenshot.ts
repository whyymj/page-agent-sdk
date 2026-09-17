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

/** 默认渲染器:html-to-image toPng(pixelRatio 1 控体积;宽高覆盖用于视口/整页裁切) */
async function defaultRender(el: Element, opts: { width?: number; height?: number }): Promise<string> {
  return htmlToImage.toPng(el as HTMLElement, { width: opts.width, height: opts.height, pixelRatio: 1, cacheBust: true })
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
  onShot?: (image: AgentImage, meta: { mode: ScreenshotMode; selector?: string }) => void
  /** 渲染根元素(视口/整页模式;生产传 document.documentElement,selftest 注入) */
  getRootEl?: () => Element | null
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
      const resolved = resolveScreenshotTarget(document, typeof window !== 'undefined' ? window : {}, args)
      if (!resolved.ok) return `ERROR: ${resolved.error}`
      const rootEl = resolved.el ?? deps.getRootEl?.() ?? document.documentElement
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
        return `ERROR: 截图渲染失败(${e instanceof Error ? e.message : String(e)}).常见原因:宿主页面 CSP 禁止 SVG data URL / 跨域图片污染画布 / 元素含无法克隆的内容。建议:① 改用 selector 缩小到目标区域;② 结构验证可改用 get_dom / dom_info(rect+styles);③ 宿主可配 screenshot.renderer 自定义渲染器绕过。`
      }
      // 压缩闸:dataUri → Blob → compressImage(jpeg q0.85 ≤1568,产物含 thumb/dims/bytes)
      let image: AgentImage
      try {
        image = await compressImage(dataUriToBlob(pngDataUri), { name: `screenshot-${resolved.mode}.png` })
      } catch (e) {
        return `ERROR: 截图压缩失败(${e instanceof Error ? e.message : String(e)}),未投递。`
      }
      const vfsRef = deps.stow?.(image)
      const meta = { mode: resolved.mode, ...(args.selector ? { selector: args.selector } : {}) }
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
        `截图完成(${resolved.mode}${args.selector ? ` selector="${args.selector}"` : ''}):${image.width}x${image.height},${Math.round((image.bytes ?? 0) / 1024)}KB(jpeg 压缩后)`,
        vfsRef ? `原图已存 vfs:${vfsRef}` : 'vfs 未开启,原图仅本轮内存',
        `投递形态:${delivered}`,
      ]
      if (description) lines.push(`识图转述:${description}`)
      return lines.join('\n')
    },
    {
      name: 'take_screenshot',
      description:
        '截取当前页面图像查看(视觉验证:布局/样式/渲染效果)。selector 截取指定元素区域;fullPage 截整页(超长文档会被拒,改用 selector 分段);都不传截当前视口。只读;截图经压缩后投递(多模态主模型直看图,纯文本模型自动走识图转述)。',
      schema: z.object({
        selector: z.string().optional().describe('CSS 选择器:截取该元素区域(先用 dom_search 定位更稳)'),
        fullPage: z.boolean().optional().describe('截取整个页面(默认 false = 当前视口)'),
      }),
    },
  )
}
