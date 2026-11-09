"""アプリのアイコン (PNG) を作る。Python 標準ライブラリだけを使う。
使い方: python3 tools/make-icons.py  (icons/ に書き出す)
"""
import struct
import zlib
from pathlib import Path

GREEN = (47, 133, 90)
WHITE = (255, 255, 255)


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def draw(size, scale):
    """緑の背景に白いチェックマーク。scale はマークの大きさ (maskable は小さめ)。"""
    c = size / 2
    pts = [(-0.30, 0.02), (-0.08, 0.24), (0.32, -0.20)]
    pts = [(c + x * size * scale, c + y * size * scale) for x, y in pts]
    width = size * 0.075 * scale
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d = min(dist_to_segment(px, py, *pts[0], *pts[1]),
                    dist_to_segment(px, py, *pts[1], *pts[2]))
            a = max(0.0, min(1.0, width - d + 0.5))  # 縁をなめらかにする
            row += bytes(round(g * (1 - a) + w * a) for g, w in zip(GREEN, WHITE))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


out = Path(__file__).resolve().parent.parent / 'icons'
out.mkdir(exist_ok=True)
for name, size, scale in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0),
                          ('icon-maskable-512.png', 512, 0.75), ('apple-touch-icon.png', 180, 1.0)]:
    (out / name).write_bytes(draw(size, scale))
    print('wrote', name)
