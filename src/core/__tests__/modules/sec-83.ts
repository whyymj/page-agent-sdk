import { MESSAGES_ZH_CN, MESSAGES_EN_US, resolveDialogMessages } from '../../components/messages'
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_EN } from '../../sdk/promptBuilder'
import { systemPromptHelpers } from '../../presets'
import type { TestCtx } from './_ctx'

// 对话框文案集(顶层 i18n:{ locale, messages };openspec 2026-08-16-dialog-i18n Phase 1 + Phase 2;3.22 两键合并为 i18n 配置组)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[对话框文案 · resolveDialogMessages]')
  {
    // 键空间完整性:zh/en 同键集(漏译键会让 resolve 后混语言)
    const zhKeys = Object.keys(MESSAGES_ZH_CN).sort()
    const enKeys = Object.keys(MESSAGES_EN_US).sort()
    assert(zhKeys.join(',') === enKeys.join(','), `MESSAGES_ZH_CN 与 MESSAGES_EN_US 键集一致(${zhKeys.length} 键)`)
    // 缺省 zh(不传 locale)行为零变化
    const zh = resolveDialogMessages()
    assert(zh.statusDone === '成功' && zh.defaultTitle === 'AI 助手', 'resolveDialogMessages 缺省 → zh-CN 包(默认行为零变化)')
    // en 包
    const en = resolveDialogMessages('en-US')
    assert(en.statusDone === 'Success' && en.emptyGreeting === 'How can I help you?', "resolveDialogMessages('en-US') → 英文包")
    // messages 覆盖优先于 locale 包(键级自定义:不改语言换措辞)
    const mixed = resolveDialogMessages('zh-CN', { statusDone: '完成' })
    assert(mixed.statusDone === '完成', 'messages 覆盖优先于 locale 包(用户诉求「成功→完成」)')
    assert(mixed.statusError === '失败', '未覆盖键保持 locale 包值')
    const mixedEn = resolveDialogMessages('en-US', { statusDone: 'Done ✓' })
    assert(mixedEn.statusDone === 'Done ✓' && mixedEn.statusError === 'Failed', 'en 包 + 键级覆盖可叠加')
    // 非字符串值忽略;任意键不缺(漏配回退)
    const bad = resolveDialogMessages('en-US', { copy: 123 as unknown as string })
    assert(bad.copy === 'Copy', '非字符串覆盖值忽略(回退包值)')
    // 返回新对象不 mutate 包
    resolveDialogMessages('en-US', { copy: 'X' })
    assert(MESSAGES_EN_US.copy === 'Copy', 'resolve 不 mutate MESSAGES_EN_US(包不可变)')

    // ===== Phase 2:面板文案键(DebugDrawer/SkillPanel/CodePreview)在双包中齐备且非空 =====
    const phase2Keys = [
      'debugTabLogs', 'debugTabFlow', 'debugTabContext', 'debugTabSubagent', 'debugTabInfo',
      'debugFilterAll', 'debugFlowPrep', 'debugLogsEmpty', 'debugCardView', 'debugViewRawJson',
      'debugTodoPending', 'debugSubRunning', 'debugLocksTitle', 'debugSubagentEmpty',
      'debugMetricRounds', 'debugCtxOccupancy', 'debugCtxRecalled', 'debugInfoBasic',
      'debugSkillsTitle', 'debugDataTitle', 'debugVerifyTitle', 'debugTodosTitle', 'debugLastCompTitle',
      'debugSkillNoReader', 'skillPanelTitle', 'skillCreateNew', 'skillNamePlaceholder',
      'skillErrName', 'skillDupWarnPrefix', 'skillHintA', 'codeCopyTitle', 'codePreviewTab',
    ] as const
    for (const k of phase2Keys) {
      assert(typeof MESSAGES_ZH_CN[k] === 'string' && MESSAGES_ZH_CN[k].length > 0, `Phase2 面板键 ${k} 在 zh 包齐备`)
      assert(typeof MESSAGES_EN_US[k] === 'string' && MESSAGES_EN_US[k].length > 0, `Phase2 面板键 ${k} 在 en 包齐备`)
    }
    assert(MESSAGES_ZH_CN.debugTabLogs !== MESSAGES_EN_US.debugTabLogs, 'Phase2 面板键 zh/en 值确有区分(非同值占位)')
  }

  // ===== Phase 2:默认 systemPrompt 语言策略(buildSystemPrompt locale 分支)=====
  {
    // zh 缺省零回归:不传 locale = 现行为(中文默认 prompt)
    const zhDefault = buildSystemPrompt({})
    assert(zhDefault === DEFAULT_SYSTEM_PROMPT, 'buildSystemPrompt 不传 locale → 中文默认 prompt(零回归)')
    assert(zhDefault.includes('JSON 操作助手'), 'zh 默认 prompt 含中文身份段')
    // en locale + 未传 systemPrompt → 英文默认 prompt + 语言锚 + EN 规则
    const enDefault = buildSystemPrompt({ locale: 'en-US' })
    assert(enDefault === DEFAULT_SYSTEM_PROMPT_EN, "buildSystemPrompt locale:'en-US' 未传 systemPrompt → DEFAULT_SYSTEM_PROMPT_EN")
    assert(enDefault.includes('JSON operations assistant'), 'EN 默认 prompt 含英文身份段')
    assert(enDefault.includes('Respond in English'), 'EN 默认 prompt 含语言锚(确保 agent 输出英文)')
    assert(enDefault.includes(systemPromptHelpers.reliableWriteRulesEn), 'EN 默认 prompt 内置 reliableWriteRulesEn')
    assert(!enDefault.includes(systemPromptHelpers.reliableWriteRules), 'EN 默认 prompt 不含中文规则段')
    // en locale + 自定义 systemPrompt → prompt 原样 + 追加 EN 规则(SDK 追加段跟 UI 语言)
    const enCustom = buildSystemPrompt({ systemPrompt: 'You are a page builder.', locale: 'en-US' })
    assert(enCustom.startsWith('You are a page builder.'), 'EN locale + 自定义 systemPrompt → 用户段原样')
    assert(enCustom.includes(systemPromptHelpers.reliableWriteRulesEn) && !enCustom.includes(systemPromptHelpers.reliableWriteRules), 'EN locale 自定义 prompt 追加 EN 规则段')
    // zh locale(显式)+ 自定义 → 追加中文规则(现状)
    const zhCustom = buildSystemPrompt({ systemPrompt: '你是页面助手。', locale: 'zh-CN' })
    assert(zhCustom.includes(systemPromptHelpers.reliableWriteRules), 'zh locale 自定义 prompt 追加中文规则(现状)')
    // appendReliableWriteRules:false + en → 不追加
    const noAppend = buildSystemPrompt({ systemPrompt: 'X', appendReliableWriteRules: false, locale: 'en-US' })
    assert(noAppend === 'X', 'appendReliableWriteRules:false → 不追加(与 locale 正交)')
    // EN 规则键自身存在且为英文(与中文版逐条结构对齐:都以规则 6 条结尾)
    assert(systemPromptHelpers.reliableWriteRulesEn.startsWith('[Reliable write rules]'), 'reliableWriteRulesEn 导出可用')
    assert((systemPromptHelpers.reliableWriteRulesEn.match(/^6\./m)?.length ?? 0) === 1 && systemPromptHelpers.reliableWriteRulesEn.includes('optimistic-lock'), 'EN 规则含第 6 条乐观锁行为(与中文版对齐)')
  }
}
