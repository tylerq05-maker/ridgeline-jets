/* Ridgeline Jets — post-processing: HDR scene target, bloom, heat haze, shockwave refraction,
 * radial speed blur, depth of field, color grading, film tone curve and FXAA.
 * Falls back to direct rendering when disabled or unsupported. */
(function (RJ) {
  "use strict";
  const P = { enabled: false, ok: false };
  RJ.post = P;

  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

  P.init = function (renderer) {
    P.r = renderer;
    try {
      const gl = renderer.getContext();
      const isGL2 = renderer.capabilities.isWebGL2;
      let type = THREE.UnsignedByteType;
      if (isGL2 && renderer.extensions.get("EXT_color_buffer_float")) type = THREE.HalfFloatType;
      else if (!isGL2 && renderer.extensions.get("OES_texture_half_float") && renderer.extensions.get("OES_texture_half_float_linear") && renderer.extensions.get("EXT_color_buffer_half_float")) type = THREE.HalfFloatType;
      P.type = type;
      P.depthOK = isGL2 || !!renderer.extensions.get("WEBGL_depth_texture");
      const opt = (t) => ({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: t, depthBuffer: false, stencilBuffer: false });
      P.rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign(opt(type), { depthBuffer: true }));
      if (P.depthOK) { P.rtScene.depthTexture = new THREE.DepthTexture(4, 4); P.rtScene.depthTexture.type = THREE.UnsignedIntType; }
      P.rtHalf = new THREE.WebGLRenderTarget(4, 4, opt(type));
      P.rtQ1 = new THREE.WebGLRenderTarget(4, 4, opt(type)); P.rtQ2 = new THREE.WebGLRenderTarget(4, 4, opt(type));
      P.rtE1 = new THREE.WebGLRenderTarget(4, 4, opt(type)); P.rtE2 = new THREE.WebGLRenderTarget(4, 4, opt(type));
      P.rtD1 = new THREE.WebGLRenderTarget(4, 4, opt(type)); P.rtD2 = new THREE.WebGLRenderTarget(4, 4, opt(type));
      P.rtComp = new THREE.WebGLRenderTarget(4, 4, opt(THREE.UnsignedByteType));
      [P.rtScene, P.rtHalf, P.rtQ1, P.rtQ2, P.rtE1, P.rtE2, P.rtD1, P.rtD2, P.rtComp].forEach((rt) => { rt.texture.generateMipmaps = false; });

      P.bright = mk([
        "uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold; varying vec2 vUv;",
        "void main(){",
        "  vec3 c = texture2D(tDiffuse, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.5, -0.5)).rgb",
        "         + texture2D(tDiffuse, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.5, 0.5)).rgb;",
        "  c *= 0.25;",
        // an overflowed (Inf) or NaN pixel would turn the whole blur chain black: drop it here
        "  if (!(c.r + c.g + c.b < 6.0e4)) c = vec3(0.0);",
        "  float l = max(c.r, max(c.g, c.b));",
        "  float k = max(l - threshold, 0.0); k = k * k / (k + 0.25);",
        "  gl_FragColor = vec4(c * (k / max(l, 0.0001)), 1.0);",
        "}"
      ].join("\n"), { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.82 } });
      P.copy = mk([
        "uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;",
        "void main(){ vec3 c = texture2D(tDiffuse, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.5, -0.5)).rgb",
        "  + texture2D(tDiffuse, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.5, 0.5)).rgb; c *= 0.25; if (!(c.r + c.g + c.b < 6.0e4)) c = vec3(0.0); gl_FragColor = vec4(c, 1.0); }"
      ].join("\n"), { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } });
      P.blur = mk([
        "uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;",
        "void main(){",
        "  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;",
        "  c += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162;",
        "  c += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;",
        "  c += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703;",
        "  c += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"), { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } });

      const heat = [], shock = [];
      for (let i = 0; i < 4; i++) heat.push(new THREE.Vector4());
      for (let i = 0; i < 3; i++) shock.push(new THREE.Vector4());
      P.comp = mk([
        "uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tBloom1; uniform sampler2D tBloom2; uniform sampler2D tBlur;",
        "uniform vec2 resolution; uniform float time; uniform float aspect;",
        "uniform float exposure; uniform float bloomStrength; uniform float saturation; uniform float contrast; uniform vec3 tint;",
        "uniform float vignette; uniform float grain; uniform float flash; uniform vec3 flashCol;",
        "uniform float motion; uniform vec2 motionCenter; uniform float chroma;",
        "uniform vec4 heat[4]; uniform vec4 shock[3]; uniform float shockWidth;",
        "uniform float useDepth; uniform vec3 dof; uniform float camNear; uniform float camFar;",
        "varying vec2 vUv;",
        "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
        "float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * camNear * camFar / (camFar + camNear - z * (camFar - camNear)); }",
        // ACES filmic (Narkowicz fit) applied in linear light; the buffer holds display-referred values
        "vec3 acesF(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }",
        "vec3 tone(vec3 c){ vec3 lin = pow(max(c, 0.0), vec3(2.2)) * 0.9; return pow(acesF(lin), vec3(1.0 / 2.2)); }",
        "vec3 toneOld(vec3 x){ vec3 a = vec3(0.72); vec3 o = a + (1.0 - a) * (1.0 - exp(-(x - a) / (1.0 - a))); return mix(x, o, step(a, x)); }",
        "void main(){",
        "  vec2 uv = vUv;",
        // shockwave refraction rings
        "  for (int i = 0; i < 3; i++) { vec4 s = shock[i]; if (s.w > 0.0001) {",
        "    vec2 d = uv - s.xy; d.x *= aspect; float r = length(d);",
        "    float x = (r - s.z) / shockWidth; float ring = exp(-x * x) * x;",
        "    vec2 n = d / max(r, 0.0001); n.x /= aspect; uv -= n * ring * s.w; } }",
        // engine heat haze
        "  for (int i = 0; i < 4; i++) { vec4 h = heat[i]; if (h.w > 0.0001) {",
        "    vec2 d = uv - h.xy; d.x *= aspect; float f = exp(-dot(d, d) / (h.z * h.z));",
        "    vec2 w = vec2(sin(uv.y * 220.0 + time * 31.0 + uv.x * 60.0), cos(uv.x * 190.0 - time * 27.0 + uv.y * 40.0));",
        "    uv += w * f * h.w * 0.0035; } }",
        "  vec3 col;",
        "  if (motion > 0.0001) {",
        "    vec2 dv = (uv - motionCenter) * motion; col = vec3(0.0);",
        "    for (int i = 0; i < 8; i++) col += texture2D(tScene, uv - dv * (float(i) / 7.0)).rgb;",
        "    col /= 8.0;",
        "  } else col = texture2D(tScene, uv).rgb;",
        "  if (chroma > 0.0001) { vec2 cd = (uv - 0.5) * chroma; col.r = mix(col.r, texture2D(tScene, uv + cd).r, 0.7); col.b = mix(col.b, texture2D(tScene, uv - cd).b, 0.7); }",
        "  if (useDepth > 0.5 && dof.z > 0.001) {",
        "    float z = linDepth(texture2D(tDepth, uv).x);",
        "    float coc = clamp(abs(z - dof.x) / dof.y, 0.0, 1.0) * dof.z;",
        "    col = mix(col, texture2D(tBlur, uv).rgb, coc);",
        "  }",
        "  vec3 bloom = texture2D(tBloom1, uv).rgb * 0.55 + texture2D(tBloom2, uv).rgb * 0.75;",
        "  col += bloom * bloomStrength;",
        "  col = mix(col, flashCol, flash);",
        "  col *= exposure;",
        "  col = tone(col);",
        "  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));",
        "  col = mix(vec3(l), col, saturation);",
        "  col = (col - 0.5) * contrast + 0.5;",
        "  col *= tint;",
        "  vec2 v = vUv - 0.5; col *= 1.0 - dot(v, v) * vignette;",
        "  col += (hash(vUv * resolution + fract(time * 7.13)) - 0.5) * grain;",
        "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);",
        "}"
      ].join("\n"), {
        tScene: { value: null }, tDepth: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, tBlur: { value: null },
        resolution: { value: new THREE.Vector2() }, time: { value: 0 }, aspect: { value: 1 },
        exposure: { value: 1 }, bloomStrength: { value: 0.6 }, saturation: { value: 1.06 }, contrast: { value: 1.05 }, tint: { value: new THREE.Vector3(1, 1, 1) },
        vignette: { value: 0.32 }, grain: { value: 0.012 }, flash: { value: 0 }, flashCol: { value: new THREE.Vector3(1, 1, 1) },
        motion: { value: 0 }, motionCenter: { value: new THREE.Vector2(0.5, 0.5) }, chroma: { value: 0 },
        heat: { value: heat }, shock: { value: shock }, shockWidth: { value: 0.035 },
        useDepth: { value: 0 }, dof: { value: new THREE.Vector3(100, 200, 0) }, camNear: { value: 0.5 }, camFar: { value: 20000 }
      });
      P.fxaa = mk([
        "uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;",
        "void main(){",
        "  vec2 inv = 1.0 / resolution;",
        "  vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * inv).rgb;",
        "  vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * inv).rgb;",
        "  vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * inv).rgb;",
        "  vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * inv).rgb;",
        "  vec3 rgbM = texture2D(tDiffuse, vUv).rgb;",
        "  vec3 luma = vec3(0.299, 0.587, 0.114);",
        "  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma), lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma), lM = dot(rgbM, luma);",
        "  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));",
        "  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));",
        "  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));",
        "  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);",
        "  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);",
        "  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * inv;",
        "  vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);",
        "  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);",
        "  float lB = dot(b, luma);",
        "  gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);",
        "}"
      ].join("\n"), { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() } });

      P.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), P.copy);
      P.quad.frustumCulled = false;
      P.qScene = new THREE.Scene(); P.qScene.add(P.quad);
      P.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      P.ok = true;
    } catch (e) { console.warn("Post-processing unavailable", e); P.ok = false; }
    // per-frame inputs set by the game
    P.fx = { motion: 0, motionCenter: [0.5, 0.5], chroma: 0, heat: [], shocks: [], flash: 0, flashCol: [1, 1, 1], dof: null };
  };

  P.setSize = function (w, h) {
    if (!P.ok) return;
    P.w = w; P.h = h;
    P.rtScene.setSize(w, h);
    if (P.rtScene.depthTexture) { P.rtScene.depthTexture.image.width = w; P.rtScene.depthTexture.image.height = h; }
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    P.rtHalf.setSize(hw, hh);
    P.rtQ1.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); P.rtQ2.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    P.rtE1.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3)); P.rtE2.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    P.rtD1.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); P.rtD2.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    P.rtComp.setSize(w, h);
  };

  function pass(mat, target) {
    P.quad.material = mat;
    P.r.setRenderTarget(target);
    P.r.render(P.qScene, P.qCam);
  }
  function blurInto(src, a, b, scale) {
    P.blur.uniforms.tDiffuse.value = src.texture;
    P.blur.uniforms.dir.value.set(scale / src.width, 0);
    pass(P.blur, b);
    P.blur.uniforms.tDiffuse.value = b.texture;
    P.blur.uniforms.dir.value.set(0, scale / b.height);
    pass(P.blur, a);
  }

  /**
   * Render a frame. overlays: optional [{scene, camera}] drawn after the world with a cleared depth
   * buffer (the 3D cockpit). grade: {exposure, sat, contrast, tint, bloom}.
   */
  P.render = function (scene, camera, overlays, grade, dt, opts) {
    const r = P.r;
    const world = !!(opts && opts.world);
    // world scenes: sky + far horizon first (long-range camera), then the detailed world on top
    const drawWorld = () => {
      const ac = r.autoClear;
      if (world && RJ.world.underwater) {
        // under the sea nothing past ~500 m is visible: skip the sky/far-horizon pass, clear to the water colour
        const cc = r.getClearColor(P._cc || (P._cc = new THREE.Color())).clone(), ca = r.getClearAlpha();
        r.setClearColor(RJ.world.scene.fog.color, 1); r.clear(); r.setClearColor(cc, ca); r.autoClear = false;
      } else if (world) { r.clear(); RJ.world.renderBackdrop(r, camera); r.autoClear = false; }
      if (world && P.enabled && P.ok && RJ.clouds && RJ.clouds.active() && !RJ.world.underwater) {
        // opaque world → volumetric clouds → transparent effects (flames, vapor, smoke) on top with depth
        const mask = camera.layers.mask;
        camera.layers.disable(RJ.LATE);
        r.render(scene, camera);
        RJ.clouds.render(r, camera, P.rtScene, dt);
        camera.layers.set(RJ.LATE);
        const sm = r.shadowMap.autoUpdate;
        r.autoClear = false; r.shadowMap.autoUpdate = false;
        r.setRenderTarget(P.rtScene);
        r.render(scene, camera);
        r.shadowMap.autoUpdate = sm;
        camera.layers.mask = mask;
      } else r.render(scene, camera);
      r.autoClear = ac;
    };
    if (!P.enabled || !P.ok) {
      r.setRenderTarget(null);
      drawWorld();
      if (overlays) for (const o of overlays) { r.autoClear = false; r.clearDepth(); r.render(o.scene, o.camera); r.autoClear = true; }
      return;
    }
    const S = RJ.settings, fx = P.fx;
    r.setRenderTarget(P.rtScene);
    drawWorld();
    if (overlays) for (const o of overlays) { r.autoClear = false; r.clearDepth(); r.render(o.scene, o.camera); r.autoClear = true; }
    // bloom chain
    const bloomOn = S.bloom !== false;
    if (bloomOn) {
      P.bright.uniforms.tDiffuse.value = P.rtScene.texture;
      P.bright.uniforms.texel.value.set(1 / P.w, 1 / P.h);
      pass(P.bright, P.rtHalf);
      P.copy.uniforms.tDiffuse.value = P.rtHalf.texture; P.copy.uniforms.texel.value.set(1 / P.rtHalf.width, 1 / P.rtHalf.height);
      pass(P.copy, P.rtQ1);
      blurInto(P.rtQ1, P.rtQ1, P.rtQ2, 1.0);
      P.copy.uniforms.tDiffuse.value = P.rtQ1.texture; P.copy.uniforms.texel.value.set(1 / P.rtQ1.width, 1 / P.rtQ1.height);
      pass(P.copy, P.rtE1);
      blurInto(P.rtE1, P.rtE1, P.rtE2, 1.5);
      blurInto(P.rtE1, P.rtE1, P.rtE2, 2.5);
    }
    // depth of field blur source
    const dofOn = fx.dof && S.dof !== false && P.depthOK;
    if (dofOn) {
      P.copy.uniforms.tDiffuse.value = P.rtScene.texture; P.copy.uniforms.texel.value.set(1 / P.w, 1 / P.h);
      pass(P.copy, P.rtD1);
      blurInto(P.rtD1, P.rtD1, P.rtD2, 1.0);
      blurInto(P.rtD1, P.rtD1, P.rtD2, 2.0);
    }
    const U = P.comp.uniforms;
    U.tScene.value = P.rtScene.texture;
    U.tDepth.value = P.rtScene.depthTexture || null;
    U.tBloom1.value = P.rtQ1.texture; U.tBloom2.value = P.rtE1.texture; U.tBlur.value = P.rtD1.texture;
    U.resolution.value.set(P.w, P.h);
    U.aspect.value = P.w / Math.max(1, P.h);
    U.time.value += dt || 0.016;
    const g = grade || {};
    U.exposure.value = (g.exposure || 1) * (S.exposure || 1);
    U.bloomStrength.value = bloomOn ? (g.bloom != null ? g.bloom : 0.6) : 0;
    U.saturation.value = g.sat || 1.05; U.contrast.value = g.contrast || 1.04;
    const tn = g.tint || [1, 1, 1]; U.tint.value.set(tn[0], tn[1], tn[2]);
    U.motion.value = S.motionBlur !== false ? fx.motion : 0;
    U.motionCenter.value.set(fx.motionCenter[0], fx.motionCenter[1]);
    U.chroma.value = fx.chroma;
    U.flash.value = fx.flash; U.flashCol.value.set(fx.flashCol[0], fx.flashCol[1], fx.flashCol[2]);
    for (let i = 0; i < 4; i++) { const h = S.heatHaze !== false && fx.heat[i]; if (h) U.heat.value[i].set(h[0], h[1], h[2], h[3]); else U.heat.value[i].set(0, 0, 0, 0); }
    for (let i = 0; i < 3; i++) { const s = fx.shocks[i]; if (s) U.shock.value[i].set(s[0], s[1], s[2], s[3]); else U.shock.value[i].set(0, 0, 0, 0); }
    U.useDepth.value = dofOn ? 1 : 0;
    if (dofOn) U.dof.value.set(fx.dof[0], fx.dof[1], fx.dof[2]);
    U.camNear.value = camera.near; U.camFar.value = camera.far;
    const fxaaOn = S.fxaa !== false;
    pass(P.comp, fxaaOn ? P.rtComp : null);
    if (fxaaOn) {
      P.fxaa.uniforms.tDiffuse.value = P.rtComp.texture;
      P.fxaa.uniforms.resolution.value.set(P.w, P.h);
      pass(P.fxaa, null);
    }
  };
})(window.RJ);
