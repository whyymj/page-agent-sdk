/**
 * Focus 中间件 —— 上下文聚焦 · 多焦点精修(focus-context / multi-focus)
 *
 * 会话级焦点状态 Focus[](可同时聚焦多个组件),聚焦后 agent 三层行为收敛:
 *  - 目标提示:augmentPrompt 注入「## 当前精修目标」(列出所有 path + label)
 *  - 视野收敛:注入每个焦点 `getSchemaAtPath(schema, path)` 子树 schema 描述,LLM 每轮看到所有焦点组件结构
 *  - 范围收紧(strict):wrapToolCall 对写工具拦截,jsonPath **不在任一焦点子树内** → PATH_DENIED(聚焦越界)
 *
 * **压缩豁免(天然)**:focus 经 augmentPrompt 每轮重建到 system prompt(不在 messages),
 * compressInput 压的是 messages → focus 不随 older 轮次丢(同 mission/workingMemory,无需改 summarization)。
 *
 * 触发方式:① sdk.setFocus(替换)/addFocus(累积)/removeFocus/clearFocus ② agent 工具 set_focus/add_focus/remove_focus/clear_focus
 * ③ ChatDialog chip(✕ 移除单个)。capabilities.focus 默认开。
 *
 * 兼容:getFocus() 返 focuses[0](旧单焦点代码零改);setFocus(f)=替换全部(旧覆盖语义);getFocuses/addFocus/removeFocus 为多焦点新增。
 *
 * 与 mission 共存:mission 管任务级目标,Focus 管对象级精修目标,可同时聚焦多个对象。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'
import type { Focus } from './state'
import type { ZodType } from 'zod'
import { getSchemaAtPath } from '../tools/schemaUtils'
import { getByPath } from '../tools/jsonUtils'
import { extractSchemaHint } from '../presets'

/**
 * 写工具集合(聚焦时其 jsonPath 必须在任一 focus 子树内;读工具不限制,用户仍需看全量上下文)。
 * fix-authorization-surface(P1-21/22):
 *  - 增 draft_commit(整体写 bind,同 set_data 语义);增 eval_script(transform 模式,wrapToolCall 内单独判 mode)
 *  - 移除 vfs_write/vfs_edit:vfs path 是工作区文件路径(如 html/x.vue)非数据 jsonPath,
 *    与焦点前缀比较恒不匹配 → 聚焦下误拦合法 vfs 写(html 子 agent 代码文件);vfs 工作区不属焦点数据范围
 */
const WRITE_TOOLS = new Set([
  'set_data',
  'edit_data',
  'delete_data',
  'write',
  'draft_commit',
])

/**
 * 提取一次工具调用涉及的所有 jsonPath scope(点号路径)。
 * 兼容 write 高层工具的嵌套:jsonPath 可能在 `patch.jsonPath` / `patches[].jsonPath`(批量逐条独立判断)。
 * 整体操作(write({value}) / set_data / draft_commit 无 jsonPath)返回空数组 → 由 wrapToolCall 按「整体写 = 越界」拒绝(P1-22)。
 */
function extractScopes(args: unknown): string[] {
  const a = (args ?? {}) as Record<string, any>
  const scopes = new Set<string>()
  if (typeof a.jsonPath === 'string' && a.jsonPath) scopes.add(a.jsonPath)
  if (typeof a.path === 'string' && a.path) scopes.add(a.path)
  if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) scopes.add(a.patch.jsonPath)
  if (Array.isArray(a.patches)) {
    for (const p of a.patches) {
      if (p && typeof p.jsonPath === 'string' && p.jsonPath) scopes.add(p.jsonPath)
    }
  }
  return [...scopes]
}

/** scope 是否在 focusPath 子树内(=== 焦点本身,或以 `focusPath.` 为前缀的子路径) */
function isUnderFocus(scope: string, focusPath: string): boolean {
  return scope === focusPath || scope.startsWith(focusPath + '.')
}

