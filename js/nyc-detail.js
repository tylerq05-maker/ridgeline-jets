/* Jet City — New York's close-up layer, streamed in tiles around the camera.
 * Within ~700 m: rooftop plant (wooden water towers on their stilts, elevator bulkheads, HVAC and cooling
 * towers, antennas), street lights, traffic signals, street trees and parked cars. Within ~350 m: parapets,
 * cornices, fire escapes and shop awnings. Plus moving traffic on the real one-way grid (avenues alternate,
 * even-numbered streets run east, odd ones west), with headlights and tail lights at night. */
(function (RJ) {
  "use strict";
  const L = RJ.nyc, DEG = Math.PI / 180, TAU = Math.PI * 2;
  const TS = 350; let R1 = 760, R2 = 300, DROP = 1000;

  /* ---------------- fast geometry buckets ---------------- */
  function tpl(geo) { const g = geo.index ? geo.toNonIndexed() : geo; return { p: g.attributes.position.array, n: g.attributes.normal.array, k: g.attributes.position.count }; }
  let T = null;
  function templates() {
    if (T) return T;
    T = { box: tpl(new THREE.BoxGeometry(1, 1, 1)), cyl: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 9, 1)), cyl5: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1)), cone: tpl(new THREE.ConeGeometry(0.5, 1, 9, 1)) };
    return T;
  }
  class Bucket {
    constructor() { this.p = []; this.n = []; this.c = []; }
    /** Append template t scaled (sx, sy, sz), tilted rz about z, turned ry about y, at (x, y, z), in colour col. */
    add(t, x, y, z, sx, sy, sz, ry, col, rz) {
      const cr = Math.cos(ry || 0), sr = Math.sin(ry || 0), cz = Math.cos(rz || 0), szn = Math.sin(rz || 0);
      const P = t.p, N = t.n;
      for (let i = 0; i < t.k; i++) {
        let px = P[i * 3] * sx, py = P[i * 3 + 1] * sy, pz = P[i * 3 + 2] * sz;
        let nx = N[i * 3] / sx, ny = N[i * 3 + 1] / sy, nz = N[i * 3 + 2] / sz;
        if (rz) { const a = px * cz - py * szn, b = px * szn + py * cz; px = a; py = b; const c = nx * cz - ny * szn, d = nx * szn + ny * cz; nx = c; ny = d; }
        const wx = px * cr + pz * sr, wz = -px * sr + pz * cr, mx = nx * cr + nz * sr, mz = -nx * sr + nz * cr;
        const nl = Math.hypot(mx, ny, mz) || 1;
        this.p.push(wx + x, py + y, wz + z); this.n.push(mx / nl, ny / nl, mz / nl); this.c.push(col[0], col[1], col[2]);
      }
    }
    mesh(mat) {
      if (!this.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      g.computeBoundingSphere();
      return new THREE.Mesh(g, mat);
    }
  }

  /* ---------------- materials ---------------- */
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      det: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.75 }),
      lamp: new THREE.MeshBasicMaterial({ vertexColors: true }),
      signal: new THREE.MeshBasicMaterial({ vertexColors: true }),
      tree: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })
    };
    return M;
  }
  const C = {
    wood: [0.36, 0.27, 0.19], woodOld: [0.42, 0.38, 0.33], steelDk: [0.12, 0.12, 0.13], brick: [0.45, 0.3, 0.24], stone: [0.55, 0.52, 0.47],
    hvac: [0.5, 0.51, 0.5], hvacDk: [0.33, 0.34, 0.35], iron: [0.07, 0.07, 0.08], pole: [0.2, 0.22, 0.2], cornDk: [0.26, 0.22, 0.19], cornLt: [0.66, 0.62, 0.55],
    sigBox: [0.45, 0.38, 0.06], lampW: [1, 0.86, 0.62], red: [1, 0.12, 0.08], green: [0.15, 1, 0.55], amber: [1, 0.6, 0.1], subway: [0.15, 0.6, 0.25]
  };
  const AWN = [[0.55, 0.08, 0.08], [0.08, 0.32, 0.14], [0.08, 0.12, 0.3], [0.1, 0.1, 0.1], [0.6, 0.45, 0.1], [0.4, 0.1, 0.25]];
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------------- tile index ---------------- */
  let byTile = null;
  function indexTiles() {
    byTile = new Map();
    L.buildings.forEach((b, i) => { const k = Math.floor(b.x / TS) + "," + Math.floor(b.z / TS); let a = byTile.get(k); if (!a) byTile.set(k, (a = [])); a.push(i); });
  }
  /** World position (relative to ox, oz) of grid point (al, ac). */
  function gw(g, al, ac, ox, oz) { const [e, n] = L.fromGrid(g, al, ac); const [x, z] = L.toWorld(e, n); return [x - ox, z - oz]; }

  /* ---------------- rooftops and facades ---------------- */
  const PREWAR_LIKE = (s) => s === 1 || s === 2 || s === 4 || s === 5 || s === 6;
  function roofItems(B, Mt, b, ox, oz, near) {
    const G0 = L.GROUND, S = L.STYLE, t = b.tiers[b.tiers.length - 1], ry = -L.GR[b.g].ang * DEG;
    const r = rng(b.seed * 7919 + 13);
    const ca = (t.a0 + t.a1) / 2, cc = (t.c0 + t.c1) / 2, W = t.c1 - t.c0, D = t.a1 - t.a0, top = G0 + t.h;
    const at = (da, dc) => gw(b.g, ca + da, cc + dc, ox, oz);
    const T0 = templates();
    // elevator bulkhead / stair house
    if (b.h > 18 && W > 7 && D > 7 && !b.row) {
      const bw = Math.min(6 + r() * 4, W * 0.4), bd = Math.min(5 + r() * 3, D * 0.4), bh = 3.5 + r() * 2.5;
      const [x, z] = at((r() - 0.5) * (D - bd) * 0.6, (r() - 0.5) * (W - bw) * 0.6);
      B.add(T0.box, x, top + bh / 2, z, bw, bh, bd, ry, PREWAR_LIKE(b.style) ? C.brick : C.hvacDk);
    }
    // the wooden water towers of New York, on steel stilts
    if (PREWAR_LIKE(b.style) && b.h > 20 && W > 9 && D > 9 && r() < 0.62) {
      const n = r() < 0.25 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const R = 2.0 + r() * 1.3, H = 4.2 + r() * 2.2, legs = 3 + r() * 2.5;
        const [x, z] = at((r() - 0.5) * (D - 2 * R - 2) * 0.8, (r() - 0.5) * (W - 2 * R - 2) * 0.8);
        const col = r() < 0.5 ? C.wood : C.woodOld;
        for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) Mt.add(T0.box, x + lx * R * 0.62, top + legs / 2, z + lz * R * 0.62, 0.25, legs, 0.25, 0, C.steelDk);
        Mt.add(T0.box, x, top + legs - 0.2, z, R * 1.6, 0.3, R * 1.6, ry, C.steelDk);
        B.add(T0.cyl, x, top + legs + H / 2, z, R * 2, H, R * 2, 0, col);
        Mt.add(T0.cyl5, x, top + legs + H * 0.55, z, R * 2.07, 0.14, R * 2.07, 0, C.steelDk); // iron hoop
        B.add(T0.cone, x, top + legs + H + 0.9, z, R * 2.15, 1.8, R * 2.15, 0, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
      }
    }
    // HVAC plant and a cooling tower on modern buildings
    if ((b.style === S.GLASS || b.style === S.OFFICE || b.style === S.GRID || b.style === S.DECO) && W > 10 && D > 10) {
      const n = 2 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const w = 2 + r() * 3, d = 1.5 + r() * 2.5, h = 1.4 + r() * 1.8;
        const [x, z] = at((r() - 0.5) * (D - d - 3), (r() - 0.5) * (W - w - 3));
        Mt.add(T0.box, x, top + h / 2, z, w, h, d, ry, r() < 0.5 ? C.hvac : C.hvacDk);
      }
      if (r() < 0.6) { const [x, z] = at((r() - 0.5) * D * 0.4, (r() - 0.5) * W * 0.4); Mt.add(T0.box, x, top + 2.5, z, 5, 5, 4.5, ry, C.hvacDk); B.add(T0.cyl, x, top + 5.3, z, 3.4, 0.6, 3.4, 0, C.steelDk); }
    }
    // antennas on the taller roofs
    if (b.h > 110 && r() < 0.55) {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) { const h = 6 + r() * (b.h > 220 ? 30 : 14); const [x, z] = at((r() - 0.5) * D * 0.5, (r() - 0.5) * W * 0.5); Mt.add(T0.cyl5, x, top + h / 2, z, 0.35, h, 0.35, 0, C.hvacDk); }
    }
    if (!near) return;
    // parapets on every tier, a cornice on masonry buildings
    for (const tr of b.tiers) {
      const tca = (tr.a0 + tr.a1) / 2, tcc = (tr.c0 + tr.c1) / 2, tw = tr.c1 - tr.c0, td = tr.a1 - tr.a0, y = G0 + tr.h;
      const pc = PREWAR_LIKE(b.style) ? C.stone : C.hvacDk;
      for (const [da, dc, sw, sd] of [[td / 2, 0, tw, 0.35], [-td / 2, 0, tw, 0.35], [0, tw / 2, 0.35, td], [0, -tw / 2, 0.35, td]]) {
        const [x, z] = gw(b.g, tca + da, tcc + dc, ox, oz);
        B.add(T0.box, x, y + 0.55, z, sw + 0.3, 1.1, sd + 0.3, ry, pc);
      }
    }
    if (PREWAR_LIKE(b.style) && b.style !== S.DECO) {
      const t0 = b.tiers[0], y = G0 + t0.h, [x, z] = gw(b.g, (t0.a0 + t0.a1) / 2, (t0.c0 + t0.c1) / 2, ox, oz);
      const col = b.style === S.CAST ? C.cornLt : r() < 0.6 ? C.cornDk : C.cornLt;
      B.add(T0.box, x, y - 0.55, z, t0.c1 - t0.c0 + 1.4, 0.75, t0.a1 - t0.a0 + 1.4, ry, col);
      B.add(T0.box, x, y - 1.15, z, t0.c1 - t0.c0 + 0.8, 0.45, t0.a1 - t0.a0 + 0.8, ry, col);
      if (b.h > 30) { const yb = G0 + 4.6 + 3.1 * 2; B.add(T0.box, x, yb, z, t0.c1 - t0.c0 + 0.5, 0.35, t0.a1 - t0.a0 + 0.5, ry, C.stone); }
    }
  }
  /** Fire escapes on the street faces of tenements and walk-ups; awnings over the shops. */
  function facadeItems(B, Mt, b, ox, oz) {
    const S = L.STYLE, t = b.tiers[0], ry = -L.GR[b.g].ang * DEG, G0 = L.GROUND, T0 = templates();
    const r = rng(b.seed * 31 + 7);
    const W = t.c1 - t.c0, D = t.a1 - t.a0;
    const fe = (b.style === S.TENE || (b.style === S.BROWN && r() < 0.25) || (b.style === S.PREWAR && b.h < 40 && r() < 0.35));
    for (const side of [-1, 1]) {
      // street faces are the ±al faces (north and south) for mid-block lots
      const a = side > 0 ? t.a1 : t.a0;
      if (fe) {
        const n = Math.max(1, Math.floor(W / 11));
        for (let i = 0; i < n; i++) {
          if (r() < 0.35) continue;
          const cc = t.c0 + (i + 0.5) * (W / n), fw = 3.6, top = Math.min(t.h - 1.5, 4.6 + 3.1 * 6);
          for (let y = 4.6 + 3.1; y < top; y += 3.1) {
            const [x, z] = gw(b.g, a + side * 0.55, cc, ox, oz), [xr, zr] = gw(b.g, a + side * 1.0, cc, ox, oz);
            Mt.add(T0.box, x, G0 + y, z, fw, 0.08, 1.0, ry, C.iron);                       // platform
            Mt.add(T0.box, xr, G0 + y + 0.5, zr, fw, 0.9, 0.05, ry, C.iron);                 // railing
            const [xl, zl] = gw(b.g, a + side * 0.5, cc - fw * 0.15, ox, oz);
            Mt.add(T0.box, xl, G0 + y - 1.55, zl, 0.5, 3.4, 0.06, ry, C.iron, 0.55);       // ladder to the floor below
          }
        }
      }
      // awnings and signboards at street level
      if (b.style !== S.GLASS && b.style !== S.GRID && r() < 0.55) {
        const n = Math.max(1, Math.floor(W / 7));
        for (let i = 0; i < n; i++) {
          if (r() < 0.4) continue;
          const cc = t.c0 + (i + 0.5) * (W / n), [x, z] = gw(b.g, a + side * 0.75, cc, ox, oz);
          B.add(T0.box, x, G0 + 3.35, z, Math.min(5, W / n - 0.6), 0.18, 1.4, ry, AWN[Math.floor(r() * AWN.length)]);
        }
      }
    }
  }

  /* ---------------- street furniture ---------------- */
  const treeTpl = (() => { let g = null; return () => {
    if (g) return g;
    const trunk = new THREE.CylinderGeometry(0.15, 0.22, 3.2, 4, 1, true).toNonIndexed(); trunk.translate(0, 1.6, 0);
    const crown = new THREE.IcosahedronGeometry(2.6, 0).toNonIndexed(); crown.scale(1, 1.15, 1); crown.translate(0, 4.6, 0);
    const P = new Float32Array((trunk.attributes.position.count + crown.attributes.position.count) * 3), col = [];
    P.set(trunk.attributes.position.array); P.set(crown.attributes.position.array, trunk.attributes.position.count * 3);
    for (let i = 0; i < trunk.attributes.position.count; i++) col.push(0.32, 0.26, 0.2);
    for (let i = 0; i < crown.attributes.position.count; i++) col.push(1, 1, 1);
    g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }; })();
  let carGeo = null, carMat = null;
  function carTemplate() {
    if (carGeo) return carGeo;
    const parts = [], col = [], lamp = [];
    const add = (geo, c, lc) => { const g = geo.toNonIndexed(); parts.push(g); for (let i = 0; i < g.attributes.position.count; i++) { col.push(...c); lamp.push(...(lc || [0, 0, 0])); } };
    const body = new THREE.BoxGeometry(1.86, 0.75, 4.5); body.translate(0, 0.62, 0); add(body, [1, 1, 1]);
    const cab = new THREE.BoxGeometry(1.62, 0.62, 2.3); cab.translate(0, 1.28, 0.25); add(cab, [0.1, 0.12, 0.14]);
    const hl = new THREE.BoxGeometry(1.5, 0.18, 0.06); hl.translate(0, 0.72, -2.27); add(hl, [0.9, 0.9, 0.85], [1.6, 1.5, 1.2]);
    const tl = new THREE.BoxGeometry(1.5, 0.16, 0.06); tl.translate(0, 0.75, 2.27); add(tl, [0.5, 0.05, 0.05], [1.8, 0.1, 0.05]);
    for (const z of [1.45, -1.45]) { const w = new THREE.BoxGeometry(1.9, 0.62, 0.62); w.translate(0, 0.32, z); add(w, [0.05, 0.05, 0.05]); }
    let n = 0; for (const p of parts) n += p.attributes.position.count;
    const P = new Float32Array(n * 3); let o = 0; for (const p of parts) { P.set(p.attributes.position.array, o); o += p.attributes.position.count * 3; }
    carGeo = new THREE.BufferGeometry();
    carGeo.setAttribute("position", new THREE.BufferAttribute(P, 3)); carGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); carGeo.setAttribute("lamp", new THREE.Float32BufferAttribute(lamp, 3));
    carGeo.computeVertexNormals();
    carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
    carMat.userData.u = { uNight: { value: 0 } };
    carMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, carMat.userData.u);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 lamp; varying vec3 vLamp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLamp = lamp;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; varying vec3 vLamp;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLamp * (0.08 + uNight * 1.6);");
    };
    return carGeo;
  }
  const CAR_COLS = [0xe8e8e6, 0x1b1c1e, 0x8d9296, 0x5a5f66, 0x7a1e1e, 0x1f3550, 0x2c4a33, 0xc9c2b2, 0x3a3a3c, 0xb0b5ba];
  const RESID = new Set(["ues", "uws", "harlem", "village", "heights", "hk", "bk", "qns", "hob", "njres", "bx", "les", "soho", "midlow"]);
  function streetItems(B, Lm, Sg, trees, cars, ox, oz, x0, z0) {
    const T0 = templates(), r = rng(Math.floor(x0 * 7 + z0 * 13) >>> 0);
    const [ce, cn] = L.toLocalXZ(x0 + TS / 2, z0 + TS / 2);
    const g = L.gridAt ? L.gridAt(ce, cn) : 0;
    if (!g) return;
    const G = L.GR[g], ry = -G.ang * DEG, G0 = L.GROUND;
    // grid-coordinate range of this tile
    let a0 = 1e9, a1 = -1e9, c0 = 1e9, c1 = -1e9;
    for (const [x, z] of [[x0, z0], [x0 + TS, z0], [x0, z0 + TS], [x0 + TS, z0 + TS]]) { const [e, n] = L.toLocalXZ(x, z); const [a, c] = L.toGrid(g, e, n); a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    const LA = L.lines(g, "A", a0, a1), LC = L.lines(g, "C", c0, c1);
    const inTile = (x, z) => x >= x0 && x < x0 + TS && z >= z0 && z < z0 + TS;
    const okAt = (al, ac) => { const [e, n] = L.fromGrid(g, al, ac); if (L.gridAt(e, n) !== g || L.sdfLocal(e, n) < 14) return null; const [x, z] = L.toWorld(e, n); if (!inTile(x, z)) return null; if (L.inParkAt(e, n)) return null; return [x - ox, z - oz, e, n]; };
    const pole = (x, z, h, armDir, armLen) => {
      B.add(T0.cyl5, x, G0 + h / 2, z, 0.24, h, 0.24, 0, C.pole);
      const ax = x + Math.cos(armDir) * armLen / 2, az = z - Math.sin(armDir) * armLen / 2;
      B.add(T0.box, ax, G0 + h - 0.2, az, armLen, 0.14, 0.14, armDir, C.pole);
      const hx = x + Math.cos(armDir) * armLen, hz = z - Math.sin(armDir) * armLen;
      B.add(T0.box, hx, G0 + h - 0.35, hz, 0.9, 0.22, 0.42, armDir, C.pole);
      Lm.add(T0.box, hx, G0 + h - 0.48, hz, 0.7, 0.05, 0.34, armDir, C.lampW);
    };
    // street lights along both kerbs of every avenue and street, every ~32 m
    for (const ln of LC) for (const side of [-1, 1]) {
      const acL = ln.p + side * (ln.w / 2 + 0.8);
      for (let al = Math.ceil(a0 / 40) * 40 + (side > 0 ? 20 : 0); al < a1; al += 40) {
        if (LA.some((s) => Math.abs(al - s.p) < s.w / 2 + 3)) continue;
        const p = okAt(al, acL); if (!p) continue;
        pole(p[0], p[1], 8.5, ry + (side > 0 ? Math.PI : 0), 2.4);
      }
    }
    for (const ln of LA) for (const side of [-1, 1]) {
      const alL = ln.p + side * (ln.w / 2 + 0.8);
      for (let ac = Math.ceil(c0 / 34) * 34 + (side > 0 ? 17 : 0); ac < c1; ac += 34) {
        if (LC.some((s) => Math.abs(ac - s.p) < s.w / 2 + 3)) continue;
        const p = okAt(alL, ac); if (!p) continue;
        pole(p[0], p[1], 8.0, ry + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 2.0);
        // street trees in the residential neighbourhoods
        const zn = L.zoneName(p[2], p[3]);
        if (RESID.has(zn)) for (let k = 1; k <= 2; k++) { if (r() < 0.25) continue; const q = okAt(ln.p + side * (ln.w / 2 + 1.6), ac + k * 11.3); if (q) trees.push([q[0], q[1], 0.75 + r() * 0.5, r() * TAU]); }
        // parked cars along the kerb (not on the avenues)
        for (let k = 0; k < 5; k++) { if (r() < 0.3) continue; const q = okAt(ln.p + side * (ln.w / 2 - 1.3), ac + 4 + k * 6.2); if (q) cars.push([q[0], q[1], ry + (side > 0 ? 0 : Math.PI), CAR_COLS[Math.floor(r() * CAR_COLS.length)]]); }
      }
    }
    // traffic signals: two corners of every intersection, mast arms over the road
    for (const s of LA) for (const v of LC) {
      for (const [sa, sc] of [[1, 1], [-1, -1]]) {
        const p = okAt(s.p + sa * (s.w / 2 + 1.0), v.p + sc * (v.w / 2 + 1.0)); if (!p) continue;
        B.add(T0.cyl5, p[0], G0 + 3.2, p[1], 0.26, 6.4, 0.26, 0, C.pole);
        const armDir = ry + (sc > 0 ? Math.PI : 0), al2 = Math.min(v.w * 0.55, 9);
        B.add(T0.box, p[0] + Math.cos(armDir) * al2 / 2, G0 + 6.1, p[1] - Math.sin(armDir) * al2 / 2, al2, 0.16, 0.16, armDir, C.pole);
        const hx = p[0] + Math.cos(armDir) * al2 * 0.8, hz = p[1] - Math.sin(armDir) * al2 * 0.8;
        B.add(T0.box, hx, G0 + 5.4, hz, 0.42, 1.2, 0.42, armDir, C.sigBox);
        const phase = ((s.k + v.k) & 1) === 0;
        const fx = Math.sin(armDir) * 0.22, fz = Math.cos(armDir) * 0.22;
        Sg.add(T0.box, hx + fx, G0 + 5.82, hz + fz, 0.26, 0.26, 0.05, armDir, phase ? C.red : [0.12, 0.02, 0.02]);
        Sg.add(T0.box, hx + fx, G0 + 5.42, hz + fz, 0.26, 0.26, 0.05, armDir, [0.12, 0.08, 0.01]);
        Sg.add(T0.box, hx + fx, G0 + 5.02, hz + fz, 0.26, 0.26, 0.05, armDir, phase ? [0.02, 0.1, 0.05] : C.green);
        // a subway entrance on some Manhattan corners: railings and the green globes
        if (g <= 2 && r() < 0.07) {
          const q = okAt(s.p + sa * (s.w / 2 + 2.8), v.p + sc * (v.w / 2 + 6)); if (q) { B.add(T0.box, q[0], G0 + 0.55, q[1], 1.8, 1.1, 4.5, ry, C.iron); for (const d of [-1, 1]) { const gx = q[0] + Math.cos(ry) * d * 0.9, gz = q[1] - Math.sin(ry) * d * 0.9; B.add(T0.cyl5, gx, G0 + 1.4, gz, 0.1, 1.7, 0.1, 0, C.iron); Lm.add(T0.box, gx, G0 + 2.35, gz, 0.4, 0.4, 0.4, 0, C.subway); } }
        }
      }
    }
  }

  /* ---------------- tile manager ---------------- */
  const tiles = new Map(); let grp = null;
  function buildTile(key, level) {
    const [i, j] = key.split(",").map(Number), x0 = i * TS, z0 = j * TS, ox = x0 + TS / 2, oz = z0 + TS / 2;
    const old = tiles.get(key); if (old) disposeTile(old);
    const Mt = mats(), B = new Bucket(), Mm = new Bucket(), Lm = new Bucket(), Sg = new Bucket(), trees = [], cars = [];
    for (const bi of byTile.get(key) || []) {
      const b = L.buildings[bi];
      roofItems(B, Mm, b, ox, oz, level >= 2);
      if (level >= 2) facadeItems(B, Mm, b, ox, oz);
    }
    streetItems(B, Lm, Sg, trees, cars, ox, oz, x0, z0);
    const node = new THREE.Group(); node.position.set(ox, 0, oz);
    for (const [bk, mat, shadow] of [[B, Mt.det, true], [Mm, Mt.metal, true], [Lm, Mt.lamp, false], [Sg, Mt.signal, false]]) { const m = bk.mesh(mat); if (m) { m.castShadow = shadow; m.receiveShadow = true; node.add(m); } }
    if (trees.length) {
      const im = new THREE.InstancedMesh(treeTpl(), Mt.tree, trees.length), c = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      trees.forEach((t, k) => { m4.compose(p.set(t[0], L.GROUND, t[1]), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[3]), s.setScalar(t[2])); im.setMatrixAt(k, m4); im.setColorAt(k, c.setHex([0x2f5a23, 0x3b6527, 0x284d1e, 0x4a6e2c][k % 4])); });
      im.castShadow = true; im.receiveShadow = true; node.add(im);
    }
    if (cars.length) {
      const im = new THREE.InstancedMesh(carTemplate(), carMat, cars.length), c = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      cars.forEach((t, k) => { m4.compose(p.set(t[0], L.GROUND, t[1]), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[2]), s); im.setMatrixAt(k, m4); im.setColorAt(k, c.setHex(t[3])); });
      im.castShadow = true; node.add(im);
    }
    node.traverse((o) => o.layers.set(L.NEAR));
    grp.add(node);
    const T = { key, level, node }; tiles.set(key, T); return T;
  }
  function disposeTile(T) { grp.remove(T.node); T.node.traverse((o) => { if (o.geometry && o.geometry !== carGeo && o.geometry !== treeTpl()) o.geometry.dispose(); }); tiles.delete(T.key); }

  /* ---------------- moving traffic ---------------- */
  const NCAR = 500; let traffic = null;
  function initTraffic(parent) {
    carTemplate();
    const im = new THREE.InstancedMesh(carGeo, carMat, NCAR); im.frustumCulled = false; im.castShadow = true;
    const c = new THREE.Color();
    const st = [];
    for (let i = 0; i < NCAR; i++) { st.push({ live: false }); im.setColorAt(i, c.setHex(i % 3 === 0 ? 0xf2c200 : CAR_COLS[i % CAR_COLS.length])); }
    im.layers.set(L.NEAR); parent.add(im);
    traffic = { im, st };
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function spawnCar(c, cam, r) {
    const [ce, cn] = L.toLocalXZ(cam.position.x + (r() - 0.5) * 1200, cam.position.z + (r() - 0.5) * 1200);
    const g = L.gridAt(ce, cn); if (!g) return false;
    const [ca, cc] = L.toGrid(g, ce, cn);
    const avenue = r() < (g === 1 ? 0.62 : 0.45);
    const lns = L.lines(g, avenue ? "C" : "A", (avenue ? cc : ca) - 600, (avenue ? cc : ca) + 600);
    const ln = lns[Math.floor(r() * lns.length)];
    // one-way rules: avenues alternate, even streets run east, odd ones west; wide crosstown streets are two-way
    let dir;
    if (avenue) dir = g === 1 && ln.k === 10 ? (r() < 0.5 ? 1 : -1) : ((ln.k | 0) % 2 ? 1 : -1);
    else dir = g === 1 && L.MAJOR.includes(ln.k) ? (r() < 0.5 ? 1 : -1) : ((ln.k | 0) % 2 === 0 ? 1 : -1);
    const lanes = Math.max(1, Math.floor((ln.w - 6) / 3.3)), lane = Math.floor(r() * lanes);
    const off = -ln.w / 2 + 3.6 + lane * 3.3;
    Object.assign(c, { live: true, g, avenue, fixed: ln.p + off, pos: avenue ? ca + (r() - 0.5) * 1100 : cc + (r() - 0.5) * 1100, dir, v: 7 + r() * 9, stop: 0 });
    return true;
  }
  function updateTraffic(dt, cam) {
    const T = traffic, q = RJ.settings.quality, low = q !== "low" && cam.position.y < 1400 && L.within(cam.position.x, cam.position.z, -3000);
    const nMax = q === "medium" ? 250 : NCAR;
    T.im.visible = low;
    if (!low) return;
    const r = Math.random;
    carMat.userData.u.uNight.value = L.night || 0;
    for (let i = 0; i < NCAR; i++) {
      const c = T.st[i];
      if (i >= nMax) { if (c.live) { c.live = false; _m.makeScale(0, 0, 0); T.im.setMatrixAt(i, _m); } continue; }
      if (!c.live && !spawnCar(c, cam, r)) { _m.makeScale(0, 0, 0); T.im.setMatrixAt(i, _m); continue; }
      // stop-and-go: a red light now and then
      if (c.stop > 0) c.stop -= dt; else { c.pos += c.dir * c.v * dt; if (r() < dt * 0.05) c.stop = 2 + r() * 18; }
      const al = c.avenue ? c.pos : c.fixed, ac = c.avenue ? c.fixed : c.pos;
      const [e, n] = L.fromGrid(c.g, al, ac), [x, z] = L.toWorld(e, n);
      if ((x - cam.position.x) ** 2 + (z - cam.position.z) ** 2 > 1400 * 1400 || L.gridAt(e, n) !== c.g || L.sdfLocal(e, n) < 10 || L.inParkAt(e, n)) { c.live = false; _m.makeScale(0, 0, 0); T.im.setMatrixAt(i, _m); continue; }
      const G = L.GR[c.g];
      const dx = c.avenue ? G.Ae * c.dir : G.Ce * c.dir, dn = c.avenue ? G.An * c.dir : G.Cn * c.dir; // local east/north heading
      const yaw = Math.atan2(-dx, dn);
      _m.compose(_p.set(x, L.GROUND, z), _q.setFromAxisAngle(_up, yaw), _s); T.im.setMatrixAt(i, _m);
    }
    T.im.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- per-frame ---------------- */
  L.initDetail = function (parent) {
    grp = new THREE.Group(); grp.name = "nyc-detail"; parent.add(grp);
    indexTiles(); initTraffic(parent);
  };
  let budgetT = 0;
  L.updateDetail = function (dt, cam) {
    const p = cam.position, night = L.night || 0, Mt = mats();
    Mt.lamp.color.setScalar(0.35 + night * 2.4);
    Mt.signal.color.setScalar(0.9 + night * 1.6);
    updateTraffic(dt, cam);
    const alt = p.y;
    // drop tiles that fell behind
    for (const T of [...tiles.values()]) {
      const [i, j] = T.key.split(",").map(Number), d = Math.hypot(p.x - (i + 0.5) * TS, p.z - (j + 0.5) * TS);
      if (d > DROP || alt > 1500) disposeTile(T);
    }
    // graphics quality scales the close-up layer: low skips it, medium keeps a smaller ring
    const q = RJ.settings.quality;
    if (q === "low") return;
    R1 = q === "medium" ? 520 : 760; R2 = q === "medium" ? 200 : 300;
    if (alt > 1300 || !L.within(p.x, p.z, -2000)) return;
    // build one tile per frame, nearest first
    const ci = Math.floor(p.x / TS), cj = Math.floor(p.z / TS), rr = Math.ceil(R1 / TS) + 1;
    let best = null;
    for (let i = ci - rr; i <= ci + rr; i++) for (let j = cj - rr; j <= cj + rr; j++) {
      const d = Math.hypot(p.x - (i + 0.5) * TS, p.z - (j + 0.5) * TS);
      const want = d < R2 && alt < 700 ? 2 : d < R1 ? 1 : 0;
      if (!want) continue;
      const key = i + "," + j, T = tiles.get(key);
      if (T && T.level >= want) continue;
      if (!byTile.get(key) && !T) { /* no buildings: street furniture only */ }
      if (!best || d < best.d) best = { key, want, d };
    }
    if (best) buildTile(best.key, best.want);
  };
  L.detailStats = () => ({ tiles: tiles.size, cars: traffic ? traffic.st.filter((c) => c.live).length : 0 });
})(window.RJ);
