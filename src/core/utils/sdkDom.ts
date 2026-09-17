/**
 * SDK 自身 UI 面的 DOM 判定(page-quote / read_page 共用)。
 *
 * SDK 对话框以 light DOM 挂进宿主页(无 shadow/iframe),DebugDrawer/SkillPanel 经 Teleport
 * 直挂 body —— 任何「宿主页面内容」的读取(划词引用 / read_page 正文提取)都必须把这些子树
 * 排除,否则会把「输入消息,Enter 发送」之类 SDK 文案当页面正文。选择器必须列全 Teleport 面,
 * 新增 body 级浮层组件时同步维护此处。
 */

/** SDK UI 子树选择器(对话框本体 + 遮罩 + body 级 Teleport 浮层〔debug/skill/划词浮动菜单〕) */
export const SDK_UI_SELECTOR = '.chat-dialog, .chat-mask, .debug-drawer, .skill-mask, .skill-panel, .chat-selection-menu'

/** 元素是否在 SDK 自身 UI 子树内(不在宿主内容区) */
export function isInsideSdkUi(el: Element | null | undefined): boolean {
  if (!el) return false
  try {
    return el.closest?.(SDK_UI_SELECTOR) != null
  } catch {
    // closest 遇非法选择器理论不抛;假 DOM(duck-typing 测试桩)无 closest 时按「外部」处理
    return false
  }
}
