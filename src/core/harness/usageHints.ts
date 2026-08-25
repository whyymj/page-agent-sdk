/**
 * 能力用法提示中间件 —— 各内置能力开启时,向 system prompt 注入一行简短用法引导。
 *
 * 设计(design §4):
 *  - 克制:仅在该能力开启时注入对应提示,一行/能力;全部关闭时返回 undefined(不增上下文)。
 *  - 由 createChatSdk 构造(它知道 caps),非各能力中间件自注入(中间件不感知 caps)。
 *  - 装载栈最前 → 其 augmentPrompt 段紧跟 base systemPrompt。
 *  - 绝不覆盖集成方 systemPrompt(拼接在其后,由 buildSystemPrompt 组装)。
 */
import type { Middleware } from './middleware'
import type { HarnessState } from './state'
import { resolveCapabilities } from '../capabilities'

/** capabilities 子集(仅用法提示相关开关) */
type HintCapabilityFlags = {
  planning?: boolean
  dataOps?: boolean
  subagent?: boolean
  humanConfirm?: boolean
  inspectEnv?: boolean
  domInspect?: boolean
  draftWrite?: boolean
  /** 上下文聚焦(注入 set_focus/clear_focus 引导) */
  focus?: boolean
  /** 预声明子 agent(用于注入"规划-反思-执行"路由提示;空则不注入) */
  subagents?: { id: string; description: string; temperature?: number }[]
}

/** 高温阈值:≥0.7 视为创意/规划型子 agent */
const CREATIVE_TEMP = 0.7

/** 自感知预算提示配置(C1:softCap 传入才有 token 维度触发) */
export interface BudgetHintOptions {
  /** 解析后的有效 prompt 软上限(resolvePromptSoftCap 产物;Infinity=不参与) */
  promptSoftCap?: number
}

/**
 * @param caps 能力开关(planning / dataOps / subagent / humanConfirm / subagents)
 * @param hasDataOps 是否实际装了 数据操作工具(用于判断 snapshot 回退提示是否有意义)
 * @param budget C1 自感知预算提示配置(softCap;不传则仅轮次维度触发)
 */
