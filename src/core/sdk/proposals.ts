/**
 * content-proposals 通道(auto-host-watch 同批立项,openspec/changes/2026-09-19-content-proposals):
 * 数据槽之外的内容(Markdown/文本/代码,真相源在宿主)的「AI 提案 → 人评审 → 应用」通道。
 *
 * 模型零写权限:propose_content 只送提案(非阻塞,onProposal 返回即回灌),写回永远走宿主自己的链路;
 * 增量优先:ops 字面锚唯一命中 + baseHash 基底锚定(乐观锁哲学平移内容域 —— 基底漂移显式拒);
 * 裁决闭环:resolveProposal → proposal_resolved 事件 + 下轮一次性结局段(闭环「改好了吗」)。
 *
 * 未配置 = createChatSdk 不注册任何工具,模型不知道能力存在。
 */
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { applyProposalOps, hashContent, lineDiff, type DiffRow, type ProposalOp } from '../tools/proposalOps'
import { markWatchdogTools } from '../harness/toolWatchdog'

/** 送达评审面板的提案(SDK 已校验基底、已应用 ops、已算 diff;宿主渲染面板 + 用户裁决) */
export interface ReviewableProposal {
  /** 提案 id(resolveProposal 回传用) */
  id: string
  /** 一句话修改说明(模型提交) */
  summary: string
  /** 内容对象标签(host read 返回;面板标题用) */
  label?: string
  /** 基底指纹(hashContent;resolveProposal 时宿主可再核) */
  baseHash: string
  /** 基底原文(diff 左侧;宿主渲染对照) */
  baseContent: string
  /** 完整新内容(ops 应用产物;用户点「应用」时宿主写回的就是它) */
  content: string
  /** 逐行 diff(渲染无关行序列 + 统计) */
  diff: { rows: DiffRow[]; stats: { added: number; removed: number } }
  createdAt: number
}

/** proposals 顶层选项(配置即开关) */
export interface ProposalsConfig {
  /** 读通道:返回当前内容(SDK 计算 hash;null = 当前无可编辑对象,工具内如实报) */
  read: () => Promise<{ content: string; label?: string } | null> | { content: string; label?: string } | null
  /** 评审回调:SDK 已完成基底校验/ops 应用/diff 计算;宿主渲染面板。返回字符串回灌模型
   *  (**非阻塞契约**:面板打开即返回,勿等待用户裁决 —— 看门狗与「用户不点就挂死」双坑的既定答案) */
  onProposal: (p: ReviewableProposal) => string | Promise<string>
  /** 提案工具名(默认 'propose_content') */
  toolName?: string
  /** 读工具名(默认 'read_content') */
  readToolName?: string
  /** 内容是什么(如 'wiki 笔记源 Markdown(含 frontmatter)';进工具 description) */
  contentKind?: string
  /** 在审提案上限(默认 1:新提案替换最旧在审,留痕) */
  maxPending?: number
}

export interface ResolvedProposalRecord {
  id: string
  outcome: 'applied' | 'discarded'
  summary: string
  detail?: string
  at: number
}

/** 通道会话态(createChatSdk 持有;inspect().proposals / sdk.proposals 投射) */
export interface ProposalChannelState {
  pending: ReviewableProposal[]
  applied: number
  discarded: number
  lastResolved: ResolvedProposalRecord | null
  /** 裁决结局一次性注入段行(下轮 system + afterAgent 清除;复用 hostNotice 模式) */
  notices: string[]
  seq: number
}

/** 归一化配置(默认值落位;测试可显式覆盖) */
export function normalizeProposalsConfig(cfg: ProposalsConfig): Required<Omit<ProposalsConfig, 'read' | 'onProposal'>> & Pick<ProposalsConfig, 'read' | 'onProposal'> {
  return {
    read: cfg.read,
    onProposal: cfg.onProposal,
    toolName: cfg.toolName || 'propose_content',
    readToolName: cfg.readToolName || 'read_content',
    contentKind: cfg.contentKind || '内容',
    maxPending: Math.max(1, cfg.maxPending ?? 1),
  }
}

/** 统一读取(同步/异步 read 皆可;异常归一为 {__err} —— 工具内转可读错误串回灌) */
async function readChannel(c: ReturnType<typeof normalizeProposalsConfig>): Promise<{ content: string; label?: string } | null | { __err: unknown }> {
  try {
    return await c.read()
  } catch (e) {
    return { __err: e }
  }
}

