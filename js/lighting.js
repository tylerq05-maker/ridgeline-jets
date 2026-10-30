/* Jet City — image-based lighting and cinematic light retune (agent A).
 *
 * - Loads a CC0 Poly Haven sky HDRI (assets/env, see assets/CREDITS-A.md) with the vendored r128 RGBELoader,
 *   rotates it so its sun lines up with the game's sun, and pre-filters it with PMREMGenerator.
 * - Exposes RJ.lighting = { envMap, ready, ... } and fires RJ.emit("envready", envMap) once ready
 *   ("envchange" with the new map whenever it is re-captured for a new sun azimuth).
 * - In daylight, tracked aircraft materials reflect the HDRI (scaled to the current sky brightness); at dusk,
 *   night or in heavy weather they fall back to world.js's live sky probe (scene.environment), which matches
 *   the time of day. scene.environment itself stays owned by world.js.
 * - Retunes world.js's sun / hemisphere / grade at runtime for a more cinematic look without editing world.js:
 *   values world.js writes are treated as the base and scaled once (never compounded).
 * Everything degrades gracefully: if the loader or file is missing, the game keeps its procedural lighting. */
(function (RJ) {
  "use strict";
  const HDR_URL = "assets/env/kloofendal_48d_partly_cloudy_puresky_1k.hdr";
  const L = { envMap: null, ready: false, failed: false, sunAz: 0, skyLum: 1, active: false, cinematic: true, gain: 0.5 }; // gain: HDRI sky brightness relative to world.js sky fill (tuned by eye)
  RJ.lighting = L;

  let equi = null, envScene = null, envMesh = null, rt = null, capAz = null, hdriDir = null;
  const mats = []; // WeakRefs to aircraft materials that may take the HDRI
  const canWeak = typeof WeakRef === "function";

  /** Register an aircraft material set ({body, trim, glass, ...}) for HDRI reflections. */
  L.track = function (M) {
    if (!M) return;
    for (const k in M) {
      const m = M[k];
      if (!m || !m.isMeshStandardMaterial) continue;
      if (m.userData.rjEnvBase == null) m.userData.rjEnvBase = m.envMapIntensity;
      mats.push(canWeak ? new WeakRef(m) : m);
      if (L.active && L.envMap) applyTo(m, true, L._k || 1);
    }
  };
  /** Exclude a material set (e.g. the hangar showroom, which has its own studio environment). */
  L.untrack = function (M) {
    if (!M) return;
    for (const k in M) { const m = M[k]; if (m && m.userData) { m.userData.rjNoHdri = true; if (m.envMap === L.envMap && m.envMap) { m.envMap = null; m.envMapIntensity = m.userData.rjEnvBase != null ? m.userData.rjEnvBase : m.envMapIntensity; m.needsUpdate = true; } } }
  };

  function applyTo(m, on, k) {
    if (m.userData.rjNoHdri) return;
    const want = on ? L.envMap : null;
    if (m.envMap !== want) { m.envMap = want; m.needsUpdate = true; }
    const base = m.userData.rjEnvBase != null ? m.userData.rjEnvBase : 1;
    m.envMapIntensity = on ? base * k : base;
  }
  function eachMat(fn) {
    for (let i = mats.length - 1; i >= 0; i--) {
      const m = canWeak ? mats[i].deref() : mats[i];
      if (!m) { mats.splice(i, 1); continue; }
      fn(m);
    }
  }

  /* ---------- HDRI load + analysis ---------- */
  function load() {
    if (!THREE.RGBELoader || !RJ.world || !RJ.world.renderer) { L.failed = true; return; }
    try {
      new THREE.RGBELoader().setDataType(THREE.FloatType).load(HDR_URL, (tex) => {
        try { analyse(tex); } catch (e) { L.failed = true; console.warn("HDRI analysis failed", e); }
      }, undefined, (e) => { L.failed = true; console.warn("HDRI unavailable; keeping procedural sky lighting", e); });
    } catch (e) { L.failed = true; console.warn("HDRI loader failed", e); }
  }
  function analyse(tex) {
    const img = tex.image, w = img.width, h = img.height, d = img.data;
    // clamp the sun disc (thousands of units) so the pre-filtered map has no fireflies; the direct sun is a real light
    let best = -1, bx = 0, by = 0, sum = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      if (l > best) { best = l; bx = x; by = y; }
      if (y < h / 2) { sum += Math.min(l, 6); n++; }
      if (l > 24) { const s = 24 / l; d[i] *= s; d[i + 1] *= s; d[i + 2] *= s; }
    }
    L.skyLum = Math.max(0.05, sum / Math.max(1, n));
    // direction of the HDRI sun on an unrotated SphereGeometry (u = x / w; row 0 is the top after flipY)
    const u = (bx + 0.5) / w, th = ((by + 0.5) / h) * Math.PI;
    hdriDir = new THREE.Vector3(-Math.cos(u * Math.PI * 2) * Math.sin(th), Math.cos(th), Math.sin(u * Math.PI * 2) * Math.sin(th));
    // float textures are only guaranteed to filter with NEAREST; PMREM blurs the result anyway
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    equi = tex;
    envScene = new THREE.Scene();
    envMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false }));
    envScene.add(envMesh);
    capture();
  }
  /** (Re-)filter the HDRI with its sun rotated to the game's sun azimuth. */
  function capture() {
    const W = RJ.world, sd = W.sunDir || new THREE.Vector3(0.3, 0.6, -0.7);
    const az = Math.atan2(sd.x, sd.z);
    envMesh.rotation.y = az - Math.atan2(hdriDir.x, hdriDir.z);
    envMesh.updateMatrixWorld(true);
    if (!W.pmrem) W.pmrem = new THREE.PMREMGenerator(W.renderer);
    const next = W.pmrem.fromScene(envScene, 0, 0.1, 100);
    const old = rt, first = !L.envMap;
    rt = next; capAz = az; L.sunAz = az;
    L.envMap = rt.texture; L.ready = true;
    // re-point tracked materials before releasing the previous target
    if (L.active) eachMat((m) => { if (m.envMap && m.envMap !== L.envMap && !m.userData.rjNoHdri) { m.envMap = L.envMap; m.needsUpdate = true; } });
    RJ.emit(first ? "envready" : "envchange", L.envMap);
    if (old) old.dispose();
  }

  /* ---------- cinematic retune of world.js's lights (base-tracked, never compounded) ---------- */
  const track = new WeakMap(); // world.js rebuilds W.grade each lighting pass: weak keys, no leak
  function scaled(obj, key, f) {
    if (!obj || typeof obj[key] !== "number") return;
    let t = track.get(obj); if (!t) track.set(obj, (t = {}));
    const s = t[key] || (t[key] = { out: NaN, base: 0 });
    if (obj[key] !== s.out) s.base = obj[key];
    s.out = s.base * f; obj[key] = s.out;
  }
  const C = new THREE.Color(), MOON = new THREE.Color(0.78, 0.86, 1.08);
  let lastColOut = -1;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  L.update = function (dt) {
    const W = RJ.world;
    if (!W || !W.sun || !W.hemi) return;
    if (!equi && !L.failed && !L._loading) { L._loading = true; load(); }
    const el = W.sunElev != null ? W.sunElev : 30;
    const wx = W.wx ? W.wx() : { gray: 0, dark: 0 };
    const day = smooth(4, 22, el) * (1 - Math.min(1, (wx.gray || 0) * 0.8));
    if (L.cinematic) {
      // stronger key light, slightly less fill: more modelling on the airframes, deeper shade; moonlight a touch cooler
      scaled(W.sun, "intensity", W.night ? 1.0 : 1.0 + 0.12 * day);
      scaled(W.hemi, "intensity", W.night ? 0.92 : 1.0 - 0.12 * day);
      if (W.night) {
        const hex = W.sun.color.getHex();
        if (hex !== lastColOut) { W.sun.color.multiply(MOON); lastColOut = W.sun.color.getHex(); }
      }
      if (W.grade) { scaled(W.grade, "contrast", 1.03); scaled(W.grade, "sat", 1.02); }
    }
    if (!L.ready) return;
    // re-align the HDRI's sun once the game sun has swung > 20° in azimuth (clock running)
    if (W.sunDir) { const az = Math.atan2(W.sunDir.x, W.sunDir.z); let da = Math.abs(az - capAz); if (da > Math.PI) da = Math.PI * 2 - da; if (da > 0.35) capture(); }
    // HDRI reflections only in clear-ish daylight (hysteresis so it never flickers)
    const on = L.active ? day > 0.35 : day > 0.55;
    // scale the HDRI so its sky matches world.js's current sky fill
    C.copy(W.hemi.color);
    const target = (C.r * 0.2126 + C.g * 0.7152 + C.b * 0.0722) * L.gain;
    const k = Math.min(1.4, Math.max(0.2, target / L.skyLum));
    if (on !== L.active || Math.abs(k - (L._k || 0)) > 0.02) { L.active = on; L._k = k; eachMat((m) => applyTo(m, on, k)); }
  };
})(window.RJ);
