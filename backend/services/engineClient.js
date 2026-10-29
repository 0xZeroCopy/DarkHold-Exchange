import net from 'net';
import { EventEmitter } from 'events';

const REQUEST_TIMEOUT_MS = 5000;
export const EXPIRY_MS = 600000; // 10 minutes (matches EXPIRY_DURATION in engine.h)

/**
 * 55-byte packed binary Command format (matches C++ struct Command in engine.h):
 * Offset  0..7  (8 B): uint64_t sequenceNumber
 * Offset  8     (1 B): uint8_t  type (1=PLACE, 2=CANCEL, 3=TICK, 4=SNAPSHOT, 5=GET_BALANCE)
 * Offset  9..46 (38 B): Order struct / cancelOrderID
 *   Order struct layout:
 *     9..16  (8 B): uint64_t orderID
 *     17..20 (4 B): uint32_t quantityRemaining
 *     21..24 (4 B): uint32_t price
 *     25     (1 B): uint8_t  isBuy (1=buy, 0=sell)
 *     26..33 (8 B): uint64_t accountID
 *     34..41 (8 B): uint64_t expiresAt
 *     42     (1 B): uint8_t  isMarket (0=limit, 1=market)
 *     43..46 (4 B): uint32_t tickerID
 * Offset 47..54 (8 B): uint64_t now
 */
export function packPlace({ seq = 0, orderId = 0, quantity, price, isBuy, accountId, expiresAt = 0, isMarket = 0, tickerId = 1, now = Date.now() }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(1, 8); // CommandType::PLACE_ORDER
  b.writeBigUInt64LE(BigInt(orderId), 9);
  b.writeUInt32LE(Number(quantity), 17);
  b.writeUInt32LE(Number(price), 21);
  b.writeUInt8(isBuy ? 1 : 0, 25);
  b.writeBigUInt64LE(BigInt(accountId), 26);
  b.writeBigUInt64LE(BigInt(expiresAt), 34);
  b.writeUInt8(isMarket ? 1 : 0, 42);
  b.writeUInt32LE(Number(tickerId), 43);
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}

export function packCancel({ seq = 0, orderId = 0, now = Date.now() }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(2, 8); // CommandType::CANCEL_ORDER
  b.writeBigUInt64LE(BigInt(orderId), 9);
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}

export function packSnapshot({ seq = 0, tickerId = 1, now = Date.now() }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(4, 8); // CommandType::SNAPSHOT
  b.writeUInt32LE(Number(tickerId), 43);
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}

export function packGetBalance({ seq = 0, accountId, tickerId = 1, now = Date.now() }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(5, 8); // CommandType::GET_BALANCE
  b.writeBigUInt64LE(BigInt(accountId), 26);
  b.writeUInt32LE(Number(tickerId), 43);
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}

/**
 * TCP client for the C++ matching engine worker thread queues.
 */
export class EngineClient extends EventEmitter {
  constructor(host = '127.0.0.1', port = 9000) {
    super();
    this.host = host;
    this.port = port;
    this.connected = false;
    this.socket = null;
    this.buffer = '';
    this.seq = 0;
    this.pending = null;
    this.queue = [];
    this.warned = false;
    this.connect();
  }

