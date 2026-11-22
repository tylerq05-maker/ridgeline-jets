/* Ridgeline Jets — live weather: lightning (branching bolts, cloud flashes, thunder delayed by distance),
 * local rain intensity and rain sound, canopy droplets, gusts / storm turbulence / downdrafts, and dynamic
 * weather that drifts from one preset to the next with smooth transitions.
 * Presets live in RJ.world.WEATHER (lighting, physics) and RJ.clouds PRESETS (volumetric cloud field). */
(function (RJ) {
  const WX = RJ.weather = { rain: 0, shafts: 0, bolt: null, storm: 0, turb: 0, gust: new THREE.Vector3(), dyn: false };
  const NEXT = {
    clear: ["scattered"], scattered: ["clear", "overcast", "windstorm", "thunder"], overcast: ["lightrain", "scattered", "fog"],
    lightrain: ["heavyrain", "overcast"], heavyrain: ["thunder", "lightrain"], thunder: ["supercell", "squall", "heavyrain"],
    supercell: ["heavyrain"], squall: ["overcast", "lightrain"], windstorm: ["scattered", "overcast"], fog: ["overcast", "scattered"],
    storm: ["heavyrain"], cloudsea: ["scattered"]
  };
  let nextBolt = 5, mix = null, relightT = 0, sampleT = 0;

  /** Called by world.setEnvironment: "dynamic" starts the weather cycle from a calm sky. */
  WX.onEnvironment = function (id) {
    mix = null; WX.bolt = null; nextBolt = RJ.rand(2, 6); WX.rain = 0;
    WX.dyn = id === "dynamic";
    if (!WX.dyn) return id;
    WX.nextChange = RJ.rand(150, 260);
    return ["clear", "scattered", "scattered", "overcast"][Math.floor(Math.random() * 4)];
  };

  /** Blend lighting/physics fields (numbers and the [lo, hi] altitude pair) between two presets. */
  function blend(a, b, k) {
    const o = Object.assign({}, k < 0.5 ? a : b);
    for (const key in b) {
      const x = a[key], y = b[key];
      if (typeof y === "number" || typeof x === "number") o[key] = RJ.lerp(+x || 0, +y || 0, k);
      else if (Array.isArray(y) && Array.isArray(x)) o[key] = y.map((v, i) => RJ.lerp(x[i], v, k));
    }
    o.bolts = k > 0.6 ? b.bolts : a.bolts;
    return o;
  }
  /** Morph to weather `id` over `secs` seconds (clouds build or dissolve, light and wind follow). */
  WX.transition = function (id, secs = 90) {
    const W = RJ.world;
    if (!W.WEATHER[id] || id === W.env.weather) return;
    mix = { from: Object.assign({}, W.wx()), to: W.WEATHER[id], t: 0, secs, rebuilt: false };
    W.env.weather = id;
    if (RJ.clouds) RJ.clouds.setWeather(id, secs);
    if (RJ.ui && RJ.ui.toast && RJ.game && RJ.game.mode) RJ.ui.toast("🌦 Weather changing: " + W.WEATHER[id].label, 3000);
  };

  /* ---------------- lightning ---------------- */
  const _v = new THREE.Vector3();
  let boltMat, glowMat, boltMesh;
  function boltGeometry(pts, cam) {
    // camera-facing ribbons, width growing with distance so far bolts still read as a few pixels
    const pos = [], col = [], idx = [];
    for (const s of pts) {
      const a = s.a, b = s.b;
      const d = Math.max(400, _v.copy(a).distanceTo(cam)), w = s.w * Math.max(1, d * 0.00035);
      _v.subVectors(b, a).cross(new THREE.Vector3().subVectors(cam, a)).normalize().multiplyScalar(w);
      const i = pos.length / 3;
      pos.push(a.x - _v.x, a.y - _v.y, a.z - _v.z, a.x + _v.x, a.y + _v.y, a.z + _v.z, b.x - _v.x, b.y - _v.y, b.z - _v.z, b.x + _v.x, b.y + _v.y, b.z + _v.z);
      for (let k = 0; k < 4; k++) col.push(s.k, s.k, s.k);
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }
  /** Main channel stepping down with random kinks, plus forked branches that die out. */
  function channel(top, bottomY, out, w, k, depth) {
    const steps = depth ? 12 : 34, segY = (top.y - bottomY) / steps;
    let p = top.clone(), dir = new THREE.Vector3(RJ.rand(-0.3, 0.3), -1, RJ.rand(-0.3, 0.3));
    for (let i = 0; i < steps; i++) {
      dir.x = RJ.clamp(dir.x + RJ.rand(-0.55, 0.55), -1.1, 1.1); dir.z = RJ.clamp(dir.z + RJ.rand(-0.55, 0.55), -1.1, 1.1);
      const q = p.clone().add(new THREE.Vector3(dir.x * segY * 0.8, -segY * RJ.rand(0.6, 1.2), dir.z * segY * 0.8));
      out.push({ a: p, b: q, w, k });
      if (depth < 2 && Math.random() < (depth ? 0.1 : 0.16)) channel(q.clone(), q.y - segY * RJ.rand(4, 10), out, w * 0.55, k * 0.6, depth + 1);
      p = q;
      if (p.y < bottomY) break;
    }
    return p;
  }
  function strike(cam) {
    const W = RJ.world, C = RJ.clouds, L = C ? C.layer() : { base: W.cloudBase || 1500, stormTop: 9000 };
    // find a storm cell near the player (weather map + squall band)
    let x = 0, z = 0, s = 0;
    for (let i = 0; i < 48; i++) {
      const r = RJ.rand(1500, 26000), a = Math.random() * Math.PI * 2;
      const px = cam.position.x + Math.cos(a) * r, pz = cam.position.z + Math.sin(a) * r;
      const ps = C && C.weather ? C.stormAt(px, pz) : 0.8;
      if (ps > s) { s = ps; x = px; z = pz; }
      if (s > 0.8) break;
    }
    if (s <= 0.45) return;
    const dist = Math.hypot(x - cam.position.x, z - cam.position.z);
    const ground = !(Math.random() < 0.4), base = L.base + 250;
    const segs = [];
    let fy = base + 1500;
    if (ground) {
      const gY = W.ground ? W.ground(x, z) : 0;
      channel(new THREE.Vector3(x, base + 600, z), gY, segs, 5, 1, 0);
      fy = base + 500;
    } else {
      // intracloud / anvil crawler: a horizontal spider just under the base, most of the light inside the cloud
      for (let b = 0; b < 3; b++) {
        let p = new THREE.Vector3(x, base + RJ.rand(-50, 250), z), h = Math.random() * 6.28;
        for (let i = 0; i < 14; i++) { h += RJ.rand(-0.6, 0.6); const q = p.clone().add(new THREE.Vector3(Math.cos(h) * 260, RJ.rand(-60, 40), Math.sin(h) * 260)); segs.push({ a: p, b: q, w: 3.5, k: 0.7 }); p = q; }
      }
      fy = base + RJ.rand(1200, 4000);
    }
    if (!boltMat) {
      boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.4, 4), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
      glowMat = boltMat.clone(); glowMat.color.setRGB(0.5, 0.55, 0.9);
    }
    if (boltMesh) { W.scene.remove(boltMesh); boltMesh.geometry.dispose(); boltMesh.children[0].geometry.dispose(); }
    boltMesh = new THREE.Mesh(boltGeometry(segs, cam.position), boltMat);
    boltMesh.add(new THREE.Mesh(boltGeometry(segs.map((g) => ({ a: g.a, b: g.b, w: g.w * 3, k: g.k * 0.45 })), cam.position), glowMat));
    boltMesh.frustumCulled = false; boltMesh.children[0].frustumCulled = false;
    W.scene.add(boltMesh);
    // 1-4 return strokes along the same channel
    const n = 1 + Math.floor(Math.random() * 3.5), strokes = [0];
    for (let i = 1; i < n; i++) strokes.push(strokes[i - 1] + RJ.rand(0.05, 0.14));
    const near = RJ.clamp(1.35 - dist / 18000, 0.12, 1);
    WX.bolt = { t: 0, strokes, life: strokes[n - 1] + 0.35, fx: x, fy, fz: z, glow: 0, near, ground, dist };
    WX.lastStrike = { x, z, dist, ground };
    if (dist < 20000) RJ.emit("thunder", { delay: dist / 343, dist });
  }
  function boltTick(dt) {
    const b = WX.bolt; if (!b) return;
    b.t += dt;
    let I = 0;
    for (const s of b.strokes) if (b.t >= s) I = Math.max(I, Math.exp(-(b.t - s) / 0.045));
    if (b.hold) I = 1; // tests: freeze the stroke
    b.glow = I * (b.ground ? 1 : 1.6);
    const W = RJ.world;
    if (I > 0.6) { W.flash = Math.max(W.flash, b.near * I); W.flashPeak = Math.max(W.flash, 0.05); }
    if (boltMesh) { boltMat.opacity = b.ground ? I : I * 0.6; glowMat.opacity = I * 0.5; }
    if (b.t > b.life) { WX.bolt = null; if (boltMesh) { W.scene.remove(boltMesh); boltMesh.geometry.dispose(); boltMesh.children[0].geometry.dispose(); boltMesh = null; } }
  }

  /* ---------------- rain sound ---------------- */
  let rainSrc = null, rainGain = null, rainLP = null;
  function rainAudio(level, inPit) {
    const AU = RJ.audio;
    if (!AU || !AU.ctx || !AU.white || !AU.envBus) return;
    if (!rainSrc && level > 0.01) {
      const ctx = AU.ctx;
      rainSrc = ctx.createBufferSource(); rainSrc.buffer = AU.white; rainSrc.loop = true;
      rainLP = ctx.createBiquadFilter(); rainLP.type = "lowpass"; rainLP.frequency.value = 3000;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 350;
      rainGain = ctx.createGain(); rainGain.gain.value = 0;
      rainSrc.connect(hp); hp.connect(rainLP); rainLP.connect(rainGain); rainGain.connect(AU.envBus); rainSrc.start();
    }
    if (!rainSrc) return;
    const t = AU.ctx.currentTime;
    // on the canopy: a closer, brighter patter
    rainGain.gain.setTargetAtTime(level * (inPit ? 0.22 : 0.1), t, 0.4);
    rainLP.frequency.setTargetAtTime(inPit ? 5200 : 2400, t, 0.4);
  }

  /* ---------------- rain on the glass ----------------
   * Cockpit: drops land on the canopy, bead, then the airflow tears them up and out across the glass,
   * each dragging a thin wet trail and shedding tiny residue beads. Chase view: at speed, drops hit the
   * "lens" and are blown out from the centre of the screen; slow, they bead and slide down.
   * Each drop is a pre-rendered refractive sprite (a tiny inverted image of sky and ground, a dark
   * meniscus rim and a specular glint), re-tinted to the live sky once a second, so a frame costs one
   * drawImage per drop plus two short strokes per moving drop. */
  let cv = null, cx = null, spr = null, sprT = 0, dropView = "";
  const drops = [];
  function dropSprite() {
    const W = RJ.world, S = 64;
    if (!spr) { spr = document.createElement("canvas"); spr.width = spr.height = S; }
    const g = spr.getContext("2d"), hc = W.horizonColor || { r: 0.7, g: 0.75, b: 0.8 };
    const lum = RJ.clamp(hc.r * 0.3 + hc.g * 0.59 + hc.b * 0.11, 0.05, 1);
    const c8 = (v, k) => Math.round(RJ.clamp(v * k, 0, 1) * 255);
    const sky = `${c8(hc.r, 1.25)},${c8(hc.g, 1.25)},${c8(hc.b, 1.3)}`, gnd = `${c8(hc.r, 0.32)},${c8(hc.g, 0.34)},${c8(hc.b, 0.36)}`;
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 6.283); g.clip();
    // a drop is a lens that flips the world: ground refracted into its top, bright sky into its bottom
    const body = g.createLinearGradient(0, 0, 0, S);
    body.addColorStop(0, `rgba(${gnd},0.85)`); body.addColorStop(0.45, `rgba(${gnd},0.5)`);
    body.addColorStop(0.62, `rgba(${sky},0.55)`); body.addColorStop(1, `rgba(${sky},0.95)`);
    g.fillStyle = body; g.fillRect(0, 0, S, S);
    // meniscus: a dark rim where light bends away from the eye
    const rim = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(0.75, "rgba(10,14,20,0.25)"); rim.addColorStop(1, "rgba(5,8,12,0.75)");
    g.fillStyle = rim; g.fillRect(0, 0, S, S);
    g.restore();
    // specular glint (upper left) and caustic (lower right), dimmer at night
    const sp = 0.35 + 0.65 * lum;
    const gl = g.createRadialGradient(S * 0.36, S * 0.3, 0, S * 0.36, S * 0.3, S * 0.16);
    gl.addColorStop(0, `rgba(255,255,255,${0.95 * sp})`); gl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gl; g.fillRect(0, 0, S, S);
    const ca = g.createRadialGradient(S * 0.6, S * 0.76, 0, S * 0.6, S * 0.76, S * 0.2);
    ca.addColorStop(0, `rgba(255,255,250,${0.45 * sp})`); ca.addColorStop(1, "rgba(255,255,250,0)");
    g.fillStyle = ca; g.fillRect(0, 0, S, S);
    WX._dropLum = lum;
  }
  function droplets(dt, amt, speed, view) {
    if (!cv) {
      cv = document.createElement("canvas"); cv.id = "wx-drops";
      cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4";
      document.body.appendChild(cv); cx = cv.getContext("2d");
    }
    const w = Math.round(innerWidth / 2), h = Math.round(innerHeight / 2), pit = view === "cockpit";
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (view !== dropView) { drops.length = 0; dropView = view; }
    if (!view && !drops.length) { if (cv.style.display !== "none") { cx.clearRect(0, 0, w, h); cv.style.display = "none"; } return; }
    sprT -= dt;
    if (!spr || sprT <= 0) { dropSprite(); sprT = 1; }
    const flow = RJ.clamp(speed / 120, 0, 3); // airflow strength over the glass
    // impacts: the canopy catches more rain the faster it flies; the chase "lens" mostly at speed
    if (view && amt > 0.02 && dt > 0) {
      const rate = pit ? amt * 70 * (1 + flow * 0.8) : amt * 26 * (0.25 + 0.75 * RJ.smooth(40, 160, speed));
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const r = (pit ? RJ.rand(1.1, 3.4) : RJ.rand(0.9, 2.6)) * (0.65 + amt * 0.5) * (h / 270);
          drops.push({ x: Math.random() * w, y: Math.random() * h, r, life: RJ.rand(1.2, 3.2) * (flow > 0.5 ? 0.7 : 1.6), stick: RJ.rand(0.05, pit ? 0.7 : 0.25) * (flow > 0.3 ? 1 : 6), v: 0, tx: 0, ty: 1, trail: 0, res: 0 });
        }
        n--;
      }
    }
    if (drops.length > 260) drops.splice(0, drops.length - 260);
    cx.clearRect(0, 0, w, h);
    // a faint film of water around the edges of the canopy in steady rain
    const film = pit ? RJ.clamp(amt * 1.3, 0, 1) : 0;
    if (film > 0.05) {
      const fg = cx.createRadialGradient(w / 2, h * 0.5, h * 0.35, w / 2, h * 0.5, Math.hypot(w, h) * 0.6);
      fg.addColorStop(0, "rgba(160,175,190,0)"); fg.addColorStop(1, `rgba(150,165,180,${0.16 * film * (0.4 + 0.6 * (WX._dropLum || 0.5))})`);
      cx.fillStyle = fg; cx.fillRect(0, 0, w, h);
    }
    if (!drops.length && film <= 0.05) { cv.style.display = "none"; return; }
    cv.style.display = "";
    const cxp = w / 2, cyp = pit ? h * 0.55 : h * 0.5, night = 0.45 + 0.55 * (WX._dropLum || 0.5);
    cx.lineCap = "round";
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt;
      if (d.life <= 0 || d.x < -20 || d.x > w + 20 || d.y < -20 || d.y > h + 20) { drops.splice(i, 1); continue; }
      d.stick -= dt;
      if (d.stick <= 0 && d.r > 0.8 && dt > 0) {
        const ox = d.x - cxp, oy = d.y - cyp, l = Math.hypot(ox, oy) || 1;
        let dx, dy;
        if (flow > 0.3) {
          // torn off by the airflow: accelerates outward (and up the canopy in the cockpit)
          d.v = Math.min(d.v + dt * (pit ? 220 : 420) * flow, (pit ? 160 : 520) * flow);
          dx = ox / l; dy = pit ? oy / l * 0.45 - 0.9 : oy / l;
          const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
        } else {
          // no airflow: a heavy bead slides down under gravity, wandering a little
          d.v = Math.min(d.v + dt * 30 * d.r, 18 * d.r);
          dx = Math.sin(d.y * 0.37 + d.x * 0.11) * 0.25; dy = 1;
        }
        d.x += dx * d.v * dt; d.y += dy * d.v * dt;
        d.tx = dx; d.ty = dy; d.trail = Math.min(d.trail + d.v * dt, d.r * (flow > 0.3 ? 14 : 8));
        // moving drops leave tiny residue beads behind them
        d.res += d.v * dt;
        if (d.res > d.r * 6 && drops.length < 250 && Math.random() < 0.5) { d.res = 0; drops.push({ x: d.x - dx * d.r * 3, y: d.y - dy * d.r * 3, r: d.r * RJ.rand(0.25, 0.45), life: RJ.rand(0.4, 1.4), stick: 9, v: 0, tx: 0, ty: 1, trail: 0, res: 0 }); d.r *= 0.97; }
      }
      const a = Math.min(1, d.life * 2.5) * (pit ? 0.8 : 0.65) * night, r = d.r;
      if (d.trail > r) {
        cx.strokeStyle = `rgba(200,212,226,${a * 0.28})`; cx.lineWidth = r * 0.9;
        cx.beginPath(); cx.moveTo(d.x - d.tx * d.trail, d.y - d.ty * d.trail); cx.lineTo(d.x, d.y); cx.stroke();
        cx.strokeStyle = `rgba(255,255,255,${a * 0.22})`; cx.lineWidth = Math.max(0.6, r * 0.3);
        cx.beginPath(); cx.moveTo(d.x - d.tx * d.trail * 0.7, d.y - d.ty * d.trail * 0.7); cx.lineTo(d.x, d.y); cx.stroke();
      }
      cx.globalAlpha = a;
      // fast drops stretch along their path
      if (d.v > 30) { cx.save(); cx.translate(d.x, d.y); cx.rotate(Math.atan2(d.ty, d.tx)); const s = 1 + Math.min(d.v / 200, 0.9); cx.drawImage(spr, -r * s, -r * 0.85, r * 2 * s, r * 1.7); cx.restore(); }
      else cx.drawImage(spr, d.x - r, d.y - r, r * 2, r * 2);
      cx.globalAlpha = 1;
    }
  }

  /* ---------------- per frame ---------------- */
  WX.update = function (dt, cam) {
    const W = RJ.world, C = RJ.clouds;
    if (C && C.step) C.step(dt);
    // weather transition
    if (mix) {
      mix.t += dt;
      const k = RJ.smooth(0, 1, mix.t / mix.secs);
      W.wxMix = blend(mix.from, mix.to, k);
      if (!mix.rebuilt && k > 0.5) { mix.rebuilt = true; W.rebuildClouds(); }
      relightT += dt;
      if (relightT > 0.5 || k >= 1) { relightT = 0; W.syncCloudLayer(); if (!W.cycle) W.relight(k >= 1); }
      if (k >= 1) { mix = null; W.wxMix = null; W.relight(true); }
    }
    if (WX.dyn && dt > 0 && !mix) {
      WX.nextChange -= dt;
      if (WX.nextChange <= 0) {
        const opts = NEXT[W.env.weather] || ["scattered"];
        WX.transition(opts[Math.floor(Math.random() * opts.length)], RJ.rand(70, 120));
        WX.nextChange = RJ.rand(180, 320);
      }
    }
    const wx = W.wx(), p = cam.position;
    // storm strength around the camera (sampled a few times a second)
    sampleT -= dt;
    if (sampleT <= 0) {
      sampleT = 0.25;
      let s = 0;
      if (C && C.weather) for (const [ox, oz] of [[0, 0], [1200, 0], [-1200, 0], [0, 1200], [0, -1200]]) s = Math.max(s, C.stormAt(p.x + ox, p.z + oz) * (ox || oz ? 0.8 : 1));
      WX.storm = s;
    }
    // rain: the preset's base rate, concentrated under storm cells (and only in the squall band for a squall)
    const base = +wx.rain || 0, stormy = !!wx.bolts && !!(C && C.weather);
    const target = stormy ? base * (wx.squall ? RJ.smooth(0.2, 0.7, WX.storm) : 0.25 + 0.75 * RJ.smooth(0.15, 0.7, WX.storm)) : base;
    WX.rain = RJ.damp(WX.rain, target, 0.8, dt);
    WX.shafts = stormy || base > 0.6 ? base : 0;
    // lightning
    if (wx.bolts && dt > 0) {
      nextBolt -= dt;
      if (nextBolt <= 0) { nextBolt = RJ.rand(wx.bolts[0], wx.bolts[1]); strike(cam); }
    }
    boltTick(dt);
    // gusts: smooth noise on top of the mean wind, stronger in storms and near cells; turbulence for flight.js
    const t = performance.now() / 1000, g = (wx.gust || 2) * (1 + WX.storm * 0.8);
    const n1 = Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1.2) + 0.4 * Math.sin(t * 3.1), n2 = Math.sin(t * 0.9 + 2) * Math.sin(t * 2.3) + 0.4 * Math.sin(t * 4.3 + 1);
    WX.gust.set(n1 * g, 0, n2 * g * 0.7);
    WX.turb = (wx.turb || 0) + WX.storm * 0.9;
    const pl = RJ.game && RJ.game.mode && RJ.game.mode.player, inPit = RJ.cam && RJ.cam.mode === "cockpit";
    const under = p.y < Math.max(W.cloudBase || 0, 300) + 300;
    rainAudio(under ? WX.rain : W.inCloud > 0.3 ? (+wx.rain || 0) * 0.5 : 0, inPit);
    const view = RJ.cam && !RJ.cam.temp && (RJ.cam.mode === "cockpit" || RJ.cam.mode === "chase") ? RJ.cam.mode : "";
    droplets(dt, under ? WX.rain : (W.inCloud || 0) * ((+wx.rain || 0) + 0.15), pl ? pl.speed || 0 : 0, view);
  };

  WX.strike = strike; // tests

  /** Extra turbulence, gust and storm downdraft for an aircraft (flight.js adds these to its own bumps). */
  WX.forAircraft = function (ac, out) {
    const W = RJ.world, below = ac.pos.y < (W.cloudBase || 1500);
    const s = ac.isPlayer ? WX.storm : WX.storm * 0.5;
    // convective turbulence in and around storm cells, strongest inside the cloud
    out.turb = WX.turb * (ac.isPlayer ? 0.6 + (W.inCloud || 0) * 1.2 : 0.4);
    out.gx = WX.gust.x; out.gz = WX.gust.z;
    // downdraft under strong cells (microburst-like), fading near the ground so it never forces a crash outright
    out.down = below && s > 0.5 ? -RJ.clamp((s - 0.5) * 14, 0, 9) * RJ.smooth(30, 400, ac.agl || 1000) : 0;
    return out;
  };
})(window.RJ);
