/* Ridgeline Jets — heads-up display, radar, cockpit frame, target and warning symbology. */
(function (RJ) {
  "use strict";
  const H = {};
  RJ.hud = H;
  const V3 = RJ.V3, DEG = RJ.DEG;
  const COLORS = { green: "#8dffb0", amber: "#ffc04a", white: "#e8f2ff" };
  const RED = "#ff5a4f", BLUE = "#6cc4ff", YEL = "#ffb81c";
  let cv, x, W = 0, Hh = 0, DPR = 1;
  const tv = V3(), tv2 = V3();

  H.init = function (canvas) { cv = canvas; x = cv.getContext("2d"); H.resize(); };
  H.resize = function () {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; Hh = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(Hh * DPR);
  };
  H.clear = function () { x.setTransform(DPR, 0, 0, DPR, 0, 0); x.clearRect(0, 0, W, Hh); };
  H.hitFlash = 0;

  const pA = V3(), pB = V3();
  function proj(p, cam) {
    pB.copy(p);
    const v = pA.copy(pB).applyMatrix4(cam.matrixWorldInverse);
    const vz = v.z, vx = v.x, vy = v.y;
    const n = pA.copy(pB).project(cam);
    return { x: (n.x + 1) / 2 * W, y: (1 - n.y) / 2 * Hh, on: vz < 0 && Math.abs(n.x) < 1 && Math.abs(n.y) < 1, front: vz < 0, vx, vy, vz };
  }
  function font(px, mono = true) { x.font = `${px}px ${mono ? '"Share Tech Mono", ui-monospace, monospace' : '"Saira", sans-serif'}`; }
  // dark outline under every glyph keeps the HUD readable over bright cloud and snow
  function text(s, px, py, align = "left", size = 14) {
    font(size); x.textAlign = align;
    const sb = x.shadowBlur; x.shadowBlur = 0;
    x.lineWidth = Math.max(2.5, size * 0.2); x.strokeStyle = "rgba(0,0,0,0.55)"; x.lineJoin = "round";
    x.strokeText(s, px, py);
    x.shadowBlur = sb; x.strokeStyle = x.fillStyle; x.lineWidth = 1.6;
    x.fillText(s, px, py);
  }
  function edgeArrow(s, color, label) {
    let dx = s.vx, dy = -s.vy;
    if (!s.front && Math.hypot(dx, dy) < 1e-3) dy = 1;
    const a = Math.atan2(dy, dx), rx = W / 2 - 60, ry = Hh / 2 - 70;
    const px = W / 2 + Math.cos(a) * rx, py = Hh / 2 + Math.sin(a) * ry;
    x.save(); x.translate(px, py); x.rotate(a); x.fillStyle = color;
    x.beginPath(); x.moveTo(15, 0); x.lineTo(-8, -10); x.lineTo(-3, 0); x.lineTo(-8, 10); x.closePath(); x.fill(); x.restore();
    if (label) { x.fillStyle = color; text(label, px - Math.cos(a) * 30, py - Math.sin(a) * 24 + 4, "center", 12); }
  }

  /* ---------------- Cockpit frame ---------------- */
  function cockpitFrame(pl) {
    const hist = pl.spec.cat === "historic" || pl.spec.hudStyle === "gunsight";
    const bomber = pl.spec.cat === "bomber" || pl.spec.cat === "airliner";
    x.save();
    x.fillStyle = "rgba(14,17,21,0.96)";
    const top = Hh * (bomber ? 0.7 : 0.76);
    x.beginPath(); x.moveTo(0, Hh); x.lineTo(0, top + 30); x.quadraticCurveTo(W * 0.25, top - 6, W * 0.5, top - 10); x.quadraticCurveTo(W * 0.75, top - 6, W, top + 30); x.lineTo(W, Hh); x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.08)"; x.lineWidth = 2; x.stroke();
    // instruments
    const cy = top + (Hh - top) * 0.55;
    if (hist) {
      x.strokeStyle = "rgba(220,220,200,0.55)"; x.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        const cx = W / 2 + i * Math.min(110, W * 0.13), r = Math.min(34, W * 0.04);
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
        const val = i === -2 ? pl.speed / 220 : i === -1 ? pl.pos.y / 9000 : i === 0 ? 0.5 + pl.bank / Math.PI : i === 1 ? pl.throttle : (pl.g + 2) / 9;
        const a = -Math.PI * 0.75 + RJ.clamp(val, 0, 1) * Math.PI * 1.5;
        x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a - Math.PI / 2) * r * 0.8, cy + Math.sin(a - Math.PI / 2) * r * 0.8); x.stroke();
      }
    } else {
      const mw = Math.min(150, W * 0.18), mh = Math.min(100, (Hh - top) * 0.6);
      [-1, 0, 1].forEach((i) => {
        const cx = W / 2 + i * (mw + 16) - mw / 2, y0 = cy - mh / 2;
        x.fillStyle = "rgba(25,32,30,0.95)"; x.fillRect(cx, y0, mw, mh);
        x.strokeStyle = "rgba(141,255,176,0.22)"; x.lineWidth = 1; x.strokeRect(cx, y0, mw, mh);
        x.fillStyle = "rgba(141,255,176,0.55)";
        if (i === -1) { text("ENG", cx + 8, y0 + 16, "left", 11); x.fillRect(cx + 8, y0 + mh - 14, (mw - 16) * pl.throttle, 6); x.fillStyle = "rgba(255,160,60,0.7)"; x.fillRect(cx + 8, y0 + mh - 24, (mw - 16) * pl.abLevel, 6); }
        if (i === 0) { text("SA", cx + 8, y0 + 16, "left", 11); x.beginPath(); x.arc(cx + mw / 2, y0 + mh / 2 + 6, mh * 0.32, 0, Math.PI * 2); x.stroke(); x.fillRect(cx + mw / 2 - 2, y0 + mh / 2 + 4, 4, 4); }
        if (i === 1) { text("STORES", cx + 8, y0 + 16, "left", 11); text(`MSL ${RJ.game.mode && RJ.game.mode.infMsl ? "∞" : pl.missiles}  FLR ${pl.flares}`, cx + 8, y0 + 36, "left", 11); text(`HP ${Math.round(pl.hp / pl.maxHp * 100)}%`, cx + 8, y0 + 54, "left", 11); }
      });
    }
    // canopy bow / frame
    x.strokeStyle = "rgba(14,17,21,0.95)"; x.lineWidth = hist ? 10 : 6;
    if (hist) {
      x.beginPath(); x.moveTo(W * 0.18, top); x.lineTo(W * 0.3, 0); x.moveTo(W * 0.82, top); x.lineTo(W * 0.7, 0); x.stroke();
      x.beginPath(); x.moveTo(0, Hh * 0.18); x.quadraticCurveTo(W / 2, Hh * 0.05, W, Hh * 0.18); x.stroke();
    } else {
      x.beginPath(); x.moveTo(W * 0.06, top + 20); x.quadraticCurveTo(W * 0.02, Hh * 0.3, W * 0.12, 0); x.moveTo(W * 0.94, top + 20); x.quadraticCurveTo(W * 0.98, Hh * 0.3, W * 0.88, 0); x.stroke();
    }
    x.restore();
  }

  /* ---------------- Main draw ---------------- */
  H.draw = function (s) {
    H.clear();
    const pl = s.player, cam = s.camera;
    if (!pl || s.camMode === "cinematic") return;
    if (s.camMode === "cockpit" && !s.cockpit3d) cockpitFrame(pl);
    if (!RJ.settings.hud) return;
    const C = COLORS[RJ.settings.hudColor] || COLORS.green;
    x.strokeStyle = C; x.fillStyle = C; x.lineWidth = 1.6;
    x.shadowColor = "rgba(0,0,0,0.85)"; x.shadowBlur = 4;
    const cx = W / 2, cy = Hh / 2;
    const gunsight = pl.spec.hudStyle === "gunsight";
    const small = W < 600;

    if (pl.alive) {
      if (!gunsight) ladder(cam, C);
      // boresight / gun cross (nose direction incl. AoA)
      const noseDir = tv.set(0, 0, -1).applyQuaternion(pl.mesh.quaternion);
      const bore = proj(tv.copy(pl.pos).addScaledVector(noseDir, 800), cam);
      if (bore.on) {
        if (gunsight) {
          x.beginPath(); x.arc(bore.x, bore.y, 46, 0, Math.PI * 2); x.stroke();
          x.beginPath(); x.arc(bore.x, bore.y, 3, 0, Math.PI * 2); x.fill();
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.beginPath(); x.moveTo(bore.x + Math.cos(a) * 46, bore.y + Math.sin(a) * 46); x.lineTo(bore.x + Math.cos(a) * 30, bore.y + Math.sin(a) * 30); x.stroke(); }
        } else {
          x.beginPath(); x.moveTo(bore.x - 18, bore.y); x.lineTo(bore.x - 7, bore.y); x.moveTo(bore.x + 7, bore.y); x.lineTo(bore.x + 18, bore.y);
          x.moveTo(bore.x, bore.y - 14); x.lineTo(bore.x, bore.y - 6); x.stroke();
        }
      }
      // flight path marker
      if (!gunsight) {
        const fpm = proj(tv.copy(pl.pos).addScaledVector(pl.vel, 10), cam);
        if (fpm.on) {
          x.beginPath(); x.arc(fpm.x, fpm.y, 6, 0, Math.PI * 2);
          x.moveTo(fpm.x - 6, fpm.y); x.lineTo(fpm.x - 17, fpm.y); x.moveTo(fpm.x + 6, fpm.y); x.lineTo(fpm.x + 17, fpm.y); x.moveTo(fpm.x, fpm.y - 6); x.lineTo(fpm.x, fpm.y - 13); x.stroke();
        }
      }
      if (s.bombImpact) {
        const b = proj(s.bombImpact, cam);
        if (b.on) {
          x.strokeStyle = YEL; x.fillStyle = YEL;
          x.beginPath(); x.arc(b.x, b.y, 14, 0, Math.PI * 2); x.moveTo(b.x - 22, b.y); x.lineTo(b.x + 22, b.y); x.moveTo(b.x, b.y - 22); x.lineTo(b.x, b.y + 22); x.stroke();
          text("IMPACT", b.x, b.y - 22, "center", 11);
          x.strokeStyle = C; x.fillStyle = C;
        }
      }
      tapes(pl, C, small);
      heading(pl, C);
      bottomStatus(pl, s, C, small, s.cockpit3d);
      if (RJ.nav) RJ.nav.hud(x, { pl, cam, W, Hh, proj, text });
    }
    // contacts
    for (const o of s.others || []) {
      if (o === pl || !o.alive) continue;
      const enemy = o.team !== pl.team;
      const d = o.pos.distanceTo(pl.pos);
      if (RJ.combat.crowd && d > (enemy ? 6000 : 2500)) continue; // big battles: bracket the nearby fight, not all 100 jets
      const p = proj(o.pos, cam);
      if (!p.on) continue;
      if (o === pl.target) continue;
      x.strokeStyle = enemy ? RED : BLUE; x.fillStyle = x.strokeStyle;
      const r = RJ.clamp(4000 / d, 6, 16);
      x.beginPath();
      x.moveTo(p.x - r, p.y - r + 4); x.lineTo(p.x - r, p.y - r); x.lineTo(p.x - r + 4, p.y - r);
      x.moveTo(p.x + r - 4, p.y - r); x.lineTo(p.x + r, p.y - r); x.lineTo(p.x + r, p.y - r + 4);
      x.moveTo(p.x - r, p.y + r - 4); x.lineTo(p.x - r, p.y + r); x.lineTo(p.x - r + 4, p.y + r);
      x.moveTo(p.x + r - 4, p.y + r); x.lineTo(p.x + r, p.y + r); x.lineTo(p.x + r, p.y + r - 4);
      x.stroke();
      if (d < 6000 || o.tag) text((d / 1000).toFixed(1), p.x, p.y + r + 12, "center", 11);
      if (o.tag) text(o.tag, p.x, p.y - r - 6, "center", 12); // multiplayer callsign
    }
    x.strokeStyle = C; x.fillStyle = C;
    if (pl.alive && pl.target && pl.target.alive) targetBox(pl, cam, C);
    if (s.ring) ringMarker(s.ring, pl, cam);
    if (pl.alive && RJ.atlas && RJ.atlas.built && !s.noLandmarks) landmarkMarkers(pl, cam);
    if (pl.alive) {
      warnings(pl, s, cam);
      radar(pl, s, C, small);
      health(pl, C, small);
    }
    if (H.hitFlash > 0) {
      x.strokeStyle = "#ffffff"; x.lineWidth = 2; x.globalAlpha = Math.min(1, H.hitFlash * 3);
      x.beginPath(); x.moveTo(cx - 14, cy - 14); x.lineTo(cx - 6, cy - 6); x.moveTo(cx + 14, cy - 14); x.lineTo(cx + 6, cy - 6);
      x.moveTo(cx - 14, cy + 14); x.lineTo(cx - 6, cy + 6); x.moveTo(cx + 14, cy + 14); x.lineTo(cx + 6, cy + 6); x.stroke();
      x.globalAlpha = 1;
    }
    x.shadowBlur = 0;
  };

  function ladder(cam, C) {
    const cf = tv.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cr = V3(1, 0, 0).applyQuaternion(cam.quaternion), cu = V3(0, 1, 0).applyQuaternion(cam.quaternion);
    const pitch = Math.asin(RJ.clamp(cf.y, -1, 1)), roll = Math.atan2(cr.y, cu.y);
    const ppr = Hh / (cam.fov * DEG);
    x.save();
    const w = Math.min(520, W * 0.66);
    x.beginPath(); x.rect(W / 2 - w / 2, Hh * 0.18, w, Hh * 0.6); x.clip();
    x.translate(W / 2, Hh / 2); x.rotate(roll);
    for (let d = -80; d <= 80; d += 10) {
      const y = (pitch - d * DEG) * ppr;
      if (Math.abs(y) > Hh * 0.5) continue;
      const hw = d === 0 ? Math.min(240, W * 0.32) : Math.min(70, W * 0.1);
      x.setLineDash(d < 0 ? [7, 5] : []);
      x.beginPath();
      if (d === 0) { x.moveTo(-hw, y); x.lineTo(-30, y); x.moveTo(30, y); x.lineTo(hw, y); }
      else {
        const t = d > 0 ? 8 : -8;
        x.moveTo(-hw, y + t); x.lineTo(-hw, y); x.lineTo(-26, y); x.moveTo(26, y); x.lineTo(hw, y); x.lineTo(hw, y + t);
        text(String(Math.abs(d)), -hw - 6, y + 5, "right", 12); text(String(Math.abs(d)), hw + 6, y + 5, "left", 12);
      }
      x.stroke();
    }
    x.setLineDash([]);
    x.restore();
  }

  function tapes(pl, C, small) {
    const SU = RJ.speedUnit();
    const kt = pl.speed * SU[1], ft = pl.pos.y * 3.281;
    const lx = small ? 46 : Math.max(80, W / 2 - Math.min(330, W * 0.38)), rx = small ? W - 46 : Math.min(W - 80, W / 2 + Math.min(330, W * 0.38));
    const cy = Hh / 2;
    const tape = (px, val, step, labelEvery, side) => {
      const h = small ? 140 : 210, ppu = h / (step * 8);
      x.save(); x.beginPath(); x.rect(px - 40, cy - h / 2, 80, h); x.clip();
      const base = Math.floor(val / step) * step;
      for (let k = -6; k <= 6; k++) {
        const v = base + k * step, y = cy - (v - val) * ppu;
        const big = Math.round(v / step) % labelEvery === 0;
        x.beginPath(); x.moveTo(px + side * 22, y); x.lineTo(px + side * (big ? 32 : 27), y); x.stroke();
        if (big && v >= 0) text(RJ.fmtInt(v), px + side * 36, y + 4, side > 0 ? "left" : "right", 11);
      }
      x.restore();
    };
    if (!small) { tape(lx, kt, 10, 5, -1); tape(rx, ft, 100, 5, 1); }
    const box = (px, val, lab, align) => {
      x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(px - 42, cy - 15, 84, 28); x.fillStyle = x.strokeStyle;
      x.strokeRect(px - 42, cy - 15, 84, 28);
      text(val, px, cy + 7, "center", 19);
      if (lab) text(lab, px, cy + 32, "center", 11);
      void align;
    };
    box(lx, String(Math.round(kt)), SU[0]);
    box(rx, RJ.fmtInt(ft), "FT");
    const vs = pl.vel.y * 196.85; // ft/min
    text(`M ${pl.mach.toFixed(2)}`, lx, cy + 50, "center", 13);
    text(`G ${pl.g.toFixed(1)}`, lx, cy + 66, "center", 13);
    text(`R ${RJ.fmtInt(Math.max(0, pl.agl) * 3.281)}`, rx, cy + 50, "center", 13);
    text(`VS ${vs >= 0 ? "+" : ""}${RJ.fmtInt(vs / 100)}`, rx, cy + 66, "center", 13);
    // second speed unit, metres, and the ground elevation below (useful in the Himalaya)
    const alt2 = SU[0] === "KT" ? ["MPH", 2.23694] : ["KT", 1.94384];
    text(`${Math.round(pl.speed * alt2[1])} ${alt2[0]}`, lx, cy + 82, "center", 12);
    text(`${RJ.fmtInt(pl.pos.y)} M`, rx, cy + 82, "center", 12);
    text(`GND ${RJ.fmtInt(Math.max(0, pl.pos.y - pl.agl))} M`, rx, cy + 98, "center", 11);
  }

  function heading(pl, C) {
    const hd = pl.heading, y = Math.max(78, Hh * 0.12), w = Math.min(320, W * 0.5);
    x.save(); x.beginPath(); x.rect(W / 2 - w / 2, y - 22, w, 34); x.clip();
    const ppd = w / 60;
    for (let d = Math.floor((hd - 35) / 5) * 5; d <= hd + 35; d += 5) {
      const px = W / 2 + (d - hd) * ppd, big = d % 10 === 0;
      x.beginPath(); x.moveTo(px, y); x.lineTo(px, y - (big ? 9 : 5)); x.stroke();
      if (d % 30 === 0) { const v = ((d % 360) + 360) % 360; const lab = { 0: "N", 90: "E", 180: "S", 270: "W" }[v] || String(v / 10).padStart(2, "0"); text(lab, px, y - 12, "center", 12); }
    }
    x.restore();
    x.beginPath(); x.moveTo(W / 2, y + 2); x.lineTo(W / 2 - 6, y + 10); x.lineTo(W / 2 + 6, y + 10); x.closePath(); x.fill();
    text(String(Math.round(hd) % 360).padStart(3, "0"), W / 2, y + 26, "center", 13);
  }

  function bottomStatus(pl, s, C, small, pit) {
    // in the 3D cockpit the status line sits above the glare shield instead of over the displays
    const y = pit ? Hh * 0.6 : Hh - (RJ.isTouch ? 210 : 66);
    const parts = [];
    parts.push(`THR ${Math.round(pl.throttle * 100)}%${pl.abLevel > 0.5 ? " AB" : ""}`);
    if (pl.fuel != null) parts.push(`FUEL ${Math.round(pl.fuel / pl.spec.flight.fuel * 100)}%`);
    const g = pl.spec.gun;
    if (g && !g.turret && !s.bombMode) parts.push(pl.overheated ? "GUN HOT" : `GUN ${Math.round((1 - pl.gunHeat) * 100)}%`);
    if (g && g.turret) parts.push(pl.firing ? "TAIL GUN FIRING" : "TAIL GUN AUTO");
    if (s.bombMode) parts.push(`BOMBS ${pl.bombs}`);
    if (pl.gearT > 0.02 && !pl.spec.flight.model) parts.push(pl.gearT > 0.98 ? "GEAR DOWN" : "GEAR TRANSIT");
    if (pl.input && pl.input.brake) parts.push(pl.onGround ? "WHEEL BRAKES" : "SPEED BRAKE");
    if (pl.spec.msl.n) parts.push(`MSL ${RJ.game.mode && RJ.game.mode.infMsl ? "∞" : pl.missiles}`);
    if (pl.spec.flares) parts.push(`FLR ${pl.flares}`);
    text(parts.join("   "), W / 2, y, "center", small ? 12 : 14);
    if (pl.vstatus) text(pl.vstatus, W / 2, y - (pl.overheated ? 40 : 20), "center", small ? 12 : 13);
    if (pl.overheated) { x.fillStyle = RED; text("GUN OVERHEAT", W / 2, y - 20, "center", 13); x.fillStyle = x.strokeStyle; }
  }

  function targetBox(pl, cam, C) {
    const t = pl.target, p = proj(t.pos, cam);
    const d = t.pos.distanceTo(pl.pos);
    const SU = RJ.speedUnit();
    const closing = -tv.copy(t.vel).sub(pl.vel).dot(tv2.copy(t.pos).sub(pl.pos).normalize()) * SU[1];
    x.strokeStyle = RED; x.fillStyle = RED;
    if (p.on) {
      const r = RJ.clamp(5000 / d, 12, 30);
      x.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      text(`${t.spec.short}  ${(d / 1000).toFixed(1)} km`, p.x, p.y - r - 8, "center", 12);
      text(`${closing >= 0 ? "+" : ""}${Math.round(closing)} ${SU[0].toLowerCase()}`, p.x, p.y + r + 14, "center", 11);
      if (pl.spec.msl.n && pl.missiles > 0) {
        if (pl.locked) {
          x.lineWidth = 2.5; x.beginPath(); x.arc(p.x, p.y, r + 10, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1.6;
          text("LOCK", p.x, p.y + r + 28, "center", 13);
        } else if (pl.lockT > 0) {
          const rr = (r + 40) * (1 - pl.lockT) + r + 6;
          x.save(); x.translate(p.x, p.y); x.rotate(pl.lockT * Math.PI);
          x.strokeRect(-rr / 1.4, -rr / 1.4, rr * 1.41, rr * 1.41); x.restore();
        }
      }
      // gun lead indicator
      const g = pl.spec.gun;
      if (g && !g.turret && d < 1600) {
        const rel = tv.copy(t.pos).sub(pl.pos);
        let tof = d / g.speed;
        for (let k = 0; k < 2; k++) { const aim = tv2.copy(rel).addScaledVector(t.vel, tof).addScaledVector(pl.vel, -tof); tof = aim.length() / g.speed; }
        const aimPt = tv2.copy(rel).addScaledVector(t.vel, tof).addScaledVector(pl.vel, -tof);
        aimPt.y += 0.5 * RJ.G0 * tof * tof;
        const lp = proj(aimPt.normalize().multiplyScalar(d).add(pl.pos), cam);
        if (lp.on) {
          x.beginPath(); x.arc(lp.x, lp.y, 9, 0, Math.PI * 2); x.moveTo(lp.x, lp.y - 13); x.lineTo(lp.x, lp.y - 9); x.stroke();
          x.beginPath(); x.arc(lp.x, lp.y, 2, 0, Math.PI * 2); x.fill();
        }
      }
    } else edgeArrow(p, RED, `${(d / 1000).toFixed(1)} km`);
    x.strokeStyle = C; x.fillStyle = C;
  }

  /** Destinations: discovered landmarks by name, undiscovered ones nearby as "?" to tempt you over. */
  function landmarkMarkers(pl, cam) {
    x.save();
    for (const mk of RJ.atlas.markers()) {
      const d = mk.pos.distanceTo(pl.pos);
      if (d < 700 || d > (mk.found ? 30000 : 9000)) continue;
      const p = proj(mk.pos, cam);
      if (!p.on) continue;
      const a = RJ.clamp((d - 700) / 1500, 0, 1) * (mk.found ? 0.9 : 0.75);
      x.globalAlpha = a;
      x.strokeStyle = mk.found ? YEL : "#dfe8f2"; x.fillStyle = x.strokeStyle;
      x.beginPath(); x.moveTo(p.x, p.y - 7); x.lineTo(p.x + 7, p.y); x.lineTo(p.x, p.y + 7); x.lineTo(p.x - 7, p.y); x.closePath(); x.stroke();
      text(mk.found ? mk.name.toUpperCase() : "?", p.x, p.y - 12, "center", 11);
      text(`${(d / 1000).toFixed(1)} km`, p.x, p.y + 20, "center", 10);
    }
    x.restore();
  }
  function ringMarker(r, pl, cam) {
    const p = proj(r.pos, cam), d = r.pos.distanceTo(pl.pos);
    x.strokeStyle = YEL; x.fillStyle = YEL;
    if (p.on) {
      x.beginPath(); x.moveTo(p.x, p.y - 12); x.lineTo(p.x + 12, p.y); x.lineTo(p.x, p.y + 12); x.lineTo(p.x - 12, p.y); x.closePath(); x.stroke();
      text(`${Math.round(d)} m`, p.x, p.y + 28, "center", 12);
    } else edgeArrow(p, YEL, `${Math.round(d)} m`);
  }

  function warnings(pl, s, cam) {
    x.fillStyle = RED; x.strokeStyle = RED;
    for (const m of pl.incoming) {
      const p = proj(m.pos, cam);
      const d = m.pos.distanceTo(pl.pos);
      if (p.on) { x.beginPath(); x.arc(p.x, p.y, 10, 0, Math.PI * 2); x.stroke(); text(`${Math.round(d)}`, p.x, p.y - 14, "center", 11); }
      else edgeArrow(p, RED, `MSL ${(d / 1000).toFixed(1)}`);
    }
    const blink = Math.floor(performance.now() / 250) % 2;
    let line = Hh * 0.68;
    const F = pl.spec.flight;
    if (s.pullUp && blink) { text("PULL UP", W / 2, line, "center", 22); line += 26; }
    const stallV = F.vstall * 1.08 / Math.sqrt(Math.max(RJ.rho(pl.pos.y), 0.02));
    if (pl.speed < stallV && pl.state === "flying" && blink) { x.fillStyle = YEL; text("STALL", W / 2, line, "center", 20); line += 24; }
    if (pl.fuel != null && pl.fuel <= 0) { x.fillStyle = YEL; text("ROCKET FUEL OUT · IDLE THROTTLE TO REFUEL", W / 2, line, "center", 14); }
    x.fillStyle = x.strokeStyle;
  }

  function radar(pl, s, C, small) {
    const range = pl.spec.radar;
    if (!range) return;
    const R = small ? 52 : 74;
    const ox = (RJ.isTouch ? W - R - 20 : R + 22) + 0, oy = RJ.isTouch ? R + 96 : Hh - R - 26;
    x.save();
    x.fillStyle = "rgba(4,10,8,0.45)"; x.beginPath(); x.arc(ox, oy, R, 0, Math.PI * 2); x.fill();
    x.strokeStyle = C; x.globalAlpha = 0.55; x.beginPath(); x.arc(ox, oy, R, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(ox, oy, R / 2, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 1;
    // seeker cone
    if (pl.spec.msl.n && pl.spec.msl.cone < 180) {
      const a = pl.spec.msl.cone * DEG, rr = R * Math.min(1, pl.spec.msl.range / range);
      x.globalAlpha = 0.18; x.fillStyle = C; x.beginPath(); x.moveTo(ox, oy); x.arc(ox, oy, rr, -Math.PI / 2 - a, -Math.PI / 2 + a); x.closePath(); x.fill(); x.globalAlpha = 1;
    }
    const f = tv.set(pl.fwd.x, 0, pl.fwd.z); if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const r = tv2.set(-f.z, 0, f.x);
    const plot = (p, color, size, shape) => {
      const dx = p.x - pl.pos.x, dz = p.z - pl.pos.z;
      let px = (dx * r.x + dz * r.z) / range * R, py = -(dx * f.x + dz * f.z) / range * R;
      const d = Math.hypot(px, py);
      let edge = false;
      if (d > R - 3) { px *= (R - 3) / d; py *= (R - 3) / d; edge = true; }
      x.fillStyle = color; x.globalAlpha = edge ? 0.5 : 1;
      if (shape === "tri") { x.beginPath(); x.moveTo(ox + px, oy + py - size); x.lineTo(ox + px + size, oy + py + size); x.lineTo(ox + px - size, oy + py + size); x.closePath(); x.fill(); }
      else if (shape === "ring") { x.strokeStyle = color; x.beginPath(); x.arc(ox + px, oy + py, size, 0, Math.PI * 2); x.stroke(); }
      else if (shape === "diamond") { x.beginPath(); x.moveTo(ox + px, oy + py - size); x.lineTo(ox + px + size, oy + py); x.lineTo(ox + px, oy + py + size); x.lineTo(ox + px - size, oy + py); x.closePath(); x.fill(); }
      else if (shape === "unknown") { x.strokeStyle = color; x.beginPath(); x.moveTo(ox + px, oy + py - size); x.lineTo(ox + px + size, oy + py); x.lineTo(ox + px, oy + py + size); x.lineTo(ox + px - size, oy + py); x.closePath(); x.stroke(); }
      else if (shape === "castle") {
        const X = ox + px, Y = oy + py;
        x.fillRect(X - size, Y - size * 0.3, size * 2, size * 1.3);
        for (const k of [-1, 0, 1]) x.fillRect(X + k * size * 0.75 - size * 0.25, Y - size, size * 0.5, size * 0.8);
      }
      else x.fillRect(ox + px - size, oy + py - size, size * 2, size * 2);
      x.globalAlpha = 1;
    };
    for (const o of s.others || []) { if (o === pl || !o.alive) continue; plot(o.pos, o.team === pl.team ? BLUE : RED, o === pl.target ? 4 : 3, o.team === pl.team ? "sq" : "tri"); }
    for (const m of pl.incoming) plot(m.pos, "#ffffff", 2, "sq");
    if (RJ.atlas && RJ.atlas.built) for (const mk of RJ.atlas.markers()) {
      const d = Math.hypot(mk.pos.x - pl.pos.x, mk.pos.z - pl.pos.z);
      if (mk.found || d < range * 1.6) plot(mk.pos, mk.found ? YEL : "rgba(220,230,240,0.85)", mk.found ? 4 : 3.5, mk.found ? (mk.icon === "castle" ? "castle" : "diamond") : "unknown");
    }
    if (s.ring) plot(s.ring.pos, YEL, 5, "ring");
    if (s.ring2) plot(s.ring2.pos, YEL, 3, "ring");
    x.fillStyle = C; x.beginPath(); x.moveTo(ox, oy - 6); x.lineTo(ox + 4, oy + 4); x.lineTo(ox - 4, oy + 4); x.closePath(); x.fill();
    text(`${Math.round(range / 1000)} km`, ox, oy + R + 13, "center", 11);
    x.restore();
  }

  function health(pl, C, small) {
    const w = small ? 90 : 130, px = RJ.isTouch ? 20 : W - w - 22, py = RJ.isTouch ? 96 : Hh - 46;
    const f = pl.hp / pl.maxHp;
    text("AIRFRAME", px, py - 6, "left", 11);
    x.strokeRect(px, py, w, 8);
    x.fillStyle = f > 0.5 ? C : f > 0.25 ? YEL : RED;
    x.fillRect(px + 1, py + 1, (w - 2) * RJ.clamp(f, 0, 1), 6);
    x.fillStyle = C;
  }
})(window.RJ);
