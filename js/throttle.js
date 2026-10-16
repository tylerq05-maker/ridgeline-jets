/* Ridgeline Jets — throttle lever (all aircraft), Star Wars speed feel and the HYPERSONIC button.
 * Lever: bottom = half speed, top = full speed, a detent above the top = afterburner. Jets hold the lever's
 * speed with a smooth auto-throttle (engine power still limits climbs); on the ground or with the gear down
 * the lever is a plain throttle so take-offs and landings work. Helicopters, cars and the bike: plain throttle. */
(function (RJ) {
  "use strict";
  const L = (RJ.lever = { pos: 0.6, detent: false, drag: false, at: null, el: null });
  const MPH = 2.23694;
  const $ = (id) => document.getElementById(id);

  function build() {
    const ui = $("game-ui");
    if (!ui || $("lever")) return;
    const d = document.createElement("div");
    d.id = "lever";
    d.innerHTML = '<div class="lv-track" id="lv-track"><div class="lv-detent">AB</div><div class="lv-fill" id="lv-fill"></div><div class="lv-handle" id="lv-handle"></div></div>' +
      '<div class="lv-read"><b id="lv-pct">60%</b><span id="lv-spd">0 mph</span><span id="lv-mode">SPEED</span><span id="lv-ab">AFTERBURNER</span></div>';
    ui.appendChild(d);
    const tools = ui.querySelector(".tools");
    const mk = (id, label, title) => { const b = document.createElement("button"); b.className = "tool"; b.id = id; b.textContent = label; b.title = title; tools.insertBefore(b, tools.firstChild); return b; };
    mk("btn-map", "MAP", "Map and waypoints (M)").addEventListener("click", () => RJ.nav && RJ.nav.toggle());
    const hb = mk("btn-hyper", "HYPERSONIC", "Hypersonic boost (H) · Star Wars craft only");
    hb.hidden = true;
    hb.addEventListener("click", () => { const p = RJ.game.mode && RJ.game.mode.player; if (p && RJ.vehicles) RJ.vehicles.toggleHyper(p); });
    const tr = $("lv-track");
    const setFromY = (e) => {
      const r = tr.getBoundingClientRect();
      // the top 14% of the track is the afterburner detent
      const v = 1 - (e.clientY - r.top) / r.height;
      L.detent = v > 0.9;
      L.pos = RJ.clamp(v / 0.86, 0, 1);
    };
    tr.addEventListener("pointerdown", (e) => { e.preventDefault(); L.drag = true; tr.setPointerCapture(e.pointerId); setFromY(e); });
    tr.addEventListener("pointermove", (e) => { if (L.drag) setFromY(e); });
    const end = () => { L.drag = false; };
    tr.addEventListener("pointerup", end); tr.addEventListener("pointercancel", end);
    L.el = d;
  }

  L.reset = function (pl) {
    build();
    L.pos = pl && pl.state !== "ground" ? 0.6 : 0; L.detent = false; L.at = null;
    if (pl && pl.spec.flight.model === "heli") L.pos = pl.state === "ground" ? 0 : 0.5;
  };

  /** After the controls are read: turn the lever into throttle/afterburner commands. */
  L.apply = function (pl, dt) {
    const inp = pl.input, F = pl.spec.flight;
    if (!L.drag && inp.thr) {
      L.pos = RJ.clamp(L.pos + inp.thr * 0.5 * dt, 0, 1);
      if (inp.thr < 0) L.detent = false;
    }
    if (inp.thrAbs != null) L.pos = inp.thrAbs; // touch slider / gamepad absolute input
    const ab = inp.ab || L.detent;
    let thr = L.pos;
    L.speedMode = false;
    if (!F.model && pl.state === "flying" && !pl.gearDown) {
      // auto-throttle: hold the lever's speed between half and full speed
      L.speedMode = true;
      const vhi = F.vmax * (F.ab > 0 ? 0.8 : 0.97), vlo = Math.max(vhi * 0.5, F.vstall * 1.35);
      const vt = vlo + (vhi - vlo) * L.pos;
      L.vt = vt;
      if (L.at == null) L.at = pl.throttle;
      const e = (vt - pl.speed) / vt;
      L.at = RJ.clamp(L.at + e * dt * 1.2, 0, 1);
      thr = ab ? 1 : RJ.clamp(L.at + e * 4, 0, 1);
    } else L.at = null;
    inp.thrAbs = thr; inp.thr = 0; inp.ab = ab;
  };

  /* ---------------- speed feel: FOV, shake, streaks, hyperspace lines ---------------- */
  RJ.camFx = { fov: 0, shake: 0 };
  let streaks = null;
  const NS = 420;
  function makeStreaks() {
    const pos = new Float32Array(NS * 6), seed = new Float32Array(NS * 3);
    for (let i = 0; i < NS; i++) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.pow(Math.random(), 0.7) * 70;
      seed[i * 3] = Math.cos(a) * r; seed[i * 3 + 1] = Math.sin(a) * r; seed[i * 3 + 2] = -20 - Math.random() * 500;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ls = new THREE.LineSegments(g, m);
    ls.frustumCulled = false; ls.renderOrder = 20;
    RJ.scene.add(ls);
    return { ls, seed, pos, g };
  }
  function updateStreaks(cam, k, hy, dt) {
    if (!streaks) streaks = makeStreaks();
    const S = streaks;
    S.ls.visible = k > 0.01;
    if (!S.ls.visible) return;
    S.ls.position.copy(cam.position); S.ls.quaternion.copy(cam.quaternion);
    const flow = 300 + hy * 4200, len = 6 + k * 40 + hy * 180;
    for (let i = 0; i < NS; i++) {
      let z = S.seed[i * 3 + 2] + flow * dt;
      if (z > 10) z -= 520;
      S.seed[i * 3 + 2] = z;
      const x = S.seed[i * 3], y = S.seed[i * 3 + 1], o = i * 6;
      S.pos[o] = x; S.pos[o + 1] = y; S.pos[o + 2] = z; S.pos[o + 3] = x; S.pos[o + 4] = y; S.pos[o + 5] = z - len;
    }
    S.g.attributes.position.needsUpdate = true;
    S.ls.material.opacity = Math.min(1, k * 0.35 + hy * 0.75);
  }
  L.hideFx = function () { if (streaks) streaks.ls.visible = false; RJ.camFx.fov = 0; RJ.camFx.shake = 0; };

  /** Per frame: lever UI and the speed effects for the player's craft. */
  L.frame = function (pl, cam, dt) {
    if (!L.el) build();
    const F = pl.spec.flight, sw = F.model === "space";
    const hy = sw ? pl.hyperK || 0 : 0, spdK = sw ? RJ.smooth(700, 2300, pl.speed) : 0;
    RJ.camFx.fov = spdK * 12 + hy * 40;
    RJ.camFx.shake = spdK * 0.12 + hy * 0.9;
    if (sw && pl.alive) {
      const k = spdK * 0.7 + hy;
      if (k > 0.05) RJ.fx.speedStreak(cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), pl.vel, Math.min(2, k));
      updateStreaks(cam, spdK, hy, dt);
    } else if (streaks) streaks.ls.visible = false;
    // lever UI
    const vis = RJ.state.mode === "playing" && pl.alive;
    L.el.hidden = !vis;
    const hb = $("btn-hyper");
    hb.hidden = !sw;
    hb.classList.toggle("on", hy > 0.05 || !!(pl.vs && pl.vs.hyperOn));
    if (!vis) return;
    const top = L.detent ? 0.95 : L.pos * 0.86;
    $("lv-handle").style.bottom = `calc(${top * 100}% - 9px)`;
    $("lv-fill").style.height = `${top * 100}%`;
    $("lv-pct").textContent = `${Math.round(L.pos * 100)}%`;
    $("lv-spd").textContent = `${RJ.fmtInt ? RJ.fmtInt(pl.speed * MPH) : Math.round(pl.speed * MPH)} mph`;
    $("lv-mode").textContent = L.speedMode ? `SET ${Math.round(L.vt * MPH)}` : sw ? `SET ${Math.round((L.detent || pl.input.ab ? F.space.vboost : (0.5 + 0.5 * L.pos) * F.space.vmax) * MPH)}` : "THROTTLE";
    const abOn = pl.abLevel > 0.3 || L.detent || hy > 0.05;
    const abEl = $("lv-ab");
    abEl.textContent = hy > 0.05 ? "HYPERSONIC" : F.ab > 0 ? "AFTERBURNER" : "MAX POWER";
    abEl.classList.toggle("on", abOn);
  };

  /* ---------------- HYPERSONIC activation: shockwave, boom, kick ---------------- */
  RJ.on("hyper", (e) => {
    const ac = e.ac;
    if (!e.on) { RJ.ui.flash("HYPERSONIC OFF", "Back to throttle speed", 1); return; }
    const d = ac.vis.dims, R0 = Math.max(d.span * 0.42, d.len * 0.17, 2.4), L0 = d.len * 0.36;
    try { RJ.fx.boomBurst(ac.pos.clone(), ac.fwd, ac.up, ac.right, ac.vel, R0 * 1.6, L0 * 1.6, 1, RJ.world.sunDir); } catch (err) { /* fx optional */ }
    if (RJ.audio.sonicBoom) RJ.audio.sonicBoom(0, false, 1.6);
    if (RJ.audio.abLight) RJ.audio.abLight(false);
    if (RJ.camKick) RJ.camKick(3);
    if (RJ.post && RJ.post.fx) { RJ.post.fx.chroma = 0.014; RJ.post.fx.flash = 0.25; RJ.post.fx.flashCol = [0.75, 0.85, 1.0]; }
    RJ.ui.flash("HYPERSONIC", "H again to drop back", 1.4);
  });
})(window.RJ);
