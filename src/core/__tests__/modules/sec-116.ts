/**
 * sec-116:eval-trailing-return(2026-08-27 诊断驱动,complex-demo 真 LLM 事故)
 * - wrapExpressionScript:无 return 脚本包成 return (expr)(schema 描述承诺「末尾表达式即返回值」成真)/
 *   含 return 原样 / 箭头函数表达式包裹 —— 修前 Worker 函数体语义返回 undefined
 * - transform undefined 守卫:沙箱返回 undefined → SCRIPT_NO_RETURN 指路报错
 *   (修前落到 set value=undefined 报「MISSING_VALUE: set 操作需要 value」,模型以为要传 value 参数严重误导)
 */
import { z } from 'zod'
import { wrapExpressionScript } from '../../tools/sandbox'
import { createDataOps } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== wrapExpressionScript 纯函数 =====
  console.log('\n[eval-trailing-return · 表达式包裹]')
  assert(wrapExpressionScript('data.slice(0,1)') === 'return (data.slice(0,1))',
    '✓ 无 return 脚本包成 return (expr)(诊断事故原样脚本 data.slice(0,1))')
  assert(wrapExpressionScript('data.filter(c=>c.stock>0)') === 'return (data.filter(c=>c.stock>0))',
    '✓ schema 示例脚本 data.filter(...) 同样被包裹(描述承诺自此为真)')
  assert(wrapExpressionScript('return data.slice(0,1)') === 'return data.slice(0,1)',
    '✓ 显式 return 脚本原样(多语句 + return 形态不动)')
  assert(wrapExpressionScript('const out = data.filter(c=>c.ok); return out') === 'const out = data.filter(c=>c.ok); return out',
    '✓ 多语句含 return 原样')
  assert(wrapExpressionScript('data.map(c => c.x)') === 'return (data.map(c => c.x))',
    '✓ 箭头函数体里的 => 不误判为 return 字样')
  const wrapped = wrapExpressionScript('data.slice(0,1)')
  let exprResult: unknown
  try { exprResult = new Function('data', wrapped)([1, 2, 3]) } catch { exprResult = 'THREW' }
  assert(JSON.stringify(exprResult) === '[1]',
    `✓ 包裹后以 new Function 执行真的返回值([1];实际 ${JSON.stringify(exprResult)})`)

  // ===== transform undefined 守卫(经 sandboxRunner 注入缝走真实分支)=====
  console.log('\n[eval-trailing-return · transform undefined 守卫]')
  const undefinedRunner = (data: unknown, script: string) =>
    new Promise((resolve) => resolve({ ok: true, result: new Function('data', script)(data), elapsedMs: 1 }))
  const tools = createDataOps({
    schema: z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), code: z.string() })),
    }),
    bind: { title: 't', components: [{ name: 'a', code: 'x' }, { name: 'b', code: 'y' }] },
    description: '测试',
  }, { sandboxRunner: undefinedRunner } as any)
  const evalTool = tools.find((t) => t.name === 'eval_script')!

  // 事故原样复现:子树 transform + 末尾表达式脚本(修前 → MISSING_VALUE 误导;守卫后 → SCRIPT_NO_RETURN 指路)
  const r1 = await invoke(evalTool, { jsonPath: 'components', mode: 'transform', script: 'data.slice(0,1)' })
  assert(/^ERROR:/.test(r1) && r1.includes('SCRIPT_NO_RETURN') && r1.includes('return'),
    '✓ 子树 transform 无返回值 → SCRIPT_NO_RETURN + return 指路(修前是误导性 MISSING_VALUE)')
  assert(!r1.includes('MISSING_VALUE'), '✓ 不再出现「set 操作需要 value」误导文案(eval_script 无 value 参数)')

  // 整体 transform(无 jsonPath)同守卫
  const r2 = await invoke(evalTool, { mode: 'transform', script: 'undefined' })
  assert(r1.includes('SCRIPT_NO_RETURN') && r2.includes('SCRIPT_NO_RETURN'),
    '✓ 整体 transform 分支同守卫(undefined 结果一律拦)')

  // 正常路径零回归:显式 return 的 transform 照常落地(注入 runner 真执行)
  const r3 = await invoke(evalTool, { jsonPath: 'components', mode: 'transform', script: 'return data.slice(0,1)' })
  assert(r3.includes('已通过脚本 transform 子树') && r3.includes('"name":"a"'),
    '✓ 显式 return transform 照常落地(零回归)')
}
