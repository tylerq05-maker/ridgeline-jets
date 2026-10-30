#!/usr/bin/env python3
"""Bake one satellite mosaic per city from EOX Sentinel-2 cloudless 2016 (CC BY 4.0).

Layer: s2cloudless_3857 ("Sentinel-2 cloudless layer for 2016 by EOX", GoogleMapsCompatible).
Only the 2016 layer is CC BY 4.0; later years are CC BY-NC-SA and must NOT be used here.

Each mosaic is reprojected from Web Mercator to a plain lat/lon grid (linear in lat and lon), so the game can map
world (x, z) to texture uv with one affine transform. Output: assets/sat/<id>.jpg + assets/sat/index.json.
Run once:  python3 tools/build_sat.py      (needs numpy + Pillow; tiles are cached in tools/.tilecache)
"""
import io, json, math, os, ssl, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sat")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tilecache")
URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
Z = 14  # ~9.5 m/px at the equator: Sentinel-2's native 10 m

def box(lat, lon, half):
    dl = half / 111320.0; dn = half / (111320.0 * math.cos(math.radians(lat)))
    return [lat - dl, lon - dn, lat + dl, lon + dn]

def inland(lat, lon, brg, d):
    """point d metres from (lat, lon) against the sea bearing brg (deg)."""
    b = math.radians(brg)
    return lat - math.cos(b) * d / 111320.0, lon - math.sin(b) * d / (111320.0 * math.cos(math.radians(lat)))

# Georeferenced zones (match terrain-gen.js): NYC around ESB origin, SF around (37.815, -122.44); 23 km radius.
CITIES = {
    "nyc": {"bounds": box(40.7484 - 1500 / 111045, -73.9857 + 600 / 84330, 23500), "size": 4096},
    "sf": {"bounds": box(37.815, -122.44, 23500), "size": 4096},
}
# Procedural coastal cities: a real shoreline point and the bearing from land to the sea; the game rotates the
# imagery so this bearing matches the site's sea direction. Mosaic covers +-12 km around a point 3 km inland.
COAST = {
    "dubai":   (25.2140, 55.2560, 315),   # Jumeirah shore opposite Burj Khalifa, Gulf to the NW
    "tokyo":   (35.6560, 139.7700, 150),  # Hamarikyu / Takeshiba, Tokyo Bay to the SSE
    "rio":     (-22.9030, -43.1735, 75),  # Praca XV, Guanabara Bay to the ENE
    "hk":      (22.2860, 114.1580, 0),    # Central waterfront, Victoria Harbour to the N
    "chicago": (41.8800, -87.6140, 90),   # Grant Park lakefront, Lake Michigan to the E
}
for cid, (la, lo, brg) in COAST.items():
    c = inland(la, lo, brg, 3000)
    CITIES[cid] = {"bounds": box(c[0], c[1], 12000), "size": 2048, "coast": [la, lo], "seaBearing": brg}

ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt") if os.path.exists("/root/.ccr/ca-bundle.crt") else ssl.create_default_context()

def tile(x, y):
    p = os.path.join(CACHE, f"{Z}_{x}_{y}.jpg")
    if not os.path.exists(p):
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(URL.format(z=Z, x=x, y=y), headers={"User-Agent": "jet-city-build/1.0"}), timeout=60, context=ctx) as r:
                    data = r.read()
                with open(p, "wb") as f: f.write(data)
                break
            except Exception as e:
                if attempt == 3: raise
    return np.asarray(Image.open(p).convert("RGB"))

