// backend/utils/sendOtp.js
const nodemailer = require("nodemailer");

const sendOtpEmail = async (to, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"CityCare" <${process.env.EMAIL_USER}>`,
      to,
      subject: "Your CityCare Verification Code",
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 20px;">
          <h2>CityCare OTP Verification</h2>
          <p>Your one-time password is:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 5px; background: #f0f0f0; padding: 10px; border-radius: 5px;">${otp}</p>
          <p>This code will expire in 10 minutes.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[OTP] Successfully sent OTP to ${to} (Message ID: ${info.messageId})`);
    return true;
  } catch (error) {
    console.error(`[OTP Error] Failed to send OTP to ${to}:`, error.message || error);
    throw error;
  }
};

module.exports = sendOtpEmail;