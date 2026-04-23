const express = require("express");
const router = express.Router();
const User = require("../models/User");
const EmergencyAlert = require("../models/EmergencyAlert");

// Render admin approval panel
router.get('/panel', async (req, res) => {
  try {
    const users = await User.find({ isVerified: true, isApproved: false, isActive: true })
      .select('-password -otp -otpExpiry')
      .sort({ createdAt: -1 })
      .lean();

    res.render('admin/pending-users', {
      title: 'Admin User Approval',
      users,
      error: null,
      success: req.query.success || null,
    });
  } catch (error) {
    res.status(500).render('admin/pending-users', {
      title: 'Admin User Approval',
      users: [],
      success: null,
      error: 'Failed to load pending users',
    });
  }
});

// Form action: approve user from panel
router.post('/users/:id/approve', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.redirect('/admin/panel?success=User+not+found');

    user.isApproved = true;
    user.approvedAt = new Date();
    user.approvedBy = req.body.adminName || 'admin';
    await user.save();

    res.redirect(`/admin/panel?success=${encodeURIComponent(`${user.name} approved`)}`);
  } catch (error) {
    res.redirect('/admin/panel?success=Approval+failed');
  }
});

// Form action: reject/deactivate user from panel
router.post('/users/:id/reject', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!user) return res.redirect('/admin/panel?success=User+not+found');
    res.redirect(`/admin/panel?success=${encodeURIComponent(`${user.name} rejected`)}`);
  } catch (error) {
    res.redirect('/admin/panel?success=Reject+failed');
  }
});

// Get system statistics
router.get("/stats", async (req, res) => {
  try {
    // Get total users
    const totalUsers = await User.countDocuments({ isActive: true });

    // Get active emergency alerts
    const activeAlerts = await EmergencyAlert.countDocuments({
      status: "active",
    });

    // Get WebSocket connections count
    const io = req.app.get("io");
    const activeConnections = io.engine.clientsCount || 0;

    // System uptime
    const uptime = Math.floor(process.uptime());

    // Total requests (would need middleware to track this properly)
    const totalRequests = 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        activeAlerts,
        activeWebSocketConnections: activeConnections,
        totalRequests,
        uptime,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch statistics",
    });
  }
});

// Get all users (admin only - add auth middleware in production)
router.get("/users", async (req, res) => {
  try {
    const { page = 1, limit = 50, department, session } = req.query;

    const query = {};
    if (department) query.department = department;
    if (session) query.session = session;

    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

// Get all emergency alerts (admin only)
router.get("/alerts", async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;

    const query = {};
    if (status) query.status = status;

    const alerts = await EmergencyAlert.find(query)
      .populate("userId", "name phoneNumber department session")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await EmergencyAlert.countDocuments(query);

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get alerts error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch alerts",
    });
  }
});

// Get user details
router.get("/users/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Get user's emergency alerts
    const alerts = await EmergencyAlert.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        user,
        recentAlerts: alerts,
      },
    });
  } catch (error) {
    console.error("Get user details error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user details",
    });
  }
});

// Update user status
router.put("/users/:userId/status", async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "isActive must be a boolean value",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isActive },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      data: { user },
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update user status",
    });
  }
});

// Resolve emergency alert
router.put("/alerts/:alertId/resolve", async (req, res) => {
  try {
    const alert = await EmergencyAlert.findById(req.params.alertId);

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: "Alert not found",
      });
    }

    if (alert.status !== "active") {
      return res.status(400).json({
        success: false,
        error: "Alert is not active",
      });
    }

    alert.status = "resolved";
    alert.resolvedAt = new Date();
    await alert.save();

    // Broadcast resolution
    const io = req.app.get("io");
    io.emit("emergency-alert-resolved", {
      alertId: alert._id,
    });

    res.json({
      success: true,
      message: "Alert resolved successfully",
      data: { alert },
    });
  } catch (error) {
    console.error("Resolve alert error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resolve alert",
    });
  }
});

// Get dashboard statistics
router.get("/dashboard", async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Users statistics
    const totalUsers = await User.countDocuments({ isActive: true });
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: last24Hours },
    });
    const activeUsersToday = await User.countDocuments({
      lastLogin: { $gte: last24Hours },
    });

    // Emergency alerts statistics
    const totalAlerts = await EmergencyAlert.countDocuments();
    const activeAlerts = await EmergencyAlert.countDocuments({
      status: "active",
    });
    const alertsLast24h = await EmergencyAlert.countDocuments({
      createdAt: { $gte: last24Hours },
    });
    const alertsLast7Days = await EmergencyAlert.countDocuments({
      createdAt: { $gte: last7Days },
    });

    // Department distribution
    const departmentStats = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Session distribution
    const sessionStats = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$session", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersToday,
        },
        alerts: {
          total: totalAlerts,
          active: activeAlerts,
          last24Hours: alertsLast24h,
          last7Days: alertsLast7Days,
        },
        departments: departmentStats,
        sessions: sessionStats,
      },
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard statistics",
    });
  }
});

// Clear all buses (for testing)
router.post("/clear-all", (req, res) => {
  try {
    // This would be implemented based on your bus storage mechanism
    const io = req.app.get("io");
    io.emit("all-buses-cleared");

    res.json({
      success: true,
      message: "All buses cleared successfully",
    });
  } catch (error) {
    console.error("Clear all buses error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear buses",
    });
  }
});

// GET /api/admin/pending-users - users awaiting approval
router.get('/pending-users', async (req, res) => {
  try {
    const users = await User.find({ isVerified: true, isApproved: false, isActive: true })
      .select('-password -otp -otpExpiry')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: users, count: users.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch pending users' });
  }
});

// PUT /api/admin/users/:id/approve - approve a user
router.put('/users/:id/approve', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    user.isApproved = true;
    user.approvedAt = new Date();
    user.approvedBy = req.body.adminName || 'admin';
    await user.save();

    res.json({ success: true, message: `${user.name} approved successfully`, data: user.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve user' });
  }
});

// PUT /api/admin/users/:id/reject - reject/deactivate a user
router.put('/users/:id/reject', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, message: 'User rejected' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject user' });
  }
});

module.exports = router;
