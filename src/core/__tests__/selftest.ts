/**
 * 自测脚本 —— 验证 SDK 核心逻辑(不依赖 LLM/浏览器)
 * 运行:npm test(tsx 跑,esbuild bundle → node)
 * 测试代码按模块拆分在 ./modules/*.ts,本文件为 runner:setup + 依次调用各模块 + 汇总
 */
import { run as run_sec_01 } from './modules/sec-01'
import { run as run_sec_02 } from './modules/sec-02'
import { run as run_sec_03 } from './modules/sec-03'
import { run as run_sec_04 } from './modules/sec-04'
import { run as run_sec_05 } from './modules/sec-05'
import { run as run_sec_06 } from './modules/sec-06'
import { run as run_sec_07 } from './modules/sec-07'
import { run as run_sec_08 } from './modules/sec-08'
import { run as run_sec_09 } from './modules/sec-09'
import { run as run_sec_10 } from './modules/sec-10'
import { run as run_sec_11 } from './modules/sec-11'
import { run as run_sec_12 } from './modules/sec-12'
import { run as run_sec_13 } from './modules/sec-13'
import { run as run_sec_14 } from './modules/sec-14'
import { run as run_sec_15 } from './modules/sec-15'
import { run as run_sec_16 } from './modules/sec-16'
import { run as run_sec_17 } from './modules/sec-17'
import { run as run_sec_18 } from './modules/sec-18'
import { run as run_sec_19 } from './modules/sec-19'
import { run as run_sec_20 } from './modules/sec-20'
import { run as run_sec_21 } from './modules/sec-21'
import { run as run_sec_22 } from './modules/sec-22'
import { run as run_sec_23 } from './modules/sec-23'
import { run as run_sec_24 } from './modules/sec-24'
import { run as run_sec_25 } from './modules/sec-25'
import { run as run_sec_26 } from './modules/sec-26'
import { run as run_sec_27 } from './modules/sec-27'
import { run as run_sec_28 } from './modules/sec-28'
import { run as run_sec_29 } from './modules/sec-29'
import { run as run_sec_30 } from './modules/sec-30'
import { run as run_sec_31 } from './modules/sec-31'
import { run as run_sec_32 } from './modules/sec-32'
import { run as run_sec_33 } from './modules/sec-33'
import { run as run_sec_34 } from './modules/sec-34'
import { run as run_sec_35 } from './modules/sec-35'
import { run as run_sec_36 } from './modules/sec-36'
import { run as run_sec_37 } from './modules/sec-37'
import { run as run_sec_38 } from './modules/sec-38'
import { run as run_sec_39 } from './modules/sec-39'
import { run as run_sec_40 } from './modules/sec-40'
import { run as run_sec_41 } from './modules/sec-41'
import { run as run_sec_42 } from './modules/sec-42'
import { run as run_sec_43 } from './modules/sec-43'
import { run as run_sec_44 } from './modules/sec-44'
import { run as run_sec_45 } from './modules/sec-45'
import { run as run_sec_46 } from './modules/sec-46'
import { run as run_sec_47 } from './modules/sec-47'
import { run as run_sec_48 } from './modules/sec-48'
import { run as run_sec_49 } from './modules/sec-49'
import { run as run_sec_50 } from './modules/sec-50'
import { run as run_sec_51 } from './modules/sec-51'
import { run as run_sec_52 } from './modules/sec-52'
import { run as run_sec_53 } from './modules/sec-53'
import { run as run_sec_54 } from './modules/sec-54'
import { run as run_sec_55 } from './modules/sec-55'
import { run as run_sec_56 } from './modules/sec-56'
import { run as run_sec_57 } from './modules/sec-57'
import { run as run_sec_58 } from './modules/sec-58'
import { run as run_sec_59 } from './modules/sec-59'
import { run as run_sec_60 } from './modules/sec-60'
import { run as run_sec_61 } from './modules/sec-61'
import { run as run_sec_62 } from './modules/sec-62'
import { run as run_sec_63 } from './modules/sec-63'
import { run as run_sec_64 } from './modules/sec-64'
import { run as run_sec_65 } from './modules/sec-65'
import { run as run_sec_66 } from './modules/sec-66'
import { run as run_sec_67 } from './modules/sec-67'
import { run as run_sec_68 } from './modules/sec-68'
import { run as run_sec_69 } from './modules/sec-69'
import { run as run_sec_70 } from './modules/sec-70'
import { run as run_sec_71 } from './modules/sec-71'
import { run as run_sec_72 } from './modules/sec-72'
import { run as run_sec_73 } from './modules/sec-73'
import { run as run_sec_74 } from './modules/sec-74'
import { run as run_sec_75 } from './modules/sec-75'
import { run as run_sec_76 } from './modules/sec-76'
import { run as run_sec_77 } from './modules/sec-77'
import { run as run_sec_78 } from './modules/sec-78'
	import { run as run_sec_79 } from './modules/sec-79'
