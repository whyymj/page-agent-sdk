/**
 * sec-73:code-as-data-asset 阶段 A —— read 大文本字段摘要(主 scope 标记驱动)
 * - 纯函数 summarizeLargeText:主 scope 标记字段(数组元素里)摘要 / 子 scope 完整 / 未标记业务长文本原样 / 短 code 原样 / 非数组元素原样 / 深拷贝不污染
 * - 集成 createDataOps.read:主 scope 返回占位且 bind 原值不变 / 子 scope 完整 / 无 largeTextPaths 行为不变 / 多路径也摘要
 */
import { z } from 'zod'
import { createDataOps, summarizeLargeText } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

const BIG = '<div>' + 'x'.repeat(300) + '</div>'   // 311 字符(≥200 阈值,模拟代码正文)
const SMALL = '<p>hi</p>'                          // 9 字符(< 阈值,短 code 原样)

function makeOps(bind: Record<string, unknown>, opts: Record<string, unknown> = {}) {
  return createDataOps({
    schema: z.object({
      title: z.string(),
      components: z.array(z.object({
        name: z.string(),
        code: z.string(),
        summary: z.string().optional(),
      })),
      description: z.string().optional(),
    }),
    bind,
    description: '测试',
  }, opts as any)
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[code-as-data-asset · read 大文本字段摘要(主 scope 标记驱动)]')

  // ===== 纯函数 summarizeLargeText =====
  {
    const specs = [{ arrayPath: 'components', field: 'code' }]
    const data: any = {
      title: 't',
      components: [
        { name: 'a', code: BIG, summary: BIG },
        { name: 'b', code: SMALL },
      ],
      description: BIG,
    }
    const main = summarizeLargeText(data, true, specs, 200) as any
    assert(main.components[0].code === `<code ${BIG.length}B>`, '✓ 主 scope 标记大文本字段摘要 → <code Nkb> 占位')
    assert(main.components[1].code === SMALL, '✓ 短 code(< 阈值)原样(阈值挡,保信息)')
    assert(main.components[0].summary === BIG, '✓ 未标记字段(同为大文本的 summary)原样(标记驱动,字段名过滤)')
    assert(main.description === BIG, '✓ 业务长文本原样(字段名 description 不在标记集 → 不摘要)')
    assert(data.components[0].code === BIG, '✓ 深拷贝:原 data 不被污染(bind 原值不变)')
    const sub = summarizeLargeText(data, false, specs, 200) as any
    assert(sub.components[0].code === BIG, '✓ 子 scope(isMain=false)原样返回(子 agent 改 code 需全文)')
    assert(JSON.stringify(summarizeLargeText(data, true, [], 200)) === JSON.stringify(data), '✓ 无 specs 且处处低于子树阈值 → 结构零变化(轻量数据零变化锁;泛化后无 specs 也走体积判定,≥阈值占位见 sec-105)')
    assert(summarizeLargeText(null, true, specs, 200) === null, '✓ null/非对象原样返回')
  }

  // ===== 集成:createDataOps.read 主 scope 摘要 + bind 不变 =====
  {
    const bind: any = { title: 't', components: [{ name: 'hero', code: BIG }], description: '页面描述' }
    const tools = makeOps(bind, { largeTextPaths: ['components.code'] })
    const t = byName(tools)
    const r = await invoke(t['read'], {})
    assert(r.includes('<code ') && !r.includes(BIG), '✓ read(主 scope)返回含 <code Nkb> 占位,不含代码正文')
    assert(bind.components[0].code === BIG, '✓ read 摘要不污染 bind(code 原值完整,checkout/commit 取原值)')
  }

  // ===== 子 scope read 完整 =====
  {
    const bind: any = { title: 't', components: [{ name: 'hero', code: BIG }] }
    const tools = makeOps(bind, { largeTextPaths: ['components.code'] })
    const t = byName(tools)
    const controller = (tools as any).controller
    const exit = controller.enterScope('sub-1')
    const r = await invoke(t['read'], {})
    exit()
    assert(r.includes(BIG) && !r.includes('<code '), '✓ 子 scope read 返回完整 code(子 agent 改 code 需全文)')
  }

  // ===== 无 largeTextPaths(非 htmlSubagent)read 行为不变 =====
  {
    const bind: any = { title: 't', components: [{ name: 'hero', code: BIG }] }
    const tools = makeOps(bind)
    const t = byName(tools)
    const r = await invoke(t['read'], {})
    assert(r.includes(BIG), '✓ 非 htmlSubagent(无 largeTextPaths)read 原样返回 code(行为完全不变)')
  }

  // ===== 多路径模式主 scope 也摘要 =====
  {
    const bind: any = { title: 't', components: [{ name: 'a', code: BIG }, { name: 'b', code: BIG }] }
    const tools = makeOps(bind, { largeTextPaths: ['components.code'] })
    const t = byName(tools)
    const r = await invoke(t['read'], { jsonPaths: ['components.0', 'components.1'] })
    assert(r.includes('<code ') && !r.includes(BIG), '✓ read 多路径模式主 scope 也摘要')
  }
}
