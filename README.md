# DarkHold Exchange

A high-throughput, low-latency ticket trading exchange featuring a multi-threaded C++ matching engine, a lean Node.js gateway (MongoDB account management, JWT auth, WebSockets, rate limiting, and binary TCP dispatch), and a reactive trading frontend.

```
React UI (:3000)  <--WebSocket-->  Node Gateway (:5000)  <--TCP (55B Command)-->  C++ Engine (:9000)
                                           |                                              |
                                MongoDB (Users & Auth)                       8 Worker Thread Queues
                                                                             (In-Memory Escrow & Matching)
```

---

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
```
