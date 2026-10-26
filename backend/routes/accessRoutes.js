import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { signup, login, me } from '../controllers/accessController.js';

const router = express.Router();
router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, me);

export default router;
