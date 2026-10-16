/* Ridgeline Jets — volumetric clouds.
 * A raymarched cloud layer rendered at reduced resolution inside the post pipeline:
 *   weather map (2D, tiling)  → where clouds are, how tall, where storms tower
 *   shape noise (3D Perlin-Worley) + detail noise (3D Worley) → billowing cumulus forms
 *   sun light march + dual-lobe phase + multiple-scattering approximation → silver linings, dark bases
 * Composited into the HDR scene with a depth-aware upsample, before transparent effects are drawn,
 * so flames and vapor in front of a cloud stay in front of it. Requires WebGL2; otherwise the
 * billboard clouds in world.js are used. The same weather map drives terrain cloud shadows and the
 * CPU-side density queries (in-cloud whiteout, buffet, sonic-boom humidity). */
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
    const cellA = makeWorley(10, 31, 2), cellB = makeWorley(20, 32, 2), storm = makeWorley(3, 33, 2);
    const R = new Float32Array(N * N), G = new Float32Array(N * N), B = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = y * N + x;
      const f = perlin3(u * 4, v * 4, 0.5, 4, 41) * 0.55 + perlin3(u * 8, v * 8, 1.5, 8, 42) * 0.3 + perlin3(u * 16, v * 16, 2.5, 16, 43) * 0.15;
      const cells = (1 - cellA(u, v, 0)) * 0.65 + (1 - cellB(u, v, 0)) * 0.35;
      R[i] = f * 0.55 + cells * 0.9;
      G[i] = perlin3(u * 3, v * 3, 7.5, 3, 44);
      B[i] = 1 - storm(u, v, 0);
    }
    normalize(R); normalize(G); normalize(B);
    for (let i = 0; i < B.length; i++) { const s = (B[i] - 0.82) / 0.14; B[i] = s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s); }
    return { R, G, B };
  }

  /* ---------------- weather presets ---------------- */
  // cov: coverage bias, base/top: layer (m), den: extinction scale, storm: tower strength, flat: 1 = stratiform deck
  const PRESETS = {
    clear: { cov: -0.32, base: 2600, top: 3700, den: 0.75, storm: 0, flat: 0.2 },
    scattered: { cov: -0.06, base: 2200, top: 3900, den: 1.0, storm: 0, flat: 0.1 },
    overcast: { cov: 0.34, base: 1700, top: 3500, den: 1.2, storm: 0, flat: 0.55 },
    storm: { cov: 0.36, base: 1300, top: 5200, den: 1.45, storm: 1, flat: 0.25 },
    cloudsea: { cov: 0.42, base: 1500, top: 2700, den: 1.1, storm: 0, flat: 0.8 }
  };
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
    "uniform float detailScale; uniform float time; uniform float frame;",
    "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 ambTop; uniform vec3 ambBot; uniform vec3 fogCol; uniform float fogDen;",
    "uniform vec4 holes[2];",
    "varying vec2 vUv;",
    "float viewZ(float d){ return (camNear * camFar) / ((camFar - camNear) * d - camFar); }",
    "vec3 rayDir(vec2 uv, out vec3 vdir){ vec4 v = invProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); vdir = normalize(v.xyz / v.w); return normalize((camWorld * vec4(vdir, 0.0)).xyz); }",
    "float sceneDist(vec2 uv, vec3 vdir){ float z = texture2D(tLin, uv).r; if (z > 59000.0) return 1e7; return z / max(-vdir.z, 1e-4); }",
    "vec2 slabT(vec3 ro, vec3 rd){",
    "  float lo = slab.x, hi = max(slab.y, slab.z);",
    "  if (abs(rd.y) < 1e-4) { if (ro.y < lo || ro.y > hi) return vec2(1.0, 0.0); return vec2(0.0, slab.w); }",
    "  float ta = (lo - ro.y) / rd.y, tb = (hi - ro.y) / rd.y;",
    "  return vec2(max(min(ta, tb), 0.0), max(ta, tb));",
    "}"
  ].join("\n");
  const MARCH = [
    COMMON,
    "float remap(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / (b - a); }",
    "float density(vec3 p, bool cheap){",
    "  vec4 w = texture2D(tWeather, (p.xz - wmap.xy) * wmap.z);",
    "  float storm = w.b * wx.z;",
    "  float cov = clamp(w.r * 1.12 + wx.x - 0.08 + storm * 0.6, 0.0, 1.0);",
    "  if (cov < 0.22) return 0.0;",
    "  float top = mix(slab.x + (slab.y - slab.x) * mix(mix(0.32, 1.0, w.g), 0.45, wx.w), slab.z, storm);",
    "  float hf = (p.y - slab.x) / max(top - slab.x, 1.0);",
    "  if (hf < 0.0 || hf > 1.0) return 0.0;",
    // flat bases, rounded tops; storms flare out into an anvil near the top
    "  float prof = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(mix(0.45, 0.8, wx.w), 1.0, hf));",
    "  prof = max(prof, storm * smoothstep(0.78, 0.9, hf) * (1.0 - smoothstep(0.93, 1.0, hf)) * 1.2);",
    "  vec3 sp = vec3(p.x - wmap.x, p.y, p.z - wmap.y) * wmap.w;",
    "  sp.y *= 1.6;",
    "  float shape = texture(tShape, sp).r;",
    "  float d = remap(shape * prof, 1.0 - cov, 1.0, 0.0, 1.0);",
    "  if (d <= 0.0) return 0.0;",
    "  if (!cheap) {",
    "    float det = texture(tDetail, vec3(p.x - wmap.x * 1.2, p.y + time * 3.0, p.z - wmap.y * 1.2) * detailScale).r;",
    "    d = remap(d, det * 0.32 * mix(1.0, 0.5, hf), 1.0, 0.0, 1.0);",
    "  }",
    "  for (int i = 0; i < 2; i++) { vec4 h = holes[i]; if (h.w > 1.0) d *= smoothstep(h.w * 0.6, h.w, distance(p, h.xyz)); }",
    "  return clamp(d, 0.0, 1.0) * mix(0.75, 1.15, hf);",
    "}",
    "float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }",
    "void main(){",
    "  vec3 vdir; vec3 rd = rayDir(vUv, vdir);",
    "  float sd = sceneDist(vUv, vdir);",
    "  vec2 tt = slabT(camPos, rd);",
    "  float t0 = tt.x, t1 = min(min(tt.y, sd), slab.w);",
    "  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }",
    "  t1 = min(t1, t0 + 32000.0);",
    "  float span = t1 - t0;",
    "  float ds = span / float(STEPS);",
    "  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + frame * 0.6180339);",
    "  float cosT = dot(rd, sunDir);",
    "  float phase = mix(hg(cosT, 0.62), hg(cosT, -0.22), 0.35) * 0.32 + 0.08;",
    "  float sigma = 0.016 * wx.y;",
    "  vec3 col = vec3(0.0); float T = 1.0; float dsum = 0.0; float wsum = 0.0;",
    // long grazing rays: dense samples near the camera, coarse far away
    "  float kq = clamp((span - 4000.0) / 12000.0, 0.0, 0.85);",
    "  float t = t0;",
    "  for (int i = 0; i < STEPS; i++) {",
    "    float u0 = (float(i) + jit) / float(STEPS), u1 = (float(i) + 1.0 + jit) / float(STEPS);",
    "    t = t0 + span * mix(u0, u0 * u0, kq); ds = span * (mix(u1, u1 * u1, kq) - mix(u0, u0 * u0, kq));",
    "    if (t > t1 || T < 0.015) break;",
    "    vec3 p = camPos + rd * t;",
    "    float dens = density(p, false);",
    "    if (dens > 0.002) {",
    "      float od = 0.0; float ls = 55.0; vec3 lp = p;",
    "      for (int k = 0; k < LSTEPS; k++) { lp += sunDir * ls; od += density(lp, true) * ls; ls *= 1.85; }",
    "      float beer = exp(-od * sigma);",
    "      float ms = exp(-od * sigma * 0.22) * 0.45;",
    "      float powder = 1.0 - exp(-dens * 4.0);",
    "      float hf = clamp((p.y - slab.x) / max(slab.y - slab.x, 1.0), 0.0, 1.0);",
    "      vec3 amb = mix(ambBot, ambTop, hf) * (0.55 + 0.45 * hf);",
    "      vec3 S = sunCol * (max(beer, ms) * mix(0.6, 1.0, powder)) * phase * 6.0 + amb;",
    "      float st = dens * sigma;",
    "      float Ts = exp(-st * ds);",
    "      col += T * S * (1.0 - Ts);",
    "      dsum += T * (1.0 - Ts) * t; wsum += T * (1.0 - Ts);",
    "      T *= Ts;",
    "    }",
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
    for (let i = 0; i < WN * WN; i++) { wdata[i * 4] = Wm.R[i] * 255; wdata[i * 4 + 1] = Wm.G[i] * 255; wdata[i * 4 + 2] = Wm.B[i] * 255; wdata[i * 4 + 3] = 255; }
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
        tCloud: { value: null }, lowRes: { value: new THREE.Vector2(4, 4) },
        frame: { value: 0 }, tCur: { value: null }, tHist: { value: null }, prevVP: { value: new THREE.Matrix4() }, histW: { value: 0 }
      };
      C.U = U;
      C.marchMats = {};
      C.marchFor = (q) => {
        const key = q.steps + "/" + q.lsteps;
        if (!C.marchMats[key]) C.marchMats[key] = mkMat(MARCH, U, { STEPS: q.steps, LSTEPS: q.lsteps });
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

  /** Quality tiers: render-target scale/cap and march steps. */
  const QUAL = {
    low: null,
    medium: { scale: 0.34, maxW: 620, steps: 34, lsteps: 4 },
    high: { scale: 0.45, maxW: 860, steps: 46, lsteps: 5 },
    ultra: { scale: 0.55, maxW: 1180, steps: 62, lsteps: 6 }
  };
  C.active = () => C.ok && C.enabled;
  C.setQuality = function (q) {
    C.q = QUAL[q] || null; C.fresh = true;
    C.enabled = C.ok && !!C.q && RJ.settings.volClouds !== false && RJ.post.enabled;
  };

  C.setWeather = function (id) {
    C.p = Object.assign({}, PRESETS[id] || PRESETS.scattered);
    C.p.cov += (RJ.settings.clouds - 1) * 0.25;
  };
  C.layer = () => ({ base: C.p.base, top: C.p.top, stormTop: C.p.storm > 0 ? 11000 : C.p.top, mid: (C.p.base + C.p.top) / 2 });

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
    return { r: S(Wm.R), g: S(Wm.G), b: S(Wm.B) };
  };
  /** Approximate cloud density (0..1) at p, mirroring the shader without the 3D noise. pad > 1 also counts nearby air. */
  C.densityAt = function (p, pad = 1) {
    if (!C.weather) return 0;
    const P = C.p;
    const lo = P.base - 160 * (pad - 1), hiMax = (P.storm > 0 ? 11000 : P.top) + 160 * (pad - 1);
    if (p.y < lo || p.y > hiMax) return 0;
    const w = C.weatherAt(p.x, p.z);
    const storm = w.b * P.storm;
    const cov = RJ.clamp(w.r * 1.12 + P.cov - 0.08 + storm * 0.6 + (pad - 1) * 0.12, 0, 1);
    if (cov < 0.22) return 0;
    const top = RJ.lerp(P.base + (P.top - P.base) * RJ.lerp(RJ.lerp(0.32, 1, w.g), 0.45, P.flat), 11000, storm) + 160 * (pad - 1);
    const hf = (p.y - lo) / Math.max(top - lo, 1);
    if (hf < 0 || hf > 1) return 0;
    const prof = RJ.smooth(0, 0.07, hf) * (1 - RJ.smooth(RJ.lerp(0.45, 0.8, P.flat), 1, hf));
    const d = (0.68 * prof - (1 - cov)) / Math.max(cov, 0.05);
    return RJ.clamp(d * 1.6, 0, 1);
  };
  /** Fraction of sunlight blocked above ground point (x, z), same model as the GPU cloud shadows. */
  C.shadowAt = function (x, z) {
    const W = RJ.world, sd = W.lightDir || W.sunDir, sy = Math.max(sd.y, 0.12), mid = C.layer().mid;
    const w = C.weatherAt(x + sd.x / sy * mid, z + sd.z / sy * mid);
    const cov = RJ.clamp(w.r * 1.12 + C.p.cov - 0.08 + w.b * C.p.storm * 0.6, 0, 1);
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
    const wo = W.windOff || { x: 0, y: 0 };
    U.wmap.value.set(wo.x, wo.y, 1 / WMS, 1 / SHAPE_TILE);
    U.time.value += dt || 0.016;
    // light: sun radiance plus sky ambient (warm at sunset, dim at night)
    U.sunDir.value.copy(W.lightDir || W.sunDir);
    const sunUp = W.night ? 0.9 : RJ.smooth(-5, 4, W.sunElev);
    U.sunCol.value.copy(W.sun.color).multiplyScalar((W.sunIntensity || 1) * 1.05 * sunUp + 0.02);
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
