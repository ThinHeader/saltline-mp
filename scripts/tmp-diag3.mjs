// Stage 3: hold the fire input and see whether the weapon actually consumes
// ammo and produces shots. This is the real trigger path (input -> weapon).
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

  const probe = await c.evaluate(`(() => {
    const G = window.__G;
    return JSON.stringify({
      weaponKeys: G.weapon ? Object.keys(G.weapon) : null,
      inputKeys: G.input ? Object.keys(G.input).slice(0, 30) : null,
      fireType: typeof (G.input && G.input.fire),
      ammoState: G.weapon && G.weapon.state ? {
        ammo: G.weapon.state.ammo, reserve: G.weapon.state.reserve, state: G.weapon.state.state
      } : null,
    });
  })()`);
  console.log("probe:", probe);

  // Hold fire via the same input flag the mouse sets.
  const before = await c.evaluate(`(() => {
    const G = window.__G;
    return JSON.stringify({
      ammo: G.weapon.state.ammo,
      shots: G.combat.stats.shots,
      hits: G.combat.stats.hits,
    });
  })()`);
  console.log("before:", before);

  await c.evaluate(`window.__G.input.fire = true; "ok"`);
  await sleep(900);
  await c.evaluate(`window.__G.input.fire = false; "ok"`);
  await sleep(200);

  const after = await c.evaluate(`(() => {
    const G = window.__G;
    return JSON.stringify({
      ammo: G.weapon.state.ammo,
      reserve: G.weapon.state.reserve,
      shots: G.combat.stats.shots,
      hits: G.combat.stats.hits,
      weaponState: G.weapon.state.state,
    });
  })()`);
  console.log("after :", after);

  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-fire.png", Buffer.from(s.data, "base64"));
  console.log("shot -> docs/diag-fire.png");
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
