/* Ridgeline Jets — flight recorder, cinematic replay, challenge ghosts and photo mode.
 *
 * Recorder: while you fly, every aircraft's real state (position, orientation, speed, Mach, throttle,
 * afterburner, gear, control deflections, G, damage) is sampled 20×/s into a 60 s ring buffer, with
 * sonic booms, explosions and missiles as events. The replay drives "puppet" aircraft from those
 * samples, so it's the actual flight, not a re-simulation; the live simulation is frozen untouched
 * underneath and resumes exactly where it was.
 * Ghosts: a challenge's best run is stored per challenge and flown back as a translucent aircraft.
 * Photo mode: frozen frame with an orbit/free camera, zoom, time of day, exposure and depth of field. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, $ = (id) => document.getElementById(id);
  const tv = V3(), tv2 = V3(), tq = new THREE.Quaternion(), UPV = V3(0, 1, 0);
  const STATES = ["flying", "ground", "falling", "dead"];
  const NF = 18; // floats per aircraft per sample
  const view = () => RJ.view;

  /* ======================= RECORDER ======================= */
  const R = (RJ.replay = { frames: [], meta: new Map(), events: [], maxT: 60, hz: 20, acc: 0, t: 0, rid: 0 });
  R.reset = function () { R.frames.length = 0; R.events.length = 0; R.meta.clear(); R.t = 0; R.acc = 0; };
  function pack(ac, d, o) {
    d[o] = ac.pos.x; d[o + 1] = ac.pos.y; d[o + 2] = ac.pos.z;
    d[o + 3] = ac.q.x; d[o + 4] = ac.q.y; d[o + 5] = ac.q.z; d[o + 6] = ac.q.w;
    d[o + 7] = ac.speed; d[o + 8] = ac.mach; d[o + 9] = ac.throttle; d[o + 10] = ac.abLevel; d[o + 11] = ac.gearT;
    d[o + 12] = ac.ctl.pitch; d[o + 13] = ac.ctl.roll; d[o + 14] = ac.ctl.yaw; d[o + 15] = ac.g;
    d[o + 16] = ac.hp / ac.maxHp; d[o + 17] = Math.max(0, STATES.indexOf(ac.state));
  }
  /** Called once per simulated frame while playing. */
  R.record = function (dt) {
    R.t += dt; R.acc += dt;
    if (R.acc < 1 / R.hz) return;
    R.acc = 0;
    const acs = RJ.combat.aircraft;
    const data = new Float32Array(acs.length * NF), ids = new Array(acs.length);
    acs.forEach((ac, i) => {
      ids[i] = ac.uid;
      if (!R.meta.has(ac.uid)) R.meta.set(ac.uid, { id: ac.id, team: ac.team, isPlayer: ac.isPlayer, callsign: ac.callsign });
      pack(ac, data, i * NF);
    });
    const ms = RJ.combat.missiles.map((m) => [m._rid || (m._rid = ++R.rid), m.pos.x, m.pos.y, m.pos.z, m.t < m.burn ? 1 : 0]);
    R.frames.push({ t: R.t, ids, data, ms, idx: null });
    while (R.frames.length && R.t - R.frames[0].t > R.maxT) R.frames.shift();
    while (R.events.length && R.t - R.events[0].t > R.maxT + 1) R.events.shift();
  };
  RJ.on("sonicboom", (ac) => { if (RJ.state.mode === "playing") R.events.push({ t: R.t, type: "boom", uid: ac.uid }); });
  RJ.on("explosion", (e) => { if (RJ.state.mode === "playing") R.events.push({ t: R.t, type: "exp", pos: e.pos.clone(), big: e.big || 1 }); });
  R.available = () => R.frames.length > 40;
  R.duration = () => (R.frames.length ? R.frames[R.frames.length - 1].t - R.frames[0].t : 0);

  /* ---------------- sampling ---------------- */
  function frameIndex(f, uid) {
    if (!f.idx) { f.idx = new Map(); f.ids.forEach((u, i) => f.idx.set(u, i)); }
    const i = f.idx.get(uid);
    return i == null ? -1 : i * NF;
  }
  function findFrame(t) {
    const F = R.frames;
    let lo = 0, hi = F.length - 1;
    if (t <= F[0].t) return 0;
    if (t >= F[hi].t) return hi - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid; }
    return lo;
  }
  /** Interpolated state of aircraft uid at time t, or null if it didn't exist then. */
  function sample(uid, t, out) {
    const F = R.frames, i = findFrame(t), f0 = F[i], f1 = F[Math.min(i + 1, F.length - 1)];
    const o0 = frameIndex(f0, uid), o1 = frameIndex(f1, uid);
    if (o0 < 0 && o1 < 0) return null;
    const a = o0 >= 0 ? f0.data : f1.data, b = o1 >= 0 ? f1.data : f0.data, ia = o0 >= 0 ? o0 : o1, ib = o1 >= 0 ? o1 : o0;
    const k = f1.t > f0.t ? RJ.clamp((t - f0.t) / (f1.t - f0.t), 0, 1) : 0;
    out = out || {};
    out.pos = (out.pos || V3()).set(a[ia] + (b[ib] - a[ia]) * k, a[ia + 1] + (b[ib + 1] - a[ia + 1]) * k, a[ia + 2] + (b[ib + 2] - a[ia + 2]) * k);
    out.q = (out.q || new THREE.Quaternion()).set(a[ia + 3], a[ia + 4], a[ia + 5], a[ia + 6]);
    out.q.slerp(tq.set(b[ib + 3], b[ib + 4], b[ib + 5], b[ib + 6]), k);
    const dtf = Math.max(1e-3, f1.t - f0.t);
    out.vel = (out.vel || V3()).set((b[ib] - a[ia]) / dtf, (b[ib + 1] - a[ia + 1]) / dtf, (b[ib + 2] - a[ia + 2]) / dtf);
    const L = (j) => a[ia + j] + (b[ib + j] - a[ia + j]) * k;
    out.speed = L(7); out.mach = L(8); out.throttle = L(9); out.ab = L(10); out.gear = L(11);
    out.cp = L(12); out.cr = L(13); out.cy = L(14); out.g = L(15); out.hp = L(16);
    out.state = STATES[Math.round(k < 0.5 ? a[ia + 17] : b[ib + 17])] || "flying";
    return out;
  }
  R.sample = sample;

  /* ======================= REPLAY PLAYBACK ======================= */
  const P = { on: false, pups: new Map(), mpups: new Map(), shot: "director", speed: 1, slow: 1 };
  const SHOTS = [["director", "Director"], ["chase", "Chase"], ["side", "Side"], ["flyby", "Flyby"], ["wide", "Wide"], ["orbit", "Orbit"]];
  const SPEEDS = [0.25, 0.5, 1, 2];
  let ghostMat = null;
  function makePuppet(meta, ghost) {
    const pup = new RJ.Aircraft(meta.id, { team: meta.team, livery: meta.team === "red" ? "aggressor" : meta.isPlayer ? null : "wingman", callsign: meta.callsign });
    pup.isPlayer = false; pup.puppet = true;
    pup.mesh.visible = false;
    if (ghost) {
      // normal blending with depth writes: one clean translucent layer instead of stacked additive surfaces
      ghostMat = ghostMat || new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.34, depthWrite: true, fog: false });
      pup.mesh.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; o.layers.set(RJ.LATE); } });
    }
    return pup;
  }
  function applySample(pup, s, dt) {
    pup.pos.copy(s.pos); pup.q.copy(s.q); pup.vel.copy(s.vel);
    pup.speed = s.speed; pup.mach = s.mach; pup.throttle = s.throttle; pup.abLevel = s.ab; pup.gearT = s.gear; pup.gearDown = s.gear > 0.5;
    pup.ctl.pitch = s.cp; pup.ctl.roll = s.cr; pup.ctl.yaw = s.cy; pup.g = s.g; pup.hp = s.hp * pup.maxHp;
    pup.alive = s.state !== "dead"; pup.state = s.state;
    pup.time += dt;
    pup.updateBasis();
    pup.agl = pup.pos.y - RJ.world.ground(pup.pos.x, pup.pos.z);
  }

  R.start = function (from) {
    if (P.on || !R.available()) { if (!R.available()) RJ.ui.flash("NOTHING TO REPLAY YET", "Fly for a few seconds first", 1.4); return false; }
    const v = view();
    P.on = true; P.from = from || "playing";
    P.t0 = R.frames[0].t; P.t1 = R.frames[R.frames.length - 1].t; P.rt = P.t0; P.prevRt = P.t0;
    P.paused = false; P.speed = 1; P.slow = 1; P.shotObj = null; P.lastLandmarkT = -99;
    // freeze the live world: hide the live aircraft and missiles, clear transient effects
    P.hidden = [];
    for (const ac of RJ.combat.aircraft) { P.hidden.push([ac.mesh, ac.mesh.visible]); ac.mesh.visible = false; }
    for (const m of RJ.combat.missiles) { P.hidden.push([m.mesh, m.mesh.visible]); m.mesh.visible = false; }
    RJ.fx.clear(); RJ.sonic.reset();
    for (const [uid, meta] of R.meta) P.pups.set(uid, makePuppet(meta));
    P.focusUid = [...R.meta.entries()].find(([, m]) => m.isPlayer)?.[0] ?? [...R.meta.keys()][0];
    P.saveFov = v.camera.fov;
    P.orbit = { yaw: 0.6, pitch: 0.15, dist: 1 };
    RJ.state.mode = "replay";
    RJ.ui.hideAll(); RJ.ui.gameChrome(false); RJ.hud.clear();
    $("pip").hidden = true;
    RJ.audio.setGun(false); RJ.audio.tone(null); RJ.audio.warn(null);
    if (RJ.audio.ctx && RJ.audio.ctx.state === "suspended") RJ.audio.ctx.resume();
    renderReplayUI();
    $("replay-ui").hidden = false;
    return true;
  };
  R.exit = function () {
    if (!P.on) return;
    const v = view();
    P.on = false;
    $("replay-ui").hidden = true;
    for (const p of P.pups.values()) { if (p._cone) p._cone.visible = false; p.dispose(); }
    P.pups.clear();
    for (const m of P.mpups.values()) RJ.scene.remove(m);
    P.mpups.clear();
    for (const [mesh, vis] of P.hidden) mesh.visible = vis;
    RJ.fx.clear(); RJ.sonic.reset();
    v.camera.fov = P.saveFov; v.camera.updateProjectionMatrix();
    const pl = RJ.game.mode && RJ.game.mode.player;
    if (pl) v.resetCam(pl);
    v.resetClock();
    if (P.from === "results") { RJ.state.mode = "results"; RJ.ui.show("scr-results"); }
    else if (P.from === "paused") { RJ.state.mode = "paused"; RJ.ui.show("scr-pause"); if (RJ.audio.ctx) RJ.audio.ctx.suspend(); }
    else { RJ.state.mode = "playing"; RJ.ui.gameChrome(true); }
  };
  R.active = () => P.on;

  /* ---------------- camera shots ---------------- */
  function focusPup() { return P.pups.get(P.focusUid); }
  function futureOf(t, out) { return sample(P.focusUid, RJ.clamp(t, P.t0, P.t1), out); }
  const keepAbove = (p, m) => { const g = RJ.world.ground(p.x, p.z); if (p.y < g + (m || 3)) p.y = g + (m || 3); return p; };
  function nearLandmark(p) {
    if (!RJ.atlas || !RJ.atlas.list) return null;
    let best = null;
    for (const lm of RJ.atlas.list) { const d = lm.marker.distanceTo(p); if (d < 3800 && (!best || d < best.d)) best = { lm, d }; }
    return best;
  }
  /** Build a shot: returns {kind, dur, anchor?, ...}. Anchored shots fix the camera in the world. */
  function makeShot(kind, rt) {
    const pup = focusPup(), len = pup ? pup.vis.dims.len : 15;
    const s = { kind, start: rt, dur: 4.5 + Math.random() * 1.8, fov: 52 };
    const fut = futureOf(rt + 2.6, {});
    if (!fut) return Object.assign(s, { kind: "chase" });
    const fwd = V3(0, 0, -1).applyQuaternion(fut.q), right = V3(1, 0, 0).applyQuaternion(fut.q).setY(0).normalize();
    const side = Math.random() < 0.5 ? 1 : -1;
    if (kind === "flyby") { s.anchor = fut.pos.clone().addScaledVector(right, side * (28 + len * 1.6)).add(V3(0, 5 + len * 0.3, 0)).addScaledVector(fwd, len); s.fov = 42; s.dur = 4.2; }
    else if (kind === "wide") {
      const fut2 = futureOf(rt + 3.2, {});
      s.anchor = fut2.pos.clone().addScaledVector(right, side * 750).add(V3(0, 180, 0)); s.fov = 20; s.dur = 6;
    } else if (kind === "low") {
      const g = RJ.world.ground(fut.pos.x, fut.pos.z);
      s.anchor = fut.pos.clone().addScaledVector(right, side * 90); s.anchor.y = Math.max(g, RJ.world.ground(s.anchor.x, s.anchor.z)) + 4; s.fov = 48; s.dur = 4.5;
    } else if (kind === "side") { s.side = side; s.fov = 46; }
    else if (kind === "landmark") { s.lm = nearLandmark(pup.pos).lm; s.fov = 44; s.dur = 5.5; }
    if (s.anchor) keepAbove(s.anchor, 4);
    return s;
  }
  function director(rt) {
    const cur = P.shotObj;
    // boom highlight: cut to a side-on view anchored on the moment the shock forms, in slow motion
    const boom = R.events.find((e) => e.type === "boom" && e.uid === P.focusUid && e.t > rt && e.t < rt + 2.4);
    if (boom && (!cur || cur.kind !== "boom")) { const sh = makeShotBoom(boom.t, rt); sh.dur = boom.t + 2.6 - rt; return sh; }
    if (cur && rt - cur.start < cur.dur) return cur;
    const pup = focusPup();
    if (pup && rt - P.lastLandmarkT > 12 && nearLandmark(pup.pos)) { P.lastLandmarkT = rt; return makeShot("landmark", rt); }
    const order = pup && pup.agl < 600 ? ["chase", "flyby", "side", "low", "wide", "flyby"] : ["chase", "flyby", "side", "wide"];
    P.cycle = ((P.cycle || 0) + 1) % order.length;
    return makeShot(order[P.cycle], rt);
  }
  function makeShotBoom(tb, rt) {
    const b = futureOf(tb, {}), pup = focusPup(), len = pup ? pup.vis.dims.len : 15;
    const bf = V3(0, 0, -1).applyQuaternion(b.q), br = V3(1, 0, 0).applyQuaternion(b.q).setY(0).normalize();
    const side = Math.random() < 0.5 ? 1 : -1;
    const anchor = keepAbove(b.pos.clone().addScaledVector(br, side * (55 + len * 2.2)).addScaledVector(bf, 60 + len * 2).add(V3(0, 8, 0)), 4);
    return { kind: "boom", start: rt, tb, anchor, fov: 40 };
  }
  function placeCamera(dt, rt) {
    const cam = view().camera, pup = focusPup();
    if (!pup) return;
    let shot;
    if (P.shot === "director") shot = P.shotObj = director(rt);
    else if (P.shot !== (P.shotObj && P.shotObj.manual)) shot = P.shotObj = Object.assign(makeShot(P.shot === "orbit" ? "chase" : P.shot, rt), { manual: P.shot, kind: P.shot, dur: 1e9 });
    else shot = P.shotObj;
    // re-anchor manual flyby/wide shots once the aircraft is well past
    if (shot.manual && shot.anchor && rt - shot.start > (shot.kind === "wide" ? 7 : 4.5)) shot = P.shotObj = Object.assign(makeShot(shot.kind, rt), { manual: shot.manual, kind: shot.kind, dur: 1e9 });
    const len = pup.vis.dims.len;
    const target = tv.copy(pup.pos);
    let pos;
    P.slow = shot.kind === "boom" && rt > shot.tb - 0.8 && rt < shot.tb + 2.2 ? 0.35 : 1;
    if (shot.kind === "chase") {
      pos = pup.pos.clone().addScaledVector(pup.fwd, -(len * 2.4 + 14)).addScaledVector(pup.up, len * 0.45 + 4);
      target.addScaledVector(pup.fwd, 25);
    } else if (shot.kind === "side") {
      pos = pup.pos.clone().addScaledVector(V3(1, 0, 0).applyQuaternion(pup.q).setY(0).normalize(), shot.side * (len * 2.2 + 18)).addScaledVector(pup.fwd, len * 0.6).add(V3(0, 3, 0));
    } else if (shot.kind === "landmark" && shot.lm) {
      const away = pup.pos.clone().sub(shot.lm.marker).setY(0).normalize();
      pos = pup.pos.clone().addScaledVector(away, len * 4 + 70).add(V3(0, 16 + len * 0.5, 0));
      target.lerp(shot.lm.marker, 0.12);
    } else if (shot.kind === "orbit" || P.shot === "orbit") {
      const o = P.orbit, d = (len * 3 + 25) * o.dist;
      pos = pup.pos.clone().add(V3(Math.sin(o.yaw) * Math.cos(o.pitch) * d, Math.sin(o.pitch) * d, Math.cos(o.yaw) * Math.cos(o.pitch) * d));
    } else pos = shot.anchor ? shot.anchor.clone() : pup.pos.clone().add(V3(0, 30, 60));
    keepAbove(pos, 2.5);
    // gentle smoothing for moving shots; hard cuts between shots
    if (P.lastShot !== shot || !P.camPos) { P.camPos = pos.clone(); P.camLook = target.clone(); P.lastShot = shot; }
    else {
      const k = shot.anchor ? 1 : 1 - Math.exp(-dt * 12);
      P.camPos.lerp(pos, k); P.camLook.lerp(target, 1 - Math.exp(-dt * 14));
    }
    cam.position.copy(P.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(P.camLook);
    const fov = shot.fov || 52;
    // long-lens shots zoom to keep the aircraft a readable size
    const dist = cam.position.distanceTo(pup.pos);
    // anchored shots zoom so the aircraft fills a set share of the frame (a long lens for wide shots)
    const K = { wide: 9, flyby: 3.2, boom: 4.5, low: 4 }[shot.kind] || 3.5;
    cam.fov = shot.anchor ? RJ.clamp((2 * Math.atan((len * K) / Math.max(dist, 1))) / RJ.DEG, 5, fov + 12) : fov;
    cam.updateProjectionMatrix();
    P.dof = shot.kind === "chase" ? null : [dist, Math.max(30, dist * 0.6), 0.75];
    $("rpl-shot").textContent = (P.shot === "director" ? "Director · " : "") + ({ chase: "Chase", side: "Side", flyby: "Flyby", wide: "Wide", low: "Low angle", landmark: "Landmark", boom: "Sonic boom", orbit: "Orbit" }[shot.kind] || shot.kind);
  }

  /* ---------------- per frame ---------------- */
  R.frame = function (dt) {
    const v = view();
    if (!P.paused) P.rt = Math.min(P.t1, P.rt + dt * P.speed * P.slow);
    const sdt = P.paused ? 0 : dt * P.speed * P.slow;
    if (P.rt >= P.t1 && !P.paused) { P.paused = true; renderReplayUI(); }
    // events crossed this frame (only when playing forward)
    if (P.rt > P.prevRt && P.rt - P.prevRt < 1) {
      for (const e of R.events) {
        if (e.t <= P.prevRt || e.t > P.rt) continue;
        if (e.type === "boom") { const p = P.pups.get(e.uid); if (p && p.mesh.visible) RJ.sonic.trigger(p); }
        else if (e.type === "exp") { RJ.fx.explosion(e.pos, e.big); RJ.audio.explosion(e.pos.distanceTo(v.camera.position), e.big); }
      }
    }
    P.prevRt = P.rt;
    // aircraft
    const list = [];
    for (const [uid, pup] of P.pups) {
      const s = sample(uid, P.rt, pup._s || (pup._s = {}));
      const show = !!s && s.state !== "dead";
      pup.mesh.visible = show;
      if (!show) { if (pup._cone) pup._cone.visible = false; continue; }
      applySample(pup, s, sdt);
      if (sdt > 0) pup.updateVisual(sdt); else pup.syncMesh();
      if (s.state === "falling" && sdt > 0 && Math.random() < sdt * 30) { RJ.fx.smoke(pup.pos, tv2.copy(pup.vel).multiplyScalar(0.05), 3 + pup.radius * 0.2, 0.15, 4, 0.7); RJ.fx.fire(pup.pos, tv2.copy(pup.vel).multiplyScalar(0.3), 2.5); }
      list.push(pup);
    }
    // missiles
    const F = R.frames, fi = findFrame(P.rt), f0 = F[fi], f1 = F[Math.min(fi + 1, F.length - 1)];
    const k = f1.t > f0.t ? RJ.clamp((P.rt - f0.t) / (f1.t - f0.t), 0, 1) : 0;
    const seen = new Set();
    for (const m of f0.ms) {
      const n = f1.ms.find((x) => x[0] === m[0]) || m;
      let mesh = P.mpups.get(m[0]);
      if (!mesh) { mesh = RJ.combat.missileTpl.clone(); RJ.scene.add(mesh); P.mpups.set(m[0], mesh); }
      mesh.visible = true; seen.add(m[0]);
      mesh.position.set(m[1] + (n[1] - m[1]) * k, m[2] + (n[2] - m[2]) * k, m[3] + (n[3] - m[3]) * k);
      const dir = tv2.set(n[1] - m[1], n[2] - m[2], n[3] - m[3]);
      if (dir.lengthSq() > 1e-4) mesh.quaternion.setFromUnitVectors(V3(0, 0, 1), dir.normalize().negate());
      const fl = mesh.getObjectByName("flame"); if (fl) fl.visible = !!m[4];
      if (m[4] && sdt > 0 && Math.random() < sdt * 40) RJ.fx.smoke(mesh.position, tv.set(0, 0, 0), 1.3, 0.9, 3.5, 0.6);
    }
    for (const [id, mesh] of P.mpups) if (!seen.has(id)) mesh.visible = false;
    placeCamera(dt, P.rt);
    const pup = focusPup();
    RJ.sonic.update(sdt, list);
    if (pup) RJ.world.update(Math.max(sdt, 1e-4), v.camera, pup.pos, pup.vel, pup.agl);
    RJ.fx.update(sdt, v.camera, v.renderer);
    if (pup) RJ.audio.update(pup, v.camera, false, list);
    const PF = RJ.post.fx;
    PF.motion = 0; PF.heat = []; PF.shocks = RJ.sonic.screenShocks(v.camera); PF.dof = P.dof;
    PF.flash = Math.max(0, PF.flash - dt * 2.2); PF.chroma = RJ.damp(PF.chroma, 0, 4, dt);
    v.renderWorld(dt);
    RJ.hud.clear();
    if (!P.dragging) $("rpl-seek").value = String(Math.round(((P.rt - P.t0) / Math.max(0.01, P.t1 - P.t0)) * 1000));
    $("rpl-time").textContent = `${RJ.fmtTime(P.rt - P.t0)} / ${RJ.fmtTime(P.t1 - P.t0)}${P.slow < 1 ? " · slow motion" : ""}`;
  };
  R.seek = function (t) {
    P.rt = RJ.clamp(t, P.t0, P.t1); P.prevRt = P.rt; P.shotObj = null; P.lastShot = null;
    RJ.fx.clear(); RJ.sonic.reset();
  };
  R.togglePause = function () { if (P.rt >= P.t1) R.seek(P.t0); P.paused = !P.paused; renderReplayUI(); };
  R.focusNext = function () {
    const live = [...P.pups.keys()].filter((u) => P.pups.get(u).mesh.visible);
    if (live.length < 2) return;
    P.focusUid = live[(live.indexOf(P.focusUid) + 1) % live.length];
    P.shotObj = null; P.lastShot = null;
    RJ.ui.toast(`Following ${R.meta.get(P.focusUid).callsign}`, 1500);
  };
  R.focusPuppet = () => (P.on ? focusPup() : null);

  function renderReplayUI() {
    $("rpl-play").textContent = P.paused ? "Play" : "Pause";
    $("rpl-speed").innerHTML = SPEEDS.map((s) => `<button class="chip" data-speed="${s}" aria-pressed="${P.speed === s}">${s}×</button>`).join("");
    $("rpl-shots").innerHTML = SHOTS.map(([id, n]) => `<button class="chip" data-shot="${id}" aria-pressed="${P.shot === id}">${n}</button>`).join("");
    $("rpl-target").hidden = R.meta.size < 2;
  }

  /* ======================= GHOSTS ======================= */
  const GH = (RJ.ghost = {});
  const ghostKey = (m) => "ghost:" + m.def.id;
  GH.enabled = () => RJ.settings.ghosts !== false;
  GH.begin = function (m) {
    m._gh = { rec: [], acc: 1, pup: null, best: null };
    const best = RJ.store.get(ghostKey(m), null);
    if (!best || !best.s || !RJ.AIRCRAFT[best.ac]) return;
    m._gh.best = best;
    m._gh.pup = makePuppet({ id: best.ac, team: "ghost", callsign: "Ghost" }, true);
    m._gh.pup.mesh.visible = GH.enabled();
  };
  GH.record = function (m, dt) {
    const g = m._gh; if (!g) return;
    g.acc += dt;
    const pl = m.player;
    if (g.acc >= 0.1 && pl.alive) {
      g.acc = 0;
      const r = (v, n) => Math.round(v * n) / n;
      g.rec.push(r(m.t, 100), r(pl.pos.x, 10), r(pl.pos.y, 10), r(pl.pos.z, 10), r(pl.q.x, 1000), r(pl.q.y, 1000), r(pl.q.z, 1000), r(pl.q.w, 1000), r(pl.gearT, 10), r(pl.abLevel, 10));
    }
    // fly the ghost
    const pup = g.pup, s = g.best && g.best.s;
    if (!pup) return;
    pup.mesh.visible = GH.enabled();
    const N = 10, n = s.length / N;
    if (!n) return;
    let lo = 0, hi = n - 1;
    if (m.t >= s[hi * N]) { pup.mesh.visible = false; return; }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid * N] <= m.t) lo = mid; else hi = mid; }
    const a = lo * N, b = hi * N, k = RJ.clamp((m.t - s[a]) / Math.max(1e-3, s[b] - s[a]), 0, 1);
    pup.pos.set(s[a + 1] + (s[b + 1] - s[a + 1]) * k, s[a + 2] + (s[b + 2] - s[a + 2]) * k, s[a + 3] + (s[b + 3] - s[a + 3]) * k);
    pup.q.set(s[a + 4], s[a + 5], s[a + 6], s[a + 7]).normalize().slerp(tq.set(s[b + 4], s[b + 5], s[b + 6], s[b + 7]).normalize(), k);
    RJ.setGear(pup.mesh, s[a + 8]);
    pup.syncMesh();
    // fade out when the ghost is right on top of the camera so it never blankets the view
    const cd = pup.pos.distanceTo(RJ.camera.position), len = pup.vis.dims.len;
    ghostMat.opacity = 0.34 * RJ.smooth(len * 1.2, len * 3.5, cd);
    pup.mesh.visible = GH.enabled() && ghostMat.opacity > 0.01;
  };
  GH.split = function (m, i, t) { if (m._gh) (m._gh.splits = m._gh.splits || [])[i] = t; };
  /** Seconds ahead (negative) or behind (positive) the ghost at the last checkpoint. */
  GH.delta = function (m) {
    const g = m._gh;
    if (!g || !g.best || !g.best.splits || m.def.metric !== "time" || !m.splits.length) return null;
    const i = m.splits.length - 1, b = g.best.splits[i];
    return b == null ? null : m.splits[i] - b;
  };
  GH.finish = function (m, value, save) {
    const g = m._gh; if (!g) return;
    if (save && g.rec.length > 20) {
      try { RJ.store.set(ghostKey(m), { ac: m.o.aircraft, value, splits: m.splits.slice(), s: g.rec }); }
      catch (e) { console.warn("ghost not saved", e); }
    }
    if (g.pup) g.pup.mesh.visible = false;
  };
  GH.end = function (m) { const g = m._gh; if (g && g.pup) { g.pup.dispose(); g.pup = null; } };
  GH.toggle = function () {
    RJ.settings.ghosts = !GH.enabled(); RJ.saveSettings();
    const m = RJ.game.mode;
    if (m && m._gh && m._gh.pup) m._gh.pup.mesh.visible = GH.enabled();
    RJ.ui.flash(GH.enabled() ? "GHOST ON" : "GHOST HIDDEN", m && m._gh && !m._gh.best ? "No best run saved yet for this challenge" : null, 1.2);
  };
  GH.has = (id) => !!RJ.store.get("ghost:" + id, null);

  /* ======================= PHOTO MODE ======================= */
  const PH = (RJ.photo = { on: false });
  PH.start = function (from) {
    if (PH.on) return;
    const v = view(), cam = v.camera;
    const focus = from === "replay" ? R.focusPuppet() : RJ.game.mode && RJ.game.mode.player;
    if (!focus) return;
    PH.on = true; PH.from = from; PH.focus = focus;
    PH.save = { fov: cam.fov, exposure: RJ.settings.exposure, env: Object.assign({}, RJ.world.env), sunElev: RJ.world.sunElev, sunAz: RJ.world.sunAz, pos: cam.position.clone(), q: cam.quaternion.clone() };
    const rel = cam.position.clone().sub(focus.pos);
    const len = focus.vis.dims.len, d = RJ.clamp(rel.length(), len * 1.5, len * 4 + 30);
    PH.s = { mode: "orbit", fov: RJ.clamp(cam.fov, 30, 70), sunElev: Math.round(RJ.world.sunElev), sunAz: Math.round(RJ.world.sunAz), exposure: RJ.settings.exposure || 1, dof: true, blur: 0.6, hideUI: false,
      yaw: Math.atan2(rel.x, rel.z), pitch: Math.asin(RJ.clamp(rel.y / d, -0.95, 0.95)), dist: d, free: { pos: cam.position.clone(), yaw: 0, pitch: 0 } };
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ"); PH.s.free.yaw = e.y; PH.s.free.pitch = e.x;
    PH.keys = new Set();
    RJ.state.mode = "photo";
    RJ.ui.hideAll(); RJ.ui.gameChrome(false); RJ.hud.clear();
    $("replay-ui").hidden = true; $("pip").hidden = true;
    if (RJ.audio.ctx) RJ.audio.ctx.suspend();
    renderPhotoUI();
    $("photo-ui").hidden = false;
  };
  PH.exit = function () {
    if (!PH.on) return;
    const v = view(), cam = v.camera, sv = PH.save;
    PH.on = false;
    $("photo-ui").hidden = true; $("photo-hint").hidden = true;
    cam.fov = sv.fov; cam.updateProjectionMatrix();
    RJ.settings.exposure = sv.exposure;
    if (Math.round(RJ.world.sunElev) !== Math.round(sv.sunElev) || Math.round(RJ.world.sunAz) !== Math.round(sv.sunAz)) RJ.world.setEnvironment(Object.assign({}, sv.env, { sunAz: sv.env.sunAz, sunElev: sv.env.sunElev }));
    RJ.post.fx.dof = null;
    v.resetClock();
    if (RJ.audio.ctx) RJ.audio.ctx.resume();
    if (PH.from === "replay") { RJ.state.mode = "replay"; $("replay-ui").hidden = false; }
    else if (PH.from === "paused") { RJ.state.mode = "paused"; RJ.ui.show("scr-pause"); if (RJ.audio.ctx) RJ.audio.ctx.suspend(); }
    else if (PH.from === "results") { RJ.state.mode = "results"; RJ.ui.show("scr-results"); }
    else { cam.position.copy(sv.pos); cam.quaternion.copy(sv.q); const pl = RJ.game.mode && RJ.game.mode.player; if (pl) v.resetCam(pl); RJ.state.mode = "playing"; RJ.ui.gameChrome(true); }
  };
  PH.frame = function (dt) {
    const v = view(), cam = v.camera, s = PH.s, f = PH.focus;
    if (s.mode === "orbit") {
      const d = s.dist;
      cam.position.set(f.pos.x + Math.sin(s.yaw) * Math.cos(s.pitch) * d, f.pos.y + Math.sin(s.pitch) * d, f.pos.z + Math.cos(s.yaw) * Math.cos(s.pitch) * d);
      keepAbove(cam.position, 1.5);
      cam.up.set(0, 1, 0); cam.lookAt(f.pos);
    } else {
      const fr = s.free, sp = (PH.keys.has("shift") ? 220 : 45) * dt;
      const fwd = V3(-Math.sin(fr.yaw) * Math.cos(fr.pitch), Math.sin(fr.pitch), -Math.cos(fr.yaw) * Math.cos(fr.pitch)), right = V3(Math.cos(fr.yaw), 0, -Math.sin(fr.yaw));
      if (PH.keys.has("w") || PH.keys.has("arrowup")) fr.pos.addScaledVector(fwd, sp);
      if (PH.keys.has("s") || PH.keys.has("arrowdown")) fr.pos.addScaledVector(fwd, -sp);
      if (PH.keys.has("d") || PH.keys.has("arrowright")) fr.pos.addScaledVector(right, sp);
      if (PH.keys.has("a") || PH.keys.has("arrowleft")) fr.pos.addScaledVector(right, -sp);
      if (PH.keys.has("e")) fr.pos.y += sp;
      if (PH.keys.has("q")) fr.pos.y -= sp;
      keepAbove(fr.pos, 1.5);
      cam.position.copy(fr.pos);
      cam.quaternion.setFromEuler(new THREE.Euler(fr.pitch, fr.yaw, 0, "YXZ"));
    }
    cam.fov = s.fov; cam.updateProjectionMatrix();
    RJ.settings.exposure = s.exposure;
    const PF = RJ.post.fx, dist = cam.position.distanceTo(f.pos);
    PF.motion = 0; PF.heat = []; PF.shocks = []; PF.flash = 0; PF.chroma = 0;
    PF.dof = s.dof ? [dist, Math.max(4, dist * (1.15 - s.blur)), 0.35 + s.blur * 0.65] : null;
    RJ.world.update(1e-4, cam, f.pos, f.vel, f.agl);
    v.renderWorld(1e-4);
    RJ.hud.clear();
  };
  PH.capture = function () {
    const v = view();
    PH.frame(0);
    let url;
    try { url = v.renderer.domElement.toDataURL("image/jpeg", 0.93); } catch (e) { RJ.ui.toast("Couldn't capture the image in this browser."); return; }
    const a = document.createElement("a");
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    a.download = `ridgeline-jets-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    a.href = url; document.body.appendChild(a); a.click(); a.remove();
    RJ.audio.click();
    RJ.ui.toast("Photo saved to your downloads.", 2200);
  };
  function setSun(el, az) {
    const env = Object.assign({}, RJ.world.env, { sunElev: el, sunAz: az });
    RJ.world.setEnvironment(env);
  }
  function renderPhotoUI() {
    const s = PH.s;
    const chip = (key, val, label) => `<button class="chip" data-ph="${key}" data-val="${val}" aria-pressed="${String(s[key]) === String(val)}">${label}</button>`;
    $("ph-cam").innerHTML = chip("mode", "orbit", "Orbit") + chip("mode", "free", "Free");
    $("ph-dof").innerHTML = chip("dof", "true", "On") + chip("dof", "false", "Off");
    $("ph-fov").value = s.fov; $("ph-sun").value = s.sunElev; $("ph-az").value = s.sunAz; $("ph-exp").value = s.exposure; $("ph-blur").value = s.blur;
    $("ph-blur-row").hidden = !s.dof;
    $("ph-keys").textContent = RJ.isTouch ? "Drag to look around · pinch to zoom" : s.mode === "orbit" ? "Drag to orbit · wheel to move closer · H hides this panel" : "Drag to look · W A S D to move, Q/E down/up, Shift faster · H hides this panel";
  }

  /* ======================= INPUT & UI WIRING ======================= */
  function wire() {
    // replay bar
    $("rpl-play").onclick = () => { RJ.audio.click(); R.togglePause(); };
    $("rpl-exit").onclick = () => { RJ.audio.click(); R.exit(); };
    $("rpl-target").onclick = () => { RJ.audio.click(); R.focusNext(); };
    $("rpl-photo").onclick = () => { RJ.audio.click(); P.paused = true; renderReplayUI(); PH.start("replay"); };
    $("rpl-speed").onclick = (e) => { const b = e.target.closest("[data-speed]"); if (!b) return; RJ.audio.click(); P.speed = +b.dataset.speed; renderReplayUI(); };
    $("rpl-shots").onclick = (e) => { const b = e.target.closest("[data-shot]"); if (!b) return; RJ.audio.click(); P.shot = b.dataset.shot; P.shotObj = null; renderReplayUI(); };
    const seek = $("rpl-seek");
    seek.addEventListener("pointerdown", () => (P.dragging = true));
    seek.addEventListener("pointerup", () => (P.dragging = false));
    seek.addEventListener("input", () => R.seek(P.t0 + (+seek.value / 1000) * (P.t1 - P.t0)));
    // photo panel
    $("ph-cam").onclick = $("ph-dof").onclick = (e) => {
      const b = e.target.closest("[data-ph]"); if (!b) return;
      RJ.audio.click();
      const k = b.dataset.ph, val = b.dataset.val;
      PH.s[k] = val === "true" ? true : val === "false" ? false : val;
      if (k === "mode" && val === "free") { const c = view().camera; PH.s.free.pos.copy(c.position); const e2 = new THREE.Euler().setFromQuaternion(c.quaternion, "YXZ"); PH.s.free.yaw = e2.y; PH.s.free.pitch = e2.x; }
      renderPhotoUI();
    };
    $("ph-fov").oninput = (e) => (PH.s.fov = +e.target.value);
    $("ph-exp").oninput = (e) => (PH.s.exposure = +e.target.value);
    $("ph-blur").oninput = (e) => (PH.s.blur = +e.target.value);
    let sunT = null;
    const sunInput = () => { PH.s.sunElev = +$("ph-sun").value; PH.s.sunAz = +$("ph-az").value; clearTimeout(sunT); sunT = setTimeout(() => setSun(PH.s.sunElev, PH.s.sunAz), 120); };
    $("ph-sun").oninput = sunInput; $("ph-az").oninput = sunInput;
    $("ph-save").onclick = () => PH.capture();
    $("ph-hide").onclick = () => { RJ.audio.click(); $("photo-ui").hidden = true; $("photo-hint").hidden = false; };
    $("photo-hint").onclick = () => { $("photo-ui").hidden = false; $("photo-hint").hidden = true; };
    $("ph-back").onclick = () => { RJ.audio.click(); PH.exit(); };
    // pointer: orbit/look in photo mode and orbit shot in replays
    const gl = $("gl"), pts = new Map();
    gl.addEventListener("pointerdown", (e) => { if (!PH.on && !(P.on && P.shot === "orbit")) return; gl.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    gl.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (pts.size === 2) {
        const arr = [...pts.values()]; const d0 = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        p.x = e.clientX; p.y = e.clientY;
        const arr2 = [...pts.values()]; const d1 = Math.hypot(arr2[0].x - arr2[1].x, arr2[0].y - arr2[1].y);
        zoom(d0 / Math.max(d1, 1));
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (PH.on) {
        const s = PH.s;
        if (s.mode === "orbit") { s.yaw -= dx * 0.006; s.pitch = RJ.clamp(s.pitch + dy * 0.005, -0.25, 1.45); }
        else { s.free.yaw -= dx * 0.004; s.free.pitch = RJ.clamp(s.free.pitch - dy * 0.004, -1.5, 1.5); }
      } else if (P.on) { P.orbit.yaw -= dx * 0.006; P.orbit.pitch = RJ.clamp(P.orbit.pitch + dy * 0.005, -0.3, 1.4); }
    });
    const up = (e) => pts.delete(e.pointerId);
    gl.addEventListener("pointerup", up); gl.addEventListener("pointercancel", up);
    function zoom(f) {
      if (PH.on) {
        const s = PH.s;
        if (s.mode === "orbit") s.dist = RJ.clamp(s.dist * f, PH.focus.vis.dims.len * 0.7, 2500);
        else s.free.pos.addScaledVector(V3(0, 0, -1).applyQuaternion(view().camera.quaternion), (1 - f) * 120);
      } else if (P.on && P.shot === "orbit") P.orbit.dist = RJ.clamp(P.orbit.dist * f, 0.4, 12);
    }
    gl.addEventListener("wheel", (e) => { if (!PH.on && !(P.on && P.shot === "orbit")) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
    // keyboard
    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (PH.on) {
        if (e.target && e.target.tagName === "INPUT") return;
        PH.keys.add(k === " " ? "space" : k);
        if (k === "escape" || k === RJ.settings.keys.photo) { e.preventDefault(); PH.exit(); }
        else if (k === "h") { const ui = $("photo-ui"); ui.hidden = !ui.hidden; $("photo-hint").hidden = !ui.hidden; }
        else if (k === "enter" || k === "f12" || k === "c") { e.preventDefault(); PH.capture(); }
        return;
      }
      if (P.on) {
        if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") return;
        if (k === " ") { e.preventDefault(); R.togglePause(); }
        else if (k === "escape" || k === RJ.settings.keys.replay) { e.preventDefault(); R.exit(); }
        else if (k === "arrowleft") { e.preventDefault(); R.seek(P.rt - 5); }
        else if (k === "arrowright") { e.preventDefault(); R.seek(P.rt + 5); }
        else if (k === "tab") { e.preventDefault(); R.focusNext(); }
        else if (k === RJ.settings.keys.photo) { P.paused = true; renderReplayUI(); PH.start("replay"); }
        else if (/^[1-6]$/.test(k)) { P.shot = SHOTS[+k - 1][0]; P.shotObj = null; renderReplayUI(); }
      }
    });
    addEventListener("keyup", (e) => { if (PH.on) PH.keys.delete(e.key.toLowerCase() === " " ? "space" : e.key.toLowerCase()); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})(window.RJ);
