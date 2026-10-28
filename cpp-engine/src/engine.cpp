#include "engine.h"

#include <sys/socket.h>

static inline void writeEvent(int fd) {
    if (fd >= 0) {
        uint64_t one = 1;
        ssize_t s = write(fd, &one, sizeof(one));
        (void)s;
    }
}

static inline void readEvent(int fd) {
    if (fd >= 0) {
        uint64_t val = 0;
        ssize_t s = read(fd, &val, sizeof(val));
        (void)s;
    }
}

void WorkerQueue::init() {
    if (eventFd < 0) {
        eventFd = eventfd(0, EFD_NONBLOCK);
    }
}

void WorkerQueue::closeFd() {
    if (eventFd >= 0) {
        close(eventFd);
        eventFd = -1;
    }
}

void WorkerQueue::push(WorkerJob job) {
    {
        std::lock_guard<std::mutex> lock(mtx);
        jobs.push_back(job);
    }
    writeEvent(eventFd);
}

bool WorkerQueue::pop(WorkerJob& job) {
    std::lock_guard<std::mutex> lock(mtx);
    if (jobs.empty()) return false;
    job = jobs.front();
    jobs.erase(jobs.begin());
    return true;
}

void EngineQueue::init() {
    if (eventFd < 0) {
        eventFd = eventfd(0, EFD_NONBLOCK);
    }
}

void EngineQueue::closeFd() {
    if (eventFd >= 0) {
        close(eventFd);
        eventFd = -1;
    }
}

void EngineQueue::push(EngineJob* job) {
    {
        std::lock_guard<std::mutex> lock(mtx);
        jobs.push_back(job);
    }
    writeEvent(eventFd);
}

bool EngineQueue::pop(EngineJob*& job) {
    std::lock_guard<std::mutex> lock(mtx);
    if (jobs.empty()) return false;
    job = jobs.front();
    jobs.erase(jobs.begin());
    return true;
}

void ResponseQueue::init() {
    if (eventFd < 0) {
        eventFd = eventfd(0, EFD_NONBLOCK);
    }
}

void ResponseQueue::closeFd() {
    if (eventFd >= 0) {
        close(eventFd);
        eventFd = -1;
    }
}

void ResponseQueue::push(EngineJob* job) {
    {
        std::lock_guard<std::mutex> lock(mtx);
        jobs.push_back(job);
    }
    writeEvent(eventFd);
}

bool ResponseQueue::pop(EngineJob*& job) {
    std::lock_guard<std::mutex> lock(mtx);
    if (jobs.empty()) return false;
    job = jobs.front();
    jobs.erase(jobs.begin());
    return true;
}

void WalQueue::init() {
    if (eventFd < 0) {
        eventFd = eventfd(0, EFD_NONBLOCK);
    }
}

void WalQueue::closeFd() {
    if (eventFd >= 0) {
        close(eventFd);
        eventFd = -1;
    }
}

void WalQueue::push(Command cmd) {
    {
        std::lock_guard<std::mutex> lock(mtx);
        items.push_back(cmd);
    }
    writeEvent(eventFd);
}

bool WalQueue::pop(Command& cmd) {
    std::lock_guard<std::mutex> lock(mtx);
    if (items.empty()) return false;
    cmd = items.front();
    items.erase(items.begin());
    return true;
}

Worker::~Worker() {
    stop();
}

void Worker::start() {
    workerQueue.init();
    responseQueue.init();
    epollFd = epoll_create1(0);

    struct epoll_event ev{};
    ev.events = EPOLLIN;
    ev.data.fd = workerQueue.eventFd;
    epoll_ctl(epollFd, EPOLL_CTL_ADD, workerQueue.eventFd, &ev);

    struct epoll_event evResp{};
    evResp.events = EPOLLIN;
    evResp.data.fd = responseQueue.eventFd;
    epoll_ctl(epollFd, EPOLL_CTL_ADD, responseQueue.eventFd, &evResp);

    running = true;
    workerThread = std::thread(&Worker::run, this);
}

void Worker::stop() {
    if (!running) return;
    running = false;

    // Wake epoll loop so thread can exit cleanly
    writeEvent(workerQueue.eventFd);

    if (workerThread.joinable()) {
        workerThread.join();
    }

    if (epollFd >= 0) {
        close(epollFd);
        epollFd = -1;
    }
    workerQueue.closeFd();
    responseQueue.closeFd();

    EngineJob* pending = nullptr;
    while (responseQueue.pop(pending)) {
        delete pending;
    }
}

