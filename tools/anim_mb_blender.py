# Липки: кадры анимации со СМАЗОМ ДВИЖЕНИЯ (motion blur Cycles), 15.11.2026 — проба (пользователь: «дёргано»).
# Позы группы по кадрам k = 0..30 записываются ключами (LINEAR), кадр k рендерится с выдержкой 1 кадр по центру:
# смаз покрывает движение от k−0,5 до k+0,5. Выход anim4k_mb\. Остальное — как anim2k_v3.py.
# Липки: кадры анимации открывания для сайта (30 кадров, 2K), 14.11.2026
# blender -b Lipki_vis_v12.blend -P anim2k.py -- <точки a,b,..> [ид групп через запятую]
# Для каждой одиночной группы (не комбо) в каждой точке: кадры t = k/30, k = 0..29 (b_KK.jpg, кроп 2K по габариту движения)
# и служебные кадры ID+глубина (a_KK.png) через 3 кадра (0,3,…,27,29) — маска своих объектов.
import bpy, sys, os, json, math, time
from mathutils import Vector, Matrix
D = r"E:\Projects\Bazis\Render\Lipki"
sys.path.insert(0, D)
import l_mov
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PTS = argv[0].split(",") if argv else None
ONLYG = set(int(x) for x in argv[1].split(",")) if len(argv) > 1 and argv[1] else None
META = json.load(open(D + r"\pano8k\parts\parts.json", encoding="utf-8"))
G = META["groups"]; GBY = {g["id"]: g for g in G}
OUT = D + os.environ.get("MBOUT", "\\anim4k_mb\\"); os.makedirs(OUT, exist_ok=True)
RES = (4096, 2048); N = int(os.environ.get("ANIMN", "30")); AUXK = list(range(0, N, 3)) + [N - 1]
IDK = 3.0
sc = bpy.context.scene; R = sc.render; CY = sc.cycles; VS = sc.view_settings; IS = R.image_settings; VL = bpy.context.view_layer
KEEP = dict(vt=VS.view_transform, look=VS.look, exp=VS.exposure, comp=R.use_compositing, ft=R.film_transparent, fs=R.filter_size, dn=CY.use_denoising)
R.engine = 'CYCLES'; CY.device = 'GPU'
try:
    p = bpy.context.preferences.addons["cycles"].preferences; p.compute_device_type = "OPTIX"; p.get_devices()
    for dv in p.devices: dv.use = True
except Exception: pass
try: R.compositor_device = 'GPU' if os.environ.get('ANIM_GPUCOMP') else 'CPU'   # процессор загружен на 100 %, ГП на 22 % — компоузер и шумодав на ГП
except Exception: pass
R.use_persistent_data = True; R.resolution_x, R.resolution_y = RES; R.resolution_percentage = 100
cd = bpy.data.cameras.new("anim_pano"); cd.type = 'PANO'
try: cd.panorama_type = 'EQUIRECTANGULAR'
except Exception: cd.cycles.panorama_type = 'EQUIRECTANGULAR'
cd.clip_start = 0.02   # как у панорам (l_pano_r13): с 0,1 срезался близкий предмет — чёрный клин на потолке
cam = bpy.data.objects.new("anim_pano", cd); sc.collection.objects.link(cam); sc.camera = cam
cam.rotation_euler = (math.radians(90), 0, 0)
LOGF = OUT + "log.txt"
def log(s):
    with open(LOGF, "a", encoding="utf-8") as f: f.write(time.strftime("%H:%M:%S ") + s + "\n")
MOVS = {o.name: o for o in bpy.data.objects if o.name.startswith("MOV ")}
for _e in MOVS.values():    # 15.11: внутренний ящик с поводком появлялся только в конце (req: ждёт 85 % хода фасада) — в анимации едет с фасадом
    for _c in (_e.get("couple") or "").split(","):
        if _c and _c in MOVS: MOVS[_c]["req"] = ""
