/* Jet City — advanced maneuvers: Pugachev's Cobra, the Kulbit and thrust-vectored post-stall maneuvering (PSM).
   The flight path stays physical (flight.js keeps integrating speed, gravity and lift); a maneuver takes over the
   load factor and the stick for a few seconds and swings the airframe's nose off the path (mnvP pitch, mnvY yaw,
   applied in syncMesh on top of AoA). Lost lift sags the path, high alpha bleeds speed, and when a maneuver ends
   or is cancelled the nose offset eases back to zero, so there is never a snap or a stuck state. */
(function () {
  "use strict";
  const RJ = window.RJ, DEG = Math.PI / 180, TAU = Math.PI * 2;
  const tq = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  const ease = (x) => { x = RJ.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

  // who can do what: TVC jets get everything; a couple of high-alpha airframes can fly a Cobra on aerodynamics alone
  const COBRA_ONLY = { fa18e: 1, yf23: 1 };
  const NAMES = { cobra: "PUGACHEV'S COBRA", kulbit: "KULBIT" };
  const M = (RJ.mnv = {});

  M.can = (ac, type) => {
    const F = ac.spec.flight;
    if (F.model || F.glider) return false;
    if (F.tvc) return true;
    return type === "cobra" && !!COBRA_ONLY[ac.spec.id];
  };

  /** Try to start a Cobra or Kulbit; explains why not instead of letting the player depart into the ground. */
  M.start = (ac, type) => {
    const F = ac.spec.flight, why = (a, b) => { if (ac.isPlayer) RJ.ui.flash(a, b, 1.1); return false; };
    if (ac.mnv) { M.cancel(ac); return false; } // pressing again bails out into recovery
    if (!M.can(ac, type)) return why(NAMES[type] + " UNAVAILABLE", type === "cobra" ? "Needs thrust vectoring or a high-alpha jet (F-22, Super Hornet, YF-23)" : "Needs thrust vectoring (F-22)");
    if (ac.state !== "flying") return why("AIRBORNE ONLY", null);
    const minAgl = type === "kulbit" ? 400 : 250;
    if (ac.agl < minAgl) return why("TOO LOW", `Climb above ${minAgl} m first`);
    if (ac.speed < F.vstall * 1.45) return why("TOO SLOW", "Build speed before the maneuver");
    if (ac.mach > 0.95) return why("TOO FAST", "Slow below Mach 0.9 or the airframe overstresses");
    if (ac.up.y < 0.2) return why("LEVEL THE WINGS", "Start from roughly upright flight");
    ac.mnv = { type, t: 0, dur: type === "cobra" ? 3.2 : 2.3, v0: ac.speed };
    if (ac.isPlayer) { RJ.ui.flash(NAMES[type], type === "cobra" ? "Nose to the vertical — press again to recover early" : "Full somersault — press again to recover early", 1.4); ac.mnvShake = 0.6; }
    return true;
  };
  M.cancel = (ac) => { if (ac.mnv) { ac.mnv = null; ac.mnvG = null; if (ac.isPlayer) RJ.ui.flash("RECOVER", null, 0.7); } };

  M.togglePSM = (ac) => {
    if (ac.psm) { ac.psm = false; if (ac.isPlayer) RJ.ui.flash("POST-STALL MODE OFF", null, 0.9); return; }
    if (!ac.spec.flight.tvc || ac.spec.flight.model) { if (ac.isPlayer) RJ.ui.flash("POST-STALL: THRUST VECTORING ONLY", "Fly the F-22 for 3D nozzle authority", 1.2); return; }
    if (ac.agl < 300) { if (ac.isPlayer) RJ.ui.flash("TOO LOW FOR POST-STALL", "Climb above 300 m", 1.1); return; }
    ac.psm = true;
    if (ac.isPlayer) RJ.ui.flash("POST-STALL MODE", "Stick points the nose (up to 80°) · rudder yaws it · release to recover", 1.6);
  };

  /** Called by flight.js before the load factor is worked out: overrides stick and lift while maneuvering. */
  M.pre = (ac, dt) => {
    const F = ac.spec.flight, m = ac.mnv, inp = ac.input;
    ac.mnvG = null;
    if (ac.psm && (ac.agl < 150 || ac.state !== "flying")) { ac.psm = false; if (ac.isPlayer) RJ.ui.flash("POST-STALL OFF", "Low altitude — recovering", 1); }
    if (m) {
      if (ac.agl < 120) { M.cancel(ac); return; } // ground rush: give the jet back
      m.t += dt;
      const u = m.t;
      if (m.type === "cobra") {
        // the wing unloads as the nose comes up: little lift, so the path sags under gravity while the jet slides on
        ac.mnvG = u < 0.3 ? null : u < 2.5 ? 0.25 : null;
        inp.ab = inp.ab || u > 2.0; // power up for the recovery
      } else {
        ac.mnvG = u < 0.5 ? 1.6 : 0.3; // a short pop up, then the airframe tumbles over its own flight path
        inp.ab = true;
      }
      if (m.t >= m.dur) { ac.mnv = null; ac.mnvG = null; }
    } else if (ac.psm) {
      // stick and rudder point the nose; the wing only sees a fraction of the input, so the path barely moves
      ac.psmP = inp.pitch; ac.psmY = inp.yaw;
      if (Math.abs(inp.pitch) > 0.4 || Math.abs(inp.yaw) > 0.4) inp.ab = inp.ab || F.ab > 0;
    }
  };

  /** After stick damping: the maneuver owns pitch and rudder (roll is damped, not removed). */
  M.ctl = (ac) => {
    if (ac.mnv) { ac.ctl.pitch = 0; ac.ctl.yaw = 0; ac.ctl.roll *= 0.3; }
    else if (ac.psm) { ac.ctl.pitch *= 0.3; ac.ctl.yaw *= 0.2; }
  };

  /** Called by flight.js after the step: nose offset, energy bleed, thrust pulling the path toward the nose. */
  M.post = (ac, dt) => {
    const F = ac.spec.flight, m = ac.mnv, P0 = ac.mnvP || 0;
    let P = P0, Y = ac.mnvY || 0, bleed = 0;
    if (m) {
      const u = m.t;
      if (m.type === "cobra") {
        // up to ~105° in under a second, hang there, then let the nose fall back through the horizon
        const A = 105 * DEG;
        P = u < 0.9 ? A * ease(u / 0.9) : u < 1.5 ? A + 6 * DEG * Math.sin((u - 0.9) / 0.6 * Math.PI) : A * (1 - ease((u - 1.5) / (m.dur - 1.5)));
        bleed = 0.24 * m.v0 * Math.max(0, Math.sin(P));
      } else {
        // one complete forward somersault: slow start, violent middle, gentle catch at the end
        P = TAU * ease(u / m.dur);
        if (u >= m.dur - 1e-3) P = 0; // 360° is level again: identical attitude, no snap
        bleed = 0.35 * m.v0 * Math.abs(Math.sin(P * 0.5));
      }
      Y = RJ.damp(Y, 0, 4, dt);
      ac.mnvShake = Math.max(ac.mnvShake || 0, 0.25 + 0.25 * Math.abs(Math.sin(P)));
    } else if (ac.psm) {
      const tP = RJ.clamp(ac.psmP || 0, -0.4, 1) * 80 * DEG, tY = -(ac.psmY || 0) * 45 * DEG; // negative = nose right, as with sideslip
      P = RJ.damp(P, tP, 2.2, dt); Y = RJ.damp(Y, tY, 2.4, dt);
      // the vectored thrust drags the flight path slowly round toward the nose
      const pull = 0.16 * ac.throttle * (1 + ac.abLevel * 0.5);
      ac.q.multiply(tq.setFromAxisAngle(AX, Math.sin(P) * pull * dt));
      ac.q.multiply(tq.setFromAxisAngle(AY, Math.sin(Y) * pull * dt));
      ac.q.normalize(); ac.updateBasis();
      bleed = ac.speed * 0.3 * (Math.abs(Math.sin(P)) + Math.abs(Math.sin(Y)) * 0.7);
      ac.mnvShake = Math.max(ac.mnvShake || 0, 0.3 * (Math.abs(Math.sin(P)) + Math.abs(Math.sin(Y))));
    } else {
      // recovery: ease the nose back onto the flight path (shortest way round)
      if (P > Math.PI) P -= TAU;
      P = RJ.damp(P, 0, 3, dt); Y = RJ.damp(Y, 0, 3, dt);
      if (Math.abs(P) < 1e-3) P = 0;
      if (Math.abs(Y) < 1e-3) Y = 0;
    }
    if (bleed > 0) {
      const floor = F.vstall * (ac.psm ? 0.55 : 0.7);
      if (ac.speed > floor) ac.speed = Math.max(floor, ac.speed - bleed * dt);
      ac.vel.copy(ac.fwd).multiplyScalar(ac.speed);
    }
    // nozzles deflect with the nose's pitch rate (TVC jets only)
    const rate = dt > 0 ? (P - P0) / dt : 0;
    ac.tvA = RJ.damp(ac.tvA || 0, F.tvc ? RJ.clamp(-rate * 0.12 - (ac.psm ? Math.sin(P) * 0.25 : 0), -0.35, 0.35) : 0, 8, dt);
    ac.mnvP = P; ac.mnvY = Y;
    ac.mnvShake = Math.max(0, (ac.mnvShake || 0) - dt * 1.5);
    if (Math.abs(ac.tvA) > 1e-3 || ac._tvOn) M.nozzles(ac);
  };

  /** Pitch the exhaust nozzles and plumes by the vectoring angle. */
  M.nozzles = (ac) => {
    const fl = ac.vis && ac.vis.flames;
    if (!fl) return;
    ac._tvOn = Math.abs(ac.tvA) > 1e-3;
    for (const f of fl) for (const o of [f.nozzle, f.lip, f.flame]) {
      if (!o) continue;
      if (o.userData.tv0 == null) o.userData.tv0 = o.rotation.x;
      o.rotation.x = o.userData.tv0 + ac.tvA;
    }
  };

  /** Offsets the drawn airframe from the flight path (called from syncMesh). */
  M.pose = (ac, quat) => {
    if (ac.mnvY) quat.multiply(tq.setFromAxisAngle(AY, ac.mnvY));
    if (ac.mnvP) quat.multiply(tq.setFromAxisAngle(AX, ac.mnvP));
  };

  let hinted = false;
  /** Player keys (main.js): 5 Cobra, 6 Kulbit, 7 post-stall mode. */
  M.player = (pl, I) => {
    if (I.action("cobra")) M.start(pl, "cobra");
    if (I.action("kulbit")) M.start(pl, "kulbit");
    if (I.action("psm")) M.togglePSM(pl);
    if (!hinted && pl.state === "flying" && M.can(pl, "cobra")) {
      hinted = true;
      const K = (a) => RJ.keyLabel(RJ.settings.keys[a]);
      RJ.ui.flash("ADVANCED MANEUVERS", M.can(pl, "kulbit") ? `${K("cobra")} Cobra · ${K("kulbit")} Kulbit · ${K("psm")} Post-stall mode` : `${K("cobra")} Pugachev's Cobra`, 2.2);
    }
  };
})();
