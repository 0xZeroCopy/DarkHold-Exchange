import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  tickerId: { type: Number, required: true, unique: true },
  symbol: { type: String, required: true },
  title: { type: String, required: true },
  faceValue: { type: Number, required: true },
  // Anti-scalping collar cap: Dynamic maximum allowable resale price = faceValue * collarMultiplier
  collarMultiplier: { type: Number, default: 2.0 },
  maxCollarPrice: { type: Number, required: true },
  totalTickets: { type: Number, required: true, default: 1000 },
  eventDate: { type: Date, default: () => new Date(Date.now() + 30 * 86400000) }
}, { timestamps: true });

// Auto-calculate maximum collar price before saving
eventSchema.pre('validate', function (next) {
  if (this.faceValue) {
    const mult = this.collarMultiplier || 2.0;
    this.maxCollarPrice = Math.floor(this.faceValue * mult);
  }
  next();
});

export default mongoose.model('Event', eventSchema);