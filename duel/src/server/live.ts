import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FriendBook } from './friends.js';
import { FRIEND_CODE, authorized, readCookie, WHO_COOKIE } from './session.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface LiveClient {
  session: string;
  send(text: string): void;
}

/** Polling still works when this socket is down. The worker uses the Durable Object hibernation API instead. */
export function attachLive(server: Server, book: FriendBook, passcode?: string): void {
  const rooms = new Map<string, Set<LiveClient>>();
  book.onChange = (code) => {
    const room = rooms.get(code);
    if (!room) return;
    for (const client of room) {
      void book.payloadFor(code, client.session).then((seated) => {
        if (seated) client.send(JSON.stringify(seated.payload));
      });
    }
  };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/api\/matches\/([^/]+)\/live$/.exec(url.pathname);
    const code = match?.[1] ?? '';
    if (!FRIEND_CODE.test(code) && !/^[0-9a-f-]{36}$/i.test(code)) return;
    void accept(req, socket, head, code, book, rooms, passcode);
  });
}

async function accept(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  code: string,
  book: FriendBook,
  rooms: Map<string, Set<LiveClient>>,
  passcode?: string,
): Promise<void> {
  if (passcode && !(await authorized(req.headers.cookie, passcode))) {
    socket.destroy();
    return;
  }
  const session = readCookie(req.headers.cookie, WHO_COOKIE);
  const key = req.headers['sec-websocket-key'];
  if (!session || typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const seated = await book.payloadFor(code, session);
  if (!seated) {
    socket.destroy();
    return;
  }
  const acceptKey = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
  );
  if (head.length > 0) socket.unshift(head);
  const client: LiveClient = {
    session,
    send(text) {
      if (socket.writable) writeText(socket, text);
    },
  };
  const room = rooms.get(code) ?? new Set<LiveClient>();
  room.add(client);
  rooms.set(code, room);
  client.send(JSON.stringify(seated.payload));
  socket.on('close', () => {
    room.delete(client);
  });
  socket.on('error', () => {
    room.delete(client);
  });
}

function writeText(socket: Duplex, text: string): void {
  const data = Buffer.from(text);
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
  socket.write(Buffer.concat([header, data]));
}
