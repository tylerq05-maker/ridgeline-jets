/* Jet City — Jet Combat Simulator cinematic camera (RJ.csCam, see docs/CS-INTERFACES.md). Ten shots framed on the
 * selected jet (M.sel) plus a Director's Cut that cuts on combat events with professional pacing. Smoothing happens
 * relative to a moving anchor (jet, missile, mid-point) so 700 m/s jets stay framed; fixed shots (ground, fly-by,
 * impact) aim straight at the action. No per-frame randomness: choices are made once, at the cut. */
(function (RJ) {
  "use strict";
  const V3 = (x, y, z) => new THREE.Vector3(x || 0, y || 0, z || 0), DEG = Math.PI / 180, UP = V3(0, 1, 0), ZERO = V3();
  const SHOTS = ["chase", "wide", "headon", "profile", "cockpit", "overwing", "missile", "ground", "closeup", "flyby"];
  const LABELS = { chase: "Chase", wide: "Wide", headon: "Head-on", profile: "Profile", cockpit: "Cockpit", overwing: "Over the wing",
    missile: "Missile cam", ground: "Ground to sky", closeup: "Close-up", flyby: "Fly-by" };
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const kx = (rate, dt) => (rate >= 99 ? 1 : 1 - Math.exp(-rate * dt));
  const alive = (ac) => !!ac && ac.alive !== false && ac.state !== "dead";
  const live = (m) => !!m && RJ.combat.missiles.includes(m);
  const DIMS = { len: 15, span: 10, height: 4 };

  RJ.csCam = {
    SHOTS, LABELS,
    create(M) {
      const st = {
        shot: "wide", auto: true, t: 0, hold: 7, rt: 0, prio: 0, lockT: 0, hist: [], n: 0, alt: 0,
        off: V3(), lookOff: V3(), fov: 50, up: V3(0, 1, 0), snap: true, blend: null,
        cp: V3(), cl: V3(), cAnchor: ZERO, fixed: null, side: 1, cd: 260, wdir: V3(1, 0, 0), passT: -1,
        msl: null, mslSeen: false, mslDir: V3(0, 0, -1), impact: null,
        focusAc: null, focusT: 0, dead: new Map(), endPending: false, endOrbit: false, hitT: -99, didC: false, didV: false
      };
      const mid = V3(), P = V3(), L = V3(), Ut = V3(), t1 = V3(), t2 = V3(), t3 = V3(), fp = V3(), fl = V3(), fu = V3();
      const R = { fov: 50, anchor: ZERO, pr: 4, lr: 6, roll: 0, fr: 2.5, ground: false };
      const gnd = (x, z) => RJ.world.ground(x, z);

      // frozen stand-in for a destroyed jet: its last position with level axes, so shots keep framing the explosion
      function ghost(ac) {
        if (!ac || st.dead.has(ac)) return;
        const f = ac.fwd.clone().setY(0); if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
        st.dead.set(ac, { pos: ac.pos.clone(), fwd: f, up: UP.clone(), right: f.clone().cross(UP).normalize(), vel: V3(), speed: 0,
          vis: ac.vis, mesh: ac.mesh, q: ac.q, ghost: true, t: st.rt });
      }
      const body = (ac) => (alive(ac) ? ac : st.dead.get(ac) || ac);
      const dims = (ac) => (ac && ac.vis && ac.vis.dims) || DIMS;
      const survivor = () => (alive(M.A) && !alive(M.B) ? M.A : alive(M.B) && !alive(M.A) ? M.B : alive(M.sel) ? M.sel : null);
      const over = () => M.ended || !alive(M.A) || !alive(M.B);
      function subject() {
        if (st.focusAc && st.rt < st.focusT) return st.focusAc;
        if (st.endOrbit) return survivor() || M.sel;
        return M.sel;
      }

      /* ---------- cutting ---------- */
      function startBlend(dur) {
        st.blend = { anchor: st.cAnchor, off: st.cp.clone().sub(st.cAnchor), lookOff: st.cl.clone().sub(st.cAnchor), fov: st.fov, up: st.up.clone(), t: 0, dur };
      }
      function cut(id, o) {
        o = o || {};
        const S = body(subject()), oB = body(M.other(subject()));
        if (o.soft && st.n) startBlend(o.soft); else st.blend = null;
        st.snap = true; // the new framing is exact at once; a soft cut eases in from the old one via the blend
        if (st.shot !== id) { st.hist.push(st.shot); if (st.hist.length > 3) st.hist.shift(); }
        st.shot = id; st.t = 0; st.n++; st.fixed = null; st.passT = -1; st.prio = o.prio || 0;
        st.hold = o.hold || (id === "cockpit" ? RJ.rand(4, 6) : id === "flyby" ? 8 : RJ.rand(5, 9));
        st.lockT = st.rt + (o.lock || 2.5);
        // per-shot one-off choices
        const rel = t1.copy(oB ? oB.pos : S.pos).sub(S.pos), rs = rel.dot(S.right) >= 0 ? 1 : -1;
        if (id === "profile") st.side = -rs; // opponent beyond the subject
        else if (id === "overwing") st.side = -rs; // shoulder away from the bandit, looking past the canopy
        else if (id === "closeup") { st.alt ^= 1; st.side = st.alt ? 1 : -1; st.cd = 150 + ((st.n * 97) % 250); }
        else if (id === "ground" || id === "flyby" || id === "headon") st.side = st.n % 2 ? 1 : -1;
        if (id === "wide") {
          mid.copy(S.pos).lerp(oB && !st.endOrbit ? oB.pos : S.pos, 0.5);
          const p = t2.copy(rel).setY(0); if (p.lengthSq() < 1) p.copy(S.fwd).setY(0); if (p.lengthSq() < 1e-4) p.set(0, 0, -1);
          p.normalize(); st.wdir.set(-p.z, 0, p.x); if (t3.copy(st.cp).sub(mid).dot(st.wdir) < 0) st.wdir.negate();
        }
      }
      // event-driven cut in Director's Cut: a stronger event may interrupt; otherwise respect the minimum hold
      function want(id, prio, o) {
        if (!st.auto) return false;
        if (prio < st.prio && st.rt < st.lockT) return false;
        if (prio <= st.prio && st.t < 2.5 && st.n > 1) return false;
        if (id === st.shot && !(o && o.force)) { st.prio = prio; st.hold = Math.max(st.hold, st.t + ((o && o.hold) || 4)); return true; }
        cut(id, Object.assign({ prio }, o));
        return true;
      }
      function next() {
        const S = subject(), O = M.other(S);
        if (st.endPending || (over() && !st.endOrbit && st.rt >= st.focusT)) { st.endPending = false; st.endOrbit = true; st.focusAc = null; cut("wide", { soft: 2, hold: 1e9 }); return; }
        if (st.endOrbit) { st.t = 0; return; }
        if (st.rt - st.hitT < 3 && alive(S) && st.shot !== "closeup") { cut("closeup", { hold: 4 }); return; }
        const sep = alive(O) ? S.pos.distanceTo(O.pos) : 1e9;
        // far apart, a wide shot shows two specks: favour shots that hold the subject big in frame
        let pool = sep > 2500 ? ["chase", "closeup", "overwing", "chase", "profile", "cockpit", "closeup", "ground"]
          : ["chase", "overwing", "closeup", "profile", "headon", "cockpit", "flyby", "ground", "wide", "chase", "closeup", "overwing"];
        if (!alive(S)) pool = ["closeup", "ground", "wide"];
        if (S.speed < 80) pool = pool.filter((s) => s !== "flyby");
        let c = pool.filter((s) => s !== st.shot && !st.hist.slice(-2).includes(s));
        if (!c.length) c = pool.filter((s) => s !== st.shot);
        const id = c[Math.floor(Math.random() * c.length)];
        cut(id, { soft: id === "wide" || st.shot === "wide" ? 1.4 : 0 });
      }

      /* ---------- shots: fill P (camera), L (look), R (fov, anchor, smoothing rates, roll-follow) ---------- */
      function pose(id, Sac) {
        const S = body(Sac), Oac = M.other(Sac), oA = alive(Oac) && alive(Sac), O = body(Oac), d = dims(Sac), big = Math.max(d.span, d.len);
        R.fov = 55; R.anchor = S.pos; R.pr = 5; R.lr = 7; R.roll = 0; R.fr = 2.5; R.ground = false; R.up = null;
        const rel = t1.copy(O ? O.pos : S.pos).sub(S.pos), dist = rel.length(), relN = t2.copy(rel).multiplyScalar(1 / Math.max(1, dist));
        if (id === "cockpit" && !alive(Sac)) id = "closeup";
        if (id === "missile") {
          if (st.impact) {
            const I = st.impact, tg = alive(I.tgt) && I.tgt.pos.distanceTo(I.pos) < 900 ? I.tgt.pos : I.pos;
            P.copy(I.cam); L.copy(tg); R.anchor = ZERO; R.pr = 99; R.lr = 8; R.fov = RJ.clamp(Math.atan2(60, P.distanceTo(tg)) * 2 / DEG, 12, 45); R.fr = 4;
            return id;
          }
          let m = st.msl;
          if (!live(m)) { // manual: newest live missile involving the subject, else any
            const ms = RJ.combat.missiles; m = null;
            for (let i = ms.length - 1; i >= 0; i--) if (ms[i].owner === Sac || ms[i].target === Sac) { m = ms[i]; break; }
            if (!m && ms.length) m = ms[ms.length - 1];
            if (m && m !== st.msl) { st.msl = m; st.mslSeen = true; st.snap = true; }
          }
          if (live(m)) {
            if (m.vel.lengthSq() > 25) st.mslDir.copy(m.vel).normalize();
            P.copy(m.pos).addScaledVector(st.mslDir, -32).addScaledVector(UP, 6);
            const tg = m.target && alive(m.target) ? m.target.pos : t3.copy(m.pos).addScaledVector(st.mslDir, 400);
            L.copy(m.pos).addScaledVector(t3.copy(tg).sub(m.pos).normalize(), 300);
            R.anchor = m.pos; R.pr = 10; R.lr = 6; R.fov = 58;
            return id;
          }
          id = "chase"; // no missile in the air: ride along until there is
        }
        if (id === "wide" && st.endOrbit) {
          // the fight is over: a slow orbit of the survivor (or of the last wreck)
          const c = S.pos, r = Math.max(170, big * 12);
          P.copy(c).addScaledVector(st.wdir, r).addScaledVector(UP, r * 0.28); L.copy(c);
          R.fov = 42; R.pr = 2.5; R.lr = 99; return id;
        }
        switch (id) {
          case "chase": {
            const back = Math.max(42, d.len * 3.2);
            P.copy(S.pos).addScaledVector(S.fwd, -back).addScaledVector(S.up, d.height * 1.2 + 5).addScaledVector(UP, 3);
            L.copy(S.pos).addScaledVector(S.fwd, 40);
            if (oA && relN.dot(S.fwd) > 0.55) L.lerp(O.pos, Math.min(0.25, 300 / Math.max(300, dist)));
            R.fov = 62; R.pr = 4; R.lr = 6; R.roll = 0.45; break;
          }
          case "wide": {
            const far = oA ? O.pos : S.pos, sep = S.pos.distanceTo(far);
            mid.copy(S.pos).lerp(far, 0.5);
            // keep the line of sight across the fight, never along it; turn slowly without flipping sides
            const p = t3.copy(far).sub(S.pos).setY(0);
            if (p.lengthSq() > 100) { p.normalize(); p.set(-p.z, 0, p.x); if (p.dot(st.wdir) < 0) p.negate(); st.wdir.lerp(p, kx(0.3, st.dt)).normalize(); }
            const D = Math.max(sep * 1.35, 650);
            P.copy(mid).addScaledVector(st.wdir, D).addScaledVector(UP, D * 0.28); L.copy(mid).lerp(S.pos, 0.2);
            R.anchor = mid; R.fov = 48; R.pr = 1.5; R.lr = 2.5; break;
          }
          case "headon": {
            P.copy(S.pos).addScaledVector(S.fwd, d.len * 4.5 + 35).addScaledVector(S.up, d.height * 0.6 + 3).addScaledVector(S.right, st.side * d.span * 0.3);
            L.copy(S.pos); if (oA && relN.dot(S.fwd) < -0.3) L.lerp(O.pos, Math.min(0.3, 250 / Math.max(250, dist)));
            R.fov = 52; R.pr = 8; R.lr = 8; break;
          }
          case "profile": {
            P.copy(S.pos).addScaledVector(S.right, st.side * (d.len * 5 + 45)).addScaledVector(S.fwd, d.len * 0.3).addScaledVector(UP, d.height * 0.5);
            L.copy(S.pos).addScaledVector(S.fwd, d.len * 0.4);
            R.fov = 38; R.pr = 5; R.lr = 8; break;
          }
          case "cockpit": {
            const ck = (Sac.vis && Sac.vis.cockpit) || (Sac.mesh && Sac.mesh.userData.cockpit) || t3.set(0, d.height * 0.6, -d.len * 0.25);
            P.copy(ck); if (Sac.mesh) P.multiply(Sac.mesh.scale); P.applyQuaternion(Sac.q).add(Sac.pos);
            L.copy(P).addScaledVector(Sac.fwd, 100);
            R.fov = 65; R.pr = 99; R.lr = 99; R.roll = 1; R.up = Sac.up; break;
          }
          case "overwing": {
            P.copy(S.pos).addScaledVector(S.right, st.side * d.span * 0.42).addScaledVector(S.up, d.height * 0.75 + 1.2).addScaledVector(S.fwd, -(d.len * 0.55 + 3));
            const dir = oA && relN.dot(S.fwd) > 0.55 ? relN : S.fwd;
            L.copy(P).addScaledVector(dir, 300);
            R.fov = 68; R.pr = 99; R.lr = 5; R.roll = 0.85; break;
          }
          case "closeup": {
            const dir = t3.copy(S.fwd).multiplyScalar(0.55).addScaledVector(S.right, st.side * 0.75).addScaledVector(UP, 0.3).normalize();
            P.copy(S.pos).addScaledVector(dir, st.cd); L.copy(S.pos);
            R.fov = RJ.clamp(Math.atan2(big * 1.25, st.cd) * 2 / DEG, 6, 14); R.pr = 1.2; R.lr = 99; R.fr = 6; break;
          }
          case "ground": {
            const F = st.fixed;
            let need = !F;
            if (F) {
              const v = t3.copy(S.pos).sub(F), dd = v.length(), h = st.gdir;
              need = dd > 5500 || (v.x * h.x + v.z * h.z > 0 && dd > 2500) || (v.y < dd * 0.035 && dd > 3000);
            }
            if (need) {
              const h = (st.gdir = st.gdir || V3()).copy(S.vel.lengthSq() > 25 ? S.vel : S.fwd).setY(0);
              if (h.lengthSq() < 1e-4) h.set(0, 0, -1); h.normalize();
              const ahead = Math.min(Math.max(S.speed, 100) * 4, 3000) + 300;
              const p = (st.fixed = st.fixed || V3()).copy(S.pos).addScaledVector(h, ahead).add(t3.set(-h.z * st.side * 700, 0, h.x * st.side * 700));
              p.y = gnd(p.x, p.z) + 2; if (F) st.snap = true;
            }
            P.copy(st.fixed); L.copy(S.pos);
            R.anchor = ZERO; R.pr = 99; R.lr = 99; R.fr = 6; R.ground = true;
            R.fov = RJ.clamp(Math.atan2(big * 4, P.distanceTo(S.pos)) * 2 / DEG, 3, 30); break;
          }
          case "flyby": {
            if (st.fixed) {
              const v = t3.copy(st.fixed).sub(S.pos), dd = v.length();
              if (st.passT < 0 && v.dot(S.fwd) < 0) st.passT = st.rt;
              if ((st.passT >= 0 && dd > 900 && !st.auto) || dd > 4000) { st.fixed = null; st.passT = -1; st.snap = true; }
            }
            if (!st.fixed) {
              const h = t3.copy(S.vel.lengthSq() > 25 ? S.vel : S.fwd).normalize();
              st.fixed = V3().copy(S.pos).addScaledVector(h, Math.max(450, S.speed * 2.4)).addScaledVector(S.right, st.side * (d.span * 1.6 + 18)).addScaledVector(S.up, -(d.height + 4));
              const g = gnd(st.fixed.x, st.fixed.z) + 15; if (st.fixed.y < g) st.fixed.y = g;
            }
            P.copy(st.fixed); L.copy(S.pos);
            R.anchor = ZERO; R.pr = 99; R.lr = 99; R.fov = 50; break;
          }
        }
        return id;
      }

      /* ---------- per frame ---------- */
      function update(camera, rdt) {
        const dt = (st.dt = Math.min(Math.max(rdt || 0, 0), 0.1));
        st.rt += dt; st.t += dt;
        if (!st.n) cut("wide", { hold: 6 });
        for (const ac of [M.A, M.B]) if (ac && !alive(ac)) ghost(ac);
        if (st.focusAc && st.rt >= st.focusT) st.focusAc = null;
        // missile detonation: hold on the impact for a moment
        if (st.msl) {
          if (live(st.msl)) st.mslSeen = true;
          else if (st.mslSeen) {
            st.mslSeen = false;
            if (st.shot === "missile" && !st.impact) {
              const m = st.msl, c = m.pos.clone().addScaledVector(st.mslDir, -140).addScaledVector(UP, 35).add(t1.set(-st.mslDir.z * 40, 0, st.mslDir.x * 40));
              const g = gnd(c.x, c.z) + 15; if (c.y < g) c.y = g;
              st.impact = { pos: m.pos.clone(), tgt: m.target, cam: c, t: 0 }; st.snap = true;
            }
          }
        }
        if (st.impact) { st.impact.t += dt; if (st.impact.t > 1.7 || st.shot !== "missile") { st.impact = null; st.prio = 0; if (st.auto && st.shot === "missile") next(); } }
        // Director's Cut pacing
        if (st.auto) {
          const mslBusy = st.shot === "missile" && (live(st.msl) || st.impact) && st.t < 16;
          const flyDone = st.shot === "flyby" && st.passT >= 0 && st.rt - st.passT > 1.4 && st.t > 2.5;
          if (!mslBusy && (st.t > st.hold || flyDone || (st.endPending && st.rt >= st.focusT))) next();
          else if (!st.endOrbit && over() && st.rt >= st.focusT && st.t > 2.5 && !mslBusy) next();
        }
        if (st.endOrbit) st.wdir.applyAxisAngle(UP, 0.12 * dt);
        else if (st.shot === "wide") st.wdir.applyAxisAngle(UP, 0.03 * dt);

        const Sac = subject();
        pose(st.shot, Sac);
        const A = R.anchor, upT = Ut.copy(UP);
        if (R.up) upT.copy(R.up); else if (R.roll > 0) upT.lerp(body(Sac).up, R.roll).normalize();
        if (st.snap) { st.off.copy(P).sub(A); st.lookOff.copy(L).sub(A); st.up.copy(upT); st.fov = R.fov; st.snap = false; }
        else {
          if (st.cAnchor !== A) { st.off.copy(st.cp).sub(A); st.lookOff.copy(st.cl).sub(A); } // anchor swapped (jet -> wreck): rebase, no pop
          st.off.lerp(t1.copy(P).sub(A), kx(R.pr, dt)); st.lookOff.lerp(t2.copy(L).sub(A), kx(R.lr, dt));
          st.up.lerp(upT, kx(R.roll >= 1 ? 99 : 5, dt)).normalize();
        }
        st.fov += (R.fov - st.fov) * kx(R.fr, dt);
        fp.copy(A).add(st.off); fl.copy(A).add(st.lookOff); fu.copy(st.up);
        let fov = st.fov;
        // soft transition (subject switch, pull-back to wide): ease from the previous framing, which keeps riding its anchor
        if (st.blend) {
          const B = st.blend; B.t += dt;
          const b = ease(B.t / B.dur);
          fp.lerpVectors(t1.copy(B.anchor).add(B.off), fp, b); fl.lerpVectors(t2.copy(B.anchor).add(B.lookOff), fl, b);
          fu.lerpVectors(B.up, fu, b).normalize(); fov = B.fov + (fov - B.fov) * b;
          if (B.t >= B.dur) st.blend = null;
        }
        // never inside terrain, buildings or sea
        const g = gnd(fp.x, fp.z) + (R.ground && !st.blend ? 1.5 : 15); if (fp.y < g) fp.y = g;
        st.cAnchor = A; st.cp.copy(fp); st.cl.copy(fl);
        camera.position.copy(fp); camera.up.copy(fu); camera.lookAt(fl);
        if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
        return "cinematic";
      }

      /* ---------- combat events ---------- */
      function onEvent(e) {
        const S = M.sel, ac = e.ac, isS = ac === S, dd = e.data || {};
        switch (e.type) {
          case "select": // same shot, new subject: a quick blend rather than a pop
            startBlend(0.8); st.snap = true; st.fixed = null; st.passT = -1; st.focusAc = null;
            if (st.shot === "missile" && st.msl && st.msl.owner !== ac && st.msl.target !== ac) st.msl = null;
            break;
          case "contact": if (!st.didC) { st.didC = true; want(e.data && e.data.range > 4000 ? "chase" : "wide", 1, { soft: 1.5, hold: 6 }); } break;
          case "visual":
            if (!st.didV && alive(S)) {
              st.didV = true; const O = M.other(S), f = t3.copy(O.pos).sub(S.pos).normalize().dot(S.fwd) > 0.5;
              want(f ? "headon" : "wide", 1, { soft: f ? 0 : 1.2, hold: 5 });
            }
            break;
          case "merge": case "nearmiss":
            if (st.shot === "missile" && live(st.msl)) break;
            st.alt ^= 1; if (want(st.alt ? "profile" : "flyby", 3, { hold: 4, force: true })) M.slowMo(1.2);
            break;
          case "launch": {
            const m = dd.msl; if (!m) break;
            if (st.shot === "missile" && live(st.msl) && (st.msl.owner === S || st.msl.target === S)) break;
            if (!st.auto && st.shot === "missile") { st.msl = m; st.impact = null; st.snap = true; break; }
            if (isS || m.target === S || !live(st.msl)) { const prev = st.msl; st.msl = m; st.mslSeen = false; st.impact = null; if (!want("missile", 4, { hold: 14, lock: 14, force: true })) st.msl = prev; }
            break;
          }
          case "incoming": case "break": case "flares":
            if (isS) { st.alt ^= 1; want(st.alt ? "chase" : "overwing", 2, { hold: 5 }); } else want("overwing", 2, { hold: 5 });
            break;
          case "onsix": if (isS) want("headon", 2, { hold: 5 }); else want("overwing", 2, { hold: 5 }); break;
          case "tally6": if (isS) want("overwing", 2, { hold: 5 }); else { st.alt ^= 1; want(st.alt ? "chase" : "headon", 2, { hold: 5 }); } break;
          case "hit": case "heavydamage":
            if (isS || dd.by === S) { st.hitT = st.rt; want("closeup", 3, { hold: 3.5 }); }
            break;
          case "down": {
            ghost(ac); M.slowMo(2.5, 0.3);
            st.endPending = true;
            if (st.auto) { st.focusAc = ac; st.focusT = st.rt + 4.5; st.alt ^= 1; cut(st.alt ? "closeup" : "ground", { prio: 5, hold: 4.5, lock: 4.5 }); }
            break;
          }
        }
      }

      const api = {
        update, onEvent, subject,
        shots: SHOTS.slice(),
        set(id) {
          if (!SHOTS.includes(id)) return;
          st.auto = false; st.endPending = false; st.focusAc = null;
          if (id !== "wide") st.endOrbit = false; else if (over()) st.endOrbit = true;
          cut(id, { soft: id === "wide" ? 1.2 : 0, hold: 1e9 });
        },
        label() {
          if (st.shot === "wide" && st.endOrbit) return "Orbit";
          if (st.shot === "missile" && st.impact) return "Impact";
          if (st.shot === "missile" && !live(st.msl) && !RJ.combat.missiles.length) return "Missile cam (standby)";
          return LABELS[st.shot] || st.shot;
        },
        dispose() { st.msl = null; st.impact = null; st.blend = null; st.dead.clear(); st.focusAc = null; }
      };
      Object.defineProperty(api, "auto", {
        get: () => st.auto,
        set: (v) => { v = !!v; if (v && !st.auto) { st.hold = Math.min(st.hold, st.t + 2); st.prio = 0; } st.auto = v; },
        enumerable: true
      });
      Object.defineProperty(api, "shot", { get: () => st.shot, set: (v) => api.set(v), enumerable: true });
      return api;
    }
  };
})(window.RJ);
