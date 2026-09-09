/** 构造 ~500KB 模拟页面 bind(components 数组 + code 字段,editor 类宿主形态) */
export function makeBind(targetBytes = 500 * 1024): any {
  const components: any[] = []
  let total = 0
  let i = 0
  while (total < targetBytes) {
    const code = `<!-- 组件 ${i} -->\n<div class="comp-${i}">\n  <style>.c${i}{color:#333;padding:8px}</style>\n  <h3>标题 ${i}</h3>\n  <p>一些中文描述文本,用于模拟真实组件的体积与内容分布。</p>\n  <button data-id="${i}">按钮 ${i}</button>\n</div>\n`.repeat(3 + (i % 5))
    const c = {
      id: `comp-${i}`,
      type: ['hero', 'card', 'list', 'banner', 'footer'][i % 5],
      title: `组件标题 ${i}`,
      visible: i % 2 === 0,
      props: {
        width: 320 + i, height: 200 + (i % 3) * 40, theme: i % 2 ? 'dark' : 'light',
        style: `margin:${i % 4 * 8}px;padding:${i % 3 * 6}px;border-radius:${i % 5 * 2}px`,
        items: Array.from({ length: 3 + (i % 4) }, (_, j) => ({ label: `项${i}-${j}`, value: (i * 10 + j).toString(), active: j === 0 })),
        code,
      },
      __pgId: `pg_${(i * 7919).toString(36)}`,
    }
    components.push(c)
    total += JSON.stringify(c).length
    i++
  }
  return {
    page: { title: '活动专题页', version: 4, locale: 'zh-CN', updatedAt: '2026-09-09T10:00:00Z' },
    theme: { primary: '#5b6cff', radius: 8, fonts: ['system-ui', 'sans-serif'] },
    components,
  }
}
