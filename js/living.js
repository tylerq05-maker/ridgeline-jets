/* Jet City — the living world: transport networks and moving life between and around the cities.
 *   · intercity corridors: a motorway and a high-speed railway between every pair of neighbouring cities (minimum
 *     spanning tree plus a couple of loops), routed by A* across the terrain (valleys, coasts and low passes preferred),
 *     on embankments, viaducts over valleys and water, and tunnels through ridges; streams of traffic and timetabled trains
 *   · airports beside every city: two runways, taxiways, aprons, a terminal, tower and hangars, with airliners that
 *     push back, taxi, take off, fly approaches, land, roll out and taxi to a free gate; ground vehicles on the apron
 *   · harbours: ferries between docks, yachts, speedboats and sailboats under way with wakes, bobbing in the swell
 *   · people: pedestrians walking in plazas, parks, stations and outside the terminals near the camera
 * Everything far away is either culled or simulated as a function of time (no per-object work when you can't see it). */
(function (RJ) {
  "use strict";
  const L = (RJ.living = { corridors: [], airports: [], harbours: [], zones: [], planned: false });
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
  const K = () => RJ.cityKit;
  const hh = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  let grp = null;

  /* ======================= network nodes ======================= */
  function nodes() {
    const out = [], C = RJ.cities;
    if (C) for (const id in C.sites) { const S = C.sites[id], T = C.STYLE[id]; out.push({ id, x: S.x, z: S.z, r: (T && T.metro) || 7000 }); }
    try { if (RJ.nyc) { const [x, z] = RJ.nyc.esbWorld(); out.push({ id: "nyc", x, z, r: 9000 }); } } catch (e) { /* no NYC */ }
    try { if (RJ.world.gen.sfZone) { const Z = RJ.world.gen.sfZone; out.push({ id: "sf", x: Z.x, z: Z.z, r: 9000 }); } } catch (e) { /* no SF */ }
    return out;
  }
  /** Minimum spanning tree over the cities, plus the two shortest extra links (loops make the network read as a network). */
  function links(N) {
    const E = [], inT = new Set([0]), used = new Set();
    const d = (a, b) => Math.hypot(N[a].x - N[b].x, N[a].z - N[b].z);
    while (inT.size < N.length) {
      let best = null;
      for (const a of inT) for (let b = 0; b < N.length; b++) if (!inT.has(b)) { const v = d(a, b); if (!best || v < best.v) best = { a, b, v }; }
      if (!best) break; inT.add(best.b); E.push(best); used.add(best.a + "-" + best.b); used.add(best.b + "-" + best.a);
    }
    const extra = [];
    for (let a = 0; a < N.length; a++) for (let b = a + 1; b < N.length; b++) if (!used.has(a + "-" + b)) extra.push({ a, b, v: d(a, b) });
    extra.sort((u, v) => u.v - v.v);
    return E.concat(extra.slice(0, 2).filter((e) => e.v < 120000));
  }

  /* ======================= routing ======================= */
  /** A* on a 1.5 km grid: cost grows with altitude and slope, water is allowed but expensive (bridges), other cities' cores are avoided. */
  function route(A, B, N) {
    const H = RJ.world.heightFn, CELL = 1500;
    const x0 = Math.min(A.x, B.x) - 30000, z0 = Math.min(A.z, B.z) - 30000, nx = Math.ceil((Math.abs(A.x - B.x) + 60000) / CELL), nz = Math.ceil((Math.abs(A.z - B.z) + 60000) / CELL);
    const idx = (i, j) => j * nx + i, hC = new Float32Array(nx * nz).fill(NaN);
    const hAt = (i, j) => { const k = idx(i, j); if (isNaN(hC[k])) hC[k] = H(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL); return hC[k]; };
    const others = N.filter((n) => n !== A && n !== B);
    const cellCost = (i, j) => {
      const h = hAt(i, j), x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL;
      let c = 1 + Math.max(0, h) / 350 + (h < -1 ? 9 + Math.min(20, -h / 8) : 0);
      for (const o of others) { const dd = Math.hypot(o.x - x, o.z - z); if (dd < o.r * 0.7) c += 30; }
      return c;
    };
    const si = Math.floor((A.sx - x0) / CELL), sj = Math.floor((A.sz - z0) / CELL), ti = Math.floor((B.sx - x0) / CELL), tj = Math.floor((B.sz - z0) / CELL);
    const g = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), open = [];
    const push = (k, f) => { open.push([f, k]); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
    const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
    const k0 = idx(si, sj), kt = idx(ti, tj); g[k0] = 0; push(k0, 0);
    if (k0 === kt || Math.hypot(A.sx - B.sx, A.sz - B.sz) < 4000) return [{ x: A.sx, z: A.sz }, { x: B.sx, z: B.sz }];
    let steps = 0;
    while (open.length && steps++ < 200000) {
      const [, k] = pop(); if (k === kt) break;
      const i = k % nx, j = (k / nx) | 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = idx(a, b), step = (di && dj ? 1.414 : 1) * (cellCost(a, b) + Math.abs(hAt(a, b) - hAt(i, j)) / 120);
        if (g[k] + step < g[kk]) { g[kk] = g[k] + step; from[kk] = k; push(kk, g[kk] + Math.hypot(a - ti, b - tj)); }
      }
    }
    if (from[kt] < 0) return null;
    const pts = []; for (let k = kt; k >= 0; k = from[k]) pts.push({ x: x0 + ((k % nx) + 0.5) * CELL, z: z0 + (((k / nx) | 0) + 0.5) * CELL });
    pts.reverse(); pts[0] = { x: A.sx, z: A.sz }; pts[pts.length - 1] = { x: B.sx, z: B.sz };
    // Chaikin smoothing: sweeping curves instead of grid steps
    let P = pts;
    for (let it = 0; it < 4; it++) { const Q = [P[0]]; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }); } Q.push(P[P.length - 1]); P = Q; }
    return P;
  }

  /* ======================= ribbon roads and railways ======================= */
  /** Samples every STEP m with a deck profile: smoothed ground, grade-limited, bridges over water and valleys,
   *  tunnels where a ridge rises more than 8 m over the deck. */
  function profile(P, STEP, o) {
    const S = []; let tot = 0;
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z); for (let t = 0; t < l; t += STEP) S.push({ x: a.x + (b.x - a.x) * t / l, z: a.z + (b.z - a.z) * t / l, d: tot + t }); tot += l; }
    const e = P[P.length - 1]; S.push({ x: e.x, z: e.z, d: tot });
    const H = RJ.world.heightFn;
    for (const p of S) p.g = H(p.x, p.z);
    const base = S.map((p) => Math.max(p.g, o.sea));
    const win = Math.max(1, Math.round(o.win / STEP));
    // running sums for a fast moving average
    const cs = new Float64Array(S.length + 1); for (let i = 0; i < S.length; i++) cs[i + 1] = cs[i] + base[i];
    for (let i = 0; i < S.length; i++) { const a = Math.max(0, i - win), b = Math.min(S.length, i + win + 1); S[i].y = (cs[b] - cs[a]) / (b - a); }
    const gr = STEP * o.grade;
    for (let i = 1; i < S.length; i++) S[i].y = Math.max(S[i].y, S[i - 1].y - gr);
    for (let i = S.length - 2; i >= 0; i--) S[i].y = Math.max(S[i].y, S[i + 1].y - gr);
    for (const p of S) { p.y += o.lift; p.tun = p.g - p.y > 8; }
    // headings and right-hand normals
    for (let i = 0; i < S.length; i++) { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; S[i].ux = (b.x - a.x) / l; S[i].uz = (b.z - a.z) / l; }
    S.len = tot;
    return S;
  }
  const sampler = (S) => ({
    prof: S, len: S.len,
    sample(d, lane, out) {
      d = Math.max(0, Math.min(S.len, d)); let lo = 0, hi = S.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].d <= d) lo = m; else hi = m; }
      const A = S[lo], B = S[hi], f = (d - A.d) / Math.max(1e-3, B.d - A.d), ux = A.ux + (B.ux - A.ux) * f, uz = A.uz + (B.uz - A.uz) * f;
      out.x = A.x + (B.x - A.x) * f + uz * lane; out.z = A.z + (B.z - A.z) * f - ux * lane; out.y = A.y + (B.y - A.y) * f; out.yaw = Math.atan2(ux, uz); out.tun = A.tun && B.tun;
      return out;
    }
  });
  let roadMat = null, railMat = null, sideMat = null;
  function mats() {
    if (roadMat) return;
    const mk = (railway) => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      m.extensions = { derivatives: true };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.rjNight = K().NIGHT; sh.uniforms.rjWet = K().WET;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aRd; varying vec2 vRd;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRd = aRd;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vRd; uniform float rjNight; uniform float rjWet;")
          .replace("#include <color_fragment>", [
            "#include <color_fragment>",
            "float u = vRd.x, v = vRd.y, pw = fwidth(v) + fwidth(u), fine = 1.0 - smoothstep(0.4, 2.5, pw);",
            "float n = fract(sin(dot(floor(vec2(u, v) * vec2(1.0, 0.25)), vec2(12.9, 78.2))) * 43758.5);",
            railway
              ? "vec3 c = vec3(0.36, 0.33, 0.29) * (0.85 + 0.25 * n * fine); float tr = abs(abs(u) - 2.3); c = mix(c, vec3(0.24, 0.2, 0.16), (1.0 - smoothstep(1.2, 1.5, tr)) * 0.8); float sl = step(0.6, fract(v / 0.65)) * (1.0 - smoothstep(1.2, 1.4, tr)); c = mix(c, vec3(0.3, 0.27, 0.22), sl * fine * 0.8); float rl = (1.0 - smoothstep(0.05, 0.05 + pw, abs(tr - 0.72))); c = mix(c, vec3(0.72, 0.74, 0.78), rl * fine); diffuseColor.rgb = c;"
              : "vec3 c = vec3(0.16, 0.165, 0.175) * (0.88 + 0.2 * n * fine); float au = abs(u); c = mix(c, vec3(0.55, 0.55, 0.52), 1.0 - step(1.2, au)); float ln = 1.0 - smoothstep(0.09, 0.09 + pw, abs(au - 12.4)); float ds = step(0.55, fract(v / 12.0)) * max(1.0 - smoothstep(0.08, 0.08 + pw, abs(au - 5.1)), 1.0 - smoothstep(0.08, 0.08 + pw, abs(au - 8.8))); c = mix(c, vec3(0.85, 0.85, 0.8), clamp(ln + ds, 0.0, 1.0) * fine * 0.85); c = mix(c, vec3(0.85, 0.7, 0.25), (1.0 - smoothstep(0.1, 0.1 + pw, abs(au - 1.45))) * fine); diffuseColor.rgb = c * (1.0 - rjWet * 0.3);",
          ].join("\n"))
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.88, 0.25, rjWet);");
      };
      return m;
    };
    roadMat = mk(false); railMat = mk(true);
    sideMat = new THREE.MeshStandardMaterial({ color: 0x8a8984, roughness: 0.9 });
  }
  /** Ribbon geometry: deck (with aRd = across, along metres) plus side walls / barriers, split into ~4 km chunks. */
  function ribbon(S, W, deckMat, barrier) {
    const out = [], CH = Math.round(4000 / (S[1].d - S[0].d));
    for (let c0 = 0; c0 < S.length - 1; c0 += CH) {
      const c1 = Math.min(S.length - 1, c0 + CH);
      const pos = [], rd = [], idx = [], sp = [], si = [];
      for (let i = c0; i <= c1; i++) {
        const p = S[i], nx = p.uz, nz = -p.ux, v = pos.length / 3;
        pos.push(p.x - nx * W / 2, p.y, p.z - nz * W / 2, p.x + nx * W / 2, p.y, p.z + nz * W / 2); rd.push(-W / 2, p.d, W / 2, p.d);
        const sv = sp.length / 3;
        // sides: barrier tops and the deck edge down 2.5 m (embankment / bridge fascia)
        for (const sd of [-1, 1]) { const ex = p.x + nx * sd * W / 2, ez = p.z + nz * sd * W / 2; sp.push(ex, p.y + (barrier ? 1.0 : 0.2), ez, ex, p.y - 2.5, ez); }
        if (i < c1 && !(p.tun && S[i + 1].tun)) {
          idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
          for (const k of [0, 2]) si.push(sv + k, sv + k + 4, sv + k + 1, sv + k + 1, sv + k + 4, sv + k + 5);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("aRd", new THREE.Float32BufferAttribute(rd, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, deckMat); m.receiveShadow = true; m.layers.set(5); grp.add(m); out.push(m);
      const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); g2.setIndex(si); g2.computeVertexNormals(); g2.computeBoundingSphere();
      const m2 = new THREE.Mesh(g2, sideMat); m2.material.side = THREE.DoubleSide; m2.layers.set(5); grp.add(m2); out.push(m2);
    }
    return out;
  }
  /** Piers under the viaducts and portals at the tunnel mouths, as one instanced mesh per corridor. */
  function piers(S, W, every) {
    const list = [];
    for (let i = 0; i < S.length; i += every) { const p = S[i]; if (!p.tun && p.y - p.g > 4.5) list.push([p.x, Math.max(p.g, -40), p.y - 1.5, p.z, Math.atan2(p.ux, p.uz), 0]); }
    for (let i = 1; i < S.length; i++) if (S[i].tun !== S[i - 1].tun) { const p = S[i]; list.push([p.x, p.y - 1, p.y + 9, p.z, Math.atan2(p.ux, p.uz), 1]); }
    if (!list.length) return null;
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.85 }), list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = V3(0, 1, 0);
    list.forEach(([x, y0, y1, z, yaw, portal], i) => m4.compose(V3(x, y0, z), q.setFromAxisAngle(Y, yaw), portal ? V3(W + 8, y1 - y0, 4) : V3(W * 0.55, y1 - y0, 3.2)) && im.setMatrixAt(i, m4));
    im.castShadow = true; im.layers.set(5); grp.add(im);
    // bounding sphere over all the instances (culling and the distance test)
    let cx = 0, cz = 0; for (const l of list) { cx += l[0]; cz += l[3]; } cx /= list.length; cz /= list.length;
    let r = 0; for (const l of list) r = Math.max(r, Math.hypot(l[0] - cx, l[3] - cz)); g.boundingSphere = new THREE.Sphere(V3(cx, 0, cz), r + 200);
    return im;
  }

  /** Corridor solids (bridges and viaducts) in a 1 km hash for collision. */
  const SOL = new Map(), sk = (x, z) => Math.floor(x / 1000) * 100003 + Math.floor(z / 1000);
  function addSolids(S, W) {
    for (let i = 0; i < S.length - 1; i += 2) {
      const p = S[i]; if (p.tun || p.y - p.g < 3) continue;
      const k = sk(p.x, p.z); if (!SOL.has(k)) SOL.set(k, []);
      SOL.get(k).push({ x: p.x, z: p.z, ux: p.ux, uz: p.uz, hl: (S[1].d - S[0].d) * 1.1, hw: W / 2, y0: p.y - 2.6, y1: p.y + 1.2 });
    }
  }
  L.solidAt = (p) => { const S = SOL.get(sk(p.x, p.z)); return !!S && K().inSolids(S, p); };

  function buildCorridors() {
    const N = nodes(); if (N.length < 2) return;
    mats();
    for (const e of links(N)) {
      const A = N[e.a], B = N[e.b], dx = B.x - A.x, dz = B.z - A.z, D = Math.hypot(dx, dz), ux = dx / D, uz = dz / D;
      // start and end where each city's metro ring meets the open country
      A.sx = A.x + ux * A.r * 0.92; A.sz = A.z + uz * A.r * 0.92; B.sx = B.x - ux * B.r * 0.92; B.sz = B.z - uz * B.r * 0.92;
      if (Math.hypot(B.sx - A.sx, B.sz - A.sz) < 1500 || D < A.r * 0.6 + B.r * 0.6) continue; // the cities already touch
      const P = route(A, B, N) || [{ x: A.sx, z: A.sz }, { x: B.sx, z: B.sz }];
      const road = profile(P, 30, { sea: 7, win: 330, grade: 0.05, lift: 1.2 });
      // the railway runs 45 m to the right of the motorway, with its own gentler profile (2.5 %)
      const PR = []; for (let i = 0; i < road.length; i += 4) { const p = road[i]; PR.push({ x: p.x + p.uz * 45, z: p.z - p.ux * 45 }); }
      PR.push({ x: road[road.length - 1].x + road[road.length - 1].uz * 45, z: road[road.length - 1].z - road[road.length - 1].ux * 45 });
      const rail = profile(PR, 30, { sea: 9, win: 600, grade: 0.025, lift: 1.5 });
      const meshes = [...ribbon(road, 26, roadMat, true), ...ribbon(rail, 12, railMat, false)];
      const pr1 = piers(road, 26, 2), pr2 = piers(rail, 12, 2);
      if (pr1) meshes.push(pr1); if (pr2) meshes.push(pr2);
      addSolids(road, 26); addSolids(rail, 12);
      const rp = sampler(road), tp = sampler(rail);
      rp.lanes = [3.25, 6.95, 10.6]; rp.speed = [27, 35];
      L.corridors.push({ a: A.id, b: B.id, len: road.len, road: rp, rail: { len: rail.len, stations: [], track: tp }, meshes });
    }
    // one traffic system and a pair of high-speed train sets per corridor
    const paths = L.corridors.map((c) => c.road);
    L.traffic = K().traffic(grp, paths, { cars: 900, range: 3200, gap: [34, 80], density: (P, d) => 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(d / 3100 + P.len * 0.001)) });
    L.trains = L.corridors.map((c, i) => K().trains(grp, c.rail, { speed: 78, acc: 0.6, cars: 8, carScale: 1.3, headway: 1100, dwell: 0, livery: [0xf2f2f0, 0xe8e4d8, 0xd8dde4][i % 3], phase: i * 300 }));
  }

  /* ======================= update & plan ======================= */
  L.plan = function () {
    if (L.planned) return; L.planned = true;
    grp = new THREE.Group(); grp.name = "living"; RJ.world.scene.add(grp);
    const t0 = performance.now();
    try { buildCorridors(); } catch (e) { console.warn("Corridors failed", e); }
    try { if (L.buildAirports) L.buildAirports(grp); } catch (e) { console.warn("Airports failed", e); }
    try { if (L.buildHarbours) L.buildHarbours(grp); } catch (e) { console.warn("Harbours failed", e); }
    try { if (L.buildPeople) L.buildPeople(grp); } catch (e) { console.warn("People failed", e); }
    console.log("Living world planned in " + Math.round(performance.now() - t0) + " ms: " + L.corridors.length + " corridors, " + Math.round(L.corridors.reduce((a, c) => a + c.len, 0) / 1000) + " km");
  };
  L.update = function (dt, cam) {
    if (!grp) return;
    const P = cam.position;
    for (const c of L.corridors) for (const m of c.meshes) { const bs = m.geometry.boundingSphere; m.visible = !bs || bs.center.distanceTo(P) - bs.radius < 26000; }
    if (L.traffic) L.traffic.update(dt, cam, true);
    if (L.trains) for (const t of L.trains) t.update(dt, cam, true);
    for (const a of L.airports) a.update(dt, cam);
    for (const h of L.harbours) h.update(dt, cam);
    if (L.people) L.people.update(dt, cam);
    for (const m of grp.children) if (m.isMesh && m.material && m.material.userData && m.material.userData.lampK != null) m.material.color.setScalar(0.1 + K().NIGHT.value * m.material.userData.lampK);
  };
  L.reset = function () { /* simulations run on world time; nothing to clear between flights */ };
})(window.RJ);

