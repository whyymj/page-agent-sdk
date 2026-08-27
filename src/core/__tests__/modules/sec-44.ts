/**
 * sec-44:subagent-writable(Phase 2 子 agent 写权限 + path guard)
 * - extractWritePaths:jsonPath/patch.jsonPath/patches[].jsonPath/path 提取;整体 set 无 → 空
 * - isPathWritable:前缀匹配(精确/startsWidth('.')/startsWidth('['))
 * - wrapWithPathGuard:越界 PATH_OUT_OF_SCOPE / 前缀允许 / 整体 set 禁
 * - stripSelfGrantedWriteTools(team-audit P1#1):spawn 自授按名解析主池对象再判写能力;未知名保留
 */
import { extractWritePaths, isPathWritable, wrapWithPathGuard, isWriteCapableTool, stripSelfGrantedWriteTools } from '../../harness/subagent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[subagent-writable · path guard]')
  // ===== extractWritePaths:所有 jsonPath 形态提取 =====
  assert(extractWritePaths({ jsonPath: 'a.b' })[0] === 'a.b', '✓ extractWritePaths → jsonPath 直提取')
  assert(extractWritePaths({ patch: { jsonPath: 'a.b' } })[0] === 'a.b', '✓ extractWritePaths → patch.jsonPath')
  assert(extractWritePaths({ patches: [{ jsonPath: 'a.b' }, { jsonPath: 'c.d' }] }).length === 2, '✓ extractWritePaths → patches[].jsonPath 批量')
  assert(extractWritePaths({ value: { x: 1 } }).length === 0, '✓ extractWritePaths → 整体 set(无 jsonPath)→ 空(盲区)')

  // ===== isPathWritable:前缀匹配 =====
  assert(isPathWritable('components', ['components']), '✓ isPathWritable → 精确相等')
  assert(isPathWritable('components.0.title', ['components']), '✓ isPathWritable → startsWith(".")(子属性)')
  assert(isPathWritable('components[0]', ['components']), '✓ isPathWritable → startsWith("[")(数组索引)')
  assert(!isPathWritable('settings.theme', ['components']), '✓ isPathWritable → 越界拒绝(settings 不在 components)')

  // ===== wrapWithPathGuard:mock tool + 前缀允许 / 越界 / 整体 set 禁 =====
  const mockTool = { name: 'write', invoke: async (_args: any) => 'WRITE_OK' } as any
  const guarded = wrapWithPathGuard(mockTool, ['components'])
  // 前缀允许(components.0.title 在 components 下)
  const r1 = await (guarded.invoke as any)({ patch: { jsonPath: 'components.0.title', value: 'x' } })
  assert(r1 === 'WRITE_OK', '✓ wrapWithPathGuard → 前缀内允许通过(components.0.title)')
  // 越界(settings.theme 不在 components)
  const r2 = await (guarded.invoke as any)({ patch: { jsonPath: 'settings.theme', value: 'dark' } })
  assert(String(r2).includes('PATH_OUT_OF_SCOPE'), '✓ wrapWithPathGuard → 越界拒绝 PATH_OUT_OF_SCOPE(settings.theme)')
  // 整体 set(无 jsonPath → 禁)
  const r3 = await (guarded.invoke as any)({ value: { title: '整体替换' } })
  assert(String(r3).includes('PATH_OUT_OF_SCOPE'), '✓ wrapWithPathGuard → 整体 set 禁(无 jsonPath 盲区 → 拒)')
  assert(String(r3).includes('增量 patch'), '✓ wrapWithPathGuard → 整体 set 提示用增量 patch')

  // ===== stripSelfGrantedWriteTools:spawn 自授剥离(team-audit P1#1;原 filter 对字符串恒 no-op) =====
  const mkTool = (name: string, writeCapable?: boolean | ((args: unknown) => boolean)) => ({ name, writeCapable, invoke: async () => 'ok' }) as any
  // isWriteCapableTool 接口语义:对象形态按标注判定;字符串形态恒 false(原缺陷即误把名字当对象传)
  assert(isWriteCapableTool(mkTool('write', true)) === true, '✓ isWriteCapableTool → 对象 writeCapable:true 判写')
  assert(isWriteCapableTool(mkTool('read')) === false, '✓ isWriteCapableTool → 无标注只读工具不判写')
  assert(isWriteCapableTool(mkTool('eval_script', () => true)) === true, '✓ isWriteCapableTool → 条件写无 args 保守按写(宁误拦不漏放)')
  assert(isWriteCapableTool('write') === false, '✓ isWriteCapableTool → 字符串形态恒 false(锁定接口语义:入参必须是对象)')
  const pool = [
    mkTool('write', true),
    mkTool('eval_script', () => true),   // 条件写(真实标注形态)
    mkTool('resource_update', true),     // 布尔写标注(资源写)
    mkTool('read'),                      // 只读
    mkTool('fetch_doc'),                 // 只读(无标注)
  ]
  const stripped = stripSelfGrantedWriteTools(['write', 'eval_script', 'resource_update', 'read', 'fetch_doc'], pool)
  assert(JSON.stringify(stripped) === JSON.stringify(['read', 'fetch_doc']), '✓ stripSelfGrantedWriteTools → 写/条件写/资源写全剥离,只读保留')
  const keptUnknown = stripSelfGrantedWriteTools(['no_such_tool', 'read'], pool)
  assert(JSON.stringify(keptUnknown) === JSON.stringify(['no_such_tool', 'read']), '✓ stripSelfGrantedWriteTools → 未知名保留(后续自然报「工具不存在」,不在此剥)')
  assert(stripSelfGrantedWriteTools([], pool).length === 0, '✓ stripSelfGrantedWriteTools → 空自授列表零变化')
}
