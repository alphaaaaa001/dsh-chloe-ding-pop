/**
 * dsh-chloe-ding — 助手说完一轮，响一声；它需要你回答时，响一声更响的，并弹出 Windows 通知。
 *
 * 为什么要它：别的 harness 都有「说完了」的提示音，DSH 桌面上没有。
 * 一轮答案很长，你早就切到别的窗口去了——不响一声，你永远不知道它已经说完。
 *
 * 零运行时依赖，只用 node: 内置模块。跟 dsh-memory-index 同一个约束：本插件在 profile
 * 的 patch 里出现，Node 从它自己的目录向上解析不到 app.asar 里的 `@deepseek-ai/*`。
 * 声音与通知都交给系统：mp3 走 PowerShell + WPF MediaPlayer（Windows 自带的
 * SoundPlayer 只吃 wav），通知走 NotifyIcon 气泡（不依赖 Toast 库、不挑系统版本）。
 *
 * @module dsh-chloe-ding
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 诊断日志：不靠 DSH 的控制台，自己落一份，出事好查。 */
const DEBUG_FILE = join(tmpdir(), 'dsh-chloe-ding-debug.log')
function debug(line) {
  try {
    appendFileSync(DEBUG_FILE, `${new Date().toISOString()} pid=${process.pid} ${line}\n`, 'utf8')
  } catch {
    // 日志失败不影响声音。
  }
}


/** cordis 插件名。 */
export const name = 'dsh-chloe-ding'

/**
 * 包里自带的提示音（`assets/done.wav` / `assets/alert.wav`，纯合成、无版权问题）。
 * 按本文件的位置解析——换机器、换安装路径、被 npm 装进 node_modules 都还能找到。
 * 文件不在就返回空串（＝不响），绝不因此抛错。
 */
function bundled(file) {
  try {
    const path = fileURLToPath(new URL(`./assets/${file}`, import.meta.url))
    return existsSync(path) ? path : ''
  } catch {
    return ''
  }
}

const DEFAULTS = {
  /** 正常回复完时响的声音。空串＝不响。默认用包里自带的那一段。 */
  doneSound: bundled('done.wav'),
  /** 「我在等你回话」时响的声音。空串＝用 doneSound。 */
  alertSound: bundled('alert.wav'),
  /** 音量 0~1（WPF MediaPlayer 的 Volume）。 */
  volume: 0.6,
  /** 信号文件：它存在＝助手在等你回话。 */
  signalFile: join(homedir(), '.dsh', 'chloe-call.json'),
  /** 信号文件的保鲜期；超过这个时长就当作过期，不再响。 */
  signalTtlMs: 10 * 60 * 1000,
  /** 你久不回时，每隔多久再响一次。默认 60 秒（30 秒时答案常常还没打完）。 */
  repeatMs: 60 * 1000,
  /** 最多重复几次（不含第一声）。0＝不重复。 */
  maxRepeats: 5,
  /** 是否弹 Windows 气泡通知。 */
  notify: true,
  /** DSH 窗口在前台（你正看着）时，不弹气泡——只留声音。关窗口/切到别的程序时照常弹。 */
  quietWhenFocused: true,
  /** 气泡里的署名。默认中性，谁用谁改（设置页 / 用户配置文件）。 */
  nick: 'DSH',
  /**
   * 定时任务（cron）自己发起的那一轮，也响吗？
   * 默认**不响**：定时任务自己发起的那一轮，多半是后台活儿，弹出来只是噪音。
   * 例外：助手明确在等你回话（信号文件活着）时那种 `alert`，照响。
   */
  dingOnAuto: false,
}

/** 用户可调的配置：改这里，不用重启（插件每 2 秒看一眼）。 */
const USER_CONFIG_FILE = join(homedir(), '.dsh', 'chloe-ding.json')

/**
 * 宿主侧 Config（schemastery）：声明了它，设置域才把本插件列成一个命名空间，
 * 设置页（client.js）才拿得到 configForms.get('dsh-chloe-ding')。
 * 解析方式用 profile 的 node_modules 去 require —— 这个插件跑在 DSH 进程里，
 * 借的就是那份依赖；拿不到就退化成「没有 schema」（插件功能照常）。
 */
