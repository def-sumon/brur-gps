const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { FACULTY_DEPARTMENTS } = require('../models/User');
const { generateToken, authenticate } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── POST /api/auth/google-login ──────────────────────────────────────────────

router.post('/google-login', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, error: 'Google ID token is required' });
    }

    const verifyOptions = { idToken };
    if (process.env.GOOGLE_CLIENT_ID) {
      verifyOptions.audience = process.env.GOOGLE_CLIENT_ID;
    }

    const ticket = await googleClient.verifyIdToken(verifyOptions);
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({ success: false, error: 'Invalid Google token payload' });
    }

    if (payload.email_verified === false) {
      return res.status(403).json({ success: false, error: 'Google account email is not verified' });
    }

    const googleId = payload.sub;
    const email = String(payload.email).toLowerCase();
    const displayName = payload.name || email.split('@')[0];
    const photoUrl = payload.picture || null;

    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });
    const isNewUser = !user;

    if (!user) {
      user = new User({
        googleId,
        email,
        name: displayName,
        photoUrl,
        authProvider: 'google',
        profileCompleted: false,
        isVerified: true,
        isApproved: true,
        approvedAt: new Date(),
        approvedBy: 'google-auth',
      });
    } else {
      user.googleId = user.googleId || googleId;
      user.email = email;
      if (!user.name) user.name = displayName;
      if (photoUrl) user.photoUrl = photoUrl;
      user.lastLogin = new Date();
    }

    const hasAcademicProfile = Boolean(user.faculty && user.department && user.session);
    user.profileCompleted = Boolean(user.profileCompleted && hasAcademicProfile);
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: isNewUser
        ? 'Google sign-in successful. Please complete your profile.'
        : 'Google sign-in successful',
      data: {
        token,
        user: user.toJSON(),
        isNewUser,
        requiresProfileCompletion: !user.profileCompleted,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ success: false, error: 'Google login failed' });
  }
});

// ── POST /api/auth/complete-profile ──────────────────────────────────────────

router.post('/complete-profile', authenticate, async (req, res) => {
  try {
    const { name, faculty, department, session } = req.body;

    if (!name || !faculty || !department || !session) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (!FACULTY_DEPARTMENTS[faculty]) {
      return res.status(400).json({ success: false, error: 'Invalid faculty' });
    }

    if (!FACULTY_DEPARTMENTS[faculty].includes(department)) {
      return res.status(400).json({
        success: false,
        error: `Department "${department}" does not belong to ${faculty}`,
      });
    }

    if (!/^\d{4}-\d{4}$/.test(session)) {
      return res.status(400).json({
        success: false,
        error: 'Session must be YYYY-YYYY (e.g. 2020-2021)',
      });
    }

    req.user.name = String(name).trim();
    req.user.faculty = faculty;
    req.user.department = department;
    req.user.session = session;
    req.user.profileCompleted = true;
    req.user.isVerified = true;
    req.user.isApproved = true;
    req.user.approvedAt = req.user.approvedAt || new Date();
    req.user.approvedBy = req.user.approvedBy || 'google-auth';

    await req.user.save();

    res.json({
      success: true,
      message: 'Profile completed successfully',
      data: { user: req.user.toJSON() },
    });
  } catch (error) {
    console.error('Complete profile error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: Object.values(error.errors).map((e) => e.message).join(', '),
      });
    }
    res.status(500).json({ success: false, error: 'Failed to complete profile' });
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
