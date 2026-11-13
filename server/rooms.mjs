// Saltline LAN multiplayer room logic — transport agnostic.
// Attach to any `ws` WebSocketServer: relay-only, authoritative for room
// membership, scores and win condition. Game simulation stays on clients.
import os from "os";

const KILL_TARGET = 15;
// A lobby is silent by design: clients only talk when something changes. The
// timeout must therefore be well above the heartbeat interval, otherwise
// everyone gets swept out of the room while waiting for the host to start.
const PLAYER_TIMEOUT = 45_000;
const HEARTBEAT_MS = 10_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const DEFAULT_SEED = 4207;

export function attachRoomServer(wss, opts = {}) {
  const killTarget = opts.killTarget || KILL_TARGET;
  const maxPlayers = opts.maxPlayers || MAX_PLAYERS;
  const minPlayers = opts.minPlayers || MIN_PLAYERS;
  // Relay log: every host/join attempt shows up here, which is the fastest way
  // to tell "the client never reached the server" from "the server said no".
  const log = opts.log === false ? () => {} : opts.log || (() => {});
  const rooms = new Map(); // code -> room
  let nextId = 1;

  function makeCode() {
    for (;;) {
      let c = "";
      for (let i = 0; i < 4; i++)
        c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  }

  const roomOf = (ws) => (ws.roomCode ? rooms.get(ws.roomCode) : null);

  function send(ws, msg) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {}
    }
  }

  function broadcast(room, msg, exceptWs = null) {
    const data = JSON.stringify(msg);
    for (const p of room.players.values())
      if (p.ws !== exceptWs && p.ws.readyState === 1) {
        try {
          p.ws.send(data);
        } catch {}
      }
  }

  function playerList(room) {
    return [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      host: p.isHost,
      kills: room.scores[p.id] || 0,
      deaths: room.deaths[p.id] || 0,
    }));
  }

  const namesMap = (room) => {
    const out = {};
    for (const p of room.players.values()) out[p.id] = p.name;
    return out;
  };

  function pushRoomState(room) {
    broadcast(room, {
      t: "room",
      players: playerList(room),
      phase: room.phase,
      seed: room.seed,
      max: maxPlayers,
      min: minPlayers,
      targetKills: room.targetKills,
    });
  }

  function checkWin(room) {
    for (const [id, kills] of Object.entries(room.scores))
      if (kills >= room.targetKills) {
        room.phase = "over";
        const winner = room.players.get(id);
        broadcast(room, {
          t: "over",
          winner: id,
          winnerName: winner ? winner.name : "?",
          scores: { ...room.scores },
          names: namesMap(room),
        });
        return true;
      }
    return false;
  }

  function joinRoom(ws, room, asHost) {
    ws.roomCode = room.code;
    ws.isHost = asHost;
    ws.seed = room.seed;
    room.players.set(ws.id, { id: ws.id, name: ws.name, ws, isHost: asHost });
    if (room.deaths[ws.id] == null) room.deaths[ws.id] = 0;
    if (room.scores[ws.id] == null) room.scores[ws.id] = 0;
    send(ws, {
      t: "joined",
      id: ws.id,
      room: room.code,
      host: asHost,
      seed: room.seed,
      max: maxPlayers,
      min: minPlayers,
      targetKills: room.targetKills,
    });
    pushRoomState(room);
  }

  // Treat absent seeds as the default so older clients still match a default room.
  function readSeed(raw) {
    const n = +raw;
    return Number.isFinite(n) ? Math.abs(Math.trunc(n)) : DEFAULT_SEED;
  }

  wss.on("connection", (ws, req) => {
    ws.id = String(nextId++);
    ws.roomCode = null;
    ws.name = "Breacher";
    ws.isHost = false;
    ws.lastSeen = Date.now();
    const ip = String((req && req.socket && req.socket.remoteAddress) || "?")
      .replace("::ffff:", "")
      .replace("::1", "localhost");
    log(`+ #${ws.id} connected from ${ip}`);

    // Browsers answer protocol-level pings automatically, even when the tab is
    // backgrounded and its JS timers are throttled — so this is what keeps a
    // quiet lobby alive.
    ws.on("pong", () => {
      ws.lastSeen = Date.now();
    });

    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      ws.lastSeen = Date.now();
      const room = roomOf(ws);

      switch (m.t) {
        case "ping":
          return send(ws, { t: "pong", n: m.n });

        case "host": {
          if (typeof m.name === "string" && m.name.trim())
            ws.name = m.name.trim().slice(0, 16);
          const code = makeCode();
          const r = {
            code,
            phase: "lobby",
            targetKills: killTarget,
            seed: readSeed(m.seed),
            players: new Map(),
            scores: {},
            deaths: {},
          };
          rooms.set(code, r);
          log(`  host #${ws.id} "${ws.name}" -> room ${code} (seed ${r.seed})`);
          return joinRoom(ws, r, true);
        }

        case "join": {
          if (typeof m.name === "string" && m.name.trim())
            ws.name = m.name.trim().slice(0, 16);
          const r = rooms.get(String(m.code || "").toUpperCase());
          if (!r) {
            log(`  join #${ws.id} "${ws.name}" code=${m.code} -> not found`);
            return send(ws, { t: "error", msg: "Room not found" });
          }
          if (r.phase !== "lobby" && r.phase !== "over") {
            log(`  join #${ws.id} "${ws.name}" ${r.code} -> match in progress`);
            return send(ws, { t: "error", msg: "Match in progress" });
          }
          const already = r.players.has(ws.id);
          if (!already && r.players.size >= maxPlayers) {
            log(`  join #${ws.id} "${ws.name}" ${r.code} -> full`);
            return send(ws, {
              t: "error",
              msg: `Room is full (${maxPlayers} players max)`,
            });
          }
          const seed = readSeed(m.seed);
          if (seed !== r.seed) {
            log(
              `  join #${ws.id} "${ws.name}" ${r.code} -> seed mismatch (client ${seed}, room ${r.seed})`,
            );
            return send(ws, {
              t: "error",
              code: "seed",
              seed: r.seed,
              msg: `Map mismatch \u2014 rejoin with seed ${r.seed}`,
            });
          }
          log(
            `  join #${ws.id} "${ws.name}" ${r.code} -> ok (${r.players.size + (already ? 0 : 1)}/${maxPlayers})`,
          );
          return joinRoom(ws, r, !!(already && ws.isHost));
        }

        case "start": {
          if (!room || !ws.isHost || room.phase !== "lobby") return;
          if (room.players.size < minPlayers)
            return send(ws, {
              t: "error",
              msg: `Need at least ${minPlayers} players to start`,
            });
          room.phase = "match";
          room.scores = {};
          room.deaths = {};
          for (const p of room.players.values()) {
            room.scores[p.id] = 0;
            room.deaths[p.id] = 0;
          }
          log(`  start ${room.code} with ${room.players.size} players`);
          return broadcast(room, {
            t: "begin",
            order: [...room.players.keys()],
            names: namesMap(room),
            targetKills: room.targetKills,
            seed: room.seed,
            max: maxPlayers,
            min: minPlayers,
          });
        }

        case "state":
          if (!room) return;
          ws.state = m.s;
          return broadcast(room, { t: "s", i: ws.id, s: m.s }, ws);

        case "shot":
          if (!room) return;
          return broadcast(room, { t: "shot", i: ws.id, o: m.o, e: m.e }, ws);

        case "hit": {
          if (!room) return;
          const target = room.players.get(String(m.target));
          if (!target) return;
          return send(target.ws, {
            t: "dmg",
            from: ws.id,
            fromName: ws.name,
            dmg: Math.max(1, Math.min(120, +m.dmg || 28)),
            head: !!m.head,
          });
        }

        case "kill": {
          if (!room || room.phase !== "match") return;
          const killerId = String(m.killer || "");
          const killer = room.players.get(killerId);
          if (!killer || killerId === ws.id) return;
          room.scores[killerId] = (room.scores[killerId] || 0) + 1;
          room.deaths[ws.id] = (room.deaths[ws.id] || 0) + 1;
          broadcast(room, {
            t: "score",
            scores: { ...room.scores },
            deaths: { ...room.deaths },
            names: namesMap(room),
            feed: { k: killer.name, v: ws.name, head: !!m.head },
          });
          return checkWin(room);
        }

        case "back": {
          if (!room || !ws.isHost) return;
          room.phase = "lobby";
          room.scores = {};
          room.deaths = {};
          broadcast(room, { t: "lobby" });
          return pushRoomState(room);
        }
      }
    });

    ws.on("close", () => {
      const room = roomOf(ws);
      log(
        `- #${ws.id} "${ws.name}" disconnected${room ? ` from ${room.code}` : ""}`,
      );
      if (!room) return;
      room.players.delete(ws.id);
      delete room.scores[ws.id];
      delete room.deaths[ws.id];
      if (!room.players.size) {
        rooms.delete(room.code);
        return;
      }
      if (ws.isHost) {
        const next = room.players.values().next().value;
        if (next) {
          next.isHost = true;
          send(next.ws, { t: "host-promoted" });
          if (room.phase === "match") {
            room.phase = "lobby";
            broadcast(room, { t: "lobby" });
          }
        }
      }
      pushRoomState(room);
    });
  });

  // keep idle lobby connections alive with protocol pings
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const p of room.players.values())
        try {
          p.ws.ping();
        } catch {}
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  // prune idle players
  const prune = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      let changed = false;
      for (const [id, p] of room.players)
        if (now - p.ws.lastSeen > PLAYER_TIMEOUT) {
          log(
            `  timeout #${id} "${p.name}" in ${code} (idle ${Math.round((now - p.ws.lastSeen) / 1000)}s)`,
          );
          room.players.delete(id);
          delete room.scores[id];
          delete room.deaths[id];
          try {
            p.ws.terminate();
          } catch {}
          changed = true;
        }
      if (!room.players.size) rooms.delete(code);
      else if (changed) pushRoomState(room);
    }
  }, 5000);
  prune.unref?.();

  return { rooms, killTarget };
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
  return out;
}
