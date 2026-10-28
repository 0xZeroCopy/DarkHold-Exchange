import express from 'express';
import { registerUser, loginUser, getMe } from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', registerUser);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', getMe);

export default router;
