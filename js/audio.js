/* Ridgeline Jets — synthesized audio.
 * Engines are layered procedural models per engine family (fighter turbojet/low-bypass, high-bypass airliner,
 * heavy bomber turbofan, piston-prop, rocket) with spool dynamics, startup sequences, afterburner light-off,
 * directivity, distance air absorption and Doppler. Plus wind, ground roll, cabin ambience, warnings,
 * weapons/effects and the welcome voice. Everything is generated in code: no audio files are required. */
(function (RJ) {
  "use strict";
  const AU = { ctx: null };
  RJ.audio = AU;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- shared noise sources (per AudioContext, so offline renders work too) ---------------- */
  const BUF = new WeakMap();
  function buffers(ctx) {
    let B = BUF.get(ctx);
    if (B) return B;
    const mk = (sec) => ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const white = mk(5), brown = mk(5.3), pink = mk(4.7), crackle = mk(4.1);
    const w = white.getChannelData(0), br = brown.getChannelData(0), pk = pink.getChannelData(0), cr = crackle.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    for (let i = 0; i < br.length; i++) { const x = Math.random() * 2 - 1; last = (last + 0.02 * x) / 1.02; br[i] = last * 3.5; }
    for (let i = 0; i < pk.length; i++) {
      const x = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      pk[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
    }
    // crackle: sparse sharp pops with a fast decay (afterburner rasp, piston exhaust)
    let env = 0;
    for (let i = 0; i < cr.length; i++) { if (Math.random() < 110 / ctx.sampleRate) env = 0.35 + Math.random() * 0.65; env *= 0.9968; cr[i] = (Math.random() * 2 - 1) * env; }
    // blend each loop's tail into its head so the seam never clicks
    for (const d of [w, br, pk, cr]) { const n = 2048, L = d.length; for (let k = 0; k < n; k++) { const a = k / n; d[L - n + k] = d[L - n + k] * (1 - a) + d[k] * a; } }
    B = { white, brown, pink, crackle };
    BUF.set(ctx, B);
    return B;
  }
  // loops of different lengths at slightly different rates: layers never line up into an audible pattern
  function loop(ctx, buf) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.playbackRate.value = 0.96 + Math.random() * 0.08;
    s.start(0, Math.random() * buf.duration);
    return s;
  }
  const mkGain = (ctx, v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const mkFilt = (ctx, type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
  const mkOsc = (ctx, type, f = 100) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
  const P = (param, v, t = 0.08) => { if (AU.ctx) param.setTargetAtTime(v, AU.ctx.currentTime, t); };

  /* ---------------- engine families ----------------
   * whine: turbine tone at idle and full (Hz); wg: its gain idle..full (high-bypass fans whine most at idle)
   * roarF/roarG: jet-mixing roar low-pass cutoff and gain; deepG: steady low-frequency body; rasp: mid-band hiss
   * buzz: fan "buzz-saw" (supersonic fan tips) above `on` N1; rum: sub-bass hull rumble
   * up/down: spool rates (per s, slower at low N); start: seconds from starter to idle; size: loudness and reach
   * cock: [gain, cabin low-pass] heard from the cockpit */
  const PROFILES = {
    fighter: { kind: "jet", idle: 0.26, up: 0.95, down: 0.8, start: 4.2, size: 1, partial: 1.53,
      whine: [2500, 7000], wg: [0.05, 0.028], roarF: [300, 2700], roarG: [0.1, 0.6], deepG: [0.03, 0.12], rasp: [900, 3100], raspG: [0.03, 0.2],
      buzz: null, rum: [34, 52], rumG: [0.03, 0.08], abG: 1.0, crk: 0.34, cock: [0.85, 1500] },
    heavyjet: { kind: "jet", idle: 0.24, up: 0.6, down: 0.55, start: 5.5, size: 1.55, partial: 1.47,
      whine: [1700, 4700], wg: [0.035, 0.024], roarF: [200, 1800], roarG: [0.14, 0.72], deepG: [0.06, 0.2], rasp: [700, 2300], raspG: [0.03, 0.18],
      buzz: null, rum: [28, 44], rumG: [0.06, 0.14], abG: 1.0, crk: 0.27, cock: [0.75, 1100] },
    airliner: { kind: "jet", idle: 0.21, up: 0.36, down: 0.42, start: 7.5, size: 1.7, partial: 1.41,
      whine: [3300, 5500], wg: [0.045, 0.02], roarF: [170, 1300], roarG: [0.08, 0.8], deepG: [0.05, 0.25], rasp: [600, 1700], raspG: [0.015, 0.12],
      buzz: { on: 0.72, f: [70, 150], g: 0.11 }, rum: [26, 40], rumG: [0.05, 0.15], abG: 0, crk: 0, cock: [0.42, 800] },
    heavy: { kind: "jet", idle: 0.22, up: 0.32, down: 0.4, start: 7, size: 2, partial: 1.33,
      whine: [1500, 3400], wg: [0.03, 0.02], roarF: [130, 950], roarG: [0.14, 0.92], deepG: [0.1, 0.32], rasp: [500, 1250], raspG: [0.02, 0.14],
      buzz: { on: 0.75, f: [48, 96], g: 0.07 }, rum: [22, 36], rumG: [0.1, 0.25], abG: 0, crk: 0, cock: [0.55, 750] },
    fanmil: { kind: "jet", idle: 0.24, up: 0.6, down: 0.6, start: 5, size: 1.1, partial: 1.47,
      whine: [3800, 6400], wg: [0.07, 0.058], roarF: [220, 1500], roarG: [0.08, 0.52], deepG: [0.03, 0.1], rasp: [800, 2000], raspG: [0.02, 0.12],
      buzz: { on: 0.8, f: [90, 160], g: 0.05 }, rum: [30, 44], rumG: [0.03, 0.08], abG: 0, crk: 0, cock: [0.8, 1300] },
    bizjet: { kind: "jet", idle: 0.24, up: 0.6, down: 0.6, start: 5, size: 0.8, partial: 1.62,
      whine: [4200, 7800], wg: [0.05, 0.04], roarF: [300, 1900], roarG: [0.07, 0.42], deepG: [0.02, 0.07], rasp: [1200, 3200], raspG: [0.03, 0.12],
      buzz: { on: 0.8, f: [120, 210], g: 0.04 }, rum: [36, 50], rumG: [0.02, 0.05], abG: 0, crk: 0, cock: [0.5, 1000] },
    prop: { kind: "prop", idle: 0.18, up: 1.6, down: 1.1, start: 3, size: 0.95, cock: [0.9, 1700] },
    rocket: { kind: "rocket", idle: 0, up: 7, down: 7, start: 0.3, size: 1.25, cock: [0.9, 1600] }
  };
  /** Pick the engine family from the aircraft's real powerplant. */
  AU.profileFor = function (spec) {
    const eng = spec.flight.eng;
    const id = spec.cat === "airliner" ? "airliner" : eng === "prop" ? "prop" : eng === "rocket" ? "rocket"
      : spec.id === "a10" ? "fanmil" : spec.cat === "bizjet" ? "bizjet" : spec.cat === "cargo" || eng === "fan" ? "heavy"
      : spec.cat === "bomber" || eng === "ramjet" ? "heavyjet" : "fighter";
    const p = Object.assign({ id }, PROFILES[id]);
    p.pitch = Math.pow((spec.sound && spec.sound.pitch) || 1, 0.6);
    p.ab = !!spec.flight.ab;
    return p;
  };
  const profCache = new Map();
  const profOf = (spec) => { let p = profCache.get(spec.id); if (!p) profCache.set(spec.id, (p = AU.profileFor(spec))); return p; };

  /** Spool model: N (0 = stopped, idle..1 = thrust range). Starter runs it up to idle, then it chases the throttle. */
  function spool(st, p, thr, dt, alive) {
    const target = !alive ? 0 : p.kind === "rocket" ? thr : p.idle + (1 - p.idle) * thr;
    if (st.N == null) st.N = target;
    const N0 = st.N;
    let N = N0;
    if (alive && N < p.idle) N = Math.min(Math.max(target, p.idle), N + (dt / p.start) * p.idle * (1 + thr * 1.5));
    else if (target > N) N += (target - N) * (1 - Math.exp(-dt * p.up * (0.35 + N)));
    else N += (target - N) * (1 - Math.exp(-dt * p.down * (alive ? 1 : 0.22)));
    st.lightoff = p.kind !== "rocket" && N0 < p.idle * 0.45 && N >= p.idle * 0.45;
    st.N = N;
    return N;
  }

  /* ---------------- engine voice: every layer exists once, the family sets the mix ---------------- */
  class EngineVoice {
    constructor(ctx, bus) {
      this.ctx = ctx;
      const B = buffers(ctx);
      this.out = mkGain(ctx, 0);
      this.air = mkFilt(ctx, "lowpass", 18000, 0.5); // distance air absorption
      this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      this.out.connect(this.air);
      if (this.pan) this.air.connect(this.pan).connect(bus); else this.air.connect(bus);
      const layer = (buf, type, f, q) => { const fl = mkFilt(ctx, type, f, q), g = mkGain(ctx); loop(ctx, buf).connect(fl).connect(g).connect(this.out); return { f: fl, g }; };
      this.roar = layer(B.brown, "lowpass", 400, 0.7);
      this.deep = layer(B.pink, "lowpass", 190, 0.6);
      this.rasp = layer(B.white, "bandpass", 1500, 0.9);
      this.abr = layer(B.brown, "lowpass", 600, 0.6);
      this.crk = layer(B.crackle, "highpass", 1200, 0.7);
      // turbine whine: two partials with a slow wander so it never reads as a test tone
      this.wg = mkGain(ctx); this.wg.connect(this.out);
      this.w1 = mkOsc(ctx, "sine", 2000); this.w2 = mkOsc(ctx, "sine", 3000);
      const w2g = mkGain(ctx, 0.42); this.w1.connect(this.wg); this.w2.connect(w2g).connect(this.wg);
      this.wob = mkOsc(ctx, "sine", 0.31 + Math.random() * 0.3); this.wobG = mkGain(ctx, 7);
      this.wob.connect(this.wobG); this.wobG.connect(this.w1.detune); this.wobG.connect(this.w2.detune);
      // fan buzz-saw: two slightly detuned saws through a band-pass
      this.bz1 = mkOsc(ctx, "sawtooth", 100); this.bz2 = mkOsc(ctx, "sawtooth", 100.7);
      this.bzF = mkFilt(ctx, "bandpass", 700, 1.3); this.bzG = mkGain(ctx);
      this.bz1.connect(this.bzF); this.bz2.connect(this.bzF); this.bzF.connect(this.bzG).connect(this.out);
      // hull rumble / piston firing note (soft-clipped so the prop note has bite)
      this.rum = mkOsc(ctx, "triangle", 40);
      const sh = ctx.createWaveShaper(), curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 2.4); }
      sh.curve = curve;
      this.rumF = mkFilt(ctx, "lowpass", 140, 0.8); this.rumG = mkGain(ctx);
      this.rum.connect(sh).connect(this.rumF).connect(this.rumG).connect(this.out);
      // propeller blade-pass thrum
      this.pb = mkOsc(ctx, "sawtooth", 60); this.pbF = mkFilt(ctx, "lowpass", 320, 1.1); this.pbG = mkGain(ctx);
      this.pb.connect(this.pbF).connect(this.pbG).connect(this.out);
      this.st = { N: null }; this.abLast = 0; this.prof = null; this.thrLast = 0;
    }
    /** s: {N, ab, thr, gain, air, front (0 tail-on .. 1 nose-on), pan, dop, interior} */
    apply(p, s) {
      const t = this.ctx.currentTime, T = (param, v, tc = 0.06) => param.setTargetAtTime(v, t, tc);
      const N = s.N, d = s.dop, fr = s.front, rear = 1 - fr;
      T(this.out.gain, s.gain, 0.09);
      T(this.air.frequency, s.air, 0.12);
      if (this.pan) T(this.pan.pan, s.pan, 0.08);
      const zero = (...gs) => gs.forEach((g) => T(g.gain, 0, 0.1));
      if (p.kind === "prop") {
        // V12 piston: firing note = rpm/10 (1100 rpm idle → 3000 rpm), 4-blade prop at 0.42 reduction
        const n = RJ.clamp((N - p.idle) / (1 - p.idle), 0, 1), lit = RJ.clamp(N / p.idle, 0, 1);
        const rpm = N < p.idle ? 1100 * lit : lerp(1100, 3000, n);
        const fire = (rpm / 10) * d, blade = (rpm * 0.42 * 4 / 60) * d;
        if (this.rum.type !== "square") this.rum.type = "square";
        T(this.rum.frequency, Math.max(8, fire)); T(this.rumF.frequency, Math.max(120, fire * 3.2)); T(this.rumG.gain, lit * (0.13 + n * 0.1));
        T(this.pb.frequency, Math.max(4, blade)); T(this.pbF.frequency, 180 + n * 260); T(this.pbG.gain, lit * (0.12 + n * 0.16) * (0.6 + fr * 0.6));
        T(this.roar.f.frequency, (320 + n * 700) * d); T(this.roar.g.gain, lit * (0.12 + n * 0.3) * (0.7 + rear * 0.5));
        T(this.deep.g.gain, lit * (0.05 + n * 0.08));
        T(this.rasp.f.frequency, 1400 * d); T(this.rasp.g.gain, lit * 0.02);
        // exhaust pops when the throttle comes back (overrun)
        const pop = RJ.clamp((this.thrLast - s.thr) * 6, 0, 1);
        this.popT = Math.max((this.popT || 0) * 0.96, pop);
        T(this.crk.f.frequency, 700); T(this.crk.g.gain, lit * (0.03 + this.popT * 0.4 + (1 - n) * 0.05));
        T(this.wobG.gain, 18);
        zero(this.wg, this.bzG, this.abr.g);
        return;
      }
      if (this.rum.type !== "triangle") this.rum.type = "triangle";
      if (p.kind === "rocket") {
        const on = RJ.clamp(N, 0, 1);
        T(this.roar.f.frequency, (1800 + on * 3600) * d); T(this.roar.g.gain, on * 1.05);
        T(this.rasp.f.frequency, 3000 * d); T(this.rasp.g.gain, on * 0.32);
        T(this.rum.frequency, 30 * d); T(this.rumF.frequency, 120); T(this.rumG.gain, on * 0.22);
        T(this.abr.f.frequency, 900 * d); T(this.abr.g.gain, on * 0.5);
        T(this.crk.f.frequency, 1800); T(this.crk.g.gain, on * 0.3);
        T(this.deep.g.gain, on * 0.2);
        zero(this.wg, this.bzG, this.pbG);
        return;
      }
      const idle = p.idle, n = RJ.clamp((N - idle) / (1 - idle), 0, 1), lit = RJ.clamp(N / idle, 0, 1), ln = Math.pow(n, 0.8);
      // starter whine climbs to idle, then the turbine tone tracks N2
      const wf = (N < idle ? p.whine[0] * (0.12 + 0.88 * lit) : lerp(p.whine[0], p.whine[1], n)) * p.pitch * d;
      T(this.w1.frequency, wf); T(this.w2.frequency, wf * p.partial);
      T(this.wg.gain, lerp(p.wg[0], p.wg[1], n) * Math.min(1, N / 0.06) * (0.6 + fr * 0.8) * (s.interior ? 0.6 : 1));
      T(this.wobG.gain, 7);
      T(this.roar.f.frequency, lerp(p.roarF[0], p.roarF[1], ln) * d);
      T(this.roar.g.gain, lerp(p.roarG[0], p.roarG[1], Math.pow(n, 1.2)) * lit * lit * (0.7 + rear * 0.6));
      T(this.deep.f.frequency, 190 * d); T(this.deep.g.gain, lerp(p.deepG[0], p.deepG[1], n) * lit * (0.8 + rear * 0.4));
      T(this.rasp.f.frequency, lerp(p.rasp[0], p.rasp[1], ln) * d);
      T(this.rasp.g.gain, lerp(p.raspG[0], p.raspG[1], n) * lit * (0.55 + rear * 0.8));
      if (p.buzz) {
        const bf = lerp(p.buzz.f[0], p.buzz.f[1], n) * p.pitch * d;
        T(this.bz1.frequency, bf); T(this.bz2.frequency, bf * 1.007); T(this.bzF.frequency, bf * 6);
        T(this.bzG.gain, RJ.smooth(p.buzz.on, 1, N) * p.buzz.g * (0.45 + fr * 1.0));
      } else T(this.bzG.gain, 0, 0.1);
      T(this.rum.frequency, lerp(p.rum[0], p.rum[1], n) * d); T(this.rumF.frequency, 140);
      T(this.rumG.gain, lerp(p.rumG[0], p.rumG[1], n) * lit * (s.interior ? 1.5 : 1));
      const ab = s.ab;
      T(this.abr.f.frequency, (260 + ab * 950) * d, 0.12); T(this.abr.g.gain, ab * p.abG * (0.65 + rear * 0.7), 0.12);
      T(this.crk.f.frequency, 1300); T(this.crk.g.gain, ab * p.crk * (0.45 + rear * 0.9), 0.1);
      T(this.pbG.gain, 0, 0.1);
    }
    silence() { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12); }
    stop() { try { this.silence(); const o = this.out; setTimeout(() => { try { o.disconnect(); } catch (e) { /* gone */ } }, 600); } catch (e) { /* closed */ } }
  }
  AU.EngineVoice = EngineVoice; // exposed for offline renders and tests

  /* ---------------- buses ---------------- */
  AU.init = function () {
    if (AU.ctx) { if (AU.ctx.state === "suspended") AU.ctx.resume(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      AU.ctx = ctx;
      const B = buffers(ctx);
      AU.white = B.white; AU.brown = B.brown;
      // master → brick-wall limiter → speakers: nothing can clip, however much is going on
      AU.limiter = ctx.createDynamicsCompressor();
      AU.limiter.threshold.value = -2; AU.limiter.knee.value = 0; AU.limiter.ratio.value = 20; AU.limiter.attack.value = 0.002; AU.limiter.release.value = 0.12;
      AU.limiter.connect(ctx.destination);
      AU.master = mkGain(ctx, 1); AU.master.connect(AU.limiter);
      AU.comp = ctx.createDynamicsCompressor(); AU.comp.threshold.value = -14; AU.comp.ratio.value = 4;
      AU.comp.connect(AU.master);
      AU.cabin = mkFilt(ctx, "lowpass", 18000, 0.6);
      AU.duckG = mkGain(ctx, 1);
      AU.engBus = mkGain(ctx, 1); AU.engBus.connect(AU.cabin).connect(AU.duckG).connect(AU.comp);
      AU.otherBus = mkGain(ctx, 1); AU.otherBus.connect(AU.duckG);
      AU.envBus = mkGain(ctx, 1); AU.envBus.connect(AU.comp);
      AU.sfxBus = mkGain(ctx, 1); AU.sfxBus.connect(AU.comp);
      AU.uiBus = mkGain(ctx, 1); AU.uiBus.connect(AU.master);
      AU.voiceBus = mkGain(ctx, 1); AU.voiceBus.connect(AU.master);
      buildEnvironment(ctx, B);
      // gun voice: noise amplitude-modulated at the fire rate
      const gn = loop(ctx, B.white), gf = mkFilt(ctx, "bandpass", 900, 0.7);
      AU.gunAM = mkGain(ctx, 0.5);
      AU.gunOsc = mkOsc(ctx, "square", 100);
      const amDepth = mkGain(ctx, 0.5); AU.gunOsc.connect(amDepth).connect(AU.gunAM.gain);
      AU.gunGain = mkGain(ctx); AU.gunF = gf;
      AU.gunSaw = mkOsc(ctx, "sawtooth", 100);
      const sawG = mkGain(ctx, 0.25); AU.gunSaw.connect(sawG).connect(AU.gunAM);
      gn.connect(gf).connect(AU.gunAM).connect(AU.gunGain).connect(AU.sfxBus);
      // tone voices for lock / warning beeps
      AU.toneOsc = mkOsc(ctx, "sine", 1000); AU.toneGain = mkGain(ctx); AU.toneOsc.connect(AU.toneGain).connect(AU.uiBus);
      AU.warnOsc = mkOsc(ctx, "square", 1100);
      const wlp = mkFilt(ctx, "lowpass", 2500);
      AU.warnGain = mkGain(ctx); AU.warnOsc.connect(wlp).connect(AU.warnGain).connect(AU.uiBus);
      AU.voices = [];
      AU.pool = [0, 1, 2].map(() => ({ v: new EngineVoice(ctx, AU.otherBus), ac: null }));
      AU.applyVolumes();
      RJ.on("settings", AU.applyVolumes);
      RJ.on("thunder", (d) => setTimeout(() => AU.thunder(), d.delay * 1000));
    } catch (e) { console.warn("Audio unavailable", e); AU.ctx = null; }
  };

  /** Wind (two bands), ground roll, cabin and cockpit ambience, stall / overspeed warnings. */
  function buildEnvironment(ctx, B) {
    const E = (AU.env = {});
    const L = (buf, type, f, q, bus = AU.envBus) => { const fl = mkFilt(ctx, type, f, q), g = mkGain(ctx); loop(ctx, buf).connect(fl).connect(g).connect(bus); return { f: fl, g }; };
    E.windLo = L(B.brown, "lowpass", 180, 0.7);
    E.windHi = L(B.white, "bandpass", 900, 0.55);
    E.whistle = L(B.white, "bandpass", 2600, 7);
    E.roll = L(B.brown, "lowpass", 110, 0.8);
    E.cabin = L(B.pink, "lowpass", 360, 0.7);
    E.fans = L(B.white, "bandpass", 3600, 3.5);
    E.hum = mkOsc(ctx, "sine", 400); E.humG = mkGain(ctx); E.hum.connect(E.humG).connect(AU.envBus);
    E.vib = mkOsc(ctx, "sine", 24); E.vibG = mkGain(ctx); E.vib.connect(E.vibG).connect(AU.envBus);
    // stick shaker / overspeed clacker: noise gated by a square LFO
    const shN = loop(ctx, B.brown), shF = mkFilt(ctx, "bandpass", 180, 1.2), shAM = mkGain(ctx, 0);
    E.shLfo = mkOsc(ctx, "square", 17); const shDepth = mkGain(ctx, 0.5); E.shLfo.connect(shDepth).connect(shAM.gain);
    E.shF = shF; E.shG = mkGain(ctx); shN.connect(shF).connect(shAM).connect(E.shG).connect(AU.uiBus);
    E.gust = 1; E.gustT = 0;
  }

  AU.applyVolumes = function () {
    if (!AU.ctx) return;
    const s = RJ.settings;
    P(AU.master.gain, s.muted ? 0 : s.master, 0.05);
    P(AU.engBus.gain, s.engineVol, 0.05);
    P(AU.otherBus.gain, s.engineVol, 0.05);
    P(AU.envBus.gain, s.envVol != null ? s.envVol : 0.7, 0.05);
    P(AU.sfxBus.gain, s.sfxVol, 0.05);
    P(AU.uiBus.gain, s.sfxVol * 0.6, 0.05);
    P(AU.voiceBus.gain, s.voiceVol != null ? s.voiceVol : 0.9, 0.05);
  };

  AU.setPlayerEngine = function (spec) {
    if (!AU.ctx) return;
    if (AU.engine) AU.engine.stop();
    AU.engine = new EngineVoice(AU.ctx, AU.engBus);
    AU.engine.prof = profOf(spec);
    AU.engine.fresh = true;
    AU._camP = null; AU._camV = null; // the camera teleports to the new flight: don't hear that as speed
    for (const s of AU.pool) { s.ac = null; s.v.silence(); }
    const g = spec.gun;
    if (g) { AU.gunOsc.frequency.value = g.rate; AU.gunSaw.frequency.value = g.brrt ? 65 : g.rate; AU.gunF.frequency.value = g.brrt ? 450 : spec.id === "p51" ? 700 : 1100; }
  };
  AU.stopEngines = function () {
    if (AU.cancelGreeting) AU.cancelGreeting();
    if (AU.engine) { AU.engine.stop(); AU.engine = null; }
    if (AU.pool) for (const s of AU.pool) { s.ac = null; s.v.silence(); }
    AU.setGun(false); AU.tone(null); AU.warn(null);
    const E = AU.env;
    if (E) for (const k of ["windLo", "windHi", "whistle", "roll", "cabin", "fans"]) P(E[k].g.gain, 0, 0.15);
    if (E) { P(E.humG.gain, 0); P(E.vibG.gain, 0); P(E.shG.gain, 0); }
    if (AU.buffetGain) P(AU.buffetGain.gain, 0);
  };

  /* ---------------- listener geometry ---------------- */
  const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
  function hear(ac, cam, p, out) {
    _v.subVectors(cam.position, ac.pos);
    const d = Math.max(1, _v.length());
    _v.divideScalar(d); // source → listener
    _f.set(0, 0, -1).applyQuaternion(ac.q || ac.mesh.quaternion);
    out.front = (_f.dot(_v) + 1) / 2;
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    out.pan = RJ.clamp(-_v.dot(_r), -0.85, 0.85);
    const ref = 45 * p.size;
    out.gain = 0.9 * p.size * ref / (ref + d);
    // air absorbs the highs first: far aircraft become a deep, distant rumble
    out.air = RJ.clamp(19000 / (1 + d / (420 * p.size)), 260, 18000);
    out.d = d;
    return out;
  }
  const _h = {};

  /** Per-frame: player engine (startup, spool, afterburner), up to three other aircraft with Doppler, environment. */
  AU.update = function (pl, cam, inCockpit, others) {
    if (!AU.ctx || !AU.engine || !pl) return;
    const now = performance.now() / 1000; // game clock: keeps spooling right even if the audio device is slow to start
    const dt = RJ.clamp(now - (AU._t || now), 0, 0.1); AU._t = now;
    // listener velocity (the camera may ride the jet, orbit it, or stand still for a fly-by)
    if (AU._camP) { const cv = _v.subVectors(cam.position, AU._camP).divideScalar(Math.max(dt, 1e-3)); if (cv.length() > 1500) cv.set(0, 0, 0); AU._camV = AU._camV || new THREE.Vector3(); if (dt > 0) AU._camV.lerp(cv, RJ.clamp(dt * 8, 0, 1)); }
    AU._camP = (AU._camP || new THREE.Vector3()).copy(cam.position);
    const camV = AU._camV || _f.set(0, 0, 0);
    const E = AU.engine, p = E.prof;
    if (E.fresh) { E.fresh = false; E.st.N = pl.state === "ground" && pl.speed < 2 ? 0 : null; }
    const thr = pl.alive ? RJ.clamp(pl.throttle, 0, 1) : 0;
    const N = spool(E.st, p, thr, dt, pl.alive);
    if (E.st.lightoff) AU.lightOff(p, inCockpit);
    const ab = pl.alive && p.ab ? pl.abLevel : 0;
    if (ab > 0.25 && E.abLast <= 0.25) AU.abLight(inCockpit);
    E.abLast = ab;
    // parameter writes at ~30 Hz: smooth, and light on the audio thread
    AU._acc = (AU._acc || 0) + dt;
    const write = AU._acc >= 1 / 30;
    if (write) AU._acc = 0;
    if (write) {
      let s;
      if (inCockpit) s = { gain: p.cock[0], air: 18000, front: 0.5, pan: 0 };
      else { hear(pl, cam, p, _h); s = { gain: _h.gain, air: _h.air, front: _h.front, pan: _h.pan }; }
      E.apply(p, Object.assign(s, { N, ab, thr, dop: 1, interior: inCockpit }));
      E.thrLast = thr;
      P(AU.cabin.frequency, inCockpit ? p.cock[1] : 18000, 0.15);
    }
    // other aircraft: the three loudest get a voice; assignments stick to avoid swapping mid-pass
    const cand = [];
    for (const o of others || []) {
      if (o === pl || !o.spec || o.state === "dead" || !o.pos) continue;
      const po = profOf(o.spec), d = o.pos.distanceTo(cam.position);
      if (d > 7000 * po.size) continue;
      cand.push({ o, po, score: po.size / (d + 80) });
    }
    cand.sort((a, b) => b.score - a.score);
    const top = cand.slice(0, 3);
    const want = new Set(top.map((c) => c.o));
    for (const slot of AU.pool) if (slot.ac && !want.has(slot.ac)) { slot.ac = null; slot.v.silence(); }
    for (const c of top) {
      if (AU.pool.some((s) => s.ac === c.o)) continue;
      const free = AU.pool.find((s) => !s.ac);
      if (free) free.ac = c.o;
    }
    for (const slot of AU.pool) {
      const o = slot.ac;
      if (!o) continue;
      const po = profOf(o.spec);
      const st = o._aud || (o._aud = { N: null, dop: 1 });
      const n = spool(st, po, o.alive ? RJ.clamp(o.throttle || 0, 0, 1) : 0, dt, o.alive);
      if (!write) continue;
      hear(o, cam, po, _h);
      // Doppler: f' = f (c + v_listener→source) / (c − v_source→listener)
      const c = RJ.soundSpeed ? RJ.soundSpeed(o.pos.y) : 340;
      const vs = o.vel ? o.vel.dot(_v) : 0;
      const vl = -camV.dot(_v);
      const dop = RJ.clamp((c + vl) / Math.max(40, c - vs), 0.55, 1.9);
      st.dop = lerp(st.dop, dop, RJ.clamp(dt * 30 * 4, 0, 1));
      slot.v.apply(po, { N: n, ab: o.alive && po.ab ? o.abLevel || 0 : 0, thr: o.throttle || 0, gain: _h.gain, air: _h.air, front: _h.front, pan: _h.pan, dop: st.dop, interior: false });
    }
    if (write) environment(pl, inCockpit, camV, p, N);
  };

  function environment(pl, inCockpit, camV, p, N) {
    const E = AU.env;
    if (!E) return;
    // listener airspeed: the jet's when inside it, the camera's otherwise (a fixed fly-by camera hears no wind)
    const v = Math.min(1200, inCockpit ? pl.speed : camV.length());
    const rho = RJ.rho(inCockpit ? pl.pos.y : Math.max(0, AU._camP.y));
    const q = RJ.clamp(0.5 * rho * v * v / 42000, 0, 1.4);
    E.gustT -= 1 / 30;
    if (E.gustT <= 0) { E.gustT = 0.25 + Math.random() * 0.6; E.gustTo = 0.75 + Math.random() * 0.5; }
    E.gust = lerp(E.gust, E.gustTo || 1, 0.08);
    const lo = Math.pow(q, 0.8) * (inCockpit ? 0.32 : 0.45) * E.gust, hi = q * (inCockpit ? 0.1 : 0.3);
    P(E.windLo.g.gain, lo, 0.15); P(E.windLo.f.frequency, 120 + Math.sqrt(q) * 260, 0.2);
    P(E.windHi.g.gain, hi, 0.15); P(E.windHi.f.frequency, 700 + v * 6, 0.2);
    P(E.whistle.g.gain, inCockpit ? 0 : RJ.smooth(0.5, 1.2, q) * 0.025, 0.2); P(E.whistle.f.frequency, 1800 + v * 4, 0.2);
    // tyres on the runway: rumble that builds with speed, plus seams every ~25 m
    const ground = pl.alive && pl.state === "ground";
    const rs = ground ? RJ.clamp(pl.speed / 70, 0, 1) : 0;
    P(E.roll.g.gain, rs * (inCockpit ? 0.4 : 0.22), 0.08); P(E.roll.f.frequency, 70 + pl.speed * 1.4, 0.1);
    if (ground && pl.speed > 4) { AU._seam = (AU._seam || 0) + pl.speed / 30; if (AU._seam > 25) { AU._seam = 0; thump(80, 0.07, 0.05 * rs * (inCockpit ? 1.6 : 1)); } }
    // touchdown chirp
    if (AU._wasAir && ground && pl.alive) { const sink = Math.abs(AU._vy || 0); burst({ f0: 2600, dur: 0.22, gain: RJ.clamp(0.05 + sink * 0.03, 0.05, 0.3), type: "bandpass", q: 2.2, bus: AU.envBus }); thump(60, 0.35, RJ.clamp(0.1 + sink * 0.05, 0.1, 0.5)); }
    AU._wasAir = pl.state === "flying"; AU._vy = pl.vel ? pl.vel.y : 0;
    // inside big aircraft: pressurisation hiss, avionics hum, airframe vibration; small cockpits: avionics fans
    const big = p.id === "airliner" || p.id === "heavy";
    P(E.cabin.g.gain, inCockpit && big ? 0.05 + q * 0.04 : 0, 0.3);
    P(E.humG.gain, inCockpit && big ? 0.0035 : 0, 0.3);
    P(E.vibG.gain, inCockpit && big ? 0.03 + N * 0.05 : 0, 0.3);
    P(E.fans.g.gain, inCockpit ? 0.006 : 0, 0.3);
    // stall: stick shaker in airliners and bombers, chopped tone in fighters; airliner overspeed clacker
    const F = pl.spec.flight, air = pl.alive && pl.state === "flying" && pl.agl > 8;
    const stall = air && pl.speed < F.vstall * 1.08;
    const over = air && big && pl.mach > 0.9;
    if (stall && big) { E.shLfo.frequency.value = 17; E.shF.frequency.value = 160; P(E.shG.gain, 0.32, 0.03); }
    else if (over) { E.shLfo.frequency.value = 7; E.shF.frequency.value = 2400; P(E.shG.gain, 0.08, 0.03); }
    else P(E.shG.gain, 0, 0.05);
    if (stall && !big && Math.floor(performance.now() / 160) % 2 === 0) AU.beep(1500, 0.06, 0.025);
  }

  /** Light-off: the combustor catches with a soft whoomp, then the roar comes up behind the starter whine. */
  AU.lightOff = function (p, inCockpit) {
    const g = (inCockpit ? 0.5 : 0.35) * Math.sqrt(p.size);
    burst({ brown: true, f0: 900, f1: 140, dur: 0.9, gain: g, attack: 0.06, bus: AU.engBus });
    thump(48, 0.6, g * 0.6);
  };
  /** Afterburner light: a deep thud and a tearing rush as the reheat catches. */
  AU.abLight = function (inCockpit) {
    thump(42, 0.55, inCockpit ? 0.45 : 0.35);
    burst({ brown: true, f0: 1400, f1: 200, dur: 0.5, gain: inCockpit ? 0.35 : 0.45, attack: 0.01, bus: AU.engBus });
  };

  AU.setGun = function (on) { if (AU.gunGain) P(AU.gunGain.gain, on ? 0.55 : 0, on ? 0.01 : 0.03); };

  /** Lock tone: null | 'search' | 'locking' | 'locked'. */
  AU.tone = function (mode) {
    if (!AU.ctx) return;
    const t = AU.ctx.currentTime;
    if (mode === AU._tone && mode !== "locking") return;
    AU._tone = mode;
    if (!mode) { P(AU.toneGain.gain, 0, 0.02); return; }
    if (mode === "locked") { AU.toneOsc.frequency.setValueAtTime(1350, t); P(AU.toneGain.gain, 0.09, 0.01); }
    if (mode === "locking") { AU.toneOsc.frequency.setValueAtTime(900, t); P(AU.toneGain.gain, (Math.floor(performance.now() / 90) % 2) * 0.07, 0.005); }
  };
  /** Warning: null | 'lock' (being locked) | 'missile' (inbound). */
  AU.warn = function (mode) {
    if (!AU.ctx) return;
    const ms = performance.now();
    if (!mode) { P(AU.warnGain.gain, 0, 0.02); return; }
    if (mode === "missile") {
      AU.warnOsc.frequency.setValueAtTime(Math.floor(ms / 110) % 2 ? 1300 : 950, AU.ctx.currentTime);
      P(AU.warnGain.gain, 0.06, 0.005);
    } else {
      AU.warnOsc.frequency.setValueAtTime(620, AU.ctx.currentTime);
      P(AU.warnGain.gain, (Math.floor(ms / 330) % 2) * 0.05, 0.005);
    }
  };

  /* ---------------- Free Flight entry sound ----------------
   * A futuristic "systems online" chime and a soft airfield bed; Nova (companion.js) speaks the greeting over it. */
  /** Duck the engines under the voice (0..1) until release(), with smooth ramps. */
  AU.duck = function (level) {
    if (!AU.ctx) return;
    const t = AU.ctx.currentTime, g = AU.duckG.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(level, t, 0.4);
  };
  AU.unduck = function (tc = 1.1) { if (AU.ctx) { const t = AU.ctx.currentTime; AU.duckG.gain.cancelScheduledValues(t); AU.duckG.gain.setTargetAtTime(1, t, tc); } };
  /** "Systems online": a soft rising sweep, a few data blips, then a warm three-note chime with a short tail. */
  function startupSound(t) {
    const ctx = AU.ctx;
    const sw = mkOsc(ctx, "sine", 160), swF = mkFilt(ctx, "lowpass", 1400), swG = mkGain(ctx, 0);
    sw.connect(swF).connect(swG).connect(AU.voiceBus);
    sw.frequency.setValueAtTime(160, t); sw.frequency.exponentialRampToValueAtTime(880, t + 0.85);
    swG.gain.setValueAtTime(0.0001, t); swG.gain.exponentialRampToValueAtTime(0.07, t + 0.5); swG.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    sw.stop(t + 1.05);
    [2400, 3200, 2800, 3600].forEach((f, i) => {
      const o = mkOsc(ctx, "sine", f), g = mkGain(ctx, 0), s0 = t + 0.5 + i * 0.07;
      o.connect(g).connect(AU.voiceBus);
      g.gain.setValueAtTime(0.0001, s0); g.gain.exponentialRampToValueAtTime(0.025, s0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.05);
      o.stop(s0 + 0.06);
    });
    const dl = ctx.createDelay(1), fb = mkGain(ctx, 0.3), lp = mkFilt(ctx, "lowpass", 2600), wet = mkGain(ctx, 0.35);
    dl.delayTime.value = 0.23; dl.connect(lp).connect(fb).connect(dl); lp.connect(wet).connect(AU.voiceBus);
    [[440, 0], [659.3, 0.09], [987.8, 0.18]].forEach(([f, o]) => {
      const c = mkOsc(ctx, "sine", f), m = mkOsc(ctx, "sine", f * 2.01), mi = mkGain(ctx, 0), g = mkGain(ctx, 0);
      m.connect(mi).connect(c.frequency); c.connect(g); g.connect(AU.voiceBus); g.connect(dl);
      const s0 = t + 0.85 + o;
      mi.gain.setValueAtTime(f * 0.5, s0); mi.gain.exponentialRampToValueAtTime(1, s0 + 0.9);
      g.gain.setValueAtTime(0.0001, s0); g.gain.exponentialRampToValueAtTime(0.08, s0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s0 + 1.5);
      c.stop(s0 + 1.6); m.stop(s0 + 1.6);
    });
  }
  function ambienceBed(t, hold) {
    const ctx = AU.ctx, B = buffers(ctx), bed = mkGain(ctx, 0);
    bed.connect(AU.voiceBus);
    const a = loop(ctx, B.pink), af = mkFilt(ctx, "lowpass", 420); a.connect(af).connect(bed);
    const r = loop(ctx, B.brown), rf = mkFilt(ctx, "lowpass", 90), rg = mkGain(ctx, 0.7); r.connect(rf).connect(rg).connect(bed);
    const w = mkOsc(ctx, "sine", 3650), wg = mkGain(ctx, 0.012); w.connect(wg).connect(bed); // a distant turbine idling on the ramp
    bed.gain.setValueAtTime(0.0001, t); bed.gain.exponentialRampToValueAtTime(0.14, t + 1.2);
    bed.gain.setValueAtTime(0.14, t + hold); bed.gain.exponentialRampToValueAtTime(0.0001, t + hold + 2.5);
    const end = t + hold + 2.7; [a, r].forEach((x) => x.stop(end)); w.stop(end);
  }
  /** Leaving the flight: make sure nothing stays ducked. */
  AU.cancelGreeting = function () { AU.unduck(0.3); };
  /** Free Flight entry: the systems-online chime (Nova greets over it). */
  AU.welcome = async function (kind) {
    if (!AU.ctx || kind !== "free" || RJ.settings.muted) return;
    if (AU.ctx.state === "suspended") await AU.ctx.resume();
    const t = AU.ctx.currentTime + 0.25;
    startupSound(t);
    ambienceBed(t, 9.5);
  };

  function burst(opts) {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource(); src.buffer = opts.brown ? AU.brown : AU.white;
    const f = ctx.createBiquadFilter(); f.type = opts.type || "lowpass";
    f.frequency.setValueAtTime(opts.f0, t); if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    if (opts.q) f.Q.value = opts.q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(opts.bus || AU.sfxBus);
    src.start(t, Math.random()); src.stop(t + opts.dur + 0.05);
  }
  function thump(freq, dur, gain, delay = 0) {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(AU.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  const distGain = (d) => 1 / (1 + d / 350);

  AU.explosion = (dist = 0, big = 1) => {
    const g = distGain(dist) * big, delay = Math.min(2.5, dist / 340);
    burst({ brown: true, f0: 1200, f1: 60, dur: 1.6 * Math.sqrt(big), gain: Math.min(1.2, 0.9 * g), delay });
    thump(70, 0.9, Math.min(0.9, 0.7 * g), delay);
  };
  AU.missileLaunch = () => { burst({ f0: 3500, f1: 400, dur: 2.2, gain: 0.45, attack: 0.02 }); burst({ brown: true, f0: 600, f1: 120, dur: 1.5, gain: 0.5 }); };
  AU.flare = () => { burst({ f0: 2500, f1: 800, dur: 0.25, gain: 0.25, type: "bandpass", q: 1 }); };
  AU.hit = () => { burst({ f0: 2200, dur: 0.12, gain: 0.35, type: "bandpass", q: 3 }); thump(140, 0.15, 0.3); };
  AU.hitMarker = () => { burst({ f0: 4200, dur: 0.05, gain: 0.12, type: "bandpass", q: 6, bus: AU.uiBus }); };
  /** Sonic boom: N-wave double crack, sub-bass punch, rolling rumble and terrain echoes. */
  AU.sonicBoom = (dist = 0, cockpit = false, big = 1) => {
    if (!AU.ctx) return;
    const g = Math.min(1.3, (1 / (1 + dist / 900)) * big);
    const delay = Math.min(3, dist / 340);
    if (cockpit) {
      // inside the jet you hear the pressure wave detach as a muffled thud and an air rush
      thump(48, 0.7, 0.8 * g, delay);
      burst({ brown: true, f0: 700, f1: 120, dur: 1.4, gain: 0.55 * g, delay, attack: 0.03 });
      burst({ f0: 2600, f1: 500, dur: 0.9, gain: 0.25 * g, delay, type: "bandpass", q: 0.6 });
      return;
    }
    burst({ f0: 3800, f1: 900, dur: 0.18, gain: 0.95 * g, delay, attack: 0.002 });
    burst({ f0: 3200, f1: 800, dur: 0.18, gain: 0.85 * g, delay: delay + 0.12, attack: 0.002 });
    thump(58, 0.9, 1.0 * g, delay); thump(46, 1.1, 0.85 * g, delay + 0.12);
    burst({ brown: true, f0: 600, f1: 60, dur: 3.2, gain: 0.75 * g, delay: delay + 0.05, attack: 0.04 });
    // echoes off the mountains
    burst({ brown: true, f0: 400, f1: 70, dur: 1.6, gain: 0.32 * g, delay: delay + 0.85, attack: 0.05 });
    burst({ brown: true, f0: 300, f1: 60, dur: 1.8, gain: 0.18 * g, delay: delay + 1.9, attack: 0.08 });
  };
  /** Continuous transonic buffet rumble (0..1). */
  AU.buffet = (level) => {
    if (!AU.ctx) return;
    if (!AU.buffetGain) {
      const n = loop(AU.ctx, AU.brown), f = AU.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 140;
      AU.buffetGain = AU.ctx.createGain(); AU.buffetGain.gain.value = 0;
      n.connect(f).connect(AU.buffetGain).connect(AU.envBus);
    }
    P(AU.buffetGain.gain, RJ.clamp(level, 0, 1) * 0.9, 0.08);
  };
  AU.ring = () => {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(990, t + 0.08);
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(AU.uiBus); o.start(t); o.stop(t + 0.4);
  };
  /** Bright three-note chime for a landmark discovery. */
  AU.discover = function () { [0, 0.12, 0.26].forEach((t, i) => setTimeout(() => AU.beep && AU.beep([660, 880, 1320][i], 0.22, 0.08), t * 1000)); };
  AU.click = () => {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = 1800; g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(AU.uiBus); o.start(t); o.stop(t + 0.05);
  };
  AU.thunder = () => { burst({ brown: true, f0: 400, f1: 50, dur: 3.5, gain: 0.8, attack: 0.15 }); thump(45, 2.5, 0.4, 0.1); };
  AU.splash = (dist = 0) => burst({ f0: 1800, f1: 300, dur: 1.2, gain: 0.6 * distGain(dist) });
  AU.bombWhistle = () => {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(350, t + 1.2);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(AU.sfxBus); o.start(t); o.stop(t + 1.25);
  };
  AU.beep = (f = 880, d = 0.08, gain = 0.06) => {
    if (!AU.ctx) return;
    const ctx = AU.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(AU.uiBus); o.start(t); o.stop(t + d + 0.02);
  };
})(window.RJ);
