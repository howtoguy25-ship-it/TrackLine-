# Runs the app's own yamnet.tflite over ESC-50 clips the way the phone does: ~1 s windows at
# 16 kHz, top-10 scores per window, the app's siren rule (siren classes >= 0.6 and Music not
# above them), and the trigger (3 of the last 5 windows). Prints JSON results.
import csv, json, sys, wave
import numpy as np
from ai_edge_litert.interpreter import Interpreter

model, classmap, clipdir, picks = sys.argv[1:5]
# HOP: 16000 = back-to-back ~1 s windows (recorded-file mode); 7680 = the live stream (0.48 s, half overlap).
HOP = int(sys.argv[6]) if len(sys.argv) > 6 else 16000
WIN = 16000 if HOP == 16000 else 15600
labels = [r["display_name"] for r in csv.DictReader(open(classmap))]
SIREN = {"Siren", "Civil defense siren", "Emergency vehicle", "Police car (siren)", "Ambulance (siren)", "Fire engine, fire truck (siren)"}
interp = Interpreter(model_path=model)
inp = interp.get_input_details()[0]["index"]
out = interp.get_output_details()[0]["index"]

def load16k(path):
    w = wave.open(path)
    sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype={1: np.int8, 2: np.int16, 4: np.int32}[sw]).astype(np.float32)
    a = a.reshape(-1, ch).mean(axis=1) / float(2 ** (8 * sw - 1))
    n = int(len(a) * 16000 / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)

def classify(x):
    interp.resize_tensor_input(inp, [len(x)])
    interp.allocate_tensors()
    interp.set_tensor(inp, x)
    interp.invoke()
    s = interp.get_tensor(out)[0]
    top = np.argsort(-s)[:10]
    return {labels[i]: float(s[i]) for i in top}

def is_hit(scores, th=0.6):
    c = max([v for k, v in scores.items() if k in SIREN] + [0.0])
    return c >= th and scores.get("Music", 0.0) <= c, c

res = []
for line in open(picks):
    fn, cat = line.strip().split(",")
    x = load16k(f"{clipdir}/{fn}")
    wins = [x[i : i + WIN] for i in range(0, len(x) - WIN + 1, HOP)]
    hits, confs = [], []
    for wv in wins:
        h, c = is_hit(classify(wv))
        hits.append(h); confs.append(round(c, 3))
    trig = any(sum(hits[max(0, i - 4) : i + 1]) >= 3 for i in range(len(hits)))
    res.append({"file": fn, "cat": cat, "windows": len(wins), "hits": sum(hits), "triggered": trig, "confs": confs})
json.dump(res, open(sys.argv[5], "w"), indent=1)
pos = [r for r in res if r["cat"] == "siren"]; neg = [r for r in res if r["cat"] != "siren"]
print("siren clips triggered:", sum(r["triggered"] for r in pos), "/", len(pos))
print("non-siren clips triggered (false alarms):", sum(r["triggered"] for r in neg), "/", len(neg))
print("siren windows over threshold:", sum(r["hits"] for r in pos), "/", sum(r["windows"] for r in pos))
print("non-siren windows over threshold:", sum(r["hits"] for r in neg), "/", sum(r["windows"] for r in neg))
by = {}
for r in neg: by.setdefault(r["cat"], [0, 0, 0]); by[r["cat"]][0] += r["triggered"]; by[r["cat"]][1] += 1; by[r["cat"]][2] += r["hits"]
for k, v in sorted(by.items()): print(f"  {k}: {v[0]}/{v[1]} clips triggered, {v[2]} windows over")
