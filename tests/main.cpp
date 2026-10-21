#include "engine.h"


int main() {
    matchingEngine engine;

    Order buy = {1, 10, 100, true, 101, 0, false};
    engine.processOrder(buy, 1000);
    Order sell = {2, 10, 100, false, 201, 0, false};
    auto trades = engine.processOrder(sell, 1050);
    std::cout << trades.size() << " trade(s)\n";
    for(auto& t : trades)
        std::cout << "qty " << t.quantityFulfilled << " at price " << t.price << "\n";
    return 0;
}