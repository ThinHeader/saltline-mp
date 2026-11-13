// Saltline LAN multiplayer — standalone server.
//
// Serves the built game (dist/) and the room WebSocket on ONE port (default 8080),
// so players only need to open http://<host-ip>:8080 and share a 4-letter room code.
//
//   node server/standalone.mjs            # http://0.0.0.0:8080
//   PORT=9000 node server/standalone.mjs
//
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { attachRoomServer, lanAddresses } from "./rooms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "dist");
const PORT = +(process.env.PORT || 8080);

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("[saltline] 未找到 dist/index.html，请先运行: npm run build");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.join(
    ROOT,
    path.normalize(rel).replace(/^(\.\.[/\\])+/, ""),
  );
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      const idx = path.join(ROOT, "index.html");
      fs.readFile(idx, (e2, buf) => {
        if (e2) return res.writeHead(404).end("not found");
        res.writeHead(200, { "content-type": MIME[".html"] }).end(buf);
      });
      return;
    }
    res.writeHead(200, {
      "content-type":
        MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    fs.createReadStream(full).pipe(res);
  });
});

const wss = new WebSocketServer({ server });
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
attachRoomServer(wss, { log: (line) => console.log(`[${stamp()}] ${line}`) });

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanAddresses();
  console.log("");
  console.log("  ███ SALTLINE — 局域网对战服务已启动 ███");
  console.log("");
  console.log(`  本机打开:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  同局域网玩家打开: http://${ip}:${PORT}`);
  if (!ips.length) console.log("  (未检测到局域网 IP，请检查网络连接)");
  console.log("");
  console.log("  玩法: 一台机器点 Multiplayer → Host a room 拿到 4 位房间码，");
  console.log(
    "        其他人在同一页面输入码 Join room，房主点 Start match 开赛。",
  );
  console.log("  组队规模 2–8 人，先到 15 杀获胜。Ctrl+C 停止服务。");
  console.log("");
});
