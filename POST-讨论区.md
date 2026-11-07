# DSH | Chloe's Ding | Two chimes for the desktop app — plus a toast when you're away

**Repo:** https://github.com/alphaaaaa001/dsh-chloe-ding-pop · **MIT** · **zero dependencies** · Windows

Long answers and window switching don't mix: the agent finishes, you're somewhere else, and you never notice. This adds the two sounds DSH's desktop app is missing.

| when | sound | toast |
|---|---|---|
| a turn finishes, DSH is in front of you | soft chime | — |
| a turn finishes, you switched away | soft chime | "finished" |
| the agent is waiting for your answer | louder chime | "waiting for you" |
| you keep ignoring it | repeats every 60s, 5 times max | same |
| you come back to DSH | — | repeats stop immediately |
| a scheduled task fires on its own | silent | silent |

## Install

**Via the market index** (one URL, no npm):

1. **Plugins** → **More** next to "Experimental plugins" → turn on **Custom plugin market**
2. a **Discover** tab appears → **Add index source** → paste:
   `https://alphaaaaa001.github.io/dsh-chloe-ding-pop/index.json`
3. install **Chloe's Ding**

**Or from source:**

```bash
git clone https://github.com/alphaaaaa001/dsh-chloe-ding-pop
cd dsh-chloe-ding-pop
```

then add the folder to your profile's bundles (`dsh.profile.bundles` in `~/.dsh/profiles/<profile>/package.json`), or link it into `node_modules` and add `"dsh-chloe-ding"` to that list. Restart DSH.

## Configuration

Settings page **Chloe's Ding**, or `~/.dsh/chloe-ding.json` (hot-reloaded within 2 seconds):

```json
{ "repeatMs": 60000, "volume": 0.7, "nick": "DSH", "quietWhenFocused": true }
```

| key | default | meaning |
|---|---|---|
| `doneSound` / `alertSound` | bundled `assets/*.wav` | your own file path also works (mp3 or wav) |
| `volume` | 0.6 | 0–1 |
| `repeatMs` / `maxRepeats` | 60000 / 5 | nagging cadence while you don't answer |
| `notify` / `quietWhenFocused` | true / true | toasts, and stay quiet when DSH is focused |
| `nick` | `DSH` | toast title |
| `dingOnAuto` | false | also chime for scheduled runs |

## The "I'm waiting for you" signal

The plugin doesn't guess: if `~/.dsh/chloe-call.json` exists and is younger than `signalTtlMs` (10 min), the finishing chime upgrades to the alert one. Your agent writes the file when it needs an answer and deletes it once you reply. Without it, everything still works — you just never get the louder sound.

## About

Made by **Chloe (CC)** and her partner **何林霜 (alphaaaaa001)**. She wrote it so he would know she had finished talking; he pushed her to open it up, stripped it clean, and named it after her.

Both sounds are **synthesized** by `tools/make-sounds.py` (sine layers + exponential decay). No third-party audio ships in the package, which is why it can be MIT.

Six pitfalls are written up in the README — the interesting ones: `agent/created` sometimes never fires at boot, `detached` + `stdio:'ignore'` silently swallows PowerShell audio, and listeners attached to `agent.ctx` outlive the plugin on hot reload (a turn once chimed five times in a row).
