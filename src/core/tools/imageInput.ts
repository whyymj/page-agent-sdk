/**
 * 图片输入(image-input-vision Phase 1)—— 压缩闸 + 多模态 content parts 组装。
 *
 * 纯函数域(parseDataUri / buildImageContentParts / computeTargetSize / lightenImage 持久化轻形态)
 * + 浏览器域(compressImage / makeThumb,依赖 canvas;selftest 只跑纯函数,browser e2e 覆盖浏览器行为)。
 *
 * 设计要点(design.md D1/D2/D6):
 * - dataURI 内联,不引入 URL/上传服务(SDK 零后端假设;体积由压缩闸控制)
 * - 持久化:消息里只存 {id, thumb≤8KB, vfsRef},原图进 vfs userImages/* 池(随 vfs kind 落盘 + LRU)
 * - 诚实语义:图损坏/压缩失败/超限 → 抛结构化错误(输入侧拒绝),不静默丢图
 */
import type { AgentImage } from '../types'

/** 原始文件体积硬闸(>20MB 直接拒,防粘贴大图卡 UI) */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 压缩目标:长边上限(多模态 API 主流推荐档,qwen-vl/gpt-4o 视觉细粒度性价比点) */
export const MAX_IMAGE_EDGE = 1568
/** JPEG 压缩质量 */
export const JPEG_QUALITY = 0.85
/** 单轮图片数上限(防 base64 撑爆请求体) */
export const MAX_IMAGES_PER_ROUND = 4
/** 持久化缩略图长边(配 JPEG q0.7 ≈ ≤8KB,满足快照轻形态预算) */
export const THUMB_EDGE = 96
/** 纯图消息的文本占位(多模态 API 的 text part 要求非空;语言中立) */
export const IMAGE_ONLY_PLACEHOLDER = '[image]'

/** 图片输入错误(code 稳定,UI/i18n 可按键分发) */
export class ImageInputError extends Error {
  code: 'IMAGE_TOO_LARGE' | 'IMAGE_COUNT_LIMIT' | 'IMAGE_DECODE_FAILED' | 'IMAGE_COMPRESS_FAILED' | 'IMAGE_UNSUPPORTED_TYPE'
  constructor(code: ImageInputError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** 生成图片 id(消息内唯一;vfs 路径/持久化引用都以它为锚) */
export function genImageId(): string {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 解析 dataURI → { mimeType, base64 };非 dataURI 形态返 null(纯函数,selftest 覆盖) */
export function parseDataUri(dataUri: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(dataUri ?? '')
  if (!m) return null
  return { mimeType: m[1], data: m[2] }
}

/** 等比缩放目标尺寸(长边 ≤ maxEdge;不放大 —— 小图保持原样,纯函数) */
export function computeTargetSize(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * 组装多模态 content parts(纯函数,selftest 双协议断言)。
 * 图源优先 dataUri(内存内联),无则 url(集成方 images.upload 上传后的 URL 形态)。
 * - openai(兼容 DeepSeek/qwen-vl 等):[{type:'text'},{type:'image_url', image_url:{url}}](dataURI 或 https URL 均可)
 * - anthropic:[{type:'text'},{type:'image', source:{type:'base64',...}}];URL 形态走 source:{type:'url'}(Messages API url source)
 * 无有效图(全缺 dataUri/url)返 null(调用方走纯文本路径,零行为变化)。
 */
export function buildImageContentParts(
  text: string,
  images: Array<Pick<AgentImage, 'dataUri' | 'url'>>,
  format: 'openai' | 'anthropic' = 'openai',
): Array<Record<string, unknown>> | null {
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: text ?? '' }]
  for (const im of images) {
    if (im.dataUri) {
      if (format === 'anthropic') {
        const parsed = parseDataUri(im.dataUri)
        if (!parsed) continue // 非 base64 dataURI:走下方 url 分支兜底
        parts.push({ type: 'image', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.data } })
      } else {
        parts.push({ type: 'image_url', image_url: { url: im.dataUri } })
      }
    } else if (im.url) {
      parts.push(
        format === 'anthropic'
          ? { type: 'image', source: { type: 'url', url: im.url } }
          : { type: 'image_url', image_url: { url: im.url } },
      )
    }
  }
  return parts.length > 1 ? parts : null
}

/**
 * 非多模态主模型的转述注入(纯函数):把 images[].description 拼接为 content 附加段。
 * toLC 组装时调用(不改原消息,运行时拼);无任何 description 返回原 content。
 */
export function appendImageDescriptions(content: string, images: Array<Pick<AgentImage, 'description'>> | undefined): string {
  const descs = (images ?? []).filter((im) => im.description)
  if (!descs.length) return content
  const blocks = descs.map((im, i) => `[图片 ${i + 1} 描述]\n${im.description}`).join('\n\n')
  return `${content}\n\n${blocks}`
}

/** 持久化轻形态(纯函数):剥离 dataUri 原图,只留缩略 + vfs 引用 + url/description(快照体积护城河,design D2) */
export function lightenImage(im: AgentImage): AgentImage {
  return { id: im.id, name: im.name, thumb: im.thumb, vfsRef: im.vfsRef, url: im.url, description: im.description, width: im.width, height: im.height }
}

/** 消息数组持久化映射:有 images 的消息整体转轻形态(浅拷贝,不动原数组/原消息 —— 同 compressInput 契约) */
export function lightenMessages<T extends { images?: AgentImage[] }>(messages: T[]): T[] {
  return messages.map((m) => (m.images?.length ? ({ ...m, images: m.images.map(lightenImage) } as T) : m))
}

/** 恢复期重水化(纯函数壳):从 vfs 取回原图补 dataUri(url 型无需);取不回(已 LRU 淘汰)保留轻形态(UI 缩略图降级,诚实不崩) */
export function hydrateImages<T extends { images?: AgentImage[] }>(messages: T[], readVfs: (ref: string) => string | undefined): T[] {
  return messages.map((m) => {
    if (!m.images?.length) return m
    const images = m.images.map((im) => (im.dataUri || im.url ? im : { ...im, dataUri: readVfs(im.vfsRef ?? '') || undefined }))
    return { ...m, images } as T
  })
}

// ===== 浏览器域(canvas;selftest 不触,browser e2e 覆盖)=====

/** 透明检测:步进采样 alpha 通道(32px 步长;透明图保 png 防 jpeg 黑底) */
function hasAlphaChannel(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = 32
    const data = ctx.getImageData(0, 0, w, h).data
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] < 250) return true
      }
    }
    return false
  } catch {
    return false // 污染画布等异常:保守按无透明走 jpeg
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new ImageInputError('IMAGE_DECODE_FAILED', '图片读取失败'))
    fr.readAsDataURL(blob)
  })
}

