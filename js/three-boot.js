/* Jet City — loads three.js r170 (ES modules) and hands it to the game's classic scripts as the global THREE,
 * the way r128's three.min.js did. All game scripts are `defer`, so they run after this module, in order.
 * The game was built and tuned on r128, so r128's look is reproduced exactly:
 *   · no automatic colour-space conversion (the game's post chain does its own gamma) and linear output;
 *   · r128's light scale: direct, ambient and hemisphere irradiance x PI (r128's non-physical lighting mode,
 *     removed in r165) and its distance falloff for point / spot lights, whose default decay goes back to 1.
 * The loaders the game used to fetch as r128 classic scripts are attached to THREE here. */
import * as T from "three";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "./vendor/three/addons/loaders/RGBELoader.js";
import * as SkeletonUtils from "./vendor/three/addons/utils/SkeletonUtils.js";

const THREE = Object.assign({}, T);
THREE.GLTFLoader = GLTFLoader;
THREE.RGBELoader = RGBELoader;
THREE.SkeletonUtils = SkeletonUtils;
THREE.REVISION_NUM = +T.REVISION;

// colour: as r128 (no sRGB conversions anywhere unless a texture asks for one)
T.ColorManagement.enabled = false;

// lighting: r128's legacy (non-physical) light units
const C = T.ShaderChunk;
const swap = (name, a, b) => { if (C[name].indexOf(a) < 0) { console.warn("three-boot: chunk " + name + " changed; legacy lighting patch skipped"); return; } C[name] = C[name].split(a).join(b); };
swap("lights_physical_pars_fragment", "vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color * PI;");
swap("lights_physical_pars_fragment", "vec3 ccIrradiance = dotNLcc * directLight.color;", "vec3 ccIrradiance = dotNLcc * directLight.color * PI;");
swap("lights_lambert_pars_fragment", "vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color * PI;");
swap("lights_phong_pars_fragment", "vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color * PI;");
swap("lights_toon_pars_fragment", "* directLight.color;", "* directLight.color * PI;");
swap("lights_pars_begin", "vec3 irradiance = ambientLightColor;", "vec3 irradiance = ambientLightColor * PI;");
swap("lights_pars_begin", "vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );", "vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight ) * PI;");
swap("lights_pars_begin",
  "float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );\n\tif ( cutoffDistance > 0.0 ) {\n\t\tdistanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );\n\t}\n\treturn distanceFalloff;",
  "if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {\n\t\treturn pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );\n\t}\n\treturn 1.0;");
if (C.lights_fragment_maps.indexOf("vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;") >= 0) swap("lights_fragment_maps", "vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;", "vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * PI;");
// ---------------------------------------------------------------------------------------------------------------
// Realistic lighting ("linear light"): every lit material does its lighting maths on light values instead of screen
// values. Colours, textures, lights and the sky probe stay as the game wrote them (screen values); the lit material
// shaders decode them to linear light, light the surface, and encode the result back, so everything downstream
// (sky, effects, post chain) is untouched. Light colours keep their intensity linear (only the hue is decoded).
// Off with settings.linearLight === false (Settings → Graphics) or ?legacylight in the address.
const LIN = (() => { try { if (/[?&]legacylight\b/.test(location.search)) return false; const s = JSON.parse(localStorage.getItem("rj3-settings") || "{}"); return s.linearLight === true; } catch (e) { return false; } })();
THREE.RJ_LINEAR = LIN;
if (LIN) {
  C.common += "\nvec3 rjDec(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); }\nvec3 rjEnc(vec3 c){ return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }\n" +
    "vec3 rjDecL(vec3 c){ float m = max(max(c.r, c.g), max(c.b, 1e-4)); return rjDec(c / m) * m; }\n";
  const lit = (name, a, b) => { if (C[name] && C[name].indexOf(a) >= 0) C[name] = C[name].split(a).join(b); else console.warn("three-boot: linear-light patch skipped in " + name); };
  // lights: direct (sun, moon, point, spot), ambient, hemisphere
  for (const n of ["lights_physical_pars_fragment", "lights_lambert_pars_fragment", "lights_phong_pars_fragment"]) lit(n, "dotNL * directLight.color * PI", "dotNL * rjDecL( directLight.color ) * PI");
  lit("lights_physical_pars_fragment", "dotNLcc * directLight.color * PI", "dotNLcc * rjDecL( directLight.color ) * PI");
  lit("lights_pars_begin", "vec3 irradiance = ambientLightColor * PI;", "vec3 irradiance = rjDecL( ambientLightColor ) * PI;");
  lit("lights_pars_begin", "vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight ) * PI;", "vec3 irradiance = mix( rjDecL( hemiLight.groundColor ), rjDecL( hemiLight.skyColor ), hemiDiffuseWeight ) * PI;");
  // image-based light: the sky probe was captured in screen values
  lit("envmap_physical_pars_fragment", "return PI * envMapColor.rgb * envMapIntensity;", "return PI * rjDec( envMapColor.rgb ) * envMapIntensity;");
  lit("envmap_physical_pars_fragment", "return envMapColor.rgb * envMapIntensity;", "return rjDec( envMapColor.rgb ) * envMapIntensity;");
  // the material's own colour (after textures, vertex colours and the game's shader patches) and its glow
  const PRE = { meshphysical: "#include <lights_physical_fragment>", meshlambert: "#include <lights_lambert_fragment>", meshphong: "#include <lights_phong_fragment>" };
  for (const k in PRE) {
    const L = T.ShaderLib[k]; if (!L) continue;
    let f = L.fragmentShader;
    f = f.replace(PRE[k], "diffuseColor.rgb = rjDec( diffuseColor.rgb );\n\t" + PRE[k]);
    f = f.replace("vec3 outgoingLight =", "totalEmissiveRadiance = rjDec( totalEmissiveRadiance );\n\tvec3 outgoingLight =");
    f = f.replace("#include <opaque_fragment>", "outgoingLight = rjEnc( outgoingLight );\n\t#include <opaque_fragment>");
    L.fragmentShader = f;
  }
}

// r128 point and spot lights defaulted to decay 1
THREE.PointLight = class PointLight extends T.PointLight { constructor(color, intensity, distance, decay = 1) { super(color, intensity, distance, decay); } };
THREE.SpotLight = class SpotLight extends T.SpotLight { constructor(color, intensity, distance, angle, penumbra, decay = 1) { super(color, intensity, distance, angle, penumbra, decay); } };

// if index.html fell back to the r128 build (a browser without import maps that still ran this module somehow),
// leave that build in place rather than mixing two versions
if (!(window.THREE && window.THREE.REVISION === "128")) window.THREE = THREE;
