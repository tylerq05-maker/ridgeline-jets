/* Jet City — real satellite imagery on the terrain around each city.
 *
 * One pre-baked mosaic per city (assets/sat/<id>.jpg, Sentinel-2 cloudless 2016 by EOX, CC BY 4.0) on a plain
 * lat/lon grid, so world (x, z) maps to texture uv with one affine transform. Only the nearest city's mosaic is
 * resident: it loads when the player comes within ~12 km of the city's edge, fades in, and is disposed on leaving.
 * The terrain, far-terrain and NYC street materials blend it over their procedural colours through the shared
 * uniforms below (RJ.sat.U) and the GLSL helper rjSat(); water pixels in the imagery are left to the procedural
 * ground and the game's own water, and the image fades out at the edges of each city zone.
 *
 *  · NYC and SF are georeferenced 1:1 (terrain-gen.js NY.toWorld / the SF DEM frame), so imagery lines up with
 *    their real coastlines.
 *  · Dubai, Tokyo, Rio, Hong Kong and Chicago are procedural sites on the game's own coast (cities.js), not at their
 *    real geography: the imagery is centred on the real downtown, rotated so the real direction of the sea matches
 *    the site's sea direction, and shifted so the real shoreline sits at the site's coast distance.
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  const SAT = (RJ.sat = {});
  const ATTRIBUTION = "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)";
  SAT.attribution = ATTRIBUTION;
  SAT.base = "assets/sat/";
  SAT.enabled = true;

  let blank = null;
  function blankTex() { if (!blank) { blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); blank.needsUpdate = true; } return blank; }
  // shared uniforms (the same objects are handed to every material that shows the imagery)
  SAT.U = {
    satTex: { value: null }, satU: { value: new THREE.Vector3() }, satV: { value: new THREE.Vector3() },
    satC: { value: new THREE.Vector4(0, 0, 1, 2) }, satOn: { value: 0 },
    // x gain, y saturation, z close-range detail keep, w water fallback
    satTone: { value: new THREE.Vector4(0.97, 0.85, 0.0, 1.0) }
  };
  SAT.attach = function (uniforms) { if (!SAT.U.satTex.value) SAT.U.satTex.value = blankTex(); return Object.assign(uniforms, SAT.U); };

  SAT.GLSL = [
    "uniform sampler2D satTex; uniform vec3 satU; uniform vec3 satV; uniform vec4 satC; uniform float satOn; uniform vec4 satTone;",
    "vec3 rjSat(vec3 base, vec2 xz) {",
    "  if (satOn < 0.002) return base;",
    "  vec2 uv = vec2(dot(satU, vec3(xz, 1.0)), dot(satV, vec3(xz, 1.0)));",
    "  vec2 eg = min(uv, 1.0 - uv);",
    "  float w = satOn * smoothstep(0.0, 0.04, min(eg.x, eg.y)) * (1.0 - smoothstep(satC.z, satC.w, length(xz - satC.xy)));",
    "  if (w < 0.002) return base;",
    "  vec3 s = texture2D(satTex, uv).rgb;",
    "  float l = dot(s, vec3(0.299, 0.587, 0.114));",
    // open water in Sentinel-2 cloudless is dark and blue-dominant: leave it to the procedural ground / water system
    "  float wat = smoothstep(0.015, 0.06, s.b - s.r) * smoothstep(0.82, 0.92, s.b / max(s.g, 0.01)) * (1.0 - smoothstep(0.3, 0.42, l));",
    "  s = mix(vec3(l), s, satTone.y) * satTone.x;",
    "  return mix(base, s, w * (1.0 - wat * satTone.w));",
    "}"
  ].join("\n");

  /* ---------------- city frames: world (x, z) -> [lat, lon] ---------------- */
  function frames() {
    const gen = RJ.world && RJ.world.gen, F = {};
    if (!gen) return F;
    const NY = gen.nyc;
    if (NY) F.nyc = { cx: NY.cx, cz: NY.cz, r0: 19500, r1: 22800, geo: (x, z) => [NY.lat0 + (NY.ez - z) / NY.mN, NY.lon0 + (x - NY.ex) / NY.mE] };
    const SFZ = gen.sfZone;
    if (SFZ) F.sf = { cx: SFZ.x, cz: SFZ.z, r0: 19000, r1: 22500, geo: (x, z) => [37.815 + (SFZ.z - z) / 111000, -122.44 + (x - SFZ.x) / 87979.5] };
    const CI = RJ.cities;
    if (CI && CI.sites && SAT.meta) for (const id in CI.sites) {
      const S = CI.sites[id], M = SAT.meta.cities[id];
      if (!S || !M || !M.coast) continue;
      // real sea direction (east, north) and the coast-axis to its left, as the game builds px/pz from sx/sz
      const b = M.seaBearing * Math.PI / 180, ae = Math.sin(b), an = Math.cos(b);
      const cosL = Math.cos(M.coast[0] * Math.PI / 180), d = S.coast || 4000;
      const aLat = M.coast[0] - an * d / 111320, aLon = M.coast[1] - ae * d / (111320 * cosL);
      const R = (CI.SPEC && CI.SPEC[id] && CI.SPEC[id].R) || 3000;
      const r0 = Math.min(Math.max(R + 2500, S.metroCap || 0), 9000);
      F[id] = {
        cx: S.x, cz: S.z, r0, r1: r0 + 2200,
        geo: (x, z) => {
          const dx = x - S.x, dz = z - S.z, s = dx * S.sx + dz * S.sz, p = dx * S.px + dz * S.pz;
          const e = s * ae + p * an, n = s * an - p * ae; // p axis in (east, north) = (an, -ae)
          return [aLat + n / 111320, aLon + e / (111320 * cosL)];
        }
      };
    }
    return F;
  }

  // affine world -> uv from three samples (the frames are affine, the mosaics linear in lat/lon)
  function affine(f, M) {
    const uv = (x, z) => { const [la, lo] = f.geo(x, z); return [(lo - M.w) / (M.e - M.w), (la - M.s) / (M.n - M.s)]; };
    const o = uv(f.cx, f.cz), a = uv(f.cx + 1000, f.cz), b = uv(f.cx, f.cz + 1000);
    const du = [(a[0] - o[0]) / 1000, (b[0] - o[0]) / 1000], dv = [(a[1] - o[1]) / 1000, (b[1] - o[1]) / 1000];
    SAT.U.satU.value.set(du[0], du[1], o[0] - du[0] * f.cx - du[1] * f.cz);
    SAT.U.satV.value.set(dv[0], dv[1], o[1] - dv[0] * f.cx - dv[1] * f.cz);
    SAT.U.satC.value.set(f.cx, f.cz, f.r0, f.r1);
  }

  /* ---------------- lazy loading ---------------- */
  SAT.meta = null; SAT.active = null; SAT.loading = null; SAT.stats = { loads: 0, ms: 0 };
  let metaReq = null, acc = 1, fadeT = 0;
  function loadMeta() {
    if (metaReq || !window.fetch) return;
    metaReq = fetch(SAT.base + "index.json").then((r) => r.ok ? r.json() : null).then((m) => { SAT.meta = m; }).catch(() => { SAT.meta = null; });
  }
  function unload() {
    if (SAT.active && SAT.active.tex) SAT.active.tex.dispose();
    SAT.active = null; SAT.U.satOn.value = 0; SAT.U.satTex.value = blankTex();
  }
  function load(id, f) {
    const M = SAT.meta.cities[id], t0 = performance.now(), token = (SAT.loading = { id });
    new THREE.TextureLoader().load(SAT.base + M.file, (tex) => {
      if (SAT.loading !== token) { tex.dispose(); return; }
      SAT.loading = null;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      const r = RJ.world && RJ.world.renderer; tex.anisotropy = r && r.capabilities ? Math.min(4, r.capabilities.getMaxAnisotropy()) : 1;
      unload();
      SAT.active = { id, tex, f }; SAT.U.satTex.value = tex; affine(f, M); fadeT = 0;
      SAT.stats.loads++; SAT.stats.ms = Math.round(performance.now() - t0);
      RJ.emit && RJ.emit("satready", id);
    }, undefined, () => { if (SAT.loading === token) SAT.loading = { id, failed: true }; });
  }
  /** Called every frame by world.js with the streaming focus. */
  SAT.update = function (dt, focus) {
    // wall-clock pacing: the game clamps dt, and a slow frame must not stall loading
    const now = performance.now(), rdt = Math.min(0.5, (now - (SAT._last || now)) / 1000); SAT._last = now;
    if (SAT.active && fadeT < 1) { fadeT = Math.min(1, fadeT + rdt / 1.5); SAT.U.satOn.value = fadeT * fadeT * (3 - 2 * fadeT); }
    acc += rdt; if (acc < 0.75 || !focus) return; acc = 0;
    if (!SAT.enabled) { if (SAT.active) unload(); return; }
    if (!SAT.meta) { loadMeta(); return; }
    const F = frames();
    let best = null, bd = Infinity;
    for (const id in F) { if (!SAT.meta.cities[id]) continue; const d = Math.hypot(focus.x - F[id].cx, focus.z - F[id].cz) - F[id].r1; if (d < bd) { bd = d; best = id; } }
    const cur = SAT.active && SAT.active.id;
    SAT.pick = { best, bd: Math.round(bd), cur, loading: SAT.loading && SAT.loading.id };
    if (cur && (cur !== best || bd > 16000)) unload();
    if (best && bd < 12000 && !SAT.active && !(SAT.loading && (SAT.loading.id === best))) load(best, F[best]);
    // a site may be re-planned (new world seed): keep the transform current
    if (SAT.active && F[SAT.active.id]) affine(F[SAT.active.id], SAT.meta.cities[SAT.active.id]);
  };
  /* ---------------- land use (procedural cities): keep buildings off imagery water and woods ---------------- */
  SAT.lu = null;
  if (window.fetch) fetch(SAT.base + "landuse.json").then((r) => r.ok ? r.json() : null).then((j) => {
    if (!j) return; SAT.lu = {};
    for (const id in j) { const b = atob(j[id].data), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); SAT.lu[id] = { n: j[id].n, a }; }
  }).catch(() => {});
  if (window.fetch) loadMeta();
  /** A city-generator helper: (x, z) -> 0 built/bare, 1 vegetation, 2 water, or -1 (no data / outside the mosaic). */
  SAT.landUseFn = function (id) {
    if (!SAT.enabled || !SAT.lu || !SAT.lu[id] || !SAT.meta || !SAT.meta.cities[id]) return null;
    const f = frames()[id]; if (!f) return null;
    const L = SAT.lu[id], M = SAT.meta.cities[id], n = L.n;
    return (x, z) => {
      const [la, lo] = f.geo(x, z), u = (lo - M.w) / (M.e - M.w), v = (M.n - la) / (M.n - M.s);
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1;
      const k = Math.floor(v * n) * n + Math.floor(u * n);
      return (L.a[k >> 2] >> ((k & 3) * 2)) & 3;
    };
  };
  SAT.reset = function () { SAT.loading = null; unload(); acc = 1; };
})();
