# Собирает общий движок vis/engine/vis-engine.js (+ .css) из рабочей страницы full.html и данные Липок lipki/tour.json.
# Шаг 5 VIS_ENGINE_PLAN.md: код движка один на все проекты, проект — только данные (tour.json + points.json + parts + tiles + anim).
import re, json, sys, os
VIS = '/home/claude/vis'
src = open('/home/claude/engine/full.html').read()

css = src[src.index('<style>') + 7: src.index('</style>')]
body0 = src.index('</style>') + len('</style>')
markup = src[body0: src.index('<script type="importmap">')].strip()
js = src[src.index("import * as THREE from 'three';") + len("import * as THREE from 'three';"): src.rindex('</script>')]

# ---- данные проекта (Липки) из кода в tour.json ----
def grab(name, opener, closer):
    a = js.index('const ' + name + ' = ')
    b = js.index(closer, a) + len(closer)
    return a, b
a, b = grab('PTS', '[', '\n];')
pts_js = js[a:b]
a2, b2 = grab('LABEL', '{', '\n};')
lab_js = js[a2:b2]
pts = []
for m in re.finditer(r"\{ id: '(\w)', name: '([^']*)', p: \[([^\]]*)\], look: \[([^\]]*)\] \}", pts_js):
    pts.append({'id': m.group(1), 'name': m.group(2), 'p': [float(x) for x in m.group(3).split(',')], 'look': [float(x) for x in m.group(4).split(',')]})
labels = dict(re.findall(r"'([^']+)': '([^']+)'", lab_js[lab_js.index('{'):]))
h1 = re.search(r'<h1>(.*?)</h1><p>(.*?)</p>', markup)
tour = {
    'id': 'lipki', 'title': h1.group(1), 'pageTitle': 'Кухня Липки', 'desc': h1.group(2),
    'data': 'engine/', 'anim': '../pano/anim/',
    'points': pts, 'labels': labels, 'conflicts': {},
}
assert len(pts) == 8 and len(labels) > 40, (len(pts), len(labels))

# ---- код движка ----
s0 = js.index('// точки съёмки в координатах Blender')
s1 = js.index('\n};', js.index('const LABEL = ')) + 3
js = js[:s0] + """// данные проекта — из tour.json (точки съёмки в координатах Blender, м; подписи групп; ручные конфликты)
const PTS = TOUR.points.map(p => Object.assign({}, p));
const CONFLICT = TOUR.conflicts || {};
const LABEL = TOUR.labels || {};
""" + js[s1:]

R = [
    ("fetch('points.json')", "fetch(D + 'points.json')"),
    ("'tiles/' + pk + '/prev_'", "D + 'tiles/' + pk + '/prev_'"),
    (": 'tiles/' + pk + '/l'", ": D + 'tiles/' + pk + '/l'"),
    ("fetch('parts/parts.json')", "fetch(D + 'parts/parts.json')"),
    ("decodeAsset('parts/' + pk + '_ids.png'", "decodeAsset(D + 'parts/' + pk + '_ids.png'"),
    ("const pfx = (pk, gid) => 'parts/' + pk", "const pfx = (pk, gid) => D + 'parts/' + pk"),
    ("decodeAsset('parts/' + info.a", "decodeAsset(D + 'parts/' + info.a"),
    ("decodeAsset('parts/' + info.dl", "decodeAsset(D + 'parts/' + info.dl"),
    ("decodeAsset('parts/' + info.pick", "decodeAsset(D + 'parts/' + info.pick"),
    ("fetch('../pano/anim/allopen.json')", "fetch(AD + 'allopen.json')"),
    ("fetch('../pano/anim/anim.json')", "fetch(AD + 'anim.json')"),
    ("u === '../pano/anim/' + AREC[key].a.file", "u === AD + AREC[key].a.file"),
    ("const src = '../pano/anim/' + a.file", "const src = AD + a.file"),
    ("loadImg('../pano/anim/' + a.file)", "loadImg(AD + a.file)"),
    ("u.startsWith('parts/' + pt.id + '_')", "u.startsWith(D + 'parts/' + pt.id + '_')"),
    ("'lipki_fold'", "TOUR.id + '_fold'"),
    (": 'Загружаем кухню…';", ": (TOUR.bootText || 'Загружаем…');"),
    ("'lipki_floor'", "TOUR.id + '_floor'"),
    # манифест: пути файлов — от папки данных
    ("MAN = j; for (const pk in j.points) for (const [u, , mem] of j.points[pk].files) if (mem) { PACKM[u] = mem; for (const [n] of mem) PACKOF[n] = u; }",
     "MAN = j; for (const pk in j.points) for (const f of j.points[pk].files) { f[0] = D + f[0]; if (f[2]) { f[2] = f[2].map(([n, o, l]) => [D + n, o, l]); PACKM[f[0]] = f[2]; for (const [n] of f[2]) PACKOF[n] = f[0]; } }"),
]
for a_, b_ in R:
    assert js.count(a_) >= 1, a_
    js = js.replace(a_, b_)
assert "'parts/" not in js.replace("D + 'parts/", ''), [l for l in js.split('\n') if "'parts/" in l and "D + 'parts/" not in l]
assert '../pano/anim' not in js

# разметка: тексты проекта — из tour.json
markup = markup.replace(h1.group(0), '<h1 id="vTitle"></h1><p id="vDesc"></p>')
markup = markup.replace('Загружаем кухню…', '')

engine = """// vis-engine.js — свой движок 360°-туров (VIS_ENGINE_PLAN.md). Бесплатно: three.js (MIT).
// Проект — папка с index.html (5 строк), tour.json (точки, подписи, где данные) и данными: points.json + tiles/*.pack + parts/*.pack (build_cube.py,
// build_parts.py, build_manifest.py) + кадры анимации (anim.json, атласы; anim_cut.py).
// Использование: <script type="importmap">{"imports":{"three":"<engine>/three.module.js"}}</script>
//                <script type="module">import { start } from '<engine>/vis-engine.js'; start('tour.json');</script>
import * as THREE from 'three';
const HTML = %s;
export async function start(tourUrl) {
  const TOUR = await (await fetch(tourUrl || 'tour.json')).json();
  const D = TOUR.data || '', AD = D + (TOUR.anim || 'anim/');
  { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('vis-engine.css', import.meta.url).href; document.head.appendChild(l); }
  document.body.insertAdjacentHTML('afterbegin', HTML);
  document.title = TOUR.pageTitle || TOUR.title || '';
  document.getElementById('vTitle').textContent = TOUR.title || ''; document.getElementById('vDesc').textContent = TOUR.desc || '';
  document.getElementById('bootT').textContent = TOUR.bootText || 'Загружаем…';
%s
}
""" % (json.dumps(markup, ensure_ascii=False), js)

os.makedirs(VIS + '/engine', exist_ok=True)
open(VIS + '/engine/vis-engine.js', 'w').write(engine)
open(VIS + '/engine/vis-engine.css', 'w').write('/* vis-engine.css — оформление просмотрщика (общее для всех проектов) */\n' + css.strip() + '\n')
json.dump(tour, open(VIS + '/lipki/tour.json', 'w'), ensure_ascii=False, indent=1)
print('engine', len(engine), 'bytes; tour points', len(pts), 'labels', len(labels))
