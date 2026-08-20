// 集成层 e2e runner —— 按模块拆分,各模块独立跑,汇总计数
// 各模块文件在 tests/e2e/<module>.mjs,均 export async function run() 返回 {pass, fail}
// 运行:先 npm run build,再 npm run test:e2e
import { run as runSystemprompt } from './e2e/systemprompt.mjs'
import { run as runDynamicRegister } from './e2e/dynamic-register.mjs'
import { run as runInspect } from './e2e/inspect.mjs'
import { run as runSubagents } from './e2e/subagents.mjs'
import { run as runEvents } from './e2e/events.mjs'
import { run as runStorage } from './e2e/storage.mjs'
import { run as runExports } from './e2e/exports.mjs'
import { run as runDataSlots } from './e2e/data-slots.mjs'
import { run as runPresets } from './e2e/presets.mjs'
import { run as runBoundary } from './e2e/boundary.mjs'
import { run as runCustomInjection } from './e2e/custom-injection.mjs'
import { run as runConflict } from './e2e/conflict.mjs'
import { run as runAutomation } from './e2e/automation.mjs'
import { run as runLlmProvider } from './e2e/llm-provider.mjs'
import { run as runFocus } from './e2e/focus.mjs'
import { run as runImages } from './e2e/images.mjs'
import { run as runResources } from './e2e/resources.mjs'
import { run as runAgentCompression } from './e2e/agent-compression.mjs'
import { run as runHeadlessSubpath } from './e2e/headless-subpath.mjs'
import { run as runLegacySubpath } from './e2e/legacy-subpath.mjs'
import { run as runCapabilityPacks } from './e2e/capability-packs.mjs'
import { run as runAuthorizationSurface } from './e2e/authorization-surface.mjs'
import { run as runHangFeedback } from './e2e/hang-feedback.mjs'
import { run as runMainSubIsolation } from './e2e/main-sub-isolation.mjs'
import { run as runSessionIntegrity } from './e2e/session-integrity.mjs'
import { run as runContextEconomy } from './e2e/context-economy.mjs'
import { run as runMcp } from './e2e/mcp.mjs'
import { run as runPreferences } from './e2e/preferences.mjs'
import { run as runDiagnostics } from './e2e/diagnostics.mjs'
import { run as runInstructionAdherence } from './e2e/instruction-adherence.mjs'
import { run as runThinkingMode } from './e2e/thinking-mode.mjs'

const modules = [
  ['systemprompt', runSystemprompt],
  ['dynamic-register', runDynamicRegister],
  ['inspect', runInspect],
  ['subagents', runSubagents],
  ['events', runEvents],
  ['storage', runStorage],
  ['exports', runExports],
  ['data-slots', runDataSlots],
  ['presets', runPresets],
  ['boundary', runBoundary],
  ['custom-injection', runCustomInjection],
  ['conflict', runConflict],
  ['automation', runAutomation],
  ['llm-provider', runLlmProvider],
  ['focus', runFocus],
  ['images', runImages],
  ['resources', runResources],
  ['agent-compression', runAgentCompression],
  ['headless-subpath', runHeadlessSubpath],
  ['legacy-subpath', runLegacySubpath],
  ['capability-packs', runCapabilityPacks],
  ['authorization-surface', runAuthorizationSurface],
  ['hang-feedback', runHangFeedback],
  ['main-sub-isolation', runMainSubIsolation],
  ['session-integrity', runSessionIntegrity],
  ['context-economy', runContextEconomy],
  ['mcp', runMcp],
  ['preferences', runPreferences],
  ['diagnostics', runDiagnostics],
  ['instruction-adherence', runInstructionAdherence],
  ['thinking-mode', runThinkingMode],
]

let totalPass = 0, totalFail = 0
for (const [, run] of modules) {
  const r = await run()
  totalPass += r.pass
  totalFail += r.fail
}

console.log(`\n==== e2e: ${totalPass} passed, ${totalFail} failed ====`)
if (totalFail > 0) process.exit(1)
