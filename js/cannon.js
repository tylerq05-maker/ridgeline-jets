/* Ridgeline Jets — the Grand Cannon: a 1.2 km energy superweapon on a fortified plateau.
 * Registered with the atlas like any landmark (discovery, radar marker, collision, distance culling). It slews
 * its turret and barrel toward a target, charges for several seconds (coils light up breech-to-muzzle, arcs
 * jump from the capacitor towers, the muzzle orb swells, alarms sound), fires a plasma bolt that crosses the
 * sky at 2.6 km/s and lights the ground beneath it, recoils 45 m, then vents and cools. In Free Flight it
 * hunts the player once they come within 24 km (a dodgeable shot with a long warning); in every other mode it
 * only test-fires at its own range, so it never interferes with missions, dogfights or challenges. */
(function (RJ) {
  "use strict";
  const C = (RJ.cannon = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const U = () => RJ.castle.util;
  const _v = V3(), _v2 = V3(), _v3 = V3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();

  C.DEF = { id: "cannon", name: "The Grand Cannon", sub: "A 1.2 km superweapon that tracks anything that flies", icon: "cannon", r: 9000, xp: 600 };
  if (RJ.atlas && RJ.atlas.DEFS && !RJ.atlas.DEFS.some((d) => d.id === "cannon")) RJ.atlas.DEFS.push(C.DEF);

  // dimensions (m)
  const DECK = 92, TRUN = 232, MUZ = 1080, RANGE = 26000, BOLT_V = 2600, CHARGE = 7.5, SEGS = 8;
  C.shake = 0;

  /* ======================= site ======================= */
  /** Pick a broad, gentle plateau 16–34 km from home, clear of every other realm and landmark. */
  C.plan = function (gen, home, sites) {
    let best = null;
    for (let r = 16000; r <= 34000; r += 3000) for (let k = 0; k < 28; k++) {
      const a = (k / 28) * TAU + r * 0.0003, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
      const f = gen.fields(x, z);
      if (f.h < 60 || f.h > 1400 || f.him > 0 || f.nyc > 0 || f.snowZ > 0 || f.ash > 0 || f.wl > -1e8) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 7000 + (s.r || 0))) continue;
      let sl = 0, low = 0;
      for (let j = 0; j < 10; j++) { const b = (j / 10) * TAU; for (const d of [500, 1100]) { const h = gen.height(x + Math.cos(b) * d, z + Math.sin(b) * d); sl = Math.max(sl, Math.abs(h - f.h) / d); if (h < 0) low++; } }
      if (low) continue;
      const sc = sl + Math.abs(r - 24000) / 60000;
      if (!best || sc < best.sc) best = { x, z, h: f.h, sc };
    }
    if (!best) return null;
    // the proving ground: a point 15 km out, facing away from home
    let dx = best.x - home.x, dz = best.z - home.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    best.range = { x: best.x + dx * 15000, z: best.z + dz * 15000 };
    C.site = best;
    sites.push({ type: "plateau", kind: "cannon", x: best.x, z: best.z, r: 560, fall: 750, elev: best.h });
    return best;
  };

  /* ======================= materials ======================= */
  /** Riveted armour plating in object space: staggered plates, seams, rivet rows, per-plate tone and grime. */
  function plated(mat, pw, ph) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec3 vON;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOP = position; vON = normal;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec3 vON;\nfloat cnH(vec2 p){ p = mod(p, 997.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }")
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "vec3 an = abs(normalize(vON)); vec2 pc = (an.x > an.y && an.x > an.z) ? vOP.zy : (an.y > an.z ? vOP.xz : vOP.xy);",
          `vec2 cl = pc / vec2(${pw.toFixed(1)}, ${ph.toFixed(1)}); cl.x += floor(cl.y) * 0.5; vec2 fq = fract(cl), pid = floor(cl);`,
          `float ed = min(min(fq.x, 1.0 - fq.x) * ${pw.toFixed(1)}, min(fq.y, 1.0 - fq.y) * ${ph.toFixed(1)});`,
          "float fw = length(fwidth(pc)); float far = 1.0 - smoothstep(0.35, 1.6, fw);",
          "float seam = (1.0 - smoothstep(0.1, 0.1 + max(0.25, fw * 1.5), ed)) * far;",
          "float rv = step(ed, 0.7) * (1.0 - smoothstep(0.1, 0.22, length(fract(pc * 1.25) - 0.5))) * far;",
          "float grime = 1.0 - 0.12 * smoothstep(0.55, 1.0, fract(pc.y * 0.02 + cnH(vec2(floor(pc.x * 0.25), 3.0))));",
          "diffuseColor.rgb *= (0.97 + 0.05 * cnH(pid)) * grime * (1.0 - seam * 0.55) * (1.0 + rv * 0.3);"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.95 + 0.1 * cnH(pid + 7.0)) + seam * 0.2, 0.15, 1.0);");
    };
    // three.js caches programs by the onBeforeCompile source, which is identical for every plate size
    mat.customProgramCacheKey = () => "rjPlated" + pw + "x" + ph;
    return mat;
  }
  const std = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const glowMat = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: true, fog: false });
  let puff = null;
  function puffTex() {
    if (puff) return puff;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.15, "rgba(220,240,255,0.85)"); gr.addColorStop(0.45, "rgba(120,190,255,0.25)"); gr.addColorStop(1, "rgba(80,150,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (puff = new THREE.CanvasTexture(c));
  }
  const sprite = (scale, col) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(scale); s.layers.set(RJ.LATE); return s;
  };

  /* ======================= geometry ======================= */
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n = 24) => new THREE.CylinderGeometry(rt, rb, h, n);
  /** add geo to list after a full transform (position, Euler rotation) */
  function at(list, geo, x, y, z, rx = 0, ry = 0, rz = 0) {
    _m4.makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z); geo.applyMatrix4(_m4); list.push(geo); return geo;
  }
  /** a cylinder lying along +Z */
  const zcyl = (list, r0, r1, z0, z1, n = 32, x = 0, y = 0) => at(list, cyl(r1, r0, z1 - z0, n), x, y, (z0 + z1) / 2, Math.PI / 2);
  function mesh(grp, list, mat, cast = true) {
    if (!list.length) return null;
    // casts onto the terrain, but no self-shadowing: one shared sun shadow map is far too coarse for a kilometre-
    // scale structure and turns its faces into blocky acne
    const m = new THREE.Mesh(U().merge(list), mat); m.castShadow = cast; m.receiveShadow = false; grp.add(m); return m;
  }

  C.build = function () {
    const S = C.site; if (!S) return null;
    const W = RJ.world, grp = new THREE.Group();
    grp.position.set(S.x, S.h, S.z);
    const M = {
      concrete: plated(std(0x6f6d68, 0.95, 0), 60, 22),
      armor: plated(std(0x30353b, 0.55, 0.45), 36, 16),
      steel: plated(std(0x1d2024, 0.55, 0.8), 9, 5),
      copper: std(0xb06a38, 0.38, 0.9),
      paint: std(0x8c1d18, 0.6, 0.2),
      hazard: std(0xd8a21c, 0.55, 0.1),
      glass: std(0x14202a, 0.08, 0.9)
    };
    /* ---- foundation: a stepped octagonal bastion with buttresses, bunkers and roads ---- */
    const CO = [], AR = [], ST = [], CU = [], PA = [], HZ = [], GL = [], lampPts = [];
    at(CO, cyl(410, 440, 130, 8), 0, -25, 0, 0, Math.PI / 8);
    at(CO, cyl(330, 360, 52, 8), 0, 66, 0, 0, Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, c = Math.cos(a), s = Math.sin(a);
      at(CO, box(46, 92, 150), c * 395, 20, s * 395, 0, -a + Math.PI / 2);                 // buttress
      at(CO, box(46, 50, 60), c * 470, -10, s * 470, 0.0, -a + Math.PI / 2);
      at(HZ, box(30, 2, 152), c * 395, 67, s * 395, 0, -a + Math.PI / 2);                  // hazard cap
      // bunkers and hangars ringing the base (scale reference: about the size of an airliner hangar)
      const b = a + TAU / 16, bc = Math.cos(b), bs = Math.sin(b);
      at(CO, box(70, 22, 46), bc * 560, 0, bs * 560, 0, -b);
      at(ST, box(52, 14, 3), bc * 583, 6, bs * 583, 0, -b);
      lampPts.push(bc * 560, 14, bs * 560);
    }
    at(ST, new THREE.TorusGeometry(262, 7, 8, 96), 0, DECK + 1, 0, Math.PI / 2);          // slewing rail
    at(HZ, new THREE.TorusGeometry(290, 3, 6, 96), 0, DECK - 1, 0, Math.PI / 2);
    // service roads radiating out, and a ramp up the bastion
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.3; at(ST, box(24, 1.2, 900), Math.cos(a) * 900, 1.5, Math.sin(a) * 900, 0, -a + Math.PI / 2); }
    at(CO, box(36, 6, 260), 0, 30, -520, -0.32, 0);
    /* ---- capacitor towers: four lattice pylons with copper coils and glowing crowns ---- */
    const towers = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4, x = Math.cos(a) * 380, z = Math.sin(a) * 380;
      at(ST, cyl(10, 22, 270, 6), x, 92 + 135, z);
      for (let k = 0; k < 9; k++) at(CU, new THREE.TorusGeometry(24 - k * 1.2, 3, 6, 18), x, 120 + k * 22, z, Math.PI / 2);
      for (let k = 0; k < 4; k++) { const b = (k / 4) * TAU; at(ST, cyl(2, 2, 280, 4), x + Math.cos(b) * 26, 92 + 140, z + Math.sin(b) * 26, Math.cos(b) * 0.06, 0, -Math.sin(b) * 0.06); }
      towers.push(V3(x, 92 + 290, z));
      lampPts.push(x, 92 + 300, z);
    }
    mesh(grp, CO, M.concrete); mesh(grp, HZ, M.hazard, false); mesh(grp, ST, M.steel); mesh(grp, CU, M.copper);
    const towerGlow = glowMat(0x000000);
    const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(16, 16, 10), towerGlow, 4);
    towers.forEach((p, i) => { _m4.makeTranslation(p.x, p.y, p.z); crowns.setMatrixAt(i, _m4); });
    grp.add(crowns);

    /* ---- turret (slews on the rail) ---- */
    const yawG = new THREE.Group(); yawG.position.y = DECK; grp.add(yawG);
    const TA = [], TS = [], TC = [], TP = [], TH = [];
    at(TA, cyl(250, 255, 26, 48), 0, 13, 0);                                              // turntable
    for (const sx of [-1, 1]) {
      // armoured hull halves either side of the breech well: sloped glacis, side skirts, rear bustle
      at(TA, box(110, 120, 330), sx * 125, 26 + 60, 0);
      at(TA, box(110, 70, 120), sx * 125, 26 + 70, 190, -0.62, 0);
      at(TA, box(110, 90, 110), sx * 125, 26 + 45, -205, 0.3, 0);
      at(TA, box(14, 90, 360), sx * 186, 26 + 48, 0, 0, 0, sx * 0.12);
      // trunnion towers carrying the elevation bearings
      at(TA, box(60, 150, 120), sx * 125, 146 + 75, 0);
      at(TA, box(60, 40, 90), sx * 125, 146 + 150 + 20, 0, 0, 0, 0);
      at(TS, cyl(52, 52, 64, 32), sx * 105, TRUN, 0, 0, 0, Math.PI / 2);                   // bearing housing
      at(TC, cyl(56, 56, 10, 32), sx * 140, TRUN, 0, 0, 0, Math.PI / 2);
      for (let k = 0; k < 5; k++) at(TS, box(8, 140, 8), sx * 157, 146 + 70, -48 + k * 24); // stiffeners
      // capacitor banks on the hull roof
      for (let k = 0; k < 6; k++) for (let j = 0; j < 2; j++) {
        const x = sx * (95 + j * 50), z = -140 + k * 28;
        at(TS, cyl(9, 9, 26, 10), x, 146 + 13, z); at(TC, cyl(10, 10, 3, 10), x, 146 + 22, z);
      }
      at(TP, box(112, 6, 30), sx * 125, 146 + 1, 150);                                     // red bands
      lampPts.push(sx * 125, 146 + 152 + 26, 0);
    }
    at(TA, box(140, 40, 330), 0, 26 + 20, 0);                                              // well floor
    // radar mast at the rear
    at(TS, cyl(6, 9, 120, 8), 0, 26 + 60 + 60, -250);
    mesh(yawG, TA, M.armor); mesh(yawG, TS, M.steel); mesh(yawG, TC, M.copper); mesh(yawG, TP, M.paint, false);
    const radar = new THREE.Group(); radar.position.set(0, 26 + 180, -250); yawG.add(radar);
    { const R = []; at(R, new THREE.SphereGeometry(34, 20, 8, 0, TAU, 0, 1.1), 0, 0, 0, Math.PI / 2 - 0.3); at(R, box(8, 8, 40), 0, 0, 14); mesh(radar, R, M.steel); }
    // elevation rams (rebuilt each frame between the hull and the cradle)
    const ramMat = M.steel, rodMat = std(0xc8ccd0, 0.18, 1.0);
    const rams = [-1, 1].map((sx) => {
      const body = new THREE.Mesh(cyl(16, 16, 1, 16), ramMat), rod = new THREE.Mesh(cyl(9, 9, 1, 12), rodMat);
      body.castShadow = rod.castShadow = true; yawG.add(body, rod);
      return { sx, body, rod, base: V3(sx * 80, 60, 150) };
    });

    /* ---- barrel: cradle (pivots) and a recoiling barrel inside it ---- */
    const pivot = new THREE.Group(); pivot.position.y = TRUN; yawG.add(pivot);
    const BA = [], BS = [], BC = [];
    zcyl(BA, 66, 66, -40, 330, 40);                                                        // cradle sleeve
    at(BA, box(150, 60, 300), 0, -60, 140);                                                // cradle keel
    for (const sx of [-1, 1]) { zcyl(BS, 20, 20, -20, 300, 16, sx * 70, 40); zcyl(BS, 20, 20, -20, 300, 16, sx * 70, -40); }  // recoil buffers
    at(BS, cyl(150, 150, 30, 32), 0, 0, 0, 0, 0, Math.PI / 2);                             // trunnion axle
    mesh(pivot, BA, M.armor); mesh(pivot, BS, M.steel);
    const recoil = new THREE.Group(); pivot.add(recoil);
    const RA = [], RS = [], RC = [];
    at(RA, box(140, 140, 220), 0, 0, -130);                                                // breech block
    at(RS, box(150, 30, 60), 0, 85, -180); at(RS, box(150, 30, 60), 0, -85, -180);
    for (let k = 0; k < 6; k++) zcyl(RS, 76, 76, -238 + k * 34, -228 + k * 34, 32);       // breech rings
    // the tube: tapering, with reinforcing bands, a finned cooling jacket and three accelerator rails
    zcyl(RA, 50, 34, 330, MUZ - 70, 48);
    for (let z = 360; z < MUZ - 80; z += 64) { const r = 50 - (z - 330) / (MUZ - 400) * 16; zcyl(RS, r + 5, r + 5, z, z + 9, 40); }
    for (let z = 336; z < 520; z += 11) zcyl(RC, 63, 63, z, z + 3, 40);                    // cooling fins
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2; at(RS, box(12, 12, MUZ - 420), Math.cos(a) * 46, Math.sin(a) * 46, (330 + MUZ - 90) / 2, 0, 0, a); }
    // muzzle brake: a heavy slotted block with baffles
    zcyl(RA, 58, 58, MUZ - 70, MUZ - 40, 32);
    for (let k = 0; k < 3; k++) { at(RA, box(150, 26, 18), 0, 46, MUZ - 30 + k * 36); at(RA, box(150, 26, 18), 0, -46, MUZ - 30 + k * 36); at(RA, box(26, 70, 18), 66, 0, MUZ - 30 + k * 36); at(RA, box(26, 70, 18), -66, 0, MUZ - 30 + k * 36); }
    at(RA, box(150, 18, 110), 0, 62, MUZ + 6); at(RA, box(150, 18, 110), 0, -62, MUZ + 6);
    at(RS, box(10, 10, 14), 0, 74, MUZ + 52);
    mesh(recoil, RA, M.armor); mesh(recoil, RS, M.steel); mesh(recoil, RC, M.copper);
    // glowing parts: per-segment materials so the charge can climb the barrel
    const segMats = [];
    for (let s = 0; s < SEGS; s++) {
      const z0 = 360 + s * (MUZ - 460) / SEGS, z1 = z0 + (MUZ - 460) / SEGS, L = [], r = 50 - (z0 - 330) / (MUZ - 400) * 16;
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2 + Math.PI / 3; at(L, box(5, 5, z1 - z0 - 6), Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), (z0 + z1) / 2, 0, 0, a); }
      at(L, new THREE.TorusGeometry(r + 9, 3.2, 8, 40), 0, 0, (z0 + z1) / 2);
      const mt = glowMat(0x000000); segMats.push(mt); mesh(recoil, L, mt, false);
    }
    // the reactor core in the breech, seen through slots
    const coreMat = glowMat(0x000000); { const L = []; for (let k = 0; k < 4; k++) at(L, box(144, 8, 14), 0, 30 - k * 20, -60); zcyl(L, 30, 30, -250, -238, 24); mesh(recoil, L, coreMat, false); }
    // spinning accelerator collars
    const collars = [];
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Group(); c.position.z = 560 + k * 130; recoil.add(c);
      const L = []; at(L, new THREE.TorusGeometry(62, 6, 6, 24), 0, 0, 0); for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; at(L, box(6, 14, 10), Math.cos(a) * 56, Math.sin(a) * 56, 0, 0, 0, a); }
      mesh(c, L, M.steel); collars.push(c);
    }
    // muzzle charge orb and flash
    const orb = sprite(1, 0xbfe4ff); orb.position.z = MUZ + 40; recoil.add(orb);
    const flash = sprite(1, 0xffffff); flash.position.z = MUZ + 120; recoil.add(flash); flash.layers.enable(W.BACK);
    // aircraft-warning beacons and floodlights
    const lampMat = glowMat(0x000000);
    const lampIM = new THREE.InstancedMesh(new THREE.SphereGeometry(3.5, 8, 6), lampMat, lampPts.length / 3);
    for (let i = 0; i < lampPts.length / 3; i++) { _m4.makeTranslation(lampPts[i * 3], lampPts[i * 3 + 1], lampPts[i * 3 + 2]); lampIM.setMatrixAt(i, _m4); }
    grp.add(lampIM);
    const beacon = glowMat(0x000000), bL = []; at(bL, new THREE.SphereGeometry(5, 8, 6), 0, 70, MUZ + 20); mesh(recoil, bL, beacon, false);

    /* ---- arcs: camera-facing ribbons from the tower crowns to the breech ---- */
    const ARC_N = 4, ARC_K = 14;
    const arcGeo = new THREE.BufferGeometry(), arcPos = new Float32Array(ARC_N * ARC_K * 6 * 3);
    arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
    const arcMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 3.2, 5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const arcs = new THREE.Mesh(arcGeo, arcMat); arcs.frustumCulled = false; arcs.layers.set(RJ.LATE); grp.add(arcs);

    /* ---- far silhouette (beyond the main camera's 20 km range) ---- */
    const farMat = new THREE.MeshBasicMaterial({ color: 0x2c3036, fog: false });
    const far = new THREE.Group(); far.position.copy(grp.position);
    { const a = new THREE.Mesh(cyl(360, 440, 130, 8), farMat); a.position.y = 30; const t = new THREE.Mesh(box(380, 260, 420), farMat); t.position.y = DECK + 130;
      const fp = new THREE.Group(); fp.position.y = DECK + TRUN; const b = new THREE.Mesh(cyl(40, 60, MUZ + 200, 10), farMat); b.rotation.x = Math.PI / 2; b.position.z = MUZ / 2 - 60; fp.add(b);
      far.add(a, t, fp); far.userData.pivot = fp; }
    far.traverse((o) => o.layers.set(W.BACK)); W.scene.add(far);

    /* ---- lights ---- */
    const light = new THREE.PointLight(0x9fd4ff, 0, 9000, 1.6); W.scene.add(light);

    const lm = {
      group: grp, cx: S.x, cz: S.z, marker: V3(S.x, S.h + 1500, S.z), s: S,
      yawG, pivot, recoil, segMats, coreMat, collars, orb, flash, rams, radar, towers, crowns, towerGlow, arcs, arcPos, arcGeo, ARC_N, ARC_K, lampMat, beacon, far, light,
      yaw: Math.atan2(S.range.x - S.x, S.range.z - S.z), elev: 0.25, yawRate: 0, elevRate: 0,
      state: "idle", t: 0, charge: 0, recoilZ: 0, cool: 0, nextDemo: 12, nextHunt: 6, target: null, aim: V3(), lit: 0,
      bolts: [], plumes: [], warnT: 0, time: 0
    };
    lm.heightAt = (x, z) => { const d = Math.hypot(x - S.x, z - S.z); return d < 330 ? S.h + DECK : d < 410 ? S.h + 40 : -Infinity; };
    lm.solidAt = (p) => solidAt(lm, p);
    lm.update = (dt, cam) => update(lm, dt, cam);
    C.lm = lm;
    return lm;
  };

  /* ======================= collision ======================= */
  function solidAt(lm, p) {
    const S = lm.s, dx = p.x - S.x, dz = p.z - S.z, y = p.y - S.h;
    if (dx * dx + dz * dz > 1300 * 1300 || y > 1300) return false;
    if (Math.hypot(dx, dz) < 300 && y < DECK + 150) return true;           // bastion + hull
    // the barrel as a capsule from the breech to the muzzle
    const a = lm.pivot.getWorldPosition(_v), d = _v2.set(0, 0, 1).applyQuaternion(lm.pivot.getWorldQuaternion(_q));
    const t = RJ.clamp(_v3.copy(p).sub(a).dot(d), -260, MUZ + 60);
    return _v3.copy(a).addScaledVector(d, t).distanceTo(p) < 72;
  }

  /* ======================= targeting ======================= */
  function huntable(pl) {
    const md = RJ.game && RJ.game.mode;
    return md && md.kind === "free" && !(RJ.mp && RJ.mp.room) && pl && pl.alive && pl.state === "flying";
  }
  function muzzleWorld(lm, out) { return lm.recoil.localToWorld(out.set(0, 0, MUZ + 30)); }
  function boreDir(lm, out) { return out.set(0, 0, 1).applyQuaternion(lm.pivot.getWorldQuaternion(_q)); }
  /** Solve the lead: where the target will be when a bolt fired now arrives. */
  function leadPoint(lm, tgt, out) {
    const o = lm.pivot.getWorldPosition(_v2);
    out.copy(tgt.pos);
    for (let i = 0; i < 3; i++) { const t = out.distanceTo(o) / BOLT_V; out.copy(tgt.pos).addScaledVector(tgt.vel, t); }
    return out;
  }

  /* ======================= per-frame ======================= */
  function update(lm, dt, cam) {
    const S = lm.s, W = RJ.world;
    lm.time += dt;
    const camD = Math.hypot(cam.position.x - S.x, cam.position.z - S.z);
    lm.dist = camD;
    lm.group.visible = camD < 21000;
    lm.far.visible = camD > 18500;
    if (lm.far.visible) lm.far.children[0].material.color.set(0x2c3036).lerp(W.scene.fog.color, RJ.clamp((camD - 18000) / 90000, 0, 0.75));
    const pl = RJ.game && RJ.game.mode && RJ.game.mode.player;
    const active = camD < 40000 || lm.bolts.length || lm.state !== "idle";

    // ---- choose what to do ----
    if (lm.state === "idle" && active) {
      lm.nextDemo -= dt; lm.nextHunt -= dt;
      const pd = pl ? Math.hypot(pl.pos.x - S.x, pl.pos.z - S.z) : 1e9;
      if (huntable(pl) && pd < RANGE - 2000 && lm.nextHunt <= 0) { lm.target = pl; lm.state = "track"; lm.t = 0; }
      else if (lm.nextDemo <= 0 && camD < 38000) {
        // test shot: alternately into the proving ground and an airburst high over it
        const R = S.range, sky = Math.random() < 0.5;
        lm.target = { pos: V3(R.x + RJ.rand(-2000, 2000), sky ? S.h + RJ.rand(4500, 7500) : G(R.x, R.z) + 5, R.z + RJ.rand(-2000, 2000)), vel: V3(), alive: true, demo: true, sky };
        lm.state = "track"; lm.t = 0;
      }
    }
    // ---- aim ----
    if (lm.target && (lm.state === "track" || lm.state === "charge")) {
      if (!lm.target.demo && !huntable(lm.target)) { abort(lm); }
      else {
        leadPoint(lm, lm.target, lm.aim);
        const o = lm.pivot.getWorldPosition(_v2), dx = lm.aim.x - o.x, dy = lm.aim.y - o.y, dz = lm.aim.z - o.z;
        const wantY = Math.atan2(dx, dz), wantE = RJ.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.12, 1.3);
        const dY = Math.atan2(Math.sin(wantY - lm.yaw), Math.cos(wantY - lm.yaw));
        lm.yawRate = RJ.damp(lm.yawRate, RJ.clamp(dY * 1.4, -0.2, 0.2), 2.5, dt);
        lm.elevRate = RJ.damp(lm.elevRate, RJ.clamp((wantE - lm.elev) * 1.4, -0.12, 0.12), 2.5, dt);
        lm.err = Math.abs(dY) + Math.abs(wantE - lm.elev);
      }
    } else { lm.yawRate = RJ.damp(lm.yawRate, 0, 3, dt); lm.elevRate = RJ.damp(lm.elevRate, 0, 3, dt); }
    lm.yaw += lm.yawRate * dt; lm.elev = RJ.clamp(lm.elev + lm.elevRate * dt, -0.12, 1.3);

    // ---- state machine ----
    lm.t += dt;
    if (lm.state === "track" && lm.t > 1.2 && lm.err < 0.35) {
      lm.state = "charge"; lm.t = 0; C.sfx.charge(lm, cam);
      if (lm.target === pl) { RJ.ui.flash("GRAND CANNON — TARGET LOCK", "It's charging. Break hard and keep turning", 3.2, true); lm.warnT = 0; }
    } else if (lm.state === "track" && lm.t > 14) abort(lm);
    if (lm.state === "charge") {
      lm.charge = Math.min(1, lm.t / CHARGE);
      if (lm.target === pl) { lm.warnT -= dt; if (lm.warnT <= 0) { lm.warnT = 0.55 - lm.charge * 0.35; C.sfx.lockBeep(lm.charge); } }
      if (lm.t >= CHARGE) fire(lm, cam, pl);
    }
    if (lm.state === "cool") {
      lm.charge = Math.max(0, lm.charge - dt * 0.5);
      if (lm.t > 9) { lm.state = "idle"; lm.target = null; lm.nextDemo = RJ.rand(22, 40); }
      // venting: steam from the breech and the roof banks
      if (lm.group.visible && Math.random() < dt * 14 * Math.max(0, 1 - lm.t / 9)) {
        const p = lm.recoil.localToWorld(_v.set(RJ.rand(-60, 60), 80, RJ.rand(-200, 300)));
        RJ.fx.smokeP.spawn(p.x, p.y, p.z, RJ.rand(-4, 4), 18 + Math.random() * 14, RJ.rand(-4, 4), 5 + Math.random() * 4, 20, 90, 0.88, 0.9, 0.93, 0.5, 0, 0.4);
      }
    }
    // ---- mechanics ----
    lm.recoilZ = RJ.damp(lm.recoilZ, 0, lm.state === "cool" && lm.t < 0.15 ? 0 : 0.9, dt);
    lm.yawG.rotation.y = lm.yaw + (C.shake > 0.05 && camD < 21000 ? (Math.random() - 0.5) * 0.0015 * C.shake : 0);
    lm.pivot.rotation.x = -lm.elev;
    lm.recoil.position.z = lm.recoilZ;
    lm.far.userData.pivot.rotation.set(-lm.elev, 0, 0); lm.far.rotation.y = lm.yaw;
    lm.radar.rotation.y += dt * 0.9;
    for (let i = 0; i < lm.collars.length; i++) lm.collars[i].rotation.z += dt * (0.2 + lm.charge * 9) * (i % 2 ? -1 : 1);
    if (lm.group.visible) {
      for (const r of lm.rams) {
        const top = lm.yawG.worldToLocal(lm.pivot.localToWorld(_v.set(r.sx * 80, -50, 230)));
        const len = top.distanceTo(r.base), mid = _v2.copy(r.base).add(top).multiplyScalar(0.5);
        _q.setFromUnitVectors(_v3.set(0, 1, 0), top.clone().sub(r.base).normalize());
        r.body.position.copy(r.base).lerp(top, 0.3); r.body.quaternion.copy(_q); r.body.scale.set(1, len * 0.6, 1);
        r.rod.position.copy(mid).lerp(top, 0.35); r.rod.quaternion.copy(_q); r.rod.scale.set(1, len * 0.55, 1);
      }
    }
    // ---- glow: the charge climbs the barrel; idle coils breathe faintly ----
    const ch = lm.charge, idle = 0.12 + 0.06 * Math.sin(lm.time * 1.7);
    for (let s = 0; s < SEGS; s++) {
      const k = Math.max(idle * (lm.state === "idle" ? 1 : 0.5), RJ.smooth(s / SEGS * 0.75, s / SEGS * 0.75 + 0.25, ch)) * (0.85 + Math.random() * 0.15 * ch);
      lm.segMats[s].color.setRGB(0.5 * k * 2.2, 1.1 * k * 2.2, 2.4 * k * 2.2);
    }
    const ck = Math.max(0.35, ch * 3);
    lm.coreMat.color.setRGB(0.6 * ck, 1.3 * ck, 2.6 * ck);
    lm.towerGlow.color.setRGB(0.4 + ch * 2, 0.8 + ch * 3, 1.6 + ch * 5);
    const night = RJ.clamp(1 - RJ.smooth(-3, 10, W.sunElev), 0, 1);
    lm.lampMat.color.setRGB(1.6, 1.3, 0.9).multiplyScalar(0.25 + night * 1.5);
    const blink = (lm.time % 1.6) < 0.18 ? 1 : 0;
    lm.beacon.color.setRGB(4 * blink + 0.2, 0.15 * blink, 0.1 * blink);
    lm.orb.scale.setScalar(ch > 0 && lm.state === "charge" ? 30 + ch * ch * 260 * (0.9 + Math.random() * 0.2) : 0.001);
    lm.orb.material.opacity = Math.min(1, ch * 1.5);
    lm.lit = Math.max(0, lm.lit - dt * 2.5);
    lm.flash.scale.setScalar(lm.lit > 0 ? 400 + (1 - lm.lit) * 1400 : 0.001);
    lm.flash.material.opacity = Math.min(1, lm.lit * 1.4);
    // charge light at the muzzle, the firing flash, then the light rides with the bolt
    const b0 = lm.bolts[0];
    if (b0 && b0.alive) { lm.light.position.copy(b0.pos); lm.light.intensity = 9; lm.light.color.setRGB(0.65, 0.85, 1); }
    else if (b0 && b0.boomT > 0) { lm.light.position.copy(b0.pos); lm.light.intensity = 14 * b0.boomT; lm.light.color.setRGB(1, 0.7, 0.4); }
    else { muzzleWorld(lm, lm.light.position); lm.light.intensity = ch * ch * 7 * (lm.state === "charge" ? 1 : 0) + lm.lit * 30; lm.light.color.setRGB(0.65, 0.85, 1); }
    // charging: arcs, dust devils at the base, a deepening hum
    updateArcs(lm, cam, lm.state === "charge" ? ch : 0);
    if (lm.state === "charge" && ch > 0.6 && lm.group.visible && Math.random() < dt * 6) {
      const a = Math.random() * TAU; RJ.fx.dust(_v.set(S.x + Math.cos(a) * 470, S.h + 2, S.z + Math.sin(a) * 470), 1.5);
    }
    C.sfx.update(lm, cam, dt);
    updateBolts(lm, dt, cam, pl);
    updatePlumes(lm, dt);
    C.shake = Math.max(0, C.shake - dt * 1.6);
  }
  function abort(lm) { lm.state = "idle"; lm.target = null; lm.charge = 0; lm.nextHunt = 8; C.sfx.stopCharge(); }

  function updateArcs(lm, cam, k) {
    const P = lm.arcPos;
    if (k < 0.3 || !lm.group.visible) { lm.arcs.visible = false; return; }
    lm.arcs.visible = true;
    const core = lm.recoil.localToWorld(_v.set(0, 60, -120)), inv = lm.group.worldToLocal(core.clone());
    let o = 0;
    for (let i = 0; i < lm.ARC_N; i++) {
      const on = Math.random() < 0.35 + k * 0.6;
      const a = lm.towers[i], b = inv;
      let px = a.x, py = a.y, pz = a.z;
      const vx = cam.position.x - lm.s.x - a.x, vy = cam.position.y - lm.s.h - a.y, vz = cam.position.z - lm.s.z - a.z;
      for (let j = 1; j <= lm.ARC_K; j++) {
        const t = j / lm.ARC_K, jit = Math.sin(t * Math.PI) * 45 * (j < lm.ARC_K ? 1 : 0);
        const nx = a.x + (b.x - a.x) * t + RJ.rand(-jit, jit), ny = a.y + (b.y - a.y) * t + RJ.rand(-jit, jit) + Math.sin(t * Math.PI) * 60, nz = a.z + (b.z - a.z) * t + RJ.rand(-jit, jit);
        // ribbon width perpendicular to both the segment and the view
        let sx = (ny - py) * vz - (nz - pz) * vy, sy = (nz - pz) * vx - (nx - px) * vz, sz = (nx - px) * vy - (ny - py) * vx;
        const sl = Math.hypot(sx, sy, sz) || 1, w = on ? 2.5 + k * 3 : 0; sx *= w / sl; sy *= w / sl; sz *= w / sl;
        const q = [px - sx, py - sy, pz - sz, px + sx, py + sy, pz + sz, nx + sx, ny + sy, nz + sz, px - sx, py - sy, pz - sz, nx + sx, ny + sy, nz + sz, nx - sx, ny - sy, nz - sz];
        for (let m = 0; m < 18; m++) P[o++] = q[m];
        px = nx; py = ny; pz = nz;
      }
    }
    lm.arcGeo.attributes.position.needsUpdate = true;
    lm.arcs.material.opacity = 0.6 + Math.random() * 0.4;
  }

  /* ======================= firing ======================= */
  function fire(lm, cam, pl) {
    const m = muzzleWorld(lm, V3()), dir = boreDir(lm, V3());
    lm.state = "cool"; lm.t = 0; lm.charge = 0.6; lm.recoilZ = -46; lm.lit = 1;
    if (lm.target !== pl) lm.nextDemo = RJ.rand(26, 44);
    lm.nextHunt = RJ.rand(16, 24);
    const camD = cam.position.distanceTo(m);
    // muzzle blast: fireball, a ring of smoke blown out from the brake, a forward jet of sparks, vapour cone
    if (camD < 30000) {
      RJ.fx.explosion(_v.copy(m).addScaledVector(dir, 60), 9);
      const side = _v2.set(0, 1, 0).cross(dir).normalize(), up = _v3.copy(dir).cross(side).normalize();
      for (let i = 0; i < 70; i++) {
        const a = (i / 70) * TAU, sp = 90 + Math.random() * 60;
        const vx = (side.x * Math.cos(a) + up.x * Math.sin(a)) * sp + dir.x * 40, vy = (side.y * Math.cos(a) + up.y * Math.sin(a)) * sp + dir.y * 40, vz = (side.z * Math.cos(a) + up.z * Math.sin(a)) * sp + dir.z * 40;
        RJ.fx.smokeP.spawn(m.x, m.y, m.z, vx, vy, vz, 10 + Math.random() * 8, 40, 190, 0.62, 0.63, 0.66, 0.75, 0, 0.55);
      }
      for (let i = 0; i < 120; i++) { const sp = 300 + Math.random() * 700; RJ.fx.fireP.spawn(m.x, m.y, m.z, dir.x * sp + RJ.rand(-120, 120), dir.y * sp + RJ.rand(-120, 120), dir.z * sp + RJ.rand(-120, 120), 0.5 + Math.random() * 0.8, 4, 1, 0.7, 0.85, 1, 1, -9.8, 0.2); }
      for (let i = 0; i < 26; i++) { const p = _v.copy(m).addScaledVector(dir, 40 + i * 14); RJ.fx.vapor(p, dir.clone().multiplyScalar(140), 50 + i * 4, 0.45); }
      // ground blast under the bastion
      RJ.fx.dustRing(_v.set(lm.s.x, lm.s.h + 3, lm.s.z), 1, V3());
      RJ.fx.dustRing(_v.set(lm.s.x + dir.x * 300, G(lm.s.x + dir.x * 300, lm.s.z + dir.z * 300) + 3, lm.s.z + dir.z * 300), 1, V3());
    }
    // the visible pressure wave (screen-space refraction ring) and screen flash for anyone close enough
    if (RJ.sonic && RJ.sonic.shocks) { RJ.sonic.shocks.push({ pos: m.clone(), t: 0, R0: 220, vis: 1 }); if (RJ.sonic.shocks.length > 3) RJ.sonic.shocks.shift(); }
    const vis = camD < 22000 && _v.copy(m).sub(cam.position).normalize().dot(_v2.set(0, 0, -1).applyQuaternion(cam.quaternion)) > 0.2;
    if (vis && RJ.post && RJ.post.fx) { RJ.post.fx.flash = Math.max(RJ.post.fx.flash, 0.55 * (1 - camD / 22000)); RJ.post.fx.flashCol = [0.85, 0.93, 1.0]; }
    C.shake = Math.max(C.shake, RJ.clamp(1.6 - camD / 9000, 0, 1.6));
    C.sfx.fire(m, cam);
    // the bolt
    lm.bolts.push(makeBolt(lm, m, dir));
    // a cinematic inset (picture-in-picture) from beside the barrel; the player keeps full control
    if (RJ.pipShot && camD < 26000) {
      const b = lm.bolts[lm.bolts.length - 1], sideS = Math.random() < 0.5 ? -1 : 1;
      RJ.pipShot((pc, k) => {
        const mz = muzzleWorld(lm, _v3.set(0, 0, 0)), d = boreDir(lm, V3()), side = V3(0, 1, 0).cross(d).normalize();
        if (k < 0.45) { pc.position.copy(mz).addScaledVector(d, -700 + k * 300).addScaledVector(side, sideS * 520).y += 160; pc.lookAt(mz.addScaledVector(d, 200 + k * 2000)); }
        else { pc.position.copy(b.pos).addScaledVector(b.dir, -900).addScaledVector(side, sideS * 160).y += 60; pc.lookAt(b.pos); }
      }, 5.2);
    }
  }
  function makeBolt(lm, m, dir) {
    const W = RJ.world, g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 220, 10, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 4, 6), fog: false }));
    core.rotation.x = Math.PI / 2; core.layers.set(RJ.LATE);
    const halo = sprite(260, 0x9fd0ff), halo2 = sprite(700, 0x5aa0ff); halo2.material.opacity = 0.5;
    halo.layers.enable(W.BACK); halo2.layers.enable(W.BACK);
    g.add(core, halo, halo2);
    // ion trail: a long fading ribbon from the muzzle to the bolt
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.0, 1.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    trail.layers.set(RJ.LATE);
    W.scene.add(g, trail);
    g.position.copy(m); g.quaternion.setFromUnitVectors(V3(0, 0, 1), dir);
    return { g, trail, pos: m.clone(), start: m.clone(), dir: dir.clone(), alive: true, life: 0, trailK: 1, boomT: 0, target: lm.target, nearMiss: false };
  }
  function updateBolts(lm, dt, cam, pl) {
    const W = RJ.world;
    for (let i = lm.bolts.length - 1; i >= 0; i--) {
      const b = lm.bolts[i];
      if (b.alive) {
        b.life += dt;
        const prev = _v.copy(b.pos), step = BOLT_V * dt;
        b.pos.addScaledVector(b.dir, step);
        b.g.position.copy(b.pos);
        // sparks shed along the path
        if (b.pos.distanceTo(cam.position) < 15000) for (let k = 0; k < 4; k++) { const p = _v2.copy(prev).addScaledVector(b.dir, step * Math.random()); RJ.fx.fireP.spawn(p.x, p.y, p.z, RJ.rand(-30, 30), RJ.rand(-30, 30), RJ.rand(-30, 30), 0.4 + Math.random() * 0.6, 14, 2, 0.6, 0.85, 1, 0.9, 0, 0.5); }
        // hits: aircraft (only the hunted player in Free Flight), terrain, airburst at the demo point, range
        let hit = null;
        if (b.target && !b.target.demo && b.target.alive) {
          const t = RJ.clamp(_v3.copy(b.target.pos).sub(prev).dot(b.dir), 0, step), cp = _v3.copy(prev).addScaledVector(b.dir, t), d = cp.distanceTo(b.target.pos);
          if (d < 140) hit = { at: cp.clone(), air: true, dist: d };
          else if (d < 600 && !b.nearMiss && b.target === pl) { b.nearMiss = true; C.sfx.whoosh(); C.shake = Math.max(C.shake, 1); }
        }
        if (!hit && b.target && b.target.demo && b.target.sky && b.pos.distanceTo(b.start) >= b.target.pos.distanceTo(b.start)) hit = { at: b.pos.clone(), air: true };
        if (!hit && b.pos.y < W.ground(b.pos.x, b.pos.z) + 4) hit = { at: b.pos.clone(), air: false };
        if (!hit && b.life * BOLT_V > RANGE + 8000) hit = { at: b.pos.clone(), air: true };
        if (hit) impact(lm, b, hit, cam, pl);
      } else {
        b.boomT = Math.max(0, b.boomT - dt * 0.7);
      }
      // the ion trail lingers and fades after the bolt is gone
      b.trailK = b.alive ? 1 : Math.max(0, b.trailK - dt * 0.6);
      const len = b.start.distanceTo(b.pos);
      b.trail.position.copy(b.start).addScaledVector(b.dir, len / 2);
      b.trail.quaternion.setFromUnitVectors(_v.set(0, 1, 0), b.dir);
      b.trail.scale.set(9 + (1 - b.trailK) * 40, Math.max(1, len), 9 + (1 - b.trailK) * 40);
      b.trail.material.opacity = 0.75 * b.trailK * b.trailK;
      if (!b.alive && b.trailK <= 0 && b.boomT <= 0) { W.scene.remove(b.g, b.trail); b.trail.geometry.dispose(); b.trail.material.dispose(); b.g.children[0].geometry.dispose(); lm.bolts.splice(i, 1); }
    }
  }
  function impact(lm, b, hit, cam, pl) {
    b.alive = false; b.g.visible = false; b.pos.copy(hit.at); b.boomT = 1;
    const p = hit.at, d = cam.position.distanceTo(p);
    RJ.fx.explosion(p, 16);
    RJ.fx.explosion(_v.copy(p).add(_v2.set(RJ.rand(-90, 90), 60, RJ.rand(-90, 90))), 10);
    for (let i = 0; i < 60; i++) { const a = Math.random() * TAU, e = Math.random() * 1.4, sp = 120 + Math.random() * 160; RJ.fx.fireP.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 1 + Math.random(), 30, 90, 0.75, 0.85, 1, 0.8, 0, 1.2); }
    if (!hit.air) { RJ.fx.dustRing(p, 1, V3()); RJ.fx.dustRing(_v.copy(p).setY(p.y + 2), 1, V3()); RJ.fx.debris && RJ.fx.debris(p, V3(0, 120, 0), 6); }
    if (RJ.sonic && RJ.sonic.shocks) { RJ.sonic.shocks.push({ pos: p.clone(), t: 0, R0: 300, vis: 1 }); if (RJ.sonic.shocks.length > 3) RJ.sonic.shocks.shift(); }
    // a lingering column of smoke (mushroom on the ground, a ragged ball in the air), an expanding fireball and
    // a visible shock shell racing outward
    lm.plumes.push({ p: p.clone(), t: 0, air: hit.air, fb: blastFx(p) });
    if (RJ.post && RJ.post.fx && d < 20000) { RJ.post.fx.flash = Math.max(RJ.post.fx.flash, 0.4 * (1 - d / 20000)); RJ.post.fx.flashCol = [1, 0.9, 0.75]; }
    C.shake = Math.max(C.shake, RJ.clamp(1.4 - d / 7000, 0, 1.4));
    RJ.audio.explosion(d, 3.5);
    // damage: only the hunted aircraft in Free Flight, falling off with distance from the burst
    const t = b.target;
    if (t && !t.demo && t.alive && huntable(t)) {
      const dd = t.pos.distanceTo(p);
      if (dd < 45) t.damage(t.maxHp * 2, null, "cannon");
      else if (dd < 160) t.damage(t.maxHp * 0.75 * (1 - (dd - 45) / 115), null, "cannon");
    }
  }
  let shellMat = null;
  function blastFx(p) {
    const W = RJ.world;
    if (!shellMat) shellMat = new THREE.ShaderMaterial({
      uniforms: { k: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: "varying float vF; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); vF = 1.0 - abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform float k; varying float vF; void main(){ gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * pow(vF, 3.0) * k, 1.0); }"
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), shellMat.clone()); shell.position.copy(p); shell.layers.set(RJ.LATE);
    const ball = sprite(1, 0xffb070); ball.position.copy(p); ball.layers.enable(W.BACK);
    W.scene.add(shell, ball);
    return { shell, ball };
  }
  function updatePlumes(lm, dt) {
    for (let i = lm.plumes.length - 1; i >= 0; i--) {
      const P = lm.plumes[i]; P.t += dt;
      if (P.fb) {
        const t = P.t, f = P.fb;
        f.shell.scale.setScalar(80 + t * 900); f.shell.material.uniforms.k.value = Math.max(0, 1.6 * (1 - t / 2.2));
        f.ball.scale.setScalar(300 + Math.sqrt(t) * 900); f.ball.material.opacity = Math.max(0, 1 - t / 3) * (0.85 + Math.random() * 0.15);
        f.ball.material.color.setRGB(1, 0.75 - Math.min(0.4, t * 0.15), 0.45 - Math.min(0.35, t * 0.15));
        if (t > 3.2) { RJ.world.scene.remove(f.shell, f.ball); f.shell.geometry.dispose(); f.shell.material.dispose(); f.ball.material.dispose(); P.fb = null; }
      }
      if (P.t > 26) { lm.plumes.splice(i, 1); continue; }
      if (Math.random() > dt * 9) continue;
      const k = P.t / 26, up = P.air ? 6 : 22 * (1 - k * 0.5), h = P.air ? 0 : Math.min(900, P.t * 55);
      const dark = 0.18 + k * 0.25, r = P.air ? 220 : 60 + h * 0.25;
      const a = Math.random() * TAU, rr = Math.random() * r;
      RJ.fx.smokeP.spawn(P.p.x + Math.cos(a) * rr, P.p.y + h * Math.random(), P.p.z + Math.sin(a) * rr, RJ.rand(-6, 6) + 6, up, RJ.rand(-6, 6), 12 + Math.random() * 10, 80, 260, dark, dark * 0.95, dark * 0.92, 0.55 * (1 - k * 0.6), 0, 0.15);
      if (!P.air && P.t < 10 && Math.random() < 0.5) RJ.fx.fireP.spawn(P.p.x + RJ.rand(-60, 60), P.p.y + 10, P.p.z + RJ.rand(-60, 60), 0, 25, 0, 1.2, 40, 70, 1, 0.55, 0.25, 0.8, 0, 0.3);
    }
  }

  /** Screen-space hooks called by main.js after its own post inputs: heat haze over the glowing barrel. */
  C.screenFx = function (P, camera) {
    const lm = C.lm; if (!lm || !lm.group.visible || P.heat.length >= 4) return;
    const k = lm.state === "charge" ? lm.charge : lm.state === "cool" ? Math.max(0, 1 - lm.t / 6) : 0;
    if (k < 0.05) return;
    const m = muzzleWorld(lm, _v), d = m.distanceTo(camera.position), s = m.project(camera);
    if (s.z > 1 || Math.abs(s.x) > 1.2 || Math.abs(s.y) > 1.2) return;
    P.heat.push([(s.x + 1) / 2, (s.y + 1) / 2, RJ.clamp(260 / d, 0.02, 0.3), k * 0.9]);
  };

  /* ======================= audio (spatial: distance, delay, pan, air absorption) ======================= */
  const A = (C.sfx = {});
  let hum = null;
  function spatial(p, cam) {
    const d = cam.position.distanceTo(p), dir = _v3.copy(p).sub(cam.position).normalize();
    const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    return { d, pan: RJ.clamp(dir.dot(right), -0.9, 0.9), g: 1 / (1 + d / 1800), lp: 18000 / (1 + d / 1500), delay: Math.min(6, d / 340) };
  }
  function noise(o) {
    const AU = RJ.audio, ctx = AU && AU.ctx; if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0), src = ctx.createBufferSource(); src.buffer = o.brown ? AU.brown : AU.white;
    const f = ctx.createBiquadFilter(); f.type = o.type || "lowpass"; f.frequency.setValueAtTime(Math.max(40, o.f0), t); if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur); if (o.q) f.Q.value = o.q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = o.pan || 0;
    src.connect(f).connect(g).connect(pn).connect(o.bus || AU.sfxBus); src.start(t, Math.random()); src.stop(t + o.dur + 0.05);
  }
  function tone(o) {
    const AU = RJ.audio, ctx = AU && AU.ctx; if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0), os = ctx.createOscillator(); os.type = o.wave || "sine";
    os.frequency.setValueAtTime(o.f0, t); if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = o.pan || 0;
    os.connect(g).connect(pn).connect(o.bus || AU.sfxBus); os.start(t); os.stop(t + o.dur + 0.05);
  }
  /** Continuous voice: reactor hum + turret servo whine, both following distance and charge. */
  function ensureHum() {
    const AU = RJ.audio, ctx = AU && AU.ctx; if (!ctx || hum) return hum;
    const out = ctx.createGain(); out.gain.value = 0; const pn = ctx.createStereoPanner(); out.connect(pn).connect(AU.envBus || AU.sfxBus);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; lp.Q.value = 3; lp.connect(out);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator(); o1.type = o2.type = "sawtooth"; o3.type = "sine";
    o1.frequency.value = 41; o2.frequency.value = 41.7; o3.frequency.value = 20.5;
    for (const o of [o1, o2, o3]) { o.connect(lp); o.start(); }
    const sv = ctx.createOscillator(); sv.type = "sawtooth"; sv.frequency.value = 90; const sg = ctx.createGain(); sg.gain.value = 0; const sb = ctx.createBiquadFilter(); sb.type = "bandpass"; sb.frequency.value = 400; sb.Q.value = 2;
    sv.connect(sb).connect(sg).connect(pn); sv.start();
    return (hum = { out, pn, lp, o1, o2, o3, sv, sg });
  }
  A.update = function (lm, cam, dt) {
    const AU = RJ.audio; if (!AU || !AU.ctx) return;
    const near = lm.dist < 26000 || lm.state === "charge";
    if (!near && !hum) return;
    const h = ensureHum(); if (!h) return;
    const sp = spatial(lm.recoil.localToWorld(_v.set(0, 0, 200)), cam), t = AU.ctx.currentTime;
    const ch = lm.state === "charge" ? lm.charge : 0;
    const level = (0.05 + ch * 0.75) * sp.g * 1.6 * (AU.muted ? 0 : 1);
    h.out.gain.setTargetAtTime(near ? Math.min(0.9, level) : 0, t, 0.15);
    h.pn.pan.setTargetAtTime(sp.pan, t, 0.1);
    h.lp.frequency.setTargetAtTime(Math.min(sp.lp, 160 + ch * ch * 2200), t, 0.1);
    const f = 41 * (1 + ch * ch * 2.2); h.o1.frequency.setTargetAtTime(f, t, 0.1); h.o2.frequency.setTargetAtTime(f * 1.017, t, 0.1); h.o3.frequency.setTargetAtTime(f / 2, t, 0.1);
    const slew = Math.abs(lm.yawRate) + Math.abs(lm.elevRate);
    h.sv.frequency.setTargetAtTime(70 + slew * 900, t, 0.1);
    h.sg.gain.setTargetAtTime(Math.min(0.25, slew * 2.5) * sp.g * 2, t, 0.2);
  };
  A.charge = function (lm, cam) {
    const sp = spatial(lm.group.position, cam);
    if (sp.d > 30000) return;
    // klaxon at the base: three long two-tone blasts
    for (let i = 0; i < 3; i++) { tone({ wave: "square", f0: 415, dur: 0.55, gain: 0.22 * sp.g * 2, delay: sp.delay + i * 1.2, pan: sp.pan, attack: 0.03 }); tone({ wave: "square", f0: 330, dur: 0.5, gain: 0.22 * sp.g * 2, delay: sp.delay + i * 1.2 + 0.58, pan: sp.pan, attack: 0.03 }); }
    // mechanical clunks of the breech locking
    for (let i = 0; i < 3; i++) { tone({ f0: 70, f1: 40, dur: 0.5, gain: 0.5 * sp.g * 2, delay: sp.delay + 0.3 + i * 0.35, pan: sp.pan }); noise({ f0: 1800, f1: 300, dur: 0.15, gain: 0.3 * sp.g * 2, delay: sp.delay + 0.3 + i * 0.35, pan: sp.pan, type: "bandpass", q: 2 }); }
    // the rising whine of the accelerator
    tone({ wave: "sawtooth", f0: 180, f1: 2400, dur: CHARGE, gain: 0.08 * sp.g * 2, delay: sp.delay, pan: sp.pan, attack: CHARGE * 0.8 });
  };
  A.stopCharge = function () {};
  A.lockBeep = function (k) { const AU = RJ.audio; if (AU && AU.beep) AU.beep(900 + k * 700, 0.07, 0.08); };
  A.fire = function (m, cam) {
    const sp = spatial(m, cam), g = Math.min(1.4, sp.g * 2.4);
    noise({ f0: Math.min(6000, sp.lp), f1: 300, dur: 0.5, gain: 1.1 * g, delay: sp.delay, pan: sp.pan, attack: 0.002 });           // crack
    tone({ f0: 38, f1: 18, dur: 3.2, gain: 1.2 * g, delay: sp.delay, pan: sp.pan * 0.5 });                                          // sub punch
    noise({ brown: true, f0: Math.min(900, sp.lp), f1: 50, dur: 6, gain: 0.9 * g, delay: sp.delay + 0.05, pan: sp.pan, attack: 0.05 }); // roar
    tone({ wave: "sawtooth", f0: 1600, f1: 90, dur: 1.4, gain: 0.12 * g, delay: sp.delay, pan: sp.pan });                          // electric discharge
    // the rumble rolling back off the hills, heard at any distance
    noise({ brown: true, f0: 300, f1: 40, dur: 5, gain: Math.max(0.12, 0.4 * g), delay: sp.delay + 1.4, pan: -sp.pan * 0.5, attack: 0.3 });
    noise({ brown: true, f0: 220, f1: 40, dur: 6, gain: Math.max(0.08, 0.25 * g), delay: sp.delay + 3.2, pan: sp.pan * 0.3, attack: 0.5 });
  };
  A.whoosh = function () { noise({ f0: 4000, f1: 300, dur: 1.2, gain: 0.7, type: "bandpass", q: 0.7, attack: 0.15 }); tone({ f0: 120, f1: 40, dur: 1.2, gain: 0.5 }); };

  /* ======================= debug / tests ======================= */
  /** Fire at a world point now (skips tracking; still charges). */
  C.test = function (pos, sky) { const lm = C.lm; if (!lm) return false; lm.target = { pos: pos.clone(), vel: V3(), alive: true, demo: true, sky: !!sky }; lm.state = "track"; lm.t = 0; return true; };
})(window.RJ);
