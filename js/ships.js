/* Ridgeline Jets — sea traffic: container ships, tankers, cruise liners, destroyers, trawlers and sailing
 * yachts cruising wherever the sea is deep enough, each with a Kelvin wake (turbulent centre line plus the
 * two 19.5° arms) and a bow wave. Ships steer away from shallow water and roll and pitch with the sea state.
 * Hulls are procedural (extruded outline + boxes, vertex colours, one draw call per ship plus its wake). */
(function (RJ) {
  "use strict";
  const S = (RJ.ships = { list: [], on: true });
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---------------- geometry helpers ---------------- */
  function colorize(g, c) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3), col = new THREE.Color(c);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  }
  function box(parts, w, h, d, x, y, z, c) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); parts.push(colorize(g, c)); }
  function cyl(parts, r, h, x, y, z, c) { const g = new THREE.CylinderGeometry(r, r, h, 10); g.translate(x, y + h / 2, z); parts.push(colorize(g, c)); }
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); col.set(g.attributes.color.array, vo * 3);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; } else for (let i = 0; i < c; i++) idx[io++] = vo + i;
      vo += c; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  /** Hull: top-view outline (bow toward -z) extruded from below the waterline to the deck; boot-top, topsides
   *  and deck coloured by height and facing. */
  function hull(parts, L, B, free, o) {
    const h = L / 2, b = B / 2, sh = new THREE.Shape();
    sh.moveTo(0, -h);
    sh.bezierCurveTo(b * 0.55, -h + L * 0.04, b, -h + L * (o.fine || 0.16), b, -h + L * 0.3);
    sh.lineTo(b, h - L * 0.06); sh.quadraticCurveTo(b, h, b * 0.7, h); sh.lineTo(-b * 0.7, h); sh.quadraticCurveTo(-b, h, -b, h - L * 0.06);
    sh.lineTo(-b, -h + L * 0.3); sh.bezierCurveTo(-b, -h + L * (o.fine || 0.16), -b * 0.55, -h + L * 0.04, 0, -h);
    const g = new THREE.ExtrudeGeometry(sh, { depth: free + 3, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(Math.PI / 2); g.translate(0, free, 0); // extrude downward from the deck: y = free .. -3
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, a = new Float32Array(p.count * 3);
    const deck = new THREE.Color(o.deck), side = new THREE.Color(o.hull), boot = new THREE.Color(o.boot || 0x7a2a22), stripe = o.stripe != null ? new THREE.Color(o.stripe) : null;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), up = n.getY(i) > 0.8;
      const c = up ? deck : y < (o.bootTop || 1.6) ? boot : stripe && y > free - 2.2 ? stripe : side;
      a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    parts.push(g);
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  /* ---------------- ship designs ---------------- */
  const TYPES = {
    container: { w: 30, L: 260, B: 32, speed: 10, build(P) {
      const free = 13; hull(P, 260, 32, free, { hull: pick([0x1d3557, 0x7b2222, 0x2d5a3a, 0x30343a]), deck: 0x5b4636, fine: 0.2 });
      const cols = [0xb3392f, 0x2f6db3, 0xd8a02e, 0x3d8a4a, 0xe0e0dc, 0x8a8f96, 0xd2622a, 0x4a3a8a];
      for (let z = -100; z < 86; z += 14) {
        const tiers = 2 + Math.floor(Math.random() * 4);
        for (let x = -12; x <= 12; x += 6) for (let t = 0; t < tiers; t++) if (Math.random() > 0.08) box(P, 5.6, 2.55, 12.6, x, free + t * 2.6, z, pick(cols));
      }
      box(P, 30, 20, 14, 0, free, 108, 0xe9e9e4); box(P, 38, 2, 6, 0, free + 18, 104, 0xe9e9e4);
      box(P, 30, 1.2, 1.2, 0, free + 17, 100.8, 0x1a2a3a); cyl(P, 2.6, 10, 0, free + 18, 116, 0x2a2a2a);
    } },
    tanker: { w: 18, L: 240, B: 40, speed: 7.5, build(P) {
      const free = 9; hull(P, 240, 40, free, { hull: pick([0x1b1b1d, 0x7a1f1f, 0x23394f]), deck: 0x8a3a2c, fine: 0.24 });
      for (const x of [-6, -2, 2, 6]) box(P, 0.9, 0.9, 170, x, free + 0.8, -10, 0x9aa0a6);
      box(P, 1.6, 2.6, 200, 0, free, -8, 0xb8bcc0);
      for (let z = -90; z < 70; z += 32) box(P, 3, 6, 3, 12, free, z, 0xc8c8c0);
      box(P, 34, 16, 18, 0, free, 100, 0xecece6); box(P, 26, 6, 12, 0, free + 16, 100, 0xecece6);
      box(P, 34, 1, 1, 0, free + 15, 90.8, 0x1a2a3a); cyl(P, 3, 12, 0, free + 18, 108, 0x222222);
    } },
    cruise: { w: 8, L: 290, B: 36, speed: 11, build(P) {
      const free = 12; hull(P, 290, 36, free, { hull: 0xf1f1ee, deck: 0xc9b48a, stripe: 0x1d3f7a, boot: 0x1d3f7a, bootTop: 2.5, fine: 0.22 });
      for (let k = 0; k < 7; k++) {
        const w = 33 - k * 1.6, l = 220 - k * 18, y = free + k * 3.2, z0 = 10 + k * 3;
        box(P, w, 3.2, l, 0, y, z0, 0xf4f4f2);
        box(P, w + 0.2, 1.1, l - 4, 0, y + 1.4, z0, 0x223040); // window bands
      }
      for (let z = -70; z <= 80; z += 12) for (const s of [-1, 1]) box(P, 2.4, 2.4, 9, s * 17.5, free + 3.5, z, 0xf08a1c);
      box(P, 8, 10, 16, 0, free + 22.4, 70, 0x1d3f7a); box(P, 8.2, 3, 16.2, 0, free + 30, 70, 0xc22b2b);
      box(P, 30, 2, 26, 0, free + 22.4, -20, 0x5fb4d6); // pool deck
    } },
    destroyer: { w: 6, L: 155, B: 20, speed: 15, build(P) {
      const free = 7, g = 0x7d8790, d = 0x5b636b;
      hull(P, 155, 20, free, { hull: g, deck: d, boot: 0x2a2d30, fine: 0.32 });
      box(P, 14, 9, 28, 0, free, -8, g); box(P, 10, 7, 14, 0, free + 9, -10, g); box(P, 12, 1.2, 1.2, 0, free + 13.5, -17.2, 0x1a2228);
      box(P, 1.5, 22, 1.5, 0, free + 16, -6, 0x4a5056); box(P, 8, 0.6, 0.6, 0, free + 32, -6, 0x4a5056);
      box(P, 9, 6, 22, 0, free, 22, g); cyl(P, 2.2, 5, 0, free + 6, 22, 0x3a3f44);
      box(P, 4, 2.4, 6, 0, free, -52, d); box(P, 0.7, 0.7, 9, 0, free + 1.4, -59, 0x3a3f44); // gun
      box(P, 16, 0.3, 26, 0, free, 62, 0x6a7178); // helipad
    } },
    trawler: { w: 10, L: 32, B: 8, speed: 5, build(P) {
      const free = 3; hull(P, 32, 8, free, { hull: pick([0x2b4f8a, 0xa62a24, 0x2e6a3c]), deck: 0x7a6a55, boot: 0x222222, bootTop: 0.6, fine: 0.4 });
      box(P, 5.5, 4, 7, 0, free, -4, 0xf2f2ee); box(P, 5.6, 0.9, 6.9, 0, free + 2.6, -4, 0x203040);
      box(P, 0.5, 9, 0.5, -3, free, 10, 0xe0a020); box(P, 0.5, 9, 0.5, 3, free, 10, 0xe0a020); box(P, 6.5, 0.5, 0.5, 0, free + 9, 10, 0xe0a020);
      box(P, 0.4, 11, 0.4, 0, free + 4, -4, 0xdddddd);
    } },
    yacht: { w: 12, L: 20, B: 6, speed: 4, sail: true, build(P) {
      const free = 1.6; hull(P, 20, 6, free, { hull: 0xf6f6f4, deck: 0xb08a5a, boot: 0x1d3f7a, bootTop: 0.4, fine: 0.5 });
      box(P, 3.4, 1.2, 6, 0, free, 1, 0xf6f6f4); cyl(P, 0.18, 24, 0, free, -1.5, 0xd0d0d0);
      const sg = new THREE.BufferGeometry(), v = [0, free + 2, -1.3, 0, free + 25, -1.3, 0, free + 2, 7.5];
      sg.setAttribute("position", new THREE.Float32BufferAttribute(v.concat([v[0], v[1], v[2], v[6], v[7], v[8], v[3], v[4], v[5]]), 3));
      sg.computeVertexNormals(); P.push(colorize(sg, 0xf8f8f4));
      const jb = new THREE.BufferGeometry(), u = [0, free + 1, -9.5, 0, free + 21, -1.6, 0, free + 1.5, -1.6];
      jb.setAttribute("position", new THREE.Float32BufferAttribute(u.concat([u[0], u[1], u[2], u[6], u[7], u[8], u[3], u[4], u[5]]), 3));
      jb.computeVertexNormals(); P.push(colorize(jb, 0xf0f0ea));
    } }
  };
  S.TYPES = TYPES;

  /* ---------------- wake ---------------- */
  let wakeMat = null, shipMat = null;
  function materials() {
    if (shipMat) return;
    shipMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15 });
    wakeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, light: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: [
        "attribute float spd; varying vec2 vUv; varying vec3 vW; varying float vSpd;", RJ.world.GLSL_CURVE,
        "#include <fog_pars_vertex>",
        "void main(){ vUv = uv; vSpd = spd; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;",
        "  vec4 mvPosition = viewMatrix * w; mvPosition.xyz = rjCurve(mvPosition.xyz); gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float time; uniform vec3 light; varying vec2 vUv; varying vec3 vW; varying float vSpd;",
        "#include <fog_pars_fragment>",
        "float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
        "float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }",
        "void main(){",
        "  float v = vUv.y, x = abs(vUv.x - 0.5) * 2.0;",            // v: 0 at the bow .. 1 far astern
        "  float s = max(v - 0.12, 0.0) / 0.88;",                     // distance behind the stern
        "  float n = vn(vW.xz * 0.35 + time * 0.3) * 0.6 + vn(vW.xz * 1.3 - time * 0.5) * 0.4;",
        "  float arms = exp(-pow((x - s * 0.96) / (0.015 + 0.05 * s), 2.0)) * (1.0 - s) * step(0.001, s);",
        "  float centre = exp(-pow(x / (0.03 + s * 0.16), 2.0)) * pow(1.0 - s, 1.6);",
        "  float bow = v < 0.12 ? exp(-pow((x - (0.06 + v * 0.5)) / 0.05, 2.0)) * smoothstep(0.0, 0.03, v) : 0.0;",
        "  float f = (centre * 1.25 + arms * 0.75 + bow) * mix(0.45, 1.0, n) * vSpd;",
        "  f = clamp(f * 1.4 - 0.12, 0.0, 0.95);",
        "  gl_FragColor = vec4(light, f);",
        "#include <fog_fragment>",
        "}"
      ].join("\n")
    });
  }
  /** Wake plane in ship space: starts a little ahead of the bow and runs ~6 ship lengths astern. */
  function wakeGeo(L, B) {
    const len = L * 7, wid = len * 0.72, g = new THREE.PlaneGeometry(wid, len, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.25, -L * 0.55 + len / 2 + 0);
    // uv.y: 0 at the bow end
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    g.setAttribute("spd", new THREE.BufferAttribute(new Float32Array(4).fill(1), 1));
    return g;
  }

  /* ---------------- spawning ---------------- */
  const WEIGHTS = [["container", 26], ["tanker", 16], ["cruise", 8], ["destroyer", 6], ["trawler", 22], ["yacht", 22]];
  function pickType() { let r = Math.random() * 100; for (const [k, w] of WEIGHTS) { if ((r -= w) <= 0) return k; } return "trawler"; }
  const deep = (x, z, need) => RJ.world.terrainHeight(x, z) < -need && !(RJ.carrier && RJ.carrier.site && Math.hypot(x - RJ.carrier.site.x, z - RJ.carrier.site.z) < 1500);
  function spawn(cam, near) {
    const W = RJ.world, type = pickType(), T = TYPES[type];
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, r = near ? RJ.rand(1500, 9000) : RJ.rand(9000, 20000);
      const x = cam.position.x + Math.cos(a) * r, z = cam.position.z + Math.sin(a) * r, hdg = Math.random() * Math.PI * 2;
      const need = T.L > 100 ? 14 : 5;
      const fx = -Math.sin(hdg), fz = -Math.cos(hdg);
      if (!deep(x, z, need) || !deep(x + fx * T.L, z + fz * T.L, need) || !deep(x - fx * T.L, z - fz * T.L, need)) continue;
      if (S.list.some((s) => Math.hypot(s.pos.x - x, s.pos.z - z) < 900)) continue;
      materials();
      const P = []; T.build(P);
      const mesh = new THREE.Mesh(merge(P), shipMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const wake = new THREE.Mesh(wakeGeo(T.L, T.B), wakeMat);
      wake.frustumCulled = false; wake.renderOrder = 4; // after the sea surface (renderOrder 2)
      const grp = new THREE.Group(); grp.add(wake); grp.add(mesh);
      W.scene.add(grp);
      const sh = { type, T, grp, mesh, wake, pos: V3(x, 0, z), hdg, want: hdg, speed: T.speed * RJ.rand(0.8, 1.1), ph: Math.random() * 10, look: 0 };
      S.list.push(sh);
      return sh;
    }
    return null;
  }
  function remove(sh) {
    RJ.world.scene.remove(sh.grp); sh.mesh.geometry.dispose(); sh.wake.geometry.dispose();
    S.list.splice(S.list.indexOf(sh), 1);
  }
  S.clear = () => { while (S.list.length) remove(S.list[0]); first = true; };
  S.target = () => (RJ.settings.quality === "low" || (RJ.perf && RJ.perf.tier >= 1) ? 6 : 12);

  let tick = 0, first = true;
  S.update = function (dt, cam) {
    const W = RJ.world;
    if (!S.on || !W.terrainHeight || !cam) return;
    tick -= dt;
    if (tick <= 0) {
      tick = 1;
      for (let i = S.list.length - 1; i >= 0; i--) if (S.list[i].pos.distanceTo(cam.position) > 26000) remove(S.list[i]);
      // fill the bubble: on the first pass ships may appear close, later only out of sight range
      const n = S.target();
      for (let k = 0; k < (first ? 24 : 3) && S.list.length < n; k++) spawn(cam, first && k % 2 === 0);
      first = false;
    }
    if (wakeMat) {
      wakeMat.uniforms.time.value += dt;
      const sun = W.sun ? W.sun.intensity : 1;
      wakeMat.uniforms.light.value.setRGB(0.85, 0.88, 0.9).multiplyScalar(0.35 + Math.min(1.2, sun) * 0.6);
    }
    const sea = W.seaState || 1, t = performance.now() / 1000;
    for (const sh of S.list) {
      // keep to deep water: look ~4 lengths ahead, turn toward the deeper side
      sh.look -= dt;
      if (sh.look <= 0) {
        sh.look = 2;
        const need = sh.T.L > 100 ? 12 : 4, ahead = Math.max(500, sh.T.L * 4);
        const ok = (h) => deep(sh.pos.x - Math.sin(h) * ahead, sh.pos.z - Math.cos(h) * ahead, need);
        if (!ok(sh.want)) { for (const d of [0.5, -0.5, 1, -1, 1.6, -1.6, 2.6, 3.14]) if (ok(sh.hdg + d)) { sh.want = sh.hdg + d; break; } }
      }
      const dh = Math.atan2(Math.sin(sh.want - sh.hdg), Math.cos(sh.want - sh.hdg));
      sh.hdg += RJ.clamp(dh, -1, 1) * dt * (sh.T.L > 100 ? 0.03 : 0.12);
      sh.pos.x -= Math.sin(sh.hdg) * sh.speed * dt; sh.pos.z -= Math.cos(sh.hdg) * sh.speed * dt;
      // motion in the swell: small craft pitch and roll far more than big hulls
      const k = RJ.clamp(40 / sh.T.L, 0.08, 1.6) * sea, p = sh.ph + t;
      sh.grp.position.set(sh.pos.x, Math.sin(p * 0.9) * 0.3 * k, sh.pos.z);
      sh.grp.rotation.set(0, sh.hdg, 0);
      sh.mesh.rotation.set(Math.sin(p * 0.7) * 0.02 * k, 0, Math.sin(p * 0.55 + 1) * 0.035 * k + (sh.T.sail ? 0.12 : 0));
    }
  };
  S.stats = () => S.list.map((s) => s.type + "@" + Math.round(s.pos.distanceTo(RJ.world.camera.position)));
})(window.RJ);
