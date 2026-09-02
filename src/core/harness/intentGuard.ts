/**
 * 问句意图守卫(instruction-adherence B)—— 逐消息动态定性,防「问句被误路由成操作指令」
 *
 * 实测事故(editor_fangzhou 真 LLM):长对话里用户问「这是啥组件」→ agent 被历史轨迹拖着
 * 委派 use_html 生成代码(分钟级 + 大量 token + 改了不该改的数据)。根因不是模型违反规则,
 * 是静态【先判意图】提示在长上下文里被稀释 —— 问句信号没到注意力前排。
 *
 * 机制分层(与「纪律靠机制不靠提示词」不矛盾 —— 那是治「看到规则却违反」,本守卫治「没看到」):
 *  - 判定:纯正则启发式(<1ms,零 token),三档宁漏勿误(精度优先)
 *  - 送达:augmentPrompt pin 段(每轮重评估 + 跨压缩/预算裁剪存活)
 *  - 裁决:仍归主 LLM —— 文案带逃生门「除非同条消息明确要求操作」,
 *    「能帮我设计个活动页吗?」这类形式问句、实质请求不会被拦死
 *
 * 不阻断任何工具(不是 permissions 过滤):回答问题本身需要 read/list/rag;
 * 硬禁写工具的精度撑不起(混合消息「是干嘛的?顺便改成橙色」会误杀后半句),见 design D3。
 */
import type { Middleware } from './middleware'

/** 疑问词(中信号):需配合句尾「吗/呢/么/嘛」才判定问句(单独出现可能是祈使,如「看看为什么报错然后修一下」;
 *  末四单字能/可以/会/行同样须句尾语气词配合 —— 单字歧义大,靠双条件收敛,nested-demo 实测「你能修改嵌套层级么」驱动补齐) */
const QUESTION_WORD_RE = /(为什么|为啥|多少|几个|能不能|可不可以|是否|有没有|怎样|咋|能|可以|会|行)/
/** 查询词(高信号):此类词几乎只出现在信息咨询,命中即判问句(「这是啥组件」实测案例即此档) */
const QUERY_WORD_RE = /(是什么|是啥|怎么用|如何用|有哪些|什么意思|干嘛的|干什么用)/
/** 问句收尾:句尾「吗/呢/么/嘛」(允许跟问号;半角+全角 —— 全角？漏配会复制成地雷,team-audit P2;
 *  么/嘛 2026-09-02 补:句尾语气词几乎恒为疑问/商量,祈使句不以么/嘛收尾) */
const QUESTION_TAIL_RE = /(吗|呢|么|嘛)[?？]?\s*$/

/**
 * 判定文本是否为「提问/咨询」(三档启发式,宁漏勿误):
 *  ① 强信号:句尾 ?/？
 *  ② 中信号:疑问词(为什么/能不能/是否…) + 句尾「吗|呢」
 *  ③ 查询词:「是什么|怎么用|有哪些…」命中即算
 * 反例基线(必须不命中):「设计一个活动页」「把标题改成X」「添加一个 banner」「调换 navbar 和 banner 顺序」
 */
export function detectQuestionIntent(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (/[?？]\s*$/.test(t)) return true
  if (QUERY_WORD_RE.test(t)) return true
  if (QUESTION_WORD_RE.test(t) && QUESTION_TAIL_RE.test(t)) return true
  return false
}

/** 命中时注入的 pin 段文案:先答勿做 + 逃生门(除非同条消息明确要求操作) */
const GUARD_SEGMENT = [
  '[本轮消息为咨询] 用户最新消息是提问/咨询,不是操作指令。',
  '请先作答:用 read / query / search / list_components / rag 等工具查证后基于事实回答,不要凭空猜测。',
  '不要执行生成/修改/删除操作 —— 除非用户在同一条消息里同时明确提出了操作要求(如「顺便把 X 改成 Y」)。',
].join('\n')

/**
 * 创建问句意图守卫中间件。
 * @param onHit 命中回调(可选;createChatSdk 注入 → 写 debugLogs stage:'intent_guard',按消息内容去重)
 */
export function createIntentGuardMiddleware(onHit?: (preview: string) => void): Middleware {
  let lastLogged: string | null = null // 按 user 消息内容去重:同一问句驱动的多轮 ReAct 只留痕一次
  return {
    name: 'intentGuard',
    augmentPrompt: (state) => {
      // 读最新一条 user 消息,每轮重评估:问句驱动的多步 ReAct 全程受守护;
      // 下一条操作消息进来自动失效(无残留);子 agent 不装本中间件,不受影响
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i]
        if (m.role !== 'user') continue
        if (!detectQuestionIntent(m.content)) return undefined
        if (onHit && lastLogged !== m.content) {
          lastLogged = m.content
          onHit(m.content.slice(0, 60))
        }
        return GUARD_SEGMENT
      }
      return undefined
    },
  }
}
