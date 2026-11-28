/* Jet City — photo-scanned surface detail (Poly Haven, CC0; 1K copies in assets/tex/).
 * The world keeps its own colours (biome vertex colours, satellite imagery, liveries); these textures only add real
 * surface structure on top: each albedo is divided by its own average colour, so it modulates brightness and grain
 * without repainting, and the normal maps add relief. Terrain blends grass / rock (steep slopes) / snow / beach sand
 * by slope, height and snow cover and fades the detail out with distance; airfields get concrete and asphalt; jets
 * built in code get metal-plate panels and rusty nozzles. Until a texture has loaded it is a neutral 1×1 pixel, so
 * nothing changes. */
(function (RJ) {
  "use strict";
  const T = (RJ.tex = { ready: false });
  const DIR = "assets/tex/";
  const NAMES = ["grass_albedo", "grass_normal", "rock_albedo", "snow_albedo", "snow_normal", "sand_albedo", "sand_normal", "concrete_albedo", "concrete_normal",
    "asphalt_albedo", "asphalt_normal", "cliff_albedo", "cliff_normal", "rock_normal", "metal_albedo", "metal_normal", "metal_roughness", "rust_albedo", "rust_normal"];
  const px = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; };
  // uniforms: u[name] (texture) and m[name] (average colour, for albedo maps)
  T.u = {}; T.m = {};
  for (const n of NAMES) { T.u[n] = { value: /normal/.test(n) ? px(128, 128, 255) : px(255, 255, 255) }; T.m[n] = { value: new THREE.Vector3(1, 1, 1) }; }

  let started = false;
  T.load = function () {
    if (started) return; started = true;
    const L = new THREE.TextureLoader(), aniso = RJ.world && RJ.world.renderer ? Math.min(8, RJ.world.renderer.capabilities.getMaxAnisotropy()) : 4;
    let left = NAMES.length;
    for (const n of NAMES) L.load(DIR + n + ".jpg", (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.needsUpdate = true;
      if (!/normal/.test(n)) { // average colour, so the map modulates instead of repainting
        const c = document.createElement("canvas"); c.width = c.height = 8; const x = c.getContext("2d"); x.drawImage(t.image, 0, 0, 8, 8);
        const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const k = 64 * 255; T.m[n].value.set(Math.max(r / k, 0.02), Math.max(g / k, 0.02), Math.max(b / k, 0.02));
      }
      T.u[n].value = t;
      if (--left === 0) T.ready = true;
    }, undefined, () => { --left; });
  };

  // two samples at different scales and offsets so the tiling never reads as a grid
  const DET = "vec3 rjDet(sampler2D t, vec3 mn, vec2 uv) { return (texture2D(t, uv).rgb * 0.62 + texture2D(t, uv * 0.29 + vec2(0.37, 0.71)).rgb * 0.38) / mn; }\n" +
    "vec2 rjNrm(sampler2D t, vec2 uv) { return (texture2D(t, uv).rg * 0.62 + texture2D(t, uv * 0.29 + vec2(0.37, 0.71)).rg * 0.38) * 2.0 - 1.0; }\n";
  const decl = (names) => names.map((n) => "uniform sampler2D rjT_" + n + ";" + (/normal/.test(n) ? "" : " uniform vec3 rjM_" + n + ";")).join("\n") + "\n";
  const bind = (sh, names) => { for (const n of names) { sh.uniforms["rjT_" + n] = T.u[n]; sh.uniforms["rjM_" + n] = T.m[n]; } };

  /** Terrain (world.js, standard quality): call inside its onBeforeCompile after its own replacements.
   * Cliffs are textured triplanar (projected from all three axes and blended by the surface normal), so a sheer face
   * gets real rock instead of the mesh's vertex colours stretched into vertical streaks; three scales (near, mid and a
   * far macro scale) keep the rock structured from a few metres out to the horizon. Flat ground keeps its biome
   * colours with grass / snow / sand grain on top, plus a macro layer so distant valleys don't read as smooth paint. */
  const TERR = ["grass_albedo", "grass_normal", "rock_albedo", "rock_normal", "cliff_albedo", "cliff_normal", "snow_albedo", "snow_normal", "sand_albedo", "sand_normal"];
  const TRI = "vec3 rjTri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }\n" +
    "vec3 rjTriN(sampler2D t, vec3 p, vec3 w, vec3 sg) { vec2 a = texture2D(t, p.zy).rg * 2.0 - 1.0, b = texture2D(t, p.xz).rg * 2.0 - 1.0, c = texture2D(t, p.xy).rg * 2.0 - 1.0;\n" +
    "  return vec3(0.0, a.y, a.x * sg.x) * w.x + vec3(b.x, 0.0, b.y * sg.y) * w.y + vec3(c.x * sg.z, c.y, 0.0) * w.z; }\n";
  T.terrain = function (sh) {
    T.load(); bind(sh, TERR);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + decl(TERR) + DET + TRI)
      .replace("#include <roughnessmap_fragment>", [
        "float rjFar = 1.0 - smoothstep(2500.0, 14000.0, vVD);",
        "vec3 rjWn = normalize(vWN); vec3 rjTW = pow(abs(rjWn), vec3(4.0)); rjTW /= (rjTW.x + rjTW.y + rjTW.z);",
        // weights: rock on steep ground, snow where the snow colouring is, beach sand just above the sea, grass elsewhere
        "float rjWR = smoothstep(0.3, 0.55, rjSteep), rjWS = clamp(rjSnowV, 0.0, 1.0) * (1.0 - rjWR * 0.6), rjWC = smoothstep(10.0, 3.0, vWP.y) * (1.0 - rjWR) * (1.0 - rjWS);",
        "float rjWG = max(0.0, 1.0 - rjWR - rjWS - rjWC); float rjWt = rjWR + rjWS + rjWC + rjWG + 1e-4;",
        "vec2 rjTU = vWP.xz / 26.0, rjTR = vWP.xz / 30.0;",
        // ground grain near, and a macro layer far out (aerial texture at 20x the scale)
        "vec3 rjDt = (rjDet(rjT_grass_albedo, rjM_grass_albedo, rjTU) * rjWG + rjDet(rjT_snow_albedo, rjM_snow_albedo, rjTU * 1.6) * rjWS + rjDet(rjT_sand_albedo, rjM_sand_albedo, rjTU * 1.3) * rjWC + vec3(rjWR)) / rjWt;",
        "vec3 rjMacT = rjDet(rjT_rock_albedo, rjM_rock_albedo, vWP.xz / 640.0) * 0.5 + rjDet(rjT_grass_albedo, rjM_grass_albedo, vWP.xz / 260.0) * 0.5;",
        "diffuseColor.rgb *= mix(vec3(1.0), clamp(rjDt, 0.35, 1.9), rjFade * 0.8);",
        "diffuseColor.rgb *= mix(vec3(1.0), clamp(rjMacT, 0.5, 1.6), 0.8 * rjFar * (1.0 - rjWR));",
        // natural greens: pull minty blue-greens toward olive / sap green (real vegetation reflects little blue)
        "float rjGr = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 6.0, 0.0, 1.0);",
        "diffuseColor.rgb *= mix(vec3(1.0), vec3(1.07, 0.97, 0.76), rjGr * 0.75);",
        // cliffs: triplanar rock at three scales, over a rock colour that is mostly regional (so the vertex colours'
        // streaks fade out) and partly the local biome tint (so cliffs still sit in their landscape)
        "vec3 rjC1 = rjTri(rjT_cliff_albedo, vWP / 24.0, rjTW), rjC2 = rjTri(rjT_cliff_albedo, vWP / 95.0 + 0.37, rjTW), rjC3 = rjTri(rjT_rock_albedo, vWP / 420.0 + 0.71, rjTW);",
        "vec3 rjCl3 = mix(rjC3 / rjM_rock_albedo, mix(rjC2, rjC1, 0.55) / rjM_cliff_albedo, rjFade * 0.85 + 0.15);",
        "float rjLm = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));",
        "vec3 rjRockBase = mix(vec3(rjLm) * vec3(1.08, 1.0, 0.88), vec3(0.43, 0.4, 0.355) * (0.82 + 0.36 * rjMac), 0.6);",
        "vec3 rjRock = rjRockBase * clamp(rjCl3, 0.3, 2.0);",
        "diffuseColor.rgb = mix(diffuseColor.rgb, rjRock, rjWR * (1.0 - rjSnowV * 0.85) * mix(0.75, 1.0, rjFar));",
        "#include <roughnessmap_fragment>"
      ].join("\n"))
      .replace("#include <normal_fragment_maps>", [
        "#include <normal_fragment_maps>",
        "{ vec2 rjN = (rjNrm(rjT_grass_normal, rjTU) * rjWG + rjNrm(rjT_snow_normal, rjTU * 1.6) * rjWS + rjNrm(rjT_sand_normal, rjTU * 1.3) * rjWC) / rjWt;",
        "  vec3 rjSg = sign(rjWn);",
        "  vec3 rjNC = rjTriN(rjT_cliff_normal, vWP / 24.0, rjTW, rjSg) * 0.55 * rjFade + rjTriN(rjT_cliff_normal, vWP / 95.0 + 0.37, rjTW, rjSg) * 0.5 + rjTriN(rjT_rock_normal, vWP / 420.0 + 0.71, rjTW, rjSg) * 0.6 * rjFar;",
        "  vec3 rjNW = vec3(rjN.x, 0.0, -rjN.y) * 0.7 * rjFade * (1.0 - rjWR) + rjNC * rjWR;",
        "  normal = normalize(normal + (viewMatrix * vec4(rjNW, 0.0)).xyz); }"
      ].join("\n"));
  };

  /** Surface detail on any standard material: kind = concrete | asphalt | metal | rust.
   * space "world" projects from above (ground pieces); "object" projects in the model's own frame (things that move). */
  T.detail = function (mat, kind, o) {
    o = Object.assign({ space: "world", scale: 8, albedo: 0.7, normal: 0.8, rough: 0 }, o);
    const names = [kind + "_albedo", kind + "_normal"].concat(o.rough ? [kind + "_roughness"] : []);
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : "") + "|rjtex:" + kind + o.space + o.scale + o.albedo + o.normal + o.rough;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      T.load(); bind(sh, names);
      const A = "rjT_" + kind + "_albedo", MA = "rjM_" + kind + "_albedo", N = "rjT_" + kind + "_normal", obj = o.space === "object";
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRjTP; varying vec3 vRjTN; varying vec3 vRjX; varying vec3 vRjY; varying vec3 vRjZ;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + (obj ? "vRjTP = transformed; vRjTN = objectNormal; vRjX = normalMatrix * vec3(1.0, 0.0, 0.0); vRjY = normalMatrix * vec3(0.0, 1.0, 0.0); vRjZ = normalMatrix * vec3(0.0, 0.0, 1.0);" : "vRjTP = (modelMatrix * vec4(transformed, 1.0)).xyz; vRjTN = vec3(0.0, 1.0, 0.0);"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRjTP; varying vec3 vRjTN; varying vec3 vRjX; varying vec3 vRjY; varying vec3 vRjZ;\n" + decl(names) + DET)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          // object space: project along the dominant axis of the surface (cheap triplanar)
          "vec3 rjAN = abs(normalize(vRjTN)); vec2 rjUV = (rjAN.y > max(rjAN.x, rjAN.z) ? vRjTP.xz : rjAN.x > rjAN.z ? vRjTP.zy : vRjTP.xy) / " + o.scale.toFixed(2) + ";",
          "diffuseColor.rgb *= mix(vec3(1.0), clamp(rjDet(" + A + ", " + MA + ", rjUV), 0.4, 1.8), " + o.albedo.toFixed(2) + ");"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + (o.rough ? "roughnessFactor = clamp(roughnessFactor * (0.7 + 0.6 * texture2D(rjT_" + kind + "_roughness, rjUV).g), 0.04, 1.0);" : ""))
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ vec2 rjN = rjNrm(" + N + ", rjUV) * " + o.normal.toFixed(2) + "; " +
          (obj ? "vec3 rjP = rjAN.y > max(rjAN.x, rjAN.z) ? vec3(rjN.x, 0.0, rjN.y) : rjAN.x > rjAN.z ? vec3(0.0, rjN.y, rjN.x) : vec3(rjN.x, rjN.y, 0.0); normal = normalize(normal + vRjX * rjP.x + vRjY * rjP.y + vRjZ * rjP.z);"
            : "normal = normalize(normal + (viewMatrix * vec4(rjN.x, 0.0, -rjN.y, 0.0)).xyz);") + " }");
    };
    mat.needsUpdate = true;
    return mat;
  };
})(window.RJ);
