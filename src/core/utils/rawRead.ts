/**
 * reactive 读侧单点解包(C1,2026-09-09 六路审计 perf N4 落定)
 *
 * 实测(501KB bind,Bench A):reactive proxy 的每次全树值语义读(deepClone/stringify/hashValue/
 * watchFieldsHash/structuredClone)恒 +4~5ms(3-10× 放大;structuredClone 对 proxy 直接抛 DataCloneError
 * → checkpoint 恒落 5.4× 慢的 JSON 兜底);`toRaw()` 单点解包几乎 100% 回收(≈plain)。
 *
 * 使用纪律:
 *  - **只给值语义读**(hash/clone/stringify/深投影/查询求值)用 —— raw 目标与 proxy 是同一对象,
 *    写经 proxy 会反映到 raw(无陈旧问题),但读 raw 不建立依赖收集(本 SDK 核心无 watch/computed 读 bind,
 *    依赖收集风险实测为零;宿主对 bind 的响应式消费不经本通道)
 *  - **禁用于写路径的顶层替换**、以及把 raw 引用交给宿主/外部消费方(响应式面契约由 proxy 保)
 *  - 非 reactive 输入恒等返回(幂等);嵌套 reactive 只解顶层 —— reactive 代理按访问惰性创建,顶层 raw
 *    目标的嵌套属性即原对象(除非宿主显式把 reactive 值塞进 bind,该形态由调用方各自的 JSON 兜底接住)
 */
import { toRaw } from 'vue'

/** reactive 读侧解包(vue toRaw 直通;非 proxy 恒等返回) */
export function rawRead<T>(v: T): T {
  return toRaw(v as unknown as object) as unknown as T
}
