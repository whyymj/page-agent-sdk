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

import type { TestCtx } from './_ctx'

// dataOps:单主对象 基础(set/get/delete + schema 校验)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[dataOps]')
  {
    const appObj: any = { theme: 'light', count: 0 }
    const tools = createDataOps({
      schema: z.object({
        theme: z.enum(['light', 'dark']),
        count: z.number().int().min(0),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)

    // set_data 整体替换(合法)
    let r = await invoke(t['set_data'], { value: '{ "theme": "dark", "count": 3 }' })
    assert(appObj.theme === 'dark' && appObj.count === 3 && /已设置/.test(r), 'set_data 合法值生效 + 返回成功')

    // set_data 非法值被 schema 校验拦截(不写入)
    r = await invoke(t['set_data'], { value: '{ "theme": "red", "count": 1 }' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.theme === 'dark', 'set_data 非法值被 schema 校验拦截(不写入,返回结构化错误码)')

    // set_data 缺字段:path-scoped-validation 契约收窄 —— merge 语义下未出现的 key 不过堂(缺必填不再拒),
    // 未出现字段保留原值(防误删);深度缺字段(出现的 key 值内缺必填)仍被局部校验拒
    r = await invoke(t['set_data'], { value: '{ "theme": "dark" }' })
    assert(appObj.theme === 'dark' && appObj.count === 3, '✓ set 缺必填顶层 key → merge 语义放行且未出现字段保留(path-scoped 契约)')
    r = await invoke(t['set_data'], { value: '{ "theme": "red" }' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.theme === 'dark', '✓ set 出现的 key 非法 → 局部校验仍拒')

    // get_data 读整个主数据
    r = await invoke(t['get_data'], {})
    assert(/dark/.test(r) && /hash=/.test(r), 'get_data 不传 jsonPath 返回整个主数据 + hash')

    // get_data 读子路径
    r = await invoke(t['get_data'], { jsonPath: 'theme' })
    assert(/dark/.test(r) && /hash=/.test(r), 'get_data 传 jsonPath 返回子路径值 + hash')

    // get_data 读非 schema 声明字段 → PATH_DENIED(白名单模式:仅 schema 声明的 key 可读)
    r = await invoke(t['get_data'], { jsonPath: 'nope' })
    assert(/PATH_DENIED/.test(r), 'get_data 读非 schema 声明字段 → PATH_DENIED')

    // edit_data 增量 set 子路径(合法)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5' })
    assert(appObj.count === 5 && /已 edit/.test(r), 'edit_data set 子路径生效')

    // edit_data 非法值被校验拦截(整体仍经 schema)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '"not a number"' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.count === 5, 'edit_data 非法值被 schema 校验拦截(不写入)')

    // delete_data 删子路径
    r = await invoke(t['delete_data'], { jsonPath: 'count' })
    assert(!('count' in appObj) && /已删除/.test(r), 'delete_data 删子路径生效')

    // delete_data 删非 schema 声明字段 → PATH_DENIED(白名单模式)
    r = await invoke(t['delete_data'], { jsonPath: 'nope' })
    assert(/PATH_DENIED/.test(r), 'delete_data 删非 schema 声明字段 → PATH_DENIED')

    // describe_data 返回说明
    r = await invoke(t['describe_data'], {})
    assert(/应用配置/.test(r), 'describe_data 返回主数据说明')

    // 工具描述总长回归(context-economy-phase2 二批瘦身;防一阶段「反向锚定把新文案盖错对象」事故重演:
    // 每条描述须与其工具语义一致(抽查锚点词)+ 单条 ≤330(write 一阶段已压基线)
    const descAnchors: [string, RegExp][] = [
      ['eval_script', /沙箱/], ['draft_commit', /草稿/], ['draft_write', /drafts/],
      ['query_data', /JSONPath/], ['search_data', /搜索/], ['history_data', /快照/],
      ['set_data', /deprecated|弃用/], ['get_data', /deprecated|弃用/], ['edit_data', /增量/],
      ['write', /四意图|写入主数据/], ['read', /hash/],
    ]
    for (const [n, anchor] of descAnchors) {
      const d = t[n]?.description ?? ''
      if (!t[n]) continue // draft_write/draft_commit 等 opt-in 工具在本 fixture(schema 小,未开)不装配,跳过
      assert(anchor.test(d), `✓ 描述锚点 → ${n} 描述含语义锚点(未被盖错对象)`)
      assert(d.length <= 330, `✓ 描述长度 → ${n} ≤330(实际 ${d.length},防描述膨胀)`)
    }
    // 总长上限:advanced 可见数据工具描述总和 ≤3200(压缩二批回归线)
    const ADV_VISIBLE = ['describe_data','get_data','set_data','edit_data','delete_data','restore_data','history_data','query_data','search_data','eval_script','read','write','schema_data','diff_data','draft_write','draft_commit']
    const total = ADV_VISIBLE.reduce((s2, n) => s2 + (t[n]?.description?.length ?? 0), 0)
    assert(total <= 3200, `✓ 描述总长 → advanced 数据工具描述合计 ≤3200(实际 ${total})`)

    // draft 工具锚点(vfsStore 提供才装配 → 单独小 fixture;仍属描述回归断言)
    const draftTools = createDataOps(
      { schema: z.object({ a: z.string() }), bind: { a: 'x' }, description: '草稿夹具' },
      { vfsStore: createVfs() },
    )
    const dt = byName(draftTools)
    assert(/草稿/.test(dt['draft_commit']?.description ?? ''), '✓ 描述锚点 → draft_commit 描述含语义锚点(草稿)')
    assert(/drafts/.test(dt['draft_write']?.description ?? ''), '✓ 描述锚点 → draft_write 描述含语义锚点(drafts 池)')
    assert((dt['draft_commit']?.description?.length ?? 0) <= 330 && (dt['draft_write']?.description?.length ?? 0) <= 330, '✓ 描述长度 → draft 两工具 ≤330(防膨胀)')
  }
}
