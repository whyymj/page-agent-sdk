# page-agent-sdk Usage Guide

> **[English](./usage-guide.en.md)** · **[中文](./usage-guide.md)**

> Framework-agnostic in-page Agent SDK: mount in one line, give any web page an AI chat dialog that can **read/write the host page, call tools, and plan tasks**.

> This is a condensed English guide covering the essentials. For full details (complete option tables, middleware deep-dive, imperative API), see the [Chinese usage guide](./usage-guide.md).

---

## Table of Contents

- [1. What it is](#1-what-it-is)
- [2. Install](#2-install)
- [3. Quick start (3 min)](#3-quick-start-3-min)
- [4. Core concepts](#4-core-concepts)
- [5. Options reference](#5-options-reference)
- [6. Capabilities](#6-capabilities)
- [7. Custom middleware](#7-custom-middleware)
- [8. Framework-agnostic / CDN](#8-framework-agnostic--cdn)
- [9. Environment variables](#9-environment-variables)
- [10. FAQ & gotchas](#10-faq--gotchas)

---

## 1. What it is

`page-agent-sdk` is a **JS SDK** that mounts a ReAct-based Tool-Calling Agent as a **chat dialog** on any web page. The Agent can:

- **Read/write host page** `window` props you declare (with schema validation + snapshot rollback) → directly drive your page UI
- **Call tools**: fetch docs, read/write virtual workspace, plus any custom tools you add
- **Plan multi-step tasks** (todos), **load skills on demand**, **remember persistent directives** (memory)
- **Persist conversations** (IndexedDB, falls back to memory), **multi-agent isolation**, **session switch**
- Auto-**retry** failed requests, support **stop generation**, **retry on error**

Framework-agnostic: Vue is bundled into the SDK; the host page needs no Vue. OpenAI-compatible (default DeepSeek).

## 2. Install

**Option 1: npm** (recommended for modular projects)

```bash
npm install page-agent-sdk
# also install peer deps
npm install zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
```

**Option 2: CDN · ESM** (esm.sh auto-resolves peers, small)

```html
<script type="module">
  import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'
</script>
```

**Option 3: CDN · IIFE** (one-line, zero-config, all deps bundled — for no-build setups)

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
</script>
```

**Import only what you need (subpath exports)**: besides the top-level `page-agent-sdk`, four subpath entries scope your import to a single capability:

| subpath | key exports | use case |
|---|---|---|
| `page-agent-sdk/storage` | `createSessionStore` / `createMemoryBackend` / `createWebStorageBackend` / `isQuotaError` | persistence layer only, no Agent |
| `page-agent-sdk/query` | `jpEval` / `searchJson` / `runSandboxedScript` + all jsonUtils / schemaUtils pure fns | JSON query / sandbox / path helpers |
| `page-agent-sdk/llm` | `createProxyLlm` + `ProxyLlmMode` / `ProxyLlmOptions` | proxy connection to avoid leaking apiKey |
| `page-agent-sdk/headless` | `createChatSdk` + full core API (`createChatContext`/`useChat`, etc.), **without** ChatDialog/marked/highlight.js/dompurify | `ui:false` custom UI, leaner bundle |

```js
import { createSessionStore, createMemoryBackend } from 'page-agent-sdk/storage'
import { getByPath, setByPath, hashValue } from 'page-agent-sdk/query' // jsonUtils pure fns
```

> `storage` / `query` / `llm` resolve to the same dist + types (clear semantics and per-entry CDN fetch); when a multi-entry build lands, your import paths won't change.

**🎯 headless lean subpath (separate build)**: `page-agent-sdk/headless` is a **separately-built lean bundle** (`dist/page-agent-sdk.headless.js`, ESM ~325KB / gzip ~106KB vs main ESM ~789KB) for `ui: false` integrators building their own dialog — it drops UI-layer deps you never use at runtime (marked/highlight.js/dompurify/ChatDialog subtree). The public signature is identical to the main package (`createChatSdk(options): ChatSdk`); only the `import` source changes:

```js
// main package (includes built-in ChatDialog UI)
import { createChatSdk } from 'page-agent-sdk'

// headless subpath (pure core, no UI; for ui:false custom UI)
import { createChatSdk } from 'page-agent-sdk/headless'
```

> An sdk created via the headless entry, when `ui:false` is not set (default `'default'`), will `console.warn` on `mount()` about degrading to headless (no DOM rendered). Explicit `ui:false` is the normal headless mode (no warn). If you need the built-in ChatDialog, use the main `page-agent-sdk`.

**🧓 legacy subpath (webpack ≤4 hosts)**: `page-agent-sdk/legacy` is an **es2017 + fully-bundled** artifact (`dist/page-agent-sdk.legacy.js`, ~2.9MB, lazy-loaded via `await import()` so it never enters your first-screen bundle) for hosts on webpack 4 / vue-cli 2-3 era toolchains — old parsers (acorn 6) fail on the main bundle's `?.`/`??` syntax, and the peerDeps (zod/@langchain) are all modern ESM, so a plain `import 'page-agent-sdk'` doesn't work there. The legacy channel:

```js
// webpack4 host: dynamic import (auto-split into a standalone lazy chunk; vue/zod/@langchain all inlined — zero transpileDependencies, zero peer installs)
const { createChatSdk, z, defineTool } = await import('page-agent-sdk/legacy')
// CSS resolves via the package-root physical path (webpack4's enhanced-resolve predates the exports map)
import 'page-agent-sdk/style.css'
```

Three-channel decision: **modern bundler (Vite/webpack5+) → main ESM** / **webpack≤4 → legacy dynamic import** / **no build step (plain html) → IIFE `<script>`** (artifact table in the README). The SDK's built-in Vue 3 runs as an isolated app instance (fully bundled) — it never enters the host's module graph, so it coexists fine with a Vue 2 host.

## 3. Quick start (3 min)

Minimal example — let the Agent read/write `window.app`:

```ts
import { createChatSdk, z } from 'page-agent-sdk'

// 1. your page state (any structure; reactive/plain object both work)
const app = { title: 'Hello', theme: 'light' }
window.app = app  // optional: mount to window for your page to read; SDK tools operate on `bind` directly

// 2. mount the Agent
createChatSdk({
  container: '#agent',                    // mount point (selector or DOM element)
  id: 'my-app',                           // stable id (resume chat after refresh)
  storage: 'indexed',                     // 3.9+ defaults to 'memory' (in-memory sessions, nothing on disk); 'indexed' persists across refreshes; false disables
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  systemPrompt: 'You are a page assistant. You may read/write the main data title / theme.',
  data: {
    schema: z.object({
      title: z.string().describe('Page title'),
      theme: z.enum(['light', 'dark']).describe('Theme'),
    }),
    bind: app,                            // direct-bind object (tools read/write bind, reactive refresh)
    description: 'App config',           // optional: auto-generated if omitted
  },
}).mount()
```

Open the page, type "change theme to dark" in the dialog → Agent calls `write({ value:{ theme:'dark' }, patch:{ op:'merge' } })` to change `app.theme` directly. Done.

## 4. Core concepts

| Concept | Description |
|---|---|
| **Agent** | ReAct loop: think → call tool → observe → think again, until final reply |
| **data** | You declare "which main data object the Agent may read/write + value schema". Agent can only write schema-valid values (scope + validation) |
| **tool** | The Agent's hands. Built-in window/vfs/fetch tools + ones you add via `defineTool` |
| **middleware** | Hooks into the Agent lifecycle. Built-in todos/skills/vfs/summarization/memory/permissions/verify; also custom |
| **storage** | Persist dialog/workspace/todos/memory (IndexedDB etc.), resumable after refresh |

**Mental model**: you only handle ① declare `data` (what the Agent can touch) ② write `systemPrompt` (what the Agent should do) ③ optionally add `tools`/`skills`/`middleware`. The rest is up to the Agent.

## 5. Options reference

```ts
createChatSdk({
  // basics
  container: '#root',              // mount point (selector or HTMLElement); required when ui:true
  ui: true,                        // false = headless (build UI with agent.messages + send/stream)
  id: 'my-agent',                  // stable id (multi-agent isolation + persistence resume)
  llm: { apiKey, baseUrl, model, temperature?, maxTokens? },  // or a LangChain BaseChatModel instance
  systemPrompt: '...',             // Agent identity + business flow (optional: built-in default — JSON operation assistant + reliableWriteRules — used if omitted; passing your own fully overrides it. appendReliableWriteRules defaults to true: auto-appends reliableWriteRules with a '---' separator; set false to disable)
  // ⚠️ Tool usage (read/write/get/set/patch/snapshot etc.) is auto-injected by the usageHints middleware per capability flags — do NOT declare it here; systemPrompt should only carry "business knowledge": identity, field meanings, business flow, skill refs

  // page data
  data: { schema, bind, description? },  // single main object: bind directly connects reactive/plain object (tools read/write bind, not auto-mounted to window); schema field .describe() auto-injected into systemPrompt「operable data」section
  tools: [...],                    // custom tools (defineTool)
  skills: [...],                   // custom skills (defineSkill)
  memory: '...',                   // AGENTS.md-style persistent directives
  actions: { name: { description, run, params? } },  // host actions (2.18+): SDK wraps each as a named tool (save_draft/publish…); see §6
  schemaHint: { maxKeys?, maxChars? },               // large-schema tiered disclosure thresholds (2.18+; default 15/4000); see §6
  images: { upload?, describe?, describeTimeoutMs? }, // image input (see 6.17): upload swaps the compressed original for an https URL (integrator OSS; falls back to inline on failure); describe binds a captioning capability (per-image text injection when the main model has no vision; the image itself is never sent)

  // capability toggles (default all on; verify default off)
  capabilities: { planning?, dataOps?, fetch?, skills?, vfs?, summarization?, memory?, subagent?, verify?, domInspect?, inspectEnv?, draftWrite?, workingMemory? },  // domInspect (get_dom, 2.18+) default off; inspectEnv (inspect_env, reads window/env, 2.18+) default on; draftWrite (draft_write/draft_commit chunked build, 2.19+) default off opt-in; workingMemory default on

  // human-in-the-loop
  humanConfirm: true,               // proactive inquiry (default on; AI asks when uncertain/multi-plan)
  approval: { tools: ['write'] },  // passive confirm whitelist (default off)
  checkpoint: true,                 // session-level rollback (default off)

  // self-verify (auto-enabled when check/maxAttempts/adversarial provided; capabilities.verify:false to force off)
  verify: { check?, maxAttempts?, adversarial? },  // check omitted → createWriteBackCheck

  // subagents
  subagent: { allowedTools?, systemPrompt?, temperature?, llm?, maxDepth?, maxParallel?, timeoutMs? },
  subagents: [{ id, description, ... }],  // pre-declared → generates use_<id> tool

  // context
  contextPreset: 'auto',           // auto / conservative / aggressive / complex (2.16.0+)
  contextOptions: { ... },         // fine params (false disables compression)
  summaryLlm: { ... },             // summary-dedicated LLM (defaults to main llm)
  // (2.33+) agent-driven compression (opt-in): enable + summaryLlm available → per-turn shouldTriggerCompression gate → decide (inspect_context tool loop) → compress with decision; failure degrades to static
  capabilities: { agentCompression: true },  // requires summarization; decisionTimeoutMs (default 6s) / decisionMaxTokens (default 2048) configurable
  maxMemoryRounds: 30,             // dialog history memory cap (0 disables trim)
  staleReadInvalidation: true,     // write-driven stale read invalidation (3.42+, default on): old read/query/search results hit by a later successful write are replaced with a placeholder within the invoke window; false disables for main+subagent
  vfs: { maxBytes: 8*1024*1024, poolBytes? },  // workspace cap (default 8MB; 2.16.0+ three pools: large_results/drafts/userFiles, each its own LRU)

  // persistence
  storage: 'indexed',              // 'indexed'|'session'|'local'|'memory'|config|false (default off)
  session: { id?, autoResume?, title? },
  shareContext: false,             // same id instances share one agent; core-level serial gate — cross-instance send/switchSession serialized, lifecycle convergence (unmount/switch/reset) aborts ALL in-flight streams of the shared core (2.41.0+)

  // robustness
  maxRetries: 2,                   // model call retries (network/429/5xx)
  maxParallelTools: 1,              // per-round tool concurrency
  maxToolRounds: 30,               // max tool rounds (default 30 since 3.43 — 3.28 raised 10→15, real-world complex page builds still hit it; counts only real tool rounds — format/verify self-correction doesn't consume; maxIterations total-iteration hard cap prevents self-correction loops)

  // external tools
  mcp: [{ transport: 'http'|'sse'|'websocket', url, name? }],

  // custom middleware (appended to built-in stack)
  middleware: [...],

  // UI/debug
  streaming: true, dialog: {
    title: '...', placeholder: '...',
    theme: 'dark',              // built-in theme: 'dark' (default) / 'light'; fully customizable via --cs-* on an ancestor
    icons: {                    // icon customization (partial; unset keys keep default emojis, empty string hides)
      header: '🦈',             // header title icon (default 🤖)
      subagent: '⚡',           // subagent delegation badge (default 🤖)
      empty: '🪐',              // empty-state icon (default 💬)
      focus: '📍',              // focus chip (default 🎯)
      assistantAvatar: '🛰️',    // assistant avatar (default = built-in SVG; emoji/char replaces it)
      userAvatar: '🙋',         // user avatar (default = built-in SVG)
      // values also accept HTML fragments (starting with '<', e.g. inline svg/img — sanitized via a
      // DOMPurify icon allowlist; event attributes/dangerous protocols stripped, no script injection):
      // queued: '<svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>',
      // others: subagentProgress 🧬 / queued 📋 / queuedEdit ✏️ / recommend 💡 / conflict ⚠️
    },
  },
  i18n: {                        // top-level i18n group (3.22+; see 6.15): locale switch + per-key overrides
    locale: 'en-US',
    messages: { statusDone: '<b style="color:#10b981">Done ✓</b>' },  // rich-text render spots accept inline HTML (sanitized)
  }, debug: false,
}).mount()
```

> For the complete option table with every field's type/default, see the [Chinese guide §5](./usage-guide.md#5-配置项参考).

## 6. Capabilities

### 6.1 data ops (single main object — let the Agent edit your JSON)

Declare `data`; the Agent reads/writes via tools, validated by schema (path-scoped: only the written subtree is validated — a single write is never blocked by legacy dirty data on sibling nodes; whole-object `set` only validates top-level keys present in `value` (merge semantics, absent keys preserved); cross-node refinements are not enforced at write time — use `capabilities.verify` for global checks):

- **`read`** / **`write`** (2.2+, recommended): high-level entry points merging list/describe/get and set/edit/delete + auto optimistic lock + auto snapshot — lowest LLM cognitive load (low-level CRUD `get_data`/`set_data`/`edit_data`/`delete_data` was removed in 4.0 — `read`/`write` cover everything)
- `describe_data` (main-data description + format hints)
- `restore_data` / `history_data` (snapshot rollback / snapshot list & values)
- `query_data` (JSONPath; 4.6+ multi-filter batch via `queries` array of 2-10 expressions in one call, single failure does not fail the batch) / `search_data` (fuzzy) / `eval_script` (sandboxed)

Key points:
- **Subtree summary & punch-through channels (4.0+)**: on the main-agent side, read/query automatically reduces subtrees whose effective serialized size ≥ ~3KB to a `<subtree NKB keys:[k1,…] #fingerprint>` placeholder (arrays show `children:N`; the tagged-field form `<code Nkb>` remains) — key names and size are visible, **content is not**. Three punch-through channels (none require subagents): ① **narrow read** `read({jsonPath:"<subtree path>"})` (result-root exemption returns full text); ② **focus full text** — after `set_focus`, reads inside the focused subtree (including nested large subtrees) are full; ③ **subagent scope** (delegated subagents read full). query returns placeholder+path for big hit values (pin the path, narrow-read); search is not summarized. **read-before-write guard (auto-assembled)**: a write path falling inside a placeholder subtree with no narrow read this invoke → re-injects a `NEED_NARROW_READ` narrow-read instruction (ask-first, writable one round later; dryRun / already-read / already-written / not-in-summary-surface always pass; each subtree is blocked at most once to prevent loops; whole-set writes are not blocked). **Placeholder-leak value guard**: a write whose *value* contains a placeholder string (`<subtree …>` substring / `<fieldName Nkb>` whole-string) is rejected with `PLACEHOLDER_LEAK` and directed to narrow-read first (prevents pasting placeholder text into bind as dirty data; dryRun previews also surface it; verbatim handles `⟦res:…⟧` have a different prefix and are unaffected; the check only inspects the raw value submitted by the LLM — protected-field values backfilled by enforceSet are not scanned, so legitimately stored placeholder-looking text in your bind never blocks whole-set writes; to intentionally store such text use the integrator-side `importData` (no override on the agent write channel — the win of never letting the LLM treat placeholders as real values outweighs the rare false positive); note the whole-string rule accepts any `[A-Za-z_]`-leading field name (a literal `<div 3KB>` whole string is also blocked; substrings inside mixed HTML content are not). Also note the read-side placeholder/guard surface does not cover query/search/eval — those three channels return real values even for freeze/verbatim-protected fields (write-side enforcement remains; the "exact values never enter the LLM message stream" promise is weakened on these channels by design). Lightweight data (everywhere below the threshold) is unchanged; **declared behavior**: main-scope data at/above the threshold changes read/query output to placeholders (threshold constant `SUBTREE_SUMMARY_THRESHOLD`, calibrated against real-LLM data per release, only raised).
- **Section orchestration & under-delegation nudge (4.0+, auto-assembled, zero config)**: ① **under-delegation nudge** — cumulative writes touching ≥12 components within one task with zero delegation → a one-time hint is appended to the next successful write result (teaches "multiple spawn_agent each with writablePaths in parallel" + the fallback clause "if the same delegation fails twice, do it yourself — solo is an equally first-class path"; advisory, non-blocking, LLM decides); ② **orchestration-segment dynamic injection** — when the total element count of top-level object arrays ≥12, a three-step responsibility (plan → delegate in sections → verify & wrap up) plus the four-element section spec (jsonPath range / change goal / shared tokens / acceptance criteria) is injected into the system prompt each round; small data gets zero injection (zero tax), and it follows `setData` automatically; ③ the 70% round-budget reminder teaches the "parallel sectioned delegation" pattern when delegation tools exist. **Declared weakness (pure-JSON delegation)**: `spawn_*` does not go through the component lock (the lock only covers the codeAsset use_<id> path); disjoint sections are guaranteed by your orchestration plan, and cross-section write conflicts are backstopped by the optimistic lock (per-scope baselines); `spawn_agents` tasks carry no write authorization — parallel **write** delegation must go through individual spawn_agent calls each with writablePaths.
- `write` (all four intents: value/patch/patches/del) is restricted to schema-declared fields (whitelist for ZodObject); every write validates against schema — invalid → structured error (no write)
- `write({patch})` patches by `jsonPath` (set/remove/merge/append/move (move: value = target path string; same array = reorder, cross-array = relocate)) — avoids re-sending the whole large JSON; writes in-place without replacing the root ref → Vue-reactive compatible
- Snapshots auto-stored before every `write`; `restore_data` rolls back
- **No `window` dependency**: `data.bind` is any reactive/plain object tools read/write directly; only `eval_script` needs Web Worker (browser)

#### High-level `read`/`write` (2.2+, recommended)

```ts
// read: no jsonPath → list main data + description; with jsonPath → current value + hash
// Agent: read({}) → "Main data: ... (hash=a1b2)"
// Agent: read({ jsonPath: 'title' }) → 'title = "Home" (hash=a1b2)'

// write: three intents
// ① full set (value is a JSON object, no stringify needed)
write({ path: 'page.title', value: 'New title' })
// ② incremental patch (op=set/remove/merge/append, jsonPath relative to slot root; append targets an array → push elements, or a string → concat text [4.1+ chunked code write: set the first chunk, then append the rest — each tool call carries only a small piece, immune to the max_tokens cap])
write({ path: 'page', value: 'c', patch: { op: 'append', jsonPath: 'items' } })
write({ path: 'page', value: { title: 'Merged title' }, patch: { op: 'merge' } })
// ③ delete
write({ path: 'page.oldField', del: true })
```

`write` auto: ① schema validation (no write on failure) ② snapshot (rollback via `restore_data`) ③ optimistic lock (opt-in since 3.32: `conflictWatchFields` whitelist or `['*']` whole-field; conflict → `VERSION_CONFLICT` or human escalation).

#### Tool surface: always fully exposed (14 tools; `toolMode` removed in 3.31)

Data tools are always fully exposed: high-level `read`/`write` (recommended entry, auto optimistic lock + auto snapshot), query/search/sandbox (`query_data`/`search_data`/`eval_script`), snapshot rollback (`restore_data`/`history_data`), low-level CRUD (`get/set/edit/delete/describe_data`, manual hash lock), `schema_data`/`diff_data`, focus tools (`set/add/remove/clear_focus`), plus `draft_*`/`resource_*` when their opt-in capabilities are on. usageHints runtime prompts adapt by **capability flags** (no tier concept).

To constrain LLM behavior, steer via `systemPrompt` (e.g. "prefer read/write"), or use `capabilities` toggles to control what loads at all.

> ⚠️ Migration: remove the `toolMode: ...` option key from existing integrations (TS type error; ignored at runtime). Legacy systemPrompts phrased for "simple mode / not exposed / do not call" are detected and warn — clean up that wording too.

#### Schema as whitelist (only declared fields exposed)

When `data.schema` is a `z.object(...)` (or its optional/default/lazy wrapper), the SDK auto-enables **whitelist mode**: only schema-declared fields are exposed to the LLM; undeclared fields are invisible and non-readable/writable. This fits the "bind is a large JSON but only some fields should be agent-operable" scenario — declare operable fields in schema, the rest (internal state, sensitive data, redundant caches) are auto-hidden, no extra config needed.

- **Read**: `read` whole-object is projected by top-level schema; **sub-path reads are also recursively projected by the sub-schema at that location** (e.g. `read components.0` is projected by the element schema of `components`, hiding undeclared sub-fields). Reading an undeclared (sub)path returns `PATH_DENIED`.
- **Write**: `set`/`write(set)` whole-object uses **merge semantics** — only schema-declared fields are updated, un-passed fields are preserved (anti-accidental-delete); `edit`/`write(patch)` sub-path increments are path-segment-checked against schema declarations.

> Note: whitelist mode only enables for `z.object`; `z.any()`/`z.record()`/`z.discriminatedUnion()` etc. non-object schemas don't enable it (fully open, backward-compatible). A `passthrough()` object still enables whitelist (only declared fields are visible to LLM; extra fields are persisted on write but hidden on read) — if you want extra fields visible to LLM, declare them in schema explicitly.

#### `data` single main-object config (recommended, declarative)

`data` is the single entry for data config — combining schema declaration + object direct-bind + auto field-hint injection:

```ts
import { reactive } from 'vue'  // or any reactivity impl
const PageSchema = z.object({
  title: z.string().describe('page title'),
  count: z.number().describe('count'),
})
const page = reactive({ title: 'Home', count: 0 })

const sdk = createChatSdk({
  // ...,
  data: {
    schema: PageSchema,       // zod schema: write validation + field .describe() auto-injected into systemPrompt「operable data」section
    bind: page,               // required: reactive/plain object direct-bind (tools read/write bind directly)
    description: 'Page config', // optional: auto-generated if omitted
  },
})
// LLM write page → page reactively updates; integrator changes page → LLM read sees it
```

- `bind` is required: direct-bind a reactive/plain object (tools read/write bind, reactive refresh); SDK no longer auto-mounts to window — integrator mounts `window.app = app` themselves if the page needs to read it
- `schema` field `.describe()` is auto-extracted (via `extractSchemaHint`) into the systemPrompt「operable data」section — no manual description needed
- Preview the hint to be injected: `extractSchemaHint(schema)` (exported)
- **Protected resources (precise-value protection, opt-in)**: declare `data.resources: [{ path, mode }]` for fields needing exact preservation (ids / hashes / tokens / long verbatim). `freeze` = read-only (value hidden from LLM via `⟦frozen:path⟧` placeholder; write → `FROZEN_FIELD`); `verbatim` = preserved verbatim (`⟦res:handle⟧` placeholder, original in resource pool; modify via `resource_update` first else `VERBATIM_MISMATCH`). Write-side enforcement runs in `commitSetToBind`/`applyPatchesToBind`/eval (before schema); `bind` always holds the raw value (placeholders only at read/write boundaries → hash/snapshot/lock unaffected). **Whole-container clears**: a replacement that deletes a protected field along with its container (e.g. `set components=[]`) is explicitly rejected (`FROZEN_FIELD`, with actionable exits: keep the element containing the protected field / `remove` the others one by one); under merge semantics, unmentioned top-level keys are still preserved from bind (no fabricated backfill). `resource_delete`/`resource_list` return targeted guidance for static `freeze` configs (freeze has no handle and cannot be released; the integrator must adjust `data.resources`). opt-in (needs `data.resources` + `capabilities.vfs`): exposes `resource_get`/`update`/`list`/`delete` tools (advanced) + cross-compression pin + SDK API `createResource`/`getResource`/`updateResource`/`deleteResource`/`listResources`/`releaseResources`. See `skills/precise-value-protection`.
  ```ts
  data: { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }] }
  ```
- **`bind` does NOT require reactive**: any object works. The difference is "reactive refresh after write":
  - Pass `reactive(obj)` (Vue): Agent `write` mutates props → template/watch auto-reactive (recommended for UI)
  - Pass a plain object: Agent `write` can mutate data, but the page won't react (suitable for headless / backend / integrator-managed refresh via `onEvent` or `watch`)
  - Tools `set`/`write` use `restoreInPlace` to mutate props in-place (no root-ref replacement), compatible with reactive proxies; plain objects also write fine
- **Notifying the outside world of changes** (see §onEvent for details):
  - `onEvent` / `sdk.hook` subscribe to `data_change` event (fires after write, with `operation`/`value`) — for headless / non-Vue / plain-object bind
  - Vue reactivity (bind with reactive) — template/watch auto-react, no manual notify needed
  - `onEvent` and reactivity can coexist: reactivity for UI refresh, `onEvent` for audit/analytics/cross-system sync
- **Runtime swap**: `sdk.setData(config)` / `sdk.getData()` (replaces old add/remove/listDataSlots)
- **Runtime skill swap**: `sdk.setSkills(skills)` (same-name skill overwrites; clears the skill full-text cache, the skill index section of the system prompt re-renders next round, and the next `load_skill` re-fetches the latest full text incl. vfs doc) / `sdk.invalidateSkillCache(name?)` (proactively invalidate the cache when a dynamic skill's content changes; omit `name` to clear all, pass `name` to clear one)
- **User-created skills (runtime + independent persistence)**: `sdk.addSkill(skill)` (users create/edit/delete custom skills from within the chat UI; auto-added to the agent, persisted via **independent SkillStore** — default indexedDB, separate from the `storage` option, persists even when `storage: false`, auto-restored across refreshes; same-name overwrites) / `sdk.removeSkill(name)` (only removes user-created skills, not the integrator's initialSkills passed via the `skills` option) / `sdk.listUserSkills()` (list user-created skill names, for UI panel refresh) / `sdk.getUserSkill(name)` (read a user-created skill's detail, for SkillPanel editing). The built-in `ChatDialog` has a "Skill Management" button in its header that opens the `SkillPanel` component, supporting create/edit (click a skill to load into the form)/delete; integrators can also `import { SkillPanel } from 'page-agent-sdk'` for custom UIs. Requires `capabilities.skills` (default on). **Cross-page/cross-agent reuse**: manually specify `skillStorage: { id: 'shared-skills' }`, multiple `createChatSdk` instances (different agentIds) with the same id share the same set of user skills; omit `id` for per-agent isolation (`agent::{agentId}`). `skillStorage: false` disables persistence (current session only).

#### Optimistic lock (prevent stale-overwrite) & conflict human-in-the-loop

When the main data may be modified concurrently by **external code / other agents / manual user edits**, enable optimistic locking: declare `conflictWatchFields` (whitelist or `['*']`); `read` appends `hash=xxx` (hash of the whole bound object) as the lock token, and writes auto-verify once declared.

```ts
// Agent workflow (run by the LLM automatically; integrator writes nothing)
// 1. read({ jsonPath:'title' }) → "main data @ title = old (hash=a1b2)"
// 2. write({ value:'new', patch:{ op:'set', jsonPath:'title' } })  // auto-locks with last read hash (whole-object)
//    if any field externally modified since → whole-object hash mismatch → conflict
```

**On conflict (human-in-the-loop enabled by default):** the tool suspends, `sdk.pendingConflict` ref is set, and the built-in ChatDialog shows a conflict bar with three choices:

| Option | Behavior | Result |
|--------|----------|--------|
| **Keep external** | Don't write, keep the externally-modified value | Agent re-gets and retries |
| **Overwrite** | Execute the agent's write | Overrides external change |
| **Restore** | Roll back to snapshot stack top (historical checkpoint) | Undo external change + agent doesn't write |

```ts
const sdk = createChatSdk({ /* ... */ })
await sdk.mount()

// Built-in UI handles the conflict bar automatically; for headless custom UI:
import { watch } from 'vue'
watch(sdk.pendingConflict, (c) => {
  if (!c) return
  // c: { id, path, op, agentValue, currentValue, currentHash, expectedHash, snapshotId }
  showConflictDialog(c, (action) => sdk.resolveConflict(action)) // 'keep_external'|'overwrite'|'restore'
})

// or via event subscription
sdk.hook((e) => {
  if (e.type === 'conflict') showConflictDialog(e.conflict, (a) => sdk.resolveConflict(a))
})
```

**Auto-resolution (prevent permanent hang):** on user stop (abort) / `unmount()` / `switchSession()`, a pending conflict is auto-resolved as "keep external".

**Automatic adjudication policy (`conflictPolicy`, 3.29+):** when the host and the agent contend over the same data and the integrator declares "the agent's writes win" (typical: an editor host with watchers/sync layers writing back to `bind` — between two consecutive agent writes the host mutates `bind`, so the second write conflicts; in unattended scenarios nobody clicks the conflict bar → the flow hangs forever), declare a policy to skip human intervention:

| Policy | Behavior |
|--------|----------|
| `'ask'` (default) | Suspend and wait for manual `resolveConflict` (existing behavior) |
| `'overwrite'` | **Agent force-overwrite**: on conflict the agent's write lands directly; no suspension, no human needed |
| `'keep_external'` | Auto-keep external changes: on conflict the write is dropped and the agent is told to re-read and retry |

```ts
createChatSdk({ /* ... */ conflictPolicy: 'overwrite' })
```

Auto-adjudication never sets `pendingConflict`, but the `conflict` event is still emitted (`e.conflict.autoResolved` marks the adjudicated action), so integrators can observe/audit via `onEvent`/`hook`.

> **Baseline guard (3.29+)**: if a custom tool registered via `defineTool` mutates `bind` directly inside its body (e.g. a structural tool that replaces the whole component tree), the SDK **automatically recomputes the optimistic-lock baselines** after that tool call, so the agent's next normal `write` is not falsely flagged as "externally modified" (self-conflict). Mutations **outside** the tool window (host watchers / direct user edits) still trigger a conflict by design — that is the optimistic lock's job; adjudicate via `conflictPolicy`.

> Without `conflictWatchFields` → direct write (no auto check). Using `createDataOps(props, { onConflict })` standalone (without ChatDialog), handle conflicts yourself (return `Promise<{action}>`).

#### Optimistic lock under concurrent tools (`maxParallelTools > 1`)

**Since 3.32, automatic detection is OFF by default** (opt-in flip: hosts commonly mutate metadata outside the SDK write path, making whole-field detection misfire constantly). Three ways to enable: ① `conflictWatchFields: ['style','props',...]` (whitelist of field names at any depth, **position-insensitive** — index shifts from component add/remove don't misfire; only value changes on watched fields trigger conflicts) ② `conflictWatchFields: ['*']` restores legacy whole-field detection. When enabled, `write` reuses **the whole/watched hash from the LLM's most recent `read`** (internal baseline, caller-scoped since 2.40) for snapshot comparison. In a serial single-tool flow this is equivalent to "write based on the value I just read".

**Under concurrent tools, `autoLock` degrades to "whole-snapshot semantics".** When `maxParallelTools > 1`, multiple `read`s in the same round **concurrently write the same baseline (main scope)** with nondeterministic completion order, and a subsequent `write` compares against "**the whole hash of whichever `read` finished last**" — "is this write using the hash from *my own* read?" is **not reproducible** across tools. This doesn't break the safety boundary (it's still whole-snapshot validation; conflicts are still caught), but you lose the "each write corresponds precisely to its own read" semantics. (Consecutive *writes* in the same scope are unaffected: each successful write refreshes the baseline, so an agent's own consecutive writes never conflict with each other.)

**Concurrent write interlock (4.1+, automatic):** when `maxParallelTools > 1` AND `conflictWatchFields` is declared, the SDK automatically enables a dataOps-closure-level write mutex (a single lock covering every write tool's `[take baseline → conflict check → commit → refresh baseline]` section) — same-round parallel writes no longer "both pass a stale baseline while the later one silently clobbers the earlier"; instead the later write sees the post-commit baseline inside the lock: disjoint parallel writes both land normally; under a stale-baseline conflict, the write that gets adjudicated first lands, and a later write based on state the adjudicator never saw is **explicitly rejected with a single-shot `VERSION_CONFLICT`** (re-read and retry — no second hang). The lock is auto-released while a conflict ask is pending (sibling writes are not blocked by the human wait) and re-acquired with a one-shot freshness recheck after the ruling; `overwrite` rulings absorb the baseline and `restore` rulings refresh it (writes right after a ruling no longer mis-conflict). Serial mode (default 1) and parallel mode without `conflictWatchFields` are **zero-behavior-change** ("last write wins" remains the documented semantics for unarmed parallel). **Known boundary:** intent-level staleness of same-path parallel writes (two writes from one stale read each setting `count=1`, final value 1) matches serial semantics — the interlock serializes the mechanism, not information; for read-modify-write loops have the model `read` first, or pass `expectedHash` explicitly.

**Under concurrency the `conflictWatchFields` baseline provides whole-snapshot protection** (per-scope, caller-isolated):

```ts
// Agent workflow (concurrent scenario, run by the LLM automatically)
// 1. read({ jsonPath:'title' }) → "main data @ title = old (hash=a1b2)"   ← remember this hash
// 2. write({ patch:{ op:'set', jsonPath:'title', value:'new' }, expectedHash:'a1b2' })
//    precisely compares the hash from the LLM's own read, bypassing the shared-lastReadHash race
```

`conflictWatchFields` is the single basis for whether a write is verified; `conflictPolicy` decides how a real conflict is adjudicated.

> **Hash algorithm**: from 2.16+, `hashValue` is upgraded to **cyrb53 (53-bit)**, replacing the old djb2 (32-bit) to significantly reduce collisions. Just take the `hash` field from `read` return values — integrators never compute it themselves.

### Automation loop & scale: `get_dom` / `actions` / `schemaHint` / `workingMemory` (2.18+)

Four complementary capabilities that together yield a "competent automation agent": change data → see the rendered DOM → trigger host-page actions — and stay controllable under large schemas / frequent compression.

#### DOM reading `get_dom` (see the rendered page)

Let the agent read the **rendered** DOM structure (unlike `read`, which reads the data JSON). Use cases: verify rendering after a data change, locate elements, confirm styles landed, assist with UI/design questions. `capabilities.domInspect` defaults to **off** (reading DOM costs tokens; opt in as needed).

Since 3.24 enabling it also provides a **DOM inspection toolset** (lazy-injected via the built-in `dom-inspect` skill — before `load_skill("dom-inspect")` it only occupies one index line, not standing tool-schema context; falls back to direct injection when the skills capability is off):

- `dom_search({ query, mode, limit?, root? })`: find elements — `mode:"selector"` (CSS selector) or `mode:"text"` (keyword in visible text); returns CSS path + text snippet per hit (≤20, total noted when truncated)
- `dom_info({ selector, styles?, includeHtml?, pseudo?, ... })`: full info for one element — content (direct/all text/HTML snippet) + **computed styles** (defaults to a ~30-prop debugging preset, or your own list) + viewport rect + **event bindings from three sources** (inline `on*` attributes / Vue vnode props / an addEventListener recorder; ⚠ the recorder only covers listeners registered after the SDK loaded — prefer inline + Vue props for earlier mounts)
- Debugging loop: `dom_search` (text mode, find by button copy) → `dom_info` (styles: display/pointer-events/background) → fix the data → `get_dom` to cross-check structure

```ts
createChatSdk({
  capabilities: { domInspect: true },  // opt-in, default off
  // ...
}).mount()
```

The agent calls `get_dom({ selector?, depth?, attrs?, includeText? })`:

- `selector`: CSS selector (default `body`, whole page)
- `depth`: traversal depth (default `3`, caps DOM token blowup; `0` = root only, max 10)
- `attrs`: attribute whitelist. **Omitted** = default common (`id/class/href/src/alt/title/style/role/aria-label/name/type/value`) + all `data-*`; **provided** = strict whitelist (no `data-*`, only what you list)
- `includeText`: include direct text (default `true`)

Returns structured JSON (`{tag, attrs, text, children[], childCount?}`); truncated depth reports `childCount` without expanding. Large results auto-offload to vfs. Unlike `eval_script` (free sandbox script returning text): `get_dom` is read-only + structured + attribute-whitelisted (no script execution, no sensitive attr leak).

```jsonc
// agent calls get_dom({ selector: '.navbar', depth: 2 }) →
{
  "tag": "nav", "attrs": { "class": "navbar" },
  "children": [
    { "tag": "span", "attrs": { "class": "navbar-title" }, "text": "My Page" }
  ]
}
```

> To inject manually (bypass capabilities): `import { domTools } from 'page-agent-sdk'` and spread into tools. The pure function `domToStructure(node, opts)` is exported and unit-testable without a browser.

#### Environment probe `inspect_env` (debugging, default on)

Lets the agent read the host page's **environment info** (URL / browser / viewport / integrator debug vars) to troubleshoot "where am I / what browser / viewport size / debug var value / why didn't it take effect". `capabilities.inspectEnv` defaults to **on** (lightweight read-only, essential for debugging); `false` to disable.

```ts
createChatSdk({
  capabilities: { inspectEnv: true },  // default on; false to disable
  // ...
}).mount()
```

The agent calls `inspect_env({ key? })`:

- **Without `key`**: returns an environment summary (`location` URL/origin/path, `navigator` browser/language/online, `viewport` size/DPR/scroll, `document` title/readyState)
- **With `key`**: reads a specific `window[key]` (integrator-mounted debug var, e.g. `inspect_env({key:"appConfig"})` reads `window.appConfig`)

`safeSerialize` skips functions/DOM/circular refs + caps depth/key-count/length to avoid blowups. Large results auto-offload to vfs. Unlike `get_dom` (reads DOM structure, deep traversal, opt-in): `inspect_env` is a lightweight environment summary, **on by default**, non-mutating.

> Manual inject: `import { inspectTools } from 'page-agent-sdk'`. Pure functions `safeSerialize`/`getEnvSummary` are exported and unit-testable without a browser.

#### Chunked write `draft_write` / `draft_commit` (huge JSON, default off)

Huge JSON (e.g. 50+ component pages) approaching LLM `max_tokens` won't fit in a single `write({value})`. Build it in chunks via draft: `capabilities.draftWrite` defaults to **off** (opt-in; needs dataOps + vfs).

```ts
createChatSdk({
  capabilities: { draftWrite: true, vfs: true },  // opt-in, default off
  // ...
}).mount()
```

Agent flow: `draft_write({draftId, chunk, mode})` accumulates chunks → `draft_commit({draftId})` atomically commits:

- `draft_write` mode: "start" creates/overwrites / "append" appends chunk (concat JSON fragments into the vfs drafts pool, 2MB)
- `draft_commit` reads draft → `JSON.parse` (fail → JSON_INVALID) → schema validate (fail → SCHEMA_INVALID, draft kept for fix-and-retry) → write bind + snapshot (auto-clears draft on success)

```jsonc
// agent builds a 50+ component page in chunks
draft_write({draftId:"p1", chunk:'{"components":[', mode:"start"})
draft_write({draftId:"p1", chunk:'{"type":"heading","props":{...}},', mode:"append"})
// ... more components appended ...
draft_write({draftId:"p1", chunk:']}', mode:"append"})
draft_commit({draftId:"p1"})  // merge + validate + write + clear draft
```

> Small edits still use `write` patch; draft is only for generating large JSON from scratch. `draft_commit` runs through `commitSetToBind` (shared with write(set) for validation+snapshot+optimistic-lock chain).

#### Host actions `actions` (trigger save/publish/page ops)

Register page ops; the SDK wraps each action as a **named tool** (the LLM sees `save_draft`/`publish` directly — no `trigger_action` relay). With `get_dom` this closes the loop: change data → see DOM → trigger action.

```ts
createChatSdk({
  actions: {
    save_draft: {
      description: 'Save the current page as a draft (local storage). Call after editing to persist.',
      run: (args) => {
        localStorage.setItem('draft', JSON.stringify(args))
        return { saved: true, at: Date.now() }
      },
    },
    publish: {
      description: 'Publish the page live. save_draft should precede this.',
      run: async () => { await fetch('/api/publish', { method: 'POST' }); return 'published' },
    },
    // action with params (ZodObject; the LLM passes args per schema)
    set_theme: {
      description: 'Switch theme',
      params: z.object({ theme: z.enum(['light', 'dark']) }),
      run: ({ theme }) => { document.documentElement.dataset.theme = theme; return `theme set to ${theme}` },
    },
  },
  // ...
}).mount()
```

Notes:

- `run(args)` return value is serialized back to the LLM (`undefined` → "action done"; `string` as-is; object → JSON). **Error isolation**: if `run` throws, the error string goes back to the LLM for self-correction (the agent never crashes)
- Action names must be valid identifiers (`[a-zA-Z][a-zA-Z0-9_]*`, e.g. `save_draft`); invalid names are skipped with a warn
- `inspect().actions` returns `{ [name]: { description, hasParams } }`

#### Schema tiered disclosure (`schemaHint`)

`data.schema` field `.describe()`s are auto-injected into the systemPrompt "operable data" section. A **large schema** (dozens/hundreds of fields) fully injected bloats the systemPrompt. `schemaHint` triggers **tiered disclosure**: past the threshold it switches to a "top-level overview" (key + type + one-line desc, no constraints, no recursive shape) + a footer hint "query `schema_data` for deep constraints" — saving tokens without losing discoverability; small schemas (≤ threshold) stay full (imperceptible).

```ts
createChatSdk({
  data: { schema: hugeSchema, bind: page },
  schemaHint: { maxKeys: 15, maxChars: 4000 },  // defaults; past threshold → overview mode; tune up/down
  // ...
}).mount()
```

Defaults `maxKeys: 15, maxChars: 4000`. Want full disclosure (small schema, tokens no concern): raise the thresholds; want to save more: lower them. Related exports: `extractSchemaHint` / `renderSchemaShallow` / `renderSchemaHint` / `renderSchemaOverview` / `formatConstraints` / `describeSchemaNode`.

#### Working memory `workingMemory` (keep located paths & read hashes across compression)

In long tasks with frequent context compression, the **paths** the agent located via `read`/`query_data`/`search_data` and the **hashes** from `read` results get dropped as older rounds are summarized → the agent re-searches (token waste) + writes from memory, causing spurious `autoLock` optimistic-lock conflicts. The `workingMemory` middleware (`capabilities.workingMemory`, **default on**) auto-captures these structured locations and injects a "## Working memory" section each round via `augmentPrompt` (lives in state, not messages → compression never touches it → naturally preserved across compression).

```ts
createChatSdk({
  capabilities: { workingMemory: true },  // default on, no config needed; false to disable
  // ...
}).mount()
// inspect().workingMemory → { locatedPaths: string[], lastHashes: {[path]: hash} } (each ≤10 LRU)
```

Auto-capture rules (no LLM call): `read`/`query_data`/`search_data` results → `locatedPaths` (LRU ≤10, deduped); `hash=` in `read` results → `lastHashes[path]` (LRU ≤10). Complementary to `preserveLastToolResults` (which keeps tool-result summaries so field descriptions aren't lost); orthogonal to mission (mission = goal, workingMemory = intermediate state).

#### Capability packs: specialized subagent factories (createRagSubagent / createHtmlSubagent, 2.37+)

For complex tasks, delegate to **specialized subagents** tuned for the job (independent context, process stays out of the main token budget). The two packs are **composable / splitable**, opt-in (not mounted = zero change):

```ts
import { createChatSdk, createRagSubagent, createHtmlSubagent } from 'page-agent-sdk'

const sdk = createChatSdk({
  subagents: [
    // ① RAG retrieval subagent: multi-source doc / UI-spec lookup, read-only, independent context
    createRagSubagent({
      retriever: async (q) => (await vectorDB.search(q)).map((h) => ({ content: h.text, source: h.doc })),
      loader: async (id) => fetch(`/api/docs/${id}`).then((r) => r.json()),
      // useVfs default true: subagent greps docs injected via sdk.vfsWrite
    }),
    // ② HTML code-component subagent: code as data asset (code field) + vfs working copy + auto checkout/commit
    createHtmlSubagent({ writablePaths: ['components'] }),   // writablePaths is optional (3.6+ auto-inferred from schema at assembly)
  ],
}).mount()

// Async-inject docs into vfs (RAG subagent finds them via vfs_grep)
sdk.vfsWrite('docs/components/hero.md', 'Hero component is for the above-the-fold hero...')
```

- **RAG** (retrieval): `search_docs` (semantic via retriever) / `load_doc` (async via loader) / vfs search / `fetch_document`; read-only; ships with `rag-search` skill. `retriever`/`loader` injected by the integrator (SDK has zero data-source deps — no vector-DB binding). Large retrieved docs **never pollute the main context** (only structured conclusions return).
- **`fetch_document` security note**: the URL is LLM-controlled and same-origin requests carry cookies by default (browser fetch defaults to `credentials:'same-origin'`) — fetched content is wrapped in an untrusted fence against prompt injection, but the fetch itself can reach any same-origin GET. Protect sensitive endpoints (e.g. `/api/user`) with server-side CSRF/auth checks, or disable the tool via `capabilities:{fetch:false}`.
- **HTML** (generation, 3.0 single-mode breaking): planning (`write_todos`/`update_todo`) + **code as a data asset** (`data.<writablePath>[i].code` field, persisted with the data JSON to the server DB; UI binds `data.code` directly for reactive render) + **vfs as an edit working copy** + scoped write (`writablePaths` path guard). **Framework auto checkout/commit** (main agent transparent): beforeAgent checks `data.code` out to vfs (`html/<__pgId>.html`, overwrite-refresh) → subagent edits vfs → afterAgent incrementally commits touched vfs back to `data.code` (direct bind mutation, bypassing write — no snapshot stack). `summarization` on by default (frequent code edits accumulate fast).
  - **Two paths**: ① new component → subagent `write({patch:{op:'set',jsonPath:'components.N',value:{name,code,props}}})`, code goes straight into data (framework adds `__pgId`; no vfs/checkout/commit); ② edit component → framework checkout → subagent `vfs_read`+`vfs_edit` on the working copy → framework commit.
  - **`__pgId` framework-managed**: integrator's schema doesn't declare it; read projection hides `__pg*`; agents can't write it (path guard); persisted transparently (stable across sessions/devices); vfs filename = `codeVfsPrefix+__pgId+ext`.
  - **Output form (single mode)**: generates a **complete, self-contained HTML page** (renders standalone); interaction logic defaults to `<script>` (omitted only when the user explicitly says "no script"), CSS goes in a `<style>` block, external JS/CSS allowed; transformation (extract body / wrap as component / fragment) is done by downstream plugins/tools — the html agent doesn't care about the host's render method (v-html/SFC/iframe).
  - **Output format validation** (`formatCheck`, on by default): ① `validate_code` self-check tool (the subagent calls it after each write/edit; tag balance and other structural legality, errors with line numbers) ② verify beforeReturn gate (deterministic scan of the vfs working copy before returning; failures are re-injected as feedback for self-correction, bounded by `maxVerifyAttempts:2`). The validator is a pure function `validateHtmlFormat` (exported; reusable in the integrator's render layer as defense in depth); `formatCheck:false` disables the whole chain.
  - **Render check (4.0+, rides on `formatCheck`, zero config)**: after the structural check passes, each target from **this round's touched set** (touched vfs files + write-created components) is rendered standalone in a sandboxed iframe (`srcdoc` + `sandbox="allow-scripts"`; no same-origin/forms/top-navigation), collecting ① `console.error`/`window.onerror` (with line numbers) ② `unhandledrejection` (async) ③ resource load failures (capture-phase, cross-origin-safe) ④ white-screen metric (`body.scrollHeight` < 10) — any hit re-injects as feedback (attributed to component + line); the subagent gets NO render tool (checks are not LLM-decided, no double-spending rounds). **Boundaries & residuals (explicit)**: the sandbox ≠ host environment (the verdict is "runs standalone", not "looks right"); late async errors may be missed (activity-silence heuristic + ~4s hard cap); storage-class SecurityError downgrades to observation (opaque-origin sandbox false positive); a host CSP blocking inline scripts → handshake missing → honest "check unavailable" (**NOT a pass — no false greens**; validate_code is suggested as fallback); node/headless (no DOM) auto-skips the render segment keeping the structural one (debugLogs `render_check_skip`); the fix budget **shares** the `maxVerifyAttempts:2` pool with structural self-correction (complex fix chains may exhaust it early); worst case +3-5s per check (re-checks only failed components). `createHtmlRenderCheck` / `normalizeRenderResult` / `renderInSandbox` etc. are exported for integrator-managed reuse.
  - **Main-scope read summary**: when the main agent reads data, tagged fields (`code`) are summarized to `<code Nkb>` (keeps code body out of the main context); subagent reads full text (needs it to edit); integrator's own long text fields are unaffected.
  - **`codeField` configurable (open-schema)**: code field location defaults to `'code'` (component top level); open-schema platforms can set a nested jsonPath (e.g. `'props.html_code'`). "Is a code component" = a string at that path (non-code components are skipped naturally); assembly-time hit-check warns on zero hits (prevents silent failure on a wrong path). E.g. `createHtmlSubagent({ writablePaths:['components'], codeField:'props.html_code' })`
  - **`writablePaths` auto-inferred at assembly (3.6+, optional)**: when omitted, createChatSdk scans the top level of `data.schema` for array paths whose elements contain a `codeField` string and back-fills them (`inferWritablePaths`, console.info trace; an explicit value always wins). Forms that cannot be inferred → warn + throw asking for an explicit value: open schemas (`z.any()`/`z.record`), nested containers (e.g. `sections[].children[]`), dotted-path codeField (`props.html_code` nested shape) — prefer failing over guessing a wrong path (a wrong path silently disables the whole framework scan region)
  - **Main-agent orchestration auto-injection (zero-config)**: at assembly — with an html subagent → delegation orchestration `htmlOrchestratorPrompt(id)` is auto-appended to the main systemPrompt (custom code: no read/no write, owned by `use_<id>`; delegate one-by-one; task spec with 4 essentials + ⑤ history-preference relay; **multi-option requests go text-first**: "give me a couple of options to pick" → this round only text proposals + user picks, delegation happens only after the choice, never generate all options up front); 3.9+: without an explicit one + schema has a code array → **a default `createHtmlSubagent()` is auto-registered** (info logged, no switch; forms that can't be inferred — top-level code field / open schema — get the `htmlDirectWriteFallback` direct-write mode instead); open schema (`z.any()`) can't be scanned → opt-in spread. **Do NOT manually spread `htmlPageOrchestrator`** (auto-injection already covers it; double injection wastes tokens); opt out via `orchestratorPrompt:false`
  - **Component craft notes `craftNotes` (on by default)**: the html subagent appends a `[note] <one-line essence>` line to its final reply (htmlSystemPrompt convention); the framework's afterAgent extracts and persists it to the component's `__pgNotes` (FIFO ≤5 × 200 chars, travels with the data JSON — persistent across sessions). On the next delegation to the same component, the file map injects the latest note (`📝 notes×N`) — **design intent persists across delegations** ("handoff from the previous maintainer": design decisions / user preferences / pitfalls); state lives in the data, not in the subagent instance (same philosophy as code-as-data-asset). `__pgNotes` rides the `__pg*` sidecar mechanism (hidden from agent read projection, unwritable by the agent, framework-owned); opt out via `craftNotes:false` (zero persistence, zero injection)
  - **Model advice (from real-LLM testing)**: prefer strong instruction-following models (deepseek-v4 / claude / gpt-4o) for html code generation; flash-class weak models amplify over-thinking (decoration enumeration / token dithering); for high-frequency/batch generation prefer non-flash
  - **Extra read-only tools `allowedTools` (3.45.1+)**: integrators can merge host-defined query tools (e.g. `rag_component_docs`/`list_components`) into the html subagent's tool pool — the subagent can look up component docs / page structure while writing code, so a delegated task mentioning component names no longer triggers "tool does not exist" hallucinations. Query-type tools only; write access stays governed by `writablePaths` (same name as the top-level `subagent.allowedTools` but a different surface: that one is the spawn-chain whitelist, this one is the capability-pack factory option)
  - **Own model + thinking-depth lock (output-quality-uplift)**: keep the main agent on a light model for orchestration while code generation uses a stronger one — `createHtmlSubagent({ llm: { apiKey, baseUrl, model }, thinkingMode: 'deep' })`. `thinkingMode` locks thinking depth: `'deep'` injects thinking params (quality first, ~2-5x tokens/time) / `'simple'` strips them (save tokens) / unset = inherit from main; top-level `subagent.thinkingMode` acts as a global default (an explicit per-subagent value wins). **Default deep (default-deep-thinking)**: with zero integrator config, main/sub models whose capability table marks `thinking:true` (deepseek-v4/reasoner, claude-3.7+/4-series, glm-5.2, …) automatically get deep injected for quality; non-thinking models (gpt-4o, …) get nothing (avoids 400). The main model can opt out via `llm:{ thinkingMode:'simple' }`; summary/title/compression-decision auxiliary channels are automatically simple. OpenAI-compatible uses `extraBody.thinking`; Anthropic uses the `thinking` field (budget_tokens defaults to `min(maxTokens??4096, 8000)`; when enabled the API forces temperature to 1). **Only the LLMConfig construction path is effective**: if the subagent reuses a pre-built `BaseChatModel` instance the thinking config is frozen at construction time → warn + observable no-op (switch to passing a `SubagentLlmConfig`). The model itself must support thinking (deepseek-thinking / claude; no effect on flash-class). Effective state is reflected via `inspect().subagent.subagents[].thinkingApplied` (`applied`/`inherited`/`instance-noop`).
  - **Breaking migration (2.x → 3.0)**: ① schema: add `code:z.string()` to `components[i]` (replaces `codeRef`), drop the `codeSnapshots` mirror; ② UI: bind `data.components[i].code` (replaces `codeSnapshots[p]`); ③ `createHtmlSubagent`: drop `onComplete` (framework auto-commits in afterAgent); ④ persist: send the whole data JSON to the server (including `code` + `__pgId`); ⑤ render layer: on `type:'custom'` read `data.code` (no more `codeRef`→vfs lookup).
- **Underlying — subagent arch extensions**: `SubagentConfig` adds `allowedTools` (pull vfs/draft tools from main) / `middleware` (mount planning) / `summarization` (cross-round compression); `sdk.vfsWrite(path, content)` async-injects vfs. Both packs build on these; integrators can also use the three fields directly to configure any specialized subagent.

#### Subagent observability: active/history runtime state (2.38+)

Multi-subagent scenarios (parallel HTML/RAG, complex orchestration) need a consolidated view: how many are running, what each is doing, how far along, who finished. The SDK maintains session-level active (running) / history (LRU≤20) state in the subagent middleware — a pure observation layer (does not change the one-shot lifecycle or event chain).

```js
// Active subagents (empty array = none running; each has taskId/task/label/status/steps/startedAt)
const active = sdk.getActiveSubagents()        // equivalent to sdk.inspect().subagent.active

// Delegation history (newest first; LRU≤20; each has durationMs/resultPreview)
const history = sdk.subagentHistory            // equivalent to sdk.inspect().subagent.history

// DebugDrawer "🤖 subagent" tab: running cards (status badge / step count / elapsed) + collapsible history (click to expand steps)
```

- Session-level, not persisted (cleared on refresh); steps are summaries (only `{kind,name,ts}` — full content in messages); resultPreview truncated to 120 chars
- Concurrency-safe: pre-declared use_<id> uses a unique observeId (event taskId stays `use_${id}`)
- Follows the `subagent` capability; build your own tracker: `import { createSubagentTracker } from 'page-agent-sdk'` (historyLimit default 20)

#### Subagent authorization surface: delegation never bypasses guardrails (fix-authorization-surface)

Delegation shares the same authorization/interception surface as the main agent — no extra configuration needed:

- **Child stack inherits main `permissions`/`approval`**: with `approval:{tools:['write']}`, a subagent's write (including spawn self-granted writablePaths) triggers the same confirmation (ApprovalBar renders normally; approve/reject settles immediately). permissions deny rules apply to children too.
- **Framework tools never enter the child pool (assembly-time filter)**: `use_*`/`spawn_*`/`load_skill`/`write_todos`/checkpoint/focus-mutation tools are excluded regardless of `allowedTools` or spawn's `tools` param — the LLM cannot self-grant delegation tools to activate the recursion chain.
- **spawn self-grant limits**: spawn_agent's `tools` param cannot grant write tools (write access only via `writablePaths`, path-guarded); `patches` containing an item without jsonPath (acts on root) → PATH_OUT_OF_SCOPE.
- **Child offload bridges main vfs**: a subagent's offloaded large results land in the main vfs shared pool — readable via vfs_read from both sides (no 404).
- **Capability-pack allowedTools now work**: the vfs tools of `createHtmlSubagent`/`createRagSubagent` (middleware-injected) are now resolved at assembly (2.37 assembly gap fixed).

#### Main×sub isolation: baseline scoping, per-task settlement, usage & timeout (2.40+)

- **Per-scope optimistic-lock baseline**: main and subagents share one dataOps controller; the autoLock baseline is now keyed by caller scope — a subagent's read/write only touches its own scope's baseline. Parent reads → delegates → external change happens → parent's stale write now conflicts as promised (previously the child's read refreshed the shared baseline, silently letting the stale write overwrite the external change).
- **spawn_agents settles per task (allSettled)**: one failing subtask no longer rejects the whole batch (losing successful siblings' results) — each task settles independently; the aggregated result marks each `【Subtask N】✓/✗` (failures carry the error summary) and the main LLM decides how to proceed.
- **Same-round parallel delegation & failure isolation (3.13+)**: pre-declared `use_<id>` delegations can run **in parallel within one round** — the main agent may issue multiple delegations for **different** targets in the same round (requires `maxParallelTools > 1`, default 1 serial; the HTML orchestrator prompt guides this automatically). **Failure isolation**: unrelated parallel tasks never roll back as a batch — a failed delegation returns its error result alone to the main agent while the others execute and land normally; code-asset commits are per-component fault-tolerant (a single component's commit failure is skipped with a trace, others unaffected). This is deliberately different from a single `write({ patches })` atomic batch (all-or-nothing): the latter is the atomic intent of **one logical write** (related tasks), while parallel delegations are multiple independent logical writes (unrelated) — semantics split by task relatedness.
- **Component lock · one in-flight delegation per component (3.13+ mechanical lock)**: a single component admits only one in-flight delegation at a time — no longer prompt-only guidance. ① **Delegation mutex**: a second concurrent `use_html` targeting the same component immediately returns `COMPONENT_BUSY` (recoverable, zero subagent cost — the main agent simply re-delegates next round); lock targets come from the explicit `components` arg (fabricated names filtered out), or, when absent, from a **unique whole-word match** of the task text against known component names (fail-open: 0 or ≥2 matches → no lock); different components' locks are independent and never block each other. ② **Main write guard**: while a delegation is in flight, main-agent write tools (`write`/`draft_commit`) hitting the locked component's subtree return `COMPONENT_LOCKED` (whole-data `set` also rejected; `dryRun` passes through) — allowed again once the lock releases. **codeField permanent guard (3.24.1+, html code-asset mode)**: the code field of an *existing* code component (e.g. `components.N.code`) is *permanently* unwritable by the main agent (independent of any in-flight lock) → returns `CUSTOM_CODE_DELEGATION` steering toward delegation (weak-instruction models were observed ignoring prompt prohibitions and overwriting human edits; the mechanism backstops this; new elements / whole-data set / dryRun still pass). ③ **Human-concurrency protection**: if a human/host mutates `bind` during the in-flight window (checkout→commit) — an external edit of the same component's code keeps the human value (`keep_external`, never silently overwritten) with a warn trace, **and the kept component names flow back into the delegation result** so the main agent honestly tells the user "your edit was preserved — continue with the original task?" instead of misreading it as subagent failure and rewriting; a deleted component stays deleted (no revival) and its vfs working copy is cleaned up; an index shift (insertion/removal moving components) is handled by committing via `__pgId` to the same component, never to a stale position. Observability: `inspect().subagent.lockedComponents` (component name → owning delegation) + the DebugDrawer subagent tab lock view.
- **Child tokens counted**: subagent LLM usage accumulates into `sdk.usage` (automation `tokenBudget` accounting is complete). No extra `usage` events are emitted for child rounds.
- **Child execution timeout**: `subagent: { timeoutMs }` — per-delegation total duration, **default 600000ms (10min) since 4.1** as a hang guard; `0` disables. On expiry the child stream is aborted and a recoverable error is fed back to the main LLM (retry / split into smaller subtasks). Reflected via `inspect().subagent.timeoutMs`.

### 6.2 Custom tools

```ts
import { defineTool, z } from 'page-agent-sdk'
const weather = defineTool({
  name: 'get_weather',
  description: 'Get weather for a city',
  schema: z.object({ city: z.string() }),
  handler: (args) => `Weather in ${args.city}: sunny`,
})
createChatSdk({ tools: [weather], /*...*/ })
```

### 6.3 Skills (progressive disclosure)

```ts
import { defineSkill } from 'page-agent-sdk'
const styleGuide = defineSkill({
  name: 'style_guide',
  description: 'Brand color spec',
  body: 'Primary #1f4d3a, accent #2d6a4f…',
})
createChatSdk({ skills: [styleGuide], /*...*/ })
```
The Agent sees only name+description upfront; `load_skill` fetches the full body on demand (saves context).

#### Dynamic skills: `exec` (run on load) + `tools` (callable tools) — skill-external-scripts

SkillSpec adds two optional fields, turning a skill from a "manual" into a "manual + executor":

```ts
defineSkill({
  name: 'orders',
  description: 'Orders overview & query',
  getContent: () => 'Use this skill for orders. Call query_orders to filter.',
  // exec: run once on load, inject result into the full text (one-shot context init, a snapshot)
  exec: {
    code: 'return await fetch("/api/orders/summary").then(r => r.json())',  // inline JS
    context: 'sandbox',  // default and only: Worker sandbox (no window/network, 3-layer guard); 'host' was removed in 4.1.0 (residual value falls back to sandbox)
    inject: 'append',    // default append (end); 'prepend' (start)
    // url: 'https://host/orders.js',  // remote script (sandbox only, never host)
  },
  // tools: attach repeatedly-callable tools (injected into the tool pool after load_skill)
  tools: [() => queryOrdersTool],
})
```

**exec vs tools (orthogonal — don't mix)**: `exec` = one-shot context init (snapshot on load, e.g. "current orders summary"); `tools` = query capability (called repeatedly by the LLM, e.g. "filter orders by X").

- **exec security**: always `sandbox` (reuses eval_script's Worker sandbox: static scan + `lockSandboxGlobal` network lock + timeout). `context:'host'` (full host authority) was removed in 4.1.0 — residual `'host'` values run in the sandbox (full-authority downgraded to sandbox, semantics reversed, see CHANGELOG); for host-authority logic use defineSkill's `tools` factory on the integrator side.
- **exec failure is not cached**: a failed script (e.g. network blip) doesn't block the skill (text still usable + failure noted) and is **not written to cache** — next `load_skill` re-runs exec (dynamic-skill resilience); only success is cached.
- **exec large results**: when text + exec result exceeds 6000 chars, the createAgent offload kicks in (→ vfs + preview); the LLM re-reads via `vfs_read`. "Read-all-at-once" only guarantees the static text part.

**Multi-level reference docs `references` (progressive disclosure for big skills)**: configure browser-side skills shaped like "SKILL.md index + references/ multi-file" (style recipe libraries, pattern libraries, critique guides). The main doc only carries "when + how"; secondary docs hang off `references` and are fetched on demand — a 26-recipe skill never floods the context:

```ts
defineSkill({
  name: 'web-design-engineer',
  description: 'Web visual design: style selection / layout / critique',
  doc: 'vfs://skills/wde/SKILL.md',            // main: index + method (or inline via getContent)
  references: [
    { name: 'style-recipes/linear.md', description: 'Linear minimalist', doc: 'vfs://skills/wde/style-recipes/linear.md' },
    { name: 'style-recipes/aesop.md', description: 'Aesop editorial', getContent: () => AESOP_MD },  // build chains can inline via import.meta.glob raw
  ],
})
```

- `load_skill(name)` auto-appends a **reference index** (name + description + "use `load_skill(name, ref)` on demand") to the main text; the LLM then fetches a single reference via `load_skill(name, ref='style-recipes/linear.md')` (independent cache; same-round repeats intercepted).
- Reference sources share the main doc semantics (`doc` http/vfs / `getContent` inline); build-chain integrators map `import.meta.glob('.../*.md', { as: 'raw' })` into references; CDN/no-build uses `doc` pointing at statically hosted URLs.
- `sdk.invalidateSkillCache(name)` clears the main text + all ref caches together.
- **tools injection**: after `load_skill`, tools are evaluated → injected into the agent tool pool (via dedupeTools; namespace prefix `<skill>__<tool>` recommended); source labeled `skill:<name>`; unloaded by `sdk.setSkills`/`invalidateSkillCache`.

### 6.4 Memory (persistent directives)

`memory: '...'` — AGENTS.md-style persistent instructions injected into every conversation (style guides, conventions, do/don'ts).

### 6.5 Planning (auto)

`write_todos` tool (enabled via `capabilities.planning`, default on) — the Agent plans multi-step tasks as a todo list.

### 6.6 Persistence & sessions

`storage: 'indexed'` (or `'session'`/`'local'`/`'memory'`) — persists dialog/workspace/todos/memory; `id` isolates multiple agents; `switchSession(id?)` switches; `shareContext:true` lets same-id instances share one agent.

**Server-side persistence (custom backend injection)** — pass a `StorageBackend` instance (5 KV methods) as `backend` to point persistence at any remote (REST API / your BFF / cloud KV); the SDK's debounced batch writes, multi-session switching, quota eviction and degradation semantics all apply unchanged:

```ts
import { createChatSdk, type StorageBackend } from 'page-agent-sdk'

/** REST-backed StorageBackend: 5 methods mapped to your server's KV endpoints */
function createHttpBackend(baseUrl: string): StorageBackend {
  const q = (prefix: string) => `${baseUrl}/kv?prefix=${encodeURIComponent(prefix)}`
  return {
    async get(key) {
      const r = await fetch(`${baseUrl}/kv/${encodeURIComponent(key)}`)
      return r.ok ? await r.json() : undefined          // missing → undefined
    },
    async set(key, value) {
      const r = await fetch(`${baseUrl}/kv/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
      })
      if (!r.ok) throw new Error(`kv set ${r.status}`)   // throwing is safe: SDK swallows + retries on later flush
    },
    async del(key) { await fetch(`${baseUrl}/kv/${encodeURIComponent(key)}`, { method: 'DELETE' }) },
    async scan(prefix, cb) {
      const items = await (await fetch(q(prefix))).json() // server returns [{key, value},...]
      for (const it of items) if (cb(it.key, it.value) === false) break
    },
    async clearPrefix(prefix) { await fetch(q(prefix), { method: 'DELETE' }) },
  }
}

createChatSdk({
  storage: { backend: createHttpBackend('/api/agent-store'), maxBytes: Infinity },
  // maxBytes: Infinity disables client-side LRU eviction AND the per-session cap maxBytesPerSession (capacity fully server-side; default 50MB client quota otherwise)
})
```

Server contract notes: **keys look like `v:1::<dbName>::<agentId>::<sessionId>::<kind>`** (kind = messages/vfs/todos/memory/checkpoints/usage/mission/workingMemory/focus/planConfirmation + session metadata `__meta__`; each key holds a whole JSON snapshot); `scan`/`clearPrefix` are required (`listSessions`/`deleteSession` rely on prefix scanning); writes are debounced (default 500ms) and batched — not one request per keystroke; backend errors never crash the SDK (swallowed + retried by later flush, same degradation as built-in backends). Concurrent writers to the same session are last-writer-wins; no merging. The direct factory `createSessionStoreWithBackend` is exported too (for using the persistence layer standalone, outside createChatSdk).

**Per-session cap `maxBytesPerSession`** (default 10MB): when a session's total bytes across kinds exceed the cap, that kind's write is **rejected** (old value kept — data is not deleted), preventing one runaway session from hogging the client quota; rejections are logged to `debugLogs` (`stage: 'storage_quota'`, with sessionBytes/limit). Also disabled when `maxBytes: Infinity` (capacity fully server-side); an explicitly passed `maxBytesPerSession` always wins over the linkage.

**Clear session `resetSession()` (2.41.0+, sync)** — same semantics as the UI "clear conversation": aborts in-flight streams + resolves any pending conflict (as "keep external") + resets messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs + fresh sessionId + emits `session_restored`. **Fully resets in-memory state even when storage is off** (fixed in 2.41.0: previously it early-returned without storage, leaking mission/focus/todos into the new conversation); with storage on it also creates a new persisted session. Use it for a headless "new chat" button.

**Resume notice (on by default)** — when a **non-empty history** is restored from persistence (refresh autoResume / `session.id` / `switchSession`), the **first** turn after restore injects a system-prompt notice: "the host data may have changed while you were away (e.g. a refresh reverted it to the last saved state, unsaved edits lost); verify with read/list before asserting 'already generated/done'". Rationale: the restored dialog/todos are a historical snapshot, but **`bind` is not persisted** — if the integrator resets `bind` to the last saved state on refresh, the history's "done" no longer matches reality, and the agent once answered a "regenerate" request with "done" without checking. The notice is one-shot (cleared when the turn ends), signals only (never blocks tools); logged as `debugLogs stage:'resume_notice'`.

### 6.7 Robustness

- Auto-retry model calls (network/429/5xx, exponential backoff, `maxRetries` default 2)
- Stop generation (abort) — preserves partial content
- Retry on error (UI)
- **Bounded hangs (fix-hang-and-feedback)** — every "wait for human / external IO" point has a timeout + interrupt path:
  - Approval/humanConfirm requests with no responder **auto-reject after 30s** (middleware-level since 4.1, covers headless `stream`, `send`/`batch` and `streaming:false`) with an `APPROVAL_AUTO_REJECTED` error event. The `approval_request` event carries an optional `hold()` — a responder that takes over calls it to cancel the timer (the built-in UI does this, so interactive flows wait for the human indefinitely). Override via `approval.timeoutMs`; `Infinity`/negative = wait forever for integrators with their own confirmation channel
  - `send(msg, { signal })` / `batch(tasks, onProgress, signal)` accept an AbortSignal; `unmount()` / `switchSession()` / `resetSession()` abort in-flight streams (no ghost streams)
  - MCP handshake timeout: default 15s (`mcp[].timeoutMs`); black-hole endpoints degrade gracefully instead of hanging init
  - MCP tool-call timeout (3.6+): each callTool defaults to 60s (`mcp[].callTimeoutMs`); a hung server no longer stalls the ReAct loop — the timed-out call is voided and fed back for LLM self-correction (no retry), the connection stays alive for subsequent calls
  - MCP reserved tool-name protection: an MCP tool whose name collides with a built-in/user tool (e.g. `write`/`read`) is **rejected from injection** with a `console.warn` (prevents a compromised server from silently overriding built-ins); non-colliding tools from the same server inject normally
  - LLM stream stall watchdog: no chunk for `streamStallMs` (default 90s; 0 = off) → abort with error (no infinite loading)
  - Stream total duration cap: a single model call exceeding `streamMaxDurationMs` (default 600s; 0 = off) → `StreamMaxDurationError` (408, no retry). Guards against "keepalive black holes" — some relays return 200+SSE headers then hold the connection with empty keepalive frames (the interval watchdog never fires; observed frozen 7min+ with no error). Fail fast, then re-delegate/resend to recover
  - Integrator tool watchdog (`toolTimeoutMs`, default 120s; 0 = off): a single tool call that never settles is abandoned at the timeout with a recoverable error result fed back for self-correction (prevents a broken integrator tool from hanging the whole round: eternal loading + dead stop button). Only applies to integrator-injected tools (`defineTool` / `actions` / skill tool factories / rag retriever); built-in tools / MCP / sub-agent delegation and optimistic-lock conflict waits (awaiting human resolution) are designed waits and are exempt
  - Conflict hangs are abortable: on every entry point (`send` / `batch` / UI `stream`), aborting the passed AbortSignal auto-resolves a pending optimistic-lock conflict as keep_external — send no longer hangs forever; external changes are preserved and the agent's value is not written
- **Instruction-adherence guards (instruction-adherence, 3.35+, both default on, zero config)** — two prefer-miss-over-false-positive guards for real-LLM failure modes:
  - **Completion gate (anti premature stop)**: after the agent plans with `write_todos`, if unfinished items remain but it tries to close with plain text, the framework injects a "two-exit" nudge to continue (mark done via `update_todo`, or keep executing), capped at 2 to avoid loops. Exempt when the closing line is a question (asking the user) or no plan exists (empty todos). Fixes "planned 3 tasks, did 1, then stopped". The nudge text also lists completed-but-no-evidence items as a rider
  - **Error-as-guide + duplicate-failure reminder (tool-result embedded, tool-call-economy C2)**: reading a nonexistent path returns `PATH_NOT_FOUND` with parent context (valid index range for arrays / actual keys for objects); a typo'd key gets `PATH_DENIED` with the parent's key set; when the same tool+args fails 2+ times in a row, a reminder is appended guiding the agent to change path/approach instead of retrying verbatim
  - **Evidence audit gate (anti fabricated evidence)**: runtime hints teach the agent to attach `evidence` (the jsonPath actually written) when marking completed; at finish time, if a todo's evidence path has never been written this session, the framework nudges with three exits (fix the path / revert to pending / honestly describe how the work was done), capped at 2, then passes through with an `AUDIT_GATE_EXHAUSTED` observable; the rounds-exhausted wrap-up path also re-runs the audit at zero LLM cost (`AUDIT_EVIDENCE_SUSPECT`). Descriptive evidence (no path form) is not checked; for purely delegated work, describe the completion method instead of a path
  - **Question-intent guard (anti attention drift)**: a 3-tier regex heuristic (trailing `?` / question-word + 吗呢 / query-words like "是什么|怎么用|有哪些") classifies each user message; on a hit, an "answer first, don't act" pin segment is injected (survives compression), steering the agent to verify with read/query/rag before acting instead of mis-routing into generation. Fixes long-chat questions being dragged into actions by history ("asking what a component is but ending up generating code"). **Signals only, never blocks tools**; the text carries an escape hatch ("unless the same message explicitly requests an action"), so imperatives ("change the title to X") are unaffected

### 6.8 Context & memory caps

- 4-layer adaptive compression (`contextPreset`: auto/conservative/aggressive/complex). **LLM summary is async (2.41.0+)**: compression returns immediately with an index summary (**no first-token block**; previously it awaited the LLM ≤15s), while an LLM summary runs in the background into a prefix cache; later rounds reuse it (LLM prefix + fresh index tail).
- **Compression cost cap** (`contextOptions.promptSoftCapTokens`, 3.11+): the token trigger is `min(window × ratio, softCap)`. Huge-window models (e.g. 1M-window flash-class) would burn hundreds of thousands of tokens before the ratio trigger fires — the soft cap switches "when to compress" to a cost dimension: **defaults to 160K when unset and window ≥320K**; an explicit positive value wins; explicit `0` disables (small-window models are unaffected — the cap can only trigger earlier, never later). Verify the effective value via `inspect().compression.promptSoftCap`. See `doc/context-management.md` §5.
- **Round-budget awareness (3.43, createAgent core)**: once used rounds reach 70% of `maxToolRounds`, a "⚠️ round budget" notice is injected into every round's system prompt, escalating to "critical" when ≤2 rounds remain — the model adapts (cut non-essential queries, finish core writes, honestly mark unfinished todos) before hitting the wall instead of being cut off mid-task; the notice lives in the per-round system re-render only, never pollutes history. **Token budget hint (C1)**: a one-shot "⏳ budget hint" line is injected when cumulative prompt tokens reach half the soft cap; the same write path failing ≥2 times consecutively injects a "re-read / restore_data" reminder. Opt-in per-invocation cap `roundTokenBudget` (default off): cumulative tokens for a single `send` exceeding it → friendly wrap-up text, partial work preserved — unlike automation's `tokenBudget` it needs no `capabilities.automation` and scopes to one call (guards against a single runaway round).
  ```ts
  createChatSdk({ roundTokenBudget: 50000 })  // per-task cap ~50K tokens, friendly wrap-up on exceed
  ```
- vfs `maxBytes` (default 8MB; 2.16.0+ three independent pools) LRU evict; dialog `maxMemoryRounds` (default 30) trim

#### complex preset + vfs JSON-aware tools (2.16.0+)

For **multi-step complex tasks / large JSON edits / long-running workflows**, 2.16.0 adds a `complex` context preset, vfs JSON-aware tools, three-pool vfs partitioning, and structured offload metadata — improving context stability and large-file partial-edit capability.

**① `complex` context preset**

`auto`/`conservative`/`aggressive` target ordinary chat. Multi-step complex tasks (low-code page building, large config orchestration, long-doc processing) have bulky tool results, high per-round context needs, and must keep field descriptions across rounds. `complex` uses **ratio-based** tuning for these scenarios:

| Field | complex | auto (compare) | Notes |
|---|---|---|---|
| `windowRatio` | 0.6 | 0.4 | Keep 60% of the context window for recent verbatim text (large JSON tool results need more original text) |
| `summaryThresholdRatio` | 0.7 | 0.5 | Compress only at 70% usage (compress later, lose less detail) |
| `recallTopK` | 5 | 3 | Recall more old rounds (complex tasks have strong cross-round context linkage) |
| `enableLLMSummary` | true | true | Use LLM summary (quality) |
| `preserveLastToolResults` | `['describe_data','read','query_data','search_data']` | `['describe_data','read']` | Also preserve query/search result snippets (large-JSON query scenarios) |

```ts
createChatSdk({
  contextPreset: 'complex',   // one-line: complex-task preset
  // any field can override (same as auto/conservative/aggressive)
  contextOptions: { recallTopK: 8 },  // e.g. very long task, recall more
  // ...
})
```

> `inspect().contextPreset` (2.16.0+) exposes the effective preset in DebugDrawer.

**② vfs JSON-aware tools** (`vfs_json_read` / `vfs_json_patch` / `vfs_write` jsonString)

The vfs workspace often stores large JSON (fetched API responses, component snapshots, config-tree drafts). Before 2.16.0 you could only `vfs_read` the whole file + `vfs_write` the whole thing back — re-sending large JSON is easily truncated by `max_tokens`. Two new tools support **jsonPath partial read/write**:

```ts
// vfs_json_read: read a JSON subtree from a vfs file via jsonPath (omit to read whole)
vfs_json_read({ path: 'drafts/config.json' })                          // whole file
vfs_json_read({ path: 'drafts/config.json', jsonPath: 'components.0' }) // only a subtree (saves tokens)

// vfs_json_patch: atomic jsonPath patch inside a vfs file (applied on a clone; any failure → nothing written back)
vfs_json_patch({
  path: 'drafts/config.json',
  patches: [
    { op: 'set',    jsonPath: 'title',         value: 'New title' },
    { op: 'append', jsonPath: 'items',         value: { id: 99 } },
    { op: 'merge',  jsonPath: 'style',         value: { color: 'red' } },
    { op: 'remove', jsonPath: 'deprecated' },
  ],
})
// any patch fails → PATCH_FAILED, original file unchanged (atomic)

// vfs_write jsonString:true → validate content is valid JSON before writing (invalid → VFS_JSON_INVALID, not written)
vfs_write({ path: 'drafts/config.json', content: '{"a":1}', jsonString: true })
```

| Tool / error | Meaning |
|---|---|
| `vfs_json_read` returns `VFS_JSON_INVALID` | File content is not valid JSON |
| `vfs_json_read` returns `VFS_PATH_NOT_FOUND` | jsonPath does not exist in the JSON |
| `vfs_json_patch` returns `PATCH_FAILED` | A patch failed to apply; original file unchanged (atomic) |
| `vfs_write(jsonString:true)` returns `VFS_JSON_INVALID` | content is not valid JSON; not written |

> Motivation: editing a large JSON via jsonPath patch sends only the delta, avoiding `max_tokens` truncation that would leave the whole JSON incomplete. Mirrors the on-data `write({patch})` semantics.

**③ vfs three-pool partitioning**

Before 2.16.0 vfs was a single LRU pool — offloaded tool results (`large_results/*`) competed for quota with user drafts (`drafts/*`) / user files (`userFiles`), and large results could evict drafts (losing user data). Now three independent LRU pools:

| Pool | Prefix | Default quota | Purpose |
|---|---|---|---|
| `large_results` | `large_results/*` | 4MB | Tool-result auto-offload (>6000 chars; >10000 attaches `suggestedReadPlan`) |
| `drafts` | `drafts/*` | 2MB | Drafts written by Agent / integrator |
| `userFiles` | `userFiles` (no fixed prefix) | 2MB | User files |

`vfs.maxBytes` (total, default 8MB), `vfs.poolBytes` (per-pool override). Reads/writes route transparently across pools.

```ts
createChatSdk({
  vfs: {
    maxBytes: 16 * 1024 * 1024,            // raise total cap (default 8MB)
    poolBytes: { drafts: 4 * 1024 * 1024 }, // per-pool: drafts pool 4MB (others default)
  },
})
```

**④ Structured offload metadata + suggestedReadPlan**

The return value for offloaded tool results (above threshold) is upgraded to `OffloadResult` with structured metadata. **Large results (>10000 chars) include `suggestedReadPlan`** — a `vfs_read` paging/segmenting plan advising the LLM how to consume the result in chunks (which section first, how many pages), guiding the Agent to consume in blocks instead of stuffing the whole thing into context. No integrator config; automatic.

### 6.9 onEvent callback (subscribe to common moments)

`createChatSdk({ onEvent })` provides a lightweight event callback to subscribe to common moments during Agent runs, for **external integration** (host page reactive refresh, analytics, logging, custom UI sync) — replacing polling. Works in both UI and headless modes.

**Event types** (`SdkEvent`):

| Event | When | Fields |
|---|---|---|
| `data_change` | After Agent calls a write tool (high-level `write` / `restore_data` / `eval_script` transform mode / `draft_commit` / `resource_update`) | `operation` (`set`/`edit`/`delete`/`restore`; `write` infers from args [del→delete, patch/patches→edit, else set], eval_script transform / draft_commit / resource_update always `edit`; a `dryRun` write doesn't land and doesn't fire) / `value` (post-change value, i.e. the entire bind) |
| `message_update` | After each Agent round | `count` (message count) |
| `tool_call` | Before tool call (stream mode) | `name` / `args` |
| `tool_result` | After tool returns (stream mode) | `name` / `result` / `status` |
| `text` / `reasoning` | Streaming text/reasoning delta (stream mode) | `delta` |
| `round_start` | Each model call round start | `round` |
| `subagent` | Subagent progress (tool calls + reasoning) | `taskId`/`label`/`kind`(`tool_call`/`tool_result`/`reasoning`)/`name`/`delta`(reasoning increment)/... |
| `done` | Round reply complete (stream mode) | `content` |
| `usage` | After each LLM call (if provider returns usage) | `round` / `usage` (round prompt/completion/total_tokens) / `cumulative` (cumulative) |
| `session_restored` | After storage restores a session snapshot (mount auto-resume / `switchSession` to an existing session) | `sessionId` / `rounds` (restored message count) |
| `error` | Model call / tool throws | `message` |

> ⚠️ `approval_request` is NOT forwarded (UI already handles it, to avoid double `resolve`).
> ⚠️ `tool_call`/`tool_result`/`text`/`done` etc. fire only in **stream mode** (UI defaults to stream; imperative `sdk.send` uses invoke — no stream events, but `data_change`/`message_update`/`error` still fire).

**Example** (host page reactive refresh, replacing `setInterval` polling):

```ts
createChatSdk({
  /* ... */
  onEvent(event) {
    if (event.type === 'data_change') {
      // Agent changed the main data → refresh your UI mirror in real time
      renderState()
    } else if (event.type === 'tool_call') {
      analytics.track('agent_tool_call', { name: event.name })
    } else if (event.type === 'error') {
      console.error('agent error', event.message)
    }
  },
}).mount()
```

> For deeper interception/enhancement (mutating messages, wrapping model calls, contributing tools) use **custom middleware** (next section); `onEvent` is for read-only observation.

**`sdk.hook(handler)` — runtime subscription (multiple listeners, cancellable)**

Besides the constructor-time `onEvent`, the instance exposes a `hook` method for runtime subscription — register multiple listeners, each returning an unsubscribe function:

```ts
const sdk = createChatSdk({ /* onEvent not required */ }).mount()

// listener 1: host page reactive refresh
const off1 = sdk.hook((event) => {
  if (event.type === 'data_change') renderUI()
})

// listener 2: analytics (coexists with listener 1, independent)
const off2 = sdk.hook((event) => {
  if (event.type === 'tool_call') analytics.track('tool', { name: event.name })
})

// unsubscribe
off1()
off2()
```

`onEvent` and `hook` are complementary: the former is a single constructor-time callback, the latter runtime multi-listener; both can coexist. Event types and filtering rules as above (`approval_request` not forwarded; stream events only in stream mode).

### 6.13b Context archival `context_trimmed` (rescue content about to be deleted when the conversation grows long, context-persist-resilience)

When the conversation exceeds `maxMemoryRounds` (default 30 rounds), the AI deletes the oldest rounds to free memory (originals gone forever, only a summary kept). If you need audit/compliance/backup, subscribe to `context_trimmed`: right before deletion it hands you the full originals (including referenced vfs large results) + the replacement summary — store them to your own server if you want (the SDK doesn't hoard; default deletion behavior is unchanged).

```ts
createChatSdk({
  storage: 'indexed',  // storage must be on (so vfs large results persist and the archive is complete)
  onEvent(e) {
    if (e.type === 'context_trimmed') {
      // e.dropped    = full early conversation about to be deleted (each round: user / AI / tool results)
      // e.vfsResults = referenced vfs large-result originals { path→content }
      // e.summary    = the replacement summary
      archiveService.save({ dropped: e.dropped, vfsResults: e.vfsResults, summary: e.summary })
    }
  }
})
```

- Not subscribing = same as now (AI deletes as usual, you do nothing). Fully optional.
- Same chain: vfs orphan GC (auto-reclaims unreferenced large results after trim, prevents buildup); mission/workingMemory persist across refresh (long-task goal + working memory survive reload).

### 6.13c Diagnostics report export `exportDiagnostics` (debugging / troubleshooting, 3.29+)

When a user reports "the agent misbehaved", the hardest part is capturing the scene: full logs + messages + context snapshot. **`sdk.exportDiagnostics()`** aggregates the current session's diagnostics snapshot into one JSON string — the user downloads the file and sends it to the maintainer (the built-in DebugDrawer header has a 💾 button that downloads it as a JSON file; switched from clipboard copy since large logs are often truncated by the clipboard):

```ts
const text = sdk.exportDiagnostics()  // JSON string, ready to copy/upload
```

Report contents: full `debugLogs` (the log-file body) + `messages` + `inspect()` snapshot (tools/middleware/subagent/context makeup) + cumulative `usage` + `pendingConflict` + `dataSummary` (description/top keys/approx bytes) + `sessionId` (multi-session anchor) + environment info.

**Privacy guardrails**: apiKey never enters the report; the data schema's zod internals are stripped (only top-level key summary); **bind data is never dumped in full** (summary only); credential query params in URLs are masked; fields >50KB are truncated with a marker (image dataUri won't blow up the report).

**Size cap**: reports >6MB drop the oldest logs until under the cap (a `diagnostics_truncated` marker is prepended; the most recent — most relevant — logs are kept), clipboard-friendly.

Pure functions are exported for standalone use (headless integrators building their own troubleshooting entry):

```ts
import { buildDiagnosticsReport, stringifyDiagnosticsReport, maskUrlCredentials } from 'page-agent-sdk'
// buildDiagnosticsReport({ debugLogs, messages, info, usage, ... }) → structured report
// stringifyDiagnosticsReport(report) → JSON string with the size cap applied
```

> Headless integrators reusing the built-in DebugDrawer without the `exportDiagnostics` prop still get the button: it falls back to local aggregation (logs + getInfo only, no messages/usage/dataSummary).

### Unattended automation (resource budget / error recovery / batch / resume, 2.20+)

For unattended batch / long-task scenarios (generate pages in the background, cron jobs, long flows): budget control, automatic error recovery, batch processing, and resume after refresh/crash. Opt-in (most advanced, default off).

```ts
const sdk = createChatSdk({
  capabilities: { automation: true },  // opt-in, default off
  tokenBudget: 100000,      // cumulative token cap (exceed → stop + emit BUDGET_EXCEEDED)
  roundTokenBudget: 50000,  // (optional) per-invocation token cap, 3.11+; no automation capability needed, friendly wrap-up on exceed
  timeBudgetMs: 600000,     // time cap ms (10 min; exceed → stop)
  maxAutoRetries: 2,        // fatal-error auto-recovery count (restore_last_checkpoint + retry; default 1)
  checkpoint: true,         // pairs with resume (per-round snapshot + persist checkpoint stack/usage)
  storage: 'indexed',       // resume needs persistence
  id: 'my-automation',      // stable id (same id recovers same session after refresh)
})

// Batch: run tasks one by one, checkpoint before each, failure isolated
const results = await sdk.batch(['gen page A', 'gen page B', 'gen page C'])
// → [{ task, reply, ok:true }, { task, error, ok:false }, { task, reply, ok:true }]
```

- **Resource budget** (`tokenBudget`/`timeBudgetMs`): checked before each model call; exceed → agent stops + emits `BUDGET_EXCEEDED` (observable); unfinished part can `restoreLastCheckpoint`. `roundTokenBudget` (3.11+) is a per-invocation complement — no `capabilities.automation` needed.
- **Error recovery** (`maxAutoRetries`): fatal invoke error → `restore_last_checkpoint` + retry (limited) + emit `AUTO_RECOVER_RETRY`; exhausted → fatal.
- **Batch** (`sdk.batch(tasks)`): per-task invoke, checkpoint before each; failed task `messages` splice truncate + `ok:false` doesn't halt the batch + emit `BATCH_TASK_FAILED`.
- **Resume**: after refresh/crash, new sdk with same `id` + `storage` → mount recovers (checkpoint stack + cumulative usage from store) → `listCheckpoints` has values + `restoreLastCheckpoint` works + budget stats stay continuous. Needs `capabilities.automation` + `checkpoint` + `storage` together.

> Use cases: batch generation, cron jobs, long flows. Combine headless (`ui:false`) + `storage` + `automation` for in-browser background automation (no Node cross-env).

### 6.10 Convenience API (export / import / usage / audit)

Beyond event subscription, the SDK instance exposes a few convenience APIs covering backup/migration, usage stats, and audit tracing:

| API | Purpose | Notes |
|---|---|---|
| `sdk.exportData()` | Returns a **deep copy** of the main data `bind` (JSON-serialized) | For backup/migration; mutating the return value does not affect the original bind; returns `null` if dataOps is off or no data |
| `sdk.importData(json, opts?)` | Replace `bind` entirely (in-place restore, preserves reactive ref) | Schema-validated by default, returns `{ok:false,error}` if invalid; `opts.validate:false` skips validation; `opts.emit:false` suppresses `data_change` |
| `sdk.setSkills(skills)` | Runtime swap the entire skill list (same-name overwrites) | Takes effect immediately: the skill index section of the system prompt re-renders next round; clears the skill full-text cache & in-round loaded set, so the next `load_skill` re-fetches the latest full text (incl. vfs doc); requires skills enabled (default on) |
| `sdk.invalidateSkillCache(name?)` | Invalidate the skill full-text cache (proactive) | Omit `name` to clear all, pass `name` to clear one; use when a dynamic skill's content changes; the next `load_skill` re-runs `getContent`/`readSkillDoc`; requires skills enabled (default on) |
| `sdk.addSkill(skill)` | User-created skill (runtime + independent persistence) | `skill: { name, description, prompt \| getContent \| doc }`; auto-added to the agent, persisted via **independent SkillStore** (default indexedDB, separate from `storage`, persists even when `storage: false`, auto-restored across refreshes); same-name overwrites; requires skills enabled (default on) + `skillStorage` not `false` for persistence |
| `sdk.removeSkill(name)` | Remove a user-created skill | Only removes user-created (added via `addSkill`), not the integrator's initialSkills passed via `skills` option; removes from SkillStore; returns `boolean` (success); requires skills enabled |
| `sdk.listUserSkills()` | List user-created skill names | Returns `string[]` (only user-created, not initialSkills); for UI panel refresh |
| `sdk.getUserSkill(name)` | Read a user-created skill's detail | Returns `{ name, description, content }` or `undefined` (when not found); for SkillPanel editing |
| `skillStorage` option | User skill independent persistence config | Default `{ backend: 'indexed' }` (separate from `storage`); `false` disables (current session only); `id` manually specifies the same id to share skills across pages/agents; omit `id` for per-agent isolation (`agent::{agentId}`) |
| `SkillPanel` component | UI panel for users to create/edit/delete skills | The built-in `ChatDialog` header "Skill Management" button already integrates it (supports create/edit/delete); integrators can also `import { SkillPanel } from 'page-agent-sdk'` for custom UIs |
| `sdk.usage` | Cumulative token usage `{prompt_tokens, completion_tokens, total_tokens, reasoning_tokens?}` | Accumulated per LLM call; all 0 when no calls; per-round detail emitted via `onEvent('usage')`. `reasoning_tokens` is the reasoning/thinking token count (cost visibility for the default-deep thinking mode): tracked separately as a **subset of completion** (not added on top); DebugDrawer per-round logs show it as a percentage of completion. Carried only when the endpoint reports it (OpenAI-compatible / DeepSeek); the Anthropic protocol's current dependency stack does not expose this breakdown, so the field is omitted |
| `onAudit(entry)` option | Structured audit callback for data writes (independent of `debug`) | Fires on every `set`/`edit`/`delete`/`restore` with `{op, jsonPath, opDetail, timestamp, success, error?}`; for compliance audit / operation tracing |

```ts
// Backup + restore
const backup = sdk.exportData()
localStorage.setItem('backup', JSON.stringify(backup))
// ...restore after an issue
sdk.importData(JSON.parse(localStorage.getItem('backup')))

// Usage stats
onEvent(e => { if (e.type === 'usage') costMeter.add(e.usage) })
console.log(sdk.usage)  // cumulative

// Audit
createChatSdk({
  onAudit: (entry) => auditLog.append(entry),  // no debug:true needed
  // ...
})
```

### 6.14 Context Focus (refine one component, focus-context)

When a page has many components and you want to refine just one (e.g. the navbar `components.3`), focusing converges the agent's **goal / view / scope** onto that subtree so it won't drift to other components. The focus is opt-in (only active after `setFocus`; default behavior is unchanged).

**SDK API**:

```ts
const res = sdk.setFocus({ path: 'components.3', label: 'Navbar' })
// res: { ok: true } or { ok: false, error } (rejected if path not in schema; does not throw)
sdk.getFocus()   // → { path, label? } | undefined
sdk.clearFocus() // exit focus, restore full editable range
```

After focusing, three layers converge:
- **Goal hint**: each turn injects "## Current refinement target: components.3 (Navbar)"; **intent-ownership steering (4.1+)**: creation-type commands ("add/change/remove X") default to modifying the focused component itself (e.g. focused on a tabs component, "add a tab" means adding a tab panel inside it — write `components.8.props.tabs` subpath); only an explicit "create a new standalone component" requires unfocusing — flash-class models were observed misreading "add a tab" as appending a whole new component, hence the mechanical guidance
- **View convergence**: only the focused component's subtree schema is shown (other components hidden)
- **Scope tightening (strict)**: writing outside the subtree (e.g. `components.0`) → `PATH_DENIED` error fed back for self-correction; the message leads with the **correct-path exit (4.1+)** — "if your intent is to modify the focused component itself, retry with a subpath of the focus path (with a concrete example)" — before the unfocus exits, preventing the agent from mechanically clearing focus and carrying out a misread intent; reads are not limited. **Exception: tail-append allowed** — writing `<arrayPath>.<N>` (N ≥ current array length, i.e. appending a new element) doesn't break the focus subtree, so you can still create new components while focused (e.g. focused on hero, `write components.2` to append banner)

**Effective timing (invoke-freeze, 4.2.3+)**: focus anchors the **next input** — a host-side focus change (click-pick, `setFocus`/`clearFocus`) arriving while a flow is **in flight** does not retroactively constrain the current run (the focus chip updates immediately, but the running turns are unaffected); it takes effect on the next send. The agent's own `set_focus`/`clear_focus` tool calls take effect **immediately** (including the current run). Driven by a real incident: the user sent "shuffle the whole page", then clicked a deep component during the plan-confirmation hold — the mid-run focus immediately PATH_DENIED'd the in-flight page-wide shuffle, forcing the agent to detour via clear_focus.

> **× code-as-data-asset hardening (sub-agent code refinement)**: with `createHtmlSubagent`, the sub-agent edits code via `vfs_edit` (not a data write), which `focus.ts`'s data-write guard doesn't cover. So `codeAssetMiddleware` adds a **vfs whitelist** before execution: a sub-agent (inheriting the main focus) may only `vfs_edit` the focused component's code file (judged by `__pgId` ownership) — out-of-scope → `PATH_DENIED`, so even a confused sub-agent can't touch another component's code. This is the hard-contract basis for "click a component → refine it by chat". Focusing an entire array / a non-code field is a passthrough (can't pin a specific component). **You can't create new components while focused** (the data write is blocked by focus.ts) — `clearFocus` first. Full example: `examples/html-page-demo` (click a component in the preview → 🎯 focus → refine by chat).

**Three trigger methods**: ① `sdk.setFocus(path,{label?})` API (host click-pick or programmatic); ② agent tools `set_focus`/`clear_focus` (data tools are always fully exposed, so the agent can self-focus); ③ built-in ChatDialog focus chip (✕ exit · ▾ edit path); hidden when `capabilities.focus:false`.

**Host click-pick** (bind `data-path` on component roots, delegate clicks to `setFocus`):

```ts
containerEl.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('[data-path]')
  const path = target?.getAttribute('data-path')
  if (path) sdk.setFocus({ path }) // focus chip appears; subsequent turns refine only this component
})
```

Full runnable example: `examples/complex-demo` (`PageRenderer.vue` / `CompRenderer.vue` bind `data-path` + click-pick).

> Path validation is "type-valid", not "data-exists": `setFocus` checks the schema shape via `getSchemaAtPath`. An array index like `components.5` is type-valid and focusable even if fewer than 6 exist; a sub-path under a leaf (e.g. `title.sub`) or a non-existent top-level field is rejected. **Open schemas** (`z.record(...)` / `z.any()` / `z.unknown()` subtrees) accept any path — e.g. an editor page tree bound as `z.record(z.string(), z.unknown())` can `setFocus` any picked component path. `capabilities.focus` defaults on.

## 7. Custom middleware

```ts
import { type Middleware } from 'page-agent-sdk'
const mw: Middleware = {
  name: 'telemetry',
  // 8 hooks: beforeAgent / wrapModelCall / beforeModel / afterModel / wrapToolCall / afterAgent / beforeReturn
  //         + augmentPrompt / compressInput / tools
  afterModel: async (ctx, next) => {
    await next(ctx)
    console.log('round done')
  },
}
createChatSdk({ middleware: [mw], /*...*/ })
```
- before-hooks run in order; after-hooks in reverse; wrap-hooks onion-style (reduceRight)
- Custom middleware is appended after the built-in stack

> For the full middleware contract & extension patterns, see the [Chinese guide §7](./usage-guide.md#7-高级自定义中间件).

### 7.5 Server-side (Node.js) usage

The SDK core is **framework-agnostic JS** and runs in Node.js (headless mode) as a backend Agent (custom tool orchestration, doc fetching, subagent parallelism, self-verify).

**Server config essentials**:
- `ui: false` — headless, no ChatDialog (server has no DOM)
- `capabilities: { fetch: false }` — disable browser-dependent tools; dataOps body (`read`/`write`/`get`/`edit`/`delete`/`query`/`search`) works in Node (pass any `data.bind` object, no `window` needed); only `eval_script` needs Web Worker (disable via `capabilities:{dataOps:false}` if unused)
- `storage: 'memory'` — memory backend (server has no IndexedDB/localStorage); omit for non-persistent
- Inject business tools via `tools` (`defineTool`); drive via `send`/`stream`

**Example** (Node.js backend Agent + custom tool):

```ts
import { createChatSdk, defineTool, z } from 'page-agent-sdk'

const add = defineTool({
  name: 'add', description: 'Add two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: (args) => `${args.a + args.b}`,
})

const sdk = createChatSdk({
  container: null, ui: false, id: 'server-agent',
  storage: 'memory',
  llm: { apiKey: process.env.AI_API_KEY, baseUrl: '...', model: '...' },
  systemPrompt: 'You are a calc assistant; use add tool.',
  capabilities: { dataOps: false, fetch: false },
  tools: [add],
})
await sdk.mount()
const reply = await sdk.send('What is 3 plus 5?')
console.log(reply) // AI calls add → "3 + 5 = 8"
```

**Server-available**: custom tools / `fetch_document` (Node 18+) / subagents / verify / vfs / context compression / memory / onEvent / dataOps body (`read`/`write`/`get`/`edit`/`delete`/`query`/`search` — pass any `data.bind` object, no `window` needed)
**Server-unavailable**: ChatDialog UI (needs DOM) / `eval_script` (needs Web Worker) / IndexedDB·localStorage·sessionStorage (use `memory`)

> `eval_script` relies on Web Worker (part of dataOps, disable via `capabilities:{dataOps:false}`). MCP remote tools (http/sse/websocket) also work in Node (dynamic import `@modelcontextprotocol/sdk`).

### 8.6 Proxy Connection (prevent apiKey leakage)

Connecting to the LLM API directly from the browser exposes your `apiKey` in frontend code / network requests — anyone can grab it from DevTools and drain your quota. **Production must go through a server-side proxy**: the browser holds only a user token; your server injects the real `apiKey` and forwards to the LLM API.

The SDK provides a `createProxyLlm` factory to unify both access modes, so dev/prod switching needs no code restructuring:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

// ===== Production: proxy mode (safe) =====
// Browser holds only userToken; server injects real apiKey and forwards
const sdk = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'proxy',
    baseUrl: '/api/llm',        // your proxy URL (same-origin avoids CORS)
    userToken: getUserToken(),   // user session token (server validates, swaps in real key)
    model: 'deepseek-chat',
    temperature: 0.3,
    // optional: auto-refresh on 401 (called once, returns new token, retries)
    refreshToken: async () => (await fetch('/api/refresh')).json().then(r => r.token),
    // optional: extra headers (e.g. tenant id)
    headers: { 'X-Tenant': 'acme' },
  }),
  // ...other options
})

// ===== Dev: direct mode (convenient) =====
// Browser holds the real apiKey; local dev only (would leak in production)
const sdkDev = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'direct',
    apiKey: 'sk-xxx',            // real key (dev only)
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }),
  // ...other options
})
```

**Mode comparison**:

| | `proxy` (production) | `direct` (dev) |
|---|---|---|
| apiKey location | server (invisible to browser) | browser (visible in DevTools) |
| browser holds | userToken (session) | real apiKey |
| token refresh | supported (auto-retry on 401) | not needed |
| custom headers | supported | not needed |
| use case | production | local dev / intranet tools |

**Server-side proxy essentials** (your backend, not SDK):
- Receive browser request, validate userToken, inject real `apiKey`, forward to LLM API
- Handle CORS (same-origin is simplest, or set `Access-Control-Allow-*`)
- Stream SSE responses through (don't buffer streaming generation)
- Pass through tool-calling fields (`tools`/`tool_choice`/`tool_calls`)
- Optional: usage stats, rate limiting, per-user quota

> If `summaryLlm` (the dedicated summarization model) should also go through the proxy, build it with `createProxyLlm({ mode:'proxy', ... })` and pass to the `summaryLlm` option.

#### 8.6.1 Supported interface format

`createProxyLlm` uses `ChatOpenAI` internally, so **both modes require an OpenAI Chat Completions compatible endpoint**. The difference is only where the apiKey lives, not the protocol.

**Request** (browser → proxy):

```
POST {baseUrl}/chat/completions
Authorization: Bearer {userToken}      ← proxy mode: user token
Authorization: Bearer sk-xxx           ← direct mode: real key
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "..." }, ...],
  "tools": [...],          // tool-calling fields (optional)
  "tool_choice": "auto",
  "temperature": 0.3,
  "max_tokens": 16384,
  "stream": true           // SSE when streaming
}
```

> `ChatOpenAI` auto-appends `/chat/completions` to `baseUrl`, so pass `/api/llm` and the actual request hits `/api/llm/chat/completions`.

**Response** (proxy → browser), must be OpenAI-compatible:

Non-streaming:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{ "message": { "role": "assistant", "content": "...", "tool_calls": [...] }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
}
```

Streaming (SSE):
```
data: {"choices":[{"delta":{"content":"hello"}}]}
data: {"choices":[{"delta":{"tool_calls":[...]}}]}
data: [DONE]
```

**401 refresh** (proxy mode only): when the proxy returns `401`, the SDK auto-calls `refreshToken`, gets a new token, and retries the original request once.

**Non-OpenAI protocols**: Anthropic Claude (native `/v1/messages`) is supported **out of the box** — set `llm.provider = 'anthropic'` and the SDK dynamic-loads `@langchain/anthropic` (optional peer; see [Anthropic provider](#864-anthropic-claude-provider-out-of-the-box-228)). Other non-OpenAI protocols (e.g. Gemini `generateContent`) still require backend translation to OpenAI-compatible format; custom RPC / GraphQL likewise.

#### 8.6.2 Proxy server example (Node.js)

The repo ships a mock proxy server (`scripts/proxy-mock-server.ts`); run `npm run proxy:mock` to start it at `http://localhost:3002`:

- `POST /chat/completions` — validates `Authorization: Bearer {userToken}`, injects the real apiKey (read from server-side `.env` `VITE_AI_API_KEY`), forwards to the upstream LLM API (`VITE_AI_BASE_URL`), streams SSE through
- `POST /api/refresh` — token-refresh demo endpoint, returns a new token
- Demo token rules: `demo-token-xxx` works / `demo-token-expired` returns 401 to trigger refresh

Minimal viable proxy (production reference, Node.js native `http`):

```ts
import http from 'node:http'

const REAL_API_KEY = process.env.REAL_API_KEY  // server env var, browser can't see it
const UPSTREAM = 'https://api.deepseek.com/v1'

http.createServer(async (req, res) => {
  // CORS (dev cross-origin; production prefers same-origin, remove this)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url !== '/chat/completions' || req.method !== 'POST') {
    res.writeHead(404); res.end('not found'); return
  }

  // 1. validate user token
  const userToken = req.headers.authorization?.slice(7)
  if (!userToken || !await verifyUserToken(userToken)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid token' } }))
    return
  }

  // 2. read body
  const body = await new Promise<Buffer>(r => {
    const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c)))
  })

  // 3. inject real apiKey and forward (pass through tools/tool_calls/stream)
  const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REAL_API_KEY}` },
    body,
  })

  // 4. stream response through (pipe SSE chunks, don't buffer)
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
  if (upstream.body) {
    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    while (true) { const { done, value } = await reader.read(); if (done) break; res.write(dec.decode(value)) }
  }
  res.end()
}).listen(3002, () => console.log('proxy @ 3002'))

async function verifyUserToken(token: string): Promise<boolean> {
  // plug in your auth: JWT verify / session lookup / user table query …
  return token.startsWith('demo-token-')
}
```

**Production deployment notes**:
- The real apiKey lives only in server env vars (or a secret manager) — **never** ship to the browser, never commit to git
- Same-origin deployment (`/api/llm` shares the frontend domain) avoids CORS; cross-origin needs `Access-Control-Allow-*`
- Stream responses with `pipe` chunk-by-chunk; don't `await res.json()` and buffer (breaks streaming generation)
- Pass through `tools`/`tool_choice`/`tool_calls` fields (the Agent's tool calling depends on these)
- Optional: meter usage by userToken, rate-limit, per-user quota, audit logs

#### 8.6.3 Full example page

The repo's `examples/proxy-demo/` provides a complete runnable example:

```bash
# Terminal 1: start the proxy server (reads the real apiKey from .env)
npm run proxy:mock
# → http://localhost:3002, real apiKey stays server-side

# Terminal 2: start dev
npm run dev
# → open http://localhost:3000/examples/proxy-demo/
```

The example page demonstrates:
- The browser holds only a `userToken` (`demo-token-xxx`); DevTools can't see the real apiKey
- Switch to `demo-token-expired` → send a message → 401 → the SDK auto-calls `refreshToken` to refresh and retry (the UI shows the refresh count)
- An extra `X-Tenant` header demonstrates custom-header pass-through

## 8. Framework-agnostic / CDN

See `demo/plain.html` (importmap + esm.sh providing peer deps). IIFE one-liner:

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
  createChatSdk({ /*...*/ }).mount()
</script>
```

Headless (`ui:false`): no built-in dialog; use `agent.messages` (reactive array) + `send`/`stream` to build your own UI — fully framework-agnostic (no Vue forced).

#### 8.6.4 Anthropic Claude provider (out of the box, 2.28+)

Besides OpenAI-compatible protocols, the SDK supports Anthropic Claude's native protocol out of the box (`provider:'anthropic'` dynamic-loads `@langchain/anthropic`, optional peer):

```ts
createChatSdk({
  llm: {
    provider: 'anthropic',          // Claude native protocol (default 'openai' = OpenAI/DeepSeek, backward-compatible)
    apiKey: 'sk-ant-xxx',
    model: 'claude-sonnet-4-5-20250929',
    baseUrl: 'https://api.anthropic.com',  // optional, official by default; custom gateway here
    cacheControl: true,             // prompt caching (optional): true = ephemeral 5m / '1h' = long TTL, see note below
  },
}).mount()
```

> - **Prompt caching (`cacheControl`, Anthropic-protocol only)**: ReAct rounds re-send the full prefix (system + tool defs + history) every turn; `cacheControl: true` forwards the top-level `cache_control` via langchain `invocationKwargs` — the server places breakpoints automatically and advances them as the conversation grows. Prefix cache hits cut input price to **~1/10** (writes 1.25x, 5m/1h TTL). Observe via `cache_read_input_tokens`/`cache_creation_input_tokens` on usage events / `sdk.usage` (present only when the endpoint reports them). **Endpoint support varies (tested 2026-08)**: the modelverse gateway honors caching on **non-streaming** calls (measured: 2048 of a 2787-token prefix served from cache on round 2) but **not streaming** (the SDK always streams → no benefit on that gateway today; the config is harmless); official api.anthropic.com reports cache fields on streaming. OpenAI/DeepSeek endpoints cache automatically and are unaffected by this switch
> - `@langchain/anthropic` is an **optional peerDep** — install only when using Anthropic (`npm i @langchain/anthropic`); projects not using Anthropic are unaffected (dynamic import loads only in the `provider:'anthropic'` branch)
> - `setLlm` to Anthropic requires a `BaseChatModel` instance (dynamic import can't be synchronous): `const { ChatAnthropic } = await import('@langchain/anthropic'); sdk.setLlm(new ChatAnthropic({ apiKey, model }))`; passing `LLMConfig + provider:'anthropic'` throws a clear hint
> - **IIFE (CDN `<script>`) does not support Anthropic** (browser has no importmap to resolve the bare specifier); use npm (ESM/UMD) for Anthropic. The CDN bundle does not bundle `@langchain/anthropic` (defaults to OpenAI/DeepSeek)
> - Proxy mode `createProxyLlm` stays OpenAI-only (Bearer is an OpenAI-protocol header); for Anthropic use the main `llm` direct connection or a pre-built `ChatAnthropic` instance

### 6.15 UI customization & i18n (icons / theme / language / message overrides, 3.17+–3.21+)

The built-in dialog is fully customizable without forking — four knobs, all in the `dialog` group:

```ts
createChatSdk({
  dialog: {
    theme: 'dark',                        // ① built-in theme: 'dark' (default) / 'light'; or override --cs-* vars for full control
    icons: { header: '🦈', send: '🚀' },   // ② per-icon override (plain emoji/char, or an HTML fragment starting
                                          //    with '<' — sanitized via the DOMPurify icon allowlist; empty string
                                          //    hides; unset keys keep defaults; header-button keys
                                          //    newSession/history/more/close work the same, default = built-in SVG)
    headerLabels: true,                   // ⑤ adaptive header-button text labels (default true): when wide enough
                                          //    (header content ≥440px ≈ dialog ≥472px) buttons show text+icon,
                                          //    narrower falls back to icon-only; false = always icon-only.
                                          //    Text comes from the i18n newSession/history/more keys
    toolStepView: (s) =>                  // ⑥ tool-step display mapper (pure display-layer interceptor):
      s.name === 'write'                  //    raw tool name → business-friendly wording; receives
        ? { title: 'Edit page', detail: (s.args as any)?.jsonPath ?? (s.args as any)?.patch?.jsonPath }
        : s.name === 'read' ? { title: 'Read page data' } : undefined,  // undefined = keep raw name
  },
  i18n: {                                 // ③④ top-level i18n group (3.22+; former dialog.locale/messages merged here)
    locale: 'en-US',                      // ③ switch the whole message pack ('zh-CN' default): chat surface +
                                          //    Debug drawer + Skill panel + code preview; formatTime (12h/24h)
                                          //    and autoTitle follow; the **default systemPrompt switches to
                                          //    English** (with a "Respond in English" anchor, so agent replies
                                          //    match the UI language; a custom systemPrompt is untouched, but the
                                          //    auto-appended reliableWriteRules segment goes English)
    messages: { statusDone: '<b style="color:#10b981">Done ✓</b>' },  // ④ per-key overrides (priority over the
                                          //    locale pack): tweak only the keys you want; rich-text render spots
                                          //    accept inline HTML fragments (text allowlist sanitized); stacks
                                          //    with locale (en UI + local tweaks)
  },
})
```

**Key points**:
- **Priority chain**: `messages overrides > locale pack > zh-CN fallback` — no key is ever missing; miss-configured keys fall back, no mixed languages
- **Key space** ~226 keys (title/placeholder/status labels/buttons/confirm/conflict/focus/Debug tabs/Agent-info kvs/Skill form/code preview); full list in the `DialogMessages` interface in `types/index.d.ts`
- **HTML rich-text spots**: message values starting with `<` on status labels/title/thinking/empty greeting/confirm & conflict/retry-undo buttons render as inline HTML, sanitized via a text allowlist (b/em/u/s/span/mark/code + class/style); title/placeholder attribute spots and concatenation keys (prefix/suffix) stay plain text (HTML shows literally); `sanitizeMessageHtml` is exported to inspect the sanitized result
- **Custom-UI reuse** (headless): `MESSAGES_ZH_CN` / `MESSAGES_EN_US` / `resolveDialogMessages(locale, partial)` are all exported from the entry — drive your own UI with the same packs
- **Adaptive header-button text labels** (⑤): pure CSS container queries — when the header content area is ≥440px wide, "New chat / History / More" show text+icon (close stays icon-only); narrower widths fall back to icon-only automatically. Browsers without `@container` support always get icon-only (= graceful degradation to the old look). Label text = i18n keys (`newSession`/`history`/`more`, overridable via `messages` like any key); label icons = the four same-named `dialog.icons` keys
- **Unified scrollbar replacement** (3.27): the main scroll surfaces (message area + Debug drawer log area) are taken over by [OverlayScrollbars v2](https://github.com/KingSora/OverlayScrollbars) — native scrollbars hidden, replaced with thin overlay scrollbars (native scrolling/keyboard/touch preserved, auto-follows content growth); no dialog-level horizontal scrolling (long code lines stay inside the code block); remaining small scroll areas fall back to thin native scrollbars. Handle color overridable via `--cs-scrollbar-thumb(-hover)` (dark theme built in)
- **Tool-step display mapper** (⑥, `dialog.toolStepView`): raw tool names (read/write/use_html …) are often meaningless to end users → map them to business-friendly names/content. **Pure display layer** — never affects the tool names/protocol/validation sent to the LLM, only the MessageSteps step-row rendering; subagent steps (child progress rows) map too; the expanded args/result detail panel stays **raw data** (troubleshooting channel untouched). Rules: returning `undefined`/omitting falls back to the raw tool name; `detail` shows only for single calls (a merged ×N group may have heterogeneous args — showing one detail would mislead); the merge key is the mapped title (same tool mapping to different titles → separate rows); re-invoked with fresh inputs when status flips running→done or args arrive (dynamic detail follows); mapper exceptions are safe (fall back to the raw name, rendering never breaks). **`detail` receives raw args** — translate them into business labels yourself: e.g. resolve `components.5.children.1` against your host data into "carousel(carousel)" (see the `compLabel` demo in `examples/page-demo`), so end users never need to understand jsonPath
- **History "delete session" button icon**: `dialog.icons.sessionDelete` (default ✕ text; pass `<img src="…" width="12" height="12">` for a custom image)
- The **English default systemPrompt** is exported separately: `DEFAULT_SYSTEM_PROMPT_EN` + `systemPromptHelpers.reliableWriteRulesEn` (handy when writing your own English prompt)
- Full example: `examples/i18n-demo` (en locale + statusDone/emptyGreeting HTML overrides)

### 6.17 Image input (multimodal direct / captioning bypass)

The dialog has built-in image input: three entry points (📎 pick / drag / paste screenshot) → compression gate → sent with the next message. **How the image travels depends on whether the main model has vision** — decided automatically across three branches:

| Main model | Detection | Behavior |
|---|---|---|
| Multimodal (gpt-4o / gpt-4.1 / gpt-5 / claude / qwen-vl / glm-4v…) | model-name table `vision:true`, or explicit `llm:{ vision:true }` | **zero-config direct send**: images are assembled into content parts (OpenAI protocol `image_url` / Anthropic protocol base64 `image` block, adapted per provider) |
| Text-only (deepseek-chat etc.) | `vision:false` + `images.describe` configured | **captioning bypass**: before sending, each image goes through the integrator's vision endpoint; the caption is appended to that round's user context as `[图片 N 描述]` — the image itself is never sent to the main model |
| Text-only, no describe | `vision:false` and no describe | **honest rejection**: send fails with guidance (switch to a multimodal model / declare `vision:true` / configure describe); images are never silently dropped |

```ts
createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl, model: 'my-proxy-model', vision: true },  // ① declare multimodal explicitly when a gateway proxy name is unrecognizable
  // images: {                                                       // ② bind a captioning capability for text-only main models (vision stays the integrator's)
  //   describe: async (image, { text }) => {
  //     const res = await fetch('/my-vision-api', {
  //       method: 'POST', body: JSON.stringify({ image: image.dataUri, question: text }),
  //     }).then(r => r.json())
  //     return res.description
  //   },
  //   describeTimeoutMs: 15000,   // default 15s; timeout/failure → placeholder caption + observable VISION_DESCRIBE_FAILED, conversation continues
  // },
})
```

**Compression gate & limits (input side, all automatic)**: files >20MB rejected; long edge scaled down to ≤1568px; jpeg q0.85 (kept as png when an alpha channel is present); SVG decoded via an Image fallback; ≤4 images per round. Failures raise structured error codes (`IMAGE_TOO_LARGE` / `IMAGE_COUNT_LIMIT` / `IMAGE_DECODE_FAILED` / `IMAGE_COMPRESS_FAILED` / `IMAGE_UNSUPPORTED_TYPE`), surfaced right in the input area.

**Lightweight persistence**: persisted messages only keep a thumbnail (≤8KB) + a vfs reference; the original goes into the vfs `userImages/*` pool (LRU-evicted — after eviction a refresh just degrades to thumbnails, no crash); with `images.upload` configured, only an https URL is stored.

**Optional `images.upload` (swap original for a URL; works for both branches)**: with your own OSS, the compressed original is uploaded through this hook and returns an https URL — requests and persistence then carry only the light URL (no large base64 payloads, no vfs pool usage); upload failure automatically falls back to inline dataURI with a logged note, never blocking.

**Notes**:
- `vision` precedence: explicit declaration (true or false overrides) > model-name table > default false (conservative: mistakenly sending parts and eating a 400 is worse than taking the bypass); re-evaluated on `setLlm`
- captions persist with the message — resends and session restores never re-caption
- headless custom UI: `sdk.send(text, { images })` (≤4); build image objects with the exported `compressImage(file)` (browser)
- full runnable example: `examples/images-demo` (describe bound to an "analyze-form" vision endpoint: POST `{image: base64, mime}` → `{data:{description}}`; the endpoint URL lives only in the local `.env` as `VITE_VISION_URL`, with a `window.__VISION_CONFIG` runtime override for testing)

## 9. Environment variables

`.env` (VITE_ prefix):

```bash
VITE_AI_API_KEY=sk-...
VITE_AI_BASE_URL=https://api.deepseek.com
VITE_AI_MODEL=deepseek-chat
VITE_AI_TEMPERATURE=0.3        # low temp for structured ops
# VITE_AI_MAX_TOKENS=           # omit → model default
VITE_AI_SYSTEM_PROMPT=...       # must be single-line
```

## 10. FAQ & gotchas

**Q: Model returns `400 missing field tool_call_id`?**
A: LangChain `ToolMessage` uses snake_case `tool_call_id` (not camelCase). The SDK handles this internally; if you build messages manually, use `tool_call_id`.

**Q: Error like `model [x] is offline / not support for model` (400)?**
A: The model is unavailable on your gateway/provider (offline or not offered). The SDK detects this shape, tags it `code:'MODEL_UNAVAILABLE'`, and appends actionable guidance to the error message (switch the model name and `setLlm`, or check the gateway's model list). The main path still surfaces it as fatal (4xx is never retried); when a subagent delegation fails this way, the guidance flows back with the error result so the main agent can stop instead of re-delegating blindly. Known blind spot: gateways that return **200 + a non-SSE error JSON body** surface as `EmptyLLMResponseError` instead — the offline text cannot be detected there. Use the exported `isModelUnavailableError(err)` in your own `onEvent` for custom handling.

**Q: Console says "capabilities.X 已列入移除计划" (scheduled for removal)?**
A: **`tracing` / `skillHostScript` / `preferences` / `bulkGuard` were all removed in 4.1.0** (leftover keys silently ignored, zero warns; tracing migration → `debugLogs` + `exportDiagnostics`; `exec.context:'host'` residual values run in the sandbox — semantics reversed; leftover preference data in indexedDB can be cleared via DevTools by deleting `v:1::pref-store::*` keys). `todoDeps` has been removed (leftover keys silently ignored).

**Q: `ChatOpenAI` param errors?**
A: Use `apiKey` (not `openAIApiKey`), `model` (not `modelName`); `baseUrl` goes via `configuration.baseURL`.

**Q: DeepSeek `baseUrl` — with or without `/v1`?**
A: Both work for DeepSeek (OpenAI-compatible). `https://api.deepseek.com` or `https://api.deepseek.com/v1` are both fine.

**Q: Multi-agent on one page?**
A: Give each `createChatSdk` a distinct `id`; they isolate by id. Same `id` + `shareContext:true` → share one agent (multiple dialog views). Shared instances are coordinated by a core-level serial gate: send/switchSession queue across instances; any instance's lifecycle convergence (unmount/switchSession/resetSession) aborts ALL in-flight streams of the shared core (shared state allows no orphan streams).

**Q: Persistence not resuming after refresh?**
A: `id` must be a stable value (not omitted — random id can't resume). `storage` must be enabled (default off).

**Q: Large JSON blows context?**
A: Tool results > 6000 chars auto-offload to vfs (only preview + `vfs_read`/`vfs_grep` refs stay). `write` with `patch` to avoid re-sending whole JSON.

**Q: `verify` not taking effect?**
A: Verify is off by default (token cost). It auto-enables when you pass `verify.check` / `verify.maxAttempts` / `verify.adversarial`; explicit `capabilities.verify: false` blocks auto-enable, and `verify.enabled: false` forces off. `inspect().verify` shows load status.

> More FAQs in the [Chinese guide §11](./usage-guide.md#11-常见问题与坑).

## 11. Use-case index (end-to-end scenarios)

Nine end-to-end scenarios with copy-paste code live in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/use-cases.md` (also shipped in the npm package; install the skill per README "Skills for AI tools"):

| # | Scenario | Key setup |
|---|---|---|
| 1 | Low-code page builder | `data` = component tree; `write` with `patch` jsonPath; `onEvent` → canvas refresh; `checkpoint` + `approval` |
| 2 | Form designer | `data` = field defs (enum/required schemas); schema validation prevents malformed forms |
| 3 | CMS batch ops | `eval_script` bulk loops; `search_data` filter; `write` with `patch` targeted edits |
| 4 | Ops config console | `approval` human-confirm; `capabilities.verify:true` write-back read; `checkpoint` |
| 5 | AI-native assistant | `capabilities:{dataOps:false,fetch:false}` + custom `tools` (product API) |
| 6 | Research agent | `capabilities:{dataOps:false}`; `subagent:{allowedTools:['fetch_document']}`; `contextPreset:'conservative'` |
| 7 | Server-side Node.js | `ui:false` + `storage:'memory'` + `capabilities:{dataOps:false,fetch:false}`; drive via `sdk.send` |
| 8 | Multi-agent on one page | same `id` + `shareContext:true` → multiple dialogs share one `AgentCore` |
| 9 | MCP integration | `mcp:[{transport,url}]` remote tools; `@modelcontextprotocol/sdk` optional peerDep |
| 10 | Multi-agent parallel + exclusive switch | multiple `createChatSdk` (distinct `id`, each its own `data`) + `dialog.drawer:true`; switch via `hide()`/`show()` (keeps each history/in-flight generation, no unmount) |

Runnable demos per scenario: `examples/nested-demo` (1), `examples/page-demo` (1/2), `examples/subagent-demo` (6), `examples/rag-demo` mode D (9), `examples/human-confirm-demo` (4), `examples/planner-demo` (planning), `examples/toolsets-demo` (tool separation), `examples/animation-demo` (animations + hide/show), `examples/multi-agent-demo` (multi-agent parallel + exclusive switch).

### Multi-agent parallel + exclusive switch

A single page can host multiple independent agents (each `createChatSdk` + distinct `id` for isolation), each managing its own `data`/history/tools, running their own generation tasks in parallel; exclusive chatbox switching uses `dialog.drawer` + `hide()`/`show()` — `hide` the old one (keeps agent/history/in-flight generation), `show` the new one (history resumes), no unmount, no lost conversation:

```ts
const agents = [
  createChatSdk({ id: 'agent-a', container: boxA, dialog: { drawer: true }, data: { schema: schemaA, bind: objA }, ... }),
  createChatSdk({ id: 'agent-b', container: boxB, dialog: { drawer: true }, data: { schema: schemaB, bind: objB }, ... }),
  createChatSdk({ id: 'agent-c', container: boxC, dialog: { drawer: true }, data: { schema: schemaC, bind: objC }, ... }),
]
await Promise.all(agents.map(a => a.mount()))  // three independent agents ready in parallel
agents.slice(1).forEach(a => a.hide())         // show only the first initially

let active = 0
function switchTo(i: number) {
  agents[active].hide(); active = i; agents[i].show()  // exclusive switch, each history preserved
}
```

**Key points**:
- Distinct `id` for isolation: each independent agent instance/history/tools/storage, no cross-talk
- Each managing its own `data` object has no conflict; multiple agents operating on the same `data` need coordination (optimistic lock `conflictWatchFields` or `jsonPath` partitioning)
- `hide()` does not unmount vueApp / does not release agent — keeps chat history and in-flight generation; `show()` resumes visibility
- If switch buttons sit under the drawer mask, raise their `z-index` (above mask `9998` + ChatDialog `9999`) to stay clickable

Full example: `examples/multi-agent-demo/`.

### Drawer mode width + hidden by default (click button to show chatbox)

In drawer mode (`dialog.drawer: true`), you can customize the chatbox width and support "hidden by default after mount, shown on button click" scenarios:

```ts
const sdk = createChatSdk({
  id: 'my-agent', container: '#box',
  dialog: {
    drawer: true,             // drawer mode
    drawerWidth: 500,          // width 500px (also accepts '500px' / '40vw' / '50%' etc.); default 420
    drawerHidden: true,        // hidden after mount; requires sdk.show() to display
  },
  llm, data: { schema, bind },
})
await sdk.mount()            // mounted but invisible (drawerHidden takes effect)

// Click button → show chatbox
document.querySelector('#open-chat-btn')!.addEventListener('click', () => sdk.show())
// Close button/mask click → defaults to hide() (keeps agent/history/in-flight generation); show() again resumes
```

**Key points**:
- `dialog.drawerWidth`: pure numbers treated as `px`; strings passed through as-is (supports `vw`/`%` etc. responsive units); only effective when `drawer: true`; inline mode width determined by `container`
- `dialog.drawerHidden`: calls `hide()` immediately after `mount` (adds `cs-hidden` class, invisible but vueApp/agent ready); first `show()` removes the hidden class; subsequent `hide()`/`show()` toggles visibility
- Close button/mask click defaults to `hide()` in drawer mode; pass `dialog.onClose` to customize close behavior

**Advanced extensibility examples** (custom tools / skills / subagents / MCP) in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/advanced.md`: copy-paste code for `defineTool` (error handling + coexisting with dataOps), `defineSkill` (inline content + remote doc), subagents (ad-hoc `spawn_agent`/`spawn_agents` + pre-declared `subagents` → `use_<id>`), MCP (http/sse/websocket + auth + dev gotcha).
