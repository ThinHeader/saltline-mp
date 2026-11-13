// Probe UI structure (shadow root?) so we can click Deploy reliably.
import http from "node:http";
import { WebSocket } from "ws";

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  let seq = 0;
  const pending = new Map();
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, send, evaluate };
}

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Runtime.enable");
  const out = await c.evaluate(`(() => {
    const ui = document.querySelector('#ui');
    return JSON.stringify({
      uiExists: !!ui,
      uiChildren: ui ? ui.children.length : -1,
      uiShadow: !!(ui && ui.shadowRoot),
      uiInner: ui ? ui.innerHTML.slice(0, 160) : null,
      anyMenu: document.querySelectorAll('.menu').length,
      allBtns: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 12),
      shadowBtns: ui && ui.shadowRoot ? [...ui.shadowRoot.querySelectorAll('button')].map(b => b.textContent.trim()) : null,
    });
  })()`);
  console.log(out);
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