Account Worker::getAccountCopy(uint64_t accountID) {
    std::lock_guard<std::mutex> lock(accountMtx);
    if (accounts.find(accountID) == accounts.end()) {
        Account acc;
        acc.accountID = accountID;
        accounts[accountID] = acc;
    }
    return accounts[accountID];
}

uint64_t Worker::makeOrderID() {
    uint64_t id = (orderCounter << 3) | (workerID & 0x7);
    orderCounter++;
    return id;
}

bool Worker::lockEscrow(Order& order, std::string& errorMsg) {
    if (order.tickerID == 0) {
        order.tickerID = 1;
    }
    if (order.tickerID > NUM_TICKERS) {
        errorMsg = "Invalid ticker ID (must be 1 to 5)";
        return false;
    }

    std::lock_guard<std::mutex> lock(accountMtx);

    if (accounts.find(order.accountID) == accounts.end()) {
        Account acc;
        acc.accountID = order.accountID;
        accounts[order.accountID] = acc;
    }

    Account& acc = accounts[order.accountID];

    if (order.price > MAX_PRICE) {
        errorMsg = "Price too high (max is 200)";
        return false;
    }

    if (order.quantityRemaining == 0 || order.quantityRemaining > 1000) {
        errorMsg = "Quantity must be between 1 and 1000";
        return false;
    }

    if (order.isBuy) {
        uint64_t totalCost = (uint64_t)order.price * order.quantityRemaining;
        if (acc.availableCash < totalCost) {
            errorMsg = "Not enough cash for escrow";
            return false;
        }
        acc.availableCash -= totalCost;
        acc.heldCash += totalCost;
    } else {
        if (acc.availableTickets[order.tickerID] < order.quantityRemaining) {
            errorMsg = "Not enough tickets for escrow";
            return false;
        }
        acc.availableTickets[order.tickerID] -= order.quantityRemaining;
        acc.heldTickets[order.tickerID] += order.quantityRemaining;
    }

    acc.openOrders++;
    return true;
}

void Worker::releaseEscrow(uint64_t accountID, bool isBuy, uint32_t price, uint32_t qty, uint32_t tickerID) {
    if (qty == 0) return;
    if (tickerID < 1 || tickerID > NUM_TICKERS) tickerID = 1;
    std::lock_guard<std::mutex> lock(accountMtx);

    if (accounts.find(accountID) == accounts.end()) return;
    Account& acc = accounts[accountID];

    if (isBuy) {
        uint64_t money = (uint64_t)price * qty;
        if (acc.heldCash >= money) {
            acc.heldCash -= money;
            acc.availableCash += money;
        }
    } else {
        if (acc.heldTickets[tickerID] >= qty) {
            acc.heldTickets[tickerID] -= qty;
            acc.availableTickets[tickerID] += qty;
        }
    }
    if (acc.openOrders > 0) acc.openOrders--;
}

void Worker::applyTrade(const Trade& trade, bool isBuyer) {
    uint32_t tId = trade.tickerID;
    if (tId < 1 || tId > NUM_TICKERS) tId = 1;
    std::lock_guard<std::mutex> lock(accountMtx);

    if (isBuyer) {
        if (accounts.find(trade.buyerID) == accounts.end()) {
            Account acc;
            acc.accountID = trade.buyerID;
            accounts[trade.buyerID] = acc;
        }
        Account& buyer = accounts[trade.buyerID];
        uint64_t escrowHeld = (uint64_t)trade.buyerLimitPrice * trade.quantityFulfilled;
        uint64_t actualCost = (uint64_t)trade.price * trade.quantityFulfilled;

        if (buyer.heldCash >= escrowHeld) {
            buyer.heldCash -= escrowHeld;
        } else {
            buyer.heldCash = 0;
        }

        if (escrowHeld > actualCost) {
            buyer.availableCash += (escrowHeld - actualCost);
        }
        buyer.availableTickets[tId] += trade.quantityFulfilled;
    } else {
        if (accounts.find(trade.sellerID) == accounts.end()) {
            Account acc;
            acc.accountID = trade.sellerID;
            accounts[trade.sellerID] = acc;
        }
        Account& seller = accounts[trade.sellerID];
        uint64_t cashEarned = (uint64_t)trade.price * trade.quantityFulfilled;

        if (seller.heldTickets[tId] >= trade.quantityFulfilled) {
            seller.heldTickets[tId] -= trade.quantityFulfilled;
        } else {
            seller.heldTickets[tId] = 0;
        }
        seller.availableCash += cashEarned;
    }
}

