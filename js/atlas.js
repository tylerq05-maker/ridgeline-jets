/* Ridgeline Jets — landmarks ("the atlas").
 * Builds every discoverable landmark at the spots chosen by atlas-plan.js, wires their terrain sites
 * (flattened pads, a carved lake basin), collision, night lighting and discovery tracking.
 * Landmarks are part of the persistent world: they exist in every mode once the atlas is built. */
(function (RJ) {
  "use strict";
  const A = (RJ.atlas = { list: [], byId: {}, built: false });
  const V3 = RJ.V3, TAU = Math.PI * 2;

  A.DEFS = [
    { id: "castle", name: "Highkeep Castle", sub: "A fortress crowning the summit ridge", icon: "castle", r: 2600, xp: 250 },
    { id: "dam", name: "The Great Dam", sub: "Concrete wall holding back a mountain reservoir", icon: "dam", r: 1900, xp: 250 },
    { id: "arch", name: "The Stone Arch", sub: "Fly through the eye of the rock", icon: "arch", r: 1500, xp: 200 },
    { id: "lighthouse", name: "Sea Cliff Lighthouse", sub: "Guarding the headland since before the jets", icon: "light", r: 1600, xp: 200 },
    { id: "bridge", name: "The Canyon Bridge", sub: "Suspended high above the river gorge", icon: "bridge", r: 1800, xp: 250 },
    { id: "wreck", name: "The Crashed Bomber", sub: "A B-52 that never made it home", icon: "wreck", r: 1400, xp: 300 },
    { id: "airbase", name: "The Hidden Airbase", sub: "A secret strip hemmed in by mountains", icon: "base", r: 2200, xp: 300 },
    { id: "lake", name: "Alpine Lake", sub: "Still water in a high mountain basin", icon: "lake", r: 1800, xp: 200 },
    { id: "carrier", name: "The Coastal Carrier", sub: "Supercarrier at anchor offshore", icon: "ship", r: 2400, xp: 300 },
    { id: "summit", name: "The Mountain Summit", sub: "The highest point in the range", icon: "peak", r: 700, xp: 300 }
  ];

  /* ---------------- small helpers ---------------- */
  const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
  }
  const frame = (x, z, rot) => {
    const c = Math.cos(rot), n = Math.sin(rot);
    return { toLocal: (wx, wz) => { const dx = wx - x, dz = wz - z; return [dx * c - dz * n, dx * n + dz * c]; }, toWorld: (lx, lz) => [x + lx * c + lz * n, z - lx * n + lz * c] };
  };
  const std = (color, rough = 0.85, metal = 0, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra || {}));
  const nightK = () => RJ.clamp(1 - RJ.smooth(-3, 10, RJ.world.sunElev), 0, 1);
  function lampMesh(points, scale) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(scale || 0.6, 6, 4), m, Math.max(1, points.length / 3)), m4 = new THREE.Matrix4();
    for (let i = 0; i < points.length / 3; i++) { m4.makeTranslation(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]); im.setMatrixAt(i, m4); }
    im.count = points.length / 3;
    return { mesh: im, mat: m };
  }

  /* ======================= GREAT DAM ======================= */
  function buildDam(s) {
    const gen = RJ.world.gen, U = RJ.castle.util;
    const ax = Math.cos(s.th), az = Math.sin(s.th);
    let nx = -az, nz = ax;
    const floorAt = (d) => { let m = 1e9; for (const o of [-80, 0, 80]) m = Math.min(m, gen.height(s.x + nx * d + ax * o, s.z + nz * d + az * o)); return m; };
    if (floorAt(-900) < floorAt(900)) { nx = -nx; nz = -nz; } // local +z points downstream
    const rot = Math.atan2(nx, nz), F = frame(s.x, s.z, rot);
    const grp = new THREE.Group(); grp.position.set(s.x, s.wl, s.z); grp.rotation.y = rot;
    const hs = s.span / 2 + 10, Hc = s.crest - s.wl, bulge = hs * 0.16, ext = 70;
    const zc = (x) => -bulge * (1 - Math.min(1, (x / hs) * (x / hs)));
    const th = (y) => 9 + 34 * (1 - RJ.clamp(y / Hc, 0, 1));
    // arch-gravity wall: upstream face, downstream face, crest, ends
    const NX = 48, NY = 14, pos = [], idx = [];
    const vid = (i, j, f) => (f * (NX + 1) + i) * (NY + 1) + j;
    for (let f = 0; f < 2; f++) for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) {
      const x = -hs - ext + (2 * (hs + ext) * i) / NX, y = -30 + ((Hc + 30) * j) / NY;
      pos.push(x, y, zc(x) + (f ? th(y) : 0));
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const a = vid(i, j, 0), b = vid(i + 1, j, 0), c = vid(i, j + 1, 0), d = vid(i + 1, j + 1, 0);
      idx.push(a, c, b, b, c, d);
      const a2 = vid(i, j, 1), b2 = vid(i + 1, j, 1), c2 = vid(i, j + 1, 1), d2 = vid(i + 1, j + 1, 1);
      idx.push(a2, b2, c2, b2, d2, c2);
    }
    for (let i = 0; i < NX; i++) { const a = vid(i, NY, 0), b = vid(i + 1, NY, 0), c = vid(i, NY, 1), d = vid(i + 1, NY, 1); idx.push(a, c, b, b, c, d); }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.setIndex(idx);
    const wgn = wg.toNonIndexed(); wgn.computeVertexNormals();
    // poured concrete: faint horizontal lift lines and water staining, no masonry blocks (they alias into moiré at range)
    const concrete = std(0xb4afa3, 0.92);
    concrete.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDmP;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvDmP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vDmP;\n" + RJ.world.GLSL_NOISE)
        .replace("#include <roughnessmap_fragment>", [
          "#include <roughnessmap_fragment>",
          "{ float lift = fract(vDmP.y / 2.4);",
          "#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)",
          "  float fw = max(fwidth(vDmP.y / 2.4), 1e-4);",
          "#else",
          "  float fw = length(vViewPosition) * 0.0006;",
          "#endif",
          "  float line = (1.0 - smoothstep(0.0, fw * 1.5, min(lift, 1.0 - lift))) * (1.0 - smoothstep(0.15, 0.5, fw));",
          "  float stain = rjVN(vec2((vDmP.x + vDmP.z) * 0.08, vDmP.y * 0.012));",
          "  diffuseColor.rgb *= (1.0 - line * 0.18) * (0.82 + 0.22 * stain); }"
        ].join("\n"));
      RJ.world.addCloudShadows(sh, "vDmP");
    };
    concrete.customProgramCacheKey = () => "rj-dam-concrete";
    const wall = new THREE.Mesh(wgn, concrete); wall.castShadow = wall.receiveShadow = true; grp.add(wall);
    // crest road, parapets, lamp posts and intake towers
    const S = [];
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const x0 = -hs - 20 + (2 * (hs + 20) * i) / segs, x1 = -hs - 20 + (2 * (hs + 20) * (i + 1)) / segs, xm = (x0 + x1) / 2;
      const ang = Math.atan2(zc(x1) - zc(x0), x1 - x0);
      for (const zo of [0.6, 8.4]) U.put(S, new THREE.BoxGeometry(x1 - x0 + 0.3, 1.3, 0.6), xm, Hc + 0.65, zc(xm) + zo, -ang);
    }
    const lamps = [];
    for (let x = -hs; x <= hs; x += 28) { U.put(S, new THREE.CylinderGeometry(0.2, 0.25, 7, 5), x, Hc + 3.5, zc(x) + 8.4); lamps.push(x, Hc + 7.2, zc(x) + 8.4); }
    for (const x of [-hs * 0.35, hs * 0.35]) { U.put(S, new THREE.CylinderGeometry(6, 7, Hc + 18, 16), x, (Hc - 18) / 2 + 9, zc(x) - 22); U.put(S, new THREE.CylinderGeometry(7.5, 7.5, 3, 16), x, Hc + 10, zc(x) - 22); }
    const extra = new THREE.Mesh(U.merge(S), concrete); extra.castShadow = true; grp.add(extra);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(2 * hs + 40, 7.2, 24, 1), std(0x2e3033, 0.95));
    const rp = road.geometry.attributes.position;
    for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i); rp.setXYZ(i, x, Hc + 0.06, zc(x) + 4.5 - y); }
    road.geometry.computeVertexNormals(); grp.add(road);
    const L = lampMesh(lamps, 0.5); grp.add(L.mesh);
    // spillway: water pouring over the centre and down the downstream face
    const fall = [], fuv = [], fidx = [], K = 16, sw = 46;
    for (let k = 0; k <= K; k++) {
      const t = k / K, y = Hc - 1 - (Hc + 1) * t;
      for (const sd of [-0.5, 0.5]) { const x = sd * sw; fall.push(x, y, zc(x) + th(y) + 1.2 + t * 6); fuv.push(sd + 0.5, t); }
      if (k < K) { const a = k * 2; fidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(fall, 3)); fg.setAttribute("uv", new THREE.Float32BufferAttribute(fuv, 2)); fg.setIndex(fidx);
    const fm = new THREE.Mesh(fg, RJ.world.fallMat); fm.renderOrder = 3; grp.add(fm);
    // reservoir: flood the upstream valley from the dam face, lowering the level until it is contained
    const cell = 30, RAD = 2600, NG = Math.ceil(RAD / cell);
    let level = s.crest - 5, flood = null;
    for (let tries = 0; tries < 9; tries++) {
      const seen = new Uint8Array((2 * NG + 1) * (2 * NG + 1)), q = [];
      const id = (i, j) => (j + NG) * (2 * NG + 1) + (i + NG);
      let leak = false;
      const si = 0, sj = Math.round((zc(0) - 50) / cell);
      q.push([si, sj]); seen[id(si, sj)] = 1;
      let n = 0;
      while (q.length && !leak) {
        const [i, j] = q.pop(); n++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (Math.abs(a) > NG || Math.abs(b) > NG) { leak = true; break; }
          if (seen[id(a, b)]) continue;
          const lx = a * cell, lz = b * cell;
          if (lz > zc(lx) + 1) continue;
          if (a * a + b * b > NG * NG) { leak = true; break; }
          const [wx, wz] = F.toWorld(lx, lz);
          if (gen.height(wx, wz) > level - 0.4) continue;
          seen[id(a, b)] = 1; q.push([a, b]);
        }
      }
      if (!leak && n > 20) { flood = { seen, id, NG }; break; }
      level -= 14;
      if (level < s.wl + 25) break;
    }
    const lm = { group: grp, frame: F, s, hs, Hc, zc, th, lamps: L, mistT: 0, rot };
    if (flood) {
      const wpos = [], winfo = [], wi = [];
      const { seen, id, NG: G } = flood;
      for (let j = -G; j <= G; j++) for (let i = -G; i <= G; i++) {
        if (!seen[id(i, j)]) continue;
        const b = wpos.length / 3;
        for (const [ci, cj] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const lx = (i + ci * 1.08) * cell, lz = (j + cj * 1.08) * cell;
          const [wx, wz] = F.toWorld(lx, lz);
          wpos.push(lx, level - s.wl, lz); winfo.push(Math.max(0.5, level - gen.height(wx, wz)), 0.25);
        }
        wi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3)); rg.setAttribute("winfo", new THREE.Float32BufferAttribute(winfo, 2)); rg.setIndex(wi);
      rg.computeBoundingSphere();
      const rm = new THREE.Mesh(rg, RJ.world.waterMat); rm.layers.set(1); rm.renderOrder = 2; grp.add(rm);
      lm.flood = flood; lm.level = level; lm.cell = cell;
    }
    lm.heightAt = (x, z) => {
      const [lx, lz] = F.toLocal(x, z);
      if (Math.abs(lx) > hs + ext || lz > 60 || lz < -2700) return -Infinity;
      const z0 = zc(lx), d = lz - z0;
      if (d >= -1 && d <= th(0) + 1) return s.wl + (d <= 9 ? Hc + 1.3 : Hc * (1 - (d - 9) / 34));
      if (lm.flood && d < -1) { const i = Math.round(lx / cell), j = Math.round(lz / cell), G = lm.flood.NG; if (Math.abs(i) <= G && Math.abs(j) <= G && lm.flood.seen[lm.flood.id(i, j)]) return lm.level; }
      return -Infinity;
    };
    lm.waterAt = (x, z) => { if (!lm.flood) return false; const [lx, lz] = F.toLocal(x, z); const i = Math.round(lx / cell), j = Math.round(lz / cell), G = lm.flood.NG; return Math.abs(i) <= G && Math.abs(j) <= G && !!lm.flood.seen[lm.flood.id(i, j)]; };
    lm.marker = V3(s.x, s.crest + 20, s.z);
    lm.update = (dt, cam) => {
      const k = nightK(); L.mat.color.setRGB(2.6, 2.3, 1.7).multiplyScalar(0.05 + k);
      lm.mistT += dt;
      if (lm.mistT > 0.12 && cam && cam.position.distanceTo(lm.marker) < 6000 && RJ.fx.mist) {
        lm.mistT = 0;
        const [wx, wz] = F.toWorld(0, zc(0) + th(0) + 14);
        RJ.fx.mist(V3(wx, s.wl + 4, wz), sw);
      }
    };
    return lm;
  }

  /* ======================= STONE ARCH ======================= */
  function buildArch(s) {
    const R = 120, T = 30, ZS = 1.35;
    const rot = Math.atan2(Math.cos(s.face), Math.sin(s.face)), F = frame(s.x, s.z, rot);
    const grp = new THREE.Group(); grp.position.set(s.x, s.elev, s.z); grp.rotation.y = rot;
    const geo = new THREE.TorusGeometry(R, T, 26, 110, Math.PI);
    const P = geo.attributes.position, col = [];
    const cA = new THREE.Color(0.62, 0.42, 0.3), cB = new THREE.Color(0.76, 0.58, 0.42), cC = new THREE.Color(0.48, 0.36, 0.3), cc = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i) * ZS;
      const ang = Math.atan2(y, x), cx = Math.cos(ang) * R, cy = Math.sin(ang) * R;
      let nx = x - cx, ny = y - cy, nz = z; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const d = (vnoise(x * 0.025, y * 0.025, z * 0.025) - 0.5) * 30 + (vnoise(x * 0.09, y * 0.09, z * 0.09) - 0.5) * 12 + (vnoise(x * 0.3, y * 0.3, z * 0.3) - 0.5) * 4
        + Math.sin(y * 0.18 + vnoise(x * 0.01, 0, z * 0.01) * 4) * 3; // weathered ledges
      x += nx * d; y += ny * d; z += nz * d;
      if (y < -4) y = -4 - (y + 4) * 0.2;
      P.setXYZ(i, x, y, z);
      const band = 0.5 + 0.5 * Math.sin(y * 0.11 + vnoise(x * 0.02, 0, z * 0.02) * 3);
      cc.copy(cA).lerp(cB, band).lerp(cC, RJ.clamp(vnoise(x * 0.05, y * 0.05, z * 0.05) - 0.3, 0, 0.6));
      col.push(cc.r, cc.g, cc.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const ng = geo.toNonIndexed(); ng.computeVertexNormals();
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const arch = new THREE.Mesh(ng, rock); arch.castShadow = arch.receiveShadow = true; grp.add(arch);
    // fallen boulders and a buried plinth under each leg
    for (let k = 0; k < 9; k++) {
      const side = k % 2 ? 1 : -1, r = 6 + hash(k, 3, 7) * 16;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x8a6448, roughness: 1, flatShading: true }));
      b.position.set(side * (R + (hash(k, 1, 1) - 0.3) * 70), r * 0.3, (hash(k, 2, 2) - 0.5) * 120); b.rotation.set(k, k * 2, k * 3);
      b.castShadow = true; grp.add(b);
    }
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(T * 1.2, T * 1.6, 40, 10), rock); p.position.set(sd * R, -16, 0); grp.add(p); }
    const lm = { group: grp, frame: F, s, R, T, ZS };
    lm.solidAt = (p) => {
      const [lx, lz] = F.toLocal(p.x, p.z), ly = p.y - s.elev;
      if (ly < -2 || Math.abs(lz) > T * ZS + 20 || Math.abs(lx) > R + T + 20) return false;
      const rho = Math.hypot(lx, ly);
      return Math.hypot(rho - R, lz / ZS) < T * 0.88;
    };
    lm.marker = V3(s.x, s.elev + R + T + 10, s.z);
    lm.gate = { frame: F, y0: s.elev, rIn: R - T - 4 };
    return lm;
  }

  /* ======================= LIGHTHOUSE ======================= */
  const BEAM_VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  const BEAM_FS = "uniform float strength; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * (1.0 - vUv.y) * strength; gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * a, a); }";
  function buildLighthouse(s) {
    const rot = s.seaDir, F = frame(s.x, s.z, rot);
    const grp = new THREE.Group(); grp.position.set(s.x, s.elev, s.z); grp.rotation.y = rot; grp.scale.setScalar(1.6);
    const white = std(0xeeeae2, 0.6), red = std(0xb2302a, 0.6), dark = std(0x2d3236, 0.5, 0.5);
    const H = 42, segs = 7;
    for (let i = 0; i < segs; i++) {
      const y0 = (i / segs) * H, y1 = ((i + 1) / segs) * H, r0 = 6.6 - (y0 / H) * 2, r1 = 6.6 - (y1 / H) * 2;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 24), i % 2 ? red : white);
      m.position.y = (y0 + y1) / 2; m.castShadow = true; grp.add(m);
    }
    const gal = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 1, 24), dark); gal.position.y = H + 0.5; grp.add(gal);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(6, 0.12, 4, 32), dark); rail.rotation.x = Math.PI / 2; rail.position.y = H + 2; grp.add(rail);
    const lampM = std(0x332a10, 0.1, 0.2, { emissive: 0xffd27a, emissiveIntensity: 0.3, transparent: true, opacity: 0.85 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 16), lampM); lantern.position.y = H + 3.5; grp.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.5, 16), red); roof.position.y = H + 7.75; grp.add(roof);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), dark); ball.position.y = H + 10; grp.add(ball);
    // keeper's cottage
    const U = RJ.castle.util;
    const house = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), white); house.position.set(-16, 3.5, -6); house.castShadow = true; grp.add(house);
    const hr = new THREE.Mesh(U.prism(11.5, 4, 15.5), red); hr.geometry.rotateY(Math.PI / 2); hr.position.set(-16, 7, -6); grp.add(hr);
    // rotating beams
    const beamM = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: { strength: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beamG = new THREE.ConeGeometry(36, 700, 16, 1, true); beamG.translate(0, -350, 0); beamG.rotateZ(Math.PI / 2);
    const spin = new THREE.Group(); spin.position.y = H + 3.5; grp.add(spin);
    for (const sd of [0, Math.PI]) { const b = new THREE.Mesh(beamG, beamM); b.rotation.y = sd; b.layers.set(RJ.LATE); b.frustumCulled = false; spin.add(b); }
    const glowM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), glowM); glow.position.y = H + 3.5; grp.add(glow);
    const lm = { group: grp, frame: F, s };
    lm.heightAt = (x, z) => {
      const [lx, lz] = F.toLocal(x, z);
      if (Math.hypot(lx, lz) < 6.8 * 1.6) return s.elev + (H + 11) * 1.6;
      if (Math.abs(lx + 16 * 1.6) < 7.5 * 1.6 && Math.abs(lz + 6 * 1.6) < 5.5 * 1.6) return s.elev + 11 * 1.6;
      return -Infinity;
    };
    lm.marker = V3(s.x, s.elev + H * 1.6 + 30, s.z);
    lm.update = (dt) => {
      spin.rotation.y += dt * 0.9;
      const k = nightK();
      beamM.uniforms.strength.value = 0.03 + k * 0.42;
      lampM.emissiveIntensity = 0.3 + k * 3;
      glowM.color.setRGB(4, 3.4, 2).multiplyScalar(0.1 + k);
    };
    return lm;
  }

  /* ======================= CANYON BRIDGE ======================= */
  function buildBridge(s) {
    const gen = RJ.world.gen, U = RJ.castle.util;
    const rot = -s.th, F = frame(s.x, s.z, rot);
    const grp = new THREE.Group(); grp.position.set(s.x, s.deck, s.z); grp.rotation.y = rot;
    const orange = std(0xb8402e, 0.55, 0.35), steel = std(0x5a5f63, 0.5, 0.6), road = std(0x2b2d2f, 0.95);
    const span = s.span, Ld = span + 60, xt = span / 2 - 20, TH = 96;
    const parts = [], dparts = [];
    U.put(dparts, new THREE.BoxGeometry(Ld, 1.2, 22), 0, -0.6, 0);
    for (const z of [-12, 12]) U.put(parts, new THREE.BoxGeometry(Ld, 6, 1.2), 0, -4, z);
    for (let x = -Ld / 2 + 6; x < Ld / 2; x += 12) { U.put(parts, new THREE.BoxGeometry(1, 1, 24), x, -7, 0); const d = new THREE.BoxGeometry(14, 0.6, 0.6); d.rotateZ(0.42); U.put(parts, d, x, -4, -12); const d2 = d.clone(); U.put(parts, d2, x, -4, 12); }
    const towerParts = [];
    const groundY = (lx, lz) => { const [wx, wz] = F.toWorld(lx, lz); return gen.height(wx, wz) - s.deck; };
    const legs = [];
    for (const sx of [-xt, xt]) {
      const gb = Math.min(groundY(sx, -11), groundY(sx, 11), -10) - 6;
      for (const z of [-11, 11]) { U.put(towerParts, new THREE.BoxGeometry(4.5, TH - gb, 4.5), sx, (TH + gb) / 2, z); legs.push({ x: sx, z, y0: gb }); }
      for (const y of [TH * 0.42, TH * 0.86, TH - 1]) U.put(towerParts, new THREE.BoxGeometry(4, 3.5, 26), sx, y, 0);
      U.put(towerParts, new THREE.BoxGeometry(8, 10, 30), sx, gb + 5, 0);
    }
    // main cables: parabolic between the towers, straight back-spans to anchors on the rims
    const cableY = (x) => Math.abs(x) <= xt ? 9 + (TH - 9) * (x / xt) * (x / xt) : TH - (TH - (groundY(Math.sign(x) * (xt + 130), 0) + 3)) * ((Math.abs(x) - xt) / 130);
    const hangers = [];
    for (const z of [-11, 11]) {
      const pts = [];
      for (let k = 0; k <= 60; k++) { const x = -(xt + 130) + (2 * (xt + 130) * k) / 60; pts.push(new THREE.Vector3(x, cableY(x), z)); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.9, 6), orange); tube.castShadow = true; grp.add(tube);
      for (let x = -xt + 12; x < xt; x += 12) hangers.push(x, z, cableY(x));
    }
    const hg = new THREE.CylinderGeometry(0.18, 0.18, 1, 4); hg.translate(0, 0.5, 0);
    const him = new THREE.InstancedMesh(hg, steel, hangers.length / 3), m4 = new THREE.Matrix4();
    for (let i = 0; i < hangers.length / 3; i++) { m4.makeScale(1, hangers[i * 3 + 2], 1).setPosition(hangers[i * 3], 0, hangers[i * 3 + 1]); him.setMatrixAt(i, m4); }
    grp.add(him);
    const tm = new THREE.Mesh(U.merge(towerParts), orange); tm.castShadow = tm.receiveShadow = true; grp.add(tm);
    const sm = new THREE.Mesh(U.merge(parts), orange); sm.castShadow = true; grp.add(sm);
    const dm = new THREE.Mesh(U.merge(dparts), road); dm.receiveShadow = dm.castShadow = true; grp.add(dm);
    const lamps = [];
    for (let x = -Ld / 2 + 10; x < Ld / 2; x += 24) for (const z of [-10.5, 10.5]) lamps.push(x, 4, z);
    for (const sx of [-xt, xt]) for (const z of [-11, 11]) lamps.push(sx, TH + 2.5, z);
    const L = lampMesh(lamps, 0.55); grp.add(L.mesh);
    const lm = { group: grp, frame: F, s, xt, TH, Ld };
    lm.solidAt = (p) => {
      const [lx, lz] = F.toLocal(p.x, p.z), ly = p.y - s.deck;
      if (Math.abs(lx) > Ld / 2 + 140 || Math.abs(lz) > 20) return false;
      if (Math.abs(lx) < Ld / 2 && Math.abs(lz) < 13 && ly > -9 && ly < 1.5) return true;
      for (const g of legs) if (Math.abs(lx - g.x) < 3.2 && Math.abs(lz - g.z) < 3.2 && ly < TH + 1) return true;
      for (const sx of [-xt, xt]) if (Math.abs(lx - sx) < 3 && Math.abs(lz) < 13 && ((ly > TH * 0.42 - 2.5 && ly < TH * 0.42 + 2.5) || ly > TH * 0.86 - 2.5)) return ly < TH + 1;
      return false;
    };
    lm.underGate = { frame: F, xMin: -xt + 18, xMax: xt - 18, yMin: s.wl + 4, yMax: s.deck - 12 };
    lm.marker = V3(s.x, s.deck + TH + 20, s.z);
    lm.update = () => { L.mat.color.setRGB(2.8, 2.4, 1.6).multiplyScalar(0.04 + nightK()); };
    return lm;
  }

  /* ======================= CRASHED BOMBER ======================= */
  function buildWreck(s) {
    const F = frame(s.x, s.z, s.rot);
    const grp = new THREE.Group(); grp.position.set(s.x, s.elev, s.z); grp.rotation.y = s.rot;
    const char = (m) => { const c = m.clone(); c.color = (m.color ? m.color.clone() : new THREE.Color(0.3, 0.3, 0.3)).multiplyScalar(0.72).lerp(new THREE.Color(0.24, 0.21, 0.18), 0.35); c.roughness = 0.95; c.metalness = 0.25; if (c.emissive) c.emissive.setRGB(0, 0, 0); return c; };
    const piece = (keepFront, cut) => {
      const m = RJ.buildAircraft("b52");
      const d = m.userData.dims;
      RJ.setGear(m, 0);
      m.userData.flames.forEach((f) => { f.flame.visible = false; f.glow.visible = false; });
      if (m.userData.nav) m.userData.nav.meshes.forEach((x) => (x.visible = false));
      const plane = new THREE.Plane();
      m.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.material = char(o.material); o.material.clippingPlanes = [plane]; o.material.clipShadows = true; } });
      m.userData.cutPlane = plane; m.userData.keepFront = keepFront; m.userData.cut = cut; m.userData.d = d;
      return m;
    };
    const front = piece(true, 4), tail = piece(false, 4);
    front.position.set(0, -front.userData.d.minY - 2.4, 0); front.rotation.set(0.05, 0, 0.16);
    tail.position.set(14, -tail.userData.d.minY - 2.2, 34); tail.rotation.set(-0.08, 0.42, -0.3);
    grp.add(front, tail);
    grp.updateMatrixWorld(true);
    for (const m of [front, tail]) {
      // clip each copy at the break (local z = cut), keeping the front or the tail
      const n = new THREE.Vector3(0, 0, m.userData.keepFront ? -1 : 1).transformDirection(m.matrixWorld);
      const pt = new THREE.Vector3(0, 0, m.userData.cut).applyMatrix4(m.matrixWorld);
      m.userData.cutPlane.setFromNormalAndCoplanarPoint(n, pt);
    }
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshStandardMaterial({ color: 0x2a241d, roughness: 1, transparent: true, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.25; scorch.scale.set(1, 1.7, 1); grp.add(scorch);
    const deb = std(0x3c3a37, 1, 0.3);
    for (let k = 0; k < 26; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1 + hash(k, 1, 0) * 4, 0.3 + hash(k, 2, 0) * 1.5, 1 + hash(k, 3, 0) * 5), deb);
      b.position.set((hash(k, 4, 0) - 0.5) * 110, 0.3, (hash(k, 5, 0) - 0.3) * 160); b.rotation.set(hash(k, 6, 0), hash(k, 7, 0) * 6, hash(k, 8, 0)); b.castShadow = true; grp.add(b);
    }
    const lm = { group: grp, frame: F, s, smokeT: 0 };
    lm.heightAt = (x, z) => { const [lx, lz] = F.toLocal(x, z); return Math.abs(lx) < 4 && lz > -26 && lz < 60 ? s.elev + 6 : Math.abs(lz - 4) < 7 && Math.abs(lx) < 26 ? s.elev + 3 : -Infinity; };
    lm.marker = V3(s.x, s.elev + 40, s.z);
    lm.update = (dt, cam) => {
      lm.smokeT += dt;
      if (lm.smokeT > 0.22 && cam && cam.position.distanceTo(lm.marker) < 14000) {
        lm.smokeT = 0;
        const [wx, wz] = F.toWorld(2, 2);
        RJ.fx.smoke(V3(wx + RJ.rand(-4, 4), s.elev + 4, wz + RJ.rand(-4, 4)), V3(1.5, 5 + Math.random() * 2, 0.6), 9 + Math.random() * 5, 0.22, 16, 0.42);
      }
    };
    return lm;
  }

  /* ======================= ALPINE LAKE ======================= */
  function buildLake(s) {
    const gen = RJ.world.gen;
    const grp = new THREE.Group();
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU, x = s.x + Math.cos(a) * s.r * 1.14, z = s.z + Math.sin(a) * s.r * 1.14, h = gen.height(x, z);
      const sl = Math.abs(gen.height(x + 12, z) - gen.height(x - 12, z)) / 24;
      if (h > s.level + 1 && h < s.level + 30 && (!best || sl < best.sl)) best = { a, x, z, h, sl };
    }
    const lm = { group: grp, s };
    if (best) {
      const wood = std(0x6b4a30, 0.9), roofM = std(0x3a3532, 0.8);
      const cabin = new THREE.Group(); cabin.position.set(best.x + Math.cos(best.a) * 10, best.h, best.z + Math.sin(best.a) * 10); cabin.rotation.y = -best.a + Math.PI / 2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 7), wood); body.position.y = 2.25; body.castShadow = true; cabin.add(body);
      const rf = new THREE.Mesh(RJ.castle.util.prism(8.4, 3.2, 10), roofM); rf.geometry.rotateY(Math.PI / 2); rf.position.y = 4.5; cabin.add(rf);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: 0x000000 })); win.position.set(0, 2.4, 3.52); cabin.add(win);
      lm.win = win;
      grp.add(cabin);
      const dock = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 46), wood);
      dock.position.set(best.x - Math.cos(best.a) * 18, s.level + 0.8, best.z - Math.sin(best.a) * 18); dock.rotation.y = -best.a + Math.PI / 2; grp.add(dock);
    }
    lm.marker = V3(s.x, s.level + 120, s.z);
    lm.update = () => { if (lm.win) lm.win.material.color.setRGB(3, 1.8, 0.7).multiplyScalar(0.02 + nightK()); };
    return lm;
  }

  /* ======================= SUMMIT ======================= */
  function buildSummit(s) {
    const gen = RJ.world.gen;
    const grp = new THREE.Group(); grp.position.set(s.x, gen.height(s.x, s.z) - 0.6, s.z);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x77777a, roughness: 1, flatShading: true });
    for (let k = 0; k < 7; k++) { const r = 2.2 - k * 0.25; const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockM); b.position.set((hash(k, 1, 9) - 0.5) * 0.8, k * 1.4 + r * 0.6, (hash(k, 2, 9) - 0.5) * 0.8); b.rotation.set(k, k * 1.3, 0); b.castShadow = true; grp.add(b); }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9, 6), std(0xaaaaaa, 0.4, 0.8)); pole.position.y = 12; grp.add(pole);
    const fgeo = new THREE.PlaneGeometry(5, 3, 8, 3); fgeo.translate(2.5, 0, 0);
    const flag = new THREE.Mesh(fgeo, RJ.castle.util.flagMat(0xc8a030)); flag.position.y = 15; grp.add(flag);
    const beaconM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beaconM); beacon.position.y = 16.8; grp.add(beacon);
    const lm = { group: grp, s, t: 0 };
    lm.marker = V3(s.x, s.elev + 60, s.z);
    lm.update = (dt) => { lm.t += dt; beaconM.color.setRGB(lm.t % 1.6 < 0.2 ? 5 : 0.2, 0.15, 0.1); };
    return lm;
  }

  /* ======================= BUILD / QUERIES ======================= */
  /** Plan (once) and build all landmarks, and register their terrain sites. */
  A.ensure = function () {
    if (A.built) return;
    const W = RJ.world, gen = W.gen;
    gen.setSites([]);
    const reg = W.findRegion("mountains");
    const ab = W.planAirbase(reg.x, reg.z, reg.yaw);
    gen.setAirbase(W.airbase || null);
    A.home = { x: ab.x - ab.dx * (ab.len / 2 - 120), z: ab.z - ab.dz * (ab.len / 2 - 120), yaw: ab.yaw, ab };
    const castle = RJ.castle.plan(A.home.x, A.home.z, A.home.yaw);
    const P = RJ.atlasPlan(gen, A.home, castle);
    A.plan = P;
    const sites = [];
    if (P.arch) sites.push({ type: "flat", kind: "arch", x: P.arch.x, z: P.arch.z, r: 175, fall: 280, elev: P.arch.elev });
    if (P.lighthouse) sites.push({ type: "flat", kind: "lighthouse", x: P.lighthouse.x, z: P.lighthouse.z, r: 40, fall: 90, elev: P.lighthouse.elev });
    if (P.wreck) sites.push({ type: "flat", kind: "wreck", x: P.wreck.x, z: P.wreck.z, r: 120, fall: 260, elev: P.wreck.elev });
    if (P.airbase) sites.push(Object.assign({ type: "pad", kind: "airbase", fall: 480 }, P.airbase));
    if (P.lake) sites.push({ type: "lake", kind: "lake", x: P.lake.x, z: P.lake.z, r: P.lake.r, fall: P.lake.r * 0.7, level: P.lake.level, depth: 38, noClear: true });
    if (RJ.realms) RJ.realms.plan(gen, P, A.home, sites);
    if (RJ.cannon) RJ.cannon.plan(gen, A.home, sites);
    if (RJ.ye) RJ.ye.plan(gen, A.home, sites);
    if (RJ.cities) try { RJ.cities.plan(gen, A.home, sites); } catch (e) { console.warn("City placement failed", e); }
    W.castle = castle;
    W.setSites(sites);
    if (W.castleGroup) { W.scene.remove(W.castleGroup); RJ.castle.dispose(W.castleGroup); }
    W.castleGroup = RJ.castle.build(castle); W.scene.add(W.castleGroup);
    RJ.castle.site = castle;
    const add = (id, lm) => {
      const def = A.DEFS.find((d) => d.id === id);
      Object.assign(lm, { id, def });
      if (lm.group && !lm.group.parent) W.scene.add(lm.group);
      A.list.push(lm); A.byId[id] = lm;
    };
    add("castle", { group: W.castleGroup, s: castle, heightAt: RJ.castle.heightAt, solidAt: RJ.castle.solidAt, marker: V3(castle.x, castle.elev + 280, castle.z) });
    const tryB = (id, fn, site) => { if (!site) return; try { add(id, fn(site)); } catch (e) { console.warn("Landmark failed: " + id, e); } };
    tryB("dam", buildDam, P.dam);
    tryB("arch", buildArch, P.arch);
    tryB("lighthouse", buildLighthouse, P.lighthouse);
    tryB("bridge", buildBridge, P.bridge);
    tryB("wreck", buildWreck, P.wreck);
    if (P.airbase) tryB("airbase", (s) => { const g = W.buildAirbaseGroup(Object.assign({}, s)); return { group: g, s, marker: V3(s.x, s.elev + 120, s.z), update: () => { if (g.userData.lights) g.userData.lights.visible = W.sunElev < 12 || (W.WEATHER[W.env.weather] || {}).dark > 0.3; } }; }, P.airbase);
    tryB("lake", buildLake, P.lake);
    if (P.carrier && RJ.carrier) tryB("carrier", (s) => { const g = RJ.carrier.build(s); return { group: g, s, heightAt: RJ.carrier.heightAt, marker: V3(s.x, 80, s.z), deck: true }; }, P.carrier);
    tryB("summit", buildSummit, P.summit);
    if (RJ.realms) RJ.realms.build(add);
    if (RJ.cannon && RJ.cannon.site) tryB("cannon", () => RJ.cannon.build(), RJ.cannon.site);
    if (RJ.ye && RJ.ye.site) tryB("ye", () => RJ.ye.build(), RJ.ye.site);
    if (RJ.cities) for (const id in RJ.cities.sites) tryB(id, () => RJ.cities.lazy(id), RJ.cities.sites[id]);
    if (RJ.sf) try { RJ.sf.register(add); } catch (e) { console.warn("San Francisco failed", e); }
    if (RJ.nyc) {
      // New York builds lazily: the first time the camera comes within 45 km (or a flight starts there)
      const [cx, cz] = RJ.nyc.esbWorld();
      add("nyc", { group: null, cx, cz, marker: V3(cx, 600, cz), heightAt: RJ.nyc.heightAt, solidAt: (p) => RJ.nyc.ready && RJ.nyc.solidAtY(p),
        update: (dt, cam) => { if (!RJ.nyc.ready) { if (Math.hypot(cam.position.x - cx, cam.position.z - cz) < 45000) RJ.nyc.ensure(); else return; } RJ.nyc.update(dt, cam); } });
    }
    A.built = true;
    if (RJ.living) try { RJ.living.plan(); } catch (e) { console.warn("Living world failed", e); }
  };
  A.heightAt = function (x, z) {
    let h = -Infinity;
    for (const lm of A.list) if (lm.heightAt && lm.id !== "castle") { const v = lm.heightAt(x, z); if (v > h) h = v; }
    if (RJ.living && RJ.living.airports.length) { const v = RJ.living.heightAt(x, z); if (v > h) h = v; }
    return h;
  };
  A.solidAt = function (p) {
    if (RJ.living && RJ.living.solidAt(p)) return true;
    for (const lm of A.list) if (lm.solidAt && lm.solidAt(p)) return true;
    return false;
  };
  A.waterAt = function (x, z) { for (const lm of A.list) if (lm.waterAt && lm.waterAt(x, z)) return true; return false; };
  A.update = function (dt, cam) {
    if (RJ.realms) RJ.realms.timeU.value += dt;
    for (const lm of A.list) if (lm.update) lm.update(dt, cam);
    if (RJ.carrier && RJ.carrier.group) RJ.carrier.update(dt, RJ.game && RJ.game.mode && RJ.game.mode.player);
  };

  /* ---------------- discovery ---------------- */
  A.isFound = (id) => !!(RJ.progress.atlas && RJ.progress.atlas[id]);
  A.foundCount = () => A.DEFS.filter((d) => A.isFound(d.id)).length;
  /** Check the player against every landmark's discovery radius. */
  A.checkDiscovery = function (pl) {
    if (!pl || !pl.alive) return;
    for (const lm of A.list) {
      if (A.isFound(lm.id)) continue;
      const m = lm.marker, d = Math.hypot(pl.pos.x - m.x, pl.pos.z - m.z);
      if (d < lm.def.r && pl.pos.y < m.y + 3000) {
        RJ.progress.atlas = RJ.progress.atlas || {};
        RJ.progress.atlas[lm.id] = Date.now();
        const unlocked = RJ.addXP(lm.def.xp);
        RJ.saveProgress();
        RJ.emit("discover", { lm, count: A.foundCount(), total: A.DEFS.length, unlocked });
      }
    }
  };
  /** Markers for the HUD and radar. */
  A.markers = () => A.list.map((lm) => ({ id: lm.id, pos: lm.marker, name: lm.def.name, icon: lm.def.icon, found: A.isFound(lm.id) }));
})(window.RJ);
