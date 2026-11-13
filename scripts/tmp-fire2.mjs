// Stage 8: same page, force gameplay on, then fire. Confirms whether the
// gameplay gate is what swallows the input.
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

  const st = () =>
    c.evaluate(`JSON.stringify({
      ammo: __G.weapon.ammo, shots: __G.combat.stats.shots, fire: __G.input.fire,
      locked: __G.input.locked, mode: __G.input.mode,
      screen: document.querySelector('.menu') ? document.querySelector('.menu').dataset.screen : null,
    })`);

  console.log("state now      :", await st());

  // Synthetic DOM mousedown BEFORE forcing gameplay.
  await c.evaluate(`(() => {
    const cv = document.querySelector('canvas');
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    return 'sent';
  })()`);
  await sleep(250);
  console.log("dom down (r=?) :", await st());
  await c.evaluate(`document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); 'up'`);

  // Force gameplay and retry.
  await c.evaluate(`__G.input.setGameplay(true); 'on'`);
  await c.evaluate(`(() => {
    const cv = document.querySelector('canvas');
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    return 'sent';
  })()`);
  await sleep(600);
  console.log("dom down (r=1) :", await st());
  await c.evaluate(`document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); 'up'`);
  await sleep(200);
  console.log("after release  :", await st());

  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
