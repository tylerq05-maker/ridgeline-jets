/* Ridgeline Jets — transonic condensation, the Mach 1 transition and the sonic boom.
 * - Vapor: a Prandtl–Glauert cloud forms in the expansion region just behind the shock. Its sharp front sits
 *   at the shock and slides aft as Mach rises (mid-fuselage at M 0.93, the tail by ~1.05, then it detaches);
 *   denser over the upper surfaces, two offset layers for depth, sunlit, and only as thick as the air allows
 *   (humidity from weather, cloud, sea air, altitude and temperature).
 * - Crossing Mach 1 (re-armed below M 0.97 in flight.js): the cloud at its peak detaches into the air mass,
 *   stretches and erodes behind the jet and sheds slow wisps; a faint pressure ripple; sea spray or dust when
 *   low. No rings, no fireball.
 * - Sound (S.listen): the boom is the Mach cone sweeping over a listener, not an event at the crossing. Each
 *   frame, for every supersonic aircraft, the camera is tested against its cone (half-angle asin(1/M)); the
 *   N-wave plays when the cone passes, with distance falloff, air absorption and pan. A listener moving with
 *   the jet (cockpit, chase) is never crossed: it gets the structural/pressure cue at the crossing instead. */
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
        time: { value: 0 }, opacity: { value: 0 }, erosion: { value: 0.4 }, seed: { value: 0 }, ends: { value: 1 }, shock: { value: -1 }, top: { value: 0 },
        freq: { value: new THREE.Vector2(36, 3) }, flow: { value: 1.5 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) }, shadeCol: { value: new THREE.Color(0.6, 0.65, 0.72) }
      }]), RJ.world.atmoUniforms()),
      vertexShader: [
        "varying vec2 vUv; varying vec3 vNW; varying vec3 vWP; varying vec3 vOP;",
        "#include <fog_pars_vertex>",
        "void main(){ vUv = uv; vOP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vNW = normalize(mat3(modelMatrix) * normal);",
        "  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float time; uniform float opacity; uniform float erosion; uniform float seed; uniform float ends; uniform vec2 freq; uniform float flow; uniform float shock; uniform float top;",
        "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 shadeCol;",
        "varying vec2 vUv; varying vec3 vNW; varying vec3 vWP; varying vec3 vOP;",
        N,
        "#include <fog_pars_fragment>",
        "void main(){",
        "  vec2 p = vec2(vUv.x * freq.x, vUv.y * freq.y) + seed;",
        "  float n = rjFbm(p + vec2(time * 0.35, -time * flow));",
        "  float dens = smoothstep(erosion - 0.12, erosion + 0.38, n);",
        "  float e = mix(1.0, sin(clamp(vUv.y, 0.0, 1.0) * 3.14159), ends);",
        // a sharp front at the shock (slightly ragged), fading out aft as the air recompresses and the drops evaporate
        "  if (shock > -0.5) { float sf = shock + (n - 0.5) * 0.05; e = smoothstep(sf - 0.015, sf + 0.03, vUv.y) * (1.0 - smoothstep(sf + 0.12, sf + 0.55, vUv.y)) * (0.6 + 0.4 * smoothstep(1.0, 0.6, vUv.y)); }",
        // condensation is heaviest over the upper surfaces where the expansion is strongest
        "  e *= mix(1.0, 0.55 + 0.6 * smoothstep(-0.7, 0.8, vOP.y / max(length(vOP.xy), 1e-3)), top);",
        // never a clean ring: the wide rear rim evaporates completely and the cloud is patchy around the airframe
        "  e *= 1.0 - smoothstep(0.7, 0.96, vUv.y);",
        "  float ang = atan(vOP.y, vOP.x); e *= mix(1.0, 0.25 + 0.9 * rjVN(vec2(ang * 1.6 + seed, time * 0.25)), top);",
        "  vec3 V = normalize(cameraPosition - vWP); vec3 Nn = normalize(vNW);",
        "  float fres = abs(dot(Nn, V));",
        // thin sheet: edge-on it reads dense, face-on it is a translucent streaky veil
        // a soft veil: only slightly denser where seen edge-on, so the silhouette never draws a bright outline
        "  float a = dens * e * mix(0.72, 0.62, fres) * opacity;",
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
    // cold air holds little water vapour: thin, faint clouds high up (still possible in humid layers)
    h *= 0.35 + 0.65 * RJ.smooth(218, 262, RJ.airTemp(ac.pos.y));
    ac._hum = RJ.clamp(h, 0, 1); ac._humT = ac.time;
    return ac._hum;
  };

  /* ---------- attached transonic cone ---------- */
  function coneFor(ac) {
    if (ac._cone) return ac._cone;
    const d = ac.vis.dims;
    const R = Math.max(d.span * 0.4, d.len * 0.15, 2.2), L = d.len * 0.62;
    // the cloud spans the aft two thirds of the airframe; the shader opens it from the shock position
    const g = new THREE.Group(); g.position.set(0, 0, d.minZ + d.len * 0.3); g.visible = false;
    for (const [k, fx] of [[1, 13], [0.84, 9]]) {
      const m = new THREE.Mesh(S.coneGeo, makeMat({ fx, fy: 1.6, flow: 2.6, ends: 1 }));
      m.scale.set(R * k, R * k * 0.92, L); m.renderOrder = 10; m.frustumCulled = false; m.layers.set(RJ.LATE);
      m.material.uniforms.top.value = 1;
      g.add(m);
    }
    ac.mesh.add(g);
    ac._cone = g;
    return g;
  }
  /** Shock position along the cloud (0 front … 1 aft) for a Mach number: the shock walks aft toward M 1. */
  const shockAt = (m) => RJ.clamp(0.08 + (m - 0.93) * 6.5, 0.08, 0.92);

  /* ---------- the boom ---------- */
  S.trigger = function (ac) {
    const W = RJ.world, d = ac.vis.dims;
    const hum = S.humidity(ac);
    const vis = RJ.clamp(hum, 0.22, 1);
    const R0 = Math.max(d.span * 0.42, d.len * 0.17, 2.4), L0 = d.len * 0.36;
    const center = ac.mesh.localToWorld(tv.set(0, 0, d.minZ + d.len * 0.42)).clone();
    const ev = { t: 0, ac, center, q: ac.q.clone(), vel: ac.vel.clone(), R0, L0, vis, meshes: [] };
    const add = (geo, o) => { const m = new THREE.Mesh(geo, makeMat(o)); m.position.copy(center); m.quaternion.copy(ev.q); m.frustumCulled = false; m.renderOrder = 10; m.layers.set(RJ.LATE); S.scene.add(m); ev.meshes.push(m); return m; };
    // the cloud at its peak detaches into the air mass: two layers that stretch aft, erode and evaporate
    ev.shell = add(S.coneGeo, { fx: 13, fy: 1.6, flow: 0.7, ends: 1 });
    ev.inner = add(S.coneGeo, { fx: 9, fy: 1.3, flow: 0.5, ends: 1 });
    for (const mm of [ev.shell, ev.inner]) { mm.material.uniforms.top.value = 1; mm.material.uniforms.shock.value = 0.55; }
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
    S.shocks.push({ pos: center.clone(), t: 0, R0, vis, k: 0.55 });
    if (S.shocks.length > 3) S.shocks.shift();
    RJ.emit("boomfx", { ac, vis, center, inCloud });
  };

  S.update = function (dt, list) {
    for (const ac of list) {
      if (!ac.alive || ac.state !== "flying") { if (ac._cone) ac._cone.visible = false; continue; }
      const m = ac.mach;
      const amt = RJ.smooth(0.92, 0.985, m) * (1 - RJ.smooth(1.02, 1.09, m));
      ac._trans = RJ.damp(ac._trans || 0, amt, 6, dt); // smoothed, so speed jitter never makes it pop
      const tr = ac._trans;
      if (tr > 0.01) {
        const hum = S.humidity(ac);
        // sparse air (high, cold, dry) gives a faint veil; humid low air a dense, bright cloud
        const a = tr * (0.12 + hum * 0.95);
        const cone = coneFor(ac);
        cone.visible = a > 0.015;
        const sh = shockAt(m);
        for (const mm of cone.children) {
          const U = mm.material.uniforms;
          U.time.value += dt * (1 + (m - 0.9) * 4);
          U.opacity.value = a * (mm === cone.children[0] ? 1.25 : 0.8);
          U.erosion.value = 0.52 - a * 0.22;
          U.shock.value = sh;
          if ((U._syncT = (U._syncT || 0) + dt) > 1) { U._syncT = 0; syncLight(mm.material); }
        }
      } else if (ac._cone) ac._cone.visible = false;
    }
    for (let i = S.events.length - 1; i >= 0; i--) {
      const ev = S.events[i];
      ev.t += dt;
      const t = ev.t;
      // the vapor belongs to the air mass: it barely follows the jet and drifts to a stop
      const drift = Math.exp(-t * 1.8) * 0.16;
      for (const mm of ev.meshes) { mm.position.addScaledVector(ev.vel, drift * dt); mm.material.uniforms.time.value += dt; }
      const R = ev.R0, L = ev.L0 * 1.7, v = ev.vis;
      // left behind in the air: it widens a little, stretches aft as the flow relaxes, and evaporates from the edges
      const sr = 1 + 0.55 * (1 - Math.exp(-t * 2.2)), sl = 1 + 2.4 * (1 - Math.exp(-t * 1.6));
      ev.shell.scale.set(R * sr, R * sr * 0.92, L * sl);
      ev.inner.scale.set(R * sr * 0.8, R * sr * 0.74, L * sl * 0.9);
      const fade = Math.exp(-t * 1.5) * RJ.smooth(0, 0.06, t);
      ev.shell.material.uniforms.opacity.value = v * 0.8 * fade;
      ev.inner.material.uniforms.opacity.value = v * 0.5 * fade;
      for (const mm of [ev.shell, ev.inner]) { const U = mm.material.uniforms; U.erosion.value = 0.34 + t * 0.32; U.shock.value = 0.55 - Math.min(0.45, t * 0.25); }
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
        out.push([0.5, 0.5, 0.05 + s.t * 1.1, 0.012 * fade]);
        continue;
      }
      const p = tv.copy(s.pos).project(camera);
      const rWorld = s.R0 * 1.4 + s.t * 340;
      const rad = rWorld / dist / (2 * tanH);
      out.push([(p.x + 1) / 2, (p.y + 1) / 2, rad, 0.022 * (s.k || 1) * fade * RJ.clamp(220 / dist, 0.25, 1)]);
    }
    return out.slice(-3);
  };

  /** Restrained air distortion around a transonic airframe (and a faint nose shock when supersonic), for the post pass. */
  S.screenHeat = function (P, camera, ac) {
    if (!ac || !ac.alive || ac.state !== "flying" || P.heat.length >= 4) return;
    const k = (ac._trans || 0) * 0.1 + RJ.smooth(1.0, 1.2, ac.mach) * 0.03;
    if (k < 0.02) return;
    const d = ac.pos.distanceTo(camera.position); if (d < 6) return;
    const p = tv.copy(ac.pos).project(camera); if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) return;
    const rad = (ac.vis.dims.len * 0.7) / d / (2 * Math.tan((camera.fov * RJ.DEG) / 2));
    P.heat.push([(p.x + 1) / 2, (p.y + 1) / 2, RJ.clamp(rad, 0.01, 0.4), k * RJ.clamp(150 / d, 0.2, 1)]);
  };
  /** The boom as heard: fires when an aircraft's Mach cone sweeps over the listener (the camera). */
  S.listen = function (camera, camV, list) {
    const cp = camera.position, right = tv2.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const ac of list) {
      if (!ac.alive || ac.state !== "flying" || ac.mach < 1.0) { ac._coneIn = undefined; continue; }
      const d = tv.copy(cp).sub(ac.pos), dist = d.length();
      if (dist > 30000) { ac._coneIn = undefined; continue; }
      // a listener moving with the jet (cockpit, chase) is never overtaken by its own cone
      if (camV && dist < 600 && tv2.copy(camV).sub(ac.vel).length() < ac.speed * 0.3) { ac._coneIn = undefined; right.set(1, 0, 0).applyQuaternion(camera.quaternion); continue; }
      d.divideScalar(Math.max(dist, 1));
      const behind = -d.dot(tv2.copy(ac.vel).normalize()), inside = behind > Math.sqrt(1 - 1 / (ac.mach * ac.mach));
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      if (ac._coneIn === false && inside) {
        // perpendicular miss distance sets the strength (overpressure ~ r^-3/4) and how much high end survives
        const pan = RJ.clamp(-d.dot(right), -0.85, 0.85);
        RJ.audio.boomNWave(dist, RJ.clamp(1.6 * Math.pow(250 / Math.max(dist, 60), 0.75), 0.03, 1.4) * (0.8 + Math.min(0.5, (ac.mach - 1) * 0.6)), pan, ac.vis.dims.len);
        if (dist < 1500) RJ.camKick && RJ.camKick(0.5 * (1 - dist / 1500));
      }
      ac._coneIn = inside;
    }
  };

  S.reset = function () {
    for (const ev of S.events) for (const mm of ev.meshes) { S.scene.remove(mm); mm.material.dispose(); }
    S.events.length = 0; S.shocks.length = 0;
  };
})(window.RJ);