const SchemaModule = (() => {
  const candidates = [
    'file:///C:/Users/ace/.dsh/profiles/desktop/package.json',
    pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json')).href,
  ]
  for (const base of candidates) {
    try {
      const req = createRequire(base)
      const mod = req('@deepseek-ai/schemastery')
      // schemastery 的导出本身就是 Schema 命名空间：object() / string() / number()…
      if (mod !== null && mod !== undefined && typeof mod.object === 'function') return { Schema: mod }
      const fallback = mod?.default
      if (fallback !== null && fallback !== undefined && typeof fallback.object === 'function') return { Schema: fallback }
    } catch {
      // 换下一个候选。
    }
  }
  return {}
})()

export const Config = SchemaModule.Schema === undefined
  ? undefined
  : SchemaModule.Schema.object({
    doneSound: SchemaModule.Schema.string().default(DEFAULTS.doneSound),
    alertSound: SchemaModule.Schema.string().default(DEFAULTS.alertSound),
    volume: SchemaModule.Schema.number().min(0).max(1).default(DEFAULTS.volume),
    repeatMs: SchemaModule.Schema.number().min(0).default(DEFAULTS.repeatMs),
    maxRepeats: SchemaModule.Schema.number().min(0).default(DEFAULTS.maxRepeats),
    notify: SchemaModule.Schema.boolean().default(DEFAULTS.notify),
    quietWhenFocused: SchemaModule.Schema.boolean().default(DEFAULTS.quietWhenFocused),
    nick: SchemaModule.Schema.string().default(DEFAULTS.nick),
    dingOnAuto: SchemaModule.Schema.boolean().default(DEFAULTS.dingOnAuto),
  })

/** 读用户配置文件；没有/坏了都当空，不打断插件。测试时用 CHLOE_DING_IGNORE_USER_CONFIG=1 跳过。 */
function loadUserConfig() {
  if (process.env.CHLOE_DING_IGNORE_USER_CONFIG === '1') return {}
  try {
    const raw = readFileSync(USER_CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalize(config) {
  const raw = config ?? {}
  const pick = (key, ok, fallback) => (ok(raw[key]) ? raw[key] : fallback)
  const isStr = (v) => typeof v === 'string'
  const isNum = (v) => Number.isFinite(v) && v >= 0
  return {
    doneSound: pick('doneSound', isStr, DEFAULTS.doneSound),
    alertSound: pick('alertSound', isStr, DEFAULTS.alertSound),
    volume: Math.min(1, pick('volume', isNum, DEFAULTS.volume)),
    signalFile: pick('signalFile', isStr, DEFAULTS.signalFile),
    signalTtlMs: pick('signalTtlMs', isNum, DEFAULTS.signalTtlMs),
    repeatMs: pick('repeatMs', isNum, DEFAULTS.repeatMs),
    maxRepeats: Math.floor(pick('maxRepeats', isNum, DEFAULTS.maxRepeats)),
    notify: raw.notify === true || (raw.notify === undefined && DEFAULTS.notify),
    quietWhenFocused:
      raw.quietWhenFocused === true ||
      (raw.quietWhenFocused === undefined && DEFAULTS.quietWhenFocused),
    nick: pick('nick', isStr, DEFAULTS.nick),
    // 默认 false：自动任务那一轮不响。写 true 才让 cron 也响。
    dingOnAuto: raw.dingOnAuto === true,
  }
}

/** 日志是软依赖，缺了不该让插件崩。 */
function report(ctx, level, message) {
  try {
    ctx?.logger?.[level]?.(message)
  } catch {
    // 日志失败不影响播放本身。
  }
}

/** PowerShell 单引号字符串里，单引号要写两遍。 */
function psQuote(value) {
  return String(value).replace(/'/g, "''")
}

/**
 * 起一个隐藏的 PowerShell 进程做一件事，然后退出。
 * 不等待、不收集输出——它的唯一作用是把声音或气泡放出去。
 *
 * 走文件而不是 `-Command` 长字符串：命令里有中文和引号，长字符串在 Windows
 * 命令行长度上限和转义上都会咬人；写临时 .ps1 再 -File 是最省事的路子。
 * @param script - 完整的 PowerShell 脚本正文。
 */
function runPowerShell(script) {
  const file = join(tmpdir(), `dsh-chloe-ding-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  try {
    // 带 BOM 写，Windows PowerShell 5.1 读中文才不乱码。
    writeFileSync(file, '\uFEFF' + script, 'utf8')
  } catch {
    return
  }
  try {
    // ⚠️ 踩过的坑：原来用 detached + stdio:'ignore'，在 DSH 主进程里 spawn 出去的
    // PowerShell **一声都不出**（同样的 ps1 手动跑有声音）。改成非 detached、管道收回
    // 输出——这条路径在取前台窗口那边已经验证过是通的。
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    let out = ''
    child.stdout?.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.on('error', (error) => debug(`ps spawn error=${String(error)}`))
    child.on('close', (code) => debug(`ps close code=${code}${out.trim() ? ` out=${out.trim().slice(0, 300)}` : ''}`))
  } catch (error) {
    debug(`ps spawn threw=${String(error)}`)
  }
}

/** 播放一个音频文件并等它放完（在它自己的 PowerShell 进程里等）。 */
function playSound(path, volume) {
  if (typeof path !== 'string' || path.length === 0) return
  runPowerShell([
    'Add-Type -AssemblyName presentationCore',
    '$player = New-Object System.Windows.Media.MediaPlayer',
    `$player.Volume = ${volume}`,
    `$player.Open([uri]::new('${psQuote(path)}'))`,
    '$player.Play()',
    'Start-Sleep -Milliseconds 5000',
    '$player.Close()',
  ].join('\n'))
}

/** 右下角气泡通知。 */
function toast(title, body) {
  runPowerShell([
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$icon = New-Object System.Windows.Forms.NotifyIcon',
    '$icon.Icon = [System.Drawing.SystemIcons]::Information',
    '$icon.Visible = $true',
    `$icon.ShowBalloonTip(4000, '${psQuote(title)}', '${psQuote(body)}', [System.Windows.Forms.ToolTipIcon]::Info)`,
    'Start-Sleep -Seconds 5',
    '$icon.Dispose()',
  ].join('\n'))
}

/** 跑一段 PowerShell 并把它的标准输出收回来（短任务，带超时）。 */
function runPowerShellCapture(script, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const file = join(tmpdir(), `dsh-chloe-ding-q-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
    try {
      // 带 BOM 写，Windows PowerShell 5.1 读中文才不乱码。
      writeFileSync(file, '\uFEFF' + script, 'utf8')
    } catch {
      resolve('')
      return
    }
    let out = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      )
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // 已经退了就算了。
        }
        finish(out.trim())
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      child.stdout?.on('data', (chunk) => {
        out += chunk.toString('utf8')
      })
      child.on('error', () => finish(''))
      child.on('close', () => {
        clearTimeout(timer)
        finish(out.trim())
      })
    } catch {
      finish('')
    }
  })
}

