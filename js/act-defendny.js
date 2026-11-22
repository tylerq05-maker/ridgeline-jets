/* Jet City — story mission "Defend New York".
 * A bomber formation with fighter escort is inbound from the Atlantic, through the Lower Bay and the Narrows,
 * for Manhattan. You scramble with your wingman from over the Battery, intercept over the harbour and stop every
 * heavy before it reaches the Statue of Liberty. A second, low and fast group comes in out of the southeast.
 * Built on the dogfight Mission framework (missions.js): this file registers the mission in M.MISSIONS (the
 * Dogfight menu's mission list), adds its plan_defendny() layout, radio chatter (companion.say with a radio
 * speaker, same channel as the Area 51 tower calls) and a medal on the results screen. */
(function (RJ) {
  "use strict";
  const M = RJ.modes;
  if (!M || !M.Mission || !M.MISSIONS) return;
  const V3 = RJ.V3, ID = "defendny", MP = M.Mission.prototype;
  const dirFromYaw = (yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const yawFromDir = (d) => Math.atan2(-d.x, -d.z);
  const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const LIBERTY = [40.6892, -74.0445];
  const BREACH = 1400; // a bomber this close to the Statue (horizontally) is over the city: mission failed
  const ESCORT = { rookie: ["f4", "f16"], veteran: ["su57", "f15c", "f16", "fa18e"], ace: ["su57", "su57", "f15ex", "f22"] };
  const HEAVY_CALL = ["Bear 1", "Bear 2", "Bear 3", "Bear 4"], LANCER_CALL = ["Hammer 1", "Hammer 2", "Hammer 3"], ESC_CALL = ["Flanker", "Krait", "Volk", "Sokol", "Berkut", "Grom"];

  M.MISSIONS.push({ id: ID, name: "Defend New York", obj: "Liberty",
    desc: "Bombers with fighter escort are inbound from the Atlantic. Scramble with your wingman and stop every one before it reaches the Statue of Liberty." });

  /** World position of a lat/lon in the New York zone (Manhattan is built at 1:1). */
  const ll = (lat, lon, y) => { const [x, z] = RJ.world.gen.nyc.toWorld(lat, lon); return V3(x, y || 0, z); };

  /* ---------------- radio: a timed queue so the calls don't trample each other ---------------- */
  function radio(ms, who, text, male, pri) {
    const q = ms.radioQ || (ms.radioQ = []);
    if (pri >= 3) q.unshift({ who, text, male, pri }); else q.push({ who, text, male, pri: pri || 2 });
    if (q.length > 6) q.splice(1, q.length - 6); // never fall far behind the action
  }
  function radioTick(ms) {
    const q = ms.radioQ;
    if (!q || !q.length || ms.t < (ms.radioNext || 0)) return;
    const l = q.shift();
    if (RJ.companion) RJ.companion.say(l.text, l.pri, { speaker: l.who, male: l.male });
    else RJ.ui.feed(`${l.who}: ${l.text}`, "b");
    ms.radioNext = ms.t + 1.4 + l.text.length * 0.062;
  }
  const once = (ms, key) => { ms.saidD = ms.saidD || {}; if (ms.saidD[key]) return false; ms.saidD[key] = true; return true; };

  MP.plan_defendny = function () {
    if (RJ.nyc && RJ.nyc.ensure) RJ.nyc.ensure();
    const diff = this.diff.id;
    const lib = ll(LIBERTY[0], LIBERTY[1], 0); lib.y = Math.max(RJ.world.ground(lib.x, lib.z), 0) + 90;
    const manhattan = ll(40.7075, -74.0120, 0); // the Battery and the Financial District beyond
    const narrows = ll(40.6066, -74.0447, 0);
    // scramble point: over the Upper Bay off the Battery, nose toward the Narrows and the Atlantic
    const pPos = ll(40.6985, -74.0225, 0);
    pPos.y = Math.max(700, M.highestAround(pPos.x, pPos.z, 1500, 3) + 450);
    const pYaw = yawFromDir(narrows.clone().sub(pPos).setY(0).normalize());
    // two raids: a heavy formation up the Lower Bay, then low, fast Lancers out of the southeast past Coney Island
    const nHeavy = diff === "rookie" ? 2 : 3, nLancer = diff === "rookie" ? 1 : 2;
    const nEsc = diff === "rookie" ? 1 : diff === "veteran" ? 2 : 3;
    const raids = [
      { name: "BEAR", from: [40.5440, -74.0180], via: [[40.6020, -74.0400]], alt: 1700, speed: diff === "ace" ? 165 : 150, ids: Array(nHeavy).fill("b52").map((id, i) => (diff === "ace" && i === 2 ? "b1b" : id)),
        calls: HEAVY_CALL, nEsc, hp: 1.6, t: 0 },
      { name: "HAMMER", from: [40.5620, -73.9320], via: [[40.5960, -73.9930], [40.6420, -74.0300]], alt: 480, speed: diff === "rookie" ? 190 : 215, ids: Array(nLancer).fill("b1b"),
        calls: LANCER_CALL, nEsc: Math.max(1, nEsc - 1), hp: 1.35, t: 62 }
    ];
    const spawnRaid = (R) => {
      this.wave++;
      const start = ll(R.from[0], R.from[1], 0);
      start.y = Math.max(R.alt, M.highestAround(start.x, start.z, 2500, 3) + 500);
      const path = R.via.map(([a, b]) => ll(a, b, 0)).concat([lib.clone(), manhattan.clone()]);
      path.forEach((p, i) => { p.y = i >= path.length - 2 ? Math.max(R.alt * 0.6, 380) : R.alt; });
      const fwd = path[0].clone().sub(start).setY(0).normalize(), side = V3(-fwd.z, 0, fwd.x), yaw = yawFromDir(fwd);
      const bombers = [];
      R.ids.forEach((id, i) => {
        // a vic: lead at the point, the others stepped back and out, each on its own parallel track
        const lat = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 300, back = Math.ceil(i / 2) * 260;
        const off = side.clone().multiplyScalar(lat).addScaledVector(fwd, -back);
        const route = path.map((p, k) => (k === path.length - 1 ? p.clone() : p.clone().add(off)));
        const p = start.clone().add(off).add(V3(0, i * 25, 0));
        const e = this.spawnAI(id, "red", p, yaw, R.calls[i % R.calls.length], diff === "ace" ? "veteran" : "rookie", { role: "strike", route });
        e.pilot.cruise = R.speed; e.speed = R.speed; e.vel.copy(fwd).multiplyScalar(R.speed);
        e.hp = e.maxHp = e.maxHp * R.hp;
        e.bomber = true; e.libIdx = route.length - 2; e.raid = R.name;
        e.callsign = e.callsign.replace("(", "(bomber · ");
        bombers.push(e); this.dny.bombers.push(e);
      });
      for (let i = 0; i < R.nEsc; i++) {
        const lead = bombers[i % bombers.length];
        const p = start.clone().addScaledVector(fwd, -600).addScaledVector(side, (i % 2 ? -1 : 1) * (700 + i * 150)).add(V3(0, 350, 0));
        const e = this.spawnAI(RJ.pick(ESCORT[diff]), "red", p, yaw, ESC_CALL[(this.wave * 3 + i) % ESC_CALL.length], this.skill(),
          { role: "wingman", leader: lead, order: "cover" }); // close escort: they go for whoever threatens the bombers
        e.pilot.side = i % 2 ? -1 : 1; e.pilot.formK = 3.5;
        this.dny.escorts.push(e);
      }
      R.spawned = true;
      if (!this.player.target || !this.player.target.alive) { this.player.target = bombers[0]; this.player.lockT = 0; this.player.locked = false; }
      const nb = bombers.length;
      RJ.ui.flash(`${R.name} GROUP INBOUND`, `${nb} bomber${nb > 1 ? "s" : ""} · ${R.nEsc} escort${R.nEsc > 1 ? "s" : ""}`, 2.6, true);
      return bombers;
    };
    return {
      pPos, pYaw, wing: true, objPos: lib,
      brief: "Bombers inbound from the Atlantic. Stop them before the Statue of Liberty.",
      start: () => {
        this.dny = { bombers: [], escorts: [], raids, killsB: 0, closest: 1e9, lib, manhattan, breached: null };
        spawnRaid(raids[0]);
        radio(this, "HARBOR CONTROL", "Liberty One, Harbor Control. Scramble, scramble! Bomber formation inbound from the Atlantic, heading for Manhattan.", true, 2);
        radio(this, "GOOSE", "Liberty Two, on your wing. Let's go hunting.", true, 2);
        radio(this, "DARKSTAR", `Liberty, Darkstar. Bear group: ${nHeavy} heavies with ${nEsc} fighter escort${nEsc > 1 ? "s" : ""}, angels five, south over the Lower Bay. The bombers are your priority.`, false, 2);
        radio(this, "BEAR 1", "Bear flight, hold formation. The city is in sight.", true, 1);
      },
      tick: () => {
        const D = this.dny, pl = this.player;
        radioTick(this);
        // the second raid: on the clock, or a few seconds after the first heavies are all down
        const R2 = raids[1];
        if (!R2.spawned) {
          const firstDown = D.bombers.length && D.bombers.every((e) => !e.alive);
          if (firstDown && !D.r2at) D.r2at = this.t + 6;
          if (this.t >= R2.t || (D.r2at && this.t >= D.r2at)) {
            spawnRaid(R2);
            radio(this, "DARKSTAR", `New group! Hammer: ${nLancer > 1 ? "two Lancers" : "a Lancer"}, low and fast out of the southeast over Coney Island. Get on them!`, false, 3);
          }
        }
        // bombers: kills, distance to the Statue, the breach
        let near = null, nd = 1e9;
        for (const e of D.bombers) {
          if (!e.alive) {
            if (!e.dnyCounted) {
              e.dnyCounted = true; D.killsB++; this.score += 250;
              const mine = e.lastHitBy && e.lastHitBy.isPlayer;
              RJ.ui.flash("BOMBER DOWN", `${e.callsign.split(" (")[0]} · +250`, 1.6);
              const left = D.bombers.filter((b) => b.alive).length + (R2.spawned ? 0 : R2.ids.length);
              radio(this, mine ? "GOOSE" : "HARBOR CONTROL", left ? RJ.pick(mine ? ["Splash one heavy! Good kill, Liberty.", "Bomber's going down! Nice shooting, lead.", "Scratch one bomber!"] : ["Heavy is down. Keep at them!", "Splash one bomber. Good work, Liberty Two."]) + (left > 1 ? ` ${left} left.` : left === 1 ? " One left!" : "") : "That's the last heavy!", true, 2);
            }
            continue;
          }
          const d = hdist(e.pos, lib);
          D.closest = Math.min(D.closest, d);
          if (d < nd) { nd = d; near = e; }
          if (d < BREACH || e.pilot.wp > e.libIdx || e.pilot.done) { D.breached = e; break; }
        }
        D.near = near; D.nearD = nd;
        if (D.breached) {
          const e = D.breached;
          // bombs away over the harbour and the Battery
          for (let k = 0; k < 6; k++) {
            const t = k / 5, p = lib.clone().lerp(D.manhattan, 0.3 + t * 0.6).add(V3(RJ.rand(-220, 220), 0, RJ.rand(-220, 220)));
            p.y = Math.max(RJ.world.ground(p.x, p.z), 0) + 6;
            setTimeout(() => { if (RJ.game.mode === this) { RJ.fx.explosion(p, 2.6); RJ.audio.explosion && RJ.audio.explosion(Math.max(200, pl.pos.distanceTo(p)), 0.6); } }, 250 + k * 260);
          }
          radio(this, "HARBOR CONTROL", "Bomber over the harbour! Bombs away, bombs away! The city's been hit!", true, 3);
          radioTick(this);
          return this.finish(false, `${e.callsign.split(" (")[0]} reached the Statue of Liberty and bombed the city.`);
        }
        // proximity warnings
        if (near) {
          if (nd < 8000 && once(this, "w8")) radio(this, "HARBOR CONTROL", "Bombers eight kilometres from Liberty Island! Stop them now!", true, 3);
          if (nd < 4500 && once(this, "w4")) radio(this, "HARBOR CONTROL", "They're through the Narrows! Four kilometres to the Statue!", true, 3);
          if (pl.alive && pl.pos.distanceTo(near.pos) < 9000 && once(this, "tally")) radio(this, "GOOSE", "Tally the heavies, twelve o'clock low. I'll take the escorts.", true, 2);
        }
        if (D.escorts.some((e) => !e.alive) && once(this, "escort")) radio(this, "DARKSTAR", "Escort fighter destroyed. The bombers are exposed.", false, 1);
        if (pl.alive && pl.hp < pl.maxHp * 0.35 && once(this, "hurt")) radio(this, "GOOSE", "Lead, you're trailing smoke! I've got your six.", true, 2);
        // victory: every heavy from both raids is down
        if (R2.spawned && D.bombers.every((e) => !e.alive)) {
          radio(this, "HARBOR CONTROL", "All bombers down! New York owes you one, Liberty. Return to base.", true, 3);
          radioTick(this);
          return this.finish(true, `All ${D.bombers.length} bombers destroyed. Closest approach: ${(D.closest / 1000).toFixed(1)} km from the Statue.`);
        }
      },
      status: () => {
        const D = this.dny, left = D.bombers.filter((e) => e.alive).length;
        return `<b>DEFEND NEW YORK</b>${left} bomber${left === 1 ? "" : "s"} inbound · ${D.near ? (D.nearD / 1000).toFixed(1) + " km to Liberty" : "sky clear"} · raid ${this.wave}/2`;
      },
      objective: () => {
        const k = RJ.settings.keys, D = this.dny;
        const urgent = D.near && D.nearD < 6000 ? ` ${D.near.callsign.split(" (")[0]} is ${(D.nearD / 1000).toFixed(1)} km out!` : "";
        return `Destroy the bombers before they reach the Statue of Liberty.${urgent} ${RJ.keyLabel(k.target)} cycles targets · ${RJ.keyLabel(k.wingAttack)} wingman attacks your target.`;
      },
      // the ring marks the bomber closest to the Statue: the one that has to die first
      marker: () => (this.dny && this.dny.near && this.dny.near.alive ? this.dny.near.pos : this.plan ? this.plan.objPos : null)
    };
  };

  /* ---------------- rating, medal ---------------- */
  const baseStars = MP.stars;
  MP.stars = function () {
    if (this.mission.id !== ID) return baseStars.call(this);
    if (!this.win) return 0;
    const D = this.dny || {};
    // bonus: kept every bomber out over the Lower Bay (none came within 6 km of the Statue)
    return 1 + (this.diff.id !== "rookie" ? 1 : 0) + (D.closest > 6000 ? 1 : 0);
  };
  const MEDAL = ["None", "Bronze Star", "Silver Star", "Gold Star"];
  const baseResults = MP.showResults;
  MP.showResults = function () {
    if (this.mission.id !== ID) return baseResults.call(this);
    const UI = RJ.ui, orig = UI.showResults, D = this.dny || { bombers: [], killsB: 0, closest: 1e9 };
    const stars = this.stars();
    UI.showResults = (o) => {
      UI.showResults = orig;
      o.title = this.win ? "NEW YORK IS SAFE" : "NEW YORK HIT";
      o.stats.splice(1, 0, ["Medal", MEDAL[stars]], ["Bombers destroyed", `${D.killsB}/${D.bombers.length + (D.raids && !D.raids[1].spawned ? D.raids[1].ids.length : 0)}`],
        ["Closest to Liberty", D.closest < 1e8 ? `${(D.closest / 1000).toFixed(1)} km` : "-"]);
      return orig.call(UI, o);
    };
    try { return baseResults.call(this); } finally { UI.showResults = orig; }
  };
})(window.RJ);
