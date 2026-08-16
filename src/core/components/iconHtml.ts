/**
 * 图标值的 HTML 形态支持(dialog.icons 值以 '<' 开头 → 识别为内联 HTML 片段:svg/img/i 等)。
 *
 * 不裸 v-html:经 DOMPurify **图标专用白名单**净化(只放行形状/图像标签与几何/描边属性,
 * 剥 onerror 等事件属性与 javascript: 协议),集成方传错/传入污染字符串也不会执行脚本。
 * 纯文本值(不以 '<' 开头)不走此路径,按文本插值渲染(与 3.17 行为一致)。
 * dompurify 随主包打包(markdown 已用),本模块仅被 UI 组件引用 → headless 子路径不可达。
 */
import DOMPurify from 'dompurify'

/** 是否按 HTML 片段处理(首非空白字符为 '<' 即认定;文本值含 '<' 的场景如 '<3' 极罕见,文档已约定) */
export function isIconHtml(value: string): boolean {
  return value.trimStart().startsWith('<')
}

/** 图标白名单标签:SVG 形状族 + 图片 + 少量行内语义标签(不含 script/style/a/form 等) */
export const ICON_HTML_ALLOWED_TAGS = [
  'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g',
  'img', 'i', 'em', 'b', 'span',
] as const

/** 图标白名单属性:几何/描边/变换 + 图像 src/alt + class(集成方可挂自定义类用 --cs-* 定制) */
export const ICON_HTML_ALLOWED_ATTR = [
  'viewBox', 'xmlns', 'width', 'height',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'stroke-dasharray',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity', 'clip-rule',
  'src', 'alt', 'class', 'aria-hidden',
] as const

/** HTML 图标净化(DOMPurify 图标白名单;data-* 关闭,事件属性/危险协议默认剥) */
export function sanitizeIconHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ICON_HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...ICON_HTML_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
  })
}
