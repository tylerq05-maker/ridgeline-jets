/* Jet City — start-up cinematic (30 s).
 * A six-ship blue-and-gold Super Hornet demonstration team (a tribute to the US Navy Blue Angels) flies a scripted
 * show over a valley airfield at golden hour:
 *   low pass in Delta -> climbing turn into the Diamond -> Diamond roll -> the two solos' opposing knife-edge pass
 *   (in slow motion) -> Echelon parade -> Delta hero pass -> pull to the vertical and the Delta break (starburst)
 *   -> JET CITY logo, which hands over to the lobby.
 * Everything is built from what the game already has (the menu showcase jets, the airbase builder, fx smoke and
 * vapour, the post stack). The score and the jet audio are synthesised live with WebAudio, so no assets are needed.
 * Two clocks: real time T (music, captions, the 30 s length) and show time s (flight and cameras), which runs slower
 * through the knife-edge crossing. main.js owns the lobby: RJ.intro.start(api) once at boot, api.done() runs once. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, DUR = 30, LOGO_T = 28, FLIP_T = 29.3;
  const I = { active: false };
  RJ.intro = I;

  // formations in the lead's frame: x right, y up, z behind (m); placed about their own centre line so rolls look right
  const DIAMOND = [[0, 0, 0], [8.5, -0.6, 10.5], [-8.5, -0.6, 10.5], [0, -1.4, 21], [0, -3.4, 33], [0, -6.2, 45]];
  const ECHELON = [0, 1, 2, 3, 4, 5].map((k) => [k * 9, -k * 0.7, k * 9]);
  const sm = (a, b, x) => RJ.smooth(a, b, x);
  const D2R = Math.PI / 180;
  // show timeline (s, seconds of show time)
  const SOLO = [13.8, 18.9], SX = 17.6, SB = 26.2; // solos away / knife-edge crossing / Delta break
  const slowRate = (s) => 1 - 0.6 * (sm(17.25, 17.45, s) - sm(17.8, 18, s));

  /* ---------------- the flight path (pre-integrated so it can be checked against the terrain) ---------------- */
  const SPS = 60, NS = Math.ceil(30 * SPS);
  function pitchAt(t, c) { // degrees; c = climb angle of the first pull-up (steeper where the valley closes in)
    return -4.5 + 4.5 * sm(3.6, 4.4, t) + c * sm(5.2, 6.6 + (c - 24) * 0.05, t) - c * sm(8.2, 10, t)
      + 10 * sm(13.4, 14.4, t) - 10 * sm(16.4, 17.4, t) - 6 * sm(22.2, 23, t) + 81 * sm(24.4, 26, t);
  }
  const bankAt = (t, sg) => sg * 62 * (sm(5.9, 7, t) - sm(8.3, 9.3, t)) - sg * 50 * (sm(18.6, 19.6, t) - sm(21.4, 22.4, t));
  const rollAt = (t) => 360 * sm(10.8, 13.2, t); // the Diamond roll: about the line of flight, no turn
  const speedAt = (t) => 172 - 22 * sm(5.2, 8.3, t) + 45 * sm(8.3, 10.8, t) - 5 * sm(13, 15, t) + 15 * sm(22, 23.5, t) - 45 * sm(24.4, 26.2, t);
  function buildPath(O, yaw0, climb, turn) {
    const P = [], Q = [], S = [], G = [];
    const pos = V3(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), qp = new THREE.Quaternion(), qr = new THREE.Quaternion(), qx = new THREE.Quaternion();
    const Y = V3(0, 1, 0), X = V3(1, 0, 0), Z = V3(0, 0, 1), fwd = V3();
    let psi = yaw0;
    const dt = 1 / SPS;
    for (let i = 0; i < NS; i++) {
      const t = i * dt, th = pitchAt(t, climb) * D2R, ph = bankAt(t, turn) * D2R, v = speedAt(t);
      q.copy(qy.setFromAxisAngle(Y, psi)).multiply(qp.setFromAxisAngle(X, th)).multiply(qr.setFromAxisAngle(Z, ph)).multiply(qx.setFromAxisAngle(Z, rollAt(t) * D2R));
      P.push(pos.clone()); Q.push(q.clone()); S.push(v);
      fwd.set(0, 0, -1).applyQuaternion(q);
      pos.addScaledVector(fwd, v * dt);
      psi += 1.5 * RJ.G0 * Math.tan(ph) / v * dt * Math.cos(th); // coordinated turn (a little tighter than level flight: it's a pull)
    }
    // place it: the formation crosses the runway centre 40 m up at t = 4.7 s
    const k = Math.round(4.7 * SPS), off = V3(O.x, O.y + 40, O.z).sub(P[k]);
    for (const p of P) p.add(off);
    // keep the whole formation well clear of the terrain: lift the climb-out and everything after it if needed
    const ground = (x, z) => RJ.world.ground(x, z);
    let lift = 0;
    for (let it = 0; it < 6; it++) {
      let need = 0, at = 0;
      for (let i = Math.round(5.2 * SPS); i < Math.round(SB * SPS); i += 6) {
        const p = P[i], h = Math.max(ground(p.x, p.z), ground(p.x + 50, p.z), ground(p.x - 50, p.z), ground(p.x, p.z + 50), ground(p.x, p.z - 50));
        const d = h + 25 + 85 * sm(5.6, 7.5, i / SPS) - p.y;
        if (d > need) { need = d; at = i / SPS; }
      }
      if (need < 1) break;
      lift += need + 10;
      for (let i = 0; i < NS; i++) P[i].y += (need + 10) * sm(5.2, Math.max(7.7, at), i / SPS);
    }
    loads(P, G);
    return { P, Q, S, G, lift, turn };
  }
  // load factor from a path's own acceleration (drives the wing vapour)
  function loads(P, G) {
    const n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[Math.min(n - 1, i + 1)], b = P[i], c = P[Math.max(0, i - 1)];
      const acc = V3().copy(a).sub(b).sub(V3().copy(b).sub(c)).multiplyScalar(SPS * SPS);
      acc.y += RJ.G0;
      G[i] = i === 0 || i === n - 1 ? 1 : Math.min(9, acc.length() / RJ.G0);
    }
  }
  function sample(path, t, outP, outQ) {
    const n = path.P.length, f = RJ.clamp(t, 0, (n - 1.001) / SPS) * SPS, i = Math.floor(f), u = f - i;
    outP.lerpVectors(path.P[i], path.P[i + 1], u);
    outQ.copy(path.Q[i]).slerp(path.Q[i + 1], u);
    return { v: path.S[i] + (path.S[i + 1] - path.S[i]) * u, g: path.G[i] };
  }

  /* ---------------- overlay (letterbox, credit, logo, skip, sound gate) ---------------- */
  function css() {
    if (document.getElementById("intro-css")) return;
    const s = document.createElement("style"); s.id = "intro-css";
    s.textContent = `
#intro { position: fixed; inset: 0; z-index: 60; pointer-events: none; overflow: hidden; font-family: var(--font-body); }
#intro .lb { position: absolute; left: 0; right: 0; height: max(0px, calc((100vh - 100vw / 2.39) / 2)); background: #000; transition: transform .9s cubic-bezier(.6,0,.2,1); }
#intro .lb.t { top: 0; } #intro .lb.b { bottom: 0; }
#intro.open .lb.t { transform: translateY(-100%); } #intro.open .lb.b { transform: translateY(100%); }
#intro .credit { position: absolute; left: 6vw; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 5vh); color: #f3ead2; opacity: 0; transition: opacity 1.1s; text-shadow: 0 2px 12px rgba(0,0,0,.6); }
#intro .credit b { display: block; font-family: var(--font-mono); font-weight: 400; font-size: 12px; letter-spacing: .32em; color: #f2b705; margin-bottom: 6px; }
#intro .credit span { font-size: clamp(14px, 1.6vw, 20px); letter-spacing: .18em; text-transform: uppercase; }
#intro .credit.on { opacity: .95; }
#intro .cap { position: absolute; left: 6vw; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 5vh); color: #f3ead2; opacity: 0; transform: translateX(-14px); transition: opacity .5s, transform .5s; text-shadow: 0 2px 12px rgba(0,0,0,.7); border-left: 2px solid #f2b705; padding-left: 12px; }
#intro .cap.on { opacity: .95; transform: none; }
#intro .cap-n { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #f2b705; margin-bottom: 4px; }
#intro .cap-t { font-family: var(--font-display); font-size: clamp(20px, 2.6vw, 34px); letter-spacing: .06em; text-transform: uppercase; }
#intro .flash { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(255,246,220,.95), rgba(255,220,150,.35) 45%, rgba(0,0,0,0) 75%); opacity: 0; }
#intro .dip { position: absolute; inset: 0; background: #05080c; opacity: 0; }
#intro .logo-wrap { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; opacity: 0; transform-origin: 0 0; }
#intro .logo-wrap .eb { font-family: var(--font-mono); font-size: clamp(11px, 1.2vw, 15px); letter-spacing: .5em; color: #f2b705; text-transform: uppercase; margin-bottom: 1.2vh; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
#intro .big { font-family: var(--font-display); font-size: clamp(64px, 13vw, 190px); line-height: .86; letter-spacing: .02em; white-space: nowrap;
  background: linear-gradient(100deg, #b98a1c 0%, #fff4c9 22%, #f2b705 38%, #fffaf0 50%, #e2a512 62%, #fff1bf 78%, #a87a12 100%); background-size: 260% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 26px rgba(0,0,0,.65)); }
#intro .big.sweep { animation: introSweep 1.6s ease-out forwards; }
@keyframes introSweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }
#intro .streak { position: absolute; left: 50%; top: 50%; width: 80vw; height: 2px; transform: translate(-50%, -50%) scaleX(0); background: linear-gradient(90deg, transparent, #fff3c4, #fff, #fff3c4, transparent); opacity: 0; }
#intro .tag { margin-top: 1.6vh; font-size: clamp(12px, 1.3vw, 17px); letter-spacing: .42em; text-transform: uppercase; color: #e9eef4; opacity: .9; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
#intro .skip { pointer-events: auto; position: absolute; top: max(14px, calc((100vh - 100vw / 2.39) / 2 - 52px)); right: 18px; display: flex; align-items: center; gap: 10px;
  padding: 9px 14px 9px 16px; border: 1px solid rgba(242,183,5,.75); border-radius: 3px; background: rgba(6,10,16,.55); color: #f5efe0; cursor: pointer;
  font-family: var(--font-mono); font-size: 13px; letter-spacing: .22em; text-transform: uppercase; backdrop-filter: blur(4px); transition: background .2s, border-color .2s; }
#intro .skip:hover, #intro .skip:focus-visible { background: rgba(242,183,5,.9); color: #161006; border-color: #f2b705; outline: none; }
#intro .skip kbd { font-family: inherit; font-size: 10px; letter-spacing: .1em; padding: 1px 5px; border: 1px solid currentColor; border-radius: 2px; opacity: .75; }
#intro .gate { pointer-events: auto; position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; background: radial-gradient(ellipse at 50% 60%, rgba(5,8,12,.15), rgba(5,8,12,.75)); }
#intro .gate div { text-align: center; color: #f3ead2; }
#intro .gate p { margin: 0; font-family: var(--font-mono); letter-spacing: .4em; text-transform: uppercase; }
#intro .gate .g1 { font-size: 12px; color: #f2b705; margin-bottom: 18px; }
#intro .gate .g2 { font-size: clamp(14px, 1.8vw, 20px); animation: introPulse 1.6s ease-in-out infinite; }
#intro .gate .g3 { margin-top: 14px; font-size: 11px; letter-spacing: .25em; opacity: .65; }
@keyframes introPulse { 50% { opacity: .45; } }`;
    document.head.appendChild(s);
  }
  function buildOverlay() {
    css();
    const el = document.createElement("div"); el.id = "intro";
    el.innerHTML = `<div class="lb t"></div><div class="lb b"></div>
<div class="credit"><b>Jet City Air Range presents</b><span>A tribute to the U.S. Navy Blue Angels</span></div>
<div class="cap"><span class="cap-n"></span><span class="cap-t"></span></div>
<div class="flash"></div><div class="streak"></div>
<div class="logo-wrap"><div class="eb">Jet City Air Range</div><div class="big">JET CITY</div><div class="tag">Take the sky</div></div>
<div class="dip"></div>
<button class="skip" type="button" aria-label="Skip intro">Skip intro <kbd>Esc</kbd></button>`;
    document.body.appendChild(el);
    return el;
  }

  /* ---------------- audio: live score + jet noise ---------------- */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function makeAudio() {
    const AU = RJ.audio, ctx = AU.ctx;
    if (!ctx || !AU.master) return null;
    const A = { ctx, nodes: [], srcs: [], ev: [], evI: 0, base: null };
    const keep = (n) => { A.nodes.push(n); return n; };
    A.bus = keep(ctx.createGain()); A.bus.gain.value = 1; A.bus.connect(AU.master);
    const mv = RJ.settings.musicVol == null ? 0.5 : RJ.settings.musicVol, sv = RJ.settings.sfxVol == null ? 1 : RJ.settings.sfxVol;
    A.mus = keep(ctx.createGain()); A.mus.gain.value = 0.62 * Math.min(1.6, mv / 0.5);
    A.mus.connect(A.bus);
    // hall reverb from a synthetic impulse response
    const len = Math.round(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const rev = keep(ctx.createConvolver()); rev.buffer = ir;
    const wet = keep(ctx.createGain()); wet.gain.value = 0.42;
    A.dry = keep(ctx.createGain()); A.dry.gain.value = 0.85;
    A.mIn = keep(ctx.createGain());
    A.mIn.connect(A.dry).connect(A.mus); A.mIn.connect(rev).connect(wet).connect(A.mus);
    // noise
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    let br = 0; for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; nd[i] = w * 0.6 + br * 3; }
    A.noise = nb;
    // engines: one voice for the tight formation, pitched and filtered by distance and Doppler
    A.eng = keep(ctx.createGain()); A.eng.gain.value = 0;
    A.pan = keep(ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain());
    A.engOut = keep(ctx.createGain()); A.engOut.gain.value = 0.9 * Math.min(1.5, sv);
    A.eng.connect(A.pan).connect(A.engOut).connect(A.bus);
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    A.lp = keep(ctx.createBiquadFilter()); A.lp.type = "lowpass"; A.lp.frequency.value = 600; A.lp.Q.value = 0.6;
    const roarG = keep(ctx.createGain()); roarG.gain.value = 0.9;
    ns.connect(A.lp).connect(roarG).connect(A.eng); A.ns = ns;
    const rs = ctx.createBufferSource(); rs.buffer = nb; rs.loop = true; rs.playbackRate.value = 0.35;
    const rl = keep(ctx.createBiquadFilter()); rl.type = "lowpass"; rl.frequency.value = 140;
    const rg = keep(ctx.createGain()); rg.gain.value = 1.6;
    rs.connect(rl).connect(rg).connect(A.eng);
    A.whine = [2850, 4150].map((f) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; return o; });
    const wb = keep(ctx.createBiquadFilter()); wb.type = "bandpass"; wb.frequency.value = 3400; wb.Q.value = 2.5;
    A.wg = keep(ctx.createGain()); A.wg.gain.value = 0.05;
    for (const o of A.whine) o.connect(wb); wb.connect(A.wg).connect(A.eng);
    const t0 = ctx.currentTime + 0.02;
    for (const s of [ns, rs, ...A.whine]) { s.start(t0); A.srcs.push(s); }
    score(A);
    return A;
  }
  // instruments: every voice is a handful of oscillators/noise into the reverb send
  function voice(A, type, f, t, dur, vol, att, rel, cut, det) {
    const ctx = A.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = cut; lp.Q.value = 0.7;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur)); g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(att, dur) + rel);
    lp.connect(g).connect(A.mIn);
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
  function noiseHit(A, t, vol, type, f, dur, q) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl).connect(g).connect(A.mIn); s.start(t, Math.random()); s.stop(t + dur + 0.05); A.srcs.push(s);
  }
  function timp(A, m, t, vol) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(mtof(m) * 1.06, t); o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    o.connect(g).connect(A.mIn); o.start(t); o.stop(t + 1.7); A.srcs.push(o);
    noiseHit(A, t, vol * 0.5, "lowpass", 380, 0.35);
  }
  function boom(A, t, vol) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6);
    o.connect(g).connect(A.mus); o.start(t); o.stop(t + 2.7); A.srcs.push(o);
  }
  function swell(A, t, dur, vol) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; s.loop = true; fl.type = "highpass"; fl.frequency.value = 4500;
    g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    s.connect(fl).connect(g).connect(A.mIn); s.start(t); s.stop(t + dur + 0.1); A.srcs.push(s);
  }
  // the cue (~96 bpm, D minor): pulse under the passes, the theme over the turn and the roll, a held breath for the
  // slow-motion crossing, a broad parade, a build through the hero pass, a hit on the break and another on the logo
  function score(A) {
    const E = (t, fn) => A.ev.push({ t, fn }), R = (s) => I.Tof(s);
    E(0, (w) => { strings(A, [38, 45, 50], w, 5.6, 0.035); swell(A, w + 1.2, 1.8, 0.05); });
    [0, 1.25, 2.5].forEach((x, i) => E(x, (w) => timp(A, 38, w, 0.18 + i * 0.08)));
    // low-string ostinato
    const roots = [[3, 38], [R(6.2), 34], [R(7.3), 41], [R(8.4), 36], [R(9.5), 43], [R(10.6), 38], [R(11.8), 34], [R(13), 33],
      [R(18.9), 34], [R(19.8), 41], [R(20.7), 43], [R(21.6), 36], [R(22.3), 34], [R(23.5), 36], [R(24.6), 38]];
    const rootAt = (x) => { let r = 38; for (const [a, b] of roots) if (x >= a - 1e-3) r = b; return r; };
    const ost = (from, to, step, vol0, vol1) => {
      for (let x = from, n = 0; x < to - 0.02; x += step, n++) {
        const acc = n % 4 === 0, r = rootAt(x), v = (acc ? 1.5 : 1) * lerp(vol0, vol1, (x - from) / (to - from));
        E(x, (w) => voice(A, "sawtooth", mtof(r), w, step * 0.4, v, 0.01, 0.14, 900, [-6, 6]));
      }
    };
    ost(3, R(13.8), 0.3125, 0.045, 0.06);
    ost(R(13.8), R(17.35), 0.15625, 0.03, 0.07); // the solos run in: the pulse doubles
    ost(R(18.9), R(26.15), 0.3125, 0.05, 0.075);
    // the low pass
    E(3, (w) => { brass(A, [50, 53, 57], w, 1.4, 0.03); strings(A, [50, 53, 57, 62], w, 2.8, 0.02); timp(A, 38, w, 0.35); });
    E(R(4.7), (w) => { brass(A, [50, 57, 62, 65], w, 1.0, 0.045); timp(A, 38, w, 0.5); noiseHit(A, w, 0.22, "highpass", 3000, 2.2); });
    // climbing turn and the Diamond roll: chords and the theme
    const ch = [[6.2, [46, 50, 53], [58, 62, 65]], [7.3, [41, 48, 53, 57], [60, 65, 69]], [8.4, [48, 52, 55, 60], [60, 64, 67]], [9.5, [43, 50, 55, 58], [62, 67, 70]],
      [10.6, [50, 53, 57, 62], [62, 65, 69]], [11.8, [46, 53, 58, 62], [65, 70, 74]], [13, [45, 52, 57, 61], [64, 69, 73]]];
    for (const [s, b, st] of ch) E(R(s), (w) => { brass(A, b, w, 0.9, 0.042); strings(A, st, w, 1.0, 0.024); timp(A, b[0] - 12 > 24 ? b[0] - 12 : b[0], w, 0.35); });
    [[6.2, 69, 0.55], [6.8, 74, 0.45], [7.3, 76, 0.3], [7.6, 77, 0.75], [8.4, 79, 0.55], [8.95, 76, 0.3], [9.5, 74, 0.8],
      [10.6, 74, 0.5], [11.1, 77, 0.3], [11.4, 79, 0.4], [11.8, 81, 0.9], [12.8, 79, 0.25], [13, 76, 0.7]].forEach(([s, m, d]) => E(R(s), (w) => brass(A, [m], w, d, 0.034)));
    // knife-edge: rising swell and snare into the crossing, then the slow-motion hush and a hit as they clear
    E(R(14.2), (w) => swell(A, w, R(17.35) - R(14.2), 0.14));
    for (let x = R(16.3); x < R(17.3); x += 0.0625) E(x, (w) => noiseHit(A, w, 0.04 + 0.16 * sm(R(16.3), R(17.3), x), "bandpass", 1900, 0.06, 1.2));
    E(R(17.4), (w) => { strings(A, [62, 69, 74, 76], w, R(18.1) - R(17.4), 0.022); boom(A, w, 0.5); });
    E(R(18.1), (w) => { brass(A, [38, 45, 50, 57, 62], w, 0.7, 0.05); timp(A, 38, w, 0.7); noiseHit(A, w, 0.35, "highpass", 2500, 2.4); });
    // Echelon parade: broad and proud
    for (const [s, b] of [[18.9, [46, 50, 53, 58]], [19.8, [41, 45, 48, 53]], [20.7, [43, 50, 55, 58]], [21.6, [48, 52, 55, 60]]])
      E(R(s), (w) => { brass(A, b, w, 0.85, 0.04); strings(A, b.map((m) => m + 12), w, 0.9, 0.026); });
    [[18.9, 74, 0.8], [19.8, 72, 0.5], [20.3, 77, 0.4], [20.7, 79, 0.8], [21.6, 76, 0.7]].forEach(([s, m, d]) => E(R(s), (w) => brass(A, [m], w, d, 0.034)));
    // hero pass and the pull to the vertical: the build
    E(R(22.3), (w) => { brass(A, [46, 53, 58, 62], w, 1.1, 0.05); strings(A, [58, 62, 65, 70], w, 1.2, 0.03); timp(A, 34, w, 0.55); noiseHit(A, w, 0.2, "highpass", 3000, 1.8); });
    E(R(23.5), (w) => { brass(A, [48, 55, 60, 64], w, 1.1, 0.054); strings(A, [60, 64, 67, 72], w, 1.2, 0.032); timp(A, 36, w, 0.55); });
    [[22.3, 74, 0.9], [23.25, 77, 0.25], [23.5, 79, 0.9], [24.6, 81, 1.4]].forEach(([s, m, d]) => E(R(s), (w) => brass(A, [m], w, d, 0.036)));
    E(R(24.6), (w) => { strings(A, [57, 61, 64, 69], w, R(26.1) - R(24.6), 0.03); swell(A, w, R(26.15) - R(24.6), 0.18); });
    for (let x = R(25.2); x < R(26.15); x += 0.06) E(x, (w) => noiseHit(A, w, 0.05 + 0.2 * sm(R(25.2), R(26.2), x), "bandpass", 1900, 0.06, 1.2));
    // the break
    E(R(SB), (w) => { brass(A, [38, 45, 50, 54, 57, 62, 66, 69], w, 1.0, 0.05); strings(A, [50, 54, 57, 62, 66, 69, 74], w, 1.0, 0.028); timp(A, 38, w, 0.8); boom(A, w, 0.6); noiseHit(A, w, 0.35, "highpass", 2500, 2.5); });
    // the logo: the biggest hit, ringing out under the lobby
    E(LOGO_T, (w) => {
      brass(A, [38, 45, 50, 54, 57, 62, 66, 69, 74], w, 1.2, 0.052); strings(A, [50, 54, 57, 62, 66, 69, 74, 78], w, 1.8, 0.03);
      timp(A, 38, w, 0.95); timp(A, 26, w + 0.02, 0.65); boom(A, w, 0.95); noiseHit(A, w, 0.45, "highpass", 2500, 3.2);
    });
    E(LOGO_T + 1.3, (w) => strings(A, [50, 57, 62, 66], w, 1.2, 0.018));
  }
  function audioTick(A, T, camPos, src, srcFwd, rate, dt) {
    if (!A || A.ctx.state !== "running") { if (A) A.base = null; return; }
    const now = A.ctx.currentTime;
    if (A.base == null) { A.base = now - T; while (A.evI < A.ev.length && A.ev[A.evI].t < T - 0.04) A.evI++; }
    while (A.evI < A.ev.length && A.ev[A.evI].t <= T + 0.3) { const e = A.ev[A.evI++]; try { e.fn(Math.max(now + 0.005, A.base + e.t)); } catch (err) { /* voice limit */ } }
    // engines: the nearest jet, by distance, aft-quadrant roar and Doppler; slow motion drags the pitch down
    const rel = V3().copy(camPos).sub(src), r = Math.max(8, rel.length());
    const close = A.prevR != null && A.src === I.near ? (A.prevR - r) / Math.max(dt, 1e-3) : 0;
    A.prevR = r; A.src = I.near;
    const dop = RJ.clamp(343 / Math.max(120, 343 - RJ.clamp(close, -300, 300)), 0.62, 1.75) * (0.55 + 0.45 * rate);
    A.dop = RJ.damp(A.dop || dop, dop, 10, dt);
    const aft = Math.max(0, -rel.normalize().dot(srcFwd));
    const near = RJ.clamp(70 / r, 0, 1.25);
    let lvl = near * (0.75 + 0.75 * aft) * (I.groupGain || 1);
    if (I.airToAir) lvl *= 0.55; // camera-ship shots: let the score lead
    lvl *= 1 - sm(LOGO_T, DUR + 0.5, T);
    A.eng.gain.setTargetAtTime(lvl, now, 0.05);
    A.lp.frequency.setTargetAtTime(Math.min(16000, (380 + 9000 * Math.min(1, near * near)) * A.dop), now, 0.05);
    A.ns.playbackRate.setTargetAtTime(0.75 + 0.3 * A.dop, now, 0.05);
    A.whine[0].frequency.setTargetAtTime(2850 * A.dop, now, 0.04); A.whine[1].frequency.setTargetAtTime(4150 * A.dop, now, 0.04);
    A.wg.gain.setTargetAtTime(0.06 * (1 - aft) * Math.min(1, near * 1.5), now, 0.05);
    if (A.pan.pan) A.pan.pan.setTargetAtTime(RJ.clamp(A.panX || 0, -0.9, 0.9), now, 0.05);
    // a jet going over: a ripping roar
    if (A.lastClose > 40 && close < 0 && r < 220 && !(A.ripT > T - 2)) { A.ripT = T; noiseHit(A, now, 0.9, "lowpass", 2400 * (0.5 + 0.5 * rate), 2.2 / Math.max(0.4, rate)); }
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
  /** api: { jets, delta, center:V3 (runway centre on the ground), yaw (runway heading), render(dt, focus, motion, exposure), done() } */
  I.start = function (api) {
    if (I.active || I.played) return false;
    I.active = true; I.played = true; I.api = api; I.T = 0; I.s = 0; I.ended = false;
    const O = api.center.clone();
    // fly the direction that puts the sun on the right side of the formation (the hero camera's side)
    const s = RJ.world.sunDir, f0 = V3(-Math.sin(api.yaw), 0, -Math.cos(api.yaw)), r0 = V3(-f0.z, 0, f0.x);
    const sunYaw = api.yaw + (r0.x * s.x + r0.z * s.z < 0 ? Math.PI : 0);
    // pick the direction, turn side and pull-up angle that clear the valley walls without bending the path
    let best = null;
    for (const yaw of [sunYaw, sunYaw + Math.PI]) for (const turn of [1, -1]) for (const c of [24, 32, 40, 52]) {
      if (best && best.path.lift < 5) break;
      const path = buildPath(O, yaw, c, turn);
      if (!best || path.lift < best.path.lift - 5) best = { yaw, path };
    }
    I.yaw = best.yaw; I.path = best.path;
    I.F = V3(-Math.sin(I.yaw), 0, -Math.cos(I.yaw)); I.R = V3(-I.F.z, 0, I.F.x);
    I.O = O;
    // show time <-> real time (slow motion through the crossing)
    I.tab = [0]; for (let T = 0, x = 0; T < DUR + 1; T += 1 / 240) { x += slowRate(x) / 240; I.tab.push(x); }
    I.breaks = buildBreaks();
    I.prev = api.jets.map(() => null); I.mode = api.jets.map(() => "");
    I.el = buildOverlay();
    I.q = {}; for (const c of ["credit", "flash", "streak", "logo-wrap", "big", "dip", "skip", "cap", "cap-n", "cap-t"]) I.q[c] = I.el.querySelector("." + c);
    I.q.skip.addEventListener("click", (e) => { e.stopPropagation(); I.skip(); });
    I.key = (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); I.skip(); return; }
      if (I.gate) { I.begin(); }
    };
    addEventListener("keydown", I.key, true);
    RJ.ui.hideAll();
    RJ.post.cinematic = true; RJ.world.noMist = true;
    RJ.state.mode = "intro";
    // browsers keep sound locked until the first click or key: if it is locked, hold on the opening frame
    // behind a "click to begin" card (the Skip button still works) so the cue starts on the downbeat
    const ctx = RJ.audio.ctx;
    if (!(ctx && ctx.state === "running") && !RJ.settings.muted && !I.noGate) {
      I.gate = document.createElement("div"); I.gate.className = "gate";
      I.gate.innerHTML = `<div><p class="g1">Jet City Air Range</p><p class="g2">Click or press any key to begin</p><p class="g3">Sound on · Esc skips the intro</p></div>`;
      I.gate.addEventListener("pointerdown", () => I.begin());
      I.el.appendChild(I.gate);
    } else I.begin();
    I.frame(0);
    return true;
  };
  /** real time at which show time s happens */
  I.Tof = function (s) {
    const t = I.tab; let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] < s) lo = m; else hi = m; }
    return (lo + (s - t[lo]) / Math.max(1e-6, t[hi] - t[lo])) / 240;
  };
  I.begin = function () {
    if (!I.active || I.running) return;
    if (I.gate) { I.gate.remove(); I.gate = null; }
    RJ.audio.init(); if (RJ.audio.unlock) RJ.audio.unlock();
    if (RJ.audio.ctx && RJ.audio.ctx.state !== "running") RJ.audio.ctx.resume().catch(() => {});
    try { I.A = makeAudio(); } catch (e) { console.warn("Intro audio unavailable", e); I.A = null; }
    I.running = true; I.wall = performance.now(); I.T = 0; I.s = 0;
    I.q.credit.classList.add("on");
  };

  const tP = V3(), tQ = new THREE.Quaternion(), fw = V3(), rt = V3(), up = V3(), hf = V3(), hr = V3(), mid = V3(), cpos = V3(), look = V3(), v1 = V3(), v2 = V3(), cen = V3();
  const lerp = (a, b, x) => a + (b - a) * x;
  const ease = (x) => x * x * (3 - 2 * x);
  function formationAt(t) {
    const st = sample(I.path, t, tP, tQ);
    fw.set(0, 0, -1).applyQuaternion(tQ); rt.set(1, 0, 0).applyQuaternion(tQ); up.set(0, 1, 0).applyQuaternion(tQ);
    hf.set(fw.x, 0, fw.z);
    if (hf.lengthSq() < 1e-4) hf.copy(I.F); else hf.normalize();
    hr.set(-hf.z, 0, hf.x);
    mid.copy(tP).addScaledVector(fw, -16);
    return st;
  }
  // slot k at show time t: Delta -> Diamond in the climbing turn -> Echelon (off camera) -> Delta for the hero pass
  const sa = V3(), sb = V3();
  function slot(k, t, out) {
    const x1 = sm(k >= 4 ? 6.3 : 7, k >= 4 ? 8 : 8.4, t), x2 = sm(14.2, 17.5, t), x3 = sm(22, 23.2, t), D = I.api.delta[k];
    sa.fromArray(D).lerp(sb.fromArray(DIAMOND[k]), x1).lerp(sb.fromArray(ECHELON[k]), x2).lerp(sb.fromArray(D), x3);
    return out.copy(sa);
  }
  function centre(t) {
    cen.set(0, 0, 0); const o = V3();
    for (let k = 0; k < 6; k++) cen.add(slot(k, t, o));
    cen.multiplyScalar(1 / 6); cen.z = 0;
    return cen;
  }
  // a jet in formation: about the formation's centre line (so the Diamond rolls as one body)
  function placeFormation(k, t, outP, outQ) {
    const st = sample(I.path, t, outP, outQ), c = centre(t), o = slot(k, t, V3()).sub(c);
    const w = t * 1.3 + k * 1.7;
    o.x += Math.sin(w) * 0.2; o.y += Math.sin(w * 1.3) * 0.15; o.z += Math.sin(w * 0.7) * 0.25;
    outP.add(o.applyQuaternion(outQ));
    return st;
  }
  // the solos (jets 5 and 6) run in from opposite ends of the runway, knife-edge, canopies to the crowd
  const YAX = V3(0, 1, 0), ZAX = V3(0, 0, 1), XAX = V3(1, 0, 0), q1 = new THREE.Quaternion(), qc = new THREE.Quaternion();
  function placeSolo(k, t, outP, outQ) {
    const dir = k === 4 ? 1 : -1, v = 190, d = v * (t - SX) * dir;
    outP.copy(I.O).addScaledVector(I.F, d).addScaledVector(I.R, -6 * dir); outP.y += 32;
    const knife = sm(16.5, 17.1, t) - sm(18.1, 18.7, t);
    outQ.setFromAxisAngle(YAX, I.yaw + (dir > 0 ? 0 : Math.PI)).multiply(q1.setFromAxisAngle(ZAX, 90 * D2R * knife * dir));
    return { v, g: 1 };
  }
  // the Delta break: from the vertical, each jet rolls to its own heading and pulls, a six-way starburst of smoke
  function buildBreaks() {
    const PHI = [0, -60, 60, 180, -120, 120], n = Math.round(4.6 * SPS);
    return PHI.map((phi, k) => {
      const p = V3(), q0 = new THREE.Quaternion(), q = new THREE.Quaternion(), f = V3();
      const v0 = placeFormation(k, SB, p, q0).v;
      const P = [], Q = [], S = [], G = [];
      let th = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SPS, rate = 0.45 * sm(0.25, 0.6, t), v = v0 - 8 * t;
        th += rate / SPS;
        q.copy(q0).multiply(q1.setFromAxisAngle(ZAX, phi * D2R * sm(0, 0.45, t))).multiply(new THREE.Quaternion().setFromAxisAngle(XAX, th));
        P.push(p.clone()); Q.push(q.clone()); S.push(v); G.push(1);
        p.addScaledVector(f.set(0, 0, -1).applyQuaternion(q), v / SPS);
      }
      loads(P, G);
      return { P, Q, S, G };
    });
  }
  function placeJet(k, t, outP, outQ) {
    if (t >= SB) return Object.assign(sample(I.breaks[k], t - SB, outP, outQ), { mode: "break" });
    if (k >= 4 && t >= SOLO[0] && t < SOLO[1]) return Object.assign(placeSolo(k, t, outP, outQ), { mode: "solo" });
    return Object.assign(placeFormation(k, t, outP, outQ), { mode: "form" });
  }

  // the cut list (show time) and the camera for each shot (writes cpos / look, returns fov)
  const CUTS = [3, 6.2, 8.4, 10.6, SOLO[0], 16.3, SOLO[1], 22.3, 24.4];
  const shotId = (t) => { let i = 0; while (i < CUTS.length && t >= CUTS[i]) i++; return i; };
  const EXPO = [1.3, 1.15, 1.25, 1.0, 1.2, 1.25, 1.2, 1.25, 1.3, 1.05];
  const A2A = [false, false, true, false, true, true, false, true, true, false];
  function shot(t) {
    const O = I.O, F = I.F, R = I.R, id = shotId(t);
    const L = (s, r, u, out) => out.set(O.x + F.x * s + R.x * r, O.y + u, O.z + F.z * s + R.z * r);
    let fov = 40;
    I.camUp = 0;
    if (id === 0) {
      // establishing: a slow crane across the field at golden hour, the team a smoke-trailed speck closing in
      const u = t / 3;
      L(430 - 90 * u, 250 - 50 * u, 140 - 80 * ease(u), cpos);
      look.copy(mid).lerp(L(-150, 0, 20, v1), 0.45 * (1 - ease(u)));
      fov = lerp(44, 16, ease(u));
    } else if (id === 1) {
      // crowd line: low by the runway edge, the formation roars straight over and pulls up
      L(25, -58, 1.7, cpos);
      look.copy(mid);
      fov = RJ.clamp(2 * Math.atan(48 / cpos.distanceTo(mid)) / RJ.DEG, 24, 78);
      const shake = Math.max(0, 1 - Math.abs(t - 4.75) / 0.6) * 0.25;
      look.x += Math.sin(t * 61) * shake; look.y += Math.sin(t * 47 + 1) * shake;
    } else if (id === 2 || id === 7) {
      // camera ship on the inside of the turn, sliding from behind to abeam (climbing turn / Echelon parade)
      const t0 = id === 2 ? 6.2 : SOLO[1], u = ease((t - t0) / (id === 2 ? 2.2 : 3.4)), side = id === 2 ? -I.path.turn : I.path.turn;
      const dist = id === 2 ? lerp(78, 100, u) : lerp(120, 140, u);
      cpos.copy(tP).addScaledVector(hr, side * dist).addScaledVector(hf, id === 2 ? lerp(-55, 5, u) : lerp(-70, 10, u)); cpos.y += id === 2 ? lerp(-4, -10, u) : lerp(-14, -6, u);
      look.copy(tP).addScaledVector(hf, id === 2 ? -16 : -26);
      fov = id === 2 ? lerp(40, 34, u) : lerp(44, 38, u);
      I.camUp = 0.25;
    } else if (id === 3) {
      // wide: all six against the sky from far below and to the side
      if (!I.wide) { I.wide = pickWide(); formationAt(t); }
      cpos.copy(I.wide); look.copy(mid);
      fov = RJ.clamp(2 * Math.atan(70 / cpos.distanceTo(mid)) / RJ.DEG, 14, 40);
    } else if (id === 4) {
      // the Diamond roll from a chase ship behind and to the right: the whole formation turns about its centre line
      const u = (t - 10.6) / 3.2;
      cpos.copy(tP).addScaledVector(hf, -lerp(100, 88, u)).addScaledVector(hr, lerp(26, 18, u)); cpos.y += -6;
      look.copy(tP).addScaledVector(hf, 30);
      fov = lerp(40, 36, u);
    } else if (id === 5) {
      // behind solo 5 at the runway threshold, solo 6 a dot coming head-on down the same runway
      placeSolo(4, t, v1, qc);
      cpos.copy(v1).addScaledVector(I.F, -42).addScaledVector(I.R, -9); cpos.y += 5;
      look.copy(v1).addScaledVector(I.F, 400); look.y -= 6;
      fov = 42;
    } else if (id === 6) {
      // the crossing, from the crowd line at show centre (time slows as they meet)
      L(0, -75, 3, cpos);
      look.copy(O); look.y += 34;
      fov = lerp(58, 48, sm(16.3, 17.6, t));
    } else if (id === 8) {
      heroPose(t, cpos, look);
      fov = 44;
    } else {
      // from far below as the Delta pulls to the vertical and breaks into a starburst
      if (!I.low) I.low = pickLow();
      cpos.copy(I.low);
      cen.set(0, 0, 0); for (const j of I.api.jets) cen.add(j.pos); cen.multiplyScalar(1 / 6);
      look.copy(cen); look.y += 40 * sm(SB, SB + 2, t);
      const spread = Math.max(60, ...I.api.jets.map((j) => j.pos.distanceTo(cen)));
      fov = RJ.clamp(2 * Math.atan(spread * 1.25 / cpos.distanceTo(cen)) / RJ.DEG, 26, 62);
    }
    return fov;
  }
  const hp = V3(), hq = new THREE.Quaternion(), hfw = V3(), hrt = V3();
  function heroPose(t, outP, outL) {
    sample(I.path, t, hp, hq);
    hfw.set(0, 0, -1).applyQuaternion(hq); hfw.y = 0; hfw.normalize();
    hrt.set(-hfw.z, 0, hfw.x);
    const u = (t - 22.3) / 2.1;
    outP.copy(hp).addScaledVector(hrt, lerp(36, 52, u)).addScaledVector(hfw, 6 - 9 * (t - 22.3)); outP.y += -7;
    if (outL) outL.copy(hp).addScaledVector(hfw, -14);
    return outP;
  }
  function losClear(a, b) {
    for (let i = 1; i < 24; i++) { const x = i / 24; v2.lerpVectors(a, b, x); if (RJ.world.ground(v2.x, v2.z) > v2.y - 6) return false; }
    return true;
  }
  function pickWide() {
    formationAt(9.5);
    const m = mid.clone(), F = hf.clone(), R = hr.clone();
    const cand = [[700, -230, 250], [-700, -230, 250], [650, -120, -200], [-650, -120, -200], [800, 60, 300], [-800, 60, 300]];
    for (const [r, u, f] of cand) {
      const p = m.clone().addScaledVector(R, r).addScaledVector(F, f); p.y += u;
      const g = RJ.world.ground(p.x, p.z) + 25; if (p.y < g) p.y = g;
      let ok = true;
      for (const tt of [8.4, 9.5, 10.6]) { formationAt(tt); if (!losClear(p, mid)) { ok = false; break; } }
      if (ok) return p;
    }
    const p = m.clone().addScaledVector(R, 600); p.y = Math.max(p.y + 200, RJ.world.ground(p.x, p.z) + 300); return p;
  }
  function pickLow() {
    formationAt(24.4); const F = hf.clone(), R = hr.clone();
    const b = I.path.P[Math.round(SB * SPS)].clone();
    const burst = I.breaks.map((p) => p.P[p.P.length - 1]).reduce((a, x) => a.add(x), V3()).multiplyScalar(1 / 6);
    const cand = [[-520, 160, -420], [-520, -160, -420], [-300, 260, -500], [-300, -260, -500], [-650, 0, -300], [-200, 380, -350]];
    for (const [f, r, u] of cand) {
      const p = b.clone().addScaledVector(F, f).addScaledVector(R, r); p.y += u;
      const g = RJ.world.ground(p.x, p.z) + 20; if (p.y < g) p.y = g;
      formationAt(24.6);
      if (losClear(p, mid) && losClear(p, b) && losClear(p, burst)) return p;
    }
    const p = b.clone().addScaledVector(F, -500); p.y = Math.max(b.y - 300, RJ.world.ground(p.x, p.z) + 40); return p;
  }
  const CAPS = [[3.3, 5.8, "Low pass", "Delta"], [6.5, 9.6, "Climbing turn", "Delta to Diamond"], [10.9, 13.5, "Diamond roll", "Six jets, one wing"],
    [14.2, 18.6, "Opposing knife-edge pass", "The solos, 740 knots of closure"], [19.2, 22.1, "Echelon parade", "Six in line"], [24.8, 26.9, "Delta break", "Pull to the vertical"]];

  I.frame = function (dt) {
    if (!I.active) return;
    let rate = slowRate(I.s), dT = 0;
    if (I.running) {
      if (I.fixedStep) dT = I.fixedStep;
      else { const now = performance.now(); dT = Math.min(0.25, (now - I.wall) / 1000); I.wall = now; }
      I.T += dT; I.s += rate * dT;
    }
    const T = I.T, t = I.s, api = I.api, cam = RJ.camera, sdt = dt * rate;
    const st = formationAt(t);
    // the six jets
    let nearD = 1e9;
    api.jets.forEach((j, k) => {
      const js = placeJet(k, t, j.pos, j.q);
      j.updateBasis();
      v1.set(0, 0, -1).applyQuaternion(j.q);
      j.vel.copy(v1).multiplyScalar(js.v); j.speed = js.v; j.state = "flying";
      j.g = js.g;
      j.throttle = js.mode === "solo" ? 0.95 : 0.78 + 0.2 * sm(21.8, 22.6, t); j.spool = j.throttle;
      j.abLevel = js.mode === "solo" ? 0.6 : 0.85 * sm(24.3, 25, t);
      j.updateVisual(sdt);
      if (js.mode !== I.mode[k]) { I.mode[k] = js.mode; if (js.mode !== "break") I.prev[k] = null; }
      if (!I.running) return;
      const tail = v2.copy(j.pos).addScaledVector(v1, -9);
      const p = I.prev[k];
      if (p) {
        const gap = p.distanceTo(tail), n = Math.min(40, Math.ceil(gap / 2.5));
        const vv = V3().copy(v1).multiplyScalar(js.v * 0.04);
        for (let i = 1; i <= n; i++) RJ.fx.smoke(V3().lerpVectors(p, tail, i / n), vv, 2.6, 0.96, 9, 0.5);
        p.copy(tail);
      } else I.prev[k] = tail.clone();
      const d = j.pos.distanceTo(cam.position);
      if (d < nearD) { nearD = d; I.near = k; }
    });
    // camera
    const fov = shot(t), id = shotId(t);
    cam.position.copy(cpos);
    const gy = RJ.world.ground(cam.position.x, cam.position.z) + (id === 1 ? 1.5 : 4);
    if (cam.position.y < gy) cam.position.y = gy;
    if (I.camUp > 0) cam.up.set(0, 1, 0).lerp(up, I.camUp).normalize(); else cam.up.set(0, 1, 0);
    cam.lookAt(look); cam.up.set(0, 1, 0);
    // a cut snaps the lens; within a shot it glides
    const cut = I.lastShot !== id; I.lastShot = id;
    cam.fov = cut ? fov : RJ.damp(cam.fov, fov, 8, dt);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // a whisper of radial blur on the fast passes, centred on the action so the jets stay sharp
    const pass = Math.max(Math.max(0, 1 - Math.abs(t - 4.75) / 0.5), Math.max(0, 1 - Math.abs(t - SX) / 0.4), sm(22.3, 22.8, t) * (1 - sm(24, 24.4, t)) * 0.6);
    const sc = v2.copy(id === 6 ? look : mid).project(cam);
    RJ.post.fx.motionCenter = [RJ.clamp((sc.x + 1) / 2, 0.15, 0.85), RJ.clamp((sc.y + 1) / 2, 0.15, 0.85)];
    I.ex = cut || !I.ex ? EXPO[id] : RJ.damp(I.ex, EXPO[id], 3, dt);
    api.render(sdt, api.jets[0], 0.012 * pass, I.ex);
    if (!I.running) return;
    // overlay timing
    const q = I.q;
    if (T > 2.6) q.credit.classList.remove("on");
    const cap = T < LOGO_T - 0.3 ? CAPS.find((c) => t >= c[0] && t < c[1]) : null;
    if (cap !== I.cap) {
      I.cap = cap;
      if (cap) { q["cap-n"].textContent = "Maneuver " + (CAPS.indexOf(cap) + 1) + " · " + cap[3]; q["cap-t"].textContent = cap[2]; q.cap.classList.add("on"); }
      else q.cap.classList.remove("on");
    }
    const hit = T - LOGO_T;
    q.flash.style.opacity = hit > 0 ? Math.max(0, 0.85 * Math.exp(-hit * 3.2)) : 0;
    if (hit > 0 && !q.big.classList.contains("sweep")) q.big.classList.add("sweep");
    q.streak.style.opacity = hit > 0 ? Math.max(0, 1 - hit * 1.4) : 0;
    q.streak.style.transform = `translate(-50%, -50%) scaleX(${hit > 0 ? Math.min(1, hit * 3) : 0})`;
    const lw = q["logo-wrap"];
    if (hit > 0 && T < FLIP_T) {
      const k = Math.min(1, hit / 0.45);
      lw.style.opacity = k; lw.style.filter = `blur(${(1 - k) * 10}px)`;
      lw.style.transform = `translate(-50%, -50%) scale(${1.18 - 0.18 * ease(k) + 0.03 * Math.min(1, hit)})`;
    }
    if (T >= FLIP_T && !I.flipped) flipLogo();
    if (T > FLIP_T - 0.1) I.el.classList.add("open");
    q.dip.style.opacity = 0.5 * sm(DUR - 0.45, DUR - 0.05, T);
    // audio follows the nearest jet
    if (I.A) {
      const nj = api.jets[I.near || 0];
      v1.copy(cam.position).sub(nj.pos); I.A.panX = -v1.dot(V3(1, 0, 0).applyQuaternion(cam.quaternion)) / Math.max(30, v1.length()) * 1.4;
      I.airToAir = A2A[id]; I.groupGain = id === 5 || id === 6 ? 0.8 : 1;
      audioTick(I.A, T, cam.position, nj.pos, v2.set(0, 0, -1).applyQuaternion(nj.q), rate, dt);
    }
    if (T >= DUR) I.finish(false);
  };
  // hand the logo over to the lobby's own title: glide the big logo onto it, then fade
  function flipLogo() {
    I.flipped = true;
    const lw = I.q["logo-wrap"], big = I.q.big, tgt = document.querySelector("#scr-main .logo");
    lw.style.transition = "transform .7s cubic-bezier(.5,0,.2,1), opacity .7s ease .1s"; lw.style.filter = "";
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
    RJ.post.cinematic = false; RJ.post.fx.motion = 0; RJ.world.noMist = false;
    const el = I.el;
    if (el) {
      if (I.gate) { I.gate.remove(); I.gate = null; }
      el.classList.add("open");
      const dip = I.q.dip; dip.style.transition = "opacity .55s ease"; dip.style.opacity = skipped ? 0.7 : 0.5;
      I.q.skip.style.display = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { dip.style.opacity = 0; for (const c of ["logo-wrap", "credit", "flash", "streak", "cap"]) I.q[c].style.opacity = 0; }));
      setTimeout(() => el.remove(), 900);
    }
    I.el = null;
    const api = I.api; I.api = null;
    api.done(skipped);
  };
})(window.RJ);
