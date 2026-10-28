#pragma once

#include <iostream>
#include <vector>
#include <list>
#include <map>
#include <unordered_map>
#include <string>
#include <thread>
#include <mutex>
#include <chrono>
#include <fstream>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <unistd.h>

const int NUM_WORKERS = 8;
const uint32_t NUM_TICKERS = 5;
const uint64_t EXPIRY_DURATION = 600000; // 10 minutes in ms
const uint32_t MAX_PRICE = 200; // price collar (2x face value)

// 5 hardcoded ticket types
const uint32_t TICKER_1 = 1;
const uint32_t TICKER_2 = 2;
const uint32_t TICKER_3 = 3;
const uint32_t TICKER_4 = 4;
const uint32_t TICKER_5 = 5;

inline uint64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

#pragma pack(push, 1)
struct Order {
    uint64_t orderID;
    uint32_t quantityRemaining;
    uint32_t price;
    uint8_t isBuy;
    uint64_t accountID;
    uint64_t expiresAt;
    uint8_t isMarket;
    uint32_t tickerID;
};

enum class CommandType : uint8_t {
    PLACE_ORDER = 1,
    CANCEL_ORDER = 2,
    TICK = 3,
    SNAPSHOT = 4,
    GET_BALANCE = 5
};

struct Command {
    uint64_t sequenceNumber;
    CommandType type;
    union {
        uint64_t cancelOrderID;
        Order orderPayload;
    };
    uint64_t now;
};
#pragma pack(pop)

static_assert(sizeof(Command) == 55, "Command layout changed");

struct Trade {
    long long tradeID;
    uint64_t buyOrderID;
    uint64_t sellOrderID;
    uint32_t quantityFulfilled;
    uint32_t price;
    uint64_t buyerID;
    uint64_t sellerID;
    uint32_t buyerLimitPrice;
    uint32_t tickerID;
};

struct ExpiryRecord {
    uint64_t expiresAt;
    uint64_t orderID;
    uint32_t tickerID;
};

struct Account {
    uint64_t accountID = 0;
    uint64_t availableCash = 100000;
    uint64_t heldCash = 0;
    uint32_t availableTickets[NUM_TICKERS + 1] = {0, 500, 500, 500, 500, 500};
    uint32_t heldTickets[NUM_TICKERS + 1] = {0, 0, 0, 0, 0, 0};
    int openOrders = 0;
};

struct DepthLevel {
    uint32_t price;
    uint32_t quantity;
};

struct DepthSnapshot {
    uint32_t tickerID = 1;
    uint32_t lastPrice = 0;
    std::vector<DepthLevel> bids;
    std::vector<DepthLevel> asks;
};

struct WorkerJob {
    Command cmd;
    int clientFd;
};

struct WorkerQueue {
    std::vector<WorkerJob> jobs;
    std::mutex mtx;
    int eventFd = -1;

    void init();
    void closeFd();
    void push(WorkerJob job);
    bool pop(WorkerJob& job);
};

struct EngineJob {
    Command cmd;
    int workerID = 0;
    int clientFd = -1;
    bool done = false;
    std::vector<Trade> trades;
    bool cancelSuccess = false;
};

struct ResponseQueue {
    std::vector<EngineJob*> jobs;
    std::mutex mtx;
    int eventFd = -1;

    void init();
    void closeFd();
    void push(EngineJob* job);
    bool pop(EngineJob*& job);
};

struct EngineQueue {
    std::vector<EngineJob*> jobs;
    std::mutex mtx;
    int eventFd = -1;

    void init();
    void closeFd();
    void push(EngineJob* job);
    bool pop(EngineJob*& job);
};

struct WalQueue {
    std::vector<Command> items;
    std::mutex mtx;
    int eventFd = -1;

    void init();
    void closeFd();
    void push(Command cmd);
    bool pop(Command& cmd);
};

class matchingEngine;

class Worker {
public:
    int workerID = 0;
    uint64_t orderCounter = 1;
    std::unordered_map<uint64_t, Account> accounts;
    std::mutex accountMtx;

    WorkerQueue workerQueue;
    ResponseQueue responseQueue;
    int epollFd = -1;

    std::thread workerThread;
    bool running = false;
    matchingEngine* engine = nullptr;

    Worker() = default;
    ~Worker();

    void start();
    void stop();
    void run();

    Account getAccountCopy(uint64_t accountID);
    bool lockEscrow(Order& order, std::string& errorMsg);
    void releaseEscrow(uint64_t accountID, bool isBuy, uint32_t price, uint32_t qty, uint32_t tickerID = 1);
    void applyTrade(const Trade& trade, bool isBuyer);
    uint64_t makeOrderID();
};

using Level = std::list<Order>;
using OrderIt = Level::iterator;

struct OrderBook {
    uint32_t tickerID = 1;
    uint32_t lastTradedPrice = 0;
    std::map<uint32_t, Level, std::greater<uint32_t>> priceLevelsBuy;
    std::map<uint32_t, Level> priceLevelsSell;
    std::unordered_map<uint64_t, std::pair<uint32_t, OrderIt>> activeOrders;
    std::unordered_map<uint64_t, bool> orderSide;
    std::unordered_map<uint64_t, uint32_t> originalLimitPrice;
};

class matchingEngine {
private:
    std::vector<ExpiryRecord> expireQueue;
    long long tradeID = 0;
    uint64_t nextSequenceNumber = 0;
    bool isRecovering = false;

    OrderBook orderBooks[NUM_TICKERS + 1];
    std::unordered_map<uint64_t, uint32_t> orderToTicker;

    Worker workers[NUM_WORKERS];

    EngineQueue engineQueue;
    int engineEpollFd = -1;
    std::thread engineThread;
    bool engineRunning = false;

    WalQueue walQueue;
    int walEpollFd = -1;
    std::thread walWriterThread;
    bool walRunning = false;
    std::string walFilePath;

    std::thread depthThread;
    bool depthRunning = false;
    DepthSnapshot currentDepth[NUM_TICKERS + 1];
    std::mutex engineMutex;

public:
    matchingEngine(const std::string& walPath);
    ~matchingEngine();

    void start();
    void stop();

    void runEngine();
    void runWalWriter();
    void updateDepthSnapshot();

    Worker& getWorker(uint64_t accountID);
    Account getAccount(uint64_t accountID);

    void executeOrder(Order order, std::vector<Trade>& trades);
    bool executeCancel(uint64_t cancelOrderID);
    void checkExpiration(uint64_t currentTime);

    void submitJobToWorker(const Command& cmd, int clientFd);
    void submitJobToEngine(EngineJob* job);
    void logWal(const Command& cmd);

    bool placeOrderDirect(Order& order, uint64_t now, std::vector<Trade>& trades, std::string& errorMsg);
    bool cancelOrderDirect(uint64_t cancelOrderID);

    void recoverFromWAL(const std::string& path);
    DepthSnapshot getDepth(uint32_t tickerID = 1);
    void printOrderBook(uint32_t tickerID = 0);
};