void Worker::run() {
    struct epoll_event events[8];

    while (running) {
        int n = epoll_wait(epollFd, events, 8, 100);
        if (n <= 0) continue;

        for (int i = 0; i < n; i++) {
            if (events[i].data.fd == workerQueue.eventFd) {
                readEvent(workerQueue.eventFd);

                WorkerJob job;
                while (workerQueue.pop(job)) {
                    if (job.cmd.type == CommandType::PLACE_ORDER) {
                        Order order = job.cmd.orderPayload;
                        if (order.tickerID == 0) order.tickerID = 1;
                        std::string errorMsg;

                        // Step 1 & 2: Check balance and perform escrow
                        if (!lockEscrow(order, errorMsg)) {
                            if (job.clientFd >= 0) {
                                std::string errStr = "E " + errorMsg + "\n";
                                send(job.clientFd, errStr.data(), errStr.size(), 0);
                            }
                            continue;
                        }

                        // Step 3: Attach OrderID
                        if (order.orderID == 0) {
                            order.orderID = makeOrderID();
                        }
                        if (order.expiresAt == 0) {
                            order.expiresAt = nowMs() + EXPIRY_DURATION;
                        }
                        job.cmd.orderPayload = order;

                        // Step 4: Log decision to WAL
                        engine->logWal(job.cmd);

                        // Step 5: Hand over to engine on heap
                        EngineJob* eJob = new EngineJob();
                        eJob->cmd = job.cmd;
                        eJob->workerID = workerID;
                        eJob->clientFd = job.clientFd;
                        eJob->cancelSuccess = false;

                        engine->submitJobToEngine(eJob);
                    } else if (job.cmd.type == CommandType::CANCEL_ORDER) {
                        if (job.cmd.cancelOrderID == 0) {
                            if (job.clientFd >= 0) {
                                std::string out = "X none\n";
                                send(job.clientFd, out.data(), out.size(), 0);
                            }
                            continue;
                        }

                        engine->logWal(job.cmd);

                        EngineJob* eJob = new EngineJob();
                        eJob->cmd = job.cmd;
                        eJob->workerID = workerID;
                        eJob->clientFd = job.clientFd;
                        eJob->cancelSuccess = false;

                        engine->submitJobToEngine(eJob);
                    } else if (job.cmd.type == CommandType::GET_BALANCE) {
                        Account acc = getAccountCopy(job.cmd.orderPayload.accountID);
                        uint32_t tId = job.cmd.orderPayload.tickerID;
                        if (tId < 1 || tId > NUM_TICKERS) tId = 1;
                        if (job.clientFd >= 0) {
                            std::string out = "B " + std::to_string(acc.accountID) + " "
                                            + std::to_string(acc.availableCash) + " "
                                            + std::to_string(acc.heldCash) + " "
                                            + std::to_string(acc.availableTickets[tId]) + " "
                                            + std::to_string(acc.heldTickets[tId]) + "\n";
                            send(job.clientFd, out.data(), out.size(), 0);
                        }
                    }
                }
            } else if (events[i].data.fd == responseQueue.eventFd) {
                readEvent(responseQueue.eventFd);

                EngineJob* resJob = nullptr;
                while (responseQueue.pop(resJob)) {
                    if (!resJob) continue;

                    if (resJob->cmd.type == CommandType::PLACE_ORDER) {
                        if (resJob->clientFd >= 0) {
                            std::string out;
                            for (const auto& t : resJob->trades) {
                                out += "F " + std::to_string(t.tradeID) + " " + std::to_string(t.price) + " " + std::to_string(t.quantityFulfilled) + "\n";
                            }
                            if (!out.empty()) {
                                send(resJob->clientFd, out.data(), out.size(), 0);
                            }
                        }
                    } else if (resJob->cmd.type == CommandType::CANCEL_ORDER) {
                        if (resJob->clientFd >= 0) {
                            std::string out = resJob->cancelSuccess ? "X ok\n" : "X none\n";
                            send(resJob->clientFd, out.data(), out.size(), 0);
                        }
                    }

                    delete resJob;
                }
            }
        }
    }
}

