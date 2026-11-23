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
// r128 point and spot lights defaulted to decay 1
THREE.PointLight = class PointLight extends T.PointLight { constructor(color, intensity, distance, decay = 1) { super(color, intensity, distance, decay); } };
THREE.SpotLight = class SpotLight extends T.SpotLight { constructor(color, intensity, distance, angle, penumbra, decay = 1) { super(color, intensity, distance, angle, penumbra, decay); } };

// if index.html fell back to the r128 build (a browser without import maps that still ran this module somehow),
// leave that build in place rather than mixing two versions
if (!(window.THREE && window.THREE.REVISION === "128")) window.THREE = THREE;
