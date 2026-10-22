/* Jet City — start-up cinematic (30 s, Rio beach air show).
 * A six-ship blue-and-gold Super Hornet demonstration team (a tribute to the US Navy Blue Angels) flies a scripted
 * show over Rio's tropical beach: coastal approach, a crowd-line low pass, a climbing formation turn, a high-speed
 * hero pass, then the JET CITY logo hands over to the lobby.
 * Everything is built from the game systems (the showcase jets, procedural beach crowd, smoke and vapour). The score,
 * jet roar, surf and distant crowd bed are generated live with WebAudio; they are original game sounds.
 * main.js owns the lobby: it calls RJ.intro.start(api) once at boot and api.done() runs exactly once. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, TIME_SCALE = 2, DUR = 15 * TIME_SCALE;
  const toReal = (t) => t * TIME_SCALE, toScene = (t) => t / TIME_SCALE;
  const I = { active: false };
  RJ.intro = I;

  // formations in the lead's frame: x right, y up, z behind (m)
  const DIAMOND = [[0, 0, 0], [8.5, -0.6, 10.5], [-8.5, -0.6, 10.5], [0, -1.4, 21], [0, -3.4, 33], [0, -6.2, 45]];
  const sm = (a, b, x) => RJ.smooth(a, b, x);
  const D2R = Math.PI / 180;

  /* ---------------- the flight path (pre-integrated so it can be checked against the terrain) ---------------- */
  const SPS = 60, NS = Math.ceil(toReal(16.5) * SPS);
  function pitchAt(t, c) { // degrees; c = climb angle of the pull-up (steeper where the valley closes in)
    t = toScene(t);
    return -4.5 + 4.5 * sm(3.6, 4.4, t) + c * sm(5.2, 6.6 + (c - 24) * 0.05, t) - (c + 5) * sm(8.2, 10, t) + 34 * sm(11.9, 13.9, t);
  }
  function rollAt(t, sg) { t = toScene(t); return sg * 62 * (sm(5.9, 7, t) - sm(8.3, 9.3, t)) - 12 * (sm(10.4, 11.2, t) - sm(11.8, 12.8, t)); }
  function speedAt(t) { t = toScene(t); return 172 - 22 * sm(5.2, 8.3, t) + 55 * sm(8.3, 11.5, t) + 10 * sm(11.5, 13, t); }
  function buildPath(O, yaw0, climb, turn) {
    const P = [], Q = [], S = [], G = [];
    const pos = V3(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), qp = new THREE.Quaternion(), qr = new THREE.Quaternion();
    const Y = V3(0, 1, 0), X = V3(1, 0, 0), Z = V3(0, 0, 1), fwd = V3();
    let psi = yaw0;
    const dt = 1 / SPS;
    for (let i = 0; i < NS; i++) {
      const t = i * dt, th = pitchAt(t, climb) * D2R, ph = rollAt(t, turn) * D2R, v = speedAt(t);
      q.copy(qy.setFromAxisAngle(Y, psi)).multiply(qp.setFromAxisAngle(X, th)).multiply(qr.setFromAxisAngle(Z, ph));
      P.push(pos.clone()); Q.push(q.clone()); S.push(v);
      fwd.set(0, 0, -1).applyQuaternion(q);
      pos.addScaledVector(fwd, v * dt);
      psi += 1.5 * RJ.G0 * Math.tan(ph) / v * dt; // coordinated turn (a little tighter than level flight: it's a pull)
    }
    // place it: the lead crosses the runway centre 40 m up at t = 4.7 s
    const k = Math.round(toReal(4.7) * SPS), off = V3(O.x, O.y + 40, O.z).sub(P[k]);
    for (const p of P) p.add(off);
    // load factor from the path's own acceleration (drives the wing vapour)
    for (let i = 0; i < NS; i++) {
      const a = P[Math.min(NS - 1, i + 1)], b = P[i], c = P[Math.max(0, i - 1)];
      const acc = V3().copy(a).sub(b).sub(V3().copy(b).sub(c)).multiplyScalar(SPS * SPS);
      acc.y += RJ.G0;
      G.push(i === 0 || i === NS - 1 ? 1 : acc.length() / RJ.G0);
    }
    // keep the whole formation well clear of the terrain: lift the climb-out and everything after it if needed
    const ground = (x, z) => RJ.world.ground(x, z);
    let lift = 0;
    for (let it = 0; it < 6; it++) {
      let need = 0, at = 0;
      for (let i = Math.round(toReal(5.2) * SPS); i < NS; i += 6) {
        const p = P[i], h = Math.max(ground(p.x, p.z), ground(p.x + 40, p.z), ground(p.x - 40, p.z), ground(p.x, p.z + 40), ground(p.x, p.z - 40));
        const d = h + 25 + 65 * sm(toReal(5.6), toReal(7.5), i / SPS) - p.y;
        if (d > need) { need = d; at = i / SPS; }
      }
      if (need < 1) break;
      lift += need + 10;
      for (let i = 0; i < NS; i++) P[i].y += (need + 10) * sm(toReal(5.2), Math.max(toReal(7.7), at), i / SPS);
    }
    return { P, Q, S, G, lift, turn };
  }
  function sample(path, t, outP, outQ) {
    const f = RJ.clamp(t, 0, (NS - 1.001) / SPS) * SPS, i = Math.floor(f), u = f - i;
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
    // Original surf and a distant crowd bed for the beach scene.
    const surf = ctx.createBufferSource(); surf.buffer = nb; surf.loop = true; surf.playbackRate.value = 0.38;
    A.surfFilter = keep(ctx.createBiquadFilter()); A.surfFilter.type = "lowpass"; A.surfFilter.frequency.value = 460;
    A.surfGain = keep(ctx.createGain()); A.surfGain.gain.value = 0.10 * Math.min(1.5, sv);
    surf.connect(A.surfFilter).connect(A.surfGain).connect(A.bus); A.surf = surf;
    const crowd = ctx.createBufferSource(); crowd.buffer = nb; crowd.loop = true; crowd.playbackRate.value = 0.72;
    A.crowdFilter = keep(ctx.createBiquadFilter()); A.crowdFilter.type = "bandpass"; A.crowdFilter.frequency.value = 980; A.crowdFilter.Q.value = 0.42;
    A.crowdGain = keep(ctx.createGain()); A.crowdGain.gain.value = 0.003 * Math.min(1.5, sv);
    crowd.connect(A.crowdFilter).connect(A.crowdGain).connect(A.bus); A.crowd = crowd;
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
    for (const s of [ns, rs, surf, crowd, ...A.whine]) { s.start(t0); A.srcs.push(s); }
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
  // the cue: D minor, rising through Bb-F-C, climbing to a D major hit on the logo (30-second arrangement)
  function score(A) {
    const E = (t, fn) => A.ev.push({ t: toReal(t), fn });
    E(0, (w) => { strings(A, [38, 45, 50], w, 5.6, 0.035); swell(A, w + 1.2, 1.8, 0.05); });
    [0, 1.25, 2.5].forEach((x, i) => E(x, (w) => timp(A, 38, w, 0.18 + i * 0.08)));
    // low-string ostinato from the flyby to the climax
    const roots = [[3, 38], [6, 34], [7.1, 41], [8.2, 36], [9.1, 43], [10, 34], [11.5, 36]];
    for (let x = 3; x < 12.95; x += 0.3125) {
      let r = 38; for (const [a, b] of roots) if (x >= a - 1e-3) r = b;
      const acc = Math.round((x - 3) / 0.3125) % 4 === 0;
      E(x, (w) => voice(A, "sawtooth", mtof(r), w, 0.12, (acc ? 0.07 : 0.045) * (0.8 + 0.4 * sm(3, 12.9, x)), 0.01, 0.14, 900, [-6, 6]));
    }
    E(3, (w) => { brass(A, [50, 53, 57], w, 1.4, 0.03); strings(A, [50, 53, 57, 62], w, 2.8, 0.02); timp(A, 38, w, 0.35); });
    E(4.7, (w) => { brass(A, [50, 57, 62, 65], w, 1.0, 0.045); timp(A, 38, w, 0.5); noiseHit(A, w, 0.22, "highpass", 3000, 2.2); });
    E(6, (w) => { brass(A, [46, 50, 53], w, 1.0, 0.04); strings(A, [58, 62, 65], w, 1.0, 0.022); timp(A, 34, w, 0.4); });
    E(7.1, (w) => { brass(A, [41, 48, 53, 57], w, 1.0, 0.042); strings(A, [60, 65, 69], w, 1.0, 0.022); });
    E(8.2, (w) => { brass(A, [48, 52, 55, 60], w, 0.8, 0.044); strings(A, [60, 64, 67], w, 0.8, 0.024); timp(A, 36, w, 0.45); });
    E(9.1, (w) => { brass(A, [43, 50, 55, 58], w, 0.8, 0.045); strings(A, [62, 67, 70], w, 0.8, 0.025); });
    // the theme on top (horns an octave up)
    [[6, 69, 0.55], [6.6, 74, 0.45], [7.1, 76, 0.3], [7.4, 77, 0.75], [8.2, 79, 0.55], [8.75, 76, 0.3], [9.1, 74, 0.8],
      [10, 74, 0.9], [10.95, 77, 0.3], [11.5, 79, 0.9], [12.45, 81, 0.5]].forEach(([x, m, d]) => E(x, (w) => brass(A, [m], w, d, 0.034)));
    E(10, (w) => { brass(A, [46, 53, 58, 62], w, 1.3, 0.05); strings(A, [58, 62, 65, 70], w, 1.4, 0.03); timp(A, 34, w, 0.55); noiseHit(A, w, 0.2, "highpass", 3000, 1.8); });
    E(11.5, (w) => { brass(A, [48, 55, 60, 64], w, 1.3, 0.054); strings(A, [60, 64, 67, 72], w, 1.4, 0.032); timp(A, 36, w, 0.55); });
    // build: snare roll and cymbal swell into the hit
    for (let x = 11.9; x < 12.97; x += 0.065) E(x, (w) => noiseHit(A, w, 0.05 + 0.2 * sm(11.9, 13, x), "bandpass", 1900, 0.06, 1.2));
    E(11.2, (w) => swell(A, w, 1.8, 0.16));
    // the logo at ~26 s: full D major, timpani, sub boom and crash, ringing out under the lobby
    E(13, (w) => {
      brass(A, [38, 45, 50, 54, 57, 62, 66, 69], w, 1.1, 0.05); strings(A, [50, 54, 57, 62, 66, 69, 74], w, 1.6, 0.03);
      timp(A, 38, w, 0.9); timp(A, 26, w + 0.02, 0.6); boom(A, w, 0.9); noiseHit(A, w, 0.45, "highpass", 2500, 3.2);
    });
    E(14.1, (w) => strings(A, [50, 57, 62, 66], w, 0.9, 0.018));
    A.ev.sort((a, b) => a.t - b.t);
  }
  function audioTick(A, t, camPos, form, fwd, dt) {
    if (!A || A.ctx.state !== "running") { if (A) A.base = null; return; }
    const now = A.ctx.currentTime;
    if (A.base == null) { A.base = now - t; while (A.evI < A.ev.length && A.ev[A.evI].t < t - 0.04) A.evI++; }
    while (A.evI < A.ev.length && A.ev[A.evI].t <= t + 0.3) { const e = A.ev[A.evI++]; try { e.fn(Math.max(now + 0.005, A.base + e.t)); } catch (err) { /* voice limit */ } }
    // engines: distance, aft-quadrant roar and Doppler
    const rel = V3().copy(camPos).sub(form), r = Math.max(8, rel.length());
    const close = A.prevR != null ? (A.prevR - r) / Math.max(dt, 1e-3) : 0;
    A.prevR = r;
    const dop = RJ.clamp(343 / Math.max(120, 343 - RJ.clamp(close, -300, 300)), 0.62, 1.75);
    A.dop = RJ.damp(A.dop || dop, dop, 10, dt);
    const aft = Math.max(0, -rel.normalize().dot(fwd));
    const near = RJ.clamp(70 / r, 0, 1.25);
    let lvl = near * (0.75 + 0.75 * aft);
    if (t > toReal(6) && t < toReal(13)) lvl *= 0.55; // air-to-air shots: let the score lead
    lvl *= 1 - sm(toReal(13.2), toReal(15.5), t);
    const k = Math.min(1, dt * 12);
    A.eng.gain.setTargetAtTime(lvl, now, 0.05);
    A.lp.frequency.setTargetAtTime(Math.min(16000, (380 + 9000 * Math.min(1, near * near)) * A.dop), now, 0.05);
    A.ns.playbackRate.setTargetAtTime(0.75 + 0.3 * A.dop, now, 0.05);
    A.whine[0].frequency.setTargetAtTime(2850 * A.dop, now, 0.04); A.whine[1].frequency.setTargetAtTime(4150 * A.dop, now, 0.04);
    A.wg.gain.setTargetAtTime(0.06 * (1 - aft) * Math.min(1, near * 1.5), now, 0.05);
    if (A.pan.pan) A.pan.pan.setTargetAtTime(RJ.clamp(A.panX || 0, -0.9, 0.9), now, 0.05);
    // The crowd rises as the formation crosses the shoreline, then settles beneath the score.
    const beach = sm(toReal(3.7), toReal(4.65), t) * (1 - sm(toReal(5.8), toReal(7.2), t));
    A.crowdGain.gain.setTargetAtTime((0.003 + 0.024 * beach) * Math.min(1.5, RJ.settings.sfxVol == null ? 1 : RJ.settings.sfxVol), now, 0.35);
    // the moment the formation goes over: a ripping roar
    if (A.lastClose > 40 && close < 0 && r < 220 && !A.ripped) { A.ripped = true; noiseHit(A, now, 0.9, "lowpass", 2400, 2.2); }
    A.lastClose = close; void k;
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

  /* ---------------- beach dressing: compact, instanced umbrellas plus crowd-controlled cheer ---------------- */
  function makeBeachSet(B) {
    if (!B || !RJ.world.scene) return null;
    const group = new THREE.Group(); group.name = "intro-beach-show";
    const canopy = new THREE.ConeGeometry(2.4, 0.65, 8), pole = new THREE.CylinderGeometry(0.055, 0.055, 1.85, 5);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe7dfca, roughness: 0.8 });
    const count = 54, tops = new THREE.InstancedMesh(canopy, canopyMat, count), poles = new THREE.InstancedMesh(pole, poleMat, count);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1,1,1), P = new THREE.Vector3(), Y = new THREE.Vector3(0,1,0);
    const colors = [0xf4d35e,0xee6c4d,0x58a6a6,0xf7f7f0,0x355c7d];
    for (let k=0;k<count;k++) {
      const row = Math.floor(k / 18), col = k % 18;
      const along = (col / 17 - 0.5) * (B.length * 0.9), depth = 25 + row * 44;
      P.set(B.x + B.alongX * along - B.seaX * depth, B.y + 2.0, B.z + B.alongZ * along - B.seaZ * depth);
      M.compose(P,Q,S); tops.setMatrixAt(k,M); tops.setColorAt(k,new THREE.Color(colors[(k * 7 + row) % colors.length]));
      P.y = B.y + 0.92; M.compose(P,Q,S); poles.setMatrixAt(k,M);
    }
    tops.instanceMatrix.needsUpdate = true; poles.instanceMatrix.needsUpdate = true;
    tops.castShadow = true; tops.receiveShadow = true; poles.castShadow = true;
    tops.layers.set(5); poles.layers.set(5); group.add(tops,poles); RJ.world.scene.add(group);
    return group;
  }
  function clearBeachSet() {
    if (!I.beachSet) return;
    I.beachSet.parent.remove(I.beachSet);
    I.beachSet.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    I.beachSet = null;
  }

  /* ---------------- start / frame / finish ---------------- */
  /** api: { jets, delta, center:V3 (runway centre on the ground), yaw, beach, render(dt, focus, motion), done() } */
  I.start = function (api) {
    if (I.active || I.played) return false;
    I.active = true; I.played = true; I.api = api; I.t = 0; I.ended = false;
    const O = api.center.clone();
    // fly the direction that puts the sun on the right side of the formation (the hero camera's side)
    const s = RJ.world.sunDir, f0 = V3(-Math.sin(api.yaw), 0, -Math.cos(api.yaw)), r0 = V3(-f0.z, 0, f0.x);
    const sunYaw = api.yaw + (r0.x * s.x + r0.z * s.z < 0 ? Math.PI : 0);
    // pick the direction and pull-up angle that clear the valley walls without bending the path
    let best = null;
    for (const yaw of [sunYaw, sunYaw + Math.PI]) for (const turn of [1, -1]) for (const c of [24, 32, 40, 52]) {
      if (best && best.path.lift < 5) break;
      const path = buildPath(O, yaw, c, turn);
      if (!best || path.lift < best.path.lift - 5) best = { yaw, path };
    }
    I.yaw = best.yaw; I.path = best.path;
    I.F = V3(-Math.sin(I.yaw), 0, -Math.cos(I.yaw)); I.R = V3(-I.F.z, 0, I.F.x);
    I.O = O; I.beach = api.beach || null; I.beachSet = makeBeachSet(I.beach);
    I.prev = api.jets.map(() => null);
    I.el = buildOverlay();
    I.q = {}; for (const c of ["credit", "flash", "streak", "logo-wrap", "big", "dip", "skip"]) I.q[c] = I.el.querySelector("." + c);
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
  I.begin = function () {
    if (!I.active || I.running) return;
    if (I.gate) { I.gate.remove(); I.gate = null; }
    RJ.audio.init(); if (RJ.audio.unlock) RJ.audio.unlock();
    if (RJ.audio.ctx && RJ.audio.ctx.state !== "running") RJ.audio.ctx.resume().catch(() => {});
    try { I.A = makeAudio(); } catch (e) { console.warn("Intro audio unavailable", e); I.A = null; }
    I.running = true; I.wall = performance.now(); I.t = 0;
    I.q.credit.classList.add("on");
  };

  const tP = V3(), tQ = new THREE.Quaternion(), fw = V3(), rt = V3(), up = V3(), hf = V3(), hr = V3(), mid = V3(), cpos = V3(), look = V3(), v1 = V3(), v2 = V3();
  const lerp = (a, b, x) => a + (b - a) * x;
  const ease = (x) => x * x * (3 - 2 * x);
  function formationAt(t) {
    const st = sample(I.path, t, tP, tQ);
    fw.set(0, 0, -1).applyQuaternion(tQ); rt.set(1, 0, 0).applyQuaternion(tQ); up.set(0, 1, 0).applyQuaternion(tQ);
    hf.set(fw.x, 0, fw.z).normalize(); hr.set(-hf.z, 0, hf.x);
    mid.copy(tP).addScaledVector(fw, -16);
    return st;
  }
  // slot k at time t: Delta -> Diamond during the climbing turn -> back to Delta for the hero pass
  function slot(k, t, out) {
    const a = I.api.delta[k], b = DIAMOND[k];
    const st = k >= 4 ? 6.3 : 7.0, en = k >= 4 ? 8.0 : 8.4;
    t = toScene(t);
    const x = sm(st, en, t) - sm(10, 11.3, t);
    return out.set(lerp(a[0], b[0], x), lerp(a[1], b[1], x), lerp(a[2], b[2], x));
  }
  // where the camera is (writes cpos / look, returns fov)
  function shot(t) {
    const sceneT = toScene(t), O = I.O, F = I.F, R = I.R;
    const L = (s, r, u, out) => out.set(O.x + F.x * s + R.x * r, O.y + u, O.z + F.z * s + R.z * r);
    let fov;
    I.camUp = 0;
    if (sceneT < 3) {
      // Establishing: lift from the beach crowd as the six smoke trails approach over the water
      const u = sceneT / 3;
      L(430 - 90 * u, 250 - 50 * u, 140 - 80 * ease(u), cpos);
      look.copy(mid).lerp(L(-150, 0, 20, v1), 0.45 * (1 - ease(u)));
      fov = lerp(44, 16, ease(u));
    } else if (sceneT < 6) {
      // Beach-line pass: keep the crowd in the foreground as the formation crosses and pulls up
      L(10, -72, 2.2, cpos);
      look.copy(mid);
      const d = cpos.distanceTo(mid);
      fov = RJ.clamp(2 * Math.atan(48 / d) / RJ.DEG, 24, 78);
      const shake = Math.max(0, 1 - Math.abs(sceneT - 4.75) / 0.6) * 0.25;
      look.x += Math.sin(t * 61) * shake; look.y += Math.sin(t * 47 + 1) * shake;
    } else if (sceneT < 8.2) {
      // the sweep: camera ship high on the inside of the turn, sliding from behind to abeam
      const u = ease((sceneT - 6) / 2.2);
      cpos.copy(tP).addScaledVector(hr, -I.path.turn * lerp(78, 100, u)).addScaledVector(hf, lerp(-55, 5, u)); cpos.y += lerp(-4, -10, u);
      look.copy(mid);
      fov = lerp(40, 34, u);
      I.camUp = 0.25;
    } else if (sceneT < 10) {
      // wide: all six against the sky from far below and to the side
      if (!I.wide) { I.wide = pickWide(); formationAt(t); }
      cpos.copy(I.wide);
      look.copy(mid);
      fov = RJ.clamp(2 * Math.atan(70 / cpos.distanceTo(mid)) / RJ.DEG, 14, 40);
    } else {
      // hero: alongside on the sunny side, the team edging past, then the camera falls back and wide
      heroPose(Math.min(t, toReal(13)), cpos, look);
      fov = lerp(44, 34, sm(11.4, 13, sceneT));
      if (sceneT > 13) {
        // the camera ship eases off; the formation runs on toward the horizon under the logo
        const a = heroPose(toReal(12.95), V3()), b = heroPose(toReal(13), V3()), vel = b.clone().sub(a).multiplyScalar(20 / TIME_SCALE), x = sceneT - 13;
        cpos.copy(b).addScaledVector(vel, x - x * x / 4.4); cpos.y += 18 * x * x;
        look.copy(mid).lerp(v2.copy(mid).addScaledVector(hf, 300).add(V3(0, 300, 0)), sm(13, 15, sceneT) * 0.35);
        fov = lerp(34, 40, sm(13, 15, sceneT));
      }
    }
    return fov;
  }
  const hp = V3(), hq = new THREE.Quaternion(), hfw = V3(), hrt = V3();
  function heroPose(t, outP, outL) {
    sample(I.path, t, hp, hq);
    const sceneT = toScene(t);
    hfw.set(0, 0, -1).applyQuaternion(hq); hfw.y = 0; hfw.normalize();
    hrt.set(-hfw.z, 0, hfw.x);
    const k = sm(11.4, 13, sceneT);
    const side = lerp(36, 300, k), ahead = lerp(4 - 3.2 * (sceneT - 10), -90, k), high = lerp(-7, -30, k);
    outP.copy(hp).addScaledVector(hrt, side).addScaledVector(hfw, ahead); outP.y += high;
    if (outL) outL.copy(hp).addScaledVector(hfw, lerp(-16, 30, k));
    return outP;
  }
  function losClear(a, b) {
    for (let i = 1; i < 24; i++) { const x = i / 24; v1.lerpVectors(a, b, x); if (RJ.world.ground(v1.x, v1.z) > v1.y - 6) return false; }
    return true;
  }
  function pickWide() {
    formationAt(toReal(9.1));
    const m = mid.clone(), F = hf.clone(), R = hr.clone();
    const cand = [[700, -230, 250], [-700, -230, 250], [650, -120, -200], [-650, -120, -200], [800, 60, 300], [-800, 60, 300]];
    for (const [r, u, f] of cand) {
      const p = m.clone().addScaledVector(R, r).addScaledVector(F, f); p.y += u;
      const g = RJ.world.ground(p.x, p.z) + 25; if (p.y < g) p.y = g;
      let ok = true;
      for (const tt of [8.2, 9.1, 10]) { formationAt(toReal(tt)); if (!losClear(p, mid)) { ok = false; break; } }
      if (ok) return p;
    }
    const p = m.clone().addScaledVector(R, 600); p.y = Math.max(p.y + 200, RJ.world.ground(p.x, p.z) + 300); return p;
  }

  I.frame = function (dt) {
    if (!I.active) return;
    if (I.running) {
      if (I.fixedStep) I.t += I.fixedStep;
      else { const now = performance.now(); I.t += Math.min(0.25, (now - I.wall) / 1000); I.wall = now; }
    }
    const t = I.t, api = I.api, cam = RJ.camera;
    const st = formationAt(t);
    // the six jets
    const o = V3();
    api.jets.forEach((j, i) => {
      slot(i, t, o);
      const w = t * 1.3 + i * 1.7;
      j.pos.copy(tP).addScaledVector(rt, o.x + Math.sin(w) * 0.2).addScaledVector(up, o.y + Math.sin(w * 1.3) * 0.15).addScaledVector(fw, -o.z + Math.sin(w * 0.7) * 0.25);
      j.q.copy(tQ); j.updateBasis();
      j.vel.copy(fw).multiplyScalar(st.v); j.speed = st.v; j.state = "flying";
      j.g = st.g; j.throttle = 0.78 + 0.2 * sm(toReal(9.5), toReal(10.5), t); j.spool = j.throttle; j.abLevel = 0.85 * (sm(toReal(9.6), toReal(10.4), t) - sm(toReal(12.6), toReal(13.6), t));
      j.updateVisual(dt);
      if (!I.running) return;
      const tail = v1.copy(j.pos).addScaledVector(fw, -9);
      const p = I.prev[i];
      if (p) {
        const gap = p.distanceTo(tail), n = Math.min(40, Math.ceil(gap / 2.5));
        for (let k = 1; k <= n; k++) RJ.fx.smoke(v2.lerpVectors(p, tail, k / n), V3().copy(fw).multiplyScalar(st.v * 0.04), 2.6, 0.96, 8, 0.5);
        p.copy(tail);
      } else I.prev[i] = tail.clone();
    });
    // Synchronize the beach crowd's raised-arm response with the low pass.
    if (RJ.living && RJ.living.people && RJ.living.people.setAirshow) RJ.living.people.setAirshow(toScene(t));
    // camera
    const fov = shot(t);
    cam.position.copy(cpos);
    const gy = RJ.world.ground(cam.position.x, cam.position.z) + (t >= toReal(3) && t < toReal(6) ? 1.5 : 4);
    if (cam.position.y < gy) cam.position.y = gy;
    if (I.camUp > 0) cam.up.set(0, 1, 0).lerp(up, I.camUp).normalize(); else cam.up.set(0, 1, 0);
    cam.lookAt(look); cam.up.set(0, 1, 0);
    // a cut snaps the lens; within a shot it glides
    const cut = I.lastShot !== shotId(t); I.lastShot = shotId(t);
    cam.fov = cut ? fov : RJ.damp(cam.fov, fov, 8, dt);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // a whisper of radial blur on the two fast passes, centred on the formation so the jets stay sharp
    const pass = Math.max(Math.max(0, 1 - Math.abs(t - toReal(4.75)) / toReal(0.5)), sm(toReal(10), toReal(10.6), t) * (1 - sm(toReal(12.4), toReal(13), t)) * 0.6);
    const sc = v2.copy(mid).project(cam);
    RJ.post.fx.motionCenter = [RJ.clamp((sc.x + 1) / 2, 0.15, 0.85), RJ.clamp((sc.y + 1) / 2, 0.15, 0.85)];
    const ex = [1.3, 1.15, 1.25, 1.0, 1.3][shotId(t)];
    I.ex = cut || !I.ex ? ex : RJ.damp(I.ex, ex, 3, dt);
    api.render(dt, api.jets[0], 0.012 * pass, I.ex);
    // overlay timing
    if (I.running) {
      const q = I.q;
      if (t > toReal(2.6)) q.credit.classList.remove("on");
      const hit = t - toReal(13);
      q.flash.style.opacity = hit > 0 ? Math.max(0, 0.85 * Math.exp(-hit * 3.2)) : 0;
      if (hit > 0 && !q.big.classList.contains("sweep")) q.big.classList.add("sweep");
      q.streak.style.opacity = hit > 0 ? Math.max(0, 1 - hit * 1.4) : 0;
      q.streak.style.transform = `translate(-50%, -50%) scaleX(${hit > 0 ? Math.min(1, hit * 3) : 0})`;
      const lw = q["logo-wrap"];
      if (hit > 0 && t < toReal(14.3)) {
        const k = Math.min(1, hit / 0.45);
        lw.style.opacity = k; lw.style.filter = `blur(${(1 - k) * 10}px)`;
        lw.style.transform = `translate(-50%, -50%) scale(${1.18 - 0.18 * ease(k) + 0.03 * Math.min(1, hit)})`;
      }
      if (t >= toReal(14.3) && !I.flipped) flipLogo();
      if (t > toReal(14.2)) I.el.classList.add("open");
      q.dip.style.opacity = 0.5 * sm(toReal(14.55), toReal(14.95), t);
      // audio
      if (I.A) { v1.copy(cam.position).sub(mid); I.A.panX = -v1.dot(V3(1, 0, 0).applyQuaternion(cam.quaternion)) / Math.max(30, v1.length()) * 1.4; }
      audioTick(I.A, t, cam.position, mid, fw, dt);
      if (t >= DUR) I.finish(false);
    }
  };
  function shotId(t) { const s = toScene(t); return s < 3 ? 0 : s < 6 ? 1 : s < 8.2 ? 2 : s < 10 ? 3 : 4; }
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
    clearBeachSet();
    if (I.beach && I.beach.zone && RJ.living && RJ.living.removeZone) RJ.living.removeZone(I.beach.zone);
    I.beach = null;
    RJ.post.cinematic = false; RJ.post.fx.motion = 0; RJ.world.noMist = false;
    const el = I.el;
    if (el) {
      if (I.gate) { I.gate.remove(); I.gate = null; }
      el.classList.add("open");
      const dip = I.q.dip; dip.style.transition = "opacity .55s ease"; dip.style.opacity = skipped ? 0.7 : 0.5;
      I.q.skip.style.display = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { dip.style.opacity = 0; for (const c of ["logo-wrap", "credit", "flash", "streak"]) I.q[c].style.opacity = 0; }));
      setTimeout(() => el.remove(), 900);
    }
    I.el = null;
    const api = I.api; I.api = null;
    api.done(skipped);
  };
})(window.RJ);
