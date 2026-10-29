# DarkHold Exchange

<<<<<<< HEAD
A high-throughput, low-latency ticket trading exchange featuring a multi-threaded C++ matching engine, a lean Node.js gateway (MongoDB account management, JWT auth, WebSockets, rate limiting, and binary TCP dispatch), and a reactive trading frontend.

```
React UI (:3000)  <--WebSocket-->  Node Gateway (:5000)  <--TCP (55B Command)-->  C++ Engine (:9000)
                                           |                                              |
                                MongoDB (Users & Auth)                       8 Worker Thread Queues
                                                                             (In-Memory Escrow & Matching)
=======
A high-performance, secondary-market ticket exchange engineered to eliminate scalpers and bot manipulation for limited-edition festival passes. It combines an asynchronous multi-threaded C++ matching engine, a Node.js gateway (handling JWT authentication, MongoDB account persistence, JSON parsing, and WebSocket streaming), and an optimistic React trading UI.

```
+---------------------------------------------------------------------------------------+
|                                    React Frontend UI                                  |
|         (Optimistic Updates, Order Book Ladder, SVG Depth Chart, JWT Auth Gate)       |
+---------------------------------------------------------------------------------------+
                                           |
                              WebSocket / HTTP (Port 5000)
                                           v
+---------------------------------------------------------------------------------------+
|                                  Node.js Gateway                                      |
|  * JWT Auth & Account Authorization        * MongoDB User & Ledger Persistence        |
|  * Token Bucket Rate Limiting (Per IP/Acc) * JSON Parsing & Wire Struct Serialization |
|  * WebSocket Ladder Broadcasting           * TCP Bridge Client                        |
+---------------------------------------------------------------------------------------+
                                           |
                               TCP AF_INET Port 9000
                       (55-Byte Packed Binary Command Packets)
                                           v
