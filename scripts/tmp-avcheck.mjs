// Why is the avatar invisible? Inspect the live object graph.
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

  console.log(
    await c.evaluate(`(() => {
      const G = window.__G;
      const av = window.__MP.avatars;
      const a = av.map.get("p1");
      if (!a) return JSON.stringify({ err: "no avatar p1", ids: [...av.map.keys()] });
      const g = a.body.group;
      let meshes = 0; g.traverse(o => { if (o.isMesh) meshes++; });
      // is the group actually in the scene graph?
      let p = g, chain = [];
      while (p) { chain.push(p.name || p.type); p = p.parent; }
      return JSON.stringify({
        ids: [...av.map.keys()],
        visible: g.visible,
        alive: a.alive,
        pos: g.position.toArray().map(v => +v.toFixed(2)),
        scale: g.scale.toArray().map(v => +v.toFixed(2)),
        meshes,
        snaps: a.snaps.length,
        chain,
        camPos: G.camera.position.toArray().map(v => +v.toFixed(2)),
        camDir: new G.THREE.Vector3(0,0,-1).applyQuaternion(G.camera.quaternion).toArray().map(v=>+v.toFixed(2)),
        sceneChildren: G.scene.children.length,
      });
    })()`),
  );
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
