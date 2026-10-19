/* Jet City — JET COMBAT SIMULATOR: a spectator mode. Pick two aircraft, a battlefield, distance, altitude and style;
 * both jets are flown by the combat AI (combat.Pilot: target tracking, energy and turn fighting, guns, missiles, flares,
 * defensive rolls, terrain avoidance) on the normal flight model and weapon systems. You watch through a camera
 * director: wide, tracking, side-by-side, missile, overhead, long-lens and an automatic mode that cuts to launches,
 * close passes and kills, with selective slow motion. A spectator HUD shows both jets and a tactical plot. */
(function (RJ) {
  "use strict";
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2, DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const CS = (RJ.combatsim = {});
  CS.FIELDS = [
    { id: "sky", name: "Open sky", region: "ocean", weather: "scattered", desc: "Blue water and scattered cumulus" },
    { id: "mountains", name: "Mountains", region: "mountains", weather: "scattered", desc: "Ridges and valleys to hide in" },
    { id: "coast", name: "Coast", region: "rio", weather: "scattered", desc: "Rio: sea, beaches and peaks" },
    { id: "city", name: "City", region: "tokyo", weather: "scattered", desc: "Over Tokyo's skyline" },
    { id: "nyc", name: "New York", region: "nyc", weather: "scattered", desc: "Manhattan below" },
    { id: "clouds", name: "Above the clouds", region: "clouds", weather: "cloudsea", desc: "A sea of cloud" },
    { id: "desert", name: "Desert", region: "desert", weather: "clear", desc: "Canyons and dunes" }
  ];
  CS.DISTS = [{ id: "close", name: "Merge (3 km)", m: 3000 }, { id: "medium", name: "Medium (10 km)", m: 10000 }, { id: "long", name: "Long range (25 km)", m: 25000 }];
  CS.ALTS = [{ id: "low", name: "Low (500 m)", agl: 500 }, { id: "medium", name: "Medium (3,000 m)", agl: 3000 }, { id: "high", name: "High (8,000 m)", agl: 8000 }];
  CS.STYLES = [
    { id: "dogfight", name: "Close-range dogfight", desc: "Two missiles each, held until the merge: a gun fight" },
    { id: "missile", name: "Missile engagement", desc: "Full loadouts fired early from long range" },
    { id: "mixed", name: "Mixed", desc: "Missiles when they get a shot, guns in the merge" }
  ];
  CS.SKILLS = [{ id: "rookie", name: "Rookie" }, { id: "veteran", name: "Veteran" }, { id: "ace", name: "Ace" }];
  CS.COLORS = [
    { id: "blue", name: "Blue", hex: "#4aa3ff", livery: "wingman" }, { id: "red", name: "Red", hex: "#ff4a4a", livery: "aggressor" },
    { id: "thunderbirds", name: "White/red", hex: "#f2f2f0", livery: "thunderbirds" }, { id: "blueangels", name: "Navy/gold", hex: "#f2b705", livery: "blueangels" },
    { id: "arctic", name: "Arctic", hex: "#cfe3f0", livery: "arctic" }, { id: "desert", name: "Desert", hex: "#c4a77d", livery: "desert" }
  ];
  CS.sel = { a: "f22", b: "f15c", colA: "blue", colB: "red", skillA: "ace", skillB: "ace", field: "mountains", dist: "medium", alt: "medium", style: "mixed", time: "golden" };
  const armed = () => Object.values(RJ.AIRCRAFT).filter((s) => !s.freeOnly && !s.flight.glider && s.flight.model !== "car" && s.flight.model !== "bike" && s.flight.model !== "heli" && ((s.msl && s.msl.n) || s.gun || s.guns || s.cat === "fighter" || s.cat === "future"));

  /* ======================= setup screen ======================= */
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement("style");
    st.textContent = `.csim{max-width:820px}.cs-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.cs-sel{width:100%;padding:8px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.25);border-radius:6px;font:inherit}
      .cs-sel option{background:#10151c}.cs-stat{font-size:12px;opacity:.8;margin:6px 0;min-height:32px;line-height:1.35}
      #cs-hud{position:fixed;inset:0;pointer-events:none;font:13px/1.3 system-ui,sans-serif;color:#eef;z-index:30;text-shadow:0 1px 2px #000}
      #cs-hud .card{position:absolute;top:14px;width:250px;padding:10px 12px;background:rgba(8,12,18,.55);border-radius:8px;border-left:4px solid var(--c)}
      #cs-hud .card.a{left:14px}#cs-hud .card.b{right:14px}#cs-hud .nm{font-weight:700;font-size:15px;letter-spacing:.04em}#cs-hud .row2{display:flex;gap:10px;margin-top:4px;font-variant-numeric:tabular-nums}
      #cs-hud .bar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:6px}#cs-hud .bar i{display:block;height:100%;background:var(--c);border-radius:3px}
      #cs-hud .tag{display:inline-block;margin-top:5px;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;margin-right:4px}#cs-hud .lock{background:#c8102e}#cs-hud .msl{background:#f2b705;color:#111}#cs-hud .dead{background:#444}
      #cs-hud .top{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;background:rgba(8,12,18,.45);padding:6px 14px;border-radius:8px}#cs-hud .tm{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
      #cs-hud canvas{position:absolute;right:14px;bottom:14px;background:rgba(8,12,18,.5);border-radius:8px}#cs-hud .help{position:absolute;left:14px;bottom:14px;opacity:.7;font-size:12px}`;
    document.head.appendChild(st);
  }
  function buildScreen() {
    if ($("scr-csim")) return;
    const d = document.createElement("div");
    d.className = "screen scrim-left"; d.id = "scr-csim"; d.hidden = true;
    d.innerHTML = `<div class="panel setup csim">
      <div><p class="eyebrow">Spectator · AI vs AI</p><h2 class="title">JET COMBAT SIMULATOR</h2></div>
      <div class="cs-cols">
        <section class="group"><h3>Fighter A</h3><select id="cs-a" class="cs-sel"></select><div class="cs-stat" id="cs-a-stat"></div><div class="chips" id="cs-col-a"></div><div class="chips" id="cs-sk-a"></div></section>
        <section class="group"><h3>Fighter B</h3><select id="cs-b" class="cs-sel"></select><div class="cs-stat" id="cs-b-stat"></div><div class="chips" id="cs-col-b"></div><div class="chips" id="cs-sk-b"></div></section>
      </div>
      <section class="group"><h3>Battlefield</h3><div class="chips" id="cs-field"></div></section>
      <section class="group"><h3>Engagement distance</h3><div class="chips" id="cs-dist"></div></section>
      <section class="group"><h3>Starting altitude</h3><div class="chips" id="cs-alt"></div></section>
      <section class="group"><h3>Battle style</h3><div class="opts cols-2" id="cs-style"></div></section>
      <section class="group"><h3>Time of day</h3><div class="chips" id="cs-time"></div></section>
      <p class="help">In battle: 1 wide · 2 tracking · 3 side-by-side · 4 missile · 5 overhead · 6 long lens · 7 dynamic · 0 auto director · H HUD · Space slow motion · Esc pause</p>
      <div class="row"><button class="btn" id="cs-start">START BATTLE</button><button class="ghost" id="cs-back">Back</button></div>
    </div>`;
    document.body.appendChild(d);
    css();
    RJ.ui.registerScreen("scr-csim");
    $("cs-back").onclick = () => { RJ.ui.click(); RJ.ui.show("scr-main"); };
    $("cs-start").onclick = () => { RJ.ui.click(); RJ.startGame("combatsim", Object.assign({}, CS.sel)); };
    for (const k of ["a", "b"]) $("cs-" + k).onchange = (e) => { CS.sel[k] = e.target.value; render(); };
  }
  function statLine(s) {
    const F = s.flight, mph = Math.round(F.vmax * 2.237);
    return `${RJ.ui.esc(s.role || "")}<br>Top speed ${RJ.fmtInt ? RJ.fmtInt(mph) : mph} mph · ${F.gmax} g · ${(s.msl && s.msl.n) || 0} missiles${s.flares ? " · " + s.flares + " flares" : ""}`;
  }
  function render() {
    const S = CS.sel, list = armed(), U = RJ.ui;
    for (const k of ["a", "b"]) {
      const el = $("cs-" + k);
      if (!el.options.length) el.innerHTML = list.map((s) => `<option value="${s.id}">${U.esc(s.name)}</option>`).join("");
      el.value = S[k]; $("cs-" + k + "-stat").innerHTML = statLine(RJ.AIRCRAFT[S[k]]);
    }
    U.chips($("cs-col-a"), CS.COLORS, S.colA, (v) => { S.colA = v; render(); });
    U.chips($("cs-col-b"), CS.COLORS, S.colB, (v) => { S.colB = v; render(); });
    U.chips($("cs-sk-a"), CS.SKILLS, S.skillA, (v) => { S.skillA = v; render(); });
    U.chips($("cs-sk-b"), CS.SKILLS, S.skillB, (v) => { S.skillB = v; render(); });
    U.chips($("cs-field"), CS.FIELDS, S.field, (v) => { S.field = v; render(); });
    U.chips($("cs-dist"), CS.DISTS, S.dist, (v) => { S.dist = v; render(); });
    U.chips($("cs-alt"), CS.ALTS, S.alt, (v) => { S.alt = v; render(); });
    U.opts($("cs-style"), CS.STYLES, S.style, (v) => { S.style = v; render(); });
    U.chips($("cs-time"), U.TIMES().filter((t) => t.id !== "dynamic"), S.time, (v) => { S.time = v; render(); });
  }
  CS.open = function () { buildScreen(); if (!RJ.AIRCRAFT[CS.sel.b]) CS.sel.b = "f16"; render(); RJ.ui.show("scr-csim"); };

  /* ======================= the battle ======================= */
  class CombatSim {
    constructor(o) { this.o = o; this.kind = "combatsim"; this.spectator = true; this.timeScale = 1; }
    async setup(progress) {
      const o = this.o, F = CS.FIELDS.find((f) => f.id === o.field) || CS.FIELDS[1];
      const D = (CS.DISTS.find((d) => d.id === o.dist) || CS.DISTS[1]).m, AG = (CS.ALTS.find((a) => a.id === o.alt) || CS.ALTS[1]).agl;
      RJ.world.setEnvironment({ time: o.time || "golden", weather: F.weather });
      RJ.atlas.ensure();
      const reg = RJ.world.findRegion(F.region);
      const axis = V3(Math.sin(reg.yaw || 0), 0, Math.cos(reg.yaw || 0));
      this.center = V3(reg.x, 0, reg.z);
      let alt = RJ.modes.highestAround(reg.x, reg.z, Math.max(5000, D * 0.7), 6) + AG;
      if (F.id === "clouds") alt = Math.max(alt, RJ.world.cloudTop + 700);
      if (RJ.world.airbase) RJ.world.setAirbase(null);
      await RJ.world.prepare(this.center, progress);
      const mk = (id, team, col, pos, dir, skill, call) => {
        const C = CS.COLORS.find((c) => c.id === col) || CS.COLORS[0];
        const ac = new RJ.Aircraft(id, { team, livery: C.livery, callsign: `${call} (${RJ.AIRCRAFT[id].short})`, assist: true });
        ac.place(pos, Math.atan2(dir.x, dir.z) + Math.PI, RJ.modes.cruiseSpeed(ac.spec) * 1.25);
        ac.pilot = new RJ.combat.Pilot(ac, skill, null);
        // spectator rules of engagement: no snap gun shots nose-to-nose (they end fights in one pass); guns only
        // once the shooter is off the target's nose, so fights turn into proper turning battles
        const pu = ac.pilot.update.bind(ac.pilot);
        ac.pilot.update = (dt) => { pu(dt); const t = ac.target; if (ac.input.guns && t && t.alive && tvR.copy(ac.pos).sub(t.pos).normalize().dot(t.fwd) > 0.55) ac.input.guns = false; };
        ac.csColor = C.hex;
        RJ.combat.add(ac);
        return ac;
      };
      const pA = this.center.clone().addScaledVector(axis, -D / 2).setY(alt), pB = this.center.clone().addScaledVector(axis, D / 2).setY(alt + (D > 5000 ? 150 : 0));
      // a small lateral offset so a head-on merge is a pass, not a collision
      const side = V3(-axis.z, 0, axis.x); pA.addScaledVector(side, 120); pB.addScaledVector(side, -120);
      if (o.style === "dogfight") { // a BFM set-up: line abreast, same heading, "fight's on"
        pA.copy(this.center).addScaledVector(side, -D / 2).setY(alt); pB.copy(this.center).addScaledVector(side, D / 2).setY(alt);
      }
      this.A = mk(o.a, "blue", o.colA, pA, axis, o.skillA, "Alpha");
      this.B = mk(o.b, "red", o.colB, pB, o.style === "dogfight" ? axis : axis.clone().negate(), o.skillB, "Bravo");
      this.player = this.A; // the main loop's reference aircraft (audio, world streaming); never takes keyboard input
      this.A.target = this.B; this.B.target = this.A;
      if (o.style === "dogfight") for (const ac of [this.A, this.B]) { ac.missiles = Math.min(ac.missiles, 2); ac.pilot.mslWait = 18; }
      if (o.style === "missile") for (const ac of [this.A, this.B]) ac.pilot.mslWait = 2;
      this.t = 0; this.ended = false; this.endT = 0; this.events = []; this.lastMsl = null; this.slow = 0;
      this.cam = { shot: "wide", auto: true, t: 0, pos: null, look: V3(), fov: 50, lensPos: null, cut: true, lastShot: 0 };
      this.hudOn = true; this.buildHud();
      RJ.ui.returnTo = "scr-csim";

      RJ.ui.flash("JET COMBAT SIMULATOR", `${this.A.spec.name} vs ${this.B.spec.name}`, 2.6);
    }
    onMissile(e) { if (this.ended) return; this.lastMsl = e.msl; this.events.push({ t: this.t, k: "launch", by: e.by }); if (this.cam.auto && this.t - (this.cam.mslT || -99) > 6) { this.setShot("missile", true); this.cam.mslT = this.t; } }
    onDestroyed(d) {
      const ac = d.ac;
      if (this.ended) return;
      this.ended = true; this.endT = 0; this.winner = ac === this.A ? this.B : ac === this.B ? this.A : null; this.cause = d.cause; this.victim = ac;
      this.slow = 3.2; // the decisive moment in slow motion
      if (this.cam.auto) this.setShot(Math.random() < 0.5 ? "longlens" : "side", true);
      RJ.ui.feed(`${d.by && d.by !== ac ? d.by.callsign + " ▸ " : ""}${ac.callsign} ${d.cause === "missile" ? "· missile" : d.cause === "gun" ? "· guns" : d.cause === "terrain" || d.cause === "water" ? "crashed" : "down"}`, ac === this.A ? "r" : "b");
    }
    update(dt) {
      this.t += dt;
      const A = this.A, B = this.B;
      if (!this.ended) {
        // keep them on each other (re-acquire after a defensive break) and inside a 40 km bubble
        if (A.alive && B.alive) { A.target = B; B.target = A; }
        if (this.t > 8 * 60) { this.ended = true; this.endT = 0; this.winner = null; this.cause = "time"; }
        // a close pass in auto mode: cut to the side camera and ease time down for a moment
        const sep = A.pos.distanceTo(B.pos), clos = tv.copy(B.vel).sub(A.vel).dot(tv2.copy(B.pos).sub(A.pos).normalize());
        if (sep < 260 && clos < -150 && this.t - (this.passT || -99) > 12) { this.passT = this.t; if (this.cam.auto) this.setShot("side", true); this.slow = Math.max(this.slow, 1.1); }
      } else {
        this.endT += dt;
        if (this.endT > 6 && !this.shown) { this.shown = true; this.results(); }
      }
    }
    /* ---------- camera director ---------- */
    setShot(s, cut) { this.cam.shot = s; this.cam.t = 0; this.cam.cut = !!cut; this.cam.lensPos = null; this.cam.lastShot = this.t; }
    hero() {
      const A = this.A, B = this.B;
      if (!A.alive) return B; if (!B.alive) return A;
      // whoever is behind the other (the attacker) is the hero of the shot
      const aBeh = tv.copy(A.pos).sub(B.pos).normalize().dot(B.fwd) < -0.3, bBeh = tv.copy(B.pos).sub(A.pos).normalize().dot(A.fwd) < -0.3;
      return aBeh && !bBeh ? A : bBeh && !aBeh ? B : (this.heroPrev || A);
    }
    camera(camera, rdt) {
      const C = this.cam, A = this.A, B = this.B, H = this.heroPrev = this.hero(), E = H === A ? B : A;
      C.t += rdt;
      // auto director: pick a shot for the moment
      if (C.auto && C.t > (C.shot === "missile" ? 7 : RJ.rand(6, 10)) && !(C.shot === "missile" && this.lastMsl && C.t < 9 && RJ.combat.missiles.includes(this.lastMsl))) {
        const sep = A.pos.distanceTo(B.pos), opts = sep > 6000 ? ["wide", "track", "overhead", "longlens"] : ["track", "longlens", "side", "wide", "dynamic", "track"];
        let s = opts[Math.floor(Math.random() * opts.length)]; if (s === C.shot) s = "track";
        this.setShot(s, s === "longlens" || s === "overhead");
      }
      const mid = tv.copy(A.pos).add(B.pos).multiplyScalar(0.5), sep = A.pos.distanceTo(B.pos);
      let pos = tp.set(0, 0, 0), look = tl.set(0, 0, 0), fov = 55;
      const S = C.shot;
      if (S === "missile" && this.lastMsl && RJ.combat.missiles.includes(this.lastMsl)) {
        const m = this.lastMsl, dir = tv2.copy(m.vel).normalize();
        pos.copy(m.pos).addScaledVector(dir, -38).add(tv3.set(0, 7, 0)); look.copy(m.target && m.target.alive ? m.target.pos : tv3.copy(m.pos).addScaledVector(dir, 200)); fov = 58;
      } else if (S === "wide" || (S === "missile")) {
        const d = Math.max(sep * 1.25, 900), ang = this.t * 0.03, perp = tv2.copy(B.pos).sub(A.pos).normalize().cross(tv3.set(0, 1, 0)).normalize();
        pos.copy(mid).addScaledVector(perp, d * Math.cos(ang * 0.5)).add(tv3.set(0, d * 0.32, 0)); look.copy(mid); fov = 50;
      } else if (S === "track") {
        pos.copy(H.pos).addScaledVector(H.fwd, -Math.max(55, H.vis.dims.len * 4)).addScaledVector(H.up, 14);
        look.copy(H.pos).lerp(E.alive ? E.pos : H.pos, Math.min(0.35, 400 / Math.max(400, sep))); fov = 60;
      } else if (S === "side") {
        pos.copy(H.pos).addScaledVector(H.right, 130).addScaledVector(H.fwd, 40).addScaledVector(H.up, 15); look.copy(H.pos).addScaledVector(H.fwd, 20); fov = 46;
      } else if (S === "overhead") {
        pos.copy(mid).add(tv2.set(0, sep * 1.15 + 900, 0)).addScaledVector(tv3.copy(A.fwd).setY(0).normalize(), -10); look.copy(mid); fov = 55;
      } else if (S === "longlens") {
        // a photographer far off the flight path with a long lens; re-positioned when the jets slip out of reach
        const tgt = H.pos;
        if (!C.lensPos || C.lensPos.distanceTo(tgt) > 7000 || C.lensPos.distanceTo(tgt) < 1200) {
          const side = Math.random() < 0.5 ? 1 : -1;
          C.lensPos = tgt.clone().addScaledVector(H.fwd, 2500).addScaledVector(H.right, side * 1600).add(tv2.set(0, RJ.rand(-200, 250), 0));
        }
        pos.copy(C.lensPos); look.copy(H.pos);
        const dd = pos.distanceTo(look); fov = RJ.clamp(Math.atan2(H.vis.dims.span * 3.2, dd) * 2 / DEG, 3, 20);
      } else { // dynamic: low chase that swings round the hero
        const a = this.t * 0.35; pos.copy(H.pos).addScaledVector(H.fwd, -70 * Math.cos(a)).addScaledVector(H.right, 70 * Math.sin(a)).addScaledVector(H.up, 10); look.copy(H.pos); fov = 62;
      }
      // keep the camera above the ground
      const g = RJ.world.ground(pos.x, pos.z); if (pos.y < g + 25) pos.y = g + 25;
      // smoothing happens relative to a moving anchor (the hero, the missile, the mid-point), so a jet at 300 m/s
      // stays framed: only the camera's offset and aim ease, never its ride along with the action
      const anchor = S === "longlens" ? tz.set(0, 0, 0) : S === "missile" && this.lastMsl ? this.lastMsl.pos : S === "wide" || S === "overhead" ? mid : H.pos;
      const offT = tp2.copy(pos).sub(anchor), lookT = tl2.copy(look).sub(anchor);
      if (!C.off || C.cut || C.anchorShot !== S) { C.off = offT.clone(); C.lookOff = lookT.clone(); C.fov = C.fov || fov; C.anchorShot = S; if (C.cut) C.fov = fov; C.cut = false; }
      else {
        const k = 1 - Math.exp(-rdt * (S === "longlens" ? 12 : S === "missile" ? 8 : 3.5));
        C.off.lerp(offT, k); C.lookOff.lerp(lookT, Math.min(1, k * 1.6));
      }
      C.fov += (fov - C.fov) * Math.min(1, rdt * 2.5);
      C.pos = (C.pos || V3()).copy(anchor).add(C.off); C.look.copy(anchor).add(C.lookOff);
      const g2 = RJ.world.ground(C.pos.x, C.pos.z); if (C.pos.y < g2 + 20) C.pos.y = g2 + 20;
      camera.position.copy(C.pos); camera.up.set(0, 1, 0); camera.lookAt(C.look);
      if (Math.abs(camera.fov - C.fov) > 0.01) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
      this.focus = H;
      return "cinematic";
    }
    input(I) {
      const C = this.cam, map = { "1": "wide", "2": "track", "3": "side", "4": "missile", "5": "overhead", "6": "longlens", "7": "dynamic" };
      for (const k in map) if (I.anyEdge(k)) { C.auto = false; this.setShot(map[k], true); RJ.ui.flash(map[k].toUpperCase() + " CAMERA", "0 for the auto director", 1); }
      if (I.anyEdge("0") || I.action("camera")) { C.auto = !C.auto; RJ.ui.flash(C.auto ? "AUTO DIRECTOR" : "MANUAL CAMERA", null, 1); }
      if (I.anyEdge("h") || I.action("hud")) { this.hudOn = !this.hudOn; this.hudEl.style.display = this.hudOn ? "" : "none"; }
      if (I.anyEdge("space")) this.slowToggle = !this.slowToggle;
      // time: slow motion fades in and out (decisive hits, close passes, or held with Space)
      this.slow = Math.max(0, this.slow - (1 / 60));
      const want = this.slowToggle ? 0.3 : this.slow > 0 ? 0.35 : 1;
      this.timeScale += (want - this.timeScale) * 0.08;
    }
    /* ---------- spectator HUD ---------- */
    buildHud() {
      css();
      const h = document.createElement("div"); h.id = "cs-hud";
      h.innerHTML = `<div class="card a"></div><div class="card b"></div><div class="top"><div class="tm">0:00</div><div class="cm"></div></div><canvas width="190" height="190"></canvas><div class="help">1–7 cameras · 0 auto · H HUD · Space slow motion · Esc pause</div>`;
      document.body.appendChild(h); this.hudEl = h; this.tac = h.querySelector("canvas").getContext("2d");
      // touch: camera and director buttons (keyboard users have 0–9)
      const bar = document.createElement("div"); bar.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:auto;z-index:31";
      const SH = ["wide", "track", "side", "missile", "overhead", "longlens", "dynamic"];
      const btn = (t, fn) => { const b = document.createElement("button"); b.className = "ghost small"; b.textContent = t; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.appendChild(b); };
      btn("CAM ▸", () => { const i = (SH.indexOf(this.cam.shot) + 1) % SH.length; this.cam.auto = false; this.setShot(SH[i], true); });
      btn("AUTO", () => { this.cam.auto = true; });
      btn("SLOW-MO", () => { this.slowToggle = !this.slowToggle; });
      btn("HUD", () => { this.hudOn = !this.hudOn; h.style.display = this.hudOn ? "" : "none"; });
      document.body.appendChild(bar); this.barEl = bar;
    }
    hud() {
      if (!this.hudOn) return;
      const card = (el, ac) => {
        el.style.setProperty("--c", ac.csColor);
        const spd = Math.round(ac.speed * 2.237), alt = Math.round(ac.pos.y * 3.281), hdg = Math.round(((Math.atan2(ac.fwd.x, -ac.fwd.z) / DEG) + 360) % 360);
        el.innerHTML = `<div class="nm">${RJ.ui.esc(ac.callsign)}</div><div>${RJ.ui.esc(ac.spec.name)}</div><div class="row2"><span>${spd} mph</span><span>${alt.toLocaleString()} ft</span><span>HDG ${String(hdg).padStart(3, "0")}</span></div>
          <div class="row2"><span>Missiles ${ac.missiles}</span><span>Flares ${ac.flares || 0}</span><span>${ac.g ? ac.g.toFixed(1) : "1.0"} g</span></div>
          <div class="bar"><i style="width:${Math.max(0, ac.hp / ac.maxHp * 100)}%"></i></div>
          ${!ac.alive ? '<span class="tag dead">DESTROYED</span>' : ""}${ac.alive && ac.locked ? '<span class="tag lock">LOCK</span>' : ""}${ac.alive && ac.incoming.length ? '<span class="tag msl">MISSILE INBOUND</span>' : ""}`;
      };
      const cs = this.hudEl.querySelectorAll(".card"); card(cs[0], this.A); card(cs[1], this.B);
      const m = Math.floor(this.t / 60), s = Math.floor(this.t % 60);
      this.hudEl.querySelector(".tm").textContent = `${m}:${String(s).padStart(2, "0")}`;
      this.hudEl.querySelector(".cm").textContent = `${this.cam.auto ? "AUTO · " : ""}${this.cam.shot.toUpperCase()} CAMERA${this.timeScale < 0.9 ? " · SLOW MOTION" : ""}`;
      // tactical plot: north-up, centred between the jets, missiles as dots
      const c = this.tac, W = 190, A = this.A, B = this.B, mid = tv.copy(A.pos).add(B.pos).multiplyScalar(0.5), R = Math.max(3000, A.pos.distanceTo(B.pos) * 0.75);
      c.clearRect(0, 0, W, W); c.strokeStyle = "rgba(255,255,255,.18)"; for (const f of [0.33, 0.66, 1]) { c.beginPath(); c.arc(W / 2, W / 2, (W / 2 - 6) * f, 0, TAU); c.stroke(); }
      const P = (p) => [W / 2 + (p.x - mid.x) / R * (W / 2 - 6), W / 2 + (p.z - mid.z) / R * (W / 2 - 6)];
      for (const ac of [A, B]) { if (!ac.alive) continue; const [x, y] = P(ac.pos), a = Math.atan2(ac.fwd.z, ac.fwd.x); c.fillStyle = ac.csColor; c.beginPath(); c.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); c.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6); c.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6); c.fill(); }
      c.fillStyle = "#ffd24a"; for (const ms of RJ.combat.missiles) { const [x, y] = P(ms.pos); c.fillRect(x - 1.5, y - 1.5, 3, 3); }
      c.fillStyle = "rgba(255,255,255,.6)"; c.font = "10px system-ui"; c.fillText(`${(R / 1000).toFixed(1)} km`, 6, W - 6);
    }
    results() {
      if (this.hudEl) this.hudEl.style.display = "none"; if (this.barEl) this.barEl.style.display = "none";
      const A = this.A, B = this.B, w = this.winner;
      const line = (ac) => `${ac.stats.shots} rounds · ${ac.stats.hits} hits · ${ac.stats.mslHits}/${ac.stats.msl} missiles`;
      RJ.ui.showResults({
        eyebrow: `Jet Combat Simulator · ${(CS.FIELDS.find((f) => f.id === this.o.field) || {}).name || ""}`,
        title: w ? `${w === A ? "ALPHA" : "BRAVO"} WINS` : this.cause === "time" ? "DRAW" : "NO WINNER", win: !!w,
        sub: w ? `${w.spec.name} defeated the ${(w === A ? B : A).spec.name}${this.cause === "missile" ? " with a missile" : this.cause === "gun" ? " with guns" : this.cause === "terrain" || this.cause === "water" ? " (it hit the ground)" : ""}. Replay is available from the results screen.` : "Eight minutes and neither jet went down.",
        stats: [["Duration", RJ.fmtTime ? RJ.fmtTime(this.t) : Math.round(this.t) + " s"], ["Alpha · " + A.spec.short, line(A)], ["Bravo · " + B.spec.short, line(B)], ["Alpha damage dealt", Math.round(A.stats.dmgDealt)], ["Bravo damage dealt", Math.round(B.stats.dmgDealt)]],
        xp: 0, unlocked: []
      });
    }
    status() { return ""; }
    objective() { return ""; }
    hudExtras() { return {}; }
    dispose() { if (this.hudEl) this.hudEl.remove(); if (this.barEl) this.barEl.remove(); }
  }
  const tv = V3(), tv2 = V3(), tv3 = V3(), tp = V3(), tl = V3(), tp2 = V3(), tl2 = V3(), tz = V3(), tvR = V3();
  RJ.modes = RJ.modes || {};
  CS.CombatSim = CombatSim;
  /** Main menu entries for the two spectator modes (the drag race adds its own handler when loaded). */
  CS.menu = function () {
    const modes = document.querySelector("#scr-main .modes"); if (!modes || $("btn-csim")) return;
    const box = document.createElement("div"); box.className = "spec-row"; modes.appendChild(box);
    const st = document.createElement("style"); st.textContent = ".spec-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.spec-row .mode{padding:10px 14px}.spec-row .mode .nm{font-size:clamp(17px,2.2vw,22px)}.spec-row .mode .ds{font-size:12px}"; document.head.appendChild(st);
    const mk = (id, k, nm, ds) => { const b = document.createElement("button"); b.className = "mode"; b.id = id; b.innerHTML = `<span class="k">${k}</span><span class="nm">${nm}</span><span class="ds">${ds}</span>`; box.appendChild(b); return b; };
    mk("btn-csim", "SPECTATOR · AI VS AI", "JET COMBAT SIMULATOR", "Pick two jets and watch them fight it out, filmed by a cinematic camera director.").onclick = () => { RJ.ui.click(); CS.open(); };
    mk("btn-drag", "SPECTATOR · CARS", "DRAG RACE SIMULATOR", "Pick two cars, light the tree and watch a simulated quarter-mile from broadcast cameras.").onclick = () => { RJ.ui.click(); if (RJ.drag) RJ.drag.open(); };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", CS.menu); else CS.menu();
  RJ.on("missile", (e) => { const m = RJ.game && RJ.game.mode; if (m && m.onMissile) m.onMissile(e); });
})(window.RJ);
