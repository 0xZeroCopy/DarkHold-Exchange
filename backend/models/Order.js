import mongoose from 'mongoose';

export const OPEN_STATUSES = ['ESCROWED', 'PARTIALLY_FILLED'];

const orderSchema = new mongoose.Schema({
  orderId: { type: Number, required: true, unique: true }, // Maps to uint64_t orderID in C++
  accountId: { type: Number, required: true, index: true },
  isBuy: { type: Boolean, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  quantityRemaining: { type: Number, required: true },
  status: {
    type: String,
    enum: ['ESCROWED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
    default: 'ESCROWED',
    index: true
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
});

export default mongoose.model('Order', orderSchema);
