// Stage 11: is the animation loop actually advancing? Sample time.frame.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const a = await c.evaluate(`JSON.stringify({frame: __G.time.frame, t: +__G.time.t.toFixed(2), state: __G.game.state, hidden: document.hidden, vis: document.visibilityState})`);
  await sleep(700);
  const b = await c.evaluate(`JSON.stringify({frame: __G.time.frame, t: +__G.time.t.toFixed(2), state: __G.game.state, hidden: document.hidden})`);
  console.log("t0:", a);
  console.log("t1:", b);

  // Sample f.fire while holding the mouse down, 20 times over 600ms.
  await c.evaluate(`(() => { document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown', {button:0,bubbles:true,cancelable:true})); return 'down'; })()`);
  const samples = await c.evaluate(`(async () => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const G = window.__G;
      out.push({ f: +G.time.frame, fire: G.input.fire, down: G.input.down('fire'), ammo: G.weapon.ammo });
      await new Promise(r => setTimeout(r, 50));
    }
    return JSON.stringify(out);
  })()`);
  console.log("samples:", samples);
  await c.evaluate(`document.dispatchEvent(new MouseEvent('mouseup', {button:0,bubbles:true})); 'up'`);
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
