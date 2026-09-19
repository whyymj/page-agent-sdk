<script setup lang="ts">
/**
 * 学习文档站集成模板(page-quote):自建文档网站 + AI 聊天框的参考实现。
 *
 * 四个演示点:
 * ① 划词引用:选中正文任意文字 → 点「问 AI」打开抽屉或点击输入框 → 引用 chip 自动挂上 → 连问题发出;
 * ② 页面问答:agent 自主调 read_page 读当前页正文(智能定位 article 容器,长文分页)回答「这页讲了什么」;
 * ③ 页面锚点:capabilities.pageContext 每轮注入当前页 title+URL,agent 知道用户在哪篇文档;
 * ④ 浮层菜单自定义:文案走 i18n.messages 键级覆盖(见下方 i18n)+ 配色走宿主 CSS 覆盖(文件末尾非 scoped style,
 *    浮条 Teleport 到 body,scoped 样式选不中它)—— 完整三层自定义(文案/样式/自建)见 doc/usage-guide §6.20。
 *
 * 集成要点(完整说明 doc/usage-guide.md §6.18):
 * - capabilities: { domInspect: true } 开 get_dom/read_page(默认关,opt-in);
 * - capabilities: { pageContext: true } 开页面锚点(默认关,opt-in);
 * - dialog: { autoQuote: true } 开划词自动捕获(默认关,隐私 opt-in;宿主 API sdk.setQuote 不受此开关影响);
 * - 无 data 配置(文档问答无 JSON 槽,dataOps 关)—— SDK 最小集成面 = container + llm。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null
/** 截图演示形态(?shot=1):声明多模态(vision)触发 take_screenshot 装配 —— 注:纯文本模型(deepseek)勿开,
 *  真实使用换多模态模型名(gpt-4o/claude/qwen-vl)或走 images.describe 旁路(images-demo 有完整参照) */
const shotMode = typeof location !== 'undefined' && location.search.includes('shot=1')

onMounted(() => {
  agent = createChatSdk({
    id: 'docs-demo',
    container: '#chat-root',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
      temperature: 0.3,
      ...(shotMode ? { vision: true } : {}),
    },
    storage: 'memory',
    debug: true,
    systemPrompt: '你是学习笔记网站的文档助教。用户可能在页面选中了一段文字后提问(引用块在问题前),优先围绕引用原文与当前页面内容作答;需要页面其他部分时用 read_page 读取正文再答。回答保持准确、简洁,不确定就说不确定。',
    capabilities: { dataOps: false, domInspect: true, pageContext: true, domEdit: true },
    dialog: {
      drawer: true,
      drawerHidden: true,
      autoQuote: true,
      selectionMenu: true, // 划词浮动菜单:显式确认形态(与 autoQuote 静默捕获组合演示);文案/样式自定义见 i18n 与文件末尾 style
      title: '文档助教',
      placeholder: '选中正文后提问,或直接问本页内容…',
      quickActions: [
        { label: '这页讲了什么', prompt: '这个页面讲了什么?请用 read_page 读取正文后概括', icon: '📖' },
        { label: '总结要点', prompt: '总结本页内容的要点,按小节组织', icon: '🧾' },
        { label: '本页配置项', prompt: '本页提到的配置项有哪些?各自的作用和默认值是什么?', icon: '⚙️' },
        { label: '高亮表格', prompt: '用 dom_edit 把 .docs-table 高亮出来(黄色背景),让我一眼看到配置表格在哪', icon: '🖍' },
        ...(shotMode ? [{ label: '截图看表格', prompt: '用 take_screenshot 截取 .docs-table 区域,看看表格渲染效果', icon: '📸' }] : []),
      ],
    },
    // 浮层菜单文案自定义(演示点 ④):i18n.messages 键级覆盖,只换这两个键、其余文案包不变。
    // 注意 3.22+ 起 UI 文案统一在顶层 i18n(不是 dialog.messages);配色自定义见文件末尾的非 scoped style
    i18n: {
      messages: {
        selectionMenuLabel: '引用提问',
        selectionMenuTitle: '把选中的这段原文引用给助教',
      },
    },
  })
  agent.mount()
  // 调试/真 LLM 测试:暴露 sdk 供脚本读(docs-qa 套件 inspect 判 idle + setQuote 注入引用;同 complex-demo 约定)
  ;(window as any).__sdk = agent
})
onUnmounted(() => agent?.unmount())

/** 宿主按钮打开抽屉(show() 内部会懒捕获当前选区挂引用 chip —— 「选中→点按钮」流) */
const openAsk = (): void => agent?.show()
</script>

