// fix-authorization-surface e2e:子 agent 授权面运行时验证(真跑 ReAct 循环,stub model 驱动)
//  - P1-16:子栈继承 approval —— 子 write 触发 approval_request 直通转发 → 收口后写入/拒绝不落盘
//  - P1-16:spawn 自授框架/写工具被剥离 —— 子调 use_<id>/load_skill 报「工具不存在」
//  - P0-1 + P1-15:子 agent allowedTools 解析中间件工具(vfs_*) + 子 offload 经 vfs-bridge 落主池(主 vfs_ls 可见)
import { setupEnv, createAssert, createChatSdk, z, defineTool } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:authorization-surface] P1-16 子栈继承 approval(允许分支:确认后写入生效)')
  {
    const bind = { title: '旧标题' }
    // 队列序:① 主调 use_worker ② 子调 write(被继承的 approval 拦) ③ 子文本收口 ④ 主文本收口
    const llm = stubModel(
      { toolCalls: [{ name: 'use_worker', args: { task: '把标题改成新标题' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '新标题' } } }] },
      { text: '子任务完成' },
      { text: '已完成' },
    )
    const approvals = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auth-approve', storage: false, llm,
      data: { schema: z.object({ title: z.string() }), bind },
      approval: { tools: ['write'], humanConfirmTool: false },
      capabilities: { ...CAPS, vfs: false },
      subagents: [{ id: 'worker', description: '测试工人', writablePaths: ['title'] }],
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request') { approvals.push(e); e.resolve(true) }  // 模拟用户在 ApprovalBar 点允许
    })
    assert(approvals.length === 1, '✓ 子 agent write 触发 approval_request 直通转发到主流 handler(原:子栈无 approval 直接绕过)')
    assert(approvals[0]?.toolName === 'write', '✓ approval_request.toolName = write(子继承主 approval 配置)')
    assert(bind.title === '新标题', '✓ 允许后子 write 落盘 bind(继承链完整:guard 包装 → approval → 执行)')
    sdk.unmount()
  }

  console.log('[e2e:authorization-surface] P1-16 子栈继承 approval(拒绝分支:写入不落盘)')
  {
    const bind = { title: '旧标题' }
    const llm = stubModel(
      { toolCalls: [{ name: 'use_worker', args: { task: '改标题' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '被拒写入' } } }] },
      { text: '子任务完成(写入被拒)' },
      { text: '已完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auth-reject', storage: false, llm,
      data: { schema: z.object({ title: z.string() }), bind },
      approval: { tools: ['write'], humanConfirmTool: false },
      capabilities: { ...CAPS, vfs: false },
      subagents: [{ id: 'worker', description: '测试工人', writablePaths: ['title'] }],
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request') e.resolve(false)  // 模拟用户拒绝
    })
    assert(bind.title === '旧标题', '✓ 拒绝后子 write 不落盘(approval 收口 → 子收 error,委派闭环不挂死)')
    sdk.unmount()
  }

  console.log('[e2e:authorization-surface] P1-16 spawn 自授框架/写工具 → 装配期排除(子调用报不存在)')
  {
    const llm = stubModel(
      // 主 LLM 尝试自授 use_worker/load_skill/write(write 属写工具同样不可自授)
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '尝试激活委派工具', tools: ['use_worker', 'load_skill', 'write'] } }] },
      // 子 LLM 尝试调被禁工具(若装配期 filter 失效则会真执行)
      { toolCalls: [{ name: 'use_worker', args: { task: '递归委派' } }] },
      { text: '子任务结论' },
      { text: '已完成' },
    )
    const subResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auth-selfgrant', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagents: [{ id: 'worker', description: '测试工人' }],
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], (e) => {
      if (e.type === 'subagent' && e.kind === 'tool_result') subResults.push(e)
    })
    const useAttempt = subResults.find((r) => r.name === 'use_worker')
    assert(!!useAttempt && /不存在/.test(String(useAttempt.result)), '✓ spawn 自授 use_<id> 被装配期排除 → 子调用报「工具不存在」(depth 链不可激活)')
    sdk.unmount()
  }

  console.log('[e2e:authorization-surface] P0-1 + P1-15 子 agent vfs 工具解析 + offload 桥接主池')
  {
    // 自定义大结果工具(子经 allowedTools 拿;30K 字符 > offload 阈值 → 触发外存)
    const bigTool = defineTool({
      name: 'big_result',
      description: '返回大结果',
      schema: z.object({}),
      handler: async () => 'A'.repeat(30000),
    })
    const llm = stubModel(
      { toolCalls: [{ name: 'use_coder', args: { task: '生成组件代码' } }] },
      // 子:① 大结果工具(触发 offload —— 桥接时写主池,否则写一次性 state.files 丢失)
      { toolCalls: [{ name: 'big_result', args: {} }] },
      // 子:② vfs 写代码文件(P0-1:allowedTools 的 vfs_write 现在能从合并池解析到)
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/my-comp.vue', content: '<template>ok</template>' } }] },
      { text: '子任务完成' },
      // 主:vfs_ls 验证子 offload 文件与子写入文件都在主池
      { toolCalls: [{ name: 'vfs_ls', args: {} }] },
      { text: '已完成' },
    )
    const toolResults = []
    const subResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auth-vfs', storage: false, llm,
      tools: [bigTool],
      capabilities: CAPS,  // vfs 保持默认开
      subagents: [{ id: 'coder', description: '代码工人', allowedTools: ['vfs_write', 'vfs_read', 'big_result'] }],
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '生成', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
      if (e.type === 'subagent' && e.kind === 'tool_result') subResults.push(e)
    })
    // P0-1:子的 vfs_write 真执行(原:allowedTools 恒落空 → 工具不存在)
    const vfsWriteResult = subResults.find((r) => r.name === 'vfs_write')
    assert(!!vfsWriteResult && !/不存在/.test(String(vfsWriteResult.result)), '✓ P0-1 子 agent allowedTools 的 vfs_write 从合并池解析并执行(能力包核心流恢复)')
    // P1-15:子 offload 经 vfs-bridge 落主池 —— 主 vfs_ls 能看到 large_results/big_result-*.txt
    const lsResult = toolResults.find((r) => r.name === 'vfs_ls')
    assert(!!lsResult && /large_results\/big_result/.test(String(lsResult.result)), '✓ P1-15 子 offload 大结果经 vfs-bridge 落主 vfs 池(主 vfs_ls 可见;原:写一次性 state.files 后 404)')
    assert(!!lsResult && /html\/my-comp\.vue/.test(String(lsResult.result)), '✓ 子 vfs_write 文件在主池(主子共享同一 vfsStore)')
    sdk.unmount()
  }

  console.log('[e2e:authorization-surface] bulk-change-guard 装配与门禁(默认关 / 未配 approval no-op / 超阈挂确认 / 量纲反例)')
  {
    const bind = { components: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }
    const fivePatch = [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.title`, value: `t${i}` }))

    // ① 默认关:未声明 bulkGuard → inspect 反射 enabled:false + 超阈写不挂确认
    {
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { patches: fivePatch } }] },
        { text: 'done' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-bulk-off', storage: false, llm, autoTitle: false,
        data: { schema: z.object({ components: z.array(z.object({ id: z.number(), title: z.string().optional() })) }), bind, description: 'd' },
        capabilities: { ...CAPS, vfs: false, subagent: false },
      })
      await sdk.mount()
      assert(sdk.inspect().bulkGuard?.enabled === false, '✓ 装配 → 默认关(inspect 反射 enabled:false)')
      await sdk.stream([{ role: 'user', content: '批量改', timestamp: Date.now() }], () => {})
      assert(bind.components.every((c) => c.title?.startsWith('t')), '✓ 默认关 → 超阈写不拦直接落地(零回归)')
      sdk.unmount()
    }

    // ② 请求 bulkGuard 但未配 approval → no-op + info 留痕(console.info)
    {
      const llm = stubModel({ text: 'ok' })
      const sdk = createChatSdk({
        ui: false, id: 'e2e-bulk-noapproval', storage: false, llm, autoTitle: false,
        data: { schema: z.object({}), bind, description: 'd' },
        capabilities: { ...CAPS, bulkGuard: true, vfs: false, subagent: false },
      })
      await sdk.mount()
      assert(sdk.inspect().bulkGuard?.enabled === false, '✓ 装配规则 → 未配 approval 门禁 no-op(防 headless 挂死)')
      sdk.unmount()
    }

    // ③ 装配 + 超阈 → 挂 approval;确认放行;同形态二次直接放行(会话豁免)
    {
      const bind3 = { components: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { patches: fivePatch } }] },   // 第一次超阈(挂起 → 确认)
        { text: '已完成批量修改' },
        { toolCalls: [{ name: 'write', args: { patches: fivePatch.map((p, i) => ({ ...p, value: `u${i}` })) } }] },  // 二次(会话豁免直接过)
        { text: '再次完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-bulk-on', storage: false, llm, autoTitle: false,
        data: { schema: z.object({ components: z.array(z.object({ id: z.number(), title: z.string().optional() })) }), bind: bind3, description: 'd' },
        capabilities: { ...CAPS, bulkGuard: true, vfs: false, subagent: false },
        approval: { tools: [], confirm: () => false },   // 只满足装配条件(approval 存在);confirm 恒 false = 白名单不含任何工具(避免 approvalMw 与 bulkGuard 对 write 双重挂起)
      })
      await sdk.mount()
      assert(sdk.inspect().bulkGuard?.enabled === true, '✓ 装配 → bulkGuard + approval 齐备时 enabled:true')
      let approved = 0
      await sdk.stream([{ role: 'user', content: '批量改标题', timestamp: Date.now() }], (e) => {
        if (e.type === 'approval_request') { approved++; e.resolve(true) }
      })
      assert(approved === 1, `✓ 门禁 → 超阈(5 组件)挂 approval 恰 1 次(实际 ${approved})`)
      assert(bind3.components.every((c) => c.title?.startsWith('t')), '✓ 门禁 → 确认后写入落地')
      assert(sdk.inspect().bulkGuard?.confirmedKinds?.includes('patches'), '✓ 门禁 → inspect 反射会话豁免形态集')
      // 二次同形态:豁免直接放行(approved 不再增加)
      await sdk.stream([{ role: 'user', content: '再批量改一次', timestamp: Date.now() }], (e) => {
        if (e.type === 'approval_request') { approved++; e.resolve(true) }
      })
      assert(approved === 1, '✓ 会话豁免 → 同形态二次直接放行(不再弹)')
      assert(bind3.components.every((c) => c.title?.startsWith('u')), '✓ 会话豁免 → 二次写入落地')
      const logs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'bulk_guard')
      assert(logs.some((l) => l.data.decision === 'confirm'), '✓ 留痕 → debugLogs bulk_guard confirm')
      assert(logs.some((l) => l.data.decision === 'exempt-once'), '✓ 留痕 → debugLogs bulk_guard exempt-once')
      sdk.unmount()
    }

    // ④ 量纲反例:同组件多 patch(8 条全落 components.0)→ 不挂确认直接过
    {
      const bind4 = { components: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { patches: Array.from({ length: 8 }, (_, i) => ({ op: 'set', jsonPath: `components.0.props.k${i}`, value: i })) } }] },
        { text: '微调完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-bulk-dim', storage: false, llm, autoTitle: false,
        data: { schema: z.object({ components: z.array(z.object({ id: z.number(), props: z.record(z.string(), z.unknown()).optional() })) }), bind: bind4, description: 'd' },
        capabilities: { ...CAPS, bulkGuard: true, vfs: false, subagent: false },
        approval: { confirm: () => false },   // 只满足装配条件;confirm 恒 false(白名单不含工具)防 approvalMw 双重挂起
      })
      await sdk.mount()
      let asked = 0
      await sdk.stream([{ role: 'user', content: '微调组件1', timestamp: Date.now() }], (e) => {
        if (e.type === 'approval_request') { asked++; e.resolve(true) }
      })
      assert(asked === 0, `✓ 量纲 → 同组件 8 条 patch(1 个组件)不拦(实际挂起 ${asked} 次)`)
      assert(Object.keys(bind4.components[0].props ?? {}).length === 8, '✓ 量纲 → 微调直接落地')
      sdk.unmount()
    }
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
