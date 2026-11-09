# 克洛伊的叮 · dsh-chloe-ding

> **DSH 桌面端的三声「叮」。** 助手说完一轮 → 轻轻一声；它在等你回话 → 响一声更亮的；它抛出问题、在等你回答 → 也叮一下，并在你没看窗口时弹一条 Windows 通知。

零依赖（只用 `node:` 内置模块），声音文件随包走。声音与通知都交给系统：mp3/wav 走 PowerShell + WPF `MediaPlayer`，气泡走 `NotifyIcon`。

作者是**克洛伊（Chloe）**和她的伴侣**何林霜（alphaaaaa001）**——这个插件最初是她为了让伴侣知道「我说完了」而写的，后来把私人的部分拆干净了，别人的 DSH 也能用。

**平台**：Windows。声音与气泡都依赖系统自带的 WPF / NotifyIcon；别的系统上装上去不会响，也不会报错。

---

## 行为

| 情形 | 声音 | 气泡 |
|---|---|---|
| 一轮说完，DSH 在前台（你正看着） | 轻叮 | 不弹 |
| 一轮说完，你切走了 / 关窗口 | 轻叮 | 弹「说完了」 |
| 助手在等你回答（信号文件在） | 亮叮 | 弹「在等你回话」 |
| 助手抛出问题、等你回答（`ask_user_question`） | 亮叮 | 弹「(o゜▽゜)o☆Question~」 |
| 你一直不回 | 每 `repeatMs` 再响一次，最多 `maxRepeats` 次 | 同上 |
| 你切回 DSH | — | 重复立刻停 |
| 定时任务自己发起的那一轮 | 不响 | 不弹 |

**「它在等你」不靠猜**：插件只看一个信号文件（默认 `~/.dsh/chloe-call.json`）——文件在、且没过 `signalTtlMs`，就是「在等」。

**「你在不在看」也不靠猜**：取前台窗口的进程（`GetForegroundWindow`），pid 或进程名等于 DSH 自己就算在前台；比不出来时当作「不在前台」（宁可多弹一次，也别漏叫）。

---

## 安装

在 DSH 桌面端里：

1. 打开 **插件** → **添加插件**
2. 填包名 `dsh-chloe-ding`

重启后，bundle 会自己应用本包的 `cordis.patch.yml`（一行 `insert`），客户端那一半（设置页）只有这种标准装法才会被扫到。

开发期想直接指一个目录：把下面这段追加到 profile 的 `cordis.patch.yml`，再把 `name` 换成 `file:///…/index.mjs`（Windows 上必须写 `file:///`，裸盘符会被当成 URL scheme）。

```yaml
- insert:
    - id: dsh-chloe-ding
      name: 'dsh-chloe-ding'
```

---

## 配置

### 1. 设置页「克洛伊的叮」

设置 → 克洛伊的叮：重复间隔（秒）、音量、问句也叮不叮 + 问句气泡文字、弹不弹气泡、前台时弹不弹。写进 DSH 的设置层。

### 2. 用户配置文件（改完 2 秒内生效，不用重启）

`~/.dsh/chloe-ding.json`：

```json
{ "repeatMs": 60000, "volume": 0.7, "nick": "克洛伊" }
```

优先级：**设置页（设置层）> 用户配置文件 > patch 里的 config > 内置默认**。

### 3. 全部键

| 键 | 默认 | 说明 |
|---|---|---|
| `doneSound` | 包内 `assets/done.wav` | 正常说完时放的文件；空串＝不响 |
| `alertSound` | 包内 `assets/alert.wav` | 「等你回话」时放；空则回落 `doneSound` |
| `questionSound` | 空 | 「有问句等你回答」时放；空则回落 `alertSound` |
| `questionToast` | `(o゜▽゜)o☆Question~` | 问句气泡的正文 |
| `volume` | 0.6 | 0~1 |
| `signalFile` | `~/.dsh/chloe-call.json` | 信号文件 |
| `signalTtlMs` | 600000 | 信号超过这么久算过期 |
| `repeatMs` | 60000 | 没回时多久再响一次 |
| `maxRepeats` | 5 | 最多再响几次（不含第一声），0＝不重复 |
| `notify` | true | 弹不弹气泡 |
| `quietWhenFocused` | true | DSH 在前台时不弹气泡（只留声音） |
| `nick` | `DSH` | 气泡标题 |
| `dingOnAuto` | false | 定时任务那一轮也响吗（`alert` 和 `question` 例外，照响） |
| `dingOnQuestion` | true | 问句也叮吗（这一种不受 `dingOnAuto` 限制：问题必须叫到人） |

