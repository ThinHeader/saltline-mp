// Confirm the premise: on the title screen the viewmodel is hidden, which is
// exactly the state PvP used to inherit because it never re-showed it.
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
  await c.send("Page.enable");
  await c.send("Runtime.enable");

  await c.send("Page.navigate", { url: "http://127.0.0.1:8080/" });
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    const ok = await c.evaluate("!!(window.__G && window.__G.weapon)").catch(() => false);
    if (ok) break;
  }
  await sleep(1200);

  console.log(
    "title screen:",
    await c.evaluate(`JSON.stringify({
      weaponRootVisible: __G.weapon.root.visible,
      menuScreen: document.querySelector('.menu') ? document.querySelector('.menu').dataset.screen : null,
    })`),
  );

  // Simulate what PvP now does on match start.
  await c.evaluate(`__G.weapon.setVisible(true); "shown"`);
  console.log(
    "after setVisible(true):",
    await c.evaluate(`JSON.stringify({ weaponRootVisible: __G.weapon.root.visible })`),
  );
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
