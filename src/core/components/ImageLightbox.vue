<!--
  页内大图查看器(lightbox):截图缩略图/用户贴图点击放大(2026-09-20)。
  背景:原实现 `<a href="data:..." target="_blank">` —— 浏览器拦截 data: URI 开新窗(Chrome 拒顶级 data:
  导航),降级成当前页跳转:地址栏变 base64、页面空白。改为页内 overlay(Teleport 到 body,不受宿主
  容器 overflow/contain 裁剪):点击遮罩 / ✕ / Esc 关闭,原图可右键另存(@click.stop 不冒泡)。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps<{ src?: string; alt?: string; closeTitle?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 打开期间锁定 body 滚动(保存原值,关闭/卸载还原) */
let prevOverflow = ''
const lockScroll = (on: boolean): void => {
  if (typeof document === 'undefined') return
  if (on) { prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  else if (prevOverflow !== '') { document.body.style.overflow = prevOverflow; prevOverflow = '' }
}
watch(() => props.src, (v) => lockScroll(!!v), { immediate: true })
onBeforeUnmount(() => lockScroll(false))

/** Esc 关闭(常驻监听,src 空时 no-op;组件实例随宿主消息行存活,开销可忽略) */
const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape' && props.src) emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="src" class="pg-image-viewer" data-test="image-viewer" @click="emit('close')">
      <img class="pg-image-viewer-img" :src="src" :alt="alt" @click.stop />
      <button type="button" class="pg-image-viewer-close" :title="closeTitle" :aria-label="closeTitle" @click="emit('close')">✕</button>
    </div>
  </Teleport>
</template>

<style scoped>
.pg-image-viewer {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(15, 15, 20, 0.82); cursor: zoom-out;
}
.pg-image-viewer-img {
  max-width: 92vw; max-height: 92vh; border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5); cursor: default;
}
.pg-image-viewer-close {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3); background: rgba(0, 0, 0, 0.55);
  color: #fff; font-size: 14px; line-height: 1; cursor: pointer;
}
.pg-image-viewer-close:hover { background: rgba(0, 0, 0, 0.8); }
</style>
