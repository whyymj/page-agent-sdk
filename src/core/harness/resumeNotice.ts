/**
 * 会话恢复提示(resume-notice)—— 恢复非空历史后的首轮注入,防「凭历史断言已完成」
 *
 * 实测事故(editor_fangzhou):上一会话完成代码生成但未保存 → 刷新后页面回退到上次保存态,
 * 而会话从 IndexedDB 恢复(messages/todos 全在、todos 全 completed)→ 用户要求「重新生成」,
 * agent 直接回复「完毕」,没有核实当前页面数据 —— 生成物其实已不存在。
 * 根因:恢复的历史 ≠ 当前数据现状(刷新丢未保存修改/宿主或用户改过数据),agent 缺「状态可能已过期」的信号。
 *
 * 机制(同 intentGuard 分层:判定在框架、裁决归 LLM、不阻断任何工具):
 *  - SDK 在 applySnapshot 恢复非空历史时调 markResumed()
 *  - 恢复后首轮 augmentPrompt 注入提示段(轮内每次模型调用重建,整轮 ReAct 全程在场)
 *  - afterAgent 清除(一次性:后续轮已有本轮工具结果,不再需要)
 *
 * 覆盖路径:init autoResume / session.id 恢复 / switchSession 载入 —— 凡 applySnapshot 灌入非空 messages 均触发。
 */
import type { Middleware } from './middleware'

/** 提示文案:恢复事实 + 核实纪律(只递信号,不禁工具) */
const RESUME_NOTICE = [
  '[本会话从历史记录恢复] 你不在场期间,宿主页面数据可能已发生变化:',
  '- 页面刷新可能使数据回退到上次保存的状态(未保存的修改已不存在);用户或宿主也可能改动过数据。',
  '- 历史对话与已完成的任务记录不代表当前实际数据。',
  '纪律:断言「已生成/已存在/已完成」前,先用 read / list_components 等工具核实当前状态;',
  '用户要求重做历史工作(如「重新生成」)时,先核实缺失了哪些部分,再补齐或重做,勿直接回复「已完成/完毕」。',
].join('\n')

export interface ResumeNoticeMiddleware extends Middleware {
  /** 标记刚恢复了非空历史(SDK applySnapshot 调用) */
  markResumed: () => void
  /** 清除待注入标记(切会话/清空会话) */
  reset: () => void
  /** 是否有未消费的恢复标记(测试/检视用) */
  isPending: () => boolean
}

/**
 * 创建会话恢复提示中间件。
 * @param onInject 提示段首次注入回调(可选;createChatSdk 注入 → 写 debugLogs stage:'resume_notice',每恢复周期去重一次)
 */
export function createResumeNoticeMiddleware(onInject?: () => void): ResumeNoticeMiddleware {
  let pending = false
  let logged = false
  return {
    name: 'resumeNotice',
    markResumed: () => { pending = true; logged = false },
    reset: () => { pending = false; logged = false },
    isPending: () => pending,
    augmentPrompt: () => {
      if (!pending) return undefined
      if (onInject && !logged) {
        logged = true
        onInject()
      }
      return RESUME_NOTICE
    },
    // 一次性:首轮(含轮内全部 ReAct 步)结束后清除;fatal 中断未跑到 afterAgent 时标记保留 → 下轮仍提示,语义仍正确
    afterAgent: () => { pending = false },
  }
}
