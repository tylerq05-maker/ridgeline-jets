/* Ridgeline Jets — core: namespace, math helpers, storage, settings, progression, input. */
window.RJ = window.RJ || {};
(function (RJ) {
  "use strict";

  /* ---------------- Math helpers ---------------- */
  RJ.V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  RJ.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  RJ.lerp = (a, b, t) => a + (b - a) * t;
  RJ.smooth = (e0, e1, x) => { const t = RJ.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  RJ.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  RJ.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  RJ.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  RJ.DEG = Math.PI / 180;
  RJ.G0 = 9.81;
  /** Air density ratio (exponential atmosphere, 9 km scale height). */
  RJ.rho = (alt) => Math.exp(-Math.max(0, alt) / 9000);
  /** Air temperature (K): ISA lapse rate to the tropopause, shifted by the world's weather/time offset. */
  RJ.airTemp = (alt) => { const h = Math.max(0, alt); return (h < 11000 ? 288.15 - 0.0065 * h : 216.65) + (RJ.tempOffset || 0); };
  /** Speed of sound (m/s) from local temperature: a = sqrt(γ·R·T). 340 m/s at sea level, 295 at 11 km. */
  RJ.soundSpeed = (alt) => Math.sqrt(401.874 * RJ.airTemp(alt));
  RJ.fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };
  RJ.fmtInt = (n) => Math.round(n).toLocaleString("en-US");

  /* ---------------- Events ---------------- */
  const listeners = {};
  RJ.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  RJ.emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  /* ---------------- Storage ---------------- */
  RJ.store = {
    get(k, d) { try { const v = localStorage.getItem("rj3-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("rj3-" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  /* ---------------- Settings ---------------- */
  RJ.DEFAULT_KEYS = {
    pitchUp: "w", pitchDown: "s", rollLeft: "a", rollRight: "d", yawLeft: "q", yawRight: "e",
    throttleUp: "r", throttleDown: "f", afterburner: "shift", airbrake: "b",
    guns: "space", missile: "x", flares: "c", target: "t", camera: "v", hud: "u", pause: "p", mute: "n", map: "m", hyper: "h", autopilot: "l", gear: "g", retry: "backspace", replay: "k", photo: "o", ghost: "j", wingAttack: "1", wingCover: "2", wingForm: "3", wingDefend: "4", talk: "y"
  };
  RJ.KEY_ALTS = { pitchUp: "arrowup", pitchDown: "arrowdown", rollLeft: "arrowleft", rollRight: "arrowright", pause: "escape", throttleUp: "pageup", throttleDown: "pagedown" };
  RJ.ACTION_NAMES = {
    pitchUp: "Pitch up (climb)", pitchDown: "Pitch down (dive)", rollLeft: "Roll left", rollRight: "Roll right",
    yawLeft: "Rudder left", yawRight: "Rudder right", throttleUp: "Throttle up", throttleDown: "Throttle down",
    afterburner: "Afterburner (hold)", airbrake: "Air brake (hold)", guns: "Guns / bombs", missile: "Fire missile",
    flares: "Flares", target: "Next target", camera: "Change camera", hud: "Toggle HUD", pause: "Pause", mute: "Mute sound", gear: "Landing gear", retry: "Instant retry (challenges)", replay: "Replay last 60 s", photo: "Photo mode", ghost: "Show/hide ghost", wingAttack: "Wingmen: attack my target", wingCover: "Wingmen: cover me", wingForm: "Wingmen: form up", wingDefend: "Wingmen: defend objective", talk: "Talk to Nova (hold)", map: "Map and waypoints", hyper: "HYPERSONIC (Star Wars craft)", autopilot: "Autopilot to waypoint"
  };
  const DEFAULTS = {
    quality: "high", shadows: true, viewDist: 1, clouds: 1,
    bloom: true, motionBlur: true, heatHaze: true, dof: true, fxaa: true, waterReflect: true, cloudShadows: true, volClouds: true, exposure: 1,
    master: 0.8, engineVol: 0.8, envVol: 0.7, sfxVol: 0.85, voiceVol: 0.9, voiceName: "", voiceRate: 0.95, voicePitch: 0.96, compOn: true, compChat: "normal", compVol: 0.9, compVoice: "", compMic: true, compFollow: true, novaServer: "", muted: false,
    invert: false, sens: 1, touchSens: 1, assist: true,
    cam: "chase", fov: 68, shake: true, boomCam: "inset",
    hud: true, hudColor: "green", units: "mph", ghosts: true, fpsLimit: "0", showFps: false, dynRes: true,
    unlockAll: true,
    aircraft: "f22", keys: { ...RJ.DEFAULT_KEYS }
  };
  RJ.settings = Object.assign({}, DEFAULTS, RJ.store.get("settings", {}));
  RJ.settings.keys = Object.assign({}, RJ.DEFAULT_KEYS, RJ.settings.keys || {});
  // v2 keys: H is now HYPERSONIC and M the map, so the HUD and mute toggles moved to U and N
  if (!RJ.settings.keysV2) { const K = RJ.settings.keys; if (K.hud === "h") K.hud = "u"; if (K.mute === "m") K.mute = "n"; RJ.settings.keysV2 = true; }
  RJ.settings.unlockAll = true; // every aircraft is available
  if (!["low", "medium", "high", "ultra"].includes(RJ.settings.quality)) RJ.settings.quality = "high";
  /** Speed in the player's chosen unit. */
  RJ.speedUnit = () => ({ mph: ["MPH", 2.23694], kt: ["KT", 1.94384], kmh: ["KM/H", 3.6] }[RJ.settings.units] || ["MPH", 2.23694]);
  RJ.saveSettings = () => { RJ.store.set("settings", RJ.settings); RJ.emit("settings"); };
  RJ.resetKeys = () => { RJ.settings.keys = { ...RJ.DEFAULT_KEYS }; RJ.saveSettings(); };
  RJ.keyLabel = (k) => ({ space: "Space", shift: "Shift", escape: "Esc", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", pageup: "PgUp", pagedown: "PgDn", backspace: "Backspace", control: "Ctrl", alt: "Alt", enter: "Enter", tab: "Tab" }[k] || (k.length === 1 ? k.toUpperCase() : k));

  /* ---------------- Progression ---------------- */
  RJ.RANKS = [
    [0, "Airman"], [500, "Second Lieutenant"], [1500, "First Lieutenant"], [3000, "Captain"], [5500, "Major"],
    [9000, "Lieutenant Colonel"], [14000, "Colonel"], [20000, "Brigadier General"]
  ];
  RJ.CHALLENGES = [
    { id: "mach1", name: "Break the sound barrier", xp: 150 },
    { id: "canyon", name: "Finish the Canyon Run course", xp: 300, unlock: "f117" },
    { id: "lowlevel", name: "Fly below 60 m for 30 seconds in one flight", xp: 300 },
    { id: "alt18k", name: "Climb above 18,000 m (59,000 ft)", xp: 300, unlock: "x15" },
    { id: "mach3", name: "Reach Mach 3", xp: 400, unlock: "sr71" },
    { id: "bombsonic", name: "Go supersonic in a bomber", xp: 300, unlock: "xb70" },
    { id: "mach5", name: "Reach Mach 5", xp: 600, unlock: "hyperion" },
    { id: "duelvet", name: "Win a 1v1 duel on Veteran or Ace", xp: 400, unlock: "yf12" },
    { id: "survive5", name: "Reach wave 5 in Survival", xp: 500 },
    { id: "teamace", name: "Win a 4v4 team battle on Ace", xp: 800 }
  ];
  const P0 = { xp: 0, done: {}, records: { mach: 0, alt: 0 }, stats: { flights: 0, matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0, bestWave: 0, bestCourse: {} }, medals: {}, atlas: {} };
  RJ.progress = Object.assign(JSON.parse(JSON.stringify(P0)), RJ.store.get("progress", {}));
  const saveProgress = () => RJ.store.set("progress", RJ.progress);
  RJ.saveProgress = saveProgress;
  RJ.resetProgress = () => { RJ.progress = JSON.parse(JSON.stringify(P0)); saveProgress(); RJ.emit("progress"); };
  RJ.rankOf = (xp) => {
    let i = 0;
    while (i + 1 < RJ.RANKS.length && xp >= RJ.RANKS[i + 1][0]) i++;
    const cur = RJ.RANKS[i], next = RJ.RANKS[i + 1];
    return { name: cur[1], index: i, floor: cur[0], next: next ? next[0] : null, nextName: next ? next[1] : null };
  };
  RJ.isUnlocked = (id) => {
    if (RJ.settings.unlockAll) return true;
    const ac = RJ.AIRCRAFT && RJ.AIRCRAFT[id];
    if (!ac) return false;
    const u = ac.unlock || { start: true };
    if (u.start) return true;
    if (u.xp != null) return RJ.progress.xp >= u.xp;
    if (u.challenge) return !!RJ.progress.done[u.challenge];
    return false;
  };
  /** Award XP; returns list of aircraft ids that became unlocked. */
  RJ.addXP = (n) => {
    const before = RJ.AIRCRAFT_ORDER.filter(RJ.isUnlocked);
    RJ.progress.xp += Math.max(0, Math.round(n));
    saveProgress();
    const after = RJ.AIRCRAFT_ORDER.filter(RJ.isUnlocked);
    const fresh = after.filter((id) => !before.includes(id));
    RJ.emit("progress");
    return fresh;
  };
  /** Complete a challenge once; returns {xp, unlocked:[ids]} or null if already done. */
  RJ.completeChallenge = (id) => {
    if (RJ.progress.done[id]) return null;
    const c = RJ.CHALLENGES.find((x) => x.id === id);
    if (!c) return null;
    const before = RJ.AIRCRAFT_ORDER.filter(RJ.isUnlocked);
    RJ.progress.done[id] = true;
    RJ.progress.xp += c.xp;
    saveProgress();
    const after = RJ.AIRCRAFT_ORDER.filter(RJ.isUnlocked);
    RJ.emit("progress");
    RJ.emit("challenge", { challenge: c, unlocked: after.filter((x) => !before.includes(x)) });
    return { xp: c.xp, unlocked: after.filter((x) => !before.includes(x)) };
  };

  /* ---------------- Input ---------------- */
  const input = {
    keys: new Set(), edges: new Set(), capture: null,
    touch: { x: 0, y: 0, throttle: null, ab: false, gun: false, brake: false },
    gp: null, gpPrev: [],
    active: "keyboard"
  };
  RJ.input = input;
  const norm = (e) => (e.key === " " ? "space" : (e.key || "").toLowerCase());
  const keyFor = (action) => [RJ.settings.keys[action], RJ.KEY_ALTS[action]].filter(Boolean);

  addEventListener("keydown", (e) => {
    const k = norm(e);
    if (input.capture) { e.preventDefault(); const fn = input.capture; input.capture = null; fn(k); return; }
    if (RJ.state && RJ.state.mode === "playing" && (k.startsWith("arrow") || k === "space" || k === "pageup" || k === "pagedown" || k === "backspace")) e.preventDefault();
    if (!e.repeat) input.edges.add(k);
    input.keys.add(k);
    input.active = "keyboard";
  });
  addEventListener("keyup", (e) => { input.keys.delete(norm(e)); if (e.key === "Shift") input.keys.delete("shift"); });
  addEventListener("blur", () => input.keys.clear());

  input.held = (action) => keyFor(action).some((k) => input.keys.has(k));
  input.pressed = (action) => keyFor(action).some((k) => input.edges.has(k));
  input.anyEdge = (k) => input.edges.has(k);
  input.endFrame = () => { input.edges.clear(); };

  /** Poll gamepad; fills input.gp with axes and edge-pressed buttons. */
  input.pollGamepad = () => {
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; }
    catch (e) { input.pollGamepad = () => { input.gp = null; }; input.gp = null; return; } // blocked by the frame's permissions policy
    let pad = null;
    for (const p of pads || []) if (p && p.connected) { pad = p; break; }
    if (!pad) { input.gp = null; return; }
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
    const now = pad.buttons.map((x) => x.pressed);
    const edge = (i) => now[i] && !input.gpPrev[i];
    input.gp = {
      roll: dz(pad.axes[0] || 0), pitch: dz(pad.axes[1] || 0), yaw: dz(pad.axes[2] || 0),
      thrUp: b(7), thrDown: b(6),
      guns: b(0) > 0.5, ab: b(5) > 0.5, brake: b(4) > 0.5,
      missile: edge(1), flares: edge(2), target: edge(3), camera: edge(8), pause: edge(9)
    };
    if (now.some(Boolean) || Math.abs(pad.axes[0] || 0) > 0.3) input.active = "gamepad";
    input.gpPrev = now;
  };

  /** Flight control axes for the player this frame. */
  input.axes = () => {
    const s = RJ.settings, gp = input.gp, t = input.touch;
    let pitch = (input.held("pitchUp") ? 1 : 0) - (input.held("pitchDown") ? 1 : 0);
    let roll = (input.held("rollRight") ? 1 : 0) - (input.held("rollLeft") ? 1 : 0);
    let yaw = (input.held("yawRight") ? 1 : 0) - (input.held("yawLeft") ? 1 : 0);
    let thr = (input.held("throttleUp") ? 1 : 0) - (input.held("throttleDown") ? 1 : 0);
    let ab = input.held("afterburner"), brake = input.held("airbrake"), guns = input.held("guns");
    if (gp) {
      pitch += gp.pitch; roll += gp.roll; yaw += gp.yaw; thr += gp.thrUp - gp.thrDown;
      ab = ab || gp.ab; brake = brake || gp.brake; guns = guns || gp.guns;
    }
    // touch stick: a gentle expo curve gives fine control near the centre; overall gain is user-set
    const tc = (v) => (v * 0.55 + v * v * v * 0.45) * (s.touchSens || 1);
    pitch += -tc(t.y); roll += tc(t.x);
    ab = ab || t.ab; guns = guns || t.gun; brake = brake || t.brake;
    if (s.invert) pitch = -pitch;
    const sens = s.sens;
    return {
      pitch: RJ.clamp(pitch * sens, -1, 1), roll: RJ.clamp(roll * sens, -1, 1), yaw: RJ.clamp(yaw, -1, 1),
      thr, thrAbs: t.throttle, ab, brake, guns
    };
  };
  input.action = (name) => {
    if (input.pressed(name)) return true;
    const gp = input.gp;
    if (gp && gp[name]) return true;
    if (input.touchEdges && input.touchEdges.has(name)) { input.touchEdges.delete(name); return true; }
    return false;
  };
  input.touchEdges = new Set();

  RJ.isTouch = matchMedia("(pointer: coarse)").matches;
})(window.RJ);
