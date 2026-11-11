#!/usr/bin/env python3
"""clean.py <raw.png> <matte.png> [params.json]

Removes what is JPEG noise and not paint from the matte build.py made:
  islands  every detached piece of paint smaller than `island` px² goes (the three marks stay: T, i, Z);
  holes    a hole stays only if it is a long narrow dry slit (length >= `slit_len` px and at least
           `slit_el` times longer than wide), at most `slits` of them per stroke region; round pinholes
           and eyelets are filled. `fill` / `keep` = [[x, y], ...] force single holes (nearest centroid),
           `drop` = [[x, y], ...] removes single islands.
Prints every island and hole with its centre in matte pixels so they can be named in params.json.
"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1:3]
P = json.load(open(sys.argv[3])).get('clean', {}) if len(sys.argv) > 3 and sys.argv[3] != '-' else {}
C = dict(island=6000, slit_len=44, slit_el=3.2, slit_w=20, slits=3, fill=[], keep=[], drop=[], regions={}, quiet=False)
C.update(P)


def label(b):
    """4-connected components of a boolean picture, by runs. Returns (runs, stats): runs = [(y, x0, x1, id)],
    stats[id] = dict(area, cx, cy, x0, x1, y0, y1, length, width, border)."""
    H, W = b.shape
    parent = []
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    runs = []; prev = []
    for y in range(H):
        row = b[y]; e = np.flatnonzero(np.diff(np.concatenate([[0], row.view(np.int8), [0]])))
        cur = []
        j = 0
        for x0, x1 in zip(e[0::2].tolist(), e[1::2].tolist()):
            lab = -1
            while j < len(prev) and prev[j][1] <= x0: j += 1
            k = j
            while k < len(prev) and prev[k][0] < x1:
                r = find(prev[k][2])
                if lab < 0: lab = r
                elif r != lab: parent[r] = lab
                k += 1
            if lab < 0: lab = len(parent); parent.append(lab)
            cur.append((x0, x1, lab)); runs.append((y, x0, x1, lab))
        prev = cur
    acc = {}
    out = []
    for y, x0, x1, lab in runs:
        r = find(lab); out.append((y, x0, x1, r))
        n = x1 - x0; sx = n * (x0 + x1 - 1) / 2.0
        sxx = (x1 - 1) * x1 * (2 * x1 - 1) / 6.0 - (x0 - 1) * x0 * (2 * x0 - 1) / 6.0
        a = acc.setdefault(r, [0, 0, 0, 0, 0, 0, W, 0, H, 0, False])
        a[0] += n; a[1] += sx; a[2] += n * y; a[3] += sxx; a[4] += n * y * y; a[5] += sx * y
        a[6] = min(a[6], x0); a[7] = max(a[7], x1); a[8] = min(a[8], y); a[9] = max(a[9], y + 1)
        if x0 == 0 or x1 == W or y == 0 or y == H - 1: a[10] = True
    stats = {}
    for r, (n, sx, sy, sxx, syy, sxy, x0, x1, y0, y1, bd) in acc.items():
        cx, cy = sx / n, sy / n
        cov = np.array([[sxx / n - cx * cx + 1 / 12, sxy / n - cx * cy], [sxy / n - cx * cy, syy / n - cy * cy + 1 / 12]])
        ev = np.sqrt(np.maximum(np.linalg.eigvalsh(cov), 1e-9))
        stats[r] = dict(area=n, cx=cx, cy=cy, x0=x0, x1=x1, y0=y0, y1=y1, length=3.46 * ev[1], width=3.46 * ev[0], border=bd)
    return out, stats


def mask(runs, ids, shape):
    m = np.zeros(shape, bool)
    for y, x0, x1, r in runs:
        if r in ids: m[y, x0:x1] = True
    return m


def grow(m, px):
    im = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * px + 1)).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(im).astype(np.float32) / 255


def nearest(stats, pts, what):
    ids = set()
    for x, y in pts:
        r = min(stats, key=lambda r: (stats[r]['cx'] - x) ** 2 + (stats[r]['cy'] - y) ** 2)
        s = stats[r]
        assert (s['cx'] - x) ** 2 + (s['cy'] - y) ** 2 < 40 ** 2, ('no %s near' % what, x, y)
        ids.add(r)
    return ids


m = np.asarray(Image.open(src).convert('L')).astype(np.float32)
say = (lambda *a: None) if C['quiet'] else print
# islands
runs, st = label(m > 127)
drop = {r for r, s in st.items() if s['area'] < C['island']} | nearest(st, C['drop'], 'island')
for r, s in sorted(st.items(), key=lambda kv: -kv[1]['area']):
    say('island %7d px  at %4.0f,%4.0f  %s' % (s['area'], s['cx'], s['cy'], 'DROP' if r in drop else 'keep'))
m = m * (1 - grow(mask(runs, drop, m.shape), 5))
# faint paint that never reaches the iso level would still leave soft specks: clear what is far from kept paint
keepm = grow(mask(runs, set(st) - drop, m.shape), 9)
m = m * np.clip(keepm * 3, 0, 1)
# holes
runs, st = label(m <= 127)
holes = {r: s for r, s in st.items() if not s['border']}
forced_fill = nearest(holes, C['fill'], 'hole') if holes else set()
forced_keep = nearest(holes, C['keep'], 'hole') if holes else set()
def region(s):
    for name, (x0, y0, x1, y1) in C['regions'].items():
        if x0 <= s['cx'] < x1 and y0 <= s['cy'] < y1: return name
    return '-'
cand = {}
for r, s in holes.items():
    ok = s['length'] >= C['slit_len'] and s['length'] >= C['slit_el'] * s['width'] and s['width'] <= C['slit_w']
    if ok and r not in forced_fill: cand.setdefault(region(s), []).append(r)
keep = set(forced_keep)
for name, ids in cand.items():
    n = C['slits'] if not isinstance(C['slits'], dict) else C['slits'].get(name, C['slits'].get('-', 3))
    keep |= set(sorted(ids, key=lambda r: -holes[r]['length'])[:n])
keep -= forced_fill
for r, s in sorted(holes.items(), key=lambda kv: (region(kv[1]), -kv[1]['area'])):
    say('hole %-5s %6d px  at %4.0f,%4.0f  len %3.0f  wid %3.0f  %s' % (region(s), s['area'], s['cx'], s['cy'], s['length'], s['width'], 'keep' if r in keep else 'FILL'))
f = grow(mask(runs, set(holes) - keep, m.shape), 4)
m = np.maximum(m, 255 * f)
Image.fromarray(np.clip(m, 0, 255).astype(np.uint8)).save(dst)
print('clean: %d islands dropped, %d holes filled, %d slits kept' % (len(drop), len(holes) - len(keep), len(keep)))
