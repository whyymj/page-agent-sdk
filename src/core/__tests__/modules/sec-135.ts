/**
 * sec-135:content-proposals 纯函数域(proposalOps:lineDiff / applyProposalOps / hashContent / countOccurrences)
 * 覆盖:diff 矩阵(同文/纯插/纯删/替换/修剪/空文本/大输入回退)/ ops 唯一锚纪律与原子性 /
 * 顺序应用(后者见前者结果)/ hash 确定性。
 */
import type { TestCtx } from './_ctx'
import { lineDiff, applyProposalOps, hashContent, countOccurrences, type ProposalOp } from '../../tools/proposalOps'

const T = (rows: { type: string; text: string }[]): string => rows.map((r) => `${r.type[0]}:${r.text}`).join(' ')

export function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== lineDiff 矩阵 =====
  {
    const same = lineDiff('a\nb\nc', 'a\nb\nc')
    assert(same.stats.added === 0 && same.stats.removed === 0 && same.rows.every((r) => r.type === 'same'), '✓ lineDiff 全同 → 零增删')

    const ins = lineDiff('a\nc', 'a\nb\nc')
    assert(ins.stats.added === 1 && ins.stats.removed === 0 && ins.rows.some((r) => r.type === 'add' && r.text === 'b'), '✓ lineDiff 纯插入 → 一行 add')

    const del = lineDiff('a\nb\nc', 'a\nc')
    assert(del.stats.removed === 1 && del.stats.added === 0, '✓ lineDiff 纯删除 → 一行 del')

    const rep = lineDiff('a\nX\nc', 'a\nY\nc')
    assert(rep.stats.added === 1 && rep.stats.removed === 1, '✓ lineDiff 替换 → -1/+1')

    // 公共前后缀修剪:长文只改中间
    const head = Array.from({ length: 50 }, (_, i) => `h${i}`).join('\n')
    const tail = Array.from({ length: 50 }, (_, i) => `t${i}`).join('\n')
    const trim = lineDiff(`${head}\nA\n${tail}`, `${head}\nB\n${tail}`)
    assert(trim.stats.added === 1 && trim.stats.removed === 1 && trim.rows.length === 102,
      `✓ lineDiff 前后缀修剪 → 中段最小 diff(总行 102,实际 ${trim.rows.length})`)

    // 空文本
    const fromEmpty = lineDiff('', 'x\ny')
    assert(fromEmpty.stats.added === 2 && fromEmpty.stats.removed === 0, '✓ lineDiff 空文本按零行(不产生伪行)')
    const toEmpty = lineDiff('x\ny', '')
    assert(toEmpty.stats.removed === 2, '✓ lineDiff 到空文本 → 两行 del')

    // 大输入回退:中段乘积超限不做 LCS,整块替换(展示等价「重写」;快速返回不卡死)
    const big = Array.from({ length: 2100 }, (_, i) => `L${i}`).join('\n')
    const big2 = Array.from({ length: 2100 }, (_, i) => `R${i}`).join('\n')
    const t0 = Date.now()
    const fb = lineDiff(big, big2)
    assert(fb.stats.added === 2100 && fb.stats.removed === 2100 && Date.now() - t0 < 2000,
      '✓ lineDiff 超限回退整块替换(2100+2100,亚秒返回)')
  }

  // ===== countOccurrences =====
  assert(countOccurrences('xaxbxax', 'x') === 4, '✓ countOccurrences 计数')
  assert(countOccurrences('abc', '') === 0, '✓ countOccurrences 空锚按 0(空锚不命中)')
  assert(countOccurrences('aaaa', 'aa') === 2, '✓ countOccurrences 不重叠计数')

  // ===== applyProposalOps:唯一锚纪律 + 原子性 =====
  {
    const base = '---\ntitle: 笔记\n---\n\n注意力机致是核心。\n结尾。'
    // replace 唯一命中
    const r1 = applyProposalOps(base, [{ op: 'replace', find: '注意力机致', with: '注意力机制' }])
    assert(r1.ok && r1.content.includes('注意力机制是核心') && !r1.content.includes('机致'), '✓ ops replace 唯一命中 → 替换')

    // 0 命中
    const r2 = applyProposalOps(base, [{ op: 'replace', find: '不存在的锚', with: 'x' }])
    assert(!r2.ok && r2.error.includes('第 1 个 op') && r2.error.includes('未命中'), `✓ ops 锚未命中 → 指名拒绝(${r2.ok ? '' : r2.error.slice(0, 24)}…)`)

    // 多命中(锚太短)
    const r3 = applyProposalOps('重复 重复 重复', [{ op: 'replace', find: '重复', with: 'X' }])
    assert(!r3.ok && r3.error.includes('命中 3 次'), '✓ ops 多命中 → 拒且报命中数(要求加长锚)')

    // insertAfter / insertBefore
    const r4 = applyProposalOps('第一段。\n第二段。', [
      { op: 'insertAfter', anchor: '第一段。', text: '\n插入后段。' },
      { op: 'insertBefore', anchor: '第二段。', text: '插入前段。\n' },
    ])
    assert(r4.ok && r4.content === '第一段。\n插入后段。\n插入前段。\n第二段。', `✓ ops insertAfter/insertBefore 定位正确,实际:${JSON.stringify(r4.content)}`)

    // append
    const r5 = applyProposalOps('正文', [{ op: 'append', text: '\n(完)' }])
    assert(r5.ok && r5.content === '正文\n(完)', '✓ ops append 尾接')

    // 顺序应用:第二个 op 的锚在第一个 op 的产物上命中
    const r6 = applyProposalOps('A', [
      { op: 'append', text: 'B' },
      { op: 'replace', find: 'AB', with: 'XY' },
    ])
    assert(r6.ok && r6.content === 'XY', '✓ ops 顺序应用(后者见前者结果)')

    // 原子性:第 3 个 op 失败 → 整批拒(前两个的效果不残留 —— 返回错误而非半改内容)
    const r7 = applyProposalOps('A', [
      { op: 'append', text: 'B' },
      { op: 'append', text: 'C' },
      { op: 'replace', find: '不存在', with: 'x' },
    ])
    assert(!r7.ok && r7.error.includes('第 3 个 op'), '✓ ops 原子性:任一失败整批拒且指名序号')
  }

  // ===== hashContent 确定性 =====
  {
    assert(hashContent('abc') === hashContent('abc') && hashContent('abc') !== hashContent('abd'), '✓ hashContent 同输入恒同值 / 异输入不同值')
    assert(/^[0-9a-z]+$/.test(hashContent('任意内容')), '✓ hashContent base36 形态')
    assert(hashContent('') === hashContent(''), '✓ hashContent 空串稳定')
  }
}
