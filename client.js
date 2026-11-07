/**
 * dsh-chloe-ding · 客户端（浏览器）那一半 —— 设置页「克洛伊的叮」。
 *
 * 形态：window.__ModuleLoader__.load({ id, factory }) —— DSH 浏览器端的模块格式，
 * 原样手写、不经过构建（这个页面很小，构建只会多一层要维护的东西）。
 * React 由宿主提供：factory 里 require('react')。
 *
 * 数据层：优先 0.1.7 的 configForms（get(命名空间) 得到共享表单），
 * 退回去 0.1.6 的 settingsScope.bind({ namespace }) —— 两者接口同构：
 * getSnapshot() / subscribe() / set(单层键) / unset(单层键)。
 * 命名空间 = 插件包名 = 'dsh-chloe-ding'（Host 侧声明 Config 后自动出现在设置域里）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-chloe-ding',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-chloe-ding'
    // 设置域里的命名空间就是「插件条目 id」。我们的 bundle 条目 id 与包名已经对齐，
    // 但为防老版本/旧装配，两个都试一遍（先长后短）。
    const NS_CANDIDATES = ['dsh-chloe-ding', 'chloe-ding']
    const CSS_ID = 'chloe-ding-settings-css'
    const CSS = `
.cding_page{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:10px;max-width:720px;padding:4px 0}
.cding_h{font-size:16px;font-weight:600;margin:0}
.cding_p{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.6;margin:0}
.cding_card{background:color-mix(in srgb,currentColor 3%,transparent);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;display:flex;flex-direction:column;gap:10px;padding:12px}
.cding_row{align-items:flex-start;display:flex;gap:12px;justify-content:space-between}
.cding_text{display:flex;flex-direction:column;gap:2px;min-width:0}
.cding_label{font-size:13px;font-weight:500}
.cding_hint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.5}
.cding_input{background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:inherit;font-size:13px;padding:4px 8px;width:120px}
.cding_check{cursor:pointer;height:16px;width:16px}
.cding_err{color:#f43f5e;font-size:12px;margin:0}
.cding_ok{color:#34d399;font-size:12px}
.cding_muted{color:var(--dsw-alias-label-caption);font-size:12px}
`

    function injectCss() {
      if (document.getElementById(CSS_ID) !== null) return
      const style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** 把 scope 的 snapshot 读成「当前值」。 */
    function readValue(scope) {
      try {
        const snap = scope?.getSnapshot?.()
        const value = snap?.value ?? {}
        return value !== null && typeof value === 'object' ? value : {}
      } catch {
        return {}
      }
    }

    /** 写一个键（单层覆盖；失败就重新载入镜像，不假装成功）。 */
    async function writeKey(scope, key, value) {
      try {
        const result = await scope?.set?.({ [key]: value })
        return result !== false
      } catch {
        return false
      }
    }

    /** 一行控件。 */
    function Row(props) {
      const { label, hint, control } = props
      return h('div', { className: 'cding_row' },
        h('div', { className: 'cding_text' },
          h('span', { className: 'cding_label' }, label),
          hint === undefined ? null : h('span', { className: 'cding_hint' }, hint),
        ),
        h('div', { className: 'cding_ctrl' }, control),
      )
    }

    /** 设置页主体。 */
    function SettingsSection(props) {
      const scope = props?.scope
      const [tick, setTick] = React.useState(0)
      const [saving, setSaving] = React.useState('')
      const [failed, setFailed] = React.useState('')

      React.useEffect(() => {
        if (scope === undefined || scope === null) return undefined
        let alive = true
        const unsubscribe = scope.subscribe?.(() => { if (alive) setTick((n) => n + 1) })
        return () => {
          alive = false
          try { unsubscribe?.() } catch { /* 取消失败不阻塞 */ }
        }
      }, [scope])

      const value = readValue(scope)
      const repeatMs = typeof value.repeatMs === 'number' ? value.repeatMs : 60000
      const volume = typeof value.volume === 'number' ? value.volume : 0.6
      const notify = value.notify !== false
      const quiet = value.quietWhenFocused !== false

      const commit = async (key, next) => {
        setSaving(key)
        setFailed('')
        const ok = await writeKey(scope, key, next)
        setSaving('')
        if (!ok) setFailed(key)
        else setTick((n) => n + 1)
      }

      const num = (key, current, min, max, step, hint) => h('input', {
        className: 'cding_input',
        type: 'number',
        min,
        max,
        step,
        defaultValue: String(current),
        onBlur: (event) => {
          const parsed = Number(event.target.value)
          if (!Number.isFinite(parsed)) return
          const clamped = Math.min(max, Math.max(min, parsed))
          if (clamped !== current) void commit(key, clamped)
        },
      })

      const box = (key, current) => h('input', {
        className: 'cding_check',
        type: 'checkbox',
        checked: current,
        onChange: (event) => { void commit(key, event.target.checked) },
      })

      const status = failed === ''
        ? (saving === '' ? null : h('span', { className: 'cding_muted' }, `正在保存 ${saving}…`))
        : h('span', { className: 'cding_err' }, `保存失败：${failed}`)

      if (scope === undefined || scope === null) {
        return h('div', { className: 'cding_page' },
          h('h2', { className: 'cding_h' }, '克洛伊的叮'),
          h('p', { className: 'cding_p' }, '页面已经挂上了，但设置服务还没就绪（拿不到配置作用域）。'),
          h('p', { className: 'cding_p' }, '现在参数以 ~/.dsh/chloe-ding.json 为准；设置服务起来后这里会自动变成可编辑。'),
        )
      }

      return h('div', { className: 'cding_page' },
        h('h2', { className: 'cding_h' }, '克洛伊的叮'),
        h('p', { className: 'cding_p' }, '助手说完了响一声；它在等你回话时响一声更响的，并弹气泡。DSH 在前台时只响声音，不弹气泡。'),
        h('div', { className: 'cding_card' },
          h(Row, {
            label: '重复间隔（秒）',
            hint: '她等回话、你一直没回时，隔多久再响一次。',
            control: num('repeatMs', Math.round(repeatMs / 1000), 5, 600, 5),
          }),
          h(Row, {
            label: '音量',
            hint: '0 到 1。',
            control: num('volume', volume, 0, 1, 0.05),
          }),
          h(Row, { label: '弹 Windows 气泡', control: box('notify', notify) }),
          h(Row, {
            label: 'DSH 在前台时不弹气泡',
            hint: '你正看着屏幕的时候，只响声音。',
            control: box('quietWhenFocused', quiet),
          }),
          status,
        ),
        h('p', { className: 'cding_p' }, '改完即时生效；也可以直接改 ~/.dsh/chloe-ding.json（同名字段）。'),
      )
    }

    /** 客户端入口：DSH 会调用它。 */
    function apply(ctx) {
      // ⚠️ 踩过的坑：客户端的 apply **绝不能抛**。
      // 抛一次，DSH 启动就会判定「1 entry did not activate — dsh-chloe-ding: failed」，
      // 整个应用起不来。所有步骤都包在 try/catch 里，失败只记一句。
      const disposers = []
      let warnings = 0
      let registered = false
      let currentScope = null
      let disposeEntry = null

      const warnOnce = (text, detail) => {
        warnings += 1
        if (warnings <= 2) console.warn(`[dsh-chloe-ding] ${text}`, detail === undefined ? '' : String(detail))
      }

      /** 去找设置作用域；找不到返回 null（不是错误）。 */
      const resolveScope = () => {
        const configForms = ctx?.get?.('configForms') ?? ctx?.configForms
        if (configForms !== undefined && configForms !== null && typeof configForms.get === 'function') {
          for (const candidate of NS_CANDIDATES) {
            try {
              const got = configForms.get(candidate)
              if (got !== undefined && got !== null) return { scope: got, ns: candidate }
            } catch {
              // 这个命名空间还没注册，试下一个。
            }
          }
          return { scope: null, ns: NS }
        }
        const settingsScope = ctx?.get?.('settingsScope') ?? ctx?.settingsScope
        if (settingsScope !== undefined && settingsScope !== null && typeof settingsScope.bind === 'function') {
          try {
            return { scope: settingsScope.bind({ namespace: NS }), ns: NS }
          } catch {
            return { scope: null, ns: NS }
          }
        }
        return { scope: null, ns: NS }
      }

      /**
       * 挂（或升级）设置页。
       * 关键：**没有 scope 也先挂上去**——这样至少能证明“客户端条目挂到了设置区”，
       * 而不会把“命名空间没就绪”伪装成“页面不存在”。
       */
      const mount = () => {
        try {
          const slots = ctx?.slots
          if (slots === undefined || slots === null || typeof slots.inject !== 'function') return false

          const { scope, ns } = resolveScope()
          if (registered && (scope === null || scope === currentScope)) return true

          injectCss()
          try { disposeEntry?.() } catch { /* 旧条目可能已卸载 */ }
          disposeEntry = slots.inject('settings.section', () => slots.register(
            {
              name: 'settings.section',
              id: ns,
              order: 36,
              label: () => '克洛伊的叮',
              inject: () => ({ scope }),
            },
            SettingsSection,
          ))
          disposers.push(() => { try { disposeEntry?.() } catch { /* 清理失败不阻塞 */ } })
          registered = true
          currentScope = scope
          return true
        } catch (error) {
          // 典型：slot 还没被父条目声明（DSH 报错原文：slot "settings.section" is not declared）。
          warnOnce('设置页暂未挂上，稍后重试', error)
          return false
        }
      }

      // 第一次尽量立刻挂上；之后每 500ms 看一眼能不能把 scope 补进来（最多 2 分钟）。
      mount()
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        mount()
        if (attempts >= 240) clearInterval(timer)
      }, 500)
      disposers.push(() => clearInterval(timer))

      return () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* 清理失败不阻塞 */ }
        }
      }
    }

    exports.apply = apply
    exports.name = 'dsh-chloe-ding'
    // 声明依赖的客户端服务：DSH 会等它们就绪再激活本条目。
    // 少了这一句，条目可能在 slots 还没起来时就被激活——那一次抛错就把整个启动判失败。
    exports.inject = ['slots']
    return module.exports
  }
})
