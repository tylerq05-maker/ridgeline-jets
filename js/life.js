/* Ridgeline Jets — wildlife and random events.
 * Birds: Canada geese in V formation, gulls wheeling over the coast, eagles circling in mountain thermals and
 * crows over farmland, as instanced meshes with flapping wings (vertex shader). Flocks appear around the player
 * below ~2.5 km and drift off; flying through one is a bird strike (damage, feathers, a thump).
 * Whales: pods surfacing in deep water — spouts, slow rolls and the occasional full breach with a splash.
 * Events: rare moments in Free Flight — a hot-air balloon festival, a meteor fireball at night. */
(function (RJ) {
  "use strict";
  const L = (RJ.life = { flocks: [], whales: [], on: true, strikes: 0 });
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
  const _v = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3(), _e = new THREE.Euler();

  /* ---------------- birds ---------------- */
  const SPECIES = {
    goose: { span: 1.6, col: 0x3b342c, flap: 3.2, speed: 19, agl: [250, 1200], n: [9, 21], v: true },
    gull: { span: 1.3, col: 0xe8e8e4, flap: 2.6, speed: 11, agl: [25, 220], n: [6, 16] },
    eagle: { span: 2.2, col: 0x4a3524, flap: 0.6, speed: 13, agl: [150, 900], n: [1, 2], soar: true },
    crow: { span: 0.9, col: 0x1d1d20, flap: 4.5, speed: 12, agl: [20, 160], n: [8, 24] }
  };
  const MAXB = 220, TIME = { value: 0 };
  const meshes = {};
  function birdGeo() {
    // body (thin diamond) and two wings; aWing = 0 on the body, 1 at the wing tips (drives the flap)
    const p = [0, 0, -0.45, 0.06, 0, 0.1, -0.06, 0, 0.1, 0, 0.04, -0.1, 0.06, 0, 0.1, -0.06, 0, 0.1,
      0.04, 0, -0.08, 0.5, 0, 0.05, 0.04, 0, 0.12, -0.04, 0, -0.08, -0.04, 0, 0.12, -0.5, 0, 0.05,
      0, 0, 0.1, 0.1, 0, 0.32, -0.1, 0, 0.32];
    const w = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("aWing", new THREE.Float32BufferAttribute(w, 1));
    g.computeVertexNormals();
    return g;
  }
  function meshFor(id) {
    if (meshes[id]) return meshes[id];
    const S = SPECIES[id], g = birdGeo();
    g.setAttribute("aFlap", new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 2), 2));
    const mat = new THREE.MeshLambertMaterial({ color: S.col, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.rjTime = TIME;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aWing; attribute vec2 aFlap; uniform float rjTime;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat fl = sin(rjTime * aFlap.x * 6.2832 + aFlap.y); transformed.y += fl * aWing * 0.38 * step(0.05, aFlap.x); transformed.x *= 1.0 - aWing * abs(fl) * 0.12 * step(0.05, aFlap.x);");
    };
    const m = new THREE.InstancedMesh(g, mat, MAXB);
    m.count = 0; m.frustumCulled = false;
    RJ.world.scene.add(m);
    return (meshes[id] = m);
  }
  function pickSpecies(p, agl) {
    const W = RJ.world, h = W.terrainHeight(p.x, p.z);
    if (h < -2) return Math.random() < 0.8 ? "gull" : "goose";
    if (h > 700) return Math.random() < 0.55 ? "eagle" : "goose";
    return ["goose", "goose", "crow", "eagle", "gull"][Math.floor(Math.random() * 5)];
  }
  function spawnFlock(pl) {
    const W = RJ.world, f = _v.copy(pl.vel.lengthSq() > 1 ? pl.vel : pl.fwd).setY(0).normalize();
    const a = Math.atan2(f.z, f.x) + RJ.rand(-0.9, 0.9), r = RJ.rand(1800, 4500);
    const x = pl.pos.x + Math.cos(a) * r, z = pl.pos.z + Math.sin(a) * r, g = W.ground(x, z);
    const id = pickSpecies({ x, z }), S = SPECIES[id];
    const y = Math.max(g, 0) + RJ.rand(S.agl[0], S.agl[1]);
    if (Math.abs(y - pl.pos.y) > 1500) return;
    const n = Math.round(RJ.rand(S.n[0], S.n[1])), hdg = Math.random() * TAU, birds = [];
    for (let i = 0; i < n; i++) {
      let o;
      if (S.v) { const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1; o = V3(side * k * 2.6, RJ.rand(-0.3, 0.3), k * 3.4); } // V: ~35° arms, 2.6 m spacing
      else o = V3(RJ.rand(-1, 1), RJ.rand(-0.4, 0.4), RJ.rand(-1, 1)).multiplyScalar(id === "eagle" ? 60 : 9 + n);
      birds.push({ o, ph: Math.random() * TAU, fr: S.flap * RJ.rand(0.85, 1.15), alive: true });
    }
    L.flocks.push({ id, S, c: V3(x, y, z), hdg, turn: 0, birds, t: 0, cx: x, cz: z, cr: RJ.rand(90, 220) });
  }
  function updateBirds(dt, pl, cam) {
    const W = RJ.world;
    TIME.value += dt;
    // keep a few flocks around the player when low enough to meet birds
    const agl = pl ? pl.pos.y - Math.max(W.ground(pl.pos.x, pl.pos.z), 0) : 1e9;
    for (let i = L.flocks.length - 1; i >= 0; i--) if (!pl || L.flocks[i].c.distanceTo(pl.pos) > 8000) L.flocks.splice(i, 1);
    const tier = L.tier || 0;
    const want = agl < 2500 && tier < 3 ? (RJ.settings.quality === "low" || tier >= 1 ? 3 : 6) : 0;
    if (pl && L.flocks.length < want && Math.random() < dt * 0.5) spawnFlock(pl);
    const counts = {};
    for (const id in SPECIES) counts[id] = 0;
    for (const F of L.flocks) {
      F.t += dt;
      const S = F.S, m = meshFor(F.id);
      if (S.soar) {
        // thermal: slow circles drifting with the wind
        const a = F.t * S.speed / F.cr;
        F.c.set(F.cx + Math.cos(a) * F.cr, F.c.y + Math.sin(F.t * 0.2) * 0.3 * dt, F.cz + Math.sin(a) * F.cr);
        F.hdg = -a; F.cx += 2 * dt;
      } else {
        F.turn = RJ.damp(F.turn, Math.sin(F.t * 0.13 + F.cr) * 0.08, 0.5, dt);
        F.hdg += F.turn * dt;
        F.c.x -= Math.sin(F.hdg) * S.speed * dt; F.c.z -= Math.cos(F.hdg) * S.speed * dt;
        const g = Math.max(W.ground(F.c.x, F.c.z), 0);
        if (F.c.y < g + S.agl[0] * 0.6) F.c.y += 3 * dt;
      }
      _q.setFromAxisAngle(_s.set(0, 1, 0), F.hdg);
      const bank = S.soar ? 0.35 : F.turn * 3;
      for (const b of F.birds) {
        if (!b.alive || counts[F.id] >= MAXB) continue;
        const p = _v.copy(b.o);
        if (!S.v) p.add(_s.set(Math.sin(F.t * 0.7 + b.ph) * 4, Math.sin(F.t * 0.9 + b.ph * 2) * 1.5, Math.cos(F.t * 0.6 + b.ph) * 4));
        p.applyQuaternion(_q).add(F.c);
        b.p = b.p || V3(); b.p.copy(p);
        _e.set(0, F.hdg, bank, "YXZ");
        _m.compose(p, new THREE.Quaternion().setFromEuler(_e), _s.setScalar(S.span));
        const k = counts[F.id]++;
        m.setMatrixAt(k, _m);
        m.geometry.attributes.aFlap.setXY(k, S.soar && Math.sin(F.t * 0.3 + b.ph) < 0.7 ? 0 : b.fr, b.ph);
      }
      // bird strike: the player passing within a wingspan or two of a bird
      if (pl && pl.alive && pl.speed > 35 && F.c.distanceToSquared(pl.pos) < 400 * 400) for (const b of F.birds) {
        if (!b.alive || !b.p) continue;
        if (b.p.distanceToSquared(pl.pos) < Math.pow(3 + (pl.F && pl.F.span ? pl.F.span * 0.3 : 3), 2)) strike(pl, b, F);
      }
    }
    for (const id in meshes) { const m = meshes[id]; m.count = counts[id]; m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aFlap.needsUpdate = true; }
  }
  function strike(pl, b, F) {
    b.alive = false; L.strikes++;
    const big = F.S.span > 1.4;
    pl.damage(big ? 9 : 4, null, "bird");
    if (RJ.fx) for (let i = 0; i < 10; i++) RJ.fx.smoke(b.p, _s.copy(pl.vel).multiplyScalar(0.3).add(V3(RJ.rand(-6, 6), RJ.rand(-3, 6), RJ.rand(-6, 6))), 0.6, false, 2.5, 0.6);
    if (RJ.audio && RJ.audio.hit) RJ.audio.hit();
    if (RJ.ui && RJ.ui.feed) RJ.ui.feed(big ? "Bird strike! Check engines" : "Bird strike", "r");
    RJ.emit("birdstrike", { ac: pl, species: F.id });
  }

  /* ---------------- whales ---------------- */
  let whaleGeo = null, whaleMat = null;
  function makeWhale() {
    if (!whaleGeo) {
      const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(Math.max(0.02, Math.sin(Math.PI * Math.pow(t, 0.75)) * 1.6 * (1 - t * 0.55)), (t - 0.5) * 15)); }
      const body = new THREE.LatheGeometry(pts, 12); body.rotateX(Math.PI / 2); body.scale(1, 0.8, 1);
      const fl = new THREE.BufferGeometry();
      fl.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 7.2, 2.4, 0, 8.6, 0.6, 0, 7.4, 0, 0, 7.2, -0.6, 0, 7.4, -2.4, 0, 8.6], 3));
      fl.computeVertexNormals();
      whaleGeo = [body, fl];
      whaleMat = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
    }
    const g = new THREE.Group(); for (const geo of whaleGeo) g.add(new THREE.Mesh(geo, whaleMat));
    g.scale.setScalar(RJ.rand(0.8, 1.15));
    return g;
  }
  function spawnWhales(cam) {
    const W = RJ.world;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * TAU, r = RJ.rand(1200, 7000), x = cam.position.x + Math.cos(a) * r, z = cam.position.z + Math.sin(a) * r;
      if (W.terrainHeight(x, z) > -30) continue;
      const n = 1 + Math.floor(Math.random() * 3), hdg = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const m = makeWhale(); W.scene.add(m);
        L.whales.push({ m, x: x + RJ.rand(-60, 60), z: z + RJ.rand(-60, 60), hdg, t: RJ.rand(0, 20), next: RJ.rand(6, 20), state: "swim", st: 0 });
      }
      return;
    }
  }
  function updateWhales(dt, cam) {
    const W = RJ.world;
    for (let i = L.whales.length - 1; i >= 0; i--) {
      const w = L.whales[i];
      if (Math.hypot(w.x - cam.position.x, w.z - cam.position.z) > 9000) { W.scene.remove(w.m); L.whales.splice(i, 1); continue; }
      w.t += dt; w.st += dt;
      w.x -= Math.sin(w.hdg) * 2.5 * dt; w.z -= Math.cos(w.hdg) * 2.5 * dt; w.hdg += Math.sin(w.t * 0.05) * 0.02 * dt;
      let y = -0.9, pitch = 0, roll = Math.sin(w.t * 0.3) * 0.08;
      if (w.state === "swim") {
        y = -0.9 + Math.sin(w.t * 0.25) * 0.5 - 0.4;
        if (w.st > w.next) {
          w.st = 0;
          const r = Math.random();
          if (r < 0.55) { w.state = "spout"; } else if (r < 0.75) { w.state = "breach"; } else { w.state = "dive"; }
          w.next = RJ.rand(8, 22);
        }
      } else if (w.state === "spout") {
        y = -0.6;
        if (w.st < 1.6 && RJ.fx && Math.random() < dt * 30) RJ.fx.smoke(V3(w.x, 1.5, w.z), V3(RJ.rand(-1, 1), 9 + Math.random() * 4, RJ.rand(-1, 1)), 1.4, false, 2.2, 0.5);
        if (w.st > 3) { w.state = "swim"; w.st = 0; }
      } else if (w.state === "breach") {
        // launches nose-up most of its length out of the water, twists and falls back on its side
        const T = 3.2, u = w.st / T;
        y = -6 + Math.sin(Math.min(u, 1) * Math.PI) * 13; pitch = (0.5 - u) * 2.2; roll = u * 1.6;
        if (Math.abs(u - 0.02) < dt / T && RJ.fx) RJ.fx.splash(V3(w.x, 0, w.z), 1.6);
        if (u > 0.9 && !w.splashed && RJ.fx) { w.splashed = true; RJ.fx.splash(V3(w.x, 0, w.z), 3); }
        if (u >= 1.1) { w.state = "swim"; w.st = 0; w.splashed = false; }
      } else if (w.state === "dive") {
        // tail flukes up, then gone for a while
        const u = w.st / 4;
        y = -1 - u * 10; pitch = -Math.min(u, 0.6) * 1.6;
        if (w.st > 25) { w.state = "swim"; w.st = 0; }
      }
      w.m.position.set(w.x, y, w.z);
      w.m.rotation.set(pitch, w.hdg, roll, "YXZ");
      w.m.visible = y > -14;
    }
  }

  /* ---------------- random events ---------------- */
  let evT = 0;
  const balloons = [];
  let balloonGeo = null;
  function balloonFestival(pl) {
    const W = RJ.world, f = _v.copy(pl.fwd).setY(0).normalize();
    const c = V3(pl.pos.x + f.x * 5000, 0, pl.pos.z + f.z * 5000), g = Math.max(W.ground(c.x, c.z), 0);
    if (!balloonGeo) {
      const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * 9 * (t < 0.15 ? 0.6 + t * 2.6 : 1), t * 24)); }
      balloonGeo = new THREE.LatheGeometry(pts, 16);
    }
    const cols = [0xd8202a, 0xf2b705, 0x2a6fd8, 0x2fa04a, 0xe86a1c, 0x8a2bd8, 0xf2f2f0];
    for (let i = 0; i < 14; i++) {
      const grp = new THREE.Group();
      const env = new THREE.Mesh(balloonGeo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.7 })); env.position.y = 5; grp.add(env);
      const bask = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), new THREE.MeshStandardMaterial({ color: 0x6b4a2a })); grp.add(bask);
      grp.position.set(c.x + RJ.rand(-1500, 1500), g + RJ.rand(150, 900), c.z + RJ.rand(-1500, 1500));
      W.scene.add(grp);
      balloons.push({ m: grp, vy: RJ.rand(-0.4, 0.6), life: 600 });
    }
    if (RJ.ui && RJ.ui.feed) RJ.ui.feed("Hot-air balloon festival ahead", "b");
  }
  let meteor = null;
  function meteorFireball(pl) {
    const W = RJ.world, f = _v.copy(pl.fwd).setY(0).normalize();
    const a = V3(pl.pos.x + f.x * 40000 + RJ.rand(-20000, 20000), 60000, pl.pos.z + f.z * 40000 + RJ.rand(-20000, 20000));
    const v = V3(RJ.rand(-1, 1), -0.45, RJ.rand(-1, 1)).normalize().multiplyScalar(18000);
    const m = new THREE.Mesh(new THREE.SphereGeometry(250, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.4), fog: false, toneMapped: false }));
    m.position.copy(a); m.layers.set(W.BACK); m.frustumCulled = false; W.scene.add(m);
    meteor = { m, v, t: 0 };
    if (RJ.ui && RJ.ui.feed) RJ.ui.feed("Fireball across the sky!", "b");
  }
  function updateEvents(dt, pl) {
    const W = RJ.world, mode = RJ.game && RJ.game.mode;
    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i]; b.life -= dt;
      b.m.position.x += (W.windOff ? 1.5 : 0) * dt; b.m.position.y += b.vy * dt;
      if (b.life <= 0 || (pl && b.m.position.distanceTo(pl.pos) > 30000)) { W.scene.remove(b.m); balloons.splice(i, 1); }
    }
    if (meteor) {
      meteor.t += dt; meteor.m.position.addScaledVector(meteor.v, dt);
      meteor.m.scale.setScalar(1 + meteor.t * 0.8);
      if (meteor.t > 2.6) { W.scene.remove(meteor.m); meteor.m.geometry.dispose(); meteor = null; }
    }
    if (!pl || !mode || mode.kind !== "free") return;
    evT += dt;
    if (evT > 240 && Math.random() < dt / 120) {
      evT = 0;
      if (W.night || W.sunElev < -6) meteorFireball(pl);
      else if (!balloons.length && pl.pos.y < 3000 && (W.wx().wind || 0) < 10 && !W.wx().rain) balloonFestival(pl);
    }
  }
  L.event = (id) => { const pl = RJ.game && RJ.game.mode && RJ.game.mode.player; if (!pl) return; if (id === "meteor") meteorFireball(pl); else balloonFestival(pl); };
  L.balloons = balloons;

  /* ---------------- per frame ---------------- */
  let whaleT = 0;
  L.update = function (dt, cam) {
    if (!L.on || !RJ.world.terrainHeight) return;
    const pl = RJ.game && RJ.game.mode && RJ.game.mode.player;
    updateBirds(dt, pl && pl.alive ? pl : null, cam);
    whaleT -= dt;
    if (whaleT <= 0) { whaleT = 15; if (L.whales.length < 6 && cam.position.y < 3000 && (L.tier || 0) < 3) spawnWhales(cam); }
    updateWhales(dt, cam);
    updateEvents(dt, pl);
  };
  L.clear = function () {
    L.flocks.length = 0;
    for (const w of L.whales) RJ.world.scene.remove(w.m); L.whales.length = 0;
    for (const b of balloons) RJ.world.scene.remove(b.m); balloons.length = 0;
  };
})(window.RJ);
