/* Ridgeline Jets — Aircraft entity and flight model.
 * Energy-based model: thrust vs. parasite/induced/wave drag along the flight path; lift turns the
 * velocity vector, limited by available lift (v/vstall)²·ρ and the airframe G limit. Gravity bends
 * the path, so stalls, energy bleed in hard turns and climbs/dives emerge naturally.
 * Ground state: takeoff roll, rotation, lift-off and landing on the gear. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, DEG = RJ.DEG;
  const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1), UP = V3(0, 1, 0);
  const WXA = {};
  const tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion();
  const tv = V3(), tv2 = V3(), tv3 = V3();

  let uid = 1;
  class Aircraft {
    constructor(id, opts = {}) {
      this.uid = uid++;
      this.id = id;
      this.spec = RJ.AIRCRAFT[id];
      this.team = opts.team || "blue";
      this.isPlayer = !!opts.player;
      this.callsign = opts.callsign || this.spec.short;
      this.mesh = RJ.buildAircraft(id, opts.livery);
      this.vis = this.mesh.userData;
      const d = this.vis.dims;
      this.radius = Math.max(d.len, d.span) * 0.36;
      this.belly = Math.max(1.2, d.height * 0.35);
      this.gearH = d.gearH || this.belly + 1.5;
      RJ.scene.add(this.mesh);
      this.pos = V3(); this.q = new THREE.Quaternion(); this.vel = V3();
      this.fwd = V3(0, 0, -1); this.up = V3(0, 1, 0); this.right = V3(1, 0, 0);
      this.speed = this.spec.flight.vmax * 0.5;
      this.throttle = 0.75; this.abLevel = 0;
      this.input = { pitch: 0, roll: 0, yaw: 0, thr: 0, thrAbs: null, ab: false, brake: false, guns: false };
      this.ctl = { pitch: 0, roll: 0, yaw: 0 };
      this.assist = opts.assist != null ? opts.assist : true;
      this.g = 1; this.aoa = 0; this.mach = 0; this.prevMach = 0; this.agl = 1000;
      this.boomArmed = false;
      this.hp = this.spec.hp; this.maxHp = this.spec.hp;
      this.alive = true; this.state = "flying";
      this.gearDown = false; this.gearT = 0; this.gearAuto = true;
      this.gunHeat = 0; this.gunCd = 0; this.overheated = false; this.firing = false;
      this.missiles = this.spec.msl.n || 0; this.flares = this.spec.flares || 0; this.bombs = this.spec.bombs || 0;
      this.mslCd = 0; this.flareCd = 0; this.bombCd = 0;
      this.target = null; this.lockT = 0; this.locked = false;
      this.lockedByT = 0; this.incoming = [];
      this.fuel = this.spec.flight.fuel || null;
      // engine core speed (0..1 of the thrust range) lags the throttle; fuel is real mass where the airframe has data
      this.spool = this.throttle; this.beta = 0;
      this.fuelKg = this.spec.flight.mFuel || 0;
      this.stats = { shots: 0, hits: 0, msl: 0, mslHits: 0, kills: 0, flares: 0, dmgTaken: 0, dmgDealt: 0 };
      this.lastHitBy = null; this.lastHitAt = -99;
      this.trailT = 0; this.fxT = 0; this.spin = V3();
      this.time = 0; this.heat = 0;
      RJ.setGear(this.mesh, 0);
    }

    place(pos, yaw, speed, opts = {}) {
      this.pos.copy(pos);
      this.q.setFromAxisAngle(UP, yaw);
      this.speed = speed != null ? speed : this.spec.flight.vmax * 0.45;
      this.ctl.pitch = this.ctl.roll = this.ctl.yaw = 0; this.gS = 1; this.trap = null;
      if (opts.ground) {
        this.state = "ground"; this.speed = 0; this.throttle = 0; this.gearDown = true; this.gearT = 1;
        this.pos.y = RJ.world.ground(pos.x, pos.z) + this.gearH + 0.35;
      } else { this.state = "flying"; this.gearDown = false; this.gearT = 0; }
      this.spool = opts.ground ? 0 : 0.8; this.beta = 0;
      RJ.setGear(this.mesh, this.gearT);
      this.updateBasis();
      this.vel.copy(this.fwd).multiplyScalar(this.speed);
      if (this.spec.flight.model && RJ.vehicles) RJ.vehicles.place(this, opts);
      this.syncMesh();
    }
    updateBasis() {
      this.fwd.set(0, 0, -1).applyQuaternion(this.q);
      this.up.set(0, 1, 0).applyQuaternion(this.q);
      this.right.set(1, 0, 0).applyQuaternion(this.q);
    }
    get bank() { return Math.atan2(-this.right.y, this.up.y); }
    get pitchAngle() { return Math.asin(RJ.clamp(this.fwd.y, -1, 1)); }
    get heading() { return (Math.atan2(this.fwd.x, -this.fwd.z) / DEG + 360) % 360; }
    get onGround() { return this.state === "ground"; }

    toggleGear() {
      if (this.spec.flight.model && RJ.vehicles) return RJ.vehicles.action(this, "gear"); // S-foils, wings, drive/fly
      if (this.alive && this.state === "flying") { this.gearDown = !this.gearDown; this.gearAuto = false; }
    }

    throttleAndFuel(dt) {
      const F = this.spec.flight, inp = this.input;
      if (inp.thrAbs != null) this.throttle = RJ.clamp(inp.thrAbs, 0, 1);
      else this.throttle = RJ.clamp(this.throttle + inp.thr * 0.7 * dt, 0, 1);
      if (inp.ab) this.throttle = Math.max(this.throttle, 0.98);
      // engine spool: a turbofan winds up slowly from idle (~4 s to military power) and quicker near the top;
      // props and rockets answer almost at once, big high-bypass fans are the laziest
      const e = F.eng, up = e === "rocket" ? 20 : e === "prop" ? 2.2 : e === "fan" ? 0.35 : 0.55, dn = e === "fan" ? 0.7 : 1.4;
      const tgt = this.fuelKg <= 0 && F.mFuel ? 0 : this.throttle;
      this.spool += (tgt - this.spool) * (1 - Math.exp(-dt * (tgt > this.spool ? up * (0.4 + 1.6 * this.spool) : dn)));
      // afterburner: lights only at military power, after a short light-off delay, and stages in over ~1.5 s
      const wantAB = inp.ab && F.ab > 0 && this.spool > 0.9 && !(F.mFuel && this.fuelKg <= 0);
      this.abT = wantAB ? (this.abT || 0) + dt : 0;
      this.abLevel = wantAB && this.abT > 0.35 ? Math.min(1, this.abLevel + dt * 0.75) : RJ.damp(this.abLevel, 0, 5, dt);
      if (this.fuel != null) {
        if (this.throttle > 0.03 && this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt * this.throttle);
        else if (this.throttle <= 0.03) this.fuel = Math.min(F.fuel, this.fuel + dt * F.fuel / 30);
      }
    }
    /** Current mass (kg) and the thrust/drag scale relative to the calibration mass (half fuel). */
    massK() {
      const F = this.spec.flight;
      if (!F.mFuel) return 1;
      return (F.mEmpty + F.mFuel * 0.5) / (F.mEmpty + this.fuelKg);
    }
    thrustAcc(rho, v, dt) {
      const F = this.spec.flight, M = this.mach;
      if (F.glider) { this.fuelFlow = 0; return 0; } // wingsuit, paper plane: gravity is the only engine
      let dry = this.spool * F.mil * RJ.thrustFactor(F.eng, rho, v, F, false, M), wet = 0;
      if (F.ab > 0) wet = this.abLevel * (F.ab - F.mil) * RJ.thrustFactor(F.eng, rho, v, F, true, M);
      else if (this.input.ab) dry *= 1.08;
      if (this.fuel != null && this.fuel <= 0) { dry = 0; wet = 0; }
      // fuel flow from thrust: TSFC × thrust (kgf); afterburner fuel is ~2.5× as thirsty per kilogram of thrust
      if (F.mFuel && dt) {
        const mRef = F.mEmpty + F.mFuel * 0.5, kgf = (x) => x * mRef / RJ.G0;
        this.fuelFlow = (kgf(dry) * F.tsfc + kgf(wet) * F.tsfcAB) / 3600; // kg/s
        let use = this.fuelFlow * dt * (RJ.settings.fuelBurn != null ? RJ.settings.fuelBurn : 1);
        // combat modes keep a reserve so a long dogfight never ends in a flameout
        const floor = RJ.game && RJ.game.mode && RJ.game.mode.kind === "fight" ? F.mFuel * 0.25 : 0;
        this.fuelKg = Math.max(Math.min(this.fuelKg, Math.max(floor, this.fuelKg - use)), 0);
      }
      return (dry + wet) * this.massK();
    }

    update(dt) {
      this.time += dt;
      if (this.state === "falling") return this.updateFalling(dt);
      if (this.remote) return; // network-driven: pose comes from the multiplayer layer
      if (!this.alive) return;
      // helicopters, starfighters, flying cars and the rocket bike have their own physics (vehicles.js)
      if (this.spec.flight.model && RJ.vehicles && RJ.vehicles.update(this, dt)) return;
      if (this.state === "ground") return this.updateGround(dt);
      const F = this.spec.flight, inp = this.input;
      const mnv = !!(RJ.mnv && (this.mnv || this.psm || this.mnvP || this.mnvY));
      if (mnv) RJ.mnv.pre(this, dt); // Cobra / Kulbit / post-stall mode (maneuvers.js)
      this.throttleAndFuel(dt);

      // control response: light fighters snap to the stick, heavy airframes wind up and coast down
      const inert = F.inertia || 1;
      const lam = (3.5 + F.roll / 70) / inert;
      this.ctl.pitch = RJ.damp(this.ctl.pitch, inp.pitch, lam, dt);
      this.ctl.roll = RJ.damp(this.ctl.roll, inp.roll, lam * 1.2, dt);
      this.ctl.yaw = RJ.damp(this.ctl.yaw, inp.yaw, lam * 0.8, dt);
      if (mnv) RJ.mnv.ctl(this);

      this.updateBasis();
      const v = Math.max(this.speed, 1), alt = this.pos.y, rho = RJ.rho(alt);
      // available lift in G: dynamic pressure over wing loading (a full-fuel jet stalls faster and pulls fewer G)
      const liftG = (v / F.vstall) * (v / F.vstall) * rho * this.massK();

      // ---- load factor ----
      let neutral = 1;
      if (this.assist) neutral = this.up.y > 0.05 ? Math.min(1 / Math.max(this.up.y, 0.35), F.gmax * 0.6, 2.8) : Math.max(0, this.up.y + 1) * 0.5;
      const p = this.ctl.pitch;
      const gCmd = p >= 0 ? neutral + p * (F.gmax - neutral) : neutral + p * (neutral + 3);
      // thrust vectoring: the nozzles add pitch force on top of wing lift, so TVC jets out-turn others when slow
      const tvcG = F.tvc ? 0.45 * this.throttle * F.mil / RJ.G0 * (1 + this.abLevel * 0.6) : 0;
      let gLim = RJ.clamp(gCmd, -Math.min(3, liftG * 0.6), Math.min(F.gmax, liftG + tvcG));
      if (this.mnvG != null) gLim = Math.min(gLim, this.mnvG); // maneuver unloads the wing
      // G onset: load builds over a fraction of a second (longer for big airplanes), no instant snaps
      this.gS = this.gS == null ? gLim : RJ.damp(this.gS, gLim, 7 / inert, dt);
      const gAct = this.gS;
      this.g = gAct;

      // ---- lift + gravity bend the flight path ----
      const aL = tv.copy(this.up).multiplyScalar(gAct * RJ.G0);
      aL.addScaledVector(this.fwd, -aL.dot(this.fwd));
      // ground effect: within about one wingspan of the ground the wing makes extra lift and less induced drag,
      // so the jet floats in the flare instead of dropping onto the runway
      const span = this.vis.dims.span, agl0 = this.agl;
      this.ge = agl0 < span * 1.2 && this.up.y > 0.7 ? RJ.clamp(1 - agl0 / (span * 1.2), 0, 1) : 0;
      if (this.ge > 0) aL.addScaledVector(this.up, RJ.G0 * 0.14 * this.ge * Math.min(1, liftG));
      const capL = F.pitch * DEG * 1.25 * v * (F.tvc ? 1.12 : 1);
      const aLm = aL.length();
      if (aLm > capL) aL.multiplyScalar(capL / aLm);
      const gp = tv2.set(0, -RJ.G0, 0);
      gp.addScaledVector(this.fwd, -gp.dot(this.fwd));
      const aP = aL.add(gp);
      const apm = aP.length();
      if (apm > 1e-5) {
        const omega = Math.min(apm / Math.max(v, 20), 3);
        const axis = tv3.copy(this.fwd).cross(aP).normalize();
        this.q.premultiply(tq.setFromAxisAngle(axis, omega * dt));
      }
      const auth = RJ.clamp(v / (F.vstall * 1.6), F.tvc ? 0.6 : 0.25, 1) * (0.55 + 0.45 * Math.sqrt(rho));
      this.q.multiply(tq.setFromAxisAngle(AZ, -this.ctl.roll * F.roll * DEG * auth * dt));
      // rudder: yaws the nose off the flight path (sideslip); the side force that builds then turns the path,
      // weakly at low dynamic pressure and strongly when fast. Directional stability recentres the nose.
      const betaMax = 0.15 * Math.min(1, auth * 1.15) * (F.tvc ? 1.15 : 1);
      this.beta = RJ.damp(this.beta || 0, this.ctl.yaw * betaMax, 3.2 / inert, dt);
      const sideA = (this.beta / 0.15) * Math.min(liftG * 0.4, 1.3) * RJ.G0;
      this.q.multiply(tq.setFromAxisAngle(AY, -(sideA / v) * dt));
      // dihedral effect: sideslip rolls the airplane gently the same way
      this.q.multiply(tq.setFromAxisAngle(AZ, -(this.beta / 0.15) * F.roll * DEG * 0.06 * auth * dt));
      if (this.assist && Math.abs(inp.roll) < 0.05) {
        const b = this.bank;
        if (Math.abs(b) < 0.4 && this.up.y > 0) this.q.multiply(tq.setFromAxisAngle(AZ, b * 0.9 * dt));
      }
      // stall departures: pulling past the lift limit drops a wing (and slices the nose) on older airframes;
      // fly-by-wire jets barely twitch. Prop torque yaws the nose left at high power and low speed.
      const stalled = p > 0.55 && liftG < gCmd * 0.92 && liftG < F.gmax;
      this.stallT = stalled ? (this.stallT || 0) + dt : Math.max(0, (this.stallT || 0) - dt * 2);
      if (F.depart && this.stallT > 0.35) {
        if (!this.dropDir) this.dropDir = Math.random() < 0.5 ? -1 : 1;
        const sev = F.depart * RJ.clamp((this.stallT - 0.35) * 2, 0, 1) * (this.assist ? 0.6 : 1);
        this.q.multiply(tq.setFromAxisAngle(AZ, this.dropDir * sev * 1.5 * dt));
        this.q.multiply(tq.setFromAxisAngle(AY, this.dropDir * sev * 0.5 * dt));
      } else if (this.stallT === 0) this.dropDir = 0;
      if (F.torque) this.q.multiply(tq.setFromAxisAngle(AY, F.torque * 0.22 * this.throttle * RJ.clamp(1.6 - v / (F.vstall * 2), 0, 1) * dt));
      this.q.normalize();
      this.updateBasis();

      // ---- speed ----
      this.mach = v / RJ.soundSpeed(alt);
      const thrust = this.thrustAcc(rho, v, dt);
      const mk = this.massK();
      const q = F.k * rho * v * v * mk * (1 + 9 * this.beta * this.beta); // sideslip adds drag
      const gearDrag = this.gearT * 0.45;
      const parasite = q * ((inp.brake ? 2.6 : 1) + gearDrag) + (inp.brake ? 5 * Math.sqrt(rho) : 0);
      // induced drag grows below corner speed: hard turns slow you down, more so when already slow
      const induced = (1 - 0.45 * (this.ge || 0)) / mk * F.ind * Math.pow(Math.max(0, Math.abs(gAct) - 1), 1.5) * RJ.clamp(Math.pow((F.corner || 200) / v, 0.8), 0.6, 2.2);
      const wave = q * RJ.waveK(F, this.mach);
      // the X-99 has its own propulsion and drag model (x99.js): cruise, afterburner and hyperboost targets
      if (F.x99 && RJ.x99) this.speed = RJ.x99.speedStep(this, dt);
      else this.speed += (thrust - parasite - induced - wave - RJ.G0 * this.fwd.y) * dt;
      this.speed = Math.max(this.speed, 12);
      this.vel.copy(this.fwd).multiplyScalar(this.speed);
      // the air mass moves: wind drifts the ground track (airspeed is relative to the air)
      const Wd = RJ.world, wx = (Wd.wx && Wd.env ? Wd.wx() : {}), wind = (wx.wind || 4) * RJ.clamp(0.6 + alt / 6000, 0.6, 2.2);
      const wxa = RJ.weather ? RJ.weather.forAircraft(this, WXA) : null;
      this.vel.x += Math.cos(4.4) * wind; this.vel.z += Math.sin(4.4) * wind;
      // gusts and storm downdrafts push the jet around; wind shear near the ground is felt as sudden sink
      if (wxa) { const gk = RJ.clamp(0.6 + alt / 6000, 0.6, 1.6); this.vel.x += wxa.gx * gk; this.vel.z += wxa.gz * gk; this.vel.y += wxa.down; }
      this.pos.addScaledVector(this.vel, dt);
      // turbulence: mechanical bumps low over terrain and buildings, convective in cloud and storms
      const tk = ((1 - RJ.smooth(30, 900, this.agl)) * (0.45 + (wx.wind || 4) / 18) + (wx.dark || 0) * 0.6 + (this.isPlayer ? (Wd.inCloud || 0) * 0.8 : 0) + (wxa ? wxa.turb : 0)) * RJ.clamp(v / 220, 0.35, 1.3);
      if (tk > 0.02) {
        const t = this.time + this.uid * 13.7;
        const n1 = Math.sin(t * 1.9) * Math.sin(t * 3.7 + 1.3) + 0.5 * Math.sin(t * 7.3 + 0.4), n2 = Math.sin(t * 2.3 + 2.1) * Math.sin(t * 5.1) + 0.5 * Math.sin(t * 8.9 + 3);
        this.q.multiply(tq.setFromAxisAngle(AX, n1 * tk * 0.05 * dt * 6));
        this.q.multiply(tq.setFromAxisAngle(AZ, n2 * tk * 0.07 * dt * 6));
        this.pos.y += (Math.sin(t * 2.7) + Math.sin(t * 6.1 + 1)) * tk * 1.2 * dt;
      }
      this.turb = tk;
      // aerodynamic buffet as the wing nears its lift limit (and in the stall)
      this.buffet = p > 0.25 ? RJ.clamp((gAct / Math.max(liftG, 0.05) - 0.82) / 0.2, 0, 1) : 0;
      if (this.pos.y > 40000) this.pos.y = 40000;

      // post-stall: TVC jets can hold the nose far above the flight path (up to ~65°) when slow and pulling hard
      const ps = F.tvc && p > 0.6 && liftG < F.gmax ? RJ.smooth(0.6, 1, p) * RJ.clamp(1.6 - v / (F.vstall * 2.2), 0, 1) : 0;
      const aoaT = Math.max(RJ.clamp(0.26 * gAct * (F.vstall / v) * (F.vstall / v) / Math.max(rho, 0.04), -0.15, 0.42), ps * 1.1);
      if (ps > 0.05) this.speed -= ps * this.aoa * 14 * dt; // high-alpha drag bleeds energy fast
      this.aoa = RJ.damp(this.aoa, aoaT, 6, dt);
      if (mnv) RJ.mnv.post(this, dt);

      this.checkBoom();

      // ---- gear: auto-retract after takeoff, drag while down ----
      const gnd = RJ.world.ground(this.pos.x, this.pos.z);
      this.agl = this.pos.y - gnd;
      if (this.gearAuto && this.gearDown && this.agl > 45 && this.vel.y > 0 && this.speed > F.vstall * 1.3) this.gearDown = false;
      this.gearT = RJ.clamp(this.gearT + (this.gearDown ? 1 : -1) * dt / 3.5, 0, 1);

      // ---- touchdown or crash ----
      const contact = this.gearT > 0.95 ? this.gearH : this.belly;
      if (this.agl < contact) {
        const okLanding = this.gearT > 0.95 && gnd > 0.5 && this.vel.y > -7 && Math.abs(this.bank) < 0.3 && this.fwd.y > -0.12 && this.groundSlope() < 0.08 && !RJ.world.isWaterAt(this.pos.x, this.pos.z);
        if (okLanding) this.touchdown(gnd);
        else this.destroy(null, gnd <= 0.5 ? "water" : "terrain");
      }
      if (this.state === "flying" && (RJ.atlas && RJ.atlas.built ? RJ.atlas.solidAt(this.pos) : RJ.world.castle && RJ.castle.solidAt(this.pos))) this.destroy(null, "terrain");
      // very fast movers sweep through more than a building's width per step: test the midpoint too
      if (this.state === "flying" && this.speed * dt > 5) {
        const mx = this.pos.x - this.vel.x * dt * 0.5, my = this.pos.y - this.vel.y * dt * 0.5, mz = this.pos.z - this.vel.z * dt * 0.5;
        if (my < RJ.world.ground(mx, mz) || (RJ.atlas && RJ.atlas.built && RJ.atlas.solidAt(tv.set(mx, my, mz)))) { this.pos.set(mx, my, mz); this.destroy(null, "terrain"); }
      }
      this.timers(dt);
    }

    groundSlope() {
      const x = this.pos.x, z = this.pos.z, W = RJ.world;
      return Math.max(Math.abs(W.ground(x + 8, z) - W.ground(x - 8, z)), Math.abs(W.ground(x, z + 8) - W.ground(x, z - 8))) / 16;
    }
    touchdown(gnd) {
      this.state = "ground";
      const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
      this.q.setFromAxisAngle(UP, yaw);
      this.pos.y = gnd + this.gearH + 0.35;
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      this.groundPitch = 0;
      this.trap = null;
      // carrier deck: catch an arresting wire with the hook
      const K = RJ.carrier;
      if (K && K.site && K.onDeck(this.pos.x, this.pos.z)) { const w = K.wireAt(this.pos.x, this.pos.z); if (w > 0) this.trap = { wire: w }; }
      RJ.emit("touchdown", this);
    }

    /** Takeoff roll / landing rollout: wheels on the ground, nosewheel steering, rotation and lift-off. */
    updateGround(dt) {
      const F = this.spec.flight, inp = this.input;
      this.throttleAndFuel(dt);
      this.gearT = 1; this.gearDown = true;
      const rho = RJ.rho(this.pos.y), v = this.speed;
      const thrust = this.thrustAcc(rho, Math.max(v, 1), dt);
      const drag = F.k * rho * v * v * 1.45 * (inp.brake ? 2 : 1) * this.massK();
      const roll = 0.18 + (inp.brake ? 5.4 : 0) + (this.trap ? 30 : 0); // wheel brakes; a carrier wire stops a jet in ~100 m
      this.speed = Math.max(0, v + (thrust - drag - (v > 0.1 ? roll : 0)) * dt);
      // steering: nosewheel at low speed, rudder at high speed
      const steer = RJ.clamp(inp.yaw + inp.roll * 0.6, -1, 1);
      const yawRate = steer * (0.45 * RJ.clamp(1 - v / 90, 0.15, 1) + F.yaw * DEG * 0.4 * RJ.clamp(v / 120, 0, 1));
      let yaw = Math.atan2(-this.fwd.x, -this.fwd.z) - yawRate * dt;
      // rotation: once there's enough lift, back pressure raises the nose
      const liftG = (v / F.vstall) * (v / F.vstall) * rho;
      this.groundPitch = this.groundPitch || 0;
      const want = liftG > 0.75 && inp.pitch > 0.05 ? inp.pitch * 0.22 : 0;
      this.groundPitch = RJ.damp(this.groundPitch, want, 2.5, dt);
      this.q.setFromAxisAngle(UP, yaw);
      this.q.multiply(tq.setFromAxisAngle(AX, this.groundPitch));
      this.updateBasis();
      const gnd = RJ.world.ground(this.pos.x, this.pos.z);
      const flatFwd = tv.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      this.pos.addScaledVector(flatFwd, this.speed * dt);
      const gNew = RJ.world.ground(this.pos.x, this.pos.z);
      // rolled off a ledge (the carrier's bow or angled deck, a castle terrace): airborne again, not "on the ground" 20 m lower
      if (gNew < gnd - 3) {
        this.state = "flying"; this.trap = null;
        this.vel.copy(flatFwd).multiplyScalar(this.speed);
        this.gearAuto = true;
        RJ.emit("liftoff", this);
        this.timers(dt);
        return;
      }
      this.pos.y = gNew + this.gearH + 0.35;
      this.vel.copy(flatFwd).multiplyScalar(this.speed);
      this.agl = this.gearH;
      this.g = 1; this.aoa = 0;
      this.mach = this.speed / RJ.soundSpeed(this.pos.y);
      // lift-off
      if (liftG * Math.cos(this.groundPitch) > 1.05 && this.groundPitch > 0.05) {
        this.state = "flying";
        this.vel.copy(this.fwd).multiplyScalar(this.speed);
        this.pos.y += 0.3;
        this.gearAuto = true; this.trap = null;
        RJ.emit("liftoff", this);
      }
      // rolled off the pad into rough ground
      const K = RJ.carrier, onShip = K && K.site && K.heightAt(this.pos.x, this.pos.z) > 0; // deck edges are ledges, not rough ground
      if (this.groundSlope() > 0.25 && this.speed > 25 && !onShip) this.destroy(null, "terrain");
      this.timers(dt);
    }

    checkBoom() {
      // Fire once on the way through Mach 1; re-arm only after dropping back below Mach 0.97.
      if (!this.boomArmed && this.mach < 0.97) this.boomArmed = true;
      if (this.boomArmed && this.mach >= 1.0 && this.time > 0.8) { this.boomArmed = false; RJ.emit("sonicboom", this); }
      this.prevMach = this.mach;
    }

    timers(dt) {
      this.mslCd = Math.max(0, this.mslCd - dt);
      this.flareCd = Math.max(0, this.flareCd - dt);
      this.bombCd = Math.max(0, this.bombCd - dt);
      this.gunCd = Math.max(0, this.gunCd - dt);
      if (!this.firing) this.gunHeat = Math.max(0, this.gunHeat - dt * 0.28);
      if (this.overheated && this.gunHeat < 0.35) this.overheated = false;
      this.lockedByT = Math.max(0, this.lockedByT - dt);
      if (RJ.vehicles && this.mach > 2.8) RJ.vehicles.heat(this, dt);
      else if (this.heatGlow) this.heatGlow.visible = false;
    }

    damage(amount, attacker, kind) {
      if (!this.alive) return;
      // a jet owned by another player's game: tell that game, it applies the damage itself
      if (this.remote) { if (attacker && !attacker.remote && RJ.mp) RJ.mp.reportHit(this, amount, attacker, kind); return; }
      this.hp -= amount;
      this.stats.dmgTaken += amount;
      if (attacker && attacker !== this) { this.lastHitBy = attacker; this.lastHitAt = this.time; attacker.stats.dmgDealt += amount; }
      RJ.emit("damage", { ac: this, amount, attacker, kind });
      if (this.hp <= 0) this.destroy(attacker, kind);
    }

    destroy(attacker, cause) {
      if (!this.alive) return;
      this.alive = false;
      this.hp = 0;
      const credited = attacker || (this.lastHitBy && this.time - this.lastHitAt < 12 ? this.lastHitBy : null);
      RJ.emit("destroyed", { ac: this, by: credited, cause });
      if (cause === "terrain" || cause === "water") { this.finalBlast(cause); return; }
      this.state = "falling";
      this.fallT = 0;
      this.spin.set(RJ.rand(-1.5, 1.5), RJ.rand(-0.6, 0.6), RJ.rand(-3, 3));
      const MF = RJ.missileFx;
      if (MF) MF.jetBlast(this);
      else RJ.fx.explosion(this.pos, 1 + this.radius / 12, this.vel);
      RJ.fx.debris(this.pos, this.vel, 1);
      RJ.emit("explosion", { pos: this.pos.clone(), big: 1 });
    }

    finalBlast(cause) {
      this.state = "dead";
      this.mesh.visible = false;
      const s = 1.4 + this.radius / 10;
      RJ.fx.explosion(this.pos, s, null);
      if (cause === "water" || this.pos.y < 3) { RJ.fx.splash(this.pos, s * 0.8); RJ.emit("splash", { pos: this.pos.clone() }); }
      else RJ.fx.dust(this.pos, s * 0.8);
      RJ.emit("explosion", { pos: this.pos.clone(), big: 1.4 });
    }

    updateFalling(dt) {
      this.fallT += dt;
      this.vel.y -= RJ.G0 * dt;
      this.vel.multiplyScalar(Math.pow(0.92, dt));
      this.pos.addScaledVector(this.vel, dt);
      this.q.multiply(tq.setFromEuler(new THREE.Euler(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt)));
      this.fxT += dt;
      if (this.fxT > 0.03) {
        this.fxT = 0;
        RJ.fx.fire(this.pos, this.vel.clone().multiplyScalar(0.2), 5 + this.radius * 0.3);
        RJ.fx.smoke(this.pos, this.vel.clone().multiplyScalar(0.1), (4 + this.radius * 0.3) * (0.7 + Math.random() * 0.6), 0.14, 6, 0.42);
        // burning fuel streaming off the wreck
        if (this.fallT < 6) RJ.fx.fireP.spawn(this.pos.x, this.pos.y, this.pos.z, this.vel.x * 0.55, this.vel.y * 0.55 + 3, this.vel.z * 0.55, 0.5 + Math.random() * 0.4, 3 + this.radius * 0.2, 9 + this.radius * 0.5, 1, 0.5, 0.15, 0.85, 3, 1.2);
      }
      const gnd = RJ.world.ground(this.pos.x, this.pos.z);
      if (this.pos.y < gnd + 1 || this.fallT > 14) { this.pos.y = Math.max(this.pos.y, gnd); this.finalBlast(gnd <= 0.5 ? "water" : "terrain"); }
      this.syncMesh();
    }

    syncMesh() {
      if (this.lodFar) return; // drawn as an instanced silhouette (combat.drawCrowd)
      this.mesh.position.copy(this.pos);
      this.mesh.quaternion.copy(this.q);
      if (this.state === "flying" && !this.spec.flight.model) { this.mesh.quaternion.multiply(tq2.setFromAxisAngle(AX, this.aoa)); if (this.beta) this.mesh.quaternion.multiply(tq2.setFromAxisAngle(AY, -this.beta)); if (this.mnvP || this.mnvY) RJ.mnv.pose(this, this.mesh.quaternion); }
      // keep world matrices current so cockpit camera and trail emitters don't lag a frame behind
      this.mesh.updateMatrixWorld(true);
    }

    /** Animate surfaces, exhaust, gear and emit trails. */
    updateVisual(dt) {
      if (this._crib && this.state !== "flying") RJ.missileFx.contrail(this, null); // shot down: the trail stops here
      if (this.state === "dead") return;
      if (RJ.combat.crowd && !this.isPlayer) {
        // big battles: animate AI aircraft once per rendered frame (not every 120 Hz physics step), and distant
        // ones (drawn as silhouettes) only every 4th frame for their trails
        this._vdt = (this._vdt || 0) + dt;
        const fr = RJ.fx.frame || 0;
        if (this._vfr === fr) return;
        this._vfr = fr;
        if (this.lodFar && (fr + this.uid) % 4) return;
        dt = this._vdt; this._vdt = 0;
      }
      this.syncMesh();
      if (this.state === "falling") return;
      const vis = this.vis, F = this.spec.flight;
      RJ.setGear(this.mesh, this.gearT * this.gearT * (3 - 2 * this.gearT));
      const flick = 0.92 + Math.random() * 0.16;
      const machBoost = RJ.smooth(0.7, 1.4, this.mach) * 0.35;
      const burning = this.fuel == null || this.fuel > 0;
      // afterburner ignition: a quick flash and lengthening as the burner lights; the cut-off fades with abLevel
      if (this.abLevel > 0.2 && !this._abLit) {
        this._abLit = true; this.abKick = 1;
        if (vis.flames.length && RJ.camera && this.pos.distanceTo(RJ.camera.position) < 2500) {
          for (const f of vis.flames) if (!f.small) { const p = this.mesh.localToWorld(tv.copy(f.flame.position)); RJ.fx.fire(p, tv2.copy(this.vel).multiplyScalar(0.85), f.r * 2.2); }
        }
      } else if (this.abLevel < 0.08) this._abLit = false;
      const kick = (this.abKick = Math.max(0, (this.abKick || 0) - dt * 3.2));
      // distance LOD: far away the diamond core is invisible anyway, so skip drawing it
      const camD = RJ.camera ? this.pos.distanceTo(RJ.camera.position) : 0, near = camD < 2500;
      // atmosphere: thin air lets the under-expanded jet balloon — a longer, wider plume with fewer, farther-spaced
      // diamonds; dense low air mixes it out short with tight, crisp diamonds. Engine output follows the spool.
      const amb = RJ.atmo(this.pos.y).delta, thin = 1 - amb, sp = this.spool == null ? this.throttle : this.spool;
      const lenK = 1 + thin * 0.7 - RJ.smooth(0.8, 2.2, this.mach) * 0.15, widK = 1 + thin * 0.55 * this.abLevel;
      const dsp = 1.25 - thin * 0.6, dvis = 0.45 + amb * 0.55;
      for (const f of vis.flames) {
        const U = f.mat.uniforms, CU = f.coreMat ? f.coreMat.uniforms : null;
        U.time.value += dt;
        let s, ab, power = this.throttle, halo, glow;
        if (F.model === "space") {
          // starfighter drives: always lit, afterburner and hypersonic stretch them into long white-hot plumes
          const hy = this.hyperK || 0, a = Math.max(this.abLevel, hy);
          s = (0.35 + this.throttle * 0.45 + this.abLevel * 2.2 + hy * 5) * flick; ab = a; power = 0.6 + a * 0.4;
          f.flame.scale.set(f.r * (1 + a * 0.35), f.r * (1 + a * 0.35), s);
          glow = Math.min(1, 0.45 + this.throttle * 0.25 + a * 0.6);
          f.glow.scale.setScalar(1 + a * 1.2 + hy * 1.5);
          halo = 0.25 + a * 0.6;
        } else {
          if (f.rocket) { const on = this.throttle > 0.03 && burning; s = on ? (1.0 + this.throttle * 1.1) * flick : 0.01; ab = on ? 1 : 0; power = on ? 1 : 0; }
          else if (f.small) { s = (0.1 + this.throttle * 0.16) * flick; ab = 0; }
          // dry power: a short, faint plume that only shows near full throttle; afterburner: long and blazing
          else { s = (0.05 + sp * sp * 0.26 + this.abLevel * (1.75 + machBoost) * lenK + kick * 0.6 * this.abLevel + (this.x99Hyper || 0) * 4.5) * flick * Math.sqrt(f.r / 0.5); ab = Math.max(this.abLevel, this.x99Hyper || 0); power = sp; }
          const wr = f.r * (1 + ab * 0.18 * widK + kick * 0.15) * (f.rocket || f.small ? 1 : widK);
          f.flame.scale.set(wr, wr, Math.max(0.01, s));
          // variable nozzle: open at idle, closed down at military power, flared wide when the burner lights
          if (f.lip) { const o = 0.94 + (1 - sp) * 0.08 + ab * 0.16; f.lip.scale.set(o, o, 1); if (f.nozzle) f.nozzle.scale.set(0.96 + o * 0.04, 0.96 + o * 0.04, 1); }
          glow = f.small ? 0.15 : 0.12 + sp * 0.3 + ab * 0.5 + kick * 0.4;
          halo = f.small ? 0.05 : sp * sp * 0.12 + ab * 0.55 + kick * 0.7;
        }
        U.power.value = power; U.ab.value = ab; U.kick.value = kick; U.dsp.value = dsp; U.dvis.value = dvis;
        f.glow.material.opacity = Math.min(1, glow);
        if (f.halo) {
          f.halo.material.opacity = Math.min(1, halo) * (0.85 + Math.random() * 0.15);
          f.halo.scale.setScalar(f.r * (2.0 + ab * 1.8 + kick * 3.5));
        }
        if (f.core) {
          f.core.visible = near && ab > 0.03 && !f.small;
          if (f.core.visible) { CU.time.value = U.time.value; CU.ab.value = ab; CU.kick.value = kick; CU.power.value = power; CU.dsp.value = dsp; CU.dvis.value = dvis; }
        }
      }
      if (F.model && RJ.vehicles) RJ.vehicles.visual(this, dt);
      // hot nozzles glow dull orange at high power
      this.heat = RJ.damp(this.heat, sp * sp * 0.3 + this.abLevel * 0.8 + (this.abKick || 0) * 0.3, 1.5, dt);
      const metal = vis.materials && vis.materials.metal;
      if (metal) metal.emissive.setRGB(0.9 * this.heat, 0.3 * this.heat, 0.08 * this.heat);
      const pitch = this.ctl.pitch, roll = this.ctl.roll;
      for (const st of vis.stabs) st.grp.rotation.x = RJ.clamp((st.canard ? 0.3 : -0.3) * pitch + st.s * roll * 0.18, -0.45, 0.45);
      for (const sw of vis.sweep) sw.grp.rotation.y = -sw.s * RJ.lerp(sw.min, sw.max, RJ.smooth(sw.mach[0], sw.mach[1], this.mach));
      // ailerons, flaps and rudders follow the (smoothed) stick; flaps drop with the gear or at low speed
      const flapT = RJ.clamp(Math.max(this.gearT, 1 - (this.speed - F.vstall * 1.2) / (F.vstall * 0.8)), 0, 1);
      // speed brake (B in flight): fighters split their surfaces like an F-22 / F-18 — ailerons up, flaps down,
      // twin rudders toed out — so you can see the brake working
      this.brakeT = RJ.damp(this.brakeT || 0, this.input.brake && this.state === "flying" ? 1 : 0, 5, dt);
      const bk = this.brakeT;
      if (vis.ailerons) for (const ai of vis.ailerons) ai.grp.rotation.x = -roll * 0.38 * ai.s - pitch * 0.06 - bk * 0.45;
      if (vis.flaps) for (const fl of vis.flaps) fl.grp.rotation.x = 0.5 * Math.max(flapT, bk * 0.8) - roll * 0.08 * fl.s;
      if (vis.rudders) for (const ru of vis.rudders) ru.grp.rotation.y = -this.ctl.yaw * 0.42 - roll * 0.06 + (ru.s || 0) * bk * 0.45;
      if (vis.nav) { const t = this.time % 1.3; vis.nav.strobe.color.setScalar(t < 0.06 || (t > 0.16 && t < 0.2) ? 5 : 0); }
      for (const pr of vis.props) { pr.hub.rotation.z += dt * (25 + this.throttle * 55); pr.disc.material.opacity = 0.12 + this.throttle * 0.12; }
      for (const dr of vis.droop) dr.grp.rotation.z = -dr.s * (RJ.smooth(0.9, 1.4, this.mach) * 0.44 + RJ.smooth(1.4, 2.5, this.mach) * 0.7);
      if (this.state !== "flying") return;

      // ---- trails ----
      this.trailT += dt;
      if (this.trailT < 0.03) return;
      this.trailT = 0;
      const m = this.mesh;
      const ndl = vis.nozzles.length || 1;
      const alt = this.pos.y;
      const c0 = (RJ.game && RJ.game.contrailAlt) || 7800; // the Air War sets a lower contrail level (a cold, humid day)
      if (alt > c0 && alt < 22000 && F.eng !== "rocket" && F.eng !== "prop") {
        const a = 0.55 * RJ.smooth(c0, c0 + 1700, alt) * (1 - RJ.smooth(18000, 22000, alt));
        if (RJ.combat.crowd && !this.isPlayer && RJ.missileFx) {
          // big battles: one continuous ribbon contrail per jet (cheap, and readable from 10 km away)
          RJ.missileFx.contrail(this, m.localToWorld(tv.copy(vis.nozzles[0] || tv.set(0, 0, 4))));
        } else {
          const every = Math.max(1, Math.round(ndl / 4));
          vis.nozzles.forEach((n, i) => { if (i % every === 0) RJ.fx.contrail(m.localToWorld(tv.copy(n)), this.vel, 1.8 + this.radius * 0.06, a); });
        }
      } else if (this._crib) RJ.missileFx.contrail(this, null);
      const g = Math.abs(this.g);
      const gThresh = F.gmax > 5 ? 4.5 : 1.8;
      const hum = RJ.sonic ? RJ.sonic.humidity(this) : 0.5;
      if (RJ.fx.wingVapor) RJ.fx.wingVapor(this); // wingtip vortices and over-wing vapor in hard pulls (fx.js)
      const hpF = this.hp / this.maxHp;
      if (hpF < 0.5) {
        const n = vis.nozzles[0] || V3(0, 0, 4);
        const p = m.localToWorld(tv.copy(n));
        RJ.fx.smoke(p, tv2.copy(this.vel).multiplyScalar(0.05), 2 + this.radius * 0.1, hpF < 0.25 ? 0.12 : 0.45, 3.5, 0.6);
        if (hpF < 0.25) RJ.fx.fire(p, tv2.copy(this.vel).multiplyScalar(0.3), 2.2);
      }
      if (this.fuel != null && this.throttle > 0.03 && this.fuel > 0) {
        for (const n of vis.nozzles) RJ.fx.smoke(m.localToWorld(tv.copy(n)), tv2.copy(this.vel).multiplyScalar(0.05), 1.5, 0.85, 2.5, 0.25);
      }
    }

    dispose() {
      if (this._crib) RJ.missileFx.contrail(this, null);
      RJ.scene.remove(this.mesh);
      this.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
  RJ.Aircraft = Aircraft;
})(window.RJ);
