const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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

function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('an uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('a lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('a number');
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=~`]/.test(password)) errors.push('a special character');
  return { isValid: errors.length === 0, errors };
}

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    validate: {
      validator: (v) => /^01[3-9]\d{8}$/.test(v),
      message: (p) => `${p.value} is not a valid Bangladesh phone number`,
    },
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  faculty: {
    type: String,
    required: true,
    enum: ALL_FACULTIES,
  },
  department: {
    type: String,
    required: true,
    enum: ALL_DEPARTMENTS,
    validate: {
      validator: function (dept) {
        const allowedDepts = FACULTY_DEPARTMENTS[this.faculty] || [];
        return allowedDepts.includes(dept);
      },
      message: 'Department does not belong to the selected faculty',
    },
  },
  session: {
    type: String,
    required: true,
    validate: {
      validator: (v) => /^\d{4}-\d{4}$/.test(v),
      message: 'Session must be in YYYY-YYYY format (e.g. 2020-2021)',
    },
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    validate: {
      validator: function (v) {
        if (this.isModified('password') || this.isNew) {
          const { isValid } = validatePassword(v);
          return isValid;
        }
        return true;
      },
      message: 'Password must contain uppercase, lowercase, number and special character',
    },
  },

  // Verification
  isVerified: { type: Boolean, default: false },
  otp: { type: String, default: null },
  otpExpiry: { type: Date, default: null },

  // Admin approval
  isApproved: { type: Boolean, default: false },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },

  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  fcmToken: { type: String, default: null },
}, { timestamps: true });

// Hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const { isValid, errors } = validatePassword(this.password);
  if (!isValid) {
    return next(new Error(`Password must include: ${errors.join(', ')}`));
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const u = this.toObject();
  delete u.password;
  delete u.otp;
  delete u.otpExpiry;
  return u;
};

userSchema.index({ isApproved: 1, isActive: 1 });

module.exports = mongoose.model('User', userSchema);
module.exports.FACULTY_DEPARTMENTS = FACULTY_DEPARTMENTS;
module.exports.validatePassword = validatePassword;