BYMOV = {}
for o in bpy.data.objects:
    for k in ("mov", "push_mov"):
        v = o.get(k)
        if v: BYMOV.setdefault(v, []).append(o)
def own_movs(g):
    s = ["MOV " + m for m in g["movs"]]
    if not g.get("inv"):
        for m in list(s):
            e = MOVS.get(m)
            if e:
                for c in (e.get("couple") or "").split(","):
                    if c: s.append(c)
    return s
def showcase_objs(key):
    piv = bpy.data.objects.get("ОТК витрина " + key)
    if not piv: return []
    out = [o for o in piv.children_recursive if o.type == 'MESH']
    out += [o for o in bpy.data.objects if o.type == 'MESH' and (o.get("air_piv") == piv.name or o.get("link_piv") == piv.name) and o not in out]
    return out
def own_objs(g):
    if g["movs"][0].startswith("Витрина"):
        return [o for m in g["movs"] for o in showcase_objs(m.split()[1])]
    out = []
    for m in own_movs(g): out += [o for o in BYMOV.get(m, []) if o.type == 'MESH']
    ms = set(own_movs(g))
    out += [o for o in bpy.data.objects if o.type == 'MESH' and o.get("on_open") in ms and o not in out]   # корзины ПММ, светящиеся ленты
    return out

# Ускорение: l_mov.pose перебирает все MOV и все объекты и ставит matrix_world всем — Cycles пересинхронизирует сцену.
# Подменяем bpy.data.objects для l_mov: видны только MOV группы (+пары, +req) и их свет/подсветка/толкатели.
_RB = l_mov.bpy
class _Objs:
    def __init__(s, keep): s.keep = keep; s.real = _RB.data.objects
    def __iter__(s):
        K = s.keep
        for o in s.real:
            n = o.name
            if n.startswith("MOV "):
                if n in K: yield o
                continue
            oo = o.get("on_open"); pm = o.get("push_mov")
            if oo is not None and oo not in K: continue
            if pm is not None and pm not in K: continue
            yield o
    def __getitem__(s, k): return s.real[k]
    def get(s, k, d=None): return s.real.get(k, d)
    def __len__(s): return len(s.real)
    def __getattr__(s, n): return getattr(s.real, n)
class _Data:
    def __init__(s, objs): s.objects = objs
    def __getattr__(s, n): return getattr(_RB.data, n)
class _Bpy:
    def __init__(s, objs): s.data = _Data(objs)
    def __getattr__(s, n): return getattr(_RB, n)
def keepset(g):
    S = {"MOV " + m for m in list(g["movs"]) + list(g.get("req", []))}
    while True:
        n0 = len(S)
        for e in MOVS.values():
            cs = [c for c in (e.get("couple") or "").split(",") if c]
            if e.name in S or any(c in S for c in cs): S.add(e.name); S.update(cs)
        for m in list(S):
            e = MOVS.get(m); r = e.get("req") if e else None
            if r: S.add(r)
        if len(S) == n0: return S
def restricted(g):
    l_mov.bpy = _Bpy(_Objs(keepset(g)))
def unrestricted():
    l_mov.bpy = _RB
PMM_B = None
# 15.11: корзины ПММ — push-объекты (push_mov = MOV ПММ, push_vec): в l_mov выезжают СРАЗУ на весь ход при любом открытии,
# поэтому в кадрах шли сквозь фасад. В анимации: дверца до t = 0,55, потом корзины выезжают плавно.
PMM_HAS = any(o.get("push_mov") == "MOV ПММ" and not o.get("push_rod") for o in bpy.data.objects)
def pmm_baskets(t):
    global PMM_B
    if PMM_B is None:
        PMM_B = [o for o in bpy.data.objects if o.get("push_mov") == "MOV ПММ" and not o.get("push_rod")]
    u = max(0.0, (t - 0.55) / 0.45); s_ = u * u * (3 - 2 * u)
    for o in PMM_B:
        o.matrix_world = Matrix.Translation(Vector(tuple(o["push_vec"])) * s_) @ l_mov.rest(o)
