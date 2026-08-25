/**
 * 上下文超限错误识别(harden-context-resilience,P3 反应性重试用)
 *
 * langchain 已把 OpenAI(`context_length_exceeded`)/ Anthropic(`prompt is too long`)的 400
 * 包装成 `ContextOverflowError`;这里复用其静态 `isInstance` + 兜底正则(未走 wrap* 的裸 provider 错误、
 * 直连 OpenAI 兼容端点等)。
 *
 * 职责正交:**不进 `isRetryable`**(超限重试同样输入无意义,瞬时重试只会再次超限);
 * 专供 `coreModelCall` 迭代 catch 识别后做「压缩 → 单次重试」(P3)。
 */
import { ContextOverflowError } from '@langchain/core/errors'

/**
 * 判定错误是否为「上下文超限」(模型输入 token 超过 contextWindow)。
 * 识别链:langchain ContextOverflowError → lc_error_code → error.code → status 400 + message 正则。
 */
export function isContextLengthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  // 优先:langchain 标准包装(OpenAI/Anthropic 经 wrap* 后都变 ContextOverflowError)
  try {
    if (ContextOverflowError.isInstance(err)) return true
  } catch {
    /* 旧版 @langchain/core 无 ContextOverflowError 时降级下面的字段/正则判定 */
  }
  const e = err as { lc_error_code?: string; code?: string; status?: number; message?: string }
  // langchain 包装码(Anthropic wrap 设 lc_error_code='CONTEXT_OVERFLOW')
  if (e.lc_error_code === 'CONTEXT_OVERFLOW') return true
  // OpenAI 原生 error.code
  if (e.code === 'context_length_exceeded') return true
  // 兜底:未走 langchain 包装的裸 provider 错误(直连端点),靠 message 关键词
  if (e.status === 400 && typeof e.message === 'string') {
    return /context_length_exceeded|prompt is too long|maximum context length|exceeds the context window/i.test(e.message)
  }
  return false
}

/**
 * 判定错误是否为「模型不可用」(model-offline-guidance:网关/厂商下线模型面,modelverse「model [x] is offline」400 实测驱动)。
 * 识别链同 isContextLengthError:lc_error_code → error.code → 400/404 + message 特征。
 * 特征收紧为 `is offline` / `not support for model`(裸 `does not exist` 会误伤「path does not exist」类工具/路径错误,弃用);
 * **仅消费于模型调用失败 catch 点**,不进工具错误归一化路径(asAgentError 消费点含工具 catch,放进去必误伤)。
 */
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { lc_error_code?: string; code?: string; status?: number; message?: string }
  if (e.lc_error_code === 'MODEL_UNAVAILABLE') return true
  // OpenAI 原生 404 错误码 + 本 change 打的码(已装饰形态)
  if (e.code === 'model_not_found' || e.code === 'MODEL_UNAVAILABLE') return true
  if ((e.status === 400 || e.status === 404) && typeof e.message === 'string') {
    return /is offline|not support for model/i.test(e.message)
  }
  return false
}

/** 引导文案(model-offline-guidance;只指向换模型/查网关两个既有动作,不引导集成方声明任何新配置) */
export const MODEL_UNAVAILABLE_GUIDANCE = '该模型在当前网关不可用:换模型名后 setLlm 重试,或检查网关/服务方开放的模型面列表'

/**
 * 命中模型不可用 → 就地打 `code:'MODEL_UNAVAILABLE'` + message 尾附引导(幂等:已装饰只跳过不重复追加);返回是否命中。
 * severity 与重试语义由各 catch 点维持现状(4xx 本就不重试;主路径 fatal 浮出不变,子 agent error result 仅装饰 message)。
 */
export function decorateModelUnavailable(err: unknown): boolean {
  if (!isModelUnavailableError(err)) return false
  const e = err as { code?: string; message?: string }
  try {
    e.code = 'MODEL_UNAVAILABLE'
    if (typeof e.message === 'string' && !e.message.includes(MODEL_UNAVAILABLE_GUIDANCE)) {
      e.message = `${e.message}(${MODEL_UNAVAILABLE_GUIDANCE})`
    }
  } catch {
    /* message 只读的异形错误:仅打码 */
  }
  return true // 命中即 true(message 去重追加,不影响命中语义)
}
