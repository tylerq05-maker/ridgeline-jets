/* Ridgeline Jets — menus, hangar, settings, pilot record, results and in-flight chrome. */
(function (RJ) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const UI = {};
  RJ.ui = UI;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SCREENS = ["scr-loading", "scr-main", "scr-free", "scr-fight", "scr-hangar", "scr-settings", "scr-career", "scr-pause", "scr-results", "scr-chal", "scr-atlas", "scr-mp"];

  UI.show = function (id) {
    SCREENS.forEach((s) => ($(s).hidden = s !== id));
    UI.current = id;
    const f = $(id) && $(id).querySelector(".btn, .mode, button");
    if (f && !RJ.isTouch) f.focus({ preventScroll: true });
  };
  UI.hideAll = () => { SCREENS.forEach((s) => ($(s).hidden = true)); UI.current = null; };
  UI.click = () => RJ.audio.click();

  /* ---------------- in-flight chrome ---------------- */
  let flashT = 0;
  UI.flash = function (text, sub, dur = 1.6, warn = false) {
    const m = $("msg");
    m.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
    m.style.color = warn ? "var(--danger)" : "";
    m.style.opacity = 1; flashT = dur;
  };
  UI.tick = function (dt) {
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) $("msg").style.opacity = 0; }
  };
  UI.feed = function (text, cls) {
    const f = $("feed"), d = document.createElement("div");
    d.className = cls || ""; d.textContent = text;
    f.prepend(d);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  };
  UI.status = (html) => { if (UI._st !== html) { $("status").innerHTML = html; UI._st = html; } };
  UI.objective = (t) => { if (UI._ob !== t) { $("objective").textContent = t; UI._ob = t; $("objective").hidden = !t; } };
  UI.banner = function (mode) {
    const b = $("banner");
    if (!mode) { b.hidden = true; return; }
    b.hidden = false;
    b.className = "banner" + (mode === "lock" ? " lock" : "");
    b.textContent = mode === "missile" ? "MISSILE" : "LOCKED ON";
  };
  UI.toast = function (html, ms = 3500) {
    const t = $("toast"); t.innerHTML = html; t.hidden = false;
    clearTimeout(UI._toastT); UI._toastT = setTimeout(() => (t.hidden = true), ms);
  };
  /* ---------------- landmark icons and the discovery card ---------------- */
  UI.ICONS = {
    castle: "M4 21V9l3 2V6l3 2V4h4v4l3-2v5l3-2v12zM10 21v-5h4v5",
    cannon: "M3 21h18M5 21v-4h14v4M8 17v-4h8v4M10 13l9-9 2 2-9 9M19 4l2-2",
    dam: "M3 6h18M4 6c1 8 2 12 4 15h8c2-3 3-7 4-15M9 6v15M15 6v15",
    arch: "M3 21V12a9 9 0 0118 0v9h-5v-8a4 4 0 00-8 0v8z",
    light: "M10 21l1-12h2l1 12zM9 9h6M10 6h4v3h-4zM12 3v3M3 5l5 2M21 5l-5 2",
    bridge: "M2 15h20M5 15V5M19 15V5M5 6c3 6 11 6 14 0M8 9v6M12 10v5M16 9v6M5 19v-4M19 19v-4",
    wreck: "M3 18l7-4 3 2 8-6M13 16l2 4M7 12l-3-3M10 14V8M16 4c1 2 0 3 1 5",
    base: "M2 20h20M5 20V12h6v8M13 20v-5h6v5M4 12l4-4 4 4M12 4l3 0",
    lake: "M3 15c3-2 6 2 9 0s6-2 9 0M3 19c3-2 6 2 9 0s6-2 9 0M6 11l4-7 4 6 2-3 3 4",
    ship: "M2 15h20l-3 5H5zM6 15V11h12v4M14 11V6h3v5M15 6V3",
    peak: "M2 20l7-12 4 6 3-4 6 10zM9 8l1.5 3 1.5-1",
    tower: "M9 21l1-14h4l1 14zM10 7l-1-3 3 1 3-1-1 3M12 10a1.5 1 0 100 .1M6 21h12",
    city: "M3 21V11h4v10M8 21V4h5v17M14 21V8h3v13M18 21v-7h3v7M2 21h20M10 7h1M10 10h1M10 13h1M15 11h1M15 14h1",
    volcano: "M2 20l7-10h6l7 10zM9 10l2 3 2-3M11 7c-1-2 1-3 0-5M14 7c1-2 3-2 2-4",
    tree: "M12 22v-6M12 16l-6 0 6-13 6 13zM9 11h6",
    pagoda: "M5 20h14M7 20v-4h10v4M4 16l8-4 8 4M8 12V9h8v3M6 9l6-3 6 3M12 6V3",
    island: "M3 9h18l-6 9h-6zM7 9V6l2-2 2 2v3M14 9V5h3v4M10 18v3",
    dish: "M4 14a8 8 0 0012-10zM10 9l5-5M15 4l2 2M9 15l-2 6h6l-2-4",
    ice: "M12 2l3 7-3 13-3-13zM5 8l2 5-2 8-2-8zM19 8l2 5-2 8-2-8z",
    fish: "M3 12c4-6 11-6 15 0-4 6-11 6-15 0zM18 12l4-4v8zM8 11h.1"
  };
  UI.icon = (id) => `<svg viewBox="0 0 24 24"><path d="${UI.ICONS[id] || UI.ICONS.peak}"/></svg>`;
  UI.discover = function (d) {
    const el = $("discover");
    $("disc-ic").innerHTML = UI.icon(d.lm.def.icon);
    $("disc-n").textContent = d.lm.def.name;
    $("disc-d").textContent = d.lm.def.sub;
    $("disc-r").textContent = `+${d.lm.def.xp} XP · ${d.count} of ${d.total} landmarks found`;
    el.hidden = false; el.classList.remove("out");
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    clearTimeout(UI._discT1); clearTimeout(UI._discT2);
    UI._discT1 = setTimeout(() => el.classList.add("out"), 5200);
    UI._discT2 = setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 5900);
    RJ.audio.discover && RJ.audio.discover();
  };
  UI.gameChrome = (on) => { $("game-ui").hidden = !on; if (on) { const m = RJ.game.mode; $("t-wing").hidden = !(m && m.wingmen && m.wingmen().length); } if (!on) { UI.banner(null); $("feed").innerHTML = ""; $("msg").style.opacity = 0; $("discover").hidden = true; } };

  /* ---------------- option widgets ---------------- */
  function chips(el, items, value, onPick, disabledFn) {
    el.innerHTML = items.map((it) => `<button class="chip" data-v="${it.id}" aria-pressed="${it.id === value}" ${disabledFn && disabledFn(it) ? "disabled" : ""}>${esc(it.name)}</button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b || b.disabled) return; UI.click(); onPick(b.dataset.v); };
  }
  function opts(el, items, value, onPick) {
    el.innerHTML = items.map((it) => `<button class="opt" data-v="${it.id}" aria-pressed="${it.id === value}"><span class="nm">${esc(it.name)}</span><span class="ds">${esc(it.desc)}</span></button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; UI.click(); onPick(b.dataset.v); };
  }
  const TIMES = () => Object.entries(RJ.world.TIMES).map(([id, t]) => ({ id, name: t.label }));
  const WEATHERS = () => ["clear", "scattered", "overcast", "storm"].map((id) => ({ id, name: RJ.world.WEATHER[id].label }));

  /* ---------------- main menu ---------------- */
  UI.refreshMain = function () {
    const r = RJ.rankOf(RJ.progress.xp);
    $("main-rank").textContent = r.name.toUpperCase();
    $("main-ac").textContent = (RJ.AIRCRAFT[RJ.settings.aircraft] || RJ.AIRCRAFT.f16).name;
    const pct = r.next ? (RJ.progress.xp - r.floor) / (r.next - r.floor) : 1;
    $("main-xpbar").style.width = Math.round(pct * 100) + "%";
    const P = RJ.progress, med = P.medals || {};
    $("main-medals").textContent = `${Object.values(med).reduce((n, m) => n + (RJ.challenges.RANK[m.medal] || 0), 0)} / 30 MEDALS`;
    $("main-atlas").textContent = `${RJ.atlas.foundCount()}/${RJ.atlas.DEFS.length}`;
    $("main-xptext").textContent = r.next ? `${RJ.fmtInt(RJ.progress.xp)} XP · ${RJ.fmtInt(r.next - RJ.progress.xp)} to ${r.nextName}` : `${RJ.fmtInt(RJ.progress.xp)} XP · highest rank`;
  };

  /* ---------------- free flight setup ---------------- */
  UI.freeSel = { aircraft: RJ.settings.aircraft, activity: "roam", region: "mountains", time: "golden", weather: "scattered", start: "runway" };
  UI.renderFree = function () {
    const s = UI.freeSel, a = RJ.AIRCRAFT[s.aircraft];
    $("free-ac-name").textContent = a.name;
    $("free-ac-role").textContent = a.role;
    opts($("free-activity"), RJ.modes.ACTIVITIES, s.activity, (v) => { s.activity = v; UI.renderFree(); });
    const courseRegion = RJ.modes.COURSES[s.activity];
    $("free-region-group").hidden = !!courseRegion;
    const runwayOK = s.activity === "roam" && s.region !== "ocean" && s.region !== "clouds";
    const carrierOK = s.activity === "roam" && RJ.modes.carrierOK(a);
    $("free-start-group").hidden = s.activity !== "roam";
    const starts = [{ id: "air", name: "In the air" }];
    if (runwayOK) starts.unshift({ id: "runway", name: "Runway takeoff" });
    if (carrierOK) starts.push({ id: "carrier", name: "Carrier catapult" });
    if (!starts.some((x) => x.id === s.start)) s.start = starts[0].id;
    chips($("free-startmode"), starts, s.start, (v) => { s.start = v; UI.renderFree(); });
    $("free-region-group").hidden = !!courseRegion || s.start === "carrier";
    chips($("free-region"), RJ.modes.REGIONS, s.region, (v) => { s.region = v; UI.renderFree(); });
    chips($("free-time"), TIMES(), s.time, (v) => { s.time = v; UI.renderFree(); });
    chips($("free-weather"), WEATHERS(), s.weather, (v) => { s.weather = v; UI.renderFree(); });
  };

  /* ---------------- dogfight setup ---------------- */
  UI.fightSel = { aircraft: RJ.settings.aircraft, match: "duel", diff: "veteran", arena: "mountains", time: "golden", side: "coalition" };
  UI.renderFight = function () {
    const s = UI.fightSel;
    let a = RJ.AIRCRAFT[s.aircraft];
    $("fight-ac-name").textContent = a.name;
    $("fight-ac-role").textContent = a.role;
    const bad = !RJ.isUnlocked(a.id) ? `Locked. ${UI.unlockText(a)}` : a.freeOnly ? "This aircraft is unarmed and can only fly in Free Flight." : "";
    $("fight-ac-warn").hidden = !bad; $("fight-ac-warn").textContent = bad;
    $("fight-start").disabled = !!bad;
    opts($("fight-match"), RJ.modes.MATCHES, s.match, (v) => { s.match = v; UI.renderFight(); });
    const done = (RJ.progress.missions || {});
    opts($("fight-missions"), RJ.modes.MISSIONS.map((m) => ({ id: m.id, name: m.name + (done[m.id] && done[m.id].won ? " " + "★".repeat(done[m.id].stars || 1) + "☆".repeat(3 - (done[m.id].stars || 1)) : ""), desc: m.desc })), s.match, (v) => { s.match = v; UI.renderFight(); });
    const isMission = RJ.modes.isMission(s.match);
    $("fight-arena-group").hidden = isMission;
    const k = RJ.settings.keys;
    const wingy = isMission ? ["escort", "castle", "carrier", "nightraid", "sweep"].includes(s.match) : (RJ.modes.MATCHES.find((m) => m.id === s.match) || {}).blue > 1;
    $("fight-wing-help").textContent = wingy && !RJ.isTouch ? `Wingman calls: ${RJ.keyLabel(k.wingAttack)} attack my target · ${RJ.keyLabel(k.wingCover)} cover me · ${RJ.keyLabel(k.wingForm)} form up · ${RJ.keyLabel(k.wingDefend)} defend objective` : wingy ? "Wingman calls are on the WING buttons in flight." : "";
    chips($("fight-diff"), RJ.modes.DIFFS, s.diff, (v) => { s.diff = v; UI.renderFight(); });
    chips($("fight-arena"), RJ.modes.ARENAS, s.arena, (v) => { s.arena = v; UI.renderFight(); });
    if ($("fight-side-group")) { $("fight-side-group").hidden = s.match !== "war"; if (RJ.modes.SIDES) chips($("fight-side"), RJ.modes.SIDES, s.side, (v) => { s.side = v; UI.renderFight(); }); }
    chips($("fight-time"), TIMES().filter((t) => t.id !== "dynamic"), s.time, (v) => { s.time = v; UI.renderFight(); });
  };

  /* ---------------- challenges ---------------- */
  UI.chalSel = { id: "castlegate", aircraft: RJ.settings.aircraft };
  const pips = (medal) => { const r = RJ.challenges.RANK[medal] || 0; return `<span class="pips" aria-label="${medal || "no"} medal"><i class="pip bronze ${r >= 1 ? "on" : ""}"></i><i class="pip silver ${r >= 2 ? "on" : ""}"></i><i class="pip gold ${r >= 3 ? "on" : ""}"></i></span>`; };
  UI.renderChal = function () {
    const CH = RJ.challenges, s = UI.chalSel, ac = RJ.AIRCRAFT[s.aircraft], def = CH.byId[s.id];
    let total = 0;
    $("chal-list").innerHTML = CH.DEFS.map((d) => {
      const rec = CH.record(d.id) || {}, why = d.req && d.req(ac);
      total += CH.RANK[rec.medal] || 0;
      const best = rec.best != null ? `Best ${CH.fmtValue(d, rec.best)}` : "Not flown";
      return `<button class="opt chal-card ${why ? "blocked" : ""}" data-v="${d.id}" aria-pressed="${d.id === s.id}"><span class="nm">${esc(d.name)}</span><span class="ds">${esc(d.where)} · ${esc(best)}</span>${pips(rec.medal)}</button>`;
    }).join("");
    $("chal-sum").textContent = `${total} / 30 medals`;
    $("chal-ic").innerHTML = UI.icon(def.icon);
    $("chal-where").textContent = def.where;
    $("chal-name").textContent = def.name;
    $("chal-desc").textContent = def.desc;
    $("chal-ac-name").textContent = ac.name;
    $("chal-ac-role").textContent = ac.role;
    const why = def.req && def.req(ac);
    $("chal-warn").hidden = !why; $("chal-warn").textContent = why ? why + ". Pick another aircraft." : "";
    $("chal-start").disabled = !!why;
    const rec = CH.record(def.id) || {}, have = CH.RANK[rec.medal] || 0;
    const pv = why ? null : CH.preview(def.id, ac.id);
    $("chal-targets").innerHTML = ["gold", "silver", "bronze"].map((m, i) =>
      `<div class="t ${m} ${have >= 3 - i ? "got" : ""}"><span class="k">${m}</span><span class="v">${pv ? esc(CH.fmtTarget(def, pv.th[i])) : "—"}</span></div>`).join("");
    $("chal-best").textContent = rec.best != null
      ? `Best ${CH.fmtValue(def, rec.best)} in the ${(RJ.AIRCRAFT[rec.ac] || ac).short}${rec.medal ? ` · ${rec.medal} medal` : ""} · ${rec.tries || 1} attempt${(rec.tries || 1) === 1 ? "" : "s"}`
      : rec.tries ? `${rec.tries} attempt${rec.tries === 1 ? "" : "s"}, not finished yet.` : "Not flown yet.";
    $("chal-keys").textContent = RJ.isTouch ? "" : `${RJ.keyLabel(RJ.settings.keys.retry)} retries instantly in flight`;
  };

  /* ---------------- multiplayer lobby ---------------- */
  UI.inviteLink = (code) => location.href.split("#")[0] + "#join=" + encodeURIComponent(code);
  /** Opened from an invite link (#join=CODE): go straight to the multiplayer screen with the code filled in. */
  UI.checkInvite = function () {
    const m = /[#&]join=([A-Za-z0-9-]{3,12})/.exec(location.hash || "");
    if (!m) return;
    const code = decodeURIComponent(m[1]).toUpperCase();
    try { history.replaceState(null, "", location.href.split("#")[0]); } catch (e) { /* not allowed */ }
    $("btn-mp").click();
    $("mp-code").value = code;
    $("mp-warn").hidden = false; $("mp-warn").style.color = "var(--hazard)";
    $("mp-warn").textContent = `You're invited to lobby ${code}. Set your callsign and aircraft, then press Join.`;
    $("mp-join").focus();
  };
  UI.renderMP = function () {
    const MP = RJ.mp, inL = MP.inLobby(), host = MP.isHost(), cfg = MP.config();
    const ac = RJ.AIRCRAFT[(inL ? MP.me.ac : RJ.settings.aircraft)] || RJ.AIRCRAFT.f16;
    if (document.activeElement !== $("mp-name")) $("mp-name").value = RJ.settings.callsign || "";
    $("mp-name").disabled = inL;
    $("mp-ac-name").textContent = ac.name; $("mp-ac-role").textContent = ac.role;
    $("mp-entry").hidden = inL; $("mp-lobby").hidden = !inL;
    $("md-wrap").hidden = typeof RTCPeerConnection !== "function"; // claude.ai switches WebRTC off inside artifacts
    if (RJ.net.peerjs || typeof window.Peer === "function") $("mp-entry-note").textContent = "Host a game, then send friends the invite link or the code. No accounts needed. Direct connect below is a backup if codes won't connect.";
    $("mp-settings-col").hidden = !inL;
    if (!inL) return;
    $("mp-codev").textContent = MP.code;
    $("mp-copy").hidden = MP.code === "DIRECT";
    $("mp-copy").textContent = RJ.net.peerjs ? "Copy invite link" : "Copy";
    $("md-hostbox").hidden = !(host && MP.room && MP.room.addFriend);
    const mem = MP.members(), hostId = MP.hostId();
    const rows = mem.map((p) => {
      const pr = p.presence, a = RJ.AIRCRAFT[pr.ac];
      const tags = [p.peer === hostId ? '<span class="tag">HOST</span>' : "", cfg.mode === "team" ? `<span class="tag ${pr.tm || "blue"}">${(pr.tm || "blue").toUpperCase()}</span>` : "", pr.mid && cfg.phase === "play" && pr.mid === cfg.mid ? '<span class="tag ok">FLYING</span>' : pr.rdy || p.peer === hostId ? '<span class="tag ok">READY</span>' : '<span class="tag">NOT READY</span>'].join(" ");
      return `<li><span><span class="nm">${esc(pr.nm || "Pilot")}${p.sameTab ? " (you)" : ""}</span><br><span class="ac">${esc(a ? a.name : pr.ac)}</span></span><span></span><span>${tags}</span></li>`;
    });
    for (let i = mem.length; i < 4; i++) rows.push(`<li class="empty"><span>Open seat${cfg.bots && cfg.mode !== "free" ? " · AI bot" : ""}</span><span></span><span></span></li>`);
    $("mp-players").innerHTML = rows.join("");
    const allReady = mem.every((p) => p.peer === hostId || p.presence.rdy);
    $("mp-start").hidden = !host; $("mp-start").disabled = cfg.phase === "play";
    $("mp-start").textContent = cfg.phase === "play" ? "MATCH IN PROGRESS" : allReady ? "START" : "START (not all ready)";
    $("mp-ready").hidden = host; $("mp-ready").textContent = MP.me.rdy ? "Not ready" : "Ready";
    $("mp-team").hidden = cfg.mode !== "team";
    $("mp-rejoin").hidden = !(cfg.phase === "play" && MP.sitOut === cfg.mid);
    $("mp-status").textContent = cfg.phase === "play" ? "A match is in progress." : host ? `You're the host. ${MP.code === "DIRECT" ? "Add friends with their join codes" : RJ.net.peerjs ? "Send friends the invite link (or the code)" : "Share the code"}; up to 4 pilots.${cfg.mode !== "free" && cfg.bots ? " Empty seats get AI bots." : ""}` : "Waiting for the host to start.";
    // settings: host edits, everyone sees
    const ro = !host;
    const chipsRO = (el, items, val, key) => { $(el).innerHTML = items.map(([v, n]) => `<button class="chip" data-mpk="${key}" data-mpv="${v}" aria-pressed="${String(val) === String(v)}" ${ro ? "disabled" : ""}>${esc(n)}</button>`).join(""); };
    $("mp-mode").innerHTML = MP.MODES.map((m) => `<button class="opt" data-mpk="mode" data-mpv="${m.id}" aria-pressed="${cfg.mode === m.id}" ${ro ? "disabled" : ""}><span class="nm">${esc(m.name)}</span><span class="ds">${esc(m.desc)}</span></button>`).join("");
    chipsRO("mp-loc", MP.LOCS.filter((l) => l.id !== "everest" || RJ.world.everest).map((l) => [l.id, l.name]), cfg.loc, "loc");
    chipsRO("mp-tod", Object.entries(RJ.world.TIMES).filter(([k]) => k !== "dynamic").map(([k, t]) => [k, t.label]), cfg.tod, "tod");
    chipsRO("mp-wx", ["clear", "scattered", "overcast", "storm"].map((k) => [k, RJ.world.WEATHER[k].label]), cfg.wx, "wx");
    chipsRO("mp-kl", [[5, "5 kills"], [10, "10"], [20, "20"]], cfg.kl, "kl");
    chipsRO("mp-tl", [[5, "5 min"], [10, "10 min"], [15, "15 min"]], cfg.tl, "tl");
    chipsRO("mp-rd", [[3, "3 s"], [5, "5 s"], [8, "8 s"]], cfg.rd, "rd");
    $("mp-opts").innerHTML = [["bots", "AI bots in empty seats"], ["ff", "Friendly fire"]].map(([k, n]) => `<button class="chip" data-mpk="${k}" data-mpv="toggle" aria-pressed="${!!cfg[k]}" ${ro ? "disabled" : ""}>${esc(n)}</button>`).join("");
    document.querySelectorAll("#mp-settings-col .mp-fight").forEach((e) => (e.hidden = cfg.mode === "free"));
  };

  /* ---------------- atlas ---------------- */
  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  UI.renderAtlas = function () {
    const A = RJ.atlas;
    A.ensure();
    const h = A.home;
    $("atlas-sum").textContent = `${A.foundCount()} / ${A.DEFS.length} logged`;
    $("atlas-grid").innerHTML = A.DEFS.map((d) => {
      const lm = A.byId[d.id], found = A.isFound(d.id);
      if (!lm) return "";
      const dx = lm.marker.x - h.x, dz = lm.marker.z - h.z, km = Math.hypot(dx, dz) / 1000;
      const brg = ((Math.atan2(dx, -dz) / RJ.DEG) + 360) % 360, cp = COMPASS[Math.round(brg / 45) % 8];
      const v = found ? RJ.progress.atlas[d.id] : null, ts = typeof v === "number" ? v : v && v.t, when = ts ? new Date(ts).toLocaleDateString() : "";
      return found
        ? `<div class="atlas-card"><div class="top"><div class="ic">${UI.icon(d.icon)}</div><div><div class="nm">${esc(d.name)}</div><div class="st">LOGGED${when ? " · " + esc(when) : ""}</div></div></div><div class="ds">${esc(d.sub)}. ${km.toFixed(1)} km ${cp} of base.</div><div class="row"><button class="ghost small" data-fly="${d.id}">Fly there</button></div></div>`
        : `<div class="atlas-card unknown"><div class="top"><div class="ic">${UI.icon("peak")}</div><div><div class="nm">Unknown landmark</div><div class="st">NOT LOGGED</div></div></div><div class="ds">Reported somewhere ${cp} of base, roughly ${Math.max(1, Math.round(km / 2) * 2)} km out.</div></div>`;
    }).join("");
  };

  UI.unlockText = function (a) {
    const u = a.unlock || {};
    if (u.xp != null) return `Reach ${RJ.fmtInt(u.xp)} XP (${RJ.rankOf(u.xp).name}). You have ${RJ.fmtInt(RJ.progress.xp)}.`;
    if (u.challenge) { const c = RJ.CHALLENGES.find((x) => x.id === u.challenge); return `Challenge: ${c ? c.name : u.challenge}.`; }
    return "";
  };

  /* ---------------- hangar ---------------- */
  UI.hangar = { from: "main", sel: RJ.settings.aircraft, yaw: 0.6, pitch: 0.22, dist: 1, drag: null, auto: true };
  UI.openHangar = function (from) {
    const h = UI.hangar;
    h.from = from;
    h.sel = from === "free" ? UI.freeSel.aircraft : from === "fight" ? UI.fightSel.aircraft : from === "chal" ? UI.chalSel.aircraft : from === "mp" ? (RJ.mp.inLobby() ? RJ.mp.me.ac : RJ.settings.aircraft) : RJ.settings.aircraft;
    UI.renderHangar();
    UI.show("scr-hangar");
    RJ.state.mode = "hangar";
    RJ.hangarView.setAircraft(h.sel);
  };
  UI.renderHangar = function () {
    const h = UI.hangar;
    const list = RJ.CATEGORIES.map(([cat, label]) => {
      const items = RJ.AIRCRAFT_ORDER.filter((id) => RJ.AIRCRAFT[id].cat === cat).map((id) => {
        const a = RJ.AIRCRAFT[id], un = RJ.isUnlocked(id);
        const tag = !un ? "LOCKED" : a.freeOnly ? "FREE FLIGHT" : `M${RJ.aircraftStats(id).mach.toFixed(1)}`;
        return `<button class="hg-item${un ? "" : " locked"}" data-id="${id}" aria-pressed="${id === h.sel}"><span class="n">${esc(a.name)}</span><span class="t">${tag}</span></button>`;
      }).join("");
      return `<div class="hg-cat"><h3>${esc(label)}</h3><div class="hg-items">${items}</div></div>`;
    }).join("");
    $("hg-list").innerHTML = list;
    const a = RJ.AIRCRAFT[h.sel], st = RJ.aircraftStats(h.sel), F = a.flight;
    $("hg-cat").textContent = (RJ.CATEGORIES.find((c) => c[0] === a.cat) || [0, ""])[1];
    $("hg-name").textContent = a.name;
    $("hg-role").textContent = `${a.role} · ${a.status}`;
    $("hg-desc").textContent = a.desc;
    const bar = (lb, v, txt) => `<div class="stat"><span class="lb">${lb}</span><span class="meter"><i style="width:${Math.round(v * 100)}%"></i></span><span class="vl">${txt}</span></div>`;
    $("hg-stats").innerHTML =
      bar("Top speed", st.speed, `M${st.mach.toFixed(2)}`) +
      bar("Acceleration", st.accel, F.ab ? "AB" : F.eng === "rocket" ? "ROCKET" : "MIL") +
      bar("Maneuverability", st.maneuver, `${F.gmax} G`) +
      bar("Durability", st.durability, `${a.hp} HP`);
    const special = [];
    if (a.stealth > 1.5) special.push(`Stealth: enemy locks take ${a.stealth.toFixed(1)}× longer`);
    if (a.jammer) special.push("Jammer: enemy locks 2× slower, their missiles track poorly");
    if (a.build === "f14" || a.build === "b1b") special.push("Wings sweep back automatically with speed");
    if (a.id === "xb70") special.push("Wingtips fold down above Mach 1");
    if (a.gun && a.gun.turret) special.push("Tail turret fires at enemies behind you");
    if (F.fuel) special.push(`Rocket burn ${F.fuel} s, refuels at idle`);
    if (a.bombs) special.push(`${a.bombs} bombs in Free Flight`);
    const facts = [
      ["First flight", a.year > 2025 ? "Fictional" : a.year],
      ["Max speed", `Mach ${st.mach.toFixed(2)} at ${RJ.fmtInt(F.ref * 3.281)} ft`],
      ["Roll rate", `${F.roll}°/s`],
      ["Gun", a.gun ? a.gun.name : "None"],
      ["Missiles", a.msl.n ? `${a.msl.n} × ${a.msl.name}` : "None"],
      ["Lock", a.msl.n ? `${a.msl.lock.toFixed(1)} s · ${a.msl.cone >= 180 ? "all-aspect" : "±" + a.msl.cone + "°"} · ${(a.msl.range / 1000).toFixed(1)} km` : "—"],
      ["Flares", a.flares || "None"],
      ["Radar", a.radar ? `${Math.round(a.radar / 1000)} km` : "None (visual only)"]
    ];
    if (special.length) facts.push(["Special", special.join(". ")]);
    $("hg-facts").innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    const un = RJ.isUnlocked(h.sel);
    // paint jobs: saved per aircraft, applied to the hangar model and to your jet in every mode
    const paint = (RJ.settings.paint || {})[a.id] || "factory";
    $("hg-paint").innerHTML = Object.entries(RJ.PAINTS).map(([k, v]) => `<button class="chip" data-paint="${k}" aria-pressed="${k === paint}">${esc(v.name)}</button>`).join("");
    $("hg-lock").hidden = un;
    if (!un) $("hg-lock").innerHTML = `<b>Locked for Dogfight.</b> ${esc(UI.unlockText(a))} You can still take it on a test flight in Free Flight.`;
    const sel = $("hg-select");
    if (h.from === "fight") { sel.disabled = !un || a.freeOnly; sel.textContent = a.freeOnly ? "FREE FLIGHT ONLY" : un ? "SELECT" : "LOCKED"; }
    else if (h.from === "free") { sel.disabled = false; sel.textContent = un ? "SELECT" : "TEST FLY"; }
    else { sel.disabled = !un; sel.textContent = un ? "SET AS DEFAULT" : "LOCKED"; }
  };

  /* ---------------- settings ---------------- */
  const SET_TABS = [["graphics", "Graphics"], ["audio", "Audio"], ["controls", "Controls"], ["camera", "Camera & HUD"], ["albums", "Album art"], ["progress", "Progression"]];
  UI.setTab = "graphics";
  function row(label, hint, control) { return `<div class="setrow"><span class="lb">${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</span>${control}</div>`; }
  function chipCtl(key, items) { return `<div class="chips">${items.map(([v, n]) => `<button class="chip" data-set="${key}" data-val="${v}" aria-pressed="${String(RJ.settings[key]) === String(v)}">${esc(n)}</button>`).join("")}</div>`; }
  function toggle(key) { return `<div class="chips"><button class="chip" data-set="${key}" data-val="true" aria-pressed="${RJ.settings[key] === true}">On</button><button class="chip" data-set="${key}" data-val="false" aria-pressed="${RJ.settings[key] === false}">Off</button></div>`; }
  function range(key, min, max, step) { return `<input type="range" id="set-${key}" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${RJ.settings[key]}">`; }
  UI.renderSettings = function () {
    $("set-tabs").innerHTML = SET_TABS.map(([id, n]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${UI.setTab === id}">${n}</button>`).join("");
    let h = "";
    const t = UI.setTab;
    if (t === "graphics") {
      h += row("Quality preset", "Low skips post-processing. Ultra raises terrain detail, view distance and shadow resolution.", chipCtl("quality", [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"]]));
      h += row("Frame rate limit", "Unlimited runs at your monitor's refresh rate (60/120/144/240 Hz)", chipCtl("fpsLimit", [["60", "60"], ["120", "120"], ["144", "144"], ["0", "Unlimited"]]));
      h += row("FPS counter", "Frame rate and frame time, top of the screen", toggle("showFps"));
      h += row("Dynamic resolution", "Lowers the render resolution a little when the frame rate drops, restores it when there's headroom", toggle("dynRes"));
      h += row("Shadows", "Real-time aircraft and airbase shadows (mountain shadows are always on)", toggle("shadows"));
      h += row("Bloom", "Glow from the sun, afterburners and runway lights", toggle("bloom"));
      h += row("Sun shafts & lens flare", "God rays through clouds and terrain edges, camera lens flare (Medium and up)", toggle("sunFx"));
      h += row("Motion blur", "Subtle radial blur at very high speed", toggle("motionBlur"));
      h += row("Heat haze", "Exhaust distortion behind the engines", toggle("heatHaze"));
      h += row("Depth of field", "Cinematic camera and hangar only", toggle("dof"));
      h += row("Anti-aliasing (FXAA)", null, toggle("fxaa"));
      h += row("Water reflections", "Mirror reflections on the sea (High and Ultra)", toggle("waterReflect"));
      h += row("Volumetric clouds", "Raymarched 3D clouds you can fly through (Medium and up, needs WebGL2)", toggle("volClouds"));
      h += row("Cloud shadows", "Clouds cast moving shadows on terrain and aircraft (Medium and up)", toggle("cloudShadows"));
      h += row("Exposure", null, range("exposure", 0.7, 1.3, 0.05));
      h += row("View distance", "Multiplies the terrain draw radius", range("viewDist", 0.6, 1.5, 0.1));
      h += row("Cloud density", null, range("clouds", 0.3, 1.5, 0.1));
    } else if (t === "audio") {
      h += row("Master volume", null, range("master", 0, 1, 0.05));
      h += row("Aircraft engines", "Your jet and the aircraft around you", range("engineVol", 0, 1, 0.05));
      h += row("Wind and ambience", "Airflow, runway rumble, cabin and cockpit ambience", range("envVol", 0, 1, 0.05));
      h += row("Menu music", "Ambient synth score on the main menu and in the hangar", range("musicVol", 0, 1, 0.05));
      h += row("Weapons and effects", null, range("sfxVol", 0, 1, 0.05));
      h += row("Nova (flight companion)", "Greets you in Free Flight, talks during flights and answers anything you ask. Hold " + RJ.keyLabel(RJ.settings.keys.talk) + " or tap 🎙 to talk.", toggle("compOn"));
      h += row("Nova's volume", null, range("compVol", 0, 1, 0.05));
      const cl = RJ.companion.voiceList();
      h += row("Nova's voice", cl.length ? "Natural voices (Edge: Ava, Emma, Jenny) sound the most human" : "Your browser hasn't listed its voices yet. Reopen this tab in a moment.", `<select class="txt" id="comp-voice" style="max-width:320px"><option value="">Auto (most natural female voice)</option>${cl.map((v) => `<option value="${esc(v.name)}" ${RJ.settings.compVoice === v.name ? "selected" : ""}>${v.female ? "♀ " : ""}${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</select>`);
      h += row("How much she talks", null, chipCtl("compChat", [["quiet", "Quiet"], ["normal", "Normal"], ["chatty", "Chatty"]]));
      h += row("Microphone", "Talk to Nova with your voice", toggle("compMic"));
      h += row("Listen after her questions", "When Nova asks you something, the mic opens on its own for your answer", toggle("compFollow"));
      h += row("Nova's AI server", "Lets her talk about anything on the website version. Paste your server address (see the setup guide).", `<input class="txt" id="nova-server" style="max-width:320px" placeholder="https://nova-server.yourname.workers.dev" value="${esc(RJ.settings.novaServer || "")}">`);
      h += row("Test Nova", "Checks her AI connection and has her say hi", `<button class="ghost small" id="comp-test">Test</button> <span class="hint" id="comp-test-out"></span>`);
      h += row("Mute", null, toggle("muted"));
    } else if (t === "controls") {
      h += row("Flight assist", "Holds altitude in banked turns and levels the wings when you let go", toggle("assist"));
      h += row("Invert pitch", "Flight-stick style: up arrow dives", toggle("invert"));
      h += row("Stick sensitivity", null, range("sens", 0.5, 1.5, 0.05));
      h += row("Touch stick sensitivity", "On-screen stick gain. The centre stays fine for small corrections.", range("touchSens", 0.4, 1.8, 0.05));
      h += `<div class="setrow"><span class="lb">Key bindings<span class="hint">Click a key, then press the new one. Arrows, Esc and PgUp/PgDn also work as fixed alternates.</span></span><button class="ghost small" id="keys-reset">Reset keys</button></div>`;
      h += Object.keys(RJ.ACTION_NAMES).map((act) => `<div class="setrow"><span>${esc(RJ.ACTION_NAMES[act])}</span><button class="keybtn" data-bind="${act}">${esc(RJ.keyLabel(RJ.settings.keys[act]))}</button></div>`).join("");
      h += row("Gamepad", "Left stick fly · RT/LT throttle · RB afterburner · A guns · B missile · X flares · Y target · Back camera · Start pause", "");
    } else if (t === "camera") {
      h += row("Starting camera", null, chipCtl("cam", [["chase", "Chase"], ["cockpit", "Cockpit"], ["cinematic", "Cinematic"]]));
      h += row("Field of view", null, range("fov", 55, 85, 1));
      h += row("Camera shake", "Afterburner, guns, G-load, turbulence, the sound barrier and explosions", toggle("shake"));
      h += row("Sonic boom camera", "Replay the boom from outside without taking control away", chipCtl("boomCam", [["inset", "Inset view"], ["full", "Full screen"], ["off", "Off"]]));
      h += row("Speed units", "Mach is always shown", chipCtl("units", [["mph", "MPH"], ["kt", "Knots"], ["kmh", "km/h"]]));
      h += row("Show HUD", null, toggle("hud"));
      h += row("Challenge ghosts", `Your best run flown as a translucent jet (${RJ.keyLabel(RJ.settings.keys.ghost)} toggles in flight)`, toggle("ghosts"));
      h += row("HUD color", null, chipCtl("hudColor", [["green", "Green"], ["amber", "Amber"], ["white", "White"]]));
    } else if (t === "albums") {
      h += RJ.yeAlbums ? RJ.yeAlbums.settingsHTML(row, esc) : "";
    } else {
      h += row("Aircraft", "All 22 aircraft are unlocked. XP still earns ranks and challenges are still tracked.", "");
      h += `<div class="setrow"><span class="lb">Reset progress<span class="hint">Clears XP, challenges, records and stats.</span></span><button class="ghost small" id="prog-reset">${UI._confirmReset ? "Tap again to reset" : "Reset progress"}</button></div>`;
    }
    $("set-body").innerHTML = h;
    if (t === "albums" && RJ.yeAlbums) RJ.yeAlbums.bindUI($("set-body"), UI.renderSettings);
  };
  function applySetting(key) {
    RJ.saveSettings();
    if (["quality", "viewDist", "shadows", "clouds", "waterReflect", "cloudShadows", "volClouds"].includes(key)) RJ.applyGraphics();
    if (key === "fov") RJ.camera.fov = RJ.settings.fov;
    if (key === "assist" && RJ.game && RJ.game.mode && RJ.game.mode.player) RJ.game.mode.player.assist = RJ.settings.assist;
    if (key === "unlockAll") { UI.refreshMain(); }
  }

  /* ---------------- career ---------------- */
  UI.renderCareer = function () {
    const r = RJ.rankOf(RJ.progress.xp), P = RJ.progress;
    $("car-rank").textContent = r.name.toUpperCase();
    $("car-xpbar").style.width = (r.next ? Math.round(((P.xp - r.floor) / (r.next - r.floor)) * 100) : 100) + "%";
    $("car-xp").textContent = r.next ? `${RJ.fmtInt(P.xp)} XP · ${RJ.fmtInt(r.next - P.xp)} to ${r.nextName}` : `${RJ.fmtInt(P.xp)} XP · highest rank`;
    const S = P.stats;
    const cells = [["Flights", S.flights], ["Dogfights", S.matches], ["Wins", S.wins], ["Losses", S.losses], ["Kills", S.kills], ["Deaths", S.deaths], ["Best survival wave", S.bestWave], ["Top speed", `M ${P.records.mach.toFixed(2)}`], ["Max altitude", `${RJ.fmtInt(P.records.alt * 3.281)} ft`]];
    $("car-stats").innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");
    const ch = RJ.CHALLENGES.map((c) => {
      const done = !!P.done[c.id];
      const rw = c.unlock ? `Unlocks ${RJ.AIRCRAFT[c.unlock].short} · +${c.xp} XP` : `+${c.xp} XP`;
      return `<li><span class="${done ? "ok" : "no"}">${done ? "✓" : "○"}</span><span>${esc(c.name)}</span><span class="rw">${esc(rw)}</span></li>`;
    });
    const xpUnl = RJ.AIRCRAFT_ORDER.filter((id) => RJ.AIRCRAFT[id].unlock && RJ.AIRCRAFT[id].unlock.xp != null).map((id) => {
      const a = RJ.AIRCRAFT[id], done = P.xp >= a.unlock.xp;
      return `<li><span class="${done ? "ok" : "no"}">${done ? "✓" : "○"}</span><span>${esc(a.name)}</span><span class="rw">${RJ.fmtInt(a.unlock.xp)} XP</span></li>`;
    });
    $("car-chal").innerHTML = ch.join("") + xpUnl.join("");
  };

  /* ---------------- results ---------------- */
  UI.showResults = function (r) {
    RJ.state.mode = "results";
    UI.gameChrome(false);
    RJ.hud.clear();
    $("res-eyebrow").textContent = r.eyebrow;
    $("res-title").textContent = r.title;
    $("res-title").className = "big " + (r.win ? "win" : "lose");
    $("res-medal").hidden = !r.medal;
    if (r.medal) { $("res-medal").className = "medal-chip " + r.medal; $("res-medal").textContent = r.medal.toUpperCase(); }
    $("res-chal").hidden = !r.chal;
    $("res-keys").hidden = !r.chal || RJ.isTouch;
    $("res-keys").textContent = `${RJ.keyLabel(RJ.settings.keys.retry)} to retry`;
    $("res-again").textContent = r.mp ? (RJ.mp.isHost() ? "PLAY AGAIN" : "WAITING FOR HOST") : r.chal ? "RETRY" : "FLY AGAIN";
    $("res-again").disabled = !!r.mp && !RJ.mp.isHost();
    $("res-menu").textContent = r.mp ? "Return to lobby" : "Main menu";
    UI.resMP = !!r.mp;
    $("res-replay").hidden = !RJ.replay.available();
    $("res-sub").textContent = r.sub || "";
    $("res-stats").innerHTML = (r.stats || []).concat([["XP earned", `+${RJ.fmtInt(r.xp || 0)}`]]).map(([k, v]) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");
    $("res-unlocks").innerHTML = (r.unlocked || []).map((id) => `<span class="unlock">Unlocked: ${esc(RJ.AIRCRAFT[id].name)}</span>`).join("");
    UI.show("scr-results");
    RJ.audio.stopEngines();
  };

  /* ---------------- touch controls ---------------- */
  function initTouch() {
    if (RJ.isTouch) document.body.classList.add("is-touch");
    addEventListener("touchstart", () => { document.body.classList.add("is-touch"); RJ.isTouch = true; }, { once: true, passive: true });
    const stick = $("stick"), knob = $("knob"), zone = $("stick-zone"), T = RJ.input.touch;
    let sid = null;
    // floating stick: the base re-centres under the thumb wherever it lands in the left zone
    const place = (e) => {
      const R = stick.offsetWidth / 2, W = innerWidth, H = innerHeight;
      const x = RJ.clamp(e.clientX, R + 8, W - R - 8), y = RJ.clamp(e.clientY, R + 8, H - R - 8);
      stick.classList.add("floating");
      stick.style.left = `${x - R}px`; stick.style.top = `${y - R}px`; stick.style.bottom = "auto";
    };
    zone.addEventListener("pointerdown", (e) => { if (sid != null) return; sid = e.pointerId; try { zone.setPointerCapture(sid); } catch (err) { /* capture is best-effort */ } place(e); setStick(e); });
    zone.addEventListener("pointermove", (e) => { if (e.pointerId === sid) setStick(e); });
    const endZ = (e) => { if (e.pointerId !== sid) return; sid = null; T.x = T.y = 0; knob.style.transform = ""; stick.classList.remove("floating"); stick.style.left = stick.style.top = stick.style.bottom = ""; };
    zone.addEventListener("pointerup", endZ); zone.addEventListener("pointercancel", endZ);
    const setStick = (e) => {
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const d = Math.hypot(dx, dy), max = R - 18;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      T.x = dx / max; T.y = dy / max;
    };
    stick.addEventListener("pointerdown", (e) => { sid = e.pointerId; stick.setPointerCapture(sid); setStick(e); });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === sid) setStick(e); });
    const endS = (e) => { if (e.pointerId !== sid) return; sid = null; T.x = T.y = 0; knob.style.transform = ""; };
    stick.addEventListener("pointerup", endS); stick.addEventListener("pointercancel", endS);
    const thr = $("thr"), tk = $("thr-knob");
    const setThr = (e) => {
      const r = thr.getBoundingClientRect();
      const v = RJ.clamp(1 - (e.clientY - r.top - 11) / (r.height - 22), 0, 1);
      T.throttle = v; tk.style.top = `${(1 - v) * (r.height - 26) + 2}px`;
    };
    let tid = null;
    thr.addEventListener("pointerdown", (e) => { tid = e.pointerId; thr.setPointerCapture(tid); setThr(e); });
    thr.addEventListener("pointermove", (e) => { if (e.pointerId === tid) setThr(e); });
    thr.addEventListener("pointerup", () => (tid = null));
    tk.style.top = "40px";
    const hold = (id, key) => {
      const el = $(id);
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); T[key] = true; el.classList.add("on"); });
      const off = () => { T[key] = false; el.classList.remove("on"); };
      el.addEventListener("pointerup", off); el.addEventListener("pointercancel", off);
    };
    hold("t-gun", "gun"); hold("t-ab", "ab"); hold("t-brk", "brake");
    const tap = (id, action) => $(id).addEventListener("pointerdown", (e) => { e.preventDefault(); RJ.input.touchEdges.add(action); });
    tap("t-msl", "missile"); tap("t-flr", "flares"); tap("t-tgt", "target"); tap("t-cam", "camera"); tap("t-gear", "gear");
    $("hg-paint").addEventListener("click", (e) => {
      const b = e.target.closest("[data-paint]"); if (!b) return;
      UI.click();
      RJ.settings.paint = Object.assign({}, RJ.settings.paint, { [UI.hangar.sel]: b.dataset.paint === "factory" ? null : b.dataset.paint });
      RJ.saveSettings(); UI.renderHangar(); RJ.hangarView.setAircraft(UI.hangar.sel);
    });
    $("t-wing").addEventListener("pointerdown", (e) => {
      const b = e.target.closest("[data-wing]"); if (!b) return;
      e.preventDefault();
      const m = RJ.game.mode; if (m && m.command) m.command(b.dataset.wing);
    });
  }

  /* ---------------- wiring ---------------- */
  UI.init = function () {
    initTouch();
    $("btn-free").onclick = () => { UI.click(); UI.freeSel.aircraft = UI.freeSel.aircraft || RJ.settings.aircraft; UI.renderFree(); UI.show("scr-free"); };
    $("btn-fight").onclick = () => { UI.click(); if (!RJ.isUnlocked(UI.fightSel.aircraft) || RJ.AIRCRAFT[UI.fightSel.aircraft].freeOnly) UI.fightSel.aircraft = RJ.isUnlocked(RJ.settings.aircraft) && !RJ.AIRCRAFT[RJ.settings.aircraft].freeOnly ? RJ.settings.aircraft : "f16"; UI.renderFight(); UI.show("scr-fight"); };
    $("btn-hangar").onclick = () => { UI.click(); UI.openHangar("main"); };
    $("btn-career").onclick = () => { UI.click(); UI.renderCareer(); UI.show("scr-career"); };
    $("btn-settings").onclick = () => { UI.click(); UI.settingsReturn = "scr-main"; UI.renderSettings(); UI.show("scr-settings"); };
    $("btn-chal").onclick = () => { UI.click(); UI.renderChal(); UI.show("scr-chal"); };
    $("btn-atlas").onclick = () => { UI.click(); UI.renderAtlas(); UI.show("scr-atlas"); };
    $("chal-list").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; UI.click(); UI.chalSel.id = b.dataset.v; UI.renderChal(); };
    $("chal-ac-change").onclick = () => { UI.click(); UI.openHangar("chal"); };
    $("chal-start").onclick = () => { UI.click(); RJ.startGame("challenge", Object.assign({}, UI.chalSel)); };
    $("res-chal").onclick = () => { UI.click(); UI.returnTo = "scr-chal"; RJ.quitToMenu(); };
    $("atlas-grid").onclick = (e) => {
      const b = e.target.closest("[data-fly]"); if (!b) return;
      UI.click();
      RJ.startGame("free", Object.assign({}, UI.freeSel, { activity: "roam", start: "air", near: b.dataset.fly }));
    };
    $("free-back").onclick = $("fight-back").onclick = $("car-back").onclick = $("chal-back").onclick = $("atlas-back").onclick = () => { UI.click(); UI.refreshMain(); UI.show("scr-main"); };
    $("free-ac-change").onclick = () => { UI.click(); UI.openHangar("free"); };
    $("fight-ac-change").onclick = () => { UI.click(); UI.openHangar("fight"); };
    $("free-start").onclick = () => { UI.click(); RJ.startGame("free", Object.assign({}, UI.freeSel)); };
    $("fight-start").onclick = () => { UI.click(); RJ.startGame("fight", Object.assign({}, UI.fightSel)); };

    $("hg-list").onclick = (e) => {
      const b = e.target.closest("[data-id]"); if (!b) return;
      UI.click(); UI.hangar.sel = b.dataset.id; UI.renderHangar(); RJ.hangarView.setAircraft(b.dataset.id);
      const act = $("hg-list").querySelector(`[data-id="${b.dataset.id}"]`); if (act) act.focus({ preventScroll: true });
    };
    const leaveHangar = () => {
      RJ.state.mode = "menu";
      const f = UI.hangar.from;
      if (f === "free") { UI.renderFree(); UI.show("scr-free"); } else if (f === "fight") { UI.renderFight(); UI.show("scr-fight"); } else if (f === "chal") { UI.renderChal(); UI.show("scr-chal"); } else if (f === "mp") { UI.renderMP(); UI.show("scr-mp"); } else { UI.refreshMain(); UI.show("scr-main"); }
    };
    $("hg-back").onclick = () => { UI.click(); leaveHangar(); };
    $("hg-select").onclick = () => {
      UI.click();
      const id = UI.hangar.sel, f = UI.hangar.from;
      if (f === "free") UI.freeSel.aircraft = id;
      else if (f === "fight") UI.fightSel.aircraft = id;
      else if (f === "chal") UI.chalSel.aircraft = id;
      else if (f === "mp") { RJ.settings.aircraft = id; RJ.saveSettings(); if (RJ.mp.inLobby()) RJ.mp.set({ ac: id }); }
      if (RJ.isUnlocked(id) && f !== "free") { RJ.settings.aircraft = id; RJ.saveSettings(); }
      if (f === "free" && RJ.isUnlocked(id)) { RJ.settings.aircraft = id; RJ.saveSettings(); }
      leaveHangar();
    };
    $("hg-test").onclick = () => { UI.click(); UI.freeSel.aircraft = UI.hangar.sel; RJ.startGame("free", Object.assign({}, UI.freeSel, { activity: "roam" })); };

    // settings
    $("set-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; UI.click(); UI.setTab = b.dataset.tab; UI._confirmReset = false; UI.renderSettings(); };
    $("set-body").addEventListener("click", (e) => {
      const c = e.target.closest("[data-set]");
      if (c) {
        const key = c.dataset.set, raw = c.dataset.val;
        RJ.settings[key] = raw === "true" ? true : raw === "false" ? false : raw;
        UI.click(); applySetting(key); UI.renderSettings(); return;
      }
      const kb = e.target.closest("[data-bind]");
      if (kb) {
        kb.classList.add("listening"); kb.textContent = "Press a key…";
        RJ.input.capture = (k) => {
          if (k !== "escape") {
            const act = kb.dataset.bind;
            for (const a in RJ.settings.keys) if (RJ.settings.keys[a] === k && a !== act) RJ.settings.keys[a] = RJ.settings.keys[act];
            RJ.settings.keys[act] = k; RJ.saveSettings();
          }
          UI.renderSettings();
        };
        return;
      }
      if (e.target.id === "keys-reset") { RJ.resetKeys(); UI.renderSettings(); }
      if (e.target.id === "comp-test") { RJ.audio.init(); const out = $("comp-test-out"); out.textContent = "Testing…"; RJ.companion.testBrain().then((t) => { out.textContent = t; }); }
      if (e.target.id === "prog-reset") {
        if (UI._confirmReset) { RJ.resetProgress(); UI._confirmReset = false; UI.toast("Progress reset."); }
        else UI._confirmReset = true;
        UI.renderSettings();
      }
    });
    $("set-body").addEventListener("change", (e) => {
      if (e.target.id === "comp-voice") { RJ.settings.compVoice = e.target.value; RJ.saveSettings(); RJ.companion.say("How do I sound? Better?", 1, { reply: true }); }
      if (e.target.id === "nova-server") { RJ.settings.novaServer = e.target.value.trim(); RJ.saveSettings(); }
    });
    // voices load asynchronously in some browsers: refresh the list when they arrive
    if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", () => { if (UI.current === "scr-settings" && UI.setTab === "audio") UI.renderSettings(); });
    $("set-body").addEventListener("input", (e) => {
      const k = e.target.dataset.range; if (!k) return;
      RJ.settings[k] = parseFloat(e.target.value);
      if (k === "viewDist" || k === "clouds") { clearTimeout(UI._gt); UI._gt = setTimeout(() => applySetting(k), 350); } else applySetting(k);
    });
    $("set-back").onclick = () => { UI.click(); RJ.input.capture = null; UI.show(UI.settingsReturn || "scr-main"); if (UI.settingsReturn === "scr-main") UI.refreshMain(); };

    // pause / results
    $("pz-resume").onclick = () => RJ.resume();
    $("pz-restart").onclick = () => { UI.click(); RJ.restartGame(); };
    $("pz-settings").onclick = () => { UI.click(); UI.settingsReturn = "scr-pause"; UI.renderSettings(); UI.show("scr-settings"); };
    $("pz-quit").onclick = () => { UI.click(); RJ.quitToMenu(); };
    $("res-again").onclick = () => { UI.click(); if (UI.resMP) { if (RJ.mp.isHost()) RJ.mp.startMatch(); return; } RJ.restartGame(); };
    $("res-replay").onclick = () => { UI.click(); RJ.replay.start("results"); };
    $("pz-replay").onclick = () => { UI.click(); RJ.replay.start("paused"); };
    $("pz-photo").onclick = () => { UI.click(); RJ.photo.start("paused"); };
    $("res-menu").onclick = () => { UI.click(); if (UI.resMP) { RJ.mp.toLobby(); UI.returnTo = "scr-mp"; } RJ.quitToMenu(); };
    // multiplayer lobby
    RJ.mp.listeners.push(() => { if (UI.current === "scr-mp") UI.renderMP(); if (UI.current === "scr-results" && UI.resMP) { $("res-again").disabled = !RJ.mp.isHost(); $("res-again").textContent = RJ.mp.isHost() ? "PLAY AGAIN" : "WAITING FOR HOST"; } });
    const mpWarn = (msg) => { $("mp-warn").hidden = !msg; $("mp-warn").style.color = ""; $("mp-warn").textContent = msg || ""; };
    $("btn-mp").onclick = () => { UI.click(); mpWarn(""); UI.renderMP(); UI.show("scr-mp"); RJ.net.init(); };
    $("mp-back").onclick = async () => { UI.click(); if (RJ.mp.inLobby()) await RJ.mp.leave(); if (window.RJ_resetGuest) RJ_resetGuest(); UI.refreshMain(); UI.show("scr-main"); };
    $("mp-name").oninput = (e) => { RJ.settings.callsign = e.target.value.replace(/[^\w .\-]/g, "").slice(0, 14); RJ.saveSettings(); };
    $("mp-ac-change").onclick = () => { UI.click(); UI.openHangar("mp"); };
    const busy = (on) => { $("mp-host").disabled = $("mp-join").disabled = on; };
    $("mp-host").onclick = async () => {
      UI.click(); mpWarn(""); busy(true);
      for (let tries = 0; tries < 4; tries++) {
        try { await RJ.mp.open(RJ.mp.genCode(), true); break; }
        catch (e) { if (e.code === "unavailable-id" && tries < 3) continue; mpWarn(e.message); break; } // code taken: pick another
      }
      busy(false); UI.renderMP();
    };
    $("mp-join").onclick = async () => {
      UI.click(); mpWarn("");
      const code = $("mp-code").value.trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,12}$/.test(code)) { mpWarn("Enter the lobby code the host sees, like SQUAD-7."); return; }
      busy(true); $("mp-status").textContent = "Joining…";
      try { await RJ.mp.open(code, false); } catch (e) { mpWarn(e.message); }
      busy(false); UI.renderMP();
    };
    $("mp-code").onkeydown = (e) => { if (e.key === "Enter") $("mp-join").click(); };
    // ---- direct connect: codes swapped by hand, WebRTC underneath ----
    const copyBox = (id) => {
      const el = $(id); el.focus(); el.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* not allowed */ }
      if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => UI.toast("Copied. Paste it into a text to your friend.", 2000), () => { if (!ok) UI.toast("Press Ctrl+C (or Cmd+C) to copy the highlighted code.", 3000); });
      else UI.toast(ok ? "Copied." : "Press Ctrl+C (or Cmd+C) to copy the highlighted code.", 2500);
    };
    const dBusy = (on) => { $("md-host").disabled = $("md-join").disabled = $("mp-host").disabled = $("mp-join").disabled = on; };
    let guestLink = null;
    const resetGuest = () => { if (guestLink) { guestLink.cancel(); guestLink = null; } $("md-guest").hidden = true; $("md-pick").hidden = false; $("md-mycode").value = ""; $("md-reply").value = ""; $("md-gstat").textContent = ""; dBusy(false); };
    $("md-host").onclick = async () => {
      UI.click(); mpWarn(""); dBusy(true);
      try { await RJ.mp.open("DIRECT", true, RJ.net.direct.hub()); $("md-in").value = ""; $("md-out").value = ""; $("md-outwrap").hidden = true; $("md-hstat").textContent = ""; }
      catch (e) { mpWarn(e.message); }
      dBusy(false); UI.renderMP();
    };
    $("md-join").onclick = async () => {
      UI.click(); mpWarn(""); dBusy(true);
      $("md-pick").hidden = true; $("md-guest").hidden = false; $("md-gstat").textContent = "";
      try { guestLink = await RJ.net.direct.guest(); $("md-mycode").value = guestLink.code; $("md-gstat").textContent = "Text this code to the host, then wait for their reply code."; }
      catch (e) { mpWarn(e.message); resetGuest(); }
    };
    $("md-copy").onclick = () => copyBox("md-mycode");
    window.RJ_resetGuest = resetGuest;
    $("md-cancel").onclick = () => { UI.click(); resetGuest(); };
    $("md-connect").onclick = async () => {
      UI.click(); mpWarn("");
      if (!guestLink) return;
      $("md-connect").disabled = true; $("md-gstat").textContent = "Connecting to the host…";
      try {
        const room = await guestLink.connect($("md-reply").value);
        $("md-gstat").textContent = "Connected! Joining the lobby…";
        await RJ.mp.open("DIRECT", false, room);
        guestLink = null; resetGuest();
      } catch (e) { $("md-gstat").textContent = ""; mpWarn(e.message); }
      $("md-connect").disabled = false; UI.renderMP();
    };
    $("md-add").onclick = async () => {
      UI.click(); mpWarn("");
      const room = RJ.mp.room; if (!room || !room.addFriend) return;
      $("md-add").disabled = true; $("md-hstat").textContent = "Making the reply code…";
      try {
        $("md-out").value = await room.addFriend($("md-in").value);
        $("md-outwrap").hidden = false; $("md-in").value = "";
        $("md-hstat").textContent = "Text this reply code back to your friend. They'll appear in Pilots once it connects.";
      } catch (e) { $("md-hstat").textContent = ""; mpWarn(e.message); }
      $("md-add").disabled = false;
    };
    $("md-copy2").onclick = () => copyBox("md-out");
    $("mp-copy").onclick = () => {
      const text = RJ.net.peerjs ? UI.inviteLink(RJ.mp.code) : RJ.mp.code;
      try { navigator.clipboard.writeText(text).then(() => UI.toast(RJ.net.peerjs ? "Invite link copied. Paste it to your friends." : "Code copied.", 2000), () => UI.toast(text, 6000)); } catch (e) { UI.toast(text, 6000); }
    };
    $("mp-leave").onclick = async () => { UI.click(); await RJ.mp.leave(); UI.renderMP(); };
    $("mp-ready").onclick = () => { if (!RJ.mp.inLobby()) return; UI.click(); RJ.mp.set({ rdy: !RJ.mp.me.rdy }); UI.renderMP(); };
    $("mp-team").onclick = () => { if (!RJ.mp.inLobby()) return; UI.click(); RJ.mp.set({ tm: RJ.mp.me.tm === "red" ? "blue" : "red" }); UI.renderMP(); };
    $("mp-start").onclick = () => { UI.click(); RJ.mp.startMatch(); };
    $("mp-rejoin").onclick = () => { UI.click(); RJ.mp.rejoin(); };
    $("mp-settings-col").onclick = (e) => {
      const b = e.target.closest("[data-mpk]"); if (!b || b.disabled) return;
      UI.click();
      const k = b.dataset.mpk, v = b.dataset.mpv, cfg = RJ.mp.config();
      RJ.mp.setCfg({ [k]: v === "toggle" ? !cfg[k] : /^\d+$/.test(v) ? +v : v });
      UI.renderMP();
    };
    $("btn-pause").onclick = () => RJ.pause();
    $("btn-cam").onclick = (e) => { RJ.input.touchEdges.add("camera"); e.currentTarget.blur(); };

    RJ.on("discover", (d) => UI.discover(d));
    RJ.on("challenge", (d) => {
      const un = d.unlocked.map((id) => RJ.AIRCRAFT[id].name).join(", ");
      UI.toast(`Challenge complete: ${esc(d.challenge.name)} · +${d.challenge.xp} XP${un ? `<br>Unlocked: ${esc(un)}` : ""}`, 5000);
    });

    // hangar orbit controls
    const view = $("hg-view"), h = UI.hangar;
    const pts = new Map();
    view.addEventListener("pointerdown", (e) => { view.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); h.auto = false; });
    view.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2) {
        const arr = [...pts.values()]; const d0 = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        p.x = e.clientX; p.y = e.clientY;
        const arr2 = [...pts.values()]; const d1 = Math.hypot(arr2[0].x - arr2[1].x, arr2[0].y - arr2[1].y);
        h.dist = RJ.clamp(h.dist * (d0 / Math.max(d1, 1)), 0.5, 2.2);
        return;
      }
      h.yaw -= (e.clientX - p.x) * 0.008; h.pitch = RJ.clamp(h.pitch + (e.clientY - p.y) * 0.006, -0.3, 1.2);
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => pts.delete(e.pointerId);
    view.addEventListener("pointerup", up); view.addEventListener("pointercancel", up);
    view.addEventListener("wheel", (e) => { e.preventDefault(); h.dist = RJ.clamp(h.dist * (e.deltaY > 0 ? 1.1 : 0.9), 0.5, 2.2); }, { passive: false });
    UI.refreshMain();
  };
})(window.RJ);
