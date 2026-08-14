/**
 * HTML 格式校验(纯函数)—— 结构合法性(标签闭合等)
 *
 * 供 createHtmlSubagent 格式校验链(validate_code 工具自检 + verify beforeReturn 门禁)
 * 与集成方渲染层纵深防御复用(导出 validateHtmlFormat)。
 *
 * 定位:html agent 生成**完整页面级 HTML**,改造(抽 body / 包组件 / v-html 片段化等)由下游
 * 插件/tool 做。故本校验**只管结构合法性**,不再施加片段/v-html 限制(DOCTYPE/html/head/body/script 均允许)。
 *
 * 为什么自写标签栈扫描而不用浏览器 DOMParser:
 *  - DOMParser 'text/html' 太宽容(自动补全未闭合标签,检不出遗漏)
 *  - DOMParser 'application/xml' 太严格(HTML5 void 标签如 <br> 会误报)
 *
 * 校验规则(只校验结构):
 *  1. 标签配对闭合(栈扫描;void 元素与 /> 自闭合豁免;属性引号内 > 不误判)
 *  2. script/style 为 raw text 元素(内容不解析,只校验闭合)
 *  3. 注释必须闭合
 *  4. 多余的闭合标签(无匹配开标签)检出
 */

/** HTML void 元素(无需闭合标签) */
export const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** raw text 元素(内容不解析为标签,直到同名闭合标签) */
const RAW_TEXT_TAGS = new Set(['script', 'style'])

/** 格式问题条目 */
export interface HtmlFormatIssue {
  /** 行号(1 基) */
  line: number
  /** 问题码:UNCLOSED_TAG / STRAY_CLOSE_TAG / UNCLOSED_COMMENT(只校验结构合法性;DOCTYPE/html/head/body/script 不再拦 —— 完整页面级 HTML,改造由下游插件/tool 做) */
  code: string
  /** 可直接回灌 LLM 的修正指引 */
  message: string
}

/**
 * 校验 HTML 源码格式(只校验结构合法性:标签闭合等),返回问题列表(空数组 = 通过)。
 * 纯函数、无 DOM 依赖(node/浏览器通用;selftest 覆盖)。
 * 注:script/DOCTYPE/html/head/body 均允许(完整页面级;改造由下游插件/tool 做)。
 */
export function validateHtmlFormat(source: string): HtmlFormatIssue[] {
  const issues: HtmlFormatIssue[] = []
  const n = source.length
  if (!source.trim()) return issues

  // 行号定位:预计算行首偏移,二分查 index 所在行
  const lineStarts = [0]
  for (let k = 0; k < n; k++) if (source[k] === '\n') lineStarts.push(k + 1)
  const lineAt = (idx: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const stack: Array<{ name: string; idx: number }> = []
  let i = 0
  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break

    // 注释 <!-- ... -->
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end < 0) {
        issues.push({ line: lineAt(lt), code: 'UNCLOSED_COMMENT', message: '注释 <!-- 未闭合(缺 -->)' })
        break
      }
      i = end + 3
      continue
    }

    // <! 开头非注释声明(DOCTYPE 等)—— 完整页面正常含 DOCTYPE,不再拦(片段专属检查已移除)
    if (source[lt + 1] === '!') {
      const gt = source.indexOf('>', lt)
      i = gt < 0 ? n : gt + 1
      continue
    }

    // 开/闭标签:< 后须是字母或 /字母(否则是文本,如 a < b)
    const isClose = source[lt + 1] === '/'
    const nameStart = isClose ? lt + 2 : lt + 1
    const firstCh = source[nameStart] ?? ''
    if (!/[a-zA-Z]/.test(firstCh)) {
      i = lt + 1
      continue
    }

    // 找标签结束 >:引号状态机(属性值内的 > 不误判)
    let j = nameStart
    let quote = ''
    while (j < n) {
      const c = source[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      j++
    }
    if (j >= n) {
      issues.push({ line: lineAt(lt), code: 'UNCLOSED_TAG', message: `标签 ${source.slice(lt, Math.min(lt + 20, n))} 未写完(缺 >)` })
      break
    }
    const inner = source.slice(nameStart, j)
    const name = (inner.match(/^[a-zA-Z][a-zA-Z0-9-]*/) ?? [''])[0].toLowerCase()
    const selfClose = !isClose && /\/\s*$/.test(inner)
    i = j + 1
    if (!name) continue

    if (isClose) {
      // 闭合标签:栈顶匹配 → 弹出;栈深处有 → 中间标签未闭合;无 → 多余闭合
      const topIdx = stack.length - 1
      if (topIdx >= 0 && stack[topIdx].name === name) {
        stack.pop()
      } else {
        const at = stack.findIndex((s) => s.name === name)
        if (at >= 0) {
          const popped = stack.splice(at)
          for (const s of popped.slice(1)) {
            issues.push({ line: lineAt(s.idx), code: 'UNCLOSED_TAG', message: `<${s.name}> 未闭合(先遇到 </${name}>)` })
          }
        } else {
          issues.push({ line: lineAt(lt), code: 'STRAY_CLOSE_TAG', message: `</${name}> 无匹配的开标签` })
        }
      }
      continue
    }

    if (HTML_VOID_TAGS.has(name) || selfClose) continue

    // raw text 元素(script/style):内容整体跳过不解析(只校验闭合)。script 有无由用户声明,不再拦
    if (RAW_TEXT_TAGS.has(name)) {
      const closeRe = new RegExp(`</${name}\\s*>`, 'i')
      const m = closeRe.exec(source.slice(i))
      if (!m) {
        issues.push({ line: lineAt(lt), code: 'UNCLOSED_TAG', message: `<${name}> 未闭合(缺 </${name}>)` })
        break
      }
      i += m.index + m[0].length
      continue
    }

    stack.push({ name, idx: lt })
  }

  // 收尾:栈内剩余 = 未闭合标签(按开标签行号报)
  for (const s of stack) {
    issues.push({ line: lineAt(s.idx), code: 'UNCLOSED_TAG', message: `<${s.name}> 未闭合` })
  }
  return issues
}
