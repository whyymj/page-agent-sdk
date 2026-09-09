/** 每轮固定成本:estimateTokens(CJK regex) + trimContextIfNeededImpl 全上下文扫描 */
import { estimateTokens } from '../../src/core/utils/modelCaps'
import { trimContextIfNeededImpl } from '../../src/core/harness/createAgent'
import { ToolMessage, HumanMessage } from '@langchain/core/messages'
import { makeBind } from './mkbind'

function bench(name: string, fn: () => unknown, runs = 20): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); times.push(performance.now() - t0) }
  times.sort((a, b) => a - b)
  console.log(`${name.padEnd(52)} median ${times[Math.floor(runs / 2)].toFixed(2)}ms`)
}

// 场景文本:① ASCII 为主的 JSON 工具结果 ② 中文对话
const bind = makeBind(300 * 1024)
const jsonText = JSON.stringify(bind)          // 300KB ASCII 为主
const cjkText = '这是一段中文对话内容,用于测试中文正则匹配的开销。'.repeat(2400) // ~117KB 全中文

bench('estimateTokens 300KB JSON(ASCII 主)', () => estimateTokens(jsonText))
bench('estimateTokens 117KB 全中文', () => estimateTokens(cjkText))
bench('estimateTokens 4KB(单 system 段)', () => estimateTokens(jsonText.slice(0, 4096)))

// 真实轮上下文:模拟 30 轮工具后的 currentMessages(每轮 AI+ToolMessage)
function buildRoundContext(rounds: number): any[] {
  const msgs: any[] = [new HumanMessage('帮我搭建活动页')]
  for (let i = 0; i < rounds; i++) {
    msgs.push(new (require('@langchain/core/messages').AIMessage)(`调用工具 ${i}`))
    msgs.push(new ToolMessage({ tool_call_id: `c${i}`, content: jsonText.slice(0, 20000) })) // 20KB 工具结果(读子树)
  }
  return msgs
}
for (const rounds of [10, 30]) {
  const msgs = buildRoundContext(rounds)
  const totalKB = (msgs.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0) / 1024).toFixed(0)
  bench(`trimContextIfNeeded ${rounds}轮工具 上下文~${totalKB}KB ×1`, () => trimContextIfNeededImpl(msgs, 10_000_000))
  // 一次 invoke 30 个模型轮,每轮 trim 一次(不触发的常态路径也要全扫)
  const t0 = performance.now()
  for (let i = 0; i < 30; i++) trimContextIfNeededImpl(msgs, 10_000_000)
  console.log(`  → 30 模型轮 × trim 全扫累计:${(performance.now() - t0).toFixed(1)}ms(上下文 ${totalKB}KB)`)
}
