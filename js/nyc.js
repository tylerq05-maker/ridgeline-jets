/* Jet City — New York City at 1:1.
 * Real coastlines come from terrain-gen.js (gen.nyc: lat/lon shorelines rasterised into a signed-distance
 * field). This file lays the real street grids over them (Manhattan's 29° Commissioners' grid with its true
 * avenue spacing and wide crosstown streets, Broadway's diagonal, an irregular downtown, and the Brooklyn,
 * Queens, Jersey and Bronx grids), fills every block with lots and buildings whose heights and styles follow
 * the real neighbourhoods, and draws them with a procedural facade shader: every window, mullion, spandrel,
 * sill, storefront and lit room is computed per pixel from the building's own parameters, so facades stay
 * crisp from 5 m away and resolve smoothly (no shimmer) from 20 km away. Near the camera, tiles stream in
 * real geometry: cornices, parapets, water towers, HVAC plant, bulkheads, antennas, fire escapes, awnings,
 * street lights, signals, street trees, parked cars, and moving traffic.
 * Landmarks and bridges are in nyc-landmarks.js. */
(function (RJ) {
  "use strict";
  const NYC = (RJ.nyc = { ready: false });
  const V3 = RJ.V3, DEG = Math.PI / 180;
  const GROUND = 4.0; // street level (terrain-gen keeps all NYC land at 4 m)
  NYC.GROUND = GROUND;
  let NY = null, RAS = null;

  /* ======================= helpers ======================= */
  const fract = (x) => x - Math.floor(x);
  const jit = (i) => fract(i * 0.6180339887) * 2 - 1; // identical in JS and GLSL (integer i, small range)
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const local = (lat, lon) => NY.toLocal(lat, lon);
  NYC.local = local;
  NYC.toWorld = (e, n) => [NY.ex + e, NY.ez - n];
  NYC.toLocalXZ = (x, z) => [x - NY.ex, NY.ez - z];

  /* ======================= street grids ======================= */
  // ang: avenue direction, degrees clockwise from true north. Lines of constant `al` (along) are the cross
  // streets; lines of constant `ac` (across) are the avenues.
  const GR = [];
  function defGrid(id, o) {
    const a = o.ang * DEG;
    o.id = id; o.Ae = Math.sin(a); o.An = Math.cos(a); o.Ce = Math.cos(a); o.Cn = -Math.sin(a);
    GR[id] = o;
  }
  // Manhattan avenues (metres across from Fifth Avenue, east positive) and widths
  const AVES = [-2150, -1890, -1650, -1380, -1110, -840, -560, -280, 0, 125, 250, 375, 560, 765, 970, 1170, 1420];
  const AVEW = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 42, 30, 30, 30, 30, 30, 30];
  const AVENAME = ["", "12th Ave", "11th Ave", "10th Ave", "9th Ave", "8th Ave", "7th Ave", "6th Ave", "5th Ave", "Madison Ave", "Park Ave", "Lexington Ave", "3rd Ave", "2nd Ave", "1st Ave", "York Ave", ""];
  const MAJOR = [14, 23, 34, 42, 57, 59, 72, 79, 86, 96, 110, 116, 125, 135, 145, 155, 165, 181];
  const ST = 80.4; // Manhattan street spacing: twenty blocks to the mile
  // Broadway (street number, across) in the main grid
  const BWAY = [[-60, 210], [0, 175], [10, 160], [14, 150], [17, 160], [20, 128], [22, 57], [23.6, 0], [34, -280], [45, -560], [59, -840], [72, -1110], [96, -1290], [110, -1330], [125, -1440], [145, -1500], [168, -1560], [200, -1520]];
  function initGrids() {
    const bh = local(40.6928, -73.9903), lic = local(40.7447, -73.9485), hob = local(40.7440, -74.0320), bx = local(40.8200, -73.9200);
    defGrid(1, { name: "manhattan", ang: 29, oe: 0, on: 0, list: true, sw: 4.6 });
    defGrid(2, { name: "downtown", ang: 29, oe: 0, on: 0, sA: 96, jA: 22, sC: 160, jC: 40, wS: 15, wA: 20, sw: 3.8 });
    defGrid(3, { name: "brooklyn", ang: 21, oe: bh[0], on: bh[1], sA: 82, jA: 4, sC: 235, jC: 20, wS: 17, wA: 26, sw: 4.2 });
    defGrid(4, { name: "queens", ang: 45, oe: lic[0], on: lic[1], sA: 80, jA: 6, sC: 200, jC: 25, wS: 17, wA: 25, sw: 4.2 });
    defGrid(5, { name: "jersey", ang: 9, oe: hob[0], on: hob[1], sA: 78, jA: 3, sC: 125, jC: 8, wS: 15, wA: 18, sw: 3.8 });
    defGrid(6, { name: "bronx", ang: 15, oe: bx[0], on: bx[1], sA: 85, jA: 6, sC: 230, jC: 25, wS: 17, wA: 26, sw: 4.2 });
  }
  const toGrid = (g, e, n) => { const G = GR[g], de = e - G.oe, dn = n - G.on; return [de * G.Ae + dn * G.An, de * G.Ce + dn * G.Cn]; };
  const fromGrid = (g, al, ac) => { const G = GR[g]; return [G.oe + al * G.Ae + ac * G.Ce, G.on + al * G.An + ac * G.Cn]; };
  NYC.toGrid = toGrid; NYC.fromGrid = fromGrid;
  /** Manhattan address → local [e, n]: street number (34 = 34th St) and across metres from Fifth Ave. */
  NYC.addr = (street, ac) => fromGrid(1, (street - 34) * ST, ac);
  NYC.ave = (i) => AVES[i];
  /** Landmass under local (e, n): index into gen.nyc polygons + 1 (0 = water). */
  function ownerAt(e, n) {
    const i = Math.floor((e - RAS.e0) / RAS.cs), j = Math.floor((n - RAS.n0) / RAS.cs);
    if (i < 0 || j < 0 || i >= RAS.nx || j >= RAS.ny) return 0;
    return RAS.owner[j * RAS.nx + i];
  }
  const OWN = {};
  /** Which street grid governs (e, n): 0 = none. */
  function gridAt(e, n) {
    const o = ownerAt(e, n);
    if (o === OWN.manhattan) {
      const [al, ac] = toGrid(1, e, n);
      return al >= (14 - 34) * ST || (al >= (1 - 34) * ST && ac > -300) ? 1 : 2;
    }
    if (o === OWN.brooklynQueens) return n > -1210 ? 4 : 3;
    if (o === OWN.newJersey) return 5;
    if (o === OWN.bronx) return 6;
    return 0;
  }
  NYC.gridAt = gridAt;
  /** Street lines on one axis of grid g between lo and hi: [{p: centre, w: width}] sorted. */
  function lines(g, axis, lo, hi) {
    const G = GR[g], out = [];
    if (g === 1) {
      if (axis === "A") { for (let j = Math.floor(lo / ST) - 1; j <= Math.ceil(hi / ST) + 1; j++) out.push({ p: j * ST, w: MAJOR.includes(j + 34) ? 30 : 18, k: j + 34 }); }
      else for (let i = 0; i < AVES.length; i++) out.push({ p: AVES[i], w: AVEW[i], k: i });
      return out;
    }
    const S = axis === "A" ? G.sA : G.sC, J = axis === "A" ? G.jA : G.jC, W = axis === "A" ? G.wS : G.wA;
    for (let i = Math.floor(lo / S) - 2; i <= Math.ceil(hi / S) + 2; i++) out.push({ p: i * S + jit(i) * J, w: W, k: i });
    return out;
  }
  /** Distance from Manhattan grid point (k = street number, ac) to Broadway. */
  function bwayDist(al, ac) {
    let best = 1e9;
    for (let i = 0; i + 1 < BWAY.length; i++) {
      const ax = (BWAY[i][0] - 34) * ST, ay = BWAY[i][1], bx = (BWAY[i + 1][0] - 34) * ST, by = BWAY[i + 1][1];
      const dx = bx - ax, dy = by - ay, t = clamp(((al - ax) * dx + (ac - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      best = Math.min(best, Math.hypot(al - ax - dx * t, ac - ay - dy * t));
    }
    return best;
  }

  /* ======================= parks and reserved ground ======================= */
  const RES = []; // circles kept free for landmarks: [e, n, r]
  NYC.reserve = (e, n, r) => RES.push([e, n, r]);
  let PARKS_M = []; // Manhattan grid rects [al0, al1, ac0, ac1]
  let PARKS_L = []; // local ellipses [e, n, ra, rb]
  function initParks() {
    const r = (k0, k1, c0, c1) => [(k0 - 34) * ST, (k1 - 34) * ST, c0, c1];
    PARKS_M = [r(59, 110, -840, 0), r(40, 42, -265, -140), r(23, 26, 15, 110), r(14, 17, 168, 232), r(106, 111, -280, -60), r(7, 10, 820, 960)];
    const ws = local(40.7308, -73.9973), bat = local(40.7033, -74.0170);
    PARKS_L = [[ws[0], ws[1], 150, 120], [bat[0], bat[1], 330, 230]];
  }
  function inPark(e, n, g, al, ac, sdf) {
    if (g === 1 || g === 2) {
      const [a, c] = g === 1 ? [al, ac] : toGrid(1, e, n);
      for (const p of PARKS_M) if (a > p[0] - 6 && a < p[1] + 6 && c > p[2] - 6 && c < p[3] + 6) return true;
      // Riverside Park and the Hudson River Park greenway along the west side
      if (sdf < 140 && c < -1500 && a > (70 - 34) * ST && a < (155 - 34) * ST) return true;
    }
    if (sdf < 28) return true; // waterfront promenades and bulkheads
    for (const p of PARKS_L) { const a = (e - p[0]) / p[2], b = (n - p[1]) / p[3]; if (a * a + b * b < 1) return true; }
    if (NY.inProspect(e, n)) return true;
    for (const q of RES) if ((e - q[0]) ** 2 + (n - q[1]) ** 2 < q[2] * q[2]) return true;
    return false;
  }

  /* ======================= neighbourhoods: heights and styles ======================= */
  // styles (match the facade shader): 0 glass curtain wall · 1 pre-war masonry · 2 brownstone row · 3 modern
  // office (ribbon windows) · 4 art deco · 5 cast iron · 6 tenement brick · 7 concrete grid
  const S = { GLASS: 0, PREWAR: 1, BROWN: 2, OFFICE: 3, DECO: 4, CAST: 5, TENE: 6, GRID: 7 };
  NYC.STYLE = S;
  let ZC = {}; // zone centres (local)
  function initZones() {
    ZC = { fidi: local(40.7075, -74.0105), soho: local(40.7233, -74.0012), dtbk: local(40.6925, -73.9875), wbw: local(40.7160, -73.9640),
      lic: local(40.7470, -73.9455), jc: local(40.7195, -74.0345), hob: local(40.7440, -74.0300) };
  }
  const near = (e, n, c, r) => (e - c[0]) ** 2 + (n - c[1]) ** 2 < r * r;
  /** Neighbourhood profile for a block in grid g. */
  function zoneFor(g, e, n, al, ac) {
    if (g === 1) {
      const k = al / ST + 34;
      if (k >= 29 && k <= 38 && ac < -1250 && ac > -1800) return Z.hy;
      if (k >= 39 && k <= 60 && ac > -900 && ac < 620) return Z.midtown;
      if (k >= 39 && k <= 60 && ac >= 620) return Z.eastmid;
      if (k >= 39 && k <= 60) return Z.hk;
      if (k >= 14 && k < 39) return Z.midlow;
      if (k >= 60 && k < 110) return ac > -100 ? Z.ues : Z.uws;
      if (k >= 110 && k < 158) return Z.harlem;
      if (k >= 158) return Z.heights;
      return Z.village;
    }
    if (g === 2) {
      if (near(e, n, ZC.fidi, 820)) return Z.fidi;
      if (near(e, n, ZC.soho, 650)) return Z.soho;
      const [a, c] = toGrid(1, e, n);
      return c > 450 ? Z.les : Z.village;
    }
    if (g === 3) return near(e, n, ZC.dtbk, 850) ? Z.dtbk : near(e, n, ZC.wbw, 650) ? Z.wbw : Z.bk;
    if (g === 4) return near(e, n, ZC.lic, 950) ? Z.lic : Z.qns;
    if (g === 5) return near(e, n, ZC.jc, 1250) ? Z.jc : near(e, n, ZC.hob, 1300) ? Z.hob : Z.njres;
    return Z.bx;
  }
  const P = (r, a, b, pw) => a + Math.pow(r(), pw || 1) * (b - a);
  // a zone: big = chance a block side becomes one large building; endW = avenue-corner lot widths; yard = rear
  // yard fraction; mid(r) = middle lot width (row = brownstone rows); h(r, ave) = height (m); tall = towers allowed
  const Z = {
    midtown: { big: 0.45, endW: [22, 40], yard: 0.0, midW: [14, 45], h: (r, ave) => ave ? P(r, 70, 300, 1.25) : P(r, 45, 230, 1.6), tall: true, deco: 0.3 },
    eastmid: { big: 0.3, endW: [22, 38], yard: 0.08, midW: [12, 35], h: (r, ave) => ave ? P(r, 50, 240, 1.5) : P(r, 28, 160, 2.0), tall: true, deco: 0.2 },
    hy: { big: 0.6, endW: [30, 60], yard: 0, midW: [25, 60], h: (r, ave) => P(r, 60, 280, 1.2), tall: true },
    fidi: { big: 0.4, endW: [18, 34], yard: 0, midW: [12, 34], h: (r, ave) => P(r, 50, 260, 1.35), tall: true, deco: 0.35 },
    hk: { big: 0.08, endW: [18, 30], yard: 0.16, rowP: 0.55, rowW: 6.6, rowN: [3, 8], midW: [8, 22], h: (r, ave) => ave ? P(r, 18, 60, 1.5) + (r() < 0.06 ? 120 : 0) : P(r, 14, 24), tene: 0.5 },
    midlow: { big: 0.15, endW: [18, 32], yard: 0.06, midW: [9, 30], h: (r, ave) => ave ? P(r, 38, 110, 1.4) + (r() < 0.06 ? 110 : 0) : P(r, 22, 75, 1.6), cast: 0.25 },
    ues: { big: 0.06, endW: [22, 34], yard: 0.2, rowP: 0.6, rowW: 6.6, rowN: [3, 9], midW: [10, 26], h: (r, ave) => ave ? P(r, 38, 92, 1.3) : P(r, 15, 50, 2.5), prewar: 0.75 },
    uws: { big: 0.06, endW: [22, 34], yard: 0.2, rowP: 0.62, rowW: 6.6, rowN: [3, 9], midW: [10, 26], h: (r, ave) => ave ? P(r, 36, 85, 1.3) : P(r, 15, 48, 2.5), prewar: 0.8 },
    harlem: { big: 0.05, endW: [18, 30], yard: 0.22, rowP: 0.7, rowW: 6.1, rowN: [4, 10], midW: [10, 22], h: (r, ave) => ave ? P(r, 16, 38) + (r() < 0.05 ? 30 : 0) : P(r, 13, 18), tene: 0.55 },
    heights: { big: 0.1, endW: [20, 32], yard: 0.15, midW: [18, 40], h: (r, ave) => P(r, 18, 38), prewar: 0.6, tene: 0.4 },
    village: { big: 0.06, endW: [14, 26], yard: 0.15, rowP: 0.45, rowW: 6.4, rowN: [2, 6], midW: [8, 22], h: (r, ave) => ave ? P(r, 16, 45, 1.5) : P(r, 12, 26), tene: 0.45 },
    soho: { big: 0.05, endW: [14, 26], yard: 0.05, midW: [8, 22], h: (r, ave) => P(r, 16, 34), cast: 0.8 },
    les: { big: 0.08, endW: [14, 26], yard: 0.12, midW: [7, 18], h: (r, ave) => P(r, 15, 26) + (r() < 0.05 ? P(r, 40, 90) : 0), tene: 0.75 },
    dtbk: { big: 0.3, endW: [22, 40], yard: 0.05, midW: [14, 36], h: (r, ave) => P(r, 30, 220, 1.6), tall: true, deco: 0.1 },
    wbw: { big: 0.3, endW: [22, 40], yard: 0.05, midW: [14, 36], h: (r, ave) => P(r, 18, 130, 1.8), tall: true },
    bk: { big: 0.03, endW: [16, 28], yard: 0.25, rowP: 0.85, rowW: 6.0, rowN: [8, 18], midW: [14, 30], h: (r, ave) => ave ? P(r, 13, 24) : P(r, 9, 14), tene: 0.4 },
    lic: { big: 0.45, endW: [25, 45], yard: 0.05, midW: [15, 40], h: (r, ave) => P(r, 20, 210, 1.6), tall: true },
    qns: { big: 0.05, endW: [16, 28], yard: 0.25, rowP: 0.75, rowW: 6.0, rowN: [8, 16], midW: [14, 28], h: (r, ave) => ave ? P(r, 12, 24) : P(r, 9, 13), tene: 0.4 },
    jc: { big: 0.4, endW: [25, 45], yard: 0.05, midW: [15, 40], h: (r, ave) => P(r, 30, 240, 1.5), tall: true },
    hob: { big: 0.04, endW: [16, 26], yard: 0.22, rowP: 0.7, rowW: 6.0, rowN: [5, 12], midW: [12, 24], h: (r, ave) => ave ? P(r, 14, 28) : P(r, 12, 17), tene: 0.4 },
    njres: { big: 0.04, endW: [16, 26], yard: 0.25, rowP: 0.75, rowW: 6.0, rowN: [8, 16], midW: [14, 28], h: (r, ave) => P(r, 9, 16), tene: 0.3 },
    bx: { big: 0.1, endW: [20, 34], yard: 0.15, midW: [16, 36], h: (r, ave) => P(r, 15, 34) + (r() < 0.06 ? 30 : 0), prewar: 0.5, tene: 0.5 }
  };
  for (const k in Z) Z[k].name = k;
  function styleFor(z, h, r, row, ave) {
    if (row) return h > 17 && r() < 0.35 ? S.TENE : S.BROWN;
    if (z.cast && h < 45 && r() < z.cast) return S.CAST;
    if (h >= 150) { const x = r(); return x < 0.58 ? S.GLASS : x < 0.82 ? S.OFFICE : (z.deco ? S.DECO : S.GLASS); }
    if (h >= 60) { const x = r(); if (z.deco && x < z.deco) return S.DECO; return x < 0.4 ? S.PREWAR : x < 0.68 ? S.OFFICE : x < 0.93 ? S.GLASS : S.GRID; }
    if (h >= 26) { const x = r(); if (z.prewar && x < z.prewar) return S.PREWAR; if (z.tene && x < z.tene + (z.prewar || 0)) return S.TENE; return x < 0.55 ? S.PREWAR : x < 0.75 ? S.OFFICE : x < 0.9 ? S.TENE : S.GLASS; }
    if (z.tene && r() < z.tene) return S.TENE;
    return r() < 0.6 ? S.PREWAR : r() < 0.5 ? S.TENE : S.OFFICE;
  }
  // floor height and bay width (m) per style
  const FLOOR = [4.0, 3.1, 3.4, 3.9, 3.6, 4.6, 3.0, 4.4], BAY = [1.5, 3.0, 2.2, 1.5, 2.6, 3.4, 2.4, 3.2];

  /* ======================= generation ======================= */
  const BLD = []; // every building: {x, z, ang, tiers, h, style, seed, tile, g, row}
  NYC.buildings = BLD;
  const RANGE = { borough: 7200 }; // how far from the ESB the outer boroughs get buildings
  function gridExtent(g) {
    // bounding box in grid coordinates of all raster cells governed by g (within range)
    let a0 = 1e9, a1 = -1e9, c0 = 1e9, c1 = -1e9;
    for (let j = 0; j < RAS.ny; j += 2) for (let i = 0; i < RAS.nx; i += 2) {
      const e = RAS.e0 + (i + 0.5) * RAS.cs, n = RAS.n0 + (j + 0.5) * RAS.cs;
      if (g > 2 && e * e + n * n > RANGE.borough * RANGE.borough) continue;
      if (!RAS.owner[j * RAS.nx + i] || gridAt(e, n) !== g) continue;
      const [a, c] = toGrid(g, e, n);
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    return a0 < a1 ? [a0 - 100, a1 + 100, c0 - 100, c1 + 100] : null;
  }
  /** Split one block into lots: avenue-corner buildings, then two rows facing the streets with a rear-yard gap. */
  function lotsFor(z, A0, A1, C0, C1, r) {
    const D = A1 - A0, W = C1 - C0, out = [];
    if (W < 9 || D < 9) return out;
    if (z.big && r() < z.big) {
      const n = W > 120 && r() < 0.6 ? 2 : 1;
      for (let i = 0; i < n; i++) out.push({ a0: A0, a1: A1, c0: C0 + (W / n) * i + (i ? 3 : 0), c1: C0 + (W / n) * (i + 1), ave: true, big: true });
      return out;
    }
    let cL = C0, cR = C1;
    if (W > 46) {
      const wl = clamp(P(r, z.endW[0], z.endW[1]), 12, W * 0.42), wr = clamp(P(r, z.endW[0], z.endW[1]), 12, W * 0.42);
      out.push({ a0: A0, a1: A1, c0: C0, c1: C0 + wl, ave: true });
      out.push({ a0: A0, a1: A1, c0: C1 - wr, c1: C1, ave: true });
      cL = C0 + wl; cR = C1 - wr;
    }
    const yard = D > 38 ? D * (z.yard || 0) : 0, dr = (D - yard) / 2;
    for (const [a0, a1] of [[A0, A0 + dr], [A1 - dr, A1]]) {
      let c = cL;
      while (cR - c > 5) {
        const row = !!z.rowP && r() < z.rowP;
        let w = row ? z.rowW * Math.round(P(r, z.rowN[0], z.rowN[1])) : P(r, z.midW[0], z.midW[1]);
        if (cR - c - w < 6) w = cR - c;
        out.push({ a0, a1, c0: c, c1: Math.min(cR, c + w), row });
        c += w;
      }
    }
    return out;
  }
  /** Massing tiers for a building: [{a0, a1, c0, c1, h}] (grid coordinates, height above street). */
  function tiersFor(L, h, style, r) {
    const T = [], W = L.c1 - L.c0, D = L.a1 - L.a0;
    const inset = (k, hh) => { const i = Math.min(k, W * 0.3, D * 0.3); T.push({ a0: L.a0 + i, a1: L.a1 - i, c0: L.c0 + i, c1: L.c1 - i, h: hh }); };
    if (h < 45 || style === S.BROWN || style === S.CAST || style === S.TENE) { T.push({ a0: L.a0, a1: L.a1, c0: L.c0, c1: L.c1, h }); return T; }
    if (style === S.PREWAR) { inset(0, h * P(r, 0.72, 0.85)); if (r() < 0.75) { inset(2.6, h * P(r, 0.9, 0.96)); inset(5.2, h); } else inset(0, h); return T; }
    if (style === S.DECO) {
      const b = Math.min(h * 0.3, 55); inset(0, b); inset(Math.min(W, D) * 0.12, h * 0.6); inset(Math.min(W, D) * 0.22, h * 0.84); inset(Math.min(W, D) * 0.3, h); return T;
    }
    // glass / office / grid towers: podium + shaft
    const pod = h > 80 && r() < 0.7 ? P(r, 12, 28) : 0;
    if (pod) inset(0, pod);
    let tw = W, td = D; const k = P(r, 3, 9);
    tw -= 2 * k; td -= 2 * k;
    if (h > 120 && Math.max(tw, td) > 1.8 * Math.min(tw, td) && r() < 0.6) { const m = Math.min(tw, td) * 1.3; if (tw > td) tw = m; else td = m; } // slender towers on deep lots
    const cc = (L.c0 + L.c1) / 2 + (W - tw - 2 * k) * (r() - 0.5) * 0.5, ca = (L.a0 + L.a1) / 2;
    const top = r() < 0.35 && h > 120 ? h * P(r, 0.88, 0.94) : h;
    T.push({ a0: ca - td / 2, a1: ca + td / 2, c0: cc - tw / 2, c1: cc + tw / 2, h: top });
    if (top < h) { const s = Math.min(tw, td) * 0.14; T.push({ a0: ca - td / 2 + s, a1: ca + td / 2 - s, c0: cc - tw / 2 + s, c1: cc + tw / 2 - s, h }); }
    return T;
  }
  function generate() {
    const t0 = performance.now();
    for (let g = 1; g <= 6; g++) {
      const ext = gridExtent(g);
      if (!ext) continue;
      const LA = lines(g, "A", ext[0], ext[1]), LC = lines(g, "C", ext[2], ext[3]), G = GR[g];
      for (let i = 0; i + 1 < LA.length; i++) for (let j = 0; j + 1 < LC.length; j++) {
        const sw = g === 1 ? G.sw : G.sw;
        const A0 = LA[i].p + LA[i].w / 2 + sw, A1 = LA[i + 1].p - LA[i + 1].w / 2 - sw;
        const C0 = LC[j].p + LC[j].w / 2 + sw, C1 = LC[j + 1].p - LC[j + 1].w / 2 - sw;
        if (A1 - A0 < 8 || C1 - C0 < 8) continue;
        const [bce, bcn] = fromGrid(g, (A0 + A1) / 2, (C0 + C1) / 2);
        if (g > 2 && bce * bce + bcn * bcn > RANGE.borough * RANGE.borough) continue;
        const r = rng(Math.floor(hash2(g * 7919 + i, j * 104729 + 17) * 4294967295));
        const z = zoneFor(g, bce, bcn, (A0 + A1) / 2, (C0 + C1) / 2);
        for (const L of lotsFor(z, A0, A1, C0, C1, r)) {
          const al = (L.a0 + L.a1) / 2, ac = (L.c0 + L.c1) / 2;
          const [e, n] = fromGrid(g, al, ac);
          if (gridAt(e, n) !== g) continue;
          const s = NY.sdfLocal(e, n);
          if (g > 2 && s > (g === 5 ? 1500 : g === 6 ? 1300 : 2300)) continue; // outer boroughs: the waterfront belts seen from Manhattan
          const half = Math.max(L.a1 - L.a0, L.c1 - L.c0) / 2;
          if (s < Math.max(10, half * 0.6)) continue;
          if (inPark(e, n, g, al, ac, s)) continue;
          if (g === 1 && bwayDist(al, ac) < 13 + Math.min(L.a1 - L.a0, L.c1 - L.c0) * 0.5) continue;
          let h = z.h(r, L.ave);
          if (!z.tall && h > 70 && !L.ave) h = 70;
          // Jet City scale: the tower districts rise well past reality (up to ~1.6×), but stay under the
          // Empire State Building's roof near it and under One World Trade Center everywhere
          if (z.tall && h > 60) {
            h = 60 + (h - 60) * RJ.lerp(1.3, 1.75, r());
            const dE = Math.hypot(bce, bcn);
            h = Math.min(h, dE < 500 ? 330 : 500);
          }
          // Billionaires' Row: a line of pencil-thin supertalls along 57th Street
          if (g === 1 && Math.abs((A0 + A1) / 2 / ST + 34 - 57) < 0.6 && Math.abs((C0 + C1) / 2) < 700 && r() < 0.55) h = P(r, 380, 480);
          if (L.big) h = Math.max(h, z.tall ? P(r, 70, 300, 1.5) : h);
          // near the water, keep the skyline believable: big towers hug the cores
          const row = !!L.row && h < 26;
          const style = styleFor(z, h, r, row, L.ave);
          const fl = FLOOR[style];
          h = Math.max(fl * 2 + 4.6, Math.round((h - 4.6) / fl) * fl + 4.6); // whole floors over a storefront
          const tiers = tiersFor(L, h, style, r);
          BLD.push({ g, al, ac, e, n, tiers, h, style, seed: Math.floor(r() * 9973), row, zone: z.name, ave: !!L.ave, lot: L });
        }
      }
    }
    NYC.genMs = performance.now() - t0;
  }

  /* ======================= facade material ======================= */
  const FACADE_GLSL = [
    "uniform float uNight; uniform float uTime; uniform float uWet;",
    "varying vec4 vF; varying vec2 vB; varying vec3 vWP; varying vec3 vWN;",
    "float fh2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
    "float fh1(float x){ return fh2(vec2(x, x * 0.6180339 + 17.17)); }",
    "float fvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(fh2(i), fh2(i + vec2(1.0, 0.0)), f.x), mix(fh2(i + vec2(0.0, 1.0)), fh2(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "float fbox(vec2 p, vec2 a, vec2 b, vec2 w){ vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p)); return s.x * s.y; }",
    "vec3 pal5(float t, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){ return t < 0.2 ? a : t < 0.4 ? b : t < 0.6 ? c : t < 0.8 ? d : e; }",
    "vec3 fCol; float fRough; float fMetal; vec3 fEmis; vec3 fNW; float fGlass;",
    "uniform samplerCube uProbe; uniform float uProbeK;",
    "void rjFacade(){",
    "  float seed = vB.x, code = vB.y;",
    "  float style = floor(code / 10000.0 + 0.001);",
    "  float fhgt = mod(floor(code / 100.0 + 0.001), 100.0) / 10.0;",
    "  float bay = mod(code, 100.0) / 10.0;",
    "  float hs = fh1(seed), hs2 = fh1(seed + 17.3), hs3 = fh1(seed + 41.9);",
    "  fNW = vec3(0.0); fEmis = vec3(0.0); fGlass = 0.0;",
    "  vec3 N = normalize(vWN);",
    // ---------- roofs: tar, white membrane, gravel, the odd green roof ----------
    "  if (N.y > 0.6) {",
    "    float rf = smoothstep(0.3, 1.2, fwidth(vF.x));",                       // fade fine gravel noise with distance
    "    float g = mix(fvn(vF.xy * 0.9), 0.5, rf) * 0.5 + mix(fvn(vF.xy * 0.13), 0.5, smoothstep(2.0, 8.0, fwidth(vF.x))) * 0.5;",
    "    vec3 tar = vec3(0.2, 0.2, 0.21) + g * 0.05;",
    "    vec3 mem = vec3(0.5, 0.5, 0.49) - g * 0.06;",
    "    vec3 grv = vec3(0.36, 0.33, 0.3) + g * 0.05;",
    "    vec3 grn = vec3(0.24, 0.33, 0.16) + g * 0.06;",
    "    fCol = hs < 0.16 ? mem : hs < 0.2 ? grn : hs < 0.5 ? grv : tar * (0.9 + hs2 * 0.25);",
    "    fRough = 0.9; fMetal = 0.0; return;",
    "  }",
    "  vec3 T = normalize(vec3(-N.z, 0.0, N.x));",
    "  float u = vF.x, v = vF.y, fw = max(vF.z, 1.0), top = vF.w;",
    "  float nb = max(1.0, floor(fw / bay + 0.5)), bw = fw / nb;",
    "  bool lowShop = style != 0.0 && style != 7.0;",
    "  float gH = lowShop ? 4.6 : 0.0;",
    "  float cu = u / bw, bi = floor(cu), fx = fract(cu);",
    "  float cv = (v - gH) / fhgt, fl = floor(cv), fy = fract(cv);",
    // anti-aliasing: how many bays/floors fall in one pixel
    "  float pu = fwidth(cu), pv = fwidth(cv);",
    "  vec2 aa = vec2(pu, pv) * 0.75 + 0.004;",
    "  float far = smoothstep(0.28, 0.75, max(pu, pv));",
    "  float lot = bi;",
    "  vec3 wall; vec3 glass = vec3(0.045, 0.06, 0.075); float win = 0.0, wx0 = 0.25, wx1 = 0.75, wy0 = 0.22, wy1 = 0.8;",
    "  float gRough = 0.08, gMetal = 0.62, wRough = 0.85, wMetal = 0.0, glassFrac = 0.25;",
    "  float floorK = fh1(fl * 7.13 + seed * 0.37);",
    "  if (style == 0.0) {",                                                       // glass curtain wall
    "    vec3 tint = pal5(hs, vec3(0.19, 0.31, 0.36), vec3(0.24, 0.29, 0.34), vec3(0.34, 0.28, 0.2), vec3(0.11, 0.13, 0.15), vec3(0.32, 0.4, 0.46));",
    "    glass = tint * 0.75 + 0.03; wall = mix(vec3(0.2, 0.21, 0.23), vec3(0.62, 0.63, 0.64), hs2);",
    "    wx0 = 0.035; wx1 = 0.965; wy0 = 0.12; wy1 = 0.985; gMetal = 0.72; gRough = 0.06 + hs3 * 0.08; glassFrac = 0.86;",
    "    wRough = 0.35; wMetal = 0.7;",
    "  } else if (style == 1.0) {",                                                // pre-war masonry
    "    wall = pal5(hs, vec3(0.62, 0.55, 0.45), vec3(0.55, 0.36, 0.27), vec3(0.47, 0.3, 0.23), vec3(0.58, 0.56, 0.52), vec3(0.7, 0.64, 0.55));",
    "    if (v < 4.6 + fhgt * 2.0) wall = mix(wall, vec3(0.7, 0.67, 0.6), 0.6);",   // limestone base
    "    wx0 = 0.27; wx1 = 0.73; wy0 = 0.2; wy1 = 0.82;",
    "  } else if (style == 2.0) {",                                                // brownstone row: every 3 bays is its own house
    "    lot = floor(bi / 3.0); float lh = fh1(lot * 3.71 + seed);",
    "    wall = pal5(lh, vec3(0.34, 0.22, 0.17), vec3(0.46, 0.21, 0.15), vec3(0.62, 0.55, 0.43), vec3(0.4, 0.17, 0.12), vec3(0.3, 0.2, 0.16));",
    "    wx0 = 0.3; wx1 = 0.7; wy0 = fl < 0.5 ? 0.08 : 0.17; wy1 = fl < 0.5 ? 0.9 : 0.84;",
    "    fx = fract(cu);",
    "  } else if (style == 3.0) {",                                                // modern office, ribbon windows
    "    wall = pal5(hs, vec3(0.78, 0.77, 0.73), vec3(0.42, 0.43, 0.45), vec3(0.24, 0.2, 0.16), vec3(0.12, 0.12, 0.13), vec3(0.6, 0.62, 0.64));",
    "    wx0 = 0.02; wx1 = 0.98; wy0 = 0.36 + hs3 * 0.08; wy1 = 0.95; gMetal = 0.75; gRough = 0.07; glassFrac = 0.55;",
    "    glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.12, 0.16, 0.18), hs2);",
    "  } else if (style == 4.0) {",                                                // art deco: piers and dark spandrels
    "    wall = pal5(hs, vec3(0.7, 0.65, 0.56), vec3(0.6, 0.52, 0.42), vec3(0.74, 0.7, 0.62), vec3(0.55, 0.45, 0.36), vec3(0.64, 0.6, 0.55));",
    "    wx0 = 0.33; wx1 = 0.67; wy0 = 0.1; wy1 = 0.9; glassFrac = 0.3;",
    "  } else if (style == 5.0) {",                                                // cast iron (SoHo)
    "    wall = pal5(hs, vec3(0.86, 0.84, 0.78), vec3(0.72, 0.74, 0.7), vec3(0.62, 0.66, 0.6), vec3(0.8, 0.76, 0.66), vec3(0.55, 0.58, 0.6));",
    "    wx0 = 0.14; wx1 = 0.86; wy0 = 0.1; wy1 = 0.9; glassFrac = 0.55;",
    "  } else if (style == 6.0) {",                                                // tenement brick
    "    wall = pal5(hs, vec3(0.45, 0.24, 0.18), vec3(0.52, 0.32, 0.24), vec3(0.38, 0.22, 0.17), vec3(0.6, 0.5, 0.4), vec3(0.42, 0.33, 0.28));",
    "    wx0 = 0.3; wx1 = 0.7; wy0 = 0.24; wy1 = 0.8;",
    "  } else {",                                                                  // concrete grid (432 Park style)
    "    wall = vec3(0.86, 0.85, 0.82); wx0 = 0.11; wx1 = 0.89; wy0 = 0.1; wy1 = 0.9; glassFrac = 0.62; gMetal = 0.7; gRough = 0.05;",
    "  }",
    // brick/stone texture and grime streaks below the sills
    "  float pw = fwidth(u);",
    "  float tex = mix(fvn(vec2(u, v) * vec2(2.2, 5.0)), 0.5, smoothstep(0.08, 0.3, pw)) * 0.4 + mix(fvn(vec2(u, v) * 0.35), 0.5, smoothstep(1.0, 4.0, pw)) * 0.6;",
    "  if (style != 0.0) wall *= 0.9 + tex * 0.18;",
    "  float edge = min(u, fw - u);",
    "  bool inPier = style != 0.0 && style != 3.0 && edge < 0.6;",
    "  win = inPier ? 0.0 : fbox(vec2(fx, fy), vec2(wx0, wy0), vec2(wx1, wy1), aa);",
    "  if (style == 5.0 && fy > 0.7) { vec2 q = vec2((fx - 0.5) / 0.36, (fy - 0.7) / 0.2); win *= 1.0 - smoothstep(0.92, 1.08, length(q)); }",
    "  if (v < gH) {",                                                             // storefronts
    "    float sb = max(1.0, floor(fw / 5.5 + 0.5)), su = fract(u / (fw / sb)), si = floor(u / (fw / sb));",
    "    win = fbox(vec2(su, v), vec2(0.06, 0.25), vec2(0.94, 3.55), vec2(aa.x, 0.05));",
    "    float sh = fh1(si * 5.3 + seed);",
    "    vec3 signC = pal5(sh, vec3(0.55, 0.1, 0.08), vec3(0.1, 0.22, 0.4), vec3(0.12, 0.3, 0.16), vec3(0.75, 0.6, 0.15), vec3(0.15, 0.15, 0.15));",
    "    wall = (v > 3.7 && v < 4.45) ? signC : wall * 0.8;",
    "    glass = vec3(0.07, 0.08, 0.085);",
    "  }",
    // per-window variety: blinds, curtains, air conditioners
    "  float wh = fh2(vec2(bi, fl) + seed * 0.013);",
    "  vec3 gl = glass;",
    "  if (style != 0.0 && v >= gH) { if (wh < 0.28) gl = mix(glass, vec3(0.3, 0.27, 0.22), 0.45); else if (wh > 0.93) gl = mix(glass, vec3(0.42, 0.42, 0.4), 0.3); }",
    "  float ac = (style == 1.0 || style == 6.0) && v >= gH && wh > 0.55 && wh < 0.66 ? fbox(vec2(fx, fy), vec2(0.4, wy0 + 0.01), vec2(0.6, wy0 + 0.13), aa) : 0.0;",
    // the parapet band at each tier top and a cornice line
    "  float band = style != 0.0 && v > top - 1.1 ? 1.0 : 0.0;",
    "  win *= 1.0 - band;",
    "  vec3 col = mix(wall, gl, win);",
    "  col = mix(col, vec3(0.62, 0.62, 0.6), ac);",
    "  if (style == 4.0 && fx > wx0 && fx < wx1 && (fy < wy0 || fy > wy1)) col = mix(col, vec3(0.2, 0.17, 0.14), 0.8 * (1.0 - win));", // spandrels
    "  if (band > 0.5) col = wall * 0.78;",
    "  if (style == 0.0) { col = mix(wall, gl, win); if (fy < wy0) col = mix(gl, wall, 0.35); }",
    // far away: the pattern melts into its average so nothing shimmers
    "  vec3 avg = mix(wall, glass, glassFrac);",
    "  col = mix(col, avg, far);",
    "  float wk = mix(win, glassFrac, far);",
    "  fRough = mix(wRough, gRough, wk); fMetal = mix(wMetal, gMetal, wk);",
    "  fGlass = wk * (style == 0.0 ? 1.0 : style == 3.0 || style == 7.0 ? 0.8 : 0.55);",
    "  if (style == 0.0) { float pj = fh2(vec2(bi, fl) * 1.7 + seed); fRough += (pj - 0.5) * 0.04 * (1.0 - far); fNW += (T * (pj - 0.5) * 0.05 + vec3(0.0, fh2(vec2(fl, bi)) - 0.5, 0.0) * 0.04) * (1.0 - far); }",
    // window reveals catch the light: tilt the normal at the window edges
    "  if (style != 0.0 && far < 0.9) {",
    "    float l = smoothstep(wx0 - aa.x, wx0 + 0.04, fx) - smoothstep(wx1 - 0.04, wx1 + aa.x, fx);",
    "    float dl = (1.0 - smoothstep(0.0, 0.05, abs(fx - wx0))) - (1.0 - smoothstep(0.0, 0.05, abs(fx - wx1)));",
    "    float db = (1.0 - smoothstep(0.0, 0.06, abs(fy - wy0))) * 0.9 - (1.0 - smoothstep(0.0, 0.05, abs(fy - wy1))) * 0.5;",
    "    fNW += (T * dl * 0.45 + vec3(0.0, db * 0.5, 0.0)) * (1.0 - far) * step(0.5, 1.0 - band);",
    "    col *= 1.0 - (1.0 - smoothstep(0.0, 0.045, abs(fy - wy1))) * 0.35 * l * (1.0 - far);",  // lintel shadow
    "  }",
    // ground-contact darkening (street canyons)
    "  col *= mix(0.62, 1.0, smoothstep(0.0, 16.0, v));",
    "  fCol = col;",
    // ---------- night: lit rooms (offices by floor, homes by window), bright shopfronts ----------
    "  if (uNight > 0.01) {",
    "    float litP = style == 0.0 || style == 3.0 ? 0.24 : 0.3;",
    "    float rh = style == 0.0 || style == 3.0 ? fh2(vec2(fl, floor(bi / 6.0)) + seed * 0.07) : wh;",
    "    float lit = step(rh, litP * uNight);",
    "    float warm = fh2(vec2(bi * 1.3, fl * 0.7) + seed);",
    "    vec3 lc = warm < 0.62 ? vec3(1.0, 0.72, 0.42) : warm < 0.85 ? vec3(0.86, 0.9, 1.0) : vec3(1.0, 0.86, 0.66);",
    "    float k = v < gH ? (fh1(floor(u / 5.5) + seed) < 0.75 ? 1.5 : 0.0) : lit * (0.75 + warm * 0.6);",
    "    fEmis = lc * k * mix(win, glassFrac * litP * 0.9, far) * uNight;",
    "  }",
    "}"
  ].join("\n");
  function facadeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, envMapIntensity: 1.0 });
    m.extensions = { derivatives: true };
    m.userData.u = { uNight: { value: 0 }, uTime: { value: 0 }, uWet: RJ.cityKit ? RJ.cityKit.WET : { value: 0 }, uProbe: { value: null }, uProbeK: { value: 0 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aF; attribute vec2 aB; varying vec4 vF; varying vec2 vB; varying vec3 vWP; varying vec3 vWN;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvF = aF; vB = aB; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + FACADE_GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\nrjFacade(); diffuseColor.rgb = fCol;")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(fRough * (1.0 - 0.45 * uWet), 0.04, 1.0); diffuseColor.rgb *= 1.0 - 0.18 * uWet * (1.0 - fGlass);")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(fNW, 0.0)).xyz);")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;")
        // glass mirrors the real surroundings from the city probe (Fresnel-weighted, darker at normal incidence)
        .replace("#include <output_fragment>", [
          "if (uProbeK > 0.5 && fGlass > 0.01) {",
          "  vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz); vec3 Vw = normalize(vWP - cameraPosition);",
          "  vec3 Rw = reflect(Vw, Nw); float F = 0.12 + 0.88 * pow(1.0 - max(dot(-Vw, Nw), 0.0), 5.0);",
          "  vec3 pr = textureCube(uProbe, Rw).rgb;",
          "  outgoingLight = mix(outgoingLight, pr * 0.9, clamp(fGlass * (0.25 + F * 0.7), 0.0, 0.85) * (1.0 - fRough));",
          "}",
          "#include <output_fragment>"].join("\n"));
      if (RJ.world.addCloudShadows) RJ.world.addCloudShadows(sh, "vWP");
    };
    return m;
  }

  /* ======================= massing geometry (merged per 1 km tile) ======================= */
  const TILE = 1000;
  const NEAR = 5; NYC.NEAR = NEAR; // render layer: drawn by the main camera and shadows, not by the water reflection
  const tileKey = (x, z) => Math.floor(x / TILE) + "," + Math.floor(z / TILE);
  class MassBuf {
    constructor() { this.p = []; this.n = []; this.f = []; this.b = []; this.i = []; this.v = 0; }
    quad(P0, P1, P2, P3, nx, ny, nz, F0, F1, F2, F3, b0, b1) {
      const v = this.v;
      for (const q of [P0, P1, P2, P3]) this.p.push(q[0], q[1], q[2]);
      for (let k = 0; k < 4; k++) { this.n.push(nx * 127, ny * 127, nz * 127); this.b.push(b0, b1); }
      for (const f of [F0, F1, F2, F3]) this.f.push(f[0], f[1], f[2], f[3]);
      this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
      this.v += 4;
    }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(this.n), 3, true));
      g.setAttribute("aF", new THREE.Float32BufferAttribute(this.f, 4));
      g.setAttribute("aB", new THREE.Float32BufferAttribute(this.b, 2));
      g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
  }
  /** World [x, z] (relative to ox, oz) of grid point (al, ac) in grid g. */
  function gw(g, al, ac, ox, oz) { const [e, n] = fromGrid(g, al, ac); return [NY.ex + e - ox, NY.ez - n - oz]; }
  /** Add a box tier (grid-aligned) to a mass buffer: four walls with facade coordinates, plus the roof. */
  function addTier(buf, g, t, y0, ox, oz, b0, b1) {
    const y1 = GROUND + t.h;
    const c = [gw(g, t.a0, t.c0, ox, oz), gw(g, t.a0, t.c1, ox, oz), gw(g, t.a1, t.c1, ox, oz), gw(g, t.a1, t.c0, ox, oz)];
    const cx = (c[0][0] + c[2][0]) / 2, cz = (c[0][1] + c[2][1]) / 2;
    const vb = y0 - GROUND, vt = t.h;
    for (let k = 0; k < 4; k++) {
      let p0 = c[k], p1 = c[(k + 1) % 4];
      let ex = p1[0] - p0[0], ez = p1[1] - p0[1];
      let nx = -ez, nz = ex;
      const mx = (p0[0] + p1[0]) / 2 - cx, mz = (p0[1] + p1[1]) / 2 - cz;
      if (nx * mx + nz * mz < 0) { const tmp = p0; p0 = p1; p1 = tmp; ex = -ex; ez = -ez; nx = -ez; nz = ex; }
      const L = Math.hypot(ex, ez); nx /= L; nz /= L;
      buf.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], nx, 0, nz,
        [0, vb, L, vt], [L, vb, L, vt], [L, vt, L, vt], [0, vt, L, vt], b0, b1);
    }
    // roof (counter-clockwise from above → normal up)
    const r = [c[0], c[1], c[2], c[3]];
    const ux = r[1][0] - r[0][0], uz = r[1][1] - r[0][1], wx = r[3][0] - r[0][0], wz = r[3][1] - r[0][1];
    const up = uz * wx - ux * wz; // y of (u × w)
    const ord = up > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const F = (q) => [q[0], q[1], -1, vt];
    buf.quad([r[ord[0]][0], y1, r[ord[0]][1]], [r[ord[1]][0], y1, r[ord[1]][1]], [r[ord[2]][0], y1, r[ord[2]][1]], [r[ord[3]][0], y1, r[ord[3]][1]], 0, 1, 0,
      F(r[ord[0]]), F(r[ord[1]]), F(r[ord[2]]), F(r[ord[3]]), b0, b1);
  }
  const codeOf = (style) => style * 10000 + Math.round(FLOOR[style] * 10) * 100 + Math.round(BAY[style] * 10);
  NYC.codeOf = codeOf;
  /** Landmarks add their own facade boxes through this. */
  NYC.massExtra = [];
  function buildMass(group) {
    const tiles = new Map();
    for (const b of BLD) {
      const [x, z] = NYC.toWorld(b.e, b.n);
      const low = b.h < 36; // low buildings: their own meshes, hidden from far away and not mirrored in the water
      const key = tileKey(x, z) + (low ? "L" : "T");
      let T = tiles.get(key);
      if (!T) { T = { buf: new MassBuf(), low, ox: Math.floor(x / TILE) * TILE + TILE / 2, oz: Math.floor(z / TILE) * TILE + TILE / 2 }; tiles.set(key, T); }
      b.x = x; b.z = z; b.tile = key;
      let y0 = GROUND - 1.5;
      for (const t of b.tiers) { addTier(T.buf, b.g, t, y0, T.ox, T.oz, b.seed, codeOf(b.style)); y0 = GROUND + t.h - 0.02; }
    }
    NYC.massMat = facadeMaterial();
    let verts = 0;
    for (const T of tiles.values()) {
      if (!T.buf.v) continue;
      const m = new THREE.Mesh(T.buf.geometry(), NYC.massMat);
      m.position.set(T.ox, 0, T.oz); m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (T.low) { m.layers.set(NEAR); LOWM.push(m); }
      group.add(m); verts += T.buf.v;
    }
    NYC.stats.massVerts = verts; NYC.stats.massTiles = tiles.size;
  }
  const LOWM = [];
  NYC.addTier = addTier; NYC.MassBuf = MassBuf; NYC.facadeMaterial = facadeMaterial;

  /* ======================= collision: spatial hash of tiers ======================= */
  const CELL = 60, HASH = new Map();
  function indexBuildings() {
    for (let bi = 0; bi < BLD.length; bi++) {
      const b = BLD[bi], L = b.lot;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [a, c] of [[L.a0, L.c0], [L.a0, L.c1], [L.a1, L.c0], [L.a1, L.c1]]) { const [e, n] = fromGrid(b.g, a, c); const x = NY.ex + e, z = NY.ez - n; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = i * 100003 + j; let a = HASH.get(k); if (!a) HASH.set(k, (a = [])); a.push(bi);
      }
    }
  }
  /** Roof height (absolute y) of whatever building stands at world (x, z), or -Infinity. */
  NYC.heightAt = function (x, z) {
    if (!NYC.ready) return -Infinity;
    const a = HASH.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    let h = -Infinity;
    if (a) {
      const e = x - NY.ex, n = NY.ez - z;
      for (const bi of a) {
        const b = BLD[bi], [al, ac] = toGrid(b.g, e, n);
        for (const t of b.tiers) if (al > t.a0 && al < t.a1 && ac > t.c0 && ac < t.c1 && GROUND + t.h > h) h = GROUND + t.h;
      }
    }
    for (const f of NYC.solids) { const v = f(x, z); if (v > h) h = v; }
    return h;
  };
  NYC.solids = []; // landmark collision functions (x, z) → top y
  NYC.deckSolids = []; // bridge decks (x, y, z) → inside: slabs you can fly under
  NYC.solidAtY = (p) => { for (const f of NYC.deckSolids) if (f(p.x, p.y, p.z)) return true; return false; };

  /* ======================= streets: ground shader ======================= */
  function districtTexture() {
    // R: grid id · G: shore distance (metres, 0..255 → −127..+128) — sampled by the street shader
    const W = RAS.nx, H = RAS.ny, d = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, e = RAS.e0 + (i + 0.5) * RAS.cs, n = RAS.n0 + (j + 0.5) * RAS.cs;
      const g = RAS.owner[k] ? gridAt(e, n) : 0;
      d[k * 4] = g * 30; d[k * 4 + 1] = clamp(Math.round(RAS.sdf[k] + 127), 0, 255); d[k * 4 + 2] = RAS.owner[k] * 20; d[k * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  function streetGLSL() {
    const g = (i) => GR[i];
    const vec4s = (f) => [1, 2, 3, 4, 5, 6].map((i) => "vec4(" + f(g(i)).map((x) => (+x).toFixed(4)).join(",") + ")").join(",");
    const ave = "float AVES[17]; float AVEW[17];";
    return [
      "uniform sampler2D uDist; uniform vec4 uRas; uniform float uNight; uniform float uTime;",
      "varying vec3 vWP;",
      "const vec4 GO[6] = vec4[6](" + vec4s((G) => [G.oe, G.on, G.Ae, G.An]) + ");",
      "const vec4 GS[6] = vec4[6](" + vec4s((G) => [G.sA || 80.4, G.jA || 0, G.sC || 200, G.jC || 0]) + ");",
      "const vec4 GW[6] = vec4[6](" + vec4s((G) => [G.wS || 18, G.wA || 30, G.sw, 0]) + ");",
      "const float AV[17] = float[17](" + AVES.map((x) => x.toFixed(1)).join(",") + ");",
      "const float AW[17] = float[17](" + AVEW.map((x) => x.toFixed(1)).join(",") + ");",
      "const vec2 BW[" + BWAY.length + "] = vec2[" + BWAY.length + "](" + BWAY.map((p) => "vec2(" + ((p[0] - 34) * ST).toFixed(1) + "," + p[1].toFixed(1) + ")").join(",") + ");",
      "const vec4 PK[" + PARKS_M.length + "] = vec4[" + PARKS_M.length + "](" + PARKS_M.map((p) => "vec4(" + p.map((x) => x.toFixed(1)).join(",") + ")").join(",") + ");",
      "float sh2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
      "float svn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh2(i), sh2(i + vec2(1.0, 0.0)), f.x), mix(sh2(i + vec2(0.0, 1.0)), sh2(i + vec2(1.0, 1.0)), f.x), f.y); }",
      "float jitL(float i){ return fract(i * 0.6180339887) * 2.0 - 1.0; }",
      // nearest line on a jittered axis: returns (signed distance, line index)
      "vec2 nearJ(float x, float S, float J){ float i0 = floor(x / S); vec2 best = vec2(1e9, 0.0); for (int k = -1; k <= 2; k++){ float i = i0 + float(k); float d = x - (i * S + jitL(i) * J); if (abs(d) < abs(best.x)) best = vec2(d, i); } return best; }",
      "bool majorSt(float k){ return k==14.0||k==23.0||k==34.0||k==42.0||k==57.0||k==59.0||k==72.0||k==79.0||k==86.0||k==96.0||k==110.0||k==116.0||k==125.0||k==135.0||k==145.0||k==155.0||k==165.0||k==181.0; }",
      "vec3 sCol; float sRough; float sMetal; vec3 sEmis;",
      "void rjStreet(){",
      "  vec2 L = vec2(vWP.x - uRas.z, uRas.w - vWP.z);",                    // local east/north metres
      "  vec4 D = texture2D(uDist, (L - uRas.xy) / vec2(" + (RAS.nx * RAS.cs).toFixed(1) + ", " + (RAS.ny * RAS.cs).toFixed(1) + "));",
      "  float sdf = D.g * 255.0 - 127.0;",
      "  if (sdf < -0.5) discard;",
      "  float gid = floor(D.r * 255.0 / 30.0 + 0.5);",
      "  float px = fwidth(vWP.x);",
      "  float n1 = mix(svn(L * 0.35), 0.5, smoothstep(1.0, 4.0, px)), n2 = svn(L * 0.045), n3 = mix(svn(L * 3.1), 0.5, smoothstep(0.1, 0.4, px));",
      "  vec3 concrete = vec3(0.56, 0.55, 0.52) * (0.86 + n1 * 0.18);",
      "  vec3 grass = mix(vec3(0.17, 0.25, 0.11), vec3(0.24, 0.31, 0.14), n2) * (0.85 + n1 * 0.25);",
      "  sRough = 0.92; sMetal = 0.0; sEmis = vec3(0.0);",
      "  if (gid < 0.5) { sCol = mix(concrete, grass, 0.6 + 0.3 * n2); return; }",
      "  int gi = int(gid) - 1;",
      "  vec4 O = GO[gi]; vec4 SS = GS[gi]; vec4 WW = GW[gi];",
      "  vec2 rel = L - O.xy; float al = rel.x * O.z + rel.y * O.w; float ac = rel.x * O.w - rel.y * O.z;",
      "  float dA, wS, dC, wA, kS;",
      "  if (gi == 0) { kS = floor(al / 80.4 + 0.5); dA = al - kS * 80.4; kS += 34.0; wS = majorSt(kS) ? 30.0 : 18.0;",
      "    dC = 1e9; wA = 30.0; for (int i = 0; i < 17; i++){ float d = ac - AV[i]; if (abs(d) < abs(dC)) { dC = d; wA = AW[i]; } } }",
      "  else { vec2 a = nearJ(al, SS.x, SS.y), c = nearJ(ac, SS.z, SS.w); dA = a.x; dC = c.x; wS = WW.x; wA = WW.y; kS = a.y; }",
      "  float sw = WW.z;",
      // Broadway and the parks (Manhattan)
      "  float dB = 1e9; bool park = false;",
      "  if (gi <= 1) { for (int i = 0; i < " + (BWAY.length - 1) + "; i++){ vec2 a = BW[i], b = BW[i + 1], d = b - a, p = vec2(al, ac) - a; float t = clamp(dot(p, d) / dot(d, d), 0.0, 1.0); dB = min(dB, length(p - d * t)); }",
      "    for (int i = 0; i < " + PARKS_M.length + "; i++){ vec4 q = PK[i]; if (al > q.x && al < q.y && ac > q.z && ac < q.w) park = true; } }",
      "  float aA = abs(dA), aC = abs(dC);",
      "  bool roadS = aA < wS * 0.5, roadA = aC < wA * 0.5, roadB = dB < 12.0;",
      "  bool road = roadS || roadA || roadB;",
      "  bool walk = !road && (aA < wS * 0.5 + sw || aC < wA * 0.5 + sw || dB < 12.0 + sw);",
      // waterfront: promenade and railings along the bulkheads
      // waterfront: a concrete esplanade with its railing line, then a planted strip
      "  if (sdf < 26.0 && !road) { sCol = sdf < 1.2 ? vec3(0.22) : sdf < 11.0 ? concrete * (1.0 - 0.1 * step(0.94, fract(sdf / 1.6))) : mix(grass, concrete, smoothstep(0.55, 0.6, svn(L * 0.06)) * 0.6); return; }",
      "  if (park && !road) { rjPark(al, ac, grass, concrete); return; }",
      "  if (road) {",
      "    float pch = smoothstep(0.55, 0.7, svn(L * 0.08)) * 0.05;",
      "    vec3 asph = vec3(0.17, 0.17, 0.175) * (0.88 + n1 * 0.2 + n3 * 0.06) + pch;",
      "    float tire = 0.0;",
      "    vec3 c = asph; float paint = 0.0;",
      "    bool inter = (roadS && (roadA || roadB));",
      "    if (!inter) {",
      "      if (roadA && !roadB) {",                                            // avenue: dashed lane lines, crosswalks at the corners
      "        float lane = abs(fract((dC + wA * 0.5) / 3.4 + 0.5) - 0.5) * 3.4;",
      "        paint = (1.0 - smoothstep(0.06, 0.12, lane)) * step(0.5, fract(al / 9.0)) * step(1.5, wA * 0.5 - aC);",
      "        float cw = aA - wS * 0.5;",
      "        if (cw > 0.4 && cw < 4.0) paint = max(paint, step(0.45, fract(dC / 1.1)));",
      "        if (cw > 4.3 && cw < 4.7) paint = 1.0;",
      "      } else if (roadS) {",                                               // cross street
      "        paint = (1.0 - smoothstep(0.06, 0.12, abs(dA))) * step(0.5, fract(ac / 9.0));",
      "        float cw = aC - wA * 0.5;",
      "        if (cw > 0.4 && cw < 4.0) paint = max(paint, step(0.45, fract(dA / 1.1)));",
      "        if (cw > 4.3 && cw < 4.7) paint = 1.0;",
      "      }",
      "    }",
      "    tire = (1.0 - smoothstep(0.3, 0.9, abs(fract((roadA ? dC : dA) / 3.4) - 0.3) * 3.4)) * 0.04;",
      "    c = mix(c - tire, vec3(0.82, 0.82, 0.78), paint * 0.92);",
      "    sCol = c; sRough = 0.88 - paint * 0.3;",
      "  } else if (walk) {",
      "    float slab = max(1.0 - smoothstep(0.03, 0.07, abs(fract(al / 1.6) - 0.5) * 1.6 - 0.73), 1.0 - smoothstep(0.03, 0.07, abs(fract(ac / 1.6) - 0.5) * 1.6 - 0.73));",
      "    float curb = max(1.0 - smoothstep(0.15, 0.3, abs(aA - wS * 0.5)), 1.0 - smoothstep(0.15, 0.3, abs(aC - wA * 0.5)));",
      "    sCol = concrete * (1.0 - slab * 0.12) * mix(1.0, 1.18, curb);",
      "  } else {",
      "    sCol = mix(concrete * 0.82, grass * 0.9, smoothstep(0.45, 0.7, n2) * 0.7);",  // yards and courtyards
      "  }",
      // night: pools of street light every ~30 m along the kerbs, and the glow of the avenues from above
      "  if (uNight > 0.01 && (road || walk)) {",
      "    float along = roadA || (walk && aC < wA * 0.5 + sw) ? al : ac;",
      "    float edgeD = roadA || (walk && aC < wA * 0.5 + sw) ? abs(aC - wA * 0.5) : abs(aA - wS * 0.5);",
      "    float pool = exp(-pow((fract(along / 30.0) - 0.5) * 30.0 / 7.5, 2.0)) * exp(-edgeD * 0.12);",
      "    sEmis = vec3(1.0, 0.74, 0.45) * (pool * 0.9 + 0.1 + (roadA ? 0.08 : 0.0)) * uNight * (road ? 1.0 : 0.75);",
      "  }",
      "}"
    ].join("\n");
  }
  function parkGLSL() {
    // Central Park in Manhattan grid coordinates (al = metres north of 34th St along the avenues, ac = east of 5th)
    const k = (s) => ((s - 34) * ST).toFixed(1);
    const ell = (s, c, ra, rc) => "vec4(" + k(s) + "," + c.toFixed(1) + "," + ra.toFixed(1) + "," + rc.toFixed(1) + ")";
    const WATER = [ell(91, -420, 395, 295), ell(75.2, -425, 165, 105), ell(77.3, -555, 85, 70), ell(79.6, -330, 70, 26), ell(106.6, -125, 150, 105), ell(60.6, -85, 95, 38), ell(74.2, -62, 48, 24), ell(101.2, -700, 60, 38)];
    const LAWN = [ell(82.6, -360, 180, 110), ell(67.6, -500, 120, 115), ell(99.2, -470, 170, 190)];
    return [
      "const vec4 CPW[" + WATER.length + "] = vec4[" + WATER.length + "](" + WATER.join(",") + ");",
      "const vec4 CPL[" + LAWN.length + "] = vec4[" + LAWN.length + "](" + LAWN.join(",") + ");",
      "void rjPark(float al, float ac, vec3 grass, vec3 concrete){",
      "  sCol = grass; sRough = 0.95;",
      "  bool cp = al > " + k(59) + " && al < " + k(110) + " && ac > -840.0 && ac < 0.0;",
      "  if (cp) {",
      "    for (int i = 0; i < " + WATER.length + "; i++){ vec4 q = CPW[i]; vec2 d = vec2((al - q.x) / q.z, (ac - q.y) / q.w); float r = length(d) + (svn(vec2(al, ac) * 0.02 + float(i)) - 0.5) * 0.18; if (r < 1.0) { sCol = mix(vec3(0.05, 0.09, 0.1), vec3(0.1, 0.13, 0.12), svn(vec2(al, ac) * 0.05)); sRough = 0.04; sMetal = 0.55; return; } if (r < 1.06) { sCol = vec3(0.42, 0.4, 0.34); return; } }",
      "    for (int i = 0; i < " + LAWN.length + "; i++){ vec4 q = CPL[i]; vec2 d = vec2((al - q.x) / q.z, (ac - q.y) / q.w); if (length(d) < 1.0) { sCol = mix(vec3(0.27, 0.37, 0.15), vec3(0.32, 0.41, 0.18), svn(vec2(al, ac) * 0.08)); if (i == 0) { vec2 bf = fract(vec2(al, ac) / vec2(120.0, 90.0)) - 0.5; float r = length(bf * vec2(120.0, 90.0)); if (r < 30.0 && bf.x > 0.0 && bf.y > 0.0) sCol = vec3(0.6, 0.47, 0.33); } return; } }",
      // the loop drive, the four sunken transverse roads, perimeter wall, winding footpaths
      "    float ia = min(al - " + k(59) + ", " + k(110) + " - al), ic = min(ac + 840.0, -ac);",
      "    float loopD = abs(min(ia, ic * 1.0) - 75.0);",
      "    if (loopD < 4.8) { sCol = vec3(0.2, 0.2, 0.21) * (0.9 + svn(vec2(al, ac)) * 0.2); return; }",
      "    for (int i = 0; i < 4; i++){ float s = i == 0 ? " + k(65.5) + " : i == 1 ? " + k(79.5) + " : i == 2 ? " + k(85.5) + " : " + k(97.5) + "; if (abs(al - s + sin(ac * 0.01) * 12.0) < 5.0) { sCol = vec3(0.19); return; } }",
      "    if (ia < 3.0 || ic < 3.0) { sCol = vec3(0.45, 0.43, 0.38); return; }",
      "    float pth = abs(svn(vec2(al, ac) * 0.011) - 0.5) + abs(svn(vec2(al, ac) * 0.023 + 5.0) - 0.5) * 0.4;",
      "    if (pth < 0.012) { sCol = vec3(0.58, 0.55, 0.48); return; }",
      "    float rock = smoothstep(0.72, 0.8, svn(vec2(al, ac) * 0.03 + 9.0));",           // Manhattan schist outcrops
      "    sCol = mix(sCol, vec3(0.38, 0.37, 0.36), rock);",
      "  } else {",
      "    float pth = min(abs(fract(al / 40.0) - 0.5), abs(fract(ac / 40.0) - 0.5)) * 40.0;",
      "    if (pth < 1.6) sCol = concrete;",
      "  }",
      "}"
    ].join("\n");
  }
  function groundMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.extensions = { derivatives: true };
    const tex = districtTexture();
    m.userData.u = { uDist: { value: tex }, uRas: { value: new THREE.Vector4(RAS.e0, RAS.n0, NY.ex, NY.ez) }, uNight: { value: 0 }, uTime: { value: 0 } };
    const glsl = streetGLSL().replace("void rjStreet(){", parkGLSL() + "\nvoid rjStreet(){");
    // rjPark must be declared before rjStreet uses it
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + glsl.replace("varying vec3 vWP;", "varying vec3 vWP;\nvec3 sCol0;"))
        .replace("#include <color_fragment>", "#include <color_fragment>\nrjStreet(); diffuseColor.rgb = sCol;")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = sRough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += sEmis;");
      if (RJ.world.addCloudShadows) RJ.world.addCloudShadows(sh, "vWP");
    };
    return m;
  }
  function buildGround(group) {
    NYC.groundMat = groundMaterial();
    const T = 2000, seen = new Set();
    // tiles over every land cell that carries a street grid or a park, within the generated area
    for (let j = 0; j < RAS.ny; j += 2) for (let i = 0; i < RAS.nx; i += 2) {
      const k = j * RAS.nx + i;
      if (!RAS.owner[k] || RAS.sdf[k] < 0) continue;
      const e = RAS.e0 + (i + 0.5) * RAS.cs, n = RAS.n0 + (j + 0.5) * RAS.cs;
      const g = gridAt(e, n);
      if (e * e + n * n > (g === 1 || g === 2 ? 30000 : RANGE.borough + 500) ** 2) continue;
      const [x, z] = NYC.toWorld(e, n);
      seen.add(Math.floor(x / T) + "," + Math.floor(z / T));
    }
    const geo = new THREE.PlaneGeometry(T, T, 1, 1); geo.rotateX(-Math.PI / 2);
    for (const key of seen) {
      const [i, j] = key.split(",").map(Number);
      const m = new THREE.Mesh(geo, NYC.groundMat);
      m.position.set(i * T + T / 2, GROUND + 0.02, j * T + T / 2); m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix(); m.layers.set(NEAR);
      group.add(m);
    }
    NYC.stats.groundTiles = seen.size;
  }

  /* ======================= far skyline (long-range backdrop layer) ======================= */
  // Every building over 30 m as a plain shaded box on the far-horizon layer, drawn only beyond the detailed
  // view range, so Manhattan's skyline stands on the horizon from 50+ km away.
  function buildFarSkyline() {
    const W = RJ.world, pos = [], nor = [], col = [], idx = [];
    const box = (g, t, c) => {
      const cs = [[t.a0, t.c0], [t.a0, t.c1], [t.a1, t.c1], [t.a1, t.c0]].map(([a, cc]) => { const [e, n] = fromGrid(g, a, cc); return NYC.toWorld(e, n); });
      const y0 = GROUND, y1 = GROUND + t.h, cx = (cs[0][0] + cs[2][0]) / 2, cz = (cs[0][1] + cs[2][1]) / 2;
      for (let k = 0; k < 4; k++) {
        const p0 = cs[k], p1 = cs[(k + 1) % 4]; let nx = -(p1[1] - p0[1]), nz = p1[0] - p0[0]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        const mx = (p0[0] + p1[0]) / 2 - cx, mz = (p0[1] + p1[1]) / 2 - cz; const flip = nx * mx + nz * mz < 0;
        if (flip) { nx = -nx; nz = -nz; }
        const v = pos.length / 3, A = flip ? p1 : p0, B = flip ? p0 : p1;
        pos.push(A[0], y0, A[1], B[0], y0, B[1], B[0], y1, B[1], A[0], y1, A[1]);
        for (let q = 0; q < 4; q++) { nor.push(nx, 0, nz); col.push(c[0], c[1], c[2]); }
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
      const v = pos.length / 3;
      for (const p of cs) { pos.push(p[0], y1, p[1]); nor.push(0, 1, 0); col.push(c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); }
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2, v, v + 1, v + 2, v, v + 2, v + 3);
    };
    const COLS = [[0.34, 0.42, 0.48], [0.58, 0.52, 0.44], [0.5, 0.36, 0.3], [0.52, 0.53, 0.54], [0.62, 0.58, 0.5], [0.66, 0.64, 0.6], [0.48, 0.34, 0.28], [0.8, 0.79, 0.76]];
    for (const b of BLD) { if (b.h < 30) continue; const c = COLS[b.style]; for (const t of b.tiers) box(b.g, t, c); }
    for (const t of NYC.farExtra || []) box(1, t, t.col || [0.55, 0.55, 0.55]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, W.farMat); m.layers.set(W.BACK); m.frustumCulled = false; m.renderOrder = -4;
    W.scene.add(m); NYC.farMesh = m;
  }

  /* ======================= build ======================= */
  NYC.stats = {};
  // for the detail/traffic layer (nyc-detail.js)
  NYC.lines = lines; NYC.GR = GR; NYC.ownerAt = (e, n) => ownerAt(e, n); NYC.bwayDist = bwayDist; NYC.MAJOR = MAJOR; NYC.AVES = AVES;
  NYC.inParkAt = (e, n) => { const g = gridAt(e, n), s = NY.sdfLocal(e, n); const [a, c] = g ? toGrid(g, e, n) : [0, 0]; return inPark(e, n, g, a, c, s); };
  NYC.zoneName = (e, n) => { const g = gridAt(e, n); if (!g) return ""; const [a, c] = toGrid(g, e, n); return zoneFor(g, e, n, a, c).name; };
  NYC.sdfLocal = (e, n) => NY.sdfLocal(e, n);
  NYC.build = function () {
    const gen = RJ.world.gen; NY = gen.nyc; RAS = NY.raster();
    RAS.names.forEach((nm, i) => (OWN[nm] = i + 1));
    initGrids(); initParks(); initZones();
    if (NYC.planLandmarks) NYC.planLandmarks(); // reserves ground for the landmarks before lots are drawn
    generate();
    const grp = new THREE.Group(); grp.name = "nyc";
    const t0 = performance.now();
    buildMass(grp);
    buildGround(grp);
    indexBuildings();
    NYC.group = grp;
    if (NYC.buildLandmarks) NYC.buildLandmarks(grp);
    if (NYC.initDetail) NYC.initDetail(grp);
    try { buildFarSkyline(); } catch (e) { console.warn("NYC far skyline", e); }
    NYC.stats.buildings = BLD.length; NYC.stats.genMs = Math.round(NYC.genMs); NYC.stats.buildMs = Math.round(performance.now() - t0);
    NYC.ready = true;
    const esb = NYC.toWorld(0, 0);
    return { group: grp, cx: esb[0], cz: esb[1] };
  };
  /* ======================= city reflection probe ======================= */
  // A cube map of the real surroundings (towers, water, sky) rendered around the camera, one face every other
  // frame, so glass curtain walls reflect the neighbouring buildings instead of only the sky. Two targets
  // ping-pong so the glass never samples the cube being drawn.
  let PR = null;
  function probeUpdate(cam) {
    const W = RJ.world, r = W.renderer, q = RJ.settings.quality;
    const U = NYC.massMat.userData.u;
    if (q !== "high" && q !== "ultra") { U.uProbeK.value = 0; return; }
    if (!PR) {
      const mk = () => new THREE.WebGLCubeRenderTarget(q === "ultra" ? 256 : 128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      PR = { a: mk(), b: mk(), face: 0, tick: 0, cc: null };
      PR.cc = new THREE.CubeCamera(4, 24000, PR.b);
      PR.cc.children.forEach((c) => c.layers.enable(W.BACK));
      W.scene.add(PR.cc);
    }
    if ((PR.tick++ & 1) === 1) return;
    if (PR.face === 0) { PR.cc.position.copy(cam.position); PR.cc.updateMatrixWorld(true); }
    const prevAuto = r.shadowMap.autoUpdate, prevRT = r.getRenderTarget();
    r.shadowMap.autoUpdate = false;
    const c = PR.cc.children[PR.face];
    r.setRenderTarget(PR.b, PR.face); r.clear(); r.render(W.scene, c);
    r.setRenderTarget(prevRT); r.shadowMap.autoUpdate = prevAuto;
    if (++PR.face === 6) {
      PR.face = 0;
      const t = PR.a; PR.a = PR.b; PR.b = t; PR.cc.renderTarget = PR.b;
      U.uProbe.value = PR.a.texture; U.uProbeK.value = 1;
    }
  }
  NYC.update = function (dt, cam) {
    if (!NYC.ready) return;
    if (NYC.within(cam.position.x, cam.position.z, -4000) && cam.position.y < 3500) { try { probeUpdate(cam); } catch (e) { console.warn("NYC probe", e); PR = null; } }
    const W = RJ.world, night = RJ.clamp(1 - RJ.smooth(-4, 6, W.sunElev), 0, 1);
    const dusk = RJ.clamp(1 - RJ.smooth(2, 14, W.sunElev), 0, 1) * 0.35;
    NYC.night = Math.max(night, dusk * 0.6);
    NYC.massMat.userData.u.uNight.value = NYC.night;
    if (RJ.cityKit) RJ.cityKit.wetTick(dt);
    NYC.groundMat.userData.u.uNight.value = night;
    const d = Math.hypot(cam.position.x - NY.cx, cam.position.z - NY.cz);
    NYC.group.visible = d < NY.R + 30000;
    // low buildings fade out of the draw list beyond ~4.5 km (a few pixels tall from there)
    const cp = cam.position, far2 = (4500 + Math.max(0, cp.y - 300) * 1.5) ** 2;
    for (const m of LOWM) m.visible = (m.position.x - cp.x) ** 2 + (m.position.z - cp.z) ** 2 < far2;
    if (NYC.updateDetail) NYC.updateDetail(dt, cam);
    if (NYC.updateLandmarks) NYC.updateLandmarks(dt, cam);
  };
  /** Build on demand (when the player starts in or approaches the city), not at every game start. */
  NYC.ensure = function () {
    if (NYC.ready || NYC.building) return NYC.group;
    NYC.building = true;
    try { NYC.build(); RJ.world.scene.add(NYC.group); } catch (e) { console.error("New York failed", e); }
    NYC.building = false;
    return NYC.group;
  };
  NYC.within = (x, z, pad) => { if (!NY) return false; const d = Math.hypot(x - NY.cx, z - NY.cz); return d < NY.R + (pad || 0); };
  NYC.esbWorld = () => { const n = RJ.world.gen.nyc; return [n.ex, n.ez]; };
  /** Spawn point for free flight: over the Upper Bay by the Statue of Liberty, heading for Lower Manhattan. */
  /** New York Skyline Run: down the Sixth Avenue canyon, along the Hudson past One World Trade Center, round the
   *  Battery, under the Brooklyn Bridge and up the East Side to finish above the Empire State Building. */
  NYC.route = function () {
    NY = NY || RJ.world.gen.nyc;
    if (RJ.atlas && RJ.atlas.built) NYC.ensure();
    // Sixth Avenue (AVES[7]) street by street from 58th down to 15th: the gates sit on the avenue's centre line
    const six = [58, 52, 46, 40, 34, 28, 22, 15].map((k, i) => { const [e, n] = NYC.addr(k, AVES[7]), [x, z] = NYC.toWorld(e, n), v = RJ.V3(x, 170 - i * 9, z); v.keep = true; return v; });
    const G = [
      [40.7290, -74.0135, 80], [40.7180, -74.0160, 120], [40.7127, -74.0165, 280], [40.7040, -74.0175, 90], [40.7030, -74.0090, 100],
      [40.70574, -73.99628, 20, 1], [40.7080, -73.9880, 70], [40.7250, -73.9720, 110], [40.7420, -73.9725, 150], [40.7484, -73.9830, 470]];
    const out = G.map(([la, lo, y, k]) => { const [e, n] = local(la, lo), [x, z] = NYC.toWorld(e, n); const v = RJ.V3(x, y, z); v.keep = true; v.tight = !!k; return v; });
    return six.concat(out);
  };
  NYC.spawn = function () {
    NY = NY || RJ.world.gen.nyc;
    if (RJ.atlas && RJ.atlas.built) NYC.ensure();
    const p = local(40.6720, -74.0330), tgt = local(40.7060, -74.0110);
    const [x, z] = NYC.toWorld(p[0], p[1]), [tx, tz] = NYC.toWorld(tgt[0], tgt[1]);
    return { x, z, yaw: Math.atan2(-(tx - x), -(tz - z)), alt: 420 };
  };
})(window.RJ);
(function (RJ) {
  // New York joins the atlas: discovery, radar marker, the Atlas screen
  if (RJ.atlas && RJ.atlas.DEFS && !RJ.atlas.DEFS.some((d) => d.id === "nyc")) RJ.atlas.DEFS.push({ id: "nyc", name: "New York City", sub: "Manhattan at 1:1: the Battery to Inwood, the harbor and the bridges", icon: "city", r: 9000, xp: 600 });
})(window.RJ);