<template>
  <div class="docs-page">
    <DevNav />
    <header class="docs-hero">
      <h1>Transformer 学习笔记</h1>
      <p class="docs-meta">自建学习文档 · 集成 page-agent-sdk 划词引用 + 页面问答</p>
      <div class="docs-tip">
        💡 选中正文任意文字 → 浮出「❝ 引用提问」点击即挂引用并打开对话框;或选中后点右下角「问 AI」/输入框(自动捕获)→ 引用 chip 挂上 → 输入问题发送。
        🎨 浮层菜单自定义:本 demo 把按钮文案换成了「引用提问」(i18n.messages 键级覆盖)、配色改成墨绿(宿主 CSS 覆盖,见 App.vue 末尾非 scoped style)。
        📸 截图演示:URL 加 ?shot=1 声明多模态,agent 获得 take_screenshot 视觉验证能力(纯文本模型走识图转述)
      </div>
    </header>

    <article class="docs-article">
      <h2>1. 注意力机制直观理解</h2>
      <p>注意力机制的核心思想是:处理序列中某个位置的表示时,不再只依赖固定维度的隐状态,而是动态地「查询」整个序列中与当前位置相关的信息。每个 token 会发出一个查询向量(query),同时所有 token 都提供键向量(key)和值向量(value)。query 与每个 key 做点积得到相关性分数,经 softmax 归一化为权重后,对所有 value 加权求和,得到该位置的输出表示。</p>
      <p>这种机制的优势在于:第一,任意两个位置之间的信息传递路径长度为常数 1,解决了 RNN 长程依赖衰减的问题;第二,计算可以完全并行化,与现代 GPU/TPU 的矩阵运算能力高度契合;第三,权重是输入的动态函数,同一模型处理不同句子时关注点不同,表达能力远强于固定权重的卷积核。</p>
      <p>工程实践中需要注意,注意力矩阵的空间复杂度是序列长度的平方 —— 这意味着把上下文窗口从 4K 扩展到 128K,朴素实现的显存占用会增长上千倍。后续章节的稀疏注意力、FlashAttention 等改进,本质上都是在不破坏表达能力的前提下回避完整二次矩阵的物化。</p>

      <h2>2. 多头注意力与位置编码</h2>
      <p>单头注意力只能捕捉一种相关性模式。多头注意力将 d_model 维空间切分为 h 个子空间(每头维度 d_model/h),各自独立做注意力后拼接。经验上,不同头会自发分化出语法依存、共指消解、局部邻近等不同关注模式,类似卷积网络的多通道。头数不是越多越好:维度切得太碎会损害每头的表达能力,8 到 64 是常见区间。</p>
      <p>注意力本身是置换不变的 —— 打乱输入顺序,输出也跟着打乱,模型无法区分「猫追狗」和「狗追猫」。位置编码补上这一维度。原始论文用固定正弦编码;后续 BERT 用可学习绝对位置嵌入;RoPE 则把相对位置调制进 query/key 的旋转角,是目前长上下文模型的主流选择,配合 NTK-aware 插值可以在不重训的情况下外推上下文长度。</p>

      <h2>3. 训练目标与预训练数据</h2>
      <p>Decoder-only 架构(如 GPT 系列)使用标准的下一 token 预测损失:给定前 t 个 token,预测第 t+1 个。这个看似简单的目标在数据规模足够大时涌现出惊人的通用能力。数据配比比总量更关键:常见的做法是按来源分层采样(网页/代码/论文/书籍各占配额),再做去重(MinHash 或后缀数组)、质量过滤(分类器打分或启发式规则)与毒性过滤。代码数据的比例被反复证明对推理能力有超比例的贡献。</p>
      <p>学习率调度普遍采用预热加余弦衰减:前几千步线性升温避免早期不稳定,之后按余弦曲线衰减到峰值的十分之一左右。优化器从 SGD 全面转向 AdamW 及其变体;权重衰减、梯度裁剪(按全局范数裁到 1.0 附近)与 dropout 是三项仍然广泛使用的正则手段。</p>

      <h2>4. 推理优化:KV Cache 与采样</h2>
      <p>自回归生成时,已生成 token 的 key/value 可以缓存避免重复计算,这就是 KV Cache。它以显存换速度:每层每头都要存历史序列的 K/V,批量服务时 cache 管理成为显存的主要矛盾。PagedAttention 把 cache 切成固定页按需分配,显著降低内部碎片,是 vLLM 等高吞吐推理框架的基石;多查询注意力(MQA)与分组查询注意力(GQA)则直接减少 K/V 头数,把 cache 压缩数倍,已被主流开源模型采纳。</p>
      <p>采样策略上,温度缩放调整分布尖锐度,top-p(核采样)从累计概率角度截断候选集,top-k 固定候选数。需要事实性输出的场景(代码、JSON、数学)用低温甚至贪婪解码;开放式写作用 0.7 到 1.0 的高温配合核采样。重复惩罚与频率惩罚用于抑制复读,但对代码类输出要慎用 —— 合法的重复(如对齐空格、相似结构)会被误伤。</p>

      <h2>5. 常用配置项速查</h2>
      <p>下表汇总微调与推理时最常调整的配置项(答案细节藏在这里 —— 直接问 agent「本页的配置项有哪些」,看它能否用 read_page 找到这张表)。</p>
      <table class="docs-table">
        <thead><tr><th>配置项</th><th>作用</th><th>默认值</th><th>调参建议</th></tr></thead>
        <tbody>
          <tr><td>temperature</td><td>分布尖锐度</td><td>1.0</td><td>事实性任务 0.1-0.3;创作 0.7-1.0</td></tr>
          <tr><td>top_p</td><td>核采样累计概率阈值</td><td>0.9</td><td>与温度二选一调整,避免同时大改</td></tr>
          <tr><td>top_k</td><td>固定候选集大小</td><td>50</td><td>长尾分布可调大;通常不动</td></tr>
          <tr><td>repeat_penalty</td><td>复读抑制强度</td><td>1.1</td><td>代码生成建议关到 1.0</td></tr>
          <tr><td>max_tokens</td><td>单次生成上限</td><td>视模型而定</td><td>长文输出预留 4096 以上</td></tr>
          <tr><td>context_window</td><td>上下文窗口</td><td>模型默认</td><td>长文档 RAG 场景优先大窗口</td></tr>
        </tbody>
      </table>

      <h2>6. 常见误区</h2>
      <p>误区一:把上下文窗口当内存用。窗口内的信息存在「迷失在中间」现象 —— 首尾位置的信息利用率显著高于中段,关键指令应放在开头或结尾。误区二:忽视 tokenizer 差异。同一句话在不同 tokenizer 下 token 数可差 30%,中文尤甚;按 token 估算成本与截断长度时必须用目标模型的 tokenizer。误区三:微调小数据集不控制学习率。少于一万条样本时,全参数微调很容易把预训练能力冲掉,优先用 LoRA 等参数高效方法,学习率压到 1e-4 以下。</p>
      <p>误区四:认为注意力权重可以当解释用。注意力权重与输出之间的因果链并不成立,扰动实验显示权重重新分配后输出可以不变;做解释性分析时应结合梯度归因或扰动方法交叉验证,单看注意力热力图得出的结论经常误导。</p>

      <h2>7. 延伸阅读路线</h2>
      <p>按依赖顺序推荐:先读 Attention Is All You Need 原文建立整体框架;再读 GPT-2/GPT-3 的扩展性分析理解规模法则;然后是 RoPE 与 ALiBi 两篇位置编码工作;推理侧读 FlashAttention 的 IO 感知设计(软件层面的显存层级优化教科书)与 PagedAttention 的操作系统式 cache 管理;最后按需深入稀疏注意力(MoE 路线则读 Switch Transformer 与 GShard)。</p>
      <p>动手路线:用两三百行代码手写一个字符级 GPT(参考 nanoGPT 的结构),过一遍数据准备、训练循环、采样生成的全流程;再把它改成支持 KV Cache 的版本,亲测加速比;最后接一个真实 tokenizer,对比训练动态。这个练手的价值远超读十篇论文。</p>
    </article>

    <!-- 宿主侧「问 AI」入口:show() 打开抽屉并懒捕获当前选区。
         @mousedown.prevent 是关键 —— 浏览器点按默认动作会塌缩文档选区(选区没了 show() 捕获不到),
         阻止 mousedown 默认行为保住划词,click 照常触发(划词翻译类产品同款手法) -->
    <button class="ask-btn" data-test="ask-btn" @mousedown.prevent @click="openAsk">问 AI</button>
    <div id="chat-root" ref="root"></div>
  </div>
