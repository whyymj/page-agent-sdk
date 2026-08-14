/**
 * html-page-demo 浏览器 E2E(createHtmlSubagent 单模式 code-as-data-asset)
 *
 * 单模式行为(breaking):代码作为 data.code 资产,vfs 作工作副本,框架自动 checkout/commit。
 *  - 新建组件:子 agent write components.N {code} → afterWrite 补 __pgId → data.code 直接进(不经 vfs/checkout/commit)
 *  - 修改组件:框架 beforeAgent checkout(data.code→vfs 按 __pgId)→ 子 vfs_write/vfs_edit 改工作副本 → afterAgent commit(vfs→data.code 增量)
 *  - verify 门禁扫 vfs 工作副本:仅修改场景 vfs 有 checkout 文件 → 标签问题回灌自纠
 *
 * mock LLM 脚本同时驱动主 agent 与子 agent(共用同一端点,按调用顺序消费):
 *  - test1 新建:use_html → write components.2(追加;初始预置 hero+features)→ 收尾 → 预览自动切到新组件
 *  - test2 修改:use_html → vfs_write 覆盖坏代码(checkout 出的工作副本)→ 门禁回灌 → vfs_write 修正 → commit → 预览更新
 *  - test3 宽内容新建:write components.1(宽 code)→ 预览渲染,验证 grid minmax 收缩
 *  - test4 多组件整页堆叠:demo 预置 hero+features,两组件同时可见 + tab 切换选中块(纯 UI)
 *  - test5 点击聚焦精修:点 features → setFocus → focus_change 事件同步 🎯;取消聚焦按钮验证事件双向同步
 *  - test6 多组件生成:一次委派生成 2 个组件 → 整页堆叠都可见(修前单组件预览只见一个)
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

// iframe 预览(ba991d1 去 SFC:v-html → <iframe :srcdoc> sandbox 隔离):父页 textContent 读不到 iframe 内,
// 改读所有 .preview-iframe 的 srcdoc 属性(wrapPreviewHtml 注入 + code 原文)拼接,断言渲染文本
async function previewText(page: Page): Promise<string> {
  return page.locator('.preview-iframe').evaluateAll((els) => els.map((e) => e.getAttribute('srcdoc') ?? '').join('\n'))
}

test.describe('html-page-demo: HTML 页面生成(单模式 code-as-data-asset)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/html-page-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('新建组件一次通过 → v-html 预览实时渲染(data.code)', async ({ page }) => {
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成一个欢迎区块' } }] },
      {
        tool_calls: [{
          name: 'write',
          arguments: { patch: { op: 'set', jsonPath: 'components.2', value: { type: 'custom', name: 'welcome', code: '<section class="pg-welcome"><h1>欢迎来到演示</h1><p>这是 v-html 注入的片段</p></section>' } } },
        }],
      },
      { text: '已生成 welcome 区块代码' },
      { text: '已完成,预览区已实时更新' },
    ])

    await fillInput(page, '生成一个欢迎区块')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览区经 v-html 渲染 data.components[welcome].code
    const preview = await previewText(page)
    expect(preview).toContain('欢迎来到演示')
    expect(preview).toContain('这是 v-html 注入的片段')
    // 组件切换栏含 welcome(新布局:组件名在 .comp-tab,不在 hint)
    expect(await page.textContent('.comp-tabs')).toContain('welcome')
    // 主 agent 收尾回复
    expect(await page.textContent('.chat-dialog')).toContain('已完成')
    expect(tracker.calls()).toBe(4)
  })

  test('修改组件:未闭合标签 → verify 门禁回灌自纠(vfs_write 修正)→ 预览为修正后内容', async ({ page }) => {
    // demo 预置 hero(__pgId:c_hero);框架 checkout(hero.code→vfs html/c_hero.html)→ 子 vfs_write 覆盖工作副本
    const broken = '<section class="pg-hero"><h1>特惠专区'
    const fixed = '<section class="pg-hero"><h1>特惠专区</h1></section>'
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '把 hero 标题改成特惠专区' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_hero.html', content: broken } }] },
      { text: '已修改 hero 区块' },   // 子首次收口 → 门禁扫 vfs(工作副本被覆盖为 broken)→ UNCLOSED 回灌
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_hero.html', content: fixed } }] },
      { text: '已修正并完成 hero' },  // 门禁通过 → 子返回 → afterAgent commit(vfs fixed → data hero.code)
      { text: 'hero 已改好,预览区已更新' },
    ])

    await fillInput(page, '把 hero 标题改成特惠专区')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览为修正后的内容(commit 把 vfs fixed 回写 data.code;Vue 响应式 → v-html 更新)
    const preview = await previewText(page)
    expect(preview).toContain('特惠专区')
    // 6 次 model 调用 = 门禁触发了一次自纠(无门禁时子 agent 第 3 次即收口)
    expect(tracker.calls()).toBe(6)
    expect(await page.textContent('.chat-dialog')).toContain('hero 已改好')
  })

  test('宽内容片段不挤走右侧聊天框(grid minmax 收缩)', async ({ page }) => {
    // 新建含宽 table + 长不换行串的组件,验证 minmax(0,1fr) 让 .preview 滚动而非撑开列宽挤走 chat
    const wideContent = `<section><table><tr><td>${'A'.repeat(2000)}</td></tr></table><p>${'长串不换行'.repeat(300)}</p></section>`
    await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成宽内容' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.2', value: { type: 'custom', name: 'wide', code: wideContent } } } }] },
      { text: '已生成宽内容' },
      { text: '完成' },
    ])
    await fillInput(page, '生成宽内容')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览渲染了宽内容
    expect(await previewText(page)).toContain('A')
    // 右侧对话框栏未被挤走:.pane-right 宽度 ≈ 左侧 pane-left(1:1 flex;min-width:0 允许收缩,宽内容由 .preview overflow:auto 滚动)
    const chatPane = await page.locator('.pane-right').boundingBox()
    const previewPane = await page.locator('.pane-left').boundingBox()
    expect(chatPane && previewPane).toBeTruthy()
    expect(chatPane!.width).toBeGreaterThanOrEqual(previewPane!.width * 0.8)
  })

  test('多组件:整页堆叠预览(两个组件同时可见)+ tab 切换选中块', async ({ page }) => {
    await mockLlm(page, [{ text: '' }])  // 纯 UI 切换不发消息;mockLlm 防意外真实调用
    const tabs = page.locator('.comp-tab')
    await expect(tabs).toHaveCount(2)
    // 整页堆叠:两个组件同时在预览区可见(页面心智;修前单组件预览只见选中的一个)
    expect(await previewText(page)).toContain('演示页')
    expect(await previewText(page)).toContain('核心特性')
    // 两步拾取:默认无选中(干净起步);点 tab = 选中第 1 步(高亮该块)
    await tabs.nth(0).click()
    await expect(page.locator('.preview-comp').first()).toHaveClass(/selected/)
    await tabs.nth(1).click()   // tab 切到 features → 选中块切到第 1 块
    await expect(page.locator('.preview-comp').nth(1)).toHaveClass(/selected/)
    await tabs.nth(0).click()   // 切回
    await expect(page.locator('.preview-comp').first()).toHaveClass(/selected/)
  })

  test('两步拾取聚焦 → 对话精修(focus_change 事件同步;focus vfs 守卫只放行焦点组件代码)', async ({ page }) => {
    // 两步拾取(同首页):① 点 features tab = 选中(浮层出现)② 点「加入聊天」= addFocus → focus_change 同步 🎯
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '把 features 组件标题改成"核心优势"' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_features.html', content: '<section class="pg-features" style="padding:16px;font-family:sans-serif"><h2 style="margin:0 0 12px">核心优势</h2><p>已聚焦精修</p></section>' } }] },
      { text: '已改 features 标题' },
      { text: 'features 已改好,预览已更新' },
    ])
    // 第 1 步:点 features tab → 选中(PickOverlay 浮层 + 「加入聊天」按钮出现)
    await page.locator('.comp-tab').nth(1).click()
    await expect(page.locator('.pick-overlay__btn')).toBeVisible()
    // 第 2 步:点「加入聊天」→ addFocus → focus_change 事件同步 🎯 标记
    await page.locator('.pick-overlay__btn').click()
    await expect(page.locator('.focus-mark')).toBeVisible()
    await expect(page.locator('.preview-meta')).toContainText('已聚焦')

    await fillInput(page, '把 features 标题改成核心优势')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 整页堆叠预览显示精修后的 features(focus 守卫放行焦点组件;commit 回写 data.code → 块更新)
    expect(await previewText(page)).toContain('核心优势')
    expect(await page.textContent('.chat-dialog')).toContain('features 已改好')
    expect(tracker.calls()).toBe(4)

    // focus_change 双向同步:点 demo「取消聚焦」按钮 → clearFocus → 事件同步 🎯 标记消失
    await page.locator('.link-btn', { hasText: '取消聚焦' }).click()
    await expect(page.locator('.focus-mark')).toHaveCount(0)
    await expect(page.locator('.preview-meta')).not.toContainText('已聚焦')
  })

  test('多组件生成:逐个委派生成 2 个组件(各独立上下文)→ 整页堆叠都可见', async ({ page }) => {
    // 场景:用户「生成2个组件:轮播 + 进球特效」→ 主 agent 逐个委派(每组件独立子 agent,防共享上下文污染)
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成轮播组件' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.2', value: { type: 'custom', name: 'carousel', code: '<section class="wc-carousel"><h3>世界杯轮播</h3></section>' } } } }] },
      { text: '已生成轮播' },
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成活动特效组件' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.3', value: { type: 'custom', name: 'effect', code: '<section class="wc-effect"><h3>进球特效</h3></section>' } } } }] },
      { text: '已生成特效' },
      { text: '完成,生成了轮播 + 特效' },
    ])
    // 初始预置 hero + features(2 个)
    expect(await page.locator('.preview-comp').count()).toBe(2)

    await fillInput(page, '生成2个组件:轮播 + 进球特效')
    await clickSend(page)
    await waitForAgentIdle(page)

    // ① 整页堆叠:4 个组件全部可见(hero + features + carousel + effect)
    expect(await page.locator('.preview-comp').count()).toBe(4)
    expect(await previewText(page)).toContain('世界杯轮播')
    expect(await previewText(page)).toContain('进球特效')
    // ② 组件切换栏含两个新组件
    expect(await page.textContent('.comp-tabs')).toContain('carousel')
    expect(await page.textContent('.comp-tabs')).toContain('effect')
    expect(await page.textContent('.chat-dialog')).toContain('完成')
    expect(tracker.calls()).toBe(7)  // 主委派1→子写1→子收口→主委派2→子写2→子收口→主收口
  })
})