/** 取前台窗口的「pid|进程名」。 */
const FOREGROUND_PS = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); }'
$h = [DshFg]::GetForegroundWindow()
$forePid = 0
[void][DshFg]::GetWindowThreadProcessId($h, [ref]$forePid)
$proc = Get-Process -Id $forePid -ErrorAction SilentlyContinue
"$forePid|$($proc.ProcessName)"
`

/**
 * DSH 是不是正被看着：前台窗口的进程和自己的 pid / exe 名比。
 * 比不出来就当作「不在前台」——宁可多弹一次，也别把该叫的人漏掉。
 * @returns {Promise<boolean>}
 */
async function foregroundRaw() {
  return await runPowerShellCapture(FOREGROUND_PS)
}

async function selfIsForeground() {
  const out = await foregroundRaw()
  const [pidText, procName = ''] = out.split('|')
  const forePid = Number.parseInt(pidText, 10)
  if (!Number.isFinite(forePid)) return false
  if (forePid === process.pid) return true
  const selfName = (process.execPath.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '')
  return selfName.length > 0 && procName.trim().toLowerCase() === selfName.toLowerCase()
}

/**
 * 信号文件还在不在、新不新鲜。
 * 助手在「需要你回答」时写这个文件；你回了话，它在下次回复前删掉。
 * @param path - 信号文件路径。
 * @param ttlMs - 超过这个时长视为过期。
 * @returns 仍然有效时为 true。
 */
function signalAlive(path, ttlMs) {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return false
    return Date.now() - stat.mtimeMs <= ttlMs
  } catch {
    return false
  }
}

/**
 * 注册插件。
 * @param ctx - 插件上下文。
 * @param config - patch 里的 `config` 段。
 */
export function apply(ctx, config) {
  /**
   * 读设置页写的那一层（DSH 设置域：describe() 里按命名空间取 value）。
   * 拿不到就当空 —— 设置页只是“多一条改参数的路”，不是必需依赖。
   */
  const readSettingsLayer = () => {
    try {
      const svc = ctx.get?.('settings')
      const rows = svc?.describe?.()
      if (!Array.isArray(rows)) return {}
      const row = rows.find((r) => r?.ns === 'dsh-chloe-ding' || r?.ns === 'chloe-ding')
      const value = row?.value
      return value !== null && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  // 优先级：设置页（DSH 设置层）> 用户配置文件 > patch 里的 config > 内置默认。
  const layered = () => normalize({ ...(config ?? {}), ...loadUserConfig(), ...readSettingsLayer() })
  const cfg = layered()
  const hasAnySound = cfg.doneSound.length > 0 || cfg.alertSound.length > 0
  debug(`apply config=${JSON.stringify(config ?? null)} done=${cfg.doneSound.length} alert=${cfg.alertSound.length} notify=${cfg.notify} dingOnAuto=${cfg.dingOnAuto}`)
  if (!hasAnySound && !cfg.notify) {
    debug('apply: 没声音也没通知，直接不注册')
    return
  }

  /** 每个 agent 一组：待重复的定时器。 */
  const timers = new Map()
  /** 已经挂过的 agent（弱引用：agent 被释放就自然回收）。 */
  const attached = new WeakSet()
  /** 挂到 agent.ctx 上的监听，每份一组；插件卸载时逐个摘掉（不然重载一次多一倍的声）。 */
  const agentDisposers = []
  /** 这一轮是「定时任务自己发起」的 agent（cron 投进来的消息）。 */
  const autoTurn = new WeakSet()
  /** 只记一次「钩子确实挂上了」，免得日志每步刷屏。 */
  let preStepSeen = false
  /**
   * 定时任务投递的那一轮：`session/event` 里那条 `user/message` 原样带着
   * `[SCHEDULE REMINDER BATCH]`。看到它记时间；下一条人话进来就记人的时间。
   * 判据：`lastScheduledAt > lastHumanAt` ＝ 这一轮是自动任务发起的。
   */
  let lastScheduledAt = 0
  let lastHumanAt = 0
  let firstUserEventLogged = false

  /** 把一条消息里的文字抖出来（content 可能是字符串，也可能是分块数组）。 */
  const textOfMessage = (message) => {
    const content = message?.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .join('\n')
  }

  const clearTimers = (agent) => {
    const list = timers.get(agent)
    if (list === undefined) return
    for (const t of list) clearTimeout(t)
    timers.delete(agent)
  }

  const fire = async (agent, kind) => {
    // 定时任务（cron）那一轮不响：后台活儿不该弹到人面前。
    // 唯一的例外是助手明确在等你回话（信号文件活着 → kind 是 alert），那声照响。
    const recentAuto = Date.now() - lastScheduledAt < 10 * 60 * 1000
    const autoNow = recentAuto && (lastScheduledAt > lastHumanAt || autoTurn.has(agent))
    if (!cfg.dingOnAuto && kind !== 'alert' && autoNow) {
      debug('skip: 这一轮是自动任务，不响')
      report(ctx, 'info', 'dsh-chloe-ding: 自动任务，跳过')
      return
    }
    const alert = kind === 'alert'
    const sound = alert
      ? (cfg.alertSound.length > 0 ? cfg.alertSound : cfg.doneSound)
      : (cfg.doneSound.length > 0 ? cfg.doneSound : cfg.alertSound)
    debug(`fire kind=${kind} soundLen=${sound.length} notify=${cfg.notify} quiet=${cfg.quietWhenFocused}`)
    playSound(sound, cfg.volume)
    if (cfg.notify) {
      if (cfg.quietWhenFocused) {
        const focused = await selfIsForeground()
        debug(`focus=${focused}`)
        if (focused) {
          report(ctx, 'info', `dsh-chloe-ding: ${kind}（DSH 在前台，气泡跳过）`)
          return
        }
      }
      toast(cfg.nick, alert ? '在等你回话' : '说完了')
    }
    report(ctx, 'info', `dsh-chloe-ding: ${kind}`)
  }

  /** 重复声前先看你在不在：一回到 DSH 就不再叫。 */
  const shouldStopRepeating = async () => {
    if (!cfg.quietWhenFocused) return false
    return await selfIsForeground()
  }

  /**
   * 给一个 agent 挂「状态」监听：idle 响，running 把重复作废。
   *
   * ⚠️ 踩过的坑：这些监听是挂在 **agent.ctx** 上的，不归插件生命周期管。
   * 插件热重载一次，旧监听听还活着 → 一回合响两声；我今天重载了四次，变成**一回合响五声**，
   * 结果一回合连响五声、开会时被连弹五个气泡。所以：①每条监听都收进 disposers，插件卸载时逐个摘掉；
   * ②再用 Symbol 钉在 agent 身上，跨实例也不许挂第二份。
   */
  const ATTACHED = Symbol.for('dsh-chloe-ding.attached')

  const attach = (agent) => {
    if (agent === undefined || agent === null) return
    if (attached.has(agent)) return
    attached.add(agent)
    try {
      if (agent[ATTACHED] === true) {
        debug('attach: 已经有人挂过了，跳过')
        return
      }
      agent[ATTACHED] = true
    } catch {
      // 钉不上（对象冻住了之类）就继续挂，靠 disposers 兜。
    }

    const disposers = []
    agentDisposers.push(disposers)

    // 认「这一轮是不是定时任务自己发起的」——cron 投进来的消息原样带着
    // `[SCHEDULE REMINDER BATCH]` 抬头。看到它就标上；下一条正常的人话进来再清掉。
    // 判的是 decision.messages（这一步新进来的消息），不是整段历史。
    try {
      disposers.push(agent.ctx.on('agent/pre-step', async (payload, next) => {
        let decision
        try {
          decision = typeof next === 'function' ? await next() : undefined
        } catch (error) {
          debug(`pre-step next err=${String(error)}`)
          throw error
        }
        try {
          const messages = decision?.messages ?? []
          if (!preStepSeen) {
            preStepSeen = true
            debug(`pre-step 钩子活着（本轮新消息 ${messages.length} 条）`)
          }
          const blob = messages.length > 0 ? JSON.stringify(messages) : ''
          const hasMarker = blob.includes('[SCHEDULE REMINDER BATCH]')
          const hasHuman = messages.some(
            (m) => m?.source?.kind === 'user' && !textOfMessage(m).includes('[SCHEDULE REMINDER BATCH]'),
          )
          if (hasMarker) {
            autoTurn.add(agent)
            lastScheduledAt = Date.now()
            debug('auto-turn=1（定时任务）')
          } else if (hasHuman) {
            autoTurn.delete(agent)
            lastHumanAt = Date.now()
            debug('auto-turn=0（人来了）')
          }
        } catch (error) {
          debug(`pre-step err=${String(error)}`)
        }
        return decision
      }))
    } catch (error) {
      // 挂不上就算了：宁可继续响，也别为了「不响」把插件搞崩。
      debug(`pre-step 挂载失败=${String(error)}`)
    }

    disposers.push(agent.ctx.on('agent/status', ({ status }) => {
      debug(`agent/status=${status}`)
      if (status === 'running') {
        // 你一开口（或工具开始跑），之前排的重复声全部作废。
        clearTimers(agent)
        return
      }
      if (status !== 'idle') return

      const wantsAnswer = signalAlive(cfg.signalFile, cfg.signalTtlMs)
      void fire(agent, wantsAnswer ? 'alert' : 'done')
      if (!wantsAnswer || cfg.maxRepeats === 0 || cfg.repeatMs <= 0) return

      // 你久不回：每隔 repeatMs 再响一次；信号文件一消失、或你回到 DSH，就停。
      const list = []
      for (let i = 1; i <= cfg.maxRepeats; i += 1) {
        const timer = setTimeout(() => {
          void (async () => {
            if (!signalAlive(cfg.signalFile, cfg.signalTtlMs)) {
              clearTimers(agent)
              return
            }
            if (await shouldStopRepeating()) {
              clearTimers(agent)
              report(ctx, 'info', 'dsh-chloe-ding: 回到窗口了，停止重复')
              return
            }
            if (i === cfg.maxRepeats) clearTimers(agent)
            void fire(agent, 'alert')
          })()
        }, cfg.repeatMs * i)
        if (typeof timer.unref === 'function') timer.unref()
        list.push(timer)
      }
      timers.set(agent, list)
    }))
  }

  /**
   * 补挂「已经活着」的 agent。
   * 重启 DSH 时会话是恢复的，agent 在插件加载之前就建好了——`agent/created` 那一枪已经过去了。
   */
  const sweepExisting = () => {
    try {
      const svc = ctx.get?.('agents')
      const list = svc?.list?.() ?? []
      for (const agent of list) attach(agent)
      if (list.length > 0) debug(`sweep: 在活 agent ${list.length} 个`)
    } catch (error) {
      debug(`sweep err=${String(error)}`)
    }
  }

  ctx.effect(() => {
    debug('effect: 已注册')
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      debug('agent/created')
      attach(agent)
    })

    // 定时任务 vs 人：cron 投进来的那条 user 消息带着 `[SCHEDULE REMINDER BATCH]` 抬头。
    // 用整条事件做子串判断——不猜消息结构，谁来都躲不过这段字。
    const stopSessionEvent = ctx.on('session/event', (session, event) => {
      try {
        if (event?.type !== 'user/message') return
        const blob = JSON.stringify(event)
        const scheduled =
          blob.includes('[SCHEDULE REMINDER BATCH]') || blob.includes('reminders_json')
        if (scheduled) lastScheduledAt = Date.now()
        else lastHumanAt = Date.now()
        if (!firstUserEventLogged) {
          firstUserEventLogged = true
          debug(`user/message：${scheduled ? '定时任务' : '人'}（${blob.length} 字）`)
        }
      } catch (error) {
        debug(`session/event err=${String(error)}`)
      }
    })

    // 立刻扫一遍；随后 3 秒一次扫 60 秒（agent 可能比插件晚建出来），之后靠事件。
    sweepExisting()
    let ticks = 0
    const sweeper = setInterval(() => {
      ticks += 1
      sweepExisting()
      if (ticks >= 20) clearInterval(sweeper)
    }, 3000)
    if (typeof sweeper.unref === 'function') sweeper.unref()

    // 参数热加载：设置页 / ~/.dsh/chloe-ding.json 任一处一改，下一条就按新参数走。
    // 每 2 秒重新算一遍「设置层 + 文件 + patch」的合并结果，变了才落。
    const snapshot = () => JSON.stringify([
      cfg.doneSound, cfg.alertSound, cfg.volume, cfg.repeatMs, cfg.maxRepeats,
      cfg.notify, cfg.quietWhenFocused, cfg.nick, cfg.signalTtlMs, cfg.dingOnAuto,
    ])
    let lastSig = snapshot()
    const configTimer = setInterval(() => {
      try {
        Object.assign(cfg, layered())
        const sig = snapshot()
        if (sig === lastSig) return
        lastSig = sig
        debug(`热加载：repeatMs=${cfg.repeatMs} volume=${cfg.volume} notify=${cfg.notify} quiet=${cfg.quietWhenFocused}`)
      } catch {
        // 读失败就保持原样，下一轮再看。
      }
    }, 2000)
    if (typeof configTimer.unref === 'function') configTimer.unref()

    return () => {
      clearInterval(sweeper)
      clearInterval(configTimer)
      stopCreated()
      stopSessionEvent()
      for (const list of agentDisposers) {
        for (const dispose of list) {
          try {
            dispose?.()
          } catch {
            // 已经摘过了。
          }
        }
      }
      agentDisposers.length = 0
      for (const agent of [...timers.keys()]) clearTimers(agent)
    }
  }, 'chloe-ding.lifecycle()')
}

// ── 手动测试入口（不接 DSH 也能验零件）───────────────────────────────────────
//   node index.mjs --focus                     看它认为 DSH 在不在前台
//   node index.mjs --toast 标题 正文            弹一个气泡
//   node index.mjs --ding <mp3> [音量]          放一段声音
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  const [flag, ...rest] = process.argv.slice(2)
  if (flag === '--focus') {
    const focused = await selfIsForeground()
    console.log(`foreground=${await foregroundRaw()}`)
    console.log(`selfIsForeground=${focused}  pid=${process.pid}  exec=${process.execPath}`)
  } else if (flag === '--toast') {
    toast(rest[0] || 'dsh-chloe-ding', rest[1] || '测试气泡')
    console.log('toast: sent')
    setTimeout(() => {}, 6000)
  } else if (flag === '--ding') {
    playSound(rest[0], Number(rest[1] ?? 0.6))
    console.log('ding: sent')
    setTimeout(() => {}, 6000)
  } else {
    console.log('usage: node index.mjs --focus | --toast <title> <body> | --ding <mp3> [volume]')
  }
}