/* ======================= airports ======================= */
(function (RJ) {
  "use strict";
  const L = RJ.living, V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2, K = () => RJ.cityKit;
  const LEN = 4800, WID = 1600;
  /** A flat site beside a city: an offshore island (like Haneda or Chek Lap Kok) or open level land outside the metro ring. */
  function findSite(n, others) {
    const H = RJ.world.heightFn;
    for (const rr of [1.05, 1.25, 1.5, 1.8, 0.75, 2.1]) for (let k = 0; k < 28; k++) {
      const a = (k / 28) * TAU + rr, R = n.r * rr, x = n.x + Math.cos(a) * R, z = n.z + Math.sin(a) * R;
      if (others.some((o) => o !== n && Math.hypot(o.x - x, o.z - z) < o.r + 3500)) continue;
      for (const ang of [a + Math.PI / 2, a]) {
        const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
        let wet = 0, dry = 0, lo = Infinity, hi = -Infinity, deep = false;
        for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
          const px = x + ux * i * LEN / 8.6 + vx * j * WID / 6.4, pz = z + uz * i * LEN / 8.6 + vz * j * WID / 6.4, h = H(px, pz);
          if (h < -1.5) { wet++; if (h < -45) deep = true; } else if (h > 1.5) { dry++; lo = Math.min(lo, h); hi = Math.max(hi, h); } else { wet++; dry++; }
        }
        if (wet === 63 && !deep) return { x, z, ang, island: true, E: 4 };
        if (dry === 63 && hi - lo < 9 && hi < 500 && rr >= 1.05) return { x, z, ang, island: false, E: hi + 1.2, lo };
      }
    }
    return null;
  }
  // airport pavement: runways (piano keys, centreline, touchdown bars, edge lines), taxiways (yellow centreline), aprons
  let pavMat = null;
  function pavement() {
    if (pavMat) return pavMat;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjWet = K().WET;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aPv; varying vec4 vPv;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvPv = aPv;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec4 vPv; uniform float rjWet;")
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          // vPv: x along (m from centre), y across (m from centre), z kind (0 runway · 1 taxiway · 2 apron), w half length
          "float a = vPv.x, c = vPv.y, kind = vPv.z, hl = vPv.w, pw = fwidth(a) + fwidth(c), fine = 1.0 - smoothstep(0.5, 3.0, pw);",
          "float n = fract(sin(dot(floor(vec2(a, c) * 0.5), vec2(12.9, 78.2))) * 43758.5);",
          "vec3 col; vec3 W = vec3(0.86, 0.86, 0.82), Yc = vec3(0.86, 0.68, 0.18);",
          "if (kind < 0.5) {",
          "  col = vec3(0.15, 0.155, 0.16) * (0.9 + 0.15 * n * fine);",
          "  float ea = hl - abs(a);",
          "  col *= 1.0 - 0.25 * (1.0 - smoothstep(300.0, 900.0, ea)) * (1.0 - smoothstep(0.0, 9.0, abs(c))) * fine;",   // tyre rubber in the touchdown zones
          "  float m = (1.0 - smoothstep(0.45, 0.45 + pw, abs(c))) * step(0.4, fract(a / 50.0)) * step(80.0, ea);",          // centreline
          "  m += 1.0 - smoothstep(0.45, 0.45 + pw, abs(abs(c) - 26.5));",                                                    // edge lines
          "  m += step(ea, 52.0) * step(8.0, ea) * step(0.5, fract(c / 3.6)) * step(abs(c), 24.0);",                         // piano keys
          "  m += step(150.0, ea) * step(ea, 600.0) * step(0.65, fract(ea / 150.0)) * (step(abs(abs(c) - 11.0), 4.5));",      // touchdown bars
          "  col = mix(col, W, clamp(m, 0.0, 1.0) * fine * 0.9);",
          "} else if (kind < 1.5) {",
          "  col = vec3(0.18, 0.18, 0.19) * (0.9 + 0.15 * n * fine);",
          "  float m = 1.0 - smoothstep(0.22, 0.22 + pw, abs(c)); m += 1.0 - smoothstep(0.18, 0.18 + pw, abs(abs(c) - 11.5));",
          "  col = mix(col, Yc, clamp(m, 0.0, 1.0) * fine);",
          "} else {",
          "  col = vec3(0.56, 0.55, 0.52) * (0.9 + 0.12 * n * fine);",
          "  vec2 j = fract(vec2(a, c) / 7.5); col *= 1.0 - 0.12 * (1.0 - step(0.03, min(min(j.x, 1.0 - j.x), min(j.y, 1.0 - j.y)))) * fine;",
          "  float lead = (1.0 - smoothstep(0.2, 0.2 + pw, abs(mod(a + 47.5, 95.0) - 47.5))) * step(c, 120.0) * step(-60.0, c);",
          "  col = mix(col, Yc, lead * fine);",
          "}",
          "diffuseColor.rgb = col * (1.0 - rjWet * 0.25);"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.25, rjWet);");
    };
    return (pavMat = m);
  }

  class Airport {
    constructor(site, n, grp) {
      Object.assign(this, site); this.city = n.id; this.grp = new THREE.Group(); grp.add(this.grp);
      this.ux = Math.cos(site.ang); this.uz = Math.sin(site.ang); this.vx = -this.uz; this.vz = this.ux;
      this.yaw = Math.atan2(this.ux, this.uz);
      this.planes = []; this.parked = []; this.t = Math.random() * 60; this.next = 8; this.live = false;
      this.build();
    }
    W(u, v) { return [this.x + this.ux * u + this.vx * v, this.z + this.uz * u + this.vz * v]; }
    build() {
      const E = this.E, G = this.grp, Kk = K();
      // the platform: an island with a sea wall, or a level pad on land
      const plat = new THREE.Mesh(new THREE.BoxGeometry(LEN + 300, 1, WID + 300), new THREE.MeshStandardMaterial({ color: this.island ? 0x9d9a8f : 0x8f8d84, roughness: 0.95 }));
      const bot = this.island ? -32 : this.lo - 4; plat.scale.y = E - bot; plat.position.set(this.x, (E + bot) / 2 - 0.05, this.z); plat.rotation.y = this.yaw - Math.PI / 2; plat.receiveShadow = true; G.add(plat);
      // pavement pieces
      const pos = [], pv = [], idx = [];
      const rect = (u, v, lu, lv, kind) => { const b = pos.length / 3; for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [x, z] = this.W(u + a * lu / 2, v + c * lv / 2); pos.push(x, E + 0.06 + kind * 0.01, z); pv.push(a * lu / 2, c * lv / 2, kind, lu / 2); } idx.push(b, b + 2, b + 1, b, b + 3, b + 2); };
      rect(0, -430, 3800, 60, 0); rect(0, -680, 3600, 56, 0);                       // runways A (departures) and B (arrivals)
      rect(0, -560, 3800, 24, 1); rect(0, -300, 3800, 24, 1);                       // parallel taxiways
      for (const u of [-1850, -900, 0, 900, 1850]) rect(u, -480, 24, 400, 1);       // connectors and runway crossings
      rect(0, -40, 2600, 420, 2); rect(1600, 40, 700, 280, 2); rect(-1500, 120, 600, 240, 2); // passenger apron, cargo apron, hangar apron
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("aPv", new THREE.Float32BufferAttribute(pv, 4)); g.setIndex(idx); g.computeVertexNormals();
      const pm = new THREE.Mesh(g, pavement()); pm.receiveShadow = true; pm.renderOrder = 1; G.add(pm);
      pm.material.polygonOffset = true; pm.material.polygonOffsetFactor = -2; pm.material.polygonOffsetUnits = -2;
      // buildings through the city kit (facade shading, lit windows at night, collision grid)
      const B = new Kk.Batch(), r = RJ.world.gen.mulberry32(Math.floor(this.x) ^ Math.floor(this.z) >>> 0);
      const P = { stone: [0xd0d2d4, 0xb8bcc0, 0xe4e2dc], glass: [0x7a98ae, 0x8aa4b8], warm: 0xfff0d8, cool: 0xe0f0ff, crown: 0xffffff, metal: 0xd0d4d8 };
      const T = (u, v, w, d, h, o) => { const [x, z] = this.W(u, v); return Kk.tower(B, Object.assign({ x, z, y: E, w, d, h, ry: this.yaw, P, glassP: 1, crown: 0, spire: 0 }, o), r); };
      T(0, 330, 90, 2200, 24, { form: "box", glass: true, st: 2, lit: 0.7 });                          // terminal
      for (const u of [-700, 0, 700]) T(u, 175, 210, 34, 12, { form: "box", glass: true, st: 1, lit: 0.7 }); // piers
      T(0, 470, 120, 600, 18, { form: "box", glass: false, st: 1, lit: 0.4 });                        // parking garage
      T(1500, 250, 14, 14, 74, { form: "cyl", glass: false, st: 9, P: { stone: [0xe8e8e4], glass: [0xe8e8e4], metal: 0xd0d4d8, warm: 0xffffff, cool: 0xffffff, crown: 0xffffff } }); // tower shaft
      T(1500, 250, 26, 26, 9, { form: "oct", glass: true, st: 7, y: E + 74, lit: 0.9 });              // tower cab
      for (const u of [-1750, -1550, -1350]) T(u, 270, 150, 95, 26, { form: "box", glass: false, st: 3, lit: 0.2, P: { stone: [0xc8ccd0, 0xb0b8c0] } }); // hangars
      for (const u of [1450, 1750]) T(u, 260, 120, 160, 16, { form: "box", glass: false, st: 3, lit: 0.2, P: { stone: [0x9aa0a6, 0x8a94a0] } });      // cargo sheds
      this.meshes = Kk.meshes(B, G, P); this.hgrid = Kk.grid(B);
      // lights: runway edges (white), thresholds (green), approach lights, taxiway edges (blue); rotating beacon
      const wl = [], gl = [], bl = [];
      for (const [v, Lr] of [[-430, 3800], [-680, 3600]]) {
        for (let u = -Lr / 2; u <= Lr / 2; u += 60) for (const s of [-1, 1]) { const [x, z] = this.W(u, v + s * 29); wl.push(x, E + 0.6, z); }
        for (let k = -8; k <= 8; k++) { const [x, z] = this.W(-Lr / 2, v + k * 3); gl.push(x, E + 0.6, z); }
        for (let u = -Lr / 2 - 60; u > -Lr / 2 - 900; u -= 30) for (let k = -2; k <= 2; k++) { const [x, z] = this.W(u, v + k * 2.5); wl.push(x, E + 1 + (this.island ? 2 : 0), z); }
      }
      for (const v of [-560, -300]) for (let u = -1900; u <= 1900; u += 60) for (const s of [-1, 1]) { const [x, z] = this.W(u, v + s * 13); bl.push(x, E + 0.4, z); }
      const pts = (arr, col, size) => { const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); const m = new THREE.PointsMaterial({ color: col, size, sizeAttenuation: false, transparent: true, depthWrite: false, toneMapped: false }); const p = new THREE.Points(pg, m); p.frustumCulled = false; p.onBeforeRender = () => { m.opacity = 0.15 + K().NIGHT.value * 0.85; }; G.add(p); return p; };
      pts(wl, 0xfff4dc, 2.4); pts(gl, 0x3cff6b, 2.6); pts(bl, 0x3a7bff, 2);
      // gates (nose-in stands facing the terminal)
      this.gates = []; for (let u = -1050; u <= 1050; u += 95) if (![-700, 0, 700].some((pu) => Math.abs(pu - u) < 40)) this.gates.push({ u, plane: null });
      // apron vehicles on service loops
      this.vehicles(G);
      // collision / height: the platform top (and the buildings via the grid)
      const cx = this.x, cz = this.z, ux = this.ux, uz = this.uz;
      this.inside = (x, z, m) => { const dx = x - cx, dz = z - cz, a = dx * ux + dz * uz, c = -dx * uz + dz * ux; return Math.abs(a) < LEN / 2 + 150 + (m || 0) && Math.abs(c) < WID / 2 + 150 + (m || 0); };
    }
    vehicles(G) {
      const N = 26, g = new THREE.BoxGeometry(2.4, 2.2, 5.5); g.translate(0, 1.1, 0);
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), N); im.layers.set(5);
      const COL = [0xf2c21b, 0xf2c21b, 0xe8e8e8, 0xd03020, 0x2a5fa8, 0xffffff];
      const c = new THREE.Color(); for (let i = 0; i < N; i++) im.setColorAt(i, c.setHex(COL[i % COL.length]));
      im.frustumCulled = false; G.add(im);
      // loops: the service road in front of the gates and round the cargo apron
      const loops = [[[-1200, 150], [1200, 150], [1200, 210], [-1200, 210]], [[1300, -60], [1900, -60], [1900, 140], [1300, 140]], [[-1100, -200], [1100, -200], [1100, -160], [-1100, -160]]];
      const veh = []; for (let i = 0; i < N; i++) { const lp = loops[i % loops.length], seg = []; let tot = 0; for (let k = 0; k < lp.length; k++) { const a = lp[k], b = lp[(k + 1) % lp.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push({ a, b, l, d: tot }); tot += l; } veh.push({ seg, tot, s: Math.random() * tot, v: 5 + Math.random() * 6 }); }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), one = V3(1, 1, 1), Y = V3(0, 1, 0);
      this.vehUpdate = (dt) => {
        veh.forEach((V, i) => {
          V.s = (V.s + V.v * dt) % V.tot; const S = V.seg.find((s) => V.s >= s.d && V.s < s.d + s.l) || V.seg[0], f = (V.s - S.d) / S.l;
          const u = S.a[0] + (S.b[0] - S.a[0]) * f, v = S.a[1] + (S.b[1] - S.a[1]) * f, [x, z] = this.W(u, v);
          const du = S.b[0] - S.a[0], dv = S.b[1] - S.a[1], dx = this.ux * du + this.vx * dv, dz = this.uz * du + this.vz * dv;
          m4.compose(p.set(x, this.E, z), q.setFromAxisAngle(Y, Math.atan2(dx, dz)), one); im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
      };
    }
    /* ---------- aircraft ---------- */
    model(id) {
      const g = RJ.buildAircraft(id, "default"); RJ.setGear(g, 1);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      const bb = new THREE.Box3().setFromObject(g); g.userData.lift = -bb.min.y; g.userData.id = id;
      this.grp.add(g); return g;
    }
    pickType() { const r = Math.random(); return r < 0.5 ? "b738" : r < 0.8 ? "e175" : "a380"; }
    populate() {
      for (const G of this.gates) if (Math.random() < 0.6) { const m = this.model(this.pickType()); this.park(m, G); }
      this.live = true;
    }
    park(m, G) {
      G.plane = m; const [x, z] = this.W(G.u, 40);
      m.position.set(x, this.E + m.userData.lift, z); m.rotation.set(0, Math.atan2(-this.vx, -this.vz), 0); // nose toward +v (the terminal)
      RJ.setGear(m, 1);
    }
    clear() { for (const G of this.gates) G.plane = null; for (const p of this.planes) p.m = null; this.planes = []; for (let i = this.grp.children.length - 1; i >= 0; i--) { const o = this.grp.children[i]; if (o.userData && o.userData.id) { this.grp.remove(o); o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); } } this.live = false; }
    /** A path follower on the ground: polyline in (u, v), rounded corners, speed profile, optional reverse (pushback). */
    path(pts, vmax, opts) {
      let P = pts.map((p) => ({ u: p[0], v: p[1] }));
      for (let it = 0; it < 2; it++) { const Q = [P[0]]; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push({ u: a.u * 0.75 + b.u * 0.25, v: a.v * 0.75 + b.v * 0.25 }, { u: a.u * 0.25 + b.u * 0.75, v: a.v * 0.25 + b.v * 0.75 }); } Q.push(P[P.length - 1]); P = Q; }
      let d = 0; P[0].d = 0; for (let i = 1; i < P.length; i++) { d += Math.hypot(P[i].u - P[i - 1].u, P[i].v - P[i - 1].v); P[i].d = d; }
      return Object.assign({ P, len: d, s: 0, vmax }, opts || {});
    }
    at(path, s) { const P = path.P; let i = 1; while (i < P.length - 1 && P[i].d < s) i++; const a = P[i - 1], b = P[i], f = RJ.clamp((s - a.d) / Math.max(1e-3, b.d - a.d), 0, 1); return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f, du: b.u - a.u, dv: b.v - a.v }; }
    depart() {
      const busy = this.gates.filter((G) => G.plane && !G.plane.userData.moving); if (!busy.length) return;
      const G = busy[Math.floor(Math.random() * busy.length)], m = G.plane; G.plane = null; m.userData.moving = true;
      const u0 = G.u, push = this.path([[u0, 40], [u0, -110]], 2, { reverse: true });
      const taxi = this.path([[u0, -110], [u0 - 80, -160], [-1700, -160], [-1850, -230], [-1850, -400], [-1900, -430], [-1880, -430]], 9);
      this.planes.push({ m, phase: "push", p: push, next: taxi, v: 0, t: 0 });
    }
    arrive() {
      const free = this.gates.filter((G) => !G.plane); if (!free.length) return;
      const G = free[Math.floor(Math.random() * free.length)];
      const m = this.model(this.pickType()); m.userData.moving = true; G.plane = m;
      this.planes.push({ m, phase: "approach", u: -1800 - 14000, alt: 14000 * Math.tan(3 * Math.PI / 180), v: 72, G, t: 0 });
    }
    update(dt, cam) {
      const d = Math.hypot(cam.position.x - this.x, cam.position.z - this.z);
      for (const m of this.meshes) m.visible = d < 24000;
      if (d > 32000) { if (this.live) this.clear(); return; }
      if (!this.live) this.populate();
      if (this.vehUpdate && d < 9000) this.vehUpdate(dt);
      // schedule: alternate departures and arrivals, at most three aircraft moving
      this.t += dt; this.next -= dt;
      if (this.next <= 0 && this.planes.length < 3) { if (Math.random() < 0.5) this.depart(); else this.arrive(); this.next = RJ.rand(35, 75); }
      const E = this.E, deg = Math.PI / 180;
      for (let i = this.planes.length - 1; i >= 0; i--) {
        const A = this.planes[i], m = A.m; A.t += dt;
        let u, v, hdu, hdv, y = E + m.userData.lift, pitch = 0;
        if (A.phase === "push" || A.phase === "taxi" || A.phase === "toGate") {
          const P = A.p, vt = P.vmax * RJ.smooth(0, 25, P.len - P.s + 4);
          A.v += RJ.clamp(vt - A.v, -1.5 * dt, 1.0 * dt); P.s = Math.min(P.len, P.s + Math.max(0.3, A.v) * dt);
          const q = this.at(P, P.s); u = q.u; v = q.v; hdu = P.reverse ? -q.du : q.du; hdv = P.reverse ? -q.dv : q.dv;
          if (P.s >= P.len - 0.5) {
            if (A.phase === "push") { A.phase = "taxi"; A.p = A.next; A.v = 0; }
            else if (A.phase === "taxi") { A.phase = "roll"; A.u = -1880; A.v = 0; }
            else { this.park(m, A.G); m.userData.moving = false; this.planes.splice(i, 1); continue; }
          }
        } else if (A.phase === "roll") {
          A.v += 2.1 * dt; A.u += A.v * dt; u = A.u; v = -430; hdu = 1; hdv = 0;
          if (A.v > 76) { A.phase = "climb"; A.alt = 0; }
        } else if (A.phase === "climb") {
          A.v = Math.min(120, A.v + 1.2 * dt); A.u += A.v * dt; A.alt += A.v * 0.13 * dt; u = A.u; v = -430; hdu = 1; hdv = 0; y += A.alt; pitch = Math.min(9, 3 + A.alt * 0.2) * deg;
          if (A.alt > 40) RJ.setGear(m, Math.max(0, 1 - (A.alt - 40) / 60));
          if (A.u > 16000) { this.grp.remove(m); m.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); this.planes.splice(i, 1); continue; }
        } else if (A.phase === "approach") {
          A.u += A.v * dt; const togo = -1500 - A.u; A.alt = Math.max(0, togo * Math.tan(3 * deg)); u = A.u; v = -680; hdu = 1; hdv = 0;
          const flare = RJ.smooth(18, 0, A.alt); y += A.alt; pitch = (2.5 + flare * 3) * deg;
          if (togo <= 0) { A.phase = "rollout"; A.alt = 0; }
        } else if (A.phase === "rollout") {
          A.v = Math.max(16, A.v - 2.4 * dt); A.u += A.v * dt; u = A.u; v = -680; hdu = 1; hdv = 0; pitch = Math.max(0, 5.5 - A.t * 0) * 0;
          if (A.v <= 16.5 && A.u > -600) {
            const ex = [0, 900, 1850].find((e) => e > A.u + 120) || 1850, gu = A.G.u;
            A.phase = "toGate"; A.v = 14;
            A.p = this.path([[A.u, -680], [ex - 60, -680], [ex, -620], [ex, -320], [ex - Math.sign(ex - gu) * 60, -160], [gu + Math.sign(ex - gu) * 60, -160], [gu, -110], [gu, 40]], 10);
          }
        }
        const [x, z] = this.W(u, v), dx = this.ux * hdu + this.vx * hdv, dz = this.uz * hdu + this.vz * hdv;
        m.position.set(x, y, z);
        const hd = Math.atan2(-dx, -dz); // model nose is -z
        m.rotation.set(pitch, hd, 0, "YXZ");
      }
    }
  }
  L.heightAt = (x, z) => { let h = -Infinity; for (const a of L.airports) if (a.inside(x, z)) { h = Math.max(h, a.E, a.hgrid(x, z)); } return h; };
  L.blocked = (x, z) => L.airports.some((a) => a.inside(x, z, 250));
  L.buildAirports = function (grp) {
    const N = [];
    const C = RJ.cities;
    if (C) for (const id in C.sites) { const S = C.sites[id], T = C.STYLE[id]; N.push({ id, x: S.x, z: S.z, r: (T && T.metro) || 7000 }); }
    try { if (RJ.nyc) { const [x, z] = RJ.nyc.esbWorld(); N.push({ id: "nyc", x, z, r: 13000 }); } } catch (e) { /* */ }
    try { const Z = RJ.world.gen.sfZone; if (Z) N.push({ id: "sf", x: Z.x, z: Z.z, r: 12000 }); } catch (e) { /* */ }
    for (const n of N) { const s = findSite(n, N); if (s) L.airports.push(new Airport(s, n, grp)); }
  };
})(window.RJ);

