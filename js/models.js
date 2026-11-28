/* Jet City — optional glTF airframes (agent A).
 *
 * RJ.models.register(id, { url, rotY, credit }) swaps an aircraft's procedural airframe skin for a .glb once it has
 * loaded. The procedural build stays the source of truth: its dims, cockpit/tip/flame/nozzle hooks, gear,
 * lights and pilot are kept, and the glTF is fitted to the procedural bounding box (nose -Z, up +Y). Loading is
 * asynchronous; until it finishes, or if it fails, the procedural model is shown. GLTFLoader (vendored r128,
 * js/vendor/GLTFLoader.js) is only fetched when a model is actually registered.
 *
 * No airframe is registered by default: no CC0 / public-domain / CC-BY model of the game's jets was found in
 * reachable sources (see assets/CREDITS-A.md). To add one: put the .glb in assets/aircraft/, credit it in
 * assets/CREDITS-A.md, and call RJ.models.register("f22", { url: "assets/aircraft/f22.glb", rotY: 0 }). */
(function (RJ) {
  "use strict";
  const REG = {}, cache = {};
  let loaderP = null;
  const Mo = { REG };
  RJ.models = Mo;

  Mo.register = function (id, o) { REG[id] = Object.assign({ rotY: 0 }, o); };
  Mo.has = (id, livery) => !!(REG[id + ":" + livery] || REG[id]);
  Mo.load = (url) => fetchModel(url); // shared .glb loading (weapons.js), with the base64 text fallback

  let skelP = null;
  const skel = () => THREE.SkeletonUtils ? Promise.resolve() : (skelP = skelP || new Promise((res, rej) => { const s = document.createElement("script"); s.src = "js/vendor/SkeletonUtils.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
  const isRigged = (o) => { let r = false; o.traverse((q) => { if (q.isSkinnedMesh) r = true; }); return r; };
  const _v = new THREE.Vector3();
  /** World-space sample points of a model, posed by its skeleton where it has one (rigged files' raw vertices are not to scale). */
  function points(o, max = 6000) {
    o.updateMatrixWorld(true); const out = [];
    o.traverse((m) => {
      if (!m.isMesh) return;
      const P = m.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
      for (let i = 0; i < P.count && out.length < max; i += step) { _v.fromBufferAttribute(P, i); if (m.isSkinnedMesh) m.boneTransform(i, _v); out.push(_v.clone().applyMatrix4(m.matrixWorld)); }
    });
    return out;
  }
  /** Yaw that turns the nose to -Z: the longest horizontal axis is the fuselage, and the nose is its narrower end. */
  function autoYaw(pts) {
    let mx = 0, mz = 0; for (const p of pts) { mx += p.x; mz += p.z; } mx /= pts.length; mz /= pts.length;
    let a = 0, b = 0, c = 0; for (const p of pts) { const x = p.x - mx, z = p.z - mz; a += x * x; b += x * z; c += z * z; }
    const th = 0.5 * Math.atan2(2 * b, a - c), dx = Math.cos(th), dz = Math.sin(th);
    let lo = Infinity, hi = -Infinity; for (const p of pts) { const t = (p.x - mx) * dx + (p.z - mz) * dz; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const span = (sel) => { let m = 0; for (const p of pts) { const t = ((p.x - mx) * dx + (p.z - mz) * dz - lo) / (hi - lo); if (sel(t)) m = Math.max(m, Math.abs(-(p.x - mx) * dz + (p.z - mz) * dx)); } return m; };
    const s = span((t) => t < 0.15) < span((t) => t > 0.85) ? -1 : 1;
    const nx = dx * s, nz = dz * s; // three.js yaw θ maps (x, z) to (x cosθ + z sinθ, -x sinθ + z cosθ); want (0, -1)
    return Math.atan2(nx, -nz);
  }
  function loader() {
    if (THREE.GLTFLoader) return Promise.resolve(new THREE.GLTFLoader());
    if (!loaderP) loaderP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "js/vendor/GLTFLoader.js";
      s.onload = () => (THREE.GLTFLoader ? res() : rej(new Error("GLTFLoader missing")));
      s.onerror = () => rej(new Error("GLTFLoader script failed to load"));
      document.head.appendChild(s);
    });
    return loaderP.then(() => new THREE.GLTFLoader());
  }
  function fetchModel(url) {
    // hosts that can't serve .glb (the claude.ai artifact) get the same bytes as base64 text: url + ".b64.txt"
    // big models come in numbered parts (url + ".b64.0.txt", ".b64.1.txt", …) to stay under the host's per-file limit
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    const parts = (i, acc) => get(url + ".b64." + i + ".txt").then((t) => parts(i + 1, acc + t.trim()), (e) => { if (!i) throw e; return acc; });
    const viaText = (ld) => get(url + ".b64.txt").catch(() => parts(0, "")).then((t) => {
      const bin = atob(t.trim()), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Promise((res, rej) => ld.parse(u8.buffer, url.replace(/[^/]*$/, ""), (gl) => { gl.scene.animations = gl.animations || []; res(gl.scene); }, rej));
    });
    if (!cache[url]) cache[url] = loader().then((ld) => new Promise((res, rej) => ld.load(url, (gl) => { gl.scene.animations = gl.animations || []; res(gl.scene); }, undefined, rej)).catch(() => viaText(ld)));
    return cache[url];
  }

  /* ---------- PBR clean-up of the downloaded materials ----------
   * The Sketchfab exports are inconsistent: glTF's default metallicFactor is 1 (so untextured paint renders as a
   * dark mirror), some are unlit (KHR_materials_unlit: no shading at all), roughness ranges from mirror to chalk
   * and canopies are flat alpha planes. Each source material is fixed once (cached), shared by every clone. */
  const pbrCache = new Map();
  const GLASS = /glass|canopy|window|windshield|visor|lens/i, METAL = /metal|chrome|engine|nozzle|exhaust|steel|titan|burner|dvig/i;
  function glassMat(src, ac) {
    const c = src.color ? src.color.clone() : new THREE.Color(0x9fb3c4);
    // stealth canopies carry a gold (ITO) coating; others are a faint smoky blue-grey
    const gold = ac.stealth > 1.5;
    if (c.r + c.g + c.b > 2.4 || c.r + c.g + c.b < 0.15) c.set(gold ? 0x8a7a4a : 0x6d7f8f);
    const m = new THREE.MeshPhysicalMaterial({
      name: src.name, color: c, map: src.map && src.map.image ? src.map : null, roughness: 0.035, metalness: gold ? 0.5 : 0.12,
      // files with an opaque canopy may have nothing modelled underneath: keep those mostly opaque, glossy glass
      clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: src.transparent ? RJ.clamp(src.opacity, gold ? 0.5 : 0.32, 0.6) : 0.84,
      depthWrite: false, side: src.side, envMapIntensity: 1.45
    });
    if (RJ.acGlassify) RJ.acGlassify(m); // Fresnel: clear head-on, mirror-like at grazing angles (aircraft.js)
    m.userData.rjGlass = true;
    return m;
  }
  function pbr(src, ac) {
    if (!src || src.userData.rjPBR) return src;
    if (pbrCache.has(src)) return pbrCache.get(src);
    let m = src;
    const name = src.name || "";
    const isGlass = GLASS.test(name) || (src.transmission > 0) || (src.transparent && src.opacity < 0.75 && !src.alphaMap && !/plume|flame/i.test(name));
    if (src.isMeshStandardMaterial && src.type !== "MeshStandardMaterial" && src.type !== "MeshPhysicalMaterial") m = src; // spec-gloss extension material: leave its own model
    else if (isGlass && (src.isMeshStandardMaterial || src.isMeshBasicMaterial)) m = glassMat(src, ac);
    else if (src.isMeshBasicMaterial) {
      // unlit export: give it real shading
      m = new THREE.MeshStandardMaterial({ name, color: src.color, map: src.map, alphaMap: src.alphaMap, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side, vertexColors: src.vertexColors, roughness: 0.5, metalness: 0.15 });
    } else if (src.isMeshStandardMaterial) {
      const stealth = ac.stealth > 1.5, metal = METAL.test(name);
      // painted skin is a dielectric: several exports set metallicFactor 1 (some over a metal/rough map), which renders paint as a dark mirror
      if (!metal && src.metalness > 0.35) src.metalness = stealth ? 0.08 : src.metalnessMap ? 0.15 : 0.2;
      if (metal) { src.metalness = Math.max(src.metalness, 0.75); src.roughness = RJ.clamp(src.roughness, 0.22, 0.6); }
      else if (!src.roughnessMap) src.roughness = RJ.clamp(src.roughness, stealth ? 0.5 : 0.32, stealth ? 0.8 : 0.72);
      if (src.isMeshPhysicalMaterial) { src.clearcoat = Math.min(src.clearcoat || 0, stealth ? 0.15 : 0.5); src.clearcoatRoughness = Math.max(src.clearcoatRoughness || 0, 0.08); src.transmission = 0; }
      if (src.envMapIntensity === 1) src.envMapIntensity = stealth ? 0.7 : metal ? 1.15 : 0.95;
    }
    m.userData.rjPBR = true;
    pbrCache.set(src, m);
    return m;
  }

  /* ---------- control surfaces ----------
   * Models whose ailerons, flaps, elevators and rudders are separate named nodes get them hinged (pivot at the
   * leading edge; all-moving tails at ~35 % chord) and handed to the flight code's existing surface lists, which
   * drive them from the stick, rudder and speed brake. Files without separable nodes keep a static skin. */
  const SURF = [
    [/elev|stabilat|h[-_ ]?stab/i, "stabs", 0.35],
    [/aileron|flaperon/i, "ailerons", 0],
    [/flap/i, "flaps", 0],
    [/rudder/i, "rudders", 0]
  ];
  const comp = (A, i, k) => (k === 0 ? A.getX(i) : k === 1 ? A.getY(i) : k === 2 ? A.getZ(i) : A.getW(i)); // r128 has no getComponent
  /** World box of the vertices a bone carries (rigged files hinge their surfaces with bones). */
  function boneBox(root, bone) {
    const wb = new THREE.Box3(), v = new THREE.Vector3();
    root.traverse((m) => {
      if (!m.isSkinnedMesh || !m.skeleton) return;
      const bi = m.skeleton.bones.indexOf(bone);
      if (bi < 0) return;
      const SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight, P = m.geometry.attributes.position;
      if (!SI || !SW) return;
      for (let i = 0; i < P.count; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (comp(SI, i, k) === bi) w += comp(SW, i, k);
        if (w < 0.5) continue;
        v.fromBufferAttribute(P, i); m.boneTransform(i, v); wb.expandByPoint(v.applyMatrix4(m.matrixWorld));
      }
    });
    return wb;
  }
  function localBox(g, o, root) {
    const wb = o.isBone ? boneBox(root, o) : new THREE.Box3().setFromObject(o);
    if (wb.isEmpty()) return null;
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), lb = new THREE.Box3(), p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) lb.expandByPoint(p.set(i & 1 ? wb.max.x : wb.min.x, i & 2 ? wb.max.y : wb.min.y, i & 4 ? wb.max.z : wb.min.z).applyMatrix4(inv));
    return lb;
  }
  function rigSurfaces(g, skin) {
    if (RJ.noRig) return 0;
    const U = g.userData, found = [];
    skin.traverse((q) => {
      if (q === skin || !q.name) return;
      for (const [re, list, at] of SURF) if (re.test(q.name)) { found.push({ q, list, at }); break; }
    });
    // keep only the outermost match (a named group and its own named mesh child would rotate twice)
    const set = new Set(found.map((f) => f.q));
    const top = found.filter((f) => { for (let p = f.q.parent; p; p = p.parent) if (set.has(p)) return false; return true; });
    if (!top.length) return 0;
    g.updateMatrixWorld(true);
    const span = U.dims ? U.dims.span : 10, rigged = { stabs: [], ailerons: [], flaps: [], rudders: [] };
    for (const { q, list, at } of top) {
      const b = localBox(g, q, skin);
      if (RJ.debugSurf) console.log("surf", q.name, q.isBone, b && b.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(","));
      if (!b) continue;
      const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
      if (sz.z < 0.05 || sz.z > U.dims.len * 0.5) continue; // not a surface (or a whole-airframe node)
      const piv = new THREE.Group();
      piv.position.set(c.x, c.y, b.min.z + sz.z * at);
      g.add(piv); piv.updateMatrixWorld(true);
      piv.attach(q);
      const s = Math.abs(c.x) < span * 0.03 ? 0 : Math.sign(c.x);
      rigged[list].push(list === "stabs" ? { grp: piv, s: s || 1, canard: false } : { grp: piv, s: list === "rudders" ? s : s || 1, kind: list });
    }
    // the glTF surfaces replace the (now hidden) procedural ones of the same kind
    let n = 0;
    for (const k in rigged) if (rigged[k].length) { U[k] = rigged[k]; n += rigged[k].length; }
    U.gltfSurfaces = n;
    return n;
  }

  /* Some files' "paint" is unusable: the F-22's skin texture is a photo of a jet against the sky, which samples as
   * near-black, and several parts are 0x040404-0x1e1e1e. Files registered with repaint get the game's own livery
   * paint (colour, roughness, metalness of the procedural body) on their textured and near-black surfaces. */
  const paintCache = new WeakMap();
  function repaint(mt, o, M) {
    if (!o.repaint || !M || !M.body || !mt || mt.userData.rjGlass || !mt.isMeshStandardMaterial) return mt;
    const lum = mt.color ? mt.color.r * 0.3 + mt.color.g * 0.59 + mt.color.b * 0.11 : 1;
    const glow = mt.emissive && (mt.emissive.r + mt.emissive.g + mt.emissive.b) > 0.05;
    if (glow || !(mt.map || lum < 0.13)) return mt;
    let per = paintCache.get(M.body); if (!per) paintCache.set(M.body, (per = new Map()));
    const key = mt.map ? "skin" : "dark";
    if (!per.has(key)) {
      const b = M.body, c = b.color.clone();
      if (key === "dark") c.multiplyScalar(0.72); // intakes, bays and trim read a shade darker than the skin
      const p = new THREE.MeshStandardMaterial({ name: "rjPaint-" + key, color: c, roughness: b.roughness, metalness: b.metalness, side: THREE.DoubleSide, envMapIntensity: b.envMapIntensity });
      if (b.userData.rjPat) p.userData.rjPat = b.userData.rjPat;
      p.userData.rjPBR = true;
      per.set(key, p);
    }
    return per.get(key);
  }

  /** Called by RJ.buildAircraft after the procedural build. Never throws; the procedural model stays on failure. */
  Mo.apply = function (g, id, livery) {
    const o = REG[id + ":" + livery] || REG[id]; // a paint-specific model (e.g. "fa18e:blueangels") wins
    if (!o) return;
    fetchModel(o.url).then((src) => (isRigged(src) ? skel().then(() => src) : src)).then((src) => {
      if (g.userData.disposed) return;
      const M = g.userData.materials || {}, d = g.userData.dims;
      const skin = isRigged(src) ? THREE.SkeletonUtils.clone(src) : src.clone(true);
      // parts the file carries in alternative states (gear down, spare weapon rails) are left out
      if (o.hide) { const re = o.hide, drop = []; skin.traverse((q) => { if (q !== skin && re.test(q.name || "")) drop.push(q); }); for (const q of drop) if (q.parent) q.parent.remove(q); }
      // the files' own exhaust plumes would double the game's afterburner flames
      if (o.hideMat) { const drop = []; skin.traverse((q) => { if (q.isMesh) { const ms = Array.isArray(q.material) ? q.material : [q.material]; if (ms.some((mt) => o.hideMat.test(mt.name || ""))) drop.push(q); } }); for (const q of drop) q.parent.remove(q); } // removed, so they don't stretch the fitted length
      if (o.quat) skin.quaternion.fromArray(o.quat); else skin.rotation.y = o.auto ? autoYaw(points(skin)) : o.rotY || 0; // quat: files posed off-axis
      skin.updateMatrixWorld(true);
      // fit to the procedural airframe: same length, centred on its bounding box
      const bb = isRigged(skin) ? new THREE.Box3().setFromPoints(points(skin)) : new THREE.Box3().setFromObject(skin), sz = bb.getSize(new THREE.Vector3());
      const s = d.len / Math.max(1e-3, sz.z);
      const holder = new THREE.Group();
      holder.add(skin);
      holder.scale.setScalar(s);
      const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(s);
      holder.position.set(-c.x, d.minY + d.height * 0.5 - c.y, (d.minZ + d.maxZ) * 0.5 - c.z);
      const ac = (RJ.AIRCRAFT && RJ.AIRCRAFT[id]) || {};
      skin.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        if (Array.isArray(m.material)) m.material = m.material.map((mt) => repaint(pbr(mt, ac), o, M));
        else m.material = repaint(pbr(m.material, ac), o, M);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (mats.some((mt) => mt.userData.rjGlass)) m.castShadow = false;
        if (RJ.lighting && RJ.lighting.track) RJ.lighting.track(mats);
      });
      // hide the procedural skin, keeping gear, flames, nozzles, lights, pilot and anything animated
      const skinMats = new Set([M.body, M.trim, M.facet, M.glass, M.accent].filter(Boolean));
      const keep = new Set();
      g.traverse((q) => { if (q.userData && q.userData.rjGear) q.traverse((r) => keep.add(r)); });
      g.traverse((m) => { if (m.isMesh && skinMats.has(m.material) && !keep.has(m)) m.visible = false; });
      g.add(holder);
      g.userData.gltf = holder;
      // a few files model their own landing gear (always down, sometimes rigged to bones): the game's animated gear
      // legs stay in charge, so collapse the file's copy (bones are scaled to nothing, plain meshes hidden)
      skin.traverse((q) => {
        if (!/gear/i.test(q.name || "") || (q.parent && /gear/i.test(q.parent.name || ""))) return;
        if (q.isBone) q.scale.setScalar(1e-4); else q.visible = false;
      });
      try { rigSurfaces(g, skin); } catch (e) { console.warn("control surfaces of " + id + " left static", e && e.message); }
      if (RJ.acLights) RJ.acLights.refit(g, ac, holder); // lamps onto the real model's wingtips, spine and tail
    }).catch((e) => console.warn("Aircraft model " + id + " unavailable; using the procedural airframe", e && e.message ? e.message : e));
  };

  /* Airframes from Sketchfab, all CC BY 4.0 (credits in assets/CREDITS-A.md and on the main menu). Textures were
     downscaled to <= 2048 px. rotY turns each file's nose onto -Z (measured from the meshes). */
  const SF = "assets/aircraft/";
  Mo.register("f22", { url: SF + "f22.glb", rotY: -Math.PI / 2, hideMat: /plume/i, repaint: true, credit: "Lockheed Martin F-22 Raptor by andertan (CC BY 4.0)" });
  Mo.register("su57", { url: SF + "su57.glb", rotY: -Math.PI / 2, credit: "Sukhoi Su-57 Felon by andertan (CC BY 4.0)" });
  Mo.register("sr71", { url: SF + "sr71.glb", rotY: -0.9146, credit: "SR-71 by manilov.ap (CC BY 4.0)" });
  Mo.register("b2", { url: SF + "b2.glb", rotY: 0, credit: "Lowpoly B-2 Spirit bomber by SIpriv (CC BY 4.0)" });
  Mo.register("f117", { url: SF + "f117.glb", rotY: Math.PI, credit: "F-117 Nighthawk with GBU-12 by Jeyhun1985 (CC BY 4.0)" });
  Mo.register("fa18e:blueangels", { url: SF + "fa18e_ba.glb", rotY: -Math.PI / 2, credit: "Blue Angels FA/18 by Aidan McTaggart (CC BY 4.0)" });
  Mo.register("yf23", { url: SF + "yf23.glb", quat: [-0.4967, 0.1579, -0.0924, 0.8484], credit: "YF-23 Black Jet Fighter by Mymeria (CC BY 4.0)" });
  Mo.register("xb70", { url: SF + "xb70.glb", rotY: 0, credit: "North American XB-70 Valkyrie by Muhamad Mirza Arrafi (CC BY 4.0)" });
  Mo.register("b52", { url: SF + "b52.glb", rotY: Math.PI, credit: "Boeing B-52 Stratofortress by hruschak30 (CC BY 4.0)" });
  Mo.register("x15", { url: SF + "x15.glb", rotY: -Math.PI / 2, credit: "North American X-15 Plane by cmoreau (CC BY 4.0)" });
  // the intro opens on the Blue Angels: start fetching their model with the page, not when the jets are built
  setTimeout(() => fetchModel(REG["fa18e:blueangels"].url).catch(() => {}), 0);
  Mo.register("f16", { url: SF + "f16.glb", rotY: 0, credit: "F16-C Falcon by Carlos.Maciel (CC BY 4.0)" });
  Mo.register("a10", { url: SF + "a10.glb", rotY: Math.PI, credit: "A10 Thunderbolt II by blarg (CC BY 4.0)" });
  Mo.register("fa18e", { url: SF + "fa18e.glb", rotY: -1.0751, credit: "US Navy F/A-18E Super Hornet by johnnokomis (CC BY 4.0)" });
  Mo.register("f14", { url: SF + "f14.glb", rotY: Math.PI, credit: "F-14 TOMCAT by Ryan.Qin (CC BY 4.0)" });
  // F-15C file disabled: its rig is posed inconsistently (tails, intakes and canopy float off the airframe and the
  // tails hang below it in flight), so the built-in F-15 is used until a cleaner model is downloaded
  // Mo.register("f15c", { url: SF + "f15c.glb", auto: true, credit: "F 15C Desert by Uxman (CC BY 4.0)" });
  Mo.register("a380", { url: SF + "a380.glb", rotY: Math.PI, credit: "Airbus A380 - 841 Lufthansa 100th Year by Nobilis 2 (CC BY 4.0)" });
  Mo.register("f35a", { url: SF + "f35a.glb", rotY: Math.PI / 2, hide: /landingOn|spw\d|refuel/i, credit: "F-35 Lightning II by CloudHub (CC BY 4.0)" });
})(window.RJ);