/**
 * scope 是否为「尾部追加」:<arrayPath>.<N>,bind 中 arrayPath 是数组且 N >= 当前长度。
 * 追加新元素到数组末尾,不改动已有元素 → 不破坏焦点子树(聚焦模式下允许新建组件等场景)。
 * 仅认直接数组索引(components.5);更深路径(components.5.code)不认(patch 写不存在的元素本就失败)。
 */
function isTailAppend(scope: string, bind: unknown): boolean {
  if (!bind || typeof bind !== 'object') return false
  const dot = scope.lastIndexOf('.')
  if (dot < 0) return false
  const arrPath = scope.slice(0, dot)
  const idxStr = scope.slice(dot + 1)
  if (!/^\d+$/.test(idxStr)) return false  // 非数字索引不算
  const arr = getByPath(bind, arrPath)
  return Array.isArray(arr) && Number(idxStr) >= arr.length
}

/** Focus 中间件控制器(闭包操作 + 供 createChatSdk 暴露 + agent 工具调用) */
export interface FocusController {
  /**
   * 替换全部焦点(传 null 清空)。**注意**:path 合法性校验在 createChatSdk 层(有 schema getter);
   * 中间件只负责赋值 + 注入/拦截。
   */
  setFocus: (focus: Focus | null) => void
  /** 兼容旧 API:返回首个焦点(focuses[0]);无焦点 → undefined */
  getFocus: () => Focus | undefined
  /** 全量焦点(副本,防外部 mutate) */
  getFocuses: () => Focus[]
  /**
   * 累积追加焦点(去重 by path:已存在则更新 label,否则 push)。
   * **注意**:path 校验在 createChatSdk 层;中间件只去重追加。
   */
  addFocus: (focus: Focus) => void
  /** 移除单个焦点(by path) */
  removeFocus: (path: string) => void
  /** 清空所有焦点 */
  clearFocus: () => void
  /** 重置为初始态(切会话/清空聊天):清焦点 */
  reset: () => void
}

export interface FocusMiddlewareOptions {
  /** 取当前主数据 schema 的 getter(适配 sdk.setData 运行时替换;取子树视野用;path 校验在 createChatSdk 层) */
  getSchema: () => ZodType | null | undefined
  /** 取当前主数据 bind 的 getter(尾部追加分判:isTailAppend 需读数组实际长度;主/子 focus mw 都传) */
  getBind?: () => unknown
  /** 构造时初始焦点数组(子 agent 继承主 agent 多焦点用;主 agent 不传,靠 addFocus/setFocus 后续设) */
  initialFocuses?: Focus[]
  /**
   * 焦点变更回调(所有 mutation 入口统一触发:setFocus/addFocus/removeFocus/clearFocus/reset)。
   * createChatSdk 注入 → emit focus_change 事件(集成方/demo 同步本地焦点镜像,如预览区 🎯 标记);
   * 子 agent 的 focus 中间件不传(只继承不突变,不发事件)。
   */
  onChange?: (focuses: Focus[]) => void
}

