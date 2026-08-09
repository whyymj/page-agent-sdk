<script setup lang="ts">
/**
 * 页面渲染器 —— 接收 page 作为 prop(普通对象,非 reactive)
 *
 * App.vue 在 onEvent('data_change') 时 tick++,以 :key="tick" 强制本组件重建,
 * 重建时读最新 page prop 渲染。展示「非 Vue 响应式 bind」集成模式:
 * SDK 工具直接改普通对象,UI 刷新由集成方(此处为 :key 重渲染)负责。
 *
 * 两步拾取(focus-context):点组件本体 → emit('select') → 父 selectedPath(浮层显示边框 + 加入聊天按钮);
 * 点「💬 加入聊天」按钮 → emit('focus') → 父调 sdk.setFocus 聚焦该组件精修。
 */
import { ref } from 'vue'
import type { PageData } from './pageSchema'
import PickOverlay from '../_shared/PickOverlay.vue'

defineProps<{ page: PageData; selectedPath?: string | null }>()
const emit = defineEmits<{
  (e: 'select', path: string): void
  (e: 'focus', path: string): void
}>()

const bodyRef = ref<HTMLElement>()
function onBodyClick(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null
  const p = el?.getAttribute('data-path')
  if (p) emit('select', p)
}
</script>

<template>
  <div class="pr" :data-theme="page.theme || 'light'">
    <h1 class="pr-title">{{ page.title }}</h1>
    <div ref="bodyRef" class="pr-body" @click="onBodyClick">
      <template v-for="(c, i) in page.components" :key="i">
        <h1 v-if="c.type === 'heading' && (c.level ?? 2) === 1" class="comp comp-h1" :data-path="`components.${i}`">{{ c.text }}</h1>
        <h2 v-else-if="c.type === 'heading' && (c.level ?? 2) === 2" class="comp comp-h2" :data-path="`components.${i}`">{{ c.text }}</h2>
        <h3 v-else-if="c.type === 'heading' && (c.level ?? 2) === 3" class="comp comp-h3" :data-path="`components.${i}`">{{ c.text }}</h3>
        <h4 v-else-if="c.type === 'heading'" class="comp comp-h4" :data-path="`components.${i}`">{{ c.text }}</h4>
        <p v-else-if="c.type === 'paragraph'" class="comp comp-paragraph" :data-path="`components.${i}`">{{ c.text }}</p>
        <button
          v-else-if="c.type === 'button'"
          class="comp comp-button"
          :data-variant="c.variant || 'primary'"
          :data-path="`components.${i}`"
        >
          {{ c.label }}
        </button>
        <img v-else-if="c.type === 'image'" class="comp comp-image" :src="c.src" :alt="c.alt || ''" :data-path="`components.${i}`" />
        <ul v-else-if="c.type === 'list'" class="comp comp-list" :data-path="`components.${i}`">
          <li v-for="(it, j) in c.items" :key="j">{{ it }}</li>
        </ul>
        <div v-else-if="c.type === 'card'" class="comp comp-card" :data-path="`components.${i}`">
          <h3 class="card-title">{{ c.title }}</h3>
          <p class="card-text">{{ c.text }}</p>
        </div>
      </template>
    </div>
    <!-- 两步拾取浮层:选中态边框 + 「💬 加入聊天」按钮(点按钮才聚焦) -->
    <PickOverlay :selected-path="selectedPath ?? null" :container="bodyRef ?? null" @focus="emit('focus', $event)" />
  </div>
</template>

<style scoped>
.pr {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 10px;
  min-height: calc(100vh - 48px);
}
.pr[data-theme='dark'] {
  background: #16181d;
  color: #e5e7eb;
}
.pr[data-theme='light'] {
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.pr-title {
  font-size: 20px;
  opacity: 0.6;
  border-bottom: 1px dashed currentColor;
  padding-bottom: 8px;
  margin-bottom: 16px;
  font-weight: 500;
}
.comp {
  margin: 12px 0;
}
.comp-h1 { font-size: 30px; font-weight: 700; }
.comp-h2 { font-size: 24px; font-weight: 700; }
.comp-h3 { font-size: 20px; font-weight: 600; }
.comp-h4 { font-size: 17px; font-weight: 600; }
.comp-paragraph { line-height: 1.7; opacity: 0.85; }
.comp-button {
  padding: 8px 18px;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
  margin: 4px 8px 4px 0;
}
.comp-button[data-variant='primary'] { background: #4f46e5; color: #fff; }
.comp-button[data-variant='secondary'] { background: #e5e7eb; color: #1a1a1a; }
.comp-button[data-variant='ghost'] { background: transparent; border: 1px solid currentColor; }
.comp-image { max-width: 100%; border-radius: 8px; }
.comp-list { padding-left: 22px; line-height: 1.8; }
.comp-list li { margin: 4px 0; }
.comp-card {
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 10px;
  padding: 16px;
}
.comp-card .card-title { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
.comp-card .card-text { margin: 0; opacity: 0.85; line-height: 1.6; }
</style>
