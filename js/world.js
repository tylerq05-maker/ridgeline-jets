/* Ridgeline Jets — world: streamed terrain (Web Workers), atmosphere, sky, water, clouds, weather, airbase. */
(function (RJ) {
  "use strict";
  const W = {};
  RJ.world = W;
  W.CH = 2000; // chunk size (m)
  const gen = RJ.makeTerrainGen();
  W.gen = gen;
  // real Everest elevation (js/dem-everest.js): decoded once, shared with the terrain workers
  W.dem = (() => {
    const D = RJ.DEM_EVEREST; if (!D) return null;
    try {
      return D.grids.map((g) => { const b = atob(g.b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return { n: g.n, half: g.half, cell: g.cell, data: new Uint16Array(u.buffer) }; });
    } catch (e) { console.warn("Everest elevation data unreadable; using the procedural range.", e); return null; }
  })();
  // San Francisco Bay (js/dem-sf.js): same encoding plus each grid's offset from the zone centre
  W.demSF = (() => {
    const D = RJ.DEM_SF; if (!D) return null;
    try {
      return D.grids.map((g) => { const b = atob(g.b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return { n: g.n, half: g.half, cell: g.cell, ox: g.ox, oz: g.oz, off: g.off, data: new Uint16Array(u.buffer) }; });
    } catch (e) { console.warn("San Francisco elevation data unreadable.", e); return null; }
  })();
  if (W.demSF) W.sfGeo = { lat: RJ.DEM_SF.lat, lon: RJ.DEM_SF.lon, mN: RJ.DEM_SF.mN, mE: RJ.DEM_SF.mE };
  RJ.DEM_SF = null;
  if (W.dem || W.demSF) { gen.setDEM(W.dem, W.demSF); RJ.DEM_EVEREST = null; }
  W.everest = gen.everest;
  W.fields = (x, z) => gen.fields(x, z);
  W.heightFn = (x, z) => gen.height(x, z);

  /* ======================= GLSL HELPERS ======================= */
  const GLSL_NOISE = [
    "float rjH(vec2 p){ p = mod(p, 289.0); return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "float rjVN(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  float a = rjH(i), b = rjH(i + vec2(1.0, 0.0)), c = rjH(i + vec2(0.0, 1.0)), d = rjH(i + vec2(1.0, 1.0));",
    "  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }",
    "float rjFbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * rjVN(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }"
  ].join("\n");
  W.GLSL_NOISE = GLSL_NOISE;

  /* ======================= ATMOSPHERE: shared uniforms + global height fog ======================= */
  // Plain {x,y,z} objects (not THREE vectors) so material cloning keeps them shared by reference.
  const ATMO = { sunDir: { x: 0.3, y: 0.6, z: -0.7 }, sunCol: { x: 1, y: 0.9, z: 0.8 }, params: { x: 9e-5, y: 2200, z: 0.5, w: 0 } };
  W.atmo = ATMO;
  W.GLSL_CURVE = "vec3 rjCurve(vec3 mv){ vec3 upV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz; float h = dot(mv, upV); return mv - upV * (dot(mv, mv) - h * h) * 7.848e-8; }";
  W.atmoUniforms = () => ({ fogSunDir: { value: ATMO.sunDir }, fogSunCol: { value: ATMO.sunCol }, fogParams: { value: ATMO.params } });
  (function patchFog() {
    const SC = THREE.ShaderChunk;
    SC.fog_pars_vertex = ["#ifdef USE_FOG", "varying float vFogDist;", "varying vec3 vFogWDir;", "#endif"].join("\n");
    SC.fog_vertex = ["#ifdef USE_FOG", "vFogDist = -mvPosition.z;", "vFogWDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;", "#endif"].join("\n");
    SC.fog_pars_fragment = [
      "#ifdef USE_FOG",
      "uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;",
      "uniform vec3 fogSunDir; uniform vec3 fogSunCol; uniform vec4 fogParams;",
      "varying float vFogDist; varying vec3 vFogWDir;",
      "#endif"
    ].join("\n");
    SC.fog_fragment = [
      "#ifdef USE_FOG",
      "{",
      "  vec3 rjD = vFogWDir; float rjL = length(rjD); vec3 rjN = rjD / max(rjL, 0.001);",
      "  float rjHs = max(fogParams.y, 1.0);",
      "  float rjHc = max(cameraPosition.y, 0.0);",
      "  float rjE0 = exp(-rjHc / rjHs), rjE1 = exp(-max(cameraPosition.y + rjD.y, 0.0) / rjHs);",
      "  float rjK = abs(rjD.y) > 1.0 ? (rjE0 - rjE1) * rjHs / rjD.y : rjE0;",
      "  float rjF = 1.0 - exp(-fogParams.x * rjL * max(rjK, 0.0));",
      "  rjF = max(rjF, smoothstep(fogNear, fogFar, vFogDist));",
      "  float rjS = pow(max(dot(rjN, fogSunDir), 0.0), 8.0) * fogParams.z;",
      "  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + fogSunCol * rjS, clamp(rjF, 0.0, 1.0));",
      "}",
      "#endif"
    ].join("\n");
    for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, W.atmoUniforms()); }
    // Earth curvature (R = 6,371 km): every vertex drops by d²/2R below the camera's horizontal plane, applied in
    // view space so close objects keep full precision. Shadow depth passes stay flat (their camera is the sun).
    SC.project_vertex = [
      "vec4 mvPosition = vec4( transformed, 1.0 );",
      "#ifdef USE_INSTANCING", "mvPosition = instanceMatrix * mvPosition;", "#endif",
      "mvPosition = modelViewMatrix * mvPosition;",
      "#ifndef DEPTH_PACKING", "mvPosition.xyz = rjCurve(mvPosition.xyz);", "#endif",
      "gl_Position = projectionMatrix * mvPosition;"
    ].join("\n");
    SC.common = SC.common + "\n" + W.GLSL_CURVE;
  })();

  // Cloud shadow + sky light uniforms shared by terrain and aircraft materials
  // The cloud weather map (clouds.js) is projected along the sun onto everything below the layer.
  // rjCloudXf: wind drift xz, 1/tile, strength · rjCloudSun: sun shift per metre xz, layer mid height, on · rjCloudP: coverage bias, storm
  W.cloudShadowU = {
    rjCloudTex: { value: null }, rjCloudXf: { value: new THREE.Vector4(0, 0, 1 / 24000, 0) }, rjCloudSun: { value: new THREE.Vector4(0, 0, 2800, 0) },
    rjCloudP: { value: new THREE.Vector4(0, 0, 0, 0) }
  };
  W.GLSL_CLOUDSHADOW = [
    "uniform sampler2D rjCloudTex; uniform vec4 rjCloudXf; uniform vec4 rjCloudSun; uniform vec4 rjCloudP;",
    "float rjCloudShadow(vec3 wp){",
    "  if (rjCloudSun.w < 0.5 || wp.y > rjCloudSun.z) return 1.0;",
    "  vec2 q = wp.xz + rjCloudSun.xy * (rjCloudSun.z - wp.y) - rjCloudXf.xy;",
    "  vec4 w = texture2D(rjCloudTex, q * rjCloudXf.z);",
    "  float cov = clamp(w.r * 1.12 + rjCloudP.x - 0.08 + w.b * rjCloudP.y * 0.6, 0.0, 1.0);",
    "  return 1.0 - smoothstep(0.3, 0.62, cov) * rjCloudXf.w;",
    "}"
  ].join("\n");
  /** Inject cloud shadows into a MeshStandardMaterial's direct light (used by terrain and aircraft). */
  W.addCloudShadows = function (shader, worldPosVar) {
    Object.assign(shader.uniforms, W.cloudShadowU);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + W.GLSL_CLOUDSHADOW)
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ float rjCs = rjCloudShadow(" + worldPosVar + "); reflectedLight.directDiffuse *= rjCs; reflectedLight.directSpecular *= rjCs; }");
  };

  /* ======================= QUALITY ======================= */
  W.QUALITY = {
    low: { radius: 3, lods: [40, 24, 16], bake: 10, treeR: 0, treeSpacing: 60, shadow: 0, clouds: 0.55, mist: 0, pixel: 1, post: false, std: false, reflect: false, cloudShadow: false, farN: 110, farSpacing: 880 },
    medium: { radius: 4, lods: [64, 32, 20], bake: 14, treeR: 1, treeSpacing: 50, shadow: 2048, clouds: 1, mist: 140, pixel: 1.25, post: true, std: true, reflect: false, cloudShadow: true, farN: 140, farSpacing: 700 },
    high: { radius: 6, lods: [96, 48, 24], bake: 16, treeR: 2, treeSpacing: 44, shadow: 2048, clouds: 1.3, mist: 220, pixel: 1.5, post: true, std: true, reflect: true, cloudShadow: true, farN: 170, farSpacing: 600 },
    ultra: { radius: 7, lods: [128, 64, 32], bake: 20, treeR: 2, treeSpacing: 38, shadow: 4096, clouds: 1.5, mist: 300, pixel: 2, post: true, std: true, reflect: true, cloudShadow: true, farN: 200, farSpacing: 520 }
  };

  /* ======================= INIT ======================= */
  W.init = function (renderer, scene) {
    W.renderer = renderer; W.scene = scene;
    W.sunDir = RJ.V3(0.3, 0.6, -0.7).normalize();
    W.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4b5a3a, 0.6);
    W.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    W.sun.shadow.bias = -0.0004;
    W.sun.shadow.normalBias = 0.4;
    scene.add(W.hemi, W.sun, W.sun.target);
    W.sun.shadow.camera.layers.enable(5); // near-only city detail still casts shadows
    scene.fog = new THREE.Fog(0xbcd9ee, 6000, 9000);
    initTerrainMaterials();
    initVegetation();
    initFar(); initSky(); initWater(); initClouds(); initRain(); initWaterfallMat();
    initWorkers();
    W.setQuality(RJ.settings.quality);
    W.setEnvironment({ time: "golden", weather: "scattered" });
  };

  W.setQuality = function (q) {
    W.Q = W.QUALITY[q] || W.QUALITY.medium;
    W.radius = RJ.clamp(Math.round(W.Q.radius * RJ.settings.viewDist), 2, 9);
    W.viewRange = (W.radius + 0.5) * W.CH;
    const useShadow = RJ.settings.shadows && W.Q.shadow > 0;
    W.renderer.shadowMap.enabled = useShadow;
    W.sun.castShadow = useShadow;
    if (useShadow) {
      W.sun.shadow.mapSize.set(W.Q.shadow, W.Q.shadow);
      const sc = W.sun.shadow.camera;
      sc.left = sc.bottom = -200; sc.right = sc.top = 200; sc.near = 10; sc.far = 5000;
      if (W.sun.shadow.map) { W.sun.shadow.map.dispose(); W.sun.shadow.map = null; }
      sc.updateProjectionMatrix();
    }
    W.terrainMat = W.Q.std ? W.terrainStd : W.terrainLam;
    W.terrainMat.needsUpdate = true;
    resetChunks(); W.far.center = null;
    if (W.skyMesh) W.skyMesh.scale.setScalar(W.viewRange * 0.92);
    if (W.camera) { W.camera.far = W.viewRange * 1.05 + 2000; W.camera.updateProjectionMatrix(); }
    setupReflection();
    setupCloudShadow();
    if (RJ.clouds) RJ.clouds.setQuality(q);
    W.clusters = null;
    if (W.env) W.setEnvironment(W.env);
  };

  /* ======================= GIANT SHADOW CASTERS ======================= */
  // Structures far larger than the sun's shadow map (the Ye Monument) cast onto the terrain through a few capsules
  // ray-tested per pixel toward the sun, with a penumbra that widens with distance (the sun's 0.53° disc).
  W.giant = { a: { value: [] }, b: { value: [] }, n: { value: 0 }, on: { value: 0 }, sun: { value: new THREE.Vector3(0, 1, 0) } };
  for (let i = 0; i < 6; i++) { W.giant.a.value.push(new THREE.Vector4()); W.giant.b.value.push(new THREE.Vector4()); }
  const GIANT_SHADOW = [
    "if (rjGOn > 0.5) { float gsh = 1.0; vec3 ro = vWP, rd = normalize(rjGSun);",
    "  for (int i = 0; i < 6; i++) { if (float(i) >= rjGN) break;",
    "    vec3 pa = rjGA[i].xyz, ba = rjGB[i].xyz - pa, w0 = ro - pa; float r = rjGA[i].w;",
    "    float b = dot(rd, ba), c = dot(ba, ba), d = dot(rd, w0), e = dot(ba, w0), den = max(c - b * b, 1e-3);",
    "    float sg = clamp((e - b * d) / den, 0.0, 1.0); vec3 q = pa + ba * sg; float t = dot(q - ro, rd);",
    "    if (t > 0.0) { float dist = length(ro + rd * t - q); float pen = 0.0047 * t + 4.0; gsh = min(gsh, smoothstep(r - pen, r + pen, dist)); } }",
    "  gsh = mix(1.0, gsh, smoothstep(-0.02, 0.06, rjGSun.y));",
    "  reflectedLight.directDiffuse *= gsh; reflectedLight.directSpecular *= gsh; }"
  ].join("\n");

  /* ======================= TERRAIN MATERIALS ======================= */
  function initTerrainMaterials() {
    // Physically based terrain: baked sun visibility + AO, procedural micro detail, bump, cloud shadows
    W.terrainStd = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.55, side: THREE.DoubleSide });
    W.terrainStd.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 shade; varying vec2 vShade; varying vec3 vWP; varying vec3 vWN; varying float vVD;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvShade = shade; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal); vVD = -mvPosition.z;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vShade; varying vec3 vWP; varying vec3 vWN; varying float vVD;\n" + GLSL_NOISE)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float rjFade = 1.0 - smoothstep(700.0, 3200.0, vVD);",
          // large-scale tonal variation so repeated slopes never read as copies
          "float rjMac = rjVN(vWP.xz * 0.0011) * 0.6 + rjVN(vWP.xz * 0.0042 + 3.1) * 0.4;",
          "diffuseColor.rgb *= 0.9 + rjMac * 0.2;",
          "diffuseColor.rgb *= mix(vec3(1.0), vec3(1.07, 1.0, 0.9), smoothstep(0.55, 0.85, rjVN(vWP.xz * 0.0007 + 7.0)));",
          "float rjDn = rjVN(vWP.xz * 0.045) * 0.5 + rjVN(vWP.xz * 0.21) * 0.3 + rjVN(vWP.xz * 0.9) * 0.2;",
          "diffuseColor.rgb *= mix(1.0, 0.84 + rjDn * 0.32, rjFade);",
          "float rjSteep = 1.0 - clamp(vWN.y, 0.0, 1.0);",
          "float rjStrata = 0.5 + 0.5 * sin(vWP.y * (0.11 + 0.08 * rjVN(vWP.xz * 0.003)) + rjVN(vWP.xz * 0.01) * 9.0 + rjVN(vWP.xz * 0.05) * 2.0);",
          "diffuseColor.rgb *= mix(1.0, 0.93 + 0.1 * rjStrata, smoothstep(0.5, 0.85, rjSteep) * rjFade);",
          // rain-washed vertical streaks down cliff faces
          "float rjCl = rjVN(vec2((vWP.x + vWP.z) * 0.06, vWP.y * 0.01)) * 0.7 + rjVN(vec2((vWP.x - vWP.z) * 0.21, vWP.y * 0.03)) * 0.3;",
          "diffuseColor.rgb *= mix(1.0, 0.86 + 0.24 * rjCl, smoothstep(0.45, 0.8, rjSteep) * (0.5 + 0.5 * rjFade));",
          // snowfields: rock buttresses and outcrops break through wherever the slope steepens (per pixel, so detail
          // survives far beyond the mesh resolution), and wind-packed snow gets a faint cold tone
          "float rjSnowV = smoothstep(0.68, 0.8, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)));",
          "if (rjSnowV > 0.01) {",
          "  float rjS1 = rjFbm(vWP.xz * 0.0024), rjS2 = rjVN(vWP.xz * 0.019 + 5.0), rjS3 = rjVN(vWP.xz * 0.12);",
          "  float rjSt = rjSteep + (rjS1 - 0.5) * 0.38 + (rjS2 - 0.5) * 0.2 + (rjS3 - 0.5) * 0.12 * rjFade;",
          "  float rjRk = smoothstep(0.22, 0.31, rjSt);",
          "  vec3 rjRc = vec3(0.23, 0.22, 0.215) * (0.72 + 0.55 * rjS2) * (0.88 + 0.24 * rjStrata);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb, rjRc, rjSnowV * rjRk);",
          "  rjSnowV *= 1.0 - rjRk;",
          "  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.97, 0.99, 1.03) * (0.95 + 0.05 * rjS3), rjSnowV);",
          "}"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - smoothstep(0.85, 0.95, diffuseColor.b) * 0.18, 0.55, 1.0);")
        .replace("#include <normal_fragment_maps>", [
          "#include <normal_fragment_maps>",
          "{ vec2 rjQ = vWP.xz * 0.09; float b0 = rjVN(rjQ), bx = rjVN(rjQ + vec2(0.15, 0.0)), bz = rjVN(rjQ + vec2(0.0, 0.15));",
          "  vec2 rjQ2 = vWP.xz * 0.6; float c0 = rjVN(rjQ2), cx = rjVN(rjQ2 + vec2(0.15, 0.0)), cz = rjVN(rjQ2 + vec2(0.0, 0.15));",
          "  vec3 rjB = vec3((b0 - bx) * 1.6 + (c0 - cx) * 0.5, 0.0, (b0 - bz) * 1.6 + (c0 - cz) * 0.5) * rjFade;",
          "  rjB.xz += vec2(rjVN(vec2(vWP.x * 0.05 + vWP.z * 0.02, vWP.z * 0.35)) - rjVN(vec2(vWP.x * 0.05 + vWP.z * 0.02 + 0.2, vWP.z * 0.35))) * 1.4 * rjSnowV * rjFade;",
          "  normal = normalize(normal + (viewMatrix * vec4(rjB, 0.0)).xyz); }"
        ].join("\n"))
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directDiffuse *= vShade.x; reflectedLight.directSpecular *= vShade.x; reflectedLight.indirectDiffuse *= vShade.y;\n" + GIANT_SHADOW);
      Object.assign(shader.uniforms, { rjGA: W.giant.a, rjGB: W.giant.b, rjGN: W.giant.n, rjGOn: W.giant.on, rjGSun: W.giant.sun });
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 rjGA[6]; uniform vec4 rjGB[6]; uniform float rjGN; uniform float rjGOn; uniform vec3 rjGSun;");
      W.addCloudShadows(shader, "vWP");
    };
    // Low quality: cheap Lambert with baked shading folded into the albedo
    W.terrainLam = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    W.terrainLam.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 shade; varying vec2 vShade;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShade = shade;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vShade;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.5, 1.0, vShade.x) * mix(0.75, 1.0, vShade.y);");
    };
  }

  function mergeGeos(parts) {
    // parts: [{geo, color:[r,g,b]}] -> one non-indexed geometry with vertex colors
    let total = 0;
    const flat = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; total += g.attributes.position.count; return { g, c: p.color }; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const { g, c } of flat) {
      g.computeVertexNormals();
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++, o++) {
        pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
        nor[o * 3] = N.getX(i); nor[o * 3 + 1] = N.getY(i); nor[o * 3 + 2] = N.getZ(i);
        col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  function initVegetation() {
    const trunk = [0.32, 0.22, 0.14], leaf = [1, 1, 1];
    const t1 = new THREE.CylinderGeometry(0.45, 0.7, 5, 5); t1.translate(0, 2.5, 0);
    const c1 = new THREE.ConeGeometry(4.6, 9, 7); c1.translate(0, 7.5, 0);
    const c2 = new THREE.ConeGeometry(3.6, 8, 7); c2.translate(0, 11.5, 0);
    const c3 = new THREE.ConeGeometry(2.2, 6, 7); c3.translate(0, 15.5, 0);
    W.conifer = mergeGeos([{ geo: t1, color: trunk }, { geo: c1, color: leaf }, { geo: c2, color: leaf }, { geo: c3, color: leaf }]);
    const t2 = new THREE.CylinderGeometry(0.5, 0.8, 6, 5); t2.translate(0, 3, 0);
    const b1 = new THREE.IcosahedronGeometry(4.8, 1); b1.scale(1, 0.85, 1); b1.translate(0, 9, 0);
    const b2 = new THREE.IcosahedronGeometry(3.2, 0); b2.translate(2.2, 11, 1);
    W.broadleaf = mergeGeos([{ geo: t2, color: trunk }, { geo: b1, color: leaf }, { geo: b2, color: leaf }]);
    const r1 = new THREE.DodecahedronGeometry(1, 0); r1.scale(1.3, 0.7, 1);
    W.rockGeo = mergeGeos([{ geo: r1, color: [1, 1, 1] }]);
    W.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    W.rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  }

  /* ======================= CHUNK STREAMING (Web Workers) ======================= */
  W.chunks = new Map();
  W.pending = new Map();
  W.ready = [];
  W.falls = [];
  let reqSeq = 0;
  const key = (cx, cz) => cx + "," + cz;

  function initWorkers() {
    W.workers = [];
    try {
      const src = [
        "var makeTerrainGen = " + RJ.makeTerrainGen.toString() + ";",
        "var gen = makeTerrainGen();",
        "self.onmessage = function (e) {",
        "  var r = e.data; if (r.type === 'dem') { gen.setDEM(r.grids, r.sf); return; }",
        "  gen.setAirbase(r.ab); gen.setSites(r.sites || []);",
        "  if (r.type === 'far') { var fo = gen.buildFar(r); self.postMessage(fo, [fo.pos.buffer, fo.nor.buffer, fo.col.buffer, fo.index.buffer]); return; }",
        "  var o = gen.buildChunk(r); o.reqId = r.reqId;",
        "  var tr = [o.pos.buffer, o.nor.buffer, o.col.buffer, o.shade.buffer, o.index.buffer, o.heights.buffer, o.treeData.buffer, o.rockData.buffer, o.falls.buffer];",
        "  if (o.wpos) { tr.push(o.wpos.buffer); tr.push(o.winfo.buffer); }",
        "  self.postMessage(o, tr);",
        "};"
      ].join("\n");
      const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        const slot = { w: new Worker(url), busy: 0 };
        if (W.dem || W.demSF) slot.w.postMessage({ type: "dem", grids: W.dem, sf: W.demSF });
        slot.w.onmessage = (e) => { slot.busy = Math.max(0, slot.busy - 1); if (e.data.far) applyFar(e.data); else onChunkData(e.data); };
        slot.w.onerror = (e) => { console.warn("Terrain worker failed; building on the main thread instead.", e.message || e); workersFailed(); };
        W.workers.push(slot);
      }
    } catch (e) { console.warn("Web Workers unavailable; building terrain on the main thread.", e); W.workers = []; }
  }
  function workersFailed() {
    W.workers.forEach((s) => { try { s.w.terminate(); } catch (e) { /* already gone */ } });
    W.workers = [];
    W.pending.clear();
  }
  function onChunkData(d) {
    const k = key(d.cx, d.cz), p = W.pending.get(k);
    if (!p || p.reqId !== d.reqId) return; // superseded
    W.pending.delete(k);
    W.ready.push(d);
  }
  function makeReq(it) {
    return {
      cx: it.cx, cz: it.cz, lod: it.lod, n: W.Q.lods[it.lod], size: W.CH, bakeN: it.lod === 0 ? W.Q.bake : it.lod === 1 ? 12 : 8,
      sun: [W.lightDir.x, W.lightDir.y, W.lightDir.z], sunKey: W.sunKey, trees: it.trees, near: it.lod === 0, treeSpacing: W.Q.treeSpacing,
      ab: W.airbase || null, sites: W.sites, reqId: ++reqSeq
    };
  }
  function request(it) {
    const req = makeReq(it);
    if (W.workers.length) {
      let best = W.workers[0];
      for (const s of W.workers) if (s.busy < best.busy) best = s;
      best.busy++;
      W.pending.set(key(it.cx, it.cz), req);
      best.w.postMessage(req);
    } else {
      gen.setAirbase(W.airbase || null); gen.setSites(W.sites);
      createChunk(gen.buildChunk(req));
    }
  }

  function resetChunks() {
    for (const ch of W.chunks.values()) disposeChunk(ch);
    W.chunks.clear(); W.pending.clear(); W.ready.length = 0;
    W.falls.length = 0;
  }
  function disposeChunk(ch) {
    W.scene.remove(ch.mesh); ch.mesh.geometry.dispose();
    if (ch.water) { W.scene.remove(ch.water); ch.water.geometry.dispose(); }
    for (const m of ch.extras) { W.scene.remove(m); if (m.isInstancedMesh && m.dispose) m.dispose(); else if (m.geometry && m.geometry !== W.conifer && m.geometry !== W.broadleaf && m.geometry !== W.rockGeo) m.geometry.dispose(); }
    for (const f of ch.falls) { const i = W.falls.indexOf(f); if (i >= 0) W.falls.splice(i, 1); }
  }

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();
  function createChunk(d) {
    const k = key(d.cx, d.cz), old = W.chunks.get(k);
    if (old) disposeChunk(old);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(d.nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(d.col, 3));
    geo.setAttribute("shade", new THREE.BufferAttribute(d.shade, 2));
    geo.setIndex(new THREE.BufferAttribute(d.index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, W.terrainMat);
    mesh.position.set(d.cx * W.CH, 0, d.cz * W.CH);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    W.scene.add(mesh);
    const ch = { cx: d.cx, cz: d.cz, lod: d.lod, n: d.n, step: d.step, x0: d.x0, z0: d.z0, heights: d.heights, mesh, water: null, extras: [], falls: [], sunKey: d.sunKey, trees: d.trees, sea: false };
    if (d.wpos) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.BufferAttribute(d.wpos, 3));
      wg.setAttribute("winfo", new THREE.BufferAttribute(d.winfo, 2));
      wg.setIndex(new THREE.BufferAttribute(d.index.subarray(0, d.n * d.n * 6), 1));
      wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, W.waterMat);
      wm.position.copy(mesh.position);
      wm.layers.set(1);
      wm.renderOrder = 2;
      wm.matrixAutoUpdate = false; wm.updateMatrix();
      W.scene.add(wm);
      ch.water = wm;
      for (let i = 1; i < d.winfo.length; i += 2) if (d.winfo[i] > 0.5 && d.winfo[i - 1] > 0) { ch.sea = true; break; }
    }
    const addInstanced = (geoI, mat, list, stride, fill) => {
      const count = list.length / stride;
      if (!count) return;
      const im = new THREE.InstancedMesh(geoI, mat, count);
      for (let i = 0; i < count; i++) fill(im, i, list, i * stride);
      im.position.copy(mesh.position);
      im.receiveShadow = true;
      im.matrixAutoUpdate = false; im.updateMatrix();
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      W.scene.add(im); ch.extras.push(im);
    };
    if (d.treeData && d.treeData.length) {
      const con = [], brd = [];
      for (let i = 0; i < d.treeData.length; i += 6) (d.treeData[i + 4] < 0.5 ? con : brd).push(d.treeData[i], d.treeData[i + 1], d.treeData[i + 2], d.treeData[i + 3], d.treeData[i + 5]);
      const fillTree = (im, i, L, o) => {
        // non-uniform scale gives each instance its own silhouette: slender spruce, squat pine, tall broadleaf
        const r7 = (L[o + 4] * 7.13) % 1, r13 = (L[o + 4] * 13.7) % 1, wS = L[o + 3] * (0.72 + r7 * 0.55);
        _s.set(wS, L[o + 3] * (0.8 + r13 * 0.65), wS * (0.9 + r13 * 0.2));
        _q.setFromAxisAngle(RJ.V3(0, 1, 0), L[o + 4] * 6.28);
        _m4.compose(_p.set(L[o] - d.cx * W.CH, L[o + 1], L[o + 2] - d.cz * W.CH), _q, _s);
        im.setMatrixAt(i, _m4);
        const r = L[o + 4];
        const k = (r * 23.1) % 1; // blue-black spruce ↔ yellow-green pine
        im.setColorAt(i, _c.setRGB(0.08 + r * 0.08 + k * 0.05, 0.17 + r * 0.1 + k * 0.05, 0.10 + r * 0.03 - k * 0.03));
      };
      const leafCol = (r) => {
        const k = (r * 31.7) % 1;
        if (k > 0.93) return _c.setRGB(0.42 + r * 0.2, 0.30 + r * 0.06, 0.08);   // early-turning maple / birch gold
        if (k > 0.75) return _c.setRGB(0.26 + r * 0.1, 0.34 + r * 0.08, 0.11);   // olive
        return _c.setRGB(0.15 + r * 0.12, 0.27 + r * 0.12, 0.10 + r * 0.04);
      };
      addInstanced(W.conifer, W.treeMat, con, 5, fillTree);
      addInstanced(W.broadleaf, W.treeMat, brd, 5, (im, i, L, o) => { fillTree(im, i, L, o); im.setColorAt(i, leafCol(L[o + 4])); });
    }
    if (d.rockData && d.rockData.length) {
      addInstanced(W.rockGeo, W.rockMat, Array.from(d.rockData), 5, (im, i, L, o) => {
        const s = L[o + 3];
        _e.set(L[o + 4] * 3, L[o + 4] * 6, L[o + 4] * 2);
        _q.setFromEuler(_e);
        _m4.compose(_p.set(L[o] - d.cx * W.CH, L[o + 1], L[o + 2] - d.cz * W.CH), _q, _s.set(s, s * 0.8, s));
        im.setMatrixAt(i, _m4);
        const g = 0.38 + L[o + 4] * 0.12;
        im.setColorAt(i, _c.setRGB(g, g * 0.97, g * 0.94));
      });
    }
    if (d.falls && d.falls.length) for (let i = 0; i < d.falls.length; i += 6) {
      const f = buildWaterfall(d.falls.subarray(i, i + 6));
      if (f) { W.scene.add(f.mesh); ch.extras.push(f.mesh); ch.falls.push(f); W.falls.push(f); }
    }
    W.chunks.set(k, ch);
  }

  function sampleChunk(ch, x, z) {
    const fx = (x - ch.x0) / ch.step, fz = (z - ch.z0) / ch.step;
    const N1 = ch.n + 1;
    const i = RJ.clamp(Math.floor(fx), 0, ch.n - 1), j = RJ.clamp(Math.floor(fz), 0, ch.n - 1);
    const u = RJ.clamp(fx - i, 0, 1), v = RJ.clamp(fz - j, 0, 1);
    const H = ch.heights, a = H[j * N1 + i], b = H[j * N1 + i + 1], c = H[(j + 1) * N1 + i], d = H[(j + 1) * N1 + i + 1];
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  /** Terrain height matching the rendered mesh where loaded. */
  W.terrainHeight = function (x, z) {
    const ch = W.chunks.get(key(Math.round(x / W.CH), Math.round(z / W.CH)));
    return ch ? sampleChunk(ch, x, z) : gen.height(x, z);
  };
  /** Surface height for collisions: terrain, rivers and lakes, or the sea. */
  W.ground = (x, z) => {
    // the sea is a floor everywhere except the dive zone, where you can fly down to the seabed
    let g = W.terrainHeight(x, z);
    if (!(RJ.realms && RJ.realms.diveAt(x, z))) g = Math.max(g, 0);
    if (W.castle) g = Math.max(g, RJ.castle.heightAt(x, z));
    if (RJ.atlas && RJ.atlas.built) g = Math.max(g, RJ.atlas.heightAt(x, z));
    return g;
  };
  W.isWaterAt = function (x, z) {
    if (RJ.carrier && RJ.carrier.site && RJ.carrier.onDeck(x, z)) return false;
    if (RJ.realms && RJ.realms.diveAt(x, z)) return false;
    if (RJ.atlas && RJ.atlas.built && RJ.atlas.waterAt(x, z)) return true;
    const f = gen.fields(x, z);
    return f.h < 0.5 || (f.wl > -1e8 && f.wl > f.h);
  };

  W.updateChunks = function (pos, budgetMs) {
    const cx0 = Math.round(pos.x / W.CH), cz0 = Math.round(pos.z / W.CH);
    const R = W.radius;
    for (const [k, ch] of W.chunks) {
      if (Math.max(Math.abs(ch.cx - cx0), Math.abs(ch.cz - cz0)) > R + 1) { disposeChunk(ch); W.chunks.delete(k); }
    }
    let made = 0;
    while (W.ready.length && made < 6) { const d = W.ready.shift(); if (Math.max(Math.abs(d.cx - cx0), Math.abs(d.cz - cz0)) <= R + 1) createChunk(d); made++; }
    const need = [];
    let sea = false;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      const lod = d <= 1 ? 0 : d <= 3 ? 1 : 2;
      const trees = W.Q.treeR > 0 && d <= W.Q.treeR;
      const cx = cx0 + dx, cz = cz0 + dz, k = key(cx, cz);
      const ch = W.chunks.get(k), pend = W.pending.get(k);
      if (ch && ch.sea && d <= 2) sea = true;
      if (pend && pend.lod === lod && pend.trees === trees && pend.sunKey === W.sunKey) continue;
      if (!ch || ch.lod !== lod || ch.trees !== trees) need.push({ cx, cz, lod, trees, d });
      else if (ch.sunKey !== W.sunKey) need.push({ cx, cz, lod, trees, d: d + 20 });
    }
    W.seaNear = sea;
    // nearest ring with a missing chunk: the far terrain fills in there so fast flight never shows a hole
    let miss = R + 1;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (!W.chunks.has(key(cx0 + dx, cz0 + dz))) miss = Math.min(miss, Math.max(Math.abs(dx), Math.abs(dz)));
    W.loadedR = miss > R ? null : Math.max(0, (miss - 0.5) * W.CH - Math.max(Math.abs(pos.x - cx0 * W.CH), Math.abs(pos.z - cz0 * W.CH)));
    need.sort((a, b) => a.d - b.d);
    if (W.workers.length) {
      const cap = W.workers.length * 2;
      for (const it of need) {
        if (W.pending.size >= cap + (it.d <= 1 ? 3 : 0)) break;
        request(it);
      }
    } else {
      const t0 = performance.now();
      for (const it of need) { request(it); if (performance.now() - t0 > budgetMs) break; }
    }
    return need.length + W.pending.size + W.ready.length;
  };

  /** Build every chunk around a point, yielding so a progress bar can paint. */
  W.prepare = async function (pos, onProgress) {
    let total = 0, left = Infinity, guard = 0;
    while (left > 0 && guard++ < 6000) {
      left = W.updateChunks(pos, 40);
      total = Math.max(total, left);
      if (onProgress) onProgress(total ? 1 - left / total : 1);
      if (left > 0) await new Promise((r) => setTimeout(r, W.workers.length ? 16 : 0));
    }
  };

  /* ======================= WATERFALLS ======================= */
  function initWaterfallMat() {
    W.fallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, light: { value: 1 } }]), W.atmoUniforms()),
      vertexShader: ["varying vec2 vUv;", "#include <fog_pars_vertex>", "void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;", "#include <fog_vertex>", "}"].join("\n"),
      fragmentShader: [
        "uniform float time; uniform float light; varying vec2 vUv;",
        GLSL_NOISE,
        "#include <fog_pars_fragment>",
        "void main(){",
        "  float s = vUv.x, t = vUv.y;",
        "  float flow = rjVN(vec2(s * 7.0, t * 9.0 - time * 2.2)) * 0.6 + rjVN(vec2(s * 17.0, t * 26.0 - time * 3.6)) * 0.4;",
        "  float edge = smoothstep(0.0, 0.22, s) * (1.0 - smoothstep(0.78, 1.0, s));",
        "  float a = edge * (0.45 + 0.55 * flow) * 0.9 * smoothstep(0.0, 0.05, t);",
        "  vec3 col = mix(vec3(0.66, 0.76, 0.82), vec3(1.0), flow) * light;",
        "  gl_FragColor = vec4(col, a);",
        "#include <fog_fragment>",
        "}"
      ].join("\n")
    });
  }
  function buildWaterfall(f) {
    const tx = f[0], ty = f[1], tz = f[2], bx = f[3], by = f[4], bz = f[5];
    const len = Math.hypot(bx - tx, bz - tz);
    if (len < 10) return null;
    const dx = (bx - tx) / len, dz = (bz - tz) / len, px = -dz, pz = dx;
    const width = 12 + Math.abs(Math.sin(tx * 0.13)) * 10;
    const K = 14, pos = [], uv = [], idx = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const x = tx + (bx - tx) * t, z = tz + (bz - tz) * t;
      const y = Math.max(gen.height(x, z) + 2.5, by + 0.5, ty + (by - ty) * t);
      for (const s of [-0.5, 0.5]) { pos.push(x + px * width * s, y, z + pz * width * s); uv.push(s + 0.5, t); }
      if (k < K) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, W.fallMat);
    mesh.renderOrder = 3;
    return { mesh, base: RJ.V3(bx, by + 2, bz), top: RJ.V3(tx, ty, tz), width, t: Math.random() };
  }

  /* ======================= REGIONS & AIRBASE ======================= */
  const regionCache = {};
  const REGION_TEST = {
    mountains: (f) => f.mtn > 0.7 && f.land > 0.95 && f.canyon > 0.5 && f.wl < -1e8,
    canyon: (f) => f.dry > 0.55 && f.canyon > 0.92 && f.land > 0.97,
    desert: (f) => f.dry > 0.75 && f.land > 0.97 && f.canyon < 0.2,
    ocean: (f) => f.land < 0.03,
    forest: (f) => f.dry < 0.05 && f.mtn < 0.35 && f.land > 0.97 && f.h > 120 && f.h < 700,
    clouds: (f) => f.mtn > 0.6 && f.land > 0.95
  };
  W.findRegion = function (type) {
    if (type === "nyc" && RJ.nyc) { const s = RJ.nyc.spawn(); return { x: s.x, z: s.z, yaw: s.yaw, alt: s.alt }; }
    if (type === "sf" && RJ.sf) return RJ.sf.spawn();
    if (type === "ye" && RJ.ye && RJ.ye.spawn()) return RJ.ye.spawn();
    if (RJ.cities && RJ.cities.SPEC[type]) { const s = RJ.cities.spawn(type); if (s) { RJ.cities.ensure(type); return s; } }
    if (regionCache[type]) return regionCache[type];
    const test = REGION_TEST[type] || REGION_TEST.mountains;
    const step = type === "canyon" ? 600 : 1500;
    let best = null;
    let x = 0, z = 0, dx = 1, dz = 0, segLen = 1, segPassed = 0, turns = 0;
    for (let k = 0; k < 60000 && !best; k++) {
      const f = gen.fields(x * step, z * step);
      if (test(f)) best = { x: x * step, z: z * step, f };
      x += dx; z += dz; segPassed++;
      if (segPassed === segLen) { segPassed = 0; const t = dx; dx = -dz; dz = t; turns++; if (turns % 2 === 0) segLen++; }
    }
    if (!best) best = { x: 0, z: 0, f: gen.fields(0, 0) };
    let yaw = 0;
    if (type === "canyon" || type === "mountains") {
      const e = 60, cvAt = (a, b) => gen.fields(a, b).cv;
      const gx = cvAt(best.x + e, best.z) - cvAt(best.x - e, best.z), gz = cvAt(best.x, best.z + e) - cvAt(best.x, best.z - e);
      const dir = RJ.V3(-gz, 0, gx).normalize();
      yaw = Math.atan2(-dir.x, -dir.z);
    } else yaw = Math.random() * Math.PI * 2;
    regionCache[type] = { x: best.x, z: best.z, yaw };
    return regionCache[type];
  };

  /** Plan an airbase pad: runway along the valley heading at the valley floor elevation. */
  W.planAirbase = function (x, z, yaw) {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw), len = 3200;
    const hs = [];
    gen.setAirbase(null);
    for (let i = -6; i <= 6; i++) for (const off of [-60, 0, 60, 200]) hs.push(gen.height(x + dx * i * 280 - dz * off, z + dz * i * 280 + dx * off));
    hs.sort((a, b) => a - b);
    const elev = Math.max(8, hs[Math.floor(hs.length * 0.35)]);
    return { x, z, dx, dz, yaw, len, halfW: 330, side: 140, elev };
  };
  /** Castle site {x, z, r, fall, elev, rot}: flattens a summit and builds the fortress on it. */
  W.sites = [];
  /** Replace the landmark terrain sites (plateaus, pads, lakes) and rebuild the terrain. */
  W.setSites = function (list) {
    W.sites = (list || []).concat(W.castle ? [Object.assign({ type: "plateau", kind: "castle" }, W.castle)] : []);
    gen.setSites(W.sites);
    resetChunks(); W.far.center = null;
  };
  W.setCastle = function (c) {
    W.castle = c || null;
    W.sites = W.sites.filter((x) => x.kind !== "castle").concat(c ? [Object.assign({ type: "plateau", kind: "castle" }, c)] : []);
    gen.setSites(W.sites); W.far.center = null;
    if (W.castleGroup) { W.scene.remove(W.castleGroup); RJ.castle.dispose(W.castleGroup); W.castleGroup = null; }
    resetChunks();
    if (c) { W.castleGroup = RJ.castle.build(c); W.scene.add(W.castleGroup); }
  };
  W.setAirbase = function (ab) {
    W.airbase = ab || null;
    gen.setAirbase(W.airbase);
    if (W.airbaseGroup) { W.scene.remove(W.airbaseGroup); W.airbaseGroup = null; }
    resetChunks();
    if (ab) { W.airbaseGroup = buildAirbase(ab); W.scene.add(W.airbaseGroup); W.airbaseLights = W.airbaseGroup.userData.lights; } else W.airbaseLights = null;
  };

  function runwayTexture() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 2048;
    const g = c.getContext("2d");
    g.fillStyle = "#2f3133"; g.fillRect(0, 0, 256, 2048);
    for (let i = 0; i < 9000; i++) { const v = 40 + Math.random() * 30; g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`; g.fillRect(Math.random() * 256, Math.random() * 2048, 2, 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(15,15,15,0.25)"; g.fillRect(100 + Math.random() * 56, Math.random() * 2048, 6 + Math.random() * 10, 40 + Math.random() * 120); }
    // texels are ~0.18 m across but ~1.56 m along the runway, so lengths below are pre-squashed
    g.fillStyle = "#cfcfc8";
    g.fillRect(8, 0, 4, 2048); g.fillRect(244, 0, 4, 2048);
    for (let y = 90; y < 1958; y += 40) g.fillRect(126, y, 4, 22);
    for (const y0 of [8, 2020]) for (let k = 0; k < 8; k++) g.fillRect(24 + k * 27, y0, 14, 20);
    g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    // each number reads upright for the pilot landing over that threshold
    g.save(); g.translate(128, 52); g.scale(1, 0.32); g.rotate(Math.PI); g.fillText("27", 0, 0); g.restore();
    g.save(); g.translate(128, 1996); g.scale(1, 0.32); g.fillText("09", 0, 0); g.restore();
    for (const y0 of [200, 1820]) { g.fillRect(70, y0, 22, 30); g.fillRect(164, y0, 22, 30); }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    return t;
  }
  function buildAirbase(ab) {
    const grp = new THREE.Group();
    grp.position.set(ab.x, ab.elev, ab.z);
    grp.rotation.y = ab.yaw;
    const L = ab.len;
    const mat = (c, r = 0.9, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const flat = (w, l, x, z, y, m) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, l), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; grp.add(p); return p; };
    flat(90, L + 300, 0, 0, 0.15, mat(0x5f6258, 1));
    flat(46, L, 0, 0, 0.35, new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.85 }));
    const tarmac = mat(0x3c3f40, 0.92);
    flat(24, L * 0.8, 160, 0, 0.3, tarmac);
    for (const z of [-L * 0.38, 0, L * 0.38]) flat(140, 22, 80, z, 0.28, tarmac);
    flat(220, 520, 330, 0, 0.26, mat(0x4a4d4e, 0.9));
    // arched hangars
    const hangarMat = mat(0x6e756d, 0.7, 0.35), doorMat = mat(0x3a3d3f, 0.6, 0.4);
    for (let i = 0; i < 4; i++) {
      // half cylinder lying along local X, open end facing the apron
      const h = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 60, 24, 1, false, 0, Math.PI), hangarMat);
      h.rotation.z = Math.PI / 2;
      h.position.set(445, 0, -200 + i * 130); h.castShadow = h.receiveShadow = true; grp.add(h);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(40, 18), doorMat); door.position.set(414.8, 9, -200 + i * 130); door.rotation.y = -Math.PI / 2; grp.add(door);
    }
    // control tower
    const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 32, 9), mat(0xb9b6ad, 0.8)); tower.position.set(300, 16, 300); tower.castShadow = true; grp.add(tower);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 14), new THREE.MeshStandardMaterial({ color: 0x2b4a5c, roughness: 0.05, metalness: 0.9, emissive: 0x0c1c24 }));
    cab.position.set(300, 35, 300); grp.add(cab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 16), mat(0x444444)); roof.position.set(300, 38.6, 300); grp.add(roof);
    for (let i = 0; i < 3; i++) { const tk = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 12, 20), mat(0xd8d8d0, 0.6, 0.3)); tk.position.set(420 + i * 24, 6, 420); tk.castShadow = true; grp.add(tk); }
    // runway edge, threshold and approach lights
    const lightsP = [], lightsC = [];
    for (let z = -L / 2; z <= L / 2; z += 60) for (const x of [-24, 24]) { lightsP.push(x, 0.8, z); lightsC.push(1, 0.92, 0.7); }
    for (let x = -22; x <= 22; x += 4) { lightsP.push(x, 0.8, L / 2 + 2); lightsC.push(0.3, 1, 0.4); lightsP.push(x, 0.8, -L / 2 - 2); lightsC.push(1, 0.25, 0.2); }
    for (let k = 1; k <= 14; k++) for (const x of [-6, 0, 6]) { lightsP.push(x, 1.2, L / 2 + 30 * k); lightsC.push(1, 0.95, 0.85); }
    const lg = new THREE.SphereGeometry(0.55, 8, 6);
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const li = new THREE.InstancedMesh(lg, lm, lightsP.length / 3);
    for (let i = 0; i < lightsP.length / 3; i++) {
      _m4.makeTranslation(lightsP[i * 3], lightsP[i * 3 + 1], lightsP[i * 3 + 2]); li.setMatrixAt(i, _m4);
      li.setColorAt(i, _c.setRGB(lightsC[i * 3] * 2.2, lightsC[i * 3 + 1] * 2.2, lightsC[i * 3 + 2] * 2.2));
    }
    grp.add(li);
    grp.userData.lights = li;
    // parked aircraft on the apron
    if (RJ.buildAircraft) {
      ["f15c", "f16", "fa18e"].forEach((id, i) => {
        try {
          const m = RJ.buildAircraft(id);
          const d = m.userData.dims;
          m.position.set(300 + (i - 1) * 55, d.gearH || 2.2, -120);
          m.rotation.y = Math.PI / 2;
          m.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
          m.userData.flames.forEach((f) => { f.flame.visible = false; f.glow.visible = false; });
          grp.add(m);
        } catch (e) { console.warn(e); }
      });
    }
    grp.updateMatrixWorld(true);
    return grp;
  }

  /* ======================= FAR HORIZON ======================= */
  // A coarse terrain ring out to ~50 km, rendered first with its own long-range camera (with the sky),
  // then the depth buffer is cleared and the detailed world drawn on top. Distant ranges fade into
  // the same height fog as the near terrain, so the world reads as enormous instead of ending in a wall.
  W.BACK = 2; // render layer: sky dome + far terrain
  W.far = { mesh: null, center: null, pending: false, reqId: 0 };
  function initFar() {
    W.farMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) },
        skyAmb: { value: new THREE.Color(0.4, 0.5, 0.6) }, gndAmb: { value: new THREE.Color(0.2, 0.2, 0.2) },
        fogCol: { value: new THREE.Color(0.7, 0.8, 0.9) }, hole: { value: 10000 }
      }, W.atmoUniforms()),
      vertexShader: "varying vec3 vC; varying vec3 vN; varying vec3 vW; " + W.GLSL_CURVE + " void main(){ vC = color; vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; mv.xyz = rjCurve(mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader: [
        "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyAmb; uniform vec3 gndAmb; uniform vec3 fogCol; uniform float hole;",
        "uniform vec3 fogSunDir; uniform vec3 fogSunCol; uniform vec4 fogParams;",
        "varying vec3 vC; varying vec3 vN; varying vec3 vW;",
        "void main(){",
        "  if (length(vW.xz - cameraPosition.xz) < hole) discard;",
        "  vec3 n = normalize(vN);",
        "  vec3 col = vC * (sunCol * max(dot(n, sunDir), 0.0) * 0.9 + mix(gndAmb, skyAmb, n.y * 0.5 + 0.5));",
        "  vec3 D = vW - cameraPosition; float L = length(D); vec3 N = D / L;",
        "  float Hs = max(fogParams.y, 1.0); float e0 = exp(-max(cameraPosition.y, 0.0) / Hs), e1 = exp(-max(vW.y, 0.0) / Hs);",
        "  float K = abs(D.y) > 1.0 ? (e0 - e1) * Hs / D.y : e0;",
        // distant ranges always keep some aerial haze, even their high summits
        "  float f = 1.0 - exp(-fogParams.x * L * max(K, 0.0));",
        // beyond the detailed world, extra aerial perspective so distant ranges recede
        "  f = max(f, smoothstep(14000.0, 70000.0, L) * 0.75);",
        "  float sg = pow(max(dot(N, fogSunDir), 0.0), 8.0) * fogParams.z;",
        "  gl_FragColor = vec4(mix(col, fogCol + fogSunCol * sg, clamp(f, 0.0, 1.0)), 1.0);",
        "}"
      ].join("\n"),
      vertexColors: true
    });
    W.farCam = new THREE.PerspectiveCamera(60, 1, 200, 900000);
    // the ultra-far ring shares every uniform with the far ring except its own hole
    W.far2Mat = W.farMat.clone(); W.far2Mat.uniforms = Object.assign({}, W.farMat.uniforms, { hole: { value: 40000 } });
    W.farCam.layers.set(W.BACK);
  }
  W.far2 = { mesh: null, center: null, pending: false, reqId: 0 };
  function applyFar(d) {
    if (d.ring === 2) {
      if (d.reqId !== W.far2.reqId) return;
      W.far2.pending = false;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(d.pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(d.nor, 3)); geo.setAttribute("color", new THREE.BufferAttribute(d.col, 3));
      geo.setIndex(new THREE.BufferAttribute(d.index, 1));
      if (W.far2.mesh) { W.scene.remove(W.far2.mesh); W.far2.mesh.geometry.dispose(); }
      const m = new THREE.Mesh(geo, W.far2Mat); m.position.set(d.cx, 0, d.cz); m.frustumCulled = false; m.renderOrder = -6; m.layers.set(W.BACK);
      W.scene.add(m); W.far2.mesh = m; return;
    }
    if (d.reqId !== W.far.reqId) return;
    W.far.pending = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(d.nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(d.col, 3));
    geo.setIndex(new THREE.BufferAttribute(d.index, 1));
    if (W.far.mesh) { W.scene.remove(W.far.mesh); W.far.mesh.geometry.dispose(); }
    const m = new THREE.Mesh(geo, W.farMat);
    m.position.set(d.cx, 0, d.cz); m.frustumCulled = false; m.renderOrder = -5;
    m.layers.set(W.BACK);
    W.scene.add(m);
    W.far.mesh = m;
  }
  function updateFar(cam) {
    if (!W.workers.length) return;
    // ultra-far ring: 150 × 5.2 km cells (≈ 390 km radius), rebuilt every 60 km, for the view from altitude
    const c2 = W.far2.center, p2 = cam.position;
    if (!W.far2.pending && (!c2 || Math.hypot(p2.x - c2.x, p2.z - c2.z) > 60000) && (!W.far.pending)) {
      const st = 5200, cx = Math.round(p2.x / st) * st, cz = Math.round(p2.z / st) * st;
      W.far2.center = { x: cx, z: cz }; W.far2.pending = true;
      let best = W.workers[0]; for (const s of W.workers) if (s.busy < best.busy) best = s;
      best.busy++; best.w.postMessage({ type: "far", ring: 2, n: 150, spacing: st, cx, cz, ab: W.airbase || null, sites: W.sites, reqId: ++W.far2.reqId });
    }
    if (W.far.pending) return;
    const c = W.far.center, p = cam.position;
    if (c && Math.hypot(p.x - c.x, p.z - c.z) < 4500) return;
    const step = 2500, cx = Math.round(p.x / step) * step, cz = Math.round(p.z / step) * step;
    W.far.center = { x: cx, z: cz };
    W.far.pending = true;
    const req = { type: "far", n: W.Q.farN || 150, spacing: W.Q.farSpacing || 650, cx, cz, ab: W.airbase || null, sites: W.sites, reqId: ++W.far.reqId };
    let best = W.workers[0];
    for (const s of W.workers) if (s.busy < best.busy) best = s;
    best.busy++;
    best.w.postMessage(req);
  }
  /** Sky + distant terrain with a long-range camera; leaves color, clears depth. */
  W.renderBackdrop = function (renderer, camera) {
    const fc = W.farCam;
    fc.position.copy(camera.position); fc.quaternion.copy(camera.quaternion);
    fc.fov = camera.fov; fc.aspect = camera.aspect; fc.near = Math.max(40, Math.min(W.viewRange * 0.5, W.loadedR != null ? W.loadedR * 0.6 : 1e9));
    if (camera.view && camera.view.enabled) fc.setViewOffset(camera.view.fullWidth, camera.view.fullHeight, camera.view.offsetX, camera.view.offsetY, camera.view.width, camera.view.height); else fc.clearViewOffset();
    fc.updateProjectionMatrix(); fc.updateMatrixWorld();
    W.farMat.uniforms.hole.value = Math.min(W.viewRange * 0.78, W.loadedR != null ? W.loadedR : 1e9);
    W.farMat.uniforms.fogCol.value.copy(W.scene.fog.color);
    W.far2Mat.uniforms.hole.value = W.far.mesh ? (W.Q.farN || 150) * (W.Q.farSpacing || 650) * 0.46 : 0;
    renderer.render(W.scene, fc);
    renderer.clearDepth();
  };

  W.buildAirbaseGroup = (ab) => buildAirbase(ab);

  /* ======================= PHYSICAL ATMOSPHERE =======================
   * Single-scattering Rayleigh + Mie + ozone absorption through a spherical atmosphere (Earth radius, 8 km /
   * 1.2 km scale heights). The sky shader evaluates it per pixel; the same model in JS sets the fog, ambient
   * and sunlight colours so terrain, water and clouds always match the sky above them. */
  const ATM_GLSL = [
    "const float A_R0 = 6360e3; const float A_RA = 6460e3; const vec3 A_BR = vec3(5.8e-6, 13.5e-6, 33.1e-6); const vec3 A_BO = vec3(0.65e-6, 1.881e-6, 0.085e-6);",
    "vec2 aRsi(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r * r, D = b * b - c; if (D < 0.0) return vec2(1e9, -1e9); D = sqrt(D); return vec2(-b - D, -b + D); }",
    "float aOzo(float h){ return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }",
    "vec3 atmos(float alt, vec3 d, vec3 s, float bm){",
    "  vec3 o = vec3(0.0, A_R0 + max(alt, 1.0), 0.0);",
    "  vec2 a = aRsi(o, d, A_RA); float tmax = a.y; vec2 g = aRsi(o, d, A_R0); if (g.x > 0.0) tmax = min(tmax, g.x);",
    "  float tmin = max(a.x, 0.0); if (tmax <= tmin) return vec3(0.0);",
    "  vec3 sR = vec3(0.0), sM = vec3(0.0); float oR = 0.0, oM = 0.0, oO = 0.0;",
    "  float mu = dot(d, s); float pR = 0.0597 * (1.0 + mu * mu); float gg = 0.8;",
    "  float pM = 0.1194 * ((1.0 - gg * gg) * (1.0 + mu * mu)) / ((2.0 + gg * gg) * pow(1.0 + gg * gg - 2.0 * gg * mu, 1.5));",
    "  float tp = tmin;",
    "  for (int i = 0; i < 12; i++) {",
    "    float f1 = float(i + 1) / 12.0; float t1 = tmin + (tmax - tmin) * f1 * f1; float ds = t1 - tp; float t = 0.5 * (tp + t1); tp = t1;",
    "    vec3 p = o + d * t; float h = length(p) - A_R0; float hr = exp(-h / 8000.0) * ds, hm = exp(-h / 1200.0) * ds;",
    "    oR += hr; oM += hm; oO += aOzo(h) * ds;",
    "    vec2 l = aRsi(p, s, A_RA); float dl = l.y / 4.0; float lR = 0.0, lM = 0.0, lO = 0.0; bool ok = true;",
    "    for (int j = 0; j < 4; j++) { vec3 q = p + s * (dl * (float(j) + 0.5)); float hl = length(q) - A_R0; if (hl < 0.0) { ok = false; break; } lR += exp(-hl / 8000.0) * dl; lM += exp(-hl / 1200.0) * dl; lO += aOzo(hl) * dl; }",
    "    if (ok) { vec3 T = exp(-(A_BR * (oR + lR) + bm * 1.1 * (oM + lM) + A_BO * (oO + lO))); sR += T * hr; sM += T * hm; }",
    "  }",
    "  return 20.0 * (sR * A_BR * pR + sM * bm * pM);",
    "}"
  ].join("\n");
  W.ATM_GLSL = ATM_GLSL;
  const A_R0 = 6360e3, A_RA = 6460e3, A_BR = [5.8e-6, 13.5e-6, 33.1e-6], A_BO = [0.65e-6, 1.881e-6, 0.085e-6];
  function aRsi(o, d, r) { const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r, D = b * b - c; if (D < 0) return [1e9, -1e9]; const q = Math.sqrt(D); return [-b - q, -b + q]; }
  const aOzo = (h) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  /** JS twin of the sky shader's atmos(): radiance [r,g,b] seen from altitude alt looking along d with the sun along s. */
  W.atmos = function (alt, d, s, bm) {
    const o = [0, A_R0 + Math.max(alt, 1), 0], a = aRsi(o, d, A_RA), g = aRsi(o, d, A_R0);
    let tmax = a[1]; if (g[0] > 0) tmax = Math.min(tmax, g[0]);
    const tmin = Math.max(a[0], 0), sR = [0, 0, 0], sM = [0, 0, 0];
    if (tmax <= tmin) return sR;
    let oR = 0, oM = 0, oO = 0, tp = tmin;
    const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], pR = 0.0597 * (1 + mu * mu), gg = 0.8;
    const pM = 0.1194 * ((1 - gg * gg) * (1 + mu * mu)) / ((2 + gg * gg) * Math.pow(1 + gg * gg - 2 * gg * mu, 1.5));
    for (let i = 0; i < 12; i++) {
      const f1 = (i + 1) / 12, t1 = tmin + (tmax - tmin) * f1 * f1, ds = t1 - tp, t = 0.5 * (tp + t1); tp = t1;
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], h = Math.hypot(p[0], p[1], p[2]) - A_R0;
      const hr = Math.exp(-h / 8000) * ds, hm = Math.exp(-h / 1200) * ds;
      oR += hr; oM += hm; oO += aOzo(h) * ds;
      const l = aRsi(p, s, A_RA), dl = l[1] / 4;
      let lR = 0, lM = 0, lO = 0, ok = true;
      for (let j = 0; j < 4; j++) { const tt = dl * (j + 0.5), q = [p[0] + s[0] * tt, p[1] + s[1] * tt, p[2] + s[2] * tt], hl = Math.hypot(q[0], q[1], q[2]) - A_R0; if (hl < 0) { ok = false; break; } lR += Math.exp(-hl / 8000) * dl; lM += Math.exp(-hl / 1200) * dl; lO += aOzo(hl) * dl; }
      if (ok) for (let k = 0; k < 3; k++) { const T = Math.exp(-(A_BR[k] * (oR + lR) + bm * 1.1 * (oM + lM) + A_BO[k] * (oO + lO))); sR[k] += T * hr; sM[k] += T * hm; }
    }
    return [0, 1, 2].map((k) => 20 * (sR[k] * A_BR[k] * pR + sM[k] * bm * pM));
  };
  /** Colour of sunlight after the trip down through the atmosphere (normalised so the brightest channel is 1). */
  W.sunTransmit = function (s, bm, alt = 10, raw = false) {
    const o = [0, A_R0 + alt, 0], l = aRsi(o, s, A_RA);
    if (aRsi(o, s, A_R0)[0] > 0) return [0, 0, 0];
    const dl = l[1] / 16; let lR = 0, lM = 0, lO = 0;
    for (let j = 0; j < 16; j++) { const tt = dl * (j + 0.5), q = [s[0] * tt, A_R0 + alt + s[1] * tt, s[2] * tt], hl = Math.hypot(q[0], q[1], q[2]) - A_R0; lR += Math.exp(-hl / 8000) * dl; lM += Math.exp(-hl / 1200) * dl; lO += aOzo(hl) * dl; }
    const T = [0, 1, 2].map((k) => Math.exp(-(A_BR[k] * lR + bm * 1.1 * lM + A_BO[k] * lO)));
    if (raw) return T;
    const m = Math.max(T[0], T[1], T[2], 1e-6);
    return T.map((v) => v / m);
  };

  /* ======================= SKY ======================= */
  function initSky() {
    W.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color() }, alt: { value: 0 }, haze: { value: 0 }, flash: { value: 0 }, time: { value: 0 },
        night: { value: 0 }, cirrus: { value: 0.5 }, envPass: { value: 0 }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, ground: { value: new THREE.Color(0.18, 0.2, 0.18) },
        physW: { value: 1 }, physK: { value: 1.2 }, mieB: { value: 7e-6 }, gray: { value: 0 }, dark: { value: 0 }, alto: { value: 0 }
      },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
      fragmentShader: [
        "uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 ground;",
        "uniform float alt; uniform float haze; uniform float flash; uniform float time; uniform float night; uniform float cirrus; uniform float envPass; uniform vec3 moonDir;",
        "uniform float physW; uniform float physK; uniform float mieB; uniform float gray; uniform float dark; uniform float alto;",
        "varying vec3 vDir;",
        GLSL_NOISE,
        ATM_GLSL,
        "void main(){",
        "  vec3 d = normalize(vDir); float h = d.y; vec3 sd = normalize(sunDir);",
        "  float space = clamp((alt - 12000.0) / 28000.0, 0.0, 1.0);",
        "  vec3 topC = mix(top, vec3(0.01, 0.02, 0.06), space);",
        "  float hh = max(h, 0.0);",
        "  vec3 c = mix(horizon, topC, pow(hh, mix(0.45, 0.22, space)));",
        "  vec2 dh = normalize(d.xz + vec2(1e-5)); vec2 sh = normalize(sd.xz + vec2(1e-5));",
        "  float az = dot(dh, sh);",
        "  float lowSun = 1.0 - smoothstep(0.0, 0.4, sd.y);",
        "  float alive = smoothstep(-0.12, 0.02, sd.y);",
        // warm sunset glow wrapping the horizon toward the sun
        "  c += sunCol * vec3(1.0, 0.5, 0.22) * pow(max(az, 0.0), 3.0) * exp(-hh * 5.0) * lowSun * alive * 0.55;",
        // belt of Venus: pink-purple band opposite the low sun
        "  c += vec3(0.42, 0.22, 0.38) * pow(max(-az, 0.0), 2.0) * exp(-abs(h - 0.07) * 13.0) * lowSun * alive * 0.5;",
        // physically based sky (day and twilight); the hand-tuned gradient above only remains for deep night
        "  if (physW > 0.001) {",
        "    vec3 pd = normalize(vec3(d.x, max(d.y, -0.02), d.z));",
        "    vec3 ph = atmos(alt, pd, sd, mieB) * physK;",
        // single scattering misses the multiply-scattered light that whitens a daytime horizon; add it back,
        // then a soft knee so the glare around a low sun keeps its colour instead of clipping to white
        "    float pl = dot(ph, vec3(0.3, 0.59, 0.11));",
        "    ph = mix(ph, vec3(pl), 0.32 * smoothstep(0.09, 0.5, sd.y) * (1.0 - smoothstep(-0.05, 0.35, pd.y)));",
        "    ph /= 1.0 + 0.18 * max(pl - 1.0, 0.0);",
        // keep green from dominating (single scattering over long low-sun paths drifts olive; real skies don't)
        "    ph.g = min(ph.g, max(ph.r, ph.b) * 1.02);",
        "    ph = mix(ph, vec3(dot(ph, vec3(0.3, 0.59, 0.11))), gray) * (1.0 - dark * 0.55);",
        "    c = c * (1.0 - physW) + ph * mix(physW, 1.0, step(0.0, sd.y));",
        "  }",
        // ground below the horizon (mostly hidden; matters for reflections)
        "  c = mix(c, mix(horizon * 0.7, ground, 0.5), 1.0 - smoothstep(-0.25, 0.0, h));",
        // Mie halo and HDR sun disc
        "  float s = max(dot(d, sd), 0.0);",
        "  float g = 0.78; float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * s, 1.5);",
        "  c += sunCol * mie * 0.028 * (1.0 - haze * 0.65) * alive * (1.0 - physW * 0.6);",
        "  float sr = acos(clamp(dot(d, sd), -1.0, 1.0)) / 0.0048; float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - sr * sr, 0.0)));",
        "  c += sunCol * (1.0 - smoothstep(0.85, 1.0, sr)) * limb * 8.0 * (1.0 - haze * 0.9) * alive * (1.0 - envPass);", // the sun light itself already adds the glint
        // cirrus: wispy high clouds on a dome
        "  if (h > 0.0 && cirrus > 0.01) {",
        "    vec2 uv = d.xz / (h + 0.06) * 0.55 + vec2(time * 0.004, time * 0.0015);",
        "    float n = rjFbm(uv * vec2(1.0, 3.2)) * 0.75 + rjFbm(uv * 4.0) * 0.25;",
        "    float wisp = smoothstep(0.5, 0.82, n) * cirrus * smoothstep(0.0, 0.18, h) * (1.0 - space);",
        "    vec3 cc = mix(horizon * 1.05, vec3(1.0), 0.55) * (0.35 + 0.65 * alive) + sunCol * pow(s, 5.0) * 0.8 + sunCol * vec3(1.0, 0.55, 0.3) * lowSun * 0.25 * alive;",
        "    c = mix(c, cc, wisp * 0.75);",
        "  }",
        // altocumulus at ~6 km: a dappled "mackerel sky" of small cloudlets, white by day, pink and gold at sunset
        "  if (h > 0.0 && alto > 0.01) {",
        "    vec2 au = d.xz / (h + 0.09) * 1.6 + vec2(time * 0.006, time * 0.002);",
        "    float big = rjFbm(au * 0.35 + 3.7);",
        "    float cells = rjVN(au * 9.0) * 0.6 + rjVN(au * 21.0) * 0.4;",
        "    float ac = smoothstep(0.55, 0.85, cells * smoothstep(0.42, 0.72, big) * 1.35) * alto * smoothstep(0.02, 0.2, h) * (1.0 - space);",
        "    vec3 base = mix(horizon, vec3(dot(horizon, vec3(0.3, 0.59, 0.11)) * 1.25), 0.5) * (0.35 + 0.65 * alive);",
        "    vec3 lit = sunCol * vec3(1.0, 0.62, 0.5) * lowSun * 0.9 + sunCol * pow(s, 6.0) * 0.6;",
        "    vec3 ss = base * (0.85 + 0.3 * cells) + lit;",
        "    c = mix(c, ss, ac * 0.8);",
        "  }",
        // stars
        // stars: at night, and in daylight too once the air above you thins out (from ~15 km)
        "  float starVis = max(night, smoothstep(0.1, 0.7, space) * (1.0 - envPass) * (1.0 - smoothstep(0.96, 0.995, s)));",
        "  if (starVis > 0.01 && h > -0.05) {",
        "    vec2 g2 = floor(vec2(atan(d.z, d.x) * 260.0, asin(clamp(h, -0.05, 1.0)) * 260.0));",
        "    float st = step(0.9965, rjH(g2)) * starVis * smoothstep(mix(0.0, -0.05, space), mix(0.25, 0.05, space), h);",
        "    c += vec3(st) * (0.6 + 0.4 * rjH(g2 + 7.0));",
        "  }",
        // moon: disc with soft halo
        "  if (night > 0.01) { float mc = dot(d, normalize(moonDir));",
        "    c += vec3(0.92, 0.94, 1.0) * smoothstep(0.99935, 0.99965, mc) * night * 2.2 * (1.0 - envPass * 0.7);",
        "    c += vec3(0.22, 0.28, 0.42) * pow(max(mc, 0.0), 60.0) * night * 0.35 + vec3(0.05, 0.07, 0.12) * pow(max(mc, 0.0), 6.0) * night; }",
        "  c = mix(c, vec3(0.85, 0.88, 1.0), flash);",
        "  gl_FragColor = linearToOutputTexel(vec4(c, 1.0));",
        "}"
      ].join("\n")
    });
    W.skyGeo = new THREE.SphereGeometry(1, 48, 24);
    W.skyMesh = new THREE.Mesh(W.skyGeo, W.skyMat);
    W.skyMesh.frustumCulled = false; W.skyMesh.renderOrder = -10; W.skyMesh.layers.set(W.BACK);
    W.scene.add(W.skyMesh);
    // environment-map scene: the same sky, captured with PMREM for image-based lighting/reflections
    W.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(W.skyGeo, W.skyMat); envSky.scale.setScalar(10); envSky.frustumCulled = false;
    W.envScene.add(envSky);
  }
  W.updateEnv = function () {
    try {
      if (!W.pmrem) W.pmrem = new THREE.PMREMGenerator(W.renderer);
      W.skyMat.uniforms.envPass.value = 1;
      const rt = W.pmrem.fromScene(W.envScene, 0.02, 0.1, 100);
      W.skyMat.uniforms.envPass.value = 0;
      if (W.envRT) W.envRT.dispose();
      W.envRT = rt;
      W.scene.environment = rt.texture;
    } catch (e) { W.skyMat.uniforms.envPass.value = 0; console.warn("Environment map unavailable", e); }
  };

  /* Time-of-day keyframes by sun elevation (deg) */
  const TOD = [
    { e: -16, top: [0.008, 0.014, 0.04], hor: [0.05, 0.065, 0.12], sun: [0.62, 0.7, 0.95], si: 0.26, hs: [0.2, 0.25, 0.42], hg: [0.05, 0.055, 0.07], hi: 0.55 },
    { e: -10, top: [0.010, 0.016, 0.045], hor: [0.06, 0.07, 0.13], sun: [0.6, 0.66, 0.9], si: 0.2, hs: [0.18, 0.21, 0.36], hg: [0.045, 0.045, 0.06], hi: 0.5 },
    { e: -4, top: [0.04, 0.06, 0.15], hor: [0.32, 0.22, 0.32], sun: [1.0, 0.42, 0.25], si: 0.12, hs: [0.2, 0.2, 0.34], hg: [0.08, 0.08, 0.1], hi: 0.35 },
    { e: 1, top: [0.17, 0.22, 0.46], hor: [1.0, 0.50, 0.28], sun: [1.0, 0.50, 0.26], si: 0.7, hs: [0.62, 0.50, 0.56], hg: [0.25, 0.2, 0.2], hi: 0.5 },
    { e: 8, top: [0.21, 0.37, 0.72], hor: [0.98, 0.72, 0.52], sun: [1.0, 0.77, 0.55], si: 0.98, hs: [0.72, 0.72, 0.82], hg: [0.32, 0.3, 0.24], hi: 0.55 },
    { e: 25, top: [0.19, 0.43, 0.84], hor: [0.72, 0.83, 0.93], sun: [1.0, 0.95, 0.87], si: 1.08, hs: [0.80, 0.88, 1.0], hg: [0.32, 0.34, 0.26], hi: 0.6 },
    { e: 70, top: [0.14, 0.39, 0.85], hor: [0.68, 0.82, 0.95], sun: [1.0, 1.0, 0.97], si: 1.15, hs: [0.82, 0.9, 1.0], hg: [0.34, 0.36, 0.28], hi: 0.62 }
  ];
  W.TIMES = {
    dawn: { label: "Sunrise", e: 3.5, az: 95, haze: 1.6, hour: 5.35 },
    morning: { label: "Morning", e: 24, az: 120, haze: 1.2, hour: 8 },
    noon: { label: "Noon", e: 62, az: 175, haze: 1.0, hour: 12.2 },
    afternoon: { label: "Afternoon", e: 40, az: 245, haze: 1.1, hour: 15.5 },
    golden: { label: "Golden hour", e: 10, az: 245, haze: 1.15, hour: 18.1 },
    sunset: { label: "Sunset", e: 1.8, az: 262, haze: 1.35, hour: 18.95 },
    night: { label: "Night", e: -16, az: 230, haze: 1.05, hour: 22 },
    dynamic: { label: "Dynamic", e: 6, az: 90, dynamic: true, haze: 1.2, hour: 5.35 }
  };
  /* ---------------- the clock: a continuous day/night cycle (Free Flight) ----------------
   * Solar geometry for a mid-latitude summer day (38° N, day 200: sunrise ~04:55, sunset ~19:15 solar time).
   * rate = game seconds per real second; the default 26× turns 30 minutes of flying into 13 hours of day. */
  W.clock = { h: 12, rate: 26, run: true, lat: 38, day: 200 };
  W.solar = function (h, out) {
    const C = W.clock, D = RJ.DEG, phi = C.lat * D, dec = 23.44 * D * Math.sin((2 * Math.PI * (284 + C.day)) / 365);
    const H = (h - 12) * 15 * D;
    const se = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H), e = Math.asin(RJ.clamp(se, -1, 1));
    // azimuth from north, clockwise (east = 90°): north is -z and east +x in this world
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
    out = out || {}; out.e = e / D; out.az = ((az / D) % 360 + 360) % 360; return out;
  };
  W.clockText = () => { const h = ((W.clock.h % 24) + 24) % 24, m = Math.floor((h % 1) * 60); return String(Math.floor(h)).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
  const _sol = {}, _moon = {};
  function clockSun() {
    W.solar(W.clock.h, _sol); W.sunElev = _sol.e; W.sunAz = _sol.az;
    // a nearly full moon, opposite the sun and a little behind it; kept above 15° as the night key light
    W.solar(W.clock.h + 10.4, _moon); W._moonE = Math.max(15, _moon.e); W._moonAz = _moon.az;
    // daily temperature swing (coolest at dawn, warmest mid-afternoon): nudges the speed of sound
    RJ.tempOffset = (W._tempBase || 0) + 6 * Math.sin(((W.clock.h - 9) / 24) * 2 * Math.PI) - 1;
  }
  W.WEATHER = {
    clear: { label: "Clear", alto: 0.25,  clusters: 40, alt: [5200, 6400], thick: 0.35, dark: 0, fog: 1, sun: 1, haze: 0, density: 6e-5, cirrus: 0.75, mist: 0.25, humid: 0.3, wind: 4 },
    scattered: { label: "Scattered clouds", alto: 0.55,  clusters: 170, alt: [2300, 3300], thick: 1, dark: 0.04, fog: 1, sun: 1, haze: 0.05, density: 9e-5, cirrus: 0.5, mist: 0.7, humid: 0.55, wind: 7 },
    overcast: { label: "Overcast", clusters: 380, alt: [2400, 3500], thick: 1.5, dark: 0.32, fog: 0.85, sun: 0.5, haze: 0.6, gray: 0.55, density: 1.8e-4, cirrus: 0.1, mist: 1, humid: 0.8, stratus: 0.8, wind: 10 },
    storm: { label: "Storm", clusters: 440, alt: [1500, 3600], thick: 1.8, dark: 0.6, fog: 0.7, sun: 0.28, haze: 0.9, gray: 0.75, rain: true, lightning: true, density: 3.4e-4, cirrus: 0, mist: 1, humid: 1, towers: 9, stratus: 1, wind: 16 },
    cloudsea: { label: "Cloud sea", alto: 0.35,  clusters: 520, alt: [1700, 2500], thick: 1.6, dark: 0.06, fog: 1, sun: 1, haze: 0.05, sea: true, density: 7e-5, cirrus: 0.65, mist: 0.6, humid: 0.7, stratus: 0.6, wind: 6 }
  };
  // extended presets: built on the base ones. rain = intensity 0..1, bolts = [min, max] s between strikes,
  // gust = gust strength (m/s), turb = extra convective turbulence, temp = air temperature offset
  {
    const B = W.WEATHER, X = (base, o) => Object.assign({}, B[base], o);
    B.storm.rain = 0.75; B.storm.bolts = [5, 14]; B.storm.gust = 7; B.storm.turb = 0.5; B.storm.temp = -6;
    B.overcast.temp = -3; B.cloudsea.temp = -2;
    B.lightrain = X("overcast", { label: "Light rain", rain: 0.3, dark: 0.38, haze: 0.7, density: 2.2e-4, gust: 3, temp: -4 });
    B.heavyrain = X("overcast", { label: "Heavy rain", rain: 0.85, dark: 0.5, sun: 0.35, haze: 0.85, gray: 0.7, density: 3.6e-4, gust: 6, turb: 0.25, wind: 12, temp: -5, bolts: [25, 60] });
    B.thunder = X("storm", { label: "Thunderstorm", rain: 0.9, bolts: [3, 9], gust: 10, turb: 0.8, wind: 14 });
    B.supercell = X("storm", { label: "Extreme supercell", rain: 1, dark: 0.5, sun: 0.45, haze: 0.45, density: 1.5e-4, gray: 0.5, clusters: 300, bolts: [1.2, 4], gust: 16, turb: 1.3, wind: 18, temp: -8 });
    B.squall = X("storm", { label: "Squall line", rain: 0.95, dark: 0.55, bolts: [2, 6], gust: 14, turb: 1, wind: 20, squall: true });
    B.windstorm = X("scattered", { label: "Windstorm", wind: 32, gust: 18, turb: 0.9, haze: 0.35, density: 1.4e-4, dark: 0.1, mist: 0.4 });
    B.fog = X("overcast", { label: "Fog", alt: [120, 650], density: 1.6e-3, haze: 1, dark: 0.2, sun: 0.55, gray: 0.6, wind: 2, temp: -2, fogDeck: true });
  }
  /** Weather order shown in menus; "dynamic" is handled by RJ.weather (it changes the weather over time). */
  W.WEATHER_MENU = ["clear", "scattered", "overcast", "lightrain", "heavyrain", "thunder", "supercell", "squall", "windstorm", "fog"];
  /** The weather used for lighting and physics this frame: a blend while a transition is running. */
  W.wx = () => W.wxMix || W.WEATHER[W.env && W.env.weather] || W.WEATHER.scattered;

  function todAt(e) {
    let a = TOD[0], b = TOD[TOD.length - 1];
    for (let i = 0; i < TOD.length - 1; i++) if (e >= TOD[i].e && e <= TOD[i + 1].e) { a = TOD[i]; b = TOD[i + 1]; break; }
    if (e < TOD[0].e) b = a; if (e > b.e) a = b;
    const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
    const L = (p, q) => p.map((v, i) => v + (q[i] - v) * t);
    return { top: L(a.top, b.top), hor: L(a.hor, b.hor), sun: L(a.sun, b.sun), si: a.si + (b.si - a.si) * t, hs: L(a.hs, b.hs), hg: L(a.hg, b.hg), hi: a.hi + (b.hi - a.hi) * t };
  }

  W.setEnvironment = function (env) {
    const prevW = W.env && W.env.weather;
    W.env = Object.assign({ time: "golden", weather: "scattered" }, env);
    // "dynamic" weather: RJ.weather picks a starting sky and changes it over time
    W.wxMix = null;
    if (RJ.weather) W.env.weather = RJ.weather.onEnvironment(W.env.weather);
    if (RJ.ships) RJ.ships.clear();
    if (RJ.life) RJ.life.clear();
    if (!W.WEATHER[W.env.weather]) W.env.weather = "scattered";
    const T = W.TIMES[W.env.time] || W.TIMES.golden;
    W.sunElev = env.sunElev != null ? env.sunElev : T.e; W.sunAz = env.sunAz != null ? env.sunAz : T.az; W.dynamic = false;
    // a running clock: Free Flight passes { hour, rate }; the old "Dynamic" preset is a cycle from sunrise at 26×
    const cyc = env.sunElev == null ? (env.cycle || (T.dynamic ? { hour: T.hour, rate: 26 } : null)) : null;
    W.cycle = !!cyc;
    if (cyc && cyc !== W.clock) { W.clock.h = cyc.hour != null ? cyc.hour : T.hour; W.clock.rate = cyc.rate || 26; W.clock.run = true; }
    if (cyc) W.env.cycle = W.clock;
    if (RJ.clouds) RJ.clouds.setWeather(W.env.weather);
    // air temperature shifts the speed of sound (cold nights and storms make Mach 1 come a little sooner)
    RJ.tempOffset = ({ night: -9, dawn: -6, morning: -2, noon: 5, afternoon: 4, golden: 1, sunset: -2, dynamic: 0 }[W.env.time] || 0) + ((W.WEATHER[W.env.weather] || {}).temp || 0);
    W._tempBase = (W.WEATHER[W.env.weather] || {}).temp || 0;
    if (W.cycle) clockSun();
    if (W.cloudGeo && (prevW !== W.env.weather || !W.clusters)) buildClouds();
    W.syncCloudLayer();
    applyLighting(true);
  };

  function applyLighting(full) {
    const wx = W.wx();
    const T = W.TIMES[W.env.time] || W.TIMES.golden;
    const e = W.sunElev * RJ.DEG, az = W.sunAz * RJ.DEG;
    W.sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)).normalize();
    // after dusk the key light is the moon, high in the opposite sky
    const me = (W.cycle ? W._moonE : 38) * RJ.DEG, ma = W.cycle ? W._moonAz * RJ.DEG : az + 2.8;
    W.moonDir = (W.moonDir || RJ.V3()).set(Math.sin(ma) * Math.cos(me), Math.sin(me), -Math.cos(ma) * Math.cos(me)).normalize();
    W.night = W.sunElev < -4;
    W.lightDir = (W.lightDir || RJ.V3()).copy(W.night ? W.moonDir : W.sunDir);
    // terrain sun-visibility is baked per chunk: with the clock running, re-bake only once the light has moved 4°
    if (!W.cycle || !W._bakeDir || W._bakeNight !== W.night || W._bakeDir.angleTo(W.lightDir) > 0.07) {
      W.sunKey = (W.night ? "m" : "") + Math.round(W.sunElev / 2) + ":" + Math.round(W.sunAz / 4) + (W.cycle ? ":" + Math.round(W.clock.h * 60) : "");
      W._bakeDir = (W._bakeDir || RJ.V3()).copy(W.lightDir); W._bakeNight = W.night;
    }
    const t = todAt(W.sunElev);
    // daylight and twilight colours come from the physical atmosphere; the keyframes only cover deep night
    const physW = RJ.smooth(-14, -4, W.sunElev), mieB = 9e-6 * (1 + wx.haze * 3), K = 1.2 * (0.8 + 0.2 * RJ.smooth(5, 30, W.sunElev));
    W.physSky = { w: physW, mie: mieB, k: K };
    if (physW <= 0) W.cloudSun = null;
    if (physW > 0) {
      const S = [W.sunDir.x, W.sunDir.y, W.sunDir.z], up = W.atmos(0, [0, 1, 0], S, mieB);
      // same horizon whitening and highlight knee as the sky shader, so fog matches the sky it fades into
      const post = (c, dy) => { const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, w = 0.32 * RJ.smooth(0.09, 0.5, S[1]) * (1 - RJ.smooth(-0.05, 0.35, dy)), kn = 1 + 0.18 * Math.max(l * K - 1, 0); const o = c.map((v) => RJ.lerp(v, l, w) / kn); o[1] = Math.min(o[1], Math.max(o[0], o[2]) * 1.02); return o; };
      const hz = [0, 0, 0];
      // fog colour: the horizon all round, weighted away from the sun (the glare side gets its own sun-glow term in the fog shader)
      const sh = Math.hypot(S[0], S[2]) || 1; let wsum = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, dd = [Math.cos(a) * 0.9986, 0.0523, Math.sin(a) * 0.9986], c = post(W.atmos(0, dd, S, mieB), 0.0523);
        const w = 0.2 + 0.8 * (1 - Math.max(0, (dd[0] * S[0] + dd[2] * S[2]) / sh));
        for (let k = 0; k < 3; k++) hz[k] += c[k] * w; wsum += w;
      }
      for (let k = 0; k < 3; k++) hz[k] /= wsum;
      const tr = W.sunTransmit(S, mieB);
      const cl = RJ.clouds ? RJ.clouds.layer() : null;
      W.cloudSun = W.sunTransmit(S, mieB, cl ? cl.base + (cl.top - cl.base) * 0.4 : 3000, true);
      const mixIn = (arr, ph, w) => arr.map((v, k) => RJ.lerp(v, ph[k], w));
      t.top = mixIn(t.top, up.map((v) => v * K), physW);
      t.hor = mixIn(t.hor, hz.map((v) => Math.min(v * K, 1.4)), physW);
      // sunlight tint: the atmosphere's transmittance, kept a little warm-neutral so terrain never goes neon
      if (W.sunElev > -1) t.sun = mixIn(t.sun, tr.map((v) => 0.25 + 0.75 * v), physW * 0.85);
      t.hs = mixIn(t.hs, up.map((v, k) => (v * K * 1.2 + hz[k] * K * 0.5)), physW * 0.45);
    }
    const gray = wx.gray || 0;
    const g = (arr, k) => { const l = arr[0] * 0.3 + arr[1] * 0.59 + arr[2] * 0.11; return arr.map((v) => RJ.lerp(v, l, k) * (1 - wx.dark * 0.55)); };
    const top = g(t.top, gray), hor = g(t.hor, gray * 0.9);
    const U = W.skyMat.uniforms;
    U.physW.value = physW; U.physK.value = K; U.mieB.value = mieB; U.gray.value = gray; U.dark.value = wx.dark;
    U.top.value.setRGB(...top); U.horizon.value.setRGB(...hor);
    U.sunDir.value.copy(W.sunDir); U.sunCol.value.setRGB(...t.sun); U.moonDir.value.copy(W.moonDir);
    U.haze.value = wx.haze; U.cirrus.value = wx.cirrus; U.alto.value = wx.alto || 0;
    U.night.value = RJ.smooth(2, -8, W.sunElev);
    U.ground.value.setRGB(...t.hg).multiplyScalar(1.6);
    W.horizonColor = new THREE.Color().setRGB(...hor);
    W.baseFog = { color: W.horizonColor.clone(), near: W.workers && W.workers.length ? 1e6 : W.viewRange * 0.62, far: W.workers && W.workers.length ? 2e6 : W.viewRange * 0.98 };
    W.scene.fog.color.copy(W.horizonColor); W.scene.fog.near = W.baseFog.near; W.scene.fog.far = W.baseFog.far;
    W.renderer.setClearColor(W.horizonColor);
    // atmosphere shared uniforms
    ATMO.sunDir.x = W.lightDir.x; ATMO.sunDir.y = W.lightDir.y; ATMO.sunDir.z = W.lightDir.z;
    const glow = (0.35 + 0.65 * RJ.smooth(40, 3, W.sunElev)) * (1 - wx.haze * 0.7) * RJ.smooth(-6, 2, W.sunElev);
    ATMO.sunCol.x = t.sun[0] * 0.55; ATMO.sunCol.y = t.sun[1] * 0.5; ATMO.sunCol.z = t.sun[2] * 0.42;
    ATMO.params.x = wx.density * (T.haze || 1); ATMO.params.y = 2300; ATMO.params.z = glow; W.baseGlow = glow;
    W.baseDensity = ATMO.params.x;
    // lights
    W.sun.color.setRGB(...t.sun);
    W.sunIntensity = t.si * wx.sun * 1.05;
    W.sun.intensity = W.sunIntensity;
    W.hemi.color.setRGB(...g(t.hs, gray)); W.hemi.groundColor.setRGB(...t.hg);
    W.hemiIntensity = t.hi * (1 - wx.dark * 0.35) * (W.Q && W.Q.std ? 0.45 : 1);
    W.hemi.intensity = W.hemiIntensity;
    W.sunVisible = W.sunElev > -2;
    // grading: warm at golden hours, cool and flat in storms
    const warm = RJ.smooth(30, 2, W.sunElev) * RJ.smooth(-6, 0, W.sunElev);
    W.grade = {
      tint: [1 + warm * 0.05 - wx.dark * 0.03, 1 - warm * 0.01, 1 - warm * 0.06 + wx.dark * 0.02],
      sat: 1.06 + warm * 0.06 - wx.dark * 0.25, contrast: 1.05 + warm * 0.03 - wx.dark * 0.05,
      // eyes adapt in the blue hour: lift exposure through twilight, settling back to the night level
      exposure: 1.0 + RJ.smooth(0, -8, W.sunElev) * 0.45 + RJ.smooth(2, -5, W.sunElev) * (1 - RJ.smooth(-6, -12, W.sunElev)) * 1.1, bloom: 0.55 + warm * 0.25
    };
    if (W.waterMat) {
      const WU = W.waterMat.uniforms;
      WU.sunDir.value.copy(W.lightDir);
      WU.sunCol.value.setRGB(...t.sun).multiplyScalar(wx.sun * RJ.smooth(-4, 3, W.sunElev));
      WU.skyTop.value.setRGB(...top); WU.skyHor.value.copy(W.horizonColor);
      WU.deep.value.setRGB(0.02, 0.10, 0.16).lerp(new THREE.Color(0.05, 0.07, 0.09), wx.dark);
      WU.shallow.value.setRGB(0.10, 0.38, 0.40).lerp(new THREE.Color(0.12, 0.16, 0.16), wx.dark);
    }
    if (W.cloudMat) {
      const lit = new THREE.Color().setRGB(...t.sun).lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(1.12 * (1 - wx.dark * 0.62) * (0.25 + 0.75 * RJ.smooth(-6, 4, W.sunElev)));
      const shade = new THREE.Color().setRGB(...hor).lerp(new THREE.Color(0.42, 0.46, 0.55), 0.6).multiplyScalar(0.72 * (1 - wx.dark * 0.55));
      for (const m of [W.cloudMat, W.mistMat]) {
        m.uniforms.lit.value.copy(lit); m.uniforms.shade.value.copy(shade);
        m.uniforms.sunDir.value.copy(W.lightDir); m.uniforms.ambTop.value.setRGB(...top);
      }
      W.cloudLit = lit;
    }
    if (W.fallMat) W.fallMat.uniforms.light.value = 0.35 + 0.65 * t.si * wx.sun;
    if (W.farMat) {
      const FU = W.farMat.uniforms;
      FU.sunDir.value.copy(W.lightDir); FU.sunCol.value.copy(W.sun.color).multiplyScalar(W.sunIntensity);
      FU.skyAmb.value.copy(W.hemi.color).multiplyScalar(W.hemiIntensity * 1.6); FU.gndAmb.value.copy(W.hemi.groundColor).multiplyScalar(W.hemiIntensity * 1.6);
    }
    if (W.airbaseLights) W.airbaseLights.visible = W.sunElev < 12 || wx.dark > 0.3;
    // cloud shadow projection along the sun
    const CS = W.cloudShadowU;
    const LD = W.lightDir, sy = Math.max(LD.y, 0.12);
    const layer = RJ.clouds ? RJ.clouds.layer() : { mid: (wx.alt[0] + wx.alt[1]) / 2 };
    CS.rjCloudSun.value.set(LD.x / sy, LD.z / sy, layer.mid, W.cs && W.cs.enabled && LD.y > 0.08 ? 1 : 0);
    CS.rjCloudXf.value.w = 0.62 * (1 - wx.dark * 0.35);
    if (RJ.clouds) CS.rjCloudP.value.set(RJ.clouds.p.cov, RJ.clouds.p.storm, 0, 0);
    if (full) W.updateEnv();
  }

  /* ======================= WATER ======================= */
  function initWater() {
    W.waterMat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: true,
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) },
        skyTop: { value: new THREE.Color(0.3, 0.5, 0.9) }, skyHor: { value: new THREE.Color(0.7, 0.8, 0.9) },
        deep: { value: new THREE.Color(0.02, 0.1, 0.16) }, shallow: { value: new THREE.Color(0.1, 0.38, 0.4) },
        reflTex: { value: null }, texMatrix: { value: new THREE.Matrix4() }, useRefl: { value: 0 }, reflY: { value: 0 }, rain: { value: 0 }, sea: { value: 1 }
      }]), W.atmoUniforms()),
      vertexShader: [
        "attribute vec2 winfo; varying vec3 vW; varying vec2 vInfo; varying vec4 vRefl;", W.GLSL_CURVE,
        "uniform mat4 texMatrix;",
        "#include <fog_pars_vertex>",
        "void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vInfo = winfo; vRefl = texMatrix * w;",
        "  vec4 mvPosition = viewMatrix * w; mvPosition.xyz = rjCurve(mvPosition.xyz); gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float time; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyTop; uniform vec3 skyHor; uniform vec3 deep; uniform vec3 shallow;",
        "uniform sampler2D reflTex; uniform float useRefl; uniform float reflY; uniform float rain; uniform float sea;",
        "varying vec3 vW; varying vec2 vInfo; varying vec4 vRefl;",
        "#include <fog_pars_fragment>",
        // each wave octave fades out once its wavelength nears the pixel footprint (no moiré rings far away)
        "float rjFp = 0.0;",
        "vec2 wave(vec2 p, vec2 d, float k, float a, float s){ float ph = dot(p, d) * k + time * s; return d * (a * k * cos(ph)) * (1.0 - smoothstep(0.35, 1.2, k * rjFp)); }",
        "vec3 skyCol(vec3 d){ float h = max(d.y, 0.0); vec3 c = mix(skyHor, skyTop, pow(h, 0.5)); float s = max(dot(d, sunDir), 0.0); c += sunCol * (pow(s, 8.0) * 0.25 + pow(s, 80.0) * 0.6); return c; }",
        "void main(){",
        "  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;",
        "  float att = 1.0 / (1.0 + dist / 2200.0);",
        "  rjFp = dist * 0.0013 / max(0.08, abs(V.y));", // metres per pixel, stretched at grazing angles
        "  vec2 p = vW.xz; vec2 g = vec2(0.0);",
        // swell scales with the sea state (wind); a storm sea is long, steep and streaked with foam
        "  float ss = sea * vInfo.y + (1.0 - vInfo.y);",
        "  g += wave(p, vec2(0.80, 0.60), 0.018, 2.4, 0.85) * ss;",
        "  g += wave(p, vec2(-0.55, 0.83), 0.031, 1.2, 1.1) * ss;",
        "  g += wave(p, vec2(0.28, -0.96), 0.064, 0.55, 1.5) * mix(1.0, ss, 0.7);",
        "  g += wave(p, vec2(-0.93, -0.36), 0.12, 0.26, 2.0) * att * mix(1.0, ss, 0.5);",
        "  g += wave(p, vec2(0.60, -0.80), 0.25, 0.11, 2.8) * att;",
        "  g += wave(p, vec2(0.97, 0.24), 0.52, 0.045, 3.9) * att * att;",
        // rain: expanding rings in a grid of random cells, close to the camera only
        "  if (rain > 0.02 && dist < 600.0) {",
        "    vec2 c = floor(p * 0.6), f = fract(p * 0.6) - 0.5; float hs = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5);",
        "    float r = fract(time * 1.3 + hs), d = length(f);",
        "    g += f / max(d, 1e-3) * sin((d - r * 0.5) * 40.0) * exp(-abs(d - r * 0.5) * 18.0) * (1.0 - r) * rain * 0.35 * (1.0 - dist / 600.0) * step(hs, rain);",
        "  }",
        "  float calm = mix(1.0, 0.35, 1.0 - vInfo.y);",
        "  vec3 N = normalize(vec3(-g.x * calm, 1.0, -g.y * calm));",
        "  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0);",
        "  vec3 R = reflect(-V, N); R.y = abs(R.y);",
        "  vec3 refl = skyCol(R);",
        "  if (useRefl > 0.5 && abs(vW.y - reflY) < 1.6) { vec2 uv = vRefl.xy / vRefl.w + N.xz * 0.05 * att * mix(0.5, 1.0, vInfo.y); refl = mix(refl, texture2D(reflTex, uv).rgb, 0.9); }",
        "  float depth = vInfo.x;",
        "  vec3 body = mix(shallow, deep, smoothstep(0.0, 22.0, depth));",
        "  float sd = max(dot(R, normalize(sunDir)), 0.0);",
        "  float spec = pow(sd, 420.0) * 4.0 + pow(sd, 50.0) * 0.25;",
        "  vec3 col = mix(body, refl, fres) + sunCol * spec * smoothstep(-0.02, 0.1, sunDir.y);",
        "  float foam = (1.0 - smoothstep(0.0, 2.2, depth)) * (0.55 + 0.45 * sin(vW.x * 0.15 + vW.z * 0.11 + time * 1.3));",
        "  foam += smoothstep(0.62, 0.9, length(g) * 0.9) * vInfo.y * att * 0.35;",
        "  if (sea > 1.3) { float st = sin(dot(p, vec2(0.6, 0.8)) * 0.08 + sin(dot(p, vec2(-0.8, 0.6)) * 0.013) * 3.0); foam += smoothstep(0.75, 1.0, st) * smoothstep(1.3, 2.4, sea) * vInfo.y * 0.25 * smoothstep(0.4, 0.9, length(g)); }",
        "  col = mix(col, vec3(0.93, 0.95, 0.97) * (0.55 + 0.45 * length(sunCol)), clamp(foam, 0.0, 1.0) * 0.65);",
        "  float a = mix(clamp(depth * 0.3, 0.0, 1.0), 1.0, fres * 0.6);",
        "  a *= smoothstep(-0.3, 0.6, depth);",
        "  gl_FragColor = vec4(col, a);",
        "#include <fog_fragment>",
        "}"
      ].join("\n")
    });
  }

  /* ---------- planar reflection for sea-level water (High/Ultra) ---------- */
  function setupReflection() {
    const want = W.Q.reflect && RJ.settings.waterReflect !== false;
    if (W.refl) { W.refl.rt.dispose(); W.refl = null; }
    W.waterMat.uniforms.useRefl.value = 0;
    if (!want) return;
    const rt = new THREE.WebGLRenderTarget(512, 512, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
    rt.texture.generateMipmaps = false;
    W.refl = { rt, cam: new THREE.PerspectiveCamera(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3), frame: 0, bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1) };
    W.refl.cam.layers.enable(W.BACK);
    W.waterMat.uniforms.reflTex.value = rt.texture;
  }
  W.renderReflection = function (renderer, camera) {
    const R = W.refl;
    if (!R) return;
    const lvl = W.reflLevel;
    const on = lvl != null && camera.position.y - lvl < 9000 && camera.position.y > lvl + 1;
    W.waterMat.uniforms.useRefl.value = on ? 1 : 0;
    if (!on) return;
    R.frame++;
    if (RJ.settings.quality !== "ultra" && R.frame % 2) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const sc = RJ.settings.quality === "ultra" ? 0.5 : 0.35;
    const w = Math.max(256, Math.round(size.x * sc)), h = Math.max(256, Math.round(size.y * sc));
    if (R.rt.width !== w || R.rt.height !== h) R.rt.setSize(w, h);
    const cam = R.cam;
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far;
    cam.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const p = camera.position;
    const fwd = RJ.V3(0, 0, -1).applyQuaternion(camera.quaternion), up = RJ.V3(0, 1, 0).applyQuaternion(camera.quaternion);
    // mirror the camera about the chosen water level (sea, lake or river under the view)
    cam.position.set(p.x, 2 * lvl - p.y, p.z);
    cam.up.set(up.x, -up.y, up.z);
    cam.lookAt(p.x + fwd.x * 100, 2 * lvl - (p.y + fwd.y * 100), p.z + fwd.z * 100);
    R.plane.constant = -(lvl + 0.3);
    W.waterMat.uniforms.reflY.value = lvl;
    cam.updateMatrixWorld();
    W.waterMat.uniforms.texMatrix.value.copy(R.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.clippingPlanes = [R.plane];
    renderer.setRenderTarget(R.rt);
    renderer.clear();
    renderer.render(W.scene, cam);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    renderer.shadowMap.autoUpdate = prevAuto;
  };

  /** Pick the water surface the reflection should mirror: sea below, or the lake/river most in view. */
  let reflT = 0;
  function pickReflectionLevel(cam, dt) {
    reflT -= dt;
    if (reflT > 0) return;
    reflT = 0.25;
    const p = cam.position;
    const fwd = RJ.V3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    const reach = RJ.clamp(p.y * 4, 600, 9000);
    let best = null;
    for (const k of [0, 0.04, 0.1, 0.18, 0.3, 0.45, 0.65, 0.9]) {
      const x = p.x + fwd.x * reach * k, z = p.z + fwd.z * reach * k;
      const f = gen.fields(x, z);
      if (f.wl > -1e8 && f.wl > f.h + 0.3) { best = f.wl; break; }
      if (f.h < 0.3) { best = 0; break; }
    }
    if (best == null && W.seaNear) best = 0;
    W.reflLevel = best;
  }

  /* ======================= CLOUDS ======================= */
  W.FIELD = 34000;
  function cloudTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const rnd = gen.mulberry32(77);
    for (let i = 0; i < 34; i++) {
      const x = 64 + (rnd() - 0.5) * 66, y = 64 + (rnd() - 0.5) * 56, r = 14 + rnd() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.5)"); gr.addColorStop(0.55, "rgba(255,255,255,0.22)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    // fine billow detail
    for (let i = 0; i < 160; i++) {
      const x = 64 + (rnd() - 0.5) * 90, y = 64 + (rnd() - 0.5) * 80, r = 3 + rnd() * 7;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.18)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const mask = g.createRadialGradient(64, 64, 26, 64, 64, 64);
    mask.addColorStop(0, "rgba(0,0,0,1)"); mask.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-in"; g.fillStyle = mask; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function makeCloudMaterial(tex, wrap) {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      defines: wrap ? { WRAP: "" } : {},
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        map: { value: null }, camPos: { value: new THREE.Vector3() }, field: { value: W.FIELD }, wind: { value: new THREE.Vector2() },
        lit: { value: new THREE.Color(1, 1, 1) }, shade: { value: new THREE.Color(0.6, 0.65, 0.72) }, ambTop: { value: new THREE.Color(0.4, 0.6, 0.9) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, shadowPass: { value: 0 },
        holes: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] }
      }]), W.atmoUniforms()),
      vertexShader: [
        "attribute vec3 offset; attribute vec4 info; attribute vec3 local;",
        "uniform vec3 camPos; uniform float field; uniform vec2 wind; uniform vec3 sunDir; uniform vec4 holes[2];",
        "varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vSunQ; varying float vSide;",
        "#include <fog_pars_vertex>",
        "void main(){",
        "  vec3 c = offset; c.xz += wind;",
        "#ifdef WRAP",
        "  c.xz = camPos.xz + mod(c.xz - camPos.xz + field * 0.5, field) - field * 0.5;",
        "#endif",
        "  vec4 mvPosition = viewMatrix * vec4(c, 1.0);",
        "  float s = info.x; float r = info.y; float cs = cos(r), sn = sin(r);",
        "  vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);",
        "  mvPosition.xy += q * s;",
        "  gl_Position = projectionMatrix * mvPosition;",
        "  vUv = uv;",
        "  vec3 sv = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);",
        "  vSunQ = vec3(sv.x * cs + sv.y * sn, -sv.x * sn + sv.y * cs, sv.z);",
        "  vSide = dot(normalize(local + vec3(0.0, 0.001, 0.0)), normalize(sunDir)) * 0.5 + 0.5;",
        "  vShade = info.z;",
        "  float d = -mvPosition.z;",
        "  float a = info.w * smoothstep(s * 0.08, s * 0.75, d);",
        "  for (int i = 0; i < 2; i++) { vec4 hh = holes[i]; if (hh.w > 1.0) { a *= smoothstep(hh.w * 0.5, hh.w, distance(c, hh.xyz)); } }",
        "  vAlpha = a;",
        "#include <fog_vertex>",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D map; uniform vec3 lit; uniform vec3 shade; uniform vec3 ambTop; uniform float shadowPass;",
        "varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vSunQ; varying float vSide;",
        "#include <fog_pars_fragment>",
        "void main(){",
        "  vec2 q = vUv * 2.0 - 1.0; float r2 = dot(q, q);",
        "  vec4 t = texture2D(map, vUv);",
        "  float a = t.a * vAlpha;",
        "  if (a < 0.006) discard;",
        "  vec3 n = normalize(vec3(q, sqrt(max(1.0 - r2, 0.0)) * 1.1 + 0.15));",
        "  float diff = clamp(dot(n, vSunQ) * 0.6 + 0.4, 0.0, 1.0);",
        "  float k = clamp(vShade * 0.62 + vSide * 0.25 + diff * 0.45 - 0.14, 0.0, 1.0);",
        "  vec3 col = mix(shade, lit, k);",
        "  float back = pow(max(-vSunQ.z, 0.0), 3.0);",
        "  col += lit * back * (1.0 - t.a) * 1.1 * smoothstep(0.25, 1.0, r2);",
        "  col = mix(col, ambTop, (1.0 - vShade) * 0.06);",
        "  gl_FragColor = vec4(col, a);",
        "#include <fog_fragment>",
        "  if (shadowPass > 0.5) gl_FragColor = vec4(1.0, 1.0, 1.0, a);",
        "}"
      ].join("\n")
    });
    m.uniforms.map.value = tex; // merge() clones textures; keep the original
    return m;
  }
  function quadInstGeo() {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.setIndex(quad.index);
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    return g;
  }
  function initClouds() {
    const tex = cloudTexture();
    W.cloudMat = makeCloudMaterial(tex, true);
    W.cloudGeo = quadInstGeo();
    W.clouds = new THREE.Mesh(W.cloudGeo, W.cloudMat);
    W.clouds.frustumCulled = false; W.clouds.renderOrder = 5;
    W.scene.add(W.clouds);
    // valley mist: low clouds placed in real valleys around the camera
    W.mistMat = makeCloudMaterial(tex, false);
    W.mistGeo = quadInstGeo();
    W.mist = new THREE.Mesh(W.mistGeo, W.mistMat);
    W.mist.frustumCulled = false; W.mist.renderOrder = 4;
    W.scene.add(W.mist);
    W.windOff = new THREE.Vector2();
    W.holes = [{ t: 99, pos: new THREE.Vector3(), power: 0 }, { t: 99, pos: new THREE.Vector3(), power: 0 }];
    W.holeIdx = 0;
  }

  function buildClouds() {
    const wx = W.WEATHER[W.env.weather] || W.WEATHER.scattered;
    const rnd = gen.mulberry32(1234 + W.env.weather.length * 17);
    const scale = W.Q.clouds * RJ.settings.clouds;
    const offs = [], info = [], local = [];
    W.clusters = [];
    const addPuff = (x, y, z, lx, ly, lz, s, shadeV, alpha) => {
      offs.push(x, y, z); local.push(lx, ly, lz); info.push(s, rnd() * 6.28, shadeV, alpha);
    };
    // cumulus: flat bases, billowing domed tops
    const count = Math.round(wx.clusters * scale);
    for (let k = 0; k < count; k++) {
      const cx = (rnd() - 0.5) * W.FIELD, cz = (rnd() - 0.5) * W.FIELD;
      const base = wx.alt[0] + rnd() * (wx.alt[1] - wx.alt[0]);
      const R = (380 + rnd() * 720) * (wx.sea ? 1.5 : 1);
      const ry = R * (0.35 + rnd() * 0.25) * wx.thick;
      const puffs = Math.round(8 + rnd() * 9 * Math.min(1.6, wx.thick));
      W.clusters.push({ x: cx, y: base + ry * 0.45, z: cz, rx: R * 1.05, ry: ry * 0.75 + 80, rz: R * 1.05 });
      for (let p = 0; p < puffs; p++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        const hgt = Math.pow(rnd(), 0.8) * (1 - rr * 0.55);
        const lx = Math.cos(a) * rr * R, lz = Math.sin(a) * rr * R * 0.85, ly = hgt * ry;
        const s = (R * 0.75 + rnd() * R * 0.6) * (1 - rr * 0.3);
        addPuff(cx + lx, base + ly + s * 0.12, cz + lz, lx / R, ly / Math.max(ry, 1) - 0.3, lz / R, s, RJ.clamp(0.25 + hgt * 0.85, 0, 1), wx.clusters > 300 ? 0.95 : 0.88);
      }
    }
    // cumulonimbus towers with anvil tops
    const towers = Math.round((wx.towers || 0) * Math.min(1.3, scale));
    for (let k = 0; k < towers; k++) {
      const cx = (rnd() - 0.5) * W.FIELD * 0.8, cz = (rnd() - 0.5) * W.FIELD * 0.8;
      const base = 1300 + rnd() * 400, topY = 8000 + rnd() * 3000, R = 1300 + rnd() * 700;
      for (let y = base; y < topY; y += 520) {
        const f = (y - base) / (topY - base);
        const rad = R * (1 - f * 0.35) + (f > 0.82 ? (f - 0.82) * 9000 : 0);
        const n = 6 + Math.round(rad / 300);
        W.clusters.push({ x: cx, y, z: cz, rx: rad * 1.05, ry: 380, rz: rad * 1.05 });
        for (let p = 0; p < n; p++) {
          const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * rad;
          addPuff(cx + Math.cos(a) * rr, y + rnd() * 300, cz + Math.sin(a) * rr, Math.cos(a), f * 2 - 1, Math.sin(a), 650 + rnd() * 700, RJ.clamp(0.15 + f * 0.9, 0, 1), 0.95);
        }
      }
    }
    // stratus deck
    const strat = wx.stratus || 0;
    if (strat > 0) {
      const n = Math.round(700 * strat * scale);
      const y0 = wx.sea ? wx.alt[0] : wx.alt[0] - 200;
      for (let k = 0; k < n; k++) {
        const x = (rnd() - 0.5) * W.FIELD, z = (rnd() - 0.5) * W.FIELD, y = y0 + rnd() * 220;
        addPuff(x, y, z, 0, rnd() * 0.6 - 0.3, 0, 900 + rnd() * 900, 0.35 + rnd() * 0.3, 0.55 + strat * 0.3);
        if (k % 3 === 0) W.clusters.push({ x, y: y + 100, z, rx: 900, ry: 260, rz: 900 });
      }
    }
    W.cloudGeo.setAttribute("offset", new THREE.InstancedBufferAttribute(new Float32Array(offs), 3));
    W.cloudGeo.setAttribute("info", new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    W.cloudGeo.setAttribute("local", new THREE.InstancedBufferAttribute(new Float32Array(local), 3));
    W.cloudGeo.instanceCount = offs.length / 3;
    W.cloudBase = Math.min(wx.alt[0], strat ? wx.alt[0] - 200 : 1e9, towers ? 1300 : 1e9);
    W.cloudTop = towers ? 11000 : wx.alt[1] + 500;
    W.cloudMid = (wx.alt[0] + wx.alt[1]) / 2;
    // mist buffers
    const M = Math.round((W.Q.mist || 0) * (wx.mist || 0) * (W.env.time === "dawn" || W.env.time === "morning" ? 1.4 : 1));
    W.mistN = M;
    W.mistBase = new Float32Array(Math.max(M, 1) * 3);
    W.mistLive = new Uint8Array(Math.max(M, 1));
    const mo = new Float32Array(Math.max(M, 1) * 3), mi = new Float32Array(Math.max(M, 1) * 4), ml = new Float32Array(Math.max(M, 1) * 3);
    for (let i = 0; i < M; i++) { mo[i * 3 + 1] = -99999; mi[i * 4] = 300 + rnd() * 260; mi[i * 4 + 1] = rnd() * 6.28; mi[i * 4 + 2] = 0.6 + rnd() * 0.3; mi[i * 4 + 3] = 0.42 + rnd() * 0.18; ml[i * 3 + 1] = 1; }
    W.mistGeo.setAttribute("offset", new THREE.InstancedBufferAttribute(mo, 3).setUsage(THREE.DynamicDrawUsage));
    W.mistGeo.setAttribute("info", new THREE.InstancedBufferAttribute(mi, 4));
    W.mistGeo.setAttribute("local", new THREE.InstancedBufferAttribute(ml, 3));
    W.mistGeo.instanceCount = M;
    W.mist.visible = M > 0;
  }

  function updateMist(cam) {
    const M = W.mistN;
    if (!M) return;
    const attr = W.mistGeo.getAttribute("offset"), a = attr.array;
    let changed = 0;
    for (let i = 0; i < M && changed < 6; i++) {
      const dx = a[i * 3] + W.windOff.x - cam.position.x, dz = a[i * 3 + 2] + W.windOff.y - cam.position.z;
      if (W.mistLive[i] && dx * dx + dz * dz < 7500 * 7500) continue;
      // respawn into a valley near the camera
      W.mistLive[i] = 0;
      for (let tries = 0; tries < 6; tries++) {
        const ang = Math.random() * 6.28, r = 1200 + Math.random() * 6000;
        const x = cam.position.x + Math.cos(ang) * r, z = cam.position.z + Math.sin(ang) * r;
        const f = gen.fields(x, z);
        if (f.land < 0.9 || f.canyon < 0.45 || (f.mtn < 0.25 && f.forest < 0.35)) continue;
        a[i * 3] = x - W.windOff.x; a[i * 3 + 1] = Math.max(f.h, 0) + 70 + Math.random() * 170; a[i * 3 + 2] = z - W.windOff.y;
        W.mistLive[i] = 1; break;
      }
      if (!W.mistLive[i]) a[i * 3 + 1] = -99999;
      changed++;
    }
    if (changed) attr.needsUpdate = true;
  }

  const wrapD = (d) => ((d % W.FIELD) + W.FIELD * 1.5) % W.FIELD - W.FIELD * 0.5;
  /** 0..1 how deep inside a cloud the point is. `pad` > 1 also counts nearby air. */
  W.cloudDensityAt = function (p, pad = 1) {
    if (RJ.clouds && RJ.clouds.active()) return RJ.clouds.densityAt(p, pad);
    if (!W.clusters || p.y < W.cloudBase - 800 || p.y > W.cloudTop + 900) return 0;
    let best = 0;
    for (const c of W.clusters) {
      const dx = wrapD(c.x + W.windOff.x - p.x) / (c.rx * pad); if (dx > 1 || dx < -1) continue;
      const dz = wrapD(c.z + W.windOff.y - p.z) / (c.rz * pad); if (dz > 1 || dz < -1) continue;
      const dy = (c.y - p.y) / (c.ry * pad);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < 1) best = Math.max(best, 1 - d);
    }
    return best;
  };
  /** Shockwaves punch expanding holes in the cloud deck. */
  W.punchHole = function (pos, power) {
    const h = W.holes[W.holeIdx]; W.holeIdx = (W.holeIdx + 1) % 2;
    h.pos.copy(pos).sub(RJ.V3(W.windOff.x, 0, W.windOff.y)); h.t = 0; h.power = power;
  };

  /* ---------- cloud shadow map (top-down coverage render) ---------- */
  function setupCloudShadow() {
    const want = W.Q.cloudShadow && RJ.settings.cloudShadows !== false && RJ.clouds && RJ.clouds.weatherTex;
    W.cs = { enabled: !!want };
    W.cloudShadowU.rjCloudTex.value = RJ.clouds && RJ.clouds.weatherTex;
    if (!want) W.cloudShadowU.rjCloudSun.value.w = 0;
  }
  /** Kept for callers; shadows now come straight from the weather map, so there is no extra pass. */
  W.renderCloudShadow = function () { };
  /** Billboards are the fallback; with volumetric clouds the layer heights come from the weather preset. */
  /** Weather transitions: rebuild the billboard fallback and re-light with the blended weather. */
  W.rebuildClouds = () => { if (W.cloudGeo) buildClouds(); W.syncCloudLayer(); };
  W.relight = (full) => applyLighting(!!full);
  W.syncCloudLayer = function () {
    const vol = RJ.clouds && RJ.clouds.active();
    if (W.clouds) W.clouds.visible = !vol;
    if (vol) { const L = RJ.clouds.layer(); W.cloudBase = L.base; W.cloudTop = Math.max(L.top, L.stormTop); W.cloudMid = L.mid; }
  };

  /* ======================= RAIN ======================= */
  function initRain() {
    const N = 3600;
    const pos = new Float32Array(N * 6);
    W.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) W.rainSeed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    W.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.4, fog: false }));
    W.rain.frustumCulled = false; W.rain.visible = false; W.rain.layers.set(RJ.LATE || 3);
    W.scene.add(W.rain);
    W.flash = 0; W.nextBolt = 6;
  }
  function updateRain(dt, cam, vel) {
    // intensity comes from RJ.weather (local storm cells and squall bands), else from the preset
    const wx = W.wx(), amt = RJ.weather ? RJ.weather.rain : +wx.rain || 0;
    const on = amt > 0.02 && cam.position.y < Math.max(W.cloudMid, W.cloudBase + 400);
    W.rain.visible = !!on;
    if (!on) return;
    const S = W.rainSeed, N = Math.ceil(S.length / 3 * RJ.clamp(amt, 0.15, 1)), box = 90, t = performance.now() / 1000;
    const a = W.rain.geometry.attributes.position.array;
    W.rain.geometry.setDrawRange(0, N * 2);
    W.rain.material.opacity = 0.22 + amt * 0.3;
    const vx = vel ? -vel.x * 0.012 : 0, vy = vel ? -vel.y * 0.012 : 0, vz = vel ? -vel.z * 0.012 : 0;
    for (let i = 0; i < N; i++) {
      const x = cam.position.x + (S[i * 3] - 0.5) * box, z = cam.position.z + (S[i * 3 + 2] - 0.5) * box;
      const y = cam.position.y + box * 0.5 - (((S[i * 3 + 1] * box) + t * 60) % box);
      a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
      a[i * 6 + 3] = x + vx; a[i * 6 + 4] = y - 2.4 + vy; a[i * 6 + 5] = z + vz;
    }
    W.rain.geometry.attributes.position.needsUpdate = true;
  }

  /* ======================= PER-FRAME ======================= */
  let envT = 0, mistT = 0, fallFxT = 0;
  const _ahead = new THREE.Vector3();
  W.update = function (dt, cam, focus, focusVel, focusAgl) {
    W.camera = cam;
    // very fast flight: stream terrain around a point ~3 s ahead so the world is ready before you arrive
    if (focusVel && focusVel.lengthSq() > 350 * 350) { _ahead.copy(focusVel).multiplyScalar(Math.min(4, 3500 / focusVel.length())).add(focus); W.updateChunks(_ahead, 6); }
    else W.updateChunks(focus, 6);
    updateFar(cam);
    pickReflectionLevel(cam, dt);
    W.skyMesh.position.copy(cam.position);
    W.skyMat.uniforms.alt.value = cam.position.y;
    W.skyMat.uniforms.time.value += dt;
    W.waterMat.uniforms.time.value += dt;
    W.fallMat.uniforms.time.value += dt;
    const wx = W.wx();
    W.windOff.x += wx.wind * dt; W.windOff.y += wx.wind * 0.45 * dt;
    for (const m of [W.cloudMat, W.mistMat]) { m.uniforms.camPos.value.copy(cam.position); m.uniforms.wind.value.copy(W.windOff); }
    W.cloudShadowU.rjCloudXf.value.x = W.windOff.x; W.cloudShadowU.rjCloudXf.value.y = W.windOff.y;
    // shockwave holes in clouds open fast, then slowly fill back in
    W.holes.forEach((h, i) => {
      h.t += dt;
      const r = h.t < 8 ? 750 * h.power * (1 - Math.exp(-h.t * 2.2)) : 750 * h.power * Math.max(0, 1 - (h.t - 8) / 10);
      const u = W.cloudMat.uniforms.holes.value[i];
      u.set(h.pos.x, h.pos.y, h.pos.z, r);
      W.mistMat.uniforms.holes.value[i].copy(u);
    });
    mistT += dt;
    if (mistT > 0.1) { mistT = 0; updateMist(cam); }

    if (W.cycle && W.clock.run && dt > 0) {
      // time-based (not frame-based): the same day passes at any frame rate; sky, fog, sun, moon and shadow
      // direction update every frame, the reflection/ambient environment probe every few seconds
      W.clock.h = (W.clock.h + (dt * W.clock.rate) / 3600) % 24;
      clockSun();
      envT += dt;
      applyLighting(envT > 5);
      if (envT > 5) envT = 0;
    }

    // dynamic shadow frustum: tight when low for crisp aircraft shadows, wider when high
    if (W.sun.castShadow) {
      const agl = focusAgl != null ? focusAgl : 200;
      // over New York the frustum widens so skyscrapers throw shadows across whole blocks
      const city = RJ.nyc && RJ.nyc.ready && RJ.nyc.within(focus.x, focus.z, -6000);
      const half = city ? RJ.clamp(300 + agl * 0.5, 300, 950) : RJ.clamp(90 + agl * 0.35, 90, 700);
      const sc = W.sun.shadow.camera;
      if (Math.abs(sc.right - half) > 5) { sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix(); }
      W.sun.target.position.copy(focus);
      W.sun.position.copy(focus).addScaledVector(W.lightDir, 2200);
    } else W.sun.position.copy(W.lightDir).multiplyScalar(1000);

    // in-cloud whiteout
    const dens = W.cloudDensityAt(cam.position);
    W.cloudNear = W.cloudDensityAt(cam.position, 1.6);
    W.inCloud = RJ.damp(W.inCloud || 0, dens > 0 ? 0.35 + dens * 0.65 : 0, 6, dt);
    const fog = W.scene.fog, bf = W.baseFog;
    if (W.inCloud > 0.01) {
      // with volumetric clouds the raymarch already whites out the view; the fog only softens the terrain
      const vol = RJ.clouds && RJ.clouds.active();
      fog.near = RJ.lerp(bf.near, vol ? 80 : 2, W.inCloud);
      fog.far = RJ.lerp(bf.far, vol ? 1800 : 140, Math.pow(W.inCloud, 0.6));
      fog.color.copy(bf.color).lerp(W.cloudLit || bf.color, W.inCloud);
    } else { fog.near = bf.near; fog.far = bf.far; fog.color.copy(bf.color); }
    // under the sea in the dive zone: short, green-blue visibility
    W.underwater = cam.position.y < -0.5 && !!(RJ.realms && RJ.realms.diveAt(cam.position.x, cam.position.z));
    if (W.underwater) { fog.near = 4; fog.far = 520; fog.color.setRGB(0.06, 0.3, 0.36).multiplyScalar(0.4 + 0.6 * RJ.smooth(-12, 15, W.sunElev)); }
    if (W.baseGlow != null) ATMO.params.z = W.underwater ? 0 : W.baseGlow;
    // under a thick deck the light dims
    const under = cam.position.y < W.cloudBase && wx.clusters > 300 ? 0.75 : 1;
    if (W.flash <= 0) W.sun.intensity = W.sunIntensity * under;

    // lightning strikes, gusts and weather changes live in RJ.weather; W.flash (0..1, scaled by distance) lights the sky
    if (RJ.weather) RJ.weather.update(dt, cam);
    // sea state follows the wind (bigger swell, more whitecaps); rain dimples the surface
    W.seaState = RJ.damp(W.seaState || 1, RJ.clamp(wx.wind / 9, 0.5, 2.6), 0.2, dt);
    W.waterMat.uniforms.sea.value = W.seaState;
    W.waterMat.uniforms.rain.value = RJ.weather ? RJ.weather.rain : 0;
    if (RJ.ships) RJ.ships.update(dt, cam);
    if (RJ.life) RJ.life.update(dt, cam);
    if (W.flash > 0) {
      W.flashPeak = W.flashPeak || 1;
      W.flash = Math.max(0, W.flash - dt * (W.flash > 0.5 * W.flashPeak ? 6 : 2.5));
      const r = W.flash / W.flashPeak, f = (r > 0.85 || (r > 0.4 && r < 0.55) ? W.flash : W.flash * 0.3);
      W.hemi.intensity = W.hemiIntensity + f * 1.6;
      W.skyMat.uniforms.flash.value = f * 0.6;
    } else { W.hemi.intensity = W.hemiIntensity; W.skyMat.uniforms.flash.value = 0; }
    if (W.castleGroup) RJ.castle.update(dt, W.castleGroup);
    if (RJ.atlas && RJ.atlas.built) RJ.atlas.update(dt, cam);
    if (RJ.living && RJ.living.planned) RJ.living.update(dt, cam);
    updateRain(dt, cam, focusVel);
    // waterfall mist near the camera
    fallFxT += dt;
    if (fallFxT > 0.08 && RJ.fx && RJ.fx.smokeP) {
      fallFxT = 0;
      for (const f of W.falls) {
        if (f.base.distanceToSquared(cam.position) > 3500 * 3500) continue;
        RJ.fx.mist(f.base, f.width);
      }
    }
  };
})(window.RJ);
