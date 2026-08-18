/**
 * 基线守卫(乐观锁基线过期防护;editor_fangzhou 实测「自冲突」根因修)
 *
 * 背景:乐观锁基线(per-scope baselines)只由 dataOps 写路径维护(read/写后刷新)。
 * 集成方经 **SDK 写路径之外** 的通道改 bind 时基线不刷新 —— 典型:defineTool 结构性工具
 * (add_component/delete_component/move_component)、actions、checkpoint restore 就地还原、
 * skill exec 工具。之后 agent 下一次 write(autoLock 取基线当 effHash)与实时 hash 不匹配
 * → 触发「自己跟自己冲突」(agent 刚清空数组,下一步添加组件就要强制覆盖)。
 *
 * 机制:wrapToolCall 包裹**非 dataOps 内置**工具(内置工具自管基线,跳过免高频 hash 开销),
 * 调用前后各一次 hashValue(bind) 比对;变化(含抛错路径,finally 兜底)→ recomputeAllBaselines
 * 全 scope 一次刷新(bind 为各 scope 共享,一次 hash 更新全部)+ debug 留痕。
 *
 * 不变量守护:
 * - 冲突检查 hash 仍实时计算(本守卫只刷基线,不引入跨调用缓存,与 write-path-cost-reduction C 段契约兼容)
 * - N1「同 scope 连续写永不互相冲突」扩展到 SDK 可观察的全部写通道(框架内 mutation 不再致 autoLock 误报)
 * - 权衡(已知且接受):工具执行窗口内的人工并发改动会被归因于该工具(基线一并刷新,keep_external 不再拦);
 *   窗口外的人工改动仍正常触发冲突保护
 * - 子 agent 委派(spawn/use_<id>)也经此守卫:子栈写在子 scope 基线内完成,主基线在委派返回后刷新,
 *   修「委派落地后主 agent 下一次 write 误冲突」同源问题(codeAsset commit 已有单点 recompute,此为通用兜底)
 */
import type { Middleware } from '../harness/middleware'
import { hashValue } from '../tools/jsonUtils'

export interface BaselineGuardOptions {
  /** 读当前主数据 bind(getter 形式适配 setData 运行时替换) */
  getBind: () => unknown
  /** 检出变化后重算全部已存在 scope 的基线(dataOps controller.recomputeAllBaselines) */
  recomputeAll: () => void
  /** 是否存在基线条目(无基线 → 无过期问题,跳过 before/after hash;read 族高频工具省开销) */
  hasBaselines?: () => boolean
  /** 是否 dataOps 内置工具(自管基线,跳过守卫;其余工具 —— 用户 defineTool/actions/MCP/skill/委派 —— 全守卫) */
  isManaged: (toolName: string) => boolean
  /** 调试留痕(DebugDrawer 可见;type='baseline_guard') */
  log?: (type: string, data: unknown) => void
}

export function createBaselineGuardMiddleware(opts: BaselineGuardOptions): Middleware {
  return {
    name: 'baseline-guard',
    wrapToolCall: async (ctx, next) => {
      if (opts.isManaged(ctx.name)) return next(ctx)
      if (opts.hasBaselines && !opts.hasBaselines()) return next(ctx)
      const before = hashValue(opts.getBind())
      try {
        return await next(ctx)
      } finally {
        // 抛错路径也比对:自定义工具可能改了一半再抛,基线同样需刷新
        if (hashValue(opts.getBind()) !== before) {
          opts.recomputeAll()
          opts.log?.('baseline_guard', { tool: ctx.name, action: 'recompute_baselines', reason: 'bind_changed_outside_dataops' })
        }
      }
    },
  }
}
