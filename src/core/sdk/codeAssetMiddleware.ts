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
import type { DataOpsController } from '../tools/dataOps'
import type { Focus } from '../harness/state'
import { getByPath } from '../tools/jsonUtils'

/** state 上挂载的「本轮子 agent touch 过的 vfs 路径」(子 agent 私有 Set,经 applyUpdate 浅合并保留引用;并发 use_html 互不污染) */
const TOUCHED = '__pgTouched'

export interface CodeAssetMiddlewareOptions {
  /** data 可写路径前缀(同 htmlSubagent writablePaths;如 ['components']) */
  writablePaths: string[]
  /** vfs 工作副本路径前缀(同 htmlSubagent codeVfsPrefix;默认 'html/') */
  codeVfsPrefix: string
  /** 代码文件扩展名('vue' | 'html';vfs 文件名 = codeVfsPrefix + __pgId + '.' + ext) */
  ext: 'vue' | 'html'
  /** 主 dataOps controller getter(延迟引用:装配期 controller 尚未建,运行时取) */
  getController: () => DataOpsController | null | undefined
  /** 主 vfsStore(工作副本共享池;__pgId 文件名隔离;与子 agent vfs 工具同引用) */
  vfsStore: VfsStore
}

/** 从 vfs 工作副本路径提 __pgId(html/<__pgId>.vue → <__pgId>);非该前缀 / 空 id(html/.vue) → null */
export function pgIdFromVfsPath(vfsPath: string, prefix: string): string | null {
  if (!vfsPath.startsWith(prefix)) return null
  const fname = vfsPath.slice(prefix.length)  // <__pgId>.ext
  const idx = fname.lastIndexOf('.')
  const pgId = idx > 0 ? fname.slice(0, idx) : (idx === 0 ? '' : fname)  // idx===0:.vue → 空 id;idx<0:无扩展名取 fname
  return pgId || null
}

/** 扫 bind 的 writablePaths 数组,回调每个「有 __pgId 的对象元素」(供 checkout/commit 复用) */
function forEachCodeItem(
  bind: unknown,
  writablePaths: string[],
  cb: (item: Record<string, unknown>, wp: string) => void,
): void {
  if (!bind || typeof bind !== 'object') return
  for (const wp of writablePaths) {
    const arr = getByPath(bind, wp)
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).__pgId === 'string') {
        cb(item as Record<string, unknown>, wp)
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
  const { writablePaths, codeVfsPrefix, ext, getController, vfsStore } = opts
  return {
    name: 'code-asset-checkout-commit',
    beforeAgent: (state) => {
      // ① checkout:data.code → vfsStore(按 __pgId,覆盖式刷新 = data 最新快照;子 agent vfs_edit 直接改 vfsStore 同引用)
      const ctrl = getController()
      const bind = ctrl?.get?.().bind
      forEachCodeItem(bind, writablePaths, (o) => {
        if (typeof o.code === 'string') {
          const vfsPath = `${codeVfsPrefix}${o.__pgId}.${ext}`
          vfsStore.files[vfsPath] = { content: o.code, updatedAt: Date.now() }
        }
      })
      // ② 初始化本轮 touchedVfsPaths(子 agent 私有;经 applyUpdate 浅合并保留引用 → 并发 use_html 互不污染)
      // ③ 注入 vfsStore.files 引用到 state.files(verify 门禁扫 state.files 见 code 工作副本;与 vfs-bridge 同引用,覆盖无副作用)
      //    __pgTouched 是框架内部 state 扩展(类 __pgId);TS 上以 Partial<typeof state> 表达,运行时浅合并保留 Set 引用
      return { files: vfsStore.files, [TOUCHED]: new Set<string>() } as unknown as Partial<typeof state>
    },
    // 组件代码文件地图(name → vfs 工作副本路径):修 __pgId 映射摩擦 —— __pgId 随机生成且对 agent 隐藏,
    // 子 agent 拿 name 定位不到 vfs 文件(尤其新建组件随机 id)。每轮注入映射表,按 name 直接改对应文件。
    // augmentPrompt 天然跨压缩(每轮重建);主 agent 不装本中间件 → 地图只进子 agent 上下文。
    augmentPrompt: () => {
      const bind = getController()?.get?.().bind
      const lines: string[] = []
      forEachCodeItem(bind, writablePaths, (o) => {
        const name = typeof o.name === 'string' && o.name ? o.name : '(未命名)'
        const vfsPath = `${codeVfsPrefix}${o.__pgId}.${ext}`
        const checkedOut = !!vfsStore.files[vfsPath]
        lines.push(`- ${name} → ${vfsPath}${checkedOut ? '' : '(尚未检出,先 vfs_write 创建)'}`)
      })
      if (!lines.length) return undefined
      return `## 组件代码文件地图(改组件时按 name 直接改对应 vfs 文件;框架自动 checkout/commit)\n${lines.join('\n')}`
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
                content: `PATH_DENIED · vfs 越界:当前聚焦代码文件 [${focusFiles}],你要改的 "${p}" 不在其中。请只改焦点组件的代码文件;如需改其他组件,请让主 agent clear_focus / 换焦点后重试。`,
                status: 'error' as const,
              }
            }
          }
        }
      }

      // ② 执行
      const result = await next(ctx)

      // ③ hook vfs 改动 → 记 touched(只认 codeVfsPrefix 下:防误记 offload/drafts 等无关 vfs 写)
      if (isCodeFile) {
        const touched = (ctx.state as unknown as Record<string, unknown>)[TOUCHED] as Set<string> | undefined
        if (touched) touched.add(p!)
      }
      return result
    },
    afterAgent: (state) => {
      const ctrl = getController()
      const bind = ctrl?.get?.().bind
      const touched = (state as unknown as Record<string, unknown>)[TOUCHED] as Set<string> | undefined
      if (!bind || !touched || !touched.size) return
      // ① 增量 commit:touched vfs 文件 → data.code(按 __pgId,直改 bind;不经 write → 不进快照栈、不经 schema 校验)
      const dataPgIds = new Set<string>()  // data 现有 __pgId(孤儿清理判定用)
      forEachCodeItem(bind, writablePaths, (o) => {
        const pgId = o.__pgId as string
        dataPgIds.add(pgId)
        const vfsPath = `${codeVfsPrefix}${pgId}.${ext}`
        if (touched.has(vfsPath)) {
          const f = vfsStore.files[vfsPath]
          if (f && typeof f.content === 'string') {
            o.code = f.content  // 直改 bind(Vue 响应式触发 UI;不进快照栈)
          }
          // vfs_rm 删了文件:f 为空 → 不改 data.code(组件项还在;子 agent 意图删整个组件应 write del components.N,触发孤儿清理)
        }
      })
      // ② 孤儿清理:vfs 工作副本里 __pgId 不在 data 的 → 删 vfs 文件(子 agent write del 删组件后,data 项没了,vfs 文件残留)
      for (const p of touched) {
        const pgId = pgIdFromVfsPath(p, codeVfsPrefix)
        if (pgId && !dataPgIds.has(pgId)) {
          delete vfsStore.files[p]
        }
      }
      // ③ markDataDirty(checkpoint 增量 save)+ recomputeBaseline(主 scope;commit 改 bind 后重算基线,防主 agent 后续 autoLock 误冲突)
      ctrl?.markDataDirty?.()
      ctrl?.recomputeBaseline?.()
    },
  }
}
