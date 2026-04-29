const express = require("express");
const router = express.Router();
const EmergencyAlert = require("../models/EmergencyAlert");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");

// Create emergency alert
router.post("/create", authenticate, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: "Location coordinates are required",
      });
    }

    // Create emergency alert
    const alert = new EmergencyAlert({
      userId: req.user._id,
      userName: req.user.name,
      phoneNumber: req.user.phoneNumber || '',
      department: req.user.department,
      session: req.user.session,
      location: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      address: address || "",
      status: "active",
    });

    await alert.save();

    // Get Socket.IO instance from app
    const io = req.app.get("io");

    // Broadcast emergency alert to all connected clients
    io.emit("emergency-alert", {
      alertId: alert._id,
      userId: alert.userId,
      userName: alert.userName,
      phoneNumber: alert.phoneNumber,
      department: alert.department,
      session: alert.session,
      location: {
        latitude,
        longitude,
      },
      address: alert.address,
      timestamp: alert.createdAt,
    });

    // Send push notifications to all active users
    await sendEmergencyNotifications(alert);

    res.status(201).json({
      success: true,
      message: "Emergency alert created successfully",
      data: {
        alert,
      },
    });
  } catch (error) {
    console.error("Create emergency alert error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create emergency alert",
    });
  }
});

// Get all active emergency alerts
router.get("/active", authenticate, async (req, res) => {
  try {
    const alerts = await EmergencyAlert.find({ status: "active" })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      data: {
        alerts,
      },
    });
  } catch (error) {
    console.error("Get active alerts error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch active alerts",
    });
  }
});

// Get emergency alerts near location
router.get("/nearby", authenticate, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 5000 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: "Location coordinates are required",
      });
    }

    const alerts = await EmergencyAlert.find({
      status: "active",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance), // meters
        },
      },
    }).limit(20);

    res.json({
      success: true,
      data: {
        alerts,
      },
    });
  } catch (error) {
    console.error("Get nearby alerts error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch nearby alerts",
    });
  }
});

// Get my emergency alerts
router.get("/my-alerts", authenticate, async (req, res) => {
  try {
    const alerts = await EmergencyAlert.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: {
        alerts,
      },
    });
  } catch (error) {
    console.error("Get my alerts error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch your alerts",
    });
  }
});

// Cancel emergency alert
router.put("/:alertId/cancel", authenticate, async (req, res) => {
  try {
    const alert = await EmergencyAlert.findOne({
      _id: req.params.alertId,
      userId: req.user._id,
    });

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

    alert.status = "cancelled";
    await alert.save();

    // Broadcast cancellation
    const io = req.app.get("io");
    io.emit("emergency-alert-cancelled", {
      alertId: alert._id,
    });

    res.json({
      success: true,
      message: "Emergency alert cancelled successfully",
      data: {
        alert,
      },
    });
  } catch (error) {
    console.error("Cancel alert error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to cancel alert",
    });
  }
});

// Resolve emergency alert (for admin/helpers)
router.put("/:alertId/resolve", authenticate, async (req, res) => {
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
    alert.resolvedBy = req.user._id;
    await alert.save();

    // Broadcast resolution
    const io = req.app.get("io");
    io.emit("emergency-alert-resolved", {
      alertId: alert._id,
      resolvedBy: req.user.name,
    });

    res.json({
      success: true,
      message: "Emergency alert resolved successfully",
      data: {
        alert,
      },
    });
  } catch (error) {
    console.error("Resolve alert error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resolve alert",
    });
  }
});

// Helper function to send push notifications
async function sendEmergencyNotifications(alert) {
  try {
    // Get all active users with FCM tokens (except the alert creator)
    const users = await User.find({
      _id: { $ne: alert.userId },
      isActive: true,
      fcmToken: { $ne: null, $exists: true },
    }).select("fcmToken");

    if (users.length === 0) {
      console.log("No users to notify");
      return;
    }

    const fcmTokens = users.map((user) => user.fcmToken);

    // Here you would integrate with Firebase Cloud Messaging (FCM)
    // For now, we'll just log it
    console.log(
      `Would send emergency notification to ${fcmTokens.length} users`
    );

    // Update notification count
    alert.notificationsSent = fcmTokens.length;
    await alert.save();
  } catch (error) {
    console.error("Send notifications error:", error);
  }
}

module.exports = router;