matchingEngine::matchingEngine(const std::string& walPath) : walFilePath(walPath) {
    for (uint32_t t = 1; t <= NUM_TICKERS; t++) {
        orderBooks[t].tickerID = t;
    }
    for (int i = 0; i < NUM_WORKERS; i++) {
        workers[i].workerID = i;
        workers[i].engine = this;
    }
    start();
}

matchingEngine::~matchingEngine() {
    stop();
}

void matchingEngine::start() {
    engineQueue.init();
    engineEpollFd = epoll_create1(0);
    struct epoll_event evEng{};
    evEng.events = EPOLLIN;
    evEng.data.fd = engineQueue.eventFd;
    epoll_ctl(engineEpollFd, EPOLL_CTL_ADD, engineQueue.eventFd, &evEng);

    walQueue.init();
    walEpollFd = epoll_create1(0);
    struct epoll_event evWal{};
    evWal.events = EPOLLIN;
    evWal.data.fd = walQueue.eventFd;
    epoll_ctl(walEpollFd, EPOLL_CTL_ADD, walQueue.eventFd, &evWal);

    for (int i = 0; i < NUM_WORKERS; i++) {
        workers[i].start();
    }

    engineRunning = true;
    engineThread = std::thread(&matchingEngine::runEngine, this);

    walRunning = true;
    walWriterThread = std::thread(&matchingEngine::runWalWriter, this);

    depthRunning = true;
    depthThread = std::thread([this]() {
        while (depthRunning) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            updateDepthSnapshot();
        }
    });
}

void matchingEngine::stop() {
    depthRunning = false;
    if (depthThread.joinable()) {
        depthThread.join();
    }

    engineRunning = false;
    writeEvent(engineQueue.eventFd);
    if (engineThread.joinable()) {
        engineThread.join();
    }
    if (engineEpollFd >= 0) {
        close(engineEpollFd);
        engineEpollFd = -1;
    }
    EngineJob* pending = nullptr;
    while (engineQueue.pop(pending)) {
        delete pending;
    }
    engineQueue.closeFd();

    for (int i = 0; i < NUM_WORKERS; i++) {
        workers[i].stop();
    }

    walRunning = false;
    writeEvent(walQueue.eventFd);
    if (walWriterThread.joinable()) {
        walWriterThread.join();
    }
    if (walEpollFd >= 0) {
        close(walEpollFd);
        walEpollFd = -1;
    }
    walQueue.closeFd();
}

void matchingEngine::runWalWriter() {
    std::ofstream walFile(walFilePath, std::ios::out | std::ios::app | std::ios::binary);
    struct epoll_event events[4];

    while (walRunning) {
        int n = epoll_wait(walEpollFd, events, 4, 100);
        if (n <= 0) continue;

        for (int i = 0; i < n; i++) {
            if (events[i].data.fd == walQueue.eventFd) {
                readEvent(walQueue.eventFd);

                Command cmd;
                while (walQueue.pop(cmd)) {
                    if (walFile.is_open()) {
                        walFile.write((const char*)&cmd, sizeof(Command));
                        walFile.flush();
                    }
                }
            }
        }
    }
}

void matchingEngine::logWal(const Command& cmd) {
    walQueue.push(cmd);
}

void matchingEngine::submitJobToWorker(const Command& cmd, int clientFd) {
    int workerID = 0;
    if (cmd.type == CommandType::CANCEL_ORDER) {
        workerID = (cmd.cancelOrderID == 0) ? 0 : (cmd.cancelOrderID & 0x7);
    } else {
        workerID = cmd.orderPayload.accountID % NUM_WORKERS;
    }
    workers[workerID].workerQueue.push({ cmd, clientFd });
}

void matchingEngine::submitJobToEngine(EngineJob* job) {
    engineQueue.push(job);
}