</template>

<style scoped>
.docs-page { max-width: 780px; margin: 0 auto; padding: 24px 20px 120px; }
.docs-hero h1 { font-size: 26px; margin: 12px 0 4px; }
.docs-meta { color: #6b7280; font-size: 13px; margin: 0 0 10px; }
.docs-tip {
  background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #374151; margin-bottom: 20px;
}
.docs-article h2 { font-size: 19px; margin: 28px 0 10px; }
.docs-article p { font-size: 14.5px; line-height: 1.85; color: #1f2937; margin: 0 0 12px; }
.docs-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0 16px; }
.docs-table th, .docs-table td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
.docs-table th { background: #f9fafb; }
.ask-btn {
  position: fixed; right: 28px; bottom: 96px; z-index: 30;
  padding: 10px 18px; border-radius: 999px; border: none; cursor: pointer;
  background: #1f4d3a; color: #fff; font-size: 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.ask-btn:hover { background: #2a6350; }
</style>

<!-- 浮层菜单配色自定义(演示点 ④):必须独立一个**非 scoped** style —— 浮条 Teleport 到 body,不在本组件
     模板子树里,scoped 的 `[data-v-xxx]` 属性和 :deep() 都选不中它。
     另一个坑:SDK 产物规则是 `.chat-selection-menu-btn[data-v-yyy]`(特异性 0,2,0),单类名覆盖(0,1,0)必输;
     这里用「双类名」提到同分(0,2,0),再靠样式表顺序(宿主 css 在 SDK css 之后)取胜 —— 顺序不稳时加 !important -->
<style>
.chat-selection-menu .chat-selection-menu-btn {
  background: #1f4d3a; color: #fff; border-color: transparent; border-radius: 8px; font-weight: 600;
}
.chat-selection-menu .chat-selection-menu-btn:hover { background: #2a6350; }
/* 容器同理:双类名提权,调 z-index 等 */
.chat-selection-menu.chat-selection-menu { z-index: 2147483001; }
</style>