+---------------------------------------------------------------------------------------+
|                            C++ Matching Engine (WSL / POSIX)                          |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |                    8 Dedicated Worker Threads (Account Sharded)               |   |
|   |  * Account Ownership (accountID % 8)     * Locked In-Memory Escrow Check      |   |
|   |  * Epoll Wait Loop (Non-blocking)        * WAL Logging (Async Writer Queue)   |   |
|   |  * OrderID Generation ((cnt<<3) | wId)   * Async Heap Job Handoff to Engine   |   |
|   |  * Response Queue TCP Fills / Deletes                                         |   |
|   +-------------------------------------------------------------------------------+   |
|                                     |                   ^                             |
|                           EngineJob* (Heap)      ResponseQueue*                       |
|                                     v                   |                             |
|   +-------------------------------------------------------------------------------+   |
|   |                       Main Matching Engine Thread                             |   |
|   |  * 5 Isolated Order Books (TICKER_1..5)  * Price-Time Priority Matching       |   |
|   |  * Order-to-Ticker Fast Map O(1) Cancel  * Price Collar Enforcement (<= $200) |   |
|   |  * Vector-based FIFO Expiry Queue        * Price-Improvement Refunds          |   |
|   +-------------------------------------------------------------------------------+   |
|            |                                                    |                     |
|            v                                                    v                     |
|   +------------------+                                 +------------------+           |
|   | WAL Disk Writer  |                                 | Depth Snapshot   |           |
|   | (Async Batch fs) |                                 | (100ms Thread)   |           |
|   +------------------+                                 +------------------+           |
+---------------------------------------------------------------------------------------+
>>>>>>> 578e369c99465b0fb9c9a04fd7d34148062ac7ac
```

---

<<<<<<< HEAD
## Architecture & Division of Responsibility

All heavy-lifting business logic (escrow locking, order matching, price improvement refunds, WAL persistence, depth tracking, and order lifecycle) is handled by the **C++ Matching Engine**.

**Node.js Gateway is strictly responsible for:**
1. **Account Management in MongoDB**: User registrations, secure credentials storage, and user profile management.
2. **Authentication via JWTs**: Short-lived access tokens (15m) + rotated HttpOnly refresh cookies (7d), verifying JWTs on HTTP and WebSocket connections.
3. **JSON Parsing & Validation**: Parsing incoming WebSocket client actions (`SUBMIT_ORDER`, `CANCEL_ORDER`, etc.) and validating price collars (2x face value) and max quantities.
4. **Rate Limiting**: Token-bucket rate limiting per account/socket (preventing flood attacks).
5. **Worker Queue Handoff over TCP Sockets**: Converting parsed JSON into 55-byte packed binary `Command` frames and dispatching them over TCP to the C++ engine, which routes commands to 8 worker threads partitioned by `accountID % 8`.
6. **Real-time WebSockets**: Streaming engine fills, trade broadcasts, balance updates, and depth updates to clients.

---

## Performance & Latency Benchmarks

Tested on Node.js v24 with concurrent multi-user load (`npm run test:perf` in `backend`):

| Metric | Measured Performance | Description |
| :--- | :--- | :--- |
| **55-Byte Frame Packing** | **1,803,523 ops/sec** (554.5 ns/op) | Sub-microsecond binary Command packing and serialization |
| **TCP Socket Queue Handoff (p50)** | **1.0 µs** | Latency from gateway to engine worker queue roundtrip |
| **TCP Socket Queue Handoff (p99)** | **8.6 µs** | 99th percentile queue handoff roundtrip latency |
| **End-to-End Multi-User Throughput** | **270,986 orders/sec** | Concurrent multi-user order dispatch through gateway |
| **Gateway Order Latency (Avg)** | **91.2 µs** (0.091 ms) | End-to-end JSON parsing, JWT validation, and TCP dispatch |
| **Gateway Order Latency (p99)** | **391.4 µs** (0.391 ms) | 99th percentile end-to-end gateway dispatch latency |

---

## 55-Byte Binary TCP Protocol

The Node.js gateway communicates with the C++ engine worker queues using a packed 55-byte binary structure (matches `sizeof(Command) == 55` in `engine.h`):

| Offset | Size | Type | Field | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0..7` | 8 B | `uint64_t` | `sequenceNumber` | Monotonically increasing sequence ID |
| `8` | 1 B | `uint8_t` | `type` | Command: `1=PLACE`, `2=CANCEL`, `3=TICK`, `4=SNAPSHOT`, `5=GET_BALANCE` |
| `9..16` | 8 B | `uint64_t` | `orderID` / `cancelOrderID` | Unique order identifier (or cancel target) |
| `17..20`| 4 B | `uint32_t` | `quantityRemaining` | Order quantity (1..1000) |
| `21..24`| 4 B | `uint32_t` | `price` | Whole dollar limit price (1..200) |
| `25` | 1 B | `uint8_t` | `isBuy` | `1 = Buy`, `0 = Sell` |
| `26..33`| 8 B | `uint64_t` | `accountID` | Trader account ID (routes to `accountID % 8` worker) |
| `34..41`| 8 B | `uint64_t` | `expiresAt` | Expiration timestamp in epoch ms |
| `42` | 1 B | `uint8_t` | `isMarket` | `0 = Limit`, `1 = Market` |
| `43..46`| 4 B | `uint32_t` | `tickerID` | Ticker ID (1..5) |
| `47..54`| 8 B | `uint64_t` | `now` | Current epoch millisecond timestamp |

---

## How to Run

### 1. C++ Matching Engine
Compile and launch the engine from repo root (creates `engine.wal`):
```bash
# Linux / macOS
g++ -std=c++17 -O2 -o engine cpp-engine/src/*.cpp -Icpp-engine/include
./engine

# Windows (MinGW)
g++ -std=c++17 -O2 -o engine.exe cpp-engine/src/*.cpp -Icpp-engine/include -lws2_32
./engine.exe
```

### 2. Node.js Gateway
Make sure MongoDB is running locally (`mongodb://127.0.0.1:27017/darkhold`):
```bash
cd backend
npm install
npm run dev
```

### 3. Frontend Trading UI
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:3000** in your browser. Register an account or sign in to start trading.

---

