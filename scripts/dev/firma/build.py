#!/usr/bin/env python3
"""build.py <params.json> [out.png]  ->  work/raw.png (white = her paint) from work/crop6.png

The photo is the 6x crop of the signature in «Il risveglio di Madre Natura» (work/crop6.png, 2340x1680).
Each of the five strokes is straightened into a STRIP along its centre line (strokes.py); in the strip, rows
run along the stroke and columns across it, so "smooth along the stroke only" is a 1-D gaussian down the rows:

  body     the red ratio (R-max(G,B))/(R+16), normalised between the stroke's peak and the ground beside it
           (`norm`, or measured along the stroke), then smoothed ALONG the stroke with a long sigma `sL` and
           a short one `sS` mixed by `wLT` (long knife runs + a few notches; mostly short at the ends, so
           the tips stay pointed) and only `cross` px across it;
  weight   `gainT`, a gain along the stroke on that body, clipped at 1: the outline moves out to a lower
           level of the photo's own red. Nothing is dilated, so a stroke can only get as wide as her paint;
  streaks  the cross-stroke high-pass of the luma, smoothed far along the stroke (`hpt`): ridges add paint,
           dry slits remove it, with weight `slit` at the stroke's edges (frayed dry-brush edges) and
           `slitc` in its core (kept low, so the core is solid at 34 px);
  ends     `rep` repeats a stroke's last free rows over the part that lies inside another stroke (the stem
           under the bar, the diagonal in the base) and `win` cuts it there; `env` is the band a stroke may
           use across (it keeps the bar off the smear under it, left of the stem).

The strips go back into the picture (maximum of the strokes) and the picture is levelled by `rot`.
clean.py then removes the islands and holes that are JPEG noise. Lengths are crop6 px (10.5 px = 1 SVG unit).
params.json overrides the numbers below; those it does not name are used as written here, so they are
part of the logo too.
"""
import sys, json
import numpy as np
from PIL import Image
from strokes import Stroke, POLY

HERE = __file__.rsplit('/', 1)[0] if '/' in __file__ else '.'
P = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] != '-' else {}   # '-' = starting values only
OUT = sys.argv[2] if len(sys.argv) > 2 else HERE + '/work/raw.png'


def ss(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t)


def g1(a, s, axis):
    """1-D gaussian along `axis`, edge-padded."""
    if s <= 0: return a
    r = int(max(1, round(s * 3))); k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); k /= k.sum()
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r); t = np.pad(a, pad, mode='edge'); o = np.zeros_like(a)
    n = a.shape[axis]
    for i, w in enumerate(k):
        sl = [slice(None)] * a.ndim; sl[axis] = slice(i, i + n); o += w * t[tuple(sl)]
    return o


def pw(t, knots):
    """piecewise-linear function of the arclength: knots = [[t, value], ...]"""
    k = np.array(knots, np.float64); return np.interp(t, k[:, 0], k[:, 1])


# per stroke (params.json overrides what it names; the rest is used as written)
D = {
    'bar': dict(core=34, rim=(70, 100), sL=40, sS=9, wL=0.6, gain=1.0, lift=0.0, lo=0.36, hi=0.56,
                hps=8, hpt=30, slit=[[0, 1.0], [1823, 1.0]], ridge=1.2, win=(0, 1823), rep=(0, 1823)),
    'stem': dict(core=26, rim=(70, 95), sL=60, sS=9, wL=0.75, gain=1.2, lift=0.12, lo=0.30, hi=0.50,
                 hps=8, hpt=40, slit=[[0, 0.3], [1131, 0.3]], ridge=0.8, win=(95, 1131), rep=(165, 1131)),
    'i': dict(core=34, rim=(85, 108), sL=50, sS=9, wL=0.75, gain=1.0, lift=0.10, lo=0.42, hi=0.62,
              hps=8, hpt=40, slit=[[0, 0.3], [880, 0.3]], ridge=0.8, win=(0, 880), rep=(0, 880)),
    'diag': dict(core=30, rim=(70, 95), sL=50, sS=9, wL=0.7, gain=1.2, lift=0.12, lo=0.34, hi=0.54,
                 hps=8, hpt=40, slit=[[0, 0.5], [891, 0.5]], ridge=1.0, win=(0, 815), rep=(0, 760)),
    'base': dict(core=24, rim=(60, 85), sL=50, sS=9, wL=0.7, gain=1.2, lift=0.15, lo=0.30, hi=0.50,
                 hps=8, hpt=40, slit=[[0, 0.3], [1003, 0.3]], ridge=1.0, win=(0, 1003), rep=(0, 1003)),
}
for k, v in P.get('strokes', {}).items(): D[k].update(v)
G = dict(cross=1.2, mind=0.22, rot=2.0, hpoff=25.0, hpclip=0.5)
G.update(P.get('global', {}))

a = np.asarray(Image.open(HERE + '/work/crop6.png').convert('RGB')).astype(np.float32)
R, Gc, B = a[..., 0], a[..., 1], a[..., 2]
H, W = R.shape
ratio = g1(g1((R - np.maximum(Gc, B)) / (R + 16), G['cross'], 0), G['cross'], 1)
luma = g1(g1(0.299 * R + 0.587 * Gc + 0.114 * B, 0.8, 0), 0.8, 1)