void matchingEngine::runEngine() {
    struct epoll_event events[4];

    while (engineRunning) {
        int n = epoll_wait(engineEpollFd, events, 4, 100);
        if (n <= 0) continue;

        for (int i = 0; i < n; i++) {
            if (events[i].data.fd == engineQueue.eventFd) {
                readEvent(engineQueue.eventFd);

                EngineJob* job = nullptr;
                while (engineQueue.pop(job)) {
                    if (!job) continue;

                    if (job->cmd.type == CommandType::PLACE_ORDER) {
                        executeOrder(job->cmd.orderPayload, job->trades);
                    } else if (job->cmd.type == CommandType::CANCEL_ORDER) {
                        job->cancelSuccess = executeCancel(job->cmd.cancelOrderID);
                    }

                    job->done = true;
                    if (job->workerID >= 0 && job->workerID < NUM_WORKERS) {
                        workers[job->workerID].responseQueue.push(job);
                    } else {
                        delete job;
                    }
                }
            }
        }
    }
}

Worker& matchingEngine::getWorker(uint64_t accountID) {
    int idx = accountID % NUM_WORKERS;
    return workers[idx];
}

Account matchingEngine::getAccount(uint64_t accountID) {
    return getWorker(accountID).getAccountCopy(accountID);
}

DepthSnapshot matchingEngine::getDepth(uint32_t tickerID) {
    std::lock_guard<std::mutex> lock(engineMutex);
    if (tickerID < 1 || tickerID > NUM_TICKERS) tickerID = 1;
    return currentDepth[tickerID];
}

void matchingEngine::updateDepthSnapshot() {
    std::lock_guard<std::mutex> lock(engineMutex);
    for (uint32_t t = 1; t <= NUM_TICKERS; t++) {
        OrderBook& book = orderBooks[t];
        DepthSnapshot& snap = currentDepth[t];
        snap.tickerID = t;
        snap.lastPrice = book.lastTradedPrice;
        snap.bids.clear();
        snap.asks.clear();

        size_t count = 0;
        for (auto& pair : book.priceLevelsBuy) {
            if (count++ >= 10) break;
            uint32_t qty = 0;
            for (auto& o : pair.second) qty += o.quantityRemaining;
            snap.bids.push_back({ pair.first, qty });
        }

        count = 0;
        for (auto& pair : book.priceLevelsSell) {
            if (count++ >= 10) break;
            uint32_t qty = 0;
            for (auto& o : pair.second) qty += o.quantityRemaining;
            snap.asks.push_back({ pair.first, qty });
        }
    }
}

void matchingEngine::checkExpiration(uint64_t currentTime) {
    while (!expireQueue.empty() && currentTime > expireQueue.front().expiresAt) {
        uint64_t expID = expireQueue.front().orderID;
        expireQueue.erase(expireQueue.begin());

        if (orderToTicker.find(expID) != orderToTicker.end()) {
            executeCancel(expID);
        }
    }
}

