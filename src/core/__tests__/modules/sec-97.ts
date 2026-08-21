/**
 * sec-97:main-surface-slim Phase 2(vfs.mainTools 主栈暴露面开关)
 * 覆盖:不传 = 主栈含 vfs 工具(现状零回归)/ mainTools:false → 主栈无 vfs_read、
 *      state.files 注入仍在(offload 外存依赖)/ 子 agent 筛选池含被隐藏的 vfs 工具
 *      (subagentPoolTools 保供,buildChildTools 白名单筛得到)/ 中间件名与 beforeAgent 不受开关影响。
 */
import type { TestCtx } from './_ctx'
import { createVfs, createVfsMiddleware, createVfsTools } from '../../backends/vfs'
import { buildChildTools } from '../../harness/subagent'
import { z } from 'zod'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // 1. 不传 = 现状:主栈含 vfs 工具 + beforeAgent files 注入
  {
    const store = createVfs()
    const mw = createVfsMiddleware(store)
    const names = (mw.tools ?? []).map((t: any) => t.name)
    assert(names.includes('vfs_read') && names.includes('vfs_write'), '✓ vfs mainTools → 不传主栈含 vfs_read/vfs_write(现状零回归)')
    assert((mw.tools ?? []).length === 9, `✓ vfs mainTools → 不传 9 工具全量(实测 ${(mw.tools ?? []).length})`)
    assert(mw.name === 'vfs', '✓ vfs mainTools → 中间件名不变')
    const upd = mw.beforeAgent?.({} as any) as { files?: unknown } | undefined
    assert(upd && !!upd.files, '✓ vfs mainTools → 不传 beforeAgent files 注入在(offload 外存依赖)')
  }

  // 2. mainTools:false → 主栈无 vfs 工具,但 files 注入保留
  {
    const store = createVfs()
    const mw = createVfsMiddleware(store, { mainTools: false })
    assert((mw.tools ?? []).length === 0, `✓ vfs mainTools:false → 主栈零 vfs 工具(实测 ${(mw.tools ?? []).length})`)
    const upd = mw.beforeAgent?.({} as any) as { files?: unknown } | undefined
    assert(upd && !!upd.files, '✓ vfs mainTools:false → beforeAgent files 注入保留(大结果外存不退化)')
  }

  // 3. 子 agent 池保供:主池(mainTools:false 后无 vfs)∪ subagentPoolTools(vfs 9 件)→ 白名单筛得到
  {
    const store = createVfs()
    const vfsTools = createVfsTools(store)
    // 模拟主栈 allTools(mainTools:false 后无 vfs 工具,只余 dataOps 类)
    const mainPool = [{ name: 'read' }, { name: 'write' }]
    const merged = [...mainPool, ...vfsTools.filter((t) => !new Set(mainPool.map((m) => m.name)).has(t.name))]
    // html 子 agent 白名单:DEFAULT_READONLY + vfs 家族
    const allow = new Set(['read', 'vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read'])
    const child = buildChildTools(merged as any, allow)
    const childNames = child.map((t) => t.name)
    assert(childNames.includes('vfs_write') && childNames.includes('vfs_edit'), '✓ vfs mainTools:false → 子 agent 池含 vfs_write/vfs_edit(html 子 agent 不饿死)')
    assert(childNames.includes('read'), '✓ vfs mainTools:false → 子 agent 只读白名单照常筛到主池工具')
    // 对照:不补 subagentPoolTools 时白名单筛不到 vfs(证明保供必要性)
    const childNoPool = buildChildTools(mainPool as any, allow)
    assert(!childNoPool.map((t) => t.name).includes('vfs_write'), '✓ vfs mainTools:false → 无保供时子池筛不到 vfs_write(对照)')
  }

  // 4. 开关语义:mainTools:true 显式传 = 现状
  {
    const store = createVfs()
    const mw = createVfsMiddleware(store, { mainTools: true })
    assert((mw.tools ?? []).length === 9, '✓ vfs mainTools:true → 显式传等同现状(9 工具)')
  }
}
