// backend/config/db.js
const mongoose = require('mongoose');

const dns = require('dns');

// Pre-load and register all models on database connection.
// This ensures they are available for any population queries application-wide.
require('../models/userModel');
require('../models/issueModel');
require('../models/commentModel');

const connectDB = async () => {
  try {
    // Fallback DNS for Windows SRV lookup issues with MongoDB Atlas
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch (_) {}

    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    console.error(`Check your MONGO_URI in backend/.env`);
    process.exit(1);
  }
};

module.exports = connectDB;