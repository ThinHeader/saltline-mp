// Verifies that a quiet lobby survives: host + guest join, then stay silent
// for 70s (no app-level messages at all) and must still be in the room.
import { WebSocket } from "ws";

const PORT = process.env.PORT || 8080;
const IDLE_MS = 70_000;

function client(tag) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const msgs = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  const ready = new Promise((r) => ws.on("open", r));
  async function next(t, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = msgs.findIndex((m) => m.t === t);
      if (i >= 0) return msgs.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${tag}: timeout waiting for "${t}"`);
  }
  return {
    ws,
    ready,
    next,
    send: (o) => ws.send(JSON.stringify(o)),
    close: () => ws.close(),
  };
}

const out = [];
const check = (name, ok, extra = "") => {
  out.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const A = client("host");
await A.ready;
A.send({ t: "host", name: "Host", seed: 4207 });
const joined = await A.next("joined");
const code = joined.room;
check("建房成功", !!code, `room=${code}`);

const B = client("guest");
await B.ready;
B.send({ t: "join", code, name: "Guest", seed: 4207 });
const j2 = await B.next("joined");
check("加入成功", j2.room === code && !j2.host, `room=${j2.room}`);

const room2 = await A.next("room").then(() => A.next("room")).catch(() => null);
const n = room2 ? room2.players.length : -1;
check("房主看到 2 人", n === 2, `n=${n}`);

console.log(`\n… 双方静默 ${IDLE_MS / 1000}s（不发任何消息，模拟大厅等待）…\n`);
await new Promise((r) => setTimeout(r, IDLE_MS));

check("静默 70s 后房主仍连着", A.ws.readyState === 1, `state=${A.ws.readyState}`);
check("静默 70s 后加入者仍连着", B.ws.readyState === 1, `state=${B.ws.readyState}`);

A.send({ t: "start" });
const begin = await A.next("begin", 5000).catch(() => null);
check(
  "静默后仍能开赛",
  !!begin && begin.order.length === 2,
  begin ? `order=${begin.order}` : "no begin",
);

const fail = out.filter((r) => !r.ok).length;
console.log(`\n${out.length - fail}/${out.length} checks passed`);
A.close();
B.close();
setTimeout(() => process.exit(fail ? 1 : 0), 300);
