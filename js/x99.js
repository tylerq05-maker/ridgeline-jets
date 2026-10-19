/* Jet City — X-99 Phantom (fictional): its own propulsion model, abilities, weapons and HUD.
 * Speed: throttle sets a cruise target up to 670 m/s (1,500 mph), afterburner 983 m/s (2,200 mph), HYPERBOOST (H)
 * 1,118 m/s (2,500 mph). Acceleration is strong but finite (~0 → 1,500 mph in about 25 s); climbing costs speed.
 * Abilities: Hyperboost (energy drains while it runs, recharges after), Vector-dodge (Alt, or double-tap a rudder key:
 * a sideways jink with an aileron roll that can break missile locks), Phantom lock (the Specter seeker locks up to four
 * targets in a wide cone, one after another, and fires a salvo at all of them).
 * Weapons (Z cycles, X fires): Specter smart missiles · Pulse energy missiles (no lock time, energy cost) · Nova strike
 * (hold X to charge, 3 charges that recharge). Guns fire the Phantom burst cannon (spec.gun, laser rounds). */
(function (RJ) {
  "use strict";
  const X = (RJ.x99 = {});
  const MPH = 0.44704, V_CRUISE = 1500 * MPH, V_AB = 2200 * MPH, V_HYPER = 2500 * MPH;
  const WEAPONS = ["SPECTER", "PULSE", "NOVA"];
  X.WEAPONS = WEAPONS;
  const st = (ac) => ac.x9 || (ac.x9 = { w: 0, energy: 1, hyper: false, hyperK: 0, dodgeCd: 0, dodge: null, nova: 3, novaT: 0, charge: 0, locks: [], lockT: 0, salvo: [], salvoT: 0, tapT: { "-1": -9, "1": -9 }, lastYaw: 0, bay: 0, t: 0 });
  X.state = st;

  /* ---------------- propulsion (called by flight.js instead of the shared thrust/drag) ---------------- */
  X.speedStep = function (ac, dt) {
    const S = st(ac), v = ac.speed, thr = RJ.clamp(ac.throttle, 0, 1);
    const ab = ac.abLevel || 0, hy = S.hyperK;
    // target: idle 140 m/s … cruise at full military power, afterburner and hyperboost above that
    let target = RJ.lerp(140, V_CRUISE, thr);
    target = RJ.lerp(target, V_AB, ab);
    target = RJ.lerp(target, V_HYPER * 1.06, hy);
    // thick low air costs a little; thin high air lets it run right up to the limit
    target *= RJ.lerp(0.95, 1.0, RJ.smooth(0, 6000, ac.pos.y));
    const accMax = 38 + ab * 34 + hy * 70; // m/s²: a strong push, never a teleport
    let dv = target - v;
    dv = dv > 0 ? Math.min(dv * 0.9, accMax) : Math.max(dv * 0.35, -45 - (ac.input.brake ? 80 : 0));
    // gravity along the flight path, and turning bleeds energy (less with thrust vectoring)
    const gLoad = Math.abs(ac.g || 1);
    return Math.min(V_HYPER, v + (dv - RJ.G0 * ac.fwd.y - Math.max(0, gLoad - 2) * 1.6) * dt); // 2,500 mph hard limit
  };

  /* ---------------- sounds (synthesised; the jet's own engine voice rises with speed already) ---------------- */
  function tone(f0, f1, dur, gain, type = "sawtooth", delay = 0) {
    const AU = RJ.audio, ctx = AU && AU.ctx; if (!ctx || RJ.settings.muted) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.type = "lowpass"; f.frequency.value = 5000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * (RJ.settings.sfxVol || 0.8), t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(AU.envBus || ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const SND = {
    hyper: () => { tone(90, 900, 1.6, 0.35); tone(45, 180, 1.8, 0.4, "sine"); if (RJ.audio.abLight) RJ.audio.abLight(false); },
    specter: () => { tone(1800, 300, 0.35, 0.18, "square"); tone(220, 60, 0.9, 0.3, "sawtooth", 0.03); },
    pulse: () => { tone(2400, 500, 0.22, 0.22, "sine"); tone(1200, 3000, 0.12, 0.08, "square"); },
    nova: () => { tone(60, 30, 1.4, 0.5, "sawtooth"); tone(1600, 120, 1.0, 0.3, "sine"); },
    charge: (k) => tone(200 + k * 900, 260 + k * 1000, 0.12, 0.06 + k * 0.08, "triangle"),
    dodge: () => { tone(300, 1400, 0.25, 0.18, "sawtooth"); },
    lock: () => tone(2200, 2200, 0.07, 0.12, "square"),
    deny: () => tone(240, 200, 0.15, 0.12, "square")
  };

  /* ---------------- weapons ---------------- */
  const C = () => RJ.combat;
  function launch(ac, target, type, tune) {
    ac._mslType = type; ac._mslTune = tune;
    const ok = C().launchMissile(ac, target);
    ac._mslType = null; ac._mslTune = null;
    if (ok && !(RJ.game.mode && RJ.game.mode.infMsl)) ac.missiles = Math.max(0, ac.missiles - 1);
    if (ok) { ac.stats.msl++; st(ac).bay = 1; }
    return ok;
  }
  const tuneSpecter = (m) => { m.top = 1700; m.burn = 6.5; m.life = 22; m.dmg = 110; m.gLimit = 46; };
  const tunePulse = (m) => { m.top = 2600; m.speed = Math.max(m.speed, 900); m.vel.setLength(m.speed); m.burn = 4; m.life = 9; m.dmg = 70; m.gLimit = 60; m.ign = 0; };
  const tuneNova = (k) => (m) => { m.top = 1400; m.burn = 8; m.life = 20; m.dmg = 220 + 160 * k; m.gLimit = 24; m.splash = 300 + 300 * k; m.boom = 3 + 2 * k; m.ign = 0; };
  /** Targets the Specter seeker can see: inside the cone and range, nearest the nose first. */
  function seekerTargets(ac) {
    const m = ac.spec.msl, out = [];
    for (const e of C().enemiesOf(ac, true)) {
      const d = e.pos.clone().sub(ac.pos), dist = d.length();
      if (dist > m.range || dist < 150) continue;
      const ang = Math.acos(RJ.clamp(d.dot(ac.fwd) / dist, -1, 1)) / RJ.DEG;
      if (ang < m.cone) out.push({ e, s: ang * 120 + dist * 0.01 });
    }
    return out.sort((a, b) => a.s - b.s).map((o) => o.e);
  }
  /** X pressed (or released after charging Nova). Returns true if something launched. */
  X.fire = function (ac, released) {
    const S = st(ac), w = WEAPONS[S.w];
    if (ac.missiles <= 0) { RJ.ui.flash("WINCHESTER", "Out of missiles", 1); return false; }
    if (w === "SPECTER") {
      const locked = S.locks.filter((t) => t.alive);
      if (!locked.length) { SND.deny(); RJ.ui.flash("NO PHANTOM LOCK", "Keep targets in front of you for a moment", 0.9); return false; }
      // the salvo leaves the bays one after another, a beat apart
      S.salvo = locked.slice(0, 4); S.salvoT = 0; S.locks = []; S.lockT = 0;
      return true;
    }
    if (w === "PULSE") {
      if (S.energy < 0.12) { SND.deny(); RJ.ui.flash("ENERGY LOW", null, 0.8); return false; }
      const t = seekerTargets(ac).find((e) => { const d = e.pos.clone().sub(ac.pos); return d.angleTo(ac.fwd) < 35 * RJ.DEG; });
      if (!t) { SND.deny(); RJ.ui.flash("NO TARGET AHEAD", "Pulse needs a target within 35° of the nose", 0.9); return false; }
      if (launch(ac, t, "pulse", tunePulse)) { S.energy -= 0.12; SND.pulse(); return true; }
      return false;
    }
    if (w === "NOVA") {
      if (!released) return false;
      const k = S.charge; S.charge = 0; S.charging = false;
      if (S.nova < 1) { SND.deny(); RJ.ui.flash("NOVA RECHARGING", null, 0.9); return false; }
      if (k < 0.35) { SND.deny(); RJ.ui.flash("HOLD TO CHARGE NOVA", null, 0.9); return false; }
      const t = seekerTargets(ac)[0] || ac.target;
      if (!t || !t.alive) { SND.deny(); RJ.ui.flash("NO TARGET", null, 0.9); return false; }
      if (launch(ac, t, "nova", tuneNova(k))) { S.nova -= 1; SND.nova(); RJ.ui.flash("NOVA STRIKE", null, 0.9); return true; }
    }
    return false;
  };

  /* ---------------- per frame (player) ---------------- */
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  X.update = function (ac, dt, I) {
    if (!ac.spec.x99 || !ac.alive) return;
    const S = st(ac); S.t += dt;
    // weapon select
    if (I.action("weapon")) { S.w = (S.w + 1) % WEAPONS.length; S.locks = []; S.lockT = 0; S.charge = 0; RJ.ui.flash(WEAPONS[S.w], S.w === 0 ? "Phantom lock: up to 4 targets" : S.w === 1 ? "Energy missile · no lock time" : "Hold X to charge", 0.9); RJ.audio.beep && RJ.audio.beep(900, 0.05); }
    // hyperboost: H toggles; drains energy, recharges after
    if (I.action("hyper")) {
      if (S.hyper) S.hyper = false;
      else if (S.energy > 0.2) { S.hyper = true; SND.hyper(); RJ.ui.flash("HYPERBOOST", null, 0.8); if (RJ.view && RJ.view.cam && RJ.view.cam.kick) RJ.view.cam.kick(0.6); }
      else { SND.deny(); RJ.ui.flash("ENERGY LOW", "Hyperboost recharging", 0.8); }
    }
    if (S.hyper) { S.energy -= dt / 9; if (S.energy <= 0) { S.energy = 0; S.hyper = false; RJ.ui.flash("HYPERBOOST DEPLETED", null, 0.8); } }
    else S.energy = Math.min(1, S.energy + dt / 16);
    S.hyperK = RJ.damp(S.hyperK, S.hyper ? 1 : 0, S.hyper ? 1.4 : 0.8, dt);
    ac.x99Hyper = S.hyperK; ac.hyperK = S.hyperK * 0.6; // plumes, light and camera motion key off these
    // Nova: hold X to charge (the charge ends when X is released: main.js calls fire(ac, true))
    if (S.nova < 3) { S.novaT += dt; if (S.novaT > 25) { S.nova++; S.novaT = 0; } } else S.novaT = 0;
    if (S.charging && !I.held("missile")) X.fire(ac, true); // released: the Nova goes
    if (WEAPONS[S.w] === "NOVA" && I.held("missile") && S.nova >= 1) { S.charging = true; const k0 = S.charge; S.charge = Math.min(1, S.charge + dt / 1.6); if (Math.floor(k0 * 8) !== Math.floor(S.charge * 8)) SND.charge(S.charge); }
    // Specter salvo in flight: one missile every 0.18 s
    if (S.salvo.length) { S.salvoT -= dt; if (S.salvoT <= 0) { const t = S.salvo.shift(); if (t && t.alive && launch(ac, t, "specter", tuneSpecter)) SND.specter(); S.salvoT = 0.18; } }
    // Phantom lock: with Specter selected, the seeker walks across the cone locking up to four targets
    if (WEAPONS[S.w] === "SPECTER") {
      const vis = seekerTargets(ac);
      S.locks = S.locks.filter((t) => t.alive && vis.includes(t));
      const next = vis.find((t) => !S.locks.includes(t));
      if (next && S.locks.length < 4) { S.lockT += dt; S.acq = next; if (S.lockT > ac.spec.msl.lock) { S.locks.push(next); S.lockT = 0; SND.lock(); next.lockedByT = Math.max(next.lockedByT || 0, 0.5); } }
      else { S.lockT = 0; S.acq = null; }
      ac.locked = S.locks.length > 0; ac.lockT = ac.locked ? 1 : S.lockT / ac.spec.msl.lock;
      if (S.locks[0]) ac.target = S.locks[0];
    }
    // vector-dodge: Alt, or a double tap on either rudder key
    const yaw = Math.sign(Math.round(ac.input.yaw || 0));
    if (yaw && yaw !== S.lastYaw) { if (S.t - S.tapT[yaw] < 0.32) X.dodge(ac, yaw); S.tapT[yaw] = S.t; }
    S.lastYaw = yaw;
    if (I.action("dodge")) X.dodge(ac, (ac.input.roll || ac.input.yaw) < 0 ? -1 : 1);
    S.dodgeCd = Math.max(0, S.dodgeCd - dt);
    if (S.dodge) {
      const D = S.dodge; D.t += dt;
      const k = Math.max(0, 1 - D.t / 0.55);
      ac.pos.addScaledVector(ac.right, D.dir * 260 * k * dt); // a sharp sideways jink …
      _q.setFromAxisAngle(_v.set(0, 0, -1), D.dir * (Math.PI * 2 / 0.55) * dt); ac.q.multiply(_q); // … with a full aileron roll
      if (D.t >= 0.55) S.dodge = null;
    }
    // weapon-bay doors: open while a missile weapon is selected and just fired, then close
    S.bay = Math.max(0, S.bay - dt * 0.8);
    for (const n of ["bayL", "bayR"]) { const d = ac.mesh.getObjectByName(n); if (d) d.rotation.z = (n === "bayL" ? -1 : 1) * Math.min(1, S.bay * 2) * 1.3; }
  };
  X.dodge = function (ac, dir) {
    const S = st(ac);
    if (S.dodgeCd > 0 || S.dodge || !ac.alive) return;
    S.dodge = { t: 0, dir }; S.dodgeCd = 2.4; SND.dodge();
    // a well-timed jink breaks missile guidance
    for (const m of ac.incoming || []) if (m.pos.distanceTo(ac.pos) < 2000 && Math.random() < 0.65) m.lost = true;
    if (RJ.fx) for (let i = 0; i < 2; i++) RJ.fx.vapor(ac.pos, ac.vel, 8, 0.5);
  };

  /* ---------------- HUD (drawn after the main HUD) ---------------- */
  X.hud = function (x, W, H, pl, cam, proj) {
    const S = st(pl), small = W < 600;
    x.save();
    // Phantom lock: rotating cyan diamonds on every locked target, a closing box on the one being acquired
    const CY = "#5fe3ff";
    x.strokeStyle = CY; x.fillStyle = CY; x.lineWidth = 2;
    for (const t of S.locks) {
      const p = proj(t.pos.clone(), cam); if (!p.on) continue;
      const r = 22, a = S.t * 2.2;
      x.save(); x.translate(p.x, p.y); x.rotate(a); x.strokeRect(-r / 1.4, -r / 1.4, r * 1.41, r * 1.41); x.restore();
      x.beginPath(); x.arc(p.x, p.y, r + 8, 0, Math.PI * 2); x.stroke();
      x.font = "bold 11px ui-monospace,monospace"; x.textAlign = "center"; x.fillText("PHANTOM LOCK", p.x, p.y - r - 14);
    }
    if (S.acq && S.lockT > 0) { const p = proj(S.acq.pos.clone(), cam); if (p.on) { const k = 1 - S.lockT / pl.spec.msl.lock, r = 20 + k * 60; x.setLineDash([6, 5]); x.strokeRect(p.x - r, p.y - r, r * 2, r * 2); x.setLineDash([]); } }
    // Nova charge ring at the boresight
    if (S.charge > 0) { const p = proj(pl.pos.clone().addScaledVector(pl.fwd, 800), cam); if (p.on) { x.strokeStyle = "#ffd36a"; x.lineWidth = 4; x.beginPath(); x.arc(p.x, p.y, 40, -Math.PI / 2, -Math.PI / 2 + S.charge * Math.PI * 2); x.stroke(); } }
    // systems panel: weapons, energy, Nova charges, dodge, speed in MPH and Mach
    const bx = 12, by = small ? 56 : 66, bw = small ? 160 : 228; // top left, clear of the radar, gauges and throttle
    x.fillStyle = "rgba(4,10,18,0.55)"; x.fillRect(bx, by, bw, small ? 140 : 176);
    x.strokeStyle = "rgba(95,227,255,0.6)"; x.lineWidth = 1; x.strokeRect(bx, by, bw, small ? 140 : 176);
    x.textAlign = "left"; x.font = `bold ${small ? 11 : 13}px ui-monospace,monospace`; x.fillStyle = CY;
    x.fillText("X-99 PHANTOM", bx + 8, by + 18);
    const mph = Math.round(pl.speed / MPH);
    x.font = `bold ${small ? 16 : 22}px ui-monospace,monospace`; x.fillStyle = S.hyper ? "#ffffff" : CY;
    x.fillText(`${mph.toLocaleString()} MPH`, bx + 8, by + (small ? 40 : 46));
    x.font = `${small ? 11 : 13}px ui-monospace,monospace`; x.fillText(`MACH ${(pl.mach || 0).toFixed(2)}${S.hyper ? "  HYPERBOOST" : ""}`, bx + 8, by + (small ? 56 : 66));
    WEAPONS.forEach((w, i) => {
      const y = by + (small ? 74 : 90) + i * (small ? 14 : 18), sel = i === S.w;
      x.fillStyle = sel ? "#ffffff" : "rgba(160,220,240,0.7)";
      const extra = w === "SPECTER" ? ` ${S.locks.length}/4 LOCK` : w === "PULSE" ? " ENERGY" : ` ${S.nova}/3`;
      x.fillText(`${sel ? "▶" : " "} ${w}${extra}`, bx + 8, y);
    });
    const bar = (y, k, col, label) => { x.fillStyle = "rgba(255,255,255,0.12)"; x.fillRect(bx + 8, y, bw - 16, 7); x.fillStyle = col; x.fillRect(bx + 8, y, (bw - 16) * RJ.clamp(k, 0, 1), 7); x.fillStyle = "rgba(200,240,255,0.8)"; x.font = `${small ? 9 : 10}px ui-monospace,monospace`; x.fillText(label, bx + 8, y - 2); };
    bar(by + (small ? 124 : 156), S.energy, S.energy > 0.2 ? CY : "#ff6a5a", `ENERGY ${Math.round(S.energy * 100)}%  ·  MSL ${pl.missiles}  ·  DODGE ${S.dodgeCd > 0 ? S.dodgeCd.toFixed(1) + "s" : "READY"}`);
    x.restore();
  };
})(window.RJ);
