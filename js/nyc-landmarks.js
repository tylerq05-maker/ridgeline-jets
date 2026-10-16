/* Jet City — New York landmarks, bridges, Times Square and Central Park's trees.
 * Towers are modelled from their real heights, footprints and setbacks and placed by street address on the
 * same grid the city is built on (so the Empire State Building really sits at Fifth and 34th). Facades use the
 * city's procedural facade shader; crowns, spires, the Statue of Liberty and the bridges are real geometry. */
(function (RJ) {
  "use strict";
  const L = RJ.nyc, V3 = RJ.V3, DEG = Math.PI / 180, TAU = Math.PI * 2;
  let NY, G0;
  const ST = 80.4;
  const S = () => L.STYLE;
  const std = (color, rough = 0.7, metal = 0, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra || {}));
  const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: true });
  const LM = (L.lm = {});
  const lights = []; // {mat, base: Color, day: 0..1} brightened at night
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _e = new THREE.Euler();

  /* ---------------- placement helpers ---------------- */
  const al = (k) => (k - 34) * ST;
  /** World position of Manhattan address (street number k, metres across from Fifth Ave). */
  function addrW(k, ac) { const [e, n] = L.addr(k, ac); return L.toWorld(e, n); }
  function llW(lat, lon) { const [e, n] = L.local(lat, lon); return L.toWorld(e, n); }
  /** A group whose local axes follow the Manhattan grid (−z = up-town along the avenues, +x = east across). */
  function gridFrame(x, z, ang = 29) { const g = new THREE.Group(); g.position.set(x, G0, z); g.rotation.y = -ang * DEG; return g; }
  /** Facade-shaded tiers for a tower: list of [dA (N–S depth), dC (E–W width), top height, offA, offC]. */
  function tower(buf, k, ac, tiers, style, seed, ox, oz, y0) {
    let yb = y0 != null ? y0 : G0 - 1.5;
    const a = al(k);
    for (const t of tiers) {
      const [dA, dC, h, oA, oC] = t;
      const tier = { a0: a + (oA || 0) - dA / 2, a1: a + (oA || 0) + dA / 2, c0: ac + (oC || 0) - dC / 2, c1: ac + (oC || 0) + dC / 2, h };
      L.addTier(buf, 1, tier, yb, ox, oz, seed, L.codeOf(t[5] != null ? t[5] : style));
      (L.farExtra = L.farExtra || []).push(Object.assign({ col: [0.6, 0.6, 0.58] }, tier)); // for the long-range skyline
      yb = G0 + h - 0.02;
    }
    return G0 + tiers[tiers.length - 1][2];
  }
  /** Prism over a polygon in Manhattan grid coordinates [[al, ac], ...] with facade attributes. */
  function poly(buf, pts, y0, y1, seed, code, ox, oz, g = 1) {
    const P = pts.map(([a, c]) => { const [e, n] = L.fromGrid(g, a, c); return [NY.ex + e - ox, NY.ez - n - oz]; });
    let cx = 0, cz = 0; for (const p of P) { cx += p[0]; cz += p[1]; } cx /= P.length; cz /= P.length;
    const vb = y0 - G0, vt = y1 - G0;
    let u0 = 0;
    for (let i = 0; i < P.length; i++) {
      let p0 = P[i], p1 = P[(i + 1) % P.length];
      let ex = p1[0] - p0[0], ez = p1[1] - p0[1];
      const mx = (p0[0] + p1[0]) / 2 - cx, mz = (p0[1] + p1[1]) / 2 - cz;
      if (-ez * mx + ex * mz < 0) { const t = p0; p0 = p1; p1 = t; ex = -ex; ez = -ez; }
      const Ln = Math.hypot(ex, ez), nx = -ez / Ln, nz = ex / Ln;
      buf.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], nx, 0, nz, [u0, vb, Ln, vt], [u0 + Ln, vb, Ln, vt], [u0 + Ln, vt, Ln, vt], [u0, vt, Ln, vt], seed, code);
    }
    for (let i = 0; i < P.length; i++) {
      let a = P[i], b = P[(i + 1) % P.length];
      if ((a[1] - cz) * (b[0] - cx) - (a[0] - cx) * (b[1] - cz) < 0) { const t = a; a = b; b = t; }
      const F = (q) => [q[0], q[1], -1, vt];
      buf.quad([cx, y1, cz], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y1, b[1]], 0, 1, 0, F([cx, cz]), F(a), F(b), F(b), seed, code);
    }
  }
  function massMesh(grp, buf, ox, oz) {
    const m = new THREE.Mesh(buf.geometry(), L.massMat);
    m.position.set(ox, 0, oz); m.castShadow = true; m.receiveShadow = true;
    grp.add(m); return m;
  }
  /** Collision box in Manhattan grid coordinates (top y absolute). */
  const BOXES = [];
  function solidBox(g, a0, a1, c0, c1, top) { BOXES.push({ g, a0, a1, c0, c1, top }); }
  const CYL = []; // world cylinders {x, z, r, top}
  function solidCyl(x, z, r, top) { CYL.push({ x, z, r, top }); }

  /* ======================= plan: keep ground free ======================= */
  const SITES = {};
  L.planLandmarks = function () {
    NY = RJ.world.gen.nyc; G0 = L.GROUND;
    const res = (k, ac, r) => { const [e, n] = L.addr(k, ac); L.reserve(e, n, r); };
    const resLL = (lat, lon, r) => { const [e, n] = L.local(lat, lon); L.reserve(e, n, r); };
    res(33.5, -80, 75);          // Empire State
    res(42.5, 420, 45);          // Chrysler
    res(56.5, 205, 22);          // 432 Park
    res(57.2, -640, 40);         // Central Park Tower
    res(57.3, -420, 34);         // 111 W 57th
    res(42.5, 175, 40);          // One Vanderbilt
    res(49.5, -175, 70);         // 30 Rock
    res(42.5, -335, 42);         // Bank of America Tower
    res(32.6, -1500, 160);       // Hudson Yards
    res(44.5, 250, 75);          // MetLife + Grand Central
    res(22.5, 25, 45);           // Flatiron
    res(32.1, -700, 95);         // Madison Square Garden
    res(44.5, 1065, 70);         // United Nations
    res(53.5, 430, 40);          // Citigroup Center
    resLL(40.7127, -74.0127, 230); // World Trade Center
    resLL(40.7124, -74.0083, 40);  // Woolworth
    for (const b of BRIDGES) { const [e1, n1] = L.local(b.a[0], b.a[1]), [e2, n2] = L.local(b.b[0], b.b[1]); const dx = e2 - e1, dn = n2 - n1, len = Math.hypot(dx, dn); for (let t = -b.side[0] - 200; t <= len + b.side[1] + 200; t += 40) L.reserve(e1 + dx / len * t, n1 + dn / len * t, b.w * 0.5 + 14); }
  };

  /* ======================= towers ======================= */
  function buildTowers(grp) {
    const st = S();
    const steel = std(0xd9dde2, 0.22, 1.0), copper = std(0x5e9c86, 0.55, 0.35), bronze = std(0x4a3a2a, 0.45, 0.7);
    const darkMetal = std(0x2d3034, 0.4, 0.8);
    // ---------- Empire State Building (443 m): 34th & Fifth ----------
    {
      const [x, z] = addrW(33.5, -80), buf = new L.MassBuf();
      const top = tower(buf, 33.5, -80, [[60, 129, 25], [50, 112, 82], [46, 82, 120], [42, 58, 268], [34, 42, 300], [28, 30, 320]], st.DECO, 34, x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z);
      // the mooring mast: fluted octagonal drum, glass lantern, antenna
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 9.5, 30, 8, 1), std(0xc9c3b4, 0.45, 0.4)); mast.position.y = 320 + 15; f.add(mast);
      const fins = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 10.2, 22, 16, 1, true), std(0xaaa59a, 0.35, 0.7, { side: THREE.DoubleSide })); fins.position.y = 320 + 11; f.add(fins);
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 6.2, 18, 8), std(0x9fb3bd, 0.1, 0.9)); lantern.position.y = 350 + 9; f.add(lantern);
      const crownL = glow(0, 0, 0); lights.push({ mat: crownL, base: new THREE.Color(2.2, 2.0, 1.6), kind: "esb" });
      const halo = new THREE.Mesh(new THREE.CylinderGeometry(9.8, 11.4, 26, 16, 1, true), crownL); halo.position.y = 322 + 13; f.add(halo);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 2.4, 70, 8), std(0xb8bcc0, 0.4, 0.8)); ant.position.y = 373 + 35; f.add(ant);
      for (const [y, r] of [[380, 3.2], [392, 2.4], [404, 1.9]]) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 12), darkMetal); ring.position.y = y; f.add(ring); }
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), glow(4, 0.2, 0.1)); beacon.position.y = 443; f.add(beacon);
      grp.add(f); solidBox(1, al(33.5) - 30, al(33.5) + 30, -80 - 64, -80 + 64, G0 + 25); solidBox(1, al(33.5) - 14, al(33.5) + 14, -80 - 15, -80 + 15, G0 + 373);
      solidCyl(x, z, 3, G0 + 443);
      LM.esb = { x, z, top: G0 + 443 };
    }
    // ---------- Chrysler Building (319 m): Lexington & 42nd ----------
    {
      const [x, z] = addrW(42.5, 420), buf = new L.MassBuf();
      tower(buf, 42.5, 420, [[62, 62, 60], [50, 50, 120], [34, 34, 180], [28, 28, 238]], st.DECO, 42, x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z);
      // seven terraced stainless-steel arches with their sunburst windows
      const triMat = glow(0, 0, 0); lights.push({ mat: triMat, base: new THREE.Color(2.4, 2.3, 1.9), kind: "night" });
      for (let i = 0; i < 7; i++) {
        const w = 26 - i * 3.0, y = 238 + i * 5.4;
        const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, 2.6); sh.absarc(0, 2.6, w / 2, 0, Math.PI, false); sh.lineTo(-w / 2, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: false, curveSegments: 18 });
        for (let s = 0; s < 4; s++) {
          const m = new THREE.Mesh(geo, steel); m.rotation.y = s * Math.PI / 2;
          m.position.set(Math.sin(s * Math.PI / 2) * w / 2, y, Math.cos(s * Math.PI / 2) * w / 2); f.add(m);
          // triangular windows set into each arch
          for (let k = -2; k <= 2; k++) {
            const tg = new THREE.ConeGeometry(0.7, 2.2, 3); const t = new THREE.Mesh(tg, triMat);
            const a = (k / 5) * Math.PI * 0.8, r = w / 2 - 1.2;
            const lx = Math.sin(a) * r, ly = y + 2.6 + Math.cos(a) * r * 0.85 - 1.5;
            t.position.set(Math.sin(s * Math.PI / 2) * (w / 2 + 0.45) + Math.cos(s * Math.PI / 2) * lx, ly, Math.cos(s * Math.PI / 2) * (w / 2 + 0.45) - Math.sin(s * Math.PI / 2) * lx);
            t.rotation.y = s * Math.PI / 2; f.add(t);
          }
        }
        const core = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 5.4, w - 1), steel); core.position.y = y + 2.7; f.add(core);
      }
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2, 40, 8), steel); spire.position.y = 276 + 20; f.add(spire);
      // the eagle gargoyles on the 61st-floor setback
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const eg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 4.5), steel); eg.position.set(sx * 15.5, 222, sz * 15.5); eg.rotation.y = Math.atan2(sx, sz); f.add(eg); }
      grp.add(f); solidBox(1, al(42.5) - 31, al(42.5) + 31, 420 - 31, 420 + 31, G0 + 60); solidBox(1, al(42.5) - 14, al(42.5) + 14, 420 - 14, 420 + 14, G0 + 276); solidCyl(x, z, 2, G0 + 319);
      LM.chrysler = { x, z };
    }
    // ---------- One Vanderbilt (427 m) ----------
    {
      const [x, z] = addrW(42.5, 175), buf = new L.MassBuf();
      const top = tower(buf, 42.5, 175, [[58, 60, 60], [52, 54, 200], [46, 46, 300], [38, 38, 360], [28, 28, 392]], st.GLASS, 77, x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z); const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, 35, 8), steel); sp.position.y = 392 + 17.5; f.add(sp); grp.add(f);
      solidBox(1, al(42.5) - 26, al(42.5) + 26, 175 - 27, 175 + 27, G0 + 392);
    }
    // ---------- 432 Park Avenue (426 m): a white concrete grid with open mechanical floors ----------
    {
      const [x, z] = addrW(56.5, 205), buf = new L.MassBuf(), T = [];
      let h = 0;
      while (h < 420) { const sec = Math.min(66, 426 - h); if (sec < 8) break; T.push([28.5, 28.5, h + sec - 9, 0, 0, st.GRID]); T.push([27.0, 27.0, h + sec, 0, 0, st.GLASS]); h += sec; }
      T[T.length - 1][2] = 426;
      tower(buf, 56.5, 205, T, st.GRID, 432, x, z);
      massMesh(grp, buf, x, z); solidBox(1, al(56.5) - 14.3, al(56.5) + 14.3, 205 - 14.3, 205 + 14.3, G0 + 426);
    }
    // ---------- Central Park Tower (472 m) and 111 West 57th (435 m) on Billionaires' Row ----------
    {
      const [x, z] = addrW(57.2, -640), buf = new L.MassBuf();
      tower(buf, 57.2, -640, [[45, 62, 32, 0, 0, st.OFFICE], [28, 36, 300], [26, 34, 440], [22, 28, 472]], st.GLASS, 225, x, z);
      massMesh(grp, buf, x, z); solidBox(1, al(57.2) - 14, al(57.2) + 14, -640 - 18, -640 + 18, G0 + 472);
      const [x2, z2] = addrW(57.3, -420), b2 = new L.MassBuf();
      // feathered setbacks on the south face
      tower(b2, 57.3, -420, [[24, 60, 60], [18, 60, 300], [15, 60, 350, 1.5], [12, 58, 385, 3], [9, 56, 410, 4.5], [6, 54, 425, 6], [4, 50, 435, 7]], st.DECO, 111, x2, z2);
      massMesh(grp, b2, x2, z2); solidBox(1, al(57.3) - 9, al(57.3) + 9, -420 - 30, -420 + 30, G0 + 435);
    }
    // ---------- 30 Rockefeller Plaza (259 m) ----------
    {
      const [x, z] = addrW(49.5, -175), buf = new L.MassBuf();
      tower(buf, 49.5, -175, [[56, 140, 26], [32, 110, 120], [30, 92, 180, 0, -9], [28, 72, 225, 0, -18], [26, 52, 259, 0, -26]], st.DECO, 30, x, z);
      massMesh(grp, buf, x, z); solidBox(1, al(49.5) - 16, al(49.5) + 16, -175 - 55, -175 + 55, G0 + 259);
    }
    // ---------- Bank of America Tower (366 m) ----------
    {
      const [x, z] = addrW(42.5, -335), buf = new L.MassBuf();
      tower(buf, 42.5, -335, [[60, 72, 30, 0, 0, st.OFFICE], [50, 56, 210], [44, 48, 268], [34, 38, 288]], st.GLASS, 1, x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z); const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.6, 78, 8), steel); sp.position.y = 288 + 39; f.add(sp); grp.add(f);
      solidBox(1, al(42.5) - 25, al(42.5) + 25, -335 - 28, -335 + 28, G0 + 288);
    }
    // ---------- MetLife over Grand Central ----------
    {
      const [x, z] = addrW(44.6, 250), buf = new L.MassBuf();
      const a = al(44.6), oct = (cw, cd, ch) => [[a - cd / 2, 250 - cw / 2 + ch], [a - cd / 2, 250 + cw / 2 - ch], [a - cd / 2 + ch, 250 + cw / 2], [a + cd / 2 - ch, 250 + cw / 2], [a + cd / 2, 250 + cw / 2 - ch], [a + cd / 2, 250 - cw / 2 + ch], [a + cd / 2 - ch, 250 - cw / 2], [a - cd / 2 + ch, 250 - cw / 2]];
      poly(buf, oct(80, 70, 10), G0 - 1.5, G0 + 40, 200, L.codeOf(S().CAST), x, z);
      poly(buf, oct(92, 46, 12), G0 + 40, G0 + 246, 201, L.codeOf(S().OFFICE), x, z);
      // Grand Central Terminal: beaux-arts hall south of it
      const [gx, gz] = addrW(42.7, 250), gb = new L.MassBuf();
      tower(gb, 42.7, 250, [[72, 140, 30, 0, 0, st.CAST], [40, 100, 38, 0, 0, st.CAST]], st.CAST, 13, gx, gz);
      massMesh(grp, gb, gx, gz); massMesh(grp, buf, x, z);
      solidBox(1, a - 35, a + 35, 250 - 40, 250 + 40, G0 + 40); solidBox(1, a - 23, a + 23, 250 - 46, 250 + 46, G0 + 246); solidBox(1, al(42.7) - 36, al(42.7) + 36, 250 - 70, 250 + 70, G0 + 38);
    }
    // ---------- Flatiron (87 m): the wedge between Fifth Avenue and Broadway ----------
    {
      const a0 = al(22) + 9, a1 = al(22.85), [x, z] = addrW(22.4, 30), buf = new L.MassBuf();
      const pts = [[a0, 16], [a0, 43], [a1, 18], [a1 + 1.5, 16.5]];
      poly(buf, pts, G0 - 1.5, G0 + 87, 23, L.codeOf(S().PREWAR), x, z);
      massMesh(grp, buf, x, z); solidBox(1, a0, a1, 16, 43, G0 + 87);
    }
    // ---------- Madison Square Garden ----------
    {
      const [x, z] = addrW(32.1, -700), buf = new L.MassBuf(), a = al(32.1), P = [];
      for (let i = 0; i < 28; i++) { const t = (i / 28) * TAU; P.push([a + Math.cos(t) * 64, -700 + Math.sin(t) * 64]); }
      poly(buf, P, G0 - 1.5, G0 + 46, 31, L.codeOf(S().OFFICE), x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z); const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 6, 0, TAU, 0, 0.32), std(0xb9bcbf, 0.6, 0.3)); dome.position.y = 46 - 70 * Math.cos(0.32) + 1; f.add(dome); grp.add(f);
      solidCyl(x, z, 64, G0 + 52);
      // Penn Station's tower beside it
      const [px, pz] = addrW(33.6, -700), pb = new L.MassBuf(); tower(pb, 33.6, -700, [[40, 110, 150]], st.OFFICE, 33, px, pz); massMesh(grp, pb, px, pz); solidBox(1, al(33.6) - 20, al(33.6) + 20, -755, -645, G0 + 150);
    }
    // ---------- United Nations Secretariat (154 m) ----------
    {
      const [x, z] = addrW(44.5, 1065), buf = new L.MassBuf();
      tower(buf, 44.5, 1065, [[88, 22, 154]], st.GLASS, 9, x, z);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z); const marble = std(0xe8e4dc, 0.6);
      for (const s of [-1, 1]) { const end = new THREE.Mesh(new THREE.BoxGeometry(23, 156, 1.2), marble); end.position.set(0, 77, s * 44.4); f.add(end); }
      const ga = new THREE.Mesh(new THREE.BoxGeometry(60, 28, 110), marble); ga.position.set(-5, 14, -120); f.add(ga);
      grp.add(f); solidBox(1, al(44.5) - 45, al(44.5) + 45, 1054, 1076, G0 + 154);
    }
    // ---------- Citigroup Center (279 m): on stilts, with its 45° roof ----------
    {
      const [x, z] = addrW(53.5, 430), buf = new L.MassBuf(), a = al(53.5);
      tower(buf, 53.5, 430, [[48, 48, 238]], st.OFFICE, 601, x, z, G0 + 35);
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z), alu = std(0xd4d6d8, 0.35, 0.6);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(48, 6, 68), alu); roof.position.set(0, 238 + 20, 0); roof.rotation.x = 45 * DEG; f.add(roof);
      const fillG = new THREE.BufferGeometry(); fillG.setAttribute("position", new THREE.Float32BufferAttribute([-24, 238, 24, 24, 238, 24, 24, 238, -24, -24, 238, -24, -24, 279, -24, 24, 279, -24], 3));
      fillG.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2]); fillG.computeVertexNormals();
      f.add(new THREE.Mesh(fillG, new THREE.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide })));
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const col = new THREE.Mesh(new THREE.BoxGeometry(sx ? 7 : 11, 36, sz ? 7 : 11), std(0xcfd1d3, 0.5, 0.3)); col.position.set(sx * 20.5, 18, sz * 20.5); f.add(col); }
      const core = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 36, 12), std(0xbfc2c4, 0.5)); core.position.y = 18; f.add(core);
      grp.add(f); solidBox(1, a - 24, a + 24, 406, 454, G0 + 279);
    }
    // ---------- Hudson Yards ----------
    {
      const parts = [[33.2, -1500, [[62, 80, 40, 0, 0, S().OFFICE], [46, 50, 335], [42, 44, 387]], 30], [34.4, -1660, [[46, 46, 308]], 35], [30.6, -1290, [[50, 60, 268]], 10], [30.8, -1420, [[44, 44, 280]], 15]];
      for (const [k, ac, T, sd] of parts) { const [x, z] = addrW(k, ac), buf = new L.MassBuf(); tower(buf, k, ac, T, S().GLASS, sd, x, z); massMesh(grp, buf, x, z); const d = T[T.length - 1]; solidBox(1, al(k) - d[0] / 2, al(k) + d[0] / 2, ac - d[1] / 2, ac + d[1] / 2, G0 + d[2]); }
      // the Edge: a triangular observation deck cantilevered off 30 Hudson Yards
      const [x, z] = addrW(33.2, -1500), f = gridFrame(x, z);
      const sh = new THREE.Shape(); sh.moveTo(-14, 0); sh.lineTo(14, 0); sh.lineTo(0, -24); sh.lineTo(-14, 0);
      const edge = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: false }), std(0x9fb0b8, 0.15, 0.8));
      edge.rotation.x = -Math.PI / 2; edge.position.set(0, 335, -23); f.add(edge); grp.add(f);
      // the Vessel: a copper honeycomb of stairs
      const [vx, vz] = addrW(33.0, -1370), vf = gridFrame(vx, vz), cop = std(0xa86a3c, 0.35, 0.85);
      const beam = new THREE.CylinderGeometry(0.35, 0.35, 1, 4), n = 16, rows = 8, im = new THREE.InstancedMesh(beam, cop, n * rows * 2);
      let c = 0;
      for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
        const y0 = r * 5.7, y1 = y0 + 5.7, r0 = 7.5 + y0 * 0.4, r1 = 7.5 + y1 * 0.4, a0 = (i / n) * TAU, a1 = a0 + s * (TAU / n);
        const p0 = V3(Math.cos(a0) * r0, y0, Math.sin(a0) * r0), p1 = V3(Math.cos(a1) * r1, y1, Math.sin(a1) * r1), d = p1.clone().sub(p0);
        _q.setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()); _m4.compose(p0.clone().addScaledVector(d, 0.5), _q, _s.set(1.6, d.length(), 1.6)); im.setMatrixAt(c++, _m4);
      }
      vf.add(im); grp.add(vf);
    }
    // ---------- World Trade Center ----------
    {
      const g = 2, [ce, cn] = L.local(40.7130, -74.0132), [cal, cac] = L.toGrid(g, ce, cn), [x, z] = L.toWorld(ce, cn), buf = new L.MassBuf();
      // podium
      L.addTier(buf, g, { a0: cal - 30.5, a1: cal + 30.5, c0: cac - 30.5, c1: cac + 30.5, h: 57 }, G0 - 1.5, x, z, 1776, L.codeOf(S().GRID));
      // the tapering square antiprism: eight glass triangles from a 61 m square to a 44 m square turned 45°
      const W = (a, c, y) => { const [e, n] = L.fromGrid(g, cal + a, cac + c); return [NY.ex + e - x, y, NY.ez - n - z]; };
      const yb = G0 + 57, yt = G0 + 417, h = 30.5, r = 31.1;
      const B = [W(-h, -h, yb), W(-h, h, yb), W(h, h, yb), W(h, -h, yb)], T = [W(-r, 0, yt), W(0, r, yt), W(r, 0, yt), W(0, -r, yt)];
      const code = L.codeOf(S().GLASS);
      const tri = (p0, p1, p2) => {
        const a = V3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), b = V3(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]), nrm = a.clone().cross(b).normalize();
        const mid = V3((p0[0] + p1[0] + p2[0]) / 3, 0, (p0[2] + p1[2] + p2[2]) / 3);
        if (nrm.x * mid.x + nrm.z * mid.z < 0) { return tri(p0, p2, p1); }
        const t = V3(-nrm.z, 0, nrm.x).normalize();
        const F = (p) => [p[0] * t.x + p[2] * t.z + 500, p[1] - G0, 1000, 417];
        buf.quad(p0, p1, p2, p2, nrm.x, nrm.y, nrm.z, F(p0), F(p1), F(p2), F(p2), 1776, code);
      };
      for (let i = 0; i < 4; i++) {
        const b0 = B[i], b1 = B[(i + 1) % 4];
        // the top vertex over this edge's midpoint
        const mx = (b0[0] + b1[0]) / 2, mz = (b0[2] + b1[2]) / 2;
        let best = 0, bd = 1e9; for (let k = 0; k < 4; k++) { const d = (T[k][0] - mx) ** 2 + (T[k][2] - mz) ** 2; if (d < bd) { bd = d; best = k; } }
        tri(b0, b1, T[best]);
        const tn = T[(best + 1) % 4], tp = T[(best + 3) % 4];
        const nxt = (tn[0] - b1[0]) ** 2 + (tn[2] - b1[2]) ** 2 < (tp[0] - b1[0]) ** 2 + (tp[2] - b1[2]) ** 2 ? tn : tp;
        tri(b1, nxt, T[best]);
      }
      buf.quad(T[0], T[1], T[2], T[3], 0, 1, 0, [0, 0, -1, 417], [0, 0, -1, 417], [0, 0, -1, 417], [0, 0, -1, 417], 1776, code);
      buf.quad(T[0], T[3], T[2], T[1], 0, 1, 0, [0, 0, -1, 417], [0, 0, -1, 417], [0, 0, -1, 417], [0, 0, -1, 417], 1776, code);
      massMesh(grp, buf, x, z);
      { const [ce2, cn2] = L.fromGrid(g, cal, cac), [a1, c1] = L.toGrid(1, ce2, cn2); (L.farExtra = L.farExtra || []).push({ a0: a1 - 26, a1: a1 + 26, c0: c1 - 26, c1: c1 + 26, h: 417, col: [0.45, 0.55, 0.62] }, { a0: a1 - 1.5, a1: a1 + 1.5, c0: c1 - 1.5, c1: c1 + 1.5, h: 541, col: [0.8, 0.8, 0.8] }); }
      const f = gridFrame(x, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.8, 6, 24), std(0xd0d4d8, 0.3, 0.9)); ring.rotation.x = Math.PI / 2; ring.position.y = 417 + 12; f.add(ring);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 124, 8), std(0xe0e3e6, 0.3, 0.9)); sp.position.y = 417 + 62; f.add(sp);
      const bm = glow(0, 0, 0); lights.push({ mat: bm, base: new THREE.Color(3, 3, 3), kind: "night" });
      const bc = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), bm); bc.position.y = 541; f.add(bc);
      grp.add(f);
      BOXES.push({ g, a0: cal - 30.5, a1: cal + 30.5, c0: cac - 30.5, c1: cac + 30.5, top: G0 + 417 }); solidCyl(x, z, 2.5, G0 + 541);
      // 3, 4 and 7 WTC, and the memorial pools
      for (const [lat, lon, w, d, hh, sd] of [[40.7114, -74.0115, 52, 52, 329, 3], [40.7104, -74.0119, 50, 54, 298, 4], [40.7134, -74.0121, 44, 70, 228, 7]]) {
        const [e, n] = L.local(lat, lon), [a, c] = L.toGrid(g, e, n), [tx, tz] = L.toWorld(e, n), b = new L.MassBuf();
        L.addTier(b, g, { a0: a - d / 2, a1: a + d / 2, c0: c - w / 2, c1: c + w / 2, h: hh }, G0 - 1.5, tx, tz, sd, L.codeOf(S().GLASS));
        massMesh(grp, b, tx, tz); BOXES.push({ g, a0: a - d / 2, a1: a + d / 2, c0: c - w / 2, c1: c + w / 2, top: G0 + hh });
      }
      const water = std(0x0b1418, 0.05, 0.6), granite = std(0x2b2d30, 0.6);
      for (const [lat, lon] of [[40.7116, -74.0137], [40.7110, -74.0129]]) {
        const [e, n] = L.local(lat, lon), [px, pz] = L.toWorld(e, n), pf = gridFrame(px, pz);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(62, 1.2, 62), granite); rim.position.y = 0.4; pf.add(rim);
        const pool = new THREE.Mesh(new THREE.BoxGeometry(58, 0.2, 58), water); pool.position.y = 1.05; pf.add(pool);
        const hole = new THREE.Mesh(new THREE.BoxGeometry(18, 0.25, 18), std(0x050607, 0.9)); hole.position.y = 1.1; pf.add(hole);
        grp.add(pf);
      }
    }
    // ---------- Woolworth Building (241 m) ----------
    {
      const g = 2, [e, n] = L.local(40.7124, -74.0083), [a, c] = L.toGrid(g, e, n), [x, z] = L.toWorld(e, n), buf = new L.MassBuf();
      L.addTier(buf, g, { a0: a - 30, a1: a + 30, c0: c - 34, c1: c + 34, h: 110 }, G0 - 1.5, x, z, 1913, L.codeOf(S().DECO));
      L.addTier(buf, g, { a0: a - 14, a1: a + 14, c0: c - 14, c1: c + 14, h: 205 }, G0 + 110, x, z, 1913, L.codeOf(S().DECO));
      massMesh(grp, buf, x, z);
      const f = gridFrame(x, z);
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(14, 30, 4), copper); pyr.rotation.y = Math.PI / 4; pyr.position.y = 205 + 15; f.add(pyr);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const pin = new THREE.Mesh(new THREE.ConeGeometry(1.4, 12, 4), copper); pin.position.set(sx * 12.5, 205 + 6, sz * 12.5); f.add(pin); }
      const lan = new THREE.Mesh(new THREE.ConeGeometry(2.2, 10, 8), copper); lan.position.y = 236 + 4; f.add(lan);
      grp.add(f); BOXES.push({ g, a0: a - 30, a1: a + 30, c0: c - 34, c1: c + 34, top: G0 + 110 }, { g, a0: a - 14, a1: a + 14, c0: c - 14, c1: c + 14, top: G0 + 241 });
    }
  }

  /* ======================= Statue of Liberty ======================= */
  function buildLiberty(grp) {
    const [x, z] = llW(40.68925, -74.04453), f = new THREE.Group();
    f.position.set(x, G0, z); f.rotation.y = -125 * DEG; // she faces the Narrows, south-east
    const granite = std(0xb9b1a2, 0.85), wall = std(0x8e8678, 0.9), cu = std(0x4f8f78, 0.6, 0.3, { flatShading: false });
    // Fort Wood: the eleven-pointed star
    const star = new THREE.Shape();
    for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU, r = i % 2 ? 46 : 70; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (i) star.lineTo(px, py); else star.moveTo(px, py); }
    const fort = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 9, bevelEnabled: false }), wall); fort.rotation.x = -Math.PI / 2; f.add(fort);
    // pedestal: stepped base, granite shaft, cornice, colonnade band
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(32, 6, 32), granite); b1.position.y = 9 + 3; f.add(b1);
    const pedG = new THREE.CylinderGeometry(19 / Math.SQRT2, 26 / Math.SQRT2, 26, 4, 1); pedG.rotateY(Math.PI / 4);
    const ped = new THREE.Mesh(pedG, granite); ped.position.y = 15 + 13; f.add(ped);
    const cor = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 22), granite); cor.position.y = 41 + 1.5; f.add(cor);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(17, 4, 17), granite); cap.position.y = 44 + 2; f.add(cap);
    // the statue (46 m to the torch): robe with folds, shoulders, head and crown, raised torch arm, tablet
    const y0 = 47.5, prof = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(t < 0.06 ? 6.4 : 6.2 - t * 3.0 + Math.sin(t * 3.0) * 0.6 - (t > 0.82 ? (t - 0.82) * 14 : 0), t * 28)); }
    const robeG = new THREE.LatheGeometry(prof, 40);
    const p = robeG.attributes.position;
    for (let i = 0; i < p.count; i++) { const px = p.getX(i), pz = p.getZ(i), py = p.getY(i), a = Math.atan2(pz, px), k = 1 + 0.06 * Math.sin(a * 9 + py * 0.15) + 0.03 * Math.sin(a * 23); p.setX(i, px * k); p.setZ(i, pz * k * 0.82); }
    robeG.computeVertexNormals();
    const robe = new THREE.Mesh(robeG, cu); robe.position.y = y0; f.add(robe);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 10), cu); sh.scale.set(1.25, 0.7, 0.9); sh.position.y = y0 + 27; f.add(sh);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 2.6, 10), cu); neck.position.y = y0 + 29.5; f.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), cu); head.scale.set(0.9, 1.15, 1.0); head.position.set(0, y0 + 32.2, -0.2); f.add(head);
    for (let i = 0; i < 7; i++) {
      const a = (-0.5 + i / 6) * Math.PI * 0.95, ray = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.4, 4), cu);
      ray.position.set(Math.sin(a) * 3.4, y0 + 34.2, -Math.cos(a) * 3.4); ray.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(Math.sin(a), 0.75, -Math.cos(a)).normalize()); f.add(ray);
    }
    const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 1.0, 16), cu); crownBand.position.y = y0 + 33.3; f.add(crownBand);
    // right arm up with the torch
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 12.8, 10), cu); arm.position.set(4.2, y0 + 33.5, 0.6); arm.rotation.z = -0.16; f.add(arm);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.9, 3, 12), std(0xc8a24a, 0.3, 0.9)); torch.position.set(5.3, y0 + 41, 0.7); f.add(torch);
    const flameM = new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.25, metalness: 0.9, emissive: new THREE.Color(0, 0, 0) });
    lights.push({ mat: flameM, base: new THREE.Color(2.6, 1.7, 0.6), kind: "emissive" });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.6, 10), flameM); flame.position.set(5.4, y0 + 44.3, 0.7); f.add(flame);
    // left arm and the tablet (JULY IV MDCCLXXVI)
    const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 7, 8), cu); fa.position.set(-4.1, y0 + 22, -0.6); fa.rotation.z = 0.5; f.add(fa);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 7.2, 4.1), cu); tab.position.set(-5.0, y0 + 21, -0.2); tab.rotation.z = 0.12; f.add(tab);
    f.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // floodlights at night
    const fl = glow(0, 0, 0); lights.push({ mat: fl, base: new THREE.Color(1.6, 1.5, 1.2), kind: "night" });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), fl); l.position.set(Math.cos(a) * 15, 41, Math.sin(a) * 15); f.add(l); }
    grp.add(f);
    solidCyl(x, z, 13, G0 + 46); solidCyl(x, z, 5.5, G0 + 47.5 + 34); solidCyl(x, z, 2, G0 + 47.5 + 46);
    LM.liberty = { x, z };
  }

  /* ======================= bridges ======================= */
  // a, b: the two main towers (lat, lon); side: side-span lengths (m); deck: road height above the water
  const BRIDGES = [
    { name: "Brooklyn Bridge", a: [40.70763, -73.99902], b: [40.70385, -73.99355], side: [283, 283], deck: 41, h: 84, w: 26, kind: "stone", color: 0x9b8f7c, cables: 4, stays: true, appr: [420, 380] },
    { name: "Manhattan Bridge", a: [40.70960, -73.99355], b: [40.70560, -73.98945], side: [222, 222], deck: 41, h: 102, w: 37, kind: "steel", color: 0x7d9cc0, cables: 4, appr: [380, 420] },
    { name: "Williamsburg Bridge", a: [40.71590, -73.97650], b: [40.71245, -73.96610], side: [181, 181], deck: 41, h: 101, w: 36, kind: "lattice", color: 0x8c3b3b, cables: 4, appr: [600, 500] },
    { name: "George Washington Bridge", a: [40.85090, -73.95020], b: [40.85345, -73.96260], side: [186, 198], deck: 65, h: 184, w: 36, kind: "lattice", color: 0x9ca3a8, cables: 4, appr: [300, 300] },
    { name: "Verrazzano-Narrows Bridge", a: [40.60820, -74.03735], b: [40.60545, -74.05275], side: [370, 370], deck: 69, h: 211, w: 32, kind: "steel", color: 0xa6adb3, cables: 4, appr: [500, 500] }
  ];
  function buildBridge(grp, B) {
    const [ax, az] = llW(B.a[0], B.a[1]), [bx, bz] = llW(B.b[0], B.b[1]);
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span;
    const f = new THREE.Group(); f.position.set((ax + bx) / 2, 0, (az + bz) / 2); f.rotation.y = Math.atan2(-uz, ux);
    const steel = std(B.color, 0.55, 0.45), deckM = std(0x2b2b2d, 0.8), cableM = std(0x5d646b, 0.5, 0.6), stone = std(B.color, 0.92);
    const half = span / 2, x0 = -half - B.side[0], x1 = half + B.side[1], D = B.deck;
    // deck with stiffening trusses and a lighter roadway
    const len = x1 - x0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 3, B.w), deckM); deck.position.set((x0 + x1) / 2, D - 1.5, 0); f.add(deck);
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(len, 7, 0.8), steel); tr.position.set((x0 + x1) / 2, D - 4.5, s * (B.w / 2 - 0.4)); f.add(tr); }
    const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 9.2, 0.5), steel, Math.ceil(len / 8) * 2);
    let ti = 0;
    for (let xx = x0; xx < x1 && ti < truss.count - 1; xx += 8) for (const s of [-1, 1]) { _q.setFromEuler(_e.set(0, 0, (Math.floor(xx / 8) % 2 ? 1 : -1) * 0.72)); _m4.compose(_p.set(xx, D - 4.5, s * (B.w / 2 - 0.4)), _q, _s.set(1, 1, 1)); truss.setMatrixAt(ti++, _m4); }
    truss.count = ti; f.add(truss);
    // approach ramps down to the street on land
    for (const [end, dir, L2] of [[x0, -1, B.appr[0]], [x1, 1, B.appr[1]]]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(L2, 2.5, B.w * 0.8), deckM);
      const slope = Math.atan2(D - L.GROUND, L2);
      ramp.position.set(end + dir * L2 / 2, (D + L.GROUND) / 2 - 1, 0); ramp.rotation.z = dir * -slope; f.add(ramp);
      for (let k = 1; k < 6; k++) { const px = end + dir * L2 * k / 6, py = D - (D - L.GROUND) * k / 6; const pier = new THREE.Mesh(new THREE.BoxGeometry(5, py, B.w * 0.6), B.kind === "stone" ? stone : steel); pier.position.set(px, py / 2, 0); f.add(pier); }
    }
    // towers
    for (const tx of [-half, half]) {
      if (B.kind === "stone") {
        // Brooklyn Bridge: granite towers with twin pointed arches over the roadway
        const base = new THREE.Mesh(new THREE.BoxGeometry(24, D - 1, B.w + 18), stone); base.position.set(tx, (D - 1) / 2 - 6, 0); f.add(base);
        for (const s of [-1, 0, 1]) { const pier = new THREE.Mesh(new THREE.BoxGeometry(22, 34, s ? 8 : 9), stone); pier.position.set(tx, D + 17, s * (B.w / 2 + 2)); f.add(pier); }
        const top = new THREE.Mesh(new THREE.BoxGeometry(22, B.h - D - 34, B.w + 20), stone); top.position.set(tx, D + 34 + (B.h - D - 34) / 2, 0); f.add(top);
        for (const s of [-1, 1]) { const arch = new THREE.Mesh(new THREE.ConeGeometry(B.w / 4, 10, 4, 1, true), stone); arch.rotation.y = Math.PI / 4; arch.position.set(tx, D + 37, s * B.w / 4); f.add(arch); }
        const cor = new THREE.Mesh(new THREE.BoxGeometry(25, 2.5, B.w + 23), stone); cor.position.set(tx, B.h - 1, 0); f.add(cor);
      } else {
        const legW = B.kind === "lattice" ? 9 : 7;
        for (const s of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, B.h + 10, legW * 1.3), steel); leg.position.set(tx, (B.h + 10) / 2 - 10, s * (B.w / 2 + 2)); f.add(leg);
        }
        const nStrut = B.kind === "lattice" ? 4 : 3;
        for (let i = 0; i < nStrut; i++) { const y = D + 8 + (B.h - D - 8) * (i + 1) / nStrut - 3; const st = new THREE.Mesh(new THREE.BoxGeometry(legW * 0.8, 5, B.w + 4), steel); st.position.set(tx, y, 0); f.add(st); }
        if (B.kind === "lattice") {
          // exposed steel latticework (the GWB never got its granite cladding)
          const lat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1, 0.6), steel, 96); let li = 0;
          for (const s of [-1, 1]) for (let y = 0; y < B.h - 8 && li < 92; y += 9) for (const d of [-1, 1]) {
            _q.setFromEuler(_e.set(d * 0.78, 0, 0)); _m4.compose(_p.set(tx + s * (legW / 2 + 0.3), y + 4.5, s * (B.w / 2 + 2)), _q, _s.set(1, 12.6, 1)); lat.setMatrixAt(li++, _m4);
          }
          lat.count = li; f.add(lat);
        }
        const sad = new THREE.Mesh(new THREE.BoxGeometry(legW + 2, 4, B.w + 10), steel); sad.position.set(tx, B.h + 1, 0); f.add(sad);
      }
      const fdn = new THREE.Mesh(new THREE.BoxGeometry(30, 14, B.w + 24), stone); fdn.position.set(tx, -4, 0); f.add(fdn);
    }
    // main cables: parabolic main span, straight back-stays to the anchorages, and the suspenders
    const zs = B.cables === 4 ? [-(B.w / 2 + 1.5), -(B.w / 2 - 2), B.w / 2 - 2, B.w / 2 + 1.5] : [-(B.w / 2 + 1.5), B.w / 2 + 1.5];
    const cableY = (xx) => {
      if (xx < -half) return D + 2 + (B.h - D - 2) * (xx - x0) / (-half - x0);
      if (xx > half) return D + 2 + (B.h - D - 2) * (x1 - xx) / (x1 - half);
      const t = xx / half; return D + 3 + (B.h - D - 3) * t * t;
    };
    const susp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1, 0.18), cableM, Math.ceil(len / 12) * zs.length);
    let si = 0;
    const neck = [];
    for (const zz of zs) {
      const pts = [];
      for (let xx = x0; xx <= x1 + 0.1; xx += len / 160) pts.push(V3(xx, cableY(xx), zz));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, B.h > 150 ? 0.9 : 0.6, 6), cableM); f.add(tube);
      for (let xx = x0 + 6; xx < x1 - 6; xx += 12) {
        if (Math.abs(Math.abs(xx) - half) < 6) continue;
        const top = cableY(xx), hgt = top - D; if (hgt < 1) continue;
        _m4.compose(_p.set(xx, D + hgt / 2, zz), _q.identity(), _s.set(1, hgt, 1)); if (si < susp.count) susp.setMatrixAt(si++, _m4);
      }
      if (Math.abs(zz) > B.w / 2) for (let xx = x0; xx <= x1; xx += 24) neck.push(xx, cableY(xx) + 1, zz);
    }
    susp.count = si; f.add(susp);
    // the Brooklyn Bridge's diagonal stays: the famous web
    if (B.stays) {
      const stays = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1, 0.16), cableM, 320); let k = 0;
      for (const tx of [-half, half]) for (const zz of zs) for (let i = 1; i <= 18; i++) for (const dir of [-1, 1]) {
        const ex = tx + dir * i * 9.5; if (ex < x0 || ex > x1) continue;
        const p0 = V3(tx, B.h - 6, zz), p1 = V3(ex, D + 0.5, zz), d = p1.clone().sub(p0);
        _q.setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()); _m4.compose(p0.clone().addScaledVector(d, 0.5), _q, _s.set(1, d.length(), 1));
        if (k < 320) stays.setMatrixAt(k++, _m4);
      }
      stays.count = k; f.add(stays);
    }
    // necklace lights along the cables
    const nm = glow(0, 0, 0); lights.push({ mat: nm, base: new THREE.Color(2.6, 2.4, 1.9), kind: "night" });
    const nl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 6, 4), nm, neck.length / 3);
    for (let i = 0; i < neck.length / 3; i++) { _m4.makeTranslation(neck[i * 3], neck[i * 3 + 1], neck[i * 3 + 2]); nl.setMatrixAt(i, _m4); }
    f.add(nl);
    f.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; } });
    grp.add(f);
    // collision: the deck and the towers
    const cs = Math.cos(f.rotation.y), sn = Math.sin(f.rotation.y), cx = f.position.x, cz = f.position.z;
    L.solids.push((x, z) => {
      const rx = x - cx, rz = z - cz, lx = rx * cs - rz * sn, lz = rx * sn + rz * cs;
      if (Math.abs(lz) > B.w / 2 + 12) return -Infinity;
      for (const tx of [-half, half]) if (Math.abs(lx - tx) < 13) return B.h + 2;
      if (lx > x0 && lx < x1 && Math.abs(lz) < B.w / 2) return D;
      return -Infinity;
    });
  }
  /** Queensboro Bridge: a steel cantilever truss hopping over Roosevelt Island. */
  function buildQueensboro(grp) {
    const [ax, az] = llW(40.76075, -73.96090), [bx, bz] = llW(40.75215, -73.94055);
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const f = new THREE.Group(); f.position.set(ax, 0, az); f.rotation.y = Math.atan2(-uz, ux);
    const steel = std(0x9b988a, 0.6, 0.4), deckM = std(0x2b2b2d, 0.8), D = 40, W = 30;
    const piers = [0, len * 0.39, len * 0.53, len];
    const topY = (x) => { let best = 0; for (const p of piers) best = Math.max(best, 48 * Math.max(0, 1 - Math.abs(x - p) / 210)); return D + 14 + best; };
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len + 300, 3, W), deckM); deck.position.set(len / 2, D - 1.5, 0); f.add(deck);
    const mem = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1, 0.9), steel, 2000); let k = 0;
    const put = (p0, p1) => { const d = p1.clone().sub(p0), L2 = d.length(); if (L2 < 0.1 || k >= 2000) return; _q.setFromUnitVectors(V3(0, 1, 0), d.normalize()); _m4.compose(p0.clone().add(p1).multiplyScalar(0.5), _q, _s.set(1, L2, 1)); mem.setMatrixAt(k++, _m4); };
    for (const s of [-1, 1]) {
      const zz = s * W / 2;
      for (let x = -150; x < len + 150; x += 12) {
        const a = V3(x, D, zz), b = V3(x + 12, D, zz), ta = V3(x, topY(x), zz), tb = V3(x + 12, topY(x + 12), zz);
        put(a, b); put(ta, tb); put(a, ta); put(a, tb);
      }
    }
    mem.count = k; f.add(mem);
    for (const p of piers) for (const s of [-1, 1]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(10, topY(p) + 16, 6), std(0x8f8a7e, 0.85)); tw.position.set(p, (topY(p) + 16) / 2 - 6, s * (W / 2 + 1)); f.add(tw);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(3, 12, 4), steel); fin.position.set(p, topY(p) + 16, s * (W / 2 + 1)); f.add(fin);
    }
    const cs = Math.cos(f.rotation.y), sn = Math.sin(f.rotation.y);
    L.solids.push((x, z) => { const rx = x - ax, rz = z - az, lx = rx * cs - rz * sn, lz = rx * sn + rz * cs; if (Math.abs(lz) > W / 2 + 2 || lx < -150 || lx > len + 150) return -Infinity; for (const p of piers) if (Math.abs(lx - p) < 6) return topY(p) + 10; return D; });
    grp.add(f);
  }

  /* ======================= Times Square ======================= */
  function buildTimesSquare(grp) {
    const [ce, cn] = L.addr(45.3, -560), [cx, cz] = L.toWorld(ce, cn);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: "attribute float seed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = seed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform float uTime; varying vec2 vUv; varying float vS;",
        "float h(float x){ return fract(sin(x * 91.3) * 43758.5); }",
        "vec3 hue(float t){ return clamp(abs(fract(t + vec3(0.0, 0.66, 0.33)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }",
        "void main(){",
        "  float slot = floor(uTime / (6.0 + h(vS) * 6.0) + vS * 7.0);",       // each screen cycles through ads
        "  float k = h(slot + vS);",
        "  vec3 a = hue(k), b = hue(k + 0.4 + h(slot) * 0.3);",
        "  vec2 p = vUv;",
        "  vec3 c = mix(a, b, smoothstep(0.2, 0.8, p.y + 0.15 * sin(p.x * 6.0 + uTime * (0.5 + k))));",
        "  float rows = floor(p.y * 6.0); float txt = step(0.55, h(rows + slot * 3.1)) * step(0.15, fract(p.y * 6.0)) * step(fract(p.y * 6.0), 0.75);",
        "  float glyph = step(0.4, h(floor(p.x * 28.0) + rows * 13.0 + slot));",
        "  c = mix(c * 0.55, vec3(1.0), txt * glyph * step(0.08, p.x) * step(p.x, 0.92) * 0.85);",
        "  float logo = smoothstep(0.24, 0.22, length((p - vec2(0.5 + 0.25 * sin(slot), 0.45)) * vec2(1.0, 0.7)));",
        "  c = mix(c, hue(k + 0.7) * 1.2, logo * step(0.5, h(slot * 1.7)));",
        "  float frame = step(0.02, p.x) * step(p.x, 0.98) * step(0.03, p.y) * step(p.y, 0.97);",
        "  gl_FragColor = vec4(c * frame * 2.2 + vec3(0.02) * (1.0 - frame), 1.0);",
        "}"
      ].join("\n")
    });
    const pos = [], uv = [], seed = [], idx = [];
    let n = 0, sd = 1;
    for (const b of L.buildings) {
      const d = Math.hypot(b.x - cx, b.z - cz);
      if (d > 230 || b.g !== 1) continue;
      const t = b.tiers[0];
      const cs = [[t.a0, t.c0], [t.a0, t.c1], [t.a1, t.c1], [t.a1, t.c0]].map(([a, c]) => L.toWorld(...L.fromGrid(1, a, c)));
      for (let i = 0; i < 4; i++) {
        const p0 = cs[i], p1 = cs[(i + 1) % 4], mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        let nx = -(p1[1] - p0[1]), nz = p1[0] - p0[0]; const Ln = Math.hypot(nx, nz); nx /= Ln; nz /= Ln;
        if (nx * (mx - b.x) + nz * (mz - b.z) < 0) { nx = -nx; nz = -nz; }
        const toC = [cx - mx, cz - mz], dl = Math.hypot(toC[0], toC[1]);
        if ((nx * toC[0] + nz * toC[1]) / dl < 0.35 || Ln < 10) continue;
        let y = 7 + (sd % 3) * 2;
        for (let s = 0; s < 3 && y < Math.min(t.h - 4, 80); s++) {
          const w = Math.min(Ln * 0.86, 12 + ((sd * 7) % 20)), hh = 8 + ((sd * 13) % 16);
          if (y + hh > t.h) break;
          const tx = (p1[0] - p0[0]) / Ln, tz = (p1[1] - p0[1]) / Ln, ox = mx + nx * 0.6, oz = mz + nz * 0.6;
          const v = [[-w / 2, y], [w / 2, y], [w / 2, y + hh], [-w / 2, y + hh]];
          for (const [a, yy] of v) { pos.push(ox + tx * a - cx, G0 + yy, oz + tz * a - cz); }
          uv.push(0, 0, 1, 0, 1, 1, 0, 1); for (let q = 0; q < 4; q++) seed.push(sd);
          // face the screens outward whatever the winding
          idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2);
          n += 4; sd++; y += hh + 2;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1)); g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.position.set(cx, 0, cz); grp.add(m);
    LM.times = { mat, count: sd };
  }

  /* ======================= Central Park's trees ======================= */
  function buildParkTrees(grp) {
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 4, 4, 1, true); trunk.translate(0, 2, 0);
    const crown = new THREE.IcosahedronGeometry(1, 0); crown.translate(0, 1.6, 0);
    const tG = new THREE.BufferGeometry();
    const mergeG = (list) => { const g = RJ.castle.util.merge(list.map((x) => x.toNonIndexed ? x.clone() : x)); return g; };
    // canopy and trunk as one instanced geometry with vertex colours
    const cols = [];
    const t2 = trunk.toNonIndexed(), c2 = crown.toNonIndexed();
    for (let i = 0; i < t2.attributes.position.count; i++) cols.push(0.3, 0.24, 0.18);
    const cs = 4.6; c2.scale(cs, cs * 0.85, cs); c2.translate(0, 2.2, 0);
    for (let i = 0; i < c2.attributes.position.count; i++) cols.push(1, 1, 1);
    const P = new Float32Array((t2.attributes.position.count + c2.attributes.position.count) * 3); P.set(t2.attributes.position.array, 0); P.set(c2.attributes.position.array, t2.attributes.position.count * 3);
    tG.setAttribute("position", new THREE.BufferAttribute(P, 3)); tG.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); tG.computeVertexNormals();
    const mat = std(0xffffff, 0.9, 0, { vertexColors: true, flatShading: true });
    const water = [[91, -420, 395, 295], [75.2, -425, 165, 105], [77.3, -555, 85, 70], [79.6, -330, 70, 26], [106.6, -125, 150, 105], [60.6, -85, 95, 38], [74.2, -62, 48, 24], [101.2, -700, 60, 38]];
    const lawn = [[82.6, -360, 180, 110], [67.6, -500, 120, 115], [99.2, -470, 170, 190]];
    const inE = (k, ac, E, pad) => { for (const q of E) { const a = (al(k) - al(q[0])) / (q[2] + pad), c = (ac - q[1]) / (q[3] + pad); if (a * a + c * c < 1) return true; } return false; };
    const pts = [], r = (() => { let a = 1234567; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
    for (let k = 59.2; k < 109.8; k += 0.19) for (let ac = -832; ac < -8; ac += 15) {
      const kk = k + (r() - 0.5) * 0.15, cc = ac + (r() - 0.5) * 12;
      if (inE(kk, cc, water, 8) || inE(kk, cc, lawn, -5) || r() < 0.2) continue;
      const ia = Math.min(al(kk) - al(59), al(110) - al(kk)), ic = Math.min(cc + 840, -cc);
      if (Math.abs(Math.min(ia, ic) - 75) < 8) continue;
      pts.push([kk, cc]);
    }
    const im = new THREE.InstancedMesh(tG, mat, pts.length), c = new THREE.Color();
    const greens = [0x2f5222, 0x3a5f26, 0x284a1d, 0x45682b, 0x233f18, 0x52702f];
    pts.forEach(([k, ac], i) => {
      const [x, z] = addrW(k, ac), s = 0.75 + r() * 0.7;
      _m4.compose(_p.set(x, G0, z), _q.setFromEuler(_e.set(0, r() * TAU, 0)), _s.set(s, s * (0.85 + r() * 0.4), s)); im.setMatrixAt(i, _m4);
      im.setColorAt(i, c.setHex(greens[i % greens.length]).multiplyScalar(0.85 + r() * 0.3));
    });
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.layers.set(L.NEAR);
    grp.add(im);
    LM.parkTrees = pts.length;
  }

  /* ======================= build + per-frame ======================= */
  L.buildLandmarks = function (grp) {
    NY = RJ.world.gen.nyc; G0 = L.GROUND;
    const t0 = performance.now();
    const tryB = (nm, fn) => { try { fn(); } catch (e) { console.error("NYC landmark failed: " + nm, e); } };
    tryB("towers", () => buildTowers(grp));
    tryB("liberty", () => buildLiberty(grp));
    for (const B of BRIDGES) tryB(B.name, () => buildBridge(grp, B));
    tryB("queensboro", () => buildQueensboro(grp));
    tryB("times", () => buildTimesSquare(grp));
    tryB("trees", () => buildParkTrees(grp));
    // collision for the landmark boxes
    L.solids.push((x, z) => {
      let h = -Infinity; const [e, n] = L.toLocalXZ(x, z);
      for (const b of BOXES) { const [a, c] = L.toGrid(b.g, e, n); if (a > b.a0 && a < b.a1 && c > b.c0 && c < b.c1 && b.top > h) h = b.top; }
      for (const c of CYL) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r && c.top > h) h = c.top;
      return h;
    });
    L.stats.landmarkMs = Math.round(performance.now() - t0);
  };
  L.updateLandmarks = function (dt, cam) {
    const night = L.night || 0;
    for (const l of lights) {
      if (l.kind === "emissive") l.mat.emissive.copy(l.base).multiplyScalar(0.25 + night);
      else l.mat.color.copy(l.base).multiplyScalar(l.kind === "esb" ? night * 1.2 : night);
    }
    if (LM.times) LM.times.mat.uniforms.uTime.value += dt;
  };
  L.BRIDGES = BRIDGES;
})(window.RJ);
