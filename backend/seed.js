import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User, { DEFAULT_BALANCES } from './models/User.js';
import Order from './models/Order.js';
import Trade from './models/Trade.js';

const reset = process.argv.includes('--reset');

try {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold', { serverSelectionTimeoutMS: 5000 });

  if (reset) {
    await Promise.all([Order.deleteMany({}), Trade.deleteMany({}), User.deleteMany({})]);
    console.log('Cleared orders, trades and users.');
  }

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
