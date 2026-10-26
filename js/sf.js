/* Ridgeline Jets — San Francisco Bay: the city, Alcatraz, the Golden Gate and Bay Bridges.
 * The bay itself is real terrain (js/dem-sf.js: USGS/NOAA topography and bathymetry, so the coastline, the Golden
 * Gate strait, Angel Island, Treasure Island and Alcatraz are their true shapes and sizes). This file builds the
 * structures on it at 1:1 scale from real coordinates, lazily once the camera comes within 45 km:
 *  · Alcatraz: cellhouse, lighthouse (sweeping beam at night), water tower, power house and stack, Building 64 with
 *    its painted sign, the dock, guard tower, recreation-yard walls, industries buildings and ruins.
 *  · Golden Gate Bridge in International Orange (towers 227 m with portal struts, cable saddles and floodlights, open
 *    Warren-truss deck, main cables and suspenders, approach viaducts, Fort Point under the south end); the Bay
 *    Bridge west spans (X-braced silver towers, cable lights, the twinkling "Bay Lights" suspenders) and the east
 *    span (self-anchored suspension tower and the Skyway to Oakland).
 *  · The city on the real street-grid area: pastel Victorian/Edwardian row houses with bay windows, garages and
 *    cornices on the hills, mid-rise around downtown, a Financial District of setback / glass / granite towers
 *    (Market Street cut through them), the Transamerica Pyramid, Salesforce Tower (lit crown), 555 California,
 *    Embarcadero Center, 101 California, Millennium Tower, 181 Fremont, One Rincon Hill; Coit Tower, the Ferry
 *    Building, the Embarcadero finger piers and Pier 39, Lombard Street's switchbacks, the Painted Ladies on
 *    Alamo Square, the Palace of Fine Arts and Sutro Tower. Districts sit in 2 km tiles that hide with distance.
 *  · Night: lit windows, sodium deck lamps, white cable lights, floodlit landmarks, blinking aviation lights.
 *  · Sea mist drifting through the Gate and around the island, and fog horns. */
