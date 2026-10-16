/* Ridgeline Jets — game modes: Free Flight (roam, ring courses, low-level) and Dogfight (duel, 2v2, 4v4, survival). */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3;
  const M = {};
  RJ.modes = M;

  /* ---------------- shared helpers ---------------- */
  M.highestAround = function (x, z, radius = 2500, n = 5) {
    let m = 0;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) m = Math.max(m, RJ.world.heightFn(x + (i / n) * radius, z + (j / n) * radius));
    return m;
  };
  const dirFromYaw = (yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const yawFromDir = (d) => Math.atan2(-d.x, -d.z);

  function makePlayer(id, pos, yaw, speed, ground) {
    const ac = new RJ.Aircraft(id, { team: "blue", player: true, assist: RJ.settings.assist, callsign: "You" });
    ac.place(pos, yaw, speed, { ground: !!ground });
    RJ.combat.add(ac);
    RJ.audio.setPlayerEngine(ac.spec);
    return ac;
  }
  function cruiseSpeed(spec) { return Math.min(spec.flight.vmax * 0.55, Math.max(spec.flight.vstall * 2.6, 170)); }

  /** Track records and challenges for the player in any mode. */
  M.trackChallenges = function (pl, ctx) {
    if (!pl || !pl.alive) return;
    const rec = RJ.progress.records;
    if (pl.mach > rec.mach + 0.01) { rec.mach = pl.mach; M._dirty = true; }
    if (pl.pos.y > rec.alt + 5) { rec.alt = pl.pos.y; M._dirty = true; }
    if (pl.mach >= 1) RJ.completeChallenge("mach1");
    if (pl.mach >= 3) RJ.completeChallenge("mach3");
    if (pl.mach >= 5) RJ.completeChallenge("mach5");
    if (pl.pos.y >= 18000) RJ.completeChallenge("alt18k");
    if (pl.spec.cat === "bomber" && pl.mach >= 1) RJ.completeChallenge("bombsonic");
    if (ctx && ctx.lowTime >= 30) RJ.completeChallenge("lowlevel");
  };

  /* ---------------- rings ---------------- */
  let ringGeo = null;
  function ringMesh(radius) {
    if (!ringGeo) ringGeo = new THREE.TorusGeometry(1, 0.07, 10, 48);
    const g = new THREE.Group();
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.95, fog: false }));
    g.add(m);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.93, 40), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    g.add(disc);
    g.scale.setScalar(radius);
    m.layers.set(RJ.LATE); disc.layers.set(RJ.LATE);
    g.userData = { ring: m, disc };
    return g;
  }

  /** Valley-following course: each step picks the lowest heading ahead, so rings thread canyons and passes. */
  function valleyCourse(start, yaw, n, opts) {
    const pts = [];
    let p = V3(start.x, 0, start.z), dir = dirFromYaw(yaw);
    const step = opts.step;
    for (let i = 0; i < n; i++) {
      let best = null, bc = Infinity;
      for (let a = -60; a <= 60; a += 10) {
        const d = dir.clone().applyAxisAngle(V3(0, 1, 0), a * RJ.DEG);
        const p1 = p.clone().addScaledVector(d, step), p2 = p.clone().addScaledVector(d, step * 2);
        const h1 = RJ.world.heightFn(p1.x, p1.z), h2 = RJ.world.heightFn(p2.x, p2.z);
        const c = Math.max(h1, 0) + Math.max(h2, 0) * 0.6 + Math.abs(a) * opts.turnCost;
        if (c < bc) { bc = c; best = { d, p1, h1 }; }
      }
      dir = best.d; p = best.p1;
      const y = Math.max(best.h1, 0) + RJ.rand(opts.alt[0], opts.alt[1]);
      pts.push(V3(p.x, y, p.z));
    }
    // raise rings so the straight line between them clears terrain
    for (let i = 0; i < pts.length; i++) {
      const a = i ? pts[i - 1] : V3(start.x, pts[0].y, start.z), b = pts[i];
      for (let s = 0.2; s <= 1.0; s += 0.2) {
        const gx = a.x + (b.x - a.x) * s, gz = a.z + (b.z - a.z) * s, gy = a.y + (b.y - a.y) * s;
        const h = Math.max(RJ.world.heightFn(gx, gz), 0) + opts.clear;
        if (gy < h) b.y += (h - gy) / Math.max(s, 0.2);
      }
    }
    return pts;
  }

  /** Aircraft small and slow enough for carrier operations. */
  M.carrierOK = (spec) => !["b52", "b2", "b21", "b1b", "xb70"].includes(spec.id) && spec.flight.vstall <= 95;
  M.ringMesh = ringMesh;
  M.valleyCourse = valleyCourse;
  M.makePlayer = makePlayer;
  M.cruiseSpeed = cruiseSpeed;
  M.COURSES = {
    canyon: { name: "Canyon Run", region: "canyon", n: 20, step: 520, alt: [60, 95], clear: 25, turnCost: 1.5, weather: "clear", challenge: "canyon" },
    mountain: { name: "Mountain Pass", region: "mountains", n: 18, step: 650, alt: [120, 220], clear: 40, turnCost: 2.5, weather: "scattered" },
    islands: { name: "Island Sprint", region: "ocean", n: 16, step: 700, alt: [35, 70], clear: 25, turnCost: 0.4, weather: "scattered" }
  };
  M.ACTIVITIES = [
    { id: "roam", name: "Free roam", desc: "No goals. Fly anywhere, drop bombs in a bomber, chase records." },
    { id: "canyon", name: "Canyon Run", desc: "20 rings down a winding desert canyon. Unlocks the F-117." },
    { id: "mountain", name: "Mountain Pass", desc: "18 rings through snowy valleys between the peaks." },
    { id: "islands", name: "Island Sprint", desc: "16 rings skimming the waves between islands." },
    { id: "lowlevel", name: "Low-level challenge", desc: "3 minutes. Score time spent below 60 m above the ground." }
  ];
  M.REGIONS = [
    { id: "mountains", name: "Mountains" }, { id: "canyon", name: "Canyons" }, { id: "desert", name: "Desert" },
    { id: "ocean", name: "Ocean and islands" }, { id: "forest", name: "Forest valleys" }, { id: "clouds", name: "Above the clouds" }
  ];

  /* ======================= FREE FLIGHT ======================= */
  class FreeFlight {
    constructor(o) { this.o = o; this.kind = "free"; }
    async setup(progress) {
      const o = this.o;
      const course = M.COURSES[o.activity];
      const regionId = course ? course.region : o.region;
      const weather = course ? (o.weather === "default" ? course.weather : o.weather) : o.weather;
      const env = { time: o.time, weather: regionId === "clouds" && o.weather === "scattered" ? "cloudsea" : weather };
      RJ.world.setEnvironment(env);
      RJ.atlas.ensure();
      const reg = RJ.world.findRegion(regionId);
      let pos, yaw = reg.yaw;
      const spec = RJ.AIRCRAFT[o.aircraft];
      if (course) {
        this.rings = valleyCourse(V3(reg.x, 0, reg.z), yaw, course.n, course);
        const first = this.rings[0];
        const back = dirFromYaw(yaw).multiplyScalar(-1600);
        pos = V3(reg.x + back.x, 0, reg.z + back.z);
        pos.y = Math.max(first.y + 60, M.highestAround(pos.x, pos.z, 800, 3) + 120);
        yaw = yawFromDir(V3(first.x - pos.x, 0, first.z - pos.z));
        this.ringR = Math.max(28, spec ? 0 : 0);
      } else {
        pos = V3(reg.x, 0, reg.z);
        const top = M.highestAround(pos.x, pos.z, 2500, 4);
        pos.y = regionId === "clouds" ? Math.max(top + 600, RJ.world.cloudTop + 700) : o.activity === "lowlevel" ? top + 250 : top + 600;
      }
      // "Fly there" from the atlas: start a few km out from a logged landmark, pointed at it
      const near = !course && o.near && RJ.atlas.byId[o.near];
      if (near) {
        const mk = near.marker, h = RJ.atlas.home;
        let dx = h.x - mk.x, dz = h.z - mk.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        pos = V3(mk.x + dx * 4200, 0, mk.z + dz * 4200);
        pos.y = Math.max(M.highestAround(pos.x, pos.z, 1200, 3) + 260, Math.min(mk.y + 150, M.highestAround(pos.x, pos.z, 1200, 3) + 900));
        yaw = yawFromDir(V3(-dx, 0, -dz));
      }
      // Carrier start: on the bow catapult, launched off the deck
      const K = RJ.carrier, spec0 = RJ.AIRCRAFT[o.aircraft];
      this.carrierStart = !course && !near && o.activity === "roam" && o.start === "carrier" && K && K.site && M.carrierOK(spec0);
      if (this.carrierStart) {
        const cat = K.CATS[0], [cx, cz] = K.toWorld(cat.x, cat.z), [fx, fz] = K.toWorld(cat.x, cat.z - 10);
        pos = V3(cx, K.DECK + 3, cz); yaw = yawFromDir(V3(fx - cx, 0, fz - cz).normalize());
      }
      // Runway start: a mountain airbase laid along the valley floor
      this.runway = !course && !near && !this.carrierStart && o.activity === "roam" && o.start === "runway" && regionId !== "ocean" && regionId !== "clouds";
      if (this.runway) {
        const ab = regionId === "mountains" ? RJ.atlas.home.ab : RJ.world.planAirbase(reg.x, reg.z, reg.yaw);
        RJ.world.setAirbase(ab);
        pos = V3(ab.x - ab.dx * (ab.len / 2 - 120), 0, ab.z - ab.dz * (ab.len / 2 - 120));
        yaw = ab.yaw;
      } else if (RJ.world.airbase) RJ.world.setAirbase(null);
      // light the view ahead: at low sun angles put the sun behind the pilot's right shoulder
      // so the castle and the range ahead are side-lit instead of hidden in glare
      if (!course && regionId === "mountains" && ["dawn", "golden", "sunset", "morning"].includes(o.time)) {
        RJ.world.setEnvironment(Object.assign({}, env, { sunAz: ((-yaw / RJ.DEG + 150) % 360 + 360) % 360 }));
      }
      await RJ.world.prepare(pos, progress);
      const onDeck = this.runway || this.carrierStart;
      this.player = makePlayer(o.aircraft, pos, yaw, onDeck ? 0 : cruiseSpeed(RJ.AIRCRAFT[o.aircraft]), onDeck);
      this.player.throttle = onDeck ? 0 : 0.8;
      if (this.carrierStart) this.cat = { state: "hook", t: 0, x: pos.x, z: pos.z, yaw };
      RJ.game.allowBombs = (this.player.spec.bombs || 0) > 0;
      if (course) {
        const pr = this.player.vis.dims;
        this.ringR = Math.max(26, pr.span * 0.75 + 14);
        this.ringMeshes = this.rings.map((p, i) => {
          const m = ringMesh(this.ringR);
          m.position.copy(p);
          const nxt = this.rings[i + 1] || p.clone().add(p.clone().sub(this.rings[i - 1] || pos));
          const prv = this.rings[i - 1] || pos;
          m.lookAt(p.clone().add(nxt.clone().sub(prv).normalize()));
          RJ.scene.add(m);
          return m;
        });
        this.ringIdx = 0; this.t = 0; this.course = course;
        let len = 0, prev = pos; for (const p of this.rings) { len += p.distanceTo(prev); prev = p; }
        this.par = len / Math.min(spec.flight.vmax * 0.62, 330) + 4;
        this.refreshRings();
      }
      this.lowTime = 0; this.sessionT = 0; this.respawnT = 0;
      this.startPos = pos.clone(); this.startYaw = yaw;
      RJ.progress.stats.flights++; RJ.saveProgress();
      if (this.carrierStart) RJ.ui.flash("ON THE CATAPULT", `Full power (${RJ.keyLabel(RJ.settings.keys.throttleUp)} / ${RJ.keyLabel(RJ.settings.keys.afterburner)}) to launch`, 3.5);
      else RJ.ui.flash(course ? course.name.toUpperCase() : o.activity === "lowlevel" ? "LOW-LEVEL CHALLENGE" : this.runway ? "CLEARED FOR TAKEOFF" : "FREE FLIGHT",
        course ? `${course.n} rings · par ${RJ.fmtTime(this.par)}` : this.runway ? `Full throttle (${RJ.keyLabel(RJ.settings.keys.throttleUp)} or ${RJ.keyLabel(RJ.settings.keys.afterburner)}), pull back at rotation speed` : RJ.world.TIMES[o.time].label + " · " + RJ.world.WEATHER[env.weather].label, 3.5);
    }
    refreshRings() {
      this.ringMeshes.forEach((m, i) => {
        m.visible = i >= this.ringIdx && i < this.ringIdx + 5;
        const next = i === this.ringIdx;
        m.userData.ring.material.color.setHex(next ? 0xffc23a : 0xffffff);
        m.userData.ring.material.opacity = next ? 0.95 : 0.45;
        m.userData.disc.material.opacity = next ? 0.1 : 0.03;
      });
    }
    /** Catapult launches, deck traps and taxiing back to the cat. */
    carrierOps(dt) {
      const pl = this.player, K = RJ.carrier;
      if (!K || !K.site || !pl.alive) return;
      const c = this.cat;
      if (c && c.state === "hook" && pl.onGround) {
        // held by the holdback until the engines are at full power for a moment
        pl.speed = 0; pl.pos.x = c.x; pl.pos.z = c.z;
        c.t = pl.throttle > 0.95 ? c.t + dt : 0;
        if (c.t > 0.9) { c.state = "shot"; RJ.ui.flash("CAT SHOT", null, 1); RJ.audio.explosion(30, 0.25); RJ.view.cam.kick && RJ.view.cam.kick(0.8); }
      } else if (c && c.state === "shot") {
        if (pl.onGround) pl.speed = Math.min(pl.speed + 46 * dt, Math.max(pl.spec.flight.vstall * 1.35, 75));
        else c.state = "done";
      }
      // trap call-out and the taxi back to the catapult
      if (pl.onGround && pl.trap && K.onDeck(pl.pos.x, pl.pos.z)) {
        if (!this.trapCalled) {
          this.trapCalled = true;
          const w = pl.trap.wire, sink = this.tdSink || 0;
          const grade = w === 3 && sink < 4.5 ? "OK · perfect pass" : (w === 2 || w === 4) && sink < 5.5 ? "Fair pass" : "No-grade";
          RJ.ui.flash(`${w}-WIRE`, grade, 2.5);
          RJ.progress.stats.traps = (RJ.progress.stats.traps || 0) + 1; RJ.saveProgress();
        }
        if (pl.speed < 0.5) {
          this.taxiT = (this.taxiT || 0) + dt;
          if (this.taxiT > 2.5) {
            const cat = K.CATS[0], [cx, cz] = K.toWorld(cat.x, cat.z), [fx, fz] = K.toWorld(cat.x, cat.z - 10);
            const yaw = yawFromDir(V3(fx - cx, 0, fz - cz).normalize());
            pl.place(V3(cx, K.DECK + 3, cz), yaw, 0, { ground: true });
            this.cat = { state: "hook", t: 0, x: pl.pos.x, z: pl.pos.z, yaw };
            this.taxiT = 0;
            RJ.ui.flash("ON THE CATAPULT", "Full power to launch again", 2.5);
          }
        }
      } else { this.taxiT = 0; if (pl.state === "flying") this.trapCalled = false; }
    }
    /** Ball / line-up / speed call when the player is set up behind the carrier with the gear down. */
    carrierGuide() {
      const pl = this.player, K = RJ.carrier;
      if (!K || !K.site || !pl.alive || pl.state !== "flying" || !pl.gearDown) return null;
      const L = K.landingFrame(), rx = pl.pos.x - L.x, rz = pl.pos.z - L.z;
      const back = -(rx * L.dir.x + rz * L.dir.z), lat = rx * -L.dir.z + rz * L.dir.x;
      if (back < 80 || back > 7000 || Math.abs(lat) > back * 0.35 + 150) return null;
      const want = L.y + Math.tan(L.slope) * back, dev = Math.atan2(pl.pos.y - want, back) / RJ.DEG * 1.5;
      const ball = Math.abs(dev) < 0.35 ? "on glide path" : dev > 0 ? (dev > 1 ? "HIGH" : "slightly high") : (dev < -1 ? "LOW" : "slightly low");
      const lu = Math.abs(lat) < 6 ? "on centreline" : lat > 0 ? `${Math.round(lat)} m right` : `${Math.round(-lat)} m left`;
      const su = RJ.speedUnit(), vref = pl.spec.flight.vstall * 1.25;
      return `Carrier approach · Meatball: ${ball} · Line-up: ${lu} · Speed ${Math.round(pl.speed * su[1])} (target ${Math.round(vref * su[1])} ${su[0]})`;
    }
    update(dt) {
      const pl = this.player;
      this.sessionT += dt;
      if (pl.state === "flying") this.tdSink = Math.max(0, -pl.vel.y);
      this.carrierOps(dt);
      if (pl.alive) {
        if (pl.agl < 60 && pl.speed > 100) this.lowTime += dt;
        M.trackChallenges(pl, this);
        RJ.atlas.checkDiscovery(pl);
      } else {
        this.respawnT += dt;
        if (this.respawnT > 3) this.respawn();
      }
      if (this.rings) {
        if (pl.alive) this.t += dt;
        const r = this.rings[this.ringIdx];
        if (r && pl.alive) {
          // pass when crossing the ring plane inside its radius
          const m = this.ringMeshes[this.ringIdx];
          const nrm = V3(0, 0, 1).applyQuaternion(m.quaternion);
          const rel = pl.pos.clone().sub(r);
          const side = rel.dot(nrm);
          const radial = rel.addScaledVector(nrm, -side).length();
          const crossed = this.prevSide != null && Math.sign(side) !== Math.sign(this.prevSide) && radial < this.ringR * 1.05;
          if (crossed || pl.pos.distanceTo(r) < this.ringR * 0.9) this.passRing(); // resets prevSide for the next ring
          else this.prevSide = side;
        }
      }
      if (this.o.activity === "lowlevel" && this.sessionT >= 180 && !this.done) this.finishLowLevel();
    }
    passRing() {
      this.ringIdx++; this.prevSide = null;
      RJ.audio.ring();
      if (this.ringIdx >= this.rings.length) return this.finishCourse();
      this.refreshRings();
      RJ.ui.flash(`RING ${this.ringIdx + 1} / ${this.rings.length}`, null, 0.9);
    }
    finishCourse() {
      this.done = true;
      this.ringMeshes.forEach((m) => (m.visible = false));
      const t = this.t, par = this.par;
      const medal = t <= par ? "Gold" : t <= par * 1.2 ? "Silver" : "Bronze";
      const key = this.o.activity + ":" + this.o.aircraft;
      const best = RJ.progress.stats.bestCourse[key];
      const isBest = !best || t < best;
      if (isBest) RJ.progress.stats.bestCourse[key] = t;
      let xp = 150 + this.rings.length * 10 + (medal === "Gold" ? 200 : medal === "Silver" ? 100 : 0);
      const unlocked = RJ.addXP(xp);
      let ch = null;
      if (this.course.challenge) ch = RJ.completeChallenge(this.course.challenge);
      if (ch) { xp += ch.xp; unlocked.push(...ch.unlocked); }
      RJ.saveProgress();
      RJ.ui.showResults({
        eyebrow: `${this.course.name} · ${this.player.spec.short}`, title: RJ.fmtTime(t), win: true,
        sub: `${medal} medal. Par ${RJ.fmtTime(par)}.` + (isBest ? " New personal best." : ` Best ${RJ.fmtTime(best)}.`),
        stats: [["Rings", `${this.rings.length}/${this.rings.length}`], ["Top speed", `M ${RJ.progress.records.mach.toFixed(2)}`], ["Time below 60 m", `${this.lowTime.toFixed(1)} s`]],
        xp, unlocked
      });
    }
    finishLowLevel() {
      this.done = true;
      const sc = this.lowTime;
      const xp = Math.round(sc * 8);
      const unlocked = RJ.addXP(xp);
      RJ.ui.showResults({
        eyebrow: `Low-level challenge · ${this.player.spec.short}`, title: `${sc.toFixed(1)} s`, win: sc > 30,
        sub: "Seconds spent below 60 m above the ground at flying speed.",
        stats: [["Session", RJ.fmtTime(this.sessionT)], ["Low-level time", `${sc.toFixed(1)} s`]], xp, unlocked
      });
    }
    respawn() {
      this.respawnT = 0;
      const pl = this.player;
      let pos, yaw;
      if (this.rings && this.ringIdx > 0) {
        const a = this.rings[this.ringIdx - 1], b = this.rings[this.ringIdx];
        pos = a.clone(); pos.y += 40; yaw = yawFromDir(V3(b.x - a.x, 0, b.z - a.z));
      } else if (this.rings) { pos = this.startPos.clone(); yaw = this.startYaw; }
      else {
        pos = pl.pos.clone(); pos.y = M.highestAround(pos.x, pos.z, 2000, 3) + 500;
        yaw = yawFromDir(V3(pl.vel.x || 0, 0, pl.vel.z || -1));
      }
      RJ.combat.reset();
      this.player = makePlayer(this.o.aircraft, pos, yaw, cruiseSpeed(RJ.AIRCRAFT[this.o.aircraft]));
      RJ.game.player = this.player;
      this.prevSide = null;
    }
    onDestroyed(d) {
      if (d.ac === this.player) RJ.ui.flash(d.cause === "water" ? "SPLASHED" : "CRASHED", "Respawning…", 2.5, true);
    }
    hudExtras() {
      const pl = this.player, out = {};
      if (this.rings && !this.done) { out.ring = { pos: this.rings[this.ringIdx] }; if (this.rings[this.ringIdx + 1]) out.ring2 = { pos: this.rings[this.ringIdx + 1] }; }
      if (RJ.game.allowBombs) { out.bombMode = true; if (pl.alive && pl.bombs > 0) out.bombImpact = RJ.combat.bombImpact(pl); }
      return out;
    }
    status() {
      if (this.rings) return `<b>${this.course.name.toUpperCase()}</b>${Math.min(this.ringIdx + 1, this.rings.length)} / ${this.rings.length} · ${RJ.fmtTime(this.t)}`;
      if (this.o.activity === "lowlevel") return `<b>LOW-LEVEL</b>${this.lowTime.toFixed(1)} s · ${RJ.fmtTime(Math.max(0, 180 - this.sessionT))} left`;
      const r = RJ.progress.records;
      return `<b>FREE FLIGHT · ${this.player.spec.short}</b>Best M ${r.mach.toFixed(2)} · ${RJ.fmtInt(r.alt * 3.281)} ft`;
    }
    objective() {
      const pl = this.player;
      if (this.rings) return "Fly through the yellow ring. The arrow points to it when it's off screen.";
      const cg = this.carrierGuide();
      if (cg) return cg;
      if (this.cat && this.cat.state === "hook" && pl.onGround) return `Hooked to the catapult. Full power (${RJ.keyLabel(RJ.settings.keys.throttleUp)} / ${RJ.keyLabel(RJ.settings.keys.afterburner)}) and the cat fires; the deck ends 130 m ahead.`;
      const K = RJ.settings.keys, kl = RJ.keyLabel, md = pl.spec.flight.model;
      if (md === "heli") return `Collective: ${kl(K.throttleUp)} up / ${kl(K.throttleDown)} down (middle holds height). ${kl(K.pitchUp)}/${kl(K.pitchDown)} tilt forward/back, ${kl(K.rollLeft)}/${kl(K.rollRight)} strafe, ${kl(K.yawLeft)}/${kl(K.yawRight)} turn.`;
      if (md === "space") return `${kl(K.afterburner)} boosts (limited reserve, recharges).${pl.spec.flight.space.foils ? ` ${kl(K.gear)} toggles the S-foils.` : ""} Lasers on ${kl(K.guns)}.`;
      if (md === "bike" && pl.onGround) return `${kl(K.pitchUp)} accelerate, ${kl(K.pitchDown)} brake, ${kl(K.rollLeft)}/${kl(K.rollRight)} lean. ${kl(K.afterburner)} fires the rocket, ${kl(K.gear)} deploys wings: pull back above take-off speed to fly.`;
      if (md === "bike") return "Flip and roll for tricks. Land upright, wings level, pointing the way you're moving.";
      if (md === "car" && pl.vs && pl.vs.mode === "drive") return `${kl(K.pitchUp)} drive, ${kl(K.pitchDown)} brake/reverse, ${kl(K.rollLeft)}/${kl(K.rollRight)} steer. ${kl(K.gear)}: ${pl.spec.flight.car.vtol ? "switch to flight mode" : "unfold the wings, then accelerate and pull up"}.`;
      if (md === "car" && pl.spec.flight.car.vtol) return `Hovers like a drone: ${kl(K.throttleUp)}/${kl(K.throttleDown)} climb/descend, ${kl(K.gear)} lands and switches back to driving.`;
      if (pl.onGround) return `Throttle up with ${RJ.keyLabel(RJ.settings.keys.throttleUp)} (hold ${RJ.keyLabel(RJ.settings.keys.afterburner)} for afterburner). Pull back gently once you pass rotation speed. Gear retracts on its own (${RJ.keyLabel(RJ.settings.keys.gear)}).`;
      if (pl.mach > 0.85 && pl.mach < 1) return "Approaching the sound barrier. Keep accelerating to break Mach 1.";
      if (this.o.activity === "lowlevel") return "Stay below 60 m above the ground. Trees and ridgelines are solid.";
      if (RJ.game.allowBombs && pl.bombs > 0) return `Hold ${RJ.keyLabel(RJ.settings.keys.guns)} to drop bombs. The circle marks the impact point.`;
      return "Explore. Climb for speed records or dive into the valleys.";
    }
    dispose() { (this.ringMeshes || []).forEach((m) => RJ.scene.remove(m)); }
  }
  M.FreeFlight = FreeFlight;

  /* ======================= DOGFIGHT ======================= */
  M.MATCHES = [
    { id: "duel", name: "1v1 Duel", desc: "You against one enemy pilot.", blue: 1, red: 1 },
    { id: "2v2", name: "2v2", desc: "You and a wingman against two.", blue: 2, red: 2 },
    { id: "team", name: "4v4 Team battle", desc: "Four aircraft per side. Watch your six.", blue: 4, red: 4 },
    { id: "survival", name: "Survival", desc: "Endless waves. Each one is bigger and better flown.", blue: 1, red: 1 }
  ];
  M.ARENAS = [
    { id: "mountains", name: "Mountains", region: "mountains", weather: "scattered" },
    { id: "desert", name: "Desert canyons", region: "desert", weather: "clear" },
    { id: "ocean", name: "Ocean", region: "ocean", weather: "scattered" },
    { id: "clouds", name: "Above the clouds", region: "clouds", weather: "cloudsea" }
  ];
  M.DIFFS = [{ id: "rookie", name: "Rookie", xp: 0.8 }, { id: "veteran", name: "Veteran", xp: 1.0 }, { id: "ace", name: "Ace", xp: 1.4 }];
  const ENEMY_POOL = { rookie: ["f4", "f16", "fa18e"], veteran: ["f16", "f15c", "fa18e", "f14"], ace: ["f15ex", "f22", "f35a", "f15c", "yf23"] };
  const WING_POOL = ["f16", "f15c", "fa18e"];
  const CALL_R = ["Bandit", "Viper", "Cobra", "Raptor", "Ghost", "Jester", "Iceman", "Spike", "Mako", "Havoc", "Razor", "Talon"];
  const CALL_B = ["Maverick", "Goose", "Phoenix", "Rooster", "Hangman", "Bob"];

  class Dogfight {
    constructor(o) { this.o = o; this.kind = "fight"; }
    async setup(progress) {
      const o = this.o, arena = M.ARENAS.find((a) => a.id === o.arena) || M.ARENAS[0];
      this.match = M.MATCHES.find((m) => m.id === o.match) || M.MATCHES[0];
      this.diff = M.DIFFS.find((d) => d.id === o.diff) || M.DIFFS[1];
      RJ.world.setEnvironment({ time: o.time, weather: arena.weather });
      const reg = RJ.world.findRegion(arena.region);
      this.center = V3(reg.x, 0, reg.z);
      this.axis = dirFromYaw(reg.yaw);
      let alt = M.highestAround(reg.x, reg.z, 6000, 5) + 900;
      if (arena.id === "clouds") alt = Math.max(alt, RJ.world.cloudTop + 900);
      if (arena.id === "ocean") alt = Math.max(alt, 1500);
      this.alt = alt;
      const sp = this.axis.clone().multiplyScalar(-4200);
      const pPos = V3(reg.x + sp.x, alt, reg.z + sp.z);
      if (RJ.world.airbase) RJ.world.setAirbase(null);
      await RJ.world.prepare(this.center, progress);
      this.player = makePlayer(o.aircraft, pPos, yawFromDir(this.axis), cruiseSpeed(RJ.AIRCRAFT[o.aircraft]) * 1.2);
      this.player.throttle = 0.85;
      RJ.game.allowBombs = false;
      this.score = 0; this.kills = 0; this.deaths = 0; this.t = 0; this.wave = 0; this.ended = false; this.spectate = null;
      this.endT = null;
      const side = V3(-this.axis.z, 0, this.axis.x);
      for (let i = 1; i < this.match.blue; i++) {
        const p = pPos.clone().addScaledVector(side, (i % 2 ? 1 : -1) * 260 * Math.ceil(i / 2)).addScaledVector(this.axis, -150 * i);
        this.spawnAI(RJ.pick(WING_POOL), "blue", p, yawFromDir(this.axis), CALL_B[i % CALL_B.length], o.diff === "rookie" ? "veteran" : o.diff);
      }
      if (this.match.id === "survival") this.nextWave();
      else for (let i = 0; i < this.match.red; i++) {
        const p = V3(reg.x, alt, reg.z).addScaledVector(this.axis, 4200 + 150 * i).addScaledVector(side, (i % 2 ? 1 : -1) * 280 * Math.ceil(i / 2));
        this.spawnAI(RJ.pick(ENEMY_POOL[this.diff.id]), "red", p, yawFromDir(this.axis.clone().negate()), CALL_R[i % CALL_R.length], this.diff.id);
      }
      RJ.progress.stats.matches++; RJ.saveProgress();
      RJ.ui.flash(this.match.name.toUpperCase(), `${arena.name} · ${this.diff.name} pilots`, 2.5);
    }
    spawnAI(id, team, pos, yaw, callsign, skill, opts) {
      const ac = new RJ.Aircraft(id, { team, livery: team === "red" ? "aggressor" : "wingman", callsign: `${callsign} (${RJ.AIRCRAFT[id].short})`, assist: true });
      ac.place(pos, yaw, cruiseSpeed(ac.spec) * 1.2);
      // blue AI fly as the player's wingmen and take orders; red AI fight on their own
      const po = opts || (team === "blue" && this.player ? { role: "wingman", leader: this.player, order: this.wingOrder || "cover" } : null);
      ac.pilot = new RJ.combat.Pilot(ac, skill, po);
      RJ.combat.add(ac);
      return ac;
    }
    nextWave() {
      this.wave++;
      const n = Math.min(1 + Math.floor((this.wave + 1) / 2), 6);
      const k = RJ.clamp((this.wave - 1) / 8, 0, 1);
      const D = RJ.combat.DIFF;
      const lerpSk = (a, b, t) => { const o = {}; for (const key in a) o[key] = RJ.lerp(a[key], b[key], t); return o; };
      const sk = k < 0.5 ? lerpSk(D.rookie, D.veteran, k * 2) : lerpSk(D.veteran, D.ace, (k - 0.5) * 2);
      const pool = k < 0.35 ? ENEMY_POOL.rookie : k < 0.7 ? ENEMY_POOL.veteran : ENEMY_POOL.ace;
      const pl = this.player;
      const ang = Math.random() * Math.PI * 2;
      const c = pl.pos.clone().add(V3(Math.cos(ang) * 5500, 0, Math.sin(ang) * 5500));
      c.y = Math.max(pl.pos.y, M.highestAround(c.x, c.z, 2500, 3) + 600);
      const toward = pl.pos.clone().sub(c); toward.y = 0; toward.normalize();
      for (let i = 0; i < n; i++) {
        const p = c.clone().add(V3(RJ.rand(-400, 400), RJ.rand(-150, 150), RJ.rand(-400, 400)));
        this.spawnAI(RJ.pick(pool), "red", p, yawFromDir(toward), CALL_R[(this.wave + i) % CALL_R.length], sk);
      }
      if (this.wave > 1) {
        pl.hp = Math.min(pl.maxHp, pl.hp + pl.maxHp * 0.35);
        pl.missiles = Math.min(pl.spec.msl.n || 0, pl.missiles + Math.ceil((pl.spec.msl.n || 0) / 2));
        pl.flares = pl.spec.flares || 0;
        this.score += 200;
      }
      RJ.ui.flash(`WAVE ${this.wave}`, `${n} bandit${n > 1 ? "s" : ""} inbound`, 2.2);
      if (this.wave >= 5) RJ.completeChallenge("survive5");
      this.waveBreak = 0;
    }
    onDestroyed(d) {
      const ac = d.ac, by = d.by;
      const how = d.cause === "missile" ? "missile" : d.cause === "gun" ? "guns" : d.cause === "collision" ? "collision" : d.cause === "terrain" || d.cause === "water" ? "crashed" : "";
      RJ.ui.feed(by && by !== ac ? `${by.callsign} ▸ ${ac.callsign}${how ? " · " + how : ""}` : `${ac.callsign} ${how || "down"}`, ac.team === "red" ? "b" : "r");
      if (by && by.isPlayer && ac.team !== by.team) {
        this.kills++; this.score += d.cause === "gun" ? 120 : 100;
        by.stats.kills++;
        RJ.ui.flash("SPLASH ONE", ac.spec.short, 1.2);
      } else if (ac.team === "red" && ac.lastHitBy && ac.lastHitBy.isPlayer && (!by || !by.isPlayer)) { this.score += 40; }
      if (ac.isPlayer) {
        this.deaths++;
        RJ.ui.flash(d.cause === "terrain" || d.cause === "water" ? "CRASHED" : "SHOT DOWN", by && by !== ac ? `by ${by.callsign}` : "", 2.5, true);
      }
    }
    update(dt) {
      if (this.ended) { this.endT += dt; if (this.endT > 3 && !this.shown) { this.shown = true; this.showResults(); } return; }
      this.t += dt;
      const pl = this.player;
      M.trackChallenges(pl, null);
      const A = RJ.combat.aircraft;
      const blue = A.filter((a) => a.alive && a.team === "blue").length, red = A.filter((a) => a.alive && a.team === "red").length;
      if (this.match.id === "survival") {
        if (!pl.alive) return this.end(false);
        if (red === 0) { this.waveBreak += dt; if (this.waveBreak > 3.5) { this.cleanupDead(); this.nextWave(); } }
      } else {
        if (red === 0) return this.end(true);
        if (blue === 0) return this.end(false);
        if (!pl.alive && !this.spectate) this.spectate = A.find((a) => a.alive && a.team === "blue") || null;
        if (this.spectate && !this.spectate.alive) this.spectate = A.find((a) => a.alive && a.team === "blue") || null;
      }
      // keep the fight local: AI never wanders too far from the action
      for (const a of A) if (a.pilot && a.alive && !a.target && a.pilot.role === "fighter") RJ.combat.autoTarget(a);
    }
    cleanupDead() {
      const C = RJ.combat;
      for (let i = C.aircraft.length - 1; i >= 0; i--) { const a = C.aircraft[i]; if (!a.alive && a.state === "dead" && !a.isPlayer) { a.dispose(); C.aircraft.splice(i, 1); } }
    }
    end(win) {
      if (this.ended) return;
      this.ended = true; this.endT = 0; this.win = win;
      RJ.ui.flash(win ? "VICTORY" : this.match.id === "survival" ? "RUN OVER" : "DEFEAT", win ? "All bandits down" : "", 3, !win);
    }
    showResults() {
      const pl = this.player, st = pl.stats, surv = this.match.id === "survival";
      const win = surv ? this.wave > 1 : this.win;
      if (!surv && this.win) this.score += 300;
      const xp = Math.round(this.score * this.diff.xp * (surv ? 1 : 1));
      const unlocked = RJ.addXP(xp);
      const P = RJ.progress.stats;
      P.kills += this.kills; P.deaths += this.deaths;
      if (!surv) { if (this.win) P.wins++; else P.losses++; }
      if (surv) P.bestWave = Math.max(P.bestWave, this.wave);
      let extra = null;
      if (this.win && this.match.id === "duel" && this.diff.id !== "rookie") extra = RJ.completeChallenge("duelvet");
      if (this.win && this.match.id === "team" && this.diff.id === "ace") extra = RJ.completeChallenge("teamace") || extra;
      if (extra) unlocked.push(...extra.unlocked);
      RJ.saveProgress();
      const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
      RJ.ui.showResults({
        eyebrow: `${this.match.name} · ${this.diff.name} · ${pl.spec.short}`,
        title: surv ? `WAVE ${this.wave}` : this.win ? "VICTORY" : "DEFEAT", win,
        sub: surv ? `You survived ${this.wave - 1} full wave${this.wave === 2 ? "" : "s"}.` : this.win ? "All bandits destroyed." : "Your team was shot down.",
        stats: [
          ["Score", RJ.fmtInt(this.score)], ["Kills", this.kills], ["Deaths", this.deaths], ["Time", RJ.fmtTime(this.t)],
          ["Gun accuracy", `${acc}%`], ["Rounds fired", RJ.fmtInt(st.shots)], ["Missiles hit", `${st.mslHits}/${st.msl}`],
          ["Flares used", st.flares], ["Damage dealt", RJ.fmtInt(st.dmgDealt)], ["Damage taken", RJ.fmtInt(st.dmgTaken)]
        ],
        xp: xp + (extra ? extra.xp : 0), unlocked
      });
    }
    wingmen() { return RJ.combat.aircraft.filter((a) => a.alive && a.pilot && a.pilot.role === "wingman" && a.pilot.leader === this.player); }
    /** Player's radio call to every wingman: attack my target, cover me, form up, defend the objective. */
    command(order) {
      const w = this.wingmen();
      if (!w.length) { RJ.ui.flash("NO WINGMEN", null, 1); return; }
      const pl = this.player;
      if (order === "attack" && !(pl.target && pl.target.alive)) { RJ.ui.flash("NO TARGET", `Select one with ${RJ.keyLabel(RJ.settings.keys.target)} first`, 1.4); return; }
      this.wingOrder = order;
      const obj = this.objectivePoint ? this.objectivePoint() : pl.pos.clone();
      for (const a of w) { a.pilot.order = order; a.pilot.objective = obj; a.pilot.t = 0; if (order !== "attack") a.target = null; }
      const say = { attack: ["ENGAGE MY TARGET", pl.target ? pl.target.callsign : ""], cover: ["COVER ME", "Wingmen clearing your six"], form: ["FORM UP", "Wingmen rejoining"], defend: ["DEFEND THE OBJECTIVE", "Wingmen holding over the objective"] }[order];
      RJ.ui.flash(say[0], say[1], 1.6);
      RJ.ui.feed(`${w[0].callsign.split(" ")[0]}: ${{ attack: "Engaging.", cover: "Got your six.", form: "Rejoining.", defend: "Holding over the objective." }[order]}`, "b");
      RJ.audio.beep(1200, 0.06, 0.05);
    }
    hudExtras() { return {}; }
    status() {
      const A = RJ.combat.aircraft;
      const red = A.filter((a) => a.alive && a.team === "red").length, blue = A.filter((a) => a.alive && a.team === "blue").length;
      if (this.match.id === "survival") return `<b>SURVIVAL · WAVE ${this.wave}</b>${red} bandit${red === 1 ? "" : "s"} · ${RJ.fmtInt(this.score)} pts`;
      return `<b>${this.match.name.toUpperCase()}</b>Blue ${blue} · Red ${red} · ${RJ.fmtInt(this.score)} pts`;
    }
    objective() {
      const pl = this.player;
      if (!pl.alive) return this.spectate ? `Spectating ${this.spectate.callsign}` : "";
      const k = RJ.settings.keys;
      if (!pl.spec.msl.n) return `${RJ.keyLabel(k.guns)} guns · ${RJ.keyLabel(k.target)} next target. Get on their six and lead the target.`;
      return `${RJ.keyLabel(k.target)} target · ${RJ.keyLabel(k.missile)} missile once LOCK shows · ${RJ.keyLabel(k.guns)} guns · ${RJ.keyLabel(k.flares)} flares`;
    }
    dispose() { }
  }
  M.Dogfight = Dogfight;
})(window.RJ);
