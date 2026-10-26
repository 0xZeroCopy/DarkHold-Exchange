import net from 'net';
import { EventEmitter } from 'events';

const REQUEST_TIMEOUT_MS = 3000;
export const EXPIRY_MS = 600000; // matches EXPIRY_DURATION in cpp-engine/include/engine.h

// Packed 51-byte Command (see cpp-engine/include/engine.h):
//  0 seq u64 | 8 type u8 | 9..42 payload (34 bytes) | 43 now u64
//  PLACE payload: orderID u64, qty u32, price u32, isBuy u8, accountID u64, expiresAt u64, isMarket u8
//  CANCEL payload: cancelOrderID u64
export function packPlace({ seq, now, orderId, quantity, price, isBuy, accountId, expiresAt }) {
  const b = Buffer.alloc(51);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(1, 8);
  b.writeBigUInt64LE(BigInt(orderId), 9);
  b.writeUInt32LE(quantity, 17);
  b.writeUInt32LE(price, 21);
  b.writeUInt8(isBuy ? 1 : 0, 25);
  b.writeBigUInt64LE(BigInt(accountId), 26);
  b.writeBigUInt64LE(BigInt(expiresAt), 34);
  b.writeUInt8(0, 42);
  b.writeBigUInt64LE(BigInt(now), 43);
  return b;
}

export function packCancel({ seq, now, orderId }) {
  const b = Buffer.alloc(51);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(2, 8);
  b.writeBigUInt64LE(BigInt(orderId), 9);
  b.writeBigUInt64LE(BigInt(now), 43);
  return b;
}

/**
 * TCP client for the C++ matching engine.
 * The engine only replies with "F <tradeId> <price> <qty>" per fill and "X ok|none" per cancel,
 * so a place is followed by a cancel of the never-used order id 0: its "X none" reply marks the
 * end of that order's fills. Callers must issue one request at a time (the exchange lock does).
 */
export class EngineClient extends EventEmitter {
  constructor(host, port) {
    super();
    this.host = host;
    this.port = port;
    this.connected = false;
    this.pending = null;
    this.buffer = '';
    this.seq = 0;
    this.warned = false;
    this.connect();
  }

  nextSeq() { return this.seq++; }

  connect() {
    const socket = new net.Socket();
    this.socket = socket;
    socket.setNoDelay(true);

    socket.on('connect', () => {
      this.connected = true;
      this.warned = false;
      this.buffer = '';
      console.log(`🟢 Connected to C++ matching engine on ${this.host}:${this.port}`);
      this.emit('connected');
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => {
      if (!this.warned) {
        console.error(`⚠️  Engine socket error: ${err.code || err.message} (is the engine running on ${this.host}:${this.port}?)`);
        this.warned = true;
      }
    });
    socket.on('close', () => {
      if (this.connected) console.log('🔴 Engine connection closed. Reconnecting...');
      this.connected = false;
      this.failPending(new Error('Engine connection closed'));
      setTimeout(() => this.connect(), 2000);
    });
    socket.connect(this.port, this.host);
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // keep any partial trailing line
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !this.pending) continue;
      this.pending.lines.push(line);
      if (line[0] === 'X' && ++this.pending.xSeen >= this.pending.expectX) {
        const { resolve, lines: out, timer } = this.pending;
        clearTimeout(timer);
        this.pending = null;
        resolve(out);
      }
    }
  }

  failPending(err) {
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    reject(err);
  }

  /** Send frames, resolve with all reply lines once `expectX` "X ..." replies have arrived. */
  request(frames, expectX) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('Matching engine is offline'));
      if (this.pending) return reject(new Error('Engine request already in flight'));
      const timer = setTimeout(() => {
        this.failPending(new Error('Engine request timed out'));
        this.socket.destroy(); // forces reconnect + resync
      }, REQUEST_TIMEOUT_MS);
      this.pending = { resolve, reject, timer, lines: [], xSeen: 0, expectX };
      this.socket.write(Buffer.concat(frames));
    });
  }
}