def pmm_reset():
    pass   # корзины ставит l_mov.pose (push) — сбрасывать не нужно
def pose_t(g, t):
    pmm_reset()
    st = {r: 1.0 for r in g.get("req", [])}
    if g.get("inv"):
        inner = g["movs"][0]; st[inner] = -1.0; l_mov.pose(st)
        e = MOVS["MOV " + inner]; n = Vector(tuple(e["n"])).normalized(); a = min(1.0 - t, e.get("lim", 1.0))
        if a > 0:
            for o in BYMOV.get("MOV " + inner, []):
                p = o.get("mpart"); k = 1.0 if p == "door" else 0.5 if p == "half" else 0.0   # 15.11: направляющие ехали вместе с ящиком
                if k: o.matrix_world = Matrix.Translation(n * e.get("dist", 0.45) * a * k) @ o.matrix_world
    else:
        for m in g["movs"]: st[m] = t
        if "ПММ" in g["movs"] and PMM_HAS: st["ПММ"] = min(1.0, t / 0.55)   # ускоренная дверца — только если есть выезжающие корзины (в Липках корзины неподвижны внутри)
        l_mov.pose(st)
        if "ПММ" in g["movs"]: pmm_baskets(t)
    bpy.context.view_layer.update()

E = [(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]
def rect(g, loc):
    us, vs = [], []
    objs = own_objs(g)
    for k in range(0, N + 1, 3):
        pose_t(g, k / N)
        for o in objs:
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            for a, b in E:
                for s in range(5):
                    p = bb[a].lerp(bb[b], s / 4) - loc; r = p.length or 1e-9
                    us.append(0.5 + math.atan2(p.x, p.y) / (2 * math.pi)); vs.append(0.5 - math.asin(max(-1, min(1, p.z / r))) / math.pi)
    if not us: return None
    u0, u1 = min(us) - 0.006, max(us) + 0.006; sh = 0.0
    if u1 - u0 > 0.6:   # через шов панорамы: пробуем камеру, повёрнутую на 180° (кадр со сдвигом u на 0,5)
        ws = [(u + 0.5) % 1.0 for u in us]
        if max(ws) - min(ws) < 0.6: u0, u1, sh = min(ws) - 0.006, max(ws) + 0.006, 0.5
        else: u0, u1 = 0.0, 1.0   # предмет вокруг камеры (под ней) — целиком по ширине
    return [max(0, u0), min(1, u1), max(0, min(vs) - 0.01), min(1, max(vs) + 0.01), sh]
# ---- смаз движения: ключи поз ----
def bake_keys(g):
    """Позы группы t = k/N (k = 0..N) → ключи location/rotation_quaternion/scale движущихся объектов (LINEAR)."""
    allo = [o for o in bpy.data.objects]
    pose_t(g, 0.0); w0 = {o.name: o.matrix_world.copy() for o in allo}
    movers = set()
    for kk in (N // 3, N // 2, 2 * N // 3, N):
        pose_t(g, kk / N)
        for o in allo:
            m = o.matrix_world
            if any(abs(m[i][j] - w0[o.name][i][j]) > 1e-6 for i in range(3) for j in range(4)): movers.add(o.name)
    mv = [bpy.data.objects[n] for n in movers]
    rec = {}
    for k in range(N + 1):
        pose_t(g, k / N)
        rec[k] = {o.name: o.matrix_world.copy() for o in mv}
    l_mov.pose({}); bpy.context.view_layer.update()
    saved = {}
    for o in mv:
        saved[o.name] = (o.rotation_mode, o.matrix_basis.copy())
        o.rotation_mode = 'QUATERNION'
    prevq = {}
    for k in range(N + 1):
        for o in mv:
            W = rec[k][o.name]
            if o.parent:
                pw = rec[k].get(o.parent.name, o.parent.matrix_world)
                B = (pw @ o.matrix_parent_inverse).inverted() @ W
            else: B = W
            l_, q_, s_ = B.decompose()
            if o.name in prevq: q_.make_compatible(prevq[o.name])
            prevq[o.name] = q_
            o.location = l_; o.rotation_quaternion = q_; o.scale = s_
            o.keyframe_insert("location", frame=k); o.keyframe_insert("rotation_quaternion", frame=k); o.keyframe_insert("scale", frame=k)
    for o in mv:
        ad = o.animation_data
        if ad and ad.action:
            try: fcs = ad.action.fcurves
            except Exception: fcs = [fc for l in ad.action.layers for st in l.strips for cb in st.channelbags for fc in cb.fcurves]
            for fc in fcs:
                for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
        try: o.cycles.use_deform_motion = False; o.cycles.motion_steps = 2
        except Exception: pass
    log("keys g%02d: %d объектов" % (g["id"], len(mv)))
    return saved
def unbake(saved):
    for n, (rm, mb) in saved.items():
        o = bpy.data.objects[n]; o.animation_data_clear(); o.rotation_mode = rm; o.matrix_basis = mb
    bpy.context.view_layer.update()
R.use_motion_blur = True; R.motion_blur_shutter = float(os.environ.get("MBSH", "1.0"))
try: R.motion_blur_position = 'CENTER'
except Exception: pass
def aux_mat():
    mat = bpy.data.materials.get("_AUX_ANIM") or bpy.data.materials.new("_AUX_ANIM"); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear(); Nn = nt.nodes.new; L = nt.links.new
    cdn = Nn("ShaderNodeCameraData"); oi = Nn("ShaderNodeObjectInfo")
    def m_(op, a, b=None):
        m = Nn("ShaderNodeMath"); m.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): m.inputs[i].default_value = v
            else: L(v, m.inputs[i])
        return m.outputs[0]
    q = m_('MULTIPLY', m_('MINIMUM', m_('DIVIDE', cdn.outputs["View Distance"], 8.0), 1.0), 255.0)
    fl = m_('FLOOR', q); r = m_('DIVIDE', fl, 255.0); g_ = m_('SUBTRACT', q, fl)
    cc = Nn("ShaderNodeCombineColor"); L(r, cc.inputs[0]); L(g_, cc.inputs[1]); L(m_('DIVIDE', m_('MULTIPLY', oi.outputs["Object Index"], IDK), 255.0), cc.inputs[2])
    em = Nn("ShaderNodeEmission"); out = Nn("ShaderNodeOutputMaterial"); L(cc.outputs[0], em.inputs["Color"]); L(em.outputs[0], out.inputs["Surface"])
    return mat
for o in bpy.data.objects:
    if o.type == 'MESH' and o.pass_index: o.pass_index = 0

# пространственные эффекты компоузера (свечение, зерно, резкость) выключены, как у панорам — добавляются при нарезке
CC = next((n for n in sc.compositing_node_group.nodes if getattr(n, "node_tree", None) and "Cinematic" in n.node_tree.name), None)
for k_ in ["Halation", "Bloom", "Soft Highlights", "Sharpness", "Film Grain Factor", "Vignette Strength", "Chromatic Aberration"]:
    if CC and k_ in CC.inputs: CC.inputs[k_].default_value = 0.0
# маска своих объектов — проход Object Index через File Output в том же рендере (отдельный служебный рендер с подменой материала давал 7 с/кадр)
VL.use_pass_object_index = True
NG = sc.compositing_node_group
RL = next(n for n in NG.nodes if n.bl_idname == "CompositorNodeRLayers")
FO = NG.nodes.new("CompositorNodeOutputFile")
FO.format.media_type = 'IMAGE'; FO.format.file_format = 'PNG'; FO.format.color_depth = '8'; FO.format.color_mode = 'BW'; FO.format.compression = 30
FO.save_as_render = False
FO.file_output_items.clear(); FO.file_output_items.new('FLOAT', "IndexOB")
MDIV = NG.nodes.new("ShaderNodeMath"); MDIV.operation = 'DIVIDE'; MDIV.inputs[1].default_value = 255.0
NG.links.new(RL.outputs["Object Index"], MDIV.inputs[0]); NG.links.new(MDIV.outputs[0], FO.inputs["IndexOB"])
for pk in (PTS or sorted(META["points"])):
    loc = Vector(META["points"][pk]); cam.location = loc
    singles = [GBY[int(k)] for k in META["parts"].get(pk, {}) if not GBY[int(k)].get("combo")]
    if ONLYG: singles = [g for g in singles if g["id"] in ONLYG]
    PD = OUT + pk + "\\"; os.makedirs(PD, exist_ok=True)
    mj = PD + "anim.json"; meta = json.load(open(mj, encoding="utf-8")) if os.path.exists(mj) else {}
    # 1) красивые кадры
    VS.view_transform = KEEP["vt"]; VS.look = KEEP["look"]; VS.exposure = KEEP["exp"]; R.use_compositing = KEEP["comp"]
    R.film_transparent = KEEP["ft"]; R.filter_size = KEEP["fs"]; CY.use_denoising = True; CY.samples = 32
    if os.environ.get('ANIM_GPUCOMP'):   # 14.11: с компоузером и шумодавом на ГП крупные кадры шли 100+ с вместо ~10 с (видеопамять) — не включать
        try: CY.denoiser = 'OPENIMAGEDENOISE'; CY.denoising_use_gpu = True
        except Exception: pass
    VL.material_override = None; IS.file_format = 'JPEG'; IS.quality = 92; IS.color_mode = 'RGB'
    todo = []
    t0 = time.time()
    for g in singles:
        restricted(g); rc = rect(g, loc); l_mov.pose({}); unrestricted()
        if not rc: continue
        meta[str(g["id"])] = {"rect": rc[:4], "shift": rc[4], "n": N}
        todo.append((g, rc))
    log("rects %s %d групп %.0f s" % (pk, len(todo), time.time() - t0))
    json.dump(meta, open(mj, "w", encoding="utf-8"), ensure_ascii=False)
    l_mov.pose({}); bpy.context.view_layer.update()
    for g, (u0, u1, v0, v1, sh) in todo:
        cam.rotation_euler = (math.radians(90), 0, math.pi if sh else 0.0)
        gd = PD + "g%02d\\" % g["id"]; os.makedirs(gd, exist_ok=True)
        R.use_border = True; R.use_crop_to_border = True
        R.border_min_x, R.border_max_x = u0, u1; R.border_min_y, R.border_max_y = 1 - v1, 1 - v0
        t0 = time.time(); restricted(g)
        own = own_objs(g)
        saved = bake_keys(g)
        for o in own: o.pass_index = 1
        FO.directory = gd
        for k in range(N):
            fn = gd + "b_%02d.jpg" % k
            if os.path.exists(fn) and os.path.exists(gd + "m_%02d_IndexOB.png" % k): continue
            FO.file_name = "m_%02d_" % k
            sc.frame_set(k); R.filepath = fn
            try: bpy.ops.render.render(write_still=True)
            except Exception as ex: log("ERR %s %d %d %r" % (pk, g["id"], k, ex))
        for o in own: o.pass_index = 0
        unbake(saved); sc.frame_set(0)
        l_mov.pose({}); unrestricted(); bpy.context.view_layer.update()
        log("beauty %s g%02d %.0f s" % (pk, g["id"], time.time() - t0))
    l_mov.pose({}); bpy.context.view_layer.update()
    log("point %s done" % pk)
log("ALL DONE")
