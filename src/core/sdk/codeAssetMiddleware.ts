/**
 * code-as-data-asset checkout/commit 钩子中间件
 *
 * htmlSubagent 单模式(breaking major):代码作为 data 资产(code 字段进服务端 DB),vfs 作编辑工作副本。
 * 框架 beforeAgent 把 data.code 按 __pgId 检出到 vfs(主 vfsStore 共享池,__pgId 文件名隔离,覆盖式刷新);
 * 子 agent vfs_edit 改工作副本;afterAgent 增量回写改过的 vfs → data.code(直改 bind,不经 write,不进快照栈)。
 * 主 agent 全程透明(不碰代码正文;read 主 scope 见 code 摘要挡上下文)。
 *
 * 主 agent "审查代码"是虚假安全感(看不懂细节);真校验在 verify 门禁 + 集成商渲染层。框架无条件 commit
 * 换可靠性 + 零负担(design §2.2 X 全自动方案)。详见 openspec/changes/2026-08-12-code-as-data-asset/design.md §2 §6。
 */
import type { Middleware } from '../harness/middleware'
import type { VfsStore } from '../backends/vfs'
import { normalize as normalizeVfsPath } from '../backends/vfs'
import { supplementPgId, type DataOpsController } from '../tools/dataOps'
import type { Focus } from '../harness/state'
import { getByPath, setByPath } from '../tools/jsonUtils'
import { validateHtmlFormat } from '../tools/htmlValidate'

/** state 上挂载的「本轮子 agent touch 过的 vfs 路径」(子 agent 私有 Set,经 applyUpdate 浅合并保留引用;并发 use_html 互不污染) */
const TOUCHED = '__pgTouched'
/**
 * state 上挂载的「本轮委派各组件的世代号快照」(Map<__pgId, gen>,子 agent 私有;team-audit P1#6)。
 * 共享 vfsStore 命名空间挂当前世代 __pgTouchGen;委派 touch/复用组件即 bump 并快照进本轮 state,
 * afterAgent commit 前比对 —— 不一致 = 新委派已接管该组件(超时重委派竞态),旧代 commit 跳过。
 */
const GEN_SNAPSHOT = '__pgGenSnapshot'
/** state 上挂载的「本轮子 agent 最终回复文本」holder(对象引用,wrapModelCall mutate / afterAgent 读;并发子 agent 实例天然隔离) */
const FINAL = '__pgFinalText'

/** state 上挂载的「checkout 时组件级 code hash」holder(parallel-subagent-delegation Q3c:人工并发冲突检测,keep_external) */
const CODE_HASHES = '__pgCodeHashes'

/**
 * state 上挂载的「commit 时检出 keep_external 的组件名」清单(m4-real-llm 实测驱动)。
 * 仅 console.warn 主 agent 看不到 → 读到人工 stub 误判「子 agent 写了占位符」后直写覆盖人工值;
 * 子 agent 收口时 harness 的 runSubagent 读此清单把提示追加进委派返回值(keep_external 语义随结果回流主上下文)。
 * 同一字符串常量在 subagent.ts 以字面量使用(harness 不 import sdk,同 __pgSubagentCall 先例)。
 */
const KEEP_EXTERNAL = '__pgKeepExternal'

/** 工匠笔记 sidecar 字段名(read 投影隐藏 __pg* 现成;框架直改 bind,不进 schema) */
const NOTES = '__pgNotes'
/** 每组件笔记上限(FIFO 保最近 N 条)与单条长度上限 */
const NOTES_MAX = 5
const NOTE_MAX_CHARS = 200

/**
 * 从文本提取 `[note] ` 前缀行(工匠笔记约定行;htmlSystemPrompt 引导收口回复附实现要点交接)。
 * 容忍列表符号(- 或 *)与空白前缀变体;同行去重。纯函数可单测。
 */
export function extractNoteLinesFromText(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const hit = line.match(/^\s*[-*]?\s*\[note\]\s*(.*)$/i)
    if (hit && hit[1].trim()) out.push('[note] ' + hit[1].trim())
  }
  return [...new Set(out)]
}

