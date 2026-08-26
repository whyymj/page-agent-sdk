/**
 * 工具步骤展示映射(dialog.toolStepView)—— 纯展示层拦截器。
 *
 * 集成方可把原始工具名(read/write/use_html …)映射为业务友好文案(如「读取数据 / 修改第 3 个组件 /
 * 生成组件代码」),并可按 args 动态生成。映射只影响 MessageSteps 步骤行渲染,不影响发给 LLM 的
 * 工具名/协议/校验。
 *
 * 拆成纯函数(非组件内闭包):① selftest 可直测(映射命中/未命中回退/抛错兜底)② MessageSteps
 * 主步骤与子 agent 步骤(children)复用同一映射语义。
 */
import type { ToolStep, ToolStepView, ToolStepViewFn } from '../types'

/**
 * 安全调用展示映射:返回 { title?, detail? }(全空 = 未映射,回退原始工具名);fn 抛错/返回非对象
 * 均回退(展示层异常不炸渲染);映射函数未配(undefined)零开销直通。
 */
export function applyStepView(
  fn: ToolStepViewFn | undefined,
  step: Pick<ToolStep, 'name' | 'args' | 'status' | 'result' | 'durationMs'>,
): ToolStepView {
  if (!fn) return {}
  try {
    const v = fn({
      name: step.name,
      args: step.args,
      status: step.status,
      result: step.result,
      durationMs: step.durationMs,
    })
    if (!v || typeof v !== 'object') return {}
    const title = typeof v.title === 'string' && v.title ? v.title : undefined
    const detail = typeof v.detail === 'string' && v.detail ? v.detail : undefined
    return title || detail ? { title, detail } : {}
  } catch {
    // 映射函数抛错:回退原始工具名(展示层兜底,不中断渲染)
    return {}
  }
}
