import { test, expect } from '@playwright/test'

/**
 * multi-agent-demo 浏览器 E2E(多 agent 切换 + drawer 形态)。
 * 首个用例:浮层层叠 —— Debug 抽屉必须盖在抽屉形态聊天窗之上(learning 门户实测驱动,2026-09-20)。
 */
test.describe('multi-agent-demo: 浮层层叠(Debug 抽屉 × drawer 聊天窗)', () => {
  test('打开日志抽屉 → 覆盖聊天窗(elementFromPoint 命中抽屉;修前 z9000 被 9999 压住须先关聊天窗)', async ({ page }) => {
    await page.goto('/examples/multi-agent-demo/')
    await page.waitForSelector('.chat-dialog.drawer') // drawer 形态(mask 9998 + 面板 9999)
    // 打开 Debug 抽屉:更多菜单第一项(debug:true 时为首项,与 i18n.spec 同款路径)
    await page.click('.chat-dialog .more-btn')
    await page.click('.chat-dialog .more-item:first-child')
    await page.waitForSelector('.debug-drawer .drawer-panel')

    // ① 层叠序:抽屉 z-index 恒高于聊天窗面板(静态判定)
    const z = await page.evaluate(() => ({
      debug: parseInt(getComputedStyle(document.querySelector('.debug-drawer')!).zIndex, 10),
      chat: parseInt(getComputedStyle(document.querySelector('.chat-dialog.drawer')!).zIndex, 10),
    }))
    expect(z.debug, `抽屉 z(${z.debug}) > 聊天窗 z(${z.chat})`).toBeGreaterThan(z.chat)

    // ② 行为面:重叠区命中 debug 抽屉(视觉在上的判定源 = elementFromPoint;
    //    修前命中聊天窗 → 日志弹窗被整层盖住,要先关聊天窗才能看到)
    const hit = await page.evaluate(() => {
      const chat = document.querySelector('.chat-dialog.drawer')!.getBoundingClientRect()
      // 重叠区取样:聊天窗头部内侧(两面板都覆盖此处;抽屉面板 520px 宽于聊天窗 420px)
      const x = chat.left + 100
      const y = chat.top + 30
      const el = document.elementFromPoint(x, y)
      return { cls: String(el?.className ?? ''), tag: el?.tagName ?? '' }
    })
    expect(hit.cls, `重叠区命中 debug 抽屉(mask/panel),实际命中:${hit.tag}.${hit.cls}`).toContain('drawer')
  })
})
