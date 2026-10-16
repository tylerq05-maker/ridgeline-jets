/* Ridgeline Jets — the Coastal Carrier.
 * A Nimitz-class-style supercarrier at anchor offshore: lofted hull, angled flight deck with painted
 * markings, island with rotating radar, deck-edge and centreline lights, four arresting wires, bow
 * catapults, parked Hornets and an optical landing system ("meatball") that reacts to the player's
 * glide path. Local frame: bow toward -z, starboard +x, sea level y = 0. */
(function (RJ) {
  "use strict";
  const K = (RJ.carrier = {});
  K.DECK = 20.6;               // flight deck surface height above the sea
  K.LEN = 332;
  // angled landing area: starts near the stern ramp, angled 9° to port
  K.ANG = 9 * Math.PI / 180;
  K.LAND = { x: -6, z: 150 };  // stern end of the landing centreline
  K.WIRES = [44, 56, 68, 80]; // distance of each wire from the ramp along the landing line
  K.CATS = [{ x: -9, z: -38 }, { x: 11, z: -38 }];
  const OUTLINE = [[-5, -168], [5, -168], [22, -122], [33, -64], [37, 30], [36, 120], [33, 166], [-20, 166], [-28, 128], [-41, 52], [-41, 6], [-30, -40], [-18, -120]];
  K.OUTLINE = OUTLINE;

  function deckTexture() {
    const W = 256, H = 1024, sx = W / 84, sz = H / 340;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const X = (x) => (x + 42) * sx, Z = (z) => (z + 170) * sz;
    g.fillStyle = "#3d4043"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = 50 + Math.random() * 22; g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`; g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }
    // tire marks around the landing area
    g.strokeStyle = "rgba(15,15,15,0.18)"; g.lineWidth = 2;
    for (let i = 0; i < 60; i++) { const z0 = 40 + Math.random() * 120, x0 = -12 + Math.random() * 10; g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x0 - Math.sin(K.ANG) * 60), Z(z0 - Math.cos(K.ANG) * 60)); g.stroke(); }
    const line = (x0, z0, x1, z1, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); g.setLineDash([]); };
    // landing area: edge lines and dashed centreline along the angled deck
    const L0 = K.LAND, dx = -Math.sin(K.ANG), dz = -Math.cos(K.ANG), px = -dz, pz = dx;
    for (const o of [-12, 12]) line(L0.x + px * o, L0.z + pz * o, L0.x + px * o + dx * 230, L0.z + pz * o + dz * 230, "#e8e2c8", 2);
    line(L0.x, L0.z, L0.x + dx * 230, L0.z + dz * 230, "#f2f2ec", 2, [12, 10]);
    // foul line and the four wires
    line(L0.x + px * 14 + dx * 120, L0.z + pz * 14 + dz * 120, 30, -10, "#d93b2e", 2, [6, 4]);
    for (const w of K.WIRES) line(L0.x + px * -13 + dx * w, L0.z + pz * -13 + dz * w, L0.x + px * 13 + dx * w, L0.z + pz * 13 + dz * w, "#c8a640", 2);
    // catapult tracks and the bow number
    for (const ct of K.CATS) { line(ct.x, ct.z, ct.x, -160, "#2a2c2e", 4); line(ct.x, ct.z, ct.x, -160, "#ffd34d", 1, [4, 8]); }
    line(4, 20, 4, -160, "#e8e2c8", 1.5, [10, 12]);
    g.save(); g.translate(X(0), Z(-140)); g.fillStyle = "#e9e9e2"; g.font = "bold 46px sans-serif"; g.textAlign = "center"; g.scale(1, 1.6); g.fillText("77", 0, 0); g.restore();
    // elevator outlines on the starboard side
    g.strokeStyle = "rgba(230,200,60,0.6)"; g.lineWidth = 1.5;
    for (const z0 of [-80, -30, 70]) g.strokeRect(X(23), Z(z0), 14 * sx, 22 * sz);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  function hullGeometry() {
    // lofted stations from bow (-z) to stern (+z): [z, half beam at deck, half beam at waterline, keel half]
    const ST = [[-166, 3, 0.6, 0.2], [-150, 12, 4, 1], [-125, 19, 11, 3], [-90, 22, 17, 6], [-40, 23, 19.5, 8], [40, 23, 19.5, 8], [110, 22, 18, 7], [150, 20, 15, 5], [166, 18, 13, 3]];
    const pos = [], idx = [];
    const ring = [[-1, 20], [-1, 0], [-1, -11], [1, -11], [1, 0], [1, 20]]; // side, y with half-beam picked per row
    ST.forEach(([z, hd, hw, hk]) => {
      for (const [sd, y] of ring) { const hb = y >= 20 ? hd : y >= 0 ? hw : hk; pos.push(sd * hb, y, z); }
    });
    const R = ring.length;
    for (let i = 0; i < ST.length - 1; i++) for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // stern transom
    const s = (ST.length - 1) * R;
    idx.push(s, s + 5, s + 1, s + 1, s + 5, s + 4, s + 1, s + 4, s + 2, s + 2, s + 4, s + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const ng = geo.toNonIndexed(); ng.computeVertexNormals();
    return ng;
  }

  K.build = function (site) {
    const grp = new THREE.Group();
    grp.position.set(site.x, 0, site.z);
    grp.rotation.y = site.heading;
    const gray = new THREE.MeshStandardMaterial({ color: 0x6b7279, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.7, metalness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: 0x5d2a26, roughness: 0.8 });
    const hull = new THREE.Mesh(hullGeometry(), gray); hull.castShadow = hull.receiveShadow = true; grp.add(hull);
    // boot topping: dark band at the waterline
    const band = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 300), red); band.position.set(0, -0.6, 10); grp.add(band);
    // flight deck plate with painted markings (UVs from the outline in metres)
    const shp = new THREE.Shape(); OUTLINE.forEach(([x, z], i) => (i ? shp.lineTo(x, -z) : shp.moveTo(x, -z)));
    const dg = new THREE.ExtrudeGeometry(shp, { depth: 1.2, bevelEnabled: false });
    dg.rotateX(-Math.PI / 2); dg.translate(0, K.DECK - 1.2, 0);
    const uv = dg.attributes.uv, P = dg.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (P.getX(i) + 42) / 84, 1 - (P.getZ(i) + 170) / 340);
    const deck = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.82, metalness: 0.1 }));
    deck.receiveShadow = true; deck.castShadow = true; grp.add(deck);
    // sponson structure under the deck overhang
    const sp = new THREE.Mesh(new THREE.BoxGeometry(62, 6, 300), dark); sp.position.set(-2, K.DECK - 4.5, 0); grp.add(sp);
    // island superstructure on the starboard edge
    const isl = new THREE.Group(); isl.position.set(29, K.DECK, 34); grp.add(isl);
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || gray); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; isl.add(b); return b; };
    box(10, 14, 34, 0, 7, 0); box(9, 6, 26, 0, 17, -2); box(8, 5, 18, 0, 22.5, -4);
    box(8.6, 1.6, 12, 0, 25.6, -6, new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.1, metalness: 0.8, emissive: 0x05121a })); // bridge windows
    box(1.4, 16, 1.4, 0, 33, -2, dark); box(6, 0.6, 0.6, 0, 37, -2, dark);
    K.radar = box(7, 2.2, 0.5, 0, 41.5, -2, dark);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.5 })); dome.position.set(0, 30, 6); isl.add(dome);
    const num = document.createElement("canvas"); num.width = 128; num.height = 64; const ng = num.getContext("2d"); ng.fillStyle = "#e8e8e2"; ng.font = "bold 52px sans-serif"; ng.textAlign = "center"; ng.fillText("77", 64, 52);
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(num), transparent: true })); nm.position.set(-5.1, 16, 8); nm.rotation.y = -Math.PI / 2; isl.add(nm);
    // arresting wires
    const dx = -Math.sin(K.ANG), dz = -Math.cos(K.ANG), px = -dz, pz = dx;
    const wireM = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 });
    for (const w of K.WIRES) {
      const cx = K.LAND.x + dx * w, cz = K.LAND.z + dz * w;
      const wm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 30, 5), wireM);
      wm.rotation.z = Math.PI / 2; wm.rotation.y = -K.ANG; wm.position.set(cx, K.DECK + 0.25, cz); grp.add(wm);
    }
    // deck-edge lights, landing centreline lights and the optical landing system
    const lp = [];
    for (let s = 0; s <= 230; s += 10) { for (const o of [-13, 13]) lp.push(K.LAND.x + px * o + dx * s, K.DECK + 0.4, K.LAND.z + pz * o + dz * s); lp.push(K.LAND.x + dx * s, K.DECK + 0.35, K.LAND.z + dz * s); }
    for (let z = -160; z <= 160; z += 16) lp.push(36, K.DECK + 0.4, z);
    const lg = new THREE.SphereGeometry(0.35, 6, 4);
    K.lightM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const li = new THREE.InstancedMesh(lg, K.lightM, lp.length / 3), m4 = new THREE.Matrix4();
    for (let i = 0; i < lp.length / 3; i++) { m4.makeTranslation(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]); li.setMatrixAt(i, m4); }
    grp.add(li);
    // "meatball": green datum bars with an amber ball that moves with the player's glide-slope error
    const ols = new THREE.Group(); ols.position.set(-38, K.DECK + 2.5, 92); ols.rotation.y = Math.PI / 2 - K.ANG; grp.add(ols);
    const lm = (c) => new THREE.MeshBasicMaterial({ color: c });
    K.datum = lm(new THREE.Color(0.2, 3, 0.5));
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.2), K.datum); b.position.set(s * (2 + k * 1.1), 0, 0); ols.add(b); }
    K.ballM = lm(new THREE.Color(3.5, 1.8, 0.3));
    K.ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), K.ballM); ols.add(K.ball);
    const ovb = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 0.6), dark); ovb.position.set(0, 0, -0.5); ols.add(ovb);
    // parked Hornets on the bow and alongside the island
    if (RJ.buildAircraft) [[16, -100, 0.4], [26, -60, 0.6], [24, -14, 1.1], [-20, -128, -0.3]].forEach(([x, z, r]) => {
      try {
        const m = RJ.buildAircraft("fa18e"), d = m.userData.dims;
        m.position.set(x, K.DECK + (d.gearH || 2.2), z); m.rotation.y = r;
        m.userData.flames.forEach((f) => { f.flame.visible = false; f.glow.visible = false; });
        grp.add(m);
      } catch (e) { console.warn(e); }
    });
    grp.updateMatrixWorld(true);
    K.group = grp; K.site = site;
    return grp;
  };

  /* ---------------- queries ---------------- */
  function toLocal(x, z) {
    const s = K.site, dx = x - s.x, dz = z - s.z, c = Math.cos(s.heading), n = Math.sin(s.heading);
    return [dx * c - dz * n, dx * n + dz * c];
  }
  K.toLocal = toLocal;
  K.toWorld = function (lx, lz) { const s = K.site, c = Math.cos(s.heading), n = Math.sin(s.heading); return [s.x + lx * c + lz * n, s.z - lx * n + lz * c]; };
  function inOutline(x, z) {
    let inside = false;
    for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
      const [xi, zi] = OUTLINE[i], [xj, zj] = OUTLINE[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  /** Top of the ship at (x, z): deck, island, or -Infinity off the ship. */
  K.heightAt = function (x, z) {
    if (!K.site) return -Infinity;
    const dx = x - K.site.x, dz = z - K.site.z;
    if (dx * dx + dz * dz > 200 * 200) return -Infinity;
    const [lx, lz] = toLocal(x, z);
    if (Math.abs(lx - 29) < 5.5 && Math.abs(lz - 34) < 17) return K.DECK + 28;
    if (inOutline(lx, lz)) return K.DECK;
    // hull below the overhang
    if (Math.abs(lx) < 23 && Math.abs(lz) < 166) return K.DECK - 2;
    return -Infinity;
  };
  K.onDeck = (x, z) => { if (!K.site) return false; const [lx, lz] = toLocal(x, z); return inOutline(lx, lz); };
  /** Landing geometry in world space: touchdown point, landing direction and the glide slope (3.5°). */
  K.landingFrame = function () {
    const dx = -Math.sin(K.ANG), dz = -Math.cos(K.ANG);
    const aim = (K.WIRES[1] + K.WIRES[2]) / 2;
    const [ax, az] = K.toWorld(K.LAND.x + dx * aim, K.LAND.z + dz * aim);
    const [ex, ez] = K.toWorld(K.LAND.x + dx * (aim + 100), K.LAND.z + dz * (aim + 100));
    const L = Math.hypot(ex - ax, ez - az);
    return { x: ax, z: az, y: K.DECK, dir: { x: (ex - ax) / L, z: (ez - az) / L }, slope: 3.5 * Math.PI / 180 };
  };
  /** Which wire (1-4) a touchdown at world (x, z) would catch, or 0 if outside the landing area. */
  K.wireAt = function (x, z) {
    const [lx, lz] = toLocal(x, z);
    const dx = -Math.sin(K.ANG), dz = -Math.cos(K.ANG);
    const s = (lx - K.LAND.x) * dx + (lz - K.LAND.z) * dz;
    const off = (lx - K.LAND.x) * -dz + (lz - K.LAND.z) * dx;
    if (Math.abs(off) > 13) return 0;
    for (let i = 0; i < K.WIRES.length; i++) if (s >= K.WIRES[i] - 7 && s < K.WIRES[i] + 6) return i + 1;
    return s < K.WIRES[0] - 7 ? -1 : 0;
  };

  K.update = function (dt, player) {
    if (!K.group) return;
    K.radar.rotation.y += dt * 2.4;
    const W = RJ.world, night = RJ.clamp(1 - RJ.smooth(-3, 10, W.sunElev), 0, 1);
    K.lightM.color.setRGB(2.4, 2.2, 1.6).multiplyScalar(0.15 + night * 0.9);
    // meatball: ball rides above the datum when high, below when low
    let err = 0;
    if (player && player.alive) {
      const L = K.landingFrame(), rx = player.pos.x - L.x, rz = player.pos.z - L.z;
      const back = -(rx * L.dir.x + rz * L.dir.z);
      if (back > 50 && back < 6000) err = ((player.pos.y - L.y) - Math.tan(L.slope) * back) / Math.max(back * 0.02, 4);
    }
    K.ball.position.y = RJ.clamp(err, -2.8, 2.8);
    K.ballM.color.setRGB(err < -2 ? 3.5 : 3.5, err < -2 ? 0.3 : 1.8, 0.3);
  };
})(window.RJ);
