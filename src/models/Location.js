const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    speed: {
      type: Number,
      default: 0,
    },
    satellites: {
      type: Number,
      default: 0,
    },
    // NEW: Track location type (GPS vs Cell Tower)
    locationType: {
      type: String,
      enum: ['gps', 'lbs', 'wifi', 'manual'],
      default: 'gps',
    },
    // NEW: Store cell tower info for LBS locations
    cellInfo: {
      mcc: Number,      // Mobile Country Code
      mnc: Number,      // Mobile Network Code
      lac: Number,      // Location Area Code
      cellId: Number,   // Cell Tower ID
    },
    time: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
locationSchema.index({ deviceId: 1, time: -1 });

const Location = mongoose.model("Location", locationSchema);

module.exports = Location;