/** 笔记 append 到组件(单条截断 + FIFO ≤ NOTES_MAX + 跨轮去重;直改组件对象 = 直改 bind) */
function appendNotes(item: Record<string, unknown>, notes: string[]): void {
  const cur = Array.isArray(item[NOTES]) ? (item[NOTES] as string[]).filter((n) => typeof n === 'string') : []
  const merged = [...new Set([...cur, ...notes])]
    .map((n) => (n.length > NOTE_MAX_CHARS ? n.slice(0, NOTE_MAX_CHARS) + '…' : n))
    .slice(-NOTES_MAX)
  item[NOTES] = merged
}

/**
 * 字符串 hash(djb2 → 32bit hex;Q3c 人工并发 commit 冲突检测用)。
 * 只需检测「变化」无需密码学强度;纯函数导出供单测。
 */
export function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/** 扫 bind 的 writablePaths,收集全部代码组件 name(非空;Q2d 组件锁 knownNames 来源,与文件地图同源) */
export function collectComponentNames(bind: unknown, writablePaths: string[]): string[] {
  const out: string[] = []
  forEachCodeItem(bind, writablePaths, (o) => {
    if (typeof o.name === 'string' && o.name) out.push(o.name)
  })
  return out
}

export interface CodeAssetMiddlewareOptions {
  /** data 可写路径前缀(同 htmlSubagent writablePaths;如 ['components']) */
  writablePaths: string[]
  /** vfs 工作副本路径前缀(同 htmlSubagent codeVfsPrefix;默认 'html/') */
  codeVfsPrefix: string
  /** 代码文件扩展名('html';vfs 文件名 = codeVfsPrefix + __pgId + '.' + ext) */
  ext: 'html'
  /** 代码字段相对组件的 jsonPath(默认 'code';开放 schema 嵌套如 'props.html_code')。「是否代码组件」= 该路径下有 string */
  codeField?: string
  /** 命中校验回调:组件数>0 且 codeField 全员未命中 string → 调一次(防集成方填错路径静默失败;不阻断 checkout) */
  onWarning?: (msg: string) => void
  /** 工匠笔记(默认 true):子 agent 收口回复 [note] 行沉淀为组件 __pgNotes + 文件地图注入,同组件跨委派设计意图持续;false 零沉淀零注入 */
  craftNotes?: boolean
  /** 主 dataOps controller getter(延迟引用:装配期 controller 尚未建,运行时取) */
  getController: () => DataOpsController | null | undefined
  /** 主 vfsStore(工作副本共享池;__pgId 文件名隔离;与子 agent vfs 工具同引用) */
  vfsStore: VfsStore
}

/** 从 vfs 工作副本路径提 __pgId(html/<__pgId>.html → <__pgId>);非该前缀 / 空 id(html/.html) → null */
export function pgIdFromVfsPath(vfsPath: string, prefix: string): string | null {
  if (!vfsPath.startsWith(prefix)) return null
  const fname = vfsPath.slice(prefix.length)  // <__pgId>.ext
  const idx = fname.lastIndexOf('.')
  const pgId = idx > 0 ? fname.slice(0, idx) : (idx === 0 ? '' : fname)  // idx===0:.html → 空 id;idx<0:无扩展名取 fname
  return pgId || null
}

/** 扫 bind 的 writablePaths 数组,回调每个「有 __pgId 的对象元素」(供 checkout/commit/地图 复用;index 为组件在数组中的下标) */
function forEachCodeItem(
  bind: unknown,
  writablePaths: string[],
  cb: (item: Record<string, unknown>, wp: string, index: number) => void,
): void {
  if (!bind || typeof bind !== 'object') return
  for (const wp of writablePaths) {
    const arr = getByPath(bind, wp)
    if (!Array.isArray(arr)) continue
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).__pgId === 'string') {
        cb(item as Record<string, unknown>, wp, i)
      }
    }
  }
}