/**
 * 压缩闸:原图 >20MB 拒;createImageBitmap + canvas 等比缩放(长边 ≤1568);
 * 含透明保 png(防 jpeg 黑底),否则 jpeg q0.85。SVG 经 Image 兜底解码(svg 图片无 bitmap 直读路径时)。
 */
export async function compressImage(source: Blob, opts: { name?: string } = {}): Promise<AgentImage> {
  if (source.size > MAX_IMAGE_BYTES) {
    throw new ImageInputError('IMAGE_TOO_LARGE', `图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
  const type = source.type || ''
  if (type && !/^image\//i.test(type)) {
    throw new ImageInputError('IMAGE_UNSUPPORTED_TYPE', `不支持的文件类型:${type}`)
  }
  const bitmap = await loadBitmap(source)
  const { width: tw, height: th } = computeTargetSize(bitmap.width, bitmap.height, MAX_IMAGE_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap as any, 0, 0, tw, th)
  if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close()
  const keepPng = (type === 'image/png' || type === 'image/gif' || type === 'image/webp') && hasAlphaChannel(ctx, tw, th)
  const dataUri = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { id: genImageId(), dataUri, name: opts.name, width: tw, height: th, bytes: Math.round((dataUri.length * 3) / 4) }
}

async function loadBitmap(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function' && source.type !== 'image/svg+xml') {
    try {
      return await createImageBitmap(source)
    } catch {
      /* 落 Image 兜底 */
    }
  }
  // SVG / createImageBitmap 不可用:经 <img> 解码(需先转 dataURI,svg blob URL 在部分浏览器绘制受限)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new ImageInputError('IMAGE_DECODE_FAILED', '图片解码失败(损坏或不支持的格式)'))
    blobToDataUri(source).then((uri) => {
      img.src = uri
    }, reject)
  })
}

/** 生成缩略图 dataURI(持久化轻形态;长边 THUMB_EDGE、jpeg q0.7) */
export async function makeThumb(dataUri: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new ImageInputError('IMAGE_DECODE_FAILED', '缩略图生成失败'))
    el.src = dataUri
  })
  const { width: tw, height: th } = computeTargetSize(img.naturalWidth || THUMB_EDGE, img.naturalHeight || THUMB_EDGE, THUMB_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  canvas.getContext('2d')!.drawImage(img, 0, 0, tw, th)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// ===== 图片发送管线(F3 2026-09-10 从 createChatSdk 抽出):stow(原图收口)+ describe 旁路 =====
import type { SdkEvent, ImagesConfig } from '../types'

export interface ImagePipelineDeps {
  getConfig: () => ImagesConfig | undefined
  /** 主模型多模态能力(vision → 直发,describe 旁路跳过) */
  getVision: () => boolean
  emit: (e: SdkEvent) => void
  getVfsStore: () => { files: Record<string, { content: string; updatedAt: number }> } | undefined
  /** 缩略图失败留痕(persist 族 notePersistFailure) */
  noteFailure: (stage: string, e: unknown) => void
}

/** 返回 { stowImages, describeIfNeeded }(send/stream 双路径共用) */
export function createImagePipeline(deps: ImagePipelineDeps) {
  /**
   * 图片原图收口(image-input-vision,send/stream 前调):
   * - 配 images.upload(集成方 OSS):缩略图 → 上传换 url → 释放 dataUri(url 即持久引用,不入 vfs;content parts 用 URL 形态)。
   *   上传失败回退 dataURI 内联(留痕不阻塞)。
   * - 未配 upload:原图入 vfs `userImages/<id>`(userFiles 池,2MB LRU;轻形态持久化引用锚)。
   * 就地补挂 im.url / im.vfsRef / im.thumb。失败留痕不阻塞 —— 会话内直发不受影响,仅丢跨刷新恢复。
   */
  async function stowImages(images: AgentImage[]): Promise<void> {
    const upload = deps.getConfig()?.upload
    for (const im of images) {
      // 三步各自独立容错:缩略图失败不带崩 upload/vfs(headless Node 无 Image 也照常收口)
      try {
        if (im.dataUri && !im.thumb) im.thumb = await makeThumb(im.dataUri)
      } catch (e) {
        deps.noteFailure('imageThumb', e)
      }
      if (upload && im.dataUri && !im.url) {
        try {
          const url = await upload(im.dataUri, im)
          if (url) {
            im.url = url
            im.dataUri = undefined // 释放内联:直发/持久化均走 url
            const vfs = deps.getVfsStore()
            if (im.vfsRef && vfs) delete vfs.files[im.vfsRef] // 上传成功撤 vfs 副本(url 已是持久引用)
          }
        } catch (e) {
          console.warn('[page-agent-sdk][images] upload 失败,回退 dataURI 内联直发:', (e as Error)?.message ?? e)
        }
      }
      const vfs = deps.getVfsStore()
      if (im.dataUri && !im.vfsRef && vfs) {
        im.vfsRef = `userImages/${im.id}`
        vfs.files[im.vfsRef] = { content: im.dataUri, updatedAt: Date.now() }
      }
    }
  }

  /**
   * 识图转述旁路(image-input-vision,集成方绑定):非多模态主模型 + 配 images.describe 时,
   * 发送前逐图调 describe(集成方识图子 agent / 自有 vision API),转述文本写 im.description
   * (toLC 拼入该轮 user 上下文,图片不直发;随消息持久化,恢复后不重复转述)。
   * 单图超时(describeTimeoutMs,默认 15s)/失败 → 占位描述 + observable VISION_DESCRIBE_FAILED,对话继续(D6 诚实降级)。
   */
  async function describeIfNeeded(images: AgentImage[], text: string): Promise<void> {
    const describe = deps.getConfig()?.describe
    if (deps.getVision() || !describe) return
    const timeoutMs = deps.getConfig()?.describeTimeoutMs ?? 15000
    for (const im of images) {
      if (im.description) continue // 已转述(重发/恢复场景)不重复
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), timeoutMs)
        try {
          im.description = (await Promise.race([
            describe(im, { text }),
            new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error(`识图转述超时(${timeoutMs}ms)`)))),
          ])).trim()
        } finally {
          clearTimeout(timer)
        }
      } catch (e) {
        im.description = '[图片描述不可用]'
        deps.emit({ type: 'error', message: `识图转述失败:${(e as Error)?.message ?? String(e)}`, severity: 'observable', code: 'VISION_DESCRIBE_FAILED' } as any)
      }
    }
  }

  return { stowImages, describeIfNeeded }
}
