import User from '../models/User.js';

export class EscrowService {
  static async lockEscrow(userId, isBuy, price, quantity) {
    const total = price * quantity;
    const query = isBuy 
      ? { _id: userId, 'balances.availableCash': { $gte: total } }
      : { _id: userId, 'balances.availableTickets': { $gte: quantity } };
      
    const update = isBuy
      ? { $inc: { 'balances.availableCash': -total, 'balances.heldCash': total } }
      : { $inc: { 'balances.availableTickets': -quantity, 'balances.heldTickets': quantity } };

    const user = await User.findOneAndUpdate(query, update, { new: true });
    if (!user) throw new Error("Insufficient balance or user not found.");
    return user.balances;
  }

  static async settleTrade(buyerId, sellerId, matchPrice, matchQty, originalBuyPrice) {
    const cost = matchPrice * matchQty;
    const refund = (originalBuyPrice - matchPrice) * matchQty; 

    await Promise.all([
      User.updateOne({ _id: buyerId }, {
        $inc: { 
          'balances.heldCash': -(cost + refund), 
          'balances.availableCash': refund, 
          'balances.availableTickets': matchQty 
        }
      }),
      User.updateOne({ _id: sellerId }, {
        $inc: { 'balances.heldTickets': -matchQty, 'balances.availableCash': cost }
      })
    ]);
  }
}