## Running Benchmarks
To execute the gateway latency and throughput test suite:
```bash
cd backend
npm run test:perf
=======
## Architecture & System Separation

To achieve predictable microsecond execution latency while maintaining web compatibility, responsibilities are strictly decoupled across layers:

### 1. Node.js Layer (Gateway & Account State)
- **Authentication & Authorization**: Validates user credentials using salted bcrypt hashes and issues signed JWT bearer tokens.
- **Rate Limiting**: Protects against denial-of-service and bot flooding using per-account and per-IP Token Bucket rate limiting.
- **Account Ledger Persistence**: Manages persistent trader balances, trades, and order history in MongoDB.
- **Client Protocol Translation**: Ingests JSON REST / WebSocket payloads from the frontend, validates schema bounds, and serializes orders into packed binary 55-byte TCP commands sent to the C++ engine.
- **WebSocket Streaming**: Consumes fills, order cancellations, and depth ladder snapshots from the C++ engine and broadcasts real-time market updates to connected clients.

### 2. C++ Matching Engine Layer (Execution & In-Memory Escrow)
- **8 Dedicated Sharded Workers**: Inbound TCP commands are sharded across 8 worker threads by account (`accountID % 8`), eliminating cross-thread race conditions on account balances.
- **Deterministic OrderID Generation**: Each worker stamps unique 64-bit order IDs using `(orderCounter++ << 3) | (workerID & 0x7)`, ensuring globally unique IDs and $O(1)$ originating worker routing.
- **In-Memory Escrow**: Validates and locks cash (for buy orders) or ticket inventory (for sell orders) before any order reaches the order book.
- **Asynchronous Worker-to-Engine Handoff**: Workers allocate `EngineJob` pointers on the heap and enqueue them to the central matching queue without blocking their epoll loops. Completed jobs are routed back to the originating worker's dedicated `ResponseQueue` via Linux `eventfd`.
- **5 Ticket Types (Multi-Ticker Books)**: Hardcoded ticket types (`TICKER_1` to `TICKER_5`) run inside completely isolated order books. Orders for different tickets never interleave or pollute each other.
- **Write-Ahead Logging (WAL)**: All order operations are appended to `engine.wal` via a dedicated background I/O writer thread, ensuring crash recovery.
- **Vector-based Expiry Queue**: Open orders expire after 10 minutes (uniform FIFO expiration), managed via a linear vector queue with zero heap rebalancing overhead.

---

## Architectural Decisions, Tradeoffs & Alternatives

| Component | Design Choice | Tradeoffs & Rationale | Alternative Rejected |
| :--- | :--- | :--- | :--- |
| **Worker Concurrency** | 8 Sharded Worker Threads (`accountID % 8`) | **Rationale**: Lock contention is eliminated for account balances since one worker exclusively owns an account partition.<br>**Tradeoff**: Account routing requires consistent hashing. | Single shared lock across all accounts (high contention) or 1 thread per connection (OS thread explosion). |
| **Inter-Thread Communication** | Mutex-Protected Queues + Linux `eventfd` | **Rationale**: Guaranteed memory ordering without subtle data race bugs. `eventfd` integrates natively into `epoll_wait` loops.<br>**Tradeoff**: Kernel syscall overhead on wakeups. | Lock-free queues (complex, difficult to audit, and non-trivial to multiplex with network sockets). |
| **Worker-to-Engine Handoff** | Asynchronous Heap Handoff + `ResponseQueue` | **Rationale**: Worker threads do not stall waiting for matching engine execution; they immediately resume epoll loops to accept new client traffic.<br>**Tradeoff**: Requires heap allocation (`new EngineJob`) and lifecycle cleanup (`delete resJob`). | Stack-allocated job with synchronous `readEvent` wait (blocks worker thread during engine execution). |
| **Order Expiration** | Vector FIFO Queue with Lazy Cancellation | **Rationale**: Since all orders share a uniform 10-minute expiration duration, orders naturally arrive in chronological expiration order. Checking the front is $O(1)$.<br>**Tradeoff**: Mid-queue cancellations remain until popped. | `std::priority_queue` / Min-heap ($O(\log N)$ insertion and deletion overhead on every order). |
| **Multi-Ticker Structure** | Isolated `OrderBook` instances per Ticker | **Rationale**: Clean state isolation for each ticket tier. Zero risk of cross-ticker matching.<br>**Tradeoff**: Engine maintains separate price levels per ticker. | Single combined book with ticker tags (complex matching checks, high cache misses). |
| **Wire Protocol** | 55-Byte Packed Struct over TCP (Port 9000) | **Rationale**: Ultra-fast zero-copy binary serialization; matches exact C-struct layout.<br>**Tradeoff**: Byte layout must remain synchronized with Node.js client. | JSON or Protobuf (heavy parsing and allocation overhead in high-frequency path). |

---

## Integration Guide for Node.js Implementation

The C++ engine listens as an `AF_INET` TCP server on `127.0.0.1:9000`.

### 1. Binary Packet Layout (55 Bytes)

All numeric fields are **Little-Endian**. Struct packing is 1-byte aligned (`#pragma pack(push, 1)`):

