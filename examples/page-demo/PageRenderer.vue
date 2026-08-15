<script setup lang="ts">
/**
 * 页面渲染器 —— 接收 page 作为 prop(普通对象,非 reactive)
 *
 * App.vue 在 onEvent('data_change') 时 tick++,以 :key="tick" 强制本组件重建,
 * 重建时读最新 page prop 渲染。展示「非 Vue 响应式 bind」集成模式:
 * SDK 工具直接改普通对象,UI 刷新由集成方(此处为 :key 重渲染)负责。
 *
 * 单组件渲染(含容器递归嵌套)在 PageComponentView;本组件只负责页面骨架 + 点击代理。
 * 两步拾取(focus-context):点组件本体 → emit('select') → 父 selectedPath(浮层显示边框 + 加入聊天按钮);
 * 点「💬 加入聊天」按钮 → emit('focus') → 父调 sdk.setFocus 聚焦该组件精修。
 * 嵌套子组件各自带 data-path(closest 取最内层,点子组件选中的就是子组件)。
 */
import { ref } from 'vue'
import type { PageData } from './pageSchema'
import PageComponentView from './PageComponentView.vue'
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
      <PageComponentView
        v-for="(c, i) in page.components"
        :key="i"
        :comp="c"
        :path="`components.${i}`"
        @select="emit('select', $event)"
        @focus="emit('focus', $event)"
      />
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
</style>
