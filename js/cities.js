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
    tokyo: { name: "Tokyo", sub: "Skytree, Tokyo Tower and Mount Fuji", R: 3000, grid: 52, icon: "city", xp: 400 },
    dubai: { name: "Dubai", sub: "Burj Khalifa, Burj Al Arab and the Palm", R: 3000, grid: 80, icon: "city", xp: 400 },
    rio: { name: "Rio de Janeiro", sub: "Sugarloaf, Corcovado and Christ the Redeemer", R: 2600, grid: 58, icon: "city", xp: 400 },
    hk: { name: "Hong Kong", sub: "Victoria Harbour, the Peak and a forest of towers", R: 2600, grid: 58, icon: "city", xp: 400 },
    chicago: { name: "Chicago", sub: "Willis Tower, the river and the lakefront", R: 3000, grid: 100, icon: "city", xp: 400 }
  };
  CI.SPEC = SPEC;
  if (RJ.atlas && RJ.atlas.DEFS) for (const id in SPEC) if (!RJ.atlas.DEFS.some((d) => d.id === id)) RJ.atlas.DEFS.push({ id, name: SPEC[id].name, sub: SPEC[id].sub, icon: SPEC[id].icon, r: 6000, xp: SPEC[id].xp });

  /* ======================= placement ======================= */
  CI.plan = function (gen, home, sites) {
    const zones = Object.values(gen.zones || {});
    const taken = sites.map((s) => [s.x, s.z, (s.r || s.len || 0) + 9000]);
    for (const id of ["dubai", "rio", "tokyo", "hk", "chicago"]) {
      let best = null;
      const mtn = id === "rio" || id === "hk";
      for (let r = 34000; r <= (id === "dubai" || id === "hk" || id === "chicago" ? 150000 : 96000) && !(best && best.sc < 0.2); r += 2500) for (let k = 0; k < 40; k++) {
        const a = (k / 40) * TAU + r * 1e-5, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
        const f = gen.fields(x, z);
        if (f.land < 0.97 || f.h < 2 || f.h > 90 || f.him > 0 || f.nyc > 0 || f.sf > 0 || f.snowZ > 0 || f.ash > 0) continue;
        if ((id === "tokyo" || id === "chicago") && f.dry > 0.5) continue;
        if (zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) < zn.r + 6000) || taken.some(([sx, sz, sr]) => Math.hypot(sx - x, sz - z) < sr)) continue;
        // the sea must be 3–6.5 km away in some direction (the city sits on the coast, flattened core stays dry)
        let sea = null;
        for (let j = 0; j < 16 && !sea; j++) {
          const b = (j / 16) * TAU, dx = Math.cos(b), dz = Math.sin(b);
          for (let d = 2600; d <= 6500; d += 650) if (gen.height(x + dx * d, z + dz * d) < -4) { if (d >= SPEC[id].R + 500) sea = { dx, dz, d }; break; }
        }
        if (!sea) continue;
        // Dubai: low desert all round (no mountain backdrop)
        if (id === "dubai") { let bad = false; for (let j = 0; j < 8 && !bad; j++) { const b = (j / 8) * TAU; for (const d of [2500, 5000]) if (gen.height(x + Math.cos(b) * d, z + Math.sin(b) * d) > 300) { bad = true; break; } } if (bad || f.h > 60) continue; }
        let hi = 0;
        if (mtn) for (let j = 0; j < 12; j++) { const b = (j / 12) * TAU; for (const d of [3500, 5000]) hi = Math.max(hi, gen.height(x - sea.dx * d + Math.cos(b) * 900, z - sea.dz * d + Math.sin(b) * 900)); }
        const sc = (mtn ? Math.abs(hi - 500) / 600 : 0) + f.h / 300 + Math.abs(sea.d - 4000) / 8000 + (id === "dubai" ? 1 - f.dry : 0);
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

  /* ======================= city designs ======================= */
  // Every city: palette (stone / glass / window warm / cool / crown light), block size and street width, flat core
  // radius, height field (base by distance + district bumps), the skyscraper canyon, a slalom row, hero towers,
  // neon districts, elevated roads and a bridge. Heights are exaggerated past reality on purpose.
  const STYLE = {
    tokyo: {
      P: { stone: [0x9ea3a8, 0xbcb8ae, 0x7f878f, 0xd2cdc2, 0x6a727b, 0xa79e91], glass: [0x7e94a8, 0x9fb0be, 0x5d7186, 0x8aa0a0], warm: 0xfff1d6, cool: 0xd8ecff, crown: 0xff3b6b, styles: [4, 4, 0, 1, 3, 5], gstyles: [2, 2, 1, 6, 2], forms: ["setback", "podium", "cyl", "notch", "twist", "taper", "oct", "stepped", "deck", "ellipse"], crownP: 0.6, metal: 0xd6dde4, roof: 0x4a4f57, roof2: 0x6b4a3a },
      trees: { kind: "tree", cols: [0x3f6e33, 0x4f7d38, 0x5c8a3e] }, parks: [{ s: -2500, p: -2500, rs: 300, rp: 380, name: "Yoyogi Park" }, { s: -600, p: -250, rs: 140, rp: 190, name: "Hibiya Park" }],
     
      block: 64, street: 12, aveEvery: 4, outer: 6800, base: (d) => RJ.lerp(46, 10, RJ.smooth(600, 6500, d)),
      bumps: [{ s: -1800, p: -1300, r: 900, h: 330 }, { s: -300, p: 300, r: 700, h: 240 }, { s: 300, p: -2200, r: 600, h: 180 }, { s: -900, p: 1700, r: 600, h: 160 }],
      canyon: { s: -1100, half: 1900, width: 175, h: [180, 360] }, slalom: { n: 7, gap: 360, off: 0.27, h: [300, 460], w: 34 },
      neon: [{ s: -600, p: -1800, r: 650 }, { s: -1500, p: -650, r: 500 }, { s: 250, p: 700, r: 420 }],
      highway: [[-1900, -3000, -1900, 3000], [-3000, 900, 2200, 900]],
      heroes: [
        { s: -2000, p: -1500, w: 46, h: 243, form: "setback", glass: false, st: 0, crown: 1, name: "Tokyo Metropolitan Government Building" },
        { s: -2000, p: -1400, w: 46, h: 243, form: "setback", glass: false, st: 0 },
        { s: -1500, p: -1200, w: 48, h: 300, form: "cyl", glass: true, spire: 40, name: "Mode Gakuen Cocoon" },
        { s: -1700, p: -900, w: 60, h: 480, form: "setback", glass: true, spire: 70 },
        { s: -350, p: 350, w: 62, h: 420, form: "podium", glass: true, name: "Roppongi Hills" }
      ],
      bridge: { p: 1500, span: 1000, deck: 52, towerH: 126, color: 0xf2f2ee, island: 600, name: "Rainbow Bridge" }
    },
    dubai: {
      P: { stone: [0xd8cbb0, 0xe6ddc8, 0xcbb98f, 0xf0ebe0], glass: [0x8fb0c8, 0xb8c8d6, 0x6f8fae, 0xc9d2da, 0x5f86a8], warm: 0xffe7c0, cool: 0xcfe6ff, crown: 0xffc24a, styles: [2, 1, 3, 0, 5], gstyles: [2, 6, 7, 2, 1], forms: ["taper", "twist", "cyl", "tri", "setback", "deck", "ellipse", "skygarden", "notch"], crownP: 0.7, metal: 0xe0d0a0, roof: 0xd9c9a8, roof2: 0xc8b48c },
      trees: { kind: "palm", cols: [0x5d7a32, 0x6e8a3a] }, parks: [{ s: -300, p: -1750, rs: 240, rp: 260, name: "Safa Park" }],
      highway: [[-2200, -4200, -2200, 4200]],
      block: 110, street: 22, aveEvery: 3, outer: 6500, base: (d) => RJ.lerp(22, 8, RJ.smooth(800, 6000, d)), sparse: 0.35,
      bumps: [{ s: -900, p: 0, r: 1300, h: 280 }, { s: -1500, p: -2600, r: 900, h: 380 }],
      canyon: { s: -700, half: 2600, width: 170, h: [260, 420] }, slalom: { n: 6, gap: 420, off: 0.28, h: [360, 520], w: 40 },
      neon: [],
      heroes: [
        { s: -1500, p: -2500, w: 52, h: 520, form: "twist", glass: true, name: "Cayan Tower" },
        { s: -1600, p: -2850, w: 56, h: 470, form: "setback", glass: true, spire: 60, name: "Princess Tower" },
        { s: -1100, p: 900, w: 55, h: 355, form: "tri", glass: true, spire: 40, name: "Emirates Tower One" },
        { s: -1250, p: 1050, w: 50, h: 309, form: "tri", glass: true, spire: 30 }
      ]
    },
    rio: {
      P: { stone: [0xf2efe8, 0xe8dfcc, 0xd6d2c9, 0xf0e2c2, 0xc9d6dc, 0xe2d4b8], glass: [0x9fb6c4, 0x7f9aac, 0xb7c6cc], warm: 0xffd9a8, cool: 0xe8f2ff, crown: 0x7cff9a, styles: [5, 5, 1, 0, 3, 5, 0], gstyles: [2, 1, 2], forms: ["podium", "setback", "box", "cyl", "notch", "slab", "ellipse"], crownP: 0.35, metal: 0xd0d0d0, roof: 0xa8553a, roof2: 0xb86a45 },
      trees: { kind: "mix", cols: [0x3f7a2e, 0x4f8a36, 0x5d9a3e] }, parks: [{ s: -450, p: -1650, rs: 230, rp: 380, name: "Aterro do Flamengo" }],
      highway: [[-650, -4200, -650, 300]],
      block: 72, street: 14, aveEvery: 4, outer: 6000, base: (d) => RJ.lerp(30, 9, RJ.smooth(600, 5500, d)),
      bumps: [{ s: -1200, p: 1500, r: 700, h: 260 }, { s: 0, p: -600, r: 600, h: 120 }],
      beach: { h: [70, 150], depth: 450 },
      canyon: { s: -1300, half: 1500, width: 140, h: [150, 280] }, slalom: { n: 6, gap: 380, off: 0.26, h: [220, 340], w: 30 },
      neon: [],
      heroes: [{ s: -1250, p: 1600, w: 50, h: 320, form: "setback", glass: true, crown: 1, name: "Centro tower" }],
      bridge: { p: -2600, span: 1600, deck: 60, towerH: 140, color: 0xc8ccd0, island: 700, name: "Rio–Niterói Bridge" },
      stadium: { s: -2300, p: 2300, name: "Maracanã" }
    },
    hk: {
      P: { stone: [0xc9c6bf, 0xb2b6ba, 0xe0dcd3, 0x9aa1a8, 0xd4c9b6], glass: [0x6f8aa0, 0x5a7690, 0x8ea6b8, 0x47627a], warm: 0xfff0d2, cool: 0xd6eaff, crown: 0x3bd1ff, styles: [4, 4, 4, 5, 1, 0, 3], gstyles: [2, 2, 6, 1], forms: ["setback", "oct", "notch", "podium", "taper", "cyl", "tri", "slab", "skygarden", "deck"], crownP: 0.65, metal: 0xc8ccd0, roof: 0x55595e, roof2: 0x7a6a5a },
      trees: { kind: "tree", cols: [0x2f6a2c, 0x3d7a33] }, parks: [{ s: -700, p: 1000, rs: 170, rp: 210, name: "Hong Kong Park" }],
      highway: [[450, -3600, 450, 3600]],
      block: 58, street: 11, aveEvery: 4, outer: 5600, base: (d) => RJ.lerp(170, 55, RJ.smooth(400, 4500, d)), spikes: 0.14, spikeMax: 480,
      bumps: [{ s: 400, p: 0, r: 1000, h: 360 }, { s: -400, p: -1400, r: 900, h: 280 }, { s: -300, p: 1500, r: 900, h: 260 }],
      canyon: { s: -200, half: 2000, width: 130, h: [220, 380] }, slalom: { n: 7, gap: 320, off: 0.27, h: [280, 420], w: 30 },
      neon: [{ s: 0, p: -900, r: 700 }, { s: 300, p: 900, r: 600 }],
      peak: { s: -3400, p: 0, R: 2600, H: 552, name: "Victoria Peak" },
      island: { R: 1500, gap: 1300, name: "Kowloon" },
      heroes: [
        { s: 700, p: 200, w: 62, h: 412, form: "setback", glass: true, spire: 30, crown: 1, name: "Two IFC" },
        { s: 300, p: -500, w: 58, h: 367, form: "tri", glass: true, spire: 60, name: "Bank of China Tower" },
        { s: 200, p: 700, w: 56, h: 374, form: "tri", glass: true, spire: 50, crown: 1, name: "Central Plaza" }
      ],
      bridge: { p: 0, span: 1200, deck: 62, towerH: 206, color: 0xd8dade, toIsland: true, name: "Tsing Ma Bridge" }
    },
    chicago: {
      P: { stone: [0xb9b2a6, 0x8e8a84, 0xcfc7b8, 0x6f6a64, 0xd9d3c6], glass: [0x3f4a55, 0x55626e, 0x2f3740, 0x6a7a88], warm: 0xffe4b8, cool: 0xdce8f2, crown: 0xffffff, styles: [0, 3, 1, 0, 5, 3], gstyles: [2, 1, 2, 6], forms: ["setback", "box", "podium", "notch", "stepped", "stepped", "taper", "ellipse"], crownP: 0.4, metal: 0xb0b4b8, roof: 0x4a4c50, roof2: 0x6a4a3a, tank: 0x6a5a48 },
      trees: { kind: "tree", cols: [0x4f7a34, 0x5f8a3a, 0x8a7a30] }, parks: [{ s: "coast", p: -1000, rs: 230, rp: 620, name: "Grant Park" }],
      highway: [[-2500, -4200, -2500, 4200]],
      block: 100, street: 20, aveEvery: 2, outer: 6400, base: (d) => RJ.lerp(60, 10, RJ.smooth(500, 6000, d)),
      bumps: [{ s: -600, p: 0, r: 1100, h: 300 }, { s: -300, p: 1400, r: 600, h: 200 }],
      canyon: { s: -1000, half: 2200, width: 160, h: [200, 340] }, slalom: { n: 6, gap: 380, off: 0.27, h: [300, 420], w: 34 },
      neon: [],
      river: { p: 300, from: 0, to: -3600, width: 75 },
      heroes: [
        { s: -800, p: -600, w: 68, h: 442, form: "bundle", glass: true, mast: 90, name: "Willis Tower" },
        { s: -300, p: 1200, w: 58, h: 344, form: "taper", glass: true, mast: 100, st: 3, name: "John Hancock Center" },
        { s: -350, p: 380, w: 50, h: 423, form: "setback", glass: true, spire: 0, crown: 1, name: "Trump Tower" },
        { s: -50, p: -50, w: 56, h: 346, form: "box", glass: false, st: 3, name: "Aon Center" },
        { s: -520, p: 160, w: 34, h: 179, form: "cyl", glass: false, st: 1, name: "Marina City" },
        { s: -520, p: 230, w: 34, h: 179, form: "cyl", glass: false, st: 1 }
      ],
      pier: { p: 900, len: 1000, name: "Navy Pier" }
    }
  };
  CI.STYLE = STYLE;

  function buildCity(id, S, X) {
    const K = RJ.cityKit, T = STYLE[id], W = RJ.world, B = new K.Batch(), Pal = T.P;
    const pick = (a, r) => a[Math.floor(r() * a.length)];
    const treeKind = (r) => T.trees.kind === "mix" ? (r() < 0.4 ? "palm" : "tree") : T.trees.kind;
    const r = W.gen.mulberry32(id.split("").reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0);
    const { grp, c, groundAt, keep, peakH } = X;
    const yaw = Math.atan2(S.px, S.pz), g = T.block, coreR = SPEC[id].R;
    const cs = Math.round(T.canyon.s / g) * g, cw = T.canyon.width, canyonEnd = T.canyon.half;
    const heights = (s, p, d) => { let h = T.base(d) * RJ.lerp(0.4, 1.3, r()); for (const b of T.bumps) { const q = ((s - b.s) ** 2 + (p - b.p) ** 2) / (b.r * b.r); if (q < 6) h += b.h * Math.exp(-q) * RJ.lerp(0.45, 1.15, Math.pow(r(), 0.7)); } return h; };
    const inNeon = (s, p) => T.neon.some((n) => (s - n.s) ** 2 + (p - n.p) ** 2 < n.r * n.r);
    const neon = [], NEONC = [0xff2a6d, 0x05d9e8, 0xfff35c, 0xff8a00, 0x9d4edd, 0x3cff6b, 0xff4dd8];
    const lots = [];
    // ---------- waterfront survey: the last dry ground along the coast every 40 m ----------
    const edge = new Map();
    const P0 = Math.floor(T.outer / 40) * 40;
    for (let p = -P0; p <= P0; p += 40) {
      let prev = null;
      for (let s = Math.max(-T.outer, S.coast - 1600); s < S.coast + 1600; s += 15) {
        const [x, z] = c(s, p), gy = groundAt(x, z);
        if (gy < 0.6) { if (prev != null) edge.set(p, prev); break; }
        prev = gy > 1.2 ? s : prev;
      }
    }
    const edgeAt = (p) => edge.get(Math.round(p / 40) * 40);
    // the port takes the longest straight stretch of shore away from the centre and the landmarks; a marina the next
    {
      const runs = []; let cur = null;
      for (let p = -P0; p <= P0; p += 40) {
        const e = edge.get(p), pe = edge.get(p - 40), [ex, ez] = e != null ? c(e, p) : [0, 0];
        const free = e != null && Math.abs(p) > 900 && Math.abs(p) < T.outer * 0.85 && !(T.bridge && Math.abs(p - T.bridge.p) < 500) && !(T.pier && Math.abs(p - T.pier.p) < 400) && !(T.river && Math.abs(p - T.river.p) < 250) &&
          !(id === "dubai" && (Math.abs(p + 1600) < 500 || Math.abs(p - 1800) < 400)) && !(id === "rio" && p > 900 && p < 2700) && !keep.some(([kx, kz, kr]) => Math.hypot(kx - ex, kz - ez) < kr + 200);
        if (free && cur && pe != null && Math.abs(e - pe) < 90) cur.b = p; else if (free) runs.push(cur = { a: p, b: p }); else cur = null;
      }
      runs.sort((u, v) => (v.b - v.a) - (u.b - u.a));
      const pr = runs[0];
      const r40 = (v) => Math.round(v / 40) * 40;
      T.port = pr && pr.b - pr.a >= 600 ? [r40(Math.max(pr.a, (pr.a + pr.b) / 2 - 700)), r40(Math.min(pr.b, (pr.a + pr.b) / 2 + 700))] : null;
      const mr = runs.find((u) => u !== pr && u.b - u.a >= 160) || (pr && pr.b - pr.a > 1900 ? { a: pr.b - 300, b: pr.b } : null);
      T.marina = mr ? Math.round((mr.a + mr.b) / 80) * 40 : null;
    }
    const inPort = (s, p) => T.port && p > T.port[0] - 40 && p < T.port[1] + 40 && edgeAt(p) != null && s > edgeAt(p) - 470;
    const parks = (T.parks || []).map((k) => Object.assign({}, k, { s: k.s === "coast" ? (edgeAt(k.p) != null ? edgeAt(k.p) - k.rs - 40 : S.coast - 400) : k.s }));
    const inPark = (s, p) => parks.find((k) => Math.abs(s - k.s) < k.rs && Math.abs(p - k.p) < k.rp);
    const hwL = (T.highway || []).map(([s0, p0, s1, p1]) => [Math.round(s0 / g) * g, Math.round(p0 / g) * g, Math.round(s1 / g) * g, Math.round(p1 / g) * g]);
    const nearHw = (s, p, m) => hwL.some(([s0, p0, s1, p1]) => { const dx = s1 - s0, dp = p1 - p0, t = RJ.clamp(((s - s0) * dx + (p - p0) * dp) / (dx * dx + dp * dp), 0, 1); return Math.hypot(s - s0 - dx * t, p - p0 - dp * t) < m; });
    const special = []; // park / plaza / parking blocks, filled after the towers
    if (T.river) T.river.from = S.coast + 30; // the river runs out into the lake
    // the bridge / island / river lanes are kept open
    const riverAt = (s, p) => T.river && s < T.river.from + 50 && s > T.river.to && Math.abs(p - T.river.p) < T.river.width / 2 + 25;
    for (let i = -Math.ceil(T.outer / g); i <= T.outer / g; i++) for (let j = -Math.ceil(T.outer / g); j <= T.outer / g; j++) {
      const bs = (i + 0.5) * g, bp = (j + 0.5) * g, bd = Math.hypot(bs, bp);
      if (bd > T.outer) continue;
      const outer = bd > coreR - g;
      // outer districts thin out with distance; Dubai is sparse between its clusters
      if (outer && r() < RJ.smooth(coreR, T.outer, bd) * 0.75) continue;
      if (T.sparse && !outer && r() < T.sparse * RJ.smooth(800, 2600, bd)) continue;
      {
        const [x, z] = c(bs, bp), gy = groundAt(x, z), pk = !outer && gy > 1.5 && Math.abs(bs - cs) > cw / 2 + g * 0.6 ? inPark(bs, bp) : null;
        const roll = r();
        if (pk || (!outer && gy > 1.5 && Math.abs(bs - cs) > cw / 2 + g && !riverAt(bs, bp) && !inPort(bs, bp) && roll < 0.075)) {
          special.push({ s: bs, p: bp, x, z, y: outer ? gy : S.elev, kind: pk ? "park" : roll < 0.035 ? "plaza" : roll < 0.06 ? "parking" : "park", big: !!pk });
          continue;
        }
      }
      const k = outer || bd > coreR * 0.65 ? 1 : 2, lw = g / k;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        const s = i * g + (a + 0.5) * lw, p = j * g + (b + 0.5) * lw;
        if (Math.abs(s - cs) < cw / 2 + lw * 0.3) continue; // the canyon avenue (open across the whole city)
        if (riverAt(s, p) || inPort(s, p)) continue;
        if (nearHw(s, p, (lw - T.street) * 0.5 + 12)) continue;
        const [x, z] = c(s, p), gy = groundAt(x, z);
        if (gy < 1.5 || keep.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr)) continue;
        const hp = peakH(x, z); if (hp > gy - 3 && hp > -1e9) continue;
        const half = (lw - T.street) * 0.5;
        if (outer) { // on the natural ground: skip steep plots
          let lo = gy, hi = gy; for (const [ox, oz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) { const yy = groundAt(x + ox, z + oz); lo = Math.min(lo, yy); hi = Math.max(hi, yy); }
          if (hi - lo > 9 || lo < 1) continue;
        }
        let h = heights(s, p, bd);
        const nearCanyon = Math.abs(s - cs) < cw / 2 + lw * 1.6 && Math.abs(p) < canyonEnd;
        if (nearCanyon) h = Math.max(h, RJ.lerp(T.canyon.h[0], T.canyon.h[1], r()));
        if (T.beach && s > S.coast - T.beach.depth - 250 && s < S.coast - 200) h = Math.max(h, RJ.lerp(T.beach.h[0], T.beach.h[1], r()));
        if (outer) h = Math.min(h, 40);
        // supertall spikes in the business districts: a skyline silhouette you can read from 40 km
        else if (T.bumps.some((b) => (s - b.s) ** 2 + (p - b.p) ** 2 < b.r * b.r * 1.4) && r() < (T.spikes || 0.07)) h = RJ.lerp(300, T.spikeMax || 560, Math.pow(r(), 0.8));
        const w = half * 2 * RJ.lerp(0.7, 0.95, r()), dd = half * 2 * RJ.lerp(0.7, 0.95, r());
        const tall = h > 160;
        const base = (outer ? Math.min(gy, groundAt(x + half, z + half), groundAt(x - half, z - half)) : S.elev) - 1;
        lots.push({ s, p, x, z, y: base, w: tall ? Math.min(w, dd) * 0.95 : w, d: tall ? Math.min(w, dd) * 0.95 : dd, h, outer, gy, half });
      }
    }
    const opts = (L) => ({ x: L.x, z: L.z, y: L.y, w: L.w, d: L.d, h: L.h, ry: yaw, glassP: RJ.lerp(0.1, 0.85, RJ.smooth(40, 220, L.h)), P: Pal });
    const roofCols = [Pal.roof || 0x8a4a32, Pal.roof2 || 0x5a5c60];
    for (const L of lots) {
      if (L.outer) {
        // the edge of town: a paved lot under every building; houses with pitched roofs, low blocks, warehouses
        B.seed = r() * 97; B.base = L.y;
        B.add("box", false, L.x, L.y, L.z, L.half * 2 + 4, L.gy - L.y + 0.35, L.half * 2 + 4, yaw, 0x8c8a84, 11, 0, 0);
        B.seed = null; B.base = null;
        const kind = r();
        if (L.h < 26 && kind < 0.55 && L.half > 9) {
          const n = L.half > 20 ? 4 : 2, q = L.half / 2;
          for (let a = 0; a < n; a++) {
            const ox = n === 4 ? (a % 2 ? q : -q) : (a ? q : -q), oz = n === 4 ? (a < 2 ? q : -q) : 0;
            const hx = L.x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, hz = L.z - Math.sin(yaw) * ox + Math.cos(yaw) * oz, hh = RJ.lerp(6, 10, r()), hw = q * RJ.lerp(1.2, 1.6, r());
            B.seed = r() * 97; B.base = L.gy;
            B.add("gable", false, hx, L.gy, hz, hw, hh, hw * RJ.lerp(0.9, 1.3, r()), yaw + (r() < 0.5 ? 0 : Math.PI / 2), pick(Pal.stone, r), 0, RJ.lerp(0.3, 0.6, r()), 0);
            if (r() < 0.5) B.treeAt(hx + q * 0.7, L.gy, hz + q * 0.7, RJ.lerp(5, 9, r()), pick(T.trees.cols, r), treeKind(r));
            B.seed = null; B.base = null;
            B.foot2(hx, hz, hw * 0.5, L.gy + hh);
          }
          continue;
        }
        if (kind > 0.9 && L.half > 14) { K.tower(B, Object.assign(opts(L), { h: RJ.lerp(9, 14, r()), glass: false, st: 3, form: "box", w: L.half * 1.9, d: L.half * 1.6 }), r); continue; }
      }
      K.tower(B, opts(L), r);
      if (inNeon(L.s, L.p) && L.h > 18 && L.h < 160 && r() < 0.6) for (let n = 0; n < 1 + Math.floor(r() * 2); n++) {
        const f = Math.floor(r() * 4), nx = [1, -1, 0, 0][f], np = [0, 0, 1, -1][f];
        const ox = S.sx * nx + S.px * np, oz = S.sz * nx + S.pz * np, off = (nx ? L.w : L.d) / 2 + 0.7;
        const hh = RJ.lerp(8, 26, r()), y = L.y + RJ.lerp(8, Math.max(10, Math.min(L.h - hh - 2, 60)), r());
        neon.push({ x: L.x + ox * off, y: y + hh / 2, z: L.z + oz * off, w: (nx ? L.d : L.w) * RJ.lerp(0.3, 0.7, r()), h: hh, ry: Math.atan2(ox, oz), col: NEONC[Math.floor(r() * NEONC.length)] });
      }
    }
    // ---------- parks, plazas and parking: the breathing spaces between the towers ----------
    const blockIn = g - T.street - 6;
    const at = (x, z, ox, oz) => [x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, z - Math.sin(yaw) * ox + Math.cos(yaw) * oz];
    for (const sp of special) {
      B.seed = r() * 97; B.base = sp.y;
      if (sp.kind === "park") {
        B.add("box", false, sp.x, sp.y - 0.4, sp.z, blockIn, 0.85, blockIn, yaw, 0x4e7a38, 12, 0, 0);
        if (r() < (sp.big ? 0.12 : 0.3)) { const [px, pz] = at(sp.x, sp.z, (r() - 0.5) * blockIn * 0.3, (r() - 0.5) * blockIn * 0.3); B.add("cyl", false, px, sp.y + 0.05, pz, blockIn * 0.35, 0.45, blockIn * 0.28, yaw, 0x2c4a58, 9, 0, 0); } // pond
        const n = Math.round(blockIn * blockIn / (sp.big ? 140 : 180));
        for (let i = 0; i < n; i++) {
          const [tx, tz] = at(sp.x, sp.z, (r() - 0.5) * blockIn * 0.92, (r() - 0.5) * blockIn * 0.92);
          B.treeAt(tx, sp.y + 0.4, tz, RJ.lerp(7, 15, r()), pick(T.trees.cols, r), treeKind(r));
        }
      } else if (sp.kind === "plaza") {
        B.add("box", false, sp.x, sp.y - 0.4, sp.z, blockIn, 0.75, blockIn, yaw, 0xb4ada2, 11, 0, 0);
        B.add("cyl", false, sp.x, sp.y + 0.3, sp.z, 14, 0.8, 14, 0, 0xd4dadf, 11, 0, 0); B.add("cyl", false, sp.x, sp.y + 0.3, sp.z, 12, 0.6, 12, 0, 0x3a6a80, 9, 0, 0); // fountain
        B.add("cyl", false, sp.x, sp.y + 0.3, sp.z, 1.4, 5, 1.4, 0, 0xd4dadf, 9, 0, 0);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, [tx, tz] = at(sp.x, sp.z, Math.cos(a) * blockIn * 0.36, Math.sin(a) * blockIn * 0.36); B.add("box", false, tx, sp.y + 0.3, tz, 3, 0.8, 3, yaw, 0x8a8478, 11, 0, 0); B.treeAt(tx, sp.y + 1.1, tz, RJ.lerp(6, 9, r()), pick(T.trees.cols, r), treeKind(r)); }
        const [kx, kz] = at(sp.x, sp.z, blockIn * 0.3, -blockIn * 0.3); B.add("box", true, kx, sp.y + 0.3, kz, 9, 4, 6, yaw, 0x8aa0b0, 2, 0.6, 0);  // pavilion
      } else {
        B.add("box", false, sp.x, sp.y - 0.4, sp.z, blockIn, 0.75, blockIn, yaw, 0x3a3c40, 11, 0, 0);
        const CARS = [0xe8e8e8, 0x202224, 0x8a8f96, 0x9a1c1c, 0x1c3a7a, 0xc8c2b4, 0x4a4e52];
        for (let row = -2; row <= 2; row++) for (let cI = -Math.floor(blockIn / 6); cI <= blockIn / 6; cI++) {
          if (r() < 0.3) continue;
          const [cx, cz] = at(sp.x, sp.z, cI * 2.9, row * blockIn * 0.19);
          B.add("box", false, cx, sp.y + 0.35, cz, 1.9, 1.45, 4.5, yaw, pick(CARS, r), 9, 0, 0);
        }
      }
      B.seed = null; B.base = null;
    }
    // ---------- waterfront: seawall and promenade, a container port with gantry cranes, a marina ----------
    const coastal = [...edge.keys()].sort((a, b) => a - b);
    for (const p of coastal) {
      const e = edge.get(p); if (Math.abs(p) > T.outer * 0.92) continue;
      const [x, z] = c(e + 6, p), gy = Math.max(1.2, groundAt(...c(e, p)));
      if (T.bridge && Math.abs(p - T.bridge.p) < 60) continue;
      if (T.pier && Math.abs(p - T.pier.p) < 60) continue;
      if (id === "dubai" && Math.abs(p + 1600) < 120) continue;
      const port = T.port && p >= T.port[0] && p <= T.port[1];
      B.seed = r() * 97; B.base = -6;
      if (!T.beach || port) B.add("box", false, x, -6, z, 41, gy + 6.6, 8, yaw + Math.PI / 2, 0x9a978f, 11, 0, 0); // seawall / quay
      B.seed = null; B.base = null;
      if (!port && p % 80 === 0 && r() < 0.8) { const [tx, tz] = c(e - 10, p); B.treeAt(tx, gy, tz, RJ.lerp(7, 12, r()), pick(T.trees.cols, r), T.beach || id === "dubai" ? "palm" : treeKind(r)); }
    }
    if (T.port) {
      // container yard paving, stacks, cranes on the quay, warehouses and tanks behind
      const CR = [0xc23b22, 0x2f5fa8, 0xe8e4da, 0xd88a1a];
      const crc = pick(CR, r);
      for (let p = T.port[0]; p <= T.port[1]; p += 40) {
        const e = edgeAt(p); if (e == null) continue;
        const [x, z] = c(e - 230, p), gy = Math.max(1.2, groundAt(...c(e - 20, p)));
        B.seed = r() * 97; B.base = gy - 1.5;
        B.add("box", false, x, gy - 1.5, z, 460, 1.9, 41, yaw, 0x8f8d88, 11, 0, 0);
        for (let ss = 50; ss < 260; ss += 17) {
          if (r() < 0.2) continue;
          const [bx, bz] = c(e - ss, p), n = 1 + Math.floor(r() * 4);
          B.seed = r() * 97; B.base = gy + 0.4;
          B.add("box", false, bx, gy + 0.4, bz, 36.6, 2.59 * n, 12.5, yaw + Math.PI / 2, 0x777777, 13, 0, 0);
          B.foot2(bx, bz, 8, gy + 0.4 + 2.59 * n);
        }
        if (p % 120 === 0) { // gantry crane: four legs, portal, boom out over the water and back
          const e0 = e - 8;
          B.seed = r() * 97; B.base = gy;
          for (const ls of [-1, 1]) for (const lp of [-1, 1]) { const [lx, lz] = c(e0 + ls * 12, p + lp * 9); B.add("box", false, lx, gy, lz, 1.6, 46, 1.6, yaw, crc, 9, 0, 0); }
          const [mx, mz] = c(e0 + 18, p), [hx, hz] = c(e0 - 4, p);
          B.add("box", false, mx, gy + 44, mz, 92, 3.2, 21, yaw, crc, 9, 0, 0);
          B.add("box", false, hx, gy + 46.5, hz, 10, 6, 12, yaw, 0xdedede, 9, 0, 0);
          for (const lp of [-1, 1]) { const [ax, az] = c(e0, p + lp * 9); B.add("box", false, ax, gy + 47, az, 1.2, 14, 1.2, yaw, crc, 9, 0, 0); }
          B.lights.push(...c(e0 + 62, p).flatMap((v, i) => i ? [gy + 48, v] : [v]), ...c(e0, p).flatMap((v, i) => i ? [gy + 62, v] : [v]));
          B.foot2(...c(e0 + 18, p), 34, gy + 62);
        }
        if (p % 160 === 0) { const [wx, wz] = c(e - 380, p); K.tower(B, { x: wx, z: wz, y: gy - 1, w: 70, d: 34, h: RJ.lerp(10, 16, r()), ry: yaw, glass: false, st: 3, form: "box", P: { stone: [0x9aa0a6, 0xb8b4ac, 0x7d8a96] }, lit: 0.15 }, r); }
        else if (p % 160 === 80 && r() < 0.6) { const [tx, tz] = c(e - 380, p); B.seed = r() * 97; B.base = gy; B.add("cyl", false, tx, gy, tz, 28, RJ.lerp(12, 18, r()), 28, 0, 0xe4e4e0, 9, 0, 0); B.foot2(tx, tz, 15, gy + 18); }
      }
      B.seed = null; B.base = null;
    }
    if (T.marina != null && edgeAt(T.marina) != null) {
      const e = edgeAt(T.marina), BOATS = [0xf4f4f2, 0xe8eef2, 0x2a3c5a, 0xf0ece0];
      B.seed = r() * 97; B.base = -5;
      const [bwx, bwz] = c(e + 190, T.marina); B.add("box", false, bwx, -5, bwz, 260, 7.5, 12, yaw + Math.PI / 2, 0x8d8a83, 11, 0, 0); // breakwater
      for (let k = -2; k <= 2; k++) {
        const [px, pz] = c(e + 80, T.marina + k * 34);
        B.add("box", false, px, -0.6, pz, 150, 1.4, 2.6, yaw, 0xb8ae9c, 11, 0, 0);
        for (let j = 0; j < 14; j++) for (const sd of [-1, 1]) {
          if (r() < 0.25) continue;
          const [bx, bz] = c(e + 18 + j * 9.5, T.marina + k * 34 + sd * 6), L = RJ.lerp(7, 14, r());
          B.add("box", false, bx, -0.4, bz, L * 0.32, 1.8, L, yaw, pick(BOATS, r), 9, 0, 0);
          if (r() < 0.45) B.add("cyl", false, bx, 1.4, bz, 0.22, L * 1.3, 0.22, 0, 0xdedede, 9, 0, 0);
        }
      }
      B.seed = null; B.base = null;
    }
    // ---------- street trees along the avenues of the core ----------
    if (RJ.settings.quality !== "low") {
      const hTmp = K.grid(B), avR = Math.min(coreR, S.coast - 300) * 0.9, ae = T.aveEvery || 4;
      for (let i = -Math.floor(avR / g); i <= avR / g; i++) {
        if (i % ae) continue;
        const off = T.street * 0.9 + 2.2;
        for (let t = -avR; t < avR; t += 20) {
          if (Math.abs(((t % g) + g) % g - g / 2) > g / 2 - T.street - 4) continue; // not in the crossings
          for (const sd of [-1, 1]) for (const axis of [0, 1]) {
            const ss = axis ? i * g + sd * off : t, pp = axis ? t : i * g + sd * off;
            if (Math.hypot(ss, pp) > avR || Math.abs(ss - cs) < cw / 2 + 4 && axis === 0) continue;
            const [x, z] = c(ss, pp), gy = groundAt(x, z);
            if (gy < 1.5 || hTmp(x, z) > -1e9 || riverAt(ss, pp)) continue;
            if (r() < 0.15) continue;
            B.seed = r() * 97; B.treeAt(x, S.elev, z, RJ.lerp(6, 10, r()), pick(T.trees.cols, r), treeKind(r)); B.seed = null;
          }
        }
      }
    }
    // the slalom: slender towers alternating across the avenue after the canyon
    const slalom = [];
    for (let i = 0; i < T.slalom.n; i++) {
      const p = canyonEnd + 250 + i * T.slalom.gap, side = i % 2 ? 1 : -1, s = cs + side * cw * T.slalom.off;
      const [x, z] = c(s, p), gy = groundAt(x, z); if (gy < 1.5) continue;
      const h = RJ.lerp(T.slalom.h[0], T.slalom.h[1], r());
      K.tower(B, { x, z, y: gy - 1, w: T.slalom.w, d: T.slalom.w, h, ry: yaw, glassP: 1, P: Pal, form: i % 3 === 0 ? "cyl" : i % 3 === 1 ? "taper" : "setback", crown: 1 }, r);
      slalom.push({ s, p, side, x, z, h, y: gy });
    }
    // hero towers
    let hero = null;
    for (const Hh of T.heroes) {
      const [x, z] = c(Hh.s, Hh.p), gy = groundAt(x, z);
      const top = K.tower(B, Object.assign({ x, z, y: gy - 1, w: Hh.w, d: Hh.w, ry: yaw, P: Pal, glassP: 1, lit: 0.5, crown: Hh.crown }, Hh), r);
      if (Hh.mast) for (const sgn of [-1, 1]) B.add("cyl", true, x + S.px * sgn * Hh.w * 0.22, gy + Hh.h, z + S.pz * sgn * Hh.w * 0.22, 2.4, Hh.mast, 2.4, 0, 0xd8dade, 9, 0, 0);
      if (!hero || Hh.h > hero.h) hero = { x, z, h: Hh.h, y: gy, w: Hh.w, top };
    }
    // elevated expressways along street lines, with ramps down to the street at both ends
    const solids = X.solids, paths = [], hws = [];
    for (const [s0, p0, s1, p1] of T.highway || []) {
      const sn = (v) => Math.round(v / g) * g, a0 = [sn(s0), sn(p0)], a1 = [sn(s1), sn(p1)], pts = [];
      const L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), n = Math.round(L / g), at = (k) => [a0[0] + (a1[0] - a0[0]) * k / n, a0[1] + (a1[1] - a0[1]) * k / n];
      // clip to the dry core: stop short of the coast, the core edge and the hills
      const ok = (k) => { const [ss, pp] = at(k), [x, z] = c(ss, pp); return groundAt(x, z) > 1.5 && Math.hypot(ss, pp) < coreR + 600 && (edgeAt(pp) == null || edgeAt(pp) > ss + 80) && peakH(x, z) < S.elev; };
      let ka = 0, kb = n; while (ka < kb && !ok(ka)) ka++; while (kb > ka && !ok(kb)) kb--;
      for (let k = ka + 1; k < kb; k++) if (!ok(k)) { kb = k - 1; break; }
      if ((kb - ka) * g < 900) continue;
      for (const k of [ka, kb]) { const [x, z] = c(...at(k)); pts.push({ x, z }); }
      const hw = K.highway(grp, pts, { Y: S.elev + 22, ground: S.elev + 0.4, width: 22, lamp: id === "dubai" ? 0xffc870 : 0xffd9a0 });
      solids.push(...hw.solids); paths.push(...hw.paths); hws.push(hw);
    }
    // street-level traffic along the avenues of the core
    const stR = Math.min(coreR, S.coast - 250);
    for (let i = -Math.floor(stR / g); i <= stR / g; i++) {
      if (i % (T.aveEvery || 4)) continue;
      const v = i * g, L = Math.sqrt(Math.max(0, stR * stR - v * v)) * 0.95; if (L < 400) continue;
      for (const axis of [0, 1]) {
        const [ax, az] = axis ? c(v, -L) : c(-L, v), [bx, bz] = axis ? c(v, L) : c(L, v);
        paths.push(K.path(ax, az, bx, bz, S.elev + 0.4));
      }
    }
    // a bridge to an island (or across the harbour to Kowloon), and the island itself
    let bridge = null, island = null;
    if (T.island || T.bridge) {
      const bp = T.bridge ? T.bridge.p : 0;
      let land = S.coast - 600; for (let s = S.coast - 900; s < S.coast + 800; s += 25) { const [x, z] = c(s, bp); if (groundAt(x, z) < -2) { land = s - 30; break; } }
      const span = T.bridge ? T.bridge.span : 1200, isR = T.island ? T.island.R : (T.bridge.island || 600);
      const icS = land + span + isR * 0.85;
      const [ix, iz] = c(icS, bp);
      island = { s: icS, p: bp, x: ix, z: iz, R: isR };
      const ig = new THREE.CylinderGeometry(isR, isR * 1.12, 14, 64); ig.translate(ix, -6, iz);
      const im = new THREE.Mesh(ig, new THREE.MeshStandardMaterial({ color: 0x8a9a6a, roughness: 0.95 })); im.receiveShadow = true; grp.add(im);
      X.rects.push({ x: ix, z: iz, hw: isR * 0.98, hl: isR * 0.98, ux: S.sx, uz: S.sz, top: 1, round: true });
      // island districts: Odaiba / Niterói waterfront / Kowloon (dense, with the tallest tower)
      const n = T.island ? 900 : 160;
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, rr = Math.sqrt(r()) * isR * 0.85, x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr;
        const h = T.island ? RJ.lerp(40, 160, Math.pow(r(), 1.6)) + 140 * Math.exp(-(rr * rr) / (isR * isR * 0.12)) * r() : RJ.lerp(12, 70, Math.pow(r(), 2));
        const w = T.island ? RJ.lerp(24, 40, r()) : RJ.lerp(20, 50, r());
        if (rr < 120 && T.island) continue;
        K.tower(B, { x, z, y: 0, w, d: w, h, ry: yaw, glassP: 0.5, P: Pal }, r);
      }
      if (T.island) { // ICC on Kowloon
        const top = K.tower(B, { x: ix, z: iz, y: 0, w: 66, d: 66, h: 484, ry: yaw, glassP: 1, P: Pal, form: "taper", crown: 1, spire: 0 }, r);
        if (!hero || 484 > hero.h) hero = { x: ix, z: iz, h: 484, y: 0, w: 66, top };
      }
      if (T.bridge) {
        const [ax, az] = c(land, bp), [bx2, bz2] = c(icS - isR * 0.9, bp);
        bridge = K.bridge(grp, { x: ax, z: az }, { x: bx2, z: bz2 }, { deck: T.bridge.deck, towerH: T.bridge.towerH, color: T.bridge.color, width: 30 });
        solids.push(...bridge.solids);
        paths.push(K.path(ax, az, bx2, bz2, T.bridge.deck + 0.4));
      }
    }
    // Victoria Peak behind Hong Kong
    if (T.peak) {
      const [px, pz] = c(T.peak.s, T.peak.p), py = Math.max(groundAt(px, pz), S.elev);
      const hp = (u) => Math.pow(1 - u, 1.5);
      const geo = (function () { const pts = []; for (let i = 0; i <= 30; i++) { const u = i / 30; pts.push(new THREE.Vector2(Math.max(u * T.peak.R, 0.01), hp(u) * T.peak.H)); } const lg = new THREE.LatheGeometry(pts.reverse(), 48); lg.computeVertexNormals(); return lg; })();
      const pm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3f5e36, roughness: 0.95 })); pm.position.set(px, py - 5, pz); pm.castShadow = pm.receiveShadow = true; grp.add(pm);
      X.peaks.push({ x: px, z: pz, R: T.peak.R, H: T.peak.H, hp, base: py - 5, sx: 1, sz: 1 });
      // towers climbing the Peak's lower slopes
      for (let i = 0; i < 500; i++) {
        const a = r() * TAU, rr = RJ.lerp(0.45, 0.85, r()) * T.peak.R, x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr;
        if (Math.cos(a) * S.sx + Math.sin(a) * S.sz < 0.2) continue;
        const y = Math.max(peakH(x, z), groundAt(x, z)); if (y < 2) continue;
        K.tower(B, { x, z, y: y - 4, w: RJ.lerp(22, 32, r()), d: RJ.lerp(22, 32, r()), h: RJ.lerp(60, 170, r()), ry: yaw, glassP: 0.2, P: Pal, form: "box" }, r);
      }
    }
    // Chicago River with its low bridges (raised so you can fly the river), Navy Pier and its Ferris wheel
    if (T.river) {
      const [ax, az] = c(T.river.from, T.river.p), [bx, bz] = c(T.river.to, T.river.p), L = Math.hypot(bx - ax, bz - az);
      const rg = new THREE.PlaneGeometry(T.river.width, L); rg.rotateX(-Math.PI / 2);
      const rv = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x2f6e6a, roughness: 0.15, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 }));
      rv.position.set((ax + bx) / 2, S.elev + 0.5, (az + bz) / 2); rv.rotation.y = Math.atan2(bx - ax, bz - az); grp.add(rv);
      for (let s = T.river.from - g; s > T.river.to; s -= g * 2) {
        const [x, z] = c(s, T.river.p);
        B.add("box", false, x, S.elev + 16, z, T.river.width + 30, 2, 22, yaw + Math.PI / 2, 0x6a5a4a, 9, 0, 0);
        solids.push({ x, z, ux: S.px, uz: S.pz, hl: (T.river.width + 30) / 2, hw: 11, y0: S.elev + 15, y1: S.elev + 18.5 });
      }
      X.river = { a: V3(ax, S.elev + 8, az), b: V3(bx, S.elev + 8, bz) };
    }
    if (T.pier) {
      let land = S.coast - 400; for (let s = S.coast - 900; s < S.coast + 800; s += 25) { const [x, z] = c(s, T.pier.p); if (groundAt(x, z) < -2) { land = s - 30; break; } }
      const [ax, az] = c(land + T.pier.len / 2, T.pier.p);
      B.add("box", false, ax, -2, az, 90, 8, T.pier.len, yaw + 0, 0xb8a888, 0, 0.3, 0);
      X.rects.push({ x: ax, z: az, hw: 45, hl: T.pier.len / 2, ux: S.sx, uz: S.sz, top: 6 });
      const [wx, wz] = c(land + T.pier.len * 0.35, T.pier.p);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(45, 1.6, 8, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff4060, emissiveIntensity: 0 }));
      wheel.position.set(wx, 52, wz); wheel.rotation.y = yaw; grp.add(wheel); X.lm.wheel = wheel;
      for (const sgn of [-1, 1]) B.add("box", false, wx + S.sx * sgn * 18, 6, wz + S.sz * sgn * 18, 3, 48, 3, yaw, 0xdddddd, 9, 0, 0);
    }
    // Maracanã: elliptical bowl with its roof ring and the pitch
    if (T.stadium) {
      const [mx, mz] = c(T.stadium.s, T.stadium.p), my = groundAt(mx, mz);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(160, 175, 32, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, side: THREE.DoubleSide, roughness: 0.7 }));
      bowl.scale.set(1, 1, 0.8); bowl.position.set(mx, my + 16, mz); bowl.rotation.y = yaw; bowl.castShadow = true; grp.add(bowl);
      const roof = new THREE.Mesh(new THREE.RingGeometry(110, 172, 48), new THREE.MeshStandardMaterial({ color: 0xf6f6f2, side: THREE.DoubleSide }));
      roof.rotation.x = -Math.PI / 2; roof.scale.set(1, 0.8, 1); roof.position.set(mx, my + 32, mz); grp.add(roof);
      const pitch = new THREE.Mesh(new THREE.CircleGeometry(100, 40), new THREE.MeshStandardMaterial({ color: 0x2f8a3a })); pitch.rotation.x = -Math.PI / 2; pitch.scale.set(1, 0.8, 1); pitch.position.set(mx, my + 0.6, mz); grp.add(pitch);
      X.rects.push({ x: mx, z: mz, hw: 170, hl: 140, ux: S.sx, uz: S.sz, top: my + 32 });
      keep.push([mx, mz, 200]);
    }
    // Dubai's Palm villas and Rio's favelas (planned with the landmarks)
    if (X.lm.favela) for (const [x, z] of X.lm.favela) { const y = peakH(x, z); if (y > 0) K.tower(B, { x, z, y: y - 1.5, w: RJ.lerp(5, 9, r()), d: RJ.lerp(5, 9, r()), h: RJ.lerp(4, 9, r()), ry: r() * TAU, glassP: 0, P: { stone: [0xe8b04a, 0xd9563a, 0x4f9ad8, 0x6fbf73, 0xe9e0cf, 0xc74a8e], glass: [0x888888] }, form: "box", st: 0, lit: 0.5 }, r); }
    if (id === "dubai") for (const rc of X.rects) if (rc.top === 2 && rc.hw < 40) for (let k = -rc.hl + 20; k < rc.hl - 10; k += 34) for (const sg2 of [-1, 1]) K.tower(B, { x: rc.x + rc.ux * k - rc.uz * sg2 * 16, z: rc.z + rc.uz * k + rc.ux * sg2 * 16, y: 2, w: 12, d: 12, h: RJ.lerp(6, 10, r()), ry: Math.atan2(rc.ux, rc.uz), glassP: 0, P: { stone: [0xf2ebe0, 0xe8dcc8], glass: [0x9fb6c4] }, form: "box", st: 0 }, r);

    X.lm.stats = { edge: edge.size, special: special.length, port: T.port, marina: T.marina, hw: hws.length };
    const meshes = K.meshes(B, grp, Pal);
    const heightAt = K.grid(B);
    const far = K.farSkyline(B, W.scene, W.BACK);
    const streets = K.streets(grp, S, { R: stR, block: g, aveEvery: T.aveEvery || 4, street: T.street, lamp: id === "dubai" ? 0xffc870 : id === "tokyo" || id === "hk" ? 0xfff0e0 : 0xffb066 });
    const traffic = K.traffic(grp, S, { cars: id === "dubai" ? 380 : 650 }, paths);
    const nn = K.neon(grp, neon);
    const av = K.avLights(B, grp);

    /* ---------- the race route: sea approach, under the bridge, down the canyon, the slalom, up the hero ---------- */
    const route = [], Y0 = S.elev;
    const gate = (s, p, y, keepIt) => { const [x, z] = c(s, p); const v = V3(x, Math.max(y, groundAt(x, z) + 70), z); v.keep = !!keepIt; route.push(v); };
    if (bridge) {
      const bm = bridge.mid, sp = bridge.dir;
      route.push(Object.assign(bm.clone().addScaledVector(V3(S.px, 0, S.pz), 900).setY(90), { keep: false }));
      route.push(Object.assign(bm.clone().setY(Math.max(bridge.deck - 26, 14)), { keep: true, tight: true }));
      route.push(Object.assign(bm.clone().addScaledVector(V3(-S.px, 0, -S.pz), 900).addScaledVector(sp, -200).setY(120), { keep: false }));
    } else gate(S.coast + 1200, -canyonEnd - 800, 140, false);
    if (X.river) { route.push(Object.assign(X.river.a.clone(), { keep: true })); const mid = X.river.a.clone().lerp(X.river.b, 0.5); route.push(Object.assign(mid, { keep: true })); }
    gate(cs, -canyonEnd - 500, Y0 + 140, false);
    for (let p = -canyonEnd; p <= canyonEnd; p += 650) gate(cs, p, Y0 + RJ.lerp(70, 110, r()), true);
    for (const sl of slalom) gate(cs - sl.side * cw * T.slalom.off * 0.9, sl.p, Y0 + 85, true);
    if (hero) {
      const toward = V3(c(cs, canyonEnd)[0] - hero.x, 0, c(cs, canyonEnd)[1] - hero.z).normalize();
      route.push(Object.assign(V3(hero.x + toward.x * (hero.w + 70), hero.y + hero.h * 0.5, hero.z + toward.z * (hero.w + 70)), { keep: true }));
      route.push(Object.assign(V3(hero.x - toward.x * 40, hero.top + 140, hero.z - toward.z * 40), { keep: true }));
    }
    const hAll = (x, z) => Math.max(heightAt(x, z), peakH(x, z), groundAt(x, z));
    K.clearRoute(route, hAll, 45);
    X.lm.route = route;
    return {
      meshes, far, count: B.foot.length / 4,
      heightAt: (x, z) => heightAt(x, z),
      update(dt, cam, d) {
        traffic.update(dt, d < 9000);
        if (nn) nn.update();
        if (av) av.update(performance.now() / 1000);
        for (const hw of hws) hw.update();
        streets.visible = d < 16000;
        if (X.lm.wheel) { X.lm.wheel.rotation.z += dt * 0.05; X.lm.wheel.material.emissiveIntensity = K.NIGHT.value * 1.5; }
      }
    };
  }
  CI.route = (id) => (CI.built[id] && CI.built[id].route ? CI.built[id].route.map((v) => v.clone()) : null);

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

    /* ---------- the city itself: districts, canyon, slalom, heroes, streets, traffic, neon (citykit.js) ---------- */
    const peakH = (x, z) => { let h = -Infinity; for (const p of peaks) { const dx = (x - p.x) / p.sx, dz = (z - p.z) / p.sz, r = Math.hypot(dx, dz); if (r < p.R) h = Math.max(h, p.base + p.hp(r / p.R) * p.H); } return h; };
    const city = buildCity(id, S, { grp, c, groundAt, keep, rects, peaks, peakH, lm, solids: lm.solids = lm.solids || [] });
    lm.count = city.count;
    lm.heightAt = (x, z) => {
      if (Math.abs(x - S.x) > 45000 || Math.abs(z - S.z) > 45000) return -Infinity;
      let h = city.heightAt(x, z);
      for (const r of rects) { const dx = x - r.x, dz = z - r.z, u = dx * r.ux + dz * r.uz, v = -dx * r.uz + dz * r.ux; if (Math.abs(u) < r.hl && Math.abs(v) < r.hw) h = Math.max(h, r.top); }
      if (peaks.length) h = Math.max(h, peakH(x, z));
      return h;
    };
    lm.solidAt = (p) => lm.solids.length > 0 && Math.abs(p.x - S.x) < 12000 && Math.abs(p.z - S.z) < 12000 && RJ.cityKit.inSolids(lm.solids, p);
    lm.update = (dt, cam) => {
      const d = Math.hypot(cam.position.x - S.x, cam.position.z - S.z);
      grp.visible = d < 60000;
      for (const m of city.meshes) { const t = m.userData.tile; m.visible = Math.hypot(cam.position.x - t.x, cam.position.z - t.z) < 15000; } // beyond: the far skyline twin
      RJ.cityKit.NIGHT.value = RJ.clamp(1 - RJ.smooth(-4, 8, W.sunElev), 0, 1);
      // wet streets and facades follow the local rain, drying slowly after it stops
      RJ.cityKit.wetTick(dt);
      city.update(dt, cam, d);
      if (lm.christMesh) lm.christMesh.material.emissiveIntensity = RJ.cityKit.NIGHT.value * 0.6; // floodlit at night
      for (const f of lm.far) { const fd = Math.hypot(cam.position.x - f.position.x, cam.position.z - f.position.z); f.visible = fd > 18000; f.material.color.set(0x7c8796).lerp(W.scene.fog.color, RJ.clamp((fd - 15000) / 120000, 0, 0.75)); }
      if (city.far) { city.far.visible = d > 3000; const N = RJ.cityKit.NIGHT.value; city.far.material.color.setRGB(0.42, 0.46, 0.52).multiplyScalar(1 - N * 0.75).lerp(W.scene.fog.color, RJ.clamp((d - 12000) / 90000, 0, 0.7)); if (N > 0.3) city.far.material.color.lerp(new THREE.Color(0.55, 0.45, 0.3), N * 0.3); }
    };
    CI.built[id] = lm;
    return lm;
  };
})(window.RJ);
