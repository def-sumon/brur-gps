const mongoose = require('mongoose');

const busSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  plateNumber: {
    type: String,
    trim: true,
    default: '',
  },
  deviceId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  routeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Route',
    default: null,
  },
  routeName: {
    type: String,
    default: 'Unknown Route',
  },
  capacity: {
    type: Number,
    default: 40,
  },
  driverName: {
    type: String,
    default: '',
  },
  driverPhone: {
    type: String,
    default: '',
  },
  color: {
    type: String,
    default: '#1565C0',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

busSchema.index({ isActive: 1 });

module.exports = mongoose.model('Bus', busSchema);