(function (RJ) {
  "use strict";
  const SF = (RJ.sf = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const U = () => RJ.castle.util;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _e = new THREE.Euler(), _c = new THREE.Color();
  const QL = () => { const q = { low: 0, medium: 1, high: 2, ultra: 3 }[RJ.settings && RJ.settings.quality]; return q == null ? 2 : q; };
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
  const night = { value: 0 }, uTime = { value: 0 };
  SF.night = night;
  const WETU = () => (RJ.cityKit ? RJ.cityKit.WET : { value: 0 });
  const HASH = "float fcH(vec2 p){ p = mod(p, 619.0); return fract(sin(dot(p, vec2(41.7, 289.3))) * 23758.5453); }";
  const VSH = (sh, extra) => sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vFP; varying vec3 vFN; varying float vSeed; varying float vH;")
    .replace("#include <begin_vertex>", [
      "#include <begin_vertex>",
      "#ifdef USE_INSTANCING",
      "  vec3 rjSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vFP = position * rjSc; vH = rjSc.y; vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;",
      "#else",
      "  vFP = position; vH = 10.0; vSeed = 0.0;",
      "#endif",
      "vFN = normal;" + (extra || "")
    ].join("\n"));
  /** Facades in object space (instance scale aware): window grid, lit windows at night, rooftops, weathering. */
  function facade(o) {
    const m = new THREE.MeshStandardMaterial({ color: o.color || 0xffffff, roughness: o.rough || 0.8, metalness: o.metal || 0, vertexColors: !!o.vcol });
    const key = "rjFacade" + [o.wx, o.wy, o.ww, o.wh, o.streak, o.lit, o.glass, o.vcol].join("_");
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = night; sh.uniforms.rjWet = WETU();
      sh.vertexShader = VSH(sh);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float rjNight; uniform float rjWet; varying vec3 vFP; varying vec3 vFN; varying float vSeed; varying float vH;\n" + HASH)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "vec3 fan = abs(normalize(vFN)); float rjWin = 0.0, rjFar = 0.0; vec2 rjCell = vec2(0.0);",
          "if (fan.y > 0.7) { diffuseColor.rgb *= 0.62 + 0.12 * fcH(floor(vFP.xz * 0.25) + vSeed); }",
          "else {",
          "  float fu = fan.x > fan.z ? vFP.z : vFP.x;",
          `  vec2 fc = vec2(fu / ${o.wx.toFixed(2)}, vFP.y / ${o.wy.toFixed(2)}); rjCell = floor(fc); vec2 ff = fract(fc);`,
          `  rjWin = step(abs(ff.x - 0.5), ${(o.ww / 2).toFixed(3)}) * step(abs(ff.y - 0.55), ${(o.wh / 2).toFixed(3)}) * step(0.6, vFP.y);`,
          "  float fw = length(fwidth(vFP)); rjFar = smoothstep(1.2, 4.0, fw); rjWin *= 1.0 - rjFar;",
          // painted trim around each window, blinds and curtains in some, reveals that catch the sun
          `  float rjTrim = step(abs(ff.x - 0.5), ${(o.ww / 2 + 0.06).toFixed(3)}) * step(abs(ff.y - 0.55), ${(o.wh / 2 + 0.05).toFixed(3)}) * step(0.6, vFP.y) * (1.0 - rjWin) * (1.0 - smoothstep(0.6, 2.0, fw));`,
          `  diffuseColor.rgb = mix(diffuseColor.rgb, ${o.glass ? "diffuseColor.rgb * 0.7" : "vec3(0.92, 0.91, 0.87)"}, rjTrim * 0.8);`,
          "  float rjB = fcH(rjCell * 1.37 + vSeed * 17.0);",
          `  vec3 rjGl = vec3(${o.glass || "0.09, 0.11, 0.13"}); if (rjB < 0.22) rjGl = mix(rjGl, vec3(0.42, 0.38, 0.3), 0.5); else if (rjB > 0.9) rjGl = mix(rjGl, vec3(0.5, 0.5, 0.48), 0.35);`,
          "  diffuseColor.rgb = mix(diffuseColor.rgb, rjGl, rjWin * 0.85);",
          // far away the window grid averages out into a darker, glassier tone instead of vanishing
          `  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, rjGl, ${(o.ww * o.wh * 0.85).toFixed(3)}), rjFar);`,
          "  diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 6.0, vFP.y));",
          `  diffuseColor.rgb *= 1.0 - ${(o.streak || 0).toFixed(2)} * smoothstep(0.55, 1.0, fcH(vec2(floor(fu * 0.8), 7.0))) * (0.5 + 0.5 * fract(vFP.y * 0.07 + fcH(vec2(floor(fu * 0.8), 3.0))));`,
          "}"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, rjWin) * (1.0 - 0.45 * rjWet); diffuseColor.rgb *= 1.0 - 0.15 * rjWet * (1.0 - rjWin);")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n{ float rjLit = ${o.lit == null ? "0.55" : o.lit.toFixed(2)}; totalEmissiveRadiance += mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.9, 1.0), step(0.8, fcH(rjCell * 0.7 + 3.0))) * ((0.8 + 0.4 * fcH(rjCell + 9.0)) * rjWin * step(rjLit, fcH(rjCell + vSeed * 31.0)) + rjFar * step(0.6, vFP.y) * ${(o.ww * o.wh).toFixed(3)} * (1.0 - rjLit) * 0.9) * rjNight * 1.6; }`);
    };
    m.customProgramCacheKey = () => key;
    return m;
  }
  SF.facade = facade;
  /** Row houses (instanced boxes, long axis along x): each 7.6 m lot is its own pastel house with a three-sash bay
   *  window, a side window, a garage or a front door at street level, floor bands and a white cornice. */
  function rowFacade() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = night; sh.uniforms.rjWet = WETU();
      sh.vertexShader = VSH(sh);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", [
        "#include <common>",
        "uniform float rjNight; uniform float rjWet; varying vec3 vFP; varying vec3 vFN; varying float vSeed; varying float vH;", HASH,
        "vec3 rjPal(float h) {",
        "  if (h < 0.10) return vec3(0.95, 0.91, 0.80); if (h < 0.19) return vec3(0.96, 0.86, 0.58); if (h < 0.28) return vec3(0.64, 0.78, 0.89);",
        "  if (h < 0.36) return vec3(0.70, 0.85, 0.72); if (h < 0.44) return vec3(0.94, 0.74, 0.76); if (h < 0.51) return vec3(0.78, 0.72, 0.88);",
        "  if (h < 0.59) return vec3(0.97, 0.78, 0.61); if (h < 0.66) return vec3(0.69, 0.75, 0.59); if (h < 0.79) return vec3(0.96, 0.96, 0.94);",
        "  if (h < 0.86) return vec3(0.52, 0.62, 0.74); if (h < 0.92) return vec3(0.83, 0.57, 0.47); return vec3(0.80, 0.80, 0.78); }"
      ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "vec3 fan = abs(normalize(vFN)); float rjWin = 0.0, rjD = 1.0; vec2 rjCell = vec2(0.0);",
          "float fw = length(fwidth(vFP)); rjD = 1.0 - smoothstep(0.7, 2.6, fw);",
          "if (fan.y > 0.7) { diffuseColor.rgb = vec3(0.47, 0.46, 0.45) * (0.75 + 0.35 * fcH(floor(vFP.xz * 0.14) + vSeed)); }",
          "else {",
          "  float fu = (fan.x > fan.z ? vFP.z : vFP.x) + vSeed * 53.0;",
          "  float hi = floor(fu / 7.6), u = fract(fu / 7.6), hh = fcH(vec2(hi, 3.0 + vSeed));",
          "  vec3 col = mix(rjPal(hh), diffuseColor.rgb, 0.22);",
          "  float y = vFP.y, fl = floor(y / 3.3), fy = fract(y / 3.3), up = step(1.0, fl);",
          "  vec3 trim = fcH(vec2(hi, 9.0)) < 0.3 ? col * 0.55 : vec3(0.94, 0.93, 0.89);",
          "  float top = step(vH - 1.1, y), dent = step(vH - 1.6, y) * (1.0 - top);",
          "  float bay = step(0.07, u) * step(u, 0.6), pane = abs(fract((u - 0.07) / 0.1767) - 0.5);",
          "  float bayE = step(abs(u - 0.07), 0.018) + step(abs(u - 0.6), 0.018);",
          "  float wh = bay > 0.5 ? step(pane, 0.3) : step(abs(u - 0.79), 0.07);",
          "  float win = up * step(y, vH - 1.8) * step(abs(fy - 0.52), 0.28) * wh;",
          "  float frame = up * step(y, vH - 1.8) * step(abs(fy - 0.52), 0.33) * (bay > 0.5 ? step(pane, 0.38) : step(abs(u - 0.79), 0.1)) * (1.0 - win);",
          "  float gar = (1.0 - up) * step(0.35, fcH(vec2(hi, 5.0))) * step(0.12, u) * step(u, 0.55) * step(y, 2.5);",
          "  float door = (1.0 - up) * step(abs(u - 0.79), 0.06) * step(y, 2.4);",
          "  float gwin = (1.0 - up) * (1.0 - gar) * bay * step(pane, 0.3) * step(abs(fy - 0.58), 0.22);",
          "  rjWin = max(win, gwin); rjCell = vec2(hi * 5.0 + floor(u * 5.0), fl);",
          "  col *= 1.0 - 0.22 * bayE;",
          "  col = mix(col, trim, min(1.0, top + frame * 0.8 + up * step(fy, 0.04) * 0.6) * rjD);",
          "  col = mix(col, trim * 0.72, dent * rjD);",
          "  col = mix(col, vec3(0.86, 0.86, 0.84), gar * rjD);",
          "  col = mix(col, vec3(0.3, 0.2, 0.14), door * rjD);",
          "  col *= mix(1.0, 0.6, step(u, 0.012) * rjD);",
          "  vec3 gl = vec3(0.1, 0.12, 0.14); float rb = fcH(rjCell * 1.37 + vSeed * 17.0); if (rb < 0.25) gl = vec3(0.42, 0.38, 0.32);",
          "  col = mix(col, gl, rjWin * 0.85 * rjD);",
          "  col *= mix(0.84, 1.0, rjD) * mix(0.8, 1.0, smoothstep(0.0, 4.0, y));",
          "  diffuseColor.rgb = col;",
          "}"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, rjWin * rjD) * (1.0 - 0.45 * rjWet); diffuseColor.rgb *= 1.0 - 0.15 * rjWet * (1.0 - rjWin);")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nif (fan.y <= 0.7) totalEmissiveRadiance += vec3(1.0, 0.76, 0.46) * mix(0.1 * step(3.3, vFP.y), rjWin * step(0.5, fcH(rjCell + vSeed * 31.0)) * (0.8 + 0.4 * fcH(rjCell + 9.0)), rjD) * rjNight * 1.5;");
    };
    m.customProgramCacheKey = () => "rjRowFacade";
    return m;
  }
  const std = (c, r = 0.8, mt = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c, fog: true });
  /** Floodlit materials: their emissive follows the night (see SF.update). */
  const FLOOD = [];
  function flood(c, e, k, r = 0.7, mt = 0, vcol = false) {
    const m = std(c, r, mt); m.vertexColors = vcol; m.userData.e = new THREE.Color(e); m.userData.k = k; m.emissive = new THREE.Color(0); FLOOD.push(m); return m;
  }
  /** Suspenders that twinkle in slow waves at night (the Bay Bridge's "Bay Lights"). */
  function sparkle(c) {
    const m = std(c, 0.5, 0.4);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = night; sh.uniforms.rjTime = uTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vIP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_INSTANCING\nvIP = instanceMatrix[3].xyz + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0);\n#else\nvIP = position;\n#endif");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float rjNight; uniform float rjTime; varying vec3 vIP;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float a = vIP.x * 0.031 + vIP.z * 0.027; float w = 0.5 + 0.5 * sin(a * 3.0 - rjTime * 1.3) * sin(vIP.y * 0.09 + rjTime * 0.7 + a); float sp = step(0.97, fract(sin(dot(floor(vIP * 0.25).xz + floor(vIP.y * 0.25) + floor(rjTime * 5.0), vec2(12.99, 78.23))) * 43758.5)); totalEmissiveRadiance += vec3(0.85, 0.9, 1.0) * rjNight * (pow(w, 3.0) * 1.8 + sp * 2.5 + 0.06); }");
    };
    m.customProgramCacheKey = () => "rjSparkle";
    return m;
  }
  /** Roadway texture: asphalt, dashed lane lines, kerbs. */
  const roadCanvas = {};
  function roadMat(lanes, L) {
    let c = roadCanvas[lanes];
    if (!c) {
      c = roadCanvas[lanes] = document.createElement("canvas"); c.width = 128; c.height = 256; const g = c.getContext("2d");
      g.fillStyle = "#3a3b3d"; g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "20,20,22" : "90,90,92"},0.25)`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
      g.fillStyle = "#9a978f"; g.fillRect(0, 0, 8, 256); g.fillRect(120, 0, 8, 256);
      const lw = (128 - 16) / lanes;
      for (let k = 1; k < lanes; k++) {
        const x = 8 + k * lw;
        if (k === lanes / 2) { g.fillStyle = "#d8b13a"; g.fillRect(x - 2, 0, 4, 256); } else { g.fillStyle = "#e8e6df"; for (let y = 0; y < 256; y += 64) g.fillRect(x - 1, y, 2, 30); }
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, L / 40); t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  }

  /* ======================= geometry helpers ======================= */
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n);
  function at(list, geo, x, y, z, ry = 0, rx = 0, rz = 0) { _m4.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z); geo.applyMatrix4(_m4); list.push(geo); return geo; }
  /** Vertex colour on a geometry (for merged multi-colour meshes). */
  function tint(geo, hex) {
    _c.setHex(hex); const n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); return geo;
  }
  function mesh(grp, list, mat, cast = true) {
    if (!list.length) return null;
    const m = new THREE.Mesh(U().merge(list), mat); m.castShadow = cast; m.receiveShadow = true; grp.add(m); return m;
  }
  /** three r128 culls an InstancedMesh by its geometry's sphere at the mesh origin: give each one its real bounds. */
  function bound(im, pad = 20) {
    const b = new THREE.Box3(); for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, _m4); b.expandByPoint(_p.setFromMatrixPosition(_m4)); }
    const g = im.geometry.clone(); g.boundingSphere = b.getBoundingSphere(new THREE.Sphere()); g.boundingSphere.radius += pad; im.geometry = g; return im;
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
  const footMinAxis = (x, z, w, d) => Math.min(G(x - w / 2, z - d / 2), G(x + w / 2, z - d / 2), G(x - w / 2, z + d / 2), G(x + w / 2, z + d / 2), G(x, z));

  /* ======================= suspension bridge ======================= */
  /** A, T1, T2, B: [x, z] anchorage / tower / tower / anchorage. L3: { warm, white, red } lamp point lists. */
  function suspension(grp, o, L3) {
    const [ax, az] = o.A, [bx, bz] = o.B, [t1x, t1z] = o.T1, [t2x, t2z] = o.T2;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const ry = Math.atan2(ux, uz), hw = o.width / 2, dy = o.deck, th = o.towerH, gd = o.girder || 7.6, Q = QL();
    const sT1 = (t1x - ax) * ux + (t1z - az) * uz, sT2 = (t2x - ax) * ux + (t2z - az) * uz;
    const P = (s, side, y) => V3(ax + ux * s + px * side, y, az + uz * s + pz * side);
    const ST = [], TW = [], CO = [], DK = [], mx = ax + ux * L / 2, mz = az + uz * L / 2;
    // stiffening truss: a dark recessed core between two open Warren-truss faces with heavy chords
    at(DK, box(o.width - 2.6, gd - 1.4, L), mx, dy - gd / 2, mz, ry);
    for (const sd of [-1, 1]) {
      const qx = px * sd * (hw - 0.5), qz = pz * sd * (hw - 0.5);
      at(ST, box(1.1, 1.1, L), mx + qx, dy - 0.55, mz + qz, ry);
      at(ST, box(1.1, 1.1, L), mx + qx, dy - gd + 0.55, mz + qz, ry);
      at(ST, box(0.4, 1.3, L), mx + px * sd * (hw - 0.2), dy + 1.0, mz + pz * sd * (hw - 0.2), ry);    // railing
    }
    const road = new THREE.Mesh(new THREE.PlaneGeometry(o.width - 2.4, L).rotateX(-Math.PI / 2).rotateY(ry).translate(mx, dy + 0.06, mz), roadMat(o.lanes || 6, L));
    road.receiveShadow = true; grp.add(road);
    if (o.lower) at(DK, box(o.width - 3, 0.5, L), mx, dy - gd + 1.2, mz, ry);                                 // the lower deck (Bay Bridge)
    // truss members: diagonals every panel (and verticals on high quality)
    const tr = [], n = Math.floor(L / gd);
    for (let k = 0; k < n; k++) for (const sd of [-1, 1]) {
      tr.push([P((k + 0.5) * gd, sd * (hw - 0.5), dy - gd / 2), (k % 2 ? 1 : -1) * Math.PI / 4, Math.SQRT2 * (gd - 1.1)]);
      if (Q >= 2) tr.push([P(k * gd, sd * (hw - 0.5), dy - gd / 2), 0, gd - 1.1]);
    }
    if (Q >= 1) {
      const tim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 0.5), o.mat, tr.length), axP = V3(px, 0, pz);
      tr.forEach(([c, a, len], i) => { _m4.compose(c, _q.setFromAxisAngle(axP, a), _s.set(1, len, 1)); tim.setMatrixAt(i, _m4); });
      tim.castShadow = true; grp.add(bound(tim, 30));
    }
    // towers: two tapering legs with art-deco setbacks, fluting ribs, portal struts, cable saddles
    const tm = o.towerMat || o.mat, legW = o.legW || 10, legD = o.legD || 16;
    for (const s of [sT1, sT2]) {
      for (const sd of [-1, 1]) {
        const c = P(s, sd * (hw + 4), 0);
        const tiers = [[-20, 0.38, 1.0], [0.38, 0.62, 0.86], [0.62, 0.82, 0.74], [0.82, 1.0, 0.62]];
        for (const [a, b, k] of tiers) {
          const y0 = a < 0 ? a : a * th, y1 = b * th; at(TW, box(legW * k, y1 - y0, legD * k), c.x, (y0 + y1) / 2, c.z, ry);
          for (const f of [-1, 1]) {
            at(TW, box(1.2, y1 - Math.max(0, y0) - 2, 2.6 * k), c.x + ux * f * legD * k * 0.3, (Math.max(0, y0) + y1) / 2, c.z + uz * f * legD * k * 0.3, ry);       // ribs on the outer face
            at(TW, box(legW * k + 1.2, y1 - Math.max(0, y0) - 2, 1.4), c.x + ux * f * legD * k * 0.5, (Math.max(0, y0) + y1) / 2, c.z + uz * f * legD * k * 0.5, ry); // corner fins along the bridge
          }
          if (a >= 0) at(TW, box(legW * k + 1.6, 2.2, legD * k + 1.6), c.x, y0 + 1.1, c.z, ry);   // setback ledge
        }
        at(TW, box(legW * 0.7, 6, legD * 0.9), c.x, th + 3, c.z, ry);                                        // cable saddle housing
        at(CO, box(legW * 2.6, 22, legD * 2.5), c.x, -10, c.z, ry);                                           // pier
        L3.red.push(V3(c.x, th + 7, c.z));
      }
      for (const fy of o.struts) { const c = P(s, 0, fy * th); at(TW, box(o.width + 10, fy > 0.95 ? 9 : 12, 6.5), c.x, c.y, c.z, ry); }
      const c = P(s, 0, dy - gd - 6); at(TW, box(o.width + 14, 10, 7), c.x, c.y, c.z, ry);
      // X-bracing between the legs (the Bay Bridge's look) from the water to the top strut
      if (o.xb) {
        const lv = [6, dy - gd - 6, ...o.struts.map((f) => f * th)], W2 = 2 * (hw + 4);
        for (let k = 0; k < lv.length - 1; k++) {
          const y0 = lv[k], y1 = lv[k + 1], len = Math.hypot(W2, y1 - y0), ang = Math.atan2(W2, y1 - y0), cc = P(s, 0, (y0 + y1) / 2);
          if (y1 - y0 < 8) continue;
          for (const sg of [-1, 1]) at(TW, box(2, len, 2.4), cc.x, cc.y, cc.z, ry, 0, sg * ang);
        }
      }
    }
    // anchorages
    for (const s of [0, L]) { const c = P(s, 0, 0), g = Math.max(-20, Math.min(G(c.x, c.z), dy - 10)); at(CO, box(o.width + 30, dy + 30 - g, 60), c.x, (dy + 30 + g) / 2 - 20, c.z, ry); }
    // main cables: side spans and the main span (parabolic sag), and the vertical suspenders
    const cableY = (s) => {
      if (s <= sT1) { const t = s / sT1; return RJ.lerp(dy + 6, th - 2, t) - 14 * 4 * t * (1 - t); }
      if (s >= sT2) { const t = (s - sT2) / (L - sT2); return RJ.lerp(th - 2, dy + 6, t) - 14 * 4 * t * (1 - t); }
      const t = (s - sT1) / (sT2 - sT1); return th - 2 - (th - 2 - (dy + 4)) * (1 - (2 * t - 1) * (2 * t - 1));
    };
    for (const sd of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 160; k++) { const s = (k / 160) * L; pts.push(P(s, sd * hw, cableY(s))); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Q >= 1 ? 320 : 160, o.cable, Q >= 1 ? 8 : 5, false), o.mat); tube.castShadow = true; grp.add(tube);
      if (o.cableLights) for (let s = 10; s < L - 5; s += 24) L3.white.push(P(s, sd * hw, cableY(s) + o.cable + 0.6));
    }
    const hang = []; for (let s = 12; s < L - 12; s += 15.2) { if (Math.abs(s - sT1) < 10 || Math.abs(s - sT2) < 10) continue; for (const sd of [-1, 1]) hang.push([P(s, sd * hw, 0), cableY(s) - dy]); }
    const him = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 4), o.bayLights && Q >= 1 ? sparkle(0xa3aab0) : o.mat, hang.length);
    hang.forEach(([p, h], i) => { _m4.compose(_p.set(p.x, dy + h / 2, p.z), _q.identity(), _s.set(1, h, 1)); him.setMatrixAt(i, _m4); });
    grp.add(bound(him, 150));
    mesh(grp, ST, o.mat); mesh(grp, TW, tm); mesh(grp, CO, std(0x8f8b84, 0.9)); mesh(grp, DK, std(o.dark || 0x3a2320, 0.9), false);
    // sodium deck lamps
    for (let s = 20; s < L; s += 50) for (const sd of [-1, 1]) L3.warm.push(P(s, sd * (hw - 1), dy + 9));
    return { solid: { ax, az, ux, uz, L, hw, dy, th, sT1, sT2 }, ux, uz, px, pz, L, A: o.A, B: o.B, dy, gd };
  }
  /** Approach viaduct from an end of a bridge, outward along (ux, uz) until the ground meets the deck. */
  function approach(grp, x0, z0, ux, uz, dy, width, maxLen, mat, pierMat, L3) {
    const D = [], PI = [], ry = Math.atan2(ux, uz); let s = 0;
    for (; s < maxLen; s += 30) {
      const x = x0 + ux * (s + 15), z = z0 + uz * (s + 15), g = G(x, z);
      if (g > dy - 3) break;
      at(D, box(width, 5, 30.5), x, dy - 2.5, z, ry);
      if (s % 60 === 0 && g < dy - 8) for (const sd of [-1, 1]) at(PI, box(3.2, dy - 5 - g + 6, 3.2), x - uz * sd * width * 0.32, (dy - 5 + g - 6) / 2, z + ux * sd * width * 0.32, ry);
      if (s % 60 === 0) L3.warm.push(V3(x, dy + 9, z));
    }
    if (D.length) {
      const L = s, mxx = x0 + ux * L / 2, mzz = z0 + uz * L / 2;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(width - 2, L).rotateX(-Math.PI / 2).rotateY(ry).translate(mxx, dy + 0.06, mzz), roadMat(6, L)); road.receiveShadow = true; grp.add(road);
    }
    mesh(grp, D, mat); mesh(grp, PI, pierMat);
    return s;
  }

  /* ======================= Bay Bridge east span ======================= */
  /** Self-anchored suspension span (one 160 m four-legged tower, a single looping cable) and the twin-deck Skyway on
   *  concrete piers down to the Oakland touchdown. pts: [lat, lon] from Yerba Buena Island eastward. */
  function eastSpan(grp, L3, solids) {
    const WH = [], CO = [], ST = [];
    const [a0x, a0z] = geo(37.8148, -122.3586), [tx, tz] = geo(37.8158, -122.3546), [e0x, e0z] = geo(37.8171, -122.3500), [e1x, e1z] = geo(37.8233, -122.3195);
    const dirA = [e0x - a0x, e0z - a0z], LA = Math.hypot(...dirA), ux = dirA[0] / LA, uz = dirA[1] / LA, ry = Math.atan2(ux, uz), px = -uz, pz = ux;
    const dyS = 48, deckW = 25, gap = 8;
    // the two SAS decks (box girders) either side of the tower
    for (const sd of [-1, 1]) {
      const ox = px * sd * (deckW / 2 + gap / 2), oz = pz * sd * (deckW / 2 + gap / 2);
      at(WH, box(deckW, 5.5, LA), a0x + ux * LA / 2 + ox, dyS - 2.75, a0z + uz * LA / 2 + oz, ry);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(deckW - 2, LA).rotateX(-Math.PI / 2).rotateY(ry).translate(a0x + ux * LA / 2 + ox, dyS + 0.06, a0z + uz * LA / 2 + oz), roadMat(6, LA)); road.receiveShadow = true; grp.add(road);
      for (let s = 15; s < LA; s += 45) L3.warm.push(V3(a0x + ux * s + ox, dyS + 9, a0z + uz * s + oz));
    }
    // the tower: four tapered legs joined by shear-link struts, 160 m
    const tH = 160;
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const lx = tx + px * a * 4 + ux * b * 3, lz = tz + pz * a * 4 + uz * b * 3;
      at(WH, cyl(1.8, 3.4, tH, 5), lx, tH / 2 - 6, lz, ry);
    }
    for (let y = 20; y < tH - 10; y += 18) at(WH, box(9, 1.2, 1.2), tx, y, tz, ry + Math.PI / 2);
    at(CO, box(30, 16, 20), tx, -6, tz, ry);
    L3.red.push(V3(tx, tH, tz));
    solids.push({ x: tx, z: tz, hw: 8, hd: 8, top: tH, ry });
    // the single main cable: from the west end up over the tower, down to the east end and looping back
    const cab = [];
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40, s = t * LA, sT = (tx - a0x) * ux + (tz - a0z) * uz;
        const y = s < sT ? RJ.lerp(dyS + 2, tH - 4, Math.pow(s / sT, 1.6)) : RJ.lerp(tH - 4, dyS + 2, Math.pow((s - sT) / (LA - sT), 0.6));
        pts.push(V3(a0x + ux * s + px * sd * (deckW + gap / 2 - 1), y, a0z + uz * s + pz * sd * (deckW + gap / 2 - 1)));
        if (k % 2 === 0 && k > 0 && k < 40) cab.push([pts[pts.length - 1], y - dyS]);
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.9, 6, false), std(0xd9dcdc, 0.5, 0.3)); grp.add(tube);
    }
    const him = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 4), std(0xd9dcdc, 0.5, 0.3), cab.length);
    cab.forEach(([p, h], i) => { _m4.compose(_p.set(p.x, dyS + h / 2, p.z), _q.identity(), _s.set(1, h, 1)); him.setMatrixAt(i, _m4); });
    grp.add(bound(him, 100));
    // the Skyway: two parallel concrete box girders descending to the Oakland shore, on paired piers every 160 m
    const dSx = e1x - e0x, dSz = e1z - e0z, LS = Math.hypot(dSx, dSz), sx = dSx / LS, sz = dSz / LS, sry = Math.atan2(sx, sz), qx = -sz, qz = sx;
    const segs = Math.ceil(LS / 80);
    for (let k = 0; k < segs; k++) {
      const s0 = k * 80, s1 = Math.min(LS, s0 + 80), sm = (s0 + s1) / 2, y = RJ.lerp(dyS, 10, Math.pow(sm / LS, 1.3));
      const pitch = Math.atan2(RJ.lerp(dyS, 10, Math.pow(s1 / LS, 1.3)) - RJ.lerp(dyS, 10, Math.pow(s0 / LS, 1.3)), s1 - s0);
      for (const sd of [-1, 1]) {
        const cx = e0x + sx * sm + qx * sd * (deckW / 2 + gap / 2), cz = e0z + sz * sm + qz * sd * (deckW / 2 + gap / 2);
        const g = box(deckW, 5, s1 - s0 + 0.6); g.rotateX(-pitch); at(WH, g, cx, y - 2.5, cz, sry);
        if (k % 2 === 0 && y > 12) at(CO, box(6, y + 20, 5), cx, (y - 5 - 20) / 2, cz, sry);
        if (k % 1 === 0) L3.warm.push(V3(cx, y + 8, cz));
      }
    }
    // a simple roadway on the Skyway: one long dark strip per deck following the descent
    for (const sd of [-1, 1]) {
      const pos = []; const N = 24;
      for (let k = 0; k <= N; k++) { const s = (k / N) * LS, y = RJ.lerp(dyS, 10, Math.pow(s / LS, 1.3)) + 0.08, cx = e0x + sx * s + qx * sd * (deckW / 2 + gap / 2), cz = e0z + sz * s + qz * sd * (deckW / 2 + gap / 2); pos.push(V3(cx - qx * (deckW / 2 - 1), y, cz - qz * (deckW / 2 - 1)), V3(cx + qx * (deckW / 2 - 1), y, cz + qz * (deckW / 2 - 1))); }
      const gg = new THREE.BufferGeometry().setFromPoints(pos), idx = [];
      for (let k = 0; k < N; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      gg.setIndex(idx); gg.computeVertexNormals(); const uv = []; for (let k = 0; k <= N; k++) uv.push(0, (k / N) * LS / 40, 1, (k / N) * LS / 40); gg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      const rm = roadMat(6, 40); rm.map.repeat.set(1, 1); rm.side = THREE.DoubleSide;
      const r = new THREE.Mesh(gg, rm); r.receiveShadow = true; grp.add(r);
    }
    mesh(grp, WH, std(0xd6d8d6, 0.6, 0.15)); mesh(grp, CO, std(0xa9a69f, 0.9)); mesh(grp, ST, std(0x9aa1a6, 0.55, 0.4));
    return { ux, uz, LA, a0x, a0z, dyS, deckW, gap, e0x, e0z, sx, sz, LS };
  }

  /* ======================= Alcatraz ======================= */
  function alcatraz(grp, L3, solids) {
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
    const CONC = [], WALL = [], ROOF = [], RUST = [], GLASS = [], DARK = [], WOOD = [], GREEN = [];
    const bldg = (list, u, v, w, d, h, rot = 0, sink = 3) => {
      const [x, z] = W2(u, v), r = ry + rot, lo = footMin(x, z, w, d, r), top = Math.max(lo, G(x, z)) + h;
      at(list, box(w, top - lo + sink, d), x, (top + lo - sink) / 2, z, r); return { x, z, top, lo };
    };
    // the cellhouse: 150 m long, three tiers of tall barred windows, a clerestory and skylights on the roof
    const ch = bldg(WALL, 0, 6, 38, 152, 15);
    { const [x, z] = W2(0, 6); at(ROOF, box(30, 2.2, 140), x, ch.top + 1.1, z, ry); for (let k = -3; k <= 3; k++) { const [sx, sz] = W2(k * 20, 6); at(GLASS, box(5, 1.4, 14), sx, ch.top + 2.6, sz, ry); }
      // pilasters along the long walls, a darker plinth and the roofline parapet
      for (let k = -7; k <= 7; k++) for (const sd of [-1, 1]) { const [px, pz] = W2(k * 10, 6 + sd * 19.2); at(CONC, box(1.6, ch.top - ch.lo, 0.8), px, (ch.top + ch.lo) / 2, pz, ry); }
      for (const sd of [-1, 1]) { const [px, pz] = W2(0, 6 + sd * 19.3); at(CONC, box(0.8, 1.2, 152), px, ch.top + 0.6, pz, ry); } }
    solids.push({ x: ch.x, z: ch.z, hw: 22, hd: 80, top: ch.top + 3, ry });
    // administration wing at the south-east end, slightly taller
    bldg(WALL, 82, 4, 42, 18, 18);
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
    const rr = RJ.world.gen.mulberry32(1934);
    for (let k = 0; k < 14; k++) { const [x, z] = W2(185 + (rr() - 0.5) * 50, -30 + (rr() - 0.5) * 50); at(CONC, box(2 + rr() * 4, 0.6 + rr() * 1.4, 2 + rr() * 4), x, G(x, z), z, rr() * 3); }
    // the gardens and shrubs that took over the slopes
    for (let k = 0; k < 70; k++) { const [x, z] = W2((rr() - 0.5) * 460, (rr() - 0.5) * 140), g = G(x, z); if (g < 4) continue; const s = 2 + rr() * 3; at(GREEN, tint(new THREE.IcosahedronGeometry(s, 0), rr() < 0.3 ? 0x6f7f3a : 0x3f5a2c), x, g + s * 0.5, z); }
    mesh(grp, WALL, facade({ color: 0xd8d1bf, rough: 0.92, wx: 4.2, wy: 5.2, ww: 0.42, wh: 0.66, streak: 0.28, lit: 0.97 }));
    mesh(grp, CONC, std(0xa8a296, 0.95)); mesh(grp, ROOF, std(0x6d6b66, 0.9)); mesh(grp, RUST, std(0x7d4a2e, 0.75, 0.4));
    mesh(grp, GLASS, std(0x2b3a40, 0.15, 0.6)); mesh(grp, DARK, std(0x2a2a2a, 0.7, 0.3)); mesh(grp, WOOD, std(0x5c4a3a, 0.95));
    if (GREEN.length) { const gm = std(0xffffff, 0.95); gm.vertexColors = true; gm.flatShading = true; mesh(grp, GREEN, gm, false); }
    L3.warm.push(V3(dkx, 6, dkz));
    return { beaconPos, center: V3(mx, 0, mz), ux, uz };
  }

  /* ======================= the city ======================= */
  const STONE = [0xe9e2d0, 0xded3bd, 0xcfc4ae, 0xf2efe6, 0xb9a48c, 0xa86a52, 0xc8c8c4, 0xe3d6c4, 0xd9cdb5];
  const GLASSC = [0x9fb2bf, 0x8ea7b2, 0xb7c3c8, 0x8d9ca8, 0xa9b9b4, 0xc2c9cc];
  const DARKC = [0x4a4442, 0x3c3a3a, 0x5a4a44, 0x40464c];
  /** Marked-out open spaces (no buildings): [lat, lon, radius m]. */
  const OPEN = [[37.7764, -122.4346, 150], [37.7680, -122.4413, 260], [37.7596, -122.4269, 190], [37.8008, -122.4100, 85], [37.7880, -122.4075, 70],
    [37.8029, -122.4484, 230], [37.8024, -122.4058, 130], [37.8021, -122.4185, 90], [37.7911, -122.4130, 60], [37.7790, -122.4180, 110], [37.8060, -122.4320, 160], [37.8000, -122.4255, 80]];
  /** Market Street, Ferry Building → Twin Peaks. */
  const MARKET = [[37.7946, -122.3949], [37.7627, -122.4351]];
  function city(grp, colGrid, excl) {
    const W = RJ.world, g = W.sfGeo, Z = W.gen.sfZone, Q = QL();
    const lonX = (lon) => Z.x + (lon - g.lon) * g.mE, latZ = (lat) => Z.z - (lat - g.lat) * g.mN;
    const fidi = geo(37.7915, -122.4005), soma = geo(37.7870, -122.3960);
    const open = OPEN.map(([la, lo, r]) => { const [x, z] = geo(la, lo); return [x, z, r]; });
    const [m0x, m0z] = geo(...MARKET[0]), [m1x, m1z] = geo(...MARKET[1]), mL = Math.hypot(m1x - m0x, m1z - m0z), mux = (m1x - m0x) / mL, muz = (m1z - m0z) / mL;
    const marketD = (x, z) => { const s = (x - m0x) * mux + (z - m0z) * muz; if (s < -40 || s > mL) return 1e9; return Math.abs(-(x - m0x) * muz + (z - m0z) * mux); };
    const blocked = (x, z, r) => { for (const [ox, oz, orr] of open) if (Math.hypot(ox - x, oz - z) < orr + r) return true; for (const [ox, oz, orr] of excl) if (Math.hypot(ox - x, oz - z) < orr + r) return true; return marketD(x, z) < 22 + r * 0.6; };
    const tiles = new Map(); // 2 km tiles → instance lists per facade kind, so distant districts can be switched off
    const add = (kind, x, z, w, d, h, ry, col, base) => {
      const k = Math.floor(x / 2000) + "," + Math.floor(z / 2000); let t = tiles.get(k); if (!t) tiles.set(k, (t = { x: (Math.floor(x / 2000) + 0.5) * 2000, z: (Math.floor(z / 2000) + 0.5) * 2000, list: [[], [], [], []] }));
      t.list[kind].push(x, base, z, w, h, d, ry, col);
      colGrid.put(x, z, w, d, base + h);
    };
    const r = RJ.world.gen.mulberry32(1906), pick = (a) => a[Math.floor(r() * a.length)];
    let tallest = [];
    /** A downtown tower: podium, shaft (straight or with setbacks) and rooftop plant. */
    const tower = (x, z, w, d, h, base) => {
      const kr = r(), kind = kr < 0.45 ? 2 : kr < 0.88 ? 1 : 3, col = kind === 2 ? pick(GLASSC) : kind === 1 ? pick(STONE) : pick(DARKC);
      const pod = 8 + r() * 10; add(1, x, z, w + 6, d + 6, Math.min(pod, h), 0, pick(STONE), base);
      if (h > 90 && r() < 0.55) {
        const h1 = h * (0.55 + r() * 0.15), h2 = h * (0.82 + r() * 0.08);
        add(kind, x, z, w, d, h1, 0, col, base); add(kind, x, z, w * 0.8, d * 0.8, h2, 0, col, base); add(kind, x, z, w * 0.58, d * 0.58, h, 0, col, base);
        add(1, x, z, w * 0.34, d * 0.34, h + 5, 0, 0xb8b8b4, base);
      } else {
        add(kind, x, z, w, d, h, 0, col, base); add(1, x, z, w * 0.5, d * 0.45, h + 5, 0, 0xb8b8b4, base);
      }
      if (h > 150) tallest.push(V3(x, base + h + 6, z));
    };
    const areas = [
      { lat0: 37.705, lat1: 37.812, lon0: -122.514, lon1: -122.356, bw: 147, bd: 97, rows: 2, segs: Q >= 2 ? 4 : Q === 1 ? 3 : 2, test: (lat, lon, h) => {
          const presidio = lat > 37.787 && lon > -122.485 && lon < -122.447, park = lat > 37.764 && lat < 37.774 && lon > -122.511 && lon < -122.453;
          return h > 2 && h < 215 && !presidio && !park; } },
      { lat0: 37.755, lat1: 37.885, lon0: -122.335, lon1: -122.23, bw: 160, bd: 110, rows: 1, segs: Q >= 1 ? 3 : 2, test: (lat, lon, h) => h > 2 && h < 85 }
    ];
    for (const A of areas) {
      const x0 = lonX(A.lon0), x1 = lonX(A.lon1), z0 = latZ(A.lat1), z1 = latZ(A.lat0);
      for (let x = x0; x < x1; x += A.bw) for (let z = z0; z < z1; z += A.bd) {
        const lat = g.lat + (Z.z - z) / g.mN, lon = g.lon + (x - Z.x) / g.mE;
        const h0 = G(x, z); if (!A.test(lat, lon, h0)) continue;
        const df = Math.hypot(x - fidi[0], z - fidi[1]), ds = Math.hypot(x - soma[0], z - soma[1]);
        const core = A.rows === 2 ? Math.max(Math.exp(-df / 600), Math.exp(-ds / 700) * 0.7) : 0;
        if (core > 0.2) {
          // downtown: towers on the block, tallest at the heart of the Financial District, all well under Salesforce
          const nT = 3 + Math.floor(r() * 3);
          for (let k = 0; k < nT; k++) {
            const tx = x + (r() - 0.5) * A.bw * 0.62, tz = z + (r() - 0.5) * A.bd * 0.62, w = 26 + r() * 22, d = 24 + r() * 20;
            if (blocked(tx, tz, Math.max(w, d) * 0.5)) continue;
            const h = Math.min(225, 28 + core * (60 + r() * 170) * (r() < 0.3 ? 1.35 : 1.0));
            tower(tx, tz, w, d, h, footMinAxis(tx, tz, w, d) - 2);
          }
          continue;
        }
        if (core > 0.07 || (A.rows === 2 && r() < 0.04)) {
          // the inner ring (Nob Hill, the Tenderloin, SoMa, North Beach's edge): perimeter blocks of 5–12-storey apartments
          for (let row = 0; row < 2; row++) {
            const zz = z + (row ? 1 : -1) * A.bd * 0.25;
            for (let sgi = 0; sgi < 3; sgi++) {
              const L = A.bw / 3 - 3, xx = x - A.bw / 2 + (sgi + 0.5) * (A.bw / 3);
              if (G(xx, zz) < 1.5 || blocked(xx, zz, L * 0.5)) continue;
              const h = 16 + r() * (14 + core * 120);
              add(1, xx, zz, L, A.bd * 0.42, h, 0, pick(STONE), footMinAxis(xx, zz, L, A.bd * 0.42) - 2);
            }
          }
          continue;
        }
        // neighbourhoods: terraces of row houses along the block faces, broken into segments of varied height (the
        // shader paints each 7.6 m lot as its own house); on the steep hills more, shorter segments step down the slope
        const steep = Math.abs(G(x + 60, z) - G(x - 60, z)) / 120 > 0.12;
        const segs = A.segs + (steep && Q >= 1 ? 2 : 0);
        for (let row = 0; row < A.rows; row++) {
          const zz = z + (A.rows === 1 ? 0 : (row ? 1 : -1) * A.bd * 0.26);
          for (let sgi = 0; sgi < segs; sgi++) {
            const L = A.bw / segs - 2.5, xx = x - A.bw / 2 + (sgi + 0.5) * (A.bw / segs);
            const hb = G(xx, zz); if (hb < 1.5 || blocked(xx, zz, L * 0.5)) continue;
            const fl = A.rows === 1 ? 2 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2.6);
            if (r() < 0.05) { add(1, xx, zz, L, A.bd * 0.4, 14 + r() * 14, 0, pick(STONE), footMinAxis(xx, zz, L, A.bd * 0.4) - 2); continue; }
            add(0, xx, zz, L, A.bd * 0.38, fl * 3.3 + 3.2, 0, 0xffffff, footMinAxis(xx, zz, L, A.bd * 0.38) - 2);
          }
        }
      }
    }
    const geoBox = new THREE.BoxGeometry(1, 1, 1); geoBox.translate(0, 0.5, 0);
    const MATS = [rowFacade(),
      facade({ color: 0xffffff, rough: 0.85, wx: 3.2, wy: 3.5, ww: 0.5, wh: 0.58, streak: 0.14 }),
      facade({ color: 0xffffff, rough: 0.28, metal: 0.45, wx: 1.6, wy: 3.9, ww: 0.86, wh: 0.8, glass: "0.15, 0.21, 0.26", lit: 0.45 }),
      facade({ color: 0xffffff, rough: 0.45, metal: 0.2, wx: 1.5, wy: 3.8, ww: 0.62, wh: 0.82, glass: "0.07, 0.08, 0.09", lit: 0.5 })];
    const out = [];
    for (const t of tiles.values()) for (let kind = 0; kind < 4; kind++) {
      const L = t.list[kind], nI = L.length / 8; if (!nI) continue;
      const im = new THREE.InstancedMesh(geoBox, MATS[kind], nI);
      for (let i = 0; i < nI; i++) {
        const o = i * 8; _m4.compose(_p.set(L[o], L[o + 1], L[o + 2]), _q.setFromAxisAngle(V3(0, 1, 0), L[o + 6]), _s.set(L[o + 3], L[o + 4] + 2, L[o + 5]));
        im.setMatrixAt(i, _m4); im.setColorAt(i, _c.setHex(L[o + 7]));
      }
      im.castShadow = true; im.receiveShadow = true; im.userData.tile = t; bound(im, 1500); grp.add(im); out.push(im);
    }
    tallest.sort((a, b) => b.y - a.y); tallest = tallest.slice(0, 24);
    return { tiles: out, tallest };
  }

  /* ======================= landmarks ======================= */
  /** Individually modelled skyline landmarks. Returns exclusion circles [x, z, r] for the procedural city. */
  function skyline(grp, L3, colGrid, solids) {
    const WH = [], GL = [], RD = [], DKG = [], GLD = [], LIT = [], CROWN = [], EC = [], DGRN = [];
    const excl = [];
    const site = (lat, lon, r) => { const [x, z] = geo(lat, lon); excl.push([x, z, r]); return [x, z, G(x, z)]; };
    // Transamerica Pyramid (260 m): a slender four-sided spire with its two "wings" and the lit crown
    { const [x, z, g] = site(37.7952, -122.4028, 45);
      at(WH, new THREE.CylinderGeometry(0.5, 37, 212, 4, 1), x, g + 106, z, Math.PI / 4);
      for (const s of [-1, 1]) at(WH, new THREE.CylinderGeometry(0.4, 9, 150, 4), x + s * 22, g + 120, z, Math.PI / 4);
      at(LIT, new THREE.CylinderGeometry(0.2, 4.2, 52, 4), x, g + 236, z, Math.PI / 4);
      at(DKG, box(44, 10, 44), x, g + 5, z, Math.PI / 4);                                       // the dark base arcade
      L3.red.push(V3(x, g + 262, z)); colGrid.put(x, z, 54, 54, g + 260); }
    // Salesforce Tower (326 m): a rounded, gently tapering obelisk with white piers, and the lit lattice crown
    { const [x, z, g] = site(37.7897, -122.3972, 60);
      at(GL, new THREE.CylinderGeometry(26, 28.4, 300, 32, 1), x, g + 150, z);
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; at(WH, box(1.0, 296, 1.6), x + Math.cos(a) * 27.3, g + 148, z + Math.sin(a) * 27.2, -a); }
      at(CROWN, new THREE.CylinderGeometry(21, 23.4, 24, 28, 1, true), x, g + 312, z);          // LED screen inside the crown
      for (let k = 0; k < 28; k++) { const a = (k / 28) * TAU; at(WH, box(1.2, 26, 1.2), x + Math.cos(a) * 24.3, g + 312, z + Math.sin(a) * 24.3); }
      at(WH, new THREE.CylinderGeometry(24.4, 24.4, 1.2, 28), x, g + 324.5, z);
      L3.red.push(V3(x, g + 327, z)); colGrid.put(x, z, 60, 60, g + 326); }
    // 555 California (237 m): dark carnelian granite with its saw-tooth bay-window walls
    { const [x, z, g] = site(37.7920, -122.4036, 50);
      for (let k = -3; k <= 3; k++) at(DKG, box(6, 237 - Math.abs(k) * 4, 46), x + k * 6.2, g + (237 - Math.abs(k) * 4) / 2, z, 0, 0, 0);
      L3.red.push(V3(x, g + 238, z)); colGrid.put(x, z, 46, 46, g + 237); }
    // 345 California (212 m) twin-spired, 101 California (183 m) glass cylinder, Millennium Tower, 181 Fremont,
    // One Rincon Hill and the four Embarcadero Center slabs (outlined in white lights at night)
    { const [x, z, g] = site(37.7927, -122.4005, 32); at(WH, box(32, 170, 28), x, g + 85, z); for (const s of [-1, 1]) at(WH, box(8, 40, 8), x + s * 10, g + 190, z); colGrid.put(x, z, 32, 28, g + 212); }
    { const [x, z, g] = site(37.7929, -122.3981, 36); at(GL, new THREE.CylinderGeometry(19, 19, 183, 24), x, g + 91, z); at(WH, new THREE.CylinderGeometry(19.2, 19.2, 3, 24), x, g + 183, z); colGrid.put(x, z, 40, 40, g + 184); }
    { const [x, z, g] = site(37.7905, -122.3960, 30); at(GL, new THREE.CylinderGeometry(17, 18, 197, 8), x, g + 98, z, 0.3); colGrid.put(x, z, 36, 36, g + 197); }
    { const [x, z, g] = site(37.7898, -122.3953, 28); at(GL, box(30, 190, 30), x, g + 95, z); at(GL, new THREE.CylinderGeometry(0.6, 21, 26, 4), x, g + 203, z, Math.PI / 4); at(WH, box(1, 50, 1), x, g + 226, z); L3.red.push(V3(x, g + 251, z)); colGrid.put(x, z, 32, 32, g + 245); }
    { const [x, z, g] = site(37.7860, -122.3925, 30); at(GL, box(28, 188, 28), x, g + 94, z, 0.1); colGrid.put(x, z, 32, 32, g + 188); }
    { const H = [173, 126, 126, 174]; [-122.4004, -122.3989, -122.3974, -122.3958].forEach((lon, i) => {
        const [x, z, g] = site(37.7949, lon, 34), h = H[i];
        for (const [w, d, hh] of [[20, 56, h], [26, 44, h - 18], [32, 34, h - 40]]) at(EC, box(w, hh, d), x, g + hh / 2, z);
        for (const sd of [-1, 1]) L3.white.push(V3(x + sd * 10, g + h, z - 28), V3(x + sd * 10, g + h, z + 28), V3(x + sd * 10, g + h * 0.5, z - 28), V3(x + sd * 10, g + h * 0.5, z + 28));
        colGrid.put(x, z, 32, 56, g + h); }); }
    // Coit Tower on Telegraph Hill (64 m fluted column, arched observation gallery) in Pioneer Park
    { const [x, z, g] = site(37.8024, -122.4058, 40);
      at(LIT, new THREE.CylinderGeometry(5.6, 6.1, 58, 24), x, g + 29, z); at(LIT, new THREE.CylinderGeometry(6.4, 5.8, 6, 24), x, g + 61, z);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; at(DKG, box(1.0, 3.0, 0.4), x + Math.cos(a) * 6.3, g + 61.5, z + Math.sin(a) * 6.3, -a + Math.PI / 2); }
      at(LIT, box(22, 7, 22), x, g + 2.5, z); colGrid.put(x, z, 24, 24, g + 64);
      for (let k = 0; k < 26; k++) { const a = k * 2.4, rr = 30 + (k % 5) * 14, tx = x + Math.cos(a) * rr, tz = z + Math.sin(a) * rr, s = 4 + (k % 3) * 1.5; at(DGRN, tint(new THREE.IcosahedronGeometry(s, 0), k % 4 ? 0x3d5a2e : 0x4c6b34), tx, G(tx, tz) + s, tz); } }
    // Sutro Tower (298 m, red and white) on Mount Sutro: three legs, cross-arms, three masts
    { const [x, z] = geo(37.7552, -122.4528), g = G(x, z);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU;
        for (let s = 0; s < 6; s++) { const y0 = (s / 6) * 230, mid = (s + 0.5) / 6, rr = 26 * (1 - mid * 0.8); at(s % 2 ? WH : RD, new THREE.CylinderGeometry(1.4, 1.6, 230 / 6, 6), x + Math.cos(a) * rr, g + y0 + 230 / 12, z + Math.sin(a) * rr); }
        at(RD, new THREE.CylinderGeometry(0.8, 0.8, 70, 5), x + Math.cos(a) * 9, g + 265, z + Math.sin(a) * 9);
        L3.red.push(V3(x + Math.cos(a) * 9, g + 300, z + Math.sin(a) * 9), V3(x + Math.cos(a) * 18, g + 160, z + Math.sin(a) * 18)); }
      for (const y of [80, 160, 228]) at(RD, new THREE.CylinderGeometry(26 * (1 - (y / 230) * 0.8) + 2, 26 * (1 - (y / 230) * 0.8) + 2, 2, 3), x, g + y, z);
      colGrid.put(x, z, 60, 60, g + 298); }
    // Palace of Fine Arts: the ochre rotunda with its colonnade arc around the lagoon
    { const [x, z, g0] = site(37.8029, -122.4484, 10), g = Math.max(1, g0), PF = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; at(PF, cyl(1.4, 1.6, 22, 8), x + Math.cos(a) * 18, g + 11, z + Math.sin(a) * 18); }
      at(PF, cyl(18.5, 18.5, 4, 16), x, g + 24, z); at(PF, cyl(15, 16, 8, 16), x, g + 30, z);
      at(PF, new THREE.SphereGeometry(15.2, 16, 8, 0, TAU, 0, Math.PI / 2), x, g + 34, z);
      for (let k = 0; k < 34; k++) { const a = -0.2 + Math.PI * 0.95 * (k / 33) + Math.PI * 0.55, rr = 95, cx = x + Math.cos(a) * rr, cz = z + Math.sin(a) * rr, cg = Math.max(1, G(cx, cz)); at(PF, cyl(1.1, 1.2, 14, 6), cx, cg + 7, cz); if (k % 3 === 0) at(PF, box(4.5, 3, 6), cx, cg + 15, cz, -a); }
      excl.push([x, z, 120]); colGrid.put(x, z, 40, 40, g + 50);
      mesh(grp, PF, std(0xd0a27c, 0.85)); }
    // Lombard Street: eight brick hairpins between hedges and flower beds, Hyde St → Leavenworth St
    { const [x0, z0] = geo(37.80215, -122.41935), [x1, z1] = geo(37.80200, -122.41760), LB = [], BED = [];
      const n = 8, pts = [];
      for (let k = 0; k <= n; k++) { const t = k / n, cx = RJ.lerp(x0, x1, t), cz = RJ.lerp(z0, z1, t); pts.push([cx, cz + (k % 2 ? 9 : -9)]); }
      for (let k = 0; k < n; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az);
        for (let q = 0; q < 3; q++) { const t = (q + 0.5) / 3, sx = RJ.lerp(ax, bx, t), sz = RJ.lerp(az, bz, t); at(LB, box(6, 0.8, len / 3 + 1.5), sx, G(sx, sz) + 0.1, sz, ry); }
        const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2], off = k % 2 ? -1 : 1;
        at(BED, tint(box(5, 1.3, 6), k % 2 ? 0x3f6b33 : 0x5e7d38), mx + off * 4.5, G(mx + off * 4.5, mz) + 0.4, mz, ry);
        at(BED, tint(box(3, 0.9, 3), 0xc0507a), mx - off * 4.5, G(mx - off * 4.5, mz) + 0.3, mz, ry);
      }
      excl.push([(x0 + x1) / 2, (z0 + z1) / 2, 30]);
      mesh(grp, LB, std(0x8a3f33, 0.9), false); const bm = std(0xffffff, 0.9); bm.vertexColors = true; mesh(grp, BED, bm, false); }
    // the Painted Ladies (Steiner St, facing Alamo Square): seven Queen Anne houses with gables and bay windows
    { const [x, z] = geo(37.77625, -122.43275), PL = [], PW = [], cols = [0xa7c4d4, 0xe8c4c4, 0xf2dc9b, 0xb8d3b4, 0xc9b9d9, 0xf0c8a4, 0x9fb6cf];
      for (let k = 0; k < 7; k++) {
        const hz = z + (k - 3) * 7.9, g = footMinAxis(x, hz, 16, 7.4) - 1, gt = G(x - 8, hz), c = cols[k];
        at(PL, tint(box(16, 11 + (gt - g), 7.4), c), x, g + (11 + gt - g) / 2, hz);
        const roof = U().prism(7.4, 5, 16); roof.rotateY(Math.PI / 2); at(PL, tint(roof, 0x6c5e5a), x, gt + 11, hz);
        at(PL, tint(box(0.6, 5.2, 7.6), 0xf4f1e8), x - 8.2, gt + 13.2, hz);                      // gable face trim
        at(PL, tint(box(1.4, 8, 3.6), c), x - 8.5, gt + 6.5, hz + 1.2);                           // the bay window
        at(PL, tint(box(1.8, 0.5, 4.2), 0xf4f1e8), x - 8.6, gt + 10.7, hz + 1.2);
        at(PL, tint(box(1.0, 0.7, 7.6), 0xf4f1e8), x - 8.1, gt + 11.0, hz);                       // cornice
        for (const y of [4.5, 8.2]) { at(PW, box(0.3, 2.2, 0.9), x - 9.25, gt + y, hz + 0.1); at(PW, box(0.3, 2.2, 0.9), x - 9.25, gt + y, hz + 1.2); at(PW, box(0.3, 2.2, 0.9), x - 9.25, gt + y, hz + 2.3); at(PW, box(0.3, 2.2, 1.0), x - 8.15, gt + y, hz - 2.4); }
        at(PW, box(0.3, 1.6, 1.2), x - 8.15, gt + 13.2, hz);                                      // attic window
        colGrid.put(x, hz, 16, 7.4, gt + 16);
      }
      excl.push([x, z, 34]); const pm = std(0xffffff, 0.8); pm.vertexColors = true; mesh(grp, PL, pm); mesh(grp, PW, std(0x1d2226, 0.2, 0.4), false);
      // Alamo Square's trees
      const [ax, az] = geo(37.7764, -122.4346);
      for (let k = 0; k < 30; k++) { const a = k * 2.39996, rr = 25 + (k % 7) * 15, tx = ax + Math.cos(a) * rr, tz = az + Math.sin(a) * rr * 0.8, s = 3.5 + (k % 3) * 1.4; at(DGRN, tint(new THREE.IcosahedronGeometry(s, 0), k % 3 ? 0x3d5a2e : 0x55703a), tx, G(tx, tz) + s, tz); } }
    mesh(grp, WH, facade({ color: 0xece8de, rough: 0.6, wx: 2.6, wy: 3.6, ww: 0.55, wh: 0.5, streak: 0.05 }));
    mesh(grp, GL, facade({ color: 0xb8c3c8, rough: 0.25, metal: 0.5, wx: 2, wy: 4, ww: 0.85, wh: 0.75, glass: "0.16, 0.2, 0.23", lit: 0.4 }));
    mesh(grp, DKG, facade({ color: 0x4e3e3a, rough: 0.4, metal: 0.25, wx: 1.6, wy: 3.8, ww: 0.6, wh: 0.8, glass: "0.06, 0.07, 0.08", lit: 0.5 }));
    mesh(grp, EC, facade({ color: 0xe4e0d4, rough: 0.7, wx: 1.8, wy: 3.6, ww: 0.55, wh: 0.7, streak: 0.04, lit: 0.45 }));
    mesh(grp, RD, std(0xb33a2a, 0.6)); mesh(grp, GLD, std(0xc9a24a, 0.4, 0.8));
    mesh(grp, LIT, flood(0xf0eadb, 0xffd9a0, 0.55, 0.7));
    mesh(grp, CROWN, flood(0x8a9399, 0xdfe8ff, 1.3, 0.3, 0.3), false);
    if (DGRN.length) { const gm = std(0xffffff, 0.95); gm.vertexColors = true; gm.flatShading = true; mesh(grp, DGRN, gm, false); }
    return excl;
  }

  /* ======================= the waterfront ======================= */
  /** Shoreline-following placement: from a land point, march along the seaward normal to the water's edge. */
  function seaward(x, z) {
    let sx = 0, sz = 0;
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU, c = Math.cos(a), s = Math.sin(a); if (G(x + c * 160, z + s * 160) < 0) { sx += c; sz += s; } }
    const L = Math.hypot(sx, sz); return L ? [sx / L, sz / L] : null;
  }
  /** The Ferry Building, the Embarcadero's finger piers and Pier 39. */
  function waterfront(grp, L3, colGrid, solids) {
    const PIER = [], SHED = [], WH = [], LIT = [], DK = [], RF = [];
    const excl = [];
    // walk the Embarcadero (south beach → Fisherman's Wharf), dropping a pier wherever the shore is clear
    const line = [[37.7795, -122.3880], [37.7850, -122.3870], [37.7905, -122.3890], [37.7945, -122.3925], [37.7985, -122.3962], [37.8025, -122.4005], [37.8060, -122.4045], [37.8082, -122.4090], [37.8085, -122.4130]];
    const [fbx, fbz] = geo(37.7955, -122.3937);
    let made = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = geo(...line[i]), [bx, bz] = geo(...line[i + 1]), L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 125) {
        const x = RJ.lerp(ax, bx, s / L), z = RJ.lerp(az, bz, s / L);
        if (Math.hypot(x - fbx, z - fbz) < 200) continue;
        const n = seaward(x, z); if (!n) continue;
        // find the water's edge along the normal
        let e = -200; while (e < 300 && G(x + n[0] * e, z + n[1] * e) > 0.5) e += 8; if (e >= 300) continue;
        const ex = x + n[0] * e, ez = z + n[1] * e, ry = Math.atan2(n[0], n[1]);
        const len = 140 + ((made * 37) % 5) * 30, w = 28 + ((made * 13) % 3) * 8, cx = ex + n[0] * len / 2, cz = ez + n[1] * len / 2;
        if (G(cx, cz) > -1 || G(ex + n[0] * len, ez + n[1] * len) > -1) continue;
        at(PIER, box(w + 6, 4, len), cx, 1.5, cz, ry);                                                // deck on piles
        at(SHED, box(w, 11, len - 22), cx + n[0] * 8, 3.5 + 5.5, cz + n[1] * 8, ry);                     // the cargo shed
        at(RF, box(w * 0.5, 2.2, len - 26), cx + n[0] * 8, 15.2, cz + n[1] * 8, ry);                      // clerestory
        at(WH, box(w + 4, 16, 8), ex + n[0] * 5, 1.5 + 8, ez + n[1] * 5, ry);                             // the bulkhead facade on the Embarcadero
        at(WH, box(w * 0.36, 4, 8.6), ex + n[0] * 5, 1.5 + 18, ez + n[1] * 5, ry);                       // pediment
        colGrid.put(cx, cz, w, w, 17); made++;
        if (made % 2 === 0) L3.warm.push(V3(ex + n[0] * 3, 14, ez + n[1] * 3));
      }
    }
    // the Ferry Building (1898): 200 m arcaded hall along the Embarcadero, and its 75 m clock tower
    { const n = seaward(fbx, fbz) || [0.6, -0.8]; const ry = Math.atan2(n[0], n[1]), g = Math.max(2.5, G(fbx, fbz)), tx = -n[1], tz = n[0];
      at(WH, box(200, 15, 34), fbx, g + 7.5, fbz, ry); at(RF, box(196, 3, 22), fbx, g + 16, fbz, ry);
      for (let k = -9; k <= 9; k++) at(DK, box(4.4, 6, 0.5), fbx + tx * k * 10 - n[0] * 17.2, g + 4, fbz + tz * k * 10 - n[1] * 17.2, ry);   // arcade arches on the street side
      const T = [[14, 0, 48], [12, 48, 6], [10.5, 54, 8], [8.5, 62, 6]];
      for (const [w, y0, h] of T) at(LIT, box(w, h, w), fbx, g + y0 + h / 2, fbz, ry);
      at(LIT, new THREE.ConeGeometry(6, 7, 4), fbx, g + 71.5, fbz, ry + Math.PI / 4);
      at(WH, box(0.3, 6, 0.3), fbx, g + 78, fbz);
      for (let k = 0; k < 4; k++) { const a = ry + (k * Math.PI) / 2, cx = fbx + Math.sin(a) * 7.1, cz = fbz + Math.cos(a) * 7.1; at(LIT, new THREE.CylinderGeometry(3, 3, 0.4, 20).rotateX(Math.PI / 2).rotateY(a), cx, g + 44, cz); }
      L3.warm.push(V3(fbx, g + 44, fbz)); colGrid.put(fbx, fbz, 40, 40, g + 78); solids.push({ x: fbx, z: fbz, hw: 8, hd: 8, top: g + 78, ry });
      excl.push([fbx, fbz, 120]); }
    // Pier 39: the long pier of wooden two-storey shops at Fisherman's Wharf
    { const [x, z] = geo(37.8095, -122.4098), n = seaward(x, z);
      if (n) { const ry = Math.atan2(n[0], n[1]); let e = 0; while (e < 300 && G(x + n[0] * e, z + n[1] * e) > 0.5) e += 8;
        const ex = x + n[0] * e, ez = z + n[1] * e;
        at(PIER, box(60, 4, 330), ex + n[0] * 165, 1.5, ez + n[1] * 165, ry);
        for (let k = 0; k < 12; k++) { const s = 20 + k * 26, sd = k % 2 ? 1 : -1; at(SHED, box(18, 8, 20), ex + n[0] * s - n[1] * sd * 16, 7.5, ez + n[1] * s + n[0] * sd * 16, ry); const pr = U().prism(18, 4, 20); at(RF, pr, ex + n[0] * s - n[1] * sd * 16, 11.5, ez + n[1] * s + n[0] * sd * 16, ry + Math.PI / 2); }
        for (let k = 0; k < 6; k++) at(PIER, box(8, 1, 70), ex + n[0] * (60 + k * 40) + n[1] * 60, 0.6, ez + n[1] * (60 + k * 40) - n[0] * 60, ry + Math.PI / 2);   // marina docks
        colGrid.put(ex + n[0] * 165, ez + n[1] * 165, 60, 60, 12); } }
    mesh(grp, PIER, std(0x8b857a, 0.95), false);
    mesh(grp, SHED, facade({ color: 0xd9d4c6, rough: 0.9, wx: 6, wy: 6, ww: 0.6, wh: 0.4, streak: 0.2, lit: 0.85 }));
    mesh(grp, WH, facade({ color: 0xe6dfcd, rough: 0.8, wx: 4.4, wy: 5, ww: 0.55, wh: 0.6, streak: 0.12, lit: 0.6 }));
    mesh(grp, RF, std(0x7b7d7c, 0.8)); mesh(grp, DK, std(0x2c2a28, 0.8), false);
    mesh(grp, LIT, flood(0xeae2cf, 0xffe2b0, 0.6, 0.75));
    return excl;
  }

  /** Fort Point (1861): the brick casemate fort under the Golden Gate's south end. */
  function fortPoint(grp) {
    const [x, z] = geo(37.8106, -122.4770), g = G(x, z); if (g < 1) return;
    const F = [];
    at(F, box(76, 16 + g, 48), x, (16 + g) / 2 - 2 + 0, z, 0.25);
    at(F, box(64, 2, 36), x, g + 15, z, 0.25);
    mesh(grp, F, facade({ color: 0x9b5a45, rough: 0.95, wx: 4.4, wy: 4.6, ww: 0.3, wh: 0.5, streak: 0.3, lit: 0.95 }));
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
  function lampMesh(grp, pts, r) {
    if (!pts.length) return null;
    const m = glow(0x000000), im = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 6, 4), m, pts.length);
    pts.forEach((p, i) => { _m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, _m4); });
    grp.add(bound(im, 60)); return m;
  }
  SF.ensure = function () {
    if (SF.ready || !SF.available()) return;
    SF.ready = true;
    const W = RJ.world, grp = new THREE.Group(); grp.name = "sf";
    const L3 = { warm: [], white: [], red: [] }, solids = [], colGrid = makeColGrid();
    FLOOD.length = 0;
    const t0 = performance.now();
    try {
      const alc = alcatraz(grp, L3, solids);
      // Golden Gate: International Orange; the towers are floodlit at night
      const ggMat = flood(0xc0362c, 0xff7a3c, 0.12, 0.55, 0.25), ggTower = flood(0xc0362c, 0xff8a4a, 0.4, 0.55, 0.25);
      const gg = suspension(grp, { A: geo(37.8105, -122.4769), T1: geo(37.8158, -122.4779), T2: geo(37.8273, -122.4793), B: geo(37.8326, -122.4800), width: 27.4, deck: 67, towerH: 227, cable: 1.1, struts: [0.5, 0.66, 0.82, 0.97], mat: ggMat, towerMat: ggTower, dark: 0x5a221b }, L3);
      approach(grp, gg.A[0], gg.A[1], -gg.ux, -gg.uz, gg.dy, 27.4, 700, ggMat, std(0x9c968c, 0.9), L3);
      approach(grp, gg.B[0], gg.B[1], gg.ux, gg.uz, gg.dy, 27.4, 500, ggMat, std(0x9c968c, 0.9), L3);
      fortPoint(grp);
      // Bay Bridge west spans: silver, X-braced towers, double deck, cable lights and the Bay Lights
      const bayMat = std(0x9aa1a6, 0.55, 0.4);
      const bo = { width: 22, deck: 58, towerH: 150, cable: 0.9, struts: [0.55, 0.8, 0.97], mat: bayMat, xb: true, girder: 10, lower: true, cableLights: true, bayLights: true, dark: 0x3a3d40, legW: 8, legD: 10, lanes: 6 };
      const bb1 = suspension(grp, Object.assign({ A: geo(37.7874, -122.3870), T1: geo(37.7900, -122.3840), T2: geo(37.7943, -122.3790), B: geo(37.7970, -122.3758) }, bo), L3);
      const bb2 = suspension(grp, Object.assign({ A: geo(37.7970, -122.3758), T1: geo(37.7997, -122.3727), T2: geo(37.8040, -122.3677), B: geo(37.8075, -122.3640) }, bo), L3);
      approach(grp, bb1.A[0], bb1.A[1], -bb1.ux, -bb1.uz, bb1.dy, 22, 450, bayMat, std(0x9c968c, 0.9), L3);
      SF.bridges = [gg.solid, bb1.solid, bb2.solid];
      try { SF.east = eastSpan(grp, L3, solids); } catch (e) { console.warn("SF east span failed", e); }
      const excl = skyline(grp, L3, colGrid, solids);
      excl.push(...waterfront(grp, L3, colGrid, solids));
      const C = city(grp, colGrid, excl);
      SF.tiles = C.tiles;
      L3.red.push(...C.tallest);
      const lampMat = lampMesh(grp, L3.warm, 1.6), whiteMat = lampMesh(grp, L3.white, 1.1), redMat = lampMesh(grp, L3.red, 2.2);
      // the lighthouse beam: a long soft cone that sweeps at night, and the lamp glow
      const beam = new THREE.Mesh(new THREE.ConeGeometry(28, 900, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.geometry.translate(0, -450, 0); beam.geometry.rotateZ(Math.PI / 2);
      const pivot = new THREE.Group(); pivot.position.copy(alc.beaconPos); pivot.add(beam); beam.layers.set(RJ.LATE); grp.add(pivot);
      Object.assign(SF, { grp, lampMat, whiteMat, redMat, beam, pivot, alc, solids, colGrid, t: 0, mistT: 0, hornT: 8 });
      W.scene.add(grp);
      SF.buildMs = Math.round(performance.now() - t0);
    } catch (e) { console.warn("San Francisco failed to build", e); }
  };

  SF.update = function (dt, cam) {
    if (!SF.ready || !SF.grp) return;
    const W = RJ.world, Z = W.gen.sfZone, d = Math.hypot(cam.position.x - Z.x, cam.position.z - Z.z);
    SF.grp.visible = d < 42000;
    if (!SF.grp.visible) return;
    SF.t += dt; uTime.value = SF.t % 1000;
    const nk = RJ.clamp(1 - RJ.smooth(-4, 8, W.sunElev), 0, 1);
    night.value = nk; if (RJ.cityKit) RJ.cityKit.wetTick(dt);
    SF.lampMat.color.setRGB(1.6, 0.9, 0.45).multiplyScalar(0.1 + nk * 1.6);
    if (SF.whiteMat) SF.whiteMat.color.setRGB(1.0, 1.0, 1.05).multiplyScalar(0.12 + nk * 1.9);
    if (SF.redMat) SF.redMat.color.setRGB(1.6, 0.06, 0.04).multiplyScalar((0.25 + nk * 1.4) * (Math.sin(SF.t * 3.1) > -0.2 ? 1 : 0.15));
    for (const m of FLOOD) m.emissive.copy(m.userData.e).multiplyScalar(nk * m.userData.k);
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
    const E = SF.east;
    if (E) {
      const dx = p.x - E.a0x, dz = p.z - E.a0z, s = dx * E.ux + dz * E.uz, q = -dx * E.uz + dz * E.ux;
      if (s > 0 && s < E.LA && Math.abs(q) < E.deckW + E.gap / 2 && p.y > E.dyS - 6 && p.y < E.dyS + 1) return true;
      const ex = p.x - E.e0x, ez = p.z - E.e0z, s2 = ex * E.sx + ez * E.sz, q2 = -ex * E.sz + ez * E.sx;
      if (s2 > 0 && s2 < E.LS && Math.abs(q2) < E.deckW + E.gap / 2) { const y = RJ.lerp(E.dyS, 10, Math.pow(s2 / E.LS, 1.3)); if (p.y > y - 5 && p.y < y + 1) return true; }
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
  /** San Francisco Bay Run: under the Golden Gate, along the Marina, round Alcatraz, over Telegraph Hill, between
   *  the Transamerica Pyramid and Salesforce Tower, then under the Bay Bridge's western span. */
  SF.route = function () {
    if (!SF.available()) return null;
    SF.ensure();
    const G = [[37.8199, -122.4783, 35], [37.8090, -122.4500, 60], [37.8070, -122.4300, 70], [37.8240, -122.4230, 90], [37.8060, -122.4100, 220],
      [37.7975, -122.4020, 200], [37.7925, -122.3985, 345], [37.7890, -122.3925, 160], [37.79215, -122.3815, 28]];
    return G.map(([la, lo, y], i) => { const [x, z] = geo(la, lo); const v = RJ.V3(x, y, z); v.keep = true; v.tight = i === 0 || i === G.length - 1; return v; });
  };
  /** Free Flight start: low over the bay east of Alcatraz, heading for the Golden Gate. */
  SF.spawn = function () {
    if (!SF.available()) return null;
    if (RJ.atlas && RJ.atlas.built) SF.ensure();
    const [x, z] = geo(37.8290, -122.3880), [tx, tz] = geo(37.8230, -122.4780);
    return { x, z, yaw: Math.atan2(-(tx - x), -(tz - z)), alt: 260 };
  };
})(window.RJ);
