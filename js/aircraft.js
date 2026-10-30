/* Ridgeline Jets — aircraft catalog and procedural 3D models.
 * Models are built in meters with the nose pointing down -Z and +Y up.
 * To add an aircraft: add a catalog entry below and a builder in BUILDERS. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3;

  /* ======================= PART HELPERS ======================= */
  function shape2(pts) {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    return s;
  }
  /** Fuselage from a side profile: [[z, radius], ...] nose to tail. */
  function lathe(g, profile, mat, o = {}) {
    const pts = profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z));
    const geo = new THREE.LatheGeometry(pts, o.segs || 16);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(o.sx || 1, o.sy || 1, 1);
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  /** Flat surface (wing, stabilizer) from planform points [[x, z], ...] for the right side, mirrored by default. */
  function plate(g, pts, thick, mat, o = {}) {
    const out = [];
    if (o.mirror !== false && pts.length === 4 && g.userData._plates) g.userData._plates.push({ pts, thick, mat, o, grps: out });
    const sides = o.mirror === false ? [1] : [1, -1];
    for (const s of sides) {
      const px = o.pivotX || 0;
      const geo = new THREE.ExtrudeGeometry(shape2(pts.map(([x, z]) => [(x - px) * s, z])), { depth: thick, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, thick / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      const grp = new THREE.Group();
      grp.position.set(px * s, o.y || 0, 0);
      grp.rotation.z = (o.dihedral || 0) * s;
      grp.add(m);
      g.add(grp);
      out.push({ grp, s });
    }
    return out;
  }
  /** Vertical fin from side points [[z, y], ...]. tilt cants it (positive leans toward -X). */
  function fin(g, pts, mat, o = {}) {
    const t = o.thick || 0.2;
    const geo = new THREE.ExtrudeGeometry(shape2(pts), { depth: t, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);
    geo.translate(t / 2, 0, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.position.set(o.x || 0, o.y || 0, 0);
    m.rotation.z = o.tilt || 0;
    g.add(m);
    if (pts.length === 4 && g.userData._fins && pts[0][1] >= -0.2) g.userData._fins.push({ pts, t, mat, o });
    return m;
  }
  function finPair(g, pts, mat, x, cant, o = {}) {
    fin(g, pts, mat, Object.assign({}, o, { x, tilt: -cant }));
    fin(g, pts, mat, Object.assign({}, o, { x: -x, tilt: cant }));
  }
  function blob(g, sx, sy, sz, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  }
  function box(g, w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  }
  function tube(g, rF, rB, len, x, y, z, mat, sx = 1, sy = 1) {
    const geo = new THREE.CylinderGeometry(rB, rF, len, 14, 1, false);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, 1); m.castShadow = true; g.add(m); return m;
  }
  function pair(fn, x) { fn(x); fn(-x); }

  const FLAME_GEO = (() => { const f = new THREE.ConeGeometry(1, 5, 16, 6, true); f.translate(0, 2.5, 0); f.rotateX(Math.PI / 2); return f; })();
  // Afterburner plume: animated turbulence, white-hot core, shock diamonds, HDR output for bloom.
  // Exhaust plume, two layers on the same cone: an orange/yellow outer envelope and a short white-blue core
  // carrying the shock diamonds. The vertex shader breathes and whips the tail so the flame never looks static.
  const FLAME_VERT = [
    "uniform float time; uniform float ab; uniform float seed; uniform float layer;",
    "varying vec2 vUv; varying float vFres;",
    "void main(){ vUv = uv; vec3 p = position; float t = clamp(uv.y, 0.0, 1.0);",
    "  float tb = (0.35 + ab * 0.65) * (layer > 1.5 ? 1.7 : layer > 0.5 ? 0.45 : 1.0);",
    "  float w = sin(t * 9.0 - time * 28.0 + seed) * 0.5 + sin(t * 17.0 - time * 41.0 + seed * 1.7) * 0.5;",
    "  p.xy *= 1.0 + w * 0.13 * t * tb;",
    "  p.xy += vec2(sin(time * 23.0 + seed + t * 5.0), cos(time * 19.0 + seed * 2.0 + t * 4.0)) * 0.16 * t * t * tb;",
    "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
    "  vec3 n = normalize(normalMatrix * normal); vFres = abs(dot(n, normalize(-mv.xyz)));",
    "  gl_Position = projectionMatrix * mv; }"
  ].join("\n");
  const FLAME_FRAG = [
    "uniform float time; uniform float power; uniform float ab; uniform vec3 hot; uniform vec3 mid; uniform float seed; uniform float layer; uniform float kick; uniform float dsp; uniform float dvis; uniform float night;",
    "varying vec2 vUv; varying float vFres;",
    "float fh(vec2 p){ p = mod(p, 289.0); return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "void main(){",
    "  float t = clamp(vUv.y, 0.0, 1.0);",
    // two octaves of noise scrolling down the plume: turbulence and flicker
    "  float n = fn(vec2(vUv.x * 9.0 + seed, t * 7.0 - time * 14.0)) * 0.6 + fn(vec2(vUv.x * 21.0, t * 16.0 - time * 23.0)) * 0.4;",
    "  float ctr = pow(vFres, 1.4);", // 1 looking through the middle of the plume, 0 at its silhouette edge
    "  vec3 col; float a;",
    "  if (layer > 1.5) {",
    // heat shimmer: a wider, longer sheath of faint, rippling warm wisps around the burner plume
    "    float r = fn(vec2(vUv.x * 13.0 + seed, t * 9.0 - time * 8.0)) * 0.65 + fn(vec2(vUv.x * 29.0 - seed, t * 21.0 - time * 15.0)) * 0.35;",
    "    float band = smoothstep(0.55, 0.95, r);",
    "    col = mix(mid, vec3(1.0, 0.82, 0.62), 0.45) * (0.5 + band);",
    "    a = band * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.3, 1.0, t)) * (1.0 - 0.6 * pow(vFres, 2.0)) * 0.09 * ab * (1.0 + night * 0.9);",
    "  } else if (layer > 0.5) {",
    // core: blue-white at the nozzle, warming to yellow; Mach diamonds = bright standing bands that fade downstream
    "    vec3 blueW = vec3(0.72, 0.84, 1.0);",
    "    col = mix(blueW, hot, smoothstep(0.0, 0.75, t));",
    "    float dia = pow(0.5 + 0.5 * cos(t * 31.4 * dsp - 0.9), 9.0) * exp(-t * 1.3 / dsp) * (0.9 + 0.1 * n) * dvis;",
    "    col = col * (0.55 + kick * 1.2) + vec3(1.0, 0.95, 0.82) * dia * (4.1 + kick * 2.0 + night * 1.6);",
    "    a = (1.0 - smoothstep(0.6, 1.0, t)) * (0.5 + 0.5 * ctr) * (0.12 + dia * 1.1) * ab;",
    "  } else {",
    // envelope: hot yellow-white in the middle and near the nozzle, orange at the edges, red-orange at the tail
    "    vec3 tail = mid * vec3(1.0, 0.55, 0.35);",
    "    vec3 body = mix(mid, hot, ctr * exp(-t * 2.2));",
    "    col = mix(body, tail, smoothstep(0.35, 1.0, t));",
    "    col += vec3(0.35, 0.5, 1.0) * exp(-t * 14.0) * (0.3 + ab * 0.9);", // flame-holder blue at the exit
    "    float dia = ab * pow(0.5 + 0.5 * cos(t * 30.0 * dsp - 0.6), 10.0) * exp(-t * 2.4 / dsp) * (0.7 + 0.3 * n) * dvis;",
    "    col += hot * dia * (1.15 + night * 0.5);",
    "    col *= 0.75 + ab * 0.55 + kick * 1.2;",
    "    a = pow(1.0 - t, 1.2) * (0.35 + 0.65 * n) * pow(vFres, 1.1) * 0.8;",
    "    a *= mix(0.2 + power * 0.3, 1.0, ab);",
    "  }",
    "  col *= 1.0 + night * 0.35 * step(layer, 1.5);",            // dusk / night: the plume reads hotter against the dark
    "  gl_FragColor = vec4(col, a);",
    "}"
  ].join("\n");
  // dusk/night factor shared by every exhaust material (driven by fx.update from the sun elevation)
  const FLAME_NIGHT = (RJ.FLAME_NIGHT = RJ.FLAME_NIGHT || { value: 0 });
  function flameMaterial(o, layer = 0) {
    return new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: {
        time: { value: Math.random() * 10 }, power: { value: 0.5 }, ab: { value: 0 }, seed: { value: Math.random() * 50 }, layer: { value: layer }, kick: { value: 0 }, dsp: { value: 1 }, dvis: { value: 1 },
        hot: { value: new THREE.Color(o.core || 0xfff1d0) }, mid: { value: new THREE.Color(o.color || 0xff7a26) }, night: FLAME_NIGHT
      }
    });
  }
  /** Heat-shimmer sheath: same shader (layer 2) sharing the core's animated uniforms, so no extra per-frame work. */
  function shimmerMaterial(coreMat) {
    const u = Object.assign({}, coreMat.uniforms, { layer: { value: 2 } });
    return new THREE.ShaderMaterial({ vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: u });
  }
  let haloTex = null;
  function haloTexture() {
    if (haloTex) return haloTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.18, "rgba(255,226,180,0.75)"); gr.addColorStop(0.5, "rgba(255,140,60,0.22)"); gr.addColorStop(1, "rgba(255,90,20,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (haloTex = new THREE.CanvasTexture(c));
  }
  /** Engine exhaust: hot nozzle (heat-glow emissive), shader plume and a glow disc the flight code animates. */
  function engine(g, M, r, x, y, z, o = {}) {
    let nozzle = null, lip = null;
    if (!o.noNozzle) {
      nozzle = tube(g, r * 1.12, r * 0.98, r * 1.8, x, y, z - r * 0.9, M.metal);
      // petals ring at the nozzle lip
      lip = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, r * 0.07, 6, 18), M.metal);
      lip.position.set(x, y, z - 0.02); g.add(lip);
    }
    const mat = flameMaterial(o);
    const flame = new THREE.Mesh(FLAME_GEO, mat);
    flame.position.set(x, y, z);
    flame.scale.set(r, r, 0.1);
    flame.renderOrder = 9;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 16), new THREE.MeshBasicMaterial({ color: o.rocket ? 0xffd090 : 0xff7a30, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(x, y, z - 0.02);
    // white-blue core with the shock diamonds (child of the plume: shares its scale and visibility)
    const coreMat = flameMaterial(o, 1);
    const core = new THREE.Mesh(FLAME_GEO, coreMat);
    core.scale.set(0.5, 0.5, 0.62); core.renderOrder = 10; core.visible = false;
    flame.add(core);
    // heat shimmer around the afterburner plume (child of the core: visible only with the burner lit and nearby)
    let shimmer = null;
    if (!o.rocket && !o.small && RJ.settings.quality !== "low") {
      shimmer = new THREE.Mesh(FLAME_GEO, shimmerMaterial(coreMat));
      shimmer.scale.set(3.1, 3.1, 2.3); shimmer.renderOrder = 8;
      core.add(shimmer);
    }
    // camera-facing halo for the bloom around the nozzle (child of the glow disc)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: o.rocket ? 0xffd8a8 : 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.setScalar(r * 3.2); halo.position.z = 0.05;
    glow.add(halo);
    for (const m of [flame, glow, core, halo]) m.layers.set(RJ.LATE);
    if (shimmer) shimmer.layers.set(RJ.LATE);
    g.add(flame, glow);
    g.userData.flames.push({ flame, glow, mat, core, coreMat, halo, r, small: !!o.small, rocket: !!o.rocket, nozzle, lip });
    g.userData.nozzles.push(V3(x, y, z + r * 0.3));
  }
  function missile(g, M, x, y, z, len = 3, r = 0.09) {
    tube(g, r, r, len, x, y, z, M.white);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r, r * 4, 8), M.white);
    nose.geometry.rotateX(-Math.PI / 2); nose.position.set(x, y, z - len / 2 - r * 2); g.add(nose);
    box(g, r * 5, 0.02, r * 3, x, y, z + len / 2 - r * 2, M.white);
    box(g, 0.02, r * 5, r * 3, x, y, z + len / 2 - r * 2, M.white);
  }
  function cockpit(g, y, z) { g.userData.cockpit = V3(0, y, z); }
  function tips(g, x, y, z) { g.userData.tips = [V3(x, y, z), V3(-x, y, z)]; }
  /** All-moving surfaces (stabilators, canards) on pivot groups, animated with stick input. */
  function moving(g, pts, thick, mat, pivotZ, o = {}) {
    const res = [];
    for (const s of [1, -1]) {
      const geo = new THREE.ExtrudeGeometry(shape2(pts.map(([x, z]) => [x * s, z - pivotZ])), { depth: thick, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, thick / 2, 0);
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      const piv = new THREE.Group(); piv.position.set(0, o.y || 0, pivotZ);
      const outer = new THREE.Group(); outer.rotation.z = (o.dihedral || 0) * s;
      piv.add(m); outer.add(piv); g.add(outer);
      g.userData.stabs.push({ grp: piv, s, canard: !!o.canard });
      res.push(piv);
    }
    return res;
  }
  /** Variable-sweep wings. pts are right-side planform relative to the pivot. */
  function sweepWing(g, pts, thick, mat, pivot, range, o = {}) {
    for (const s of [1, -1]) {
      const geo = new THREE.ExtrudeGeometry(shape2(pts.map(([x, z]) => [x * s, z])), { depth: thick, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, thick / 2, 0);
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      const grp = new THREE.Group(); grp.position.set(pivot[0] * s, o.y || 0, pivot[1]);
      grp.add(m); g.add(grp);
      g.userData.sweep.push({ grp, s, min: range[0], max: range[1], mach: o.mach || [0.6, 1.1] });
    }
  }
  function propeller(g, M, z, r, blades) {
    const hub = new THREE.Group(); hub.position.set(0, 0, z);
    for (let i = 0; i < blades; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, r, 0.05), M.dark);
      b.position.y = r / 2; const arm = new THREE.Group(); arm.rotation.z = (i / blades) * Math.PI * 2; arm.add(b); hub.add(arm);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    hub.add(disc);
    g.add(hub);
    g.userData.props.push({ hub, disc });
  }

  /* ======================= BUILDERS ======================= */
  const BUILDERS = {
    f16(g, M) {
      lathe(g, [[-7.6, 0], [-7.0, 0.18], [-6, 0.45], [-4.5, 0.72], [-2.5, 0.88], [0, 0.9], [3, 0.88], [5.5, 0.78], [6.6, 0.6]], M.body, { sy: 1.05 });
      blob(g, 0.5, 0.56, 1.7, 0, 0.74, -4.0, M.glass);
      blob(g, 0.45, 0.42, 4.2, 0, 0.62, 0.4, M.body);
      tube(g, 0.58, 0.62, 3.2, 0, -0.82, -1.3, M.body, 1.1, 0.75);
      box(g, 1.15, 0.7, 0.15, 0, -0.82, -2.95, M.dark);
      plate(g, [[0.55, -5.2], [1.4, -1.2], [0.6, -0.9]], 0.12, M.body);
      plate(g, [[0.8, -1.0], [4.7, 2.0], [4.7, 2.9], [0.8, 3.3]], 0.22, M.body, { y: -0.05 });
      pair((x) => missile(g, M, x, -0.05, 2.0, 2.9), 4.85);
      pair((x) => missile(g, M, x, -0.42, 1.4, 3.6, 0.09), 3.0);
      moving(g, [[0.7, 3.9], [3.0, 5.6], [3.0, 6.3], [0.7, 6.4]], 0.14, M.body, 5.0, { y: 0.05, dihedral: -0.04 });
      fin(g, [[2.6, 0.55], [5.0, 4.6], [5.9, 4.6], [6.5, 0.55]], M.trim, { thick: 0.16 });
      finPair(g, [[4.0, -0.3], [5.2, -1.0], [5.8, -1.0], [5.8, -0.3]], M.trim, 0.6, -0.5, { thick: 0.08 });
      engine(g, M, 0.5, 0, 0, 7.0);
      cockpit(g, 0.95, -4.2); tips(g, 4.85, 0, 3.0);
    },
    f22(g, M) {
      lathe(g, [[-9.2, 0], [-8.5, 0.25], [-7, 0.62], [-5, 0.95], [-2, 1.15], [1, 1.2], [5, 1.15], [8, 1.0], [9.0, 0.85]], M.body, { sx: 1.55, sy: 0.62 });
      blob(g, 0.6, 0.6, 2.3, 0, 0.62, -5.2, M.glass);
      pair((x) => { const b = box(g, 1.2, 1.35, 4.4, x, -0.05, -2.1, M.body); b.rotation.z = Math.sign(x) * 0.18; box(g, 1.05, 1.15, 0.1, x, -0.05, -4.3, M.dark); }, 2.0);
      plate(g, [[1.6, -2.6], [6.8, 2.7], [6.8, 3.5], [1.6, 5.6]], 0.25, M.body, { y: -0.05 });
      moving(g, [[1.8, 5.6], [4.4, 7.6], [4.4, 8.8], [1.8, 8.7]], 0.16, M.body, 7.0, { y: 0 });
      finPair(g, [[3.0, 0.4], [6.0, 4.0], [7.1, 4.0], [7.5, 0.4]], M.trim, 2.05, 0.47);
      pair((x) => box(g, 1.15, 0.7, 1.4, x, 0, 8.6, M.metal), 0.85);
      pair((x) => engine(g, M, 0.42, x, 0, 9.3, { noNozzle: true }), 0.85);
      cockpit(g, 0.85, -5.4); tips(g, 6.8, -0.05, 3.2);
    },
    f35a(g, M) {
      lathe(g, [[-7.8, 0], [-7.2, 0.22], [-6, 0.62], [-4, 0.98], [-1, 1.25], [2, 1.3], [5, 1.15], [6.8, 0.95], [7.4, 0.75]], M.body, { sx: 1.35, sy: 0.78 });
      blob(g, 0.62, 0.65, 2.1, 0, 0.84, -4.4, M.glass);
      pair((x) => { blob(g, 0.72, 0.8, 1.8, x, 0.12, -2.2, M.body); box(g, 0.6, 0.75, 0.1, x * 1.05, 0.12, -3.9, M.dark); }, 1.65);
      plate(g, [[1.5, -1.0], [5.35, 2.3], [5.35, 3.3], [1.5, 3.8]], 0.25, M.body);
      moving(g, [[1.5, 4.3], [3.6, 5.8], [3.6, 6.9], [1.5, 6.8]], 0.15, M.body, 5.6, { y: 0.05 });
      finPair(g, [[2.9, 0.55], [5.1, 3.6], [6.1, 3.6], [6.6, 0.55]], M.trim, 1.35, 0.42);
      engine(g, M, 0.62, 0, 0, 7.6);
      cockpit(g, 1.05, -4.5); tips(g, 5.35, 0, 2.8);
    },
    f15(g, M, o) {
      lathe(g, [[-9.6, 0], [-9, 0.25], [-7.5, 0.62], [-5.5, 0.85], [-3, 0.95], [0, 1.0], [5, 1.0], [8.5, 0.95], [9.4, 0.85]], M.body, { sx: 1.15 });
      blob(g, 2.1, 0.7, 6.0, 0, 0, 4.4, M.body);
      if (o.twoSeat) blob(g, 0.56, 0.64, 2.7, 0, 0.82, -5.0, M.glass); else blob(g, 0.55, 0.62, 2.0, 0, 0.82, -5.4, M.glass);
      pair((x) => { const b = box(g, 1.3, 1.7, 4.6, x, -0.1, -2.5, M.body); b.rotation.z = Math.sign(x) * 0.08; box(g, 1.15, 1.5, 0.12, x, -0.1, -4.8, M.dark); }, 1.75);
      if (o.cft) pair((x) => blob(g, 0.62, 0.55, 4.2, x, 0.6, 0.5, M.body), 1.6);
      plate(g, [[2.0, -1.5], [6.5, 3.2], [6.5, 4.5], [2.0, 5.0]], 0.28, M.body, { y: 0.25 });
      moving(g, [[2.0, 6.3], [4.4, 8.1], [4.4, 9.2], [2.0, 9.1]], 0.16, M.body, 7.6, { y: 0 });
      finPair(g, [[4.5, 0.6], [7.5, 3.9], [8.6, 3.9], [8.9, 0.6]], M.trim, 1.6, 0.04);
      pair((x) => missile(g, M, x, -1.0, -1.4, 3.6, 0.09), 1.2);
      pair((x) => missile(g, M, x, -1.0, 2.6, 3.6, 0.09), 1.2);
      pair((x) => engine(g, M, 0.55, x, 0, 9.7), 0.85);
      cockpit(g, 1.0, -5.6); tips(g, 6.5, 0.25, 4.0);
    },
    fa18(g, M, o) {
      lathe(g, [[-9.1, 0], [-8.5, 0.22], [-7, 0.58], [-5, 0.82], [-2, 0.95], [1, 1.0], [5, 0.95], [8, 0.8], [8.8, 0.65]], M.body, { sx: 1.25, sy: 0.95 });
      plate(g, [[0.8, -7], [2.4, -1.5], [1.0, -1.0]], 0.12, M.body, { y: 0.3 });
      blob(g, 0.52, 0.6, 2.0, 0, 0.85, -5.6, M.glass);
      pair((x) => { box(g, 1.0, 1.15, 3.4, x, -0.4, -1.8, M.body); box(g, 0.85, 1.0, 0.1, x, -0.4, -3.5, M.dark); }, 1.55);
      plate(g, [[1.5, -1.0], [6.8, 2.8], [6.8, 3.6], [1.5, 4.4]], 0.25, M.body, { y: 0.1 });
      moving(g, [[1.5, 5.5], [4.2, 7.3], [4.2, 8.4], [1.5, 8.2]], 0.15, M.body, 6.9, { y: 0.2 });
      finPair(g, [[2.0, 0.6], [5.1, 4.4], [6.1, 4.4], [6.6, 0.6]], M.trim, 1.1, 0.35);
      if (o.growler) {
        pair((x) => tube(g, 0.22, 0.22, 2.4, x, 0.1, 2.6, M.white), 6.9);
        pair((x) => { tube(g, 0.32, 0.32, 4.2, x, -0.65, 1.2, M.trim); box(g, 0.06, 0.5, 1.2, x, -0.3, 1.2, M.dark); }, 3.6);
        tube(g, 0.32, 0.32, 4.2, 0, -1.25, 0.8, M.trim);
      } else {
        pair((x) => missile(g, M, x, 0.1, 2.4, 3.0), 6.9);
        pair((x) => missile(g, M, x, -0.55, 1.2, 3.6, 0.1), 3.6);
      }
      pair((x) => engine(g, M, 0.5, x, 0, 9.2), 0.7);
      cockpit(g, 1.0, -5.8); tips(g, 6.9, 0.1, 3.2);
    },
    a10(g, M) {
      lathe(g, [[-8, 0], [-7.6, 0.3], [-6.8, 0.75], [-5, 0.95], [-2, 1.0], [2, 0.95], [5, 0.75], [7.5, 0.45], [8.2, 0.3]], M.body, { sy: 1.15 });
      tube(g, 0.12, 0.12, 1.4, 0, -0.45, -8.5, M.metal);
      blob(g, 0.62, 0.65, 1.5, 0, 0.98, -5.2, M.glass);
      plate(g, [[0.9, -1.4], [8.75, -0.6], [8.75, 1.3], [0.9, 1.6]], 0.36, M.body, { y: -0.55, dihedral: 0.04 });
      pair((x) => blob(g, 0.45, 0.42, 2.3, x, -0.75, -0.6, M.body), 2.6);
      pair((x) => { tube(g, 0.62, 0.62, 3.4, x, 1.3, 3.9, M.body); box(g, 0.3, 0.6, 1.6, x * 0.8, 0.9, 3.9, M.body); box(g, 0.9, 0.9, 0.1, x, 1.3, 2.2, M.dark); }, 1.45);
      pair((x) => engine(g, M, 0.46, x, 1.3, 5.75, { small: true }), 1.45);
      plate(g, [[0.4, 5.9], [3.7, 6.1], [3.7, 7.4], [0.4, 7.6]], 0.16, M.body, { y: 0.35 });
      pair((x) => fin(g, [[6.0, -0.9], [6.35, 2.0], [7.5, 2.0], [7.7, -0.9]], M.trim, { x, y: 0.35, thick: 0.14 }), 3.75);
      pair((x) => missile(g, M, x, -0.95, -0.4, 2.5, 0.15), 5.2);
      cockpit(g, 1.2, -5.3); tips(g, 8.75, -0.5, 0.4);
    },
    f14(g, M) {
      lathe(g, [[-9.5, 0], [-9, 0.22], [-7.5, 0.6], [-5.5, 0.85], [-3, 0.95], [0, 1.0], [3, 0.9]], M.body);
      box(g, 4.4, 0.9, 9.6, 0, -0.1, 3.0, M.body);
      plate(g, [[1.0, -3.6], [3.3, -0.6], [3.3, 1.2], [1.0, 1.0]], 0.5, M.body, { y: 0 });
      blob(g, 0.55, 0.62, 2.5, 0, 0.82, -5.6, M.glass);
      pair((x) => { box(g, 1.3, 1.5, 5.0, x, -0.25, -1.4, M.body); box(g, 1.15, 1.35, 0.12, x, -0.25, -3.9, M.dark); }, 1.95);
      sweepWing(g, [[0, -0.6], [6.9, 0.6], [6.9, 1.5], [0, 1.7]], 0.22, M.body, [3.1, 0.3], [0.35, 1.17], { y: 0.05, mach: [0.55, 1.05] });
      pair((x) => tube(g, 0.66, 0.72, 8.2, x, -0.38, 4.6, M.body), 1.6);
      moving(g, [[2.0, 6.6], [5.0, 8.6], [5.0, 9.7], [2.0, 9.6]], 0.16, M.body, 8.2, { y: -0.1 });
      finPair(g, [[4.8, 0.4], [7.6, 3.9], [8.6, 3.9], [9.0, 0.4]], M.trim, 1.6, 0.09);
      pair((x) => missile(g, M, x, -0.75, -0.8, 4.0, 0.19), 0.8);
      pair((x) => missile(g, M, x, -0.75, 3.3, 4.0, 0.19), 0.8);
      pair((x) => engine(g, M, 0.55, x, -0.38, 9.3), 1.6);
      cockpit(g, 1.0, -6.0); tips(g, 9.9, 0, 0.5);
    },
    f4(g, M) {
      lathe(g, [[-9.6, 0], [-9, 0.3], [-7.5, 0.62], [-5.5, 0.85], [-3, 1.0], [0, 1.1], [4, 1.0], [7, 0.7], [9.0, 0.45]], M.body, { sx: 1.1 });
      lathe(g, [[-9.6, 0], [-9, 0.3], [-8.2, 0.48]], M.dark, { sx: 1.1 });
      blob(g, 0.55, 0.6, 3.0, 0, 0.78, -4.6, M.glass);
      box(g, 1.12, 0.05, 0.08, 0, 1.3, -4.6, M.dark);
      pair((x) => { box(g, 1.1, 1.4, 4.2, x, 0, -2.3, M.body); box(g, 0.08, 1.5, 1.0, x * 0.82, 0, -4.4, M.metal); box(g, 0.95, 1.2, 0.12, x, 0, -4.4, M.dark); }, 1.45);
      plate(g, [[1.1, -2.0], [4.0, 1.5], [4.0, 2.8], [1.1, 3.6]], 0.26, M.body, { y: -0.2 });
      plate(g, [[4.0, 1.5], [5.85, 3.1], [5.85, 3.7], [4.0, 2.8]], 0.2, M.body, { y: -0.2, pivotX: 4.0, dihedral: 0.21 });
      moving(g, [[0.6, 7.0], [3.0, 8.4], [3.0, 9.1], [0.6, 9.2]], 0.14, M.body, 8.0, { y: 0.5, dihedral: -0.4 });
      fin(g, [[5.5, 0.7], [8.2, 3.8], [9.0, 3.8], [9.4, 0.7]], M.trim);
      pair((x) => missile(g, M, x, -1.05, -1.0, 3.6, 0.1), 0.8);
      pair((x) => missile(g, M, x, -1.05, 2.4, 3.6, 0.1), 0.8);
      pair((x) => engine(g, M, 0.5, x, -0.1, 8.9), 0.75);
      cockpit(g, 1.0, -5.4); tips(g, 5.85, 0.3, 3.4);
    },
    p51(g, M) {
      lathe(g, [[-4.6, 0.36], [-4.4, 0.5], [-3.8, 0.6], [-2, 0.7], [0, 0.72], [2.0, 0.55], [4.0, 0.32], [5.0, 0.12]], M.body, { sx: 0.95, sy: 1.1 });
      lathe(g, [[-5.3, 0], [-5.0, 0.22], [-4.6, 0.37]], M.accent);
      propeller(g, M, -4.85, 1.7, 4);
      blob(g, 0.42, 0.5, 1.0, 0, 0.62, -0.3, M.glass);
      blob(g, 0.42, 0.36, 1.5, 0, -0.68, 0.8, M.body); box(g, 0.6, 0.5, 0.06, 0, -0.66, -0.6, M.dark);
      plate(g, [[0.6, -1.8], [5.65, -0.6], [5.65, 0.4], [0.6, 0.8]], 0.24, M.body, { y: -0.45, dihedral: 0.08 });
      plate(g, [[0.3, 4.0], [2.1, 4.2], [2.1, 4.9], [0.3, 5.0]], 0.1, M.body, { y: 0.05 });
      fin(g, [[3.7, 0.3], [4.4, 1.75], [4.9, 1.75], [5.1, 0.2]], M.body, { thick: 0.1 });
      pair((x) => { for (let i = 0; i < 6; i++) box(g, 0.08, 0.1, 0.14, x, 0.18, -3.6 + i * 0.22, M.dark); }, 0.47);
      plate(g, [[5.0, -0.85], [5.65, -0.6], [5.65, 0.4], [5.0, 0.55]], 0.25, M.accent, { y: -0.45, dihedral: 0.08 });
      g.userData.nozzles.push(V3(0.5, 0.2, -2.8), V3(-0.5, 0.2, -2.8));
      cockpit(g, 0.82, -0.25); tips(g, 5.65, 0, 0);
    },
    f117(g, M) {
      // Faceted body from flat triangles
      const P = { N: [0, 0, -10], T1: [6.6, 0, 4.3], T2: [4.4, 0, 5.2], T3: [2.4, 0, 6.6], C: [0, 0, 5.3], K: [0, 1.4, -2.6], B: [0, 1.0, 3.0], U: [0, -0.55, 0.5] };
      const tri = [];
      const add = (a, b, c) => tri.push(...a, ...b, ...c);
      const m = (p) => [-p[0], p[1], p[2]];
      add(P.N, P.K, P.T1); add(P.K, P.B, P.T1); add(P.B, P.T2, P.T1); add(P.B, P.T3, P.T2); add(P.B, P.C, P.T3);
      add(m(P.T1), P.K, P.N); add(m(P.T1), P.B, P.K); add(m(P.T1), m(P.T2), P.B); add(m(P.T2), m(P.T3), P.B); add(m(P.T3), P.C, P.B);
      add(P.N, P.T1, P.U); add(P.T1, P.T2, P.U); add(P.T2, P.T3, P.U); add(P.T3, P.C, P.U);
      add(P.U, m(P.T1), P.N); add(P.U, m(P.T2), m(P.T1)); add(P.U, m(P.T3), m(P.T2)); add(P.U, P.C, m(P.T3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
      geo.computeVertexNormals();
      const body = new THREE.Mesh(geo, M.facet); body.castShadow = true; g.add(body);
      const cg = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 4), M.glass);
      cg.geometry.rotateX(-Math.PI / 2); cg.rotation.z = Math.PI / 4; cg.scale.set(1, 0.6, 1); cg.position.set(0, 1.0, -4.0); g.add(cg);
      finPair(g, [[3.2, 0.8], [5.8, 3.4], [6.6, 3.4], [6.4, 0.8]], M.facet, 0.8, 0.85, { thick: 0.14 });
      pair((x) => box(g, 2.0, 0.12, 0.5, x, 0.3, 5.4, M.dark), 1.4);
      pair((x) => engine(g, M, 0.3, x, 0.3, 5.7, { noNozzle: true, small: true }), 1.4);
      cockpit(g, 1.35, -3.6); tips(g, 6.6, 0, 4.3);
    },
    yf23(g, M) {
      lathe(g, [[-10.3, 0], [-9.6, 0.25], [-8, 0.62], [-6, 0.85], [-3.5, 0.9], [-1, 0.85], [1, 0.7]], M.body, { sx: 1.25, sy: 0.8 });
      pair((x) => blob(g, 1.0, 0.75, 8.2, x, 0, 2.6, M.body), 1.7);
      blob(g, 1.5, 0.5, 7.2, 0, 0.1, 1.6, M.body);
      blob(g, 0.55, 0.55, 2.4, 0, 0.62, -6.3, M.glass);
      pair((x) => box(g, 0.9, 0.7, 0.12, x, -0.45, -3.6, M.dark), 1.7);
      plate(g, [[1.5, -3.0], [6.65, 3.6], [5.2, 5.4], [1.5, 4.2]], 0.24, M.body);
      finPair(g, [[3.5, 0.5], [7.2, 4.2], [8.6, 4.2], [8.8, 0.5]], M.trim, 2.2, 0.87);
      pair((x) => box(g, 1.4, 0.22, 1.8, x, 0.68, 8.6, M.dark), 1.7);
      pair((x) => engine(g, M, 0.42, x, 0.62, 9.6, { noNozzle: true }), 1.7);
      cockpit(g, 0.85, -6.5); tips(g, 6.65, 0, 3.6);
    },
    flyingWing(g, M, o) {
      const half = o.half;
      const full = half.concat(half.slice(1, -1).reverse().map(([x, z]) => [-x, z]));
      plate(g, full, 0.8, M.body, { mirror: false });
      blob(g, o.hump[0], o.hump[1], o.hump[2], 0, 0.3, o.hump[3], M.body);
      pair((x) => blob(g, 2.0, 0.9, o.nac, x, 0.4, 0.6, M.body), o.engX);
      pair((x) => box(g, 1.6, 0.25, 0.4, x, 0.95, -2.2, M.dark), o.engX);
      pair((x) => box(g, 2.4, 0.2, 1.1, x, 0.78, o.exZ, M.dark), o.engX);
      pair((x) => box(g, o.win[0], 0.3, 0.7, x, o.win[1], o.win[2], M.glass), o.win[3]);
      pair((x) => { engine(g, M, 0.3, x - 0.6, 0.78, o.exZ + 0.5, { noNozzle: true, small: true }); engine(g, M, 0.3, x + 0.6, 0.78, o.exZ + 0.5, { noNozzle: true, small: true }); }, o.engX);
      cockpit(g, o.win[1] + 0.3, o.win[2] - 0.2); tips(g, half[1][0], 0, half[1][1] + 1);
    },
    b1b(g, M) {
      lathe(g, [[-22, 0], [-21, 0.6], [-18, 1.5], [-14, 2.1], [-8, 2.3], [0, 2.3], [10, 2.2], [17, 1.8], [21.5, 1.0], [22.5, 0.6]], M.body, { sy: 1.05 });
      plate(g, [[1.8, -8], [6.8, -1], [6.8, 4], [1.8, 6]], 0.9, M.body, { y: -0.2 });
      blob(g, 1.25, 0.5, 1.8, 0, 1.75, -17.5, M.glass);
      sweepWing(g, [[0, -1.5], [14.1, 1.5], [14.1, 3.2], [0, 3.5]], 0.35, M.body, [6.8, 0.5], [0.27, 1.15], { y: 0.0, mach: [0.65, 1.0] });
      pair((x) => { blob(g, 1.7, 1.2, 6.5, x, -2.3, 4.2, M.body); box(g, 2.6, 1.1, 0.2, x, -2.2, 0.0, M.dark); }, 3.2);
      pair((x) => { engine(g, M, 0.55, x - 0.75, -2.3, 10.4); engine(g, M, 0.55, x + 0.75, -2.3, 10.4); }, 3.2);
      plate(g, [[0, 19], [7.0, 21.5], [7.0, 22.8], [0, 22.6]], 0.25, M.body, { y: 3.0 });
      fin(g, [[14, 1.6], [19.5, 8.5], [22, 8.5], [22.6, 1.6]], M.trim, { thick: 0.35 });
      cockpit(g, 2.1, -17.8); tips(g, 20.9, 0, 3);
    },
    b52(g, M) {
      lathe(g, [[-24, 0], [-23.2, 1.0], [-21, 1.8], [-17, 2.2], [-10, 2.3], [10, 2.3], [18, 1.9], [23, 1.1], [24.3, 0.7]], M.body, { sx: 0.95, sy: 1.15 });
      blob(g, 1.3, 0.45, 1.5, 0, 1.85, -20.2, M.glass);
      plate(g, [[1.0, -6.5], [28.2, 10.0], [28.2, 12.0], [1.0, 4.0]], 0.6, M.body, { y: 1.6, dihedral: -0.035 });
      [7.5, 14.5].forEach((px) => pair((x) => {
        const zp = -6.5 + Math.abs(x) * 0.6 - 1.5;
        box(g, 0.3, 1.0, 3.0, x, 0.9, zp + 1.0, M.body);
        tube(g, 0.62, 0.58, 5.2, x - 0.75, 0.15, zp, M.body);
        tube(g, 0.62, 0.58, 5.2, x + 0.75, 0.15, zp, M.body);
        box(g, 2.6, 1.1, 0.15, x, 0.15, zp - 2.6, M.dark);
        engine(g, M, 0.38, x - 0.75, 0.15, zp + 2.7, { small: true });
        engine(g, M, 0.38, x + 0.75, 0.15, zp + 2.7, { small: true });
      }, px));
      pair((x) => blob(g, 0.6, 0.6, 4.0, x, 1.0, 6.8, M.body), 22);
      plate(g, [[0.5, 20], [8.5, 23.5], [8.5, 25], [0.5, 25]], 0.25, M.body, { y: 1.6 });
      fin(g, [[14, 1.8], [20.5, 12.5], [23.5, 12.5], [24.2, 1.8]], M.trim, { thick: 0.35 });
      tube(g, 0.25, 0.3, 1.4, 0, 0.6, 24.8, M.dark);
      cockpit(g, 2.3, -20.6); tips(g, 28.2, 1.6, 11);
    },
    xb70(g, M) {
      lathe(g, [[-28.8, 0], [-27.5, 0.5], [-24, 1.1], [-19, 1.5], [-13, 1.6], [-6, 1.6], [0, 1.4]], M.body);
      blob(g, 0.9, 0.45, 2.2, 0, 1.25, -22, M.glass);
      moving(g, [[0.8, -20], [4.4, -17.5], [4.4, -16.8], [0.8, -16.3]], 0.15, M.body, -18, { y: 0.6, canard: true });
      box(g, 5.0, 2.3, 24, 0, -1.6, 13, M.body);
      box(g, 4.6, 2.0, 0.3, 0, -1.6, 1.0, M.dark);
      plate(g, [[2.0, -4], [10, 13.4], [10, 27], [2.0, 27]], 0.6, M.body);
      for (const s of [1, -1]) {
        const geo = new THREE.ExtrudeGeometry(shape2([[0, 13.4], [6 * s, 26.5], [6 * s, 28], [0, 27]]), { depth: 0.45, bevelEnabled: false });
        geo.rotateX(Math.PI / 2); geo.translate(0, 0.225, 0);
        const m = new THREE.Mesh(geo, M.body); m.castShadow = true;
        const hinge = new THREE.Group(); hinge.position.set(10 * s, 0, 0); hinge.add(m); g.add(hinge);
        g.userData.droop.push({ grp: hinge, s });
      }
      finPair(g, [[21, 0.5], [25.5, 6.5], [28, 6.5], [28.5, 0.5]], M.trim, 2.6, 0.0, { thick: 0.3 });
      for (let i = 0; i < 6; i++) engine(g, M, 0.5, -2.0 + i * 0.8, -1.6, 26.0);
      cockpit(g, 1.7, -22.3); tips(g, 16, 0, 27);
    },
    blackbird(g, M, o) {
      lathe(g, [[-16.3, 0], [-15, 0.35], [-12, 0.75], [-8, 1.0], [-3, 1.15], [3, 1.15], [9, 1.0], [13, 0.8], [14.5, 0.5]], M.body, { sx: 1.2, sy: 0.8 });
      plate(g, [[0.6, o.yf12 ? -11 : -15.5], [2.6, -4.0], [2.6, 0], [0.6, 0]], 0.12, M.body);
      if (o.yf12) { lathe(g, [[-16.3, 0], [-15, 0.45], [-12.5, 0.9]], M.dark, { sy: 0.85 }); pair((x) => blob(g, 0.25, 0.2, 0.6, x, 0.05, -10.8, M.glass), 0.75); }
      plate(g, [[1.5, -4.5], [8.45, 6.5], [8.45, 8.5], [1.5, 9.0]], 0.2, M.body, { y: -0.1 });
      pair((x) => { tube(g, 1.15, 1.2, 12, x, 0, 3.5, M.body); lathe(g, [[-10.3, 0], [-8.4, 0.5], [-7.6, 0.7]], M.metal, { x }); }, 4.0);
      finPair(g, [[5.5, 1.0], [8.8, 3.9], [10.0, 3.9], [10.5, 1.0]], M.trim, 4.0, -0.26, { thick: 0.16 });
      if (o.yf12) { pair((x) => fin(g, [[6.5, -1.0], [8.5, -2.2], [9.6, -2.2], [10.0, -1.0]], M.trim, { x }), 4.0); fin(g, [[3.5, -0.8], [6.5, -2.6], [8.5, -2.6], [8.8, -0.8]], M.trim); }
      pair((x) => engine(g, M, 0.75, x, 0, 9.7), 4.0);
      blob(g, 0.5, 0.42, 1.8, 0, 0.62, -10.5, M.glass);
      cockpit(g, 0.95, -10.8); tips(g, 8.45, -0.1, 7.5);
    },
    x15(g, M) {
      lathe(g, [[-7.8, 0], [-7, 0.3], [-5, 0.6], [-2, 0.72], [3, 0.72], [6.8, 0.68], [7.6, 0.6]], M.body);
      pair((x) => box(g, 0.5, 0.42, 8.5, x, 0, 0, M.body), 0.78);
      blob(g, 0.4, 0.45, 1.3, 0, 0.62, -4.8, M.glass);
      plate(g, [[0.7, 0.0], [3.4, 2.6], [3.4, 3.4], [0.7, 4.0]], 0.12, M.body);
      moving(g, [[0.7, 5.0], [2.9, 6.7], [2.9, 7.3], [0.7, 7.4]], 0.12, M.body, 6.2, { dihedral: -0.26 });
      fin(g, [[4.0, 0.5], [6.4, 2.6], [7.8, 2.6], [7.8, 0.5]], M.body, { thick: 0.3 });
      fin(g, [[5.0, -0.5], [6.6, -1.8], [7.8, -1.8], [7.8, -0.5]], M.body, { thick: 0.3 });
      engine(g, M, 0.55, 0, 0, 8.4, { rocket: true, color: 0xff9a50, core: 0xfff7e0 });
      cockpit(g, 0.9, -5.0); tips(g, 3.4, 0, 3.0);
    },
    /** Passenger jets, one parametric builder: o = {L, R, sy, half, c0, ct, sweep, dih, engs:[x...], nacR, nacL, finH, stabHalf, rows, winW, winH, wingY} */
    airliner(g, M, o) {
      const L = o.L, R = o.R, sy = o.sy || 1, z0 = -L / 2, z1 = L / 2;
      lathe(g, [[z0, 0], [z0 + 0.25 * R, 0.5 * R], [z0 + 0.7 * R, 0.8 * R], [z0 + 1.4 * R, 0.96 * R], [z0 + 2.4 * R, R], [z1 - 3.4 * R, R], [z1 - 1.8 * R, 0.72 * R], [z1 - 0.6 * R, 0.38 * R], [z1, 0.18 * R]], M.body, { sy, segs: 24 });
      // cockpit windscreen band and the cheatline down each side
      blob(g, 0.72 * R, 0.24 * R, 0.55 * R, 0, 0.42 * R * sy, z0 + 1.2 * R, M.dark);
      pair((x) => box(g, 0.05, 0.14 * R, L * 0.72, x, -0.05 * R * sy, -L * 0.02, M.accent), R * 1.002);
      // cabin windows: one instanced strip per deck and side
      const wins = [];
      const deckY = o.rows || [0.18];
      for (const dy of deckY) {
        const y = dy * R * sy, xs = R * Math.sqrt(Math.max(0, 1 - Math.pow(dy, 2))) + 0.02;
        for (let z = z0 + 2.6 * R; z < z1 - 3.0 * R; z += o.winW * 2.1) for (const sx of [1, -1]) wins.push([xs * sx, y, z]);
      }
      const wg = new THREE.BoxGeometry(0.06, o.winH, o.winW);
      const wi = new THREE.InstancedMesh(wg, M.dark, wins.length);
      const m4 = new THREE.Matrix4();
      wins.forEach((w, i) => { m4.makeTranslation(w[0], w[1], w[2]); wi.setMatrixAt(i, m4); });
      g.add(wi);
      // swept low wing with winglets
      const wy = (o.wingY != null ? o.wingY : -0.55) * R * sy, tanS = Math.tan(o.sweep), rx = 0.6 * R;
      const zLE0 = -L * 0.1, zLEt = zLE0 + (o.half - rx) * tanS;
      plate(g, [[rx, zLE0], [o.half, zLEt], [o.half, zLEt + o.ct], [rx, zLE0 + o.c0]], o.c0 * 0.07, M.body, { y: wy, dihedral: o.dih });
      const tipY = wy + o.half * Math.sin(o.dih);
      const wl = o.ct * 1.1;
      pair((x) => fin(g, [[zLEt + o.ct * 0.15, 0], [zLEt + o.ct * 0.15 + wl * 0.6, wl * 1.2], [zLEt + o.ct * 0.15 + wl * 0.95, wl * 1.25], [zLEt + o.ct, 0.1], [zLEt + o.ct * 0.6, 0]], M.trim, { x, y: tipY, thick: 0.12, tilt: x > 0 ? -0.12 : 0.12 }), o.half);
      // belly fairing where the wing meets the body
      blob(g, R * 0.95, R * 0.45, o.c0 * 0.75, 0, wy + 0.1 * R, zLE0 + o.c0 * 0.45, M.body);
      // engines on pylons under the wing
      if (o.rearEng) pair((x) => { // business jet: engines on pylons either side of the rear fuselage
        const r = o.nacR, len = o.nacL, zc = z1 - 3.6 * R, yc = R * sy * 0.45;
        tube(g, r, r * 0.85, len, x, yc, zc, M.white);
        tube(g, r * 0.86, r * 0.86, 0.1, x, yc, zc - len / 2 - 0.02, M.dark);
        box(g, Math.abs(x) - R * 0.8, r * 0.35, len * 0.5, Math.sign(x) * (R * 0.8 + (Math.abs(x) - R * 0.8) / 2), yc, zc, M.body);
        engine(g, M, r * 0.55, x, yc, zc + len / 2 + 0.3, { small: true, noNozzle: true, color: 0x9a8a78, core: 0xd8d0c4 });
      }, R + o.nacR * 1.3);
      for (const ex of o.rearEng ? [] : o.engs) pair((x) => {
        const zle = zLE0 + (Math.abs(x) - rx) * tanS, yw = wy + Math.abs(x) * Math.sin(o.dih);
        const r = o.nacR, len = o.nacL, zc = zle - len * 0.18, yc = yw - r * 1.25;
        tube(g, r, r * 0.82, len, x, yc, zc, M.white);
        tube(g, r * 0.86, r * 0.86, 0.12, x, yc, zc - len / 2 - 0.02, M.dark);
        tube(g, r * 0.45, r * 0.2, len * 0.35, x, yc, zc + len / 2 + len * 0.12, M.metal);
        box(g, r * 0.25, r * 1.1, len * 0.75, x, yw - r * 0.45, zc + len * 0.2, M.body);
        engine(g, M, r * 0.55, x, yc, zc + len / 2 + len * 0.28, { small: true, noNozzle: true, color: 0x9a8a78, core: 0xd8d0c4 });
      }, ex);
      // tail: fin with rudder, all-moving stabilisers
      const fc0 = o.finH * 1.05, finY = R * sy * 0.62, fz0 = z1 - fc0 - 0.45 * R, ftan = Math.tan(0.62);
      fin(g, [[fz0, finY], [fz0 + o.finH * ftan, finY + o.finH], [fz0 + o.finH * ftan + fc0 * 0.38, finY + o.finH], [z1 - 0.35 * R, finY]], M.trim, { thick: Math.max(0.2, R * 0.14) });
      const sc0 = o.stabHalf * 0.55, sz0 = z1 - 2.6 * R - sc0 * 0.35, stan = Math.tan(o.sweep + 0.08);
      // T-tail (cargo, business jets): the stabiliser sits on top of the fin
      const tz = o.tTail ? fz0 + o.finH * ftan - sz0 + fc0 * 0.05 : 0, ty = o.tTail ? finY + o.finH * 0.97 : 0.15 * R * sy;
      moving(g, [[o.tTail ? 0.1 : 0.3 * R, sz0 + tz], [o.stabHalf, sz0 + tz + o.stabHalf * stan], [o.stabHalf, sz0 + tz + o.stabHalf * stan + sc0 * 0.4], [o.tTail ? 0.1 : 0.3 * R, sz0 + tz + sc0]], Math.max(0.12, sc0 * 0.07), M.body, sz0 + tz + sc0 * 0.5, { y: ty });
      cockpit(g, 0.42 * R * sy, z0 + 1.35 * R);
      tips(g, o.half, tipY, zLEt + o.ct * 0.5);
    },
    hyperion(g, M) {
      lathe(g, [[-15, 0], [-13, 0.3], [-9, 0.75], [-4, 1.05], [2, 1.2], [8, 1.1], [13, 0.9], [14.5, 0.7]], M.facet, { sx: 1.8, sy: 0.55, segs: 8 });
      plate(g, [[0.6, -14.5], [3.6, -2.0], [3.6, 1.0], [0.6, 1.0]], 0.15, M.facet);
      plate(g, [[2.5, -2.0], [7.0, 9.5], [7.0, 11.5], [2.5, 12.5]], 0.25, M.facet);
      box(g, 2.6, 0.9, 9, 0, -0.85, 2.5, M.trim);
      box(g, 2.4, 0.7, 0.15, 0, -0.85, -2.0, M.glow);
      fin(g, [[7.0, 0.6], [11.5, 5.0], [12.8, 5.0], [13.6, 0.6]], M.facet, { thick: 0.18 });
      finPair(g, [[9.0, -0.4], [11.5, -1.8], [12.5, -1.8], [13.0, -0.4]], M.facet, 2.5, -0.6, { thick: 0.12 });
      box(g, 2.3, 0.7, 1.2, 0, -0.7, 14.3, M.dark);
      pair((x) => engine(g, M, 0.52, x, -0.7, 15.0, { noNozzle: true, color: 0x5aa0ff, core: 0xd8ecff }), 0.62);
      plate(g, [[3.4, -2.0], [3.6, -2.0], [3.6, 1.0], [3.4, 1.0]], 0.17, M.glow);
      blob(g, 0.45, 0.32, 1.9, 0, 0.62, -8.5, M.glass);
      cockpit(g, 0.85, -8.8); tips(g, 7.0, 0, 10.5);
    }
  };

  // shared with vehicles.js, which adds helicopters, starfighters, flying cars and the rocket bike
  RJ.AC_BUILDERS = BUILDERS;
  RJ.acParts = { lathe, plate, fin, finPair, blob, box, tube, pair, engine, cockpit, tips, moving, propeller, shape2 };

  /* ======================= CATALOG ======================= */
  // Flight: vmax m/s at refAlt; mil/ab = thrust accel m/s² at sea level; vstall m/s; roll/pitch/yaw deg/s; ind = induced-drag factor.
  const GUN = {
    m61: { name: "M61 Vulcan 20 mm", rate: 100, dmg: 6, heat: 0.0085, spread: 0.0022, speed: 1050 },
    gau22: { name: "GAU-22/A 25 mm", rate: 55, dmg: 7.6, heat: 0.012, spread: 0.0018, speed: 1050 },
    gau8: { name: "GAU-8/A Avenger 30 mm", rate: 65, dmg: 15, heat: 0.0105, spread: 0.0035, speed: 1010, brrt: true },
    m2: { name: "6× M2 Browning .50 cal", rate: 72, dmg: 3.6, heat: 0.0075, spread: 0.005, speed: 880 },
    tail: { name: "Tail turret (historic)", rate: 60, dmg: 4, heat: 0.006, spread: 0.006, speed: 950, turret: true }
  };
  const A = {};
  const add = (id, o) => { A[id] = Object.assign({ id }, o); };

  add("f22", { name: "F-22 Raptor", short: "F-22", cat: "modern", role: "Stealth air superiority", status: "Active · USAF", year: 1997,
    desc: "Fifth-generation stealth fighter with thrust-vectoring nozzles and supercruise. The best dogfighter in the game.",
    colors: { body: 0x868e97, trim: 0x6b737c, glass: 0x8f7a3a }, build: "f22",
    flight: { vmax: 680, ref: 12000, mil: 8.6, ab: 14.5, vstall: 54, gmax: 9.5, roll: 285, pitch: 44, yaw: 32, ind: 0.45, eng: "jet" },
    hp: 140, stealth: 1.6, radar: 10000, gun: GUN.m61, msl: { n: 8, name: "AIM-120D + AIM-9X", lock: 0.9, cone: 42, range: 7500 }, flares: 30,
    unlock: { xp: 5000 }, sound: { type: "jet", pitch: 1.0 } });
  add("f35a", { name: "F-35A Lightning II", short: "F-35A", cat: "modern", role: "Stealth multirole", status: "Active · USAF", year: 2006,
    desc: "Sensor-fusion stealth fighter. Fastest missile lock, widest seeker cone and the longest radar picture of any fighter.",
    colors: { body: 0x6f767d, trim: 0x5c6268, glass: 0x8a6f2c }, build: "f35a",
    flight: { vmax: 530, ref: 11000, mil: 7, ab: 12.8, vstall: 60, gmax: 9, roll: 240, pitch: 35, yaw: 26, ind: 0.55, eng: "jet" },
    hp: 130, stealth: 1.7, radar: 13000, gun: GUN.gau22, msl: { n: 6, name: "AIM-120D", lock: 0.55, cone: 60, range: 9000 }, flares: 30,
    unlock: { xp: 800 }, sound: { type: "jet", pitch: 0.9 } });
  add("f15ex", { name: "F-15EX Eagle II", short: "F-15EX", cat: "modern", role: "Heavy air superiority", status: "Active · USAF", year: 2021,
    desc: "Newest Eagle with fly-by-wire and digital cockpit. Brutal acceleration, top-end speed and twelve air-to-air missiles.",
    colors: { body: 0x7a838c, trim: 0x5e666e, glass: 0x5d6f80 }, build: "f15", buildOpts: { twoSeat: true, cft: true },
    flight: { vmax: 740, ref: 12000, mil: 7.6, ab: 16.8, vstall: 70, gmax: 9, roll: 240, pitch: 32, yaw: 22, ind: 0.6, eng: "jet" },
    hp: 175, stealth: 1, radar: 11000, gun: GUN.m61, msl: { n: 12, name: "AIM-120 + AIM-9X", lock: 0.85, cone: 45, range: 9000 }, flares: 30,
    unlock: { xp: 3500 }, sound: { type: "jet", pitch: 0.85 } });
  add("f16", { name: "F-16 Fighting Falcon", short: "F-16", cat: "modern", role: "Lightweight dogfighter", status: "Active · USAF", year: 1974,
    desc: "Fly-by-wire pioneer with a bubble canopy and the fastest roll rate in the game. Light, nimble and unforgiving of mistakes.",
    colors: { body: 0x9aa4ae, trim: 0x7f8994, glass: 0xa0863c }, build: "f16",
    flight: { vmax: 600, ref: 11000, mil: 6.8, ab: 13.5, vstall: 66, gmax: 9, roll: 320, pitch: 38, yaw: 28, ind: 0.55, eng: "jet" },
    hp: 110, stealth: 1, radar: 8000, gun: GUN.m61, msl: { n: 6, name: "AIM-120 + AIM-9", lock: 1.0, cone: 35, range: 6500 }, flares: 30,
    unlock: { start: true }, sound: { type: "jet", pitch: 1.05 } });
  add("fa18e", { name: "F/A-18E Super Hornet", short: "F/A-18E", cat: "modern", role: "Carrier strike fighter", status: "Active · US Navy", year: 1995,
    desc: "Navy workhorse with big leading-edge extensions. Excellent slow-speed nose authority and a deep missile load.",
    colors: { body: 0x8e98a2, trim: 0x737d88, glass: 0x5d6f80 }, build: "fa18",
    flight: { vmax: 500, ref: 11000, mil: 6, ab: 11.2, vstall: 52, gmax: 7.5, roll: 250, pitch: 41, yaw: 30, ind: 0.6, eng: "jet" },
    hp: 150, stealth: 1, radar: 9000, gun: GUN.m61, msl: { n: 8, name: "AIM-120 + AIM-9X", lock: 0.95, cone: 40, range: 7500 }, flares: 40,
    unlock: { start: true }, sound: { type: "jet", pitch: 0.95 } });
  add("f15c", { name: "F-15C Eagle", short: "F-15C", cat: "modern", role: "Air superiority", status: "Retiring · USAF", year: 1972,
    desc: "Twin-engine air superiority fighter with a famously lopsided combat record. Very fast and climbs like a rocket.",
    colors: { body: 0x95a0ab, trim: 0x7c8792, glass: 0x5d6f80 }, build: "f15", buildOpts: {},
    flight: { vmax: 740, ref: 12000, mil: 7.2, ab: 15.8, vstall: 72, gmax: 9, roll: 230, pitch: 32, yaw: 22, ind: 0.6, eng: "jet" },
    hp: 150, stealth: 1, radar: 9000, gun: GUN.m61, msl: { n: 8, name: "AIM-120 + AIM-9", lock: 1.0, cone: 40, range: 8000 }, flares: 30,
    unlock: { start: true }, sound: { type: "jet", pitch: 0.88 } });
  add("a10", { name: "A-10 Thunderbolt II", short: "A-10", cat: "modern", role: "Close air support", status: "Active · USAF", year: 1972,
    desc: "Built around a 30 mm cannon and a titanium cockpit tub. Slow and heavy, but it takes enormous punishment and hits hardest.",
    colors: { body: 0x5f6862, trim: 0x4a524c, glass: 0x5d6f80 }, build: "a10",
    flight: { vmax: 196, ref: 1000, mil: 5.6, ab: 0, vstall: 47, gmax: 7.3, roll: 170, pitch: 31, yaw: 22, ind: 0.9, eng: "fan" },
    hp: 290, stealth: 1, radar: 5000, gun: GUN.gau8, msl: { n: 2, name: "AIM-9M", lock: 1.4, cone: 25, range: 3500 }, flares: 60,
    unlock: { start: true }, sound: { type: "fan", pitch: 1.2 } });
  add("f14", { name: "F-14 Tomcat", short: "F-14", cat: "historic", role: "Fleet defense interceptor", status: "Retired 2006 · US Navy", year: 1970,
    desc: "Variable-sweep wings that move with airspeed and the long-range AIM-54 Phoenix. Lock targets from far beyond visual range.",
    colors: { body: 0xc5cad0, trim: 0x9aa2ab, glass: 0x5d6f80 }, build: "f14",
    flight: { vmax: 690, ref: 12000, mil: 6, ab: 12.6, vstall: 58, gmax: 7.5, roll: 200, pitch: 32, yaw: 22, ind: 0.6, eng: "jet" },
    hp: 165, stealth: 1, radar: 13000, gun: GUN.m61, msl: { n: 6, name: "AIM-54 Phoenix + AIM-9", lock: 1.6, cone: 35, range: 14000 }, flares: 30,
    unlock: { xp: 1600 }, sound: { type: "jet", pitch: 0.8 } });
  add("f4", { name: "F-4 Phantom II", short: "F-4", cat: "historic", role: "Multirole fighter", status: "Retired · USAF 1996", year: 1958,
    desc: "Cold War brute with bent wingtips and a drooping tail. Fast in a straight line, heavy in the turn, slow to lock.",
    colors: { body: 0x6e7558, trim: 0x8a7a55, glass: 0x5d6f80 }, build: "f4",
    flight: { vmax: 650, ref: 11000, mil: 6, ab: 12, vstall: 75, gmax: 7, roll: 170, pitch: 28, yaw: 18, ind: 0.75, eng: "jet" },
    hp: 170, stealth: 1, radar: 7000, gun: GUN.m61, msl: { n: 8, name: "AIM-7 + AIM-9", lock: 1.5, cone: 30, range: 6000 }, flares: 30,
    unlock: { start: true }, sound: { type: "jet", pitch: 0.75 } });
  add("p51", { name: "P-51 Mustang", short: "P-51", cat: "historic", role: "WWII escort fighter", status: "Retired · 1957", year: 1940,
    desc: "Propeller-driven escort fighter with six .50 cal machine guns and an iron gunsight. No radar, no missiles, pure stick and rudder.",
    colors: { body: 0xbfc4c9, trim: 0x9da3aa, glass: 0x8aa0b4, accent: 0xe2b93b }, build: "p51",
    flight: { vmax: 196, ref: 7600, mil: 6.5, ab: 0, vstall: 44, gmax: 7, roll: 180, pitch: 36, yaw: 30, ind: 0.7, eng: "prop" },
    hp: 90, stealth: 1, radar: 0, gun: GUN.m2, msl: { n: 0 }, flares: 0, hudStyle: "gunsight",
    unlock: { start: true }, sound: { type: "prop", pitch: 1.0 } });
  add("f117", { name: "F-117 Nighthawk", short: "F-117", cat: "special", role: "Stealth strike", status: "Retired 2008 · USAF", year: 1981,
    desc: "The first operational stealth aircraft, built from flat facets. Subsonic and unarmed for air combat; here it carries two fictional defensive missiles.",
    colors: { body: 0x1e2124, trim: 0x2a2d31, glass: 0x3a4652 }, build: "f117",
    flight: { vmax: 290, ref: 9000, mil: 5.2, ab: 0, vstall: 78, gmax: 5, roll: 120, pitch: 22, yaw: 18, ind: 0.9, eng: "fan" },
    hp: 120, stealth: 2.6, radar: 5000, gun: null, msl: { n: 2, name: "Defensive missiles (fictional)", lock: 1.2, cone: 30, range: 5000 }, flares: 30, bombs: 2,
    unlock: { challenge: "canyon" }, sound: { type: "fan", pitch: 0.9 } });
  add("ea18g", { name: "EA-18G Growler", short: "EA-18G", cat: "special", role: "Electronic attack", status: "Active · US Navy", year: 2006,
    desc: "Super Hornet airframe with jamming pods instead of a gun. Enemy missile locks take twice as long and their missiles track poorly.",
    colors: { body: 0x8a949e, trim: 0x6f7983, glass: 0x5d6f80 }, build: "fa18", buildOpts: { growler: true },
    flight: { vmax: 490, ref: 11000, mil: 5.9, ab: 11, vstall: 53, gmax: 7.5, roll: 240, pitch: 40, yaw: 30, ind: 0.65, eng: "jet" },
    hp: 150, stealth: 1, jammer: true, radar: 12000, gun: null, msl: { n: 4, name: "AIM-120", lock: 0.9, cone: 40, range: 8000 }, flares: 50,
    unlock: { xp: 6500 }, sound: { type: "jet", pitch: 0.95 } });
  add("yf23", { name: "YF-23 Black Widow II", short: "YF-23", cat: "special", role: "Stealth prototype", status: "Prototype · 2 built", year: 1990,
    desc: "Lost the ATF competition to the YF-22 but was faster and stealthier. The real prototypes were unarmed; this loadout is fictional.",
    colors: { body: 0x51565d, trim: 0x3f4349, glass: 0x8f7a3a }, build: "yf23",
    flight: { vmax: 680, ref: 12000, mil: 9.4, ab: 14, vstall: 62, gmax: 8, roll: 230, pitch: 34, yaw: 22, ind: 0.5, eng: "jet" },
    hp: 135, stealth: 1.9, radar: 10000, gun: GUN.m61, msl: { n: 6, name: "Missiles (fictional loadout)", lock: 0.9, cone: 40, range: 8000 }, flares: 30,
    unlock: { xp: 14000 }, sound: { type: "jet", pitch: 0.92 } });
  add("b2", { name: "B-2 Spirit", short: "B-2", cat: "bomber", role: "Stealth strategic bomber", status: "Active · USAF", year: 1989,
    desc: "Flying wing with a sawtooth trailing edge and 52 m span. Very hard to lock. Drops bombs in Free Flight; fictional defensive missiles in Dogfight.",
    colors: { body: 0x3c4148, trim: 0x2c3036, glass: 0x1a2430 }, build: "flyingWing",
    buildOpts: { half: [[0, -10.5], [26.2, 3.8], [26.2, 5.6], [17.5, 1.0], [10.5, 7.5], [4.5, 3.4], [0, 7.8]], hump: [4.4, 1.6, 9.5, -2.5], nac: 6.5, engX: 5.2, exZ: 5.6, win: [0.9, 1.65, -7.6, 0.8] },
    flight: { vmax: 285, ref: 11000, mil: 4.0, ab: 0, vstall: 70, gmax: 2.5, roll: 55, pitch: 11, yaw: 8, ind: 1.6, eng: "fan" },
    hp: 420, stealth: 3, radar: 9000, gun: null, msl: { n: 4, name: "Defensive missiles (fictional)", lock: 1.2, cone: 180, range: 6000 }, flares: 60, bombs: 16,
    unlock: { xp: 8000 }, sound: { type: "heavy", pitch: 1.0 } });
  add("b21", { name: "B-21 Raider", short: "B-21", cat: "bomber", role: "Next-gen stealth bomber", status: "In flight test · USAF", year: 2023,
    desc: "Smaller successor to the B-2 with a simpler trailing edge. Performance figures are classified; these are estimates.",
    colors: { body: 0x4a5058, trim: 0x3a3f46, glass: 0x1a2430 }, build: "flyingWing",
    buildOpts: { half: [[0, -9], [21.5, 3.3], [21.5, 4.7], [12.5, 0.6], [4.2, 5.2], [0, 4.2]], hump: [3.8, 1.4, 8, -2.0], nac: 5.5, engX: 4.0, exZ: 3.6, win: [1.1, 1.45, -6.4, 0.85] },
    flight: { vmax: 285, ref: 11000, mil: 4.3, ab: 0, vstall: 66, gmax: 2.8, roll: 65, pitch: 12, yaw: 9, ind: 1.5, eng: "fan" },
    hp: 380, stealth: 3.2, radar: 10000, gun: null, msl: { n: 4, name: "Defensive missiles (fictional)", lock: 1.1, cone: 180, range: 6500 }, flares: 60, bombs: 12,
    unlock: { xp: 11000 }, sound: { type: "heavy", pitch: 1.1 } });
  add("b1b", { name: "B-1B Lancer", short: "B-1B", cat: "bomber", role: "Supersonic bomber", status: "Active · USAF", year: 1974,
    desc: "Swing-wing bomber with afterburners. Sweeps its wings back as it accelerates and can go supersonic down low.",
    colors: { body: 0x40454c, trim: 0x31353a, glass: 0x1a2430 }, build: "b1b",
    flight: { vmax: 370, ref: 11000, mil: 5.5, ab: 9.6, vstall: 74, gmax: 3, roll: 75, pitch: 14, yaw: 10, ind: 1.3, eng: "jet" },
    hp: 400, stealth: 1.2, radar: 9000, gun: null, msl: { n: 4, name: "Defensive missiles (fictional)", lock: 1.2, cone: 180, range: 6000 }, flares: 60, bombs: 24,
    unlock: { xp: 2400 }, sound: { type: "jet", pitch: 0.65 } });
  add("b52", { name: "B-52 Stratofortress", short: "B-52", cat: "bomber", role: "Long-range heavy bomber", status: "Active · USAF", year: 1952,
    desc: "Eight engines and a 56 m wing that droops in flight. Turns like a building. The historic tail turret defends its six automatically.",
    colors: { body: 0x5e646b, trim: 0x4d5258, glass: 0x1a2430 }, build: "b52",
    flight: { vmax: 265, ref: 10000, mil: 3.5, ab: 0, vstall: 66, gmax: 2, roll: 40, pitch: 8, yaw: 6, ind: 1.8, eng: "fan" },
    hp: 520, stealth: 1, radar: 8000, gun: GUN.tail, msl: { n: 0 }, flares: 80, bombs: 30,
    unlock: { start: true }, sound: { type: "heavy", pitch: 0.8 } });
  add("xb70", { name: "XB-70 Valkyrie", short: "XB-70", cat: "bomber", role: "Mach 3 bomber prototype", status: "Prototype · retired 1969", year: 1964,
    desc: "Six engines, canards and wingtips that fold down as it passes Mach 1 to ride its own shockwave. Unarmed prototype, Free Flight only.",
    colors: { body: 0xeeeeea, trim: 0xc9c9c4, glass: 0x1a2430 }, build: "xb70",
    flight: { vmax: 915, ref: 21000, mil: 6, ab: 12, vstall: 92, gmax: 2.5, roll: 55, pitch: 10, yaw: 8, ind: 1.4, eng: "ramjet" },
    hp: 300, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { challenge: "bombsonic" }, sound: { type: "jet", pitch: 0.6 } });
  add("sr71", { name: "SR-71 Blackbird", short: "SR-71", cat: "recon", role: "Mach 3+ reconnaissance", status: "Retired 1998 · USAF", year: 1964,
    desc: "Titanium spy plane that still holds the air-breathing speed record. Climb to 23 km for Mach 3.3. Unarmed, Free Flight only.",
    colors: { body: 0x191c20, trim: 0x24282d, glass: 0x3a4652 }, build: "blackbird", buildOpts: {},
    flight: { vmax: 975, ref: 23000, mil: 6, ab: 12.5, vstall: 88, gmax: 3, roll: 75, pitch: 11, yaw: 8, ind: 1.1, eng: "ramjet" },
    hp: 160, stealth: 1.3, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { challenge: "mach3" }, sound: { type: "jet", pitch: 0.7 } });
  add("yf12", { name: "YF-12", short: "YF-12", cat: "recon", role: "Mach 3 interceptor prototype", status: "Prototype · 3 built", year: 1963,
    desc: "Interceptor cousin of the SR-71 with a radar nose and AIM-47 Falcon missiles. Fires at enormous range, turns poorly.",
    colors: { body: 0x1d2024, trim: 0x272b30, glass: 0x3a4652 }, build: "blackbird", buildOpts: { yf12: true },
    flight: { vmax: 945, ref: 22000, mil: 6, ab: 12.5, vstall: 88, gmax: 3, roll: 75, pitch: 11, yaw: 8, ind: 1.1, eng: "ramjet" },
    hp: 160, stealth: 1.2, radar: 15000, gun: null, msl: { n: 3, name: "AIM-47 Falcon", lock: 1.3, cone: 45, range: 15000, speed: 1300 }, flares: 20,
    unlock: { challenge: "duelvet" }, sound: { type: "jet", pitch: 0.7 } });
  add("x15", { name: "X-15", short: "X-15", cat: "recon", role: "Hypersonic rocket plane", status: "Research · retired 1968", year: 1959,
    desc: "Rocket-powered research aircraft that reached Mach 6.7. The engine doesn't need air, so go high. Rocket fuel lasts 2.5 minutes, then it refuels while the throttle is idle.",
    colors: { body: 0x1d1d1f, trim: 0x2a2a2d, glass: 0x3a4652 }, build: "x15",
    flight: { vmax: 2000, ref: 30000, mil: 32, ab: 0, vstall: 105, gmax: 4, roll: 85, pitch: 14, yaw: 10, ind: 1.2, eng: "rocket", fuel: 150 },
    hp: 90, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { challenge: "alt18k" }, sound: { type: "rocket", pitch: 1.0 } });
  add("hyperion", { name: "SR-X Hyperion", short: "SR-X", cat: "recon", role: "Hypersonic strike (fictional)", status: "Fictional · SR-72-inspired", year: 2030,
    desc: "Fictional design inspired by the publicly discussed SR-72 concept. Scramjet power for Mach 6 at altitude, with fictional hypersonic missiles.",
    colors: { body: 0x23272e, trim: 0x2f343c, glass: 0x3a4652, accent: 0x3d7dff }, build: "hyperion",
    flight: { vmax: 1780, ref: 27000, mil: 9, ab: 22, vstall: 98, gmax: 4.5, roll: 110, pitch: 16, yaw: 12, ind: 0.9, eng: "scram" },
    hp: 180, stealth: 1.8, radar: 15000, gun: null, msl: { n: 4, name: "Hypersonic missiles (fictional)", lock: 0.8, cone: 40, range: 14000, speed: 1500 }, flares: 30,
    unlock: { challenge: "mach5" }, sound: { type: "jet", pitch: 0.6 } });

  add("e175", { name: "Embraer E175", short: "E175", cat: "airliner", role: "Regional jet · 76 seats", status: "In service worldwide", year: 2005,
    desc: "The small one: a twin-engine regional airliner for short hops between cities. Light on the controls for a passenger jet. Unarmed, Free Flight only.",
    colors: { body: 0xf2f3f5, trim: 0xc8312b, glass: 0x1a2430, accent: 0xc8312b }, build: "airliner",
    buildOpts: { L: 31.7, R: 1.5, half: 13.0, c0: 5.2, ct: 1.4, sweep: 0.4, dih: 0.07, engs: [4.6], nacR: 0.72, nacL: 3.6, finH: 5.2, stabHalf: 5.0, winW: 0.24, winH: 0.34 },
    flight: { vmax: 245, ref: 11000, mil: 3.7, ab: 0, vstall: 56, gmax: 2.5, roll: 48, pitch: 9, yaw: 7, ind: 1.6, eng: "fan" },
    hp: 200, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1.15 } });
  add("b738", { name: "Boeing 737-800", short: "737", cat: "airliner", role: "Narrow-body airliner · 189 seats", status: "In service worldwide", year: 1998,
    desc: "The medium one: the world's everyday airliner, with two big turbofans slung under its wings and upturned winglets. Unarmed, Free Flight only.",
    colors: { body: 0xf2f3f5, trim: 0x1f5fb8, glass: 0x1a2430, accent: 0x1f5fb8 }, build: "airliner",
    buildOpts: { L: 39.5, R: 1.88, half: 17.2, c0: 7.3, ct: 1.3, sweep: 0.44, dih: 0.1, engs: [4.9], nacR: 0.98, nacL: 4.6, finH: 7.0, stabHalf: 6.6, winW: 0.26, winH: 0.36 },
    flight: { vmax: 245, ref: 11000, mil: 3.5, ab: 0, vstall: 61, gmax: 2.5, roll: 40, pitch: 8, yaw: 6, ind: 1.7, eng: "fan" },
    hp: 260, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1.0 } });
  add("a380", { name: "Airbus A380", short: "A380", cat: "airliner", role: "Double-deck superjumbo · 555 seats", status: "In service · largest airliner", year: 2007,
    desc: "The huge one: a full-length double-deck airliner with four engines and an 80 m wing. Slow to turn, slow to stop, and amazing to fly low past a mountain. Unarmed, Free Flight only.",
    colors: { body: 0xf2f3f5, trim: 0x15294d, glass: 0x1a2430, accent: 0xc9a14a }, build: "airliner",
    buildOpts: { L: 72.7, R: 3.55, sy: 1.18, half: 39.9, c0: 17.5, ct: 4.0, sweep: 0.58, dih: 0.09, engs: [14.6, 25.8], nacR: 1.6, nacL: 7.2, finH: 13.0, stabHalf: 15.3, winW: 0.32, winH: 0.44, rows: [-0.12, 0.5], wingY: -0.6, bodyGear: true },
    flight: { vmax: 255, ref: 11000, mil: 3.1, ab: 0, vstall: 69, gmax: 2.5, roll: 26, pitch: 5.5, yaw: 4, ind: 1.9, eng: "fan" },
    hp: 480, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 0.85 } });

  RJ.AIRCRAFT = A;
  RJ.AIRCRAFT_ORDER = ["f16", "fa18e", "f15c", "a10", "f35a", "f15ex", "f22", "f14", "f4", "p51", "f117", "ea18g", "yf23", "b52", "b1b", "b2", "b21", "xb70", "sr71", "yf12", "x15", "hyperion", "e175", "b738", "a380"];
  RJ.CATEGORIES = [
    ["modern", "Modern fighters"], ["historic", "Historic fighters"], ["special", "Stealth and specialized"], ["bomber", "Bombers"], ["recon", "Reconnaissance and experimental"], ["airliner", "Passenger airliners"]
  ];

  /* ======================= DERIVED FLIGHT CONSTANTS ======================= */
  /** Installed thrust as a fraction of sea-level static, by engine type: density lapse, ram recovery with Mach
   * (much stronger in afterburner), and the inlet-temperature limit past each airframe's design Mach. */
  RJ.thrustFactor = (eng, rho, v, F, ab, mach) => {
    const M = mach != null ? mach : v / RJ.soundSpeed(F && F._alt != null ? F._alt : 0);
    switch (eng) {
      case "rocket": return 1;
      case "scram": return Math.pow(rho, 0.35);
      case "ramjet": return Math.pow(rho, 0.45) * (0.6 + 0.4 * Math.min(M / 2, 1.5));
      case "fan": return Math.pow(rho, 0.75) * (1 - 0.32 * Math.min(M, 0.9)); // high-bypass: thrust falls with speed
      case "prop": return Math.pow(rho, 0.8) * RJ.clamp(1 - Math.pow(v / (F.vmax * 1.18), 2), 0.05, 1);
      default: {
        const Md = F ? F.machD || 1.5 : 1.5;
        const ram = ab ? Math.pow(rho, 0.6) * (1 + 0.55 * M) : Math.pow(rho, 0.7) * (1 + 0.2 * M);
        return ram * (1 - 0.85 * RJ.smooth(Md * 1.03, Md * 1.35, M));
      }
    }
  };
  /** Transonic/supersonic wave drag as a fraction of parasite drag. */
  RJ.waveK = (F, M) => M <= 0.85 ? 0 : (F.subsonic ? 2.4 : 0.32) * RJ.smooth(0.85, 1.05, M) * (1 - 0.5 * RJ.smooth(1.2, 1.7, M));
  /** Mass and fuel: empty kg, internal fuel kg, TSFC dry and wet (kg per kgf per hour). */
  const MASS = { f16: [8570, 3200, 0.76, 1.95], fa18e: [14550, 6780, 0.81, 1.86], f15c: [12700, 6100, 0.75, 2.05], a10: [11320, 4990, 0.37, 0], f35a: [13290, 8280, 0.79, 1.9],
    f15ex: [14300, 6100, 0.75, 2.0], f22: [19700, 8200, 0.73, 1.85], f14: [19840, 7350, 0.70, 2.5], f4: [13760, 6000, 0.86, 1.97], p51: [3460, 690, 0.5, 0], f117: [13380, 8200, 0.9, 0],
    ea18g: [15000, 6780, 0.81, 1.86], yf23: [13000, 8500, 0.74, 1.9], b52: [83250, 141100, 0.56, 0], b1b: [87100, 88450, 0.67, 2.4], b2: [71700, 75750, 0.65, 0], b21: [55000, 60000, 0.62, 0],
    xb70: [115000, 136000, 0.98, 1.8], sr71: [30600, 36300, 0.89, 1.2], yf12: [27600, 31000, 0.9, 1.2], e175: [21800, 9300, 0.6, 0], b738: [41400, 20900, 0.6, 0], a380: [277000, 254000, 0.55, 0] };
  // Rotational inertia (1 = light fighter): how quickly rates and G build. Heavy airframes respond slowly.
  const INERTIA = { f22: 0.85, f16: 0.85, f35a: 0.95, fa18e: 1.0, ea18g: 1.05, f15c: 1.05, f15ex: 1.1, yf23: 1.0, f14: 1.25, f4: 1.35, a10: 1.45, p51: 0.9, f117: 1.6,
    b2: 3.4, b21: 3.0, b1b: 2.8, b52: 4.2, xb70: 3.3, sr71: 2.6, yf12: 2.5, x15: 1.9, hyperion: 2.0, e175: 2.4, b738: 3.0, a380: 4.6 };
  /** Calibrate parasite drag so full power at the reference altitude gives exactly vmax (including wave drag). */
  function calibrate(F) {
    const rr = RJ.rho(F.ref), a = RJ.soundSpeed(F.ref);
    F.machD = F.vmax / a; F.subsonic = F.machD < 1;
    F._alt = F.ref;
    const top = F.ab ? F.mil * RJ.thrustFactor(F.eng, rr, F.vmax, F, false) + (F.ab - F.mil) * RJ.thrustFactor(F.eng, rr, F.vmax, F, true) : F.mil * RJ.thrustFactor(F.eng, rr, F.vmax, F, false);
    F._alt = null;
    F.k = top / (rr * F.vmax * F.vmax * (1 + RJ.waveK(F, F.machD)));
  }
  RJ.calibrateFlight = calibrate;
  for (const id in A) {
    const F = A[id].flight;
    calibrate(F);
    F.inertia = INERTIA[id] || 1;
    F.corner = F.vstall * Math.sqrt(F.gmax) * 1.05; // best sustained-turn speed
    const ms = MASS[id];
    if (ms) { F.mEmpty = ms[0]; F.mFuel = ms[1]; F.tsfc = ms[2]; F.tsfcAB = ms[3] || ms[2]; }
  }
  /** Register an aircraft defined elsewhere (vehicles.js): catalog entry, hangar order and derived flight constants. */
  RJ.addAircraft = function (id, o, inertia) {
    add(id, o);
    RJ.AIRCRAFT_ORDER.push(id);
    const F = A[id].flight;
    calibrate(F);
    F.inertia = inertia || 1;
    F.corner = F.vstall * Math.sqrt(F.gmax) * 1.05;
    return A[id];
  };
  A.f22.flight.tvc = true; // thrust vectoring: nose authority survives at low speed and high AoA

  /** Normalized stats (0..1) for the hangar. */
  RJ.aircraftStats = (id) => {
    const a = A[id], F = a.flight;
    const mach = F.vmax / RJ.soundSpeed(F.ref);
    return {
      mach,
      speed: RJ.clamp(Math.log(F.vmax / 150) / Math.log(2000 / 150), 0, 1),
      accel: RJ.clamp(((F.ab || F.mil) - 3) / 20, 0.05, 1),
      maneuver: RJ.clamp((F.gmax / 9.5) * 0.45 + (F.roll / 320) * 0.3 + (F.pitch / 44) * 0.25, 0.05, 1),
      durability: RJ.clamp(a.hp / 520, 0.08, 1)
    };
  };

  /* ======================= BUILD ======================= */
  /* ---------- PBR paint with procedural panel lines, rivets and weathering ---------- */
  /* Paint designs, computed per pixel in the airframe's own space (u: 0 nose → 1 tail), so one pattern wraps
   * every model: camouflage, stripes, flames, fades, nebulae... c1–c3 are the design's colours. */
  const PATTERN_CODE = [
    "if (rjPat > 0.5) {",
    "  vec3 P = vObjP; float u = clamp((P.z - rjDim.x) / rjDim.y, 0.0, 1.0); vec3 col = rjC1; float ny = normalize(vObjN).y;",
    "  float fwp = length(fwidth(P.xz)) + 1e-4;",
    "  if (rjPat < 1.5) {", // splinter: hard-edged angular shards
    "    vec2 q = P.xz + P.y * 0.6; float a1 = floor(dot(q, vec2(0.82, 0.57)) * 0.55), a2 = floor(dot(q, vec2(-0.45, 0.89)) * 0.7), a3 = floor(dot(q, vec2(0.12, -0.99)) * 0.45);",
    "    float h = fract(sin(a1 * 12.9 + a2 * 78.2 + a3 * 37.7) * 43758.5); col = h < 0.36 ? rjC1 : (h < 0.7 ? rjC2 : rjC3);",
    "  } else if (rjPat < 2.5) {", // digital: pixelated three-tone camo
    "    vec2 q = floor((P.xz + vec2(P.y * 0.8)) / 0.32) * 0.32; float n = rjVN(q * 0.55) * 0.65 + rjVN(q * 1.7 + 4.0) * 0.35;",
    "    col = n < 0.42 ? rjC1 : (n < 0.6 ? rjC2 : rjC3);",
    "  } else if (rjPat < 3.5) {", // woodland: soft-edged organic blobs
    "    vec2 q = P.xz + vec2(P.y * 0.7, -P.y * 0.4); float n1 = rjVN(q * 0.42 + 3.0) * 0.7 + rjVN(q * 1.3) * 0.3, n2 = rjVN(q * 0.5 + 19.0) * 0.7 + rjVN(q * 1.5 + 7.0) * 0.3;",
    "    col = mix(rjC1, rjC2, smoothstep(0.52, 0.55, n1)); col = mix(col, rjC3, smoothstep(0.6, 0.63, n2));",
    "  } else if (rjPat < 4.5) {", // tiger: ragged dark stripes across the airframe
    "    float s = sin(P.z * 2.6 + rjVN(P.xz * 0.8) * 5.0 + abs(P.x) * 1.4 + P.y * 2.0);",
    "    col = mix(rjC1, rjC2, smoothstep(0.42, 0.5, s) * smoothstep(0.35, 0.65, rjVN(P.xz * 0.35 + 2.0) + 0.3)); col = mix(col, rjC3, smoothstep(0.85, 0.9, s));",
    "  } else if (rjPat < 5.5) {", // hot-rod flames licking back from the nose
    "    float lick = 0.34 + 0.09 * sin(P.x * 5.0 + P.y * 6.0) + 0.06 * sin(P.x * 11.0 - P.y * 9.0) + 0.04 * rjVN(P.xz * 2.0);",
    "    float f = 1.0 - smoothstep(lick - 0.015, lick + 0.015, u);",
    "    vec3 fl = mix(rjC3, rjC2, smoothstep(0.0, lick * 0.8, u)); fl = mix(fl, vec3(0.75, 0.08, 0.05), smoothstep(lick * 0.6, lick, u));",
    "    col = mix(rjC1, fl, f); col = mix(col, vec3(0.02), (1.0 - smoothstep(0.0, 0.012, abs(u - lick))) * 0.8);",
    "  } else if (rjPat < 6.5) {", // twin racing stripes over the spine and down the wings
    "    float st = (1.0 - smoothstep(0.13, 0.15, abs(abs(P.x) - 0.42))) * step(0.0, ny + 0.2);",
    "    col = mix(rjC1, rjC2, st); col = mix(col, rjC3, (1.0 - smoothstep(0.02, 0.035, abs(abs(abs(P.x) - 0.42) - 0.15))) * step(0.0, ny + 0.2));",
    "  } else if (rjPat < 7.5) {", // checkered nose and tail
    "    vec2 q = floor(P.xz / 0.7 + vec2(P.y)); float ch = mod(q.x + q.y, 2.0);",
    "    col = (u < 0.18 || u > 0.82) ? mix(rjC2, rjC3, ch) : rjC1; col = mix(col, rjC3, (1.0 - smoothstep(0.004, 0.012, abs(u - 0.18))) + (1.0 - smoothstep(0.004, 0.012, abs(u - 0.82))));",
    "  } else if (rjPat < 8.5) {", // lightning: neon zig-zag bolts along the airframe
    "    float zig = abs(fract(P.z * 0.45) - 0.5) * 2.0 - 0.5; float d = abs(abs(P.x) - 0.6 - zig * 0.9) - 0.04 * (1.0 + u);",
    "    col = mix(rjC1, rjC2, 1.0 - smoothstep(0.0, 0.08, d)); col = mix(col, rjC3, 1.0 - smoothstep(0.0, 0.025, d));",
    "  } else if (rjPat < 9.5) {", // sunset fade from nose to tail
    "    col = mix(rjC1, rjC2, smoothstep(0.0, 0.55, u)); col = mix(col, rjC3, smoothstep(0.5, 1.0, u)); col *= 0.82 + 0.18 * step(0.0, ny);",
    "  } else if (rjPat < 10.5) {", // galaxy: deep space, nebula clouds and stars
    "    vec2 q = P.xz + vec2(P.y * 0.9); float n = rjVN(q * 0.6) * 0.5 + rjVN(q * 1.7 + 3.0) * 0.3 + rjVN(q * 4.3) * 0.2;",
    "    col = mix(rjC1, rjC2, smoothstep(0.45, 0.8, n)); col = mix(col, rjC3, smoothstep(0.6, 0.95, rjVN(q * 0.9 + 11.0)) * 0.8);",
    "    vec2 sc = floor(q * 6.0); float star = step(0.985, fract(sin(dot(sc, vec2(12.9, 78.2))) * 43758.5)) * (1.0 - smoothstep(0.12, 0.3, length(fract(q * 6.0) - 0.5)));",
    "    col += vec3(star) * (1.0 - smoothstep(0.02, 0.06, fwp));",
    "  } else if (rjPat < 11.5) {", // carbon fibre weave (fades to the weave's average far away)
    "    vec2 q = P.xz * 22.0 + P.y * 22.0; vec2 c = floor(q); float w = mod(c.x + c.y, 2.0); vec2 f = fract(q);",
    "    float v = w > 0.5 ? smoothstep(0.0, 0.5, f.x) * smoothstep(1.0, 0.5, f.x) : smoothstep(0.0, 0.5, f.y) * smoothstep(1.0, 0.5, f.y);",
    "    col = mix(mix(rjC1, rjC2, v), mix(rjC1, rjC2, 0.5), smoothstep(0.004, 0.015, fwp));",
    "  } else if (rjPat < 12.5) {", // two-tone counter-shading: dark spine, pale belly
    "    col = mix(rjC2, rjC1, smoothstep(-0.25, 0.35, ny + P.y * 0.15)); col = mix(col, rjC3, (1.0 - smoothstep(0.01, 0.03, abs(ny - 0.05))) * 0.6);",
    "  } else if (rjPat < 13.5) {", // neon paint splash on black
    "    vec2 q = P.xz + vec2(P.y * 0.8); float a = rjVN(q * 0.9 + 5.0) * 0.7 + rjVN(q * 3.1) * 0.3, b = rjVN(q * 0.8 + 31.0) * 0.7 + rjVN(q * 2.7 + 9.0) * 0.3, c = rjVN(q * 1.1 + 57.0) * 0.7 + rjVN(q * 3.5 + 2.0) * 0.3;",
    "    col = mix(col, rjC2, smoothstep(0.66, 0.68, a)); col = mix(col, rjC3, smoothstep(0.68, 0.7, b)); col = mix(col, vec3(1.0, 0.92, 0.15), smoothstep(0.72, 0.74, c));",
    "  } else {", // dazzle: bold zebra geometry
    "    vec2 q = P.xz + vec2(P.y * 0.5); float s1 = sin(dot(q, vec2(1.6, 0.9)) * 2.2), s2 = sin(dot(q, vec2(-1.1, 1.7)) * 1.6 + 1.3);",
    "    col = (s1 * s2 > 0.0) ? rjC1 : rjC2; col = mix(col, rjC3, step(0.93, abs(s2)));",
    "  }",
    "  diffuseColor.rgb = col;",
    "}"
  ].join("\n");
  /* Panel detail in the airframe's own space: irregular skin panels (seams fall on fuselage stations and wing
   * chord/span lines, some dividers merged so panels vary in size), access hatches with fastener rows, recessed seams
   * and raised rivets as real relief (a derivative bump on the normal, so they catch the sun), grime and streaks,
   * chipped paint showing bare metal, and exhaust soot toward the tail. rjAir = (minZ, length, wear, gloss). */
  const PANEL_CODE = [
    "#include <roughnessmap_fragment>",
    PATTERN_CODE,
    "{",
    "  vec3 an = abs(normalize(vObjN));",
    "  bool top = an.y > max(an.x, an.z);",
    "  vec2 pc = top ? vObjP.xz : ((an.x > an.z) ? vObjP.zy : vObjP.xy);",
    "  vec2 cell = top ? vec2(1.25, 0.85) : vec2(1.6, 0.9);",              // fuselage stations ~1.6 m, frames ~0.9 m
    "  vec2 q = pc / cell, ci = floor(q), f = abs(fract(q) - 0.5);",
    // merge some dividers: hashed per cell edge, so panels come in several sizes instead of a uniform grid
    "  float hx = fract(sin(dot(ci, vec2(17.3, 41.9))) * 4375.85), hy = fract(sin(dot(ci, vec2(63.1, 9.7))) * 2531.17);",
    "  float ex = f.x * step(0.35, hx) * 2.0, ey = f.y * step(0.3, hy) * 2.0;",
    "  float m = max(ex, ey) * 0.5;",
    "#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)",
    "  float fw = length(fwidth(pc));",
    "#else",
    "  float fw = length(vViewPosition) * 0.0016;",
    "#endif",
    "  float near = 1.0 - smoothstep(0.012, 0.045, fw);",
    "  float line = smoothstep(0.47, 0.493, m) * near;",
    // a few cells carry a small access hatch: an inset rectangle ringed by fasteners
    "  vec2 hf = fract(q) - 0.5; float hatch = step(0.82, fract(hx * 7.13 + hy * 3.7));",
    "  float hb = max(abs(hf.x) / 0.26, abs(hf.y) / 0.2);",
    "  float hline = hatch * (1.0 - smoothstep(0.012, 0.05, abs(hb - 1.0))) * near;",
    "  vec2 rv = fract(pc / 0.17) - 0.5;",
    "  float rnear = 1.0 - smoothstep(0.004, 0.012, fw);",
    "  float rivet = (1.0 - smoothstep(0.08, 0.2, length(rv))) * max(smoothstep(0.44, 0.47, m), hatch * (1.0 - smoothstep(0.03, 0.09, abs(hb - 1.18)))) * rnear;",
    "  float wear = rjAir.z, gloss = rjAir.w;",
    "  float grime = rjVN(pc * 1.6) * 0.6 + rjVN(pc * 5.5) * 0.4;",
    "  float streak = rjVN(vec2(pc.x * 6.0, pc.y * 0.4));",
    // aft soot from the exhausts: dark, sooty and streaked along the airflow toward the tail
    "  float u = clamp((vObjP.z - rjAir.x) / max(rjAir.y, 1.0), 0.0, 1.0);",
    "  float soot = smoothstep(0.78, 1.0, u) * (0.55 + 0.45 * rjVN(vec2(vObjP.x * 3.0 + vObjP.y * 2.0, vObjP.z * 0.35))) * wear;",
    // chipped paint: bare aluminium along panel seams and in scattered nicks (worn airframes only)
    "  float chip = smoothstep(0.78, 0.84, rjVN(pc * 9.0) * 0.7 + rjVN(pc * 23.0) * 0.3 + line * 0.25) * near * clamp(wear - 0.45, 0.0, 1.0);",
    "  diffuseColor.rgb *= (1.0 - line * (0.32 + 0.12 * wear)) * (1.0 - hline * 0.3) * (1.0 - rivet * 0.16) * (1.0 - (0.09 * wear) + grime * 0.15 * wear) * (0.97 + streak * 0.05 * wear);",
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.035, 0.03), soot * 0.55);",
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.63, 0.65), chip * 0.85);",
    "  roughnessFactor = clamp(roughnessFactor * (1.0 - 0.45 * gloss) + (grime - 0.5) * 0.22 * wear + line * 0.15 + soot * 0.3 - chip * 0.2, 0.04, 1.0);",
    "  rjChip = chip;",
    // relief: seams and hatch lines are recessed, rivet heads stand proud
    "  rjBump = (-line - hline * 0.8 + rivet * 0.6) * 0.0016;",
    "}"
  ].join("\n");
  const BUMP_CODE = [
    "#include <normal_fragment_maps>",
    "#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)",
    "{",
    "  vec2 rjdH = vec2(dFdx(rjBump), dFdy(rjBump));",
    "  vec3 rjSx = dFdx(-vViewPosition); vec3 rjSy = dFdy(-vViewPosition);",
    "  vec3 rjR1 = cross(rjSy, normal); vec3 rjR2 = cross(normal, rjSx);",
    "  float rjDet = dot(rjSx, rjR1) * (float(gl_FrontFacing) * 2.0 - 1.0);",
    "  vec3 rjGrad = sign(rjDet) * (rjdH.x * rjR1 + rjdH.y * rjR2);",
    "  normal = normalize(abs(rjDet) * normal - rjGrad * 60.0);",
    "}",
    "#endif"
  ].join("\n");
  const NO_AIR = { rjAir: { value: new THREE.Vector4(-10, 20, 0.8, 0) } };
  const NO_PATTERN = { rjPat: { value: 0 }, rjC1: { value: new THREE.Color() }, rjC2: { value: new THREE.Color() }, rjC3: { value: new THREE.Color() }, rjDim: { value: new THREE.Vector2(0, 1) } };
  function panelize(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjP; varying vec3 vObjN; varying vec3 vWPa;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjP = position; vObjN = normal;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWPa = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjP; varying vec3 vObjN; varying vec3 vWPa;\nuniform float rjPat; uniform vec3 rjC1; uniform vec3 rjC2; uniform vec3 rjC3; uniform vec2 rjDim; uniform vec4 rjAir;\nfloat rjBump = 0.0; float rjChip = 0.0;\n" + RJ.world.GLSL_NOISE)
        .replace("#include <roughnessmap_fragment>", PANEL_CODE)
        // chipped paint is bare metal
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.85, rjChip);")
        // thin double-sided plates (fins, canards) can carry inward normals: always shade the side we see
        .replace("#include <normal_fragment_maps>", BUMP_CODE + "\nnormal = faceforward(normal, -normalize(vViewPosition), normal);")
        // thin fins seen edge-on with a grazing sun can spike the GGX lobe into a bloom "lightsaber"
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.45));");
      // always bind the design uniforms (a plain paint gets "no pattern"): uniforms a material leaves unset keep
      // the previous jet's values on the shared program, so a design would leak onto every other aircraft
      Object.assign(shader.uniforms, mat.userData.rjPat || NO_PATTERN, mat.userData.rjAir || NO_AIR);
      RJ.world.addCloudShadows(shader, "vWPa");
    };
    return mat;
  }
  /** Canopy glass: clear head-on, mirror-like at grazing angles (Fresnel), with faint dust and fine scratches. */
  function glassify(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGP = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGP;\n" + RJ.world.GLSL_NOISE)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + rjVN(vGP.xz * 9.0) * 0.06 + smoothstep(0.93, 0.98, rjVN(vec2(vGP.x * 70.0, vGP.z * 3.0))) * 0.12, 0.02, 1.0);")
        .replace("#include <output_fragment>", "float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);\ndiffuseColor.a = clamp(diffuseColor.a * (0.75 + fres * 0.9), 0.0, 0.97);\n#include <output_fragment>\ngl_FragColor.a = diffuseColor.a;");
    };
    return mat;
  }
  function canopyGlass(c) {
    const col = new THREE.Color(c), coated = col.r > col.b * 1.15;
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.035, metalness: coated ? 0.45 : 0.12, transparent: true, opacity: coated ? 0.5 : 0.36, envMapIntensity: coated ? 1.35 : 1.2 });
  }
  /** Canopy detail on fighter bubbles: a dark sealant sill where the glass meets the fuselage, and the bow
   * frame(s) of framed canopies (one-piece bubbles like the F-16 / F-22 / YF-23 stay frameless). */
  const FRAMELESS = { f16: 1, f22: 1, yf23: 1 };
  function canopyDetail(g, M, a) {
    const ring = (rx, ry, cx, cy, cz, t0, t1, n, plane, r, mat) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + (t1 - t0) * (i / n);
        pts.push(plane === "xz" ? V3(cx + rx * Math.cos(t), cy, cz + ry * Math.sin(t)) : V3(cx + rx * Math.cos(t), cy + ry * Math.sin(t), cz));
      }
      const closed = Math.abs(t1 - t0 - Math.PI * 2) < 1e-3;
      if (closed) pts.pop();
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), n, r, 6, closed), mat);
      g.add(m); return m;
    };
    for (const m of g.children.slice()) {
      if (!m.isMesh || m.material !== M.glass || m.geometry.type !== "SphereGeometry") continue;
      const s = m.scale, p = m.position;
      if (s.x > 0.7 || s.z < 1.4 || p.y < 0.4) continue; // fighter-style bubble canopies only
      ring(s.x * 1.01, s.z * 1.005, p.x, p.y + 0.02, p.z, 0, Math.PI * 2, 48, "xz", 0.03, M.dark);
      if (FRAMELESS[a.build]) continue;
      const bows = s.z > 2.4 ? [-0.32, 0.1] : [-0.3];
      for (const f of bows) {
        const k = Math.sqrt(1 - f * f) * 1.02;
        ring(s.x * k, s.y * k, p.x, p.y, p.z + s.z * f, 0, Math.PI, 20, "xy", 0.045, M.trim);
      }
    }
  }
  const std = (c, rough, metal, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: rough, metalness: metal, side: THREE.DoubleSide }, extra || {}));

  /* ---------- moving control surfaces, derived from each wing and fin planform ---------- */
  function hingedSurface(parent, ax, az, bx, bz, chord, thick, mat) {
    // hinge line from a→b in the parent's x/z plane, surface extends aft (+z) by `chord`
    if (bx < ax) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
    const len = Math.hypot(bx - ax, bz - az);
    const hinge = new THREE.Group();
    hinge.position.set(ax, 0, az);
    hinge.rotation.y = -Math.atan2(bz - az, bx - ax);
    const flap = new THREE.Group();
    const geo = new THREE.BoxGeometry(len, thick, chord);
    geo.translate(len / 2, 0, chord / 2);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true;
    flap.add(m); hinge.add(flap); parent.add(hinge);
    return flap;
  }
  function addSurfaces(g, M, a) {
    const U = g.userData;
    U.ailerons = []; U.flaps = []; U.rudders = [];
    // main wing = the largest mirrored 4-point plate
    let wing = null, best = 0;
    for (const P of U._plates || []) {
      const [r0, t0, t1, r1] = P.pts;
      const area = Math.abs((t0[0] - r0[0]) * ((r1[1] - r0[1]) + (t1[1] - t0[1])) / 2);
      if (area > best) { best = area; wing = P; }
    }
    if (wing && best > 3) {
      const [rLE, tLE, tTE, rTE] = wing.pts, px = wing.o.pivotX || 0;
      wing.grps.forEach(({ grp, s }) => {
        const at = (k) => {
          const x = rTE[0] + (tTE[0] - rTE[0]) * k, z = rTE[1] + (tTE[1] - rTE[1]) * k;
          const le = rLE[1] + (tLE[1] - rLE[1]) * k;
          return { x: (x - px) * s, z, c: Math.max(0.25, (z - le) * 0.24) };
        };
        const seg = (k0, k1, list, kind) => {
          const A0 = at(k0), A1 = at(k1), c = (A0.c + A1.c) / 2;
          const f = hingedSurface(grp, A0.x, A0.z - c, A1.x, A1.z - c, c, wing.thick * 1.12, wing.mat);
          list.push({ grp: f, s, kind });
        };
        seg(0.56, 0.93, U.ailerons, "aileron");
        if (a.cat !== "bomber" || a.id === "b52") seg(0.12, 0.5, U.flaps, "flap");
      });
    }
    for (const F of U._fins || []) {
      const [rLE, tLE, tTE, rTE] = F.pts;
      const zb = rTE[0], yb = rTE[1], zt = tTE[0], yt = tTE[1];
      const hgt = Math.hypot(zt - zb, yt - yb);
      if (hgt < 0.8) continue;
      const chord = Math.max(0.25, ((rTE[0] - rLE[0]) + (tTE[0] - tLE[0])) / 2 * 0.28);
      const outer = new THREE.Group();
      outer.position.set(F.o.x || 0, F.o.y || 0, 0); outer.rotation.z = F.o.tilt || 0;
      const k0 = 0.12, k1 = 0.88;
      const hz = zb + (zt - zb) * k0 - chord, hy = yb + (yt - yb) * k0;
      const hinge = new THREE.Group();
      hinge.position.set(0, hy, hz);
      hinge.rotation.x = Math.atan2(zt - zb, yt - yb);
      const rud = new THREE.Group();
      const len = hgt * (k1 - k0);
      const geo = new THREE.BoxGeometry(F.t * 1.15, len, chord);
      geo.translate(0, len / 2, chord / 2);
      const m = new THREE.Mesh(geo, F.mat); m.castShadow = true;
      rud.add(m); hinge.add(rud); outer.add(hinge); g.add(outer);
      U.rudders.push({ grp: rud, s: Math.sign(F.o.x || 0) });
    }
    delete U._plates; delete U._fins;
  }
  /** A pilot in the front seat: helmet with a dark visor, shoulders and the ejection-seat headrest. */
  const PILOT_SKIP = { airliner: 1, bomber: 1, car: 1, heli: 1, cargo: 1 };
  function addPilot(g, a) {
    if (PILOT_SKIP[a.cat] || ["c17", "g650", "falcon", "bwing"].includes(a.id)) return;
    const E = g.userData.cockpit; if (!E) return;
    const hist = a.cat === "historic";
    const suit = new THREE.MeshStandardMaterial({ color: hist ? 0x5b4a33 : 0x4f5a3a, roughness: 0.9, metalness: 0 });
    const helm = new THREE.MeshStandardMaterial({ color: hist ? 0x3b2f22 : 0xd9dcd6, roughness: 0.35, metalness: 0.1 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.2 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7, metalness: 0.2 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(E.x + x, E.y + y, E.z + z); g.add(m); return m; };
    add(new THREE.SphereGeometry(0.135, 14, 10), helm, 0, 0.0, 0.07);
    const v = add(new THREE.SphereGeometry(0.128, 14, 8, -Math.PI * 0.5, Math.PI, 0.9, 1.05), visor, 0, 0.005, 0.06); v.rotation.y = Math.PI;
    add(new THREE.BoxGeometry(0.46, 0.34, 0.28), suit, 0, -0.33, 0.12);
    add(new THREE.BoxGeometry(0.34, 0.5, 0.1), seat, 0, -0.12, 0.3);
  }
  /** Exhaust heat: metal near the tail shifts to bronze, then blued titanium at the nozzle lip (heat-treated look). */
  function heatTint(mat, dims) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.rjHeatZ = { value: new THREE.Vector2(dims.maxZ - dims.len * 0.2, dims.maxZ) };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vHz;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHz = position.z;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec2 rjHeatZ; varying float vHz;")
        .replace("#include <color_fragment>", "#include <color_fragment>\nfloat rjH = smoothstep(rjHeatZ.x, rjHeatZ.y, vHz);\ndiffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.68, 0.48), rjH * 0.85);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.29, 0.42), smoothstep(0.75, 1.0, rjH) * 0.55);");
    };
  }
  /** Position lights (red port, green starboard, white tail), strobes and a nose pitot probe. */
  function addLights(g, M, a) {
    const U = g.userData, d = U.dims;
    const geo = new THREE.SphereGeometry(0.16, 8, 6);
    const mk = (r, gg, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, gg, b) });
    U.nav = { red: mk(3, 0.2, 0.15), green: mk(0.2, 3, 0.6), white: mk(2.6, 2.6, 2.4), strobe: mk(0, 0, 0), meshes: [] };
    const put = (mat, x, y, z, sc = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.setScalar(sc * Math.max(1, d.span / 14)); g.add(m); U.nav.meshes.push(m); return m; };
    const tp = U.tips && U.tips[0];
    if (tp) {
      put(U.nav.green, tp.x + 0.1, tp.y, tp.z - 0.3); put(U.nav.red, -tp.x - 0.1, tp.y, tp.z - 0.3);
      put(U.nav.strobe, tp.x + 0.1, tp.y, tp.z + 0.3, 0.8); put(U.nav.strobe, -tp.x - 0.1, tp.y, tp.z + 0.3, 0.8);
    }
    put(U.nav.white, 0, d.minY + d.height * 0.55, d.maxZ - 0.2, 0.9);
    if (a.cat !== "bomber" && a.build !== "p51" && a.id !== "f117") {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 1.3, 6), M.strut);
      pit.geometry.rotateX(Math.PI / 2); pit.position.set(0, 0, d.minZ - 0.55); g.add(pit);
    }
  }

  /* ---------- landing gear ---------- */
  function addGear(g, M, a, bb) {
    const d = g.userData.dims, legs = [];
    const yb = bb.min.y + 0.15;
    const liner = a.cat === "airliner", heavy = a.cat === "bomber" || liner;
    const H = liner ? RJ.clamp(a.buildOpts.R * 0.75, 1.2, 2.8) : heavy ? RJ.clamp(d.height * 0.55, 2.2, 3.6) : RJ.clamp(d.height * 0.5, 1.1, 2.3);
    const wr = heavy ? 0.6 : 0.33;
    const leg = (x, z, h, r, nose, twin) => {
      const grp = new THREE.Group(); grp.position.set(x, yb, z); grp.userData.rjGear = true;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.28, h, 8), M.strut); strut.position.y = -h / 2; grp.add(strut);
      const wheelGeo = new THREE.CylinderGeometry(r, r, r * 0.65, 16); wheelGeo.rotateZ(Math.PI / 2);
      const offs = twin ? [-r * 0.55, r * 0.55] : [0];
      for (const o of offs) { const w = new THREE.Mesh(wheelGeo, M.rubber); w.position.set(o, -h, 0); grp.add(w); const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.7, 10), M.strut); hub.geometry.rotateZ(Math.PI / 2); hub.position.copy(w.position); grp.add(hub); }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.7, r * 2.4), M.body); door.position.set(x > 0 ? r * 0.9 : -r * 0.9, -h * 0.4, 0); grp.add(door);
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(grp); legs.push({ grp, nose, side: Math.sign(x) || 1 });
    };
    const ck = g.userData.cockpit;
    if (a.noGear) { d.gearH = a.gearH != null ? a.gearH : -yb; g.userData.gear = { legs, t: 1 }; return; } // skids, wheels or none: modelled by the vehicle itself
    if (a.id === "p51") {
      leg(1.75, -1.4, 1.75, 0.36, false); leg(-1.75, -1.4, 1.75, 0.36, false); leg(0, 4.4, 0.55, 0.16, true);
      d.gearH = -yb + 1.75 + 0.36;
      g.userData.gear = { legs, t: 1 };
      return;
    }
    const noseZ = Math.max(d.minZ + d.len * 0.12, ck.z + 1.0);
    const mainZ = d.minZ + d.len * 0.6;
    const mainX = liner ? a.buildOpts.R * 1.5 : heavy ? Math.min(d.span * 0.09, 4.5) : RJ.clamp(d.span * 0.13, 1.0, 2.6);
    leg(0, noseZ, H, wr * 0.8, true, heavy);
    if (a.id === "b52") { for (const z of [mainZ - 18, mainZ - 2]) { leg(1.3, z, H, wr, false, true); leg(-1.3, z, H, wr, false, true); } }
    else { leg(mainX, mainZ, H, wr, false, heavy); leg(-mainX, mainZ, H, wr, false, heavy); }
    if (a.buildOpts && a.buildOpts.bodyGear) for (const z of [mainZ + 3, mainZ + 6.5]) { leg(1.5, z, H, wr, false, true); leg(-1.5, z, H, wr, false, true); }
    d.gearH = -yb + H + wr;
    g.userData.gear = { legs, t: 1 };
  }
  /** t: 1 = down and locked, 0 = retracted. */
  RJ.setGear = function (g, t) {
    const G = g.userData.gear;
    if (!G) return;
    G.t = t;
    for (const l of G.legs) {
      l.grp.visible = t > 0.02;
      l.grp.rotation.x = (1 - t) * (l.nose ? -1.5 : 1.5);
      l.grp.rotation.z = l.nose ? 0 : (1 - t) * 0.25 * l.side;
    }
  };

  const AGGRESSOR = [[0xa3956d, 0x7a6e4e], [0x667c97, 0x4b5d73], [0x7f8a5c, 0x5f6844], [0x8f97a0, 0x5c6168]];
  /** Build a model. livery: undefined | "aggressor" | "wingman". */
  /** Paint jobs (hangar). null body = the aircraft's own factory scheme. */
  RJ.PAINTS = {
    factory: { name: "Factory", body: null },
    blueangels: { name: "Blue Angels tribute", body: 0x0d2c6c, trim: 0xf2b705, accent: 0xf2b705 },
    thunderbirds: { name: "Thunderbirds tribute", body: 0xf2f2f0, trim: 0xc8102e, accent: 0x0d2c6c },
    redarrows: { name: "Red Arrows tribute", body: 0xc8102e, trim: 0xf2f2f0, accent: 0x0d2c6c },
    arctic: { name: "Arctic", body: 0xe9edf0, trim: 0x9aa4ad, accent: 0xc0392b },
    desert: { name: "Desert", body: 0xc4a77d, trim: 0x8a6f4c, accent: 0x5b4a33 },
    shadow: { name: "Shadow", body: 0x2a2d31, trim: 0x1b1d20, accent: 0x7d1f1f },
    racer: { name: "Racer", body: 0xf2f2f0, trim: 0xc8102e, accent: 0xc8102e },
    jungle: { name: "Jungle", body: 0x4b5a36, trim: 0x2f3a22, accent: 0xb59b3c },
    // designs: a pattern across the whole airframe (c: its three colours)
    splinter: { name: "Splinter camo", pattern: 1, c: [0x6b7a5a, 0x3d4a35, 0x9a9070], accent: 0x2b2b2b },
    digital: { name: "Digital camo", pattern: 2, c: [0x8a9199, 0x5d656e, 0x3c434b], accent: 0xffffff },
    woodland: { name: "Woodland camo", pattern: 3, c: [0x56653f, 0x2f3824, 0x7a6845], accent: 0x1d1f1a },
    snowcamo: { name: "Winter camo", pattern: 3, c: [0xe8ecef, 0xaab3bb, 0x6c757d], accent: 0xc0392b },
    tiger: { name: "Tiger meet", pattern: 4, c: [0xf08c1a, 0x141414, 0xf7e7c6], accent: 0x141414 },
    flames: { name: "Hot-rod flames", pattern: 5, c: [0x111215, 0xff8a1c, 0xffe14d], accent: 0xff5a1c },
    stripes: { name: "Racing stripes", pattern: 6, c: [0x1f4fbf, 0xf4f4f2, 0xc8102e], accent: 0xf4f4f2 },
    checkers: { name: "Checkered", pattern: 7, c: [0xd8d9d6, 0x151515, 0xd4202a], accent: 0xd4202a },
    lightning: { name: "Lightning", pattern: 8, c: [0x18191f, 0x2fd3ff, 0xeaffff], accent: 0x2fd3ff },
    sunset: { name: "Sunset fade", pattern: 9, c: [0x4b1d78, 0xe0367a, 0xffb347], accent: 0xffd27a },
    galaxy: { name: "Galaxy", pattern: 10, c: [0x070a1f, 0x5b2a9e, 0x1fb5c9], accent: 0xb48cff },
    carbon: { name: "Carbon fibre", pattern: 11, c: [0x1a1b1e, 0x3a3d43, 0x000000], accent: 0xd8ff2f, rough: 0.3, metal: 0.4 },
    ghost: { name: "Ghost grey", pattern: 12, c: [0xb3b8bd, 0x7f868d, 0x9aa1a8], accent: 0x5a6068 },
    neon: { name: "Neon splash", pattern: 13, c: [0x0d0d10, 0xff2fa8, 0x2bff88], accent: 0xffef2b },
    dazzle: { name: "Dazzle", pattern: 14, c: [0xf2f2ee, 0x15161a, 0x3d6fd8], accent: 0x3d6fd8 },
    chrome: { name: "Chrome", body: 0xd9dde1, trim: 0xa9afb5, accent: 0x2b2b2b, rough: 0.12, metal: 1.0 },
    gold: { name: "Gold", body: 0xd4a640, trim: 0x8f6b22, accent: 0x111111, rough: 0.2, metal: 1.0 }
  };
  RJ.buildAircraft = function (id, livery) {
    const a = A[id];
    const g = new THREE.Group();
    g.userData = { flames: [], nozzles: [], stabs: [], sweep: [], props: [], droop: [], cockpit: V3(0, 1, -5), tips: [], _plates: [], _fins: [] };
    let body = a.colors.body, trim = a.colors.trim;
    if (livery === "aggressor") { const p = AGGRESSOR[Math.floor(Math.random() * AGGRESSOR.length)]; body = p[0]; trim = p[1]; }
    const PJ = RJ.PAINTS[livery];
    if (PJ && PJ.body != null) { body = PJ.body; trim = PJ.trim; }
    if (PJ && PJ.pattern) { body = PJ.c[0]; trim = PJ.c[1]; }
    const stealthy = a.stealth > 1.5;
    // paint is a dielectric: low metalness; only bare-metal liveries (chrome, gold) go metallic
    const rB = PJ && PJ.rough != null ? PJ.rough : stealthy ? 0.72 : 0.5, mB = PJ && PJ.metal != null ? PJ.metal : stealthy ? 0.1 : 0.18;
    // a design: one set of uniforms shared by the body, trim and faceted panels (dimensions filled in once built)
    const pat = PJ && PJ.pattern ? { rjPat: { value: PJ.pattern }, rjC1: { value: new THREE.Color(PJ.c[0]) }, rjC2: { value: new THREE.Color(PJ.c[1]) }, rjC3: { value: new THREE.Color(PJ.c[2]) }, rjDim: { value: new THREE.Vector2(-8, 16) } } : null;
    // wear and gloss by kind of airframe: airliners glossy and clean, warbirds and attack jets well used, stealth coatings smooth
    const air = { rjAir: { value: new THREE.Vector4(-10, 20,
      a.cat === "airliner" || a.cat === "civil" ? 0.35 : a.cat === "future" ? 0.25 : a.cat === "historic" ? 1.15 : stealthy ? 0.55 : a.cat === "space" ? 0.6 : 0.9,
      a.cat === "airliner" || a.cat === "civil" ? 0.55 : PJ && PJ.metal > 0.7 ? 0.3 : 0) } };
    const pm = (m) => { if (pat) m.userData.rjPat = pat; m.userData.rjAir = air; return panelize(m); };
    // reflections by finish: glossy airliner paint and bare metal mirror the sky, stealth coatings stay dull
    const eB = stealthy ? 0.6 : a.cat === "airliner" || a.cat === "civil" ? 1.15 : 0.95;
    const M = {
      body: pm(std(body, rB, mB, { envMapIntensity: eB })),
      trim: pm(std(trim, PJ && PJ.rough != null ? PJ.rough + 0.06 : stealthy ? 0.74 : 0.55, PJ && PJ.metal != null ? PJ.metal : stealthy ? 0.1 : 0.16, { envMapIntensity: eB * 0.95 })),
      facet: pm(std(body, 0.62, 0.2, { flatShading: true })),
      // canopy: thin glass/acrylic. Gold-tinted (ITO-coated) stealth canopies keep some metallic sheen; clear ones are dielectric
      glass: canopyGlass(a.colors.glass),
      dark: std(0x1c1e21, 0.82, 0.2),
      metal: std(0x707176, 0.34, 0.9, { emissive: 0x000000, envMapIntensity: 1.2 }),
      white: std(0xe8e8e4, 0.45, 0.08, { envMapIntensity: 1.1 }),
      accent: std(PJ && PJ.accent != null ? PJ.accent : a.colors.accent || trim, 0.45, 0.3),
      glow: new THREE.MeshBasicMaterial({ color: a.colors.accent || 0x3d7dff }),
      rubber: std(0x151515, 0.92, 0),
      strut: std(0xb9bdc2, 0.36, 0.85, { envMapIntensity: 1.15 })
    };
    BUILDERS[a.build](g, M, a.buildOpts || {});
    canopyDetail(g, M, a);
    addSurfaces(g, M, a);
    if (livery === "aggressor" || livery === "wingman") {
      // team marker: a colored band on the fins/tail for quick identification
      const c = livery === "aggressor" ? 0xc0392b : 0x2f7fd0;
      const box3 = new THREE.Box3().setFromObject(g);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, (box3.max.z - box3.min.z) * 0.12), new THREE.MeshBasicMaterial({ color: c }));
      band.position.set(0, box3.max.y - 0.6, box3.max.z - (box3.max.z - box3.min.z) * 0.08);
      g.add(band);
    }
    const bb = new THREE.Box3().setFromObject(g);
    const size = bb.getSize(V3());
    g.userData.dims = { len: size.z, span: size.x, height: size.y, minZ: bb.min.z, maxZ: bb.max.z, minY: bb.min.y };
    if (pat) pat.rjDim.value.set(bb.min.z, Math.max(1, size.z));
    air.rjAir.value.x = bb.min.z; air.rjAir.value.y = Math.max(1, size.z);
    glassify(M.glass);
    addGear(g, M, a, bb);
    addLights(g, M, a);
    addPilot(g, a);
    heatTint(M.metal, g.userData.dims);
    g.userData.materials = M;
    g.traverse((o) => { if (o.isMesh && o.material !== M.glass && o.material.blending !== THREE.AdditiveBlending) o.castShadow = true; });
    if (!RJ.noMerge) mergeStatic(g);
    if (RJ.lighting && RJ.lighting.track) RJ.lighting.track(M);
    if (RJ.models && RJ.models.has(id)) RJ.models.apply(g, id);
    return g;
  };

  /** Draw-call reduction: every static part (a direct child of the airframe that no animation code holds a
   * reference to) is merged into one mesh per material. A fighter drops from ~60 draw calls to ~15. */
  function mergeStatic(g) {
    const refs = new Set(), seen = new Set();
    const scan = (v, depth) => {
      if (!v || typeof v !== "object" || depth > 4 || seen.has(v)) return;
      seen.add(v);
      if (v.isObject3D) { v.traverse((o) => refs.add(o)); return; }
      if (v.isMaterial || v.isVector3 || v.isTexture) return;
      for (const k in v) if (k !== "materials" && k !== "dims") scan(v[k], depth + 1);
    };
    scan(g.userData, 0);
    const groups = new Map(), cand = [];
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    g.traverse((m) => { if (m !== g) cand.push(m); });
    for (const m of cand) {
      if (!m.isMesh || m.isInstancedMesh || refs.has(m) || m.children.length || !m.visible || Array.isArray(m.material)) continue;
      let ok = true;
      for (let q = m.parent; q && q !== g; q = q.parent) if (refs.has(q) || !q.visible || q.isMesh) { ok = false; break; }
      if (!ok) continue;
      if (m.material.blending === THREE.AdditiveBlending || m.renderOrder) continue;
      const attrs = Object.keys(m.geometry.attributes).sort().join(",");
      if (!/^normal,position(,uv)?$/.test(attrs)) continue;
      const key = m.material.uuid + "|" + attrs;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const parts = [];
      let total = 0;
      for (const m of list) {
        const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(mat);
        if (mat.determinant() < 0) { // mirrored part: restore the triangle winding
          for (const name of Object.keys(geo.attributes)) {
            const at = geo.attributes[name], n = at.itemSize, arr = at.array;
            for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[(i + 1) * n + k]; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t; }
          }
        }
        parts.push(geo); total += geo.attributes.position.count;
      }
      const out = new THREE.BufferGeometry();
      for (const name of Object.keys(parts[0].attributes)) {
        const n = parts[0].attributes[name].itemSize, arr = new Float32Array(total * n);
        let o = 0;
        for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, n));
      }
      out.computeBoundingSphere();
      const mm = new THREE.Mesh(out, list[0].material);
      mm.castShadow = list.some((m) => m.castShadow); mm.receiveShadow = list.some((m) => m.receiveShadow);
      mm.layers.mask = list[0].layers.mask;
      for (const m of list) m.parent.remove(m);
      for (const p of parts) p.dispose();
      g.add(mm);
    }
  }

  /* ======================= 3D COCKPIT ======================= */
  /** First-person cockpit drawn as an overlay in camera space. Returns {group, update(ac, dt)}. */
  RJ.buildCockpit = function (id) {
    const a = A[id];
    const grp = new THREE.Group();
    const hist = a.cat === "historic" || a.hudStyle === "gunsight";
    const bomber = a.cat === "bomber" || a.cat === "airliner";
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.8, metalness: 0.2 });
    const mid = new THREE.MeshStandardMaterial({ color: hist ? 0x454b3c : 0x3b4048, roughness: 0.62, metalness: 0.3 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.5, metalness: 0.55 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); grp.add(m); return m; };
    const W = bomber ? 1.9 : 1.25;
    // glare shield and instrument panel
    add(new THREE.BoxGeometry(W, 0.07, 0.42), dark, 0, -0.27, -0.78, -0.08);
    add(new THREE.CylinderGeometry(W * 0.5, W * 0.5, 0.42, 24, 1, true, Math.PI * 0.5, Math.PI), dark, 0, -0.3, -0.78, Math.PI / 2, 0, 0).scale.set(1, 1, 0.12);
    add(new THREE.BoxGeometry(W * 0.95, 0.42, 0.05), mid, 0, -0.52, -0.74, -0.32);
    add(new THREE.BoxGeometry(0.42, 0.14, 1.1), mid, -W * 0.45, -0.62, -0.25);
    add(new THREE.BoxGeometry(0.42, 0.14, 1.1), mid, W * 0.45, -0.62, -0.25);
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.22, 8), dark, 0, -0.62, -0.42, 0.3);
    add(new THREE.SphereGeometry(0.035, 10, 8), dark, 0, -0.52, -0.39);
    // displays (canvas textures redrawn a few times per second)
    const displays = [];
    const mkDisp = (kind, x, w, h) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = Math.round(512 * h / w);
      const tex = new THREE.CanvasTexture(c);
      const m = add(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), x, -0.5, -0.715, -0.32);
      displays.push({ kind, c, g: c.getContext("2d"), tex, mesh: m });
    };
    if (hist) { [-0.36, -0.12, 0.12, 0.36].forEach((x, i) => mkDisp("gauge" + i, x, 0.17, 0.17)); }
    else { mkDisp("radar", -0.37, 0.28, 0.24); mkDisp("adi", 0, 0.28, 0.24); mkDisp("eng", 0.37, 0.28, 0.24); }
    // HUD combiner glass
    if (!hist && !bomber) add(new THREE.PlaneGeometry(0.24, 0.17), new THREE.MeshStandardMaterial({ color: 0x9fd8b0, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.6 }), 0, -0.13, -0.6, -0.25);
    // canopy structure
    if (hist || bomber) {
      const px = bomber ? 0.75 : 0.36;
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.75, 0.035), frame, s * px, 0.02, -0.62, 0.35, 0, -s * 0.32);
      add(new THREE.BoxGeometry(px * 1.6, 0.035, 0.035), frame, 0, 0.32, -0.45);
      if (bomber) { add(new THREE.BoxGeometry(0.04, 0.7, 0.04), frame, 0, 0.0, -0.7, 0.35); add(new THREE.BoxGeometry(W * 1.4, 0.05, 0.05), frame, 0, -0.22, -0.72); }
      add(new THREE.TorusGeometry(0.62, 0.02, 6, 24, Math.PI), frame, 0, -0.25, -0.05, 0, 0, 0);
    } else {
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.04, 1.6), frame, s * 0.5, -0.32, -0.2);
      add(new THREE.TorusGeometry(0.56, 0.025, 6, 28, Math.PI), frame, 0, -0.3, 0.55);
    }
    grp.traverse((o) => { if (o.isMesh) o.renderOrder = 20; });
    // raise the panel so the displays sit inside the field of view, below the forward view
    grp.position.y = 0.1;
    let t = 0;
    const update = (ac, dt) => {
      t += dt;
      if (t < 0.12) return;
      t = 0;
      for (const d of displays) drawDisplay(d, ac);
    };
    return { group: grp, update };
  };
  function drawDisplay(d, ac) {
    // canvases are 2× resolution for crisp symbology; draw in 256-wide units
    const g = d.g, w = d.c.width / 2, h = d.c.height / 2, G = "#8dffb0";
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.fillStyle = "#06100b"; g.fillRect(0, 0, w, h);
    g.strokeStyle = G; g.fillStyle = G; g.lineWidth = 2; g.font = "16px monospace";
    if (d.kind === "radar") {
      const cx = w / 2, cy = h - 10, R = h - 24;
      g.globalAlpha = 0.5; for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(cx, cy, R * k / 3, Math.PI, 2 * Math.PI); g.stroke(); }
      g.globalAlpha = 1;
      const sw = Math.sin(performance.now() / 700) * 0.9;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(sw) * R, cy - Math.cos(sw) * R); g.stroke();
      const f = ac.fwd, rx = -f.z, rz = f.x, range = ac.spec.radar || 8000;
      for (const o of (RJ.combat && RJ.combat.aircraft) || []) {
        if (o === ac || !o.alive) continue;
        const dx = o.pos.x - ac.pos.x, dz = o.pos.z - ac.pos.z;
        const fwdD = dx * f.x + dz * f.z, rt = dx * rx + dz * rz;
        if (fwdD < 0) continue;
        const px = cx + (rt / range) * R, py = cy - (fwdD / range) * R;
        if (py < 0 || px < 0 || px > w) continue;
        g.fillStyle = o.team === ac.team ? "#6cc4ff" : "#ff5a4f"; g.fillRect(px - 4, py - 4, 8, 8);
      }
      g.fillStyle = G; g.fillText(`RDR ${Math.round(range / 1000)}`, 8, 18);
    } else if (d.kind === "adi") {
      const cx = w / 2, cy = h / 2;
      g.save(); g.translate(cx, cy); g.rotate(-ac.bank);
      const py = ac.pitchAngle * 120;
      g.fillStyle = "#1d3b5c"; g.fillRect(-w, -h * 2 + py, w * 2, h * 2);
      g.fillStyle = "#4a3418"; g.fillRect(-w, py, w * 2, h * 2);
      g.strokeStyle = "#ffffff"; g.beginPath(); g.moveTo(-w, py); g.lineTo(w, py); g.stroke();
      g.restore();
      g.strokeStyle = "#ffcc33"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 40, cy); g.lineTo(cx - 12, cy); g.lineTo(cx, cy + 8); g.lineTo(cx + 12, cy); g.lineTo(cx + 40, cy); g.stroke();
      g.fillStyle = G; g.fillText(`M${ac.mach.toFixed(2)}`, 8, 18); g.fillText(`${ac.g.toFixed(1)}G`, w - 52, 18);
    } else if (d.kind === "eng") {
      g.fillText("ENG", 8, 18);
      g.strokeRect(20, 30, 40, h - 50); g.fillRect(20, 30 + (h - 50) * (1 - ac.throttle), 40, (h - 50) * ac.throttle);
      g.fillStyle = "#ffa040"; g.strokeStyle = "#ffa040"; g.strokeRect(80, 30, 40, h - 50); g.fillRect(80, 30 + (h - 50) * (1 - ac.abLevel), 40, (h - 50) * ac.abLevel);
      g.fillStyle = G; g.fillText(`HP ${Math.round(ac.hp / ac.maxHp * 100)}%`, 138, 48);
      g.fillText(`MSL ${ac.missiles}`, 138, 74); g.fillText(`FLR ${ac.flares}`, 138, 100);
      g.fillText(ac.gearDown ? "GEAR DN" : "GEAR UP", 138, 126);
    } else {
      // round steam gauges for historic aircraft
      const cx = w / 2, cy = h / 2, R = w * 0.42;
      g.fillStyle = "#0e0f0d"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#d8d4c0"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2;
      for (let k = 0; k < 12; k++) { const an = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(an) * R * 0.85, cy + Math.sin(an) * R * 0.85); g.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R); g.stroke(); }
      const idx = +d.kind.slice(5);
      const val = [ac.speed / 220, ac.pos.y / 9000, ac.throttle, (ac.g + 2) / 9][idx] || 0;
      const an = -Math.PI * 0.75 + RJ.clamp(val, 0, 1.2) * Math.PI * 1.5 - Math.PI / 2;
      g.strokeStyle = "#ffffff"; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * R * 0.75, cy + Math.sin(an) * R * 0.75); g.stroke();
      g.fillStyle = "#d8d4c0"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.fillText(["MPH", "ALT", "RPM", "G"][idx], cx, cy + R * 0.55); g.textAlign = "left";
    }
    d.tex.needsUpdate = true;
  }
})(window.RJ);
