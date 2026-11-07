"""生成 dsh-chloe-ding 自带的两段提示音（不引用任何第三方音频）。

done  : 一颗柔和的「叮」——C6 基音 + G6 泛音，快起音、指数衰减。
alert : 三连上行「叮-叮-叮」——A5 → D6 → G6，更长、更亮。

两段都是纯合成，无版权问题；改参数重跑即可：
    python tools/make-sounds.py
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np

SR = 22050
OUT = Path(__file__).resolve().parent.parent / "assets"


def bell(freq: float, dur: float, amp: float = 1.0, decay: float = 6.0) -> np.ndarray:
    """一个钟形音：基音 + 2/3/4 次泛音，各自不同的衰减速度。"""
    n = int(SR * dur)
    t = np.arange(n) / SR

    # 起音包络（5ms），避免爆音
    attack = np.minimum(1.0, t / 0.005)

    wave_sum = np.zeros(n, dtype=np.float64)
    for mult, weight, speed in ((1.0, 1.00, 1.0), (2.0, 0.35, 1.4), (3.0, 0.16, 1.9), (4.01, 0.07, 2.6)):
        env = np.exp(-decay * speed * t)
        # 轻微失谐，声音不呆板（模拟真实金属的拍频）
        detune = 1.0 + 0.0012 * (mult - 1.0)
        wave_sum += weight * env * np.sin(2 * math.pi * freq * detune * t)

    sig = wave_sum * attack
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


def build_done() -> np.ndarray:
    total = int(SR * 1.05)
    buf = np.zeros(total)
    place(buf, bell(1046.50, 1.0, amp=0.42, decay=5.0), 0.0)  # C6
    place(buf, bell(1567.98, 0.75, amp=0.20, decay=6.5), 0.0)  # G6，同一击的亮层
    return buf


def build_alert() -> np.ndarray:
    total = int(SR * 1.9)
    buf = np.zeros(total)
    notes = ((880.00, 0.000, 0.50, 3.6),   # A5
             (1174.66, 0.155, 0.52, 3.4),  # D6
             (1567.98, 0.310, 0.58, 2.6))  # G6 收尾
    for freq, at, amp, decay in notes:
        place(buf, bell(freq, 1.5, amp=amp, decay=decay), at)
        place(buf, bell(freq * 2, 1.0, amp=amp * 0.22, decay=decay * 1.6), at)
    return buf


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_wav(OUT / "done.wav", build_done())
    write_wav(OUT / "alert.wav", build_alert())