/** ops 判别联合 schema(与 ProposalOp 一一对应) */
export const proposalOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace'), find: z.string().min(1).describe('要替换的原文片段(字面匹配,须在全文唯一 —— 多带上下文保唯一)'), with: z.string().describe('替换后的文本') }),
  z.object({ op: z.literal('insertAfter'), anchor: z.string().min(1).describe('锚文本(字面匹配须唯一):新文本插在它之后'), text: z.string().describe('要插入的文本') }),
  z.object({ op: z.literal('insertBefore'), anchor: z.string().min(1).describe('锚文本(字面匹配须唯一):新文本插在它之前'), text: z.string().describe('要插入的文本') }),
  z.object({ op: z.literal('append'), text: z.string().describe('追加到全文末尾的文本') }),
])

/**
 * 装配提案通道:返回两工具 + 会话态 + resolve 函数。
 * deps.emit/log 由 createChatSdk 注入(事件外发 / debugLogs stage:'proposal' 留痕)。
 */
export function createProposalChannel(
  cfg: ProposalsConfig,
  deps: {
    emit: (event: Record<string, unknown>) => void
    log: (kind: string, data?: Record<string, unknown>) => void
  },
): {
  tools: StructuredToolInterface[]
  state: ProposalChannelState
  resolve: (id: string, outcome: 'applied' | 'discarded', detail?: string) => boolean
  snapshot: () => { pending: Array<{ id: string; summary: string; createdAt: number; added: number; removed: number }>; applied: number; discarded: number; lastResolved: ResolvedProposalRecord | null }
} {
  const c = normalizeProposalsConfig(cfg)
  const state: ProposalChannelState = { pending: [], applied: 0, discarded: 0, lastResolved: null, notices: [], seq: 0 }

  const snapshot = () => ({
    pending: state.pending.map((p) => ({ id: p.id, summary: p.summary, createdAt: p.createdAt, added: p.diff.stats.added, removed: p.diff.stats.removed })),
    applied: state.applied,
    discarded: state.discarded,
    lastResolved: state.lastResolved ? { ...state.lastResolved } : null,
  })

  /** 宿主裁决回传:出队 + 计数 + 事件 + 下轮一次性结局注入段(幂等:false = 未知/已裁决) */
  const resolve = (id: string, outcome: 'applied' | 'discarded', detail?: string): boolean => {
    const idx = state.pending.findIndex((p) => p.id === id)
    if (idx === -1) return false
    const [p] = state.pending.splice(idx, 1)
    if (outcome === 'applied') state.applied += 1
    else state.discarded += 1
    state.lastResolved = { id: p.id, outcome, summary: p.summary, ...(detail ? { detail } : {}), at: Date.now() }
    const line = `· 提案「${p.summary}」已被用户${outcome === 'applied' ? '应用(已生效)' : '放弃(内容未变)'}${detail ? `:${detail}` : ''} —— 后续回答以此为准,不要凭提案前状态作答。`
    if (!state.notices.includes(line)) state.notices.push(line)
    if (state.notices.length > 5) state.notices.splice(0, state.notices.length - 5)
    deps.log('resolved', { id: p.id, outcome, summary: p.summary.slice(0, 80) })
    deps.emit({ type: 'proposal_resolved', id: p.id, outcome, summary: p.summary })
    return true
  }

  const readTool = tool(
    async () => {
      const cur = await readChannel(c)
      if (cur && typeof cur === 'object' && '__err' in (cur as Record<string, unknown>)) {
        return `读取失败:${String((cur as { __err: unknown }).__err ?? '未知错误')}。请如实告知用户,不要编造内容。`
      }
      const r = cur as { content?: unknown; label?: unknown } | null
      if (!r || typeof r.content !== 'string') return '当前没有可编辑的内容对象(宿主 read 返回空)。请如实告知用户,不要编造内容。'
      const hash = hashContent(r.content)
      deps.log('read', { hash, chars: r.content.length })
      return `hash=${hash}${typeof r.label === 'string' && r.label ? ` label=${r.label}` : ''} chars=${r.content.length}\n----\n${r.content}`
    },
    {
      name: c.readToolName,
      description: `读取当前${c.contentKind}的原文(修改前必须先调它拿真实基底与 hash)。返回首行是 hash(提案时作 baseHash 原样带回),分隔线后是全文。`,
      schema: z.object({}),
    },
  )

  const proposeSchema = z.object({
    summary: z.string().describe('一句话修改说明(展示在评审面板):改了什么、为什么'),
    baseHash: z.string().describe(`read_content 返回的 hash(基底锚定;基底已变会被拒,须重读)`),
    ops: z.array(proposalOpSchema).min(1).max(50).optional().describe('增量操作(顺序应用,原子;推荐 —— token 只花在改动上,勿全量重发)'),
    content: z.string().optional().describe(`修改后的完整${c.contentKind}(小改动可直发;与 ops 二选一)`),
  }).superRefine((v, ctx2) => {
    const hasOps = Array.isArray(v.ops) && v.ops.length > 0
    const hasContent = typeof v.content === 'string' && v.content.length > 0
    if (hasOps === hasContent) ctx2.addIssue({ code: z.ZodIssueCode.custom, message: 'ops 与 content 必须二选一(且只给一个)' })
  })

  const proposeTool = tool(
    async (args: { summary: string; baseHash: string; ops?: ProposalOp[]; content?: string }) => {
      const cur = await readChannel(c)
      if (cur && typeof cur === 'object' && '__err' in (cur as Record<string, unknown>)) {
        return `提案被拒:读取当前内容失败(${String((cur as { __err: unknown }).__err ?? '未知错误')})。`
      }
      const r = cur as { content?: unknown; label?: unknown } | null
      if (!r || typeof r.content !== 'string') return '提案被拒:当前没有可编辑的内容对象。'
      const base = r.content
      const label = typeof r.label === 'string' ? r.label : undefined
      // 基底锚定(乐观锁哲学平移):模型 read 时的基底 → 提案时重读比对;漂移 = 有人改过,显式拒引导重读
      const curHash = hashContent(base)
      if (args.baseHash !== curHash) {
        deps.log('rejected', { reason: 'base_hash_mismatch' })
        return `提案被拒:基底已变(read_content 之后内容被修改,hash 不匹配)。请重新 ${c.readToolName} 取当前原文与 hash 后基于新基底重提 —— 不要在旧印象上猜测改动。`
      }
      // 应用:ops 增量(SDK 纯函数,原子)或 content 全量
      const applied = Array.isArray(args.ops) && args.ops.length > 0
        ? applyProposalOps(base, args.ops)
        : { ok: true as const, content: String(args.content ?? '') }
      if (!applied.ok) {
        deps.log('rejected', { reason: 'ops_error' })
        return `提案被拒:${applied.error}`
      }
      const next = applied.content
      if (next === base) {
        deps.log('rejected', { reason: 'identical_to_base' })
        return `提案内容与当前源文完全相同,未打开评审面板。`
      }
      // 相同提案去重(同基底 + 同产物 → 拒且**不动在审面板**;4.19 门户实测教训:静默丢弃在审提案)
      if (state.pending.some((p) => p.baseHash === curHash && p.content === next)) {
        deps.log('rejected', { reason: 'identical_pending' })
        return '提案与在审提案内容完全相同(在审面板仍有效,未被替换)。'
      }
      // maxPending 溢出替换(最旧出队,留痕)
      while (state.pending.length >= c.maxPending) {
        const dropped = state.pending.shift()
        if (dropped) deps.log('replaced', { id: dropped.id, summary: dropped.summary.slice(0, 80) })
      }
      state.seq += 1
      const proposal: ReviewableProposal = {
        id: `prop-${state.seq}-${Date.now().toString(36)}`,
        summary: String(args.summary || '(无说明)'),
        ...(label ? { label } : {}),
        baseHash: curHash,
        baseContent: base,
        content: next,
        diff: lineDiff(base, next),
        createdAt: Date.now(),
      }
      state.pending.push(proposal)
      deps.log('pending', { id: proposal.id, summary: proposal.summary.slice(0, 80), added: proposal.diff.stats.added, removed: proposal.diff.stats.removed })
      deps.emit({ type: 'proposal_pending', id: proposal.id, summary: proposal.summary, added: proposal.diff.stats.added, removed: proposal.diff.stats.removed })
      // 非阻塞契约:onProposal 返回即回灌(评审在宿主页,用户可能永远不点 —— 勿等待)
      let reply = ''
      try {
        reply = await c.onProposal(proposal)
      } catch (e) {
        deps.log('on_proposal_error', { message: String((e as Error)?.message ?? e).slice(0, 160) })
        return `提案已送达,但打开评审面板时出错(${String((e as Error)?.message ?? e)})。请如实告知用户。`
      }
      const tail = `(diff 统计:+${proposal.diff.stats.added} / -${proposal.diff.stats.removed} 行;提案待用户在评审面板确认,点「应用」才会写回 —— 请如实告知用户当前是待确认状态。)`
      return typeof reply === 'string' && reply.trim() ? `${reply}\n${tail}` : `提案已送达,评审面板已打开。${tail}`
    },
    { name: c.toolName, description: `提交${c.contentKind}修改提案(仅送达,用户确认才生效)。先 ${c.readToolName} 取基底与 hash,再带 baseHash 提案;优先用 ops 增量操作(token 只花在改动上),锚点用原文字面片段且须唯一命中。`, schema: proposeSchema },
  )

  const tools = [readTool, proposeTool]
  // 通道回调(read/onProposal)是集成方代码:打看门狗标记(永不 settle 时 recoverable 回灌,不杀流)
  markWatchdogTools(tools)
  return { tools, state, resolve, snapshot }
}
