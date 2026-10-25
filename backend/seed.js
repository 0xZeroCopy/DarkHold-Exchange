import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Event from './models/Event.js';

dotenv.config();

const USER_ID = '60d5ecb8b5c9c22b1c8e1001';
const EVENT_ID = '60d5ecb8b5c9c22b1c8e1002';

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/darkhold_exchange');

    // Clean existing records
    await User.deleteMany({});
    await Event.deleteMany({});

    // Seed User
    const user = await User.create({
      _id: new mongoose.Types.ObjectId(USER_ID),
      username: 'suyas',
      email: 'suyas@example.com',
      passwordHash: 'hashedpassword',
      balances: { availableCash: 2500, heldCash: 0, availableTickets: 10, heldTickets: 0 }
    });

    // Seed Event
    const event = await Event.create({
      _id: new mongoose.Types.ObjectId(EVENT_ID),
      title: 'Coldplay: Music of the Spheres World Tour',
      faceValue: 100,
      maxCollarPrice: 200,
      totalTickets: 50000,
      eventDate: new Date('2026-11-15')
    });

    console.log('\n================ DATABASE SEEDED ================');
    console.log(`USER_ID  : ${user._id}`);
    console.log(`EVENT_ID : ${event._id}`);
    console.log('=================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Seed Error:', error);
    process.exit(1);
  }
};

seed();