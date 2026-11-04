/* Jet City — selectable missile and bomb models (hangar loadout).
 * The meshes come from one pack, "Missile & Bomb Collection - Fighter Jets - Free" by bohmerang (Sketchfab,
 * CC BY-NC-SA 4.0; textures downscaled, see assets/CREDITS-A.md). Each entry below names a node of the pack and an
 * effects profile: a missilefx.js type derived from the stock ir / radar / heavy ones, so every weapon has its own
 * motor, trail, ignition delay, turn limit and warhead. The player's choice (RJ.settings.weapons[aircraftId] =
 * { m, b }) is hung on the jet's existing missile stations, flies as the fired missile and falls as the dropped
 * bomb. AI jets keep their stock stores. To add a weapon: put its node in a pack and add a row to LIST. */
(function (RJ) {
  "use strict";
  const W = (RJ.weapons = { ready: false });
  const URL = "assets/weapons/pack.glb";
  const LIST = [
    // id, pack node, name, kind (m missile · b bomb), effects base, effect overrides
    ["aim9", "AIM-9 Sidewinder", "AIM-9 Sidewinder", "m", "ir", { len: 2.9, ign: 0.05, g: 40, flame: 0xffa040, trail: { life: 10, s0: 0.9, s1: 9 } }],
    ["aim7", "AIM-7 Sparrow", "AIM-7 Sparrow", "m", "radar", { len: 3.66, ign: 0.25, trail: { life: 19, s1: 18, gray: 0.97, alpha: 0.66 } }],
    ["r27", "R-27", "R-27 (Alamo)", "m", "radar", { len: 4.0, r: 0.12, ign: 0.2, flame: 0xff9030, boom: 1.15, trail: { life: 16, s0: 1.7, s1: 19, gray: 0.9 } }],
    ["r27e", "R-27 (2)", "R-27E (extended range)", "m", "radar", { len: 4.8, r: 0.13, ign: 0.24, boost: 1.7, flame: 0xff8a28, boom: 1.2, trail: { life: 18, s0: 1.9, s1: 21, gray: 0.88 } }],
    ["r77", "R-77", "R-77 (Adder)", "m", "radar", { len: 3.6, ign: 0.15, boost: 1.9, g: 34, flame: 0xffb050, trail: { life: 14, s0: 1.6, s1: 20, gray: 0.93 } }],
    ["pl11", "PL-11", "PL-11", "m", "radar", { len: 3.9, ign: 0.18, flame: 0xffc070, trail: { life: 13, s1: 15, alpha: 0.45 } }],
    ["pl11b", "PL-11 (2)", "PL-11 (variant)", "m", "radar", { len: 3.9, ign: 0.18, flame: 0xffc070, trail: { life: 13, s1: 15, alpha: 0.45 } }],
    ["ty90", "TY-90", "TY-90", "m", "ir", { len: 1.9, r: 0.045, ign: 0.03, g: 46, boom: 0.6, flame: 0xffd080, trail: { life: 6, s0: 0.6, s1: 5, alpha: 0.4 } }],
    ["agm65", "AGM-65 Maverick", "AGM-65 Maverick", "m", "heavy", { len: 2.5, r: 0.15, ign: 0.35, g: 20, boom: 1.8, flame: 0xff6a18, trail: { life: 20, s0: 2.6, s1: 28, gray: 0.8 } }],
    ["kh29", "Kh-29", "Kh-29 (Kedge)", "m", "heavy", { len: 3.9, r: 0.2, ign: 0.4, g: 18, boom: 2.1, flame: 0xff5a10, trail: { life: 18, s0: 2.8, s1: 30, gray: 0.74, alpha: 0.72 } }],
    ["hj10", "HJ-10", "HJ-10", "m", "heavy", { len: 1.8, r: 0.09, ign: 0.12, g: 30, boom: 1.2, trail: { life: 9, s0: 1.2, s1: 12, gray: 0.86 } }],
    ["hellfire", "AGM-114 Hellfire", "AGM-114 Hellfire", "m", "ir", { len: 1.63, r: 0.09, ign: 0.1, g: 36, boom: 1.3, flame: 0xffc060, trail: { life: 8, s0: 1.0, s1: 10, gray: 0.84 } }],
    ["jdam", "JDAM", "GBU-31 JDAM", "b", null, { len: 3.9 }],
    ["jdam2", "JDAM (2)", "GBU-38 JDAM", "b", null, { len: 2.4 }],
    ["gbu12", "GBU-12 Paveway II", "GBU-12 Paveway II", "b", null, { len: 3.3 }],
    ["kab500", "KAB-500L", "KAB-500L", "b", null, { len: 3.05 }]
  ];
  W.LIST = LIST.map(([id, node, name, kind, base, o]) => ({ id, node, name, kind, base, o, fx: base ? "w_" + id : null, len: o.len }));
  W.byId = (id) => W.LIST.find((w) => w.id === id) || null;

  // effects profiles: copies of the stock missile types with this weapon's own motor, trail and warhead
  const MF = RJ.missileFx;
  if (MF && MF.TYPES) for (const w of W.LIST) if (w.base) {
    const B = MF.TYPES[w.base];
    MF.TYPES[w.fx] = Object.assign({}, B, w.o, { name: w.name, trail: Object.assign({}, B.trail, w.o.trail || {}) });
  }

  /** The player's selection for an aircraft: { m: weapon|null, b: weapon|null }. */
  W.selection = (acId) => {
    const s = (RJ.settings.weapons || {})[acId] || {};
    return { m: W.byId(s.m), b: W.byId(s.b) };
  };
  W.select = (acId, kind, id) => {
    const all = Object.assign({}, RJ.settings.weapons), s = Object.assign({}, all[acId]);
    s[kind] = id || null; all[acId] = s; RJ.settings.weapons = all; RJ.saveSettings();
  };

  /* ---------- the pack: one load, split into nose -Z, unit-length templates ---------- */
  const TPL = {};
  let loading = null;
  const v = new THREE.Vector3();
  function template(node) {
    node.updateMatrixWorld(true);
    const pts = [];
    node.traverse((m) => {
      if (!m.isMesh) return;
      const P = m.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
      for (let i = 0; i < P.count; i += step) pts.push(v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).clone());
    });
    if (!pts.length) return null;
    const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const ax = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z", L = size[ax];
    // the tail end carries the fins, so its cross-section is wider: the nose is the narrower end
    const spread = (lo) => { let r = 0; for (const p of pts) { const t = (p[ax] - box.min[ax]) / L; if (lo ? t < 0.15 : t > 0.85) { const q = p.clone().sub(c); q[ax] = 0; r = Math.max(r, q.length()); } } return r; };
    const nose = new THREE.Vector3(); nose[ax] = spread(true) < spread(false) ? -1 : 1;
    const inner = node.clone(true); inner.matrixAutoUpdate = false; inner.matrix.copy(node.matrixWorld);
    const mid = new THREE.Group(); mid.position.copy(c).negate(); mid.add(inner);
    const t = new THREE.Group(); t.add(mid);
    t.quaternion.setFromUnitVectors(nose, new THREE.Vector3(0, 0, -1)); t.scale.setScalar(1 / L);
    const out = new THREE.Group(); out.add(t);
    out.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return out;
  }
  W.load = function () {
    if (!loading) loading = (RJ.models && RJ.models.load ? RJ.models.load(URL) : Promise.reject(new Error("no loader"))).then((scene) => {
      const root = scene.getObjectByName("GLTF_SceneRootNode") || scene;
      scene.updateMatrixWorld(true);
      // GLTFLoader sanitises node names (spaces become "_"), so compare letters and digits only
      const key = (n) => n.replace(/_\d+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      for (const ch of root.children) { const w = W.LIST.find((x) => key(x.node) === key(ch.name)); if (w) TPL[w.id] = template(ch); }
      W.ready = true;
      return TPL;
    }).catch((e) => { console.warn("Weapon models unavailable; stock missiles stay", e && e.message ? e.message : e); return TPL; });
    return loading;
  };
  /** A model of weapon w, `len` metres long, nose -Z. */
  W.model = (w, len) => { const t = TPL[w.id]; if (!t) return null; const m = t.clone(true); m.scale.setScalar(len || w.len); return m; };

  /* ---------- on the jet: aircraft.js builds the missile stations as groups and calls these ---------- */
  let building = null;
  /** Called by modes.js / the hangar just before building the player's jet. */
  W.next = (acId) => { building = W.selection(acId).m ? acId : null; };
  /** aircraft.js: is the airframe being built getting a selected missile (so skip the stock missile mesh)? */
  W.buildingFor = (acId) => building === acId;
  /** aircraft.js, after the build: hang the selected missile on every station. */
  W.mount = function (g, acId) {
    if (building !== acId) return;
    building = null;
    const w = W.selection(acId).m, st = g.userData.stores;
    if (!w || !st || !st.length) return;
    g.userData.wpn = w;
    W.load().then(() => { for (const s of st) { const m = W.model(w, s.len); if (m) s.grp.add(m); } });
  };
  /** The player's aircraft: what it fires and drops. */
  W.arm = function (ac) {
    const s = W.selection(ac.spec.id);
    ac._wpn = s.m && ac.mesh.userData.wpn ? s.m : null;
    ac._bombW = s.b && ac.bombs > 0 ? s.b : null;
    if (ac._wpn || ac._bombW) W.load();
  };
  /** Empty stations as missiles leave the rails. */
  W.sync = function (ac) {
    const st = ac.mesh.userData.stores, n = (ac.spec.msl && ac.spec.msl.n) || 0;
    if (!st || !n) return;
    if (ac.isPlayer && RJ.game && RJ.game.mode && RJ.game.mode.infMsl) {
      // unlimited missiles: the station it left from stays empty for a moment, then is reloaded
      const k = (ac._wpnK = ((ac._wpnK || 0) + 1) % st.length), g = st[k].grp;
      g.visible = false; setTimeout(() => { g.visible = true; }, 4000);
      return;
    }
    const keep = Math.ceil(st.length * Math.max(0, ac.missiles) / n);
    st.forEach((s, i) => { s.grp.visible = i < keep; });
  };
  /** A fired missile (missilefx mesh): swap the stock hardware for the selected model, keep the motor fire. */
  W.dress = function (mesh, w) {
    const m = W.model(w, (MF.TYPES[w.fx] || {}).len || w.len);
    if (!m) return;
    const keep = new Set();
    for (const nm of ["mflame", "mglow", "mspr"]) { const o = mesh.getObjectByName(nm); if (o) o.traverse((q) => keep.add(q)); }
    mesh.traverse((o) => { if (o.isMesh && !keep.has(o)) o.visible = false; });
    mesh.add(m);
  };
  /** A dropped bomb's mesh. */
  W.bombMesh = (w) => { const g = new THREE.Group(), m = W.model(w); if (m) g.add(m); return g; };
})(window.RJ);
