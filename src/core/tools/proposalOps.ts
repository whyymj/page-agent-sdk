/**
 * content-proposals 纯函数域(openspec/changes/2026-09-19-content-proposals):
 * lineDiff(逐行 unified diff)/ applyProposalOps(增量 ops 应用)/ hashContent(基底指纹)。
 *
 * 零依赖、渲染无关 —— lineDiff 与 applyProposalOps 同时是包导出(宿主评审面板渲染/预演用)。
 */

/** LCS 乘积上限:超过即回退整块替换(2000×2000 = 4e6;防病态输入拖死主线程) */
const LCS_CELL_LIMIT = 4_000_000

/** 逐行 diff 行类型(same=未改动 / add=新增 / del=删除;skip 为宿主渲染折叠产物,本函数不产出) */
export interface DiffRow {
  type: 'same' | 'add' | 'del'
  text: string
}

function toRows(type: DiffRow['type'], lines: string[]): DiffRow[] {
  return lines.map((text) => ({ type, text }))
}

/**
 * 计算两个文本的逐行 diff(公共前缀/后缀修剪 → 中段 LCS 动态规划;中段乘积超限回退整块替换)。
 * 与学习门户 note-diff 同款算法(真机评审面板验证过);渲染无关,返回行类型序列 + 统计。
 */
export function lineDiff(oldText: string, newText: string): { rows: DiffRow[]; stats: { added: number; removed: number } } {
  // 空文本按零行处理("".split("\n") 会产生 [""] 的伪行)
  const a = oldText ? String(oldText).split('\n') : []
  const b = newText ? String(newText).split('\n') : []

  // 公共前缀
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  // 公共后缀(不得与前缀重叠)
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle = midA.length * midB.length > LCS_CELL_LIMIT
    ? [...toRows('del', midA), ...toRows('add', midB)] // 回退:不做 LCS,整块替换(展示等价「这一段被重写」)
    : lcsRows(midA, midB)

  const rows = [...toRows('same', a.slice(0, start)), ...middle, ...toRows('same', a.slice(endA))]
  return {
    rows,
    stats: {
      added: rows.filter((r) => r.type === 'add').length,
      removed: rows.filter((r) => r.type === 'del').length,
    },
  }
}

/** 中段 LCS(经典 DP,回溯产出 add/del/same 序列;输入已保证规模受控) */
function lcsRows(a: string[], b: string[]): DiffRow[] {
  const height = a.length
  const width = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度;Uint32 一维数组省内存
  const dp = new Uint32Array((height + 1) * (width + 1))
  const at = (i: number, j: number): number => i * (width + 1) + j
  for (let i = height - 1; i >= 0; i -= 1) {
    for (let j = width - 1; j >= 0; j -= 1) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < height && j < width) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      rows.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      rows.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < height) { rows.push({ type: 'del', text: a[i] }); i += 1 }
  while (j < width) { rows.push({ type: 'add', text: b[j] }); j += 1 }
  return rows
}

/** 增量提案操作(判别联合;字面锚点纪律:锚文本须在当前内容中唯一命中) */
export type ProposalOp =
  | { op: 'replace'; find: string; with: string }
  | { op: 'insertAfter'; anchor: string; text: string }
  | { op: 'insertBefore'; anchor: string; text: string }
  | { op: 'append'; text: string }

/** 字面锚点命中数(countOccurrences;锚为空串视为不命中 —— 空锚会命中任意位置) */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

export type ApplyOpsResult = { ok: true; content: string } | { ok: false; error: string }

/**
 * 顺序应用增量 ops(后者见到前者的结果)。**原子**:任一 op 失败整批拒绝,错误指名第几个 op 与命中数
 * (镜像 write patches 语义 —— 宁拒勿半改)。锚点纪律:replace/insert 的字面锚须唯一命中
 * (0 命中 = 锚写错或基底已变;≥2 命中 = 锚太短须加长上下文),与「read 后写」哲学同构。
 */
export function applyProposalOps(base: string, ops: ProposalOp[]): ApplyOpsResult {
  let content = String(base ?? '')
  for (let n = 0; n < ops.length; n += 1) {
    const op = ops[n]
    if (!op || typeof op !== 'object') return { ok: false, error: `第 ${n + 1} 个 op 格式无效` }
    if (op.op === 'replace') {
      const hits = countOccurrences(content, op.find)
      if (hits === 0) return { ok: false, error: `第 ${n + 1} 个 op(replace)锚点未命中 —— 锚文本在当前内容中不存在(可能锚写错或基底已变),请核对 read_content 的原文后重试` }
      if (hits > 1) return { ok: false, error: `第 ${n + 1} 个 op(replace)锚点命中 ${hits} 次,须唯一 —— 请把锚加长到能唯一定位(多带前后文)` }
      content = content.replace(op.find, op.with)
    } else if (op.op === 'insertAfter' || op.op === 'insertBefore') {
      const hits = countOccurrences(content, op.anchor)
      if (hits === 0) return { ok: false, error: `第 ${n + 1} 个 op(${op.op})锚点未命中 —— 请核对 read_content 的原文后重试` }
      if (hits > 1) return { ok: false, error: `第 ${n + 1} 个 op(${op.op})锚点命中 ${hits} 次,须唯一 —— 请把锚加长到能唯一定位` }
      const idx = content.indexOf(op.anchor)
      const at = op.op === 'insertAfter' ? idx + op.anchor.length : idx
      content = content.slice(0, at) + op.text + content.slice(at)
    } else if (op.op === 'append') {
      content = content + op.text
    } else {
      return { ok: false, error: `第 ${n + 1} 个 op 类型未知:${String((op as { op?: unknown }).op)}` }
    }
  }
  return { ok: true, content }
}

/**
 * 内容指纹(FNV-1a 32 位 → base36;确定性与稳定性跨会话,同输入恒同输出)。
 * 用途:提案基底锚定(propose_content 携带 read_content 时的 hash,SDK 重读比对 —— 基底漂移显式拒)。
 * 非密码学哈希(防碰撞篡改不在威胁模型;一致性锚定足够)。
 */
export function hashContent(text: string): string {
  const s = String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    // FNV-1a 乘法(32 位溢出回绕;Math.imul 保 32 位语义)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
