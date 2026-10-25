import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  faceValue: { type: Number, required: true },
  // Anti-scalping collar cap: Maximum allowable resale price = 2x face value
  maxCollarPrice: { type: Number, required: true },
  totalTickets: { type: Number, required: true },
  eventDate: { type: Date, required: true }
}, { timestamps: true });

// Auto-calculate maximum collar price before saving
eventSchema.pre('validate', function (next) {
  if (this.faceValue) {
    this.maxCollarPrice = this.faceValue * 2; // Anti-scalping price collar limit[cite: 1]
  }
  next();
});

export default mongoose.model('Event', eventSchema);