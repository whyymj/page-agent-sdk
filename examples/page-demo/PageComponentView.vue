<script setup lang="ts">
/**
 * 单个组件渲染(递归):按 type 渲染叶子组件;容器组件(card/carousel/waterfall)递归渲染 children。
 * 每个元素带 data-path(嵌套子组件路径 components.N.children.M...),供两步拾取/聚焦定位。
 * 文件名隐式自引用(script setup 递归组件无需 import 自身)。
 */
import { ref } from 'vue'
import type { PageComponent } from './pageSchema'

defineProps<{ comp: PageComponent; path: string }>()
const emit = defineEmits<{
  (e: 'select', path: string): void
  (e: 'focus', path: string): void
}>()

// 轮播当前页(局部状态;data_change 重渲染时随组件重建归零)
const slide = ref(0)
</script>

<template>
  <!-- 标题(level 1-4 分档,>4 归 h4) -->
  <h1 v-if="comp.type === 'heading' && (comp.level ?? 2) === 1" class="comp comp-h1" :data-path="path">{{ comp.text }}</h1>
  <h2 v-else-if="comp.type === 'heading' && (comp.level ?? 2) === 2" class="comp comp-h2" :data-path="path">{{ comp.text }}</h2>
  <h3 v-else-if="comp.type === 'heading' && (comp.level ?? 2) === 3" class="comp comp-h3" :data-path="path">{{ comp.text }}</h3>
  <h4 v-else-if="comp.type === 'heading'" class="comp comp-h4" :data-path="path">{{ comp.text }}</h4>
  <p v-else-if="comp.type === 'paragraph'" class="comp comp-paragraph" :data-path="path">{{ comp.text }}</p>
  <button
    v-else-if="comp.type === 'button'"
    class="comp comp-button"
    :data-variant="comp.variant || 'primary'"
    :data-path="path"
  >
    {{ comp.label }}
  </button>
  <img v-else-if="comp.type === 'image'" class="comp comp-image" :src="comp.src" :alt="comp.alt || ''" :data-path="path" />
  <ul v-else-if="comp.type === 'list'" class="comp comp-list" :data-path="path">
    <li v-for="(it, j) in comp.items" :key="j">{{ it }}</li>
  </ul>
  <!-- 卡片(可选 children 嵌套) -->
  <div v-else-if="comp.type === 'card'" class="comp comp-card" :data-path="path">
    <h3 class="card-title">{{ comp.title }}</h3>
    <p class="card-text">{{ comp.text }}</p>
    <div v-if="comp.children?.length" class="card-children">
      <PageComponentView
        v-for="(c, i) in comp.children"
        :key="i"
        :comp="c"
        :path="`${path}.children.${i}`"
        @select="emit('select', $event)"
        @focus="emit('focus', $event)"
      />
    </div>
  </div>
  <!-- 轮播(children 每项一页;‹ › 切换,click.stop 防触发选中) -->
  <div v-else-if="comp.type === 'carousel'" class="comp comp-carousel" :data-path="path">
    <div v-if="comp.children.length" class="carousel-stage">
      <PageComponentView
        :comp="comp.children[slide % comp.children.length]"
        :path="`${path}.children.${slide % comp.children.length}`"
        @select="emit('select', $event)"
        @focus="emit('focus', $event)"
      />
    </div>
    <div v-if="comp.children.length > 1" class="carousel-nav" @click.stop>
      <button class="nav-btn" @click="slide = (slide - 1 + comp.children.length) % comp.children.length">‹</button>
      <span class="nav-pos">{{ slide + 1 }} / {{ comp.children.length }}</span>
      <button class="nav-btn" @click="slide = (slide + 1) % comp.children.length">›</button>
    </div>
  </div>
  <!-- 瀑布流(CSS columns 分列;子项 break-inside 防跨列断裂) -->
  <div v-else-if="comp.type === 'waterfall'" class="comp comp-waterfall" :data-path="path" :style="{ columnCount: comp.columns ?? 2 }">
    <div v-for="(c, i) in comp.children" :key="i" class="wf-item">
      <PageComponentView
        :comp="c"
        :path="`${path}.children.${i}`"
        @select="emit('select', $event)"
        @focus="emit('focus', $event)"
      />
    </div>
  </div>
  <!-- 纯代码组件(沙箱 iframe 渲染自包含 HTML,与宿主隔离) -->
  <div v-else-if="comp.type === 'custom'" class="comp comp-custom" :data-path="path">
    <iframe class="custom-frame" sandbox="allow-scripts" :srcdoc="comp.code" :title="comp.name || 'custom'"></iframe>
  </div>
</template>

<style scoped>
.comp { margin: 12px 0; }
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
.card-children { margin-top: 12px; }
.card-children .comp { margin: 8px 0; }
/* 轮播:舞台 + 底部导航 */
.comp-carousel {
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 10px;
  padding: 16px;
}
.carousel-stage .comp { margin: 0; }
.carousel-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 12px;
  opacity: 0.85;
}
.nav-btn {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.nav-btn:hover { background: rgba(127, 127, 127, 0.12); }
.nav-pos { font-size: 12px; }
/* 瀑布流:CSS columns;子项防断裂 */
.comp-waterfall { column-gap: 14px; }
.wf-item { break-inside: avoid; margin-bottom: 14px; }
.wf-item .comp { margin: 0; }
.wf-item .comp-card { margin-bottom: 0; }
/* 纯代码组件:沙箱 iframe */
.comp-custom {
  border: 1px dashed rgba(127, 127, 127, 0.4);
  border-radius: 10px;
  overflow: hidden;
}
.custom-frame {
  width: 100%;
  min-height: 140px;
  border: none;
  display: block;
  background: #fff;
}
</style>
