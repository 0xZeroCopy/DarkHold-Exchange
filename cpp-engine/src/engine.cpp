#include "engine.h"
#include <cstring>
#include <iostream>

matchingEngine::matchingEngine(const std::string& walFilePath) {
    walStream.open(walFilePath, std::ios::out | std::ios::app | std::ios::binary);
    if (!walStream.is_open()) {
        std::cerr << "Failed to open WAL file: " << walFilePath << "\n";
    }
}

matchingEngine::~matchingEngine() {
    if (walStream.is_open()) {
        walStream.close();
    }
}

void matchingEngine::printOrderBook() {
    std::cout << "\n=== ASKS (SELLS) ===\n";
    for (auto it = priceLevelsSell.rbegin(); it != priceLevelsSell.rend(); ++it) {
        std::cout << "Price: $" << it->first << " | Orders: " << it->second.size() << "\n";
    }
    std::cout << "=== BIDS (BUYS) ===\n";
    for (auto it = priceLevelsBuy.rbegin(); it != priceLevelsBuy.rend(); ++it) {
        std::cout << "Price: $" << it->first << " | Orders: " << it->second.size() << "\n";
    }
    std::cout << "====================\n\n";
}

void matchingEngine::recoverFromWAL(const std::string& walFilePath) {
    isRecovering = true;
    std::ifstream inpStream(walFilePath, std::ios::in | std::ios::binary);
    if (!inpStream.is_open()) {
        std::cerr << "Failed to open WAL file: " << walFilePath << "\n";
        isRecovering = false;
        return;
    }
    Command cmd;
    while (inpStream.read(reinterpret_cast<char*>(&cmd), sizeof(Command))) {
        if (cmd.type == CommandType::CANCEL_ORDER) {
            cancelOrder(cmd.cancelOrderID);
        }
        else {
            processOrder(cmd.orderPayload, cmd.now);
        }
        nextSequenceNumber = cmd.sequenceNumber + 1;
    }
    isRecovering = false;
}

void matchingEngine::checkExpiration(uint64_t currentTime) {
    while (!expireQueue.empty() && currentTime > expireQueue.top().expiresAt) {
        uint64_t expireOrderID = expireQueue.top().orderID;
        cancelOrder(expireOrderID);
        expireQueue.pop();
    }
}

