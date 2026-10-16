/* Ridgeline Jets — GPU particle effects: explosions, smoke, contrails, vapor, sparks, flares, sonic boom
 * vapor, sea spray, dust, waterfall mist and cloud streaks. Smoke-type particles are lit by the sun with
 * forward scattering (bright when backlit), so vapor glows at sunset. */
(function (RJ) {
  "use strict";
  const FX = { time: 0 };
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
          "varying float vAlpha; varying vec3 vCol; varying float vT; varying float vDepth; varying float vFwd;",
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
          "  vCol = tint.rgb; vT = t; vDepth = -mv.z;",
          "  vFwd = pow(max(dot(normalize(p - cameraPosition), normalize(sunDir)), 0.0), 8.0);",
          "}"
        ].join("\n"),
        fragmentShader: [
          "uniform sampler2D map; uniform float additive; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;",
          "uniform vec3 lightCol; uniform vec3 ambCol;",
          "varying float vAlpha; varying vec3 vCol; varying float vT; varying float vDepth; varying float vFwd;",
          "void main(){",
          "  float a; vec3 col = vCol;",
          "  if (additive > 0.5) { float r = length(gl_PointCoord - 0.5); a = 1.0 - smoothstep(0.05, 0.5, r); col *= mix(vec3(1.6, 1.4, 1.1), vec3(1.0, 0.45, 0.18), vT); }",
          "  else {",
          "    a = texture2D(map, gl_PointCoord).a * 1.6;",
          "    float lum = max(max(col.r, col.g), col.b);",
          "    col = col * mix(ambCol, lightCol, 0.7) + lightCol * vFwd * 0.9 * lum;",
          "  }",
          "  a *= vAlpha; if (a < 0.004) discard;",
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
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, accel = 0, drag = 0) {
      const k = this.i;
      this.i = (this.i + 1) % this.max;
      if (this.i === 0) this.wrapped = true;
      if (this.dirtyFrom < 0) this.dirtyFrom = k;
      this.dirtyCount++;
      this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
      this.v[k * 3] = vx; this.v[k * 3 + 1] = vy; this.v[k * 3 + 2] = vz;
      this.a[k * 4] = FX.time; this.a[k * 4 + 1] = life; this.a[k * 4 + 2] = s0; this.a[k * 4 + 3] = s1;
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
    FX.smokeP = new Particles(scene, Math.round(16000 * big), false, tex);
    FX.fireP = new Particles(scene, Math.round(8000 * big), true, tex);
    FX.light = new THREE.PointLight(0xffaa55, 0, 700, 2);
    scene.add(FX.light);
    // afterburner glow on the airframe, runway and cloud bases (always present so shaders never recompile)
    FX.abLight = new THREE.PointLight(0xff9a4a, 0, 160, 2);
    scene.add(FX.abLight);
    FX.lightLevel = 0;
  };

  FX.update = function (dt, camera, renderer) {
    FX.time += dt;
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
    if (FX.lightLevel > 0) { FX.lightLevel = Math.max(0, FX.lightLevel - dt * 3); FX.light.intensity = FX.lightLevel * 6; }
  };
  FX.clear = () => { FX.smokeP.clear(); FX.fireP.clear(); };

  const R = (a) => (Math.random() - 0.5) * 2 * a;

  /** Fireball + smoke + sparks. s scales the blast (1 = fighter). */
  FX.explosion = function (p, s = 1, vel) {
    const vx = vel ? vel.x * 0.35 : 0, vy = vel ? vel.y * 0.35 : 0, vz = vel ? vel.z * 0.35 : 0;
    const n = Math.round(30 * Math.sqrt(s));
    for (let i = 0; i < n; i++) {
      const sp = 14 * s;
      FX.fireP.spawn(p.x + R(3 * s), p.y + R(3 * s), p.z + R(3 * s), vx + R(sp), vy + R(sp) + 4, vz + R(sp), 0.6 + Math.random() * 0.9, 6 * s, 28 * s, 1, 0.75, 0.4, 0.9, 6, 2.2);
    }
    for (let i = 0; i < n; i++) {
      const sp = 10 * s, d = 0.16 + Math.random() * 0.22;
      FX.smokeP.spawn(p.x + R(4 * s), p.y + R(4 * s), p.z + R(4 * s), vx + R(sp), vy + R(sp) + 3, vz + R(sp), 4 + Math.random() * 5, 10 * s, 50 * s, d, d, d * 1.05, 0.8, 3, 0.8);
    }
    for (let i = 0; i < n * 1.5; i++) {
      const sp = 70 * s;
      FX.fireP.spawn(p.x, p.y, p.z, vx + R(sp), vy + R(sp) + 10, vz + R(sp), 0.6 + Math.random() * 1.0, 1.2, 0.6, 1, 0.8, 0.5, 1, -25, 0.6);
    }
    FX.light.position.copy(p); FX.light.color.setHex(0xffaa55); FX.lightLevel = Math.max(FX.lightLevel, Math.min(2, s));
  };
  FX.debris = function (p, vel, s = 1) {
    for (let i = 0; i < 18 * s; i++) {
      const sp = 40 * s;
      FX.smokeP.spawn(p.x, p.y, p.z, vel.x * 0.5 + R(sp), vel.y * 0.5 + R(sp) + 10, vel.z * 0.5 + R(sp), 2 + Math.random() * 2, 1.5, 3, 0.12, 0.11, 0.1, 1, -30, 0.3);
    }
  };
  FX.smoke = (p, v, size, dark, life = 3, alpha = 0.55) =>
    FX.smokeP.spawn(p.x + R(0.5), p.y + R(0.5), p.z + R(0.5), v.x + R(2), v.y + R(2) + 2, v.z + R(2), life, size, size * 4, dark, dark, dark * 1.04, alpha, 1.5, 0.6);
  FX.fire = (p, v, size) => FX.fireP.spawn(p.x, p.y, p.z, v.x + R(3), v.y + R(3), v.z + R(3), 0.35 + Math.random() * 0.3, size, size * 2.2, 1, 0.6, 0.25, 0.9, 4, 1.5);
  FX.contrail = (p, v, size, alpha = 0.5) => FX.smokeP.spawn(p.x, p.y, p.z, v.x * 0.02, v.y * 0.02, v.z * 0.02, 22, size, size * 9, 0.97, 0.98, 1.0, alpha, 0, 0);
  FX.vapor = (p, v, size, alpha = 0.35) => FX.smokeP.spawn(p.x, p.y, p.z, v.x * 0.1 + R(1), v.y * 0.1 + R(1), v.z * 0.1 + R(1), 0.45 + Math.random() * 0.4, size, size * 2.5, 1, 1, 1, alpha, 0, 1);
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
    const n = Math.round(130 * Math.min(1.6, vis + 0.3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = right.x * ca + up.x * sa, ry = right.y * ca + up.y * sa, rz = right.z * ca + up.z * sa;
      // a thin collar of vapor that blasts outward as a ring, not a filled ball
      const r = R0 * (0.85 + Math.random() * 0.4);
      const along = (Math.random() - 0.5) * L0 * 0.55;
      const px = c.x + rx * r - fwd.x * along, py = c.y + ry * r - fwd.y * along, pz = c.z + rz * r - fwd.z * along;
      const out = 16 + Math.random() * 38;
      const lit = 0.78 + 0.22 * Math.max(0, rx * sunDir.x + ry * sunDir.y + rz * sunDir.z);
      FX.smokeP.spawn(px, py, pz, rx * out * 1.4 + vel.x * 0.05, ry * out * 1.4 + vel.y * 0.05, rz * out * 1.4 + vel.z * 0.05, 0.6 + Math.random() * 0.7, 1.8 + R0 * 0.2, 8 + R0 * 0.9, lit, lit, lit * 1.02, 0.42 * vis, 0, 2.2);
    }
    for (let i = 0; i < Math.round(70 * vis + 20); i++) {
      const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const rx = right.x * ca + up.x * sa, ry = right.y * ca + up.y * sa, rz = right.z * ca + up.z * sa;
      const r = R0 * (0.8 + Math.random() * 1.6);
      const along = (Math.random() - 0.2) * L0 * 2.5;
      FX.smokeP.spawn(c.x + rx * r - fwd.x * along, c.y + ry * r - fwd.y * along, c.z + rz * r - fwd.z * along,
        rx * 6 + vel.x * 0.03, ry * 6 + vel.y * 0.03 + 1, rz * 6 + vel.z * 0.03, 3 + Math.random() * 2.5, 6, 26 + R0 * 2, 0.95, 0.96, 1, 0.18 * vis, 0.2, 0.5);
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