/**
 * 把焦点 path 集合解析为它们命中的代码组件 __pgId 集合(focus vfs 守卫用)。
 * 命中规则:组件索引路径(如 components.1)=== focus path,或 focus path 以「索引路径.」开头(焦点更细如 components.1.code);
 * 与 write jsonPath / Focus.path 同点号风格(state.ts 注释:jsonPath 锚点如 components.3)。
 * focus 整个数组(components)或非代码字段 → 返空集(等价全允许,放行不误拦 —— 无法精确到单个代码组件)。
 */
function focusPathsToPgIds(
  bind: unknown,
  writablePaths: string[],
  focuses: Focus[],
): Set<string> {
  const allowed = new Set<string>()
  if (!bind || typeof bind !== 'object') return allowed
  for (const wp of writablePaths) {
    const arr = getByPath(bind, wp)
    if (!Array.isArray(arr)) continue
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (!item || typeof item !== 'object') continue
      const pgId = (item as Record<string, unknown>).__pgId
      if (typeof pgId !== 'string') continue
      const idxPath = `${wp}.${i}`
      for (const f of focuses) {
        if (f.path === idxPath || f.path.startsWith(idxPath + '.')) {
          allowed.add(pgId)
          break
        }
      }
    }
  }
  return allowed
}

/**
 * 创建 code-as-data-asset checkout/commit 钩子中间件(createChatSdk 装配期识别 _codeAsset 标记后追加到子 agent config.middleware)。
 *
 * 控制流(design §2.1):
 * - **beforeAgent checkout**:扫 data writablePaths(有 __pgId + code 的项)→ 覆盖式写 vfsStore(`prefix+__pgId+ext`);
 *   初始化 state.__pgTouched(本轮私有 Set)。vfs 始终是 data 最新快照(design §1.2)。
 * - **augmentPrompt 组件代码文件地图**(修 __pgId 映射摩擦:__pgId 随机且对 agent 隐藏,子 agent 拿 name 定位不到 vfs 文件):
 *   每轮注入 name → vfs 路径映射表(标注是否已检出),按 name 直接改对应文件;主 agent 不装本中间件,地图只进子 agent 上下文。
 * - **wrapToolCall hook**:① focus 感知 vfs 白名单(执行前):有焦点时 vfs 代码文件 __pgId 必须在焦点组件 __pgId 集内,越界 PATH_DENIED 回灌自纠
 *   (补 focus.ts 缝隙:WRITE_TOOLS 刻意排除 vfs,但 code-as-data-asset 下子 agent 改代码必经 vfs)。
 *   ② 子 agent vfs_write/vfs_edit/vfs_rm 改 codeVfsPrefix 下文件 → 记 touched(增量 commit 只回写改过的,防全量覆盖未改组件外部修改,design §6.1)。
 * - **afterAgent commit**(verify 门禁通过后跑):touched vfs → data.code(按 __pgId,直改 bind,不经 write → 不进快照栈、不经 schema 校验,
 *   design §2.3)+ 孤儿清理(data 没 __pgId 的 vfs 文件删,design §6.2)+ markDataDirty + recomputeBaseline(防主 agent autoLock 误冲突)。
 */
