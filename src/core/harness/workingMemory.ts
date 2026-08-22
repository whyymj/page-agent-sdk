/**
 * WorkingMemory 中间件 —— 跨压缩工作记忆(revive-cross-round-working-memory Phase 1)
 *
 * 解锁痛点:几百 K 频繁压缩 → read/query 定位的 path + read 的 hash 随 older 轮次被压缩/截断,
 * 后续轮 LLM 丢失定位(重复检索浪费 token)+ 凭记忆写导致乐观锁误冲突。
 *
 * Phase 1 最小版(解绑 C 组,独立中间件;只 pin 关键态):
 *  - 自动捕获(wrapToolCall,after next):read/query/search 结果 → locatedPaths;read 的 hash → lastHashes
 *  - augmentPrompt 每轮注入「## 工作记忆」段(最近定位 path + hash)
 *  - LRU ≤10 去重(控 context,<1KB)
 *
 * **压缩豁免(天然)**:workingMemory 经 augmentPrompt 每轮重建到 system(不在 AgentMessage[]),
 * compressInput 压的是 messages → workingMemory 不随 older 丢 —— **无需改 summarization**(同 mission)。
 * 与 preserveLastToolResults 互补:preserve 保工具结果摘要(防字段描述丢),workingMemory 保 path/hash 结构化(防定位丢)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'
import { extractWritePaths } from './subagent'

const MAX_ENTRIES = 10
/** read/query/search 之外的工具不捕获(只 pin 定位类) */
const CAPTURE_TOOLS = new Set(['read', 'query_data', 'search_data'])
/** 结果含「新 hash=」的写工具家族(stale-read-invalidation 联动:写成功刷新 lastHashes) */
const WRITE_HASH_TOOLS = new Set(['write', 'set_data', 'edit_data', 'draft_commit'])

/** lastHashes 键归一(read 侧 args.jsonPath 与写侧 extractWritePaths 输出统一:剥 '$.'/'$' 前缀,防同路径两键并存) */
function normalizeWmKey(p: string): string {
  let s = String(p)
  if (s.startsWith('$.') ) s = s.slice(2)
  else if (s.startsWith('$')) s = s.slice(1)
  return s || '(root)'
}

