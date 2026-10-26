import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema({
  tradeId: { type: Number, required: true }, // trade counter from the C++ engine
  buyOrderId: { type: Number, required: true },
  sellOrderId: { type: Number, required: true },
  buyerId: { type: Number, required: true },  // accountId
  sellerId: { type: Number, required: true }, // accountId
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true }
});

export default mongoose.model('Trade', tradeSchema);
