// Stage 7: click Deploy on the live page, wait out the intro, then fire.
import fs from "node:fs";
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

const st = (c) =>
  c.evaluate(`JSON.stringify({
    screen: (document.querySelector('.menu')||{}).dataset ? document.querySelector('.menu').dataset.screen : null,
    ammo: __G.weapon.ammo, shots: __G.combat.stats.shots, hits: __G.combat.stats.hits,
    wstate: __G.weapon.state, locked: __G.input.locked, mode: __G.input.mode, alive: __G.player.alive,
  })`);

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Runtime.enable");
  await c.send("Page.enable");

  console.log("before deploy:", await st(c));
  console.log(
    "click:",
    await c.evaluate(`(() => { const b = document.querySelector('[data-act="deploy"]'); if (!b) return "missing"; b.click(); return "ok"; })()`),
  );

  await sleep(5600);
  console.log("after intro :", await st(c));

  // click 1: capture pointer
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1 });
  await sleep(120);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1 });
  await sleep(350);
  console.log("after lock  :", await st(c));

  // click 2: hold fire
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1 });
  await sleep(700);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  console.log("after fire   :", await st(c));

  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-fire-live.png", Buffer.from(s.data, "base64"));
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
