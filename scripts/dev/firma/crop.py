#!/usr/bin/env python3
"""crop.py  ->  work/crop6.png: her signature, cut from the photo of «Il risveglio di Madre Natura» and
enlarged 6x (Lanczos). build.py, strokes.py and params.json measure in the pixels of this picture.

The box is in the pixels of src/content/opere/il-risveglio-di-madre-natura/01.jpg as committed on
2026-11-11 (1726 x 2400). If the admin replaces that photo, the box (and probably the centre lines in
strokes.py) no longer fit: the drawing src/assets/firma.svg stays valid, only this rebuild does not.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO = os.path.join(HERE, '..', '..', '..', 'src', 'content', 'opere', 'il-risveglio-di-madre-natura', '01.jpg')
BOX = (1330, 2090, 1720, 2370)   # left, top, right, bottom
SCALE = 6

photo = Image.open(PHOTO).convert('RGB')
if photo.size != (1726, 2400):
    raise SystemExit('the photo is %d x %d, not 1726 x 2400: the signature is no longer at BOX' % photo.size)
crop = photo.crop(BOX)
os.makedirs(os.path.join(HERE, 'work'), exist_ok=True)
crop.resize((crop.width * SCALE, crop.height * SCALE), Image.LANCZOS).save(os.path.join(HERE, 'work', 'crop6.png'))
print('work/crop6.png  %d x %d' % (crop.width * SCALE, crop.height * SCALE))
