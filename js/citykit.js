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
  // aWin: x style, y lit share, z crown light, w seed · aBase: the building's ground level (floors and lobbies count from it)
  // styles: 0 punched · 1 ribbon · 2 curtain wall · 3 fins · 4 dense residential grid with balconies and AC units
  //         5 balcony slabs · 6 diagrid · 7 lantern (all glass, glows at night) · 8 helipad roof · 9 plain metal
  //         10 foliage · 11 paving · 12 lawn
  const WET = { value: 0 };
  K.WET = WET;
  /** Wetness follows the local rain (fast to soak, slow to dry); shared by every city's facades and streets. */
  let wetT = 0;
  K.wetTick = function (dt) {
    const t = performance.now(); if (t - wetT < 4) return; wetT = t;
    const wet = RJ.clamp(((RJ.weather && RJ.weather.rain) || 0) * 1.6, 0, 1);
    WET.value += (wet - WET.value) * Math.min(1, dt * (wet > WET.value ? 0.25 : 0.03));
  };
  const FACADE = [
    "varying vec4 vWin; varying vec3 vCW; varying vec3 vCN; varying vec2 vSpan; varying vec2 vUv2; varying vec3 vScl; varying float vBase; varying float vShp; varying float vFW;",
    "uniform float rjNight; uniform float rjWet; uniform float rjGlass; uniform vec3 rjRoof; uniform vec3 rjRoof2; uniform vec3 rjWarm; uniform vec3 rjCool; uniform vec3 rjCrown;",
    "float kh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
    "float kn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(kh(i), kh(i + vec2(1.0, 0.0)), f.x), mix(kh(i + vec2(0.0, 1.0)), kh(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "float kb(vec2 p, vec2 a, vec2 b, vec2 w){ vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p)); return s.x * s.y; }",
    "vec3 fCol; float fRough; float fMetal; vec3 fNW; vec3 fEm;",
    "void rjCity(vec3 base){",
    "  float st = vWin.x, sd = vWin.w;",
    "  float hs = kh(vec2(sd, 1.7)), hs2 = kh(vec2(sd * 1.31, 9.1)), hs3 = kh(vec2(sd * 0.77, 31.3));",
    "  vec3 N = normalize(vCN);",
    "  fCol = base; fRough = 0.8; fMetal = 0.0; fNW = vec3(0.0); fEm = vec3(0.0);",
    "  float wetR = 1.0 - 0.5 * rjWet;",
    // ---- foliage and lawns ----
    "  if (st > 9.5 && st < 10.5) { float n = kn(vCW.xz * 0.45 + vCW.y * 0.6) * 0.6 + kn(vCW.xz * 0.09) * 0.4; fCol = base * (0.62 + 0.62 * n) * (0.75 + 0.35 * clamp(N.y + 0.5, 0.0, 1.0)); fRough = 0.92; return; }",
    "  if (st > 11.5) { float pw = fwidth(vCW.x); float n = mix(kn(vCW.xz * 0.5), 0.5, smoothstep(0.4, 2.0, pw)) * 0.5 + kn(vCW.xz * 0.04) * 0.5;",
    "    float paths = 1.0 - smoothstep(1.2, 1.8, abs(fract(dot(vCW.xz, vec2(0.0118, 0.0071)) + sd) - 0.5) * 70.0);",
    "    fCol = mix(base * (0.7 + 0.55 * n), vec3(0.62, 0.58, 0.5), paths * (1.0 - smoothstep(0.5, 3.0, pw))); fRough = 0.95; return; }",
    "  if (st > 12.5) {",                                                           // container stacks: one colour per box, corrugated sides
    "    vec3 T0 = normalize(vec3(-N.z, 0.0, N.x)); float u0 = vUv2.x * vFW, v0 = vCW.y - vBase;",
    "    vec2 cc = vec2(floor(u0 / (vFW > 20.0 ? 12.2 : 2.5)), floor(v0 / 2.59)); float hc = kh(cc + sd);",
    "    vec3 cpal = hc < 0.18 ? vec3(0.6, 0.12, 0.08) : hc < 0.34 ? vec3(0.1, 0.25, 0.5) : hc < 0.48 ? vec3(0.75, 0.75, 0.72) : hc < 0.6 ? vec3(0.1, 0.4, 0.25) : hc < 0.72 ? vec3(0.8, 0.45, 0.1) : hc < 0.84 ? vec3(0.45, 0.3, 0.2) : vec3(0.2, 0.55, 0.65);",
    "    float pw0 = fwidth(u0); float rib = sin(u0 * 20.9) * (1.0 - smoothstep(0.05, 0.3, pw0));",
    "    float seam = 1.0 - smoothstep(0.03, 0.03 + fwidth(v0 / 2.59) + 0.01, min(fract(v0 / 2.59), 1.0 - fract(v0 / 2.59)));",
    "    fCol = cpal * (0.85 + 0.15 * rib) * (1.0 - seam * 0.5); fRough = 0.55 * wetR; fMetal = 0.3; fNW = T0 * rib * 0.25 * (1.0 - step(0.5, abs(N.y))); return;",
    "  }",
    // ---- undersides: shadowed soffits ----
    "  if (N.y < -0.5) { fCol = base * 0.45; fRough = 0.9; return; }",
    // ---- roofs and decks ----
    "  if (N.y > 0.5) {",
    "    vec2 ed = min(vUv2, 1.0 - vUv2) * vScl.xz; float rim = abs(vShp) < 0.5 ? min(ed.x, ed.y) : (0.5 - length(vUv2 - 0.5)) * vScl.x;",
    "    float pw = fwidth(vCW.x);",
    "    float g = mix(kn(vCW.xz * 0.8), 0.5, smoothstep(0.3, 1.5, pw)) * 0.5 + mix(kn(vCW.xz * 0.07), 0.5, smoothstep(4.0, 14.0, pw)) * 0.5;",
    "    if (st > 10.5) {",                                                        // plaza paving: 3 m slabs with joints
    "      vec2 tq = fract(vCW.xz / 3.0); float j = 1.0 - kb(tq, vec2(0.04), vec2(0.96), vec2(pw / 3.0 + 0.01));",
    "      fCol = base * (0.85 + g * 0.3) * (1.0 - j * 0.28 * (1.0 - smoothstep(0.2, 0.9, pw))); fRough = 0.72 * wetR; return; }",
    "    if (st > 8.5) { fCol = base * 0.8; fRough = 0.45; fMetal = 0.5; return; }",
    "    if (N.y < 0.93 && vShp < -1.5 && st < 7.5) {",                           // pitched roofs: tiles in the city's roof colours
    "      vec3 rt = mix(rjRoof, rjRoof2, step(0.5, hs)) * (0.8 + 0.35 * hs2) * (0.9 + 0.2 * g);",
    "      float row = 1.0 - smoothstep(0.08, 0.08 + fwidth(vCW.y * 3.0) + 0.02, fract(vCW.y * 3.0));",
    "      fCol = rt * (1.0 - row * 0.25 * (1.0 - smoothstep(0.2, 0.8, pw))); fRough = mix(0.7, 0.25, rjWet); return;",
    "    }",
    "    vec3 tar = vec3(0.16, 0.16, 0.17), mem = vec3(0.6, 0.6, 0.58), grv = vec3(0.37, 0.35, 0.32), grn = vec3(0.24, 0.35, 0.17), dek = vec3(0.42, 0.33, 0.24);",
    "    vec3 rc = hs < 0.2 ? mem : hs < 0.28 ? grn : hs < 0.34 ? dek : hs < 0.66 ? grv : tar;",
    "    rc = mix(rc, base * 0.5 + 0.05, 0.22) * (0.84 + g * 0.3);",
    // membrane seams and paver grid on bright roofs
    "    if (hs < 0.2 || (hs >= 0.28 && hs < 0.34)) { vec2 q = fract(vCW.xz / (hs < 0.2 ? 6.0 : 1.2)); rc *= 1.0 - 0.18 * (1.0 - kb(q, vec2(0.03), vec2(0.97), vec2(pw * 0.2 + 0.01))) * (1.0 - smoothstep(0.3, 1.2, pw)); }",
    "    float par = 1.0 - smoothstep(0.75 - pw, 0.75 + pw, rim);",                // parapet coping
    "    rc = mix(rc, base * 0.75 + 0.12, par * step(st, 7.5));",
    "    rc *= mix(0.72, 1.0, smoothstep(0.75, 2.6, rim));",                        // parapet shadow line
    "    if (st > 7.5 && st < 8.5) {",                                              // helipad: dark pad, ring, H
    "      vec2 q = (vUv2 - 0.5) * vScl.xz; float R = length(q), rr = vScl.x * 0.5;",
    "      float ring = 1.0 - smoothstep(0.5, 0.5 + pw, abs(R - rr * 0.72));",
    "      float Hm = (step(abs(q.x), rr * 0.25) * step(abs(q.y), rr * 0.32)) * (step(rr * 0.17, abs(q.x)) + step(abs(q.y), rr * 0.05));",
    "      rc = mix(vec3(0.11, 0.12, 0.13), vec3(0.95, 0.8, 0.15), ring); rc = mix(rc, vec3(0.92), clamp(Hm, 0.0, 1.0));",
    "      fEm += vec3(1.0, 0.25, 0.1) * (1.0 - smoothstep(0.4, 0.9, abs(R - rr * 0.92))) * step(0.5, fract(atan(q.y, q.x) * 2.546)) * rjNight * 3.0;",
    "    }",
    "    fCol = rc; fRough = mix(0.9, 0.3, rjWet); fMetal = 0.0; return;",
    "  }",
    "  if (st > 8.5 && st < 9.5) { fCol = base; fRough = 0.32 * wetR; fMetal = 0.65; return; }",   // plain metal: masts, plant, cranes
    "  if (st > 10.5 && st < 12.5) { float n = kn(vCW.xz * 0.2 + vCW.y * 0.3); fCol = base * (0.85 + 0.25 * n) * mix(0.75, 1.0, smoothstep(0.0, 3.0, vCW.y - vBase)); fRough = 0.85 * wetR; return; }",
    // ---- walls ----
    "  vec3 T3 = normalize(vec3(-N.z, 0.0, N.x));",
    "  float u = vShp > -1.5 && vShp < -0.5 ? vUv2.x * 1.5708 * (vScl.x + vScl.z) : dot(vCW.xz, T3.xz), v = vCW.y - vBase, vp = vCW.y - vSpan.x, H = vSpan.y - vSpan.x;",
    "  bool G = rjGlass > 0.5;",
    "  float fl = (st > 3.5 && st < 5.5 ? 3.0 : 3.6) + hs3 * 0.5;",               // each building its own floor height
    "  float bay = st < 0.5 ? 2.6 + hs2 * 1.2 : st < 1.5 ? 3.2 : st < 2.5 ? 1.35 + hs2 * 0.5 : st < 3.5 ? 1.25 : st < 4.5 ? 2.2 + hs2 * 0.8 : st < 5.5 ? 4.0 + hs2 * 1.5 : st < 6.5 ? 1.5 : 1.5;",
    "  float lob = v < 6.5 + hs * 2.0 && vSpan.y - vBase > 16.0 ? 1.0 : 0.0;",                                // lobby / storefront band
    "  float cu = u / bay, cv = (v - 0.4) / fl, fx = fract(cu), fy = fract(cv), bi = floor(cu), fi = floor(cv);",
    "  float pu = fwidth(cu), pv = fwidth(cv); vec2 aa = vec2(pu, pv) * 0.8 + 0.004;",
    "  float far = smoothstep(0.4, 1.1, max(pu, pv));",
    "  float x0 = 0.2, x1 = 0.8, y0 = 0.22, y1 = 0.8, gf = 0.3;",
    "  if (st < 0.5) { x0 = 0.2 + hs * 0.08; x1 = 1.0 - x0; y0 = 0.22; y1 = 0.78; gf = 0.32; }",
    "  else if (st < 1.5) { x0 = 0.0; x1 = 1.0; y0 = 0.38 + hs * 0.08; y1 = 0.94; gf = 0.55; }",
    "  else if (st < 2.5) { x0 = 0.035; x1 = 0.965; y0 = 0.12; y1 = 0.985; gf = 0.88; }",
    "  else if (st < 3.5) { x0 = 0.0; x1 = 0.58; y0 = 0.06; y1 = 0.94; gf = 0.5; }",
    "  else if (st < 4.5) { x0 = 0.14; x1 = 0.86; y0 = 0.2; y1 = 0.72; gf = 0.36; }",
    "  else if (st < 5.5) { x0 = 0.02; x1 = 0.98; y0 = 0.16; y1 = 0.9; gf = 0.6; }",
    "  else { x0 = 0.03; x1 = 0.97; y0 = 0.06; y1 = 0.97; gf = 0.9; }",
    "  float win = kb(vec2(fx, fy), vec2(x0, y0), vec2(x1, y1), aa);",
    "  if (st > 0.5 && st < 1.5) win *= 1.0 - (1.0 - smoothstep(0.0, 0.02 + aa.x, abs(fx - 0.5) - 0.48));",   // ribbon mullions
    // corners: pilasters / corner mullions on boxes and polygon prisms
    "  float fw = vShp > 0.5 ? sin(3.14159 / vShp) * vScl.x : vFW;",
    "  float ex = vShp > -0.5 ? min(fract(vUv2.x * max(vShp, 1.0)), 1.0 - fract(vUv2.x * max(vShp, 1.0))) * fw : 99.0;",
    "  float corner = 1.0 - smoothstep(0.6, 0.6 + fwidth(ex) + 0.05, ex);",
    // materials: glass towers get metal frames and tinted glass, stone towers textured masonry and dark glazing
    "  vec3 tint = base * (0.86 + hs2 * 0.28);",
    "  vec3 wall, glz; float wR, wM, gR, gM;",
    "  if (G) { wall = mix(tint * 0.55, vec3(0.62, 0.64, 0.66), 0.45 + hs * 0.3); glz = tint * (0.55 + hs3 * 0.25) + 0.02; wR = 0.38; wM = 0.75; gR = 0.04 + hs * 0.06; gM = 0.9; }",
    "  else { wall = tint; glz = mix(vec3(0.04, 0.055, 0.07), vec3(0.1, 0.12, 0.13), hs3); wR = 0.84; wM = 0.02; gR = 0.08; gM = 0.6; }",
    "  if (!G) {",                                                                   // masonry texture, weathering streaks, grime at the base
    "    float pw = fwidth(u);",
    "    float tx = mix(kn(vec2(u, v) * vec2(1.8, 4.0)), 0.5, smoothstep(0.08, 0.35, pw)) * 0.35 + mix(kn(vec2(u, v) * 0.3), 0.5, smoothstep(1.0, 5.0, pw)) * 0.65;",
    "    float streak = mix(kn(vec2(u * 0.9, v * 0.035 + sd)), 0.5, smoothstep(0.5, 3.0, pw));",
    "    wall *= (0.88 + tx * 0.2) * (1.0 - 0.14 * smoothstep(0.45, 0.85, streak));",
    "  }",
    "  wall *= mix(0.66, 1.0, smoothstep(0.0, 22.0, v));",
    // style details
    "  vec3 col; float wk;",
    "  float wh = kh(vec2(bi, fi) + sd * 0.013);",
    "  vec3 gl = glz;",
    "  if (!G || st < 1.5) { if (wh < 0.24) gl = mix(glz, vec3(0.33, 0.3, 0.25), 0.5); else if (wh > 0.92) gl = mix(glz, vec3(0.45, 0.45, 0.43), 0.35); }",   // blinds and curtains
    "  else { gl *= 0.88 + 0.24 * kh(vec2(bi * 0.37, fi * 1.7) + sd); }",          // curtain wall panels never quite match
    "  col = mix(wall, gl, win);",
    "  if (st > 1.5 && st < 2.5 && fy < y0) col = mix(gl, wall, 0.45);",           // spandrel glass
    "  if (st > 2.5 && st < 3.5) { col = mix(wall * 0.92, gl, win); }",
    "  float slab = 0.0, rail = 0.0, ac = 0.0;",
    "  if (st > 3.5 && st < 4.5) {",                                                // dense residential: balcony slab, rail, AC box
    "    slab = 1.0 - smoothstep(0.08, 0.08 + aa.y, fy); rail = kb(vec2(fx, fy), vec2(0.0, 0.08), vec2(1.0, 0.2), aa) * step(0.45, kh(vec2(floor(bi / 2.0), fi) + sd));",
    "    ac = kb(vec2(fx, fy), vec2(0.86, 0.22), vec2(0.98, 0.42), aa) * step(0.6, wh);",
    "    col = mix(col, wall * 1.12 + 0.04, slab); col = mix(col, mix(wall * 0.8, vec3(0.5, 0.56, 0.6), 0.5), rail * 0.8); col = mix(col, vec3(0.75, 0.75, 0.72), ac);",
    "  }",
    "  if (st > 4.5 && st < 5.5) {",                                                // balcony slabs with glass rails and deep recesses
    "    slab = 1.0 - smoothstep(0.1, 0.1 + aa.y, fy); rail = kb(vec2(fx, fy), vec2(0.0, 0.1), vec2(1.0, 0.36), aa);",
    "    col = mix(gl * 0.75, wall * 1.1 + 0.05, slab); col = mix(col, mix(col, vec3(0.55, 0.65, 0.68), 0.35), rail);",
    "    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.1, 0.24, fy)) * (1.0 - slab);",   // shadow under the slab
    "  }",
    "  if (st > 5.5 && st < 6.5) {",                                                // diagrid members across the glass
    "    float D = 6.0 * fl; float d1 = abs(fract((u + vCW.y) / D) - 0.5) * D, d2 = abs(fract((u - vCW.y) / D) - 0.5) * D;",
    "    float dg = 1.0 - smoothstep(0.55, 0.55 + fwidth(u) * 1.5 + 0.05, min(d1, d2));",
    "    col = mix(col, wall * 1.15, dg); win *= 1.0 - dg;",
    "  }",
    "  if (lob > 0.5) {",                                                           // double-height lobby glazing, canopy line
    "    float lw = kb(vec2(fract(u / 6.0), v), vec2(0.05, 0.4), vec2(0.95, 5.6), vec2(aa.x * 0.25, 0.05));",
    "    col = mix(wall * 0.85, vec3(0.06, 0.07, 0.08), lw); win = lw;",
    "    col = mix(col, wall * 0.5, (1.0 - smoothstep(0.0, 0.15, abs(v - 5.9))) * 0.8);",
    "  }",
    "  col = mix(col, G ? wall * 1.1 : wall * 1.06, corner);",
    "  win *= 1.0 - corner;",
    "  vec3 avg = mix(wall, glz, gf);",
    "  col = mix(col, avg, far); wk = mix(win, gf, far);",
    "  fCol = col * (1.0 - 0.2 * rjWet * (1.0 - wk));",
    "  fRough = mix(wR, gR, wk) * wetR; fMetal = mix(wM, gM, wk);",
    // relief: window reveals, fins, slabs and curtain-wall panel warp tilt the normal so the sun picks them out
    "  if (far < 0.95) {",
    "    float k = 1.0 - far;",
    "    if (!G || st < 1.5 || st > 3.5) {",
    "      float dl = (1.0 - smoothstep(0.0, 0.05, abs(fx - x0))) - (1.0 - smoothstep(0.0, 0.05, abs(fx - x1)));",
    "      float db = (1.0 - smoothstep(0.0, 0.07, abs(fy - y0))) * 0.9 - (1.0 - smoothstep(0.0, 0.06, abs(fy - y1))) * 0.5;",
    "      fNW += (T3 * dl * 0.4 + vec3(0.0, db * 0.5 + slab * 0.6, 0.0)) * k;",
    "      fCol *= 1.0 - (1.0 - smoothstep(0.0, 0.05, abs(fy - y1))) * 0.3 * win * k;",
    "    }",
    "    if (st > 2.5 && st < 3.5) fNW += T3 * (fx > 0.58 ? (fx < 0.79 ? 0.7 : -0.7) : 0.0) * k;",
    "    if (G && st > 1.5) { float pj = kh(vec2(bi, fi) * 1.7 + sd); fNW += (T3 * (pj - 0.5) * 0.06 + vec3(0.0, kh(vec2(fi, bi)) - 0.5, 0.0) * 0.05) * k; }",
    "  }",
    // ---- night: offices light by floor, homes by window; lobbies, crowns, LED corners, lantern tops ----
    "  if (rjNight > 0.01) {",
    "    float office = G || (st > 0.5 && st < 3.5) ? 1.0 : 0.0;",
    "    float rh = office > 0.5 ? kh(vec2(fi, floor(bi / 7.0)) + sd * 0.07) : wh;",
    "    float lit = step(1.0 - vWin.y, rh);",
    "    float wc = kh(vec2(bi * 1.3, fi * 0.7) + sd);",
    "    vec3 lc = mix(rjWarm, rjCool, office > 0.5 ? step(0.45, hs3) : step(0.82, wc)) * (0.62 + 0.55 * wc);",
    "    if (office < 0.5 && wc > 0.95) lc = vec3(0.45, 0.6, 1.0);",                // the odd TV glow
    "    float ceil = 0.75 + 0.45 * smoothstep(0.3, 0.95, fy);",
    "    float cl = step(1.0 - vWin.y * 0.8, kh(floor(vec2(u / (bay * 3.0), v / (fl * 2.0))) + sd * 0.3));",   // far: whole lit offices / flats in patches
    "    vec3 gw = mix(lc * win * lit * ceil, lc * cl * gf * 0.55, far);",
    "    fEm += gw * 1.5;",
    "    fEm += rjWarm * lob * win * 1.4;",
    "    fEm += rjCrown * vWin.z * (smoothstep(H - 7.0, H - 5.0, vp) * 2.2 + smoothstep(H * 0.8, H, vp) * 0.25);",
    "    if (G && hs < 0.3) fEm += rjCrown * corner * (0.6 + 0.6 * vWin.z) * 1.6;",
    "    if (st > 6.5 && st < 7.5) fEm += mix(rjCrown, rjWarm, 0.4) * (0.5 + 0.5 * win) * 1.2;",
    "    fEm *= rjNight;",
    "  }",
    "}"
  ].join("\n");
  function facadeMat(glass, P) {
    const m = new THREE.MeshStandardMaterial({ roughness: glass ? 0.22 : 0.78, metalness: glass ? 0.55 : 0.06, envMapIntensity: glass ? 1.35 : 0.8 });
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = NIGHT; sh.uniforms.rjWet = WET;
      sh.uniforms.rjGlass = { value: glass ? 1 : 0 };
      sh.uniforms.rjRoof = { value: new THREE.Color(P.roof || 0x8a4a32) }; sh.uniforms.rjRoof2 = { value: new THREE.Color(P.roof2 || 0x5a5c60) };
      sh.uniforms.rjWarm = { value: new THREE.Color(P.warm) };
      sh.uniforms.rjCool = { value: new THREE.Color(P.cool) };
      sh.uniforms.rjCrown = { value: new THREE.Color(P.crown) };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aWin; attribute float aBase; attribute float aShp; varying vec4 vWin; varying vec3 vCW; varying vec3 vCN; varying vec2 vSpan; varying vec2 vUv2; varying vec3 vScl; varying float vBase; varying float vShp; varying float vFW;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "vec4 rjWp = vec4(transformed, 1.0); vec3 rjNo = objectNormal;",
          "#ifdef USE_INSTANCING",
          "rjWp = instanceMatrix * rjWp; rjNo = mat3(instanceMatrix) * rjNo;",
          "vSpan = vec2((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y, (instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y);",
          "vScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));",
          "#else",
          "vSpan = vec2(0.0, 1.0); vScl = vec3(1.0);",
          "#endif",
          "vCW = (modelMatrix * rjWp).xyz; vCN = normalize(mat3(modelMatrix) * rjNo); vWin = aWin; vBase = aBase; vShp = aShp; vUv2 = uv;",
          "vFW = abs(objectNormal.x) > 0.5 ? vScl.z : vScl.x;"
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + FACADE)
        .replace("#include <color_fragment>", "#include <color_fragment>\nrjCity(diffuseColor.rgb); diffuseColor.rgb = fCol * (1.0 - 0.55 * rjNight);")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = fRough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(fNW, 0.0)).xyz);")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEm;");
    };
    return m;
  }

  /* ======================= unit shapes (base at y = 0, top at y = 1) ======================= */
  const SHAPES = {};
  function shapes() {
    if (SHAPES.box) return SHAPES;
    // aShp: 0 box (corners from the face UVs), n = n-sided prism, -1 round (no corners)
    const up = (g, n) => { g.translate(0, 0.5, 0); g.setAttribute("aShp", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(n), 1)); return g; };
    SHAPES.box = up(new THREE.BoxGeometry(1, 1, 1), 0);
    SHAPES.cyl = up(new THREE.CylinderGeometry(0.5, 0.5, 1, 22, 1), -1);
    SHAPES.oct = up(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1), 8);
    const tp = new THREE.CylinderGeometry(0.33, 0.5, 1, 4, 1); tp.rotateY(Math.PI / 4); tp.scale(1.414, 1, 1.414); SHAPES.taper = up(tp, 4);
    SHAPES.tri = up(new THREE.CylinderGeometry(0.58, 0.58, 1, 3, 1), 3);
    SHAPES.cone = up(new THREE.CylinderGeometry(0.02, 0.5, 1, 8, 1), -1);
    // gable house: walls to 0.62, pitched roof to 1 (ridge along z)
    const gs = new THREE.Shape(); gs.moveTo(-0.5, 0); gs.lineTo(0.5, 0); gs.lineTo(0.5, 0.62); gs.lineTo(0, 1); gs.lineTo(-0.5, 0.62); gs.lineTo(-0.5, 0);
    const gg = new THREE.ExtrudeGeometry(gs, { depth: 1, bevelEnabled: false }); gg.translate(0, 0, -0.5); gg.translate(0, -0.5, 0); SHAPES.gable = up(gg, -2);
    // tree crowns: a squashed low-poly blob (broadleaf) and a cone (conifer / cypress); palms get a flat star
    const blob = new THREE.IcosahedronGeometry(0.5, 0); SHAPES.tree = up(blob, -1);
    SHAPES.pine = up(new THREE.CylinderGeometry(0.0, 0.5, 1, 7, 1), -1);
    const palm = new THREE.CylinderGeometry(0.5, 0.05, 1, 7, 1); SHAPES.palm = up(palm, -1);
    return SHAPES;
  }

  /* ======================= builder ======================= */
  /** Collects instances: tower pieces, roof clutter, collision footprints. */
  class Batch {
    constructor() { this.L = {}; this.foot = []; this.tall = []; this.base = null; this.lights = []; }
    add(shape, glass, x, y, z, sx, h, sz, ry, col, st, lit, crown) {
      const k = shape + (glass ? "G" : "S");
      (this.L[k] = this.L[k] || []).push(x, y, z, sx, h, sz, ry, col, st, lit, crown, this.seed != null ? this.seed : Math.random() * 97, this.base != null ? this.base : y);
    }
    /** A tree: trunk and crown (kind: tree · pine · palm). */
    treeAt(x, y, z, h, col, kind) {
      const k = kind || "tree", cw = k === "pine" ? h * 0.42 : k === "palm" ? h * 0.55 : h * 0.62;
      this.add("box", false, x, y, z, k === "palm" ? 0.5 : 0.35 + h * 0.03, h * (k === "palm" ? 0.92 : 0.45), k === "palm" ? 0.5 : 0.35 + h * 0.03, 0, 0x5a4634, 9, 0, 0);
      this.add(k, false, x, y + h * (k === "pine" ? 0.18 : k === "palm" ? 0.86 : 0.32), z, cw, k === "pine" ? h * 0.85 : k === "palm" ? h * 0.18 : h * 0.62, cw, Math.random() * 6.3, col, 10, 0, 0);
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
    let st = o.st != null ? o.st : glass ? pick(P.gstyles || [2, 2, 2, 1, 6], r) : pick(P.styles || [0, 0, 1, 3, 4], r);
    const lit = o.lit != null ? o.lit : RJ.lerp(0.28, 0.55, r());
    let form = o.form;
    if (!form) {
      if (h < 45) form = r() < 0.12 && w > 26 ? "slab" : "box";
      else if (h < 140) form = pick(["box", "box", "podium", "oct", "notch", "slab", "ellipse", "stepped"], r);
      else form = pick(P.forms || ["setback", "taper", "cyl", "podium", "twist", "notch", "tri", "setback"], r);
      if (h > 200 && r() < 0.18) form = pick(["skygarden", "deck", "stepped", "ellipse"], r);
    }
    if (form === "slab" && o.st == null && !glass) st = 5;
    if (glass && o.st == null && (form === "cyl" || form === "ellipse") && r() < 0.35) st = 6;
    const crown = o.crown != null ? o.crown : h > 120 && r() < (P.crownP != null ? P.crownP : 0.5) ? 1 : 0;
    // every piece of one building shares its seed (tint, floor height, window rhythm) and its ground level
    B.seed = r() * 97; B.base = y;
    const A = (s, yy, sx, hh, sz, rr, c, sty, gl) => B.add(s, gl != null ? gl : glass, x, yy, z, sx, hh, sz, rr != null ? rr : ry, c != null ? c : col, sty != null ? sty : st, lit, crown);
    const AO = (s, ox, oz, yy, sx, hh, sz, c, sty, gl) => B.add(s, gl != null ? gl : glass, x + Math.cos(ry) * ox + Math.sin(ry) * oz, yy, z - Math.sin(ry) * ox + Math.cos(ry) * oz, sx, hh, sz, ry, c != null ? c : col, sty != null ? sty : st, lit, crown);
    let top = y + h, roofW = Math.min(w, d) * 0.7, flat = true, solidTop = y + h, roofY = y + h;
    switch (form) {
      case "box": A("box", y, w, h, d); break;
      case "oct": A("oct", y, w, h, d); break;
      case "cyl": A("cyl", y, w, h, d); roofW = w * 0.6; break;
      case "ellipse": A("cyl", y, w, h, d * 0.62); roofW = d * 0.4; break;
      case "tri": A("tri", y, w * 1.1, h, w * 1.1); roofW = w * 0.45; break;
      case "slab": { // residential slab: long and thin with balconies, often on a shop podium
        const ph = h > 40 ? 8 : 0; if (ph) A("box", y, w, ph, d, null, pick(P.stone, r), 1, false);
        A("box", y + ph, w, h - ph, d * 0.45); roofW = d * 0.3; break;
      }
      case "podium": {
        const ph = Math.min(h * 0.18, 30); A("box", y, w * 1.25, ph, d * 1.25, null, pick(P.stone, r), pick([0, 1, 3], r), false);
        A(r() < 0.5 ? "box" : "oct", y + ph, w * 0.85, h - ph, d * 0.85); roofW = w * 0.55;
        if (r() < 0.5) roofGarden(B, x, y + ph, z, w * 1.1, d * 1.1, ry, r, w * 0.85);
        break;
      }
      case "setback": {
        let yy = y, ww = w, dd = d; const n = 3 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) { const hh = h * (i === n - 1 ? 1 - (n - 1) * 0.26 : 0.26); A("box", yy, ww, hh, dd); yy += hh; ww *= 0.8; dd *= 0.8; }
        roofW = ww * 0.6; break;
      }
      case "stepped": { // art-deco wedding cake: shrinking tiers, the last ones short
        let yy = y, ww = w, dd = d; const fr = [0.42, 0.24, 0.15, 0.1, 0.09];
        for (let i = 0; i < fr.length; i++) { const hh = h * fr[i]; A(i > 2 && glass ? "oct" : "box", yy, ww, hh, dd); yy += hh; ww *= i < 2 ? 0.82 : 0.72; dd *= i < 2 ? 0.82 : 0.72; }
        roofW = ww * 0.7; break;
      }
      case "skygarden": { // a recessed, planted sky lobby splits the tower
        const g0 = h * RJ.lerp(0.5, 0.62, r()), gh = 12;
        A("box", y, w, g0, d); A("box", y + g0, w * 0.55, gh, d * 0.55, null, 0x3a3f44, 2, true);
        roofGarden(B, x, y + g0, z, w, d, ry, r, w * 0.55);
        B.base = y; A("box", y + g0 + gh, w * 0.96, h - g0 - gh, d * 0.96); roofW = w * 0.6; break;
      }
      case "deck": { // a slim shaft with an observation deck ring near the top
        A(glass ? "cyl" : "oct", y, w * 0.82, h, d * 0.82);
        const dy = y + h * 0.84; A("oct", dy, w * 1.25, 9, d * 1.25, null, null, 2, true); A("oct", dy + 9, w * 1.12, 6, d * 1.12, null, null, 7, true);
        roofW = w * 0.5; break;
      }
      case "taper": A("taper", y, w, h, d); roofW = w * 0.25; flat = false; break;
      case "twist": {
        // twisting tower: 14 floor-plates, each turned a little further (0.6–1.4 rad over the height)
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
    // crowns: lantern tops, stepped crowns, spires, masts; flat roofs get plant, tanks, gardens or a helipad
    const q = RJ.settings.quality !== "low";
    const spire = o.spire != null ? o.spire : h > 180 && r() < 0.35 ? h * RJ.lerp(0.1, 0.22, r()) : 0;
    if (flat && !spire && o.spire == null && h > 150 && r() < 0.32) {
      if (r() < 0.55) { const lh = RJ.lerp(10, 24, r()); A("box", top, roofW * 1.15, lh, roofW * 1.15, null, null, 7, true); top += lh; solidTop = top; roofW *= 0.9; }
      else { for (let i = 0; i < 3; i++) { const lh = RJ.lerp(5, 9, r()); A("box", top, roofW * (1.3 - i * 0.3), lh, roofW * (1.3 - i * 0.3), null, null, i === 2 ? 7 : st); top += lh; } solidTop = top; roofW *= 0.4; }
      roofY = top;
    }
    if (spire) { A("cone", top, roofW * 0.8, spire, roofW * 0.8, null, P.metal || 0xc8ccd0, 9, true); top += spire; if (top - y > 260) B.lights.push(x, top + 1, z); }
    else if (h > 90 && r() < 0.3) { const mh = h * 0.12; for (const s of [-1, 1]) { B.add("cyl", true, x + s * roofW * 0.25, roofY, z, 1.6, mh, 1.6, 0, 0x9aa0a6, 9, 0, 0); if (h > 220) B.lights.push(x + s * roofW * 0.25, roofY + mh + 0.8, z); } top += mh; }
    else if (flat && h > 60 && r() < 0.08) A("cyl", roofY, roofW, 0.8, roofW, null, 0x3a3d40, 8, false); // helipad
    else if (flat && q && h > 30 && r() < 0.12) roofGarden(B, x, roofY, z, roofW * 1.3, roofW * 1.3, ry, r, 0);
    if (flat && h > 25 && !spire && q) {
      // mechanical penthouse with louvres, AC units, a cooling tower or a water tank
      if (h > 50 && r() < 0.6) AO("box", (r() - 0.5) * roofW * 0.3, (r() - 0.5) * roofW * 0.3, roofY, roofW * RJ.lerp(0.35, 0.6, r()), RJ.lerp(4, 8, r()), roofW * RJ.lerp(0.3, 0.5, r()), pick(P.stone, r), 3, false);
      const n = 1 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) { const a = r() * TAU, rr = roofW * 0.32 * r(); B.add("box", false, x + Math.cos(a) * rr, roofY, z + Math.sin(a) * rr, RJ.lerp(2, 5, r()), RJ.lerp(1.5, 3, r()), RJ.lerp(2, 5, r()), ry, 0x8a8f94, 9, 0, 0); }
      if (r() < 0.25) { const a = r() * TAU, rr = roofW * 0.3; B.add("cyl", false, x + Math.cos(a) * rr, roofY, z + Math.sin(a) * rr, RJ.lerp(4, 7, r()), RJ.lerp(4, 6, r()), RJ.lerp(4, 7, r()), 0, P.tank || 0x7d7a74, 9, 0, 0); }
    }
    if (h > 280) for (const sx of [-1, 1]) B.lights.push(x + Math.cos(ry) * sx * roofW * 0.45, roofY + 0.6, z - Math.sin(ry) * sx * roofW * 0.45);
    B.foot2(x, z, Math.max(w, d) * (form === "podium" ? 0.66 : form === "deck" ? 0.64 : 0.52), solidTop);
    if (h > 60) B.tall.push(x, z, Math.max(w, d) * 0.5, y, solidTop - y, col);
    B.seed = null; B.base = null;
    return top;
  };
  /** Planted deck: lawn, a few trees, paving. */
  function roofGarden(B, x, y, z, w, d, ry, r, hole) {
    const sd = B.seed, bs = B.base; B.seed = r() * 97; B.base = y;
    B.add("box", false, x, y, z, w * 0.92, 0.6, d * 0.92, ry, 0x4f7a3a, 12, 0, 0);
    const n = 3 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, rr = RJ.lerp(hole * 0.6 + 2, Math.min(w, d) * 0.42, r());
      B.treeAt(x + Math.cos(a) * rr, y + 0.6, z + Math.sin(a) * rr, RJ.lerp(4, 8, r()), pick([0x3f6b2e, 0x4c7a34, 0x56823a], r));
    }
    B.seed = sd; B.base = bs;
  }
  K.roofGarden = roofGarden;

  /** Turn a batch into instanced meshes (one per shape and material class). */
  K.meshes = function (B, grp, P) {
    shapes();
    const mats = { G: facadeMat(true, P), S: facadeMat(false, P) }, out = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), Y = V3(0, 1, 0), p = V3(), s = V3();
    // three detail tiers, each split into tiles so districts are frustum- and distance-culled:
    //   clutter (trees, roof plant, cars, boats, containers, paving)  1.5 km tiles, shown within 3.5 km
    //   low buildings (houses, sheds, low blocks under 22 m)           3 km tiles, shown within 10 km
    //   towers                                                         4 km tiles, shown within 24 km (the far skyline twin takes over)
    const TIERS = [{ T: 1500, far: 3500, shadow: false }, { T: 3000, far: 10000, shadow: true }, { T: 4000, far: 24000, shadow: true }], tiles = {};
    const tierOf = (L, i) => { const st = L[i + 8], h = L[i + 4]; if (st > 9.5 || h < 3 || (st > 8.5 && st < 9.5 && h < 9 && L[i + 3] < 8)) return 0; return h + L[i + 1] - L[i + 12] < 22 ? 1 : 2; };
    for (const k in B.L) {
      const L = B.L[k];
      for (let i = 0; i < L.length; i += 13) {
        const tr = tierOf(L, i), TI = TIERS[tr].T;
        const key = k + ":" + tr + ":" + Math.floor(L[i] / TI) + "," + Math.floor(L[i + 2] / TI);
        const t = tiles[key] || (tiles[key] = { k, L: [], tier: tr, far: TIERS[tr].far, TI, x: (Math.floor(L[i] / TI) + 0.5) * TI, z: (Math.floor(L[i + 2] / TI) + 0.5) * TI });
        for (let j = 0; j < 13; j++) t.L.push(L[i + j]);
      }
    }
    for (const key in tiles) {
      const T = tiles[key], k = T.k, L = T.L, n = L.length / 13, geo = SHAPES[k.slice(0, -1)].clone();
      const win = new Float32Array(n * 4), bas = new Float32Array(n);
      const im = new THREE.InstancedMesh(geo, mats[k.slice(-1)], n);
      for (let i = 0; i < n; i++) {
        const o = i * 13; bas[i] = L[o + 12];
        m4.compose(p.set(L[o], L[o + 1], L[o + 2]), q.setFromAxisAngle(Y, L[o + 6]), s.set(L[o + 3], L[o + 4], L[o + 5]));
        im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(L[o + 7]));
        win[i * 4] = L[o + 8]; win[i * 4 + 1] = L[o + 9]; win[i * 4 + 2] = L[o + 10]; win[i * 4 + 3] = L[o + 11];
      }
      geo.setAttribute("aWin", new THREE.InstancedBufferAttribute(win, 4));
      geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(bas, 1));
      im.castShadow = TIERS[T.tier].shadow; im.receiveShadow = true;
      if (T.tier < 2) im.layers.set(5); // small stuff: main camera and shadows only, not the water reflection
      // bounding sphere for culling: the tile's footprint and its tallest piece
      let top = 0; for (let i = 0; i < n; i++) top = Math.max(top, L[i * 13 + 1] + L[i * 13 + 4]);
      geo.boundingSphere = new THREE.Sphere(V3(T.x, top / 2, T.z), Math.hypot(T.TI * 0.75, top / 2) + 120);
      im.userData.tile = T;
      grp.add(im); out.push(im);
    }
    return out;
  };

  /** Aviation obstruction lights on the tall roofs and masts: red points that pulse together at night. */
  K.avLights = function (B, grp) {
    if (!B.lights.length) return null;
    // only the tallest roofs and masts carry them (dozens, not thousands)
    const P = []; for (let i = 0; i < B.lights.length; i += 3) P.push([B.lights[i], B.lights[i + 1], B.lights[i + 2]]);
    P.sort((u, v) => v[1] - u[1]); const L = [].concat(...P.slice(0, 70));
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(L, 3));
    const m = new THREE.PointsMaterial({ color: 0xff2a1a, size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false, toneMapped: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; grp.add(pts);
    return { pts, update(t) { const n = NIGHT.value; pts.visible = n > 0.05; m.opacity = n * (0.15 + 0.6 * Math.pow(Math.max(0, Math.sin(t * 2.6)), 6)); } };
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
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rjNight = NIGHT; sh.uniforms.rjWet = WET;
      sh.uniforms.rjO = { value: new THREE.Vector4(S.x, S.z, S.sx, S.sz) };
      sh.uniforms.rjG = { value: new THREE.Vector4(o.block, o.aveEvery, o.street, R) };
      sh.uniforms.rjLamp = { value: new THREE.Color(o.lamp || 0xffb066) };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSW;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSW; uniform float rjNight; uniform float rjWet; uniform vec4 rjO; uniform vec4 rjG; uniform vec3 rjLamp;")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "vec2 rel = vSW.xz - rjO.xy; vec2 sp = vec2(dot(rel, rjO.zw), dot(rel, vec2(-rjO.w, rjO.z)));",
          "float B = rjG.x, Wd = rjG.z;",
          "vec2 cellc = sp / B, f = fract(cellc), id = floor(cellc);",
          "vec2 dEdge = min(f, 1.0 - f) * B;",                                  // metres to the nearest street centre line
          "float aveS = 1.0 - step(0.5, mod(id.x + step(0.5, f.x), rjG.y)); float aveP = 1.0 - step(0.5, mod(id.y + step(0.5, f.y), rjG.y));",
          "float wS = Wd * (1.0 + aveS * 0.8), wP = Wd * (1.0 + aveP * 0.8);",
          "float roadS = 1.0 - step(wS * 0.5, dEdge.x), roadP = 1.0 - step(wP * 0.5, dEdge.y);",
          "float road = max(roadS, roadP), inter = roadS * roadP;",
          "float walk = max(1.0 - step(wS * 0.5 + 4.5, dEdge.x), 1.0 - step(wP * 0.5 + 4.5, dEdge.y)) * (1.0 - road);",
          "float blk = (1.0 - road) * (1.0 - walk);",                             // block interiors: paved courtyards and service yards
          "float pw = fwidth(sp.x), fine = 1.0 - smoothstep(0.15, 0.9, pw);",
          "float n1 = fract(sin(dot(floor(sp * 0.9), vec2(12.99, 78.23))) * 43758.5);",
          "float n2 = fract(sin(dot(floor(sp * 0.06), vec2(39.3, 11.7))) * 24634.6);",
          // asphalt: patched, worn darker in the wheel tracks; concrete sidewalk slabs with a bright curb
          "vec3 asp = vec3(0.12, 0.125, 0.135) * (0.86 + 0.22 * n2) * (1.0 + (n1 - 0.5) * 0.12 * fine);",
          "float trackS = roadS * (1.0 - inter) * (1.0 - smoothstep(0.4, 1.0, abs(abs(dEdge.x - wS * 0.25) - 1.0)));",
          "float trackP = roadP * (1.0 - inter) * (1.0 - smoothstep(0.4, 1.0, abs(abs(dEdge.y - wP * 0.25) - 1.0)));",
          "asp *= 1.0 - 0.12 * max(trackS, trackP) * fine;",
          "vec2 slab = fract(sp / 2.5); float joint = 1.0 - smoothstep(0.03, 0.03 + pw * 0.4 + 0.01, min(min(slab.x, 1.0 - slab.x), min(slab.y, 1.0 - slab.y)));",
          "vec3 side = vec3(0.56, 0.55, 0.52) * (0.92 + 0.12 * n1 * fine) * (1.0 - joint * 0.22 * fine);",
          "float curb = walk * max(1.0 - smoothstep(0.35, 0.35 + pw, abs(dEdge.x - wS * 0.5 - 0.2)) * (1.0 - step(wP * 0.5 + 4.5, dEdge.y) * 0.0), 1.0 - smoothstep(0.35, 0.35 + pw, abs(dEdge.y - wP * 0.5 - 0.2)));",
          "diffuseColor.rgb = road > 0.5 ? asp : mix(side, vec3(0.72, 0.71, 0.68), curb);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.33, 0.31) * (0.8 + 0.35 * n2), blk);",
          // markings: avenues get a double yellow centre and dashed lane lines, streets a dashed centre; zebra crossings and stop lines
          "float aa = pw * 0.6 + 0.04;",
          "float alongS = sp.y, alongP = sp.x;",
          "float mS = 0.0, mP = 0.0;",
          "float dashS = step(0.45, fract(alongS / 9.0)), dashP = step(0.45, fract(alongP / 9.0));",
          "mS = aveS > 0.5 ? max(1.0 - smoothstep(0.12, 0.12 + aa, abs(dEdge.x - 0.3)), (1.0 - smoothstep(0.1, 0.1 + aa, abs(abs(dEdge.x) - wS * 0.22))) * dashS) : (1.0 - smoothstep(0.1, 0.1 + aa, dEdge.x)) * dashS;",
          "mP = aveP > 0.5 ? max(1.0 - smoothstep(0.12, 0.12 + aa, abs(dEdge.y - 0.3)), (1.0 - smoothstep(0.1, 0.1 + aa, abs(abs(dEdge.y) - wP * 0.22))) * dashP) : (1.0 - smoothstep(0.1, 0.1 + aa, dEdge.y)) * dashP;",
          "vec3 yel = vec3(0.85, 0.7, 0.25), wht = vec3(0.82, 0.82, 0.78);",
          "vec3 mc = (aveS > 0.5 && dEdge.x < 0.6) || (aveP > 0.5 && dEdge.y < 0.6) ? yel : wht;",
          "float mark = (roadS * (1.0 - inter) * mS + roadP * (1.0 - inter) * mP);",
          "float zS = roadS * (1.0 - roadP) * step(wP * 0.5 + 0.6, dEdge.y) * step(dEdge.y, wP * 0.5 + 3.6) * step(0.5, fract(dEdge.x / 1.1));",
          "float zP = roadP * (1.0 - roadS) * step(wS * 0.5 + 0.6, dEdge.x) * step(dEdge.x, wS * 0.5 + 3.6) * step(0.5, fract(dEdge.y / 1.1));",
          "float stopS = roadS * (1.0 - roadP) * (1.0 - smoothstep(0.25, 0.25 + aa, abs(dEdge.y - wP * 0.5 - 4.6)));",
          "float stopP = roadP * (1.0 - roadS) * (1.0 - smoothstep(0.25, 0.25 + aa, abs(dEdge.x - wS * 0.5 - 4.6)));",
          "float zeb = max(max(zS, zP), max(stopS, stopP));",
          "float fadeM = 1.0 - smoothstep(0.6, 2.5, pw);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, mc, clamp(mark, 0.0, 1.0) * 0.85 * fadeM);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, wht, zeb * 0.8 * fadeM);",
          // far away the markings average into a slightly lighter road instead of shimmering
          "diffuseColor.rgb += road * (1.0 - fadeM) * 0.015;",
          // rain: darker, glossy asphalt that mirrors the street lights
          "diffuseColor.rgb *= 1.0 - rjWet * 0.35;",
          "roughnessFactor = mix(road > 0.5 ? 0.88 : 0.8, road > 0.5 ? 0.22 : 0.4, rjWet);",
          // lamps: bright pools along each street edge, every 32 m (offset on alternate sides)
          "float lp = min(abs(dEdge.x - wS * 0.5 - 1.0) + abs(fract(sp.y / 32.0) - 0.5) * 32.0, abs(dEdge.y - wP * 0.5 - 1.0) + abs(fract(sp.x / 32.0) - 0.5) * 32.0);",
          "totalEmissiveRadiance += rjLamp * (exp(-lp * lp * 0.02) * 1.6 + road * 0.07 + (aveS + aveP) * road * 0.05) * rjNight * (1.0 + rjWet * 0.6);",
          // traffic signals at the avenue crossings: a red/green glow on the corners
          "float sig = inter * step(0.5, aveS + aveP) * (1.0 - smoothstep(0.0, 2.5, length(vec2(dEdge.x - wS * 0.5, dEdge.y - wP * 0.5))));",
          "totalEmissiveRadiance += mix(vec3(1.0, 0.1, 0.05), vec3(0.1, 1.0, 0.4), step(0.5, fract(id.x * 0.37 + id.y * 0.61))) * sig * rjNight * 1.2;",
          "float edge = smoothstep(rjG.w * 0.88, rjG.w, length(rel)); diffuseColor.a *= 1.0 - edge;"
        ].join("\n"));
    };
    m.transparent = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(S.x, S.elev + 0.35, S.z); mesh.receiveShadow = true; mesh.renderOrder = 1;
    grp.add(mesh);
    return mesh;
  };

  /* Traffic: vehicles flow in lanes along paths (straight streets from K.path, or sampled roads from K.highway). Each lane
   * is a steady stream: car k sits at k * spacing + speed * t, so cars never overlap, and a hash per car picks its type,
   * paint and whether that slot is empty (busy downtown, thinner on the edges). Only the stretch of each road near the
   * camera is turned into instances; headlights, tail lights and brake-light flicker show at night. */
  const VEH = [ // length, width, height scale, share
    { n: "car", s: [1, 1, 1], w: 0.5 }, { n: "suv", s: [1.05, 1.08, 1.25], w: 0.2 }, { n: "van", s: [1.2, 1.1, 1.55], w: 0.1 },
    { n: "taxi", s: [1, 1, 1], w: 0.06, col: 0xf2c21b }, { n: "bus", s: [2.6, 1.3, 1.95], w: 0.06, col: 0xd8dde0 }, { n: "truck", s: [3.6, 1.3, 2.3], w: 0.08 }
  ];
  const PAINT = [0xe8e8e8, 0x1c1d20, 0x8a8f96, 0xb8bcc0, 0x9a1c1c, 0x1c3a7a, 0x2f5d3a, 0xc8c2b4, 0x4a4e52, 0xd06a1a, 0x5a1a1a, 0x24476b];
  let VGEO = null;
  function vehGeo() {
    if (VGEO) return VGEO;
    const parts = [], lights = [];
    const add = (arr, w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const n = g.attributes.position.count, C = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) { C[i * 3] = cc.r; C[i * 3 + 1] = cc.g; C[i * 3 + 2] = cc.b; } g.setAttribute("color", new THREE.BufferAttribute(C, 3)); arr.push(g); };
    add(parts, 1.8, 0.62, 4.4, 0, 0.62, 0, 0xffffff);              // body (instance paint)
    add(parts, 1.6, 0.5, 2.2, 0, 1.18, 0.25, 0x2a3440);            // cabin glass
    add(parts, 1.62, 0.06, 1.9, 0, 1.45, 0.3, 0xffffff);           // roof
    for (const sx of [-1, 1]) for (const sz of [-1.35, 1.35]) add(parts, 0.26, 0.62, 0.62, sx * 0.82, 0.31, sz, 0x101010); // wheels
    for (const sx of [-0.6, 0.6]) { add(lights, 0.34, 0.14, 0.05, sx, 0.72, -2.22, 0xfff4dc); add(lights, 0.36, 0.12, 0.05, sx, 0.78, 2.22, 0xff1a10); }
    const merge = (arr) => { let n = 0; for (const g of arr) n += g.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0; for (const g of arr) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; } const G = new THREE.BufferGeometry(); G.setAttribute("position", new THREE.BufferAttribute(P, 3)); G.setAttribute("normal", new THREE.BufferAttribute(N, 3)); G.setAttribute("color", new THREE.BufferAttribute(C, 3)); return G; };
    return (VGEO = { body: merge(parts), lights: merge(lights) });
  }
  const hh = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  K.traffic = function (grp, paths, o) {
    o = o || {};
    const N = o.cars || 900, G = vehGeo();
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 });
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const im = new THREE.InstancedMesh(G.body, bodyMat, N), lm = new THREE.InstancedMesh(G.lights, lightMat, N);
    im.frustumCulled = lm.frustumCulled = false; im.castShadow = false; im.count = lm.count = 0;
    im.setColorAt(0, new THREE.Color()); grp.add(im); grp.add(lm); im.layers.set(5); lm.layers.set(5);
    const lanes = o.lanes || [2.0, 5.2], R = o.range || 2600, spd = o.speed || [11, 17], gap = o.gap || [26, 60];
    // per path: lane streams (both directions)
    for (const P of paths) {
      P.streams = [];
      const LN = P.lanes || lanes, SP = P.speed || spd, side = o.leftHand ? 1 : -1;
      LN.forEach((ln, i) => { for (const dir of [1, -1]) P.streams.push({ lane: ln * dir * side, dir, v: RJ.lerp(SP[0], SP[1], hh(i + 1, dir + P.len * 0.001)) * (i === LN.length - 1 ? 0.85 : 1), sp: RJ.lerp(gap[0], gap[1], hh(dir, i * 3.1 + P.len * 0.01)), id: i * 2 + (dir > 0 ? 0 : 1), slow: i === LN.length - 1 }); });
      if (!P.sample) { // straight street from K.path
        P.sample = (d, lane, out) => { const f = (((d % P.len) + P.len) % P.len) / P.len; out.x = P.ax + (P.bx - P.ax) * f + P.nx * lane; out.z = P.az + (P.bz - P.az) * f + P.nz * lane; out.y = P.y0 + (P.y1 - P.y0) * f; out.yaw = P.yaw + Math.PI; out.tun = false; return out; };
        P.nearest = (x, z) => { const ux = (P.bx - P.ax) / P.len, uz = (P.bz - P.az) / P.len, t = RJ.clamp((x - P.ax) * ux + (z - P.az) * uz, 0, P.len); return { d: t, dist: Math.hypot(P.ax + ux * t - x, P.az + uz * t - z) }; };
      } else if (!P.nearest) {
        P.nearest = (x, z) => { const pr = P.prof; let bi = 0, bd = Infinity; for (let i = 0; i < pr.length; i += 8) { const d = (pr[i].x - x) ** 2 + (pr[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } for (let i = Math.max(0, bi - 8); i < Math.min(pr.length, bi + 9); i++) { const d = (pr[i].x - x) ** 2 + (pr[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return { d: pr[bi].d, dist: Math.sqrt(bd) }; };
      }
    }
    const density = o.density || (() => 0.75);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), sc = V3(), Y = V3(0, 1, 0), c = new THREE.Color(), out = {};
    let t = Math.random() * 1000;
    return {
      im, lm,
      update(dt, cam, near) {
        im.visible = lm.visible = near && !K.quiet; // quiet: a road closed for an event (the drag race)
        if (!near || K.quiet) return;
        t += dt;
        const k = 0.25 + NIGHT.value * 2.2; lightMat.color.setRGB(k, k, k);
        let n = 0;
        for (const P of paths) {
          const nr = P.nearest(cam.position.x, cam.position.z); if (nr.dist > R) continue;
          const span = Math.sqrt(R * R - nr.dist * nr.dist);
          for (const S of P.streams) {
            const shift = S.v * t * S.dir;
            const k0 = Math.floor((nr.d - span - shift) / S.sp), k1 = Math.floor((nr.d + span - shift) / S.sp);
            for (let kk = k0; kk <= k1 && n < N; kk++) {
              const hk = hh(kk, S.id * 7.3 + P.len * 0.0007);
              const d = kk * S.sp + shift + (hh(kk, S.id) - 0.5) * S.sp * 0.3;
              if (d < 0 || d > P.len) { if (!P.loop) continue; }
              if (hk > density(P, d)) continue;
              P.sample(d, S.lane, out); if (out.tun) continue;
              let r = hh(kk * 1.7, S.id + 0.5), ty = VEH[0]; for (const v of VEH) { if ((r -= v.w) <= 0) { ty = v; break; } }
              if ((ty.n === "truck" || ty.n === "bus") && !S.slow) ty = VEH[0];
              p.set(out.x, out.y, out.z); q.setFromAxisAngle(Y, out.yaw + (S.dir > 0 ? 0 : Math.PI) + Math.PI);
              sc.set(ty.s[1], ty.s[2], ty.s[0]); m4.compose(p, q, sc); im.setMatrixAt(n, m4); lm.setMatrixAt(n, m4);
              im.setColorAt(n, c.setHex(ty.col || PAINT[Math.floor(hh(kk, S.id * 2.1) * PAINT.length)]));
              n++;
            }
          }
        }
        im.count = lm.count = n;
        im.instanceMatrix.needsUpdate = true; lm.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
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

  /* ======================= elevated expressways ======================= */
  /** Road along pts [{x, z}]. Two profiles:
   *   · elevated (o.Y fixed deck, or o.groundAt + o.clear): a viaduct over the city with ramps down at both ends
   *   · at grade (o.grade): follows the smoothed ground, bridges water and valleys on piers, tunnels through ridges
   *  Deck, girder, barriers, edge and centre lines, piers, lamp posts and tunnel portals go into one merged mesh
   *  (plus a lamp mesh). Returns oriented solids, the sampled profile and traffic paths. */
  K.highway = function (grp, pts, o) {
    const W = o.width || 22, ramp = o.ramp || 320, solids = [], paths = [], STEP = o.step || 30;
    const pos = [], nor = [], col = [], lamp = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cc = new THREE.Color();
    const box = (out, x, y, z, sx, sy, sz, yaw, pitch, hex) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); e.set(pitch, yaw, 0, "YXZ"); m4.compose(V3(x, y, z), q.setFromEuler(e), V3(1, 1, 1)); g.applyMatrix4(m4);
      const P = g.attributes.position.array, Nn = g.attributes.normal.array; cc.setHex(hex);
      for (let i = 0; i < P.length; i++) { out.p.push(P[i]); out.n.push(Nn[i]); } for (let i = 0; i < P.length / 3; i++) out.c.push(cc.r, cc.g, cc.b);
      g.dispose();
    };
    const D = { p: pos, n: nor, c: col }, Lm = { p: lamp, n: [], c: [] };
    // sample the polyline every STEP metres
    const S = []; let tot = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < L; t += STEP) S.push({ x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L, d: tot + t });
      tot += L;
    }
    const last = pts[pts.length - 1]; S.push({ x: last.x, z: last.z, d: tot });
    const G = o.groundAt || (() => o.ground);
    for (const p of S) p.g = G(p.x, p.z);
    // deck profile
    if (o.Y != null && !o.groundAt) { for (const p of S) p.y = o.ground + (o.Y - o.ground) * RJ.smooth(0, ramp, p.d) * RJ.smooth(tot, tot - ramp, p.d); }
    else {
      const win = Math.max(1, Math.round((o.grade ? 260 : 360) / STEP));
      const base = S.map((p) => o.grade ? Math.max(p.g, o.sea != null ? o.sea : 9) : Math.max(p.g, 2));
      for (let i = 0; i < S.length; i++) { let sum = 0, n = 0; for (let k = -win; k <= win; k++) { const j = i + k; if (j < 0 || j >= S.length) continue; sum += base[j]; n++; } S[i].y = sum / n; }
      // grade limit (6 %) both ways, then the clearance
      for (let i = 1; i < S.length; i++) S[i].y = Math.max(S[i].y, S[i - 1].y - STEP * 0.06);
      for (let i = S.length - 2; i >= 0; i--) S[i].y = Math.max(S[i].y, S[i + 1].y - STEP * 0.06);
      const cl = o.grade ? 0.8 : (o.clear || 20);
      for (const p of S) p.y += cl;
      if (!o.grade) for (const p of S) { const k = RJ.smooth(0, ramp, p.d) * RJ.smooth(tot, tot - ramp, p.d); p.y = p.g + 0.4 + (p.y - p.g - 0.4) * k; }
    }
    for (const p of S) p.tun = p.g - p.y > 7; // under a ridge: in a tunnel
    const hex = o.color || 0x3a3c40, pier = o.pier || 0x9a9c9e;
    let lastTun = S[0].tun;
    for (let i = 0; i < S.length - 1; i++) {
      const A = S[i], B = S[i + 1], l = B.d - A.d; if (l < 0.5) continue;
      const ux = (B.x - A.x) / l, uz = (B.z - A.z) / l, yaw = Math.atan2(ux, uz), pitch = -Math.atan2(B.y - A.y, l);
      const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2, ym = (A.y + B.y) / 2, sl = Math.hypot(l, B.y - A.y) + 0.3, gm = (A.g + B.g) / 2;
      const tun = A.tun && B.tun;
      if (A.tun !== lastTun) { // tunnel portal
        box(D, x, ym + 4, z, W + 6, 9, 3, yaw, 0, 0x8a8680); box(D, x, ym + 3.4, z + 0, W - 2, 6.6, 3.4, yaw, 0, 0x0c0c0e); lastTun = A.tun;
      }
      if (!tun) {
        box(D, x, ym - 0.8, z, W, 1.6, sl, yaw, pitch, hex);
        if (ym - gm > 3) box(D, x, ym - 1.9, z, W * 0.7, 1.2, sl, yaw, pitch, 0x8d8f92);
        for (const sd of [-1, 1]) {
          box(D, x + uz * sd * (W / 2 - 0.3), ym + 0.55, z - ux * sd * (W / 2 - 0.3), 0.5, 1.1, sl, yaw, pitch, 0xb8b8b4);
          box(D, x + uz * sd * (W / 2 - 1.4), ym + 0.01, z - ux * sd * (W / 2 - 1.4), 0.18, 0.04, sl, yaw, pitch, 0xd8d8d0);
          if (W > 18) box(D, x + uz * sd * W * 0.12, ym + 0.01, z - ux * sd * W * 0.12, 0.15, 0.04, sl * 0.45, yaw, pitch, 0xd8d8d0); // lane dashes
        }
        box(D, x, ym + 0.45, z, 0.6, 0.9, sl, yaw, pitch, 0xb0b0ac);                                          // median barrier
        if (ym - gm > 5 && i % 2 === 0) { const ph = ym - 2.5 - Math.min(gm, ym - 3); box(D, x, ym - 2.5 - ph / 2, z, 2.6, ph, 2.6, yaw, 0, pier); box(D, x, ym - 3.2, z, W * 0.85, 1.4, 2.8, yaw, 0, pier); }
        if (!o.noLamps && i % 2 === 1) { const sd = i % 4 === 1 ? 1 : -1, lx = x + uz * sd * (W / 2 - 0.3), lz = z - ux * sd * (W / 2 - 0.3); box(D, lx, ym + 5, lz, 0.25, 9, 0.25, yaw, 0, 0x777a7e); box(Lm, lx - uz * sd * 1.2, ym + 9.4, lz + ux * sd * 1.2, 2.4, 0.3, 0.7, yaw, 0, 0xffffff); }
        if (!o.noSolids && ym - gm > 3) solids.push({ x, z, ux, uz, hl: l / 2 + 0.2, hw: W / 2, y0: ym - 2.6, y1: ym + 1.2 });
      }
    }
    // traffic paths: one per sample segment run (cars follow the deck, through the tunnels)
    const prof = S;
    paths.push({ prof, len: tot, sample(d, lane, out) { // position on the road at distance d, lane offset (m, + = right)
      d = ((d % tot) + tot) % tot; let lo = 0, hi = prof.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (prof[mid].d <= d) lo = mid; else hi = mid; }
      const A = prof[lo], B = prof[hi], f = (d - A.d) / Math.max(1e-3, B.d - A.d), L = Math.max(1e-3, B.d - A.d), ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
      out.x = A.x + (B.x - A.x) * f + uz * lane; out.z = A.z + (B.z - A.z) * f - ux * lane; out.y = A.y + (B.y - A.y) * f; out.yaw = Math.atan2(ux, uz); out.tun = A.tun && B.tun;
      return out;
    } });
    // split the mesh into ~3 km pieces so far stretches can be culled
    const meshes = [], CH = 108 * 3 * 100; // vertices per box = 36 → ~3 km of road
    const mat = o.mat || (K._roadMat || (K._roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 })));
    for (let i0 = 0; i0 < pos.length; i0 += CH) {
      const i1 = Math.min(pos.length, i0 + CH);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos.slice(i0, i1), 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor.slice(i0, i1), 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col.slice(i0, i1), 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = !o.grade; mesh.receiveShadow = true; mesh.layers.set(5); grp.add(mesh); meshes.push(mesh);
    }
    let lmesh = null; const lmat = K._lampMat || (K._lampMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
    if (lamp.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lamp, 3)); lmesh = new THREE.Mesh(lg, lmat); grp.add(lmesh); }
    const lc = new THREE.Color(o.lamp || 0xffd9a0);
    return { mesh: meshes[0], meshes, solids, paths, prof, len: tot, update() { lmat.color.copy(lc).multiplyScalar(0.15 + NIGHT.value * 2.2); } };
  };

  /* ======================= railways and trains ======================= */
  /** Double-track railway along pts: viaduct (o.clear above the smoothed ground) or at grade, ballast, rails,
   *  catenary masts, tunnels through ridges, stations every o.stationEvery metres (platforms, canopies, a lit hall).
   *  Returns the profile (same sampler as K.highway) and the station distances. */
  K.rail = function (grp, pts, o) {
    const hw = K.highway(grp, pts, Object.assign({ width: 11, noLamps: true, color: 0x55524c, pier: 0x8e9094, ramp: 1 }, o));
    const P = hw.paths[0], pos = [], nor = [], col = [], cc = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), out = {};
    const box = (x, y, z, sx, sy, sz, yaw, pitch, hex) => { const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); e.set(pitch, yaw, 0, "YXZ"); m4.compose(V3(x, y, z), q.setFromEuler(e), V3(1, 1, 1)); g.applyMatrix4(m4); const A = g.attributes.position.array, N = g.attributes.normal.array; cc.setHex(hex); for (let i = 0; i < A.length; i++) { pos.push(A[i]); nor.push(N[i]); } for (let i = 0; i < A.length / 3; i++) col.push(cc.r, cc.g, cc.b); g.dispose(); };
    const L = hw.len, step = 30, pr = hw.prof;
    for (let i = 0; i < pr.length - 1; i++) {
      const A = pr[i], Bp = pr[i + 1], l = Bp.d - A.d; if (l < 0.5 || (A.tun && Bp.tun)) continue;
      const ux = (Bp.x - A.x) / l, uz = (Bp.z - A.z) / l, yaw = Math.atan2(ux, uz), pitch = -Math.atan2(Bp.y - A.y, l), x = (A.x + Bp.x) / 2, z = (A.z + Bp.z) / 2, y = (A.y + Bp.y) / 2, sl = Math.hypot(l, Bp.y - A.y) + 0.2;
      for (const tr of [-2.3, 2.3]) {
        box(x + uz * tr, y + 0.15, z - ux * tr, 2.8, 0.3, sl, yaw, pitch, 0x6a645c);                       // ballast bed
        for (const rl of [-0.72, 0.72]) box(x + uz * (tr + rl), y + 0.42, z - ux * (tr + rl), 0.12, 0.16, sl, yaw, pitch, 0x9a9da2); // rails
      }
      if (i % 2 === 0) { box(x + uz * 5.2, y + 3.6, z - ux * 5.2, 0.3, 7.2, 0.3, yaw, 0, 0x7a7d80); box(x + uz * 2.6, y + 6.9, z - ux * 2.6, 5.4, 0.18, 0.18, yaw, 0, 0x7a7d80); } // catenary mast
    }
    // stations: two side platforms with canopies and a glazed hall over the line
    const stations = [], every = o.stationEvery || 1500;
    for (let d = Math.min(600, L * 0.2); d < L - 300; d += every) {
      P.sample(d, 0, out); if (out.tun) continue;
      stations.push(d);
      const ux = Math.sin(out.yaw), uz = Math.cos(out.yaw);
      for (const sd of [-1, 1]) {
        box(out.x + uz * sd * 7.2, out.y + 0.55, out.z - ux * sd * 7.2, 4, 1.1, 130, out.yaw, 0, 0xb8b4aa);       // platform
        box(out.x + uz * sd * 7.2, out.y + 5.2, out.z - ux * sd * 7.2, 5, 0.35, 120, out.yaw, 0, 0xdedede);      // canopy
        for (let k = -2; k <= 2; k++) box(out.x + uz * sd * 8.6 + ux * k * 26, out.y + 2.9, out.z - ux * sd * 8.6 + uz * k * 26, 0.3, 4.6, 0.3, out.yaw, 0, 0x6a6d70);
      }
      box(out.x, out.y + 9.5, out.z, 19, 0.6, 60, out.yaw, 0, 0x8fa6b4);                                             // hall roof
      box(out.x, out.y - 4, out.z, 8, 8, 14, out.yaw, 0, 0xc8c4bc);                                                  // entrance / stairs block
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, K._roadMat); m.receiveShadow = true; m.layers.set(5); grp.add(m); hw.meshes.push(m);
    }
    return Object.assign(hw, { stations, track: P });
  };

  /** Scheduled trains on a railway from K.rail: each track runs one way, trains leave every `headway` seconds,
   *  accelerate, cruise, brake into each station, dwell, and run to the end of the line. Cars follow the curve
   *  (each car is placed between its own two bogies) and windows light at night. */
  let TGEO = null;
  function trainGeo() {
    if (TGEO) return TGEO;
    const parts = [], add = (w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const n = g.attributes.position.count, C = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) { C[i * 3] = cc.r; C[i * 3 + 1] = cc.g; C[i * 3 + 2] = cc.b; } g.setAttribute("color", new THREE.BufferAttribute(C, 3)); parts.push(g); };
    add(3.0, 3.1, 19.4, 0, 2.15, 0, 0xffffff);          // body (instance livery)
    add(3.04, 0.9, 17.5, 0, 2.6, 0, 0x1c2630);         // window band
    add(3.04, 0.22, 19.4, 0, 1.45, 0, 0x404448);       // stripe
    add(2.4, 0.5, 19, 0, 3.85, 0, 0xb0b4b8);           // roof
    add(2.2, 0.8, 3, 0, 0.6, 6.5, 0x202224); add(2.2, 0.8, 3, 0, 0.6, -6.5, 0x202224); // bogies
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const G = new THREE.BufferGeometry(); G.setAttribute("position", new THREE.BufferAttribute(P, 3)); G.setAttribute("normal", new THREE.BufferAttribute(N, 3)); G.setAttribute("color", new THREE.BufferAttribute(C, 3));
    const wg = new THREE.BoxGeometry(3.08, 0.8, 17.3); wg.translate(0, 2.6, 0);
    return (TGEO = { body: G, win: wg });
  }
  K.trains = function (grp, line, o) {
    o = o || {};
    const L = line.len, st = line.stations.slice(), v = o.speed || 22, acc = o.acc || 0.9, dwell = o.dwell || 22, cars = o.cars || 6, CL = 20 * (o.carScale || 1);
    // one-way timetable: distance as a function of time since departure
    const stops = [0, ...st.filter((d) => d > 50 && d < L - 50), L];
    const legs = []; let t = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1], D = b - a, ta = v / acc, da = 0.5 * acc * ta * ta;
      const T = D > 2 * da ? 2 * ta + (D - 2 * da) / v : 2 * Math.sqrt(D / acc), vp = D > 2 * da ? v : Math.sqrt(D * acc);
      legs.push({ a, b, D, t0: t, T, vp }); t += T + (i < stops.length - 2 ? dwell : 0);
    }
    const Tc = t, head = o.headway || 300, nT = Math.max(1, Math.ceil(Tc / head));
    const distAt = (tau) => {
      for (const g of legs) {
        if (tau < g.t0) return g.a; // dwelling at the previous stop
        if (tau <= g.t0 + g.T) { const u = tau - g.t0, ta = g.vp / acc; if (u < ta) return g.a + 0.5 * acc * u * u; if (u > g.T - ta) { const w = g.T - u; return g.b - 0.5 * acc * w * w; } return g.a + 0.5 * acc * ta * ta + g.vp * (u - ta); }
      }
      return L;
    };
    const N = nT * 2 * cars, G = trainGeo();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 });
    const wmat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const im = new THREE.InstancedMesh(G.body, mat, N), wm = new THREE.InstancedMesh(G.win, wmat, N);
    im.frustumCulled = wm.frustumCulled = false; im.castShadow = true;
    const liv = new THREE.Color(o.livery || 0xd8dadc); for (let i = 0; i < N; i++) im.setColorAt(i, liv);
    grp.add(im); grp.add(wm); im.layers.set(5); wm.layers.set(5);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pA = {}, pB = {}, P = V3(), S1 = V3(1, 1, o.carScale || 1), Y = V3(0, 1, 0), dirV = V3();
    let time = (o.phase || 0) + Math.random() * Tc;
    const tr = line.track;
    return {
      im, Tc,
      update(dt, cam, near) {
        im.visible = wm.visible = near; if (!near) return;
        time += dt;
        const k = NIGHT.value; wmat.color.setRGB(1.0 * k * 1.4 + 0.02, 0.9 * k * 1.4 + 0.02, 0.7 * k * 1.4 + 0.02);
        let n = 0;
        for (let side = 0; side < 2; side++) for (let j = 0; j < nT; j++) {
          const tau = (((time - j * head) % Tc) + Tc) % Tc, d0 = distAt(tau);
          for (let cI = 0; cI < cars; cI++) {
            let df = d0 - cI * (CL + 0.8), db = df - CL * 0.75;
            if (db < 0) { continue; }
            if (side) { df = L - df; db = L - db; }
            tr.sample(df, side ? 2.3 : -2.3, pA); tr.sample(db, side ? 2.3 : -2.3, pB);
            if (pA.tun && pB.tun) continue;
            P.set((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 + 0.3, (pA.z + pB.z) / 2);
            if (P.distanceToSquared(cam.position) > 6500 * 6500) continue;
            dirV.set(pA.x - pB.x, pA.y - pB.y, pA.z - pB.z).normalize();
            q.setFromUnitVectors(V3(0, 0, 1), dirV);
            m4.compose(P, q, S1); im.setMatrixAt(n, m4); wm.setMatrixAt(n, m4); n++;
          }
        }
        im.count = wm.count = n; im.instanceMatrix.needsUpdate = true; wm.instanceMatrix.needsUpdate = true;
      }
    };
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
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e3034, roughness: 0.85 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(W - 3, 0.25, L), dark); road.position.set(mid.x, deck + 0.1, mid.z); road.rotation.y = ang; road.receiveShadow = true; grp.add(road);
    for (const sd of [-1, 1]) piece(new THREE.BoxGeometry(0.6, 1.2, L), mid.x + uz * sd * (W / 2 - 0.4), deck + 0.6, mid.z - ux * sd * (W / 2 - 0.4), ang);
    piece(new THREE.BoxGeometry(W * 0.5, 5, L), mid.x, deck - 6.5, mid.z, ang); // stiffening truss
    solids.push({ x: mid.x, z: mid.z, ux, uz, hl: L / 2, hw: W / 2, y0: deck - 5, y1: deck + 3 });
    const tw = [0.24, 0.76], cablePts = [[], []], lights = [], neck = [];
    for (const f of tw) {
      const tx = a.x + dx * f, tz = a.z + dz * f;
      for (const s of [-1, 1]) {
        const px = tx + uz * s * W * 0.55, pz = tz - ux * s * W * 0.55;
        piece(new THREE.BoxGeometry(6.5, H * 0.55, 6.5), px, H * 0.275, pz, ang); piece(new THREE.BoxGeometry(5, H * 0.47, 5), px, H * 0.765, pz, ang);
        solids.push({ x: px, z: pz, ux, uz, hl: 3, hw: 3, y0: 0, y1: H });
      }
      piece(new THREE.BoxGeometry(W * 1.2, 5, 5), tx, H - 6, tz, ang); piece(new THREE.BoxGeometry(W * 1.2, 4, 4), tx, deck + 18, tz, ang);
      piece(new THREE.BoxGeometry(W * 1.2, 3.5, 4), tx, deck + (H - deck) * 0.6, tz, ang); piece(new THREE.BoxGeometry(W * 1.25, 4, 6), tx, deck - 6, tz, ang);
      for (const s of [-1, 1]) lights.push(tx + uz * s * W * 0.55, H + 1, tz - ux * s * W * 0.55);
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
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.75, 6, false), mat); tube.castShadow = true; grp.add(tube);
      for (let i = 1; i < 60; i += 2) neck.push(pts[i].x, pts[i].y + 1, pts[i].z);
      const hg = []; for (let i = 2; i < 59; i += 2) { hg.push(pts[i].clone(), V3(pts[i].x, deck, pts[i].z)); }
      grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(hg), cmat));
    }
    // deck lamps every 40 m on both edges, the cable "necklace" and red lights on the tower tops (night only)
    for (let t = 20; t < L; t += 40) for (const s of [-1, 1]) neck.push(a.x + ux * t + uz * s * (W / 2 - 0.5), deck + 7, a.z + uz * t - ux * s * (W / 2 - 0.5));
    const night = (arr, colr, size) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.PointsMaterial({ color: colr, size, sizeAttenuation: false, transparent: true, depthWrite: false, toneMapped: false });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.onBeforeRender = () => { m.opacity = NIGHT.value; }; grp.add(pts);
    };
    night(neck, o.necklace || 0xfff2cc, 2.4); night(lights, 0xff2a1a, 3.2);
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
