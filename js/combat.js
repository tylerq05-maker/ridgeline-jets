/* Ridgeline Jets — combat: guns, missiles (proportional navigation), flares, bombs, lock-on and AI pilots. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, DEG = RJ.DEG;
  const C = { aircraft: [], missiles: [], flares: [], bombs: [] };
  RJ.combat = C;
  const tv = V3(), tv2 = V3(), tv3 = V3();

  /* ======================= BULLETS (instanced tracers) ======================= */
  const sc2 = new THREE.Vector3(), _bc = new THREE.Color();
  const MAXB = 900;
  C.init = function (scene) {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 9);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    C.tracers = new THREE.InstancedMesh(geo, mat, MAXB);
    C.tracers.setColorAt(0, new THREE.Color(0xffd27a)); // per-bolt colour: tracers amber, lasers their own
    C.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    C.tracers.frustumCulled = false; C.tracers.count = 0; C.tracers.layers.set(RJ.LATE);
    scene.add(C.tracers);
    C.bullets = [];
    for (let i = 0; i < MAXB; i++) C.bullets.push({ p: V3(), v: V3(), life: 0, owner: null, dmg: 0 });
    C.bi = 0;
    // missile mesh template
    const mg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.2, 8), new THREE.MeshLambertMaterial({ color: 0xe8e8e4 }));
    body.geometry.rotateX(Math.PI / 2); mg.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.45, 8), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
    nose.geometry.rotateX(-Math.PI / 2); nose.position.z = -1.82; mg.add(nose);
    const fins = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.35), body.material); fins.position.z = 1.4; mg.add(fins);
    const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 2; mg.add(fins2);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.geometry.rotateX(Math.PI / 2); flame.position.z = 2.4; flame.name = "flame"; flame.layers.set(RJ.LATE); mg.add(flame);
    C.missileTpl = mg;
    const bg = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0x4f5546 }));
    bb.geometry.rotateX(Math.PI / 2); bg.add(bb);
    C.bombTpl = bg;
  };

  C.reset = function () {
    C.aircraft.forEach((a) => a.dispose());
    C.aircraft = [];
    C.missiles.forEach((m) => RJ.scene.remove(m.mesh)); C.missiles = [];
    if (RJ.missileFx) RJ.missileFx.clear();
    C.bombs.forEach((b) => RJ.scene.remove(b.mesh)); C.bombs = [];
    if (RJ.missileFx) C.flares.forEach((f) => RJ.missileFx.flareEnd(f));
    C.flares = [];
    if (C.crowdMesh) C.crowdMesh.visible = false;
    if (RJ.airspace) RJ.airspace.clear();
    for (const b of C.bullets) b.life = 0;
    C.tracers.count = 0;
  };
  C.add = function (ac) { C.aircraft.push(ac); return ac; };
  /** Take an aircraft out of the world (Free Flight traffic leaving the area, or a wreck that has burnt out). */
  C.remove = function (ac) {
    const i = C.aircraft.indexOf(ac);
    if (i < 0) return;
    ac.alive = false; ac.state = "dead";
    for (const o of C.aircraft) if (o.target === ac) { o.target = null; o.lockT = 0; o.locked = false; }
    for (const m of C.missiles) if (m.target === ac) m.lost = true;
    if (ac._srib && RJ.missileFx) RJ.missileFx.smoke(ac, null);
    ac.dispose(); C.aircraft.splice(i, 1);
  };
  /* Neutral aircraft (Free Flight traffic, airshows) are never picked automatically: only an aircraft that is
   * already hostile is. all = true includes them (the player cycling targets on purpose). */
  C.enemiesOf = (ac, all) => C.aircraft.filter((o) => o.alive && o.team !== ac.team && (all || !o.neutral));
  C.friendsOf = (ac) => C.aircraft.filter((o) => o.alive && o.team === ac.team && o !== ac);

  /* ======================= GUNS ======================= */
  /** Fire the gun for this frame if the trigger is held. Gun heat stops a held trigger from working forever. */
  C.fireGun = function (ac, dt, aimDir) {
    const g = ac.spec.gun;
    ac.firing = false;
    if (!g || g.turret || !ac.alive || !ac.input.guns || ac.overheated) return false;
    ac.firing = true;
    ac.gunAcc = (ac.gunAcc || 0) + dt * g.rate;
    let fired = 0;
    while (ac.gunAcc >= 1) {
      ac.gunAcc -= 1;
      spawnBullet(ac, aimDir || ac.fwd, g, fired);
      fired++;
      ac.gunHeat += g.heat;
      if (ac.gunHeat >= 1) { ac.gunHeat = 1; ac.overheated = true; ac.firing = false; break; }
    }
    return fired > 0;
  };
  function spawnBullet(ac, dir, g, k) {
    const b = C.bullets[C.bi]; C.bi = (C.bi + 1) % MAXB;
    const s = g.spread;
    b.v.copy(dir).add(tv.set((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2)).normalize().multiplyScalar(g.speed).add(ac.vel);
    const muzzle = ac.vis.cockpit.z + 1.5;
    b.p.copy(ac.pos).addScaledVector(ac.fwd, -muzzle + 2).addScaledVector(ac.right, (k % 2 ? 0.6 : -0.6) * (ac.id === "p51" ? 4 : 1));
    b.life = 2.4; b.owner = ac; b.dmg = g.dmg; b.col = g.color || 0xffd27a; b.len = g.laser ? 2.6 : 1;
    ac.stats.shots++;
    if (k === 0) RJ.fx.muzzle(b.p, ac.vel, g.brrt ? 3.5 : 2);
  }
  /** Rear turret (B-52): auto-fires at the nearest enemy behind. */
  function turret(ac, dt) {
    const g = ac.spec.gun;
    if (!g || !g.turret || !ac.alive || ac.neutral) return;
    let best = null, bd = 1300;
    for (const e of C.enemiesOf(ac)) {
      const d = e.pos.distanceTo(ac.pos);
      if (d > bd) continue;
      const rel = tv.copy(e.pos).sub(ac.pos).normalize();
      if (rel.dot(ac.fwd) > -0.5) continue;
      best = e; bd = d;
    }
    ac.firing = !!best && !ac.overheated;
    if (!ac.firing) return;
    const tof = bd / g.speed;
    const aim = tv2.copy(best.pos).addScaledVector(best.vel, tof).sub(ac.pos).normalize();
    ac.gunAcc = (ac.gunAcc || 0) + dt * g.rate;
    while (ac.gunAcc >= 1) {
      ac.gunAcc -= 1;
      const b = C.bullets[C.bi]; C.bi = (C.bi + 1) % MAXB;
      b.v.copy(aim).add(tv.set((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02)).normalize().multiplyScalar(g.speed).add(ac.vel);
      b.p.copy(ac.pos).addScaledVector(ac.fwd, -ac.vis.dims.len * 0.5);
      b.life = 1.6; b.owner = ac; b.dmg = g.dmg;
      ac.gunHeat += g.heat; ac.stats.shots++;
      if (ac.gunHeat >= 1) { ac.overheated = true; break; }
    }
  }

  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = V3(1, 1, 1), Z = V3(0, 0, 1);
  const LIVE = [];
  function updateBullets(dt) {
    let n = 0;
    LIVE.length = 0;
    for (const ac of C.aircraft) if (ac.alive) LIVE.push(ac);
    const ff = RJ.game.friendlyFire;
    for (const b of C.bullets) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const p0x = b.p.x, p0y = b.p.y, p0z = b.p.z;
      b.p.addScaledVector(b.v, dt);
      b.v.y -= RJ.G0 * dt;
      // hit test: segment vs aircraft spheres
      const sx = b.p.x - p0x, sy = b.p.y - p0y, sz = b.p.z - p0z, reach = Math.abs(sx) + Math.abs(sy) + Math.abs(sz);
      for (const ac of LIVE) {
        const r = ac.radius;
        const dx = ac.pos.x - p0x, dy = ac.pos.y - p0y, dz = ac.pos.z - p0z;
        if (Math.abs(dx) > reach + r || Math.abs(dz) > reach + r || Math.abs(dy) > reach + r) continue;
        if (!ac.alive || ac === b.owner || (b.owner && ac.team === b.owner.team && !ff)) continue;
        const sl = sx * sx + sy * sy + sz * sz;
        let t = sl > 0 ? (dx * sx + dy * sy + dz * sz) / sl : 0;
        t = RJ.clamp(t, 0, 1);
        const cx = p0x + sx * t - ac.pos.x, cy = p0y + sy * t - ac.pos.y, cz = p0z + sz * t - ac.pos.z;
        if (cx * cx + cy * cy + cz * cz < r * r) {
          b.life = 0;
          if (!(b.owner && b.owner.remote)) ac.damage(b.dmg, b.owner, "gun"); // a remote shooter's game scores its own hits
          if (b.owner) { b.owner.stats.hits++; if (b.owner.isPlayer) RJ.emit("hitmarker", ac); }
          RJ.fx.spark(tv.set(p0x + sx * t, p0y + sy * t, p0z + sz * t), ac.vel);
          break;
        }
      }
      if (b.life <= 0) continue;
      if (b.p.y < 60 || (b.life < 2.2 && Math.random() < 0.05)) {
        const gnd = RJ.world.ground(b.p.x, b.p.z);
        if (b.p.y < gnd) { b.life = 0; if (Math.random() < 0.3) RJ.fx.dust(b.p, 0.08); continue; }
      }
      if (n < MAXB) {
        qq.setFromUnitVectors(Z, tv.copy(b.v).normalize());
        const L = b.len || 1;
        mtx.compose(b.p, qq, sc2.set(L > 1 ? 2.2 : 1, L > 1 ? 2.2 : 1, L));
        _bc.setHex(b.col || 0xffd27a); if (L > 1) _bc.multiplyScalar(3); // lasers glow hot for bloom
        C.tracers.setColorAt(n, _bc);
        C.tracers.setMatrixAt(n++, mtx);
      }
    }
    C.tracers.count = n;
    C.tracers.instanceMatrix.needsUpdate = true;
    if (C.tracers.instanceColor) C.tracers.instanceColor.needsUpdate = true;
  }

  /* ======================= LOCK-ON ======================= */
  /** Is target inside ac's missile seeker cone and range? */
  C.inSeeker = function (ac, t) {
    const m = ac.spec.msl;
    if (!m || !m.n || !t || !t.alive) return false;
    const as = ac.isPlayer && C.lockAssist; // Free Flight: a friendlier seeker for the player
    const d = tv.copy(t.pos).sub(ac.pos);
    const dist = d.length();
    if (dist > m.range * (as ? as.range : 1)) return false;
    const ang = Math.acos(RJ.clamp(d.dot(ac.fwd) / dist, -1, 1)) / DEG;
    return ang <= m.cone * (as ? as.cone : 1);
  };
  function updateLock(ac, dt) {
    const m = ac.spec.msl;
    if (!m || !m.n || ac.missiles <= 0) { ac.lockT = 0; ac.locked = false; return; }
    const t = ac.target;
    if (t && t.alive && C.inSeeker(ac, t)) {
      const resist = (t.spec.stealth || 1) * (t.spec.jammer ? 2 : 1);
      ac.lockT = Math.min(1, ac.lockT + dt / (m.lock * resist * (ac.isPlayer && C.lockAssist ? C.lockAssist.time : 1)));
      t.lockedByT = Math.max(t.lockedByT, 0.25);
      ac.locked = ac.lockT >= 1;
    } else { ac.lockT = Math.max(0, ac.lockT - dt * 2); ac.locked = false; }
  }
  /** Pick the enemy closest to the nose (for the player's target cycling). */
  C.cycleTarget = function (ac) {
    const list = C.enemiesOf(ac, true).map((e) => {
      const d = tv.copy(e.pos).sub(ac.pos); const dist = d.length();
      return { e, ang: Math.acos(RJ.clamp(d.dot(ac.fwd) / dist, -1, 1)), dist };
    }).sort((a, b) => a.ang - b.ang);
    if (!list.length) { ac.target = null; return; }
    const idx = list.findIndex((x) => x.e === ac.target);
    ac.target = list[(idx + 1) % list.length].e;
    ac.lockT = 0; ac.locked = false;
  };
  C.autoTarget = function (ac) {
    if (ac.target && ac.target.alive) return;
    let best = null, bs = Infinity;
    for (const e of C.enemiesOf(ac)) {
      const d = tv.copy(e.pos).sub(ac.pos); const dist = d.length();
      const ang = Math.acos(RJ.clamp(d.dot(ac.fwd) / dist, -1, 1));
      const s = ang * 3000 + dist + (C.crowd ? (e._tby || 0) * 1500 : 0); // big battles: spread attackers over the bandits
      if (s < bs) { bs = s; best = e; }
    }
    ac.target = best; ac.lockT = 0; ac.locked = false;
  };

  /* ======================= MISSILES ======================= */
  C.fireMissile = function (ac) {
    const m = ac.spec.msl;
    if (!m || ac.missiles <= 0 || ac.mslCd > 0 || !ac.alive) return false;
    if (!ac.locked || !ac.target || !ac.target.alive) return false;
    if (!(ac.isPlayer && RJ.game.mode && RJ.game.mode.infMsl)) ac.missiles--;
    ac.mslCd = 1.1; ac.stats.msl++;
    return C.launchMissile(ac, ac.target);
  };
  /** Put a missile in the air from ac toward target (no lock or ammo checks: also used for network copies). */
  C.launchMissile = function (ac, target) {
    const m = ac.spec.msl || {};
    if (!target) return false;
    const MF = RJ.missileFx, type = MF ? MF.typeFor(ac) : null;
    const mesh = MF ? MF.mesh(type) : C.missileTpl.clone();
    RJ.scene.add(mesh);
    const side = (ac.missiles + (ac.stats ? ac.stats.msl : 0)) % 2 ? 1 : -1;
    const p = ac.pos.clone().addScaledVector(ac.right, side * Math.min(3, ac.vis.dims.span * 0.25)).addScaledVector(ac.up, -1.2);
    const msl = {
      owner: ac, target, pos: p, vel: ac.vel.clone().addScaledVector(ac.up, -12), mesh, type,
      speed: ac.speed, top: (m.speed || 950), t: 0, burn: 3.2, life: 16, decoyed: null, lost: false, trailT: 0, ign: 0,
      gLimit: m.speed ? 25 : 32, dmg: m.speed ? 95 : 80
    };
    mesh.position.copy(p); mesh.quaternion.setFromUnitVectors(Z, tv.copy(ac.fwd).negate()); // leaves the rail pointing where the jet points
    if (MF) MF.launch(msl); // per-type turn limit, ignition delay, release puff
    if (ac.isPlayer && C.lockAssist) msl.burn *= C.lockAssist.burn; // Free Flight: the motor burns long enough to reach the longer lock range
    if (m.cone >= 180) {
      // all-aspect defensive launch: eject the missile toward the target so its seeker starts on it
      msl.vel.copy(target.pos).sub(p).normalize().multiplyScalar(Math.max(ac.speed * 0.6, 180));
      msl.speed = msl.vel.length();
    }
    C.missiles.push(msl);
    target.incoming.push(msl);
    RJ.emit("missile", { msl, by: ac });
    return true;
  };

  function updateMissiles(dt) {
    if (RJ.missileFx) RJ.missileFx.tick(dt);
    for (let i = C.missiles.length - 1; i >= 0; i--) {
      const m = C.missiles[i];
      m.t += dt; m.life -= dt;
      // off the rail / out of the bay: the missile falls clear of the jet for a moment before its motor lights
      // (missilefx sets m.ign per type), so it visibly separates instead of shooting out at full speed
      if (m.t < (m.ign || 0)) {
        m.vel.y -= RJ.G0 * dt; m.vel.multiplyScalar(1 - 0.08 * dt);
        m.pos.addScaledVector(m.vel, dt); m.speed = m.vel.length();
        m.mesh.position.copy(m.pos);
        m.mesh.quaternion.slerp(qq.setFromUnitVectors(Z, tv.copy(m.vel).normalize().negate()), Math.min(1, dt * 3));
        if (RJ.missileFx && m.type) RJ.missileFx.update(m, dt, 0);
        continue;
      }
      // motor: accelerate during burn (a hard kick in the first second of boost), then coast and bleed speed
      if (m.t < m.burn) m.speed = Math.min(m.top + m.owner.speed * 0.3, m.speed + (m.t - (m.ign || 0) < 1.2 ? 330 : 200) * dt);
      else m.speed = Math.max(150, m.speed - (40 + m.speed * 0.04) * dt * (0.4 + RJ.rho(m.pos.y)));
      const tgtObj = m.decoyed || m.target;
      let tpos = null, tvel = null;
      if (m.decoyed && m.decoyed.life > 0) { tpos = m.decoyed.p; tvel = m.decoyed.v; }
      else if (!m.decoyed && m.target && m.target.alive && !m.lost) { tpos = m.target.pos; tvel = m.target.vel; }
      const dir = tv.copy(m.vel).normalize();
      if (tpos) {
        const rel = tv2.copy(tpos).sub(m.pos);
        const dist = rel.length();
        // seeker gimbal limit: beaming / hard breaks can defeat the missile
        const off = Math.acos(RJ.clamp(rel.dot(dir) / dist, -1, 1));
        if (off > 75 * DEG && m.t > 0.6) m.lost = true;
        // flares: each live flare inside the seeker cone has a chance to seduce it
        if (!m.decoyed && m.t > 0.3) {
          for (const f of C.flares) {
            if (f.life <= 0 || f.tested.has(m) || f.owner !== m.target) continue;
            const fr = tv3.copy(f.p).sub(m.pos); const fd = fr.length();
            if (fd > dist * 1.25 + 200) continue;
            f.tested.add(m);
            const fang = Math.acos(RJ.clamp(fr.dot(dir) / fd, -1, 1));
            const jam = m.target.spec.jammer ? 0.15 : 0;
            if (fang < 30 * DEG && Math.random() < (C.crowd ? 0.24 : 0.38) + jam) { m.decoyed = f; break; }
          }
        }
        // proportional navigation toward a lead point
        const closing = Math.max(80, m.speed - tvel.dot(rel) / Math.max(dist, 1));
        const tgo = dist / closing;
        const aim = tv3.copy(tpos).addScaledVector(tvel, tgo * 0.9).sub(m.pos).normalize();
        let maxTurn = (m.gLimit * RJ.G0 / Math.max(m.speed, 100)) * dt;
        if (m.target && m.target.spec.jammer && !m.decoyed) maxTurn *= 0.6;
        const ang = Math.acos(RJ.clamp(aim.dot(dir), -1, 1));
        if (ang > 1e-4) dir.lerp(aim, Math.min(1, maxTurn / ang)).normalize();
        m.turn = RJ.damp(m.turn || 0, maxTurn > 0 ? Math.min(ang, maxTurn) / maxTurn : 0, 8, dt); // 1 = pulling at the limit
        // proximity fuse
        if (dist < (m.decoyed ? 10 : 14 + (m.target ? m.target.radius * 0.4 : 0))) { detonate(m, i, m.decoyed ? null : m.target); continue; }
      }
      m.vel.copy(dir).multiplyScalar(m.speed);
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(Z, tv2.copy(dir).negate());
      if (RJ.missileFx && m.type) RJ.missileFx.update(m, dt, m.turn || 0);
      else {
        const fl = m.mesh.getObjectByName("flame"); if (fl) fl.visible = m.t < m.burn;
        m.trailT += dt;
        if (m.trailT > 0.02) { m.trailT = 0; if (m.t < m.burn) { RJ.fx.smoke(m.pos, tv2.copy(m.vel).multiplyScalar(0.02), 1.3, 0.9, 3.5, 0.6); RJ.fx.fire(m.pos, tv2.copy(m.vel).multiplyScalar(0.5), 1.2); } }
      }
      const gnd = RJ.world.ground(m.pos.x, m.pos.z);
      if (m.pos.y < gnd || m.life <= 0) { detonate(m, i, null); continue; }
    }
  }
  function detonate(m, i, hit) {
    if (RJ.missileFx && m.type) RJ.missileFx.impact(m, hit && hit.alive ? hit : null);
    else RJ.fx.explosion(m.pos, 0.6, null);
    RJ.emit("explosion", { pos: m.pos.clone(), big: 0.6 * (m.boom || 1) });
    if (m.owner && m.owner.remote) { /* cosmetic copy of another player's missile: their game scores it */ }
    else if (hit && hit.alive) {
      hit.damage(m.dmg * RJ.rand(0.85, 1.15), m.owner, "missile");
      m.owner.stats.mslHits++;
      if (m.owner.isPlayer) RJ.emit("hitmarker", hit);
    } else if (m.target && m.target.alive) {
      // near-miss splash damage
      const d = m.pos.distanceTo(m.target.pos);
      if (d < 35) m.target.damage(m.dmg * 0.4 * (1 - d / 35), m.owner, "missile");
    }
    if (RJ.missileFx && m.type) RJ.missileFx.release(m); else RJ.scene.remove(m.mesh); // the smoke trail lingers and fades
    C.missiles.splice(i, 1);
    if (m.target) { const k = m.target.incoming.indexOf(m); if (k >= 0) m.target.incoming.splice(k, 1); }
  }

  /* ======================= FLARES ======================= */
  C.dropFlares = function (ac) {
    if (!ac.alive || ac.flares <= 0 || ac.flareCd > 0) return false;
    ac.flareCd = 0.55;
    const n = Math.min(2, ac.flares);
    for (let k = 0; k < n; k++) {
      ac.flares--; ac.stats.flares++;
      const side = k ? 1 : -1;
      const v = ac.vel.clone().multiplyScalar(0.55).addScaledVector(ac.right, side * 25).addScaledVector(ac.up, -18);
      const f = { p: ac.pos.clone(), v, life: 3.2, owner: ac, tested: new Set() };
      if (RJ.missileFx) RJ.missileFx.flareStart(f);
      C.flares.push(f);
    }
    RJ.emit("flares", ac);
    return true;
  };
  function updateFlares(dt) {
    for (let i = C.flares.length - 1; i >= 0; i--) {
      const f = C.flares[i];
      f.life -= dt;
      if (f.life <= 0) { if (RJ.missileFx) RJ.missileFx.flareEnd(f); C.flares.splice(i, 1); continue; }
      f.v.y -= RJ.G0 * dt; f.v.multiplyScalar(Math.pow(0.4, dt));
      f.p.addScaledVector(f.v, dt);
      if (RJ.missileFx) RJ.missileFx.flareUpdate(f, dt); else RJ.fx.flareGlow(f.p, f.v);
    }
  }

  /* ======================= BOMBS (free flight) ======================= */
  C.dropBomb = function (ac) {
    if (!ac.alive || ac.bombs <= 0 || ac.bombCd > 0) return false;
    ac.bombs--; ac.bombCd = 0.3;
    const mesh = C.bombTpl.clone(); RJ.scene.add(mesh);
    const side = ac.bombs % 2 ? 1 : -1;
    C.bombs.push({ p: ac.pos.clone().addScaledVector(ac.right, side * 2).addScaledVector(ac.up, -2), v: ac.vel.clone().addScaledVector(ac.up, -6), mesh, owner: ac, life: 40 });
    RJ.emit("bomb", ac);
    return true;
  };
  function updateBombs(dt) {
    for (let i = C.bombs.length - 1; i >= 0; i--) {
      const b = C.bombs[i];
      b.life -= dt;
      b.v.y -= RJ.G0 * dt; b.v.multiplyScalar(Math.pow(0.985, dt));
      b.p.addScaledVector(b.v, dt);
      b.mesh.position.copy(b.p);
      b.mesh.quaternion.setFromUnitVectors(Z, tv.copy(b.v).normalize().negate());
      const gnd = RJ.world.ground(b.p.x, b.p.z);
      if (b.p.y < gnd + 1 || b.life <= 0) {
        b.p.y = Math.max(b.p.y, gnd);
        RJ.fx.explosion(b.p, 2.2, null);
        if (gnd <= 0.5) RJ.fx.splash(b.p, 1.8); else RJ.fx.dust(b.p, 1.6);
        RJ.emit("explosion", { pos: b.p.clone(), big: 1.6 });
        RJ.scene.remove(b.mesh);
        C.bombs.splice(i, 1);
      }
    }
  }
  /** Where a bomb released now would land (for the HUD). */
  C.bombImpact = function (ac) {
    const p = ac.pos.clone(), v = ac.vel.clone(), st = 0.1, damp = Math.pow(0.985, st);
    for (let i = 0; i < 600; i++) {
      v.y -= RJ.G0 * st; v.multiplyScalar(damp); p.addScaledVector(v, st);
      if (p.y < RJ.world.ground(p.x, p.z)) return p;
    }
    return null;
  };

  /* ======================= AI PILOT ======================= */
  const DIFF = {
    rookie: { react: 0.45, gUse: 0.62, aim: 4.2 * DEG, flare: 0.35, mslRate: 0.25, evade: 0.45, lead: 0.6, minAgl: 380 },
    veteran: { react: 0.25, gUse: 0.82, aim: 2.6 * DEG, flare: 0.7, mslRate: 0.5, evade: 0.75, lead: 0.85, minAgl: 250 },
    ace: { react: 0.12, gUse: 0.97, aim: 1.6 * DEG, flare: 0.95, mslRate: 0.8, evade: 0.95, lead: 1.0, minAgl: 150 }
  };
  C.DIFF = DIFF;
  /* Fighting styles: how a pilot likes to win the merge. */
  const STYLES = {
    turner: { name: "turner", mslMul: 0.8, gunRange: 1100, closeAB: 2200 },     // rate fight at corner speed
    brawler: { name: "brawler", mslMul: 0.6, gunRange: 1300, closeAB: 1400 },   // presses in for guns
    boomer: { name: "boomer", mslMul: 1.0, gunRange: 900, closeAB: 2600 },      // boom-and-zoom: dive, shoot, extend, climb
    sniper: { name: "sniper", mslMul: 1.6, gunRange: 800, closeAB: 3000 }       // keeps missile range, cranks away when close
  };
  const pickStyle = (ac) => {
    const big = ["f15c", "f15ex", "f22", "yf23", "f14", "sr71", "yf12", "xb70"].includes(ac.id);
    const r = Math.random();
    return big ? (r < 0.4 ? "boomer" : r < 0.75 ? "sniper" : "turner") : (r < 0.55 ? "turner" : r < 0.85 ? "brawler" : "boomer");
  };
  C.STYLES = STYLES;
  const UPV = V3(0, 1, 0);
  /** Lowest clearance (m) along a straight path from p in direction d for the given distances. */
  function pathClear(p, d, dists, climb) {
    let m = Infinity;
    for (const s of dists) {
      const x = p.x + d.x * s, z = p.z + d.z * s, y = p.y + (climb || d.y) * s;
      m = Math.min(m, y - RJ.world.ground(x, z));
    }
    return m;
  }

  class Pilot {
    /** opts: role (fighter | wingman | strike | route | runner), style, order, leader, route, objective, alt */
    constructor(ac, skill, opts) {
      opts = opts || {};
      this.ac = ac; this.sk = (typeof skill === "string" ? DIFF[skill] : skill) || DIFF.veteran;
      this.t = Math.random() * 0.3; this.mode = "attack"; this.jinkT = 0; this.jinkDir = 1; this.burstT = 0;
      this.desired = V3().copy(ac.fwd); this.thr = 0.85; this.ab = false; this.fireWish = false;
      this.mslWait = RJ.rand(2, 5);
      this.role = opts.role || "fighter";
      this.style = STYLES[opts.style || pickStyle(ac)];
      this.order = opts.order || (this.role === "wingman" ? "cover" : null);
      this.leader = opts.leader || null;
      this.route = opts.route || null; this.wp = 0; this.loop = !!opts.loop;
      this.objective = opts.objective || null;
      this.alt = opts.alt || null;
      this.side = opts.side || (Math.random() < 0.5 ? -1 : 1);
      this.phase = null; this.phaseT = 0; this.stuckT = 0;
    }
    get done() { return !!this.route && this.wp >= this.route.length && !this.loop; }
    think() {
      const ac = this.ac, sk = this.sk, dtT = sk.react;
      this.phaseT -= dtT;
      // scripted break (formation split, flank): hold a heading for a moment, terrain permitting
      if (this.overT > 0) { this.overT -= dtT; this.mode = "break"; this.desired.copy(this.overDir); this.thr = 1; this.ab = true; this.fireWish = false; this.avoidTerrain(); return; }
      // ---------- target selection by role / order ----------
      if (this.role === "wingman" && this.leader && this.leader.alive) this.pickWingTarget();
      else if (this.role === "fighter" || this.role === "wingman") {
        C.autoTarget(ac); // a wingman without a leader fights on alone
        // limited sensors (Free Flight interceptors): beyond detection range they search the last known position
        if (this.detect && ac.target && ac.target.pos.distanceTo(ac.pos) > this.detect && !(ac.lastHitBy === ac.target && ac.time - ac.lastHitAt < 8)) ac.target = null;
      }
      else if (this.role === "strike" || this.role === "route" || this.role === "runner") ac.target = null;
      const tgt = ac.target && ac.target.alive ? ac.target : null;
      // ---------- threats ----------
      let threat = null, td = 1e9;
      for (const m of ac.incoming) { const d = m.pos.distanceTo(ac.pos); if (d < td) { td = d; threat = m; } }
      let gunner = null;
      for (const e of C.enemiesOf(ac)) {
        const rel = tv.copy(ac.pos).sub(e.pos); const d = rel.length();
        if (d < 1100 && rel.dot(e.fwd) / d > 0.96 && tv2.copy(e.pos).sub(ac.pos).dot(ac.fwd) < 0) { gunner = e; break; }
      }
      this.fireWish = false;
      const F = ac.spec.flight, corner = F.vstall * Math.sqrt(F.gmax) * 1.05;
      if (threat && td < 3200 && Math.random() < sk.evade) {
        this.mode = "evade";
        // beam the missile: turn perpendicular to its line of sight, dive slightly
        const los = tv.copy(threat.pos).sub(ac.pos).normalize();
        const side = tv2.copy(los).cross(UPV).normalize();
        if (side.dot(ac.fwd) < 0) side.negate();
        this.desired.copy(side).addScaledVector(UPV, -0.25).normalize();
        this.thr = 1; this.ab = true;
        if (td < 1800 && Math.random() < sk.flare) C.dropFlares(ac);
      } else if (gunner && this.role !== "route" && Math.random() < sk.evade) {
        this.mode = "defend";
        this.jinkT -= dtT;
        if (this.jinkT <= 0) { this.jinkT = RJ.rand(0.8, 2); this.jinkDir = Math.random() < 0.5 ? -1 : 1; }
        const away = tv.copy(ac.right).multiplyScalar(this.jinkDir).addScaledVector(ac.up, 0.6).addScaledVector(ac.fwd, 0.3).normalize();
        this.desired.copy(away);
        this.thr = 1; this.ab = true;
        if (ac.lockedByT > 0 && Math.random() < sk.flare * 0.3) C.dropFlares(ac);
      } else if (this.role === "route" || this.role === "strike" || this.role === "runner") this.flyRoute();
      else if (this.role === "wingman" && this.order === "form" && this.leader && this.leader.alive && !tgt) this.formUp(0);
      else if (this.role === "wingman" && this.order === "defend" && !tgt && this.objective) this.orbit(this.objective, 1300);
      else if (tgt) this.attack(tgt, corner);
      else if (this.role === "wingman" && this.leader && this.leader.alive) this.formUp(this.order === "cover" ? 180 : 0);
      else if (this.objective) this.orbit(this.objective, 1600);
      else {
        this.mode = "patrol";
        this.desired.copy(ac.fwd); this.desired.y = 0; this.desired.normalize();
        this.thr = 0.75; this.ab = false;
      }
      // ---------- energy: never wallow near the stall ----------
      if (ac.speed < F.vstall * 1.18 && ac.agl > 250 && this.mode !== "form") {
        this.mode = "recover";
        this.desired.set(ac.fwd.x, Math.min(ac.fwd.y, -0.25), ac.fwd.z).normalize();
        this.thr = 1; this.ab = true; this.fireWish = false;
      }
      if (C.crowd) {
        this.separate();
        // defensive barrel roll / missile-defeat roll now and then, so the sky isn't full of identical flat turns
        if ((this.mode === "defend" || this.mode === "evade") && !(this.rollT > 0) && Math.random() < 0.18 * sk.evade) { this.rollT = RJ.rand(1.1, 2.0); this.rollDir = Math.random() < 0.5 ? -1 : 1; }
      }
      this.avoidTerrain();
    }
    /** Big battles: steer clear of the nearest friendly on a collision course (formation slots excepted). */
    separate() {
      const ac = this.ac, R = this.mode === "form" ? 32 : 150;
      let best = null, bd = R * R * 4;
      for (const o of C.aircraft) {
        if (o === ac || !o.alive || (o.team !== ac.team && !(ac.neutral && o.isPlayer))) continue; // traffic also gives the player room
        const dx = o.pos.x - ac.pos.x, dy = o.pos.y - ac.pos.y, dz = o.pos.z - ac.pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = o; }
      }
      if (!best) return;
      const d = Math.sqrt(bd), rel = tv.copy(best.pos).sub(ac.pos);
      if (rel.dot(ac.fwd) < -0.3 * d) return; // it's behind us: its problem
      const closing = -tv2.copy(best.vel).sub(ac.vel).dot(rel) / Math.max(d, 1);
      if (d < R || (closing > 5 && d / closing < 3)) this.desired.addScaledVector(rel.normalize(), -(0.4 + 0.8 * (1 - Math.min(d / (2 * R), 1)))).addScaledVector(UPV, best.pos.y > ac.pos.y ? -0.2 : 0.2).normalize();
    }
    /** Wingman target choice from the player's order. */
    pickWingTarget() {
      const ac = this.ac, L = this.leader;
      if (this.order === "attack") { ac.target = L.target && L.target.alive && L.target.team !== ac.team ? L.target : (ac.target && ac.target.alive ? ac.target : null); if (!ac.target) C.autoTarget(ac); return; }
      if (this.order === "cover") {
        // engage whoever is threatening the leader: aiming at them, locked on, or sitting in their rear hemisphere
        let best = null, bs = Infinity;
        for (const e of C.enemiesOf(ac)) {
          const rel = tv.copy(L.pos).sub(e.pos), d = rel.length();
          const threat = e.target === L || (d < 3000 && rel.dot(e.fwd) / d > 0.7);
          if (!threat) continue;
          const sc = d + e.pos.distanceTo(ac.pos) * 0.5;
          if (sc < bs) { bs = sc; best = e; }
        }
        if (best) { if (ac.target !== best) { ac.target = best; ac.lockT = 0; ac.locked = false; } return; }
        if (ac.target && ac.target.alive && ac.target.pos.distanceTo(L.pos) < 4000) return;
        ac.target = null; return;
      }
      if (this.order === "defend" && this.objective) {
        let best = null, bs = Infinity;
        for (const e of C.enemiesOf(ac)) { const d = e.pos.distanceTo(this.objective); if (d < 5000 && d < bs) { bs = d; best = e; } }
        ac.target = best; return;
      }
      if (this.order === "form") {
        // only fight back if someone is actually shooting at us
        const shooter = ac.lastHitBy && ac.lastHitBy.alive && ac.time - ac.lastHitAt < 6 ? ac.lastHitBy : null;
        ac.target = shooter; return;
      }
    }
    attack(tgt, corner) {
      const ac = this.ac, sk = this.sk, st = this.style;
      this.mode = "attack";
      const rel = tv.copy(tgt.pos).sub(ac.pos);
      const dist = rel.length();
      const g = ac.spec.gun;
      const bspeed = g ? g.speed : 1000;
      const tof = dist / (bspeed + ac.speed * 0.5);
      const aim = tv2.copy(tgt.pos).addScaledVector(tgt.vel, tof * sk.lead).sub(ac.pos);
      if (dist > 2500) aim.copy(tgt.pos).addScaledVector(tgt.vel, Math.min(8, dist / Math.max(100, ac.speed))).sub(ac.pos);
      this.desired.copy(aim).normalize();
      const closing = -tv3.copy(tgt.vel).sub(ac.vel).dot(rel) / Math.max(dist, 1);
      const off = Math.acos(RJ.clamp(tv3.copy(aim).normalize().dot(ac.fwd), -1, 1));
      // ---- stalemate breaker: circling with the nose well off the target for too long ----
      if (dist < 3000 && off > 1.2) this.stuckT += sk.react; else this.stuckT = Math.max(0, this.stuckT - sk.react * 2);
      if (this.stuckT > 11 && !this.phase) { this.phase = st.name === "turner" || st.name === "brawler" ? "vertical" : "extend"; this.phaseT = this.phase === "extend" ? RJ.rand(5, 7) : RJ.rand(3, 4.5); this.stuckT = 0; }
      // ---- boom-and-zoom: trade height for speed, then climb away again ----
      if (st.name === "boomer" && !this.phase && dist < 3200 && ac.pos.y < tgt.pos.y + 300 && ac.speed > corner * 1.05 && off > 0.5) { this.phase = "zoom"; this.phaseT = RJ.rand(4, 6); }
      if (st.name === "sniper" && !this.phase && dist < 1300 && off > 0.6) { this.phase = "extend"; this.phaseT = RJ.rand(4, 6); }
      if (this.phase && this.phaseT <= 0) this.phase = null;
      if (this.phase === "extend") {
        this.mode = "extend";
        // run away from the fight, unloaded and in burner, then come back around
        this.desired.copy(rel).negate().setY(0).normalize().addScaledVector(UPV, 0.05).normalize();
        this.thr = 1; this.ab = true; return;
      }
      if (this.phase === "vertical") {
        this.mode = "vertical";
        this.desired.copy(ac.fwd).setY(0).normalize().addScaledVector(ac.right, this.side * 0.4).addScaledVector(UPV, 1.1).normalize();
        this.thr = 1; this.ab = true; return;
      }
      if (this.phase === "zoom") {
        this.mode = "zoom";
        this.desired.copy(ac.fwd).setY(0).normalize().addScaledVector(UPV, 0.9).normalize();
        this.thr = 1; this.ab = true;
        if (ac.pos.y > tgt.pos.y + 900) this.phase = null;
        return;
      }
      // avoid head-on collisions
      if (dist < 350 && closing > 150) this.desired.addScaledVector(ac.up, 0.7).normalize();
      // energy management by style
      if (st.name === "turner") { this.ab = dist > st.closeAB || ac.speed < corner * 0.95; this.thr = ac.speed > corner * 1.25 && dist < 1500 ? 0.55 : 0.95; }
      else if (st.name === "brawler") { this.ab = dist > st.closeAB || ac.speed < corner; this.thr = dist < 500 && closing > 80 ? 0.4 : 1; }
      else { this.ab = dist > st.closeAB || ac.speed < corner * 1.1; this.thr = dist < 700 && closing > 60 ? 0.45 : 0.95; }
      // snipers hold the target at missile range with a crank
      if (st.name === "sniper" && dist > 1500 && dist < 4500 && ac.locked) this.desired.addScaledVector(ac.right, this.side * 0.35).normalize();
      this.fireWish = !!g && dist < st.gunRange && off < sk.aim * (1 + 300 / Math.max(dist, 150));
      // missiles
      this.mslWait -= sk.react;
      if (ac.locked && this.mslWait <= 0 && Math.random() < sk.mslRate * st.mslMul) {
        if (C.fireMissile(ac)) this.mslWait = RJ.rand(5, 10) / (sk.mslRate * st.mslMul);
      }
    }
    /** Waypoint following for bombers, strike packages and fleeing targets. */
    flyRoute() {
      const ac = this.ac;
      this.mode = "route";
      if (!this.route || !this.route.length) { this.desired.copy(ac.fwd).setY(0).normalize(); return; }
      if (this.wp >= this.route.length) { if (this.loop) this.wp = 0; else { this.desired.copy(ac.fwd).setY(0).normalize(); this.thr = 0.8; return; } }
      const w = this.route[this.wp];
      const rel = tv.copy(w).sub(ac.pos);
      const dh = Math.hypot(rel.x, rel.z);
      if (dh < Math.max(450, ac.speed * 2.5)) { this.wp++; return this.flyRoute(); }
      this.desired.set(rel.x / dh, RJ.clamp((w.y - ac.pos.y) / Math.max(dh, 400), -0.35, 0.45), rel.z / dh).normalize();
      const F = ac.spec.flight;
      this.thr = this.role === "runner" ? 1 : this.role === "strike" ? 0.9 : 0.78;
      this.ab = this.role === "runner" || ac.speed < F.vstall * 1.6;
      // cruise speed (Free Flight traffic): airliners hold their cruise instead of a fixed throttle
      if (this.cruise && this.role !== "runner") { this.thr = RJ.clamp(0.62 + (this.cruise - ac.speed) * 0.025, 0.08, 1); this.ab = ac.speed < this.cruise - 25 && this.cruise > F.vmax * 0.7; }
      if (this.role === "runner") {
        // jink now and then so a straight tail chase isn't free
        this.jinkT -= this.sk.react;
        if (this.jinkT <= 0) { this.jinkT = RJ.rand(2, 4); this.jinkDir = -this.jinkDir; }
        this.desired.addScaledVector(ac.right, this.jinkDir * 0.25).normalize();
      }
    }
    /** Formation slot off the leader's wing (spread > 0 for a looser cover position). */
    formUp(spread) {
      const ac = this.ac, L = this.leader;
      this.mode = "form";
      const d = L.vis.dims, k = this.formK || 1, back = (30 + d.len * 1.4) * k + spread, out = ((22 + d.span * 1.2) * k + spread * 0.6) * this.side * (this.formOut || 1);
      const flatF = tv3.copy(L.fwd).setY(0).normalize(), flatR = V3(-flatF.z, 0, flatF.x);
      const slot = tv.copy(L.pos).addScaledVector(flatF, -back).addScaledVector(flatR, out).addScaledVector(UPV, 6 + spread * 0.2);
      const lead = tv2.copy(slot).addScaledVector(L.vel, 1.6).sub(ac.pos);
      const gap = lead.length();
      this.desired.copy(lead).normalize();
      if (gap < 160) this.desired.lerp(L.fwd, 1 - gap / 160).normalize();
      const along = tv3.copy(slot).sub(ac.pos).dot(L.fwd);
      this.thr = RJ.clamp((L.throttle || 0.8) + along * 0.004, 0.15, 1);
      this.ab = along > 350 || (L.abLevel > 0.2 && along > 40);
    }
    orbit(c, R) {
      const ac = this.ac;
      this.mode = "orbit";
      const rel = tv.copy(ac.pos).sub(c).setY(0);
      const d = rel.length() || 1;
      const tang = tv2.set(-rel.z / d * this.side, 0, rel.x / d * this.side);
      const radial = tv3.copy(rel).multiplyScalar(-(d - R) / (d * 800));
      this.desired.copy(tang).add(radial);
      const wantY = Math.max(c.y + 700, RJ.world.ground(ac.pos.x, ac.pos.z) + 500);
      this.desired.y = RJ.clamp((wantY - ac.pos.y) / 1500, -0.3, 0.4);
      this.desired.normalize();
      this.thr = 0.8; this.ab = false;
    }
    /** Look along the real flight path; if it hits terrain, pick the escape heading with the most room. */
    avoidTerrain() {
      const ac = this.ac, sk = this.sk;
      const v = Math.max(ac.speed, 80), vdir = tv.copy(ac.vel).normalize();
      const dists = [v * 1.2, v * 2.5, v * 4.5];
      const clear = Math.min(ac.agl, pathClear(ac.pos, vdir, dists));
      const need = sk.minAgl * (this.role === "runner" || this.role === "strike" ? 0.55 : 1) * (C.crowd ? 1.3 : 1);
      // diving at a target near the ground: never commit below the floor
      if (ac.agl < need * 2.2 && this.desired.y < -0.1) this.desired.y = -0.1;
      if (clear >= need && ac.agl >= need * 0.7) return;
      this.mode = "climb"; this.rollT = 0;
      const flat = tv2.copy(ac.fwd).setY(0).normalize();
      let best = null;
      for (const a of [0, -0.6, 0.6, -1.1, 1.1]) {
        const d = flat.clone().applyAxisAngle(UPV, a);
        const c = pathClear(ac.pos, d, dists, 0.35) - Math.abs(a) * 40;
        if (!best || c > best.c) best = { d, c };
      }
      const urgent = clear < need * 0.4 || ac.agl < need * 0.35;
      this.desired.copy(best.d).addScaledVector(UPV, urgent ? 1.3 : 0.65).normalize();
      this.ab = true; this.thr = 1; this.fireWish = false;
    }
    update(dt) {
      const ac = this.ac;
      if (!ac.alive) return;
      this.t -= dt;
      if (this.t <= 0) { this.t = this.sk.react * RJ.rand(0.8, 1.2); this.think(); }
      // bank-to-turn steering toward the desired direction
      const inv = new THREE.Quaternion().copy(ac.q).invert();
      const l = tv.copy(this.desired).applyQuaternion(inv);
      const off = Math.acos(RJ.clamp(-l.z, -1, 1));
      let rollErr = Math.atan2(l.x, Math.max(l.y, -1e9));
      if (off < 0.12) rollErr = RJ.lerp(-ac.bank * 0.8, rollErr, off / 0.12);
      const roll = RJ.clamp(rollErr * 2.4, -1, 1);
      let pitch = 0;
      const gUse = this.mode === "form" || this.mode === "route" || this.mode === "orbit" ? Math.min(this.sk.gUse, 0.55) : this.sk.gUse;
      if (l.y > 0 || Math.abs(rollErr) < 1.2) pitch = RJ.clamp(off * 3.2, 0, 1) * Math.max(0, Math.cos(rollErr)) * gUse;
      if (off < 0.1) pitch = RJ.clamp(l.y * 12, -0.4, 1) * gUse;
      ac.input.pitch = pitch;
      ac.input.roll = roll;
      ac.input.yaw = off < 0.15 ? RJ.clamp(l.x * 8, -1, 1) : 0;
      ac.input.thrAbs = this.thr;
      ac.input.ab = this.ab;
      ac.input.brake = this.mode === "form" && this.thr < 0.2;
      if (this.rollT > 0 && ac.agl > 400 && this.mode !== "climb" && this.mode !== "recover") { this.rollT -= dt; ac.input.roll = this.rollDir; ac.input.pitch = 0.5 * gUse; ac.input.yaw = 0; }
      // fire in bursts
      if (this.fireWish && !ac.overheated) { this.burstT += dt; ac.input.guns = this.burstT < 0.7; if (this.burstT > 1.1) this.burstT = 0; }
      else { ac.input.guns = false; this.burstT = 0; }
    }
  }
  C.Pilot = Pilot;

  /* ======================= CROWD LOD ======================= */
  /* In big battles, aircraft beyond ~2.5 km from the camera are drawn as one instanced low-poly silhouette each
   * (a single draw call for all of them) instead of their full model, and beyond 6 km they simulate at half rate. */
  function impostorGeo() {
    const P = [], tri = (a, b, c) => P.push(...a, ...b, ...c);
    const n = [0, 0, -0.5], t = [0, 0, 0.5], r = [[0.05, 0, -0.15], [0, 0.045, -0.15], [-0.05, 0, -0.15], [0, -0.035, -0.15]];
    const r2 = r.map((v) => [v[0] * 0.8, v[1] * 0.8, 0.45]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; tri(n, r[j], r[i]); tri(r[i], r[j], r2[j]); tri(r[i], r2[j], r2[i]); tri(r2[i], r2[j], t); }
    tri([0, 0, -0.12], [-0.46, 0, 0.22], [0, 0, 0.3]); tri([0, 0, -0.12], [0, 0, 0.3], [0.46, 0, 0.22]); // wings
    tri([0, 0, 0.3], [-0.17, 0, 0.5], [0, 0, 0.5]); tri([0, 0, 0.3], [0, 0, 0.5], [0.17, 0, 0.5]); // tailplanes
    tri([0, 0.03, 0.28], [0, 0.03, 0.5], [0, 0.19, 0.52]); // fin
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
    return g;
  }
  C.impostorGeo = impostorGeo;
  const _m4 = new THREE.Matrix4(), _sc = V3(), _ic = new THREE.Color();
  C.drawCrowd = function (camera) {
    if (!C.crowdMesh) {
      C.crowdMesh = new THREE.InstancedMesh(impostorGeo(), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 160);
      C.crowdMesh.frustumCulled = false; C.crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      RJ.scene.add(C.crowdMesh);
    }
    const cm = C.crowdMesh, cp = camera.position, mode = RJ.game.mode, focus = mode && (mode.player && mode.player.alive ? mode.player : mode.spectate);
    const myTeam = mode && mode.player ? mode.player.team : "blue";
    let n = 0;
    for (const a of C.aircraft) {
      if (a.state === "dead") { a.lodFar = false; a.simFar = false; continue; }
      const d = a.pos.distanceTo(cp);
      const far = a !== focus && !a.isPlayer && (a.lodFar ? d > 2200 : d > 2600);
      a.simFar = far && d > 6000 && a.state === "flying" && a.agl > 1500;
      if (far !== !!a.lodFar) { a.lodFar = far; a.mesh.visible = !far; if (!far) a.syncMesh(); }
      if (!far || n >= 160) continue;
      // grow slowly with range so distant jets stay readable as specks instead of vanishing
      const s = a.vis.dims.len * Math.max(1, d / 2000);
      _m4.compose(a.pos, a.q, _sc.set(s, s, s));
      cm.setMatrixAt(n, _m4);
      cm.setColorAt(n, _ic.setHex(a.neutral ? 0xdfe3e7 : a.team === myTeam ? 0x5a6676 : 0x6a5a52)); // traffic: light airframes
      n++;
    }
    cm.count = n; cm.visible = n > 0;
    cm.instanceMatrix.needsUpdate = true; if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  };

  /* ======================= PER-FRAME ======================= */
  C.update = function (dt0) {
    C.crowd = C.aircraft.length > 16 || !!C.forceCrowd; // big battles (and Free Flight traffic) switch on the crowd optimisations (LOD, staggered updates)
    for (const ac of C.aircraft) {
      let dt = dt0;
      if (ac.simFar) { ac._simAcc = (ac._simAcc || 0) + dt0; if (ac._simAcc < dt0 * 1.99) continue; dt = ac._simAcc; ac._simAcc = 0; } // far away: half-rate physics + AI
      if (ac.kin && ac.alive) ac.kin(dt); // tight-formation slot (airshows): placed off the leader instead of flown
      else {
        if (ac.pilot) ac.pilot.update(dt);
        ac.update(dt);
      }
      if (ac.alive) {
        updateLock(ac, dt);
        if (ac.spec.gun && ac.spec.gun.turret) turret(ac, dt);
        else if (ac.bombs > 0 && ac.isPlayer && RJ.game && RJ.game.allowBombs) {
          ac.firing = false;
          if (ac.input.guns) C.dropBomb(ac);
        } else if (!(RJ.game && RJ.game.weaponsOff && !ac.pilot)) C.fireGun(ac, dt);
      } else ac.firing = false;
      ac.updateVisual(dt);
    }
    const dt = dt0;
    updateBullets(dt);
    updateMissiles(dt);
    updateFlares(dt);
    updateBombs(dt);
    // mid-air collisions (big battles: every other step, which is still every 17 ms)
    C._cs = !C._cs;
    if (C.crowd && C._cs) return;
    const A = C.aircraft;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j];
      if (!a.alive || !b.alive || (a.team === b.team && a.air && b.air && a.air.show && a.air.show === b.air.show)) continue; // a display team's choreography never collides with itself
      const r = (a.radius + b.radius) * 0.55;
      if (a.pos.distanceToSquared(b.pos) < r * r) { a.destroy(b, "collision"); b.destroy(a, "collision"); }
    }
  };
})(window.RJ);
