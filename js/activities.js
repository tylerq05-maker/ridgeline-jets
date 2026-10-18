/* Ridgeline Jets — Free Flight activities (game modes) beyond the ring courses:
 *   Bombing Range · Area 51 Escape · Cargo Career · Wingsuit (Everest) · Paper Plane · (Drone Race is a ring course).
 * Each activity hooks FreeFlight: setup (after the player exists), update, status, objective, hud and dispose.
 * Fields: aircraft (forced), region, runway (start on a runway), airspace (keep living airspace on). */
(function (RJ) {
  "use strict";
  const ACT = (RJ.activities = {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
  const fmt = (t) => RJ.fmtTime(Math.max(0, t));
  const dirFromYaw = (y) => V3(-Math.sin(y), 0, -Math.cos(y));
  const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
  const results = (o) => RJ.ui.showResults(o);
  function marker(r, col) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.08, 600, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, depthWrite: false, fog: false }));
    beam.position.y = 300; g.add(beam);
    RJ.scene.add(g); return g;
  }

  /* ======================= Bombing Range ======================= */
  ACT.bombing = {
    name: "Bombing Range", desc: "3 minutes on a desert range: destroy armour, trucks and bunkers with free-fall bombs. Any aircraft gets bombs.", region: "desert",
    setup(ff) {
      const pl = ff.player, f = dirFromYaw(ff.startYaw), W = RJ.world;
      RJ.game.allowBombs = true; pl.bombs = Math.max(pl.bombs || 0, 30);
      this.t = 180; this.score = 0; this.kills = 0; this.targets = [];
      const c = pl.pos.clone().addScaledVector(f, 9000);
      const mat = (h) => new THREE.MeshStandardMaterial({ color: h, roughness: 0.8 });
      const kinds = [["tank", 7, 3, 3.6, 0x5d6145, 100], ["truck", 8, 3.2, 2.6, 0x6b5a3e, 60], ["bunker", 14, 4, 14, 0x8a8478, 150], ["sam", 6, 4, 6, 0x4d5a4a, 120]];
      for (let i = 0; i < 16; i++) {
        const k = kinds[i % kinds.length], a = Math.random() * TAU, r = RJ.rand(0, 1400);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, y = W.ground(x, z);
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(k[1], k[2], k[3]), mat(k[4])); b.position.y = k[2] / 2; b.castShadow = true; g.add(b);
        if (k[0] === "tank") { const t = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 3.4), mat(k[4])); t.position.y = k[2] + 0.7; g.add(t); const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), mat(0x3a3d2c)); gun.rotation.x = Math.PI / 2; gun.position.set(0, k[2] + 0.8, -3); g.add(gun); }
        if (k[0] === "sam") for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 8), mat(0xd8d8d0)); m.rotation.x = -0.9; m.position.set(s * 1.2, k[2] + 1.5, 0); g.add(m); }
        g.position.set(x, y, z); g.rotation.y = Math.random() * TAU; RJ.scene.add(g);
        this.targets.push({ g, kind: k[0], pts: k[5], alive: true, p: V3(x, y, z) });
      }
      this.zone = marker(1500, 0xff5a3a); this.zone.position.set(c.x, W.ground(c.x, c.z) + 2, c.z); this.c = c;
      this.off = RJ.on("explosion", (e) => {
        for (const t of this.targets) if (t.alive && t.p.distanceTo(e.pos) < 28 * (e.big || 1)) {
          t.alive = false; this.kills++; this.score += t.pts;
          t.g.children.forEach((m) => m.material && m.material.color && m.material.color.multiplyScalar(0.25));
          t.g.rotation.z = RJ.rand(-0.3, 0.3); RJ.fx.explosion(t.p.clone().setY(t.p.y + 3), 1.4, null);
          RJ.ui.flash(`${t.kind.toUpperCase()} DESTROYED`, `+${t.pts}`, 0.9);
        }
      });
    },
    update(ff, dt) {
      if (this.done) return;
      this.t -= dt;
      if (this.t <= 0 || this.kills >= this.targets.length) this.finish(ff);
    },
    finish(ff) {
      this.done = true;
      const xp = Math.round(this.score * 0.8), unlocked = RJ.addXP(xp); RJ.saveProgress();
      results({ eyebrow: `Bombing Range · ${ff.player.spec.short}`, title: `${this.score} pts`, win: this.kills >= 8,
        sub: `${this.kills} of ${this.targets.length} targets destroyed.`, stats: [["Targets", `${this.kills}/${this.targets.length}`], ["Bombs left", `${ff.player.bombs}`], ["Time", fmt(180 - this.t)]], xp, unlocked });
    },
    status() { return `<b>BOMBING RANGE</b>${this.score} pts · ${this.kills}/${this.targets.length} · ${fmt(this.t)}`; },
    objective(ff) { return `Hold ${RJ.keyLabel(RJ.settings.keys.guns)} to drop bombs (the circle shows the impact point). Targets are inside the red ring ahead. Release at a few hundred metres for accuracy.`; },
    hud(ff, out) { if (!this.done) out.ring = { pos: this.c.clone().setY(RJ.world.ground(this.c.x, this.c.z) + 150) }; },
    dispose() { if (this.off) this.off(); for (const t of this.targets || []) RJ.scene.remove(t.g); if (this.zone) RJ.scene.remove(this.zone); }
  };

  /* ======================= Area 51 Escape ======================= */
  ACT.area51 = {
    name: "Area 51 Escape", desc: "Steal a jet from the secret desert base. The moment you're airborne, the Air Force comes for you: get 45 km away or lose them.", region: "desert", runway: true, airspace: true,
    setup(ff) {
      const ab = RJ.world.airbase, W = RJ.world;
      this.base = V3(ab.x, ab.elev, ab.z); this.t = 0; this.stage = "ground";
      // hangars, a radar dome and the infamous lake-bed markings next to the runway
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }), white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2 });
      for (let i = 0; i < 6; i++) {
        const h = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 70, 16, 1, false, 0, Math.PI), mat);
        h.rotation.z = Math.PI / 2; h.rotation.y = ab.yaw; const off = -900 + i * 180;
        h.position.set(ab.x + ab.dx * off - ab.dz * 420, ab.elev, ab.z + ab.dz * off + ab.dx * 420); h.castShadow = true; g.add(h);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 10, 0, TAU, 0, Math.PI / 2), white);
      dome.position.set(ab.x - ab.dz * 700, ab.elev, ab.z + ab.dx * 700); g.add(dome);
      RJ.scene.add(g); this.g = g;
      RJ.ui.flash("AREA 51", "Unauthorised take-off in progress", 3);
    },
    update(ff, dt) {
      const pl = ff.player;
      if (this.done || !pl.alive) return;
      this.t += dt;
      if (this.stage === "ground" && pl.state === "flying" && pl.agl > 40) {
        this.stage = "chase"; this.chaseT = 0;
        if (RJ.airspace && RJ.airspace.on) RJ.airspace.setLevel(3);
        RJ.companion && RJ.companion.say("Dreamland tower: unauthorised departure! All units, intercept that aircraft!", 2, { speaker: "DREAMLAND TOWER", male: true });
      }
      if (this.stage === "chase") {
        this.chaseT += dt;
        const d = Math.hypot(pl.pos.x - this.base.x, pl.pos.z - this.base.z);
        const lvl = RJ.airspace && RJ.airspace.wanted ? RJ.airspace.wanted.level : 0;
        if (d > 45000 || (this.chaseT > 60 && lvl === 0)) this.finish(ff, true, d);
      }
    },
    finish(ff, win, d) {
      this.done = true;
      const xp = win ? 600 : 50, unlocked = RJ.addXP(xp); RJ.saveProgress();
      results({ eyebrow: `Area 51 Escape · ${ff.player.spec.short}`, title: win ? "ESCAPED" : "CAPTURED", win,
        sub: win ? "You got away with it. The base will deny everything." : "Shot down over the range.", stats: [["Distance from base", `${(d / 1000).toFixed(1)} km`], ["Time", fmt(this.t)]], xp, unlocked });
    },
    onDestroyed(ff, d) { if (d.ac === ff.player && this.stage === "chase" && !this.done) { this.finish(ff, false, Math.hypot(ff.player.pos.x - this.base.x, ff.player.pos.z - this.base.z)); return true; } },
    status(ff) { const d = Math.hypot(ff.player.pos.x - this.base.x, ff.player.pos.z - this.base.z); return `<b>AREA 51 ESCAPE</b>${(d / 1000).toFixed(1)} / 45 km · ${fmt(this.t)}`; },
    objective() { return this.stage === "ground" ? "Full throttle down the runway and get airborne. They'll scramble the moment you lift off." : "Run! Fly 45 km from the base, or break contact (stay low, far away, and don't shoot) until the stars fade."; },
    dispose() { if (this.g) RJ.scene.remove(this.g); }
  };

  /* ======================= Cargo Career ======================= */
  const DESTS = () => {
    const out = [];
    if (RJ.cities) for (const id in RJ.cities.sites) { const s = RJ.cities.sites[id]; out.push({ id, name: RJ.cities.SPEC[id].name, x: s.x, z: s.z }); }
    for (const id of ["nyc", "sf"]) { const r = RJ.world.findRegion(id); if (r) out.push({ id, name: id === "nyc" ? "New York" : "San Francisco", x: r.x, z: r.z }); }
    if (RJ.atlas && RJ.atlas.home) out.push({ id: "home", name: "Ridgeline Air Base", x: RJ.atlas.home.x, z: RJ.atlas.home.z });
    return out;
  };
  const RANKS = [[0, "Junior First Officer"], [5, "First Officer"], [12, "Captain"], [25, "Senior Captain"], [45, "Chief Pilot"]];
  ACT.cargo = {
    name: "Cargo Career", desc: "Fly C-17 contracts between Tokyo, Dubai, Rio, New York and San Francisco. Air-drop the load on the zone; earn pay and rank.", aircraft: "c17",
    setup(ff) {
      RJ.progress.cargo = RJ.progress.cargo || { cash: 0, runs: 0 };
      this.next(ff);
    },
    next(ff) {
      const pl = ff.player, D = DESTS().filter((d) => Math.hypot(d.x - pl.pos.x, d.z - pl.pos.z) > 15000);
      if (!D.length) return;
      const d = D[Math.floor(Math.random() * D.length)], W = RJ.world;
      const dist = Math.hypot(d.x - pl.pos.x, d.z - pl.pos.z);
      const goods = ["medical supplies", "relief food", "engine parts", "electronics", "a racing yacht", "satellite components", "fresh flowers"][Math.floor(Math.random() * 7)];
      this.job = { d, goods, dist, pay: Math.round(dist / 1000 * 140 + 800), t: 0, limit: dist / 190 + 120 };
      if (this.zone) RJ.scene.remove(this.zone);
      this.zone = marker(600, 0x3ad06a); this.zone.position.set(d.x, Math.max(W.ground(d.x, d.z), 0) + 2, d.z);
      RJ.ui.flash("NEW CONTRACT", `${goods} to ${d.name} · ${(dist / 1000).toFixed(0)} km · $${this.job.pay.toLocaleString()}`, 4);
    },
    update(ff, dt) {
      const pl = ff.player, j = this.job; if (!j || !pl.alive) return;
      j.t += dt;
      // the drop: inside the zone, low and slow, and the ramp opens
      const d = Math.hypot(pl.pos.x - j.d.x, pl.pos.z - j.d.z);
      if (d < 600 && pl.agl < 450 && pl.speed < 125 && !this.crates) {
        this.crates = []; this.cT = 0;
        for (let i = 0; i < 4; i++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3), new THREE.MeshStandardMaterial({ color: 0x7a6a48 }));
          const ch = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 6, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe8e8e0 : 0x3a6a3a, side: THREE.DoubleSide })); ch.position.y = 9; c.add(ch);
          c.position.copy(pl.pos).addScaledVector(pl.fwd, -30 - i * 12).add(V3(0, -4, 0)); RJ.scene.add(c);
          this.crates.push({ m: c, v: pl.vel.clone().multiplyScalar(0.8) });
        }
        const late = j.t > j.limit, pay = Math.round(j.pay * (late ? 0.6 : 1) * (1 + RJ.clamp(1 - d / 600, 0, 1) * 0.25));
        const C = RJ.progress.cargo; C.cash += pay; C.runs++;
        const xp = 120 + Math.round(j.dist / 1000 * 2), unlocked = RJ.addXP(xp); RJ.saveProgress();
        RJ.ui.flash("LOAD AWAY", `+$${pay.toLocaleString()}${late ? " (late)" : ""} · total $${C.cash.toLocaleString()}`, 4);
        if (unlocked && unlocked.length) RJ.ui.toast("Unlocked: " + unlocked.join(", "));
        this.lastPay = pay; this.job = null;
        setTimeout(() => { this.crates && this.crates.forEach((c) => RJ.scene.remove(c.m)); this.crates = null; if (!this.disposed) this.next(ff); }, 9000);
      }
    },
    tick(dt) {
      for (const c of this.crates || []) {
        c.v.y = Math.max(c.v.y - 9.8 * dt, -7); c.v.x *= Math.pow(0.4, dt); c.v.z *= Math.pow(0.4, dt);
        c.m.position.addScaledVector(c.v, dt);
        const g = Math.max(RJ.world.ground(c.m.position.x, c.m.position.z), 0) + 1;
        if (c.m.position.y < g) { c.m.position.y = g; c.v.set(0, 0, 0); }
      }
    },
    rank() { const n = RJ.progress.cargo ? RJ.progress.cargo.runs : 0; let r = RANKS[0][1]; for (const [k, v] of RANKS) if (n >= k) r = v; return r; },
    status(ff) {
      const C = RJ.progress.cargo || { cash: 0 }, j = this.job;
      if (!j) return `<b>CARGO · ${this.rank().toUpperCase()}</b>$${C.cash.toLocaleString()} · next contract incoming`;
      const d = Math.hypot(ff.player.pos.x - j.d.x, ff.player.pos.z - j.d.z);
      return `<b>CARGO → ${j.d.name.toUpperCase()}</b>${(d / 1000).toFixed(1)} km · ${fmt(j.limit - j.t)} · $${C.cash.toLocaleString()}`;
    },
    objective() { const j = this.job; return j ? `Deliver ${j.goods} to ${j.d.name}. Over the green zone: below 450 m above the ground and under ${Math.round(125 * RJ.speedUnit()[1])} ${RJ.speedUnit()[0]} to air-drop the load.` : "Load delivered. Your next contract is being arranged."; },
    hud(ff, out) { if (this.job) out.ring = { pos: V3(this.job.d.x, Math.max(RJ.world.ground(this.job.d.x, this.job.d.z), 0) + 300, this.job.d.z) }; },
    dispose() { this.disposed = true; if (this.zone) RJ.scene.remove(this.zone); (this.crates || []).forEach((c) => RJ.scene.remove(c.m)); }
  };

  /* ======================= Wingsuit: Everest ======================= */
  ACT.wingsuit = {
    name: "Wingsuit: Everest Line", desc: "Jump from just below the summit of Everest and fly a line of gates down the mountain. Gravity is your only engine.", aircraft: "wingsuit",
    start() {
      // jump off the steepest face: the direction where the ground 1.5 km out is lowest, 60 m above the slope
      const W = RJ.world, E = W.gen.everest;
      let a = 0, lo = Infinity;
      for (let k = 0; k < 24; k++) { const b = (k / 24) * TAU, h = W.ground(E.x + Math.cos(b) * 1500, E.z + Math.sin(b) * 1500); if (h < lo) { lo = h; a = b; } }
      const x = E.x + Math.cos(a) * 350, z = E.z + Math.sin(a) * 350;
      return { pos: V3(x, W.ground(x, z) + 60, z), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), speed: 40 };
    },
    setup(ff) {
      const pl = ff.player, W = RJ.world, f = dirFromYaw(ff.startYaw);
      this.rings = []; this.meshes = []; this.idx = 0; this.t = 0; this.start = pl.pos.clone();
      // a line of gates on a ~2.6:1 glide slope, nudged clear of the terrain
      let p = pl.pos.clone(), yaw = ff.startYaw;
      for (let i = 0; i < 14; i++) {
        yaw += RJ.rand(-0.18, 0.18); const d = dirFromYaw(yaw);
        p = p.clone().addScaledVector(d, 520); p.y -= 520 / 2.7;
        const g = W.ground(p.x, p.z); if (p.y < g + 60) p.y = g + 60;
        this.rings.push(p);
        const m = RJ.modes.ringMesh(22); m.position.copy(p); m.lookAt(p.clone().add(d)); RJ.scene.add(m); this.meshes.push(m);
      }
      this.refresh();
    },
    refresh() { this.meshes.forEach((m, i) => { m.visible = i >= this.idx && i < this.idx + 4; m.userData.ring.material.color.setHex(i === this.idx ? 0xffc23a : 0xffffff); }); },
    update(ff, dt) {
      const pl = ff.player; if (this.done || !pl.alive) return;
      this.t += dt;
      const r = this.rings[this.idx];
      if (r && pl.pos.distanceTo(r) < 24) { this.idx++; RJ.audio.ring(); this.refresh(); }
      else if (r && pl.pos.distanceTo(r) > 900 && this.idx < this.rings.length) {
        // passed it by: skip to the next gate ahead
        const nx = this.rings[this.idx + 1]; if (nx && pl.pos.distanceTo(nx) < pl.pos.distanceTo(r)) { this.idx++; this.refresh(); }
      }
      // pull the chute low over the ground (the run ends safely)
      if (pl.agl < 120 && pl.vel.y < 0 && this.t > 3) this.finish(ff, true);
    },
    finish(ff, safe) {
      this.done = true;
      const pl = ff.player, dist = Math.hypot(pl.pos.x - this.start.x, pl.pos.z - this.start.z);
      const xp = Math.round(this.idx * 40 + dist / 50), unlocked = RJ.addXP(xp); RJ.saveProgress();
      if (safe) { pl.speed = 15; RJ.ui.flash("CANOPY OPEN", "Nice flight", 2); }
      results({ eyebrow: "Wingsuit · Everest Line", title: `${this.idx} / ${this.rings.length} gates`, win: safe && this.idx >= 8,
        sub: safe ? "Chute open, safe landing." : "Impact. The mountain always wins.", stats: [["Distance", `${(dist / 1000).toFixed(2)} km`], ["Altitude lost", `${Math.round(this.start.y - pl.pos.y)} m`], ["Time", fmt(this.t)]], xp, unlocked });
    },
    onDestroyed(ff, d) { if (d.ac === ff.player && !this.done) { this.finish(ff, false); return true; } },
    status() { return `<b>WINGSUIT</b>Gate ${Math.min(this.idx + 1, this.rings.length)} / ${this.rings.length} · ${fmt(this.t)}`; },
    objective() { return "Dive to build speed, then flare gently to stretch the glide. Fly through the yellow gates; the chute opens on its own near the ground."; },
    hud(ff, out) { const r = this.rings && this.rings[this.idx]; if (r && !this.done) out.ring = { pos: r }; },
    dispose() { (this.meshes || []).forEach((m) => RJ.scene.remove(m)); }
  };

  /* ======================= Paper Plane ======================= */
  ACT.paper = {
    name: "Paper Plane", desc: "Launch a paper dart off the top of the city's tallest tower and land it in the target circle far below.", aircraft: "paperplane",
    start() {
      const C = RJ.cities, lm = C && (C.built.dubai || C.built.tokyo);
      if (C && C.built.dubai) { const S = C.sites.dubai, x = S.x - S.sx * 800, z = S.z - S.sz * 800, y = RJ.world.terrainHeight(x, z) + 590; return { pos: V3(x + S.sx * 55, y, z + S.sz * 55), yaw: Math.atan2(-S.sx, -S.sz), speed: 14, tower: "Burj Khalifa (585 m deck)" }; }
      if (RJ.nyc) { const [x, z] = RJ.nyc.esbWorld(); return { pos: V3(x + 30, 400, z), yaw: 0, speed: 14, tower: "Empire State Building" }; }
      return null;
    },
    setup(ff) {
      const pl = ff.player, f = dirFromYaw(ff.startYaw), W = RJ.world;
      this.start = pl.pos.clone(); this.t = 0;
      const drop = this.start.y - Math.max(W.ground(this.start.x, this.start.z), 0);
      const dist = drop * 3.2;
      const c = pl.pos.clone().addScaledVector(f, dist); c.y = Math.max(W.ground(c.x, c.z), 0);
      this.target = c; this.zone = marker(40, 0xffc23a); this.zone.position.set(c.x, c.y + 1.5, c.z);
      RJ.ui.flash("PAPER PLANE", `Target ${(dist / 1000).toFixed(1)} km ahead`, 3);
    },
    update(ff, dt) {
      const pl = ff.player; if (this.done) return;
      this.t += dt;
      if (pl.alive && pl.agl < 2 && this.t > 2) this.finish(ff);
    },
    finish(ff) {
      this.done = true;
      const pl = ff.player, miss = Math.hypot(pl.pos.x - this.target.x, pl.pos.z - this.target.z);
      const pts = Math.max(0, Math.round(1000 - miss * 2)), xp = Math.round(pts / 4), unlocked = RJ.addXP(xp); RJ.saveProgress();
      results({ eyebrow: "Paper Plane", title: miss < 40 ? "BULLSEYE" : `${Math.round(miss)} m off`, win: miss < 150,
        sub: `Flight time ${fmt(this.t)}, ${(Math.hypot(pl.pos.x - this.start.x, pl.pos.z - this.start.z) / 1000).toFixed(2)} km from the tower.`, stats: [["Score", `${pts}`], ["Miss distance", `${Math.round(miss)} m`]], xp, unlocked });
    },
    onDestroyed(ff, d) { if (d.ac === ff.player && !this.done) { this.finish(ff); return true; } },
    status(ff) { const pl = ff.player, d = Math.hypot(pl.pos.x - this.target.x, pl.pos.z - this.target.z); return `<b>PAPER PLANE</b>${Math.round(d)} m to target · ${Math.round(pl.agl)} m up`; },
    objective() { return "Gentle inputs: the dart stalls if you pull too hard. Touch down inside the yellow circle."; },
    hud(ff, out) { if (!this.done) out.ring = { pos: this.target.clone().setY(this.target.y + 20) }; },
    dispose() { if (this.zone) RJ.scene.remove(this.zone); }
  };

  /** Free Flight activity list entries (the ring courses, including Drone Race, are in modes.js). */
  ACT.LIST = ["bombing", "area51", "cargo", "wingsuit", "paper"].map((id) => ({ id, name: ACT[id].name, desc: ACT[id].desc }));
  if (RJ.modes && RJ.modes.ACTIVITIES) RJ.modes.ACTIVITIES.push(...ACT.LIST);
  /** A fresh, per-flight instance of an activity. */
  ACT.make = (id) => (ACT[id] && typeof ACT[id] === "object" && ACT[id].setup ? Object.assign(Object.create(ACT[id]), { id }) : null);
})(window.RJ);