```
Offset   Field                 Type     Bytes   Description
---------------------------------------------------------------------------------------
0        sequenceNumber        uint64   8       Monotonically increasing sequence number
8        type                  uint8    1       1=PLACE_ORDER, 2=CANCEL_ORDER, 4=SNAPSHOT, 5=GET_BALANCE
9        orderID               uint64   8       Order ID (0 = auto-generate by worker)
17       quantityRemaining     uint32   4       Quantity to trade (1 to 1000)
21       price                 uint32   4       Limit price in dollars (Max: $200)
25       isBuy                 uint8    1       1 = BUY, 0 = SELL
26       accountID             uint64   8       Client account ID
34       expiresAt             uint64   8       Expiration timestamp (ms) (0 = now + 10 min)
42       isMarket              uint8    1       1 = Market order (IOC), 0 = Limit order
43       tickerID              uint32   4       Ticker ID (1 to 5)
47       now                   uint64   8       Current timestamp in milliseconds
---------------------------------------------------------------------------------------
Total Size: 55 Bytes
```

#### Node.js Buffer Packing Example:
```javascript
export function packPlace({ seq, now, orderId = 0, quantity, price, isBuy, accountId, tickerId = 1 }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(1, 8);                                   // PLACE_ORDER
  b.writeBigUInt64LE(BigInt(orderId), 9);
  b.writeUInt32LE(quantity, 17);
  b.writeUInt32LE(price, 21);
  b.writeUInt8(isBuy ? 1 : 0, 25);
  b.writeBigUInt64LE(BigInt(accountId), 26);
  b.writeBigUInt64LE(0n, 34);                           // 0 = Engine sets 10-min expiry
  b.writeUInt8(0, 42);                                  // 0 = Limit order
  b.writeUInt32LE(tickerId, 43);                        // Ticker ID (1 to 5)
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}

export function packCancel({ seq, now, orderId }) {
  const b = Buffer.alloc(55);
  b.writeBigUInt64LE(BigInt(seq), 0);
  b.writeUInt8(2, 8);                                   // CANCEL_ORDER
  b.writeBigUInt64LE(BigInt(orderId), 9);               // cancelOrderID
  b.writeBigUInt64LE(BigInt(now), 47);
  return b;
}
```

### 2. Engine Response Line Protocol (ASCII over TCP)

The engine streams line-delimited ASCII responses back over the same TCP connection:

