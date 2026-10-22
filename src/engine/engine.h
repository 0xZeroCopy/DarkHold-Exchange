#pragma once
#define EXPIRY_DURATION 600000

#include <iostream>
#include <list>
#include <unordered_map>
#include <map>
#include <functional>
#include <vector>
#include <algorithm>
#include <queue>
#include <cstdint>
#include <chrono>
#include <fstream>

//To calculate current time in ms
inline uint64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

#pragma pack(push,1)    //Ensures that data is packed as much as possible to reduce the number of bytes to be written to the disk
struct Order{
    uint64_t orderID;
    uint32_t quantityRemaining;
    uint32_t price;
    uint8_t isBuy;
    uint64_t accountID;
    uint64_t expiresAt;
    uint8_t isMarket;
};

enum class CommandType:uint8_t{
    PLACE_ORDER = 1,
    CANCEL_ORDER = 2
};

struct Command {
    uint64_t sequenceNumber;
    CommandType type;
    union{
        uint64_t cancelOrderID;   //Only used if type is CANCEL_ORDER
        Order orderPayload;  //Only used if type is PLACE_ORDER
    };
};
#pragma pack(pop)


struct Trade{
    long long tradeID;
    uint64_t buyOrderID;
    uint64_t sellOrderID;
    uint32_t quantityFulfilled;
    uint32_t price;
    uint64_t buyerID;
    uint64_t sellerID;
};

using Level = std::list<Order>; //Defines level as lists which go against the maps
using OrderIt = Level::iterator;

struct ExpiryRecord{
    u_int64_t expiresAt;
    uint64_t orderID;
    
    // This tells C++ how to compare two records so the earliest time goes to the top
    bool operator>(const ExpiryRecord& other) const {
        return expiresAt > other.expiresAt;
    }
};

class matchingEngine{
    std::priority_queue<ExpiryRecord, std::vector<ExpiryRecord>, std::greater<>> expireQueue;
    long long tradeID=0;
    std::unordered_map<uint64_t,OrderIt> ActiveOrders;
    std::map<uint32_t,Level, std::greater<>> priceLevelsBuy;    //Buy Orders (limit) waiting to be matched
    std::map<uint32_t, Level>priceLevelsSell;    //Sell Orders (limit) waiting to be matched
    std::ofstream walStream;
    uint64_t nextSequenceNumber;    //To guarantee a fallback option from WAL if something fails
    uint8_t isRecovering=false;
public:
    matchingEngine(const std::string& walFilePath);
    std::vector<Trade> processOrder(Order newOrder, uint64_t now);
    bool cancelOrder(uint64_t cancelOrderID);
    void checkExpiration(u_int64_t currentTime);
    void recoverFromWAL(const std::string& walFilePath);
    void printOrderBook();
    ~matchingEngine();
};