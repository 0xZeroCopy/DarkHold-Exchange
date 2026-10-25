#include "engine.h"
#include <iostream>
#include <cstring>
#include <string>

// Windows / Linux Cross-Platform Socket Headers & Type Definitions
#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    
    typedef SSIZE_T ssize_t;
    typedef int socklen_t;
    #define close_socket closesocket
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <netinet/tcp.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #define close_socket close
#endif

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
#ifdef _WIN32
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        std::cerr << "Failed to initialize Winsock (WSAStartup failed)\n";
        return 1;
    }
#endif

    matchingEngine engine("engine.wal");

    int server = socket(AF_INET, SOCK_STREAM, 0);
    if (server < 0) {
        std::cerr << "Failed to create socket\n";
        return 1;
    }

    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, (const char*)&yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons(9000);

    if (bind(server, (sockaddr*)&addr, sizeof(addr)) < 0) {
        std::cerr << "Failed to bind socket on port 9000\n";
        return 1;
    }

    if (listen(server, 1) < 0) {
        std::cerr << "Failed to listen on port 9000\n";
        return 1;
    }

    std::cout << "🟢 C++ Matching Engine TCP Server listening on 127.0.0.1:9000...\n";

    while (true) {
        int client = accept(server, nullptr, nullptr);
        if (client < 0) continue;

        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, (const char*)&yes, sizeof(yes));
        char buf[sizeof(Command)];

        while (readExact(client, buf, sizeof(Command))) {
            Command cmd;
            memcpy(&cmd, buf, sizeof(Command));
            std::string out;

            // Use the timestamp received directly in the binary packet
            uint64_t currentTimestamp = (cmd.now > 0) ? cmd.now : nowMs();

            if (cmd.type == CommandType::PLACE_ORDER) {
                // Ensure expiration timestamp is valid (10 minutes in future if unset)
                if (cmd.orderPayload.expiresAt <= currentTimestamp) {
                    cmd.orderPayload.expiresAt = currentTimestamp + EXPIRY_DURATION;
                }

                std::cout << "📥 Processing Order #" << cmd.orderPayload.orderID 
                          << " | Account: " << cmd.orderPayload.accountID 
                          << " | Side: " << (cmd.orderPayload.isBuy ? "BUY" : "SELL")
                          << " | Price: $" << cmd.orderPayload.price 
                          << " | Qty: " << cmd.orderPayload.quantityRemaining << std::endl;

                // Execute Order in C++ Engine
                auto trades = engine.processOrder(cmd.orderPayload, currentTimestamp);

                for (auto& t : trades) {
                    std::cout << "⚡ MATCH EXECUTED! Trade #" << t.tradeID 
                              << " | Price: $" << t.price 
                              << " | Qty: " << t.quantityFulfilled << std::endl;

                    out += "F " + std::to_string(t.tradeID) + " " + std::to_string(t.price) + " " + std::to_string(t.quantityFulfilled) + "\n";
                }
            }
            else if (cmd.type == CommandType::CANCEL_ORDER) {
                out += engine.cancelOrder(cmd.cancelOrderID) ? "X ok\n" : "X none\n";
            }

            if (!out.empty()) {
                send(client, out.data(), static_cast<int>(out.size()), 0);
            }
        }
        close_socket(client);
    }

#ifdef _WIN32
    WSACleanup();
#endif

    return 0;
}