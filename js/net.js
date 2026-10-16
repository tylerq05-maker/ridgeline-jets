/* Ridgeline Jets — network transport.
 * Wraps the claude.ai live "room" capability: named rooms (one per lobby code), each participant's
 * presence object (state + a rolling event log) and peer change notifications. Solo play never
 * touches this file's connection. For local testing only, window.RJ_MP_MOCK swaps in a
 * BroadcastChannel stand-in with the same calls, so several tabs on one machine can play together. */
(function (RJ) {
  "use strict";
  const N = (RJ.net = { room: null, avail: null, mock: false });

  /** Resolve the room capability once. Never throws; null-safe. */
  N.init = function () {
    if (N._init) return N._init;
    N._init = (async () => {
      if (window.RJ_MP_MOCK) { N.room = mockRoom(); N.mock = true; return (N.avail = true); }
      try {
        if (window.claude && typeof window.claude.use === "function") {
          const r = await window.claude.use("room");
          if (r) { N.room = r; return (N.avail = true); }
          N.reason = "room-refused"; // claude.ai declined to connect this view (signed out, public link, not invited)
        } else if (typeof window.Peer === "function") { N.room = peerRooms(); N.peerjs = true; return (N.avail = true); } // website build
        else N.reason = "not-on-claude"; // opened outside claude.ai (e.g. a saved file)
      } catch (e) { console.warn("room unavailable", e); N.reason = "error-" + ((e && (e.code || e.message)) || "unknown"); }
      return (N.avail = false);
    })();
    return N._init;
  };

  /* ---------------- direct connect (WebRTC, no claude.ai room needed) ----------------
   * The host's browser is a hub with one data channel per friend and relays everyone's presence, so
   * the result behaves like a room: presence / peers / onPeers / connected / onConnection / leave.
   * Signalling is manual: the friend sends a join code (WebRTC offer), the host answers with a reply
   * code. Both are compressed SDP; nothing goes through any server except public STUN lookups. */
  const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
  const b64 = (u8) => { let b = ""; for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const pipe = async (u8, T) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new T("deflate-raw"))).arrayBuffer());
  async function packDesc(desc) {
    // keep only the SDP lines a data channel needs, then deflate
    const keep = desc.sdp.split(/\r?\n/).filter((l) => l && !/^a=(extmap|rtcp-fb|ssrc|msid|rtpmap|fmtp)/.test(l)).join("\n");
    const raw = new TextEncoder().encode((desc.type === "offer" ? "o" : "a") + keep);
    return window.CompressionStream ? "RJZ" + b64(await pipe(raw, CompressionStream)) : "RJT" + b64(raw);
  }
  async function unpackDesc(code) {
    code = String(code || "").replace(/\s+/g, "");
    const kind = code.slice(0, 3);
    if (kind !== "RJZ" && kind !== "RJT") throw new Error("That isn't a Ridgeline Jets code. Copy the whole code and try again.");
    let u8;
    try { u8 = unb64(code.slice(3)); if (kind === "RJZ") u8 = await pipe(u8, DecompressionStream); } catch (e) { throw new Error("That code is incomplete or damaged. Copy the whole code and try again."); }
    const t = new TextDecoder().decode(u8);
    return { type: t[0] === "o" ? "offer" : "answer", sdp: t.slice(1).split("\n").join("\r\n") + "\r\n" };
  }
  const gathered = (pc, ms) => new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const t = setTimeout(res, ms);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
  });
  function newPC() {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser window doesn't allow direct connections.");
    return new RTCPeerConnection({ iceServers: ICE });
  }

  function linkRoom(isHub) {
    const me = "d" + Math.random().toString(36).slice(2, 12);
    let pres = {}, left = false, wasOpen = false;
    const peers = new Map(), links = new Set();
    let handlers = [], connH = [];
    let pending = { joined: [], left: [], updated: [] }, scheduled = false;
    const self = () => Object.freeze({ peer: me, by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, pres)), updatedAt: Date.now() });
    const snapshot = () => Object.freeze([self(), ...[...peers.values()].map((p) => p.peer)]);
    const flush = () => {
      scheduled = false;
      const ch = { peers: snapshot(), joined: pending.joined, left: pending.left, updated: pending.updated };
      pending = { joined: [], left: [], updated: [] };
      handlers.forEach((h) => { try { h(ch); } catch (e) { console.error(e); } });
    };
    const queue = (k, p) => { pending[k].push(p); if (!scheduled) { scheduled = true; setTimeout(flush, 0); } };
    const isOpen = () => [...links].some((L) => L.dc.readyState === "open");
    const fireConn = () => { const c = isHub ? !left : isOpen() && !left; connH.forEach((h) => { try { h(c); } catch (e) { console.error(e); } }); };
    const sendTo = (L, m) => { try { if (L.dc.readyState === "open") L.dc.send(m); } catch (e) { /* channel closing */ } };
    const broadcast = (m, except) => { for (const L of links) if (L !== except) sendTo(L, m); };
    const mine = () => JSON.stringify({ t: "p", peer: me, p: pres });
    const drop = (id) => { const p = peers.get(id); if (p) { peers.delete(id); queue("left", p.peer); } };
    function onMsg(L, raw) {
      if (typeof raw !== "string" || raw.length > 12000) return;
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.peer !== "string" || m.peer === me) return;
      if (isHub) {
        // each friend may only speak for itself; the hub forwards it to everyone else
        if (!L.id && m.t === "p") L.id = m.peer;
        if (m.peer !== L.id) return;
        broadcast(raw, L);
      }
      if (m.t === "bye") { drop(m.peer); return; }
      if (m.t !== "p" || !m.p || typeof m.p !== "object") return;
      const prev = peers.get(m.peer);
      const peer = Object.freeze({ peer: m.peer, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: Object.freeze(m.p), updatedAt: Date.now() });
      peers.set(m.peer, { peer, seen: Date.now() });
      queue(prev ? "updated" : "joined", peer);
    }
    function attach(pc, dc) {
      const L = { pc, dc, id: null, t0: Date.now() };
      links.add(L);
      dc.onmessage = (e) => onMsg(L, e.data);
      dc.onopen = () => { wasOpen = true; sendTo(L, mine()); fireConn(); };
      const close = () => {
        if (!links.has(L)) return;
        links.delete(L);
        if (isHub) { if (L.id) { drop(L.id); broadcast(JSON.stringify({ t: "bye", peer: L.id })); } }
        else { for (const id of [...peers.keys()]) drop(id); fireConn(); }
        try { pc.close(); } catch (e) { /* closed */ }
      };
      dc.onclose = close;
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") close(); };
      return L;
    }
    const beat = setInterval(() => {
      broadcast(mine());
      const now = Date.now();
      for (const [k, p] of peers) if (now - p.seen > 8000) drop(k);
      // forget hub links whose friend never pasted the reply code
      if (isHub) for (const L of links) if (L.dc.readyState !== "open" && now - L.t0 > 10 * 60000) { links.delete(L); try { L.pc.close(); } catch (e) { /* closed */ } }
    }, 400);
    const room = {
      name: "direct", direct: true, isHub,
      emit: () => Promise.resolve(), on: () => () => {},
      presence(patch) {
        for (const k in patch) { if (patch[k] === null) delete pres[k]; else pres[k] = patch[k]; }
        broadcast(mine()); return Promise.resolve();
      },
      peers: snapshot,
      onPeers(h) { handlers.push(h); return () => { handlers = handlers.filter((x) => x !== h); }; },
      connected: () => (isHub ? !left : isOpen() && !left),
      onConnection(h) { connH.push(h); setTimeout(() => { try { h(room.connected()); } catch (e) { console.error(e); } }, 0); return () => { connH = connH.filter((x) => x !== h); }; },
      everConnected: () => wasOpen,
      friends: () => [...links].filter((L) => L.dc.readyState === "open").length,
      leave() {
        if (left) return Promise.resolve();
        left = true; clearInterval(beat);
        const bye = JSON.stringify({ t: "bye", peer: me });
        broadcast(bye); broadcast(bye);
        setTimeout(() => { for (const L of links) { try { L.dc.close(); L.pc.close(); } catch (e) { /* closed */ } } links.clear(); }, 150);
        return Promise.resolve();
      },
      _attach: attach, _links: links
    };
    setTimeout(() => queue("joined", self()), 0);
    return room;
  }

  N.direct = {
    /** Host: an empty hub room; friends are added with addFriend(joinCode) → reply code. */
    hub() {
      const room = linkRoom(true);
      room.addFriend = async (joinCode) => {
        const offer = await unpackDesc(joinCode);
        if (offer.type !== "offer") throw new Error("That's a reply code. Paste your friend's JOIN code here.");
        if (room.friends() >= 3) throw new Error("The lobby is full (4 pilots max).");
        const pc = newPC();
        pc.ondatachannel = (e) => room._attach(pc, e.channel);
        await pc.setRemoteDescription(offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc, 4000);
        return packDesc(pc.localDescription);
      };
      return room;
    },
    /** Friend: makes a join code; connect(replyCode) resolves with the room once the link is open. */
    async guest() {
      const pc = newPC();
      const dc = pc.createDataChannel("rj", { ordered: false, maxRetransmits: 0 });
      const room = linkRoom(false);
      room._attach(pc, dc);
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc, 4000);
      const code = await packDesc(pc.localDescription);
      return {
        code, room,
        async connect(replyCode) {
          const ans = await unpackDesc(replyCode);
          if (ans.type !== "answer") throw new Error("That's your own join code. Paste the REPLY code the host sends back.");
          if (pc.signalingState !== "have-local-offer") throw new Error("This join code was already used. Press Cancel and make a new one.");
          await pc.setRemoteDescription(ans);
          await new Promise((res, rej) => {
            if (dc.readyState === "open") return res();
            const t = setTimeout(() => rej(new Error("Couldn't reach the host. One of your networks may block direct connections (school, work or public Wi-Fi often do). Try a home network or a phone hotspot.")), 20000);
            dc.addEventListener("open", () => { clearTimeout(t); res(); });
          });
          return room;
        },
        cancel() { room.leave(); try { pc.close(); } catch (e) { /* closed */ } }
      };
    }
  };

  /* ---------------- website build: short lobby codes over PeerJS ----------------
   * The host registers the lobby code with the free PeerJS matchmaking server; friends look it up and
   * open a WebRTC data channel straight to the host (PeerJS's relay servers step in when a network
   * blocks direct links). After that the host's browser is the same hub as direct connect. */
  const PJ_PREFIX = "ridgelinejets-v1-";
  function connAdapter(conn) {
    const a = {
      onmessage: null, onopen: null, onclose: null,
      get readyState() { return conn.open ? "open" : "connecting"; },
      send(m) { conn.send(m); },
      close() { try { conn.close(); } catch (e) { /* closed */ } }
    };
    conn.on("data", (d) => a.onmessage && a.onmessage({ data: d }));
    conn.on("open", () => a.onopen && a.onopen());
    conn.on("close", () => a.onclose && a.onclose());
    conn.on("error", () => a.onclose && a.onclose());
    return a;
  }
  const connPC = (conn) => ({ close() { try { conn.close(); } catch (e) { /* closed */ } } });
  const PEER_MSG = {
    "unavailable-id": "That lobby code is already in use.",
    "peer-unavailable": "No game found with that code. Check it, and that the host is still in the lobby.",
    network: "Couldn't reach the matchmaking server. Check your internet and try again.",
    "server-error": "The matchmaking server had a problem. Try again in a moment.",
    "socket-error": "Couldn't reach the matchmaking server. Check your internet and try again.",
    "browser-incompatible": "This browser can't play online. Try Chrome, Edge, Firefox or Safari."
  };
  function peerRooms() {
    return {
      peerjs: true,
      join(name, hosting) {
        return new Promise((resolve, reject) => {
          const id = PJ_PREFIX + String(name).toLowerCase().replace(/[^a-z0-9-]/g, "");
          const opts = Object.assign({ debug: 0 }, window.RJ_PEER_OPTS || {});
          let peer;
          try { peer = hosting ? new window.Peer(id, opts) : new window.Peer(opts); } catch (e) { reject(e); return; }
          let room = null, done = false;
          const fail = (code, msg) => {
            if (done) return; done = true; clearTimeout(timer);
            try { peer.destroy(); } catch (x) { /* gone */ }
            const err = new Error(msg); err.code = code; reject(err);
          };
          const timer = setTimeout(() => fail("timeout", hosting ? "The matchmaking server didn't answer. Check your internet and try again." : "Couldn't connect to the host. One of your networks may be blocking it — try again, or try a different Wi-Fi or a phone hotspot."), 20000);
          const finish = () => {
            if (done) return; done = true; clearTimeout(timer);
            const lv = room.leave;
            room.leave = () => { const r = lv(); setTimeout(() => { try { peer.destroy(); } catch (e) { /* gone */ } }, 300); return r; };
            room.peerjs = true;
            resolve(room);
          };
          peer.on("error", (e) => { if (!done) fail(e.type, PEER_MSG[e.type] || "Connection error (" + e.type + ")."); else console.warn("peer error", e.type); });
          // the matchmaking link can drop later without hurting games in progress; reconnect so new friends can still join
          peer.on("disconnected", () => { if (done && hosting && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* gone */ } }, 2000); });
          peer.on("open", () => {
            if (hosting) {
              room = linkRoom(true);
              peer.on("connection", (conn) => {
                if (room.friends() >= 3) { conn.on("open", () => setTimeout(() => conn.close(), 300)); return; }
                room._attach(connPC(conn), connAdapter(conn));
              });
              finish();
            } else {
              room = linkRoom(false);
              const conn = peer.connect(id, { serialization: "raw", reliable: false });
              const a = connAdapter(conn);
              room._attach(connPC(conn), a);
              const opened = a.onopen;
              a.onopen = () => { opened && opened(); finish(); };
            }
          });
        });
      }
    };
  }

  /* ---------------- local stand-in (tests only) ---------------- */
  function mockRoom() {
    const me = "p" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 35)); // long ids, like the real room
    function join(name) {
      const ch = new BroadcastChannel("rjmock:" + name);
      let pres = {}, peers = new Map(), handlers = [], connH = [], left = false;
      const self = () => ({ peer: me, by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, pres)), updatedAt: Date.now() });
      const snapshot = () => Object.freeze([self(), ...[...peers.values()].map((p) => p.peer)]);
      let pending = { joined: [], left: [], updated: [] }, scheduled = false;
      const flush = () => {
        scheduled = false;
        const ch2 = { peers: snapshot(), joined: pending.joined, left: pending.left, updated: pending.updated };
        pending = { joined: [], left: [], updated: [] };
        handlers.forEach((h) => { try { h(ch2); } catch (e) { console.error(e); } });
      };
      const queue = (k, p) => { pending[k].push(p); if (!scheduled) { scheduled = true; setTimeout(flush, 0); } };
      const send = () => { if (!left) ch.postMessage({ t: "p", peer: me, presence: pres }); };
      ch.onmessage = (e) => {
        const m = e.data;
        if (m.peer === me) return;
        if (m.t === "bye") { const p = peers.get(m.peer); if (p) { peers.delete(m.peer); queue("left", p.peer); } return; }
        if (m.t === "hello") { send(); return; }
        const prev = peers.get(m.peer);
        const peer = Object.freeze({ peer: m.peer, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: Object.freeze(m.presence || {}), updatedAt: Date.now() });
        peers.set(m.peer, { peer, seen: Date.now() });
        queue(prev ? "updated" : "joined", peer);
      };
      const beat = setInterval(() => {
        send();
        const now = Date.now();
        for (const [k, p] of peers) if (now - p.seen > 12000) { peers.delete(k); queue("left", p.peer); }
      }, 400);
      ch.postMessage({ t: "hello", peer: me });
      setTimeout(() => queue("joined", self()), 0);
      setTimeout(() => connH.forEach((h) => h(true)), 0);
      return Promise.resolve({
        name,
        emit: () => Promise.resolve(),
        on: () => () => {},
        presence(patch) {
          for (const k in patch) { if (patch[k] === null) delete pres[k]; else pres[k] = patch[k]; }
          send(); return Promise.resolve();
        },
        peers: snapshot,
        onPeers(h) { handlers.push(h); return () => { handlers = handlers.filter((x) => x !== h); }; },
        connected: () => !left,
        onConnection(h) { connH.push(h); return () => {}; },
        leave() { left = true; clearInterval(beat); ch.postMessage({ t: "bye", peer: me }); ch.close(); return Promise.resolve(); }
      });
    }
    return { join, peers: () => [], onPeers: () => () => {}, connected: () => true, onConnection: () => () => {}, presence: () => Promise.resolve() };
  }
})(window.RJ);
