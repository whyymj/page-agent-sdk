# Proposal: editor-local-draft-restore(编辑器本地草稿恢复:agent 改动刷新不丢)

> 状态:**规划完成待实施**。优先级 P1(editor 侧)。目标仓库:editor_fangzhou。
> 驱动:2026-08-21 三份真 LLM 会话诊断实证的「刷新即丢」—— agent 写入 `Editor.nodeInfo` 的改动只存在于内存,dev server 重启 / 页面刷新 / HMR 全页 reload 后回到服务端状态,用户看到「说干完了,页面是空的」(诊断 msg[19/24/33/37] 反复出现「没看到效果/没有保存成功」,agent 反复重做,烧了大量 token 与用户信任)。

## Why(现状核实,2026-08-21)

`Editor.vue` 已有完整暂存写入链,但**读链断裂**:

| 环节 | 现状 | 证据 |
|---|---|---|
| 暂存写入 | ✅ `deep watch nodeInfo → doSave` 防抖 500ms → `localStorage[EditorautoSave_<projectKey>_<pageKey>]` | Editor.vue:214-218, 605-619 |
| 历史记录 | ✅ `HistoryCache.add`(Cmd+Z 回退可用) | doSave 内 |
| **页面加载** | ❌ `loadPageInfo` 只拉服务端 `editor/pages/editor-detail` → `nodeInfo = cloneDeep(info)`,**localStorage 草稿从未被读** | Editor.vue:455-522 |
| 保存到服务端 | ✅ save_page(savePage → `pageInfo.save`,已有 approval 确认) | pageData.js:544 |

即:agent(或用户手动)的一切未保存改动,刷新后必丢。这不是 SDK 问题,是编辑器自身草稿恢复缺失——手动编辑用户其实也踩(改了半小时没点保存,刷新全没),只是 AI 场景把频率放大了(agent 改动高频 + dev 环境 HMR 频繁)。

## What Changes

### 1. 加载时本地草稿优先恢复(loadPageInfo 补读链)

`loadPageInfo` 拉到服务端 `info` 后,读 `localStorage[STORAGE_KEY]`:

- **本地草稿比服务端新且内容不同 → 采用本地,顶部横幅提示**「检测到本地未保存的修改(约 X 分钟前),已恢复;[丢弃并使用线上版本] [保存到服务器]」——两个动作按钮,不自动保存(保存须走 save_page 的 approval 语义)
- 本地无草稿 / 与服务端一致(内容 hash 相同)→ 现状直用服务端版
- **「新」的判定**:草稿条目带 `savedAt` 时间戳(doSave 写入时顺手带上,向后兼容:无时间戳的老条目只在内容与服务端不同时视为候选)+ 内容 hash 与服务端不同。两者都满足才恢复,防「服务端已被别人保存了新版本,本地旧草稿反向覆盖」

### 2. doSave 草稿条目加元数据

```js
window.localStorage.setItem(me.STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), content }))
```

- 读取处兼容两种形态(老格式裸 content 字符串 / 新格式 `{savedAt, content}`)
- savePage 成功后**清掉时间戳**(保留内容——与服务端一致了,下次加载 hash 相同不触发恢复提示)

### 3. socket 多人编辑冲突交互不变

`edit-conflict` 弹窗强刷场景:强刷后本地草稿恢复逻辑照常工作(这正是多人场景下保护自己改动的最后防线;现有 `location.reload()` 行为不动)。

## Impact

| 项 | 变更 |
|---|---|
| `Editor.vue` loadPageInfo | +本地草稿比较与恢复(约 40 行) |
| `Editor.vue` doSave | 草稿条目加 savedAt(3 行) |
| SDK | **零改动**(纯 editor 侧) |
| 兼容 | 老格式草稿兼容读取;demoMode(本地无 key)不受影响 |

## 风险与对策

- **误恢复旧草稿覆盖别人已保存的新版**:「新」判定双条件(savedAt + 内容 hash 不同)→ 别人保存后服务端 hash 变了,本地若更旧(savedAt < 服务端返回的 updateTime)不恢复;拿不到服务端时间时降级为「只提示不自动恢复」,用户手点确认
- **localStorage 容量**(草稿含大段 compCode 代码):编辑器现状本就存裸 content,新格式只加一个时间戳字段,量级不变;超容量的既有异常路径不变
- **首次上线误判面**:恢复仅「横幅提示 + 用户选择」,无静默覆盖——最坏情况是横幅多弹一次

## 验收(手动 + 真 LLM)

1. 手动:改页面不保存 → 刷新 → 横幅出现 + 改动恢复;点「丢弃」→ 回服务端版
2. 真 LLM:AI 面板让 agent 加组件 → 刷新页面 → 横幅 + 组件还在;再问 agent「页面有什么组件」→ 它 read 到的含新组件(不再出现「没看到效果」循环)
3. 多人:两个 tab 编辑,一端保存后另一端刷新 → 不误恢复旧草稿(双条件判定)

## 非目标(Non-goals)

- 不做自动保存到服务端(保存仍须用户经 save_page 确认;自动推送服务端 = 把未确认改动发线上,违背 approval 语义)
- 不做草稿多版本/时间线(localStorage 单条,够用;多版本是 HistoryCache 的职责)
- 不改 SDK(3.40.x 的状态询问门禁已治「谎报」;本 change 治「真丢」)
