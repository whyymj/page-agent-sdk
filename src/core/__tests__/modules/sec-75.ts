/**
 * sec-75:code-as-data-asset 阶段 C —— createCodeAssetMiddleware checkout/commit 钩子(单模式核心)
 * - 纯函数 pgIdFromVfsPath:正常提取 __pgId / 非 prefix / 无扩展名 / 空 id
 * - beforeAgent checkout:data.code → vfsStore(按 __pgId,覆盖式)+ 初始化 state.__pgTouched(本轮私有)+ 注入 vfsStore.files 引用
 * - wrapToolCall hook:vfs_edit/vfs_write/vfs_rm 改 codeVfsPrefix 下文件 → 记 touched;非 codeVfsPrefix 不记(offload/drafts 不误记);非 vfs 工具不记
 * - afterAgent commit:增量回写(只 touched 的)→ data.code 直改 bind;未 touched 的保持原样(不全量覆盖,防覆盖未改组件的外部修改)
 * - 孤儿清理:data 删组件(__pgId 没了)→ touched 的 vfs 文件删
 * - recomputeBaseline:commit 改 bind 后重算主 scope 基线 → 后续主 agent write autoLock 不误冲突
 * - 直改 bind 不进快照栈:afterAgent 仅 o.code = f.content + markDataDirty + recomputeBaseline,无 pushSnapshot(design §2.3;代码事实)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'
import { createCodeAssetMiddleware, pgIdFromVfsPath } from '../../sdk/codeAssetMiddleware'
import { applyUpdate } from '../../harness/middleware'
import { createInitialState } from '../../harness/state'
import type { TestCtx } from './_ctx'

function setup(bind: Record<string, unknown>) {
  const tools = createDataOps({
    schema: z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), code: z.string() })),
    }),
    bind,
    description: '测试',
  }, { pgIdPaths: ['components'] } as any)
  const controller = (tools as any).controller
  const vfsStore = createVfs()
  const mw = createCodeAssetMiddleware({
    writablePaths: ['components'],
    codeVfsPrefix: 'html/',
    ext: 'vue',
    getController: () => controller,
    vfsStore,
  })
  return { tools, controller, vfsStore, mw }
}

/** 模拟子 agent 跑完一轮(beforeAgent → vfs_edit → afterAgent)的 state */
function runRound(mw: any, vfsEdits: Array<{ path: string; content: string }>, bind: any, vfsStore: any) {
  const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
  for (const e of vfsEdits) {
    vfsStore.files[e.path] = { content: e.content, updatedAt: 0 }
  }
  return st
}

