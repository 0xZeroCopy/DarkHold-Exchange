import Order from '../models/Order.js';

export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.find({ accountID: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};