std::vector<Trade> matchingEngine::processOrder(Order newOrder, uint64_t now) {
    std::vector<Trade> ret;

    // Explicitly parse side to guarantee correct evaluation
    bool isBuy = (newOrder.isBuy != 0);

    // Keep expiration time valid
    uint64_t expireTime = (newOrder.expiresAt > now) ? newOrder.expiresAt : (now + EXPIRY_DURATION);
    newOrder.expiresAt = expireTime;

    if (!isRecovering) {
        Command cmd;
        std::memset(&cmd, 0, sizeof(cmd));
        cmd.sequenceNumber = nextSequenceNumber++;
        cmd.type = CommandType::PLACE_ORDER;
        cmd.orderPayload = newOrder;
        cmd.now = now;
        walStream.write(reinterpret_cast<const char*>(&cmd), sizeof(Command));
        walStream.flush();
    }

    checkExpiration(now);

    std::cout << "\n📥 [ENGINE] Processing Order #" << newOrder.orderID 
              << " | Side: " << (isBuy ? "BUY" : "SELL")
              << " | Price: $" << newOrder.price 
              << " | Qty: " << newOrder.quantityRemaining << std::endl;

    if (isBuy) {
        // MATCHING LOOP FOR BUY ORDERS against SELL Levels
        while (!priceLevelsSell.empty() && priceLevelsSell.begin()->first <= newOrder.price && newOrder.quantityRemaining > 0) {
            tradeID++;
            Order& bestOrder = priceLevelsSell.begin()->second.front();
            uint32_t quantity = std::min(bestOrder.quantityRemaining, newOrder.quantityRemaining);
            
            newOrder.quantityRemaining -= quantity;
            bestOrder.quantityRemaining -= quantity;

            std::cout << "⚡ [MATCH EXECUTED] Trade #" << tradeID 
                      << " | Price: $" << bestOrder.price 
                      << " | Qty: " << quantity 
                      << " | Buyer: " << newOrder.accountID 
                      << " | Seller: " << bestOrder.accountID << std::endl;

            ret.push_back({ tradeID, newOrder.orderID, bestOrder.orderID, quantity, bestOrder.price, newOrder.accountID, bestOrder.accountID });

            if (bestOrder.quantityRemaining == 0) {
                ActiveOrders.erase(bestOrder.orderID);
                priceLevelsSell.begin()->second.pop_front();
                if (priceLevelsSell.begin()->second.empty()) {
                    priceLevelsSell.erase(priceLevelsSell.begin());
                }
            }
        }

        // Add remaining unfilled quantity to Buy Order Book
        if (newOrder.quantityRemaining > 0 && !newOrder.isMarket) {
            Level& level = priceLevelsBuy[newOrder.price];
            level.push_back(newOrder);
            ActiveOrders[newOrder.orderID] = std::prev(level.end());
            expireQueue.push({ expireTime, newOrder.orderID });
            std::cout << "📌 Order #" << newOrder.orderID << " placed on BUY order book at $" << newOrder.price << std::endl;
        }
        return ret;
    }
    else {
        // MATCHING LOOP FOR SELL ORDERS against BUY Levels
        while (!priceLevelsBuy.empty() && priceLevelsBuy.begin()->first >= newOrder.price && newOrder.quantityRemaining > 0) {
            tradeID++;
            Order& bestOrder = priceLevelsBuy.begin()->second.front();
            uint32_t quantity = std::min(bestOrder.quantityRemaining, newOrder.quantityRemaining);
            
            newOrder.quantityRemaining -= quantity;
            bestOrder.quantityRemaining -= quantity;

            std::cout << "⚡ [MATCH EXECUTED] Trade #" << tradeID 
                      << " | Price: $" << bestOrder.price 
                      << " | Qty: " << quantity 
                      << " | Buyer: " << bestOrder.accountID 
                      << " | Seller: " << newOrder.accountID << std::endl;

            ret.push_back({ tradeID, bestOrder.orderID, newOrder.orderID, quantity, bestOrder.price, bestOrder.accountID, newOrder.accountID });

            if (bestOrder.quantityRemaining == 0) {
                ActiveOrders.erase(bestOrder.orderID);
                priceLevelsBuy.begin()->second.pop_front();
                if (priceLevelsBuy.begin()->second.empty()) {
                    priceLevelsBuy.erase(priceLevelsBuy.begin());
                }
            }
        }

        // Add remaining unfilled quantity to Sell Order Book
        if (newOrder.quantityRemaining > 0 && !newOrder.isMarket) {
            Level& level = priceLevelsSell[newOrder.price];
            level.push_back(newOrder);
            ActiveOrders[newOrder.orderID] = std::prev(level.end());
            expireQueue.push({ expireTime, newOrder.orderID });
            std::cout << "📌 Order #" << newOrder.orderID << " placed on SELL order book at $" << newOrder.price << std::endl;
        }
        return ret;
    }
}

bool matchingEngine::cancelOrder(uint64_t cancelOrderID) {
    if (!isRecovering) {
        Command cmd;
        std::memset(&cmd, 0, sizeof(cmd));
        cmd.sequenceNumber = nextSequenceNumber++;
        cmd.type = CommandType::CANCEL_ORDER;
        cmd.cancelOrderID = cancelOrderID;
        walStream.write(reinterpret_cast<const char*>(&cmd), sizeof(Command));
        walStream.flush();
    }

    auto found = ActiveOrders.find(cancelOrderID);
    if (found != ActiveOrders.end()) {
        OrderIt cancelOrder = found->second;
        bool isBuy = (cancelOrder->isBuy != 0);
        uint32_t price = cancelOrder->price;

        if (isBuy) {
            auto levelIt = priceLevelsBuy.find(price);
            levelIt->second.erase(cancelOrder);
            if (levelIt->second.empty()) {
                priceLevelsBuy.erase(levelIt);
            }
        }
        else {
            auto levelIt = priceLevelsSell.find(price);
            levelIt->second.erase(cancelOrder);
            if (levelIt->second.empty()) {
                priceLevelsSell.erase(levelIt);
            }
        }
        ActiveOrders.erase(cancelOrderID);
        std::cout << "❌ Order #" << cancelOrderID << " successfully cancelled." << std::endl;
        return true;
    }
    else return false;
}