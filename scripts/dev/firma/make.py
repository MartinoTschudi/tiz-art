#!/usr/bin/env python3
"""Rebuilds her signature, src/assets/firma.svg, from her paint:  python3 scripts/dev/firma/make.py

The drawing is a trace of the «TiZ» she painted with the edge of a palette knife in the bottom right
corner of «Il risveglio di Madre Natura» (src/content/opere/il-risveglio-di-madre-natura/01.jpg).
Needs Python 3 with Pillow and numpy (nothing else; not a dependency of the site). Steps:

  crop.py       the signature, cut from the photo and enlarged 6x                 -> work/crop6.png
  build.py      the paint matte, stroke by stroke (strokes.py: the five centre     -> work/raw.png
                lines; params.json: the tuned numbers), smoothed ALONG each stroke only
  clean.py      JPEG speckle out: detached islands, pinholes; long dry slits stay  -> work/matte.png
  paint2svg.py  the outline of the matte: one path, currentColor, ragged edges     -> src/assets/firma.svg

What is not as she painted it: the mark is turned about 2 degrees (the stem upright), thin strokes are a
little fuller (a lower level of her own paint, never a dilation), the loop where the Z's diagonal lands is
filled, specks around the strokes are gone. To change the drawing, change params.json (build.py and
clean.py explain the numbers) and run this again; then `node scripts/dev/site-icons.mjs` for the icons
and `npm test`. work/ is scratch (git-ignored).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'src', 'assets', 'firma.svg'))


def run(script, *args):
    subprocess.run([sys.executable, os.path.join(HERE, script), *args], cwd=HERE, check=True)


run('crop.py')
run('build.py', 'params.json', 'work/raw.png')
run('clean.py', 'work/raw.png', 'work/matte.png', 'params.json')
run('paint2svg.py', 'work/matte.png', OUT, '--eps', '1.2', '--min-area', '60')
