// LAN multiplayer orchestrator: lobby UI, match lifecycle, state sync,
// shooter-side hit detection, victim-authoritative damage, deathmatch scoring.
import { Vector3 } from "../vendor/three-r180.js";
import { clamp } from "../core/math.js";
import { createNet, wsUrl } from "./net.js";
import { createAvatars } from "./avatars.js";

const KILL_TARGET = 15;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const STATE_HZ = 20;
const RESPAWN_SECONDS = 3;
const SPAWN_INVULN = 2;
const INTERP_DELAY = 0.12;
const DEFAULT_SEED = 4207;
const REJOIN_KEY = "saltline.mp.rejoin";

const MP_STYLE = `
.menu[data-screen="mp"] [data-s="mp"],
.menu[data-screen="mp-result"] [data-s="mp-result"] { display: block; }
.m-card[data-s="mp"], .m-card[data-s="mp-result"] { width: min(480px, calc(100vw - var(--gl) - var(--gr))); }
.mp-wrap { width: 100%; max-width: 520px; box-sizing: border-box; }
.mp-row { display: flex; gap: 10px; margin: 10px 0; align-items: center; min-width: 0; }
.mp-row label { flex: 0 0 110px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
.mp-row input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box; background: rgba(10,14,18,.8); border: 1px solid rgba(255,255,255,.22); color: #e8eef2; padding: 10px 12px; font: inherit; letter-spacing: .06em; }
.mp-row input.code { text-transform: uppercase; letter-spacing: .35em; font-weight: 700; }
.mp-status { min-height: 1.4em; font-size: 13px; opacity: .7; margin: 4px 0 10px; }
.mp-status.err { color: #ff9d7a; opacity: 1; }
.mp-code-big { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border: 1px solid rgba(255,255,255,.14); padding: 10px 12px; margin: 6px 0 8px; box-sizing: border-box; }
.mp-code-big span { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; opacity: .6; }
.mp-code-big b { font-size: 26px; letter-spacing: .28em; color: #ffc46b; font-weight: 700; }
.mp-roommeta { font-size: 12px; letter-spacing: .06em; opacity: .65; margin: 0 0 10px; }
.mp-players { border: 1px solid rgba(255,255,255,.14); margin: 8px 0 14px; max-height: 180px; overflow: auto; }
.mp-players .mp-p { display: flex; justify-content: space-between; gap: 10px; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,.07); font-size: 14px; }
.mp-players .mp-p:last-child { border-bottom: none; }
.mp-players .mp-p b.host { color: #ffc46b; }
.mp-players .mp-p .kd { opacity: .6; font-size: 12px; white-space: nowrap; }
.mp-wrap .btn:disabled { opacity: .38; cursor: default; pointer-events: none; }
.mp-note { font-size: 13px; line-height: 1.5; opacity: .62; margin-top: 12px; }
.mp-board { position: absolute; top: calc(74px + var(--sab, 0px)); right: 18px; min-width: 230px; background: rgba(8,12,16,.62); border: 1px solid rgba(255,255,255,.12); padding: 8px 0; display: none; z-index: 5; pointer-events: none; backdrop-filter: blur(2px); }
.mp-board.on { display: block; }
.mp-board h4 { margin: 0 12px 6px; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; opacity: .6; font-weight: 600; }
.mp-board .mp-b-head { display: flex; gap: 10px; padding: 0 12px 4px; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; opacity: .45; }
.mp-board .mp-b-row { display: flex; gap: 10px; padding: 3px 12px; font-size: 13px; }
.mp-board .mp-b-row.me { background: rgba(255,255,255,.08); }
.mp-board .mp-b-row .n, .mp-board .mp-b-head .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-board .mp-b-row .k, .mp-board .mp-b-head .k { width: 30px; text-align: right; font-weight: 700; color: #ffc46b; }
.mp-board .mp-b-row .d, .mp-board .mp-b-head .d { width: 30px; text-align: right; opacity: .55; }
.mp-feed { position: absolute; top: calc(74px + var(--sab, 0px)); left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 4px; align-items: center; z-index: 5; pointer-events: none; }
.mp-feed .mp-f { background: rgba(8,12,16,.66); border: 1px solid rgba(255,255,255,.12); padding: 4px 12px; font-size: 13px; animation: mpFeed 4s forwards; }
.mp-feed .mp-f b { color: #ffc46b; }
.mp-feed .mp-f .v { opacity: .75; }
@keyframes mpFeed { 0% { opacity: 0; transform: translateY(-6px);} 8% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0; } }
body.mp-on .hud .h-relays { display: none !important; }
`;

