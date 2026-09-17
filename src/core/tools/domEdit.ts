/**
 * DOM 编辑工具族(dom-edit)—— agent 对宿主页面做受控的标注/内容/结构操作
 *
 * 定位(与数据写通道正交):4.15/4.16 开出「宿主页面伴随」场景族(文档站等无 data.bind 的页面),
 * 页面本身就是操作对象。数据驱动场景仍应改数据(渲染自动更新)—— 本工具不替代 write。
 *
 * 安全模型(对齐 SDK 写通道 DNA,但无 schema 可依 —— 页面非结构化数据,快照栈是安全网):
 *  - 唯一匹配纪律:写类 selector 必须 querySelectorAll 恰好命中 1 个(多匹配拒,引导更精确 selector;
 *    get_dom「取第一个」的读语义不适用于写)
 *  - 原子批量:先解析全部 patches(任一 selector 未命中/校验失败 → 整批拒绝,零部分应用),再顺序应用
 *  - 自动快照:应用前给受影响根打 `data-pg-snap` 标记并记 outerHTML,dom_restore 按批逆序回滚(≤20 批 LRU)
 *  - SDK UI 保护:目标落在 SDK 自身 DOM(SDK_UI_SELECTOR)内 → 拒(防 agent 改坏自己的对话框)
 *  - 危险内容闸:insert/replace 拒 `script` 标签、`javascript:` URL、`on*` 事件属性(防无意脚本执行;
 *    非安全沙箱 —— LLM 信任模型与数据面等同,闸只防页面稳定性事故)
 *  - dryRun:只解析报告计划操作,不落地
 *
 * 框架宿主注意(v1 明示边界):Vue/React 管理的区域重渲染会洗掉/冲突外部 DOM 改动;面向静态/内容页
 * (文档站)或集成方确认目标区域非框架管理时使用。改动为会话内临时态(刷新即失,不持久化)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { isInsideSdkUi } from '../utils/sdkDom'

/** 快照标记属性(打在受影响根元素上;restore 按 id 找回替换,元素被祖先整体替换时报 STALE) */
const SNAP_ATTR = 'data-pg-snap'
/** 快照栈上限(批粒度 LRU;每批含若干根的 outerHTML,256KB/根上限防巨树快照爆内存) */
const MAX_SNAPSHOT_BATCHES = 20
const MAX_SNAPSHOT_BYTES = 256 * 1024

/** insert/move 的相对位置(replace = 换掉 anchor 本身) */
const POSITION_ENUM = z.enum(['before', 'after', 'prepend', 'append', 'replace'])

/** 危险标签(insert/replace 拒):script = 可执行;link/meta/iframe = 页面行为面,v1 收敛 */
const DENY_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'])
/** 危险属性名(所有写 attr 路径拒):on* 事件 = 内联脚本;javascript: URL 在值校验里拦 */
const DENY_ATTR_NAME_RE = /^on\w+$/i
/** URL 型属性值拒 javascript:/vbscript: 前缀(大小写/空白容忍) */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data'])
function isDangerousUrl(value: string): boolean {
  return /^\s*(javascript|vbscript)\s*:/i.test(value)
}

/** 属性名校验(on* 拒;返回错误文案或 null) */
function checkAttrName(name: string): string | null {
  if (!name || !/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name)) return `非法属性名 "${name}"`
  if (DENY_ATTR_NAME_RE.test(name)) return `事件属性 ${name} 被拒(on* 内联脚本防误执行)`
  return null
}

/** insert/replace 的构建参数校验(标签/属性/URL 三闸;返回错误数组) */
function checkCreatedNode(tag: string, attrs: Record<string, string> | undefined): string[] {
  const errs: string[] = []
  if (DENY_TAGS.has(tag.toLowerCase())) errs.push(`标签 <${tag}> 被拒(可执行/页面行为面;文档标注场景请用常规内容标签)`)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const e = checkAttrName(k)
    if (e) errs.push(e)
    else if (URL_ATTRS.has(k.toLowerCase()) && isDangerousUrl(String(v))) errs.push(`${k} 的 javascript:/vbscript: 协议被拒`)
  }
  return errs
}