export function createCodeAssetMiddleware(opts: CodeAssetMiddlewareOptions): Middleware {
  const { writablePaths, codeVfsPrefix, ext, codeField = 'code', onWarning, getController, vfsStore, craftNotes = true } = opts
  // 复用机制 holder(存 vfsStore 命名空间,跨 use_html 委派持久,且 core 可触达供「重新生成」清除):
  //  - __pgLastCheckout:上次 checkout 时 data.code 的 hash(判「data 是否被人工/宿主改过」)
  //  - __pgPendingRetry:vfs 有「未提交的生成代码」且 data 未变 → 保留工作副本并在 afterAgent 重试提交,
  //    修「子 agent 耗时生成的代码被拦后重委派又重生成、浪费 token/时间」(重试写入而非重生成)
  const vfsAny = vfsStore as unknown as { __pgLastCheckout?: Map<string, string>; __pgPendingRetry?: Set<string>; __pgTouchGen?: Map<string, number> }
  const lastCheckoutHash = (vfsAny.__pgLastCheckout ??= new Map<string, string>())
  const pendingRetry = (vfsAny.__pgPendingRetry ??= new Set<string>())
  // team-audit P1#6:per-组件委派世代号(共享 vfsStore 命名空间,跨委派持久;同 __pgLastCheckout 先例)。
  // bump 时机 = 本轮 touch 代码文件 / checkout 走 pendingRetry 复用分支 —— 只锚定「本委派接管了该组件」的信号,
  // 全量 checkout 不 bump(并行异组件委派互不株连);afterAgent 比对,旧代 commit 跳过
  const touchGen = (vfsAny.__pgTouchGen ??= new Map<string, number>())
  return {
    name: 'code-asset-checkout-commit',
    beforeAgent: (state) => {
      const ctrl = getController()
      const bind = ctrl?.get?.().bind
      // ⓪ 宿主路径注入补 __pgId(editor 真实会话诊断驱动,2026-08-21):宿主用自定义工具走自身原生流程
      // 加组件(如编辑器 add_component 直改 reactive bind)不经 SDK write 路径 → internalAfterWrite 的
      // supplementPgId 永远不跑 → 组件无 __pgId → checkout/文件地图/commit 全链路失明,子 agent 无文件
      // 可改(撞轮次上限/谎报成功,commit 零落地)。checkout 入口幂等补齐(与 write 路径同函数同语义),
      // 宿主侧零配合成本;已有 __pgId 保持(幂等)。
      if (bind) supplementPgId(bind, writablePaths)
      // ① checkout:data[<codeField>] → vfsStore(按 __pgId,覆盖式刷新 = data 最新快照;子 agent vfs_edit 直接改 vfsStore 同引用)
      let codeTotal = 0, codeHit = 0
      // Q3c:checkout 时记组件级 code hash(Map<__pgId, hash>,对象引用 holder 经 state 浅合并保留);
      // commit 前比对 —— 不一致 = 人工/宿主在委派窗口内直改了 bind(锁防不了人工,零桥接合法路径),
      // 人工优先(keep_external,对齐乐观锁哲学):跳过该组件 commit + observable 留痕,不覆盖人工值
      const codeHashes: Map<string, string> = new Map()
      // P1#6:本轮世代快照 holder(对象引用,经 state 浅合并保留;复用分支 bump 时写入,touch 时补写)
      const genSnapshot: Map<string, number> = new Map()
      forEachCodeItem(bind, writablePaths, (o) => {
        codeTotal++
        const code = getByPath(o, codeField)
        if (typeof code === 'string') {
          codeHit++
          const pgId = o.__pgId as string
          const curHash = hashString(code)
          codeHashes.set(pgId, curHash)
          const vfsPath = `${codeVfsPrefix}${pgId}.${ext}`
          const existing = vfsStore.files[vfsPath]
          const prev = lastCheckoutHash.get(pgId)
          // 复用:vfs 已有「未提交的生成代码」(existing≠data.code)且 data.code 自上次 checkout 未变
          // (prev===curHash,无人工/宿主改动)→ 保留 vfs 工作副本 + 记 pendingRetry(afterAgent 重试提交),
          // 子 agent 从已生成代码续做/直接重试写入,不重新生成(省 token+时间);
          // 否则(首次/vfs 干净/data 被人工改=人工优先)→ 覆盖式刷新 vfs=data 最新快照
          if (existing && typeof existing.content === 'string' && existing.content !== code && prev === curHash) {
            pendingRetry.add(vfsPath)
            // P1#6:复用分支 = 接管「上一委派未提交的代码」→ bump 世代(旧委派的 wind-down 若迟到,commit 被旧代判定拦下)
            const gen = (touchGen.get(pgId) ?? 0) + 1
            touchGen.set(pgId, gen)
            genSnapshot.set(pgId, gen)
          } else {
            vfsStore.files[vfsPath] = { content: code, updatedAt: Date.now() }
            pendingRetry.delete(vfsPath)
          }
          lastCheckoutHash.set(pgId, curHash)
        }
      })
      // 命中校验:有组件但全员未命中 codeField string → 多半集成方填错路径(静默失败极难排查)。onWarning 提示,不阻断 checkout
      if (codeTotal > 0 && codeHit === 0 && onWarning) {
        let sampleFields = ''
        for (const wp of writablePaths) {
          const arr = getByPath(bind, wp)
          if (Array.isArray(arr) && arr.length) { sampleFields = Object.keys(arr[0] ?? {}).join(','); break }
        }
        onWarning(`codeField '${codeField}' 在当前 ${codeTotal} 个组件中均未命中 string 值。组件实际字段:[${sampleFields}]。若预期有代码组件请核对 codeField 路径;若当前确无代码组件可忽略。`)
      }
      // ② 初始化本轮 touchedVfsPaths(子 agent 私有;经 applyUpdate 浅合并保留引用 → 并发 use_html 互不污染)
      //    + __pgFinalText holder(wrapModelCall 捕获子 agent 最终回复,工匠笔记提取源;对象引用 mutate,并发实例隔离)
      // ③ 注入 vfsStore.files 引用到 state.files(verify 门禁扫 state.files 见 code 工作副本;与 vfs-bridge 同引用,覆盖无副作用)
      //    __pgTouched/__pgFinalText 是框架内部 state 扩展(类 __pgId);TS 上以 Partial<typeof state> 表达,运行时浅合并保留引用
      return { files: vfsStore.files, [TOUCHED]: new Set<string>(), [FINAL]: { text: '' }, [CODE_HASHES]: codeHashes, [KEEP_EXTERNAL]: [] as string[], [GEN_SNAPSHOT]: genSnapshot } as unknown as Partial<typeof state>
    },
    // 捕获子 agent 收口回复(无 tool_calls 的模型响应 = 最终文本;wrap-up 收口轮同经洋葱):工匠笔记提取源。
    // 不用 beforeReturn(maxVerifyAttempts>0 才跑,formatCheck:false 不覆盖)/afterAgent state.messages(createAgent 消息流
    // 在 stream 局部数组,afterAgent 的 state.messages 只有初始 user 消息 —— wrapModelCall 洋葱是唯一全路径覆盖点。
    wrapModelCall: async (req, next) => {
      const resp = await next(req)
      const h = (req.state as unknown as Record<string, unknown>)[FINAL] as { text: string } | undefined
      if (h && !(resp.toolCalls && resp.toolCalls.length) && typeof resp.content === 'string' && resp.content) h.text = resp.content
      return resp
    },
    // 组件代码文件地图(name → vfs 工作副本路径):修 __pgId 映射摩擦 —— __pgId 随机生成且对 agent 隐藏,
    // 子 agent 拿 name 定位不到 vfs 文件(尤其新建组件随机 id)。每轮注入映射表,按 name 直接改对应文件。
    // augmentPrompt 天然跨压缩(每轮重建);主 agent 不装本中间件 → 地图只进子 agent 上下文。
    augmentPrompt: () => {
      const bind = getController()?.get?.().bind
      const lines: string[] = []
      let count = 0
      forEachCodeItem(bind, writablePaths, (o, _wp, i) => {
        count++
        // F3: name 追加数组索引 [i],消除重名/空 name 歧义(主 agent 委派说 name 时,子 agent 按索引+name 精确定位)
        const rawName = typeof o.name === 'string' && o.name ? o.name : ''
        const label = rawName ? `${rawName} [${i}]` : `(未命名 [${i}])`
        const vfsPath = `${codeVfsPrefix}${o.__pgId}.${ext}`
        const checkedOut = !!vfsStore.files[vfsPath]
        lines.push(`- ${label} → ${vfsPath}${checkedOut ? '' : '(尚未检出,先 vfs_write 创建)'}`)
        // 工匠笔记注入:每组件 1 行(最近 1 条 + 总数,防地图膨胀);前任维护者的交接,改该组件时遵循
        if (craftNotes) {
          const ns = Array.isArray(o[NOTES]) ? (o[NOTES] as string[]).filter((x) => typeof x === 'string') : []
          if (ns.length) {
            const latest = ns[ns.length - 1]
            lines.push(`  📝 笔记×${ns.length}(最近):${latest.length > 120 ? latest.slice(0, 120) + '…' : latest}`)
          }
        }
      })
      if (!lines.length) return undefined
      // 追加起始索引(防子 agent 猜索引覆盖已有组件:write components.N 的 N 必须 = 当前数组长度)
      let appendHint = ''
      for (const wp of writablePaths) {
        const arr = getByPath(bind, wp)
        if (Array.isArray(arr)) {
          appendHint = `\n新建组件追加索引:write({patch:{op:'set',jsonPath:'${wp}.${arr.length}',value:{...}}})(当前共 ${arr.length} 个,勿覆盖已有索引)`
          break
        }
      }
      return `## 组件代码文件地图(改组件时按 name 直接改对应 vfs 文件;框架自动 checkout/commit)${craftNotes ? '\n📝 笔记 = 前任维护者交接(设计决策/用户反馈/踩坑),改该组件时遵循;收口回复末行必须附一行 [note] 交接笔记(本组件本次的实现要点),框架存进组件转交下任' : ''}\n${lines.join('\n')}${appendHint}`
    },
    wrapToolCall: async (ctx, next) => {
      const isVfsCodeOp = ctx.name === 'vfs_write' || ctx.name === 'vfs_edit' || ctx.name === 'vfs_rm'
      const rawPath = isVfsCodeOp ? (ctx.args as { path?: unknown } | null)?.path : undefined
      const p = typeof rawPath === 'string' ? normalizeVfsPath(rawPath) : undefined
      const isCodeFile = typeof p === 'string' && p.startsWith(codeVfsPrefix)

      // ① focus 感知 vfs 白名单(执行前):有焦点时,代码文件 __pgId 必须在焦点组件 __pgId 集内。
      //    补 focus.ts 缝隙:WRITE_TOOLS 刻意排除 vfs(path 非数据 jsonPath,与焦点前缀不可比),
      //    但 code-as-data-asset 下子 agent 改代码必经 vfs → 此处按「焦点组件 __pgId」做文件归属判定。
      //    空集 = focus 未精确到代码组件(整个数组/非代码字段)→ 放行,避免误拦。
      if (isCodeFile) {
        const focuses = ctx.state.focuses
        if (focuses && focuses.length) {
          const allowed = focusPathsToPgIds(getController()?.get?.().bind, writablePaths, focuses)
          if (allowed.size) {
            const vfsPgId = pgIdFromVfsPath(p!, codeVfsPrefix)
            if (vfsPgId && !allowed.has(vfsPgId)) {
              const focusFiles = [...allowed].map((x) => `${codeVfsPrefix}${x}.${ext}`).join(', ')
              return {
                content: `PATH_DENIED · vfs 越界:当前聚焦代码文件 [${focusFiles}],你要改的 "${p}" 不在其中。请只改焦点组件的代码文件;如需改其他组件,请在收口回复中说明需先取消聚焦(焦点由主会话/用户管理,你无 focus 工具)后重试。`,
                status: 'error' as const,
              }
            }
          }
        }
      }

      // ② 执行
      const result = await next(ctx)

      // ③ hook vfs 改动 → 记 touched(只认 codeVfsPrefix 下:防误记 offload/drafts 等无关 vfs 写)
      //    + P1#6 世代 bump:本委派首次 touch 该组件 → 接管信号(本轮快照记 gen;重复 touch 不再 bump,防自抬)
      if (isCodeFile) {
        const touched = (ctx.state as unknown as Record<string, unknown>)[TOUCHED] as Set<string> | undefined
        if (touched) touched.add(p!)
        const snap = (ctx.state as unknown as Record<string, unknown>)[GEN_SNAPSHOT] as Map<string, number> | undefined
        const pgId = pgIdFromVfsPath(p!, codeVfsPrefix)
        if (snap && pgId && !snap.has(pgId)) {
          const gen = (touchGen.get(pgId) ?? 0) + 1
          touchGen.set(pgId, gen)
          snap.set(pgId, gen)
        }
      }
      return result
    },
    afterAgent: (state) => {
      const ctrl = getController()
      const bind = ctrl?.get?.().bind
      if (!bind) return
      const touched = ((state as unknown as Record<string, unknown>)[TOUCHED] as Set<string> | undefined) ?? new Set<string>()
      if (touched.size) {
        // Q3c:checkout 时记录的组件级 code hash(commit 前比对人工并发;holder 引用经 state 浅合并保留)
        const codeHashes = ((state as unknown as Record<string, unknown>)[CODE_HASHES] as Map<string, string> | undefined) ?? new Map<string, string>()
        // ① 增量 commit:touched vfs 文件 → data.code(按 __pgId,直改 bind;不经 write → 不进快照栈、不经 schema 校验)
        // 失败隔离(per-component 容错):单组件 commit 抛错只跳过该组件(留痕),循环继续 —— 并行多子 agent 各自 commit 互不传染
        const dataPgIds = new Set<string>()  // data 现有 __pgId(孤儿清理判定用)
        forEachCodeItem(bind, writablePaths, (o) => {
          const pgId = o.__pgId as string
          dataPgIds.add(pgId)
          const vfsPath = `${codeVfsPrefix}${pgId}.${ext}`
          if (!touched.has(vfsPath) && !pendingRetry.has(vfsPath)) return
          // P1#6 委派世代判定:本轮快照 gen ≠ 共享当前 gen = 新委派已接管该组件(超时重委派竞态,
          // 核实员确定性复现:旧 wind-down 读共享 vfs 新委派内容提前 commit → 新委派收口 keep_external
          // 误判 → 最终成果静默丢弃)。旧代 commit 跳过(红线:跳过不排队不重放),且不记 keep_external
          // (世代过期 ≠ 人工修改,误报会让主 agent 得到错误的「人工改过」叙事)
          const genSnap = ((state as unknown as Record<string, unknown>)[GEN_SNAPSHOT] as Map<string, number> | undefined)
          const myGen = genSnap?.get(pgId)
          if (myGen !== undefined && touchGen.get(pgId) !== myGen) {
            console.warn(`[page-agent-sdk][code-asset] 组件 ${o.name ?? pgId}(${vfsPath})已有更新的委派接管,跳过本次旧代 commit(不排队不重放;新委派的 commit 为准)`)
            return  // 跳过该组件 commit;dataPgIds 已加(孤儿清理仍认此组件在 data 中)
          }
          try {
            const f = vfsStore.files[vfsPath]
            if (f && typeof f.content === 'string') {
              // Q3c 人工并发冲突检测(keep_external):当前 bind code hash ≠ checkout 记录 → 委派窗口内人工/宿主直改了
              // 该组件 code(锁防不了人工,零桥接合法路径)→ 人工优先,跳过 commit 保留人工值 + observable 留痕。
              // HTML 文本不做三路合并(不可靠);无记录(如组件 code 为 checkout 后新增)不比对照常 commit
              const rec = codeHashes.get(pgId)
              if (rec !== undefined) {
                const cur = getByPath(o, codeField)
                if (typeof cur !== 'string' || hashString(cur) !== rec) {
                  console.warn(`[page-agent-sdk][code-asset] 组件 ${o.name ?? pgId}(${vfsPath})在修改期间被外部更新,已保留外部版本(keep_external),本次子 agent 修改未提交`)
                  // 记入 state 清单:runSubagent 收口时追加进委派返回值(主 agent 才知道 stub 是人工修改,不会误判后直写覆盖)
                  const kept = (state as unknown as Record<string, unknown>)[KEEP_EXTERNAL] as string[] | undefined
                  const label = String(o.name ?? pgId)
                  if (Array.isArray(kept)) kept.push(label)
                  else (state as unknown as Record<string, unknown>)[KEEP_EXTERNAL] = [label]
                  return  // 跳过该组件 commit;dataPgIds 已加(孤儿清理仍认此组件在 data 中)
                }
              }
              // F2: commit 前校验结构合法性 —— 防 abort/timeout 路径 commit 未跑 verify beforeReturn 的半成品(未闭合标签等)。
              // 正常路径 verify 门禁已用同校验器验过,此处必过(零误伤);仅兜底拦 abort/timeout 半成品,data.code 保持旧值。
              const issues = validateHtmlFormat(f.content)
              if (issues.length) {
                console.warn(`[page-agent-sdk][code-asset] 跳过 commit 未通过校验的半成品(可能 abort/timeout 未跑完 verify):${vfsPath} - ${issues[0].message}(${issues[0].code})`)
                return  // forEachCodeItem 回调内 return = 跳过当前组件 commit;dataPgIds 已加(孤儿清理仍认此组件)
              }
              setByPath(o, codeField, f.content)  // 直改 bind(Vue 响应式触发 UI;不进快照栈;按 codeField 写回嵌套字段)
              pendingRetry.delete(vfsPath)  // 提交成功 → 移出重试集合(下次 checkout 视为干净)
            }
            // vfs_rm 删了文件:f 为空 → 不改 data.code(组件项还在;子 agent 意图删整个组件应 write del components.N,触发孤儿清理)
          } catch (e) {
            // per-component 容错:单组件 commit 异常(读 vfs/setByPath 等)不中断后续组件 commit
            console.warn(`[page-agent-sdk][code-asset] 组件 commit 失败已跳过(其余组件不受影响):${vfsPath} - ${String((e as Error)?.message ?? e)}`)
          }
        })
        // ② 孤儿清理:vfs 工作副本里 __pgId 不在 data 的 → 删 vfs 文件(子 agent write del 删组件后,data 项没了,vfs 文件残留)
        for (const p of touched) {
          const pgId = pgIdFromVfsPath(p, codeVfsPrefix)
          if (pgId && !dataPgIds.has(pgId)) {
            console.warn(`[page-agent-sdk][code-asset] 组件 ${pgId}(${p})已被外部删除,放弃 commit 并清理 vfs 工作副本(不复活组件)`)
            delete vfsStore.files[p]
          }
        }
        // ③ markDataDirty(checkpoint 增量 save)+ recomputeBaseline(主 scope;commit 改 bind 后重算基线,防主 agent 后续 autoLock 误冲突)
        ctrl?.markDataDirty?.()
        ctrl?.recomputeBaseline?.()
      }
      // ④ 工匠笔记沉淀(craftNotes):子 agent 收口回复(wrapModelCall 捕获的 __pgFinalText)[note] 行 → 组件 __pgNotes(FIFO)。
      //    独立于 commit 跑(新建组件走 write 不经 vfs,touched 空也要沉淀);状态在数据里不在实例里:
      //    下次委派同组件,子 agent 经文件地图看到"前任的交接"(设计决策/用户反馈/踩坑)
      if (!craftNotes) return
      const finalText = ((state as unknown as Record<string, unknown>)[FINAL] as { text: string } | undefined)?.text ?? ''
      const notes = extractNoteLinesFromText(finalText)
      if (!notes.length) return
      // 归属候选:touched 组件优先(与 commit 同映射);无 touched(新建场景)按 note 行内 name 精确匹配 data 组件(委派 task 常含 name);都不中则跳过不猜
      const candidates: Array<Record<string, unknown>> = []
      forEachCodeItem(bind, writablePaths, (o) => {
        if (touched.size === 0 || touched.has(`${codeVfsPrefix}${o.__pgId}.${ext}`)) candidates.push(o)
      })
      if (!candidates.length) return
      let dirty = false
      for (const n of notes) {
        const target = candidates.length === 1
          ? candidates[0]
          : candidates.find((o) => typeof o.name === 'string' && !!o.name && n.includes(o.name))
        if (!target) continue  // 多候选但 note 无 name 可匹配 → 不猜归属,跳过该条
        appendNotes(target, [n])
        dirty = true
      }
      if (dirty) ctrl?.markDataDirty?.()  // 笔记进 bind → checkpoint 增量保存(commit 段未跑时也要标脏)
    },
  }
}
