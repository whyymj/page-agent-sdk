import { MESSAGES_ZH_CN, MESSAGES_EN_US, resolveDialogMessages } from '../../components/messages'
import type { TestCtx } from './_ctx'

// 对话框文案集(dialog.locale / dialog.messages;openspec 2026-08-16-dialog-i18n Phase 1)
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
  }
}