/** patches zod schema(对外工具入参;逐 op 判别联合) */
export const domPatchSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_text'), selector: z.string().min(1), text: z.string() }),
  z.object({ op: z.literal('set_html'), selector: z.string().min(1), html: z.string() }),
  z.object({ op: z.literal('set_attr'), selector: z.string().min(1), name: z.string().min(1), value: z.string() }),
  z.object({ op: z.literal('remove_attr'), selector: z.string().min(1), name: z.string().min(1) }),
  z.object({ op: z.literal('add_class'), selector: z.string().min(1), classes: z.string().min(1).describe('空格分隔') }),
  z.object({ op: z.literal('remove_class'), selector: z.string().min(1), classes: z.string().min(1).describe('空格分隔') }),
  z.object({ op: z.literal('set_style'), selector: z.string().min(1), style: z.record(z.string(), z.string()).describe('CSS 属性 → 值') }),
  z.object({
    op: z.literal('insert'), anchor: z.string().min(1).describe('锚元素 selector'),
    position: POSITION_ENUM.describe('before/after = 锚前后兄弟;prepend/append = 锚首尾子;replace = 换掉锚本身'),
    tag: z.string().min(1).describe('新元素标签名,如 div/span/mark'), attrs: z.record(z.string(), z.string()).optional(),
    text: z.string().optional(), html: z.string().optional(),
  }),
  z.object({ op: z.literal('remove'), selector: z.string().min(1) }),
  z.object({
    op: z.literal('move'), selector: z.string().min(1).describe('要移动的元素'),
    to: z.string().min(1).describe('目标父容器 selector'), position: z.enum(['prepend', 'append', 'before', 'after']).describe('并入 to 的方式'),
  }),
  z.object({
    op: z.literal('highlight'), selector: z.string().min(1), color: z.string().optional().describe('高亮色(默认黄 #fef08a)'),
    scroll: z.boolean().optional().describe('滚动到可视区(默认 true)'), note: z.string().optional().describe('可选浮注文案'),
  }),
])
export type DomPatch = z.infer<typeof domPatchSchema>

/**
 * 纯校验(可单测):patches 静态危险闸 + 形态校验,返回错误列表(空 = 通过)。
 * 不做 selector 解析(那需要真实 DOM,留给工具体内的解析阶段)。
 */
export function validateDomPatches(patches: DomPatch[]): string[] {
  const errs: string[] = []
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]
    const at = `patches[${i}](${p.op})`
    if (p.op === 'set_attr') {
      const e = checkAttrName(p.name)
      if (e) errs.push(`${at}: ${e}`)
      else if (URL_ATTRS.has(p.name.toLowerCase()) && isDangerousUrl(p.value)) errs.push(`${at}: ${p.name} 的 javascript:/vbscript: 协议被拒`)
    }
    if (p.op === 'insert') {
      errs.push(...checkCreatedNode(p.tag, p.attrs).map((e) => `${at}: ${e}`))
      if (p.text !== undefined && p.html !== undefined) errs.push(`${at}: text 与 html 二选一`)
    }
    if (p.op === 'highlight' && p.color && !/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/.test(p.color)) errs.push(`${at}: color 仅接受 hex 或颜色名`)
  }
  return errs
}

/** 一批快照(逆序回滚单元) */
interface SnapBatch { snips: Array<{ id: string; html: string }>; ops: string[] }

/** 最小元素面(dom_edit 交互所需;测试 fake 实现同面) */
type DomLike = Document

/**
 * 工具族工厂:返回 [dom_edit, dom_restore]。
 * deps.getDocument 可注入(node e2e fake DOM);缺省用 globalThis.document。
 * deps.onEdit 留痕回调(createChatSdk 侧 push debugLogs)。
 */
