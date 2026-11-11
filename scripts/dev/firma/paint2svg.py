#!/usr/bin/env python3
"""paint2svg.py <matte.png> <out.svg> [--iso 0.5] [--eps 0.6] [--min-area 12] [--height 100] [--blur 0]

Turns a paint MATTE (greyscale PNG: white = paint, black = no paint, greys = thin / dry paint) into a
single-colour SVG that keeps the painted look: ragged edges, dry-brush gaps and holes.

- contours: marching squares with linear interpolation at --iso (sub-pixel, so edges are not staircased)
- --eps: Ramer–Douglas–Peucker tolerance in matte pixels (smaller = more ragged detail, bigger file)
- --min-area: drop islands AND holes smaller than this many matte pixels² (specks)
- --blur: optional gaussian blur radius (matte px) before tracing, to calm JPEG noise
- output: <svg viewBox="0 0 W H"> tight around the paint, scaled so H = --height, one <path> with
  fill="currentColor" fill-rule="evenodd", coordinates with 1 decimal, relative line segments.
Prints the byte size, viewBox and number of contours/points.
"""
import sys, math
import numpy as np
from PIL import Image, ImageFilter

def args():
    a = sys.argv[1:]
    pos = [x for i, x in enumerate(a) if not x.startswith('--') and (i == 0 or not a[i-1].startswith('--'))]
    opt = {'iso': 0.5, 'eps': 0.6, 'min-area': 12.0, 'height': 100.0, 'blur': 0.0}
    for i, x in enumerate(a):
        if x.startswith('--'): opt[x[2:]] = float(a[i+1])
    return pos[0], pos[1], opt

def contours(f, iso):
    """Closed polylines of the iso-level of f (2D float array), sub-pixel. Paint (f > iso) is on the left."""
    h, w = f.shape
    f = np.pad(f, 1, constant_values=0.0)
    segs = {}
    def lerp(a, b):  # position between two samples where the iso level is crossed
        d = b - a
        return 0.5 if d == 0 else (iso - a) / d
    inside = f > iso
    ys, xs = np.nonzero(inside[:-1, :-1] | inside[:-1, 1:] | inside[1:, :-1] | inside[1:, 1:])
    for y, x in zip(ys.tolist(), xs.tolist()):
        a, b, c, d = f[y, x], f[y, x+1], f[y+1, x+1], f[y+1, x]   # tl, tr, br, bl
        idx = (a > iso) << 3 | (b > iso) << 2 | (c > iso) << 1 | (d > iso)
        if idx in (0, 15): continue
        T = (x + lerp(a, b), y); R = (x + 1, y + lerp(b, c)); B = (x + lerp(d, c), y + 1); L = (x, y + lerp(a, d))
        table = {1: [(L, B)], 2: [(B, R)], 3: [(L, R)], 4: [(R, T)], 6: [(B, T)], 7: [(L, T)], 8: [(T, L)],
                 9: [(T, B)], 11: [(T, R)], 12: [(R, L)], 13: [(R, B)], 14: [(B, L)]}
        if idx == 5: pairs = [(L, T), (R, B)] if (a + b + c + d) / 4 > iso else [(L, B), (R, T)]
        elif idx == 10: pairs = [(T, R), (B, L)] if (a + b + c + d) / 4 > iso else [(T, L), (B, R)]
        else: pairs = table[idx]
        for p, q in pairs:
            segs.setdefault((round(p[0], 4), round(p[1], 4)), []).append((round(q[0], 4), round(q[1], 4)))
    out = []
    while segs:
        start = next(iter(segs)); pts = [start]; cur = start
        while True:
            nxt = segs[cur].pop()
            if not segs[cur]: del segs[cur]
            if nxt == start: break
            pts.append(nxt); cur = nxt
            if cur not in segs: break
        if len(pts) >= 3: out.append([(x - 1, y - 1) for x, y in pts])
    return out

def area(p):
    return 0.5 * sum(p[i][0] * p[(i+1) % len(p)][1] - p[(i+1) % len(p)][0] * p[i][1] for i in range(len(p)))

def rdp(p, eps):
    if len(p) < 4: return p
    def rec(a, b, keep):
        ax, ay = p[a]; bx, by = p[b]; dx, dy = bx - ax, by - ay; n = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / n
            if d > best: best, bi = d, i
        if best > eps:
            rec(a, bi, keep); keep.append(bi); rec(bi, b, keep)
    # split the ring at its two farthest-apart-ish points so RDP has anchors
    i0 = 0; i1 = max(range(len(p)), key=lambda i: (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2)
    sys.setrecursionlimit(100000)
    k1 = [i0]; rec(i0, i1, k1); k1.append(i1)
    q = p[i1:] + p[:1]; pp = p; p = q
    k2 = []; rec(0, len(q) - 1, k2)
    p = pp
    return [p[i] for i in k1] + [q[i] for i in k2]

def main():
    src, dst, o = args()
    im = Image.open(src).convert('L')
    if o['blur'] > 0: im = im.filter(ImageFilter.GaussianBlur(o['blur']))
    f = np.asarray(im, dtype=np.float32) / 255.0
    cs = [c for c in contours(f, o['iso']) if abs(area(c)) >= o['min-area']]
    cs = [rdp(c, o['eps']) for c in cs]
    cs = [c for c in cs if len(c) >= 3]
    if not cs: sys.exit('no paint found in the matte')
    xs = [x for c in cs for x, _ in c]; ys = [y for c in cs for _, y in c]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    s = o['height'] / (y1 - y0)
    W, H = (x1 - x0) * s, o['height']
    def fmt(v):
        t = ('%.1f' % v).rstrip('0').rstrip('.')
        return '0' if t in ('-0', '') else t
    d = []
    for c in sorted(cs, key=lambda c: -abs(area(c))):
        q = [(round((x - x0) * s, 1), round((y - y0) * s, 1)) for x, y in c]
        q = [q[i] for i in range(len(q)) if q[i] != q[i-1]]
        if len(q) < 3: continue
        part = 'M%s %s' % (fmt(q[0][0]), fmt(q[0][1])); last = 'M'
        for (ax, ay), (bx, by) in zip(q, q[1:]):
            dx, dy = round(bx - ax, 1), round(by - ay, 1)
            tok = fmt(dx) + (fmt(dy) if dy < 0 else ' ' + fmt(dy))
            part += ('l' if last != 'l' else (' ' if dx >= 0 else '')) + tok; last = 'l'
        d.append(part + 'z')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s"><path fill="currentColor" fill-rule="evenodd" d="%s"/></svg>\n' % (fmt(W), fmt(H), ''.join(d))
    open(dst, 'w').write(svg)
    print('%d bytes, viewBox 0 0 %s %s, %d contours, %d points' % (len(svg), fmt(W), fmt(H), len(d), sum(len(c) for c in cs)))

main()
