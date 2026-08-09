import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * headless 精简构建(page-agent-sdk/headless 子路径)。
 *
 * 与主构建(vite.config.ts)分离而非合并为多入口 —— vite 8 库模式多入口 + ESM 会触发 rollup code splitting,
 * 两入口共享 _createChatSdk 会产 hash 命名 shared chunk(跨版本不稳定,违背精简单文件)。
 * 独立 config 每次构建独立 rollup 调用 → 产物自包含、文件名确定。
 *
 * 镜像 vite.iife.config.ts 的「独立 config + emptyOutDir:false」模式(不清空 lib/iife 产物)。
 *
 * 入口 index.headless.ts 不 re-export 13 个 .vue + 不 import mountChatDialog → rollup 静态可达性
 * 确定排除 ChatDialog 全子树 + marked/highlight.js/dompurify(无需 tree-shaking 优化配置)。
 * 仅 ESM(npm bundler 消费;UMD/IIFE 用户走主包 ui:false)。
 */
export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/core/index.headless.ts'),
      name: 'ChatSdk',
      fileName: 'page-agent-sdk.headless',
      formats: ['es'],
    },
    // 不清空 dist(保留 build:lib / build:iife 已产产物)
    emptyOutDir: false,
    rollupOptions: {
      // external 与主构建一致(zod / @langchain/* / @modelcontextprotocol/*)
      external: ['zod', /^@langchain\//, /^@modelcontextprotocol\//],
      output: {
        exports: 'named',
        // headless 无 .vue 组件 → 不产 CSS;assetFileNames 保留兜底(若有意外 asset)
        assetFileNames: (chunkInfo) => {
          const names = (chunkInfo as any).names ?? []
          return names.some((n: string) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]'
        },
      },
    },
  },
})
