# DarkHold Exchange

A ticket exchange with a C++ matching engine, a Node.js gateway (WebSocket + MongoDB escrow ledger) and a React trading UI.

```
React UI (:3000)  <--ws-->  Node gateway (:5000)  <--TCP, binary-->  C++ engine (:9000)
                                   |
                               MongoDB (users, orders, trades)
```

The gateway escrows cash (buys) or tickets (sells) before an order reaches the engine, settles every fill the engine
reports, refunds price improvement, and releases escrow on cancel or expiry (open orders live 10 minutes).
Prices are whole dollars and are capped by the anti-scalping collar (2x `FACE_VALUE`).

## Run it

Prerequisites: Node 18+, a running MongoDB, and a C++17 compiler.

1. **Engine** (from the repo root; run it from wherever you want `engine.wal` to be written)
   ```bash
   g++ -std=c++17 -O2 -o engine cpp-engine/src/*.cpp -Icpp-engine/include            # Linux / macOS
   g++ -std=c++17 -O2 -o engine.exe cpp-engine/src/*.cpp -Icpp-engine/include -lws2_32  # Windows (MinGW)
   ./engine
   ```
2. **Gateway**
   ```bash
   cd backend
   npm install
   cp .env.example .env        # optional: defaults work for a local MongoDB
   npm run seed                # creates demo traders #1001 and #1002 (100,000 cash / 500 tickets each)
   npm start
   ```
3. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev                 # http://localhost:3000
   ```

Open the UI, pick a trader, place orders. Open a second tab as the other trader to trade against yourself.
`GET http://localhost:5000/health` reports database and engine status.

## Notes

- The engine keeps its book in memory. Whenever the gateway (re)connects it re-submits open orders from MongoDB, so
  restarting either side is safe. If you wipe the database (`npm run seed -- --reset`), restart the engine too.
- Configuration lives in `backend/.env` (`MONGO_URI`, `PORT`, `ENGINE_HOST`, `ENGINE_PORT`, `FACE_VALUE`,
  `MAX_ORDER_QUANTITY`). For a remote gateway set `VITE_WS_URL` for the frontend.
- This is a demo: there is no login, any client can register as any trader id. Put real auth (the JWT pieces in
  `backend/controllers` and `backend/middleware` are not wired in) in front of it before exposing it publicly.
