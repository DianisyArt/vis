# Липки: нарезка (маски — проход Object Index m_KK_IndexOB.png, свои объекты = 1)
# Липки: нарезка кадров анимации (2K) для сайта, 14.11.2026
# python3 anim_cut.py SRC_ANIM_DIR(anim2k с подпапками точек) OUT_SITE_PANO_DIR [точки]
# На выходе: OUT/anim/<pk>/<gid>.webp — атлас 5 столбцов из кадров 1..29 ( RGBA: альфа = свой объект в этом кадре ∪ его положение в кадре 0, мягкий край)
#            OUT/anim/anim.json: {pk: {gid: {"px": [X0,Y0,X1,Y1] в пикселях 2K, "n": 29, "cols": 5, "cell": [w,h], "file"}}}
import sys, os, json, glob, numpy as np
from PIL import Image
from scipy import ndimage
SRC, OUT = sys.argv[1:3]
PTS = sys.argv[3].split(",") if len(sys.argv) > 3 else sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
W = int(os.environ.get('ANIMRES', '2048')); H = W // 2; IDK = 3.0; N = 30
AO = os.path.join(OUT, "anim"); os.makedirs(AO, exist_ok=True)
JF = os.path.join(AO, "anim.json")
J = json.load(open(JF)) if os.path.exists(JF) else {}
GRAIN = np.random.default_rng(5).normal(0, 0.006, (H, W, 1)).astype(np.float32)
SIG = W / 300.0
def glow(a):
    lum = a.mean(axis=2, keepdims=True); hi = np.clip((lum - 0.82) / 0.18, 0, 1) * a
    return np.stack([ndimage.gaussian_filter(hi[..., i], SIG) for i in range(3)], -1)
def finish(a, X0, Y0):
    b = np.stack([ndimage.gaussian_filter(a[..., i], 1.0) for i in range(3)], -1)
    a = np.clip(a + 0.35 * (a - b), 0, 1)
    a = 1 - (1 - a) * (1 - glow(a) * 0.22)
    lum = a.mean(axis=2, keepdims=True)
    return np.clip(a + GRAIN[Y0:Y0 + a.shape[0], X0:X0 + a.shape[1]] * (0.6 + 0.4 * (1 - lum)), 0, 1)
for pk in PTS:
    pd = os.path.join(SRC, pk)
    mj = os.path.join(pd, "anim.json")
    if not os.path.exists(mj): print("нет anim.json", pk); continue
    meta = json.load(open(mj, encoding="utf-8"))
    od = os.path.join(AO, pk); os.makedirs(od, exist_ok=True)
    J.setdefault(pk, {})
    for gid, m in meta.items():
        gd = os.path.join(pd, "g%02d" % int(gid))
        bfs = [os.path.join(gd, "b_%02d.jpg" % k) for k in range(N)]
        if not all(os.path.exists(f) for f in bfs): print("не все кадры", pk, gid); continue
        u0, u1, v0, v1 = m["rect"]
        X0, Y0 = int(round(u0 * W)), int(round(v0 * H))
        mfs = [os.path.join(gd, "m_%02d_IndexOB.png" % k) for k in range(N)]
        if not all(os.path.exists(f) for f in mfs): print("нет масок", pk, gid); continue
        def own_at(k): return np.asarray(Image.open(mfs[k]).convert("L")) > 0
        m0 = own_at(0)
        frames = []; masks = []
        for k in range(1, N):
            im = np.asarray(Image.open(bfs[k]).convert("RGB")).astype(np.float32) / 255
            mk = own_at(k) | m0
            if os.environ.get('MBMASK'):   # кадры со смазом движения (anim_mb.py): смаз тянется к соседним положениям
                mk = mk | own_at(k - 1) | (own_at(k + 1) if k + 1 < N else mk)
            if mk.shape != im.shape[:2]:
                h_, w_ = min(mk.shape[0], im.shape[0]), min(mk.shape[1], im.shape[1]); mk2 = np.zeros(im.shape[:2], bool); mk2[:h_, :w_] = mk[:h_, :w_]; mk = mk2
            mk = ndimage.binary_dilation(mk, iterations=2 * W // 2048)
            al = np.clip(ndimage.gaussian_filter(mk.astype(np.float32), 1.2 * W / 2048) * 1.4, 0, 1)
            frames.append(finish(im, X0, Y0)); masks.append(al)
        U = np.zeros_like(masks[0], bool)
        for al in masks: U |= al > 0.01
        if U.sum() < 30: print("пусто", pk, gid); continue
        ys, xs = np.nonzero(U); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        cw0, ch0 = int(x1 - x0), int(y1 - y0)
        sc = min(1.0, (14e6 / (cw0 * ch0 * (N - 1))) ** 0.5)       # атлас ≤ ~14 Мпикс (iOS, лимит WebP 16383)
        cw, ch = max(1, int(cw0 * sc)), max(1, int(ch0 * sc))
        COLS = max(1, min(5, 16000 // cw)); ROWS = (N - 1 + COLS - 1) // COLS
        while ROWS * ch > 16000:
            sc *= 0.9; cw, ch = max(1, int(cw0 * sc)), max(1, int(ch0 * sc)); COLS = max(1, min(5, 16000 // cw)); ROWS = (N - 1 + COLS - 1) // COLS
        AT = np.zeros((ch * ROWS, cw * COLS, 4), np.float32)
        for k, (fr, al) in enumerate(zip(frames, masks)):
            r_, c_ = divmod(k, COLS)
            cell = np.dstack([fr[y0:y1, x0:x1], al[y0:y1, x0:x1, None]])
            if sc < 1: cell = np.dstack([np.asarray(Image.fromarray((cell[..., i] * 255).astype(np.uint8)).resize((cw, ch), Image.LANCZOS), np.float32) / 255 for i in range(4)])
            AT[r_ * ch:(r_ + 1) * ch, c_ * cw:(c_ + 1) * cw] = cell
        Image.fromarray((AT * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(od, "%s.webp" % gid), quality=80, method=4, alpha_quality=70)
        XS = W // 2 if m.get("shift") else 0   # кадр с камерой, повёрнутой на 180° (через шов): px в координатах панорамы, может быть > W
        J[pk][gid] = {"px": [int(X0 + x0 + XS), int(Y0 + y0), int(X0 + x1 + XS), int(Y0 + y1)], "n": N - 1, "cols": COLS, "cell": [cw, ch], "sc": round(cw / cw0, 5), "res": W, "file": "%s/%s.webp" % (pk, gid)}
        print(pk, gid, x1 - x0, y1 - y0, flush=True)
    json.dump(J, open(JF, "w"), ensure_ascii=False)
print("ok")
