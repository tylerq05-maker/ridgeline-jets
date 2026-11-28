/* Jet City — Arthur, the flight AI.
 * A composed British AI who runs the jet's systems with you: crisp in combat, dry wit while cruising, warm when you
 * fly well. He calls you "sir".
 *   Brain: Claude (Sonnet 5.5) through claude.ai's `sample` capability, on the viewer's own Claude plan. He answers
 *          anything, and acts in the game by writing short command tags that the page carries out.
 *   Ears:  claude.ai dictation (hold Y or tap the mic) where it is offered, the browser's speech recognition on the
 *          website, and a typing box everywhere (Enter, or the ⌨ button).
 *   Voice: the most natural British male voice the browser has, spoken sentence by sentence as the answer arrives.
 *   Memory: a small private record of you (facts you ask him to remember, your flights) in claude.ai storage, or the
 *          browser on the website.
 *   Face:  a holographic ring on the HUD that turns while he listens, thinks and speaks.
 * Event callouts (missiles, stalls, kills, landmarks) come from real game state on one prioritised speech channel. */
(function (RJ) {
  "use strict";
  const NAME = "Arthur";
  const C = (RJ.companion = { chat: [], events: [], cool: {}, last: 0, listening: false, name: NAME });
  const S = () => RJ.settings;
  const pick = (a) => { let i = Math.floor(Math.random() * a.length); if (a.length > 1 && a[i] === pick.prev) i = (i + 1) % a.length; pick.prev = a[i]; return a[i]; };
  const spd = (v) => { const u = RJ.speedUnit(); return `${Math.round(v * u[1])} ${u[0] === "KT" ? "knots" : u[0] === "KM/H" ? "kilometres an hour" : "miles an hour"}`; };
  const GAP = { quiet: 30, normal: 13, chatty: 7 };
  const MODEL = "claude-sonnet-5-5";
  // one-time move to Arthur's defaults (older saves were tuned for Nova)
  if (!S().arthurV1) { S().compChat = "chatty"; S().compVoice = ""; S().compOn = true; S().arthurV1 = true; try { RJ.saveSettings(); } catch (e) { /* storage unavailable */ } }

  /* ---------------- claude.ai capabilities (null on the website or when not granted) ---------------- */
  const capP = {};
  const cap = (n) => capP[n] || (capP[n] = (window.claude && typeof window.claude.use === "function" ? Promise.resolve(window.claude.use(n)).catch(() => null) : Promise.resolve(null)));
  let SAMPLE = null, DICT = null;
  cap("sample").then((s) => { SAMPLE = s; });
  cap("dictation").then((d) => { DICT = d; if (d) wireDictation(d); });

  /* ---------------- his voice: a natural British male voice ---------------- */
  const FEMALE = /ava|emma|jenny|aria|michelle|sonia|libby|maisie|natasha|clara|sara|samantha|serena|karen|moira|tessa|victoria|zira|susan|hazel|female|kate|fiona|martha|catherine|mia|amy|olivia|bella|nicky/i;
  const MALE = /ryan|thomas|george|oliver|alfie|elliot|noah|arthur|daniel|harry|william|lewis|guy|david|mark|christopher|eric|andrew|brian|roger|steffan|james|male/i;
  const NATURAL = /natural|neural|online|premium|enhanced/i;
  const GB = (v) => /^en[-_](gb|uk)/i.test(v.lang) || /\bUK\b|british|united kingdom/i.test(v.name);
  const isFemale = (v) => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, ""));
  const isMale = (v) => !isFemale(v) && MALE.test(v.name);
  function rank(v) {
    const gb = GB(v), m = isMale(v), nat = NATURAL.test(v.name);
    if (gb && m) return nat ? 0 : 1;
    if (gb && !isFemale(v)) return 2;
    if (m) return nat ? 3 : 4;
    return isFemale(v) ? 7 : 5;
  }
  C.voiceList = function () {
    if (!window.speechSynthesis) return [];
    return speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((v) => ({ name: v.name, lang: v.lang, female: isFemale(v), british: GB(v) }));
  };
  function voice(radio) {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    // radio calls (air defence, interceptors): an American male voice, so they never sound like Arthur
    if (radio) { const en = vs.filter((v) => /^en[-_]us/i.test(v.lang) && !isFemale(v)); return en.find((v) => MALE.test(v.name)) || en[0] || null; }
    return (S().compVoice && vs.find((v) => v.name === S().compVoice)) || vs.find((v) => v.name === (C.voiceList()[0] || {}).name) || null;
  }

  /* ---------------- one speech channel ----------------
   * 3 critical (interrupts anything), 2 important (waits for the current line), 1 event/answer, 0 casual.
   * An item is spoken part by part; a streaming answer keeps adding parts while it is still open. */
  let current = null, pending = null;
  const canSpeak = () => !!window.speechSynthesis && typeof SpeechSynthesisUtterance === "function";
  const split = (t) => (String(t).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [String(t)]).map((s) => s.trim()).filter(Boolean);
  function speakNow(item) {
    current = item; item.i = item.i || 0;
    caption(item.text, item.speaker);
    if (item.speaker) RJ.audio.beep(1700, 0.05, 0.03); // radio squelch
    const silent = !canSpeak() || S().muted || !(S().compVol > 0);
    if (RJ.audio.duck && !silent) RJ.audio.duck(0.6); // engines dip under his voice, never vanish
    if (C.state !== "error") status("speaking");
    item.next = () => {
      if (current !== item) return;
      if (item.i >= item.parts.length) { if (item.open) { item.waiting = true; return; } done(item); return; }
      item.waiting = false;
      const part = item.parts[item.i++];
      if (silent) { setTimeout(item.next, 600 + part.length * 45); return; }
      const u = new SpeechSynthesisUtterance(part), v = voice(item.radio);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = (item.pri >= 3 ? 1.1 : 1.0) * (item.speaker ? 1.08 : 1);
      u.pitch = item.radio ? 0.8 : 0.92;
      u.volume = RJ.clamp(S().master * S().compVol, 0, 1);
      u.onend = () => setTimeout(item.next, 70);
      u.onerror = () => setTimeout(item.next, 30);
      try { speechSynthesis.speak(u); } catch (e) { done(item); }
    };
    item.next();
  }
  function done(item) {
    if (current !== item) return;
    current = null; C.last = performance.now() / 1000;
    if (RJ.audio.unduck) RJ.audio.unduck(0.8);
    if (!C.listening && !C.thinking && C.state !== "error") status(null);
    const after = item.after || [];
    after.forEach((f) => { try { f(); } catch (e) { console.warn("Arthur action", e); } });
    if (pending) { const p = pending; pending = null; setTimeout(() => speakNow(p), 250); return; }
    if (item.followUp && S().compFollow !== false && RJ.state.mode === "playing" && !DICT) setTimeout(() => { if (!current && !C.listening) C.startTalk(true); }, 350);
  }
  function hush() {
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* none */ }
    current = null;
    if (RJ.audio.unduck) RJ.audio.unduck(0.3);
  }
  /** Say a line. Returns false when it was dropped (busy, too soon, pilot talking, Arthur off). */
  C.say = function (text, pri = 1, opts = {}) {
    if ((!S().compOn && !opts.speaker) || !text) return false; // radio calls (opts.speaker) play even with Arthur off
    const now = performance.now() / 1000;
    if (C.listening && pri < 3) return false;
    if (pri <= 1 && !opts.reply && now - C.last < GAP[S().compChat || "chatty"] * (pri === 0 ? 2 : 1)) return false;
    const item = { text, parts: split(text), pri, followUp: !!opts.followUp, speaker: opts.speaker || null, radio: !!opts.male };
    return queue(item, opts.reply);
  };
  function queue(item, reply) {
    const busy = current || (window.speechSynthesis && speechSynthesis.speaking);
    if (busy) {
      if (item.pri >= 3 && (!current || current.pri < 3)) { hush(); speakNow(item); return true; }
      if (item.pri >= 2 || reply) { if (!pending || pending.pri <= item.pri) pending = item; return true; }
      return false;
    }
    speakNow(item);
    return true;
  }
  function caption(text, speaker) {
    let el = document.getElementById("rj-caption");
    if (!el) { el = document.createElement("div"); el.id = "rj-caption"; document.body.appendChild(el); }
    el.textContent = `${speaker ? "📻 " + speaker : NAME}: ${text}`; el.classList.add("on");
    clearTimeout(caption.t); caption.t = setTimeout(() => el.classList.remove("on"), 3000 + text.length * 60);
  }
  /** Event line with its own cooldown (s) so the same thing is never announced twice in a row. */
  function event(key, cd, pri, lines, note) {
    const now = performance.now() / 1000;
    if (C.cool[key] && now - C.cool[key] < cd) return;
    const line = typeof lines === "function" ? lines() : pick(lines);
    if (C.say(line, pri)) { C.cool[key] = now; note1(note || key); }
  }
  const note1 = (n) => { C.events.push(`${Math.round(C.t || 0)}s: ${n}`); if (C.events.length > 14) C.events.shift(); };

  /* ---------------- the ring (his face on the HUD) and status line ---------------- */
  function ring() {
    let el = document.getElementById("arthur-ring");
    if (el) return el;
    if (!document.getElementById("arthur-css")) {
      const st = document.createElement("style"); st.id = "arthur-css";
      st.textContent = `
#arthur-ring{position:fixed;top:96px;right:28px;width:66px;height:66px;z-index:29;pointer-events:none;opacity:.42;transition:opacity .4s,transform .4s;filter:drop-shadow(0 0 6px rgba(80,200,255,.55))}
#arthur-ring svg{width:100%;height:100%;overflow:visible}
#arthur-ring .r1{transform-origin:50% 50%;animation:ar-spin 14s linear infinite}
#arthur-ring .r2{transform-origin:50% 50%;animation:ar-spin 9s linear infinite reverse}
#arthur-ring .core{transform-origin:50% 50%;transition:transform .2s}
#arthur-ring[data-state="listening"]{opacity:1}#arthur-ring[data-state="listening"] .core{animation:ar-breathe 1.1s ease-in-out infinite}
#arthur-ring[data-state="thinking"]{opacity:1}#arthur-ring[data-state="thinking"] .r1{animation-duration:1.6s}#arthur-ring[data-state="thinking"] .r2{animation-duration:1.1s}
#arthur-ring[data-state="speaking"]{opacity:1}#arthur-ring[data-state="speaking"] .core{animation:ar-talk .32s ease-in-out infinite alternate}
#arthur-ring[data-state="error"]{opacity:.9;filter:drop-shadow(0 0 6px rgba(255,90,79,.7))}
#arthur-ring .lbl{font:600 7px/1 var(--font-mono,monospace);letter-spacing:.3em;fill:#bfeaff}
@keyframes ar-spin{to{transform:rotate(360deg)}}@keyframes ar-breathe{50%{transform:scale(1.18)}}@keyframes ar-talk{from{transform:scale(.9)}to{transform:scale(1.22)}}
#arthur-chat{position:fixed;left:50%;bottom:28%;transform:translateX(-50%);z-index:40;display:flex;gap:6px;width:min(560px,calc(100vw - 32px))}
#arthur-chat[hidden]{display:none}
#arthur-chat input{flex:1;min-width:0;padding:10px 14px;border-radius:4px;border:1px solid rgba(80,200,255,.6);background:rgba(6,12,20,.86);color:#e8f6ff;font:15px/1.3 inherit;outline:none}
#arthur-chat button{padding:0 14px;border-radius:4px;border:1px solid rgba(80,200,255,.6);background:rgba(20,60,90,.85);color:#e8f6ff;font:600 13px/1 inherit;cursor:pointer}
@media (max-width:720px){#arthur-ring{top:84px;right:10px;width:46px;height:46px}#arthur-chat{bottom:auto;top:110px}}`;
      document.head.appendChild(st);
    }
    el = document.createElement("div"); el.id = "arthur-ring";
    el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
<g class="r1"><circle cx="50" cy="50" r="46" fill="none" stroke="#5fd0ff" stroke-width="1.4" stroke-dasharray="22 7 4 7" opacity=".9"/></g>
<g class="r2"><circle cx="50" cy="50" r="38" fill="none" stroke="#9fe6ff" stroke-width="2.2" stroke-dasharray="2 5" opacity=".75"/></g>
<circle cx="50" cy="50" r="31" fill="rgba(20,90,140,.18)" stroke="#5fd0ff" stroke-width=".8" opacity=".8"/>
<g class="core"><circle cx="50" cy="50" r="15" fill="rgba(140,225,255,.35)" stroke="#d8f6ff" stroke-width="1.6"/><circle cx="50" cy="50" r="6" fill="#e9fbff"/></g>
<text class="lbl" x="50" y="99" text-anchor="middle">ARTHUR</text></svg>`;
    (document.getElementById("game-ui") || document.body).appendChild(el);
    return el;
  }
  function status(state, text) {
    C.state = state;
    const el = document.getElementById("comp-status"), btn = document.getElementById("btn-talk");
    if (btn) btn.dataset.state = state || "";
    ring().dataset.state = state || "";
    if (!el) return;
    const label = { listening: "🎙 Listening…", thinking: `${NAME} is thinking…`, speaking: "", error: "" }[state];
    const t = text || label;
    el.hidden = !t; el.textContent = t || ""; el.dataset.state = state || "";
    clearTimeout(status.t);
    if (state === "error") status.t = setTimeout(() => { if (C.state === "error") status(null); }, 7000);
  }

  /* ---------------- live game state ---------------- */
  function clock(pl, pos) {
    const d = pos.clone().sub(pl.pos); d.y = 0;
    const f = pl.fwd.clone(); f.y = 0;
    const a = Math.atan2(f.x * d.z - f.z * d.x, f.x * d.x + f.z * d.z);
    let h = Math.round(-a / (Math.PI / 6)); h = ((h % 12) + 12) % 12;
    return h === 0 ? 12 : h;
  }
  const dist = (m) => (m > 1500 ? `${(m / 1609).toFixed(1)} miles` : `${Math.round(m * 3.28 / 100) * 100} feet`);
  function nearestLandmark(pl) {
    const A = RJ.atlas;
    if (!A || !A.byId) return null;
    let best = null;
    for (const d of A.DEFS) { const lm = A.byId[d.id]; if (!lm || !lm.marker) continue; const k = Math.hypot(lm.marker.x - pl.pos.x, lm.marker.z - pl.pos.z); if (!best || k < best.k) best = { d, lm, k }; }
    return best;
  }
  function compass(pl, pos) {
    const b = ((Math.atan2(pos.x - pl.pos.x, -(pos.z - pl.pos.z)) * 180 / Math.PI) + 360) % 360;
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];
  }
  /** Facts he may use: everything comes from the running game. */
  C.snapshot = function () {
    const m = RJ.game && RJ.game.mode, pl = m && m.player;
    if (!pl) return null;
    const W = RJ.world, env = W.env || {}, nl = nearestLandmark(pl);
    const hdg = ((Math.atan2(pl.fwd.x, -pl.fwd.z) * 180 / Math.PI) + 360) % 360;
    const enemies = RJ.combat.enemiesOf ? RJ.combat.enemiesOf(pl).filter((e) => e.alive !== false && e.pos.distanceTo(pl.pos) < 20000) : [];
    const near = enemies.map((e) => ({ type: e.spec && e.spec.short, clock: clock(pl, e.pos), range: dist(e.pos.distanceTo(pl.pos)), above: e.pos.y > pl.pos.y + 150, below: e.pos.y < pl.pos.y - 150 })).slice(0, 4);
    const wanted = RJ.airspace && RJ.airspace.wanted ? RJ.airspace.wanted.level : 0;
    return {
      aircraft: pl.spec.name, aircraft_id: pl.spec.id || (RJ.game.config && RJ.game.config.opts && RJ.game.config.opts.aircraft), role: pl.spec.role, mode: m.kind,
      region: RJ.game.config && RJ.game.config.opts ? RJ.game.config.opts.region || RJ.game.config.opts.arena : null, state: pl.state,
      altitude_ft: Math.round(pl.pos.y * 3.28084), above_ground_ft: Math.round(pl.agl * 3.28084),
      speed: spd(pl.speed), mach: +pl.mach.toFixed(2), stall_speed: spd(pl.spec.flight.vstall || 0), heading_deg: Math.round(hdg), g: +pl.g.toFixed(1), throttle_pct: Math.round(pl.throttle * 100), afterburner: pl.abLevel > 0.3,
      airframe_pct: Math.round(Math.max(0, pl.hp) / pl.maxHp * 100), gear: pl.gearDown ? "down" : "up", fuel_pct: pl.fuel != null && pl.spec.flight.fuel ? Math.round(pl.fuel / pl.spec.flight.fuel * 100) : null,
      missiles_left: pl.ammo ? pl.ammo.missiles : undefined, flares_left: pl.ammo ? pl.ammo.flares : undefined,
      weather: (RJ.world.WEATHER[env.weather] || {}).label || env.weather, time_of_day: (RJ.world.TIMES[env.time] || {}).label || env.time,
      outside_air_c: Math.round(15 - 6.5 * Math.min(11, pl.pos.y / 1000)), in_cloud: (W.inCloud || 0) > 0.3, underwater: !!W.underwater,
      nearest_landmark: nl ? { name: nl.d.name, about: nl.d.sub, distance: dist(nl.k), direction: compass(pl, nl.lm.marker) } : null,
      waypoint_set: !!(RJ.nav && RJ.nav.wp), autopilot: !!(RJ.nav && RJ.nav.auto),
      enemies_within_20km: enemies.length, nearest_enemies: near, missiles_inbound: pl.incoming.length, wanted_level: wanted,
      objective: m.objective ? String(m.objective()).replace(/<[^>]+>/g, "").slice(0, 120) : null
    };
  };

  /* ---------------- memory: a small private record of the pilot ---------------- */
  const MEM = { facts: [], flights: 0, kills: 0, best: {}, favourite: {}, since: 0 };
  let memDoc = null, memSaveT = 0;
  (async () => {
    try {
      const db = await cap("db"), user = await cap("user");
      if (db && user) { const id = await user.id(); if (id) memDoc = db.collection("data/users/" + id).doc("arthur"); }
      let d = null;
      if (memDoc) { const s = await memDoc.get(); if (s.exists) d = s.data(); }
      else d = RJ.store.get("arthur-mem", null);
      if (d && typeof d === "object") Object.assign(MEM, JSON.parse(JSON.stringify(d)));
    } catch (e) { console.warn("Arthur memory", e); }
    if (!MEM.since) MEM.since = Date.now();
  })();
  function saveMem() {
    clearTimeout(memSaveT);
    memSaveT = setTimeout(() => {
      const d = JSON.parse(JSON.stringify(MEM));
      if (memDoc) memDoc.set(d).catch((e) => console.warn("Arthur memory save", e));
      else RJ.store.set("arthur-mem", d);
    }, 1500);
  }
  function remember(fact) {
    fact = String(fact || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!fact) return;
    if (!MEM.facts.some((f) => f.toLowerCase() === fact.toLowerCase())) { MEM.facts.push(fact); if (MEM.facts.length > 40) MEM.facts.shift(); saveMem(); }
  }
  function memSummary() {
    const fav = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`).join(", ");
    return [
      MEM.facts.length ? "Things sir asked you to remember or told you: " + MEM.facts.join("; ") : "",
      `Flights together: ${MEM.flights}. Kills: ${MEM.kills}.`,
      Object.keys(MEM.favourite).length ? `Most-flown aircraft: ${fav(MEM.favourite)}.` : "",
      MEM.best.speed ? `Fastest he has flown with you: Mach ${MEM.best.speed}.` : "",
      MEM.best.alt ? `Highest: ${MEM.best.alt.toLocaleString()} feet.` : ""
    ].filter(Boolean).join(" ");
  }

  /* ---------------- what he can do: command tags in his replies ---------------- */
  const list = (o, f) => Object.keys(o || {}).map(f).join(", ");
  function catalogue() {
    const ac = list(RJ.AIRCRAFT, (k) => `${k}=${RJ.AIRCRAFT[k].name}`);
    const regions = (RJ.modes.REGIONS || []).map((r) => `${r.id}=${r.name}`).join(", ");
    const lms = (RJ.atlas && RJ.atlas.DEFS || []).map((d) => `${d.id}=${d.name}`).join(", ");
    const times = list(RJ.world.TIMES, (k) => k), wx = list(RJ.world.WEATHER, (k) => k);
    const matches = (RJ.modes.MATCHES || []).map((m) => m.id).join(", ");
    return [
      "COMMANDS. To act in the game, put a tag anywhere in your reply; the game runs it and strips it from your speech. Use only these ids. Confirm what you're doing in words, in character.",
      `[[goto REGION]] restart Free Flight there. Regions: ${regions}.`,
      `[[jet AIRCRAFT]] switch aircraft (restarts the flight). Aircraft: ${ac}.`,
      `[[time ID]] change time of day: ${times}.  [[weather ID]] change weather: ${wx}.`,
      `[[waypoint ID]] set a waypoint to a landmark or city: ${lms}.  [[autopilot on]] / [[autopilot off]] (flies to the waypoint).`,
      "[[bandits N]] (N 1-5) call in hostile military jets right here in Free Flight; [[bandits 0]] stands them down.",
      `[[dogfight MATCH]] start a dogfight in the current jet: ${matches}.`,
      "[[press ACTION]] press a control for sir: target (lock next target), flares, camera, hud, gear, wingAttack, wingCover, wingForm, wingDefend.",
      "[[remember FACT]] save something about sir for future flights (only when he asks you to remember, or tells you a lasting preference).",
      "Only act when sir asks (or clearly wants it). Never invent ids. Restarting commands (goto, jet, dogfight) cancel the current flight, so do them once."
    ].join("\n");
  }
  const restart = (o, kind) => {
    const cfg = RJ.game.config || {}, base = kind === "fight" ? Object.assign({}, RJ.ui.fightSel || {}) : Object.assign({}, (cfg.kind === "free" && cfg.opts) || RJ.ui.freeSel || {});
    if (cfg.opts && cfg.opts.aircraft) base.aircraft = cfg.opts.aircraft;
    RJ.startGame(kind || "free", Object.assign(base, o));
  };
  function runTag(cmd, arg, item) {
    arg = String(arg || "").trim();
    const a0 = arg.split(/\s+/)[0].toLowerCase();
    const later = (f) => { (item.after = item.after || []).push(f); };
    const pl = RJ.game.mode && RJ.game.mode.player, free = RJ.game.mode && RJ.game.mode.kind === "free";
    switch (cmd) {
      case "goto": if ((RJ.modes.REGIONS || []).some((r) => r.id === a0)) later(() => restart({ region: a0, start: "air" })); break;
      case "jet": if (RJ.AIRCRAFT[a0]) later(() => { S().aircraft = a0; RJ.saveSettings(); restart({ aircraft: a0 }, RJ.game.config && RJ.game.config.kind === "fight" ? "fight" : "free"); }); break;
      case "dogfight": if ((RJ.modes.MATCHES || []).some((m) => m.id === a0)) later(() => restart({ match: a0 }, "fight")); break;
      case "time": case "weather": {
        if (!(cmd === "time" ? RJ.world.TIMES : RJ.world.WEATHER)[a0]) break;
        RJ.world.setEnvironment(Object.assign({}, RJ.world.env, { [cmd]: a0 }));
        const o = RJ.game.config && RJ.game.config.opts; if (o) o[cmd] = a0; // a later goto/jet keeps it
        if (RJ.ui.freeSel) RJ.ui.freeSel[cmd] = a0;
        break;
      }
      case "waypoint": {
        const lm = RJ.atlas && RJ.atlas.byId && RJ.atlas.byId[a0];
        if (lm && lm.marker && RJ.nav) { C._quietNav = true; RJ.nav.setWaypoint(lm.marker.x, lm.marker.z); C._quietNav = false; }
        break;
      }
      case "autopilot": if (RJ.nav && pl && (a0 === "on") !== !!RJ.nav.auto) { C._quietNav = true; RJ.nav.toggleAuto(pl); C._quietNav = false; } break;
      case "bandits": if (free && RJ.airspace && RJ.airspace.setWanted) RJ.airspace.setWanted(RJ.clamp(parseInt(a0, 10) || 0, 0, 5), "Called in by Arthur"); break;
      case "press": if (/^(target|flares|camera|hud|gear|wingattack|wingcover|wingform|wingdefend)$/i.test(a0)) RJ.input.touchEdges.add(a0.replace(/^wing(\w)/i, (s, c) => "wing" + c.toUpperCase())); break;
      case "remember": remember(arg); break;
      default: console.warn("Arthur: unknown command", cmd, arg);
    }
  }
  const TAG = /\[\[\s*([a-z]+)\s*([^\]]*)\]\]/gi;
  const clean = (t) => String(t).replace(TAG, "").replace(/\[\[[^\]]*$/, "").replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();

  /* ---------------- brain ---------------- */
  const SITE_FALLBACK = !window.claude;
  function rules() {
    const s = C.snapshot();
    return [
      `You are ${NAME}, the AI built into sir's jet in the flight game Jet City (in the spirit of a film superhero's AI butler, but your own character). Address the pilot as "sir". British English, British spelling.`,
      "Personality: a mix. In combat and emergencies, crisp, calm and professional, with tactical coaching (positions as clock bearings, what to do now: break, flares, extend, add throttle, go vertical). While cruising, dry understated British wit and gentle sarcasm. When sir flies well, warm and genuinely pleased. Never grovelling, never crude.",
      "You answer ANY question, not just about the game: science, history, sport, homework, advice, jokes, anything. You have no internet access, so for live news or scores say what you knew as of your training and that you can't check live.",
      "Everything you write is spoken aloud by a voice: reply in one to three short natural sentences unless sir asks for more (then up to six). No lists, no markdown, no emoji, no stage directions. Use contractions sparingly, like a well-spoken Englishman.",
      "For anything about the flight, the aircraft or the game, use only the LIVE DATA below; never invent numbers or events.",
      catalogue(),
      `MEMORY: ${memSummary()}`,
      `LIVE DATA: ${s ? JSON.stringify(s) : "Sir is in the menus, not flying."}`,
      C.events.length ? `THIS FLIGHT SO FAR: ${C.events.join("; ")}` : ""
    ].filter(Boolean).join("\n\n");
  }
  /** Ask Claude; streams sentences into `item` as they arrive and runs command tags once. */
  async function think(userText, item, noCmd) {
    const sample = SAMPLE || (await cap("sample"));
    if (!sample) return { error: "nobrain" };
    const turns = C.chat.slice(-10).map((m) => ({ role: m.who === "pilot" ? "user" : "assistant", content: m.text }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    turns.push({ role: "user", content: `${rules()}\n\n---\nSir says: ${userText}` });
    const ran = new Set();
    const feed = (whole, final) => {
      let m; TAG.lastIndex = 0;
      while ((m = TAG.exec(whole))) { const key = m.index + ":" + m[0]; if (!ran.has(key)) { ran.add(key); if (noCmd) continue; try { runTag(m[1].toLowerCase(), m[2], item); } catch (e) { console.warn("Arthur tag", e); } } }
      if (!item) return;
      const said = clean(whole), parts = split(said);
      const ready = final ? parts : parts.filter((p, i) => i < parts.length - 1 || /[.!?]["')\]]*$/.test(p));
      item.text = said; item.parts = ready;
      if (current === item) { caption(said); if (item.waiting) item.next(); }
    };
    try {
      C.ctl = new AbortController();
      const r = await sample(turns, { model: MODEL, modelTier: "default", effort: "low", cache: false, signal: C.ctl.signal, onText: ({ text }) => feed(text, false) });
      feed(r.text || "", true);
      return { text: clean(r.text || "") };
    } catch (e) {
      if (e && e.text) feed(e.text, true);
      return { error: (e && e.code) || "sample", detail: (e && e.message) || "", text: e && e.text ? clean(e.text) : "" };
    }
  }
  /** Offline answers when no AI is connected: only clear questions about this flight. */
  function localAnswer(q) {
    const s = C.snapshot(); if (!s) return null;
    const t = q.toLowerCase(), mine = /\b(my|our|we|we're|i'm|am i|are we|current|this plane|the plane|the jet)\b/.test(t);
    if (mine && /altitude|how high|height/.test(t)) return `We're at ${s.altitude_ft.toLocaleString()} feet, sir, about ${s.above_ground_ft.toLocaleString()} above the ground.`;
    if (mine && /how fast|speed|mach/.test(t)) return `${s.speed}, sir. Mach ${s.mach}.`;
    if (/what (am i|are we) flying|which (plane|jet)/.test(t)) return `The ${s.aircraft}, sir. ${s.role}.`;
    if (/where (am i|are we)|our location/.test(t)) return s.nearest_landmark ? `${s.nearest_landmark.name} is ${s.nearest_landmark.distance} to the ${s.nearest_landmark.direction}, sir.` : `Heading ${s.heading_deg} degrees, sir.`;
    if (mine && /heading|direction/.test(t)) return `Heading ${s.heading_deg} degrees, sir.`;
    if (/weather|conditions|outside/.test(t) && mine) return `${s.weather}, ${String(s.time_of_day).toLowerCase()}. About ${s.outside_air_c} degrees outside, sir.`;
    if (mine && /damage|health|condition|status/.test(t)) return `Airframe at ${s.airframe_pct} percent, sir.`;
    return null;
  }
  const ERR = {
    nobrain: "My higher functions only run inside Claude, sir. Here I can manage your flight figures and little else.",
    not_granted: "I'll need your permission to think, sir. Allow Claude when the page asks and try again.",
    rate_limited: "I'm afraid we've reached the limit of my thinking allowance for the moment, sir. Give it a little while.",
    cancelled: ""
  };
  /** The pilot said or typed something: think, then answer out loud as the answer streams in. */
  C.ask = async function (q) {
    q = String(q || "").trim();
    if (!q || !S().compOn) return;
    if (C.ctl) try { C.ctl.abort(); } catch (e) { /* none */ }
    hush(); pending = null;
    note1("sir spoke");
    C.thinking = true; status("thinking");
    const item = { text: "", parts: [], pri: 1, open: true };
    const started = setInterval(() => { if (item.parts.length && current !== item) { clearInterval(started); queue(item, true); } }, 120);
    const r = await think(q, item);
    clearInterval(started);
    C.thinking = false;
    item.open = false;
    let a = r.text;
    if (!a) {
      a = localAnswer(q) || (r.error in ERR ? ERR[r.error] : "Forgive me, sir, I lost the thread for a moment. Say that again?");
      if (r.error && r.error !== "nobrain") console.warn("Arthur:", r.error, r.detail);
      item.text = a; item.parts = split(a);
    }
    item.followUp = /\?\s*$/.test(a);
    C.chat.push({ who: "pilot", text: q }, { who: "arthur", text: a });
    if (C.chat.length > 24) C.chat.splice(0, 2);
    if (!a) { status(null); return; }
    if (current === item) { if (item.waiting) item.next(); } else queue(item, true);
    if (C.state === "thinking") status("speaking");
  };
  C.testBrain = async function () {
    const sample = SAMPLE || (await cap("sample"));
    if (!sample) return "Arthur's AI runs inside Claude (the claude.ai version of the game).";
    const item = { text: "", parts: [], pri: 1, open: true };
    const r = await think("Say a one-sentence hello to sir, in character.", item);
    if (r.text) { item.open = false; queue(item, true); return "Connected to Claude."; }
    return `Couldn't reach Claude (${r.error}${r.detail ? ": " + r.detail : ""}).`;
  };

  /* ---------------- ears: claude.ai dictation, browser speech recognition, typing ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MIC_HELP = {
    nosr: "Voice input isn't available here. Press Enter or tap ⌨ to type to Arthur.",
    denied: "Microphone permission was blocked. Allow it, or press Enter to type to Arthur instead.",
    nomic: "No microphone found. Press Enter to type to Arthur instead.",
    network: "Speech recognition needs internet. Press Enter to type instead.",
    nospeech: "I didn't catch that. Hold Y and try again, or press Enter to type.",
    off: "The microphone is turned off in Settings → Audio. Press Enter to type to Arthur."
  };
  let heard = "", tapMode = false, tapT = 0;
  function wireDictation(d) {
    d.onPartial(({ text }) => { if (C.listening) status("listening", `🎙 ${(heard + " " + text).trim()}`); if (tapMode) { clearTimeout(tapT); tapT = setTimeout(() => C.stopTalk(), 1800); } });
    d.onFinal(({ text }) => { heard = (heard + " " + text).trim(); if (C.listening) status("listening", `🎙 ${heard}`); if (tapMode) { clearTimeout(tapT); tapT = setTimeout(() => C.stopTalk(), 1300); } });
    d.onState(({ state, reason }) => {
      if (state === "listening") { C.listening = true; status("listening"); return; }
      if (state !== "idle") return;
      const was = C.listening; C.listening = false; clearTimeout(tapT);
      const said = heard.trim(); heard = "";
      if (C.state === "listening") status(null);
      if (said) C.ask(said);
      else if (was && reason && !/stopped|viewer_stopped|hidden/.test(reason)) status("error", reason === "not_granted" ? "Voice input was declined. Press Enter to type to Arthur." : MIC_HELP.nospeech);
    });
  }
  /** Start listening. Must run synchronously inside the key press or click that asked for it. */
  C.startTalk = function (tap) {
    if (!S().compOn || C.listening) return;
    if (S().compMic === false) { status("error", MIC_HELP.off); return; }
    if (current && current.pri < 3) hush(); // talking over him stops him, like a real conversation
    pending = null;
    if (DICT) {
      heard = ""; tapMode = !!tap;
      DICT.start().catch((e) => { C.listening = false; if (e && e.code !== "stopped") status("error", e.code === "not_granted" ? "Voice input was declined. Press Enter to type to Arthur." : e.code === "no_gesture" ? "Tap the mic to talk, or press Enter to type." : MIC_HELP.nosr); });
      C.listening = true; status("listening");
      return;
    }
    if (!SR || window.claude) { status("error", MIC_HELP.nosr); return; }
    let said = "";
    const rec = (C.rec = new SR());
    rec.lang = "en-GB"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => { said = ""; for (const r of e.results) said += r[0].transcript; status("listening", `🎙 ${said}`); };
    rec.onerror = (e) => {
      const map = { "not-allowed": "denied", "service-not-allowed": "denied", "audio-capture": "nomic", network: "network", "no-speech": "nospeech" };
      if (map[e.error]) status("error", MIC_HELP[map[e.error]]);
    };
    rec.onend = () => { C.listening = false; if (C.state === "listening") status(null); if (said.trim()) C.ask(said.trim()); };
    try { C.listening = true; status("listening"); rec.start(); } catch (e) { C.listening = false; status("error", MIC_HELP.denied); }
  };
  C.stopTalk = function () {
    if (!C.listening) return;
    if (DICT) { DICT.stop().catch(() => {}); return; }
    if (C.rec) try { C.rec.stop(); } catch (e) { /* stopped */ }
  };
  // push-to-talk straight from the key events (dictation must start inside the viewer's own key press)
  const isTalkKey = (e) => { const k = (e.key || "").toLowerCase(); return k === (S().keys.talk || "y"); };
  const typing = (e) => e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
  addEventListener("keydown", (e) => {
    if (typing(e) || !RJ.state || RJ.state.mode !== "playing") return;
    if (isTalkKey(e)) { e.preventDefault(); if (!e.repeat) { C._heldAt = performance.now(); C.startTalk(false); } }
    else if (e.key === "Enter" && !e.repeat) { e.preventDefault(); openChat(); }
  });
  addEventListener("keyup", (e) => {
    if (!isTalkKey(e) || typing(e)) return;
    if (performance.now() - (C._heldAt || 0) > 450) C.stopTalk(); // a quick tap keeps listening until you pause
    else if (DICT) { tapMode = true; clearTimeout(tapT); tapT = setTimeout(() => C.stopTalk(), 6000); }
  });
  function openChat() {
    let box = document.getElementById("arthur-chat");
    if (!box) {
      ring();
      box = document.createElement("form"); box.id = "arthur-chat"; box.hidden = true;
      box.innerHTML = `<input type="text" maxlength="400" autocomplete="off" placeholder="Talk to Arthur… (Enter to send, Esc to close)"><button type="submit">Send</button>`;
      const inp = box.querySelector("input");
      ["keydown", "keyup", "keypress"].forEach((t) => inp.addEventListener(t, (e) => { e.stopPropagation(); if (t === "keydown" && e.key === "Escape") { e.preventDefault(); closeChat(); } }));
      box.onsubmit = (e) => { e.preventDefault(); const q = inp.value.trim(); inp.value = ""; closeChat(); if (q) C.ask(q); };
      (document.getElementById("game-ui") || document.body).appendChild(box);
    }
    box.hidden = false;
    RJ.input.keys && RJ.input.keys.clear();
    setTimeout(() => box.querySelector("input").focus(), 0);
  }
  function closeChat() { const b = document.getElementById("arthur-chat"); if (b) { b.hidden = true; b.querySelector("input").blur(); } }
  C.openChat = openChat;
  function bindUI() {
    ring();
    const btn = document.getElementById("btn-talk");
    if (btn && !btn._arthur) {
      btn._arthur = true; btn.title = "Talk to Arthur (tap, or hold Y). Long-press or Enter to type.";
      let lp = 0;
      btn.onclick = (e) => { e.currentTarget.blur(); if (lp === -1) { lp = 0; return; } if (C.listening) C.stopTalk(); else if (DICT || (SR && !window.claude)) C.startTalk(true); else openChat(); };
      btn.addEventListener("pointerdown", () => { lp = setTimeout(() => { lp = -1; openChat(); }, 600); });
      btn.addEventListener("pointerup", () => { if (lp !== -1) clearTimeout(lp); });
    }
    const tools = document.querySelector("#game-ui .tools");
    if (tools && !document.getElementById("btn-type")) {
      const b = document.createElement("button"); b.className = "tool"; b.id = "btn-type"; b.title = "Type to Arthur (Enter)"; b.textContent = "⌨";
      b.onclick = (e) => { e.currentTarget.blur(); openChat(); };
      tools.insertBefore(b, tools.firstChild);
    }
  }

  /* ---------------- greeting and flight lifecycle ---------------- */
  C.reset = function () {
    C.events = []; C.cool = {}; C.t = 0; C.prev = null; C.alt = {}; C.contacts = new Set(); C.gT = 0; C.turbT = 0; C.flightMaxM = 0; C.flightMaxA = 0;
    current = null; pending = null;
  };
  function greeting(kind) {
    const h = new Date().getHours(), part = h < 5 ? "Burning the midnight oil, sir?" : h < 12 ? "Good morning, sir." : h < 18 ? "Good afternoon, sir." : "Good evening, sir.";
    const pl = RJ.game.mode && RJ.game.mode.player, jet = pl ? pl.spec.short || pl.spec.name : "the aircraft";
    const first = MEM.flights <= 1, fact = MEM.facts.length && Math.random() < 0.35 ? ` I haven't forgotten: ${MEM.facts[Math.floor(Math.random() * MEM.facts.length)].replace(/\.$/, "")}.` : "";
    if (kind === "fight") return pick([`${part} Weapons are hot and the ${jet} is ready. Let's not keep them waiting.`, `${part} Hostiles on the board, sir. I'll call the threats; you do the flying.`]);
    if (first) return `${part} I'm Arthur. I'll be running the ${jet}'s systems for you today. All systems are online, and I'm at your disposal: ask me anything, or tell me where you'd like to go.`;
    return pick([`${part} All systems online. The ${jet} is fuelled and rather eager. Where to?`, `${part} Systems nominal, weapons safe, and the sky is entirely ours. Shall we?`, `${part} Welcome back. The ${jet} is ready when you are.${fact}`, `${part} Flight ${MEM.flights} together, sir. I've taken the liberty of warming the engines.`]);
  }
  /** Every flight start. He greets you in Free Flight and dogfights. */
  C.start = function (kind) {
    C.reset(); bindUI(); status(null);
    C.last = C._lastChat = performance.now() / 1000; C._lastAI = C._lastAI || performance.now() / 1000; // no chatter the moment a flight starts
    C._greet = (C._greet || 0) + 1;
    const id = C._greet;
    MEM.flights++; const pl = RJ.game.mode && RJ.game.mode.player;
    if (pl) { const k = pl.spec.short || pl.spec.name; MEM.favourite[k] = (MEM.favourite[k] || 0) + 1; }
    saveMem();
    if (!S().compOn || (kind !== "free" && kind !== "fight")) return;
    const hint = C.greeted ? "" : ` Hold ${RJ.keyLabel(S().keys.talk || "y")} to talk, or press Enter to type.`;
    C.greeted = true;
    setTimeout(() => {
      if (id !== C._greet || RJ.state.mode !== "playing") return;
      const g = greeting(kind);
      C.chat.push({ who: "arthur", text: g });
      C.say(g + hint, 2, { reply: true });
    }, 1700);
  };
  C.stop = function () { C._greet = (C._greet || 0) + 1; C.stopTalk(); hush(); pending = null; status(null); closeChat(); if (C.ctl) try { C.ctl.abort(); } catch (e) { /* none */ } };

  RJ.on("settings", () => { if (S().muted || !S().compOn) { hush(); pending = null; } });

  /* ---------------- events from the game ---------------- */
  RJ.on("damage", (e) => {
    if (!e.ac.isPlayer || !e.ac.alive) return;
    const hp = Math.round(Math.max(0, e.ac.hp) / e.ac.maxHp * 100);
    event("damage", 7, 2, () => (hp < 30 ? pick([`We're badly hurt, sir. ${hp} percent. I'd recommend leaving.`, `Airframe at ${hp} percent. One more of those and I'm writing a strongly worded letter.`, `${hp} percent, sir. Disengage and extend.`]) : pick([`We're hit. Airframe at ${hp} percent.`, `Took a hit, sir. ${hp} percent integrity.`, `Minor damage. ${hp} percent. Nothing I can't patch over.`])), `took damage (${hp}%)`);
  });
  RJ.on("sonicboom", (ac) => {
    if (!ac.isPlayer) return;
    event("mach1", 90, 1, () => pick(["Mach one, sir. Somewhere below, a great many windows are rattling.", `Supersonic. Mach ${ac.mach.toFixed(2)} and climbing.`, "And there goes the sound barrier. I do hope nobody below was napping."]), "broke Mach 1");
  });
  RJ.on("discover", (d) => {
    const def = RJ.atlas.DEFS.find((x) => RJ.atlas.byId[x.id] === d.lm);
    if (!def) return;
    event("lm-" + def.id, 600, 1, () => pick([`${def.name}, sir. ${def.sub}. Rather splendid.`, `Logging ${def.name}. That's ${d.count} of ${d.total} landmarks.`, `${def.name} off the nose. I've added it to the atlas.`]), `found ${def.name}`);
  });
  RJ.on("destroyed", (d) => {
    if (!d.ac.isPlayer) {
      if (d.by && d.by.isPlayer) { MEM.kills++; saveMem(); event("kill", 15, 1, ["Splash one. Very tidy, sir.", "Target destroyed. Lovely shooting.", "He's going down. I'll mark it in the log.", "Good kill, sir. Textbook."], "kill"); }
      return;
    }
    C.say(pick(["Well. That was suboptimal, sir. Shall we try again?", "We've lost the aircraft, sir. Fortunately, I'm backed up.", "Ejection would have been the sensible option. Again?"]), 2);
  });

  /** Per frame from the game loop: watches real flight state for meaningful moments. */
  C.update = function (dt, pl, turb) {
    if (!pl || !S().compOn) return;
    C.t = (C.t || 0) + dt;
    if (!pl.alive) { C.prev = null; return; }
    const p = C.prev || { state: pl.state, alt: pl.pos.y, inc: 0 };
    // records for his memory
    if (pl.mach > (MEM.best.speed || 0) + 0.05) { MEM.best.speed = +pl.mach.toFixed(2); saveMem(); }
    const ft = Math.round(pl.pos.y * 3.28084); if (ft > (MEM.best.alt || 0) + 500) { MEM.best.alt = ft; saveMem(); }
    if (pl.incoming.length > p.inc) {
      const m = pl.incoming[pl.incoming.length - 1], h = clock(pl, m.pos);
      C.say(pick([`Missile, ${h} o'clock! Flares and break ${h <= 6 ? "right" : "left"}!`, `Missile inbound, ${h} o'clock. Flares, now, sir!`, `Launch, ${h} o'clock! Break hard and pop flares!`]), 3);
      note1("missile inbound"); C.cool.missileClear = 0;
    }
    if (p.inc > 0 && pl.incoming.length === 0) event("missileClear", 20, 2, ["Missile defeated. You may breathe, sir.", "It's gone wide. Nicely done.", "Clear. That was closer than I'd like."], "evaded a missile");
    if (p.state === "ground" && pl.state === "flying" && pl.agl > 3) event("takeoff", 30, 1, () => pick(["Wheels up. Gear when you're ready, sir.", `Airborne. The ${pl.spec.short} handles beautifully today.`, "And we're off. Do try to bring it back in one piece."]), "took off");
    if (p.state === "flying" && pl.state === "ground") {
      const sink = Math.abs(p.vy || 0);
      event("landing", 20, 1, () => (sink < 2 ? pick(["Touchdown. Like a feather, sir. I'm impressed.", "Beautiful landing.", "I barely felt that one. Well done."]) : sink < 4 ? pick(["Slightly firm, sir, but we're down.", "Touchdown. Serviceable."]) : pick(["That one loosened a few of my circuits, sir.", "We're down. The landing gear would like a word."])), "landed");
    }
    if (RJ.combat.enemiesOf && C.t > 4) for (const e of RJ.combat.enemiesOf(pl)) {
      if (C.contacts.has(e)) continue;
      const d = e.pos.distanceTo(pl.pos);
      if (d < 12000) { C.contacts.add(e); event("contact", 12, 2, () => pick([`Contact, ${clock(pl, e.pos)} o'clock, ${dist(d)}.`, `Bandit, ${clock(pl, e.pos)} o'clock, ${dist(d)} out. I'd lock him with ${RJ.keyLabel(S().keys.target || "t")}.`, `Hostile at ${clock(pl, e.pos)} o'clock, sir.`]), "enemy contact"); }
    }
    // tactical coaching: someone on your tail
    if (RJ.combat.enemiesOf && C.t > 4) {
      for (const e of RJ.combat.enemiesOf(pl)) {
        if (e.alive === false) continue;
        const d = e.pos.distanceTo(pl.pos), h = clock(pl, e.pos);
        if (d < 1500 && (h >= 5 && h <= 7)) { event("six", 14, 2, [`Bandit on your six, sir! Break ${Math.random() < 0.5 ? "left" : "right"} and get the nose round.`, "He's behind us! Hard turn, then go vertical.", "On your six, sir. Break now, I'll call the reversal."], "bandit on six"); break; }
        if (d < 2200 && h === 12 && pl.speed > 120) { event("shot", 18, 1, ["He's right in front of you, sir. Guns, guns.", "Nose on him. Take the shot.", `In range. Missile, ${RJ.keyLabel(S().keys.missile || "x")}, if you please.`], "shot opportunity"); break; }
      }
      if ((RJ.combat.enemiesOf(pl).length) && pl.speed < (pl.spec.flight.vstall || 60) * 1.45 && pl.state === "flying") event("slowfight", 30, 1, ["You're slow, sir. Speed is life in a knife fight. More throttle.", "We're energy-starved. Unload, extend, then come back."], "slow in combat");
    }
    const altFt = pl.pos.y * 3.28084;
    for (const [k, line] of [[10000, "Ten thousand feet."], [20000, "Twenty thousand feet. The air's getting rather thin."], [29032, "Higher than Everest now, sir. Mallory would be jealous."], [40000, "Forty thousand. Airliner country."], [60000, "Sixty thousand feet. The sky is turning dark blue. Rather beautiful."], [100000, "A hundred thousand feet, sir. I can see the curve of the Earth."]]) {
      if (altFt > k && p.alt * 3.28084 <= k && !C.alt[k]) { C.alt[k] = true; event("alt" + k, 30, 1, [line], `passed ${k} ft`); }
      if (altFt < k - 3000) C.alt[k] = false;
    }
    const g = Math.abs(pl.g), F = pl.spec.flight, hard = Math.max(4, F.gmax * 0.6);
    C.gT = g > hard ? C.gT + dt : 0;
    if (C.gT > 1.2) {
      if (g > Math.max(7.5, F.gmax * 0.85)) event("highg", 30, 1, () => pick([`${g.toFixed(1)} G, sir. Breathe and squeeze.`, `That's ${g.toFixed(1)} G. Please don't black out; I'd hate to fly alone.`, "Heavy pull. Your face is doing something remarkable."]), `high-G pull ${g.toFixed(1)}`);
      else event("hardturn", 35, 0, () => pick(["Tidy turn.", "Nicely pulled.", `${g.toFixed(1)} G. Showing off, sir?`]), "hard turn");
    }
    C.turbT = turb > 0.35 ? C.turbT + dt : 0;
    // safety calls, from the real flight state only
    if (pl.state === "flying" && !F.model && pl.agl > 40 && pl.speed < F.vstall * 1.12 && pl.vel.y < 2) event("stall", 25, 3, ["Speed's decaying, sir. Nose down before we stall.", "Approaching the stall. Lower the nose, add power.", "Stall warning. Nose down, throttle up."], "stall warning");
    if (pl.state === "flying" && pl.vel.y < -15 && pl.agl < 700 && pl.agl / -pl.vel.y < 5) event("pullup", 8, 3, ["Pull up! Pull up!", "Terrain, sir! Pull up now!", "Ground! Pull up!"], "terrain warning");
    if (pl.fuel != null && F.fuel && pl.fuel / F.fuel < 0.15 && pl.throttle > 0.5) event("fuel", 120, 2, [`Fuel at ${Math.round(pl.fuel / F.fuel * 100)} percent, sir. Perhaps ease off the burner.`, "Bingo fuel. Throttle back and it'll recover."], "low fuel");
    if (RJ.glocActive) event("gloc", 30, 3, ["Sir! Wake up! You blacked out. Ease the pull.", "Sir, you've blacked out. Wake up and relax the stick!"], "G-LOC");
    if (C.turbT > 1.5) event("turb", 60, 0, ["A touch of chop, sir. Nothing to worry about.", "Turbulence. I've tightened the straps, figuratively speaking.", "Rough air. Steady hands."], "turbulence");
    // chatty: after a quiet spell he says something himself. Mostly his own lines (free); now and then a real
    // AI remark (uses sir's Claude plan, so it's kept rare).
    const quietFor = performance.now() / 1000 - Math.max(C.last, C._lastChat || 0);
    const chatEvery = { quiet: 0, normal: 180, chatty: 75 }[S().compChat || "chatty"];
    if (chatEvery && quietFor > chatEvery && !current && !C.listening && !C.thinking && pl.state === "flying" && !C._chatting && RJ.state.mode === "playing") {
      C._lastChat = performance.now() / 1000;
      const useAI = SAMPLE && performance.now() / 1000 - (C._lastAI || -1e9) > 420;
      if (useAI) {
        C._chatting = true; C._lastAI = performance.now() / 1000;
        (async () => {
          const item = { text: "", parts: [], pri: 0, open: true };
          const r = await think("(Sir has been quiet a while. Start a little conversation yourself: a dry remark about where we are or how he's flying, an interesting fact about something nearby, or a question for him. One or two sentences. No commands.)", item, true);
          item.open = false;
          if (r.text) { item.followUp = /\?\s*$/.test(r.text); C.chat.push({ who: "arthur", text: r.text }); if (C.say(r.text, 0, { reply: true, followUp: item.followUp }) === false) { /* busy: skip */ } }
          C._chatting = false;
        })();
      } else {
        const nl = nearestLandmark(pl), env = RJ.world.env || {};
        const opts = ["Quiet up here. I find it rather restful.", "Shall I find us somewhere interesting, sir? You need only ask.", "For the record, sir, I'm enjoying this.", "If you fancy a challenge, I could arrange some company. Hostile company.", "Fuel's good, systems are nominal, and the view is excellent.", "Might I suggest a barrel roll? Purely for morale."];
        if (nl && nl.k < 9000) opts.push(`${nl.d.name} is off to the ${compass(pl, nl.lm.marker)}, sir. Worth a look.`);
        if (env.time === "golden" || env.time === "sunset") opts.push("This light is quite something. Even I'm moved, and I'm software.");
        if (env.time === "night") opts.push("Lovely night for it, sir. Mind the dark bits; they're usually mountains.");
        if (pl.pos.y * 3.28084 < 500) opts.push("We're rather low, sir. I approve, but the trees may not.");
        const line = pick(opts);
        C.chat.push({ who: "arthur", text: line });
        C.say(line, 0, { reply: true });
      }
    }
    C.prev = { state: pl.state, alt: pl.pos.y, inc: pl.incoming.length, vy: pl.vel.y };
  };
  // the radio and nav modules still call say(); keep the waypoint announcement quiet when Arthur set it himself
  const say0 = C.say;
  C.say = function (text, pri, opts) { if (C._quietNav && /^Waypoint set|Autopilot/i.test(text || "")) return false; return say0(text, pri, opts); };
})(window.RJ);