  nextSeq() {
    return ++this.seq;
  }

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
      this.processQueue();
    });

    socket.on('data', (chunk) => this.onData(chunk));

    socket.on('error', (err) => {
      if (!this.warned) {
        console.error(`⚠️  Engine socket error: ${err.code || err.message} (is C++ engine running on ${this.host}:${this.port}?)`);
        this.warned = true;
      }
    });

    socket.on('close', () => {
      if (this.connected) console.log('🔴 Engine connection closed. Reconnecting in 2s...');
      this.connected = false;
      this.emit('disconnected');
      this.failPending(new Error('Engine connection closed'));
      setTimeout(() => this.connect(), 2000);
    });

    socket.connect(this.port, this.host);
  }

  processQueue() {
    if (!this.connected || this.pending || this.queue.length === 0) return;
    const req = this.queue.shift();
    this.dispatch(req);
  }

  dispatch(req) {
    const timer = setTimeout(() => {
      req.reject(new Error('Engine request timed out.'));
      this.pending = null;
      this.processQueue();
    }, REQUEST_TIMEOUT_MS);

    this.pending = {
      resolve: (val) => {
        clearTimeout(timer);
        this.pending = null;
        req.resolve(val);
        this.processQueue();
      },
      reject: (err) => {
        clearTimeout(timer);
        this.pending = null;
        req.reject(err);
        this.processQueue();
      },
      lines: [],
      expectTag: req.expectTag,
      expectCount: req.expectCount,
      seen: 0,
    };

    this.socket.write(Buffer.concat(req.frames));
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // keep incomplete trailing line

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // Handle pending request/response correlation
      if (this.pending) {
        this.pending.lines.push(line);

        // Errors terminate early
        if (line[0] === 'E') {
          const { reject } = this.pending;
          reject(new Error(line.slice(2).trim()));
          continue;
        }

        // 'X' marks cancel or sentinel response; 'B' marks balance; 'D' marks depth
        const isDone =
          (this.pending.expectTag === 'X' && line[0] === 'X' && ++this.pending.seen >= this.pending.expectCount) ||
          (this.pending.expectTag === 'B' && line[0] === 'B') ||
          (this.pending.expectTag === 'D' && line[0] === 'D');

        if (isDone) {
          const { resolve, lines: out } = this.pending;
          resolve(out);
        }
      }
    }
  }

  failPending(err) {
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(err);
    }
    while (this.queue.length > 0) {
      const req = this.queue.shift();
      req.reject(err);
    }
  }

  /**
   * Send frames and wait for expected response lines.
   */
  request(frames, expectTag = 'X', expectCount = 1) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('Matching engine is offline.'));
      this.queue.push({ frames, expectTag, expectCount, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Submit an order to the C++ worker thread queue over TCP.
   * Sends the PLACE_ORDER command followed by an in-order sentinel CANCEL_ORDER
   * directed to the same worker and engine queue to collect fills.
   */
  async submitOrder({ orderId = 0, isBuy, price, quantity, accountId, tickerId = 1, isMarket = 0 }) {
    const now = Date.now();
    const workerId = Number(accountId) & 7;
    // Sentinel cancel ID with matching workerId in lowest 3 bits ensures in-order traversal
    // through the worker's queue and engine queue behind the PLACE_ORDER job.
    const sentinelOrderId = (9999999n << 3n) | BigInt(workerId);

    const frames = [
      packPlace({
        seq: this.nextSeq(),
        orderId,
        quantity,
        price,
        isBuy,
        accountId,
        expiresAt: 0,
        isMarket,
        tickerId,
        now,
      }),
      packCancel({ seq: this.nextSeq(), orderId: sentinelOrderId, now }),
    ];

    const lines = await this.request(frames, 'X', 1);
    // Parse any fill lines (F <tradeID> <price> <qty>)
    const fills = lines
      .filter((l) => l[0] === 'F')
      .map((l) => {
        const [, tradeId, matchPrice, matchQty] = l.split(' ').map(Number);
        return { tradeId, price: matchPrice, quantity: matchQty };
      });

    return { fills };
  }

  /**
   * Cancel an order in the C++ engine over TCP.
   */
  async cancelOrder(orderId) {
    const frames = [packCancel({ seq: this.nextSeq(), orderId: Number(orderId), now: Date.now() })];
    const lines = await this.request(frames, 'X', 1);
    const line = lines.find((l) => l[0] === 'X');
    return line ? line.includes('ok') : false;
  }

  /**
   * Query account balance from the C++ worker thread managing this account.
   */
  async getBalance(accountId, tickerId = 1) {
    const frames = [packGetBalance({ seq: this.nextSeq(), accountId: Number(accountId), tickerId, now: Date.now() })];
    const lines = await this.request(frames, 'B', 1);
    const bLine = lines.find((l) => l[0] === 'B');
    if (!bLine) return null;

    // Format: B <accountID> <availableCash> <heldCash> <availableTickets> <heldTickets>
    const [, accId, availableCash, heldCash, availableTickets, heldTickets] = bLine.split(' ').map(Number);
    return {
      accountId: accId,
      availableCash,
      heldCash,
      availableTickets,
      heldTickets,
    };
  }

  /**
   * Query depth snapshot from C++ engine.
   */
  async getDepth(tickerId = 1) {
    const frames = [packSnapshot({ seq: this.nextSeq(), tickerId, now: Date.now() })];
    const lines = await this.request(frames, 'D', 1);
    const dLine = lines.find((l) => l[0] === 'D');
    if (!dLine) return { lastPrice: null, bids: [], asks: [] };

    // Format: D <lastPrice> <bidsCount> <asksCount>
    const [, lastPrice] = dLine.split(' ').map(Number);
    return {
      lastPrice: lastPrice === 0 ? null : lastPrice,
      bids: [],
      asks: [],
    };
  }
}
