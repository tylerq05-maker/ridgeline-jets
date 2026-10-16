/* Ridgeline Jets — multiplayer (up to 4 pilots).
 * Lobby: a short code names a live room. Every participant publishes one presence object:
 *   nm/ac/tm/rdy/jt  identity, aircraft, team, ready flag, join time (host = earliest join)
 *   cfg              the host's match settings and phase (lobby / play / res)
 *   mid/s/ev/k/d     the match they're in, their aircraft state (~20 Hz), a rolling event log, score
 *   b                bots the host simulates
 * The world is generated identically on every machine, so only gameplay state travels.
 * Combat is shooter-authoritative: your game decides your hits and tells the victim's game, which
 * applies the damage and announces the kill. Remote jets are drawn from interpolated snapshots. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, MAX = 4, SEND_HZ = 20, DELAY = 0.11;
  const PRES_MAX = 3700; // bytes of JSON; the room's hard limit is 4096
  const enc = new TextEncoder(), presBytes = (o) => enc.encode(JSON.stringify(o)).length;
  const WORDS = ["SQUAD", "VIPER", "EAGLE", "RAVEN", "GHOST", "COBRA", "TALON", "HAWK", "STORM", "BLADE"];
  const BOT_CALLS = ["Bandit", "Havoc", "Razor", "Mako"];
  const dirFromYaw = (yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const yawFromDir = (d) => Math.atan2(-d.x, -d.z);
  const now = () => performance.now() / 1000;

  const MP = (RJ.mp = {
    room: null, code: null, jt: 0, me: null, myId: null, cfg: null, lastCfg: null, peers: [], status: "", listeners: [],
    MODES: [{ id: "free", name: "Free flight", desc: "Fly together, weapons off. Race, explore, fly formation." }, { id: "ffa", name: "Free-for-all", desc: "Every pilot for themselves." }, { id: "team", name: "Teams", desc: "Red vs Blue." }],
    LOCS: [
      { id: "home", name: "Home airbase" }, { id: "castle", name: "Highkeep Castle" }, { id: "bridge", name: "Canyon Bridge" },
      { id: "carrier", name: "Coastal carrier" }, { id: "everest", name: "Mount Everest" }
    ]
  });
  const defaultCfg = () => ({ mode: "free", loc: "home", wx: "scattered", tod: "golden", kl: 10, tl: 10, ff: false, rd: 5, bots: false, phase: "lobby", mid: null, el: 0, res: null });

  /* ======================= LOBBY ======================= */
  MP.changed = function () { MP.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };
  MP.callsign = () => (RJ.settings.callsign || "").trim() || "Pilot";
  MP.inLobby = () => !!MP.room;
  MP.isHost = () => !!MP.room && MP.hostId() === MP.myId;
  MP.genCode = () => `${RJ.pick(WORDS)}-${1 + Math.floor(Math.random() * 99)}`;
  const roomName = (code) => "rj-" + code.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

  /** Everyone in the lobby, sorted by join time (the first is the host). */
  MP.members = function () {
    if (!MP.room) return [];
    return MP.room.peers().filter((p) => p.presence && p.presence.v === 1)
      .slice().sort((a, b) => (a.presence.jt - b.presence.jt) || (a.peer < b.peer ? -1 : 1)).slice(0, MAX);
  };
  MP.hostId = function () { const m = MP.members(); return m.length ? m[0].peer : MP.myId; };
  /** The authoritative settings: the host's, or the last ones seen if the host just left. */
  MP.config = function () {
    const host = MP.members()[0];
    const c = host && host.presence.cfg && (host.peer !== MP.myId || MP.wasHost) ? host.presence.cfg : null;
    if (c) MP.lastCfg = c;
    return MP.lastCfg || defaultCfg();
  };

  MP.open = async function (code, hosting, direct) {
    const ok = direct || await RJ.net.init();
    if (!ok) {
      const why = RJ.net.reason === "not-on-claude"
        ? "This copy isn't running on claude.ai. Open the game from its claude.ai link."
        : "claude.ai won't connect this window for live games.";
      throw new Error(why + " (" + (typeof RTCPeerConnection === "function" ? "Use DIRECT CONNECT below instead" : "Solo modes still work") + ") [" + (RJ.net.reason || "?") + "]");
    }
    if (MP.room) await MP.leave();
    MP.code = code.toUpperCase();
    if (direct) MP.room = direct;
    else {
      try { MP.room = await RJ.net.room.join(roomName(code), hosting); }
      catch (e) {
        MP.room = null;
        if (RJ.net.peerjs) throw e; // already a friendly message (and e.code for "code taken")
        throw new Error("Couldn't open the lobby connection [" + ((e && (e.code || e.message)) || "error") + "]. Try again, or reload the page.");
      }
    }
    MP.direct = !!MP.room.direct; // hub games (direct connect, website codes): the host's browser carries everyone
    MP.myId = null;
    // a direct host is the hub, so it must always sort first (computer clocks can disagree)
    MP.jt = MP.direct && hosting ? 1 : Date.now() + (hosting ? 0 : 1);
    MP.lastCfg = hosting ? defaultCfg() : null;
    MP.joining = !hosting; MP.wasHost = !!hosting;
    MP.me = { v: 1, jt: MP.jt, nm: MP.callsign().slice(0, 14), ac: RJ.settings.aircraft, tm: null, rdy: !!hosting, mid: null, k: 0, d: 0 };
    if (hosting) MP.me.cfg = MP.lastCfg;
    await MP.room.presence(MP.me);
    MP.unsub = MP.room.onPeers(() => { MP.onPeers(); });
    // learn our own peer label
    for (let i = 0; i < 30 && !MP.myId; i++) { const me = MP.room.peers().find((p) => p.sameTab); if (me) MP.myId = me.peer; else await new Promise((r) => setTimeout(r, 100)); }
    if (!hosting) {
      // wait for the host to show up, then make sure there's a seat
      let host = null;
      for (let i = 0; i < 40 && !host; i++) { host = MP.room.peers().find((p) => !p.sameTab && p.presence && p.presence.cfg); if (!host) await new Promise((r) => setTimeout(r, 100)); }
      if (!host) { MP.joining = false; await MP.leave(); throw new Error(MP.direct ? "Connected, but the host's lobby didn't answer (it may be full). Ask the host to stay on the lobby screen and try again." : `No game found with code ${MP.code}. Check the code, and that the host is in the lobby.`); }
      await new Promise((r) => setTimeout(r, 600));
      const idx = MP.members().findIndex((p) => p.peer === MP.myId);
      if (idx < 0 || idx >= MAX) { MP.joining = false; await MP.leave(); throw new Error("That lobby is full (4 pilots max)."); }
      // join the team with fewer players
      const cfg = MP.config();
      if (cfg.mode === "team") MP.set({ tm: MP.smallerTeam() });
      MP.joining = false;
    } else MP.set({ tm: "blue" });
    if (MP.direct && !hosting) {
      const direct = MP.room;
      // everything runs through the host's computer: if that link drops, the game is over for us
      MP.unconn = direct.onConnection((c) => {
        if (c || MP.room !== direct) return;
        RJ.ui.toast("Lost the connection to the host.", 3500);
        const inGame = RJ.game && RJ.game.config && RJ.game.config.kind === "mp";
        MP.leave().then(() => { if (inGame) RJ.quitToMenu(); });
      });
    }
    MP.onPeers();
    MP.changed();
    return MP.code;
  };
  MP.leave = async function () {
    if (MP.unsub) { MP.unsub(); MP.unsub = null; }
    if (MP.unconn) { MP.unconn(); MP.unconn = null; }
    const r = MP.room; MP.room = null; MP.code = null; MP.direct = false; MP.lastCfg = null; MP.wasHost = false; MP.joining = false; MP.sitOut = null;
    if (r) try { await r.leave(); } catch (e) { /* already gone */ }
    MP.changed();
  };
  MP.set = function (patch) { if (!MP.room) return; Object.assign(MP.me, patch); MP.room.presence(patch).catch(() => {}); };
  MP.setCfg = function (patch) {
    if (!MP.isHost()) return;
    const c = Object.assign({}, MP.config(), patch);
    MP.lastCfg = c; MP.set({ cfg: c }); MP.changed();
  };
  MP.smallerTeam = function () {
    const m = MP.members().filter((p) => p.peer !== MP.myId);
    const red = m.filter((p) => p.presence.tm === "red").length, blue = m.filter((p) => p.presence.tm === "blue").length;
    return red < blue ? "red" : "blue";
  };
  MP.onPeers = function () {
    if (MP.joining || !MP.room) { MP.changed(); return; }
    const cfg0 = MP.config(); // remember the host's settings before anything changes
    const amHost = MP.hostId() === MP.myId;
    // direct games run through the host's computer: no host means no game
    if (MP.direct && amHost && !MP.wasHost) {
      RJ.ui.toast("The host left the game.", 3500);
      const inGame = RJ.game && RJ.game.config && RJ.game.config.kind === "mp";
      MP.leave().then(() => { if (inGame) RJ.quitToMenu(); });
      return;
    }
    // host migration: the next pilot by join order carries the settings on; only the host publishes them
    if (amHost && !MP.wasHost) { MP.me.cfg = Object.assign({}, MP.lastCfg || cfg0 || defaultCfg()); MP.set({ cfg: MP.me.cfg }); RJ.ui.toast("The host left. You are now the host.", 3000); }
    if (!amHost && MP.me.cfg) { delete MP.me.cfg; MP.set({ cfg: null }); }
    MP.wasHost = amHost;
    const cfg = MP.config();
    // the host switched to Teams after we joined: take a seat on the smaller side
    if (cfg.mode === "team" && !MP.me.tm && cfg.phase === "lobby") MP.set({ tm: MP.smallerTeam() });
    // a match started (or restarted) by the host
    if (cfg.phase === "play" && cfg.mid && MP.me.mid !== cfg.mid && MP.sitOut !== cfg.mid && !MP.starting && (RJ.state.mode === "menu" || RJ.state.mode === "results" || (RJ.game.mode && RJ.game.mode.mp))) {
      MP.starting = true;
      RJ.startGame("mp", { mid: cfg.mid }).finally(() => { MP.starting = false; });
    }
    if (RJ.game.mode && RJ.game.mode.mp) RJ.game.mode.onPeers();
    MP.changed();
  };
  MP.rejoin = function () { MP.sitOut = null; MP.onPeers(); };
  MP.startMatch = function () {
    if (!MP.isHost()) return;
    MP.sitOut = null;
    const mid = Math.random().toString(36).slice(2, 8);
    MP.setCfg({ phase: "play", mid, el: 0, res: null });
    MP.onPeers();
  };
  MP.toLobby = function () { if (MP.isHost()) MP.setCfg({ phase: "lobby", res: null }); };

  /** Hit on another player's (or the host's bot's) jet: tell its owner. Called from Aircraft.damage. */
  MP.reportHit = function (target, amount, attacker, kind) {
    const m = RJ.game.mode;
    if (!m || !m.mp || !target.netId || !attacker.netId) return;
    if (m.cfg.mode === "team" && !m.cfg.ff && target.team === attacker.team) return;
    m.event("h", target.netId, Math.round(amount * 10) / 10, kind === "missile" ? "m" : "g", attacker.netId);
  };

  /* ======================= MATCH MODE ======================= */
  class Multi {
    constructor(o) { this.o = o; this.mp = true; this.remotes = new Map(); this.bots = []; this.evq = []; this.seq = 1; this.lastSeq = new Map(); this.sendT = 0; this.life = 1; }
    get kind() { return this.cfg && this.cfg.mode !== "free" ? "fight" : "free"; }
    async setup(progress) {
      const cfg = (this.cfg = Object.assign({}, MP.config()));
      this.mid = cfg.mid;
      MP.me.k = 0; MP.me.d = 0;
      MP.set({ mid: this.mid, k: 0, d: 0, ev: [], s: null });
      RJ.world.setEnvironment({ time: cfg.tod, weather: cfg.wx });
      RJ.atlas.ensure();
      if (RJ.world.airbase) RJ.world.setAirbase(null);
      RJ.game.weaponsOff = cfg.mode === "free";
      RJ.game.friendlyFire = cfg.mode === "team" && cfg.ff;
      RJ.game.allowBombs = false;
      const sp = this.spawnPoint();
      await RJ.world.prepare(sp.pos, progress);
      this.player = RJ.modes.makePlayer(MP.me.ac, sp.pos, sp.yaw, RJ.modes.cruiseSpeed(RJ.AIRCRAFT[MP.me.ac]) * 1.1);
      this.player.throttle = 0.8;
      this.tagLocal(this.player, MP.myId, MP.me.nm);
      this.player.team = this.teamOf(MP.myId, MP.me.tm);
      this.t = 0; this.deadT = 0; this.ended = false;
      this.onPeers();
      this.listen();
      RJ.progress.stats.flights++; RJ.saveProgress();
      RJ.ui.flash(cfg.mode === "free" ? "FLYING TOGETHER" : cfg.mode === "team" ? "TEAM DOGFIGHT" : "FREE-FOR-ALL",
        `${MP.members().length} pilot${MP.members().length === 1 ? "" : "s"} · lobby ${MP.code}`, 3);
    }
    teamOf(id, tm) { return this.cfg.mode === "team" ? (tm || "blue") : this.cfg.mode === "ffa" ? "p:" + id : "blue"; }
    tagLocal(ac, id, nm) { ac.netId = id; ac.tag = null; ac.netName = nm; ac.callsign = nm; }
    /** Where to start: the chosen location, spread by slot and team. */
    spawnPoint(slotOverride) {
      const cfg = this.cfg, A = RJ.atlas, P = A.plan;
      let c, yaw;
      const loc = cfg.loc;
      if (loc === "castle" && P.castle) { c = V3(P.castle.x, P.castle.elev + 350, P.castle.z); }
      else if (loc === "bridge" && P.bridge) { c = V3(P.bridge.x, P.bridge.deck + 500, P.bridge.z); }
      else if (loc === "carrier" && P.carrier) { c = V3(P.carrier.x, 600, P.carrier.z); }
      else if (loc === "everest" && RJ.world.everest) { const e = RJ.world.everest; c = V3(e.x + 14000, 7600, e.z + 9000); }
      else { c = V3(A.home.x, 0, A.home.z); }
      const toward = loc === "home" ? dirFromYaw(A.home.yaw) : loc === "everest" && RJ.world.everest ? V3(RJ.world.everest.x - c.x, 0, RJ.world.everest.z - c.z).normalize() : dirFromYaw(A.home.yaw + 0.8);
      const members = MP.members();
      let slot = slotOverride != null ? slotOverride : Math.max(0, members.findIndex((p) => p.peer === MP.myId));
      const side = V3(-toward.z, 0, toward.x);
      let pos;
      if (cfg.mode === "free") {
        // loose echelon so everyone sees each other at the start
        pos = c.clone().addScaledVector(toward, -2500 - slot * 90).addScaledVector(side, (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 140);
        yaw = yawFromDir(toward);
      } else if (cfg.mode === "team") {
        const red = (MP.me.tm || "blue") === "red";
        const inTeam = members.filter((p) => (p.presence.tm || "blue") === (red ? "red" : "blue")).findIndex((p) => p.peer === MP.myId);
        const dir = red ? toward : toward.clone().negate();
        pos = c.clone().addScaledVector(dir, -4000).addScaledVector(side, (Math.max(0, inTeam) - 0.5) * 400 + RJ.rand(-150, 150));
        yaw = yawFromDir(dir);
      } else {
        const a = (slot / MAX) * Math.PI * 2 + RJ.rand(-0.3, 0.3);
        pos = c.clone().add(V3(Math.cos(a) * 3500, 0, Math.sin(a) * 3500));
        yaw = yawFromDir(V3(c.x - pos.x, 0, c.z - pos.z).normalize());
      }
      pos.y = Math.max(c.y, RJ.modes.highestAround(pos.x, pos.z, 1500, 3) + 650);
      return { pos, yaw };
    }

    /* ---------------- events ---------------- */
    event(type, a, b, c, d) {
      const e = [this.seq++, type, a, b, c, d].filter((v, i) => i < 2 || v !== undefined);
      this.evq.push({ e, t: now() });
      this.sendT = 1; // flush soon
    }
    isLocal(ac) { return !!ac && (ac === this.player || ac.netId === MP.myId || this.bots.includes(ac)); }
    listen() {
      const on = (name, fn) => { RJ.on(name, (x) => { if (RJ.game.mode === this) fn(x); }); };
      if (this._listening) return; this._listening = true;
      on("missile", (e) => { if (this.isLocal(e.by) && e.msl.target && e.msl.target.netId) this.event("m", e.by.netId, e.msl.target.netId); });
      on("flares", (ac) => { if (this.isLocal(ac)) this.event("f", ac.netId); });
      on("sonicboom", (ac) => { if (this.isLocal(ac)) this.event("b", ac.netId); });
    }
    onDestroyed(d) {
      const ac = d.ac, by = d.by;
      const name = (x) => (x ? x.netName || x.callsign : "");
      if (this.isLocal(ac)) {
        this.event("k", ac.netId, by && by.netId ? by.netId : "", d.cause || "");
        if (ac === this.player) { MP.me.d++; MP.set({ d: MP.me.d }); this.deadT = 0; RJ.ui.flash(d.cause === "terrain" || d.cause === "water" ? "CRASHED" : "SHOT DOWN", by && by !== ac ? `by ${name(by)}` : `Respawn in ${this.cfg.rd} s`, 2.5, true); }
        else ac.botD = (ac.botD || 0) + 1;
        if (by && this.isLocal(by) && by !== ac) this.creditKill(by, ac);
      }
      if (this.cfg.mode !== "free") RJ.ui.feed(by && by !== ac ? `${name(by)} ▸ ${name(ac)}` : `${name(ac)} ${d.cause === "terrain" || d.cause === "water" ? "crashed" : "down"}`, ac.team === this.player.team ? "r" : "b");
    }
    creditKill(by, victim) {
      if (by === this.player || by.netId === MP.myId) { MP.me.k++; MP.set({ k: MP.me.k }); RJ.ui.flash("SPLASH ONE", victim.netName || victim.spec.short, 1.3); }
      else by.botK = (by.botK || 0) + 1;
    }
    handle(fromPeer, e) {
      const [, type, a, b, c, dd] = e;
      const byId = (id) => this.acById(id);
      if (type === "h") {
        const tgt = byId(a);
        if (tgt && this.isLocal(tgt) && tgt.alive) tgt.damage(b, byId(dd), c === "m" ? "missile" : "gun");
      } else if (type === "k") {
        const victim = byId(a), killer = byId(b);
        if (victim && victim.remote && victim.alive) victim.destroy(killer, c || "gun");
        if (killer && this.isLocal(killer) && victim) this.creditKill(killer, victim);
      } else if (type === "m") {
        const sh = byId(a), tg = byId(b);
        if (sh && sh.remote && tg) RJ.combat.launchMissile(sh, tg);
      } else if (type === "f") {
        const ac = byId(a);
        if (ac && ac.remote) { ac.flares = 99; ac.flareCd = 0; RJ.combat.dropFlares(ac); }
      } else if (type === "b") {
        const ac = byId(a);
        if (ac && ac.remote && ac.pos.distanceTo(RJ.camera.position) < 6000) RJ.sonic.trigger(ac);
      }
    }
    acById(id) {
      if (!id) return null;
      if (id === MP.myId) return this.player;
      const bot = this.bots.find((x) => x.netId === id);
      if (bot) return bot;
      const r = this.remotes.get(id);
      return r ? r.ac : null;
    }

    /* ---------------- network in ---------------- */
    onPeers() {
      if (!MP.room) return;
      const cfg = MP.config();
      this.cfg = Object.assign(this.cfg || {}, { phase: cfg.phase, res: cfg.res, el: cfg.el, kl: cfg.kl, tl: cfg.tl });
      const seen = new Set();
      for (const p of MP.members()) {
        if (p.peer === MP.myId) continue;
        const pr = p.presence;
        if (pr.mid !== this.mid) continue;
        seen.add(p.peer);
        this.ingest(p.peer, pr.ac, this.teamOf(p.peer, pr.tm), pr.nm, pr.s, "player");
        this.events(p.peer, pr.ev);
        // the host's bots
        if (Array.isArray(pr.b)) for (const bt of pr.b) { seen.add(bt[0]); this.ingest(bt[0], bt[1], bt[2], bt[3], bt.slice(6), "bot", p.peer, bt[4], bt[5]); }
      }
      for (const [id, r] of this.remotes) if (!seen.has(id)) this.dropRemote(id, r);
      // a match result from the host
      if (cfg.phase === "res" && cfg.mid === this.mid && !this.ended) this.showResults(cfg.res);
      if (cfg.phase === "lobby" && cfg.mid === this.mid && !this.leaving) { this.leaving = true; RJ.quitToMenu().then(() => { RJ.ui.renderMP(); RJ.ui.show("scr-mp"); }); }
    }
    events(peer, ev) {
      if (!Array.isArray(ev)) return;
      let last = this.lastSeq.get(peer);
      const max = ev.reduce((m, e) => Math.max(m, e[0]), 0);
      if (last == null) { this.lastSeq.set(peer, max); return; } // don't replay history we joined after
      for (const e of ev) if (e[0] > last) this.handle(peer, e);
      this.lastSeq.set(peer, Math.max(last, max));
    }
    ingest(id, acId, team, nm, s, kind, owner, bk, bd) {
      if (!RJ.AIRCRAFT[acId]) return;
      let r = this.remotes.get(id);
      if (r && r.acId !== acId) { this.dropRemote(id, r); r = null; }
      if (!r) {
        const ac = new RJ.Aircraft(acId, { team, livery: team === "red" ? "aggressor" : kind === "bot" ? "aggressor" : "wingman", callsign: nm });
        ac.remote = true; ac.netId = id; ac.netName = nm; ac.tag = nm + (kind === "bot" ? " (AI)" : "");
        ac.missiles = 99; ac.flares = 99;
        ac.mesh.visible = false;
        RJ.combat.add(ac);
        r = { id, ac, acId, kind, owner, buf: [], off: null, life: null, last: null };
        this.remotes.set(id, r);
      }
      r.ac.team = team; r.ac.netName = nm; r.ac.tag = nm + (kind === "bot" ? " (AI)" : ""); r.kind = kind;
      if (kind === "bot") { r.bk = bk; r.bd = bd; }
      if (Array.isArray(s) && s.length >= 19 && (!r.last || s[0] !== r.last[0])) {
        r.last = s;
        const tNow = now(), tS = s[1] / 1000;
        const off = tNow - tS;
        r.off = r.off == null ? off : Math.min(off, r.off + 0.002); // track the fastest arrival; drift slowly
        r.buf.push({ t: tS, pos: V3(s[2], s[3], s[4]), q: new THREE.Quaternion(s[5], s[6], s[7], s[8]).normalize(), vel: V3(s[9], s[10], s[11]),
          thr: s[12], ab: s[13], gear: s[14], hp: s[15], fl: s[16], life: s[17], lock: s[18] });
        if (r.buf.length > 30) r.buf.shift();
      }
    }
    dropRemote(id, r) {
      const C = RJ.combat, i = C.aircraft.indexOf(r.ac);
      if (i >= 0) C.aircraft.splice(i, 1);
      if (r.ac._cone) r.ac._cone.visible = false;
      r.ac.dispose();
      this.remotes.delete(id);
      if (r.kind === "player") RJ.ui.feed(`${r.ac.netName} left`, "r");
    }
    /** Place every remote jet at its interpolated pose (a little in the past, extrapolated over gaps). */
    drawRemotes() {
      const tNow = now();
      for (const r of this.remotes.values()) {
        const ac = r.ac, B = r.buf;
        if (!B.length) continue;
        const rt = tNow - r.off - DELAY;
        let a = B[0], b = B[0];
        for (let i = B.length - 1; i >= 0; i--) if (B[i].t <= rt) { a = B[i]; b = B[Math.min(i + 1, B.length - 1)]; break; }
        const newest = B[B.length - 1];
        let k = 0;
        if (b !== a && b.t > a.t) k = RJ.clamp((rt - a.t) / (b.t - a.t), 0, 1);
        if (rt > newest.t) { a = b = newest; }
        // hermite between snapshots using their velocities; short extrapolation past the newest
        if (a === b) {
          const ex = RJ.clamp(rt - a.t, 0, 0.35);
          ac.pos.copy(a.pos).addScaledVector(a.vel, ex);
          ac.q.copy(a.q);
        } else {
          const dt = b.t - a.t, k2 = k * k, k3 = k2 * k;
          const h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2, h11 = k3 - k2;
          ac.pos.set(0, 0, 0).addScaledVector(a.pos, h00).addScaledVector(a.vel, h10 * dt).addScaledVector(b.pos, h01).addScaledVector(b.vel, h11 * dt);
          ac.q.copy(a.q).slerp(b.q, k);
        }
        const s = a === b ? a : k < 0.5 ? a : b;
        ac.vel.copy(a.vel).lerp(b.vel, k);
        ac.speed = ac.vel.length();
        ac.mach = ac.speed / RJ.soundSpeed(ac.pos.y);
        ac.throttle = s.thr; ac.abLevel = s.ab; ac.gearT = s.gear; ac.gearDown = s.gear > 0.5;
        ac.hp = s.hp * ac.maxHp;
        ac.input.guns = !!(s.fl & 2);
        ac.updateBasis();
        ac.agl = ac.pos.y - RJ.world.ground(ac.pos.x, ac.pos.z);
        const alive = !!(s.fl & 1);
        // respawned (or first seen): bring the jet back
        if (r.life !== s.life) {
          r.life = s.life;
          if (alive) { ac.alive = true; ac.state = s.fl & 4 ? "ground" : "flying"; ac.hp = ac.maxHp; ac.mesh.visible = true; ac.incoming.length = 0; }
        }
        if (!alive && ac.alive) { ac.alive = false; ac.state = "dead"; ac.mesh.visible = false; } // missed the kill message
        if (alive && ac.state !== "falling") { ac.state = s.fl & 4 ? "ground" : "flying"; ac.mesh.visible = true; }
        // lock-on warnings
        const lk = s.lock;
        ac.target = lk ? this.acById(lk) : null;
        if (lk && this.isLocal(ac.target) && ac.target.alive) ac.target.lockedByT = Math.max(ac.target.lockedByT, 0.3);
      }
    }

    /* ---------------- network out ---------------- */
    pack(ac) {
      const r = (v, n) => Math.round(v * n) / n;
      const fl = (ac.alive ? 1 : 0) | (ac.firing ? 2 : 0) | (ac.state === "ground" ? 4 : 0);
      const lk = ac.lockT > 0 && ac.target && ac.target.netId ? ac.target.netId : 0;
      return [this.snapN, Date.now(), r(ac.pos.x, 10), r(ac.pos.y, 10), r(ac.pos.z, 10), r(ac.q.x, 1e4), r(ac.q.y, 1e4), r(ac.q.z, 1e4), r(ac.q.w, 1e4),
        r(ac.vel.x, 10), r(ac.vel.y, 10), r(ac.vel.z, 10), r(ac.throttle, 100), r(ac.abLevel, 100), r(ac.gearT, 100), r(Math.max(0, ac.hp) / ac.maxHp, 100), fl, ac.life || 1, lk];
    }
    send(dt) {
      this.sendT += dt;
      if (this.sendT < 1 / SEND_HZ || !MP.room) return;
      this.sendT = 0;
      this.snapN = (this.snapN || 0) + 1;
      const t = now();
      this.evq = this.evq.filter((x) => t - x.t < 3).slice(-24);
      this.player.life = this.life;
      const patch = { s: this.pack(this.player), ev: this.evq.map((x) => x.e) };
      if (this.bots.length) patch.b = this.bots.map((b) => [b.netId, b.id, b.team, b.netName, b.botK || 0, b.botD || 0].concat(this.pack(b)));
      else if (MP.me.b) patch.b = null;
      MP.me.b = patch.b;
      if (MP.isHost()) this.hostTick(patch);
      // the live room rejects a presence object over 4 KiB (and drops the whole update): trim the
      // oldest events, which peers have almost certainly already seen, until it fits with headroom
      let sz = presBytes(Object.assign({}, MP.me, patch));
      while (sz > PRES_MAX && patch.ev.length) { patch.ev.shift(); this.evq.shift(); sz = presBytes(Object.assign({}, MP.me, patch)); }
      MP.maxBytes = Math.max(MP.maxBytes || 0, sz);
      MP.room.presence(patch).catch((e) => { if (!MP.warned) { MP.warned = true; console.warn("presence rejected", e && (e.code || e.message), sz); } });
    }

    /* ---------------- host duties: bots, clock, end of match ---------------- */
    hostTick(patch) {
      const cfg = MP.config();
      if (cfg.mid !== this.mid || cfg.phase !== "play") return;
      // bots fill empty seats in dogfights
      const want = cfg.bots && cfg.mode !== "free" ? Math.max(0, MAX - MP.members().filter((p) => p.presence.mid === this.mid).length) : 0;
      while (this.bots.length < want) this.spawnBot(this.bots.length);
      while (this.bots.length > want) this.removeBot(this.bots[this.bots.length - 1]);
      // match clock and score limit
      this.elT = (this.elT || 0) + 1 / SEND_HZ;
      if (this.elT >= 1) {
        this.elT = 0;
        const el = (cfg.el || 0) + 1;
        const c2 = Object.assign({}, cfg, { el });
        if (cfg.mode !== "free") {
          const rows = this.scoreRows();
          const top = rows.reduce((m, r) => Math.max(m, r.k), 0);
          const teamK = (t) => rows.filter((r) => r.team === t).reduce((s, r) => s + r.k, 0);
          const hitLimit = cfg.mode === "team" ? Math.max(teamK("red"), teamK("blue")) >= cfg.kl : top >= cfg.kl;
          if (hitLimit || el >= cfg.tl * 60) {
            let win;
            if (cfg.mode === "team") { const r = teamK("red"), b = teamK("blue"); win = r === b ? "Draw" : (r > b ? "Red team" : "Blue team") + " wins"; }
            else { const best = rows.filter((r) => r.k === top); win = best.length === 1 ? `${best[0].nm} wins` : "Draw"; }
            c2.phase = "res"; c2.res = { win, dur: el, rows: rows.map((r) => [r.nm, r.k, r.d, r.team, r.bot ? 1 : 0]) };
          }
        }
        MP.lastCfg = c2; MP.me.cfg = c2; patch.cfg = c2;
      }
    }
    spawnBot(i) {
      const ids = ["f16", "fa18e", "f15c", "f14"];
      const team = this.cfg.mode === "team" ? (() => { const rows = this.scoreRows(); const red = rows.filter((r) => r.team === "red").length, blue = rows.filter((r) => r.team === "blue").length; return red <= blue ? "red" : "blue"; })() : "bot" + i;
      const sp = this.spawnPoint(MAX - 1 - i);
      const ac = new RJ.Aircraft(ids[i % ids.length], { team, livery: "aggressor", callsign: BOT_CALLS[i % BOT_CALLS.length], assist: true });
      ac.place(sp.pos, sp.yaw, RJ.modes.cruiseSpeed(ac.spec) * 1.1);
      ac.pilot = new RJ.combat.Pilot(ac, "veteran");
      ac.netId = "b" + (MP.myId || "x").slice(0, 4) + i; ac.netName = BOT_CALLS[i % BOT_CALLS.length]; ac.tag = ac.netName + " (AI)"; ac.life = 1;
      RJ.combat.add(ac);
      this.bots.push(ac);
    }
    removeBot(b) {
      const C = RJ.combat, i = C.aircraft.indexOf(b);
      if (i >= 0) C.aircraft.splice(i, 1);
      b.dispose();
      this.bots.splice(this.bots.indexOf(b), 1);
    }
    scoreRows() {
      const rows = [];
      for (const p of MP.members()) if (p.presence.mid === this.mid) rows.push({ nm: p.presence.nm, k: p.presence.k || 0, d: p.presence.d || 0, team: this.cfg.mode === "team" ? p.presence.tm || "blue" : null, me: p.peer === MP.myId });
      for (const b of this.bots) rows.push({ nm: b.netName + " (AI)", k: b.botK || 0, d: b.botD || 0, team: this.cfg.mode === "team" ? b.team : null, bot: true });
      for (const r of this.remotes.values()) if (r.kind === "bot") rows.push({ nm: r.ac.netName + " (AI)", k: r.bk || 0, d: r.bd || 0, team: this.cfg.mode === "team" ? r.ac.team : null, bot: true });
      return rows.sort((a, b) => b.k - a.k || a.d - b.d);
    }

    /* ---------------- per frame ---------------- */
    update(dt) {
      if (this.ended) return;
      this.t += dt;
      const pl = this.player;
      this.drawRemotes();
      if (pl.alive) { RJ.modes.trackChallenges(pl, null); RJ.atlas.checkDiscovery(pl); }
      else { this.deadT += dt; if (this.deadT > (this.cfg.rd || 5)) this.respawn(pl); }
      for (const b of this.bots) if (!b.alive) { b.deadT = (b.deadT || 0) + dt; if (b.deadT > (this.cfg.rd || 5) + 1) { b.deadT = 0; this.respawnBot(b); } }
      for (const a of this.bots) if (a.alive && !a.target) RJ.combat.autoTarget(a);
      this.send(dt);
    }
    /** Keeps the link alive while paused or in a replay. */
    netTick(dt) { if (!this.ended) { this.drawRemotes(); this.send(dt); } }
    respawn(pl) {
      this.deadT = 0; this.life++;
      const sp = this.spawnPoint();
      RJ.combat.aircraft.splice(RJ.combat.aircraft.indexOf(pl), 1);
      pl.dispose();
      this.player = RJ.modes.makePlayer(MP.me.ac, sp.pos, sp.yaw, RJ.modes.cruiseSpeed(RJ.AIRCRAFT[MP.me.ac]) * 1.1);
      this.player.throttle = 0.8;
      this.tagLocal(this.player, MP.myId, MP.me.nm);
      this.player.team = this.teamOf(MP.myId, MP.me.tm);
      this.player.life = this.life;
      RJ.game.player = this.player;
      RJ.view.resetCam(this.player);
    }
    respawnBot(b) {
      const sp = this.spawnPoint(MAX - 1 - this.bots.indexOf(b));
      b.place(sp.pos, sp.yaw, RJ.modes.cruiseSpeed(b.spec) * 1.1);
      b.alive = true; b.state = "flying"; b.hp = b.maxHp; b.mesh.visible = true; b.incoming.length = 0; b.life = (b.life || 1) + 1;
      b.missiles = b.spec.msl.n || 0; b.flares = b.spec.flares || 0;
    }
    showResults(res) {
      this.ended = true;
      res = res || { win: "", rows: [], dur: this.t };
      const mine = res.rows.find((r) => r[0] === MP.me.nm && !r[4]);
      RJ.addXP(mine ? mine[1] * 100 + 100 : 50);
      RJ.saveProgress();
      RJ.ui.showResults({
        eyebrow: `Multiplayer · ${this.cfg.mode === "team" ? "Teams" : "Free-for-all"} · lobby ${MP.code}`,
        title: res.win.toUpperCase() || "MATCH OVER", win: !!(mine && (res.win.startsWith(mine[0]) || res.win.toLowerCase().startsWith((MP.me.tm || "") + " "))),
        sub: `Match time ${RJ.fmtTime(res.dur || 0)}`,
        stats: res.rows.map((r) => [`${r[0]}${r[3] ? " · " + r[3] : ""}`, `${r[1]} kills · ${r[2]} deaths`]),
        xp: mine ? mine[1] * 100 + 100 : 50, unlocked: [],
        mp: true
      });
    }
    hudExtras() { return {}; }
    status() {
      const cfg = MP.config();
      if (this.cfg.mode === "free") return `<b>MULTIPLAYER · ${MP.code}</b>${MP.members().length} pilot${MP.members().length === 1 ? "" : "s"} · free flight`;
      const rows = this.scoreRows(), lead = rows[0];
      const left = Math.max(0, (cfg.tl || 10) * 60 - (cfg.el || 0));
      return `<b>${this.cfg.mode === "team" ? "TEAMS" : "FREE-FOR-ALL"} · ${MP.code}</b>You ${MP.me.k}/${MP.me.d} · ${lead ? `${lead.nm} ${lead.k}` : ""} · first to ${cfg.kl} · ${RJ.fmtTime(left)}`;
    }
    objective() {
      const pl = this.player;
      if (!pl.alive) return `Respawning in ${Math.max(0, Math.ceil((this.cfg.rd || 5) - this.deadT))} s`;
      if (this.cfg.mode === "free") return "Fly together: name tags and radar show your squad. Weapons are off.";
      const k = RJ.settings.keys;
      return `Hold Tab for scores · ${RJ.keyLabel(k.target)} target · ${RJ.keyLabel(k.missile)} missile on LOCK · ${RJ.keyLabel(k.guns)} guns · ${RJ.keyLabel(k.flares)} flares`;
    }
    dispose() {
      if (!this.ended && MP.config().mid === this.mid && MP.config().phase === "play") MP.sitOut = this.mid; // quit mid-match: don't get pulled back in
      for (const [id, r] of this.remotes) this.dropRemote(id, r);
      for (const b of this.bots.slice()) this.removeBot(b);
      RJ.game.weaponsOff = false; RJ.game.friendlyFire = false;
      if (MP.room) { MP.me.mid = null; MP.set({ mid: null, s: null, ev: [], b: null }); }
    }
  }
  MP.Multi = Multi;
})(window.RJ);
