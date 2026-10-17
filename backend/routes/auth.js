// backend/routes/auth.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/userModel");
const sendOtpEmail = require("../utils/sendOtp");

const router = express.Router();

// Cryptographically secure 6-digit OTP generator
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// SHA-256 helper for securely hashing OTPs before database storage
const hashOtp = (otp) => crypto.createHash("sha256").update(String(otp).trim()).digest("hex");

// Rate limiters for IP-level protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // limit each IP to 15 login/signup requests per window
  message: { message: "Too many authentication requests from this IP. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // max 10 verification requests per IP per 5 mins
  message: { message: "Too many verification attempts from this IP. Please wait 5 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const resendOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 4, // max 4 resend attempts per IP per 10 mins
  message: { message: "Too many OTP resend requests. Please wait a few minutes before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/signup", authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      if (!existingUser.isVerified) {
        return res.status(400).json({ 
          message: "An unverified account with this email already exists. Please log in to verify your account." 
        });
      }
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const hashedOtp = hashOtp(otp);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      otp: hashedOtp,
      otpExpires,
      otpAttempts: 0,
    });

    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (mailErr) {
      console.error("Failed to send OTP email during signup:", mailErr.message);
      return res.status(500).json({
        message: "Account created, but failed to send verification email. Please check SMTP configuration or try resending OTP.",
        userId: newUser._id
      });
    }
    res.status(201).json({ message: "OTP sent to your email", userId: newUser._id });
  } catch (err) {
    res.status(500).json({ message: "Server error during signup process." });
  }
});

router.post("/verify-otp", verifyOtpLimiter, async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ message: "User ID and OTP are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
      return res.json({
        message: "Account is already verified",
        token,
        user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin },
      });
    }

    // Check account-level lockout from too many failed OTP attempts
    if (user.otpLockUntil && user.otpLockUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.otpLockUntil - new Date()) / (60 * 1000));
      return res.status(429).json({
        message: `Too many failed attempts. Verification is locked. Please wait ${remainingMinutes} more minute(s).`
      });
    }

    // Check if OTP exists and is not expired
    if (!user.otp || !user.otpExpires || user.otpExpires < new Date()) {
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    // Compare hashed OTP with backward compatibility fallback for legacy plaintext
    const hashedInput = hashOtp(otp);
    const isMatch = (user.otp === hashedInput) || (user.otp === String(otp).trim());

    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      const MAX_ATTEMPTS = 5;
      const attemptsRemaining = MAX_ATTEMPTS - user.otpAttempts;

      if (user.otpAttempts >= MAX_ATTEMPTS) {
        // Invalidate OTP and lock account for 15 minutes
        user.otp = undefined;
        user.otpExpires = undefined;
        user.otpAttempts = 0;
        user.otpLockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();
        return res.status(429).json({
          message: "Too many failed attempts. This OTP has been invalidated for security. Please wait 15 minutes before requesting a new OTP."
        });
      }

      await user.save();
      return res.status(400).json({
        message: `Invalid OTP. You have ${attemptsRemaining} attempt(s) remaining.`
      });
    }

    // OTP is valid: verify account & reset OTP tracking fields
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    user.otpLockUntil = undefined;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Account verified successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during OTP verification." });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    const isMatch = user && (await bcrypt.compare(password, user.password));

    if (!user || !isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isVerified) {
      if (user.otpLockUntil && user.otpLockUntil > new Date()) {
        const remainingMinutes = Math.ceil((user.otpLockUntil - new Date()) / (60 * 1000));
        return res.status(429).json({
          message: `Account verification is temporarily locked. Please wait ${remainingMinutes} more minute(s).`
        });
      }

      const otp = generateOtp();
      user.otp = hashOtp(otp);
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      user.otpAttempts = 0;
      await user.save();

      try {
        await sendOtpEmail(normalizedEmail, otp);
      } catch (mailErr) {
        console.error("Failed to send OTP email during login:", mailErr.message);
        return res.status(500).json({
          message: "Failed to send verification email. Please check SMTP configuration or try resending OTP.",
          userId: user._id
        });
      }
      return res.status(200).json({ 
        message: "Account not verified. New OTP sent to email", 
        userId: user._id 
      });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during login." });
  }
});

router.post("/resend-otp", resendOtpLimiter, async (req, res) => {
  try {
    const { userId, email } = req.body;
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Account is already verified. Please log in." });
    }

    if (user.otpLockUntil && user.otpLockUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.otpLockUntil - new Date()) / (60 * 1000));
      return res.status(429).json({
        message: `Account verification is locked due to too many failed attempts. Please wait ${remainingMinutes} more minute(s).`
      });
    }

    const otp = generateOtp();
    user.otp = hashOtp(otp);
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.otpAttempts = 0;
    await user.save();

    try {
      await sendOtpEmail(user.email, otp);
    } catch (mailErr) {
      console.error("Failed to send OTP email during resend:", mailErr.message);
      return res.status(500).json({
        message: "Failed to send verification email. Please check SMTP configuration or try again.",
        userId: user._id
      });
    }
    res.status(200).json({ message: "A new OTP has been sent to your email", userId: user._id });
  } catch (err) {
    res.status(500).json({ message: "Server error during resending OTP." });
  }
});

module.exports = router;