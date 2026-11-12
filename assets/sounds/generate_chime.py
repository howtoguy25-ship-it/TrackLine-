#!/usr/bin/env python3
"""Generates speed_warning_chime.wav -- a short, original, synthesized two-tone alert chime
(two pure sine tones a perfect fifth apart, each with a linear fade-in/out envelope to avoid
clicks). Written from scratch with Python's stdlib `wave`/`math` modules only -- no third-party
samples, loops, or libraries involved, so there's nothing to license or attribute. See
COPYRIGHT_AUDIT.md for why this replaced an earlier, undocumented copy of this file whose real
origin couldn't be confirmed.

Run: python3 assets/sounds/generate_chime.py
"""
import math
import struct
import wave

SAMPLE_RATE = 44100
AMPLITUDE = 0.5  # headroom below full scale so the two tones summed don't clip


def tone(freq_hz: float, duration_s: float, fade_s: float = 0.015) -> list[float]:
    n = int(SAMPLE_RATE * duration_s)
    fade_n = int(SAMPLE_RATE * fade_s)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        envelope = 1.0
        if i < fade_n:
            envelope = i / fade_n
        elif i > n - fade_n:
            envelope = (n - i) / fade_n
        samples.append(AMPLITUDE * envelope * math.sin(2 * math.pi * freq_hz * t))
    return samples


def main() -> None:
    # A perfect fifth up (880Hz -> 1320Hz), the same simple, universally pleasant "alert but not
    # alarming" interval a doorbell or a notification chime typically uses.
    samples = tone(880.0, 0.14) + tone(1320.0, 0.18)

    with wave.open("assets/sounds/speed_warning_chime.wav", "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        frames = b"".join(struct.pack("<h", max(-32768, min(32767, int(s * 32767)))) for s in samples)
        f.writeframes(frames)


if __name__ == "__main__":
    main()
