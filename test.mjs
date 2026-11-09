/**
 * dsh-chloe-ding 冒烟测试 —— 不接进 DSH，只在 node 里把两个事件走一遍。
 *
 * 验的是三件事（都不需要真听得见）：
 *   1. 模块能加载、apply 不抛
 *   2. `agent/created` → `agent/status: idle` 这条路径不抛（含配置归一化）
 *   3. 信号文件在 / 不在，走的是两条不同的分支
 *
 * 真声音、真气泡要手动验（见 README 的「测试」）。
 */

import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 测试不许读用户配置：否则 notify/maxRepeats 会被真实配置覆盖，测试会真的弹窗、真的响。
process.env.CHLOE_DING_IGNORE_USER_CONFIG = '1'

const { name, apply } = await import('./index.mjs')

const failures = []
function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    console.log(`  ❌ ${label}`)
    failures.push(label)
  }
}

/** 造一个够用的假 ctx：只实现本插件真正用到的那几个方法。 */
function fakeContext() {
  const handlers = new Map()
  let disposer = null
  return {
    handlers,
    on(event, callback) {
      handlers.set(event, callback)
      return () => handlers.delete(event)
    },
    effect(fn, label) {
      disposer = fn(label)
      return () => { if (typeof disposer === 'function') disposer() }
    },
    logger: { info() {}, warn() {}, error() {} },
    dispose() { if (typeof disposer === 'function') disposer() },
  }
}

function fakeAgent() {
  const handlers = new Map()
  return {
    handlers,
    ctx: {
      on(event, callback) {
        handlers.set(event, callback)
        return () => handlers.delete(event)
      },
    },
  }
}

const dir = join(tmpdir(), 'dsh-chloe-ding-test')
mkdirSync(dir, { recursive: true })
const signalFile = join(dir, 'chloe-call.json')

console.log(`\n[1] 模块导出`)
check('name 是字符串', typeof name === 'string' && name.length > 0)
check('apply 是函数', typeof apply === 'function')

console.log(`\n[2] 注册与事件路径`)
const ctx = fakeContext()
apply(ctx, {
  // 给一个不存在的文件：路径非空，插件就会真正注册；真放的时候 PowerShell 打不开，
  // 会在它自己的进程里失败，测试这边听不到、也不弹气泡。
  doneSound: join(dir, 'no-such-file.mp3'),
  alertSound: '',
  notify: false,
  signalFile,
  maxRepeats: 0,
  repeatMs: 0,
})
check('挂上了 agent/created', ctx.handlers.has('agent/created'))

const agent = fakeAgent()
ctx.handlers.get('agent/created')({ agent })
check('挂上了 agent/status', agent.handlers.has('agent/status'))

let threw = null
try {
  agent.handlers.get('agent/status')({ status: 'running' })
  agent.handlers.get('agent/status')({ status: 'idle' })
} catch (error) {
  threw = error
}
check('running → idle 不抛', threw === null)

console.log(`\n[3] 信号文件两种状态`)
writeFileSync(signalFile, JSON.stringify({ call: true }), 'utf8')
threw = null
try {
  agent.handlers.get('agent/status')({ status: 'idle' })
} catch (error) {
  threw = error
}
check('信号文件存在时 idle 不抛', threw === null)

rmSync(signalFile, { force: true })
threw = null
try {
  agent.handlers.get('agent/status')({ status: 'idle' })
} catch (error) {
  threw = error
}
check('信号文件不存在时 idle 不抛', threw === null)

console.log(`\n[4] 问句路径（ask_user_question 也叮）`)
threw = null
try {
  ctx.handlers.get('session/event')(
    { id: 'session-test' },
    { type: 'tool/call', data: { name: 'ask_user_question', arguments: '{"questions":[]}' } },
  )
} catch (error) {
  threw = error
}
check('ask_user_question 的 tool/call 不抛', threw === null)

threw = null
try {
  ctx.handlers.get('session/event')(
    { id: 'session-test' },
    { type: 'tool/call', data: { name: 'bash', arguments: '{}' } },
  )
} catch (error) {
  threw = error
}
check('普通工具不抛', threw === null)

console.log(`\n[5] 卸载`)
threw = null
try {
  ctx.dispose()
} catch (error) {
  threw = error
}
check('卸载不抛', threw === null)

console.log('')
if (failures.length > 0) {
  console.log(`❌ ${failures.length} 项失败`)
  process.exitCode = 1
} else {
  console.log('✅ 全部通过（声音与气泡本身另验：见 README）')
}
