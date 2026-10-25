import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  accountId: { type: Number, required: true, unique: true }, // Maps to uint64_t accountID in C++
  name: { type: String, required: true },
  balances: {
    availableCash: { type: Number, default: 2500.00 },
    heldCash: { type: Number, default: 0.00 },
    availableTickets: { type: Number, default: 10 },
    heldTickets: { type: Number, default: 0 }
  }
});

export default mongoose.model('User', userSchema);