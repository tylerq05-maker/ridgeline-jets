/* Jet City — start-up cinematic (~35 s): "Angels Strike".
 *   1 KULBIT      an F-22 charges head-on at Angel 1, who flips a Kulbit over it in slow motion and drops in behind
 *   2 FORMATION   the six-ship Delta thunders over the sea at wave-top height, rolls as one, pulls for the sky
 *   3 SHOWCASE    B-2, YF-12, F-14, XB-70 and F-35, one signature shot each, cut on the beat
 *   4 BANDIT      a Su-57 comes in hot; Angel 1 locks, fires, and the missile cam rides it into the kill
 *   5 SS LUKEPIZZA  the Angels dive on the enemy carrier, sink it, and climb away in formation -> JET CITY
 * (The blue-and-gold Super Hornets are a tribute to the US Navy Blue Angels.) Every act is choreographed on its own
 * clock (slow motion is just that clock running slow), every shot is a designed camera move with a motivated cut,
 * and the score, engines, radio and explosions are synthesised live (WebAudio); no downloaded assets.
 * The overlay, title gate, audio engine and logo hand-off come from the first cinematic. main.js owns the lobby:
 * RJ.intro.start(api) once, api.done() once. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3;
  const I = { active: false };
  if (RJ.intro && !RJ.introClassic) RJ.introClassic = RJ.intro; // the Fleet Week cinematic stays as the fallback
  RJ.intro = I;
  const sm = (a, b, x) => RJ.smooth(a, b, x);
  const lerp = (a, b, x) => a + (b - a) * x;
  const ease = (x) => x * x * (3 - 2 * x);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const T_OPEN = 1.1, T_DROP = 7.0;
  // acts (real time): start, end, and the act clock's rate at real time T
  const ACT = { k: [1.1, 7.0], f: [7.0, 14.0], s: [14.0, 20.5], d: [20.5, 26.0], c: [26.0, 32.0] };
  const LOGO = 32.0, END = 35.0;
  const DIAMOND = [[0, 0, 0], [8.5, -0.6, 10.5], [-8.5, -0.6, 10.5], [0, -1.4, 21], [0, -3.4, 33], [0, -6.2, 45]];
  const B = (a, s, u, out) => (out || V3()).set(I.C.x + I.L.x * a + I.Sx.x * s, u, I.C.z + I.L.z * a + I.Sx.z * s);
  const G = (a, s, h, out) => { out = B(a, s, 0, out); out.y = Math.max(0, RJ.world.ground(out.x, out.z)) + h; return out; };
  const CS = (o) => I.crowdS + o;
  const yawOf = (d) => Math.atan2(-d.x, -d.z);
  /* ---------------- overlay ---------------- */
  function css() {
    if (document.getElementById("intro-css")) return;
    const s = document.createElement("style"); s.id = "intro-css";
    s.textContent = `
#intro { position: fixed; inset: 0; z-index: 60; pointer-events: none; overflow: hidden; font-family: var(--font-body); }
#intro .curtain { position: absolute; inset: 0; background: #000; opacity: 1; }
#intro .lb { position: absolute; left: 0; right: 0; height: max(0px, calc((100vh - 100vw / 2.39) / 2)); background: #000; transition: transform .9s cubic-bezier(.6,0,.2,1); }
#intro .lb.t { top: 0; } #intro .lb.b { bottom: 0; }
#intro.open .lb.t { transform: translateY(-100%); } #intro.open .lb.b { transform: translateY(100%); }
#intro .radio { position: absolute; left: 50%; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 4vh); transform: translateX(-50%); max-width: 80vw; text-align: center; color: #e9f2ea; opacity: 0; transition: opacity .25s;
  font-family: var(--font-mono); font-size: clamp(13px, 1.5vw, 18px); letter-spacing: .06em; text-shadow: 0 2px 10px rgba(0,0,0,.9); }
#intro .radio b { color: #ffb81c; font-weight: 400; letter-spacing: .2em; margin-right: .6em; }
#intro .radio.on { opacity: 1; }
#intro .cap { position: absolute; left: 6vw; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 5vh); color: #f3ead2; opacity: 0; transform: translateX(-14px); transition: opacity .45s, transform .45s; text-shadow: 0 2px 12px rgba(0,0,0,.7); border-left: 2px solid #ffb81c; padding-left: 12px; }
#intro .cap.on { opacity: .95; transform: none; }
#intro .cap-n { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #ffb81c; margin-bottom: 4px; }
#intro .cap-t { font-family: var(--font-display); font-size: clamp(20px, 2.6vw, 34px); letter-spacing: .06em; text-transform: uppercase; }
#intro .flash { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(255,250,235,.95), rgba(255,226,170,.35) 45%, rgba(0,0,0,0) 75%); opacity: 0; }
#intro .scrim { position: absolute; inset: 0; background: radial-gradient(ellipse 55% 40% at 50% 50%, rgba(4,7,11,.62), rgba(4,7,11,.25) 60%, rgba(4,7,11,0) 85%); opacity: 0; }
#intro .dip { position: absolute; inset: 0; background: #05080c; opacity: 0; }
#intro .logo-wrap { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; opacity: 0; }
#intro .logo-wrap .eb { font-family: var(--font-mono); font-size: clamp(11px, 1.2vw, 15px); letter-spacing: .5em; color: #ffb81c; text-transform: uppercase; margin-bottom: 1.4vh; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
#intro .big { font-family: var(--font-display); font-size: clamp(64px, 13vw, 190px); line-height: .86; letter-spacing: .02em; white-space: nowrap;
  background: linear-gradient(100deg, #cfd6de 0%, #ffffff 30%, #fff3d6 46%, #ffffff 52%, #dfe5ec 70%, #ffffff 100%); background-size: 280% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(10,15,21,.9)) drop-shadow(0 5px 0 rgba(10,15,21,.6)) drop-shadow(0 14px 30px rgba(0,0,0,.75)); }
#intro .big.sweep { animation: introSweep 1.8s cubic-bezier(.3,0,.2,1) forwards; }
@keyframes introSweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }
#intro .streak { position: absolute; left: 50%; top: 50%; width: 86vw; height: 2px; transform: translate(-50%, -50%) scaleX(0); background: linear-gradient(90deg, transparent, #fff3c4, #fff, #fff3c4, transparent); opacity: 0; }
#intro .tag { margin-top: 1.8vh; font-family: var(--font-mono); font-size: clamp(11px, 1.2vw, 15px); letter-spacing: .42em; text-transform: uppercase; color: #e9eef4; opacity: .85; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
#intro .skip { pointer-events: auto; position: absolute; top: max(14px, calc((100vh - 100vw / 2.39) / 2 - 52px)); right: 18px; display: flex; align-items: center; gap: 10px; z-index: 2;
  padding: 9px 14px 9px 16px; border: 1px solid rgba(255,184,28,.75); border-radius: 3px; background: rgba(6,10,16,.55); color: #f5efe0; cursor: pointer;
  font-family: var(--font-mono); font-size: 13px; letter-spacing: .22em; text-transform: uppercase; backdrop-filter: blur(4px); transition: background .2s, border-color .2s; }
#intro .skip:hover, #intro .skip:focus-visible { background: rgba(255,184,28,.92); color: #161006; border-color: #ffb81c; outline: none; }
#intro .skip kbd { font-family: inherit; font-size: 10px; letter-spacing: .1em; padding: 1px 5px; border: 1px solid currentColor; border-radius: 2px; opacity: .75; }
#intro .gate { pointer-events: auto; position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; z-index: 1;
  background: radial-gradient(ellipse 70% 55% at 50% 58%, #13202e 0%, #070b11 55%, #000 100%); overflow: hidden; }
#intro .gate::before { content: ""; position: absolute; left: -30%; right: -30%; top: 56%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,184,28,.0) 20%, rgba(255,214,140,.9) 50%, rgba(255,184,28,0) 80%, transparent);
  filter: blur(.4px); box-shadow: 0 0 18px 2px rgba(255,170,60,.45); animation: gateStreak 3.6s cubic-bezier(.5,0,.3,1) infinite; }
@keyframes gateStreak { 0% { transform: translateX(-60%) scaleX(.4); opacity: 0; } 25% { opacity: 1; } 70% { opacity: .8; } 100% { transform: translateX(60%) scaleX(1.2); opacity: 0; } }
#intro .gate .gw { font-family: var(--font-display); font-size: clamp(54px, 11vw, 150px); line-height: .9; letter-spacing: .03em; margin: 0 0 2.2vh; white-space: nowrap;
  background: linear-gradient(100deg, #8d98a6 0%, #e9eef3 35%, #fff3d6 50%, #e9eef3 65%, #8d98a6 100%); background-size: 240% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: gateSheen 5s ease-in-out infinite; filter: drop-shadow(0 10px 30px rgba(0,0,0,.8)); }
@keyframes gateSheen { 0%, 100% { background-position: 100% 0; } 50% { background-position: 0% 0; } }
#intro .gate .gt { font-family: var(--font-mono); font-size: clamp(10px, 1.1vw, 13px); letter-spacing: .45em; text-transform: uppercase; color: #c9d3dd; opacity: .7; margin: 0 0 5vh; }
#intro .gate div { text-align: center; color: #f3ead2; }
#intro .gate p { margin: 0; font-family: var(--font-mono); letter-spacing: .4em; text-transform: uppercase; }
#intro .gate .g1 { font-size: 12px; color: #ffb81c; margin-bottom: 18px; }
#intro .gate .g2 { font-size: clamp(14px, 1.8vw, 20px); animation: introPulse 1.6s ease-in-out infinite; }
#intro .gate .g3 { margin-top: 14px; font-size: 11px; letter-spacing: .25em; opacity: .65; }
@keyframes introPulse { 50% { opacity: .45; } }`;
    document.head.appendChild(s);
  }
  function buildOverlay() {
    css();
    const el = document.createElement("div"); el.id = "intro";
    el.innerHTML = `<div class="curtain"></div><div class="lb t"></div><div class="lb b"></div>
<div class="radio"></div>
<div class="cap"><span class="cap-n"></span><span class="cap-t"></span></div>
<div class="flash"></div><div class="scrim"></div><div class="streak"></div>
<div class="logo-wrap"><div class="eb">Jet City Air Range</div><div class="big">JET CITY</div><div class="tag">Flight operations</div></div>
<div class="dip"></div>
<button class="skip" type="button" aria-label="Skip intro">Skip intro <kbd>Esc</kbd></button>`;
    document.body.appendChild(el);
    return el;
  }

  /* ---------------- poses ---------------- */
  const UP = V3(0, 1, 0), ZERO = V3(0, 0, 0), _m = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _ea = new THREE.Euler();
  const _d = V3(), _p0 = V3(), _p1 = V3(), _o = V3();
  /** Level-ish attitude flying along `dir`, then banked (roll, rad) and pitched (rad) in its own frame. */
  function attitude(out, dir, roll, pitch) {
    _m.lookAt(ZERO, _d.copy(dir).normalize(), Math.abs(dir.y) > 0.98 * dir.length() ? V3(1, 0, 0) : UP);
    out.setFromRotationMatrix(_m);
    if (pitch) out.multiply(_qa.setFromAxisAngle(V3(1, 0, 0), pitch));
    if (roll) out.multiply(_qa.setFromAxisAngle(V3(0, 0, 1), roll));
    return out;
  }
  /** Pose from a path function f(u) -> position: direction from a central difference. Returns speed (m/s). */
  function along(f, u, outP, outQ, roll, pitch) {
    f(u - 0.02, _p0); f(u + 0.02, _p1); f(u, outP);
    _o.copy(_p1).sub(_p0);
    attitude(outQ, _o, roll || 0, pitch || 0);
    return _o.length() / 0.04;
  }
  /** Formation member k: offset [x right, y up, z behind] in the lead's frame. */
  function slotOf(off, P, Q, out) { return out.set(off[0], off[1], off[2]).applyQuaternion(Q).add(P); }

  /* ---------------- the cast ---------------- */
  const cast = {};
  function jet(id, opts) { const j = new RJ.Aircraft(id, Object.assign({ team: "red" }, opts || {})); j.place(V3(I.C.x, 200, I.C.z), 0, 0); j.mesh.visible = false; if (RJ.setGear) RJ.setGear(j.mesh, 0); return j; }
  function pose(j, P, Q, speed, ab, dt) {
    j.pos.copy(P); j.q.copy(Q); j.updateBasis();
    j.vel.copy(V3(0, 0, -1).applyQuaternion(Q)).multiplyScalar(speed); j.speed = speed; j.state = "flying"; j.g = 1;
    j.throttle = 0.92; j.spool = 0.92; j.abLevel = ab; j.gearT = 0;
    j.updateVisual(dt); j.mesh.visible = true; I.shown.add(j);
  }
  const smokeKey = new Map();
  function smoke(j, on) {
    if (!RJ.ribbons) return;
    let r = smokeKey.get(j);
    if (!r) { r = RJ.ribbons.create({ life: 14, w0: 3.2, w1: 26, alpha: 0.74, spacing: 4 }); smokeKey.set(j, r); }
    if (!on) { r.cut(); return; }
    r.add(V3(0, 0, 1).applyQuaternion(j.q).multiplyScalar(j.vis && j.vis.dims ? j.vis.dims.len * 0.55 : 9).add(j.pos));
  }

  /** The open-water spot nearest (a, s) where a radius-R disc is clear of islands (coast-relative coordinates). */
  function openWater(a0, s0, R) {
    let best = null, bestScore = -1;
    for (let da = -3000; da <= 3000; da += 750) for (let ds = -900; ds <= 2400; ds += 600) {
      const a = a0 + da, s = s0 + ds; let ok = 0, n = 0;
      for (let i = 0; i < 24; i++) { const an = i / 24 * Math.PI * 2; for (const r of [0, R * 0.5, R]) { const q = B(a + Math.cos(an) * r, CS(s + Math.sin(an) * r), 0); n++; if (RJ.world.terrainHeight(q.x, q.z) < -4) ok++; } }
      const score = ok / n - (Math.abs(da) + Math.abs(ds)) * 1e-5;
      if (score > bestScore) { bestScore = score; best = [a, s]; }
    }
    return best;
  }
  /* ---------------- set dressing: the carrier SS LUKEPIZZA ---------------- */
  function buildCarrier() {
    const K = RJ.carrier; if (!K || !K.build) return null;
    let site = null;
    for (const [a, s] of [[600, 2600], [900, 2900], [300, 3200], [1200, 2400], [-600, 2800], [0, 3600], [1500, 3200]]) {
      if (site) break;
      const p = B(a, CS(s), 0); let ok = true;
      for (const [da, ds] of [[0, 0], [200, 0], [-200, 0], [0, 60], [0, -60]]) { const q = B(a + da, CS(s + ds), 0); if (RJ.world.terrainHeight(q.x, q.z) > -14) ok = false; }
      if (ok) site = { x: p.x, z: p.z, heading: yawOf(I.L) };
    }
    if (!site) return null;
    const s0 = K.site, g0 = K.group;
    const grp = K.build(site);
    K.site = s0; K.group = g0; // visual only: the atlas carrier keeps its deck physics
    RJ.scene.add(grp);
    const h = site.heading, cos = Math.cos(h), sin = Math.sin(h);
    const W = (lx, ly, lz) => V3(site.x + lx * cos + lz * sin, ly, site.z - lx * sin + lz * cos);
    // her name on both sides of the bow
    const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
    const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, 1024, 128);
    g.font = "bold 92px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#e9e6dc"; g.fillText("SS LUKEPIZZA", 512, 66);
    const tex = new THREE.CanvasTexture(c), nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(56, 7), nm);
      pl.position.set(sx * 21.5, (K.DECK || 20) * 0.55, -118); pl.rotation.y = sx * Math.PI / 2; grp.add(pl);
    }
    return { grp, site, W, fwd: V3(-Math.sin(h), 0, -Math.cos(h)), side: V3(Math.cos(h), 0, -Math.sin(h)), deck: K.DECK || 20, base: grp.position.clone(), rot: grp.rotation.clone() };
  }

  /* ---------------- shots ----------------
   * Each shot: real-time window [t0, t1), the act it belongs to, a camera function (u = act clock) writing
   * cam.pos / cam.look / cam.fov, the hero (sound, focus) and optional caption / motion blur. */
  const CAM = { pos: V3(), look: V3(), fov: 40, roll: 0, shake: 0, blur: 0 };
  const P = V3(), Q = new THREE.Quaternion(), P2 = V3(), Q2 = new THREE.Quaternion(), tv = V3(), tv2 = V3();

  // ---- act 1: the Kulbit ----
  const K0 = 1.95, KD = 0.9;
  const kA = (u, out) => { // Angel 1
    const a0 = -1400, s = CS(1800), y = 220;
    if (u < K0) return B(a0 + 170 * u, s, y, out);
    const pk = a0 + 170 * K0;
    if (u < K0 + KD) { const k = (u - K0) / KD, th = Math.PI * 2 * ease(k), R = 55; return B(pk + 60 * k + R * Math.sin(th), s, y + R * (1 - Math.cos(th)), out); }
    const v = u - K0 - KD; return B(pk + 60 + 60 * v + 68 * v * v, s, y, out);
  };
  // F-22 chasing; it overshoots under the Kulbit and bleeds its speed, so Angel 1 drops in on its six
  const kF = (u, out) => { const w = u - (K0 + 0.35), d = w < 0 ? 240 * w : w < 1 ? 240 * w - 52 * w * w : 188 + 136 * (w - 1); return B(-1400 + 170 * K0 + 25 + d, CS(1800) + 6, 211, out); };
  function actK(u, dt) {
    const a = cast.A[0];
    let pitch = 0;
    if (u >= K0 && u < K0 + KD) pitch = Math.PI * 2 * ease((u - K0) / KD);
    kA(u, P); attitude(Q, I.L, 0, pitch);
    pose(a, P, Q, u >= K0 && u < K0 + KD ? 70 : 170, u > K0 - 0.3 && u < K0 + KD ? 1 : 0.2, dt);
    const sp = along(kF, u, P2, Q2, 0); pose(cast.f22, P2, Q2, sp, 1, dt);
    smoke(a, u > 0.6);
  }
  // ---- act 2: formation ----
  const fLead = (u, out) => {
    const s0 = CS(2600), v = 190;
    if (u < 4.8) return B(400, s0 - v * u, 45, out);
    const R = 420, ph = (u - 4.8) * v / R; // pull to the vertical and over
    return B(400, s0 - v * 4.8 - R * Math.sin(ph), 45 + R * (1 - Math.cos(ph)), out);
  };
  function actF(u, dt) {
    const sp = along(fLead, u, P, Q, 0);
    const roll = u > 2.5 && u < 4.6 ? Math.PI * 2 * ease((u - 2.5) / 2.1) : 0; // the whole Delta rolls as one
    const Qr = Q2.copy(Q).multiply(_qa.setFromAxisAngle(V3(0, 0, 1), roll));
    for (let k = 0; k < 6; k++) { const j = cast.A[k]; slotOf(I.delta[k], P, Qr, tv); pose(j, tv, Qr, sp, u > 4.8 ? 0.8 : 0.1, dt); smoke(j, true); }
  }
  // ---- act 3: showcase ----
  const S0 = () => B(I.sA, CS(I.sS), 0);
  function actS(T, dt) {
    const v = T - ACT.s[0], o = S0();
    if (v < 1.3) { // B-2: low, head-on, enormous
      B(I.sA - 760 + 150 * v, CS(I.sS), 70, P); attitude(Q, I.L, 0, 0); pose(cast.b2, P, Q, 150, 0, dt); I.hero = cast.b2;
    } else if (v < 2.6) { // YF-12: a Mach 3 thoroughbred, a blur past the lens
      const w = v - 1.3; B(I.sA + 300 - 430 * (w - 0.6), CS(I.sS) - 60, 42, P); attitude(Q, V3().copy(I.L).negate(), 0, 0); pose(cast.yf12, P, Q, 430, 1, dt); I.hero = cast.yf12;
    } else if (v < 3.9) { // F-14: a hard banked turn seen from above, the sea below
      const w = v - 2.6, R = 520, ang = -0.9 + w * 0.55;
      tv.set(Math.cos(ang) * R, 0, Math.sin(ang) * R); P.copy(o).add(tv); P.y = 260;
      const dir = V3(-Math.sin(ang), 0, Math.cos(ang)); attitude(Q, dir, -1.25, 0); pose(cast.f14, P, Q, 290, 0.6, dt); I.hero = cast.f14;
    } else if (v < 5.2) { // XB-70: six burners, chased low over the waves
      const w = v - 3.9; B(I.sA + 330 * w, CS(I.sS - 100), 38, P); attitude(Q, I.L, 0, 0); pose(cast.xb70, P, Q, 330, 1, dt); I.hero = cast.xb70;
    } else { // F-35: straight up, rolling, into the sun
      const w = v - 5.2; tv.copy(o); tv.y = 120 + 230 * w + 40 * w * w; P.copy(tv);
      attitude(Q, V3(0, 1, 0), w * 3.2, 0); pose(cast.f35, P, Q, 260, 1, dt); I.hero = cast.f35;
    }
  }
  // ---- act 4: the bandit ----
  const D = { fire: 2.1, hit: 4.1 };
  const dLead = (u, out) => B(I.dA, CS(I.dS) - 600 + 185 * u, 300, out);
  const dSu = (u, out) => { B(I.dA, CS(I.dS) + 1500 - 235 * u, 300, out); const b = Math.max(0, u - 2.35); out.addScaledVector(I.L, 32 * b * b); out.y += 10 * b * b; return out; };
  function actD(u, dt) {
    const sp = along(dLead, u, P, Q, 0);
    for (let k = 0; k < 6; k++) { const j = cast.A[k]; slotOf(I.delta[k], P, Q, tv); pose(j, tv, Q, sp, u > 1.6 ? 0.7 : 0.1, dt); smoke(j, false); }
    const su = cast.su57;
    if (u < D.hit) {
      const ss = along(dSu, u, P2, Q2, u > 2.35 ? -1.1 * sm(2.35, 2.8, u) : 0); pose(su, P2, Q2, ss, u > 2.35 ? 1 : 0.4, dt);
      if (u > 2.4 && u < 3.4 && Math.random() < 0.6 * (dt > 0 ? 1 : 0)) RJ.fx.fire(su.pos.clone().addScaledVector(su.up, -2), V3(0, -25, 0).addScaledVector(su.vel, 0.2), 1.6); // flares
    } else {
      // the kill: tumbling, burning, falling
      if (!I.kill) { I.kill = { p: P2.copy(su.pos).clone(), v: su.vel.clone().multiplyScalar(0.45), q: su.q.clone(), t: 0 }; boomFx(su.pos, 2.4); if (RJ.missileFx && RJ.missileFx.jetBlast) try { RJ.missileFx.jetBlast(su); } catch (e) { /* fx */ } }
      const k = I.kill; k.t += dt; k.v.y -= 9.8 * dt; k.p.addScaledVector(k.v, dt);
      k.q.multiply(_qa.setFromEuler(_ea.set(1.7 * dt, 0.6 * dt, 3.1 * dt)));
      pose(su, k.p, k.q, k.v.length(), 0, dt);
      if (dt > 0) { RJ.fx.fire(su.pos, su.vel.clone().multiplyScalar(0.2), 6); RJ.fx.smoke(su.pos, su.vel.clone().multiplyScalar(0.1), 5, 0.12, 6, 0.45); }
    }
    // the missile: launched off Angel 1's rail, flown on a curve that ends exactly on the bandit
    const M = I.msl;
    if (u >= D.fire && u < D.hit) {
      if (!M.on) { M.on = true; M.p0.copy(cast.A[0].pos).addScaledVector(cast.A[0].up, -1.5); M.d0.copy(V3(0, 0, -1).applyQuaternion(cast.A[0].q)); if (M.rib) M.rib.cut(); }
      const k = (u - D.fire) / (D.hit - D.fire), e = k * k * (2.2 - 1.2 * k); // accelerating motor
      dSu(D.hit, tv2);
      const c1 = tv.copy(M.p0).addScaledVector(M.d0, 700);
      M.prev.copy(M.pos);
      M.pos.copy(M.p0).multiplyScalar((1 - e) * (1 - e)).addScaledVector(c1, 2 * e * (1 - e)).addScaledVector(tv2, e * e);
      if (M.mesh) { M.mesh.visible = true; M.mesh.position.copy(M.pos); if (M.pos.distanceToSquared(M.prev) > 1e-4) M.mesh.lookAt(tv.copy(M.pos).add(tv2.copy(M.pos).sub(M.prev))); M.mesh.rotateY(Math.PI); }
      if (M.rib) M.rib.add(M.pos);
    } else if (M.mesh) M.mesh.visible = false;
  }
  // ---- act 5: SS LUKEPIZZA ----
  const C = { hits: [2.9, 3.08, 3.26, 3.44, 3.62, 3.8], sink: 3.9 };
  function cLead(u, out) { // a long dive from the stern, the length of the deck, pull-out over the bow
    const cv = I.cv, start = tv2.copy(cv.base).addScaledVector(cv.fwd, -2600); start.y = 900;
    const end = V3().copy(cv.base).addScaledVector(cv.fwd, 150); end.y = 140;
    const k = Math.min(u / 3.2, 1); out.lerpVectors(start, end, k);
    if (u > 3.2) { const w = u - 3.2; out.addScaledVector(cv.fwd, 220 * w); out.y += 160 * w * w; }
    return out;
  }
  function actC(u, dt) {
    const cv = I.cv;
    for (let k = 0; k < 6; k++) {
      const j = cast.A[k], uk = u - 0.32 * k; // line astern, a third of a second apart
      const sp = along(cLead, uk, P, Q, 0);
      if (u > C.sink + 0.4) { slotOf(I.delta[k], cLead(u - 0.2, P2), Q, tv); P.lerp(tv, sm(C.sink + 0.4, C.sink + 1.8, u)); } // rejoin the Delta on the climb-out
      pose(j, P, Q, sp, uk > 3.2 ? 1 : 0.15, dt); smoke(j, uk > 0.4);
    }
    // each Angel's weapon streaks down to its aim point half a second before it hits
    C.hits.forEach((h, i) => {
      const k0 = h - 0.55; if (u < k0 || u > h + 0.05) return;
      const st = I.strikes[i] || (I.strikes[i] = { from: cast.A[i].pos.clone(), rib: RJ.ribbons ? RJ.ribbons.create({ life: 5, w0: 1.2, w1: 9, alpha: 0.65, spacing: 3 }) : null });
      const p = cv.W((i % 2 ? 8 : -10), cv.deck + 4, 110 - i * 46), e = clamp01((u - k0) / 0.55);
      tv.lerpVectors(st.from, p, e * e); if (st.rib) st.rib.add(tv);
      if (dt > 0) RJ.fx.fire(tv, V3(0, 0, 0), 2.2);
    });
    // impacts walking up the deck from stern to bow, then she goes down by the bow, burning
    C.hits.forEach((h, i) => { if (u >= h && !I.hitDone[i]) { I.hitDone[i] = true; const p = cv.W((i % 2 ? 8 : -10), cv.deck + 4, 110 - i * 46); boomFx(p, 3.2 + i * 0.25); if (RJ.fx.smokeColumn) RJ.fx.smokeColumn(p, 1.6); } });
    if (u > C.sink) {
      const k = ease(clamp01((u - C.sink) / 3.2));
      cv.grp.position.y = cv.base.y - 34 * k; cv.grp.rotation.x = cv.rot.x - 0.11 * k; cv.grp.rotation.z = cv.rot.z + 0.13 * k;
      if (dt > 0 && Math.random() < 0.5) { const p = cv.W(RJ.rand(-14, 14), cv.deck - 34 * k + 2, RJ.rand(-120, 100)); RJ.fx.fire(p, V3(0, 6, 0), 9); RJ.fx.smoke(p, V3(0, 9, 0), 14, 0.12, 10, 0.5); }
    }
  }
  function boomFx(p, s) {
    RJ.fx.explosion(p, s, null);
    if (RJ.fx.debris) RJ.fx.debris(p, V3(0, 20, 0), s * 0.6);
    I.flashK = Math.max(I.flashK || 0, 0.35);
    if (I.A) { const now = I.A.ctx.currentTime; boom(I.A, now, 0.9, I.A.sfx); noiseHit(I.A, now, 0.8, "lowpass", 700, 2.2, 0.7, I.A.sfx); }
  }

  /* ---------------- the cut list ---------------- */
  const LIN = (a, b, x) => lerp(a, b, clamp01(x));
  const cent = (out) => { out.set(0, 0, 0); for (const j of cast.A) out.add(j.pos); return out.multiplyScalar(1 / cast.A.length); };
  const SHOTS = [
    // 1 — KULBIT
    { t: [1.1, 3.0], act: "k", hero: () => cast.A[0], cam(u) { const a = cast.A[0].pos, f = cast.f22.pos; tv.lerpVectors(a, f, 0.5); CAM.pos.copy(tv).addScaledVector(I.Sx, -620); CAM.pos.y = 214; CAM.look.copy(tv); CAM.fov = 11; } },
    { t: [3.0, 5.2], act: "k", hero: () => cast.A[0], slow: 0.32, cam(u) { kA(K0, tv); CAM.pos.copy(tv).addScaledVector(I.Sx, -78).addScaledVector(I.L, 18); CAM.pos.y = 214; CAM.look.copy(cast.A[0].pos).lerp(tv, 0.25); CAM.fov = LIN(52, 46, (u - K0) / KD); CAM.shake = u > K0 + 0.3 && u < K0 + 0.45 ? 0.5 : 0; } },
    { t: [5.2, 7.0], act: "k", hero: () => cast.A[0], cam(u) { const a = cast.A[0]; CAM.pos.copy(a.pos).addScaledVector(I.L, -24).add(tv.set(0, 4.5, 0)).addScaledVector(I.Sx, 3); CAM.look.copy(cast.f22.pos); CAM.fov = 30; } },
    // 2 — FORMATION
    { t: [7.0, 9.4], act: "f", hero: () => cast.A[0], blur: 0.012, cam(u) { B(392, CS(2600) - 190 * 1.45, 0, CAM.pos); CAM.pos.y = 4; const c = cast.A[3].pos; CAM.look.copy(c); CAM.fov = RJ.clamp(2 * Math.atan(42 / Math.max(30, CAM.pos.distanceTo(c))) / RJ.DEG, 26, 78); CAM.shake = Math.max(0, 1 - Math.abs(u - 1.42) / 0.3) * 0.9; } },
    { t: [9.4, 11.8], act: "f", hero: () => cast.A[1], cam(u) { cent(tv); const f = V3().copy(I.Sx).negate(); CAM.pos.copy(tv).addScaledVector(I.L, 150).addScaledVector(f, -40); CAM.pos.y = tv.y + 14; CAM.look.copy(tv).addScaledVector(f, 10); CAM.fov = 34; } },
    { t: [11.8, 14.0], act: "f", hero: () => cast.A[0], cam(u) { fLead(5.6, tv); CAM.pos.copy(tv).addScaledVector(I.L, 40); CAM.pos.y = 10; cent(CAM.look); CAM.fov = 48; } },
    // 3 — SHOWCASE
    { t: [14.0, 15.3], act: "s", cap: ["B-2 SPIRIT", "Stealth bomber"], cam() { const v = I.T - 14.0, b = cast.b2; CAM.pos.copy(b.pos).addScaledVector(I.L, 240 - 60 * v).addScaledVector(I.Sx, -70); CAM.pos.y = b.pos.y + 75; CAM.look.copy(b.pos); CAM.fov = 30; } },
    { t: [15.3, 16.6], act: "s", cap: ["YF-12", "Mach 3.2 interceptor"], blur: 0.02, cam() { B(I.sA + 300, CS(I.sS), 0, CAM.pos); CAM.pos.y = 30; CAM.look.copy(cast.yf12.pos); CAM.fov = 46; CAM.shake = Math.max(0, 1 - Math.abs(I.T - 15.9) / 0.25) * 0.8; } },
    { t: [16.6, 17.9], act: "s", cap: ["F-14 TOMCAT", "Variable-sweep fleet defender"], cam() { const o = S0(); CAM.pos.copy(cast.f14.pos).lerp(o, 0.12); CAM.pos.y = cast.f14.pos.y + 110; CAM.look.copy(cast.f14.pos); CAM.fov = 40; } },
    { t: [17.9, 19.2], act: "s", cap: ["XB-70 VALKYRIE", "Six engines, Mach 3"], cam() { const x = cast.xb70; CAM.pos.copy(x.pos).addScaledVector(I.L, -95).addScaledVector(I.Sx, 22); CAM.pos.y = 30; CAM.look.copy(x.pos).addScaledVector(I.L, 40); CAM.fov = 42; } },
    { t: [19.2, 20.5], act: "s", cap: ["F-35 LIGHTNING II", "Fifth-generation strike fighter"], cam() { const f = cast.f35; CAM.pos.copy(f.pos).addScaledVector(I.Sx, -38).addScaledVector(I.L, 6); CAM.pos.y -= 14; CAM.look.copy(f.pos); CAM.look.y += 4; CAM.fov = 40; } },
    // 4 — BANDIT
    { t: [20.5, 21.8], act: "d", hero: () => cast.su57, cam(u) { const s = cast.su57; dSu(u + 0.35, tv); CAM.pos.copy(tv).addScaledVector(I.Sx, -20).addScaledVector(I.L, 9); CAM.pos.y = s.pos.y + 2; CAM.look.copy(s.pos); CAM.fov = 22; } },
    { t: [21.8, 23.0], act: "d", hero: () => cast.A[0], lock: true, cam(u) { const a = cast.A[0]; CAM.pos.copy(a.pos).addScaledVector(I.Sx, -24).add(tv.set(0, 5, 0)).addScaledVector(I.L, -5); CAM.look.copy(cast.su57.pos); CAM.fov = 26; } },
    { t: [23.0, 24.4], act: "d", hero: () => cast.A[0], blur: 0.01, cam(u) { const M = I.msl; tv.copy(M.pos).sub(M.prev); if (tv.lengthSq() < 1e-4) tv.copy(I.Sx); tv.normalize(); CAM.pos.copy(M.pos).addScaledVector(tv, -9).addScaledVector(I.L, 3).add(tv2.set(0, 1.6, 0)); CAM.look.copy(M.pos).addScaledVector(tv, 30); CAM.fov = 58; } },
    { t: [24.4, 26.0], act: "d", hero: () => cast.su57, slow: 0.35, slowTo: 25.4, cam(u) { dSu(D.hit, tv); CAM.pos.copy(tv).addScaledVector(I.L, -150).addScaledVector(I.Sx, -60); CAM.pos.y = tv.y + 18; CAM.look.copy(cast.su57.pos); CAM.fov = 38; } },
    // 5 — SS LUKEPIZZA
    { t: [26.0, 27.4], act: "c", hero: () => cast.A[0], cap: ["SS LUKEPIZZA", "Enemy carrier · 330 m"], cam(u) { const cv = I.cv; CAM.pos.copy(cv.base).addScaledVector(cv.side, -900 + 90 * u).addScaledVector(cv.fwd, -250); CAM.pos.y = 22; CAM.look.copy(cv.base); CAM.look.y = 30; CAM.fov = 30; } },
    { t: [27.4, 28.8], act: "c", hero: () => cast.A[0], cam(u) { const cv = I.cv, a = cast.A[0]; tv.copy(cv.base).sub(a.pos).normalize(); CAM.pos.copy(a.pos).addScaledVector(tv, -46).add(tv2.set(0, 9, 0)).addScaledVector(cv.side, 10); CAM.look.copy(cv.base); CAM.look.y = cv.deck; CAM.fov = 50; } },
    { t: [28.8, 30.4], act: "c", hero: () => cast.A[2], slow: 0.45, slowTo: 29.9, cam(u) { const cv = I.cv; CAM.pos.copy(cv.base).addScaledVector(cv.side, -460).addScaledVector(cv.fwd, 40); CAM.pos.y = 14; CAM.look.copy(cv.base); CAM.look.y = 45; CAM.fov = 40; } },
    { t: [30.4, 35.0], act: "c", hero: () => cast.A[0], cam(u) { const cv = I.cv; CAM.pos.copy(cv.base).addScaledVector(cv.side, -1100).addScaledVector(cv.fwd, -500); CAM.pos.y = 150; CAM.look.copy(cv.base).lerp(cast.A[3].pos, 0.55); CAM.fov = 36; } }
  ];
  const CALLS = [[0.35, "BOSS", "Angel One, bandit on your six. Closing fast."], [2.7, "ANGEL 1", "Watch this."], [5.55, "ANGEL 1", "Reversal. He's mine."],
    [7.6, "BOSS", "Angels, smoke on. Let's give 'em a show."], [20.0, "DARKSTAR", "Bandit, bandit! Su-57 inbound, hot!"], [22.25, "ANGEL 1", "Fox two!"],
    [25.0, "ANGEL 1", "Splash one."], [26.2, "DARKSTAR", "Contact: SS LUKEPIZZA. Weapons free."], [28.3, "BOSS", "All Angels, in hot. Sink her."],
    [31.0, "BOSS", "She's going down. Angels, rejoin."]];

  function sayLine(who, text) {
    const r = I.q.radio;
    r.innerHTML = `<b>${who}</b>${text}`; r.classList.add("on");
    clearTimeout(I.radioT); I.radioT = setTimeout(() => r.classList.remove("on"), 2300);
    if (I.A) radioClick(I.A);
    const ss = window.speechSynthesis, s = RJ.settings;
    if (!ss || s.muted || !(s.master > 0) || !window.SpeechSynthesisUtterance) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace("—", ","));
      const vs = ss.getVoices().filter((v) => /^en/i.test(v.lang));
      if (vs.length) u.voice = vs[who === "BOSS" ? 0 : Math.min(vs.length - 1, 1)];
      u.rate = 1.12; u.pitch = who === "BOSS" ? 0.8 : 1.0; u.volume = Math.min(1, s.master * 0.9);
      ss.cancel(); ss.speak(u);
    } catch (e) { /* no voice */ }
  }

  /* ---------------- audio ---------------- */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function makeAudio() {
    const AU = RJ.audio, ctx = AU.ctx;
    if (!ctx || !AU.master) return null;
    const A = { ctx, nodes: [], srcs: [], ev: [], evI: 0, base: null };
    const keep = (n) => { A.nodes.push(n); return n; };
    const gain = (v) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };
    const filt = (type, f, q) => { const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; };
    const loop = (buf, rate) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; if (rate) s.playbackRate.value = rate; A.srcs.push(s); return s; };
    A.bus = gain(1); A.bus.connect(AU.master);
    const mv = RJ.settings.musicVol == null ? 0.5 : RJ.settings.musicVol, sv = RJ.settings.sfxVol == null ? 1 : RJ.settings.sfxVol;
    A.mus = gain(0.6 * Math.min(1.6, mv / 0.5)); A.mus.connect(A.bus);
    A.sfx = gain(Math.min(1.5, sv)); A.sfx.connect(A.bus);
    // hall reverb
    const len = Math.round(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const rev = keep(ctx.createConvolver()); rev.buffer = ir;
    A.mIn = gain(1); A.mIn.connect(gain(0.85)).connect(A.mus); A.mIn.connect(rev).connect(gain(0.42)).connect(A.mus);
    // noise and crackle
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    let br = 0; for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; nd[i] = w * 0.6 + br * 3; }
    A.noise = nb;
    const cb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() < 0.006 ? (Math.random() * 2 - 1) * 3 : 0) + (Math.random() * 2 - 1) * 0.25;
    A.crackle = cb;
    // engine voice (nearest jet): roar, rumble, whine, afterburner crackle; distance, Doppler and pan
    A.eng = gain(0); A.pan = keep(ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain());
    A.eng.connect(A.pan).connect(gain(0.9)).connect(A.sfx);
    const ns = loop(nb); A.lp = filt("lowpass", 600, 0.6); ns.connect(A.lp).connect(gain(0.9)).connect(A.eng); A.ns = ns;
    const rs = loop(nb, 0.35); rs.connect(filt("lowpass", 140)).connect(gain(1.6)).connect(A.eng);
    A.whine = [2850, 4150].map((f) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; A.srcs.push(o); return o; });
    const wb = filt("bandpass", 3400, 2.5); A.wg = gain(0.05);
    for (const o of A.whine) o.connect(wb); wb.connect(A.wg).connect(A.eng);
    const ab = loop(cb); A.abg = gain(0); ab.connect(filt("bandpass", 1500, 0.6)).connect(A.abg).connect(A.eng);
    const abr = loop(nb, 0.6); A.abr = gain(0); abr.connect(filt("lowpass", 420)).connect(A.abr).connect(A.eng);
    // ambience: wind, crowd, radio static
    A.amb = gain(0.9); A.amb.connect(A.sfx);
    const wn = loop(nb, 0.5); A.wind = gain(0.12); wn.connect(filt("lowpass", 520)).connect(A.wind).connect(A.amb);
    const cr = loop(nb, 1.0); A.crowd = gain(0.02);
    const cr1 = filt("bandpass", 650, 0.7), cr2 = filt("bandpass", 1600, 1.4), crg = gain(1);
    cr.connect(cr1).connect(crg); cr.connect(cr2).connect(crg); crg.connect(A.crowd).connect(A.amb);
    const st = loop(cb, 1.3); A.stat = gain(0); st.connect(filt("highpass", 2400)).connect(A.stat).connect(A.amb);
    const far = loop(nb, 0.22); A.far = gain(0); far.connect(filt("lowpass", 95)).connect(A.far).connect(A.amb); // distant engines across the water
    const t0 = ctx.currentTime + 0.02;
    for (const s of A.srcs) s.start(t0);
    score(A);
    return A;
  }
  function voice(A, type, f, t, dur, vol, att, rel, cut, det, dest) {
    const ctx = A.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = cut; lp.Q.value = 0.7;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur)); g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(att, dur) + rel);
    lp.connect(g).connect(dest || A.mIn);
    for (const d of det) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = d;
      o.connect(lp); o.start(t); o.stop(t + Math.max(att, dur) + rel + 0.05); A.srcs.push(o);
    }
    return lp;
  }
  const strings = (A, notes, t, dur, vol) => { for (const m of notes) voice(A, "sawtooth", mtof(m), t, dur, vol, 0.45, 1.1, 1500 + m * 12, [-9, 0, 8]); };
  function brass(A, notes, t, dur, vol) {
    for (const m of notes) {
      const lp = voice(A, "sawtooth", mtof(m), t, dur, vol, 0.07, 0.5, 700, [-5, 5]);
      lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2600 + m * 10, t + 0.1); lp.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
    }
  }
  function noiseHit(A, t, vol, type, f, dur, q, dest) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl).connect(g).connect(dest || A.mIn); s.start(t, Math.random()); s.stop(t + dur + 0.05); A.srcs.push(s);
    return fl;
  }
  function timp(A, m, t, vol) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(mtof(m) * 1.06, t); o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    o.connect(g).connect(A.mIn); o.start(t); o.stop(t + 1.7); A.srcs.push(o);
    noiseHit(A, t, vol * 0.5, "lowpass", 380, 0.35);
  }
  function boom(A, t, vol, dest) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6);
    o.connect(g).connect(dest || A.mus); o.start(t); o.stop(t + 2.7); A.srcs.push(o);
  }
  function swell(A, t, dur, vol) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; s.loop = true; fl.type = "highpass"; fl.frequency.value = 4500;
    g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    s.connect(fl).connect(g).connect(A.mIn); s.start(t); s.stop(t + dur + 0.1); A.srcs.push(s);
  }
  function radioClick(A) {
    const ctx = A.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = 1850;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(A.amb); o.start(t); o.stop(t + 0.1); A.srcs.push(o);
    A.stat.gain.cancelScheduledValues(t); A.stat.gain.setValueAtTime(0.09, t); A.stat.gain.linearRampToValueAtTime(0.035, t + 0.25); A.stat.gain.linearRampToValueAtTime(0, t + 2.2);
  }
  // the score (D minor, ~100 bpm): tension under the chase, a hush in the Kulbit, the drop on the Delta pass,
  // a hit on every showcase cut, a dark pulse for the bandit, the kill, a war drum on the carrier, the logo
  function score(A) {
    const E = (t, fn) => A.ev.push({ t, fn });
    E(0, (w) => { boom(A, w + 0.2, 0.28, A.sfx); strings(A, [26, 38], w, 3.2, 0.03); });
    [0.3, 0.95, 1.5, 1.95, 2.35, 2.65, 2.9].forEach((x, i) => E(x, (w) => timp(A, 38, w, 0.18 + i * 0.05)));
    E(1.1, (w) => strings(A, [50, 53, 57], w, 1.9, 0.02));
    E(1.6, (w) => swell(A, w, 1.35, 0.12));
    // the Kulbit: everything drops away to a high shimmer, a heartbeat, then the hit as he goes over the top
    E(3.0, (w) => { strings(A, [74, 77, 81, 86], w, 2.2, 0.012); boom(A, w, 0.4, A.sfx); });
    [3.3, 3.9, 4.5].forEach((x) => E(x, (w) => timp(A, 33, w, 0.35)));
    E(5.2, (w) => { brass(A, [38, 45, 50, 53, 57], w, 0.7, 0.05); timp(A, 38, w, 0.7); noiseHit(A, w, 0.35, "highpass", 2500, 1.8); });
    E(5.6, (w) => swell(A, w, T_DROP - 5.65, 0.18));
    for (let x = 6.0; x < T_DROP - 0.03; x += 0.07) E(x, (w) => noiseHit(A, w, 0.04 + 0.18 * sm(6.0, T_DROP, x), "bandpass", 1900, 0.06, 1.2));
    // THE DROP: the Delta over the lens
    E(T_DROP - 0.02, (w) => { brass(A, [38, 45, 50, 53, 57, 62], w, 1.0, 0.058); strings(A, [50, 53, 57, 62, 65], w, 1.3, 0.03); timp(A, 38, w, 0.95); timp(A, 26, w, 0.65); boom(A, w, 1.0); noiseHit(A, w, 0.5, "highpass", 2500, 2.6); });
    const roots = [[7.0, 38], [9.4, 34], [11.8, 41], [14.0, 38], [15.3, 34], [16.6, 36], [17.9, 33], [19.2, 38], [20.5, 38], [23.0, 34], [24.4, 33], [26.0, 38], [27.4, 34], [28.8, 36], [30.4, 41]];
    const rootAt = (x) => { let r = 38; for (const [a, b] of roots) if (x >= a - 1e-3) r = b; return r; };
    const ost = (from, to, step, v0, v1) => { for (let x = from, n = 0; x < to - 0.02; x += step, n++) { const r = rootAt(x), v = (n % 4 === 0 ? 1.5 : 1) * lerp(v0, v1, (x - from) / (to - from)); E(x, (w) => voice(A, "sawtooth", mtof(r), w, step * 0.4, v, 0.01, 0.14, 900, [-6, 6])); } };
    ost(7.15, 20.4, 0.3, 0.05, 0.065);
    ost(20.5, 24.35, 0.15, 0.035, 0.075);
    ost(26.0, 31.9, 0.3, 0.06, 0.08);
    const ch = [[9.4, [46, 50, 53, 58], [58, 62, 65]], [11.8, [41, 48, 53, 57, 60], [65, 69, 72, 77]], [14.0, [50, 54, 57, 62], [66, 69, 74]], [15.3, [46, 50, 53, 58], [62, 65, 70]],
      [16.6, [48, 52, 55, 60], [64, 67, 72]], [17.9, [45, 49, 52, 57], [61, 64, 69]], [19.2, [50, 54, 57, 62], [66, 69, 74]], [26.0, [38, 45, 50, 53], [62, 65]], [27.4, [46, 50, 53, 58], [62, 65, 70]]];
    for (const [s, b, st] of ch) E(s, (w) => { brass(A, b, w, 0.9, 0.044); strings(A, st, w, 1.1, 0.026); timp(A, b[0] - 12, w, 0.45); });
    [[9.4, 69, 0.5], [9.9, 74, 0.45], [10.4, 76, 0.4], [10.8, 77, 0.6], [11.8, 81, 1.4], [14.0, 78, 0.9], [15.3, 81, 0.5], [16.6, 79, 0.6], [17.9, 76, 0.6], [19.2, 81, 1.0]].forEach(([s, m, d]) => E(s, (w) => brass(A, [m], w, d, 0.034)));
    E(11.8, (w) => { noiseHit(A, w, 0.3, "highpass", 3000, 2.4); boom(A, w, 0.5); });
    // the bandit: a low pulse, lock tone, the launch, a hush, the kill
    E(20.5, (w) => { strings(A, [38, 41, 44], w, 2.4, 0.03); boom(A, w, 0.6, A.sfx); });
    for (let x = 21.9; x < 22.6; x += 0.11) E(x, (w) => { const o = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = "square"; o.frequency.value = x > 22.3 ? 1320 : 990; g.gain.setValueAtTime(0.03, w); g.gain.exponentialRampToValueAtTime(0.0005, w + 0.08); o.connect(g).connect(A.sfx); o.start(w); o.stop(w + 0.09); A.srcs.push(o); });
    E(22.6, (w) => { noiseHit(A, w, 0.6, "lowpass", 900, 1.4, 0.7, A.sfx); noiseHit(A, w, 0.4, "highpass", 3200, 1.6, 0.7, A.sfx); swell(A, w, 1.8, 0.14); });
    E(24.4, (w) => strings(A, [74, 77, 81], w, 0.6, 0.012));
    E(24.95, (w) => { brass(A, [38, 45, 50, 54, 57, 62], w, 1.0, 0.055); timp(A, 38, w, 1.0); boom(A, w, 1.0); noiseHit(A, w, 0.5, "highpass", 2500, 2.8); });
    // the carrier: war drums into the strike, then the triumph
    [26.2, 26.7, 27.2, 27.6, 28.0, 28.3, 28.55].forEach((x, i) => E(x, (w) => timp(A, 33, w, 0.3 + i * 0.07)));
    for (let x = 27.8; x < 28.78; x += 0.06) E(x, (w) => noiseHit(A, w, 0.05 + 0.2 * sm(27.8, 28.8, x), "bandpass", 1900, 0.06, 1.2));
    E(30.4, (w) => { brass(A, [41, 48, 53, 57, 60, 65], w, 1.2, 0.055); strings(A, [53, 57, 60, 65, 69], w, 1.5, 0.03); timp(A, 41, w, 0.8); });
    [[30.4, 81, 0.5], [30.9, 84, 0.5], [31.4, 86, 0.6]].forEach(([s, m, d]) => E(s, (w) => brass(A, [m], w, d, 0.034)));
    E(LOGO, (w) => { brass(A, [38, 45, 50, 54, 57, 62, 66, 69, 74], w, 1.3, 0.054); strings(A, [50, 54, 57, 62, 66, 69, 74, 78], w, 2.0, 0.03); timp(A, 38, w, 1.0); timp(A, 26, w + 0.02, 0.7); boom(A, w, 1.0); noiseHit(A, w, 0.5, "highpass", 2500, 3.4); });
    E(LOGO + 1.4, (w) => strings(A, [50, 57, 62, 66], w, 1.4, 0.018));
  }
  function audioTick(A, T, camPos, src, srcFwd, ab, rate, dt) {
    if (!A || A.ctx.state !== "running") { if (A) A.base = null; return; }
    const now = A.ctx.currentTime;
    if (A.base == null) { A.base = now - T; while (A.evI < A.ev.length && A.ev[A.evI].t < T - 0.04) A.evI++; }
    while (A.evI < A.ev.length && A.ev[A.evI].t <= T + 0.3) { const e = A.ev[A.evI++]; try { e.fn(Math.max(now + 0.005, A.base + e.t)); } catch (err) { /* voice limit */ } }
    const rel = V3().copy(camPos).sub(src), r = Math.max(6, rel.length());
    const close = A.prevR != null && A.src === I.near ? (A.prevR - r) / Math.max(dt, 1e-3) : 0;
    A.prevR = r; A.src = I.near;
    const dop = RJ.clamp(343 / Math.max(120, 343 - RJ.clamp(close, -300, 300)), 0.62, 1.75) * (0.55 + 0.45 * rate);
    A.dop = RJ.damp(A.dop || dop, dop, 10, dt);
    const aft = Math.max(0, -rel.normalize().dot(srcFwd));
    const near = RJ.clamp(70 / r, 0, 1.3) * (I.engMute ? 0 : 1);
    let lvl = near * (0.75 + 0.75 * aft) * (I.groupGain || 1);
    if (I.airToAir) lvl *= 0.5;
    lvl *= 1 - sm(I.LOGO_T, I.DUR + 0.5, T);
    A.eng.gain.setTargetAtTime(lvl, now, 0.05);
    A.lp.frequency.setTargetAtTime(Math.min(16000, (380 + 9000 * Math.min(1, near * near)) * A.dop), now, 0.05);
    A.ns.playbackRate.setTargetAtTime(0.75 + 0.3 * A.dop, now, 0.05);
    A.whine[0].frequency.setTargetAtTime(2850 * A.dop, now, 0.04); A.whine[1].frequency.setTargetAtTime(4150 * A.dop, now, 0.04);
    A.wg.gain.setTargetAtTime(0.06 * (1 - aft) * Math.min(1, near * 1.5), now, 0.05);
    A.abg.gain.setTargetAtTime(0.5 * ab * (0.4 + 0.6 * aft), now, 0.05); A.abr.gain.setTargetAtTime(1.1 * ab, now, 0.05);
    if (A.pan.pan) A.pan.pan.setTargetAtTime(RJ.clamp(A.panX || 0, -0.9, 0.9), now, 0.05);
    // ambience: wind fades once the show starts, the crowd follows the action
    A.wind.gain.setTargetAtTime(0.3 * (1 - 0.75 * sm(T_DROP, T_DROP + 2, T)), now, 0.2);
    A.far.gain.setTargetAtTime(0.9 * sm(0, 1.4, T) * (1 - sm(5.6, 6.5, T)), now, 0.2);
    A.crowd.gain.setTargetAtTime(I.crowdOn ? 0.025 + 0.24 * (I.cheer || 0) : 0.004, now, 0.12);
    if (A.lastClose > 40 && close < 0 && r < 220 && !(A.ripT > T - 1.5)) { A.ripT = T; noiseHit(A, now, 0.9, "lowpass", 2400 * (0.5 + 0.5 * rate), 2.2 / Math.max(0.4, rate), 0.7, A.sfx); }
    A.lastClose = close;
  }
  function audioStop(A, fade) {
    if (!A) return;
    const now = A.ctx.currentTime;
    A.ev.length = 0;
    try { A.bus.gain.cancelScheduledValues(now); A.bus.gain.setValueAtTime(A.bus.gain.value, now); A.bus.gain.linearRampToValueAtTime(0, now + fade); } catch (e) { /* closed */ }
    setTimeout(() => {
      for (const s of A.srcs) { try { s.stop(); } catch (e) { /* already stopped */ } }
      for (const n of A.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
      A.srcs.length = 0;
    }, fade * 1000 + 120);
  }


  /* ---------------- start / frame / finish ---------------- */
  /** api: { jets (the six Angels), delta, beach: { x, z, y, alongX, alongZ, seaX, seaZ, crowdS }, render(dt, focus, motion, exposure), done(skipped) } */
  I.start = function (api) {
    if (I.active || I.played || !api.beach || !api.jets || api.jets.length < 6) return false;
    I.active = true; I.played = true; I.api = api; I.T = 0; I.ended = false;
    const b = api.beach;
    I.crowdS = b.crowdS != null ? b.crowdS : -55; I.C = V3(b.x, 0, b.z); I.L = V3(b.alongX, 0, b.alongZ).normalize(); I.Sx = V3(b.seaX, 0, b.seaZ).normalize(); I.groundY = b.y;
    I.delta = api.delta && api.delta.length >= 6 ? api.delta : DIAMOND;
    I.LOGO_T = LOGO; I.FLIP_T = LOGO + 1.9; I.DUR = END;
    I.u = { k: 0, f: 0, s: 0, d: 0, c: 0 }; I.rate = 1; I.shown = new Set(); I.hitDone = []; I.kill = null; I.strikes = [];
    cast.A = api.jets.slice(0, 6);
    try {
      cast.f22 = jet("f22"); cast.su57 = jet("su57"); cast.b2 = jet("b2"); cast.yf12 = jet("yf12"); cast.f14 = jet("f14"); cast.xb70 = jet("xb70"); cast.f35 = jet("f35a");
    } catch (e) { console.warn("Intro cast failed", e); I.active = false; return false; }
    I.extras = [cast.f22, cast.su57, cast.b2, cast.yf12, cast.f14, cast.xb70, cast.f35];
    [I.sA, I.sS] = openWater(-1500, 2200, 1300);
    [I.dA, I.dS] = openWater(800, 3000, 1600);
    I.cv = buildCarrier();
    if (!I.cv) { const p = B(600, CS(2600), 0), grp = new THREE.Group(); grp.position.copy(p); RJ.scene.add(grp); const h = yawOf(I.L), c = Math.cos(h), s = Math.sin(h);
      I.cv = { grp, W: (lx, ly, lz) => V3(p.x + lx * c + lz * s, ly, p.z - lx * s + lz * c), fwd: V3(-s, 0, -c), side: V3(c, 0, -s), deck: 20, base: p.clone(), rot: grp.rotation.clone() }; }
    I.msl = { on: false, p0: V3(), d0: V3(), pos: V3(), prev: V3(), mesh: null, rib: null };
    try { I.msl.mesh = RJ.missileFx && RJ.missileFx.mesh ? RJ.missileFx.mesh("radar") : null; } catch (e) { I.msl.mesh = null; }
    if (!I.msl.mesh) I.msl.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    I.msl.mesh.visible = false; RJ.scene.add(I.msl.mesh);
    if (RJ.ribbons) I.msl.rib = RJ.ribbons.create({ life: 7, w0: 1.4, w1: 11, alpha: 0.6, spacing: 3 });
    I.el = buildOverlay();
    I.q = {}; for (const c of ["curtain", "radio", "flash", "scrim", "streak", "logo-wrap", "big", "dip", "skip", "cap", "cap-n", "cap-t"]) I.q[c] = I.el.querySelector("." + c);
    I.lock = document.createElement("div");
    I.lock.style.cssText = "position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:2px solid #ff4a3a;box-shadow:0 0 12px rgba(255,74,58,.7);opacity:0;font:600 11px/1 var(--font-mono),monospace;color:#ff6a5a;letter-spacing:.2em;transition:opacity .15s";
    I.lock.innerHTML = '<span style="position:absolute;top:-17px;left:50%;transform:translateX(-50%);white-space:nowrap">LOCK</span>';
    I.el.appendChild(I.lock);
    I.q.skip.addEventListener("click", (e) => { e.stopPropagation(); I.skip(); });
    I.key = (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); I.skip(); return; }
      if (I.gate) I.begin();
    };
    addEventListener("keydown", I.key, true);
    RJ.ui.hideAll();
    RJ.post.cinematic = true; RJ.world.noMist = true;
    RJ.state.mode = "intro";
    const ctx = RJ.audio.ctx;
    if (!(ctx && ctx.state === "running") && !RJ.settings.muted && !I.noGate) {
      I.gate = document.createElement("div"); I.gate.className = "gate";
      I.gate.innerHTML = `<div><p class="g1">Fleet Week · Jet City Air Range</p><p class="gw">JET CITY</p><p class="gt">Real jets · real cities · real sky</p><p class="g2">Click or press any key to begin</p><p class="g3">🔊 Sound on · Esc skips the intro</p></div>`;
      I.gate.addEventListener("pointerdown", () => I.begin());
      I.el.appendChild(I.gate);
    } else I.begin();
    I.frame(0);
    return true;
  };
  I.begin = function () {
    if (!I.active || I.running) return;
    if (I.gate) { I.gate.remove(); I.gate = null; }
    RJ.audio.init(); if (RJ.audio.unlock) RJ.audio.unlock();
    if (RJ.audio.ctx && RJ.audio.ctx.state !== "running") RJ.audio.ctx.resume().catch(() => {});
    try { I.A = makeAudio(); } catch (e) { console.warn("Intro audio unavailable", e); I.A = null; }
    I.running = true; I.T = 0; I.callI = 0;
  };

  const ACTS = { k: (u, dt) => actK(u, dt), f: (u, dt) => actF(u, dt), s: (u, dt) => actS(I.T, dt), d: (u, dt) => actD(u, dt), c: (u, dt) => actC(u, dt) };
  I.frame = function (dt) {
    if (!I.active) return;
    dt = Math.min(dt || 0, 0.1);
    if (I.running) I.T += dt;
    const T = I.T, cam = RJ.camera;
    const shot = SHOTS.find((s) => T >= s.t[0] && T < s.t[1]) || SHOTS[0];
    // slow motion: the act clock runs slow inside the shot's window, easing in and out
    const want = shot.slow && T < (shot.slowTo || shot.t[1]) ? shot.slow : 1;
    I.rate = RJ.damp(I.rate, want, 9, dt || 0.016);
    const adt = (I.running ? dt : 0) * I.rate;
    for (const k in ACT) if (T >= ACT[k][0]) I.u[k] += adt;
    I.shown.clear();
    ACTS[shot.act](I.u[shot.act], adt);
    for (const j of cast.A.concat(I.extras)) if (!I.shown.has(j)) j.mesh.visible = false;
    // camera
    CAM.shake = 0; CAM.blur = shot.blur || 0;
    shot.cam(I.u[shot.act]);
    cam.position.copy(CAM.pos);
    const gy = Math.max(0, RJ.world.ground(cam.position.x, cam.position.z)) + 1.5;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.up.set(0, 1, 0); cam.lookAt(CAM.look);
    if (CAM.shake > 0) { cam.rotateX(Math.sin(T * 61) * CAM.shake * 0.012); cam.rotateY(Math.sin(T * 47 + 1) * CAM.shake * 0.01); }
    const cut = I.lastShot !== shot; I.lastShot = shot;
    cam.fov = cut ? CAM.fov : RJ.damp(cam.fov, CAM.fov, 6, dt || 0.016);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const hero = shot.hero ? shot.hero() : I.hero || cast.A[0];
    I.near = hero;
    const sc = tv.copy(hero.pos).project(cam);
    RJ.post.fx.motionCenter = [RJ.clamp((sc.x + 1) / 2, 0.15, 0.85), RJ.clamp((sc.y + 1) / 2, 0.15, 0.85)];
    I.api.render(adt, hero, CAM.blur + CAM.shake * 0.006, shot.act === "s" ? 1.08 : 1.03);
    for (const j of cast.A.concat(I.extras)) if (!I.shown.has(j)) j.mesh.visible = false;
    if (!I.running) return;
    // overlay
    const q = I.q;
    q.curtain.style.opacity = 1 - sm(T_OPEN - 0.1, T_OPEN + 0.4, T);
    while (I.callI < CALLS.length && T >= CALLS[I.callI][0]) { const c = CALLS[I.callI++]; sayLine(c[1], c[2]); }
    const cap = T < LOGO - 0.3 ? shot.cap : null;
    if (cap !== I.cap) {
      I.cap = cap;
      if (cap) { q["cap-n"].textContent = cap[1]; q["cap-t"].textContent = cap[0]; q.cap.classList.add("on"); } else q.cap.classList.remove("on");
    }
    // lock box on the bandit
    if (shot.lock) {
      const s = tv.copy(cast.su57.pos).project(cam), on = s.z < 1 && T > 22.0;
      I.lock.style.left = ((s.x + 1) / 2 * 100) + "%"; I.lock.style.top = ((1 - s.y) / 2 * 100) + "%";
      I.lock.style.opacity = on ? (T > 22.25 ? 1 : (Math.floor(T * 12) % 2)) : 0;
      I.lock.style.transform = `scale(${T > 22.25 ? 0.8 : 1.3 - 0.5 * sm(22.0, 22.25, T)})`;
    } else I.lock.style.opacity = 0;
    I.flashK = Math.max(0, (I.flashK || 0) - dt * 2.5);
    const hit = T - LOGO;
    q.flash.style.opacity = hit > 0 ? Math.max(0, 0.8 * Math.exp(-hit * 3.4)) : I.flashK * 0.6;
    q.scrim.style.opacity = hit > 0 && T < I.FLIP_T + 0.2 ? Math.min(1, hit * 2) : I.flipped ? 0 : q.scrim.style.opacity;
    if (hit > 0 && !q.big.classList.contains("sweep")) q.big.classList.add("sweep");
    q.streak.style.opacity = hit > 0 ? Math.max(0, 1 - hit * 1.3) : 0;
    q.streak.style.transform = `translate(-50%, -50%) scaleX(${hit > 0 ? Math.min(1, hit * 3) : 0})`;
    const lw = q["logo-wrap"];
    if (hit > 0 && T < I.FLIP_T) {
      const k = Math.min(1, hit / 0.55);
      lw.style.opacity = k; lw.style.filter = `blur(${(1 - k) * 12}px)`;
      lw.style.transform = `translate(-50%, -50%) scale(${1.14 - 0.14 * ease(k) + 0.025 * Math.min(1, hit / 1.6)})`;
      q.big.style.letterSpacing = (0.14 - 0.12 * ease(k)) + "em";
    }
    if (T >= I.FLIP_T && !I.flipped) flipLogo();
    if (T > I.FLIP_T - 0.1) I.el.classList.add("open");
    q.dip.style.opacity = 0.5 * sm(END - 0.45, END - 0.05, T);
    if (I.A) {
      tv.copy(cam.position).sub(hero.pos); I.A.panX = -tv.dot(V3(1, 0, 0).applyQuaternion(cam.quaternion)) / Math.max(30, tv.length()) * 1.4;
      I.airToAir = shot.act === "f" && T > 9.4 && T < 11.8; I.groupGain = 1; I.engMute = T < T_OPEN; I.crowdOn = false;
      audioTick(I.A, T, cam.position, hero.pos, tv2.set(0, 0, -1).applyQuaternion(hero.q), hero.abLevel || 0, I.rate, dt);
    }
    if (T >= END) I.finish(false);
  };

  // hand the logo over to the lobby's own title: glide the big logo onto it, then fade
  function flipLogo() {
    I.flipped = true;
    const lw = I.q["logo-wrap"], big = I.q.big, tgt = document.querySelector("#scr-main .logo");
    lw.style.transition = "transform .7s cubic-bezier(.5,0,.2,1), opacity .7s ease .1s"; lw.style.filter = "";
    I.q.scrim.style.transition = "opacity .8s"; I.q.scrim.style.opacity = 0;
    if (!tgt) { lw.style.opacity = 0; return; }
    const sm0 = document.getElementById("scr-main"), wasHidden = sm0.hidden;
    sm0.hidden = false; const b = tgt.getBoundingClientRect(); sm0.hidden = wasHidden;
    const a = big.getBoundingClientRect();
    if (!(b.width > 0)) { lw.style.opacity = 0; return; }
    const s = Math.min(b.width / a.width, b.height / a.height) * 1.1;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    lw.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${s})`;
    lw.style.transformOrigin = "50% 50%";
    lw.style.opacity = 0;
  }


  I.skip = function () { if (I.active) I.finish(true); };
  I.finish = function (skipped) {
    if (!I.active || I.ended) return;
    I.ended = true; I.active = false; I.running = false;
    removeEventListener("keydown", I.key, true);
    audioStop(I.A, skipped ? 0.35 : 2.2); I.A = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ }
    clearTimeout(I.radioT);
    RJ.post.cinematic = false; RJ.post.fx.motion = 0; RJ.world.noMist = false;
    // strike the set: the guest jets, the carrier, the missile; the six Angels go back to the lobby showcase
    for (const j of I.extras || []) { try { j.dispose(); } catch (e) { /* gone */ } }
    for (const j of I.api.jets) j.mesh.visible = true;
    if (I.cv && I.cv.grp) { RJ.scene.remove(I.cv.grp); I.cv.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    if (I.msl && I.msl.mesh) RJ.scene.remove(I.msl.mesh);
    if (I.msl && I.msl.rib) I.msl.rib.release();
    for (const r of smokeKey.values()) r.release(); smokeKey.clear();
    for (const st of I.strikes || []) if (st && st.rib) st.rib.release();
    const el = I.el;
    if (el) {
      if (I.gate) { I.gate.remove(); I.gate = null; }
      el.classList.add("open");
      const dip = I.q.dip; dip.style.transition = "opacity .55s ease"; dip.style.opacity = skipped ? 0.7 : 0.5;
      I.q.curtain.style.transition = "opacity .4s"; I.q.curtain.style.opacity = 0;
      I.q.skip.style.display = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { dip.style.opacity = 0; for (const c of ["logo-wrap", "radio", "flash", "streak", "cap", "scrim"]) I.q[c].style.opacity = 0; if (I.lock) I.lock.style.opacity = 0; }));
      setTimeout(() => el.remove(), 900);
    }
    I.el = null;
    const api = I.api; I.api = null;
    api.done(skipped);
  };
})(window.RJ);
