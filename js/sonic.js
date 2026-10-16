/* Ridgeline Jets — sonic boom and transonic vapor.
 * - Transonic shock cone (Prandtl–Glauert style condensation) builds around the airframe between
 *   Mach ~0.93 and 1.0, scaled by humidity: low altitude, cloud, sea air and bad weather make it thicker.
 * - Crossing Mach 1 triggers the boom once: a detached vapor shell and two expanding rings that stay in
 *   the air mass and erode into wisps, a sunlit particle burst, cloud punch-through, sea spray or dust
 *   when low, a screen-space shock ripple, sound, and camera effects (wired in main.js).
 * - Re-arms only after the aircraft drops back below Mach 0.97 (handled in flight.js). */
(function (RJ) {
  "use strict";
  const S = { events: [], shocks: [] };
  RJ.sonic = S;
  const V3 = RJ.V3;
  const tv = V3(), tv2 = V3();

  S.init = function (scene) {
    S.scene = scene;
    const N = RJ.world.GLSL_NOISE;
    S.baseMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        time: { value: 0 }, opacity: { value: 0 }, erosion: { value: 0.4 }, seed: { value: 0 }, ends: { value: 1 },
        freq: { value: new THREE.Vector2(36, 3) }, flow: { value: 1.5 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) }, shadeCol: { value: new THREE.Color(0.6, 0.65, 0.72) }
      }]), RJ.world.atmoUniforms()),
      vertexShader: [
        "varying vec2 vUv; varying vec3 vNW; varying vec3 vWP;",
        "#include <fog_pars_vertex>",
        "void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vNW = normalize(mat3(modelMatrix) * normal);",
        "  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float time; uniform float opacity; uniform float erosion; uniform float seed; uniform float ends; uniform vec2 freq; uniform float flow;",
        "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 shadeCol;",
        "varying vec2 vUv; varying vec3 vNW; varying vec3 vWP;",
        N,
        "#include <fog_pars_fragment>",
        "void main(){",
        "  vec2 p = vec2(vUv.x * freq.x, vUv.y * freq.y) + seed;",
        "  float n = rjFbm(p + vec2(time * 0.35, -time * flow));",
        "  float dens = smoothstep(erosion, erosion + 0.22, n);",
        "  float e = mix(1.0, sin(clamp(vUv.y, 0.0, 1.0) * 3.14159), ends);",
        "  vec3 V = normalize(cameraPosition - vWP); vec3 Nn = normalize(vNW);",
        "  float fres = abs(dot(Nn, V));",
        // thin sheet: edge-on it reads dense, face-on it is a translucent streaky veil
        "  float a = dens * e * mix(1.0, 0.32, fres) * opacity;",
        "  if (a < 0.003) discard;",
        "  float lit = abs(dot(Nn, sunDir));",
        "  float fwd = pow(max(dot(-V, sunDir), 0.0), 6.0);",
        "  vec3 col = mix(shadeCol, sunCol, 0.45 + 0.55 * lit) + sunCol * fwd * 1.5 + sunCol * n * 0.12;",
        "  gl_FragColor = vec4(col, a);",
        "#include <fog_fragment>",
        "}"
      ].join("\n")
    });
    // bell-shaped shock cone flaring backwards (lathe profile r,z); +Z is aft
    const prof = [[0.30, -0.6], [0.55, -0.42], [0.78, -0.2], [0.95, 0.1], [1.05, 0.45], [1.1, 0.8], [1.12, 1.0]];
    S.coneGeo = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 48);
    S.coneGeo.rotateX(Math.PI / 2);
    S.ringGeo = new THREE.TorusGeometry(1, 0.2, 20, 96);
  };

  function makeMat(o) {
    const m = S.baseMat.clone();
    m.uniforms.map && (m.uniforms.map.value = null);
    Object.assign(m.uniforms, RJ.world.atmoUniforms());
    m.uniforms.seed.value = Math.random() * 100;
    m.uniforms.freq.value.set(o.fx, o.fy);
    m.uniforms.flow.value = o.flow;
    m.uniforms.ends.value = o.ends;
    syncLight(m);
    return m;
  }
  function syncLight(m) {
    const W = RJ.world;
    m.uniforms.sunDir.value.copy(W.sunDir);
    m.uniforms.sunCol.value.copy(W.sun.color).multiplyScalar(Math.min(1.4, (W.sunIntensity || 1) * 1.15 + 0.15));
    m.uniforms.shadeCol.value.copy(W.horizonColor || new THREE.Color(0.6, 0.65, 0.7)).lerp(new THREE.Color(0.55, 0.58, 0.65), 0.5);
  }

  /** 0..1 how readily vapor condenses around this aircraft right now. */
  S.humidity = function (ac) {
    if (ac._humT != null && ac.time - ac._humT < 0.5) return ac._hum;
    const W = RJ.world, wx = W.WEATHER[W.env.weather] || {};
    let h = (wx.humid != null ? wx.humid : 0.5);
    h *= 1 - RJ.smooth(3000, 11000, ac.pos.y) * 0.75;
    if (ac.agl < 600 && W.isWaterAt(ac.pos.x, ac.pos.z)) h += 0.35 * (1 - ac.agl / 600);
    if (W.inCloud > 0.05 || W.cloudDensityAt(ac.pos, 1.3) > 0) h += 0.5;
    if (W.env.time === "dawn" || W.env.time === "morning") h += 0.1;
    ac._hum = RJ.clamp(h, 0, 1); ac._humT = ac.time;
    return ac._hum;
  };

  /* ---------- attached transonic cone ---------- */
  function coneFor(ac) {
    if (ac._cone) return ac._cone;
    const d = ac.vis.dims;
    const m = new THREE.Mesh(S.coneGeo, makeMat({ fx: 40, fy: 3, flow: 2.2, ends: 1 }));
    const z0 = d.minZ + d.len * 0.4;
    m.position.set(0, 0, z0);
    const R = Math.max(d.span * 0.38, d.len * 0.15, 2.2), L = d.len * 0.3;
    m.scale.set(R, R, L);
    m.renderOrder = 10;
    m.frustumCulled = false;
    m.visible = false;
    m.layers.set(RJ.LATE);
    ac.mesh.add(m);
    ac._cone = m;
    return m;
  }

  /* ---------- the boom ---------- */
  S.trigger = function (ac) {
    const W = RJ.world, d = ac.vis.dims;
    const hum = S.humidity(ac);
    const vis = RJ.clamp(hum, 0.22, 1);
    const R0 = Math.max(d.span * 0.42, d.len * 0.17, 2.4), L0 = d.len * 0.36;
    const center = ac.mesh.localToWorld(tv.set(0, 0, d.minZ + d.len * 0.42)).clone();
    const ev = { t: 0, ac, center, q: ac.q.clone(), vel: ac.vel.clone(), R0, L0, vis, meshes: [] };
    const add = (geo, o) => { const m = new THREE.Mesh(geo, makeMat(o)); m.position.copy(center); m.quaternion.copy(ev.q); m.frustumCulled = false; m.renderOrder = 10; m.layers.set(RJ.LATE); S.scene.add(m); ev.meshes.push(m); return m; };
    ev.shell = add(S.coneGeo, { fx: 46, fy: 3.0, flow: 0.9, ends: 1 });
    ev.ring1 = add(S.ringGeo, { fx: 52, fy: 5, flow: 0.6, ends: 0 });
    ev.ring2 = add(S.ringGeo, { fx: 44, fy: 4, flow: 0.5, ends: 0 });
    ev.ring2.position.addScaledVector(ac.fwd, -L0 * 0.7);
    S.events.push(ev);
    // sunlit particle burst + lingering wisps
    const near = W.cloudNear || 0;
    const inCloud = (W.inCloud || 0) > 0.1 || near > 0.05 || W.cloudDensityAt(ac.pos, 1.4) > 0;
    RJ.fx.boomBurst(center, ac.fwd, ac.up, ac.right, ac.vel, R0, L0, vis * (inCloud ? 1.5 : 1), W.sunDir);
    if (inCloud) W.punchHole(center, 0.55 + vis * 0.6);
    const gnd = W.ground(ac.pos.x, ac.pos.z);
    const agl = ac.pos.y - gnd;
    if (agl < 260) {
      const k = 1 - agl / 260;
      if (W.isWaterAt(ac.pos.x, ac.pos.z)) RJ.fx.sprayRing(tv2.set(ac.pos.x, 0.8, ac.pos.z), k, ac.vel);
      else RJ.fx.dustRing(tv2.set(ac.pos.x, gnd + 1, ac.pos.z), k, ac.vel);
    }
    S.shocks.push({ pos: center.clone(), t: 0, R0, vis });
    if (S.shocks.length > 3) S.shocks.shift();
    RJ.emit("boomfx", { ac, vis, center, inCloud });
  };

  S.update = function (dt, list) {
    for (const ac of list) {
      if (!ac.alive || ac.state !== "flying") { if (ac._cone) ac._cone.visible = false; continue; }
      const m = ac.mach;
      const amt = RJ.smooth(0.93, 0.99, m) * (1 - RJ.smooth(1.02, 1.12, m));
      if (amt > 0.01) {
        const hum = S.humidity(ac);
        const cone = coneFor(ac);
        const a = amt * (0.25 + hum * 0.85);
        cone.visible = a > 0.02;
        const U = cone.material.uniforms;
        U.time.value += dt;
        U.opacity.value = a * 0.85;
        U.erosion.value = 0.46 - a * 0.16;
        if ((U._syncT = (U._syncT || 0) + dt) > 1) { U._syncT = 0; syncLight(cone.material); }
      } else if (ac._cone) ac._cone.visible = false;
    }
    for (let i = S.events.length - 1; i >= 0; i--) {
      const ev = S.events[i];
      ev.t += dt;
      const t = ev.t;
      // the vapor belongs to the air mass: it barely follows the jet and drifts to a stop
      const drift = Math.exp(-t * 1.8) * 0.16;
      for (const mm of ev.meshes) { mm.position.addScaledVector(ev.vel, drift * dt); mm.material.uniforms.time.value += dt; }
      const R = ev.R0, L = ev.L0, v = ev.vis;
      const s1 = 1 + 1.9 * (1 - Math.exp(-t * 3.4));
      ev.shell.scale.set(R * s1, R * s1, L * (1 + 1.3 * (1 - Math.exp(-t * 2.6))));
      ev.shell.material.uniforms.opacity.value = v * 0.72 * Math.exp(-t * 2.0) * RJ.smooth(0, 0.04, t);
      ev.shell.material.uniforms.erosion.value = 0.36 + t * 0.7;
      const r1 = R * 0.95 + R * 5.2 * (1 - Math.exp(-t * 2.1));
      ev.ring1.scale.set(r1, r1, r1 * 0.75);
      ev.ring1.material.uniforms.opacity.value = v * 0.9 * Math.exp(-t * 1.05) * RJ.smooth(0, 0.05, t);
      ev.ring1.material.uniforms.erosion.value = 0.24 + t * 0.36;
      const t2 = Math.max(0, t - 0.09);
      const r2 = R * 0.8 + R * 3.8 * (1 - Math.exp(-t2 * 2.4));
      ev.ring2.scale.set(r2, r2, r2 * 0.7);
      ev.ring2.material.uniforms.opacity.value = t2 > 0 ? v * 0.75 * Math.exp(-t2 * 1.25) * RJ.smooth(0, 0.05, t2) : 0;
      ev.ring2.material.uniforms.erosion.value = 0.28 + t2 * 0.42;
      if (t > 3.4) {
        for (const mm of ev.meshes) { S.scene.remove(mm); mm.material.dispose(); }
        S.events.splice(i, 1);
      }
    }
    for (let i = S.shocks.length - 1; i >= 0; i--) { S.shocks[i].t += dt; if (S.shocks[i].t > 1.3) S.shocks.splice(i, 1); }
  };

  /** Screen-space shock ripples for the post pass: [u, v, radius (screen heights), strength]. */
  S.screenShocks = function (camera) {
    const out = [];
    const tanH = Math.tan((camera.fov * RJ.DEG) / 2);
    for (const s of S.shocks) {
      const dist = s.pos.distanceTo(camera.position);
      const fade = Math.exp(-s.t * 2.6) * RJ.smooth(0, 0.03, s.t);
      const vv = tv.copy(s.pos).applyMatrix4(camera.matrixWorldInverse);
      if (dist < 60 || vv.z > -1) {
        // the shock is right around the camera (cockpit or tight chase): ring sweeps out from the center
        out.push([0.5, 0.5, 0.05 + s.t * 1.1, 0.03 * fade]);
        continue;
      }
      const p = tv.copy(s.pos).project(camera);
      const rWorld = s.R0 * 1.4 + s.t * 340;
      const rad = rWorld / dist / (2 * tanH);
      out.push([(p.x + 1) / 2, (p.y + 1) / 2, rad, 0.022 * fade * RJ.clamp(220 / dist, 0.25, 1)]);
    }
    return out.slice(-3);
  };

  S.reset = function () {
    for (const ev of S.events) for (const mm of ev.meshes) { S.scene.remove(mm); mm.material.dispose(); }
    S.events.length = 0; S.shocks.length = 0;
  };
})(window.RJ);
