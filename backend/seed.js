import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User, { DEFAULT_BALANCES } from './models/User.js';
import Order from './models/Order.js';
import Trade from './models/Trade.js';
import Event from './models/Event.js';

const reset = process.argv.includes('--reset');

const TICKER_EVENTS = [
  { tickerId: 1, symbol: 'TICK-1', title: 'VIP Pass', faceValue: 100, collarMultiplier: 2.0, totalTickets: 500 },
  { tickerId: 2, symbol: 'TICK-2', title: 'General Admission', faceValue: 50, collarMultiplier: 2.0, totalTickets: 1000 },
  { tickerId: 3, symbol: 'TICK-3', title: 'Early Bird', faceValue: 40, collarMultiplier: 2.0, totalTickets: 800 },
  { tickerId: 4, symbol: 'TICK-4', title: 'Backstage Access', faceValue: 80, collarMultiplier: 2.0, totalTickets: 200 },
  { tickerId: 5, symbol: 'TICK-5', title: 'Balcony Tier', faceValue: 30, collarMultiplier: 2.0, totalTickets: 1200 },
];

try {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold', { serverSelectionTimeoutMS: 5000 });

  if (reset) {
    await Promise.all([Order.deleteMany({}), Trade.deleteMany({}), User.deleteMany({}), Event.deleteMany({})]);
    console.log('Cleared orders, trades, users and events.');
  }

  // Seed Event Tickers with Anti-Scalping Price Collars
  for (const t of TICKER_EVENTS) {
    const maxCollarPrice = Math.floor(t.faceValue * t.collarMultiplier);
    await Event.updateOne(
      { tickerId: t.tickerId },
      {
        $set: {
          tickerId: t.tickerId,
          symbol: t.symbol,
          title: t.title,
          faceValue: t.faceValue,
          collarMultiplier: t.collarMultiplier,
          maxCollarPrice,
          totalTickets: t.totalTickets,
        }
      },
      { upsert: true }
    );
  }
  console.log('Seeded 5 Ticket Types with dynamic anti-scalping price collars (tied to original face value).');

  const defaultPasswordHash = await bcrypt.hash('password123', 10);

  for (const accountId of [1001, 1002]) {
    const username = `trader${accountId}`;
    await User.updateOne(
      { accountId },
      {
        $setOnInsert: {
          accountId,
          username,
          name: `Trader #${accountId}`,
          passwordHash: defaultPasswordHash,
          balances: { ...DEFAULT_BALANCES }
        }
      },
      { upsert: true }
    );
  }
  console.log('Seeded demo traders: trader1001 / password123 and trader1002 / password123 (Accounts #1001 & #1002).');
  if (reset) console.log('NOTE: restart the C++ engine so its in-memory book is empty too.');
  process.exit(0);
} catch (err) {
  console.error('Seed error:', err.message);
  process.exit(1);
}
