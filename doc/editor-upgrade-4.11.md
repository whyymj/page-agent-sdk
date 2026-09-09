# editor 宿主升级 4.11.0 采用包(集成方 checklist)

> 面向 editor_fangzhou 等已集成宿主,从 4.8/4.9(或更早)升级到 4.11.0。
> 一页读完:环境坑 → 变更面 → 新功能采用点 → 升级后验证。细节链接到 usage-guide 对应章节。

## 1. 升级步骤与 npm 环境坑

```bash
# ① 本机 PATH 切到项目配套 node(宿主侧 node10):npm10 会重写 lockfile v3 + 自动装 peer,别用新 npm 动老 lockfile
# ② 公司源对新包可能 ECONNRESET:换官方源重装
npm i page-agent-sdk@4.11.0 --registry=https://registry.npmjs.org/ --no-package-lock --legacy-peer-deps
# ③ oniguruma 原生编译警告是假警报(不阻塞);ENOTSUP 曾是 SDK dependencies 配置问题,fab1307 起已修
```

## 2. 变更面速览(断点 + 已修但你可能撞过的坑)

**断点(Breaking,按你的起始版本核对)**:

| 版本 | 移除/破坏 | 影响判定 |
|---|---|---|
| 4.0 | `get/set/edit/delete_data` 四工具 | 只影响依赖工具名的自定义逻辑(permissions 名单/verify 配置);按语义改 read/write |
| 4.1 | `tracing`/`skillHostScript`/`preferences` 配置 | 残键静默忽略;`skillHostScript` 的 exec.context 残值会落沙箱执行(语义反转,如有用需改) |
| 4.9 | `describe_data` 工具 | 与 `read({})` 等价,真 LLM 连续三版 0 调用;工具名名单里有它的去掉即可 |
| 4.10/4.11 | 无破坏 | 全部 opt-in 新增 |

**4.9→4.11 透明修复(不用改配置,升完即得,按你可能撞过的坑对号)**:

- 调序后聚焦/保护错元素 → 焦点值锚定(锚 `__pgId` 不锚下标)
- 长 agent 会话被过早压缩 → 压缩估算改 wire 口径
- RHC/approval/冲突挂起时输入死局 → 挂起期禁发 + 提示(停止按钮仍是逃生口)
- markdown 宽表格把宿主布局挤没 → 对话框 `contain: inline-size`
- 「你能修改…么」类问句触发未要求的改动 → 问句意图守卫 + 门禁豁免两连修
- 分块写大代码(set 首块 + append 逐块)三形态静默丢块/误拒/双写 → 同批 set+append 修
- `eval_script` transform 模式绕过乐观锁 → 三模式补齐 commit 位
- `restore_data` 会把 freeze/verbatim 宿主字段洗回旧值 → 选择性回退
- 组件被锁拒后模型谎报完成 → 零工具门禁计被拒委派 + 事实清单回灌
- 卡在等人工确认零线索 → `approval_pending`/`approval_resolved` 留痕(`exportDiagnostics` 可见)

## 3. 新功能采用点(全部 opt-in,不配零成本)

### 3.1 快捷指令 `dialog.quickActions`(4.10)
输入区顶部固化高频操作 chips,点击直接发送完整 prompt:
```ts
dialog: {
  quickActions: [
    { label: '加一个 banner', prompt: '在页面顶部加一个通栏 banner' },
    { label: '🎨 换主题', prompt: '把主题换成 dark', icon: '🎨' },  // icon 可省,label 里带 emoji 也行
  ],  // ≤8 条,缺 label/prompt 自动过滤
}
```

### 3.2 write 审批 diff 预览 `approval.preview`(4.10,默认 false)
已配 `approval: { tools: ['write'] }` 的话,一行开关让审批条显示结构化 old→new(含「批了也会被 schema 拒」的预拒原因):
```ts
approval: { tools: ['write'], preview: true }
```

### 3.3 会话导出/导入 `dialog.sessionTransfer`(4.10,默认 false)
历史面板底部出现「导出会话/导入会话」(支持 vfs/todos/mission/focus 全量 kind;导入恒生成新 sessionId 副本语义)。**前置:storage 已开启**(indexed 等);API 层 `sdk.exportSession()/importSession(data)` 可自建 UI。编辑器「会话迁移/用户反馈带日志排查」场景直接可用。

### 3.4 画布元素拖入聚焦 `dialog.onDropElement`(4.10)
编辑器画布选中联动之外的新入口 —— 画布组件拖进聊天框即聚焦:
```ts
dialog: {
  onDropElement: (el) => {
    const path = el.closest('[data-path]')?.getAttribute('data-path')  // 画布渲染时挂 data-path=jsonPath
    if (path) agent.addFocus({ path, label: '画布组件' })
  },
}
```
SDK 侧只负责 window 捕获 dragstart 记源元素 + drop 分流(files 优先走图片通道);el→jsonPath 映射归宿主。参考实现 `examples/page-demo`(组件根 `draggable="true"` + `:data-path`)。

### 3.5 升级前自跑回归 eval-toolkit(4.11)
升级前为自己的核心场景留 token/工具数基线,升完对比(▲ 疑似回归就别急着上):
```ts
import { createEvalHarness, diffReport } from 'page-agent-sdk'  // headless 子路径同带
const h = createEvalHarness({ sdk })
await sdk.send('固定场景指令')                      // 场景 prompt 固定才有可比性
await h.waitForIdle({ baselineMessageCount, timeoutMs: 300_000 })
const report = h.collectReport()                     // { messageCount, toolCount, usage, elapsedSec }
diffReport(current, savedBaseline)                   // token ±15% 且 ±2000 / toolCount ±3
```
业务断言(数据真改了吗)集成方自己做。整页可抄示例 `examples/eval-demo`(回归面板,基线存 localStorage)。详见 usage-guide §6.19。

### 3.6 服务端/无人值守(node 同构,4.11)
服务端批量生成/定时任务场景:`page-agent-sdk/headless` 同一套契约,无人值守组合 = `approval.timeoutMs`(无响应自动拒)+ `conflictPolicy: 'overwrite'` + `conflictWatchFields` 武装 + `sdk.batch([...])`。详见 usage-guide §9.1 / §8.5。

## 4. 升级后验证清单

- [ ] npm i 成功,`node -e "require('page-agent-sdk/package.json').version"`(或 ESM import)报 4.11.0
- [ ] 核心场景手工过一遍:画布组件增/删/改/调序、聚焦后子路径写、审批流(若配了)、刷新会话恢复
- [ ] eval-toolkit 固定场景跑一轮存基线(下次升级对比的锚)
- [ ] 控制台无新增告警(装配期 warn 会写 console.info/warn,坏配置不静默)

---
*SDK 侧变更全量明细见 CHANGELOG.md;本文只覆盖宿主升级视角。*
