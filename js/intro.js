/* Jet City — start-up cinematic (~32 s): "Fleet Week".
 * A six-ship blue-and-gold Super Hornet team (a tribute to the US Navy Blue Angels) plus a solo, over a coastal air station:
 *   black screen, wind, radio -> a solo lights its burners on a carrier offshore and is catapulted off the deck ->
 *   the Delta blasts over the beach at 30 m (the music drops) -> pitch-up to the vertical, into a cumulus and out
 *   into the sun over the top -> Diamond roll above the clouds -> Echelon dive in front of the crowd -> the two
 *   solos' opposing knife-edge pass (slow motion) -> the carrier solo's afterburner sneak pass over the crowd ->
 *   Delta run-in, pull to the vertical, Delta break with the solo punching up through the middle -> JET CITY logo,
 *   which glides onto the lobby's own title.
 * Built from what the game already has: the showcase jets and a seventh airframe, the carrier model, the airbase builder,
 * ocean and beach crowd (living.js airshow zone), fx smoke and vapour, the post stack (heat haze, radial blur,
 * film grade). The score, engines, afterburner crackle, crowd, wind and radio static are synthesised live with
 * WebAudio; the radio lines use the browser's speech voice. No downloaded assets.
 * Two clocks: real time T (music, captions, length) and show time s (flight and cameras); s runs slower at the
 * knife-edge crossing and the sneak pass. main.js owns the lobby: RJ.intro.start(api) once, api.done() once. */
