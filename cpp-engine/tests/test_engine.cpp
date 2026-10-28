#include <cassert>
#include <iostream>
#include <fstream>
#include "engine.h"

void testBasicLimitMatchingAndEscrow() {
    std::cout << "--- Running testBasicLimitMatchingAndEscrow ---\n";
    std::string testWal = "test_engine_basic.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);

        // Account 1001 (served by worker 1001 % 8 = 1) places BUY 10 @ $100
        Order buyOrder{};
        buyOrder.orderID = 101;
        buyOrder.accountID = 1001;
        buyOrder.isBuy = 1;
        buyOrder.price = 100;
        buyOrder.quantityRemaining = 10;
        buyOrder.isMarket = 0;

        uint64_t now = nowMs();
        std::vector<Trade> trades;
        std::string err;

        bool placed = engine.placeOrderDirect(buyOrder, now, trades, err);
        assert(placed);
        assert(trades.empty());

        // Check account 1001 escrow
        Account buyer = engine.getAccount(1001);
        assert(buyer.heldCash == 1000);
        assert(buyer.availableCash == 100000 - 1000);

        // Account 1002 (served by worker 1002 % 8 = 2) places SELL 6 @ $100 (partial fill)
        Order sellOrder{};
        sellOrder.orderID = 201;
        sellOrder.accountID = 1002;
        sellOrder.isBuy = 0;
        sellOrder.price = 100;
        sellOrder.quantityRemaining = 6;
        sellOrder.isMarket = 0;

        placed = engine.placeOrderDirect(sellOrder, now + 1, trades, err);
        assert(placed);
        assert(trades.size() == 1);
        assert(trades[0].quantityFulfilled == 6);
        assert(trades[0].price == 100);
        assert(trades[0].buyerID == 1001);
        assert(trades[0].sellerID == 1002);

        // Check balances after partial fill
        buyer = engine.getAccount(1001);
        Account seller = engine.getAccount(1002);

        assert(buyer.heldCash == 400);
        assert(buyer.availableTickets[1] == 500 + 6);

        assert(seller.heldTickets[1] == 0);
        assert(seller.availableTickets[1] == 500 - 6);
        assert(seller.availableCash == 100000 + 600);

        // Conservation check
        uint64_t totalCash = buyer.availableCash + buyer.heldCash + seller.availableCash + seller.heldCash;
        uint32_t totalTickets = buyer.availableTickets[1] + buyer.heldTickets[1] + seller.availableTickets[1] + seller.heldTickets[1];
        assert(totalCash == 200000);
        assert(totalTickets == 1000);
    }

    std::remove(testWal.c_str());
    std::cout << "testBasicLimitMatchingAndEscrow passed\n";
}

void testPriceImprovementRefund() {
    std::cout << "--- Running testPriceImprovementRefund ---\n";
    std::string testWal = "test_price_improvement.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);
        uint64_t now = nowMs();
        std::vector<Trade> trades;
        std::string err;

        // Seller 1002 places ask: 5 @ $90
        Order sellOrder{};
        sellOrder.orderID = 301;
        sellOrder.accountID = 1002;
        sellOrder.isBuy = 0;
        sellOrder.price = 90;
        sellOrder.quantityRemaining = 5;
        sellOrder.isMarket = 0;

        bool placed = engine.placeOrderDirect(sellOrder, now, trades, err);
        assert(placed);

        // Buyer 1001 places aggressive limit buy: 5 @ $120
        // Executes at resting price ($90), buyer gets $150 refunded
        Order buyOrder{};
        buyOrder.orderID = 302;
        buyOrder.accountID = 1001;
        buyOrder.isBuy = 1;
        buyOrder.price = 120;
        buyOrder.quantityRemaining = 5;
        buyOrder.isMarket = 0;

        placed = engine.placeOrderDirect(buyOrder, now + 1, trades, err);
        assert(placed);
        assert(trades.size() == 1);
        assert(trades[0].price == 90);
        assert(trades[0].quantityFulfilled == 5);

        Account buyer = engine.getAccount(1001);
        Account seller = engine.getAccount(1002);

        assert(buyer.heldCash == 0);
        assert(buyer.availableCash == 100000 - 450);
        assert(buyer.availableTickets[1] == 500 + 5);

        assert(seller.heldTickets[1] == 0);
        assert(seller.availableCash == 100000 + 450);
        assert(seller.availableTickets[1] == 500 - 5);

        uint64_t totalCash = buyer.availableCash + buyer.heldCash + seller.availableCash + seller.heldCash;
        uint32_t totalTickets = buyer.availableTickets[1] + buyer.heldTickets[1] + seller.availableTickets[1] + seller.heldTickets[1];
        assert(totalCash == 200000);
        assert(totalTickets == 1000);
    }

    std::remove(testWal.c_str());
    std::cout << "testPriceImprovementRefund passed\n";
}

