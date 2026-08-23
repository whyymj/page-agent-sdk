/**
 * capabilities 能力开关注册表 + 单一解析(p2-architecture-refactor 子项 4)
 *
 * 消除 17 个开关 `=== true`(opt-in)/`!== false`(opt-out)在 createChatSdk / toolsets / usageHints
 * 三处混用解析 —— 统一经 `resolveCapabilities`。注册表显式标 `defaultOn`(opt-in/opt-out),
 * `requires` 表达依赖(如 draftWrite 需 dataOps + vfs,任一关则强制关)。
 *
 * 设计:
 *  - opt-out(`defaultOn:true`,核心能力):未传 / 传非 false → 开;传 false → 关。如 dataOps/fetch/planning...
 *  - opt-in(`defaultOn:false`,有成本/最远能力):传 true → 开;否则关。如 verify/domInspect/draftWrite/tracing...
 *  - requires:依赖未满足 → 强制关(防"开 draftWrite 但关 dataOps"等无意义组合)
 *  - 纯函数无依赖:toolsets(createChatSdk 上游)+ usageHints(harness)均 import,无循环
 */
export interface Capability {
  /** 开关名(对应 ChatSdkOptions.capabilities 的 key) */
  name: string
  /** true=opt-out(默认开,!== false 才关);false=opt-in(默认关,=== true 才开) */
  defaultOn: boolean
  /** 依赖的其他 capability(任一未开则本项强制关;如 draftWrite 需 dataOps + vfs) */
  requires?: readonly string[]
}

/** 集成方传入的原始开关(Partial;未传的 key 用默认) */
export type CapabilityFlags = Partial<Record<string, boolean>>

/** 解析后的开关(全量 boolean,每个 capability 都有明确 true/false) */
export type ResolvedCapabilities = Record<string, boolean>

/**
 * 已列入移除计划的配置键(config-surface-pruning 第一轮审计 2026-08-24;维护者确认外部集成方零使用)。
 * 装配期命中 → console.warn(每挂载一次,含移除目标版本 + 迁移指引);移除在 warn 期满的后续版本执行。
 * 值 = 迁移指引文案(不引导声明任何新配置)。
 */
export const DEPRECATED_CAPABILITIES: Readonly<Record<string, string>> = {
  preferences: '跨会话用户偏好记忆(getPreferences/removePreference/clearPreferences 将同批移除);迁移:自行存储偏好经 systemPrompt/augmentSystem 注入',
  tracing: '结构化追踪(inspect().trace 与 onEvent "trace" 将同批移除);迁移:debugLogs + exportDiagnostics 已覆盖运行态观察',
  skillHostScript: 'skill 宿主脚本执行;迁移:defineSkill 的 exec 回调自行编排集成方逻辑',
  bulkGuard: '大批量变更门禁;迁移:approval.tools 手工圈选高危工具',
}

/**
 * 能力注册表(21 开关)。
 * - opt-out 默认开(13 个):核心能力,关才需显式 false
 * - opt-in 默认关(8 个):有 token 成本/最远能力,需显式 true 开启
 * - 另有 bulkGuard 不在注册表(createChatSdk 装配期特判,须配 approval;见 types Capabilities 联合)
 */
export const CAPABILITIES: readonly Capability[] = [
  // —— opt-out 默认开 ——
  { name: 'dataOps', defaultOn: true },
  { name: 'fetch', defaultOn: true },
  { name: 'planning', defaultOn: true },
  { name: 'missionAnchor', defaultOn: true },
  { name: 'workingMemory', defaultOn: true },
  { name: 'focus', defaultOn: true }, // 上下文聚焦·指定组件精修(默认开;聚焦后目标/视野/范围三层收敛到单组件;focus-context)
  { name: 'skills', defaultOn: true },
  { name: 'vfs', defaultOn: true },
  { name: 'summarization', defaultOn: true },
  { name: 'memory', defaultOn: true },
  { name: 'subagent', defaultOn: true },
  { name: 'inspectEnv', defaultOn: true },
  { name: 'contextInspector', defaultOn: true },
  // —— opt-in 默认关 ——
  { name: 'verify', defaultOn: false },
  { name: 'domInspect', defaultOn: false },
  { name: 'draftWrite', defaultOn: false, requires: ['dataOps', 'vfs'] },
  { name: 'tracing', defaultOn: false },
  { name: 'skillHostScript', defaultOn: false, requires: ['skills'] },
  { name: 'automation', defaultOn: false },
  { name: 'agentCompression', defaultOn: false, requires: ['summarization'] }, // 压缩 agent 自主决策(opt-in;开 + summaryLlm 可用 → decide 驱动压缩;失败降级静态)
  { name: 'preferences', defaultOn: false }, // 跨会话用户偏好记忆(opt-in;自动写用户浏览器是行为敏感项,默认关;捕获→preferenceStore 持久化→pin 段注入)
]

/**
 * 单一解析函数:把集成方原始 caps(Partial)解析为全量 boolean Record。
 * - opt-out(defaultOn:true):未传或传非 false → 开;传 false → 关
 * - opt-in(defaultOn:false):传 true → 开;否则关
 * - requires:依赖未满足(任一关)→ 强制关(draftWrite 需 dataOps + vfs)
 *
 * 用法:createChatSdk 内 `const caps = resolveCapabilities(options.capabilities)` →
 *       `useDataOps = caps.dataOps` / `useDraft = caps.draftWrite`...(不再 `!== false`/`=== true`)。
 *       toolsets.selectBuiltinTools / usageHints 内部各自调本函数(签名向后兼容,接收 raw caps)。
 */
export function resolveCapabilities(caps?: Record<string, unknown>): ResolvedCapabilities {
  const resolved: ResolvedCapabilities = {}
  for (const cap of CAPABILITIES) {
    const userVal = caps?.[cap.name]
    resolved[cap.name] = cap.defaultOn ? (userVal !== false) : (userVal === true)
  }
  // requires 二轮:依赖未满足则强制关(防 draftWrite:true 但 dataOps:false 等无意义组合)
  for (const cap of CAPABILITIES) {
    if (cap.requires && resolved[cap.name]) {
      for (const dep of cap.requires) {
        if (!resolved[dep]) { resolved[cap.name] = false; break }
      }
    }
  }
  return resolved
}