const mockNext = async () => ({ content: 'ok', status: 'done' as const })

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[code-as-data-asset · codeAsset checkout/commit 钩子(单模式)]')

  // ===== pgIdFromVfsPath 纯函数 =====
  {
    assert(pgIdFromVfsPath('html/c_abc.vue', 'html/') === 'c_abc', '✓ 正常提取 __pgId(html/c_abc.vue → c_abc)')
    assert(pgIdFromVfsPath('other/c_x.vue', 'html/') === null, '✓ 非 codeVfsPrefix 前缀 → null')
    assert(pgIdFromVfsPath('html/nodot', 'html/') === 'nodot', '✓ 无扩展名 → 取整个 fname')
    assert(pgIdFromVfsPath('html/.vue', 'html/') === null, '✓ 空 __pgId(html/.vue)→ null')
  }

  // ===== beforeAgent checkout:data.code → vfsStore(按 __pgId,覆盖式)+ __pgTouched 初始化 + files 引用 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }, { __pgId: 'c_b', name: 'b', code: '<b/>' }] }
    const { vfsStore, mw } = setup(bind)
    const update = mw.beforeAgent!(createInitialState()) as any
    assert(vfsStore.files['html/c_a.vue']?.content === '<p>old</p>', '✓ checkout:components[0].code → vfsStore html/c_a.vue')
    assert(vfsStore.files['html/c_b.vue']?.content === '<b/>', '✓ checkout:components[1].code → vfsStore html/c_b.vue')
    assert(update.files === vfsStore.files, '✓ beforeAgent 返回 state.files = vfsStore.files 引用(verify 扫此见 code 工作副本)')
    assert(update.__pgTouched instanceof Set && update.__pgTouched.size === 0, '✓ beforeAgent 初始化 __pgTouched 空 Set(本轮私有,并发隔离)')
  }

  // ===== wrapToolCall hook:vfs_* 改 codeVfsPrefix 下文件 → 记 touched;非 prefix / 非 vfs 工具不记 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
    vfsStore.files['html/c_a.vue'] = { content: '<p>new</p>', updatedAt: 0 }
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.vue', oldString: 'a', newString: 'b' }, state: st } as any, mockNext)
    assert((st as any).__pgTouched.has('html/c_a.vue'), '✓ wrapToolCall:vfs_edit 改 codeVfsPrefix 下文件 → 记 touched')
    await mw.wrapToolCall!({ name: 'vfs_write', args: { path: 'large_results/x.json', content: '{}' }, state: st } as any, mockNext)
    assert(!(st as any).__pgTouched.has('large_results/x.json'), '✓ wrapToolCall:非 codeVfsPrefix 路径不记(防误记 offload/drafts 等无关 vfs 写)')
    await mw.wrapToolCall!({ name: 'read', args: { jsonPath: 'components' }, state: st } as any, mockNext)
    assert((st as any).__pgTouched.size === 1, '✓ wrapToolCall:非 vfs 工具(read)不记 touched')
  }

  // ===== afterAgent commit:增量回写(只 touched 的);未 touched 的 data.code 不变 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }, { __pgId: 'c_b', name: 'b', code: '<b>old</b>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [{ path: 'html/c_a.vue', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.vue', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>NEW</p>', '✓ commit:touched 的 c_a.code 增量回写 data(直改 bind)')
    assert(bind.components[1].code === '<b>old</b>', '✓ commit:未 touched 的 c_b.code 保持原样(增量,不全量覆盖,防覆盖未改组件的外部修改)')
  }

  // ===== 孤儿清理:data 删组件(__pgId 没了),touched 的 vfs 文件 → 删 vfs =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [], bind, vfsStore)
    assert(vfsStore.files['html/c_a.vue']?.content === '<p/>', '✓ checkout 建 vfs 工作副本')
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.vue', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    bind.components.length = 0  // 子 agent write del 删了组件(data 项没了)
    mw.afterAgent!(st)
    assert(!vfsStore.files['html/c_a.vue'], '✓ 孤儿清理:data 删了组件 __pgId → 删 vfs 文件(不留残骸)')
  }

  // ===== recomputeBaseline:commit 改 bind 后重算主 scope 基线 → 后续主 agent write autoLock 不误冲突 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }] }
    const { tools, vfsStore, mw } = setup(bind)
    const t = byName(tools)
    await invoke(t['read'], {})  // 建主 scope baseline H1
    // 子 agent checkout + vfs_edit + commit(改 code → bind 变 H2 + recomputeBaseline 主 baseline=H2)
    const st = runRound(mw, [{ path: 'html/c_a.vue', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.vue', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>NEW</p>', '✓ commit 回写 data.code(直改 bind)')
    // 主 agent 后续 write(autoLock 默认开):baseline 已重算 = 当前 → 不冲突
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'T2' } })
    assert(!/VERSION_CONFLICT/.test(r) && bind.title === 'T2', '✓ recomputeBaseline:commit 后主 agent write autoLock 不误冲突(主 baseline 已重算)')
  }

  // ===== 直改 bind 不进快照栈(design §2.3):afterAgent 仅 o.code=f.content + markDataDirty + recomputeBaseline,无 pushSnapshot =====
  // 代码事实保证(afterAgent 无 pushSnapshot 调用);逻辑层由上面「commit 回写 + recomputeBaseline」覆盖,快照栈私有不入断言
}
