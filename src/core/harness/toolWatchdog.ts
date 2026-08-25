/**
 * per-tool 看门狗(flow-robustness P0#1)—— 集成方注入工具「永不 settle」兜底。
 *
 * 背景:runPool/coreExecTool 对工具 Promise 裸等;集成方工具(tools 定义 / actions.run / skill 工具
 * 工厂 / rag retriever)实现缺陷(死循环 / 永不 resolve 的 Promise / 无超时的远程调用)→ runPool 永挂
 * → stream/invoke 永挂 → loading 永转、队列全堵、stop 无效(abort 只在工具间隙检查,已启动工具不取消);
 * 子 agent 内同理并向上毒化主循环。
 *
 * 豁免面(设计内等待,不归看门狗管):
 * - 内置工具 / MCP(自有 callTimeoutMs 60s)全有更紧的闸;
 * - 委派类(use_<id> / spawn_agent / spawn_agents)属子 agent 生命周期域(真 LLM 单次委派 >120s 常态);
 * - dataOps 写工具的 conflict ask 挂起等人工裁决(可达分钟级,由 conflictPolicy/abort 联动收口)。
 *
 * 实现 = 显式标记:defineTool / createChatSdk 装配(user/actions/skill 工厂)/ rag retriever 包装等
 * 集成方入口打标记,coreExecTool 只对带标记工具 race `toolTimeoutMs`(默认 120s,0=关)。标记挂在工具
 * 对象上随引用走(buildChildTools 复用同一实例)→ 子 agent 栈自动同覆盖,无需额外管道。
 */

/** 工具对象上的看门狗标记键(内部约定,`__pg` 前缀族) */
export const TOOL_WATCHDOG_MARK = '__pgWatchdog'

/** 默认超时 120s。宽松原则:只兜集成面缺口,不得把既有有界工具的行为变掉 */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000

/** 看门狗超时错误(由 coreExecTool 转 recoverable 错误结果回灌,不杀流) */
export class ToolTimeoutError extends Error {
  readonly timedOutMs: number
  constructor(ms: number) {
    super(`工具执行超过 ${ms}ms 未返回(看门狗超时)`)
    this.name = 'ToolTimeoutError'
    this.timedOutMs = ms
  }
}

/** 标记一批工具为「集成方注入、无自有闸」(幂等) */
export function markWatchdogTools(tools: readonly unknown[]): void {
  for (const t of tools) {
    if (t && typeof t === 'object' && 'name' in (t as object)) {
      ;(t as Record<string, unknown>)[TOOL_WATCHDOG_MARK] = true
    }
  }
}

/** 工具是否受看门狗管辖(带标记且未显式关闭) */
export function isWatchdogTool(t: unknown, timeoutMs: number): boolean {
  return timeoutMs > 0 && !!t && typeof t === 'object' && (t as Record<string, unknown>)[TOOL_WATCHDOG_MARK] === true
}

/**
 * race 包装工具 Promise:超时 reject ToolTimeoutError;底层 promise 无法取消,吞掉其迟到的 rejection
 * (防 unhandledRejection)。timeoutMs ≤0 直接透传(关闭语义)。
 */
export async function withToolWatchdog<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(timeoutMs > 0)) return p
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(timeoutMs)), timeoutMs)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // 底层 promise 已被放弃:吞掉迟到 rejection(正常 reject 路径错误已由 race 抛给调用方)
    p.catch(() => {})
  }
}
