/**
 * MCP 全连接编排(F3 2026-09-10 从 createChatSdk initDone IIFE 抽出)。
 * 语义不变:逐 server 渐进注入(坏 server 不拖累好 server)/ 3 次递增退避重试吸收上游 502 /
 * release 先行守卫 / 保留字拒注 / 失败 observable + inspect 反射。依赖经 deps 显式传入。
 */
import { connectMcp, type McpServerConfig } from './client'
import type { SdkEvent } from '../types'

export interface ConnectAllMcpDeps {
  servers: McpServerConfig[]
  emit: (e: SdkEvent) => void
  /** core 已释放(release 先行):不回填 closers/不注入/不记失败 */
  isReleased: () => boolean
  /** 连接成功回填面(closers/servers 清单/失败清单/infoTick) */
  core: {
    mcpClosers: Array<(...args: any[]) => any>
    mcpServers: Array<{ name: string; url: string; toolCount: number }>
    mcpFailed: Array<{ name: string; url: string; error: string }>
    infoTick: { value: number }
  }
  /** 开局保留字集(非 mcp 来源工具名;C1 安全保留字保护) */
  reservedNames: () => Set<string>
  /** 单工具注入(保留字检查 + toolSources 标 + mcpTools push);返回是否真有注入 */
  pushTool: (t: { name: string }, label: string) => boolean
  /** 注入后重建 allTools + 已建 agent rebind + infoTick */
  rebind: () => void
  debug?: boolean
}

/** 连所有 server(故障隔离,后台渐进注入);Promise 在全 settle 后 resolve */
export async function connectAllMcpServers(deps: ConnectAllMcpDeps): Promise<void> {
  const { servers, emit, core } = deps
  // 上游 MCP 网关偶发 502/连接重置(实测 user-bff-api 抖动):一次性连接撞上抖动会整会话丢工具
  // → 模型调 rag_* 报「不存在」。重试 3 次(递增退避)吸收瞬时故障,仍失败才降级跳过。
  const connectWithRetry = async (c: McpServerConfig) => {
    let lastErr: unknown
    for (let i = 0; i < 3; i++) {
      try { return await connectMcp(c) } catch (e) { lastErr = e; if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1))) }
    }
    throw lastErr
  }
  const reserved = deps.reservedNames()
  // 逐 server 渐进注入(修 allSettled 栅障):原实现等全部 server 落定才统一注入 —— 一个坏 server
  // 的 3 次重试(~5s)会拖累所有好 server 的工具注入(mcp-e2e F4 实测)。改为各自落定即注入,
  // 谁先连上谁先可用;坏 server 失败只影响自己(故障隔离语义不变)。单线程事件循环保证 push 安全。
  let settled = 0
  const total = servers.length
  await Promise.allSettled(servers.map(async (cfg) => {
    const label = cfg.name ?? cfg.url
    let injected = false
    try {
      const conn = await connectWithRetry(cfg)
      // release 先行:core 已释放 → 不回填 mcpClosers(release 已 splice 过,回填=泄漏),直接关
      if (deps.isReleased()) { void conn.close(); return }
      core.mcpClosers.push(conn.close)
      core.mcpServers.push({ name: label, url: cfg.url, toolCount: conn.tools.length })
      conn.tools.forEach((t) => {
        if (reserved.has(t.name)) {
          console.warn(`[page-agent-sdk][mcp] 工具 "${t.name}" 与内置工具重名,已拒绝注入(安全保留字保护)`)
          return
        }
        if (deps.pushTool(t, label)) injected = true
      })
      // 重建 allTools(纳入 mcpTools)+ 已建 agent 则 rebind 迟到注入(infoTick 刷新 inspect)
      if (injected) deps.rebind()
    } catch (reason) {
      if (deps.isReleased()) return
      console.warn(`[page-agent-sdk][mcp] server ${label} 连接失败:`, reason)
      // 降级可观测(MCP_CONNECT_FAILED):只 console.warn 时 headless/无 console 集成无从得知,
      // 模型仍会按 systemPrompt 引用调工具 →「工具不存在」误导为代码问题。emit observable + inspect 反射。
      const errText = String((reason as Error | undefined)?.message ?? reason ?? '').slice(0, 200)
      core.mcpFailed.push({ name: label, url: cfg.url, error: errText })
      emit({ type: 'error', message: `MCP server「${label}」连接失败,其工具不可用:${errText}`, severity: 'observable', code: 'MCP_CONNECT_FAILED', context: { server: label, url: cfg.url } } as any)
    } finally {
      settled++
      if (settled === total && deps.debug) console.log(`[page-agent-sdk][mcp] 注入完成,${core.mcpServers.length} 个 server 成功`)
    }
  }))
}
