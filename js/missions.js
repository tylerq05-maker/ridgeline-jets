/* Ridgeline Jets — dogfight missions.
 * Objective-driven fights built on the Dogfight mode and the AI pilot roles in combat.js:
 * escort a B-2 along its route, intercept strike jets in the bridge canyon, defend Highkeep Castle
 * and the carrier from raids, and chase down a fleeing prototype. (Survival waves live in modes.js.)
 * Wingmen take the same radio calls as in Dogfight (attack / cover / form / defend). */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, M = RJ.modes, TAU = Math.PI * 2;
  const dirFromYaw = (yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const yawFromDir = (d) => Math.atan2(-d.x, -d.z);
  const G = (x, z) => Math.max(RJ.world.ground(x, z), 0);
  const ENEMY = { rookie: ["f4", "f16", "fa18e"], veteran: ["f16", "f15c", "fa18e", "f14"], ace: ["f15ex", "f22", "f35a", "yf23"] };
  const STRIKERS = ["a10", "f4", "f117", "fa18e"];
  const CALL = ["Viper", "Cobra", "Jester", "Iceman", "Spike", "Mako", "Havoc", "Razor", "Talon", "Saber", "Bishop", "Wraith"];

  M.MISSIONS = [
    { id: "escort", name: "Escort the B-2", desc: "Keep a B-2 alive along its 28 km strike route. Three flights of fighters will hunt it.", obj: "B-2",
      brief: "Spirit is a B-2 on a twenty-eight kilometre strike run, and three flights of fighters want it dead. Stay close, pick them off before they reach the bomber, and use your wingman." },
    { id: "intercept", name: "Canyon Intercept", desc: "Four strike jets are running the bridge gorge at low level. Stop them before two get through.", obj: "Leakers",
      brief: "Four strike jets are coming down the bridge gorge, low and fast. Get down into that canyon with them. If two get through, we lose." },
    { id: "castle", name: "Defend Highkeep", desc: "Three raids are inbound on Highkeep Castle. Every bomber that reaches it damages the keep.", obj: "Castle",
      brief: "Three raids are heading for Highkeep Castle. The bombers are the priority, the escorts are a distraction. Don't let them reach the keep." },
    { id: "carrier", name: "Protect the Carrier", desc: "Escorted strike raids are heading for the carrier. Keep the ship in the fight.", obj: "Carrier",
      brief: "Strike raids are inbound on the carrier. Five thousand sailors are counting on you. Intercept them well out." },
    { id: "pursuit", name: "Pursuit", desc: "A stolen YF-23 is escaping low through the mountains. Shoot it down before it clears the range.", obj: "Target",
      brief: "Someone just stole a YF-23 and it's running low through the mountains. Cut the corners, keep your speed, and bring it down before it reaches the coast." },
    { id: "sweep", name: "Air Superiority Sweep", desc: "Clear the sky over the range: three waves of fighters, each bigger than the last. Faster clears score more.", obj: "Bandits",
      brief: "Air superiority sweep. Three waves of fighters, each one bigger than the last. Clear the sky, and the faster you do it, the better I'll grade you." },
    { id: "nightraid", name: "Night Raid", desc: "Bombers are coming for the home airbase after dark. Find them on radar and stop them.", obj: "Airbase", time: "night",
      brief: "It's dark, and bombers are heading for our home airbase. Use your radar, watch for their engines, and stop every one of them before they drop." },
    { id: "recon", name: "Recon Run", desc: "Fly through four photo checkpoints over the landmarks before the clock runs out. Fighters will try to stop you.", obj: "Checkpoints",
      brief: "Recon run. Four photo checkpoints over the landmarks, and the clock is ticking. Fighters will try to intercept. Stay fast, stay low, and don't stop to fight unless you have to." }
  ];
  M.isMission = (id) => M.MISSIONS.some((m) => m.id === id);

  class Mission extends M.Dogfight {
    constructor(o) { super(o); this.kind = "fight"; this.mission = M.MISSIONS.find((m) => m.id === o.match) || M.MISSIONS[0]; }
    async setup(progress) {
      const o = this.o, ms = this.mission;
      this.match = { id: ms.id, name: ms.name, blue: 1, red: 0 };
      this.diff = M.DIFFS.find((d) => d.id === o.diff) || M.DIFFS[1];
      RJ.world.setEnvironment({ time: ms.time || o.time, weather: ms.id === "carrier" || ms.id === "escort" ? "scattered" : "clear" });
      RJ.atlas.ensure();
      if (RJ.world.airbase) RJ.world.setAirbase(null);
      this.score = 0; this.kills = 0; this.deaths = 0; this.t = 0; this.wave = 0; this.ended = false; this.spectate = null; this.endT = null;
      this.raids = []; this.objHp = 100; this.leaks = 0; this.spawnQ = [];
      const plan = this["plan_" + ms.id]();
      this.plan = plan;
      await RJ.world.prepare(plan.pPos, progress);
      this.player = M.makePlayer(o.aircraft, plan.pPos, plan.pYaw, M.cruiseSpeed(RJ.AIRCRAFT[o.aircraft]) * 1.15);
      this.player.throttle = 0.85;
      RJ.game.allowBombs = false;
      // one wingman on the defensive missions
      if (plan.wing) {
        const side = V3(-Math.cos(plan.pYaw), 0, Math.sin(plan.pYaw));
        const p = plan.pPos.clone().addScaledVector(side, 220).addScaledVector(dirFromYaw(plan.pYaw), -150);
        this.spawnAI(RJ.pick(["f16", "f15c", "fa18e"]), "blue", p, plan.pYaw, "Goose", this.diff.id === "rookie" ? "veteran" : this.diff.id,
          { role: "wingman", leader: this.player, order: "cover", objective: this.objectivePoint() });
      }
      if (plan.start) plan.start();
      RJ.progress.stats.matches++; RJ.saveProgress();
      RJ.ui.flash(ms.name.toUpperCase(), plan.brief, 3.5);
      // Nova gives the briefing over the radio once the jet is live
      if (RJ.companion && ms.brief) setTimeout(() => { if (RJ.game.mode === this) RJ.companion.say(ms.brief, 3); }, 1800);
    }
    objectivePoint() {
      const p = this.plan;
      if (!p) return this.player ? this.player.pos.clone() : V3();
      if (p.vip && p.vip.alive) return p.vip.pos; // live reference: defenders follow the bomber
      return p.objPos ? p.objPos.clone() : this.player.pos.clone();
    }
    skill() { return this.diff.id; }
    enemyId() { return RJ.pick(ENEMY[this.diff.id]); }

    /* ---------------- mission layouts ---------------- */
    plan_escort() {
      const h = RJ.atlas.home, yaw = h.yaw + Math.PI * 0.25, d = dirFromYaw(yaw);
      const start = V3(h.x - d.x * 4000, 0, h.z - d.z * 4000);
      const pts = [];
      let top = 0;
      for (let k = 1; k <= 4; k++) {
        const a = Math.sin(k * 1.7) * 0.35;
        const dd = d.clone().applyAxisAngle(V3(0, 1, 0), a);
        const p = (pts[k - 2] || start).clone().addScaledVector(dd, 7000);
        pts.push(p);
      }
      // cruise above the highest ground anywhere near the route
      [start, ...pts].reduce((a, b) => { for (let t = 0; t <= 1; t += 0.05) top = Math.max(top, M.highestAround(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 900, 2)); return b; });
      const alt = top + 900;
      start.y = alt; pts.forEach((p) => (p.y = alt));
      return {
        pPos: start.clone().addScaledVector(d, -700).add(V3(Math.cos(yaw) * 300, 120, -Math.sin(yaw) * 300)), pYaw: yaw, wing: true,
        brief: "Stay close to the bomber. Fighters inbound.",
        start: () => {
          const vip = this.spawnAI("b2", "blue", start, yaw, "Spirit", "veteran", { role: "route", route: pts });
          vip.hp = vip.maxHp = vip.maxHp * 2.2;
          vip.callsign = "Spirit (B-2)";
          this.plan.vip = vip; this.plan.dest = pts[3];
          this.spawnQ = [{ t: 8, n: 2 }, { t: 50, n: 3 }, { t: 95, n: 3 }];
        },
        tick: (dt) => {
          const vip = this.plan.vip;
          if (!vip.alive) return this.finish(false, "The B-2 was shot down.");
          if (vip.pilot.done || vip.pos.distanceTo(this.plan.dest) < 900) return this.finish(true, "The B-2 reached its target.");
          for (const q of this.spawnQ) if (!q.done && this.t >= q.t) {
            q.done = true; this.wave++;
            const ang = yawFromDir(vip.fwd) + RJ.rand(-0.9, 0.9);
            const c = vip.pos.clone().addScaledVector(dirFromYaw(ang), 6500);
            c.y = Math.max(vip.pos.y + 300, M.highestAround(c.x, c.z, 2000, 3) + 600);
            for (let i = 0; i < q.n; i++) {
              const p = c.clone().add(V3(RJ.rand(-500, 500), RJ.rand(-100, 100), RJ.rand(-500, 500)));
              const e = this.spawnAI(this.enemyId(), "red", p, yawFromDir(vip.pos.clone().sub(p)), CALL[(this.wave * 3 + i) % CALL.length], this.skill());
              // most of each flight goes straight for the bomber; one takes on the escort
              if (i < q.n - 1 || q.n === 1) e.target = vip;
            }
            RJ.ui.flash(`BANDITS · WAVE ${this.wave}`, "Inbound on the bomber", 2);
          }
        },
        status: () => { const v = this.plan.vip; return `<b>ESCORT</b>B-2 ${Math.round((v.hp / v.maxHp) * 100)}% · ${(v.pos.distanceTo(this.plan.dest) / 1000).toFixed(1)} km to target · wave ${this.wave}/3`; },
        objective: () => { const k = RJ.settings.keys; return `Keep the bandits off the B-2 (the friendly marker). ${RJ.keyLabel(k.wingCover)} · cover me, ${RJ.keyLabel(k.wingDefend)} · wingmen guard the bomber.`; },
        marker: () => this.plan.vip && this.plan.vip.alive ? this.plan.vip.pos : null
      };
    }
    plan_intercept() {
      const b = RJ.atlas.plan.bridge, U = RJ.challenges.util;
      const up = U.riverWalk(b, -1, 8000, 400); // up[12] ≈ 5.2 km upstream: the route start; beyond it the strikers' holding points
      const s0 = up[12], s1 = up[11];
      const yaw = yawFromDir(V3(s1.x - s0.x, 0, s1.z - s0.z));
      const start = V3(s0.x, G(s0.x, s0.z) + 90, s0.z);
      const route = U.course(start, yaw, 22, { step: 520, alt: [80, 110], clear: 50, turnCost: 0.8, seed: 3131 });
      const end = route[route.length - 1];
      const pPos = V3(b.x, b.deck + 650, b.z).addScaledVector(V3(-Math.sin(b.th + Math.PI / 2), 0, Math.cos(b.th + Math.PI / 2)), 1500);
      return {
        pPos, pYaw: yaw, wing: false, objPos: end,
        brief: "Strike jets inbound down the gorge. Get low.",
        start: () => {
          this.strikers = [];
          for (let i = 0; i < 4; i++) {
            // each jet starts further up the river channel and follows it down to the route start
            const k = Math.min(up.length - 1, 14 + i * 1);
            const lead = up.slice(12, k).reverse().map((q) => V3(q.x, G(q.x, q.z) + 100, q.z));
            const p = V3(up[k].x, G(up[k].x, up[k].z) + 100, up[k].z);
            const nx = (lead[0] || route[0]);
            const e = this.spawnAI(RJ.pick(STRIKERS), "red", p, yawFromDir(V3(nx.x - p.x, 0, nx.z - p.z).normalize()), CALL[i], this.skill(), { role: "strike", route: lead.concat(route) });
            this.strikers.push(e);
          }
          this.player.target = this.strikers[0];
        },
        tick: () => {
          for (const e of this.strikers) if (e.alive && !e.leaked && (e.pilot.done || e.pos.distanceTo(end) < 700)) {
            e.leaked = true; this.leaks++;
            RJ.ui.flash("LEAKER", `${e.callsign} cleared the gorge`, 2, true);
            e.alive = false; e.state = "dead"; e.mesh.visible = false;
          }
          if (this.leaks >= 2) return this.finish(false, "Two strike jets got through the gorge.");
          if (this.strikers.every((e) => !e.alive)) return this.finish(true, this.leaks ? "One got through, but the strike failed." : "Every strike jet was stopped.");
        },
        status: () => `<b>CANYON INTERCEPT</b>${this.strikers.filter((e) => e.alive).length} inbound · leakers ${this.leaks}/2`,
        objective: () => "Dive into the canyon behind the strike jets. They fly low and fast down the river.",
        marker: () => end
      };
    }
    raidPlan(id, objPos, label) {
      const p = this.player;
      return {
        brief: `Three raids on the ${label}. Bombers are the priority.`, wing: true, objPos,
        start: () => { this.spawnQ = [{ t: 6 }, { t: 70 }, { t: 135 }]; },
        tick: (dt) => {
          for (const q of this.spawnQ) if (!q.done && this.t >= q.t) { q.done = true; this.spawnRaid(objPos); }
          for (const r of this.raids) for (const e of r) {
            if (!e.alive || !e.striker || e.bombed) continue;
            if (Math.hypot(e.pos.x - objPos.x, e.pos.z - objPos.z) < 1100) {
              e.bombed = true;
              const dmg = this.diff.id === "ace" ? 22 : 17;
              this.objHp = Math.max(0, this.objHp - dmg);
              for (let k = 0; k < 4; k++) {
                const ep = objPos.clone().add(V3(RJ.rand(-140, 140), 0, RJ.rand(-140, 140)));
                ep.y = RJ.world.ground(ep.x, ep.z) + 4;
                RJ.fx.explosion(ep, 2.2); RJ.emit("explosion", { pos: ep, big: 1.6 });
              }
              RJ.ui.flash(`${label.toUpperCase()} HIT`, `${this.objHp}% remaining`, 2, true);
            }
          }
          if (this.objHp <= 0) return this.finish(false, `The ${label} was destroyed.`);
          // the raid is over once every bomber is down or has dropped and turned for home
          const allSpawned = this.spawnQ.every((q) => q.done);
          const left = this.raids.flat().filter((e) => e.alive && e.striker && !(e.bombed && e.pos.distanceTo(objPos) > 4000));
          if (allSpawned && !left.length) return this.finish(true, `The ${label} held with ${this.objHp}% integrity.`);
        },
        status: () => `<b>${{ castle: "DEFEND HIGHKEEP", carrier: "PROTECT THE CARRIER", nightraid: "NIGHT RAID" }[id] || id.toUpperCase()}</b>${label} ${this.objHp}% · raid ${this.wave}/3 · ${this.raids.flat().filter((e) => e.alive).length} hostile`,
        objective: () => { const k = RJ.settings.keys; return `Bombers (marked on radar) must not reach the ${label}. ${RJ.keyLabel(k.wingDefend)} · wingmen defend it, ${RJ.keyLabel(k.wingAttack)} · wingmen attack your target.`; },
        marker: () => objPos
      };
    }
    plan_castle() {
      const c = RJ.atlas.plan.castle, objPos = V3(c.x, c.elev + 60, c.z);
      const P = this.raidPlan("castle", objPos, "castle");
      const d = dirFromYaw(c.rot + Math.PI);
      P.pPos = objPos.clone().addScaledVector(d, -2500); P.pPos.y = Math.max(objPos.y + 700, M.highestAround(P.pPos.x, P.pPos.z, 1500, 3) + 500);
      P.pYaw = yawFromDir(objPos.clone().sub(P.pPos).setY(0).normalize());
      return P;
    }
    plan_carrier() {
      const K = RJ.carrier, s = K.site, objPos = V3(s.x, 30, s.z);
      const P = this.raidPlan("carrier", objPos, "carrier");
      P.pPos = objPos.clone().add(V3(2200, 900, 600)); P.pYaw = yawFromDir(objPos.clone().sub(P.pPos).setY(0).normalize());
      return P;
    }
    plan_nightraid() {
      const h = RJ.atlas.home, objPos = V3(h.x, G(h.x, h.z) + 40, h.z);
      const P = this.raidPlan("nightraid", objPos, "airbase");
      P.pPos = objPos.clone().add(V3(1800, 0, -1400)); P.pPos.y = Math.max(objPos.y + 800, M.highestAround(P.pPos.x, P.pPos.z, 1500, 3) + 500);
      P.pYaw = yawFromDir(objPos.clone().sub(P.pPos).setY(0).normalize());
      P.brief = "Bombers inbound on the airbase. Night intercept.";
      return P;
    }
    plan_sweep() {
      const h = RJ.atlas.home, yaw = h.yaw + Math.PI * 0.6, d = dirFromYaw(yaw);
      const pPos = V3(h.x, 0, h.z).addScaledVector(d, 1500); pPos.y = M.highestAround(pPos.x, pPos.z, 2000, 3) + 900;
      const waves = this.diff.id === "rookie" ? [1, 2, 3] : this.diff.id === "veteran" ? [2, 3, 4] : [2, 4, 5];
      return {
        pPos, pYaw: yaw, wing: true, objPos: null, brief: "Three waves. Clear the sky.",
        start: () => { this.sweep = { wave: 0, group: [], waves, next: 4 }; },
        tick: (dt) => {
          const S = this.sweep;
          if (S.group.length && S.group.every((e) => !e.alive)) { S.group = []; S.next = this.t + 5; if (S.wave >= S.waves.length) return this.finish(true, `Sky clear in ${RJ.fmtTime(this.t)}.`); RJ.ui.flash(`WAVE ${S.wave} CLEARED`, "Next wave inbound", 2); }
          if (!S.group.length && this.t >= S.next && S.wave < S.waves.length) {
            const n = S.waves[S.wave++]; this.wave = S.wave;
            const pl = this.player, ang = yawFromDir(pl.fwd) + RJ.rand(-0.8, 0.8);
            const c = pl.pos.clone().addScaledVector(dirFromYaw(ang), 7000); c.y = Math.max(pl.pos.y, M.highestAround(c.x, c.z, 2000, 3) + 600);
            for (let i = 0; i < n; i++) {
              const p = c.clone().add(V3(RJ.rand(-600, 600), RJ.rand(-150, 150), RJ.rand(-600, 600)));
              S.group.push(this.spawnAI(this.enemyId(), "red", p, yawFromDir(pl.pos.clone().sub(p)), CALL[(S.wave * 5 + i) % CALL.length], this.skill()));
            }
            RJ.ui.flash(`WAVE ${S.wave} OF ${S.waves.length}`, `${n} bandit${n > 1 ? "s" : ""} inbound`, 2.2);
          }
        },
        status: () => { const S = this.sweep; return `<b>SWEEP</b>wave ${S.wave}/${S.waves.length} · ${S.group.filter((e) => e.alive).length} hostile · ${RJ.fmtTime(this.t)}`; },
        objective: () => "Find and destroy every bandit. Missiles at range, guns up close.",
        marker: () => null
      };
    }
    plan_recon() {
      const h = RJ.atlas.home, list = (RJ.atlas.list || []).filter((lm) => lm.marker && lm.id !== "airbase" && lm.id !== "carrier");
      // chain the four landmarks nearest to the airbase, each time hopping to the closest unvisited one
      const pts = []; let cur = V3(h.x, 0, h.z); const pool = list.slice();
      while (pts.length < 4 && pool.length) {
        pool.sort((a, b) => Math.hypot(a.marker.x - cur.x, a.marker.z - cur.z) - Math.hypot(b.marker.x - cur.x, b.marker.z - cur.z));
        const lm = pool.shift(); const p = V3(lm.marker.x, 0, lm.marker.z); p.y = M.highestAround(p.x, p.z, 700, 2) + 250; p.name = lm.def ? lm.def.name : lm.id; pts.push(p); cur = p;
      }
      let dist = 0; let prev = V3(h.x, 0, h.z); for (const p of pts) { dist += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
      const pv = RJ.AIRCRAFT[this.o.aircraft].flight, v = RJ.clamp(pv.vmax * 0.55, 160, 330);
      const limit = Math.round(dist / v * 1.45 + 40);
      const yaw = pts.length ? yawFromDir(V3(pts[0].x - h.x, 0, pts[0].z - h.z).normalize()) : h.yaw;
      const pPos = V3(h.x, 0, h.z); pPos.y = M.highestAround(h.x, h.z, 1200, 3) + 400;
      return {
        pPos, pYaw: yaw, wing: false, objPos: null, limit, brief: `Four checkpoints, ${RJ.fmtTime(limit)} on the clock.`,
        start: () => { this.cp = 0; this.cpPts = pts; this.chasersOut = false; },
        tick: () => {
          const pl = this.player, p = pts[this.cp];
          if (!p) return this.finish(true, `All four photos taken with ${RJ.fmtTime(Math.max(0, limit - this.t))} to spare.`);
          if (Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < 650 && Math.abs(pl.pos.y - p.y) < 900) {
            this.cp++; this.score += 150; RJ.audio.discover && RJ.audio.discover();
            RJ.ui.flash(`PHOTO ${this.cp} OF ${pts.length}`, p.name, 1.6);
            if (RJ.companion) RJ.companion.say(this.cp < pts.length ? `Got it, ${p.name}. ${pts.length - this.cp} to go.` : "That's the last photo. Nicely done.", 2);
          }
          if (!this.chasersOut && this.t > 20) {
            this.chasersOut = true;
            const n = this.diff.id === "rookie" ? 1 : 2;
            for (let i = 0; i < n; i++) { const c = pl.pos.clone().addScaledVector(pl.fwd, -6000).add(V3(RJ.rand(-800, 800), 400, RJ.rand(-800, 800))); this.spawnAI(this.enemyId(), "red", c, yawFromDir(pl.fwd), CALL[i + 7], this.skill()).target = pl; }
            RJ.ui.flash("BANDITS ON YOUR SIX", "Keep moving", 2, true);
          }
          if (this.t > limit) return this.finish(false, "Out of time.");
        },
        status: () => `<b>RECON</b>photo ${Math.min(this.cp + 1, pts.length)}/${pts.length} · ${pts[this.cp] ? (Math.hypot(this.player.pos.x - pts[this.cp].x, this.player.pos.z - pts[this.cp].z) / 1000).toFixed(1) + " km" : ""} · ${RJ.fmtTime(Math.max(0, limit - this.t))} left`,
        objective: () => pts[this.cp] ? `Next photo: ${pts[this.cp].name}. Fly within 650 m of the marker.` : "",
        marker: () => pts[this.cp] || null
      };
    }
    /** 1–3 stars for a win: winning, flying it on Veteran or Ace, and an objective-specific bonus. */
    stars() {
      if (!this.win) return 0;
      const id = this.mission.id, pl = this.player;
      let bonus = false;
      if (this.plan.objPos && ["castle", "carrier", "nightraid"].includes(id)) bonus = this.objHp >= 75;
      else if (id === "escort") bonus = this.plan.vip && this.plan.vip.hp / this.plan.vip.maxHp > 0.6;
      else if (id === "intercept") bonus = this.leaks === 0;
      else if (id === "pursuit") bonus = this.t < this.plan.limit * 0.6;
      else if (id === "sweep") bonus = this.t < 240 && pl.stats.dmgTaken < pl.maxHp * 0.5;
      else if (id === "recon") bonus = this.t < this.plan.limit * 0.75;
      return 1 + (this.diff.id !== "rookie" ? 1 : 0) + (bonus ? 1 : 0);
    }
    spawnRaid(objPos) {
      this.wave++;
      const ang = Math.random() * TAU;
      const c = objPos.clone().add(V3(Math.cos(ang) * 10500, 0, Math.sin(ang) * 10500));
      const alt = Math.max(objPos.y + 450, M.highestAround(c.x, c.z, 3000, 3) + 450);
      c.y = alt;
      const inbound = objPos.clone().sub(c).setY(0).normalize();
      const over = objPos.clone().addScaledVector(inbound, 400); over.y = Math.max(objPos.y + 280, G(over.x, over.z) + 260);
      const egress = objPos.clone().addScaledVector(inbound, 9000); egress.y = alt;
      const raid = [];
      const nStrike = this.wave === 3 ? 3 : 2, nEsc = this.diff.id === "rookie" ? 1 : 2;
      for (let i = 0; i < nStrike; i++) {
        const p = c.clone().add(V3(RJ.rand(-300, 300), RJ.rand(-60, 60), RJ.rand(-300, 300)));
        const e = this.spawnAI(this.wave === 3 && i === 0 ? "b1b" : RJ.pick(["a10", "f4", "fa18e"]), "red", p, yawFromDir(inbound), CALL[(this.wave * 4 + i) % CALL.length], this.skill(), { role: "strike", route: [over, egress] });
        e.striker = true; e.callsign = e.callsign.replace("(", "(bomber · ");
        raid.push(e);
      }
      for (let i = 0; i < nEsc; i++) {
        const p = c.clone().addScaledVector(inbound, -500).add(V3(RJ.rand(-500, 500), 250, RJ.rand(-500, 500)));
        raid.push(this.spawnAI(this.enemyId(), "red", p, yawFromDir(inbound), CALL[(this.wave * 4 + nStrike + i) % CALL.length], this.skill()));
      }
      this.raids.push(raid);
      if (!this.player.target || !this.player.target.alive) this.player.target = raid[0];
      RJ.ui.flash(`RAID ${this.wave} INBOUND`, `${nStrike} bomber${nStrike > 1 ? "s" : ""}, ${nEsc} escort${nEsc > 1 ? "s" : ""}`, 2.4);
    }
    plan_pursuit() {
      const U = RJ.challenges.util, h = RJ.atlas.home;
      const yaw = h.yaw - Math.PI * 0.5;
      const start = V3(h.x + dirFromYaw(yaw).x * 2500, 0, h.z + dirFromYaw(yaw).z * 2500);
      start.y = G(start.x, start.z) + 200;
      const route = U.course(start, yaw, 26, { step: 1100, alt: [140, 200], clear: 90, turnCost: 0.9, seed: 5150 });
      const end = route[route.length - 1];
      const d = dirFromYaw(yaw);
      const pPos = start.clone().addScaledVector(d, -1800); pPos.y = Math.max(start.y + 80, M.highestAround(pPos.x, pPos.z, 800, 3) + 200);
      return {
        pPos, pYaw: yaw, wing: false, objPos: end, limit: 170,
        brief: "Don't let it reach the coast.",
        start: () => {
          const e = this.spawnAI("yf23", "red", start, yaw, "Prototype", this.diff.id === "rookie" ? "rookie" : "veteran", { role: "runner", route });
          e.callsign = "Prototype (YF-23)";
          // the runner holds a speed you can catch in your aircraft, but only by flying a clean chase
          const pv = this.player.spec.flight;
          e.pilot.vTarget = RJ.clamp(Math.min(pv.vmax * 0.55, 300), 170, 300);
          this.runner = e; this.player.target = e;
        },
        tick: () => {
          const e = this.runner;
          if (!e.alive) return this.finish(true, "The prototype is down.");
          // throttle the runner to its target speed
          e.pilot.thr = e.speed > e.pilot.vTarget ? 0.5 : 1; e.pilot.ab = e.speed < e.pilot.vTarget * 0.9;
          if (e.pilot.done || e.pos.distanceTo(end) < 900) return this.finish(false, "The prototype escaped.");
          if (this.t > this.plan.limit) return this.finish(false, "Out of time: it slipped away.");
        },
        status: () => `<b>PURSUIT</b>${(this.runner.pos.distanceTo(this.player.pos) / 1000).toFixed(1)} km behind · ${RJ.fmtTime(Math.max(0, this.plan.limit - this.t))} left`,
        objective: () => "Run it down. It hugs the valleys; cut corners and keep your speed.",
        marker: () => null
      };
    }

    /* ---------------- flow ---------------- */
    update(dt) {
      if (this.ended) { this.endT += dt; if (this.endT > 3 && !this.shown) { this.shown = true; this.showResults(); } return; }
      this.t += dt;
      const pl = this.player;
      M.trackChallenges(pl, null);
      if (!pl.alive) return this.finish(false, this.playerCause === "terrain" || this.playerCause === "water" ? "You crashed." : "You were shot down.");
      if (this.plan.tick) this.plan.tick(dt);
      for (const a of RJ.combat.aircraft) if (a.pilot && a.alive && !a.target && a.pilot.role === "fighter") RJ.combat.autoTarget(a);
      // tidy up long-dead aircraft so big missions stay light
      if ((this._gc = (this._gc || 0) + dt) > 5) { this._gc = 0; this.cleanupDead(); }
    }
    onDestroyed(d) { if (d.ac === this.player) this.playerCause = d.cause; super.onDestroyed(d); }
    finish(win, why) {
      if (this.ended) return;
      this.why = why;
      if (win) this.score += 500;
      this.end(win);
      RJ.ui.flash(win ? "MISSION COMPLETE" : "MISSION FAILED", why, 3, !win);
      if (RJ.companion) RJ.companion.say(win ? `Mission complete. ${why}` : `That's a fail. ${why} We'll get them next time.`, 3);
    }
    showResults() {
      const pl = this.player, st = pl.stats, ms = this.mission;
      const xp = Math.round(this.score * this.diff.xp);
      const unlocked = RJ.addXP(xp);
      const P = RJ.progress;
      P.stats.kills += this.kills; if (this.win) P.stats.wins++; else P.stats.losses++;
      P.missions = P.missions || {};
      const rec = P.missions[ms.id] || {};
      const stars = this.stars();
      if (this.win) { rec.won = true; rec.bestDiff = Math.max(rec.bestDiff || 0, ["rookie", "veteran", "ace"].indexOf(this.diff.id) + 1); }
      rec.stars = Math.max(rec.stars || 0, stars);
      rec.best = Math.max(rec.best || 0, this.score); rec.tries = (rec.tries || 0) + 1;
      P.missions[ms.id] = rec;
      RJ.saveProgress();
      RJ.ui.showResults({
        eyebrow: `${ms.name} · ${this.diff.name} · ${pl.spec.short}`, title: this.win ? "MISSION COMPLETE" : "MISSION FAILED", win: this.win,
        sub: this.why || "",
        stats: [["Rating", "★".repeat(stars) + "☆".repeat(3 - stars)], ["Score", RJ.fmtInt(this.score)], ["Kills", this.kills], ["Time", RJ.fmtTime(this.t)], ["Missiles hit", `${st.mslHits}/${st.msl}`],
          ["Damage dealt", RJ.fmtInt(st.dmgDealt)], ["Damage taken", RJ.fmtInt(st.dmgTaken)]].concat(this.plan.objPos && ["castle", "carrier", "nightraid"].includes(this.mission.id) ? [["Objective integrity", `${this.objHp}%`]] : []),
        xp, unlocked
      });
    }
    hudExtras() { const m = this.plan && this.plan.marker && this.plan.marker(); return m ? { ring: { pos: m } } : {}; }
    status() { return this.plan && this.plan.status ? this.plan.status() : ""; }
    objective() {
      const pl = this.player;
      if (!pl.alive) return "";
      const w = this.wingmen().length;
      return this.plan.objective() + (w ? ` · Wingman: ${this.wingOrder || "cover"}` : "");
    }
  }
  M.Mission = Mission;
})(window.RJ);
