/* Jet City — exterior aircraft lighting (agent 6).
 *
 * Every airframe gets one THREE.Points cloud (one draw call) holding its lamps, drawn as additive glow points
 * whose size never drops below a few pixels, so a jet's lights read from kilometres away at dusk and night:
 *   - position lights: red port wingtip, green starboard wingtip, white tail (steady; faint by day)
 *   - anti-collision: white wingtip/tail strobes (double flash) and red rotating beacons top and bottom
 *   - landing/taxi lights on the nose gear (and wing roots of heavies), on only with the gear down, brightest
 *     seen from ahead, plus a faint beam cone at night
 *   - nozzle glow: the hot nozzle interior seen from behind, dull red at military power, white-hot in afterburner
 * The lamps are placed by ray casting the visible airframe (the procedural skin, then again on the glTF model
 * once models.js has fitted it), so they sit on the real wingtips, spine, belly and tail cone.
 * Animation runs in the Points' onBeforeRender (no per-frame hook needed); it also drives aircraft.js's small
 * strobe lamp spheres (U.nav.strobe) so lamp and glow flash together. */
(function (RJ) {
  "use strict";
  const KIND = { nav: 0, strobe: 1, beacon: 2, landing: 3, nozzle: 4, tailStrobe: 5 };
  const NO_LIGHTS = { car: 1 };
  const VS = [
    "attribute vec3 color; attribute float aKind; attribute float aSize; attribute float aPhase;",
    "uniform float uTime, uNight, uGear, uHeat, uAB, uStrobe, uTailStrobe, uPx, uRange;",
    "varying vec3 vCol; varying float vStar;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  float dist = max(0.5, -mv.z);",
    "  vec3 toCam = normalize(-mv.xyz);",
    "  vec3 fwd = normalize(mat3(modelViewMatrix) * vec3(0.0, 0.0, -1.0));",
    "  float face = dot(fwd, toCam);",
    "  float I = 0.0; float minPx = 1.0; float range = uRange; vStar = 0.0;",
    "  if (aKind < 0.5) { I = mix(0.22, 1.0, uNight); minPx = mix(1.2, 3.2, uNight); }",                    // position lights
    "  else if (aKind < 1.5) { I = uStrobe * mix(1.6, 2.6, uNight); minPx = mix(2.5, 5.0, uNight); range *= 1.8; vStar = 1.0; }", // wingtip strobes
    "  else if (aKind < 2.5) {",                                                                                  // rotating beacon
    "    float b = pow(max(0.0, sin(6.2832 * (uTime * 0.95 + aPhase))), 5.0);",
    "    I = b * mix(0.7, 1.6, uNight); minPx = mix(1.5, 4.0, uNight) * (0.4 + 0.6 * b); range *= 1.3; }",
    "  else if (aKind < 3.5) {",                                                                                  // landing / taxi
    "    float dirk = 0.12 + 0.88 * pow(max(0.0, face), 6.0);",
    "    I = uGear * dirk * mix(0.9, 2.4, uNight); minPx = mix(1.5, 4.5, uNight) * uGear * (0.3 + 0.7 * dirk); range *= 1.2; vStar = dirk * uNight; }",
    "  else if (aKind < 4.5) {",                                                                                  // nozzle interior
    "    float aft = smoothstep(0.05, 0.85, -face);",
    "    I = aft * (uHeat * 0.9 + uAB * 1.4) * mix(0.6, 1.0, uNight); minPx = 0.0; range *= 0.35; }",
    "  else { I = uTailStrobe * mix(1.2, 2.2, uNight); minPx = mix(2.0, 4.0, uNight); range *= 1.5; vStar = 0.6; }", // tail strobe
    "  I *= 1.0 - smoothstep(range * 0.55, range, dist);",
    "  vec3 col = color;",
    "  if (aKind > 3.5 && aKind < 4.5) col = mix(vec3(1.0, 0.28, 0.06), vec3(1.0, 0.72, 0.55), clamp(uAB, 0.0, 1.0));",
    "  float px = aSize * uPx / dist;",
    "  float ps = clamp(max(px, minPx), 0.0, 96.0);",
    // a lamp smaller than its minimum footprint keeps its energy: dim it as it is blown up to minPx
    "  float energy = px >= minPx ? 1.0 : mix(0.35, 1.0, px / max(minPx, 1e-3));",
    "  vCol = col * I * energy;",
    "  gl_PointSize = I > 0.003 ? ps : 0.0;",
    "  gl_Position = projectionMatrix * mv;",
    "  if (I <= 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
    "}"
  ].join("\n");
  const FS = [
    "varying vec3 vCol; varying float vStar;",
    "void main() {",
    "  vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);",
    "  if (r2 > 1.0) discard;",
    "  float g = exp(-r2 * 4.0) * 0.55 + exp(-r2 * 28.0) * 1.6;",
    // strobes and landing lights flare into a short horizontal/vertical star
    "  float star = (exp(-abs(q.y) * 40.0) + exp(-abs(q.x) * 40.0)) * (1.0 - sqrt(r2)) * 0.8 * vStar;",
    "  gl_FragColor = vec4(vCol * (g + star), 1.0);",
    "}"
  ].join("\n");
  const BEAM_VS = "varying float vT; varying float vF; void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }";
  const BEAM_FS = "uniform float uK; varying float vT; varying float vF; void main(){ float a = pow(vT, 2.2) * pow(vF, 1.5) * uK; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0); }";

  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _sz = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  let frameT = -1, night = 0;
  function nightK() {
    const now = performance.now();
    if (now !== frameT) {
      frameT = now;
      const W = RJ.world || {};
      const el = W.sunElev != null ? W.sunElev : 30;
      let dark = 0; try { dark = W.wx ? (W.wx().dark || 0) : 0; } catch (e) { dark = 0; }
      night = Math.min(1, Math.max(RJ.smooth(9, -5, el), dark * 0.8, W.underwater ? 1 : 0));
    }
    return night;
  }

  /** First hit on `meshes` along a ray given in the airframe's local frame; returns the local point or null. */
  function hit(g, meshes, ox, oy, oz, dx, dy, dz) {
    _v.set(ox, oy, oz).applyMatrix4(g.matrixWorld);
    _d.set(dx, dy, dz).transformDirection(g.matrixWorld);
    ray.set(_v, _d); ray.near = 0; ray.far = 1e5;
    const h = ray.intersectObjects(meshes, false);
    if (!h.length) return null;
    return g.worldToLocal(h[0].point.clone());
  }

  /** Lamp layout for an airframe from its visible skin meshes (in the airframe's local frame). */
  function layout(g, a, meshes, useTips) {
    const U = g.userData, d = U.dims;
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), mm = new THREE.Matrix4();
    // wingtips: the outermost skin vertex on each side (procedural builds name them in U.tips)
    let R = null, L = null;
    if (useTips && U.tips && U.tips.length >= 2) { R = U.tips[0].clone(); L = U.tips[1].clone(); if (R.x < L.x) [R, L] = [L, R]; }
    else {
      for (const m of meshes) {
        const P = m.geometry.attributes.position; if (!P) continue;
        mm.multiplyMatrices(inv, m.matrixWorld);
        const step = Math.max(1, Math.floor(P.count / 4000));
        for (let i = 0; i < P.count; i += step) {
          _v.fromBufferAttribute(P, i).applyMatrix4(mm);
          if (!R || _v.x > R.x) R = _v.clone();
          if (!L || _v.x < L.x) L = _v.clone();
        }
      }
    }
    if (!R) { R = new THREE.Vector3(d.span * 0.48, d.minY + d.height * 0.4, (d.minZ + d.maxZ) / 2); L = R.clone(); L.x = -L.x; }
    const span = Math.max(2, R.x - L.x), len = d.len, sc = Math.max(1, span / 14);
    const midZ = d.minZ + len * 0.55, big = len * 4 + 50;
    // spine and belly: rays straight down / up on the centreline, a little aft of the middle
    const top = hit(g, meshes, 0, d.minY + big, midZ, 0, -1, 0);
    const bot = hit(g, meshes, 0, d.minY - big, midZ, 0, 1, 0);
    const cy = top && bot ? (top.y + bot.y) / 2 : d.minY + d.height * 0.35;
    // tail cone: ray from behind along the centreline; fall back to the fuselage end
    const tail = hit(g, meshes, 0, cy, d.maxZ + big, 0, 0, -1) || new THREE.Vector3(0, cy, d.maxZ - 0.2);
    const L0 = [];
    const add = (kind, p, col, size, phase) => L0.push({ kind, p, col, size, phase: phase || 0 });
    const off = 0.06 * sc;
    const heavy = a.cat === "airliner" || a.cat === "bomber" || a.cat === "civil" || a.cat === "cargo";
    add(KIND.nav, new THREE.Vector3(R.x + off, R.y, R.z - 0.25 * sc), [0.25, 1.0, 0.45], 0.28 * sc);
    add(KIND.nav, new THREE.Vector3(L.x - off, L.y, L.z - 0.25 * sc), [1.0, 0.12, 0.08], 0.28 * sc);
    add(KIND.nav, new THREE.Vector3(tail.x, tail.y, tail.z + off), [1.0, 0.97, 0.9], 0.24 * sc);
    add(KIND.strobe, new THREE.Vector3(R.x + off, R.y, R.z + 0.25 * sc), [1.0, 1.0, 1.0], 0.45 * sc);
    add(KIND.strobe, new THREE.Vector3(L.x - off, L.y, L.z + 0.25 * sc), [1.0, 1.0, 1.0], 0.45 * sc);
    if (heavy) add(KIND.tailStrobe, new THREE.Vector3(tail.x, tail.y + 0.1 * sc, tail.z + off * 2), [1.0, 1.0, 1.0], 0.4 * sc);
    if (top) add(KIND.beacon, top.add(_v.set(0, off * 1.5, 0)), [1.0, 0.08, 0.04], 0.35 * sc, 0);
    if (bot) add(KIND.beacon, bot.add(_v.set(0, -off * 1.5, 0)), [1.0, 0.08, 0.04], 0.35 * sc, 0.5);
    // landing / taxi lights: on the nose gear strut (gear legs are procedural on every model), wing roots on heavies
    const G = U.gear, nose = G && G.legs.find((l) => l.nose);
    let land = null;
    if (nose) {
      const gh = d.gearH || 1.5;
      land = new THREE.Vector3(nose.grp.position.x, nose.grp.position.y - gh * 0.45, nose.grp.position.z - 0.25);
      add(KIND.landing, land, [1.0, 0.95, 0.85], 0.42 * Math.max(1, sc * 0.7));
      if (heavy) for (const s of [1, -1]) {
        const p = hit(g, meshes, s * span * 0.16, d.minY - big, d.minZ + len * 0.42, 0, 1, 0);
        if (p) add(KIND.landing, p.add(_v.set(0, -off, -off)), [1.0, 0.95, 0.85], 0.5 * sc);
      }
    }
    // nozzle interiors (the procedural nozzle positions; the glTF airframes are fitted onto the same tail)
    for (const f of U.flames || []) {
      if (f.small || f.rocket) continue;
      add(KIND.nozzle, new THREE.Vector3(f.flame.position.x, f.flame.position.y, f.flame.position.z - 0.05), [1, 0.4, 0.1], f.r * 1.25);
    }
    return { lamps: L0, land, span, len, cy };
  }

  function geometryFor(lamps) {
    const n = lamps.length, P = new Float32Array(n * 3), C = new Float32Array(n * 3), K = new Float32Array(n), S = new Float32Array(n), H = new Float32Array(n);
    lamps.forEach((l, i) => { l.p.toArray(P, i * 3); C.set(l.col, i * 3); K[i] = l.kind; S[i] = l.size; H[i] = l.phase; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(K, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(S, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(H, 1));
    return geo;
  }

  /** Strobe pattern: a double flash (airliners every 1.0 s, military jets every 1.3 s); the tail strobe fires once. */
  function strobeAt(t, period) {
    const u = ((t % period) + period) % period;
    const k = (a, b) => (u >= a && u < b ? 1 - (u - a) / (b - a) * 0.5 : 0);
    return Math.max(k(0, 0.065), k(0.17, 0.235));
  }

  function build(g, a, meshes, useTips) {
    const U = g.userData;
    const lay = layout(g, a, meshes, useTips);
    const heavy = a.cat === "airliner" || a.cat === "bomber" || a.cat === "civil" || a.cat === "cargo";
    const uni = {
      uTime: { value: 0 }, uNight: { value: 0 }, uGear: { value: 0 }, uHeat: { value: 0 }, uAB: { value: 0 },
      uStrobe: { value: 0 }, uTailStrobe: { value: 0 }, uPx: { value: 500 }, uRange: { value: 9000 }
    };
    const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(geometryFor(lay.lamps), mat);
    pts.frustumCulled = false; pts.renderOrder = 12; pts.name = "rjAcLights";
    pts.layers.set(RJ.LATE != null ? RJ.LATE : 0);
    // landing-light beam: an open cone reaching ahead and slightly down, only at night with the gear down
    let beam = null, bu = null;
    if (lay.land) {
      const L = Math.min(120, 35 + lay.len * 1.5), rad = L * 0.16;
      const cg = new THREE.ConeGeometry(rad, L, 20, 1, true);
      // ConeGeometry: apex at +y, uv.y = 1 at the apex; put the apex at the lamp, pointing forward (-z)
      cg.translate(0, -L / 2, 0); cg.rotateX(-Math.PI / 2 - 0.07);
      bu = { uK: { value: 0 } };
      beam = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: bu, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      beam.position.copy(lay.land); beam.visible = false; beam.frustumCulled = false; beam.renderOrder = 7; beam.name = "rjLandingBeam";
      beam.layers.set(RJ.LATE != null ? RJ.LATE : 0);
      g.add(beam);
    }
    const phase = Math.random() * 10, period = heavy ? 1.0 : 1.3, beaconPhase = Math.random();
    pts.onBeforeRender = function (renderer, scene, camera) {
      const t = performance.now() * 0.001 + phase;
      const nk = nightK();
      const G = U.gear, gear = G ? RJ.smooth(0.55, 0.95, G.t) : 0;
      const metal = U.materials && U.materials.metal;
      const heat = metal ? Math.min(1, metal.emissive.r / 0.9 / 0.8) : 0;
      let ab = 0; for (const f of U.flames || []) if (f.mat && f.mat.uniforms && f.mat.uniforms.ab) ab = Math.max(ab, f.mat.uniforms.ab.value);
      const st = strobeAt(t, period);
      uni.uTime.value = t + beaconPhase; uni.uNight.value = nk; uni.uGear.value = gear;
      uni.uHeat.value = heat; uni.uAB.value = ab; uni.uStrobe.value = st;
      uni.uTailStrobe.value = (t + period * 0.5) % period < 0.07 ? 1 : 0;
      renderer.getDrawingBufferSize(_sz);
      uni.uPx.value = camera.isPerspectiveCamera ? _sz.y / (2 * Math.tan(camera.fov * Math.PI / 360) * (camera.zoom ? 1 / camera.zoom : 1)) : _sz.y * 0.5;
      // haze: lights carry further in clear air at night
      uni.uRange.value = 4500 + nk * 11000;
      // the airframe's own strobe lamps (aircraft.js) flash with the glow
      if (U.nav && U.nav.strobe) U.nav.strobe.color.setScalar(st * 5);
      if (beam) { const k = gear * nk; beam.visible = k > 0.02; bu.uK.value = k * 0.07; }
    };
    g.add(pts);
    const old = U.acLights;
    if (old) { // re-placed on the glTF model: swap out the procedural layout
      g.remove(old.pts); old.pts.geometry.dispose(); old.pts.material.dispose();
      if (old.beam) { g.remove(old.beam); old.beam.geometry.dispose(); old.beam.material.dispose(); }
      if (U.nav && U.nav.meshes) { const i = U.nav.meshes.indexOf(old.pts); if (i >= 0) U.nav.meshes.splice(i, 1); const j = U.nav.meshes.indexOf(old.beam); if (j >= 0) U.nav.meshes.splice(j, 1); }
      pts.visible = old.pts.visible;
    }
    U.acLights = { pts, beam, lamps: lay.lamps.length };
    if (U.nav && U.nav.meshes) { U.nav.meshes.push(pts); if (beam) U.nav.meshes.push(beam); }
    return U.acLights;
  }

  RJ.acLights = {
    KIND,
    /** Procedural airframe (aircraft.js, after the build): lamps on its visible skin. */
    attach(g, a) {
      if (!a || NO_LIGHTS[a.cat]) return null;
      try {
        const M = g.userData.materials || {}, skin = new Set([M.body, M.trim, M.facet, M.accent].filter(Boolean)), meshes = [];
        g.traverse((m) => { if (m.isMesh && skin.has(m.material)) meshes.push(m); });
        return build(g, a, meshes, true);
      } catch (e) { console.warn("aircraft lights unavailable", e && e.message); return null; }
    },
    /** glTF airframe (models.js, once fitted): lamps re-placed on the real model's wingtips, spine and tail. */
    refit(g, a, holder) {
      if (!a || NO_LIGHTS[a.cat] || !g.userData.acLights) return null;
      try {
        const meshes = [];
        holder.traverse((m) => { if (m.isMesh && !m.isSkinnedMesh && m.visible) { const mt = Array.isArray(m.material) ? m.material[0] : m.material; if (!mt || !mt.transparent || mt.opacity > 0.8) meshes.push(m); } });
        if (!meshes.length) return null;
        return build(g, a, meshes, false);
      } catch (e) { console.warn("aircraft lights refit failed", e && e.message); return null; }
    }
  };
})(window.RJ);
