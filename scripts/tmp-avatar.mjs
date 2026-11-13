// Preview the new remote-player avatars: spawn three, put them in front of the
// camera, screenshot.
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

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");

  await c.send("Page.navigate", { url: "http://127.0.0.1:8080/?autostart=1" });
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const ok = await c
      .evaluate(
        "!!(window.__G && window.__MP && window.__MP.avatars && window.__G.camera.position.lengthSq() > 1)",
      )
      .catch(() => false);
    if (ok) break;
  }
  console.log(
    "ready:",
    await c.evaluate("JSON.stringify({cam: __G.camera.position.toArray().map(v=>+v.toFixed(1)), mp: !!(__MP && __MP.avatars)})"),
  );

  const out = await c.evaluate(`(() => {
    const G = window.__G, T = G.THREE, cam = G.camera;
    const av = window.__MP.avatars;
    av.clear();
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    const names = ["RAVEN", "DOCKER-7", "QUAY"];
    const info = [];
    names.forEach((n, i) => {
      const p = cam.position.clone().addScaledVector(fwd, 3.4).addScaledVector(right, (i - 1) * 1.05);
      p.y = 0;
      av.add("p" + i, n, i);
      // two snapshots at the same spot so the walk blend settles at zero speed
      av.snapshot("p" + i, [p.x, p.y, p.z, Math.PI, 0, 0, 0, 1]);
      for (let k = 0; k < 45; k++) av.update(0.033);
      av.snapshot("p" + i, [p.x, p.y, p.z, Math.PI, 0, 0, 0, 1]);
      for (let k = 0; k < 45; k++) av.update(0.033);
      info.push({ name: n, pos: p.toArray().map(v => +v.toFixed(2)) });
    });
    return JSON.stringify(info);
  })()`);
  console.log("spawned:", out);

  await sleep(500);
  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/avatar-preview.png", Buffer.from(s.data, "base64"));
  console.log("shot -> docs/avatar-preview.png");
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
