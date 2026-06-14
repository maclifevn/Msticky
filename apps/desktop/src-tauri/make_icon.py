#!/usr/bin/env python3
"""Generate a 1024x1024 source icon (rounded amber note with a folded corner).
Used once to seed `tauri icon`; safe to delete afterwards."""
import zlib, struct, math

W = H = 1024
R = 190          # corner radius
FOLD = 300       # folded-corner size (top-right)
AMBER = (251, 191, 36)
AMBER_DK = (217, 160, 20)
INK = (120, 80, 10)

def inside_round_rect(x, y):
    if x < R and y < R:
        return (x - R) ** 2 + (y - R) ** 2 <= R * R
    if x > W - R and y < R:
        return (x - (W - R)) ** 2 + (y - R) ** 2 <= R * R
    if x < R and y > H - R:
        return (x - R) ** 2 + (y - (H - R)) ** 2 <= R * R
    if x > W - R and y > H - R:
        return (x - (W - R)) ** 2 + (y - (H - R)) ** 2 <= R * R
    return 0 <= x < W and 0 <= y < H

def pixel(x, y):
    # margin so the note doesn't touch icon edges
    m = 70
    if not (m <= x < W - m and m <= y < H - m):
        return (0, 0, 0, 0)
    lx, ly = x - m, y - m
    lw, lh = W - 2 * m, H - 2 * m
    # rounded rect within the inset region
    def rr(px, py):
        r = R
        if px < r and py < r: return (px - r) ** 2 + (py - r) ** 2 <= r * r
        if px > lw - r and py < r: return (px - (lw - r)) ** 2 + (py - r) ** 2 <= r * r
        if px < r and py > lh - r: return (px - r) ** 2 + (py - (lh - r)) ** 2 <= r * r
        if px > lw - r and py > lh - r: return (px - (lw - r)) ** 2 + (py - (lh - r)) ** 2 <= r * r
        return 0 <= px < lw and 0 <= py < lh
    if not rr(lx, ly):
        return (0, 0, 0, 0)
    # folded corner triangle (top-right) drawn darker
    if (lw - lx) + ly < FOLD:
        return (*AMBER_DK, 255)
    # three "text lines" as ink bars
    for i, cy in enumerate((0.42, 0.56, 0.70)):
        bar_y = lh * cy
        if abs(ly - bar_y) < 26 and lw * 0.18 < lx < lw * (0.82 if i < 2 else 0.6):
            return (*INK, 255)
    return (*AMBER, 255)

raw = bytearray()
for y in range(H):
    raw.append(0)  # filter type 0
    for x in range(W):
        raw.extend(pixel(x, y))

def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

with open("icon-source.png", "wb") as f:
    f.write(png)
print("wrote icon-source.png")
