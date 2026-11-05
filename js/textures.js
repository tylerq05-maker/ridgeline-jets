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
    "asphalt_albedo", "asphalt_normal", "metal_albedo", "metal_normal", "metal_roughness", "rust_albedo", "rust_normal"];
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

  /** Terrain (world.js, standard quality): call inside its onBeforeCompile after its own replacements. */
  const TERR = ["grass_albedo", "grass_normal", "rock_albedo", "snow_albedo", "snow_normal", "sand_albedo", "sand_normal"];
  T.terrain = function (sh) {
    T.load(); bind(sh, TERR);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + decl(TERR) + DET)
      .replace("#include <roughnessmap_fragment>", [
        // weights: rock on steep ground, snow where the snow colouring is, beach sand just above the sea, grass elsewhere
        "float rjWR = smoothstep(0.38, 0.62, rjSteep), rjWS = clamp(rjSnowV, 0.0, 1.0) * (1.0 - rjWR * 0.6), rjWC = smoothstep(10.0, 3.0, vWP.y) * (1.0 - rjWR) * (1.0 - rjWS);",
        "float rjWG = max(0.0, 1.0 - rjWR - rjWS - rjWC); float rjWt = rjWR + rjWS + rjWC + rjWG + 1e-4;",
        "vec2 rjTU = vWP.xz / 26.0, rjTR = mix(vWP.xz, vec2(vWP.x + vWP.z, vWP.y), smoothstep(0.55, 0.85, rjSteep)) / 30.0;",
        "vec3 rjDt = (rjDet(rjT_grass_albedo, rjM_grass_albedo, rjTU) * rjWG + rjDet(rjT_rock_albedo, rjM_rock_albedo, rjTR) * rjWR + rjDet(rjT_snow_albedo, rjM_snow_albedo, rjTU * 1.6) * rjWS + rjDet(rjT_sand_albedo, rjM_sand_albedo, rjTU * 1.3) * rjWC) / rjWt;",
        "diffuseColor.rgb *= mix(vec3(1.0), clamp(rjDt, 0.35, 1.9), rjFade * 0.8);",
        "#include <roughnessmap_fragment>"
      ].join("\n"))
      .replace("#include <normal_fragment_maps>", [
        "#include <normal_fragment_maps>",
        "{ vec2 rjN = (rjNrm(rjT_grass_normal, rjTU) * rjWG + rjNrm(rjT_snow_normal, rjTU * 1.6) * rjWS + rjNrm(rjT_sand_normal, rjTU * 1.3) * rjWC + rjNrm(rjT_grass_normal, rjTR) * rjWR * 0.7) / rjWt;",
        "  normal = normalize(normal + (viewMatrix * vec4(rjN.x, 0.0, -rjN.y, 0.0)).xyz * 0.7 * rjFade); }"
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
