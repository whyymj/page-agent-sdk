import { extractText } from '../../mcp/client'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// mcp(extractText 纯函数:MCP callTool 结果 → 文本)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx;
  console.log('\n[mcp]')
  {
    assert(extractText({ content: [{ type: 'text', text: 'hello' }] }) === 'hello', 'extractText: 单 text 提取')
    assert(
      extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }) === 'a\nb',
      'extractText: 多 text 换行拼接',
    )
    assert(extractText({ content: [{ type: 'image', data: 'abc123' }] }) === '[image:abc123…]', 'extractText: image 占位')
    assert(extractText({ content: [] }) === '', 'extractText: 空 content → 空串')
    assert(extractText({} as any) === '', 'extractText: 无 content 字段 → 空串')
    const err = extractText({ content: [{ type: 'text', text: '失败原因' }], isError: true })
    assert(/工具错误/.test(err) && /失败原因/.test(err), 'extractText: isError 标注"工具错误"')
    assert(extractText({ content: [{ type: 'resource', resource: { text: 'res' } }] }) === 'res', 'extractText: resource.text 提取')
  }
}
