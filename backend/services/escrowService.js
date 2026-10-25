import User from '../models/User.js';

export class EscrowService {
  static async lockEscrow(userId, isBuy, price, quantity) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found. Run node seed.js!");

    const totalCost = price * quantity;

    if (isBuy) {
      if (user.balances.availableCash < totalCost) throw new Error(`Insufficient cash. Need $${totalCost}`);
      user.balances.availableCash -= totalCost;
      user.balances.heldCash += totalCost;
    } else {
      if (user.balances.availableTickets < quantity) throw new Error(`Insufficient tickets. Need ${quantity}`);
      user.balances.availableTickets -= quantity;
      user.balances.heldTickets += quantity;
    }
    
    await user.save();
    return user.balances;
  }

  static async settleTrade(buyerId, sellerId, matchPrice, matchQty) {
    const buyer = await User.findById(buyerId);
    const seller = await User.findById(sellerId);
    
    if (!buyer || !seller) return null;

    const totalTradeValue = matchPrice * matchQty;

    buyer.balances.heldCash -= totalTradeValue;
    buyer.balances.availableTickets += matchQty;

    seller.balances.heldTickets -= matchQty;
    seller.balances.availableCash += totalTradeValue;

    await buyer.save();
    await seller.save();

    return { buyerBalances: buyer.balances, sellerBalances: seller.balances };
  }
}