export function createWorkingMemoryMiddleware(): Middleware & {
  getWorkingMemory: () => import('./state').WorkingMemory | undefined
  /** 重置为初始态(切会话/清空聊天):清 locatedPaths + lastHashes,防旧会话 path/hash 污染新会话(P1-5) */
  reset: () => void
  /** 从快照恢复(刷新/切会话加载时):把持久化的 locatedPaths/lastHashes 写回闭包(context-persist-resilience 功能A) */
  restore: (wm: import('./state').WorkingMemory) => void
} {
  // 闭包真相源(跨轮持久);state.workingMemory 是其投影(每轮 beforeModel 刷,供 augmentPrompt + inspect)
  const locatedPaths: string[] = []
  const lastHashes: Record<string, string> = {}

  const isEmpty = () => locatedPaths.length === 0 && Object.keys(lastHashes).length === 0
  const snapshot = (): import('./state').WorkingMemory => ({
    locatedPaths: [...locatedPaths],
    lastHashes: { ...lastHashes },
  })

  /** path 入 locatedPaths(LRU 去重,超 MAX 淘汰最旧) */
  function capturePath(p: string): void {
    if (!p) return
    const i = locatedPaths.indexOf(p)
    if (i >= 0) locatedPaths.splice(i, 1)
    locatedPaths.unshift(p)
    while (locatedPaths.length > MAX_ENTRIES) locatedPaths.pop()
  }
  /** path→hash 入 lastHashes(LRU,超 MAX 淘汰最旧) */
  function captureHash(path: string, hash: string): void {
    if (lastHashes[path] === hash) return
    delete lastHashes[path]
    lastHashes[path] = hash
    const keys = Object.keys(lastHashes)
    while (keys.length > MAX_ENTRIES) {
      const stale = keys.shift() as string
      delete lastHashes[stale]
    }
  }

  const mw: Middleware & {
    getWorkingMemory: () => import('./state').WorkingMemory | undefined
    reset: () => void
    restore: (wm: import('./state').WorkingMemory) => void
  } = {
    name: 'workingMemory',
    beforeAgent: () => (isEmpty() ? undefined : { workingMemory: snapshot() }),
    // 每轮模型调用前投影闭包到 state.workingMemory(wrapToolCall 捕获后,下轮 beforeModel 刷;供 augmentPrompt 读最新)
    beforeModel: () => (isEmpty() ? undefined : { workingMemory: snapshot() }),
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      const result = await next(ctx)
      if (result.status === 'done' && CAPTURE_TOOLS.has(ctx.name)) {
        const content = typeof result.content === 'string' ? result.content : ''
        if (ctx.name === 'read') {
          // read:jsonPath 参数为 path(无则 root);结果含 hash=xxx(乐观锁用)
          // hash 为 base36(cyrb53.toString(36))→ 字符集 [0-9a-z];原 [0-9a-f] 对含 g-z 的 hash 恒失配(预存缺陷顺手修)
          const jp = (ctx.args?.jsonPath as string) || ''
          const path = normalizeWmKey(jp) || '(root)'
          capturePath(path)
          const hashMatch = content.match(/hash=([0-9a-z]{6,})/i)
          if (hashMatch) captureHash(path, hashMatch[1])
        } else {
          // query/search:args.jsonPath + 结果中 @ xxx 命中路径(多条)
          const jp = (ctx.args?.jsonPath as string) || ''
          if (jp) capturePath(jp)
          const hits = content.match(/@\s([a-zA-Z0-9_.[\]]+)/g)
          if (hits) hits.forEach((m) => capturePath(m.replace(/^@\s/, '')))
        }
      }
      // stale-read-invalidation 联动(C5/A3):写成功从结果「新 hash=」捕获覆盖同 path lastHashes ——
      // 否则 pin 段「勿重复检索 <path>=旧hash」与失效占位「请重读」同 path 双源相反指令,弱模型裁决随机。
      // 门自然收窄:成功写结果才含「新 hash=」(dryRun/ERROR: 字符串/挂起裁决都不含);path 用写工具口径(整体 = '(root)')
      if (result.status === 'done' && WRITE_HASH_TOOLS.has(ctx.name)) {
        const content = typeof result.content === 'string' ? result.content : ''
        const hashMatch = content.match(/新 hash=([0-9a-z]{6,})/i)
        if (hashMatch) {
          const paths = extractWritePaths(ctx.args).map(normalizeWmKey)
          if (paths.length) paths.forEach((p) => captureHash(p, hashMatch[1]))
          else captureHash('(root)', hashMatch[1])
        } else if (content.startsWith('已删除')) {
          // 删除族成功(已删除主数据 @ path,无新 hash):清对应 path 及其后代的 lastHashes ——
          // 路径已不存在,留着旧 hash 就是 C5 要消的反向指令(code review P2:删除族无新值可刷)
          for (const p of extractWritePaths(ctx.args).map(normalizeWmKey)) {
            for (const k of Object.keys(lastHashes)) {
              if (k === p || k.startsWith(p + '.')) delete lastHashes[k]
            }
          }
        }
      }
      return result
    },
    augmentPrompt: (state) => {
      const w = state.workingMemory
      if (!w || (w.locatedPaths.length === 0 && Object.keys(w.lastHashes).length === 0)) return undefined
      const lines = ['## 工作记忆(跨压缩保留,勿重复检索)']
      if (w.locatedPaths.length) lines.push('最近定位:' + w.locatedPaths.join(', '))
      if (Object.keys(w.lastHashes).length) {
        lines.push('最近 hash:' + Object.entries(w.lastHashes).map(([p, h]) => `${p}=${h.slice(0, 8)}`).join(', '))
      }
      return lines.join('\n')
    },
    getWorkingMemory: () => (isEmpty() ? undefined : snapshot()),
    /** 重置为初始态(切会话/清空聊天):清空闭包 locatedPaths + lastHashes,防旧会话定位/hash 污染新会话 */
    reset: () => {
      locatedPaths.length = 0
      for (const k of Object.keys(lastHashes)) delete lastHashes[k]
    },
    /** 从快照恢复(刷新/切会话加载):把持久化的 locatedPaths/lastHashes 写回闭包(context-persist-resilience 功能A) */
    restore: (wm) => {
      locatedPaths.length = 0
      // 字段守卫(audit-five-dimensions VM-P1):wm.locatedPaths/lastHashes 可能缺失
      // (未来版本写显式空标记 {}/持久化损坏/跨版本迁移 partial object/WebStorage JSON.parse 失败回退),
      // 缺字段直接 .slice 会抛 TypeError 中断整个 applySnapshot → 会话恢复失败(messages/vfs/todos 也未灌入)。
      // Array/Object 守卫降级为空,单 kind 失败不阻塞其余灌入
      if (Array.isArray(wm?.locatedPaths)) locatedPaths.push(...wm.locatedPaths.slice(0, MAX_ENTRIES))
      for (const k of Object.keys(lastHashes)) delete lastHashes[k]
      if (wm?.lastHashes && typeof wm.lastHashes === 'object') Object.assign(lastHashes, wm.lastHashes)
    },
  }
  return mw
}
