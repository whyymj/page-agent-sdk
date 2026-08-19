import { z } from 'zod'
import { createDataOps, type ConflictInfo, type ConflictResolution } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

// 乐观锁(3.32 单旋钮:conflictWatchFields 为是否校验的唯一依据,expectedHash 已废弃)——
// 声明 ['*'] = 全字段检测:read/get 建立基线,write 时实时 hash 比对,基线之后被外部改过即 CONFLICT
// 单对象:hash 始终是整体 bind 的 hash(读任意子路径都返回整体 hash),任一字段被外部改过都触发 CONFLICT(保守但一致)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[乐观锁 conflictWatchFields 单旋钮]')
  {
    const pageObj: any = { title: 'old', count: 0, config: { bg: 'white' } }
    const tools = createDataOps({
      schema: z.object({
        title: z.string(),
        count: z.number().int().min(0),
        config: z.object({ bg: z.string() }),
      }),
      bind: pageObj,
      description: '页面',
    }, { conflictWatchFields: ['*'] })
    const t = byName(tools)

    // get 返回里含 hash(整体,信息 + workingMemory 用)
    let r = await invoke(t['get_data'], { jsonPath: 'title' })
    assert(/hash=/.test(r), 'get 返回含 hash(乐观锁标识)')

    // 基线新鲜 → edit 直接成功(无需任何手动 hash 参数)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'title', value: '"new"' })
    assert(/已 edit/.test(r) && pageObj.title === 'new', "['*'] 基线新鲜 → edit 直接成功")

    // 外部代码改了 count(基线过期)→ edit 必 CONFLICT,值不被覆盖
    pageObj.count = 99
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5' })
    assert(/VERSION_CONFLICT/.test(r) && pageObj.count === 99, "['*'] 基线过期 → CONFLICT 拒绝写入,值不被覆盖")

    // 重新 get 刷新基线 → edit 成功
    await invoke(t['get_data'], { jsonPath: 'count' })
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5' })
    assert(/已 edit/.test(r) && pageObj.count === 5, "['*'] 刷新基线后 edit 成功")

    // 嵌套子路径(config.bg)同样受整体基线保护
    pageObj.config.bg = 'external'
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'config.bg', value: '"edited"' })
    assert(/VERSION_CONFLICT/.test(r) && pageObj.config.bg === 'external', "['*'] 嵌套子路径:基线过期 → CONFLICT,外部改不被覆盖")
    await invoke(t['get_data'], { jsonPath: 'config' })
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'config.bg', value: '"edited"' })
    assert(/已 edit/.test(r) && pageObj.config.bg === 'edited', "['*'] 嵌套子路径:刷新基线后 edit 成功")

    // delete 同样受保护:基线过期拒删,刷新后可删
    pageObj.count = 77
    r = await invoke(t['delete_data'], { jsonPath: 'config' })
    assert(/VERSION_CONFLICT/.test(r), "['*'] delete 基线过期 → CONFLICT 拒绝")
    await invoke(t['get_data'], { jsonPath: 'title' })
    r = await invoke(t['delete_data'], { jsonPath: 'title' })
    assert(/已删除/.test(r), "['*'] delete 基线新鲜 → 删除成功")
  }

  // 未声明 conflictWatchFields → 默认不检测(外部改后 write 直接写,不校验)
  {
    const appObj: any = { x: 1 }
    const tools = createDataOps(
      { schema: z.object({ x: z.number() }), bind: appObj, description: 'app' },
    )
    const t = byName(tools)
    await invoke(t['get_data'], { jsonPath: 'x' })
    appObj.x = 99                                            // 外部改
    const r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'x', value: '5' })
    assert(/已 edit/.test(r) && appObj.x === 5, '未声明 → 默认不检测,外部改后 write 直接写入')
  }

  // onConflict 人工介入:冲突时挂起等用户决定(保留外部/强制覆盖/回退)
  {
    let resolveC!: (r: ConflictResolution) => void
    const onConflict = (_info: ConflictInfo) => new Promise<ConflictResolution>((res) => { resolveC = res })
    const pageObj: any = { x: 'orig' }
    const tools2 = createDataOps({ schema: z.object({ x: z.string() }), bind: pageObj, description: 'p' }, { onConflict, conflictWatchFields: ['*'] })
    const t2 = byName(tools2)
    await invoke(t2['get_data'], { jsonPath: 'x' })  // 建基线
    const tick = () => new Promise<void>((r) => setTimeout(r, 5))

    // keep_external:保留外部改后的值,不写入
    pageObj.x = 'external'
    const p1 = invoke(t2['set_data'], { value: '{ "x": "agent" }' })
    await tick()  // 等 handler 跑到 await onConflict,resolveC 已赋值
    resolveC({ action: 'keep_external' })
    let r = await p1
    assert(/已保留外部/.test(r) && pageObj.x === 'external', 'onConflict keep_external → 保留外部值,不写入 agent 值')

    // overwrite:强制覆盖外部修改,写入 agent 值
    pageObj.x = 'external2'
    const p2 = invoke(t2['set_data'], { value: '{ "x": "agent2" }' })
    await tick()
    resolveC({ action: 'overwrite' })
    r = await p2
    assert(/已设置/.test(r) && pageObj.x === 'agent2', 'onConflict overwrite → 强制覆盖,写入 agent 值')

    // restore:回退到快照栈顶(历史检查点),不写入 agent 值
    // 此前 overwrite 已 push 一条快照(external2,即 overwrite 写前值);restore 回退到它
    pageObj.x = 'external3'
    const p3 = invoke(t2['set_data'], { value: '{ "x": "agent3" }' })
    await tick()
    resolveC({ action: 'restore' })
    r = await p3
    assert(/已回退/.test(r) && pageObj.x === 'external2', 'onConflict restore → 回退到历史快照(上次 overwrite 写前值 external2),不写入 agent 值')

    // restore 无历史快照时(栈空)→ 返回提示,不抛错
    const pageY: any = { y: 'y0' }
    const tools3 = createDataOps({ schema: z.object({ y: z.string() }), bind: pageY, description: 'p' }, { onConflict, conflictWatchFields: ['*'] })
    const t3 = byName(tools3)
    await invoke(t3['get_data'], { jsonPath: 'y' })
    pageY.y = 'yext'
    const p4 = invoke(t3['set_data'], { value: '{ "y": "ya" }' })
    await tick()
    resolveC({ action: 'restore' })
    r = await p4
    assert(/无历史快照可回退/.test(r) && pageY.y === 'yext', 'onConflict restore 栈空 → 返回提示,值不变(外部改后值)')
  }

  // JSON 直传(L1):value 支持直接传 object,无需 stringify;也兼容旧 string
  {
    const appObj: any = { obj: { name: 'a', age: 1 }, arr: ['x'] }
    const tools = createDataOps({
      schema: z.object({
        obj: z.object({ name: z.string(), age: z.number() }),
        arr: z.array(z.string()),
      }),
      bind: appObj,
      description: 'app',
    })
    const t = byName(tools)

    // edit set 子路径直传 object
    let r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: { name: 'b', age: 2 } })
    assert(/已 edit/.test(r) && appObj.obj.name === 'b' && appObj.obj.age === 2, 'edit_data set 子路径直传 object 写入成功')
    // edit 仍兼容 JSON 字符串
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: '{"name":"c","age":3}' })
    assert(/已 edit/.test(r) && appObj.obj.name === 'c' && appObj.obj.age === 3, 'edit_data 兼容 JSON 字符串写入')
    // edit set 子路径直传非法 object → schema 校验失败(不写入)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: { name: 'd', age: 'not-number' } })
    assert(/error|校验失败|invalid|SCHEMA_INVALID/i.test(r) && appObj.obj.name === 'c', 'edit_data set 子路径直传非法 object → 校验失败不写入')
    // edit merge 直传 object
    r = await invoke(t['edit_data'], { op: 'merge', jsonPath: 'obj', value: { age: 5 } })
    assert(/已 edit/.test(r) && appObj.obj.age === 5, 'edit_data merge 直传 object 成功')
    // edit append 直传数组
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'arr', value: ['y', 'z'] })
    assert(/已 edit/.test(r) && appObj.arr.length === 3 && appObj.arr[2] === 'z', 'edit_data append 直传数组成功')
    // edit append 仍兼容 JSON 字符串
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'arr', value: '["w"]' })
    assert(/已 edit/.test(r) && appObj.arr[3] === 'w', 'edit_data 兼容 JSON 字符串 append')

    // set_data 整体直传 object
    r = await invoke(t['set_data'], { value: { obj: { name: 'X', age: 9 }, arr: ['m'] } })
    assert(/已设置/.test(r) && appObj.obj.name === 'X' && appObj.arr.length === 1, 'set_data 整体直传 object 写入成功')
  }

  // write-path-cost-reduction A 段:commitBaseline 单算复用 —— 消息「新 hash」与真实当前态一致(防基线/消息漂移)
  {
    const pageObj: any = { title: 'h0', count: 1 }
    const tools = createDataOps({
      schema: z.object({ title: z.string(), count: z.number().int().min(0) }),
      bind: pageObj, description: 'p',
    }, { conflictWatchFields: ['*'] })
    const t = byName(tools)
    const r1 = await invoke(t['write'], { value: { title: 'h1', count: 2 } })
    const m1 = /新 hash=(\w+)/.exec(r1)
    assert(!!m1, '✓ write(set) 返回含「新 hash」')
    // 写成功即刷基线 → 连续 write 不互冲(N1 契约)
    const r2 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: '3' } })
    assert(/已 write/.test(r2) && pageObj.count === 3, '✓ 同 scope 连续写不互冲(写成功即刷基线)')
    // edit_data 同口径
    const r3 = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '4' })
    const m2 = /新 hash=(\w+)/.exec(r3)
    assert(!!m2, '✓ edit_data 返回含「新 hash」')
    const r4 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: '5' } })
    assert(/已 write/.test(r4) && pageObj.count === 5, '✓ edit 后连续 write 不互冲(基线随写刷新)')
    // 反向锁:外部改后基线过期 → 必冲突(实时性不变量:冲突检测 hash 恒新鲜)
    pageObj.count = 99
    const r5 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: '6' } })
    assert(/VERSION_CONFLICT/.test(r5), '✓ 外部改后 write 必冲突(hash 实时性不变量,禁跨调用缓存)')
  }
}