export function createUsageHintsMiddleware(caps: HintCapabilityFlags | undefined, hasDataOps: boolean, budget?: BudgetHintOptions): Middleware {
  const rc = resolveCapabilities(caps)  // 单一解析 capability 开关(humanConfirm/subagents 非 capability,caps 直接访问)
  return {
    name: 'usageHints',
    augmentPrompt: (state: HarnessState) => {
      const hints: string[] = []
      if (rc.planning) {
        hints.push('【自适应规划】按任务复杂度决定是否先规划,不要对简单任务过度编排:')
        hints.push('  · 简单/明确任务(改单字段、调样式、查值)→ 直接 read/write 执行,不必 write_todos。')
        hints.push('  · 复杂任务(多步、大改、有歧义、不可逆)→ 先 write_todos 拆解,首个任务标 in_progress,逐项推进。')
        hints.push('  · 执行中发现步骤要改/补/细分 → 用 update_todo({id, content?, status?}) 按 id 增量改单项,不必重传整个清单。')
        // evidence-audit-gate A1:evidence 引导无条件注入(与机制同 ship)——收口审计会核对 evidence 路径与写入记录,
        // 不教引导会让「规范完成任务」因缺 evidence 被系统性回灌(2026-08-23 评审阻断 A-1)
        hints.push('  · update_todo 标 completed 时附 evidence: 本次实际写入的 jsonPath(如 "components.2"),供收口对账;工作经委派子 agent 完成等无主写路径时,如实写明完成方式(勿编造路径)。')
        // request_human_confirmation 仅 humanConfirm 能力开时装载;关闭时改引导文字征询,勿教调不存在的工具
        if (caps?.humanConfirm) hints.push('  · 规划出多步方案若需用户拍板 → 先 request_human_confirmation 给方案选项,确认后再执行。')
        else hints.push('  · 规划出多步方案若需用户拍板 → 以文字列出方案选项等用户回复,勿自行拍板。')
        hints.push('  · 计划修订有次数上限(maxPlanRevisions,默认 5,只计 write_todos 调用、调研轮不计):勿反复改计划而不执行,规划充分后即开始 write 落地。')
      }
      if (hasDataOps) {
        hints.push('改主数据前先 read({jsonPath}) 读其当前真实值(返回末尾 hash=xxx 为乐观锁标识),基于真实值改,不要凭记忆。写入是否被自动校验由集成方 conflictWatchFields 声明决定:若已声明且主数据在你 read 之后被外部改过,会触发冲突——集成方若开启人工介入,工具会挂起等用户决定(保留外部/强制覆盖/回退),你应等待工具返回后按结果继续(保留外部→重新 read 再改;强制覆盖→已写入,继续;回退→已回退到历史快照,基于回退值重写);未开启人工介入时返回 VERSION_CONFLICT 不写入,重新 read 拿最新值再改。')
        hints.push('不确定主数据字段结构时用 describe_data 查看说明。')
        hints.push('修改大对象/数组优先用 write 增量改({patch:{op,jsonPath,value}} 只发改动部分),避免 write({value}) 整体重传被 max_tokens 截断导致 JSON 不完整、校验失败。')
        hints.push('修改主数据出错时可用 restore_data 回退最近一次。')
        hints.push('在大数组里按条件筛选元素用 query_data(JSONPath,如 $.components[?(@.type=="card" && @.price<100)]),返回匹配元素的 path/index;定位后再 write({patch}) 改。')
        hints.push('找名字记不清的元素用 search_data(支持 substring/regex/fuzzy 模糊搜索)。')
        hints.push('需要过滤/映射/聚合/批量重写大数组时用 eval_script(沙箱脚本,入参 data);只读探查用 mode=query,批量重写用 mode=transform(返回值经校验后落地)。')
        hints.push('读大数组用 read({jsonPath,offset,limit}) 分页(返回 hasMore=true 时 offset+=limit 续读);一次读多个不相关子路径用 read({jsonPaths});复杂改动先 write({...,dryRun:true}) 预检不落盘。')
        hints.push('【省轮次·批量】≥2 个路径一律 read({jsonPaths:[...]}) 一次取回(路径互不相关也合批,禁止连续单路径 read);改多处用 write({patches:[{op:"set",jsonPath,value},...]}) 一次提交多改动(原子任一失败回滚),勿逐个 write 烧轮次预算。')
        hints.push('读到 <subtree Nkb keys:[…] #指纹> 或 <code Nkb> 占位 = 该子树键名/体积可见但内容未见:写入前先窄读全文(read({jsonPath:"该子树路径"}),结果根豁免返全文)或 set_focus 聚焦该区域;勿凭键名印象猜路径/猜值直写(直接写占位子树会被拦下要求先窄读)。')
        hints.push('对比当前与历史快照(或一段 JSON against)的差异用 diff_data({snapshotId?,against?})(返回结构化 path→from/to,verify 自纠/操作审计/"刚才改了啥");只读查历史快照值用 history_data({id?,jsonPath?})。')
      }
      if (rc.subagent) hints.push('独立子任务可 spawn_agent 委派(过程隔离,不占主上下文):默认只读,需要子 agent 写数据时传 writablePaths(路径前缀白名单,越界 PATH_OUT_OF_SCOPE)。多个独立子任务可 spawn_agents 并行委派(各子互不通信,结论由你汇总;并行委派不可授写权限,写操作由你收尾执行)。')
      if (rc.inspectEnv) hints.push('排查页面环境(当前 URL/浏览器/视口/集成方调试变量)用 inspect_env——不传参返回环境摘要(location/navigator/viewport/document),传 key 读特定 window 属性(如 inspect_env({key:"appConfig"}) 读 window.appConfig)。改完数据看渲染、定位"为何没生效"时用它(只读,不改数据)。')
      if (rc.domInspect) hints.push('改完数据想确认渲染是否生效(或定位元素/辅助 UI 设计问答)用 get_dom({selector?,depth?}) 读渲染后 DOM(结构化返回 tag/attrs/text/children,depth 控制深度防爆炸,只读)。配合宿主 actions(save_draft/publish 等)形成"改数据→get_dom 看渲染→触发动作"闭环。')
      if (rc.draftWrite) {
        hints.push('生成超大 JSON(如 50+ 组件页面,单次 write 受 max_tokens 限制装不下)用 draft_write 分块构建 → draft_commit 原子提交:draft_write({draftId, chunk, mode}) mode:"start" 新建/"append" 追加(拼 JSON 片段到 drafts 池);累积完 draft_commit({draftId}) 合并 + schema 校验 + 写主数据(失败草稿保留可修后重试,成功自动清草稿)。小改仍用 write patch,只在大 JSON 从零生成时用 draft。')
        hints.push('⚠️ 大 JSON 分块构建是典型多轮工具调用(draft_write×N + draft_commit + read 确认 + 调研 read/query),默认 maxToolRounds=30(3.43 起;轮次预算吃紧时 system 会注入预算提示段,按提示优先收口);目标组件数很大时集成方仍可在 createChatSdk 显式上调 maxToolRounds(按 N+10 估算)。draft_commit 提交同样走乐观锁(改前 read 拿 hash,bind 被改过会触发冲突介入,不静默覆盖)。')
      }
      // todoDeps 层级依赖教学已随 config-surface-pruning 撤除(schema 的 parentId/deps 字段描述仍自解释;evidence 教学在 A1 无条件段)
      if (rc.focus) {
        hints.push('【上下文聚焦】判断任务范围,用 set_focus/add_focus/remove_focus/clear_focus 自动收敛工作范围:')
        hints.push('  · 局部任务(只改某一组件/区域,如「调导航栏」「改 components.3 样式」)→ 先 read 定位 jsonPath,再 set_focus({path:"该子树路径"}) 聚焦;聚焦后每轮只看该子树结构,写其他位置会被 PATH_DENIED 拒绝。')
        hints.push('  · 多个相关组件(如「同时改导航栏和页脚」)→ set_focus 聚焦首个后用 add_focus({path}) 追加其余;聚焦后可写任一焦点子树,越界仍被拒;移除单个用 remove_focus({path})。')
        hints.push('  · 全局任务(多处/整体结构,如「重排所有组件」「换主题」)→ 不要聚焦,保持全量视野直接写。')
        hints.push('  · 完成局部精修、要转向其他区域或做整体改动 → 调 clear_focus 退出聚焦(清空全部焦点),恢复全部读写权限。')
        hints.push('  · set_focus/add_focus 的 path 必须在 schema 内(类型校验);不确定路径先 read/describe_data 查。')
      }
      // 受保护资源:resourcesPin 中间件每轮已注入功能段(占位符语义/资源工具用法),此处不重复(实测曾双份注入浪费)
      if (caps?.subagents?.length) {
        const planners = caps.subagents.filter((s) => (s.temperature ?? 0) >= CREATIVE_TEMP || /规划|创意|设计|方案|brainstorm|plan/i.test(s.description))
        const reflectors = caps.subagents.filter((s) => (s.temperature ?? 0) < CREATIVE_TEMP && /反思|审查|挑刺|校验|review|critique|reflect/i.test(s.description))
        hints.push('【规划-反思-执行·路由】按任务性质选模式,不要对简单任务过度编排:')
        if (planners.length) {
          hints.push(`  · 创作/设计/开放性需求(如"设计主题风格""换个感觉")→ 先调 ${planners.map((s) => 'use_' + s.id).join('/')} 出 2-3 套方案(高温创意),`)
          hints.push(caps?.humanConfirm
            ? '    不要自己拍板;拿到方案后,若需用户拍板用 request_human_confirmation 弹选项。'
            : '    不要自己拍板;拿到方案后以文字列出选项等用户回复(humanConfirm 未开,勿调不存在工具)。')
        }
        if (reflectors.length) {
          hints.push(`  · 严谨/易错/校验类 → 可先调 ${reflectors.map((s) => 'use_' + s.id).join('/')} 反思挑刺(低温审查),据反馈修订。`)
        }
        hints.push('  · 方案定稿后,由你(主 agent)用 write 落地成 JSON(低温度执行 + schema 校验 + 写前确认)。')
        hints.push('  · 简单/明确任务(如"标题改红色")直接执行,不必走规划-反思。')
      }
      if (caps?.humanConfirm) {
        hints.push('【人工确认·必读】以下情形必须先调 request_human_confirmation 征询用户、拿到答复后再继续,不要自行拍板:')
        hints.push('  1) 用户让你「给方案/列选项/我来选/挑一个」时:把每个方案作为一个 option,调 request_human_confirmation(question=简述, options=[方案A,方案B,...], recommendation=你推荐的)。不要只回文字罗列方案让用户自己回复——要用工具把选项做成可点选按钮。')
        hints.push('  2) 需求有歧义/不确定时:调工具问清楚(options 不传则用户答同意或拒绝)。')
        hints.push('  3) 即将执行高风险不可逆操作(删除/覆盖/批量改动)前:调工具确认。')
        hints.push('  4) 规划出多步方案需用户确认时:把整个方案(或关键分步)作为 option 调 request_human_confirmation,确认后再执行。')
        hints.push('用户在选项里选了哪个,就按那个方案继续;选「拒绝」则停止并询问如何调整。')
      }
      // C1/C2 自感知预算提示(context-economy-phase2):数据源 state.loopProgress(createAgent 每轮更新);
      // 3.43 起轮次维度移交 createAgent 核心(roundBudgetHintText:持续注入 + 两档升级,不受 budgetHinted
      // 一次性约束 —— 2026-08-22 editor 诊断实证缺陷:token 触发(大上下文任务早触发)消耗掉唯一一次
      // budgetHinted 机会,轮次维度(真正吃紧时)反被饿死从未注入);此处仅保留 token 维度 + 写失败提醒。
      // token 提示每任务只注入一次(budgetHinted 闭包于 per-invoke progress 对象),写失败提醒随失败存续注入
      const p = state?.loopProgress
      if (p) {
        const usedTokens = p.invokeUsage.prompt_tokens || p.invokeUsage.total_tokens
        const softCap = budget?.promptSoftCap ?? Number.POSITIVE_INFINITY
        const nearTokens = softCap !== Number.POSITIVE_INFINITY && usedTokens >= softCap * 0.5
        if (!p.budgetHinted && nearTokens && usedTokens > 0) {
          p.budgetHinted = true
          hints.push(`⏳ 预算提示:本任务累计约 ${Math.max(1, Math.round(usedTokens / 1000))}K prompt tokens(已过 softCap 半程)。若已接近目标请收敛并给出总结;尚未接近请向用户汇报进度与剩余计划,勿默默继续。轮次预算吃紧时系统会另行注入轮次提示段。`)
        }
        const failEntries = Object.entries(p.writeFailures).filter(([, n]) => n >= 2)
        if (failEntries.length) {
          const list = failEntries.map(([path, n]) => `${path || '(整体)'}×${n}`).join('、')
          hints.push(`⚠️ 以下路径已连续写失败:${list}。连续失败常意味着方向错了——先 read 重新核对实际值/类型,或 restore_data 回退后再改;若确需继续,换思路而非原样重试。`)
        }
      }
      if (hints.length) {
        hints.unshift('调用工具务必用标准 function calling(工具调用)格式发起,不要在回复正文里输出伪 XML/标签(如 deepseek 的 tool_calls 标签、invoke、function_call、tool_call 等)或 JSON 文本——那不会被识别为工具调用,会被当普通文字,工具不执行。')
      }
      return hints.length ? '## 能力使用提示\n' + hints.join('\n') : undefined
    },
  }
}
