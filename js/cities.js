/* Ridgeline Jets — world destinations: Tokyo, Dubai and Rio de Janeiro.
 * The terrain is procedural, so each city is placed on a stretch of real coast in the generated world that suits
 * it (Dubai on dry flat coast, Rio where mountains meet the sea, Tokyo on low green coast) rather than at its true
 * geography. Each gets a flattened city site, a few thousand instanced buildings in its own character (window
 * grids that light up at night) and its signature landmarks at true height:
 *   Tokyo: Tokyo Skytree (634 m), Tokyo Tower (333 m), Mount Fuji (3,776 m) on the horizon.
 *   Dubai: Burj Khalifa (828 m), Burj Al Arab (321 m) on its island, Palm Jumeirah, the Sheikh Zayed Road towers.
 *   Rio:   Sugarloaf (396 m) and Morro da Urca, Corcovado (710 m) with Christ the Redeemer, beachfront and favelas. */
(function (RJ) {
  "use strict";
  const CI = (RJ.cities = { sites: {}, built: {} });
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
  const SPEC = {
    tokyo: { name: "Tokyo", sub: "Skytree, Tokyo Tower and Mount Fuji", R: 2300, grid: 52, icon: "city", xp: 400 },
    dubai: { name: "Dubai", sub: "Burj Khalifa, Burj Al Arab and the Palm", R: 2300, grid: 80, icon: "city", xp: 400 },
    rio: { name: "Rio de Janeiro", sub: "Sugarloaf, Corcovado and Christ the Redeemer", R: 2200, grid: 58, icon: "city", xp: 400 }
  };
  CI.SPEC = SPEC;
  if (RJ.atlas && RJ.atlas.DEFS) for (const id in SPEC) if (!RJ.atlas.DEFS.some((d) => d.id === id)) RJ.atlas.DEFS.push({ id, name: SPEC[id].name, sub: SPEC[id].sub, icon: SPEC[id].icon, r: 6000, xp: SPEC[id].xp });

  /* ======================= placement ======================= */
  CI.plan = function (gen, home, sites) {
    const zones = Object.values(gen.zones || {});
    const taken = sites.map((s) => [s.x, s.z, (s.r || s.len || 0) + 9000]);
    for (const id of ["dubai", "rio", "tokyo"]) {
      let best = null;
      for (let r = 34000; r <= (id === "dubai" ? 140000 : 96000) && !(best && best.sc < 0.2); r += 2500) for (let k = 0; k < 40; k++) {
        const a = (k / 40) * TAU + r * 1e-5, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
        const f = gen.fields(x, z);
        if (f.land < 0.97 || f.h < 2 || f.h > 90 || f.him > 0 || f.nyc > 0 || f.sf > 0 || f.snowZ > 0 || f.ash > 0) continue;
        if (id === "tokyo" && f.dry > 0.5) continue;
        if (zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) < zn.r + 6000) || taken.some(([sx, sz, sr]) => Math.hypot(sx - x, sz - z) < sr)) continue;
        // the sea must be 3–6.5 km away in some direction (the city sits on the coast, flattened core stays dry)
        let sea = null;
        for (let j = 0; j < 16 && !sea; j++) {
          const b = (j / 16) * TAU, dx = Math.cos(b), dz = Math.sin(b);
          for (let d = 2600; d <= 6500; d += 650) if (gen.height(x + dx * d, z + dz * d) < -4) { if (d >= 3000) sea = { dx, dz, d }; break; }
        }
        if (!sea) continue;
        // Dubai: low desert all round (no mountain backdrop)
        if (id === "dubai") { let bad = false; for (let j = 0; j < 8 && !bad; j++) { const b = (j / 8) * TAU; for (const d of [2500, 5000]) if (gen.height(x + Math.cos(b) * d, z + Math.sin(b) * d) > 300) { bad = true; break; } } if (bad || f.h > 60) continue; }
        let hi = 0;
        if (id === "rio") for (let j = 0; j < 12; j++) { const b = (j / 12) * TAU; for (const d of [3500, 5000]) hi = Math.max(hi, gen.height(x - sea.dx * d + Math.cos(b) * 900, z - sea.dz * d + Math.sin(b) * 900)); }
        const sc = (id === "rio" ? Math.abs(hi - 500) / 600 : 0) + f.h / 300 + Math.abs(sea.d - 4000) / 8000 + (id === "dubai" ? 1 - f.dry : 0);
        if (!best || sc < best.sc) best = { id, x, z, h: f.h, sc, sx: sea.dx, sz: sea.dz, coast: sea.d };
      }
      if (!best) continue;
      best.elev = Math.max(4, best.h);
      best.px = -best.sz; best.pz = best.sx; // along the coast
      CI.sites[id] = best;
      taken.push([best.x, best.z, 30000]);
      sites.push({ type: "flat", kind: id, x: best.x, z: best.z, r: SPEC[id].R, fall: 700, elev: best.elev });
    }
  };
  CI.spawn = function (id) {
    const S = CI.sites[id]; if (!S) return null;
    const x = S.x + S.sx * 9000 + S.px * 2500, z = S.z + S.sz * 9000 + S.pz * 2500;
    return { x, z, yaw: Math.atan2(-(S.x - x), -(S.z - z)), alt: 650 };
  };

  /* ======================= shared building material ======================= */
  const NIGHT = { value: 0 };
  function cityMat(opts) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0.2 }, opts));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = NIGHT;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCW; varying vec3 vCN;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "vec4 rjWp = vec4(transformed, 1.0); vec3 rjNo = objectNormal;",
          "#ifdef USE_INSTANCING", "rjWp = instanceMatrix * rjWp; rjNo = mat3(instanceMatrix) * rjNo;", "#endif",
          "vCW = (modelMatrix * rjWp).xyz; vCN = normalize(mat3(modelMatrix) * rjNo);"
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCW; varying vec3 vCN; uniform float rjNight;")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          // windows on walls: 3.6 m floors, 3 m bays; a random third of them lit after dark
          "if (abs(vCN.y) < 0.5) {",
          "  vec2 t = normalize(vec2(-vCN.z, vCN.x)); float u = dot(vCW.xz, t) / 3.0, v = vCW.y / 3.6;",
          "  float win = step(fract(u), 0.68) * step(fract(v), 0.58) * step(1.5, vCW.y);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35 + vec3(0.05, 0.07, 0.09), win * 0.65);",
          "  float lit = step(0.62, fract(sin(dot(floor(vec3(u, v, dot(vCW.xz, vCN.xz))), vec3(12.99, 78.23, 37.71))) * 43758.5));",
          "  totalEmissiveRadiance += vec3(1.0, 0.8, 0.52) * win * lit * rjNight * 1.3;",
          "}"
        ].join("\n"));
    };
    return m;
  }

  /* ======================= geometry helpers ======================= */
  function colorize(g, c) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3), col = new THREE.Color(c);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g;
  }
  function merge(list) {
    list = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let nv = 0; for (const g of list) nv += g.attributes.position.count;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere(); return out;
  }
  const P = [];
  function box(w, h, d, x, y, z, c, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); if (ry) g.rotateY(ry); g.translate(x, y, z); P.push(colorize(g, c)); }
  function cyl(rt, rb, h, x, y, z, c, seg = 16) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y + h / 2, z); P.push(colorize(g, c)); }
  /** Mountain from a radial profile hp(r) (0..1 of H), roughened, coloured by height and slope. */
  function mountain(R, H, hp, cols, rough = 0.06, sx = 1, sz = 1) {
    const pts = []; for (let i = 0; i <= 40; i++) { const r = (i / 40) * R; pts.push(new THREE.Vector2(Math.max(r, 0.01), hp(r / R) * H)); }
    const g = new THREE.LatheGeometry(pts.reverse(), 64);
    const p = g.attributes.position, c = new Float32Array(p.count * 3), tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const n = 1 + rough * (Math.sin(a * 7 + y * 0.004) + 0.6 * Math.sin(a * 17 + y * 0.011) + 0.35 * Math.sin(a * 31 - y * 0.02));
      p.setXYZ(i, x * n * sx, y, z * n * sz);
      cols(y / H, tmp, a); c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
    return g;
  }

  /* ======================= build ======================= */
  CI.build = function (id) {
    const S = CI.sites[id]; if (!S) return null;
    const W = RJ.world;
    const grp = new THREE.Group(); W.scene.add(grp);
    const c = (s, p) => [S.x + S.sx * s + S.px * p, S.z + S.sz * s + S.pz * p]; // sea-axis / coast-axis coords
    const groundAt = (x, z) => W.ground(x, z);
    const rects = [], peaks = [], keep = [];
    const lm = { group: grp, cx: S.x, cz: S.z, marker: V3(S.x, S.elev + 500, S.z), s: S, far: [] };
    P.length = 0;
    const solid = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh); return mesh; };
    const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const flush = (mat) => { if (!P.length) return null; const m = solid(new THREE.Mesh(merge(P.splice(0)), mat || vmat)); return m; };
    const peak = (x, z, R, H, hp, base, sx = 1, sz = 1) => peaks.push({ x, z, R, H, hp, base, sx, sz });
    const farTwin = (geo, x, y, z, col) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, fog: false }));
      m.position.set(x, y, z); m.layers.set(W.BACK); m.frustumCulled = false; W.scene.add(m); lm.far.push(m); return m;
    };

    /* ---------- landmarks ---------- */
    if (id === "tokyo") {
      // Tokyo Skytree: tapering white lattice tower, two observation decks, antenna
      const [kx, kz] = c(-500, 900), ky = groundAt(kx, kz); keep.push([kx, kz, 160]);
      cyl(13, 34, 350, kx, ky, kz, 0xdfe7ee, 12); cyl(19, 19, 18, kx, ky + 340, kz, 0x2c3a48, 24); cyl(20, 18, 6, kx, ky + 358, kz, 0xe8eef2, 24);
      cyl(10, 13, 80, kx, ky + 364, kz, 0xdfe7ee, 12); cyl(14, 14, 10, kx, ky + 444, kz, 0x2c3a48, 24); cyl(9, 11, 6, kx, ky + 454, kz, 0xe8eef2, 16);
      cyl(2, 7, 100, kx, ky + 460, kz, 0xdfe7ee, 10); cyl(0.6, 2, 74, kx, ky + 560, kz, 0xc8ccd0, 6);
      rects.push({ x: kx, z: kz, hw: 30, hl: 30, ux: 1, uz: 0, top: ky + 634 });
      // Tokyo Tower: four splayed legs, two decks, orange-and-white bands
      const [tx, tz] = c(450, -1100), ty = groundAt(tx, tz); keep.push([tx, tz, 120]);
      const band = (y) => (Math.floor(y / 30) % 2 ? 0xf0f0ec : 0xe5531a);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, lx = Math.cos(a) * 30, lz = Math.sin(a) * 30; for (let y = 0; y < 150; y += 15) { const k = 1 - y / 190; box(6 * k + 2, 15, 6 * k + 2, tx + lx * k, ty + y, tz + lz * k, band(y)); } }
      for (let y = 150; y < 250; y += 10) { const w = 17 - (y - 150) * 0.09; box(w, 10, w, tx, ty + y, tz, band(y)); }
      box(26, 10, 26, tx, ty + 145, tz, 0xd8d8d0); box(14, 6, 14, tx, ty + 248, tz, 0xd8d8d0);
      for (let y = 254; y < 333; y += 8) { const w = 6 - (y - 254) * 0.065; box(w, 8, w, tx, ty + y, tz, band(y)); }
      rects.push({ x: tx, z: tz, hw: 32, hl: 32, ux: 1, uz: 0, top: ty + 333 });
      flush();
      // Mount Fuji on the inland horizon: concave cone, crater, snow cap with streaks
      const [fx, fz] = c(-40000, 9000), fy = Math.min(groundAt(fx, fz), 300);
      const hp = (u) => Math.min(Math.pow(1 - u, 1.9) * 1.04, 1) * (u < 0.03 ? 0.97 : 1);
      const fg = mountain(15000, 3776 - fy, hp, (t, o, a) => {
        const snow = t > 0.66 + 0.06 * Math.sin(a * 23) ? 1 : 0;
        o.setRGB(0.32, 0.31, 0.3).lerp(new THREE.Color(0.27, 0.36, 0.22), RJ.smooth(0.25, 0.05, t)).lerp(new THREE.Color(0.94, 0.95, 0.98), snow);
      }, 0.015);
      const fm = solid(new THREE.Mesh(fg, vmat)); fm.position.set(fx, fy, fz);
      peak(fx, fz, 15000, 3776 - fy, hp, fy);
      lm.fuji = farTwin(fg, fx, fy, fz, 0x7c8796);
    } else if (id === "dubai") {
      // Burj Khalifa: Y-plan, three wings stepping back at different heights around a core, then the spire
      const [bx, bz] = c(-800, 0), by = groundAt(bx, bz); keep.push([bx, bz, 220]);
      const glass = 0xaab8c8, tops = [585, 515, 445];
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 + 0.3;
        for (let y = 0; y < tops[k]; y += 26) { const L = 64 * (1 - (y / tops[k]) * 0.75); box(24 - y * 0.015, 26, L, bx + Math.sin(a) * L / 2, by + y, bz + Math.cos(a) * L / 2, glass, a); }
      }
      cyl(10, 17, 600, bx, by, bz, 0xb8c6d4, 12); cyl(2.5, 8, 160, bx, by + 600, bz, 0xc8d2dc, 8); cyl(0.4, 2.5, 68, bx, by + 760, bz, 0xd0d6dc, 6);
      rects.push({ x: bx, z: bz, hw: 62, hl: 62, ux: 1, uz: 0, top: by + 220 }, { x: bx, z: bz, hw: 40, hl: 40, ux: 1, uz: 0, top: by + 585 }, { x: bx, z: bz, hw: 12, hl: 12, ux: 1, uz: 0, top: by + 828 });
      flush(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.7 }));
      // Burj Al Arab: a white sail on its own island just offshore
      const [ax, az] = c(S.coast + 280, 1800);
      const isl = new THREE.CylinderGeometry(150, 170, 8, 32); isl.translate(ax, -4, az); P.push(colorize(isl, 0xd9c49a));
      rects.push({ x: ax, z: az, hw: 150, hl: 150, ux: 1, uz: 0, top: 4 });
      flush();
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 300); sh.bezierCurveTo(40, 280, 150, 170, 175, 0); sh.lineTo(0, 0);
      const sg = new THREE.ExtrudeGeometry(sh, { depth: 46, bevelEnabled: false, curveSegments: 16 }); sg.translate(-60, 0, -23);
      const ang = Math.atan2(S.sx, S.sz) + Math.PI / 2;
      sg.rotateY(ang); sg.translate(ax, 4, az); P.push(colorize(sg, 0xf6f6f2));
      cyl(1.5, 4, 60, ax, 296, az, 0xe0e0e0, 8);
      rects.push({ x: ax, z: az, hw: 70, hl: 70, ux: 1, uz: 0, top: 321 });
      flush(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 }));
      // Palm Jumeirah: trunk, 16 fronds and the crescent breakwater, out over the sea
      const pc = S.coast + 1400, pw = -1600, sand = 0xdcc79c;
      const seg = (s0, p0, s1, p1, w) => {
        const [x0, z0] = c(s0, p0), [x1, z1] = c(s1, p1), L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
        const g = new THREE.BoxGeometry(w, 6, L); g.translate(0, -1, 0); g.rotateY(Math.atan2(ux, uz)); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); P.push(colorize(g, sand));
        rects.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: w / 2, hl: L / 2, ux, uz, top: 2 });
        return { x0, z0, ux, uz, L };
      };
      seg(S.coast - 250, pw, pc + 1500, pw, 180);
      for (let i = 0; i < 8; i++) for (const sgn of [-1, 1]) {
        const s0 = pc + i * 190 - 200, len = 650 - Math.abs(i - 3.5) * 40, a = (0.35 + i * 0.06) * sgn;
        seg(s0, pw + sgn * 80, s0 + Math.cos(Math.abs(a)) * len * 0.35, pw + sgn * (80 + Math.sin(Math.PI / 2 - Math.abs(a) * 0.4) * len), 55);
      }
      for (let i = 0; i < 14; i++) { const a0 = -1.3 + i * 0.2, a1 = a0 + 0.2, rr = 1450; seg(pc + 700 + Math.cos(a0) * rr * 0.75, pw + Math.sin(a0) * rr, pc + 700 + Math.cos(a1) * rr * 0.75, pw + Math.sin(a1) * rr, 70); }
      flush();
    } else if (id === "rio") {
      // Sugarloaf and Morro da Urca: steep granite domes rising straight out of the bay at the headland
      const dome = (u) => Math.pow(Math.max(0, 1 - u * u), 0.55);
      const rock = (t, o) => o.setRGB(0.34, 0.33, 0.31).lerp(new THREE.Color(0.2, 0.33, 0.16), RJ.smooth(0.35, 0.05, t));
      const [sx0, sz0] = c(S.coast + 350, 2200), [ux0, uz0] = c(S.coast + 50, 1500);
      const sg = mountain(330, 396, dome, rock, 0.02, 1, 0.75); const sm = solid(new THREE.Mesh(sg, vmat)); sm.position.set(sx0, -8, sz0);
      const ug = mountain(420, 220, dome, rock, 0.025, 1, 0.8); const um = solid(new THREE.Mesh(ug, vmat)); um.position.set(ux0, -8, uz0);
      peak(sx0, sz0, 330, 396, dome, -8); peak(ux0, uz0, 420, 220, dome, -8);
      lm.cable = [V3(sx0, 388, sz0), V3(ux0, 215, uz0)];
      const cg = new THREE.BufferGeometry().setFromPoints(lm.cable); grp.add(new THREE.Line(cg, new THREE.LineBasicMaterial({ color: 0x222222 })));
      // Corcovado: forested needle inland with bare rock near the top
      const [cx0, cz0] = c(-3300, -400), cy0 = Math.max(groundAt(cx0, cz0), S.elev);
      const needle = (u) => Math.pow(1 - u, 2.2);
      const cg2 = mountain(1700, 710, needle, (t, o) => o.setRGB(0.16, 0.3, 0.13).lerp(new THREE.Color(0.42, 0.4, 0.37), RJ.smooth(0.72, 0.9, t)), 0.08);
      const cm = solid(new THREE.Mesh(cg2, vmat)); cm.position.set(cx0, cy0 - 10, cz0);
      peak(cx0, cz0, 1700, 710, needle, cy0 - 10);
      // Christ the Redeemer on the summit, arms outstretched toward the bay
      const top = cy0 - 10 + 708, face = Math.atan2(S.sx, S.sz);
      box(9, 8, 9, cx0, top, cz0, 0xcfc8ba);
      const body = new THREE.CylinderGeometry(2.4, 4.2, 22, 12); body.translate(cx0, top + 19, cz0); P.push(colorize(body, 0xece6d8));
      const ar = new THREE.BoxGeometry(28, 2.6, 2.6); ar.rotateY(face); ar.translate(cx0, top + 28.5, cz0); P.push(colorize(ar, 0xece6d8));
      const head = new THREE.SphereGeometry(1.8, 12, 8); head.translate(cx0, top + 32, cz0); P.push(colorize(head, 0xece6d8));
      lm.christ = V3(cx0, top + 30, cz0);
      rects.push({ x: cx0, z: cz0, hw: 14, hl: 14, ux: 1, uz: 0, top: top + 34 });
      lm.christMesh = flush(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0 }));
      // favelas: dense small houses in bright colours climbing Corcovado's lower slopes
      lm.favela = [];
      for (let i = 0; i < 900; i++) {
        const a = Math.random() * TAU, rr = RJ.rand(700, 1500), x = cx0 + Math.cos(a) * rr, z = cz0 + Math.sin(a) * rr;
        if (Math.cos(a) * -S.sx + Math.sin(a) * -S.sz > 0.5) continue; // the seaward side toward the city
        lm.favela.push([x, z]);
      }
      CI._peaks = peaks;
    }

    /* ---------- city blocks ---------- */
    const peakH = (x, z) => { let h = -Infinity; for (const p of peaks) { const dx = (x - p.x) / p.sx, dz = (z - p.z) / p.sz, r = Math.hypot(dx, dz); if (r < p.R) h = Math.max(h, p.base + p.hp(r / p.R) * p.H); } return h; };
    const lots = [];
    const g = SPEC[id].grid, R = SPEC[id].R + 300;
    const pal = { tokyo: [0x9a9ea3, 0xb8b4aa, 0x7d868f, 0xc9c4b8, 0x646e78, 0xa89f90, 0x8c7f72], dubai: [0xcfc2a6, 0xb9ab8c, 0xd8d2c6, 0x7f95a8, 0xa4aeb8, 0x6f8294], rio: [0xd2cbbd, 0xb8ad98, 0x9ea8b0, 0xc9b998, 0x8d949a, 0xd8c7a4] }[id];
    for (let i = -Math.ceil(R / g); i <= R / g; i++) for (let j = -Math.ceil(R / g); j <= R / g; j++) {
      if (i % 5 === 0 || j % 4 === 0) continue; // streets and avenues
      const s = i * g, p = j * g, d = Math.hypot(s, p); if (d > R) continue;
      const [x, z] = c(s, p), gy = groundAt(x, z);
      if (gy < 1.5 || Math.abs(gy - S.elev) > 25 || keep.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr)) continue;
      if (peakH(x, z) > gy - 5) continue;
      let h, w = g * RJ.rand(0.5, 0.78), dd = g * RJ.rand(0.5, 0.78);
      if (id === "tokyo") {
        const dist1 = Math.hypot(s + 300, p + 1500), dist2 = Math.hypot(s - 600, p - 300);
        h = RJ.rand(12, 45) * (1 - d / R * 0.5) + 210 * Math.exp(-dist1 * dist1 / 4e5) * Math.random() + 170 * Math.exp(-dist2 * dist2 / 3e5) * Math.random();
      } else if (id === "dubai") {
        const road = Math.abs(s + 700) < 140; // Sheikh Zayed Road: a canyon of towers parallel to the coast
        if (!road && Math.random() < 0.45) continue;
        h = road ? RJ.rand(90, 360) : Math.random() < 0.1 ? RJ.rand(60, 200) : RJ.rand(6, 22);
        if (road) { w = Math.min(w, 46); dd = Math.min(dd, 46); }
      } else {
        const beach = (S.coast - 300) - s; // the beachfront: a wall of mid-rise blocks along the shore
        h = beach < 500 ? RJ.rand(35, 75) : RJ.rand(10, 40);
      }
      lots.push({ x, z, y: gy, w, d: dd, h, c: pal[Math.floor(Math.random() * pal.length)] });
    }
    // Rio favelas and Dubai's villas on the Palm fronds
    if (lm.favela) for (const [x, z] of lm.favela) { const y = peakH(x, z); if (y > 0) lots.push({ x, z, y: y - 1.5, w: RJ.rand(5, 9), d: RJ.rand(5, 9), h: RJ.rand(4, 9), c: [0xe8b04a, 0xd9563a, 0x4f9ad8, 0x6fbf73, 0xe9e0cf, 0xc74a8e][Math.floor(Math.random() * 6)] }); }
    if (id === "dubai") for (const r of rects) if (r.top === 2 && r.hw < 40) for (let k = -r.hl + 20; k < r.hl - 10; k += 34) for (const sg2 of [-1, 1]) lots.push({ x: r.x + r.ux * k - r.uz * sg2 * 16, z: r.z + r.uz * k + r.ux * sg2 * 16, y: 2, w: 12, d: 12, h: RJ.rand(6, 10), c: 0xf2ebe0 });

    const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(bg, cityMat(), lots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), Math.atan2(S.px, S.pz)), col = new THREE.Color();
    lots.forEach((b, i) => { m4.compose(V3(b.x, b.y, b.z), q, V3(b.w, b.h, b.d)); im.setMatrixAt(i, m4); im.setColorAt(i, col.set(b.c)); });
    im.castShadow = true; im.receiveShadow = true;
    grp.add(im);
    lm.count = lots.length;
    // collision grid: tallest roof per 40 m cell
    const CELL = 40, grid = new Map();
    for (const b of lots) {
      const r = Math.max(b.w, b.d) / 2;
      for (let gx = Math.floor((b.x - r) / CELL); gx <= Math.floor((b.x + r) / CELL); gx++) for (let gz = Math.floor((b.z - r) / CELL); gz <= Math.floor((b.z + r) / CELL); gz++) {
        const k = gx * 73856093 ^ gz * 19349663; grid.set(k, Math.max(grid.get(k) || -Infinity, b.y + b.h));
      }
    }
    lm.heightAt = (x, z) => {
      if (Math.abs(x - S.x) > 45000 || Math.abs(z - S.z) > 45000) return -Infinity;
      let h = grid.get(Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663);
      h = h == null ? -Infinity : h;
      for (const r of rects) { const dx = x - r.x, dz = z - r.z, u = dx * r.ux + dz * r.uz, v = -dx * r.uz + dz * r.ux; if (Math.abs(u) < r.hl && Math.abs(v) < r.hw) h = Math.max(h, r.top); }
      if (peaks.length) h = Math.max(h, peakH(x, z));
      return h;
    };
    lm.update = (dt, cam) => {
      const d = Math.hypot(cam.position.x - S.x, cam.position.z - S.z);
      grp.visible = d < 60000;
      im.visible = d < 26000;
      NIGHT.value = RJ.clamp(1 - RJ.smooth(-4, 8, W.sunElev), 0, 1);
      if (lm.christMesh) lm.christMesh.material.emissiveIntensity = NIGHT.value * 0.6; // floodlit at night
      for (const f of lm.far) { const fd = Math.hypot(cam.position.x - f.position.x, cam.position.z - f.position.z); f.visible = fd > 18000; f.material.color.set(0x7c8796).lerp(W.scene.fog.color, RJ.clamp((fd - 15000) / 120000, 0, 0.75)); }
    };
    CI.built[id] = lm;
    return lm;
  };
})(window.RJ);
