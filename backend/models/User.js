import mongoose from 'mongoose';

export const DEFAULT_BALANCES = {
  availableCash: 100000,
  heldCash: 0,
  availableTickets: 500,
  heldTickets: 0
};

const userSchema = new mongoose.Schema({
  accountId: { type: Number, required: true, unique: true }, // Maps to uint64_t accountID in C++
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String },
  balances: {
    availableCash: { type: Number, default: DEFAULT_BALANCES.availableCash },
    heldCash: { type: Number, default: DEFAULT_BALANCES.heldCash },
    availableTickets: { type: Number, default: DEFAULT_BALANCES.availableTickets },
    heldTickets: { type: Number, default: DEFAULT_BALANCES.heldTickets }
  }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
