// render-check 测试宿主入口:把真沙箱运行器挂到 window 供 Playwright probe
// (不经 mockLlm/委派链,直接测 iframe 沙箱本体:握手/信号采集/指标/销毁/CSP 降级)
import { renderInSandbox, normalizeRenderResult, getSandboxLifecycle, buildSandboxSrcdoc } from '../../../src/core/sdk/htmlRenderCheck'

;(window as unknown as Record<string, unknown>).__pgRenderProbe = {
  renderInSandbox,
  normalizeRenderResult,
  getSandboxLifecycle,
  buildSandboxSrcdoc,
}
