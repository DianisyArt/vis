import asyncio, json, sys
from playwright.async_api import async_playwright
JS_AIM = """([u,v,f]) => { const a=(u-0.5)*2*Math.PI, lat=(0.5-v)*Math.PI;
 const dz=Math.sin(lat), dx=Math.cos(lat)*Math.sin(a), dy=Math.cos(lat)*Math.cos(a); const p=window.__pano.cur.p;
 window.__pano.aim(p[0]+dx, p[1]+dy, p[2]+dz, f); return window.__pano.cur.id; }"""
M=json.load(open('/home/claude/site/pano/parts/parts.json'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':900,'height':700})
        await pg.goto('http://localhost:8765/index.html')
        for i in range(120):
            if 'off' in await pg.evaluate("document.getElementById('boot').className"): break
            await pg.wait_for_timeout(500)
        for spec in sys.argv[1].split(','):
            pk, par, inv = spec.split(':'); par=int(par); inv=int(inv)
            ci = 'dghfecba'.index(pk)
            await pg.evaluate("i => document.querySelectorAll('#pts .chip')[i].click()", ci)
            for i in range(60):
                await pg.wait_for_timeout(500)
                if await pg.evaluate("window.__pano.cur.id") == pk: break
            await pg.wait_for_timeout(8000)
            r = M['parts'][pk][str(par)]['px']; u=(r[0]+r[2])/2/8192; v=(r[1]+r[3])/2/4096
            cid = await pg.evaluate(JS_AIM, [u, v, 40]); await pg.wait_for_timeout(1000)
            print(pk, cid, flush=True)
            await pg.evaluate("g => window.__pano.setGroup(g, true, true)", par); await pg.wait_for_timeout(4000)
            await pg.screenshot(path='/tmp/inv_%s_a.png'%pk)
            await pg.evaluate("g => window.__pano.setGroup(g, true, true)", inv); await pg.wait_for_timeout(4000)
            await pg.screenshot(path='/tmp/inv_%s_b.png'%pk)
            st = await pg.evaluate("() => { const P=window.__pano, pk=P.cur.id; return Object.entries(P.patches).filter(([k,r])=>k.startsWith(pk+'_')&&r.mesh&&r.mesh.visible).map(([k,r])=>[k,r.mesh.renderOrder,r.mesh.material.uniforms?r.mesh.material.uniforms.zb.value:null,r.mesh.userData.inv,r.mesh.material.opacity]); }")
            print(st, flush=True)
            await pg.evaluate("() => { for (const g of [...window.__pano.opened]) window.__pano.setGroup(g, false, true); }"); await pg.wait_for_timeout(1500)
        await b.close()
asyncio.run(main())
