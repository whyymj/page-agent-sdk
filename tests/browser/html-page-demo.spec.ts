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
 *  - test4 多组件切换:demo 预置 hero+features,tab 切换预览(纯 UI,不触发 LLM)
 *  - test5 点击聚焦精修:点 features tab → setFocus(components.1)→ 子 vfs_write features(焦点放行)→ 预览更新(focus vfs 守卫)
 */
import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

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
    const preview = await page.textContent('.preview')
    expect(preview).toContain('欢迎来到演示')
    expect(preview).toContain('这是 v-html 注入的片段')
    // 组件名标注 + 代码查看入口(单模式:来源是组件名,非 vfs 路径)
    expect(await page.textContent('.preview-col .hint')).toContain('welcome')
    expect(await page.locator('.code-view summary').count()).toBe(1)
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
    const preview = await page.textContent('.preview')
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
    expect(await page.textContent('.preview')).toContain('A')
    // 右侧聊天框未被挤走:chat-mount 宽度 ≈ 左侧 preview-col(1:1 grid;修复前宽内容撑爆 track → chat 宽→0)
    const chatBox = await page.locator('.chat-mount').boundingBox()
    const previewCol = await page.locator('.preview-col').boundingBox()
    expect(chatBox && previewCol).toBeTruthy()
    expect(chatBox!.width).toBeGreaterThanOrEqual(previewCol!.width * 0.8)
  })

  test('多组件:tab 切换预览不同组件(demo 预置 hero + features)', async ({ page }) => {
    await mockLlm(page, [{ text: '' }])  // 纯 UI 切换不发消息;mockLlm 防意外真实调用
    const tabs = page.locator('.comp-tab')
    await expect(tabs).toHaveCount(2)
    // 默认选中第 0 个(hero),预览含 hero 内容
    expect(await page.textContent('.preview')).toContain('演示页')
    await tabs.nth(1).click()   // 切到 features
    expect(await page.textContent('.preview')).toContain('核心特性')
    await tabs.nth(0).click()   // 切回 hero
    expect(await page.textContent('.preview')).toContain('演示页')
  })

  test('点击组件聚焦 → 对话精修该组件(focus vfs 守卫只放行焦点组件代码)', async ({ page }) => {
    // 点 features tab → selectComp → setFocus(components.1);子 agent 继承焦点,精修只能改 features 代码(越界 PATH_DENIED)
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '把 features 组件标题改成"核心优势"' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_features.html', content: '<section class="pg-features" style="padding:16px;font-family:sans-serif"><h2 style="margin:0 0 12px">核心优势</h2><p>已聚焦精修</p></section>' } }] },
      { text: '已改 features 标题' },
      { text: 'features 已改好,预览已更新' },
    ])
    const tabs = page.locator('.comp-tab')
    await tabs.nth(1).click()
    // 🎯 聚焦标记可见 + hint 提示已聚焦
    await expect(page.locator('.focus-mark')).toBeVisible()
    await expect(page.locator('.preview-col .hint')).toContainText('已聚焦')

    await fillInput(page, '把 features 标题改成核心优势')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览显示精修后的 features(focus 守卫放行焦点组件;commit 回写 data.code → v-html 更新)
    expect(await page.textContent('.preview')).toContain('核心优势')
    expect(await page.textContent('.chat-dialog')).toContain('features 已改好')
    expect(tracker.calls()).toBe(4)
  })
})
