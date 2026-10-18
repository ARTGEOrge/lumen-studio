# Validates fonts exported by Lumen Type with fontTools: checksums, every table decompiles, glyf bounding boxes,
# hmtx LSBs and maxp statistics match fontTools' own recalculation, GPOS kerning, names.
# Run: python -I type/tests/validate.py <folder with exported fonts>
import sys, os, io, struct
from fontTools.ttLib import TTFont
from fontTools.ttLib.sfnt import calcChecksum

folder = sys.argv[1]
fails = 0; checks = 0
def ok(cond, msg):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1; print('FAIL', msg)

for fn in sorted(os.listdir(folder)):
    if not fn.lower().endswith(('.ttf', '.otf', '.woff')): continue   # WOFF2 needs brotli (not installed); fontkit + Chromium cover it
    p = os.path.join(folder, fn)
    try:
        f = TTFont(p, checkChecksums=2)          # raises on any table checksum mismatch
    except Exception as e:
        ok(False, f'{fn}: open/checksum {e}'); continue
    for tag in f.keys():
        if tag == 'GlyphOrder': continue
        try: f[tag]
        except Exception as e: ok(False, f'{fn}: decompile {tag}: {e}')
    if not f.flavor:
        data = open(p, 'rb').read()
        # whole-font checksum: head.checkSumAdjustment makes the total 0xB1B0AFBA
        hoff = None
        n = struct.unpack('>H', data[4:6])[0]
        for i in range(n):
            tag, cs, off, ln = struct.unpack('>4sLLL', data[12 + 16 * i: 28 + 16 * i])
            if tag == b'head': hoff = off
        tmp = bytearray(data); tmp[hoff + 8:hoff + 12] = b'\0\0\0\0'
        ok((0xB1B0AFBA - calcChecksum(bytes(tmp))) & 0xFFFFFFFF == f['head'].checkSumAdjustment, f'{fn}: checkSumAdjustment')
    gs = f.getGlyphOrder()
    if 'glyf' in f:
        glyf = f['glyf']; bad = 0; badl = 0
        for g in gs:
            gl = glyf[g]
            if gl.numberOfContours == 0: continue
            old = (gl.xMin, gl.yMin, gl.xMax, gl.yMax)
            gl.recalcBounds(glyf)
            if (gl.xMin, gl.yMin, gl.xMax, gl.yMax) != old: bad += 1
            if f['hmtx'][g][1] != gl.xMin: badl += 1
        ok(bad == 0, f'{fn}: {bad} glyf bboxes differ from recalculation')
        ok(badl == 0, f'{fn}: {badl} hmtx LSBs differ from xMin')
        m = f['maxp']; before = (m.maxPoints, m.maxContours, m.maxCompositePoints, m.maxCompositeContours, m.maxComponentElements, m.maxComponentDepth)
        m.recalc(f); after = (m.maxPoints, m.maxContours, m.maxCompositePoints, m.maxCompositeContours, m.maxComponentElements, m.maxComponentDepth)
        ok(before == after, f'{fn}: maxp {before} vs recalculated {after}')
    else:
        cff = f['CFF '].cff; td = cff.topDictIndex[0]
        ok(td.CharStrings.keys() is not None and len(td.CharStrings.keys()) == len(gs), f'{fn}: CFF charstrings count')
        ok(cff.fontNames[0] == f['name'].getDebugName(6), f'{fn}: CFF name == PostScript name')
    ok(f['maxp'].numGlyphs == len(gs) == f['hhea'].numberOfHMetrics, f'{fn}: glyph counts')
    ok(f['OS/2'].version == 4 and f['OS/2'].usWinAscent > 0, f'{fn}: OS/2 v4')
    names = {r.nameID: r.toUnicode() for r in f['name'].names}
    ok(all(k in names for k in (1, 2, 3, 4, 5, 6)), f'{fn}: required name IDs')
    cmap = f.getBestCmap(); ok(len(cmap) > 0 and 32 in cmap, f'{fn}: cmap')
    if 'GPOS' in f:
        g = f['GPOS'].table
        ok(any(fr.FeatureTag == 'kern' for fr in g.FeatureList.FeatureRecord), f'{fn}: GPOS kern feature')
    # recompile through fontTools to make sure it is structurally sound
    buf = io.BytesIO(); f.save(buf); ok(len(buf.getvalue()) > 0, f'{fn}: fontTools re-save')
    print(f'{fn}: {len(gs)} glyphs, tables {",".join(sorted(t for t in f.keys() if t != "GlyphOrder"))}')
print(f'fontTools validation: {checks - fails} passed, {fails} failed')
sys.exit(1 if fails else 0)
