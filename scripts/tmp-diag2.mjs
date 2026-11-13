// Stage 2: teleport enemies in front of the player, screenshot them at close
// range, then fire at point-blank to see whether hits register.
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
          JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description),
      );
    return r.result.value;
  };
  return { ws, send, evaluate };
}

async function shot(c, path) {
  const s = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path, Buffer.from(s.data, "base64"));
  console.log("shot ->", path);
}

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");

  const staged = await c.evaluate(`(() => {
    const G = window.__G, T = G.THREE, cam = G.camera;
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const list = G.enemies.list.filter(e => e.alive);
    const hound = list.find(e => e.type === "hound");
    const gulls = list.filter(e => e.type === "gull");
    const out = { houndKeys: hound ? Object.keys(hound).slice(0, 40) : null };
    if (hound) {
      const p = cam.position.clone().addScaledVector(fwd, 5.5);
      p.y = 0.05;
      if (hound.pos) hound.pos.copy(p);
      if (hound.vel && hound.vel.set) hound.vel.set(0, 0, 0);
      hound.passive = true;
      hound.mode = "patrol";
      out.hound = { pos: hound.pos ? hound.pos.toArray().map(v=>+v.toFixed(2)) : null, hp: hound.hp };
    }
    gulls.forEach((g, i) => {
      const p = cam.position.clone().addScaledVector(fwd, 8 + i * 3);
      if (g.pos) {
        g.pos.copy(p);
        g.pos.y = cam.position.y + 1.2 + i * 0.9;
      }
      if (g.vel && g.vel.set) g.vel.set(0, 0, 0);
      g.passive = true;
      g.hoverFixed = true;
      g.alt = g.pos ? g.pos.y : 3;
    });
    out.gulls = gulls.map(g => ({ pos: g.pos ? g.pos.toArray().map(v=>+v.toFixed(2)) : null, hp: g.hp }));
    out.camFwd = fwd.toArray().map(v=>+v.toFixed(2));
    return JSON.stringify(out);
  })()`);
  console.log("staged:", staged);

  await sleep(600);
  await shot(c, "docs/diag-enemy-close.png");

  // Point-blank shot at the hound's torso.
  const shotRes = await c.evaluate(`(() => {
    const G = window.__G;
    const cam = G.camera;
    const hound = G.enemies.list.find(e => e.alive && e.type === "hound");
    if (!hound) return JSON.stringify({ err: "no hound" });
    const torso = hound.pos.clone(); torso.y += 0.9;
    const o = cam.position.clone();
    const d = torso.clone().sub(o).normalize();
    const before = { shots: G.combat.stats.shots, hits: G.combat.stats.hits };
    const hp0 = hound.hp;
    const res = G.combat.playerShot(o, d, { damage: 26, range: 300 });
    return JSON.stringify({
      dist: +o.distanceTo(torso).toFixed(2),
      before, after: { shots: G.combat.stats.shots, hits: G.combat.stats.hits },
      hpBefore: hp0, hpAfter: +hound.hp.toFixed(1),
      result: res ? { surface: res.surface, part: res.part || null, dist: +res.dist.toFixed(2) } : null,
    });
  })()`);
  console.log("point-blank shot:", shotRes);

  await sleep(300);
  await shot(c, "docs/diag-enemy-hit.png");
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
