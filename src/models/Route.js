const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  order: { type: Number, required: true },
  isTerminal: { type: Boolean, default: false },
}, { _id: false });

const routeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  stops: [stopSchema],
  color: {
    type: String,
    default: '#1565C0',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

routeSchema.index({ isActive: 1 });

module.exports = mongoose.model('Route', routeSchema);
