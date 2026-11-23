/* Jet City — ribbon trails: continuous airshow smoke instead of separate puffs.
 * Each ribbon is a strip of points laid behind an emitter; every frame it is rebuilt as a camera-facing band that
 * widens as it ages, drifts with the air, frays into wisps along its length and fades out. Lit from the world's
 * sun and sky colours and fogged like everything else. One draw call per ribbon; points are capped and pooled.
 *   const r = RJ.ribbons.create({ life: 15, w0: 2.5, w1: 22, alpha: 0.6 });
 *   r.add(pos)   // call as the emitter moves (points closer than `spacing` are skipped)
 *   r.cut()      // the next add starts a new strand (smoke switched off, cut between shots)
 *   r.dispose()  // remove now; or r.release() to let it fade out and free itself
 * RJ.ribbons.update(dt, camera) runs every frame from fx.update. */
(function (RJ) {
  "use strict";
  const list = [];
  const VS = [
    "attribute float aA; attribute float aU; attribute float aL;",
    "varying float vA; varying float vU; varying float vL;",
    "#include <fog_pars_vertex>",
    "void main(){ vA = aA; vU = aU; vL = aL;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}"
  ].join("\n");
  const FS = [
    "uniform vec3 uCol; uniform float uTime;",
    "varying float vA; varying float vU; varying float vL;",
    "#include <fog_pars_fragment>",
    "float h(float x){ return fract(sin(x * 127.1) * 43758.5453); }",
    "float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }",
    "void main(){",
    // soft cross-section, frayed by noise along the strand so it reads as rolling smoke, not a flat tape
    "  float wisp = n1(vL * 0.045 + vU * 1.7 + uTime * 0.05) * 0.55 + n1(vL * 0.13 - vU * 3.1) * 0.45;",
    "  float edge = 1.0 - smoothstep(0.35 + wisp * 0.45, 1.0, abs(vU));",
    "  float a = vA * edge * (0.65 + 0.5 * wisp);",
    "  if (a < 0.004) discard;",
    "  vec3 c = uCol * (0.86 + 0.22 * wisp);",
    "  gl_FragColor = vec4(c, a);",
    "  #include <fog_fragment>",
    "}"
  ].join("\n");
  const _t = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), LIT = new THREE.Color();
  let clock = 0;

  function create(o = {}) {
    const N = o.max || 700;
    const R = {
      life: o.life || 14, w0: o.w0 || 2.5, w1: o.w1 || 20, alpha: o.alpha != null ? o.alpha : 0.6, spacing: o.spacing || 5,
      rise: o.rise != null ? o.rise : 0.5, spread: o.spread != null ? o.spread : 0.9, tint: new THREE.Color(o.color || 0xf4f4f2),
      N, n: 0, head: 0, p: new Float32Array(N * 3), v: new Float32Array(N * 3), age: new Float32Array(N), cut0: new Uint8Array(N), len: new Float32Array(N),
      last: null, cutNext: true, released: false, dead: false
    };
    const geo = new THREE.BufferGeometry();
    R.pos = new Float32Array(N * 2 * 3); R.aA = new Float32Array(N * 2); R.aU = new Float32Array(N * 2); R.aL = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { R.aU[i * 2] = -1; R.aU[i * 2 + 1] = 1; }
    geo.setAttribute("position", new THREE.BufferAttribute(R.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aA", new THREE.BufferAttribute(R.aA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aU", new THREE.BufferAttribute(R.aU, 1));
    geo.setAttribute("aL", new THREE.BufferAttribute(R.aL, 1).setUsage(THREE.DynamicDrawUsage));
    R.idx = new Uint32Array((N - 1) * 6);
    geo.setIndex(new THREE.BufferAttribute(R.idx, 1).setUsage(THREE.DynamicDrawUsage));
    R.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true
    });
    R.mesh = new THREE.Mesh(geo, R.mat);
    R.mesh.frustumCulled = false; R.mesh.renderOrder = 6; R.mesh.name = "rjRibbon";
    if (RJ.LATE != null) R.mesh.layers.set(RJ.LATE);
    (o.scene || RJ.scene).add(R.mesh);
    R.add = function (pos) {
      if (R.released) return;
      if (R.last && !R.cutNext && R.last.distanceToSquared(pos) < R.spacing * R.spacing) return;
      const i = R.head;
      R.p[i * 3] = pos.x; R.p[i * 3 + 1] = pos.y; R.p[i * 3 + 2] = pos.z;
      const sp = R.spread;
      R.v[i * 3] = (Math.random() - 0.5) * sp; R.v[i * 3 + 1] = R.rise * (0.6 + Math.random() * 0.8); R.v[i * 3 + 2] = (Math.random() - 0.5) * sp;
      R.age[i] = 0; R.cut0[i] = R.cutNext ? 1 : 0;
      const prev = (i - 1 + N) % N;
      R.len[i] = R.cutNext || !R.n ? Math.random() * 400 : R.len[prev] + (R.last ? R.last.distanceTo(pos) : 0);
      R.head = (i + 1) % N; R.n = Math.min(N, R.n + 1); R.cutNext = false;
      R.last = R.last ? R.last.copy(pos) : pos.clone();
    };
    R.cut = function () { R.cutNext = true; };
    R.release = function () { R.released = true; };
    R.dispose = function () {
      if (R.dead) return; R.dead = true;
      R.mesh.parent && R.mesh.parent.remove(R.mesh); R.mesh.geometry.dispose(); R.mat.dispose();
      const k = list.indexOf(R); if (k >= 0) list.splice(k, 1);
    };
    list.push(R);
    return R;
  }

  function build(R, dt, cam) {
    const N = R.N, start = (R.head - R.n + N) % N;
    let ic = 0, alive = 0;
    for (let k = 0; k < R.n; k++) {
      const i = (start + k) % N;
      R.age[i] += dt;
      const j3 = i * 3, f = Math.exp(-dt * 0.35); // the drift slows as the smoke mixes into the air
      R.v[j3] *= f; R.v[j3 + 1] *= f; R.v[j3 + 2] *= f;
      R.p[j3] += R.v[j3] * dt; R.p[j3 + 1] += R.v[j3 + 1] * dt; R.p[j3 + 2] += R.v[j3 + 2] * dt;
    }
    for (let k = 0; k < R.n; k++) {
      const i = (start + k) % N, j3 = i * 3, u = R.age[i] / R.life;
      const nx = k + 1 < R.n ? (start + k + 1) % N : -1, pv = k > 0 ? (start + k - 1 + N) % N : -1;
      // tangent along the strand (forward difference at the ends), side vector facing the camera
      const a = nx >= 0 && !R.cut0[nx] ? nx : i, b = pv >= 0 && !R.cut0[i] ? pv : i;
      _t.set(R.p[a * 3] - R.p[b * 3], R.p[a * 3 + 1] - R.p[b * 3 + 1], R.p[a * 3 + 2] - R.p[b * 3 + 2]);
      if (_t.lengthSq() < 1e-6) _t.set(1, 0, 0);
      _c.set(cam.position.x - R.p[j3], cam.position.y - R.p[j3 + 1], cam.position.z - R.p[j3 + 2]);
      _s.crossVectors(_t, _c).normalize();
      const w = u >= 1 ? 0 : (R.w0 + (R.w1 - R.w0) * Math.sqrt(u)) * 0.5;
      const o = i * 6;
      R.pos[o] = R.p[j3] - _s.x * w; R.pos[o + 1] = R.p[j3 + 1] - _s.y * w; R.pos[o + 2] = R.p[j3 + 2] - _s.z * w;
      R.pos[o + 3] = R.p[j3] + _s.x * w; R.pos[o + 4] = R.p[j3 + 1] + _s.y * w; R.pos[o + 5] = R.p[j3 + 2] + _s.z * w;
      const al = u >= 1 ? 0 : R.alpha * Math.pow(1 - u, 1.3) * Math.min(1, R.age[i] / 0.25 + 0.15);
      R.aA[i * 2] = R.aA[i * 2 + 1] = al;
      R.aL[i * 2] = R.aL[i * 2 + 1] = R.len[i];
      if (u < 1) alive++;
      // join this point to the next unless the next starts a new strand
      if (nx >= 0 && !R.cut0[nx] && u < 1) {
        const p0 = i * 2, p1 = nx * 2;
        R.idx[ic++] = p0; R.idx[ic++] = p0 + 1; R.idx[ic++] = p1;
        R.idx[ic++] = p0 + 1; R.idx[ic++] = p1 + 1; R.idx[ic++] = p1;
      }
    }
    const g = R.mesh.geometry;
    g.setDrawRange(0, ic);
    g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.attributes.aL.needsUpdate = true; g.index.needsUpdate = true;
    return alive;
  }

  function update(dt, cam) {
    if (!list.length || !cam) return;
    clock += dt;
    // smoke takes the light of the moment: sun plus sky fill (so it glows gold at sunset and greys at dusk)
    const W = RJ.world || {};
    if (W.sun && W.hemi) {
      LIT.copy(W.sun.color).multiplyScalar(Math.min(1.4, W.sun.intensity) * 0.8).add(_lit2.copy(W.hemi.color).multiplyScalar(Math.min(1.4, W.hemi.intensity) * 0.6));
      LIT.r = Math.min(1.25, LIT.r); LIT.g = Math.min(1.25, LIT.g); LIT.b = Math.min(1.25, LIT.b);
    } else LIT.setRGB(0.95, 0.95, 0.97);
    for (let k = list.length - 1; k >= 0; k--) {
      const R = list[k];
      if (R.dead) continue;
      R.mat.uniforms.uTime.value = clock;
      R.mat.uniforms.uCol.value.copy(LIT).multiply(R.tint);
      const alive = build(R, dt, cam);
      if (R.released && alive === 0) R.dispose();
    }
  }
  const _lit2 = new THREE.Color();

  RJ.ribbons = { create, update, list, clear: () => { for (const R of list.slice()) R.dispose(); } };
  // ride along with the effects update (fx.js loads before this file)
  if (RJ.fx && RJ.fx.update && !RJ.fx._ribbonHook) {
    const base = RJ.fx.update;
    RJ.fx.update = function (dt, camera, renderer) { const r = base.apply(this, arguments); try { update(dt, camera); } catch (e) { console.warn("ribbons", e); } return r; };
    RJ.fx._ribbonHook = true;
  }
})(window.RJ);
