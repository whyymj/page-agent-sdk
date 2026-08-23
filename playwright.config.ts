import { defineConfig, devices } from '@playwright/test'
import { homedir } from 'os'
import { join } from 'path'

// 自动定位浏览器安装路径:优先 PLAYWRIGHT_BROWSERS_PATH,否则用默认缓存目录
// 避免 CI / 新机器需手动设 env
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(homedir(), 'Library', 'Caches', 'ms-playwright')

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false, // 保持 false:workers:N 下 spec 文件即调度分片、文件内保序(与串行行为一致);开启收益趋零、CPU 争抢峰值翻倍
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // browser-test-sharding:2 = 并行档(spec 文件级分片,每文件独立 context + mockLlm page.route 拦截,无跨文件共享态)。
  // 明令禁止「预启动 dev server + 复用」依赖:遗留旧 server optimizeDeps 失配 → 页面强制 reload → 在途用例假性失败(CLAUDE.md §3.5 前科);
  // 保持 Playwright 托管生命周期(不在则拉起、跑完即收)。冷 .vite 缓存首跑遇批量 reload 型失败 → 重跑一次预热,不判回归
  workers: 4,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // --port 5173 --strictPort:vite 固定 5173(占则报错而非跳端口);避 3000 被本机其他服务(如 user-bff)占用时
    // reuseExistingServer 误把该服务当 dev server 复用,导致页面命中错误响应(.chat-dialog 不挂载)
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // 注入假 apiKey/model:browser E2E 用 page.route 拦截 chat/completions 返回 mock SSE,
    // 但 ChatOpenAI 构造时若 apiKey 空(无 .env)会提前抛 "Missing credentials"(不发请求 → mock 无效);
    // 假值让构造通过,实际请求被 page.route 拦截,不连真 LLM。
    // model 需 ≥200K 上下文窗口过 createChatSdk MIN_CONTEXT_WINDOW 校验(harden-context-resilience);
    // glm-5.2=1M。旧 gpt-3.5-turbo(16K)<200K 会启动 throw 致 ChatDialog 不挂载
    env: { VITE_AI_API_KEY: 'sk-mock', VITE_AI_MODEL: 'glm-5.2' },
  },
})
