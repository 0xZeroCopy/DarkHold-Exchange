#include "engine.h"
#include <iostream>
#include <cstring>
#include <string>
#include <fstream>

#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <unistd.h>

static bool readExact(int fd, char* buf, size_t n) {
    size_t got = 0;
    while (got < n) {
        int r = recv(fd, buf + got, static_cast<int>(n - got), 0);
        if (r <= 0) return false;
        got += static_cast<size_t>(r);
    }
    return true;
}

int main() {
    const std::string walFile = "engine.wal";
    matchingEngine engine(walFile);

    // reload previous orders from wal if file exists
    std::ifstream checkWal(walFile, std::ios::binary);
    if (checkWal.good()) {
        checkWal.close();
        std::cout << "Loading state from " << walFile << "...\n";
        engine.recoverFromWAL(walFile);
    }

    int server = socket(AF_INET, SOCK_STREAM, 0);
    if (server < 0) {
        std::cerr << "Cannot create socket\n";
        return 1;
    }

    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, (const char*)&yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons(9000);

    if (bind(server, (sockaddr*)&addr, sizeof(addr)) < 0) {
        std::cerr << "Failed to bind to port 9000\n";
        return 1;
    }

    if (listen(server, 5) < 0) {
        std::cerr << "Failed to listen on port 9000\n";
        return 1;
    }

    std::cout << "C++ matching engine running on port 9000 with 8 worker threads\n";

    while (true) {
        int client = accept(server, nullptr, nullptr);
        if (client < 0) continue;

        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, (const char*)&yes, sizeof(yes));
        char buf[sizeof(Command)];

        while (readExact(client, buf, sizeof(Command))) {
            Command cmd;
            memcpy(&cmd, buf, sizeof(Command));

            if (cmd.type == CommandType::SNAPSHOT) {
                uint32_t tId = cmd.orderPayload.tickerID;
                if (tId < 1 || tId > NUM_TICKERS) tId = 1;
                DepthSnapshot snap = engine.getDepth(tId);
                std::string out = "D " + std::to_string(snap.lastPrice) + " " + std::to_string(snap.bids.size()) + " " + std::to_string(snap.asks.size()) + "\n";
                send(client, out.data(), static_cast<int>(out.size()), 0);
            } else {
                // Route command to worker thread queue
                engine.submitJobToWorker(cmd, client);
            }
        }
        close(client);
    }

    return 0;
}
