/**
 * 图片输入(image-input-vision Phase 1)—— 纯函数域自测:
 * content parts 双协议组装 / dataURI 解析 / 等比缩放 / 轻形态与重水化 / modelCaps.vision 表驱动 / vfs 引用保护扩展。
 * 浏览器域(compressImage/makeThumb 依赖 canvas)由 browser e2e 覆盖,此处不触。
 */
import {
  parseDataUri,
  computeTargetSize,
  buildImageContentParts,
  appendImageDescriptions,
  lightenImage,
  lightenMessages,
  hydrateImages,
  IMAGE_ONLY_PLACEHOLDER,
  MAX_IMAGES_PER_ROUND,
  ImageInputError,
} from '../../tools/imageInput'
import { resolveModelCaps } from '../../utils/modelCaps'
import { extractVfsRefs } from '../../utils/vfsGc'
import type { AgentMessage, AgentImage } from '../../types'
import type { TestCtx } from './_ctx'

const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
const JPG_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRg'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[图片输入 · parseDataUri / computeTargetSize]')
  {
    const p = parseDataUri(PNG_URI)
    assert(p?.mimeType === 'image/png' && p?.data === 'iVBORw0KGgoAAAANSUhEUg', 'parseDataUri → mimeType + base64 数据')
    assert(parseDataUri('https://example.com/a.png') === null, 'parseDataUri 非 dataURI(http URL)→ null')
    assert(parseDataUri('') === null && parseDataUri(undefined as unknown as string) === null, 'parseDataUri 空/缺省 → null')
    // 等比缩放:长边压到 1568,不放大
    const big = computeTargetSize(3000, 1500, 1568)
    assert(big.width === 1568 && big.height === 784, 'computeTargetSize 大图 → 长边 1568 等比缩放(3000×1500 → 1568×784)')
    const small = computeTargetSize(800, 600, 1568)
    assert(small.width === 800 && small.height === 600, 'computeTargetSize 小图 → 不放大(保持原尺寸)')
    assert(IMAGE_ONLY_PLACEHOLDER === '[image]', '纯图消息占位符恒定(多模态 API text part 非空要求)')
    assert(MAX_IMAGES_PER_ROUND === 4, '单轮图片上限 = 4')
  }

  console.log('\n[图片输入 · buildImageContentParts 双协议]')
  {
    const imgs = [{ dataUri: PNG_URI }, { dataUri: JPG_URI }]
    // openai 格式:text part + image_url parts(dataURI 直发)
    const oa = buildImageContentParts('看这张图', imgs, 'openai')!
    assert(oa.length === 3 && (oa[0] as any).type === 'text' && (oa[0] as any).text === '看这张图', 'openai parts → 首 text part 带原文')
    assert((oa[1] as any).type === 'image_url' && (oa[1] as any).image_url.url === PNG_URI, 'openai parts → image_url.dataURI')
    // anthropic 格式:base64 source 块(mimeType + data 剥离)
    const an = buildImageContentParts('看这张图', imgs, 'anthropic')!
    assert(an.length === 3 && (an[1] as any).type === 'image', 'anthropic parts → image block')
    assert((an[1] as any).source.type === 'base64' && (an[1] as any).source.media_type === 'image/png', 'anthropic parts → source.base64 + media_type')
    assert((an[1] as any).source.data === 'iVBORw0KGgoAAAANSUhEUg', 'anthropic parts → data 剥离出 base64')
    // URL 形态(集成方 images.upload 后):openai image_url.url;anthropic source.type='url'
    const urlImgs = [{ url: 'https://oss.example.com/a.png' }]
    const oaUrl = buildImageContentParts('q', urlImgs, 'openai')!
    assert((oaUrl[1] as any).image_url.url === 'https://oss.example.com/a.png', 'URL 形态 openai → image_url.url(不内联)')
    const anUrl = buildImageContentParts('q', urlImgs, 'anthropic')!
    assert((anUrl[1] as any).source.type === 'url' && (anUrl[1] as any).source.url === 'https://oss.example.com/a.png', 'URL 形态 anthropic → source.type=url')
    // dataUri 优先于 url(upload 失败回退内联时二者并存)
    const both = buildImageContentParts('q', [{ dataUri: PNG_URI, url: 'https://x/y.png' }], 'openai')!
    assert((both[1] as any).image_url.url === PNG_URI, 'dataUri 与 url 并存 → dataUri 优先(内存内联)')
    // 无有效图 → null(调用方走纯文本路径,零行为变化)
    assert(buildImageContentParts('t', [], 'openai') === null, '无图 → null(纯文本路径)')
    assert(buildImageContentParts('t', [{ id: 'x' } as AgentImage], 'openai') === null, '图缺 dataUri/url → null')
  }

  console.log('\n[图片输入 · appendImageDescriptions 转述注入]')
  {
    const withDesc = [{ description: '一张青岛啤酒节的宣传海报' }, {}]
    const out = appendImageDescriptions('还原这个页面', withDesc as AgentImage[])
    assert(out.startsWith('还原这个页面\n\n') && out.includes('[图片 1 描述]\n一张青岛啤酒节的宣传海报'), '转述注入 → content 附加 [图片 N 描述] 段')
    assert(!out.includes('[图片 2 描述]'), '转述注入 → 无 description 的图不产段')
    assert(appendImageDescriptions('原文', undefined) === '原文', '无 images → 原样返回')
    assert(appendImageDescriptions('原文', []) === '原文', '空 images → 原样返回')
    assert(appendImageDescriptions('原文', [{ id: 'a' }]) === '原文', '全部无 description → 原样返回')
  }

  console.log('\n[图片输入 · 轻形态持久化 / 恢复重水化]')
  {
    const im: AgentImage = { id: 'img_1', dataUri: PNG_URI, name: 'a.png', thumb: 'data:image/jpeg;base64,thumb', vfsRef: 'userImages/img_1' }
    const light = lightenImage(im)
    assert(light.dataUri === undefined && light.thumb === 'data:image/jpeg;base64,thumb' && light.vfsRef === 'userImages/img_1', 'lightenImage → 剥 dataUri,留 thumb+vfsRef')
    assert(light.url === undefined && light.description === undefined && light.name === 'a.png', 'lightenImage → url/description/name 轻字段保留')
    // url 型:同样剥 dataUri,轻形态可完整恢复
    const urlLight = lightenImage({ id: 'img_2', dataUri: PNG_URI, url: 'https://oss/a.png', description: 'desc' })
    assert(urlLight.url === 'https://oss/a.png' && urlLight.description === 'desc' && urlLight.dataUri === undefined, 'lightenImage url 型 → url/description 保留')
    // lightenMessages:浅拷贝不动原数组/原消息(同 compressInput 契约)
    const original: AgentMessage[] = [{ role: 'user', content: 'hi', timestamp: 1, images: [im] }]
    const lightMsgs = lightenMessages(original)
    assert(lightMsgs !== original && lightMsgs[0] !== original[0], 'lightenMessages → 浅拷贝(原数组/原消息不动)')
    assert((lightMsgs[0].images![0] as AgentImage).dataUri === undefined, 'lightenMessages → 消息 images 轻形态')
    assert(original[0].images![0].dataUri === PNG_URI, 'lightenMessages → 原消息 dataUri 保留(会话内直发不受影响)')
    const noImg: AgentMessage[] = [{ role: 'assistant', content: 'ok', timestamp: 2 }]
    assert(lightenMessages(noImg)[0] === noImg[0], 'lightenMessages → 无图消息同引用直过(零拷贝)')
    // hydrateImages:vfs 取回补 dataUri;url 型无需;取不回保留轻形态
    const restored = hydrateImages(lightMsgs, (ref) => (ref === 'userImages/img_1' ? PNG_URI : undefined))
    assert((restored[0].images![0] as AgentImage).dataUri === PNG_URI, 'hydrateImages → vfs 命中重水化 dataUri')
    const missed = hydrateImages(lightMsgs, () => undefined)
    assert((missed[0].images![0] as AgentImage).dataUri === undefined, 'hydrateImages → vfs 未命中(LRU 淘汰)保留轻形态不崩')
    const urlMsgs: AgentMessage[] = [{ role: 'user', content: 'hi', timestamp: 3, images: [{ id: 'i', url: 'https://oss/a.png' }] }]
    const urlRestored = hydrateImages(urlMsgs, () => undefined)
    assert((urlRestored[0].images![0] as AgentImage).dataUri === undefined && (urlRestored[0].images![0] as AgentImage).url === 'https://oss/a.png', 'hydrateImages → url 型无需水化直过')
  }

  console.log('\n[图片输入 · modelCaps.vision 表驱动]')
  {
    // 表命中:true 系
    assert(resolveModelCaps({ model: 'gpt-4o' }).vision === true, 'vision 表 → gpt-4o true')
    assert(resolveModelCaps({ model: 'gpt-4o-mini-2024-07-18' }).vision === true, 'vision 表 → gpt-4o-mini 变体 true')
    assert(resolveModelCaps({ model: 'claude-3-5-sonnet-20240620' }).vision === true, 'vision 表 → claude-3-5 true')
    assert(resolveModelCaps({ model: 'qwen-vl-max' }).vision === true, 'vision 表 → qwen-vl true')
    assert(resolveModelCaps({ model: 'glm-4v-flash' }).vision === true, 'vision 表 → glm-4v true(longest-match 压过 glm-4)')
    // gpt-5 表条目(2026-08 网关模型面补):缺条目会落 DEFAULT_CAPS 32K → 撞 MIN_CONTEXT_WINDOW 200K 闸拒构造
    const gpt5 = resolveModelCaps({ model: 'gpt-5' })
    assert(gpt5.contextWindow === 1048576 && gpt5.vision === true, '模型表 → gpt-5 命中(1M 窗口,过 200K 最小闸)')
    assert(resolveModelCaps({ model: 'gpt-5-mini' }).contextWindow === 1048576, '模型表 → gpt-5-mini 变体同条目')
    // 表命中:false 系(保守)
    assert(resolveModelCaps({ model: 'deepseek-v4' }).vision === false, 'vision 表 → deepseek false')
    assert(resolveModelCaps({ model: 'glm-5.2' }).vision === false, 'vision 表 → glm-5 false')
    assert(resolveModelCaps({ model: 'kimi-k2' }).vision === false, 'vision 表 → kimi false')
    // 未命中:保守 false(宁走旁路/报错,不误发 parts 吃 400)
    assert(resolveModelCaps({ model: 'my-gateway-proxy-model' }).vision === false, 'vision 未命中 → 保守 false')
    assert(resolveModelCaps({}).vision === false, 'vision 无 model → 保守 false')
    // 显式覆盖:双向(网关代理模型名不可辨时)
    assert(resolveModelCaps({ model: 'my-gateway-proxy-model', vision: true }).vision === true, 'vision 显式 true → 覆盖表与缺省')
    assert(resolveModelCaps({ model: 'gpt-4o', vision: false }).vision === false, 'vision 显式 false → 覆盖表(关掉误判)')
  }

  console.log('\n[图片输入 · vfs 引用保护扩展]')
  {
    const msgs: AgentMessage[] = [
      { role: 'user', content: '看图', timestamp: 1, images: [{ id: 'a', vfsRef: 'userImages/a' }, { id: 'b', url: 'https://oss/b.png' }] },
      { role: 'assistant', content: 'vfs_read({ path: "large_results/read-abc123.txt" })', timestamp: 2 },
    ]
    const refs = extractVfsRefs(msgs)
    assert(refs.has('userImages/a'), 'extractVfsRefs → images[].vfsRef 进保护集(LRU 淘汰保护)')
    assert(refs.has('large_results/read-abc123.txt'), 'extractVfsRefs → 文本 large_results 引用照旧')
    assert(!refs.has('https://oss/b.png') && refs.size === 2, 'extractVfsRefs → url 型/无 ref 不进集')
  }

  console.log('\n[图片输入 · ImageInputError 结构化错误]')
  {
    const e = new ImageInputError('IMAGE_TOO_LARGE', '图片超过 20MB 上限')
    assert(e instanceof Error && e.code === 'IMAGE_TOO_LARGE', 'ImageInputError → code 稳定(输入侧 i18n 分发锚)')
  }
}
