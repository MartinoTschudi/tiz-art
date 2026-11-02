"""Build "TIZ Mano": Nanum Brush Script (latin subset) + the glyphs Italian needs.

The latin subset has no accented vowels, guillemets, ellipsis or dashes, so titles such as
"Gioventù" or "…e fuori piove" would fall back to another font. This adds them as outlines made
from the font's own glyphs (grave accent, "<", ".", "-"). OFL 1.1: "Nanum" is a Reserved Font Name,
so the modified font is renamed.

Usage: python3 scripts/dev/make-mano-font.py <nanum-brush-script-latin.woff2> src/assets/fonts/tiz-mano.woff2
(needs fontTools + brotli; the input is the latin file Google Fonts serves for Nanum Brush Script)
"""
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

src, out = sys.argv[1:3]
font = TTFont(src)
cmap = font.getBestCmap()
glyf, hmtx = font['glyf'], font['hmtx']
glyph_set = font.getGlyphSet()


def name_of(ch):
    return cmap[ord(ch)]


def bbox(gname):
    g = glyf[gname]
    g.recalcBounds(glyf)
    return g.xMin, g.yMin, g.xMax, g.yMax


def build(new_name, codepoint, parts, advance):
    """parts: [(glyph name, (xx, xy, yx, yy, dx, dy))]; mirrored parts get their contours reversed."""
    pen = TTGlyphPen(glyph_set)
    for gname, (xx, xy, yx, yy, dx, dy) in parts:
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[gname].draw(rec)
        target = TransformPen(pen, (xx, xy, yx, yy, dx, dy))
        if xx * yy - xy * yx < 0:
            target = ReverseContourPen(target)
        rec.replay(target)
    glyph = pen.glyph()
    glyf[new_name] = glyph
    hmtx[new_name] = (advance, 0)
    order = font.getGlyphOrder()
    if new_name not in order:
        order.append(new_name)
        font.setGlyphOrder(order)
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap[codepoint] = new_name


GRAVE = name_of('`')
gx0, gy0, gx1, gy1 = bbox(GRAVE)
ACCENT_SCALE = 0.72
GAP = 34


def accented(base_ch, codepoint, acute):
    base = name_of(base_ch)
    bx0, by0, bx1, by1 = bbox(base)
    s = ACCENT_SCALE
    w = (gx1 - gx0) * s
    # accent bottom sits GAP above the base's top; centred on the base's ink, nudged right like a pen stroke
    dy = by1 + GAP - gy0 * s
    centre = (bx0 + bx1) / 2 + (bx1 - bx0) * 0.06
    if acute:
        # mirror the grave: x → -x, then move so the mirrored ink is centred
        dx = centre + w / 2 + gx0 * s
        transform = (-s, 0, 0, s, dx, dy)
    else:
        dx = centre - w / 2 - gx0 * s
        transform = (s, 0, 0, s, dx, dy)
    build(f'{base}{"acute" if acute else "grave"}', codepoint, [(base, (1, 0, 0, 1, 0, 0)), (GRAVE, transform)],
          hmtx[base][0])


for ch, cp in zip('aeiou', (0xE0, 0xE8, 0xEC, 0xF2, 0xF9)):
    accented(ch, cp, acute=False)
for ch, cp in zip('AEIOU', (0xC0, 0xC8, 0xCC, 0xD2, 0xD9)):
    accented(ch, cp, acute=False)
for ch, cp in zip('aeiouAEIOU', (0xE1, 0xE9, 0xED, 0xF3, 0xFA, 0xC1, 0xC9, 0xCD, 0xD3, 0xDA)):
    accented(ch, cp, acute=True)

# … = three of the font's own periods, a little tighter than "..." and lifted onto the baseline
# (the font's own period hangs well below it, which reads as "_e fuori piove" at the start of a title)
period = name_of('.')
px0, py0_, px1, _ = bbox(period)
step = (px1 - px0) + 38
lift = -py0_ - 6
build('ellipsis', 0x2026, [(period, (1, 0, 0, 1, i * step, lift)) for i in range(3)],
      int(px0 * 2 + step * 2 + (px1 - px0)))

# « » ‹ › = the font's "<" / ">" scaled down to x-height
less, greater = name_of('<'), name_of('>')
lx0, ly0, lx1, ly1 = bbox(less)
q = 0.5
qh = (ly1 - ly0) * q
dy_q = 40 - ly0 * q  # bottom of the chevron 40 units above the baseline
qw = (lx1 - lx0) * q
single_adv = int(qw + 70)
double_adv = int(qw * 1.62 + 70)
for gname, cp_single, cp_double in ((less, 0x2039, 0xAB), (greater, 0x203A, 0xBB)):
    gx = bbox(gname)[0]
    base_dx = 35 - gx * q
    build(f'{gname}.single', cp_single, [(gname, (q, 0, 0, q, base_dx, dy_q))], single_adv)
    build(f'{gname}.double', cp_double,
          [(gname, (q, 0, 0, q, base_dx, dy_q)), (gname, (q, 0, 0, q, base_dx + qw * 0.62, dy_q))], double_adv)

# – — = the hyphen, stretched
hyphen = name_of('-')
hx0, _, hx1, _ = bbox(hyphen)
for gname, cp, stretch in (('endash', 0x2013, 1.0), ('emdash', 0x2014, 1.55)):
    build(gname, cp, [(hyphen, (stretch, 0, 0, 1, -hx0 * stretch + 40, 0))], int((hx1 - hx0) * stretch + 80))

# · (middle dot) = period raised to x-height middle
_, py0, _, py1 = bbox(period)
build('periodcentered', 0xB7, [(period, (1, 0, 0, 1, 0, 150 - (py0 + py1) / 2))], hmtx[period][0])

# Rename (OFL Reserved Font Name) and record the change.
FAMILY = 'TIZ Mano'
for rec in font['name'].names:
    if rec.nameID in (1, 4, 16, 18, 21):
        rec.string = FAMILY
    elif rec.nameID == 3:
        rec.string = '1.100;TIZ;TIZMano'
    elif rec.nameID == 6:
        rec.string = 'TIZMano-Regular'
    elif rec.nameID == 0:
        rec.string = str(rec) + ' Modified for tiz-art.ch: accented vowels, guillemets, ellipsis and dashes added.'
font['maxp'].numGlyphs = len(font.getGlyphOrder())
font.flavor = 'woff2'
font.save(out)
check = TTFont(out).getBestCmap()
need = 'àèéìòùÀÈÉÌÒÙáíóú«»‹›…–—·’×'
print('missing after patch:', ''.join(c for c in need if ord(c) not in check) or 'none', '| glyphs:', len(check))
