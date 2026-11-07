"""生成 dsh-chloe-ding 自带的两段提示音（不引用任何第三方音频）。

done  : 一声 2093Hz 的「叮」，尾巴带拍频，会自己颤（「叮——inginging」）。
alert : 同一族，但先两下短起音、更亮更响、尾巴更长——一听就知道是同一对。

两段都是纯合成（正弦叠加 + 指数衰减），没有版权问题；改参数重跑即可：
    python tools/make-sounds.py
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np

SR = 22050
OUT = Path(__file__).resolve().parent.parent / "assets"


def bell(freq: float, dur: float, amp: float, decay: float, partials, click: float = 0.0) -> np.ndarray:
    """一个钟形音：partials 是 (倍频, 权重, 衰减倍率) 的列表。

    低倍频收得慢 = 余韵；高倍频收得快 = 清脆；非整数倍频 = 金属感。
    """
    n = int(SR * dur)
    t = np.arange(n) / SR
    attack = np.minimum(1.0, t / 0.0015)
    sig = np.zeros(n)
    for ratio, weight, speed in partials:
        sig += weight * np.exp(-decay * speed * t) * np.sin(2 * math.pi * freq * ratio * t)
    sig = sig * attack

    if click > 0:
        length = int(SR * 0.004)
        rng = np.random.default_rng(7)
        noise = np.diff(rng.standard_normal(length), prepend=0.0)  # 一阶差分 = 简易高通
        burst = np.zeros(n)
        burst[:length] = noise * np.exp(-np.linspace(0, 6, length))
        sig = sig + click * burst

    peak = np.max(np.abs(sig)) or 1.0
    return amp * sig / peak


def place(buf: np.ndarray, sig: np.ndarray, at_sec: float) -> None:
    start = int(SR * at_sec)
    end = min(len(buf), start + len(sig))
    buf[start:end] += sig[: end - start]


def write_wav(path: Path, mono: np.ndarray) -> None:
    peak = np.max(np.abs(mono)) or 1.0
    pcm = np.clip(mono / peak, -1.0, 1.0)
    data = (pcm * 32767.0).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(data)
    print(f"{path.name:12s} {len(mono) / SR:5.2f}s  {len(data) / 1024:6.1f} KiB")


# 钟的泛音是非谐的（2.76 / 5.40 …），这一步决定「金属」还是「电子琴」
RING = ((1.0, 1.00, 1.5), (2.76, 0.34, 2.4), (5.40, 0.13, 3.8))
SHORT = ((1.0, 1.00, 1.0), (2.00, 0.30, 1.8))


def build_done() -> np.ndarray:
    buf = np.zeros(int(SR * 2.2))
    # 起音轻轻带一下 1568，然后落到 2093
    place(buf, bell(1567.98, 0.30, 0.20, 18.0, SHORT, click=0.30), 0.0)
    place(buf, bell(2093.00, 2.1, 0.32, 3.6, RING, click=0.26), 0.10)
    # 失谐的一对：尾巴自己颤，这不是混响能做出来的
    BEAT = ((1.0, 1.00, 1.2), (2.76, 0.28, 2.0))
    place(buf, bell(2093.00 * 1.004, 2.1, 0.26, 3.4, BEAT), 0.10)
    place(buf, bell(2093.00 * 0.996, 2.1, 0.26, 3.4, BEAT), 0.10)
    return buf


def build_alert() -> np.ndarray:
    buf = np.zeros(int(SR * 2.6))
    # 两下短起音：1568 → 2093，像「叮-叮」
    place(buf, bell(1567.98, 0.35, 0.34, 16.0, SHORT, click=0.32), 0.00)
    place(buf, bell(2093.00, 0.45, 0.38, 14.0, RING, click=0.32), 0.14)
    # 主体更长更响，尾巴照样颤
    place(buf, bell(2637.02, 2.4, 0.30, 3.0, RING, click=0.30), 0.28)
    BEAT = ((1.0, 1.00, 1.1), (2.76, 0.26, 1.9))
    place(buf, bell(2637.02 * 1.004, 2.4, 0.24, 2.8, BEAT), 0.28)
    place(buf, bell(2637.02 * 0.996, 2.4, 0.24, 2.8, BEAT), 0.28)
    return buf


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_wav(OUT / "done.wav", build_done())
    write_wav(OUT / "alert.wav", build_alert())
