#include <iostream>
#include <vector>
#include <chrono>
#include <numeric>
#include <algorithm>
#include <iomanip>
#include <atomic>
#include "engine.h"

void runDirectEngineBenchmark(int numOrders) {
    std::string walPath = "benchmark_direct.wal";
    std::remove(walPath.c_str());

    matchingEngine engine(walPath);

    std::vector<double> latenciesUs;
    latenciesUs.reserve(numOrders);

    std::vector<Trade> trades;
    std::string err;

    uint64_t now = nowMs();

    // Warmup accounts
    for (int i = 1; i <= 8; i++) {
        engine.getAccount(1000 + i);
    }

    auto startTotal = std::chrono::high_resolution_clock::now();

    for (int i = 0; i < numOrders; i++) {
        Order order{};
        order.orderID = 0;
        order.accountID = 1001 + (i % 8);
        order.isBuy = (i % 2 == 0) ? 1 : 0;
        order.price = 95 + (i % 10);
        order.quantityRemaining = 1;
        order.tickerID = 1 + (i % NUM_TICKERS);

        auto t0 = std::chrono::high_resolution_clock::now();
        engine.placeOrderDirect(order, now, trades, err);
        auto t1 = std::chrono::high_resolution_clock::now();

        double elapsedUs = std::chrono::duration<double, std::micro>(t1 - t0).count();
        latenciesUs.push_back(elapsedUs);
    }

    auto endTotal = std::chrono::high_resolution_clock::now();
    double totalSeconds = std::chrono::duration<double>(endTotal - startTotal).count();

    std::sort(latenciesUs.begin(), latenciesUs.end());

    double p50 = latenciesUs[numOrders * 0.50];
    double p90 = latenciesUs[numOrders * 0.90];
    double p99 = latenciesUs[numOrders * 0.99];
    double p999 = latenciesUs[numOrders * 0.999];
    double maxLat = latenciesUs.back();
    double avgLat = std::accumulate(latenciesUs.begin(), latenciesUs.end(), 0.0) / numOrders;
    double throughput = numOrders / totalSeconds;

    std::cout << "\n======================================================\n";
    std::cout << "  CORE MATCHING ENGINE BENCHMARK (" << numOrders << " orders)\n";
    std::cout << "======================================================\n";
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "Total Elapsed Time   : " << totalSeconds << " s\n";
    std::cout << "Throughput           : " << throughput << " orders/sec\n";
    std::cout << "Average Latency      : " << avgLat << " us\n";
    std::cout << "Median (p50) Latency : " << p50 << " us\n";
    std::cout << "90th %tile (p90)     : " << p90 << " us\n";
    std::cout << "99th %tile (p99)     : " << p99 << " us\n";
    std::cout << "99.9th %tile (p99.9) : " << p999 << " us\n";
    std::cout << "Max Latency          : " << maxLat << " us\n";
    std::cout << "======================================================\n";

    std::remove(walPath.c_str());
}

void runAsyncPipelineBenchmark(int numOrders) {
    std::string walPath = "benchmark_async.wal";
    std::remove(walPath.c_str());

    matchingEngine engine(walPath);

    uint64_t now = nowMs();

    // Warmup accounts
    for (int i = 1; i <= NUM_WORKERS; i++) {
        engine.getAccount(1000 + i);
    }

    auto startTotal = std::chrono::high_resolution_clock::now();

    for (int i = 0; i < numOrders; i++) {
        Command cmd{};
        cmd.type = CommandType::PLACE_ORDER;
        cmd.now = now;
        cmd.orderPayload.orderID = 0;
        cmd.orderPayload.accountID = 1001 + (i % NUM_WORKERS);
        cmd.orderPayload.isBuy = (i % 2 == 0) ? 1 : 0;
        cmd.orderPayload.price = 95 + (i % 10);
        cmd.orderPayload.quantityRemaining = 1;
        cmd.orderPayload.tickerID = 1 + (i % NUM_TICKERS);

        engine.submitJobToWorker(cmd, -1);
    }

    // Wait until pipeline drains
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    auto endTotal = std::chrono::high_resolution_clock::now();
    double totalSeconds = std::chrono::duration<double>(endTotal - startTotal).count();
    double throughput = numOrders / totalSeconds;

    std::cout << "\n======================================================\n";
    std::cout << "  ASYNC MULTI-THREADED PIPELINE (" << numOrders << " orders)\n";
    std::cout << "  (8 Workers + Epoll + Locked Queues + Engine Handoff)\n";
    std::cout << "======================================================\n";
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "Total Elapsed Time   : " << totalSeconds << " s\n";
    std::cout << "Pipeline Throughput  : " << throughput << " orders/sec\n";
    std::cout << "======================================================\n\n";

    std::remove(walPath.c_str());
}

int main() {
    std::cout << "Starting DarkHold Exchange Performance Benchmark...\n";
    runDirectEngineBenchmark(100000);
    runAsyncPipelineBenchmark(100000);
    return 0;
}
