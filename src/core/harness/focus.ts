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
import { extractSchemaHint } from '../presets'

/** 写工具集合(聚焦时其 jsonPath 必须在任一 focus 子树内;读工具不限制,用户仍需看全量上下文) */
const WRITE_TOOLS = new Set([
  'set_data',
  'edit_data',
  'delete_data',
  'write',
  'vfs_write',
  'vfs_edit',
])

/**
 * 提取一次工具调用涉及的所有 jsonPath scope(点号路径)。
 * 兼容 write 高层工具的嵌套:jsonPath 可能在 `patch.jsonPath` / `patches[].jsonPath`(批量逐条独立判断)。
 * 整体操作(write({value}) / set_data 无 jsonPath)返回空数组 → 不校验(由 schema 白名单兜底,与 permissions 一致)。
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
  /** 构造时初始焦点数组(子 agent 继承主 agent 多焦点用;主 agent 不传,靠 addFocus/setFocus 后续设) */
  initialFocuses?: Focus[]
}

export function createFocusMiddleware(opts: FocusMiddlewareOptions): Middleware & FocusController {
  let focuses: Focus[] = opts.initialFocuses ? [...opts.initialFocuses] : []

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
      if (focuses.length && WRITE_TOOLS.has(ctx.name)) {
        const scopes = extractScopes(ctx.args)
        for (const scope of scopes) {
          if (!focuses.some((f) => isUnderFocus(scope, f.path))) {
            const labels = focuses.map((f) => (f.label ? `${f.path}(${f.label})` : f.path)).join(', ')
            return {
              content: `PATH_DENIED · 聚焦越界:当前聚焦 [${labels}],不可操作「${scope}」。请先 remove_focus / clear_focus 或换焦点后重试。`,
              status: 'error' as const,
            }
          }
        }
      }
      return next(ctx)
    },
    setFocus: (f) => {
      focuses = f ? [f] : []
    },
    getFocus: () => focuses[0],
    getFocuses: () => [...focuses],
    addFocus: (f) => {
      // 去重 by path:已存在则更新 label(覆盖),否则追加
      const idx = focuses.findIndex((x) => x.path === f.path)
      if (idx >= 0) focuses[idx] = f
      else focuses.push(f)
    },
    removeFocus: (path) => {
      focuses = focuses.filter((f) => f.path !== path)
    },
    clearFocus: () => {
      focuses = []
    },
    reset: () => {
      focuses = []
    },
  }
  return mw
}
