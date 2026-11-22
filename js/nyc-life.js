/* Jet City — New York after dark: the city's moving lights, almost all of it on the GPU.
 *   · headlight / tail-light streams on every avenue, the riverside highways and the busier streets of the five
 *     boroughs: each car is one point that the vertex shader slides along its lane, white when it drives toward
 *     the camera and red when it drives away; platoons bunch up the way they leave the traffic lights
 *   · street lamps tracing the grid from the air (warm LED in Manhattan, a sodium cast in the outer boroughs)
 *   · red aircraft-obstruction beacons pulsing on every tall roof, the landmark spires and the bridge towers
 *   · the Times Square glow hanging over Midtown
 *   · harbour traffic (the Staten Island Ferry, river ferries, tugs and a container ship under the Verrazzano)
 *     and aircraft over the city (airliners on approach with landing lights, Hudson-corridor helicopters, the
 *     Statue of Liberty tours), moved on the CPU but drawn in the same single point pass.
 * Two draw calls in all; the static layer is built once, the first time the city is seen at dusk or night. */
(function (RJ) {
  "use strict";
  const L = RJ.nyc;
  if (!L) return;
  const LIFE = (L.life = { built: false });

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------------- the light shader ----------------
   * position = lane start (or the light itself), aB = lane end, aK = (phase, laps per second, size m, kind).
   * kinds: 0 car (head/tail by view), 1 street lamp, 2 obstruction beacon, 3 white strobe, 4 landing light,
   *        5 soft glow, 6 steady nav / cabin light, 7 aircraft anti-collision beacon */
  const VS = [
    "uniform float uTime; uniform float uNight; uniform float uViewH; uniform float uFogNear; uniform float uFogFar; uniform float uNearFade;",
    "attribute vec3 aB; attribute vec4 aK; attribute vec3 color;",
    "varying vec3 vC; varying float vSoft;",
    "void main(){",
    "  float kind = aK.w;",
    "  float t = fract(aK.x + uTime * aK.y);",
    "  vec3 p = mix(position, aB, t);",
    "  float vis = uNight;",
    "  if (kind > 1.5 && kind < 2.5) vis = mix(0.3, 1.0, uNight);",
    "  else if (kind > 2.5 && kind < 3.5) vis = mix(0.9, 1.0, uNight);",
    "  else if (kind > 3.5 && kind < 4.5) vis = mix(0.45, 1.0, uNight);",
    "  else if (kind > 6.5) vis = mix(0.4, 1.0, uNight);",
    "  float on = 1.0, bp = fract(aK.x * 7.31);",
    "  if (kind > 1.5 && kind < 2.5) { float ph = fract(uTime * 0.5 + bp); on = 0.04 + smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.4, 0.55, ph)); }",   // ~30 flashes a minute
    "  else if (kind > 2.5 && kind < 3.5) { float ph = fract(uTime * 0.8 + bp); on = step(ph, 0.045) + step(0.14, ph) * step(ph, 0.18); }",               // double flash
    "  else if (kind > 6.5) { float ph = fract(uTime * 1.1 + bp); on = step(ph, 0.12); }",
    "  vec3 c = color;",
    "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
    "  float dist = -mv.z;",
    "  if (kind < 0.5) {",                                                    // a car: white coming toward you, red going away
    "    vec3 d = aB - position; vec2 dh = normalize(d.xz + 1e-4); vec2 tc = cameraPosition.xz - p.xz; float tl = length(tc);",
    "    float f = tl > 1.0 ? dot(dh, tc / tl) : 0.0;",
    "    float k = smoothstep(-0.3, 0.3, f);",
    "    c = mix(vec3(1.0, 0.07, 0.03) * 1.1, vec3(1.0, 0.9, 0.74) * 1.7, k) * color;",
    "  }",
    "  if (kind < 1.5) vis *= mix(1.0, smoothstep(650.0, 1250.0, dist), uNearFade);",   // up close the detailed cars and lamp posts take over
    "  float px = aK.z * projectionMatrix[1][1] * uViewH * 0.5 / max(dist, 1.0);",
    "  float minPx = kind > 4.5 && kind < 5.5 ? 0.0 : kind > 3.5 && kind < 4.5 ? 2.6 : kind > 1.5 ? 2.0 : 1.5;",
    "  float dim = minPx > 0.0 ? clamp(px / minPx, 0.3, 1.0) : 1.0;",
    "  float fade = 1.0 - smoothstep(uFogNear, uFogFar, dist);",
    "  float b = vis * on * fade * dim;",
    "  vC = c * b; vSoft = kind > 4.5 && kind < 5.5 ? 1.0 : 0.0;",
    "  gl_Position = projectionMatrix * mv;",
    "  gl_PointSize = clamp(max(px, minPx), 0.0, kind > 4.5 && kind < 5.5 ? 260.0 : 40.0);",
    "  if (b < 0.004 || dist < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }",
    "}"
  ].join("\n");
  const FS = [
    "varying vec3 vC; varying float vSoft;",
    "void main(){",
    "  vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;",
    "  float a = vSoft > 0.5 ? (1.0 - r2) * (1.0 - r2) * 0.5 : exp(-r2 * 5.0) + (1.0 - r2) * 0.08;",
    "  gl_FragColor = vec4(vC * a, 1.0);",
    "}"
  ].join("\n");
  let MAT = null;
  function material() {
    if (MAT) return MAT;
    MAT = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uViewH: { value: 540 }, uFogNear: { value: 8000 }, uFogFar: { value: 20000 }, uNearFade: { value: 0 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false
    });
    return MAT;
  }

  /* ---------------- point buffers ---------------- */
  class PB {
    constructor() { this.a = []; this.b = []; this.k = []; this.c = []; this.n = 0; }
    add(ax, ay, az, bx, by, bz, phase, speed, size, kind, r, g, bl) {
      this.a.push(ax, ay, az); this.b.push(bx, by, bz); this.k.push(phase, speed, size, kind); this.c.push(r, g, bl); this.n++;
    }
    dot(x, y, z, size, kind, r, g, bl, phase) { this.add(x, y, z, x, y, z, phase || 0, 0, size, kind, r, g, bl); }
    points() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.a, 3));
      g.setAttribute("aB", new THREE.Float32BufferAttribute(this.b, 3));
      g.setAttribute("aK", new THREE.Float32BufferAttribute(this.k, 4));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      const p = new THREE.Points(g, material()); p.frustumCulled = false; p.renderOrder = 6; p.matrixAutoUpdate = false;
      return p;
    }
  }

  /* ---------------- traffic and street lamps on the grids ---------------- */
  function buildStreets(P, cap) {
    const q = RJ.settings.quality, G0 = L.GROUND;
    const outerKeep = { low: 0.18, medium: 0.32 }[q] || 0.5;
    const r = rng(90210);
    for (let g = 1; g <= 7 && P.n < cap; g++) {
      const ext = L.gridExtent(g);
      if (!ext) continue;
      const man = g <= 2;
      for (const axis of ["C", "A"]) {
        const avenue = axis === "C";
        const lns = L.lines(g, axis, avenue ? ext[2] : ext[0], avenue ? ext[3] : ext[1]);
        const lo = avenue ? ext[0] : ext[2], hi = avenue ? ext[1] : ext[3];
        for (const ln of lns) {
          if (P.n >= cap) return;
          const major = g === 1 && !avenue && L.MAJOR.includes(ln.k);
          const keep = g === 1 ? (avenue || major ? 1 : 0.75) : g === 2 ? 0.85 : avenue ? Math.min(1, outerKeep * 1.6) : outerKeep;
          if (r() > keep) continue;
          const step = man ? 30 : 45;
          // walk the line and cut it into runs of street on land, outside the parks
          let s0 = null;
          const runs = [];
          for (let t = lo; t <= hi + step; t += step) {
            let ok = t <= hi;
            if (ok) {
              const [e, n] = L.fromGrid(g, avenue ? t : ln.p, avenue ? ln.p : t);
              ok = L.gridAt(e, n) === g && L.sdfLocal(e, n) > 14 && (!man || !L.inParkAt(e, n));
            }
            if (ok && s0 == null) s0 = t;
            else if (!ok && s0 != null) { if (t - step - s0 > 90) runs.push([s0, t - step]); s0 = null; }
          }
          const highway = g === 1 && avenue && (ln.k === 0 || ln.k === 16);
          const twoWay = highway || (avenue ? (g === 1 ? ln.k === 10 : true) : (g === 1 ? major : g === 2 ? false : r() < 0.4));
          const dir1 = avenue ? ((ln.k | 0) % 2 ? 1 : -1) : ((ln.k | 0) % 2 === 0 ? 1 : -1);
          const lanes = highway ? [[-7, -1], [-3.6, -1], [3.6, 1], [7, 1]] : twoWay ? [[-ln.w * 0.22, -1], [ln.w * 0.22, 1]] : avenue ? [[-ln.w * 0.18, dir1], [ln.w * 0.12, dir1]] : [[0, dir1]];
          const dens = highway ? 0.7 : g === 1 ? (avenue ? 1 : major ? 1.3 : 2.2) : g === 2 ? 1.8 : avenue ? 2 : 3;
          const vBase = highway ? 20 : avenue ? 9 : 6.5;
          const lampC = man ? [1.0, 0.78, 0.52] : r() < 0.6 ? [1.0, 0.6, 0.26] : [0.95, 0.85, 0.68];
          for (const [a0, a1] of runs) {
            const len = a1 - a0;
            const at = (t, off) => { const [e, n] = L.fromGrid(g, avenue ? t : ln.p + off, avenue ? ln.p + off : t); return L.toWorld(e, n); };
            for (const [off, d] of lanes) {
              const [sx, sz] = at(d > 0 ? a0 : a1, off), [ex, ez] = at(d > 0 ? a1 : a0, off);
              const v = vBase * (0.85 + r() * 0.3);
              let pos = r() * 20;
              while (pos < len && P.n < cap) {
                const pal = r();
                // a few taxis' and vans' lamps are a touch warmer or dimmer: keep the stream from looking printed
                const k = pal < 0.15 ? 0.75 : pal > 0.92 ? 1.2 : 1;
                P.add(sx, G0 + 0.9, sz, ex, G0 + 0.9, ez, pos / len, v / len, 2.4, 0, k, k * (0.97 + r() * 0.03), k);
                pos += r() < 0.13 ? (40 + r() * 140) * dens : (7 + r() * 13) * dens;
              }
            }
            // street lamps along the kerbs, alternating sides
            const sp = man ? 36 : 44;
            for (let t = a0 + r() * sp, side = 1; t < a1 && P.n < cap; t += sp, side = -side) {
              const [x, z] = at(t, side * (ln.w / 2 - 0.8));
              P.dot(x, G0 + 8, z, 5, 1, lampC[0] * 0.5, lampC[1] * 0.5, lampC[2] * 0.5);
            }
          }
        }
      }
    }
  }

  /* ---------------- beacons, bridges, Times Square ---------------- */
  function buildBeacons(P) {
    const G0 = L.GROUND, red = [1.0, 0.1, 0.05];
    const top = (g, a, c, y, ph) => { const [e, n] = L.fromGrid(g, a, c), [x, z] = L.toWorld(e, n); P.dot(x, y, z, 1.8, 2, red[0] * 1.5, red[1] * 1.5, red[2] * 1.5, ph); };
    let nb = 0;
    for (const b of L.buildings) {
      if (b.h < 160) continue; // only the true high-rises: from the air a red speckle on every roof reads as noise
      const t = b.tiers[b.tiers.length - 1], ph = (b.seed % 97) / 97 * 0.15; // neighbours flash nearly, not quite, together
      const roof = G0 + (b.bulk ? b.bulk.h : t.h) + 1.2;
      if (b.bulk) top(b.g, (b.bulk.a0 + b.bulk.a1) / 2, (b.bulk.c0 + b.bulk.c1) / 2, roof, ph);
      else top(b.g, (t.a0 + t.a1) / 2, (t.c0 + t.c1) / 2, roof, ph);
      if (b.h > 260) {
        top(b.g, t.a0 + 1, t.c0 + 1, G0 + t.h + 0.8, ph); top(b.g, t.a1 - 1, t.c1 - 1, G0 + t.h + 0.8, ph);
        if (b.h > 300) { const t0 = b.tiers[0], ym = G0 + b.h * 0.5; top(b.g, t0.a0 - 0.5, t0.c1 + 0.5, ym, ph + 0.5); top(b.g, t0.a1 + 0.5, t0.c0 - 0.5, ym, ph + 0.5); }
      }
      nb++;
    }
    // landmark towers and spires (their tiers are listed for the far skyline): a light on each tall tier top
    for (const t of L.farExtra || []) {
      if (t.h < 150) continue;
      top(1, (t.a0 + t.a1) / 2, (t.c0 + t.c1) / 2, G0 + t.h + 1.5, 0.3);
      nb++;
    }
    // bridge towers (nyc-landmarks.js records them)
    for (const p of (L.lifeHooks && L.lifeHooks.beacons) || []) { P.dot(p[0], p[1], p[2], 3, 2, red[0] * 2.4, red[1] * 2.4, red[2] * 2.4, 0.6); nb++; }
    return nb;
  }
  function buildBridgeTraffic(P) {
    const r = rng(1883);
    for (const ln of (L.lifeHooks && L.lifeHooks.lanes) || []) {
      const [a, b] = ln, len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (len < 20) continue;
      const v = 12 + r() * 5;
      let pos = r() * 15;
      while (pos < len) { P.add(a[0], a[1], a[2], b[0], b[1], b[2], pos / len, v / len, 2.4, 0, 1, 1, 1); pos += r() < 0.1 ? 40 + r() * 90 : 8 + r() * 12; }
    }
  }
  function buildGlows(P) {
    // Times Square: the screens light a haze above the bow-tie, magenta to cyan
    const [e, n] = L.addr(45.3, -560), [x, z] = L.toWorld(e, n), G0 = L.GROUND;
    const cols = [[1.0, 0.3, 0.65], [0.35, 0.7, 1.0], [1.0, 0.75, 0.35], [0.6, 0.4, 1.0]];
    for (let i = 0; i < 9; i++) {
      const [ae, an] = L.addr(45.3 + (i - 4) * 0.9, -560 + ((i * 37) % 60 - 30)), [gx, gz] = L.toWorld(ae, an), c = cols[i % 4];
      P.dot(gx, G0 + 30 + (i % 3) * 18, gz, 140, 5, c[0] * 0.28, c[1] * 0.28, c[2] * 0.28);
    }
    P.dot(x, G0 + 70, z, 320, 5, 0.35, 0.28, 0.4);
  }

  /* ---------------- CPU movers: boats and aircraft ---------------- */
  const MOV = [];
  let DYN = null, DYNP = null, DCAP = 0;
  const W2 = (la, lo, y) => { const [e, n] = L.local(la, lo), [x, z] = L.toWorld(e, n); return [x, y, z]; };
  /** Is the straight run of water between two world points clear of land? (ends may touch the piers) */
  function wet(a, b) {
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.ceil(d / 40);
    for (let i = 1; i < n; i++) {
      const s = i / n, x = a[0] + (b[0] - a[0]) * s, z = a[2] + (b[2] - a[2]) * s;
      if (s * d < 160 || (1 - s) * d < 160) continue;
      const [e, nn] = L.toLocalXZ(x, z);
      if (L.ownerAt(e, nn) && L.sdfLocal(e, nn) > -8) return false;
    }
    return true;
  }
  function path(pts, loop) {
    const P = pts.slice(); if (loop) P.push(P[0]);
    const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
    return { P, cum, len: cum[cum.length - 1], loop: !!loop };
  }
  function samplePath(pa, s, out) {
    const { P, cum } = pa; let i = 1; while (i < P.length - 1 && cum[i] < s) i++;
    const a = P[i - 1], b = P[i], l = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / l));
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.z = a[2] + (b[2] - a[2]) * t;
    out.dx = (b[0] - a[0]) / l; out.dy = (b[1] - a[1]) / l; out.dz = (b[2] - a[2]) / l;
    return out;
  }
  // light rigs: [along, right, up, kind, size, r, g, b]
  const NAV = (span, len) => [[0, -span, 0, 6, 1.6, 1.4, 0.05, 0.03], [0, span, 0, 6, 1.6, 0.05, 1.3, 0.25], [-len, 0, 1, 6, 1.3, 1, 1, 1]];
  const RIG = {
    airliner: [...NAV(17, 30), [0, -17, 0, 3, 2.6, 3, 3, 3], [0, 17, 0, 3, 2.6, 3, 3, 3], [-31, 0, 2, 3, 2.2, 3, 3, 3], [4, 0, -2, 7, 2.2, 2.4, 0.1, 0.05], [22, -3, -2, 4, 7, 2.6, 2.5, 2.2], [22, 3, -2, 4, 7, 2.6, 2.5, 2.2]],
    jet: [...NAV(17, 30), [0, -17, 0, 3, 2.6, 3, 3, 3], [0, 17, 0, 3, 2.6, 3, 3, 3], [4, 0, -2, 7, 2.2, 2.4, 0.1, 0.05]],
    heli: [[0, -1.4, 0, 6, 1.1, 1.4, 0.05, 0.03], [0, 1.4, 0, 6, 1.1, 0.05, 1.3, 0.25], [-8, 0, 1.5, 6, 1, 1, 1, 1], [0, 0, 2.2, 7, 1.8, 2.4, 0.1, 0.05], [3, 0, -1.6, 4, 4, 2.2, 2.1, 1.9]],
    boat: [[0, 0, 7, 6, 1.6, 1.2, 1.15, 1], [-9, 0, 3, 6, 1.4, 1, 1, 0.95], [5, -3, 2, 6, 1.2, 1.2, 0.05, 0.03], [5, 3, 2, 6, 1.2, 0.05, 1.1, 0.25]],
    ferry: (() => { const L2 = []; for (let i = -5; i <= 5; i++) for (const s of [-6, 6]) { L2.push([i * 8, s, 5, 6, 2, 1.0, 0.7, 0.35], [i * 8, s, 8.5, 6, 2, 1.0, 0.72, 0.4]); } L2.push([44, 0, 16, 6, 2, 1.2, 1.2, 1.1], [-44, 0, 16, 6, 2, 1.2, 1.2, 1.1], [30, -7, 10, 6, 1.6, 1.3, 0.05, 0.03], [30, 7, 10, 6, 1.6, 0.05, 1.2, 0.25]); return L2; })(),
    ship: (() => { const L2 = [[140, 0, 30, 6, 2, 1.2, 1.2, 1.1], [-110, 0, 38, 6, 2, 1.2, 1.2, 1.1], [-120, -4, 30, 6, 1.6, 1, 0.75, 0.45], [-120, 4, 30, 6, 1.6, 1, 0.75, 0.45], [-120, 0, 26, 6, 1.6, 1, 0.75, 0.45], [120, -16, 12, 6, 1.6, 1.3, 0.05, 0.03], [120, 16, 12, 6, 1.6, 0.05, 1.2, 0.25]]; for (let i = -100; i <= 120; i += 40) L2.push([i, 0, 24, 6, 1.2, 0.5, 0.45, 0.35]); return L2; })()
  };
  function buildMovers() {
    MOV.length = 0;
    const r = rng(1626);
    const add = (pa, rig, n, v, mode, yJ) => { for (let i = 0; i < n; i++) MOV.push({ pa, rig: RIG[rig], v: v * (0.9 + r() * 0.2), s: pa.len * (i / n + r() * 0.2 / n), dir: 1, mode, yJ: yJ || 0 }); };
    const water = (pts, y) => { const P = pts.map(([la, lo]) => W2(la, lo, y)); for (let i = 1; i < P.length; i++) if (!wet(P[i - 1], P[i])) return null; return path(P); };
    const G0 = L.GROUND;
    // the harbour: ferries, tugs, a ship in the Narrows
    const HUD = [[40.700, -74.030], [40.720, -74.024], [40.745, -74.018], [40.770, -74.002], [40.800, -73.981], [40.830, -73.962], [40.848, -73.955]];
    const EAST = [[40.6990, -74.0060], [40.7040, -73.9990], [40.7058, -73.9963], [40.7076, -73.9915], [40.7100, -73.9800], [40.7142, -73.9713], [40.7250, -73.9700], [40.7400, -73.9680], [40.7520, -73.9620]];
    const SIF = [[40.6437, -74.0715], [40.6600, -74.0550], [40.6900, -74.0250], [40.7005, -74.0135]];
    const BAY = [[40.700, -74.022], [40.685, -74.035], [40.670, -74.045], [40.650, -74.050], [40.625, -74.050], [40.600, -74.042], [40.575, -74.030]];
    const routes = { hudson: water(HUD, G0 - 3), east: water(EAST, G0 - 3), ferry: water(SIF, G0 - 3), bay: water(BAY, G0 - 3) };
    if (routes.ferry) add(routes.ferry, "ferry", 2, 8, "pingpong");
    if (routes.hudson) add(routes.hudson, "boat", 4, 7, "pingpong");
    if (routes.east) add(routes.east, "boat", 4, 6, "pingpong");
    if (routes.bay) { add(routes.bay, "boat", 3, 6, "pingpong"); add(routes.bay, "ship", 1, 5, "pingpong"); }
    LIFE.routes = Object.keys(routes).filter((k) => routes[k]);
    // the Hudson River helicopter corridor, and the Statue of Liberty tours
    add(path(HUD.map(([la, lo]) => W2(la, lo, 290))), "heli", 3, 45, "pingpong");
    const lib = W2(40.6892, -74.0445, 0), loop = [];
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; loop.push([lib[0] + Math.cos(a) * 520, 260, lib[2] + Math.sin(a) * 520]); }
    add(path(loop, true), "heli", 2, 32, "loop");
    // airliners: arrivals sinking across the city towards LaGuardia and JFK, departures climbing out over the harbour
    const air = (a, b, n, v, rig) => add(path([W2(a[0], a[1], a[2]), W2(b[0], b[1], b[2])]), rig || "airliner", n, v, "once");
    air([40.98, -73.70, 1500], [40.79, -73.86, 300], 2, 72);
    air([40.52, -73.62, 1300], [40.635, -73.765, 260], 2, 72);
    air([40.69, -74.17, 250], [40.50, -74.40, 2300], 1, 85);
    air([40.94, -74.25, 3400], [40.45, -73.62, 3600], 1, 220, "jet");
    air([40.88, -73.55, 4200], [40.55, -74.45, 4000], 1, 230, "jet");
    DCAP = 0; for (const m of MOV) DCAP += m.rig.length;
    DYN = new PB();
    for (let i = 0; i < DCAP; i++) DYN.dot(0, -1e5, 0, 1, 6, 0, 0, 0);
    DYNP = DYN.points();
    DYNP.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    DYNP.geometry.attributes.aK.setUsage(THREE.DynamicDrawUsage);
    DYNP.geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
    return DYNP;
  }
  const _s = {};
  function updateMovers(dt, cam) {
    if (!DYNP) return;
    const pos = DYNP.geometry.attributes.position.array, K = DYNP.geometry.attributes.aK.array, C = DYNP.geometry.attributes.color.array;
    let o = 0;
    const cp = cam.position;
    for (let mi = 0; mi < MOV.length; mi++) {
      const m = MOV[mi], len = m.pa.len;
      m.s += m.v * dt * m.dir;
      if (m.mode === "pingpong") { if (m.s > len) { m.s = len; m.dir = -1; } else if (m.s < 0) { m.s = 0; m.dir = 1; } }
      else m.s = ((m.s % len) + len) % len;
      const S = samplePath(m.pa, m.s, _s);
      const sg = m.mode === "pingpong" ? m.dir : 1;
      let fx = S.dx * sg, fy = S.dy * sg, fz = S.dz * sg;
      const hl = Math.hypot(fx, fz) || 1, rx = -fz / hl, rz = fx / hl;
      // airliners fade in and out at the ends of their long legs, far from the city
      const endK = m.mode === "once" ? Math.min(1, m.s / 2500, (len - m.s) / 2500) : 1;
      const near = Math.hypot(S.x - cp.x, S.y - cp.y, S.z - cp.z) < 60; // the player flying through a helicopter: hide it
      for (let j = 0; j < m.rig.length; j++, o++) {
        const L2 = m.rig[j], i3 = o * 3, i4 = o * 4;
        pos[i3] = S.x + fx * L2[0] + rx * L2[1]; pos[i3 + 1] = S.y + fy * L2[0] + L2[2]; pos[i3 + 2] = S.z + fz * L2[0] + rz * L2[1];
        K[i4] = mi * 0.137; K[i4 + 1] = 0; K[i4 + 2] = L2[4]; K[i4 + 3] = L2[3];
        const k = near ? 0 : endK;
        C[i3] = L2[5] * k; C[i3 + 1] = L2[6] * k; C[i3 + 2] = L2[7] * k;
      }
    }
    DYNP.geometry.attributes.position.needsUpdate = true; DYNP.geometry.attributes.aK.needsUpdate = true; DYNP.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- build and per-frame ---------------- */
  function build() {
    const t0 = performance.now();
    const P = new PB();
    let nb = 0;
    try { nb = buildBeacons(P); } catch (e) { console.warn("NYC beacons", e); }
    try { buildGlows(P); } catch (e) { console.warn("NYC glows", e); }
    try { buildBridgeTraffic(P); } catch (e) { console.warn("NYC bridge traffic", e); }
    const grp = new THREE.Group(); grp.name = "nyc-life";
    LIFE.pts = P.points(); grp.add(LIFE.pts);
    try { grp.add(buildMovers()); } catch (e) { console.warn("NYC movers", e); }
    L.group.add(grp);
    LIFE.grp = grp; LIFE.built = true;
    LIFE.stats = { points: P.n, beacons: nb, movers: MOV.length, moverLights: DCAP, routes: LIFE.routes, ms: Math.round(performance.now() - t0) };
  }
  /** The street layer (~100k lights) waits for the first dusk: by day it would draw nothing. */
  function buildStreetLayer() {
    const t0 = performance.now(), q = RJ.settings.quality;
    const cap = { low: 30000, medium: 70000, ultra: 190000 }[q] || 130000;
    const P = new PB();
    try { buildStreets(P, cap); } catch (e) { console.warn("NYC street lights", e); }
    LIFE.streets = P.points(); LIFE.grp.add(LIFE.streets);
    Object.assign(LIFE.stats, { streetPoints: P.n, streetMs: Math.round(performance.now() - t0) });
  }
  const _v = new THREE.Vector2();
  LIFE.update = function (dt, cam) {
    if (!L.ready) return;
    const night = L.night || 0;
    if (!LIFE.built) { LIFE.built = true; try { build(); } catch (e) { console.warn("NYC life", e); return; } }
    if (!LIFE.grp) return;
    if (!LIFE.streets && night > 0.02) { LIFE.streets = true; try { buildStreetLayer(); } catch (e) { console.warn("NYC streets", e); } }
    LIFE.grp.visible = L.group.visible;
    const U = MAT.uniforms, W = RJ.world;
    U.uTime.value = (U.uTime.value + dt) % 7200;
    U.uNight.value = night;
    W.renderer.getDrawingBufferSize(_v); U.uViewH.value = _v.y;
    const fog = W.scene.fog;
    if (fog && fog.far) { U.uFogNear.value = Math.max(5000, fog.near * 1.3); U.uFogFar.value = Math.max(14000, fog.far * 2.2); }
    const cp = cam.position, q = RJ.settings.quality;
    U.uNearFade.value = q !== "low" && cp.y < 1400 && L.within(cp.x, cp.z, -3000) ? 1 : 0;
    updateMovers(Math.min(dt, 0.1), cam);
  };
  L.lifeStats = () => LIFE.stats || null;
})(window.RJ);