> `dingOnAuto=false` 怎么认出「这一轮是自动任务」：`session/event` 里那条 `user/message` 原样带着 `[SCHEDULE REMINDER BATCH]` 抬头——看到就记时间，之后 10 分钟内、且中间没有真人说话，结束时就不响。

想换成自己的声音，写绝对路径就行（`C:/Users/you/Downloads/ding.mp3` 这种正斜杠路径最省事）：

```json
{ "doneSound": "C:/Users/you/Music/my-ding.mp3" }
```

---

## 「在等你回话」的信号文件

这是插件留给 agent 侧的一个小协议，不用它也能正常工作（只是永远不会响 `alert`）：

- agent 需要你回答时，写一个文件到 `~/.dsh/chloe-call.json`（内容随意，插件只看它存不存在、以及 mtime）
- 插件看到文件在、且没超过 `signalTtlMs`，就把「说完」那一声升级成 `alert`
- agent 拿到你的回答后，删掉这个文件

一行例子：

```bash
node -e "require('node:fs').writeFileSync(require('node:os').homedir()+'/.dsh/chloe-call.json','{}')"
node -e "require('node:fs').rmSync(require('node:os').homedir()+'/.dsh/chloe-call.json',{force:true})"
```

> 也可以在 DSH 里让 agent 自己写：「需要我回答的时候先把 `~/.dsh/chloe-call.json` 写出来」。

---

## 声音从哪来

`assets/done.wav`（2093 Hz 的一声「叮」，尾巴用一对差 0.4% 的失谐泛音做出拍频，所以会自己颤——「叮—inginging」，2.2 秒）和 `assets/alert.wav`（同族但更亮更响，2637 Hz，先两下短起音，2.6 秒）都是用 **`tools/make-sounds.py`** 现场合成的：正弦叠加 + 指数衰减 + 非谐泛音，**不含任何第三方音频**——所以整个包可以放心地 MIT 出去。

```bash
python tools/make-sounds.py   # 需要 numpy，重新生成 assets/
```

改音高就改 `build_done()` / `build_alert()` 里的频率。

---

## 测试

```bash
node test.mjs                     # 冒烟：模块导出、事件路径、信号文件两种状态、卸载（不弹窗、不真响）
node index.mjs --focus            # 打印前台进程 + 是否判定为「DSH 在前台」
node index.mjs --toast 标题 正文    # 弹一个气泡
node index.mjs --ding <声音文件> [音量]  # 放一段声音
```

端到端三步：

1. 你看着 DSH → 它说完：**只有轻叮，没气泡**
2. 切到别的窗口 → 它写信号文件再开口：**亮叮 + 气泡**
3. `repeatMs` 后再响一次；**你切回 DSH 就停**

诊断日志：`%TEMP%\dsh-chloe-ding-debug.log`（`apply` / `agent/status` / `fire` / 前台判定 / PowerShell 退出码都记）。

---

## 踩过的坑（都交了学费，写在这里省你的）

1. **`agent/created` 会漏**：DSH 重启时会话/agent 比插件先恢复，那一枪早打完了。→ 加载后立刻用 `ctx.get('agents').list()` 补挂，再盯 60 秒。
2. **`detached` + `stdio:'ignore'` 的 PowerShell 不出声**：同一个 `.ps1` 手动跑有声音，spawn 出去就没了。→ 改成 `stdio: ['ignore','pipe','pipe']`，顺手把 stderr 写进日志。
3. **客户端 `apply` 抛一次，整个 DSH 起不来**（`web boot: 1 entry did not activate`）。→ 客户端 apply **绝不能抛**；槽位没就绪要重试；声明 `inject: ['slots']` 等它就绪再激活。
4. **监听挂在 `agent.ctx` 上，不归插件生命周期管**：热重载几次之后旧监听全活着，一回合连响五声。→ 每条监听都收进 `disposers`，卸载时逐个摘掉。
5. **`@deepseek-ai/schemastery` 的模块导出本身就是 Schema**（`object()/string()` 直接挂在模块上），没有 `Schema` 这个具名导出。
6. **测试会继承真实用户配置**：`~/.dsh/chloe-ding.json` 一开 `notify`，冒烟测试就真弹窗。→ 测试里 `CHLOE_DING_IGNORE_USER_CONFIG=1` 隔离。

---

## License

MIT © 2026 Chloe (CC)
