import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs';

import type { TestCtx } from './_ctx'

// dataOps:单主对象 基础(write/read + schema 校验)
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

    // write(set) 整体替换(合法)
    let r = await invoke(t['write'], { value: '{ "theme": "dark", "count": 3 }' })
    assert(appObj.theme === 'dark' && appObj.count === 3 && /已 write\(set\)/.test(r), 'write(set) 合法值生效 + 返回成功')

    // write(set) 非法值被 schema 校验拦截(不写入)
    r = await invoke(t['write'], { value: '{ "theme": "red", "count": 1 }' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.theme === 'dark', 'write(set) 非法值被 schema 校验拦截(不写入,返回结构化错误码)')

    // write(set) 缺字段:path-scoped-validation 契约收窄 —— merge 语义下未出现的 key 不过堂(缺必填不再拒),
    // 未出现字段保留原值(防误删);深度缺字段(出现的 key 值内缺必填)仍被局部校验拒
    r = await invoke(t['write'], { value: '{ "theme": "dark" }' })
    assert(appObj.theme === 'dark' && appObj.count === 3, '✓ set 缺必填顶层 key → merge 语义放行且未出现字段保留(path-scoped 契约)')
    r = await invoke(t['write'], { value: '{ "theme": "red" }' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.theme === 'dark', '✓ set 出现的 key 非法 → 局部校验仍拒')

    // read 读整个主数据
    r = await invoke(t['read'], {})
    assert(/dark/.test(r) && /hash=/.test(r), 'read 不传 jsonPath 返回整个主数据 + hash')

    // read 读子路径
    r = await invoke(t['read'], { jsonPath: 'theme' })
    assert(/dark/.test(r) && /hash=/.test(r), 'read 传 jsonPath 返回子路径值 + hash')

    // read 读非 schema 声明字段 → PATH_DENIED(白名单模式:仅 schema 声明的 key 可读)
    r = await invoke(t['read'], { jsonPath: 'nope' })
    assert(/PATH_DENIED/.test(r), 'read 读非 schema 声明字段 → PATH_DENIED')

    // write(edit) 增量 set 子路径(合法)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: '5' } })
    assert(appObj.count === 5 && /已 write\(edit\)/.test(r), 'write(edit) set 子路径生效')

    // write(edit) 非法值被校验拦截(整体仍经 schema)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: '"not a number"' } })
    assert(/SCHEMA_INVALID/.test(r) && appObj.count === 5, 'write(edit) 非法值被 schema 校验拦截(不写入)')

    // write(del) 删子路径
    r = await invoke(t['write'], { patch: { jsonPath: 'count' }, del: true })
    assert(!('count' in appObj) && /已删除/.test(r), 'write(del) 删子路径生效')

    // write(del) 删非 schema 声明字段 → PATH_DENIED(白名单模式)
    r = await invoke(t['write'], { patch: { jsonPath: 'nope' }, del: true })
    assert(/PATH_DENIED/.test(r), 'write(del) 删非 schema 声明字段 → PATH_DENIED')

    // describe_data 已移除(4.9,与 read 不传 jsonPath 等价;真 LLM 基线连续三版 0 调用)
    assert(!t['describe_data'], 'describe_data 不在工具面(read 不传 jsonPath 返回整体说明+格式,等价承接)')
    r = await invoke(t['read'], {})
    assert(/应用配置/.test(r), 'read 不传 jsonPath 返回主数据说明(describe_data 等价承接)')

    // 工具描述总长回归(context-economy-phase2 二批瘦身 + tool-surface-economy W3 三批;防「反向锚定把新文案盖错对象」事故重演:
    // 每条描述须与其工具语义一致(抽查锚点词)+ 单条 ≤200(W3 后实测最大 write=192)
    const descAnchors: [string, RegExp][] = [
      ['eval_script', /沙箱/], ['draft_commit', /草稿/], ['draft_write', /drafts/],
      ['query_data', /JSONPath/], ['search_data', /搜索/], ['history_data', /快照/],
      ['write', /四意图|写入主数据/], ['read', /hash/], ['schema_data', /schema|约束|字段/],
    ]
    for (const [n, anchor] of descAnchors) {
      const d = t[n]?.description ?? ''
      if (!t[n]) continue // draft_write/draft_commit 等 opt-in 工具在本 fixture(schema 小,未开)不装配,跳过
      assert(anchor.test(d), `✓ 描述锚点 → ${n} 描述含语义锚点(未被盖错对象)`)
      assert(d.length <= 200, `✓ 描述长度 → ${n} ≤200(实际 ${d.length},W3 三批瘦身回归线)`)
    }
    // 总长上限:advanced 可见数据工具描述合计 ≤1600(W3 后实测 1471;含 W1 queries 增量)
    const ADV_VISIBLE = ['restore_data','history_data','query_data','search_data','eval_script','read','write','schema_data','diff_data','draft_write','draft_commit']
    const total = ADV_VISIBLE.reduce((s2, n) => s2 + (t[n]?.description?.length ?? 0), 0)
    assert(total <= 1600, `✓ 描述总长 → advanced 数据工具描述合计 ≤1600(实际 ${total},W3 回归线)`)
    // 字段级 .describe() 总长上限(W3 新增锁;实测 1102):字段文本与工具级同源瘦身,防只盯 description 单点回弹
    const fieldTotal = ADV_VISIBLE.reduce((s2, n) => {
      const shape = (t[n] as any)?.schema?.shape ?? {}
      return s2 + Object.keys(shape).reduce((s3, k) => s3 + (shape[k]?.description?.length ?? 0), 0)
    }, 0)
    assert(fieldTotal <= 1200, `✓ 字段描述总长 → advanced 数据工具 .describe() 合计 ≤1200(实际 ${fieldTotal},W3 新增锁)`)

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
