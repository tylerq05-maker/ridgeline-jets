/* Jet City — Jet Combat Simulator spectator controls + HUD (RJ.csUI). See docs/CS-INTERFACES.md. */
(function (RJ) {
  "use strict";
  const DEG = Math.PI / 180, TAU = Math.PI * 2;
  const CAM_KEYS = ["3", "4", "5", "6", "7", "8", "9", "0"];
  const esc = (s) => (RJ.ui && RJ.ui.esc ? RJ.ui.esc(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const pretty = (id) => String(id).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fmtT = (t) => { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };

  const STYLE = `
  #csui{position:fixed;inset:0;pointer-events:none;font:13px/1.3 system-ui,sans-serif;color:#eef;z-index:30;text-shadow:0 1px 2px #000}
  #csui.nohud .hudpart{display:none}
  #csui .card{position:absolute;top:14px;width:250px;padding:10px 12px;background:rgba(8,12,18,.55);border-radius:8px;border-left:4px solid var(--c);transition:box-shadow .2s,background .2s}
  #csui .card.a{left:14px}#csui .card.b{right:14px}
  #csui .card.sel{background:rgba(8,12,18,.72);box-shadow:0 0 0 2px var(--c),0 0 18px -4px var(--c)}
  #csui .card .nm{font-weight:700;font-size:15px;letter-spacing:.04em;display:flex;justify-content:space-between;align-items:center}
  #csui .card .eye{font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:var(--c);color:#111;text-shadow:none;visibility:hidden}
  #csui .card.sel .eye{visibility:visible}
  #csui .card .ty{opacity:.85}
  #csui .row2{display:flex;gap:10px;margin-top:4px;font-variant-numeric:tabular-nums}
  #csui .bar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:6px}#csui .bar i{display:block;height:100%;width:100%;background:var(--c);border-radius:3px;transition:width .2s}
  #csui .tags{min-height:0}#csui .tag{display:inline-block;margin-top:5px;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;margin-right:4px;text-shadow:none}
  #csui .lock{background:#c8102e}#csui .msl{background:#f2b705;color:#111}#csui .dead{background:#444}
  #csui .top{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;background:rgba(8,12,18,.45);padding:6px 14px;border-radius:8px;max-width:calc(100vw - 560px);min-width:180px}
  #csui .tm{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
  #csui .cm{font-size:12px;letter-spacing:.05em;opacity:.9}
  #csui .slow{display:none;margin-top:3px;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:#5a8dee;text-shadow:none}
  #csui .spec{margin-top:5px;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--c)}
  #csui canvas{position:absolute;right:14px;bottom:76px;background:rgba(8,12,18,.5);border-radius:8px}
  #csui .legend{position:absolute;left:14px;bottom:76px;opacity:.75;transition:opacity 1.5s;font-size:11px;line-height:1.5;background:rgba(8,12,18,.4);padding:6px 9px;border-radius:8px;max-width:230px}
  #csui .legend b{display:inline-block;min-width:14px;font-weight:700;color:#fff}
  #csui .legend .on{color:#ffd24a}#csui .legend.faded{opacity:0}
  #csui .subs{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);max-width:min(720px,calc(100vw - 520px));min-width:240px;text-align:center;font-size:16px;padding:6px 14px;border-radius:8px;background:rgba(8,12,18,.55);opacity:0;transition:opacity .35s}
  #csui .subs.show{opacity:1}#csui .subs .who{font-weight:700;color:var(--c);margin-right:6px}
  #csui .subs.bg{font-size:14px;font-style:italic;color:#b8bfcc;background:rgba(8,12,18,.35)}
  #csui .lower{position:absolute;left:0;bottom:130px;padding:10px 22px 10px 18px;background:linear-gradient(90deg,rgba(8,12,18,.85),rgba(8,12,18,.55) 80%,transparent);border-left:5px solid var(--c);transform:translateX(-110%);transition:transform .45s cubic-bezier(.2,.8,.2,1)}
  #csui .lower.show{transform:none}#csui .lower .h{font-size:20px;font-weight:800;letter-spacing:.06em}#csui .lower .s{font-size:13px;opacity:.85}
  #csui .bar2{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;pointer-events:auto;max-width:calc(100vw - 24px)}
  #csui .bar2 button{font:700 12px system-ui,sans-serif;letter-spacing:.04em;color:#eef;background:rgba(8,12,18,.62);border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:8px 11px;cursor:pointer;min-height:36px;text-shadow:none;touch-action:manipulation}
  #csui .bar2 button:hover{background:rgba(30,40,55,.8)}
  #csui .bar2 button.on{border-color:var(--c,#ffd24a);box-shadow:inset 0 -3px 0 var(--c,#ffd24a)}
  #csui .bar2 .jet{border-left:4px solid var(--c)}
  #csui .bar2 .vol{display:flex;align-items:center;gap:4px;background:rgba(8,12,18,.62);border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:0 4px 0 0}
  #csui .bar2 .vol button{border:0;background:transparent}
  #csui .bar2 input[type=range]{width:70px;accent-color:#ffd24a}
  @media (max-width:820px){#csui .card{width:170px;font-size:11px;padding:7px 8px}#csui .card .ty{display:none}#csui .top{max-width:none;top:auto;bottom:126px}#csui canvas{width:120px;height:120px;bottom:130px}#csui .legend{display:none}#csui .subs{max-width:calc(100vw - 28px);bottom:120px}#csui .lower{bottom:170px}}
  `;

  function create(M) {
    const st = document.createElement("style"); st.id = "csui-style"; st.textContent = STYLE; document.head.appendChild(st);
    const root = document.createElement("div"); root.id = "csui";
    root.innerHTML = `
      <div class="card a hudpart"></div><div class="card b hudpart"></div>
      <div class="top hudpart"><div class="tm">0:00</div><div class="cm"></div><div class="slow">SLOW MOTION</div><div class="spec"></div></div>
      <canvas class="hudpart" width="190" height="190"></canvas>
      <div class="legend hudpart"></div>
      <div class="subs"><span class="who"></span><span class="tx"></span></div>
      <div class="lower"><div class="h"></div><div class="s"></div></div>
      <div class="bar2"></div>`;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    const els = { cards: [q(".card.a"), q(".card.b")], tm: q(".tm"), cm: q(".cm"), slow: q(".slow"), spec: q(".spec"), legend: q(".legend"), subs: q(".subs"), subWho: q(".subs .who"), subTx: q(".subs .tx"), lower: q(".lower"), lowH: q(".lower .h"), lowS: q(".lower .s"), bar: q(".bar2") };
    const tac = q("canvas").getContext("2d");
    let hudOn = true, hidden = false, acc = 1, lowerT = 0, lastSubKey = null, subShownT = -1, subUntil = 0, clock = 0;
    const cardCache = [{}, {}];

    // ---------- cards (built once, fields updated) ----------
    els.cards.forEach((el) => {
      el.innerHTML = `<div class="nm"><span class="cs"></span><span class="eye">SPECTATING</span></div><div class="ty"></div>
        <div class="row2"><span class="sp"></span><span class="al"></span><span class="hd"></span></div>
        <div class="row2"><span class="ms"></span><span class="fl"></span><span class="gg"></span></div>
        <div class="bar"><i></i></div><div class="tags"></div>`;
      el._f = { cs: el.querySelector(".cs"), ty: el.querySelector(".ty"), sp: el.querySelector(".sp"), al: el.querySelector(".al"), hd: el.querySelector(".hd"), ms: el.querySelector(".ms"), fl: el.querySelector(".fl"), gg: el.querySelector(".gg"), hp: el.querySelector(".bar i"), tags: el.querySelector(".tags") };
    });
    const setTxt = (cache, key, el, v) => { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } };
    function card(i, ac) {
      const el = els.cards[i], f = el._f, c = cardCache[i];
      if (!ac) return;
      if (c.col !== ac.csColor) { c.col = ac.csColor; el.style.setProperty("--c", ac.csColor); }
      el.classList.toggle("sel", M.sel === ac);
      setTxt(c, "cs", f.cs, ac.callsign || (i ? "Jet 2" : "Jet 1"));
      setTxt(c, "ty", f.ty, (ac.spec && ac.spec.name) || "");
      const fw = ac.fwd || { x: 0, z: -1 };
      const hdg = Math.round(((Math.atan2(fw.x, -fw.z) / DEG) + 360) % 360) % 360;
      setTxt(c, "sp", f.sp, `${Math.round((ac.speed || 0) * 2.237)} mph`);
      setTxt(c, "al", f.al, `${Math.round((ac.pos ? ac.pos.y : 0) * 3.281).toLocaleString()} ft`);
      setTxt(c, "hd", f.hd, `HDG ${String(hdg).padStart(3, "0")}`);
      setTxt(c, "ms", f.ms, `Missiles ${ac.missiles || 0}`);
      setTxt(c, "fl", f.fl, `Flares ${ac.flares || 0}`);
      setTxt(c, "gg", f.gg, `${(ac.g || 1).toFixed(1)} g`);
      const hp = `${Math.max(0, Math.min(100, (ac.hp / (ac.maxHp || 1)) * 100)).toFixed(0)}%`;
      if (c.hp !== hp) { c.hp = hp; f.hp.style.width = hp; }
      const tags = !ac.alive ? '<span class="tag dead">DESTROYED</span>' : (ac.locked ? '<span class="tag lock">LOCK</span>' : "") + (ac.incoming && ac.incoming.length ? '<span class="tag msl">MISSILE INBOUND</span>' : "");
      if (c.tags !== tags) { c.tags = tags; f.tags.innerHTML = tags; }
    }

    // ---------- actions ----------
    const cam = () => M.camMod, radio = () => M.radio;
    const shots = () => (cam() && Array.isArray(cam().shots) ? cam().shots : []);
    const shotName = (id) => { const C = cam(); return (C && C.names && C.names[id]) || pretty(id); };
    const camLabel = () => { const C = cam(); if (!C) return ""; try { return C.label ? C.label() : shotName(C.shot); } catch (e) { return shotName(C.shot); } };
    const pickJet = (n) => { if (M.select) M.select(n); acc = 1; };
    const toggleJet = () => { if (M.select) M.select(); acc = 1; };
    function setShot(id) { const C = cam(); if (!C || id == null) return; C.auto = false; if (C.set) C.set(id); acc = 1; RJ.ui && RJ.ui.flash && RJ.ui.flash(camLabel().toUpperCase() || shotName(id).toUpperCase(), "D for Director's Cut", 0.9); }
    function cycleCam() { const S = shots(); if (!S.length) return; const i = S.indexOf(cam().shot); setShot(S[(i + 1) % S.length]); }
    function director(on) { const C = cam(); if (!C) return; C.auto = on == null ? !C.auto : on; acc = 1; RJ.ui && RJ.ui.flash && RJ.ui.flash(C.auto ? "DIRECTOR'S CUT" : "MANUAL CAMERA", C.auto ? null : camLabel(), 0.9); }
    function toggleSlow() { M.slowToggle = !M.slowToggle; acc = 1; }
    function toggleHud() { hudOn = !hudOn; root.classList.toggle("nohud", !hudOn); acc = 1; }
    function toggleMute() { const R = radio(); if (!R) return; R.muted = !R.muted; acc = 1; RJ.ui && RJ.ui.flash && RJ.ui.flash(R.muted ? "RADIO OFF" : "RADIO ON", null, 0.7); }

    // ---------- controls bar ----------
    const B = {};
    const mk = (key, label, fn, cls) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (cls) b.className = cls;
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); if (RJ.ui && RJ.ui.click) try { RJ.ui.click(); } catch (_) { /* ignore */ } b.blur(); });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      els.bar.appendChild(b); B[key] = b; return b;
    };
    mk("j1", "◀ JET 1", () => pickJet(1), "jet");
    mk("j2", "JET 2 ▶", () => pickJet(2), "jet");
    if (M.camMod) { mk("dir", "DIRECTOR'S CUT", () => director()); mk("cam", "CAMERA ▸", cycleCam); }
    mk("slow", "SLOW-MO", toggleSlow);
    if (M.radio) {
      const vw = document.createElement("div"); vw.className = "vol"; els.bar.appendChild(vw);
      const rb = document.createElement("button"); rb.type = "button"; rb.textContent = "RADIO 🔊";
      rb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleMute(); rb.blur(); });
      const sl = document.createElement("input"); sl.type = "range"; sl.min = "0"; sl.max = "1"; sl.step = "0.05"; sl.title = "Radio volume";
      sl.value = String(M.radio.volume != null ? M.radio.volume : 1);
      sl.addEventListener("input", () => { const R = radio(); if (!R) return; R.volume = +sl.value; if (+sl.value > 0 && R.muted) R.muted = false; acc = 1; });
      for (const ev of ["pointerdown", "mousedown", "touchstart", "keydown"]) sl.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      vw.appendChild(rb); vw.appendChild(sl); B.radio = rb; B.vol = sl;
    }
    mk("hud", "HUD", toggleHud);

    function refreshBar() {
      const A = M.A, Bj = M.B;
      if (A) { B.j1.textContent = `◀ ${String(A.callsign || "JET 1").toUpperCase()}`; B.j1.style.setProperty("--c", A.csColor); B.j1.classList.toggle("on", M.sel === A); }
      if (Bj) { B.j2.textContent = `${String(Bj.callsign || "JET 2").toUpperCase()} ▶`; B.j2.style.setProperty("--c", Bj.csColor); B.j2.classList.toggle("on", M.sel === Bj); }
      if (B.dir && cam()) B.dir.classList.toggle("on", !!cam().auto);
      if (B.cam && cam()) B.cam.classList.toggle("on", !cam().auto);
      B.slow.classList.toggle("on", !!M.slowToggle);
      B.hud.classList.toggle("on", hudOn);
      const R = radio();
      if (B.radio && R) {
        const t = R.muted ? "RADIO 🔇" : "RADIO 🔊"; if (B.radio.textContent !== t) B.radio.textContent = t;
        B.radio.classList.toggle("on", !R.muted);
        if (document.activeElement !== B.vol && R.volume != null && Math.abs(+B.vol.value - R.volume) > 0.01) B.vol.value = String(R.volume);
      }
    }

    function refreshLegend() {
      const S = shots(), C = cam();
      if (!C || !S.length) { els.legend.style.display = "none"; return; }
      // the key legend shows for the first 12 s and again for 6 s after any camera change, then fades away
      els.legend.classList.toggle("faded", M.t > 12 && performance.now() - (els.legend._chg || 0) > 6000);
      const key = S.join(",") + "|" + C.shot + "|" + C.auto;
      if (els.legend._k === key) return; els.legend._k = key; els.legend._chg = performance.now();
      const rows = S.slice(0, CAM_KEYS.length).map((id, i) => `<div class="${!C.auto && C.shot === id ? "on" : ""}"><b>${CAM_KEYS[i]}</b> ${esc(shotName(id))}</div>`).join("");
      els.legend.style.display = "";
      els.legend.innerHTML = `<div class="${C.auto ? "on" : ""}"><b>D</b> Director's Cut</div>${rows}<div style="margin-top:4px;opacity:.85">Tab/F switch jet · 1/2 pick · C cycle · Space slow-mo · R radio · H HUD</div>`;
    }

    // ---------- subtitles ----------
    function subtitles() {
      const R = radio(), L = R && R.lastLine;
      if (L && L.text) {
        const key = (L.t != null ? L.t : "") + "|" + L.who + "|" + L.text;
        if (key !== lastSubKey) {
          lastSubKey = key; subUntil = clock + 4;
          const ac = [M.A, M.B].find((a) => a && (a === L.who || a.callsign === L.who));
          const who = ac ? ac.callsign : L.who && L.who.callsign ? L.who.callsign : L.who;
          els.subs.style.setProperty("--c", ac ? ac.csColor : "#ffd24a");
          els.subWho.textContent = who ? `${who}:` : ""; els.subTx.textContent = L.text;
          els.subs.classList.toggle("bg", L.primary === false);
        }
      }
      const on = clock < subUntil;
      els.subs.classList.toggle("show", on);
    }

    // ---------- tactical plot ----------
    function plot() {
      const A = M.A, Bj = M.B; if (!A || !Bj || !A.pos || !Bj.pos) return;
      const c = tac, W = 190, mx = (A.pos.x + Bj.pos.x) / 2, mz = (A.pos.z + Bj.pos.z) / 2;
      const dx = A.pos.x - Bj.pos.x, dz = A.pos.z - Bj.pos.z, R = Math.max(3000, Math.hypot(dx, dz) * 0.75), r0 = W / 2 - 6;
      c.clearRect(0, 0, W, W); c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 1;
      for (const f of [0.33, 0.66, 1]) { c.beginPath(); c.arc(W / 2, W / 2, r0 * f, 0, TAU); c.stroke(); }
      const P = (p) => [W / 2 + (p.x - mx) / R * r0, W / 2 + (p.z - mz) / R * r0];
      for (const ac of [A, Bj]) {
        if (!ac.alive) continue; const [x, y] = P(ac.pos), fw = ac.fwd || { x: 0, z: -1 }, a = Math.atan2(fw.z, fw.x);
        if (ac === M.sel) { c.strokeStyle = ac.csColor; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 11, 0, TAU); c.stroke(); c.lineWidth = 1; }
        c.fillStyle = ac.csColor; c.beginPath(); c.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); c.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6); c.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6); c.fill();
      }
      c.fillStyle = "#ffd24a"; const ms = (RJ.combat && RJ.combat.missiles) || [];
      for (const m of ms) { if (!m.pos) continue; const [x, y] = P(m.pos); c.fillRect(x - 1.5, y - 1.5, 3, 3); }
      c.fillStyle = "rgba(255,255,255,.6)"; c.font = "10px system-ui"; c.fillText(`${(R / 1000).toFixed(1)} km`, 6, W - 6); c.fillText("N", W / 2 - 3, 12);
    }

    function refreshAll() {
      card(0, M.A); card(1, M.B);
      els.tm.textContent = fmtT(M.t);
      const C = cam();
      els.cm.textContent = C ? `${C.auto ? "DIRECTOR'S CUT" : "MANUAL"} · ${camLabel()}` : "";
      els.slow.style.display = M.timeScale < 0.9 ? "inline-block" : "none";
      const s = M.sel;
      if (s) { els.spec.style.setProperty("--c", s.csColor); const t = `Spectating: ${s.callsign}`; if (els.spec.textContent !== t) els.spec.textContent = t; }
      refreshLegend(); refreshBar(); plot();
    }

    const api = {
      input(I) {
        if (hidden || !I) return;
        const e = (k) => I.anyEdge && I.anyEdge(k), act = (k) => I.action && I.action(k);
        if (e("tab") || e("f")) toggleJet();
        if (e("1")) pickJet(1);
        if (e("2")) pickJet(2);
        const S = shots();
        if (cam()) {
          CAM_KEYS.forEach((k, i) => { if (S[i] != null && e(k)) setShot(S[i]); });
          if (e("c") || act("camera")) cycleCam();
          if (e("d") || e("enter")) director(true);
        }
        if (e("h") || act("hud")) toggleHud();
        if (e("space")) toggleSlow();
        if (e("r")) toggleMute();
      },
      update(dt) {
        dt = dt || 1 / 60; clock += dt;
        if (lowerT > 0) { lowerT -= dt; if (lowerT <= 0) els.lower.classList.remove("show"); }
        if (hidden) return;
        subtitles();
        acc += dt; if (acc < 1 / 15) return; acc = 0;
        if (hudOn) refreshAll(); else refreshBar();
      },
      onEvent(ev) {
        if (!ev || hidden) return;
        const ac = ev.ac;
        if (ev.type === "select" && ac) {
          if (RJ.ui && RJ.ui.flash) RJ.ui.flash(`NOW SPECTATING ${String(ac.callsign).toUpperCase()}`, ac.spec && ac.spec.name, 1.2);
          acc = 1;
        } else if (ev.type === "kill" || ev.type === "down") {
          const d = ev.data || {};
          let h, s, col;
          if (ev.type === "kill") {
            const v = d.victim || ev.other; col = ac && ac.csColor;
            h = `${ac ? String(ac.callsign).toUpperCase() : "KILL"} — SPLASH ONE`;
            s = `${v ? v.callsign + (v.spec ? " (" + v.spec.name + ")" : "") : "Bandit"} destroyed${d.cause ? " · " + d.cause : ""}`;
          } else {
            col = ac && ac.csColor; const by = d.by || ev.other;
            h = `${ac ? String(ac.callsign).toUpperCase() : "JET"} IS DOWN`;
            const why = { missile: "missile hit", gun: "guns kill", terrain: "hit the terrain", water: "hit the water", collision: "mid-air collision" }[d.cause] || d.cause || "";
            s = `${why}${by && by.callsign && d.cause !== "terrain" && d.cause !== "water" ? " · by " + by.callsign : ""}`;
          }
          els.lower.style.setProperty("--c", col || "#c8102e");
          els.lowH.textContent = h; els.lowS.textContent = s;
          els.lower.classList.add("show"); lowerT = 4.5;
        }
      },
      hide() { hidden = true; root.style.display = "none"; },
      dispose() { root.remove(); st.remove(); }
    };
    refreshAll();
    return api;
  }

  RJ.csUI = { create };
})(window.RJ);
