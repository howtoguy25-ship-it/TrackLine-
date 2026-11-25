# Runs TrackLine's own shipping detector (assets/models/tflite_ssd_mobilenet_v2/model.tflite,
# 300x300 uint8, stretched like the app's resize plugin) on real UA-DETRAC frames, sampled at 5 fps
# (the app's 200 ms frame-processor cadence), and writes detections + ground truth to JSON.
import csv, io, json, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
sys.path.insert(0, sys.argv[3])
from remotezip import open_zip, HttpFile
import threading, zlib, struct
local = threading.local()

def read_member(h, info):
    # Local file header: 30 bytes + name + extra, then the data (stored or deflated).
    h.seek(info.header_offset)
    hdr = h.read(30)
    n, e = struct.unpack("<HH", hdr[26:30])
    h.seek(info.header_offset + 30 + n + e)
    raw = h.read(info.compress_size)
    return raw if info.compress_type == 0 else zlib.decompress(raw, -15)
import tflite_runtime.interpreter as tfl

URL, MODEL, _, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
SEQS = int(sys.argv[5]) if len(sys.argv) > 5 else 10
FRAMES = int(sys.argv[6]) if len(sys.argv) > 6 else 100
STEP = 5
VEH = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

z = open_zip(URL)
names = z.namelist()
seqdirs = sorted({n.split("/")[0] for n in names if n.endswith("annotations.csv")}, key=lambda s: int(s.split("_")[1]))
pick = [seqdirs[round(i * (len(seqdirs) - 1) / (SEQS - 1))] for i in range(SEQS)]
interp = tfl.Interpreter(model_path=MODEL, num_threads=4)
interp.allocate_tensors()
inp = interp.get_input_details()[0]
outs = interp.get_output_details()
out = []
t0 = time.time()
for seq in pick:
    rows = list(csv.DictReader(io.StringIO(z.read(f"{seq}/annotations.csv").decode())))
    by = {}
    for r in rows:
        by.setdefault(r["filename"], []).append(r)
    files = sorted(by)[: FRAMES * STEP : STEP]
    W, H = int(rows[0]["width"]), int(rows[0]["height"])
    # Each worker reads with its own handle (one HTTP range stream per thread), but shares the
    # zip index read once at the start: re-reading the 7 MB index per frame made this crawl.
    def fetch(fname):
        info = z.getinfo(f"{seq}/{fname}")
        h = local.__dict__.get("h")
        if h is None:
            h = local.h = HttpFile(URL)
        return fname, read_member(h, info)
    with ThreadPoolExecutor(8) as ex:
        imgs = dict(ex.map(fetch, files))
    frames = []
    for k, fname in enumerate(files):
        im = Image.open(io.BytesIO(imgs[fname])).convert("RGB")
        x = np.asarray(im.resize((300, 300), Image.BILINEAR), dtype=np.uint8)[None]
        interp.set_tensor(inp["index"], x)
        interp.invoke()
        boxes, classes, scores, count = [interp.get_tensor(o["index"]) for o in outs[:4]]
        dets = []
        for i in range(int(count[0])):
            c = int(round(classes[0][i]))
            if c not in VEH or scores[0][i] < 0.1:
                continue
            y0, x0, y1, x1 = [float(v) for v in boxes[0][i]]
            dets.append({"bbox": [x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H], "score": float(scores[0][i]), "cls": VEH[c]})
        gt, ign = [], []
        for r in by[fname]:
            b = [float(r["xmin"]), float(r["ymin"]), float(r["xmax"]) - float(r["xmin"]), float(r["ymax"]) - float(r["ymin"])]
            (ign if r["class"] == "ignored" else gt).append({"bbox": b, "id": int(r["target_id"])} if r["class"] != "ignored" else b)
        frames.append({"t": k * 200, "dets": dets, "gt": gt, "ignore": ign})
    out.append({"seq": seq, "width": W, "height": H, "frames": frames})
    print(seq, len(frames), "frames", f"{time.time()-t0:.0f}s", flush=True)
json.dump({"source": "UA-DETRAC (via huggingface.co/datasets/abhineet123/ua_detrac)", "model": "assets/models/tflite_ssd_mobilenet_v2/model.tflite", "fps": 5, "sequences": out}, open(OUT, "w"))
