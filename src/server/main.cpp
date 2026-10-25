#include "engine.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <cstring>

static bool readExact(int fd, char* buf, size_t n){
    size_t got = 0;
    while(got < n){
        ssize_t r = recv(fd, buf + got, n - got, 0);
        if(r <= 0) return false;
        got += r;
    }
    return true;
}

int main(){
    matchingEngine engine("engine.wal");
    engine.recoverFromWAL("engine.wal");

    int server = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons(9000);
    bind(server, (sockaddr*)&addr, sizeof(addr));
    listen(server, 1);

    while(true){
        int client = accept(server, nullptr, nullptr);
        if(client < 0) continue;
        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
        char buf[sizeof(Command)];
        while(readExact(client, buf, sizeof(Command))){
            Command cmd;
            memcpy(&cmd, buf, sizeof(Command));
            std::string out;
            if(cmd.type == CommandType::PLACE_ORDER){
                for(auto& t : engine.processOrder(cmd.orderPayload, cmd.now))
                    out += "F " + std::to_string(t.tradeID) + " " + std::to_string(t.price) + " " + std::to_string(t.quantityFulfilled) + "\n";
            }
            else if(cmd.type == CommandType::CANCEL_ORDER){
                out += engine.cancelOrder(cmd.cancelOrderID) ? "X ok\n" : "X none\n";
            }
            else if(cmd.type == CommandType::TICK){
                engine.checkExpiration(cmd.now);
            }
            if(!out.empty()) send(client, out.data(), out.size(), MSG_NOSIGNAL);
        }
        close(client);
    }
}