void testPriceCollarAndBounds() {
    std::cout << "--- Running testPriceCollarAndBounds ---\n";
    std::string testWal = "test_collar.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);
        uint64_t now = nowMs();
        std::vector<Trade> trades;
        std::string err;

        // Order price $201 exceeds collar ($200)
        Order highPriceOrder{};
        highPriceOrder.orderID = 401;
        highPriceOrder.accountID = 1001;
        highPriceOrder.isBuy = 1;
        highPriceOrder.price = 201;
        highPriceOrder.quantityRemaining = 1;

        bool placed = engine.placeOrderDirect(highPriceOrder, now, trades, err);
        assert(!placed);
        assert(err.find("Price too high") != std::string::npos);

        // Zero quantity
        Order zeroQtyOrder{};
        zeroQtyOrder.orderID = 402;
        zeroQtyOrder.accountID = 1001;
        zeroQtyOrder.isBuy = 1;
        zeroQtyOrder.price = 100;
        zeroQtyOrder.quantityRemaining = 0;

        placed = engine.placeOrderDirect(zeroQtyOrder, now, trades, err);
        assert(!placed);

        // Insufficient cash
        Order tooExpensive{};
        tooExpensive.orderID = 403;
        tooExpensive.accountID = 1001;
        tooExpensive.isBuy = 1;
        tooExpensive.price = 200;
        tooExpensive.quantityRemaining = 1000;

        placed = engine.placeOrderDirect(tooExpensive, now, trades, err);
        assert(!placed);
        assert(err.find("Not enough cash") != std::string::npos);
    }

    std::remove(testWal.c_str());
    std::cout << "testPriceCollarAndBounds passed\n";
}

void testWALPersistenceAndRecovery() {
    std::cout << "--- Running testWALPersistenceAndRecovery ---\n";
    std::string testWal = "test_wal_recovery.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);
        uint64_t now = nowMs();
        std::vector<Trade> trades;
        std::string err;

        // Place resting buy: 10 @ $150
        Order buyOrder{};
        buyOrder.orderID = 501;
        buyOrder.accountID = 1001;
        buyOrder.isBuy = 1;
        buyOrder.price = 150;
        buyOrder.quantityRemaining = 10;
        buyOrder.isMarket = 0;

        bool placed = engine.placeOrderDirect(buyOrder, now, trades, err);
        assert(placed);

        // Place resting sell: 8 @ $160
        Order sellOrder{};
        sellOrder.orderID = 502;
        sellOrder.accountID = 1002;
        sellOrder.isBuy = 0;
        sellOrder.price = 160;
        sellOrder.quantityRemaining = 8;
        sellOrder.isMarket = 0;

        placed = engine.placeOrderDirect(sellOrder, now + 1, trades, err);
        assert(placed);

        // Cancel order 501
        bool cancelled = engine.cancelOrderDirect(501);
        assert(cancelled);

        // Wait brief moment for WAL writer thread to flush
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    // Now start a fresh engine and recover from WAL
    {
        matchingEngine restoredEngine(testWal);
        restoredEngine.recoverFromWAL(testWal);

        // Check account 1001 escrow was released by cancel
        Account buyer = restoredEngine.getAccount(1001);
        assert(buyer.heldCash == 0);
        assert(buyer.availableCash == 100000);

        // Check account 1002 still holds escrow for resting sell
        Account seller = restoredEngine.getAccount(1002);
        assert(seller.heldTickets[1] == 8);
        assert(seller.availableTickets[1] == 500 - 8);
    }

    std::remove(testWal.c_str());
    std::cout << "testWALPersistenceAndRecovery passed\n";
}

