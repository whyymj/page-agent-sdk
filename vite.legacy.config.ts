import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * legacy ESM 单文件构建 —— page-agent-sdk/legacy 子路径(webpack≤4 等老构建链宿主)
 *
 * 与 iife 构建同源异构:入口/external/process shim 完全一致,差异仅两点 ——
 *  ① formats:'es'(宿主 `await import('page-agent-sdk/legacy')` 消费,webpack4 原生动态 import 切懒加载 chunk;
 *     iife 的 <script> 消费者不需要此通道)
 *  ② target:'es2017'(主产物 es2022 的 `?.`/`??` 在 webpack4 acorn 6 直接 parse 失败;
 *     es2017 = 老解析器可 parse 的最小转译面,async/await 原生保留避免 regenerator +60KB)
 *
 * 全量打包(vue/zod/@langchain/MCP/@langchain-anthropic 全 inline,宿主零 peer 安装,z 从本 bundle 导出)。
 * ⚠️ anthropic 与 iife 不同必须打包(不 external):external 时 constructLlm 的 `await import('@langchain/anthropic')`
 * 保留 ES2020 动态 import 语法 —— webpack4 acorn 6.1 + acorn-dynamic-import patch 对「顶层静态 import 的模块内
 * await import()」仍 parse 失败(实测 42622:34 Unexpected token),legacy 消费者是 webpack4 解析器,语法残留 = 0/1 硬失败。
 * 代价 +~400KB(3.05MB),换零语法残留;openai 协议宿主不触达 anthropic 分支但共享同一文件,接受(懒加载 chunk 不进首屏)。
 * 独立 config 而非多入口:vite 8 库模式多入口 + ESM 触发 code splitting 产 hash 共享 chunk(见 vite.headless.config.ts 头注释)。
 */
export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  publicDir: false,
  build: {
    emptyOutDir: false, // 追加到 build:lib/iife/headless 产物,不清空
    target: 'es2017',
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      formats: ['es'],
      fileName: () => 'page-agent-sdk.legacy.js',
    },
    rollupOptions: {
      // 零 external(见头注释:anthropic 也打包,防 ES2020 动态 import 语法残留)
      output: {
        // 单文件契约(exports 只指向 page-agent-sdk.legacy.js,hash chunk 跨版本不可寻址):
        // ESM 格式下 rolldown 默认保留动态 import 切 chunk(MCP SDK 一族),强制内联 → 与 iife 同为自包含单文件
        inlineDynamicImports: true,
        exports: 'named',
        // css 与主构建同源同名(宿主 import 'page-agent-sdk/style.css' 复用既有子路径;legacy 不单独发 CSS)
        assetFileNames: (chunkInfo) => {
          const names = (chunkInfo as any).names ?? []
          return names.some((n: string) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]'
        },
        // 动态 import(MCP SDK)内联进单文件;process shim 与 iife 同款(全量打包后 zod/langchain 残余 process 引用兜底)
        intro:
          'var process=(typeof process!=="undefined")?process:{env:{NODE_ENV:"production"},version:"",platform:"browser",arch:"browser",versions:{},argv:[]};',
      },
    },
  },
})
