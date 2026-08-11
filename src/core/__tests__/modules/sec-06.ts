import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../../harness/skills'
import { createPermissionsMiddleware } from '../../harness/permissions'
import { createMemoryMiddleware } from '../../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { runPool } from '../../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../../harness/verify'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../../harness/checkpoint'
import { extractText } from '../../mcp/client'
import { createInitialState as createState } from '../../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../../utils/modelCaps'
import { useContextManager } from '../../composables/useContextManager'
import { resolveContextOptions } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/dataSlotQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// permissions 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[permissions middleware]')
  {
    const mw = createPermissionsMiddleware([
      { operations: ['write'], scopes: ['secret'], mode: 'deny' },
    ])
    const next = async () => ({ content: 'ok', status: 'done' as const })
    let r = await mw.wrapToolCall!({ id: '1', name: 'set_data', args: { jsonPath: 'secret' }, state: createState() }, next)
    assert(/权限拒绝/.test(r.content) && r.status === 'error', 'permissions deny 命中')

    r = await mw.wrapToolCall!({ id: '2', name: 'set_data', args: { jsonPath: 'theme' }, state: createState() }, next)
    assert(r.content === 'ok', 'permissions 未命中规则默认 allow')

    r = await mw.wrapToolCall!({ id: '3', name: 'custom_tool', args: {}, state: createState() }, next)
    assert(r.content === 'ok', 'permissions 不影响非 data/vfs 工具')

    // H1: write 高层工具的 jsonPath 嵌在 patch/patches(顶层 args.jsonPath 为 undefined),
    // permissions 必须展开逐条校验(原 bug:scope 恒空 → deny 规则对 write 完全失效,与 #76 write.value 同根)
    r = await mw.wrapToolCall!({ id: '4', name: 'write', args: { patch: { op: 'set', jsonPath: 'secret', value: 'x' } }, state: createState() }, next)
    assert(/权限拒绝/.test(r.content) && r.status === 'error', 'H1: permissions write patch.jsonPath 命中 deny(原 bug:嵌套结构绕过)')

    r = await mw.wrapToolCall!({ id: '5', name: 'write', args: { patches: [{ op: 'set', jsonPath: 'secret', value: 'x' }, { op: 'set', jsonPath: 'theme', value: 'y' }] }, state: createState() }, next)
    assert(/权限拒绝/.test(r.content) && r.status === 'error', 'H1: permissions write patches[] 任一命中 deny → 整体拒绝')

    r = await mw.wrapToolCall!({ id: '6', name: 'write', args: { patch: { jsonPath: 'secret' }, del: true }, state: createState() }, next)
    assert(/权限拒绝/.test(r.content) && r.status === 'error', 'H1: permissions write del patch.jsonPath 命中 deny')

    r = await mw.wrapToolCall!({ id: '7', name: 'write', args: { patch: { op: 'set', jsonPath: 'theme', value: 'dark' } }, state: createState() }, next)
    assert(r.content === 'ok', 'H1: permissions write patch 未命中 deny 的 path → allow')

    r = await mw.wrapToolCall!({ id: '8', name: 'write', args: { value: { secret: 'x' } }, state: createState() }, next)
    assert(r.content === 'ok', 'permissions write 整体 set(无 jsonPath)→ 按根 scope 校验,具体路径规则(secret)不误伤')

    // fix-authorization-surface(P1-21/22 同型):全局 deny 拦整体写 + eval_script/draft_commit 纳入写校验
    const mwGlobal = createPermissionsMiddleware([
      { operations: ['write'], scopes: ['**'], mode: 'deny' },
    ])
    r = await mwGlobal.wrapToolCall!({ id: '9', name: 'write', args: { value: { a: 1 } }, state: createState() }, next)
    assert(/权限拒绝/.test(r.content) && r.status === 'error', 'P1-22 同型: permissions 整体写(无 jsonPath)按根 scope 校验 → 全局 deny 命中(原:空 scopes 跳过被绕过)')
    r = await mwGlobal.wrapToolCall!({ id: '10', name: 'set_data', args: { value: { a: 1 } }, state: createState() }, next)
    assert(r.status === 'error', 'P1-22 同型: permissions set_data 整体写 → 根 scope 命中全局 deny')
    r = await mwGlobal.wrapToolCall!({ id: '11', name: 'draft_commit', args: { draftId: 'd1' }, state: createState() }, next)
    assert(r.status === 'error', 'permissions draft_commit(整体写)纳入写校验 → 全局 deny 命中')
    r = await mwGlobal.wrapToolCall!({ id: '12', name: 'eval_script', args: { script: 'return data', mode: 'transform' }, state: createState() }, next)
    assert(r.status === 'error', 'P1-21 同型: permissions eval_script transform(整体)→ 根 scope 命中全局 deny')
    r = await mwGlobal.wrapToolCall!({ id: '13', name: 'eval_script', args: { script: 'return data', mode: 'transform', jsonPath: 'secret' }, state: createState() }, next)
    assert(r.status === 'error', 'P1-21 同型: permissions eval_script transform jsonPath 命中 deny')
    r = await mwGlobal.wrapToolCall!({ id: '14', name: 'eval_script', args: { script: 'return 1', mode: 'query' }, state: createState() }, next)
    assert(r.content === 'ok', 'permissions eval_script query(只读)→ 不参与写校验')
    r = await mw.wrapToolCall!({ id: '15', name: 'eval_script', args: { script: 'return data', mode: 'transform', jsonPath: 'theme' }, state: createState() }, next)
    assert(r.content === 'ok', 'permissions eval_script transform jsonPath 未命中 deny → allow')
  }
}
