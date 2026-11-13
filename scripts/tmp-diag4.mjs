// Stage 4: real mouse press via CDP -> does the gun actually fire?
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
  await c.send("Page.enable");

  const state = () =>
    c.evaluate(`(() => {
      const G = window.__G;
      return JSON.stringify({
        mode: G.input.mode, locked: G.input.locked, fire: G.input.fire,
        ammo: G.weapon.ammo, reserve: G.weapon.reserve, wstate: G.weapon.state,
        shots: G.combat.stats.shots, hits: G.combat.stats.hits,
        alive: G.player.alive, sprint: G.player.sprinting,
      });
    })()`);

  console.log("before:", await state());

  // Click once in the middle of the canvas: first click may only capture pointer.
  await c.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1,
  });
  await sleep(120);
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(400);
  console.log("after 1st click:", await state());

  // Now hold for 800ms.
  await c.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1,
  });
  await sleep(800);
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(300);
  console.log("after hold    :", await state());

  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-fire2.png", Buffer.from(s.data, "base64"));
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
