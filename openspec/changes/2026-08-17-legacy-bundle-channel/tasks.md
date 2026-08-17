# Tasks: legacy-bundle-channel

> 实施清单,`/opsx:apply legacy-bundle-channel` 按此执行。minor 级(新增子路径产物,零破坏)。

## 阶段 1:legacy 构建产物

- [x] 1a `vite.legacy.config.ts`(镜像 iife:全打包零 external 除 @langchain/anthropic、process shim intro、emptyOutDir:false;差异:formats:['es'] + target:'es2017' + fileName page-agent-sdk.legacy.js)
- [x] 1b `package.json`:scripts.build 追加 `build:legacy`;exports 增 `"./legacy"` 子路径(types 复用 types/index.d.ts)
- [x] 1c `npm run build` 五产物齐;es2017 验证:产物内 `grep -c '?\.'` 语法零残留(esbuild 已降级)+ node `import()` 冒烟(createChatSdk/z/defineTool 可达)

## 阶段 2:测试与监控

- [x] 2a `tests/size-check.mjs` 增 legacy 阈值(基线实测 +10%;预计 ~2MB)
- [x] 2b e2e 冒烟:`tests/e2e/` 增 legacy 子路径加载测试(动态 import → createChatSdk 最小装配 → mount headless 断言);exports-consistency 自然覆盖(走 types/index.d.ts 同一声明)
- [x] 2c 门禁全绿:build / selftest / e2e / browser / exports / types / size

## 阶段 3:真实宿主验证(editor_fangzhou 靶场)

- [x] 3a editor_fangzhou:`npm i page-agent-sdk`(legacy 通道)+ `loadSdk.js` 改 `await import('page-agent-sdk/legacy')`,退役 public/page-agent-sdk 手工拷贝
- [x] 3b dev server 冒烟:面板挂载 + 真实 LLM 一轮(复用 2026-08-17 接入验证脚本路径:toggleAiAssistant → send → nodeInfo 断言)
- [x] 3c webpack4 chunk 验证:legacy 进独立 lazy chunk(不进主包)+ `?.` 经宿主构建链 parse 无错

## 阶段 4:文档与收尾

- [x] 4a `skills/page-agent-sdk-integrate/SKILL.md` + references 增「老构建链接入」段(决策树:现代构建→ESM / webpack≤4→legacy 动态 import / 无构建→IIFE;Vue2 共存;CORS 网关注意)
- [x] 4b `doc/usage-guide.md`/`.en.md`、`README.md`/`README.zh-CN.md` 引入方式段同步(中英勿单边)
- [x] 4c CHANGELOG [Unreleased] Added 条目;CLAUDE.md 构建产物行同步
- [x] 4d 门禁复跑 → 待用户确认 bump + 发布
