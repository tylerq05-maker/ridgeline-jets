# Ridgeline Jets

Open-world jet flight in the browser: a real-scale Mount Everest (8,848.86 m), 22 landmarks to discover,
dogfights, missions, challenges, replays and photo mode, plus online multiplayer for up to 4 pilots.

**Play:** open the site and pick a mode. Nothing to install.

## Playing with friends

1. Click **MULTIPLAYER → HOST GAME**. You get a lobby code like `BLADE-57`.
2. Click **Copy invite link** and send it to your friends (or just tell them the code).
3. Friends open the link (or click MULTIPLAYER, type the code and press **Join**).
4. When everyone is in, the host picks the mode and presses **START**.

No accounts are needed. The host's browser runs the lobby, so the match ends if the host leaves.
Matchmaking uses the free public [PeerJS](https://peerjs.com) server; games then connect browser to
browser. Some school, work or public Wi-Fi networks block this; a home network or phone hotspot usually works.
If codes won't connect, **Direct connect** on the multiplayer screen is a backup that swaps codes by hand.

Built with three.js (r128). PeerJS is MIT-licensed (see `vendor/PEERJS-LICENSE.txt`).
