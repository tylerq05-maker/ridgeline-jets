/* Ridgeline Jets — medal challenges.
 * Ten set pieces laid out on the real landmarks: castle gates, the canyon bridge, the carrier, the summit…
 * Each has a clear objective, visible checkpoints with route arrows, a timer or a score, collision (the normal
 * flight physics: terrain, water, castle masonry, bridge steel), bronze/silver/gold thresholds, personal bests
 * in RJ.progress.medals, and an instant retry. Courses are seeded, so every attempt (and every ghost) flies
 * the same route. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3, DEG = RJ.DEG, TAU = Math.PI * 2;
  const CH = (RJ.challenges = {});
  const MODES = () => RJ.modes;
  const dirFromYaw = (yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const yawFromDir = (d) => Math.atan2(-d.x, -d.z);
  const G = (x, z) => Math.max(RJ.world.ground(x, z), 0);
  const GT = (x, z) => RJ.world.heightFn(x, z);
  // approximate wingspans (m) for the aircraft that won't fit through a 36 m castle gate or onto a carrier deck
  const SPAN = { b52: 56, b2: 52, b21: 45, b1b: 41, xb70: 32, f14: 19.5, a10: 17.5, sr71: 17, yf12: 17 };
  const span = (id) => SPAN[id] || 14;
  const supersonic = (ac) => ac.flight.vmax >= 400;
  const ft = (m) => `${RJ.fmtInt(Math.max(0, m) * 3.281)} ft`;
  CH.RANK = { bronze: 1, silver: 2, gold: 3 };
  const MEDAL_XP = [0, 120, 240, 400];

  /* ---------------- checkpoints ---------------- */
  const ring = (pos, r, label) => ({ type: "ring", pos, r, label: label || "RING" });
  /** Rectangular gate: centre pos, travel direction n (horizontal), half width hw, open between y0 and y1. */
  function gate(pos, n, hw, y0, y1, label, vis) {
    const nn = n.clone().setY(0).normalize();
    return { type: "gate", pos, n: nn, u: V3(-nn.z, 0, nn.x), hw, y0, y1, label: label || "GATE", vis: vis || { h: y1 - y0 }, fixed: true };
  }
  const zone = (pos, r, label) => ({ type: "zone", pos, r, label: label || "TARGET" });
  /** Rings face along the route: normal = direction from the previous point to the next. */
  function orient(cps, start) {
    cps.forEach((cp, i) => {
      if (cp.fixed || cp.type !== "ring") return;
      const prv = i ? cps[i - 1].pos : start, nxt = cps[i + 1] ? cps[i + 1].pos : null;
      cp.n = (nxt ? nxt.clone().sub(prv) : cp.pos.clone().sub(prv)).normalize();
    });
    return cps;
  }
  function testCp(cp, p, prevSide) {
    const rel = p.clone().sub(cp.pos);
    if (cp.type === "zone") return { passed: rel.length() < cp.r, side: 0 };
    const side = rel.dot(cp.n);
    const crossed = prevSide != null && Math.sign(side) !== Math.sign(prevSide) && Math.abs(side - prevSide) < 400;
    if (cp.type === "ring") {
      const radial = rel.clone().addScaledVector(cp.n, -side).length();
      if ((crossed && radial < cp.r * 1.05) || rel.length() < cp.r * 0.9) return { passed: true, side };
      return { passed: false, side, missed: crossed && radial < cp.r * 6 };
    }
    const lat = Math.abs(rel.dot(cp.u));
    if (crossed && lat < cp.hw && p.y > cp.y0 && p.y < cp.y1) return { passed: true, side };
    return { passed: false, side, missed: crossed && lat < cp.hw * 4 };
  }

  /* ---------------- checkpoint visuals ---------------- */
  function gateMesh(hw, h) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.95, fog: false });
    const t = RJ.clamp(Math.min(hw, h) * 0.035, 0.8, 4);
    for (const [x, y, w, hh] of [[0, h / 2, hw * 2 + t, t], [0, -h / 2, hw * 2 + t, t], [-hw, 0, t, h], [hw, 0, t, h]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, t), mat);
      m.position.set(x, y, 0); m.layers.set(RJ.LATE); g.add(m);
    }
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, h), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    disc.layers.set(RJ.LATE); g.add(disc);
    g.userData = { ring: { material: mat }, disc };
    return g;
  }
  function zoneMesh(r) {
    const g = MODES().ringMesh(r);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    beam.scale.set(1, 900 / r, 1); beam.rotation.x = Math.PI / 2; // the group is turned to lie flat, so its local z is world up
    beam.layers.set(RJ.LATE); g.add(beam);
    return g;
  }
  function cpMesh(cp) {
    let m;
    if (cp.type === "gate") { m = gateMesh(cp.hw, cp.vis.h); m.position.copy(cp.pos); if (cp.vis.base != null) m.position.y = cp.vis.base + cp.vis.h / 2; m.lookAt(m.position.clone().add(cp.n)); }
    else if (cp.type === "zone") { m = zoneMesh(cp.r); m.position.copy(cp.pos); m.lookAt(cp.pos.clone().add(V3(0, 1, 0))); }
    else { m = MODES().ringMesh(cp.r); m.position.copy(cp.pos); m.lookAt(cp.pos.clone().add(cp.n)); }
    return m;
  }

  /* ---------------- route builders ---------------- */
  /** Seeded valley-following course (same idea as Free Flight's ring courses, but repeatable). */
  function course(start, yaw, n, o) {
    const rng = RJ.world.gen.mulberry32(o.seed >>> 0), UP = V3(0, 1, 0);
    const pts = [];
    let p = V3(start.x, 0, start.z), dir = dirFromYaw(yaw);
    for (let i = 0; i < n; i++) {
      let best = null, bc = Infinity;
      for (let a = -60; a <= 60; a += 10) {
        const d = dir.clone().applyAxisAngle(UP, a * DEG);
        const p1 = p.clone().addScaledVector(d, o.step), p2 = p.clone().addScaledVector(d, o.step * 2);
        let c = G(p1.x, p1.z) + G(p2.x, p2.z) * 0.6 + Math.abs(a) * o.turnCost;
        if (o.avoid) for (const q of o.avoid) { const dd = Math.hypot(p1.x - q.x, p1.z - q.z); if (dd < q.r) c += (q.r - dd) * 3; }
        if (c < bc) { bc = c; best = { d, p1 }; }
      }
      dir = best.d; p = best.p1;
      const q = p.clone();
      if (o.slalom) q.addScaledVector(V3(-dir.z, 0, dir.x), (i % 2 ? 1 : -1) * o.slalom);
      q.y = G(q.x, q.z) + o.alt[0] + (o.alt[1] - o.alt[0]) * rng();
      pts.push(q);
    }
    clearLine(pts, V3(start.x, Math.max(start.y || 0, G(start.x, start.z) + o.clear), start.z), o.clear);
    return pts;
  }
  /** Raise each point until the straight line from the previous one clears the ground. */
  function clearLine(pts, start, clear) {
    for (let i = 0; i < pts.length; i++) {
      const a = i ? pts[i - 1] : start, b = pts[i];
      b.y = Math.max(b.y, G(b.x, b.z) + clear);
      for (let s = 0.1; s < 0.99; s += 0.1) {
        const gx = a.x + (b.x - a.x) * s, gz = a.z + (b.z - a.z) * s, gy = a.y + (b.y - a.y) * s;
        const h = G(gx, gz) + clear;
        if (gy < h) b.y += (h - gy) / s;
      }
    }
    return pts;
  }
  /** Highest ground along a straight line (for safe start altitudes). */
  function maxAlong(a, b, step) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(L / (step || 80)));
    let m = 0;
    for (let i = 0; i <= n; i++) m = Math.max(m, G(a.x + (b.x - a.x) * (i / n), a.z + (b.z - a.z) * (i / n)));
    return m;
  }
  /** Walk along the river from the canyon bridge, snapping to the channel floor (follows bends). */
  function riverWalk(b, sgn, dist, step) {
    step = step || 300;
    let p = V3(b.x, 0, b.z), d = V3(-Math.sin(b.th), 0, Math.cos(b.th)).multiplyScalar(sgn);
    const out = [];
    for (let s = step; s <= dist + 1; s += step) {
      const q = p.clone().addScaledVector(d, step), perp = V3(-d.z, 0, d.x);
      let best = q, bh = Infinity;
      for (let o = -260; o <= 260; o += 20) {
        const x = q.x + perp.x * o, z = q.z + perp.z * o, h = GT(x, z) + Math.abs(o) * 0.03;
        if (h < bh) { bh = h; best = V3(x, 0, z); }
      }
      d = best.clone().sub(p).setY(0).normalize(); p = best;
      out.push(V3(p.x, Math.max(GT(p.x, p.z), b.wl), p.z));
    }
    return out;
  }
  function castleFrame() {
    const s = RJ.atlas.plan.castle, c = Math.cos(s.rot), n = Math.sin(s.rot);
    return {
      s,
      w: (lx, lz, y) => V3(s.x + lx * c + lz * n, y || 0, s.z - lx * n + lz * c),
      dir: (lx, lz) => V3(lx * c + lz * n, 0, -lx * n + lz * c).normalize(),
      local: (p) => { const dx = p.x - s.x, dz = p.z - s.z; return [dx * c - dz * n, dx * n + dz * c]; }
    };
  }
  const pathLen = (start, cps) => { let L = 0, prev = start; for (const c of cps) { L += c.pos.distanceTo(prev); prev = c.pos; } return L; };
  const ringR = (ac, min) => Math.max(min || 30, span(ac.id) * 0.75 + 14);

  /* ---------------- landing scoring helpers ---------------- */
  function glideText(dev) { return Math.abs(dev) < 0.35 ? "on glide path" : dev > 0 ? (dev > 1 ? "HIGH" : "slightly high") : (dev < -1 ? "LOW" : "slightly low"); }
  function lineupText(lat) { return Math.abs(lat) < 6 ? "on centreline" : lat > 0 ? `${Math.round(lat)} m right` : `${Math.round(-lat)} m left`; }

  /* ======================= THE TEN CHALLENGES ======================= */
  CH.DEFS = [
    {
      id: "castlegate", name: "Castle Gate Run", icon: "castle", where: "Highkeep Castle", metric: "time",
      desc: "Thread all four gates of Highkeep, swing around the back and thread them again the other way.",
      env: { time: "golden", weather: "scattered" }, sunBehind: true,
      req: (ac) => (span(ac.id) > 30 ? "Wingspan too wide for the 36 m castle gates" : null),
      build(ac) {
        const F = castleFrame(), s = F.s, gi = RJ.castle.gateInfo();
        const zs = gi.zs.slice().sort((a, b) => b - a);
        const fwd = F.dir(0, -1), back = F.dir(0, 1), top = gi.low - 3, hw = gi.half - 1.5;
        const mk = (zg, n, i) => gate(F.w(0, zg, s.elev + top / 2), n, hw, s.elev - 40, s.elev + gi.low - 1, `GATE ${i}`, { h: top });
        const start = F.w(0, 2000);
        start.y = Math.max(s.elev + 26, maxAlong(start, F.w(0, 320)) + 30);
        const cps = zs.map((z, i) => mk(z, fwd, i + 1));
        const r1 = F.w(-720, -1550); r1.y = Math.max(s.elev + 70, G(r1.x, r1.z) + 90);
        const r2 = F.w(0, -1080); r2.y = Math.max(s.elev + 24, maxAlong(r2, F.w(0, -330)) + 26);
        cps.push(ring(r1, 48, "TURN"));
        cps.push(Object.assign(ring(r2, 40, "LINE UP"), { n: back, fixed: true }));
        zs.slice().reverse().forEach((z, i) => cps.push(mk(z, back, i + 5)));
        orient(cps, start);
        const L = pathLen(start, cps) * 1.1;
        return { pos: start, yaw: yawFromDir(fwd), speed: Math.min(170, MODES().cruiseSpeed(ac)), throttle: 0.75, cps, par: L / Math.min(ac.flight.vmax * 0.5, 200) + 3, finishOnLast: true,
          brief: "8 gates · stay below the gate arches", objective: "Fly through the yellow frame in each gate. The lintels above are solid stone." };
      }
    },
    {
      id: "canyon", name: "Canyon Runner", icon: "bridge", where: "The bridge gorge", metric: "time",
      desc: "16 rings down the river gorge under the Canyon Bridge. Climb out of the canyon and you're disqualified.",
      env: { time: "morning", weather: "clear" },
      build(ac) {
        const b = RJ.atlas.plan.bridge; if (!b) return null;
        const up = riverWalk(b, -1, 2700);
        const s0 = up[up.length - 1], s1 = up[up.length - 2];
        const yaw = yawFromDir(V3(s1.x - s0.x, 0, s1.z - s0.z));
        const start = V3(s0.x, G(s0.x, s0.z) + 60, s0.z);
        const pts = course(start, yaw, 16, { step: 380, alt: [40, 70], clear: 20, turnCost: 1.0, seed: 7101 });
        const r = ringR(ac, 34);
        const cps = orient(pts.map((p, i) => ring(p, r, i === pts.length - 1 ? "FINISH" : "RING")), start);
        const ceiling = Math.max(230, ...pts.map((p) => p.y - G(p.x, p.z) + 90));
        return { pos: start, yaw, speed: Math.min(160, MODES().cruiseSpeed(ac)), throttle: 0.7, cps, par: pathLen(start, cps) * 1.08 / Math.min(ac.flight.vmax * 0.45, 210) + 3, finishOnLast: true,
          ceiling, brief: "16 rings · stay inside the canyon", objective: `Follow the rings down the gorge. Climbing more than ${Math.round(ceiling)} m above the ground for 4 s disqualifies you.` };
      }
    },
    {
      id: "bridge", name: "Bridge Daredevil", icon: "bridge", where: "The Canyon Bridge", metric: "time",
      desc: "Skim the river, fly UNDER the Canyon Bridge between its towers, and race on down the gorge.",
      env: { time: "golden", weather: "scattered" },
      req: (ac) => (span(ac.id) > 45 ? "Wingspan too wide to fit between the bridge towers" : null),
      build(ac) {
        const b = RJ.atlas.plan.bridge, lm = RJ.atlas.byId.bridge; if (!b || !lm) return null;
        const up = riverWalk(b, -1, 2400, 200);
        const s0 = up[up.length - 1];
        const start = V3(s0.x, G(s0.x, s0.z) + 55, s0.z);
        const lowRing = (p, label) => ring(V3(p.x, G(p.x, p.z) + 38, p.z), ringR(ac, 40), label);
        const cps = [7, 5, 3, 1].map((i) => lowRing(up[i]));
        const g = lm.underGate, d = V3(-Math.sin(b.th), 0, Math.cos(b.th));
        const yGate = Math.min((g.yMin + g.yMax) / 2, g.yMin + 60);
        cps.push(gate(V3(b.x, yGate, b.z), d, (g.xMax - g.xMin) / 2, g.yMin, g.yMax, "UNDER THE BRIDGE", { h: Math.min(g.yMax - g.yMin, 120), base: g.yMin }));
        // downstream the gorge bends hard around a spur, so follow the valley floor rather than a straight walk
        const dn2 = course(V3(b.x, g.yMin + 30, b.z), yawFromDir(d), 4, { step: 320, alt: [34, 42], clear: 18, turnCost: 0.5, seed: 991 });
        dn2.forEach((p, i) => cps.push(ring(p, ringR(ac, 40), i === dn2.length - 1 ? "FINISH" : "RING")));
        // keep the line between checkpoints clear of the canyon walls (the gate itself stays put)
        let prev = start;
        for (const c of cps) { if (c.type === "ring") clearLine([c.pos], prev, 18); prev = c.pos; }
        orient(cps, start);
        const s1 = up[up.length - 2];
        return { pos: start, yaw: yawFromDir(V3(s1.x - s0.x, 0, s1.z - s0.z)), speed: Math.min(150, MODES().cruiseSpeed(ac)), throttle: 0.7, cps,
          par: pathLen(start, cps) * 1.06 / Math.min(ac.flight.vmax * 0.5, 230) + 3, finishOnLast: true,
          brief: "Under the deck, between the towers", objective: "Stay low over the river. The bridge deck and cables are solid. Go under it." };
      }
    },
    {
      id: "lowpass", name: "Mach One Low Pass", icon: "ship", where: "Off the coast", metric: "score", better: "lower",
      medals: [15.24, 45.72, 152.4], fmt: (v) => ft(v), fmtTarget: (v) => `below ${ft(v)}`,
      desc: "Break the sound barrier as low as you dare over the sea. Under 500 ft for bronze, under 50 ft for gold.",
      env: { time: "morning", weather: "scattered" },
      req: (ac) => (supersonic(ac) ? null : "Needs a supersonic aircraft"),
      build(ac) {
        const P = RJ.atlas.plan, c = P.carrier || P.lighthouse; if (!c) return null;
        let best = null;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * TAU, dx = Math.cos(a), dz = Math.sin(a);
          let d = 0; while (d < 30000 && G(c.x + dx * d, c.z + dz * d) <= 0.5) d += 400;
          if (!best || d > best.d) best = { d, dx, dz };
        }
        // start offset sideways from the carrier so the run passes clear of the ship
        const pos = V3(c.x - best.dz * 1500, 110, c.z + best.dx * 1500);
        const sp = Math.min(RJ.soundSpeed(110) * 0.86, ac.flight.vmax * 0.8);
        return { pos, yaw: yawFromDir(V3(best.dx, 0, best.dz)), speed: sp, throttle: 1, cps: [], limit: 60, limitWhy: "Didn't break Mach 1 within a minute",
          brief: "Break Mach 1 below 500 ft", objective: "Full afterburner. Hold it low and level over the waves. Your height when you go supersonic is your score." };
      },
      onBoom(m, ac) {
        const agl = ac.agl;
        if (agl > 152.4) m.fail(`Broke Mach 1 at ${ft(agl)}. Stay below 500 ft.`);
        else m.finish(agl, [["Height at Mach 1", ft(agl)], ["Speed", `M ${ac.mach.toFixed(2)}`]]);
      }
    },
    {
      id: "breakturn", name: "High-G Break Turn", icon: "ship", where: "Over the sea", metric: "score", better: "lower", difficulty: "Hard",
      medals: [6.5, 8, 10], fmt: (v) => `${v.toFixed(2)} s`, fmtTarget: (v) => `under ${v.toFixed(1)} s`,
      desc: "Hard. Reverse your heading 180° as fast as you can in a maximum-G break turn. Humid sea air makes condensation pour off the wings. Pull at least 6 G and hold your altitude within 300 m.",
      env: { time: "morning", weather: "scattered" },
      req: (ac) => (ac.flight.gmax >= 7 ? null : "Needs a fighter that can pull 7 G"),
      build(ac) {
        const P = RJ.atlas.plan, c = P.carrier || P.lighthouse; if (!c) return null;
        const pos = V3(c.x + 6000, 1200, c.z - 6000);
        return { pos, yaw: 0, speed: Math.min(ac.flight.corner * 1.3, ac.flight.vmax * 0.7), throttle: 1, cps: [], limit: 60, limitWhy: "Didn't complete the turn within a minute",
          brief: "Break turn: 180° at max G", objective: "Roll hard into a 90° bank and pull as hard as the jet allows until you've turned all the way around. Watch the vapor stream off the wings." };
      },
      guide(m, pl) {
        const b = m.brk || {};
        return `G ${pl.g.toFixed(1)} · peak ${(b.peak || 0).toFixed(1)} G · turned ${Math.round(Math.abs(b.turned || 0) * 180 / Math.PI)}° of 180° · ${b.t0 != null ? (m.t - b.t0).toFixed(1) + " s" : "pull to start the clock"}`;
      },
      tick(m, pl) {
        const b = m.brk || (m.brk = { turned: 0, peak: 0, alt0: pl.pos.y, prev: null, t0: null });
        const hx = pl.fwd.x, hz = pl.fwd.z, hl = Math.hypot(hx, hz);
        if (hl > 0.2) {
          const h = Math.atan2(hx, -hz);
          if (b.prev != null && b.t0 != null) { let d = h - b.prev; d = Math.atan2(Math.sin(d), Math.cos(d)); b.turned += d; }
          b.prev = h;
        }
        if (b.t0 == null && Math.abs(pl.g) > 3) b.t0 = m.t;
        b.peak = Math.max(b.peak, Math.abs(pl.g));
        if (Math.abs(pl.pos.y - b.alt0) > 300) return m.fail(`Altitude changed by ${Math.round(Math.abs(pl.pos.y - b.alt0))} m. Keep the turn level (±300 m).`);
        if (Math.abs(b.turned) >= Math.PI) {
          if (b.peak < 6) return m.fail(`Peak load was only ${b.peak.toFixed(1)} G. A break turn needs 6 G or more.`);
          m.finish(m.t - b.t0, [["Peak load", `${b.peak.toFixed(1)} G`], ["Altitude change", `${Math.round(pl.pos.y - b.alt0)} m`], ["Exit speed", `${Math.round(pl.speed * RJ.speedUnit()[1])} ${RJ.speedUnit()[0]}`]]);
        }
      }
    },
    {
      id: "summit", name: "Summit Sprint", icon: "peak", where: "The Mountain Summit", metric: "time",
      desc: "Race 8 km over ridges and valleys to the highest peak in the range. The rings hug the terrain.",
      env: { time: "dawn", weather: "scattered" }, sunBehind: true,
      build(ac) {
        const S = RJ.atlas.plan.summit, h = RJ.atlas.home; if (!S) return null;
        let dx = h.x - S.x, dz = h.z - S.z; const L0 = Math.hypot(dx, dz) || 1; dx /= L0; dz /= L0;
        const sx = S.x + dx * 8000, sz = S.z + dz * 8000;
        const start = V3(sx, G(sx, sz) + 160, sz);
        const top = V3(S.x, S.elev + 70, S.z);
        const cps = [];
        for (const f of [0.2, 0.4, 0.6, 0.8]) {
          const x = sx + (S.x - sx) * f, z = sz + (S.z - sz) * f;
          cps.push(ring(V3(x, G(x, z) + 150, z), ringR(ac, 42)));
        }
        clearLine(cps.map((c) => c.pos), start, 60);
        cps.push(zone(top, 230, "SUMMIT"));
        orient(cps, start);
        return { pos: start, yaw: yawFromDir(V3(-dx, 0, -dz)), speed: MODES().cruiseSpeed(ac), throttle: 0.9, cps, par: pathLen(start, cps) * 1.05 / Math.min(ac.flight.vmax * 0.5, 260) + 4, finishOnLast: true,
          brief: "4 rings, then the summit beacon", objective: "Climb through the rings and pass over the summit beacon." };
      }
    },
    {
      id: "landing", name: "Precision Landing", icon: "base", where: "Home airbase", metric: "score", better: "higher",
      medals: [850, 650, 400], fmt: (v) => `${Math.round(v)} pts`, fmtTarget: (v) => `${Math.round(v)} pts`,
      desc: "Fly the approach and plant the wheels on the aim point, on the centreline, gently. Then stop on the runway.",
      env: { time: "morning", weather: "scattered" },
      build(ac) {
        const ab = RJ.atlas.home.ab;
        const d0 = V3(ab.dx, 0, ab.dz).normalize();
        // pick the runway end and the longest straight-in final whose line stays clear of the valley walls
        let best = null;
        for (const sg of [1, -1]) {
          const d = d0.clone().multiplyScalar(sg), thr = V3(ab.x, ab.elev, ab.z).addScaledVector(d, -ab.len / 2);
          let need = 0, D = 0;
          for (let k = 1; k <= 20; k++) {
            const dist = k * 200, p = thr.clone().addScaledVector(d, -dist);
            const n2 = Math.max(need, Math.atan2(G(p.x, p.z) + 45 - ab.elev, dist + 300));
            if (n2 > 6 * DEG && dist > 1400) break;
            need = n2; D = dist;
          }
          const score = D - need / DEG * 150;
          if (!best || score > best.score) best = { d, thr, need, D, score };
        }
        const ang = RJ.clamp(best.need, 3 * DEG, 7 * DEG), D = Math.max(1400, best.D);
        const pos = best.thr.clone().addScaledVector(best.d, -D);
        pos.y = Math.max(ab.elev + Math.tan(ang) * (D + 300), maxAlong(pos, best.thr, 50) + 50);
        const aim = best.thr.clone().addScaledVector(best.d, 300); aim.y = ab.elev + 2;
        return { airbase: ab, pos, yaw: yawFromDir(best.d), speed: ac.flight.vstall * 1.35, throttle: 0.42, gear: true, cps: [], limit: 240,
          rwy: { thr: best.thr, d: best.d, ang, aim, len: ab.len, elev: ab.elev }, marker: aim,
          brief: `Runway ahead · ${(ang / DEG).toFixed(1)}° glide path`, objective: "" };
      },
      guide(m, pl) {
        const R = m.plan.rwy, rel = pl.pos.clone().sub(R.thr), along = rel.dot(R.d), lat = rel.x * -R.d.z + rel.z * R.d.x;
        const toAim = 300 - along, want = R.elev + Math.tan(R.ang) * Math.max(0, toAim);
        const dev = toAim > 50 ? Math.atan2(pl.pos.y - want, toAim) / DEG : 0;
        const vref = pl.spec.flight.vstall * 1.25, su = RJ.speedUnit();
        return pl.onGround ? "Brakes (" + RJ.keyLabel(RJ.settings.keys.airbrake) + ") and stop on the runway." :
          `Glide path: ${glideText(dev)} · Line-up: ${lineupText(lat)} · Speed ${Math.round(pl.speed * su[1])} (target ${Math.round(vref * su[1])} ${su[0]})`;
      },
      onTouchdown(m, pl) {
        const R = m.plan.rwy, rel = pl.pos.clone().sub(R.thr), along = rel.dot(R.d), lat = rel.x * -R.d.z + rel.z * R.d.x, sink = Math.max(0, -pl.vel.y);
        const off = Math.abs(lat) > 25 || along < -10 || along > R.len;
        const score = RJ.clamp(1000 - Math.abs(along - 300) * 2.2 - Math.abs(lat) * 14 - Math.max(0, sink - 1.2) * 140, 0, 1000);
        m.td = { along, lat, sink, off, score };
        RJ.ui.flash(off ? "OFF THE RUNWAY" : "TOUCHDOWN", off ? null : `${Math.round(along - 300)} m from the aim point · sink ${sink.toFixed(1)} m/s`, 2.4, off);
      },
      tick(m, pl) {
        if (m.td && pl.onGround && pl.speed < 2.5) {
          if (m.td.off) return m.fail("Touched down off the runway.");
          m.finish(m.td.score, [["From aim point", `${Math.round(m.td.along - 300)} m`], ["Off centreline", `${Math.abs(m.td.lat).toFixed(1)} m`], ["Sink rate", `${(m.td.sink * 196.85).toFixed(0)} ft/min`]]);
        }
      }
    },
    {
      id: "carrier", name: "Carrier Landing", icon: "ship", where: "The Coastal Carrier", metric: "score", better: "higher",
      medals: [90, 70, 1], fmt: (v) => `${Math.round(v)} pts`, fmtTarget: (v) => (v <= 1 ? "any trap" : `${Math.round(v)} pts`),
      desc: "Fly the ball onto the angled deck and catch a wire. The 3-wire is perfect. Miss them all and it's a bolter: go around.",
      env: { time: "golden", weather: "scattered" },
      req: (ac) => (span(ac.id) > 42 ? "Too large for the flight deck" : ac.flight.vstall > 95 ? "Lands too fast for a carrier" : null),
      build(ac) {
        const K = RJ.carrier; if (!K || !K.site) return null;
        const L = K.landingFrame(), d = V3(L.dir.x, 0, L.dir.z);
        const aim = V3(L.x, L.y, L.z), pos = aim.clone().addScaledVector(d, -4200);
        pos.y = L.y + Math.tan(L.slope) * 4200;
        return { pos, yaw: yawFromDir(d), speed: Math.max(ac.flight.vstall * 1.25, 60), throttle: 0.5, gear: true, cps: [], limit: 300,
          lf: L, marker: aim, brief: "Call the ball · 3-wire for gold", objective: "" };
      },
      guide(m, pl) {
        const L = m.plan.lf, rx = pl.pos.x - L.x, rz = pl.pos.z - L.z, back = -(rx * L.dir.x + rz * L.dir.z), lat = rx * -L.dir.z + rz * L.dir.x;
        if (pl.onGround) return pl.trap ? "Trapped. Hold on." : "BOLTER: full power and get airborne off the bow.";
        const want = L.y + Math.tan(L.slope) * Math.max(0, back), dev = back > 60 ? Math.atan2(pl.pos.y - want, back) / DEG : 0;
        const su = RJ.speedUnit();
        return `Meatball: ${glideText(dev * 1.5)} · Line-up: ${lineupText(lat)} · Speed ${Math.round(pl.speed * su[1])} ${su[0]} · Gear ${pl.gearDown ? "down" : "UP"}`;
      },
      onTouchdown(m, pl) {
        if (!RJ.carrier.onDeck(pl.pos.x, pl.pos.z)) return;
        const sink = Math.max(0, -pl.vel.y);
        if (pl.trap) { m.td = { wire: pl.trap.wire, sink }; RJ.ui.flash(`${pl.trap.wire}-WIRE`, pl.trap.wire === 3 ? "Perfect trap" : "Trapped", 2.2); }
        else { m.bolters = (m.bolters || 0) + 1; RJ.ui.flash("BOLTER", "Full power, go around", 2.2, true); }
      },
      tick(m, pl) {
        if (m.td && pl.onGround && pl.speed < 1) {
          const ws = { 3: 100, 2: 85, 4: 80, 1: 60 }[m.td.wire] || 40;
          const score = Math.max(1, ws - Math.max(0, m.td.sink - 4) * 8 - (m.bolters || 0) * 15);
          m.finish(score, [["Wire", `${m.td.wire}`], ["Sink rate", `${(m.td.sink * 196.85).toFixed(0)} ft/min`], ["Bolters", String(m.bolters || 0)]]);
        }
      }
    },
    {
      id: "supersonic", name: "Supersonic Time Trial", icon: "ship", where: "Over the ocean", metric: "time",
      desc: "Eight rings on a 57 km circuit over the sea. Every ring taken below Mach 1 costs five seconds.",
      env: { time: "noon", weather: "scattered" },
      req: (ac) => (supersonic(ac) ? null : "Needs a supersonic aircraft"),
      build(ac) {
        const P = RJ.atlas.plan, c0 = P.carrier || P.lighthouse; if (!c0) return null;
        const R = 9000;
        const loopTop = (cx, cz) => { let t = 0; for (let k = 0; k < 48; k++) { const a = (k / 48) * TAU; t = Math.max(t, G(cx + Math.cos(a) * R, cz + Math.sin(a) * R)); } return t; };
        // slide the circuit out to sea until it no longer crosses the coast
        let c = { x: c0.x, z: c0.z, top: loopTop(c0.x, c0.z) };
        for (let d = 3000; d <= 36000 && c.top > 30; d += 3000) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * TAU, x = c0.x + Math.cos(a) * d, z = c0.z + Math.sin(a) * d, t = loopTop(x, z);
            if (t < c.top) c = { x, z, top: t };
          }
        }
        const Y = Math.max(1500, c.top + 600);
        const cps = [];
        for (let i = 1; i <= 8; i++) {
          const a = (i / 8) * TAU;
          cps.push(Object.assign(ring(V3(c.x + Math.cos(a) * R, Y, c.z + Math.sin(a) * R), 120, i === 8 ? "FINISH" : "RING"), { n: V3(-Math.sin(a), 0, Math.cos(a)), fixed: true, supersonic: true }));
        }
        const pos = V3(c.x + R, Y, c.z);
        const a = RJ.soundSpeed(Y);
        return { pos, yaw: yawFromDir(V3(0, 0, 1)), speed: Math.min(a * 0.95, ac.flight.vmax * 0.8), throttle: 1, cps, par: (TAU * R) / Math.min(ac.flight.vmax * 0.62, a * 1.35) + 4, finishOnLast: true,
          brief: "8 rings · supersonic or +5 s each", objective: "Stay supersonic. The circuit curves gently right the whole way." };
      },
      onPass(m, cp, pl) { if (cp.supersonic && pl.mach < 1) { m.penalty += 5; RJ.ui.flash("SUBSONIC", "+5 s penalty", 1.4, true); } }
    },
    {
      id: "slalom", name: "Mountain Slalom", icon: "peak", where: "The high valleys", metric: "time",
      desc: "Sixteen offset rings weaving left and right through the snowy valleys. Smooth inputs win.",
      env: { time: "morning", weather: "scattered" },
      build(ac) {
        const h = RJ.atlas.home, yaw = h.yaw + Math.PI * 0.55;
        const sx = h.x + dirFromYaw(yaw).x * 1600, sz = h.z + dirFromYaw(yaw).z * 1600;
        const start = V3(sx, G(sx, sz) + 110, sz);
        const cs = RJ.atlas.plan.castle;
        const pts = course(start, yaw, 16, { step: 540, alt: [80, 130], clear: 32, turnCost: 1.6, slalom: 95, seed: 4242, avoid: cs ? [{ x: cs.x, z: cs.z, r: 900 }] : null });
        start.y = Math.max(pts[0].y, G(sx, sz) + 110);
        const r = ringR(ac, 30);
        const cps = orient(pts.map((p, i) => ring(p, r, i === 15 ? "FINISH" : "RING")), start);
        return { pos: start, yaw, speed: Math.min(150, MODES().cruiseSpeed(ac)), throttle: 0.7, cps, par: pathLen(start, cps) * 1.08 / Math.min(ac.flight.vmax * 0.42, 190) + 3, finishOnLast: true,
          brief: "16 offset rings", objective: "Weave through the rings. Each one is offset from the last." };
      }
    },
    {
      id: "courtyard", name: "Castle Courtyard Landing", icon: "castle", where: "Highkeep Castle", metric: "score", better: "higher",
      medals: [800, 550, 1], fmt: (v) => `${Math.round(v)} pts`, fmtTarget: (v) => (v <= 1 ? "stop inside" : `${Math.round(v)} pts`),
      desc: "Fly through the front gate with the gear down, land on the cobbles and stop before the far wall.",
      env: { time: "golden", weather: "clear" }, sunBehind: true,
      req: (ac) => (span(ac.id) > 30 ? "Wingspan too wide for the castle gates" : ac.flight.vstall > 72 ? "Lands too fast to stop inside the walls" : null),
      build(ac) {
        const F = castleFrame(), s = F.s, gi = RJ.castle.gateInfo(), zf = Math.max(...gi.zs), fwd = F.dir(0, -1);
        const start = F.w(0, 2700);
        start.y = Math.max(s.elev + 150, maxAlong(start, F.w(0, zf + 60)) + 40);
        const top = gi.low - 3;
        const cps = [gate(F.w(0, zf, s.elev + top / 2), fwd, gi.half - 1.5, s.elev - 40, s.elev + gi.low - 1, "FRONT GATE", { h: top })];
        return { pos: start, yaw: yawFromDir(fwd), speed: ac.flight.vstall * 1.3, throttle: 0.4, gear: true, cps, limit: 180, F, zf,
          brief: "Through the gate, onto the cobbles", objective: "" };
      },
      guide(m, pl) {
        const [lx, lz] = m.plan.F.local(pl.pos), elev = m.plan.F.s.elev;
        if (pl.onGround) return `Brakes (${RJ.keyLabel(RJ.settings.keys.airbrake)})! Stop before the far wall · ${Math.max(0, Math.round(lz + 285))} m left`;
        if (m.idx === 0) return `Line up on the gate · ${lineupText(lx)} · ${Math.round(pl.pos.y - elev)} m above the courtyard (gate arch at 42 m) · Gear ${pl.gearDown ? "down" : "UP"}`;
        return "Through! Put it down now and brake hard.";
      },
      onTouchdown(m, pl) {
        const [lx, lz] = m.plan.F.local(pl.pos), sink = Math.max(0, -pl.vel.y);
        const inside = Math.abs(lx) < 280 && Math.abs(lz) < 280;
        m.td = { lx, lz, sink, inside, gate: m.idx > 0, score: RJ.clamp(1000 - Math.max(0, sink - 1.2) * 140 - Math.abs(lx) * 14 - Math.abs(lz - 240) * 0.8, 1, 1000) };
        RJ.ui.flash(inside ? "TOUCHDOWN" : "MISSED THE COURTYARD", inside ? "Brake!" : null, 1.6, !inside);
      },
      tick(m, pl) {
        if (m.td && pl.onGround && pl.speed < 2) {
          const [lx, lz] = m.plan.F.local(pl.pos);
          if (!m.td.gate) return m.fail("You have to come in through the front gate.");
          if (!m.td.inside || Math.abs(lx) > 285 || Math.abs(lz) > 285) return m.fail("Stopped outside the castle walls.");
          m.finish(m.td.score, [["Sink rate", `${(m.td.sink * 196.85).toFixed(0)} ft/min`], ["Off the gate axis", `${Math.abs(m.td.lx).toFixed(1)} m`], ["Rollout left", `${Math.round(lz + 285)} m`]]);
        }
      }
    }
  ];
  CH.util = { course, riverWalk, clearLine, maxAlong, castleFrame, G };
  CH.byId = {};
  CH.DEFS.forEach((d) => (CH.byId[d.id] = d));

  /** Medal thresholds [gold, silver, bronze] for a challenge flown in a given aircraft. */
  CH.thresholds = function (def, plan) {
    if (def.metric === "time") return [plan.par, plan.par * 1.2, plan.par * 1.5];
    return def.medals;
  };
  CH.medalFor = function (def, value, th) {
    const ok = def.better === "higher" ? (v, t) => v >= t : (v, t) => v <= t;
    return ok(value, th[0]) ? "gold" : ok(value, th[1]) ? "silver" : ok(value, th[2]) ? "bronze" : null;
  };
  CH.fmtValue = (def, v) => (def.metric === "time" ? RJ.fmtTime(v) : def.fmt(v));
  CH.fmtTarget = (def, v) => (def.metric === "time" ? RJ.fmtTime(v) : def.fmtTarget(v));
  CH.record = (id) => (RJ.progress.medals && RJ.progress.medals[id]) || null;
  const previewCache = {};
  /** Plan a challenge without building anything (for the menu's medal targets). */
  CH.preview = function (id, acId) {
    const k = id + ":" + acId;
    if (previewCache[k] !== undefined) return previewCache[k];
    let out = null;
    try {
      RJ.atlas.ensure();
      const def = CH.byId[id], plan = def.build(RJ.AIRCRAFT[acId]);
      out = plan ? { th: CH.thresholds(def, plan), plan } : null;
    } catch (e) { console.warn("challenge preview", id, e); }
    return (previewCache[k] = out);
  };

  /* ======================= MODE ======================= */
  class Challenge {
    constructor(o) { this.o = o; this.kind = "challenge"; this.def = CH.byId[o.id]; this.penalty = 0; }
    async setup(progress) {
      const def = this.def, o = this.o, ac = RJ.AIRCRAFT[o.aircraft];
      if (!def) throw new Error("Unknown challenge");
      const why = def.req && def.req(ac);
      if (why) throw new Error(why);
      RJ.world.setEnvironment(def.env);
      RJ.atlas.ensure();
      const plan = def.build(ac);
      if (!plan) throw new Error("This challenge's landmark isn't on this map");
      this.plan = plan;
      if (plan.airbase) RJ.world.setAirbase(plan.airbase); else if (RJ.world.airbase) RJ.world.setAirbase(null);
      if (def.sunBehind) RJ.world.setEnvironment(Object.assign({}, def.env, { sunAz: ((-plan.yaw / DEG + 150) % 360 + 360) % 360 }));
      await RJ.world.prepare(plan.pos, progress);
      const pl = (this.player = MODES().makePlayer(o.aircraft, plan.pos, plan.yaw, plan.speed, false));
      pl.throttle = plan.throttle != null ? plan.throttle : 0.8;
      if (plan.gear) { pl.gearDown = true; pl.gearT = 1; pl.gearAuto = false; }
      RJ.game.allowBombs = false;
      this.th = CH.thresholds(def, plan);
      this.meshes = plan.cps.map((cp) => { const m = cpMesh(cp); RJ.scene.add(m); return m; });
      if (plan.marker) {
        const mk = MODES().ringMesh(14); mk.position.copy(plan.marker).add(V3(0, 0.6, 0)); mk.lookAt(mk.position.clone().add(V3(0, 1, 0)));
        RJ.scene.add(mk); this.meshes.push(mk); this.markerMesh = mk;
      }
      this.idx = 0; this.t = 0; this.state = "run"; this.prevSide = null; this.splits = [];
      this.refresh();
      const rec = (RJ.progress.medals = RJ.progress.medals || {})[def.id] || {};
      rec.tries = (rec.tries || 0) + 1; RJ.progress.medals[def.id] = rec;
      RJ.progress.stats.flights++; RJ.saveProgress();
      if (RJ.ghost) RJ.ghost.begin(this);
      RJ.ui.flash(def.name.toUpperCase(), plan.brief + " · Gold " + CH.fmtTarget(def, this.th[0]), 4);
    }
    refresh() {
      this.plan.cps.forEach((cp, i) => {
        const m = this.meshes[i];
        m.visible = i >= this.idx && i < this.idx + 4;
        const next = i === this.idx;
        m.userData.ring.material.color.setHex(next ? 0xffc23a : 0xffffff);
        m.userData.ring.material.opacity = next ? 0.95 : 0.4;
        m.userData.disc.material.opacity = next ? 0.1 : 0.03;
      });
    }
    update(dt) {
      const pl = this.player, plan = this.plan, def = this.def;
      if (this.state !== "run") return;
      if (!pl.alive) { this.deadT = (this.deadT || 0) + dt; if (this.deadT > 1.8) this.fail(this.failWhy || "Crashed."); return; }
      this.t += dt;
      MODES().trackChallenges(pl, null);
      RJ.atlas.checkDiscovery(pl);
      if (RJ.ghost) RJ.ghost.record(this, dt);
      if (plan.limit && this.t > plan.limit) return this.fail(plan.limitWhy || "Out of time.");
      if (plan.ceiling && pl.state === "flying") {
        if (pl.agl > plan.ceiling) { this.highT = (this.highT || 0) + dt; if (this.highT > 4) return this.fail("Climbed out of the canyon."); if (!this.warned) { this.warned = true; RJ.ui.flash("TOO HIGH", "Get back down into the canyon", 2, true); RJ.audio.beep(520, 0.15); } }
        else { this.highT = 0; this.warned = false; }
      }
      const cp = plan.cps[this.idx];
      if (cp && pl.alive) {
        const r = testCp(cp, pl.pos, this.prevSide);
        if (r.passed) this.pass(cp);
        else {
          if (r.missed) RJ.ui.flash("MISSED", `Turn back for the ${cp.label.toLowerCase()}`, 1.8, true);
          this.prevSide = r.side;
        }
      }
      if (this.state === "run" && def.tick) def.tick(this, pl, dt);
    }
    pass(cp) {
      this.idx++; this.prevSide = null;
      this.splits.push(this.t);
      RJ.audio.ring();
      if (this.def.onPass) this.def.onPass(this, cp, this.player);
      if (RJ.ghost) RJ.ghost.split(this, this.idx - 1, this.t);
      const n = this.plan.cps.length;
      if (this.idx >= n && this.plan.finishOnLast) { this.refresh(); return this.finish(this.t + this.penalty); }
      this.refresh();
      const d = RJ.ghost && RJ.ghost.delta(this);
      RJ.ui.flash(`${cp.label} ${this.idx} / ${n}`, d != null ? (d <= 0 ? "−" : "+") + Math.abs(d).toFixed(2) + " s vs best" : null, 1.1);
    }
    onTouchdown(pl) { if (this.state === "run" && this.def.onTouchdown) this.def.onTouchdown(this, pl); }
    onBoom(pl) { if (this.state === "run" && this.def.onBoom) this.def.onBoom(this, pl); }
    finish(value, extra) {
      if (this.state !== "run") return;
      this.state = "done";
      const def = this.def, P = RJ.progress, th = this.th;
      P.medals = P.medals || {};
      const rec = P.medals[def.id] || {};
      const medal = CH.medalFor(def, value, th);
      const better = def.better === "higher" ? value > (rec.best == null ? -Infinity : rec.best) : value < (rec.best == null ? Infinity : rec.best);
      const prevBest = rec.best;
      const prevRank = CH.RANK[rec.medal] || 0, rank = CH.RANK[medal] || 0;
      let xp = 60 + (rank > prevRank ? MEDAL_XP[rank] - MEDAL_XP[prevRank] : 0);
      if (better) { rec.best = value; rec.ac = this.o.aircraft; rec.date = Date.now(); }
      if (rank > prevRank) rec.medal = medal;
      P.medals[def.id] = rec;
      const unlocked = RJ.addXP(xp);
      RJ.saveProgress();
      if (RJ.ghost) RJ.ghost.finish(this, value, better);
      this.meshes.forEach((m) => (m.visible = false));
      RJ.audio.ring();
      const targets = th.map((t) => CH.fmtTarget(def, t));
      RJ.ui.showResults({
        eyebrow: `${def.name} · ${this.player.spec.short}`, title: CH.fmtValue(def, value), win: !!medal, medal, chal: true,
        sub: (medal ? `${medal[0].toUpperCase() + medal.slice(1)} medal.` : "No medal this time.") + (better ? " New personal best." : prevBest != null ? ` Best ${CH.fmtValue(def, prevBest)}.` : ""),
        stats: (extra || (def.metric === "time" ? [["Time", RJ.fmtTime(this.t)], ["Penalties", `${this.penalty} s`], ["Checkpoints", `${this.plan.cps.length}`]] : []))
          .concat([["Gold", targets[0]], ["Silver", targets[1]], ["Bronze", targets[2]]]),
        xp, unlocked
      });
    }
    fail(reason) {
      if (this.state !== "run") return;
      this.state = "failed";
      if (RJ.ghost) RJ.ghost.finish(this, null, false);
      this.meshes.forEach((m) => (m.visible = false));
      const def = this.def, th = this.th;
      RJ.ui.showResults({
        eyebrow: `${def.name} · ${this.player.spec.short}`, title: "FAILED", win: false, chal: true, sub: reason,
        stats: [["Time", RJ.fmtTime(this.t)], ["Checkpoints", `${this.idx} / ${this.plan.cps.length}`], ["Gold", CH.fmtTarget(def, th[0])]],
        xp: 0, unlocked: []
      });
    }
    onDestroyed(d) {
      if (d.ac === this.player) { this.failWhy = d.cause === "water" ? "Splashed into the water." : "Crashed."; RJ.ui.flash(d.cause === "water" ? "SPLASHED" : "CRASHED", "Retry with " + RJ.keyLabel(RJ.settings.keys.retry || "backspace"), 2.5, true); }
    }
    hudExtras() {
      const out = {}, cps = this.plan.cps;
      if (this.state === "run") {
        if (cps[this.idx]) { out.ring = { pos: cps[this.idx].pos }; if (cps[this.idx + 1]) out.ring2 = { pos: cps[this.idx + 1].pos }; }
        else if (this.plan.marker) out.ring = { pos: this.plan.marker };
      }
      return out;
    }
    status() {
      const def = this.def, pl = this.player, n = this.plan.cps.length;
      let s = `<b>${def.name.toUpperCase()}</b>`;
      if (def.id === "lowpass") s += `M ${pl.mach.toFixed(2)} · ${ft(pl.agl)} · ${Math.max(0, this.plan.limit - this.t).toFixed(0)} s left`;
      else if (def.metric === "time") s += `${Math.min(this.idx + 1, n)} / ${n} · ${RJ.fmtTime(this.t + this.penalty)}`;
      else s += RJ.fmtTime(this.t);
      const d = RJ.ghost && RJ.ghost.delta(this);
      if (d != null) s += ` · <span class="${d <= 0 ? "ahead" : "behind"}">${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(1)}</span>`;
      return s;
    }
    objective() {
      if (this.def.guide) return this.def.guide(this, this.player);
      return this.plan.objective;
    }
    dispose() {
      (this.meshes || []).forEach((m) => { RJ.scene.remove(m); m.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type !== "TorusGeometry") o.geometry.dispose(); }); });
      if (RJ.ghost) RJ.ghost.end(this);
    }
  }
  CH.Challenge = Challenge;

  RJ.on("touchdown", (ac) => { const m = RJ.game && RJ.game.mode; if (m && m.kind === "challenge" && ac === m.player) m.onTouchdown(ac); });
  RJ.on("sonicboom", (ac) => { const m = RJ.game && RJ.game.mode; if (m && m.kind === "challenge" && ac === m.player) m.onBoom(ac); });
})(window.RJ);
