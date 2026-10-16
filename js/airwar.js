/* Jet City — 50 v 50 Air War: two air forces of fifty jets each, in flights of four, close on each other in
 * formation across a 20 km front, merge in three combat zones and fight it out until one side is gone.
 * Every jet is a real aircraft with its own AI pilot, weapons, missiles and flares (the same systems as every
 * other dogfight); the crowd optimisations in combat.js (silhouette LOD, half-rate far simulation, per-frame
 * visuals) keep 100 of them affordable. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, M = RJ.modes;
  const FACTIONS = {
    coalition: { name: "Coalition", livery: "wingman", pool: ["f16", "f16", "fa18e", "fa18e", "f15c", "f15c", "f14", "f35a", "f22", "f15ex"],
      calls: ["Viper", "Hornet", "Eagle", "Tomcat", "Lightning", "Raptor", "Falcon", "Saber", "Dagger", "Lancer", "Mustang", "Spartan", "Reaper"] },
    federation: { name: "Federation", livery: "aggressor", pool: ["su57", "su57", "su57", "f15c", "f16", "f4", "f15ex", "yf23", "f14"],
      calls: ["Bear", "Fulcrum", "Flanker", "Wolf", "Krait", "Volk", "Sokol", "Berkut", "Grom", "Tigr", "Kobra", "Orel", "Zmei"] }
  };
  M.MATCHES.push({ id: "war", name: "50 v 50 Air War", desc: "100 jets. Two air forces in flights of four, three combat zones, one sky.", blue: 50, red: 50 });
  M.SIDES = [{ id: "coalition", name: "Coalition (blue)" }, { id: "federation", name: "Federation (red)" }];
  const SK = { rookie: 0.2, veteran: 0.5, ace: 0.85 };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clock = (pl, p) => {
    const rel = p.clone().sub(pl.pos), f = pl.fwd.clone().setY(0).normalize();
    const ang = Math.atan2(rel.x * -f.z + rel.z * f.x, rel.x * f.x + rel.z * f.z); // clockwise from the nose
    let h = Math.round(ang / (Math.PI / 6)); h = ((h % 12) + 12) % 12; return h === 0 ? 12 : h;
  };

  class AirWar extends M.Dogfight {
    constructor(o) { super(o); this.war = true; }
    /** A pilot somewhere between rookie and ace, with their own aggression. */
    skill(avg) {
      const D = RJ.combat.DIFF, k = RJ.clamp(avg + RJ.rand(-0.25, 0.25), 0, 1);
      const L = (a, b, t) => { const o = {}; for (const key in a) o[key] = RJ.lerp(a[key], b[key], t); return o; };
      const s = k < 0.5 ? L(D.rookie, D.veteran, k * 2) : L(D.veteran, D.ace, (k - 0.5) * 2);
      const aggr = RJ.rand(0.7, 1.45);
      s.mslRate = Math.min(1, s.mslRate * aggr * 1.3); s.minAgl = Math.max(s.minAgl, 320); // crowded skies: keep a safer floor s.evade = Math.min(1, s.evade * RJ.rand(0.85, 1.1)); s.react *= RJ.rand(0.85, 1.2);
      return s;
    }
    spawnAI(id, team, pos, yaw, callsign, skill, opts) {
      const ac = new RJ.Aircraft(id, { team, livery: this.F[team].livery, callsign: `${callsign} (${RJ.AIRCRAFT[id].short})`, assist: true });
      ac.place(pos, yaw, M.cruiseSpeed(ac.spec) * 1.15);
      ac.pilot = new RJ.combat.Pilot(ac, skill, opts);
      RJ.combat.add(ac);
      return ac;
    }
    async setup(progress) {
      const o = this.o, arena = M.ARENAS.find((a) => a.id === o.arena) || M.ARENAS[0];
      this.match = M.MATCHES.find((m) => m.id === "war");
      this.diff = M.DIFFS.find((d) => d.id === o.diff) || M.DIFFS[1];
      const mine = o.side === "federation" ? "federation" : "coalition";
      this.F = { blue: FACTIONS[mine], red: FACTIONS[mine === "coalition" ? "federation" : "coalition"] };
      RJ.world.setEnvironment({ time: o.time, weather: arena.weather });
      const reg = RJ.world.findRegion(arena.region);
      const ax = (this.axis = V3(-Math.sin(reg.yaw), 0, -Math.cos(reg.yaw)));
      const lat = (this.lat = V3(-ax.z, 0, ax.x));
      let base = M.highestAround(reg.x, reg.z, 9000, 6) + 1100;
      if (arena.id === "clouds") base = Math.max(base, RJ.world.cloudTop + 700);
      if (arena.id === "ocean") base = Math.max(base, 1400);
      this.alt = base;
      this.center = V3(reg.x, base, reg.z);
      if (RJ.world.airbase) RJ.world.setAirbase(null);
      await RJ.world.prepare(this.center, progress);
      RJ.game.allowBombs = false;
      RJ.game.contrailAlt = Math.min(7800, base - 300); // cold, humid day: every layer of the battle pulls contrails
      this.infMsl = true;
      this.score = 0; this.kills = 0; this.deaths = 0; this.t = 0; this.wave = 0; this.ended = false; this.spectate = null; this.endT = null;
      this.tick = 0; this.chatT = 6; this.lastChat = -9; this.respawnT = 0; this.merged = false; this.down = { blue: 0, red: 0 }; this.marks = {};
      // three combat zones across a ~13 km front, at different heights
      this.zones = [-4500, 0, 4500].map((l, i) => this.center.clone().addScaledVector(lat, l).addScaledVector(ax, RJ.rand(-1200, 1200)).add(V3(0, [600, 0, 1300][i], 0)));
      const layers = [0, 1300, Math.max(2800, 8600 - base)]; // the top layer flies high enough to pull contrails
      this.flights = [];
      for (const team of ["blue", "red"]) {
        const s = team === "blue" ? -1 : 1, F = this.F[team], avg = team === "blue" ? 0.5 : SK[this.diff.id];
        const yaw = Math.atan2(s * ax.x, s * ax.z); // facing the other side
        const fwd = ax.clone().multiplyScalar(-s);
        const sizes = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2];
        for (let f = 0; f < sizes.length; f++) {
          const zone = f === 0 ? 1 : f % 3, layer = Math.floor(f / 3) % 3, second = f >= 9; // the last flights are the second wave
          const zp = this.zones[zone];
          const lead = this.center.clone().addScaledVector(ax, s * (8000 + (second ? 2600 : 0) + RJ.rand(0, 700))).addScaledVector(lat, lat.dot(zp.clone().sub(this.center)) + RJ.rand(-1100, 1100));
          lead.y = Math.max(base + layers[layer] + RJ.rand(-150, 150), M.highestAround(lead.x, lead.z, 1500, 3) + 500);
          const isPl = team === "blue" && f === 0;
          const fl = { team, zone, members: [], engaged: false, order: Math.random() < 0.6 ? "attack" : "cover", base: RJ.clamp(avg + RJ.rand(-0.15, 0.15), 0, 1), call: F.calls[f % F.calls.length] };
          let L;
          if (isPl) {
            lead.y = Math.max(base + 300, lead.y);
            L = M.makePlayer(o.aircraft, lead, yaw, M.cruiseSpeed(RJ.AIRCRAFT[o.aircraft]) * 1.15);
            L.throttle = 0.85; this.player = L;
          } else {
            const route = [V3(zp.x, lead.y, zp.z), V3(zp.x, lead.y, zp.z).addScaledVector(fwd, 9000)];
            L = this.spawnAI(pick(F.pool), team, lead, yaw, `${fl.call} 1`, this.skill(fl.base), { role: "route", route, objective: zp });
          }
          fl.lead = L; fl.members.push(L);
          for (let k = 1; k < sizes[f]; k++) {
            const sd = k % 2 ? -1 : 1, kk = k === 3 ? 2 : 1;
            const right = V3(-fwd.z, 0, fwd.x); // the same side formUp() puts the slot on, so nobody crosses over
            const p = lead.clone().addScaledVector(fwd, -60 * kk - 20 * k).addScaledVector(right, sd * 55 * kk).add(V3(0, 8 * k, 0));
            const opts = isPl ? { role: "wingman", leader: L, order: "cover", side: sd } : { role: "wingman", leader: L, order: "form", side: sd, objective: zp };
            const w = this.spawnAI(pick(F.pool), team, p, yaw, `${fl.call} ${k + 1}`, this.skill(fl.base), opts);
            w.pilot.formK = kk;
            fl.members.push(w);
          }
          if (isPl) fl.engaged = true;
          this.flights.push(fl);
        }
      }
      this.wingOrder = "cover";
      RJ.progress.stats.matches++; RJ.saveProgress();
      RJ.ui.flash("50 v 50 AIR WAR", `${this.F.blue.name} vs ${this.F.red.name} · ${arena.name}`, 3.2);
      setTimeout(() => { if (RJ.game.mode === this && RJ.companion) RJ.companion.say(`Fifty ${this.F.red.name} jets inbound on the nose. Stay with your flight until the merge.`, 2); }, 2500);
    }
    /** Twice a second: counts, merges, retargeting, radio, end of battle. Cheap enough for 100 jets. */
    think() {
      const A = RJ.combat.aircraft, pl = this.player;
      let nb = 0, nr = 0;
      for (const a of A) { a._tby = 0; if (a.alive) { if (a.team === "blue") nb++; else nr++; } }
      this.nb = nb; this.nr = nr;
      for (const a of A) if (a.alive && a.target && a.target.alive) a.target._tby++;
      // flights break formation and engage at the merge (or after a minute regardless)
      for (const fl of this.flights) {
        if (fl.engaged) continue;
        const L = fl.lead.alive ? fl.lead : fl.members.find((m) => m.alive);
        if (!L) { fl.engaged = true; continue; }
        let near = 1e9;
        for (const a of A) if (a.alive && a.team !== fl.team) near = Math.min(near, a.pos.distanceToSquared(L.pos));
        if (Math.sqrt(near) < 7000 || this.t > 60) this.engage(fl);
      }
      // retarget: fight back against whoever is shooting at me; drop targets that ran away or are swamped
      for (const a of A) {
        if (!a.alive || !a.pilot || a.isPlayer) continue;
        const P = a.pilot;
        if (P.role === "route" || (P.role === "wingman" && P.order === "form" && P.leader && P.leader.alive)) continue;
        const sh = a.lastHitBy;
        if (sh && sh.alive && sh.team !== a.team && a.time - a.lastHitAt < 4 && a.target !== sh && sh.pos.distanceTo(a.pos) < 2500 && Math.random() < 0.6) { a.target = sh; a.lockT = 0; a.locked = false; continue; }
        const t = a.target;
        if (t && t.alive) {
          const d = t.pos.distanceTo(a.pos);
          if (d > 6500 || (t._tby > 3 && d > 1200 && Math.random() < 0.3)) { t._tby--; a.target = null; RJ.combat.autoTarget(a); if (a.target) a.target._tby++; }
        }
      }
      // battle milestones on the radio
      for (const [team, n] of [["blue", nb], ["red", nr]]) {
        for (const m of [40, 30, 20, 10, 5]) {
          const key = team + m;
          if (n <= m && !this.marks[key]) {
            this.marks[key] = true;
            const nm = this.F[team].name;
            if (RJ.companion) RJ.companion.say(team === "blue" ? `We're down to ${n}. Stay in the fight.` : `${nm} down to ${n} jets. Keep pressing.`, 2);
            RJ.ui.flash(`${nm.toUpperCase()}: ${n} LEFT`, null, 1.4, team === "blue");
          }
        }
      }
      this.chatter();
      if (nr === 0) return this.end(true);
      if (nb === 0) return this.end(false);
    }
    engage(fl) {
      fl.engaged = true;
      for (const a of fl.members) {
        if (!a.alive || !a.pilot) continue;
        const P = a.pilot;
        if (a === fl.lead) { P.role = "fighter"; P.route = null; }
        else { P.order = fl.order; if (!fl.lead.alive) P.role = "fighter"; }
      }
      if (!this.merged) {
        this.merged = true;
        RJ.ui.flash("MERGE", "The skies erupt. Weapons free.", 2);
        if (RJ.companion) RJ.companion.say("Merge, merge! Weapons free!", 3);
      }
    }
    say(text, cls) {
      if (this.t - this.lastChat < 1.5) return false;
      this.lastChat = this.t;
      RJ.ui.feed(text, cls || "b");
      if (RJ.audio.beep) RJ.audio.beep(1350, 0.035, 0.025);
      return true;
    }
    /** Ambient radio: bandit calls, check-six warnings, wingmen talking. */
    chatter() {
      const pl = this.player;
      this.chatT -= 0.5;
      if (this.chatT > 0 || !pl.alive) return;
      this.chatT = RJ.rand(5, 10);
      const A = RJ.combat.aircraft;
      const friends = A.filter((a) => a.alive && a.team === pl.team && a !== pl && a.pos.distanceTo(pl.pos) < 8000);
      const who = friends.length ? pick(friends).callsign.split(" (")[0] : "Overlord";
      let six = null, near = null, nd = 1e9;
      for (const e of A) {
        if (!e.alive || e.team === pl.team) continue;
        const rel = pl.pos.clone().sub(e.pos), d = rel.length();
        if (d < 1600 && rel.dot(e.fwd) / d > 0.9 && e.target === pl) six = e;
        if (d < nd) { nd = d; near = e; }
      }
      if (six) { this.say(`${who}: Check six! Bandit on your tail!`, "r"); return; }
      if (near && nd > 2500 && nd < 12000) {
        const hi = near.pos.y - pl.pos.y > 300 ? " high" : near.pos.y - pl.pos.y < -300 ? " low" : "";
        this.say(`${who}: Bandits, ${clock(pl, near.pos)} o'clock${hi}, ${(nd / 1852).toFixed(0)} miles.`);
        return;
      }
      this.say(`${who}: ${pick(["Engaging the lead bandit.", "Tally two, pressing.", "I'm defensive, need help!", "Coming off left, cover me.", "Winchester guns, staying in for support.", "Good kill, good kill!", "Watch the high group!", "Extending, then back in."])}`);
    }
    onDestroyed(d) {
      const ac = d.ac, by = d.by, pl = this.player;
      this.down[ac.team] = (this.down[ac.team] || 0) + 1;
      const how = d.cause === "missile" ? "missile" : d.cause === "gun" ? "guns" : d.cause === "collision" ? "collision" : d.cause === "terrain" || d.cause === "water" ? "crashed" : "";
      const close = ac.pos.distanceTo(pl.pos) < 9000;
      if (close || ac.isPlayer || (by && by.isPlayer)) RJ.ui.feed(by && by !== ac ? `${by.callsign} ▸ ${ac.callsign}${how ? " · " + how : ""}` : `${ac.callsign} ${how || "down"}`, ac.team === "red" ? "b" : "r");
      if (by && by.isPlayer && ac.team !== by.team) {
        this.kills++; this.score += d.cause === "gun" ? 120 : 100; by.stats.kills++;
        RJ.ui.flash("SPLASH ONE", ac.spec.short, 1.2);
        if (Math.random() < 0.5) this.say(`${pick(["Good kill!", "Splash! Nice shooting.", "That's a kill, lead!"])}`);
      } else if (ac.team === "red" && ac.lastHitBy && ac.lastHitBy.isPlayer && (!by || !by.isPlayer)) this.score += 40;
      else if (close && !ac.isPlayer) {
        if (ac.team === pl.team) this.say(`${ac.callsign.split(" (")[0]}: ${pick(["I'm hit, I'm hit! Ejecting!", "Going down!", "Mayday, mayday!"])}`, "r");
        else if (by && by.team === pl.team) this.say(`${by.callsign.split(" (")[0]}: ${pick(["Splash one!", "Fox kill, scratch one bandit.", "Bandit down!"])}`);
      }
      if (ac.isPlayer) {
        this.deaths++; this.respawnT = 0;
        RJ.ui.flash(d.cause === "terrain" || d.cause === "water" ? "CRASHED" : "SHOT DOWN", "Taking over another jet in your side's fleet…", 2.5, true);
      }
    }
    /** Shot down: after a few seconds the player takes over a surviving friendly jet (the team count doesn't change). */
    takeOver() {
      const C = RJ.combat, old = this.player;
      const cand = C.aircraft.filter((a) => a.alive && a.team === old.team && !a.isPlayer && a.state === "flying" && a.agl > 300);
      if (!cand.length) return false;
      const A = C.aircraft;
      const score = (a) => { let n = 1e9; for (const e of A) if (e.alive && e.team !== a.team) n = Math.min(n, e.pos.distanceToSquared(a.pos)); return (n < 2500 * 2500 ? 1e9 : 0) + n; };
      cand.sort((a, b) => score(a) - score(b));
      const f = cand[0];
      const pos = f.pos.clone(), yaw = Math.atan2(-f.fwd.x, -f.fwd.z), spd = Math.max(f.speed, M.cruiseSpeed(RJ.AIRCRAFT[this.o.aircraft]));
      f.alive = false; f.state = "dead"; f.mesh.visible = false;
      A.splice(A.indexOf(f), 1); f.dispose();
      const np = M.makePlayer(this.o.aircraft, pos, yaw, spd);
      np.throttle = 0.9; np.stats = old.stats;
      for (const a of A) if (a.pilot && a.pilot.leader === old) a.pilot.leader = np;
      this.player = np; this.spectate = null;
      RJ.sim.reset(); RJ.cam.reset(np); if (RJ.lever && RJ.lever.reset) RJ.lever.reset(np);
      RJ.ui.flash("BACK IN THE FIGHT", `You took over ${f.callsign.split(" (")[0]}`, 2.2);
      return true;
    }
    update(dt) {
      if (this.ended) { this.endT += dt; if (this.endT > 3 && !this.shown) { this.shown = true; this.showResults(); } return; }
      this.t += dt;
      const pl = this.player;
      M.trackChallenges(pl, null);
      this.tick -= dt;
      if (this.tick <= 0) { this.tick = 0.5; this.think(); if (this.ended) return; }
      if (!pl.alive) {
        this.respawnT += dt;
        if (!this.spectate || !this.spectate.alive) this.spectate = RJ.combat.aircraft.find((a) => a.alive && a.team === pl.team) || null;
        if (this.respawnT > 5) this.takeOver();
      }
    }
    end(win) {
      if (this.ended) return;
      this.ended = true; this.endT = 0; this.win = win;
      RJ.ui.flash(win ? "VICTORY" : "DEFEAT", win ? `The ${this.F.red.name} air force is destroyed` : `The ${this.F.blue.name} air force is destroyed`, 3, !win);
    }
    status() {
      const b = this.nb == null ? 50 : this.nb, r = this.nr == null ? 50 : this.nr, down = (this.down.blue || 0) + (this.down.red || 0);
      return `<b>50 v 50 AIR WAR</b>${this.F.blue.name} ${b} · ${this.F.red.name} ${r} · ${down} down · ${RJ.fmtInt(this.score)} pts`;
    }
    objective() {
      const pl = this.player;
      if (!pl.alive) return `Shot down. Taking over another ${this.F.blue.name} jet in ${Math.max(0, Math.ceil(5 - this.respawnT))} s`;
      if (!this.merged) return `Hold formation. ${this.F.red.name} fleet closing head-on. Weapons free at the merge.`;
      return super.objective();
    }
  }
  AirWar.prototype.dispose = function () { RJ.game.contrailAlt = null; };
  M.AirWar = AirWar;
})(window.RJ);
