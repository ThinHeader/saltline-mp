// Verify the enemy rim shell: reload, stage enemies in front, screenshot.
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
    const ok = await c.evaluate("!!(window.__G && window.__G.enemies && window.__G.enemies.list.length)").catch(() => false);
    if (ok) break;
  }
  console.log("booted, enemies:", await c.evaluate("window.__G ? window.__G.enemies.list.length : -1"));

  // Count rim meshes: each rig should have a group child that is a SkinnedMesh
  // sharing the parent's geometry.
  console.log(
    "rim check:",
    await c.evaluate(`JSON.stringify(__G.enemies.list.map(e => ({
      type: e.type,
      children: e.rig.group.children.length,
      rim: !!e.rig.rim,
      rimVisible: e.rig.rim ? e.rig.rim.visible : null,
    })))`),
  );

  const staged = await c.evaluate(`(() => {
    const G = window.__G, T = G.THREE, cam = G.camera;
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const list = G.enemies.list.filter(e => e.alive);
    const hound = list.find(e => e.type === "hound");
    const gulls = list.filter(e => e.type === "gull");
    const freeze = (e) => {
      e.passive = true;
      if (e.vel && e.vel.set) e.vel.set(0, 0, 0);
      if ("speed" in e) e.speed = 0;
      if ("thr" in e) e.thr = 0;
    };
    if (hound) {
      const p = cam.position.clone().addScaledVector(fwd, 4.5);
      p.y = 0.05;
      hound.pos.copy(p);
      freeze(hound);
    }
    gulls.forEach((g, i) => {
      const p = cam.position.clone().addScaledVector(fwd, 6.5 + i * 3);
      g.pos.copy(p);
      g.pos.y = cam.position.y + 0.9 + i * 0.7;
      freeze(g);
    });
    return JSON.stringify({ camFwd: fwd.toArray().map(v => +v.toFixed(2)) });
  })()`);
  console.log("staged:", staged);

  await sleep(260);
  const a = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/rim-close.png", Buffer.from(a.data, "base64"));
  console.log("shot -> docs/rim-close.png");

  // Wider view: back off the camera a little to judge readability at range.
  await c.evaluate(`(() => {
    const G = window.__G;
    const list = G.enemies.list.filter(e => e.alive);
    const hound = list.find(e => e.type === "hound");
    if (hound) hound.pos.add(new G.THREE.Vector3(0, 0, 0));
    return "ok";
  })()`);
  await sleep(200);

  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
