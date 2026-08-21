/**
 * sec-75:code-as-data-asset 阶段 C —— createCodeAssetMiddleware checkout/commit 钩子(单模式核心)
 * - 纯函数 pgIdFromVfsPath:正常提取 __pgId / 非 prefix / 无扩展名 / 空 id
 * - beforeAgent checkout:data.code → vfsStore(按 __pgId,覆盖式)+ 初始化 state.__pgTouched(本轮私有)+ 注入 vfsStore.files 引用
 * - wrapToolCall hook:vfs_edit/vfs_write/vfs_rm 改 codeVfsPrefix 下文件 → 记 touched;非 codeVfsPrefix 不记(offload/drafts 不误记);非 vfs 工具不记
 * - wrapToolCall focus 守卫:有焦点(state.focuses)时 vfs 代码文件 __pgId 必须在焦点组件集内,越界 PATH_DENIED;focus 整个数组/无 focus → 放行(补 focus.ts 排除 vfs 缝隙)
 * - afterAgent commit:增量回写(只 touched 的)→ data.code 直改 bind;未 touched 的保持原样(不全量覆盖,防覆盖未改组件的外部修改)
 * - 孤儿清理:data 删组件(__pgId 没了)→ touched 的 vfs 文件删
 * - recomputeBaseline:commit 改 bind 后重算主 scope 基线 → 后续主 agent write autoLock 不误冲突
 * - 直改 bind 不进快照栈:afterAgent 仅 o.code = f.content + markDataDirty + recomputeBaseline,无 pushSnapshot(design §2.3;代码事实)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'
import { createCodeAssetMiddleware, pgIdFromVfsPath, extractNoteLinesFromText } from '../../sdk/codeAssetMiddleware'
import { createHtmlValidateToolsMiddleware } from '../../sdk/htmlSubagent'
import { applyUpdate } from '../../harness/middleware'
import { createInitialState } from '../../harness/state'
import type { TestCtx } from './_ctx'

function setup(bind: Record<string, unknown>, opts?: { codeField?: string; onWarning?: (msg: string) => void; craftNotes?: boolean }) {
  const tools = createDataOps({
    schema: z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), code: z.string() })),
    }),
    bind,
    description: '测试',
  }, { pgIdPaths: ['components'], conflictWatchFields: ['*'] } as any)
  const controller = (tools as any).controller
  const vfsStore = createVfs()
  const mw = createCodeAssetMiddleware({
    writablePaths: ['components'],
    codeVfsPrefix: 'html/',
    ext: 'html',
    codeField: opts?.codeField,
    onWarning: opts?.onWarning,
    craftNotes: opts?.craftNotes,
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
    assert(pgIdFromVfsPath('html/c_abc.html', 'html/') === 'c_abc', '✓ 正常提取 __pgId(html/c_abc.html → c_abc)')
    assert(pgIdFromVfsPath('other/c_x.html', 'html/') === null, '✓ 非 codeVfsPrefix 前缀 → null')
    assert(pgIdFromVfsPath('html/nodot', 'html/') === 'nodot', '✓ 无扩展名 → 取整个 fname')
    assert(pgIdFromVfsPath('html/.html', 'html/') === null, '✓ 空 __pgId(html/.html)→ null')
  }

  // ===== beforeAgent checkout:data.code → vfsStore(按 __pgId,覆盖式)+ __pgTouched 初始化 + files 引用 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }, { __pgId: 'c_b', name: 'b', code: '<b/>' }] }
    const { vfsStore, mw } = setup(bind)
    const update = mw.beforeAgent!(createInitialState()) as any
    assert(vfsStore.files['html/c_a.html']?.content === '<p>old</p>', '✓ checkout:components[0].code → vfsStore html/c_a.html')
    assert(vfsStore.files['html/c_b.html']?.content === '<b/>', '✓ checkout:components[1].code → vfsStore html/c_b.html')
    assert(update.files === vfsStore.files, '✓ beforeAgent 返回 state.files = vfsStore.files 引用(verify 扫此见 code 工作副本)')
    assert(update.__pgTouched instanceof Set && update.__pgTouched.size === 0, '✓ beforeAgent 初始化 __pgTouched 空 Set(本轮私有,并发隔离)')
  }

  // ===== ⓪ 宿主路径注入补 __pgId(editor 诊断驱动 2026-08-21):宿主原生流程加的组件(无 __pgId)checkout 入口幂等补齐 =====
  {
    // ① 无 __pgId(模拟编辑器 add_component 直改 bind)→ checkout 补齐 + 建 vfs 工作副本
    const bind: any = { title: 't', components: [{ name: 'host-added', code: '<p>placeholder</p>' }] }
    const { vfsStore, mw } = setup(bind)
    mw.beforeAgent!(createInitialState())
    const pgId = bind.components[0].__pgId
    assert(typeof pgId === 'string' && pgId, '✓ 宿主路径注入:beforeAgent 给无 __pgId 的宿主添加组件补 __pgId(幂等)')
    assert(vfsStore.files[`html/${pgId}.html`]?.content === '<p>placeholder</p>', '✓ 宿主路径注入:补齐后 checkout 建 vfs 工作副本(子 agent 有文件可改)')
    // ② 幂等:已有 __pgId 保持,再跑不换 id
    mw.beforeAgent!(createInitialState())
    assert(bind.components[0].__pgId === pgId, '✓ 宿主路径注入:已有 __pgId 保持(幂等,不换映射键)')
    // ③ 全链路:宿主组件 → checkout 补齐 → vfs_edit → afterAgent commit 落地 data.code
    const st = runRound(mw, [{ path: `html/${pgId}.html`, content: '<p>real code</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: `html/${pgId}.html`, oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>real code</p>', '✓ 宿主路径注入:全链路 commit 落地(委派改码回写宿主组件,editor「说干完了实际没写入」根因修复)')
  }

  // ===== wrapToolCall hook:vfs_* 改 codeVfsPrefix 下文件 → 记 touched;非 prefix / 非 vfs 工具不记 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
    vfsStore.files['html/c_a.html'] = { content: '<p>new</p>', updatedAt: 0 }
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'a', newString: 'b' }, state: st } as any, mockNext)
    assert((st as any).__pgTouched.has('html/c_a.html'), '✓ wrapToolCall:vfs_edit 改 codeVfsPrefix 下文件 → 记 touched')
    await mw.wrapToolCall!({ name: 'vfs_write', args: { path: 'large_results/x.json', content: '{}' }, state: st } as any, mockNext)
    assert(!(st as any).__pgTouched.has('large_results/x.json'), '✓ wrapToolCall:非 codeVfsPrefix 路径不记(防误记 offload/drafts 等无关 vfs 写)')
    await mw.wrapToolCall!({ name: 'read', args: { jsonPath: 'components' }, state: st } as any, mockNext)
    assert((st as any).__pgTouched.size === 1, '✓ wrapToolCall:非 vfs 工具(read)不记 touched')
  }

  // ===== afterAgent commit:增量回写(只 touched 的);未 touched 的 data.code 不变 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }, { __pgId: 'c_b', name: 'b', code: '<b>old</b>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>NEW</p>', '✓ commit:touched 的 c_a.code 增量回写 data(直改 bind)')
    assert(bind.components[1].code === '<b>old</b>', '✓ commit:未 touched 的 c_b.code 保持原样(增量,不全量覆盖,防覆盖未改组件的外部修改)')
  }

  // ===== F2: commit 前校验,abort/timeout 半成品不污染 data.code(正常路径零误伤)=====
  {
    // ① touched vfs 是未闭合半成品(模拟 abort/timeout 未跑 verify beforeReturn)→ 跳过 commit,data.code 保持旧值
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<div>半成品未闭合' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>old</p>', '✓ F2: touched vfs 是未闭合半成品 → afterAgent 跳过 commit,data.code 保持旧值(防 abort/timeout 污染)')
    // ② 对照:合法内容正常 commit(正常路径 verify 已过,此处校验零误伤)
    const bind2: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }] }
    const { vfsStore: vs2, mw: mw2 } = setup(bind2)
    const st2 = runRound(mw2, [{ path: 'html/c_a.html', content: '<p>合法新内容</p>' }], bind2, vs2)
    await mw2.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st2 } as any, mockNext)
    mw2.afterAgent!(st2)
    assert(bind2.components[0].code === '<p>合法新内容</p>', '✓ F2: 合法内容正常 commit(正常路径零误伤,verify 门禁已过的此处必过)')
  }

  // ===== 孤儿清理:data 删组件(__pgId 没了),touched 的 vfs 文件 → 删 vfs =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [], bind, vfsStore)
    assert(vfsStore.files['html/c_a.html']?.content === '<p/>', '✓ checkout 建 vfs 工作副本')
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    bind.components.length = 0  // 子 agent write del 删了组件(data 项没了)
    mw.afterAgent!(st)
    assert(!vfsStore.files['html/c_a.html'], '✓ 孤儿清理:data 删了组件 __pgId → 删 vfs 文件(不留残骸)')
  }

  // ===== recomputeBaseline:commit 改 bind 后重算主 scope 基线 → 后续主 agent write autoLock 不误冲突 =====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>old</p>' }] }
    const { tools, vfsStore, mw } = setup(bind)
    const t = byName(tools)
    await invoke(t['read'], {})  // 建主 scope baseline H1
    // 子 agent checkout + vfs_edit + commit(改 code → bind 变 H2 + recomputeBaseline 主 baseline=H2)
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].code === '<p>NEW</p>', '✓ commit 回写 data.code(直改 bind)')
    // 主 agent 后续 write(['*'] 全字段检测):baseline 已重算 = 当前 → 不冲突
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'T2' } })
    assert(!/VERSION_CONFLICT/.test(r) && bind.title === 'T2', '✓ recomputeBaseline:commit 后主 agent write 全字段检测不误冲突(主 baseline 已重算)')
  }

  // ===== wrapToolCall focus 感知 vfs 白名单:有焦点时跨组件改代码 → PATH_DENIED(补 focus.ts 刻意排除 vfs 的缝隙)=====
  // code-as-data-asset 下子 agent 改代码必经 vfs_edit;focus.ts WRITE_TOOLS 排除 vfs(vfs path 非数据 jsonPath),
  // 故在此按「焦点组件 __pgId」做 vfs 文件归属判定 —— 子 agent 继承主焦点后,只能改焦点组件的代码文件
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }, { __pgId: 'c_b', name: 'b', code: '<b/>' }] }
    const { mw } = setup(bind)
    // 模拟子 agent 继承主焦点:codeAsset mw 本身不装 focus,手动注入 state.focuses(等同 focus 中间件 beforeAgent 产物)
    const baseSt = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)

    // ① focus components.0(只 c_a):vfs_edit 焦点 c_a → 放行;c_b → PATH_DENIED
    const st = applyUpdate(baseSt, { focuses: [{ path: 'components.0', label: 'a' }] } as any)
    const r1 = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    assert(r1.status === 'done', '✓ focus 守卫:vfs_edit 焦点组件文件(c_a)→ 放行')
    assert((st as any).__pgTouched.has('html/c_a.html'), '✓ focus 守卫放行后仍记 touched(c_a)')
    const r2 = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_b.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    assert(r2.status === 'error' && /PATH_DENIED/.test(r2.content), '✓ focus 守卫:vfs_edit 非焦点组件文件(c_b)→ PATH_DENIED 回灌(补 focus.ts 刻意排除 vfs 的缝隙)')
    assert(!(st as any).__pgTouched.has('html/c_b.html'), '✓ focus 守卫拦截:不记 touched(未执行 next)')

    // ② focus 更细 components.0.code → 前缀匹配仍命中 c_a 放行
    const st2 = applyUpdate(baseSt, { focuses: [{ path: 'components.0.code' }] } as any)
    const r3 = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html' }, state: st2 } as any, mockNext)
    assert(r3.status === 'done', '✓ focus 更细(components.0.code)→ 前缀匹配命中 c_a 放行')

    // ③ focus 整个数组 components → focusPathsToPgIds 不匹配 components.0/1 → 空集放行(无法精确到单个组件,不误拦)
    const st3 = applyUpdate(baseSt, { focuses: [{ path: 'components' }] } as any)
    const r4 = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_b.html' }, state: st3 } as any, mockNext)
    assert(r4.status === 'done', '✓ focus 整个 components 数组 → 空集放行(无法精确到单个组件,不误拦)')

    // ④ 无 focus(baseSt 无 focuses)→ 全放行(原行为零回归)
    const r5 = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_b.html' }, state: baseSt } as any, mockNext)
    assert(r5.status === 'done', '✓ 无 focus → 全放行(原行为零回归)')
  }

  // ===== augmentPrompt 组件代码文件地图(name → vfs 路径;修 __pgId 映射摩擦:随机 id 对 agent 隐藏,按 name 定位不到文件)=====
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'hero', code: '<p/>' }, { __pgId: 'c_b', name: 'banner', code: '<b/>' }] }
    const { vfsStore, mw } = setup(bind)
    mw.beforeAgent!(createInitialState())  // checkout → vfs 文件存在(c_a/c_b 均已检出)
    const map = (mw as any).augmentPrompt!()
    assert(typeof map === 'string' && map.includes('组件代码文件地图'), '✓ augmentPrompt:注入「组件代码文件地图」段')
    assert(map.includes('hero [0] → html/c_a.html') && map.includes('banner [1] → html/c_b.html'), '✓ 地图含 name [索引] → vfs 路径映射(按 name 直接定位文件,无需猜随机 __pgId)')
    assert(/新建组件追加索引.*components\.2.*当前共 2 个/.test(map), '✓ 地图注入追加索引提示(components.N,N=当前数组长度,防子 agent 猜索引覆盖)')
    assert(!map.includes('尚未检出'), '✓ 已 checkout 的组件不标「尚未检出」')
    // 新组件(bind 有 __pgId 但 vfs 未检出)→ 标注「尚未检出,先 vfs_write 创建」
    bind.components.push({ __pgId: 'c_new', name: 'fresh', code: '<i/>' })
    const map2 = (mw as any).augmentPrompt!()
    assert(map2.includes('fresh [2] → html/c_new.html(尚未检出,先 vfs_write 创建)'), '✓ 未检出组件标注「尚未检出,先 vfs_write 创建」(同轮新建组件再改场景;name 带 [索引])')
    // 无代码组件 → undefined(不注入,零开销)
    const { mw: mwEmpty } = setup({ title: 't', components: [] } as any)
    assert((mwEmpty as any).augmentPrompt!() === undefined, '✓ 无代码组件 → 不注入地图(零开销)')
    vfsStore.files['html/c_a.html'] = { content: 'x', updatedAt: 0 }  // 还原(防后续用例依赖)
  }

  // ===== F3: 重名/空 name 组件 → name [索引] 区分(主 agent 委派说 name 时,地图不歧义)=====
  {
    const bind: any = { title: 't', components: [
      { __pgId: 'c_x', name: 'card', code: '<p/>' },
      { __pgId: 'c_y', name: 'card', code: '<b/>' },   // 重名 card
      { __pgId: 'c_z', code: '<i/>' },                  // 空 name
    ] }
    const { mw } = setup(bind)
    mw.beforeAgent!(createInitialState())
    const map = (mw as any).augmentPrompt!()
    assert(map.includes('card [0] → html/c_x.html') && map.includes('card [1] → html/c_y.html'), '✓ F3: 重名 name(card)按索引 [0]/[1] 区分,地图不歧义')
    assert(map.includes('(未命名 [2]) → html/c_z.html'), '✓ F3: 空 name 组件标注 (未命名 [索引]),不丢地图条目')
  }

  // ===== 直改 bind 不进快照栈(design §2.3):afterAgent 仅 o.code=f.content + markDataDirty + recomputeBaseline,无 pushSnapshot =====
  // 代码事实保证(afterAgent 无 pushSnapshot 调用);逻辑层由上面「commit 回写 + recomputeBaseline」覆盖,快照栈私有不入断言

  // ===== html-subagent-open-schema:可配置 codeField(开放 schema 嵌套如 props.html_code)+ 命中校验(防静默失败)=====
  // ① 嵌套 codeField checkout/commit 往返:checkout 从嵌套路径读 → vfs;commit setByPath 写回嵌套(惰性建中间对象)
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'hero', props: { html_code: '<p>嵌套</p>' } }] }
    const { vfsStore, mw } = setup(bind, { codeField: 'props.html_code' })
    mw.beforeAgent!(createInitialState())  // checkout
    assert(vfsStore.files['html/c_a.html']?.content === '<p>嵌套</p>', '✓ 嵌套 codeField(props.html_code)checkout:从嵌套路径读 code → vfs')
    const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
    vfsStore.files['html/c_a.html'] = { content: '<p>嵌套新</p>', updatedAt: 0 }
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html', oldString: 'x', newString: 'y' }, state: st } as any, mockNext)
    mw.afterAgent!(st)
    assert(bind.components[0].props.html_code === '<p>嵌套新</p>', '✓ 嵌套 codeField commit:setByPath 写回 props.html_code(非顶层 code,惰性建中间段)')
  }

  // ② 命中校验:有组件但 codeField 全员未命中 string → onWarning;部分命中 → 不 warning;无组件 → 不误报
  {
    let warnMsg = ''
    const bindMiss: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', props: { other: 'x' } }, { __pgId: 'c_b', name: 'b' }] }
    const { mw: mwMiss } = setup(bindMiss, { codeField: 'props.html_code', onWarning: (m) => { warnMsg = m } })
    mwMiss.beforeAgent!(createInitialState())
    assert(warnMsg.includes('props.html_code') && warnMsg.includes('2 个'), '✓ 命中校验:有组件但 codeField 全员未命中 → onWarning(含 codeField 值 + 组件数,防集成方填错路径静默失败)')
    assert(warnMsg.includes('实际字段'), '✓ warning 文案含组件实际字段名(助集成方核对路径)')

    let warned2 = false
    const bindPart: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', props: { html_code: '<p/>' } }, { __pgId: 'c_b', name: 'b' }] }
    const { mw: mwPart } = setup(bindPart, { codeField: 'props.html_code', onWarning: () => { warned2 = true } })
    mwPart.beforeAgent!(createInitialState())
    assert(!warned2, '✓ 命中校验:部分命中(≥1 组件有 code)→ 不 warning(避免误报)')

    let warned3 = false
    const { mw: mwEmpty } = setup({ title: 't', components: [] } as any, { codeField: 'props.html_code', onWarning: () => { warned3 = true } })
    mwEmpty.beforeAgent!(createInitialState())
    assert(!warned3, '✓ 命中校验:无组件 → 不 warning(不误报)')
  }

  // ③ 默认 codeField('code')零回归:setup 不传 codeField → 读顶层 .code(原行为)
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p>默认</p>' }] }
    const { vfsStore, mw } = setup(bind)  // 不传 codeField → 默认 'code'
    mw.beforeAgent!(createInitialState())
    assert(vfsStore.files['html/c_a.html']?.content === '<p>默认</p>', '✓ 默认 codeField("code")零回归:不传 → 读顶层 .code(原行为)')
  }

  // ===== thinking-taming ②: validate_code jsonPath(直读 data code,零重传 content;治 token 纠结根因)=====
  {
    const mw = createHtmlValidateToolsMiddleware('html/') as any
    // 模拟 createChatSdk 装配期注入 getController(_setGetController):jsonPath → bind → code
    const bind = { components: [{ code: '<p>ok</p>' }, { code: '<div>未闭合' }] }
    mw._setGetController(() => ({ get: () => ({ bind }) }) as any)
    const validateCode = mw.tools[0]
    const r1 = await validateCode.invoke({ jsonPath: 'components.0.code' })
    assert(/✅/.test(String(r1)), '✓ validate_code jsonPath 命中合法 code → 通过(零重传 content,直读 data)')
    const r2 = await validateCode.invoke({ jsonPath: 'components.1.code' })
    assert(/❌/.test(String(r2)), '✓ validate_code jsonPath 命中未闭合 code → 报格式问题(从 data 读 code 校验)')
    const r3 = await validateCode.invoke({ jsonPath: 'components.9.code' })
    assert(/未命中 string/.test(String(r3)), '✓ validate_code jsonPath 路径不存在 → 友好错误(不崩溃,提示 read/content 兜底)')
    const r4 = await validateCode.invoke({ content: '<p>ok</p>' })
    assert(/✅/.test(String(r4)), '✓ validate_code content 旧用法零回归(jsonPath 注入不破坏 content)')
    mw.beforeAgent({ files: { 'html/x.html': { content: '<b/>', updatedAt: 0 } } } as any)
    const r5 = await validateCode.invoke({ path: 'html/x.html' })
    assert(/✅/.test(String(r5)), '✓ validate_code path 旧用法零回归(校验 vfs 文件)')
  }

  // ===== craft-notes:组件工匠笔记(__pgNotes sidecar:子 agent 收口 [note] 行沉淀 + 地图注入,同组件跨委派设计意图持续)=====
  // ① extractNoteLinesFromText 纯函数:[note] 行提取(前缀变体/去重);收口文本源 = wrapModelCall 捕获链
  {
    assert(
      JSON.stringify(extractNoteLinesFromText('已生成 beer 组件\n[note] 液面 height keyframes 4.2s 循环')) === JSON.stringify(['[note] 液面 height keyframes 4.2s 循环']),
      '✓ extractNoteLinesFromText:收口文本提取 [note] 行(规范前缀)',
    )
    assert(
      JSON.stringify(extractNoteLinesFromText('- [note] 带列表前缀\n*  [note]  另一条\n[note] 液面循环\n[note] 液面循环')) === JSON.stringify(['[note] 带列表前缀', '[note] 另一条', '[note] 液面循环']),
      '✓ extractNoteLinesFromText:容忍 -/*/ 空白前缀变体 + 同轮去重',
    )
    assert(extractNoteLinesFromText('普通收口无笔记').length === 0, '✓ extractNoteLinesFromText:无 [note] 行 → 空(不硬造笔记)')
  }

  // ①b wrapModelCall 捕获链:无 tool_calls 的模型响应 = 收口文本 → state.__pgFinalText(afterAgent 提取源;有 tool_calls 不覆盖)
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { mw } = setup(bind)
    const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
    const mockToolNext = async () => ({ content: '工具调用中', toolCalls: [{ name: 'vfs_edit', args: {} }], message: null as any })
    await (mw as any).wrapModelCall!({ messages: [], state: st }, mockToolNext)
    assert((st as any).__pgFinalText.text === '', '✓ wrapModelCall 捕获:有 tool_calls 的响应不记(非收口文本)')
    const mockFinalNext = async () => ({ content: '已改\n[note] 交接行', toolCalls: [], message: null as any })
    await (mw as any).wrapModelCall!({ messages: [], state: st }, mockFinalNext)
    assert((st as any).__pgFinalText.text === '已改\n[note] 交接行', '✓ wrapModelCall 捕获:无 tool_calls 响应 → __pgFinalText holder(真实链路:afterAgent state.messages 只有初始 user,收口文本唯此可得)')
  }

  // ② afterAgent 沉淀:收口文本(holder)[note] 行 → touched 组件 __pgNotes;无 [note] 不沉淀
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'beer', code: '<p>old</p>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html' }, state: st } as any, mockNext)
    ;(st as any).__pgFinalText.text = '已修改 beer\n[note] 液面 height keyframes 4.2s 循环;装饰仅灯串+光斑'
    mw.afterAgent!(st)
    assert(JSON.stringify(bind.components[0].__pgNotes) === JSON.stringify(['[note] 液面 height keyframes 4.2s 循环;装饰仅灯串+光斑']), '✓ craft-notes 沉淀:子 agent 收口 [note] 行 → touched 组件 __pgNotes(单组件直接归属)')
    // 无 [note] 行 → 不沉淀(字段不出现)
    const st2 = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)
    ;(st2 as any).__pgFinalText.text = '已修改,无笔记约定行'
    mw.afterAgent!(st2)
    assert(bind.components[0].__pgNotes.length === 1, '✓ craft-notes:无 [note] 行不沉淀(不硬造低质笔记)')
  }

  // ③ 新建场景(touched 空,子 agent 走 write 不经 vfs)→ 按 note 行内 name 归属
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'beer', code: '<p/>' }, { __pgId: 'c_b', name: 'carousel', code: '<b/>' }] }
    const { mw } = setup(bind)
    const st = applyUpdate(createInitialState(), mw.beforeAgent!(createInitialState()) as any)  // __pgTouched 空 Set
    ;(st as any).__pgFinalText.text = '已新建 carousel\n[note] carousel 用 translateX track + setInterval 3500ms,hover 暂停'
    mw.afterAgent!(st)
    assert(
      !bind.components[0].__pgNotes && JSON.stringify(bind.components[1].__pgNotes) === JSON.stringify(['[note] carousel 用 translateX track + setInterval 3500ms,hover 暂停']),
      '✓ craft-notes 新建场景:touched 空 → 按 note 行内 name(carousel)精确归属,不误挂到 beer',
    )
  }

  // ④ FIFO ≤5 + 单条 200 字截断
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>' }] }
    const { vfsStore, mw } = setup(bind)
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<p>x</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html' }, state: st } as any, mockNext)
    const long = 'x'.repeat(260)
    ;(st as any).__pgFinalText.text = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((n) => `[note] ${n} ${long}`).join('\n')
    mw.afterAgent!(st)
    const notes: string[] = bind.components[0].__pgNotes
    assert(notes.length === 5, '✓ craft-notes FIFO:6 条 → 保最近 5 条(shift 最旧)')
    assert(notes[0].includes('n2') && notes[4].includes('n6'), '✓ craft-notes FIFO:保的是最新 5 条(n2..n6)')
    assert(notes.every((n) => n.length <= 202 && n.endsWith('…')), '✓ craft-notes 截断:单条 >200 字截断加省略号')
  }

  // ⑤ augmentPrompt 地图注入 📝 笔记行 + 头部交接引导;无笔记组件不注
  {
    const bind: any = { title: 't', components: [
      { __pgId: 'c_a', name: 'beer', code: '<p/>', __pgNotes: ['[note] 旧笔记', '[note] 液面 keyframes 4.2s 循环,装饰仅灯串+光斑'] },
      { __pgId: 'c_b', name: 'banner', code: '<b/>' },
    ] }
    const { mw } = setup(bind)
    mw.beforeAgent!(createInitialState())
    const map = (mw as any).augmentPrompt!()
    assert(map.includes('前任维护者交接'), '✓ craft-notes 注入:地图头含交接引导(设计决策/用户反馈/踩坑,改该组件时遵循)')
    assert(map.includes('收口回复末行必须附一行 [note]'), '✓ craft-notes 注入:地图头含收口提醒(真 LLM 实测漏写率 3/4,per-round recency 通道强化)')
    assert(map.includes('📝 笔记×2(最近):[note] 液面 keyframes 4.2s 循环,装饰仅灯串+光斑'), '✓ craft-notes 注入:有笔记组件加「📝 笔记×N(最近):最近 1 条」行')
    const bLine = map.split('\n').find((l: string) => l.includes('banner'))!
    assert(!bLine.includes('📝'), '✓ craft-notes 注入:无笔记组件不注 📝 行(零噪音)')
  }

  // ⑥ read 投影隐藏 __pgNotes(agent/主 agent 看不到 sidecar 原始字段;注入走 augmentPrompt 框架通道)
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>', __pgNotes: ['[note] x'] }] }
    const { tools } = setup(bind)
    const t = byName(tools)
    const r = await invoke(t['read'], { jsonPath: 'components.0' })
    assert(!/pgNotes/.test(String(r)), '✓ craft-notes 隐藏:read 投影过滤 __pg*(__pgNotes 不进 agent 上下文)')
  }

  // ⑦ craftNotes:false → 零沉淀零注入(opt-out 完全关闭)
  {
    const bind: any = { title: 't', components: [{ __pgId: 'c_a', name: 'a', code: '<p/>', __pgNotes: ['[note] 已有'] }] }
    const { vfsStore, mw } = setup(bind, { craftNotes: false })
    const st = runRound(mw, [{ path: 'html/c_a.html', content: '<p>NEW</p>' }], bind, vfsStore)
    await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/c_a.html' }, state: st } as any, mockNext)
    ;(st as any).__pgFinalText.text = 'done\n[note] 不应沉淀'
    mw.afterAgent!(st)
    assert(JSON.stringify(bind.components[0].__pgNotes) === JSON.stringify(['[note] 已有']), '✓ craftNotes:false → 不沉淀([note] 行被忽略)')
    const map = (mw as any).augmentPrompt!()
    assert(!map.includes('📝'), '✓ craftNotes:false → 地图不注入笔记行(零开销 opt-out)')
  }

  // ⑧ htmlSystemPrompt [note] 约定 + htmlOrchestratorPrompt ⑤ 历史偏好转述(提示词侧,craft-notes 配套)
  {
    const { createHtmlSubagent } = await import('../../sdk/htmlSubagent')
    const cfg = createHtmlSubagent({ writablePaths: ['components'] })
    assert(!!cfg.systemPrompt?.includes('[note]') && !!cfg.systemPrompt?.includes('交接笔记'), '✓ htmlSystemPrompt 含 [note] 交接笔记约定(收尾回复末尾附 1 行实现要点)')
    assert(!!cfg.systemPrompt?.includes('收口格式(必守') && /收口格式/.test(cfg.systemPrompt!.split('\n').slice(-6).join('\n')), '✓ htmlSystemPrompt 收口格式硬约束(prompt 末尾 recency 位,漏写率治理)')
    const { htmlOrchestratorPrompt } = await import('../../presets')
    assert(!!htmlOrchestratorPrompt('html').includes('历史偏好'), '✓ htmlOrchestratorPrompt 规格化含 ⑤ 历史偏好(聊天上下文偏好提炼附 task,新子 agent 无记忆全靠 task)')
    // 优先级总纲(三档判档配套):task 可在限定决策点放宽方案上限,底线不放宽 —— 防 deep 注入与硬约束正面对撞
    assert(!!cfg.systemPrompt?.includes('优先级总纲') && !!cfg.systemPrompt?.includes('底线不放宽'), '✓ htmlSystemPrompt 优先级总纲(task 深入设计要求为上位指令,装饰不穷举/不手算/终稿一次写成底线恒守)')
  }
}