import { run as run_sec_80 } from './modules/sec-80'
import { run as run_sec_81 } from './modules/sec-81'
import { run as run_sec_82 } from './modules/sec-82'
import { run as run_sec_83 } from './modules/sec-83'
import { run as run_sec_84 } from './modules/sec-84'
import { run as run_sec_85 } from './modules/sec-85'
import { run as run_sec_86 } from './modules/sec-86'
import { run as run_sec_87 } from './modules/sec-87'
import { run as run_sec_88 } from './modules/sec-88'
import { run as run_sec_89 } from './modules/sec-89'
import { run as run_sec_90 } from './modules/sec-90'
import { run as run_sec_91 } from './modules/sec-91'
import { run as run_sec_92 } from './modules/sec-92'
import { run as run_sec_93 } from './modules/sec-93'
import { run as run_sec_94 } from './modules/sec-94'
import { run as run_sec_95 } from './modules/sec-95'
import { run as run_sec_98 } from './modules/sec-98'
import { run as run_sec_99 } from './modules/sec-99'
import { run as run_sec_100 } from './modules/sec-100'
import { run as run_sec_101 } from './modules/sec-101'
import { run as run_sec_102 } from './modules/sec-102'
import { run as run_sec_103 } from './modules/sec-103'
import { run as run_sec_104 } from './modules/sec-104'
import { run as run_sec_105 } from './modules/sec-105'
import { run as run_sec_106 } from './modules/sec-106'
import { run as run_sec_107 } from './modules/sec-107'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
declare const process: { exit(code?: number): never }

// mock 全局 window(供 verify/checkpoint 旧 windowProps 模式测试 fallback 读;单对象 data 模型的 dataOps 不依赖 window,bind 由 createDataOps({bind}) 传入)
;(globalThis as any).window = { app: { theme: 'light', count: 0 } }

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string): void {
  if (Boolean(cond)) {
    passed++
    console.log('  ✓', msg)
  } else {
    failed++
    console.error('  ✗ FAIL:', msg)
  }
}
async function invoke(tool: any, args: any, config?: unknown): Promise<string> {
  // config 可选:透传工具第二参(sec-82 需注入 configurable.__pgDataScope 模拟主/子 scope)
  return await (config !== undefined ? tool.invoke(args, config) : tool.invoke(args))
}
const byName = (tools: any[]) => Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, any>

const ctx = { assert, invoke, byName }

;(async () => {
  await run_sec_01(ctx)
  await run_sec_02(ctx)
  await run_sec_03(ctx)
  await run_sec_04(ctx)
  await run_sec_05(ctx)
  await run_sec_06(ctx)
  await run_sec_07(ctx)
  await run_sec_08(ctx)
  await run_sec_09(ctx)
  await run_sec_10(ctx)
  await run_sec_11(ctx)
  await run_sec_12(ctx)
  await run_sec_13(ctx)
  await run_sec_14(ctx)
  await run_sec_15(ctx)
  await run_sec_16(ctx)
  await run_sec_17(ctx)
  await run_sec_18(ctx)
  await run_sec_19(ctx)
  await run_sec_20(ctx)
  await run_sec_21(ctx)
  await run_sec_22(ctx)
  await run_sec_23(ctx)
  await run_sec_24(ctx)
  await run_sec_25(ctx)
  await run_sec_26(ctx)
  await run_sec_27(ctx)
  await run_sec_28(ctx)
  await run_sec_29(ctx)
  await run_sec_30(ctx)
  await run_sec_31(ctx)
  await run_sec_32(ctx)
  await run_sec_33(ctx)
  await run_sec_34(ctx)
  await run_sec_35(ctx)
  await run_sec_36(ctx)
  await run_sec_37(ctx)
  await run_sec_38(ctx)
  await run_sec_39(ctx)
  await run_sec_40(ctx)
  await run_sec_41(ctx)
  await run_sec_42(ctx)
  await run_sec_43(ctx)
  await run_sec_44(ctx)
  await run_sec_45(ctx)
  await run_sec_46(ctx)
  await run_sec_47(ctx)
  await run_sec_48(ctx)
  await run_sec_49(ctx)
  await run_sec_50(ctx)
  await run_sec_51(ctx)
  await run_sec_52(ctx)
  await run_sec_53(ctx)
  await run_sec_54(ctx)
  await run_sec_55(ctx)
  await run_sec_56(ctx)
  await run_sec_57(ctx)
  await run_sec_58(ctx)
  await run_sec_59(ctx)
  await run_sec_60(ctx)
  await run_sec_61(ctx)
  await run_sec_62(ctx)
  await run_sec_63(ctx)
  await run_sec_64(ctx)
  await run_sec_65(ctx)
  await run_sec_66(ctx)
  await run_sec_67(ctx)
  await run_sec_68(ctx)
  await run_sec_69(ctx)
  await run_sec_70(ctx)
  await run_sec_71(ctx)
  await run_sec_72(ctx)
  await run_sec_73(ctx)
  await run_sec_74(ctx)
  await run_sec_75(ctx)
  await run_sec_76(ctx)
  await run_sec_77(ctx)
await run_sec_78(ctx)
	await run_sec_79(ctx)
await run_sec_80(ctx)
await run_sec_81(ctx)
await run_sec_82(ctx)
await run_sec_83(ctx)
await run_sec_84(ctx)
await run_sec_85(ctx)
await run_sec_86(ctx)
await run_sec_87(ctx)
await run_sec_88(ctx)
await run_sec_89(ctx)
await run_sec_90(ctx)
await run_sec_91(ctx)
await run_sec_92(ctx)
await run_sec_93(ctx)
await run_sec_94(ctx)
await run_sec_95(ctx)
await run_sec_98(ctx)
await run_sec_99(ctx)
await run_sec_100(ctx)
await run_sec_101(ctx)
await run_sec_102(ctx)
await run_sec_103(ctx)
await run_sec_104(ctx)
await run_sec_105(ctx)
await run_sec_106(ctx)
await run_sec_107(ctx)
  console.log(`\n==== ${passed}, ${failed} failed ====`)
  if (failed > 0) process.exit(1)
})()