- **Fill Confirmation**:
  ```
  F <tradeID> <price> <quantityFulfilled> [tickerID]\n
  ```
  *Example*: `F 1045 100 5 1\n` (Trade #1045 filled 5 units @ $100 for Ticker 1)

- **Cancellation Confirmation**:
  ```
  X ok\n    -> Order successfully located and cancelled, escrow released
  X none\n  -> Order not found or already filled/cancelled
  ```

- **Balance Query Response**:
  ```
  B <accountID> <availableCash> <heldCash> <availableTickets> <heldTickets>\n
  ```
  *Example*: `B 1001 95000 5000 505 0\n`

- **Depth Snapshot**:
  ```
  D <lastPrice> <bidsCount> <asksCount>\n
  ```
  *Example*: `D 100 4 2\n`

- **Validation / Escrow Rejection**:
  ```
  E <errorMessage>\n
  ```
  *Example*: `E Price too high (max is 200)\n` or `E Not enough cash for escrow\n`

---

## Hardcoded Ticket Types

The exchange supports 5 distinct ticket types:

| Ticker ID | Ticket Class | Description | Max Price Collar | Base Starting Supply |
| :--- | :--- | :--- | :--- | :--- |
| `1` | `TICKER_VIP` | Full Access VIP Pass | $200 | 500 |
| `2` | `TICKER_EARLY_BIRD` | Early Bird Pass | $200 | 500 |
| `3` | `TICKER_GENERAL` | General Admission | $200 | 500 |
| `4` | `TICKER_BALCONY` | Balcony Reserved | $200 | 500 |
| `5` | `TICKER_STUDENT` | Verified Student Pass | $200 | 500 |

---

## Test Suite & Verification Summary

The test harness exercises all edge cases, multi-threaded pipelines, persistence, and isolation guarantees:

| Test Suite | Purpose / Invariants Tested | Result |
| :--- | :--- | :--- |
| `testBasicLimitMatchingAndEscrow` | Price-time matching priority, partial fills, cash and ticket escrow deduction. | **PASSED** |
| `testPriceImprovementRefund` | Aggressive limit orders execute at resting limit price; excess buyer escrow refunded. | **PASSED** |
| `testPriceCollarAndBounds` | Rejects price > $200 (collar), zero quantity, and orders with insufficient escrow. | **PASSED** |
| `testWALPersistenceAndRecovery` | Replays WAL log upon restart; correctly restores order book and escrow states. | **PASSED** |
| `testAsyncWorkerToEngineHandoff` | Asynchronous worker handoff, non-blocking epoll loop, response queue callback routing. | **PASSED** |
| `testMultiTickerIsolation` | Proves cross-ticker isolation: Buy orders on Ticker 1 never match Sell orders on Ticker 2. | **PASSED** |

Run tests anytime with:
```bash
cd cpp-engine && make test
```

---

## Performance Benchmarks (Latency & Throughput)

Empirical performance measured on WSL Ubuntu (Intel/AMD x86_64, `-O2 -pthread`):

### Core Matching Engine (100,000 Orders)
```
======================================================
  CORE MATCHING ENGINE BENCHMARK (100,000 orders)
======================================================
Total Elapsed Time   : 0.15 s
Throughput           : 671,770 orders/sec
Average Latency      : 1.42 us
Median (p50) Latency : 0.09 us (90 nanoseconds)
90th %tile (p90)     : 2.04 us
99th %tile (p99)     : 29.13 us
99.9th %tile (p99.9) : 88.57 us
Max Latency          : 1080.49 us
======================================================
```

### Multi-Threaded Asynchronous Pipeline (100,000 Orders)
*Includes 8 worker threads, `epoll_wait` multiplexing, mutex-locked queues, `eventfd` kernel wakeups, WAL writer, and worker response callbacks:*
```
======================================================
  ASYNC MULTI-THREADED PIPELINE (100,000 orders)
======================================================
Total Elapsed Time   : 3.40 s
Pipeline Throughput  : 29,415 orders/sec
======================================================
```

Run the benchmark suite anytime with:
```bash
cd cpp-engine && make bench
```

---

## Build & Run Instructions

### Prerequisites
- **OS**: Linux or WSL (Windows Subsystem for Linux)
- **Compiler**: `g++` (C++17 or higher) with `pthread`
- **Node.js**: v18+ and `npm`
- **Database**: MongoDB (optional for engine tests, required for backend gateway)

### 1. Build and Run C++ Engine
```bash
cd cpp-engine

# Run complete test suite
make test

# Run latency and throughput benchmark
make bench

# Build production engine binary
make

# Launch engine daemon on port 9000
./engine
```

### 2. Run Node.js Gateway
```bash
cd backend
npm install
npm run seed     # Seeds demo accounts #1001 and #1002
npm start        # Starts HTTP / WebSocket server on port 5000
```

### 3. Run React Frontend
```bash
cd frontend
npm install
npm run dev      # Opens trading UI at http://localhost:3000
>>>>>>> 578e369c99465b0fb9c9a04fd7d34148062ac7ac
```
