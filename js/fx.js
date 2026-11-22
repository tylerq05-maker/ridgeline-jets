/* Ridgeline Jets — GPU particle effects: explosions, smoke, contrails, vapor, sparks, flares, sonic boom
 * vapor, sea spray, dust, waterfall mist and cloud streaks. Smoke-type particles are lit by the sun with
 * forward scattering (bright when backlit), so vapor glows at sunset. */
(function (RJ) {
  "use strict";
  const FX = { time: 0, wind: new THREE.Vector3(4.8, 0, 3.6) };
  RJ.fx = FX;

  function puffTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const rnd = RJ.world.gen.mulberry32(5);
    for (let i = 0; i < 16; i++) {
      const x = 32 + (rnd() - 0.5) * 22, y = 32 + (rnd() - 0.5) * 22, r = 9 + rnd() * 15;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(c);
  }

  class Particles {
    constructor(scene, max, additive, tex) {
      this.max = max; this.i = 0; this.dirtyFrom = -1; this.dirtyCount = 0; this.wrapped = false;
      const g = new THREE.BufferGeometry();
      this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
      this.a = new Float32Array(max * 4); this.c = new Float32Array(max * 4); this.e = new Float32Array(max * 2);
      for (let k = 0; k < max; k++) this.a[k * 4] = -1000;
      this.attrs = [
        new THREE.BufferAttribute(this.p, 3), new THREE.BufferAttribute(this.v, 3), new THREE.BufferAttribute(this.a, 4),
        new THREE.BufferAttribute(this.c, 4), new THREE.BufferAttribute(this.e, 2)
      ];
      this.attrs.forEach((at) => at.setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("position", this.attrs[0]); g.setAttribute("velocity", this.attrs[1]);
      g.setAttribute("params", this.attrs[2]); g.setAttribute("tint", this.attrs[3]); g.setAttribute("extra", this.attrs[4]);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      this.mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          time: { value: 0 }, pixelScale: { value: 500 }, map: { value: null }, additive: { value: additive ? 1 : 0 },
          sunDir: { value: new THREE.Vector3(0, 1, 0) }, lightCol: { value: new THREE.Color(1, 1, 1) }, ambCol: { value: new THREE.Color(0.6, 0.65, 0.75) }
        }]),
        vertexShader: [
          "attribute vec3 velocity; attribute vec4 params; attribute vec4 tint; attribute vec2 extra;",
          "uniform float time; uniform float pixelScale; uniform vec3 sunDir;",
          "varying float vAlpha; varying vec3 vCol; varying float vT; varying float vDepth; varying float vFwd; varying float vNear;",
          "void main(){",
          "  float age = time - params.x; float t = age / params.y;",
          "  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }",
          "  float d = extra.y;",
          "  vec3 disp = d > 0.0 ? velocity * (1.0 - exp(-d * age)) / d : velocity * age;",
          "  vec3 p = position + disp + vec3(0.0, 0.5 * extra.x * age * age, 0.0);",
          "  vec4 mv = viewMatrix * vec4(p, 1.0);",
          "  gl_Position = projectionMatrix * mv;",
          "  float size = mix(params.z, params.w, sqrt(t));",
          "  gl_PointSize = clamp(size * pixelScale / max(-mv.z, 0.5), 0.0, 1024.0);",
          "  vAlpha = tint.a * (1.0 - t) * smoothstep(0.0, 0.06, t + 0.01);",
          "  vNear = smoothstep(0.35, 1.6, -mv.z / max(size, 0.1));",          // a puff about to engulf the camera fades out instead of becoming a flat disc
          "  vCol = tint.rgb; vT = t; vDepth = -mv.z;",
          "  vFwd = pow(max(dot(normalize(p - cameraPosition), normalize(sunDir)), 0.0), 8.0);",
          "}"
        ].join("\n"),
        fragmentShader: [
          "uniform sampler2D map; uniform float additive; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;",
          "uniform vec3 lightCol; uniform vec3 ambCol;",
          "varying float vAlpha; varying vec3 vCol; varying float vT; varying float vDepth; varying float vFwd; varying float vNear;",
          "void main(){",
          "  float a; vec3 col = vCol;",
          "  if (additive > 0.5) { float r = length(gl_PointCoord - 0.5); a = 1.0 - smoothstep(0.05, 0.5, r); col *= mix(vec3(1.6, 1.4, 1.1), vec3(1.0, 0.45, 0.18), vT); }",
          "  else {",
          "    a = texture2D(map, gl_PointCoord).a * 1.6;",
          "    float lum = max(max(col.r, col.g), col.b);",
          "    col = col * mix(ambCol, lightCol, 0.7) + lightCol * vFwd * 0.9 * lum;",
          "  }",
          "  a *= vAlpha; if (additive < 0.5) a *= vNear; if (a < 0.004) discard;",
          "  float f = smoothstep(fogNear, fogFar, vDepth);",
          "  if (additive > 0.5) { a *= (1.0 - f); } else { col = mix(col, fogColor, f); }",
          "  gl_FragColor = vec4(col, a);",
          "}"
        ].join("\n")
      });
      this.mat.uniforms.map.value = tex; // merge() clones textures; keep the original
      this.pts = new THREE.Points(g, this.mat);
      this.pts.frustumCulled = false;
      this.pts.renderOrder = additive ? 8 : 7;
      this.pts.layers.set(RJ.LATE);
      scene.add(this.pts);
    }
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, accel = 0, drag = 0, delay = 0) {
      const k = this.i;
      this.i = (this.i + 1) % this.max;
      if (this.i === 0) this.wrapped = true;
      if (this.dirtyFrom < 0) this.dirtyFrom = k;
      this.dirtyCount++;
      this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
      this.v[k * 3] = vx; this.v[k * 3 + 1] = vy; this.v[k * 3 + 2] = vz;
      this.a[k * 4] = FX.time + delay; this.a[k * 4 + 1] = life; this.a[k * 4 + 2] = s0; this.a[k * 4 + 3] = s1; // delay > 0: born later (the shader hides it until then)
      this.c[k * 4] = r; this.c[k * 4 + 1] = g; this.c[k * 4 + 2] = b; this.c[k * 4 + 3] = alpha;
      this.e[k * 2] = accel; this.e[k * 2 + 1] = drag;
    }
    flush() {
      if (this.dirtyCount === 0) return;
      const full = this.wrapped || this.dirtyCount >= this.max;
      const sizes = [3, 3, 4, 4, 2];
      this.attrs.forEach((at, n) => {
        at.updateRange.offset = full ? 0 : this.dirtyFrom * sizes[n];
        at.updateRange.count = full ? -1 : this.dirtyCount * sizes[n];
        at.needsUpdate = true;
      });
      this.dirtyFrom = -1; this.dirtyCount = 0; this.wrapped = false;
    }
    clear() { for (let k = 0; k < this.max; k++) this.a[k * 4] = -1000; this.attrs[2].updateRange.offset = 0; this.attrs[2].updateRange.count = -1; this.attrs[2].needsUpdate = true; }
  }

  FX.init = function (scene) {
    FX.scene = scene;
    const tex = puffTexture();
    const big = RJ.settings.quality === "low" ? 0.6 : 1;
    FX.smokeP = new Particles(scene, Math.round(26000 * big), false, tex);
    FX.fireP = new Particles(scene, Math.round(8000 * big), true, tex);
    FX.light = new THREE.PointLight(0xffaa55, 0, 700, 2);
    scene.add(FX.light);
    // afterburner glow on the airframe, runway and cloud bases (always present so shaders never recompile)
    FX.abLight = new THREE.PointLight(0xff9a4a, 0, 160, 2);
    scene.add(FX.abLight);
    FX.lightLevel = 0;
  };

  FX.update = function (dt, camera, renderer) {
    FX.time += dt; FX.frame = (FX.frame || 0) + 1;
    const ps = renderer.domElement.height / (2 * Math.tan((camera.fov * RJ.DEG) / 2));
    const W = RJ.world;
    for (const P of [FX.smokeP, FX.fireP]) {
      const U = P.mat.uniforms;
      U.time.value = FX.time;
      U.pixelScale.value = ps;
      if (W.sunDir) {
        U.sunDir.value.copy(W.sunDir);
        U.lightCol.value.copy(W.sun.color).multiplyScalar(Math.min(1.3, (W.sunIntensity || 1) + 0.1));
        U.ambCol.value.copy(W.hemi.color).multiplyScalar(0.75);
      }
      P.flush();
    }
    // wind for drifting smoke (same direction as missile trails and contrails)
    const wx = (W.WEATHER && W.env && W.WEATHER[W.env.weather]) || {};
    FX.wind.set(0.8, 0, 0.6).multiplyScalar((wx.wind || 6) * 0.6);
    tickGround(dt, camera);
    tickDamage(dt, camera);
    if (FX.lightLevel > 0) { FX.lightLevel = Math.max(0, FX.lightLevel - dt * 3); FX.light.intensity = FX.lightLevel * 6; }
    // dusk/night factor shared by every jet exhaust shader (aircraft.js): flames and diamonds burn brighter in the dark
    if (RJ.FLAME_NIGHT && W.sunElev != null) RJ.FLAME_NIGHT.value = 1 - RJ.smooth(-6, 10, W.sunElev);
  };
  FX.clear = () => {
    FX.smokeP.clear(); FX.fireP.clear();
    FIRES.length = 0; for (const m of SCORCHES) m.visible = false;
  };

  const R = (a) => (Math.random() - 0.5) * 2 * a;

  /** Layered blast, s scales it (1 = fighter): a white-hot flash core, a fireball that swells and cools from yellow
   * through orange to dull red, then dark rolling smoke that emerges from the dying fire (born late via `delay`)
   * and keeps billowing upward, plus streaking embers. Near the ground it also throws a dirt fountain, leaves a
   * scorch mark and a fire that burns on for a while (FX.groundBlast). Particle counts are capped for any s. */
  FX.explosion = function (p, s = 1, vel) {
    const vx = vel ? vel.x * 0.35 : 0, vy = vel ? vel.y * 0.35 : 0, vz = vel ? vel.z * 0.35 : 0;
    const low = RJ.settings.quality === "low", k = Math.sqrt(s);
    const n = Math.min(70, Math.round(30 * k * (low ? 0.55 : 1)));
    // 1 flash: a few huge, very short-lived white-hot particles (the eye reads this as the detonation)
    for (let i = 0; i < 4; i++) FX.fireP.spawn(p.x, p.y, p.z, vx, vy, vz, 0.07 + i * 0.035, 9 * s, (30 + i * 8) * s, 1, 0.97, 0.88, 1, 0, 0);
    // 2 fireball: a dense yellow-white core that swells fast, then orange billows that rise and cool
    for (let i = 0; i < n; i++) {
      const sp = 14 * s;
      FX.fireP.spawn(p.x + R(3 * s), p.y + R(3 * s), p.z + R(3 * s), vx + R(sp), vy + R(sp) + 4, vz + R(sp), 0.5 + Math.random() * 0.9, 6 * s, 28 * s, 1, 0.75, 0.4, 0.9, 6, 2.2);
    }
    for (let i = 0; i < n * 0.6; i++) {
      const v = _ev.set(R(1), R(1), R(1)).normalize().multiplyScalar(5 + Math.random() * 10 * s);
      FX.fireP.spawn(p.x + R(2 * s), p.y + R(2 * s), p.z + R(2 * s), vx + v.x, vy + v.y + 2, vz + v.z, 0.25 + Math.random() * 0.3, 4 * s, 18 * s, 1, 0.92, 0.7, 1, 2, 3);
    }
    // 3 smoke: a little at once (the blast cloud's dark edge), most of it born as the fire dies, so the
    // fireball visibly turns into a dark, slowly rolling cloud that rises and drifts with the wind
    const w = FX.wind;
    for (let i = 0; i < n * 0.4; i++) {
      const sp = 10 * s, d = 0.14 + Math.random() * 0.2;
      FX.smokeP.spawn(p.x + R(4 * s), p.y + R(4 * s), p.z + R(4 * s), vx + R(sp), vy + R(sp) + 3, vz + R(sp), 4 + Math.random() * 4, 10 * s, 45 * s, d, d, d * 1.05, 0.6, 3, 0.8);
    }
    for (let i = 0; i < n; i++) {
      const dir = _ev.set(R(1), R(1) * 0.8 + 0.15, R(1)).normalize(), r = (4 + Math.random() * 9) * s, out = (3 + Math.random() * 6) * k;
      const d = 0.05 + Math.random() * 0.13, warm = i < n * 0.35; // the first puffs out of the fire are fire-stained brown
      FX.smokeP.spawn(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r, vx * 0.6 + dir.x * out + w.x, vy * 0.6 + dir.y * out + 4 + Math.random() * 4, vz * 0.6 + dir.z * out + w.z,
        6 + Math.random() * 7, 12 * s, (45 + Math.random() * 40) * s, d * (warm ? 1.5 : 1), d * (warm ? 1.12 : 1), d * 1.02, 0.6 + Math.random() * 0.25, 1.2, 0.5, 0.2 + Math.random() * 0.65);
    }
    // 4 embers: streaking sparks and burning bits arcing out and falling
    for (let i = 0; i < Math.min(110, n * 1.5); i++) {
      const sp = 70 * s;
      FX.fireP.spawn(p.x, p.y, p.z, vx + R(sp), vy + R(sp) + 10, vz + R(sp), 0.6 + Math.random() * 1.0, 1.2, 0.6, 1, 0.8, 0.5, 1, -25, 0.6);
    }
    FX.light.position.copy(p); FX.light.color.setHex(0xffaa55); FX.lightLevel = Math.max(FX.lightLevel, Math.min(2, s));
    if (s >= 1.2) FX.smokeColumn(p, s);
    const W = RJ.world, g = W && W.ground ? W.ground(p.x, p.z) : NaN;
    if (isFinite(g) && p.y - g < 10 + 8 * s) FX.groundBlast(_ep.set(p.x, g, p.z), s, p.y - g);
  };
  const _ev = new THREE.Vector3(), _ep = new THREE.Vector3();

  /* ---------------- ground impacts: dirt fountain, scorch mark, a fire that burns on ----------------
   * Pooled: at most SCORCH_N scorch decals and FIRE_N ground fires exist; the oldest is reused. */
  const SCORCH_N = 14, FIRE_N = 6, SCORCHES = [], FIRES = [];
  let scorchTex = null, scorchGeo = null;
  function scorchTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), rnd = RJ.world.gen.mulberry32(17);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(8,6,5,0.95)"); g.addColorStop(0.45, "rgba(14,11,9,0.8)"); g.addColorStop(0.8, "rgba(30,24,18,0.3)"); g.addColorStop(1, "rgba(40,32,24,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    // ragged blast rays and soot blotches so it never reads as a perfect disc
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, L = 34 + rnd() * 30, wd = 3 + rnd() * 6;
      x.save(); x.translate(64, 64); x.rotate(a);
      const lg = x.createLinearGradient(0, 0, L, 0); lg.addColorStop(0, "rgba(10,8,6,0.55)"); lg.addColorStop(1, "rgba(10,8,6,0)");
      x.fillStyle = lg; x.beginPath(); x.moveTo(0, -wd); x.lineTo(L, 0); x.lineTo(0, wd); x.fill(); x.restore();
    }
    return new THREE.CanvasTexture(c);
  }
  /** Dirt and debris thrown up by a blast at or near ground level (p on the ground, h = blast height above it). */
  FX.groundBlast = function (p, s = 1, h = 0) {
    const W = RJ.world, low = RJ.settings.quality === "low", k = Math.sqrt(s), near = 1 - RJ.clamp(h / (10 + 8 * s), 0, 1);
    const water = p.y < 1 && W.isWaterAt && W.isWaterAt(p.x, p.z);
    if (water) { // a column of white water and spray instead of dirt
      const nw = Math.min(70, Math.round(36 * k * (low ? 0.5 : 1) * (0.4 + near)));
      for (let i = 0; i < nw; i++) FX.smokeP.spawn(p.x + R(4 * s), 1, p.z + R(4 * s), R(7 * k), (25 + Math.random() * 45) * k, R(7 * k), 1.6 + Math.random() * 1.4, 3 * s, 16 * s, 0.93, 0.96, 1, 0.8, -18, 0.35);
      return;
    }
    const nd = Math.min(80, Math.round(40 * k * (low ? 0.5 : 1) * (0.4 + near)));
    // 1 the fountain: a cone of dark earth flung up that arcs back down under gravity
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2, sp = (6 + Math.random() * 18) * k, up = (22 + Math.random() * 45) * k;
      const d = 0.16 + Math.random() * 0.14;
      FX.smokeP.spawn(p.x + R(3 * s), p.y + 1, p.z + R(3 * s), Math.cos(a) * sp, up, Math.sin(a) * sp, 2.2 + Math.random() * 2, 2.5 * s, (10 + Math.random() * 10) * s, d * 1.25, d * 1.05, d * 0.8, 0.85, -16, 0.35);
    }
    // 2 clods: small, solid, fast, falling hard
    for (let i = 0; i < nd * 0.8; i++) {
      const a = Math.random() * Math.PI * 2, sp = (10 + Math.random() * 30) * k;
      FX.smokeP.spawn(p.x, p.y + 1, p.z, Math.cos(a) * sp, (25 + Math.random() * 50) * k, Math.sin(a) * sp, 1.6 + Math.random() * 1.6, 0.9 * k, 0.7 * k, 0.09, 0.075, 0.06, 1, -30, 0.15);
    }
    // 3 the base surge: a low ring of dust rolling outward
    const nr = Math.min(50, Math.round(26 * k * (low ? 0.5 : 1)));
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * Math.PI * 2 + R(0.2), sp = (14 + Math.random() * 18) * k;
      FX.smokeP.spawn(p.x + Math.cos(a) * 3 * s, p.y + 1.5, p.z + Math.sin(a) * 3 * s, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 3.5 + Math.random() * 3, 5 * s, 26 * s, 0.5, 0.44, 0.36, 0.55, 0.4, 0.7);
    }
    if (near > 0.3) { FX.scorch(p, (5 + 6 * k) * (0.6 + 0.4 * near)); if (s >= 0.9) FX.groundFire(p, s); }
  };
  /** A blackened blast mark on the ground that fades away after a minute. */
  FX.scorch = function (p, r) {
    if (!FX.scene) return;
    if (!scorchTex) { scorchTex = scorchTexture(); scorchGeo = new THREE.CircleGeometry(1, 20); scorchGeo.rotateX(-Math.PI / 2); }
    let m;
    if (SCORCHES.length < SCORCH_N) {
      m = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      m.renderOrder = 2; FX.scene.add(m); SCORCHES.push(m);
    } else { m = SCORCHES.shift(); SCORCHES.push(m); }
    // sit on the terrain under the centre; lift a little on slopes so the disc doesn't vanish into the hillside
    const W = RJ.world, g0 = W.ground(p.x, p.z), gx = W.ground(p.x + r * 0.7, p.z), gz = W.ground(p.x, p.z + r * 0.7);
    const slope = Math.min(6, Math.max(Math.abs(gx - g0), Math.abs(gz - g0)));
    m.position.set(p.x, g0 + 0.25 + slope * 0.6, p.z); m.rotation.y = Math.random() * 6.3;
    m.scale.set(r * (0.9 + Math.random() * 0.25), 1, r * (0.9 + Math.random() * 0.25));
    m.material.opacity = 0.92; m.visible = true; m.userData.t = 0;
  };
  /** Wreckage and fuel burning on the ground: licking flames and a thick black smoke plume that leans downwind. */
  FX.groundFire = function (p, s = 1) {
    const f = FIRES.length < FIRE_N ? {} : FIRES.shift();
    f.x = p.x; f.y = p.y; f.z = p.z; f.s = Math.min(3, s); f.t = 0; f.life = 14 + Math.random() * 10 + Math.min(3, s) * 4; f.e = 0; f.e2 = 0;
    FIRES.push(f);
  };
  function tickGround(dt, cam) {
    for (const m of SCORCHES) {
      if (!m.visible) continue;
      const t = (m.userData.t += dt);
      if (t > 50) { m.material.opacity = 0.92 * Math.max(0, 1 - (t - 50) / 25); if (t > 75) m.visible = false; }
    }
    const low = RJ.settings.quality === "low", w = FX.wind;
    for (let i = FIRES.length - 1; i >= 0; i--) {
      const f = FIRES[i]; f.t += dt;
      if (f.t > f.life) { FIRES.splice(i, 1); continue; }
      const dist = cam ? Math.hypot(cam.position.x - f.x, cam.position.y - f.y, cam.position.z - f.z) : 0;
      if (dist > 12000) continue;
      const k = 1 - RJ.smooth(f.life * 0.55, f.life, f.t), s = f.s; // dies down over the last half of its life
      f.e += dt * (low ? 14 : 28) * k; f.e2 += dt * (low ? 3 : 6) * (0.4 + 0.6 * k);
      while (f.e >= 1) { // flames licking up from the wreckage
        f.e -= 1;
        FX.fireP.spawn(f.x + R(4 * s), f.y + 0.5 + Math.random() * 1.5, f.z + R(4 * s), w.x * 0.3 + R(1.5), 5 + Math.random() * 6, w.z * 0.3 + R(1.5), 0.5 + Math.random() * 0.5, (2 + Math.random() * 2.5) * s, (5 + Math.random() * 4) * s, 1, 0.55, 0.2, 0.85 * k, 3, 1.2);
      }
      while (f.e2 >= 1) { // the plume: oily black, rising, spreading and leaning with the wind
        f.e2 -= 1;
        const d = 0.06 + Math.random() * 0.07;
        FX.smokeP.spawn(f.x + R(3 * s), f.y + 3 + Math.random() * 3, f.z + R(3 * s), w.x * 0.8 + R(1.5), 9 + Math.random() * 7, w.z * 0.8 + R(1.5), 9 + Math.random() * 6, 5 * s, (30 + Math.random() * 25) * s, d, d * 0.96, d * 0.92, 0.55 * (0.5 + 0.5 * k), 0.3, 0.12);
      }
      // the fire flickers on the ground and anything nearby, when nothing brighter owns the light
      if (dist < 1800 && FX.lightLevel < 0.4 * k) { FX.light.position.set(f.x, f.y + 6, f.z); FX.light.color.setHex(0xff8a3a); FX.lightLevel = (0.25 + Math.random() * 0.15) * k; }
    }
  }

  /* ---------------- battle damage on live jets, and the burning fall of a dead one ----------------
   * Every hit leaves a wound on the airframe (a point in the mesh's own space). A damaged jet vents fuel vapour
   * from it, then grey smoke, then black smoke and fire, with sparks spitting out as it gets worse. A wreck
   * leaves a continuous tail of fire and thick black smoke. Emission is interpolated along the path flown so the
   * trails are unbroken at 300 m/s, and bounded per jet per frame. */
  const _dw = new THREE.Vector3(), _dl = new THREE.Vector3();
  RJ.on("damage", (e) => {
    const ac = e.ac;
    if (!ac || !ac.alive || !ac.mesh) return;
    const pts = ac._wounds || (ac._wounds = []);
    if (pts.length >= 3) return;
    const vis = ac.vis, tip = vis && vis.tips && vis.tips[0], noz = vis && vis.nozzles && vis.nozzles[0];
    const span = tip ? Math.abs(tip.x) : (ac.radius || 6) * 0.45, tail = noz ? noz.z : (ac.radius || 6) * 0.4;
    // first wound in a wing root / fuel tank (vapour), later ones anywhere on the airframe
    const side = Math.random() < 0.5 ? -1 : 1, wing = pts.length === 0 || Math.random() < 0.5;
    const lp = wing ? new THREE.Vector3(side * span * (0.25 + Math.random() * 0.4), (tip ? tip.y : 0) + 0.1, (tip ? tip.z : 0) + R(0.6))
      : new THREE.Vector3(R(span * 0.15), R(0.3) + 0.3, tail * (Math.random() * 0.9 - 0.3));
    pts.push({ p: lp, wing, prev: null });
  });
  function tickDamage(dt, cam) {
    const A = RJ.combat && RJ.combat.aircraft;
    if (!A || !cam || dt <= 0) return;
    const low = RJ.settings.quality === "low";
    let budget = low ? 6 : 12; // jets per frame that get the full treatment
    for (const ac of A) {
      if (!ac.mesh || ac.lodFar || ac.mesh.visible === false) continue;
      const falling = ac.state === "falling";
      if (!falling && (!ac.alive || !ac._wounds || !(ac.hp >= 0))) continue;
      const dist = cam.position.distanceTo(ac.pos);
      if (dist > (falling ? 9000 : 5000) || budget <= 0) { if (ac._wounds) for (const w of ac._wounds) w.prev = null; ac._wreckPrev = null; continue; }
      budget--;
      if (falling) { tickWreck(ac, dt, dist, low); continue; }
      const dmg = RJ.clamp(1 - ac.hp / (ac.maxHp || 100), 0, 1);
      if (dmg < 0.04) continue;
      const v = ac.vel, far = dist > 2000;
      for (const wd of ac._wounds) {
        const wp = ac.mesh.localToWorld(_dw.copy(wd.p));
        const pp = wd.prev, seg = pp ? pp.distanceTo(wp) : 0;
        const spacing = far ? 9 : 3.5 + (1 - dmg) * 3;
        const n = pp && seg < 120 ? Math.min(far || low ? 3 : 8, Math.max(1, Math.floor(seg / spacing))) : 1;
        for (let j = 1; j <= n; j++) {
          const p = pp && n > 1 ? _dl.copy(pp).lerp(wp, j / n) : wp;
          if (dmg < 0.35 && wd.wing) {
            // leaking fuel: a thin white vapour stream that spreads and evaporates behind the wing
            FX.smokeP.spawn(p.x + R(0.2), p.y + R(0.2), p.z + R(0.2), v.x * 0.04 + R(0.6), v.y * 0.04 + R(0.6), v.z * 0.04 + R(0.6), 0.9 + dmg * 2, 0.5, 3.5 + dmg * 6, 0.96, 0.97, 1, 0.22 + dmg * 0.4, 0, 1.2);
          } else {
            // smoke from the wound: grey when lightly hit, oily black and thicker as the jet is shot up
            const d = RJ.lerp(0.55, 0.08, RJ.clamp((dmg - 0.3) / 0.5, 0, 1));
            FX.smokeP.spawn(p.x + R(0.4), p.y + R(0.4), p.z + R(0.4), v.x * 0.05 + R(1), v.y * 0.05 + R(1) + 1, v.z * 0.05 + R(1), 2.2 + dmg * 3, 1 + dmg, 5 + dmg * 12, d, d, d * 1.04, 0.35 + dmg * 0.35, 0.6, 0.6);
          }
        }
        wd.prev = wd.prev ? wd.prev.copy(wp) : wp.clone();
        // fire licking from the wound once it's badly hit, streaming back like a torch
        if (dmg > 0.6 && Math.random() < dt * (far ? 15 : 45) * dmg) {
          FX.fireP.spawn(wp.x, wp.y, wp.z, v.x * 0.88 + R(3), v.y * 0.88 + R(3), v.z * 0.88 + R(3), 0.15 + Math.random() * 0.2, 1.2 + dmg * 1.4, 3 + dmg * 3, 1, 0.55, 0.2, 0.9, 0, 2);
        }
        // sparks and arcing from torn wiring and metal, more often the worse it gets
        if (!far && Math.random() < dt * (0.6 + dmg * 5)) {
          const ns = 3 + Math.floor(Math.random() * 5);
          for (let i = 0; i < ns; i++) FX.fireP.spawn(wp.x, wp.y, wp.z, v.x * 0.9 + R(18), v.y * 0.9 + R(18), v.z * 0.9 + R(18), 0.2 + Math.random() * 0.3, 0.6, 0.2, 1, 0.85, 0.55, 1, -10, 1.5);
        }
      }
    }
  }
  function tickWreck(ac, dt, dist, low) {
    // a continuous tail of fire and black smoke behind the tumbling wreck (flight.js adds the big flames at the core)
    const p = ac.pos, v = ac.vel, r = ac.radius || 8, pp = ac._wreckPrev, seg = pp ? pp.distanceTo(p) : 0;
    const far = dist > 3000, burn = 1 - RJ.smooth(5, 11, ac.fallT || 0);
    const n = pp && seg < 150 ? Math.min(far || low ? 3 : 7, Math.max(1, Math.floor(seg / 5))) : 1;
    for (let j = 1; j <= n; j++) {
      const q = pp && n > 1 ? _dl.copy(pp).lerp(p, j / n) : p;
      if (burn > 0.05) FX.fireP.spawn(q.x + R(1), q.y + R(1), q.z + R(1), v.x * 0.1 + R(2), v.y * 0.1 + R(2) + 2, v.z * 0.1 + R(2), 0.35 + Math.random() * 0.35, (2.5 + r * 0.15) * burn, (6 + r * 0.3) * burn, 1, 0.5, 0.15, 0.8, 2, 1);
      const d = 0.05 + Math.random() * 0.06;
      if (j % 2 === 0 || n === 1) FX.smokeP.spawn(q.x + R(1.5), q.y + R(1.5), q.z + R(1.5), FX.wind.x * 0.5 + R(1.5), 1.5 + R(1.5), FX.wind.z * 0.5 + R(1.5), 7 + Math.random() * 5, 3 + r * 0.2, (16 + r) * (0.8 + Math.random() * 0.5), d, d, d * 1.02, 0.6, 0.3, 0.25);
    }
    ac._wreckPrev = ac._wreckPrev ? ac._wreckPrev.copy(p) : p.clone();
    // bits keep tearing off: bursts of sparks and burning fragments
    if (!far && Math.random() < dt * 2.5) for (let i = 0; i < 6; i++) FX.fireP.spawn(p.x, p.y, p.z, v.x * 0.8 + R(30), v.y * 0.8 + R(30) + 5, v.z * 0.8 + R(30), 0.5 + Math.random() * 0.8, 1.1, 0.35, 1, 0.75, 0.4, 1, -20, 0.5);
  }

  /** A slow, dark column of smoke that keeps rising from a big blast (crash sites, kills) long after the fire. */
  FX.smokeColumn = function (p, s = 1) {
    const n = Math.round((RJ.settings.quality === "low" ? 5 : 11) * Math.min(1.6, Math.sqrt(s)));
    for (let i = 0; i < n; i++) {
      const d = 0.08 + Math.random() * 0.1, up = 3 + (i / n) * 14 + Math.random() * 3;
      FX.smokeP.spawn(p.x + R(5 * s), p.y + R(3 * s), p.z + R(5 * s), R(2.5), up, R(2.5), 9 + Math.random() * 8, 9 * s, (55 + Math.random() * 35) * s, d * 1.05, d, d * 0.95, 0.5, 0.4, 0.12);
    }
  };
  FX.debris = function (p, vel, s = 1) {
    for (let i = 0; i < 18 * s; i++) {
      const sp = 40 * s;
      FX.smokeP.spawn(p.x, p.y, p.z, vel.x * 0.5 + R(sp), vel.y * 0.5 + R(sp) + 10, vel.z * 0.5 + R(sp), 2 + Math.random() * 2, 1.5, 3, 0.12, 0.11, 0.1, 1, -30, 0.3);
    }
    // burning fragments arcing down: bright embers that cool from yellow to red as they fall
    const ne = Math.round((RJ.settings.quality === "low" ? 8 : 20) * s);
    for (let i = 0; i < ne; i++) {
      const sp = 50 * s;
      FX.fireP.spawn(p.x, p.y, p.z, vel.x * 0.45 + R(sp), vel.y * 0.45 + R(sp) + 14, vel.z * 0.45 + R(sp), 1.4 + Math.random() * 1.6, 1.6, 0.5, 1, 0.75, 0.4, 1, -22, 0.35);
    }
  };
  FX.smoke = (p, v, size, dark, life = 3, alpha = 0.55) =>
    FX.smokeP.spawn(p.x + R(0.5), p.y + R(0.5), p.z + R(0.5), v.x + R(2), v.y + R(2) + 2, v.z + R(2), life, size, size * 4, dark, dark, dark * 1.04, alpha, 1.5, 0.6);
  FX.fire = (p, v, size) => FX.fireP.spawn(p.x, p.y, p.z, v.x + R(3), v.y + R(3), v.z + R(3), 0.35 + Math.random() * 0.3, size, size * 2.2, 1, 0.6, 0.25, 0.9, 4, 1.5);
  FX.contrail = (p, v, size, alpha = 0.5, life = 22) => FX.smokeP.spawn(p.x, p.y, p.z, v.x * 0.02, v.y * 0.02, v.z * 0.02, life, size, size * 9, 0.97, 0.98, 1.0, alpha, 0, 0);
  FX.vapor = (p, v, size, alpha = 0.35) => FX.smokeP.spawn(p.x, p.y, p.z, v.x * 0.1 + R(1), v.y * 0.1 + R(1), v.z * 0.1 + R(1), 0.45 + Math.random() * 0.4, size, size * 2.5, 1, 1, 1, alpha, 0, 1);
  /** High-G condensation for any aircraft (player or AI): continuous wingtip vortex trails (interpolated between
   * emits so they read as unbroken lines at 300 m/s) plus sunlit vapor sheets flowing off the upper wing in hard
   * pulls. Called from Aircraft.updateVisual's trail block (~33 Hz). Bounded: <= ~20 particles per call. */
  const _wv = new THREE.Vector3(), _wp = new THREE.Vector3();
  FX.wingVapor = function (ac) {
    const vis = ac.vis, F = ac.spec.flight, m = ac.mesh, tips = vis && vis.tips;
    if (!tips || !tips.length || !m) return;
    const g = Math.abs(ac.g), gT = F.gmax > 5 ? 4.5 : 1.8, alt = ac.pos.y;
    const cam = RJ.camera, dist = cam ? cam.position.distanceTo(ac.pos) : 0;
    if (g <= gT || ac.speed <= 110 || alt >= 12500 || dist > 7000 || ac.state !== "flying") { ac._vtp = null; return; }
    const low = RJ.settings.quality === "low";
    const hum = RJ.sonic ? RJ.sonic.humidity(ac) : 0.5;
    const altK = 1 - RJ.smooth(5000, 12500, alt) * 0.65;
    const k = RJ.clamp((g - gT) / 4, 0, 1);
    const a = Math.min(0.8, (0.18 + k * 0.62) * (0.45 + hum * 0.75) * altK);
    if (a < 0.02) { ac._vtp = null; return; }
    const v = ac.vel, far = dist > 2500;
    // 1 wingtip vortices: thin, dense cores that swell as they trail
    const prev = ac._vtp || (ac._vtp = []);
    const had = prev.length === tips.length;
    for (let i = 0; i < tips.length; i++) {
      const wp = m.localToWorld(_wp.copy(tips[i]));
      const pp = had ? prev[i] : null;
      const seg = pp ? pp.distanceTo(wp) : 0;
      const n = pp && seg < 60 ? Math.min(low || far ? 2 : 6, Math.max(1, Math.ceil(seg / 4))) : 1;
      for (let j = 1; j <= n; j++) {
        const p = pp && n > 1 ? _wv.copy(pp).lerp(wp, j / n) : wp;
        FX.smokeP.spawn(p.x + R(0.12), p.y + R(0.12), p.z + R(0.12), v.x * 0.03 + R(0.6), v.y * 0.03 + R(0.6), v.z * 0.03 + R(0.6),
          (0.6 + Math.random() * 0.5) * (0.7 + k * 0.8), 0.35 + k * 0.3 + (far ? 1.2 : 0), 1.4 + k * 1.8 + (far ? 3 : 0), 1, 1, 1, a * (far ? 0.7 : 1), 0, 1.4);
      }
      if (!prev[i]) prev[i] = new THREE.Vector3();
      prev[i].copy(wp);
    }
    prev.length = tips.length;
    // 2 vapor sheets: condensation flashing over the upper wing and streaming off the trailing edge
    if (g > gT + 1.2 && F.gmax > 5 && !far) {
      const tp = tips[0], span = Math.abs(tp.x) || 4;
      const sheets = Math.round((low ? 2 : 6) * (0.4 + k * 0.6) * (0.5 + hum * 0.6));
      const sk = RJ.clamp((g - gT - 1.2) / 3, 0.25, 1);
      for (let s = 0; s < sheets; s++) {
        const x = RJ.rand(-0.88, 0.88) * span, lp = _wp.set(x, 0.35 + Math.random() * 0.45 + Math.abs(x) * 0.03, tp.z - 3.2 + RJ.rand(-1.6, 2.2));
        const p = m.localToWorld(lp);
        const keep = 0.8 + Math.random() * 0.12; // rides with the wing, then peels away aft
        FX.smokeP.spawn(p.x, p.y, p.z, v.x * keep + R(1.5), v.y * keep + R(1.5), v.z * keep + R(1.5), 0.18 + Math.random() * 0.22,
          1.4 + Math.random() * 1.2, 3.2 + Math.random() * 2.2, 0.98, 0.99, 1, a * 0.5 * sk, 0, 0);
      }
    }
  };
  FX.spark = (p, v) => FX.fireP.spawn(p.x, p.y, p.z, v.x + R(30), v.y + R(30), v.z + R(30), 0.25 + Math.random() * 0.25, 0.8, 0.3, 1, 0.85, 0.5, 1, -10, 1);
  FX.muzzle = (p, v, size) => FX.fireP.spawn(p.x, p.y, p.z, v.x, v.y, v.z, 0.05, size, size * 1.6, 1, 0.85, 0.5, 0.9, 0, 0);
  FX.flareGlow = (p, v) => {
    FX.fireP.spawn(p.x, p.y, p.z, v.x, v.y, v.z, 0.12, 9, 6, 1.2, 1.1, 0.85, 1, 0, 0);
    FX.smokeP.spawn(p.x, p.y, p.z, v.x * 0.1, v.y * 0.1, v.z * 0.1, 2.5, 2, 9, 0.92, 0.92, 0.94, 0.45, 2, 0.3);
  };
  FX.splash = (p, s = 1) => {
    for (let i = 0; i < 40 * s; i++) FX.smokeP.spawn(p.x + R(6 * s), 1, p.z + R(6 * s), R(8 * s), 20 * s + Math.random() * 30 * s, R(8 * s), 1.5 + Math.random(), 5 * s, 18 * s, 0.95, 0.97, 1, 0.75, -20, 0.4);
  };
  FX.dust = (p, s = 1) => {
    for (let i = 0; i < 30 * s; i++) FX.smokeP.spawn(p.x + R(8 * s), p.y + 2, p.z + R(8 * s), R(15 * s), 8 + Math.random() * 15 * s, R(15 * s), 3 + Math.random() * 3, 8 * s, 40 * s, 0.55, 0.48, 0.4, 0.7, 1, 0.6);
  };
  FX.mist = (p, width) => {
    for (let i = 0; i < 2; i++) FX.smokeP.spawn(p.x + R(width * 0.5), p.y + Math.random() * 4, p.z + R(width * 0.5), R(3), 3 + Math.random() * 4, R(3), 3 + Math.random() * 2, 6, 26, 0.95, 0.97, 1, 0.22, 0.5, 0.4);
  };
  /** Streaks of cloud rushing past the camera when flying through or along cloud. */
  FX.cloudStreak = (camPos, fwd, vel, amount) => {
    const n = Math.round(1 + amount * 3);
    for (let i = 0; i < n; i++) {
      const d = 60 + Math.random() * 220;
      const x = camPos.x + fwd.x * d + R(70), y = camPos.y + fwd.y * d + R(45), z = camPos.z + fwd.z * d + R(70);
      FX.smokeP.spawn(x, y, z, -vel.x * 0.02, -vel.y * 0.02, -vel.z * 0.02, 1.2 + Math.random(), 18, 45, 0.97, 0.98, 1, 0.16 * amount, 0, 0);
    }
  };

  /** Thin moisture streaks whipping past the camera at very high speed down low. */
  FX.speedStreak = (camPos, fwd, vel, amount) => {
    const n = Math.round(1 + amount * 2);
    for (let i = 0; i < n; i++) {
      const d = 30 + Math.random() * 140;
      const x = camPos.x + fwd.x * d + R(55), y = camPos.y + fwd.y * d + R(35), z = camPos.z + fwd.z * d + R(55);
      FX.smokeP.spawn(x, y, z, -vel.x * 0.05, -vel.y * 0.05, -vel.z * 0.05, 0.5 + Math.random() * 0.4, 6, 14, 0.97, 0.98, 1, 0.09 * amount, 0, 0);
    }
  };

  /** The sonic boom's vapor: a dense sunlit shell around the airframe plus slow wisps that linger. */
  FX.boomBurst = (c, fwd, up, right, vel, R0, L0, vis, sunDir) => {
    const n = Math.round(70 * Math.min(1.6, vis + 0.2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = right.x * ca + up.x * sa, ry = right.y * ca + up.y * sa, rz = right.z * ca + up.z * sa;
      // droplets condense on the cone surface (wider aft, heavier over the top) and are left behind in the air
      const along = (Math.random() - 0.3) * L0 * 0.8, r = R0 * (0.55 + 0.45 * RJ.clamp(0.5 - along / L0, 0, 1)) * (0.9 + Math.random() * 0.2) * (sa > 0 ? 1 : 0.85);
      const px = c.x + rx * r - fwd.x * along, py = c.y + ry * r - fwd.y * along, pz = c.z + rz * r - fwd.z * along;
      const out = 0.4 + Math.random() * 1.2;
      const lit = 0.78 + 0.22 * Math.max(0, rx * sunDir.x + ry * sunDir.y + rz * sunDir.z);
      FX.smokeP.spawn(px, py, pz, rx * out * 1.4 + vel.x * 0.05, ry * out * 1.4 + vel.y * 0.05, rz * out * 1.4 + vel.z * 0.05, 0.35 + Math.random() * 0.5, 1.2 + R0 * 0.15, 4 + R0 * 0.5, lit, lit, lit * 1.02, 0.34 * vis, 0, 2.2);
    }
    for (let i = 0; i < Math.round(40 * vis); i++) {
      const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const rx = right.x * ca + up.x * sa, ry = right.y * ca + up.y * sa, rz = right.z * ca + up.z * sa;
      const r = R0 * (0.8 + Math.random() * 1.6);
      const along = (Math.random() - 0.2) * L0 * 2.5;
      FX.smokeP.spawn(c.x + rx * r - fwd.x * along, c.y + ry * r - fwd.y * along, c.z + rz * r - fwd.z * along,
        rx * 6 + vel.x * 0.03, ry * 6 + vel.y * 0.03 + 1, rz * 6 + vel.z * 0.03, 1.2 + Math.random() * 1.2, 4, 10 + R0 * 0.8, 0.95, 0.96, 1, 0.12 * vis, 0.2, 0.5);
    }
  };
  FX.sprayRing = (p, k, vel) => {
    const n = Math.round(160 * k + 40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 25 + Math.random() * 45;
      FX.smokeP.spawn(p.x + Math.cos(a) * 6, p.y, p.z + Math.sin(a) * 6, Math.cos(a) * sp + vel.x * 0.1, 6 + Math.random() * 16 * k, Math.sin(a) * sp + vel.z * 0.1, 1.6 + Math.random() * 1.4, 4, 20, 0.94, 0.97, 1, 0.6 * k + 0.15, -9, 0.7);
    }
  };
  FX.dustRing = (p, k, vel) => {
    const n = Math.round(110 * k + 30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 18 + Math.random() * 30;
      FX.smokeP.spawn(p.x + Math.cos(a) * 6, p.y, p.z + Math.sin(a) * 6, Math.cos(a) * sp + vel.x * 0.08, 3 + Math.random() * 8 * k, Math.sin(a) * sp + vel.z * 0.08, 2.5 + Math.random() * 2, 6, 30, 0.62, 0.55, 0.46, 0.5 * k + 0.1, 0.5, 0.6);
    }
  };
})(window.RJ);
