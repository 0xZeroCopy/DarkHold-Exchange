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

//To calculate current time in ms
inline uint64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

struct Order{
    int orderID;
    int quantityRemaining;
    int price;
    bool isBuy;
    int accountID;
    uint64_t expiresAt;
    bool isMarket;
};

struct Trade{
    long long tradeID;
    int buyOrderID;
    int sellOrderID;
    int quantityFulfilled;
    int price;
    int buyerID;
    int sellerID;
};

using Level = std::list<Order>; //Defines level as lists which go against the maps
using OrderIt = Level::iterator;

struct ExpiryRecord {
    u_int64_t expiresAt;
    int orderID;
    
    // This tells C++ how to compare two records so the earliest time goes to the top
    bool operator>(const ExpiryRecord& other) const {
        return expiresAt > other.expiresAt;
    }
};

class matchingEngine{
    std::priority_queue<ExpiryRecord, std::vector<ExpiryRecord>, std::greater<>> expireQueue;
    long long tradeID=0;
    std::unordered_map<int,OrderIt> ActiveOrders;
    std::map<int, Level, std::greater<>> priceLevelsBuy;    //Buy Orders (limit) waiting to be matched
    std::map<int, Level>priceLevelsSell;    //Sell Orders (limit) waiting to be matched

public:
    std::vector<Trade> processOrder(Order newOrder, uint64_t now);
    bool cancelOrder(int cancelOrderID);
    void checkExpiration(u_int64_t currentTime);
};