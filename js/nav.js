/* Ridgeline Jets — full-screen map, waypoints and autopilot.
 * M opens the map: shaded terrain generated from the same height function as the world, landmarks, your live
 * position and heading. Click to set a waypoint; the HUD then points to it with distance and ETA, a beam marks it
 * in the world, and L engages an autopilot that flies there with terrain clearance. */
(function (RJ) {
  "use strict";
  const N = (RJ.nav = { wp: null, auto: false, open: false });
  const $ = (id) => document.getElementById(id);
  const MI = 1609.344, MPH = 2.23694;
  const view = { cx: 0, cz: 0, span: 80000 };
  let cv, ctx, terr, tctx, job = null, marker = null;

  /* ---------------- overlay ---------------- */
  function build() {
    if ($("map")) return;
    const d = document.createElement("div");
    d.id = "map"; d.hidden = true;
    d.innerHTML = '<canvas id="map-cv"></canvas>' +
      '<div class="map-bar"><b>MAP</b><span class="map-hint">Click to set a waypoint · drag to pan · scroll to zoom</span>' +
      '<span class="map-sp"></span><button class="tool" id="map-me">CENTER</button><button class="tool" id="map-clear">CLEAR WAYPOINT</button>' +
      '<button class="tool" id="map-ap">AUTOPILOT: OFF</button><button class="tool" id="map-close">CLOSE (M)</button></div>' +
      '<div class="map-info" id="map-info"></div>';
    document.body.appendChild(d);
    cv = $("map-cv"); ctx = cv.getContext("2d");
    terr = document.createElement("canvas"); tctx = terr.getContext("2d");
    $("map-close").onclick = () => N.toggle(false);
    $("map-clear").onclick = () => N.clear();
    $("map-me").onclick = () => { const p = player(); if (p) { view.cx = p.pos.x; view.cz = p.pos.z; requestTerrain(); } };
    $("map-ap").onclick = () => N.toggleAuto(player());
    let down = null;
    cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved) { const m = mpp(); view.cx = down.cx - dx * m; view.cz = down.cz - dy * m; }
    });
    cv.addEventListener("pointerup", (e) => {
      if (!down) return;
      if (!down.moved) { const w = toWorld(e.clientX, e.clientY); N.setWaypoint(w.x, w.z); }
      else requestTerrain();
      down = null;
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const before = toWorld(e.clientX, e.clientY);
      view.span = RJ.clamp(view.span * (e.deltaY > 0 ? 1.25 : 0.8), 6000, 600000);
      const after = toWorld(e.clientX, e.clientY);
      view.cx += before.x - after.x; view.cz += before.z - after.z;
      requestTerrain();
    }, { passive: false });
    addEventListener("resize", () => { if (N.open) { size(); requestTerrain(); } });
  }
  const player = () => RJ.game && RJ.game.mode && RJ.game.mode.player;
  function size() { const dpr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const mpp = () => view.span / Math.min(innerWidth, innerHeight); // metres per CSS pixel
  const toWorld = (sx, sy) => ({ x: view.cx + (sx - innerWidth / 2) * mpp(), z: view.cz + (sy - innerHeight / 2) * mpp() });
  const toScreen = (x, z) => ({ x: innerWidth / 2 + (x - view.cx) / mpp(), y: innerHeight / 2 + (z - view.cz) / mpp() });

  /* ---------------- terrain image: sampled progressively so opening the map never stalls a frame ---------------- */
  function requestTerrain() {
    const gw = Math.round(RJ.clamp(innerWidth / 4, 120, 320)), gh = Math.round(gw * innerHeight / innerWidth);
    const m = mpp() * innerWidth / gw;
    job = { gw, gh, x0: view.cx - innerWidth / 2 * mpp(), z0: view.cz - innerHeight / 2 * mpp(), step: m, row: 0, H: new Float32Array(gw * gh), wet: new Uint8Array(gw * gh), snapshot: { ...view } };
    terr.width = gw; terr.height = gh;
    job.img = tctx.createImageData(gw, gh);
  }
  function workTerrain(budget) {
    if (!job || job.row >= job.gh) return;
    const gen = RJ.world.gen, t0 = performance.now();
    const { gw, gh, H, wet, img } = job;
    while (job.row < gh && performance.now() - t0 < budget) {
      const j = job.row, z = job.z0 + (j + 0.5) * job.step;
      for (let i = 0; i < gw; i++) {
        const f = gen.fields(job.x0 + (i + 0.5) * job.step, z);
        H[j * gw + i] = f.h; wet[j * gw + i] = f.h < 0.5 || (f.wl > -1e8 && f.wl > f.h) ? 1 : 0;
        f._snow = f.snowZ;
        job.dry = job.dry || new Float32Array(gw * gh); job.dry[j * gw + i] = f.dry;
      }
      // colour this row now that its heights (and the row above) exist
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i, h = H[k], o = k * 4;
        const hl = H[j * gw + Math.max(0, i - 1)], hu = j > 0 ? H[k - gw] : h;
        const shade = RJ.clamp(1 + ((hl - h) + (hu - h)) / Math.max(job.step, 1) * 1.6, 0.45, 1.35);
        let r, g, b;
        if (wet[k]) { const dpt = RJ.clamp(-h / 600, 0, 1); r = 40 - dpt * 20; g = 92 - dpt * 40; b = 140 - dpt * 40; }
        else {
          const dry = job.dry[k];
          const lowC = [80 + dry * 110, 118 + dry * 40, 62 + dry * 10];
          const t1 = RJ.smooth(300, 2200, h), t2 = RJ.smooth(2600, 3600, h);
          r = lowC[0] + (128 - lowC[0]) * t1; g = lowC[1] + (120 - lowC[1]) * t1; b = lowC[2] + (110 - lowC[2]) * t1;
          r += (238 - r) * t2; g += (242 - g) * t2; b += (248 - b) * t2;
          r *= shade; g *= shade; b *= shade;
        }
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
      job.row++;
    }
    tctx.putImageData(img, 0, 0);
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.fillStyle = "#0b1016"; ctx.fillRect(0, 0, W, H);
    if (job) {
      const a = toScreen(job.x0, job.z0), s = job.step / mpp();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(terr, a.x, a.y, job.gw * s, job.gh * s);
    }
    // grid every 10 miles (or 2 when zoomed in)
    const gs = view.span > 150000 ? 50 * MI : view.span > 30000 ? 10 * MI : 2 * MI;
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    const tl = toWorld(0, 0), br = toWorld(W, H);
    ctx.beginPath();
    for (let x = Math.ceil(tl.x / gs) * gs; x < br.x; x += gs) { const p = toScreen(x, 0); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); }
    for (let z = Math.ceil(tl.z / gs) * gs; z < br.z; z += gs) { const p = toScreen(0, z); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); }
    ctx.stroke();
    // landmarks
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "left";
    for (const lm of (RJ.atlas && RJ.atlas.list) || []) {
      const mk = lm.marker || (lm.s && { x: lm.s.x, z: lm.s.z });
      if (!mk || !lm.def) continue;
      const p = toScreen(mk.x, mk.z);
      if (p.x < -50 || p.y < -50 || p.x > W + 50 || p.y > H + 50) continue;
      ctx.fillStyle = "#ffd27a"; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(lm.def.name, p.x + 8, p.y + 5); ctx.fillStyle = "#fff4dc"; ctx.fillText(lm.def.name, p.x + 7, p.y + 4);
    }
    const pl = player();
    // waypoint + route line
    if (N.wp) {
      const w = toScreen(N.wp.x, N.wp.z);
      if (pl) { const p = toScreen(pl.pos.x, pl.pos.z); ctx.strokeStyle = "#ffb81c"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(w.x, w.y); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = "#ffb81c"; ctx.strokeStyle = "#1a1206"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w.x, w.y - 12); ctx.lineTo(w.x + 9, w.y); ctx.lineTo(w.x, w.y + 12); ctx.lineTo(w.x - 9, w.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // the player: arrow along the heading
    if (pl) {
      const p = toScreen(pl.pos.x, pl.pos.z), a = Math.atan2(pl.fwd.x, -pl.fwd.z);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
      ctx.fillStyle = "#8dffb0"; ctx.strokeStyle = "#062010"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // scale bar
    const bar = gs / mpp();
    ctx.fillStyle = "#e8f2ff"; ctx.fillRect(20, H - 30, bar, 3);
    ctx.font = "12px system-ui, sans-serif"; ctx.fillText(`${Math.round(gs / MI)} mi`, 20, H - 38);
    $("map-info").textContent = info(pl);
    $("map-ap").textContent = `AUTOPILOT: ${N.auto ? "ON" : "OFF"}`;
    $("map-ap").classList.toggle("on", N.auto);
  }
  const fmtT = (s) => { if (!isFinite(s)) return "--:--"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
  const fmtD = (m) => (m < 0.5 * MI ? `${Math.round(m * 3.281)} ft` : `${(m / MI).toFixed(m < 10 * MI ? 1 : 0)} mi`);
  function wpInfo(pl) {
    if (!N.wp || !pl) return null;
    const dx = N.wp.x - pl.pos.x, dz = N.wp.z - pl.pos.z, d = Math.hypot(dx, dz);
    const gs = Math.hypot(pl.vel.x, pl.vel.z);
    const brg = (Math.atan2(dx, -dz) / RJ.DEG + 360) % 360;
    return { d, eta: gs > 1 ? d / gs : Infinity, brg, dx, dz };
  }
  function info(pl) {
    const w = wpInfo(pl);
    if (!w) return "No waypoint. Click the map to set one.";
    return `Waypoint ${fmtD(w.d)} · bearing ${String(Math.round(w.brg)).padStart(3, "0")}° · ETA ${fmtT(w.eta)} at ${Math.round(pl.speed * MPH)} mph`;
  }

  /* ---------------- API ---------------- */
  N.toggle = function (on) {
    build();
    N.open = on != null ? on : !N.open;
    $("map").hidden = !N.open;
    if (N.open) {
      size();
      const p = player();
      if (p) { view.cx = p.pos.x; view.cz = p.pos.z; }
      requestTerrain();
      const loop = () => { if (!N.open) return; workTerrain(8); draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  };
  N.setWaypoint = function (x, z) {
    N.wp = { x, z };
    const pl = player(), w = wpInfo(pl);
    RJ.ui.flash("WAYPOINT SET", w ? `${fmtD(w.d)} · bearing ${String(Math.round(w.brg)).padStart(3, "0")}°` : null, 1.2);
    if (RJ.audio.beep) RJ.audio.beep(880, 0.12, 0.06);
    if (RJ.companion && w) RJ.companion.say(`Waypoint set, ${w.d < MI ? "just ahead" : `${Math.round(w.d / MI)} miles out`}, bearing ${String(Math.round(w.brg)).padStart(3, "0")}.${N.auto ? " Autopilot is taking us there." : ""}`, 2);
  };
  N.clear = function () { N.wp = null; if (N.auto) N.auto = false; if (marker) marker.visible = false; RJ.ui.flash("WAYPOINT CLEARED", null, 0.8); };
  N.reset = function () { N.wp = null; N.auto = false; if (marker) marker.visible = false; if (N.open) N.toggle(false); };
  N.toggleAuto = function (pl) {
    if (!pl) return;
    const md = pl.spec.flight.model;
    if (md === "car" || md === "bike") { RJ.ui.flash("NO AUTOPILOT", "Aircraft only", 0.9); return; }
    if (!N.wp && !N.auto) { RJ.ui.flash("SET A WAYPOINT FIRST", "Open the map (M) and click", 1.1); return; }
    if (pl.state !== "flying" && !N.auto) { RJ.ui.flash("TAKE OFF FIRST", null, 0.9); return; }
    N.auto = !N.auto;
    N.alt = Math.max(pl.pos.y, RJ.world.ground(pl.pos.x, pl.pos.z) + 450);
    RJ.ui.flash(N.auto ? "AUTOPILOT ON" : "AUTOPILOT OFF", N.auto ? "Move the stick to take over" : null, 1);
  };

  /** Autopilot: overrides the stick after the controls are read. */
  N.control = function (pl, dt) {
    if (!N.auto) return;
    const inp = pl.input;
    if (!N.wp || !pl.alive || pl.state !== "flying") { N.auto = false; return; }
    if (Math.abs(inp.pitch) > 0.4 || Math.abs(inp.roll) > 0.4) { N.auto = false; RJ.ui.flash("AUTOPILOT OFF", "You have control", 0.9); return; }
    const w = wpInfo(pl), F = pl.spec.flight, v = Math.max(pl.speed, 20);
    const hdg = Math.atan2(pl.fwd.x, -pl.fwd.z);
    let err = Math.atan2(w.dx, -w.dz) - hdg;
    err = Math.atan2(Math.sin(err), Math.cos(err)); // + = turn right
    // terrain-following: hold the engage altitude, or clear the highest ground ahead by 350 m
    let gmax = 0;
    for (const t of [1, 3, 6, 12, 20]) {
      const d = Math.min(v * t, 30000), px = pl.pos.x + pl.fwd.x * d, pz = pl.pos.z + pl.fwd.z * d;
      gmax = Math.max(gmax, RJ.world.ground(px, pz));
    }
    const altT = Math.max(N.alt, gmax + 350, RJ.world.ground(pl.pos.x, pl.pos.z) + 250);
    if (F.model === "heli") {
      // helicopters fly low: clear the ground ahead by 150 m instead of holding the engage altitude
      const altH = Math.max(gmax + 150, RJ.world.ground(pl.pos.x, pl.pos.z) + 120);
      inp.yaw = RJ.clamp(err * 2.2, -1, 1); inp.roll = 0;
      // climb to a safe height first, then nose down and go
      inp.pitch = pl.pos.y > altH - 80 && pl.agl > 50 ? (Math.abs(err) < 0.5 ? 0.85 : 0.15) : 0;
      inp.thrAbs = RJ.clamp(0.5 + (altH - pl.pos.y) * 0.012, 0.15, 1);
      return;
    }
    if (F.model === "space") {
      // point the nose straight at the climb/turn target (no lift to bank against)
      const tgt = new THREE.Vector3(w.dx, 0, w.dz).normalize();
      tgt.y = RJ.clamp((altT - pl.pos.y) / Math.max(v * 3, 600), -0.5, 0.5);
      tgt.normalize();
      const local = tgt.applyQuaternion(pl.q.clone().invert());
      inp.pitch = RJ.clamp(local.y * 4, -1, 1);
      inp.yaw = RJ.clamp(local.x * 4, -1, 1);
      inp.roll = RJ.clamp(-pl.bank * 2, -1, 1);
      return;
    }
    // fixed-wing: bank to turn, pitch for the climb rate
    const bankD = RJ.clamp(err * 2.6, -1.2, 1.2);
    inp.roll = RJ.clamp((bankD - pl.bank) * 2.2, -1, 1);
    const vsT = RJ.clamp((altT - pl.pos.y) * 0.12, -0.2 * v, 0.25 * v);
    inp.pitch = RJ.clamp((vsT - pl.vel.y) / Math.max(25, v * 0.15) + Math.abs(pl.bank) * 0.25, -0.7, 0.8);
    inp.yaw = 0;
  };

  /** Per frame: the 3D marker and the arrival check. */
  N.update = function (pl, cam, dt) {
    if (!N.wp || !pl) { if (marker) marker.visible = false; return; }
    if (!marker) {
      marker = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb81c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.geometry.translate(0, 0.5, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      ring.rotation.x = Math.PI / 2;
      marker.add(beam, ring); marker.userData = { beam, ring };
      for (const m of [beam, ring]) { m.frustumCulled = false; m.layers.enable(RJ.world.BACK); }
      RJ.scene.add(marker);
    }
    const g = RJ.world.ground(N.wp.x, N.wp.z);
    const d = Math.hypot(N.wp.x - cam.position.x, N.wp.z - cam.position.z);
    marker.visible = true;
    marker.position.set(N.wp.x, g, N.wp.z);
    const r = RJ.clamp(d * 0.005, 6, 600);
    marker.userData.beam.scale.set(r, 9000, r);
    marker.userData.ring.scale.setScalar(r * 6);
    marker.userData.ring.position.y = 3;
    marker.userData.beam.material.opacity = 0.25 + 0.15 * Math.sin(performance.now() / 300);
    const w = wpInfo(pl);
    if (pl.alive && w.d < Math.max(700, pl.speed * 3)) {
      N.wp = null; marker.visible = false;
      const wasAuto = N.auto; N.auto = false;
      RJ.ui.flash("WAYPOINT REACHED", wasAuto ? "Autopilot off · you have control" : null, 1.8);
      if (RJ.audio.discover) RJ.audio.discover();
      if (RJ.companion) RJ.companion.say(wasAuto ? "We've arrived at the waypoint. Autopilot disengaged, you have control." : "Waypoint reached. Nice flying.", 2);
    }
  };

  /** HUD symbology: diamond over the waypoint, or an arrow on the screen edge, plus distance and ETA. */
  N.hud = function (x, h) {
    const pl = h.pl, w = wpInfo(pl);
    if (!w) { if (N.auto) h.text("AUTOPILOT", h.W / 2, 120, "center", 13); return; }
    const g = RJ.world.ground(N.wp.x, N.wp.z);
    const p = h.proj(new THREE.Vector3(N.wp.x, g + 60, N.wp.z), h.cam);
    x.save();
    x.strokeStyle = "#ffb81c"; x.fillStyle = "#ffb81c"; x.lineWidth = 2;
    const label = `WPT ${fmtD(w.d)} · ETA ${fmtT(w.eta)}`;
    if (p.on) {
      x.beginPath(); x.moveTo(p.x, p.y - 11); x.lineTo(p.x + 9, p.y); x.lineTo(p.x, p.y + 11); x.lineTo(p.x - 9, p.y); x.closePath(); x.stroke();
      h.text(fmtD(w.d), p.x, p.y - 18, "center", 12);
    } else {
      // direction on screen (behind you: mirrored)
      let ax = p.vx, ay = -p.vy;
      if (!p.front) { ax = -ax; ay = -ay; }
      if (Math.abs(ax) + Math.abs(ay) < 1e-6) ay = 1;
      const a = Math.atan2(ay, ax), R = Math.min(h.W, h.Hh) * 0.36;
      const cx = h.W / 2 + Math.cos(a) * R, cy = h.Hh / 2 + Math.sin(a) * R;
      x.save(); x.translate(cx, cy); x.rotate(a);
      x.beginPath(); x.moveTo(16, 0); x.lineTo(-8, -10); x.lineTo(-3, 0); x.lineTo(-8, 10); x.closePath(); x.fill();
      x.restore();
    }
    h.text(label + (N.auto ? " · AUTOPILOT" : ""), h.W / 2, 120, "center", 13);
    x.restore();
  };
})(window.RJ);
