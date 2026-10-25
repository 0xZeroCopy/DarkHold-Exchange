import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: { type: Number, required: true, unique: true }, // Maps to uint64_t orderID in C++
  accountId: { type: Number, required: true },
  isBuy: { type: Boolean, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  quantityRemaining: { type: Number, required: true },
  status: { type: String, enum: ['ESCROWED', 'FILLED', 'CANCELLED'], default: 'ESCROWED' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Order', orderSchema);