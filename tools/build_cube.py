# Нарезка эквиректа в куб с уровнями детализации (как krpano multires), плитки 512 px JPEG.
# python3 build_cube.py PANO.jpg OUTDIR  → OUTDIR/l{0,1,2}/{f}_{x}_{y}.jpg + OUTDIR/info.json
# Направления — как в просмотрщике Липок (three): dx=-v.z, dy=-v.x, dz=v.y; u = 0.5+atan2(dx,dy)/2π, v = 0.5-asin(dz)/π
import sys, os, json, math, numpy as np, cv2
SRC, OUT = sys.argv[1], sys.argv[2]
TILE = 512
P = cv2.imread(SRC); H, W = P.shape[:2]
FACE = int(os.environ.get("FACE", str(W // 4)))      # 8192 → 2048 на грань (та же плотность, что у эквиректа)
# грани: центр, вправо, вверх — в координатах three (камера внутри, смотрим наружу)
FACES = {
    "px": ((1, 0, 0), (0, 0, 1), (0, 1, 0)), "nx": ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),
    "py": ((0, 1, 0), (1, 0, 0), (0, 0, -1)), "ny": ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    "pz": ((0, 0, 1), (-1, 0, 0), (0, 1, 0)), "nz": ((0, 0, -1), (1, 0, 0), (0, 1, 0)),
}
def face_img(c, r, u, N):
    c, r, u = (np.array(a, np.float32) for a in (c, r, u))
    s = (np.arange(N, dtype=np.float32) + 0.5) / N * 2 - 1
    X, Y = np.meshgrid(s, -s)                       # Y: сверху вниз
    d = c[None, None] + r[None, None] * X[..., None] + u[None, None] * Y[..., None]
    dx, dy, dz = -d[..., 2], -d[..., 0], d[..., 1]
    rr = np.sqrt(dx * dx + dy * dy + dz * dz)
    mx = ((0.5 + np.arctan2(dx, dy) / (2 * np.pi)) * W - 0.5) % W
    my = (0.5 - np.arcsin(np.clip(dz / rr, -1, 1)) / np.pi) * H - 0.5
    return cv2.remap(P, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
levels = []; n = FACE
while n >= TILE: levels.append(n); n //= 2
levels = levels[::-1]                                  # 512, 1024, 2048
os.makedirs(OUT, exist_ok=True)
total = 0
for f, (c, r, u) in FACES.items():
    big = face_img(c, r, u, levels[-1])
    for li, N in enumerate(levels):
        im = big if N == levels[-1] else cv2.resize(big, (N, N), interpolation=cv2.INTER_AREA)
        d = os.path.join(OUT, "l%d" % li); os.makedirs(d, exist_ok=True)
        k = N // TILE
        for ty in range(k):
            for tx in range(k):
                fn = os.path.join(d, "%s_%d_%d.jpg" % (f, tx, ty))
                cv2.imwrite(fn, im[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE], [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_PROGRESSIVE, 0])
                total += os.path.getsize(fn)
    # маленькое превью всей грани (для мгновенного показа)
    cv2.imwrite(os.path.join(OUT, "prev_%s.jpg" % f), cv2.resize(big, (256, 256), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 80])
json.dump({"tile": TILE, "levels": levels, "faces": {k: v for k, v in FACES.items()}, "bytes": total}, open(os.path.join(OUT, "info.json"), "w"))
print("ok", levels, round(total / 1e6, 1), "MB")
