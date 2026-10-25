import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [userId, setUserId] = useState('1001');
  const [balances, setBalances] = useState({
    availableCash: 10000,
    heldCash: 0,
    availableTickets: 50,
    heldTickets: 0
  });

  const [orders, setOrders] = useState([]);
  const [price, setPrice] = useState('180');
  const [quantity, setQuantity] = useState('1');
  const [isBuy, setIsBuy] = useState(true);

  const socketRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5000');
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'REGISTER_USER', userId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'INIT_USER_DATA':
            if (data.balances) setBalances(data.balances);
            if (data.orders) setOrders(data.orders);
            break;

          case 'ORDER_ACCEPTED':
            setOrders((prevOrders) => [
              {
                orderId: data.orderID,
                accountId: data.accountID,
                isBuy: data.isBuy,
                price: data.price,
                quantity: data.quantity,
                quantityRemaining: data.quantity,
                status: 'ESCROWED',
                createdAt: new Date().toLocaleTimeString()
              },
              ...prevOrders
            ]);
            break;

          case 'TRADE_EXECUTED':
            setOrders((prevOrders) =>
              prevOrders.map((order) => {
                if (Number(order.price) === Number(data.price) && order.status === 'ESCROWED') {
                  const currentQty = order.quantityRemaining ?? order.quantity;
                  const updatedQty = Math.max(0, currentQty - data.quantity);
                  return {
                    ...order,
                    quantityRemaining: updatedQty,
                    status: updatedQty === 0 ? 'FILLED' : 'PARTIALLY_FILLED'
                  };
                }
                return order;
              })
            );
            break;

          case 'BALANCE_UPDATE':
            if (data.balances) setBalances(data.balances);
            break;

          case 'ORDER_CANCELLED':
            setOrders((prevOrders) =>
              prevOrders.map((order) =>
                (order.orderId || order.orderID) === data.orderID ? { ...order, status: 'CANCELLED' } : order
              )
            );
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [userId]);

  const handleSubmitOrder = (e) => {
    e.preventDefault();
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    socketRef.current.send(
      JSON.stringify({
        action: 'SUBMIT_ORDER',
        userId: Number(userId),
        isBuy: isBuy,
        price: Number(price),
        quantity: Number(quantity)
      })
    );
  };

  const handleCancelOrder = (orderID) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    socketRef.current.send(
      JSON.stringify({
        action: 'CANCEL_ORDER',
        orderID: orderID
      })
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header & User Switcher */}
        <header className="flex justify-between items-center bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-800">THE DARKHOLD EXCHANGE</h1>
            <p className="text-sm text-gray-500 mt-1">C++ TCP Matching Engine + Node Gateway</p>
          </div>
          <div className="flex items-center space-x-3">
            <label className="text-sm font-medium text-gray-600">Switch User:</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="bg-white border border-gray-300 text-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1001">Trader #1001</option>
              <option value="1002">Trader #1002</option>
            </select>
          </div>
        </header>

        {/* Account Balances Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available Cash</p>
            <p className="text-xl font-bold text-gray-800 mt-1">${balances.availableCash}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Escrowed Cash</p>
            <p className="text-xl font-bold text-gray-800 mt-1">${balances.heldCash}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available Tickets</p>
            <p className="text-xl font-bold text-gray-800 mt-1">{balances.availableTickets}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Escrowed Tickets</p>
            <p className="text-xl font-bold text-gray-800 mt-1">{balances.heldTickets}</p>
          </div>
        </div>

        {/* Order Form & Active Ledger */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Order Placement Form */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-fit">
            <h2 className="text-lg font-bold text-gray-800 mb-4 uppercase">Place Order</h2>
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsBuy(true)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${
                    isBuy ? 'bg-green-100 text-green-700 shadow-sm border border-green-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setIsBuy(false)}
                  className={`flex-1 py-2 rounded-md font-semibold text-sm transition-all ${
                    !isBuy ? 'bg-pink-100 text-pink-700 shadow-sm border border-pink-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  SELL
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">PRICE ($)</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">QUANTITY</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <button
                type="submit"
                className={`w-full py-3 rounded-lg font-bold transition-all shadow-sm mt-2 ${
                  isBuy
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                Submit {isBuy ? 'Buy' : 'Sell'} Order
              </button>
            </form>
          </div>

          {/* Order Ledger Table */}
          <div className="md:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">ORDER LEDGER</h2>
              <span className="text-sm font-medium text-gray-400">{orders.length} Order(s) Recorded</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="text-xs text-gray-400 uppercase font-semibold border-b border-gray-100">
                  <tr>
                    <th className="pb-3 px-2">ORDER ID</th>
                    <th className="pb-3 px-2">TYPE</th>
                    <th className="pb-3 px-2">PRICE</th>
                    <th className="pb-3 px-2">QTY</th>
                    <th className="pb-3 px-2">STATUS</th>
                    <th className="pb-3 px-2 text-right">TIME / ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-8 text-center text-gray-400 font-medium">
                        No orders recorded yet.
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => {
                      const currentOrderID = order.orderId || order.orderID;
                      const displayQty = order.quantityRemaining ?? order.quantity;
                      return (
                        <tr key={currentOrderID} className="hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-2 font-bold text-gray-800">#{currentOrderID}</td>
                          <td className="py-4 px-2">
                            <span
                              className={`px-2.5 py-1 rounded text-xs font-bold tracking-wide ${
                                order.isBuy
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-pink-100 text-pink-700'
                              }`}
                            >
                              {order.isBuy ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="py-4 px-2 font-bold text-gray-800">${Number(order.price).toFixed(2)}</td>
                          <td className="py-4 px-2 font-medium">{displayQty}</td>
                          <td className="py-4 px-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-bold border tracking-wide ${
                                order.status === 'FILLED'
                                  ? 'bg-green-50 text-green-600 border-green-200'
                                  : order.status === 'PARTIALLY_FILLED'
                                  ? 'bg-yellow-50 text-yellow-600 border-yellow-200'
                                  : order.status === 'CANCELLED'
                                  ? 'bg-red-50 text-red-600 border-red-200'
                                  : 'bg-blue-50 text-blue-500 border-blue-200'
                              }`}
                            >
                              {order.status}
                            </span>
                          </td>
                          <td className="py-4 px-2 text-right">
                            {order.status === 'ESCROWED' ? (
                              <button
                                onClick={() => handleCancelOrder(currentOrderID)}
                                className="text-xs font-semibold text-red-500 hover:text-red-700 underline"
                              >
                                Cancel
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">{order.createdAt || '--'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}