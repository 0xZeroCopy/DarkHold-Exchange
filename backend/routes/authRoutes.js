import express from 'express';
import { registerUser, loginUser, getMe, logoutUser, refreshToken } from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', registerUser);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/refresh', refreshToken);
router.get('/me', getMe);

export default router;
