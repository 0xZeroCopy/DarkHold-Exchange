import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema({
  buyOrderID: { type: Number, required: true },
  sellOrderID: { type: Number, required: true },
  buyerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sellerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventID: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now }
});

export default mongoose.model('Trade', tradeSchema);