/* Ridgeline Jets — terrain generator.
 * Self-contained on purpose: world.js stringifies makeTerrainGen() into Web Workers, so nothing in
 * here may reference variables outside the function. The same code also runs on the main thread for
 * height queries (collisions, spawn points, regions). */
(function (root) {
  "use strict";
  function makeTerrainGen() {
    /* ---------------- noise ---------------- */
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    function makeSimplex(seed) {
      const rnd = mulberry32(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      const perm = new Uint8Array(512), pm8 = new Uint8Array(512);
      for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] & 7; }
      return function (xin, yin) {
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s), j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t), y0 = yin - (j - t);
        const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const ii = i & 255, jj = j & 255;
        let n = 0, tt, g;
        tt = 0.5 - x0 * x0 - y0 * y0;
        if (tt > 0) { g = GRAD[pm8[ii + perm[jj]]]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
        tt = 0.5 - x1 * x1 - y1 * y1;
        if (tt > 0) { g = GRAD[pm8[ii + i1 + perm[jj + j1]]]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
        tt = 0.5 - x2 * x2 - y2 * y2;
        if (tt > 0) { g = GRAD[pm8[ii + 1 + perm[jj + 1]]]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
        return 70 * n;
      };
    }
    const N1 = makeSimplex(1337), N2 = makeSimplex(4242), N3 = makeSimplex(9001);
    function fbm(fn, x, y, oct) {
      let a = 1, f = 1, s = 0, norm = 0;
      for (let o = 0; o < oct; o++) { s += a * fn(x * f, y * f); norm += a; a *= 0.5; f *= 2; }
      return s / norm;
    }
    function ridged(fn, x, y, oct) {
      let a = 0.5, f = 1, s = 0, w = 1, norm = 0;
      for (let o = 0; o < oct; o++) {
        let n = 1 - Math.abs(fn(x * f, y * f));
        n *= n; n *= w;
        w = n * 2 < 0 ? 0 : n * 2 > 1 ? 1 : n * 2;
        s += n * a; norm += a;
        a *= 0.5; f *= 2.05;
      }
      return s / norm;
    }
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

    /* ---------------- airbase flattening ---------------- */
    let AB = null;
    function setAirbase(ab) { AB = ab || null; }
    /** 1 inside the airbase pad, falling to 0 over 450 m. */
    function airbaseMask(x, z) {
      if (!AB) return 0;
      const dx = x - AB.x, dz = z - AB.z;
      const u = dx * AB.dx + dz * AB.dz, v = -dx * AB.dz + dz * AB.dx;
      const d = Math.max(Math.abs(u) - AB.len / 2 - 150, Math.abs(v - AB.side) - AB.halfW, 0);
      return 1 - smooth(0, 450, d);
    }

    /* ---------------- landmark sites ---------------- */
    // plateau: flattened summit (castle) · flat: small level pad · lake: carved basin with water ·
    // pad: oriented runway pad (hidden airbase). Each site carries its own blend radius.
    let SITES = [];
    function setSites(list) { SITES = list || []; }
    function siteMask(st, x, z) {
      const dx = x - st.x, dz = z - st.z;
      if (st.type === "pad") {
        const u = dx * st.dx + dz * st.dz, v = -dx * st.dz + dz * st.dx;
        const d = Math.max(Math.abs(u) - st.len / 2 - 120, Math.abs(v - (st.side || 0)) - st.halfW, 0);
        return 1 - smooth(0, st.fall || 400, d);
      }
      const d = Math.sqrt(dx * dx + dz * dz) - st.r;
      return d <= 0 ? 1 : 1 - smooth(0, st.fall, d);
    }
    /** Strongest "keep clear" mask over all sites (trees, rocks, rivers). */
    function clearMask(x, z) {
      let m = 0;
      for (const st of SITES) { if (st.noClear) continue; const dx = x - st.x, dz = z - st.z, R = (st.r || st.len) + (st.fall || 400); if (dx * dx + dz * dz > R * R) continue; m = Math.max(m, siteMask(st, x, z)); }
      return m;
    }
    // Mount Everest: summit position (m) and the radius of the Himalayan range around it
    const EVX = 52000, EVZ = -48000, EVR = 46000;
    // Real elevation for the Everest region (js/dem-everest.js): [outer 94 km @ 120 m, inner 32 km @ 40 m], set by world.js
    let DEM = null, SFD = null;
    function setDEM(g, sf) { DEM = g && g.length ? g : null; SFD = sf && sf.length ? sf : null; }
    const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    const DS = [0, 0]; // slope (rise/run) of the last demGrid sample
    /** Catmull-Rom sample of one DEM grid at an offset (m) from the summit; NaN outside it. */
    function demGrid(G, ox, oz) {
      const fx = (ox - (G.ox || 0) + G.half) / G.cell, fz = (oz - (G.oz || 0) + G.half) / G.cell, i = Math.floor(fx), j = Math.floor(fz), n = G.n;
      if (i < 1 || j < 1 || i > n - 3 || j > n - 3) return NaN;
      const tx = fx - i, tz = fz - j, d = G.data, r = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) { const o = (j - 1 + k) * n + i - 1; r[k] = cr(d[o], d[o + 1], d[o + 2], d[o + 3], tx); }
      const o = j * n + i;
      DS[0] = (d[o + 1] - d[o] + d[o + n + 1] - d[o + n]) * 0.125 / G.cell; DS[1] = (d[o + n] - d[o] + d[o + n + 1] - d[o + 1]) * 0.125 / G.cell;
      return cr(r[0], r[1], r[2], r[3], tz) * 0.25 - (G.off || 0);
    }
    /** Real terrain height around Everest plus sub-cell rock detail; NaN outside the data. */
    function demHeight(x, z, X, Z) {
      const ox = x - EVX, oz = z - EVZ, ho = demGrid(DEM[0], ox, oz);
      if (ho !== ho) return NaN;
      let sl = Math.hypot(DS[0], DS[1]), h = ho;
      const e = Math.max(Math.abs(ox), Math.abs(oz)), wi = DEM[1] ? smooth(15600, 13800, e) : 0;
      if (wi > 0) { const hi = demGrid(DEM[1], ox, oz); if (hi === hi) { h = lerp(ho, hi, wi); sl = lerp(sl, Math.hypot(DS[0], DS[1]), wi); } }
      // detail the grid can't hold: ribs and gullies on steep faces (none on the summit itself)
      const top = smooth(150, 700, Math.hypot(ox, oz)), steep = 0.35 + Math.min(sl, 1.6);
      h += (ridged(N1, X / 0.13 + 7, Z / 0.13 - 3, 2) - 0.32) * 11 * steep * top;
      h += (ridged(N3, X / 0.38, Z / 0.38, 2) - 0.32) * 26 * steep * (1 - wi) * top;
      return h;
    }
    // Fixed realms (identical on every machine): terrain shaped for the fantasy landmarks
    const ZONES = {
      fantasy: { x: -60000, z: 24000, r: 25000 },   // green plains, a great mountain wall, the fortress city's hill
      city: { x: -55000, z: 22500, r: 950 },        // seven-tiered hill under the fortress city
      volcano: { x: -73000, z: 34000, r: 10500 },    // fire mountain on an ash plain
      ashland: { x: -61000, z: 26500, r: 8000 },     // barren volcanic plateau with the dark tower
      valley: { x: -50000, z: 38000, r: 6000 },      // hidden valley of the elves: deep, green, waterfalls
      jade: { x: 44000, z: 36000, r: 14000 },        // lush karst valley: stone pillars, sky bridge, monastery
      white: { x: -32000, z: -54000, r: 21000 },     // snowy mountains, frozen lakes, the ice fortress
      redwood: { x: -12000, z: 52000, r: 11000 }     // giant forest valley
    };
    const zd = (z, x, y) => Math.hypot(x - z.x, y - z.z);

    /* ---------------- New York City: real coastlines at 1:1 ----------------
     * Shorelines are lat/lon polygons (traced from the real geography, ~50–150 m accuracy) converted to metres
     * around the Empire State Building, which sits at world (NY.ex, NY.ez). North is −z. They are rasterised once
     * into a signed-distance field (metres inland, negative over water) that terrain, buildings and the street
     * shader all share. */
    const NY = { ex: 15000, ez: 72000, lat0: 40.7484, lon0: -73.9857, mE: 84330, mN: 111045 };
    NY.cx = NY.ex + 600; NY.cz = NY.ez + 1500; NY.R = 23000;
    const NYP = {
      manhattan: [[40.7003,-74.0160],[40.7035,-74.0180],[40.7085,-74.0185],[40.7140,-74.0175],[40.7180,-74.0160],[40.7225,-74.0138],[40.7290,-74.0118],[40.7350,-74.0105],[40.7410,-74.0098],[40.7470,-74.0092],[40.7530,-74.0075],[40.7590,-74.0045],[40.7650,-74.0005],[40.7720,-73.9948],[40.7790,-73.9897],[40.7860,-73.9848],[40.7930,-73.9802],[40.8000,-73.9748],[40.8070,-73.9693],[40.8140,-73.9642],[40.8210,-73.9592],[40.8290,-73.9547],[40.8380,-73.9502],[40.8470,-73.9476],[40.8540,-73.9441],[40.8610,-73.9381],[40.8680,-73.9312],[40.8740,-73.9257],[40.8782,-73.9218],[40.8760,-73.9142],[40.8720,-73.9112],[40.8660,-73.9132],[40.8600,-73.9162],[40.8530,-73.9222],[40.8460,-73.9282],[40.8390,-73.9322],[40.8320,-73.9342],[40.8240,-73.9342],[40.8170,-73.9334],[40.8100,-73.9322],[40.8040,-73.9300],[40.7945,-73.9300],[40.7890,-73.9375],[40.7835,-73.9432],[40.7770,-73.9428],[40.7710,-73.9462],[40.7650,-73.9530],[40.7590,-73.9580],[40.7530,-73.9630],[40.7470,-73.9676],[40.7410,-73.9715],[40.7350,-73.9740],[40.7290,-73.9738],[40.7230,-73.9738],[40.7180,-73.9750],[40.7130,-73.9778],[40.7100,-73.9835],[40.7085,-73.9900],[40.7068,-73.9962],[40.7055,-74.0018],[40.7035,-74.0068],[40.7015,-74.0112]],
      brooklynQueens: [[40.6060,-74.0345],[40.6200,-74.0405],[40.6330,-74.0385],[40.6430,-74.0310],[40.6550,-74.0215],[40.6640,-74.0170],[40.6735,-74.0190],[40.6820,-74.0110],[40.6930,-74.0025],[40.6990,-73.9990],[40.7035,-73.9905],[40.7030,-73.9800],[40.7035,-73.9745],[40.7062,-73.9668],[40.7112,-73.9688],[40.7160,-73.9662],[40.7230,-73.9610],[40.7300,-73.9598],[40.7370,-73.9618],[40.7425,-73.9598],[40.7465,-73.9585],[40.7525,-73.9545],[40.7575,-73.9497],[40.7625,-73.9415],[40.7690,-73.9375],[40.7745,-73.9320],[40.7790,-73.9228],[40.7800,-73.9050],[40.7780,-73.8800],[40.7800,-73.7900],[40.5750,-73.7900],[40.5740,-73.9800],[40.5840,-74.0110],[40.5960,-74.0280]],
      newJersey: [[40.6475,-74.0880],[40.6515,-74.0720],[40.6650,-74.0660],[40.6800,-74.0560],[40.6930,-74.0525],[40.7020,-74.0482],[40.7100,-74.0372],[40.7160,-74.0322],[40.7270,-74.0292],[40.7370,-74.0272],[40.7450,-74.0252],[40.7540,-74.0217],[40.7620,-74.0172],[40.7720,-74.0082],[40.7820,-74.0002],[40.7950,-73.9902],[40.8100,-73.9792],[40.8300,-73.9662],[40.8500,-73.9562],[40.8750,-73.9432],[40.9100,-73.9200],[40.9300,-73.9150],[40.9300,-74.1500],[40.6400,-74.1500]],
      statenIsland: [[40.6425,-74.1500],[40.6430,-74.0950],[40.6420,-74.0760],[40.6300,-74.0705],[40.6100,-74.0625],[40.5950,-74.0600],[40.5800,-74.0620],[40.5500,-74.1000],[40.5400,-74.1500]],
      bronx: [[40.8800,-73.9150],[40.8742,-73.9082],[40.8642,-73.9104],[40.8542,-73.9176],[40.8462,-73.9246],[40.8332,-73.9296],[40.8202,-73.9296],[40.8102,-73.9256],[40.8042,-73.9206],[40.8008,-73.9122],[40.8030,-73.8980],[40.8080,-73.8800],[40.8100,-73.7900],[40.9300,-73.7900],[40.9300,-73.9100]],
      randalls: [[40.7850,-73.9250],[40.7882,-73.9160],[40.7955,-73.9135],[40.7985,-73.9185],[40.7978,-73.9270],[40.7920,-73.9298]],
      governors: [[40.6937,-74.0148],[40.6907,-74.0093],[40.6828,-74.0178],[40.6835,-74.0245],[40.6882,-74.0228]],
      liberty: [[40.6907,-74.0470],[40.6912,-74.0442],[40.6895,-74.0425],[40.6876,-74.0432],[40.6872,-74.0457],[40.6886,-74.0472]],
      ellis: [[40.7008,-74.0412],[40.7002,-74.0383],[40.6985,-74.0378],[40.6978,-74.0402],[40.6990,-74.0418]],
      roosevelt: [[40.7509,-73.9600],[40.7724,-73.9394],[40.7738,-73.9402],[40.7736,-73.9416],[40.7521,-73.9619],[40.7510,-73.9612]]
    };
    NY.toLocal = (lat, lon) => [(lon - NY.lon0) * NY.mE, (lat - NY.lat0) * NY.mN]; // [east, north] metres from the ESB
    NY.toWorld = (lat, lon) => { const l = NY.toLocal(lat, lon); return [NY.ex + l[0], NY.ez - l[1]]; };
    let NYS = null; // signed-distance raster, built on first use
    function nyRaster() {
      if (NYS) return NYS;
      const e0 = -16000, n0 = -22000, cs = 50, nx = 700, ny = 880;
      const inside = new Uint8Array(nx * ny);
      const polys = Object.values(NYP).map((p) => p.map(([la, lo]) => NY.toLocal(la, lo)));
      // even–odd scanline fill, row by row
      const xs = [];
      for (let j = 0; j < ny; j++) {
        const n = n0 + (j + 0.5) * cs;
        for (let pi = 0; pi < polys.length; pi++) {
          const P = polys[pi];
          xs.length = 0;
          for (let i = 0, k = P.length - 1; i < P.length; k = i++) {
            const a = P[i], b = P[k];
            if ((a[1] > n) !== (b[1] > n)) xs.push(a[0] + (n - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
          xs.sort((p, q) => p - q);
          for (let q = 0; q + 1 < xs.length; q += 2) {
            const i0 = Math.max(0, Math.ceil((xs[q] - e0) / cs - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - e0) / cs - 0.5));
            for (let i = i0; i <= i1; i++) inside[j * nx + i] = pi + 1; // which landmass (index into NYP + 1)
          }
        }
      }
      // two-pass chamfer distance transform on each side of the shore → signed distance (m)
      const INF = 1e6, din = new Float32Array(nx * ny), dout = new Float32Array(nx * ny);
      for (let i = 0; i < nx * ny; i++) { din[i] = inside[i] ? INF : 0; dout[i] = inside[i] ? 0 : INF; }
      const D1 = cs, D2 = cs * 1.4142;
      for (const d of [din, dout]) {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const k = j * nx + i; let v = d[k]; if (v === 0) continue;
          if (i > 0) v = Math.min(v, d[k - 1] + D1);
          if (j > 0) { v = Math.min(v, d[k - nx] + D1); if (i > 0) v = Math.min(v, d[k - nx - 1] + D2); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D2); }
          d[k] = v;
        }
        for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
          const k = j * nx + i; let v = d[k]; if (v === 0) continue;
          if (i < nx - 1) v = Math.min(v, d[k + 1] + D1);
          if (j < ny - 1) { v = Math.min(v, d[k + nx] + D1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D2); if (i > 0) v = Math.min(v, d[k + nx - 1] + D2); }
          d[k] = v;
        }
      }
      const sdf = new Float32Array(nx * ny);
      for (let i = 0; i < nx * ny; i++) sdf[i] = inside[i] ? Math.min(din[i] - cs * 0.5, 3000) : -Math.min(dout[i] - cs * 0.5, 3000);
      NYS = { sdf, owner: inside, names: Object.keys(NYP), e0, n0, cs, nx, ny };
      return NYS;
    }
    /** Metres inland from the nearest New York shoreline (negative over water), at local [east, north]. */
    function nySdfLocal(e, n) {
      const R = nyRaster();
      let fx = (e - R.e0) / R.cs - 0.5, fy = (n - R.n0) / R.cs - 0.5;
      fx = clamp(fx, 0, R.nx - 1.001); fy = clamp(fy, 0, R.ny - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * R.nx + i, S = R.sdf;
      return (S[k] * (1 - tx) + S[k + 1] * tx) * (1 - ty) + (S[k + R.nx] * (1 - tx) + S[k + R.nx + 1] * tx) * ty;
    }
    NY.sdfLocal = nySdfLocal;
    NY.sdf = (x, z) => nySdfLocal(x - NY.ex, NY.ez - z);
    NY.raster = nyRaster;
    NY.polys = NYP;
    /** Parks (local e, n): Central Park on the street grid, Prospect Park, plus the Palisades woods. */
    const CP_A = [0.4848, 0.8746], CP_C = [0.8746, -0.4848];
    NY.inCentralPark = (e, n) => { const al = e * CP_A[0] + n * CP_A[1], ac = e * CP_C[0] + n * CP_C[1]; return al > 25 * 80.4 - 4 && al < 76 * 80.4 + 4 && ac > -846 && ac < 6; };
    NY.inProspect = (e, n) => { const [pe, pn] = NY.toLocal(40.6602, -73.9690); const a = (e - pe) / 900, b = (n - pn) / 1150; return a * a + b * b < 1; };
    /* ---------------- San Francisco Bay (real topography + bathymetry, js/dem-sf.js) ---------------- */
    const SF = { x: -72000, z: 104000, R: 23000 };
    /** Finest available SF grid at a world point (each finer grid feathers into the coarser one); NaN outside. */
    function sfHeight(x, z) {
      const ox = x - SF.x, oz = z - SF.z;
      let h = demGrid(SFD[0], ox, oz);
      if (h !== h) return NaN;
      for (let k = 1; k < SFD.length; k++) {
        const G = SFD[k], e = Math.max(Math.abs(ox - G.ox), Math.abs(oz - G.oz));
        if (e > G.half - G.cell * 2) continue;
        const hk = demGrid(G, ox, oz);
        if (hk === hk) h = lerp(h, hk, smooth(G.half - G.cell * 2, G.half - G.cell * 12, e));
      }
      return h;
    }
    /** City / park / headland masks from real coordinates (lat, lon). */
    function applySF(o, x, z) {
      const dS = Math.hypot(x - SF.x, z - SF.z);
      if (!SFD || dS >= SF.R) return;
      const hs = sfHeight(x, z); if (hs !== hs) return;
      const m = smooth(SF.R, SF.R - 4000, dS);
      // beyond the data's edge the land slopes away into the procedural sea
      const hh = m < 1 ? Math.min(hs, lerp(-60, hs, m)) : hs;
      o.h = lerp(o.h, hh, m);
      o.land = lerp(o.land, smooth(-0.5, 1.0, hh), m);
      if (m > 0.05) o.wl = -1e9;
      o.mtn *= 1 - m; o.canyon *= 1 - m; o.snowZ *= 1 - m; o.ash *= 1 - m; o.him *= 1 - m;
      const lat = 37.815 + (SF.z - z) / 111000, lon = -122.44 + (x - SF.x) / 87979.5;
      let urban = 0, forest = 0, dry = 0.3;
      if (hh > 1.5) {
        const sfCity = lat < 37.811 && lon > -122.515 && lon < -122.355 && lat > 37.70;
        const presidio = lat > 37.787 && lat < 37.812 && lon > -122.485 && lon < -122.447;
        const ggPark = lat > 37.764 && lat < 37.774 && lon > -122.511 && lon < -122.453;
        if (sfCity && !presidio && !ggPark && hh < 230) urban = 1;
        if (presidio || ggPark) forest = 0.75;
        if (lon > -122.335 && hh < 90) urban = Math.max(urban, 0.9);                         // Oakland, Berkeley, Alameda
        if (lat > 37.849 && lat < 37.868 && lon > -122.49 && lon < -122.474 && hh < 70) urban = 0.7; // Sausalito
        if (lat > 37.85 && lat < 37.875 && lon > -122.445 && lon < -122.415) forest = 0.65;   // Angel Island
        if (lat > 37.815 && lon < -122.455) dry = 0.75;                                       // Marin Headlands: golden grass
      }
      o.urban = Math.max(o.urban * (1 - m), urban * m);
      o.forest = lerp(o.forest, forest, m); o.dry = lerp(o.dry, dry, m);
      o.sf = m;
    }
    function applyNYC(o, x, z) {
      const dn = Math.hypot(x - NY.cx, z - NY.cz);
      if (dn >= NY.R + 48000) return;
      if (dn > NY.R - 3500) {
        // beyond the mapped city: the real metro area is a low coastal plain (NJ, Westchester, Long Island), not
        // mountains — flatten the procedural land into gentle wooded suburbs so no peaks rise behind the skyline
        const Rw = ZONES.redwood, Jd = ZONES.jade;
        const mp = smooth(NY.R + 48000, NY.R + 6000, dn) * (1 - smooth(Rw.r * 1.35, Rw.r, zd(Rw, x, z))) * (1 - smooth(Jd.r * 1.4, Jd.r, zd(Jd, x, z))) * (AB ? smooth(4000, 10000, Math.hypot(x - AB.x, z - AB.z)) : 1);
        if (mp > 0 && o.h > 0) {
          const plain = 8 + fbm(N2, x / 5200 + 3, z / 5200, 3) * 45 + 40 + Math.pow(ridged(N1, x / 9000, z / 9000, 2), 2) * 90;
          o.h = lerp(o.h, Math.max(4, Math.min(o.h, plain)), mp);
          o.mtn *= 1 - mp; o.dry *= 1 - mp; o.canyon *= 1 - mp; o.snowZ *= 1 - mp;
          o.forest = lerp(o.forest, 0.55 + 0.3 * N3(x / 2500, z / 2500), mp);
          o.urban = Math.max(o.urban, mp * smooth(0.05, 0.45, N2(x / 3200 - 9, z / 3200 + 4)) * 0.55);
        }
        if (dn >= NY.R) return;
      }
      const m = smooth(NY.R, NY.R - 3500, dn);
      const e = x - NY.ex, n = NY.ez - z, s = nySdfLocal(e, n);
      let hl = 4;
      // the Palisades: wooded basalt cliffs on the Jersey shore north of Weehawken
      let pal = 0;
      const al = e * CP_A[0] + n * CP_A[1], ac = e * CP_C[0] + n * CP_C[1];
      if (ac < -2300) { pal = smooth(20, 420, s) * smooth(900, 3200, al); if (pal > 0) hl = 4 + pal * (82 + fbm(N2, x / 900, z / 900, 3) * 30); }
      const hc = s >= 0 ? hl : Math.max(-17, 3.6 + s * 0.3);
      o.h = lerp(o.h, hc, m);
      o.land = lerp(o.land, s > 0 ? 1 : 0, m);
      if (m > 0.2) o.wl = -1e9;
      const park = NY.inCentralPark(e, n) || NY.inProspect(e, n) ? 1 : 0;
      o.urban = m * (s > 0 ? 1 : 0) * (1 - park) * (1 - pal);
      o.mtn *= 1 - m; o.dry *= 1 - m; o.canyon *= 1 - m; o.ash *= 1 - m; o.snowZ *= 1 - m; o.him *= 1 - m;
      o.forest = lerp(o.forest, Math.max(pal, park * 0.55), m);
      o.nyc = m;
    }
    function applySites(o, x, z) {
      for (const st of SITES) {
        const dx = x - st.x, dz = z - st.z, R = (st.r || st.len) + (st.fall || 400);
        if (dx * dx + dz * dz > R * R) continue;
        const m = siteMask(st, x, z);
        if (m <= 0) continue;
        if (st.type === "plateau") {
          o.h = lerp(o.h, st.elev, Math.pow(m, 0.55));
          // rocky crags break up the shoulders so the summit reads as a natural pinnacle
          if (m < 1) { const rc = ridged(N2, x / 210, z / 210, 3); o.h += rc * rc * 150 * 4 * m * (1 - m) - 25 * (1 - m) * m; }
          if (m > 0.1) o.wl = -1e9;
        } else if (st.type === "flat" || st.type === "pad") {
          o.h = lerp(o.h, st.elev, m);
          if (m > 0.2) o.wl = -1e9;
        } else if (st.type === "seabed") {
          // a sandy basin with rolling underwater hills, deep enough to fly through
          const dd = Math.sqrt(dx * dx + dz * dz) / st.r;
          const bed = -st.depth + fbm(N2, x / 420, z / 420, 3) * 16 + Math.max(0, dd - 0.7) * 50;
          o.h = lerp(o.h, bed, m);
          o.wl = -1e9;
        } else if (st.type === "lake") {
          // bowl below the water line, shores rising into the surrounding terrain
          const dd = Math.sqrt(dx * dx + dz * dz) / st.r;
          const bowl = st.level - st.depth * Math.max(0, 1 - dd * dd) - 2;
          o.h = lerp(o.h, Math.min(o.h, bowl), m);
          if (dd < 1.25) { o.wl = st.level; o.lakeSite = 1; }
        }
      }
    }
    // legacy single-castle API, kept for callers
    function setCastle(c) { SITES = SITES.filter((x) => x.kind !== "castle"); if (c) SITES.push(Object.assign({ type: "plateau", kind: "castle" }, c)); }
    function castleMask(x, z) { let m = 0; for (const st of SITES) if (st.kind === "castle") m = Math.max(m, siteMask(st, x, z)); return m; }

    /* ---------------- height field ---------------- */
    function fields(x, z) {
      const X = x / 1000, Z = z / 1000;
      const wx = fbm(N2, X / 25, Z / 25, 2) * 6, wz = fbm(N3, X / 25 + 7.3, Z / 25 - 3.1, 2) * 6;
      const cont = fbm(N1, (X + wx) / 70, (Z + wz) / 70, 4);
      const cliff = smooth(0.15, 0.45, N3(X / 16 + 7, Z / 16 + 3));
      let land = smooth(-0.22, -0.03, cont);
      land = lerp(land, smooth(-0.12, -0.095, cont), cliff);
      const mtn = smooth(0.0, 0.4, fbm(N2, X / 38 + 31, Z / 38 - 17, 3));
      const dry = smooth(0.05, 0.33, fbm(N3, X / 50 - 60, Z / 50 + 44, 3)) * (1 - mtn * 0.85);
      const forest = smooth(-0.1, 0.35, N1(X / 1.7 + 5, Z / 1.7 - 3)) * (1 - dry);

      let h = 140 + fbm(N1, X / 5, Z / 5, 4) * 170 + fbm(N2, X / 1.3, Z / 1.3, 3) * 35 + Math.max(0, cont) * 480;
      h += cliff * 150 * smooth(-0.1, -0.02, cont) * (1 - mtn);
      const r = ridged(N1, (X + wx * 0.3) / 11, (Z + wz * 0.3) / 11, 6);
      h += Math.pow(r, 1.85) * 4300 * mtn;
      if (mtn > 0.05) h += ridged(N2, X / 2.2, Z / 2.2, 3) * 380 * mtn * r;
      // knife-edge crests and rock towers along the high ridges
      if (mtn > 0.3 && r > 0.25) h += ridged(N3, X / 0.72, Z / 0.72, 2) * 120 * smooth(0.3, 0.8, mtn) * r * r;

      if (dry > 0.001) {
        const plateau = 430 + fbm(N2, X / 9, Z / 9, 3) * 150;
        const step = 70, t = plateau / step, ft = Math.floor(t), fr = t - ft;
        const terr = (ft + smooth(0.62, 0.92, fr)) * step + fbm(N3, X * 0.9, Z * 0.9, 2) * 10;
        h = lerp(h, terr, dry);
      }

      // canyons and valleys; lakes widen the valley floor; rivers run along the bottom
      const cv = Math.abs(fbm(N3, (X + wx * 0.5) / 9, (Z + wz * 0.5) / 9, 3));
      const lake = smooth(0.35, 0.75, N2(X / 7 + 50, Z / 7 - 20)) * (1 - dry) * smooth(0.1, 0.4, mtn + 0.2);
      const cw = (0.045 + 0.02 * dry) * (1 + 1.6 * lake);
      const canyon = 1 - smooth(0, cw, cv);
      const floorH = 55 + dry * 70 + mtn * 380;
      let wl = -1e9;
      if (canyon > 0) {
        const prof = dry > 0.35 ? smooth(0, 0.3, canyon) : canyon * canyon;
        h = lerp(h, Math.min(h, floorH), prof * land);
        const riverW = 0.93 - lake * 0.35;
        if (canyon > riverW - 0.02 && dry < 0.75) {
          const bed = smooth(riverW - 0.02, riverW + 0.05, canyon);
          h -= bed * 7 * land;
          wl = floorH - 1.2;
        }
      }

      // ---- the Himalaya: a real-scale range around Mount Everest (8,848.86 m) ----
      let him = 0, glac = 0;
      const hx = x - EVX, hz = z - EVZ, dE = Math.sqrt(hx * hx + hz * hz);
      if (dE < EVR) {
        him = smooth(EVR, EVR * 0.82, dE);
        land = Math.max(land, smooth(EVR, EVR * 0.9, dE));
        // real elevation data replaces the procedural massif, fading into the foothills at the edge of the data
        const hd = DEM ? demHeight(x, z, X, Z) : NaN, wd = hd === hd ? smooth(45500, 36000, dE) : 0;
        let hh = hd;
        if (wd < 0.999) {
          // foothills climb for ~30 km into a high plateau with big ridged ranges (6–7.5 km peaks),
          // cut by deep glacial valleys
          const foot = smooth(EVR * 0.97, EVR * 0.33, dE);
          const base = lerp(350 + fbm(N3, X / 6, Z / 6, 3) * 250, 3900 + fbm(N2, X / 16 + 5, Z / 16 - 3, 3) * 700, foot);
          const rr = ridged(N3, X / 17 + 11, Z / 17 - 4, 4);
          hh = base + Math.pow(rr, 1.6) * 3500 * (0.3 + 0.7 * foot) + ridged(N1, X / 3.5, Z / 3.5, 3) * 220 * rr;
          const gv = Math.abs(N1(X / 13 + 40, Z / 13 + 40) + 0.12 * N2(X / 4 + 9, Z / 4 - 7));
          const valley = 1 - smooth(0, 0.62, gv); // broad U-shaped glacial valleys, kilometres across
          hh -= valley * valley * 2000;
          glac = valley * smooth(3600, 5200, hh + valley * valley * 2400);
          hh = Math.min(hh, 8350);
          // Everest: three-faced pyramid with ridges; exactly 8,848.86 m at the summit
          const ang = Math.atan2(hz, hx);
          // triangular footprint: three broad faces meeting in sharp ridges (NE, SE and W ridges)
          const de = dE / (1 + 0.3 * Math.cos(3 * (ang - 0.35)));
          const ridge = Math.pow(Math.max(0, Math.cos(3 * (ang - 0.35))), 14) * 420 * Math.exp(-de / 3200);
          let ev = 8848.86 - 4300 * (1 - Math.exp(-de / 3600)) - smooth(7000, 19000, de) * 6000 + ridge * smooth(0, 400, de);
          // erosion gullies and rock buttresses on the faces; none at the summit itself
          // gullies run straight down the fall line (noise stretched along the radius)
          ev -= ridged(N2, ang * 5 + 3.1, de / 1300, 2) * 200 * smooth(700, 2800, de) * (1 - smooth(9000, 16000, de));
          // blend the range's texture into the massif instead of letting peaks spike through it
          ev = Math.max(ev, lerp(ev, hh, smooth(3500, 9000, de)));
          // Lhotse (8,516 m) and Nuptse (7,861 m) on the south ridge
          const pk = (px, pz, top, k) => { const d = Math.hypot(x - EVX - px, z - EVZ - pz); return top - k * (1 - Math.exp(-d / 2600)) - smooth(5000, 14000, d) * 6000 - ridged(N3, X / 0.8, Z / 0.8, 2) * 90 * smooth(100, 900, d); };
          const sub = Math.max(pk(300, 3200, 8516, 3600), pk(-2400, 2700, 7861, 3000));
          hh = Math.max(hh, ev, sub);
          if (wd > 0) hh = lerp(hh, hd, wd);
        }
        if (wd > 0) {
          // glaciers: gentle valley floors above ~4,700 m (debris-covered lower down)
          glac = Math.max(glac * (1 - wd), wd * smooth(4600, 5100, hd) * (1 - smooth(0.12, 0.3, Math.hypot(DS[0], DS[1]))));
        }
        h = lerp(h, hh, him);
        if (him > 0.2) wl = -1e9;
      }

      // ---- fantasy realms ----
      let snowZ = 0, ash = 0, lush = 0;
      {
        const F = ZONES.fantasy, dF = zd(F, x, z);
        if (dF < F.r) {
          const m = smooth(F.r, F.r * 0.75, dF);
          land = Math.max(land, smooth(F.r, F.r * 0.85, dF));
          // rolling plains, and a great mountain wall running east–west north of the city
          let hf = 180 + fbm(N2, X / 7, Z / 7, 3) * 140;
          const wall = Math.exp(-Math.pow((z - (F.z - 9000) + Math.sin(x / 7000) * 2500) / 3800, 2));
          hf += wall * (1200 + Math.pow(ridged(N1, X / 5 + 3, Z / 5, 4), 1.6) * 2600);
          h = lerp(h, hf, m); if (m > 0.3) wl = -1e9;
          lush = m;
        }
        const Ci = ZONES.city, dC = zd(Ci, x, z);
        if (dC < Ci.r * 1.6) {
          // seven tiers stepping up a conical hill, 30 m apart, against the mountain wall
          const t = clamp(1 - dC / Ci.r, 0, 1) * 7, tier = Math.floor(t), fr = t - tier;
          const hill = 480 + (tier + smooth(0.82, 0.98, fr)) * 45;
          h = Math.max(h, lerp(h, hill, smooth(Ci.r * 1.6, Ci.r * 1.05, dC)));
        }
        const Ad = ZONES.ashland, dA = zd(Ad, x, z);
        if (dA < Ad.r) {
          const m = smooth(Ad.r, Ad.r * 0.6, dA);
          h = lerp(h, 420 + ridged(N2, X / 1.3, Z / 1.3, 3) * 120, m);
          ash = Math.max(ash, m);
          if (m > 0.2) wl = -1e9;
        }
        const V = ZONES.volcano, dV = zd(V, x, z);
        if (dV < V.r) {
          const k = 1 - dV / V.r;
          let hv = 300 + 3500 * Math.pow(k, 1.6) + fbm(N3, X * 1.4, Z * 1.4, 3) * 90 * k;
          const rim = V.r * 0.055;
          if (dV < rim) hv = 300 + 3500 * Math.pow(1 - rim / V.r, 1.6) - 260 * smooth(rim, rim * 0.4, dV); // crater
          h = Math.max(h, lerp(h, hv, smooth(V.r, V.r * 0.8, dV)));
          ash = Math.max(ash, smooth(V.r, V.r * 0.6, dV));
          wl = -1e9;
        }
        const Vl = ZONES.valley, dVl = zd(Vl, x, z);
        if (dVl < Vl.r) {
          // a deep green valley: 1.3 km walls around a narrow floor, opening to the south
          const m = smooth(Vl.r, Vl.r * 0.7, dVl);
          land = Math.max(land, smooth(Vl.r, Vl.r * 0.8, dVl));
          const lx = x - Vl.x, lz = z - Vl.z;
          const across = Math.abs(lx + Math.sin(lz / 900) * 250);
          const floor = 260 + lz * 0.012;
          const wallH = 1550 + fbm(N1, X / 2, Z / 2, 3) * 200;
          const prof = smooth(260, 900, across);
          const hv = lerp(floor, wallH, prof) + ridged(N3, X / 0.9, Z / 0.9, 2) * 60 * prof;
          h = lerp(h, hv, m);
          lush = Math.max(lush, m);
          if (m > 0.5 && across < 60) wl = floor + 0.5; else if (m > 0.2) wl = -1e9;
        }
        const J = ZONES.jade, dJ = zd(J, x, z);
        if (dJ < J.r) {
          // green river valley floor among the stone pillars (the pillars themselves are built as meshes)
          const m = smooth(J.r, J.r * 0.7, dJ);
          land = Math.max(land, smooth(J.r, J.r * 0.8, dJ));
          const hj = 90 + fbm(N2, X / 3, Z / 3, 3) * 70 + Math.pow(ridged(N3, X / 6, Z / 6, 3), 2) * 650 * smooth(J.r * 0.4, J.r * 0.9, dJ);
          h = lerp(h, hj, m);
          lush = Math.max(lush, m);
          if (m > 0.3) wl = -1e9;
        }
        const Wz = ZONES.white, dW = zd(Wz, x, z);
        if (dW < Wz.r) {
          // snowy peaks to ~3.8 km, frozen lakes in the hollows, pine forest below
          const m = smooth(Wz.r, Wz.r * 0.75, dW);
          land = Math.max(land, smooth(Wz.r, Wz.r * 0.85, dW));
          const rw = ridged(N1, X / 7 + 21, Z / 7 - 13, 4);
          let hw = 700 + fbm(N3, X / 6, Z / 6, 3) * 300 + Math.pow(rw, 1.8) * 3100;
          const basin = smooth(0.25, 0.55, N2(X / 3.2 + 70, Z / 3.2 - 70));
          hw = lerp(hw, Math.min(hw, 640), basin * (1 - smooth(0.55, 0.8, rw)));
          h = lerp(h, hw, m);
          snowZ = m;
          wl = m > 0.4 && basin > 0.6 && h < 660 ? 641 : m > 0.2 ? -1e9 : wl;
        }
        const R = ZONES.redwood, dR = zd(R, x, z);
        if (dR < R.r) {
          const m = smooth(R.r, R.r * 0.7, dR);
          land = Math.max(land, smooth(R.r, R.r * 0.8, dR));
          const hr = 220 + fbm(N2, X / 4, Z / 4, 3) * 160 + Math.pow(ridged(N1, X / 3, Z / 3, 3), 2) * 420 * smooth(R.r * 0.5, R.r, dR);
          h = lerp(h, hr, m);
          lush = Math.max(lush, m);
          if (m > 0.3) wl = -1e9;
        }
      }

      // islands: beaches and rolling hills with a rugged spine instead of needle peaks
      const i0 = Math.max(0, fbm(N2, X / 3.5 + 13, Z / 3.5 - 9, 4) - 0.26);
      const isl = i0 > 0 ? smooth(0, 0.16, i0) * (300 + fbm(N3, X / 1.4, Z / 1.4, 3) * 140) + Math.pow(ridged(N1, X / 1.8 + 3, Z / 1.8, 3), 2) * 650 * smooth(0.08, 0.3, i0) : 0;
      const sea = -240 + isl + fbm(N1, X / 2, Z / 2, 2) * 40;
      h = lerp(sea, h, land);
      if (wl > -1e8) wl = lerp(0, wl, land);

      if (AB) {
        const m = airbaseMask(x, z);
        if (m > 0) { h = lerp(h, AB.elev, m); if (m > 0.2) wl = -1e9; }
      }
      const o = { h, land, mtn: Math.max(mtn, him), dry: dry * (1 - him) * (1 - lush) * (1 - snowZ), canyon, cv, wl,
        forest: Math.max(forest * (1 - him) * (1 - ash), lush * 0.75, snowZ * smooth(1500, 700, h) * 0.8), lakeSite: 0, him, glac, snowZ, ash, urban: 0, nyc: 0, sf: 0 };
      applyNYC(o, x, z);
      applySF(o, x, z);
      if (SITES.length) applySites(o, x, z);
      return o;
    }
    function height(x, z) { return fields(x, z).h; }

    /* ---------------- colors ---------------- */
    const C = {
      sand: [0.80, 0.74, 0.56], wet: [0.50, 0.46, 0.36], seabed: [0.55, 0.52, 0.40],
      grassA: [0.33, 0.47, 0.20], grassB: [0.22, 0.36, 0.15], meadow: [0.44, 0.51, 0.25],
      forest: [0.11, 0.22, 0.10], forestB: [0.16, 0.27, 0.12], dryGrass: [0.60, 0.54, 0.33],
      rock: [0.46, 0.45, 0.43], rockB: [0.33, 0.32, 0.32], rockWarm: [0.52, 0.46, 0.39],
      snow: [0.86, 0.89, 0.93], desertA: [0.82, 0.60, 0.40], desertB: [0.68, 0.40, 0.24],
      strataA: [0.76, 0.50, 0.32], strataB: [0.55, 0.30, 0.18], strataC: [0.85, 0.71, 0.53],
      alpine: [0.40, 0.43, 0.30], bank: [0.40, 0.37, 0.29], tarmac: [0.30, 0.31, 0.30],
      ice: [0.74, 0.84, 0.92], moraine: [0.42, 0.40, 0.38], darkRock: [0.21, 0.20, 0.21], tibet: [0.55, 0.50, 0.42], yellowBand: [0.62, 0.53, 0.36],
      urbanA: [0.40, 0.40, 0.39], urbanB: [0.47, 0.45, 0.42], riprap: [0.36, 0.35, 0.33]
    };
    const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
    const T1 = [0, 0, 0], T2 = [0, 0, 0], T3 = [0, 0, 0];
    function colorFor(out, f, ny, x, z) {
      const h = f.h, slope = 1 - ny;
      const v = N2(x / 260, z / 260), v2 = N3(x / 70, z / 70);
      mix3(T1, C.grassA, C.grassB, clamp(0.5 + v * 0.5, 0, 1));
      mix3(T1, T1, C.meadow, smooth(0.3, 0.8, v2) * 0.35);
      mix3(T2, C.forest, C.forestB, clamp(0.5 + v2 * 0.5, 0, 1));
      mix3(T1, T1, T2, f.forest * 0.9);
      mix3(T1, T1, C.dryGrass, clamp(f.dry * 1.8, 0, 1) * 0.6);
      // desert sandstone with three-tone strata on slopes
      const band = 0.5 + 0.5 * Math.sin(h * 0.09 + v * 2.0), band2 = 0.5 + 0.5 * Math.sin(h * 0.031 + 1.7);
      mix3(T2, C.desertA, C.desertB, smooth(0.15, 0.5, slope));
      if (slope > 0.1) { mix3(T3, C.strataA, C.strataB, band); mix3(T3, T3, C.strataC, band2 * 0.45); mix3(T2, T2, T3, smooth(0.1, 0.38, slope)); }
      mix3(out, T1, T2, smooth(0.25, 0.6, f.dry));
      // alpine meadow, exposed rock, cliffs
      mix3(out, out, C.alpine, smooth(1300, 1900, h) * (1 - f.dry));
      const rockT = Math.max(smooth(0.26, 0.48, slope) * (1 - f.dry * 0.7), smooth(1900, 2500, h) * 0.75);
      mix3(T3, C.rock, C.rockB, clamp(0.5 + v * 0.6, 0, 1));
      mix3(T3, T3, C.rockWarm, clamp(v2 * 0.6, 0, 0.5));
      mix3(out, out, T3, rockT);
      // snow: settles on gentler slopes above a noisy snowline
      const sl = 2250 + v * 280 - f.dry * 400;
      const snow = smooth(sl, sl + 300, h) * (1 - smooth(0.45, 0.7, slope)) * (1 - f.him);
      mix3(out, out, C.snow, snow);
      if (f.snowZ > 0.01) {
        // the White Mountains: snow from ~800 m, frozen lakes white-blue
        const sl2 = 820 + v * 160;
        mix3(out, out, C.snow, smooth(sl2, sl2 + 220, h) * (1 - smooth(0.5, 0.75, slope)) * f.snowZ);
        if (f.wl > 600 && h <= f.wl + 1) mix3(out, out, C.ice, f.snowZ);
      }
      if (f.ash > 0.01) mix3(out, out, C.darkRock, f.ash * 0.85);
      if (f.him > 0.01) {
        // Himalaya: dry brown foothills, banded dark rock on steep faces, glacier ice in the valleys
        // Nepal (south): juniper/rhododendron scrub and terraces below ~4,000 m; Tibet (north, rain shadow): bare ochre
        const north = smooth(-4000, -16000, z - EVZ);
        mix3(T2, C.moraine, C.alpine, smooth(4600, 3900, h) * (0.55 + 0.25 * v2));
        mix3(T2, T2, C.forest, smooth(3700, 3100, h) * (1 - north) * 0.8);
        mix3(T2, T2, C.tibet, Math.max(north, smooth(0.25, 0.5, slope) * 0.5));
        mix3(out, out, T2, f.him * (1 - smooth(4800, 5600, h)) * 0.92);
        const face = smooth(0.32, 0.6, slope);
        // banded gneiss and granite on the walls; Everest's Yellow Band (marble, ~8,200–8,500 m) and the dark summit limestone
        mix3(T3, C.darkRock, C.rockWarm, 0.5 + 0.5 * Math.sin(h * 0.018 + v * 3.0 + N1(x / 900, z / 900) * 2.0));
        const yb = smooth(8150, 8250, h) * (1 - smooth(8480, 8560, h)) * smooth(9000, 4000, Math.hypot(x - EVX, z - EVZ));
        mix3(T3, T3, C.yellowBand, yb * 0.85);
        mix3(out, out, T3, Math.max(face, smooth(5400, 6000, h) * 0.6) * f.him * 0.95);
        // snow: a high, dry snowline (≈5,300 m south, 5,900 m north); it clings to steeper slopes the higher it goes
        const sl = lerp(5300, 5900, north) + v * 250, lim = 0.17 + smooth(5500, 8000, h) * 0.08 + v2 * 0.06;
        const sn = smooth(sl, sl + 350, h) * (1 - smooth(lim, lim + 0.14, slope)) * (0.75 + 0.25 * smooth(-0.3, 0.4, v2));
        mix3(out, out, C.snow, sn * f.him);
        if (f.glac > 0.01) {
          // clean blue-white ice up high, grey rubble (debris-covered tongue) lower down, with medial moraine stripes
          mix3(T2, C.ice, C.moraine, Math.max(smooth(0.35, 0.75, N3(x / 140, z / 700)) * 0.6, smooth(5300, 4800, h) * 0.85));
          mix3(out, out, T2, f.glac * (1 - face));
        }
      }
      // riverbanks, beaches, seabed
      if (f.wl > -1e8 && h - f.wl < 8) mix3(out, out, C.bank, smooth(8, 1, h - f.wl) * 0.8);
      if (h < 22) mix3(out, out, f.nyc > 0.5 || (f.sf > 0.5 && f.urban > 0.3) ? C.riprap : C.sand, smooth(22, 5, h) * (1 - f.dry * 0.3)); // NYC: bulkheads and riprap, not beaches
      if (h < 1.5) mix3(out, out, C.wet, smooth(1.5, -1, h) * 0.6);
      if (h < -2) mix3(out, out, C.seabed, smooth(-2, -30, h));
      if (f.urban > 0.01) { mix3(T1, C.urbanA, C.urbanB, clamp(0.5 + v2 * 0.7, 0, 1)); mix3(out, out, T1, f.urban); }
      if (AB) { const m = airbaseMask(x, z); if (m > 0.85) mix3(out, out, C.dryGrass, 0.35); }
      if (SITES.length) for (const st of SITES) {
        if (st.type !== "plateau" && st.type !== "flat" && st.type !== "pad") continue;
        const dx = x - st.x, dz = z - st.z, R = (st.r || st.len) + 50; if (dx * dx + dz * dz > R * R * 4) continue;
        const m = siteMask(st, x, z); if (m > 0.97) { mix3(out, out, C.dryGrass, 0.3); mix3(out, out, C.rock, st.type === "plateau" ? 0.25 : 0.1); }
      }
      const j = 1 + N1(x / 90, z / 90) * 0.05;
      out[0] *= j; out[1] *= j; out[2] *= j;
      return out;
    }

    /* ---------------- chunk builder ---------------- */
    /** Builds all vertex data for one terrain chunk. Pure function of its request. */
    function buildChunk(req) {
      const n = req.n, size = req.size, step = size / n;
      const x0 = req.cx * size - size / 2, z0 = req.cz * size - size / 2;
      const N1g = n + 1, E = n + 3;
      const hx = new Float32Array(E * E);
      const fA = new Array(N1g * N1g);
      for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
        const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
        const f = fields(x, z);
        hx[j * E + i] = f.h;
        if (i >= 1 && i <= n + 1 && j >= 1 && j <= n + 1) fA[(j - 1) * N1g + (i - 1)] = f;
      }

      // --- baked sun visibility (terrain self-shadowing) and ambient occlusion on a coarse grid ---
      const B = req.bakeN, bs = size / B, BN = B + 1;
      const bakeV = new Float32Array(BN * BN), bakeA = new Float32Array(BN * BN);
      const sun = req.sun, sl = Math.hypot(sun[0], sun[2]);
      const sdx = sl > 1e-4 ? sun[0] / sl : 0, sdz = sl > 1e-4 ? sun[2] / sl : 0;
      const tanE = sl > 1e-4 ? sun[1] / sl : 10;
      const DIRS = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]];
      for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) {
        const x = x0 + i * bs, z = z0 + j * bs;
        const h = Math.max(height(x, z), 0);
        let vis = 1;
        if (sun[1] <= 0.005) vis = 0.25;
        else {
          for (let s = 45; s < 6500; s *= 1.42) {
            const hl = height(x + sdx * s, z + sdz * s);
            const ray = h + 3 + s * tanE;
            const pen = 10 + s * 0.045;
            const vv = clamp((ray - hl) / pen * 0.5 + 0.5, 0, 1);
            if (vv < vis) vis = vv;
            if (vis <= 0.001 || ray > 6000) break;
          }
        }
        let occ = 0;
        for (const d of DIRS) {
          const a = height(x + d[0] * 140, z + d[1] * 140), b = height(x + d[0] * 420, z + d[1] * 420);
          occ += Math.max(0, (a - h) / 140) * 0.6 + Math.max(0, (b - h) / 420) * 0.4;
        }
        bakeV[j * BN + i] = vis;
        bakeA[j * BN + i] = clamp(1 - (occ / 8) * 0.85, 0.42, 1);
      }
      const bake = (arr, x, z) => {
        const fx = (x - x0) / bs, fz = (z - z0) / bs;
        const i = clamp(Math.floor(fx), 0, B - 1), j = clamp(Math.floor(fz), 0, B - 1);
        const u = clamp(fx - i, 0, 1), w = clamp(fz - j, 0, 1);
        const a = arr[j * BN + i], b = arr[j * BN + i + 1], c = arr[(j + 1) * BN + i], d = arr[(j + 1) * BN + i + 1];
        return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
      };

      const skirtN = 4 * N1g, vcount = N1g * N1g + skirtN;
      const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3);
      const shade = new Float32Array(vcount * 2);
      const heights = new Float32Array(N1g * N1g);
      const c = [0, 0, 0];
      let hasWater = false;
      const wpos = new Float32Array(N1g * N1g * 3), winfo = new Float32Array(N1g * N1g * 2);
      for (let j = 0; j < N1g; j++) for (let i = 0; i < N1g; i++) {
        const idx = j * N1g + i, e = (j + 1) * E + (i + 1);
        const h = hx[e], x = x0 + i * step, z = z0 + j * step;
        heights[idx] = h;
        const dx = (hx[e + 1] - hx[e - 1]) / (2 * step), dz = (hx[e + E] - hx[e - E]) / (2 * step);
        const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        const ny = il;
        pos[idx * 3] = x - req.cx * size; pos[idx * 3 + 1] = h; pos[idx * 3 + 2] = z - req.cz * size;
        nor[idx * 3] = -dx * il; nor[idx * 3 + 1] = ny; nor[idx * 3 + 2] = -dz * il;
        const f = fA[idx];
        colorFor(c, f, ny, x, z);
        col[idx * 3] = c[0]; col[idx * 3 + 1] = c[1]; col[idx * 3 + 2] = c[2];
        shade[idx * 2] = bake(bakeV, x, z); shade[idx * 2 + 1] = bake(bakeA, x, z);
        // water surface: rivers/lakes at their level, the sea at 0, otherwise buried under the ground
        let wy, depth, seaF = 0;
        if (f.wl > -1e8 && f.wl > h - 40) { wy = f.wl; depth = f.wl - h; }
        else if (h < 12) { wy = 0; depth = -h; seaF = 1; }
        else { wy = h - 15; depth = -15; }
        if (h < 12 && f.wl < 0.5) { wy = 0; depth = -h; seaF = 1; }
        if (depth > 0) hasWater = true;
        wpos[idx * 3] = x - req.cx * size; wpos[idx * 3 + 1] = wy; wpos[idx * 3 + 2] = z - req.cz * size;
        winfo[idx * 2] = depth; winfo[idx * 2 + 1] = seaF;
      }
      const edges = [];
      for (let i = 0; i < N1g; i++) edges.push(i);
      for (let i = 0; i < N1g; i++) edges.push(n * N1g + i);
      for (let j = 0; j < N1g; j++) edges.push(j * N1g);
      for (let j = 0; j < N1g; j++) edges.push(j * N1g + n);
      for (let k = 0; k < edges.length; k++) {
        const src = edges[k], d = N1g * N1g + k;
        pos[d * 3] = pos[src * 3]; pos[d * 3 + 1] = pos[src * 3 + 1] - 120; pos[d * 3 + 2] = pos[src * 3 + 2];
        for (let q = 0; q < 3; q++) { nor[d * 3 + q] = nor[src * 3 + q]; col[d * 3 + q] = col[src * 3 + q]; }
        shade[d * 2] = shade[src * 2]; shade[d * 2 + 1] = shade[src * 2 + 1];
      }
      const idxCount = n * n * 6 + 4 * n * 6;
      const index = vcount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
      let p = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * N1g + i, b = a + 1, cc = a + N1g, d = cc + 1;
        index[p++] = a; index[p++] = cc; index[p++] = b;
        index[p++] = b; index[p++] = cc; index[p++] = d;
      }
      for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
        const t0 = edges[side * N1g + i], t1 = edges[side * N1g + i + 1];
        const b0 = N1g * N1g + side * N1g + i, b1 = b0 + 1;
        index[p++] = t0; index[p++] = b0; index[p++] = t1;
        index[p++] = t1; index[p++] = b0; index[p++] = b1;
      }

      const sample = (x, z) => {
        const fx = (x - x0) / step, fz = (z - z0) / step;
        const i = clamp(Math.floor(fx), 0, n - 1), j = clamp(Math.floor(fz), 0, n - 1);
        const u = clamp(fx - i, 0, 1), w = clamp(fz - j, 0, 1);
        const a = heights[j * N1g + i], b = heights[j * N1g + i + 1], cc = heights[(j + 1) * N1g + i], d = heights[(j + 1) * N1g + i + 1];
        if (u + w <= 1) return a + (b - a) * u + (cc - a) * w;
        return d + (cc - d) * (1 - u) + (b - d) * (1 - w);
      };
      const rnd = mulberry32((req.cx * 73856093) ^ (req.cz * 19349663) ^ 0x5bd1e995);

      // --- vegetation and rocks ---
      const trees = [], rocks = [];
      if (req.trees) {
        const sp = req.treeSpacing || 46, m = Math.floor(size / sp);
        for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
          const x = x0 + (i + rnd()) * sp, z = z0 + (j + rnd()) * sp;
          const r1 = rnd(), r2 = rnd();
          const fi = clamp(Math.round((z - z0) / step), 0, n) * N1g + clamp(Math.round((x - x0) / step), 0, n);
          const f = fA[fi];
          const h = sample(x, z);
          if (h < 18 || h > 2150 || f.dry > 0.3) continue;
          if (f.wl > -1e8 && h - f.wl < 4) continue;
          if (AB && airbaseMask(x, z) > 0.05) continue;
          if (SITES.length && clearMask(x, z) > 0.55) continue;
          const hx2 = sample(x + 15, z), hz2 = sample(x, z + 15);
          const sl2 = Math.max(Math.abs(hx2 - h), Math.abs(hz2 - h)) / 15;
          if (sl2 > 0.75) continue;
          const dens = f.forest * (1 - smooth(1700, 2150, h));
          if (dens > r1 * 0.9 + 0.08) {
            const conifer = h > 600 || f.mtn > 0.35 || r2 < 0.45 ? 0 : 1;
            trees.push(x, h - 0.8, z, 0.7 + rnd() * 0.75, conifer, r2);
          }
          if (sl2 > 0.3 && f.mtn > 0.25 && r2 < 0.08) rocks.push(x, h - 1.5, z, 2 + rnd() * 5, rnd());
        }
      }

      // --- waterfalls: streams dropping off canyon walls into rivers ---
      const falls = [];
      if (req.near && rnd() < 0.55) {
        for (let k = 0; k < 60 && falls.length < 2; k++) {
          const ii = Math.floor(rnd() * N1g), jj = Math.floor(rnd() * N1g);
          const f = fA[jj * N1g + ii];
          if (!(f.wl > -1e8) || f.wl - f.h < 1.5 || f.mtn < 0.15) continue;
          const bx = x0 + ii * step, bz = z0 + jj * step;
          const a0 = rnd() * Math.PI * 2;
          for (let q = 0; q < 8; q++) {
            const a = a0 + q * Math.PI / 4, ddx = Math.cos(a), ddz = Math.sin(a);
            let ok = false, tx = 0, tz = 0, th = 0;
            for (const d of [55, 85, 120, 170]) {
              const hh = height(bx + ddx * d, bz + ddz * d);
              if (hh - f.wl > 75) { ok = true; tx = bx + ddx * d; tz = bz + ddz * d; th = hh; break; }
            }
            if (!ok) continue;
            const mid = height((bx + tx) / 2, (bz + tz) / 2);
            if (mid < f.wl + 20) continue;
            // start the fall a little back from the lip so it pours over the edge
            falls.push(tx - ddx * 6, th - 2, tz - ddz * 6, bx, f.wl, bz);
            break;
          }
        }
      }

      return {
        cx: req.cx, cz: req.cz, n, step, x0, z0, lod: req.lod, sunKey: req.sunKey, trees: !!req.trees,
        pos, nor, col, shade, index, heights,
        wpos: hasWater ? wpos : null, winfo: hasWater ? winfo : null,
        treeData: new Float32Array(trees), rockData: new Float32Array(rocks), falls: new Float32Array(falls)
      };
    }

    /* ---------------- far horizon ---------------- */
    /** Coarse terrain ring for the distant horizon (beyond the streamed chunks). */
    function buildFar(req) {
      const n = req.n, sp = req.spacing, half = n * sp / 2, N1g = n + 1;
      const H = new Float32Array((n + 3) * (n + 3)), E = n + 3;
      const F = new Array(N1g * N1g);
      for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
        const x = req.cx - half + (i - 1) * sp, z = req.cz - half + (j - 1) * sp;
        const f = fields(x, z);
        H[j * E + i] = Math.max(f.h, -1);
        if (i >= 1 && i <= N1g && j >= 1 && j <= N1g) F[(j - 1) * N1g + (i - 1)] = f;
      }
      const pos = new Float32Array(N1g * N1g * 3), nor = new Float32Array(N1g * N1g * 3), col = new Float32Array(N1g * N1g * 3);
      const c = [0, 0, 0];
      for (let j = 0; j < N1g; j++) for (let i = 0; i < N1g; i++) {
        const k = j * N1g + i, e = (j + 1) * E + (i + 1), h = H[e];
        const dx = (H[e + 1] - H[e - 1]) / (2 * sp), dz = (H[e + E] - H[e - E]) / (2 * sp);
        const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        pos[k * 3] = -half + i * sp; pos[k * 3 + 1] = Math.max(h, 0); pos[k * 3 + 2] = -half + j * sp;
        nor[k * 3] = -dx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = -dz * il;
        const f = F[k];
        if (h <= 0.5 || (f.wl > -1e8 && f.wl > h)) { c[0] = 0.05; c[1] = 0.11; c[2] = 0.15; }
        else colorFor(c, f, il, req.cx - half + i * sp, req.cz - half + j * sp);
        col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
      }
      const index = new Uint32Array(n * n * 6);
      let p = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * N1g + i, b = a + 1, cc = a + N1g, d = cc + 1;
        index[p++] = a; index[p++] = cc; index[p++] = b; index[p++] = b; index[p++] = cc; index[p++] = d;
      }
      return { far: true, ring: req.ring || 1, cx: req.cx, cz: req.cz, pos, nor, col, index, reqId: req.reqId };
    }

    return { everest: { x: EVX, z: EVZ, h: 8848.86, r: EVR, lat: 27.98806, lon: 86.92528, mN: 110900, mE: 98300.6 }, sfZone: SF, sfHeight: (x, z) => (SFD ? sfHeight(x, z) : NaN), setDEM, zones: ZONES, nyc: NY, fields, height, setAirbase, airbaseMask, setCastle, castleMask, setSites, siteMask, clearMask, buildChunk, buildFar, smooth, fbm, N1, N2, N3, mulberry32 };
  }
  root.makeTerrainGen = makeTerrainGen;
})(window.RJ = window.RJ || {});
