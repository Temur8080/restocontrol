// routes/api.js
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Database connection pool
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

// Sessions storage (in-memory, production'da Redis ishlatish tavsiya etiladi)
const sessions = new Map();

// Helper function: Session yaratish
function createSession(userId, username, role) {
  const sessionId = require('crypto').randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    userId,
    username,
    role,
    createdAt: new Date()
  });
  return sessionId;
}

// Helper function: Session tekshirish
function getSession(sessionId) {
  return sessions.get(sessionId);
}

// Middleware: Authentication tekshirish
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId || req.body?.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({
      success: false,
      message: 'Autentifikatsiya talab qilinadi'
    });
  }
  
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Session yaroqsiz yoki muddati o\'tgan'
    });
  }
  
  req.session = session;
  next();
}

// Middleware: Role tekshirish
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session) {
      return res.status(401).json({
        success: false,
        message: 'Autentifikatsiya talab qilinadi'
      });
    }
    
    if (!req.session.role) {
      return res.status(403).json({
        success: false,
        message: 'Foydalanuvchi roli aniqlanmadi'
      });
    }
    
    if (!allowedRoles.includes(req.session.role)) {
      return res.status(403).json({
        success: false,
        message: `Ruxsat berilmagan. Sizning rolingiz: ${req.session.role}`
      });
    }
    
    next();
  };
}

// ============================================
// PUBLIC ROUTES
// ============================================

// Ping endpoint
router.get('/ping', (req, res) => {
  res.json({ message: 'pong', timestamp: new Date().toISOString() });
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Request body tekshirish
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username va password kiritishingiz kerak' 
      });
    }

    // Minimal test: superadmin (database ishlamasa ham ishlaydi)
    if (username === 'superadmin' && password === 'admin123') {
      const sessionId = createSession(1, 'superadmin', 'super_admin');
      return res.json({ 
        success: true, 
        message: 'Login muvaffaqiyatli',
        user: {
          id: 1,
          username: 'superadmin',
          role: 'super_admin'
        },
        sessionId: sessionId
      });
    }

    // Database'dan foydalanuvchini topish
    let result;
    try {
      result = await pool.query(
        'SELECT id, username, password, role, is_active FROM users WHERE username = $1',
        [username]
      );
    } catch (dbError) {
      // Database ulanishi xatosi
      console.error('Database connection error:', dbError.message);
      console.error('Database code:', dbError.code);
      
      // Database xatosi bo'lsa, minimal test versiyasini qaytarish
      return res.status(500).json({ 
        success: false, 
        message: 'Database ulanishi xatosi',
        error: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
        hint: 'Minimal test: username=superadmin, password=admin123'
      });
    }

    // Foydalanuvchi topilmadi
    if (!result || result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Noto\'g\'ri username yoki password' 
      });
    }

    const user = result.rows[0];

    // is_active tekshirish
    if (user.is_active === false) {
      return res.status(403).json({ 
        success: false, 
        message: 'Foydalanuvchi to\'xtatilgan' 
      });
    }

    // Parolni tekshirish
    let passwordMatch = false;
    try {
      passwordMatch = await bcrypt.compare(password, user.password);
    } catch (bcryptError) {
      console.error('Bcrypt error:', bcryptError.message);
      return res.status(500).json({
        success: false,
        message: 'Parol tekshirishda xatolik'
      });
    }
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Noto\'g\'ri username yoki password' 
      });
    }

    // Session yaratish
    const sessionId = createSession(user.id, user.username, user.role);

    res.json({
      success: true,
      message: 'Login muvaffaqiyatli',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Login qilishda xatolik',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId || req.body?.sessionId;
  
  if (sessionId) {
    sessions.delete(sessionId);
  }
  
  res.json({
    success: true,
    message: 'Logout muvaffaqiyatli'
  });
});

// ============================================
// PROTECTED ROUTES
// ============================================

// Current user ma'lumotlari
router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role
    }
  });
});