export function createFocusMiddleware(opts: FocusMiddlewareOptions): Middleware & FocusController {
  let focuses: Focus[] = opts.initialFocuses ? [...opts.initialFocuses] : []
  /** mutation 后统一通知(副本防外部 mutate) */
  const notify = () => opts.onChange?.([...focuses])

  const mw: Middleware & FocusController = {
    name: 'focus',
    beforeAgent: () => {
      // 焦点进 state(供其他中间件/工具观测;同 mission 模式)。augmentPrompt 读闭包 focuses。
      // focuses(数组,多焦点)+ focus(首个别名,兼容旧读 state.focus 的代码)
      return focuses.length ? { focuses: [...focuses], focus: focuses[0] } : {}
    },
    augmentPrompt: () => {
      if (!focuses.length) return undefined
      const lines = [
        '## 当前精修目标',
        focuses.map((f) => `· ${f.path}${f.label ? `(${f.label})` : ''}`).join('\n'),
        `仅操作上述 ${focuses.length} 个聚焦子树${focuses.length > 1 ? '之一' : ''},不要改动其他组件;需改其他组件请先 remove_focus / clear_focus 或换焦点。`,
      ]
      // 视野收敛:注入每个焦点子树 schema 描述(LLM 每轮看到所有焦点组件结构)
      const schema = opts.getSchema()
      if (schema) {
        const subs = focuses
          .map((f) => {
            const sub = getSchemaAtPath(schema, f.path)
            return sub ? extractSchemaHint(sub) : null
          })
          .filter((h): h is string => !!h)
        if (subs.length) {
          lines.push('', '## 焦点子树结构(仅此范围可操作)', ...subs)
        }
      }
      return lines.join('\n')
    },
    wrapToolCall: async (
      ctx: ToolCallContext,
      next: (ctx: ToolCallContext) => Promise<ToolExecResult>,
    ) => {
      // 范围收紧(strict):聚焦时写工具的 jsonPath 必须在【任一】焦点子树内,全不在才 PATH_DENIED 回灌 LLM 自纠
      // 例外:尾部追加(<arrayPath>.<N>,N>=数组长度)放行 —— 追加新元素不破坏焦点子树(聚焦模式可新建组件)
      if (focuses.length) {
        const labels = focuses.map((f) => (f.label ? `${f.path}(${f.label})` : f.path)).join(', ')
        const deny = (scope: string): ToolExecResult => ({
          content: `PATH_DENIED · 聚焦越界:当前聚焦 [${labels}],不可操作「${scope}」。请先 remove_focus / clear_focus 或换焦点后重试。`,
          status: 'error' as const,
        })
        // P1-21(fix-authorization-surface):eval_script transform 可改写任意路径/整体数据(原不在 WRITE_TOOLS → 绕过)。
        // query 模式只读放行;transform 无 jsonPath = 整体/patches 增量(必无 jsonPath)= 越界
        if (ctx.name === 'eval_script') {
          if ((ctx.args as Record<string, any> | undefined)?.mode !== 'transform') return next(ctx)
          const scopes = extractScopes(ctx.args)
          if (!scopes.length) return deny('(整体数据)')
          for (const scope of scopes) {
            if (!focuses.some((f) => isUnderFocus(scope, f.path)) && !isTailAppend(scope, opts.getBind?.())) return deny(scope)
          }
          return next(ctx)
        }
        if (WRITE_TOOLS.has(ctx.name)) {
          const scopes = extractScopes(ctx.args)
          // P1-22(fix-authorization-surface):无 jsonPath 整体写(write({value})/set_data/draft_commit/edit 无 path merge-append)
          // 原「空 scopes 放行」与 strict 承诺冲突 —— 整体写无法校验子树归属 = 越界
          if (!scopes.length) return deny('(整体数据)')
          for (const scope of scopes) {
            if (!focuses.some((f) => isUnderFocus(scope, f.path)) && !isTailAppend(scope, opts.getBind?.())) return deny(scope)
          }
        }
      }
      return next(ctx)
    },
    setFocus: (f) => {
      focuses = f ? [f] : []
      notify()
    },
    getFocus: () => focuses[0],
    getFocuses: () => [...focuses],
    addFocus: (f) => {
      // 去重 by path:已存在则更新 label(覆盖),否则追加
      const idx = focuses.findIndex((x) => x.path === f.path)
      if (idx >= 0) focuses[idx] = f
      else focuses.push(f)
      notify()
    },
    removeFocus: (path) => {
      focuses = focuses.filter((f) => f.path !== path)
      notify()
    },
    clearFocus: () => {
      focuses = []
      notify()
    },
    reset: () => {
      focuses = []
      notify()
    },
  }
  return mw
}