/* ======================= harbours and people ======================= */
(function (RJ) {
  "use strict";
  const L = RJ.living, V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2, K = () => RJ.cityKit;
  // boat kinds: length, beam, speed (m/s), colours, mast
  const BOATS = {
    ferry: { L: 48, B: 12, v: 9, hull: 0xf2f2ee, deck: 0x2a5fa8, cabin: 2, n: 0 },
    yacht: { L: 22, B: 6, v: 7, hull: 0xf6f6f2, deck: 0xdcdcd4, cabin: 1, n: 0 },
    speed: { L: 9, B: 3, v: 17, hull: 0xe8e8e8, deck: 0x24303c, cabin: 0, n: 0 },
    sail: { L: 13, B: 4, v: 4, hull: 0xffffff, deck: 0xb89a6a, cabin: 0, mast: true, n: 0 },
    tug: { L: 26, B: 9, v: 6, hull: 0x2a2a2a, deck: 0xc23b22, cabin: 1, n: 0 }
  };
  function boatMesh(k) {
    const T = BOATS[k], g = new THREE.Group(), hullM = new THREE.MeshStandardMaterial({ color: T.hull, roughness: 0.35, metalness: 0.1 });
    const sh = new THREE.Shape(); sh.moveTo(-T.B / 2, -T.L / 2); sh.lineTo(T.B / 2, -T.L / 2); sh.lineTo(T.B / 2, T.L * 0.2); sh.quadraticCurveTo(T.B / 2, T.L / 2, 0, T.L / 2); sh.quadraticCurveTo(-T.B / 2, T.L / 2, -T.B / 2, T.L * 0.2); sh.lineTo(-T.B / 2, -T.L / 2);
    const hg = new THREE.ExtrudeGeometry(sh, { depth: T.L * 0.09 + 1, bevelEnabled: false }); hg.rotateX(-Math.PI / 2); hg.translate(0, -0.8, 0);
    const hull = new THREE.Mesh(hg, hullM); hull.castShadow = true; g.add(hull);
    const top = T.L * 0.09 + 0.2;
    if (T.cabin) for (let i = 0; i < T.cabin; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(T.B * (0.8 - i * 0.15), 2.4, T.L * (0.45 - i * 0.12)), new THREE.MeshStandardMaterial({ color: i ? T.deck : 0xeeeeea, roughness: 0.4 })); c.position.set(0, top + 1.2 + i * 2.4, -T.L * 0.05); c.castShadow = true; g.add(c); const w = new THREE.Mesh(new THREE.BoxGeometry(T.B * (0.82 - i * 0.15), 0.7, T.L * (0.42 - i * 0.12)), new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0 })); w.position.set(0, top + 1.5 + i * 2.4, -T.L * 0.05); g.add(w); g.userData.win = w; }
    else { const c = new THREE.Mesh(new THREE.BoxGeometry(T.B * 0.6, 0.9, T.L * 0.25), new THREE.MeshStandardMaterial({ color: T.deck, roughness: 0.4 })); c.position.set(0, top + 0.4, -T.L * 0.05); g.add(c); }
    if (T.mast) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, T.L * 1.3, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd })); m.position.set(0, top + T.L * 0.65, T.L * 0.08); g.add(m); const sg = new THREE.BufferGeometry().setFromPoints([V3(0, top + 1, T.L * 0.08), V3(0, top + T.L * 1.25, T.L * 0.08), V3(0, top + 1, -T.L * 0.4)]); sg.computeVertexNormals(); const sail = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xfafaf6, side: THREE.DoubleSide, roughness: 0.8 })); g.add(sail); }
    // wake: a fading V of foam behind the stern and a bow wave
    const wg = new THREE.PlaneGeometry(1, 1); wg.rotateX(-Math.PI / 2); wg.translate(0, 0, 0.5);
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, alphaMap: wakeTex() });
    const wake = new THREE.Mesh(wg, wm); wake.position.set(0, -0.6, -T.L / 2); wake.scale.set(T.B * 3, 1, T.L * 3); wake.rotation.y = Math.PI; g.add(wake); g.userData.wake = wake;
    g.userData.T = T;
    return g;
  }
  let WT = null;
  function wakeTex() {
    if (WT) return WT;
    const c = document.createElement("canvas"); c.width = 64; c.height = 128; const x = c.getContext("2d"), im = x.createImageData(64, 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 64; i++) { const u = (i - 31.5) / 32, v = j / 128, arm = Math.abs(Math.abs(u) - v * 0.9), core = Math.abs(u) < 0.12 + v * 0.15 ? 0.7 : 0, a = Math.max(Math.exp(-arm * arm * 400) * 0.9, core) * (1 - v) * (0.75 + 0.25 * Math.random()); const k = (j * 64 + i) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = 255 * a; im.data[k + 3] = 255; }
    x.putImageData(im, 0, 0); WT = new THREE.CanvasTexture(c); return WT;
  }
  class Harbour {
    constructor(n, grp) {
      this.n = n; this.grp = new THREE.Group(); grp.add(this.grp); this.boats = []; this.live = false;
      // water points around the city's shore (sampled once): within 1.2–9 km, deep enough, open water around them
      const H = RJ.world.heightFn, W = [];
      for (let i = 0; i < 900 && W.length < 70; i++) {
        const a = Math.random() * TAU, r = RJ.lerp(n.r * 0.25, n.r * 0.85, Math.random()), x = n.x + Math.cos(a) * r, z = n.z + Math.sin(a) * r;
        if (H(x, z) < -6 && H(x + 60, z) < -4 && H(x - 60, z) < -4 && H(x, z + 60) < -4 && H(x, z - 60) < -4 && !(L.blocked && L.blocked(x, z))) W.push({ x, z });
      }
      this.W = W;
    }
    clearLine(a, b) { const H = RJ.world.heightFn; for (let k = 1; k < 12; k++) { const f = k / 12; if (H(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f) > -3) return false; } return true; }
    nextWp(B) { for (let t = 0; t < 12; t++) { const w = this.W[Math.floor(Math.random() * this.W.length)]; if (w !== B.wp && Math.hypot(w.x - B.x, w.z - B.z) > 400 && this.clearLine(B, w)) return w; } return this.W[Math.floor(Math.random() * this.W.length)]; }
    spawn() {
      if (this.W.length < 4) return;
      const kinds = ["ferry", "ferry", "yacht", "yacht", "yacht", "speed", "speed", "speed", "sail", "sail", "sail", "tug"];
      for (const k of kinds) { const m = boatMesh(k), w = this.W[Math.floor(Math.random() * this.W.length)]; this.grp.add(m); const B = { m, k, T: m.userData.T, x: w.x, z: w.z, hd: Math.random() * TAU, v: 0, ph: Math.random() * 10, wait: 0 }; B.wp = this.nextWp(B); this.boats.push(B); }
      this.live = true;
    }
    clear() { for (const B of this.boats) { this.grp.remove(B.m); B.m.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } this.boats = []; this.live = false; }
    update(dt, cam) {
      const d = Math.hypot(cam.position.x - this.n.x, cam.position.z - this.n.z);
      if (d > this.n.r + 14000) { if (this.live) this.clear(); return; }
      if (!this.live) this.spawn();
      const t = performance.now() / 1000, night = K().NIGHT.value, sea = RJ.weather && RJ.weather.turb != null ? 1 + RJ.weather.turb * 0.5 : 1;
      for (const B of this.boats) {
        if (B.wait > 0) { B.wait -= dt; B.v = Math.max(0, B.v - dt * 1.5); }
        else {
          const dx = B.wp.x - B.x, dz = B.wp.z - B.z, dist = Math.hypot(dx, dz), want = Math.atan2(dx, dz);
          let da = want - B.hd; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          const turn = (B.k === "speed" ? 0.5 : B.k === "ferry" ? 0.07 : 0.15);
          B.hd += RJ.clamp(da, -turn * dt, turn * dt);
          const vt = B.T.v * (Math.abs(da) > 0.8 ? 0.4 : 1) * RJ.smooth(0, B.T.L * 4, dist);
          B.v += RJ.clamp(vt - B.v, -dt * 0.8, dt * (B.k === "speed" ? 2.5 : 0.4));
          if (dist < B.T.L * 1.5) { B.wp = this.nextWp(B); if (B.k === "ferry") B.wait = 25; }
        }
        B.x += Math.sin(B.hd) * B.v * dt; B.z += Math.cos(B.hd) * B.v * dt;
        // swell: heave, pitch and roll by size; speedboats ride bow-up
        const s = 1 / Math.sqrt(B.T.L / 10);
        B.m.position.set(B.x, Math.sin(t * 1.3 + B.ph) * 0.35 * s * sea, B.z);
        B.m.rotation.set(Math.sin(t * 1.1 + B.ph) * 0.035 * s * sea - (B.k === "speed" ? RJ.smooth(4, 16, B.v) * 0.08 : 0), B.hd, Math.sin(t * 0.9 + B.ph * 1.7) * 0.05 * s * sea, "YXZ");
        const w = B.m.userData.wake; w.material.opacity = RJ.smooth(0.5, B.T.v * 0.7, B.v) * 0.55; w.scale.z = B.T.L * (1.5 + B.v * 0.25);
        if (B.m.userData.win) B.m.userData.win.material.emissiveIntensity = night * 1.4;
      }
    }
  }
  L.buildHarbours = function (grp) {
    const C = RJ.cities, N = [];
    if (C) for (const id in C.sites) { const S = C.sites[id], T = C.STYLE[id]; N.push({ id, x: S.x + S.sx * S.coast, z: S.z + S.sz * S.coast, r: 9000 }); }
    try { if (RJ.nyc) { const [x, z] = RJ.nyc.esbWorld(); N.push({ id: "nyc", x, z, r: 9000 }); } } catch (e) { /* */ }
    try { const Z = RJ.world.gen.sfZone; if (Z) N.push({ id: "sf", x: Z.x, z: Z.z, r: 9000 }); } catch (e) { /* */ }
    for (const n of N) L.harbours.push(new Harbour(n, grp));
  };

  /* ---------- pedestrians ---------- */
  // one walking figure (legs swing in the vertex shader from a per-instance phase), clothes coloured per instance
  L.buildPeople = function (grp) {
    const parts = [], add = (w, h, d, x, y, z, leg) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const n = g.attributes.position.count; g.setAttribute("aLeg", new THREE.Float32BufferAttribute(new Float32Array(n).fill(leg), 1)); parts.push(g); };
    add(0.17, 0.85, 0.2, -0.11, 0.43, 0, -1); add(0.17, 0.85, 0.2, 0.11, 0.43, 0, 1);    // legs
    add(0.46, 0.66, 0.26, 0, 1.18, 0, 0); add(0.12, 0.6, 0.14, -0.3, 1.2, 0, 2); add(0.12, 0.6, 0.14, 0.3, 1.2, 0, -2); // torso, arms
    add(0.22, 0.24, 0.24, 0, 1.66, 0, 0);                                                 // head
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N2 = new Float32Array(n * 3), A = new Float32Array(n); let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); N2.set(g.attributes.normal.array, o * 3); A.set(g.attributes.aLeg.array, o); o += g.attributes.position.count; }
    const G = new THREE.BufferGeometry(); G.setAttribute("position", new THREE.BufferAttribute(P, 3)); G.setAttribute("normal", new THREE.BufferAttribute(N2, 3)); G.setAttribute("aLeg", new THREE.BufferAttribute(A, 1));
    const MAX = 3200, ph = new Float32Array(MAX), cheer = new Float32Array(MAX);
    G.setAttribute("aPh", new THREE.InstancedBufferAttribute(ph, 1));
    G.setAttribute("aCheer", new THREE.InstancedBufferAttribute(cheer, 1));
    const time = { value: 0 }, airTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.rjT = time; sh.uniforms.rjAir = airTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aLeg; attribute float aPh; attribute float aCheer; uniform float rjT; uniform float rjAir;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat air = rjAir;\nfloat sw = sin(rjT * 7.0 + aPh) * 0.5 * sign(aLeg) * step(0.001, aPh) - step(1.5, abs(aLeg)) * (aCheer > 1.95 ? step(1.5, aLeg) * 1.15 : step(0.5, aCheer) * (0.62 + 0.38 * sin(rjT * 8.0 + fract(aCheer) * 6.283))) * air * 0.9;\nfloat hip = abs(aLeg) > 1.5 ? 1.45 : 0.86;\nif (abs(aLeg) > 0.5) { float yy = transformed.y - hip; transformed.z += -yy * sin(sw) * (abs(aLeg) > 1.5 ? 0.7 : 1.0); transformed.y = hip + yy * cos(sw); }");
    };
    const im = new THREE.InstancedMesh(G, mat, MAX); im.count = 0; im.frustumCulled = false; im.layers.set(5); grp.add(im);
    const CL = [0x2a2f3a, 0x8a1c1c, 0x1c3a7a, 0xd8d0c0, 0x3a5a2a, 0x6a4a8a, 0xc87a1a, 0x101010, 0xe8e8e8, 0x5a6a7a];
    const col = new THREE.Color(); for (let i = 0; i < MAX; i++) im.setColorAt(i, col.setHex(CL[i % CL.length]));
    const people = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), sc = V3(1, 1, 1), Y = V3(0, 1, 0);
    let active = null;
    L.people = {
      im,
      setAirshow(k) { airTime.value = k; }, // 0..1: how hard the airshow crowd is cheering
      update(dt, cam) {
        time.value += dt;
        // the nearest people zone within 1.2 km gets a crowd (zones: plazas, parks, stations, terminals, beaches)
        let best = null, bd = 1200;
        for (const Z of L.zones) { const d = Math.hypot(Z.x - cam.position.x, Z.z - cam.position.z) - Z.r; if (d < bd) { bd = d; best = Z; } }
        if (best !== active) {
          active = best; people.length = 0;
          if (best) {
            const n = Math.min(MAX, Math.round(best.n || best.r * best.r * 0.02));
            for (let i = 0; i < n; i++) {
              let x, z, hd, isCheer = false;
              if (best.type === "airshow") {
                const a = (Math.random() - 0.5) * best.length, d = (Math.random() - 0.5) * best.depth;
                x = best.x + best.alongX * a + best.seaX * d; z = best.z + best.alongZ * a + best.seaZ * d;
                hd = best.heading; isCheer = Math.random() < 0.8;
              } else { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * best.r; x = best.x + Math.cos(a) * r; z = best.z + Math.sin(a) * r; hd = Math.random() * TAU; }
              people.push({ x, z, hd, v: best.type === "airshow" ? 0 : (Math.random() < 0.2 ? 0 : RJ.lerp(1.0, 1.6, Math.random())), t: Math.random() * 8, ph: 1 + Math.random() * 6, cheer: isCheer ? (Math.random() < 0.2 ? 2 : 1 + Math.random() * 0.98) : 0 }); // 2: holding a phone up
            }
          }
        }
        if (!active || cam.position.y - active.y > 900) { im.count = 0; return; }
        let n = 0;
        for (const P of people) {
          P.t -= dt; if (P.t < 0) { P.t = RJ.lerp(3, 10, Math.random()); P.hd += RJ.lerp(-1.2, 1.2, Math.random()); if (Math.random() < 0.15) P.v = P.v ? 0 : RJ.lerp(1.0, 1.6, Math.random()); }
          P.x += Math.sin(P.hd) * P.v * dt; P.z += Math.cos(P.hd) * P.v * dt;
          if (active.type === "airshow") { P.hd = active.heading; P.v = 0; }
          else if (Math.hypot(P.x - active.x, P.z - active.z) > active.r) P.hd = Math.atan2(active.x - P.x, active.z - P.z);
          m4.compose(p.set(P.x, active.y, P.z), q.setFromAxisAngle(Y, P.hd), sc); im.setMatrixAt(n, m4); ph[n] = P.v ? P.ph : 0; cheer[n] = P.cheer || 0; n++;
        }
        im.count = n; im.instanceMatrix.needsUpdate = true; G.attributes.aPh.needsUpdate = true; G.attributes.aCheer.needsUpdate = true;
      }
    };
    // zones from the cities' plazas and parks, rail stations and airport terminals
    for (const a of L.airports) { const [x, z] = a.W(0, 420); L.zones.push({ x, z, y: a.E, r: 160, n: 260 }); }
  };
  L.addZone = (z) => L.zones.push(z);
  L.removeZone = (z) => { const i = L.zones.indexOf(z); if (i >= 0) L.zones.splice(i, 1); };
})(window.RJ);
