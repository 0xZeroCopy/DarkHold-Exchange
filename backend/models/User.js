import mongoose from 'mongoose';

export const DEFAULT_BALANCES = { availableCash: 100000, heldCash: 0, availableTickets: 500, heldTickets: 0 };

const userSchema = new mongoose.Schema({
  accountId: { type: Number, required: true, unique: true }, // Maps to uint64_t accountID in C++
  name: { type: String, required: true },
  balances: {
    availableCash: { type: Number, default: DEFAULT_BALANCES.availableCash },
    heldCash: { type: Number, default: DEFAULT_BALANCES.heldCash },
    availableTickets: { type: Number, default: DEFAULT_BALANCES.availableTickets },
    heldTickets: { type: Number, default: DEFAULT_BALANCES.heldTickets }
  }
});

export default mongoose.model('User', userSchema);
