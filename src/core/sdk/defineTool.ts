/**
 * defineTool —— 声明式自定义工具 helper
 *
 * 包装 LangChain tool(),让使用者用更简洁的对象形式声明工具。
 * 返回值可直接传入 createChatSdk({ tools }) 或 createAgent({ tools })。
 */
import { tool } from '@langchain/core/tools'
import { z, type ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { markWatchdogTools } from '../harness/toolWatchdog'

export interface DefineToolOptions<S extends ZodType> {
  name: string
  description: string
  /** 参数 schema(z.object) */
  schema: S
  /** 工具执行体;返回 string 原样回传,其他值 JSON.stringify */
  handler: (args: z.infer<S>) => unknown | Promise<unknown>
  /**
   * 等效写标注(2026-08-23,editor 诊断驱动):声明本工具会变更宿主数据(如编辑器结构工具
   * delete_component/add_component 走原生流程改页面)。生效面:零工具门禁不再误判「零写谎报」/
   * fact-sheet 把它计入写入统计 / stale-read 失效与 evidence 审计账本纳入。布尔或 args 判定函数
   * (条件写);缺省 false(纯读/纯动作工具勿标)。dataOps 内置工具同口径标注(单一真相源 markWrite)。
   */
  writeCapable?: boolean | ((args: Record<string, unknown>) => boolean)
}

export function defineTool<S extends ZodType>(opts: DefineToolOptions<S>): StructuredToolInterface {
  const t = tool(
    async (args) => {
      const res = await opts.handler(args as z.infer<S>)
      return typeof res === 'string' ? res : JSON.stringify(res)
    },
    {
      name: opts.name,
      description: opts.description,
      schema: opts.schema,
    },
  )
  if (opts.writeCapable !== undefined) {
    ;(t as { writeCapable?: unknown }).writeCapable = opts.writeCapable
  }
  // per-tool 看门狗(flow-robustness P0#1):defineTool 是集成方工具的主入口,创建即打标 ——
  // coreExecTool 对带标工具 race toolTimeoutMs(默认 120s),兜「永不 settle」拖死 runPool/stop 失效
  markWatchdogTools([t])
  return t
}
