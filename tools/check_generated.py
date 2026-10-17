#!/usr/bin/env python3
"""src/generated/ の画像が契約どおりか機械判定する。

使い方:
  python3 tools/check_generated.py run     # 走りのシート3枚
  python3 tools/check_generated.py misc    # 小道具・シール・背景
  python3 tools/check_generated.py all

合格条件:
  - ファイルがある。PNG。1536x1024（シート・背景とも）
  - キー色の背景: 外周の画素の95%以上がキー色に近い
  - シートは 3列x2行 の6コマ。各コマの外周6pxがほぼキー色（絵がコマをまたいでいない）
  - 各コマに絵がある（キー色でない画素が3%以上）
  - 背景(scenery)はキー色を使わず、画素の平均輝度が極端に暗くも白くもない
"""
import sys
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "src" / "generated"

GREEN = (0, 177, 64)
MAGENTA = (255, 0, 255)

SPEC = {
    "run-fluffy.png": dict(key=GREEN, sheet=True),
    "run-dino.png": dict(key=MAGENTA, sheet=True),
    "run-dog.png": dict(key=GREEN, sheet=True),
    "props-sheet.png": dict(key=GREEN, sheet=True),
    "stickers-sheet.png": dict(key=MAGENTA, sheet=True),
    "scenery-meadow.png": dict(key=None, sheet=False),
}
GROUPS = {
    "run": ["run-fluffy.png", "run-dino.png", "run-dog.png"],
    "misc": ["props-sheet.png", "stickers-sheet.png", "scenery-meadow.png"],
}
W, H = 1536, 1024
COLS, ROWS = 3, 2
TOL = 70  # RGB距離。生成画像は完全な平坦色にならないので余裕を持たせる


def near_key(arr, key):
    d = np.sqrt(((arr.astype(np.int32) - np.array(key)) ** 2).sum(axis=-1))
    return d <= TOL


def check_file(name):
    spec = SPEC[name]
    errs = []
    info = {}
    path = GEN / name
    if not path.exists():
        return [f"{name}: ファイルが無い"], info
    try:
        img = Image.open(path)
        img.load()
    except Exception as e:  # noqa: BLE001
        return [f"{name}: 開けない {e}"], info
    if img.format != "PNG":
        errs.append(f"{name}: PNGではない({img.format})")
    if img.size != (W, H):
        errs.append(f"{name}: サイズが{W}x{H}でない({img.size[0]}x{img.size[1]})")
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]
    if spec["key"] is None:
        key_hit = near_key(arr, GREEN).mean()
        mag_hit = near_key(arr, MAGENTA).mean()
        lum = arr.mean()
        info.update(green_ratio=round(float(key_hit), 4), magenta_ratio=round(float(mag_hit), 4), mean_lum=round(float(lum), 1))
        if key_hit > 0.2 or mag_hit > 0.2:
            errs.append(f"{name}: 背景にキー色が多い(緑{key_hit:.2f}/マゼンタ{mag_hit:.2f})")
        if not (60 < lum < 235):
            errs.append(f"{name}: 平均輝度が極端({lum:.0f})")
        return errs, info
    hit = near_key(arr, spec["key"])
    band = 12
    edge = np.concatenate([hit[:band].ravel(), hit[-band:].ravel(), hit[:, :band].ravel(), hit[:, -band:].ravel()])
    info["edge_key_ratio"] = round(float(edge.mean()), 4)
    if edge.mean() < 0.95:
        errs.append(f"{name}: 外周のキー色が{edge.mean():.2f}（0.95以上が必要）")
    if spec["sheet"]:
        cw, ch = w // COLS, h // ROWS
        cells = []
        for r in range(ROWS):
            for c in range(COLS):
                cell = hit[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
                art = 1.0 - float(cell.mean())
                b = 6
                rim = np.concatenate([cell[:b].ravel(), cell[-b:].ravel(), cell[:, :b].ravel(), cell[:, -b:].ravel()])
                cells.append((round(art, 3), round(float(rim.mean()), 4)))
                if art < 0.03:
                    errs.append(f"{name}: コマ{r * COLS + c + 1}に絵が無い(絵の割合{art:.3f})")
                if rim.mean() < 0.98:
                    errs.append(f"{name}: コマ{r * COLS + c + 1}の外周に絵がはみ出している(キー色{rim.mean():.3f})")
        info["cells(art,rim_key)"] = cells
    return errs, info


def main():
    group = sys.argv[1] if len(sys.argv) > 1 else "all"
    names = sum(GROUPS.values(), []) if group == "all" else GROUPS.get(group)
    if names is None:
        print(f"不明な群: {group}", file=sys.stderr)
        sys.exit(2)
    all_errs = []
    report = {}
    for n in names:
        errs, info = check_file(n)
        report[n] = {"ok": not errs, **info}
        all_errs += errs
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if all_errs:
        print("\nNG:", file=sys.stderr)
        for e in all_errs:
            print("  - " + e, file=sys.stderr)
        sys.exit(1)
    print("\nOK: すべて合格")


if __name__ == "__main__":
    main()
