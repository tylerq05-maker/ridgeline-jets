/* Ridgeline Jets — boot, game loop, cameras, post-processing inputs, cockpit overlay, boom replay,
 * hangar view, menu showcase and game lifecycle. */
(function (RJ) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const V3 = RJ.V3;
  RJ.state = { mode: "loading" };
  RJ.game = { mode: null, config: null, allowBombs: false };
  let renderer, scene, camera, clock;
  const tv = V3(), tv2 = V3(), tq = new THREE.Quaternion();

  /* ======================= GRAPHICS ======================= */
  RJ.applyGraphics = function () {
    const Q = RJ.world.QUALITY[RJ.settings.quality] || RJ.world.QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixel) * (RJ.perf ? RJ.perf.scale : 1));
    RJ.post.enabled = !!Q.post && RJ.post.ok;
    RJ.world.setQuality(RJ.settings.quality);
    camera.far = RJ.world.viewRange * 1.05 + 2000;
    camera.updateProjectionMatrix();
    resize();
  };
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    RJ.post.setSize(db.x, db.y);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (HV.cam) { HV.cam.aspect = w / h; HV.cam.updateProjectionMatrix(); }
    if (CP.cam) { CP.cam.aspect = w / h; CP.cam.updateProjectionMatrix(); }
    RJ.hud.resize();
  }

  /* ======================= CAMERA ======================= */
  const CAM_MODES = ["chase", "cockpit", "cinematic"];
  const cam = { mode: "chase", blend: 1, fromP: V3(), fromQ: new THREE.Quaternion(), offs: V3(0, 5, 30), up: V3(0, 1, 0), shake: 0, fov: 68, shotT: 0, shot: null, hidden: null, punch: 0, temp: null, base: 0 };
  RJ.cam = cam;
  cam.set = function (mode, instant) {
    cam.fromP.copy(camera.position); cam.fromQ.copy(camera.quaternion);
    cam.mode = mode; cam.blend = instant ? 1 : 0; cam.shotT = 0; cam.shot = null;
  };
  cam.cycle = function () { cam.temp = null; cam.set(CAM_MODES[(CAM_MODES.indexOf(cam.mode) + 1) % CAM_MODES.length]); RJ.ui.flash(cam.mode.toUpperCase() + " VIEW", null, 0.8); };
  cam.reset = function (focus) {
    const d = focus.vis.dims;
    cam.offs.set(0, Math.max(2.5, d.height * 0.9 + d.len * 0.08), d.len * 1.3 + d.span * 0.3 + 6).applyQuaternion(focus.q);
    cam.up.copy(focus.up);
  };
  cam.kick = (a) => { if (RJ.settings.shake) cam.shake = Math.min(2, cam.shake + a); };
  RJ.camKick = (a) => cam.kick(a);

  function chaseTarget(f, dt, outP, outQ) {
    const d = f.vis.dims;
    const upO = Math.max(2.5, d.height * 0.9 + d.len * 0.08), back = d.len * 1.3 + d.span * 0.3 + 6;
    const pull = f.state === "flying" ? RJ.clamp(f.g - 1, 0, 8) : 0;
    // longitudinal acceleration: the camera drops back when you light the burners, closes in on the brakes
    const acc = (f.speed - (cam.lastSpeed != null ? cam.lastSpeed : f.speed)) / Math.max(dt, 1e-3);
    cam.lastSpeed = f.speed;
    cam.accel = RJ.damp(cam.accel || 0, RJ.clamp(acc, -40, 40), 2.5, dt);
    const surge = RJ.clamp(cam.accel * 0.09, -1.5, 3.2) * Math.max(1, d.len / 18);
    // camera rides a little higher in hard pulls and lags more, so you see the jet carve the turn
    const want = tv.set(0, upO + pull * 0.22, back + pull * 0.35 + surge).applyQuaternion(f.q);
    cam.offs.lerp(want, 1 - Math.exp(-dt * (5.5 - Math.min(2.5, pull * 0.3))));
    cam.up.lerp(tv2.copy(f.up).lerp(V3(0, 1, 0), 0.25), 1 - Math.exp(-dt * 3.2)).normalize();
    outP.copy(f.pos).add(cam.offs);
    const look = tv2.copy(f.pos).addScaledVector(f.fwd, d.len * 2).addScaledVector(f.up, upO * 0.35);
    outQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(outP, look, cam.up));
  }
  function cockpitTarget(f, outP, outQ) {
    outP.copy(f.vis.cockpit); f.mesh.localToWorld(outP);
    outQ.copy(f.mesh.quaternion);
    if (RJ.settings.shake && f.alive) { const g = Math.max(0, Math.abs(f.g) - 3) * 0.004; outQ.multiply(tq.setFromEuler(new THREE.Euler(RJ.rand(-g, g), RJ.rand(-g, g), 0))); }
  }
  function newShot(f) {
    const d = f.vis.dims, types = ["flyby", "orbit", "tail", "wing", "flyby"];
    if (f.agl < 600) types.push("ground", "ground");
    const type = RJ.pick(types);
    const s = { type, t: 0, dur: RJ.rand(5, 8), side: Math.random() < 0.5 ? -1 : 1, a: Math.random() * 6.28 };
    if (type === "flyby" || type === "ground") {
      const ahead = RJ.clamp(f.speed * 3.5, 250, 1600);
      s.pos = f.pos.clone().addScaledVector(f.fwd, ahead).addScaledVector(f.right, s.side * RJ.rand(30, 90) * Math.max(1, d.len / 18)).addScaledVector(f.up, RJ.rand(-10, 25));
      if (type === "ground") s.pos.y = RJ.world.ground(s.pos.x, s.pos.z) + 4;
      s.pos.y = Math.max(s.pos.y, RJ.world.ground(s.pos.x, s.pos.z) + 3);
    }
    return s;
  }
  function cinematicTarget(f, dt, outP, outQ) {
    const d = f.vis.dims;
    cam.shotT -= dt;
    if (!cam.shot || cam.shotT <= 0 || (cam.shot.pos && cam.shot.pos.distanceTo(f.pos) > 2500)) { cam.shot = newShot(f); cam.shotT = cam.shot.dur; cam.blend = 1; }
    const s = cam.shot; s.t += dt;
    let fov = 45, look = f.pos;
    if (s.type === "flyby" || s.type === "ground") {
      outP.copy(s.pos);
      fov = RJ.clamp((2 * Math.atan((d.len * 2.6) / outP.distanceTo(f.pos))) / RJ.DEG, 6, 55);
    } else if (s.type === "orbit") {
      s.a += dt * 0.35;
      const r = Math.max(d.len, d.span) * 1.9;
      outP.copy(f.pos).add(tv.set(Math.cos(s.a) * r, d.height * 1.2 + r * 0.25, Math.sin(s.a) * r));
      fov = 50;
    } else if (s.type === "tail") {
      outP.copy(f.pos).add(tv.set(d.span * 0.3 * s.side, -d.height * 1.2, d.len * 5).applyQuaternion(f.q));
      fov = 26;
    } else {
      outP.copy(f.pos).add(tv.set(d.span * 0.62 * s.side, d.height * 0.55, -d.len * 0.15).applyQuaternion(f.q));
      look = tv2.copy(f.pos).addScaledVector(f.fwd, -d.len * 0.4);
      fov = 62;
    }
    outP.y = Math.max(outP.y, RJ.world.ground(outP.x, outP.z) + 2.5);
    const upv = s.type === "tail" || s.type === "wing" ? f.up : V3(0, 1, 0);
    outQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(outP, look, upv));
    return fov;
  }
  /** Boom replay shot: orbits with the jet from the front quarter round to the side, so the cone stays framed. */
  const _ob = V3();
  function orbitShot(f, k, side, outP) {
    const d = f.vis.dims, D = d.len * 2.6 + 14;
    const a = RJ.lerp(0.45, 2.0, k * k * (3 - 2 * k));
    const fh = _ob.copy(f.fwd).setY(0); if (fh.lengthSq() < 1e-4) fh.set(0, 0, -1); fh.normalize();
    outP.copy(f.pos).addScaledVector(fh, Math.cos(a) * D);
    outP.x += -fh.z * side * Math.sin(a) * D; outP.z += fh.x * side * Math.sin(a) * D;
    outP.y += D * RJ.lerp(0.12, 0.3, k);
    outP.y = Math.max(outP.y, RJ.world.ground(outP.x, outP.z) + 4);
    return outP;
  }
  function boomShot(f, outP, outQ) {
    const T = cam.temp;
    orbitShot(f, 1 - T.t / T.dur, T.side, outP);
    outQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(outP, _ob.copy(f.pos).addScaledVector(f.fwd, -f.vis.dims.len * 0.6), V3(0, 1, 0)));
    return 46;
  }
  const cp = V3(), cq = new THREE.Quaternion();
  cam.update = function (dt, f) {
    let fov = RJ.settings.fov;
    let mode = cam.mode;
    if (f.state === "falling" || f.state === "dead") mode = "death";
    if (cam.temp) { cam.temp.t -= dt; if (cam.temp.t <= 0 || mode === "death") { cam.temp = null; cam.set(cam.mode); } else mode = "boom"; }
    if (mode === "chase") {
      chaseTarget(f, dt, cp, cq);
      fov += RJ.clamp((f.mach - 0.6) * 6, 0, 10) + f.abLevel * 5 + (f.isPlayer ? RJ.camFx.fov : 0);
    } else if (mode === "cockpit") {
      cockpitTarget(f, cp, cq);
      fov += 4 + f.abLevel * 4 + (f.isPlayer ? RJ.camFx.fov * 0.6 : 0);
    } else if (mode === "cinematic") {
      fov = cinematicTarget(f, dt, cp, cq);
    } else if (mode === "boom") {
      fov = boomShot(f, cp, cq);
    } else {
      cam.deathA = (cam.deathA || 0) + dt * 0.3;
      const r = 70 + f.radius * 3;
      cp.copy(f.pos).add(tv.set(Math.cos(cam.deathA) * r, 30 + r * 0.3, Math.sin(cam.deathA) * r));
      cp.y = Math.max(cp.y, RJ.world.ground(cp.x, cp.z) + 10);
      cq.setFromRotationMatrix(new THREE.Matrix4().lookAt(cp, f.pos, V3(0, 1, 0)));
    }
    if (cam.blend < 1) {
      cam.blend = Math.min(1, cam.blend + dt / 0.28);
      const e = cam.blend * cam.blend * (3 - 2 * cam.blend);
      camera.position.copy(cam.fromP).lerp(cp, e);
      camera.quaternion.copy(cam.fromQ).slerp(cq, e);
    } else { camera.position.copy(cp); camera.quaternion.copy(cq); }
    const gy = RJ.world.ground(camera.position.x, camera.position.z) + 1.5;
    if (camera.position.y < gy) camera.position.y = gy;
    // shake: kicks (boom, blasts, hits) + continuous (afterburner, guns, G, transonic buffet, low-level turbulence)
    if (RJ.settings.shake && f.alive) {
      let s = cam.shake + cam.base + (f.isPlayer ? RJ.camFx.shake : 0) + (RJ.cannon ? RJ.cannon.shake * 0.6 : 0) + f.abLevel * 0.05 + (f.firing ? 0.12 : 0) + Math.max(0, Math.abs(f.g) - 5) * 0.02;
      if (mode === "cinematic" || mode === "boom") s *= 0.25;
      if (s > 0.001) {
        const k = s * (mode === "cockpit" ? 0.0045 : 0.008);
        camera.quaternion.multiply(tq.setFromEuler(new THREE.Euler(RJ.rand(-k, k), RJ.rand(-k, k), RJ.rand(-k, k) * 0.5)));
      }
    }
    cam.shake = Math.max(0, cam.shake - dt * 1.4);
    cam.punch = Math.max(0, cam.punch - dt * 9);
    cam.fov = RJ.damp(cam.fov, fov, mode === "cinematic" ? 3 : 4, dt);
    camera.fov = cam.fov + cam.punch; camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const inPit = mode === "cockpit" && cam.blend > 0.6;
    if (cam.hidden && cam.hidden !== f) { cam.hidden.mesh.visible = cam.hidden.state !== "dead"; cam.hidden = null; }
    if (inPit) { f.mesh.visible = false; cam.hidden = f; } else if (cam.hidden === f) { f.mesh.visible = f.state !== "dead"; cam.hidden = null; }
    return mode;
  };

  /* ======================= COCKPIT OVERLAY ======================= */
  const CP = { scene: null, cam: null, pit: null, owner: null, light: null };
  function initCockpit() {
    CP.scene = new THREE.Scene();
    CP.cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 10);
    CP.amb = new THREE.HemisphereLight(0x9fb0c8, 0x202020, 0.6);
    CP.light = new THREE.DirectionalLight(0xffffff, 1);
    CP.scene.add(CP.amb, CP.light);
  }
  function cockpitOverlay(pl, dt) {
    if (CP.owner !== pl) {
      if (CP.pit) CP.scene.remove(CP.pit.group);
      CP.pit = RJ.buildCockpit(pl.id); CP.scene.add(CP.pit.group); CP.owner = pl;
    }
    CP.pit.update(pl, dt);
    CP.cam.fov = camera.fov; CP.cam.updateProjectionMatrix();
    const W = RJ.world;
    CP.light.position.copy(W.sunDir).applyQuaternion(tq.copy(camera.quaternion).invert()).multiplyScalar(5);
    CP.light.color.copy(W.sun.color); CP.light.intensity = (W.sunIntensity || 1) * 0.9;
    CP.amb.intensity = 0.6 + (W.hemiIntensity || 0.5) * 0.5;
    return [{ scene: CP.scene, camera: CP.cam }];
  }

  /* ======================= BOOM REPLAY (picture in picture) ======================= */
  const PIP = { t: 0, dur: 3.4, side: 1, cam: new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 30000), target: null };
  PIP.cam.layers.enable(1); PIP.cam.layers.enable(RJ.LATE); PIP.cam.layers.enable(2);
  function startReplay(ac, center) {
    const mode = RJ.settings.boomCam;
    if (mode === "off") return;
    const side = Math.random() < 0.5 ? -1 : 1;
    if (mode === "full") { cam.temp = { t: 2.8, dur: 2.8, side }; cam.blend = 1; return; }
    PIP.t = PIP.dur = 3.4; PIP.side = side; PIP.target = ac;
  }
  /** A scripted inset shot (e.g. the Grand Cannon firing): fn(camera, progress 0..1) places the camera. */
  RJ.pipShot = function (fn, dur) {
    if (RJ.settings.boomCam === "off" || (PIP.t > 0.5 && PIP.target)) return false;
    PIP.t = PIP.dur = dur; PIP.shot = fn; PIP.target = null; return true;
  };
  function renderPip(dt) {
    const el = $("pip");
    if (PIP.t <= 0 || (!PIP.target && !PIP.shot)) { PIP.shot = null; if (!el.hidden) el.hidden = true; return; }
    PIP.t -= dt;
    const W = innerWidth, H = innerHeight;
    const w = Math.round(Math.min(380, W * 0.34)), h = Math.round(w * 9 / 16);
    const x = W - w - 16, top = 74;
    el.hidden = false;
    el.style.left = x + "px"; el.style.top = top + "px"; el.style.width = w + "px"; el.style.height = h + "px";
    el.style.opacity = RJ.clamp(PIP.t / 0.4, 0, 1);
    const f = PIP.target;
    if (f) {
      orbitShot(f, 1 - PIP.t / PIP.dur, PIP.side, PIP.cam.position);
      PIP.cam.lookAt(_ob.copy(f.pos).addScaledVector(f.fwd, -f.vis.dims.len * 0.6));
    } else PIP.shot(PIP.cam, 1 - PIP.t / PIP.dur);
    PIP.cam.fov = 46;
    PIP.cam.aspect = w / h; PIP.cam.far = camera.far; PIP.cam.updateProjectionMatrix();
    const hidden = f && !f.mesh.visible;
    if (hidden) f.mesh.visible = true;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, H - top - h, w, h); renderer.setScissor(x, H - top - h, w, h);
    renderer.setScissorTest(true);
    renderer.render(scene, PIP.cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    if (hidden) f.mesh.visible = false;
  }

  /* ======================= POST INPUTS ======================= */
  function postInputs(pl, focus, camMode, dt) {
    const P = RJ.post.fx;
    const tanH = Math.tan((camera.fov * RJ.DEG) / 2);
    // radial speed blur, strongest flying fast and low
    const sp = RJ.clamp((focus.speed - 260) / 700, 0, 1);
    const low = 1 - RJ.smooth(30, 450, focus.agl);
    let motion = (camMode === "chase" || camMode === "cockpit") && focus.state === "flying" ? sp * (0.012 + 0.022 * low) : 0;
    if (focus.spec.flight.model === "space" && focus.state === "flying") motion += RJ.smooth(800, 2300, focus.speed) * 0.012 + (focus.hyperK || 0) * 0.05;
    P.motion = RJ.damp(P.motion, motion, 3, dt);
    const ahead = tv.copy(focus.pos).addScaledVector(focus.vel, 3).project(camera);
    P.motionCenter = [RJ.clamp((ahead.x + 1) / 2, 0.2, 0.8), RJ.clamp((ahead.y + 1) / 2, 0.2, 0.8)];
    // heat haze behind the nozzles
    P.heat = [];
    if (camMode !== "cockpit" && focus.state === "flying" && focus.mesh.visible) {
      for (const f of focus.vis.flames) {
        if (P.heat.length >= 4 || (f.small && focus.spec.flight.model !== "space")) continue;
        const wp = focus.mesh.localToWorld(tv.copy(f.flame.position).add(tv2.set(0, 0, f.r * 3.5)));
        const dist = wp.distanceTo(camera.position);
        const s = tv2.copy(wp).project(camera);
        if (s.z > 1 || Math.abs(s.x) > 1.2 || Math.abs(s.y) > 1.2) continue;
        const rad = (f.r * 3 / dist) / (2 * tanH);
        const k = ((focus.spool == null ? focus.throttle : focus.spool) * 0.45 + focus.abLevel * (1.1 + (1 - RJ.atmo(focus.pos.y).delta) * 0.4) + (focus.hyperK || 0) * 1.5) * RJ.clamp(90 / dist, 0, 1);
        if (k > 0.02) P.heat.push([(s.x + 1) / 2, (s.y + 1) / 2, Math.max(rad, 0.01), k]);
      }
    }
    // rocket motors close to the camera shimmer the air behind them too
    for (const m of RJ.combat.missiles) {
      if (P.heat.length >= 4 || !m.lit || m.t > m.burn) continue;
      const dist = m.pos.distanceTo(camera.position);
      if (dist > 350) continue;
      const wp = tv.copy(m.vel).normalize().multiplyScalar(-4).add(m.pos), s = tv2.copy(wp).project(camera);
      if (s.z > 1 || Math.abs(s.x) > 1.1 || Math.abs(s.y) > 1.1) continue;
      P.heat.push([(s.x + 1) / 2, (s.y + 1) / 2, Math.max((2.5 / dist) / (2 * tanH), 0.008), RJ.clamp(60 / dist, 0.1, 0.9)]);
    }
    // sun on screen for shafts and lens flare (fades near the frame edge and when the sun is low or gone)
    const W = RJ.world, sd = W.sunDir;
    P.sun = null;
    if (W.sunElev > -2 && !W.underwater && RJ.settings.quality !== "low") {
      const sp = tv.copy(camera.position).addScaledVector(sd, 10000).project(camera);
      const inFront = tv2.copy(sd).dot(tv.set(0, 0, -1).applyQuaternion(camera.quaternion)) > 0;
      if (inFront && Math.abs(sp.x) < 1.4 && Math.abs(sp.y) < 1.4) {
        const edge = 1 - RJ.smooth(0.9, 1.4, Math.max(Math.abs(sp.x), Math.abs(sp.y)));
        const c = W.sun.color, k = RJ.smooth(-2, 6, W.sunElev) * (1 - (W.inCloud || 0)) * edge;
        const wx = W.WEATHER[W.env.weather] || {};
        P.sun = [(sp.x + 1) / 2, (sp.y + 1) / 2, k, c.r, c.g, c.b, 0.55 * (1 - (wx.dark || 0)), camMode === "cockpit" ? 0.6 : 1.0];
      }
    }
    if (RJ.cannon) RJ.cannon.screenFx(P, camera);
    RJ.sonic.screenHeat(P, camera, focus);
    P.shocks = RJ.sonic.screenShocks(camera);
    P.flash = Math.max(0, P.flash - dt * 2.2);
    P.chroma = RJ.damp(P.chroma, 0, 4, dt);
    // depth of field only for the cinematic and replay cameras
    if (camMode === "cinematic" || camMode === "boom") { const dd = camera.position.distanceTo(focus.pos); P.dof = [dd, Math.max(30, dd * 0.7), 0.85]; }
    else P.dof = null;
  }

  /* ======================= HANGAR VIEW ======================= */
  const HV = { scene: null, cam: null, model: null, id: null, size: 20 };
  RJ.hangarView = HV;
  HV.init = function () {
    HV.scene = new THREE.Scene();
    HV.scene.background = new THREE.Color(0x0b1016);
    HV.scene.fog = new THREE.Fog(0x0b1016, 160, 520);
    HV.cam = new THREE.PerspectiveCamera(32, 1, 0.5, 2000); HV.cam.layers.enable(RJ.LATE);
    HV.scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x1a1c20, 0.35));
    HV.key = new THREE.DirectionalLight(0xffe7cf, 1.6); HV.key.position.set(40, 70, 30);
    HV.key.castShadow = true; HV.key.shadow.mapSize.set(2048, 2048);
    const sc = HV.key.shadow.camera; sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 10; sc.far = 220;
    HV.scene.add(HV.key, HV.key.target);
    const rim = new THREE.DirectionalLight(0x8ab8ff, 0.9); rim.position.set(-50, 30, -60); HV.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; HV.scene.add(floor);
    for (let i = 1; i <= 12; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(i * 9, i * 9 + 0.12, 96), new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? 0xffb81c : 0x2a3440, transparent: true, opacity: i % 4 === 0 ? 0.35 : 0.6 }));
      r.rotation.x = -Math.PI / 2; r.position.y = 0.02; HV.scene.add(r);
    }
    // studio environment for reflections: dark room with bright softbox panels
    try {
      const studio = new THREE.Scene();
      studio.add(new THREE.Mesh(new THREE.BoxGeometry(100, 60, 100), new THREE.MeshBasicMaterial({ color: 0x14181e, side: THREE.BackSide })));
      const panel = (w, h, x, y, z, ry, c) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); p.position.set(x, y, z); p.rotation.y = ry; studio.add(p); return p; };
      const top = panel(50, 18, 0, 29, 0, 0, 0xffffff); top.rotation.x = Math.PI / 2;
      panel(30, 14, -49, 12, 0, Math.PI / 2, 0xbfd8ff);
      panel(30, 14, 49, 12, 0, -Math.PI / 2, 0xffe4c4);
      panel(60, 6, 0, 6, -49, 0, 0x9ab0c8);
      const pm = new THREE.PMREMGenerator(renderer);
      HV.scene.environment = pm.fromScene(studio, 0.03).texture;
      pm.dispose();
    } catch (e) { console.warn(e); }
  };
  HV.setAircraft = function (id) {
    if (HV.model) { HV.scene.remove(HV.model); HV.model.traverse((o) => { if (o.geometry && o.geometry.type !== "ConeGeometry") o.geometry.dispose(); }); }
    HV.id = id;
    HV.model = RJ.buildAircraft(id, (RJ.settings.paint || {})[id] || null);
    const d = HV.model.userData.dims;
    HV.size = Math.max(d.len, d.span);
    HV.model.position.y = d.gearH || d.height * 0.5 + 1.8;
    HV.model.userData.flames.forEach((f) => { f.flame.visible = false; f.glow.material.opacity = 0.25; });
    HV.model.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    const sc = HV.key.shadow.camera, half = HV.size * 0.75 + 6;
    sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix();
    HV.scene.add(HV.model);
  };
  HV.render = function (dt) {
    const h = RJ.ui.hangar;
    if (h.auto) h.yaw += dt * 0.22;
    if (HV.model) for (const p of HV.model.userData.props) p.hub.rotation.z += dt * 2;
    const r = HV.size * 1.55 * h.dist + 6;
    const target = V3(0, HV.model ? HV.model.position.y * 0.8 : 3, 0);
    HV.cam.position.set(Math.sin(h.yaw) * Math.cos(h.pitch) * r, target.y + Math.sin(h.pitch) * r, Math.cos(h.yaw) * Math.cos(h.pitch) * r);
    HV.cam.lookAt(target);
    const el = $("hg-view").getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    if (el.width > 10) HV.cam.setViewOffset(W, H, W / 2 - (el.left + el.width / 2), H / 2 - (el.top + el.height / 2), W, H);
    HV.cam.updateProjectionMatrix();
    const P = RJ.post.fx;
    P.motion = 0; P.heat = []; P.shocks = []; P.flash = 0;
    P.dof = [r, Math.max(10, HV.size * 1.2), 0.6];
    RJ.post.render(HV.scene, HV.cam, null, { exposure: 1.05, sat: 1.04, contrast: 1.06, tint: [1, 1, 1], bloom: 0.45 }, dt);
  };

  /* ======================= MENU SHOWCASE ======================= */
  /* Main-menu backdrop: a six-ship Delta of blue-and-gold Super Hornets (a tribute to the US Navy Blue Angels)
   * trailing white smoke. Each pass is scripted as a rigid formation; three shots alternate: crowd-line pan,
   * air-to-air from the wing, and an overhead pass straight above the camera. */
  const show = { jets: null, t: 0, pass: 0, c: V3(), yaw: 0, alt: 0, smokeT: 0 };
  const DELTA = [[0, 0, 0], [10, -0.6, 12], [-10, -0.6, 12], [0, -1.3, 24], [20, -1.2, 24], [-20, -1.2, 24]]; // x right, y up, z behind (m)
  const PASS_T = 11, SPEED = 175;
  const fq = new THREE.Quaternion(), fq2 = new THREE.Quaternion(), fv = V3(), fv2 = V3(), fv3 = V3(), fm = new THREE.Matrix4();
  RJ._show = show; // test hook
  function disposeShow() { if (show.jets) for (const j of show.jets) j.dispose(); show.jets = null; }
  function makeShowcase(pos, yaw) {
    disposeShow();
    show.jets = DELTA.map(() => {
      const j = new RJ.Aircraft("fa18e", { team: "blue", livery: "blueangels" });
      j.place(pos.clone(), yaw, SPEED); j.throttle = 0.72; j.gearDown = false;
      return j;
    });
    show.c.copy(pos); show.yaw = yaw; show.t = 0; show.pass = 0;
    newPass();
  }
  function newPass() {
    // track through the prepared area; check the terrain along it and keep 140 m above the highest point
    if (show.pass > 0) show.yaw += 2.1; // a new heading each pass
    const dir = fv.set(-Math.sin(show.yaw), 0, -Math.cos(show.yaw));
    // clear the highest ground along the track and the camera corridor beside it, so no ridge blocks the view
    let hi = 0;
    for (let d = -PASS_T * SPEED * 0.6; d <= PASS_T * SPEED * 0.6; d += 150) for (const off of [-350, 0, 350]) hi = Math.max(hi, RJ.world.ground(show.c.x + dir.x * d - dir.z * off, show.c.z + dir.z * d + dir.x * off));
    show.alt = hi + 260;
    show.prev = null;
    show.shot = show.pass % 3; show.t = 0;
  }
  function formationAt(t, outP, outQ) {
    const turn = show.shot === 1 ? 0.035 : 0; // the air-to-air pass is a gentle banked turn
    const yaw = show.yaw + turn * (t - PASS_T / 2);
    const d = (t - PASS_T / 2) * SPEED;
    const dir = fv3.set(-Math.sin(show.yaw), 0, -Math.cos(show.yaw));
    outP.set(show.c.x + dir.x * d, show.alt + Math.sin(t * 0.6) * 3, show.c.z + dir.z * d);
    outQ.setFromAxisAngle(fv2.set(0, 1, 0), yaw).multiply(fq2.setFromAxisAngle(fv2.set(0, 0, 1), -Math.atan(SPEED * turn / RJ.G0)));
  }
  function menuFrame(dt) {
    if (!show.jets) { RJ.post.render(scene, camera, null, RJ.world.grade, dt, { world: true }); return; }
    show.t += dt;
    if (show.t > PASS_T) { show.pass++; newPass(); }
    const P = V3(), Q = new THREE.Quaternion();
    formationAt(show.t, P, Q);
    const fwd = V3(0, 0, -1).applyQuaternion(Q), right = V3(1, 0, 0).applyQuaternion(Q), up = V3(0, 1, 0).applyQuaternion(Q);
    const prev = show.prev || (show.prev = show.jets.map(() => null));
    show.jets.forEach((j, i) => {
      const o = DELTA[i], w = show.t * 1.3 + i * 1.7; // tiny station-keeping wobble
      j.pos.copy(P).addScaledVector(right, o[0] + Math.sin(w) * 0.25).addScaledVector(up, o[1] + Math.sin(w * 1.3) * 0.18).addScaledVector(fwd, -o[2] + Math.sin(w * 0.7) * 0.3);
      j.q.copy(Q); j.updateBasis();
      j.vel.copy(fwd).multiplyScalar(SPEED); j.speed = SPEED; j.state = "flying";
      j.updateVisual(dt);
      // continuous smoke: fill the gap since last frame so the trail is a ribbon, not a string of beads
      const tail = V3().copy(j.pos).addScaledVector(fwd, -9);
      if (prev[i]) {
        const gap = prev[i].distanceTo(tail), n = Math.min(40, Math.ceil(gap / 2.5));
        for (let k = 1; k <= n; k++) RJ.fx.smoke(fv.lerpVectors(prev[i], tail, k / n), fv2.copy(fwd).multiplyScalar(SPEED * 0.04), 2.6, 0.96, 7, 0.45);
      }
      prev[i] = tail;
    });
    // camera shots
    const lead = show.jets[0].pos, mid = fv3.copy(P).addScaledVector(fwd, -12);
    let fov = 38;
    if (show.shot === 0) {
      // crowd line: a fixed point 280 m off the track, panning as the Delta roars past
      const side = fv.set(-Math.sin(show.yaw), 0, -Math.cos(show.yaw)).cross(fv2.set(0, 1, 0));
      camera.position.set(show.c.x + side.x * 190, show.alt - 35, show.c.z + side.z * 190);
      const d = camera.position.distanceTo(mid);
      fov = RJ.clamp(2 * Math.atan(70 / d) / RJ.DEG, 9, 50);
      camera.lookAt(mid);
    } else if (show.shot === 1) {
      // air-to-air: camera ship flying off the right wing, slightly behind and above
      camera.position.copy(P).addScaledVector(right, 48 + Math.sin(show.t * 0.3) * 6).addScaledVector(fwd, -30 + show.t * 2.5).addScaledVector(up, 9);
      camera.up.copy(up);
      camera.lookAt(mid);
      camera.up.set(0, 1, 0);
      fov = 42;
    } else {
      // overhead: camera on the track, low, looking up as the formation passes straight over
      const dir = fv.set(-Math.sin(show.yaw), 0, -Math.cos(show.yaw));
      camera.position.set(show.c.x + dir.x * 120, show.alt - 70, show.c.z + dir.z * 120);
      const d = camera.position.distanceTo(mid);
      fov = RJ.clamp(2 * Math.atan(55 / d) / RJ.DEG, 14, 60);
      camera.lookAt(mid);
    }
    const gy = RJ.world.ground(camera.position.x, camera.position.z) + 3;
    if (camera.position.y < gy) { camera.position.y = gy; camera.lookAt(mid); }
    camera.fov = RJ.damp(camera.fov, fov, 6, dt); camera.updateProjectionMatrix();
    // the menu panel covers the left third: frame the formation in the open space on the right
    if (innerWidth > 700) camera.rotateY(camera.fov * RJ.DEG * camera.aspect * (show.shot === 1 ? 0.1 : 0.26));
    camera.updateMatrixWorld();
    const s = show.jets[0];
    RJ.world.update(dt, camera, s.pos, s.vel, s.pos.y - RJ.world.ground(s.pos.x, s.pos.z));
    RJ.fx.update(dt, camera, renderer);
    postInputs(s, s, "cinematic", dt);
    RJ.post.fx.dof = null;
    RJ.world.renderCloudShadow(renderer, camera);
    RJ.world.renderReflection(renderer, camera);
    RJ.post.render(scene, camera, null, RJ.world.grade, dt, { world: true });
    RJ.hud.clear();
  }

  /* ======================= GAME LIFECYCLE ======================= */
  function setLoad(p, text) { $("load-bar").style.width = Math.round(p * 100) + "%"; if (text) $("load-text").textContent = text; }
  function stopCurrent() {
    if (RJ.photo.on) RJ.photo.exit();
    if (RJ.replay.active()) RJ.replay.exit();
    RJ.replay.reset();
    if (RJ.game.mode) { RJ.game.mode.dispose(); RJ.game.mode = null; }
    RJ.combat.reset();
    RJ.sonic.reset();
    RJ.audio.stopEngines();
    if (RJ.lever) RJ.lever.hideFx(); if (RJ.nav) RJ.nav.reset();
    if (RJ.companion) RJ.companion.stop();
    cam.hidden = null; cam.temp = null; PIP.t = 0; PIP.target = null; CP.owner = null;
  }
  RJ.startGame = async function (kind, opts) {
    RJ.audio.init();
    RJ.game.config = { kind, opts: Object.assign({}, opts) };
    stopCurrent();
    disposeShow();
    RJ.state.mode = "loading";
    RJ.ui.gameChrome(false);
    RJ.ui.show("scr-loading");
    setLoad(0, kind === "mp" ? "Joining your squad…" : kind === "fight" ? "Briefing pilots and generating the arena…" : kind === "challenge" ? "Laying out the course…" : "Generating terrain…");
    RJ.fx.clear();
    const mode = kind === "mp" ? new RJ.mp.Multi(opts) : kind === "free" ? new RJ.modes.FreeFlight(opts) : kind === "challenge" ? new RJ.challenges.Challenge(opts) : RJ.modes.isMission(opts.match) ? new RJ.modes.Mission(opts) : opts.match === "war" && RJ.modes.AirWar ? new RJ.modes.AirWar(opts) : new RJ.modes.Dogfight(opts);
    RJ.game.mode = mode;
    try { await mode.setup((p) => setLoad(p)); }
    catch (e) { console.error(e); RJ.ui.toast("Couldn't start the flight: " + e.message); RJ.quitToMenu(); return; }
    RJ.ui.hideAll();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    RJ.ui.gameChrome(true);
    cam.set(RJ.settings.cam, true);
    cam.reset(mode.player);
    RJ.lever.reset(mode.player); RJ.nav.reset(); RJ.sim.reset();
    cam.fov = RJ.settings.fov;
    RJ.state.mode = "playing";
    RJ.input.keys.clear();
    clock.getDelta();
    RJ.audio.welcome(kind);
    if (RJ.companion) RJ.companion.start(kind);
  };
  RJ.restartGame = function () { const c = RJ.game.config; if (c) RJ.startGame(c.kind, c.opts); };
  RJ.quitToMenu = async function () {
    stopCurrent();
    RJ.ui.gameChrome(false);
    RJ.hud.clear();
    $("pip").hidden = true;
    if (RJ.audio.ctx && RJ.audio.ctx.state === "suspended") RJ.audio.ctx.resume();
    RJ.state.mode = "loading";
    RJ.ui.show("scr-loading"); setLoad(0, "Returning to base…");
    if (RJ.world.airbase) RJ.world.setAirbase(null);
    RJ.world.setEnvironment({ time: "golden", weather: "scattered" });
    const reg = RJ.world.findRegion("mountains");
    const pos = V3(reg.x, RJ.modes.highestAround(reg.x, reg.z, 2500, 4) + 450, reg.z);
    await RJ.world.prepare(pos, (p) => setLoad(p));
    makeShowcase(pos, reg.yaw);
    RJ.state.mode = "menu";
    RJ.ui.refreshMain();
    const back = RJ.ui.returnTo; RJ.ui.returnTo = null;
    if (back === "scr-chal") { RJ.ui.renderChal(); RJ.ui.show("scr-chal"); }
    else if (back === "scr-mp" || RJ.mp.inLobby()) { RJ.ui.renderMP(); RJ.ui.show("scr-mp"); }
    else RJ.ui.show("scr-main");
  };
  RJ.pause = function () {
    if (RJ.state.mode !== "playing") return;
    RJ.state.mode = "paused";
    RJ.audio.setGun(false); RJ.audio.tone(null); RJ.audio.warn(null);
    if (RJ.audio.ctx) RJ.audio.ctx.suspend();
    const m = RJ.game.mode;
    $("pz-info").textContent = m ? (m.kind === "free" ? "Free Flight" : m.kind === "challenge" ? m.def.name : "Dogfight") + " · " + m.player.spec.name : "";
    RJ.ui.show("scr-pause");
  };
  RJ.resume = function () {
    if (RJ.state.mode !== "paused") return;
    RJ.ui.hideAll();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (RJ.audio.ctx) RJ.audio.ctx.resume();
    RJ.state.mode = "playing";
    RJ.input.keys.clear();
    clock.getDelta();
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) RJ.pause(); });

  /* ======================= PLAY FRAME ======================= */
  let gStress = 0, gloc = 0, dmgFlash = 0, lastOverlays = null;
  /* Fixed-timestep simulation: physics, AI and weapons always step at SIM_DT whatever the frame rate, so the
   * aircraft fly identically at 30, 60 or 240 fps. Rendering then shows each aircraft interpolated between its
   * last two physics states (alpha = leftover time / SIM_DT), and the true state is restored before the next step. */
  const SIM_DT = 1 / 120, SIM_MAX = 6;
  let simAcc = 0;
  function restoreSim() {
    // put back the true physics state, unless something outside the sim moved the aircraft meanwhile (respawn, reset)
    for (const a of RJ.combat.aircraft) if (a._interp) { if (a.pos.equals(a._ip) && a.q.equals(a._iq)) { a.pos.copy(a._sp); a.q.copy(a._sq); a.updateBasis(); } else a._hasPrev = false; a._interp = false; }
  }
  function snapPrev() {
    for (const a of RJ.combat.aircraft) { if (!a._pp) { a._pp = V3(); a._pq = new THREE.Quaternion(); a._sp = V3(); a._sq = new THREE.Quaternion(); a._ip = V3(); a._iq = new THREE.Quaternion(); } a._pp.copy(a.pos); a._pq.copy(a.q); a._hasPrev = true; }
  }
  function applyInterp(alpha) {
    for (const a of RJ.combat.aircraft) {
      if (!a._hasPrev || a.state === "dead" || a._pp.distanceToSquared(a.pos) > 250000) continue; // skip respawns/teleports
      a._sp.copy(a.pos); a._sq.copy(a.q);
      a.pos.lerpVectors(a._pp, a._sp, alpha); a.q.copy(a._pq).slerp(a._sq, alpha); a.updateBasis();
      a._ip.copy(a.pos); a._iq.copy(a.q); a._interp = true;
      if (a.mesh && a.state !== "dead") a.syncMesh();
    }
  }
  RJ.sim = { dt: SIM_DT, reset() { simAcc = 0; for (const a of RJ.combat.aircraft) { a._hasPrev = false; a._interp = false; } }, frame: (dt) => playFrame(dt) }; // frame(): test hook
  function playFrame(dt) {
    restoreSim();
    const mode = RJ.game.mode, pl = mode.player, I = RJ.input;
    if (I.action("pause")) { RJ.pause(); return; }
    if (I.action("retry") && mode.kind === "challenge") { RJ.restartGame(); return; }
    if (I.action("replay")) { if (RJ.replay.start("playing")) return; }
    if (I.action("photo")) { RJ.photo.start("playing"); return; }
    if (I.action("timeflow") && RJ.world.cycle) { const C = RJ.world.clock; C.run = !C.run; RJ.ui.flash(C.run ? "TIME FLOWING" : "TIME PAUSED", RJ.world.clockText() + (C.run ? " · " + C.rate + "×" : ""), 1.2); }
    if (I.action("ghost") && mode.kind === "challenge") RJ.ghost.toggle();
    if (I.action("camera")) cam.cycle();
    if (I.action("map")) RJ.nav.toggle();
    if (I.action("hud")) { RJ.settings.hud = !RJ.settings.hud; RJ.saveSettings(); }
    if (I.action("mute")) { RJ.settings.muted = !RJ.settings.muted; RJ.saveSettings(); RJ.ui.flash(RJ.settings.muted ? "SOUND OFF" : "SOUND ON", null, 0.8); }
    if (pl.alive) {
      const ax = I.axes();
      Object.assign(pl.input, { pitch: ax.pitch, roll: ax.roll, yaw: ax.yaw, thr: ax.thr, thrAbs: ax.thrAbs, ab: ax.ab, brake: ax.brake, guns: ax.guns });
      RJ.lever.apply(pl, dt);
      RJ.nav.control(pl, dt);
      if (RJ.glocActive) { pl.input.pitch = 0; pl.input.roll = 0; pl.input.yaw = 0; } // unconscious: hands off
      if (I.action("hyper")) { if (pl.spec.flight.model === "space") RJ.vehicles.toggleHyper(pl); else RJ.ui.flash("HYPERSONIC: STAR WARS CRAFT ONLY", null, 0.9); }
      if (I.action("autopilot")) RJ.nav.toggleAuto(pl);
      if (I.action("gear")) { pl.toggleGear(); if (!pl.spec.flight.model) RJ.ui.flash(pl.gearDown ? "GEAR DOWN" : "GEAR UP", null, 0.8); }
      if (mode.kind === "fight" || mode.armed) { // Free Flight with living airspace: missiles and targeting work too
        if (mode.command) for (const [k, o] of [["wingAttack", "attack"], ["wingCover", "cover"], ["wingForm", "form"], ["wingDefend", "defend"]]) if (I.action(k)) mode.command(o);
        if (I.action("target")) RJ.combat.cycleTarget(pl);
        if (!pl.target || !pl.target.alive) RJ.combat.autoTarget(pl);
        if (I.action("missile")) {
          if (!pl.spec.msl.n) RJ.ui.flash("NO MISSILES ON THIS AIRCRAFT", null, 1);
          else if (pl.missiles <= 0) RJ.ui.flash("WINCHESTER", "Out of missiles", 1);
          else if (!RJ.combat.fireMissile(pl)) { RJ.audio.beep(300, 0.12); if (!pl.locked) RJ.ui.flash("NO LOCK", "Keep the target in the seeker cone", 0.9); }
        }
      } else { I.action("missile"); I.action("target"); }
      if (I.action("flares")) RJ.combat.dropFlares(pl);
    }
    simAcc += dt;
    let steps = 0;
    while (simAcc >= SIM_DT && steps < SIM_MAX) {
      snapPrev();
      RJ.combat.update(SIM_DT);
      if (mode !== RJ.game.mode) return;
      RJ.sonic.update(SIM_DT, RJ.combat.aircraft);
      mode.update(SIM_DT);
      RJ.replay.record(SIM_DT);
      if (RJ.state.mode !== "playing") return;
      simAcc -= SIM_DT; steps++;
    }
    if (steps === SIM_MAX) simAcc = Math.min(simAcc, SIM_DT); // too slow to keep up: drop time rather than spiral
    applyInterp(simAcc / SIM_DT);
    if (RJ.combat.crowd) RJ.combat.drawCrowd(camera);
    const player = RJ.game.mode.player;
    const focus = !player.alive && mode.spectate && mode.spectate.alive ? mode.spectate : player;
    // continuous shake sources: transonic buffet and low, fast turbulence
    const m = focus.mach;
    const buffet = focus.state === "flying" ? RJ.smooth(0.86, 0.98, m) * (1 - RJ.smooth(1.0, 1.06, m)) : 0;
    const turb = focus.state === "flying" ? RJ.clamp((focus.speed - 120) / 400, 0, 1) * (1 - RJ.smooth(40, 600, focus.agl)) : focus.onGround ? RJ.clamp(focus.speed / 120, 0, 1) * 0.3 : 0;
    cam.base = buffet * 0.4 + turb * 0.35 + (RJ.world.inCloud || 0) * 0.25 + (focus.buffet || 0) * 0.45 + (focus.turb || 0) * 0.12;
    RJ.audio.buffet(focus === player ? buffet * 0.8 + turb * 0.25 + (focus.buffet || 0) * 0.6 : 0);
    RJ.lever.frame(player, camera, dt);
    const camMode = cam.update(dt, focus);
    RJ.nav.update(player, camera, dt);
    RJ.world.update(dt, camera, focus.pos, focus.vel, focus.agl);
    RJ.fx.update(dt, camera, renderer);
    // clouds rushing past
    if ((RJ.world.cloudNear || 0) > 0 && focus.speed > 120) RJ.fx.cloudStreak(camera.position, tv.set(0, 0, -1).applyQuaternion(camera.quaternion), focus.vel, Math.min(1, RJ.world.cloudNear * 2 + 0.2));
    // supersonic and low: humid air streaks past the canopy
    if (focus.state === "flying" && focus.mach > 0.95 && focus.agl < 900 && camMode !== "cinematic") {
      const k = RJ.smooth(0.95, 1.4, focus.mach) * (1 - RJ.smooth(200, 900, focus.agl)) * (0.4 + RJ.sonic.humidity(focus) * 0.8);
      if (k > 0.05) RJ.fx.speedStreak(camera.position, tv.set(0, 0, -1).applyQuaternion(camera.quaternion), focus.vel, k);
    }
    // afterburner light spilling onto the airframe and the ground (dramatic at dusk and at night)
    const abL = RJ.fx.abLight;
    const abK = Math.max(focus.abLevel, focus.hyperK || 0), swc = focus.spec.flight.model === "space";
    if (focus.alive && abK > 0.02 && focus.vis.flames.length) {
      abL.position.copy(focus.pos).addScaledVector(focus.fwd, -focus.vis.dims.len * 0.75);
      abL.color.setHex(swc ? focus.spec.colors.glow || focus.spec.engineColor || 0xff9a4a : 0xff9a4a);
      abL.intensity = (abK + (focus.abKick || 0) * 0.9) * (1.2 + (RJ.world.night ? 5 : RJ.smooth(15, 0, RJ.world.sunElev) * 3)) * (0.8 + Math.random() * 0.35) * (swc ? 3 + (focus.hyperK || 0) * 4 : 1);
      abL.distance = (60 + focus.vis.dims.len * 4) * (swc ? 2.5 : 1);
    } else abL.intensity = 0;
    // audio
    RJ.audio.update(player, camera, camMode === "cockpit", RJ.combat.aircraft);
    RJ.sonic.listen(camera, RJ.audio._camV, RJ.combat.aircraft);
    RJ.audio.setGun(player.firing && player.alive);
    if (player.alive && player.target && player.target.alive && player.spec.msl.n && player.missiles > 0 && player.lockT > 0) RJ.audio.tone(player.locked ? "locked" : "locking");
    else RJ.audio.tone(null);
    const missileIn = player.alive && player.incoming.length > 0;
    const lockedOn = player.alive && player.lockedByT > 0;
    RJ.audio.warn(missileIn ? "missile" : lockedOn ? "lock" : null);
    RJ.ui.banner(missileIn ? "missile" : lockedOn ? "lock" : null);
    if (RJ.companion) RJ.companion.update(dt, player, turb);
    // G-effects
    // G tolerance: sustained high G narrows the view to a tunnel, then G-LOC (the pilot blacks out for a few
    // seconds and the stick goes slack). Negative G reddens the view. Starfighters have inertial dampers.
    const fighter = player.spec.flight.gmax > 5 && player.spec.flight.model !== "space";
    if (player.alive && fighter && player.g > 7) gStress += (player.g - 7) * 0.1 * dt;
    else gStress = Math.max(0, gStress - dt * (gloc > 0 ? 0.2 : 0.6));
    gStress = Math.min(gStress, 1.3);
    if (gStress >= 1.25 && gloc <= 0 && player.alive) { gloc = 3; RJ.ui.flash("G-LOC", "Ease off the pull", 2.5, true); }
    gloc = Math.max(0, gloc - dt);
    RJ.glocActive = gloc > 0.6;
    const neg = player.alive && player.g < -1.8;
    const vg = $("vignette");
    const tunnel = Math.round(RJ.clamp(62 - gStress * 46, 6, 62));
    vg.style.opacity = (gloc > 0 ? RJ.clamp(gloc, 0, 1) : RJ.clamp(gStress * 0.85 + (neg ? 0.35 : 0), 0, 0.95)).toFixed(3);
    vg.style.background = gloc > 0 ? "#000" : neg ? "radial-gradient(ellipse at center, rgba(120,0,0,0) 35%, rgba(150,0,0,.85) 100%)" : `radial-gradient(ellipse at center, rgba(0,0,0,0) ${tunnel}%, rgba(0,0,0,.97) ${Math.min(100, tunnel + 38)}%)`;
    dmgFlash = Math.max(0, dmgFlash - dt * 2.5);
    $("dmgflash").style.opacity = dmgFlash.toFixed(3);
    RJ.hud.hitFlash = Math.max(0, RJ.hud.hitFlash - dt);
    // render
    postInputs(player, focus, camMode, dt);
    RJ.world.renderCloudShadow(renderer, camera);
    RJ.world.renderReflection(renderer, camera);
    const overlays = camMode === "cockpit" && cam.blend > 0.6 && focus.alive ? cockpitOverlay(focus, dt) : null;
    lastOverlays = overlays;
    RJ.post.render(scene, camera, overlays, RJ.world.grade, dt, { world: true });
    renderPip(dt);
    // HUD
    let pullUp = false;
    if (player.alive && player.state === "flying" && player.vel.y < -5) pullUp = player.agl / -player.vel.y < 4;
    if (player.alive && player.state === "flying" && player.agl < 25 && player.speed > 60 && player.gearT < 0.9) pullUp = pullUp || player.vel.y < 0;
    const extras = mode.hudExtras();
    RJ.hud.draw(Object.assign({ player: focus === player ? player : focus, camera, camMode: camMode === "boom" ? "cinematic" : camMode, cockpit3d: !!overlays, others: RJ.combat.aircraft, pullUp }, focus === player ? extras : {}));
    RJ.ui.status(mode.status());
    RJ.ui.objective(camMode === "cinematic" ? `Cinematic camera · ${RJ.keyLabel(RJ.settings.keys.camera)} to change view` : mode.objective());
    if (RJ.modes._dirty) { RJ.saveProgress(); RJ.modes._dirty = false; }
  }
  /** Hooks for the replay / photo module (js/replay.js). */
  RJ.view = {
    cam,
    get camera() { return camera; },
    get renderer() { return renderer; },
    resetCam(f) { cam.reset(f); },
    resetClock() { clock.getDelta(); RJ.input.keys.clear(); if (RJ.input.edges) RJ.input.edges.clear(); },
    renderWorld(dt) {
      RJ.world.renderCloudShadow(renderer, camera);
      RJ.world.renderReflection(renderer, camera);
      RJ.post.render(scene, camera, null, RJ.world.grade, dt, { world: true });
    }
  };
  function frozenFrame() { RJ.post.render(scene, camera, lastOverlays, RJ.world.grade, 0, { world: true }); }

  /* ======================= EVENTS → AUDIO/FX/UI ======================= */
  function wireEvents() {
    RJ.on("sonicboom", (ac) => {
      if (RJ.state.mode !== "playing") return;
      if (ac.isPlayer || ac.pos.distanceTo(camera.position) < 4000) RJ.sonic.trigger(ac);
    });
    RJ.on("boomfx", (e) => {
      // the crossing itself makes no boom for an outside listener (that comes when the cone sweeps over them,
      // see RJ.sonic.listen); riding with the jet you get the structural / pressure cue and a short impulse
      const inPit = e.ac.isPlayer && cam.mode === "cockpit";
      const riding = e.ac === RJ.game.mode.player && !cam.temp && (cam.mode === "chase" || cam.mode === "cockpit");
      if (riding) {
        RJ.audio.machCue(inPit, e.vis);
        cam.kick(inPit ? 0.45 : 0.8); cam.punch = 2.5;
      }
      if (e.ac.isPlayer) {
        RJ.ui.flash("MACH 1", e.vis > 0.55 ? "Condensation cloud" : "Supersonic", 1.2);
        startReplay(e.ac, e.center);
      }
    });
    RJ.on("explosion", (e) => {
      const d = e.pos.distanceTo(camera.position);
      RJ.audio.explosion(d, e.big);
      if (d < 600) cam.kick((1 - d / 600) * 1.2 * e.big);
    });
    RJ.on("missile", (e) => { if (e.by.isPlayer) { RJ.audio.missileLaunch(); RJ.ui.flash("FOX THREE", null, 0.7); } });
    RJ.on("flares", (ac) => { if (ac.isPlayer) RJ.audio.flare(); });
    RJ.on("damage", (e) => { if (e.ac.isPlayer) { dmgFlash = Math.min(1, dmgFlash + 0.25 + e.amount / 60); RJ.audio.hit(); cam.kick(0.3 + e.amount / 80); } });
    RJ.on("hitmarker", () => { RJ.hud.hitFlash = 0.25; RJ.audio.hitMarker(); });
    RJ.on("destroyed", (d) => { if (RJ.game.mode && RJ.game.mode.onDestroyed) RJ.game.mode.onDestroyed(d); });
    RJ.on("bomb", () => RJ.audio.bombWhistle());
    RJ.on("splash", (e) => RJ.audio.splash(e.pos.distanceTo(camera.position)));
    RJ.on("liftoff", (ac) => { if (ac.isPlayer) RJ.ui.flash("AIRBORNE", null, 1.2); });
    RJ.on("touchdown", (ac) => { if (ac.isPlayer) { RJ.ui.flash("TOUCHDOWN", "Hold " + RJ.keyLabel(RJ.settings.keys.airbrake) + " to brake", 1.6); cam.kick(0.4); } });
  }

  /* ======================= LOOP ======================= */
  /* Frame pacing: requestAnimationFrame already runs at the display's refresh rate (60/120/144/240 Hz);
   * the optional limit skips frames to hold a lower rate. Dynamic resolution trims the render scale when the
   * frame rate falls well below target and restores it when there is headroom. */
  const PERF = { last: 0, n: 0, t0: 0, fps: 0, ms: 0, scale: 1, lowT: 0, highT: 0, vsync: 1000 / 60, el: null };
  RJ.perf = PERF;
  function perfTick(now, frameMs) {
    PERF.n++;
    if (frameMs > 2 && frameMs < PERF.vsync * 0.97) PERF.vsync = PERF.vsync * 0.9 + frameMs * 0.1; // learn the display interval
    if (now - PERF.t0 < 500) return;
    PERF.fps = (PERF.n * 1000) / (now - PERF.t0); PERF.ms = (now - PERF.t0) / PERF.n; PERF.n = 0; PERF.t0 = now;
    const lim = +RJ.settings.fpsLimit || 0;
    const target = Math.min(lim || 1000, 1000 / PERF.vsync);
    if (RJ.settings.dynRes !== false && RJ.state.mode === "playing") {
      if (PERF.fps < target * 0.85) { PERF.lowT += 0.5; PERF.highT = 0; } else if (PERF.fps > target * 0.96) { PERF.highT += 0.5; PERF.lowT = 0; } else { PERF.lowT = PERF.highT = 0; }
      if (PERF.lowT >= 1.5 && PERF.scale > 0.6) { PERF.scale = Math.max(0.6, PERF.scale - 0.1); PERF.lowT = 0; applyPixelRatio(); }
      else if (PERF.highT >= 4 && PERF.scale < 1) { PERF.scale = Math.min(1, PERF.scale + 0.1); PERF.highT = 0; applyPixelRatio(); }
    } else if (PERF.scale !== 1 && RJ.settings.dynRes === false) { PERF.scale = 1; applyPixelRatio(); }
    if (!PERF.el) { PERF.el = document.createElement("div"); PERF.el.id = "fps"; document.body.appendChild(PERF.el); }
    PERF.el.hidden = !RJ.settings.showFps;
    if (RJ.settings.showFps) PERF.el.textContent = `${Math.round(PERF.fps)} FPS · ${PERF.ms.toFixed(1)} ms${PERF.scale < 1 ? ` · res ${Math.round(PERF.scale * 100)}%` : ""}`;
  }
  function applyPixelRatio() {
    const Q = RJ.world.QUALITY[RJ.settings.quality] || RJ.world.QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixel) * PERF.scale);
    resize();
  }
  function frame(now) {
    requestAnimationFrame(frame);
    now = now || performance.now();
    const lim = +RJ.settings.fpsLimit || 0;
    if (lim) {
      const min = 1000 / lim;
      const el = now - PERF.last;
      if (el < min - 1.5) return; // too early for the next frame at this cap
      PERF.last = el > min * 2 ? now : PERF.last + min; // keep an even cadence
    } else PERF.last = now;
    const frameMs = clock.getDelta() * 1000;
    perfTick(now, frameMs);
    const dt = Math.min(frameMs / 1000, 0.05);
    try { RJ.input.pollGamepad(); } catch (e) { /* ignore */ }
    const st = RJ.state.mode;
    try {
      // multiplayer keeps talking while paused, in a replay or in photo mode
      const gm = RJ.game.mode;
      if (st !== "playing" && gm && gm.netTick && (st === "paused" || st === "replay" || st === "photo")) gm.netTick(dt);
      if (st === "playing") playFrame(dt);
      else if (st === "paused") { if (RJ.ui.current === "scr-pause" && RJ.input.action("pause")) RJ.resume(); frozenFrame(); }
      else if (st === "results") { if (RJ.input.action("retry") && RJ.game.config && RJ.game.config.kind === "challenge") RJ.restartGame(); else frozenFrame(); }
      else if (st === "replay") RJ.replay.frame(dt);
      else if (st === "photo") RJ.photo.frame(dt);
      else if (st === "hangar") HV.render(dt);
      else if (st === "menu") menuFrame(dt);
    } catch (e) { console.error(e); }
    const musKey = st + (RJ.audio.ctx ? "+" : "") + (RJ.settings.muted ? "m" : "") + RJ.settings.musicVol + "|" + RJ.settings.master + "|" + (RJ.settings.musicSC || "");
    if (RJ.audio.music && musKey !== RJ._lastSt) { RJ.audio.music(st === "menu" || st === "hangar"); RJ._lastSt = musKey; }
    RJ.ui.tick(dt);
    RJ.input.endFrame();
  }

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || RJ.input.capture) return;
    const cur = RJ.ui.current;
    const back = { "scr-free": "free-back", "scr-fight": "fight-back", "scr-hangar": "hg-back", "scr-settings": "set-back", "scr-career": "car-back", "scr-chal": "chal-back", "scr-atlas": "atlas-back", "scr-mp": "mp-back" }[cur];
    if (back) { e.preventDefault(); $(back).click(); RJ.input.edges.delete("escape"); }
  });
  ["pointerdown", "keydown"].forEach((ev) => addEventListener(ev, () => RJ.audio.init(), { once: true }));
  // multiplayer scoreboard: hold Tab in a match
  const board = (show) => {
    const el = $("mp-board"), m = RJ.game.mode;
    if (!show || !m || !m.mp || RJ.state.mode !== "playing") { el.hidden = true; return; }
    const rows = m.scoreRows ? m.scoreRows() : [];
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    el.innerHTML = `<table><tr><th>Pilot</th>${m.cfg.mode === "team" ? "<th>Team</th>" : ""}<th>K</th><th>D</th></tr>${rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td>${esc(r.nm)}</td>${m.cfg.mode === "team" ? `<td>${r.team}</td>` : ""}<td>${r.k}</td><td>${r.d}</td></tr>`).join("")}</table>`;
    el.hidden = false;
  };
  addEventListener("keydown", (e) => { if (e.key === "Tab" && RJ.game.mode && RJ.game.mode.mp && RJ.state.mode === "playing") { e.preventDefault(); board(true); } });
  addEventListener("keyup", (e) => { if (e.key === "Tab") board(false); });

  /* ======================= BOOT ======================= */
  async function boot() {
    if (typeof THREE === "undefined") { $("load-text").textContent = "The 3D engine didn't load. Check your connection and reload."; return; }
    const canvas = $("gl");
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    } catch (e) { $("load-text").textContent = "WebGL isn't available in this browser, so the game can't run here."; return; }
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); RJ.scene = scene;
    camera = new THREE.PerspectiveCamera(RJ.settings.fov, innerWidth / innerHeight, 0.5, 20000); RJ.camera = camera;
    camera.layers.enable(1); camera.layers.enable(RJ.LATE); camera.layers.enable(5); // 5: near-only city detail (skipped by the water reflection)
    RJ.renderer = renderer;
    clock = new THREE.Clock();
    RJ.world.init(renderer, scene);
    RJ.world.camera = camera;
    RJ.post.init(renderer);
    RJ.clouds.init(renderer);
    RJ.fx.init(scene);
    RJ.sonic.init(scene);
    RJ.combat.init(scene);
    RJ.hud.init($("hud"));
    HV.init();
    initCockpit();
    RJ.ui.init();
    RJ.applyGraphics();
    addEventListener("resize", resize);
    wireEvents();
    frame();
    setLoad(0.02, "Surveying terrain and landmarks…");
    await new Promise((r) => setTimeout(r, 30));
    renderer.localClippingEnabled = true;
    try { RJ.atlas.ensure(); } catch (e) { console.warn("Atlas failed", e); }
    const reg = RJ.world.findRegion("mountains");
    const pos = V3(reg.x, RJ.modes.highestAround(reg.x, reg.z, 2500, 4) + 450, reg.z);
    setLoad(0.1, "Generating terrain…");
    await RJ.world.prepare(pos, (p) => setLoad(0.1 + p * 0.9));
    makeShowcase(pos, reg.yaw);
    RJ.state.mode = "menu";
    RJ.ui.show("scr-main");
    RJ.ui.checkInvite();
  }
  boot();
})(window.RJ);
