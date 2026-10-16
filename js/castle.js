/* Highkeep: a colossal fortress crowning a mountain summit in Free Flight.
   Geometry is merged per material (a handful of draw calls); stone and slate are shaded procedurally in world space.
   Collision is a height field (walls, towers, roofs) plus solid gate lintels, so the four aligned gates can be flown through. */
(function (RJ) {
  "use strict";
  const C = (RJ.castle = {});
  const DEPTH = 34; // foundations sink this far below the plateau

  // Layout in castle-local metres. +z faces the approach (the player's start).
  const OUT = { n: 10, R: 300, h: 50, th: 10, tR: 15, tH: 78, cone: 34 };
  const INN = { n: 8, R: 150, cz: -100, h: 66, th: 11, tR: 13, tH: 100, cone: 32 };
  const GATE = { half: 18, low: 42 };

  let prims = [], lintels = [], gates = [];
  C.site = null;

  /* ---------------- site selection ---------------- */
  /** Find a dramatic summit 4–10 km ahead of the start, clear of the airbase, with the gate facing the start. */
  C.plan = function (sx, sz, yaw) {
    const gen = RJ.world.gen;
    gen.setCastle(null);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const startH = Math.max(0, gen.height(sx, sz));
    const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    let best = null;
    for (let d = 4500; d <= 9500; d += 500) {
      for (let a = -0.6; a <= 0.61; a += 0.12) {
        const ca = Math.cos(a), sa = Math.sin(a);
        let x = sx + (fx * ca - fz * sa) * d, z = sz + (fx * sa + fz * ca) * d;
        let h = gen.height(x, z);
        // climb to the local summit
        for (let k = 0; k < 10; k++) {
          let bx = x, bz = z, bh = h;
          for (const [ox, oz] of RING) { const hh = gen.height(x + ox * 140, z + oz * 140); if (hh > bh) { bh = hh; bx = x + ox * 140; bz = z + oz * 140; } }
          if (bh === h) break;
          x = bx; z = bz; h = bh;
        }
        const dist = Math.hypot(x - sx, z - sz);
        if (dist < 3500 || dist > 11500 || h < 60) continue;
        const fits = h <= Math.min(2050, startH + 1600) && h >= startH + 250;
        let clear = gen.airbaseMask(x, z) === 0, ring = 0;
        for (const [ox, oz] of RING) {
          if (gen.airbaseMask(x + ox * 1100, z + oz * 1100) > 0) clear = false;
          ring += gen.height(x + ox * 750, z + oz * 750);
        }
        if (!clear) continue;
        const prom = h - ring / RING.length;
        // can the castle be seen from the start? (sight line to the top of the great tower)
        let seen = 1;
        for (let k = 1; k < 24; k++) {
          const t = k / 24, ly = startH + 25 + (h + 220 - startH - 25) * t;
          if (gen.height(sx + (x - sx) * t, sz + (z - sz) * t) > ly) { seen = 0; break; }
        }
        // out-of-band summits stay as a fallback for unusual terrain
        const score = prom * 1.4 + Math.min(h - startH, 1300) * 0.5 - Math.abs(a) * 400 + seen * 900 - (fits ? 0 : 5000);
        if (!best || score > best.score) best = { x, z, h, score };
      }
    }
    if (!best) {
      const x = sx + fx * 7000, z = sz + fz * 7000;
      best = { x, z, h: Math.max(gen.height(x, z), 120) };
    }
    return {
      x: best.x, z: best.z, r: 360, fall: 560, elev: best.h - 12,
      rot: Math.atan2(sx - best.x, sz - best.z),
      seed: (Math.floor(best.x) * 73856093) ^ (Math.floor(best.z) * 19349663)
    };
  };

  /* ---------------- materials ---------------- */
  const STONE_CODE = [
    "#include <roughnessmap_fragment>",
    "{",
    "  vec3 an = abs(normalize(vCsN));",
    "#ifdef CS_ROOF",
    "  vec2 pc = vec2(vCsP.x + vCsP.z, vCsP.y); vec2 bs = vec2(1.3, 0.75);",
    "#else",
    "  vec2 pc = an.y > 0.75 ? vCsP.xz : vec2(an.x > an.z ? vCsP.z : vCsP.x, vCsP.y); vec2 bs = vec2(3.4, 1.6);",
    "#endif",
    "  float row = floor(pc.y / bs.y);",
    "  pc.x += rjH(vec2(row, 3.7)) * bs.x;",
    "  vec2 cell = floor(pc / bs);",
    "  vec2 f = fract(pc / bs);",
    "  vec2 e = min(f, 1.0 - f) * bs;",
    "#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)",
    "  float fw = length(fwidth(pc));",
    "#else",
    "  float fw = length(vViewPosition) * 0.0016;",
    "#endif",
    "  float joint = (1.0 - smoothstep(0.09, 0.09 + max(fw, 0.03), min(e.x, e.y))) * (1.0 - smoothstep(0.15, 0.6, fw));",
    "  float tint = rjH(cell + 11.0);",
    "  float big = rjFbm(vCsP.xz * 0.012 + vCsP.y * 0.008);",
    "  float hgt = vCsP.y - csBase;",
    "  diffuseColor.rgb *= (0.84 + 0.26 * tint) * (1.0 - joint * 0.5) * (0.85 + 0.3 * big);",
    "#ifndef CS_ROOF",
    "  float streak = rjVN(vec2((vCsP.x + vCsP.z) * 0.9, vCsP.y * 0.04));",
    "  diffuseColor.rgb *= 1.0 - streak * 0.14 * smoothstep(0.2, 0.9, 1.0 - an.y);",
    "  float moss = (1.0 - smoothstep(0.0, 14.0 + big * 10.0, hgt)) * smoothstep(0.35, 0.65, rjVN(vCsP.xz * 0.08 + vCsP.y * 0.1));",
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.11), moss * 0.55);",
    "  diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(-10.0, 30.0, hgt);",
    "#endif",
    "  roughnessFactor = clamp(roughnessFactor + joint * 0.08 - tint * 0.06, 0.3, 1.0);",
    "}"
  ].join("\n");
  C.baseU = { value: 0 };
  function stoneMat(color, roof, rough) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: roof ? 0.12 : 0 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.csBase = C.baseU;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCsP; varying vec3 vCsN;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCsP = (modelMatrix * vec4(transformed, 1.0)).xyz; vCsN = normalize(mat3(modelMatrix) * objectNormal);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + (roof ? "#define CS_ROOF\n" : "") + "uniform float csBase; varying vec3 vCsP; varying vec3 vCsN;\n" + RJ.world.GLSL_NOISE)
        .replace("#include <roughnessmap_fragment>", STONE_CODE);
      RJ.world.addCloudShadows(shader, "vCsP");
    };
    // both variants share one onBeforeCompile source, so give them distinct program keys
    m.customProgramCacheKey = () => (roof ? "rj-castle-roof" : "rj-castle-stone");
    return m;
  }
  C.timeU = { value: 0 };
  function flagMat(color) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.csTime = C.timeU;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float csTime;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "float fk = clamp(position.x / 16.0, 0.0, 1.0);",
          "transformed.z += sin(position.x * 0.42 - csTime * 5.2 + position.y * 0.18) * fk * 1.7;",
          "transformed.y -= fk * fk * 0.9;"
        ].join("\n"));
    };
    m.customProgramCacheKey = () => "rj-castle-flag";
    return m;
  }

  /* ---------------- geometry helpers ---------------- */
  const _m = new THREE.Matrix4();
  function put(list, geo, x, y, z, ry) {
    _m.makeRotationY(ry || 0).setPosition(x, y, z);
    geo.applyMatrix4(_m);
    list.push(geo);
  }
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const hasCol = list.every((g) => g.attributes.color), col = hasCol ? new Float32Array(nv * 3) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      if (col) col.set(g.attributes.color.array, vo * 3);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
      else for (let i = 0; i < c; i++) idx[io++] = vo + i;
      vo += c;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  /** Gable roof: triangle (width w, rise hr) extruded along z for length L, base at y = 0. */
  function prism(w, hr, L) {
    const a = -w / 2, b = w / 2, z0 = -L / 2, z1 = L / 2;
    const p = [
      a, 0, z1, b, 0, z1, 0, hr, z1,
      a, 0, z0, 0, hr, z0, b, 0, z0,
      b, 0, z1, b, 0, z0, 0, hr, z0, b, 0, z1, 0, hr, z0, 0, hr, z1,
      a, 0, z1, 0, hr, z1, 0, hr, z0, a, 0, z1, 0, hr, z0, a, 0, z0
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Road from the front gate down the mountainside: a terrain-hugging ribbon with gentle switchbacks. */
  function buildRoad(site, rnd) {
    const gen = RJ.world.gen, c = Math.cos(site.rot), n = Math.sin(site.rot);
    const toW = (lx, lz) => [site.x + lx * c + lz * n, site.z - lx * n + lz * c];
    const pts = [];
    let lx = 0, lz = 300, heading = 0, drop = 0;
    const phase = rnd() * 6;
    for (let i = 0; i < 90; i++) {
      const [wx, wz] = toW(lx, lz);
      const h = gen.height(wx, wz);
      pts.push([lx, lz, h - site.elev]);
      // steer toward the gentler slope while weaving
      heading = Math.sin(i * 0.11 + phase) * 0.9;
      lx += Math.sin(heading) * 22; lz += Math.cos(heading) * 22;
      drop = site.elev - h;
      if (drop > 900 || h < 5) break;
    }
    if (pts.length < 6) return null;
    const half = 4.5, pos = [], idx = [], lamps = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const px = -tz, pz = tx, p = pts[i];
      for (const sd of [-1, 1]) {
        const ex = p[0] + px * half * sd, ez = p[1] + pz * half * sd;
        const [wx, wz] = toW(ex, ez);
        pos.push(ex, gen.height(wx, wz) - site.elev + 1.2, ez);
      }
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      if (i % 4 === 2) lamps.push(p[0] + px * (half + 2), p[2] + 5, p[1] + pz * (half + 2));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a6153, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
    return { mesh, lamps };
  }

  /* ---------------- build ---------------- */
  C.build = function (site) {
    C.site = site;
    prims = []; lintels = []; gates = [];
    C.baseU.value = site.elev;
    const rnd = RJ.world.gen.mulberry32(site.seed >>> 0);
    const S = [], R = [], G = [], Wn = [];
    const grp = new THREE.Group();
    grp.position.set(site.x, site.elev, site.z);
    grp.rotation.y = site.rot;
    const flagM = flagMat(0x9e1b1f), bannerM = new THREE.MeshStandardMaterial({ color: 0x8e1a1d, roughness: 0.85, side: THREE.DoubleSide });
    const flags = [];

    const merlonRow = (ax, az, bx, bz, y, off) => {
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, ry = Math.atan2(ux, uz);
      for (let t = 2.5; t < L - 1.5; t += 5) {
        for (const s of off) put(S, new THREE.BoxGeometry(1.3, 3.2, 2.6), ax + ux * t + uz * s, y + 1.6, az + uz * t - ux * s, ry);
      }
    };
    const wall = (ax, az, bx, bz, h, th) => {
      const L = Math.hypot(bx - ax, bz - az);
      put(S, new THREE.BoxGeometry(th, h + DEPTH, L), (ax + bx) / 2, (h - DEPTH) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az));
      merlonRow(ax, az, bx, bz, h, [th / 2 - 0.65, -(th / 2 - 0.65)]);
      prims.push({ t: "seg", ax, az, bx, bz, ht: th / 2 + 0.5, top: h + 2.5 });
    };
    const flag = (x, y, z) => {
      put(G, new THREE.CylinderGeometry(0.35, 0.45, 18, 6), x, y + 9, z);
      const geo = new THREE.PlaneGeometry(16, 10, 12, 5); geo.translate(8, 0, 0);
      const f = new THREE.Mesh(geo, flagM);
      f.position.set(x, y + 13, z); f.rotation.y = Math.PI * 0.5 + 0.3;
      grp.add(f); flags.push(f);
    };
    const tower = (x, z, r, H, cone, o = {}) => {
      put(S, new THREE.CylinderGeometry(r, r * 1.08, H + DEPTH, 22), x, (H - DEPTH) / 2, z);
      put(S, new THREE.CylinderGeometry(r * 1.18, r * 1.04, 6.5, 22), x, H - 3.25, z);
      const ring = r * 1.18 - 0.6, nm = Math.max(8, Math.floor((Math.PI * 2 * ring) / 4.6));
      for (let i = 0; i < nm; i++) { const ph = (i / nm) * Math.PI * 2; put(S, new THREE.BoxGeometry(2.4, 3.2, 1.2), x + Math.sin(ph) * ring, H + 1.6, z + Math.cos(ph) * ring, ph); }
      put(R, new THREE.ConeGeometry(r, cone, 22), x, H + 0.5 + cone / 2, z);
      if (!o.flag) {
        put(G, new THREE.CylinderGeometry(0.15, 0.5, 9, 6), x, H + cone + 4, z);
        put(G, new THREE.SphereGeometry(1.1, 8, 6), x, H + cone + 8.5, z);
      }
      // arrow slits and lit windows spiralling up the drum
      const rows = Math.max(2, Math.floor(H / 26));
      for (let k = 1; k <= rows; k++) {
        const y = (H * k) / (rows + 1), n = r > 16 ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const ph = ((i + k * 0.5) / n) * Math.PI * 2;
          put(Wn, new THREE.BoxGeometry(r > 16 ? 2.6 : 1.4, r > 16 ? 6 : 4.5, 1.2), x + Math.sin(ph) * r * 1.045, y, z + Math.cos(ph) * r * 1.045, ph);
        }
      }
      if (o.flag) flag(x, H + cone - 1, z);
      prims.push({ t: "cyl", x, z, r: r * 1.08, rr: r, top: H + 3, cone });
    };
    const hall = (x, z, w, d, H, roofH, o = {}) => {
      put(S, new THREE.BoxGeometry(w, H + DEPTH, d), x, (H - DEPTH) / 2, z);
      if (roofH > 0) {
        const along = d >= w;
        const g = prism((along ? w : d) + 2, roofH, (along ? d : w) + 2);
        put(R, g, x, H, z, along ? 0 : Math.PI / 2);
      } else if (!o.plain) {
        merlonRow(x - w / 2, z - d / 2, x + w / 2, z - d / 2, H, [0.65]);
        merlonRow(x + w / 2, z - d / 2, x + w / 2, z + d / 2, H, [0.65]);
        merlonRow(x + w / 2, z + d / 2, x - w / 2, z + d / 2, H, [0.65]);
        merlonRow(x - w / 2, z + d / 2, x - w / 2, z - d / 2, H, [0.65]);
      }
      // windows on all four faces
      const wy = o.tall ? [H * 0.5] : [];
      if (!o.tall && !o.plain) for (let y = 16; y < H - 6; y += 15) wy.push(y);
      const ww = o.tall ? 3.2 : 2.4, wh = o.tall ? H * 0.42 : 4.6, sp = o.tall ? 9 : 8;
      for (const y of wy) {
        for (let u = -w / 2 + sp / 2 + 2; u <= w / 2 - sp / 2; u += sp) { put(Wn, new THREE.BoxGeometry(ww, wh, 1.2), x + u, y, z + d / 2 + 0.1, 0); put(Wn, new THREE.BoxGeometry(ww, wh, 1.2), x + u, y, z - d / 2 - 0.1, 0); }
        for (let u = -d / 2 + sp / 2 + 2; u <= d / 2 - sp / 2; u += sp) { put(Wn, new THREE.BoxGeometry(1.2, wh, ww), x + w / 2 + 0.1, y, z + u, 0); put(Wn, new THREE.BoxGeometry(1.2, wh, ww), x - w / 2 - 0.1, y, z + u, 0); }
      }
      prims.push({ t: "box", x, z, hx: w / 2, hz: d / 2, top: H + (roofH > 0 ? 0 : 3.2), roof: roofH, along: d >= w });
    };
    const banner = (x, y, z, ry, h) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(7, h), bannerM);
      b.position.set(x, y, z); b.rotation.y = ry; grp.add(b);
    };
    /** A curtain wall ring with towers at its corners and gatehouses on its front and rear faces. */
    const ring = (P, cz, gateTop) => {
      const pts = [];
      for (let i = 0; i < P.n; i++) {
        const th = ((i + 0.5) / P.n) * Math.PI * 2;
        const fixed = i === 0 || i === P.n - 1 || i === P.n / 2 - 1 || i === P.n / 2;
        const R = P.R * (fixed ? 1 : 0.93 + rnd() * 0.14);
        pts.push([Math.sin(th) * R, cz + Math.cos(th) * R]);
      }
      for (let i = 0; i < P.n; i++) {
        const a = pts[i], b = pts[(i + 1) % P.n];
        const isGate = i === P.n - 1 || i === P.n / 2 - 1;
        if (isGate) {
          const zg = a[1], sgn = Math.sign(b[0] - a[0]);
          wall(a[0], a[1], -sgn * GATE.half, zg, P.h, P.th);
          wall(sgn * GATE.half, zg, b[0], b[1], P.h, P.th);
          const gR = P.tR + 3, gx = GATE.half + gR * 1.1;
          tower(-gx, zg, gR, P.tH + 16, P.cone + 4, { flag: true });
          tower(gx, zg, gR, P.tH + 16, P.cone + 4, { flag: true });
          // gate lintel: a solid bridge between the gatehouse towers, open below
          const dth = P.th + 6;
          put(S, new THREE.BoxGeometry(GATE.half * 2 + 4, gateTop - GATE.low, dth), 0, (GATE.low + gateTop) / 2, zg);
          merlonRow(-GATE.half - 2, zg + dth / 2 - 0.65, GATE.half + 2, zg + dth / 2 - 0.65, gateTop, [0]);
          merlonRow(-GATE.half - 2, zg - dth / 2 + 0.65, GATE.half + 2, zg - dth / 2 + 0.65, gateTop, [0]);
          lintels.push({ x0: -GATE.half - 2, x1: GATE.half + 2, y0: GATE.low - 1, y1: gateTop + 3.5, z0: zg - dth / 2, z1: zg + dth / 2 });
          gates.push(zg);
          // heraldic banners on the outward faces of the gatehouse
          const out = zg > cz ? 1 : -1;
          for (const sx of [-gx, gx]) banner(sx, P.tH - 18, zg + out * (gR * 1.06 + 0.6), out > 0 ? 0 : Math.PI, 30);
        } else wall(a[0], a[1], b[0], b[1], P.h, P.th);
      }
      pts.forEach((p, i) => {
        const isGateCorner = i === 0 || i === P.n - 1 || i === P.n / 2 - 1 || i === P.n / 2;
        tower(p[0], p[1], P.tR, P.tH + (isGateCorner ? 0 : rnd() * 14), P.cone, { flag: rnd() < 0.3 });
      });
    };

    ring(OUT, 0, 66);
    ring(INN, INN.cz, 78);
    // inner ward cobbles
    put(S, new THREE.CylinderGeometry(INN.R * 0.9, INN.R * 0.9, 0.6, 40), 0, 0.0, INN.cz);
    // the keep: crenellated block with corner turrets and a roofed upper storey
    const K = { x: 72, z: -120, w: 64, d: 56, H: 120 };
    hall(K.x, K.z, K.w, K.d, K.H, 0);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tower(K.x + ox * K.w / 2, K.z + oz * K.d / 2, 8.5, K.H + 32, 30, { flag: ox === 1 && oz === 1 });
    hall(K.x, K.z, 36, 30, K.H + 30, 0, { plain: true });
    for (let u = -12; u <= 12; u += 8) { put(Wn, new THREE.BoxGeometry(2.4, 5, 1.2), K.x + u, K.H + 16, K.z + 15.1, 0); put(Wn, new THREE.BoxGeometry(2.4, 5, 1.2), K.x + u, K.H + 16, K.z - 15.1, 0); }
    const pyr = new THREE.ConeGeometry(36 / Math.SQRT2 * 1.06, 38, 4); pyr.rotateY(Math.PI / 4); pyr.scale(1, 1, 30 / 36);
    put(R, pyr, K.x, K.H + 30 + 19, K.z);
    prims.push({ t: "box", x: K.x, z: K.z, hx: 18, hz: 15, top: K.H + 30, pyr: 38 });
    banner(K.x - 14, K.H - 30, K.z + K.d / 2 + 0.7, 0, 44);
    banner(K.x + 14, K.H - 30, K.z + K.d / 2 + 0.7, 0, 44);
    // the great tower: the castle's needle, visible from every valley around
    tower(-75, -150, 22, 196, 72, { flag: true });
    // great hall, chapel with bell tower, and barracks in the outer bailey
    hall(-75, -72, 46, 72, 44, 24, { tall: true });
    hall(64, -36, 32, 46, 34, 20, { tall: true });
    tower(64, -6, 6.5, 72, 22);
    hall(-182, 70, 30, 110, 22, 14);
    hall(182, 70, 30, 110, 22, 14);
    // cottages and workshops tucked against the curtain wall, clear of the gate axis
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd() * 0.15, rr = 232 + rnd() * 18;
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (Math.abs(x) < 46 || (Math.abs(x) > 150 && z > 0 && z < 140)) continue;
      const w = 12 + rnd() * 8, d = 9 + rnd() * 6;
      put(S, new THREE.BoxGeometry(w, 10 + DEPTH, d), x, (10 - DEPTH) / 2, z, a);
      const rf = prism(d + 1.5, 6 + rnd() * 2, w + 1.5); rf.rotateY(Math.PI / 2);
      put(R, rf, x, 10, z, a);
      prims.push({ t: "cyl", x, z, r: Math.max(w, d) * 0.55, rr: 0.001, top: 14, cone: 0 });
    }
    // torches along the curtain-wall walks and lanterns flanking every gate (lit at dusk)
    const torches = [], lanterns = [];
    const ringPts = (P, cz) => { const out = []; for (let i = 0; i < 120; i++) { const th = (i / 120) * Math.PI * 2; out.push([Math.sin(th) * (P.R + P.th * 0.6), cz + Math.cos(th) * (P.R + P.th * 0.6)]); } return out; };
    ringPts(OUT, 0).forEach((p, i) => { if (i % 4 === 0 && Math.abs(p[0]) > GATE.half + 30) torches.push(p[0], OUT.h + 4.5, p[1]); });
    ringPts(INN, INN.cz).forEach((p, i) => { if (i % 5 === 0 && Math.abs(p[0]) > GATE.half + 26) torches.push(p[0], INN.h + 4.5, p[1]); });
    for (const zg of gates) for (const sx of [-1, 1]) for (const dz of [-9, 9]) lanterns.push(sx * (GATE.half - 1.5), 24, zg + dz);
    // a switchback road winding down from the front gate, lamp posts along it
    const road = buildRoad(site, rnd);
    if (road) { grp.add(road.mesh); for (let i = 0; i < road.lamps.length; i += 3) lanterns.push(road.lamps[i], road.lamps[i + 1], road.lamps[i + 2]); }

    const stone = new THREE.Mesh(merge(S), stoneMat(0x9a958b, false, 0.92));
    const roof = new THREE.Mesh(merge(R), stoneMat(0x3e4d5f, true, 0.62));
    const gold = new THREE.Mesh(merge(G), new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.9 }));
    const winM = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.5, emissive: 0xffa04a, emissiveIntensity: 0.05 });
    const win = new THREE.Mesh(merge(Wn), winM);
    const lampGeo = new THREE.SphereGeometry(1, 8, 6);
    const torchM = new THREE.MeshBasicMaterial({ color: 0x000000 }), lanternM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const inst = (arr, mat, sc) => {
      const im = new THREE.InstancedMesh(lampGeo, mat, arr.length / 3), m4 = new THREE.Matrix4();
      for (let i = 0; i < arr.length / 3; i++) { m4.makeScale(sc, sc * 1.3, sc).setPosition(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]); im.setMatrixAt(i, m4); }
      im.instanceMatrix.needsUpdate = true; grp.add(im); return im;
    };
    if (torches.length) inst(torches, torchM, 0.9);
    if (lanterns.length) inst(lanterns, lanternM, 1.3);
    for (const m of [stone, roof, gold, win]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    win.castShadow = false;
    flags.forEach((f) => (f.castShadow = true));
    grp.userData = { flags, winM, torchM, lanternM, passed: [], passT: 0, prevLz: null, announced: false };
    return grp;
  };

  /** Gate planes (castle-local z) and opening size, for challenges. */
  C.gateInfo = () => ({ zs: gates.slice(), half: GATE.half, low: GATE.low });
  /** Shared geometry/material helpers for other landmarks. */
  C.util = { put, merge, prism, stoneMat, flagMat };

  C.dispose = function (grp) {
    grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); } });
    C.site = null;
  };

  /* ---------------- queries ---------------- */
  function toLocal(x, z) {
    const s = C.site, dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot), n = Math.sin(s.rot);
    return [dx * c - dz * n, dx * n + dz * c];
  }
  /** Top of the masonry at (x, z), or -Infinity off the castle. Gate passages stay open. */
  C.heightAt = function (x, z) {
    const s = C.site;
    if (!s) return -Infinity;
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > 380 * 380) return -Infinity;
    const [lx, lz] = toLocal(x, z);
    let top = -Infinity;
    for (const p of prims) {
      if (p.t === "cyl") {
        const d = Math.hypot(lx - p.x, lz - p.z);
        if (d < p.r) top = Math.max(top, d < p.rr ? p.top - 3 + p.cone * (1 - d / p.rr) + 0.5 : p.top);
      } else if (p.t === "box") {
        const ux = Math.abs(lx - p.x) / p.hx, uz = Math.abs(lz - p.z) / p.hz;
        if (ux < 1 && uz < 1) {
          let h = p.top;
          if (p.roof) h += p.roof * (1 - (p.along ? ux : uz));
          if (p.pyr) h += p.pyr * (1 - Math.max(ux, uz));
          top = Math.max(top, h);
        }
      } else {
        const ex = p.bx - p.ax, ez = p.bz - p.az, L2 = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((lx - p.ax) * ex + (lz - p.az) * ez) / L2));
        const qx = p.ax + ex * t - lx, qz = p.az + ez * t - lz;
        if (qx * qx + qz * qz < p.ht * p.ht) top = Math.max(top, p.top);
      }
    }
    return top === -Infinity ? top : s.elev + top;
  };
  /** True inside a gate lintel (the only overhanging masonry). */
  C.solidAt = function (pos) {
    const s = C.site;
    if (!s) return false;
    const y = pos.y - s.elev;
    if (y < GATE.low - 2 || y > 90) return false;
    const [lx, lz] = toLocal(pos.x, pos.z);
    for (const b of lintels) if (lx > b.x0 && lx < b.x1 && y > b.y0 && y < b.y1 && lz > b.z0 && lz < b.z1) return true;
    return false;
  };

  /* ---------------- per frame ---------------- */
  C.update = function (dt, grp) {
    C.timeU.value += dt;
    const W = RJ.world, U = grp.userData;
    const night = 1 - RJ.smooth(-3, 9, W.sunElev);
    U.winM.emissiveIntensity = 0.05 + night * 2.4;
    // flicker a little; HDR values bloom into warm halos after dark
    const fl = 0.85 + 0.15 * Math.sin(C.timeU.value * 13.1) * Math.sin(C.timeU.value * 7.3);
    U.torchM.color.setRGB(3.2, 1.5, 0.45).multiplyScalar((0.04 + night * 1.1) * fl);
    U.lanternM.color.setRGB(3.6, 2.4, 1.1).multiplyScalar(0.05 + night * 1.2);
    // gate run: thread the gates in one pass
    const mode = RJ.game && RJ.game.mode, pl = mode && mode.player;
    if (!pl || pl.state !== "flying" || !C.site || mode.kind !== "free") { U.prevLz = null; return; }
    const [lx, lz] = toLocal(pl.pos.x, pl.pos.z), ly = pl.pos.y - C.site.elev;
    const near = Math.hypot(lx, lz);
    if (!U.announced && near < 2600) { U.announced = true; RJ.ui.flash("HIGHKEEP CASTLE", "Thread all four gates in one pass", 3); }
    U.passT = Math.max(0, U.passT - dt);
    if (U.passT <= 0 && U.passed.length) U.passed.length = 0;
    if (U.prevLz != null && near < 400) {
      gates.forEach((zg, i) => {
        if ((U.prevLz - zg) * (lz - zg) <= 0 && U.prevLz !== lz && Math.abs(lx) < GATE.half && ly > 0 && ly < GATE.low) {
          if (!U.passed.includes(i)) U.passed.push(i);
          U.passT = 10;
          const n = U.passed.length;
          if (n >= gates.length) { RJ.ui.flash("CASTLE RUN!", "All four gates threaded", 3); U.passed.length = 0; if (RJ.audio.ring) RJ.audio.ring(); }
          else { RJ.ui.flash("GATE " + n + " / " + gates.length, null, 1); if (RJ.audio.ring) RJ.audio.ring(); }
        }
      });
    }
    U.prevLz = lz;
  };
})(window.RJ);
