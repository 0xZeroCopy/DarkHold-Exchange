import mongoose from 'mongoose';

// Login credentials live in their own collection so the trading `User` model (balances, escrow) stays untouched.
// accountId links a login to the trader account used by the exchange and the matching engine.
const credentialSchema = new mongoose.Schema({
  accountId: { type: Number, required: true, unique: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Credential', credentialSchema);
