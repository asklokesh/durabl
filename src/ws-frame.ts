// Minimal RFC 6455 server helpers (text frames only). No external deps.
// SECURITY-REVIEW: upgrade only on localhost-bound UI server; no auth layer in v1.

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers.upgrade?.toLowerCase();
  const conn = req.headers.connection?.toLowerCase() ?? "";
  return upgrade === "websocket" && conn.includes("upgrade");
}

/** Complete the HTTP → WebSocket handshake on `socket`. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex): void {
  const key = req.headers["sec-websocket-key"];
  if (!key || typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  socket.removeAllListeners("error");
}

/** Send one UTF-8 text frame (unmasked, server → client). */
export function sendWsText(socket: Duplex, payload: string): void {
  const data = Buffer.from(payload, "utf8");
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!socket.destroyed && socket.writable) socket.write(Buffer.concat([header, data]));
}

export function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = reason.slice(0, 120);
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}
