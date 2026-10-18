/* Jet City — city kit: the shared builder behind Tokyo, Dubai, Rio, Hong Kong and Chicago.
 * A city is described by a style (palette, window colours, districts with height fields, a skyscraper canyon,
 * a slalom row of slender towers, hero towers, neon, elevated roads, bridges) and turned into:
 *   · towers from five instanced shapes (box, cylinder, octagon, square taper, triangle) in glass or stone,
 *     stacked into setback, tapered, twisted, notched and bundled forms with crowns, spires, masts, helipads
 *     and rooftop plant; a facade shader draws window grids, ribbons, curtain walls or fins, lights a random
 *     share of windows at night (fading to an averaged glow far away), storefronts and crown lights
 *   · a street grid with sidewalks and lamps under the core, moving traffic, neon billboards
 *   · a distant skyline twin on the far-terrain layer so the silhouette is on the horizon from 60 km
 *   · a collision grid matching the visible footprints, oriented solids for bridges (you can fly under them)
 *   · a race route of gates: sea approach, under the bridge, down the canyon, through the slalom, up the hero tower.
 * Everything is placed in sea-axis (s, toward the water) / coast-axis (p) coordinates around the city centre. */
(function (RJ) {
  "use strict";
  const K = (RJ.cityKit = {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
  const NIGHT = { value: 0 };
  K.NIGHT = NIGHT;

  /* ======================= facade material ======================= */
  // aWin: x style (0 punched · 1 ribbon · 2 curtain · 3 fins · 4 dense grid · 8 helipad roof · 9 plain), y lit share, z crown light, w seed
  function facadeMat(glass, P) {
    const m = new THREE.MeshStandardMaterial({ roughness: glass ? 0.22 : 0.78, metalness: glass ? 0.55 : 0.06 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = NIGHT;
      sh.uniforms.rjWarm = { value: new THREE.Color(P.warm) };
      sh.uniforms.rjCool = { value: new THREE.Color(P.cool) };
      sh.uniforms.rjCrown = { value: new THREE.Color(P.crown) };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aWin; varying vec4 vWin; varying vec3 vCW; varying vec3 vCN; varying vec2 vSpan;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "vec4 rjWp = vec4(transformed, 1.0); vec3 rjNo = objectNormal;",
          "#ifdef USE_INSTANCING",
          "rjWp = instanceMatrix * rjWp; rjNo = mat3(instanceMatrix) * rjNo;",
          "vSpan = vec2((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y, (instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y);",
          "#else",
          "vSpan = vec2(0.0, 1.0);",
          "#endif",
          "vCW = (modelMatrix * rjWp).xyz; vCN = normalize(mat3(modelMatrix) * rjNo); vWin = aWin;"
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vWin; varying vec3 vCW; varying vec3 vCN; varying vec2 vSpan; uniform float rjNight; uniform vec3 rjWarm; uniform vec3 rjCool; uniform vec3 rjCrown;\nfloat rjH(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "{",
          "  float st = vWin.x, dist = length(cameraPosition - vCW), near = 1.0 - smoothstep(1800.0, 7000.0, dist);",
          "  float v = vCW.y - vSpan.x, H = vSpan.y - vSpan.x;",
          "  if (st < 7.5 && abs(vCN.y) < 0.55) {",
          "    vec2 t = normalize(vec2(-vCN.z, vCN.x) + 1e-5); float u = dot(vCW.xz, t);",
          "    float bay = st < 0.5 ? 3.0 : st < 1.5 ? 3.2 : st < 2.5 ? 1.6 : st < 3.5 ? 1.25 : 2.2;",
          "    float fl = st > 3.5 ? 3.3 : 3.7;",
          "    float fu = fract(u / bay), fv = fract(v / fl);",
          "    float win = st < 0.5 ? step(fu, 0.6) * step(fv, 0.56)",
          "              : st < 1.5 ? step(fv, 0.52)",
          "              : st < 2.5 ? (1.0 - step(0.93, fu)) * (1.0 - step(0.88, fv))",
          "              : st < 3.5 ? step(fu, 0.42) * step(fv, 0.9)",
          "              : step(fu, 0.72) * step(fv, 0.64);",
          "    win *= step(4.0, v);",
          "    float slab = st > 1.5 && st < 2.5 ? (1.0 - step(0.06, fv)) : 0.0;",
          "    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.32 + vec3(0.03, 0.05, 0.07), win * 0.7 * near) * (1.0 - slab * 0.35);",
          "    vec3 cell = vec3(floor(u / bay), floor(v / fl), vWin.w);",
          "    float h1 = rjH(cell), h2 = rjH(cell + 7.1);",
          "    float lit = step(1.0 - vWin.y, h1);",
          "    vec3 wc = mix(rjWarm, rjCool, step(0.7, h2)) * (0.6 + 0.6 * h2);",
          // far away the pattern averages out: an even glow at the lit share instead of shimmering pixels
          "    vec3 glow = mix(rjWarm * vWin.y * 0.45, wc * win * lit, near);",
          "    totalEmissiveRadiance += glow * rjNight * 1.5;",
          // storefronts and lobbies at street level, crown lights at the top
          "    totalEmissiveRadiance += rjWarm * (1.0 - smoothstep(3.0, 6.5, v)) * rjNight * 0.9;",
          "    totalEmissiveRadiance += rjCrown * vWin.z * smoothstep(H - 7.0, H - 5.0, v) * rjNight * 2.2;",
          "  }",
          // roofs: matte (glass towers would otherwise mirror the sky from above, glowing at night)
          "  if (vCN.y > 0.5) { metalnessFactor = 0.0; roughnessFactor = 0.85; diffuseColor.rgb = diffuseColor.rgb * 0.45 + vec3(0.08); }",
          "  if (st > 7.5 && st < 8.5 && vCN.y > 0.5) {",
          // helipad: dark pad, yellow ring, red edge lights at night
          "    diffuseColor.rgb = vec3(0.12, 0.13, 0.14);",
          "  }",
          "}"
        ].join("\n"));
    };
    return m;
  }

  /* ======================= unit shapes (base at y = 0, top at y = 1) ======================= */
  const SHAPES = {};
  function shapes() {
    if (SHAPES.box) return SHAPES;
    const up = (g) => { g.translate(0, 0.5, 0); return g; };
    SHAPES.box = up(new THREE.BoxGeometry(1, 1, 1));
    SHAPES.cyl = up(new THREE.CylinderGeometry(0.5, 0.5, 1, 22, 1));
    SHAPES.oct = up(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1));
    const tp = new THREE.CylinderGeometry(0.33, 0.5, 1, 4, 1); tp.rotateY(Math.PI / 4); tp.scale(1.414, 1, 1.414); SHAPES.taper = up(tp);
    SHAPES.tri = up(new THREE.CylinderGeometry(0.58, 0.58, 1, 3, 1));
    SHAPES.cone = up(new THREE.CylinderGeometry(0.02, 0.5, 1, 8, 1));
    return SHAPES;
  }

  /* ======================= builder ======================= */
  /** Collects instances: tower pieces, roof clutter, collision footprints. */
  class Batch {
    constructor() { this.L = {}; this.foot = []; this.tall = []; }
    add(shape, glass, x, y, z, sx, h, sz, ry, col, st, lit, crown) {
      const k = shape + (glass ? "G" : "S");
      (this.L[k] = this.L[k] || []).push(x, y, z, sx, h, sz, ry, col, st, lit, crown, Math.random() * 97);
    }
    foot2(x, z, r, top) { this.foot.push(x, z, r, top); }
  }
  K.Batch = Batch;

  const pick = (a, r) => a[Math.floor(r() * a.length)];
  /** One building: a form chosen from its height and the city's taste, with crown details. Returns its top. */
  K.tower = function (B, o, r) {
    const { x, z, y, w, d, h, ry, glassP, P } = o;
    const glass = o.glass != null ? o.glass : r() < glassP;
    const col = glass ? pick(P.glass, r) : pick(P.stone, r);
    const st = o.st != null ? o.st : glass ? (r() < 0.75 ? 2 : 1) : pick(P.styles || [0, 0, 1, 3, 4], r);
    const lit = o.lit != null ? o.lit : RJ.lerp(0.28, 0.55, r());
    let form = o.form;
    if (!form) {
      if (h < 45) form = "box";
      else if (h < 140) form = pick(["box", "box", "podium", "oct", "notch"], r);
      else form = pick(P.forms || ["setback", "taper", "cyl", "podium", "twist", "notch", "tri", "setback"], r);
    }
    const crown = o.crown != null ? o.crown : h > 120 && r() < (P.crownP != null ? P.crownP : 0.5) ? 1 : 0;
    const A = (s, yy, sx, hh, sz, rr, c, sty, gl) => B.add(s, gl != null ? gl : glass, x, yy, z, sx, hh, sz, rr != null ? rr : ry, c != null ? c : col, sty != null ? sty : st, lit, crown);
    let top = y + h, roofW = Math.min(w, d) * 0.7, flat = true;
    switch (form) {
      case "box": A("box", y, w, h, d); break;
      case "oct": A("oct", y, w, h, d); break;
      case "cyl": A("cyl", y, w, h, d); roofW = w * 0.6; break;
      case "tri": A("tri", y, w * 1.1, h, w * 1.1); roofW = w * 0.45; break;
      case "podium": { const ph = Math.min(h * 0.18, 30); A("box", y, w * 1.25, ph, d * 1.25, null, pick(P.stone, r), pick([0, 1], r), false); A(r() < 0.5 ? "box" : "oct", y + ph, w * 0.85, h - ph, d * 0.85); roofW = w * 0.55; break; }
      case "setback": {
        let yy = y, ww = w, dd = d; const n = 3 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) { const hh = h * (i === n - 1 ? 1 - (n - 1) * 0.26 : 0.26); A("box", yy, ww, hh, dd); yy += hh; ww *= 0.8; dd *= 0.8; }
        roofW = ww * 0.6; break;
      }
      case "taper": A("taper", y, w, h, d); roofW = w * 0.25; flat = false; break;
      case "twist": {
        // twisting tower: 14 floors-plates, each turned a little further (0.6–1.4 rad over the height)
        const n = 14, T = (r() < 0.5 ? 1 : -1) * RJ.lerp(0.6, 1.4, r());
        for (let i = 0; i < n; i++) A("box", y + (h / n) * i, w * 0.88, h / n + 0.3, d * 0.88, ry + (T * i) / n);
        roofW = w * 0.5; break;
      }
      case "notch": { A("box", y, w * 0.62, h, d, null); A("box", y, w * 0.5, h * 0.82, d * 0.7, null); B.add("box", glass, x + Math.cos(ry) * w * 0.3, y, z - Math.sin(ry) * w * 0.3, w * 0.45, h * 0.9, d * 0.8, ry, col, st, lit, crown); break; }
      case "bundle": {
        // Willis-style bundled tubes: 3 × 3 squares ending at different heights
        const s = w / 3, ends = o.ends || [1, 0.63, 0.83, 0.47, 1, 0.83, 0.47, 0.63, 0.47];
        let i = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const ox = Math.cos(ry) * a * s + Math.sin(ry) * b * s, oz = -Math.sin(ry) * a * s + Math.cos(ry) * b * s;
          B.add("box", glass, x + ox, y, z + oz, s * 1.01, h * ends[i++], s * 1.01, ry, col, st, lit, 0);
        }
        roofW = s * 0.8; break;
      }
    }
    // crowns and roof clutter
    const spire = o.spire != null ? o.spire : h > 180 && r() < 0.35 ? h * RJ.lerp(0.1, 0.22, r()) : 0;
    if (spire) { A("cone", top, roofW * 0.8, spire, roofW * 0.8, null, P.metal || 0xc8ccd0, 9, true); top += spire; }
    else if (h > 90 && r() < 0.3) { for (const s of [-1, 1]) B.add("cyl", true, x + s * roofW * 0.25, top, z, 1.6, h * 0.12, 1.6, 0, 0x9aa0a6, 9, 0, 0); top += h * 0.12; }
    else if (flat && h > 60 && r() < 0.3) A("cyl", top, roofW, 0.8, roofW, null, 0x3a3d40, 8, false); // helipad
    if (flat && h > 25 && !spire && RJ.settings.quality !== "low") {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) { const a = r() * TAU, rr = roofW * 0.25 * r(); B.add("box", false, x + Math.cos(a) * rr, y + h, z + Math.sin(a) * rr, roofW * RJ.lerp(0.15, 0.35, r()), RJ.lerp(2.5, 6, r()), roofW * RJ.lerp(0.15, 0.35, r()), ry, 0x7c8186, 9, 0, 0); }
    }
    B.foot2(x, z, Math.max(w, d) * (form === "podium" ? 0.66 : 0.52), y + h);
    if (h > 60) B.tall.push(x, z, Math.max(w, d) * 0.5, y, h, col);
    return top;
  };

  /** Turn a batch into instanced meshes (one per shape and material class). */
  K.meshes = function (B, grp, P) {
    shapes();
    const mats = { G: facadeMat(true, P), S: facadeMat(false, P) }, out = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), Y = V3(0, 1, 0), p = V3(), s = V3();
    // split every shape/material list into 2.5 km tiles so whole districts can be frustum- and distance-culled
    const TILE = 2500, tiles = {};
    for (const k in B.L) {
      const L = B.L[k];
      for (let i = 0; i < L.length; i += 12) {
        const key = k + ":" + Math.floor(L[i] / TILE) + "," + Math.floor(L[i + 2] / TILE);
        const t = tiles[key] || (tiles[key] = { k, L: [], x: (Math.floor(L[i] / TILE) + 0.5) * TILE, z: (Math.floor(L[i + 2] / TILE) + 0.5) * TILE });
        for (let j = 0; j < 12; j++) t.L.push(L[i + j]);
      }
    }
    for (const key in tiles) {
      const T = tiles[key], k = T.k, L = T.L, n = L.length / 12, geo = SHAPES[k.slice(0, -1)].clone();
      const win = new Float32Array(n * 4);
      const im = new THREE.InstancedMesh(geo, mats[k.slice(-1)], n);
      for (let i = 0; i < n; i++) {
        const o = i * 12;
        m4.compose(p.set(L[o], L[o + 1], L[o + 2]), q.setFromAxisAngle(Y, L[o + 6]), s.set(L[o + 3], L[o + 4], L[o + 5]));
        im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(L[o + 7]));
        win[i * 4] = L[o + 8]; win[i * 4 + 1] = L[o + 9]; win[i * 4 + 2] = L[o + 10]; win[i * 4 + 3] = L[o + 11];
      }
      geo.setAttribute("aWin", new THREE.InstancedBufferAttribute(win, 4));
      im.castShadow = true; im.receiveShadow = true;
      // bounding sphere for culling: the tile's footprint and its tallest piece
      let top = 0; for (let i = 0; i < n; i++) top = Math.max(top, L[i * 12 + 1] + L[i * 12 + 4]);
      geo.boundingSphere = new THREE.Sphere(V3(T.x, top / 2, T.z), Math.hypot(TILE * 0.75, top / 2) + 120);
      im.userData.tile = T;
      grp.add(im); out.push(im);
    }
    return out;
  };

  /** Collision: tallest roof per 30 m cell, from the same footprints as the visible towers. */
  K.grid = function (B) {
    const CELL = 30, G = new Map(), F = B.foot;
    for (let i = 0; i < F.length; i += 4) {
      const x = F[i], z = F[i + 1], r = F[i + 2], top = F[i + 3];
      for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const cx = (gx + 0.5) * CELL, cz = (gz + 0.5) * CELL; if (Math.hypot(cx - x, cz - z) > r + CELL * 0.4) continue;
        const k = gx * 73856093 ^ gz * 19349663; const v = G.get(k); if (v == null || v < top) G.set(k, top);
      }
    }
    return (x, z) => { const v = G.get(Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663); return v == null ? -Infinity : v; };
  };

  /** The skyline on the horizon: the tall towers as one hazed mesh on the far layer. */
  K.farSkyline = function (B, scene, layer) {
    const T = B.tall, n = T.length / 6; if (!n) return null;
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      const x = T[i * 6], z = T[i * 6 + 1], r = T[i * 6 + 2], y = T[i * 6 + 3], h = T[i * 6 + 4], b = pos.length / 3;
      for (const [dx, dz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { pos.push(x + dx, y, z + dz); pos.push(x + dx, y + h, z + dz); }
      for (let k = 0; k < 4; k++) { const a = b + k * 2, c = b + ((k + 1) % 4) * 2; idx.push(a, c, a + 1, a + 1, c, c + 1); }
      idx.push(b + 1, b + 3, b + 5, b + 1, b + 5, b + 7);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x6c7684, fog: false, side: THREE.DoubleSide }));
    m.layers.set(layer); m.frustumCulled = false; scene.add(m);
    return m;
  };

  /* ======================= streets, lamps and traffic ======================= */
  /** Street grid under the flat core: asphalt, sidewalks, lane marks; lamps and lit avenues at night. */
  K.streets = function (grp, S, o) {
    const R = o.R, g = new THREE.CircleGeometry(R, 96); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = NIGHT;
      sh.uniforms.rjO = { value: new THREE.Vector4(S.x, S.z, S.sx, S.sz) };
      sh.uniforms.rjG = { value: new THREE.Vector4(o.block, o.aveEvery, o.street, R) };
      sh.uniforms.rjLamp = { value: new THREE.Color(o.lamp || 0xffb066) };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSW;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSW; uniform float rjNight; uniform vec4 rjO; uniform vec4 rjG; uniform vec3 rjLamp;")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "vec2 rel = vSW.xz - rjO.xy; vec2 sp = vec2(dot(rel, rjO.zw), dot(rel, vec2(-rjO.w, rjO.z)));",
          "float B = rjG.x, Wd = rjG.z;",
          "vec2 cellc = sp / B, f = fract(cellc), id = floor(cellc);",
          "vec2 dEdge = min(f, 1.0 - f) * B;",                                  // metres to the nearest street centre line
          "float aveS = 1.0 - step(0.5, mod(id.x, rjG.y)) ; float aveP = 1.0 - step(0.5, mod(id.y, rjG.y));",
          "float wS = Wd * (1.0 + aveS * 0.8), wP = Wd * (1.0 + aveP * 0.8);",
          "float roadS = 1.0 - step(wS * 0.5, dEdge.x), roadP = 1.0 - step(wP * 0.5, dEdge.y);",
          "float road = max(roadS, roadP);",
          "float walk = max(1.0 - step(wS * 0.5 + 4.0, dEdge.x), 1.0 - step(wP * 0.5 + 4.0, dEdge.y)) * (1.0 - road);",
          "vec3 blockC = vec3(0.36, 0.36, 0.35);",
          "if (road < 0.5 && walk < 0.5) discard;",                             // only streets and sidewalks: the ground shows through the blocks
          "diffuseColor.rgb = road > 0.5 ? vec3(0.13, 0.135, 0.145) : vec3(0.55, 0.54, 0.52);",
          "float lane = road * (1.0 - step(0.25, abs(dEdge.x - 0.0))) * roadS + road * (1.0 - step(0.25, abs(dEdge.y))) * roadP;",
          "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.75, 0.5), lane * step(0.5, fract((sp.x + sp.y) / 9.0)) * 0.7);",
          // lamps: bright pools along each street edge, every 32 m
          "float lp = min(abs(dEdge.x - wS * 0.5 - 1.0) + abs(fract(sp.y / 32.0) - 0.5) * 32.0, abs(dEdge.y - wP * 0.5 - 1.0) + abs(fract(sp.x / 32.0) - 0.5) * 32.0);",
          "totalEmissiveRadiance += rjLamp * (exp(-lp * lp * 0.02) * 1.6 + road * 0.07 + (aveS + aveP) * road * 0.05) * rjNight;",
          "float edge = smoothstep(rjG.w * 0.88, rjG.w, length(rel)); diffuseColor.a *= 1.0 - edge;"
        ].join("\n"));
    };
    m.transparent = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(S.x, S.elev + 0.35, S.z); mesh.receiveShadow = true; mesh.renderOrder = 1;
    grp.add(mesh);
    return mesh;
  };

  /** Cars as light points moving along the street grid (and any extra paths: highways, bridges). */
  K.traffic = function (grp, S, o, paths) {
    const N = o.cars || 500, geo = new THREE.BoxGeometry(1.9, 1.4, 4.6); geo.translate(0, 0.7, 0);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const im = new THREE.InstancedMesh(geo, mat, N); im.frustumCulled = false;
    const cars = [], col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const path = paths[Math.floor(Math.random() * paths.length)];
      const dir = Math.random() < 0.5 ? 1 : -1;
      cars.push({ path, t: Math.random(), v: RJ.rand(11, 22) / path.len, dir, lane: dir * RJ.rand(2, 4.5) });
      im.setColorAt(i, col.setHex(dir > 0 ? 0xfff2d8 : 0xff3020));
    }
    grp.add(im);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3(1, 1, 1), Y = V3(0, 1, 0);
    return {
      im,
      update(dt, near) {
        im.visible = near;
        if (!near) return;
        const k = 0.35 + NIGHT.value * 1.8; mat.color.setRGB(k, k, k);
        for (let i = 0; i < N; i++) {
          const c = cars[i], P = c.path;
          c.t = (c.t + c.v * dt * c.dir + 1) % 1;
          const x = P.ax + (P.bx - P.ax) * c.t + P.nx * c.lane, z = P.az + (P.bz - P.az) * c.t + P.nz * c.lane;
          p.set(x, P.y0 + (P.y1 - P.y0) * c.t, z); q.setFromAxisAngle(Y, P.yaw + (c.dir < 0 ? Math.PI : 0));
          m4.compose(p, q, s); im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
      }
    };
  };
  K.path = (ax, az, bx, bz, y0, y1) => { const L = Math.hypot(bx - ax, bz - az) || 1; return { ax, az, bx, bz, y0, y1: y1 != null ? y1 : y0, len: L, nx: (bz - az) / L, nz: -(bx - ax) / L, yaw: Math.atan2(-(bx - ax), -(bz - az)) }; };

  /** Neon billboards stuck to tower faces. */
  K.neon = function (grp, list) {
    if (!list.length) return null;
    const g = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(g, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach((b, i) => { m4.compose(V3(b.x, b.y, b.z), q.setFromAxisAngle(V3(0, 1, 0), b.ry), V3(b.w, b.h, 1)); im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(b.col)); });
    grp.add(im);
    return { im, update() { const k = 0.45 + NIGHT.value * 2.4; mat.color.setRGB(k, k, k); } };
  };

  /* ======================= bridges ======================= */
  /** Suspension (or cable-stayed) bridge from a to b: deck, two towers, cables, hangers. Returns oriented solids. */
  K.bridge = function (grp, a, b, o) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ang = Math.atan2(ux, uz);
    const deck = o.deck, W = o.width || 30, H = o.towerH, col = o.color || 0xd8d8d0;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.3 });
    const solids = [];
    const piece = (geo, x, y, z, ry) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; grp.add(m); return m; };
    const mid = V3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    piece(new THREE.BoxGeometry(W, 4, L), mid.x, deck - 2, mid.z, ang);
    solids.push({ x: mid.x, z: mid.z, ux, uz, hl: L / 2, hw: W / 2, y0: deck - 5, y1: deck + 3 });
    const tw = [0.24, 0.76], cablePts = [[], []];
    for (const f of tw) {
      const tx = a.x + dx * f, tz = a.z + dz * f;
      for (const s of [-1, 1]) {
        const px = tx + uz * s * W * 0.55, pz = tz - ux * s * W * 0.55;
        piece(new THREE.BoxGeometry(5, H, 5), px, H / 2, pz, ang);
        solids.push({ x: px, z: pz, ux, uz, hl: 3, hw: 3, y0: 0, y1: H });
      }
      piece(new THREE.BoxGeometry(W * 1.2, 5, 5), tx, H - 6, tz, ang); piece(new THREE.BoxGeometry(W * 1.2, 4, 4), tx, deck + 18, tz, ang);
    }
    // main cables (parabolic between towers, straight to the anchorages) and the hangers
    const cmat = new THREE.LineBasicMaterial({ color: 0x777b80 });
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const f = i / 60, x = a.x + dx * f + uz * s * W * 0.55, z = a.z + dz * f - ux * s * W * 0.55;
        let y;
        if (f < tw[0]) y = deck + (H - deck) * (f / tw[0]);
        else if (f > tw[1]) y = deck + (H - deck) * ((1 - f) / (1 - tw[1]));
        else { const t = (f - tw[0]) / (tw[1] - tw[0]); y = deck + 6 + (H - deck - 6) * Math.pow(2 * t - 1, 2); }
        pts.push(V3(x, y, z));
      }
      grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cmat));
      const hg = []; for (let i = 2; i < 59; i += 2) { hg.push(pts[i].clone(), V3(pts[i].x, deck, pts[i].z)); }
      grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(hg), cmat));
    }
    return { solids, mid: V3(mid.x, deck, mid.z), dir: V3(ux, 0, uz), len: L, deck };
  };
  /** Point inside any oriented solid {x,z,ux,uz,hl,hw,y0,y1}? */
  K.inSolids = (S, p) => { for (const s of S) { const dx = p.x - s.x, dz = p.z - s.z, u = dx * s.ux + dz * s.uz, v = -dx * s.uz + dz * s.ux; if (Math.abs(u) < s.hl && Math.abs(v) < s.hw && p.y > s.y0 && p.y < s.y1) return true; } return false; };

  /* ======================= race route ======================= */
  /** Lift each gate so the straight line from the previous gate clears the city (heightAt) by `clear` metres. */
  K.clearRoute = function (pts, heightAt, clear) {
    // a gate inside a building or hill: slide it sideways to open air at the same height, else lift it clear
    for (const p of pts) {
      if (p.tight || heightAt(p.x, p.z) <= p.y - 18) continue;
      let ok = false;
      for (let r = 30; r <= 240 && !ok; r += 30) for (let k = 0; k < 12 && !ok; k++) {
        const x = p.x + Math.cos(k / 12 * TAU) * r, z = p.z + Math.sin(k / 12 * TAU) * r;
        if (heightAt(x, z) < p.y - 30) { p.x = x; p.z = z; ok = true; }
      }
      if (!ok) p.y = heightAt(p.x, p.z) + clear;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (b.keep || b.tight) continue;
      for (let s = 0.1; s <= 1.0; s += 0.1) {
        const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s, y = a.y + (b.y - a.y) * s, h = heightAt(x, z) + clear;
        if (y < h) b.y += (h - y) / s;
      }
    }
    return pts;
  };
})(window.RJ);
