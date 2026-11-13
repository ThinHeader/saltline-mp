// WebSocket client for LAN multiplayer.
// 端口解析顺序：?ws= 查询参数 > window.__MP_WS_PORT > 单端口模式(8080) > 默认 8765
function mpPort() {
  try {
    const q = new URLSearchParams(location.search).get("ws");
    if (q) return Number(q) || 8765;
  } catch {}
  if (typeof window !== "undefined" && window.__MP_WS_PORT)
    return Number(window.__MP_WS_PORT);
  if (location.port === "8080" || location.port === "")
    return Number(location.port || 80) || 8765;
  return 8765;
}

function wsUrl() {
  const host = location.hostname || "127.0.0.1";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${host}:${mpPort()}`;
}

function createNet(onMessage) {
  let ws = null;
  let myId = null;
  let connecting = false;
  let closingLocal = false;
  let hbTimer = null;

  // The lobby is completely quiet, so without this the server's idle sweep
  // drops everyone a few seconds after they join. Protocol-level ping from the
  // server is the real safety net; this one also keeps proxies awake.
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(() => {
      if (ws && ws.readyState === 1)
        try {
          ws.send(JSON.stringify({ t: "ping", n: Date.now() }));
        } catch {}
    }, 5000);
  }

  function stopHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = null;
  }

  function connect() {
    if (connecting || (ws && ws.readyState <= 1)) return Promise.resolve(true);
    connecting = true;
    closingLocal = false;
    return new Promise((resolve) => {
      let settled = false;
      try {
        ws = new WebSocket(wsUrl());
      } catch (e) {
        connecting = false;
        resolve(false);
        return;
      }
      ws.onopen = () => {
        connecting = false;
        settled = true;
        startHeartbeat();
        resolve(true);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          connecting = false;
          resolve(false);
        }
      };
      ws.onclose = () => {
        myId = null;
        stopHeartbeat();
        const local = closingLocal;
        closingLocal = false;
        if (!settled) {
          settled = true;
          connecting = false;
          resolve(false);
        }
        onMessage({ t: "net:closed", local });
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === "joined") myId = m.id;
        onMessage(m);
      };
    });
  }

  function send(obj) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(obj));
      } catch {}
    }
  }

  return {
    connect,
    send,
    close() {
      stopHeartbeat();
      if (ws) {
        closingLocal = true;
        try {
          ws.close();
        } catch {}
      }
      ws = null;
      myId = null;
    },
    get connected() {
      return !!ws && ws.readyState === 1;
    },
    get id() {
      return myId;
    },
  };
}

export { createNet, mpPort as MP_PORT, wsUrl };
