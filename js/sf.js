/* Ridgeline Jets — San Francisco Bay: the city, Alcatraz, the Golden Gate and Bay Bridges.
 * The bay itself is real terrain (js/dem-sf.js: USGS/NOAA topography and bathymetry, so the coastline, the Golden
 * Gate strait, Angel Island, Treasure Island and Alcatraz are their true shapes and sizes). This file builds the
 * structures on it at 1:1 scale from real coordinates, lazily once the camera comes within 45 km:
 *  · Alcatraz: cellhouse, lighthouse (sweeping beam at night), water tower, power house and stack, Building 64 with
 *    its painted sign, the dock, guard tower, recreation-yard walls, industries buildings and ruins.
 *  · Golden Gate Bridge (towers 227 m, deck 67 m, 1,280 m main span) and the Bay Bridge west spans.
 *  · ~45k city buildings on the real street-grid area, a Financial District of towers, the Transamerica Pyramid,
 *    Salesforce Tower, Coit Tower, the Ferry Building and Sutro Tower; tiles beyond 9 km hide (terrain colour remains).
 *  · Sea mist drifting through the Gate and around the island, and fog horns. */
(function (RJ) {
  "use strict";
  const SF = (RJ.sf = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const U = () => RJ.castle.util;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _e = new THREE.Euler(), _c = new THREE.Color();
  SF.ready = false;

  const DEFS = [
    { id: "alcatraz", name: "Alcatraz Island", sub: "The Rock: the federal penitentiary in San Francisco Bay", icon: "castle", r: 2500, xp: 500 },
    { id: "goldengate", name: "Golden Gate Bridge", sub: "1,280 m main span, towers 227 m above the strait", icon: "bridge", r: 3000, xp: 400 },
    { id: "sanfrancisco", name: "San Francisco", sub: "The city on its 1:1 hills, from the Financial District to Ocean Beach", icon: "city", r: 6000, xp: 400 }
  ];
  if (RJ.atlas && RJ.atlas.DEFS) for (const d of DEFS) if (!RJ.atlas.DEFS.some((x) => x.id === d.id)) RJ.atlas.DEFS.push(d);

  /** Real coordinates → world [x, z]. */
  function geo(lat, lon) {
    const W = RJ.world, g = W.sfGeo, Z = W.gen.sfZone;
    return [Z.x + (lon - g.lon) * g.mE, Z.z - (lat - g.lat) * g.mN];
  }
  SF.geo = geo;
  SF.available = () => !!(RJ.world && RJ.world.demSF && RJ.world.sfGeo);

  /* ======================= materials ======================= */
  const night = { value: 0 };
  SF.night = night;
  /** Facades in object space (instance scale aware): window grid, lit windows at night, rooftops, weathering. */
  function facade(o) {
    const m = new THREE.MeshStandardMaterial({ color: o.color || 0xffffff, roughness: o.rough || 0.8, metalness: o.metal || 0, vertexColors: !!o.vcol });
    const key = "rjFacade" + [o.wx, o.wy, o.ww, o.wh, o.streak, o.lit, o.glass].join("_");
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = night;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vFP; varying vec3 vFN; varying float vSeed;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "#ifdef USE_INSTANCING",
          "  vec3 rjSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vFP = position * rjSc; vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;",
          "#else",
          "  vFP = position; vSeed = 0.0;",
          "#endif",
          "vFN = normal;"
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float rjNight; varying vec3 vFP; varying vec3 vFN; varying float vSeed;\nfloat fcH(vec2 p){ p = mod(p, 619.0); return fract(sin(dot(p, vec2(41.7, 289.3))) * 23758.5453); }")
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "vec3 fan = abs(normalize(vFN)); float rjWin = 0.0; vec2 rjCell = vec2(0.0);",
          "if (fan.y > 0.7) { diffuseColor.rgb *= 0.62 + 0.12 * fcH(floor(vFP.xz * 0.25) + vSeed); }",
          "else {",
          "  float fu = fan.x > fan.z ? vFP.z : vFP.x;",
          `  vec2 fc = vec2(fu / ${o.wx.toFixed(2)}, vFP.y / ${o.wy.toFixed(2)}); rjCell = floor(fc); vec2 ff = fract(fc);`,
          `  rjWin = step(abs(ff.x - 0.5), ${(o.ww / 2).toFixed(3)}) * step(abs(ff.y - 0.55), ${(o.wh / 2).toFixed(3)}) * step(0.6, vFP.y);`,
          "  float fw = length(fwidth(vFP)); rjWin *= 1.0 - smoothstep(1.2, 4.0, fw);",
          `  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${o.glass || "0.09, 0.11, 0.13"}), rjWin * 0.85);`,
          `  diffuseColor.rgb *= 1.0 - ${(o.streak || 0).toFixed(2)} * smoothstep(0.55, 1.0, fcH(vec2(floor(fu * 0.8), 7.0))) * (0.5 + 0.5 * fract(vFP.y * 0.07 + fcH(vec2(floor(fu * 0.8), 3.0))));`,
          "}"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, rjWin);")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * rjWin * step(${o.lit == null ? "0.55" : o.lit.toFixed(2)}, fcH(rjCell + vSeed * 31.0)) * rjNight * 1.6;`);
    };
    m.customProgramCacheKey = () => key;
    return m;
  }
  SF.facade = facade;
  const std = (c, r = 0.8, mt = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c, fog: true });

  /* ======================= geometry helpers ======================= */
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  function at(list, geo, x, y, z, ry = 0, rx = 0, rz = 0) { _m4.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z); geo.applyMatrix4(_m4); list.push(geo); return geo; }
  function mesh(grp, list, mat, cast = true) {
    if (!list.length) return null;
    const m = new THREE.Mesh(U().merge(list), mat); m.castShadow = cast; m.receiveShadow = true; grp.add(m); return m;
  }
  function signTex(lines, w, h, bg, fg) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const L of lines) { g.fillStyle = L.c || fg; g.font = L.f; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(L.t, w / 2, L.y * h); }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  /** Lowest ground under a rotated footprint (so buildings never float on slopes). */
  function footMin(x, z, w, d, ry) {
    let lo = Infinity; const c = Math.cos(ry), s = Math.sin(ry);
    for (const [a, b] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) { const u = a * w, v = b * d; lo = Math.min(lo, G(x + u * c + v * s, z - u * s + v * c)); }
    return lo;
  }

  /* ======================= suspension bridge ======================= */
  /** A, T1, T2, B: [x, z] anchorage / tower / tower / anchorage. */
  function suspension(grp, o) {
    const [ax, az] = o.A, [bx, bz] = o.B, [t1x, t1z] = o.T1, [t2x, t2z] = o.T2;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const ry = Math.atan2(ux, uz), hw = o.width / 2, dy = o.deck, th = o.towerH;
    const sT1 = (t1x - ax) * ux + (t1z - az) * uz, sT2 = (t2x - ax) * ux + (t2z - az) * uz;
    const P = (s, side, y) => V3(ax + ux * s + px * side, y, az + uz * s + pz * side);
    const ST = [], CO = [], DK = [];
    // deck: stiffening truss (girder) and roadway
    at(ST, box(o.width, 7.6, L), ax + ux * L / 2, dy - 3.8, az + uz * L / 2, ry);
    at(DK, box(o.width - 3, 0.6, L), ax + ux * L / 2, dy + 0.3, az + uz * L / 2, ry);
    for (const sd of [-1, 1]) at(ST, box(0.8, 1.6, L), ax + ux * L / 2 + px * sd * (hw - 0.6), dy + 1.1, az + uz * L / 2 + pz * sd * (hw - 0.6), ry);
    // towers: two tapering legs, art-deco setbacks and portal struts
    for (const s of [sT1, sT2]) {
      for (const sd of [-1, 1]) {
        const c = P(s, sd * (hw + 4), 0);
        const tiers = [[-20, 0.38, 1.0], [0.38, 0.62, 0.86], [0.62, 0.82, 0.74], [0.82, 1.0, 0.62]];
        for (const [a, b, k] of tiers) { const y0 = a < 0 ? a : a * th, y1 = b * th; at(ST, box(10 * k, y1 - y0, 16 * k), c.x, (y0 + y1) / 2, c.z, ry); }
        for (const f of [-1, 1]) at(ST, box(1.4, th * 0.8, 3), c.x + ux * f * 7.6, th * 0.4 + 4, c.z + uz * f * 7.6, ry);   // vertical ribs
        at(CO, box(26, 22, 40), c.x, -10, c.z, ry);                                                                          // pier
      }
      for (const fy of o.struts) { const c = P(s, 0, fy * th); at(ST, box(o.width + 10, fy > 0.95 ? 8 : 12, 6), c.x, c.y, c.z, ry + Math.PI / 2 * 0); }
      const c = P(s, 0, dy - 14); at(ST, box(o.width + 14, 10, 7), c.x, c.y, c.z, ry);
    }
    // anchorages
    for (const s of [0, L]) { const c = P(s, 0, 0); at(CO, box(o.width + 30, dy + 30, 60), c.x, (dy + 30) / 2 - 20, c.z, ry); }
    // main cables: side spans and the main span (parabolic sag), and the vertical suspenders
    const cableY = (s) => {
      if (s <= sT1) { const t = s / sT1; return RJ.lerp(dy + 6, th - 2, t) - 14 * 4 * t * (1 - t); }
      if (s >= sT2) { const t = (s - sT2) / (L - sT2); return RJ.lerp(th - 2, dy + 6, t) - 14 * 4 * t * (1 - t); }
      const t = (s - sT1) / (sT2 - sT1); return th - 2 - (th - 2 - (dy + 4)) * (1 - (2 * t - 1) * (2 * t - 1));
    };
    const cableMat = o.mat;
    for (const sd of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 160; k++) { const s = (k / 160) * L; pts.push(P(s, sd * hw, cableY(s))); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, o.cable, 8, false), cableMat); tube.castShadow = true; grp.add(tube);
    }
    const hang = []; for (let s = 12; s < L - 12; s += 15.2) { if (Math.abs(s - sT1) < 10 || Math.abs(s - sT2) < 10) continue; for (const sd of [-1, 1]) hang.push([P(s, sd * hw, 0), cableY(s) - dy]); }
    const him = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 4), cableMat, hang.length);
    hang.forEach(([p, h], i) => { _m4.compose(_p.set(p.x, dy + h / 2, p.z), _q.identity(), _s.set(1, h, 1)); him.setMatrixAt(i, _m4); });
    grp.add(him);
    mesh(grp, ST, o.mat); mesh(grp, CO, std(0x8f8b84, 0.9)); mesh(grp, DK, std(0x2c2d2f, 0.9), false);
    // sodium deck lamps and red aviation beacons on the tower tops
    const lamps = [];
    for (let s = 20; s < L; s += 50) for (const sd of [-1, 1]) lamps.push(P(s, sd * (hw - 1), dy + 9));
    for (const s of [sT1, sT2]) for (const sd of [-1, 1]) lamps.push(P(s, sd * (hw + 4), th + 2));
    return { lamps, solid: { ax, az, ux, uz, L, hw, dy, th, sT1, sT2 } };
  }

  /* ======================= Alcatraz ======================= */
  function alcatraz(grp, lampPts, solids) {
    const [cx0, cz0] = geo(37.8267, -122.4230);
    // the island's own frame from the real terrain: centroid and long axis (principal component of the land)
    let n = 0, mx = 0, mz = 0; const pts = [];
    for (let i = -70; i <= 70; i++) for (let j = -70; j <= 70; j++) { const x = cx0 + i * 6, z = cz0 + j * 6; if (G(x, z) > 2) { pts.push(x, z); mx += x; mz += z; n++; } }
    mx /= n; mz /= n; let sxx = 0, szz = 0, sxz = 0;
    for (let i = 0; i < pts.length; i += 2) { const a = pts[i] - mx, b = pts[i + 1] - mz; sxx += a * a; szz += b * b; sxz += a * b; }
    let ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
    if (ux + uz < 0) { ux = -ux; uz = -uz; }                     // +u points south-east
    let vx = uz, vz = -ux; if (vx - vz < 0) { vx = -vx; vz = -vz; } // +v points north-east (toward the dock side)
    const W2 = (u, v) => [mx + ux * u + vx * v, mz + uz * u + vz * v];
    const ry = Math.atan2(ux, uz); // local +z along the island axis
    const CONC = [], WALL = [], ROOF = [], RUST = [], GLASS = [], DARK = [], WOOD = [];
    const bldg = (list, u, v, w, d, h, rot = 0, sink = 3) => {
      const [x, z] = W2(u, v), r = ry + rot, lo = footMin(x, z, w, d, r), top = Math.max(lo, G(x, z)) + h;
      at(list, box(w, top - lo + sink, d), x, (top + lo - sink) / 2, z, r); return { x, z, top, lo };
    };
    // the cellhouse: 150 m long, three tiers of tall barred windows, a clerestory and skylights on the roof
    const ch = bldg(WALL, 0, 6, 38, 152, 15);
    { const [x, z] = W2(0, 6); at(ROOF, box(30, 2.2, 140), x, ch.top + 1.1, z, ry); for (let k = -3; k <= 3; k++) { const [sx, sz] = W2(k * 20, 6); at(GLASS, box(5, 1.4, 14), sx, ch.top + 2.6, sz, ry); } }
    solids.push({ x: ch.x, z: ch.z, hw: 22, hd: 80, top: ch.top + 3, ry });
    // administration wing at the south-east end, slightly taller
    const ad = bldg(WALL, 82, 4, 42, 18, 18);
    // the lighthouse (1909, 25 m): square tapering shaft, gallery and lantern
    const [lx, lz] = W2(98, -26), lg = G(lx, lz);
    at(CONC, new THREE.CylinderGeometry(2.6, 3.8, 21, 8), lx, lg + 10.5, lz, ry + Math.PI / 8);
    at(CONC, new THREE.CylinderGeometry(3.6, 3.6, 0.8, 8), lx, lg + 21.4, lz);
    at(GLASS, new THREE.CylinderGeometry(2.2, 2.2, 3.2, 8), lx, lg + 23.4, lz);
    at(DARK, new THREE.ConeGeometry(2.6, 2.2, 8), lx, lg + 26.1, lz);
    at(CONC, box(9, 8, 9), lx + 5 * ux, lg + 3, lz + 5 * uz, ry);                       // keeper's base building
    const beaconPos = V3(lx, lg + 23.4, lz);
    solids.push({ x: lx, z: lz, hw: 4, hd: 4, top: lg + 27, ry });
    // the warden's house: a burned-out shell (three walls, no roof)
    { const [x, z] = W2(112, 22), g = G(x, z); for (const [a, b, w, d] of [[0, -8, 18, 0.7], [0, 8, 18, 0.7], [-9, 0, 0.7, 16]]) { const [px, pz] = [x + ux * b + vx * a, z + uz * b + vz * a]; at(WALL, box(w, 9, d), px, g + 4, pz, ry); } }
    // recreation yard: high concrete walls at the north-west end of the cellhouse, with a guard catwalk
    { const [x, z] = W2(-102, -14), g = G(x, z);
      for (const [a, b, w, d] of [[0, -24, 46, 1], [0, 24, 46, 1], [-23, 0, 1, 48], [23, 0, 1, 48]]) { const [px, pz] = [x + ux * b + vx * a, z + uz * b + vz * a]; at(CONC, box(w, 7, d), px, g + 3, pz, ry); }
      const [kx, kz] = [x + vx * -23 + ux * 24, z + vz * -23 + uz * 24]; at(DARK, box(4, 3, 4), kx, g + 9, kz, ry); }
    // water tower (rusting tank on a steel trestle), north side
    { const [x, z] = W2(-150, 48), g = G(x, z);
      for (const [a, b] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { const [px, pz] = [x + ux * b + vx * a, z + uz * b + vz * a]; at(RUST, new THREE.CylinderGeometry(0.35, 0.45, 26, 5), px, g + 13, pz); }
      for (const y of [8, 17]) { at(RUST, box(9, 0.4, 0.4), x, g + y, z, ry); at(RUST, box(0.4, 0.4, 9), x, g + y, z, ry); }
      at(RUST, new THREE.CylinderGeometry(7, 7, 10, 20), x, g + 31, z); at(RUST, new THREE.ConeGeometry(7.4, 3, 20), x, g + 37.5, z);
      solids.push({ x, z, hw: 8, hd: 8, top: g + 39, ry }); }
    // power house with its smokestack, north end
    { const p = bldg(WALL, -192, 30, 22, 30, 11); const [x, z] = W2(-200, 30); at(CONC, new THREE.CylinderGeometry(1.6, 2.2, 38, 12), x, p.lo + 19, z); solids.push({ x, z, hw: 3, hd: 3, top: p.lo + 38, ry }); }
    // Model Industries (north-west tip) and New Industries (west terrace)
    bldg(WALL, -238, -6, 16, 40, 9); bldg(WALL, -150, -58, 18, 90, 10);
    // Building 64 (barracks) at the dock, with its sign, and the dock itself
    const b64 = bldg(WALL, 172, 52, 24, 62, 15, 0.12);
    const [dkx, dkz] = W2(182, 96); at(WOOD, box(18, 3, 70), dkx, 1.0, dkz, ry + 0.1); at(CONC, box(16, 6, 30), dkx + vx * -6, 0, dkz + vz * -6, ry);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex([{ t: "INDIANS WELCOME", f: "bold 44px Georgia", y: 0.2, c: "#b3261e" }, { t: "UNITED STATES PENITENTIARY", f: "bold 54px Arial", y: 0.62 }, { t: "ALCATRAZ ISLAND", f: "bold 30px Arial", y: 0.88 }], 1024, 256, "#e8e2d4", "#111"), fog: true });
    { const sg = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), signMat); const [x, z] = W2(172, 52 + 12.2); sg.position.set(x, b64.top - 5, z); sg.rotation.y = Math.atan2(vx, vz); grp.add(sg); }
    // guard tower by the dock: four legs, a glazed cab and a catwalk
    { const [x, z] = W2(152, 82), g = G(x, z); for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const [px, pz] = [x + ux * b + vx * a, z + uz * b + vz * a]; at(DARK, box(0.4, 13, 0.4), px, g + 6.5, pz, ry); }
      at(WALL, box(5.5, 3.2, 5.5), x, g + 14.6, z, ry); at(GLASS, box(5.6, 1.4, 5.6), x, g + 15, z, ry); at(DARK, new THREE.ConeGeometry(4.6, 2, 4), x, g + 17.2, z, ry + Math.PI / 4); }
    // switchback road retaining walls and the parade-ground rubble
    for (let k = 0; k < 6; k++) bldg(CONC, 120 - k * 30, 70 - k * 4, 2, 26, 2.5, 0.25);
    for (let k = 0; k < 14; k++) { const [x, z] = W2(185 + RJ.rand(-25, 25), -30 + RJ.rand(-25, 25)); at(CONC, box(RJ.rand(2, 6), RJ.rand(0.6, 2), RJ.rand(2, 6)), x, G(x, z), z, RJ.rand(0, 3)); }
    mesh(grp, WALL, facade({ color: 0xd8d1bf, rough: 0.92, wx: 4.2, wy: 5.2, ww: 0.42, wh: 0.66, streak: 0.28, lit: 0.97 }));
    mesh(grp, CONC, std(0xa8a296, 0.95)); mesh(grp, ROOF, std(0x6d6b66, 0.9)); mesh(grp, RUST, std(0x7d4a2e, 0.75, 0.4));
    mesh(grp, GLASS, std(0x2b3a40, 0.15, 0.6)); mesh(grp, DARK, std(0x2a2a2a, 0.7, 0.3)); mesh(grp, WOOD, std(0x5c4a3a, 0.95));
    lampPts.push(V3(dkx, 6, dkz));
    return { beaconPos, center: V3(mx, 0, mz), ux, uz };
  }

  /* ======================= the city ======================= */
  const PASTEL = [0xf1ece1, 0xe9e3d3, 0xd9dfe6, 0xe8d8cf, 0xd8e3d5, 0xf0e4c2, 0xcfd6dc, 0xe2d2dc, 0xc9c2b2, 0xbfc7cc];
  function city(grp, colGrid) {
    const W = RJ.world, g = W.sfGeo, Z = W.gen.sfZone;
    const lonX = (lon) => Z.x + (lon - g.lon) * g.mE, latZ = (lat) => Z.z - (lat - g.lat) * g.mN;
    const fidi = geo(37.7915, -122.4005), soma = geo(37.7855, -122.3975);
    const LANDMARK = [geo(37.7952, -122.4028), geo(37.7897, -122.3972), geo(37.8024, -122.4058), geo(37.7955, -122.3937)];
    const tiles = new Map(); // 2 km tiles → instance lists, so distant districts can be switched off
    const add = (x, z, w, d, h, ry, col, base) => {
      const k = Math.floor(x / 2000) + "," + Math.floor(z / 2000); let t = tiles.get(k); if (!t) tiles.set(k, (t = { x: (Math.floor(x / 2000) + 0.5) * 2000, z: (Math.floor(z / 2000) + 0.5) * 2000, list: [] }));
      t.list.push(x, base, z, w, h, d, ry, col);
      colGrid.put(x, z, w, d, base + h);
    };
    const r = RJ.world.gen.mulberry32(1906);
    const areas = [
      { lat0: 37.705, lat1: 37.812, lon0: -122.514, lon1: -122.356, bw: 147, bd: 97, rows: 2, segs: 3, test: (lat, lon, h) => {
          const presidio = lat > 37.787 && lon > -122.485 && lon < -122.447, park = lat > 37.764 && lat < 37.774 && lon > -122.511 && lon < -122.453;
          return h > 2 && h < 215 && !presidio && !park; } },
      { lat0: 37.755, lat1: 37.885, lon0: -122.335, lon1: -122.23, bw: 160, bd: 110, rows: 1, segs: 3, test: (lat, lon, h) => h > 2 && h < 85 }
    ];
    for (const A of areas) {
      const x0 = lonX(A.lon0), x1 = lonX(A.lon1), z0 = latZ(A.lat1), z1 = latZ(A.lat0);
      for (let x = x0; x < x1; x += A.bw) for (let z = z0; z < z1; z += A.bd) {
        const lat = g.lat + (Z.z - z) / g.mN, lon = g.lon + (x - Z.x) / g.mE;
        const h0 = G(x, z); if (!A.test(lat, lon, h0)) continue;
        if (LANDMARK.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 140)) continue;
        const df = Math.hypot(x - fidi[0], z - fidi[1]), ds = Math.hypot(x - soma[0], z - soma[1]);
        const core = Math.max(Math.exp(-df / 650), Math.exp(-ds / 750) * 0.6);
        if (core > 0.18) {
          // downtown: towers on the block, tallest at the heart of the Financial District
          const nT = 3 + Math.floor(r() * 3);
          for (let k = 0; k < nT; k++) {
            const tx = x + (r() - 0.5) * A.bw * 0.6, tz = z + (r() - 0.5) * A.bd * 0.6, w = 28 + r() * 22, d = 26 + r() * 20;
            // Jet City scale: a denser, taller downtown, still topped by Salesforce Tower (326 m)
            const h = Math.min(300, 30 + core * (70 + r() * 230) * (r() < 0.3 ? 1.5 : 1.0));
            add(tx, tz, w, d, h, 0, 0x8f989f + Math.floor(r() * 4) * 0x060606, footMinAxis(tx, tz, w, d) - 2);
          }
          continue;
        }
        // neighbourhoods: terraces of row houses along the block faces, broken into segments of varied height
        for (let row = 0; row < A.rows; row++) {
          const zz = z + (A.rows === 1 ? 0 : (row ? 1 : -1) * A.bd * 0.24);
          for (let sgi = 0; sgi < A.segs; sgi++) {
            const L = A.bw / A.segs - 4, xx = x - A.bw / 2 + (sgi + 0.5) * (A.bw / A.segs);
            const hb = G(xx, zz); if (hb < 1.5) continue;
            const h = (A.rows === 1 ? 8 : 9) + r() * 6 + (r() < 0.06 ? 10 + r() * 20 : 0);
            add(xx, zz, L, A.bd * 0.4, h, 0, PASTEL[Math.floor(r() * PASTEL.length)], footMinAxis(xx, zz, L, A.bd * 0.4) - 2);
          }
        }
      }
    }
    const geoBox = new THREE.BoxGeometry(1, 1, 1); geoBox.translate(0, 0.5, 0);
    const mat = facade({ color: 0xffffff, rough: 0.85, wx: 3.4, wy: 3.4, ww: 0.5, wh: 0.55, streak: 0.12 });
    const out = [];
    for (const t of tiles.values()) {
      const L = t.list, nI = L.length / 8, im = new THREE.InstancedMesh(geoBox, mat, nI);
      for (let i = 0; i < nI; i++) {
        const o = i * 8; _m4.compose(_p.set(L[o], L[o + 1], L[o + 2]), _q.setFromAxisAngle(V3(0, 1, 0), L[o + 6]), _s.set(L[o + 3], L[o + 4] + 2, L[o + 5]));
        im.setMatrixAt(i, _m4); im.setColorAt(i, _c.setHex(L[o + 7]));
      }
      im.castShadow = true; im.receiveShadow = true; im.userData.tile = t; grp.add(im); out.push(im);
    }
    return out;
  }
  const footMinAxis = (x, z, w, d) => Math.min(G(x - w / 2, z - d / 2), G(x + w / 2, z - d / 2), G(x - w / 2, z + d / 2), G(x + w / 2, z + d / 2), G(x, z));

  /** Individually modelled skyline landmarks. */
  function skyline(grp, lampPts, colGrid) {
    const WH = [], GL = [], GR = [], RD = [];
    // Transamerica Pyramid (260 m): a slender four-sided spire with its two "wings" and the lit crown
    { const [x, z] = geo(37.7952, -122.4028), g = G(x, z);
      at(WH, new THREE.CylinderGeometry(0.5, 37, 212, 4, 1), x, g + 106, z, Math.PI / 4);
      for (const s of [-1, 1]) at(WH, new THREE.CylinderGeometry(0.4, 9, 150, 4), x + s * 22, g + 120, z, Math.PI / 4);
      at(WH, new THREE.CylinderGeometry(0.2, 4, 50, 4), x, g + 235, z, Math.PI / 4);
      lampPts.push(V3(x, g + 236, z)); colGrid.put(x, z, 54, 54, g + 260); }
    // Salesforce Tower (326 m): rounded obelisk with the open lattice crown
    { const [x, z] = geo(37.7897, -122.3972), g = G(x, z);
      const t = new THREE.CylinderGeometry(25, 30, 300, 24, 1); t.scale(1, 1, 1); at(GL, t, x, g + 150, z);
      at(GL, new THREE.SphereGeometry(25, 24, 8, 0, TAU, 0, Math.PI / 2), x, g + 300, z);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; at(WH, box(1.2, 26, 1.2), x + Math.cos(a) * 25.5, g + 312, z + Math.sin(a) * 25.5); }
      colGrid.put(x, z, 60, 60, g + 326); }
    // Coit Tower on Telegraph Hill (64 m fluted column)
    { const [x, z] = geo(37.8024, -122.4058), g = G(x, z); at(WH, new THREE.CylinderGeometry(5.5, 6, 64, 16), x, g + 32, z); at(WH, box(22, 6, 22), x, g + 3, z); colGrid.put(x, z, 24, 24, g + 64); }
    // Ferry Building: long two-storey hall and its 75 m clock tower on the Embarcadero
    { const [x, z] = geo(37.7955, -122.3937), g = Math.max(2, G(x, z)), ry = 0.62;
      at(WH, box(200, 14, 30), x, g + 7, z, ry); at(WH, box(14, 62, 14), x, g + 31, z, ry); at(RD, new THREE.ConeGeometry(9, 14, 4), x, g + 69, z, ry + Math.PI / 4);
      colGrid.put(x, z, 40, 40, g + 75); lampPts.push(V3(x, g + 52, z)); }
    // Sutro Tower (298 m, red and white) on Mount Sutro
    { const [x, z] = geo(37.7552, -122.4528), g = G(x, z);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU, bx = x + Math.cos(a) * 26, bz = z + Math.sin(a) * 26;
        for (let s = 0; s < 6; s++) { const y0 = (s / 6) * 230, mid = (s + 0.5) / 6, rr = 26 * (1 - mid * 0.8); at(s % 2 ? WH : RD, new THREE.CylinderGeometry(1.4, 1.6, 230 / 6, 6), x + Math.cos(a) * rr, g + y0 + 230 / 12, z + Math.sin(a) * rr, 0, 0, 0); }
        at(RD, new THREE.CylinderGeometry(0.8, 0.8, 70, 5), x + Math.cos(a) * 9, g + 265, z + Math.sin(a) * 9); bx; bz; }
      for (const y of [80, 160, 228]) at(RD, new THREE.CylinderGeometry(26 * (1 - (y / 230) * 0.8) + 2, 26 * (1 - (y / 230) * 0.8) + 2, 2, 3), x, g + y, z);
      lampPts.push(V3(x, g + 300, z)); colGrid.put(x, z, 60, 60, g + 298); }
    mesh(grp, WH, facade({ color: 0xece8de, rough: 0.6, wx: 2.6, wy: 3.6, ww: 0.55, wh: 0.5, streak: 0.05 }));
    mesh(grp, GL, facade({ color: 0xb8c3c8, rough: 0.25, metal: 0.5, wx: 2, wy: 4, ww: 0.85, wh: 0.75, glass: "0.16, 0.2, 0.23", lit: 0.4 }));
    mesh(grp, RD, std(0xb33a2a, 0.6)); mesh(grp, GR, std(0x777777, 0.8));
  }

  /** Coarse height field of everything built (crash detection over the city). */
  function makeColGrid() {
    // covers the built-up area only (west SF to Oakland, Sausalito to Daly City): ~1M cells of 25 m
    const Z = RJ.world.gen.sfZone, X0 = Z.x - 8000, Z0 = Z.z - 9000, C = 25, NX = 1080, NZ = 880;
    const H = new Float32Array(NX * NZ).fill(-Infinity);
    return {
      put(x, z, w, d, top) {
        const i0 = Math.floor((x - w / 2 - X0) / C), i1 = Math.floor((x + w / 2 - X0) / C), j0 = Math.floor((z - d / 2 - Z0) / C), j1 = Math.floor((z + d / 2 - Z0) / C);
        for (let j = Math.max(0, j0); j <= Math.min(NZ - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(NX - 1, i1); i++) if (top > H[j * NX + i]) H[j * NX + i] = top;
      },
      at(x, z) { const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); return i < 0 || j < 0 || i >= NX || j >= NZ ? -Infinity : H[j * NX + i]; }
    };
  }

  /* ======================= build (lazy) ======================= */
  SF.ensure = function () {
    if (SF.ready || !SF.available()) return;
    SF.ready = true;
    const W = RJ.world, grp = new THREE.Group(); grp.name = "sf";
    const lampPts = [], solids = [], colGrid = makeColGrid();
    try {
      const alc = alcatraz(grp, lampPts, solids);
      const gg = suspension(grp, { A: geo(37.8105, -122.4769), T1: geo(37.8158, -122.4779), T2: geo(37.8273, -122.4793), B: geo(37.8326, -122.4800), width: 27.4, deck: 67, towerH: 227, cable: 1.1, struts: [0.5, 0.66, 0.82, 0.97], mat: std(0xc0362c, 0.55, 0.25) });
      const bayMat = std(0x9aa1a6, 0.55, 0.4);
      const bb1 = suspension(grp, { A: geo(37.7874, -122.3870), T1: geo(37.7900, -122.3840), T2: geo(37.7943, -122.3790), B: geo(37.7970, -122.3758), width: 22, deck: 58, towerH: 150, cable: 0.9, struts: [0.55, 0.8, 0.97], mat: bayMat });
      const bb2 = suspension(grp, { A: geo(37.7970, -122.3758), T1: geo(37.7997, -122.3727), T2: geo(37.8040, -122.3677), B: geo(37.8075, -122.3640), width: 22, deck: 58, towerH: 150, cable: 0.9, struts: [0.55, 0.8, 0.97], mat: bayMat });
      lampPts.push(...gg.lamps, ...bb1.lamps, ...bb2.lamps);
      SF.bridges = [gg.solid, bb1.solid, bb2.solid];
      skyline(grp, lampPts, colGrid);
      SF.tiles = city(grp, colGrid);
      const lampMat = glow(0x000000);
      const lim = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 6, 4), lampMat, lampPts.length);
      lampPts.forEach((p, i) => { _m4.makeTranslation(p.x, p.y, p.z); lim.setMatrixAt(i, _m4); });
      grp.add(lim);
      // the lighthouse beam: a long soft cone that sweeps at night, and the lamp glow
      const beam = new THREE.Mesh(new THREE.ConeGeometry(28, 900, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.geometry.translate(0, -450, 0); beam.geometry.rotateZ(Math.PI / 2);
      const pivot = new THREE.Group(); pivot.position.copy(alc.beaconPos); pivot.add(beam); beam.layers.set(RJ.LATE); grp.add(pivot);
      Object.assign(SF, { grp, lampMat, beam, pivot, alc, solids, colGrid, t: 0, mistT: 0, hornT: 8 });
      W.scene.add(grp);
    } catch (e) { console.warn("San Francisco failed to build", e); }
  };

  SF.update = function (dt, cam) {
    if (!SF.ready || !SF.grp) return;
    const W = RJ.world, Z = W.gen.sfZone, d = Math.hypot(cam.position.x - Z.x, cam.position.z - Z.z);
    SF.grp.visible = d < 42000;
    if (!SF.grp.visible) return;
    SF.t += dt;
    const nk = RJ.clamp(1 - RJ.smooth(-4, 8, W.sunElev), 0, 1);
    night.value = nk;
    SF.lampMat.color.setRGB(1.6, 0.9, 0.45).multiplyScalar(0.1 + nk * 1.6);
    SF.pivot.rotation.y = SF.t * 0.9;
    SF.beam.material.opacity = 0.03 + nk * 0.22;
    // distant districts switch off (the terrain's own city colouring takes over)
    for (const im of SF.tiles) { const t = im.userData.tile; im.visible = Math.hypot(cam.position.x - t.x, cam.position.z - t.z) < 10000 + cam.position.y * 1.5; }
    // sea mist through the Golden Gate and around the island, low over the water
    if (cam.position.y < 3000 && d < 16000) {
      SF.mistT -= dt;
      while (SF.mistT < 0) {
        SF.mistT += 0.12;
        const pick = Math.random();
        const [bx, bz] = pick < 0.55 ? geo(37.8215 + RJ.rand(-0.012, 0.012), -122.49 + RJ.rand(-0.03, 0.03)) : geo(37.8267 + RJ.rand(-0.01, 0.01), -122.423 + RJ.rand(-0.014, 0.014));
        if (G(bx, bz) > 0) continue;
        RJ.fx.smokeP.spawn(bx, 8 + Math.random() * 50, bz, 4 + Math.random() * 3, 0.4, RJ.rand(-1, 1), 30 + Math.random() * 20, 120, 360, 0.93, 0.95, 0.98, 0.16, 0, 0.05);
      }
      // fog horns at the Golden Gate (two-tone diaphone), louder the closer you are
      SF.hornT -= dt;
      if (SF.hornT <= 0) { SF.hornT = 22 + Math.random() * 10; horn(cam); }
    }
  };
  function horn(cam) {
    const AU = RJ.audio, ctx = AU && AU.ctx; if (!ctx) return;
    const [x, z] = geo(37.8158, -122.4779), dd = Math.hypot(cam.position.x - x, cam.position.z - z), g = 0.35 / (1 + dd / 1500);
    if (g < 0.01) return;
    [[180, 0], [150, 1.6]].forEach(([f, dl]) => {
      const t = ctx.currentTime + dd / 340 + dl, o = ctx.createOscillator(), gn = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 600;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.25); gn.gain.setValueAtTime(g, t + 1.3); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(lp).connect(gn).connect(AU.envBus || AU.sfxBus); o.start(t); o.stop(t + 1.9);
    });
  }

  /* ======================= collision ======================= */
  SF.heightAt = function (x, z) { return SF.ready && SF.colGrid ? SF.colGrid.at(x, z) : -Infinity; };
  SF.solidAt = function (p) {
    if (!SF.ready || !SF.bridges) return false;
    for (const b of SF.bridges) {
      const dx = p.x - b.ax, dz = p.z - b.az, s = dx * b.ux + dz * b.uz, q = -dx * b.uz + dz * b.ux;
      if (s < -40 || s > b.L + 40 || Math.abs(q) > b.hw + 30) continue;
      if (Math.abs(q) < b.hw && p.y > b.dy - 8 && p.y < b.dy + 1) return true;                       // deck
      for (const st of [b.sT1, b.sT2]) if (Math.abs(s - st) < 9 && Math.abs(q) < b.hw + 10 && p.y < b.th + 2 && (Math.abs(Math.abs(q) - (b.hw + 4)) < 7 || p.y > b.th * 0.95)) return true;
    }
    for (const o of SF.solids) {
      const dx = p.x - o.x, dz = p.z - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry);
      if (Math.abs(dx * c - dz * s) < o.hw && Math.abs(dx * s + dz * c) < o.hd && p.y < o.top) return true;
    }
    return false;
  };

  /* ======================= atlas + spawn ======================= */
  SF.register = function (add) {
    if (!SF.available()) return;
    const [ax, az] = geo(37.8267, -122.4230), [gx, gz] = geo(37.8199, -122.4786), [cx, cz] = geo(37.7915, -122.4005);
    add("alcatraz", { group: null, cx: ax, cz: az, marker: V3(ax, 180, az), heightAt: SF.heightAt, solidAt: SF.solidAt,
      update: (dt, cam) => { const Z = RJ.world.gen.sfZone; if (!SF.ready) { if (Math.hypot(cam.position.x - Z.x, cam.position.z - Z.z) < 45000) SF.ensure(); else return; } SF.update(dt, cam); } });
    add("goldengate", { group: null, cx: gx, cz: gz, marker: V3(gx, 320, gz) });
    add("sanfrancisco", { group: null, cx, cz, marker: V3(cx, 500, cz) });
  };
  /** Free Flight start: low over the bay east of Alcatraz, heading for the Golden Gate. */
  /** San Francisco Bay Run: under the Golden Gate, along the Marina, round Alcatraz, over Telegraph Hill, between
   *  the Transamerica Pyramid and Salesforce Tower, then under the Bay Bridge's western span. */
  SF.route = function () {
    if (!SF.available()) return null;
    SF.ensure();
    const G = [[37.8199, -122.4783, 35], [37.8090, -122.4500, 60], [37.8070, -122.4300, 70], [37.8240, -122.4230, 90], [37.8060, -122.4100, 220],
      [37.7975, -122.4020, 200], [37.7925, -122.3985, 345], [37.7890, -122.3925, 160], [37.79215, -122.3815, 28]];
    return G.map(([la, lo, y], i) => { const [x, z] = geo(la, lo); const v = RJ.V3(x, y, z); v.keep = true; v.tight = i === 0 || i === G.length - 1; return v; });
  };
  SF.spawn = function () {
    if (!SF.available()) return null;
    if (RJ.atlas && RJ.atlas.built) SF.ensure();
    const [x, z] = geo(37.8290, -122.3880), [tx, tz] = geo(37.8230, -122.4780);
    return { x, z, yaw: Math.atan2(-(tx - x), -(tz - z)), alt: 260 };
  };
})(window.RJ);
