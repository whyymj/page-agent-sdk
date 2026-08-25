<script setup lang="ts">
/**
 * 属性编辑面板(手动编辑三件套之 ③)—— 选中组件后出现,直接改 window.page(reactive 就地改,视图即时刷新)
 *
 * 与 AI 通道的关系:宿主直改 bind 是「宿主自有数据,host 权限」合法路径(同 resetPage/拖拽);
 * 面板编辑不经过 SDK write 契约(无 schema 校验/快照),宿主对自己的数据负责。
 *
 * 字段编辑形态按值类型自适应:标量(string/number/boolean)直改;对象/数组走 JSON 缓冲(失焦解析,
 * 解析失败红框不动数据);children(容器子组件)不提供 JSON 直改(体积大且结构敏感,经拖拽/删除管理)。
 */
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'deleted', path: string): void
  (e: 'lift', path: string): void
}>()

const w = window as any
const page = w.page as Record<string, any>

/** 按 path 解析组件节点(reactive 追踪:依赖的数组/对象访问建立响应) */
const comp = computed<Record<string, any> | null>(() => {
  const node = props.path.split('.').reduce<unknown>((o, k) => (o == null || typeof o !== 'object' ? undefined : (o as Record<string, any>)[k]), page)
  return (node && typeof node === 'object') ? node as Record<string, any> : null
})
/** 是否顶层组件(components.N 无嵌套段) */
const isTop = computed(() => /^components\.\d+$/.test(props.path))
/** 容器子组件数(props.children 数组) */
const childCount = computed(() => (Array.isArray(comp.value?.props?.children) ? comp.value.props.children.length : null))

/** props 键列表(children 排除,单独展示;reactive keys 追踪增删) */
const propKeys = computed(() => {
  const p = comp.value?.props
  if (!p || typeof p !== 'object') return []
  return Object.keys(p).filter((k) => k !== 'children')
})

// ===== JSON 缓冲(对象/数组值):失焦解析写回,解析失败保持红框不动数据 =====
const jsonBuf = reactive<Record<string, { text: string; error: string | null }>>({})
watch(() => props.path, () => { for (const k of Object.keys(jsonBuf)) delete jsonBuf[k] })
watch(propKeys, () => {
  for (const k of propKeys.value) {
    const v = comp.value?.props?.[k]
    if ((v && typeof v === 'object') && !jsonBuf[k]) jsonBuf[k] = { text: JSON.stringify(v, null, 2), error: null }
  }
  for (const k of Object.keys(jsonBuf)) if (!propKeys.value.includes(k)) delete jsonBuf[k]
}, { immediate: true })

/** 标量写回(类型保持:number 回转 number;空串对 number 视为 0) */
function setScalar(k: string, v: unknown, kind: 'string' | 'number' | 'boolean') {
  const p = comp.value?.props as Record<string, unknown> | undefined
  if (!p) return
  if (kind === 'number') p[k] = Number(v) || 0
  else p[k] = v
}
/** JSON 缓冲提交:解析成功写回并清错;失败标红不动数据 */
function commitJson(k: string) {
  const buf = jsonBuf[k]
  const p = comp.value?.props as Record<string, unknown> | undefined
  if (!buf || !p) return
  try {
    p[k] = JSON.parse(buf.text)
    buf.error = null
  } catch (e) {
    buf.error = `JSON 解析失败:${e instanceof Error ? e.message : String(e)}(未写入)`
  }
}

// ===== 新增属性 =====
const newKey = ref('')
const newVal = ref('')
const newError = ref<string | null>(null)
function addProp() {
  const p = comp.value?.props as Record<string, unknown> | undefined
  const k = newKey.value.trim()
  if (!p || !k) { newError.value = '键名不能为空'; return }
  if (k in p) { newError.value = `键已存在:${k}`; return }
  try {
    p[k] = JSON.parse(newVal.value.trim() === '' ? '""' : newVal.value)
    newKey.value = ''; newVal.value = ''; newError.value = null
  } catch (e) {
    newError.value = `值必须是合法 JSON:${e instanceof Error ? e.message : String(e)}(字符串记得带引号,如 "红色")`
  }
}
function removeProp(k: string) {
  const p = comp.value?.props as Record<string, unknown> | undefined
  if (p) delete p[k]
}
</script>

