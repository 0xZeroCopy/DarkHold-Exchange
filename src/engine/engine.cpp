#include "engine.h"

matchingEngine::matchingEngine(const std::string& walFilePath){
    walStream.open(walFilePath, std::ios::out | std::ios::app | std::ios::binary);  //Opens the file at walFilePath in binary in append mode in binary as an output stream
    if(!walStream.is_open()){
        std::cerr<<"Failed to open WAL file: "<<walFilePath<<"\n";
    }
}

matchingEngine::~matchingEngine(){
    if(!walStream.is_open()){
        walStream.close();
    }
}

void matchingEngine::checkExpiration(uint64_t currentTime){
    while(!expireQueue.empty() && currentTime > expireQueue.top().expiresAt){
        int expireOrderID = expireQueue.top().orderID;
        cancelOrder(expireOrderID);
        expireQueue.pop();
    }
}

std::vector<Trade> matchingEngine::processOrder(Order newOrder, uint64_t now){
    std::vector <Trade> ret;
    uint64_t expireTime = now + EXPIRY_DURATION;
    newOrder.expiresAt = expireTime;
    checkExpiration(now);
    if(newOrder.isBuy){
        while(!priceLevelsSell.empty() && priceLevelsSell.begin()->first <= newOrder.price && newOrder.quantityRemaining > 0){
            tradeID++;
            Order& bestOrder = priceLevelsSell.begin()->second.front();
            uint32_t quantity = std::min(bestOrder.quantityRemaining, newOrder.quantityRemaining);
            newOrder.quantityRemaining -= quantity;
            bestOrder.quantityRemaining -= quantity;
            ret.push_back({tradeID,newOrder.orderID,bestOrder.orderID,quantity,bestOrder.price,newOrder.accountID,bestOrder.accountID});
            if(bestOrder.quantityRemaining == 0){
                
                ActiveOrders.erase(bestOrder.orderID);
                priceLevelsSell.begin()->second.pop_front();
                if(priceLevelsSell.begin()->second.empty()){
                    priceLevelsSell.erase(priceLevelsSell.begin());
                }
            }
        }
        if(newOrder.quantityRemaining>0 && !newOrder.isMarket){
            Level& level = priceLevelsBuy[newOrder.price];
            level.push_back(newOrder);
            ActiveOrders[newOrder.orderID] = std::prev(level.end());
            expireQueue.push({expireTime,newOrder.orderID});
        }
        return ret;
    }
    else{
        while(!priceLevelsBuy.empty() && priceLevelsBuy.begin()->first >= newOrder.price && newOrder.quantityRemaining > 0){
            tradeID++;
            Order& bestOrder = priceLevelsBuy.begin()->second.front();
            uint32_t quantity = std::min(bestOrder.quantityRemaining, newOrder.quantityRemaining);
            newOrder.quantityRemaining -= quantity;
            bestOrder.quantityRemaining -= quantity;
            ret.push_back({tradeID,bestOrder.orderID,newOrder.orderID,quantity,bestOrder.price,bestOrder.accountID,newOrder.accountID});
            if(bestOrder.quantityRemaining == 0){
                ActiveOrders.erase(bestOrder.orderID);
                priceLevelsBuy.begin()->second.pop_front();
                if(priceLevelsBuy.begin()->second.empty()){
                    priceLevelsBuy.erase(priceLevelsBuy.begin());
                }
            }
        }
        if(newOrder.quantityRemaining>0 && !newOrder.isMarket){
            Level& level = priceLevelsSell[newOrder.price];
            level.push_back(newOrder);
            ActiveOrders[newOrder.orderID] = std::prev(level.end());
            expireQueue.push({expireTime,newOrder.orderID});
        }
        return ret;
    }
}

bool matchingEngine::cancelOrder(uint64_t cancelOrderID){
    auto found = ActiveOrders.find(cancelOrderID);
    if(found!=ActiveOrders.end()){
        OrderIt cancelOrder = found->second;
        bool isBuy = cancelOrder->isBuy;
        int price = cancelOrder->price;
        if(isBuy){
            auto levelIt = priceLevelsBuy.find(price);  //Finding the price level and storing it once to avoid searching twice while deletion and checking whether empty
            levelIt->second.erase(cancelOrder);
            if(levelIt->second.empty()){
                priceLevelsBuy.erase(levelIt);
            }
        }
        else{
            auto levelIt = priceLevelsSell.find(price);
            levelIt->second.erase(cancelOrder);
            if(levelIt->second.empty()){
                priceLevelsSell.erase(levelIt);
            }
        }
        ActiveOrders.erase(cancelOrderID);
        return true;
    }
    else return false;
}