/* Jet City — DRAG RACE SIMULATOR: a spectator mode with its own vehicle simulation.
 * Each car is simulated along the strip: engine torque curve (or an electric motor's constant-torque-then-power
 * curve), gearbox and final drive with timed shifts, a clutch-slip launch, driven-axle normal load with weight
 * transfer, a slip-ratio tyre model (wheelspin and smoke when the torque beats the grip), aero drag, downforce and
 * rolling resistance, all sub-stepped at 600 Hz. A Christmas tree starts the race (staging, three ambers, green),
 * drivers react in 0.08–0.25 s, and the timing system records reaction, 60 ft, 330 ft, 1/8 mile, finish ET and
 * trap speed. The race is filmed by nine cameras and an automatic director, with engine notes synthesised per car
 * (firing frequency from the rpm, Doppler as they pass the camera), shift cuts, tyre squeal and exhaust flames. */
(function (RJ) {
  "use strict";
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2, DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const DR = (RJ.drag = {});
  /* ======================= the cars ======================= */
  // mass kg · power kW · peak-power rpm / redline · ev (motor) · gears · final drive · tyre radius m · mu · drive (rwd/awd/fwd)
  // cda: drag area m² · down: downforce coefficient · wb: wheelbase · cgh: centre of gravity height · rear: static rear share
  DR.CARS = [
    { id: "vortex", name: "Vortex V16 Hypercar", cls: "Hypercar", mass: 1960, kw: 1180, rpmP: 6700, red: 7100, gears: [3.2, 2.2, 1.65, 1.3, 1.06, 0.88, 0.74], fd: 3.0, r: 0.36, mu: 1.32, drive: "awd", cda: 0.66, down: 0.12, wb: 2.71, cgh: 0.42, rear: 0.56, body: "hyper", cyl: 16, color: 0x0d2c6c },
    { id: "electra", name: "Electra Tri-Motor EV", cls: "Electric sedan", mass: 2160, kw: 760, ev: true, tq: 1420, red: 20000, gears: [1], fd: 9.0, r: 0.35, mu: 1.25, drive: "awd", cda: 0.48, down: 0.02, wb: 2.96, cgh: 0.46, rear: 0.52, body: "sedan", cyl: 0, color: 0xc8102e },
    { id: "kaiser", name: "Kaiser 9 Turbo S", cls: "Sports car", mass: 1640, kw: 478, rpmP: 6750, red: 7200, gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84, 0.72], fd: 3.0, r: 0.34, mu: 1.3, drive: "awd", cda: 0.62, down: 0.06, wb: 2.45, cgh: 0.44, rear: 0.61, body: "sports", cyl: 6, color: 0xb8bcc0 },
    { id: "stallion", name: "Stallion Demon 170", cls: "Muscle car", mass: 1940, kw: 750, rpmP: 6300, red: 6600, gears: [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67], fd: 3.09, r: 0.36, mu: 1.6, drive: "rwd", cda: 0.78, down: 0.0, wb: 2.95, cgh: 0.52, rear: 0.45, body: "muscle", cyl: 8, color: 0x1c1d20 },
    { id: "raptor", name: "Raptor GT3 RS", cls: "Track car", mass: 1450, kw: 386, rpmP: 8250, red: 9000, gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], fd: 3.97, r: 0.34, mu: 1.35, drive: "rwd", cda: 0.7, down: 0.2, wb: 2.46, cgh: 0.42, rear: 0.62, body: "sports", wing: true, cyl: 6, color: 0x2f9a3a },
    { id: "nova", name: "Nova Hyper-EV Concept", cls: "Futuristic", mass: 1850, kw: 1470, ev: true, tq: 2340, red: 21000, gears: [1], fd: 8.2, r: 0.36, mu: 1.45, drive: "awd", cda: 0.6, down: 0.22, wb: 2.75, cgh: 0.38, rear: 0.55, body: "future", cyl: 0, color: 0xe8e8ea },
    { id: "hatch", name: "Hatch R Hot Hatch", cls: "Hot hatch", mass: 1480, kw: 235, rpmP: 6500, red: 6800, gears: [3.4, 2.1, 1.55, 1.2, 0.97, 0.82], fd: 3.6, r: 0.33, mu: 1.1, drive: "fwd", cda: 0.68, down: 0.0, wb: 2.6, cgh: 0.5, rear: 0.4, body: "hatch", cyl: 4, color: 0xf2c21b },
    { id: "dragster", name: "Top Fuel Dragster", cls: "Dragster", mass: 1050, kw: 8200, rpmP: 7800, red: 8300, gears: [1.4, 1.0], fd: 3.2, r: 0.9, mu: 4.6, drive: "rwd", cda: 1.0, down: 1.1, wb: 7.6, cgh: 0.35, rear: 0.78, body: "dragster", cyl: 8, color: 0xd06a1a, chute: true }
  ];
  DR.LOCS = [
    { id: "strip", name: "Drag strip", desc: "Grandstands, the tree and a timing tower", time: "afternoon" },
    { id: "runway", name: "Airport runway", desc: "A closed runway at the mountain airbase", time: "golden" },
    { id: "boulevard", name: "City boulevard", desc: "Dubai's grand avenue, closed to traffic", time: "golden" },
    { id: "desert", name: "Desert facility", desc: "Salt-flat strip under open sky", time: "noon" },
    { id: "neon", name: "Neon night", desc: "Tokyo's skyscraper canyon after dark", time: "night" }
  ];
  DR.DISTS = [{ id: "quarter", name: "1/4 mile", m: 402.336 }, { id: "half", name: "1/2 mile", m: 804.672 }, { id: "km", name: "1 km", m: 1000 }];
  DR.sel = { a: "vortex", b: "stallion", colA: null, colB: null, loc: "strip", dist: "quarter", time: null };

  /* ---------- engine model ---------- */
  function engineTorque(C, rpm) {
    if (C.ev) { const w = Math.max(1, rpm * TAU / 60); return Math.min(C.tq, C.kw * 1000 / w) * (rpm > C.red ? 0 : 1); }
    const wP = C.rpmP * TAU / 60, Tp = C.kw * 1000 / wP; // torque at peak power
    const x = rpm / C.rpmP;
    // broad plateau (turbo / supercharged) falling after peak power, cut at the redline
    const k = x < 0.25 ? 0.55 + x * 1.6 : x < 0.85 ? 0.95 + 0.25 * Math.sin((x - 0.25) / 0.6 * Math.PI * 0.5) : 1.2 - (x - 0.85) * 1.6;
    return rpm > C.red * 1.01 ? 0 : Tp * Math.max(0.3, k) * 0.92;
  }
  /* ---------- vehicle simulation ---------- */
  class Car {
    constructor(C, lane) {
      this.C = C; this.lane = lane; this.x = 0; this.v = 0; this.w = 0; this.gear = 0; this.rpm = C.ev ? 0 : 1100; this.shiftT = 0;
      this.a = 0; this.slip = 0; this.pitch = 0; this.pitchV = 0; this.state = "pre"; this.thr = 0; this.rt = RJ.rand(0.08, 0.24); this.t = 0;
      this.marks = {}; this.done = false; this.flame = 0; this.dist = 0; this.chute = 0;
    }
    ratio() { return this.C.gears[this.gear] * this.C.fd; }
    step(dt, raceT, D) {
      const C = this.C, g = 9.81, rho = 1.2;
      if (this.state === "go" && raceT >= this.rt) this.thr = 1;
      if (this.done) { this.thr = 0; }
      // driven-axle load: static share plus weight transfer (rear-drive cars squat, front-drive cars lose grip)
      const W = C.mass * g, down = 0.5 * rho * C.down * this.v * this.v * 9;
      const transfer = C.mass * this.a * C.cgh / C.wb;
      const Nr = W * C.rear + transfer + down * 0.6, Nf = W * (1 - C.rear) - transfer + down * 0.4;
      const N = C.drive === "awd" ? Nr + Nf : C.drive === "rwd" ? Nr : Math.max(0.1 * W, Nf);
      const Fmax = C.mu * N;
      // drivetrain
      const r = C.r, R = this.ratio(), wheelRpm = this.w * 60 / TAU, coupled = wheelRpm * R;
      let Te = 0;
      if (this.shiftT > 0) { this.shiftT -= dt; this.rpm += ((C.ev ? coupled : Math.max(coupled, 1000)) - this.rpm) * Math.min(1, dt * 30); }
      else if (this.thr > 0) {
        // launch: the clutch slips at the launch rpm until the wheels catch up (EVs: instant torque)
        const launchRpm = C.ev ? 0 : C.rpmP * (C.id === "dragster" ? 0.9 : 0.62);
        this.rpm = C.ev ? coupled : Math.max(coupled, launchRpm * (coupled < launchRpm ? 1 : 0));
        Te = engineTorque(C, Math.max(this.rpm, 900)) * this.thr;
        // traction / launch control: trims torque to hold the tyres near peak slip (the muscle and the dragster are
        // allowed more spin, so they smoke their tyres off the line)
        const target = C.drive === "awd" || C.ev ? 0.1 : C.id === "dragster" ? 0.16 : 0.15;
        if (this.slip > target) Te *= RJ.clamp(1 - (this.slip - target) * 5, 0.15, 1);
        if (!C.ev && this.rpm >= C.red * 0.985 && this.gear < C.gears.length - 1 && this.slip < 0.4) { this.gear++; this.shiftT = C.id === "dragster" ? 0.05 : C.gears.length > 7 ? 0.09 : 0.2; this.flame = 1; this.shiftFlash = 1; }
      } else this.rpm += ((C.ev ? coupled : Math.max(900, coupled)) - this.rpm) * Math.min(1, dt * 4);
      const Tw = Te * R * 0.9;
      // tyre: force rises with slip to a peak near 10 % and falls away gently when the tyres light up
      const vw = this.w * r, sl = (vw - this.v) / Math.max(this.v, 3);
      this.slip = sl;
      const Fx = sl <= 0.1 ? Fmax * Math.max(-1, sl / 0.1) : Fmax * (1 - 0.22 * Math.min(1, (sl - 0.1) / 0.6));
      // wheels plus the drivetrain reflected through the gearing
      const Iw = (C.drive === "awd" ? 4 : 2) * (C.id === "dragster" ? 3 : 1.1) + (C.ev ? 0.09 : 0.22) * R * R;
      this.w += (Tw - Fx * r) / Iw * dt;
      if (this.w < 0) this.w = 0;
      // chassis
      const Fd = 0.5 * rho * C.cda * this.v * this.v, Frr = 0.012 * W + (this.done ? (C.chute ? 0.5 * rho * 18 * this.v * this.v * this.chute : 0) + 0.85 * W * 0.9 : 0);
      this.a = (Fx - Fd - Frr * (this.v > 0.05 ? 1 : 0)) / C.mass;
      if (this.done) { this.w = this.v / r; }
      this.v = Math.max(0, this.v + this.a * dt); this.x += this.v * dt;
      // body pitch (squat on launch, dive under braking) as a damped spring
      const target = -this.a * 0.012 * (C.cgh / 0.45) * (C.id === "dragster" ? 0.4 : 1);
      this.pitchV += ((target - this.pitch) * 60 - this.pitchV * 11) * dt; this.pitch += this.pitchV * dt;
      // timing marks
      if (this.thr > 0 || this.x > 0.2) {
        this.t += dt;
        // ET runs from leaving the start beam; g is from the green light (reaction included: who gets there first)
        for (const [k, m] of [["60ft", 18.288], ["330ft", 100.584], ["eighth", 201.168], ["finish", D]]) if (!this.marks[k] && this.x >= m) this.marks[k] = { t: this.t, g: this.t + this.rt, v: this.v };
        if (!this.done && this.x >= D) { this.done = true; this.trap = this.v; this.chute = C.chute ? 1 : 0; }
      }
      this.flame = Math.max(0, this.flame - dt * 6);
    }
  }

  /* ======================= models ======================= */
  const PAINTS = [0x0d2c6c, 0xc8102e, 0xb8bcc0, 0x1c1d20, 0x2f9a3a, 0xe8e8ea, 0xf2c21b, 0xd06a1a, 0x6a2c8a, 0x0aa5b8];
  function profile(body) {
    // side silhouettes (x along the car from the front, y up), metres
    const P = {
      hyper: [[0, 0.35], [0.1, 0.55], [0.9, 0.7], [1.7, 0.95], [2.4, 1.15], [3.1, 1.14], [3.9, 0.98], [4.55, 0.92], [4.6, 0.35]],
      sedan: [[0, 0.4], [0.15, 0.68], [0.9, 0.82], [1.6, 0.95], [2.0, 1.42], [3.4, 1.45], [4.3, 1.1], [4.95, 1.0], [4.98, 0.42]],
      sports: [[0, 0.38], [0.12, 0.62], [0.85, 0.78], [1.55, 0.92], [2.05, 1.28], [2.9, 1.3], [3.8, 1.0], [4.5, 0.9], [4.52, 0.4]],
      muscle: [[0, 0.42], [0.08, 0.86], [1.5, 0.98], [2.1, 1.0], [2.5, 1.38], [3.6, 1.4], [4.2, 1.06], [5.1, 1.02], [5.15, 0.45]],
      future: [[0, 0.3], [0.2, 0.48], [1.2, 0.68], [2.2, 1.12], [3.2, 1.1], [4.3, 0.85], [4.75, 0.7], [4.8, 0.32]],
      hatch: [[0, 0.42], [0.12, 0.74], [0.85, 0.9], [1.45, 1.0], [1.9, 1.45], [3.5, 1.47], [3.95, 1.25], [4.05, 0.5]]
    };
    return P[body] || P.sports;
  }
  function wheel(r, w, rimCol) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28, 1), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 })); tyre.rotation.z = Math.PI / 2; g.add(tyre);
    const rimM = new THREE.MeshStandardMaterial({ color: rimCol || 0xb8bcc0, roughness: 0.25, metalness: 0.9 });
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w * 1.02, 24, 1), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.6 })); rim.rotation.z = Math.PI / 2; g.add(rim);
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, r * 1.2, r * 0.14), rimM); sp.rotation.x = (k / 5) * Math.PI; g.add(sp); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 1.08, 12), rimM); hub.rotation.z = Math.PI / 2; g.add(hub);
    return g;
  }
  function carModel(C, paint) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const paintM = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1218, roughness: 0.04, metalness: 0.9, clearcoat: 1 });
    const wheels = [];
    if (C.body === "dragster") {
      const L = 8.4;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, L), paintM); rail.position.set(0, 0.45, -L / 2 + 1.2); body.add(rail);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 12), paintM); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.45, -L + 0.5); body.add(nose);
      const eng = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.3), new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.9, roughness: 0.3 })); eng.position.set(0, 0.95, 0.2); body.add(eng);
      const blower = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.7), dark); blower.position.set(0, 1.55, 0.2); body.add(blower);
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 1.0), dark); cage.position.set(0, 1.0, 1.5); body.add(cage);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.1), paintM); wing.position.set(0, 2.9, 2.1); wing.rotation.x = -0.25; body.add(wing);
      for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.6), dark); st.position.set(s * 1.1, 1.9, 2.0); body.add(st); const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xc0a080, metalness: 0.9, roughness: 0.3 })); pipe.position.set(s * 0.55, 1.2, 0.1); pipe.rotation.z = s * 0.9; body.add(pipe); }
      for (const [x, z, rr, w] of [[-0.95, 1.4, 0.9, 0.85], [0.95, 1.4, 0.9, 0.85], [-0.45, -L + 1.5, 0.28, 0.12], [0.45, -L + 1.5, 0.28, 0.12]]) { const wh = wheel(rr, w, 0xd0d4d8); wh.position.set(x, rr, z); root.add(wh); wheels.push(wh); }
      root.userData = { body, wheels, exhaust: [V3(-0.75, 1.5, 0.3), V3(0.75, 1.5, 0.3)], len: L, chuteZ: 3.3 };
      return root;
    }
    const prof = profile(C.body), Lc = prof[prof.length - 1][0], W = C.body === "muscle" ? 1.98 : C.body === "hatch" ? 1.84 : 2.0;
    const sh = new THREE.Shape(); sh.moveTo(prof[0][0], 0.28); for (const [x, y] of prof) sh.lineTo(x, y); sh.lineTo(Lc, 0.28); sh.lineTo(prof[0][0], 0.28);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 6 });
    bg.translate(-Lc / 2, 0, -W / 2); bg.rotateY(-Math.PI / 2); bg.computeVertexNormals();
    // ExtrudeGeometry: x was along the car (front at 0) → after the rotation the front faces -z
    const shell = new THREE.Mesh(bg, paintM); shell.castShadow = true; body.add(shell);
    // glasshouse: an inset copy of the upper profile in dark glass
    const top = prof.filter(([x, y]) => y > 0.9), gs = new THREE.Shape();
    if (top.length >= 3) {
      const ys = top.map((p) => p[1]), yMin = Math.min(...ys);
      gs.moveTo(top[0][0] + 0.15, yMin - 0.02); for (const [x, y] of top) gs.lineTo(x, y + 0.01); gs.lineTo(top[top.length - 1][0] - 0.1, yMin - 0.02);
      const gg = new THREE.ExtrudeGeometry(gs, { depth: W * 0.86, bevelEnabled: false }); gg.translate(-Lc / 2, 0, -W * 0.43); gg.rotateY(-Math.PI / 2);
      const gm = new THREE.Mesh(gg, glass); gm.scale.set(1.002, 1.004, 1.0); body.add(gm);
    }
    // lights, grille, splitter, diffuser, mirrors, exhausts, spoiler
    const lightF = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.6, roughness: 0.1 });
    const lightR = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 0.5, roughness: 0.2 });
    const fy = prof[1][1] - 0.05, ry = prof[prof.length - 2][1] - 0.12;
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.12), lightF); hl.position.set(s * W * 0.33, fy, -Lc / 2 - 0.02); body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), lightR); tl.position.set(s * W * 0.33, ry, Lc / 2 + 0.06); body.add(tl);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), paintM); mir.position.set(s * (W / 2 + 0.12), 1.05, -Lc * 0.05); body.add(mir);
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.95, roughness: 0.25 })); ex.rotation.x = Math.PI / 2; ex.position.set(s * W * 0.22, 0.38, Lc / 2 + 0.06); if (C.cyl) body.add(ex);
    }
    const spl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.05, 0.35), dark); spl.position.set(0, 0.3, -Lc / 2 + 0.1); body.add(spl);
    const dif = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.12, 0.3), dark); dif.position.set(0, 0.34, Lc / 2 - 0.05); body.add(dif);
    const gri = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.18, 0.05), dark); gri.position.set(0, fy - 0.12, -Lc / 2 - 0.03); body.add(gri);
    if (C.wing || C.body === "hyper") { const wg = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.05, 0.35), C.wing ? dark : paintM); wg.position.set(0, C.wing ? 1.45 : 1.1, Lc / 2 - 0.3); body.add(wg); if (C.wing) for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.15), dark); st.position.set(s * 0.5, 1.25, Lc / 2 - 0.3); body.add(st); } }
    // wheels at the axle lines, sized to the tyre radius
    const r = C.r, wf = C.wb, z0 = -wf / 2 + 0.05;
    for (const [x, z] of [[-W / 2 + 0.1, z0], [W / 2 - 0.1, z0], [-W / 2 + 0.1, z0 + wf], [W / 2 - 0.1, z0 + wf]]) { const wh = wheel(r, 0.3, 0xb8bcc0); wh.position.set(x, r, z); root.add(wh); wheels.push(wh); }
    root.userData = { body, wheels, exhaust: C.cyl ? [V3(-W * 0.22, 0.38, Lc / 2 + 0.15), V3(W * 0.22, 0.38, Lc / 2 + 0.15)] : [], len: Lc };
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return root;
  }

  /* ======================= engine audio ======================= */
  function engineVoice(C) {
    const A = RJ.audio, ctx = A && A.ctx; if (!ctx || !A.sfxBus) return null;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(A.sfxBus);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800; lp.Q.value = 0.8; lp.connect(out);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g1 = ctx.createGain(), g2 = ctx.createGain();
    o1.type = C.ev ? "sine" : "sawtooth"; o2.type = C.ev ? "triangle" : "square"; g1.gain.value = 0.5; g2.gain.value = C.ev ? 0.25 : 0.18;
    o1.connect(g1).connect(lp); o2.connect(g2).connect(lp); o1.start(); o2.start();
    // tyre squeal / rumble: filtered noise
    const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf; n.loop = true; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 3; const ng = ctx.createGain(); ng.gain.value = 0; n.connect(bp).connect(ng).connect(A.sfxBus); n.start();
    return {
      set(car, camPos, carPos, rel) {
        const t = ctx.currentTime, rpm = car.rpm, cylF = C.ev ? rpm / 60 * 0.5 + 80 : rpm / 60 * C.cyl / 2;
        const dist = Math.max(4, camPos.distanceTo(carPos)), dop = 343 / Math.max(80, 343 - rel); // approaching → higher
        const f = Math.max(30, cylF) * dop;
        o1.frequency.setTargetAtTime(f, t, 0.02); o2.frequency.setTargetAtTime(f * (C.ev ? 3 : 0.5), t, 0.02);
        lp.frequency.setTargetAtTime(600 + car.thr * 3200 * (C.id === "dragster" ? 1.6 : 1), t, 0.05);
        const load = car.shiftT > 0 ? 0.25 : 0.35 + car.thr * 0.65;
        out.gain.setTargetAtTime(Math.min(0.9, (C.id === "dragster" ? 1.6 : 0.6) * load * 40 / dist), t, 0.03);
        ng.gain.setTargetAtTime(Math.min(0.5, RJ.clamp(car.slip - 0.15, 0, 1) * 0.9 * 30 / dist), t, 0.04);
      },
      stop() { try { o1.stop(); o2.stop(); n.stop(); } catch (e) { /* stopped */ } out.disconnect(); ng.disconnect(); }
    };
  }

  /* ======================= setup screen ======================= */
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement("style");
    st.textContent = `#dr-hud{position:fixed;inset:0;pointer-events:none;font:13px/1.3 system-ui,sans-serif;color:#eef;z-index:30;text-shadow:0 1px 2px #000}
      #dr-hud .card{position:absolute;top:14px;width:260px;padding:10px 12px;background:rgba(8,12,18,.55);border-radius:8px;border-left:4px solid var(--c)}#dr-hud .card.a{left:14px}#dr-hud .card.b{right:14px}
      #dr-hud .nm{font-weight:700;font-size:15px}#dr-hud .big{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}#dr-hud .sm{opacity:.8;font-variant-numeric:tabular-nums}
      #dr-hud .bar{height:6px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:6px}#dr-hud .bar i{display:block;height:100%;background:var(--c);border-radius:3px}
      #dr-hud .mid{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;background:rgba(8,12,18,.45);padding:8px 16px;border-radius:8px;min-width:180px}
      #dr-hud .tree{display:flex;gap:6px;justify-content:center;margin-top:4px}#dr-hud .tree i{width:14px;height:14px;border-radius:50%;background:#333;display:block}
      #dr-hud .help{position:absolute;left:14px;bottom:14px;opacity:.7;font-size:12px}#dr-hud .win{font-size:30px;font-weight:900;letter-spacing:.05em}`;
    document.head.appendChild(st);
  }
  function buildScreen() {
    if ($("scr-drag")) return;
    const d = document.createElement("div"); d.className = "screen scrim-left"; d.id = "scr-drag"; d.hidden = true;
    d.innerHTML = `<div class="panel setup csim">
      <div><p class="eyebrow">Spectator · vehicle simulation</p><h2 class="title">DRAG RACE SIMULATOR</h2></div>
      <div class="cs-cols">
        <section class="group"><h3>Left lane</h3><select id="dr-a" class="cs-sel"></select><div class="cs-stat" id="dr-a-stat"></div><div class="chips" id="dr-col-a"></div></section>
        <section class="group"><h3>Right lane</h3><select id="dr-b" class="cs-sel"></select><div class="cs-stat" id="dr-b-stat"></div><div class="chips" id="dr-col-b"></div></section>
      </div>
      <section class="group"><h3>Location</h3><div class="opts cols-2" id="dr-loc"></div></section>
      <section class="group"><h3>Distance</h3><div class="chips" id="dr-dist"></div></section>
      <section class="group"><h3>Time of day</h3><div class="chips" id="dr-time"></div></section>
      <p class="help">During the race: 1 wide · 2 start line · 3 side tracking · 4 roadside · 5 rear chase · 6 front three-quarter · 7 overhead · 8 finish line · 0 auto director · H HUD · Space slow motion · R rematch</p>
      <div class="row"><button class="btn" id="dr-start">START RACE</button><button class="ghost" id="dr-back">Back</button></div>
    </div>`;
    document.body.appendChild(d);
    RJ.ui.registerScreen("scr-drag");
    $("dr-back").onclick = () => { RJ.ui.click(); RJ.ui.show("scr-main"); };
    $("dr-start").onclick = () => { RJ.ui.click(); RJ.startGame("drag", Object.assign({}, DR.sel)); };
    for (const k of ["a", "b"]) $("dr-" + k).onchange = (e) => { DR.sel[k] = e.target.value; DR.sel["col" + k.toUpperCase()] = null; render(); };
    css();
  }
  const carStat = (C) => {
    const hp = Math.round(C.kw * 1.341);
    return `${C.cls} · ${hp.toLocaleString()} hp · ${C.mass.toLocaleString()} kg · ${C.drive.toUpperCase()}${C.ev ? " · electric" : " · " + C.gears.length + "-speed"}`;
  };
  function render() {
    const S = DR.sel, U = RJ.ui;
    for (const k of ["a", "b"]) {
      const el = $("dr-" + k); if (!el.options.length) el.innerHTML = DR.CARS.map((c) => `<option value="${c.id}">${U.esc(c.name)}</option>`).join("");
      el.value = S[k]; const C = DR.CARS.find((c) => c.id === S[k]); $("dr-" + k + "-stat").textContent = carStat(C);
      const cols = PAINTS.map((p, i) => ({ id: String(p), name: ["Navy", "Red", "Silver", "Black", "Green", "White", "Yellow", "Orange", "Purple", "Teal"][i] }));
      U.chips($("dr-col-" + k), cols, String(S["col" + k.toUpperCase()] || C.color), (v) => { S["col" + k.toUpperCase()] = +v; render(); });
    }
    U.opts($("dr-loc"), DR.LOCS, S.loc, (v) => { S.loc = v; S.time = null; render(); });
    U.chips($("dr-dist"), DR.DISTS, S.dist, (v) => { S.dist = v; render(); });
    const L = DR.LOCS.find((l) => l.id === S.loc);
    U.chips($("dr-time"), U.TIMES().filter((t) => t.id !== "dynamic"), S.time || L.time, (v) => { S.time = v; render(); });
  }
  DR.open = function () { buildScreen(); render(); RJ.ui.show("scr-drag"); };

  /* ======================= the race ======================= */
  class DragRace {
    constructor(o) { this.o = o; this.kind = "drag"; this.customFrame = true; this.player = null; }
    async setup(progress) {
      const o = this.o, L = DR.LOCS.find((l) => l.id === o.loc) || DR.LOCS[0];
      this.D = (DR.DISTS.find((d) => d.id === o.dist) || DR.DISTS[0]).m;
      RJ.world.setEnvironment({ time: o.time || L.time, weather: L.id === "desert" ? "clear" : "scattered" });
      RJ.atlas.ensure();
      // the site: origin at the start line, u along the strip, E the surface height
      let site;
      if (L.id === "boulevard" || L.id === "neon") {
        const id = L.id === "neon" ? "tokyo" : "dubai", C = RJ.cities; C.ensure(id);
        const S = C.sites[id], T = C.STYLE[id], cs = Math.round(T.canyon.s / T.block) * T.block, p0 = -T.canyon.half + 150;
        const x = S.x + S.sx * cs + S.px * p0, z = S.z + S.sz * cs + S.pz * p0;
        site = { x, z, ux: S.px, uz: S.pz, E: S.elev + 0.42, city: true };
        if (RJ.world.airbase) RJ.world.setAirbase(null);
      } else if (L.id === "desert") {
        const reg = RJ.world.findRegion("desert"), yaw = reg.yaw || 0, ux = Math.sin(yaw), uz = Math.cos(yaw);
        let hi = -Infinity; for (let k = -2; k <= 14; k++) hi = Math.max(hi, RJ.world.heightFn(reg.x + ux * k * 100, reg.z + uz * k * 100));
        site = { x: reg.x, z: reg.z, ux, uz, E: hi + 1.2, raised: true };
        if (RJ.world.airbase) RJ.world.setAirbase(null);
      } else {
        const ab = RJ.atlas.home && RJ.atlas.home.ab ? RJ.atlas.home.ab : RJ.world.planAirbase(RJ.world.findRegion("mountains").x, RJ.world.findRegion("mountains").z, 0);
        RJ.world.setAirbase(ab);
        const ux = ab.dx, uz = ab.dz, x = ab.x - ux * (ab.len / 2 - 250), z = ab.z - uz * (ab.len / 2 - 250);
        site = { x, z, ux, uz, E: ab.elev + 0.25, runway: true, stands: L.id === "strip" };
      }
      this.site = site; this.vx = -site.uz; this.vz = site.ux;
      await RJ.world.prepare(V3(site.x + site.ux * this.D / 2, site.E, site.z + site.uz * this.D / 2), progress);
      this.grp = new THREE.Group(); RJ.world.scene.add(this.grp);
      this.buildTrack(L);
      // the cars
      const mk = (id, col, lane) => { const C = DR.CARS.find((c) => c.id === id) || DR.CARS[0], car = new Car(C, lane); car.m = carModel(C, col || C.color); this.grp.add(car.m); car.voice = engineVoice(C); return car; };
      this.cars = [mk(o.a, o.colA, -1), mk(o.b, o.colB, 1)];
      for (const c of this.cars) { c.x = -9; c.state = "pre"; }
      this.t = 0; this.phase = "stage"; this.raceT = 0; this.tree = 0; this.timeScale = 1; this.slow = 0; this.slowToggle = false; this.finished = false;
      this.cam = { shot: "start", auto: true, t: 0, pos: null, look: V3(), fov: 50, cut: true, road: null };
      this.hudOn = true; this.buildHud();
      if (RJ.cityKit) RJ.cityKit.quiet = true; // close the road: no city traffic while racing
      RJ.ui.returnTo = "scr-drag";
      RJ.ui.flash("DRAG RACE", `${this.cars[0].C.name} vs ${this.cars[1].C.name}`, 2.4);
    }
    W(u, v, y) { const s = this.site; return V3(s.x + s.ux * u + this.vx * v, s.E + (y || 0), s.z + s.uz * u + this.vz * v); }
    buildTrack(L) {
      const s = this.site, G = this.grp, len = this.D + 420, E = s.E;
      const yaw = Math.atan2(s.ux, s.uz);
      const place = (m, u, v, y, ry) => { const p = this.W(u, v, y); m.position.copy(p); m.rotation.y = yaw + (ry || 0); G.add(m); return m; };
      // racing surface with lane lines, start and finish, the shutdown area; a concrete launch pad (rubbered in)
      const c = document.createElement("canvas"); c.width = 256; c.height = 2048; const x = c.getContext("2d");
      x.fillStyle = "#2b2c2e"; x.fillRect(0, 0, 256, 2048);
      for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${Math.random() * 0.04})`; x.fillRect(Math.random() * 256, Math.random() * 2048, 2, 2); }
      const Uy = (u) => 2048 - ((u + 60) / len) * 2048;
      x.fillStyle = "#4c4d50"; x.fillRect(0, Uy(140), 256, Uy(-60) - Uy(140));                                 // launch pad concrete
      for (const lx of [64, 192]) { x.fillStyle = "rgba(10,10,10,.75)"; x.fillRect(lx - 22, Uy(160), 16, Uy(-2) - Uy(160)); x.fillRect(lx + 6, Uy(160), 16, Uy(-2) - Uy(160)); } // rubber
      x.fillStyle = "#e8e8e0"; x.fillRect(126, 0, 4, 2048); x.fillRect(0, 0, 6, 2048); x.fillRect(250, 0, 6, 2048);
      x.fillRect(0, Uy(0) - 3, 256, 6); x.fillStyle = "#e8e8e0"; x.fillRect(0, Uy(this.D) - 4, 256, 8);    // start and finish lines
      for (let k = 0; k < 16; k++) { x.fillStyle = k % 2 ? "#111" : "#eee"; x.fillRect(k * 16, Uy(this.D) - 14, 16, 10); }
      const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
      const sg = new THREE.PlaneGeometry(26, len); sg.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      surf.receiveShadow = true; surf.position.copy(this.W(len / 2 - 60, 0, 0.03)); surf.rotation.y = Math.atan2(-s.ux, -s.uz); G.add(surf);
      if (s.raised) { const pad = new THREE.Mesh(new THREE.BoxGeometry(60, 1, len + 120), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.95 })); const lo = RJ.world.heightFn(s.x, s.z) - 30; pad.scale.y = E - lo; place(pad, len / 2 - 60, 0, -(E - lo) / 2 - 0.02); }
      // concrete walls: the centre divider and both sides
      const wallM = new THREE.MeshStandardMaterial({ color: 0xd4d2cc, roughness: 0.85 });
      for (const v of [-13.5, 13.5]) place(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, len), wallM), len / 2 - 60, v, 0.55);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, len - 80), wallM), len / 2 - 20, 0, 0.45);
      // the Christmas tree on the centre line ahead of the start
      const tree = new THREE.Group(), pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.4, 0.35), new THREE.MeshStandardMaterial({ color: 0x222428 })); pole.position.y = 1.7; tree.add(pole);
      this.bulbs = { stage: [], amber: [[], [], []], green: [], red: [] };
      const bulb = (col, y, side) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0 })); m.position.set(side * 0.26, y, -0.2); tree.add(m); return m; };
      for (const side of [-1, 1]) { this.bulbs.stage.push(bulb(0xffffff, 3.2, side), bulb(0xffffff, 2.95, side)); for (let k = 0; k < 3; k++) this.bulbs.amber[k].push(bulb(0xffa020, 2.6 - k * 0.3, side)); this.bulbs.green.push(bulb(0x20ff40, 1.65, side)); this.bulbs.red.push(bulb(0xff2010, 1.35, side)); }
      place(tree, 6, 0, 0, Math.PI);
      // timing tower and finish gantry with boards (filled in at the finish)
      this.board = document.createElement("canvas"); this.board.width = 512; this.board.height = 128; this.boardTex = new THREE.CanvasTexture(this.board);
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
      for (const v of [-16, 16]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), new THREE.MeshStandardMaterial({ color: 0x333 })); place(post, this.D, v, 3.5); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(33, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x333 })); place(beam, this.D, 0, 7);
      place(bm, this.D + 0.4, 0, 8.6, Math.PI); this.drawBoard("", "");
      // light towers (lit at night) every 120 m on both sides
      const lm = new THREE.MeshBasicMaterial({ color: 0xfff1d8, toneMapped: false });
      this.lamps = [];
      for (let u = -40; u < len - 60; u += 120) for (const v of [-18, 18]) {
        place(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 16, 8), new THREE.MeshStandardMaterial({ color: 0x777 })), u, v, 8);
        const h = place(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.8), lm), u, v * 0.92, 16.2); this.lamps.push(h);
      }
      const night = RJ.world.sunElev < 6;
      if (night) for (let u = 40; u < this.D + 200; u += 240) { const pl = new THREE.PointLight(0xfff1d8, 2.2, 260, 1.6); pl.position.copy(this.W(u, 0, 18)); G.add(pl); }
      // grandstands with a crowd (drag strip) / temporary stands elsewhere, banners and the staging lanes
      if (s.stands || s.runway || s.raised) {
        const standM = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.8 });
        const crowd = []; const CL = [0xd03020, 0x2a5fa8, 0xf2f2ee, 0x1c1d20, 0xf2c21b, 0x3a7a3a, 0xe87a1a];
        for (const side of [-1, 1]) for (let k = 0; k < (s.stands ? 5 : 2); k++) {
          const u0 = -20 + k * 70; const st = new THREE.Group();
          for (let row = 0; row < 8; row++) { const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 60), standM); step.position.set(-side * row * 1.2, row * 0.6 + 0.3, 0); st.add(step); for (let p = 0; p < 26; p++) if (Math.random() < 0.85) crowd.push(this.W(u0 + (p - 12.5) * 2.2, side * (24 + row * 1.2), row * 0.6 + 0.6)); }
          place(st, u0, side * 24, 0);
        }
        const g = new THREE.BoxGeometry(0.5, 1.6, 0.35); g.translate(0, 0.8, 0);
        const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowd.length); const m4 = new THREE.Matrix4(), cc = new THREE.Color();
        crowd.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); im.setColorAt(i, cc.setHex(CL[i % CL.length])); }); G.add(im); this.crowd = im; this.crowdBase = crowd;
      }
      // banners over the start
      const ban = document.createElement("canvas"); ban.width = 1024; ban.height = 128; const bx = ban.getContext("2d"); bx.fillStyle = "#c8102e"; bx.fillRect(0, 0, 1024, 128); bx.fillStyle = "#fff"; bx.font = "bold 76px system-ui"; bx.textAlign = "center"; bx.fillText("JET CITY DRAGWAY", 512, 92);
      const bt = new THREE.CanvasTexture(ban); place(new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), new THREE.MeshBasicMaterial({ map: bt, side: THREE.DoubleSide })), -25, 0, 9.5);
      for (const v of [-13.8, 13.8]) place(new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.4), new THREE.MeshStandardMaterial({ color: 0x333 })), -25, v, 5.5);
    }
    drawBoard(l, r) {
      const x = this.board.getContext("2d"); x.fillStyle = "#050505"; x.fillRect(0, 0, 512, 128);
      x.font = "bold 54px ui-monospace,monospace"; x.fillStyle = "#ffcc22"; x.textAlign = "center"; x.fillText(l || "--.---", 128, 84); x.fillText(r || "--.---", 384, 84);
      x.fillStyle = "#555"; x.fillRect(254, 10, 4, 108); this.boardTex.needsUpdate = true;
    }
    /* ---------- frame ---------- */
    frame(dt) {
      const I = RJ.input;
      this.input(I);
      const sdt = dt * this.timeScale;
      this.t += sdt;
      // the sequence: roll into the beams, the tree counts down, green, run, shut down
      if (this.phase === "stage") {
        for (const c of this.cars) { c.x = Math.min(0, c.x + sdt * 2.2); if (c.x > -0.3) c.state = "staged"; }
        for (const b of this.bulbs.stage.slice(0, 2)) b.material.emissiveIntensity = this.cars[0].x > -2 ? 3 : 0;
        for (const b of this.bulbs.stage.slice(2)) b.material.emissiveIntensity = this.cars[1].x > -2 ? 3 : 0;
        if (this.cars.every((c) => c.state === "staged")) { this.phase = "tree"; this.tree = 0; for (const c of this.cars) { c.x = 0; c.rpm = c.C.ev ? 0 : c.C.rpmP * 0.35; } }
      } else if (this.phase === "tree") {
        this.tree += sdt;
        for (let k = 0; k < 3; k++) for (const b of this.bulbs.amber[k]) b.material.emissiveIntensity = this.tree > 1.0 + k * 0.5 && this.tree < 2.5 ? 4 : 0;
        for (const c of this.cars) if (!c.C.ev) c.rpm = c.C.rpmP * (0.35 + 0.25 * Math.max(0, Math.sin(this.t * 9 + c.lane))); // revving on the line
        if (this.tree >= 2.5) { this.phase = "race"; this.raceT = 0; for (const b of this.bulbs.green) b.material.emissiveIntensity = 5; for (const c of this.cars) c.state = "go"; if (this.cam.auto) this.setShot("chase", true); }
      } else if (this.phase === "race" || this.phase === "shutdown") {
        this.raceT += sdt;
        const N = Math.max(1, Math.ceil(sdt / (1 / 600)));
        for (let i = 0; i < N; i++) for (const c of this.cars) c.step(sdt / N, this.raceT, this.D);
        // tyre smoke and exhaust flames
        for (const c of this.cars) {
          const M = c.m.userData, back = this.carPos(c, -1.6);
          if (c.slip > 0.25 && c.v < 60) for (const sd of [-0.8, 0.8]) RJ.fx.smoke(this.W(c.x - c.C.wb * 0.6, c.lane * 6.5 + sd, 0.4), V3(this.site.ux * -c.v * 0.1, 0.8, this.site.uz * -c.v * 0.1), 1.2 + c.slip * 1.5, 0.82, 2.4, 0.5);
          if ((c.flame > 0.2 || (c.C.id === "dragster" && c.thr > 0)) && M.exhaust.length) for (const e of M.exhaust) { const p = c.m.localToWorld(e.clone()); RJ.fx.fire(p, V3(this.site.ux * -6, c.C.id === "dragster" ? 6 : 0, this.site.uz * -6), c.C.id === "dragster" ? 1.4 : 0.5); }
          if (c.done && c.C.chute && c.chute > 0 && !c.chuteM) { c.chuteM = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })); c.chuteM.rotation.x = -Math.PI / 2; this.grp.add(c.chuteM); }
          if (c.chuteM) { const p = this.W(c.x + 12, c.lane * 6.5, 1.4); c.chuteM.position.copy(p); c.chuteM.lookAt(this.W(c.x, c.lane * 6.5, 1.4)); c.chuteM.rotateX(Math.PI / 2); }
        }
        // the finish: first across wins; slow motion at the line when it's close
        if (!this.finished && this.cars.some((c) => c.done)) {
          this.finished = true; this.phase = "shutdown"; this.finishT = this.t;
          const [a, b] = this.cars, ta = a.marks.finish ? a.marks.finish.g : Infinity, tb = b.marks.finish ? b.marks.finish.g : Infinity;
          this.winner = ta <= tb ? a : b;
          if (this.cam.auto) this.setShot("finish", true);
          this.slow = 1.6;
        }
        if (this.finished) {
          const [a, b] = this.cars;
          this.drawBoard(a.marks.finish ? a.marks.finish.t.toFixed(3) : "", b.marks.finish ? b.marks.finish.t.toFixed(3) : "");
          if (this.cars.every((c) => c.done && c.v < 3) && !this.shown) { this.shown = true; setTimeout(() => this.results(), 600); }
          if (this.t - this.finishT > 14 && !this.shown) { this.shown = true; this.results(); }
        }
      }
      // place the cars
      for (const c of this.cars) {
        const M = c.m.userData, p = this.W(c.x, c.lane * 6.5, 0);
        c.m.position.copy(p); c.m.rotation.set(0, Math.atan2(-this.site.ux, -this.site.uz), 0);
        M.body.rotation.x = c.pitch + (c.C.id === "dragster" ? Math.min(0.05, Math.max(0, c.a / 9.81 - 3) * 0.02) : 0);
        for (const wh of M.wheels) wh.rotation.x -= (c.w || c.v / c.C.r) * sdt;
      }
      // night lamps, crowd bounce, camera, world, audio, render, HUD
      const nk = RJ.cityKit ? RJ.cityKit.NIGHT.value : 0;
      if (this.crowd && this.phase !== "stage") { const m4 = new THREE.Matrix4(); this.crowdBase.forEach((p, i) => { m4.makeTranslation(p.x, p.y + Math.max(0, Math.sin(this.t * 8 + i)) * 0.25 * (this.phase === "race" ? 1 : 0.3), p.z); this.crowd.setMatrixAt(i, m4); }); this.crowd.instanceMatrix.needsUpdate = true; }
      const camera = RJ.view.camera;
      this.camera(camera, dt);
      const lead = this.cars[0].x > this.cars[1].x ? this.cars[0] : this.cars[1];
      RJ.world.update(dt, camera, this.W(lead.x, 0, 2), V3(this.site.ux * lead.v, 0, this.site.uz * lead.v), 2);
      RJ.fx.update(dt, camera, RJ.view.renderer);
      const camV = this.cam.vel || V3();
      for (const c of this.cars) if (c.voice) { const cp = this.W(c.x, c.lane * 6.5, 0.8), toCam = camera.position.clone().sub(cp).normalize(), rel = V3(this.site.ux * c.v, 0, this.site.uz * c.v).sub(camV).dot(toCam); c.voice.set(c, camera.position, cp, rel); }
      RJ.view.renderWorld(dt);
      this.hud();
    }
    carPos(c, du) { return this.W(c.x + (du || 0), c.lane * 6.5, 0.6); }
    input(I) {
      const C = this.cam, map = { "1": "wide", "2": "start", "3": "side", "4": "road", "5": "chase", "6": "front", "7": "overhead", "8": "finish" };
      for (const k in map) if (I.anyEdge(k)) { C.auto = false; this.setShot(map[k], true); RJ.ui.flash(map[k].toUpperCase() + " CAMERA", "0 for the auto director", 1); }
      if (I.anyEdge("0") || I.action("camera")) { C.auto = !C.auto; RJ.ui.flash(C.auto ? "AUTO DIRECTOR" : "MANUAL CAMERA", null, 1); }
      if (I.anyEdge("h") || I.action("hud")) { this.hudOn = !this.hudOn; this.hudEl.style.display = this.hudOn ? "" : "none"; }
      if (I.anyEdge("space")) this.slowToggle = !this.slowToggle;
      if (I.anyEdge("r")) { RJ.restartGame(); return; }
      this.slow = Math.max(0, this.slow - 1 / 60);
      const want = this.slowToggle ? 0.25 : this.slow > 0 ? 0.3 : 1;
      this.timeScale += (want - this.timeScale) * 0.1;
    }
    /* ---------- cameras ---------- */
    setShot(s, cut) { this.cam.shot = s; this.cam.t = 0; this.cam.cut = !!cut; this.cam.road = null; }
    camera(camera, dt) {
      const C = this.cam, [a, b] = this.cars, lead = a.x > b.x ? a : b, mx = (a.x + b.x) / 2, v = (a.v + b.v) / 2;
      C.t += dt;
      // the director: launch from behind, then alongside, a roadside pass, the front three-quarter, the finish line
      if (C.auto && this.phase === "race") {
        const togo = this.D - lead.x;
        if (togo < 70 + lead.v * 1.2 && C.shot !== "finish") this.setShot("finish", true);
        else if (C.shot === "chase" && C.t > 1.6) this.setShot("side", true);
        else if (C.shot === "side" && C.t > 2.4 && togo > 160) this.setShot("road", true);
        else if (C.shot === "road" && C.t > 2.2 && togo > 140) this.setShot(Math.random() < 0.5 ? "front" : "overhead", true);
        else if ((C.shot === "front" || C.shot === "overhead") && C.t > 2.2 && togo > 120) this.setShot("side", true);
      } else if (C.auto && this.phase === "stage" && C.shot !== "start" && C.shot !== "wide") this.setShot("start", true);
      else if (C.auto && this.phase === "tree" && C.t > 2.2 && C.shot === "start") this.setShot("wide", false);
      else if (C.auto && this.phase === "shutdown" && C.t > 4 && C.shot === "finish") this.setShot("wide", false);
      let pos, look, fov = 50;
      const S = C.shot;
      if (S === "start") { pos = this.W(14, 0.6, 0.35); look = this.W(-2, 0, 0.9); fov = 48; }
      else if (S === "wide") { pos = this.W(mx + 40, -60, 22); look = this.W(mx + 25, 0, 0); fov = 46; }
      else if (S === "side") { pos = this.W(mx + 3, -26, 4.2); look = this.W(mx + 2, 0, 0.6); fov = 36; }
      else if (S === "road") { if (!C.road) C.road = mx + Math.max(40, v * 2.2); pos = this.W(C.road, -13.5, 1.75); look = this.W(mx, 0, 0.8); fov = 42; }
      else if (S === "chase") { pos = this.W(mx - 16, 0, 2.4); look = this.W(mx + 8, 0, 0.8); fov = 52; }
      else if (S === "front") { pos = this.W(lead.x + 16, -9, 1.1); look = this.W(mx, 0, 0.7); fov = 44; }
      else if (S === "overhead") { pos = this.W(mx - 4, 0, 70); look = this.W(mx + 6, 0, 0); fov = 40; }
      else { pos = this.W(this.D + 1, -14, 2.3); look = this.W(Math.min(this.D, lead.x + 8), 0, 0.6); fov = 34; }
      if (!C.pos || C.cut) { C.pos = pos.clone(); C.look.copy(look); C.fov = fov; C.cut = false; C.vel = V3(); }
      else {
        const prev = C.pos.clone(), k = 1 - Math.exp(-dt * (S === "side" || S === "chase" || S === "front" || S === "overhead" ? 12 : 6));
        C.pos.lerp(pos, k); C.look.lerp(look, Math.min(1, k * 1.5)); C.fov += (fov - C.fov) * Math.min(1, dt * 3);
        C.vel = C.pos.clone().sub(prev).multiplyScalar(1 / Math.max(1e-3, dt));
      }
      camera.position.copy(C.pos); camera.up.set(0, 1, 0); camera.lookAt(C.look);
      if (Math.abs(camera.fov - C.fov) > 0.01) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    }
    /* ---------- HUD and results ---------- */
    buildHud() {
      css();
      const h = document.createElement("div"); h.id = "dr-hud";
      h.innerHTML = `<div class="card a"></div><div class="card b"></div><div class="mid"></div><div class="help">1–8 cameras · 0 auto · H HUD · Space slow motion · R rematch · Esc pause</div>`;
      document.body.appendChild(h); this.hudEl = h;
      // touch: camera and director buttons (keyboard users have 0–9)
      const bar = document.createElement("div"); bar.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:auto;z-index:31";
      const SH = ["wide", "start", "side", "road", "chase", "front", "overhead", "finish"];
      const btn = (t, fn) => { const b = document.createElement("button"); b.className = "ghost small"; b.textContent = t; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.appendChild(b); };
      btn("CAM ▸", () => { const i = (SH.indexOf(this.cam.shot) + 1) % SH.length; this.cam.auto = false; this.setShot(SH[i], true); });
      btn("AUTO", () => { this.cam.auto = true; });
      btn("SLOW-MO", () => { this.slowToggle = !this.slowToggle; });
      btn("HUD", () => { this.hudOn = !this.hudOn; h.style.display = this.hudOn ? "" : "none"; });
      document.body.appendChild(bar); this.barEl = bar;
    }
    hud() {
      if (!this.hudOn) return;
      const cards = this.hudEl.querySelectorAll(".card");
      this.cars.forEach((c, i) => {
        const col = "#" + new THREE.Color(c.m.userData.body.children[0].material.color).getHexString();
        cards[i].style.setProperty("--c", col);
        const togo = Math.max(0, this.D - c.x), et = c.marks.finish ? "ET " + c.marks.finish.t.toFixed(3) + " s" : this.phase === "race" || this.phase === "shutdown" ? "ET " + c.t.toFixed(2) + " s" : "--";
        cards[i].innerHTML = `<div class="nm">${RJ.ui.esc(c.C.name)}</div><div class="big">${Math.round(c.v * 2.237)} <span style="font-size:14px">mph</span></div>
          <div class="sm">${c.C.ev ? "EV" : "Gear " + (c.gear + 1)} · ${Math.round(c.rpm).toLocaleString()} rpm · ${et}</div>
          <div class="sm">${togo > 0 ? Math.round(togo) + " m to go" : "FINISHED · " + Math.round((c.trap || c.v) * 2.237) + " mph trap"}</div><div class="bar"><i style="width:${Math.min(100, c.x / this.D * 100)}%"></i></div>`;
      });
      const mid = this.hudEl.querySelector(".mid");
      if (this.phase === "stage") mid.innerHTML = "STAGING";
      else if (this.phase === "tree") { const on = (k) => this.tree > 1 + k * 0.5 ? "#ffa020" : "#333"; mid.innerHTML = `READY<div class="tree"><i style="background:${on(0)}"></i><i style="background:${on(1)}"></i><i style="background:${on(2)}"></i><i></i></div>`; }
      else if (this.phase === "race") mid.innerHTML = `<div class="tree"><i style="background:#20ff40"></i></div>GO · ${this.raceT.toFixed(2)} s`;
      else mid.innerHTML = `<div class="win">${this.winner === this.cars[0] ? "LEFT LANE" : "RIGHT LANE"} WINS</div>${RJ.ui.esc(this.winner.C.name)}`;
    }
    results() {
      if (this.hudEl) this.hudEl.style.display = "none"; if (this.barEl) this.barEl.style.display = "none";
      const [a, b] = this.cars, w = this.winner, fm = (c, k) => (c.marks[k] ? c.marks[k].t.toFixed(3) + " s" : "—");
      const margin = a.marks.finish && b.marks.finish ? Math.abs(a.marks.finish.g - b.marks.finish.g).toFixed(3) + " s" : "—";
      RJ.ui.showResults({
        eyebrow: `Drag Race Simulator · ${(DR.DISTS.find((d) => d.id === this.o.dist) || {}).name} · ${(DR.LOCS.find((l) => l.id === this.o.loc) || {}).name}`,
        title: (w === a ? "LEFT" : "RIGHT") + " LANE WINS", win: true,
        sub: `${w.C.name} by ${margin}. Fly again for a rematch, or Main menu to pick new cars.`,
        stats: [["Left · " + a.C.name, `${fm(a, "finish")} @ ${Math.round((a.trap || a.v) * 2.237)} mph`], ["Right · " + b.C.name, `${fm(b, "finish")} @ ${Math.round((b.trap || b.v) * 2.237)} mph`],
          ["Reaction (L / R)", `${a.rt.toFixed(3)} / ${b.rt.toFixed(3)} s`], ["60 ft (L / R)", `${fm(a, "60ft")} / ${fm(b, "60ft")}`], ["330 ft (L / R)", `${fm(a, "330ft")} / ${fm(b, "330ft")}`], ["1/8 mile (L / R)", `${fm(a, "eighth")} / ${fm(b, "eighth")}`], ["Margin", margin]],
        xp: 0, unlocked: []
      });
    }
    status() { return ""; }
    objective() { return ""; }
    hudExtras() { return {}; }
    dispose() {
      if (this.hudEl) this.hudEl.remove(); if (this.barEl) this.barEl.remove();
      for (const c of this.cars || []) if (c.voice) c.voice.stop();
      if (this.grp) { RJ.world.scene.remove(this.grp); this.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      if (RJ.cityKit) RJ.cityKit.quiet = false;
      if (RJ.world.airbase && this.site && this.site.runway) RJ.world.setAirbase(null);
    }
  }
  DR.DragRace = DragRace;
  DR.Car = Car; DR.engineTorque = engineTorque;
})(window.RJ);