void matchingEngine::executeOrder(Order order, std::vector<Trade>& trades) {
    std::lock_guard<std::mutex> lock(engineMutex);

    if (order.tickerID < 1 || order.tickerID > NUM_TICKERS) {
        order.tickerID = 1;
    }
    uint32_t tId = order.tickerID;
    OrderBook& book = orderBooks[tId];

    uint64_t now = (order.expiresAt > EXPIRY_DURATION) ? (order.expiresAt - EXPIRY_DURATION) : nowMs();
    checkExpiration(now);

    bool isBuy = (order.isBuy != 0);

    if (isBuy) {
        while (!book.priceLevelsSell.empty() && order.quantityRemaining > 0) {
            uint32_t bestAsk = book.priceLevelsSell.begin()->first;
            if (!order.isMarket && order.price < bestAsk) {
                break;
            }

            Level& level = book.priceLevelsSell.begin()->second;
            Order& bestOrder = level.front();

            uint32_t matchQty = std::min(order.quantityRemaining, bestOrder.quantityRemaining);
            uint32_t matchPrice = bestOrder.price;

            order.quantityRemaining -= matchQty;
            bestOrder.quantityRemaining -= matchQty;

            tradeID++;
            book.lastTradedPrice = matchPrice;

            Trade t{};
            t.tradeID = tradeID;
            t.buyOrderID = order.orderID;
            t.sellOrderID = bestOrder.orderID;
            t.quantityFulfilled = matchQty;
            t.price = matchPrice;
            t.buyerID = order.accountID;
            t.sellerID = bestOrder.accountID;
            t.buyerLimitPrice = order.price;
            t.tickerID = tId;
            trades.push_back(t);

            getWorker(t.buyerID).applyTrade(t, true);
            getWorker(t.sellerID).applyTrade(t, false);

            if (bestOrder.quantityRemaining == 0) {
                book.activeOrders.erase(bestOrder.orderID);
                book.orderSide.erase(bestOrder.orderID);
                book.originalLimitPrice.erase(bestOrder.orderID);
                orderToTicker.erase(bestOrder.orderID);
                level.pop_front();
                if (level.empty()) {
                    book.priceLevelsSell.erase(book.priceLevelsSell.begin());
                }
            }
        }

        if (order.quantityRemaining > 0) {
            if (!order.isMarket) {
                Level& level = book.priceLevelsBuy[order.price];
                level.push_back(order);
                book.activeOrders[order.orderID] = { order.price, std::prev(level.end()) };
                book.orderSide[order.orderID] = true;
                book.originalLimitPrice[order.orderID] = order.price;
                orderToTicker[order.orderID] = tId;
                expireQueue.push_back({ order.expiresAt, order.orderID, tId });
            } else {
                getWorker(order.accountID).releaseEscrow(order.accountID, true, order.price, order.quantityRemaining, tId);
            }
        }
    } else {
        while (!book.priceLevelsBuy.empty() && order.quantityRemaining > 0) {
            uint32_t bestBid = book.priceLevelsBuy.begin()->first;
            if (!order.isMarket && order.price > bestBid) {
                break;
            }

            Level& level = book.priceLevelsBuy.begin()->second;
            Order& bestOrder = level.front();

            uint32_t matchQty = std::min(order.quantityRemaining, bestOrder.quantityRemaining);
            uint32_t matchPrice = bestOrder.price;

            order.quantityRemaining -= matchQty;
            bestOrder.quantityRemaining -= matchQty;

            tradeID++;
            book.lastTradedPrice = matchPrice;

            Trade t{};
            t.tradeID = tradeID;
            t.buyOrderID = bestOrder.orderID;
            t.sellOrderID = order.orderID;
            t.quantityFulfilled = matchQty;
            t.price = matchPrice;
            t.buyerID = bestOrder.accountID;
            t.sellerID = order.accountID;
            t.buyerLimitPrice = bestOrder.price;
            t.tickerID = tId;
            trades.push_back(t);

            getWorker(t.buyerID).applyTrade(t, true);
            getWorker(t.sellerID).applyTrade(t, false);

            if (bestOrder.quantityRemaining == 0) {
                book.activeOrders.erase(bestOrder.orderID);
                book.orderSide.erase(bestOrder.orderID);
                book.originalLimitPrice.erase(bestOrder.orderID);
                orderToTicker.erase(bestOrder.orderID);
                level.pop_front();
                if (level.empty()) {
                    book.priceLevelsBuy.erase(book.priceLevelsBuy.begin());
                }
            }
        }

        if (order.quantityRemaining > 0) {
            if (!order.isMarket) {
                Level& level = book.priceLevelsSell[order.price];
                level.push_back(order);
                book.activeOrders[order.orderID] = { order.price, std::prev(level.end()) };
                book.orderSide[order.orderID] = false;
                book.originalLimitPrice[order.orderID] = order.price;
                orderToTicker[order.orderID] = tId;
                expireQueue.push_back({ order.expiresAt, order.orderID, tId });
            } else {
                getWorker(order.accountID).releaseEscrow(order.accountID, false, order.price, order.quantityRemaining, tId);
            }
        }
    }
}