// Users list (super_admin only)
router.get('/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Foydalanuvchilarni olishda xatolik'
    });
  }
});

// Update user subscription (super_admin only)
router.post('/users/:id/subscription', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { due_date, price } = req.body;

    // Validation
    if (!due_date) {
      return res.status(400).json({
        success: false,
        message: 'Due date kiritilishi shart'
      });
    }

    if (price !== undefined && (isNaN(price) || price < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Price to\'g\'ri raqam bo\'lishi kerak'
      });
    }

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    // Update subscription
    const result = await pool.query(
      `UPDATE users 
       SET subscription_due_date = $1, 
           subscription_price = $2 
       WHERE id = $3 
       RETURNING id, username, subscription_due_date, subscription_price`,
      [due_date, price || null, userId]
    );

    res.json({
      success: true,
      message: 'Subscription muvaffaqiyatli yangilandi',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Subscription yangilashda xatolik',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user subscription (super_admin only)
router.get('/users/:id/subscription', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT id, username, subscription_due_date, subscription_price 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    res.json({
      success: true,
      subscription: {
        due_date: result.rows[0].subscription_due_date,
        price: result.rows[0].subscription_price
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Subscription ma\'lumotlarini olishda xatolik',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================
// BONUSES ENDPOINTS
// ============================================

// Get bonuses
router.get('/bonuses', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, period_date, bonus_date, limit } = req.query;
    
    let query = `
      SELECT 
        b.id,
        b.employee_id,
        b.amount,
        b.bonus_date,
        b.reason,
        b.period_type,
        b.period_date,
        b.created_at,
        e.full_name,
        e.position
      FROM bonuses b
      JOIN employees e ON b.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $${paramIndex++}`;
      params.push(userId);
    }
    
    if (employee_id) {
      query += ` AND b.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }
    
    if (period_type && ['daily', 'weekly', 'monthly'].includes(period_type)) {
      query += ` AND b.period_type = $${paramIndex++}`;
      params.push(period_type);
    }
    
    if (period_date) {
      query += ` AND b.period_date = $${paramIndex++}`;
      params.push(period_date);
    }
    
    if (bonus_date) {
      query += ` AND b.bonus_date = $${paramIndex++}`;
      params.push(bonus_date);
    }
    
    query += ` ORDER BY b.period_date DESC, b.created_at DESC`;
    
    // Limit qo'shish
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(limitNum);
      }
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      bonuses: result.rows
    });
  } catch (error) {
    console.error('Get bonuses error:', error);
    res.status(500).json({
      success: false,
      message: 'Bonuslarni olishda xatolik',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================
// PENALTIES ENDPOINTS
// ============================================

// Get penalties
router.get('/penalties', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, period_date, penalty_date, limit } = req.query;
    
    let query = `
      SELECT 
        p.id,
        p.employee_id,
        p.amount,
        p.penalty_date,
        p.reason,
        p.period_type,
        p.period_date,
        p.created_at,
        e.full_name,
        e.position
      FROM penalties p
      JOIN employees e ON p.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $${paramIndex++}`;
      params.push(userId);
    }
    
    if (employee_id) {
      query += ` AND p.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }
    
    if (period_type && ['daily', 'weekly', 'monthly'].includes(period_type)) {
      query += ` AND p.period_type = $${paramIndex++}`;
      params.push(period_type);
    }
    
    if (period_date) {
      query += ` AND p.period_date = $${paramIndex++}`;
      params.push(period_date);
    }
    
    if (penalty_date) {
      query += ` AND p.penalty_date = $${paramIndex++}`;
      params.push(penalty_date);
    }
    
    query += ` ORDER BY p.penalty_date DESC, p.created_at DESC`;
    
    // Limit qo'shish
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(limitNum);
      }
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      penalties: result.rows
    });
  } catch (error) {
    console.error('Get penalties error:', error);
    res.status(500).json({
      success: false,
      message: 'Jarimalarni olishda xatolik',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
