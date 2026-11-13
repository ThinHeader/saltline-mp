// Stage 9: after a synthetic mousedown, inspect the input's internal "down"
// set and the render frame counter.
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
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.text +
          " " +
          (r.exceptionDetails.exception && r.exceptionDetails.exception.description),
      );
    return r.result.value;
  };
  return { ws, send, evaluate };
}

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Runtime.enable");

  const res = await c.evaluate(`(async () => {
    const G = window.__G;
    const f0 = G.render && G.render.info ? G.render.info.render.frame : null;
    const cv = document.querySelector('canvas');
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    const immediate = { downFire: G.input.down('fire'), pressed: G.input.pressed('fire'), fire: G.input.fire };
    await new Promise(r => setTimeout(r, 350));
    const later = { downFire: G.input.down('fire'), fire: G.input.fire };
    const f1 = G.render && G.render.info ? G.render.info.render.frame : null;
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return JSON.stringify({ immediate, later, frames: [f0, f1], mode: G.input.mode, locked: G.input.locked });
  })()`);
  console.log(res);

  // Is any other canvas / overlay swallowing the pointer?
  const dom = await c.evaluate(`JSON.stringify({
    canvases: [...document.querySelectorAll('canvas')].map(c => ({id: c.id, w: c.width, h: c.height, cls: c.className})),
    topAtCenter: (document.elementFromPoint(640, 400) || {}).tagName,
    bodyChildren: [...document.body.children].map(e => e.tagName + '#' + e.id),
  })`);
  console.log(dom);
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