bool matchingEngine::executeCancel(uint64_t cancelOrderID) {
    std::lock_guard<std::mutex> lock(engineMutex);

    auto itTicker = orderToTicker.find(cancelOrderID);
    if (itTicker == orderToTicker.end()) {
        return false;
    }

    uint32_t tId = itTicker->second;
    OrderBook& book = orderBooks[tId];

    auto it = book.activeOrders.find(cancelOrderID);
    if (it == book.activeOrders.end()) {
        orderToTicker.erase(itTicker);
        return false;
    }

    uint32_t price = it->second.first;
    OrderIt orderIt = it->second.second;
    Order cancelledOrder = *orderIt;
    bool isBuy = book.orderSide[cancelOrderID];

    if (isBuy) {
        auto levelIt = book.priceLevelsBuy.find(price);
        if (levelIt != book.priceLevelsBuy.end()) {
            levelIt->second.erase(orderIt);
            if (levelIt->second.empty()) {
                book.priceLevelsBuy.erase(levelIt);
            }
        }
    } else {
        auto levelIt = book.priceLevelsSell.find(price);
        if (levelIt != book.priceLevelsSell.end()) {
            levelIt->second.erase(orderIt);
            if (levelIt->second.empty()) {
                book.priceLevelsSell.erase(levelIt);
            }
        }
    }

    book.activeOrders.erase(it);
    book.orderSide.erase(cancelOrderID);
    book.originalLimitPrice.erase(cancelOrderID);
    orderToTicker.erase(itTicker);

    getWorker(cancelledOrder.accountID).releaseEscrow(cancelledOrder.accountID, isBuy, cancelledOrder.price, cancelledOrder.quantityRemaining, tId);
    return true;
}

bool matchingEngine::placeOrderDirect(Order& order, uint64_t now, std::vector<Trade>& trades, std::string& errorMsg) {
    if (order.tickerID == 0) order.tickerID = 1;
    Worker& worker = getWorker(order.accountID);

    if (!worker.lockEscrow(order, errorMsg)) {
        return false;
    }

    if (order.orderID == 0) {
        order.orderID = worker.makeOrderID();
    }

    if (order.expiresAt <= now) {
        order.expiresAt = now + EXPIRY_DURATION;
    }

    Command cmd{};
    cmd.sequenceNumber = nextSequenceNumber++;
    cmd.type = CommandType::PLACE_ORDER;
    cmd.orderPayload = order;
    cmd.now = now;
    logWal(cmd);

    executeOrder(order, trades);
    return true;
}

bool matchingEngine::cancelOrderDirect(uint64_t cancelOrderID) {
    Command cmd{};
    cmd.sequenceNumber = nextSequenceNumber++;
    cmd.type = CommandType::CANCEL_ORDER;
    cmd.cancelOrderID = cancelOrderID;
    cmd.now = nowMs();
    logWal(cmd);

    return executeCancel(cancelOrderID);
}

void matchingEngine::recoverFromWAL(const std::string& path) {
    std::ifstream in(path, std::ios::in | std::ios::binary);
    if (!in.is_open()) return;

    isRecovering = true;
    Command cmd;
    int count = 0;

    while (in.read((char*)&cmd, sizeof(Command))) {
        if (cmd.type == CommandType::CANCEL_ORDER) {
            executeCancel(cmd.cancelOrderID);
        } else if (cmd.type == CommandType::PLACE_ORDER) {
            Order order = cmd.orderPayload;
            if (order.tickerID == 0) order.tickerID = 1;
            Worker& worker = getWorker(order.accountID);
            std::string err;
            worker.lockEscrow(order, err);
            std::vector<Trade> trades;
            executeOrder(order, trades);
        }
        if (cmd.sequenceNumber >= nextSequenceNumber) {
            nextSequenceNumber = cmd.sequenceNumber + 1;
        }
        count++;
    }

    isRecovering = false;
    std::cout << "Reloaded " << count << " commands from WAL file\n";
}

void matchingEngine::printOrderBook(uint32_t tickerID) {
    std::lock_guard<std::mutex> lock(engineMutex);
    uint32_t start = (tickerID >= 1 && tickerID <= NUM_TICKERS) ? tickerID : 1;
    uint32_t end = (tickerID >= 1 && tickerID <= NUM_TICKERS) ? tickerID : NUM_TICKERS;

    for (uint32_t t = start; t <= end; t++) {
        std::cout << "\n=== TICKER " << t << " SELL ORDERS ===\n";
        for (auto it = orderBooks[t].priceLevelsSell.rbegin(); it != orderBooks[t].priceLevelsSell.rend(); ++it) {
            std::cout << "$" << it->first << " | count: " << it->second.size() << "\n";
        }
        std::cout << "=== TICKER " << t << " BUY ORDERS ===\n";
        for (auto& pair : orderBooks[t].priceLevelsBuy) {
            std::cout << "$" << pair.first << " | count: " << pair.second.size() << "\n";
        }
    }
    std::cout << "===================\n";
}