def merc(lat, lon):
    n = 2 ** Z * 256
    x = (lon + 180.0) / 360.0 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def build(cid, c):
    s, w, n, e = c["bounds"]; size = c["size"]
    x0, y0 = merc(n, w); x1, y1 = merc(s, e)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    coords = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    with ThreadPoolExecutor(16) as ex: tiles = list(ex.map(lambda t: tile(*t), coords))
    W_, H_ = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    big = np.zeros((H_, W_, 3), np.uint8)
    for (tx, ty), t in zip(coords, tiles): big[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = t
    # equirectangular output grid -> mercator pixel coordinates, bilinear sample
    lats = n - (np.arange(size) + 0.5) / size * (n - s); lons = w + (np.arange(size) + 0.5) / size * (e - w)
    N = 2 ** Z * 256
    px = (lons + 180.0) / 360.0 * N - tx0 * 256 - 0.5
    lr = np.radians(lats); py = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / np.pi) / 2 * N - ty0 * 256 - 0.5
    X, Y = np.meshgrid(px, py)
    xi = np.clip(np.floor(X).astype(int), 0, W_ - 2); yi = np.clip(np.floor(Y).astype(int), 0, H_ - 2)
    fx = (X - xi)[..., None]; fy = (Y - yi)[..., None]
    b = big.astype(np.float32)
    img = (b[yi, xi] * (1 - fx) * (1 - fy) + b[yi, xi + 1] * fx * (1 - fy) + b[yi + 1, xi] * (1 - fx) * fy + b[yi + 1, xi + 1] * fx * fy)
    Image.fromarray(np.clip(img + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, cid + ".jpg"), quality=c.get("q", 80), optimize=True, progressive=True)
    mpp = (e - w) * 111320 * math.cos(math.radians((s + n) / 2)) / size
    print(cid, len(coords), "tiles", f"{mpp:.1f} m/px", os.path.getsize(os.path.join(OUT, cid + ".jpg")) // 1024, "KB", flush=True)

def landuse(n=256):
    """Coarse land-use grid per procedural city (n x n over the mosaic, row 0 = north): 0 built/bare, 1 vegetation,
    2 water. Packed 4 cells per byte, base64. Used by cities.js to keep buildings off imagery water and woods."""
    import base64
    out = {}
    for cid, c in CITIES.items():
        if "coast" not in c: continue
        im = np.asarray(Image.open(os.path.join(OUT, cid + ".jpg")).convert("RGB").resize((n, n), Image.BOX)).astype(np.float32) / 255
        r, g, b = im[..., 0], im[..., 1], im[..., 2]; l = 0.299 * r + 0.587 * g + 0.114 * b
        water = (b - r > 0.03) & (b > g * 0.88) & (l < 0.42)
        veg = ~water & (g > r * 1.06) & (b < g * 0.88) & (l < 0.36)
        cls = np.where(water, 2, np.where(veg, 1, 0)).astype(np.uint8).ravel()
        packed = (cls[0::4] | (cls[1::4] << 2) | (cls[2::4] << 4) | (cls[3::4] << 6)).astype(np.uint8)
        out[cid] = {"n": n, "data": base64.b64encode(packed.tobytes()).decode(), "water": round(float(water.mean()), 3), "veg": round(float(veg.mean()), 3)}
        print(cid, "landuse water", out[cid]["water"], "veg", out[cid]["veg"])
    with open(os.path.join(OUT, "landuse.json"), "w") as f: json.dump(out, f)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    only = sys.argv[1:]
    if only == ["landuse"]: landuse(); sys.exit()
    for cid, c in CITIES.items():
        if not only or cid in only: build(cid, c)
    meta = {"layer": "s2cloudless_3857 (Sentinel-2 cloudless 2016)", "license": "CC BY 4.0",
            "attribution": "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)",
            "cities": {cid: {"file": cid + ".jpg", "s": c["bounds"][0], "w": c["bounds"][1], "n": c["bounds"][2], "e": c["bounds"][3], "size": c["size"],
                             **({"coast": c["coast"], "seaBearing": c["seaBearing"]} if "coast" in c else {})} for cid, c in CITIES.items()}}
    with open(os.path.join(OUT, "index.json"), "w") as f: json.dump(meta, f, indent=1)
    landuse()
