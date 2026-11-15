# Липки: «Открыть всё» без взаимопроникновения. Для каждой мешающей пары (parts.json → conflicts) находим,
# на каком кадре анимации (t = k/30) надо остановить ограничиваемую группу, чтобы она не входила в соседку.
# blender -b Lipki_vis_v12.blend -P allopen_limits.py  →  allopen.json {gid: k}
import bpy, bmesh, json, sys, time
from mathutils.bvhtree import BVHTree
D = r"E:\Projects\Bazis\Render\Lipki"; sys.path.insert(0, D)
import l_mov
M = json.load(open(D + r"\pano8k\parts\parts.json", encoding="utf-8")); G = {g["id"]: g for g in M["groups"]}
MOVS = {o.name: o for o in bpy.data.objects if o.name.startswith("MOV ")}
for _e in MOVS.values():                       # внутренние с поводком едут с фасадом (как в анимации)
    for _c in (_e.get("couple") or "").split(","):
        if _c and _c in MOVS: MOVS[_c]["req"] = ""
BYMOV = {}
for o in bpy.data.objects:
    m = o.get("mov") or o.get("push_mov")
    if m and o.type == 'MESH' and not o.hide_render: BYMOV.setdefault(m, []).append(o)
def movs_of(g):
    s = {"MOV " + m for m in g["movs"]}
    for m in list(s):
        e = MOVS.get(m)
        for c in ((e.get("couple") or "").split(",") if e else []):
            if c: s.add(c)
    return s
def objs_of(g):
    out = []
    for m in movs_of(g): out += [o for o in BYMOV.get(m, []) if o.get("mpart") != "fixed"]
    return out
def bvh(objs, dg):
    bm = bmesh.new()
    for o in objs:
        ev = o.evaluated_get(dg); me = ev.to_mesh()
        tmp = bmesh.new(); tmp.from_mesh(me); tmp.transform(o.matrix_world)
        # сжатие на 1,5 мм к центру грани — касание по кромке не считаем
        for v in tmp.verts: v.co -= v.normal * 0.0015
        m2 = bpy.data.meshes.new("_t"); tmp.to_mesh(m2); bm.from_mesh(m2); bpy.data.meshes.remove(m2); tmp.free(); ev.to_mesh_clear()
    t = BVHTree.FromBMesh(bm); bm.free(); return t
KIND = lambda g: (MOVS.get("MOV " + g["movs"][0]) or {}).get("kind", "")
def limited(a, b):
    ga, gb = G[a], G[b]; ka, kb = KIND(ga), KIND(gb)
    # ящики не ограничиваем; AVENTOS (hf) и ПММ (flap) ограничиваем раньше дверей; две двери — вторую
    order = lambda k: {"drawer": 0, "door": 1, "hinge": 1, "flap": 2, "hf": 3}.get(k, 1)
    if order(ka) != order(kb): return (a, b) if order(ka) > order(kb) else (b, a)
    return (max(a, b), min(a, b))
def state(g, t, st):
    for r in g.get("req", []): st[r] = 1.0
    for m in g["movs"]: st[m] = max(st.get(m, 0), t)
pairs = set()
for a, bs in M["conflicts"].items():
    for b in bs: pairs.add(tuple(sorted((int(a), int(b)))))
LIM = {}; log = []
t0 = time.time()
# порядок и роли: сначала ПММ до острова, потом левая дверь мойки — до уже ограниченной ПММ (иначе ПММ не открывается вовсе)
ORDER = sorted(pairs, key=lambda p: (p == (20, 29), p))
ROLE = {(20, 29): (20, 29)}
for a, b in ORDER:
    L, O = ROLE.get((a, b)) or limited(a, b)
    best = 0
    tO = LIM.get(O, 30) / 30.0
    for k in range(29, 0, -1):
        st = {}; state(G[O], tO, st); state(G[L], k / 30.0, st)
        l_mov.pose(st); dg = bpy.context.evaluated_depsgraph_get(); bpy.context.view_layer.update()
        if not bvh(objs_of(G[L]), dg).overlap(bvh(objs_of(G[O]), dg)): best = k; break
    LIM[L] = min(LIM.get(L, 30), best)
    log.append([L, G[L]["movs"][0], O, G[O]["movs"][0], best])
l_mov.pose({})
json.dump({"limits": LIM, "log": log, "sec": round(time.time() - t0)}, open(D + r"\allopen.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
