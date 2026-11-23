/* Jet City — physically based sky (Bruneton precomputed atmospheric scattering, @takram/three-atmosphere, MIT).
 * Multiple scattering gives the real colours a single-scattering sky can't: the deep blue zenith, the pale
 * horizon band, the long pink-and-orange twilight wedge, the Earth's shadow after sunset.
 * The lookup tables are generated on the player's GPU at start (no download). The game's flat world is placed on
 * the WGS84 Earth at a real latitude/longitude through a local east-north-up frame. The sky's brightness is
 * matched to the game's own tuned exposure by sampling the horizon now and then and comparing it with the fog
 * colour the game's lighting model chose, and the fog then takes the sky's real horizon colour so the two always
 * meet without a seam. world.js draws it in place of the old dome (Settings > Graphics > Realistic sky). */
import * as THREE from "three";
import { SkyMaterial, PrecomputedTexturesGenerator } from "@takram/three-atmosphere";
import { Ellipsoid, Geodetic, radians } from "@takram/three-geospatial";

export function createSky(renderer, lat = 40.7, lon = -74.0) {
  const A = { ready: false, failed: false, k: 0.06, fog: new THREE.Color(), hasFog: false };
  const mat = new SkyMaterial({ sun: true, moon: true });
  // exposure + the game's display-referred output (its post chain decodes with gamma 2.2)
  mat.uniforms.rjExposure = { value: A.k };
  const baseCompile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    baseCompile(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("precision highp sampler3D;", "precision highp sampler3D;\nuniform float rjExposure;")
      .replace("outputColor.a = 1.0;", "outputColor.a = 1.0;\n  outputColor.rgb = pow(max(outputColor.rgb * rjExposure, 0.0), vec3(1.0 / 2.2));");
  };
  mat.customProgramCacheKey = () => "rjSky";
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);

  // world (x east, y up, z south) -> ECEF, through the east-north-up frame at (lat, lon) on the ellipsoid
  const origin = new Geodetic(radians(lon), radians(lat), 0).toECEF();
  const enu = Ellipsoid.WGS84.getEastNorthUpFrame(origin, new THREE.Matrix4());
  const swap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // (x,y,z) -> (e=x, n=-z, u=y)
  const w2e = new THREE.Matrix4().multiplyMatrices(enu, swap);
  mat.uniforms.worldToECEFMatrix.value.copy(w2e);
  const rot = new THREE.Matrix3().setFromMatrix4(w2e);
  A.w2e = w2e;

  const gen = new PrecomputedTexturesGenerator(renderer);
  gen.update().then((tex) => { Object.assign(mat, tex); A.ready = true; }).catch((e) => { A.failed = true; console.warn("Realistic sky unavailable", e); });

  // horizon sampler: a small low-resolution view sideways to the sun, read back once a second
  const rt = new THREE.WebGLRenderTarget(16, 8, { depthBuffer: false });
  const sc = new THREE.PerspectiveCamera(30, 2, 1, 10);
  const px = new Uint8Array(16 * 8 * 4);
  let sampleT = 0;
  const _d = new THREE.Vector3();

  A.setSun = (sunDirWorld, moonDirWorld) => {
    mat.sunDirection.copy(_d.copy(sunDirWorld).applyMatrix3(rot).normalize());
    if (moonDirWorld) mat.moonDirection.copy(_d.copy(moonDirWorld).applyMatrix3(rot).normalize());
  };
  /** Draw the sky into the current target with `cam`, after keeping exposure and fog in step with the game. */
  A.render = (r, cam, gameFog, sunDirWorld, dt) => {
    if (!A.ready) return false;
    A.setSun(sunDirWorld);
    sampleT -= dt || 0.016;
    if (sampleT <= 0 && gameFog) {
      sampleT = 1.0;
      const prevT = r.getRenderTarget(), ac = r.autoClear;
      sc.position.copy(cam.position);
      // look horizontally, 90 degrees round from the sun, a degree above the horizon: the typical haze colour
      const az = Math.atan2(sunDirWorld.x, sunDirWorld.z) + Math.PI / 2;
      sc.lookAt(cam.position.x + Math.sin(az), cam.position.y + 0.02, cam.position.z + Math.cos(az));
      sc.updateMatrixWorld(); sc.updateProjectionMatrix();
      r.setRenderTarget(rt); r.autoClear = true; r.render(scene, sc);
      r.readRenderTargetPixels(rt, 0, 0, 16, 8, px);
      r.setRenderTarget(prevT); r.autoClear = ac;
      let R = 0, G = 0, B = 0; for (let i = 0; i < px.length; i += 4) { R += px[i]; G += px[i + 1]; B += px[i + 2]; }
      const n = px.length / 4 * 255; R /= n; G /= n; B /= n;
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const ls = lum([R, G, B]), lg = lum([gameFog.r, gameFog.g, gameFog.b]);
      if (ls > 0.002 && lg > 0.002) {
        // displayed value ~ (radiance k)^(1/2.2): move k towards the brightness the game's own sky would have
        const want = A.k * Math.pow(lg / ls, 2.2);
        A.k = THREE.MathUtils.clamp(A.k + (want - A.k) * (A.hasFog ? 0.5 : 1), 1e-5, 50);
      }
      A.fog.setRGB(R, G, B); A.hasFog = true;
    }
    mat.uniforms.rjExposure.value = A.k;
    r.render(scene, cam);
    return true;
  };
  A.material = mat;
  return A;
}
