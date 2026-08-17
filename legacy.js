// legacy 子路径物理转发文件(page-agent-sdk/legacy)
//
// 用途:webpack ≤4 / vue-cli 2-3 的增强解析器(enhanced-resolve 4)不认 package.json "exports" map,
// 子路径按「包根目录文件」解析 —— 本文件即 node_modules/page-agent-sdk/legacy 的解析目标,
// 转发到 es2017 全量打包产物(dist/page-agent-sdk.legacy.js,vue/zod/@langchain 全 inline,宿主零 peer)。
//
// 用法(webpack4 原生动态 import,自动切独立懒加载 chunk,不进首屏主包):
//   const { createChatSdk, z, defineTool } = await import('page-agent-sdk/legacy')
// CSS:import 'page-agent-sdk/style.css'(webpack4 对 css-loader 链同样按物理路径解析,已随包分发)
export * from './dist/page-agent-sdk.legacy.js'
