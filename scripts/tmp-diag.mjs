// Diagnose: does the solo mode show enemy models, and does shooting work?
// Uses the raw CDP WebSocket protocol (no external deps).
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
      throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  };
  return { ws, send, evaluate };
}

(async () => {
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("8080"));
  if (!page) throw new Error("no page target");
  const c = await attach(page.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");

  console.log("waiting for game boot...");
  for (let i = 0; i < 30; i++) {
    const ready = await c.evaluate(
      "!!(window.__G && window.__G.enemies && window.__G.player)",
    );
    if (ready) break;
    await sleep(1000);
  }

  const diag = await c.evaluate(`(() => {
    const G = window.__G;
    const out = { hasG: !!G };
    try {
      const cam = G.camera;
      const list = G.enemies.list;
      out.camPos = cam.position.toArray().map(v => +v.toFixed(2));
      out.enemies = list.map(e => {
        const g = e.rig ? e.rig.group : null;
        return {
          type: e.type,
          alive: !!e.alive,
          active: !!e.active,
          rigVisible: g ? g.visible : null,
          inScene: !!(g && g.parent),
          children: g ? g.children.length : -1,
          childTypes: g ? g.children.map(ch => ch.type + (ch.isSkinnedMesh ? "*" : "")) : [],
          scale: g ? g.scale.toArray().map(v => +v.toFixed(2)) : null,
          visibleAll: g ? (() => { let n = 0; g.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; })() : -1,
          pos: e.pos.toArray().map(v => +v.toFixed(1)),
          distToCam: +e.pos.distanceTo(cam.position).toFixed(1),
          hp: e.hp,
        };
      });
      // Direct shot test against the closest live enemy.
      const t = list.filter(x => x.alive).sort((a, b) => a.pos.distanceTo(cam.position) - b.pos.distanceTo(cam.position))[0];
      if (t) {
        const o = cam.position.clone();
        const d = t.pos.clone().sub(o).normalize();
        const before = { shots: G.combat.stats.shots, hits: G.combat.stats.hits };
        const hp0 = t.hp;
        const res = G.combat.playerShot(o, d, { damage: 26, range: 300 });
        out.shotTest = {
          target: t.type,
          before, after: { shots: G.combat.stats.shots, hits: G.combat.stats.hits },
          hpBefore: hp0, hpAfter: +t.hp.toFixed(1),
          result: res ? { surface: res.surface, dist: +res.dist.toFixed(1), part: res.part || null } : null,
        };
      }
      out.playerAlive = !!(G.player && G.player.alive);
      out.aliveCount = G.enemies.aliveCount ? G.enemies.aliveCount() : -1;
    } catch (e) { out.err = String(e && e.stack || e); }
    return JSON.stringify(out);
  })()`);
  console.log(diag);

  await sleep(1500);
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/diag-solo.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot: docs/diag-solo.png");
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("DIAG FAIL:", e.message);
  process.exit(1);
});
