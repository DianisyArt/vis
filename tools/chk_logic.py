# Автопроверка логики просмотрщика: случайные цепочки открытий/закрытий в каждой точке, 13.11.2026
# python3 chk_logic.py [шагов_на_точку] [точки]   (сервер: python3 -m http.server 8765 в папке сайта)
import asyncio, json, random, sys
from playwright.async_api import async_playwright
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
ONLY = sys.argv[2].split(',') if len(sys.argv) > 2 else None
CHECK = """() => { const P = window.__pano, pk = P.cur.id, M = P.META, want = P.shownSet(pk), out = [];
  const byName = {}; M.groups.forEach(g => { if (!g.combo) byName[g.movs[0]] = g.id; });
  for (const id of P.opened) { const g = M.groups.find(x => x.id === id);
    if (g && !g.combo) (g.req || []).forEach(r => { if (!P.opened.has(byName[r])) out.push(['открыт без фасада', id]); }); }
  const vis = [];
  for (const [k, r] of Object.entries(P.patches)) { if (!r.mesh || !k.startsWith(pk + '_')) continue;
    const gid = +k.split('_')[1], op = r.mesh.material.opacity !== undefined ? r.mesh.material.opacity : (r.mesh.material.uniforms && r.mesh.material.uniforms.op ? r.mesh.material.uniforms.op.value : 1);
    if (r.mesh.visible && op > 0.02) { vis.push(gid); if (!want.has(gid)) out.push(['призрак (видна лишняя заплатка)', gid]); }
  }
  for (const gid of want) { if (!(M.parts[pk] || {})[gid]) continue; if (!vis.includes(gid)) out.push(['не показана открытая', gid]); }
  for (const a of vis) { const g = M.groups.find(x => x.id === a); if (g && g.combo) g.combo.forEach(m => { if (vis.includes(m)) out.push(['двойной показ (комбо и створка)', m]); }); }
  return { pk, vis, opened: [...P.opened], out }; }"""
async def main():
    random.seed(13)
    res = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 900, 'height': 700})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/index.html')
        for i in range(120):
            if 'off' in await pg.evaluate("document.getElementById('boot').className"): break
            await pg.wait_for_timeout(500)
        M = await pg.evaluate("window.__pano.META")
        names = M['names']; G = {g['id']: g for g in M['groups']}
        for pk in (ONLY or sorted(M['parts'])):
            P = M['parts'][pk]
            if not P: continue
            nch = await pg.evaluate("document.querySelectorAll('#pts .chip').length")
            for ci in range(nch):
                await pg.evaluate("i => document.querySelectorAll('#pts .chip')[i].click()", ci)
                await pg.wait_for_timeout(300)
                if await pg.evaluate("window.__pano.cur.id") == pk: break
            for i in range(120):
                if await pg.evaluate("window.__pano.cur.id") == pk: break
                await pg.wait_for_timeout(500)
            await pg.wait_for_timeout(3000)
            singles = [int(k) for k in P if not G[int(k)].get('combo')]
            for step in range(N):
                op = await pg.evaluate("[...window.__pano.opened]")
                gid = random.choice(singles)
                openit = (gid not in op) if random.random() < 0.75 else False
                if not openit and op and random.random() < 0.5: gid = random.choice(op)
                await pg.evaluate("([g,o]) => window.__pano.setGroup(g, o, true)", [gid, openit])
                await pg.wait_for_timeout(2600)
                r = await pg.evaluate(CHECK)
                for kind, g in r['out']:
                    res.append({'pt': pk, 'step': step, 'act': ('открыть ' if openit else 'закрыть ') + '+'.join(G[gid]['movs']),
                                'kind': kind, 'gid': g, 'name': '+'.join(G.get(g, {}).get('movs', [])), 'opened': r['opened']})
                if r['out']: await pg.screenshot(path='/tmp/logic_%s_%d.png' % (pk, step))
            await pg.evaluate("() => { for (const g of [...window.__pano.opened]) window.__pano.setGroup(g, false, true); }")
            await pg.wait_for_timeout(1500)
            print('точка', pk, 'проблем', sum(1 for x in res if x['pt'] == pk), flush=True)
        await b.close()
    json.dump({'issues': res, 'errors': errs}, open('/home/claude/chk_logic.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('ИТОГО', len(res), 'ошибок JS', len(errs))
    for x in res[:40]: print(x['pt'], x['step'], x['act'], '→', x['kind'], x['gid'], x['name'])
    for e in errs[:5]: print('JS', e)
asyncio.run(main())
