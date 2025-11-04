const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const OTPManager = require('./otpManager');
const { loadEmployeeUsers } = require('./utils/fileUtils');
const { roleAuth } = require('./middlewares/sessionAuth');

// Route Files
const apiEmployee = require('./routes/employee');
const apiPdf = require('./routes/pdf');

console.log('[STARTUP] Mini No-Dues Clearance System Starting...');

const app = express();
const PORT = process.env.PORT || 4000;

// Initialize OTP Manager
const otpManager = new OTPManager();
console.log('[STARTUP] OTP Manager initialized');

// Cleanup expired OTP sessions every 5 minutes
setInterval(() => {
  otpManager.cleanupExpiredSessions();
}, 5 * 60 * 1000);

// Middleware
app.use(cors({
  origin: ['http://localhost:5000', 'http://127.0.0.1:5000'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'mini_clearance_secret',
  name: 'mini.nodues.session',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

/**
 * Employee Login - Step 1: Verify credentials and send OTP
 */
app.post('/api/auth/employee-login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;
    console.log(`[AUTH] Login attempt for employee: ${employeeId}`);

    if (!employeeId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and password are required'
      });
    }

    // Load employees from parent project
    const employees = loadEmployeeUsers();
    const employee = employees.find(emp => emp.employeeId === employeeId);

    if (!employee) {
      console.log(`[AUTH] Employee not found: ${employeeId}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid employee ID or password'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, employee.password);
    if (!isValidPassword) {
      console.log(`[AUTH] Invalid password for: ${employeeId}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid employee ID or password'
      });
    }

    // Check if account is active
    if (employee.isActive === false) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact IT.'
      });
    }

    // Generate and send OTP
    const result = await otpManager.createLoginSession(employeeId, employee.email);

    if (result.success) {
      console.log(`[AUTH] OTP sent to ${employeeId}`);
      res.json({
        success: true,
        sessionToken: result.sessionToken,
        message: result.message,
        nextStep: 'verify_otp',
        email: employee.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      });
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
});

/**
 * Verify OTP - Step 2: Verify OTP and create session
 */
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { sessionToken, otp } = req.body;
    console.log(`[AUTH] OTP verification attempt`);

    if (!sessionToken || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Session token and OTP are required'
      });
    }

    const result = await otpManager.verifyOTP(sessionToken, otp);

    if (result.success) {
      // Load employee data
      const employees = loadEmployeeUsers();
      const employee = employees.find(emp => emp.employeeId === result.employeeId);

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: 'Employee not found'
        });
      }

      // Create session
      req.session.user = {
        employeeId: employee.employeeId,
        id: employee.employeeId,
        name: employee.name,
        email: employee.email,
        department: employee.department,
        role: 'employee',
        loginTime: new Date().toISOString()
      };

      req.session.save((err) => {
        if (err) {
          console.error('[AUTH] Session save error:', err);
          return res.status(500).json({
            success: false,
            message: 'Session creation failed'
          });
        }

        console.log(`[AUTH] Login successful for ${employee.employeeId}`);
        res.json({
          success: true,
          message: 'Login successful',
          employeeId: employee.employeeId,
          redirectTo: '/dashboard.html'
        });
      });

    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('[AUTH] OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
});

/**
 * Resend OTP
 */
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    console.log(`[AUTH] OTP resend request`);

    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        message: 'Session token is required'
      });
    }

    const result = await otpManager.resendOTP(sessionToken);
    res.json(result);

  } catch (error) {
    console.error('[AUTH] OTP resend error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP'
    });
  }
});

/**
 * Check session status
 */
app.get('/api/auth/check-session', (req, res) => {
  if (req.session && req.session.user) {
    console.log(`[SESSION] Active session for ${req.session.user.employeeId}`);
    res.json({
      success: true,
      authenticated: true,
      role: req.session.user.role || 'employee',
      user: req.session.user
    });
  } else {
    console.log(`[SESSION] No active session`);
    res.status(401).json({
      success: false,
      authenticated: false,
      message: 'No active session'
    });
  }
});

/**
 * Logout
 */
app.post('/api/auth/logout', (req, res) => {
  const user = req.session?.user;
  
  req.session.destroy((err) => {
    if (err) {
      console.error('[AUTH] Logout error:', err);
      return res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }

    res.clearCookie('mini.nodues.session');
    console.log(`[AUTH] User logged out: ${user?.employeeId || 'unknown'}`);
    
    res.json({
      success: true,
      message: 'Logged out successfully',
      redirect: '/'
    });
  });
});

// ==========================================
// PROTECTED ROUTES (Require Authentication)
// ==========================================

/**
 * Middleware to check authentication
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/?error=unauthorized');
  }
}

/**
 * Dashboard page (protected)
 */
app.get('/dashboard.html', requireAuth, (req, res) => {
  console.log(`[ROUTE] Dashboard access by ${req.session.user.employeeId}`);
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

/**
 * Get employee profile data
 */
app.get('/api/employee/profile', requireAuth, (req, res) => {
  const user = req.session.user;
  console.log(`[API] Profile request for ${user.employeeId}`);
  
  res.json({
    success: true,
    profile: {
      employeeId: user.employeeId,
      name: user.name,
      email: user.email,
      department: user.department,
      role: user.role,
      loginTime: user.loginTime
    }
  });
});

// ==========================================
// MOUNT API ROUTES
// ==========================================

app.use('/api/employee', apiEmployee);
app.use('/api/pdf', apiPdf);

// Protected page routes
app.get('/employee.html', roleAuth('employee'), (req, res) => {
  console.log(`[ROUTE] Employee page access by: ${req.session.user.employeeId}`);
  res.sendFile(path.join(__dirname, 'public', 'employee.html'));
});

app.get('/track.html', roleAuth('employee'), (req, res) => {
  console.log(`[ROUTE] Track page access by: ${req.session.user.employeeId}`);
  res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

app.get('/history.html', roleAuth('employee'), (req, res) => {
  console.log(`[ROUTE] History page access by: ${req.session.user.employeeId}`);
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

app.get('/confirmation.html', roleAuth('employee'), (req, res) => {
  console.log(`[ROUTE] Confirmation page access by: ${req.session.user.employeeId}`);
  res.sendFile(path.join(__dirname, 'public', 'confirmation.html'));
});

// ==========================================
// ROOT ROUTE
// ==========================================

app.get('/', (req, res) => {
  console.log('[ROUTE] Root access - serving login page');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'Mini No-Dues Clearance System',
    version: '1.0.0'
  });
});

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 MINI NO-DUES CLEARANCE SYSTEM');
  console.log('='.repeat(60));
  console.log(`✅ Server running on: http://localhost:${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Email configured: ${process.env.EMAIL_USER ? 'Yes' : 'No'}`);
  console.log('='.repeat(60));
  console.log('\n📝 Available Routes:');
  console.log(`   - Login Page: http://localhost:${PORT}/`);
  console.log(`   - Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`   - Health Check: http://localhost:${PORT}/health`);
  console.log('\n' + '='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, shutting down gracefully...');
  process.exit(0);
});
