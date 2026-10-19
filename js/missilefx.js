/* Jet City — missile visuals: four missile types with their own model, motor, trail and warhead; launch
 * ignition, continuous curving smoke trails, turn cues, and layered impact explosions with a shockwave, light,
 * camera shake and real falling debris. Gameplay (guidance, hits, damage) stays in combat.js. */
(function (RJ) {
  "use strict";
  const MF = (RJ.missileFx = {});
  const V3 = RJ.V3;
  const tv = V3(), tv2 = V3(), tv3 = V3();
  const R = (a) => (Math.random() - 0.5) * 2 * a;

  /* ---------------- types ----------------
   * len/r: body (m) · fins: tail fin span · can: canards (heat seekers steer with forward fins) · body/band colours
   * core/flame: exhaust colours · trail: smoke life (s), size, spacing (m), brightness · boom: warhead size · g: turn limit */
  const TYPES = {
    ir: { name: "heat", len: 2.9, r: 0.064, fins: 0.42, can: true, body: 0xe9e9e4, band: 0xd6a51c, nose: 0x2b3440, core: 0xfff4d8, flame: 0xff8a30,
      trail: { life: 9, s0: 1.0, s1: 9, step: 3, gray: 0.92, alpha: 0.52 }, boom: 0.85, g: 38, ign: 0.07, boost: 1.0, glow: 0xffb35a, ball: 0xff6a12 },
    radar: { name: "radar", len: 3.65, r: 0.09, fins: 0.5, mid: true, body: 0xc9ccce, band: 0xd6a51c, nose: 0xb9bcbf, core: 0xfff8e8, flame: 0xffa040,
      trail: { life: 12, s0: 1.3, s1: 13, step: 3.5, gray: 0.95, alpha: 0.56 }, boom: 1.0, g: 30, ign: 0.2, boost: 1.4, glow: 0xffc070, ball: 0xff8a1e },
    heavy: { name: "heavy", len: 4.0, r: 0.19, fins: 0.9, mid: true, body: 0xdedfdb, band: 0x8a5a2b, nose: 0xc9cbc6, core: 0xffe9c0, flame: 0xff7020,
      trail: { life: 14, s0: 2.2, s1: 20, step: 4, gray: 0.88, alpha: 0.62 }, boom: 1.6, g: 22, ign: 0.32, boost: 1.8, glow: 0xff9a40, ball: 0xff5200 },
    exp: { name: "experimental", len: 3.2, r: 0.11, fins: 0.5, body: 0x30343a, band: 0x3ad7ff, nose: 0x1a1d22, core: 0xe8fbff, flame: 0x39c8ff,
      trail: { life: 4.5, s0: 0.8, s1: 6, step: 3, gray: 0.6, alpha: 0.28 }, boom: 1.25, g: 34, ign: 0.05, boost: 0.8, glow: 0x5ad8ff, ball: 0x1f9dff, ion: [0.35, 0.8, 1.0] }
  };
  // X-99 Phantom specials (fictional): Specter smart missile (violet guidance glow), Pulse and Nova energy shots
  TYPES.specter = { name: "Specter", len: 3.4, r: 0.1, fins: 0.42, body: 0x15171b, band: 0x8a6bff, nose: 0x0b0d11, core: 0xf6eeff, flame: 0x9a7bff,
    trail: { life: 6, s0: 0.9, s1: 7, step: 3, gray: 0.7, alpha: 0.34 }, boom: 1.5, g: 46, ign: 0.12, boost: 1.3, glow: 0xa890ff, ball: 0x7b5cff, ion: [0.62, 0.48, 1.0] };
  TYPES.pulse = { name: "Pulse", len: 1.4, r: 0.2, fins: 0, body: 0xdff6ff, band: 0x8fe8ff, nose: 0xeaffff, core: 0xffffff, flame: 0x7fe0ff,
    trail: { life: 2.4, s0: 1.2, s1: 4, step: 2, gray: 0.9, alpha: 0.4 }, boom: 1.2, g: 60, ign: 0, boost: 0.6, glow: 0x8fe8ff, ball: 0x5fd8ff, ion: [0.45, 0.88, 1.0], energy: 9 };
  TYPES.nova = { name: "Nova", len: 2.2, r: 0.4, fins: 0, body: 0xfff1c8, band: 0xffd36a, nose: 0xffffff, core: 0xffffff, flame: 0xffc04a,
    trail: { life: 5, s0: 3, s1: 14, step: 3, gray: 1.0, alpha: 0.5 }, boom: 4.2, g: 20, ign: 0, boost: 1.0, glow: 0xffd070, ball: 0xffb02a, ion: [1.0, 0.82, 0.45], energy: 26 };
  MF.TYPES = TYPES;
  /** Which missile this aircraft fires (mixed loadouts alternate, e.g. "AIM-120 + AIM-9X"). */
  MF.typeFor = function (ac) {
    if (ac._mslType) return ac._mslType; // X-99: the selected special weapon
    const n = ((ac.spec.msl && ac.spec.msl.name) || "").toLowerCase(), k = ac.missiles || 0;
    if (/proton|concussion|hypersonic/.test(n)) return "exp";
    if (/aim-54|aim-47|phoenix/.test(n)) return /aim-9/.test(n) && k % 2 ? "ir" : "heavy";
    const ir = /aim-9|sidewinder/.test(n), rad = /aim-120|aim-7|amraam|defensive|fictional/.test(n);
    if (ir && rad) return k % 2 ? "ir" : "radar";
    return ir ? "ir" : "radar";
  };

  /* ---------------- models ---------------- */
  let haloTex = null;
  function halo() {
    if (!haloTex) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.15, "rgba(255,240,210,0.85)"); g.addColorStop(0.45, "rgba(255,160,80,0.25)"); g.addColorStop(1, "rgba(255,120,40,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); haloTex = new THREE.CanvasTexture(c);
    }
    return haloTex;
  }
  const tpl = {};
  function build(type) {
    const T = TYPES[type], g = new THREE.Group(), L = T.len, r = T.r;
    g.userData = { flames: [], nozzles: [] };
    const std = (c, ro, me, ex) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: ro, metalness: me }, ex || {}));
    const body = std(T.body, 0.42, 0.35), band = std(T.band, 0.5, 0.2), dark = std(0x24272b, 0.6, 0.6);
    const nose = type === "ir" ? std(T.nose, 0.05, 0.9, { envMapIntensity: 1.8 }) : std(T.nose, 0.35, 0.3);
    const cyl = (rad, len, z, mat, rt) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt != null ? rt : rad, rad, len, 14), mat); m.geometry.rotateX(Math.PI / 2); m.position.z = z; g.add(m); return m; };
    cyl(r, L * 0.78, 0.04 * L, body);
    // ogive radome / seeker dome
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(r * Math.sqrt(1 - Math.pow(1 - t, 2)) + 0.0001, -L * 0.5 + t * L * 0.16)); }
    const ng = new THREE.LatheGeometry(pts, 14); ng.rotateX(Math.PI / 2); // lathe axis y → missile axis z: tip at the front (−z)
    g.add(new THREE.Mesh(ng, nose));
    cyl(r * 1.01, L * 0.05, -L * 0.28, band);                 // warhead band
    cyl(r * 1.01, L * 0.04, L * 0.08, std(0x6b4a2a, 0.6, 0.2)); // rocket-motor band
    cyl(r * 0.82, L * 0.06, L * 0.47, dark, r * 0.7);          // nozzle
    // cruciform fins with a swept planform; heat seekers get forward canards, radar missiles mid-body strakes
    const finShape = (span, root, tip, sweep) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(span, sweep); s.lineTo(span, sweep + tip); s.lineTo(0, root); s.closePath(); return s; };
    const addFins = (span, root, tip, sweep, z) => {
      const geo = new THREE.ExtrudeGeometry(finShape(span, root, tip, sweep), { depth: 0.012, bevelEnabled: false });
      geo.translate(r * 0.9, 0, -0.006); geo.rotateX(Math.PI / 2); // span along x, chord along z
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(geo, body); f.position.z = z; const wrap = new THREE.Group(); wrap.rotation.z = k * Math.PI / 2 + Math.PI / 4; wrap.add(f); g.add(wrap); }
    };
    if (T.fins) addFins(T.fins * 0.55, L * 0.11, L * 0.05, L * 0.05, L * 0.34);
    if (T.can) addFins(T.fins * 0.32, L * 0.06, L * 0.025, L * 0.025, -L * 0.33);
    if (T.mid) addFins(T.fins * 0.22, L * 0.2, L * 0.12, L * 0.06, -L * 0.08);
    // motor plume (the same layered flame shader as the jets: core, envelope, shock diamonds)
    RJ.acParts.engine(g, { metal: dark }, r * 0.75, 0, 0, L * 0.5, { noNozzle: true, rocket: true, color: T.flame, core: T.core });
    const F = g.userData.flames[0];
    F.flame.name = "mflame"; F.flame.userData = { r: F.r }; F.glow.name = "mglow";
    // motor fireball: normal-blended (not additive) so it stays a vivid orange ball even against white cloud,
    // with an additive white-hot centre on top for bloom
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: T.ball, transparent: true, opacity: 1, depthWrite: false, fog: false }));
    sp.position.z = L * 0.55; sp.layers.set(RJ.LATE); sp.name = "mspr"; sp.renderOrder = 11; g.add(sp);
    const hc = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    hc.scale.setScalar(0.4); hc.layers.set(RJ.LATE); hc.renderOrder = 12; sp.add(hc);
    g.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.castShadow = true; });
    g.userData = {}; // clone() deep-copies userData as JSON: keep it plain and find the parts by name instead
    return g;
  }
  MF.mesh = function (type) {
    if (!tpl[type]) tpl[type] = build(type);
    const m = tpl[type].clone();
    const fl = m.getObjectByName("mflame"), gl = m.getObjectByName("mglow");
    m.userData = { flames: [{ flame: fl, glow: gl, mat: fl.material, core: fl.children[0] || null, halo: gl.children[0] || null, r: fl.userData.r }], halo: m.getObjectByName("mspr") };
    // energy shots: no hardware, just a blazing orb (an extra additive sprite) on the motor point
    if (TYPES[type].energy) {
      m.traverse((o) => { if (o.isMesh && o !== fl && o !== gl && !fl.children.includes(o)) o.visible = false; });
      const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: TYPES[type].glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      orb.scale.setScalar(TYPES[type].energy); orb.layers.set(RJ.LATE); orb.renderOrder = 13; orb.position.z = -TYPES[type].len * 0.4; m.add(orb);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      core.scale.setScalar(TYPES[type].energy * 0.38); core.layers.set(RJ.LATE); core.renderOrder = 14; orb.add(core);
    }
    return m;
  };

  /* ---------------- launch ---------------- */
  MF.launch = function (msl) {
    const T = TYPES[msl.type];
    // the motor lights a moment after release (rail missiles almost at once, bay/ejected missiles after falling
    // clear); combat.js holds thrust and guidance until then, so what you see is what flies
    msl.ign = T.ign; msl.lit = false; msl.prevTail = null; msl.spacing = 0; msl.boom = T.boom;
    // every missile slightly different: trail width and life, wobble, roll rate, flicker phase
    msl.var = 0.85 + Math.random() * 0.35; msl.seed = Math.random() * 100; msl.roll = Math.random() * 6.3; msl.rollW = R(1.6);
    // rail release puff
    for (let i = 0; i < 6; i++) RJ.fx.smoke(msl.pos, tv.copy(msl.vel).multiplyScalar(0.85).add(tv2.set(R(6), R(6), R(6))), 1.2, 0.9, 1.4, 0.35);
  };
  function ignite(msl) {
    const T = TYPES[msl.type], p = msl.pos, fx = RJ.fx;
    msl.lit = true;
    // ignition: a hot white flash, a burst of flame and a ring of exhaust smoke thrown out behind the motor
    for (let i = 0; i < 10; i++) fx.fireP.spawn(p.x, p.y, p.z, msl.vel.x * 0.6 + R(25), msl.vel.y * 0.6 + R(25), msl.vel.z * 0.6 + R(25), 0.12 + Math.random() * 0.12, 2.5 * T.boom, 9 * T.boom, 1, 0.95, 0.85, 1, 0, 2);
    for (let i = 0; i < 14; i++) { const v = tv.set(R(1), R(1), R(1)).normalize().multiplyScalar(14 + Math.random() * 10).addScaledVector(msl.vel, 0.7); fx.smokeP.spawn(p.x, p.y, p.z, v.x, v.y, v.z, 2.2 + Math.random() * 1.5, 1.5 * T.boom, 9 * T.boom, 0.86, 0.86, 0.88, 0.55, 1, 1.4); }
    // the motor's first blast: a hot, narrow jet of flame and smoke thrown straight back, widening as it slows
    const back = tv2.copy(msl.vel).normalize();
    for (let i = 0; i < 16; i++) {
      const sp = 25 + Math.random() * 70, sx = R(0.18), sy = R(0.18), sz = R(0.18);
      const vx = msl.vel.x * 0.5 - (back.x + sx) * sp, vy = msl.vel.y * 0.5 - (back.y + sy) * sp, vz = msl.vel.z * 0.5 - (back.z + sz) * sp;
      fx.smokeP.spawn(p.x, p.y, p.z, vx, vy, vz, 1.6 + Math.random() * 1.6, 1.2 * T.boom, (6 + Math.random() * 6) * T.boom, 0.9, 0.9, 0.92, 0.5, 1.2, 1.2);
      if (i < 8) fx.fireP.spawn(p.x, p.y, p.z, vx * 0.6, vy * 0.6, vz * 0.6, 0.1 + Math.random() * 0.1, 1.5 * T.boom, 5 * T.boom, 1, 0.75, 0.4, 1, 0, 1.5);
    }
    fx.light.position.copy(p); fx.light.color.setHex(T.glow); fx.lightLevel = Math.max(fx.lightLevel, 0.9);
    if (msl.owner && msl.owner.isPlayer && RJ.camKick) RJ.camKick(0.25);
    if (RJ.audio.missileIgnite) RJ.audio.missileIgnite(msl);
  }

  /* ---------------- ribbon trail ----------------
   * A continuous camera-facing smoke ribbon through the points the missile actually flew: it widens and drifts
   * with age, breaks up with noise at the edges, is lit by the sun and sky, and has a white-hot glowing head right
   * behind the motor. It outlives the missile and fades out on its own. */
  const RIB_N = 480, RIBBONS = [];
  let ribMat = null;
  function ribbonMaterial() {
    if (ribMat) return ribMat;
    ribMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { now: { value: 0 }, lit: { value: new THREE.Color(1, 1, 1) }, amb: { value: new THREE.Color(0.6, 0.65, 0.7) }, hot: { value: new THREE.Color(1, 0.6, 0.25) },
        fogCol: { value: new THREE.Color() }, fogNear: { value: 1e5 }, fogFar: { value: 2e5 }, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: [
        "attribute float born; attribute float side; attribute float life; attribute float alpha0;",
        "uniform float now; varying float vAge; varying float vSide; varying float vLife; varying float vA0; varying vec3 vW; varying float vDepth;",
        "void main(){ vAge = now - born; vSide = side; vLife = life; vA0 = alpha0; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;",
        "  vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }"
      ].join("\n"),
      fragmentShader: [
        "#ifdef TINT\nuniform vec3 tint;\n#endif",
        "uniform float now; uniform vec3 lit; uniform vec3 amb; uniform vec3 hot; uniform vec3 fogCol; uniform float fogNear; uniform float fogFar; uniform vec3 sunDir;",
        "varying float vAge; varying float vSide; varying float vLife; varying float vA0; varying vec3 vW; varying float vDepth;",
        "float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }",
        "float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),",
        "             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }",
        "void main(){",
        "  float a = vAge / vLife; if (a >= 1.0) discard;",
        "  float edge = 1.0 - abs(vSide);",                                   // 0 at the ribbon edge, 1 on its centre line
        "  vec3 q = vW * 0.12 + vec3(0.0, now * 0.35, 0.0);",
        "  float n = n3(q) * 0.6 + n3(q * 2.7) * 0.4;",                         // billowing breakup so it never reads as a tube
        "  float body = smoothstep(0.0, 0.55 + 0.35 * n, edge);",
        "  float alpha = body * vA0 * (1.0 - a) * (1.0 - a) * mix(1.0, 0.55 + 0.6 * n, smoothstep(0.02, 0.3, a));",
        "  vec3 V = normalize(vW - cameraPosition);",
        "  float fwd = pow(max(dot(V, sunDir), 0.0), 6.0);",                    // forward scattering: the trail glows when backlit
        // grey, shaded smoke (lit billows, darker cores and edges) so the trail reads against white cloud too
        "  vec3 col = (amb * (0.55 + 0.25 * n) + lit * (0.25 + 0.4 * n)) * (0.62 + 0.38 * edge) + lit * fwd * 0.9;",
        "  col = min(col, vec3(0.86));",
        "#ifdef CONTRAIL",
        "  col = min(col * 1.12 + 0.1, vec3(0.97));",                           // ice-crystal contrail: brighter, no exhaust glow
        "#ifdef TINT",
        "  col = col * tint * 1.15;",                                            // coloured display smoke
        "#endif",
        "#else",
        "  float heat = exp(-vAge * 9.0);",                                      // white-hot exhaust right behind the motor
        "  col = mix(col, hot * 3.2, heat * 0.85); alpha = max(alpha, heat * edge * 0.95 * vA0 * 1.6);",
        "#endif",
        "  float f = smoothstep(fogNear, fogFar, vDepth); col = mix(col, fogCol, f * 0.85);",
        "  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));",
        "}"
      ].join("\n")
    });
    return ribMat;
  }
  let conMat = null;
  function contrailMaterial() {
    if (!conMat) { const b = ribbonMaterial(); conMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, uniforms: b.uniforms, vertexShader: b.vertexShader, fragmentShader: b.fragmentShader, defines: { CONTRAIL: 1 } }); }
    return conMat;
  }
  const tintMats = {};
  function tintMaterial(hex) {
    if (!tintMats[hex]) { const b = ribbonMaterial(); tintMats[hex] = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, uniforms: Object.assign({}, b.uniforms, { tint: { value: new THREE.Color(hex) } }), vertexShader: b.vertexShader, fragmentShader: b.fragmentShader, defines: { CONTRAIL: 1, TINT: 1 } }); }
    return tintMats[hex];
  }
  function newRibbon(T, contrail, tint) {
    const g = new THREE.BufferGeometry(), N = RIB_N * 2;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute("born", new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute("side", new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute("life", new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute("alpha0", new THREE.BufferAttribute(new Float32Array(N), 1));
    const idx = [];
    for (let i = 0; i < RIB_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    for (let i = 0; i < N; i++) g.attributes.side.array[i] = i % 2 ? 1 : -1;
    const mesh = new THREE.Mesh(g, tint != null ? tintMaterial(tint) : contrail ? contrailMaterial() : ribbonMaterial());
    mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.layers.set(RJ.LATE);
    RJ.scene.add(mesh);
    const r = { mesh, g, pts: [], T, dead: false, contrail: !!contrail };
    if (contrail) MF.nCon = (MF.nCon || 0) + 1;
    RIBBONS.push(r);
    return r;
  }
  const _d = V3(), _s = V3(), _c = V3();
  function drawRibbon(r, now, cam) {
    const P = r.g.attributes.position.array, B = r.g.attributes.born.array, L = r.g.attributes.life.array, A = r.g.attributes.alpha0.array;
    const pts = r.pts, n = pts.length, tr = r.T.trail;
    const N = Math.min(RIB_N, n + 1);
    r.g.setDrawRange(0, Math.max(0, N - 1) * 6);
    for (let i = 0; i < N; i++) {
      const k = Math.min(i, n - 1), p = pts[k];
      const j = i * 2;
      if (!p) { B[j] = B[j + 1] = -1e6; L[j] = L[j + 1] = 1; continue; }
      const age = now - p.t;
      // drift with the wind and spread out as the smoke ages
      const wx = p.x + p.wx * age, wy = p.y + p.wy * age + age * 0.5, wz = p.z + p.wz * age;
      const q = pts[Math.min(k + 1, n - 1)], o = pts[Math.max(k - 1, 0)];
      _d.set(q.x - o.x, q.y - o.y, q.z - o.z); if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
      _c.set(wx - cam.x, wy - cam.y, wz - cam.z);
      _s.crossVectors(_d, _c).normalize();
      const w = (tr.s0 + (tr.s1 - tr.s0) * Math.sqrt(Math.min(age / tr.life, 1))) * 0.5 * p.w;
      P[j * 3] = wx - _s.x * w; P[j * 3 + 1] = wy - _s.y * w; P[j * 3 + 2] = wz - _s.z * w;
      P[j * 3 + 3] = wx + _s.x * w; P[j * 3 + 4] = wy + _s.y * w; P[j * 3 + 5] = wz + _s.z * w;
      B[j] = B[j + 1] = p.t; L[j] = L[j + 1] = tr.life * p.l; A[j] = A[j + 1] = Math.min(0.95, tr.alpha * 1.7);
    }
    for (const k of ["position", "born", "life", "alpha0"]) { const at = r.g.attributes[k]; at.updateRange.offset = 0; at.updateRange.count = N * 2 * at.itemSize; at.needsUpdate = true; }
  }
  MF.tickRibbons = function (dt) {
    if (!RIBBONS.length || !RJ.camera) return;
    const now = RJ.fx.time || 0, W = RJ.world, U = ribbonMaterial().uniforms;
    if (now === MF._ribNow) return; // geometry once per rendered frame, not per physics step
    MF._ribNow = now;
    U.now.value = now;
    U.lit.value.copy(W.sun.color).multiplyScalar((W.sunIntensity || 1) * (W.night ? 0.25 : 0.95));
    U.amb.value.copy(W.hemi.color).multiplyScalar((W.hemiIntensity || 0.6) * 1.2);
    U.sunDir.value.copy(W.sunDir);
    const fog = W.scene.fog; U.fogCol.value.copy(fog.color); U.fogNear.value = Math.min(fog.near, 6000); U.fogFar.value = Math.min(fog.far, 30000);
    for (let i = RIBBONS.length - 1; i >= 0; i--) {
      const r = RIBBONS[i];
      // drop points that have fully faded; free the ribbon once its missile is gone and the smoke has cleared
      while (r.pts.length && now - r.pts[r.pts.length - 1].t > r.T.trail.life * r.pts[r.pts.length - 1].l) r.pts.pop();
      if (r.dead && !r.pts.length) { RJ.scene.remove(r.mesh); r.g.dispose(); RIBBONS.splice(i, 1); if (r.contrail) MF.nCon--; continue; }
      const h = r.pts[0];
      if (h && (r._f = (r._f || 0) + 1) % 3 && RJ.camera.position.distanceToSquared(tv.set(h.x, h.y, h.z)) > 9e6) continue; // far: refresh every 3rd frame
      drawRibbon(r, now, RJ.camera.position);
    }
  };
  function ribbonPush(r, p, wind, w) {
    const now = RJ.fx.time || 0;
    r.pts.unshift({ x: p.x, y: p.y, z: p.z, t: now, wx: wind.x + R(0.8), wy: wind.y + R(0.4), wz: wind.z + R(0.8), w: w * (0.85 + Math.random() * 0.3), l: 0.85 + Math.random() * 0.3 });
    if (r.pts.length > RIB_N) r.pts.length = RIB_N;
  }
  MF.release = function (msl) { if (msl.rib) { msl.rib.dead = true; msl.rib = null; } if (msl.mesh) RJ.scene.remove(msl.mesh); };

  /* ---------------- flight ---------------- */
  const WIND = new THREE.Vector3(0.8, 0, 0.6);
  const _rq = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
  MF.update = function (msl, dt, turn) {
    const T = TYPES[msl.type], M = msl.mesh, U = M.userData, burning = msl.t < msl.burn;
    if (!msl.lit && msl.t >= msl.ign) ignite(msl);
    // boost (first ~1.5 s after ignition): long, white-hot plume and thick smoke; then the sustainer: a shorter,
    // steadier flame and a thinner trail; the plume wavers with smooth noise instead of jumping every frame
    const age = msl.t - msl.ign, bst = msl.lit ? RJ.smooth(T.boost + 0.6, T.boost, age) : 0;
    const on = msl.lit && burning, boost = 1 + 0.45 * bst + (age < 0.25 ? 0.5 : 0);
    const cam = RJ.camera, d = cam ? cam.position.distanceTo(msl.pos) : 500;
    const sd = msl.seed || 0, tt = msl.t * 23 + sd, wob = 0.5 + 0.25 * Math.sin(tt) + 0.15 * Math.sin(tt * 2.31 + 1.7) + 0.1 * Math.sin(tt * 5.7);
    for (const f of U.flames) {
      const u = f.mat.uniforms; u.time.value += dt; u.power.value = on ? 1 : 0; u.ab.value = on ? 1 : 0; u.kick.value = on ? 0.25 + 0.5 * bst : 0;
      f.flame.visible = on; f.glow.visible = on;
      // a tapered rocket plume a little longer than the missile's own fins, never a beam: length follows the motor phase
      const fw = Math.max(f.r * 2.1, 0.2) * (0.92 + 0.16 * wob) * (1 + 0.25 * bst);
      f.flame.scale.set(fw, fw, on ? (2.3 + 0.7 * wob + turn * 0.9) * boost * (T.boom > 1.4 ? 1.35 : 1) : 0.01);
      f.glow.scale.setScalar(on ? 2.0 + 0.8 * bst : 1);
      if (f.core) f.core.visible = on && d < 1500;
      if (f.halo) f.halo.material.opacity = on ? 0.75 + 0.2 * wob : 0;
    }
    // the glow stays a readable dot at any range: grow it with distance, fade it when the motor burns out
    if (U.halo) { U.halo.visible = on; U.halo.scale.setScalar(Math.max(T.r * 60 + 3, d * 0.03) * boost * (0.88 + 0.24 * wob)); }
    // a slow roll (and a slight coning wobble just after ignition) so the airframe never looks bolted to a rail
    msl.roll = (msl.roll || 0) + (msl.rollW || 0) * dt;
    M.quaternion.multiply(_rq.setFromAxisAngle(ZAX, msl.roll));
    if (age > 0 && age < 0.6) { const c = 0.03 * (1 - age / 0.6); M.rotateX(Math.sin(tt * 0.9) * c); M.rotateY(Math.cos(tt * 0.8) * c); }
    // the motor lights the missile body and anything close to it (shares the explosion light; explosions win)
    if (on && d < 900 && RJ.fx.lightLevel < 0.45 * (1 + bst)) { RJ.fx.light.position.copy(msl.pos); RJ.fx.light.color.setHex(T.glow); RJ.fx.lightLevel = 0.45 * (1 + bst); }
    if (!msl.lit) return;
    const fx = RJ.fx, tail = tv.copy(msl.vel).normalize().multiplyScalar(-T.len * 0.55).add(msl.pos);
    const wx = RJ.world.WEATHER[RJ.world.env.weather] || {}, wind = tv3.copy(WIND).multiplyScalar((wx.wind || 6) * 0.6);
    if (on) {
      // continuous ribbon trail through the path actually flown (curves with every turn), plus a few soft puffs
      // along it for volume; the newest point rides on the nozzle so the trail always starts right at the flame
      // big battles: cap the number of ribbon meshes; distant extra missiles fall back to smoke puffs
      if (!msl.rib && !msl.noRib) { if ((RIBBONS.length - (MF.nCon || 0) > 40 && d > 2500) || (RJ.combat.crowd && d > 7000)) msl.noRib = true; else { msl.rib = newRibbon(T); ribbonPush(msl.rib, tail, wind, 1); } }
      const r = msl.rib, prev = msl.prevTail || tail.clone(), seg = prev.distanceTo(tail);
      const step = Math.max(T.trail.step * 1.6, msl.speed * 0.011); // fast missiles: wider spacing so the trail stays kilometres long
      const tw = (msl.var || 1) * (0.8 + 0.45 * bst);
      msl.spacing += seg;
      let n = 0;
      while (msl.spacing >= step && n < 40) {
        msl.spacing -= step; n++;
        const k = seg > 0 ? 1 - msl.spacing / seg : 1, p = tv2.copy(prev).lerp(tail, RJ.clamp(k, 0, 1));
        if (r) ribbonPush(r, p, wind, tw);
        if (n % 3 === 0 || !r) { const tr = T.trail, gr = tr.gray; fx.smokeP.spawn(p.x + R(0.5), p.y + R(0.5), p.z + R(0.5), wind.x + R(1.5), wind.y + 0.8, wind.z + R(1.5), tr.life * 0.7, tr.s0 * 1.4, tr.s1 * 1.1, gr, gr, gr * 1.03, tr.alpha * 0.5, 0.4, 0.25); }
        if (T.ion && Math.random() < 0.9) { const a = msl.t * 30 + n; fx.fireP.spawn(p.x + Math.cos(a) * 0.9, p.y + Math.sin(a) * 0.9, p.z, R(2), R(2), R(2), 0.6 + Math.random() * 0.4, 1.4, 0.3, T.ion[0], T.ion[1], T.ion[2], 1, 0, 0.5); }
      }
      if (r && r.pts.length) { const h = r.pts[0]; h.x = tail.x; h.y = tail.y; h.z = tail.z; h.t = RJ.fx.time || 0; }
      msl.prevTail = tail.clone();
      // glowing exhaust right behind the nozzle
      const hot = T.ion || [1, 0.62, 0.28];
      fx.fireP.spawn(tail.x, tail.y, tail.z, msl.vel.x * 0.7 + R(4), msl.vel.y * 0.7 + R(4), msl.vel.z * 0.7 + R(4), 0.07 + Math.random() * 0.06, 1.6 * T.boom, 3.5 * T.boom, hot[0], hot[1], hot[2], 0.9, 0, 0.8);
    } else msl.prevTail = null;
    // hard turns: vapour peels off the fins (a visible cue the missile is pulling hard)
    if (turn > 0.5 && Math.random() < turn * 0.5 && d < 1500) fx.vapor(msl.pos, msl.vel, 1.4, 0.35 * Math.min(1, turn));
  };

  /* ---------------- contrails (big battles): one continuous ribbon per jet ----------------
   * Long, widening ice trails are what make a distant air battle readable: a few-pixel jet is invisible at
   * 8 km, its 3 km contrail is not. p = nozzle position, or null to end the trail (left the contrail band, hit). */
  const CON_T = { trail: { life: 14, s0: 5, s1: 40, step: 35, gray: 0.97, alpha: 0.4 } };
  const CWIND = new THREE.Vector3(1.2, 0, 0.8);
  /** Continuous trail owned by ac under ac[key] (contrails, display smoke); p = emitter, or null to end it. */
  function ownedTrail(ac, key, p, T, tint) {
    let r = ac[key];
    if (!p) { if (r) { r.dead = true; ac[key] = null; } return; }
    if (!r) { r = ac[key] = newRibbon(T, true, tint); ribbonPush(r, p, CWIND, 1); ribbonPush(r, p, CWIND, 1); }
    const h = r.pts[0], q = r.pts[1];
    if (q && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 > T.trail.step ** 2) ribbonPush(r, p, CWIND, 1); // fix the old head, start a new one
    else if (h) { h.x = p.x; h.y = p.y; h.z = p.z; h.t = RJ.fx.time || 0; }
  }
  MF.contrail = (ac, p) => ownedTrail(ac, "_crib", p, CON_T);

  /* ---------------- display smoke (airshows): a long white trail per jet, same ribbon as the contrails ---------------- */
  const SMOKE_T = { trail: { life: 12, s0: 1.8, s1: 18, step: 9, gray: 0.97, alpha: 0.55 } };
  /** Display smoke; `tint` (hex) colours it, e.g. the Red Arrows' red, white and blue. */
  MF.smoke = (ac, p, tint) => ownedTrail(ac, "_srib", p, SMOKE_T, tint);

  /* ---------------- impact ---------------- */
  MF.impact = function (msl, hit) {
    const T = TYPES[msl.type] || TYPES.radar, s = T.boom * (hit ? 1.25 : 0.9), vel = hit ? hit.vel : msl.vel.clone().multiplyScalar(0.2);
    MF.explosion(msl.pos, s, vel, T);
    const cam = RJ.camera, near = !cam || cam.position.distanceTo(msl.pos) < 7000;
    if (!near) return;
    // a real 3D fireball and a pressure shell even when the target survives; torn panels fly off it
    MF.fireball(msl.pos, 6.5 * s, 0.9, vel, 1.1, hit || null);
    MF.shockRing(msl.pos, 16 * s);
    if (hit) MF.debris(msl.pos, hit.vel, 3 + Math.round(s * 2), true);
    else if (msl.pos.y < RJ.world.ground(msl.pos.x, msl.pos.z) + 3) RJ.fx.dust(msl.pos, 0.9 * s);
  };
  /** Layered blast: white flash → expanding fireball → sparks and flaming debris → dark rolling smoke, plus a
   * shockwave (refraction ring + bright shell), a light that lights nearby aircraft and terrain, and camera shake. */
  MF.explosion = function (p, s, vel, T) {
    const fx = RJ.fx, vx = vel ? vel.x * 0.3 : 0, vy = vel ? vel.y * 0.3 : 0, vz = vel ? vel.z * 0.3 : 0;
    const tint = T && T.ion ? T.ion : null;
    // 1 flash: a few huge, very short-lived white-hot particles
    for (let i = 0; i < 4; i++) fx.fireP.spawn(p.x, p.y, p.z, vx, vy, vz, 0.09 + i * 0.03, 14 * s, 46 * s, 1, 0.97, tint ? 1 : 0.9, 1, 0, 0);
    // 2 fireball: hot core, then orange billows that rise
    for (let i = 0; i < 22 * Math.sqrt(s); i++) { const v = tv.set(R(1), R(1), R(1)).normalize().multiplyScalar(6 + Math.random() * 18 * s); fx.fireP.spawn(p.x + R(2 * s), p.y + R(2 * s), p.z + R(2 * s), vx + v.x, vy + v.y + 3, vz + v.z, 0.35 + Math.random() * 0.5, 5 * s, 22 * s, 1, tint ? tint[1] : 0.9, tint ? tint[2] : 0.6, 1, 4, 2.5); }
    for (let i = 0; i < 26 * Math.sqrt(s); i++) { const v = tv.set(R(1), R(1), R(1)).normalize().multiplyScalar(4 + Math.random() * 12 * s); fx.fireP.spawn(p.x + R(4 * s), p.y + R(4 * s), p.z + R(4 * s), vx + v.x, vy + v.y + 5, vz + v.z, 0.7 + Math.random() * 1.0, 7 * s, 30 * s, 1, 0.55, 0.22, 0.9, 6, 2.0); }
    // 3 sparks and burning fragments
    for (let i = 0; i < 40 * s; i++) { const v = tv.set(R(1), R(1), R(1)).normalize().multiplyScalar(40 + Math.random() * 90 * s); fx.fireP.spawn(p.x, p.y, p.z, vx + v.x, vy + v.y + 8, vz + v.z, 0.5 + Math.random() * 0.9, 1.3, 0.4, 1, 0.82, 0.45, 1, -20, 0.5); }
    // 4 smoke: grey-black, rolling up and spreading, lingers long after the fire
    // (spread out, translucent and varied, so it billows like a cloud instead of reading as one dark ball)
    for (let i = 0; i < 26 * Math.sqrt(s); i++) { const d = 0.13 + Math.random() * 0.22, v = tv.set(R(1), R(1), R(1)).normalize().multiplyScalar(5 + Math.random() * 14 * s); fx.smokeP.spawn(p.x + R(8 * s), p.y + R(8 * s), p.z + R(8 * s), vx + v.x, vy + v.y + 3, vz + v.z, 4 + Math.random() * 6, 8 * s, (30 + Math.random() * 30) * s, d * 1.05, d, d * 0.95, 0.42 + Math.random() * 0.2, 2.5, 0.7); }
    // 5 shockwave: screen-space refraction ring (shared with the sonic boom) and a light flash
    if (RJ.sonic && RJ.sonic.shocks) { RJ.sonic.shocks.push({ pos: p.clone(), t: 0, R0: 6 * s, vis: 0.7 }); if (RJ.sonic.shocks.length > 3) RJ.sonic.shocks.shift(); }
    fx.light.position.copy(p); fx.light.color.setHex(tint ? 0x8fdcff : 0xffb070); fx.lightLevel = Math.max(fx.lightLevel, Math.min(2.4, 1.1 * s));
  };

  /* ---------------- debris: real tumbling fragments with smoke and flame trails ---------------- */
  const DEB = []; let debMat = null, debGeo = null;
  MF.debris = function (p, vel, n = 10, burning = true) {
    if (!debMat) {
      debMat = new THREE.MeshStandardMaterial({ color: 0x3a3d41, roughness: 0.7, metalness: 0.6 });
      debGeo = [new THREE.BoxGeometry(1, 0.08, 0.6), new THREE.BoxGeometry(0.5, 0.3, 0.9), new THREE.TetrahedronGeometry(0.6)];
    }
    for (let i = 0; i < n; i++) {
      if (DEB.length > 60) { const o = DEB.shift(); RJ.scene.remove(o.m); }
      const m = new THREE.Mesh(debGeo[i % 3], debMat); m.scale.setScalar(0.5 + Math.random() * 1.6); m.castShadow = true;
      m.position.copy(p).add(tv.set(R(2), R(2), R(2)));
      RJ.scene.add(m);
      const v = tv.set(R(1), R(1) + 0.4, R(1)).normalize().multiplyScalar(25 + Math.random() * 55).addScaledVector(vel || tv2.set(0, 0, 0), 0.5);
      DEB.push({ m, v: v.clone(), w: V3(R(9), R(9), R(9)), t: 0, life: 6 + Math.random() * 4, burn: burning && Math.random() < 0.6, fxT: 0 });
    }
  };
  /* ---------------- jet kills: volumetric fireball, shock ring, secondary blasts ----------------
   * A real 3D fireball (noise-displaced sphere whose colour runs white-hot → orange → dull red → black smoke as it
   * swells and cools), a bright shock ring racing outward, and fuel tanks cooking off on the falling wreck. */
  const NOISE = [
    "float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }",
    "float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),",
    "             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }"
  ].join("\n");
  let ballGeo = null;
  const BALLS = [], RINGS = [], POPS = [];
  function fireballMat() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { k: { value: 0 }, seed: { value: 0 }, heat: { value: 1 } },
      vertexShader: NOISE + "\n" + [
        "uniform float k; uniform float seed; varying float vN; varying vec3 vNor; varying vec3 vView;",
        "void main(){",
        "  vec3 p = position;",
        "  float n = n3(p * 1.8 + seed + vec3(0.0, -k * 2.0, 0.0)) * 0.6 + n3(p * 4.3 + seed * 1.7 + k) * 0.4;",
        "  vN = n; p *= 0.62 + 0.62 * n;",
        "  vNor = normalize(normalMatrix * normal);",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }"
      ].join("\n"),
      fragmentShader: [
        "uniform float k; uniform float heat; varying float vN; varying vec3 vNor; varying vec3 vView;",
        "void main(){",
        "  float facing = abs(dot(normalize(vNor), normalize(vView)));",
        "  float temp = clamp((1.15 - k * 1.55) * heat + (vN - 0.5) * 0.9 + facing * 0.35, 0.0, 1.2);",
        "  vec3 smoke = vec3(0.07, 0.065, 0.06), red = vec3(0.75, 0.12, 0.02), orange = vec3(1.6, 0.62, 0.12), white = vec3(2.6, 2.1, 1.4);",
        "  vec3 col = temp < 0.3 ? mix(smoke, red, temp / 0.3) : temp < 0.65 ? mix(red, orange, (temp - 0.3) / 0.35) : mix(orange, white, min(1.0, (temp - 0.65) / 0.45));",
        "  float a = smoothstep(0.12, 0.8, facing + (vN - 0.5) * 0.3) * (1.0 - smoothstep(0.5, 1.0, k)) * (0.75 + 0.25 * vN);",
        "  a *= smoothstep(0.1, 0.45, temp);",                       // cooled lobes thin out; the smoke particles take over
        "  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));",
        "}"
      ].join("\n")
    });
  }
  /** One fireball: p position, R final radius, life seconds, vel drift (m/s), heat 0..1 (cooler = more smoke). */
  MF.fireball = function (p, R, life, vel, heat = 1, follow = null) {
    if (!ballGeo) ballGeo = new THREE.IcosahedronGeometry(1, 4);
    let b = BALLS.find((x) => x.k >= 1);
    if (!b) {
      if (BALLS.length >= 14) b = BALLS.reduce((a, x) => (x.k > a.k ? x : a));
      else { const m = new THREE.Mesh(ballGeo, fireballMat()); m.layers.set(RJ.LATE); m.renderOrder = 9; m.frustumCulled = false; b = { m }; BALLS.push(b); RJ.scene.add(m); }
    }
    b.k = 0; b.t = 0; b.life = life; b.R = R; b.v = (vel ? vel.clone() : V3()).multiplyScalar(0.3); b.follow = follow;
    b.m.position.copy(p); b.m.visible = true; b.m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const U = b.m.material.uniforms; U.seed.value = Math.random() * 50; U.heat.value = heat;
    return b;
  };
  let ringTex = null;
  MF.shockRing = function (p, R) {
    if (!ringTex) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.72, "rgba(255,240,215,0)"); g.addColorStop(0.86, "rgba(255,235,200,0.9)"); g.addColorStop(1, "rgba(255,220,180,0)");
      x.fillStyle = g; x.fillRect(0, 0, 128, 128); ringTex = new THREE.CanvasTexture(c);
    }
    let r = RINGS.find((x) => x.k >= 1);
    if (!r) {
      if (RINGS.length >= 8) r = RINGS[0];
      else { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.layers.set(RJ.LATE); s.renderOrder = 10; r = { s }; RINGS.push(r); RJ.scene.add(s); }
    }
    r.k = 0; r.R = R; r.s.position.copy(p); r.s.visible = true;
  };
  /** A jet destroyed in the air: the full show. */
  MF.jetBlast = function (ac) {
    const p = ac.pos, s = 1.3 + ac.radius / 10, cam = RJ.camera, far = cam && cam.position.distanceTo(p) > 9000;
    MF.explosion(p, s, ac.vel);
    MF.debris(p, ac.vel, 8 + Math.round(ac.radius / 2));
    if (far) return; // beyond 9 km the particle blast reads the same; skip the meshes
    MF.fireball(p, 12 * s, 1.6, ac.vel, 1.15);
    MF.fireball(p.clone().add(V3(R(4), R(4), R(4))), 8 * s, 2.2, ac.vel, 0.85); // a slower second lobe that rolls out of the first
    MF.shockRing(p, 30 * s);
    // fuel tanks and ordnance cooking off on the falling wreck
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) POPS.push({ ac, t: 0.35 + i * RJ.rand(0.35, 0.6), s: s * RJ.rand(0.45, 0.7) });
  };
  /** Cannon strike that doesn't kill: a flash, a spray of sparks and a puff of torn metal and smoke. */
  MF.hitFlash = function (ac) {
    const fx = RJ.fx, p = ac.pos, v = ac.vel;
    const o = V3(R(ac.radius * 0.4), R(ac.radius * 0.2), R(ac.radius * 0.4)).add(p);
    fx.fireP.spawn(o.x, o.y, o.z, v.x, v.y, v.z, 0.07, 3, 7, 1, 0.9, 0.6, 1, 0, 0);
    for (let i = 0; i < 7; i++) fx.fireP.spawn(o.x, o.y, o.z, v.x * 0.9 + R(30), v.y * 0.9 + R(30), v.z * 0.9 + R(30), 0.3 + Math.random() * 0.3, 0.8, 0.25, 1, 0.8, 0.45, 1, -12, 0.8);
    fx.smokeP.spawn(o.x, o.y, o.z, v.x * 0.6, v.y * 0.6, v.z * 0.6, 1.4, 2, 7, 0.2, 0.19, 0.18, 0.6, 1, 1.5);
  };
  RJ.on("damage", (e) => {
    const ac = e.ac;
    if (e.kind !== "gun" || !ac.alive || !RJ.camera || ac.pos.distanceTo(RJ.camera.position) > 4000) return;
    if ((ac._hitFx || 0) > ac.time - 0.1) return; // a burst of hits = a few flashes, not one per round
    ac._hitFx = ac.time; MF.hitFlash(ac);
  });
  function tickBlasts(dt) {
    for (const b of BALLS) {
      if (b.k >= 1) continue;
      b.t += dt; b.k = Math.min(1, b.t / b.life);
      const g = 1 - Math.exp(-b.k * 7); // fast swell, then hangs and rises as it cools
      b.m.scale.setScalar(b.R * (0.15 + 0.85 * g) * (1 + b.k * 0.35));
      b.m.position.addScaledVector(b.v, dt); b.m.position.y += dt * 6 * b.k;
      b.v.multiplyScalar(Math.pow(0.4, dt));
      b.m.material.uniforms.k.value = b.k;
      if (b.k >= 1) b.m.visible = false;
    }
    for (const r of RINGS) {
      if (r.k >= 1) continue;
      r.k = Math.min(1, r.k + dt / 0.45);
      r.s.scale.setScalar(r.R * (0.2 + 1.8 * Math.sqrt(r.k)));
      r.s.material.opacity = 0.85 * (1 - r.k) * (1 - r.k);
      if (r.k >= 1) r.s.visible = false;
    }
    for (let i = POPS.length - 1; i >= 0; i--) {
      const q = POPS[i]; q.t -= dt;
      if (q.t > 0) continue;
      POPS.splice(i, 1);
      if (q.ac.state !== "falling") continue;
      const p = q.ac.pos, fx = RJ.fx, v = q.ac.vel;
      MF.fireball(p, 8 * q.s, 1.1, v, 0.9);
      for (let k = 0; k < 14; k++) fx.fireP.spawn(p.x, p.y, p.z, v.x * 0.4 + R(45 * q.s), v.y * 0.4 + R(45 * q.s) + 6, v.z * 0.4 + R(45 * q.s), 0.4 + Math.random() * 0.6, 1.1, 0.35, 1, 0.8, 0.45, 1, -18, 0.5);
      fx.light.position.copy(p); fx.light.color.setHex(0xffa060); fx.lightLevel = Math.max(fx.lightLevel, 1.1 * q.s);
      if (RJ.camera && RJ.camera.position.distanceTo(p) < 1500) RJ.camKick(0.15);
    }
  }

  MF.tick = function (dt) {
    MF.tickRibbons(dt);
    tickBlasts(dt);
    for (let i = DEB.length - 1; i >= 0; i--) {
      const d = DEB[i]; d.t += dt;
      d.v.y -= RJ.G0 * dt; d.v.multiplyScalar(Math.pow(0.96, dt * 10 * 0.1));
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      d.fxT -= dt;
      if (d.fxT <= 0 && d.t < 4) {
        d.fxT = 0.05;
        RJ.fx.smoke(d.m.position, tv.set(0, 1, 0), 1.2 + d.t * 0.5, 0.15, 3, 0.55);
        if (d.burn && d.t < 2.5) RJ.fx.fire(d.m.position, tv.copy(d.v).multiplyScalar(0.1), 1.5);
      }
      const g = RJ.world.ground(d.m.position.x, d.m.position.z);
      if (d.m.position.y < g + 0.3 || d.t > d.life) { if (d.m.position.y < g + 2) RJ.fx.dust(d.m.position, 0.25); RJ.scene.remove(d.m); DEB.splice(i, 1); }
    }
  };
  /* ---------------- flares: burning magnesium decoys ----------------
   * Each flare is a blinding white-hot core inside a saturated orange fireball sprite (readable against white
   * cloud), shedding sparks and a thick white smoke ribbon as it arcs away and falls. It cools over its life:
   * white → yellow → orange → dull red, shrinking and fading, and lights the nearby airframe and cloud. */
  const FLARE_T = { trail: { life: 4.5, s0: 1.6, s1: 12, step: 2.2, gray: 0.95, alpha: 0.6 } };
  const _fc = new THREE.Color();
  MF.flareStart = function (f) {
    f.life0 = f.life; f.spacing = 0; f.prev = null;
    const ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffa040, transparent: true, depthWrite: false }));
    ball.renderOrder = 11; ball.layers.set(RJ.LATE);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    core.renderOrder = 12; core.layers.set(RJ.LATE); core.scale.setScalar(0.45); ball.add(core);
    ball.position.copy(f.p); RJ.scene.add(ball);
    f.ball = ball; f.core = core;
    // ejection: a sharp pop of white flash and sparks from the dispenser
    const fx = RJ.fx, p = f.p, v = f.v;
    fx.fireP.spawn(p.x, p.y, p.z, v.x, v.y, v.z, 0.08, 6, 14, 1, 0.97, 0.9, 1, 0, 0);
    for (let i = 0; i < 10; i++) fx.fireP.spawn(p.x, p.y, p.z, v.x + R(35), v.y + R(35), v.z + R(35), 0.25 + Math.random() * 0.3, 0.9, 0.3, 1, 0.85, 0.5, 1, -15, 1);
  };
  MF.flareUpdate = function (f, dt) {
    const fx = RJ.fx, p = f.p, heat = RJ.clamp(f.life / (f.life0 || 3.2), 0, 1); // 1 = just lit, 0 = burnt out
    const cam = RJ.camera, d = cam ? cam.position.distanceTo(p) : 500;
    const fade = Math.min(1, f.life / 0.6), flick = 0.8 + Math.random() * 0.4;
    // colour cools from white-yellow to deep red
    _fc.setRGB(1, 0.22 + 0.38 * heat, 0.04 + 0.12 * heat); // the halo stays saturated; the additive core carries the white heat
    if (f.ball) {
      f.ball.position.copy(p);
      f.ball.material.color.copy(_fc); f.ball.material.opacity = 0.95 * fade;
      f.ball.scale.setScalar(Math.max(2.2 + 3 * heat, d * 0.02) * (0.6 + 0.4 * heat) * flick);
      f.core.material.opacity = fade * (0.5 + 0.5 * heat); f.core.scale.setScalar(0.32 + 0.18 * heat);
    }
    // smoke ribbon through the path flown, plus a few billows for volume
    const wx = RJ.world.WEATHER[RJ.world.env.weather] || {}, wind = tv3.copy(WIND).multiplyScalar((wx.wind || 6) * 0.6);
    if (f.noRib === undefined) f.noRib = RJ.combat.crowd && (d > 3000 || RIBBONS.length - (MF.nCon || 0) > 40); // big battles: distant flares skip the ribbon
    if (heat > 0.12 && f.noRib) { if (Math.random() < dt * 12) fx.smokeP.spawn(p.x, p.y, p.z, wind.x, wind.y + 0.8, wind.z, 3, 2, 9, 0.95, 0.95, 0.97, 0.4 * heat, 0.4, 0.3); }
    else if (heat > 0.12) {
      if (!f.rib) { f.rib = newRibbon(FLARE_T); ribbonPush(f.rib, p, wind, 1); }
      const prev = f.prev || p.clone(), seg = prev.distanceTo(p), step = FLARE_T.trail.step;
      f.spacing += seg;
      let n = 0;
      while (f.spacing >= step && n < 30) {
        f.spacing -= step; n++;
        const q = tv2.copy(prev).lerp(p, RJ.clamp(seg > 0 ? 1 - f.spacing / seg : 1, 0, 1));
        ribbonPush(f.rib, q, wind, 0.5 + heat * 0.6);
        if (n % 4 === 0) fx.smokeP.spawn(q.x, q.y, q.z, wind.x + R(1.5), wind.y + 0.8, wind.z + R(1.5), 3, 1.5, 9, 0.95, 0.95, 0.97, 0.3 * heat, 0.4, 0.3);
      }
      const h = f.rib.pts[0]; if (h) { h.x = p.x; h.y = p.y; h.z = p.z; h.t = fx.time || 0; }
      f.prev = f.prev ? f.prev.copy(p) : p.clone();
    } else if (f.rib) { f.rib.dead = true; f.rib = null; }
    // burning core particle and a shower of sparks streaming off it
    if (Math.random() < dt * 40) fx.fireP.spawn(p.x, p.y, p.z, f.v.x * 0.9, f.v.y * 0.9, f.v.z * 0.9, 0.08 + Math.random() * 0.05, 1.4 + 1.4 * heat, 2.4 + 1.6 * heat, 1, 0.45 + 0.35 * heat, 0.15 + 0.3 * heat, 0.55 * fade, 0, 0);
    if (d < 2500) for (let i = 0, ns = heat > 0.3 ? 2 : 1; i < ns; i++) if (Math.random() < dt * 150)
      fx.fireP.spawn(p.x, p.y, p.z, f.v.x * 0.6 + R(14), f.v.y * 0.6 + R(14) + 4, f.v.z * 0.6 + R(14), 0.4 + Math.random() * 0.6, 1.0, 0.25, 1, 0.7 + 0.25 * heat, 0.3, fade, -14, 0.7);
    // light: the hottest nearby flare lights the jet, cloud and terrain (shares the explosion light; explosions win)
    if (heat > 0.25 && fx.lightLevel <= 0.9 * heat + 0.01) { fx.light.position.copy(p); fx.light.color.copy(_fc); fx.lightLevel = 0.9 * heat; }
  };
  MF.flareEnd = function (f) {
    if (f.ball) { RJ.scene.remove(f.ball); f.ball.material.dispose(); f.core.material.dispose(); f.ball = null; }
    if (f.rib) { f.rib.dead = true; f.rib = null; }
  };
  MF.clear = function () {
    for (const b of BALLS) { b.k = 1; b.m.visible = false; } for (const r of RINGS) { r.k = 1; r.s.visible = false; } POPS.length = 0;
    for (const d of DEB) RJ.scene.remove(d.m); DEB.length = 0;
    for (const r of RIBBONS) { RJ.scene.remove(r.mesh); r.g.dispose(); } RIBBONS.length = 0; MF.nCon = 0;
  };
})(window.RJ);