void testAsyncWorkerToEngineHandoff() {
    std::cout << "--- Running testAsyncWorkerToEngineHandoff ---\n";
    std::string testWal = "test_async_handoff.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);

        // Account 1001 (Worker 1) submits BUY 10 @ $100 via worker queue
        Command buyCmd{};
        buyCmd.type = CommandType::PLACE_ORDER;
        buyCmd.orderPayload.accountID = 1001;
        buyCmd.orderPayload.isBuy = 1;
        buyCmd.orderPayload.price = 100;
        buyCmd.orderPayload.quantityRemaining = 10;
        buyCmd.orderPayload.isMarket = 0;
        buyCmd.orderPayload.orderID = 0;
        buyCmd.now = nowMs();

        engine.submitJobToWorker(buyCmd, -1);

        // Give worker and engine threads time to process asynchronously
        std::this_thread::sleep_for(std::chrono::milliseconds(60));

        Account buyer = engine.getAccount(1001);
        assert(buyer.heldCash == 1000);
        assert(buyer.availableCash == 100000 - 1000);

        // Account 1002 (Worker 2) submits matching SELL 10 @ $100 via worker queue
        Command sellCmd{};
        sellCmd.type = CommandType::PLACE_ORDER;
        sellCmd.orderPayload.accountID = 1002;
        sellCmd.orderPayload.isBuy = 0;
        sellCmd.orderPayload.price = 100;
        sellCmd.orderPayload.quantityRemaining = 10;
        sellCmd.orderPayload.isMarket = 0;
        sellCmd.orderPayload.orderID = 0;
        sellCmd.now = nowMs();

        engine.submitJobToWorker(sellCmd, -1);

        std::this_thread::sleep_for(std::chrono::milliseconds(60));

        buyer = engine.getAccount(1001);
        Account seller = engine.getAccount(1002);

        assert(buyer.heldCash == 0);
        assert(buyer.availableCash == 100000 - 1000);
        assert(buyer.availableTickets[1] == 500 + 10);

        assert(seller.heldTickets[1] == 0);
        assert(seller.availableTickets[1] == 500 - 10);
        assert(seller.availableCash == 100000 + 1000);
    }

    std::remove(testWal.c_str());
    std::cout << "testAsyncWorkerToEngineHandoff passed\n";
}

void testMultiTickerIsolation() {
    std::cout << "--- Running testMultiTickerIsolation ---\n";
    std::string testWal = "test_multi_ticker.wal";
    std::remove(testWal.c_str());

    {
        matchingEngine engine(testWal);
        uint64_t now = nowMs();
        std::vector<Trade> trades;
        std::string err;

        // Buyer 1001 places BUY 5 @ $100 for Ticker 1 (VIP)
        Order buyT1{};
        buyT1.orderID = 701;
        buyT1.accountID = 1001;
        buyT1.isBuy = 1;
        buyT1.price = 100;
        buyT1.quantityRemaining = 5;
        buyT1.tickerID = TICKER_1;

        bool placed = engine.placeOrderDirect(buyT1, now, trades, err);
        assert(placed);
        assert(trades.empty());

        // Seller 1002 places SELL 5 @ $100 for Ticker 2 (Early Bird)
        Order sellT2{};
        sellT2.orderID = 702;
        sellT2.accountID = 1002;
        sellT2.isBuy = 0;
        sellT2.price = 100;
        sellT2.quantityRemaining = 5;
        sellT2.tickerID = TICKER_2;

        placed = engine.placeOrderDirect(sellT2, now + 1, trades, err);
        assert(placed);
        // Different tickers must not match
        assert(trades.empty());

        // Seller 1003 places SELL 5 @ $100 for Ticker 1 (VIP)
        Order sellT1{};
        sellT1.orderID = 703;
        sellT1.accountID = 1003;
        sellT1.isBuy = 0;
        sellT1.price = 100;
        sellT1.quantityRemaining = 5;
        sellT1.tickerID = TICKER_1;

        placed = engine.placeOrderDirect(sellT1, now + 2, trades, err);
        assert(placed);
        assert(trades.size() == 1);
        assert(trades[0].tickerID == TICKER_1);
        assert(trades[0].quantityFulfilled == 5);
        assert(trades[0].price == 100);

        // Buyer 1001 should have 505 tickets for Ticker 1, but still 500 for Ticker 2
        Account buyer = engine.getAccount(1001);
        assert(buyer.availableTickets[TICKER_1] == 505);
        assert(buyer.availableTickets[TICKER_2] == 500);

        // Seller 1002's Ticker 2 order should still be resting and held
        Account sellerT2 = engine.getAccount(1002);
        assert(sellerT2.heldTickets[TICKER_2] == 5);
        assert(sellerT2.availableTickets[TICKER_2] == 495);
        assert(sellerT2.availableTickets[TICKER_1] == 500);

        // Cancel Seller 1002's Ticker 2 order
        bool cancelled = engine.cancelOrderDirect(702);
        assert(cancelled);

        sellerT2 = engine.getAccount(1002);
        assert(sellerT2.heldTickets[TICKER_2] == 0);
        assert(sellerT2.availableTickets[TICKER_2] == 500);
    }

    std::remove(testWal.c_str());
    std::cout << "testMultiTickerIsolation passed\n";
}

int main() {
    std::cout << "Running tests...\n";

    testBasicLimitMatchingAndEscrow();
    testPriceImprovementRefund();
    testPriceCollarAndBounds();
    testWALPersistenceAndRecovery();
    testAsyncWorkerToEngineHandoff();
    testMultiTickerIsolation();

    std::cout << "All tests passed successfully!\n";
    return 0;
}
