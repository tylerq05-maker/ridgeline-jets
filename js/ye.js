/* Ridgeline Jets — the Ye Monument: a 2.4 km bronze statue of Kanye West on a 290 m granite pedestal.
 * Sculpted procedurally (human-scale model × 1300): a high-resolution deformed head (brow, eyes, broad nose, full
 * lips, cheekbones, square jaw, short boxed beard, buzz cut, ears), an oversized quilted puffer jacket with a bunched
 * hood, arms crossed over the chest, baggy cargo pants and chunky boots. Night: four ground batteries of searchlights
 * light the figure (computed in its shader) and throw visible beams. Its shadow falls across the landscape at any
 * distance (capsule model ray-traced in the terrain shader, see world.js). Beyond the main camera's range a twin
 * on the far-horizon layer keeps it on the skyline from 100+ km. A ring of 300–450 m towers gives it scale. */
(function (RJ) {
  "use strict";
  const YE = (RJ.ye = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const U = () => RJ.castle.util;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _c = new THREE.Color();
  const K = 1300;                 // metres per human-metre: a 1.85 m figure becomes ~2.4 km
  const PED = 290;                // pedestal height (m)
  YE.DEF = { id: "ye", name: "The Ye Monument", sub: "Kanye West in bronze: 2.4 km tall on a 290 m pedestal", icon: "tower", r: 16000, xp: 700 };
  if (RJ.atlas && RJ.atlas.DEFS && !RJ.atlas.DEFS.some((d) => d.id === "ye")) RJ.atlas.DEFS.push(YE.DEF);

  /* ======================= site ======================= */
  YE.plan = function (gen, home, sites) {
    let best = null;
    const avoid = sites.map((s) => [s.x, s.z, (s.r || 0) + 9000]);
    for (let r = 28000; r <= 48000; r += 2500) for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU + 0.4, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
      const f = gen.fields(x, z);
      if (f.h < 40 || f.h > 900 || f.him > 0 || f.nyc > 0 || f.sf > 0 || f.snowZ > 0 || f.ash > 0 || f.wl > -1e8) continue;
      if (avoid.some(([sx, sz, sr]) => Math.hypot(sx - x, sz - z) < sr)) continue;
      let sl = 0, bad = 0;
      for (let j = 0; j < 12; j++) { const b = (j / 12) * TAU; for (const d of [700, 1400, 2400]) { const h = gen.height(x + Math.cos(b) * d, z + Math.sin(b) * d); sl = Math.max(sl, Math.abs(h - f.h) / d); if (h < 5) bad++; } }
      if (bad) continue;
      const sc = sl + Math.abs(r - 36000) / 80000;
      if (!best || sc < best.sc) best = { x, z, h: f.h, sc };
    }
    if (!best) return null;
    best.yaw = Math.atan2(home.x - best.x, home.z - best.z); // faces home
    YE.site = best;
    sites.push({ type: "plateau", kind: "ye", x: best.x, z: best.z, r: 1000, fall: 1100, elev: best.h });
    return best;
  };

  /* ======================= sculpting helpers (human units) ======================= */
  const sm = (a, b, x) => { const t = RJ.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const gs = (x, m, s) => Math.exp(-((x - m) * (x - m)) / (2 * s * s));
  function colorize(geo, fn) {
    const P = geo.attributes.position, c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { const v = fn(P.getX(i), P.getY(i), P.getZ(i), i); c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v; }
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3)); return geo;
  }
  /** Loft: rings of superellipse sections. ring = {c:V3, ax:V3, az:V3, rx, rz, n} */
  function loft(rings, R = 40, cap = true) {
    const pos = [], idx = [];
    for (const r of rings) for (let k = 0; k < R; k++) {
      const a = (k / R) * TAU, ca = Math.cos(a), sa = Math.sin(a), e = 2 / (r.n || 2);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * r.rx, z = Math.sign(sa) * Math.pow(Math.abs(sa), e) * r.rz;
      pos.push(r.c.x + r.ax.x * x + r.az.x * z, r.c.y + r.ax.y * x + r.az.y * z, r.c.z + r.ax.z * x + r.az.z * z);
    }
    for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < R; k++) { const a = j * R + k, b = j * R + (k + 1) % R, c = a + R, d = b + R; idx.push(a, c, b, b, c, d); }
    if (cap) for (const [j, flip] of [[0, true], [rings.length - 1, false]]) {
      const c = rings[j].c, ci = pos.length / 3; pos.push(c.x, c.y, c.z);
      for (let k = 0; k < R; k++) { const a = j * R + k, b = j * R + (k + 1) % R; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  /** A limb along a smooth curve with a radius profile and quilted (puffer) bulges. */
  function limb(points, radius, quilt = 0, R = 28, S = 60) {
    const curve = new THREE.CatmullRomCurve3(points), rings = [], L = curve.getLength();
    for (let i = 0; i <= S; i++) {
      const t = i / S, c = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const ref = Math.abs(tg.y) > 0.9 ? V3(0, 0, 1) : V3(0, 1, 0), ax = V3().crossVectors(tg, ref).normalize(), az = V3().crossVectors(ax, tg).normalize();
      const r = radius(t) * (1 + quilt * Math.pow(Math.abs(Math.sin((t * L) / 0.075 * Math.PI)), 0.6));
      rings.push({ c, ax, az, rx: r, rz: r, n: 2 });
    }
    return loft(rings, R);
  }
  const ring = (y, rx, rz, n = 2.4, cz = 0, cx = 0) => ({ c: V3(cx, y, cz), ax: V3(1, 0, 0), az: V3(0, 0, 1), rx, rz, n });

  /** The head: a deformed sphere in normalised coordinates (x right, y up, z forward), then scaled to size. */
  function head() {
    const geo = new THREE.SphereGeometry(1, 160, 120), P = geo.attributes.position, col = new Float32Array(P.count * 3);
    const SX = 0.079, SY = 0.118, SZ = 0.1;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const ax = Math.abs(x), front = sm(0.1, 0.6, z);
      // skull and jaw: a broad, square lower face narrowing into a strong chin
      x *= 1 - 0.1 * sm(-0.4, -0.95, y) * (1 - 0.6 * sm(0.0, 0.6, z)) + 0.07 * gs(y, -0.45, 0.22) + 0.04 * gs(y, -0.1, 0.2);
      if (y < -0.2) z += 0.05 * sm(-0.2, -0.75, y) * front;                          // jaw forward
      z += 0.1 * gs(y, -0.82, 0.12) * gs(x, 0, 0.3) * front;                          // chin
      if (z > 0.55) z = 0.55 + (z - 0.55) * 0.55;                                     // a flatter facial plane
      // brow ridge and eye sockets
      z += 0.1 * gs(y, 0.22, 0.07) * gs(x, 0, 0.55) * front;
      const eye = gs(y, 0.08, 0.07) * (gs(x, 0.33, 0.13) + gs(x, -0.33, 0.13));
      z -= 0.14 * eye * front;
      z += 0.035 * gs(y, 0.07, 0.035) * (gs(x, 0.33, 0.07) + gs(x, -0.33, 0.07)) * front; // eyelids
      // nose: a straight bridge widening into a broad tip and flared nostrils
      const nt = sm(0.14, -0.2, y) * (1 - sm(-0.22, -0.3, y));
      const nw = 0.06 + 0.12 * sm(0.1, -0.22, y);
      z += (0.05 + 0.26 * nt) * gs(x, 0, nw) * sm(0.2, 0.08, y) * front * sm(-0.32, -0.2, y);
      z += 0.06 * gs(y, -0.17, 0.06) * gs(x, 0, 0.1) * front;                          // rounded tip
      z += 0.12 * gs(y, -0.24, 0.05) * (gs(x, 0.17, 0.065) + gs(x, -0.17, 0.065)) * front;
      z -= 0.05 * gs(y, -0.28, 0.025) * (gs(x, 0.1, 0.03) + gs(x, -0.1, 0.03)) * front;   // nostrils
      // lips: full upper and lower lip, a firm closed mouth
      z += 0.11 * gs(y, -0.37, 0.045) * gs(x, 0, 0.27) * front;
      z -= 0.055 * gs(y, -0.43, 0.016) * gs(x, 0, 0.25) * front;
      z += 0.1 * gs(y, -0.5, 0.045) * gs(x, 0, 0.23) * front;
      // cheekbones
      const cb = gs(y, -0.02, 0.12) * gs(ax, 0.6, 0.15) * sm(-0.2, 0.4, z); x += Math.sign(x) * 0.05 * cb; z += 0.03 * cb;
      // hair (close buzz cut) and a short boxed beard joined by sideburns
      const hairline = z > 0 ? RJ.lerp(0.28, 0.5, sm(0.2, 0.8, z)) : RJ.lerp(0.28, -0.35, sm(0, -0.8, z));
      const hair = sm(hairline - 0.03, hairline + 0.03, y);
      const lips = gs(y, -0.43, 0.08) * gs(x, 0, 0.22) * sm(0.3, 0.7, z);
      const beard = sm(-0.12, -0.3, y) * sm(-0.55, -0.2, z) * (1 - lips * 1.6) + gs(y, -0.33, 0.03) * gs(x, 0, 0.25) * front * 0.9 + sm(0.75, 0.9, ax) * sm(0.35, 0.0, y) * sm(-0.3, 0.1, y) * 0.8;
      const bd = RJ.clamp(beard, 0, 1), off = 1 + 0.035 * hair + 0.075 * bd;
      x *= off; y *= off; z *= off;
      P.setXYZ(i, x * SX, y * SY, z * SZ);
      const v = 1 - 0.68 * Math.max(hair, bd); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // ears
    const ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.SphereGeometry(1, 24, 16); e.scale(0.008, 0.026, 0.016);
      const P2 = e.attributes.position; for (let i = 0; i < P2.count; i++) if (P2.getX(i) * s < 0) P2.setX(i, P2.getX(i) * 0.3);
      e.rotateY(s * 0.35); e.translate(s * SX * 0.97, SY * 0.0, -SZ * 0.12); e.computeVertexNormals();
      ears.push(colorize(e, () => 1));
    }
    return [geo, ...ears];
  }

  /** Every part of the figure, in human metres (feet on y = 0, facing +z). */
  function figure() {
    const parts = [];
    const add = (g, shade) => { parts.push(g.attributes.color ? g : colorize(g, () => shade)); return g; };
    // chunky boots with thick soles
    for (const s of [-1, 1]) {
      const b = new THREE.SphereGeometry(1, 40, 24), P = b.attributes.position;
      for (let i = 0; i < P.count; i++) { let x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (y < 0) y *= 0.25; x *= 1 + 0.15 * z; P.setXYZ(i, x * 0.068, y * 0.085 + 0.045, z * 0.17 + 0.045); }
      b.computeVertexNormals(); b.translate(s * 0.135, 0, 0); add(b, 0.62);
      const sole = new THREE.BoxGeometry(0.15, 0.04, 0.35); sole.translate(s * 0.135, 0.02, 0.045); add(sole, 1.25);
    }
    // baggy cargo pants, bunched at the ankles, with thigh pockets
    for (const s of [-1, 1]) {
      add(limb([V3(s * 0.135, 0.1, 0.0), V3(s * 0.132, 0.3, 0.012), V3(s * 0.128, 0.52, 0.02), V3(s * 0.118, 0.75, 0.01), V3(s * 0.105, 0.96, 0)],
        (t) => 0.072 + 0.012 * Math.sin(t * 40) * sm(0.15, 0, t) + t * 0.035 + 0.008 * gs(t, 0.42, 0.05)), 0.8);
      const pk = new THREE.BoxGeometry(0.03, 0.13, 0.1); pk.translate(s * 0.205, 0.64, 0.01); add(pk, 0.74);
    }
    // hips
    add(loft([ring(0.86, 0.2, 0.135), ring(0.95, 0.205, 0.14), ring(1.0, 0.205, 0.14)], 40), 0.8);
    // the oversized puffer jacket: quilted channels, hip length, dropped shoulders
    const jr = [];
    for (let i = 0; i <= 70; i++) {
      const y = 0.84 + (i / 70) * 0.66, t = (y - 0.84) / 0.66;
      const q = 1 + 0.045 * Math.pow(Math.abs(Math.sin(((y - 0.84) / 0.082) * Math.PI)), 0.55) * (1 - sm(0.92, 1, t));
      const wx = (0.235 + 0.02 * gs(t, 0.55, 0.25) + 0.02 * gs(t, 0.88, 0.1)) * (1 - 0.62 * sm(0.9, 1.0, t)) * q;
      const wz = (0.165 + 0.01 * gs(t, 0.5, 0.25)) * (1 - 0.4 * sm(0.9, 1.0, t)) * q;
      jr.push(ring(y, wx, wz, 2.6, 0.005));
    }
    add(loft(jr, 64), 0.9);
    // zip placket down the front
    const zp = new THREE.BoxGeometry(0.012, 0.6, 0.012); zp.translate(0, 1.15, 0.178); add(zp, 0.7);
    // bunched hood and high collar around the neck
    add(new THREE.TorusGeometry(0.105, 0.062, 20, 48).rotateX(Math.PI / 2).translate(0, 1.525, 0.0), 0.86);
    { const h = new THREE.SphereGeometry(1, 32, 20); h.scale(0.15, 0.08, 0.08); h.translate(0, 1.52, -0.11); add(h, 0.86); }
    // neck
    add(new THREE.CylinderGeometry(0.052, 0.058, 0.14, 32).translate(0, 1.55, 0.005), 1);
    // arms crossed over the chest: puffy quilted sleeves, fists tucked against the upper arms
    for (const s of [-1, 1]) {
      const sh = V3(s * 0.235, 1.42, -0.005), el = V3(s * 0.235, 1.15, 0.1), fr = s > 0 ? 0.225 : 0.195;
      add(limb([sh, V3(s * 0.255, 1.3, 0.04), el], (t) => 0.078 - 0.008 * t, 0.06, 28, 40), 0.9);
      add(limb([el, V3(s * 0.12, 1.2, fr + 0.01), V3(-s * 0.13, 1.25, fr - 0.01)], (t) => 0.07 - 0.012 * t, 0.06, 28, 40), 0.9);
      const fist = new THREE.SphereGeometry(1, 24, 16); fist.scale(0.045, 0.05, 0.04); fist.translate(-s * 0.17, 1.27, fr - 0.035); add(fist, 1);
    }
    // the head, chin slightly raised
    const [hd, ...ears] = head();
    const hg = U().merge([hd, ...ears]); hg.rotateX(-0.07); hg.translate(0, 1.712, 0.012); parts.push(hg);
    return parts;
  }

  /* ======================= materials ======================= */
  const lightsU = { rjSpotP: { value: [V3(), V3(), V3(), V3()] }, rjSpotD: { value: [V3(), V3(), V3(), V3()] }, rjNight: { value: 0 } };
  function bronze() {
    const m = new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.38, metalness: 0.78, vertexColors: true });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, lightsU);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vYW; varying vec3 vYN;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvYW = (modelMatrix * vec4(transformed, 1.0)).xyz; vYN = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vYW; varying vec3 vYN; uniform vec3 rjSpotP[4]; uniform vec3 rjSpotD[4]; uniform float rjNight;\nfloat ynH(vec2 p){ return fract(sin(dot(mod(p, 311.0), vec2(12.99, 78.23))) * 43758.5); }")
        // patina: green-grey weathering collects in hollows and streaks down from ledges; the polish survives on ridges
        .replace("#include <color_fragment>", "#include <color_fragment>\nfloat pat = smoothstep(0.35, 0.9, ynH(floor(vYW.xz * 0.02)) * 0.5 + 0.5 * (1.0 - abs(vYN.y))) * 0.35;\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.42, 0.36) * dot(diffuseColor.rgb, vec3(0.5)), pat * (1.0 - vColor.r * 0.5));")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nroughnessFactor = mix(0.9, roughnessFactor, smoothstep(0.45, 0.85, vColor.r)); metalnessFactor *= mix(0.55, 1.0, smoothstep(0.45, 0.85, vColor.r));")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "if (rjNight > 0.01) { vec3 yn = normalize(vYN); vec3 acc = vec3(0.0);",
          "  for (int i = 0; i < 4; i++) { vec3 L = rjSpotP[i] - vYW; float d = length(L); L /= d;",
          "    float cone = smoothstep(0.86, 0.95, dot(-L, rjSpotD[i])); acc += vec3(1.0, 0.93, 0.8) * max(dot(yn, L), 0.0) * cone * (i == 3 ? 2.2 : 1.0); }",
          "  totalEmissiveRadiance += diffuseColor.rgb * acc * rjNight * 1.4; }"
        ].join("\n"));
    };
    m.customProgramCacheKey = () => "rjYeBronze";
    return m;
  }
  const std = (c, r = 0.85, mt = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
  function letters(text, w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    g.clearRect(0, 0, w, h); g.fillStyle = "#e8c66a"; g.font = `bold ${Math.round(h * 0.8)}px Georgia, serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 8; g.fillText(text, w / 2, h * 0.54);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }

  /* ======================= build ======================= */
  YE.build = function () {
    const S = YE.site; if (!S) return null;
    const W = RJ.world, grp = new THREE.Group(); grp.position.set(S.x, S.h, S.z); grp.rotation.y = S.yaw;
    /* pedestal: plaza, granite base with pilasters, colonnade tier, plinth with gold trim, the grand stair */
    const GR = [], DK = [], GD = [], LT = [];
    const at = (list, g, x, y, z, ry = 0) => { g.rotateY(ry); g.translate(x, y, z); list.push(g); };
    at(GR, new THREE.BoxGeometry(1900, 40, 1900), 0, 0, 0);                                    // plaza (sunk into the plateau)
    at(DK, new THREE.BoxGeometry(1100, 130, 1100), 0, 20 + 45, 0);                              // base (bottom 20 m hidden)
    for (let k = -5; k <= 5; k++) for (const [sx, sz, ry] of [[1, 0, 0], [-1, 0, 0], [0, 1, Math.PI / 2], [0, -1, Math.PI / 2]]) {
      const o = k * 95; at(GR, new THREE.BoxGeometry(14, 100, 22), sx ? sx * 556 : o, 70, sz ? sz * 556 : o, ry);
    }
    at(GD, new THREE.BoxGeometry(1112, 6, 1112), 0, 128, 0);                                    // gilded cornice
    at(GR, new THREE.BoxGeometry(860, 120, 860), 0, 130 + 60, 0);                               // colonnade tier core
    for (let k = -6; k <= 6; k++) for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = k * 66; at(GR, new THREE.CylinderGeometry(11, 13, 112, 16), sx ? sx * 462 : o, 131 + 56, sz ? sz * 462 : o);
    }
    at(GR, new THREE.BoxGeometry(960, 10, 960), 0, 250, 0); at(GD, new THREE.BoxGeometry(966, 4, 966), 0, 256, 0);
    at(DK, new THREE.BoxGeometry(760, 32, 760), 0, 258 + 16, 0);                               // plinth
    at(GD, new THREE.BoxGeometry(772, 4, 772), 0, PED - 1, 0);
    for (let k = 0; k < 18; k++) at(GR, new THREE.BoxGeometry(420 - k * 6, 7.2, 30), 0, 22 + k * 7.2 - 3.6, 600 + 260 - k * 15);   // grand stair to the base
    // lamp standards around the plaza (scale reference: about the size of a street lamp to a person on the plaza)
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU, x = Math.cos(a) * 880, z = Math.sin(a) * 880; at(DK, new THREE.CylinderGeometry(1.2, 1.6, 30, 8), x, 35, z); LT.push(x, 51, z); }
    const pm = (list, mat) => { const m = new THREE.Mesh(U().merge(list), mat); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
    pm(GR, std(0xb7b0a4, 0.85)); pm(DK, std(0x2e2b2a, 0.55, 0.2)); pm(GD, std(0xc9a24a, 0.3, 1.0));
    // "YE" in gilded letters, 70 m tall, on all four faces of the base
    const lm = new THREE.MeshBasicMaterial({ map: letters("YE", 1024, 512), transparent: true, depthWrite: false, fog: true });
    for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(320, 160), lm); const a = k * Math.PI / 2; p.position.set(Math.sin(a) * 551.5, 70, Math.cos(a) * 551.5); p.rotation.y = a; grp.add(p); }

    /* the figure */
    const figGeo = U().merge(figure());
    const fig = new THREE.Mesh(figGeo, bronze()); fig.scale.setScalar(K); fig.position.y = PED; fig.castShadow = true; fig.receiveShadow = true; grp.add(fig);
    // aviation warning lights on the crown of the head and the shoulders (they blink, like any tall structure)
    const warnMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const warn = new THREE.InstancedMesh(new THREE.SphereGeometry(5, 8, 6), warnMat, 3);
    [[0, 1.84, 0.0], [0.27, 1.47, 0], [-0.27, 1.47, 0]].forEach(([x, y, z], i) => { _m4.makeTranslation(x * K, PED + y * K + 4, z * K); warn.setMatrixAt(i, _m4); });
    grp.add(warn);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(4, 8, 6), lampMat, LT.length / 3);
    for (let i = 0; i < LT.length / 3; i++) { _m4.makeTranslation(LT[i * 3], LT[i * 3 + 1], LT[i * 3 + 2]); lamps.setMatrixAt(i, _m4); }
    grp.add(lamps);

    /* searchlight batteries and their beams */
    const srcs = [[-1400, 40, 1300, 0.9], [1400, 40, 1300, 0.9], [0, 40, -1500, 1.2], [0, 60, 2600, 1.65]];   // last: the face light
    const beams = [];
    for (const [x, y, z, ty] of srcs) {
      const src = V3(x, y, z), tgt = V3(0, PED + ty * K, x === 0 && z > 0 ? 0.08 * K : 0), dir = tgt.clone().sub(src), len = dir.length(); dir.normalize();
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.11, 8, len, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
      cone.geometry.translate(0, len / 2, 0); cone.position.copy(src); cone.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); cone.layers.set(RJ.LATE);
      grp.add(cone); beams.push(cone);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 20, 12), std(0x333333, 0.5, 0.6)); base.position.set(x, y - 10, z); grp.add(base);
      beams[beams.length - 1].userData = { src, dir };
    }

    /* the scale ring: towers of 300–450 m that barely reach its shins */
    const tw = [], r = RJ.world.gen.mulberry32(2004);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU + r() * 0.1, d = 2600 + r() * 2400, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 160 + r() * 300;
      if (Math.abs(a - Math.PI / 2) < 0.25) continue; // keep the view down the grand stair open
      tw.push([x, z, 40 + r() * 30, 40 + r() * 30, h]);
    }
    const towerIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), RJ.sf && RJ.sf.facade ? RJ.sf.facade({ color: 0x9aa4ab, rough: 0.3, metal: 0.4, wx: 3, wy: 4, ww: 0.8, wh: 0.7, glass: "0.13, 0.17, 0.2", lit: 0.45 }) : std(0x9aa4ab, 0.4, 0.4), tw.length);
    const towers = [];
    tw.forEach(([x, z, w, dd, h], i) => {
      const wp = grp.localToWorld(V3(x, 0, z)), g0 = G(wp.x, wp.z) - S.h - 6;
      _m4.compose(_p.set(x, g0, z), _q.identity(), _s.set(w, h + 6, dd)); towerIM.setMatrixAt(i, _m4); towerIM.setColorAt(i, _c.setHSL(0.58, 0.05, 0.5 + r() * 0.2));
      towers.push({ x: wp.x, z: wp.z, w: w / 2 + 2, d: dd / 2 + 2, top: S.h + g0 + h + 6 });
    });
    towerIM.castShadow = true; towerIM.receiveShadow = true; grp.add(towerIM);

    W.scene.add(grp); grp.updateMatrixWorld(true);
    /* far-horizon twin: the same geometry on the backdrop layer, hazed toward the sky */
    const farMat = new THREE.MeshBasicMaterial({ color: 0x4a3c30, fog: false });
    const far = new THREE.Group(); far.position.copy(grp.position); far.rotation.copy(grp.rotation);
    const ff = new THREE.Mesh(figGeo, farMat); ff.scale.setScalar(K); ff.position.y = PED; far.add(ff);
    const fp = new THREE.Mesh(new THREE.BoxGeometry(1100, PED, 1100), farMat); fp.position.y = PED / 2; far.add(fp);
    far.traverse((o) => { o.layers.set(W.BACK); o.frustumCulled = false; }); W.scene.add(far);

    /* world-space lights and the shadow capsules (for the terrain shader) */
    const wl = (x, y, z) => grp.localToWorld(V3(x, y, z));
    beams.forEach((b, i) => { lightsU.rjSpotP.value[i].copy(wl(b.userData.src.x, b.userData.src.y, b.userData.src.z)); lightsU.rjSpotD.value[i].copy(b.userData.dir).applyQuaternion(grp.quaternion); });
    const H = (x, y, z) => wl(x * K, PED + y * K, z * K);
    const caps = [
      [H(-0.135, 0.06, 0.03), H(-0.11, 0.95, 0), 0.1], [H(0.135, 0.06, 0.03), H(0.11, 0.95, 0), 0.1],
      [H(0, 0.88, 0), H(0, 1.38, 0), 0.215], [H(-0.24, 1.44, 0), H(0.24, 1.44, 0), 0.09],
      [H(-0.26, 1.2, 0.17), H(0.26, 1.2, 0.17), 0.085], [H(0, 1.5, 0), H(0, 1.8, 0.01), 0.088]
    ];
    if (W.giant) {
      caps.forEach(([a, b, rr], i) => { W.giant.a.value[i].set(a.x, a.y, a.z, rr * K); W.giant.b.value[i].set(b.x, b.y, b.z, 0); });
      W.giant.n.value = caps.length;
    }
    const lmk = {
      group: grp, cx: S.x, cz: S.z, marker: V3(S.x, S.h + PED + 1.95 * K, S.z), s: S, far, beams, warnMat, lampMat, caps, towers, fig, t: 0,
      heightAt: (x, z) => {
        const p = grp.worldToLocal(_p.set(x, 0, z)), ax = Math.abs(p.x), az = Math.abs(p.z);
        if (ax < 380 && az < 380) return S.h + PED; if (ax < 550 && az < 550) return S.h + 130; if (ax < 950 && az < 950) return S.h + 20;
        for (const t of towers) if (Math.abs(x - t.x) < t.w && Math.abs(z - t.z) < t.d) return t.top;
        return -Infinity;
      },
      solidAt: (p) => {
        if (Math.hypot(p.x - S.x, p.z - S.z) > 900 || p.y > S.h + PED + 1.9 * K) return false;
        for (const [a, b, rr] of caps) { const ab = _s.copy(b).sub(a), t = RJ.clamp(_p.copy(p).sub(a).dot(ab) / ab.lengthSq(), 0, 1); if (_p.copy(a).addScaledVector(ab, t).distanceTo(p) < rr * K * 0.92) return true; }
        return false;
      },
      update: (dt, cam) => update(lmk, dt, cam)
    };
    YE.lm = lmk;
    return lmk;
  };

  function update(lm, dt, cam) {
    const W = RJ.world, d = Math.hypot(cam.position.x - lm.cx, cam.position.z - lm.cz);
    lm.dist = d;
    lm.group.visible = d < 21000;
    lm.far.visible = d > 18000;
    if (lm.far.visible) lm.far.children[0].material.color.set(0x4a3c30).lerp(W.scene.fog.color, RJ.clamp((d - 15000) / 160000, 0, 0.7));
    if (W.giant) { W.giant.on.value = d < 60000 ? 1 : 0; W.giant.sun.value.copy(W.sunDir); }
    lm.t += dt;
    const nk = RJ.clamp(1 - RJ.smooth(-4, 8, W.sunElev), 0, 1);
    lightsU.rjNight.value = nk;
    for (const b of lm.beams) b.material.opacity = nk * 0.09;
    lm.warnMat.color.setRGB((lm.t % 1.5) < 0.25 ? 4 : 0.15, 0.05, 0.03);
    lm.lampMat.color.setRGB(1.5, 1.2, 0.8).multiplyScalar(0.1 + nk * 1.6);
  }

  /** Free Flight start: 9 km out at shoulder height, facing the statue. */
  YE.spawn = function () {
    const S = YE.site; if (!S) return null;
    const dx = Math.sin(S.yaw), dz = Math.cos(S.yaw), x = S.x + dx * 9000 + dz * 2500, z = S.z + dz * 9000 - dx * 2500;
    return { x, z, yaw: Math.atan2(-(S.x - x), -(S.z - z)), alt: S.h + PED + 1.35 * K };
  };
})(window.RJ);