<template>
  <div v-if="comp" class="pp">
    <div class="pp-head">
      <b>🛠 {{ comp.type }}{{ comp.name ? ` · ${comp.name}` : '' }}</b>
      <code class="pp-path">{{ path }}</code>
      <button class="pp-x" title="关闭" @click="emit('close')">✕</button>
    </div>

    <div class="pp-actions">
      <button v-if="!isTop" class="pp-btn" @click="emit('lift', path)">⬆ 提升到顶层末尾</button>
      <button class="pp-btn pp-danger" @click="emit('deleted', path)">🗑 删除组件</button>
      <span v-if="childCount !== null" class="pp-children">📦 {{ childCount }} 个子组件(拖拽组件到容器中部可加入/调序)</span>
    </div>

    <div class="pp-body">
      <div v-for="k in propKeys" :key="k" class="pp-row">
        <label class="pp-key" :title="k">{{ k }}</label>
        <template v-if="comp.props[k] !== null && typeof comp.props[k] === 'object'">
          <textarea class="pp-json" :class="{ 'pp-err': jsonBuf[k]?.error }" rows="3" spellcheck="false"
            :value="jsonBuf[k]?.text ?? ''"
            @input="jsonBuf[k] && (jsonBuf[k].text = ($event.target as HTMLTextAreaElement).value)"
            @blur="commitJson(k)" />
          <div v-if="jsonBuf[k]?.error" class="pp-errmsg">{{ jsonBuf[k].error }}</div>
        </template>
        <input v-else-if="typeof comp.props[k] === 'boolean'" type="checkbox" :checked="!!comp.props[k]"
          @change="setScalar(k, ($event.target as HTMLInputElement).checked, 'boolean')" />
        <input v-else-if="typeof comp.props[k] === 'number'" class="pp-input" type="number" :value="comp.props[k]"
          @change="setScalar(k, ($event.target as HTMLInputElement).value, 'number')" />
        <textarea v-else-if="String(comp.props[k] ?? '').length > 80 || String(comp.props[k] ?? '').includes('\n')"
          class="pp-json" rows="3" spellcheck="false" :value="String(comp.props[k] ?? '')"
          @change="setScalar(k, ($event.target as HTMLTextAreaElement).value, 'string')" />
        <input v-else class="pp-input" :value="String(comp.props[k] ?? '')"
          @change="setScalar(k, ($event.target as HTMLInputElement).value, 'string')" />
        <button class="pp-del" title="删除属性" @click="removeProp(k)">✕</button>
      </div>

      <div class="pp-add">
        <input class="pp-input pp-add-k" v-model="newKey" placeholder="新属性名(如 title)" />
        <input class="pp-input pp-add-v" v-model="newVal" placeholder='JSON 值(如 "红色" / 3 / {"a":1})' @keyup.enter="addProp" />
        <button class="pp-btn" @click="addProp">添加</button>
        <div v-if="newError" class="pp-errmsg">{{ newError }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pp { border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; margin-bottom: 14px; padding: 12px 14px; }
.pp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pp-head b { font-size: 14px; color: #111827; }
.pp-path { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
.pp-x { margin-left: auto; border: none; background: none; cursor: pointer; color: #6b7280; font-size: 14px; }
.pp-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed #e5e7eb; }
.pp-btn { border: 1px solid #d1d5db; background: #f9fafb; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #374151; }
.pp-btn:hover { background: #f3f4f6; }
.pp-danger { border-color: #fca5a5; color: #b91c1c; }
.pp-danger:hover { background: #fef2f2; }
.pp-children { font-size: 11px; color: #6b7280; }
.pp-body { display: flex; flex-direction: column; gap: 8px; }
.pp-row { display: grid; grid-template-columns: 110px 1fr 24px; gap: 6px; align-items: start; }
.pp-key { font-size: 12px; color: #374151; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 4px; }
.pp-input { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 8px; font-size: 12px; width: 100%; box-sizing: border-box; }
.pp-json { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 8px; font-size: 11px; width: 100%; box-sizing: border-box; font-family: 'SF Mono', Monaco, Consolas, monospace; resize: vertical; }
.pp-err { border-color: #ef4444 !important; }
.pp-errmsg { grid-column: 2 / 4; font-size: 11px; color: #b91c1c; }
.pp-del { border: none; background: none; color: #9ca3af; cursor: pointer; font-size: 12px; padding-top: 4px; }
.pp-del:hover { color: #b91c1c; }
.pp-add { display: grid; grid-template-columns: 110px 1fr 56px; gap: 6px; align-items: center; margin-top: 4px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }
.pp-add .pp-errmsg { grid-column: 1 / 4; }
</style>
