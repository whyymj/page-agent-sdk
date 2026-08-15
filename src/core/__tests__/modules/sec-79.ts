/**
 * sec-79: 团队审查加固(D 段 - 沙箱静态扫描 + 环境探查脱敏)
 *
 * D1 沙箱静态扫描:constructor/getPrototypeOf/prototype 原型链逃逸拦截
 * D2 inspect_env 嵌套脱敏:嵌套敏感字段(apiKey/token 等)→ '[REDACTED]'
 */
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  const { createSandboxRunner } = await import('../../tools/sandbox')
  const { safeSerialize } = await import('../../tools/envTool')
  const ENV_SENSITIVE_KEY_RE = /token|secret|password|passwd|api[-_]?key|auth|cred|csrf|session|ticket/i

  // ========== D1 沙箱静态扫描 ==========

  {
    const runner = createSandboxRunner('"".constructor.constructor("return fetch")()')
    const result = await runner()
    assert(!result.ok, 'D1 constructor 原型链逃逸应被拒绝')
    assert(result.error?.includes('沙箱脚本不允许原型链访问'), 'D1 错误信息说明原型链访问被禁')
  }

  {
    const runner = createSandboxRunner('Object.getPrototypeOf(String).constructor("return 1")()')
    const result = await runner()
    assert(!result.ok, 'D1 getPrototypeOf 应被拒绝')
    assert(result.error?.includes('沙箱脚本不允许原型链访问'), 'D1 错误信息说明原型链访问被禁')
  }

  {
    const runner = createSandboxRunner('String.prototype.charAt.call("a",0)')
    const result = await runner()
    assert(!result.ok, 'D1 .prototype 访问应被拒绝')
    assert(result.error?.includes('沙箱脚本不允许原型链访问'), 'D1 错误信息说明原型链访问被禁')
  }

  {
    // 正向执行路径仅在 Worker 可用环境可测(Node selftest 无 Worker,与 sec-21 既有约定一致:只测静态扫描拒绝路径)
    if (typeof Worker !== 'undefined') {
      const runner = createSandboxRunner('return data.x * 2')
      const result = await runner({ x: 3 })
      assert(result.ok, 'D1 正常 transform 脚本应执行成功')
      assert(result.result === 6, 'D1 transform 结果正确')
    }
  }

  {
    const evalRunner = createSandboxRunner('eval("1+1")')
    const evalResult = await evalRunner()
    assert(!evalResult.ok, 'D1 eval 应被拒绝')

    const fnRunner = createSandboxRunner('new Function("x","return x*2")(3)')
    const fnResult = await fnRunner()
    assert(!fnResult.ok, 'D1 new Function 应被拒绝')

    // rv-sec 复审补充:__proto__ 属性访问取 constructor 链(data.__proto__.constructor.constructor 同款逃逸)
    const protoRunner = createSandboxRunner('return data.__proto__.constructor.constructor("return 1")()')
    const protoResult = await protoRunner()
    assert(!protoResult.ok, 'D1 __proto__ 取 constructor 链应被拒绝(rv-sec 复审)')
    assert(String(protoResult.error || '').includes('原型链'), 'D1 __proto__ 错误说明原型链访问被禁')

    // rv-sec 复审补充:Reflect 从函数对象反查 constructor(Reflect.get(fn,'constructor'))
    const reflectRunner = createSandboxRunner('return Reflect.get(function(){}, "constructor")')
    const reflectResult = await reflectRunner()
    assert(!reflectResult.ok, 'D1 Reflect 反射访问应被拒绝(rv-sec 复审)')
  }

  // ========== D2 inspect_env 嵌套脱敏 ==========

  {
    const mockData = {
      appConfig: {
        apiKey: 'sk-1234567890abcdef',
        endpoint: 'https://api.example.com',
        apiSecret: 'secret_xyz',
      },
      user: {
        name: 'test',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      },
    }

    const serialized = safeSerialize(mockData, 3, 2000, undefined, ENV_SENSITIVE_KEY_RE) as Record<string, unknown>
    const appConfig = serialized.appConfig as Record<string, unknown>

    assert(appConfig.apiKey === '[REDACTED]', 'D2 嵌套 apiKey 应脱敏')
    assert(appConfig.apiSecret === '[REDACTED]', 'D2 嵌套 apiSecret 应脱敏')
    assert(appConfig.endpoint === 'https://api.example.com', 'D2 非敏感字段 endpoint 原样保留')

    const user = serialized.user as Record<string, unknown>
    assert(user.token === '[REDACTED]', 'D2 嵌套 token 应脱敏')
    assert(user.name === 'test', 'D2 非敏感字段 name 原样保留')
  }

  {
    const mockData = {
      appConfig: {
        apiKey: 'sk-1234567890abcdef',
        endpoint: 'https://api.example.com',
      },
    }

    const serialized = safeSerialize(mockData, 3, 2000, undefined) as Record<string, unknown>
    const appConfig = serialized.appConfig as Record<string, unknown>

    assert(appConfig.apiKey === 'sk-1234567890abcdef', 'D2 无 redactSensitive 时 apiKey 原样保留')
    assert(appConfig.endpoint === 'https://api.example.com', 'D2 非敏感字段 endpoint 原样保留')
  }

  {
    const mockData = {
      outer: {
        inner: {
          secret: 'deep_secret_value',
          normal: 'normal_value',
        },
      },
    }

    const serialized = safeSerialize(mockData, 3, 2000, undefined, ENV_SENSITIVE_KEY_RE) as Record<string, unknown>
    const outer = serialized.outer as Record<string, unknown>
    const inner = outer.inner as Record<string, unknown>

    assert(inner.secret === '[REDACTED]', 'D2 深层嵌套 secret 应脱敏')
    assert(inner.normal === 'normal_value', 'D2 深层非敏感字段原样保留')
  }

  {
    const mockData = {
      users: [
        { name: 'alice', password: 'alice_pass' },
        { name: 'bob', token: 'bob_token' },
      ],
    }

    const serialized = safeSerialize(mockData, 3, 2000, undefined, ENV_SENSITIVE_KEY_RE) as Record<string, unknown>
    const users = serialized.users as Array<Record<string, unknown>>

    assert(users[0].password === '[REDACTED]', 'D2 数组元素 password 应脱敏')
    assert(users[0].name === 'alice', 'D2 数组元素 name 原样保留')
    assert(users[1].token === '[REDACTED]', 'D2 数组元素 token 应脱敏')
    assert(users[1].name === 'bob', 'D2 数组元素 name 原样保留')
  }

  {
    const sensitiveKeys = [
      'apiKey', 'api_key', 'apikey',
      'token', 'accessToken', 'refreshToken',
      'secret', 'apiSecret', 'clientSecret',
      'password', 'passwd',
      'auth', 'authToken',
      'credential', 'credentials',
      'csrf', 'csrfToken',
      'session', 'sessionId',
      'ticket', 'authTicket',
    ]

    let passed = 0
    sensitiveKeys.forEach(key => {
      const mockData = { [key]: `sensitive_value_for_${key}` }
      const serialized = safeSerialize(mockData, 3, 2000, undefined, ENV_SENSITIVE_KEY_RE) as Record<string, unknown>
      if (serialized[key] === '[REDACTED]') passed++
    })
    assert(passed === sensitiveKeys.length, `D2 ${passed}/${sensitiveKeys.length} 敏感 key 应脱敏`)
  }
}
