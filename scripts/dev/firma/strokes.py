"""Shared geometry for build.py: the five strokes of the signature as centre lines in the 6x crop
(work/crop6.png, 2340x1680), a straightened STRIP of the photo along each one (rows = arclength t,
columns = signed cross distance d) and the map back from the strip to the picture."""
import numpy as np

# centre lines in crop6 pixels, from the start of the stroke to its end
POLY = {
    'bar':  [(262, 344), (350, 353), (700, 392), (1200, 418), (1975, 500), (2075, 511)],
    'stem': [(737, 300), (735, 380), (725, 800), (695, 1340), (690, 1430)],
    'i':    [(984, 540), (985, 620), (990, 1000), (985, 1320), (983, 1420)],
    'diag': [(1808, 592), (1752, 675), (1560, 960), (1365, 1250), (1310, 1332)],
    'base': [(1080, 1311), (1180, 1300), (1500, 1265), (1950, 1280), (2080, 1284)],
}
HALF = {'bar': 110, 'stem': 100, 'i': 110, 'diag': 100, 'base': 90}   # strip half-width, px


def dense(poly, step=16.0):
    """Catmull-Rom through the points, resampled about every `step` px."""
    p = np.array(poly, np.float64)
    q = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(q) - 2):
        p0, p1, p2, p3 = q[i - 1], q[i], q[i + 1], q[i + 2]
        n = max(2, int(np.hypot(*(p2 - p1)) / step))
        for u in np.arange(n) / n:
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    out.append(p[-1])
    return np.array(out)


def bilinear(img, x, y):
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001); y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    if img.ndim == 3: fx = fx[..., None]; fy = fy[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


class Stroke:
    def __init__(self, name):
        self.name = name; self.hw = HALF[name]
        self.pts = dense(POLY[name])
        seg = np.diff(self.pts, axis=0); self.seglen = np.hypot(seg[:, 0], seg[:, 1])
        self.cum = np.concatenate([[0], np.cumsum(self.seglen)]); self.L = float(self.cum[-1])

    def strip(self, img):
        """Sample `img` (H,W[,C]) into the strip: shape (L, 2*hw+1[,C])."""
        t = np.arange(int(self.L)) + 0.5
        cx = np.interp(t, self.cum, self.pts[:, 0]); cy = np.interp(t, self.cum, self.pts[:, 1])
        tx = np.gradient(cx); ty = np.gradient(cy); n = np.hypot(tx, ty); tx /= n; ty /= n
        d = np.arange(-self.hw, self.hw + 1)
        # normal = tangent turned left (so d<0 is on the left of the direction of travel on screen... sign only)
        X = cx[:, None] + d[None, :] * (-ty[:, None]); Y = cy[:, None] + d[None, :] * (tx[:, None])
        return bilinear(img, X, Y)

    def back(self, strip, shape):
        """Paint the strip (L, 2*hw+1) back into a picture of `shape`; 0 outside the strip."""
        H, W = shape
        x0 = int(max(0, self.pts[:, 0].min() - self.hw - 2)); x1 = int(min(W, self.pts[:, 0].max() + self.hw + 3))
        y0 = int(max(0, self.pts[:, 1].min() - self.hw - 2)); y1 = int(min(H, self.pts[:, 1].max() + self.hw + 3))
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        best = np.full(xx.shape, 1e9, np.float32); T = np.zeros_like(best); D = np.zeros_like(best)
        for k in range(len(self.pts) - 1):
            ax, ay = self.pts[k]; bx, by = self.pts[k + 1]; dx, dy = bx - ax, by - ay; L = self.seglen[k]
            u = np.clip(((xx - ax) * dx + (yy - ay) * dy) / (L * L), 0, 1)
            px = xx - (ax + u * dx); py = yy - (ay + u * dy); dist = np.hypot(px, py)
            sgn = np.sign(px * (-dy) + py * dx)
            m = dist < best
            best = np.where(m, dist, best); T = np.where(m, self.cum[k] + u * L, T); D = np.where(m, sgn * dist, D)
        ok = (best <= self.hw) & (T > 0.5) & (T < self.L - 1.5)
        v = bilinear(strip, D + self.hw, T - 0.5)
        out = np.zeros(shape, np.float32)
        out[y0:y1, x0:x1] = np.where(ok, v, 0)
        return out
