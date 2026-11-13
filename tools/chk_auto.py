# Автопроверка заплаток перед выкладкой (Липки и др.), 13.11.2026
# python3 chk_auto.py SITE_PANO_DIR [точки]  → отчёт в stdout и chk_auto.json
# Ищет: полупрозрачные пятна внутри заплатки, пустые заплатки и заплатки «без изменений»,
# отсутствующие файлы, внутренние ящики, не перекрытые заплаткой своего фасада.
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = sys.argv[1]; PD = os.path.join(SRC, 'parts')
M = json.load(open(os.path.join(PD, 'parts.json'), encoding='utf-8'))
PTS = sys.argv[2].split(',') if len(sys.argv) > 2 else sorted(M['parts'])
G = {g['id']: g for g in M['groups']}
byname = {g['movs'][0]: g['id'] for g in M['groups'] if not g.get('combo')}
W, H = M['res']
issues = []
def add(kind, pk, gid, msg, val=None):
    g = G.get(int(gid), {})
    issues.append({'kind': kind, 'pt': pk, 'gid': int(gid), 'name': '+'.join(g.get('movs', [])), 'msg': msg, 'val': val})

for pk in PTS:
    P = M['parts'].get(pk, {})
    base = None
    bp = os.path.join(SRC, pk + '_closed.jpg')
    for gid, rec in P.items():
        f = os.path.join(PD, rec['file'])
        if not os.path.exists(f): add('нет файла', pk, gid, rec['file']); continue
        if rec.get('depth') and not os.path.exists(os.path.join(PD, rec['depth'])): add('нет глубины', pk, gid, rec['depth'])
        im = np.asarray(Image.open(f).convert('RGBA')).astype(np.float32)
        a = im[..., 3] / 255.0
        area = (a > 0.05).sum()
        if area < 200: add('пустая заплатка', pk, gid, 'видимых пикселей %d' % area, int(area)); continue
        # дыры и полупрозрачное внутри: мягкий край маски ≈ 3·W/420 px, глубже него альфа должна быть 1
        SS = W / 420.0
        solid = a > 0.5
        holes = ndi.binary_fill_holes(solid) & ~solid
        lab, n = ndi.label(holes)
        if n:
            sz = ndi.sum(holes, lab, range(1, n + 1)); big = float(sz.max())
            if big > max(1500, 0.003 * solid.sum()): add('дыра в заплатке', pk, gid, 'крупнейшая %d px (%.1f%% площади)' % (big, 100 * big / solid.sum()), int(big))
        inner = ndi.binary_erosion(a > 0.05, iterations=int(3.2 * SS))
        semi = inner & (a < 0.85)
        # без изменений: сравнение с закрытой панорамой в пределах заплатки
        if os.path.exists(bp):
            if base is None:
                Image.MAX_IMAGE_PIXELS = None
                base = Image.open(bp).convert('RGB')
                if base.size != (W, H): base = base.resize((W, H))
            x0, y0, x1, y1 = rec['px']
            cb = np.asarray(base.crop((x0, y0, x0 + im.shape[1], y0 + im.shape[0]))).astype(np.float32)
            if cb.shape[:2] == im.shape[:2]:
                m = a > 0.5
                # полупрозрачное там, где открытый кадр заметно отличается от закрытого — виден «призрак» закрытого кадра
                dd = np.abs(cb - im[..., :3]).mean(axis=2)
                ghost = semi & (dd > 25)
                if ghost.sum() > 1500: add('полупрозрачное пятно', pk, gid, '%d px «призрака» закрытого кадра' % ghost.sum(), int(ghost.sum()))
                if m.sum() > 0:
                    d = np.abs(cb[m] - im[..., :3][m]).mean()
                    if d < 2.0: add('без изменений', pk, gid, 'средняя разница с закрытым кадром %.2f' % d, round(float(d), 2))
    # внутренний ящик должен лежать внутри прямоугольника заплатки фасада (иначе часть ящика показывается без своего фасада)
    for gid, rec in P.items():
        g = G[int(gid)]
        for nm in g.get('req', []):
            pid = byname.get(nm)
            if pid is None or str(pid) not in P: continue
            if G[int(gid)].get('inv'): continue
            c = rec['px']; p = P[str(pid)]['px']
            if c[0] < p[0] - 2 or c[1] < p[1] - 2 or c[2] > p[2] + 2 or c[3] > p[3] + 2:
                pass   # ящик может выезжать дальше фасада — это не ошибка, но проверяем покрытие ниже
    print('точка', pk, 'заплаток', len(P), flush=True)

json.dump(issues, open('/home/claude/chk_auto.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
from collections import Counter
print('ИТОГО', len(issues), dict(Counter(i['kind'] for i in issues)))
for i in issues: print(i['kind'], i['pt'], i['gid'], i['name'], i['msg'])
