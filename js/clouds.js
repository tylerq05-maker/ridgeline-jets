/* Ridgeline Jets — volumetric clouds.
 * A raymarched cloud layer rendered at reduced resolution inside the post pipeline:
 *   weather map (2D, tiling)  → where clouds are, how tall, where storms tower
 *   shape noise (3D Perlin-Worley) + detail noise (3D Worley) → billowing cumulus forms
 *   sun light march + dual-lobe phase + multiple-scattering approximation → silver linings, dark bases
 * Composited into the HDR scene with a depth-aware upsample, before transparent effects are drawn,
 * so flames and vapor in front of a cloud stay in front of it. Requires WebGL2; otherwise the
 * billboard clouds in world.js are used. The same weather map drives terrain cloud shadows and the
 * CPU-side density queries (in-cloud whiteout, buffet, sonic-boom humidity).
 * Marching is adaptive: coarse cheap probes through clear air, fine distance-scaled steps inside cloud, so
 * nearby cumulus stay crisp. Gameplay can also place single cumulus anywhere with addLocal() (see below). */
(function (RJ) {
  "use strict";
  const C = { ok: false, enabled: false };
  RJ.clouds = C;
  RJ.LATE = 3; // render layer for transparent effects drawn after the clouds

  const WMS = 24000;   // weather map tile size (m)
  const WN = 256;      // weather map resolution
  const SHAPE_TILE = 4600, DETAIL_TILE = 820;

  /* ---------------- tileable noise (CPU, generated once) ---------------- */
  function mulberry32(a) {
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash3 = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  /** Periodic value-gradient noise in 3D, period P lattice cells. Returns ~[-1, 1]. */
  function perlin3(x, y, z, P, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const g = (ix, iy, iz, dx, dy, dz) => {
      const a = ((ix % P) + P) % P, b = ((iy % P) + P) % P, c = ((iz % P) + P) % P;
      const h1 = hash3(a, b, c, seed), h2 = hash3(a, b, c, seed + 7);
      const th = h1 * Math.PI * 2, ph = Math.acos(h2 * 2 - 1);
      return Math.sin(ph) * Math.cos(th) * dx + Math.sin(ph) * Math.sin(th) * dy + Math.cos(ph) * dz;
    };
    const L = (a, b, t) => a + (b - a) * t;
    const x0 = L(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u);
    const x1 = L(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
    const x2 = L(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
    const x3 = L(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
    return L(L(x0, x1, v), L(x2, x3, v), w) * 1.6;
  }
  /** Periodic Worley distance (nearest feature point), cells per tile = n, coordinates in [0,1). */
  function makeWorley(n, seed, dims) {
    const pts = new Float32Array(n * n * n * 3);
    const rnd = mulberry32(seed);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    return function (u, v, w) {
      const px = u * n, py = v * n, pz = dims === 3 ? w * n : 0;
      const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      let best = 9;
      const zr = dims === 3 ? 1 : 0;
      for (let k = -zr; k <= zr; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ax = cx + i, ay = cy + j, az = cz + k;
        const wx = ((ax % n) + n) % n, wy = ((ay % n) + n) % n, wz = dims === 3 ? ((az % n) + n) % n : 0;
        const o = ((wz * n + wy) * n + wx) * 3;
        const dx = ax + pts[o] - px, dy = ay + pts[o + 1] - py, dz = dims === 3 ? az + pts[o + 2] - pz : 0;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      return Math.min(1, Math.sqrt(best));
    };
  }
  function normalize(arr) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; }
    const k = 1 / Math.max(hi - lo, 1e-6);
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k;
    return arr;
  }
  function buildShape(N) {
    const w1 = makeWorley(4, 11, 3), w2 = makeWorley(8, 12, 3), w3 = makeWorley(16, 13, 3);
    const out = new Float32Array(N * N * N);
    let o = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, o++) {
      const u = x / N, v = y / N, w = z / N;
      const pf = 0.5 + 0.5 * (perlin3(u * 4, v * 4, w * 4, 4, 3) * 0.6 + perlin3(u * 8, v * 8, w * 8, 8, 4) * 0.28 + perlin3(u * 16, v * 16, w * 16, 16, 5) * 0.12);
      const wf = 1 - (w1(u, v, w) * 0.625 + w2(u, v, w) * 0.25 + w3(u, v, w) * 0.125);
      // Perlin-Worley: billowy cells with soft, connected structure
      out[o] = Math.max(0, pf * 0.45 + wf * 0.75 - 0.18);
    }
    return normalize(out);
  }
  function buildDetail(N) {
    const w1 = makeWorley(4, 21, 3), w2 = makeWorley(8, 22, 3), w3 = makeWorley(16, 23, 3);
    const out = new Float32Array(N * N * N);
    let o = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, o++) {
      const u = x / N, v = y / N, w = z / N;
      out[o] = 1 - (w1(u, v, w) * 0.625 + w2(u, v, w) * 0.25 + w3(u, v, w) * 0.125);
    }
    return normalize(out);
  }
  function buildWeather(N) {
    const cellA = makeWorley(10, 31, 2), cellB = makeWorley(20, 32, 2), cellC = makeWorley(40, 35, 2), storm = makeWorley(3, 33, 2), tow = makeWorley(7, 34, 2);
    const R = new Float32Array(N * N), G = new Float32Array(N * N), B = new Float32Array(N * N), A = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = y * N + x;
      const f = perlin3(u * 4, v * 4, 0.5, 4, 41) * 0.55 + perlin3(u * 8, v * 8, 1.5, 8, 42) * 0.3 + perlin3(u * 16, v * 16, 2.5, 16, 43) * 0.15;
      // big (2.4 km), medium (1.2 km) and small (600 m) cumulus cells → mixed sizes with blue gaps between
      const cells = (1 - cellA(u, v, 0)) * 0.55 + (1 - cellB(u, v, 0)) * 0.3 + (1 - cellC(u, v, 0)) * 0.15;
      R[i] = f * 0.5 + cells * 0.95;
      G[i] = perlin3(u * 3, v * 3, 7.5, 3, 44) * 0.75 + perlin3(u * 12, v * 12, 9.5, 12, 45) * 0.25;
      B[i] = 1 - storm(u, v, 0);
      A[i] = 1 - tow(u, v, 0);
    }
    normalize(R); normalize(G); normalize(B); normalize(A);
    const ss = (a, b, x) => { const s = (x - a) / (b - a); return s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s); };
    for (let i = 0; i < B.length; i++) {
      B[i] = ss(0.82, 0.96, B[i]);
      // towering cumulus: a few cell centres, only where a cloud stands anyway
      A[i] = ss(0.7, 0.93, A[i]) * ss(0.5, 0.78, R[i]);
    }
    return { R, G, B, A };
  }

  /* ---------------- weather presets ---------------- */
  // cov: coverage bias, base/top: layer (m), den: extinction scale, storm: tower strength, flat: 1 = stratiform deck
  const PRESETS = {
    clear: { cov: -0.32, base: 2600, top: 3700, den: 0.75, storm: 0, flat: 0.2, tow: 900 },
    scattered: { cov: -0.06, base: 2200, top: 3900, den: 1.0, storm: 0, flat: 0.1, tow: 2300 },
    overcast: { cov: 0.34, base: 1700, top: 3500, den: 1.2, storm: 0, flat: 0.55, tow: 600 },
    storm: { cov: 0.36, base: 1300, top: 5200, den: 1.45, storm: 1, flat: 0.25 },
    cloudsea: { cov: 0.42, base: 1500, top: 2700, den: 1.1, storm: 0, flat: 0.8 },
    // stormTop: anvil height (m); sq: squall-line strength (a moving band of storm cells)
    lightrain: { cov: 0.38, base: 1200, top: 3300, den: 1.25, storm: 0, flat: 0.6 },
    heavyrain: { cov: 0.44, base: 900, top: 4300, den: 1.4, storm: 0.35, flat: 0.5, stormTop: 7500 },
    thunder: { cov: 0.36, base: 1200, top: 5200, den: 1.5, storm: 1.2, flat: 0.25, stormTop: 12000 },
    supercell: { cov: 0.16, base: 1000, top: 4400, den: 1.65, storm: 1.7, flat: 0.15, stormTop: 14500 },
    squall: { cov: 0.06, base: 1100, top: 4600, den: 1.5, storm: 0.45, flat: 0.25, stormTop: 12500, sq: 1 },
    windstorm: { cov: -0.14, base: 2500, top: 3700, den: 0.9, storm: 0, flat: 0.35, tow: 700 },
    fog: { cov: 0.5, base: 0, top: 420, den: 1.3, storm: 0, flat: 1 }
  };
  const KEYS = ["cov", "base", "top", "den", "storm", "flat", "stormTop", "sq", "tow"];
  for (const k in PRESETS) { const P = PRESETS[k]; P.stormTop = P.stormTop || (P.storm > 0 ? 11000 : P.top); P.sq = P.sq || 0; P.tow = P.tow || 0; }
  C.PRESETS = PRESETS;
  C.p = Object.assign({}, PRESETS.scattered);

  /* ---------------- GPU ---------------- */
  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const COMMON = [
    "precision highp sampler3D;",
    "uniform sampler2D tLin; uniform sampler2D tWeather; uniform sampler3D tShape; uniform sampler3D tDetail;",
    "uniform mat4 invProj; uniform mat4 camWorld; uniform vec3 camPos; uniform float camNear; uniform float camFar;",
    "uniform vec4 slab;   // base, top, stormTop, maxDist",
    "uniform vec4 wx;     // coverage bias, extinction, storm, flatness",
    "uniform vec4 wmap;   // wind x, wind z, 1/weather tile, 1/shape tile",
    "uniform vec4 wt;     // towering-cumulus height (m), march ceiling, march floor, -",
    "uniform float detailScale; uniform float time; uniform float frame;",
    "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 ambTop; uniform vec3 ambBot; uniform vec3 fogCol; uniform float fogDen;",
    "uniform vec4 holes[2];",
    "uniform vec4 sq;     // squall band: dir x, dir z, offset along dir, half width",
    "uniform vec4 fl;     // lightning flash position + intensity",
    "uniform vec4 rn;     // rain shaft floor, rain amount, squall strength",
    "uniform vec4 lcA[8]; uniform vec4 lcB[8]; uniform int lcN; // local cumulus: x, z, radius, density | base, top, seed",
    "varying vec2 vUv;",
    "float viewZ(float d){ return (camNear * camFar) / ((camFar - camNear) * d - camFar); }",
    "vec3 rayDir(vec2 uv, out vec3 vdir){ vec4 v = invProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); vdir = normalize(v.xyz / v.w); return normalize((camWorld * vec4(vdir, 0.0)).xyz); }",
    "float sceneDist(vec2 uv, vec3 vdir){ float z = texture2D(tLin, uv).r; if (z > 59000.0) return 1e7; return z / max(-vdir.z, 1e-4); }",
    "vec2 slabT(vec3 ro, vec3 rd){",
    "  float lo = wt.z, hi = wt.y;",
    "  if (abs(rd.y) < 1e-4) { if (ro.y < lo || ro.y > hi) return vec2(1.0, 0.0); return vec2(0.0, slab.w); }",
    "  float ta = (lo - ro.y) / rd.y, tb = (hi - ro.y) / rd.y;",
    "  return vec2(max(min(ta, tb), 0.0), max(ta, tb));",
    "}"
  ].join("\n");
  // cloud density field shared by the march and the temporal resolve
  const DENS = [
    "float remap(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / (b - a); }",
    // detail erosion: wispy near the base, billowy (rounded puffs) higher up; a finer octave close to the camera
    "float erode(float d, vec3 dp, float hf, float t){",
    "  float det = texture(tDetail, dp * detailScale).r;",
    "  float nf = 1.0 - smoothstep(900.0, 4500.0, t);",
    "  if (nf > 0.01) det = mix(det, det * 0.6 + texture(tDetail, dp * (detailScale * 3.71) + 0.37).r * 0.4, nf);",
    "  float m = mix(det, 1.0 - det, smoothstep(0.04, 0.35, hf));",
    "  return remap(d, m * mix(0.42, 0.3, hf), 1.0, 0.0, 1.0);",
    "}",
    "float layerD(vec3 p, bool cheap, float t, out float hfo){",
    "  hfo = 0.0;",
    "  vec4 w = texture2D(tWeather, (p.xz - wmap.xy) * wmap.z);",
    "  float storm = w.b * wx.z;",
    "  if (rn.z > 0.0) { float x = (dot(p.xz, sq.xy) - sq.z) / sq.w; storm = max(storm, rn.z * exp(-x * x) * smoothstep(0.15, 0.6, w.r + w.g * 0.35)); }",
    "  float cov = clamp(w.r * 1.12 + wx.x - 0.08 + storm * 0.6, 0.0, 1.0);",
    "  if (cov < 0.22) return 0.0;",
    // rain shafts: grey curtains hanging from the base of strong cells down to the ground
    "  if (p.y < slab.x) {",
    "    if (rn.y <= 0.0 || storm < 0.3) return 0.0;",
    "    float sh = texture(tShape, vec3(p.x - wmap.x * 1.1, p.y * 0.05, p.z - wmap.y * 1.1) * wmap.w * 2.3).r;",
    "    return rn.y * 0.11 * smoothstep(0.3, 0.85, storm) * smoothstep(0.4, 0.75, sh) * (0.55 + 0.45 * smoothstep(rn.x, slab.x, p.y));",
    "  }",
    // cell height: weather G, plus towering cumulus (A) where the weather map marks them; storms reach the anvil
    "  float top = mix(slab.x + (slab.y - slab.x) * mix(mix(0.32, 1.0, w.g), 0.45, wx.w) + w.a * wt.x, slab.z, min(storm, 1.0));",
    "  float hf = (p.y - slab.x) / max(top - slab.x, 1.0);",
    "  if (hf < 0.0 || hf > 1.0) return 0.0;",
    "  hfo = hf;",
    // flat bases, domed tops; storms flare out into an anvil near the top
    "  float prof = smoothstep(0.0, 0.05, hf) * (1.0 - smoothstep(mix(0.35, 0.8, wx.w), 1.0, hf));",
    "  prof = max(prof, storm * smoothstep(0.78, 0.9, hf) * (1.0 - smoothstep(0.93, 1.0, hf)) * 1.2);",
    "  vec3 sp = vec3(p.x - wmap.x, p.y * 1.6, p.z - wmap.y) * wmap.w;",
    "  float shape = texture(tShape, sp).r;",
    "  float d = remap(shape * prof, 1.0 - cov, 1.0, 0.0, 1.0);",
    "  if (d <= 0.0) return 0.0;",
    "  if (!cheap) d = erode(d, vec3(p.x - wmap.x * 1.2, p.y + time * 3.0, p.z - wmap.y * 1.2), hf, t);",
    "  return clamp(d, 0.0, 1.0) * mix(0.75, 1.15, hf);",
    "}",
    // placed cumulus (addLocal): flat base, near-vertical flanks, rounded crown; billows scale with the cloud
    "float localD(vec3 p, bool cheap, float t, out float hfo){",
    "  float best = 0.0; hfo = 0.0;",
    "  for (int i = 0; i < 8; i++) {",
    "    if (i >= lcN) break;",
    "    vec4 a = lcA[i]; vec4 b = lcB[i];",
    "    if (p.y < b.x || p.y > b.y) continue;",
    "    float r = length(p.xz - a.xy) / a.z;",
    "    if (r > 1.0) continue;",
    "    float hf = (p.y - b.x) / (b.y - b.x);",
    "    float rad = mix(0.82, 1.0, smoothstep(0.0, 0.25, hf)) * sqrt(max(1.0 - pow(hf, 2.2), 0.0));",
    "    float cov = 1.0 - smoothstep(rad * 0.4, rad, r);",
    "    if (cov <= 0.0) continue;",
    "    vec3 lp = p - vec3(a.x, b.x, a.y);",
    "    float shape = texture(tShape, lp / (a.z * 2.4) + vec3(b.z, b.z * 0.7, b.z * 1.3)).r;",
    "    float d = remap(shape * smoothstep(0.0, 0.06, hf), 1.0 - cov * 0.92, 1.0, 0.0, 1.0);",
    "    if (d <= 0.0) continue;",
    "    if (!cheap) d = erode(d, lp + vec3(b.z * 97.0, time * 2.0, b.z * 61.0), hf, t);",
    "    d = clamp(d, 0.0, 1.0) * a.w * mix(0.8, 1.15, hf);",
    "    if (d > best) { best = d; hfo = hf; }",
    "  }",
    "  return best;",
    "}",
    "float density(vec3 p, bool cheap, float t, out float hfo){",
    "  float d = layerD(p, cheap, t, hfo);",
    "  if (lcN > 0) { float h2; float l = localD(p, cheap, t, h2); if (l > d) { d = l; hfo = h2; } }",
    "  if (d <= 0.0) return 0.0;",
    "  for (int i = 0; i < 2; i++) { vec4 h = holes[i]; if (h.w > 1.0) d *= smoothstep(h.w * 0.6, h.w, distance(p, h.xyz)); }",
    "  return d;",
    "}"
  ].join("\n");
  const MARCH = [
    COMMON,
    DENS,
    "float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }",
    "void main(){",
    "  vec3 vdir; vec3 rd = rayDir(vUv, vdir);",
    "  float sd = sceneDist(vUv, vdir);",
    "  vec2 tt = slabT(camPos, rd);",
    "  float t0 = tt.x, t1 = min(min(tt.y, sd), slab.w);",
    "  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }",
    "  t1 = min(t1, t0 + 36000.0);",
    "  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + frame * 0.6180339);",
    "  float cosT = dot(rd, sunDir);",
    "  float sigma = 0.016 * wx.y;",
    "  vec3 col = vec3(0.0); float T = 1.0; float dsum = 0.0; float wsum = 0.0; float hd;",
    // adaptive march: cheap 3x probes through clear air; on a hit, back up and take fine steps that grow with
    // distance (so nearby cumulus stay crisp); the step floor still guarantees the far end of the slab is reached
    "  float t = t0 + clamp(t0 * LODK, MINSTEP, 900.0) * jit;",
    "  int empty = 4;",
    "  for (int i = 0; i < STEPS; i++) {",
    "    if (t > t1 || T < 0.012) break;",
    "    float lod = max(clamp(t * LODK, MINSTEP, 900.0), (t1 - t) / float(STEPS - i) * 0.5);",
    "    vec3 p = camPos + rd * t;",
    "    if (empty >= 4) {",
    "      if (density(p, true, t, hd) <= 0.0) { t += lod * 3.0; continue; }",
    "      t = max(t - lod * 1.5, t0); empty = 0; continue;",
    "    }",
    "    float hf; float dens = density(p, false, t, hf);",
    "    if (dens > 0.003) {",
    "      empty = 0;",
    "      float od = 0.0; float ls = 30.0; vec3 lp = p;",
    "      for (int k = 0; k < LSTEPS; k++) { lp += sunDir * ls; od += density(lp, true, t, hd) * ls; ls *= 1.95; }",
    // multiple scattering (3 octaves): each bounce sees less extinction and a softer phase, which lights
    // cloud interiors and makes thin edges facing the sun glow (silver lining)
    "      float lum = 0.0, oa = 1.0, ob = 1.0, oc = 1.0;",
    "      for (int o = 0; o < 3; o++) { float ph = mix(hg(cosT, 0.7 * oc), hg(cosT, -0.25 * oc), 0.3) * 0.3 + 0.06; lum += oa * exp(-od * sigma * ob) * ph; oa *= 0.5; ob *= 0.3; oc *= 0.5; }",
    // powder: billow rims bright, dense cores darker (less so looking toward the sun, where edges glow)
    "      float powder = mix(1.0 - exp(-dens * 5.0), 1.0, clamp(cosT, 0.0, 1.0) * 0.6);",
    // sky light: flat bases sit in their own shadow, crowns see the whole sky
    "      vec3 amb = mix(ambBot, ambTop, hf) * mix(0.32, 1.0, smoothstep(0.0, 0.6, hf)) * (1.0 - 0.3 * dens);",
    "      vec3 S = sunCol * lum * mix(0.45, 1.0, powder) * 4.3 + amb;",
    "      if (fl.w > 0.0) S += vec3(0.78, 0.82, 1.0) * fl.w * 3.5 * exp(-distance(p, fl.xyz) / 1800.0);",
    "      float Ts = exp(-dens * sigma * lod);",
    "      col += T * S * (1.0 - Ts);",
    "      dsum += T * (1.0 - Ts) * t; wsum += T * (1.0 - Ts);",
    "      T *= Ts;",
    "    } else empty++;",
    "    t += lod;",
    "  }",
    // aerial perspective: distant clouds fade into the haze
    "  float dist = wsum > 1e-4 ? dsum / wsum : t0;",
    "  float fogF = 1.0 - exp(-fogDen * dist);",
    "  col = mix(col, fogCol * (1.0 - T), clamp(fogF, 0.0, 0.92));",
    "  gl_FragColor = vec4(col, T);",
    "}"
  ].join("\n");
  // linear view depth copy, so the composite never samples the depth buffer it is drawing into
  const LINDEPTH = [
    "uniform sampler2D tDepth; uniform float camNear; uniform float camFar; varying vec2 vUv;",
    "void main(){ float d = texture2D(tDepth, vUv).x;",
    "  float z = d > 0.999999 ? 60000.0 : min(-(camNear * camFar) / ((camFar - camNear) * d - camFar), 60000.0);",
    "  gl_FragColor = vec4(z, 0.0, 0.0, 1.0); }"
  ].join("\n");
  // temporal resolve: reproject last frame's clouds and blend, clamped to this frame's neighborhood
  const RESOLVE = [
    COMMON,
    DENS,
    "uniform sampler2D tCur; uniform sampler2D tHist; uniform mat4 prevVP; uniform vec2 lowRes; uniform float histW;",
    "void main(){",
    "  vec4 cur = texture2D(tCur, vUv);",
    "  vec2 tx = 1.0 / lowRes;",
    "  vec4 mn = cur, mx = cur;",
    "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec4 c = texture2D(tCur, vUv + vec2(float(i), float(j)) * tx); mn = min(mn, c); mx = max(mx, c); }",
    "  vec3 vdir; vec3 rd = rayDir(vUv, vdir);",
    "  vec2 tt = slabT(camPos, rd);",
    "  float sd = sceneDist(vUv, vdir);",
    "  float tr = clamp(mix(tt.x, min(tt.y, slab.w), 0.3), 0.0, min(sd, 40000.0));",
    // near the layer, reproject at the first cloud surface along the ray (a short cheap probe), not mid-slab:
    // otherwise nearby clouds smear sideways when the camera moves
    "  if (tt.x < 2500.0 && tt.y > tt.x) { float t = tt.x, hd; for (int i = 0; i < 12; i++) { if (t > min(tt.y, sd)) break; if (density(camPos + rd * t, true, t, hd) > 0.0) { tr = t + 40.0; break; } t += max(80.0, (t - tt.x) * 0.35); } }",
    "  vec4 cp = prevVP * vec4(camPos + rd * max(tr, 50.0), 1.0);",
    "  vec2 puv = cp.xy / cp.w * 0.5 + 0.5;",
    "  float ok = (cp.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) ? histW : 0.0;",
    "  vec4 hist = clamp(texture2D(tHist, puv), mn, mx);",
    "  gl_FragColor = mix(cur, hist, ok);",
    "}"
  ].join("\n");
  const COMPOSITE = [
    COMMON,
    "uniform sampler2D tCloud; uniform vec2 lowRes;",
    "float lin(vec2 uv, vec3 vdir){ return sceneDist(uv, vdir); }",
    "void main(){",
    "  vec3 vdir; vec3 rd = rayDir(vUv, vdir);",
    "  float d0 = sceneDist(vUv, vdir);",
    "  vec2 tt = slabT(camPos, rd);",
    // nothing can be in front of geometry that sits before the cloud layer starts
    "  if (tt.y <= tt.x || d0 < tt.x) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }",
    "  vec2 p = vUv * lowRes - 0.5; vec2 i0 = floor(p); vec2 f = p - i0;",
    "  vec4 acc = vec4(0.0); float ws = 0.0;",
    "  for (int k = 0; k < 4; k++) {",
    "    vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));",
    "    vec2 uv = (i0 + o + 0.5) / lowRes;",
    "    vec3 vd2; rayDir(uv, vd2);",
    "    float dk = sceneDist(uv, vd2);",
    "    float bw = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);",
    "    float rel = abs(min(dk, 6e4) - min(d0, 6e4)) / max(min(d0, 6e4), 1.0);",
    "    float w = bw * (1.0 / (0.02 + rel * 8.0));",
    "    acc += texture2D(tCloud, uv) * w; ws += w;",
    "  }",
    "  gl_FragColor = acc / max(ws, 1e-5);",
    "}"
  ].join("\n");

  function mkMat(frag, U, defines, blend) {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: U, defines: defines || {}, depthTest: false, depthWrite: false });
    if (blend) {
      m.transparent = true;
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor; m.blendDst = THREE.SrcAlphaFactor;
      m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    }
    return m;
  }

  C.init = function (renderer) {
    C.r = renderer;
    // weather map is needed for cloud shadows and density queries even without WebGL2 raymarching
    const t0 = performance.now();
    const Wm = buildWeather(WN);
    C.weather = Wm;
    const wdata = new Uint8Array(WN * WN * 4);
    for (let i = 0; i < WN * WN; i++) { wdata[i * 4] = Wm.R[i] * 255; wdata[i * 4 + 1] = Wm.G[i] * 255; wdata[i * 4 + 2] = Wm.B[i] * 255; wdata[i * 4 + 3] = Wm.A[i] * 255; }
    C.weatherTex = new THREE.DataTexture(wdata, WN, WN, THREE.RGBAFormat);
    C.weatherTex.wrapS = C.weatherTex.wrapT = THREE.RepeatWrapping;
    C.weatherTex.magFilter = C.weatherTex.minFilter = THREE.LinearFilter;
    C.weatherTex.needsUpdate = true;
    if (!renderer.capabilities.isWebGL2 || !RJ.post.ok || !RJ.post.depthOK) { C.ok = false; return; }
    try {
      const N = 64, D = 32;
      const tex3 = (arr, n) => {
        const u8 = new Uint8Array(arr.length);
        for (let i = 0; i < arr.length; i++) u8[i] = arr[i] * 255;
        const t = new THREE.DataTexture3D(u8, n, n, n);
        t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
        t.unpackAlignment = 1; t.generateMipmaps = false;
        t.needsUpdate = true;
        return t;
      };
      C.shapeTex = tex3(buildShape(N), N);
      C.detailTex = tex3(buildDetail(D), D);
      const half = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
      C.rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: half, depthBuffer: false, stencilBuffer: false });
      C.rt.texture.generateMipmaps = false;
      const U = {
        tDepth: { value: null }, tLin: { value: null }, tWeather: { value: C.weatherTex }, tShape: { value: C.shapeTex }, tDetail: { value: C.detailTex },
        invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
        camNear: { value: 0.5 }, camFar: { value: 20000 },
        slab: { value: new THREE.Vector4(2200, 3900, 9000, 45000) }, wx: { value: new THREE.Vector4(0, 1, 0, 0) },
        wmap: { value: new THREE.Vector4(0, 0, 1 / WMS, 1 / SHAPE_TILE) }, detailScale: { value: 1 / DETAIL_TILE }, time: { value: 0 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) },
        ambTop: { value: new THREE.Color(0.5, 0.6, 0.8) }, ambBot: { value: new THREE.Color(0.3, 0.33, 0.4) },
        fogCol: { value: new THREE.Color(0.7, 0.8, 0.9) }, fogDen: { value: 3e-5 },
        holes: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        sq: { value: new THREE.Vector4(1, 0, 0, 3000) }, fl: { value: new THREE.Vector4() }, rn: { value: new THREE.Vector4(0, 0, 0, 0) },
        wt: { value: new THREE.Vector4(0, 3900, 2200, 0) },
        lcA: { value: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4()) }, lcB: { value: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4()) }, lcN: { value: 0 },
        tCloud: { value: null }, lowRes: { value: new THREE.Vector2(4, 4) },
        frame: { value: 0 }, tCur: { value: null }, tHist: { value: null }, prevVP: { value: new THREE.Matrix4() }, histW: { value: 0 }
      };
      C.U = U;
      C.marchMats = {};
      C.marchFor = (q) => {
        const key = q.steps + "/" + q.lsteps + "/" + q.lodk;
        if (!C.marchMats[key]) C.marchMats[key] = mkMat(MARCH, U, { STEPS: q.steps, LSTEPS: q.lsteps, LODK: q.lodk.toFixed(4), MINSTEP: q.minStep.toFixed(1) });
        return C.marchMats[key];
      };
      C.comp = mkMat(COMPOSITE, U, {}, true);
      C.linMat = mkMat(LINDEPTH, U);
      C.resolveMat = mkMat(RESOLVE, U);
      C.hist = [0, 1].map(() => { const t = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: half, depthBuffer: false, stencilBuffer: false }); t.texture.generateMipmaps = false; return t; });
      C.hi = 0; C.prevVP = new THREE.Matrix4(); C.prevPos = new THREE.Vector3(); C.fresh = true;
      C.rtLin = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: half, depthBuffer: false, stencilBuffer: false });
      C.rtLin.texture.generateMipmaps = false;
      C.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), C.comp);
      C.quad.frustumCulled = false;
      C.qScene = new THREE.Scene(); C.qScene.add(C.quad);
      C.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      C.ok = true;
      console.info(`Volumetric clouds ready in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { console.warn("Volumetric clouds unavailable", e); C.ok = false; }
  };

  /** Quality tiers: render-target scale/cap, march iterations (coarse probes + fine samples), fine step = clamp(t * lodk, minStep, 900 m). */
  const QUAL = {
    low: null,
    medium: { scale: 0.34, maxW: 620, steps: 48, lsteps: 4, lodk: 0.018, minStep: 26 },
    high: { scale: 0.45, maxW: 860, steps: 64, lsteps: 5, lodk: 0.013, minStep: 18 },
    ultra: { scale: 0.55, maxW: 1180, steps: 88, lsteps: 6, lodk: 0.0095, minStep: 13 }
  };
  C.active = () => C.ok && C.enabled;
  C.setQuality = function (q) {
    C.q = QUAL[q] || null; C.fresh = true;
    C.enabled = C.ok && !!C.q && RJ.settings.volClouds !== false && RJ.post.enabled;
  };

  /** Switch weather. With blend (seconds) the cloud field morphs there gradually: storms build, decks thin out. */
  C.setWeather = function (id, blend) {
    C.target = Object.assign({}, PRESETS[id] || PRESETS.scattered);
    C.target.cov += (RJ.settings.clouds - 1) * 0.25;
    C.blendT = blend || 0;
    if (!blend) C.p = Object.assign({}, C.target);
    // a new squall line forms ~6 km upwind of the camera and marches across
    if (C.target.sq > 0 && (!blend || C.p.sq < 0.05)) { const c = RJ.world.camera ? RJ.world.camera.position : { x: 0, z: 0 }; C.sqBase = c.x * C.sqDir[0] + c.z * C.sqDir[1]; C.sqOff = -6000; }
  };
  /** Per frame: ease the live parameters toward the target preset, and advance the squall line. */
  C.step = function (dt) {
    const P = C.p, T = C.target;
    if (T && C.blendT > 0) {
      const k = Math.min(1, dt * 3 / C.blendT);
      for (const key of KEYS) P[key] += (T[key] - P[key]) * k;
    }
    // the squall line crosses the map with the wind, ~1 km a minute; it returns after passing
    C.sqOff = (C.sqOff == null ? -6000 : C.sqOff) + dt * 20;
    for (let i = C.locals.length - 1; i >= 0; i--) { const c = C.locals[i]; if (c.life > 0 && (c.life -= dt) <= 0) C.locals.splice(i, 1); }
    if (C.sqOff > 30000) C.sqOff = -30000;
  };
  C.sqDir = [0.8, 0.6];
  C.layer = () => ({ base: C.p.base, top: C.p.top, stormTop: Math.max(C.p.top, C.p.stormTop || 0), mid: (C.p.base + C.p.top) / 2 });
  /** Highest point any layer cloud can reach (storm anvils, towering cumulus). */
  const ceilTop = () => Math.max(C.p.top, C.p.stormTop || 0, C.p.top + (C.p.tow || 0) * (1 - C.p.flat));
  /** Storm strength (0..1.7) at world xz: the weather map's cells plus the squall band. */
  C.stormAt = function (x, z, w) {
    if (!C.weather) return 0;
    w = w || C.weatherAt(x, z);
    let s = w.b * C.p.storm;
    if (C.p.sq > 0.01) {
      const d = (x * C.sqDir[0] + z * C.sqDir[1] - (C.sqBase || 0) - C.sqOff) / 3200;
      s = Math.max(s, C.p.sq * Math.exp(-d * d) * RJ.smooth(0.15, 0.6, w.r + w.g * 0.35));
    }
    return s;
  };

  /* ---------------- CPU queries ---------------- */
  /** Bilinear weather sample at world xz (accounts for wind drift). */
  C.weatherAt = function (x, z) {
    const W = RJ.world, wo = W.windOff || { x: 0, y: 0 };
    const u = (((x - wo.x) / WMS) % 1 + 1) % 1 * WN - 0.5, v = (((z - wo.y) / WMS) % 1 + 1) % 1 * WN - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    const S = (A) => {
      const g = (i, j) => A[(((j % WN) + WN) % WN) * WN + (((i % WN) + WN) % WN)];
      return (g(i0, j0) * (1 - fu) + g(i0 + 1, j0) * fu) * (1 - fv) + (g(i0, j0 + 1) * (1 - fu) + g(i0 + 1, j0 + 1) * fu) * fv;
    };
    const Wm = C.weather;
    return { r: S(Wm.R), g: S(Wm.G), b: S(Wm.B), a: S(Wm.A) };
  };
  /** Approximate cloud density (0..1) at p, mirroring the shader without the 3D noise. pad > 1 also counts nearby air. */
  C.densityAt = function (p, pad = 1) {
    if (!C.weather) return 0;
    const loc = C.locals.length ? localAt(p, pad) : 0;
    const P = C.p;
    const lo = P.base - 160 * (pad - 1), hiMax = ceilTop() + 160 * (pad - 1);
    if (p.y < lo || p.y > hiMax) return loc;
    const w = C.weatherAt(p.x, p.z);
    const storm = C.stormAt(p.x, p.z, w);
    const cov = RJ.clamp(w.r * 1.12 + P.cov - 0.08 + storm * 0.6 + (pad - 1) * 0.12, 0, 1);
    if (cov < 0.22) return loc;
    const top = RJ.lerp(P.base + (P.top - P.base) * RJ.lerp(RJ.lerp(0.32, 1, w.g), 0.45, P.flat) + w.a * P.tow * (1 - P.flat), C.layer().stormTop, Math.min(storm, 1)) + 160 * (pad - 1);
    const hf = (p.y - lo) / Math.max(top - lo, 1);
    if (hf < 0 || hf > 1) return loc;
    const prof = RJ.smooth(0, 0.05, hf) * (1 - RJ.smooth(RJ.lerp(0.35, 0.8, P.flat), 1, hf));
    const d = (0.68 * prof - (1 - cov)) / Math.max(cov, 0.05);
    return Math.max(loc, RJ.clamp(d * 1.6, 0, 1));
  };
  /** CPU mirror of the shader's placed-cumulus outline (no noise). */
  function localAt(p, pad) {
    let best = 0;
    const ext = 60 * (pad - 1);
    for (const c of C.locals) {
      if (p.y < c.base - ext || p.y > c.top + ext) continue;
      const r = Math.hypot(p.x - c.x, p.z - c.z) / (c.r * pad);
      if (r > 1) continue;
      const hf = RJ.clamp((p.y - c.base) / (c.top - c.base), 0, 1);
      const rad = RJ.lerp(0.82, 1, RJ.smooth(0, 0.25, hf)) * Math.sqrt(Math.max(1 - Math.pow(hf, 2.2), 0)) * (pad > 1 ? 1.15 : 1);
      const cov = 1 - RJ.smooth(rad * 0.4, Math.max(rad, 1e-3), r);
      const d = RJ.clamp((0.6 - (1 - 0.92 * cov)) / Math.max(0.92 * cov, 0.05) * 1.6, 0, 1) * c.density;
      if (d > best) best = d;
    }
    return Math.min(best, 1);
  }

  /* ---------------- placed clouds (gameplay / cinematics) ----------------
   * const h = RJ.clouds.addLocal({ x, z, r: 450, base: 350, top: 600, density: 1, life: 0 });
   *   x, z: centre (m, world, does not drift with the wind) · r: radius (m) · base/top: altitude (m)
   *   density: 0..3 (1 = normal cumulus) · life: seconds before it removes itself (0 = until removed)
   * Rendered as a volumetric cumulus by the raymarch (the 8 nearest to the camera); the CPU density queries
   * (in-cloud whiteout, buffet) see all of them. The handle's fields may be edited live (move it, grow it).
   * RJ.clouds.removeLocal(h) removes one; RJ.clouds.clearLocal() removes all. Not drawn on "low" quality. */
  C.locals = [];
  let lid = 0;
  C.addLocal = function (o) {
    o = o || {};
    const r = Math.max(40, +o.r || 400), base = o.base != null ? +o.base : 350;
    const h = {
      id: ++lid, x: +o.x || 0, z: +o.z || 0, r, base, top: Math.max(base + 40, o.top != null ? +o.top : base + r * 0.7),
      density: RJ.clamp(o.density != null ? +o.density : 1, 0, 3), life: +o.life || 0, seed: (lid * 0.618034) % 1
    };
    C.locals.push(h);
    return h;
  };
  C.removeLocal = function (h) {
    const i = C.locals.findIndex((c) => c === h || c.id === h);
    if (i < 0) return false;
    C.locals.splice(i, 1); return true;
  };
  C.clearLocal = () => { C.locals.length = 0; };
  /** Density of the placed clouds alone (for the billboard fallback's whiteout query). */
  C.localDensityAt = (p, pad = 1) => (C.locals.length ? localAt(p, pad) : 0);
  /** Fraction of sunlight blocked above ground point (x, z), same model as the GPU cloud shadows. */
  C.shadowAt = function (x, z) {
    const W = RJ.world, sd = W.lightDir || W.sunDir, sy = Math.max(sd.y, 0.12), mid = C.layer().mid;
    const w = C.weatherAt(x + sd.x / sy * mid, z + sd.z / sy * mid);
    const cov = RJ.clamp(w.r * 1.12 + C.p.cov - 0.08 + C.stormAt(x + sd.x / sy * mid, z + sd.z / sy * mid, w) * 0.6, 0, 1);
    return RJ.smooth(0.3, 0.62, cov);
  };

  /* ---------------- per-frame render ---------------- */
  const _v = new THREE.Vector3();
  C.render = function (renderer, camera, sceneRT, dt) {
    const q = C.q, U = C.U, W = RJ.world;
    const w = Math.max(64, Math.min(q.maxW, Math.round(sceneRT.width * q.scale)));
    const h = Math.max(36, Math.round(w * sceneRT.height / sceneRT.width));
    if (C.rt.width !== w || C.rt.height !== h) { C.rt.setSize(w, h); C.hist.forEach((t) => t.setSize(w, h)); C.fresh = true; }
    if (C.rtLin.width !== sceneRT.width || C.rtLin.height !== sceneRT.height) C.rtLin.setSize(sceneRT.width, sceneRT.height);
    U.tDepth.value = sceneRT.depthTexture;
    U.tLin.value = C.rtLin.texture;
    U.invProj.value.copy(camera.projectionMatrixInverse);
    U.camWorld.value.copy(camera.matrixWorld);
    U.camPos.value.copy(camera.position);
    U.camNear.value = camera.near; U.camFar.value = camera.far;
    const P = C.p, L = C.layer();
    U.slab.value.set(L.base, L.top, L.stormTop, 45000);
    U.wx.value.set(P.cov, P.den, P.storm, P.flat);
    U.sq.value.set(C.sqDir[0], C.sqDir[1], (C.sqBase || 0) + (C.sqOff || 0), 3200);
    const Wx = RJ.weather;
    U.rn.value.set(Wx && Wx.shafts ? Math.max(0, L.base - 1600) : L.base, Wx ? Wx.shafts : 0, P.sq || 0, 0);
    // placed cumulus: the 8 nearest to the camera; the march slab grows to include them
    let lo = Math.min(L.base, U.rn.value.x), hi = ceilTop();
    const cp = camera.position, near = C.locals.length > 8 ? C.locals.slice().sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z)) : C.locals;
    let n = 0;
    for (const c of near) {
      if (n >= 8) break;
      if (Math.hypot(c.x - cp.x, c.z - cp.z) - c.r > 40000 || c.density <= 0) continue;
      U.lcA.value[n].set(c.x, c.z, c.r, c.density); U.lcB.value[n].set(c.base, c.top, c.seed, 0); n++;
      lo = Math.min(lo, c.base); hi = Math.max(hi, c.top);
    }
    U.lcN.value = n;
    U.wt.value.set((P.tow || 0) * (1 - P.flat), hi, lo, 0);
    if (Wx && Wx.bolt) U.fl.value.set(Wx.bolt.fx, Wx.bolt.fy, Wx.bolt.fz, Wx.bolt.glow); else U.fl.value.w = 0;
    const wo = W.windOff || { x: 0, y: 0 };
    U.wmap.value.set(wo.x, wo.y, 1 / WMS, 1 / SHAPE_TILE);
    U.time.value += dt || 0.016;
    // light: sun radiance plus sky ambient (warm at sunset, dim at night)
    U.sunDir.value.copy(W.lightDir || W.sunDir);
    const sunUp = W.night ? 0.9 : RJ.smooth(-5, 4, W.sunElev);
    U.sunCol.value.copy(W.sun.color).multiplyScalar((W.sunIntensity || 1) * 1.05 * sunUp + 0.02);
    // daylight and twilight: the sun's colour where the clouds actually are (redder, and still shining
    // on the clouds for a few minutes after the ground below has gone into shadow)
    if (W.cloudSun && !W.night) {
      // hue from the transmittance at cloud height; brightness follows the scene's sun, plus an afterglow term
      // that keeps the cloud layer lit (pink/red) after the sun has set for the ground
      const T = W.cloudSun, m = Math.max(T[0], T[1], T[2], 1e-4);
      const k = (W.sunIntensity || 1) * 1.05 * sunUp + (W.sunElev < 2 ? Math.min(m, 0.6) * RJ.smooth(-6, 0, W.sunElev) * 0.9 * (1 - sunUp) : 0);
      U.sunCol.value.setRGB(T[0] / m * k + 0.02, T[1] / m * k + 0.02, T[2] / m * k + 0.02);
    }
    const sky = W.skyMat.uniforms;
    U.ambTop.value.copy(sky.top.value).lerp(sky.horizon.value, 0.35).multiplyScalar(0.95);
    U.ambBot.value.copy(sky.horizon.value).multiplyScalar(0.5).lerp(W.hemi.groundColor, 0.25);
    U.fogCol.value.copy(W.horizonColor || sky.horizon.value);
    U.fogDen.value = (W.atmo.params.x || 9e-5) * Math.exp(-L.mid / 2300) * 1.4;
    // shockwave holes (stored relative to the wind drift)
    for (let i = 0; i < 2; i++) {
      const hu = W.cloudMat && W.cloudMat.uniforms.holes.value[i];
      if (hu && hu.w > 1) U.holes.value[i].set(hu.x + wo.x, hu.y, hu.z + wo.y, hu.w); else U.holes.value[i].set(0, 0, 0, 0);
    }
    // 0) linear depth copy
    C.quad.material = C.linMat;
    renderer.setRenderTarget(C.rtLin);
    renderer.render(C.qScene, C.qCam);
    // 1) raymarch at low resolution
    C.quad.material = C.marchFor(q);
    renderer.setRenderTarget(C.rt);
    renderer.render(C.qScene, C.qCam);
    // 2) temporal resolve into the history buffer (reset after camera cuts and teleports)
    const jump = camera.position.distanceTo(C.prevPos) > 400 * Math.max(dt || 0.016, 0.016) * 60 / 60 + 300;
    U.frame.value = (U.frame.value + 1) % 64;
    U.tCur.value = C.rt.texture;
    U.tHist.value = C.hist[C.hi].texture;
    U.prevVP.value.copy(C.prevVP);
    U.histW.value = C.fresh || jump ? 0 : 0.86;
    const out = C.hist[1 - C.hi];
    C.quad.material = C.resolveMat;
    renderer.setRenderTarget(out);
    renderer.render(C.qScene, C.qCam);
    C.hi = 1 - C.hi; C.fresh = false;
    C.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    C.prevPos.copy(camera.position);
    // 3) depth-aware upsample, blended over the HDR scene: dst = cloud + dst * transmittance
    U.tCloud.value = out.texture;
    U.lowRes.value.set(w, h);
    C.quad.material = C.comp;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(sceneRT);
    renderer.render(C.qScene, C.qCam);
    renderer.autoClear = ac;
    void _v;
  };
})(window.RJ);
