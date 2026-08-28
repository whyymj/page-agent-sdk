/**
 * Permissions 中间件 —— 声明式 scope 白名单(first-match-wins,默认 allow)
 *
 * 对齐 Deep Agents 的 permissions/enforce.ts。本期默认不启用(主数据全开放无审批),
 * 保留 createChatSdk({ permissions }) 收紧口子。
 *
 * 仅对主数据/vfs 工具生效:按工具的 `jsonPath` 参数作为 scope(整体操作未传 jsonPath 时按根 scope '' 校验),匹配 glob 规则。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export type PermissionOp = 'read' | 'write'

export interface PermissionRule {
  operations: PermissionOp[]
  /** glob 模式,匹配工具的 jsonPath 参数(单对象 data 模型) */
  scopes: string[]
  mode: 'allow' | 'deny'
}

const WRITE_TOOLS = new Set(['write', 'vfs_write', 'vfs_edit', 'draft_commit', 'eval_script'])
const READ_TOOLS = new Set([
  'read',
  'query_data',
  'search_data',
  'vfs_read',
  'vfs_ls',
  'vfs_glob',
  'vfs_grep',
])

/**
 * 简易 glob → RegExp(对齐 scope 段分隔符 '.'):
 * - 单星 `*` → `[^.]*`(匹配单段,不跨 `.`;`components.*` 只匹配 components 直属一层)
 * - 双星 `**` → `.*`(匹配任意,跨段)
 * scope 字符串以 `.` 为段分隔(extractScopes 把 jsonPath 当 scope,如 `components.0.text`),
 * 故单星按 `.` 隔(非 `/`)—— 否则 deny 规则对深层路径失效(集成方写 `deny:['secrets.*']` 以为禁子项,
 * 实际深层全放行 = 假安全)。audit-five-dimensions SE-P1
 */
function globToRegex(pattern: string): RegExp {
  let r = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        r += '.*'
        i++
      } else {
        r += '[^.]*'
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      r += '\\' + c
    } else {
      r += c
    }
  }
  return new RegExp('^' + r + '$')
}

/** first-match-wins:按规则顺序,首个 op+scope 匹配的规则决定;无匹配默认 allow */
function decideAccess(rules: PermissionRule[], op: PermissionOp, scope: string): 'allow' | 'deny' {
  for (const rule of rules) {
    if (!rule.operations.includes(op)) continue
    if (rule.scopes.some((s) => globToRegex(s).test(scope))) return rule.mode
  }
  return 'allow'
}

/**
 * 提取一次工具调用涉及的所有 scope(点号路径)。
 * 兼容 `write` 高层工具的嵌套结构:jsonPath 可能在 `patch.jsonPath` 或 `patches[].jsonPath`(批量逐条独立判断)。
 * 整体操作(write({value}) 整体 set / draft_commit 无 jsonPath)返回空数组 → wrapToolCall 按根 scope '' 校验(fix-authorization-surface,修原「空 scopes 跳过」绕过口子)。
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

export function createPermissionsMiddleware(rules: PermissionRule[]): Middleware {
  return {
    name: 'permissions',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      let op: PermissionOp | null = WRITE_TOOLS.has(ctx.name)
        ? 'write'
        : READ_TOOLS.has(ctx.name)
          ? 'read'
          : null
      // fix-authorization-surface(P1-21 同型):eval_script 仅 transform 是写操作;query 只读不参与校验
      if (ctx.name === 'eval_script' && (ctx.args as Record<string, any> | undefined)?.mode !== 'transform') op = null
      // write 的 jsonPath 嵌在 patch/patches,需展开逐条校验(任一 deny 则整体拒绝)
      let scopes = extractScopes(ctx.args)
      // fix-authorization-surface(P1-22 同型):无 jsonPath 的写(整体 set/draft_commit/eval transform 整体)按根 scope '' 校验。
      // 原实现「空 scopes 跳过」= deny 规则可被整体写绕过;现仅匹配 '' 的规则(如 '**')拦整体写,具体路径规则不误伤
      if (op === 'write' && !scopes.length) scopes = ['']
      if (op && scopes.length) {
        for (const scope of scopes) {
          if (decideAccess(rules, op, scope) === 'deny') {
            return {
              content: `权限拒绝:${op} 操作 "${scope}" 被 permissions 规则禁止。`,
              status: 'error' as const,
            }
          }
        }
      }
      return next(ctx)
    },
  }
}
