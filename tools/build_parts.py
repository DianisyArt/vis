# Заплатки открывания фасадов → плитки для движка (шаг 3 VIS_ENGINE_PLAN.md).
# Каждая заплатка (цвет WebP RGBA + глубина PNG RG, координаты в эквиректе 8K) режется на куски T×T px
# с полями PAD px (чтобы на стыках не было швов от фильтрации); пустые куски (альфа = 0) выбрасываются.
# Для попадания пальцем и диапазона глубины — уменьшенные копии: маска 1/4 (LA PNG), глубина 1/2 (RGB PNG).
# Запуск: python3 build_parts.py SRC_PARTS_DIR OUT_DIR [точки]
import sys, os, json
import numpy as np
from PIL import Image

T, PAD = 512, 2
src, out = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
os.makedirs(out, exist_ok=True)
M = json.load(open(os.path.join(src, 'parts.json')))
res = {}
tot_in = tot_out = 0
for pk, parts in M['parts'].items():
    if only and pk not in only:
        continue
    res[pk] = {}
    for gid, info in parts.items():
        X0, Y0, X1, Y1 = info['px']
        col = np.asarray(Image.open(os.path.join(src, info['file'])).convert('RGBA'))
        dep = np.asarray(Image.open(os.path.join(src, info['depth'])).convert('RGB'))
        H, W = col.shape[:2]
        tot_in += os.path.getsize(os.path.join(src, info['file'])) + os.path.getsize(os.path.join(src, info['depth']))
        tiles, nb = [], 0
        for ty in range(0, H, T):
            for tx in range(0, W, T):
                cx1, cy1 = min(W, tx + T), min(H, ty + T)
                if col[ty:cy1, tx:cx1, 3].max() == 0:
                    continue
                ys = np.clip(np.arange(ty - PAD, cy1 + PAD), 0, H - 1)
                xs = np.clip(np.arange(tx - PAD, cx1 + PAD), 0, W - 1)
                i = len(tiles)
                fc, fd = f'{pk}_{gid}_{i}.webp', f'{pk}_{gid}_{i}_d.png'
                Image.fromarray(col[np.ix_(ys, xs)], 'RGBA').save(os.path.join(out, fc), quality=92, method=6, exact=True)
                Image.fromarray(dep[np.ix_(ys, xs)], 'RGB').save(os.path.join(out, fd), optimize=True)
                b = os.path.getsize(os.path.join(out, fc)) + os.path.getsize(os.path.join(out, fd))
                nb += b
                tiles.append([X0 + tx, Y0 + ty, X0 + cx1, Y0 + cy1, b])
        # уменьшенные копии для чтения на основном потоке (как раньше читались s=0.25 / s=0.5 ближайшим соседом)
        aw, ah = max(1, round(W * 0.25)), max(1, round(H * 0.25))
        a = Image.fromarray(col[..., 3], 'L').resize((aw, ah), Image.NEAREST)
        la = Image.merge('LA', (Image.new('L', (aw, ah), 0), a))
        fa = f'{pk}_{gid}_a.png'; la.save(os.path.join(out, fa), optimize=True)
        dw, dh = max(1, round(W * 0.5)), max(1, round(H * 0.5))
        fl = f'{pk}_{gid}_dl.png'; Image.fromarray(dep, 'RGB').resize((dw, dh), Image.NEAREST).save(os.path.join(out, fl), optimize=True)
        nb += os.path.getsize(os.path.join(out, fa)) + os.path.getsize(os.path.join(out, fl))
        rec = {'px': info['px'], 'tiles': tiles, 'a': fa, 'dl': fl}
        if info.get('pick'):
            p = info['pick']
            Image.open(os.path.join(src, p)).save(os.path.join(out, p), optimize=True)
            rec['pick'] = p; nb += os.path.getsize(os.path.join(out, p))
            tot_in += os.path.getsize(os.path.join(src, p))
        rec['bytes'] = nb; tot_out += nb
        res[pk][gid] = rec
    ids = f'{pk}_ids.png'
    if os.path.exists(os.path.join(src, ids)):
        Image.open(os.path.join(src, ids)).save(os.path.join(out, ids), optimize=True)
    print(pk, len(res[pk]), 'частей,', sum(len(v['tiles']) for v in res[pk].values()), 'плиток', flush=True)
outm = {k: v for k, v in M.items() if k != 'parts'}
outm['parts'] = res; outm['tile'] = T; outm['pad'] = PAD
old = {}
if only and os.path.exists(os.path.join(out, 'parts.json')):
    old = json.load(open(os.path.join(out, 'parts.json'))).get('parts', {})
    old.update(res); outm['parts'] = old
json.dump(outm, open(os.path.join(out, 'parts.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('было %.1f МБ, стало %.1f МБ' % (tot_in / 1e6, tot_out / 1e6))
