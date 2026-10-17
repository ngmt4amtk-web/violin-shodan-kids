#!/usr/bin/env python3
"""Astra が作った 3列x2行のシート（キー色背景）から、アプリで使う透過WebPを切り出す。

入力  src/generated/*.png
出力  assets/run/{fluffy,dino,dog}.webp     走りの6コマを横に並べた1枚（6コマ×同じ大きさ）
      assets/props/*.webp                   ゴールまわりの小道具6つ
      assets/stickers/*.webp                ごほうびシール6枚
      assets/scenery/meadow.webp            走るコースの背景

手順（2026-09-04 の「6コマ1枚」の判例と同じ）:
  1. 外周からキー色を推定し、距離から alpha を作る（ramp）
  2. キー色に近い縁だけデスピル（緑かぶり・マゼンタかぶりを消す）。中の絵は触らない
  3. シールは白いふちの外縁を「白とキー色の混ざり」として解いて、ふちを白のまま残す
  4. コマごとに切り、走りは6コマ共通の外接矩形で切る（コマ同士の位置関係を保つ）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "src" / "generated"
OUT = ROOT / "assets"

COLS, ROWS = 3, 2
NOMINAL = {"green": np.array([0, 177, 64]), "magenta": np.array([255, 0, 255])}

RUNS = [("fluffy", "run-fluffy.png", "green"), ("dino", "run-dino.png", "magenta"), ("dog", "run-dog.png", "green")]
PROPS = ("goalflag", "arch", "startflag", "balloons", "star", "medal")
STICKERS = ("lamb", "star", "sneaker", "violin", "trophy", "rainbow")


def estimate_key(arr, nominal):
    band = np.concatenate([arr[:12].reshape(-1, 3), arr[-12:].reshape(-1, 3), arr[:, :12].reshape(-1, 3), arr[:, -12:].reshape(-1, 3)])
    d = np.sqrt(((band.astype(np.int32) - nominal) ** 2).sum(1))
    sel = band[d < 80]
    return np.median(sel, axis=0) if len(sel) else nominal.astype(np.float32)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def make_alpha(arr, key, lo=50.0, hi=130.0):
    d = np.sqrt(((arr.astype(np.float32) - key) ** 2).sum(-1))
    return smoothstep((d - lo) / (hi - lo))


def edge_zone(alpha, px=3):
    near = ndi.binary_dilation(alpha < 0.5, iterations=px)
    return near & (alpha > 0)


def despill(rgb, alpha, kind):
    zone = edge_zone(alpha)
    out = rgb.astype(np.float32).copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    if kind == "green":
        lim = np.maximum(r, b)
        out[..., 1] = np.where(zone & (g > lim), lim + (g - lim) * 0.15, g)
    else:  # magenta
        m = np.minimum(r, b)
        excess = np.where(zone & (m > g), m - g, 0)
        out[..., 0] = r - excess * 0.85
        out[..., 2] = b - excess * 0.85
    return np.clip(out, 0, 255)


def unmix_white(rgb, alpha, kind):
    """白いふちの外縁: 画素 = a*白 + (1-a)*キー として a を求め、色は白に戻す。"""
    zone = edge_zone(alpha, 4)
    out = rgb.astype(np.float32).copy()
    a = alpha.copy()
    if kind == "magenta":
        r, g, b = out[..., 0], out[..., 1], out[..., 2]
        mix = zone & (r > 225) & (b > 225) & (g < 250)
        a = np.where(mix, np.clip(g / 255.0, 0, 1), a)
        out[mix] = 255
    return out, a


def to_rgba(sheet_path, kind, white_border=False):
    arr = np.array(Image.open(sheet_path).convert("RGB"))
    key = estimate_key(arr, NOMINAL[kind])
    alpha = make_alpha(arr, key)
    if white_border:
        rgb, alpha = unmix_white(arr, alpha, kind)
        rgb = despill(rgb, alpha, kind)
        # 白いふちの外側の薄い残りを消す
        alpha = np.where(alpha < 0.04, 0, alpha)
    else:
        rgb = despill(arr, alpha, kind)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return rgba


def cells(rgba):
    h, w = rgba.shape[:2]
    ch, cw = h // ROWS, w // COLS
    for r in range(ROWS):
        for c in range(COLS):
            yield r * COLS + c, rgba[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]


def art_bbox(cell, thresh=0.2, min_area=40):
    """小さなゴミを除いた、絵の外接矩形 (x0,y0,x1,y1)。"""
    mask = cell[..., 3] > thresh * 255
    lab, n = ndi.label(mask)
    if n == 0:
        return None
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= min_area])
    ys, xs = np.where(keep)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def save_webp(img, path, quality=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6)
    return path.stat().st_size


def resize_to(img, *, height=None, max_side=None):
    w, h = img.size
    if height:
        s = height / h
    else:
        s = min(1.0, max_side / max(w, h))
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def do_runs(frame_h=300):
    for name, fn, kind in RUNS:
        rgba = to_rgba(GEN / fn, kind)
        frames = [c for _, c in cells(rgba)]
        boxes = [art_bbox(f) for f in frames]
        x0 = min(b[0] for b in boxes) - 6
        y0 = min(b[1] for b in boxes) - 6
        x1 = max(b[2] for b in boxes) + 6
        y1 = max(b[3] for b in boxes) + 6
        crops = [Image.fromarray(f[max(0, y0):y1, max(0, x0):x1]) for f in frames]
        w, h = crops[0].size
        s = frame_h / h
        fw, fh = round(w * s), frame_h
        strip = Image.new("RGBA", (fw * len(crops), fh), (0, 0, 0, 0))
        for i, cimg in enumerate(crops):
            strip.paste(cimg.resize((fw, fh), Image.LANCZOS), (i * fw, 0))
        size = save_webp(strip, OUT / "run" / f"{name}.webp")
        print(f"run/{name}.webp  frame {fw}x{fh} x{len(crops)}  {size // 1024}KB")


def do_sheet(fn, kind, names, outdir, white_border=False, max_side=384):
    rgba = to_rgba(GEN / fn, kind, white_border=white_border)
    for (i, cell), name in zip(cells(rgba), names):
        b = art_bbox(cell)
        pad = 4
        crop = Image.fromarray(cell[max(0, b[1] - pad):b[3] + pad, max(0, b[0] - pad):b[2] + pad])
        crop = resize_to(crop, max_side=max_side)
        size = save_webp(crop, OUT / outdir / f"{name}.webp")
        print(f"{outdir}/{name}.webp  {crop.size[0]}x{crop.size[1]}  {size // 1024}KB")


def do_scenery(width=1280):
    img = Image.open(GEN / "scenery-meadow.png").convert("RGB")
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    path = OUT / "scenery" / "meadow.webp"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=80, method=6)
    print(f"scenery/meadow.webp  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024}KB")


def main():
    do_runs()
    do_sheet("props-sheet.png", "green", PROPS, "props")
    do_sheet("stickers-sheet.png", "magenta", STICKERS, "stickers", white_border=True)
    do_scenery()


if __name__ == "__main__":
    main()
