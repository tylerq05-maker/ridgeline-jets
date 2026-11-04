/* Jet City — atomic airburst (the Fat Man bomb in the hangar's bomb loadout).
 * Scaled on a ~21 kt airburst at ~500 m: a flash that whites out the sky, a fireball ~200 m across that cools from
 * white to dull red while it rises, the shock front (a condensation dome and a ground dust ring) racing out at about
 * the speed of sound, a mushroom cloud whose stem and cap climb for minutes, and the boom arriving late with
 * distance. In New York the shock front crushes and chars the buildings as it sweeps out (nyc.js reads RJ.blastU in
 * its facade shader) and fires burn across the blast zone afterwards. Aircraft caught by the shock are thrown or
 * destroyed. Effects are a handful of meshes with one noise shader, plus the game's particle pools. */
(function (RJ) {
  "use strict";
  const N = (RJ.nuke = { list: [] });
  const V3 = RJ.V3, tv = V3();
  const U = (RJ.blastU = RJ.blastU || { value: new THREE.Vector4(0, 0, 0, 0) }); // x, z, shock radius, damage radius
  const SEVERE = 1700, SHOCK_MAX = 9000, C0 = 343;

  let mat = null;
  function cloudMat() {
    if (mat) return mat;
    const NOISE = RJ.world.GLSL_NOISE;
    mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, side: THREE.FrontSide,
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uT: { value: 0 }, uAmp: { value: 0.18 }, uFreq: { value: 2.2 }, uGlow: { value: 1 }, uOpacity: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) },
        uCol: { value: new THREE.Color(0.55, 0.5, 0.46) }, uHot: { value: new THREE.Color(1.0, 0.45, 0.12) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.88) }, uSeed: { value: 0 }
      }])),
      vertexShader: [
        "uniform float uT, uAmp, uFreq, uSeed; varying vec3 vN; varying vec3 vP; varying float vH; varying vec3 vW;",
        NOISE,
        "#include <fog_pars_vertex>",
        "void main(){ vec3 p = position; float n = rjFbm(p.xz * uFreq + vec2(p.y * uFreq, uSeed) + vec2(uT * 0.05, -uT * 0.08));",
        "  p += normal * (n - 0.45) * uAmp * 2.0; vP = position; vH = position.y; vN = normalize(mat3(modelMatrix) * normal);",
        "  vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float uT, uGlow, uOpacity, uFreq, uSeed; uniform vec3 uSun, uCol, uHot, uSunCol; varying vec3 vN; varying vec3 vP; varying float vH; varying vec3 vW;",
        NOISE,
        "#include <fog_pars_fragment>",
        "void main(){ vec3 V = normalize(cameraPosition - vW); float rim = abs(dot(normalize(vN), V));",
        "  float n = rjFbm(vP.xz * uFreq * 2.1 + vec2(vP.y * 1.7, uSeed) - vec2(0.0, uT * 0.11));",
        "  float lit = 0.35 + 0.65 * clamp(dot(normalize(vN), uSun) * 0.5 + 0.5, 0.0, 1.0);",
        "  vec3 col = uCol * (0.55 + 0.6 * n) * mix(vec3(0.62, 0.66, 0.74), uSunCol, lit);",
        // still burning inside: hot orange billows that fade as the cloud cools, brightest low down
        "  col += uHot * uGlow * (0.4 + 1.6 * n * n) * (0.5 + 0.5 * (1.0 - clamp(vH, 0.0, 1.0)));",
        "  float a = uOpacity * smoothstep(0.05, 0.45, rim) * (0.75 + 0.25 * n);",
        "  gl_FragColor = vec4(col, a);",
        "#include <fog_fragment>",
        "}"
      ].join("\n")
    });
    return mat;
  }
  function blob(geo, o) {
    const m = cloudMat().clone();
    m.uniforms.uSeed.value = Math.random() * 50; m.uniforms.uSun.value.copy(RJ.world.sunDir);
    for (const k in o) if (m.uniforms[k]) { if (m.uniforms[k].value && m.uniforms[k].value.set && typeof o[k] === "number") m.uniforms[k].value.set(o[k]); else m.uniforms[k].value = o[k]; }
    const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.renderOrder = 12;
    RJ.scene.add(mesh); return mesh;
  }
  const sphere = new THREE.SphereGeometry(1, 48, 24), half = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.LatheGeometry([[0.55, 0], [0.32, 0.12], [0.24, 0.4], [0.26, 0.75], [0.42, 1.0]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const capGeo = (() => { const g = new THREE.TorusGeometry(1, 0.55, 20, 48); g.rotateX(Math.PI / 2); return g; })();

  let flashEl = null;
  function flash() {
    if (!flashEl) { flashEl = document.createElement("div"); flashEl.style.cssText = "position:fixed;inset:0;background:#fff;pointer-events:none;z-index:40;opacity:0;transition:opacity 2.6s cubic-bezier(.2,.7,.3,1)"; document.body.appendChild(flashEl); }
    flashEl.style.transition = "none"; flashEl.style.opacity = "1";
    requestAnimationFrame(() => requestAnimationFrame(() => { flashEl.style.transition = "opacity 2.6s cubic-bezier(.2,.7,.3,1)"; flashEl.style.opacity = "0"; }));
  }

  /** Detonate at p (an airburst; the ground below takes the blast). */
  N.detonate = function (p, owner) {
    const gnd = RJ.world.ground(p.x, p.z), cam = RJ.camera;
    const camD = cam ? cam.position.distanceTo(p) : 1e9;
    const e = { p: p.clone(), g: V3(p.x, gnd, p.z), t: 0, owner, hit: new Set(), boomed: false, fires: 0, camHit: false };
    if (camD < 60000) flash();
    e.light = new THREE.PointLight(0xfff2dc, 40, 60000, 1.2); e.light.position.copy(p); RJ.scene.add(e.light);
    e.ball = blob(sphere, { uAmp: 0.06, uFreq: 3, uGlow: 2.2, uCol: 0xfff0d0, uHot: 0xffd27a });
    e.dome = blob(half, { uAmp: 0.02, uFreq: 1.4, uGlow: 0, uCol: 0xf4f6f8, uOpacity: 0.0 });
    e.ring = blob(capGeo, { uAmp: 0.25, uFreq: 1.6, uGlow: 0, uCol: 0x9a8a74, uOpacity: 0.0 });
    e.stem = blob(stemGeo, { uAmp: 0.22, uFreq: 2.0, uGlow: 1.2, uCol: 0x8a7e72, uHot: 0xff6a20, uOpacity: 0.0 });
    e.cap = blob(capGeo, { uAmp: 0.3, uFreq: 1.3, uGlow: 1.6, uCol: 0x9d9188, uHot: 0xff5a14, uOpacity: 0.0 });
    e.top = blob(sphere, { uAmp: 0.28, uFreq: 1.3, uGlow: 1.4, uCol: 0xa39890, uHot: 0xff6a1c, uOpacity: 0.0 });
    e.scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    e.scorch.rotation.x = -Math.PI / 2; e.scorch.position.set(p.x, gnd + 0.6, p.z); e.scorch.renderOrder = 2; RJ.scene.add(e.scorch);
    U.value.set(p.x, p.z, 0, SEVERE);
    N.list.push(e);
    RJ.emit("nuke", { pos: e.p.clone() });
    return e;
  };

  N.update = function (dt) {
    for (let i = N.list.length - 1; i >= 0; i--) {
      const e = N.list[i]; e.t += dt; const t = e.t, H = e.p.y - e.g.y;
      // fireball: ~100 m radius within a second, cooling white → yellow → orange → dull red, rising and fading into the cap
      const fr = 100 * Math.pow(Math.min(t / 1.0, 1), 0.4) + Math.min(t, 10) * 6, rise = Math.min(t, 40) * 32 + Math.max(0, t - 40) * 8;
      e.ball.position.set(e.p.x, e.p.y + rise * 0.9, e.p.z); e.ball.scale.setScalar(fr);
      const bU = e.ball.material.uniforms, cool = Math.min(t / 9, 1);
      bU.uGlow.value = 2.2 * (1 - cool * 0.85); bU.uCol.value.setRGB(1, 0.95 - cool * 0.55, 0.82 - cool * 0.7); bU.uOpacity.value = 1 - RJ.smooth(9, 22, t); bU.uT.value = t;
      e.light.intensity = 40 * Math.exp(-t * 2.2) + 3 * Math.exp(-t * 0.25) * (1 - cool * 0.7); e.light.color.setRGB(1, 0.9 - cool * 0.45, 0.8 - cool * 0.65);
      e.light.position.copy(e.ball.position);
      // the shock front: a condensation dome, then the ground dust ring rolling outwards
      const R = Math.min(t * C0 * (1 + 1.6 * Math.exp(-t * 1.5)), SHOCK_MAX);
      e.dome.position.copy(e.g); e.dome.scale.set(R, R * 0.75, R);
      e.dome.material.uniforms.uOpacity.value = 0.35 * RJ.smooth(0, 0.3, t) * (1 - RJ.smooth(1.5, 5, t));
      e.ring.position.set(e.g.x, e.g.y + 25, e.g.z); e.ring.scale.set(R * 0.97, 60 + t * 2, R * 0.97);
      e.ring.material.uniforms.uOpacity.value = 0.7 * RJ.smooth(0.2, 1.2, t) * (1 - RJ.smooth(8, 26, t)); e.ring.material.uniforms.uT.value = t;
      U.value.z = Math.min(R, SEVERE + 400);
      e.scorch.scale.setScalar(Math.min(R, SEVERE)); e.scorch.material.opacity = 0.55 * RJ.smooth(0.5, 3, t) * (1 - RJ.smooth(240, 300, t));
      // mushroom cloud: the stem drawn up under a rolling cap that climbs toward ~9 km over minutes
      const capH = H + 9000 * (1 - Math.exp(-t / 45)), capR = 300 + 1500 * (1 - Math.exp(-t / 35));
      const sU = e.stem.material.uniforms, cU = e.cap.material.uniforms, tU = e.top.material.uniforms, glow = Math.exp(-t / 10);
      e.stem.position.copy(e.g); e.stem.scale.set(capR * 0.55, capH, capR * 0.55);
      e.cap.position.set(e.g.x, e.g.y + capH, e.g.z); e.cap.scale.set(capR, capR * 0.55, capR);
      e.top.position.set(e.g.x, e.g.y + capH + capR * 0.25, e.g.z); e.top.scale.set(capR * 0.95, capR * 0.6, capR * 0.95);
      const vis = RJ.smooth(1.2, 6, t) * (1 - RJ.smooth(200, 300, t));
      sU.uOpacity.value = vis * 0.85; cU.uOpacity.value = vis; tU.uOpacity.value = vis;
      sU.uGlow.value = 1.2 * glow; cU.uGlow.value = 1.6 * glow; tU.uGlow.value = 1.4 * glow;
      for (const u of [sU, cU, tU]) { u.uT.value = t; u.uSun.value.copy(RJ.world.sunDir); }
      // the boom: reaches the camera when the front does; aircraft caught by the front are thrown or destroyed
      const cam = RJ.camera;
      if (cam && !e.camHit && cam.position.distanceTo(e.p) < R) {
        e.camHit = true; const d = cam.position.distanceTo(e.p);
        if (RJ.audio && RJ.audio.explosion) RJ.audio.explosion(Math.max(200, d * 0.4), 6);
        if (RJ.camKick) RJ.camKick(RJ.clamp(4 - d / 2500, 0.6, 3));
      }
      if (RJ.combat) for (const ac of RJ.combat.aircraft) {
        if (!ac.alive || e.hit.has(ac)) continue;
        const d = ac.pos.distanceTo(e.p);
        if (d > R) continue;
        e.hit.add(ac);
        if (d < 2600) ac.damage(9999, e.owner && e.owner !== ac ? e.owner : null, "blast");
        else if (d < 6500) { tv.copy(ac.pos).sub(e.p).normalize(); ac.vel.addScaledVector(tv, 120 * (1 - d / 6500)); ac.damage(60 * (1 - d / 6500), null, "blast"); }
      }
      // fires across the blast zone once the front has passed
      if (t > 3 && t < 120 && RJ.fx && (e.fires += dt * 14) >= 1) {
        e.fires -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.min(R, SEVERE), x = e.g.x + Math.cos(a) * r, z = e.g.z + Math.sin(a) * r, y = RJ.world.ground(x, z);
        if (y > 0.5) { RJ.fx.fire(tv.set(x, y + 8 + Math.random() * 30, z), V3(0, 6, 0), 14 + Math.random() * 18); RJ.fx.smoke(tv, V3(0, 14, 0), 40 + Math.random() * 50, 0.15, 14, 0.5); }
      }
      if (t > 300) {
        for (const k of ["ball", "dome", "ring", "stem", "cap", "top", "scorch"]) { RJ.scene.remove(e[k]); e[k].material.dispose(); }
        RJ.scene.remove(e.light); N.list.splice(i, 1);
      }
    }
  };
  /** New game: clear clouds and give the city back its buildings. */
  N.reset = function () { for (const e of N.list) { e.t = 1e9; } N.update(0); U.value.set(0, 0, 0, 0); };
})(window.RJ);
