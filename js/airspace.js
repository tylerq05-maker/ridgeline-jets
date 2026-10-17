/* Jet City — living airspace for Free Flight.
 * AI traffic drawn from the whole roster (airliners, business and light aircraft, helicopters, fighters, bombers,
 * recon jets, starfighters and flying cars), military patrols, special encounters, six-ship Blue Angels airshows,
 * missile combat against any of them, and a five-star wanted level with an escalating military response that ends
 * with six F-22s arriving in an arrowhead. Everything flies on the existing systems: RJ.Aircraft (flight model,
 * damage, LOD, contrails, nav lights), combat.Pilot (AI), combat missiles and missilefx. This file only schedules,
 * spawns, steers formations, keeps score and talks on the radio. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, DEG = RJ.DEG, UP = V3(0, 1, 0);
  const A = (RJ.airspace = { on: false, list: [], t: 0 });
  const tv = V3(), tv2 = V3(), tv3 = V3(), tq = new THREE.Quaternion(), te = new THREE.Euler(0, 0, 0, "YXZ");
  const rand = (a, b) => a + Math.random() * (b - a);
  const flat = (v) => tv3.set(v.x, 0, v.z).normalize();
  const H = (x, z) => Math.max(0, RJ.world.heightFn(x, z));
  /** Highest terrain along a straight leg (10 samples). */
  function legTop(a, b) { let m = 0; for (let i = 0; i <= 10; i++) { const k = i / 10; m = Math.max(m, H(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)); } return m; }

  /* ======================= roster ======================= */
  /* alt: cruise band above sea level (raised over high terrain) · agl: band above the ground · spd: share of vmax
   * kin: flown on a smooth kinematic path (helicopters, starfighters, flying cars) instead of the jet flight model */
  const KIND = {
    airliner: { alt: [8200, 10600], spd: 0.86, civ: true, call: ["Skyline", "Transpac", "Atlas", "Coastal", "Polar"] },
    business: { alt: [9500, 12500], spd: 0.86, civ: true, call: ["Exec", "Gulf"] },
    light: { agl: [500, 1400], spd: 0.75, civ: true, call: ["Cessna", "Mustang", "November"] },
    heli: { agl: [320, 750], kin: 62, mil: true, call: ["Dustoff", "Saber"] },
    oddity: { agl: [260, 650], kin: 58, civ: true, call: ["Skylark", "Jetson"] },
    fighter: { agl: [1300, 6500], spd: 0.46, mil: true, call: ["Viper", "Eagle", "Hornet", "Lancer", "Ghost"] },
    bomber: { alt: [6500, 11500], spd: 0.72, mil: true, call: ["Doom", "Spirit", "Bone"] },
    recon: { alt: [15500, 22000], spd: 0.62, mil: true, call: ["Aspen", "Blackbird"] },
    space: { agl: [700, 2600], kin: 380, civ: true, call: ["Rogue", "Gold"] }
  };
  let ROSTER = null;
  function roster() {
    if (ROSTER) return ROSTER;
    const K = {}; for (const k in KIND) K[k] = [];
    for (const s of Object.values(RJ.AIRCRAFT)) {
      const m = s.flight.model;
      if (m === "car" || m === "bike") K.oddity.push(s.id);
      else if (m === "heli") K.heli.push(s.id);
      else if (m === "space") K.space.push(s.id);
      else if (s.cat === "airliner" || s.id === "c17") K.airliner.push(s.id);
      else if (s.id === "g650") K.business.push(s.id);
      else if (s.cat === "civil" || s.id === "p51") K.light.push(s.id);
      else if (s.cat === "bomber") K.bomber.push(s.id);
      else if (s.cat === "recon") K.recon.push(s.id);
      else K.fighter.push(s.id);
    }
    return (ROSTER = K);
  }
  A.roster = roster;
  /** Least-seen aircraft of a kind, so every type turns up over a session. */
  function pickId(kind, pool) {
    const ids = pool || roster()[kind];
    let best = [], lo = Infinity;
    for (const id of ids) { const n = A.seen[id] || 0; if (n < lo) { lo = n; best = [id]; } else if (n === lo) best.push(id); }
    const id = RJ.pick(best); A.seen[id] = lo + 1; return id;
  }
  const cruiseOf = (id, kind) => { const s = RJ.AIRCRAFT[id], K = KIND[kind]; return K.kin ? K.kin * (s.flight.model === "space" ? 1 : s.flight.model === "car" || s.flight.model === "bike" ? 0.9 : 1) : Math.min(900, Math.max(s.flight.vstall * 1.7, s.flight.vmax * K.spd)); };

  /* ======================= settings ======================= */
  A.DENSITY = { off: 0, light: 7, normal: 12, busy: 18 };
  A.WANTED_COUNTS = [0, 1, 2, 3, 4, 6];            // default fighters per star level (5 stars: the six-ship F-22 arrowhead)
  A.RESPONSE = { light: 0.6, standard: 1, heavy: 1.5 };
  const density = () => A.DENSITY[RJ.settings.airTraffic || "normal"] || 0;
  const scale = () => A.RESPONSE[RJ.settings.wantedScale || "standard"] || 1;

  /* ======================= spawning ======================= */
  let callN = 100;
  function make(id, team, pos, yaw, speed, o) {
    o = o || {};
    const kind = o.kind, K = KIND[kind] || {};
    const callsign = o.callsign || (K.call ? `${RJ.pick(K.call)} ${++callN % 900 + 100}` : RJ.AIRCRAFT[id].short);
    const ac = new RJ.Aircraft(id, { team, livery: o.livery || null, callsign: `${callsign} (${RJ.AIRCRAFT[id].short})`, assist: true });
    ac.place(pos, yaw, speed);
    ac.neutral = team !== "red";
    ac.air = { kind, grp: o.grp || null, civ: !!K.civ && !o.mil, mil: !!(K.mil || o.mil), resp: false, show: o.show || null, born: A.t, callsign };
    if (RJ.AIRCRAFT[id].flight.model && ac.vs) { ac.vs.mode = "fly"; ac.vs.wings = ac.vs.wingsWant = 1; ac.vs.rpm = 1; ac.state = "flying"; ac.gearDown = false; ac.pos.copy(pos); }
    RJ.combat.add(ac);
    A.list.push(ac);
    return ac;
  }
  /** A route that enters from the spawn point, passes the player's area off to one side, and leaves far beyond. */
  function crossing(pl, kind, opt) {
    opt = opt || {};
    const K = KIND[kind], fwd = flat(pl.vel.lengthSq() > 1 ? pl.vel : pl.fwd).clone();
    const fast = pl.speed > 380;
    const brg = opt.brg != null ? opt.brg : (Math.random() < (fast ? 0.85 : 0.62) ? rand(-1, 1) * (fast ? 70 : 110) : rand(110, 250)) * DEG;
    const D = opt.dist || (K.agl && K.agl[1] < 1500 ? rand(4500, 7500) : rand(7500, 12500));
    const sp = fwd.clone().applyAxisAngle(UP, brg).multiplyScalar(D).add(pl.pos);
    const pass = pl.pos.clone().addScaledVector(fwd, rand(0, fast ? 6000 : 3000));
    const across = V3(pass.x - sp.x, 0, pass.z - sp.z).normalize(), side = V3(-across.z, 0, across.x);
    pass.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (opt.lateral != null ? opt.lateral : rand(900, 5500)));
    const exit = pass.clone().addScaledVector(across, rand(16000, 24000));
    const pts = [sp, pass, exit];
    const yOf = (p, prev) => {
      const top = Math.max(H(p.x, p.z), prev ? legTop(prev, p) : 0);
      if (opt.y != null) return Math.max(opt.y, top + (K.agl ? K.agl[0] : 1200));
      return K.alt ? Math.max(rand(K.alt[0], K.alt[1]), top + 1500) : top + rand(K.agl[0], K.agl[1]);
    };
    const cy = yOf(sp, null);
    pts.forEach((p, i) => { p.y = i === 0 ? cy : Math.max(K.alt ? cy : 0, yOf(p, pts[i - 1])); });
    return { start: sp, route: [pass, exit], yaw: Math.atan2(-across.x, -across.z) };
  }
  function pilotFor(ac, skill, opts) { const p = new RJ.combat.Pilot(ac, skill, opts); ac.pilot = p; return p; }

  function spawnSingle(pl, kind, opt) {
    opt = opt || {};
    const id = opt.id || pickId(kind), cr = crossing(pl, kind, opt), K = KIND[kind];
    const spd = opt.speed || cruiseOf(id, kind);
    const ac = make(id, "traffic", cr.start, cr.yaw, spd, { kind, mil: opt.mil });
    if (K.kin) kinRoute(ac, cr.route, spd, kind);
    else { const p = pilotFor(ac, "rookie", { role: "route", route: cr.route }); p.cruise = spd; if (opt.dynamic) ac.air.dynamic = true; }
    if (opt.ab) ac.air.fast = true;
    return ac;
  }
  /** Leader plus wingmen in loose formation (patrols, bomber escorts). */
  function spawnGroup(pl, kind, n, opt) {
    opt = opt || {};
    const lead = spawnSingle(pl, kind, opt), grp = { members: [lead], kind, mil: true };
    lead.air.grp = grp; lead.air.mil = true;
    const L = lead.pilot;
    if (opt.climbs) L.route.forEach((w, i) => { if (i < L.route.length - 1) w.y += rand(-900, 1400); });
    for (let i = 1; i < n; i++) {
      const id = opt.wingId || lead.id, k = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      const back = tv.copy(lead.fwd).multiplyScalar(-(40 + 25 * k)).addScaledVector(lead.right, side * 35 * k);
      const w = make(id, "traffic", lead.pos.clone().add(back), Math.atan2(-lead.fwd.x, -lead.fwd.z), lead.speed, { kind: opt.wingKind || kind, grp, mil: true, callsign: lead.air.callsign.replace(/\d+$/, (m) => +m + i) });
      const p = pilotFor(w, "veteran", { role: "wingman", leader: lead, order: "form" });
      p.formK = k * (opt.spread || 1); p.side = side;
      grp.members.push(w);
    }
    return grp;
  }

  /* ---------------- kinematic route flight (helicopters, starfighters, flying cars) ---------------- */
  function kinRoute(ac, route, spd, kind) {
    const s = { route, wp: 0, spd, yaw: Math.atan2(-ac.fwd.x, -ac.fwd.z), bank: 0, turn: kind === "space" ? 0.45 : 0.22, heli: ac.spec.flight.model === "heli", aglMin: (KIND[kind].agl || [300])[0] * 0.7 };
    ac.kr = s;
    ac.kin = (dt) => kinStep(ac, dt);
  }
  function kinStep(ac, dt) {
    const s = ac.kr, w = s.route[s.wp];
    let tyaw = s.yaw, ty = ac.pos.y;
    if (w) {
      const dx = w.x - ac.pos.x, dz = w.z - ac.pos.z, dh = Math.hypot(dx, dz);
      if (dh < Math.max(300, s.spd * 3)) s.wp++;
      tyaw = Math.atan2(-dx, -dz); ty = w.y;
    }
    let dy = tyaw - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const yr = RJ.clamp(dy, -s.turn * dt, s.turn * dt) / Math.max(dt, 1e-4);
    s.yaw += yr * dt;
    const g = H(ac.pos.x, ac.pos.z), ahead = H(ac.pos.x - Math.sin(s.yaw) * s.spd * 4, ac.pos.z - Math.cos(s.yaw) * s.spd * 4);
    ty = Math.max(ty, Math.max(g, ahead) + s.aglMin);
    const vy = RJ.clamp((ty - ac.pos.y) * 0.25, -s.spd * 0.12, s.spd * 0.2);
    s.bank = RJ.damp(s.bank, RJ.clamp(yr * (s.heli ? 0.9 : 2.2), -1.1, 1.1), 3, dt);
    ac.vel.set(-Math.sin(s.yaw) * s.spd, vy, -Math.cos(s.yaw) * s.spd);
    ac.pos.addScaledVector(ac.vel, dt);
    te.set(Math.atan2(vy, s.spd) - (s.heli ? 0.09 : 0), s.yaw, s.bank); ac.q.setFromEuler(te);
    ac.updateBasis();
    ac.speed = ac.vel.length(); ac.throttle = 0.75; ac.time += dt; ac.agl = ac.pos.y - g; ac.mach = ac.speed / RJ.soundSpeed(ac.pos.y);
    ac.lockedByT = Math.max(0, ac.lockedByT - dt);
    if (RJ.vehicles && ac.vs) RJ.vehicles.animate(ac, dt);
    ac.syncMesh();
  }

  /* ---------------- tight formations: followers placed on slots off the leader ---------------- */
  const SLOTS = {
    diamond: [[0, 0, 0], [12, -1, 11], [-12, -1, 11], [0, -2, 22], [0, -3, 44], [0, -4, 58]],   // diamond, solos in trail
    delta: [[0, 0, 0], [12, -1, 11], [-12, -1, 11], [0, -2, 22], [24, -2, 22], [-24, -2, 22]],
    echelon: [[0, 0, 0], [11, -0.8, 10], [22, -1.6, 20], [33, -2.4, 30], [44, -3.2, 40], [55, -4, 50]],
    arrow: [[0, 0, 0], [-30, 0, 28], [30, 0, 28], [-60, 0, 56], [0, 0, 56], [60, 0, 56]]          // F-22 response: one lead, five behind
  };
  A.SLOTS = SLOTS;
  function slotOf(F) {
    const a = SLOTS[F.from][F.i], b = SLOTS[F.to][F.i], k = RJ.smooth(0, 1, F.mix);
    return tv2.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
  }
  function attach(ac, lead, i, shape, join) {
    ac.form = { lead, i, from: shape, to: shape, mix: 1, wob: Math.random() * 6, join: join ? 0 : 1, jp: ac.pos.clone(), jq: ac.q.clone() };
    ac.pilot = null;
    ac.kin = (dt) => follow(ac, dt);
  }
  function release(ac) { ac.kin = null; ac.form = null; }
  function follow(ac, dt) {
    const F = ac.form, L = F.lead;
    if (!L.alive) { release(ac); if (!ac.pilot) pilotFor(ac, "veteran", { role: "route", route: [ac.pos.clone().addScaledVector(ac.fwd, 20000)] }); return; }
    if (F.mix < 1) F.mix = Math.min(1, F.mix + dt / 3.5);
    const sl = slotOf(F);
    const p = tv.copy(sl).applyQuaternion(L.q).add(L.pos);
    p.x += Math.sin(A.t * 0.71 + F.wob) * 0.35; p.y += Math.sin(A.t * 0.93 + F.wob * 2) * 0.3; // breathing: welded, but alive
    if (F.join < 1) {
      // rejoining after a break: ease from where it was onto the slot
      F.join = Math.min(1, F.join + dt / 7); const k = RJ.smooth(0, 1, F.join);
      ac.pos.copy(F.jp).lerp(p, k); ac.q.copy(F.jq).slerp(L.q, k);
      F.jp.addScaledVector(ac.vel, dt);
    } else { ac.pos.copy(p); ac.q.copy(L.q); }
    ac.updateBasis();
    ac.vel.copy(L.vel); ac.speed = L.speed; ac.throttle = L.throttle; ac.abLevel = L.abLevel; ac.spool = L.spool;
    ac.ctl.pitch = L.ctl.pitch; ac.ctl.roll = L.ctl.roll; ac.ctl.yaw = L.ctl.yaw; ac.input.brake = L.input.brake;
    ac.g = L.g; ac.aoa = L.aoa; ac.mach = L.mach; ac.time += dt; ac.agl = L.agl + (ac.pos.y - L.pos.y);
    ac.lockedByT = Math.max(0, ac.lockedByT - dt); ac.state = "flying";
    ac.syncMesh();
  }

  /* ======================= Blue Angels airshow ======================= */
  const SHOW_SK = { react: 0.1, gUse: 0.62, aim: 0.05, flare: 0, mslRate: 0, evade: 0.3, lead: 1, minAgl: 300 };
  class ShowPilot extends RJ.combat.Pilot {
    constructor(ac, show) { super(ac, SHOW_SK, { role: "route" }); this.show = show; }
    think() { this.show.steer(this); if (this.show.step.id !== "loop") this.avoidTerrain(); }
    update(dt) {
      super.update(dt);
      const st = this.show.step;
      if (st.id === "roll" && st.rolling) { this.ac.input.roll = 0.32; this.ac.input.pitch = 0.1; this.ac.input.yaw = 0; }
    }
  }
  const SHOW_SEQ = ["pass", "turn", "deltapass", "turn", "loop", "turn", "breakout", "turn", "roll", "turn", "wave", "turn", "echelonpass", "turn"];
  class Show {
    constructor(pl) {
      const fwd = flat(pl.vel.lengthSq() > 1 ? pl.vel : pl.fwd).clone();
      // somewhere ahead and off to one side, 7–10 km out: discovered, not dropped in front of the nose
      const brg = (Math.random() < 0.5 ? -1 : 1) * rand(25, 70) * DEG;
      this.c = fwd.clone().applyAxisAngle(UP, brg).multiplyScalar(rand(7000, 10000)).add(pl.pos);
      this.dir = fwd.clone().applyAxisAngle(UP, rand(-1.4, 1.4)); this.dir.y = 0; this.dir.normalize();
      let top = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) top = Math.max(top, H(this.c.x + i * 1500, this.c.z + j * 1500));
      this.y = top + 1250; this.c.y = this.y;
      const entry = this.c.clone().addScaledVector(this.dir, -6000);
      const yaw = Math.atan2(-this.dir.x, -this.dir.z);
      this.jets = [];
      for (let i = 0; i < 6; i++) {
        const s = SLOTS.diamond[i];
        const p = tv.set(s[0], s[1], s[2]).applyAxisAngle(UP, yaw).add(entry).clone();
        const ac = make("fa18e", "traffic", p, yaw, 185, { kind: "fighter", livery: "blueangels", callsign: `Blue Angel ${i + 1}`, show: this, mil: false });
        ac.air.civ = true; ac.air.mil = false;
        this.jets.push(ac);
      }
      this.lead = this.jets[0]; this.lead.tag = "BLUE ANGELS";
      this.lead.pilot = new ShowPilot(this.lead, this);
      for (let i = 1; i < 6; i++) attach(this.jets[i], this.lead, i, "diamond");
      this.k = -1; this.t = 0; this.life = rand(330, 420); this.smoke = false;
      this.next("arrive");
      RJ.ui.feed("Blue Angels airshow nearby", "b");
    }
    get alive() { return this.jets.some((a) => a.alive); }
    shape(name) { for (const a of this.jets) if (a.form && a.form.to !== name) { a.form.from = a.form.to; a.form.to = name; a.form.mix = 0; } }
    next(force) {
      this.k++;
      const id = force || (this.t > this.life ? "depart" : SHOW_SEQ[this.k % SHOW_SEQ.length]);
      this.step = { id, t: 0, h0: this.lead.fwd.clone(), acc: 0 };
      this.smoke = /pass|loop|breakout|roll|wave/.test(id);
      if (id === "deltapass") this.shape("delta");
      else if (id === "echelonpass") this.shape("echelon");
      else if (id === "pass" || id === "loop" || id === "roll" || id === "wave") this.shape(id === "pass" || id === "wave" ? "diamond" : "delta");
      if (id === "breakout") this.breakOut();
      if (id === "turn") this.turnTo = this.lead.fwd.clone().setY(0).normalize().negate();
    }
    breakOut() {
      // the formation bursts apart (fleur-de-lis), each jet trailing smoke, then rejoins on the leader
      const f = flat(this.lead.fwd).clone();
      this.jets.forEach((a, i) => {
        if (i === 0 || !a.alive) return;
        release(a);
        const ang = [0, 28, -28, 0, 62, -62][i] * DEG, up = [0, 0.35, 0.35, 0.65, 0.12, 0.12][i];
        const p = pilotFor(a, SHOW_SK, { role: "route" });
        p.overT = 5.5; p.overDir = f.clone().applyAxisAngle(UP, ang).add(V3(0, up, 0)).normalize();
      });
      this.rejoinAt = 7;
    }
    steer(p) {
      const st = this.step, L = this.lead, c = this.c, d = this.dir;
      p.mode = "show"; p.thr = 0.82; p.ab = false; p.fireWish = false;
      const holdY = (y) => RJ.clamp((y - L.pos.y) / 900, -0.25, 0.3);
      if (st.id === "arrive" || st.id === "depart") {
        const tgt = st.id === "arrive" ? tv.copy(c).addScaledVector(d, -3500) : tv.copy(c).addScaledVector(d, 30000);
        p.desired.copy(tgt).sub(L.pos).setY(0).normalize(); p.desired.y = holdY(this.y); p.desired.normalize();
        if (st.id === "arrive" && L.pos.distanceTo(tgt) < 1600) this.next("pass");
        return;
      }
      if (/pass|roll|wave/.test(st.id)) {
        // along the show line through the centre, at show height (the wave climbs and dips 350 m)
        const along = tv.copy(L.pos).sub(c).dot(d), dirS = st.dirS || (st.dirS = Math.sign(flat(L.fwd).dot(d)) || 1);
        const lineDir = tv2.copy(d).multiplyScalar(dirS);
        const lat = tv.copy(L.pos).sub(c).setY(0).addScaledVector(d, -along);
        p.desired.copy(lineDir).addScaledVector(lat, -1 / 2500);
        const y = this.y + (st.id === "wave" ? Math.sin(st.t * 0.45) * 350 : 0);
        p.desired.y = holdY(y); p.desired.normalize();
        if (st.id === "roll") st.rolling = st.t > 3 && st.t < 3 + 2 * Math.PI / 1.4;
        if (along * dirS > 4200) this.next();
        return;
      }
      if (st.id === "turn") {
        // a level, banked 180: lead the heading round 50° at a time (aiming straight behind would pull the jets
        // up into a stall), turning toward the show centre so the line comes back over the crowd
        const f = flat(L.fwd).clone();
        if (!st.side) { const left = f.clone().applyAxisAngle(UP, Math.PI / 2); st.side = Math.sign(tv.copy(c).sub(L.pos).dot(left)) || 1; }
        if (f.dot(this.turnTo) < 0.6) p.desired.copy(f).applyAxisAngle(UP, st.side * 50 * DEG);
        else p.desired.copy(this.turnTo);
        p.desired.y = holdY(this.y); p.desired.normalize();
        p.thr = 0.95;
        if (f.dot(this.turnTo) > 0.96 && st.t > 4) this.next();
        return;
      }
      if (st.id === "loop") {
        // full loop in formation: pull through the vertical, track how far round the nose has come
        p.thr = 1; p.ab = st.acc < Math.PI;
        if (st.t < 1.5) { p.desired.copy(flat(L.fwd)); p.desired.y = holdY(this.y); p.desired.normalize(); return; }
        p.desired.copy(L.fwd).applyAxisAngle(L.right, 0.9).normalize();
        if (st.acc > 2 * Math.PI - 0.35) this.next("turn");
        return;
      }
      if (st.id === "breakout") {
        p.desired.copy(flat(L.fwd)); p.desired.y = holdY(this.y + 250); p.desired.normalize();
        if (st.t > 14) this.next("turn");
      }
    }
    update(dt) {
      const st = this.step, L = this.lead;
      this.t += dt; st.t += dt;
      if (!L.alive) { this.scatter(); return; }
      if (st.id === "loop" && st.t >= 1.5) { const a = Math.acos(RJ.clamp(L.fwd.dot(st.h0), -1, 1)); st.acc += Math.abs(a - (st.lastA || 0)) > 0.5 ? 0 : Math.abs(a - (st.lastA || 0)); st.lastA = a; }
      if (st.id === "breakout" && this.rejoinAt != null && st.t > this.rejoinAt) {
        this.rejoinAt = null;
        this.jets.forEach((a, i) => { if (i && a.alive && !a.air.fled) attach(a, L, i, "delta", true); });
      }
      for (const a of this.jets) {
        if (!a.alive) { if (a._srib) RJ.missileFx.smoke(a, null); continue; }
        const on = this.smoke && !a.air.fled && a.state === "flying";
        RJ.missileFx.smoke(a, on ? a.mesh.localToWorld(tv.copy(a.vis.nozzles[0] || tv.set(0, 0, 8))) : null);
      }
      if (st.id === "depart" && L.pos.distanceTo(RJ.game.mode.player.pos) > 16000) this.done = true;
    }
    /** Attacked or lost the leader: the team breaks off and heads for home. */
    scatter() {
      if (this.scattered) return;
      this.scattered = true; this.smoke = false; this.lead.tag = null;
      this.jets.forEach((a, i) => {
        if (!a.alive) return;
        release(a); a.air.fled = true; RJ.missileFx.smoke(a, null);
        const away = flat(a.fwd).clone().applyAxisAngle(UP, (i - 2.5) * 0.35);
        pilotFor(a, "veteran", { role: "runner", route: [a.pos.clone().addScaledVector(away, 25000).setY(a.pos.y + 600)] });
      });
      this.done = true;
    }
  }

  /* ======================= events ======================= */
  const EVENTS = [
    { id: "airliner", w: 5 }, { id: "business", w: 1.1 }, { id: "light", w: 2.4 }, { id: "heli", w: 0.9 },
    { id: "patrol", w: 2.6 }, { id: "single", w: 1.6 }, { id: "pair", w: 1.3, cd: 40 }, { id: "fastpass", w: 0.8, cd: 75 },
    { id: "bomber", w: 0.9, cd: 30 }, { id: "recon", w: 0.5, cd: 60 }, { id: "space", w: 0.35, cd: 200 }, { id: "oddity", w: 0.35, cd: 150 }
  ];
  function runEvent(e, pl) {
    const R = roster();
    switch (e.id) {
      case "airliner": case "business": case "light": case "heli": case "recon": case "space": case "oddity":
        return spawnSingle(pl, e.id, { mil: e.id === "heli" || e.id === "recon" });
      case "single": return spawnSingle(pl, "fighter", { dynamic: true, mil: true });
      case "patrol": return spawnGroup(pl, "fighter", 2 + Math.floor(Math.random() * 3), { climbs: Math.random() < 0.5 });
      case "pair": { // two fighters side by side, crossing close to the player's path
        const g = spawnGroup(pl, "fighter", 2, { lateral: rand(500, 1200), y: pl.pos.y + rand(-300, 500), spread: 0.55 });
        return g;
      }
      case "fastpass": { // a fast jet tears past from behind, low and close
        const pool = R.fighter.concat(R.recon).filter((id) => RJ.AIRCRAFT[id].flight.vmax > 550);
        const id = pickId("fighter", pool), sp = RJ.AIRCRAFT[id].flight.vmax * 0.85;
        const ac = spawnSingle(pl, "fighter", { id, brg: rand(160, 200) * DEG, dist: rand(5000, 7000), lateral: rand(150, 400), y: pl.pos.y + rand(-80, 150), speed: sp, mil: true, ab: true });
        ac.speed = sp; ac.vel.copy(ac.fwd).multiplyScalar(sp); if (ac.pilot) ac.pilot.cruise = sp;
        return ac;
      }
      case "bomber": {
        if (Math.random() < 0.5) return spawnSingle(pl, "bomber", { mil: true });
        return spawnGroup(pl, "bomber", 3, { wingId: pickId("fighter"), wingKind: "fighter", spread: 2 });
      }
    }
    return null;
  }
  function pickEvent() {
    const ok = EVENTS.filter((e) => !(e.cd && A.t - (A.cool[e.id] || -1e9) < e.cd) && roster()[e.id === "single" || e.id === "patrol" || e.id === "pair" || e.id === "fastpass" ? "fighter" : e.id] !== undefined);
    let s = 0; for (const e of ok) s += e.w;
    let r = Math.random() * s;
    for (const e of ok) { r -= e.w; if (r <= 0) return e; }
    return ok[0];
  }

  /* ======================= wanted level ======================= */
  const W = (A.wanted = { level: 0, shown: 0, lastHostile: -1e9, lastEsc: -1e9, evade: 0, contact: false, lastKnown: V3(), nextSpawn: 0, raptors: false, wave: 1, hitT: new WeakMap() });
  const RADIO = {};
  function radio(key, who, lines, cd) {
    if (RADIO[key] && A.t - RADIO[key] < (cd || 15)) return;
    RADIO[key] = A.t;
    if (RJ.companion) RJ.companion.say(Array.isArray(lines) ? RJ.pick(lines) : lines, 2, { speaker: who, male: true });
  }
  const LEVEL_CALLS = [
    ["Air Defense, threat cleared. All units return to base.", "Command: contact lost for good. Stand down."],
    ["Unknown aircraft, this is Air Defense Command. Identify yourself.", "Unidentified aircraft, you are entering restricted airspace. Respond on guard.", "Aircraft attacking civilian traffic, identify yourself immediately."],
    ["Hostile act confirmed. Military interceptors are approaching.", "Interceptors scrambled. You are being intercepted. Change course immediately."],
    ["Multiple hostile aircraft approaching your position.", "Three-ship flight inbound. Hostile aircraft, land immediately or you will be fired upon."],
    ["All units, weapons free. Bring that aircraft down.", "Major response authorised. Four-ship flight vectoring to intercept."],
    ["Maximum threat response initiated. Raptor flight, six ships, inbound.", "Raptor flight is airborne. Six F-22s inbound. This ends now."]
  ];
  function setLevel(l, why) {
    l = RJ.clamp(l, 0, 5);
    if (l === W.level) return;
    const up = l > W.level;
    W.level = l; W.evade = 0;
    if (up) { W.lastEsc = A.t; W.nextSpawn = Math.min(W.nextSpawn, A.t + (l === 1 ? 4 : 2)); W.flashT = 2.5; }
    RJ.ui.flash(up ? "WANTED " + "★".repeat(l) : l ? "WANTED LEVEL DOWN" : "WANTED LEVEL CLEARED", up ? why || null : l ? "★".repeat(l) : "You lost them", up ? 2.2 : 1.8, up);
    radio("lvl" + l, "AIR DEFENSE", LEVEL_CALLS[l], 25);
    if (!up) {
      // extra jets peel off and fly home (they don't vanish), the rest keep searching
      const act = responders().sort((a, b) => b.pos.distanceTo(RJ.game.mode.player.pos) - a.pos.distanceTo(RJ.game.mode.player.pos));
      const keep = l ? target(l) : 0;
      act.slice(0, Math.max(0, act.length - keep)).forEach(disengage);
    }
  }
  const target = (l) => (l >= 5 ? 6 + Math.max(0, Math.round((scale() - 1) * 4)) : Math.max(l ? 1 : 0, Math.round(A.WANTED_COUNTS[l] * scale())));
  const responders = () => A.list.filter((a) => a.alive && a.air.resp && !a.air.leaving);
  /** The player did something hostile to `ac`. kind: missile (launched at it) | hit | kill */
  function hostile(kind, ac) {
    if (!ac || !ac.air) return;
    const info = ac.air, t = A.t;
    if (kind === "hit") { const last = W.hitT.get(ac) || -1e9; if (t - last < 4) return; W.hitT.set(ac, t); }
    W.lastHostile = t;
    let to = W.level;
    if (info.resp) { if (kind === "kill" || t - W.lastEsc > 12) to++; }
    else if (kind === "kill") to = Math.max(to + 1, 2);
    else if (to === 0) to = 1;
    else if (t - W.lastEsc > 25) to++;                   // still attacking traffic after the warning
    const why = info.resp ? (kind === "kill" ? "Military jet shot down" : "You fired on a military jet") : kind === "kill" ? (info.civ ? "Civilian aircraft destroyed" : "Aircraft destroyed") : info.civ ? "Attack on civilian traffic" : "Attack on military traffic";
    setLevel(Math.min(5, to), why);
    react(ac, kind);
  }
  function react(ac, kind) {
    const info = ac.air;
    if (info.show) { info.show.scatter(); radio("ba", "BLUE ANGEL 1", ["Blue Angels taking fire! Knock it off, knock it off! Break and head for home!", "Boss here, we're under attack. Show's over, everybody out!"], 60); return; }
    if (info.resp) return;
    if (info.mil && info.grp) { for (const m of info.grp.members) if (m.alive && m.pos.distanceTo(ac.pos) < 12000) enlist(m); radio("pat", info.callsign.toUpperCase(), ["Taking fire! Weapons free, engage the bandit!", "We're being engaged! Flight, turn in and fight!"], 30); return; }
    if (info.mil && !ac.kr) { enlist(ac); radio("pat1", info.callsign.toUpperCase(), ["I'm hit! Engaging the shooter!", "Bandit on me! Fighting back!"], 30); return; }
    // civilians (and anything flown on a kinematic path) run for it
    if (!info.fled) {
      info.fled = true;
      const pl = RJ.game.mode.player, away = tv.copy(ac.pos).sub(pl.pos).setY(0).normalize();
      if (ac.kr) { ac.kr.route = [ac.pos.clone().addScaledVector(away, 25000)]; ac.kr.wp = 0; ac.kr.spd *= 1.3; ac.kr.turn *= 1.8; }
      else pilotFor(ac, "rookie", { role: "runner", route: [ac.pos.clone().addScaledVector(away, 25000).setY(Math.max(ac.pos.y - 500, H(ac.pos.x, ac.pos.z) + 600))] });
      if (info.civ) radio("may", info.callsign.toUpperCase(), ["Mayday, mayday! We're under attack!", "Mayday! Unknown fighter firing on us! Requesting help!", "We're hit! Mayday, mayday!"], 40);
    }
  }
  /** Turn a military NPC into a responder that hunts the player. */
  function enlist(ac, skill) {
    const info = ac.air;
    if (info.resp && !info.leaving) return;
    release(ac); ac.kr = null;
    ac.team = "red"; ac.neutral = false; info.resp = true; info.leaving = false;
    const p = pilotFor(ac, skill || (W.level >= 4 ? "ace" : "veteran"), { role: "fighter", objective: W.lastKnown.clone() });
    p.detect = 9000;
    if (ac.air.grp) ac.air.grp.hostile = true;
    return p;
  }
  function disengage(ac) {
    const info = ac.air; info.leaving = true;
    ac.team = "traffic"; ac.neutral = true; ac.target = null;
    const pl = RJ.game.mode.player, away = tv.copy(ac.pos).sub(pl.pos).setY(0).normalize();
    pilotFor(ac, "veteran", { role: "route", route: [ac.pos.clone().addScaledVector(away, 25000).setY(Math.max(ac.pos.y, H(ac.pos.x, ac.pos.z) + 1500))] }).cruise = ac.spec.flight.vmax * 0.5;
  }
  const RESP_POOL = [[], ["f16", "fa18e"], ["f16", "fa18e", "f15c"], ["f15c", "f16", "fa18e", "f35a"], ["f15c", "f15ex", "f35a", "fa18e"], ["f35a", "f15ex"]];
  function spawnResponder(pl) {
    const l = W.level, id = RJ.pick(RESP_POOL[l]), fwd = flat(pl.vel.lengthSq() > 1 ? pl.vel : pl.fwd).clone();
    const brg = rand(-150, 150) * DEG, D = rand(9000, 12500);
    const p = fwd.applyAxisAngle(UP, brg).multiplyScalar(D).add(pl.pos);
    p.y = Math.max(RJ.clamp(pl.pos.y + rand(-500, 800), 1200, 14000), legTop(p, pl.pos) + 900);
    const yaw = Math.atan2(-(pl.pos.x - p.x), -(pl.pos.z - p.z));
    const ac = make(id, "red", p, yaw, RJ.AIRCRAFT[id].flight.vmax * 0.6, { kind: "fighter", mil: true, callsign: `Viper ${W.wave}-${responders().length + 1}` });
    ac.air.resp = true;
    if (l === 1) {
      // one star: an interceptor comes to look, then sits off your wing and talks; it only shoots if you do
      const pi = pilotFor(ac, "veteran", { role: "wingman", leader: pl, order: "form" }); pi.formK = 1.8; pi.side = Math.random() < 0.5 ? -1 : 1; ac.air.shadow = true;
    } else {
      const pi = pilotFor(ac, l >= 4 ? "ace" : l >= 3 ? "veteran" : "rookie", { role: "fighter", objective: W.lastKnown.clone() });
      pi.detect = 9000;
      // coordinated approach: every other jet swings wide to come in from the flank
      const n = responders().length;
      if (l >= 3 && n % 2) { pi.overT = 6; pi.overDir = V3(pl.pos.x - p.x, 0, pl.pos.z - p.z).normalize().applyAxisAngle(UP, (n % 4 === 1 ? 1 : -1) * 50 * DEG); }
    }
    return ac;
  }
  /** Five stars: six F-22 Raptors in an arrowhead, coming in from ahead, holding formation until the merge. */
  function spawnRaptors(pl) {
    W.raptors = true;
    const fwd = flat(pl.vel.lengthSq() > 1 ? pl.vel : pl.fwd).clone();
    const lp = fwd.clone().applyAxisAngle(UP, rand(-30, 30) * DEG).multiplyScalar(rand(12500, 14500)).add(pl.pos);
    lp.y = Math.max(RJ.clamp(pl.pos.y + 300, 1500, 13000), legTop(lp, pl.pos) + 1200);
    const yaw = Math.atan2(-(pl.pos.x - lp.x), -(pl.pos.z - lp.z));
    const grp = { members: [], raptor: true, broken: false, born: A.t };
    for (let i = 0; i < 6; i++) {
      const s = SLOTS.arrow[i], p = tv.set(s[0], s[1], s[2]).applyAxisAngle(UP, yaw).add(lp).clone();
      const ac = make("f22", "red", p, yaw, 320, { kind: "fighter", mil: true, grp, callsign: `Raptor ${i + 1}` });
      ac.air.resp = true; grp.members.push(ac);
    }
    const L = grp.members[0];
    const lp2 = pilotFor(L, "ace", { role: "route", route: [pl.pos.clone()] }); lp2.cruise = 320;
    for (let i = 1; i < 6; i++) attach(grp.members[i], L, i, "arrow");
    W.raptorGrp = grp;
    RJ.ui.flash("★★★★★ MAXIMUM RESPONSE", "Six F-22 Raptors inbound, dead ahead", 3.5, true);
  }
  function raptorTick(pl) {
    const g = W.raptorGrp; if (!g || g.broken) return;
    const L = g.members[0];
    const hurt = g.members.some((a) => !a.alive || a.hp < a.maxHp);
    if (L.alive && L.pilot && L.pilot.route) { const tgo = Math.min(20, L.pos.distanceTo(pl.pos) / 600); L.pilot.route[0].copy(pl.pos).addScaledVector(pl.vel, tgo); L.pilot.wp = 0; }
    if (!g.hold && (!L.alive || hurt || L.pos.distanceTo(pl.pos) < 3200 || A.t - g.born > 90)) {
      g.broken = true;
      radio("split", "RAPTOR 1", ["Raptor flight, split! Engage, engage!", "Raptors, break formation. Two pursue, two flank, two high. Go!"], 30);
      // the arrowhead splits into roles: lead and two pursue, two flank wide and low, one climbs for high cover
      const f = flat(L.fwd).clone();
      g.members.forEach((a, i) => {
        if (!a.alive) return;
        release(a);
        const p = pilotFor(a, "ace", { role: "fighter", objective: W.lastKnown.clone(), style: i === 4 ? "boomer" : i % 2 ? "turner" : "sniper" });
        p.detect = 12000;
        if (i) { p.overT = [0, 2.2, 2.2, 4, 3.5, 4][i]; p.overDir = f.clone().applyAxisAngle(UP, [0, 28, -28, 75, 0, -75][i] * DEG).add(V3(0, [0, 0.15, 0.15, -0.12, 0.7, -0.12][i], 0)).normalize(); }
      });
    }
  }

  /* ======================= HUD: five stars ======================= */
  function starsEl() {
    let el = document.getElementById("wanted");
    if (!el) { el = document.createElement("div"); el.id = "wanted"; el.innerHTML = "<span>★</span>".repeat(5); document.body.appendChild(el); }
    return el;
  }
  function drawStars() {
    const el = starsEl(), l = W.level;
    const blink = l > 0 && !W.contact && Math.floor(A.t * 3) % 2 === 0;   // searching for you: the stars flash (GTA)
    el.hidden = !(RJ.settings.hud !== false) || (l === 0 && !(W.flashT > 0));
    el.className = (W.flashT > 0 ? "up " : "") + (blink ? "blink" : "");
    const s = el.children;
    for (let i = 0; i < 5; i++) s[i].className = i < l ? "on" : "";
  }

  /* ======================= lifecycle ======================= */
  A.start = function (mode) {
    A.clear();
    A.on = density() > 0 && mode.o.activity === "roam";
    if (!A.on) return false;
    RJ.combat.forceCrowd = true;
    A.nextEvent = 3; A.nextShow = rand(50, 95);
    return true;
  };
  A.stop = function () {
    A.on = false; RJ.combat.forceCrowd = false;
    const el = document.getElementById("wanted"); if (el) el.remove();
    A.list = []; A.show = null;
  };
  /** combat.reset() (respawn, mode change): the aircraft are already gone; forget them and the wanted level. */
  A.clear = function () {
    A.list = []; A.show = null; A.seen = A.seen || {}; A.cool = {}; A.t = A.t || 0;
    Object.assign(W, { level: 0, lastHostile: -1e9, lastEsc: -1e9, evade: 0, contact: false, nextSpawn: 0, raptors: false, raptorGrp: null, flashT: 0 });
    if (A.on) A.nextShow = Math.min(A.nextShow || 1e9, A.t + rand(60, 120));
  };
  A.armed = () => A.on;
  A.setLevel = (l) => setLevel(l, "Test"); // debugging / tests
  /** Player aircraft count for each state, for tests and the status line. */
  A.stats = () => ({ traffic: A.list.filter((a) => a.alive && !a.air.resp && !a.air.show).length, responders: responders().length, show: !!A.show, level: W.level });

  A.update = function (dt, pl) {
    if (!A.on) return;
    A.t += dt;
    if (W.flashT > 0) W.flashT -= dt;
    A._acc = (A._acc || 0) + dt;
    if (A.show) { A.show.update(dt); if (A.show.done && !A.show.alive) A.show = null; }
    if (A._acc < 0.25) { drawStars(); return; }
    const step = A._acc; A._acc = 0;
    if (!pl || !pl.alive) { drawStars(); return; }
    // ---- housekeeping: wrecks, aircraft that have left the area ----
    for (let i = A.list.length - 1; i >= 0; i--) {
      const a = A.list[i], info = a.air;
      const gone = !a.alive && (a.state === "dead" || A.t - (info.deadT || (info.deadT = A.t)) > 25);
      const d = a.pos.distanceTo(pl.pos);
      const far = a.alive && !(info.resp && !info.leaving) && !(info.show && A.show && !A.show.done) && d > 21000;
      if (gone || far) { A.list.splice(i, 1); RJ.combat.remove(a); }
      else if (a.alive && info.dynamic && a.pilot && Math.random() < step * 0.02 && a.agl > 1500) { a.pilot.rollT = rand(1.2, 2.2); a.pilot.rollDir = Math.random() < 0.5 ? -1 : 1; }
    }
    // ---- traffic ----
    const want = density(), have = A.list.filter((a) => a.alive && !a.air.resp && !a.air.show).length;
    A.nextEvent -= step;
    if (have < want && A.nextEvent <= 0) {
      const e = pickEvent();
      if (e) { A.cool[e.id] = A.t; runEvent(e, pl); }
      A.nextEvent = have < want * 0.5 ? rand(1, 3) : rand(6, 16);
    }
    if (!A.show && A.t > A.nextShow && W.level === 0) { A.show = new Show(pl); A.nextShow = A.t + rand(420, 600); }
    // ---- wanted level ----
    const R = responders();
    W.contact = R.some((a) => a.pos.distanceTo(pl.pos) < 7000) || A.t - W.lastHostile < 15;
    if (W.contact) W.lastKnown.copy(pl.pos);
    if (W.level > 0) {
      if (!W.contact) {
        W.evade += step;
        if (W.evade > 3 && W.evade - step <= 3) radio("lost", "AIR DEFENSE", ["Contact lost. All units, search the last known position.", "We've lost him. Spread out and search."], 30);
        if (W.evade > 24 + W.level * 6) setLevel(W.level - 1);
      } else W.evade = 0;
      for (const a of R) if (a.pilot && a.pilot.objective) a.pilot.objective.copy(W.lastKnown);
      // reinforcements up to the level's strength (the F-22 arrowhead at five stars)
      if (W.level >= 5 && !W.raptors) spawnRaptors(pl);
      else if (R.length < target(W.level) && A.t > W.nextSpawn) {
        spawnResponder(pl); W.nextSpawn = A.t + (W.level >= 5 ? rand(25, 40) : rand(6, 12));
      }
      // 2+ stars: the shadowing interceptor stops being polite
      if (W.level >= 2) for (const a of R) if (a.air.shadow) { a.air.shadow = false; enlist(a); }
      for (const a of R) if (a.air.shadow && a.pos.distanceTo(pl.pos) < 2500) radio("intercept", a.air.callsign.toUpperCase(), ["You are being intercepted. Change course immediately and follow me.", "This is " + a.air.callsign + ", I am off your wing. Rock your wings and follow me."], 40);
      if (W.level >= 2 && R.some((a) => a.pos.distanceTo(pl.pos) < 9000)) radio("multi", "AIR DEFENSE", ["Multiple hostile aircraft approaching.", "Interceptors closing on your position."], 45);
      raptorTick(pl);
    }
    drawStars();
  };

  /* ======================= hostile acts (existing combat events) ======================= */
  const byPlayer = (a) => a && a.isPlayer;
  RJ.on("missile", (e) => { if (A.on && byPlayer(e.by) && e.msl.target && e.msl.target.air) hostile("missile", e.msl.target); });
  RJ.on("damage", (e) => { if (A.on && byPlayer(e.attacker) && e.ac.air) hostile("hit", e.ac); });
  RJ.on("destroyed", (d) => {
    if (!A.on) return;
    if (d.ac.isPlayer) return;                                   // respawn resets everything (combat.reset)
    if (d.ac.air) {
      d.ac.air.deadT = A.t;
      if (byPlayer(d.by)) { hostile("kill", d.ac); RJ.ui.feed(`You ▸ ${d.ac.air.callsign} (${d.ac.spec.short})`, d.ac.air.resp ? "b" : "r"); }
      if (d.ac.air.show) d.ac.air.show.scatter();
    }
  });
  // an NPC fighter fired at by the player recognises the threat right away (missile warning on its side)
  RJ.on("missile", (e) => { const t = e.msl.target; if (A.on && byPlayer(e.by) && t && t.air && t.air.mil && !t.air.resp && !t.kr && !t.air.show) enlist(t); });
})(window.RJ);
