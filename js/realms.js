/* Ridgeline Jets — the far realms: Everest base camp and summit, and the fantasy destinations.
 * Terrain for each realm is shaped in terrain-gen.js (fixed zones, so every machine builds the same
 * world); this file builds the structures on it at full scale and registers them with the atlas
 * (discovery, radar markers, collision). Each realm culls itself by distance and, where it is big
 * enough to see from far away, leaves a simple silhouette on the far-horizon layer. */
(function (RJ) {
  "use strict";
  const R = (RJ.realms = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const W = () => RJ.world;
  const U = () => RJ.castle.util;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const std = (color, rough = 0.85, metal = 0, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra || {}));
  const nightK = () => RJ.clamp(1 - RJ.smooth(-3, 10, RJ.world.sunElev), 0, 1);
  const rng = (seed) => RJ.world.gen.mulberry32(seed >>> 0);
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _e = new THREE.Euler();

  R.DEFS = [
    { id: "everest", name: "Mount Everest", sub: "8,848.86 m: the roof of the world", icon: "peak", r: 22000, xp: 500 },
    { id: "citadel", name: "The White Citadel", sub: "A seven-tiered fortress city against the mountains", icon: "castle", r: 7000, xp: 400 },
    { id: "darktower", name: "The Dark Tower", sub: "A black spire above an ash-choked plain", icon: "tower", r: 8000, xp: 400 },
    { id: "firemount", name: "Fire Mountain", sub: "A volcano bleeding rivers of lava", icon: "volcano", r: 11000, xp: 400 },
    { id: "elfvale", name: "The Hidden Valley", sub: "An elven refuge between thousand-metre waterfalls", icon: "tree", r: 5000, xp: 400 },
    { id: "skybridge", name: "The Sky Bridge", sub: "A colossal stone arch among floating mountains", icon: "arch", r: 7000, xp: 400 },
    { id: "monastery", name: "Cliffside Monastery", sub: "Temples clinging to a sheer stone pillar", icon: "pagoda", r: 4500, xp: 400 },
    { id: "skyfortress", name: "The Sky Fortress", sub: "A ruined castle adrift above the clouds", icon: "island", r: 9000, xp: 500 },
    { id: "observatory", name: "The Mountain Observatory", sub: "A giant radio telescope above the clouds", icon: "dish", r: 6000, xp: 400 },
    { id: "redwoods", name: "The Giant Redwoods", sub: "A forest of 120-metre trees", icon: "tree", r: 7000, xp: 400 },
    { id: "icefortress", name: "The Ice Fortress", sub: "Crystal towers in the White Mountains", icon: "ice", r: 7000, xp: 400 },
    { id: "bikini", name: "Bikini Bottom", sub: "A whole town on the seabed. Dive in!", icon: "fish", r: 5000, xp: 500 }
  ];

  /* ======================= helpers ======================= */
  function addMerged(grp, list, mat, cast = true) {
    if (!list.length) return null;
    const m = new THREE.Mesh(U().merge(list), mat);
    m.castShadow = cast; m.receiveShadow = true; grp.add(m); return m;
  }
  const put = (list, geo, x, y, z, ry) => U().put(list, geo, x, y, z, ry);
  /** Lamp points (glow at night, bloom) */
  function lamps(grp, pts, size, col) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const n = pts.length / 3, im = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), mat, Math.max(1, n));
    for (let i = 0; i < n; i++) { _m4.makeTranslation(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); im.setMatrixAt(i, _m4); }
    im.frustumCulled = false; grp.add(im);
    return { mesh: im, set: (k) => mat.color.setRGB(col[0], col[1], col[2]).multiplyScalar(k) };
  }
  /** A vertical/hanging ribbon of falling water using the world's waterfall material. */
  function fallRibbon(grp, top, bottom, width, dir, bulge) {
    bulge = bulge == null ? width * 0.6 : bulge;
    const K = 18, pos = [], uv = [], idx = [];
    const px = -dir.z, pz = dir.x;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const x = top.x + (bottom.x - top.x) * t + dir.x * Math.sin(t * Math.PI) * bulge, z = top.z + (bottom.z - top.z) * t + dir.z * Math.sin(t * Math.PI) * bulge;
      const y = top.y + (bottom.y - top.y) * t;
      const w = width * (1 + t * 0.6);
      for (const s of [-0.5, 0.5]) { pos.push(x + px * w * s, y, z + pz * w * s); uv.push(s + 0.5, t * (top.y - bottom.y) / 60); }
      if (k < K) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, RJ.world.fallMat); m.renderOrder = 3; grp.add(m);
    return m;
  }
  /** Noise-displaced rock: a lathe/cylinder with jittered radius; vertex colours from rock to grass on top. */
  function rockColumn(rad, h, seed, opt) {
    opt = opt || {};
    const r = rng(seed), seg = opt.seg || 14, rows = opt.rows || 10;
    const g = new THREE.CylinderGeometry(rad * (opt.top || 0.82), rad, h, seg, rows, false);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, col = [];
    const ph = r() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = y / h;
      const k = 1 + 0.16 * Math.sin(a * 3 + ph + t * 4) + 0.1 * Math.sin(a * 7 + ph * 2 - t * 9) + (r() - 0.5) * 0.06;
      p.setX(i, x * k); p.setZ(i, z * k);
      const top = t > 0.985 ? 1 : RJ.smooth(0.93, 1.0, t) * 0.6;
      const band = 0.5 + 0.5 * Math.sin(y * 0.06 + ph);
      const c = [0.47 + band * 0.08, 0.44 + band * 0.06, 0.38 + band * 0.04];
      const gcol = opt.green === false ? c : [0.2, 0.36, 0.14];
      const moss = (opt.green === false ? 0 : 0.25) * RJ.smooth(0.2, 0.9, Math.sin(a * 5 + y * 0.03) * 0.5 + 0.5);
      for (let j = 0; j < 3; j++) col.push(c[j] + (gcol[j] - c[j]) * Math.max(top, moss));
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const rockMat = () => std(0xffffff, 0.92, 0, { vertexColors: true });
  /** Distant silhouette on the far-horizon layer, shown only beyond normal draw range. */
  function farSil(lm, geo, color, pos) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, fog: false }));
    m.position.copy(pos); m.layers.set(RJ.world.BACK); m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrix();
    RJ.world.scene.add(m);
    lm.far = m; lm.farBase = new THREE.Color(color);
    return m;
  }
  /** Distance culling for a realm, plus its far silhouette hazed toward the horizon colour. */
  function cull(lm, cam, near) {
    const d = Math.hypot(cam.position.x - lm.cx, cam.position.z - lm.cz);
    lm.dist = d;
    if (lm.group) lm.group.visible = d < (near || 24000);
    if (lm.far) {
      lm.far.visible = d > 15000;
      if (lm.far.visible) lm.far.material.color.copy(lm.farBase).lerp(RJ.world.scene.fog.color, RJ.clamp((d - 15000) / 90000, 0, 0.8));
    }
    return d;
  }
  function lavaMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: [RJ.world.GLSL_NOISE, "uniform float time; varying vec2 vUv; varying vec3 vW;",
        "void main(){ float n = rjFbm(vec2(vUv.x * 3.0, vUv.y * 0.6 - time * 0.12)) ; float n2 = rjVN(vW.xz * 0.05 + time * 0.05);",
        "float hot = smoothstep(0.35, 0.75, n * 0.8 + n2 * 0.4);",
        "vec3 c = mix(vec3(0.25, 0.02, 0.0), vec3(4.2, 1.35, 0.18), hot);",
        "c *= 0.75 + 0.25 * sin(time * 2.0 + vW.x * 0.02);",
        "gl_FragColor = vec4(c, 1.0); }"].join("\n"),
      fog: false, side: THREE.DoubleSide
    });
    return m;
  }
  /** Ribbon draped over the terrain from a list of points. */
  function groundRibbon(grp, pts, width, mat, lift) {
    const pos = [], uv = [], idx = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L;
      if (i) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const w = width * (0.6 + 0.4 * Math.sin(i * 0.7));
      for (const s of [-0.5, 0.5]) {
        const x = pts[i].x + px * w * s, z = pts[i].z + pz * w * s;
        pos.push(x, G(x, z) + (lift || 1.5), z); uv.push(s + 0.5, along / 200);
      }
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals(); g.computeBoundingSphere();
    mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(g, mat); grp.add(m); return m;
  }
  /** Steepest-descent path down a mountainside. */
  function downhill(x, z, steps, step) {
    const pts = [V3(x, 0, z)];
    for (let i = 0; i < steps; i++) {
      let best = null, bh = G(x, z);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU, nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step, h = G(nx, nz); if (h < bh) { bh = h; best = [nx, nz]; } }
      if (!best) break;
      x = best[0]; z = best[1]; pts.push(V3(x, 0, z));
    }
    return pts;
  }
  /** Find the flattest spot in a ring/box whose ground lies in [hMin, hMax]. */
  function flatSpot(cx, cz, rMin, rMax, hMin, hMax, prefer) {
    let best = null;
    for (let r = rMin; r <= rMax; r += 400) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU + r * 0.001, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = G(x, z);
      if (h < hMin || h > hMax) continue;
      let sl = 0; for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60], [250, 0], [0, 250], [-250, 0], [0, -250]]) sl = Math.max(sl, Math.abs(G(x + dx, z + dz) - h) / Math.hypot(dx, dz));
      const sc = sl + (prefer ? prefer(x, z, h) : 0);
      if (!best || sc < best.sc) best = { x, z, h, sc };
    }
    return best;
  }

  /* ======================= PLAN (sites that shape terrain) ======================= */
  R.plan = function (gen, P, home, sites) {
    const Z = gen.zones, E = gen.everest;
    const S = (R.S = {});
    // observatory: a foothill plateau ~25 km from Everest toward home, above the usual cloud deck
    let dx = home.x - E.x, dz = home.z - E.z; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
    const ob = flatSpot(E.x + dx * 26000, E.z + dz * 26000, 0, 6000, 3000, 4100);
    if (ob) { S.observatory = ob; sites.push({ type: "plateau", kind: "observatory", x: ob.x, z: ob.z, r: 650, fall: 600, elev: ob.h }); }
    // ice fortress on a high bench in the White Mountains; a ring of standing stones lower down
    const wz = Z.white;
    const ice = flatSpot(wz.x, wz.z, 0, 9000, 1500, 2400);
    if (ice) { S.ice = ice; sites.push({ type: "plateau", kind: "ice", x: ice.x, z: ice.z, r: 520, fall: 500, elev: ice.h }); }
    const stones = flatSpot(wz.x + 6000, wz.z + 5000, 0, 5000, 700, 1300);
    if (stones) { S.stones = stones; sites.push({ type: "flat", kind: "stones", x: stones.x, z: stones.z, r: 90, fall: 160, elev: stones.h }); }
    // dark tower plateau and the citadel's crown
    S.dark = { x: Z.ashland.x, z: Z.ashland.z, h: gen.height(Z.ashland.x, Z.ashland.z) };
    sites.push({ type: "flat", kind: "dark", x: S.dark.x, z: S.dark.z, r: 640, fall: 600, elev: S.dark.h });
    S.city = { x: Z.city.x, z: Z.city.z };
    // Bikini Bottom: open water 25–60 km out, away from the carrier, deep enough to dive into
    let bb = null;
    for (let r = 26000; r <= 62000 && !bb; r += 3000) for (let k = 0; k < 32 && !bb; k++) {
      const a = (k / 32) * TAU, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
      if (P.carrier && Math.hypot(x - P.carrier.x, z - P.carrier.z) < 12000) continue;
      let ok = gen.height(x, z) < -60;
      for (let j = 0; j < 12 && ok; j++) { const b = (j / 12) * TAU; if (gen.height(x + Math.cos(b) * 5500, z + Math.sin(b) * 5500) > -15) ok = false; }
      if (ok) bb = { x, z };
    }
    if (bb) { S.bikini = bb; sites.push({ type: "seabed", kind: "bikini", x: bb.x, z: bb.z, r: 3200, fall: 1500, depth: 85, elev: -85 }); }
    // sky fortress hangs over the lowlands south-east of home
    S.sky = { x: home.x + 17000, z: home.z + 30000, y: 3300 };
    return S;
  };

  /* ======================= BUILDERS ======================= */
  const B = {};

  /* ---- Everest: base camp on the glacier, summit prayer flags, the snow plume ---- */
  B.everest = function () {
    const E = W().everest, grp = new THREE.Group();
    // base camp ~5,360 m on gentle ground south-west of the summit
    // real South Base Camp (28.0043 N, 86.8571 E, Khumbu Glacier) when the real elevation data is loaded
    const real = W().dem && E.mE, bx = real ? E.x + (86.8571 - E.lon) * E.mE : 0, bz = real ? E.z - (28.0043 - E.lat) * E.mN + 40 : 0;
    const bc = (real && (flatSpot(bx, bz, 0, 700, 5000, 5700) || { x: bx, z: bz, h: G(bx, bz) })) ||
      flatSpot(E.x, E.z, 8000, 13000, 5000, 5700, (x, z) => Math.abs(Math.atan2(z - E.z, x - E.x) - 2.3) * 0.02) || { x: E.x - 9000, z: E.z + 6000, h: G(E.x - 9000, E.z + 6000) };
    const tents = [], cols = [0xe8581c, 0xf2c230, 0x2d6fd6, 0xd8402f, 0x3f9b4a];
    const r = rng(8848);
    const tentG = new THREE.ConeGeometry(2.4, 2.3, 4); tentG.rotateY(Math.PI / 4); tentG.translate(0, 1.15, 0);
    const im = new THREE.InstancedMesh(tentG, std(0xffffff, 0.7), 140), c = new THREE.Color();
    for (let i = 0; i < 140; i++) {
      const a = r() * TAU, d = 30 + r() * 260;
      const x = bc.x + Math.cos(a) * d, z = bc.z + Math.sin(a) * d * 0.6;
      _m4.compose(_p.set(x - bc.x, G(x, z) - bc.h, z - bc.z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.setScalar(0.8 + r() * 0.6));
      im.setMatrixAt(i, _m4); im.setColorAt(i, c.setHex(cols[i % cols.length]));
      tents.push([x, z]);
    }
    im.position.set(bc.x, bc.h, bc.z); im.castShadow = true; grp.add(im);
    // prayer flag lines between poles
    const flagCols = [0x2d6fd6, 0xf4f4f0, 0xd8402f, 0x3f9b4a, 0xf2c230], fl = [], poles = [];
    for (let k = 0; k < 10; k++) {
      const a = r() * TAU, x0 = bc.x + Math.cos(a) * 60, z0 = bc.z + Math.sin(a) * 40, x1 = x0 + Math.cos(a + 1.2) * 70, z1 = z0 + Math.sin(a + 1.2) * 70;
      const y0 = G(x0, z0) + 7, y1 = G(x1, z1) + 7;
      poles.push([x0, y0, z0], [x1, y1, z1]);
      for (let j = 1; j < 24; j++) { const t = j / 24; fl.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 3, z0 + (z1 - z0) * t, flagCols[j % 5]]); }
    }
    const flagIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 1.1), std(0xffffff, 0.8, 0, { side: THREE.DoubleSide }), fl.length);
    fl.forEach((f, i) => { _m4.makeTranslation(f[0], f[1] - 0.6, f[2]); flagIM.setMatrixAt(i, _m4); flagIM.setColorAt(i, c.setHex(f[3])); });
    grp.add(flagIM);
    const pl = []; for (const p of poles) put(pl, new THREE.CylinderGeometry(0.12, 0.15, 7.5, 5), p[0], p[1] - 3.7, p[2]);
    // a stone chorten (shrine) at the camp
    put(pl, new THREE.BoxGeometry(8, 3, 8), bc.x, G(bc.x, bc.z) + 1.4, bc.z);
    put(pl, new THREE.SphereGeometry(3.4, 10, 6, 0, TAU, 0, Math.PI / 2), bc.x, G(bc.x, bc.z) + 2.9, bc.z);
    put(pl, new THREE.ConeGeometry(1.2, 6, 8), bc.x, G(bc.x, bc.z) + 9, bc.z);
    addMerged(grp, pl, std(0xd9d2c4, 0.9));
    // summit: prayer flags and a survey pole at exactly 8,848.86 m
    const sf = [];
    for (let j = 0; j < 30; j++) { const a = (j / 30) * TAU; sf.push([E.x + Math.cos(a) * (6 + j * 0.3), E.h + 1.2 - j * 0.12, E.z + Math.sin(a) * (6 + j * 0.3), flagCols[j % 5]]); }
    const sIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1.2), std(0xffffff, 0.8, 0, { side: THREE.DoubleSide }), sf.length);
    sf.forEach((f, i) => { _m4.makeTranslation(f[0], f[1], f[2]); sIM.setMatrixAt(i, _m4); sIM.setColorAt(i, c.setHex(f[3])); });
    grp.add(sIM);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 5), std(0xc0c0c0, 0.4, 0.8)); pole.position.set(E.x, E.h + 1.2, E.z); grp.add(pole);
    const lm = { group: grp, cx: E.x, cz: E.z, t: 0, s: { x: E.x, z: E.z }, marker: V3(E.x, E.h + 400, E.z), camp: bc };
    lm.update = (dt, cam) => {
      const d = cull(lm, cam, 40000);
      // the summit plume: wind-blown snow streaming off the top (spawned only when someone can see it)
      lm.t += dt;
      if (d < 45000 && lm.t > 0.35) {
        lm.t = 0;
        const wind = V3(14, 0, 5);
        RJ.fx.smoke(V3(E.x + RJ.rand(-30, 30), E.h - RJ.rand(0, 140), E.z + RJ.rand(-30, 30)), wind, 60 + Math.random() * 50, 0.98, 16, 0.32);
      }
    };
    return lm;
  };

  /* ---- The White Citadel: seven walled tiers, houses, the prow and the high tower ---- */
  B.citadel = function () {
    const Z = W().gen.zones.city, grp = new THREE.Group(), S = [], Rf = [], Win = [];
    const cx = Z.x, cz = Z.z, r = rng(707);
    grp.position.set(cx, 0, cz);
    const tierH = (k) => 480 + k * 45;
    const ringR = (k) => Z.r * (1 - k / 7);
    const towers = [];
    for (let k = 0; k < 7; k++) {
      const R0 = ringR(k) - 6, y = tierH(k), wallH = k === 0 ? 62 : 48, th = k === 0 ? 16 : 10;
      const n = Math.max(24, Math.round(R0 / 18));
      const gateA = (k % 2 ? 0.6 : -0.6) + Math.PI / 2; // gates zig-zag up the hill
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, am = (a0 + a1) / 2;
        if (Math.abs(Math.atan2(Math.sin(am - gateA), Math.cos(am - gateA))) < 0.045 * (7 - k) / 3) continue;
        const L = 2 * R0 * Math.sin((a1 - a0) / 2) + 1;
        put(S, new THREE.BoxGeometry(th, wallH + 40, L), Math.cos(am) * R0, y - 40 + (wallH + 40) / 2, Math.sin(am) * R0, -am);
        if (i % Math.max(3, Math.round(n / (10 + k * 2))) === 0) { towers.push([Math.cos(am) * R0, y, Math.sin(am) * R0, k]); }
      }
      // houses packed on the tier terrace
      const inner = ringR(k + 1) + 6, outer = R0 - 12;
      const count = Math.round((outer - inner) * R0 * 0.05);
      for (let j = 0; j < count; j++) {
        const a = r() * TAU, d = inner + 6 + r() * (outer - inner - 12);
        if (Math.abs(Math.sin(a - 0.0)) < 0.06 && Math.cos(a) > 0) continue; // the prow
        const w = 9 + r() * 10, dd = 8 + r() * 8, hh = 9 + r() * 16;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        put(S, new THREE.BoxGeometry(w, hh, dd), x, y + hh / 2, z, -a);
        const rf = U().prism(dd + 1.5, 4 + r() * 3, w + 1.5); rf.rotateY(Math.PI / 2);
        put(Rf, rf, x, y + hh, z, -a);
        if (r() < 0.5) put(Win, new THREE.BoxGeometry(1.4, 2.2, 0.6), x + Math.cos(a) * (dd / 2 + 0.2), y + hh * 0.6, z + Math.sin(a) * (dd / 2 + 0.2), -a);
      }
    }
    for (const [x, y, z, k] of towers) { const h = (k === 0 ? 70 : 52); put(S, new THREE.CylinderGeometry(9, 10, h + 40, 12), x, y - 40 + (h + 40) / 2, z); put(Rf, new THREE.ConeGeometry(10.5, 16, 12), x, y + h + 8, z); }
    // the prow: a great wedge of rock splitting the city, from the lowest tier to the citadel
    const prow = new THREE.BufferGeometry();
    const L0 = Z.r * 0.95, top = tierH(7) + 10, base = 450;
    const pv = [0, base, -26, 0, base, 26, L0, base, 0, 0, top, -22, 0, top, 22, L0 * 0.9, top - 40, 0];
    prow.setAttribute("position", new THREE.Float32BufferAttribute(pv, 3));
    prow.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
    const prowN = prow.toNonIndexed(); prowN.computeVertexNormals();
    S.push(prowN);
    // the citadel crown: courtyard, great hall, and the white tower (180 m)
    const yC = tierH(6);
    put(S, new THREE.CylinderGeometry(ringR(6) - 20, ringR(6) - 20, 2, 32), 0, yC + 1, 0);
    put(S, new THREE.BoxGeometry(70, 34, 40), -60, yC + 17, 0);
    const hr = U().prism(42, 16, 72); put(Rf, hr, -60, yC + 34, 0, Math.PI / 2);
    put(S, new THREE.CylinderGeometry(11, 14, 180, 16), 30, yC + 90, 0);
    put(S, new THREE.CylinderGeometry(15, 15, 8, 16), 30, yC + 176, 0);
    put(Rf, new THREE.ConeGeometry(8, 30, 16), 30, yC + 195, 0);
    const stone = U().stoneMat(0xe6e2d8, false, 0.85), roof = U().stoneMat(0x8a8f99, true, 0.6);
    addMerged(grp, S, stone); addMerged(grp, Rf, roof);
    const winM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    addMerged(grp, Win, winM, false);
    // banners on the high tower; beacon fires on the peaks behind
    const lp = []; for (const [x, y, z] of towers) lp.push(x, y + 30, z);
    const L = lamps(grp, lp, 1.6, [3.2, 1.7, 0.6]);
    const lm = { group: grp, cx, cz, s: { x: cx, z: cz }, marker: V3(cx, yC + 260, cz), towers };
    farSil(lm, (() => { const g = new THREE.ConeGeometry(Z.r * 0.9, 460, 16, 1, true); g.translate(0, 230, 0); const t = new THREE.CylinderGeometry(14, 14, 220, 6); t.translate(30, yC + 110 - 360 + 230, 0); return U().merge([g, t]); })(), 0xb9b6ae, V3(cx, 360 - 230 + 160, cz));
    lm.heightAt = (x, z) => {
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d > Z.r + 10) return -Infinity;
      const t = 7 * (1 - d / Z.r), k = Math.max(0, Math.min(6, Math.floor(t)));
      const nearWall = (t - k) > 0.93 || (t - k) < 0.06;
      if (Math.hypot(dx - 30, dz) < 15) return yC + 210;
      return tierH(k) + (nearWall ? 34 : 18);
    };
    lm.update = (dt, cam) => { cull(lm, cam); const n = nightK(); winM.color.setRGB(3, 2, 0.9).multiplyScalar(0.03 + n * 0.9); L.set(0.05 + n * 1.1); };
    return lm;
  };

  /* ---- The Dark Tower: a 650 m spire with a burning eye, ringed by jagged walls ---- */
  B.darktower = function () {
    const S0 = R.S.dark, grp = new THREE.Group(), S = [], Win = [], r = rng(666);
    const y0 = S0.h; grp.position.set(S0.x, y0, S0.z);
    // stacked, tapering, buttressed tiers
    let y = 0, w = 120;
    for (let k = 0; k < 9; k++) {
      const h = 80 - k * 4, w2 = w * 0.86;
      const g = new THREE.CylinderGeometry(w2 / 2, w / 2, h, 6, 1); put(S, g, 0, y + h / 2, 0, k * 0.2);
      for (let b = 0; b < 6; b++) { const a = (b / 6) * TAU + k * 0.2; const sp = new THREE.ConeGeometry(6, h * 0.9 + 30, 4); put(S, sp, Math.cos(a) * w / 2, y + h * 0.55, Math.sin(a) * w / 2); }
      for (let wn = 0; wn < 14; wn++) { const a = r() * TAU, yy = y + r() * h; put(Win, new THREE.BoxGeometry(2, 5, 2), Math.cos(a) * (w2 / 2 + (w - w2) / 2 * (1 - (yy - y) / h)), yy, Math.sin(a) * (w2 / 2 + (w - w2) / 2 * (1 - (yy - y) / h)), -a); }
      y += h; w = w2;
    }
    // the crown: two curved horns cradling the eye
    for (const sgn of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(V3(sgn * (12 + Math.sin(t * 1.4) * 34), y + t * 95, Math.cos(t * 2) * 3)); }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 5.5, 6, false); S.push(tube);
    }
    const eyeY = y + 55;
    // ring wall with jagged towers, 1.2 km across
    const ringR = 600;
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU, am = (a0 + a1) / 2, L = 2 * ringR * Math.sin(TAU / 96) + 2;
      put(S, new THREE.BoxGeometry(14, 70, L), Math.cos(am) * ringR, 20, Math.sin(am) * ringR, -am);
      if (i % 4 === 0) { put(S, new THREE.CylinderGeometry(10, 16, 110, 6), Math.cos(am) * ringR, 40, Math.sin(am) * ringR); put(S, new THREE.ConeGeometry(12, 40, 6), Math.cos(am) * ringR, 115, Math.sin(am) * ringR); }
    }
    // lesser towers, forges and spikes inside the wall
    for (let i = 0; i < 26; i++) { const a = r() * TAU, d = 150 + r() * 380, h = 40 + r() * 120; put(S, new THREE.CylinderGeometry(6 + r() * 6, 12 + r() * 8, h, 5), Math.cos(a) * d, h / 2 - 5, Math.sin(a) * d); put(S, new THREE.ConeGeometry(9, 30, 5), Math.cos(a) * d, h + 10, Math.sin(a) * d); }
    const black = std(0x16171a, 0.75, 0.25);
    addMerged(grp, S, black);
    const winM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.9, 0.15) });
    addMerged(grp, Win, winM, false);
    // the eye: a burning slit-pupil lens (HDR, blooms)
    const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.8, 0.2) });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 12), eyeM); eye.scale.set(1.5, 0.75, 0.6); eye.position.set(0, eyeY, 0); grp.add(eye);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(2.5, 20, 12), new THREE.MeshBasicMaterial({ color: 0x050000 })); pupil.position.set(0, eyeY, 0); grp.add(pupil);
    // lava fissures across the plain
    const lava = lavaMaterial();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + 0.3, pts = [];
      for (let i = 0; i < 14; i++) { const d = 680 + i * 140, x = S0.x + Math.cos(a + Math.sin(i * 0.8) * 0.12) * d, z = S0.z + Math.sin(a + Math.sin(i * 0.8) * 0.12) * d; pts.push(V3(x, 0, z)); }
      const m = groundRibbon(W().scene, pts, 14, lava, 1.2); m.userData.realm = "darktower"; (grp.userData.extra = grp.userData.extra || []).push(m);
    }
    const lm = { group: grp, cx: S0.x, cz: S0.z, s: S0, marker: V3(S0.x, y0 + eyeY + 120, S0.z), t: 0, eye, lava };
    farSil(lm, (() => { const g = new THREE.CylinderGeometry(30, 60, y + 120, 6); g.translate(0, (y + 120) / 2, 0); return g; })(), 0x1a1b1e, V3(S0.x, y0, S0.z));
    lm.solidAt = (p) => {
      const dx = p.x - S0.x, dz = p.z - S0.z, d = Math.hypot(dx, dz), ly = p.y - y0;
      if (d < 70 && ly < y + 110) return d < 60 * (1 - ly / (y + 200)) + 12;
      return false;
    };
    lm.heightAt = (x, z) => { const d = Math.hypot(x - S0.x, z - S0.z); return Math.abs(d - ringR) < 9 ? y0 + 55 : -Infinity; };
    lm.update = (dt, cam) => {
      const d = cull(lm, cam);
      for (const m of grp.userData.extra) m.visible = grp.visible;
      lava.uniforms.time.value += dt;
      // the eye swings to watch the nearest aircraft
      const tgt = RJ.game && RJ.game.mode && RJ.game.mode.player;
      if (tgt && d < 20000) { const a = Math.atan2(tgt.pos.x - S0.x, tgt.pos.z - S0.z); eye.rotation.y = RJ.lerp(eye.rotation.y, a + Math.PI / 2, Math.min(1, dt * 0.8)); pupil.rotation.y = eye.rotation.y; }
      lm.t += dt;
      if (d < 26000 && lm.t > 0.5) { lm.t = 0; RJ.fx.smoke(V3(S0.x + RJ.rand(-300, 300), y0 + RJ.rand(20, 120), S0.z + RJ.rand(-300, 300)), V3(3, 6, 1), 40, 0.12, 14, 0.45); }
    };
    return lm;
  };

  /* ---- Fire Mountain: lava lake, lava rivers, ash column ---- */
  B.firemount = function () {
    const Z = W().gen.zones.volcano, grp = new THREE.Group(), lava = lavaMaterial();
    const top = G(Z.x, Z.z);
    // crater lake
    const lake = new THREE.Mesh(new THREE.CircleGeometry(Z.r * 0.05, 40), lava); lake.rotation.x = -Math.PI / 2; lake.position.set(Z.x, top + 12, Z.z); grp.add(lake);
    // rivers of lava down the flanks (steepest descent from points on the rim)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.4, rr = Z.r * 0.06;
      const pts = downhill(Z.x + Math.cos(a) * rr, Z.z + Math.sin(a) * rr, 70, 90);
      groundRibbon(grp, pts, 26 + k * 4, lava, 2);
    }
    const glow = new THREE.PointLight(0xff5a1a, 4, 6000, 1.6); glow.position.set(Z.x, top + 300, Z.z); grp.add(glow);
    const lm = { group: grp, cx: Z.x, cz: Z.z, s: Z, marker: V3(Z.x, top + 500, Z.z), t: 0 };
    lm.update = (dt, cam) => {
      const d = cull(lm, cam, 40000);
      lava.uniforms.time.value += dt;
      lm.t += dt;
      if (d < 40000 && lm.t > 0.25) { lm.t = 0; RJ.fx.smoke(V3(Z.x + RJ.rand(-200, 200), top + 30, Z.z + RJ.rand(-200, 200)), V3(4, 28 + Math.random() * 10, 2), 90 + Math.random() * 60, 0.18, 24, 0.5); }
      glow.intensity = 3 + Math.sin(performance.now() * 0.002) * 0.8;
    };
    return lm;
  };

  /* ---- The Hidden Valley: elegant halls on terraces, bridges, waterfalls ---- */
  B.elfvale = function () {
    const Z = W().gen.zones.valley, grp = new THREE.Group(), S = [], Rf = [], r = rng(1234), lampPts = [];
    const floorAt = (lz) => 260 + lz * 0.012;
    const bridges = [], halls = [];
    for (let i = 0; i < 26; i++) {
      const lz = -3200 + i * 250 + r() * 80, side = i % 2 ? 1 : -1;
      const across = 300 + r() * 160, lx = side * across - Math.sin(lz / 900) * 250;
      const x = Z.x + lx, z = Z.z + lz, y = G(x, z);
      const w = 34 + r() * 26, d = 22 + r() * 14, h = 18 + r() * 18;
      put(S, new THREE.BoxGeometry(w, h + 20, d), x, y + (h - 20) / 2, z, side * 0.3);
      const rf = U().prism(d + 3, 9, w + 3); rf.rotateY(Math.PI / 2); put(Rf, rf, x, y + h, z, side * 0.3);
      // slender tower with a conical cap beside each hall
      if (r() < 0.7) { const th = 60 + r() * 60; put(S, new THREE.CylinderGeometry(4.5, 6, th, 10), x + w * 0.6, y + th / 2, z); put(Rf, new THREE.ConeGeometry(6.5, 20, 10), x + w * 0.6, y + th + 10, z); lampPts.push(x + w * 0.6, y + th - 4, z); }
      // arched colonnade terrace
      for (let c = 0; c < 6; c++) put(S, new THREE.CylinderGeometry(0.9, 0.9, 9, 6), x - w / 2 + c * w / 5, y + 4.5, z + d / 2 + 4);
      put(S, new THREE.BoxGeometry(w + 2, 1.6, 9), x, y + 9.5, z + d / 2 + 4);
      lampPts.push(x, y + h * 0.6, z + d / 2 + 0.5);
      halls.push([x, y, z]);
      if (i % 4 === 1) bridges.push(lz);
    }
    // arched bridges across the river
    for (const lz of bridges) {
      const z = Z.z + lz, cx = Z.x - Math.sin(lz / 900) * 250, y = floorAt(lz);
      for (let k = -6; k <= 6; k++) { const t = k / 6, x = cx + t * 90; put(S, new THREE.BoxGeometry(15.5, 2.4, 7), x, y + 22 * (1 - t * t) + 4, z); }
      for (const sx of [-1, 1]) put(S, new THREE.BoxGeometry(6, 26, 8), cx + sx * 92, y + 9, z);
    }
    const stone = U().stoneMat(0xddd2bb, false, 0.8), roof = std(0x46695a, 0.55, 0.3);
    addMerged(grp, S, stone); addMerged(grp, Rf, roof);
    // waterfalls pouring from the rims down the valley walls
    for (let k = 0; k < 9; k++) {
      const lz = -2800 + k * 650, side = k % 2 ? 1 : -1, lx0 = side * 900 - Math.sin(lz / 900) * 250, lx1 = side * 300 - Math.sin(lz / 900) * 250;
      const top = V3(Z.x + lx0, G(Z.x + lx0, Z.z + lz) + 2, Z.z + lz), bot = V3(Z.x + lx1, G(Z.x + lx1, Z.z + lz) + 4, Z.z + lz);
      fallRibbon(grp, top, bot, 30 + r() * 24, V3(-side, 0, 0), 190); // arcs clear of the cliff face
    }
    const L = lamps(grp, lampPts, 1.2, [3.0, 2.6, 1.6]);
    const lm = { group: grp, cx: Z.x, cz: Z.z, s: Z, marker: V3(Z.x, 1800, Z.z), halls };
    lm.update = (dt, cam) => { cull(lm, cam); L.set(0.04 + nightK() * 1.2); };
    return lm;
  };

  /* ---- Jade realm: stone pillars, floating rocks, the Sky Bridge and the monastery ---- */
  B.jade = function () {
    const Z = W().gen.zones.jade, grp = new THREE.Group(), r = rng(4242);
    const pillars = [];
    const arch = { x: Z.x + 1500, z: Z.z - 800, span: 760, rise: 980, a: 0.6 };
    const mon = { x: Z.x - 3600, z: Z.z + 2600 };
    const variants = [0, 1, 2, 3].map((v) => rockColumn(1, 1, 900 + v, { seg: 16, rows: 14 }));
    const counts = [0, 0, 0, 0], mats = [];
    const tmp = [];
    for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
      const x = Z.x + gx * 1900 + (r() - 0.5) * 1400, z = Z.z + gz * 1900 + (r() - 0.5) * 1400;
      const d = Math.hypot(x - Z.x, z - Z.z);
      if (d > Z.r * 0.85 || r() < 0.15) continue;
      if (Math.hypot(x - arch.x, z - arch.z) < 900 || Math.hypot(x - mon.x, z - mon.z) < 600) continue;
      const rad = 90 + r() * 200, h = 280 + r() * 640 * (1 - d / Z.r * 0.5);
      const v = Math.floor(r() * 4);
      tmp.push({ x, z, rad, h, v, y: G(x, z) - 30 });
    }
    // the two arch abutments and the monastery's pillar
    const ax = Math.cos(arch.a), az = Math.sin(arch.a);
    tmp.push({ x: arch.x - ax * arch.span / 2, z: arch.z - az * arch.span / 2, rad: 260, h: 1050, v: 1, y: G(arch.x - ax * arch.span / 2, arch.z - az * arch.span / 2) - 40 });
    tmp.push({ x: arch.x + ax * arch.span / 2, z: arch.z + az * arch.span / 2, rad: 240, h: 980, v: 2, y: G(arch.x + ax * arch.span / 2, arch.z + az * arch.span / 2) - 40 });
    tmp.push({ x: mon.x, z: mon.z, rad: 230, h: 1150, v: 3, y: G(mon.x, mon.z) - 40, mon: true });
    for (const p of tmp) counts[p.v]++;
    const ims = variants.map((g, v) => { const m = new THREE.InstancedMesh(g, rockMat(), counts[v]); m.castShadow = true; m.receiveShadow = true; grp.add(m); mats.push(m); return m; });
    const used = [0, 0, 0, 0];
    for (const p of tmp) {
      _m4.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.set(p.rad, p.h + 40, p.rad));
      ims[p.v].setMatrixAt(used[p.v]++, _m4);
      pillars.push(p);
    }
    // floating islands with grassy tops and waterfalls
    const floats = [];
    const fl = [];
    for (let i = 0; i < 9; i++) {
      const x = Z.x + (r() - 0.5) * Z.r * 1.2, z = Z.z + (r() - 0.5) * Z.r * 1.2, y = 700 + r() * 600, rad = 60 + r() * 120;
      const g = new THREE.ConeGeometry(rad, rad * 2.4, 12, 6); g.rotateX(Math.PI); g.translate(0, -rad * 1.2, 0);
      const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const yy = p.getY(k); const s = 1 + 0.18 * Math.sin(k * 1.7) * (yy < -2 ? 1 : 0); p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s); }
      g.computeVertexNormals();
      put(fl, g, x, y, z);
      const top = new THREE.CylinderGeometry(rad * 1.02, rad, 6, 12); put(fl, top, x, y + 3, z);
      floats.push({ x, y, z, rad });
    }
    addMerged(grp, fl, std(0x6f6556, 0.95));
    for (const f of floats.slice(0, 5)) fallRibbon(grp, V3(f.x + f.rad * 0.9, f.y + 4, f.z), V3(f.x + f.rad * 1.2, f.y - 420, f.z), 10, V3(1, 0, 0));
    // the Sky Bridge: an arch of noise-displaced rock between the two giants, 600 m clear underneath
    const archPts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, s = t - 0.5;
      archPts.push(V3(arch.x + ax * s * arch.span, G(arch.x, arch.z) + arch.rise * (1 - 4 * s * s) + 160 * Math.sin(t * Math.PI), arch.z + az * s * arch.span));
    }
    const curve = new THREE.CatmullRomCurve3(archPts);
    const tube = new THREE.TubeGeometry(curve, 60, 70, 14, false);
    { const p = tube.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); const n = Math.sin(x * 0.03 + z * 0.02) * 0.5 + Math.sin(y * 0.05) * 0.5; p.setY(k, y + n * 12); } tube.computeVertexNormals(); }
    const archMesh = new THREE.Mesh(tube, std(0x7a7062, 0.95)); archMesh.castShadow = true; archMesh.receiveShadow = true; grp.add(archMesh);
    // hanging vines under the arch, waterfalls off its crown, a cap of greenery
    const vines = [];
    for (let i = 3; i < 22; i++) { const p0 = curve.getPoint(i / 24); for (let j = 0; j < 6; j++) { const len = 30 + r() * 90; put(vines, new THREE.BoxGeometry(1.2, len, 1.2), p0.x + (r() - 0.5) * 80, p0.y - 70 - len / 2, p0.z + (r() - 0.5) * 80); } }
    addMerged(grp, vines, std(0x2f5a28, 0.9), false);
    const crown = curve.getPoint(0.5);
    fallRibbon(grp, V3(crown.x + 50, crown.y + 60, crown.z), V3(crown.x + 110, G(crown.x, crown.z) + 5, crown.z + 30), 22, V3(0.5, 0, 0.8));
    // the monastery: halls, balconies and stairs stepping up the pillar's cliff, walkways to its neighbours
    const monP = pillars.find((p) => p.mon), S = [], Rf = [], wood = [], lampPts = [];
    for (let k = 0; k < 12; k++) {
      const yy = monP.y + 300 + k * 65, a = 3.6 + k * 0.3, rad = monP.rad * (1 - (yy - monP.y) / (monP.h + 40) * 0.18) + 6;
      const x = monP.x + Math.cos(a) * rad, z = monP.z + Math.sin(a) * rad;
      const w = 44 + (k % 3) * 12;
      put(S, new THREE.BoxGeometry(w, 6, 18), x, yy - 3, z, -a + Math.PI / 2); // stone foundation ledge
      put(wood, new THREE.BoxGeometry(w - 4, 16, 18), x, yy + 8, z, -a + Math.PI / 2);
      for (let f = 0; f < 2; f++) { const rf = U().prism(16 - f * 4, 5, w + 6 - f * 6); rf.rotateY(Math.PI / 2); put(Rf, rf, x, yy + 12 + f * 7, z, -a + Math.PI / 2); if (f === 0) put(wood, new THREE.BoxGeometry(w - 8, 6, 9), x, yy + 15, z, -a + Math.PI / 2); }
      put(wood, new THREE.BoxGeometry(w, 1, 4), x + Math.cos(a) * 9, yy + 1, z + Math.sin(a) * 9, -a + Math.PI / 2); // balcony
      lampPts.push(x + Math.cos(a) * 10, yy + 4, z + Math.sin(a) * 10);
      if (k) { const pa = 3.6 + (k - 1) * 0.3; for (let s2 = 0; s2 < 8; s2++) { const t = s2 / 8, aa = pa + (a - pa) * t; put(S, new THREE.BoxGeometry(5, 2, 3), monP.x + Math.cos(aa) * (rad + 3), yy - 65 + t * 65, monP.z + Math.sin(aa) * (rad + 3), -aa); } }
    }
    // a pagoda tower on the summit and a rope walkway to the nearest pillar
    const topY = monP.y + monP.h + 40;
    for (let f = 0; f < 5; f++) { put(wood, new THREE.BoxGeometry(20 - f * 3, 9, 20 - f * 3), monP.x, topY + 4.5 + f * 13, monP.z); put(Rf, new THREE.ConeGeometry(17 - f * 3, 5, 4, 1), monP.x, topY + 11 + f * 13, monP.z, Math.PI / 4); }
    const nb = pillars.filter((p) => !p.mon).sort((a, b) => Math.hypot(a.x - monP.x, a.z - monP.z) - Math.hypot(b.x - monP.x, b.z - monP.z))[0];
    if (nb) {
      const y1 = monP.y + 700, y2 = Math.min(nb.y + nb.h + 30, y1 + 50), n = 30;
      for (let i = 0; i <= n; i++) { const t = i / n, x = monP.x + (nb.x - monP.x) * t, z = monP.z + (nb.z - monP.z) * t, y = y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * 40; put(wood, new THREE.BoxGeometry(6, 0.8, 4), x, y, z, Math.atan2(nb.x - monP.x, nb.z - monP.z)); }
    }
    addMerged(grp, S, U().stoneMat(0x8a8273, false, 0.9)); addMerged(grp, Rf, std(0x2a2b2e, 0.6, 0.2)); addMerged(grp, wood, std(0x7a3a22, 0.75));
    fallRibbon(grp, V3(monP.x + monP.rad * 1.02, monP.y + 900, monP.z), V3(monP.x + monP.rad * 1.3, monP.y + 60, monP.z + 40), 16, V3(1, 0, 0.2));
    const L = lamps(grp, lampPts, 1.3, [3.4, 1.8, 0.7]);
    const lmJ = { group: grp, cx: Z.x, cz: Z.z, pillars, floats, arch, mon: monP, curve, t: 0 };
    lmJ.solidAt = (p) => {
      if (Math.abs(p.x - Z.x) > Z.r + 400 || Math.abs(p.z - Z.z) > Z.r + 400) return false;
      for (const q of pillars) { const dx = p.x - q.x, dz = p.z - q.z; if (dx * dx + dz * dz < q.rad * q.rad * 1.25 && p.y < q.y + q.h + 40) return true; }
      for (const f of floats) { const dx = p.x - f.x, dz = p.z - f.z, dy = f.y - p.y; if (dy > -8 && dy < f.rad * 2.4 && dx * dx + dz * dz < Math.pow(f.rad * (1 - dy / (f.rad * 2.4)) + 6, 2)) return true; }
      // the arch body: distance to its centreline
      const lx = (p.x - arch.x) * ax + (p.z - arch.z) * az, lz = -(p.x - arch.x) * az + (p.z - arch.z) * ax;
      if (Math.abs(lx) < arch.span / 2 + 60 && Math.abs(lz) < 80) { const s = RJ.clamp(lx / arch.span, -0.5, 0.5), cy = G(arch.x, arch.z) + arch.rise * (1 - 4 * s * s) + 160 * Math.sin((s + 0.5) * Math.PI); if (Math.abs(p.y - cy) < 72) return true; }
      return false;
    };
    lmJ.update = (dt, cam) => { cull(lmJ, cam); L.set(0.04 + nightK() * 1.1); lmJ.t += dt; if (lmJ.dist < 9000 && lmJ.t > 0.6) { lmJ.t = 0; RJ.fx.smoke(V3(crown.x + 90, G(crown.x, crown.z) + 20, crown.z + 30), V3(2, 4, 1), 50, 0.95, 10, 0.25); } };
    return lmJ;
  };

  /* ---- The Sky Fortress: a floating island of ruins, towers, a great tree and slow machinery ---- */
  B.skyfortress = function () {
    const S0 = R.S.sky, grp = new THREE.Group(), r = rng(1986);
    grp.position.set(S0.x, S0.y, S0.z);
    const Rb = 780;
    // the rock body: an inverted, noisy cone 900 m deep
    const body = new THREE.ConeGeometry(Rb, 900, 28, 12); body.rotateX(Math.PI); body.translate(0, -450, 0);
    { const p = body.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); if (y < -5) { const s = 1 + 0.14 * Math.sin(Math.atan2(z, x) * 5 + y * 0.01) + 0.08 * Math.sin(y * 0.03); p.setX(k, x * s); p.setZ(k, z * s); } } body.computeVertexNormals(); }
    const bodyM = new THREE.Mesh(body, std(0x6a6152, 0.95)); bodyM.castShadow = true; grp.add(bodyM);
    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(Rb * 1.01, Rb * 1.01, 4, 40), std(0x4f7a3a, 0.95)); lawn.position.y = 0; grp.add(lawn);
    // terraced ruins: three rings of broken walls stepping up, towers, arches
    const S = [];
    for (let k = 0; k < 3; k++) {
      const rr = Rb * (0.92 - k * 0.27), y = k * 60, n = 40 - k * 8;
      put(S, new THREE.CylinderGeometry(rr, rr + 8, 60, 40, 1, true), 0, y - 30 + 2, 0);
      put(S, new THREE.CylinderGeometry(rr, rr, 4, 40), 0, y + 2, 0);
      for (let i = 0; i < n; i++) {
        if (r() < 0.3) continue; // ruins: gaps
        const a = (i / n) * TAU, h = 14 + r() * 26;
        put(S, new THREE.BoxGeometry(6, h, rr * TAU / n * 0.9), Math.cos(a) * rr, y + h / 2, Math.sin(a) * rr, -a);
        if (i % 5 === 0) { const th = 60 + r() * 120; put(S, new THREE.CylinderGeometry(12, 15, th, 12), Math.cos(a) * rr, y + th / 2, Math.sin(a) * rr); }
      }
    }
    // the great tower block at the centre and its arcade
    put(S, new THREE.CylinderGeometry(60, 75, 200, 16), 0, 180 + 100, 0);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; put(S, new THREE.BoxGeometry(14, 40, 30), Math.cos(a) * 82, 200, Math.sin(a) * 82, -a); }
    addMerged(grp, S, U().stoneMat(0xa79f8c, false, 0.9));
    // the great tree crowning it
    const tree = [];
    put(tree, new THREE.CylinderGeometry(9, 22, 160, 10), 0, 380 + 80, 0);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; put(tree, new THREE.CylinderGeometry(3, 7, 90, 6), Math.cos(a) * 40, 470, Math.sin(a) * 40, a); }
    addMerged(grp, tree, std(0x5a4632, 0.9));
    const can = [];
    for (let i = 0; i < 26; i++) { const a = r() * TAU, d = r() * 120; put(can, new THREE.SphereGeometry(45 + r() * 35, 10, 8), Math.cos(a) * d, 540 + r() * 70, Math.sin(a) * d); }
    addMerged(grp, can, std(0x3d6b2e, 0.9));
    // ancient machinery: great bronze rings turning slowly around the island
    const rings = [];
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(Rb + 120 + i * 70, 9, 8, 96), std(0x8a6a3a, 0.45, 0.7)); t.rotation.x = Math.PI / 2 + (i - 1) * 0.18; t.position.y = -120 - i * 90; grp.add(t); rings.push(t); }
    // waterfalls pouring off the rim into the clouds, and a skirt of cloud below
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; fallRibbon(grp, V3(Math.cos(a) * Rb, 2, Math.sin(a) * Rb), V3(Math.cos(a) * (Rb + 90), -700, Math.sin(a) * (Rb + 90)), 28, V3(Math.cos(a), 0, Math.sin(a))); }
    // satellite islands linked by bridges
    const sats = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.5, d = Rb + 520, x = Math.cos(a) * d, z = Math.sin(a) * d, y = -60 + r() * 140, rad = 140;
      const g = new THREE.ConeGeometry(rad, 320, 14, 4); g.rotateX(Math.PI); g.translate(x, y - 160, z);
      const gm = new THREE.Mesh(g, std(0x6a6152, 0.95)); gm.castShadow = true; grp.add(gm);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 3, 14), std(0x4f7a3a, 0.95)); top.position.set(x, y, z); grp.add(top);
      const B2 = []; const n = 22; for (let j = 0; j <= n; j++) { const t = j / n, xx = Math.cos(a) * (Rb - 20 + (d - rad - Rb + 40) * t), zz = Math.sin(a) * (Rb - 20 + (d - rad - Rb + 40) * t), yy = 2 + (y - 2) * t - Math.sin(t * Math.PI) * 12; put(B2, new THREE.BoxGeometry(10, 2, 14), xx, yy, zz, -a); }
      addMerged(grp, B2, std(0x7b6a52, 0.85));
      sats.push({ x: S0.x + x, y: S0.y + y, z: S0.z + z, rad });
    }
    const cloudM = new THREE.SpriteMaterial({ map: RJ.realms.puffTex(), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: true });
    for (let i = 0; i < 40; i++) { const sp = new THREE.Sprite(cloudM); const a = r() * TAU, d = 300 + r() * 1300; sp.position.set(Math.cos(a) * d, -650 - r() * 450, Math.sin(a) * d); sp.scale.setScalar(380 + r() * 520); grp.add(sp); }
    const lm = { group: grp, cx: S0.x, cz: S0.z, s: S0, marker: V3(S0.x, S0.y + 700, S0.z), rings, sats };
    farSil(lm, (() => { const g = new THREE.ConeGeometry(Rb, 900, 16); g.rotateX(Math.PI); g.translate(0, -450, 0); const t = new THREE.CylinderGeometry(60, 75, 480, 8); t.translate(0, 240, 0); const c = new THREE.SphereGeometry(160, 8, 6); c.translate(0, 560, 0); return U().merge([g, t, c]); })(), 0x8c8a86, V3(S0.x, S0.y, S0.z));
    lm.solidAt = (p) => {
      const dx = p.x - S0.x, dz = p.z - S0.z, d = Math.hypot(dx, dz), ly = p.y - S0.y;
      if (d > Rb + 900) return false;
      if (ly < 4 && ly > -900 && d < Rb * (1 + ly / 900) * 1.08) return true; // the rock
      if (d < 78 && ly < 380) return true;                                      // the great tower
      if (d < 26 && ly < 540) return true;                                      // tree trunk
      if (Math.hypot(dx, dz) < 200 && ly > 500 && ly < 650) return true;         // canopy
      for (const s of sats) { const sx = p.x - s.x, sz = p.z - s.z, sy = s.y - p.y; if (sy > -4 && sy < 320 && sx * sx + sz * sz < Math.pow(s.rad * (1 - sy / 320), 2)) return true; }
      return false;
    };
    lm.heightAt = (x, z) => { const d = Math.hypot(x - S0.x, z - S0.z); return d < Rb ? S0.y + 3 : -Infinity; };
    lm.update = (dt, cam) => { cull(lm, cam, 30000); rings.forEach((t, i) => (t.rotation.z += dt * (0.02 + i * 0.012) * (i % 2 ? -1 : 1))); };
    return lm;
  };

  /* ---- The Mountain Observatory: a 300 m dish on an alt-az mount, a small array, buildings and roads ---- */
  B.observatory = function () {
    const S0 = R.S.observatory, grp = new THREE.Group(), S = [], Wh = [], r = rng(1997);
    if (!S0) return null;
    grp.position.set(S0.x, S0.h, S0.z);
    const dishR = 150;
    // mount: rotating azimuth base and yoke
    const az = new THREE.Group(); grp.add(az);
    const mount = [];
    put(mount, new THREE.CylinderGeometry(42, 48, 26, 24), 0, 13, 0);
    for (const sx of [-1, 1]) { put(mount, new THREE.BoxGeometry(10, 120, 24), sx * 60, 80, 0); }
    az.add(new THREE.Mesh(U().merge(mount), std(0xd8d8d4, 0.5, 0.4)));
    const elev = new THREE.Group(); elev.position.y = 140; az.add(elev);
    // the paraboloid dish (lathe), a lattice of ribs behind, the feed on a tripod
    const prof = []; for (let i = 0; i <= 16; i++) { const t = i / 16, rr = t * dishR; prof.push(new THREE.Vector2(rr, rr * rr / (4 * 130))); }
    const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), std(0xf2f2f0, 0.35, 0.55, { side: THREE.DoubleSide }));
    dish.rotation.x = -Math.PI / 2; elev.add(dish);
    const ribs = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const g = new THREE.BoxGeometry(2, 2, dishR); g.translate(0, 0, dishR / 2); g.rotateX(-0.42); g.rotateY(a); ribs.push(g); }
    for (const sx of [-1, 1]) { const g = new THREE.CylinderGeometry(1.4, 1.4, 150, 6); g.rotateX(Math.PI / 2 + sx * 0.0); g.rotateZ(sx * 0.55); g.translate(sx * 42, 0, 70); ribs.push(g); }
    const tri = new THREE.CylinderGeometry(1.2, 1.2, 140, 6); tri.translate(0, 0, 0); tri.rotateX(Math.PI / 2); tri.translate(0, 0, 70); ribs.push(tri);
    const feed = new THREE.BoxGeometry(14, 14, 18); feed.translate(0, 0, 135); ribs.push(feed);
    const rib = new THREE.Mesh(U().merge(ribs), std(0xbfc1c4, 0.4, 0.6)); rib.rotation.x = -Math.PI / 2; elev.add(rib);
    // a Y-shaped array of smaller dishes along service roads
    const small = [];
    const sProf = []; for (let i = 0; i <= 8; i++) { const t = i / 8, rr = t * 13; sProf.push(new THREE.Vector2(rr, rr * rr / 40)); }
    const sd = new THREE.LatheGeometry(sProf, 20);
    for (let arm = 0; arm < 3; arm++) for (let k = 1; k <= 5; k++) {
      const a = (arm / 3) * TAU + 0.3, d = 200 + k * 85, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const g = sd.clone(); g.rotateX(-1.0); g.translate(x, 30, z); small.push(g);
      put(S, new THREE.CylinderGeometry(2.5, 3.5, 24, 8), x, 12, z);
    }
    grp.add(new THREE.Mesh(U().merge(small), std(0xf0f0ee, 0.4, 0.4, { side: THREE.DoubleSide })));
    // control centre, labs, maintenance hangars, antennas, parking with cars
    put(S, new THREE.BoxGeometry(70, 16, 34), -180, 8, 160); put(S, new THREE.BoxGeometry(40, 10, 24), -240, 5, 110);
    put(S, new THREE.BoxGeometry(50, 18, 40), 200, 9, 190);
    for (let i = 0; i < 4; i++) { put(S, new THREE.CylinderGeometry(0.6, 1.2, 60 + i * 15, 6), -290 + i * 22, 30 + i * 7, 230); }
    const lampP = [];
    for (let i = 0; i < 4; i++) lampP.push(-290 + i * 22, 62 + i * 15, 230);
    for (let i = 0; i < 22; i++) { const x = -150 + (i % 11) * 6, z = 220 + Math.floor(i / 11) * 9; put(Wh, new THREE.BoxGeometry(2, 1.5, 4.4), x, 0.9, z); }
    addMerged(grp, S, std(0xe9e7e2, 0.6, 0.1));
    addMerged(grp, Wh, std(0x445566, 0.4, 0.6));
    const road = new THREE.Mesh(new THREE.RingGeometry(170, 182, 48), std(0x3a3b3d, 0.95)); road.rotation.x = -Math.PI / 2; road.position.y = 0.4; grp.add(road);
    // the access road winding down the mountain
    const rpts = downhill(S0.x + 300, S0.z + 300, 60, 60);
    groundRibbon(W().scene, rpts, 8, std(0x3a3b3d, 0.95), 0.6).visible = true;
    const L = lamps(grp, lampP, 0.9, [4, 0.3, 0.2]);
    const lm = { group: grp, cx: S0.x, cz: S0.z, s: S0, marker: V3(S0.x, S0.h + 400, S0.z), t: 0 };
    lm.solidAt = (p) => { const dx = p.x - S0.x, dz = p.z - S0.z, ly = p.y - S0.h; return dx * dx + dz * dz < 170 * 170 && ly < 300 && ly > -5 && (Math.hypot(dx, dz) < 60 || Math.abs(ly - 140) < 120); };
    lm.update = (dt, cam) => {
      cull(lm, cam);
      lm.t += dt;
      az.rotation.y += dt * 0.02;                       // slow sidereal tracking
      elev.rotation.x = -0.7 + Math.sin(lm.t * 0.03) * 0.25;
      L.set((Math.floor(lm.t * 1.2) % 2 ? 0.1 : 1) * (0.4 + nightK()));
    };
    return lm;
  };

  /* ---- The Giant Redwoods: thousands of 60–140 m trees with buttress roots ---- */
  B.redwoods = function () {
    const Z = W().gen.zones.redwood, grp = new THREE.Group(), r = rng(115);
    // fluted, buttressed trunk with cinnamon bark streaks (vertex colours tint the instance colour)
    const trunkG = new THREE.CylinderGeometry(0.2, 1, 1, 12, 8, false); trunkG.translate(0, 0.5, 0);
    {
      const p = trunkG.attributes.position, tc = [];
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
        const flare = 1 + 1.5 * Math.pow(Math.max(0, 0.16 - y) / 0.16, 2) * (0.6 + 0.4 * Math.sin(a * 5)) + 0.07 * Math.sin(a * 12);
        p.setX(i, p.getX(i) * flare); p.setZ(i, p.getZ(i) * flare);
        const k = 0.78 + 0.22 * Math.sin(a * 12) * Math.sin(a * 5 + y * 9) - 0.2 * Math.max(0, 0.08 - y) / 0.08;
        tc.push(k, k * 0.95, k * 0.92);
      }
      trunkG.setAttribute("color", new THREE.Float32BufferAttribute(tc, 3));
      trunkG.computeVertexNormals();
    }
    // narrow columnar crown: irregular foliage clumps on short branches over the top half
    const crownParts = [], cr = rng(77);
    for (let i = 0; i < 11; i++) {
      const t = i / 10, y = 0.46 + t * 0.5, a = i * 2.4 + cr() * 0.8;
      const rad = (1 - t * 0.75) * (0.85 + cr() * 0.35), off = (1 - t) * 0.9;
      const g = new THREE.IcosahedronGeometry(1, 0); g.scale(rad * 1.4, 0.07 * (1 - t * 0.4), rad * 1.4);
      const pp = g.attributes.position; for (let j = 0; j < pp.count; j++) pp.setXYZ(j, pp.getX(j) * (0.8 + cr() * 0.4), pp.getY(j), pp.getZ(j) * (0.8 + cr() * 0.4));
      g.translate(Math.cos(a) * off, y, Math.sin(a) * off);
      const sh = 0.62 + t * 0.38, cc = []; for (let j = 0; j < pp.count; j++) { const v = sh * (0.85 + cr() * 0.3); cc.push(v, v, v); }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3)); g.deleteAttribute("uv");
      crownParts.push(g);
    }
    { const tip = new THREE.ConeGeometry(0.35, 0.1, 6); tip.translate(0, 0.97, 0); tip.deleteAttribute("uv"); const cc = []; for (let j = 0; j < tip.attributes.position.count; j++) cc.push(1, 1, 1); tip.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3)); crownParts.push(tip.toNonIndexed()); }
    const crownG = U().merge(crownParts.map((g) => (g.index ? g.toNonIndexed() : g))); crownG.computeVertexNormals();
    const trees = [];
    // a grove of named giants at the heart of the forest, then the rest
    for (let i = 0; i < 14; i++) { const a = r() * TAU, d = r() * 900, x = Z.x + Math.cos(a) * d, z = Z.z + Math.sin(a) * d, y = G(x, z); if (y > 20) trees.push({ x, z, y, h: 120 + r() * 20, rad: 6 + r() * 2 }); }
    for (let i = 0; i < 3400; i++) {
      // most trees crowd a dense old-growth grove around the heart; the rest thin out toward the edges
      const core = i < 2200, a = r() * TAU, d = Math.sqrt(r()) * (core ? 2200 : Z.r * 0.92), x = Z.x + Math.cos(a) * d, z = Z.z + Math.sin(a) * d;
      const y = G(x, z); if (y < 20) continue;
      const hero = d < Z.r * 0.55;
      const h = hero ? 90 + r() * 30 : 60 + r() * 35, rad = h * (0.032 + r() * 0.01);
      trees.push({ x, z, y, h, rad });
    }
    const n = trees.length;
    const trunks = new THREE.InstancedMesh(trunkG, std(0xffffff, 0.92, 0, { vertexColors: true }), n), crowns = new THREE.InstancedMesh(crownG, std(0xffffff, 0.9, 0, { vertexColors: true }), n);
    trunks.castShadow = crowns.castShadow = true; trunks.receiveShadow = crowns.receiveShadow = true;
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      _q.setFromEuler(_e.set((r() - 0.5) * 0.03, r() * TAU, (r() - 0.5) * 0.03));
      _m4.compose(_p.set(t.x, t.y - 2, t.z), _q, _s.set(t.rad, t.h, t.rad)); trunks.setMatrixAt(i, _m4);
      trunks.setColorAt(i, c.setHSL(0.025 + r() * 0.015, 0.42 + r() * 0.12, 0.24 + r() * 0.06));
      const cw = t.h * (0.085 + r() * 0.025);
      _m4.compose(_p.set(t.x, t.y - 2, t.z), _q, _s.set(cw, t.h, cw)); crowns.setMatrixAt(i, _m4);
      crowns.setColorAt(i, c.setHSL(0.28 + r() * 0.06, 0.26 + r() * 0.12, 0.17 + r() * 0.05));
    });
    grp.add(trunks, crowns);
    // understory: sword-fern clumps and fallen logs between the trunks
    const fernG = U().merge([0, 1, 2, 3, 4, 5].map((k) => { const g = new THREE.ConeGeometry(0.35, 2.6, 3); g.translate(0, 1.3, 0); g.rotateZ(0.9); g.rotateY((k / 6) * TAU); return g; }));
    const nFern = 5000, ferns = new THREE.InstancedMesh(fernG, std(0x3f6b2a, 0.85), nFern);
    for (let i = 0; i < nFern; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 2400, x = Z.x + Math.cos(a) * d, z = Z.z + Math.sin(a) * d; _m4.compose(_p.set(x, G(x, z) - 0.3, z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.setScalar(1.5 + r() * 1.8)); ferns.setMatrixAt(i, _m4); ferns.setColorAt(i, c.setHSL(0.25 + r() * 0.06, 0.45, 0.2 + r() * 0.08)); }
    const logG = new THREE.CylinderGeometry(1, 1, 1, 8); logG.rotateZ(Math.PI / 2);
    const nLog = 160, logs = new THREE.InstancedMesh(logG, std(0x5a3424, 0.95), nLog);
    for (let i = 0; i < nLog; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 2400, x = Z.x + Math.cos(a) * d, z = Z.z + Math.sin(a) * d, rr = 1.5 + r() * 2.5; _m4.compose(_p.set(x, G(x, z) + rr * 0.6, z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.set(40 + r() * 40, rr, rr)); logs.setMatrixAt(i, _m4); }
    ferns.receiveShadow = logs.receiveShadow = true;
    grp.add(ferns, logs);
    // grid for collision lookups
    const cell = 200, grid = new Map();
    trees.forEach((t) => { const k = Math.floor(t.x / cell) + ":" + Math.floor(t.z / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); });
    // waterfalls where the valley drops off ridges
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.7, x = Z.x + Math.cos(a) * Z.r * 0.75, z = Z.z + Math.sin(a) * Z.r * 0.75;
      const pts = downhill(x, z, 6, 60);
      const top = V3(pts[0].x, G(pts[0].x, pts[0].z) + 1, pts[0].z), bot = V3(pts[pts.length - 1].x, G(pts[pts.length - 1].x, pts[pts.length - 1].z) + 2, pts[pts.length - 1].z);
      if (top.y - bot.y > 40) fallRibbon(grp, top, bot, 24, V3(bot.x - top.x, 0, bot.z - top.z).normalize());
    }
    const lm = { group: grp, cx: Z.x, cz: Z.z, s: Z, marker: V3(Z.x, 700, Z.z), trees, t: 0 };
    lm.solidAt = (p) => {
      const ci = Math.floor(p.x / cell), cj = Math.floor(p.z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const L2 = grid.get((ci + a) + ":" + (cj + b)); if (!L2) continue;
        for (const t of L2) {
          const ly = p.y - t.y; if (ly > t.h || ly < -5) continue;
          const rr = ly < t.h * 0.45 ? t.rad * 1.3 : t.h * 0.1 * 1.2 * (1 - (ly - t.h * 0.45) / (t.h * 0.55)) + t.rad;
          if ((p.x - t.x) ** 2 + (p.z - t.z) ** 2 < rr * rr) return true;
        }
      }
      return false;
    };
    lm.update = (dt, cam) => { const d = cull(lm, cam, 22000); lm.t += dt; if (d < 6000 && lm.t > 0.5) { lm.t = 0; RJ.fx.smoke(V3(cam.position.x + RJ.rand(-600, 600), G(cam.position.x, cam.position.z) + 30, cam.position.z + RJ.rand(-600, 600)), V3(1, 0.5, 0.5), 60, 0.92, 14, 0.18); } };
    return lm;
  };

  /* ---- The Ice Fortress and the standing stones of the White Mountains ---- */
  B.icefortress = function () {
    const S0 = R.S.ice, grp = new THREE.Group(), r = rng(31415);
    if (!S0) return null;
    grp.position.set(S0.x, S0.h, S0.z);
    const ice = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88, emissive: 0x0a2236, envMapIntensity: 2.2 });
    const S = [];
    // star-shaped curtain wall with towers at the points
    const pts = 10, R1 = 420, R2 = 300;
    const corners = [];
    for (let i = 0; i < pts * 2; i++) { const a = (i / (pts * 2)) * TAU, rr = i % 2 ? R2 : R1; corners.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    for (let i = 0; i < corners.length; i++) {
      const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % corners.length], L = Math.hypot(x1 - x0, z1 - z0);
      put(S, new THREE.BoxGeometry(16, 110, L + 6), (x0 + x1) / 2, 30, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0));
      if (i % 2 === 0) { const h = 150 + r() * 60; put(S, new THREE.CylinderGeometry(0, 26, h, 6), x0, h / 2, z0); }
    }
    // crystalline keep: clustered hexagonal spires up to 380 m
    for (let i = 0; i < 22; i++) {
      const a = r() * TAU, d = r() * 150, h = 120 + r() * 260 * (1 - d / 200), w = 10 + r() * 16;
      const g = new THREE.CylinderGeometry(w, w, h, 6); g.translate(0, h / 2, 0);
      const tip = new THREE.ConeGeometry(w, w * 3.2, 6); tip.translate(0, h + w * 1.6, 0);
      const m = U().merge([g, tip]); m.rotateZ((r() - 0.5) * 0.25); m.rotateX((r() - 0.5) * 0.25);
      put(S, m, Math.cos(a) * d, -10, Math.sin(a) * d);
    }
    // frozen gate and an ice bridge over the ravine in front
    put(S, new THREE.BoxGeometry(70, 26, 26), R1 + 4, 120, 0);
    for (let k = -10; k <= 10; k++) { const t = k / 10; put(S, new THREE.BoxGeometry(14, 4, 30), R1 + 60 + (t + 1) * 160, 60 * (1 - t * t) - 20, 0); }
    const mesh = new THREE.Mesh(U().merge(S), ice); mesh.castShadow = true; grp.add(mesh);
    // frozen waterfall hanging off the cliff
    const fz = new THREE.Mesh(new THREE.PlaneGeometry(60, 260, 8, 20), ice); fz.position.set(-R1 - 20, -120, 0); fz.rotation.y = Math.PI / 2; grp.add(fz);
    // standing stones (a stone table and ring) lower in the range
    const st = R.S.stones;
    if (st) {
      const SS = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; put(SS, new THREE.BoxGeometry(5, 11 + (i % 3) * 3, 3), st.x - S0.x + Math.cos(a) * 34, st.h - S0.h + 5, st.z - S0.z + Math.sin(a) * 34, -a); }
      put(SS, new THREE.BoxGeometry(14, 3, 7), st.x - S0.x, st.h - S0.h + 3, st.z - S0.z);
      addMerged(grp, SS, std(0x8b8a86, 0.95));
    }
    const glowP = []; for (const [x, z] of corners.filter((_, i) => i % 2 === 0)) glowP.push(x, 160, z);
    const L = lamps(grp, glowP, 2.2, [0.6, 1.4, 3.2]);
    const lm = { group: grp, cx: S0.x, cz: S0.z, s: S0, marker: V3(S0.x, S0.h + 500, S0.z), t: 0 };
    farSil(lm, (() => { const g = new THREE.ConeGeometry(160, 420, 6); g.translate(0, 210, 0); return g; })(), 0xcfe7f7, V3(S0.x, S0.h, S0.z));
    lm.solidAt = (p) => { const dx = p.x - S0.x, dz = p.z - S0.z, d = Math.hypot(dx, dz), ly = p.y - S0.h; if (d > R1 + 40) return false; if (d < 170 && ly < 360 * (1 - d / 220)) return true; return Math.abs(d - (R1 + R2) / 2) < (R1 - R2) / 2 + 12 && ly < 86; };
    lm.update = (dt, cam) => {
      const d = cull(lm, cam);
      L.set(0.15 + nightK() * 1.2);
      // a snow squall in the high range
      lm.t += dt;
      if (d < 12000 && lm.t > 0.08) { lm.t = 0; const c = cam.position; RJ.fx.smoke(V3(c.x + RJ.rand(-250, 250), c.y + RJ.rand(-80, 120), c.z + RJ.rand(-250, 250)), V3(18, -4, 6), 1.2, 1, 4, 0.8); }
    };
    return lm;
  };

  /* ---- Bikini Bottom: a seabed town you can dive into ---- */
  B.bikini = function () {
    const S0 = R.S.bikini, grp = new THREE.Group(), r = rng(1999);
    if (!S0) return null;
    S0.r = 3200;
    const floor = (x, z) => G(x, z);
    grp.position.set(S0.x, 0, S0.z);
    const houses = [];
    const addHouse = (kind, ax, az) => {
      const x = S0.x + ax, z = S0.z + az, y = floor(x, z);
      const g = new THREE.Group(); g.position.set(ax, y, az); grp.add(g);
      if (kind === "pineapple") {
        const body = new THREE.SphereGeometry(13, 24, 18); body.scale(1, 1.45, 1); body.translate(0, 17, 0);
        const col = []; const p = body.attributes.position;
        for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), yy = p.getY(i); const d = Math.abs(Math.sin(a * 6 + yy * 0.35)) * Math.abs(Math.sin(a * 6 - yy * 0.35)); const k = 0.75 + d * 0.35; col.push(0.95 * k, 0.62 * k, 0.12 * k); }
        body.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        g.add(new THREE.Mesh(body, std(0xffffff, 0.75, 0, { vertexColors: true })));
        const leaves = []; for (let i = 0; i < 9; i++) { const lf = new THREE.ConeGeometry(2.4, 18, 4); lf.translate(0, 9, 0); lf.rotateZ(0.5 + (i % 3) * 0.2); lf.rotateY((i / 9) * TAU); lf.translate(0, 34, 0); leaves.push(lf); }
        g.add(new THREE.Mesh(U().merge(leaves), std(0x3f9a3a, 0.7)));
        const door = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1, 16), std(0x7a7f86, 0.4, 0.7)); door.rotation.x = Math.PI / 2; door.position.set(0, 4, 12.6); g.add(door);
        for (const [wx, wy] of [[-6, 16], [6, 22]]) { const w = new THREE.Mesh(new THREE.TorusGeometry(2, 0.5, 6, 16), std(0x7a7f86, 0.4, 0.7)); w.position.set(wx, wy, 11.6); g.add(w); }
        houses.push({ x, z, y, r: 14, h: 52 });
      } else if (kind === "rock") {
        const dome = new THREE.SphereGeometry(16, 20, 10, 0, TAU, 0, Math.PI / 2); dome.scale(1, 0.75, 1);
        g.add(new THREE.Mesh(dome, std(0x8a5a44, 0.95)));
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8, 4), std(0x333333, 0.5, 0.6)); ant.position.set(3, 14, 2); g.add(ant);
        houses.push({ x, z, y, r: 16, h: 13 });
      } else if (kind === "tiki") {
        const head = new THREE.BoxGeometry(14, 30, 12); head.translate(0, 15, 0);
        const nose = new THREE.BoxGeometry(4, 12, 5); nose.translate(0, 18, 7);
        const brow = new THREE.BoxGeometry(14.5, 3, 4); brow.translate(0, 24, 5);
        g.add(new THREE.Mesh(U().merge([head, nose, brow]), std(0x5f6a7c, 0.9)));
        houses.push({ x, z, y, r: 10, h: 31 });
      } else if (kind === "diner") {
        // a plank-walled burger shack shaped like a lobster trap, with porthole windows
        const walls = []; for (let i = 0; i < 9; i++) { const pl = new THREE.BoxGeometry(46, 2.6, 1.2); pl.translate(0, 2 + i * 3, 15.5); walls.push(pl); const pl2 = pl.clone(); pl2.translate(0, 0, -31); walls.push(pl2); }
        for (let i = 0; i < 6; i++) { const pl = new THREE.BoxGeometry(1.2, 2.6, 32); pl.translate(-23, 2 + i * 3 * 1.5, 0); walls.push(pl); const pl2 = pl.clone(); pl2.translate(46, 0, 0); walls.push(pl2); }
        g.add(new THREE.Mesh(U().merge(walls), std(0x9a6b3c, 0.85)));
        const roof = new THREE.CylinderGeometry(16.5, 16.5, 46, 16, 1, false, 0, Math.PI); roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 2); roof.translate(0, 28, 0);
        g.add(new THREE.Mesh(roof, std(0x8a5a30, 0.9)));
        for (let i = -2; i <= 2; i++) { const w = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.6, 6, 16), std(0x6b7076, 0.4, 0.7)); w.position.set(i * 8, 14, 16.5); g.add(w); }
        const anchor = new THREE.Mesh(new THREE.TorusGeometry(5, 0.9, 6, 20, Math.PI), std(0x4a4f55, 0.5, 0.7)); anchor.position.set(0, 44, 0); anchor.rotation.z = Math.PI; g.add(anchor);
        houses.push({ x, z, y, r: 26, h: 46 });
      }
    };
    addHouse("pineapple", -220, 40); addHouse("tiki", -170, 46); addHouse("rock", -120, 50);
    addHouse("diner", 160, -140);
    for (let i = 0; i < 30; i++) { const a = r() * TAU, d = 500 + r() * 1700; addHouse(["rock", "tiki", "pineapple", "rock"][i % 4], Math.cos(a) * d, Math.sin(a) * d); }
    // sandy roads with boundary stones
    const roadM = std(0xc9b88a, 0.95);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.4, pts = [];
      for (let i = -10; i <= 10; i++) pts.push(V3(S0.x + Math.cos(a) * i * 140 + Math.sin(i * 0.6) * 40, 0, S0.z + Math.sin(a) * i * 140));
      groundRibbon(grp, pts, 22, roadM, 0.4).position.set(-S0.x, 0, -S0.z); // ribbon is in world coordinates
    }
    // coral, kelp, colourful rocks
    const coralG = U().merge([0, 1, 2, 3, 4].map((i) => { const g = new THREE.CylinderGeometry(0.25, 0.45, 2 + i * 0.4, 6); g.translate(0, 1, 0); g.rotateZ((i - 2) * 0.35); g.rotateY(i * 1.3); return g; }));
    const nC = 900, coral = new THREE.InstancedMesh(coralG, std(0xffffff, 0.6), nC), cc = new THREE.Color();
    const pal = [0xff6f91, 0xffa94d, 0xb197fc, 0x63e6be, 0xffd43b, 0xff8787];
    for (let i = 0; i < nC; i++) { const a = r() * TAU, d = Math.sqrt(r()) * S0.r * 0.9, x = Math.cos(a) * d, z = Math.sin(a) * d; _m4.compose(_p.set(x, floor(S0.x + x, S0.z + z), z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.setScalar(2 + r() * 4)); coral.setMatrixAt(i, _m4); coral.setColorAt(i, cc.setHex(pal[i % pal.length])); }
    grp.add(coral);
    const kelpM = std(0x4c8a3a, 0.8, 0, { side: THREE.DoubleSide });
    kelpM.onBeforeCompile = (sh) => { sh.uniforms.kt = RJ.realms.timeU; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float kt;").replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat sw = position.y / 30.0; transformed.x += sin(kt * 1.3 + position.y * 0.15 + instanceMatrix[3].x * 0.05) * sw * 3.5; transformed.z += cos(kt * 1.1 + instanceMatrix[3].z * 0.05) * sw * 2.0;"); };
    kelpM.customProgramCacheKey = () => "rj-kelp";
    const kelpG = new THREE.PlaneGeometry(1.6, 30, 1, 10); kelpG.translate(0, 15, 0);
    const nK = 1400, kelp = new THREE.InstancedMesh(kelpG, kelpM, nK);
    for (let i = 0; i < nK; i++) { const cxk = Math.cos(i * 0.37) * 1600 * ((i % 7) / 7), czk = Math.sin(i * 0.53) * 1600 * ((i % 5) / 5); const x = cxk + (r() - 0.5) * 260, z = czk + (r() - 0.5) * 260; _m4.compose(_p.set(x, floor(S0.x + x, S0.z + z) - 1, z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.set(1, 0.6 + r() * 1.6, 1)); kelp.setMatrixAt(i, _m4); }
    grp.add(kelp);
    // jellyfish fields (glowing, bobbing) and schools of fish
    const nJ = 140, jelly = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 10, 6, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.8, 1.8), transparent: true, opacity: 0.65, fog: true }), nJ);
    const jd = []; for (let i = 0; i < nJ; i++) jd.push([600 + (r() - 0.5) * 700, -60 + r() * 40, -500 + (r() - 0.5) * 700, r() * TAU]);
    grp.add(jelly);
    const fishG = new THREE.ConeGeometry(0.5, 2.2, 5); fishG.rotateX(Math.PI / 2);
    const nF = 360, fish = new THREE.InstancedMesh(fishG, std(0xffc94d, 0.5, 0.2), nF);
    const fd = []; for (let i = 0; i < nF; i++) fd.push([Math.floor(i / 60), r() * TAU, 20 + r() * 30, (r() - 0.5) * 16]);
    for (let i = 0; i < nF; i++) fish.setColorAt(i, cc.setHex([0xffc94d, 0x74c0fc, 0xff8787, 0x69db7c, 0xffffff, 0xe599f7][fd[i][0] % 6]));
    grp.add(fish);
    // the surface from below, and a ring of marker buoys above showing where to dive
    const under = new THREE.Mesh(new THREE.CircleGeometry(S0.r * 1.05, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.75, 0.8), side: THREE.BackSide, transparent: true, opacity: 0.85, fog: true }));
    under.rotation.x = -Math.PI / 2; under.position.y = -0.4; grp.add(under);
    const buoys = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; put(buoys, new THREE.CylinderGeometry(2, 2.6, 5, 10), Math.cos(a) * S0.r * 0.95, 1.5, Math.sin(a) * S0.r * 0.95); }
    addMerged(grp, buoys, std(0xff5a2a, 0.5));
    const bp = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; bp.push(Math.cos(a) * S0.r * 0.95, 5, Math.sin(a) * S0.r * 0.95); }
    const BL = lamps(grp, bp, 1.2, [4, 1.2, 0.3]);
    const lm = { group: grp, cx: S0.x, cz: S0.z, s: S0, marker: V3(S0.x, 300, S0.z), houses, t: 0, dive: S0 };
    lm.heightAt = (x, z) => { for (const h of houses) { if ((x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r) return h.y + h.h; } return -Infinity; };
    lm.update = (dt, cam) => {
      const d = cull(lm, cam, 9000);
      BL.set(0.6 + nightK());
      if (!grp.visible) return;
      const t = (lm.t += dt);
      for (let i = 0; i < nJ; i++) { const j = jd[i]; _m4.compose(_p.set(j[0] + Math.sin(t * 0.2 + j[3]) * 8, j[1] + Math.sin(t * 0.8 + j[3]) * 3, j[2] + Math.cos(t * 0.15 + j[3]) * 8), _q.identity(), _s.set(1.6, 1.2 + Math.sin(t * 2 + j[3]) * 0.25, 1.6)); jelly.setMatrixAt(i, _m4); }
      jelly.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < nF; i++) {
        const f = fd[i], sc = f[0], cxs = Math.cos(sc * 1.9) * 700, czs = Math.sin(sc * 1.9) * 700, ang = f[1] + t * (0.25 + sc * 0.03), rad = 40 + f[2];
        const x = cxs + Math.cos(ang) * rad, z = czs + Math.sin(ang) * rad, y = -45 + f[3] + Math.sin(t + i) * 1.5;
        _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, -ang, 0)), _s.setScalar(1.6)); fish.setMatrixAt(i, _m4);
      }
      fish.instanceMatrix.needsUpdate = true;
      // bubbles rising from the seabed near the camera when underwater
      if (W().underwater && Math.random() < dt * 12) { const c = cam.position; RJ.fx.smoke(V3(c.x + RJ.rand(-60, 60), c.y - RJ.rand(5, 40), c.z + RJ.rand(-60, 60)), V3(0, 6, 0), 0.6, 1, 5, 0.6); }
    };
    return lm;
  };

  R.timeU = { value: 0 };
  let puff = null;
  R.puffTex = function () {
    if (puff) return puff;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (puff = new THREE.CanvasTexture(c));
  };

  /** Build everything and hand each realm to the atlas. */
  R.build = function (add) {
    const tryB = (id, fn) => { try { const lm = fn(); if (lm) add(id, lm); } catch (e) { console.warn("Realm failed: " + id, e); } };
    tryB("everest", B.everest);
    tryB("citadel", B.citadel);
    tryB("darktower", B.darktower);
    tryB("firemount", B.firemount);
    tryB("elfvale", B.elfvale);
    // the jade realm hosts two discoveries: the Sky Bridge and the monastery
    try {
      const J = B.jade();
      add("skybridge", Object.assign(J, { marker: V3(J.arch.x, G(J.arch.x, J.arch.z) + J.arch.rise + 300, J.arch.z) }));
      add("monastery", { group: null, cx: J.mon.x, cz: J.mon.z, marker: V3(J.mon.x, J.mon.y + J.mon.h + 200, J.mon.z) });
    } catch (e) { console.warn("Realm failed: jade", e); }
    tryB("skyfortress", B.skyfortress);
    tryB("observatory", B.observatory);
    tryB("redwoods", B.redwoods);
    tryB("icefortress", B.icefortress);
    tryB("bikini", B.bikini);
  };
  /** Is (x, z) inside a dive zone (where the sea can be entered)? */
  R.diveAt = function (x, z) { const b = R.S && R.S.bikini; return !!b && (x - b.x) ** 2 + (z - b.z) ** 2 < 3150 * 3150; };
  // the realms join the atlas: discovery, radar markers, the Atlas screen
  if (RJ.atlas && RJ.atlas.DEFS) for (const d of R.DEFS) if (!RJ.atlas.DEFS.some((x) => x.id === d.id)) RJ.atlas.DEFS.push(d);
})(window.RJ);
