const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { loadJSON, saveJSON } = require('./utils/fileUtils');

class OTPManager {
  constructor() {
    this.otpDataPath = path.join(__dirname, 'data', 'otp_data.json');
    this.loginSessionsPath = path.join(__dirname, 'data', 'login_sessions.json');
    
    // Email configuration
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    console.log('[OTP] OTP Manager initialized');
  }

  /**
   * Generate a 6-digit OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create a login session and send OTP
   */
  async createLoginSession(employeeId, email) {
    try {
      const otp = this.generateOTP();
      const sessionToken = uuidv4();
      const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      // Load existing sessions
      let sessions = loadJSON(this.loginSessionsPath);
      if (!sessions || typeof sessions !== 'object') {
        sessions = {};
      }

      // Store session data
      sessions[sessionToken] = {
        employeeId,
        email,
        otp,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        attempts: 0,
        verified: false
      };

      // Save sessions
      saveJSON(this.loginSessionsPath, sessions);

      // Send OTP email
      await this.sendOTPEmail(email, otp, employeeId);

      console.log(`[OTP] Session created for ${employeeId}, token: ${sessionToken}`);

      return {
        success: true,
        sessionToken,
        message: `OTP sent to ${email}`,
        expiresIn: expiryMinutes
      };

    } catch (error) {
      console.error('[OTP] Error creating login session:', error);
      return {
        success: false,
        message: 'Failed to send OTP. Please try again.'
      };
    }
  }

  /**
   * Send OTP via email
   */
  async sendOTPEmail(email, otp, employeeId) {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP for No-Dues Clearance Login',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #1976d2; text-align: center;">No-Dues Clearance System</h2>
          <p>Hello,</p>
          <p>Your One-Time Password (OTP) for login is:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #1976d2; font-size: 36px; letter-spacing: 8px; margin: 0;">${otp}</h1>
          </div>
          <p><strong>Employee ID:</strong> ${employeeId}</p>
          <p>This OTP is valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
          <p style="color: #d32f2f;"><strong>Important:</strong> Do not share this OTP with anyone.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">If you didn't request this OTP, please ignore this email.</p>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`[OTP] Email sent to ${email}`);
    } catch (error) {
      console.error('[OTP] Error sending email:', error);
      throw error;
    }
  }

  /**
   * Verify OTP
   */
  async verifyOTP(sessionToken, otp) {
    try {
      const sessions = loadJSON(this.loginSessionsPath);
      
      if (!sessions || !sessions[sessionToken]) {
        return {
          success: false,
          message: 'Invalid or expired session'
        };
      }

      const session = sessions[sessionToken];

      // Check if already verified
      if (session.verified) {
        return {
          success: false,
          message: 'OTP already used'
        };
      }

      // Check expiry
      if (new Date() > new Date(session.expiresAt)) {
        delete sessions[sessionToken];
        saveJSON(this.loginSessionsPath, sessions);
        return {
          success: false,
          message: 'OTP expired. Please request a new one.'
        };
      }

      // Check max attempts
      const maxAttempts = parseInt(process.env.MAX_OTP_ATTEMPTS) || 3;
      if (session.attempts >= maxAttempts) {
        delete sessions[sessionToken];
        saveJSON(this.loginSessionsPath, sessions);
        return {
          success: false,
          message: 'Maximum attempts exceeded. Please request a new OTP.'
        };
      }

      // Verify OTP
      if (session.otp !== otp) {
        session.attempts += 1;
        saveJSON(this.loginSessionsPath, sessions);
        return {
          success: false,
          message: `Invalid OTP. ${maxAttempts - session.attempts} attempts remaining.`
        };
      }

      // Mark as verified
      session.verified = true;
      saveJSON(this.loginSessionsPath, sessions);

      console.log(`[OTP] OTP verified for ${session.employeeId}`);

      return {
        success: true,
        message: 'OTP verified successfully',
        employeeId: session.employeeId
      };

    } catch (error) {
      console.error('[OTP] Error verifying OTP:', error);
      return {
        success: false,
        message: 'Verification failed. Please try again.'
      };
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(sessionToken) {
    try {
      const sessions = loadJSON(this.loginSessionsPath);
      
      if (!sessions || !sessions[sessionToken]) {
        return {
          success: false,
          message: 'Invalid session'
        };
      }

      const session = sessions[sessionToken];

      // Generate new OTP
      const newOTP = this.generateOTP();
      const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      // Update session
      session.otp = newOTP;
      session.expiresAt = expiresAt.toISOString();
      session.attempts = 0;
      session.verified = false;

      saveJSON(this.loginSessionsPath, sessions);

      // Send new OTP
      await this.sendOTPEmail(session.email, newOTP, session.employeeId);

      console.log(`[OTP] OTP resent for ${session.employeeId}`);

      return {
        success: true,
        message: 'New OTP sent successfully'
      };

    } catch (error) {
      console.error('[OTP] Error resending OTP:', error);
      return {
        success: false,
        message: 'Failed to resend OTP'
      };
    }
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions() {
    try {
      const sessions = loadJSON(this.loginSessionsPath);
      const now = new Date();
      let cleaned = 0;

      for (const token in sessions) {
        if (new Date(sessions[token].expiresAt) < now) {
          delete sessions[token];
          cleaned++;
        }
      }

      if (cleaned > 0) {
        saveJSON(this.loginSessionsPath, sessions);
        console.log(`[OTP] Cleaned up ${cleaned} expired sessions`);
      }
    } catch (error) {
      console.error('[OTP] Error cleaning up sessions:', error);
    }
  }
}

module.exports = OTPManager;
