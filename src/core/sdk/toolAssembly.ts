/**
 * 工具装配岛(F3 2026-09-10 从 createChatSdk 抽出):rebuildExtraTools 的归宿。
 * 装配逻辑 = 八来源 dedupe 序(builtin→user→action→humanConfirm→checkpoint→focus→mcp→skill)
 * + 集成方注入面统一打 per-tool 看门狗标 + 重名碰撞告警(后注册覆盖)。集合所有权仍归 createChatSdk
 * (会话共享态,经 getter 传入);本模块只持装配策略(F4 再议所有权收敛)。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import { dedupeTools } from './toolRegistry'
import { markWatchdogTools } from '../harness/toolWatchdog'

export interface ToolAssemblyDeps {
  builtinTools: () => StructuredToolInterface[]
  userTools: () => StructuredToolInterface[]
  actionTools: () => StructuredToolInterface[]
  humanConfirmTool: () => StructuredToolInterface | null | undefined
  checkpointTools: () => StructuredToolInterface[]
  focusTools: () => StructuredToolInterface[]
  mcpTools: () => StructuredToolInterface[]
  loadedSkillTools: () => StructuredToolInterface[]
}

/** 返回 rebuild():全量重算工具集(dedupe 序 + 看门狗打标 + 碰撞告警) */
export function createToolRebuilder(deps: ToolAssemblyDeps): () => StructuredToolInterface[] {
  return function rebuildExtraTools(): StructuredToolInterface[] {
    // per-tool 看门狗标记(flow-robustness P0#1):集成方注入面(user 原生 langchain 工具 / actions.run
    // 包装 / skill 工具工厂产物)无自有闸,统一打标 coreExecTool race toolTimeoutMs。defineTool 产物已在
    // 创建时打标(此处幂等);builtin/mcp(自有闸)/humanConfirm(设计内等人工)不打 —— 重名覆盖时幸存
    // 对象随自身标记走(user 实现覆盖 builtin → 看 user 实现,语义正确)
    markWatchdogTools(deps.userTools())
    markWatchdogTools(deps.actionTools())
    markWatchdogTools(deps.loadedSkillTools())
    const { tools, collisions } = dedupeTools([
      { label: 'builtin', tools: deps.builtinTools() },
      { label: 'user', tools: deps.userTools() },
      { label: 'action', tools: deps.actionTools() },
      { label: 'humanConfirm', tools: deps.humanConfirmTool() ? [deps.humanConfirmTool()!] : [] },
      { label: 'checkpoint', tools: deps.checkpointTools() },
      { label: 'focus', tools: deps.focusTools() },
      { label: 'mcp', tools: deps.mcpTools() },
      { label: 'skill', tools: deps.loadedSkillTools() },
    ])
    if (collisions.length) {
      console.warn('[page-agent-sdk] 工具重名,后注册覆盖先注册:', collisions.map((c) => `${c.name}(${c.loser}→${c.winner})`).join(', '))
    }
    return tools
  }
}
