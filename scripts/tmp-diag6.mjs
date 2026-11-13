// Stage 6: normal player path — title screen -> Deploy -> intro -> fire.
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

  // Fresh page on the normal entry point (no autostart).
  await c.send("Page.navigate", { url: "http://127.0.0.1:8080/" });
  await sleep(2500);
  for (let i = 0; i < 30; i++) {
    const ok = await c.evaluate("!!(window.__G && window.__G.input)");
    if (ok) break;
    await sleep(500);
  }
  console.log("booted:", await c.evaluate(`JSON.stringify({
    menu: !!document.querySelector('.menu'),
    screen: document.querySelector('.menu') ? document.querySelector('.menu').dataset.screen : null,
    deployBtn: !!document.querySelector('[data-act="deploy"]'),
    bodyClass: document.body.className,
  })`));

  // Click Deploy via a real DOM click on the button.
  const clicked = await c.evaluate(`(() => {
    const b = document.querySelector('[data-act="deploy"]');
    if (!b) return "no button";
    b.click();
    return "clicked";
  })()`);
  console.log("deploy:", clicked);

  // Intro is 3.5s, plus fade.
  await sleep(5200);
  console.log("after intro:", await c.evaluate(`(() => {
    const G = window.__G;
    const m = document.querySelector('.menu');
    return JSON.stringify({
      screen: m ? m.dataset.screen : null,
      ammo: G.weapon.ammo, alive: G.player.alive, mode: G.input.mode,
    });
  })()`));

  // First click captures pointer lock, second one fires.
  const s0 = await c.evaluate(`JSON.stringify({shots: __G.combat.stats.shots, ammo: __G.weapon.ammo})`);
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1 });
  await sleep(100);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  console.log("after lock click:", await c.evaluate(`JSON.stringify({shots: __G.combat.stats.shots, ammo: __G.weapon.ammo, locked: __G.input.locked, fire: __G.input.fire})`));

  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 400, button: "left", buttons: 1, clickCount: 1 });
  await sleep(700);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 400, button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  const s1 = await c.evaluate(`JSON.stringify({shots: __G.combat.stats.shots, ammo: __G.weapon.ammo, wstate: __G.weapon.state})`);
  console.log("after fire hold:", s1);
  console.log("before        :", s0);

  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-fire-normal.png", Buffer.from(s.data, "base64"));
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
