<script setup lang="ts">
defineProps<{ time: string }>()
</script>

<template>
  <div class="message-time">{{ time }}</div>
</template>

<style scoped>
.message-time { font-size: 11px; color: #9ca3af; margin-top: 4px; padding: 0 4px; }
</style>
