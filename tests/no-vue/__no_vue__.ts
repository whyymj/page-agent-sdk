/* vue 解析哨兵(E2 no-vue 探针):tsconfig paths 把 'vue' 映射到本文件 —— 存在但零导出。
 * 若 types/*.d.ts 回退引用了真 vue(from 'vue' / import('vue').X),成员访问在此编译单元
 * 报 TS2305(has no exported member)/ TS2339 —— 比指向不存在文件可靠:paths miss 时 TS 会
 * 回退 node_modules 解析(devDep 里有 vue),空哨兵才真正挡住。
 */
export {}