export function createDomEditTools(deps: { getDocument?: () => Document | null | undefined; onEdit?: (info: { ops: string[]; applied: number; dryRun: boolean }) => void } = {}) {
  const batches: SnapBatch[] = []
  let snapSeq = 0

  const getDoc = (): DomLike | null => deps.getDocument?.() ?? (typeof document !== 'undefined' ? document : null)
  /** 唯一匹配解析(写纪律:querySelectorAll 恰 1;0 → 未命中,>1 → 拒并引导) */
  const resolveUnique = (doc: DomLike, sel: string, label: string): { el: Element } | { err: string } => {
    let list: Element[] = []
    try { list = Array.from(doc.querySelectorAll(sel)) } catch { return { err: `${label}: selector 语法错误 "${sel}"` } }
    if (!list.length) return { err: `${label}: 未命中任何元素(selector="${sel}")。先用 get_dom/dom_search 定位,再写更精确的 selector` }
    if (list.length > 1) return { err: `${label}: selector 命中 ${list.length} 个元素,写操作要求唯一匹配。加层级/属性约束收窄(如 "${sel}:first-child" 不行就用索引路径或唯一 class)` }
    return { el: list[0] }
  }
  const guardSdkUi = (el: Element): string | null =>
    isInsideSdkUi(el) ? '目标元素位于 SDK 对话框自身 DOM 内,写操作被拒(防 agent 改坏自己的 UI)。请操作宿主页面内容区域' : null

  /** 打标记 + 记快照(单根;超 256KB 拒 —— 引导缩小范围) */
  const snapRoot = (root: Element | null, snips: Array<{ id: string; html: string }>): string | null => {
    if (!root) return null
    const html = root.outerHTML
    if (html.length > MAX_SNAPSHOT_BYTES) return `快照超限:受影响子树 ${(html.length / 1024).toFixed(0)}KB > ${MAX_SNAPSHOT_BYTES / 1024}KB。缩小 selector 到更深的子树再改(快照是回滚安全网,巨树快照爆内存)`
    let id = root.getAttribute?.(SNAP_ATTR) ?? ''
    if (!id) { id = `pg${++snapSeq}`; root.setAttribute?.(SNAP_ATTR, id) }
    // 同批同根只记首态(后续 op 叠加在同根上,回滚到批前即可)
    if (!snips.some((s) => s.id === id)) snips.push({ id, html })
    return null
  }

  const applyPatch = (doc: DomLike, p: DomPatch, snips: Array<{ id: string; html: string }>): string | null => {
    switch (p.op) {
      case 'set_text': case 'set_html': case 'set_attr': case 'remove_attr':
      case 'add_class': case 'remove_class': case 'set_style': case 'highlight': {
        const r = resolveUnique(doc, p.selector, `${p.op} selector`)
        if ('err' in r) return r.err
        const ui = guardSdkUi(r.el)
        if (ui) return ui
        const snapErr = snapRoot(r.el, snips)
        if (snapErr) return snapErr
        switch (p.op) {
          case 'set_text': r.el.textContent = p.text; break
          case 'set_html': r.el.innerHTML = p.html; break
          case 'set_attr': r.el.setAttribute(p.name, p.value); break
          case 'remove_attr': r.el.removeAttribute(p.name); break
          case 'add_class': r.el.classList?.add(...p.classes.split(/\s+/).filter(Boolean)); break
          case 'remove_class': r.el.classList?.remove(...p.classes.split(/\s+/).filter(Boolean)); break
          case 'set_style': {
            const st = (r.el as HTMLElement).style
            for (const [k, v] of Object.entries(p.style)) (st as unknown as Record<string, string>)[k] = v
            break
          }
          case 'highlight': {
            const color = p.color ?? '#fef08a'
            const st = (r.el as HTMLElement).style
            ;(st as unknown as Record<string, string>).backgroundColor = color
            ;(st as unknown as Record<string, string>).outline = '2px solid rgba(59,130,246,.85)'
            if (p.note) r.el.setAttribute('title', p.note)
            if (p.scroll !== false) (r.el as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'center' })
            break
          }
        }
        return null
      }
      case 'insert': {
        const r = resolveUnique(doc, p.anchor, 'insert anchor')
        if ('err' in r) return r.err
        const anchor = r.el
        const ui = guardSdkUi(anchor) ?? (p.position === 'replace' ? null : guardSdkUi(anchor.parentElement ?? anchor))
        if (ui) return ui
        const container = p.position === 'prepend' || p.position === 'append' ? anchor : anchor.parentElement
        const snapErr = snapRoot(container ?? anchor, snips)
        if (snapErr) return snapErr
        const el = doc.createElement(p.tag)
        for (const [k, v] of Object.entries(p.attrs ?? {})) el.setAttribute(k, v)
        if (p.html !== undefined) el.innerHTML = p.html
        else if (p.text !== undefined) el.textContent = p.text
        if (p.position === 'prepend') anchor.prepend(el)
        else if (p.position === 'append') anchor.appendChild(el)
        else if (p.position === 'before') (anchor.parentElement ?? anchor).insertBefore(el, anchor)
        else if (p.position === 'after') (anchor.parentElement ?? anchor).insertBefore(el, anchor.nextSibling)
        else anchor.replaceWith(el)
        return null
      }
      case 'remove': {
        const r = resolveUnique(doc, p.selector, 'remove selector')
        if ('err' in r) return r.err
        const ui = guardSdkUi(r.el)
        if (ui) return ui
        if (!r.el.parentElement) return 'remove: 目标无父容器(根元素不可删)'
        const snapErr = snapRoot(r.el.parentElement, snips)
        if (snapErr) return snapErr
        r.el.remove()
        return null
      }
      case 'move': {
        const r = resolveUnique(doc, p.selector, 'move selector')
        if ('err' in r) return r.err
        const t = resolveUnique(doc, p.to, 'move to')
        if ('err' in t) return t.err
        const ui = guardSdkUi(r.el) ?? guardSdkUi(t.el)
        if (ui) return ui
        if (r.el.contains(t.el)) return 'move: 不能把元素移进它自己的子孙(循环结构)'
        const oldParent = r.el.parentElement
        if (!oldParent) return 'move: 目标无父容器'
        const snapA = snapRoot(oldParent, snips); if (snapA) return snapA
        const snapB = snapRoot(p.position === 'prepend' || p.position === 'append' ? t.el : t.el.parentElement ?? t.el, snips)
        if (snapB) return snapB
        if (p.position === 'prepend') t.el.prepend(r.el)
        else if (p.position === 'append') t.el.appendChild(r.el)
        else if (p.position === 'before') (t.el.parentElement ?? t.el).insertBefore(r.el, t.el)
        else (t.el.parentElement ?? t.el).insertBefore(r.el, t.el.nextSibling)
        return null
      }
    }
  }

  const domEditTool = tool(
    async ({ patches, dryRun }) => {
      const doc = getDoc()
      if (!doc) return 'ERROR: dom_edit 仅在浏览器环境可用(当前运行在 node/服务端,无 DOM)。改数据请用 write 工具。'
      if (!patches?.length) return 'ERROR: patches 不能为空。支持 op:set_text/set_html/set_attr/remove_attr/add_class/remove_class/set_style/insert/remove/move/highlight'
      // ① 静态校验(危险闸;不碰 DOM)
      const errs = validateDomPatches(patches)
      if (errs.length) return `ERROR: 校验失败(整批拒绝,零改动):\n- ${errs.join('\n- ')}`
      // ② 解析阶段:全部 selector 预解析(唯一匹配 + SDK UI 守卫),任一失败整批拒(原子)
      const probe = (sel: string, label: string) => {
        const r = resolveUnique(doc, sel, label)
        if ('err' in r) return r.err
        return guardSdkUi(r.el)
      }
      for (let i = 0; i < patches.length; i++) {
        const p = patches[i]
        const bad = p.op === 'insert' ? probe(p.anchor, `patches[${i}](insert) anchor`) : probe(p.selector, `patches[${i}](${p.op}) selector`)
        if (bad) return `ERROR: ${bad}\n(整批拒绝,零改动)`
        if (p.op === 'move') {
          const bad2 = probe(p.to, `patches[${i}](move) to`)
          if (bad2) return `ERROR: ${bad2}\n(整批拒绝,零改动)`
        }
      }
      const ops = patches.map((p) => (p.op === 'insert' ? `insert<${p.tag}>` : p.op))
      if (dryRun) {
        deps.onEdit?.({ ops, applied: 0, dryRun: true })
        return `dryRun 通过:${patches.length} 个操作可应用,未落地。\n${ops.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n确认后去掉 dryRun 重发。`
      }
      // ③ 应用阶段:批快照(首失败即停,已应用的靠已记快照可回滚 —— 但整批原子语义靠②前置解析保证,③ 仍可能因快照超限中断)
      const snips: Array<{ id: string; html: string }> = []
      for (let i = 0; i < patches.length; i++) {
        const err = applyPatch(doc, patches[i], snips)
        if (err) return `ERROR: patches[${i}] 应用失败:${err}\n本条未应用;此前的操作已生效,可用 dom_restore 回滚到本批之前。`
      }
      if (snips.length) {
        batches.push({ snips, ops })
        if (batches.length > MAX_SNAPSHOT_BATCHES) batches.shift()
      }
      deps.onEdit?.({ ops, applied: patches.length, dryRun: false })
      return `已应用 ${patches.length} 个操作(${ops.join(', ')})。页面为临时态(刷新即失);不满意可 dom_restore 回滚到本批之前;视觉验证可 take_screenshot。`
    },
    {
      name: 'dom_edit',
      description:
        '修改宿主页面元素(标注/内容/结构):patches 批量原子操作(任一失败整批拒绝)。op 集:set_text/set_html(内容)、set_attr/remove_attr、add_class/remove_class、set_style(样式)、insert(新建元素,before/after/prepend/append/replace)、remove、move(层级调整)、highlight(高亮+滚动定位)。纪律:selector 必须唯一命中(先 get_dom/dom_search 定位);改前自动快照,dom_restore 回滚;数据驱动页面请改数据而非 DOM。',
      schema: z.object({
        patches: z.array(domPatchSchema).min(1).max(20).describe('批量操作(原子;顺序应用)'),
        dryRun: z.boolean().optional().describe('只校验不落地(预检)'),
      }),
    },
  )

  const domRestoreTool = tool(
    async () => {
      const doc = getDoc()
      if (!doc) return 'ERROR: dom_restore 仅在浏览器环境可用。'
      const batch = batches.pop()
      if (!batch) return '无可用快照(栈空)。'
      let restored = 0
      const stale: string[] = []
      // 逆序回滚:后记录的根先恢复(嵌套结构先还原内层再还原外层会互相覆盖,逆序保批前首态)
      for (let i = batch.snips.length - 1; i >= 0; i--) {
        const { id, html } = batch.snips[i]
        const cur = doc.querySelector(`[${SNAP_ATTR}="${id}"]`)
        if (!cur) { stale.push(id); continue }
        const tpl = doc.createElement('template')
        tpl.innerHTML = html
        const parsed = tpl.content.firstElementChild
        if (!parsed) { stale.push(id); continue }
        cur.replaceWith(parsed)
        restored++
      }
      if (stale.length) return `已回滚 ${restored}/${batch.snips.length} 处;${stale.length} 处快照点已被后续结构变更覆盖(元素被整体替换),未能复原 —— 刷新页面可回宿主初始态。`
      return `已回滚最近一批 ${batch.ops.join(', ')}(共 ${restored} 处)。`
    },
    {
      name: 'dom_restore',
      description: '回滚最近一次 dom_edit 批操作(自动快照;可连续调用逐批回退,栈上限 20 批)。快照点被后续结构变更覆盖时如实报告未复原数。',
      schema: z.object({}).optional(),
    },
  )

  // 写能力标注(对齐 dataOps markWrite 单一真相源):dom_edit/dom_restore 改宿主页面 DOM = 写面工具。
  // 三处消费按此判定 —— ① zero-tool 门禁 isZeroEffectiveWrite 计「等效写」(修前 dom_edit 不被认作写 →
  //    「把配置表格高亮」类页面编辑指令收口被误判「零等效写」回灌「你没干任何事」+ 误报 ZERO_TOOL_GATE_EXHAUSTED);
  //    ② 子 agent 授权面剥离(spawn 自授不默认带页面写,需显式 allowedTools);③ isSuccessfulWriteResult。
  // 但 dom_edit 的「路径」是 CSS selector 非数据 jsonPath —— 已加入 readInvalidation EXCLUDED_WRITE_TOOLS
  //    (resource_update/delete 同构先例),防 effectiveWritePaths 落 ROOT 误失效全部数据读 / 污染 evidence 审计基线。
  ;(domEditTool as { writeCapable?: unknown }).writeCapable = true
  ;(domRestoreTool as { writeCapable?: unknown }).writeCapable = true

  return [domEditTool, domRestoreTool] as const
}
