import 'dotenv/config';
import mongoose from 'mongoose';
import User, { DEFAULT_BALANCES } from './models/User.js';
import Order from './models/Order.js';
import Trade from './models/Trade.js';

// Usage: npm run seed            -> make sure demo traders 1001 and 1002 exist
//        npm run seed -- --reset -> wipe orders/trades and reset balances (restart the engine afterwards!)
const reset = process.argv.includes('--reset');

try {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold', { serverSelectionTimeoutMS: 5000 });

  if (reset) {
    await Promise.all([Order.deleteMany({}), Trade.deleteMany({}), User.deleteMany({})]);
    console.log('Cleared orders, trades and users.');
  }

  for (const accountId of [1001, 1002]) {
    await User.updateOne(
      { accountId },
      { $setOnInsert: { accountId, name: `Trader #${accountId}`, balances: { ...DEFAULT_BALANCES } } },
      { upsert: true }
    );
  }
  console.log('Seeded traders #1001 and #1002.');
  if (reset) console.log('NOTE: restart the C++ engine so its in-memory book is empty too.');
  process.exit(0);
} catch (err) {
  console.error('Seed error:', err.message);
  process.exit(1);
}