m = np.zeros((H, W), np.float32)
dbg = {}
for name in POLY:
    c = D[name]; s = Stroke(name); hw = s.hw
    r = s.strip(ratio).astype(np.float32); y = s.strip(luma).astype(np.float32)
    L = r.shape[0]; t = np.arange(L, dtype=np.float64); d = np.arange(-hw, hw + 1, dtype=np.float64)
    # a stroke that starts or ends inside another one: repeat its last free rows over that part
    r0, r1 = int(c['rep'][0]), int(min(L, c['rep'][1]))
    if r0 > 0: r[:r0] = r[r0:r0 + 12].mean(0); y[:r0] = y[r0:r0 + 12].mean(0)
    if r1 < L: r[r1:] = r[r1 - 12:r1].mean(0); y[r1:] = y[r1 - 12:r1].mean(0)
    # the stroke's own centre across the strip, slowly varying
    wgt = np.clip(g1(r, 30, 0) - 0.3, 0, None) ** 2 * (np.abs(d) < hw * 0.75)[None, :]
    cen = (wgt * d[None, :]).sum(1) / np.maximum(wgt.sum(1), 1e-6)
    cen = g1(cen, 40, 0)
    dc = d[None, :] - cen[:, None]
    # normalise between the peak in the core and the ground at the rim
    inner = np.abs(dc) < c['core']; rimm = (np.abs(dc) > c['rim'][0]) & (np.abs(dc) < c['rim'][1])
    rs = g1(r, 6, 0)
    pk = np.array([np.percentile(rs[i][inner[i]], 90) if inner[i].any() else np.nan for i in range(L)])
    bg = np.array([np.percentile(rs[i][rimm[i]], 40) if rimm[i].any() else np.nan for i in range(L)])
    pk = g1(pk, 40, 0); bg = g1(bg, 40, 0)
    if P.get('verbose'): print('      pk', np.round(pk[::60], 2), '\n      bg', np.round(bg[::60], 2))
    if 'norm' in c: bg = np.full(L, c['norm'][0]); pk = np.full(L, c['norm'][1])
    if 'bg' in c: bg = np.minimum(bg, c['bg'])
    if 'pkmin' in c: pk = np.maximum(pk, c['pkmin'])
    n = np.clip((r - bg[:, None]) / np.maximum(pk - bg, G['mind'])[:, None], 0, 1.15)
    pres = np.clip((pk - bg) / 0.3, 0, 1)                      # is there a stroke at all at this t
    # body: long runs along the stroke + a few notches
    wL = (pw(t, c['wLT']) if 'wLT' in c else np.full(L, c['wL']))[:, None]   # short smoothing at the ends keeps the tips
    body = wL * g1(n, c['sL'], 0) + (1 - wL) * g1(n, c['sS'], 0)
    body = g1(body, c.get('sx', 0), 1)
    if 'env' in c:   # allowed band across the stroke: [[t, dmin, dmax], ...]
        e = np.array(c['env'], np.float64)
        lo_ = np.interp(t, e[:, 0], e[:, 1])[:, None]; hi_ = np.interp(t, e[:, 0], e[:, 2])[:, None]
        body = body * ss(d[None, :] - lo_, 0, 24) * (1 - ss(d[None, :] - hi_, -24, 0))
    gain = pw(t, c['gainT']) if 'gainT' in c else c['gain']
    lift = (pw(t, c['liftT']) if 'liftT' in c else c['lift']) * pres    # additive lift in the core: tried, makes sausages; 0 in params.json
    v = body * (gain[:, None] if np.ndim(gain) else gain) + lift[:, None] * np.exp(-0.5 * (dc / (c['core'] * 0.9)) ** 2)
    v = np.minimum(v, c.get('vmax', 1.0))
    # streaks: cross-stroke high-pass of the luma, long along the stroke
    ym = g1(y, c['hps'], 1); hp = (y - ym) / (ym + G['hpoff']); hp = g1(hp, c['hpt'], 0)
    hc = np.clip(hp, -G['hpclip'], G['hpclip'])
    # slits: weight `slit` at the stroke's edges (frayed, dry-brush edges), `slitc` in its core (solid at small sizes)
    edge = ss(np.abs(dc), c['core'] * 0.45, c['core'] * 1.0)
    slit = pw(t, c['slit'])[:, None] * edge + pw(t, c.get('slitc', c['slit']))[:, None] * (1 - edge)
    v = v + c['ridge'] * np.maximum(hc, 0) * (body > 0.2) + slit * np.minimum(hc + c.get('slit0', 0.05), 0)
    if 'thrT' in c: v = v - pw(t, c['thrT'])[:, None]
    mt = ss(v, c['lo'], c['hi'])
    w0, w1 = c['win']
    mt = mt * ss(t, w0, w0 + 16)[:, None] * (1 - ss(t, w1 - 16, w1))[:, None]
    mt = mt * (1 - ss(np.abs(d), hw - 12, hw - 2))[None, :]
    dbg[name] = (r, n, v, mt, hp)
    if P.get('verbose'): print('      hp percentiles 1/5/50/95/99 inside:', np.round(np.percentile(hp[mt > 0.5], [1, 5, 50, 95, 99]), 3))
    m = np.maximum(m, s.back(mt.astype(np.float32), (H, W)))
    wid = mt.sum(1); on = wid > 5
    if P.get('verbose'): print('      width every 100 px:', np.round(wid[50::100] / 10.5, 1))
    print('%-5s L %4d  width px: mean %.0f  median %.0f  (~ %.1f units)' % (name, L, wid[on].mean(), np.median(wid[on]), np.median(wid[on]) / 10.5))

im = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).rotate(G['rot'], resample=Image.BICUBIC)
im.save(OUT)
if P.get('debug', False):
    for name, (r, n, v, mt, hp) in dbg.items():
        o = np.concatenate([np.clip(r / 0.8, 0, 1), np.clip(v / 1.3, 0, 1), np.clip(0.5 + hp * 2.5, 0, 1), mt], 1)
        Image.fromarray((o * 255).astype(np.uint8)).save(HERE + '/work/dbg_%s.png' % name)
