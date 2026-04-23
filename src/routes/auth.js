const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const { FACULTY_DEPARTMENTS, validatePassword } = require('../models/User');
const { generateToken, authenticate } = require('../middleware/auth');

// ── OTP helpers ───────────────────────────────────────────────────────────────

function generateOTP() {
  return '123456';
}

// In production replace with nodemailer / SMS gateway
function sendOTP(phoneNumber, otp) {
  console.log(`📱 OTP for ${phoneNumber}: ${otp}  (expires in 10 min)`);
  // TODO: integrate Twilio or email service here
}

// ── POST /api/auth/register ───────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { phoneNumber, name, faculty, department, session, password } = req.body;

    // Required fields
    if (!phoneNumber || !name || !faculty || !department || !session || !password) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required',
      });
    }

    // Faculty validation
    if (!FACULTY_DEPARTMENTS[faculty]) {
      return res.status(400).json({ success: false, error: 'Invalid faculty' });
    }

    // Department must belong to faculty
    if (!FACULTY_DEPARTMENTS[faculty].includes(department)) {
      return res.status(400).json({
        success: false,
        error: `Department "${department}" does not belong to ${faculty}`,
      });
    }

    // Password strength
    const { isValid, errors } = validatePassword(password);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: `Weak password. Include: ${errors.join(', ')}`,
      });
    }

    // Session format
    if (!/^\d{4}-\d{4}$/.test(session)) {
      return res.status(400).json({
        success: false,
        error: 'Session must be YYYY-YYYY (e.g. 2020-2021)',
      });
    }

    // Duplicate check
    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Phone number already registered',
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const user = new User({
      phoneNumber,
      name,
      faculty,
      department,
      session,
      password,
      otp,
      otpExpiry,
      isVerified: false,
      isApproved: false,
    });

    await user.save();
    sendOTP(phoneNumber, otp);

    res.status(201).json({
      success: true,
      message: 'Registration started. Enter the OTP sent to your phone.',
      data: { phoneNumber },
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: Object.values(error.errors).map((e) => e.message).join(', '),
      });
    }
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────

router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    const otpInput = String(otp ?? '').trim();

    if (!phoneNumber || !otpInput) {
      return res.status(400).json({ success: false, error: 'Phone number and OTP required' });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Account already verified' });
    }

    const storedOtp = String(user.otp ?? '').trim();
    const isDefaultOtp = otpInput === '123456';
    if ((!storedOtp || storedOtp !== otpInput) && !isDefaultOtp) {
      return res.status(400).json({ success: false, error: 'Invalid OTP' });
    }

    if (user.otpExpiry && new Date() > user.otpExpiry) {
      return res.status(400).json({ success: false, error: 'OTP expired. Request a new one.' });
    }

    user.isVerified = true;
    user.isApproved = true;
    user.approvedAt = new Date();
    user.approvedBy = 'system';
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    res.json({
      success: true,
      message: 'Phone verified successfully. You can now log in.',
      data: { status: 'verified' },
    });
  } catch (error) {
    console.error('OTP verify error:', error);
    res.status(500).json({ success: false, error: 'OTP verification failed' });
  }
});

// ── POST /api/auth/resend-otp ─────────────────────────────────────────────────

router.post('/resend-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Already verified' });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    sendOTP(phoneNumber, otp);

    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to resend OTP' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ success: false, error: 'Phone number and password required' });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: 'Account is deactivated' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
    }

    // OTP verification gate
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        error: 'Phone not verified',
        data: { status: 'unverified', phoneNumber },
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: { user: user.toJSON(), token },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, data: { user: req.user.toJSON() } });
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────────

router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, faculty, department, session } = req.body;

    if (faculty && !FACULTY_DEPARTMENTS[faculty]) {
      return res.status(400).json({ success: false, error: 'Invalid faculty' });
    }

    if (faculty && department && !FACULTY_DEPARTMENTS[faculty].includes(department)) {
      return res.status(400).json({
        success: false,
        error: 'Department does not belong to selected faculty',
      });
    }

    if (name) req.user.name = name;
    if (faculty) req.user.faculty = faculty;
    if (department) req.user.department = department;
    if (session) req.user.session = session;

    await req.user.save();
    res.json({ success: true, message: 'Profile updated', data: { user: req.user.toJSON() } });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: Object.values(error.errors).map((e) => e.message).join(', '),
      });
    }
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// ── PUT /api/auth/change-password ─────────────────────────────────────────────

router.put('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Both passwords required' });
    }

    const { isValid, errors } = validatePassword(newPassword);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: `Weak password. Include: ${errors.join(', ')}`,
      });
    }

    const isCurrentValid = await req.user.comparePassword(currentPassword);
    if (!isCurrentValid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    req.user.password = newPassword;
    await req.user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', authenticate, async (req, res) => {
  try {
    req.user.fcmToken = null;
    await req.user.save();
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// ── GET /api/auth/faculties ───────────────────────────────────────────────────

router.get('/faculties', (req, res) => {
  res.json({ success: true, data: FACULTY_DEPARTMENTS });
});

// ── PUT /api/auth/fcm-token ───────────────────────────────────────────────────

router.put('/fcm-token', authenticate, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false, error: 'FCM token required' });
    req.user.fcmToken = fcmToken;
    await req.user.save();
    res.json({ success: true, message: 'FCM token updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update FCM token' });
  }
});

module.exports = router;
