// Stage 5: dispatch a real DOM mousedown on the canvas, then toggle gameplay
// on/off, to find out which condition swallows the fire input.
import fs from "node:fs";
import http from "node:http";
import { WebSocket } from "ws";

function getJson(url) {
  return new Promise((res, rej) => {
    http
      .get(url, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej);
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

  const state = () =>
    c.evaluate(`(() => {
      const G = window.__G;
      return JSON.stringify({
        locked: G.input.locked, mode: G.input.mode, fire: G.input.fire,
        ammo: G.weapon.ammo, shots: G.combat.stats.shots, hits: G.combat.stats.hits,
        wstate: G.weapon.state,
      });
    })()`);

  // Instrument: does the canvas hander even see our synthetic event?
  await c.evaluate(`(() => {
    window.__probe = [];
    const cv = document.querySelector("canvas");
    cv.addEventListener("mousedown", (e) => {
      window.__probe.push({ button: e.button, locked: !!document.pointerLockElement, t: Math.round(performance.now()) });
    }, true);
    return "probe installed";
  })()`);

  console.log("state:", await state());

  // A: plain synthetic mousedown + hold the flag via repeated events
  const a = await c.evaluate(`(() => {
    const cv = document.querySelector("canvas");
    cv.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
    return JSON.stringify({ probe: window.__probe.slice(-1), fireNow: window.__G.input.fire });
  })()`);
  console.log("A synthetic mousedown:", a);
  await sleep(250);
  console.log("A after 250ms:", await state());
  await c.evaluate(`document.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true })); "up"`);

  // B: force gameplay on, then repeat
  const b = await c.evaluate(`(() => {
    window.__G.input.setGameplay(true);
    const cv = document.querySelector("canvas");
    cv.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
    return JSON.stringify({ fireNow: window.__G.input.fire, mode: window.__G.input.mode, locked: window.__G.input.locked });
  })()`);
  console.log("B after setGameplay(true):", b);
  await sleep(500);
  console.log("B after 500ms:", await state());

  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-fire3.png", Buffer.from(s.data, "base64"));
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
