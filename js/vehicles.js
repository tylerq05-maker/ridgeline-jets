/* Ridgeline Jets — vehicles beyond the jet flight model.
 * Separate physics for helicopters (rotor thrust vector, cyclic tilt, collective, hover), starfighters
 * (6-DOF thrust with per-craft grip and drift), flying cars (road driving + VTOL hover or winged flight) and
 * the Rocket Wing Bike (leaning motorcycle, rocket boost, deployable wings, tricks). Jets keep flight.js.
 * Also: the models for these vehicles and a few new fixed-wing types (Su-57, Cessna 172, G650, C-17). */
(function (RJ) {
  "use strict";
  const V = (RJ.vehicles = {});
  const P = RJ.acParts, B = RJ.AC_BUILDERS, V3 = RJ.V3, DEG = Math.PI / 180, G0 = RJ.G0;
  const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);
  const tq = new THREE.Quaternion(), tv = V3(), tv2 = V3(), tv3 = V3();
  const W = () => RJ.world;

  /* ======================= shared helpers ======================= */
  function setAttitude(ac, yaw, pitch, roll) {
    ac.q.setFromAxisAngle(AY, yaw);
    ac.q.multiply(tq.setFromAxisAngle(AX, pitch));
    ac.q.multiply(tq.setFromAxisAngle(AZ, -roll));
    ac.q.normalize(); ac.updateBasis();
  }
  const solid = (p) => (RJ.atlas && RJ.atlas.built ? RJ.atlas.solidAt(p) : false);
  function finishFrame(ac, dt) {
    ac.speed = ac.vel.length();
    ac.mach = ac.speed / RJ.soundSpeed(Math.max(0, ac.pos.y));
    ac.agl = ac.pos.y - W().ground(ac.pos.x, ac.pos.z);
    ac.checkBoom();
    ac.timers(dt);
    V.animate(ac, dt);
  }
  function crash(ac, gnd) { ac.destroy(null, gnd <= 0.5 && W().isWaterAt(ac.pos.x, ac.pos.z) ? "water" : "terrain"); }

  /* ======================= HELICOPTER =======================
   * The rotor thrust vector does everything: tilt the disc (cyclic) to move, collective sets climb rate
   * (R/F; middle = hold height), pedals yaw. Rotor and attitude lags make heavy machines feel heavy. */
  function heli(ac, dt, H) {
    const s = ac.vs, inp = ac.input, F = ac.spec.flight;
    ac.throttleAndFuel(dt);
    s.rpm = RJ.damp(s.rpm, 1, ac.state === "ground" && ac.throttle < 0.05 ? 0.4 : 0.9, dt);
    const gnd = W().ground(ac.pos.x, ac.pos.z);
    const climbCmd = inp.ab ? H.climb : (ac.throttle - 0.5) * 2 * H.climb;
    if (ac.state === "ground") {
      ac.vel.set(0, 0, 0); s.pt = RJ.damp(s.pt, 0, 4, dt); s.rl = RJ.damp(s.rl, 0, 4, dt);
      s.yaw -= inp.yaw * H.yawRate * 0.3 * DEG * dt;
      setAttitude(ac, s.yaw, s.pt, s.rl);
      ac.pos.y = gnd + H.skid;
      if (climbCmd > 1 && s.rpm > 0.85) { ac.state = "flying"; ac.vel.y = 1.5; RJ.emit("liftoff", ac); }
      ac.g = 1; s.T = G0;
      s.status = s.rpm < 0.85 ? "ROTOR SPOOL-UP" : "ON GROUND · R to lift";
      finishFrame(ac, dt);
      return true;
    }
    // cyclic: nose down to go forward, bank to strafe; with assist the disc trims itself to stop drift when you let go
    const fx = tv.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), rx = tv2.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const vf = ac.vel.dot(fx), vr = ac.vel.dot(rx), tilt = H.tilt * DEG;
    let pT = -inp.pitch * tilt, rT = inp.roll * tilt;
    if (ac.assist && Math.abs(inp.pitch) < 0.05) pT = RJ.clamp(vf * 0.03, -0.6, 0.6) * tilt;
    if (ac.assist && Math.abs(inp.roll) < 0.05) rT = RJ.clamp(-vr * 0.04, -0.6, 0.6) * tilt;
    s.pt = RJ.damp(s.pt, pT, H.tiltRate, dt);
    s.rl = RJ.damp(s.rl, rT, H.tiltRate * 1.1, dt);
    // pedals, plus the natural turn into a bank at forward speed
    const yawT = -inp.yaw * H.yawRate * DEG - Math.sin(s.rl) * Math.max(0, vf) * 0.012;
    s.yr = RJ.damp(s.yr, yawT, H.yawResp, dt);
    s.yaw += s.yr * dt;
    setAttitude(ac, s.yaw, s.pt, s.rl);
    // collective: thrust needed to hold the commanded climb, limited by power, lagged by rotor inertia
    const up = ac.up;
    const need = (G0 + (climbCmd - ac.vel.y) * 1.8) / Math.max(up.y, 0.45);
    const etl = 1 + 0.12 * RJ.smooth(8, 22, Math.hypot(vf, vr)) * (1 - RJ.smooth(45, 75, Math.hypot(vf, vr))); // translational lift
    s.T = RJ.damp(s.T, RJ.clamp(need, 0, H.tmax * G0 * etl) * s.rpm, H.spool, dt);
    const acc = tv3.copy(up).multiplyScalar(s.T);
    acc.y -= G0;
    const hs = Math.hypot(ac.vel.x, ac.vel.z);
    acc.x -= ac.vel.x * hs * H.drag; acc.z -= ac.vel.z * hs * H.drag;
    acc.y -= ac.vel.y * Math.abs(ac.vel.y) * H.vdrag;
    ac.vel.addScaledVector(acc, dt);
    ac.pos.addScaledVector(ac.vel, dt);
    ac.g = s.T * up.y / G0; ac.aoa = 0;
    // skids on the ground
    if (ac.pos.y - gnd <= H.skid) {
      const hard = ac.vel.y < -6.5 || Math.abs(s.pt) > 0.4 || Math.abs(s.rl) > 0.4 || hs > 16;
      if (hard || (gnd <= 0.5 && W().isWaterAt(ac.pos.x, ac.pos.z))) { crash(ac, gnd); return true; }
      ac.state = "ground"; ac.pos.y = gnd + H.skid; ac.vel.set(0, 0, 0);
      RJ.emit("touchdown", ac);
    }
    if (solid(ac.pos)) { crash(ac, gnd); return true; }
    const climb = ac.vel.y;
    s.status = Math.abs(climb) < 0.6 && hs < 2 ? "HOVER" : climb > 0.6 ? `CLIMB ${climb.toFixed(1)} m/s` : climb < -0.6 ? `DESCEND ${(-climb).toFixed(1)} m/s` : "LEVEL";
    finishFrame(ac, dt);
    return true;
  }

  /* ======================= STARFIGHTER =======================
   * Thrust along the nose, direct rate control, and a per-craft "grip" that pulls the velocity toward the
   * nose: high grip carves, low grip slides through turns. Agility falls off at high speed. */
  const MPH = 0.44704;
  function space(ac, dt, S) {
    const s = ac.vs, inp = ac.input;
    ac.throttleAndFuel(dt);
    const gnd = W().ground(ac.pos.x, ac.pos.z);
    // afterburner (Shift or the lever's top detent): no reserve, this is a starfighter
    const boosting = inp.ab && ac.state === "flying";
    ac.abLevel = RJ.damp(ac.abLevel, boosting ? 1 : 0, 4, dt);
    if (S.foils) { s.foils = RJ.damp(s.foils, ac.firing ? 1 : s.foilsWant, 3, dt); }
    // HYPERSONIC: a far bigger push than the afterburner, ramped in over ~2 s
    if (ac.state !== "flying") s.hyperOn = false;
    s.hyper = RJ.damp(s.hyper || 0, s.hyperOn ? 1 : 0, s.hyperOn ? 1.3 : 1.6, dt);
    if (s.hyper < 0.002) s.hyper = 0;
    ac.hyperK = s.hyper;
    if (ac.state === "ground") {
      ac.vel.set(0, 0, 0); ac.pos.y = gnd + S.gearH; s.spd = 0;
      if (ac.throttle > 0.12) { ac.state = "flying"; ac.vel.set(0, 6, 0); s.spd = 6; RJ.emit("liftoff", ac); }
      s.status = "LANDED · throttle up to lift off";
      finishFrame(ac, dt);
      return true;
    }
    // lever: bottom = half speed, top = full speed, afterburner detent = boost speed; B brakes down to a hover
    const vmax = S.vmax * (S.foils ? 1 + 0.06 * (1 - s.foils) : 1);
    let target = inp.brake ? 0 : boosting ? S.vboost : (0.5 + 0.5 * ac.throttle) * vmax;
    if (s.hyper > 0) {
      target = RJ.lerp(target, S.vhyper, s.hyper);
      s.spd = RJ.damp(s.spd, target, 1.6, dt);
    } else s.spd += RJ.clamp(target - s.spd, -S.decel * dt, S.accel * (boosting ? 1.5 : 1) * dt);
    const agile = RJ.clamp(1.3 - (s.spd / S.vboost) * 0.55, 0.55, 1.3) * (1 - s.hyper * 0.7);
    ac.ctl.pitch = RJ.damp(ac.ctl.pitch, inp.pitch, S.resp, dt);
    ac.ctl.roll = RJ.damp(ac.ctl.roll, inp.roll, S.resp * 1.3, dt);
    ac.ctl.yaw = RJ.damp(ac.ctl.yaw, inp.yaw, S.resp, dt);
    ac.q.multiply(tq.setFromAxisAngle(AX, ac.ctl.pitch * S.pitch * DEG * agile * dt));
    ac.q.multiply(tq.setFromAxisAngle(AY, -ac.ctl.yaw * S.yaw * DEG * agile * dt));
    ac.q.multiply(tq.setFromAxisAngle(AZ, -ac.ctl.roll * S.roll * DEG * (1 - s.hyper * 0.5) * dt));
    ac.q.normalize(); ac.updateBasis();
    const prevVel = tv3.copy(ac.vel);
    const want = tv.copy(ac.fwd).multiplyScalar(s.spd);
    ac.vel.lerp(want, 1 - Math.exp(-S.grip * (1 + s.hyper * 2) * dt));
    // swept terrain check: at thousands of m/s one frame covers 30–160 m, so test the whole path, not just the end
    const step = ac.vel.length() * dt, nSub = Math.min(24, Math.ceil(step / 25));
    let hit = false, hitG = gnd;
    for (let i = 1; i <= nSub; i++) {
      const k = (i / nSub) * dt, px = ac.pos.x + ac.vel.x * k, py = ac.pos.y + ac.vel.y * k, pz = ac.pos.z + ac.vel.z * k;
      const g = W().ground(px, pz);
      if (py - g < S.gearH) { ac.pos.set(px, py, pz); hit = true; hitG = g; break; }
    }
    if (!hit) ac.pos.addScaledVector(ac.vel, dt);
    if (ac.pos.y > 60000) { ac.pos.y = 60000; ac.vel.y = Math.min(0, ac.vel.y); }
    const dv = prevVel.sub(ac.vel).multiplyScalar(-1 / Math.max(dt, 1e-3));
    // inertial dampers: the pilot feels a fraction of the manoeuvre (no blackout in a starfighter)
    ac.g = RJ.damp(ac.g, RJ.clamp(1 + dv.dot(ac.up) / G0 * 0.12, -1, 4.5), 6, dt); ac.aoa = 0;
    if (hit || ac.pos.y - W().ground(ac.pos.x, ac.pos.z) < S.gearH) {
      const g = hit ? hitG : W().ground(ac.pos.x, ac.pos.z);
      if (ac.vel.length() < 30 && ac.fwd.y > -0.35 && !(g <= 0.5 && W().isWaterAt(ac.pos.x, ac.pos.z))) {
        ac.state = "ground"; ac.vel.set(0, 0, 0); s.spd = 0; ac.pos.y = g + S.gearH;
        s.yaw = Math.atan2(-ac.fwd.x, -ac.fwd.z); setAttitude(ac, s.yaw, 0, 0);
        RJ.emit("touchdown", ac);
      } else { crash(ac, g); return true; }
    }
    if (solid(ac.pos)) { crash(ac, gnd); return true; }
    s.status = (s.hyper > 0.05 ? "HYPERSONIC" : boosting ? "AFTERBURNER" : inp.brake ? "BRAKING · land below 65 mph" : "") + (S.foils ? `${s.hyper > 0.05 || boosting || inp.brake ? " · " : ""}S-FOILS ${s.foils > 0.5 ? "ATTACK" : "CLOSED"}` : "");
    finishFrame(ac, dt);
    return true;
  }
  /** H: hypersonic on/off (Star Wars craft only). Returns the new state, or null when unavailable. */
  V.toggleHyper = function (ac) {
    const F = ac.spec.flight;
    if (F.model !== "space" || !ac.alive || !ac.vs) return null;
    if (ac.state !== "flying") { RJ.ui.flash("TAKE OFF FIRST", null, 0.8); return null; }
    const s = ac.vs;
    s.hyperOn = !s.hyperOn;
    RJ.emit("hyper", { ac, on: s.hyperOn });
    return s.hyperOn;
  };

  /* ======================= GROUND DRIVING (cars and the bike) ======================= */
  function drive(ac, dt, D, bikeMode) {
    const s = ac.vs, inp = ac.input, w = W();
    ac.throttleAndFuel(dt);
    ac.state = "ground"; ac.gearT = 1;
    const push = inp.pitch;
    let acc;
    if (push > 0.05) acc = push * D.acc * (s.v < 0 ? 2 : 1);
    else if (push < -0.05) acc = s.v > 0.5 ? push * D.brake : push * D.acc * 0.45;
    else acc = -Math.sign(s.v) * Math.min(Math.abs(s.v) / dt, D.roll);
    if (inp.brake) acc = -Math.sign(s.v) * Math.min(Math.abs(s.v) / dt, D.brake);
    const rocket = bikeMode && inp.ab && s.boost > 0.02;
    if (rocket) acc += D.rocket;
    s.v += (acc - D.drag * s.v * Math.abs(s.v)) * dt;
    s.v = RJ.clamp(s.v, -10, rocket ? D.vmax * 1.8 : D.vmax);
    const steer = RJ.clamp(inp.roll + inp.yaw * 0.6, -1, 1);
    if (bikeMode) {
      // lean to turn: the turn rate follows the lean (g·tanθ / v); grip limits the lean you can hold
      const maxLean = D.maxLean * DEG;
      const leanT = steer * maxLean * RJ.clamp(Math.abs(s.v) / 10, 0, 1);
      const resp = D.leanRate * (Math.abs(s.v) > 70 ? 0.55 : 1); // twitchy and hard to hold at rocket speed
      s.lean = RJ.damp(s.lean, leanT, resp, dt);
      const lat = G0 * Math.tan(Math.abs(s.lean));
      s.slipT = lat > D.grip && Math.abs(s.v) > 20 ? s.slipT + dt : Math.max(0, s.slipT - dt * 2);
      if (s.slipT > 0.25 && !s.warned) { s.warned = true; RJ.ui.flash("LOSING TRACTION", "Ease off the lean", 0.8, true); }
      if (s.slipT < 0.05) s.warned = false;
      if (s.slipT > 0.7) { ac.destroy(null, "terrain"); return true; }
      s.yaw -= (Math.sign(s.v) * G0 * Math.tan(s.lean) / Math.max(Math.abs(s.v), 3)) * dt;
    } else {
      // bicycle model: steering angle shrinks with speed so cars stay stable on the road
      const sa = steer * D.steer * DEG / (1 + Math.abs(s.v) / D.steerFade);
      s.yaw -= (s.v / D.wb) * Math.tan(sa) * dt;
      s.lean = RJ.damp(s.lean, -steer * Math.min(1, Math.abs(s.v) / 30) * 0.06, 4, dt); // body roll
    }
    const dir = tv.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const g0 = w.ground(ac.pos.x, ac.pos.z);
    const nx = ac.pos.x + dir.x * s.v * dt, nz = ac.pos.z + dir.z * s.v * dt;
    const g1 = w.ground(nx, nz);
    const step = Math.abs(s.v * dt);
    if (w.isWaterAt(nx, nz) && g1 <= 0.5 && !(bikeMode && s.wings > 0.9 && Math.abs(s.v) > 35)) {
      s.v = 0;
      if (!s.waterWarn) { s.waterWarn = true; RJ.ui.flash("WATER AHEAD", D.vtol ? "Press G to fly" : "Deploy wings (G) and get airborne", 1.2); }
    } else if (step > 1e-4 && (g1 - g0) / step > 1.1) {
      s.v *= -0.25; // wall or cliff face: bounce off
    } else {
      ac.pos.x = nx; ac.pos.z = nz;
      // ran off a drop at speed: airborne
      if (g1 < g0 - 1.6 && Math.abs(s.v) > 8) { goAirborne(ac, dir, 0); return true; }
      s.waterWarn = false;
    }
    // suspension: follow the ground with a spring so bumps show
    const gNow = w.ground(ac.pos.x, ac.pos.z);
    const sv = s.susV || 0;
    s.susV = sv + ((gNow + D.ride - ac.pos.y) * 140 - sv * 16) * dt;
    ac.pos.y += s.susV * dt;
    if (ac.pos.y < gNow + D.ride * 0.6) { ac.pos.y = gNow + D.ride * 0.6; s.susV = Math.max(0, s.susV); }
    // terrain pitch and roll
    const rgt = tv2.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const gF = w.ground(ac.pos.x + dir.x * 1.5, ac.pos.z + dir.z * 1.5), gB = w.ground(ac.pos.x - dir.x * 1.5, ac.pos.z - dir.z * 1.5);
    const gR = w.ground(ac.pos.x + rgt.x * 1, ac.pos.z + rgt.z * 1), gL = w.ground(ac.pos.x - rgt.x * 1, ac.pos.z - rgt.z * 1);
    s.pt = RJ.damp(s.pt, Math.atan2(gF - gB, 3), 8, dt);
    const terrRoll = bikeMode ? 0 : -Math.atan2(gR - gL, 2);
    s.rl = RJ.damp(s.rl, terrRoll, 8, dt);
    // a crest at speed throws you into the air (ramps and jumps)
    const crest = (gF - gNow) / 1.5;
    if (s.prevSlope != null && s.prevSlope - crest > 0.25 && Math.abs(s.v) > 25) { goAirborne(ac, dir, s.prevSlope * Math.abs(s.v)); return true; }
    s.prevSlope = crest;
    setAttitude(ac, s.yaw, s.pt, s.rl + s.lean);
    ac.vel.copy(dir).multiplyScalar(s.v);
    ac.speed = Math.abs(s.v); ac.g = 1; ac.aoa = 0;
    s.wheelRot += (s.v / D.wheelR) * dt;
    return false;
  }
  function goAirborne(ac, dir, vy) {
    const s = ac.vs;
    ac.state = "flying";
    ac.vel.copy(dir).multiplyScalar(s.v); ac.vel.y = vy;
    s.tricks = []; s.rotAcc = { p: 0, r: 0, y: 0 }; s.airT = 0;
    RJ.emit("liftoff", ac);
  }

  /* ======================= FLYING CARS ======================= */
  function car(ac, dt, C) {
    const s = ac.vs;
    if (s.mode === "fly") {
      if (C.vtol) {
        if (s.wantDrive && ac.state === "flying") ac.throttle = Math.min(ac.throttle, 0.15); // settle down
        if (ac.state === "ground" && s.wantDrive) { s.mode = "drive"; s.wantDrive = false; s.v = 0; RJ.ui.flash("DRIVE MODE", "Wheels down", 1); }
        else { heli(ac, dt, C.fly); s.status = `FLIGHT · ${s.status}`; return true; }
      } else {
        if (ac.state === "flying") { s.status = "FLIGHT · land on the wheels, then G folds the wings"; return false; } // the fixed-wing model flies it
        s.mode = "drive";
      }
    }
    if (ac.state === "flying" && s.mode === "drive") return ballistic(ac, dt, C, false);
    if (drive(ac, dt, C, false)) return true;
    // winged car: wings out and fast enough, pull back to take off down the road
    if (!C.vtol && s.wings > 0.95 && s.v > ac.spec.flight.vstall * 1.08 && ac.input.pitch > 0.3) {
      s.mode = "fly"; ac.state = "flying"; ac.speed = s.v;
      ac.q.multiply(tq.setFromAxisAngle(AX, 0.1)); ac.updateBasis();
      ac.vel.copy(ac.fwd).multiplyScalar(s.v); ac.gearDown = false; ac.gearAuto = true; ac.gS = 1;
      RJ.emit("liftoff", ac);
    }
    s.status = `DRIVE · ${C.vtol ? "G: take off vertically" : s.wings > 0.95 ? `WINGS OUT · rotate at ${Math.round(ac.spec.flight.vstall * 1.08 * RJ.speedUnit()[1])} ${RJ.speedUnit()[0]}` : "G: unfold wings"}`;
    finishFrame(ac, dt);
    return true;
  }
  /** Off a ledge with no wings or rotors: a jump. */
  function ballistic(ac, dt, D, bikeMode) {
    const s = ac.vs;
    ac.vel.y -= G0 * dt;
    ac.vel.multiplyScalar(1 - 0.02 * dt);
    ac.pos.addScaledVector(ac.vel, dt);
    const gnd = W().ground(ac.pos.x, ac.pos.z);
    if (ac.pos.y - gnd <= D.ride) {
      if (ac.vel.y < -14 || (gnd <= 0.5 && W().isWaterAt(ac.pos.x, ac.pos.z))) { crash(ac, gnd); return true; }
      ac.state = "ground"; s.v = Math.hypot(ac.vel.x, ac.vel.z) * Math.sign(s.v || 1); ac.pos.y = gnd + D.ride; s.susV = ac.vel.y * 0.4;
      RJ.emit("touchdown", ac);
    }
    setAttitude(ac, s.yaw, RJ.damp(s.pt, Math.atan2(ac.vel.y, Math.hypot(ac.vel.x, ac.vel.z)) * 0.6, 2, dt), s.rl + s.lean);
    s.status = "AIRBORNE";
    finishFrame(ac, dt);
    return true;
  }

  /* ======================= ROCKET WING BIKE =======================
   * Motorcycle on the ground; in the air a tiny, twitchy airframe whose wings (G) give lift and the rocket
   * (Shift) a huge, limited push. Flips and rolls are scored; land upright and aligned or you crash. */
  function bike(ac, dt, K) {
    const s = ac.vs, inp = ac.input;
    const boosting = inp.ab && s.boost > 0.02;
    s.boost = RJ.clamp(s.boost + (boosting ? -dt / K.boostTime : dt / (K.boostTime * 3)), 0, 1);
    ac.abLevel = RJ.damp(ac.abLevel, boosting ? 1 : 0, 6, dt);
    if (ac.state === "ground") {
      if (drive(ac, dt, K, true)) return true;
      if (s.wings > 0.9 && s.v > K.liftoff && inp.pitch > 0.3) { goAirborne(ac, tv.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), 5); ac.q.multiply(tq.setFromAxisAngle(AX, 0.15)); ac.updateBasis(); return true; }
      s.status = `BOOST ${Math.round(s.boost * 100)}% · ${s.wings > 0.9 ? `WINGS OUT · pull up above ${Math.round(K.liftoff * RJ.speedUnit()[1])} ${RJ.speedUnit()[0]}` : "G: wings"}`;
      finishFrame(ac, dt);
      return true;
    }
    // ---- in the air ----
    ac.throttleAndFuel(dt);
    const R = K.air;
    ac.ctl.pitch = RJ.damp(ac.ctl.pitch, inp.pitch, 9, dt);
    ac.ctl.roll = RJ.damp(ac.ctl.roll, inp.roll, 11, dt);
    ac.ctl.yaw = RJ.damp(ac.ctl.yaw, inp.yaw, 7, dt);
    const dp = ac.ctl.pitch * R.pitch * DEG * dt, dr = ac.ctl.roll * R.roll * DEG * dt, dy = ac.ctl.yaw * R.yaw * DEG * dt;
    ac.q.multiply(tq.setFromAxisAngle(AX, dp));
    ac.q.multiply(tq.setFromAxisAngle(AY, -dy));
    ac.q.multiply(tq.setFromAxisAngle(AZ, -dr));
    ac.q.normalize(); ac.updateBasis();
    // trick tracking: full rotations about each axis
    const ra = s.rotAcc || (s.rotAcc = { p: 0, r: 0, y: 0 });
    ra.p += dp; ra.r += dr; ra.y += dy; s.airT = (s.airT || 0) + dt;
    for (const [k, name] of [["r", "Barrel roll"], ["p", "Flip"], ["y", "Flat spin"]]) {
      if (Math.abs(ra[k]) >= Math.PI * 2) { const nm = k === "p" ? (ra.p > 0 ? "Backflip" : "Frontflip") : name; s.tricks.push(nm); ra[k] -= Math.sign(ra[k]) * Math.PI * 2; RJ.ui.flash(nm.toUpperCase() + "!", null, 0.6); }
    }
    // forces: engine + rocket along the nose, lift from the wings, drag, gravity
    const v = ac.vel.length(), wing = s.wings;
    const acc = tv.copy(ac.fwd).multiplyScalar(K.airThrust * ac.throttle + (boosting ? K.rocket * 1.2 : 0));
    const align = v > 1 ? Math.max(0, ac.vel.dot(ac.fwd) / v) : 0;
    const lift = Math.min(K.cl * v * v * wing * align, 3.2 * G0);
    acc.addScaledVector(ac.up, lift);
    acc.addScaledVector(ac.vel, -v * (K.cd + K.cdw * wing));
    acc.y -= G0;
    ac.vel.addScaledVector(acc, dt);
    // wings turn the flight path toward the nose; without them the bike is a thrown rock
    if (wing > 0.5 && v > 5) { const sp = ac.vel.length(); ac.vel.lerp(tv2.copy(ac.fwd).multiplyScalar(sp), 1 - Math.exp(-K.align * wing * dt)); }
    ac.pos.addScaledVector(ac.vel, dt);
    ac.g = 1 + lift / G0; ac.aoa = 0;
    const gnd = W().ground(ac.pos.x, ac.pos.z);
    if (ac.pos.y - gnd <= K.ride) {
      const hv = Math.hypot(ac.vel.x, ac.vel.z);
      const fh = tv2.set(ac.fwd.x, 0, ac.fwd.z).normalize();
      const aligned = hv < 8 || (ac.vel.x * fh.x + ac.vel.z * fh.z) / hv > 0.8;
      if (ac.up.y > 0.72 && aligned && ac.vel.y > -16 && !(gnd <= 0.5 && W().isWaterAt(ac.pos.x, ac.pos.z))) {
        ac.state = "ground"; s.yaw = Math.atan2(-ac.fwd.x, -ac.fwd.z); s.v = hv; s.lean = 0; s.slipT = 0; s.susV = ac.vel.y * 0.5; ac.pos.y = gnd + K.ride;
        const t = s.tricks.length ? `${s.tricks.join(" + ")} · ` : "";
        if (s.airT > 1.2 || s.tricks.length) RJ.ui.flash(s.tricks.length ? "CLEAN LANDING" : "NICE JUMP", `${t}${s.airT.toFixed(1)} s air`, 1.6);
        s.tricks = [];
        RJ.emit("touchdown", ac);
      } else { crash(ac, gnd); return true; }
    }
    if (solid(ac.pos)) { crash(ac, gnd); return true; }
    s.status = `BOOST ${Math.round(s.boost * 100)}% · ${wing > 0.9 ? "WINGS OUT" : "NO WINGS"}${s.tricks.length ? " · " + s.tricks.join(", ") : ""}`;
    finishFrame(ac, dt);
    return true;
  }

  /* ======================= dispatch ======================= */
  /** Returns true when this vehicle's own model handled the frame (false hands it to the jet model). */
  V.update = function (ac, dt) {
    const F = ac.spec.flight;
    if (!ac.vs) V.place(ac, {});
    if (!(dt > 0)) return true; // paused / zero-length frame: nothing to integrate (avoids 0/0)
    const s = ac.vs;
    s.wings = RJ.damp(s.wings, s.wingsWant, 2.2, dt);
    let r;
    if (F.model === "heli") r = heli(ac, dt, F.heli);
    else if (F.model === "space") r = space(ac, dt, F.space);
    else if (F.model === "car") r = car(ac, dt, F.car);
    else if (F.model === "bike") r = bike(ac, dt, F.bike);
    if (!r) V.animate(ac, dt);
    ac.vstatus = s.status;
    return r;
  };
  /** G key: S-foils, wings or drive/fly, depending on the vehicle. */
  V.action = function (ac, what) {
    if (what !== "gear" || !ac.alive) return;
    const F = ac.spec.flight, s = ac.vs || V.place(ac, {});
    if (F.model === "space" && F.space.foils) { s.foilsWant = s.foilsWant > 0.5 ? 0 : 1; RJ.ui.flash(s.foilsWant ? "S-FOILS: ATTACK POSITION" : "S-FOILS CLOSED", s.foilsWant ? null : "+6% speed", 0.9); }
    else if (F.model === "heli") RJ.ui.flash("FIXED LANDING GEAR", null, 0.6);
    else if (F.model === "bike") { s.wingsWant = s.wingsWant > 0.5 ? 0 : 1; RJ.ui.flash(s.wingsWant ? "WINGS DEPLOYED" : "WINGS STOWED", null, 0.8); }
    else if (F.model === "car") {
      if (F.car.vtol) {
        if (s.mode === "drive") { s.mode = "fly"; ac.state = "ground"; ac.throttle = 0.8; s.rpm = 0.5; RJ.ui.flash("FLIGHT MODE", "Fans spinning up", 1); }
        else if (ac.state === "ground") { s.mode = "drive"; s.v = 0; RJ.ui.flash("DRIVE MODE", null, 0.8); }
        else { s.wantDrive = true; RJ.ui.flash("LANDING TO DRIVE", "Descending", 1); }
      } else {
        if (ac.state === "flying" && s.mode === "fly") { ac.gearDown = !ac.gearDown; ac.gearAuto = false; RJ.ui.flash(ac.gearDown ? "GEAR DOWN" : "GEAR UP", null, 0.7); }
        else { s.wingsWant = s.wingsWant > 0.5 ? 0 : 1; RJ.ui.flash(s.wingsWant ? "WINGS UNFOLDED" : "WINGS FOLDED", s.wingsWant ? "Accelerate, then pull up to fly" : null, 1); }
      }
    }
  };
  /** Spawn: set up the vehicle's own state. Cars and the bike always start on the road (or flying over water). */
  V.place = function (ac, opts) {
    const F = ac.spec.flight, w = W();
    const s = (ac.vs = { yaw: Math.atan2(-ac.fwd.x, -ac.fwd.z), pt: 0, rl: 0, yr: 0, T: G0, rpm: opts.ground ? 0 : 1, v: 0, lean: 0, boost: 1, foils: 1, foilsWant: 1, wings: 0, wingsWant: 0, mode: "drive", tricks: [], wheelRot: 0, slipT: 0, spd: 0, status: "" });
    if (F.model === "heli") {
      if (opts.ground) { ac.throttle = 0; ac.pos.y = w.ground(ac.pos.x, ac.pos.z) + F.heli.skid; ac.vel.set(0, 0, 0); }
      else { ac.throttle = 0.5; ac.vel.copy(ac.fwd).multiplyScalar(Math.min(ac.speed, 35)); }
    } else if (F.model === "space") {
      s.spd = opts.ground ? 0 : F.space.vmax * 0.6;
      ac.throttle = opts.ground ? 0 : 0.5; ac.vel.copy(ac.fwd).multiplyScalar(s.spd);
      if (opts.ground) ac.pos.y = w.ground(ac.pos.x, ac.pos.z) + F.space.gearH;
    } else {
      const D = F.car || F.bike, gy = w.ground(ac.pos.x, ac.pos.z), wet = w.isWaterAt(ac.pos.x, ac.pos.z) && gy <= 0.5;
      if (!wet) { ac.state = "ground"; ac.pos.y = gy + D.ride; ac.vel.set(0, 0, 0); ac.throttle = 0; s.mode = "drive"; }
      else if (F.car && F.car.vtol) { ac.state = "flying"; s.mode = "fly"; ac.throttle = 0.5; s.rpm = 1; ac.vel.copy(ac.fwd).multiplyScalar(30); }
      else { // over the sea: start flying with wings out
        ac.state = "flying"; s.wings = s.wingsWant = 1; s.mode = "fly";
        ac.throttle = 1; ac.vel.copy(ac.fwd).multiplyScalar(Math.min(Math.max(ac.speed, 70), 90)); s.rotAcc = { p: 0, r: 0, y: 0 };
      }
    }
    ac.speed = ac.vel.length();
    if (ac.state === "ground") setAttitude(ac, s.yaw, 0, 0);
    return s;
  };

  /* ---------------- animation: rotors, wheels, foils, wings, rotor wash ---------------- */
  V.animate = function (ac, dt) {
    const U = ac.vis, s = ac.vs;
    if (U.rotors) for (const r of U.rotors) { r.spin.rotation.y += r.speed * s.rpm * dt; r.disc.material.opacity = 0.32 * RJ.smooth(0.3, 1, s.rpm); for (const b of r.blades) b.visible = s.rpm < 0.85; }
    if (U.wheels) for (const wh of U.wheels) {
      wh.spin.rotation.x -= (s.v / (wh.r || 0.35)) * dt;
      if (wh.retract) { const out = s.mode === "fly" ? 1 : 0; wh.t = RJ.damp(wh.t || 0, out, 3, dt); wh.grp.rotation.z = wh.side * wh.t * 1.4; }
      if (wh.steer) wh.grp.rotation.y = -RJ.clamp(ac.input.roll, -1, 1) * 0.35;
    }
    if (U.foils) for (const f of U.foils) f.hinge.rotation.z = f.s * (f.open || 0.22) * (s.foils != null ? s.foils : 1) + (f.closed || 0) * f.s * (1 - (s.foils != null ? s.foils : 1));
    if (U.wingHinges) for (const w of U.wingHinges) { const t = s.wings; w.hinge.rotation[w.axis] = w.s * w.folded * (1 - t); }
    if (U.fans) for (const f of U.fans) f.spin.rotation.y += 60 * (s.mode === "fly" ? s.rpm : 0) * dt;
    // rotor wash: dust or spray kicked up under rotors and fans
    if ((U.rotors || (U.fans && s.mode === "fly")) && ac.state === "flying" && ac.agl < 28 && s.rpm > 0.8) {
      s.washT = (s.washT || 0) - dt;
      if (s.washT <= 0) {
        s.washT = 0.05;
        const gy = W().ground(ac.pos.x, ac.pos.z), a = Math.random() * Math.PI * 2, rr = 3 + Math.random() * 6 * (U.rotors ? 1.4 : 0.6);
        const p = tv3.set(ac.pos.x + Math.cos(a) * rr, gy + 0.6, ac.pos.z + Math.sin(a) * rr);
        RJ.fx.smoke(p, tv2.set(Math.cos(a) * 9, 1.5, Math.sin(a) * 9), 2.5, 0.6, 2.2, W().isWaterAt(p.x, p.z) ? 0.5 : 0.35);
      }
    }
  };

  /* ---------------- starfighter engines: afterburner glow, particle trail, Falcon's blue strip ---------------- */
  const _c = new THREE.Color();
  V.visual = function (ac, dt) {
    if (ac.spec.flight.model !== "space" || ac.state !== "flying") return;
    const U = ac.vis, hy = ac.hyperK || 0, ab = Math.max(ac.abLevel, hy), F = ac.spec;
    const col = _c.setHex(F.colors.glow || F.engineColor || 0xff6a3a);
    if (U.strip) {
      const k = 1.2 + ac.throttle * 0.8 + ab * 3 + hy * 6; // HDR value → heavy bloom
      U.strip.material.color.setRGB(0.25 * k, 0.5 * k, 1.0 * k);
      U.strip.scale.set(1, 1 + ab * 0.6 + hy, 1);
    }
    if (ab < 0.08) return;
    ac._trailT = (ac._trailT || 0) - dt;
    if (ac._trailT > 0) return;
    ac._trailT = 0.025;
    const n = U.nozzles.length, every = Math.max(1, Math.round(n / 5)), big = U.strip ? 2.4 : 1;
    U.nozzles.forEach((nz, i) => {
      if (i % every) return;
      const p = ac.mesh.localToWorld(tv.copy(nz));
      const sz = (1.2 + ab * 1.8 + hy * 3) * big;
      // glowing ionised exhaust that hangs in the air behind the ship
      RJ.fx.fireP.spawn(p.x, p.y, p.z, ac.vel.x * 0.02, ac.vel.y * 0.02, ac.vel.z * 0.02, 0.35 + hy * 0.5, sz, sz * (2.5 + hy * 3), col.r, col.g, col.b, 0.75, 0, 0.4);
    });
  };

  /* ---------------- hypersonic heating: leading edges glow, plasma sheath streams off the nose ---------------- */
  let glowTex = null;
  V.heat = function (ac, dt) {
    const rho = RJ.rho(ac.pos.y);
    const k = RJ.clamp((ac.mach - 2.8) / 3.2, 0, 1) * RJ.clamp(Math.sqrt(rho / 0.06), 0.25, 1); // stagnation heating ~ ρ·v³
    if (!ac.heatGlow) {
      if (!glowTex) {
        const c = document.createElement("canvas"); c.width = c.height = 64;
        const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,200,140,0.6)"); gr.addColorStop(1, "rgba(255,90,20,0)");
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(c);
      }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const d = ac.vis.dims; sp.position.set(0, 0, d.minZ != null ? d.minZ + 0.6 : -d.len * 0.48);
      ac.mesh.add(sp); ac.heatGlow = sp;
    }
    const g = ac.heatGlow;
    g.visible = k > 0.01;
    if (!g.visible) return;
    const r = (1.2 + ac.vis.dims.span * 0.12) * (0.6 + k * 1.4);
    g.scale.set(r, r, 1);
    g.material.opacity = k * (0.75 + Math.random() * 0.25);
    g.material.color.setRGB(1, 0.45 + k * 0.35, 0.2 + k * 0.5); // dull red → white-hot
    if (k > 0.35 && Math.random() < k * 0.8) {
      const p = tv.copy(ac.fwd).multiplyScalar(ac.vis.dims.len * 0.45).add(ac.pos);
      RJ.fx.fire(p, tv2.copy(ac.vel).multiplyScalar(0.92), 0.8 + k * 1.6);
    }
  };

  /* ======================= MODELS ======================= */
  const { lathe, plate, fin, finPair, blob, box, tube, pair, engine, cockpit, tips, moving } = P;
  function rotor(g, M, o) {
    const hub = new THREE.Group(); hub.position.set(o.x || 0, o.y, o.z || 0);
    if (o.axis === "x") hub.rotation.z = Math.PI / 2;
    const spin = new THREE.Group(); hub.add(spin);
    const blades = [];
    for (let i = 0; i < o.blades; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(o.chord || 0.45, 0.07, o.r), M.dark);
      b.position.z = o.r / 2; b.castShadow = true;
      const arm = new THREE.Group(); arm.rotation.y = (i / o.blades) * Math.PI * 2; arm.add(b); spin.add(arm); blades.push(b);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(o.chord || 0.4, 10, 8), M.dark); spin.add(cap);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(o.r, 40), new THREE.MeshBasicMaterial({ color: 0x1c1d20, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; hub.add(disc);
    g.add(hub);
    (g.userData.rotors || (g.userData.rotors = [])).push({ spin, disc, speed: o.speed, blades });
  }
  function wheel(g, M, o) {
    const grp = new THREE.Group(); grp.position.set(o.x, o.y, o.z);
    const spin = new THREE.Group(); grp.add(spin);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.w, 18), M.rubber); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.6, o.r * 0.6, o.w * 1.05, 10), M.strut); rim.rotation.z = Math.PI / 2; spin.add(rim);
    g.add(grp);
    (g.userData.wheels || (g.userData.wheels = [])).push({ grp, spin, r: o.r, retract: !!o.retract, side: Math.sign(o.x) || 1, steer: !!o.steer });
  }
  function hinged(g, child, pos, list, entry) {
    const h = new THREE.Group(); h.position.copy(pos); h.add(child); g.add(h);
    list.push(Object.assign({ hinge: h }, entry));
    return h;
  }

  B.apache = (g, M) => {
    lathe(g, [[-6.4, 0], [-6.1, 0.5], [-5, 0.95], [-2, 1.15], [1, 1.1], [3, 0.7], [6, 0.38], [9.2, 0.3]], M.body, { sx: 0.8, sy: 1.1, segs: 14 });
    blob(g, 0.6, 0.55, 1.3, 0, 0.95, -4.4, M.glass); blob(g, 0.66, 0.62, 1.4, 0, 1.25, -2.4, M.glass);
    box(g, 1.4, 0.15, 3.2, 0, 1.25, -3.4, M.dark); // canopy frame
    pair((x) => { tube(g, 0.46, 0.42, 3.3, x, 1.3, 0.2, M.body); box(g, 0.55, 0.32, 0.9, x, 1.3, 2.0, M.dark); }, 0.98);
    plate(g, [[0.6, -0.7], [2.6, -0.4], [2.6, 0.5], [0.6, 0.8]], 0.16, M.body, { y: 0.55 });
    pair((x) => { tube(g, 0.3, 0.3, 1.7, x, 0.12, 0.05, M.dark); box(g, 0.12, 0.42, 0.6, x, 0.35, 0.05, M.dark); }, 2.25);
    pair((x) => { for (const dz of [-0.25, 0.25]) tube(g, 0.09, 0.09, 1.5, x + dz * 0.6, 0.12, 0.1, M.trim); }, 1.35);
    tube(g, 0.07, 0.07, 1.7, 0, -0.95, -5.5, M.dark); blob(g, 0.3, 0.32, 0.32, 0, -0.85, -4.6, M.dark);
    blob(g, 0.35, 0.35, 0.35, 0, 1.25, -5.6, M.dark); // nose sensor turret
    box(g, 0.34, 1.0, 0.34, 0, 1.95, -0.6, M.dark);
    rotor(g, M, { y: 2.5, z: -0.6, r: 7.3, blades: 4, chord: 0.55, speed: 30 });
    fin(g, [[7.6, 0.2], [8.6, 2.6], [9.5, 2.6], [9.4, 0.2]], M.body, { thick: 0.22 });
    plate(g, [[0, 8.7], [1.6, 8.9], [1.6, 9.5], [0, 9.5]], 0.1, M.body, { y: 0.25 });
    rotor(g, M, { x: 0.38, y: 2.2, z: 9.0, r: 1.4, blades: 4, chord: 0.22, axis: "x", speed: 120 });
    pair((x) => { box(g, 0.12, 0.9, 0.12, x, -1.2, -2.6, M.strut); const w = tube(g, 0.4, 0.4, 0.26, x, -1.62, -2.6, M.rubber); w.rotation.y = Math.PI / 2; }, 1.45);
    box(g, 0.1, 0.6, 0.1, 0, -0.1, 8.3, M.strut); const tw = tube(g, 0.2, 0.2, 0.14, 0, -0.42, 8.3, M.rubber); tw.rotation.y = Math.PI / 2;
    cockpit(g, 1.4, -2.5); tips(g, 2.6, 0.55, 0.1);
  };
  B.littlebird = (g, M) => {
    blob(g, 1.0, 1.0, 1.85, 0, 0, -0.5, M.body); blob(g, 0.92, 0.82, 1.15, 0, 0.12, -1.55, M.glass);
    tube(g, 0.24, 0.12, 4.6, 0, 0.35, 3.3, M.body);
    fin(g, [[5.0, 0], [5.45, 1.25], [5.95, 1.25], [5.95, 0]], M.trim, { y: 0.35, thick: 0.12 });
    plate(g, [[0, 5.0], [0.9, 5.2], [0.9, 5.6], [0, 5.6]], 0.06, M.body, { y: 0.35 });
    pair((x) => { tube(g, 0.06, 0.06, 2.9, x, -1.35, -0.4, M.strut); box(g, 0.06, 0.55, 0.06, x, -1.08, -1.2, M.strut); box(g, 0.06, 0.55, 0.06, x, -1.08, 0.4, M.strut); }, 0.95);
    pair((x) => { box(g, Math.abs(x) - 0.6, 0.08, 0.2, Math.sign(x) * (0.6 + (Math.abs(x) - 0.6) / 2), -0.42, -0.6, M.dark); tube(g, 0.15, 0.15, 1.3, x, -0.55, -0.85, M.dark); }, 1.4);
    box(g, 0.25, 0.7, 0.25, 0, 1.0, -0.5, M.dark);
    rotor(g, M, { y: 1.38, z: -0.5, r: 4.2, blades: 5, chord: 0.3, speed: 50 });
    rotor(g, M, { x: 0.18, y: 0.62, z: 5.6, r: 0.75, blades: 2, chord: 0.12, axis: "x", speed: 160 });
    cockpit(g, 0.45, -1.25); tips(g, 0.95, -1.35, -0.4);
  };
  B.xwing = (g, M) => {
    lathe(g, [[-7.2, 0], [-6.8, 0.2], [-4, 0.48], [-1, 0.72], [2, 0.86], [4.6, 0.9]], M.body, { sx: 0.95, sy: 0.82, segs: 8 });
    box(g, 1.9, 1.55, 4.0, 0, 0, 3.6, M.body);
    blob(g, 0.55, 0.5, 1.6, 0, 0.72, -0.3, M.glass);
    box(g, 0.7, 0.45, 0.9, 0, 0.9, 1.7, M.dark); blob(g, 0.33, 0.33, 0.33, 0, 1.18, 1.7, M.white);
    pair((x) => box(g, 0.05, 0.22, 3.6, x, 0.08, -2.4, M.accent), 0.68);
    const foils = [];
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const wing = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.11, 2.2), M.body); panel.position.set(2.9 * sx, 0, 0.3); panel.castShadow = true; wing.add(panel);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.5), M.accent); stripe.position.set(3.2 * sx, 0.005 * sy, -0.4); wing.add(stripe);
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.4, 14), M.metal); eng.rotation.x = Math.PI / 2; eng.position.set(0.75 * sx, 0.4 * sy, -0.3); wing.add(eng);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6), M.dark); can.rotation.x = Math.PI / 2; can.position.set(5.55 * sx, 0, -1.7); wing.add(can);
      hinged(g, wing, V3(0.55 * sx, 0.2 * sy, 3.1), foils, { s: sx * sy, open: 0.21 });
    }
    g.userData.foils = foils;
    for (const sx of [1, -1]) for (const sy of [1, -1]) engine(g, M, 0.34, 1.3 * sx, 0.75 * sy, 1.6 + 3.1, { noNozzle: true, color: 0xff5533, core: 0xffd8c8 });
    cockpit(g, 0.95, -0.4); tips(g, 5.6, 0, 2.0);
  };
  B.tie = (g, M) => {
    blob(g, 1.5, 1.5, 1.5, 0, 0, 0, M.body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 18), M.dark); ring.position.z = -1.38; g.add(ring);
    blob(g, 0.72, 0.72, 0.1, 0, 0, -1.42, M.glass);
    for (let i = 0; i < 8; i++) { const sp = box(g, 0.06, 1.5, 0.05, 0, 0, -1.44, M.dark); sp.rotation.z = (i / 8) * Math.PI; }
    pair((x) => box(g, 2.2, 0.55, 0.6, x, 0, 0.1, M.body), 1.9);
    for (const s of [1, -1]) {
      // dagger wings, bent at the pylon: two dark solar panels in a frame
      const shape = P.shape2([[-3.4, 3.9], [1.2, 2.4], [1.2, -2.4], [-3.4, -3.9], [-0.6, 0]]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }); geo.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(geo, M.dark); m.position.set(3.05 * s, 0, 0); m.castShadow = true; g.add(m);
      const frame = box(g, 0.2, 0.25, 4.6, 3.05 * s, 0, -1.1, M.body); frame.rotation.x = 0;
      for (const sy of [1, -1]) tube(g, 0.06, 0.06, 1.8, 3.05 * s, 3.6 * sy, -3.6, M.dark);
    }
    engine(g, M, 0.45, 0, 0, 1.45, { noNozzle: true, small: true, color: 0x6aa0ff, core: 0xe0f0ff });
    cockpit(g, 0.3, -0.6); tips(g, 3.2, 0, -1);
  };
  B.awing = (g, M) => {
    plate(g, [[0, -5.0], [3.4, 2.0], [3.4, 3.2], [0, 3.2]], 0.7, M.body);
    box(g, 1.5, 0.9, 5.6, 0, 0.45, -0.4, M.body); blob(g, 0.6, 0.5, 1.0, 0, 1.0, -1.4, M.glass);
    pair((x) => { tube(g, 0.78, 0.74, 3.8, x, 0.2, 2.0, M.metal); fin(g, [[1.0, 0.6], [2.2, 2.4], [3.0, 2.4], [3.4, 0.6]], M.accent, { x, thick: 0.12 }); tube(g, 0.06, 0.06, 1.6, x + Math.sign(x) * 0.5, -0.1, -0.5, M.dark); }, 2.9);
    pair((x) => box(g, 0.6, 0.72, 2.2, x, 0.02, -0.8, M.accent), 1.5);
    pair((x) => engine(g, M, 0.62, x, 0.2, 4.0, { noNozzle: true, color: 0xffa060, core: 0xfff0d0 }), 2.9);
    cockpit(g, 1.1, -1.4); tips(g, 3.4, 0, 2.6);
  };
  B.bwing = (g, M) => {
    box(g, 0.9, 12.5, 2.4, 0, -1.6, 0.4, M.body); box(g, 0.5, 12.5, 0.7, 0, -1.6, -1.0, M.trim);
    blob(g, 1.05, 1.05, 1.8, 0, 5.1, -1.2, M.body); blob(g, 0.6, 0.5, 0.8, 0, 5.3, -2.5, M.glass);
    const foils = [];
    for (const s of [1, -1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 2.0), M.body); panel.position.set(1.8 * s, 0, 0); panel.castShadow = true;
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6), M.dark); gun.rotation.x = Math.PI / 2; gun.position.set(3.5 * s, 0, -1.6);
      const grp = new THREE.Group(); grp.add(panel, gun);
      hinged(g, grp, V3(0.4 * s, -1.0, 0.4), foils, { s, open: 0, closed: -1.35 });
    }
    g.userData.foils = foils;
    tube(g, 0.12, 0.12, 2.6, 0, -7.6, -1.2, M.dark);
    for (const [x, y] of [[0.4, 0.6], [-0.4, 0.6], [0.4, -0.6], [-0.4, -0.6]]) { tube(g, 0.38, 0.38, 1.2, x, y - 1.0, 1.9, M.metal); engine(g, M, 0.32, x, y - 1.0, 2.5, { noNozzle: true, small: true, color: 0x7ab8ff, core: 0xeaf6ff }); }
    cockpit(g, 5.4, -1.8); tips(g, 3.6, -1.0, 0.4);
  };
  B.falcon = (g, M) => {
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.6, 2.4, 44), M.body); disk.castShadow = true; g.add(disk);
    blob(g, 10.4, 1.5, 10.4, 0, 1.2, 0.5, M.body); blob(g, 10.4, 1.3, 10.4, 0, -1.2, 0.5, M.body);
    pair((x) => box(g, 3.0, 1.9, 9.2, x, 0, -13.3, M.body), 2.5);
    const cp = tube(g, 1.25, 1.35, 6.5, 9.2, 0.5, -8.2, M.body); cp.rotation.y = 0.25;
    blob(g, 1.1, 1.0, 0.9, 10.0, 0.6, -11.3, M.glass);
    box(g, 0.25, 1.2, 0.25, 3.2, 2.7, 1.5, M.dark); blob(g, 1.6, 0.25, 1.6, 3.2, 3.4, 1.5, M.trim);
    g.userData.strip = box(g, 17, 1.0, 0.25, 0, 0, 12.75, new THREE.MeshBasicMaterial({ color: 0x3f7dff, fog: false }));
    for (let x = -6; x <= 6; x += 3) engine(g, M, 0.9, x, 0, 12.9, { noNozzle: true, small: true, color: 0x66aaff, core: 0xdff0ff });
    const r = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 46; i++) { const a = r() * Math.PI * 2, d = 3 + r() * 8.5; box(g, 0.5 + r() * 1.6, 0.3 + r() * 0.4, 0.5 + r() * 1.6, Math.cos(a) * d, 2.1 + (1 - d / 12) * 0.4, Math.sin(a) * d + 0.5, i % 3 ? M.trim : M.dark); }
    cockpit(g, 0.8, -10.8); tips(g, 12.4, 0, 0);
  };
  B.vtolcar = (g, M) => {
    box(g, 2.0, 0.62, 4.6, 0, 0, 0, M.body); blob(g, 1.0, 0.36, 2.3, 0, 0.25, -0.1, M.body);
    blob(g, 0.88, 0.5, 1.45, 0, 0.52, -0.3, M.glass);
    pair((x) => box(g, 0.28, 0.1, 0.06, x, 0.05, -2.32, M.glow), 0.65);
    g.userData.fans = [];
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const x = 1.55 * sx, z = 1.75 * sz;
      const duct = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 24), M.trim); duct.rotation.x = Math.PI / 2; duct.position.set(x, 0.15, z); g.add(duct);
      box(g, 0.6, 0.12, 0.18, x - 0.4 * sx, 0.15, z, M.body);
      const spin = new THREE.Group(); spin.position.set(x, 0.15, z);
      for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.62), M.dark); b.position.z = 0.31; const a = new THREE.Group(); a.rotation.y = (i / 5) * Math.PI * 2; a.add(b); spin.add(a); }
      g.add(spin); g.userData.fans.push({ spin });
    }
    for (const sx of [1, -1]) for (const sz of [1, -1]) wheel(g, M, { x: 0.9 * sx, y: -0.4, z: 1.45 * sz, r: 0.36, w: 0.26, retract: true, steer: sz < 0 });
    cockpit(g, 0.65, -0.4); tips(g, 2.25, 0.15, 1.75);
  };
  B.wingcar = (g, M) => {
    box(g, 1.8, 0.7, 4.4, 0, 0, 0, M.body); blob(g, 0.85, 0.5, 1.4, 0, 0.5, -0.4, M.glass);
    pair((x) => box(g, 0.25, 0.1, 0.06, x, 0.05, -2.22, M.glow), 0.6);
    pair((x) => { tube(g, 0.1, 0.08, 3.4, x, 0.3, 3.6, M.body); fin(g, [[4.6, 0], [5.1, 1.2], [5.6, 1.2], [5.6, 0]], M.trim, { x, y: 0.3, thick: 0.1 }); }, 0.8);
    plate(g, [[0, 4.9], [1.2, 5.1], [1.2, 5.5], [0, 5.5]], 0.08, M.body, { y: 1.45 });
    P.propeller(g, M, 2.5, 0.9, 3);
    const wh = (g.userData.wingHinges = []);
    for (const s of [1, -1]) {
      const wg = new THREE.Group();
      const pnl = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 1.3), M.body); pnl.position.set(2.3 * s, 0, 0); pnl.castShadow = true; wg.add(pnl);
      hinged(g, wg, V3(0.85 * s, 0.4, 0.2), wh, { s: -s, axis: "y", folded: 1.45 });
    }
    for (const sx of [1, -1]) for (const sz of [1, -1]) wheel(g, M, { x: 0.85 * sx, y: -0.45, z: 1.4 * sz, r: 0.36, w: 0.26, steer: sz < 0 });
    cockpit(g, 0.7, -0.5); tips(g, 5.4, 0.4, 0.2);
  };
  B.rocketbike = (g, M) => {
    wheel(g, M, { x: 0, y: 0, z: -0.78, r: 0.34, w: 0.16, steer: true }); wheel(g, M, { x: 0, y: 0, z: 0.78, r: 0.35, w: 0.2 });
    box(g, 0.24, 0.32, 1.3, 0, 0.2, 0, M.body); blob(g, 0.27, 0.2, 0.45, 0, 0.45, -0.25, M.body); box(g, 0.26, 0.08, 0.5, 0, 0.44, 0.25, M.dark);
    pair((x) => { const f = box(g, 0.06, 0.62, 0.06, x, 0.18, -0.64, M.strut); f.rotation.x = -0.4; }, 0.1);
    box(g, 0.62, 0.05, 0.05, 0, 0.6, -0.5, M.dark); blob(g, 0.23, 0.26, 0.36, 0, 0.47, -0.58, M.accent); blob(g, 0.2, 0.14, 0.05, 0, 0.72, -0.66, M.glass);
    const torso = box(g, 0.36, 0.52, 0.24, 0, 0.82, 0.05, M.trim); torso.rotation.x = -0.65;
    blob(g, 0.15, 0.16, 0.17, 0, 1.12, -0.2, M.dark);
    pair((x) => { const a = box(g, 0.08, 0.08, 0.5, x, 0.72, -0.28, M.trim); a.rotation.x = 0.3; const l = box(g, 0.1, 0.45, 0.12, x, 0.42, 0.2, M.trim); l.rotation.x = -0.6; }, 0.2);
    tube(g, 0.16, 0.21, 0.75, 0, 0.36, 0.85, M.metal);
    engine(g, M, 0.17, 0, 0.36, 1.26, { color: 0xff7a26, core: 0xfff1d0 });
    const wh = (g.userData.wingHinges = []);
    for (const s of [1, -1]) {
      const wg = new THREE.Group();
      const pnl = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.04, 0.62), M.accent); pnl.position.set(1.05 * s, 0, 0); pnl.castShadow = true; wg.add(pnl);
      hinged(g, wg, V3(0.14 * s, 0.32, 0.12), wh, { s, axis: "z", folded: -1.5 });
    }
    cockpit(g, 1.15, -0.1); tips(g, 2.1, 0.32, 0.12);
  };
  B.cessna = (g, M) => {
    lathe(g, [[-3.9, 0], [-3.7, 0.45], [-3.0, 0.62], [-1.5, 0.7], [0.5, 0.62], [3, 0.32], [4.2, 0.16]], M.body, { sy: 1.25 });
    blob(g, 0.64, 0.42, 1.25, 0, 0.55, -1.4, M.glass);
    plate(g, [[0.3, -1.8], [5.5, -1.7], [5.5, -0.4], [0.3, -0.3]], 0.16, M.body, { y: 0.95, dihedral: 0.03 });
    pair((x) => { const s = box(g, 0.07, 1.2, 0.07, x, 0.32, -1.2, M.strut); s.rotation.z = x > 0 ? 0.62 : -0.62; }, 1.25);
    moving(g, [[0.2, 3.3], [1.7, 3.5], [1.7, 4.1], [0.2, 4.2]], 0.08, M.body, 3.8, { y: 0.1 });
    fin(g, [[2.8, 0.25], [3.8, 1.6], [4.3, 1.6], [4.3, 0.25]], M.trim, { thick: 0.1 });
    pair((x) => box(g, 0.05, 0.25, 4.2, x, 0.2, -1.0, M.accent), 0.66);
    P.propeller(g, M, -4.05, 0.95, 2);
    cockpit(g, 0.55, -1.3); tips(g, 5.5, 0.95, -1.0);
  };
  B.su57 = (g, M) => {
    lathe(g, [[-10, 0], [-9.2, 0.25], [-7.5, 0.6], [-5, 0.9], [-2, 1.05], [2, 1.05], [6, 0.9], [9.5, 0.7]], M.body, { sx: 1.45, sy: 0.6 });
    blob(g, 0.62, 0.6, 2.4, 0, 0.62, -5.6, M.glass);
    pair((x) => { box(g, 1.25, 1.1, 8.5, x, -0.25, 1.6, M.body); tube(g, 0.62, 0.6, 2.2, x, -0.25, 7.4, M.metal); }, 1.6);
    plate(g, [[1.4, -3.8], [7.2, 2.6], [7.2, 3.6], [1.4, 6.0]], 0.25, M.body, { y: 0 });
    moving(g, [[1.8, -4.8], [3.1, -3.9], [3.1, -3.4], [1.8, -3.2]], 0.12, M.body, -3.9, { y: 0.1, canard: true });
    moving(g, [[2.0, 6.0], [4.9, 8.0], [4.9, 9.0], [2.0, 9.0]], 0.16, M.body, 7.4, { y: 0 });
    finPair(g, [[4.2, 0.4], [6.4, 3.0], [7.4, 3.0], [7.6, 0.4]], M.trim, 1.9, 0.45);
    pair((x) => engine(g, M, 0.55, x, -0.25, 8.6), 1.6);
    cockpit(g, 0.85, -5.8); tips(g, 7.2, 0, 3.1);
  };

  /* racing quad: carbon X-frame, four 5-inch props, camera pod, battery strap */
  B.racedrone = (g, M) => {
    box(g, 0.16, 0.05, 0.22, 0, 0, 0, M.dark); box(g, 0.08, 0.05, 0.12, 0, 0.05, 0.02, M.accent);
    box(g, 0.05, 0.05, 0.05, 0, 0.02, -0.12, M.glass);
    for (const [x, z] of [[0.14, -0.14], [-0.14, -0.14], [0.14, 0.14], [-0.14, 0.14]]) {
      const a = box(g, 0.025, 0.012, 0.2, x / 2, 0, z / 2, M.dark); a.rotation.y = Math.atan2(x, z);
      tube(g, 0.018, 0.018, 0.03, x, 0.02, z, M.metal);
      rotor(g, M, { x, y: 0.045, z, r: 0.065, blades: 3, chord: 0.02, speed: 260 });
    }
    cockpit(g, 0.03, -0.1); tips(g, 0.2, 0, 0);
  };
  /* wingsuit flyer: prone body, arm wings from wrist to hip, leg wing between the legs, helmet */
  B.wingsuit = (g, M) => {
    blob(g, 0.2, 0.13, 0.42, 0, 0, 0, M.body); blob(g, 0.12, 0.13, 0.13, 0, 0.04, -0.5, M.trim);
    plate(g, [[0.12, -0.32], [0.82, -0.24], [0.78, -0.05], [0.12, 0.3]], 0.02, M.body);
    plate(g, [[0.04, 0.3], [0.26, 0.9], [0.18, 1.0], [0.0, 0.92]], 0.02, M.accent);
    pair((x) => blob(g, 0.06, 0.06, 0.3, x, -0.01, 0.62, M.body), 0.14);
    cockpit(g, 0.05, -0.45); tips(g, 0.8, 0, -0.2);
  };
  /* paper plane, glider scale (1.6 m span): folded dart with a keel and creased wings */
  B.paperplane = (g, M) => {
    plate(g, [[0.02, -1.25], [0.8, 0.95], [0.6, 1.05], [0.02, 1.05]], 0.012, M.body, { dihedral: 0.12 });
    fin(g, [[-1.2, 0], [1.05, 0], [1.05, -0.22], [0.2, -0.22]], M.trim, { thick: 0.02 });
    tips(g, 0.8, 0, 0.95);
  };

  /* ======================= CATALOG ======================= */
  const add = RJ.addAircraft;
  const LASER = (color, rate, dmg) => ({ name: "Laser cannons", rate, dmg, heat: 0.022, spread: 0.0012, speed: 1700, color, laser: true });
  RJ.CATEGORIES.push(["heli", "Attack helicopters"], ["space", "Starfighters (fan-made)"], ["car", "Flying cars and bikes"], ["civil", "Civil, private and transport"]);
  const heliF = (vmax, h) => ({ model: "heli", vmax, ref: 0, mil: 3, ab: 0, vstall: 1, gmax: 3, roll: 60, pitch: 30, yaw: 60, ind: 1, eng: "fan", heli: h });
  add("ah64", { name: "AH-64 Apache", short: "AH-64", cat: "heli", role: "Heavy attack helicopter", status: "Active · US Army", year: 1986,
    desc: "Heavy and planted: the big rotor answers slowly, it carries its weight through every turn, and it settles into a rock-steady hover. W/S forward/back, A/D sideways, Q/E turn, R/F climb/descend (middle holds height).",
    colors: { body: 0x3d4636, trim: 0x2e3529, glass: 0x1a2430, accent: 0x5a6150 }, build: "apache", noGear: true, gearH: 2.05,
    flight: heliF(82, { tilt: 24, tiltRate: 1.9, yawRate: 52, yawResp: 2.2, climb: 9, tmax: 1.32, spool: 1.6, drag: 0.0007, vdrag: 0.02, skid: 2.05 }),
    hp: 260, stealth: 1, radar: 6000, gun: { name: "M230 30 mm chain gun", rate: 10, dmg: 14, heat: 0.02, spread: 0.004, speed: 805 }, msl: { n: 0 }, flares: 30, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1, family: "heli", blades: 4, rotorHz: 4.8 } }, 2.6);
  add("ah6", { name: "AH-6 Little Bird", short: "AH-6", cat: "heli", role: "Light attack helicopter", status: "Active · US Army SOAR", year: 1980,
    desc: "Tiny and twitchy: snaps into tilts, spins on the spot and darts sideways. Easy to over-control. Same controls as the Apache.",
    colors: { body: 0x23272b, trim: 0x2f3439, glass: 0x1a2430, accent: 0x3b4046 }, build: "littlebird", noGear: true, gearH: 1.42,
    flight: heliF(78, { tilt: 36, tiltRate: 4.2, yawRate: 110, yawResp: 5, climb: 12, tmax: 1.55, spool: 3.5, drag: 0.0011, vdrag: 0.03, skid: 1.42 }),
    hp: 110, stealth: 1, radar: 4000, gun: { name: "M134 miniguns", rate: 40, dmg: 3, heat: 0.008, spread: 0.006, speed: 850 }, msl: { n: 0 }, flares: 20, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1.2, family: "heli", blades: 5, rotorHz: 7.8 } }, 1.2);
  // speeds in mph: lever full = cruise, afterburner = boost, H = hypersonic
  const spaceF = (S) => { S.vmax = S.mph * MPH; S.vboost = S.boostMph * MPH; S.vhyper = (S.hyperMph || 22000) * MPH;
    return { model: "space", vmax: S.vboost, ref: 0, mil: S.accel, ab: S.accel * 1.6, vstall: 10, gmax: 9, roll: S.roll, pitch: S.pitch, yaw: S.yaw, ind: 0.5, eng: "rocket", space: S }; };
  const SW = "Fan-made homage for a personal game; not an official Star Wars product. ";
  add("xwing", { name: "X-Wing", short: "X-WING", cat: "space", role: "Balanced multirole starfighter", status: "Fan-made · Rebel Alliance", year: 1977,
    desc: SW + "The all-rounder: good speed, good turn, good grip. G opens and closes the S-foils (closed is faster; they open to fire). Shift boosts.",
    colors: { body: 0xd8d6cf, trim: 0x9a9890, glass: 0x1a2430, accent: 0xb3322a }, build: "xwing", engineColor: 0xff5533, noGear: true, gearH: 1.4,
    flight: spaceF({ mph: 3600, boostMph: 4600, accel: 420, decel: 520, roll: 200, pitch: 85, yaw: 45, resp: 6, grip: 2.4, foils: true, gearH: 1.4 }),
    hp: 170, stealth: 1, radar: 12000, gun: LASER(0xff3322, 9, 11), msl: { n: 4, name: "Proton torpedoes", lock: 1.0, cone: 35, range: 7000 }, flares: 20, freeOnly: true,
    unlock: { start: true }, sound: { type: "jet", pitch: 1.0, family: "space" } }, 1.0);
  add("tie", { name: "TIE Interceptor", short: "TIE/IN", cat: "space", role: "Extremely agile interceptor", status: "Fan-made · Galactic Empire", year: 1983,
    desc: SW + "Twitchy, fast and fragile: the highest turn rate of anything in the game and almost no drift. One good hit and it's gone.",
    colors: { body: 0x7d8288, trim: 0x5a5e63, glass: 0x10161e, accent: 0x7d8288 }, build: "tie", engineColor: 0x6aa0ff, noGear: true, gearH: 1.5,
    flight: spaceF({ mph: 3800, boostMph: 4800, accel: 560, decel: 650, roll: 300, pitch: 130, yaw: 80, resp: 11, grip: 4.5, gearH: 1.5 }),
    hp: 80, stealth: 1, radar: 10000, gun: LASER(0x33ff55, 12, 8), msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "jet", pitch: 1.6, family: "space", scream: true } }, 0.7);
  add("awing", { name: "A-Wing", short: "A-WING", cat: "space", role: "High-speed interceptor", status: "Fan-made · Rebel Alliance", year: 1983,
    desc: SW + "Pure speed: the fastest starfighter here, with a long boost. Turns well but slides wide at full throttle.",
    colors: { body: 0xd9d2c4, trim: 0x9c968a, glass: 0x1a2430, accent: 0xa8322b }, build: "awing", engineColor: 0xffa060, noGear: true, gearH: 0.9,
    flight: spaceF({ mph: 4000, boostMph: 5000, accel: 620, decel: 480, roll: 240, pitch: 95, yaw: 50, resp: 8, grip: 1.7, gearH: 0.9 }),
    hp: 100, stealth: 1, radar: 12000, gun: LASER(0xff3322, 10, 8), msl: { n: 6, name: "Concussion missiles", lock: 0.9, cone: 40, range: 7000 }, flares: 20, freeOnly: true,
    unlock: { start: true }, sound: { type: "jet", pitch: 1.25, family: "space" } }, 0.85);
  add("bwing", { name: "B-Wing", short: "B-WING", cat: "space", role: "Heavy assault starfighter", status: "Fan-made · Rebel Alliance", year: 1983,
    desc: SW + "A flying wall of guns: slow to roll, heavy in the turn and tough as nails. G folds the S-foils.",
    colors: { body: 0xcfc9bc, trim: 0x8f897d, glass: 0x1a2430, accent: 0x9a3a2c }, build: "bwing", engineColor: 0x7ab8ff, noGear: true, gearH: 7.6,
    flight: spaceF({ mph: 3000, boostMph: 4000, accel: 260, decel: 320, roll: 95, pitch: 48, yaw: 30, resp: 3.2, grip: 1.6, foils: true, gearH: 7.6 }),
    hp: 330, stealth: 1, radar: 12000, gun: LASER(0xff3322, 14, 10), msl: { n: 8, name: "Proton torpedoes", lock: 1.2, cone: 30, range: 7000 }, flares: 30, freeOnly: true,
    unlock: { start: true }, sound: { type: "jet", pitch: 0.75, family: "space" } }, 2.2);
  add("falcon", { name: "Millennium Falcon", short: "FALCON", cat: "space", role: "Heavy modified freighter", status: "Fan-made · Corellian YT-1300", year: 1977,
    desc: SW + "Big, heavy and stubborn: it drifts through turns like a freight truck on ice, but it's fast in a straight line and takes a beating.",
    colors: { body: 0xb9b6ad, trim: 0x8d8a82, glass: 0x1a2430, accent: 0x7a7770, glow: 0x66aaff }, build: "falcon", noGear: true, gearH: 2.7,
    flight: spaceF({ mph: 3500, boostMph: 4700, hyperMph: 26000, accel: 230, decel: 260, roll: 70, pitch: 38, yaw: 24, resp: 2.2, grip: 0.75, gearH: 2.7 }),
    hp: 600, stealth: 1, radar: 15000, gun: LASER(0xff3322, 8, 13), msl: { n: 4, name: "Concussion missiles", lock: 1.2, cone: 40, range: 7000 }, flares: 40, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 0.7, family: "space" } }, 3.2);
  add("skylark", { name: "Skylark VTOL Car", short: "SKYLARK", cat: "car", role: "Ducted-fan flying car", status: "Concept vehicle", year: 2031,
    desc: "Drive it like a car (W/S, A/D), then press G: the wheels fold and four ducted fans lift it straight up. In the air it hovers like a very stable drone. G again to land and drive.",
    colors: { body: 0x2c6fb3, trim: 0x30353b, glass: 0x162232, accent: 0x2c6fb3, glow: 0xfff3d6 }, build: "vtolcar", noGear: true, gearH: 0.76,
    flight: { model: "car", vmax: 75, ref: 0, mil: 3, ab: 0, vstall: 1, gmax: 2, roll: 40, pitch: 20, yaw: 40, ind: 1, eng: "fan",
      car: { vtol: true, acc: 6.5, brake: 11, roll: 0.8, drag: 0.0026, vmax: 52, steer: 32, steerFade: 22, wb: 2.9, ride: 0.76, wheelR: 0.36,
        fly: { tilt: 20, tiltRate: 3.2, yawRate: 70, yawResp: 4, climb: 8, tmax: 1.45, spool: 3, drag: 0.0011, vdrag: 0.03, skid: 0.76 } } },
    hp: 120, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "jet", pitch: 1.3, family: "electric" } }, 1.0);
  add("aerocar", { name: "AeroRoadster", short: "AERO", cat: "car", role: "Winged roadable aircraft", status: "Concept vehicle", year: 2028,
    desc: "A sports car with folding wings and a pusher prop. Press G to unfold the wings, accelerate down a road or runway and pull up to fly. Land on wheels, fold the wings and drive away.",
    colors: { body: 0xb33b2c, trim: 0x2e3238, glass: 0x162232, accent: 0xb33b2c, glow: 0xfff3d6 }, build: "wingcar", noGear: true, gearH: 0.81,
    flight: { model: "car", vmax: 85, ref: 2000, mil: 4.2, ab: 0, vstall: 31, gmax: 3.5, roll: 75, pitch: 16, yaw: 12, ind: 1.3, eng: "prop",
      car: { vtol: false, acc: 7.5, brake: 11, roll: 0.8, drag: 0.0028, vmax: 50, steer: 30, steerFade: 22, wb: 2.8, ride: 0.81, wheelR: 0.36 } },
    hp: 120, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "prop", pitch: 1.5, cyl: 4 } }, 1.3);
  add("rocketbike", { name: "Rocket Wing Bike", short: "R-BIKE", cat: "car", role: "Rocket motorcycle with wings", status: "One-off · built in a shed", year: 2026,
    desc: "A motorcycle: lean into corners with A/D, but lean too hard at speed and the tyres let go. Shift fires the rocket (limited boost). G deploys wings: above about 100 mph, pull back to fly. In the air it flips and rolls: land upright and pointing the way you're moving.",
    colors: { body: 0x1f2226, trim: 0x2b3036, glass: 0x1a2430, accent: 0xe06a12 }, build: "rocketbike", noGear: true, gearH: 0.34,
    flight: { model: "bike", vmax: 130, ref: 0, mil: 9, ab: 30, vstall: 45, gmax: 4, roll: 260, pitch: 110, yaw: 45, ind: 1, eng: "rocket",
      bike: { acc: 9.5, brake: 12, roll: 0.5, drag: 0.0019, vmax: 70, rocket: 22, boostTime: 5, maxLean: 52, leanRate: 6, grip: 11, ride: 0.34, wheelR: 0.34, liftoff: 45,
        airThrust: 6, cl: 0.0042, cd: 0.0011, cdw: 0.0012, align: 2.2, air: { pitch: 120, roll: 280, yaw: 55 } } },
    hp: 60, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "prop", pitch: 1, family: "motor" } }, 0.6);
  // new fixed-wing types (jet model, each with its own feel)
  add("su57", { name: "Su-57 Felon", short: "Su-57", cat: "modern", role: "Supermaneuverable stealth fighter", status: "Active · Russian Aerospace Forces", year: 2020,
    desc: "3D thrust vectoring: at low speed the nose keeps pointing where you pull, far past the stall (post-stall manoeuvres), bleeding energy fast while it does.",
    colors: { body: 0x7f8a92, trim: 0x5f6a72, glass: 0x2a3440 }, build: "su57",
    flight: { vmax: 590, ref: 11000, mil: 10, ab: 17.5, vstall: 54, gmax: 9.5, roll: 250, pitch: 33, yaw: 22, ind: 1.0, eng: "jet", tvc: true },
    hp: 140, stealth: 1.6, radar: 11000, gun: { name: "GSh-30-1 30 mm", rate: 25, dmg: 12, heat: 0.016, spread: 0.0025, speed: 870 }, msl: { n: 6, name: "Missiles (fictional loadout)", lock: 0.9, cone: 45, range: 8000 }, flares: 30,
    unlock: { start: true }, sound: { type: "jet", pitch: 0.88 } }, 0.88);
  add("c172", { name: "Cessna 172 Skyhawk", short: "C172", cat: "civil", role: "Light trainer · 4 seats", status: "Most-built aircraft ever", year: 1956,
    desc: "Slow, gentle and forgiving: a four-cylinder prop, a benign stall, and it floats on landing. Wind and turns push it around.",
    colors: { body: 0xf1f1ee, trim: 0x1f4f9a, glass: 0x1a2430, accent: 0x1f4f9a }, build: "cessna",
    flight: { vmax: 62, ref: 1500, mil: 1.9, ab: 0, vstall: 24, gmax: 3.8, roll: 55, pitch: 14, yaw: 14, ind: 1.6, eng: "prop" },
    hp: 70, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "prop", pitch: 1.3, cyl: 4 } }, 1.5);
  add("g650", { name: "Gulfstream G650", short: "G650", cat: "civil", role: "Long-range business jet", status: "In service", year: 2012,
    desc: "Smooth and quick for a passenger jet: two rear-mounted engines, a slick wing and Mach 0.925 top speed. Responsive but never twitchy.",
    colors: { body: 0xf4f4f2, trim: 0x2a2f36, glass: 0x1a2430, accent: 0x9aa1a8 }, build: "airliner",
    buildOpts: { L: 30.4, R: 1.3, half: 15.2, c0: 4.6, ct: 1.2, sweep: 0.55, dih: 0.07, engs: [], rearEng: true, nacR: 0.62, nacL: 3.6, finH: 4.4, stabHalf: 4.8, winW: 0.42, winH: 0.42, tTail: true },
    flight: { vmax: 272, ref: 13000, mil: 4.1, ab: 0, vstall: 55, gmax: 2.8, roll: 60, pitch: 10, yaw: 8, ind: 1.4, eng: "fan" },
    hp: 150, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1.2, family: "bizjet" } }, 2.0);
  add("c17", { name: "C-17 Globemaster III", short: "C-17", cat: "civil", role: "Heavy military transport", status: "Active · USAF", year: 1995,
    desc: "A 265-tonne airlifter: high wing, T-tail and four huge engines. Slow to accelerate, wide in the turn, and it lands short on rough strips.",
    colors: { body: 0x6f767c, trim: 0x5d6368, glass: 0x1a2430, accent: 0x5d6368 }, build: "airliner",
    buildOpts: { L: 53, R: 3.0, half: 25.8, c0: 11, ct: 3.4, sweep: 0.44, dih: -0.05, wingY: 0.62, engs: [8.4, 14.6], nacR: 1.15, nacL: 5.4, finH: 9.5, stabHalf: 9.6, winW: 0.3, winH: 0.3, rows: [0.3], tTail: true },
    flight: { vmax: 230, ref: 9000, mil: 2.7, ab: 0, vstall: 58, gmax: 2.5, roll: 24, pitch: 5.5, yaw: 4, ind: 2.0, eng: "fan" },
    hp: 520, stealth: 1, radar: 6000, gun: null, msl: { n: 0 }, flares: 60, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 0.8, family: "heavy" } }, 4.4);

  // racing drone: tiny, violent thrust-to-weight, flips in a blink
  add("racedrone", { name: "FPV Racing Drone", short: "DRONE", cat: "heli", role: "5-inch racing quadcopter", status: "Drone racing", year: 2016,
    desc: "A 650 g racing quad: tilts nearly flat to go fast, 0–100 km/h in about a second, and stops just as hard. Same controls as the helicopters.",
    colors: { body: 0x222428, trim: 0x111214, glass: 0x1a2430, accent: 0xe8471c }, build: "racedrone", noGear: true, gearH: 0.04,
    flight: heliF(42, { tilt: 55, tiltRate: 7, yawRate: 240, yawResp: 9, climb: 20, tmax: 3.2, spool: 10, drag: 0.004, vdrag: 0.06, skid: 0.04 }),
    hp: 12, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 2.4, family: "electric" } }, 0.15);
  // gliders: no engine at all (flight.glider); drag is tuned so the best glide comes out right
  add("wingsuit", { name: "Wingsuit", short: "WINGSUIT", cat: "civil", role: "Human flight · proximity glider", status: "BASE jumping", year: 1999,
    desc: "No engine: you glide about 2.5 m forward for every metre down at 150–180 km/h. Dive to gain speed, flare to stretch the glide. Pull up near the ground at your peril.",
    colors: { body: 0xe8471c, trim: 0x1d1f22, glass: 0x1a2430, accent: 0x1d1f22 }, build: "wingsuit", noGear: true, gearH: 0.1,
    flight: { vmax: 62, ref: 2000, mil: 6.5, ab: 0, vstall: 20, gmax: 3, roll: 140, pitch: 40, yaw: 30, ind: 1.4, eng: "prop", glider: true },
    hp: 30, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1, family: "electric" } }, 0.3);
  add("paperplane", { name: "Paper Plane (glider scale)", short: "PAPER", cat: "civil", role: "Folded dart · enlarged 1.6 m span", status: "Desk-drawer classic", year: 1909,
    desc: "A classic dart folded from one sheet, scaled up so you can ride it. No power: about 6:1 glide, floaty and slow, pushed around by every gust.",
    colors: { body: 0xf6f5f0, trim: 0xe9e7df, glass: 0x1a2430, accent: 0xcfd6e0 }, build: "paperplane", noGear: true, gearH: 0.05,
    flight: { vmax: 26, ref: 500, mil: 3.4, ab: 0, vstall: 9, gmax: 2.5, roll: 90, pitch: 30, yaw: 20, ind: 1.2, eng: "prop", glider: true },
    hp: 8, stealth: 1, radar: 0, gun: null, msl: { n: 0 }, flares: 0, freeOnly: true,
    unlock: { start: true }, sound: { type: "heavy", pitch: 1, family: "electric" } }, 0.2);

  /* ---------------- per-aircraft handling character for the jet model ----------------
   * depart: how readily it departs at the stall (wing drop / nose slice); 0 = carefree fly-by-wire.
   * torque: propeller torque yaw at low speed and high power. */
  const CHAR = { f16: { depart: 0.15 }, f22: { depart: 0.05 }, su57: { depart: 0.05 }, f35a: { depart: 0.1 }, fa18e: { depart: 0.1 }, ea18g: { depart: 0.12 },
    f15c: { depart: 0.35 }, f15ex: { depart: 0.3 }, f14: { depart: 0.75 }, f4: { depart: 1.0 }, a10: { depart: 0.25 }, f117: { depart: 0.6 }, yf23: { depart: 0.3 },
    p51: { depart: 0.8, torque: 1 }, c172: { depart: 0.2, torque: 0.5 }, aerocar: { depart: 0.3, torque: 0.4 } };
  for (const id in CHAR) if (RJ.AIRCRAFT[id]) Object.assign(RJ.AIRCRAFT[id].flight, CHAR[id]);
})(window.RJ);
