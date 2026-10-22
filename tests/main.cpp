#include "../src/engine/engine.h"
#include <iostream>
#include <cstdio> // For std::remove to clean up old test files

int main() {
    const std::string walFile = "test_wal.dat";
    
    // Clean up old runs
    std::remove(walFile.c_str());

    std::cout << "\n=== PHASE 1: LIVE ENGINE STARTING ===\n";
    {
        // The scope block { } ensures liveEngine is destroyed at the end of the block,
        // simulating the process exiting or crashing.
        matchingEngine liveEngine(walFile);
        
        // 1. Add some passive orders to build the order book
        // Order params: orderID, qty, price, isBuy, accountID, expiresAt, isMarket
        liveEngine.processOrder({1, 100, 50500, 0, 901, 0, 0}, nowMs()); // Sell 100 @ $505.00
        liveEngine.processOrder({2, 200, 50200, 0, 902, 0, 0}, nowMs()); // Sell 200 @ $502.00
        liveEngine.processOrder({3, 50,  49900, 1, 903, 0, 0}, nowMs()); // Buy  50  @ $499.00
        liveEngine.processOrder({4, 150, 49800, 1, 904, 0, 0}, nowMs()); // Buy  150 @ $498.00
        
        // 2. Add an aggressive crossing order to prove state mutations (trades) log correctly
        // This buys 50 shares at $502.00, which should reduce Order #2's quantity from 200 down to 150.
        std::cout << "Processing aggressive crossing order...\n";
        liveEngine.processOrder({5, 50, 50200, 1, 905, 0, 0}, nowMs()); 

        // 3. Cancel an order to prove cancel logic replays correctly
        std::cout << "Canceling Order #4...\n";
        liveEngine.cancelOrder(4);

        std::cout << "\n[State BEFORE Simulated Crash]\n";
        liveEngine.printOrderBook();
        
        std::cout << "[CRASHING ENGINE] Initiating simulated power failure...\n";
    } // liveEngine destructor fires here, closing the file safely.

    std::cout << "\n=== PHASE 2: RECOVERY ENGINE STARTING ===\n";
    
    // Instantiate a brand new engine with empty memory
    matchingEngine recoveryEngine(walFile);
    
    std::cout << "\n[State BEFORE Recovery (Should be completely empty)]\n";
    recoveryEngine.printOrderBook();

    // Replay the WAL
    std::cout << "[RECOVERING] Replaying Write-Ahead Log from " << walFile << "...\n";
    recoveryEngine.recoverFromWAL(walFile);

    std::cout << "\n[State AFTER Recovery (Should perfectly match Phase 1)]\n";
    recoveryEngine.printOrderBook();

    return 0;
}