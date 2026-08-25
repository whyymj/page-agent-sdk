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

  return { pass: ctx.pass, fail: ctx.fail }
}