function createMultiplayer(context) {
  const menus = context.game && context.game.menus;
  if (!menus) return null;

  const flow = context.game;
  const events = context.events;
  const V = (x, y, z) => new Vector3(x, y, z);

  // ---------- style + screens ----------
  const style = document.createElement("style");
  style.textContent = MP_STYLE;
  document.head.appendChild(style);

  const root = menus.root;
  const sec = document.createElement("section");
  sec.className = "m-screen m-card";
  sec.dataset.s = "mp";
  sec.setAttribute("aria-label", "Multiplayer");
  sec.innerHTML = `
    <div class="mp-wrap">
      <div class="m-k">LAN multiplayer \xB7 free-for-all</div>
      <h2 class="m-h">Multiplayer</h2>
      <div data-f="mp-idle">
        <div class="mp-row"><label for="mp-name">Callsign</label><input id="mp-name" maxlength="16" autocomplete="off"></div>
        <div class="mp-row"><label for="mp-code">Room code</label><input id="mp-code" class="code" maxlength="4" placeholder="XXXX" autocomplete="off"></div>
      </div>
      <div data-f="mp-room" hidden>
        <div class="mp-code-big"><span>Room code</span><b data-f="mp-code-big">----</b></div>
        <p class="mp-roommeta"><span data-f="mp-count">1 / ${MAX_PLAYERS}</span> \xB7 <span data-f="mp-target">first to ${KILL_TARGET} kills</span> \xB7 <span data-f="mp-hostflag">you host</span></p>
        <div class="mp-players" data-f="mp-players"></div>
      </div>
      <p class="mp-status" data-f="mp-status"></p>
      <div class="m-actions col">
        <button class="btn primary" data-act="mp-host">Host a room</button>
        <button class="btn primary" data-act="mp-join">Join room</button>
        <button class="btn primary" data-act="mp-start" hidden>Start match</button>
        <button class="btn" data-act="mp-leave-room" hidden>Leave room</button>
        <button class="btn" data-act="mp-leave">Back to title</button>
      </div>
      <p class="mp-note">One machine runs <b>npm run lan</b>; everyone else just opens that address. The host shares the 4-character room code. ${MIN_PLAYERS}\u2013${MAX_PLAYERS} players, first to ${KILL_TARGET} kills wins.</p>
    </div>`;
  root.appendChild(sec);

  const resSec = document.createElement("section");
  resSec.className = "m-screen m-card m-debrief";
  resSec.dataset.s = "mp-result";
  resSec.setAttribute("aria-label", "Match over");
  resSec.innerHTML = `
    <div class="mp-wrap">
      <div class="m-k">Berth 4 \xB7 Match over</div>
      <h2 class="m-h" data-f="mp-winner">Winner: ?</h2>
      <dl class="m-stats" data-f="mp-standings" style="display:block"></dl>
      <div class="m-actions col">
        <button class="btn primary" data-act="mp-again">Back to lobby</button>
        <button class="btn" data-act="mp-quit">Quit to title</button>
      </div>
    </div>`;
  root.appendChild(resSec);

  // scoreboard + kill feed overlays
  const board = document.createElement("div");
  board.className = "mp-board";
  document.getElementById("ui").appendChild(board);
  const feed = document.createElement("div");
  feed.className = "mp-feed";
  document.getElementById("ui").appendChild(feed);

  const q = (sel) => sec.querySelector(sel);
  const nameInput = q("#mp-name");
  const codeInput = q("#mp-code");
  const statusEl = q('[data-f="mp-status"]');
  const playersEl = q('[data-f="mp-players"]');
  const idleEl = q('[data-f="mp-idle"]');
  const roomEl = q('[data-f="mp-room"]');
  const codeBigEl = q('[data-f="mp-code-big"]');
  const countEl = q('[data-f="mp-count"]');
  const targetEl = q('[data-f="mp-target"]');
  const hostFlagEl = q('[data-f="mp-hostflag"]');
  const btnHost = q('[data-act="mp-host"]');
  const btnJoin = q('[data-act="mp-join"]');
  const btnStart = q('[data-act="mp-start"]');
  const btnLeaveRoom = q('[data-act="mp-leave-room"]');

  try {
    nameInput.value =
      localStorage.getItem("saltline.mp.name") ||
      "Breacher-" + Math.floor(100 + Math.random() * 900);
  } catch {}

  // ---------- state ----------
  const net = createNet(onNet);
  const avatars = createAvatars(context);
  const mySeed = Number.isFinite(+context.seed)
    ? Math.abs(Math.trunc(+context.seed))
    : DEFAULT_SEED;
  let active = false; // MP subsystem engaged (controller installed)
  let inMatch = false;
  let myId = null;
  let myName = "";
  let isHost = false;
  let roomCode = "";
  let matchState = "lobby"; // lobby | countdown | playing | paused | dead | over
  let countdown = 0;
  let respawnT = 0;
  let invulnT = 0;
  let sendT = 0;
  let scores = {};
  let deaths = {};
  let names = {};
  let playerCount = 0;
  let roomMax = MAX_PLAYERS;
  let roomMin = MIN_PLAYERS;
  let targetKills = KILL_TARGET;
  let busy = false; // a connect/host/join request is in flight
  let lastHitBy = null;
  let matchStartTime = 0;
  let controller = null;
  let savedRestartLabel = null;

  const q2 = (sel, el) => (el || document).querySelector(sel);

  function setStatus(msg, isErr) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("err", !!isErr);
  }

  // Single source of truth for what the lobby shows.
  function syncLobby() {
    const inRoom = !!roomCode;
    idleEl.hidden = inRoom;
    roomEl.hidden = !inRoom;
    btnHost.hidden = inRoom;
    btnJoin.hidden = inRoom;
    btnLeaveRoom.hidden = !inRoom;
    btnStart.hidden = !(inRoom && isHost);
    btnStart.disabled = playerCount < roomMin || busy;
    btnStart.textContent =
      playerCount < roomMin
        ? `Need ${roomMin}+ players`
        : `Start match (${playerCount})`;
    btnHost.disabled = busy;
    btnJoin.disabled = busy;
    btnLeaveRoom.disabled = busy;
    hostFlagEl.textContent = isHost ? "you host" : "waiting for host";
    hostFlagEl.style.opacity = isHost ? ".8" : ".5";
    if (inRoom) {
      codeBigEl.textContent = roomCode;
      countEl.textContent = `${playerCount} / ${roomMax}`;
      targetEl.textContent = `first to ${targetKills} kills`;
    }
  }

  function renderPlayers(players) {
    playerCount = players ? players.length : 0;
    if (!players || !players.length) {
      playersEl.innerHTML = `<div class="mp-p"><b>Waiting for players\u2026</b><span class="kd">0 / ${roomMax}</span></div>`;
      syncLobby();
      return;
    }
    playersEl.innerHTML = players
      .map(
        (p) =>
          `<div class="mp-p"><b class="${p.host ? "host" : ""}">${escapeHtml(
            p.name,
          )}${p.host ? " \xB7 host" : ""}${p.id === myId ? " \xB7 you" : ""}</b><span class="kd">${p.kills || 0} K / ${p.deaths || 0} D</span></div>`,
      )
      .join("");
    syncLobby();
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // ---------- net messages ----------
  function onNet(m) {
    switch (m.t) {
      case "joined":
        if (m.seed != null && m.seed !== mySeed) {
          reloadWithSeed(m.seed);
          return;
        }
        myId = m.id;
        isHost = !!m.host;
        roomCode = m.room;
        codeInput.value = m.room;
        roomMax = m.max || MAX_PLAYERS;
        roomMin = m.min || MIN_PLAYERS;
        targetKills = m.targetKills || KILL_TARGET;
        busy = false;
        clearRejoin();
        setStatus(
          isHost
            ? "Room created \u2014 share the code, then start when everyone is in."
            : "Joined. Waiting for the host to start.",
          false,
        );
        syncLobby();
        break;
      case "room":
        if (m.seed != null && m.seed !== mySeed) {
          reloadWithSeed(m.seed);
          return;
        }
        if (m.max) roomMax = m.max;
        if (m.min) roomMin = m.min;
        if (m.targetKills) targetKills = m.targetKills;
        renderPlayers(m.players);
        if (m.phase === "match" && matchState === "lobby") {
          setStatus("Match in progress\u2026", false);
        }
        break;
      case "host-promoted":
        isHost = true;
        setStatus("You are now the host.", false);
        syncLobby();
        break;
      case "error":
        busy = false;
        if (m.code === "seed" && m.seed != null) {
          reloadWithSeed(m.seed);
          return;
        }
        setStatus(m.msg || "Error", true);
        syncLobby();
        break;
      case "begin":
        startMatch(m);
        break;
      case "s":
        avatars.snapshot(m.i, m.s);
        break;
      case "shot":
        onRemoteShot(m);
        break;
      case "dmg":
        onDamage(m);
        break;
      case "score":
        scores = m.scores || {};
        deaths = m.deaths || {};
        names = m.names || {};
        if (m.feed) addFeed(m.feed);
        renderBoard();
        break;
      case "over":
        endMatch(m);
        break;
      case "lobby":
        backToLobby();
        break;
      case "net:closed":
        busy = false;
        roomCode = "";
        if (!m.local && active && matchState !== "over") {
          leaveMatch(true);
          setStatus("Connection to room server lost.", true);
        }
        syncLobby();
        break;
    }
  }

  // ---------- lobby actions ----------
  function openLobby() {
    menus.show("mp");
    if (!roomCode) setStatus("");
    else setStatus(net.connected ? `In room ${roomCode}.` : "", false);
    syncLobby();
  }

  function withSeed(url, seed) {
    try {
      const u = new URL(url);
      u.searchParams.set("seed", String(seed));
      return u.toString();
    } catch {
      return url;
    }
  }

  function readRejoin() {
    try {
      const raw = sessionStorage.getItem(REJOIN_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(REJOIN_KEY);
      const d = JSON.parse(raw);
      return d && d.code ? d : null;
    } catch {
      return null;
    }
  }

  function clearRejoin() {
    try {
      sessionStorage.removeItem(REJOIN_KEY);
    } catch {}
  }

  // The map is generated once at boot from the page seed, so the only reliable
  // way to match the room's seed is to reload this page with that seed and then
  // rejoin automatically.
  function reloadWithSeed(seed) {
    if (!Number.isFinite(+seed) || +seed === mySeed) return;
    try {
      sessionStorage.setItem(
        REJOIN_KEY,
        JSON.stringify({
          code: roomCode || (codeInput.value || "").trim().toUpperCase(),
          name: myName || nameInput.value,
        }),
      );
    } catch {}
    setStatus(
      `Map seed mismatch \u2014 reloading with seed ${seed}\u2026`,
      false,
    );
    location.replace(withSeed(location.href, seed));
  }

  function ensureName() {
    myName = (nameInput.value || "").trim().slice(0, 16) || "Breacher";
    try {
      localStorage.setItem("saltline.mp.name", myName);
    } catch {}
    return myName;
  }

  async function hostRoom() {
    if (busy) return;
    ensureName();
    busy = true;
    syncLobby();
    setStatus("Connecting\u2026", false);
    const ok = await net.connect();
    if (!ok) {
      busy = false;
      syncLobby();
      return setStatus(
        `Cannot reach room server at ${wsUrl()} \u2014 run "npm run lan" on this machine.`,
        true,
      );
    }
    net.send({ t: "host", name: myName, seed: mySeed });
  }

  async function joinRoom(codeOverride) {
    if (busy) return;
    ensureName();
    const code = String(codeOverride || codeInput.value || "")
      .trim()
      .toUpperCase();
    if (code.length !== 4)
      return setStatus("Enter the 4-character room code.", true);
    codeInput.value = code;
    busy = true;
    syncLobby();
    setStatus("Connecting\u2026", false);
    const ok = await net.connect();
    if (!ok) {
      busy = false;
      syncLobby();
      return setStatus(
        `Cannot reach room server at ${wsUrl()} \u2014 check the host machine.`,
        true,
      );
    }
    net.send({ t: "join", code, name: myName, seed: mySeed });
  }

  function leaveRoom() {
    if (!roomCode) return;
    net.close();
    roomCode = "";
    myId = null;
    isHost = false;
    playerCount = 0;
    scores = {};
    deaths = {};
    names = {};
    playersEl.innerHTML = "";
    codeInput.value = "";
    setStatus("Left the room.", false);
    syncLobby();
  }

  function startMatch(d) {
    if (matchState !== "lobby" && matchState !== "over") return;
    inMatch = true;
    scores = {};
    deaths = {};
    names = d.names || {};
    targetKills = d.targetKills || KILL_TARGET;
    document.body.classList.add("mp-on");
    // avatars for everyone except me
    avatars.clear();
    (d.order || []).forEach((id, i) => {
      if (id !== myId) avatars.add(id, names[id] || "Breacher", i);
    });
    const spawn = pickSpawn(d.order ? d.order.indexOf(myId) : 0);
    context.player.reset({ pos: spawn.pos, yaw: spawn.yaw });
    // The boot path hides the viewmodel for the title screen and only the solo
    // flow ever shows it again. PvP has its own controller, so without this the
    // weapon stays invisible — and an invisible weapon refuses to fire.
    context.weapon.setVisible && context.weapon.setVisible(true);
    context.weapon.reset && context.weapon.reset();
    installController();
    matchState = "countdown";
    countdown = 3;
    menus.show("none");
    context.hud.show(true);
    context.hud.setMarkers && context.hud.setMarkers([]);
    context.hud.setObjective(
      `Free-for-all \xB7 first to ${d.targetKills || KILL_TARGET} kills`,
    );
    board.classList.add("on");
    renderBoard();
    matchStartTime = performance.now();
    setStatus("");
  }

  function pickSpawn(myIndex) {
    const groundSpawns =
      (context.level &&
        context.level.enemySpawns &&
        context.level.enemySpawns.filter((s) => s.type !== "air")) ||
      [];
    const fallback =
      context.level && context.level.playerStart
        ? context.level.playerStart
        : { pos: V(0, 0, 0), yaw: 0 };
    const pool = groundSpawns.length ? groundSpawns : [fallback];
    const s =
      pool[(myIndex + Math.floor(Math.random() * pool.length)) % pool.length];
    return { pos: V(s.pos.x, s.pos.y || 0, s.pos.z), yaw: s.yaw || 0 };
  }

  function installController() {
    if (controller) return;
    savedRestartLabel = root.querySelector('[data-act="restart"]');
    if (savedRestartLabel) savedRestartLabel.textContent = "Leave match";
    controller = {
      get state() {
        return matchState;
      },
      menus,
      flow,
      start() {},
      pause: pauseMatch,
      resume: resumeMatch,
      update(dt) {
        return mpUpdate(dt);
      },
    };
    context.game = controller;
    try {
      flow.state = "mp"; // neutralize flow's own key/lock listeners
    } catch {}
  }

  function uninstallController() {
    if (!controller) return;
    context.game = flow;
    try {
      flow.state = "title";
    } catch {}
    controller = null;
    if (savedRestartLabel) savedRestartLabel.textContent = "Restart mission";
  }

  // ---------- match update ----------
  function mpUpdate(dt) {
    sendT -= dt;
    if (sendT <= 0 && net.connected) {
      sendT = 1 / STATE_HZ;
      const p = context.player;
      net.send({
        t: "state",
        s: [
          +p.pos.x.toFixed(2),
          +p.pos.y.toFixed(2),
          +p.pos.z.toFixed(2),
          +p.yaw.toFixed(3),
          +p.pitch.toFixed(3),
          p.crouching ? 1 : 0,
          p.sprinting ? 1 : 0,
          p.alive ? 1 : 0,
        ],
      });
    }
    avatars.update(dt);
    if (invulnT > 0) {
      invulnT -= dt;
      context.player.invulnerable = invulnT > 0;
    }
    if (matchState === "countdown") {
      countdown -= dt;
      context.hud.message(
        `Match starts in ${Math.max(1, Math.ceil(countdown))}\u2026`,
        0.3,
      );
      if (countdown <= 0) goPlaying();
      return true;
    }
    if (matchState === "playing" || matchState === "dead") {
      const input = context.input;
      if (input.pressed && input.pressed("pause")) {
        pauseMatch();
        return false;
      }
      if (matchState === "dead") {
        respawnT -= dt;
        context.hud.message(
          `Down \u2014 respawning in ${Math.max(1, Math.ceil(respawnT))}\u2026`,
          0.3,
        );
        if (respawnT <= 0) doRespawn();
      }
    }
    return true;
  }

  function goPlaying() {
    matchState = "playing";
    const p = context.player;
    p.enabled = true;
    p.invulnerable = false;
    invulnT = SPAWN_INVULN;
    p.invulnerable = true;
    context.input.setGameplay && context.input.setGameplay(true);
    context.input.requestLock();
    context.hud.message("Fight!", 1.2);
  }

  function pauseMatch() {
    if (matchState !== "playing" && matchState !== "dead") return;
    matchState = "paused";
    context.input.setGameplay && context.input.setGameplay(false);
    context.input.exitLock && context.input.exitLock();
    context.audio.setPaused && context.audio.setPaused(true);
    menus.show("paused");
  }

  function resumeMatch() {
    if (matchState !== "paused") return;
    menus.show("none");
    context.audio.setPaused && context.audio.setPaused(false);
    context.input.setGameplay && context.input.setGameplay(true);
    context.input.requestLock();
    matchState = wasDead() ? "dead" : "playing";
  }
  function wasDead() {
    return context.player && !context.player.alive;
  }

  // ---------- damage / death / respawn ----------
  function onDamage(m) {
    if (!inMatch || matchState !== "playing") return;
    lastHitBy = m.from;
    context.player.damage(m.dmg, null);
  }

  events.on("player:dead", () => {
    if (!inMatch || matchState !== "playing") return;
    matchState = "dead";
    respawnT = RESPAWN_SECONDS;
    lastHitBy = lastHitBy || "";
    net.send({ t: "kill", killer: lastHitBy });
    context.hud.setPrompt && context.hud.setPrompt(null);
  });

  function doRespawn() {
    const spawn = pickSpawn(Math.floor(Math.random() * 8));
    context.player.reset({ pos: spawn.pos, yaw: spawn.yaw });
    context.player.invulnerable = true;
    invulnT = SPAWN_INVULN;
    lastHitBy = null;
    matchState = "playing";
    context.hud.message("Back in the fight", 1.5);
  }

  // ---------- shooter-side hit detection ----------
  const origMelee = context.combat.meleeAttack;
  context.combat.meleeAttack = function (origin, dir, opts = {}) {
    const inGame =
      inMatch && (matchState === "playing" || matchState === "dead");
    if (!inGame)
      return origMelee
        ? origMelee.call(context.combat, origin, dir, opts)
        : null;
    const hit = avatars.meleeTarget(
      origin,
      dir,
      opts.range || 2.6,
      opts.arc || 0.55,
    );
    if (!hit)
      return origMelee
        ? origMelee.call(context.combat, origin, dir, opts)
        : null;
    net.send({
      t: "hit",
      target: hit.id,
      dmg: opts.damage || 65,
      head: false,
      melee: true,
    });
    const res = {
      point: hit.point,
      normal: dir.clone().negate(),
      dist: hit.dist,
      surface: "enemy",
      enemy: null,
      dir,
      from: "player",
      melee: true,
    };
    context.events.emit("impact", res);
    context.events.emit("player:hitEnemy", {
      enemy: null,
      part: "body",
      killed: false,
      weak: false,
      melee: true,
    });
    return res;
  };

  const origPlayerShot = context.combat.playerShot;
  context.combat.playerShot = function (origin, dir, opts = {}) {
    const damage = opts.damage || 28;
    const range = opts.range || 300;
    if (!inMatch || (matchState !== "playing" && matchState !== "dead"))
      return origPlayerShot.call(context.combat, origin, dir, opts);
    const wall = context.physics.raycast(origin, dir, range);
    const wallDist = wall ? wall.dist : range;
    const hit = avatars.raycast(origin, dir, wallDist);
    if (hit) {
      const stats = context.combat.stats;
      stats.shots++;
      stats.hits++;
      const dmg = hit.part === "head" ? damage * 2 : damage;
      net.send({
        t: "hit",
        target: hit.id,
        dmg,
        head: hit.part === "head",
      });
      context.events.emit("impact", {
        point: hit.point,
        normal: dir.clone().negate(),
        dist: hit.dist,
        surface: "enemy",
        enemy: null,
        dir,
        from: "player",
      });
      return {
        point: hit.point,
        normal: dir.clone().negate(),
        dist: hit.dist,
        surface: "enemy",
        enemy: null,
        dir,
        from: "player",
      };
    }
    const res = origPlayerShot.call(context.combat, origin, dir, opts);
    if (res && res.point) {
      net.send({
        t: "shot",
        o: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)],
        e: [
          +res.point.x.toFixed(2),
          +res.point.y.toFixed(2),
          +res.point.z.toFixed(2),
        ],
      });
    }
    return res;
  };

  function onRemoteShot(m) {
    if (m.i === myId) return;
    const o = V(m.o[0], m.o[1], m.o[2]);
    const e = V(m.e[0], m.e[1], m.e[2]);
    try {
      context.fx && context.fx.tracer && context.fx.tracer(o, e);
      context.audio &&
        context.audio.play &&
        context.audio.play("rifle_shot", { pos: o });
    } catch {}
  }

  // ---------- scoreboard / feed ----------
  function myKills() {
    return (scores && myId && scores[myId]) || 0;
  }

  function renderBoard() {
    const rows = Object.keys({ ...scores, ...deaths })
      .map((id) => ({
        id,
        k: scores[id] || 0,
        d: deaths[id] || 0,
        name: names[id] || "?",
      }))
      .sort((a, b) => b.k - a.k || a.d - b.d);
    board.innerHTML =
      `<h4>Deathmatch \xB7 ${roomCode}</h4>` +
      `<div class="mp-b-head"><span class="n">player</span><span class="k">K</span><span class="d">D</span></div>` +
      rows
        .map(
          (r) =>
            `<div class="mp-b-row ${r.id === myId ? "me" : ""}"><span class="n">${escapeHtml(
              r.name,
            )}</span><span class="k">${r.k}</span><span class="d">${r.d}</span></div>`,
        )
        .join("");
  }

  function addFeed(f) {
    const el = document.createElement("div");
    el.className = "mp-f";
    el.innerHTML = `<b>${escapeHtml(f.k)}</b> \u25B8 <span class="v">${escapeHtml(
      f.v,
    )}</span>${f.head ? " \xB7 headshot" : ""}`;
    feed.appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

  // ---------- match end / leave ----------
  function endMatch(m) {
    matchState = "over";
    inMatch = false;
    document.body.classList.remove("mp-on");
    const p = context.player;
    p.enabled = false;
    context.input.setGameplay && context.input.setGameplay(false);
    context.input.exitLock && context.input.exitLock();
    context.hud.show(false);
    board.classList.remove("on");
    q2('[data-f="mp-winner"]', resSec).textContent = `Winner: ${
      m.winnerName || "?"
    }`;
    const rows = Object.keys({ ...(m.scores || {}), ...(m.deaths || {}) })
      .map((id) => ({
        id,
        k: (m.scores || {})[id] || 0,
        d: (m.deaths || {})[id] || 0,
        name: (m.names || {})[id] || "?",
      }))
      .sort((a, b) => b.k - a.k || a.d - b.d);
    q2('[data-f="mp-standings"]', resSec).innerHTML = rows
      .map(
        (r, i) =>
          `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.08)">
            <span>${i + 1}. ${escapeHtml(r.name)}${r.id === myId ? " (you)" : ""}</span><b>${r.k} K / ${r.d} D</b></div>`,
      )
      .join("");
    menus.show("mp-result");
  }

  function backToLobby() {
    matchState = "lobby";
    inMatch = false;
    document.body.classList.remove("mp-on");
    uninstallController();
    avatars.clear();
    board.classList.remove("on");
    feed.innerHTML = "";
    scores = {};
    deaths = {};
    context.hud.show(false);
    context.hud.setObjective && context.hud.setObjective("");
    context.player.enabled = false;
    context.weapon.setVisible && context.weapon.setVisible(false);
    menus.show("mp");
    setStatus("Back in the lobby.", false);
    syncLobby();
  }

  function leaveMatch(silent) {
    matchState = "lobby";
    inMatch = false;
    active = false;
    busy = false;
    roomCode = "";
    myId = null;
    isHost = false;
    playerCount = 0;
    scores = {};
    deaths = {};
    names = {};
    lastHitBy = null;
    document.body.classList.remove("mp-on");
    uninstallController();
    avatars.clear();
    board.classList.remove("on");
    feed.innerHTML = "";
    playersEl.innerHTML = "";
    codeInput.value = "";
    context.hud.show(false);
    context.hud.setObjective && context.hud.setObjective("");
    context.player.enabled = false;
    context.weapon.setVisible && context.weapon.setVisible(false);
    net.close();
    menus.show("title");
    if (!silent) setStatus("", false);
    syncLobby();
  }

  // ---------- menu wiring ----------
  // document-level capture: run before the menus handler so MP actions can
  // pre-empt flow's own "restart"/"resume" callbacks.
  document.addEventListener(
    "click",
    (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest("button");
      if (!btn || !root.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === "multiplayer") {
        ev.stopPropagation();
        active = true;
        openLobby();
      } else if (act === "mp-host") {
        ev.stopPropagation();
        hostRoom();
      } else if (act === "mp-join") {
        ev.stopPropagation();
        joinRoom();
      } else if (act === "mp-start") {
        ev.stopPropagation();
        if (!isHost) return;
        if (playerCount < roomMin)
          return setStatus(`Need at least ${roomMin} players to start.`, true);
        net.send({ t: "start" });
      } else if (act === "mp-leave-room") {
        ev.stopPropagation();
        leaveRoom();
      } else if (act === "mp-leave") {
        ev.stopPropagation();
        leaveMatch();
      } else if (act === "mp-again") {
        ev.stopPropagation();
        if (isHost) net.send({ t: "back" });
        else setStatus("Waiting for the host to reopen the lobby\u2026", false);
      } else if (act === "mp-quit") {
        ev.stopPropagation();
        leaveMatch();
      } else if (active && matchState === "paused" && act === "restart") {
        ev.stopPropagation();
        leaveMatch();
      } else if (active && matchState === "paused" && act === "resume") {
        ev.stopPropagation();
        resumeMatch();
      }
    },
    true,
  );

  // title screen entry button
  const titleActions = root.querySelector(
    '.m-screen[data-s="title"] .m-actions',
  );
  if (titleActions && !root.querySelector('[data-act="multiplayer"]')) {
    const b = document.createElement("button");
    b.className = "btn";
    b.dataset.act = "multiplayer";
    b.textContent = "Multiplayer";
    titleActions.insertBefore(b, titleActions.querySelector(".m-only-narrow"));
  }

  syncLobby();

  // After a seed-mismatch reload we saved the room code and rejoin automatically.
  const pendingRejoin = readRejoin();
  if (pendingRejoin) {
    setTimeout(() => {
      active = true;
      if (pendingRejoin.name) nameInput.value = pendingRejoin.name;
      menus.show("mp");
      syncLobby();
      joinRoom(pendingRejoin.code);
    }, 250);
  }

  // debug / test hooks
  window.__MP = {
    state: () => ({
      matchState,
      myId,
      roomCode,
      scores,
      deaths,
      inMatch,
      names,
      playerCount,
      mySeed,
    }),
    ids: () => [...avatars.map.keys()],
    avatars,
    ping: () => net.send({ t: "ping", n: Date.now() }),
    sendHit: (target, dmg, head) => net.send({ t: "hit", target, dmg, head }),
    sendKill: (killer) => net.send({ t: "kill", killer }),
    pos: () => (context.player ? context.player.pos.toArray() : null),
    avatarPos: (id) => {
      const a = avatars.map.get(id);
      return a && a.body.group.visible ? a.body.group.position.toArray() : null;
    },
  };

  return {
    get active() {
      return active;
    },
    get inMatch() {
      return inMatch;
    },
  };
}

export { createMultiplayer, KILL_TARGET };
