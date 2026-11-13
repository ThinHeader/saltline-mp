// Saltline LAN multiplayer — room server only (dev mode).
// Use this together with `npm run dev` while editing the source:
//   terminal 1: npm run dev      (game on http://<ip>:5173)
//   terminal 2: npm run mp       (room server on port 8765)
//
// For playing without the dev server, use `npm run lan` (single port, built game).
import { WebSocketServer } from "ws";
import { attachRoomServer, lanAddresses } from "./rooms.mjs";

const PORT = +(process.env.PORT || 8765);
const wss = new WebSocketServer({ port: PORT });
attachRoomServer(wss);

const addrs = lanAddresses();
console.log(`[saltline-mp] room server on port ${PORT}`);
console.log(`[saltline-mp] LAN addresses: ${addrs.length ? addrs.join(", ") : "(none found)"}`);
console.log(`[saltline-mp] players open the game at http://<host-ip>:5173 and join with a room code`);
