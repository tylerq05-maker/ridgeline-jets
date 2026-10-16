/* Ridgeline Jets — synthesized audio: engines per aircraft type, wind, guns, missiles, warnings, explosions. */
(function (RJ) {
  "use strict";
  const AU = { ctx: null };
  RJ.audio = AU;

  function noiseBuffer(ctx, sec, brown) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function loopNoise(brown) {
    const s = AU.ctx.createBufferSource(); s.buffer = brown ? AU.brown : AU.white; s.loop = true;
    s.start(0, Math.random() * 1.5); return s;
  }
  const P = (param, v, t = 0.08) => { if (AU.ctx) param.setTargetAtTime(v, AU.ctx.currentTime, t); };

  AU.init = function () {
    if (AU.ctx) { if (AU.ctx.state === "suspended") AU.ctx.resume(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      AU.ctx = ctx;
      AU.white = noiseBuffer(ctx, 2, false); AU.brown = noiseBuffer(ctx, 2, true);
      AU.master = ctx.createGain(); AU.master.connect(ctx.destination);
      AU.comp = ctx.createDynamicsCompressor(); AU.comp.threshold.value = -14; AU.comp.ratio.value = 4;
      AU.comp.connect(AU.master);
      AU.cabin = ctx.createBiquadFilter(); AU.cabin.type = "lowpass"; AU.cabin.frequency.value = 18000;
      AU.engBus = ctx.createGain(); AU.engBus.connect(AU.cabin); AU.cabin.connect(AU.comp);
      AU.sfxBus = ctx.createGain(); AU.sfxBus.connect(AU.comp);
      AU.uiBus = ctx.createGain(); AU.uiBus.connect(AU.master);
      // wind
      const wn = loopNoise(false), wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 700; wf.Q.value = 0.5;
      AU.windGain = ctx.createGain(); AU.windGain.gain.value = 0; AU.windF = wf;
      wn.connect(wf).connect(AU.windGain).connect(AU.engBus);
      // gun voice: noise amplitude-modulated at the fire rate
      const gn = loopNoise(false), gf = ctx.createBiquadFilter(); gf.type = "bandpass"; gf.frequency.value = 900; gf.Q.value = 0.7;
      AU.gunAM = ctx.createGain(); AU.gunAM.gain.value = 0.5;
      AU.gunOsc = ctx.createOscillator(); AU.gunOsc.type = "square"; AU.gunOsc.frequency.value = 100;
      const amDepth = ctx.createGain(); amDepth.gain.value = 0.5; AU.gunOsc.connect(amDepth).connect(AU.gunAM.gain); AU.gunOsc.start();
      AU.gunGain = ctx.createGain(); AU.gunGain.gain.value = 0; AU.gunF = gf;
      const gunSaw = ctx.createOscillator(); gunSaw.type = "sawtooth"; gunSaw.frequency.value = 100; gunSaw.start(); AU.gunSaw = gunSaw;
      const sawG = ctx.createGain(); sawG.gain.value = 0.25; gunSaw.connect(sawG).connect(AU.gunAM);
      gn.connect(gf).connect(AU.gunAM).connect(AU.gunGain).connect(AU.sfxBus);
      // tone voice for lock / warning beeps
      AU.toneOsc = ctx.createOscillator(); AU.toneOsc.type = "sine"; AU.toneOsc.frequency.value = 1000; AU.toneOsc.start();
      AU.toneGain = ctx.createGain(); AU.toneGain.gain.value = 0; AU.toneOsc.connect(AU.toneGain).connect(AU.uiBus);
      AU.warnOsc = ctx.createOscillator(); AU.warnOsc.type = "square"; AU.warnOsc.frequency.value = 1100; AU.warnOsc.start();
      const wlp = ctx.createBiquadFilter(); wlp.type = "lowpass"; wlp.frequency.value = 2500;
      AU.warnGain = ctx.createGain(); AU.warnGain.gain.value = 0; AU.warnOsc.connect(wlp).connect(AU.warnGain).connect(AU.uiBus);
      AU.voices = [];
      AU.applyVolumes();
      RJ.on("settings", AU.applyVolumes);
      RJ.on("thunder", (d) => setTimeout(() => AU.thunder(), d.delay * 1000));
    } catch (e) { console.warn("Audio unavailable", e); AU.ctx = null; }
  };

  AU.applyVolumes = function () {
    if (!AU.ctx) return;
    const s = RJ.settings;
    P(AU.master.gain, s.muted ? 0 : s.master, 0.05);
    P(AU.engBus.gain, s.engineVol, 0.05);
    P(AU.sfxBus.gain, s.sfxVol, 0.05);
    P(AU.uiBus.gain, s.sfxVol * 0.6, 0.05);
  };

  /* ---------------- Engine voices ---------------- */
  class EngineVoice {
    constructor(type, pitch, bus) {
      const ctx = AU.ctx;
      this.type = type; this.pitch = pitch || 1;
      this.out = ctx.createGain(); this.out.gain.value = 0;
      this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (this.pan) this.out.connect(this.pan).connect(bus || AU.engBus); else this.out.connect(bus || AU.engBus);
      // roar
      this.roarF = ctx.createBiquadFilter(); this.roarF.type = "lowpass"; this.roarF.frequency.value = 400;
      this.roarG = ctx.createGain(); this.roarG.gain.value = 0.5;
      loopNoise(true).connect(this.roarF).connect(this.roarG).connect(this.out);
      // hiss / whine band
      this.hissF = ctx.createBiquadFilter(); this.hissF.type = "bandpass"; this.hissF.frequency.value = 2400; this.hissF.Q.value = 1.2;
      this.hissG = ctx.createGain(); this.hissG.gain.value = 0.05;
      loopNoise(false).connect(this.hissF).connect(this.hissG).connect(this.out);
      // tonal whine
      this.whine = ctx.createOscillator(); this.whine.type = type === "fan" ? "sine" : "triangle"; this.whine.frequency.value = 900;
      this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
      this.whine.connect(this.whineG).connect(this.out); this.whine.start();
      // rumble / prop note
      this.rum = ctx.createOscillator(); this.rum.type = "sawtooth"; this.rum.frequency.value = 50;
      this.rumF = ctx.createBiquadFilter(); this.rumF.type = "lowpass"; this.rumF.frequency.value = type === "prop" ? 900 : 160;
      this.rumG = ctx.createGain(); this.rumG.gain.value = 0;
      this.rum.connect(this.rumF).connect(this.rumG).connect(this.out); this.rum.start();
      if (type === "prop") {
        this.shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
        this.shaper.curve = curve;
        this.rum.disconnect(); this.rum.connect(this.shaper).connect(this.rumF);
      }
      // afterburner roar
      this.abF = ctx.createBiquadFilter(); this.abF.type = "lowpass"; this.abF.frequency.value = 600;
      this.abG = ctx.createGain(); this.abG.gain.value = 0;
      loopNoise(true).connect(this.abF).connect(this.abG).connect(this.out);
    }
    set(rpm, ab, gain, doppler = 1, pan = 0) {
      const p = this.pitch * doppler, t = this.type;
      P(this.out.gain, gain, 0.06);
      if (this.pan) P(this.pan.pan, pan, 0.05);
      if (t === "prop") {
        P(this.rum.frequency, (38 + rpm * 70) * p);
        P(this.rumG.gain, 0.22 + rpm * 0.18);
        P(this.roarF.frequency, 300 + rpm * 500); P(this.roarG.gain, 0.25 + rpm * 0.2);
        P(this.whineG.gain, 0); P(this.hissG.gain, 0.02);
        P(this.abG.gain, 0);
      } else if (t === "rocket") {
        P(this.roarF.frequency, (1800 + rpm * 3500) * p); P(this.roarG.gain, rpm * 1.1);
        P(this.hissF.frequency, 3000 * p); P(this.hissG.gain, rpm * 0.35);
        P(this.rum.frequency, 34 * p); P(this.rumG.gain, rpm * 0.25);
        P(this.whineG.gain, 0); P(this.abG.gain, rpm * 0.5); P(this.abF.frequency, 900);
      } else {
        const heavy = t === "heavy", fan = t === "fan";
        P(this.roarF.frequency, (heavy ? 220 : 300) + rpm * (heavy ? 500 : 900) * p);
        P(this.roarG.gain, (heavy ? 0.55 : 0.4) + rpm * 0.35);
        P(this.hissF.frequency, (fan ? 3200 : 2200 + rpm * 1600) * p);
        P(this.hissG.gain, (fan ? 0.14 : 0.05) + rpm * 0.08);
        P(this.whine.frequency, ((fan ? 2600 : heavy ? 700 : 1100) + rpm * (fan ? 1600 : 1400)) * p);
        P(this.whineG.gain, (fan ? 0.05 : 0.018) * (0.4 + rpm));
        P(this.rum.frequency, (38 + rpm * 30) * p); P(this.rumG.gain, (heavy ? 0.16 : 0.07) + rpm * 0.05);
        P(this.abF.frequency, 350 + ab * 900); P(this.abG.gain, ab * 0.9);
      }
    }
    stop() { try { this.out.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.05); const o = this.out; setTimeout(() => o.disconnect(), 400); } catch (e) { /* closed */ } }
  }

  AU.setPlayerEngine = function (spec) {
    if (!AU.ctx) return;
    if (AU.engine) AU.engine.stop();
    AU.engine = new EngineVoice(spec.sound.type, spec.sound.pitch);
    if (!AU.other) AU.other = new EngineVoice("jet", 0.95, AU.sfxBus);
    const g = spec.gun;
    if (g) { AU.gunOsc.frequency.value = g.rate / (g.brrt ? 1 : 1); AU.gunSaw.frequency.value = g.brrt ? 65 : g.rate; AU.gunF.frequency.value = g.brrt ? 450 : spec.id === "p51" ? 700 : 1100; }
  };
  AU.stopEngines = function () {
    if (AU.engine) { AU.engine.stop(); AU.engine = null; }
    if (AU.other) AU.other.set(0, 0, 0);
    AU.setGun(false); AU.tone(null); AU.warn(null);
    if (AU.windGain) P(AU.windGain.gain, 0);
    if (AU.buffetGain) P(AU.buffetGain.gain, 0);
  };

  /** Per-frame: player engine, wind, cockpit muffling, nearest other aircraft. */
  AU.update = function (pl, cam, inCockpit, others) {
    if (!AU.ctx || !AU.engine || !pl) return;
    const alive = pl.alive;
    const rpm = alive ? RJ.clamp(pl.throttle, 0, 1) : 0;
    AU.engine.set(rpm, alive ? pl.abLevel : 0, alive ? (inCockpit ? 0.85 : 0.6) : 0);
    P(AU.cabin.frequency, inCockpit ? 1400 : 18000, 0.15);
    const sp = pl.speed;
    P(AU.windGain.gain, RJ.clamp(Math.pow(sp / 320, 2) * (inCockpit ? 0.35 : 0.5) * Math.sqrt(RJ.rho(pl.pos.y)), 0, 0.7));
    P(AU.windF.frequency, 500 + sp * 2);
    // nearest other aircraft fly-by with doppler
    let best = null, bd = 1e9;
    for (const o of others || []) { if (o === pl || !o.alive) continue; const d = o.pos.distanceTo(cam.position); if (d < bd) { bd = d; best = o; } }
    if (best && bd < 2500) {
      const toCam = cam.position.clone().sub(best.pos).normalize();
      const relV = best.vel.dot(toCam) - (pl.vel ? pl.vel.dot(toCam) : 0);
      const dop = RJ.clamp(340 / Math.max(80, 340 - relV), 0.6, 1.8);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      AU.other.set(best.throttle, best.abLevel, RJ.clamp(220 / (bd + 60), 0, 0.8), dop, RJ.clamp(-toCam.dot(right), -0.8, 0.8));
    } else if (AU.other) AU.other.set(0, 0, 0);
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
      const n = loopNoise(true), f = AU.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 140;
      AU.buffetGain = AU.ctx.createGain(); AU.buffetGain.gain.value = 0;
      n.connect(f).connect(AU.buffetGain).connect(AU.engBus);
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
