const mongoose = require('mongoose');

const FACULTY_DEPARTMENTS = {
  'Faculty of Arts': [
    'Bangla', 'English', 'History and Archaeology',
  ],
  'Faculty of Social Science': [
    'Economics', 'Political Science', 'Sociology',
    'Gender and Development Studies',
    'Mass Communication and Journalism',
    'Public Administration',
  ],
  'Faculty of Business Studies': [
    'Management Studies', 'Marketing',
    'Accounting and Information Systems',
    'Finance and Banking',
    'Management Information Systems (MIS)',
  ],
  'Faculty of Science': [
    'Mathematics', 'Statistics', 'Physics', 'Chemistry',
  ],
  'Faculty of Engineering and Technology': [
    'Computer Science and Engineering (CSE)',
    'Electrical and Electronic Engineering (EEE)',
  ],
  'Faculty of Life and Earth Science': [
    'Geography and Environmental Science', 'Disaster Management',
  ],
};

const ALL_DEPARTMENTS = Object.values(FACULTY_DEPARTMENTS).flat();
const ALL_FACULTIES = Object.keys(FACULTY_DEPARTMENTS);

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
  },
  phoneNumber: {
    type: String,
    default: null,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  photoUrl: {
    type: String,
    default: null,
    trim: true,
  },
  faculty: {
    type: String,
    enum: ALL_FACULTIES,
    default: null,
  },
  department: {
    type: String,
    enum: ALL_DEPARTMENTS,
    default: null,
    validate: {
      validator: function (dept) {
        if (!dept) return true;
        const allowedDepts = FACULTY_DEPARTMENTS[this.faculty] || [];
        return allowedDepts.includes(dept);
      },
      message: 'Department does not belong to the selected faculty',
    },
  },
  session: {
    type: String,
    default: null,
    validate: {
      validator: (v) => !v || /^\d{4}-\d{4}$/.test(v),
      message: 'Session must be in YYYY-YYYY format (e.g. 2020-2021)',
    },
  },
  authProvider: {
    type: String,
    enum: ['google'],
    default: 'google',
  },
  profileCompleted: { type: Boolean, default: false },

  // Backward-compatible verification fields
  isVerified: { type: Boolean, default: true },
  otp: { type: String, default: null },
  otpExpiry: { type: Date, default: null },

  // Admin approval
  isApproved: { type: Boolean, default: true },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },

  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  fcmToken: { type: String, default: null },
}, { timestamps: true });

userSchema.methods.toJSON = function () {
  const u = this.toObject();
  delete u.otp;
  delete u.otpExpiry;
  return u;
};

userSchema.index({ isApproved: 1, isActive: 1 });

module.exports = mongoose.model('User', userSchema);
module.exports.FACULTY_DEPARTMENTS = FACULTY_DEPARTMENTS;
