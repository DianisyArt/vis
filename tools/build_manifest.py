# Манифест движка points.json + пачки файлов.
# Мелкие файлы точки (плитки панорамы, плитки заплаток) склеиваются в пачки .pack: одна пачка плиток панорамы на точку
# и по пачке на каждую заплатку — вместо ~900 запросов на точку выходит ~130. Браузер режет пачку на файлы (Blob.slice).
# points.json: грани/уровни + по каждой точке список [url, байт, [[имя, смещение, длина], ...] | null] и общий вес.
# Запуск из папки движка (lipki/engine): python3 build_manifest.py [--keep]   (--keep — не удалять исходные мелкие файлы)
import json, os, sys
keep = '--keep' in sys.argv
info = json.load(open('tiles/d/info.json'))
P = json.load(open('parts/parts.json'))
A = json.load(open('../pano/anim/anim.json'))
out = {'tile': info['tile'], 'levels': info['levels'], 'faces': info['faces'], 'points': {}}
used = []
def pack(url, names):
    mem, off = [], 0
    with open(url, 'wb') as fo:
        for n in names:
            b = open(n, 'rb').read(); fo.write(b); mem.append([n, off, len(b)]); off += len(b); used.append(n)
    return [url, off, mem]
for pk in sorted(P['parts']):
    T = 'tiles/%s/' % pk
    tl = [T + 'prev_%s.jpg' % f for f in info['faces']]
    for li in range(len(info['levels'])):
        tl += sorted(T + 'l%d/' % li + x for x in os.listdir(T + 'l%d' % li) if x.endswith('.jpg'))
    files = [pack('tiles/%s.pack' % pk, tl)]
    files.append(['parts/%s_ids.png' % pk, os.path.getsize('parts/%s_ids.png' % pk), None])
    for gid, r in P['parts'][pk].items():
        nm = ['parts/' + r['a'], 'parts/' + r['dl']] + (['parts/' + r['pick']] if r.get('pick') else [])
        for i in range(len(r['tiles'])):
            nm += ['parts/%s_%s_%d.webp' % (pk, gid, i), 'parts/%s_%s_%d_d.png' % (pk, gid, i)]
        files.append(pack('parts/%s_%s.pack' % (pk, gid), nm))
    for gid, a in (A.get(pk) or {}).items():
        u = '../pano/anim/' + a['file']; files.append([u, os.path.getsize(u), None])
    out['points'][pk] = {'files': files, 'bytes': sum(f[1] for f in files)}
    print(pk, len(files), 'файлов, %.1f МБ' % (out['points'][pk]['bytes'] / 1048576))
json.dump(out, open('points.json', 'w'), ensure_ascii=False, separators=(',', ':'))
if not keep:
    for n in used: os.remove(n)
    for pk in P['parts']:
        for li in range(len(info['levels'])):
            d = 'tiles/%s/l%d' % (pk, li)
            if os.path.isdir(d) and not os.listdir(d): os.rmdir(d)