(function (RJ) {
  "use strict";
  const V3 = RJ.V3;
  const I = { active: false };
  RJ.intro = I;

  // formations in the lead's frame: x right, y up, z behind (m), placed about their own centre line
  const DIAMOND = [[0, 0, 0], [8.5, -0.6, 10.5], [-8.5, -0.6, 10.5], [0, -1.4, 21], [0, -3.4, 33], [0, -6.2, 45]];
  const ECHELON = [0, 1, 2, 3, 4, 5].map((k) => [k * 9, -k * 0.7, k * 9]);
  const sm = (a, b, x) => RJ.smooth(a, b, x);
  const lerp = (a, b, x) => a + (b - a) * x;
  const ease = (x) => x * x * (3 - 2 * x);
  const D2R = Math.PI / 180;
  // the programme (show time, s)
  const T_OPEN = 1.7, T_AB = 2.9, T_CAT = 3.4, T_DROP = 6.45;
  const SEG = { A: 4.6, B: 16.3, C: 18.7, D: 21.4, E: 23.3 };
  const SX = 20.4, SP = 22.25, SB = 26.9, S_LOGO = 28.4, S_END = 31.4;
  const slowRate = (s) => 1 - 0.6 * (sm(20.18, 20.3, s) - sm(20.55, 20.67, s)) - 0.5 * (sm(22.08, 22.18, s) - sm(22.36, 22.46, s));
  const CUTS = [T_CAT, 5.3, 6.9, 8.4, 10.2, 13.9, SEG.B, SEG.C, 19.85, SEG.D, SEG.E, 25.2];
  const shotId = (t) => { let i = 0; while (i < CUTS.length && t >= CUTS[i]) i++; return i; };
  //               0 nozzle 1 cat 2 beach 3 up  4 climb 5 deck 6 roll 7 dive 8 head 9 cross 10 sneak 11 run 12 burst
  const EXPO =    [1.25,    1.15, 1.1,    1.1, 1.0,    1.0,   1.0,   1.1,   1.1,   1.1,    1.15,    1.1,  1.05];
  const A2A =     [false,   false, false, false, true, false, true,  false, true,  false,  false,   true, false];
  const CAPS = [[3.6, 5.25, "Catapult launch", "Angel 7, off the deck"], [6.5, 8.35, "Delta low pass", "Thirty metres off the surf"],
    [8.45, 10.15, "Vertical climb", "Into the cloud deck"], [10.4, 13.8, "Over the top", "Delta to Diamond"], [14.0, 16.2, "Diamond roll", "Six jets, one wing"],
    [16.6, 18.6, "Echelon dive", "Down to the crowd line"], [18.9, 21.3, "Opposing knife-edge pass", "Nearly 800 knots of closure"],
    [21.6, 23.2, "Sneak pass", "Full afterburner"], [25.4, 27.8, "Delta break", "Solo through the burst"]];

  /* ---------------- flight paths: integrated from pitch / bank / roll / speed schedules ---------------- */
  const SPS = 60;
  const XAX = V3(1, 0, 0), YAX = V3(0, 1, 0), ZAX = V3(0, 0, 1);
  /** o: { t0, t1, yaw, pitch(t), bank(t), roll(t), speed(t), at, anchor } -> path whose centre is at `anchor` at time `at` */
  function integrate(o) {
    const n = Math.ceil((o.t1 - o.t0) * SPS) + 2, P = [], Q = [], S = [], G = [];
    const pos = V3(), q = new THREE.Quaternion(), a = new THREE.Quaternion(), fwd = V3();
    let psi = o.yaw;
    for (let i = 0; i < n; i++) {
      const t = o.t0 + i / SPS, th = (o.pitch ? o.pitch(t) : 0) * D2R, ph = (o.bank ? o.bank(t) : 0) * D2R, v = o.speed(t);
      q.setFromAxisAngle(YAX, psi).multiply(a.setFromAxisAngle(XAX, th)).multiply(a.setFromAxisAngle(ZAX, ph)).multiply(a.setFromAxisAngle(ZAX, (o.roll ? o.roll(t) : 0) * D2R));
      P.push(pos.clone()); Q.push(q.clone()); S.push(v);
      pos.addScaledVector(fwd.set(0, 0, -1).applyQuaternion(q), v / SPS);
      psi += 1.4 * RJ.G0 * Math.tan(ph) / v / SPS * Math.cos(th);
    }
    const k = Math.round((o.at - o.t0) * SPS), off = o.anchor.clone().sub(P[k]);
    for (const p of P) p.add(off);
    loads(P, G);
    return { t0: o.t0, P, Q, S, G };
  }
  function loads(P, G) {
    const n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[Math.min(n - 1, i + 1)], b = P[i], c = P[Math.max(0, i - 1)];
      const acc = V3().copy(a).sub(b).sub(V3().copy(b).sub(c)).multiplyScalar(SPS * SPS);
      acc.y += RJ.G0;
      G[i] = i === 0 || i === n - 1 ? 1 : Math.min(9, acc.length() / RJ.G0);
    }
  }
  function sample(path, t, outP, outQ) {
    const n = path.P.length, f = RJ.clamp((t - path.t0) * SPS, 0, n - 1.001), i = Math.floor(f), u = f - i;
    outP.lerpVectors(path.P[i], path.P[i + 1], u);
    outQ.copy(path.Q[i]).slerp(path.Q[i + 1], u);
    return { v: path.S[i] + (path.S[i + 1] - path.S[i]) * u, g: path.G[i] };
  }
  // a point in the beach frame: along the shore, out to sea, up from sea level
  const B = (a, s, u, out) => (out || V3()).set(I.C.x + I.L.x * a + I.Sx.x * s, u, I.C.z + I.L.z * a + I.Sx.z * s);
  const H = (u) => I.groundY + u; // height above the crowd
  const G = (a, s, h, out) => { out = B(a, s, 0, out); out.y = RJ.world.ground(out.x, out.z) + h; return out; }; // a spot on the ground
  const CS = (o) => I.crowdS + o; // across-shore distance relative to the crowd line (+ toward the sea)
  const yawOf = (d) => Math.atan2(-d.x, -d.z);

  function buildShow() {
    const yA = yawOf(I.L), yN = yawOf(V3(-I.L.x, 0, -I.L.z));
    // Act A: Delta low along the surf -> pull to the vertical -> through the cumulus -> over the top (Immelmann) -> Diamond roll
    I.segA = integrate({ t0: SEG.A, t1: SEG.B + 0.1, yaw: yA, at: T_DROP, anchor: B(600, CS(40), H(30)),
      pitch: (t) => 90 * sm(6.6, 9.0, t) + 90 * sm(11.3, 12.9, t),
      roll: (t) => 180 * sm(12.95, 13.7, t) + 360 * sm(14.0, 15.9, t),
      speed: (t) => 185 - 35 * sm(6.8, 11.3, t) - 12 * sm(11.3, 12.9, t) + 47 * sm(13, 15.5, t) });
    // Act B: the Echelon dives out of the cloud base and pulls out in front of the crowd, then banks out to sea
    const rN = V3(I.L.z, 0, -I.L.x); // right of a jet heading -A
    const sea = rN.x * I.Sx.x + rN.z * I.Sx.z > 0 ? -1 : 1;
    I.segB = integrate({ t0: 15.2, t1: SEG.C + 0.1, yaw: yN, at: 17.85, anchor: B(-40, CS(170), H(95)),
      pitch: (t) => -64 + 64 * sm(16.6, 18.0, t), bank: (t) => sea * 55 * sm(17.7, 18.4, t), speed: () => 200 });
    // Act D: the carrier solo's sneak pass, full burner, then a pull to the vertical with a victory roll
    I.segD = integrate({ t0: SEG.D - 0.2, t1: SEG.E + 0.1, yaw: yA, at: SP, anchor: B(0, CS(35), H(17)),
      pitch: (t) => 72 * sm(22.45, 23.3, t), roll: (t) => 360 * sm(22.75, 23.25, t), speed: () => 250 });
    // Act E: Delta run-in low over the water, pull to the vertical, break
    I.segE = integrate({ t0: SEG.E - 0.2, t1: SB + 0.05, yaw: yN, at: 24.9, anchor: B(-700, CS(130), H(28)),
      pitch: (t) => 90 * sm(25.0, 26.75, t), speed: (t) => 205 - 35 * sm(25, 26.9, t) });
    I.breaks = buildBreaks();
    const bc = V3(); for (const b of I.breaks) bc.add(b.P[0]); I.breakC = bc.multiplyScalar(1 / 6);
  }
  // slot k at show time t (Delta -> Diamond in the climb; Echelon for the dive; Delta for the finale)
  const sa = V3(), sb = V3(), cen = V3();
  function slot(k, t, out) {
    const D = I.api.delta[k];
    if (t < SEG.B) sa.fromArray(D).lerp(sb.fromArray(DIAMOND[k]), sm(k >= 4 ? 8.4 : 8.9, k >= 4 ? 9.8 : 10.2, t));
    else if (t < SEG.C) sa.fromArray(ECHELON[k]);
    else sa.fromArray(D);
    return out.copy(sa);
  }
  function centre(t) {
    cen.set(0, 0, 0); const o = V3();
    for (let k = 0; k < 6; k++) cen.add(slot(k, t, o));
    cen.multiplyScalar(1 / 6); cen.z = 0;
    return cen;
  }
  const segOf = (t) => (t < SEG.B ? I.segA : t < SEG.C ? I.segB : I.segE);
  function placeFormation(k, t, outP, outQ) {
    const st = sample(segOf(t), t, outP, outQ), c = centre(t), o = slot(k, t, V3()).sub(c);
    const w = t * 1.3 + k * 1.7;
    o.x += Math.sin(w) * 0.2; o.y += Math.sin(w * 1.3) * 0.15; o.z += Math.sin(w * 0.7) * 0.25;
    outP.add(o.applyQuaternion(outQ));
    return st;
  }
  // the knife-edge solos (5 and 6) along the surf line, canopies to the crowd
  const q1 = new THREE.Quaternion(), qc = new THREE.Quaternion();
  function placeSolo(k, t, outP, outQ) {
    const dir = k === 4 ? 1 : -1, v = 200;
    B(v * (t - SX) * dir, CS(110) - 6 * dir, H(26), outP);
    const knife = sm(19.5, 20.05, t) - sm(20.8, 21.3, t);
    const yaw = yawOf(V3(I.L.x * dir, 0, I.L.z * dir));
    const right = V3(I.L.z * dir, 0, -I.L.x * dir), toSea = right.x * I.Sx.x + right.z * I.Sx.z > 0 ? 1 : -1;
    // roll so the canopy faces the beach: right wing up when the beach is on the left
    outQ.setFromAxisAngle(YAX, yaw).multiply(q1.setFromAxisAngle(ZAX, 90 * D2R * knife * toSea));
    return { v, g: 1 };
  }
  // the Delta break: from the vertical each jet rolls to its own heading and pulls, a six-way starburst
  function buildBreaks() {
    const PHI = [0, -60, 60, 180, -120, 120], n = Math.round(5 * SPS);
    return PHI.map((phi, k) => {
      const p = V3(), q0 = new THREE.Quaternion(), q = new THREE.Quaternion(), f = V3(), qa = new THREE.Quaternion();
      const v0 = placeFormation(k, SB, p, q0).v;
      const P = [], Q = [], S = [], G = [];
      let th = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SPS, rate = 0.5 * sm(0.2, 0.55, t), v = v0 - 8 * t;
        th += rate / SPS;
        q.copy(q0).multiply(qa.setFromAxisAngle(ZAX, phi * D2R * sm(0, 0.4, t))).multiply(new THREE.Quaternion().setFromAxisAngle(XAX, th));
        P.push(p.clone()); Q.push(q.clone()); S.push(v); G.push(1);
        p.addScaledVector(f.set(0, 0, -1).applyQuaternion(q), v / SPS);
      }
      loads(P, G);
      return { t0: SB, P, Q, S, G };
    });
  }
  // the seventh jet: carrier deck -> catapult -> climb-out; sneak pass; up the middle of the break
  function placeSeven(t, outP, outQ) {
    const c = I.cv;
    if (t < SEG.D - 0.2) {
      const tl = Math.max(0, t - T_CAT), dDeck = 20 * tl * tl, bow = 128;
      let d, v, y = c.deckY, pitch = 0;
      if (dDeck < bow) { d = dDeck; v = 40 * tl; }
      else { const tb = Math.sqrt(bow / 20), x = tl - tb; d = bow + 101 * x + 12 * x * x; v = 101 + 24 * x; pitch = 9 * sm(0, 0.8, x); y += Math.max(0, d - bow) * Math.tan(pitch * D2R) * 0.6 - 1.5 * sm(0, 0.4, x) * (1 - sm(0.4, 1.2, x)); }
      outP.copy(c.cat).addScaledVector(c.fwd, d); outP.y = y;
      outQ.setFromAxisAngle(YAX, c.yaw).multiply(q1.setFromAxisAngle(XAX, pitch * D2R));
      return { v, g: 1, deck: dDeck < bow };
    }
    if (t < SB) return sample(I.segD, t, outP, outQ);
    // up the middle: from just above the water, vertical, burners, slow roll
    const x = t - SB;
    outP.copy(I.breakC); outP.y = I.breakC.y - 250 + 235 * x;
    outQ.setFromAxisAngle(YAX, yawOf(V3(-I.L.x, 0, -I.L.z))).multiply(q1.setFromAxisAngle(XAX, 90 * D2R)).multiply(qc.setFromAxisAngle(ZAX, x * 2.2));
    return { v: 235, g: 1 };
  }
  // who is on screen when (cuts let the acts be flown in different places)
  function visible(k, t) {
    if (k === 6) return t < 6.9 || (t >= SEG.D && t < SEG.E) || t >= SB;
    if (t < SEG.A) return false;
    if (t >= SEG.C && t < SEG.D) return k >= 4;
    if (t >= SEG.D && t < SEG.E) return false;
    return true;
  }
  function placeJet(k, t, outP, outQ) {
    if (k === 6) return Object.assign(placeSeven(t, outP, outQ), { mode: t < SEG.D ? "deck" : t < SB ? "sneak" : "up" });
    if (t >= SB) return Object.assign(sample(I.breaks[k], t, outP, outQ), { mode: "break" });
    if (t >= SEG.C && t < SEG.D) return Object.assign(placeSolo(k, t, outP, outQ), { mode: "solo" });
    return Object.assign(placeFormation(k, t, outP, outQ), { mode: t < SEG.B ? "A" : t < SEG.C ? "B" : "E" });
  }

  /* ---------------- set dressing: the carrier and a cumulus to fly through ---------------- */
  function buildCarrier() {
    const K = RJ.carrier; if (!K || !K.build) return null;
    // a site out to sea, upwind along the beach, in deep water
    let site = null;
    const eye = G(570, CS(50), 2.2, V3());
    // first choice: in plain view of the beach camera; otherwise any deep-water spot (the deck shots still work)
    for (const needView of [true, false]) for (const [a, s] of [[2300, 1700], [2900, 1500], [1800, 2000], [2300, 2300], [1600, 2600], [3000, 2400], [3600, 1800], [1200, 1800], [-1800, 1800]]) {
      if (site) break;
      const p = B(a, s, 25); let ok = true;
      if (needView) for (let i = 1; i < 40 && ok; i++) { const q = V3().lerpVectors(eye, p, i / 40); if (RJ.world.terrainHeight(q.x, q.z) > q.y - 3) ok = false; }
      for (const [da, ds] of [[0, 0], [170, 0], [-170, 0], [0, 40], [0, -40]]) { const q = B(a + da, s + ds, 0); if (RJ.world.terrainHeight(q.x, q.z) > -14) ok = false; }
      if (ok) site = { x: p.x, z: p.z, heading: yawOf(I.L), inView: needView };
    }
    if (!site) return null;
    const s0 = K.site, g0 = K.group;
    const grp = K.build(site);
    K.site = s0; K.group = g0; // visual only: the atlas carrier keeps its deck physics
    RJ.scene.add(grp);
    const h = site.heading, cos = Math.cos(h), sin = Math.sin(h);
    const W = (lx, lz) => V3(site.x + lx * cos + lz * sin, 0, site.z - lx * sin + lz * cos);
    const cat = W(K.CATS[0].x, K.CATS[0].z), fwd = V3(-Math.sin(h), 0, -Math.cos(h));
    return { grp, site, cat, fwd, yaw: h, side: V3(-fwd.z, 0, fwd.x), deckY: K.DECK + (I.seven.gearH || 2.2) + 0.35 };
  }
  function puffTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    for (let i = 0; i < 16; i++) {
      const x = 64 + (Math.random() - 0.5) * 56, y = 64 + (Math.random() - 0.5) * 44, r = 18 + Math.random() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.26)"); gr.addColorStop(0.5, "rgba(255,255,255,0.1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }
  // a sprite cumulus: shaded grey underneath, sunlit gold on top (sprites, not volumetrics: the engine has no volume clouds)
  function buildCloud(centres) {
    const grp = new THREE.Group(), tex = puffTexture(), mats = [];
    const lo = new THREE.Color(0x868b92), hi = new THREE.Color(0xeadcc4);
    for (let i = 0; i < 6; i++) mats.push(new THREE.MeshBasicMaterial({ map: tex, color: lo.clone().lerp(hi, i / 5), transparent: true, depthWrite: false, opacity: 0.58, fog: true, side: THREE.DoubleSide }));
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const c of centres) {
      for (let i = 0; i < c.n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.r, h = Math.random();
        const y = c.y0 + (c.y1 - c.y0) * h, shrink = 1 - 0.55 * h * h; // a domed top
        const sp = new THREE.Mesh(geo, mats[Math.min(5, Math.floor(h * 6))]);
        sp.position.set(c.x + Math.cos(a) * r * shrink, y, c.z + Math.sin(a) * r * shrink);
        const s = (100 + Math.random() * 110) * (1 - 0.3 * h);
        sp.scale.set(s, s * 0.8, 1);
        grp.add(sp);
      }
    }
    grp.userData.dispose = () => { tex.dispose(); geo.dispose(); for (const m of mats) m.dispose(); };
    RJ.scene.add(grp);
    return grp;
  }

  /* ---------------- overlay ---------------- */
  function css() {
    if (document.getElementById("intro-css")) return;
    const s = document.createElement("style"); s.id = "intro-css";
    s.textContent = `
#intro { position: fixed; inset: 0; z-index: 60; pointer-events: none; overflow: hidden; font-family: var(--font-body); }
#intro .curtain { position: absolute; inset: 0; background: #000; opacity: 1; }
#intro .lb { position: absolute; left: 0; right: 0; height: max(0px, calc((100vh - 100vw / 2.39) / 2)); background: #000; transition: transform .9s cubic-bezier(.6,0,.2,1); }
#intro .lb.t { top: 0; } #intro .lb.b { bottom: 0; }
#intro.open .lb.t { transform: translateY(-100%); } #intro.open .lb.b { transform: translateY(100%); }
#intro .radio { position: absolute; left: 50%; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 4vh); transform: translateX(-50%); max-width: 80vw; text-align: center; color: #e9f2ea; opacity: 0; transition: opacity .25s;
  font-family: var(--font-mono); font-size: clamp(13px, 1.5vw, 18px); letter-spacing: .06em; text-shadow: 0 2px 10px rgba(0,0,0,.9); }
#intro .radio b { color: #ffb81c; font-weight: 400; letter-spacing: .2em; margin-right: .6em; }
#intro .radio.on { opacity: 1; }
#intro .cap { position: absolute; left: 6vw; bottom: calc(max(0px, (100vh - 100vw / 2.39) / 2) + 5vh); color: #f3ead2; opacity: 0; transform: translateX(-14px); transition: opacity .45s, transform .45s; text-shadow: 0 2px 12px rgba(0,0,0,.7); border-left: 2px solid #ffb81c; padding-left: 12px; }
#intro .cap.on { opacity: .95; transform: none; }
#intro .cap-n { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #ffb81c; margin-bottom: 4px; }
#intro .cap-t { font-family: var(--font-display); font-size: clamp(20px, 2.6vw, 34px); letter-spacing: .06em; text-transform: uppercase; }
#intro .flash { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(255,250,235,.95), rgba(255,226,170,.35) 45%, rgba(0,0,0,0) 75%); opacity: 0; }
#intro .scrim { position: absolute; inset: 0; background: radial-gradient(ellipse 55% 40% at 50% 50%, rgba(4,7,11,.62), rgba(4,7,11,.25) 60%, rgba(4,7,11,0) 85%); opacity: 0; }
#intro .dip { position: absolute; inset: 0; background: #05080c; opacity: 0; }
#intro .logo-wrap { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; opacity: 0; }
#intro .logo-wrap .eb { font-family: var(--font-mono); font-size: clamp(11px, 1.2vw, 15px); letter-spacing: .5em; color: #ffb81c; text-transform: uppercase; margin-bottom: 1.4vh; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
#intro .big { font-family: var(--font-display); font-size: clamp(64px, 13vw, 190px); line-height: .86; letter-spacing: .02em; white-space: nowrap;
  background: linear-gradient(100deg, #cfd6de 0%, #ffffff 30%, #fff3d6 46%, #ffffff 52%, #dfe5ec 70%, #ffffff 100%); background-size: 280% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(10,15,21,.9)) drop-shadow(0 5px 0 rgba(10,15,21,.6)) drop-shadow(0 14px 30px rgba(0,0,0,.75)); }
#intro .big.sweep { animation: introSweep 1.8s cubic-bezier(.3,0,.2,1) forwards; }
@keyframes introSweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }
#intro .streak { position: absolute; left: 50%; top: 50%; width: 86vw; height: 2px; transform: translate(-50%, -50%) scaleX(0); background: linear-gradient(90deg, transparent, #fff3c4, #fff, #fff3c4, transparent); opacity: 0; }
#intro .tag { margin-top: 1.8vh; font-family: var(--font-mono); font-size: clamp(11px, 1.2vw, 15px); letter-spacing: .42em; text-transform: uppercase; color: #e9eef4; opacity: .85; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
#intro .skip { pointer-events: auto; position: absolute; top: max(14px, calc((100vh - 100vw / 2.39) / 2 - 52px)); right: 18px; display: flex; align-items: center; gap: 10px; z-index: 2;
  padding: 9px 14px 9px 16px; border: 1px solid rgba(255,184,28,.75); border-radius: 3px; background: rgba(6,10,16,.55); color: #f5efe0; cursor: pointer;
  font-family: var(--font-mono); font-size: 13px; letter-spacing: .22em; text-transform: uppercase; backdrop-filter: blur(4px); transition: background .2s, border-color .2s; }
#intro .skip:hover, #intro .skip:focus-visible { background: rgba(255,184,28,.92); color: #161006; border-color: #ffb81c; outline: none; }
#intro .skip kbd { font-family: inherit; font-size: 10px; letter-spacing: .1em; padding: 1px 5px; border: 1px solid currentColor; border-radius: 2px; opacity: .75; }
#intro .gate { pointer-events: auto; position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; background: #000; z-index: 1; }
#intro .gate div { text-align: center; color: #f3ead2; }
#intro .gate p { margin: 0; font-family: var(--font-mono); letter-spacing: .4em; text-transform: uppercase; }
#intro .gate .g1 { font-size: 12px; color: #ffb81c; margin-bottom: 18px; }
#intro .gate .g2 { font-size: clamp(14px, 1.8vw, 20px); animation: introPulse 1.6s ease-in-out infinite; }
#intro .gate .g3 { margin-top: 14px; font-size: 11px; letter-spacing: .25em; opacity: .65; }
@keyframes introPulse { 50% { opacity: .45; } }`;
    document.head.appendChild(s);
  }
  function buildOverlay() {
    css();
    const el = document.createElement("div"); el.id = "intro";
    el.innerHTML = `<div class="curtain"></div><div class="lb t"></div><div class="lb b"></div>
<div class="radio"></div>
<div class="cap"><span class="cap-n"></span><span class="cap-t"></span></div>
<div class="flash"></div><div class="scrim"></div><div class="streak"></div>
<div class="logo-wrap"><div class="eb">Jet City Air Range</div><div class="big">JET CITY</div><div class="tag">Flight operations</div></div>
<div class="dip"></div>
<button class="skip" type="button" aria-label="Skip intro">Skip intro <kbd>Esc</kbd></button>`;
    document.body.appendChild(el);
    return el;
  }
  // radio calls: subtitles always; the browser's speech voice when sound is on (it can't go through Web Audio)
  const CALLS = [[0.45, "BOSS", "Angels, Boss. Smoke on — let's give 'em a show."], [2.35, "ANGEL 7", "Seven, burners. Ready for the shot."],
    [S_END, "", ""]];
  function sayLine(who, text) {
    const r = I.q.radio;
    r.innerHTML = `<b>${who}</b>${text}`; r.classList.add("on");
    clearTimeout(I.radioT); I.radioT = setTimeout(() => r.classList.remove("on"), 2300);
    if (I.A) radioClick(I.A);
    const ss = window.speechSynthesis, s = RJ.settings;
    if (!ss || s.muted || !(s.master > 0) || !window.SpeechSynthesisUtterance) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace("—", ","));
      const vs = ss.getVoices().filter((v) => /^en/i.test(v.lang));
      if (vs.length) u.voice = vs[who === "BOSS" ? 0 : Math.min(vs.length - 1, 1)];
      u.rate = 1.12; u.pitch = who === "BOSS" ? 0.8 : 1.0; u.volume = Math.min(1, s.master * 0.9);
      ss.cancel(); ss.speak(u);
    } catch (e) { /* no voice */ }
  }

  /* ---------------- audio ---------------- */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function makeAudio() {
    const AU = RJ.audio, ctx = AU.ctx;
    if (!ctx || !AU.master) return null;
    const A = { ctx, nodes: [], srcs: [], ev: [], evI: 0, base: null };
    const keep = (n) => { A.nodes.push(n); return n; };
    const gain = (v) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };
    const filt = (type, f, q) => { const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; };
    const loop = (buf, rate) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; if (rate) s.playbackRate.value = rate; A.srcs.push(s); return s; };
    A.bus = gain(1); A.bus.connect(AU.master);
    const mv = RJ.settings.musicVol == null ? 0.5 : RJ.settings.musicVol, sv = RJ.settings.sfxVol == null ? 1 : RJ.settings.sfxVol;
    A.mus = gain(0.6 * Math.min(1.6, mv / 0.5)); A.mus.connect(A.bus);
    A.sfx = gain(Math.min(1.5, sv)); A.sfx.connect(A.bus);
    // hall reverb
    const len = Math.round(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const rev = keep(ctx.createConvolver()); rev.buffer = ir;
    A.mIn = gain(1); A.mIn.connect(gain(0.85)).connect(A.mus); A.mIn.connect(rev).connect(gain(0.42)).connect(A.mus);
    // noise and crackle
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    let br = 0; for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; nd[i] = w * 0.6 + br * 3; }
    A.noise = nb;
    const cb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() < 0.006 ? (Math.random() * 2 - 1) * 3 : 0) + (Math.random() * 2 - 1) * 0.25;
    A.crackle = cb;
    // engine voice (nearest jet): roar, rumble, whine, afterburner crackle; distance, Doppler and pan
    A.eng = gain(0); A.pan = keep(ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain());
    A.eng.connect(A.pan).connect(gain(0.9)).connect(A.sfx);
    const ns = loop(nb); A.lp = filt("lowpass", 600, 0.6); ns.connect(A.lp).connect(gain(0.9)).connect(A.eng); A.ns = ns;
    const rs = loop(nb, 0.35); rs.connect(filt("lowpass", 140)).connect(gain(1.6)).connect(A.eng);
    A.whine = [2850, 4150].map((f) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; A.srcs.push(o); return o; });
    const wb = filt("bandpass", 3400, 2.5); A.wg = gain(0.05);
    for (const o of A.whine) o.connect(wb); wb.connect(A.wg).connect(A.eng);
    const ab = loop(cb); A.abg = gain(0); ab.connect(filt("bandpass", 1500, 0.6)).connect(A.abg).connect(A.eng);
    const abr = loop(nb, 0.6); A.abr = gain(0); abr.connect(filt("lowpass", 420)).connect(A.abr).connect(A.eng);
    // ambience: wind, crowd, radio static
    A.amb = gain(0.9); A.amb.connect(A.sfx);
    const wn = loop(nb, 0.5); A.wind = gain(0.12); wn.connect(filt("lowpass", 520)).connect(A.wind).connect(A.amb);
    const cr = loop(nb, 1.0); A.crowd = gain(0.02);
    const cr1 = filt("bandpass", 650, 0.7), cr2 = filt("bandpass", 1600, 1.4), crg = gain(1);
    cr.connect(cr1).connect(crg); cr.connect(cr2).connect(crg); crg.connect(A.crowd).connect(A.amb);
    const st = loop(cb, 1.3); A.stat = gain(0); st.connect(filt("highpass", 2400)).connect(A.stat).connect(A.amb);
    const far = loop(nb, 0.22); A.far = gain(0); far.connect(filt("lowpass", 95)).connect(A.far).connect(A.amb); // distant engines across the water
    const t0 = ctx.currentTime + 0.02;
    for (const s of A.srcs) s.start(t0);
    score(A);
    return A;
  }
  function voice(A, type, f, t, dur, vol, att, rel, cut, det, dest) {
    const ctx = A.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = cut; lp.Q.value = 0.7;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur)); g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(att, dur) + rel);
    lp.connect(g).connect(dest || A.mIn);
    for (const d of det) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = d;
      o.connect(lp); o.start(t); o.stop(t + Math.max(att, dur) + rel + 0.05); A.srcs.push(o);
    }
    return lp;
  }
  const strings = (A, notes, t, dur, vol) => { for (const m of notes) voice(A, "sawtooth", mtof(m), t, dur, vol, 0.45, 1.1, 1500 + m * 12, [-9, 0, 8]); };
  function brass(A, notes, t, dur, vol) {
    for (const m of notes) {
      const lp = voice(A, "sawtooth", mtof(m), t, dur, vol, 0.07, 0.5, 700, [-5, 5]);
      lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2600 + m * 10, t + 0.1); lp.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
    }
  }
  function noiseHit(A, t, vol, type, f, dur, q, dest) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl).connect(g).connect(dest || A.mIn); s.start(t, Math.random()); s.stop(t + dur + 0.05); A.srcs.push(s);
    return fl;
  }
  function timp(A, m, t, vol) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(mtof(m) * 1.06, t); o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    o.connect(g).connect(A.mIn); o.start(t); o.stop(t + 1.7); A.srcs.push(o);
    noiseHit(A, t, vol * 0.5, "lowpass", 380, 0.35);
  }
  function boom(A, t, vol, dest) {
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6);
    o.connect(g).connect(dest || A.mus); o.start(t); o.stop(t + 2.7); A.srcs.push(o);
  }
  function swell(A, t, dur, vol) {
    const ctx = A.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = A.noise; s.loop = true; fl.type = "highpass"; fl.frequency.value = 4500;
    g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    s.connect(fl).connect(g).connect(A.mIn); s.start(t); s.stop(t + dur + 0.1); A.srcs.push(s);
  }
  function radioClick(A) {
    const ctx = A.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = 1850;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(A.amb); o.start(t); o.stop(t + 0.1); A.srcs.push(o);
    A.stat.gain.cancelScheduledValues(t); A.stat.gain.setValueAtTime(0.09, t); A.stat.gain.linearRampToValueAtTime(0.035, t + 0.25); A.stat.gain.linearRampToValueAtTime(0, t + 2.2);
  }
  // sound design cues + the score (~100 bpm, D minor; a breath before the drop, a lift into the sun, hits on the passes)
  function score(A) {
    const E = (t, fn) => A.ev.push({ t, fn }), R = (s) => I.Tof(s);
    // anticipation: distant rumble, heartbeat timpani that quickens, a low drone and a rising cluster
    E(0, (w) => { const f = noiseHit(A, w, 0.0001, "lowpass", 110, 0.1, 0.7, A.sfx); void f; boom(A, w + 0.2, 0.25, A.sfx); });
    E(0, (w) => { strings(A, [26, 38], w, 5.8, 0.03); });
    [0.2, 1.3, 2.2, 2.95, 3.6, 4.15, 4.65, 5.05, 5.4, 5.7, 5.95, 6.15].forEach((x, i) => E(R(x), (w) => timp(A, 38, w, 0.15 + i * 0.03)));
    E(R(3.6), (w) => strings(A, [50, 51, 57], w, R(6.3) - R(3.6), 0.016));
    E(R(4.6), (w) => strings(A, [62, 63, 69], w, R(6.3) - R(4.6), 0.014));
    E(R(4.8), (w) => swell(A, w, R(6.36) - R(4.8), 0.16));
    // turbine spool-up and burner light-off on the deck
    E(R(T_OPEN), (w) => {
      const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.setValueAtTime(420, w); o.frequency.exponentialRampToValueAtTime(3700, w + 1.25);
      bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.09, w + 1.1); g.gain.exponentialRampToValueAtTime(0.03, w + 2.4); g.gain.exponentialRampToValueAtTime(0.0005, w + 4.5);
      o.connect(bp).connect(g).connect(A.sfx); o.start(w); o.stop(w + 4.6); A.srcs.push(o);
      const h = ctx.createOscillator(), hg = ctx.createGain(); h.type = "triangle"; h.frequency.setValueAtTime(90, w); h.frequency.exponentialRampToValueAtTime(260, w + 1.2);
      hg.gain.setValueAtTime(0.0001, w); hg.gain.exponentialRampToValueAtTime(0.12, w + 1.0); hg.gain.exponentialRampToValueAtTime(0.0005, w + 4.0);
      h.connect(hg).connect(A.sfx); h.start(w); h.stop(w + 4.1); A.srcs.push(h);
    });
    E(R(T_AB), (w) => { boom(A, w, 0.5, A.sfx); const f = noiseHit(A, w, 0.7, "lowpass", 300, 1.6, 0.8, A.sfx); f.frequency.exponentialRampToValueAtTime(3200, w + 0.35); timp(A, 38, w, 0.45); });
    E(R(T_CAT), (w) => { noiseHit(A, w, 0.35, "highpass", 3200, 1.8, 0.7, A.sfx); noiseHit(A, w, 0.5, "lowpass", 900, 1.2, 0.7, A.sfx); });
    // THE DROP: a breath of silence, then everything
    E(R(T_DROP) - 0.02, (w) => {
      brass(A, [38, 45, 50, 53, 57, 62], w, 0.9, 0.055); strings(A, [50, 53, 57, 62, 65], w, 1.2, 0.03);
      timp(A, 38, w, 0.9); timp(A, 26, w, 0.6); boom(A, w, 1.0); noiseHit(A, w, 0.5, "highpass", 2500, 2.6);
    });
    // driving low-string ostinato from the drop to the logo, with the harmony of each act
    const roots = [[R(6.45), 38], [R(8.4), 34], [R(10.4), 41], [R(12.2), 36], [R(13.9), 38], [R(15.1), 34], [R(16.3), 36], [R(17.5), 33],
      [R(SEG.C), 38], [R(SEG.D), 34], [R(SP), 36], [R(SEG.E), 38], [R(24.4), 34], [R(25.4), 36]];
    const rootAt = (x) => { let r = 38; for (const [a, b] of roots) if (x >= a - 1e-3) r = b; return r; };
    const ost = (from, to, step, v0, v1) => {
      for (let x = from, n = 0; x < to - 0.02; x += step, n++) {
        const r = rootAt(x), v = (n % 4 === 0 ? 1.5 : 1) * lerp(v0, v1, (x - from) / (to - from));
        E(x, (w) => voice(A, "sawtooth", mtof(r), w, step * 0.4, v, 0.01, 0.14, 900, [-6, 6]));
      }
    };
    ost(R(6.6), R(20.2), 0.3, 0.05, 0.065);
    ost(R(20.75), R(SB - 0.05), 0.15, 0.035, 0.075);
    // acts: chords and the theme; the lift into the sun is the first big major moment
    const ch = [[8.4, [46, 50, 53, 58], [58, 62, 65]], [10.4, [41, 48, 53, 57, 60], [65, 69, 72, 77]], [12.2, [48, 52, 55, 60], [64, 67, 72]],
      [13.9, [50, 54, 57, 62], [66, 69, 74]], [15.1, [46, 50, 53, 58], [62, 65, 70]], [16.3, [48, 52, 55, 60], [60, 64, 67]], [17.5, [45, 49, 52, 57], [61, 64, 69]],
      [SEG.C, [50, 53, 57], [62, 65]], [SEG.E, [50, 54, 57, 62], [66, 69, 74]], [24.4, [46, 50, 53, 58], [62, 65, 70, 74]]];
    for (const [s, b, st] of ch) E(R(s), (w) => { brass(A, b, w, 0.95, 0.042); strings(A, st, w, 1.1, 0.026); timp(A, b[0] - 12, w, 0.4); });
    E(R(10.4), (w) => { noiseHit(A, w, 0.3, "highpass", 3000, 2.4); boom(A, w, 0.5); });
    [[8.4, 69, 0.5], [8.9, 74, 0.45], [9.4, 76, 0.4], [9.8, 77, 0.6], [10.4, 81, 1.4], [12.2, 79, 0.6], [12.8, 76, 0.4], [13.2, 77, 0.6],
      [13.9, 78, 0.9], [14.9, 81, 0.4], [15.1, 82, 0.9], [16.3, 79, 0.5], [16.9, 76, 0.5], [17.5, 73, 0.8],
      [SEG.E, 74, 0.6], [23.9, 78, 0.4], [24.4, 81, 0.9], [25.4, 83, 0.5], [25.9, 85, 0.9]].forEach(([s, m, d]) => E(R(s), (w) => brass(A, [m], w, d, 0.034)));
    // knife-edge: tension, a hush in the slow motion, a hit as they clear
    for (let x = R(19.3); x < R(20.15); x += 0.0625) E(x, (w) => noiseHit(A, w, 0.04 + 0.14 * sm(R(19.3), R(20.2), x), "bandpass", 1900, 0.06, 1.2));
    E(R(20.2), (w) => { strings(A, [62, 69, 74, 76], w, R(20.7) - R(20.2), 0.02); boom(A, w, 0.45); });
    E(R(20.7), (w) => { brass(A, [38, 45, 50, 57, 62], w, 0.6, 0.05); timp(A, 38, w, 0.7); noiseHit(A, w, 0.32, "highpass", 2500, 2.2); });
    // sneak pass: rising build, a huge hit as it goes over
    E(R(21.4), (w) => swell(A, w, R(22.2) - R(21.4), 0.15));
    E(R(SP) - 0.03, (w) => { brass(A, [36, 43, 48, 52, 55, 60], w, 0.8, 0.055); timp(A, 36, w, 0.9); boom(A, w, 0.9); noiseHit(A, w, 0.45, "highpass", 2500, 2.6); });
    // finale build: snare roll and cymbal swell into the break
    E(R(25.2), (w) => { strings(A, [57, 61, 64, 69], w, R(SB) - R(25.2), 0.032); swell(A, w, R(SB - 0.04) - R(25.2), 0.2); });
    for (let x = R(25.6); x < R(SB - 0.04); x += 0.055) E(x, (w) => noiseHit(A, w, 0.05 + 0.22 * sm(R(25.6), R(SB), x), "bandpass", 1900, 0.06, 1.2));
    E(R(SB), (w) => { brass(A, [38, 45, 50, 54, 57, 62, 66, 69], w, 1.0, 0.05); strings(A, [50, 54, 57, 62, 66, 69, 74], w, 1.2, 0.028); timp(A, 38, w, 0.85); boom(A, w, 0.7); noiseHit(A, w, 0.4, "highpass", 2500, 2.5); });
    E(R(27.5), (w) => { brass(A, [74, 78, 81], w, 0.7, 0.03); timp(A, 45, w, 0.5); });
    // the logo: the biggest hit, ringing out under the lobby
    E(I.LOGO_T, (w) => {
      brass(A, [38, 45, 50, 54, 57, 62, 66, 69, 74], w, 1.3, 0.054); strings(A, [50, 54, 57, 62, 66, 69, 74, 78], w, 2.0, 0.03);
      timp(A, 38, w, 1.0); timp(A, 26, w + 0.02, 0.7); boom(A, w, 1.0); noiseHit(A, w, 0.5, "highpass", 2500, 3.4);
    });
    E(I.LOGO_T + 1.4, (w) => strings(A, [50, 57, 62, 66], w, 1.4, 0.018));
  }
  function audioTick(A, T, camPos, src, srcFwd, ab, rate, dt) {
    if (!A || A.ctx.state !== "running") { if (A) A.base = null; return; }
    const now = A.ctx.currentTime;
    if (A.base == null) { A.base = now - T; while (A.evI < A.ev.length && A.ev[A.evI].t < T - 0.04) A.evI++; }
    while (A.evI < A.ev.length && A.ev[A.evI].t <= T + 0.3) { const e = A.ev[A.evI++]; try { e.fn(Math.max(now + 0.005, A.base + e.t)); } catch (err) { /* voice limit */ } }
    const rel = V3().copy(camPos).sub(src), r = Math.max(6, rel.length());
    const close = A.prevR != null && A.src === I.near ? (A.prevR - r) / Math.max(dt, 1e-3) : 0;
    A.prevR = r; A.src = I.near;
    const dop = RJ.clamp(343 / Math.max(120, 343 - RJ.clamp(close, -300, 300)), 0.62, 1.75) * (0.55 + 0.45 * rate);
    A.dop = RJ.damp(A.dop || dop, dop, 10, dt);
    const aft = Math.max(0, -rel.normalize().dot(srcFwd));
    const near = RJ.clamp(70 / r, 0, 1.3) * (I.engMute ? 0 : 1);
    let lvl = near * (0.75 + 0.75 * aft) * (I.groupGain || 1);
    if (I.airToAir) lvl *= 0.5;
    lvl *= 1 - sm(I.LOGO_T, I.DUR + 0.5, T);
    A.eng.gain.setTargetAtTime(lvl, now, 0.05);
    A.lp.frequency.setTargetAtTime(Math.min(16000, (380 + 9000 * Math.min(1, near * near)) * A.dop), now, 0.05);
    A.ns.playbackRate.setTargetAtTime(0.75 + 0.3 * A.dop, now, 0.05);
    A.whine[0].frequency.setTargetAtTime(2850 * A.dop, now, 0.04); A.whine[1].frequency.setTargetAtTime(4150 * A.dop, now, 0.04);
    A.wg.gain.setTargetAtTime(0.06 * (1 - aft) * Math.min(1, near * 1.5), now, 0.05);
    A.abg.gain.setTargetAtTime(0.5 * ab * (0.4 + 0.6 * aft), now, 0.05); A.abr.gain.setTargetAtTime(1.1 * ab, now, 0.05);
    if (A.pan.pan) A.pan.pan.setTargetAtTime(RJ.clamp(A.panX || 0, -0.9, 0.9), now, 0.05);
    // ambience: wind fades once the show starts, the crowd follows the action
    A.wind.gain.setTargetAtTime(0.3 * (1 - 0.75 * sm(T_DROP, T_DROP + 2, T)), now, 0.2);
    A.far.gain.setTargetAtTime(0.9 * sm(0, 1.4, T) * (1 - sm(5.6, 6.5, T)), now, 0.2);
    A.crowd.gain.setTargetAtTime(I.crowdOn ? 0.025 + 0.24 * (I.cheer || 0) : 0.004, now, 0.12);
    if (A.lastClose > 40 && close < 0 && r < 220 && !(A.ripT > T - 1.5)) { A.ripT = T; noiseHit(A, now, 0.9, "lowpass", 2400 * (0.5 + 0.5 * rate), 2.2 / Math.max(0.4, rate), 0.7, A.sfx); }
    A.lastClose = close;
  }
  function audioStop(A, fade) {
    if (!A) return;
    const now = A.ctx.currentTime;
    A.ev.length = 0;
    try { A.bus.gain.cancelScheduledValues(now); A.bus.gain.setValueAtTime(A.bus.gain.value, now); A.bus.gain.linearRampToValueAtTime(0, now + fade); } catch (e) { /* closed */ }
    setTimeout(() => {
      for (const s of A.srcs) { try { s.stop(); } catch (e) { /* already stopped */ } }
      for (const n of A.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
      A.srcs.length = 0;
    }, fade * 1000 + 120);
  }

  /* ---------------- start / frame / finish ---------------- */
  /** api: { jets, delta, beach: { x, z, y, alongX, alongZ, seaX, seaZ }, render(dt, focus, motion, exposure), done() } */
  I.start = function (api) {
    if (I.active || I.played || !api.beach) return false;
    I.active = true; I.played = true; I.api = api; I.T = 0; I.s = 0; I.ended = false;
    const b = api.beach;
    I.crowdS = b.crowdS != null ? b.crowdS : -55; I.C = V3(b.x, 0, b.z); I.L = V3(b.alongX, 0, b.alongZ).normalize(); I.Sx = V3(b.seaX, 0, b.seaZ).normalize(); I.groundY = b.y;
    // show time <-> real time
    I.tab = [0]; for (let x = 0; x < S_END + 1;) { x += slowRate(x) / 240; I.tab.push(x); }
    I.LOGO_T = I.Tof(S_LOGO); I.FLIP_T = I.LOGO_T + 1.9; I.DUR = I.Tof(S_END);
    I.seven = new RJ.Aircraft("fa18e", { team: "blue", livery: "blueangels" });
    I.seven.place(V3(I.C.x, 30, I.C.z), 0, 0);
    I.jets = api.jets.concat([I.seven]);
    buildShow();
    I.cv = buildCarrier();
    if (!I.cv) { // no deep water found: the solo starts airborne instead of from a deck
      I.cv = { cat: B(2300, 1700, 0), fwd: I.L.clone(), yaw: yawOf(I.L), side: V3(-I.L.z, 0, I.L.x), deckY: 45, grp: null };
    }
    const pA = V3(), qA = new THREE.Quaternion();
    sample(I.segA, 9.9, pA, qA); const yb = sample(I.segA, 9.35, V3(), qA) && I.segA.P[Math.round((9.35 - SEG.A) * SPS)].y, yt = I.segA.P[Math.round((10.3 - SEG.A) * SPS)].y;
    const pB = V3(); sample(I.segB, SEG.B, pB, qA);
    I.cloud = buildCloud([{ x: pA.x, z: pA.z, y0: yb, y1: yt + 30, r: 380, n: 110 }]); void pB;
    I.deckTop = yt + 30;
    I.prev = I.jets.map(() => null); I.mode = I.jets.map(() => "");
    I.el = buildOverlay();
    I.q = {}; for (const c of ["curtain", "radio", "flash", "scrim", "streak", "logo-wrap", "big", "dip", "skip", "cap", "cap-n", "cap-t"]) I.q[c] = I.el.querySelector("." + c);
    I.q.skip.addEventListener("click", (e) => { e.stopPropagation(); I.skip(); });
    I.key = (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); I.skip(); return; }
      if (I.gate) I.begin();
    };
    addEventListener("keydown", I.key, true);
    RJ.ui.hideAll();
    RJ.post.cinematic = true; RJ.world.noMist = true;
    RJ.state.mode = "intro";
    const ctx = RJ.audio.ctx;
    if (!(ctx && ctx.state === "running") && !RJ.settings.muted && !I.noGate) {
      I.gate = document.createElement("div"); I.gate.className = "gate";
      I.gate.innerHTML = `<div><p class="g1">Jet City Air Range</p><p class="g2">Click or press any key to begin</p><p class="g3">Sound on · Esc skips the intro</p></div>`;
      I.gate.addEventListener("pointerdown", () => I.begin());
      I.el.appendChild(I.gate);
    } else I.begin();
    I.frame(0);
    return true;
  };
  I.Tof = function (s) {
    const t = I.tab; let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] < s) lo = m; else hi = m; }
    return (lo + (s - t[lo]) / Math.max(1e-6, t[hi] - t[lo])) / 240;
  };
  I.begin = function () {
    if (!I.active || I.running) return;
    if (I.gate) { I.gate.remove(); I.gate = null; }
    RJ.audio.init(); if (RJ.audio.unlock) RJ.audio.unlock();
    if (RJ.audio.ctx && RJ.audio.ctx.state !== "running") RJ.audio.ctx.resume().catch(() => {});
    try { I.A = makeAudio(); } catch (e) { console.warn("Intro audio unavailable", e); I.A = null; }
    I.running = true; I.wall = performance.now(); I.T = 0; I.s = 0; I.callI = 0;
  };

  const tP = V3(), tQ = new THREE.Quaternion(), fw = V3(), rt = V3(), up = V3(), hf = V3(), hr = V3(), mid = V3(), cpos = V3(), look = V3(), v1 = V3(), v2 = V3();
  // the formation's frame at show time t (centre tP, axes fw/rt/up, flat heading hf/hr)
  function formationAt(t) {
    const st = sample(segOf(t), t, tP, tQ);
    fw.set(0, 0, -1).applyQuaternion(tQ); rt.set(1, 0, 0).applyQuaternion(tQ); up.set(0, 1, 0).applyQuaternion(tQ);
    hf.set(fw.x, 0, fw.z);
    if (hf.lengthSq() < 1e-4) hf.set(up.x, 0, up.z).negate(); // vertical: heading from the canopy side
    hf.normalize(); hr.set(-hf.z, 0, hf.x);
    mid.copy(tP);
    return st;
  }
  function losClear(a, b) {
    for (let i = 1; i < 20; i++) { v2.lerpVectors(a, b, i / 20); if (RJ.world.ground(v2.x, v2.z) > v2.y - 4) return false; }
    return true;
  }
  const seaSide = () => (hr.x * I.Sx.x + hr.z * I.Sx.z > 0 ? 1 : -1);
  // the camera for show time t: writes cpos / look, returns fov; I.camUp blends in the formation's up vector
  function shot(t, id) {
    const J = I.jets, sev = J[6].pos;
    let fov = 45;
    I.camUp = 0; I.shake = 0;
    if (id === 0) {
      // on the deck behind the solo: the nozzles, the spool-up, the burners lighting
      const c = I.cv;
      cpos.copy(sev).addScaledVector(c.fwd, -16).addScaledVector(c.side, -7.5); cpos.y = c.deckY + 0.2;
      look.copy(sev).addScaledVector(c.fwd, -3); look.y = c.deckY + 0.6;
      fov = lerp(38, 33, sm(T_OPEN, T_CAT, t));
      I.shake = 0.18 * Math.max(0, 1 - Math.abs(t - T_AB - 0.15) / 0.5);
    } else if (id === 1) {
      // low on the deck ahead of the shuttle: the jet is fired past the lens and off the bow
      const c = I.cv;
      cpos.copy(c.cat).addScaledVector(c.fwd, 52).addScaledVector(c.side, -11); cpos.y = c.deckY - 1.0;
      look.copy(sev); look.y += 1;
      fov = 46;
      I.shake = 0.12 * Math.max(0, 1 - Math.abs(t - 4.98) / 0.35);
    } else if (id === 2) {
      // the beach: looking out at the carrier as the solo climbs away... and the Delta comes over from behind
      G(570, CS(50), 2.2, cpos);
      look.copy(I.cv.cat).addScaledVector(I.cv.fwd, 200); look.y = 30;
      look.lerp(v1.copy(mid), sm(6.3, 6.55, t));
      fov = lerp(20, 66, sm(6.25, 6.5, t));
      I.shake = 0.5 * Math.max(0, 1 - Math.abs(t - T_DROP - 0.05) / 0.35);
    } else if (id === 3) {
      // in the crowd, looking up as the Delta pulls for the vertical
      G(740, CS(-42), 2.6, cpos);
      look.copy(mid);
      fov = lerp(52, 64, sm(6.6, 8.4, t));
    } else if (id === 4) {
      // camera ship climbing below them, looking up their smoke into the cloud
      cpos.copy(tP).addScaledVector(fw, -75).addScaledVector(hr, 26).addScaledVector(up, -10);
      look.copy(tP).addScaledVector(fw, 70);
      fov = 52; I.camUp = 1;
    } else if (id === 5) {
      // above the deck: they burst out of the cloud tops and go over the top into the sun
      if (!I.deckCam) { const e = V3(); sample(I.segA, 11.4, e, qc); I.deckCam = e.addScaledVector(hr.set(-hf.z, 0, hf.x), 0).clone(); const r = V3(I.Sx.x, 0, I.Sx.z); I.deckCam.addScaledVector(r, 430).addScaledVector(I.L, 120); I.deckCam.y = I.deckTop + 70; }
      cpos.copy(I.deckCam);
      look.copy(mid);
      fov = RJ.clamp(2 * Math.atan(70 / cpos.distanceTo(mid)) / RJ.DEG, 20, 50);
    } else if (id === 6) {
      // the Diamond roll from a chase ship behind and to one side, clouds below in the sun
      const u = (t - 13.9) / 2.4;
      cpos.copy(tP).addScaledVector(hf, -lerp(98, 86, u)).addScaledVector(hr, lerp(26, 18, u)); cpos.y -= 6;
      look.copy(tP).addScaledVector(hf, 30);
      fov = lerp(42, 37, u);
    } else if (id === 7) {
      // from the crowd: the Echelon drops out of the cloud base and sweeps down in front of them
      G(-150, CS(-42), 2.6, cpos);
      look.copy(mid);
      fov = RJ.clamp(2 * Math.atan(85 / cpos.distanceTo(mid)) / RJ.DEG, 28, 66);
    } else if (id === 8) {
      // head-on: low over the water behind solo 6, solo 5 coming straight at it
      cpos.copy(J[5].pos).addScaledVector(I.L, 40).addScaledVector(I.Sx, -6); cpos.y = J[5].pos.y + 4;
      look.copy(J[5].pos).addScaledVector(I.L, -400); look.y = J[5].pos.y;
      fov = 36;
    } else if (id === 9) {
      // the crossing, from the front of the crowd (time slows as they meet)
      G(0, CS(50), 2.0, cpos);
      B(0, CS(110), H(26), look);
      fov = lerp(56, 46, sm(19.85, SX, t));
    } else if (id === 10) {
      // the sneak pass: at the waterline, the solo coming in on burners, over the lens, and away
      G(-6, CS(50), 1.8, cpos);
      look.copy(sev);
      fov = lerp(48, 62, sm(21.8, SP, t));
      I.shake = 0.6 * Math.max(0, 1 - Math.abs(t - SP) / 0.3);
    } else if (id === 11) {
      // tracking alongside the Delta run-in, low over the water, the beach and the crowd behind them
      const s = seaSide();
      cpos.copy(tP).addScaledVector(hr, s * 56).addScaledVector(hf, 8 - 5 * (t - SEG.E)); cpos.y = tP.y - 3;
      look.copy(tP).addScaledVector(hf, -8);
      fov = 46;
    } else {
      // the finale from the beach: pull to the vertical, the break, the solo up the middle
      if (!I.burstCam) { const a = I.breakC.clone().sub(I.C).dot(I.L); I.burstCam = G(a + 60, CS(-42), 2.6, V3()); }
      cpos.copy(I.burstCam);
      if (t < SB) look.copy(mid);
      else { v1.set(0, 0, 0); for (let k = 0; k < 7; k++) v1.add(J[k].pos); v1.multiplyScalar(1 / 7); look.lerpVectors(I.breakC, v1, sm(SB, SB + 1.2, t)); look.y += 30 * sm(SB, S_LOGO, t); }
      let spread = 60;
      if (t >= SB) for (let k = 0; k < 6; k++) spread = Math.max(spread, J[k].pos.distanceTo(look));
      fov = RJ.clamp(2 * Math.atan(spread * 1.15 / cpos.distanceTo(look)) / RJ.DEG, 34, 80);
    }
    return fov;
  }
  // crowd energy: swells as jets come near the beach and on the big moments
  function cheerAt(t) {
    let near = 1e9; for (let k = 0; k < 7; k++) if (I.vis[k]) near = Math.min(near, I.jets[k].pos.distanceTo(B(0, CS(0), H(0), v2)) + Math.abs(I.jets[k].pos.clone().sub(I.C).dot(I.L)) * 0.3);
    const prox = RJ.clamp(1 - (near - 150) / 900, 0, 1);
    const peaks = Math.max(sm(6.3, 6.6, t) * (1 - sm(7.5, 9.5, t)), sm(20.3, 20.6, t) * (1 - sm(21, 22, t)), sm(22.1, 22.4, t) * (1 - sm(23, 24.5, t)), sm(26.8, 27.3, t));
    return Math.max(prox * 0.7, peaks);
  }

  I.frame = function (dt) {
    if (!I.active) return;
    const rate = slowRate(I.s);
    if (I.running) {
      let dT;
      if (I.fixedStep) dT = I.fixedStep;
      else { const now = performance.now(); dT = Math.min(0.25, (now - I.wall) / 1000); I.wall = now; }
      I.T += dT; I.s = Math.min(S_END, I.s + rate * dT);
    }
    const T = I.T, t = I.s, J = I.jets, cam = RJ.camera, sdt = dt * rate;
    formationAt(t);
    I.vis = [];
    let nearD = 1e9;
    J.forEach((j, k) => {
      const js = placeJet(k, t, j.pos, j.q), vis = visible(k, t);
      I.vis[k] = vis;
      j.updateBasis();
      v1.set(0, 0, -1).applyQuaternion(j.q);
      j.vel.copy(v1).multiplyScalar(js.v); j.speed = js.v; j.state = "flying"; j.g = js.g;
      if (k === 6) {
        const deck = js.mode === "deck";
        j.gearT = deck ? 1 - sm(T_CAT + 2.7, T_CAT + 4, t) : 0; RJ.setGear(j.mesh, j.gearT);
        j.throttle = deck ? sm(T_OPEN, T_OPEN + 1.2, t) : 1; j.spool = j.throttle;
        j.abLevel = js.mode === "up" ? 1 : js.mode === "sneak" ? 1 : sm(T_AB, T_AB + 0.25, t);
      } else {
        j.throttle = js.mode === "solo" ? 0.95 : 0.8 + 0.2 * sm(23.6, 24.2, t); j.spool = j.throttle;
        j.abLevel = js.mode === "solo" ? 0.6 : js.mode === "E" || js.mode === "break" ? sm(24.6, 25.1, t) : js.mode === "A" ? 0.9 * sm(6.55, 6.9, t) * (1 - sm(9.4, 10.0, t)) : 0;
      }
      j.updateVisual(sdt);
      j.mesh.visible = vis;
      if (js.mode !== I.mode[k]) { I.mode[k] = js.mode; if (js.mode !== "break") I.prev[k] = null; }
      if (!vis) { I.prev[k] = null; return; }
      const d = j.pos.distanceTo(cam.position);
      if (d < nearD) { nearD = d; I.near = k; }
      // smoke on everywhere except the deck: long trails that linger, drift and spread
      const smokeOn = I.running && (k < 6 || js.mode !== "deck");
      if (!smokeOn) { I.prev[k] = null; return; }
      const tail = v2.copy(j.pos).addScaledVector(v1, -9);
      const p = I.prev[k];
      if (p) {
        const gap = p.distanceTo(tail), n = Math.min(40, Math.ceil(gap / 3));
        for (let i = 1; i <= n; i++) {
          const x = v1.clone().lerpVectors(p, tail, i / n);
          RJ.fx.smokeP.spawn(x.x, x.y, x.z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5, 15, 2.8, 20, 0.95, 0.95, 0.97, 0.5, 0.15, 0.4);
        }
        p.copy(tail);
      } else I.prev[k] = tail.clone();
      v1.set(0, 0, -1).applyQuaternion(j.q);
    });
    // the crowd and the deck crew of the hook (steam off the catapult track)
    I.cheer = cheerAt(t); I.crowdOn = t >= 5.3;
    if (RJ.living && RJ.living.people && RJ.living.people.setAirshow) RJ.living.people.setAirshow(I.cheer);
    if (I.running && I.cv.grp && t > T_CAT - 0.3 && t < 6.2 && Math.random() < 0.7) {
      const c = I.cv, x = c.cat.clone().addScaledVector(c.fwd, Math.random() * 128); x.y = c.deckY - 1.8;
      RJ.fx.smoke(x, v2.set(0, 2.5, 0), 3.5, 0.98, 2.2, 0.35 * (1 - sm(5.5, 6.2, t)));
    }
    // camera
    const id = shotId(t), fov = shot(t, id);
    if (I.cloud) for (const c of I.cloud.children) c.quaternion.copy(cam.quaternion);
    cam.position.copy(cpos);
    const gy = RJ.world.ground(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < gy && id !== 0 && id !== 1) cam.position.y = gy;
    if (I.camUp > 0) cam.up.set(0, 1, 0).lerp(up, I.camUp).normalize(); else cam.up.set(0, 1, 0);
    cam.lookAt(look); cam.up.set(0, 1, 0);
    if (I.shake > 0) { cam.rotateX(Math.sin(T * 63) * I.shake * 0.01); cam.rotateY(Math.sin(T * 51 + 1) * I.shake * 0.008); }
    const cut = I.lastShot !== id; I.lastShot = id;
    cam.fov = cut ? fov : RJ.damp(cam.fov, fov, 8, dt);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // radial blur only on the fast passes, centred on the action so the jets stay sharp
    const pass = Math.max(Math.max(0, 1 - Math.abs(t - T_DROP) / 0.4), Math.max(0, 1 - Math.abs(t - 4.95) / 0.35) * 0.7, Math.max(0, 1 - Math.abs(t - SP) / 0.35),
      Math.max(0, 1 - Math.abs(t - SX) / 0.3) * 0.6, (id === 11 ? 0.45 : 0));
    const focus = J[I.near || 0];
    const sc = v2.copy(id === 9 ? look : focus.pos).project(cam);
    RJ.post.fx.motionCenter = [RJ.clamp((sc.x + 1) / 2, 0.15, 0.85), RJ.clamp((sc.y + 1) / 2, 0.15, 0.85)];
    I.ex = cut || !I.ex ? EXPO[id] : RJ.damp(I.ex, EXPO[id], 3, dt);
    I.api.render(sdt, focus, 0.014 * pass, I.ex);
    for (let k = 0; k < 7; k++) J[k].mesh.visible = I.vis[k];
    if (!I.running) return;
    // overlay
    const q = I.q;
    q.curtain.style.opacity = 1 - sm(T_OPEN - 0.1, T_OPEN + 0.45, t);
    while (I.callI < CALLS.length && T >= CALLS[I.callI][0]) { const c = CALLS[I.callI++]; if (c[1]) sayLine(c[1], c[2]); }
    if (T >= I.Tof(SB) - 0.75 && !I.breakCall) { I.breakCall = true; sayLine("BOSS", "Delta break — now!"); }
    const cap = T < I.LOGO_T - 0.3 ? CAPS.find((c) => t >= c[0] && t < c[1]) : null;
    if (cap !== I.cap) {
      I.cap = cap;
      if (cap) { q["cap-n"].textContent = "Maneuver " + (CAPS.indexOf(cap) + 1) + " · " + cap[3]; q["cap-t"].textContent = cap[2]; q.cap.classList.add("on"); }
      else q.cap.classList.remove("on");
    }
    const hit = T - I.LOGO_T;
    q.flash.style.opacity = hit > 0 ? Math.max(0, 0.8 * Math.exp(-hit * 3.4)) : Math.max(0, 0.35 - Math.abs(t - T_DROP) * 2.5);
    q.scrim.style.opacity = hit > 0 && T < I.FLIP_T + 0.2 ? Math.min(1, hit * 2) : I.flipped ? 0 : q.scrim.style.opacity;
    if (hit > 0 && !q.big.classList.contains("sweep")) q.big.classList.add("sweep");
    q.streak.style.opacity = hit > 0 ? Math.max(0, 1 - hit * 1.3) : 0;
    q.streak.style.transform = `translate(-50%, -50%) scaleX(${hit > 0 ? Math.min(1, hit * 3) : 0})`;
    const lw = q["logo-wrap"];
    if (hit > 0 && T < I.FLIP_T) {
      const k = Math.min(1, hit / 0.55);
      lw.style.opacity = k; lw.style.filter = `blur(${(1 - k) * 12}px)`;
      lw.style.transform = `translate(-50%, -50%) scale(${1.14 - 0.14 * ease(k) + 0.025 * Math.min(1, hit / 1.6)})`;
      q.big.style.letterSpacing = (0.14 - 0.12 * ease(k)) + "em";
    }
    if (T >= I.FLIP_T && !I.flipped) flipLogo();
    if (T > I.FLIP_T - 0.1) I.el.classList.add("open");
    q.dip.style.opacity = 0.5 * sm(I.DUR - 0.45, I.DUR - 0.05, T);
    // audio follows the nearest visible jet
    if (I.A) {
      const nj = J[I.near || 0];
      v1.copy(cam.position).sub(nj.pos); I.A.panX = -v1.dot(V3(1, 0, 0).applyQuaternion(cam.quaternion)) / Math.max(30, v1.length()) * 1.4;
      I.airToAir = A2A[id]; I.groupGain = id === 8 || id === 9 ? 0.85 : id === 0 ? 0.55 : 1;
      I.engMute = id === 0 && t < T_OPEN; // before the fade-up only the distant rumble
      audioTick(I.A, T, cam.position, nj.pos, v2.set(0, 0, -1).applyQuaternion(nj.q), nj.abLevel || 0, rate, dt);
    }
    if (T >= I.DUR) I.finish(false);
  };
  // hand the logo over to the lobby's own title: glide the big logo onto it, then fade
  function flipLogo() {
    I.flipped = true;
    const lw = I.q["logo-wrap"], big = I.q.big, tgt = document.querySelector("#scr-main .logo");
    lw.style.transition = "transform .7s cubic-bezier(.5,0,.2,1), opacity .7s ease .1s"; lw.style.filter = "";
    I.q.scrim.style.transition = "opacity .8s"; I.q.scrim.style.opacity = 0;
    if (!tgt) { lw.style.opacity = 0; return; }
    const sm0 = document.getElementById("scr-main"), wasHidden = sm0.hidden;
    sm0.hidden = false; const b = tgt.getBoundingClientRect(); sm0.hidden = wasHidden;
    const a = big.getBoundingClientRect();
    if (!(b.width > 0)) { lw.style.opacity = 0; return; }
    const s = Math.min(b.width / a.width, b.height / a.height) * 1.1;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    lw.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${s})`;
    lw.style.transformOrigin = "50% 50%";
    lw.style.opacity = 0;
  }

  I.skip = function () { if (I.active) I.finish(true); };
  I.finish = function (skipped) {
    if (!I.active || I.ended) return;
    I.ended = true; I.active = false; I.running = false;
    removeEventListener("keydown", I.key, true);
    audioStop(I.A, skipped ? 0.35 : 2.2); I.A = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ }
    clearTimeout(I.radioT);
    RJ.post.cinematic = false; RJ.post.fx.motion = 0; RJ.world.noMist = false;
    if (RJ.living && RJ.living.people && RJ.living.people.setAirshow) RJ.living.people.setAirshow(0);
    // tear down the set: the seventh jet, the carrier, the cloud; the six showcase jets go back to the lobby
    try { I.seven.dispose(); } catch (e) { /* gone */ }
    for (const j of I.api.jets) j.mesh.visible = true;
    if (I.cv && I.cv.grp) { RJ.scene.remove(I.cv.grp); I.cv.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    if (I.cloud) { RJ.scene.remove(I.cloud); I.cloud.userData.dispose(); }
    const el = I.el;
    if (el) {
      if (I.gate) { I.gate.remove(); I.gate = null; }
      el.classList.add("open");
      const dip = I.q.dip; dip.style.transition = "opacity .55s ease"; dip.style.opacity = skipped ? 0.7 : 0.5;
      I.q.curtain.style.transition = "opacity .4s"; I.q.curtain.style.opacity = 0;
      I.q.skip.style.display = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { dip.style.opacity = 0; for (const c of ["logo-wrap", "radio", "flash", "streak", "cap", "scrim"]) I.q[c].style.opacity = 0; }));
      setTimeout(() => el.remove(), 900);
    }
    I.el = null;
    const api = I.api; I.api = null;
    api.done(skipped);
  };
})(window.RJ);
