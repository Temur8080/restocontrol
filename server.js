const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

const uploadsDir = path.join(__dirname, 'public', 'uploads', 'logos');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'logo-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Faqat rasm fayllari yuklash mumkin (jpeg, jpg, png, gif, webp)'));
    }
  }
});

// Dynamic CORS sozlamalari - terminal IP manzillari va domenlar avtomatik yangilanadi
let cachedAllowedOrigins = [];
let corsCacheTimestamp = 0;
const CORS_CACHE_TTL = 5 * 60 * 1000; // 5 daqiqa cache

// Terminal IP manzillarini va domenlarni database'dan o'qib, CORS whitelist'ga qo'shish
async function updateCorsOrigins() {
  try {
    const defaultOrigins = [
      'http://localhost:8000',
      'http://localhost:3000',
      'https://restocontrol.uz',
      'http://restocontrol.uz'
    ];

    // Environment variable'dan allowed origins
    const envOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];

    // Database'dan terminal IP manzillarini o'qish
    const terminalResult = await pool.query(
      'SELECT DISTINCT ip_address FROM terminals WHERE ip_address IS NOT NULL AND is_active = true'
    );

    const terminalOrigins = [];
    terminalResult.rows.forEach(row => {
      const ip = row.ip_address;
      if (ip) {
        // HTTP va HTTPS variantlarini qo'shish
        terminalOrigins.push(`http://${ip}`);
        terminalOrigins.push(`https://${ip}`);
      }
    });

    // Barcha origin'larni birlashtirish
    const allOrigins = [...defaultOrigins, ...envOrigins, ...terminalOrigins];

    // Duplikatlarni olib tashlash
    cachedAllowedOrigins = [...new Set(allOrigins)];
    corsCacheTimestamp = Date.now();

    console.log(`✅ CORS origins yangilandi: ${cachedAllowedOrigins.length} ta origin (${terminalOrigins.length / 2} ta terminal)`);
  } catch (error) {
    console.error('❌ CORS origins yangilashda xatolik:', error.message);
    // Xatolik bo'lsa ham default origins ishlatiladi
    cachedAllowedOrigins = [
      'http://localhost:8000',
      'http://localhost:3000',
      'https://restocontrol.uz',
      'http://restocontrol.uz'
    ];
  }
}

// CORS sozlamalari - xavfsizlik uchun
const corsOptions = {
  origin: async function (origin, callback) {
    // Origin bo'lmasa (mobile app, Postman, va hokazo) ruxsat berish
    if (!origin) return callback(null, true);

    // Cache eskirgan bo'lsa yoki bo'sh bo'lsa, yangilash
    if (Date.now() - corsCacheTimestamp > CORS_CACHE_TTL || cachedAllowedOrigins.length === 0) {
      await updateCorsOrigins();
    }

    // Hikvision terminal IP manzillari uchun ruxsat berish (private IP ranges)
    const isPrivateIP = origin.includes('192.168.') ||
      origin.includes('10.') ||
      origin.includes('172.') ||
      /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(origin);

    // Whitelist'dan tekshirish
    const isInWhitelist = cachedAllowedOrigins.indexOf(origin) !== -1;

    if (isPrivateIP || isInWhitelist) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS policy buzilishi: ${origin}`);
      callback(new Error('CORS policy buzilishi'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'Accept']
};

// Hikvision WebInterface endpoint'lari uchun maxsus CORS sozlamalari (avval qo'yilishi kerak)
app.options('/WebInterface*', cors({
  origin: true, // Barcha origin'larni ruxsat berish (Hikvision terminal'lar uchun)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'Accept']
}));

app.use('/WebInterface', cors({
  origin: true, // Barcha origin'larni ruxsat berish (Hikvision terminal'lar uchun)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'Accept']
}));

// Hikvision event endpoint uchun maxsus CORS sozlamalari (terminal webhook'lar uchun)
app.options('/api/hikvision/event', cors({
  origin: true, // Barcha origin'larni ruxsat berish (terminal webhook'lar uchun)
  credentials: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Content-Length', 'Accept', 'Authorization']
}));

app.use(cors(corsOptions));

// Rate limiting middleware (brute force va DoS hujumlaridan himoya qilish uchun)
const apiRequests = new Map();
const API_RATE_LIMIT = 200; // 1 daqiqada maksimal so'rovlar soni (oshirildi)
const API_RATE_WINDOW = 60 * 1000; // 1 daqiqa (qisqartirildi - tezroq reset)

function apiRateLimit(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const now = Date.now();

  if (!apiRequests.has(clientIp)) {
    apiRequests.set(clientIp, { count: 1, resetAt: now + API_RATE_WINDOW });
    return next();
  }

  const record = apiRequests.get(clientIp);
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + API_RATE_WINDOW;
    return next();
  }

  if (record.count >= API_RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      message: 'Juda ko\'p so\'rovlar. Iltimos, keyinroq qayta urinib ko\'ring.'
    });
  }

  record.count++;
  next();
}

// Login uchun qattiqroq rate limiting
const loginRequests = new Map();
const LOGIN_RATE_LIMIT = 5; // 15 daqiqada maksimal kirish urinishlari
const LOGIN_RATE_WINDOW = 15 * 60 * 1000; // 15 daqiqa

function loginRateLimit(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const now = Date.now();

  if (!loginRequests.has(clientIp)) {
    loginRequests.set(clientIp, { count: 1, resetAt: now + LOGIN_RATE_WINDOW });
    return next();
  }

  const record = loginRequests.get(clientIp);
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + LOGIN_RATE_WINDOW;
    return next();
  }

  if (record.count >= LOGIN_RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      message: 'Juda ko\'p kirish urinishlari. Iltimos, 15 daqiqadan keyin qayta urinib ko\'ring.'
    });
  }

  record.count++;
  next();
}

// Rate limiting'ni qo'llash (login endpoint'idan tashqari barcha API endpoint'lar uchun)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') {
    return next(); // Login uchun alohida middleware ishlatiladi
  }
  apiRateLimit(req, res, next);
});

// Raw body'ni saqlash (stream'ni yemaymiz) — bodyParser verify orqali
function saveRawBody(req, res, buf, encoding) {
  // faqat kerakli endpointlarda saqlaymiz
  if (
    req.method === 'POST' &&
    (req.originalUrl || req.url) &&
    ((req.originalUrl || req.url).includes('/api/hikvision/event') ||
      (req.originalUrl || req.url).includes('/api/attendance/webhook'))
  ) {
    try {
      req.rawBody = buf?.toString(encoding || 'utf8');
    } catch (e) {
      req.rawBody = undefined;
    }
  }
}

// JSON body parser
app.use(bodyParser.json({ verify: saveRawBody }));
app.use(bodyParser.urlencoded({ extended: true, verify: saveRawBody }));

// RAW/XML body parser (Hikvision terminal uchun MUHIM)
// Bu XML va text/xml content-type'larni qabul qiladi
app.use(express.text({
  type: ['application/xml', 'text/xml', 'application/json', 'text/plain'],
  limit: '10mb'
}));

app.use(express.static('public'));

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'appuser',
  port: process.env.DB_PORT || 5432,
});

pool.on('connect', () => {
  console.log('PostgreSQL database connected');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Avtomatik migration funksiyasi
async function runAutoMigrations() {
  try {
    console.log('🔄 Avtomatik migrationlar tekshirilmoqda...');

    // Penalties jadvali mavjudligini tekshirish
    const checkPenalties = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'penalties'
      );
    `);

    // Bonuses jadvali mavjudligini tekshirish
    const checkBonuses = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'bonuses'
      );
    `);

    // KPI records jadvali mavjudligini tekshirish
    const checkKPI = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'kpi_records'
      );
    `);

    const penaltiesExists = checkPenalties.rows[0].exists;
    const bonusesExists = checkBonuses.rows[0].exists;
    const kpiExists = checkKPI.rows[0].exists;

    // Agar jadvallar mavjud bo'lmasa, migration ishga tushirish
    if (!penaltiesExists || !bonusesExists || !kpiExists) {
      console.log('📦 Kerakli jadvallar topilmadi, migration ishga tushirilmoqda...');

      const migrationPath = path.join(__dirname, 'migrations', 'create-penalties-bonuses-kpi.sql');

      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await pool.query(sql);
        console.log('✅ Migration muvaffaqiyatli bajarildi!');
        console.log('   - penalties jadvali yaratildi');
        console.log('   - bonuses jadvali yaratildi');
        console.log('   - kpi_records jadvali yaratildi');
      } else {
        console.warn('⚠️  Migration fayli topilmadi:', migrationPath);
      }
    } else {
      console.log('✅ Barcha kerakli jadvallar mavjud');
    }

    // Jarima sozlamalari maydonlarini tekshirish va qo'shish
    try {
      const checkPenaltySettings = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name IN ('late_threshold_minutes', 'penalty_per_minute', 'max_penalty_per_day');
      `);

      const existingColumns = checkPenaltySettings.rows.map(row => row.column_name);
      const requiredColumns = ['late_threshold_minutes', 'penalty_per_minute', 'max_penalty_per_day'];
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));

      if (missingColumns.length > 0) {
        console.log('📦 Jarima sozlamalari maydonlari topilmadi, migration ishga tushirilmoqda...');

        const penaltyMigrationPath = path.join(__dirname, 'migrations', 'add-penalty-settings.sql');

        if (fs.existsSync(penaltyMigrationPath)) {
          const sql = fs.readFileSync(penaltyMigrationPath, 'utf8');
          await pool.query(sql);
          console.log('✅ Jarima sozlamalari migration muvaffaqiyatli bajarildi!');
          console.log('   - late_threshold_minutes maydoni qo\'shildi');
          console.log('   - penalty_per_minute maydoni qo\'shildi');
          console.log('   - max_penalty_per_day maydoni qo\'shildi');
        } else {
          // Agar migration fayli bo'lmasa, to'g'ridan-to'g'ri SQL bajarish
          console.log('📝 Migration fayli topilmadi, to\'g\'ridan-to\'g\'ri SQL bajarilmoqda...');

          const addColumnsSQL = `
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS late_threshold_minutes INTEGER DEFAULT 5,
            ADD COLUMN IF NOT EXISTS penalty_per_minute INTEGER DEFAULT 1000,
            ADD COLUMN IF NOT EXISTS max_penalty_per_day INTEGER DEFAULT 50000;
          `;

          await pool.query(addColumnsSQL);
          console.log('✅ Jarima sozlamalari maydonlari qo\'shildi!');
        }
      } else {
        console.log('✅ Jarima sozlamalari maydonlari mavjud');
      }
    } catch (penaltySettingsError) {
      console.error('⚠️  Jarima sozlamalari migration xatolik:', penaltySettingsError.message);
      // Xatolik bo'lsa ham server ishlashda davom etadi
    }
  } catch (error) {
    console.error('❌ Migration xatolik:', error.message);
    // Migration xatolik bo'lsa ham server ishlashda davom etadi
  }
}

// Database ulanishini tekshirib, migrationlarni ishga tushirish
(async () => {
  try {
    // Database ulanishini tekshirish
    await pool.query('SELECT 1');
    console.log('PostgreSQL database connected');

    // Migrationlarni ishga tushirish
    await runAutoMigrations();
  } catch (error) {
    console.error('Database ulanish xatolik:', error.message);
  }
})();

const sessions = new Map();
const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 soat

// Muddati o'tgan sessionlarni tozalash (har soatda)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      sessions.delete(token);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`🗑️  ${cleanedCount} ta muddati o'tgan session o'chirildi`);
  }
}, 60 * 60 * 1000); // Har soatda ishga tushadi

// Obuna muddati tugagan adminlarni tekshirish va to'xtatish (har kuni)
setInterval(async () => {
  try {
    const now = new Date();
    console.log('🔄 Obuna muddatlari tekshirilmoqda...');

    // Muddati o'tgan va hali aktiv bo'lgan adminlarni topish
    const result = await pool.query(`
      UPDATE users 
      SET is_active = false 
      WHERE role = 'admin' 
        AND is_active = true 
        AND subscription_due_date < $1
      RETURNING id, username
    `, [now]);

    if (result.rows.length > 0) {
      console.log(`🔒 ${result.rows.length} ta admin obuna muddati tugagani uchun bloklandi:`, result.rows.map(u => u.username).join(', '));

      // Ularning sessionlarini ham o'chirish
      for (const [token, session] of sessions.entries()) {
        const user = result.rows.find(u => u.id === session.userId);
        if (user) {
          sessions.delete(token);
        }
      }
    }
  } catch (error) {
    console.error('❌ Obuna tekshiruvi xatolik:', error.message);
  }
}, 24 * 60 * 60 * 1000); // Har 24 soatda (yoki server start bo'lganda bir marta ishlaydi keyin interval)

// Server ishga tushganda bir marta tekshirib olish
setTimeout(async () => {
  try {
    const now = new Date();
    // Muddati o'tgan va hali aktiv bo'lgan adminlarni topish
    const result = await pool.query(`
      UPDATE users 
      SET is_active = false 
      WHERE role = 'admin' 
        AND is_active = true 
        AND subscription_due_date < $1
      RETURNING id, username
    `, [now]);

    if (result.rows.length > 0) {
      console.log(`🔒 Server start: ${result.rows.length} ta admin obuna muddati tugagani uchun bloklandi.`);
    }
  } catch (e) { }
}, 5000); // 5 soniyadan keyin


app.post('/api/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username va password kiritishingiz kerak'
      });
    }

    const result = await pool.query(
      'SELECT id, username, password, role, is_active FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Noto\'g\'ri username yoki password'
      });
    }

    const user = result.rows[0];

    // is_active null yoki undefined bo'lsa, true deb hisoblaymiz (default behavior)
    // Faqat explicit false bo'lsa, to'xtatilgan deb hisoblaymiz
    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'Sizning hisobingiz to\'xtatilgan. Iltimos, administratorga murojaat qiling.'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Noto\'g\'ri username yoki password'
      });
    }

    let employeeInfo = null;
    if (user.role === 'employee') {
      const empResult = await pool.query(
        'SELECT id, full_name, position FROM employees WHERE user_id = $1',
        [user.id]
      );
      if (empResult.rows.length > 0) {
        employeeInfo = empResult.rows[0];
      }
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionToken, {
      userId: user.id,
      username: user.username,
      role: user.role,
      expiresAt: Date.now() + SESSION_EXPIRY,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      message: 'Muvaffaqiyatli kirildi',
      token: sessionToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        employeeInfo: employeeInfo
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server xatosi. Iltimos, keyinroq qayta urinib ko\'ring.'
    });
  }
});

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  // Query string'dan token olishni o'chirish - xavfsizlik uchun
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Autentifikatsiya talab qilinadi. Token topilmadi.'
    });
  }

  const token = authHeader.replace('Bearer ', '');

  if (!sessions.has(token)) {
    return res.status(401).json({
      success: false,
      message: 'Autentifikatsiya talab qilinadi. Token noto\'g\'ri yoki muddati tugagan.'
    });
  }

  const session = sessions.get(token);

  // Session muddati tekshiruvi
  if (session.expiresAt && session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({
      success: false,
      message: 'Autentifikatsiya talab qilinadi. Session muddati tugagan.'
    });
  }

  if (!session || !session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Autentifikatsiya talab qilinadi. Session noto\'g\'ri.'
    });
  }

  req.session = session;
  next();
}

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
        message: `Ruxsat berilmagan. Sizning rolingiz: ${req.session.role}. Talab qilinadigan rollar: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

app.get('/api/users/:id/permissions', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT permissions FROM users WHERE id = $1 AND role = $2',
      [adminId, 'admin']
    );

    if (result.rows.length > 0) {
      res.json({
        success: true,
        permissions: result.rows[0].permissions || {}
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }
  } catch (error) {
    console.error('Get admin permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Imkoniyatlarni olishda xatolik'
    });
  }
});

app.put('/api/users/:id/permissions', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const { permission, enabled } = req.body;

    if (!permission || typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Imkoniyat nomi va holati kiritilishi kerak'
      });
    }

    const result = await pool.query(
      'SELECT permissions FROM users WHERE id = $1 AND role = $2',
      [adminId, 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    const currentPermissions = result.rows[0].permissions || {};
    currentPermissions[permission] = enabled;

    await pool.query(
      'UPDATE users SET permissions = $1 WHERE id = $2',
      [JSON.stringify(currentPermissions), adminId]
    );

    res.json({
      success: true,
      message: 'Imkoniyat muvaffaqiyatli yangilandi',
      permissions: currentPermissions
    });
  } catch (error) {
    console.error('Update admin permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Imkoniyatni yangilashda xatolik'
    });
  }
});

app.get('/api/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, is_active, created_at, permissions, subscription_due_date, subscription_price 
       FROM users 
       WHERE role IN ('super_admin', 'admin')
       ORDER BY created_at DESC`
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

// Get super admin overall statistics
app.get('/api/statistics/overall', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    // Get all admins count
    const adminsCount = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE role IN (\'super_admin\', \'admin\')'
    );

    // Get active admins count
    const activeAdminsCount = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE role IN (\'super_admin\', \'admin\') AND is_active = true'
    );

    // Get all employees count
    const employeesCount = await pool.query(
      'SELECT COUNT(*) as count FROM employees'
    );

    // Get active employees count
    const activeEmployeesCount = await pool.query(
      `SELECT COUNT(*) as count 
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE u.is_active = true`
    );

    // Get all terminals count
    const terminalsCount = await pool.query(
      'SELECT COUNT(*) as count FROM terminals'
    );

    // Get active terminals count
    const activeTerminalsCount = await pool.query(
      'SELECT COUNT(*) as count FROM terminals WHERE is_active = true'
    );

    // Get positions count
    const positionsCount = await pool.query(
      'SELECT COUNT(*) as count FROM positions'
    );

    // Get attendance statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const yearAgo = new Date(today);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const attendanceStats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE event_time >= $1) as today_count,
        COUNT(*) FILTER (WHERE event_time >= $2) as week_count,
        COUNT(*) FILTER (WHERE event_time >= $3) as month_count,
        COUNT(*) FILTER (WHERE event_time >= $4) as year_count,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE event_type = 'entry') as entry_count,
        COUNT(*) FILTER (WHERE event_type = 'exit') as exit_count
       FROM attendance_logs`,
      [today, weekAgo, monthAgo, yearAgo]
    );

    // Get attendance by day for last 30 days (for chart)
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendanceByDay = await pool.query(
      `SELECT 
        DATE(event_time) as date,
        COUNT(*) FILTER (WHERE event_type = 'entry') as entry_count,
        COUNT(*) FILTER (WHERE event_type = 'exit') as exit_count,
        COUNT(*) as total_count
       FROM attendance_logs
       WHERE event_time >= $1
       GROUP BY DATE(event_time)
       ORDER BY DATE(event_time) ASC`,
      [thirtyDaysAgo]
    );

    // Get attendance by admin (for chart)
    const attendanceByAdmin = await pool.query(
      `SELECT 
        u.id as admin_id,
        u.username as admin_username,
        COUNT(*) as attendance_count,
        COUNT(*) FILTER (WHERE al.event_type = 'entry') as entry_count,
        COUNT(*) FILTER (WHERE al.event_type = 'exit') as exit_count
       FROM attendance_logs al
       JOIN users u ON al.admin_id = u.id
       WHERE u.role IN ('super_admin', 'admin')
       GROUP BY u.id, u.username
       ORDER BY attendance_count DESC
       LIMIT 10`
    );

    // Get employees by admin (for chart)
    const employeesByAdmin = await pool.query(
      `SELECT 
        u.id as admin_id,
        u.username as admin_username,
        COUNT(*) as employees_count,
        COUNT(*) FILTER (WHERE u2.is_active = true) as active_employees_count
       FROM employees e
       JOIN users u ON e.admin_id = u.id
       JOIN users u2 ON e.user_id = u2.id
       WHERE u.role IN ('super_admin', 'admin')
       GROUP BY u.id, u.username
       ORDER BY employees_count DESC`
    );

    // Get terminals by admin (for chart)
    const terminalsByAdmin = await pool.query(
      `SELECT 
        u.id as admin_id,
        u.username as admin_username,
        COUNT(*) as terminals_count,
        COUNT(*) FILTER (WHERE t.is_active = true) as active_terminals_count
       FROM terminals t
       JOIN users u ON t.admin_id = u.id
       WHERE u.role IN ('super_admin', 'admin')
       GROUP BY u.id, u.username
       ORDER BY terminals_count DESC`
    );

    // Get verification mode statistics
    const verificationModeStats = await pool.query(
      `SELECT 
        verification_mode,
        COUNT(*) as count
       FROM attendance_logs
       WHERE verification_mode IS NOT NULL
       GROUP BY verification_mode
       ORDER BY count DESC`
    );

    // Get top employees by attendance (last 30 days)
    const topEmployees = await pool.query(
      `SELECT 
        al.employee_name,
        COUNT(*) as attendance_count,
        COUNT(*) FILTER (WHERE al.event_type = 'entry') as entry_count,
        COUNT(*) FILTER (WHERE al.event_type = 'exit') as exit_count
       FROM attendance_logs al
       WHERE al.event_time >= $1
       GROUP BY al.employee_name
       ORDER BY attendance_count DESC
       LIMIT 10`,
      [thirtyDaysAgo]
    );

    res.json({
      success: true,
      statistics: {
        admins: {
          total: parseInt(adminsCount.rows[0].count),
          active: parseInt(activeAdminsCount.rows[0].count)
        },
        employees: {
          total: parseInt(employeesCount.rows[0].count),
          active: parseInt(activeEmployeesCount.rows[0].count)
        },
        terminals: {
          total: parseInt(terminalsCount.rows[0].count),
          active: parseInt(activeTerminalsCount.rows[0].count)
        },
        positions: {
          total: parseInt(positionsCount.rows[0].count)
        },
        attendance: {
          today: parseInt(attendanceStats.rows[0].today_count),
          this_week: parseInt(attendanceStats.rows[0].week_count),
          this_month: parseInt(attendanceStats.rows[0].month_count),
          this_year: parseInt(attendanceStats.rows[0].year_count),
          total: parseInt(attendanceStats.rows[0].total_count),
          entry: parseInt(attendanceStats.rows[0].entry_count),
          exit: parseInt(attendanceStats.rows[0].exit_count)
        },
        charts: {
          attendance_by_day: attendanceByDay.rows,
          attendance_by_admin: attendanceByAdmin.rows,
          employees_by_admin: employeesByAdmin.rows,
          terminals_by_admin: terminalsByAdmin.rows,
          verification_modes: verificationModeStats.rows,
          top_employees: topEmployees.rows
        }
      }
    });
  } catch (error) {
    console.error('Get overall statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Statistikani olishda xatolik'
    });
  }
});

// Get admin statistics (for super_admin)
app.get('/api/users/:id/statistics', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);

    if (isNaN(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri admin ID'
      });
    }

    // Check if user is admin or super_admin
    const userCheck = await pool.query(
      'SELECT id, username, role, is_active, created_at FROM users WHERE id = $1 AND role IN (\'super_admin\', \'admin\')',
      [adminId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    const admin = userCheck.rows[0];

    // Get employees count
    const employeesCount = await pool.query(
      'SELECT COUNT(*) as count FROM employees WHERE admin_id = $1',
      [adminId]
    );

    // Get terminals count
    const terminalsCount = await pool.query(
      'SELECT COUNT(*) as count FROM terminals WHERE admin_id = $1',
      [adminId]
    );

    // Get attendance logs count (today, this week, this month, total)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const attendanceStats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE event_time >= $1) as today_count,
        COUNT(*) FILTER (WHERE event_time >= $2) as week_count,
        COUNT(*) FILTER (WHERE event_time >= $3) as month_count,
        COUNT(*) as total_count
       FROM attendance_logs 
       WHERE admin_id = $4`,
      [today, weekAgo, monthAgo, adminId]
    );

    // Get positions count
    const positionsCount = await pool.query(
      'SELECT COUNT(*) as count FROM positions WHERE admin_id = $1',
      [adminId]
    );

    // Get active employees count
    const activeEmployeesCount = await pool.query(
      `SELECT COUNT(*) as count 
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.admin_id = $1 AND u.is_active = true`,
      [adminId]
    );

    // Get active terminals count
    const activeTerminalsCount = await pool.query(
      'SELECT COUNT(*) as count FROM terminals WHERE admin_id = $1 AND is_active = true',
      [adminId]
    );

    res.json({
      success: true,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        is_active: admin.is_active,
        created_at: admin.created_at
      },
      statistics: {
        employees: {
          total: parseInt(employeesCount.rows[0].count),
          active: parseInt(activeEmployeesCount.rows[0].count)
        },
        terminals: {
          total: parseInt(terminalsCount.rows[0].count),
          active: parseInt(activeTerminalsCount.rows[0].count)
        },
        positions: {
          total: parseInt(positionsCount.rows[0].count)
        },
        attendance: {
          today: parseInt(attendanceStats.rows[0].today_count),
          this_week: parseInt(attendanceStats.rows[0].week_count),
          this_month: parseInt(attendanceStats.rows[0].month_count),
          total: parseInt(attendanceStats.rows[0].total_count)
        }
      }
    });
  } catch (error) {
    console.error('Get admin statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Statistikani olishda xatolik'
    });
  }
});

// Get admin detailed information
app.get('/api/users/:id/details', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);

    if (isNaN(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri admin ID'
      });
    }

    // Get admin basic info
    const adminResult = await pool.query(
      `SELECT id, username, role, is_active, created_at, organization_name, logo_path
       FROM users 
       WHERE id = $1 AND role IN ('super_admin', 'admin')`,
      [adminId]
    );

    if (adminResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    const admin = adminResult.rows[0];

    // Get recent employees (last 10)
    const recentEmployees = await pool.query(
      `SELECT e.id, e.full_name, e.position, e.phone, e.email, u.is_active, e.created_at
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.admin_id = $1
       ORDER BY e.created_at DESC
       LIMIT 10`,
      [adminId]
    );

    // Get recent terminals
    const terminals = await pool.query(
      `SELECT id, name, ip_address, terminal_type, is_active, location, created_at
       FROM terminals
       WHERE admin_id = $1
       ORDER BY created_at DESC`,
      [adminId]
    );

    // Get recent attendance logs (last 20)
    const recentAttendance = await pool.query(
      `SELECT id, employee_name, terminal_name, event_time, event_type, verification_mode, created_at
       FROM attendance_logs
       WHERE admin_id = $1
       ORDER BY event_time DESC
       LIMIT 20`,
      [adminId]
    );

    // Get positions
    const positions = await pool.query(
      `SELECT id, name, description, created_at
       FROM positions
       WHERE admin_id = $1
       ORDER BY created_at DESC`,
      [adminId]
    );

    res.json({
      success: true,
      admin: admin,
      details: {
        recent_employees: recentEmployees.rows,
        terminals: terminals.rows,
        recent_attendance: recentAttendance.rows,
        positions: positions.rows
      }
    });
  } catch (error) {
    console.error('Get admin details error:', error);
    res.status(500).json({
      success: false,
      message: 'Batafsil ma\'lumotlarni olishda xatolik'
    });
  }
});

app.post('/api/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username va password kiritishingiz kerak'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username kamida 3 ta belgidan iborat bo\'lishi kerak'
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password kamida 4 ta belgidan iborat bo\'lishi kerak'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const requestedRole = req.body.role || 'admin';
    const userRole = req.session.role;

    let roleToAssign = 'admin';
    if (requestedRole === 'super_admin' && userRole === 'super_admin') {
      roleToAssign = 'super_admin';
    } else if (requestedRole === 'admin') {
      roleToAssign = 'admin';
    }

    const result = await pool.query(
      'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id, username, role, is_active, created_at',
      [username, hash, roleToAssign, true]
    );

    res.json({
      success: true,
      message: 'Yangi admin muvaffaqiyatli qo\'shildi',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Create user error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        message: 'Bu username allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Foydalanuvchi yaratishda xatolik'
    });
  }
});

app.put('/api/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { username, password } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri user ID'
      });
    }

    const requestedRole = req.body.role;
    const hasRoleUpdate = requestedRole && req.session.role === 'super_admin'
      && (requestedRole === 'super_admin' || requestedRole === 'admin');

    if (!username && !password && !hasRoleUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Username, password yoki role kiritishingiz kerak'
      });
    }

    if (username && username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username kamida 3 ta belgidan iborat bo\'lishi kerak'
      });
    }

    if (password && password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password kamida 4 ta belgidan iborat bo\'lishi kerak'
      });
    }

    const userCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND role IN (\'super_admin\', \'admin\')',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    let updateQuery = '';
    let queryParams = [];
    let paramIndex = 1;

    const currentUserRole = req.session.role;
    let roleUpdate = '';

    if (hasRoleUpdate) {
      roleUpdate = `, role = $${paramIndex++}`;
      queryParams.push(requestedRole);
    }

    if (username && password) {
      const hash = await bcrypt.hash(password, 10);
      updateQuery = `UPDATE users SET username = $${paramIndex++}, password = $${paramIndex++}${roleUpdate} WHERE id = $${paramIndex} RETURNING id, username, role, is_active, created_at`;
      queryParams = [username, hash, ...queryParams, userId];
    } else if (username) {
      updateQuery = `UPDATE users SET username = $${paramIndex++}${roleUpdate} WHERE id = $${paramIndex} RETURNING id, username, role, is_active, created_at`;
      queryParams = [username, ...queryParams, userId];
    } else if (password) {
      const hash = await bcrypt.hash(password, 10);
      updateQuery = `UPDATE users SET password = $${paramIndex++}${roleUpdate} WHERE id = $${paramIndex} RETURNING id, username, role, is_active, created_at`;
      queryParams = [hash, ...queryParams, userId];
    } else if (roleUpdate) {
      updateQuery = `UPDATE users SET ${roleUpdate.substring(2)} WHERE id = $${paramIndex} RETURNING id, username, role, is_active, created_at`;
      queryParams = [...queryParams, userId];
    }

    if (!updateQuery) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    const result = await pool.query(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    res.json({
      success: true,
      message: 'Admin muvaffaqiyatli yangilandi',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update user error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        message: 'Bu username allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Foydalanuvchini yangilashda xatolik'
    });
  }
});

app.patch('/api/users/:id/status', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { is_active } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri user ID'
      });
    }

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active boolean qiymat bo\'lishi kerak'
      });
    }

    const userCheck = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1 AND role IN (\'super_admin\', \'admin\')',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    if (userCheck.rows[0].id === req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'O\'zingizni to\'xtatib bo\'lmaydi'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET is_active = $1 WHERE id = $2',
        [is_active, userId]
      );

      if (!is_active) {
        // Admin to'xtatilganda, unga tegishli barcha hodimlarni to'xtatish
        await client.query(
          `UPDATE users SET is_active = false 
           WHERE role = 'employee' 
           AND id IN (SELECT user_id FROM employees WHERE admin_id = $1)`,
          [userId]
        );
      } else {
        // Admin faollashtirilganda, unga tegishli barcha hodimlarni faollashtirish
        await client.query(
          `UPDATE users SET is_active = true 
           WHERE role = 'employee' 
           AND id IN (SELECT user_id FROM employees WHERE admin_id = $1)`,
          [userId]
        );
      }

      await client.query('COMMIT');

      const result = await pool.query(
        'SELECT id, username, role, is_active FROM users WHERE id = $1',
        [userId]
      );

      res.json({
        success: true,
        message: is_active
          ? 'Admin faollashtirildi. Unga tegishli hodimlar ham faollashtirildi'
          : 'Admin to\'xtatildi. Unga tegishli hodimlar ham to\'xtatildi',
        user: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Statusni yangilashda xatolik'
    });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri user ID'
      });
    }

    const userCheck = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1 AND role IN (\'super_admin\', \'admin\')',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi yoki o\'chirib bo\'lmaydi'
      });
    }

    if (userCheck.rows[0].id === req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'O\'zingizni o\'chirib bo\'lmaydi'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET is_active = false WHERE role = \'employee\''
      );

      const result = await client.query(
        'DELETE FROM users WHERE id = $1 RETURNING id, username',
        [userId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Admin o\'chirildi. Unga tegishli hodimlar to\'xtatildi',
        user: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Foydalanuvchini o\'chirishda xatolik'
    });
  }
});


app.get('/api/positions', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;

    let query;
    let params;

    if (role === 'super_admin') {
      query = 'SELECT id, name, description, created_at FROM positions ORDER BY name ASC';
      params = [];
    } else {
      query = 'SELECT id, name, description, created_at FROM positions WHERE admin_id = $1 ORDER BY name ASC';
      params = [userId];
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      positions: result.rows
    });
  } catch (error) {
    console.error('Get positions error:', error);
    res.status(500).json({
      success: false,
      message: 'Lavozimlarni olishda xatolik'
    });
  }
});

app.post('/api/positions', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const { userId } = req.session;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Lavozim nomi kiritishingiz kerak'
      });
    }

    const result = await pool.query(
      'INSERT INTO positions (name, description, admin_id) VALUES ($1, $2, $3) RETURNING id, name, description, created_at',
      [name.trim(), description || null, userId]
    );

    res.json({
      success: true,
      message: 'Lavozim muvaffaqiyatli qo\'shildi',
      position: result.rows[0]
    });

  } catch (error) {
    console.error('Create position error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        message: 'Bu lavozim allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Lavozim yaratishda xatolik'
    });
  }
});

app.put('/api/positions/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const positionId = parseInt(req.params.id);
    const { name, description } = req.body;
    const { userId, role } = req.session;

    if (isNaN(positionId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri position ID'
      });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Lavozim nomi kiritishingiz kerak'
      });
    }

    // Check if position exists and belongs to admin
    let checkQuery = 'SELECT id FROM positions WHERE id = $1';
    let checkParams = [positionId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lavozim topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const result = await pool.query(
      'UPDATE positions SET name = $1, description = $2 WHERE id = $3 RETURNING id, name, description, created_at',
      [name.trim(), description || null, positionId]
    );

    res.json({
      success: true,
      message: 'Lavozim muvaffaqiyatli yangilandi',
      position: result.rows[0]
    });

  } catch (error) {
    console.error('Update position error:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Bu lavozim nomi allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Lavozimni yangilashda xatolik'
    });
  }
});

app.delete('/api/positions/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const positionId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(positionId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri position ID'
      });
    }

    // Check if position exists and belongs to admin
    let checkQuery = 'SELECT id, name FROM positions WHERE id = $1';
    let checkParams = [positionId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lavozim topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const positionName = checkResult.rows[0].name;

    // Check if any employees of this admin use this position
    let empCheckQuery = 'SELECT COUNT(*) as count FROM employees WHERE position = $1';
    let empCheckParams = [positionName];

    if (role !== 'super_admin') {
      empCheckQuery += ' AND admin_id = $2';
      empCheckParams.push(userId);
    }

    const empCheckResult = await pool.query(empCheckQuery, empCheckParams);

    if (parseInt(empCheckResult.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Bu lavozimdan foydalanayotgan hodimlar bor. Avval hodimlarni o\'zgartiring yoki o\'chiring'
      });
    }

    const result = await pool.query(
      'DELETE FROM positions WHERE id = $1 RETURNING id, name',
      [positionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lavozim topilmadi'
      });
    }

    res.json({
      success: true,
      message: 'Lavozim muvaffaqiyatli o\'chirildi'
    });

  } catch (error) {
    console.error('Delete position error:', error);
    res.status(500).json({
      success: false,
      message: 'Lavozimni o\'chirishda xatolik'
    });
  }
});


app.get('/api/employees', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Terminal foydalanuvchilarini employee_faces jadvalidan olish va employees jadvaliga qo'shish
      // Duplikatni oldini olish uchun DISTINCT ON (face_template_id, admin_id) ishlatamiz
      let terminalUsersQuery;
      let terminalUsersParams;

      if (role === 'super_admin') {
        terminalUsersQuery = `
          SELECT DISTINCT ON (ef.face_template_id, ef.admin_id)
            ef.face_template_id,
            ef.admin_id,
            ef.employee_id,
            t.name as terminal_name
          FROM employee_faces ef
          JOIN terminals t ON ef.terminal_id = t.id
          WHERE ef.face_template_id IS NOT NULL 
            AND ef.face_template_id != ''
          ORDER BY ef.face_template_id, ef.admin_id, ef.id DESC
        `;
        terminalUsersParams = [];
      } else {
        terminalUsersQuery = `
          SELECT DISTINCT ON (ef.face_template_id, ef.admin_id)
            ef.face_template_id,
            ef.admin_id,
            ef.employee_id,
            t.name as terminal_name
          FROM employee_faces ef
          JOIN terminals t ON ef.terminal_id = t.id
          WHERE ef.face_template_id IS NOT NULL 
            AND ef.face_template_id != ''
            AND ef.admin_id = $1
          ORDER BY ef.face_template_id, ef.admin_id, ef.id DESC
        `;
        terminalUsersParams = [userId];
      }

      const terminalUsersResult = await client.query(terminalUsersQuery, terminalUsersParams);

      console.log(`📊 Terminal foydalanuvchilari topildi (employee_faces): ${terminalUsersResult.rows.length} ta`);

      // 1-bosqich: Attendance logs dan terminal foydalanuvchilarini topish va employees jadvaliga qo'shish
      // ESKI CHEK (faqat employee_faces bo'sh bo'lsa) olib tashlandi – endi har doim ishlaydi.
      console.log('ℹ️  Attendance logs dan yangi hodimlarni qidirish (employee_id IS NULL) boshlanmoqda...');

      let attendanceUsersQuery;
      let attendanceUsersParams;

      if (role === 'super_admin') {
        attendanceUsersQuery = `
          SELECT DISTINCT al.employee_name, al.terminal_name, t.id as terminal_id, t.admin_id
          FROM attendance_logs al
          JOIN terminals t ON t.name = al.terminal_name
          WHERE al.employee_id IS NULL
            AND al.employee_name IS NOT NULL
            AND length(al.employee_name) > 0
            AND al.employee_name NOT LIKE $1
            AND al.employee_name <> $2
            AND t.is_active = true
          ORDER BY al.employee_name, t.admin_id
        `;
        attendanceUsersParams = ['Noma%', 'Unknown'];
      } else {
        attendanceUsersQuery = `
          SELECT DISTINCT al.employee_name, al.terminal_name, t.id as terminal_id, t.admin_id
          FROM attendance_logs al
          JOIN terminals t ON t.name = al.terminal_name
          WHERE al.employee_id IS NULL
            AND al.employee_name IS NOT NULL
            AND length(al.employee_name) > 0
            AND al.employee_name NOT LIKE $1
            AND al.employee_name <> $2
            AND t.is_active = true
            AND t.admin_id = $3
          ORDER BY al.employee_name, t.admin_id
        `;
        attendanceUsersParams = ['Noma%', 'Unknown', userId];
      }

      let attendanceUsersResult;
      try {
        attendanceUsersResult = await client.query(attendanceUsersQuery, attendanceUsersParams);
        console.log(`📊 Attendance logs dan terminal foydalanuvchilari topildi: ${attendanceUsersResult.rows.length} ta (employee_id IS NULL)`);
      } catch (sqlError) {
        console.error('❌ SQL query xatolik (attendance users):', sqlError.message);
        console.error('❌ SQL query:', attendanceUsersQuery);
        console.error('❌ SQL params:', attendanceUsersParams);
        attendanceUsersResult = { rows: [] };
      }

      // Bu foydalanuvchilarni employees jadvaliga qo'shish
      for (const attendanceUser of attendanceUsersResult.rows) {
        const { employee_name, terminal_id, admin_id } = attendanceUser;

        // Employee mavjudligini tekshirish (full_name + admin_id bo'yicha)
        const existingEmployeeCheck = await client.query(
          `SELECT id FROM employees 
           WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND admin_id = $2
           LIMIT 1`,
          [employee_name, admin_id]
        );

        let targetEmployeeId = existingEmployeeCheck.rows.length > 0
          ? existingEmployeeCheck.rows[0].id
          : null;

        // Agar employee mavjud bo'lmasa – yangi employee yaratamiz
        if (!targetEmployeeId) {
          try {
            // Username yaratish (employee_name dan)
            const baseUsername = `employee_${employee_name.replace(/\s+/g, '_').toLowerCase()}`;
            let finalUsername = baseUsername;
            let counter = 1;
            while (true) {
              const userCheck = await client.query(
                'SELECT id FROM users WHERE username = $1',
                [finalUsername]
              );
              if (userCheck.rows.length === 0) {
                break;
              }
              finalUsername = `${baseUsername}_${counter}`;
              counter++;
            }

            // User yaratish
            const userResult = await client.query(
              'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
              [finalUsername, '$2b$10$dummy', 'employee', true]
            );

            const newUserId = userResult.rows[0].id;

            // Employee yaratish
            const empResult = await client.query(
              `INSERT INTO employees (user_id, admin_id, full_name, position) 
               VALUES ($1, $2, $3, $4) 
               RETURNING id`,
              [newUserId, admin_id, employee_name, 'Terminal foydalanuvchisi']
            );

            targetEmployeeId = empResult.rows[0].id;

            console.log(`✅ Attendance log dan employee yaratildi: "${employee_name}", employee_id=${targetEmployeeId}`);
          } catch (error) {
            if (error.code !== '23505') {
              console.error(`❌ Employee yaratishda xatolik ("${employee_name}"):`, error.message);
            }
          }
        }

        // Agar targetEmployeeId mavjud bo'lsa – attendance_logs dagi mos yozuvlarga employee_id ni qo'yamiz
        if (targetEmployeeId) {
          try {
            const updateResult = await client.query(
              `UPDATE attendance_logs al
               SET employee_id = $1
               WHERE al.employee_id IS NULL
                 AND al.employee_name = $2`,
              [targetEmployeeId, employee_name]
            );
            if (updateResult.rowCount > 0) {
              console.log(`✅ Attendance logs yangilandi: "${employee_name}" uchun ${updateResult.rowCount} ta yozuvga employee_id=${targetEmployeeId} qo'yildi`);
            }
          } catch (updateError) {
            console.error(`⚠️  Attendance logs yangilashda xatolik ("${employee_name}"):`, updateError.message);
          }
        }
      }

      // 2. Terminal foydalanuvchilarini employees jadvaliga qo'shish (agar yo'q bo'lsa)
      // face_template_id va admin_id orqali unique terminal foydalanuvchilarini topish
      const uniqueTerminalUsers = new Map();
      for (const terminalUser of terminalUsersResult.rows) {
        const { face_template_id, admin_id, employee_id } = terminalUser;
        const key = `${face_template_id}_${admin_id}`;

        // Duplikatni oldini olish - bir xil face_template_id va admin_id uchun faqat bir marta
        if (!uniqueTerminalUsers.has(key)) {
          uniqueTerminalUsers.set(key, { face_template_id, admin_id, employee_id });
        }
      }

      for (const [key, terminalUser] of uniqueTerminalUsers) {
        const { face_template_id, admin_id, employee_id } = terminalUser;

        // Agar employee_id mavjud bo'lsa, employee allaqachon mavjud
        if (employee_id) {
          // Employee mavjudligini tekshirish
          const employeeCheck = await client.query(
            'SELECT id FROM employees WHERE id = $1',
            [employee_id]
          );

          if (employeeCheck.rows.length === 0) {
            // employee_id mavjud, lekin employees jadvalida yo'q - bu xatolik holati
            console.warn(`⚠️  employee_faces'da employee_id=${employee_id} mavjud, lekin employees jadvalida yo'q`);
          }
          continue;
        }

        // Employee mavjudligini tekshirish (face_template_id orqali)
        const existingEmployeeCheck = await client.query(
          `SELECT DISTINCT e.id 
           FROM employees e
           JOIN employee_faces ef ON e.id = ef.employee_id
           WHERE ef.face_template_id = $1 AND e.admin_id = $2
           LIMIT 1`,
          [face_template_id, admin_id]
        );

        if (existingEmployeeCheck.rows.length > 0) {
          // Employee mavjud, lekin employee_faces'da employee_id yo'q - yangilash
          const existingEmployeeId = existingEmployeeCheck.rows[0].id;
          await client.query(
            `UPDATE employee_faces 
             SET employee_id = $1 
             WHERE face_template_id = $2 AND admin_id = $3 AND employee_id = $1`,
            [existingEmployeeId, face_template_id, admin_id]
          );
          continue;
        }

        // Yangi employee yaratish
        try {
          // Username yaratish (face_template_id dan)
          const username = `employee_${face_template_id}`;

          // Username unique bo'lishini ta'minlash
          let finalUsername = username;
          let counter = 1;
          while (true) {
            const userCheck = await client.query(
              'SELECT id FROM users WHERE username = $1',
              [finalUsername]
            );
            if (userCheck.rows.length === 0) {
              break;
            }
            finalUsername = `${username}_${counter}`;
            counter++;
          }

          // User yaratish
          const userResult = await client.query(
            'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
            [finalUsername, '$2b$10$dummy', 'employee', true] // Dummy password, keyinroq o'zgartiriladi
          );

          const newUserId = userResult.rows[0].id;

          // Employee yaratish
          const empResult = await client.query(
            `INSERT INTO employees (user_id, admin_id, full_name, position) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id`,
            [newUserId, admin_id, `Hodim ${face_template_id}`, 'Terminal foydalanuvchisi']
          );

          const newEmployeeId = empResult.rows[0].id;

          // employee_faces'da employee_id ni yangilash (barcha shu face_template_id va admin_id ga tegishli)
          await client.query(
            `UPDATE employee_faces 
             SET employee_id = $1 
             WHERE face_template_id = $2 AND admin_id = $3`,
            [newEmployeeId, face_template_id, admin_id]
          );

          console.log(`✅ Terminal foydalanuvchisi employees jadvaliga qo'shildi: face_template_id="${face_template_id}", employee_id=${newEmployeeId}`);
        } catch (error) {
          // Duplikat yoki boshqa xatolik - o'tkazib yuborish
          if (error.code !== '23505') {
            console.error(`❌ Terminal foydalanuvchisini yaratishda xatolik (face_template_id="${face_template_id}"):`, error.message);
          }
        }
      }

      await client.query('COMMIT');

      // 3. Barcha employees'ni olish (oddiy employees + terminal foydalanuvchilari)
      let query;
      let params;

      if (role === 'super_admin') {
        query = `
          SELECT DISTINCT
          e.id,
          e.user_id,
          e.admin_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
            u.username,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM employee_faces ef 
                WHERE ef.employee_id = e.id
              ) THEN true 
              ELSE false 
            END as is_terminal_user,
            (
              SELECT al.picture_url 
              FROM attendance_logs al 
              WHERE (al.employee_id = e.id OR (al.employee_id IS NULL AND al.employee_name = e.full_name))
                AND al.picture_url IS NOT NULL
              ORDER BY al.event_time DESC
              LIMIT 1
            ) as picture_url
        FROM employees e
        JOIN users u ON e.user_id = u.id
        ORDER BY e.created_at DESC
      `;
        params = [];
      } else {
        query = `
          SELECT DISTINCT
          e.id,
          e.user_id,
          e.admin_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
            u.username,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM employee_faces ef 
                WHERE ef.employee_id = e.id AND ef.admin_id = $1
              ) THEN true 
              ELSE false 
            END as is_terminal_user,
            (
              SELECT al.picture_url 
              FROM attendance_logs al 
              WHERE (al.employee_id = e.id OR (al.employee_id IS NULL AND al.employee_name = e.full_name))
                AND al.picture_url IS NOT NULL
                AND (al.admin_id = $1 OR al.admin_id IS NULL)
              ORDER BY al.event_time DESC
              LIMIT 1
            ) as picture_url
        FROM employees e
        JOIN users u ON e.user_id = u.id
        WHERE e.admin_id = $1
        ORDER BY e.created_at DESC
      `;
        params = [userId];
      }

      const result = await client.query(query, params);

      console.log(`📊 Barcha employees topildi: ${result.rows.length} ta`);

      client.release();

      res.json({
        success: true,
        employees: result.rows
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodimlarni olishda xatolik'
    });
  }
});

app.get('/api/employees/:id', requireAuth, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { role, userId } = req.session;

    let query;
    let params;

    if (role === 'employee') {
      query = `
        SELECT 
          e.id,
          e.user_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
          u.username
        FROM employees e
        JOIN users u ON e.user_id = u.id
        WHERE e.user_id = $1
      `;
      params = [userId];
    } else {
      query = `
        SELECT 
          e.id,
          e.user_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
          u.username
        FROM employees e
        JOIN users u ON e.user_id = u.id
        WHERE e.id = $1
      `;
      params = [employeeId];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    res.json({
      success: true,
      employee: result.rows[0]
    });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodim ma\'lumotlarini olishda xatolik'
    });
  }
});

app.post('/api/employees', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { username, password, full_name, position, phone, email } = req.body;

    if (!username || !password || !full_name || !position) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, to\'liq ism va lavozim kiritishingiz kerak'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username kamida 3 ta belgidan iborat bo\'lishi kerak'
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password kamida 4 ta belgidan iborat bo\'lishi kerak'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const hash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, hash, 'employee', true]
      );

      const userId = userResult.rows[0].id;

      const adminId = req.session.userId; // The admin creating the employee
      const empResult = await client.query(
        `INSERT INTO employees (user_id, admin_id, full_name, position, phone, email) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING id, user_id, admin_id, full_name, position, phone, email, created_at`,
        [userId, adminId, full_name, position, phone || null, email || null]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Hodim muvaffaqiyatli qo\'shildi',
        employee: empResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Create employee error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        message: 'Bu username allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Hodim yaratishda xatolik'
    });
  }
});

// Hodim statusini o'zgartirish (faollashtirish/to'xtatish)
app.patch('/api/employees/:id/status', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { is_active } = req.body;
    const { userId, role } = req.session;

    if (isNaN(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri employee ID'
      });
    }

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active boolean qiymat bo\'lishi kerak'
      });
    }

    // Hodimni tekshirish va admin_id ni olish
    const employeeCheck = await pool.query(
      'SELECT user_id, admin_id FROM employees WHERE id = $1',
      [employeeId]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    const employeeUserId = employeeCheck.rows[0].user_id;
    const employeeAdminId = employeeCheck.rows[0].admin_id;

    // Ruxsat tekshiruvi
    if (role !== 'super_admin' && employeeAdminId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizni boshqara olasiz'
      });
    }

    // Hodim statusini yangilash
    await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2',
      [is_active, employeeUserId]
    );

    const result = await pool.query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [employeeUserId]
    );

    res.json({
      success: true,
      message: is_active ? 'Hodim faollashtirildi' : 'Hodim to\'xtatildi',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update employee status error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodim statusini yangilashda xatolik'
    });
  }
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { role, userId } = req.session;
    const { full_name, position, phone, email, username, password } = req.body;

    if (isNaN(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri employee ID'
      });
    }

    const checkResult = await pool.query(
      'SELECT user_id, admin_id FROM employees WHERE id = $1',
      [employeeId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    const employeeUserId = checkResult.rows[0].user_id;
    const employeeAdminId = checkResult.rows[0].admin_id;

    if (role === 'employee' && employeeUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z ma\'lumotlaringizni yangilay olasiz'
      });
    }

    if (['super_admin', 'admin'].includes(role) && role !== 'super_admin' && employeeAdminId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizni yangilay olasiz'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (username || password) {
        if (!['super_admin', 'admin'].includes(role)) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'Username va password ni faqat adminlar o\'zgartira oladi'
          });
        }

        let userUpdateQuery = '';
        let userParams = [];

        if (username && password) {
          const hash = await bcrypt.hash(password, 10);
          userUpdateQuery = 'UPDATE users SET username = $1, password = $2 WHERE id = $3';
          userParams = [username, hash, employeeUserId];
        } else if (username) {
          userUpdateQuery = 'UPDATE users SET username = $1 WHERE id = $2';
          userParams = [username, employeeUserId];
        } else if (password) {
          const hash = await bcrypt.hash(password, 10);
          userUpdateQuery = 'UPDATE users SET password = $1 WHERE id = $2';
          userParams = [hash, employeeUserId];
        }

        if (userUpdateQuery) {
          await client.query(userUpdateQuery, userParams);
        }
      }

      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      if (full_name) {
        updateFields.push(`full_name = $${paramIndex++}`);
        updateValues.push(full_name);
      }
      if (position) {
        updateFields.push(`position = $${paramIndex++}`);
        updateValues.push(position);
      }
      if (phone !== undefined) {
        updateFields.push(`phone = $${paramIndex++}`);
        updateValues.push(phone || null);
      }
      if (email !== undefined) {
        updateFields.push(`email = $${paramIndex++}`);
        updateValues.push(email || null);
      }

      if (updateFields.length > 0) {
        updateValues.push(employeeId);
        await client.query(
          `UPDATE employees SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
          updateValues
        );
      }

      const result = await client.query(`
        SELECT 
          e.id,
          e.user_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
          u.username
        FROM employees e
        JOIN users u ON e.user_id = u.id
        WHERE e.id = $1
      `, [employeeId]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Hodim muvaffaqiyatli yangilandi',
        employee: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Update employee error:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Bu username allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Hodimni yangilashda xatolik'
    });
  }
});

app.delete('/api/employees/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri employee ID'
      });
    }

    const empResult = await pool.query(
      `SELECT e.id, e.admin_id, e.full_name, u.id as user_id, u.role as user_role 
       FROM employees e 
       JOIN users u ON e.user_id = u.id 
       WHERE e.id = $1`,
      [employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    const employeeAdminId = empResult.rows[0].admin_id;
    const employeeUserId = empResult.rows[0].user_id;
    const employeeName = empResult.rows[0].full_name;
    const employeeUserRole = empResult.rows[0].user_role;

    if (role !== 'super_admin' && employeeAdminId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizni o\'chira olasiz'
      });
    }

    // Admin yoki super_admin userlarini tasodifan o'chirmaslik uchun tekshiruv
    if (employeeUserRole && employeeUserRole !== 'employee') {
      return res.status(400).json({
        success: false,
        message: 'Faqat employee roldagi foydalanuvchilarga bog\'langan hodimlarni o\'chirish mumkin'
      });
    }

    // Hodimni o'chirishni tranzaksiyada bajarish:
    // 1) attendance_logs: employee_id ni NULL qilish (tarix saqlanadi)
    // 2) employee_faces, daily_changes, salaries, bonuses, penalties, kpi_records, work_schedules, salary_rates va hokazolarni tozalash
    // 3) employees va users yozuvlarini o'chirish
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1) Attendance tarixini saqlab qolamiz, faqat bog'lanishni uzamiz
      await client.query(
        'UPDATE attendance_logs SET employee_id = NULL WHERE employee_id = $1',
        [employeeId]
      );

      // 2) Employee bilan bog‘liq barcha qo‘shimcha jadvallarni tozalash
      await client.query(
        'DELETE FROM employee_faces WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM daily_changes WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM salaries WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM bonuses WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM penalties WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM kpi_records WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM work_schedules WHERE employee_id = $1',
        [employeeId]
      );

      await client.query(
        'DELETE FROM salary_rates WHERE employee_id = $1',
        [employeeId]
      );

      // 3) Employee va unga tegishli user yozuvlarini o'chirish
      await client.query('DELETE FROM employees WHERE id = $1', [employeeId]);

      // Faqat employee roldagi userni o'chiramiz
      if (employeeUserId) {
        await client.query(
          'DELETE FROM users WHERE id = $1 AND role = $2',
          [employeeUserId, 'employee']
        );
      }

      await client.query('COMMIT');

      console.log(`✅ Hodim va bog'liq ma'lumotlar o'chirildi: employee_id=${employeeId}, full_name="${employeeName}", user_id=${employeeUserId}`);
    } catch (txError) {
      await client.query('ROLLBACK');
      console.error('Delete employee transaction error:', txError);
      return res.status(500).json({
        success: false,
        message: 'Hodimni o\'chirishda xatolik (tranzaksiya)',
        error: txError.message
      });
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: 'Hodim muvaffaqiyatli o\'chirildi'
    });

  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodimni o\'chirishda xatolik'
    });
  }
});

app.post('/api/employees/generate-from-terminals', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const adminId = userId;

    let terminalsQuery = 'SELECT id, ip_address, username, password, name FROM terminals WHERE is_active = true';
    let terminalsParams = [];

    if (role !== 'super_admin') {
      terminalsQuery += ' AND admin_id = $1';
      terminalsParams.push(userId);
    }

    const terminalsResult = await pool.query(terminalsQuery, terminalsParams);
    const terminals = terminalsResult.rows;

    if (terminals.length === 0) {
      return res.json({
        success: true,
        message: 'Faol terminallar topilmadi',
        created: 0,
        employees: []
      });
    }

    const HikvisionISAPIService = require('./services/hikvision-isapi');
    const client = await pool.connect();
    const createdEmployees = [];
    const defaultPassword = '123456';
    const defaultPosition = 'Hodim';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    try {
      await client.query('BEGIN');

      for (const terminal of terminals) {
        try {
          const hikvisionService = new HikvisionISAPIService({
            ip_address: terminal.ip_address,
            username: terminal.username,
            password: terminal.password
          });

          const result = await hikvisionService.getUsersAndFaces();

          if (!result.success || !result.users || result.users.length === 0) {
            continue;
          }

          for (const user of result.users) {
            if (!user.name || !user.name.trim()) continue;

            const employeeName = user.name.trim();

            const existingCheck = await client.query(
              `SELECT e.id FROM employees e 
               JOIN users u ON e.user_id = u.id 
               WHERE LOWER(TRIM(e.full_name)) = LOWER($1) 
                  OR LOWER(TRIM(u.username)) = LOWER($1)`,
              [employeeName]
            );

            if (existingCheck.rows.length > 0) {
              continue;
            }

            try {
              let username = employeeName
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');

              if (username.length < 3) {
                username = `emp_${username}`;
              }

              let finalUsername = username;
              let counter = 1;
              while (true) {
                const userCheck = await client.query(
                  'SELECT id FROM users WHERE username = $1',
                  [finalUsername]
                );
                if (userCheck.rows.length === 0) {
                  break;
                }
                finalUsername = `${username}_${counter}`;
                counter++;
              }

              const userResult = await client.query(
                'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
                [finalUsername, hashedPassword, 'employee', true]
              );

              const newUserId = userResult.rows[0].id;

              const empResult = await client.query(
                `INSERT INTO employees (user_id, admin_id, full_name, position) 
                 VALUES ($1, $2, $3, $4) 
                 RETURNING id, user_id, admin_id, full_name, position, phone, email, created_at`,
                [newUserId, adminId, employeeName, defaultPosition]
              );

              createdEmployees.push({
                ...empResult.rows[0],
                username: finalUsername
              });
            } catch (error) {
              if (error.code !== '23505') {
                console.error(`Error creating employee ${employeeName}:`, error.message);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing terminal ${terminal.name}:`, error.message);
          continue;
        }
      }

      await client.query('COMMIT');
      client.release();

      res.json({
        success: true,
        message: `${createdEmployees.length} ta yangi hodim yaratildi`,
        created: createdEmployees.length,
        employees: createdEmployees
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Generate employees from terminals error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminallardan hodimlarni yaratishda xatolik'
    });
  }
});

app.post('/api/employees/generate-from-logs', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const adminId = userId; // Admin who creates these employees

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const uniqueNamesResult = await client.query(
        `SELECT DISTINCT al.employee_name 
         FROM attendance_logs al
         WHERE al.employee_id IS NULL 
           AND al.employee_name IS NOT NULL 
           AND TRIM(al.employee_name) != ''
           AND NOT EXISTS (
             SELECT 1 FROM employees e 
             JOIN users u ON e.user_id = u.id 
             WHERE LOWER(TRIM(u.username)) = LOWER(TRIM(al.employee_name))
                OR LOWER(TRIM(e.full_name)) = LOWER(TRIM(al.employee_name))
           )
         ORDER BY al.employee_name`
      );

      const uniqueNames = uniqueNamesResult.rows.map(row => row.employee_name);

      if (uniqueNames.length === 0) {
        await client.query('COMMIT');
        client.release();
        return res.json({
          success: true,
          message: 'Yangi hodimlar topilmadi',
          created: 0,
          employees: []
        });
      }

      const createdEmployees = [];
      const defaultPassword = '123456'; // Default password
      const defaultPosition = 'Hodim'; // Default position
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);

      for (const employeeName of uniqueNames) {
        try {
          let username = employeeName
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');

          if (username.length < 3) {
            username = `emp_${username}`;
          }

          let finalUsername = username;
          let counter = 1;
          while (true) {
            const userCheck = await client.query(
              'SELECT id FROM users WHERE username = $1',
              [finalUsername]
            );
            if (userCheck.rows.length === 0) {
              break; // Username is available
            }
            finalUsername = `${username}_${counter}`;
            counter++;
          }

          const userResult = await client.query(
            'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
            [finalUsername, hashedPassword, 'employee', true]
          );

          const userId = userResult.rows[0].id;

          const empResult = await client.query(
            `INSERT INTO employees (user_id, admin_id, full_name, position) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, user_id, admin_id, full_name, position, phone, email, created_at`,
            [userId, adminId, employeeName, defaultPosition]
          );

          await client.query(
            `UPDATE attendance_logs 
             SET employee_id = $1 
             WHERE employee_name = $2 AND employee_id IS NULL`,
            [empResult.rows[0].id, employeeName]
          );

          createdEmployees.push({
            ...empResult.rows[0],
            username: finalUsername
          });
        } catch (error) {
          if (error.code !== '23505') { // Not a unique violation
            console.error(`Error creating employee ${employeeName}:`, error.message);
          }
        }
      }

      await client.query('COMMIT');
      client.release();

      res.json({
        success: true,
        message: `${createdEmployees.length} ta hodim yaratildi`,
        created: createdEmployees.length,
        employees: createdEmployees
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Generate employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodimlarni yaratishda xatolik'
    });
  }
});


app.get('/api/employees/:id/work-schedule', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { userId, role } = req.session;

    // Check if employee exists and belongs to admin
    let empCheckQuery = 'SELECT id, admin_id FROM employees WHERE id = $1';
    let empCheckParams = [employeeId];

    if (role !== 'super_admin') {
      empCheckQuery += ' AND admin_id = $2';
      empCheckParams.push(userId);
    }

    const empCheck = await pool.query(empCheckQuery, empCheckParams);

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const result = await pool.query(
      `SELECT id, employee_id, day_of_week, start_time, end_time, is_active
       FROM work_schedules
       WHERE employee_id = $1
       ORDER BY day_of_week`,
      [employeeId]
    );

    res.json({
      success: true,
      schedule: result.rows
    });
  } catch (error) {
    console.error('Get work schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish jadvalini olishda xatolik'
    });
  }
});

app.post('/api/employees/:id/work-schedule', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { schedules } = req.body; // Array of {day_of_week, start_time, end_time, is_active}
    const { userId, role } = req.session;

    if (!Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: 'Ish jadvali ma\'lumotlari to\'g\'ri formatda emas'
      });
    }

    // Check if employee exists and belongs to admin
    let empCheckQuery = 'SELECT id, admin_id FROM employees WHERE id = $1';
    let empCheckParams = [employeeId];

    if (role !== 'super_admin') {
      empCheckQuery += ' AND admin_id = $2';
      empCheckParams.push(userId);
    }

    const empCheck = await pool.query(empCheckQuery, empCheckParams);

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const adminId = empCheck.rows[0].admin_id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM work_schedules WHERE employee_id = $1', [employeeId]);

      for (const sched of schedules) {
        if (sched.is_active !== false) { // Only insert active schedules
          await client.query(
            `INSERT INTO work_schedules (employee_id, day_of_week, start_time, end_time, is_active, admin_id)
             VALUES ($1, $2, $3, $4, true, $5)
             ON CONFLICT (employee_id, day_of_week) 
             DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, updated_at = CURRENT_TIMESTAMP`,
            [employeeId, sched.day_of_week, sched.start_time, sched.end_time, adminId]
          );
        }
      }

      await client.query('COMMIT');
      client.release();

      res.json({
        success: true,
        message: 'Ish jadvali muvaffaqiyatli saqlandi'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Save work schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish jadvalini saqlashda xatolik'
    });
  }
});

app.get('/api/organization', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId } = req.session;

    const result = await pool.query(
      `SELECT 
        organization_name, 
        organization_address,
        organization_phone,
        organization_email,
        logo_path,
        late_threshold_minutes,
        penalty_per_minute,
        max_penalty_per_day
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length > 0) {
      res.json({
        success: true,
        organization: {
          organization_name: result.rows[0].organization_name || '',
          organization_address: result.rows[0].organization_address || '',
          organization_phone: result.rows[0].organization_phone || '',
          organization_email: result.rows[0].organization_email || '',
          logo_path: result.rows[0].logo_path || '',
          late_threshold_minutes: result.rows[0].late_threshold_minutes ?? 5,
          penalty_per_minute: result.rows[0].penalty_per_minute ?? 1000,
          max_penalty_per_day: result.rows[0].max_penalty_per_day ?? 50000
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Tashkilot ma\'lumotlarini olishda xatolik'
    });
  }
});

app.put('/api/organization', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId } = req.session;
    const {
      organization_name,
      organization_address,
      organization_phone,
      organization_email,
      late_threshold_minutes,
      penalty_per_minute,
      max_penalty_per_day
    } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (organization_name !== undefined) {
      updates.push(`organization_name = $${paramIndex}`);
      values.push(organization_name || null);
      paramIndex++;
    }
    if (organization_address !== undefined) {
      updates.push(`organization_address = $${paramIndex}`);
      values.push(organization_address || null);
      paramIndex++;
    }
    if (organization_phone !== undefined) {
      updates.push(`organization_phone = $${paramIndex}`);
      values.push(organization_phone || null);
      paramIndex++;
    }
    if (organization_email !== undefined) {
      updates.push(`organization_email = $${paramIndex}`);
      values.push(organization_email || null);
      paramIndex++;
    }
    if (late_threshold_minutes !== undefined) {
      updates.push(`late_threshold_minutes = $${paramIndex}`);
      values.push(late_threshold_minutes !== null && late_threshold_minutes !== '' ? parseInt(late_threshold_minutes) : 5);
      paramIndex++;
    }
    if (penalty_per_minute !== undefined) {
      updates.push(`penalty_per_minute = $${paramIndex}`);
      values.push(penalty_per_minute !== null && penalty_per_minute !== '' ? parseInt(penalty_per_minute) : 1000);
      paramIndex++;
    }
    if (max_penalty_per_day !== undefined) {
      updates.push(`max_penalty_per_day = $${paramIndex}`);
      values.push(max_penalty_per_day !== null && max_penalty_per_day !== '' ? parseInt(max_penalty_per_day) : 50000);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilanishi kerak bo\'lgan maydonlar ko\'rsatilmagan'
      });
    }

    values.push(userId);
    const query = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING organization_name, organization_address, organization_phone, organization_email, logo_path, late_threshold_minutes, penalty_per_minute, max_penalty_per_day
    `;

    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      res.json({
        success: true,
        message: 'Tashkilot ma\'lumotlari muvaffaqiyatli yangilandi',
        organization: {
          organization_name: result.rows[0].organization_name || '',
          organization_address: result.rows[0].organization_address || '',
          organization_phone: result.rows[0].organization_phone || '',
          organization_email: result.rows[0].organization_email || '',
          logo_path: result.rows[0].logo_path || '',
          late_threshold_minutes: result.rows[0].late_threshold_minutes ?? 5,
          penalty_per_minute: result.rows[0].penalty_per_minute ?? 1000,
          max_penalty_per_day: result.rows[0].max_penalty_per_day ?? 50000
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Tashkilot ma\'lumotlarini yangilashda xatolik'
    });
  }
});

app.post('/api/users/change-password', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId } = req.session;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Joriy parol va yangi parol kiritilishi kerak'
      });
    }

    if (new_password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Yangi parol kamida 4 ta belgidan iborat bo\'lishi kerak'
      });
    }

    const result = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(current_password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Joriy parol noto\'g\'ri'
      });
    }

    const hashedNewPassword = await bcrypt.hash(new_password, 10);

    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.json({
      success: true,
      message: 'Parol muvaffaqiyatli o\'zgartirildi'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Parolni o\'zgartirishda xatolik yuz berdi'
    });
  }
});

app.post('/api/organization/logo', requireAuth, requireRole('super_admin', 'admin'), upload.single('logo'), async (req, res) => {
  try {
    const { userId } = req.session;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Rasm fayli yuklanishi kerak'
      });
    }

    const logoPath = `/uploads/logos/${req.file.filename}`;

    const oldResult = await pool.query(
      'SELECT logo_path FROM users WHERE id = $1',
      [userId]
    );

    if (oldResult.rows.length > 0 && oldResult.rows[0].logo_path) {
      const oldLogoPath = path.join(__dirname, 'public', oldResult.rows[0].logo_path);
      if (fs.existsSync(oldLogoPath)) {
        try {
          fs.unlinkSync(oldLogoPath);
        } catch (err) {
          console.error('Error deleting old logo:', err);
        }
      }
    }

    const result = await pool.query(
      'UPDATE users SET logo_path = $1 WHERE id = $2 RETURNING logo_path',
      [logoPath, userId]
    );

    if (result.rows.length > 0) {
      res.json({
        success: true,
        message: 'Logo muvaffaqiyatli yuklandi',
        logo_path: result.rows[0].logo_path
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }
  } catch (error) {
    console.error('Upload logo error:', error);
    res.status(500).json({
      success: false,
      message: 'Logo yuklashda xatolik'
    });
  }
});


app.get('/api/salaries', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, start_date, end_date } = req.query;

    let query = `
      SELECT 
        s.id,
        s.employee_id,
        s.amount,
        s.period_type,
        s.period_date,
        COALESCE(s.work_position, e.position) as work_position,
        s.work_position as actual_work_position,
        s.notes,
        s.created_at,
        s.created_by,
        e.full_name,
        e.position as employee_position,
        u.username as employee_username
      FROM salaries s
      JOIN employees e ON s.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (employee_id) {
      query += ` AND s.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }

    if (period_type && ['daily', 'weekly', 'monthly'].includes(period_type)) {
      query += ` AND s.period_type = $${paramIndex++}`;
      params.push(period_type);
    }

    // Sana oraliq filtrlash
    if (start_date) {
      query += ` AND s.period_date >= $${paramIndex++}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND s.period_date <= $${paramIndex++}`;
      params.push(end_date);
    }

    query += ` ORDER BY s.period_date DESC, s.created_at DESC`;

    // Pagination qo'shish - default limit 100 (xavfsizlik uchun parameterize qilindi)
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Total count uchun alohida query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM salaries s
      JOIN employees e ON s.employee_id = e.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;

    if (role !== 'super_admin') {
      countQuery += ` AND e.admin_id = $${countParamIndex++}`;
      countParams.push(userId);
    }

    if (employee_id) {
      countQuery += ` AND s.employee_id = $${countParamIndex++}`;
      countParams.push(parseInt(employee_id));
    }

    if (period_type && ['daily', 'weekly', 'monthly'].includes(period_type)) {
      countQuery += ` AND s.period_type = $${countParamIndex++}`;
      countParams.push(period_type);
    }

    // Sana oraliq filtrlash (count query uchun ham)
    if (start_date) {
      countQuery += ` AND s.period_date >= $${countParamIndex++}`;
      countParams.push(start_date);
    }

    if (end_date) {
      countQuery += ` AND s.period_date <= $${countParamIndex++}`;
      countParams.push(end_date);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      salaries: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total
      }
    });
  } catch (error) {
    console.error('Get salaries error:', error);
    res.status(500).json({
      success: false,
      message: 'Maoshlarni olishda xatolik'
    });
  }
});

app.get('/api/salaries/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const salaryId = parseInt(req.params.id);
    const { userId, role } = req.session;

    let query = `
      SELECT 
        s.id,
        s.employee_id,
        s.amount,
        s.period_type,
        s.period_date,
        COALESCE(s.work_position, e.position) as work_position,
        s.work_position as actual_work_position,
        s.notes,
        s.created_at,
        s.created_by,
        e.full_name,
        e.position as employee_position,
        e.admin_id,
        u.username as employee_username
      FROM salaries s
      JOIN employees e ON s.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE s.id = $1
    `;

    const params = [salaryId];

    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $2`;
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Maosh topilmadi'
      });
    }

    res.json({
      success: true,
      salary: result.rows[0]
    });
  } catch (error) {
    console.error('Get salary error:', error);
    res.status(500).json({
      success: false,
      message: 'Maosh ma\'lumotlarini olishda xatolik'
    });
  }
});

app.post('/api/salaries', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id, amount, period_type, period_date, work_position, notes } = req.body;
    const { userId } = req.session;

    if (!employee_id || !amount || !period_type || !period_date) {
      return res.status(400).json({
        success: false,
        message: 'Hodim, summa, davr turi va sana kiritishingiz kerak'
      });
    }

    if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
      return res.status(400).json({
        success: false,
        message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Summa musbat son bo\'lishi kerak'
      });
    }

    const employeeCheck = await pool.query(
      'SELECT id, admin_id, position FROM employees WHERE id = $1',
      [employee_id]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    if (req.session.role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizning maoshlarini kiritishingiz mumkin'
      });
    }

    const finalWorkPosition = (work_position && work_position.trim())
      ? work_position.trim()
      : null;

    const result = await pool.query(
      `INSERT INTO salaries (employee_id, amount, period_type, period_date, work_position, notes, admin_id, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, employee_id, amount, period_type, period_date, work_position, notes, created_at, created_by`,
      [employee_id, parseFloat(amount), period_type, period_date, finalWorkPosition, notes || null, employeeCheck.rows[0].admin_id, userId]
    );

    res.json({
      success: true,
      message: 'Maosh muvaffaqiyatli qo\'shildi',
      salary: result.rows[0]
    });
  } catch (error) {
    console.error('Create salary error:', error);
    res.status(500).json({
      success: false,
      message: 'Maosh qo\'shishda xatolik'
    });
  }
});

app.put('/api/salaries/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const salaryId = parseInt(req.params.id);
    const { amount, period_type, period_date, work_position, notes } = req.body;
    const { userId, role } = req.session;

    if (isNaN(salaryId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri maosh ID'
      });
    }

    let checkQuery = `
      SELECT s.id, e.admin_id 
      FROM salaries s
      JOIN employees e ON s.employee_id = e.id
      WHERE s.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [salaryId, userId] : [salaryId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Maosh topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (amount !== undefined) {
      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Summa musbat son bo\'lishi kerak'
        });
      }
      updateFields.push(`amount = $${paramIndex++}`);
      updateValues.push(parseFloat(amount));
    }

    if (period_type !== undefined) {
      if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
        return res.status(400).json({
          success: false,
          message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
        });
      }
      updateFields.push(`period_type = $${paramIndex++}`);
      updateValues.push(period_type);
    }

    if (period_date !== undefined) {
      updateFields.push(`period_date = $${paramIndex++}`);
      updateValues.push(period_date);
    }

    if (work_position !== undefined) {
      const finalWorkPosition = (work_position && work_position.trim())
        ? work_position.trim()
        : null;
      updateFields.push(`work_position = $${paramIndex++}`);
      updateValues.push(finalWorkPosition);
    }

    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      updateValues.push(notes || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateValues.push(salaryId);
    const updateQuery = `
      UPDATE salaries 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, employee_id, amount, period_type, period_date, work_position, notes, created_at, created_by
    `;

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      message: 'Maosh muvaffaqiyatli yangilandi',
      salary: result.rows[0]
    });
  } catch (error) {
    console.error('Update salary error:', error);
    res.status(500).json({
      success: false,
      message: 'Maoshni yangilashda xatolik'
    });
  }
});

app.post('/api/salaries/calculate', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { period_type, period_date } = req.body;
    const { userId, role } = req.session;

    if (!period_type || !period_date) {
      return res.status(400).json({
        success: false,
        message: 'Davr turi va sana kiritishingiz kerak'
      });
    }

    if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
      return res.status(400).json({
        success: false,
        message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
      });
    }

    const targetDate = new Date(period_date);
    const startDate = new Date(targetDate);
    const endDate = new Date(targetDate);

    if (period_type === 'monthly') {
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);
      endDate.setHours(23, 59, 59, 999);
    } else if (period_type === 'weekly') {
      const dayOfWeek = startDate.getDay();
      const diff = startDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      startDate.setDate(diff);
      startDate.setHours(0, 0, 0, 0);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    // Avval hodimlar ro'yxatini olamiz
    let employeesQuery = `
      SELECT e.id, e.full_name, e.position, e.admin_id
      FROM employees e
      WHERE 1=1
    `;
    const employeesParams = [];

    if (role !== 'super_admin') {
      employeesQuery += ` AND e.admin_id = $1`;
      employeesParams.push(userId);
    }

    employeesQuery += ` ORDER BY e.id`;

    const employeesResult = await pool.query(employeesQuery, employeesParams);
    const employeesRaw = employeesResult.rows;

    // Barcha ish haqqlarni bir marta olish (hodim va lavozim bo'yicha)
    // Barcha davr turlari uchun olamiz (keyin filtrlashda faqat belgilangan period_type ni ishlatamiz)
    let allRatesQuery = `
      SELECT 
        sr.employee_id,
        sr.position_name,
        sr.amount,
        sr.period_type,
        sr.admin_id
      FROM salary_rates sr
    `;
    const allRatesParams = [];

    // Super_admin barcha ish haqqlarni ko'radi
    // Admin uchun faqat o'z admin_id si bo'lgan yoki o'z hodimlariga tegishli ish haqqlarni JavaScript'da filtrlash qilamiz

    const allRatesResult = await pool.query(allRatesQuery, allRatesParams);

    // Admin uchun filtrlash (super_admin uchun filtrlash yo'q)
    let filteredRates = allRatesResult.rows;
    let adminPositions = new Set(); // Debug uchun e'lon qilamiz

    if (role !== 'super_admin') {
      // Admin faqat o'z ish haqqlarini yoki o'z hodimlariga tegishli ish haqqlarni ko'radi
      const adminEmployeeIds = new Set(employeesRaw.map(e => e.id));
      adminPositions = new Set(employeesRaw.map(e => e.position).filter(Boolean));

      filteredRates = allRatesResult.rows.filter(rate => {
        // Agar admin_id mos kelsa
        if (rate.admin_id === userId) {
          return true;
        }
        // Agar hodim bo'yicha ish haqqi bo'lsa va bu admin'ning hodimlaridan biri bo'lsa
        if (rate.employee_id && adminEmployeeIds.has(rate.employee_id)) {
          return true;
        }
        // Position bo'yicha ish haqqi barcha uchun qabul qilinadi (agar shu position'dagi hodim mavjud bo'lsa)
        // Shuning uchun position bo'yicha ish haqqlarni filtrlashdan o'tkazamiz
        if (rate.position_name && adminPositions.has(rate.position_name)) {
          return true;
        }
        return false;
      });
    }

    // Debug: barcha topilgan ish haqqlarni ko'rsatish
    console.log(`📊 Jami ${allRatesResult.rows.length} ta ish haqqi (filtrlashdan oldin)`);
    if (role !== 'super_admin') {
      console.log(`📊 Admin hodimlari position'lari: ${Array.from(adminPositions).join(', ') || 'Yo\'q'}`);
    }
    console.log(`📊 Filtrlashdan keyin ${filteredRates.length} ta ish haqqi (period_type: ${period_type}, role: ${role}, userId: ${userId}):`);
    filteredRates.forEach(rate => {
      if (rate.employee_id) {
        console.log(`  - Hodim ID ${rate.employee_id}: ${rate.amount} (admin_id: ${rate.admin_id})`);
      } else if (rate.position_name) {
        console.log(`  - Lavozim "${rate.position_name}": ${rate.amount} (admin_id: ${rate.admin_id})`);
      }
    });

    // Ish haqqlarni map qilish (hodim va lavozim bo'yicha alohida)
    // Key: employee_id yoki position_name, Value: {amount, period_type, admin_id}
    const employeeRatesMap = new Map(); // employee_id -> {amount, period_type, admin_id}
    const positionRatesMap = new Map(); // position_name -> {amount, period_type, admin_id}

    filteredRates.forEach(rate => {
      if (rate.employee_id) {
        // Hodim bo'yicha ish haqqi
        employeeRatesMap.set(rate.employee_id, {
          amount: rate.amount,
          period_type: rate.period_type,
          admin_id: rate.admin_id
        });
      } else if (rate.position_name) {
        // Lavozim bo'yicha ish haqqi
        // Bir xil lavozim nomi uchun bir nechta ish haqqi bo'lishi mumkin (har bir admin uchun)
        if (!positionRatesMap.has(rate.position_name)) {
          positionRatesMap.set(rate.position_name, []);
        }
        positionRatesMap.get(rate.position_name).push({
          amount: rate.amount,
          period_type: rate.period_type,
          admin_id: rate.admin_id
        });
      }
    });

    // Har bir hodim uchun ish haqqini topish
    // PRIORITET: 1) Hodim bo'yicha ish haqqi (avval shu davr, keyin daily), 2) Lavozim bo'yicha ish haqqi (avval shu davr, keyin daily)
    console.log(`\n🔍 ${employeesRaw.length} ta hodim uchun ish haqqi qidirilmoqda (davr: ${period_type}):\n`);

    const employees = employeesRaw.map(emp => {
      let rate = null;
      let rateSource = null;

      console.log(`\n📌 ${emp.full_name} (ID: ${emp.id}, Position: ${emp.position}, Admin ID: ${emp.admin_id}):`);

      // 1. AVVAL: Hodim bo'yicha ish haqqini qidirish (FAQAT shu davr turi)
      // Barcha hodim bo'yicha ish haqqlarni topish
      const allEmployeeRates = [];
      filteredRates.forEach(r => {
        if (r.employee_id === emp.id && r.period_type === period_type) {
          allEmployeeRates.push(r);
        }
      });

      if (allEmployeeRates.length > 0) {
        // Faqat shu davr turidagi ish haqqini qidiramiz
        const matchingRate = allEmployeeRates.find(r =>
          role === 'super_admin' || r.admin_id === emp.admin_id
        );

        if (matchingRate) {
          console.log(`   ✓ Hodim bo'yicha ish haqqi mavjud: ${matchingRate.amount} (period: ${matchingRate.period_type}, admin_id: ${matchingRate.admin_id})`);
          rate = {
            amount: matchingRate.amount,
            period_type: matchingRate.period_type,
            admin_id: matchingRate.admin_id
          };
          rateSource = 'employee';
          console.log(`   ✅ QABUL QILINDI - admin_id mos keladi: ${matchingRate.admin_id} === ${emp.admin_id}`);
        } else {
          console.log(`   ✗ Hodim bo'yicha ish haqqi mavjud, lekin admin_id mos kelmaydi`);
        }
      } else {
        console.log(`   ✗ Hodim bo'yicha ish haqqi topilmadi (davr: ${period_type})`);
      }

      // 2. KEYIN: Agar hodim bo'yicha ish haqqi topilmasa, lavozim bo'yicha qidirish
      if (!rate && emp.position) {
        const allPositionRates = [];
        filteredRates.forEach(r => {
          if (r.position_name === emp.position && r.period_type === period_type) {
            allPositionRates.push(r);
          }
        });

        if (allPositionRates.length > 0) {
          console.log(`   ✓ Lavozim bo'yicha ${allPositionRates.length} ta ish haqqi mavjud:`);
          allPositionRates.forEach(pr => {
            console.log(`     - ${pr.amount} (period: ${pr.period_type}, admin_id: ${pr.admin_id})`);
          });

          // Faqat shu davr turidagi ish haqqini qidiramiz
          // Position bo'yicha ish haqqi barcha uchun qabul qilinadi (agar shu position'dagi hodim mavjud bo'lsa)
          // Birinchi ish haqqini qabul qilamiz (agar bir nechta bo'lsa, birinchisini)
          if (allPositionRates.length > 0) {
            const matchingPositionRate = allPositionRates[0]; // Birinchi ish haqqini qabul qilamiz
            rate = {
              amount: matchingPositionRate.amount,
              period_type: matchingPositionRate.period_type,
              admin_id: matchingPositionRate.admin_id
            };
            rateSource = 'position';
            console.log(`   ✅ QABUL QILINDI - Lavozim bo'yicha ish haqqi (${matchingPositionRate.amount}, period: ${matchingPositionRate.period_type})`);
          } else {
            console.log(`   ❌ RAD ETILDI - Position bo'yicha ish haqqi topilmadi`);
          }
        } else {
          console.log(`   ✗ Lavozim bo'yicha ish haqqi topilmadi (lavozim: "${emp.position}", davr: ${period_type})`);
        }
      }

      if (!rate) {
        console.log(`   ❌ NATIJA: Ish haqqi topilmadi!`);
      } else {
        console.log(`   ✅ NATIJA: ${rate.amount} so'm (${rateSource === 'employee' ? 'Hodim' : 'Lavozim'} bo'yicha, period: ${rate.period_type})`);
      }

      return {
        ...emp,
        amount: rate ? rate.amount : null,
        period_type: rate ? rate.period_type : null,
        rate_source: rateSource // 'employee' yoki 'position' yoki null
      };
    });

    // Faqat ish haqqi topilgan hodimlarni hisoblaymiz (faqat shu period_type uchun)
    const employeesWithRates = employees.filter(emp => emp.amount !== null);

    console.log(`\n💰 ${employeesWithRates.length} ta hodim uchun ${period_type} maosh hisoblanadi (${employeesRaw.length - employeesWithRates.length} ta hodim uchun ish haqqi topilmadi):\n`);

    // Helper function to calculate work minutes for a day
    function calculateDayWorkMinutes(dateStr, entries, exits, nextDayExits, scheduleMap, dailyWorkMinutes) {
      if (entries.length === 0) {
        // Entry yo'q bo'lsa hisoblamaymiz
        return;
      }

      // dateStr format: YYYY-MM-DD
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const jsDayOfWeek = date.getDay();
      const dayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
      const schedule = scheduleMap.get(dayOfWeek);

      if (!schedule) {
        console.log(`   ⚠️ ${dateStr}: Work schedule yo'q (day_of_week: ${dayOfWeek})`);
        return;
      }

      let dayMinutes = 0;

      // Entry va exit larni juftlash (vaqt bo'yicha tartiblash)
      entries.sort((a, b) => a - b);
      exits.sort((a, b) => a - b);
      if (nextDayExits) {
        nextDayExits.sort((a, b) => a - b);
      }

      const [scheduleStartHours, scheduleStartMins] = schedule.start_time.split(':').map(Number);
      const [scheduleEndHours, scheduleEndMins] = schedule.end_time.split(':').map(Number);
      const scheduleStartMinsTotal = scheduleStartHours * 60 + scheduleStartMins;
      const scheduleEndMinsTotal = scheduleEndHours * 60 + scheduleEndMins;

      // Kechasi ishlash holatini aniqlash
      const isOvernightShift = scheduleEndMinsTotal < scheduleStartMinsTotal;
      let expectedMins;
      let scheduleEndMinsTotalAdjusted = scheduleEndMinsTotal;

      if (isOvernightShift) {
        // Kechasi ishlash: end_time keyingi kunga o'tadi
        scheduleEndMinsTotalAdjusted = scheduleEndMinsTotal + 1440; // 24 soat = 1440 minut
        expectedMins = scheduleEndMinsTotalAdjusted - scheduleStartMinsTotal;
        console.log(`     🌙 Kechasi ishlash: ${schedule.start_time} - ${schedule.end_time} (keyingi kunga o'tadi)`);
      } else {
        expectedMins = scheduleEndMinsTotal - scheduleStartMinsTotal;
      }

      // Har bir entry uchun eng yaqin exit ni topish
      for (let i = 0; i < entries.length; i++) {
        const entryTime = entries[i];
        const entryMinsTotal = entryTime.getHours() * 60 + entryTime.getMinutes();

        let matchingExit = null;
        let matchingExitIndex = -1;
        let foundInNextDay = false;

        if (isOvernightShift) {
          // Kechasi ishlash: asosan keyingi kundan exit qidiramiz
          // Lekin agar entry erta bo'lsa va exit shu kunning o'zida kechroq bo'lsa (masalan 00:00 dan 04:00 gacha ish vaqti, entry 01:00, exit 03:00)

          // 1. Keyingi kundan qidirish (prioritet)
          if (nextDayExits && nextDayExits.length > 0) {
            for (let j = 0; j < nextDayExits.length; j++) {
              const exitTime = nextDayExits[j];
              // Exit entry dan keyin bo'lishi aniq (chunki keyingi kun)
              // Lekin juda uzoq bo'lmasligi kerak (masalan, 16 soatdan oshib ketmasligi kerak)
              const diffMs = exitTime - entryTime;
              const diffHours = diffMs / (1000 * 60 * 60);

              if (diffHours < 24) { // 24 soat ichida
                matchingExit = exitTime;
                matchingExitIndex = j;
                foundInNextDay = true;
                break;
              }
            }
          }

          // 2. Agar keyingi kundan topilmasa, shu kundan qidirib ko'ramiz (ehtimol kechikib kelgan va shu kuni chiqqan)
          if (!matchingExit) {
            for (let j = 0; j < exits.length; j++) {
              const exitTime = exits[j];
              if (exitTime > entryTime) {
                matchingExit = exitTime;
                matchingExitIndex = j;
                break;
              }
            }
          }
        } else {
          // Oddiy ishlash: shu kundan exit qidiramiz
          for (let j = 0; j < exits.length; j++) {
            const exitTime = exits[j];
            if (exitTime > entryTime) {
              matchingExit = exitTime;
              matchingExitIndex = j;
              break;
            }
          }

          // Agar shu kundan topilmasa va exit vaqti yarim tunda yaqin bo'lsa, keyingi kunga o'tib qolgan bo'lishi mumkin
          // Masalan, 09:00-18:00 ish, lekin 18:05 da chiqdi (bu shu kun)
          // Yoki 23:00 gacha ishlab, 00:10 da chiqdi (bu keyingi kun)
          if (!matchingExit && nextDayExits && nextDayExits.length > 0) {
            // Faqat agar expected end time yarim tunga yaqin bo'lsa (masalan 20:00 dan keyin)
            if (scheduleEndHours >= 20) {
              for (let j = 0; j < nextDayExits.length; j++) {
                const exitTime = nextDayExits[j];
                // Agar exit ertalab (soat 6 gacha) bo'lsa, bu oldingi kungi shiftniki bo'lishi mumkin
                if (exitTime.getHours() < 6) {
                  matchingExit = exitTime;
                  matchingExitIndex = j;
                  foundInNextDay = true;
                  break;
                }
              }
            }
          }
        }

        if (matchingExit) {
          // Entry va exit bor
          const diffMs = matchingExit - entryTime;
          const diffMinutes = Math.floor(diffMs / (1000 * 60));

          console.log(`     ✓ Entry: ${entryTime.toLocaleTimeString('uz-UZ')}, Exit: ${matchingExit.toLocaleTimeString('uz-UZ')}, Diff: ${diffMinutes} minut`);

          // Expected vaqt bilan taqqoslash
          // Kechasi ishlashda expected time 24 soatdan oshishi mumkin emas
          let minutesToAdd = diffMinutes;

          // Agar farq juda katta bo'lsa (masalan 24 soatdan ko'p), xatolik bo'lishi mumkin, shuning uchun expected ga cheklaymiz
          if (minutesToAdd > expectedMins * 1.5) { // 1.5 barobar ko'p bo'lsa
            minutesToAdd = expectedMins;
          }

          // Expected vaqtdan oshmasligi kerak (ixtiyoriy, lekin tartib uchun yaxshi)
          // User talabi: "belgilangan vaqtda ish vaqti hisoblansin" - ortiqcha ishlagan vaqt hisoblanmaydi
          minutesToAdd = Math.min(minutesToAdd, expectedMins);

          dayMinutes += minutesToAdd;

          // Exit ni ro'yxatdan olib tashlash
          if (foundInNextDay) {
            if (nextDayExits) nextDayExits.splice(matchingExitIndex, 1);
          } else {
            exits.splice(matchingExitIndex, 1);
          }
        } else {
          // Exit yo'q
          console.log(`     ⚠️ Entry: ${entryTime.toLocaleTimeString('uz-UZ')}, Exit yo'q`);

          // Exit yo'q bo'lsa, qanday hisoblash kerak?
          // Hozircha expected end time gacha hisoblaymiz, lekin bu aniq emas
          // Yaxshisi, exit yo'q bo'lsa hisoblamaymiz yoki faqat entry vaqtidan ish vaqti tugaguncha hisoblaymiz

          let minutesUntilEnd;

          if (isOvernightShift) {
            // Kechasi ishlash: entry dan ish vaqti tugaguncha (keyingi kun ertalab)
            // Entry: 16:00 (960 min), End: 02:00 (1560 min) -> 600 min
            minutesUntilEnd = scheduleEndMinsTotalAdjusted - entryMinsTotal;
          } else {
            // Oddiy: entry dan ish vaqti tugaguncha
            if (entryMinsTotal < scheduleEndMinsTotal) {
              minutesUntilEnd = scheduleEndMinsTotal - entryMinsTotal;
            } else {
              minutesUntilEnd = 0; // Ish vaqtidan keyin kelgan
            }
          }

          if (minutesUntilEnd > 0) {
            console.log(`     ⚠️ Exit yo'q - ish vaqti tugaguncha hisoblandi: ${minutesUntilEnd} minut`);
            dayMinutes += Math.min(minutesUntilEnd, expectedMins); // Expected dan oshmasin
          }
        }
      }

      console.log(`     📊 Jami: ${dayMinutes} minut (${Math.floor(dayMinutes / 60)}s ${dayMinutes % 60}d)`);

      if (dayMinutes > 0) {
        dailyWorkMinutes.set(dateStr, dayMinutes);
      }
    }

    let calculatedCount = 0;
    const errors = [];

    for (const emp of employeesWithRates) {

      // Log qilish (debug uchun) - qaysi ish haqqi ishlatilayotganini ko'rsatish
      if (emp.rate_source === 'employee') {
        console.log(`✅ ${emp.full_name}: Hodim bo'yicha ish haqqi ishlatilmoqda (${emp.amount})`);
      } else if (emp.rate_source === 'position') {
        console.log(`✅ ${emp.full_name}: Lavozim bo'yicha ish haqqi ishlatilmoqda (${emp.position} - ${emp.amount})`);
      }

      try {
        // Kunlik o'zgarishlarni olish (lavozim o'zgarishlari)
        const dailyChangesQuery = `
          SELECT change_date, new_position, old_position
          FROM daily_changes
          WHERE employee_id = $1
            AND change_type = 'position_change'
            AND change_date >= $2
            AND change_date <= $3
          ORDER BY change_date ASC
        `;
        const dailyChangesResult = await pool.query(dailyChangesQuery, [
          emp.id,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        ]);

        // Kunlik o'zgarishlarni Map ga o'zlashtirish (date -> new_position)
        const dailyPositionChanges = new Map();
        dailyChangesResult.rows.forEach(change => {
          const changeDateStr = change.change_date.toISOString().split('T')[0];
          if (change.new_position) {
            dailyPositionChanges.set(changeDateStr, change.new_position);
          }
        });

        // Work schedule ni olish
        const scheduleQuery = `
          SELECT day_of_week, start_time, end_time
          FROM work_schedules
          WHERE employee_id = $1 AND is_active = true
        `;
        const scheduleResult = await pool.query(scheduleQuery, [emp.id]);
        const scheduleMap = new Map();
        scheduleResult.rows.forEach(row => {
          scheduleMap.set(row.day_of_week, {
            start_time: row.start_time,
            end_time: row.end_time
          });
        });

        if (scheduleMap.size === 0) {
          const errorMsg = `${emp.full_name} uchun ish jadvali belgilanmagan`;
          errors.push(errorMsg);
          console.log(`   ❌ ${errorMsg}`);
          continue;
        }

        console.log(`   ✅ ${emp.full_name}: Ish jadvali mavjud (${scheduleMap.size} kun)`);

        // Attendance logs ni kun bo'yicha guruhlash
        const attendanceQuery = `
          SELECT 
            DATE(al.event_time AT TIME ZONE 'Asia/Tashkent') as work_date,
            al.event_time,
            al.event_type
          FROM attendance_logs al
          WHERE al.employee_id = $1
            AND al.event_time >= $2
            AND al.event_time <= $3
            AND (al.event_type = 'entry' OR al.event_type = 'exit')
          ORDER BY al.event_time ASC
        `;

        // Query muddatini 1 kunga uzaytiramiz (kechasi ishlash holatlari uchun)
        const queryEndDate = new Date(endDate);
        queryEndDate.setDate(queryEndDate.getDate() + 1);

        const attendanceResult = await pool.query(attendanceQuery, [
          emp.id,
          startDate,
          queryEndDate
        ]);

        console.log(`   📊 ${emp.full_name}: ${attendanceResult.rows.length} ta attendance event topildi (${startDate.toISOString().split('T')[0]} - ${queryEndDate.toISOString().split('T')[0]})`);

        // Har bir kundagi ishlagan vaqtni minutlarda hisoblash
        const dailyWorkMinutes = new Map(); // date -> totalMinutes

        // Eventlarni kun bo'yicha guruhlash
        const eventsByDate = new Map();

        attendanceResult.rows.forEach(row => {
          const eventDate = new Date(row.event_time);
          const dateStr = eventDate.toISOString().split('T')[0];

          if (!eventsByDate.has(dateStr)) {
            eventsByDate.set(dateStr, { entries: [], exits: [] });
          }

          if (row.event_type === 'entry') {
            eventsByDate.get(dateStr).entries.push(new Date(row.event_time));
          } else if (row.event_type === 'exit') {
            eventsByDate.get(dateStr).exits.push(new Date(row.event_time));
          }
        });

        // Har bir kun uchun hisoblash
        const loopDate = new Date(startDate);
        // LoopDate endDate dan kichik yoki teng bo'lishi kerak (vaqtni hisobga olmasdan)
        const loopEndDateStr = endDate.toISOString().split('T')[0];

        while (loopDate.toISOString().split('T')[0] <= loopEndDateStr) {
          const dateStr = loopDate.toISOString().split('T')[0];

          // Keyingi kun sanasini olish
          const nextDay = new Date(loopDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];

          const dailyEvents = eventsByDate.get(dateStr) || { entries: [], exits: [] };
          const nextDayEvents = eventsByDate.get(nextDayStr) || { entries: [], exits: [] };

          // Debug
          if (dailyEvents.entries.length > 0) {
            console.log(`   📅 ${dateStr} uchun hisoblash: ${dailyEvents.entries.length} entries, ${dailyEvents.exits.length} exits, Next day exits: ${nextDayEvents.exits.length}`);
          }

          calculateDayWorkMinutes(
            dateStr,
            dailyEvents.entries,
            dailyEvents.exits,
            nextDayEvents.exits,
            scheduleMap,
            dailyWorkMinutes
          );

          loopDate.setDate(loopDate.getDate() + 1);
        }

        // Jami ishlagan minutlarni hisoblash
        let totalWorkMinutes = 0;
        let workDays = 0;

        dailyWorkMinutes.forEach((minutes, date) => {
          if (minutes > 0) {
            totalWorkMinutes += minutes;
            workDays++;
          }
        });

        // Debug: ishlagan vaqtni ko'rsatish
        console.log(`   📊 ${emp.full_name}: Jami ishlagan vaqt: ${totalWorkMinutes} minut (${workDays} kun)`);
        console.log(`   📊 ${emp.full_name}: Daily work minutes:`, Array.from(dailyWorkMinutes.entries()).map(([date, mins]) => `${date}: ${mins} minut`).join(', '));

        // Agar ish haqqi topilgan bo'lsa, lekin ishlagan vaqt yo'q bo'lsa ham maosh yaratamiz (0 so'm bilan)
        // Lekin xatolik sifatida ko'rsatmaymiz
        if (totalWorkMinutes === 0) {
          console.log(`   ⚠️ ${emp.full_name}: Ish haqqi topilgan (${emp.amount}), lekin ishlagan vaqt yo'q - 0 so'm bilan maosh yaratiladi`);
          // 0 so'm bilan maosh yaratamiz
          totalWorkMinutes = 0;
          workDays = 0;
        }

        // Ish haqqini minutlarda hisoblash
        let calculatedAmount = 0;

        // Expected ish vaqtini minutlarda hisoblash (Ish Jadvali ko'rsatgichlaridan)
        // Faqat Ish Jadvalida belgilangan ish kunlari va vaqtlari hisobga olinadi
        let expectedTotalMinutes = 0;
        let expectedWorkDays = 0; // Ish Jadvalida belgilangan ish kunlari soni

        // Kunlik o'zgarishlarni tekshirish (kunlik maosh uchun)
        let actualPosition = emp.position;
        let actualRateAmount = emp.amount;
        let actualRateSource = emp.rate_source;

        if (period_type === 'daily') {
          // Agar shu kun uchun lavozim o'zgarishi bo'lsa, yangi lavozim bo'yicha ish haqqi ishlatamiz
          const changeDateStr = period_date;
          if (dailyPositionChanges.has(changeDateStr)) {
            const newPosition = dailyPositionChanges.get(changeDateStr);
            actualPosition = newPosition;

            // Yangi lavozim bo'yicha ish haqqini qidirish
            const newPositionRate = filteredRates.find(r =>
              r.position_name === newPosition && r.period_type === period_type
            );

            if (newPositionRate) {
              actualRateAmount = newPositionRate.amount;
              actualRateSource = 'position';
              console.log(`   🔄 ${emp.full_name}: Kunlik o'zgarish - ${changeDateStr} kunida lavozim "${emp.position}" dan "${newPosition}" ga o'zgargan, yangi ish haqqi: ${actualRateAmount}`);
            }
          }

          // Kunlik: faqat shu kunni hisoblaymiz (Ish Jadvali bo'yicha)
          const dayOfWeek = targetDate.getDay();
          const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
          const schedule = scheduleMap.get(dayOfWeekPG);
          if (schedule) {
            const [startHours, startMins] = schedule.start_time.split(':').map(Number);
            const [endHours, endMins] = schedule.end_time.split(':').map(Number);
            const startMinsTotal = startHours * 60 + startMins;
            const endMinsTotal = endHours * 60 + endMins;

            // Kechasi ishlash: agar end_time < start_time bo'lsa, keyingi kunga o'tadi
            if (endMinsTotal < startMinsTotal) {
              expectedTotalMinutes = (endMinsTotal + 1440) - startMinsTotal; // 24 soat qo'shamiz
              console.log(`   📅 ${emp.full_name}: Kunlik expected vaqt (Ish Jadvali, kechasi): ${expectedTotalMinutes} minut (${startHours}:${String(startMins).padStart(2, '0')} - ${endHours}:${String(endMins).padStart(2, '0')} keyingi kunga)`);
            } else {
              expectedTotalMinutes = endMinsTotal - startMinsTotal;
              console.log(`   📅 ${emp.full_name}: Kunlik expected vaqt (Ish Jadvali): ${expectedTotalMinutes} minut (${startHours}:${String(startMins).padStart(2, '0')} - ${endHours}:${String(endMins).padStart(2, '0')})`);
            }
            expectedWorkDays = 1; // Kunlik uchun 1 kun
          }
        } else if (period_type === 'weekly') {
          // Haftalik: hafta ichidagi barcha ish kunlarini hisoblaymiz (Ish Jadvali bo'yicha)
          const weekStart = new Date(startDate);
          for (let d = 0; d < 7; d++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(weekStart.getDate() + d);
            const dayOfWeek = currentDate.getDay();
            const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
            const schedule = scheduleMap.get(dayOfWeekPG);
            if (schedule) {
              const [startHours, startMins] = schedule.start_time.split(':').map(Number);
              const [endHours, endMins] = schedule.end_time.split(':').map(Number);
              const startMinsTotal = startHours * 60 + startMins;
              const endMinsTotal = endHours * 60 + endMins;

              // Kechasi ishlash: agar end_time < start_time bo'lsa, keyingi kunga o'tadi
              let dayExpectedMinutes;
              if (endMinsTotal < startMinsTotal) {
                dayExpectedMinutes = (endMinsTotal + 1440) - startMinsTotal; // 24 soat qo'shamiz
                console.log(`   📅 ${emp.full_name}: Haftalik ${dayOfWeekPG}-kun (Ish Jadvali, kechasi): ${dayExpectedMinutes} minut (${startHours}:${String(startMins).padStart(2, '0')} - ${endHours}:${String(endMins).padStart(2, '0')} keyingi kunga)`);
              } else {
                dayExpectedMinutes = endMinsTotal - startMinsTotal;
                console.log(`   📅 ${emp.full_name}: Haftalik ${dayOfWeekPG}-kun (Ish Jadvali): ${dayExpectedMinutes} minut`);
              }
              expectedTotalMinutes += dayExpectedMinutes;
              expectedWorkDays++;
            }
          }
          console.log(`   📊 ${emp.full_name}: Haftalik jami expected vaqt (Ish Jadvali): ${expectedTotalMinutes} minut (${expectedWorkDays} ish kuni)`);
        } else if (period_type === 'monthly') {
          // Oylik: oy ichidagi barcha ish kunlarini hisoblaymiz (Ish Jadvali bo'yicha)
          const monthStart = new Date(startDate);
          const monthEnd = new Date(endDate);
          for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay();
            const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
            const schedule = scheduleMap.get(dayOfWeekPG);
            if (schedule) {
              const [startHours, startMins] = schedule.start_time.split(':').map(Number);
              const [endHours, endMins] = schedule.end_time.split(':').map(Number);
              const startMinsTotal = startHours * 60 + startMins;
              const endMinsTotal = endHours * 60 + endMins;

              // Kechasi ishlash: agar end_time < start_time bo'lsa, keyingi kunga o'tadi
              let dayExpectedMinutes;
              if (endMinsTotal < startMinsTotal) {
                dayExpectedMinutes = (endMinsTotal + 1440) - startMinsTotal; // 24 soat qo'shamiz
              } else {
                dayExpectedMinutes = endMinsTotal - startMinsTotal;
              }
              expectedTotalMinutes += dayExpectedMinutes;
              expectedWorkDays++;
            }
          }
          console.log(`   📊 ${emp.full_name}: Oylik jami expected vaqt (Ish Jadvali): ${expectedTotalMinutes} minut (${expectedWorkDays} ish kuni)`);
        }

        // Ish haqqini minutlarda hisoblash (kunlik o'zgarishni hisobga olgan holda)
        if (totalWorkMinutes === 0) {
          // Agar ishlagan vaqt yo'q bo'lsa, 0 so'm
          calculatedAmount = 0;
          console.log(`   ⚠️ ${emp.full_name}: Ish haqqi topilgan (${actualRateAmount}), lekin ishlagan vaqt yo'q - 0 so'm bilan maosh yaratiladi`);
        } else if (period_type === 'daily') {
          // Kunlik maosh: o'sha kun uchun ish haqqi
          if (expectedTotalMinutes > 0) {
            const ratePerMinute = actualRateAmount / expectedTotalMinutes;
            calculatedAmount = ratePerMinute * totalWorkMinutes;
            console.log(`   💰 ${emp.full_name}: Kunlik maosh hisoblandi: ${actualRateAmount} / ${expectedTotalMinutes} * ${totalWorkMinutes} = ${calculatedAmount} so'm`);
          } else {
            calculatedAmount = actualRateAmount;
            console.log(`   💰 ${emp.full_name}: Kunlik maosh (expected vaqt yo'q): ${actualRateAmount} so'm`);
          }
        } else {
          // Haftalik va oylik: har bir kun uchun alohida hisoblash (kunlik o'zgarishlarni hisobga olgan holda)
          calculatedAmount = 0;

          // Har bir kun uchun ish haqqini hisoblash
          dailyWorkMinutes.forEach((dayMinutes, dateStr) => {
            if (dayMinutes > 0) {
              // Bu kun uchun lavozimni aniqlash
              let dayPosition = emp.position;
              let dayRateAmount = emp.amount;

              // Kunlik o'zgarishni tekshirish
              if (dailyPositionChanges.has(dateStr)) {
                const newPosition = dailyPositionChanges.get(dateStr);
                dayPosition = newPosition;

                // Yangi lavozim bo'yicha ish haqqini qidirish
                // Har bir kun uchun kunlik ish haqqi ishlatiladi
                let newPositionRate = filteredRates.find(r =>
                  r.position_name === newPosition && r.period_type === 'daily'
                );

                // Agar kunlik topilmasa, shu davr turidagi ish haqqini qidiramiz va uni kunlik ga konvertatsiya qilamiz
                if (!newPositionRate) {
                  newPositionRate = filteredRates.find(r =>
                    r.position_name === newPosition && r.period_type === period_type
                  );

                  if (newPositionRate) {
                    // Haftalik/oylik ish haqqini kunlik ga konvertatsiya qilamiz (Ish Jadvali ko'rsatgichlaridan foydalangan holda)
                    if (period_type === 'weekly') {
                      // Haftalik ish haqqini Ish Jadvalidagi ish kunlari soniga bo'lamiz
                      // Hafta ichidagi ish kunlarini hisoblash (Ish Jadvali bo'yicha)
                      let weeklyWorkDays = 0;
                      const weekStart = new Date(startDate);
                      for (let d = 0; d < 7; d++) {
                        const currentDate = new Date(weekStart);
                        currentDate.setDate(weekStart.getDate() + d);
                        const dayOfWeek = currentDate.getDay();
                        const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
                        if (scheduleMap.has(dayOfWeekPG)) {
                          weeklyWorkDays++;
                        }
                      }
                      dayRateAmount = weeklyWorkDays > 0 ? newPositionRate.amount / weeklyWorkDays : newPositionRate.amount / 5; // Fallback: 5 ish kuni
                      console.log(`   📊 ${emp.full_name}: Haftalik ish haqqi kunlik ga konvertatsiya (Ish Jadvali): ${newPositionRate.amount} / ${weeklyWorkDays} = ${dayRateAmount}`);
                    } else if (period_type === 'monthly') {
                      // Oylik ish haqqini oydagi ish kunlariga bo'lamiz (Ish Jadvali bo'yicha)
                      const [dateYear, dateMonth] = dateStr.split('-').map(Number);
                      const monthStartDate = new Date(dateYear, dateMonth - 1, 1);
                      const monthEndDate = new Date(dateYear, dateMonth, 0);
                      let workDaysInMonth = 0;
                      for (let d = new Date(monthStartDate); d <= monthEndDate; d.setDate(d.getDate() + 1)) {
                        const dayOfWeek = d.getDay();
                        const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
                        if (scheduleMap.has(dayOfWeekPG)) {
                          workDaysInMonth++;
                        }
                      }
                      dayRateAmount = workDaysInMonth > 0 ? newPositionRate.amount / workDaysInMonth : newPositionRate.amount / 22; // Fallback: 22 ish kuni
                      console.log(`   📊 ${emp.full_name}: Oylik ish haqqi kunlik ga konvertatsiya (Ish Jadvali): ${newPositionRate.amount} / ${workDaysInMonth} = ${dayRateAmount}`);
                    } else {
                      dayRateAmount = newPositionRate.amount;
                    }
                  }
                } else {
                  // Kunlik ish haqqi topildi
                  dayRateAmount = newPositionRate.amount;
                }

                if (newPositionRate) {
                  console.log(`   🔄 ${emp.full_name}: ${dateStr} - lavozim "${emp.position}" dan "${newPosition}" ga o'zgargan, kunlik ish haqqi: ${dayRateAmount}`);
                }
              }

              // Bu kun uchun expected minutlarni hisoblash
              const [year, month, day] = dateStr.split('-').map(Number);
              const dateObj = new Date(year, month - 1, day);
              const dayOfWeek = dateObj.getDay();
              const dayOfWeekPG = dayOfWeek === 0 ? 7 : dayOfWeek;
              const schedule = scheduleMap.get(dayOfWeekPG);

              if (schedule) {
                const [startHours, startMins] = schedule.start_time.split(':').map(Number);
                const [endHours, endMins] = schedule.end_time.split(':').map(Number);
                const startMinsTotal = startHours * 60 + startMins;
                const endMinsTotal = endHours * 60 + endMins;

                // Kechasi ishlash: agar end_time < start_time bo'lsa, keyingi kunga o'tadi
                let expectedDayMinutes;
                if (endMinsTotal < startMinsTotal) {
                  expectedDayMinutes = (endMinsTotal + 1440) - startMinsTotal; // 24 soat qo'shamiz
                } else {
                  expectedDayMinutes = endMinsTotal - startMinsTotal;
                }

                if (expectedDayMinutes > 0) {
                  // Har bir kun uchun alohida hisoblash: o'sha kunning ish haqqi / o'sha kunning expected vaqti * o'sha kunning ishlagan vaqti
                  const ratePerMinute = dayRateAmount / expectedDayMinutes;
                  calculatedAmount += ratePerMinute * dayMinutes;
                  console.log(`   💰 ${emp.full_name}: ${dateStr} - ${dayRateAmount} / ${expectedDayMinutes} * ${dayMinutes} = ${ratePerMinute * dayMinutes} so'm`);
                } else {
                  // Agar expected vaqt yo'q bo'lsa (bu kamdan-kam holat, chunki schedule bo'lishi kerak)
                  // dayRateAmount allaqachon kunlik ish haqqi bo'lgani uchun, uni to'g'ridan-to'g'ri qo'shamiz
                  // Lekin faqat ishlagan vaqt bo'lsa
                  if (dayMinutes > 0) {
                    // Agar ishlagan vaqt bo'lsa, lekin expected vaqt yo'q bo'lsa, kunlik ish haqqini qo'shamiz
                    calculatedAmount += dayRateAmount;
                    console.log(`   💰 ${emp.full_name}: ${dateStr} - expected vaqt yo'q, kunlik ish haqqi: ${dayRateAmount} so'm`);
                  }
                }
              } else {
                // Schedule yo'q bo'lsa, kunlik ish haqqini to'g'ridan-to'g'ri qo'shamiz
                if (dayMinutes > 0) {
                  calculatedAmount += dayRateAmount;
                  console.log(`   ⚠️ ${emp.full_name}: ${dateStr} - schedule yo'q, kunlik ish haqqi: ${dayRateAmount} so'm`);
                }
              }
            }
          });

          // Agar kunlik o'zgarishlar bo'lmasa, Ish Jadvali ko'rsatgichlaridan foydalanamiz
          if (dailyPositionChanges.size === 0) {
            if (expectedTotalMinutes > 0) {
              // Ish Jadvali bo'yicha expected vaqt mavjud bo'lsa, unga asoslanib hisoblaymiz
              const ratePerMinute = actualRateAmount / expectedTotalMinutes;
              calculatedAmount = ratePerMinute * totalWorkMinutes;
              console.log(`   💰 ${emp.full_name}: Ish haqqi hisoblandi (Ish Jadvali bo'yicha): ${actualRateAmount} / ${expectedTotalMinutes} * ${totalWorkMinutes} = ${calculatedAmount}`);
            } else {
              // Expected vaqt yo'q bo'lsa (Ish Jadvali bo'lmagan kunlar), ish kunlariga bo'lamiz
              // Lekin bu holat kamdan-kam bo'ladi, chunki Ish Jadvali bo'lishi kerak
              if (period_type === 'weekly') {
                // Haftalik: Ish Jadvalidagi ish kunlari soniga bo'lamiz
                if (expectedWorkDays > 0) {
                  calculatedAmount = (actualRateAmount / expectedWorkDays) * workDays;
                  console.log(`   💰 ${emp.full_name}: Haftalik ish haqqi (Ish Jadvali bo'yicha): ${actualRateAmount} / ${expectedWorkDays} * ${workDays} = ${calculatedAmount}`);
                } else {
                  // Fallback: 5 ish kuni
                  calculatedAmount = (actualRateAmount / 5) * workDays;
                }
              } else if (period_type === 'monthly') {
                // Oylik: Ish Jadvalidagi ish kunlari soniga bo'lamiz
                if (expectedWorkDays > 0) {
                  calculatedAmount = (actualRateAmount / expectedWorkDays) * workDays;
                  console.log(`   💰 ${emp.full_name}: Oylik ish haqqi (Ish Jadvali bo'yicha): ${actualRateAmount} / ${expectedWorkDays} * ${workDays} = ${calculatedAmount}`);
                } else {
                  // Fallback: oydagi ish kunlariga bo'lamiz
                  const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
                  const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
                  let workDaysInMonth = 0;
                  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
                    const dayOfWeek = d.getDay();
                    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                      workDaysInMonth++;
                    }
                  }
                  calculatedAmount = workDaysInMonth > 0 ? (actualRateAmount / workDaysInMonth) * workDays : (actualRateAmount / 22) * workDays;
                }
              }
            }
          }
        }

        // Round to 2 decimal places
        calculatedAmount = Math.round(calculatedAmount * 100) / 100;

        // Format notes - ish haqqi manbasini ham qo'shamiz (Ish Jadvali ko'rsatgichlari bilan)
        const totalHours = Math.floor(totalWorkMinutes / 60);
        const totalMins = totalWorkMinutes % 60;
        const expectedHours = Math.floor(expectedTotalMinutes / 60);
        const expectedMins = expectedTotalMinutes % 60;
        const rateSourceText = actualRateSource === 'employee' ? 'Hodim bo\'yicha' : actualRateSource === 'position' ? 'Lavozim bo\'yicha' : '';
        let notes = `${rateSourceText ? rateSourceText + ' | ' : ''}Ishlagan: ${workDays} kun, ${totalHours}s ${totalMins}d (${totalWorkMinutes} minut)`;
        if (expectedTotalMinutes > 0) {
          notes += ` | Kutilgan (Ish Jadvali): ${expectedWorkDays} kun, ${expectedHours}s ${expectedMins}d (${expectedTotalMinutes} minut)`;
        }

        // Agar kunlik o'zgarish bo'lsa, notes ga qo'shamiz
        if (period_type === 'daily' && dailyPositionChanges.has(period_date)) {
          const oldPos = emp.position;
          const newPos = dailyPositionChanges.get(period_date);
          notes += ` | Lavozim o'zgardi: ${oldPos} → ${newPos}`;
        }

        // work_position ni aniqlash: kunlik o'zgarish bo'lsa, yangi lavozimni yozamiz
        const workPosition = (period_type === 'daily' && dailyPositionChanges.has(period_date))
          ? dailyPositionChanges.get(period_date)
          : (actualRateSource === 'position' ? actualPosition : (emp.position || null));

        const checkExisting = await pool.query(
          'SELECT id FROM salaries WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
          [emp.id, period_type, period_date]
        );

        if (checkExisting.rows.length > 0) {
          await pool.query(
            'UPDATE salaries SET amount = $1, notes = $2, work_position = $3 WHERE id = $4',
            [calculatedAmount, notes, workPosition, checkExisting.rows[0].id]
          );
          console.log(`   💾 Maosh yangilandi: ${emp.full_name} - ${calculatedAmount} so'm (${period_type})`);
        } else {
          await pool.query(
            `INSERT INTO salaries (employee_id, amount, period_type, period_date, work_position, notes, admin_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              emp.id,
              calculatedAmount,
              period_type,
              period_date,
              workPosition,
              notes,
              emp.admin_id,
              userId
            ]
          );
          console.log(`   💾 Maosh yaratildi: ${emp.full_name} - ${calculatedAmount} so'm (${period_type}, ${emp.rate_source === 'position' ? 'Lavozim' : 'Hodim'} bo'yicha)`);
        }

        calculatedCount++;

        // ========== JARIMA HISOBLASH (Kech qolganlar uchun) ==========
        try {
          await calculatePenalties(emp, period_type, period_date, startDate, endDate, scheduleMap, attendanceResult.rows, userId, role);
        } catch (penaltyError) {
          console.error(`Error calculating penalties for employee ${emp.id}:`, penaltyError);
        }

        // ========== KPI HISOBLASH (Yaxshi ishlaganlar uchun) ==========
        try {
          await calculateKPI(emp, period_type, period_date, startDate, endDate, scheduleMap, dailyWorkMinutes, totalWorkMinutes, expectedTotalMinutes, userId, role);
        } catch (kpiError) {
          console.error(`Error calculating KPI for employee ${emp.id}:`, kpiError);
        }

      } catch (error) {
        console.error(`Error calculating salary for employee ${emp.id}:`, error);
        errors.push(`${emp.full_name} uchun maosh hisoblashda xatolik: ${error.message}`);
      }
    }

    // Batafsil natijalar
    const summary = {
      totalEmployees: employeesRaw.length,
      employeesWithRates: employeesWithRates.length,
      employeesWithoutRates: employeesRaw.length - employeesWithRates.length,
      calculatedCount: calculatedCount,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors : undefined
    };

    console.log(`\n📊 MAOSH HISOBLASH NATIJALARI:`);
    console.log(`   Jami hodimlar: ${summary.totalEmployees}`);
    console.log(`   Ish haqqi topilgan: ${summary.employeesWithRates}`);
    console.log(`   Ish haqqi topilmagan: ${summary.employeesWithoutRates}`);
    console.log(`   Maosh hisoblandi: ${summary.calculatedCount}`);
    console.log(`   Xatolar: ${summary.errorCount}`);

    res.json({
      success: true,
      calculated: calculatedCount,
      errors: errors.length > 0 ? errors : undefined,
      summary: summary,
      message: `${calculatedCount} ta maosh muvaffaqiyatli hisoblandi${errors.length > 0 ? `. ${errors.length} ta xatolik yuz berdi.` : ''}`
    });
  } catch (error) {
    console.error('Calculate salaries error:', error);
    res.status(500).json({
      success: false,
      message: 'Maoshlarni hisoblashda xatolik'
    });
  }
});

// ========== JARIMA HISOBLASH FUNKSIYASI ==========
async function calculatePenalties(emp, period_type, period_date, startDate, endDate, scheduleMap, attendanceRows, userId, role) {
  // Kech qolganlar uchun jarima hisoblash - sozlamalardan o'qish
  let penaltyConfig = {
    lateThresholdMinutes: 5, // Default: 5 minutdan keyin kech qolgan hisoblanadi
    penaltyPerMinute: 1000, // Default: Har bir minut uchun 1000 so'm jarima
    maxPenaltyPerDay: 50000 // Default: Bir kunda maksimal 50000 so'm jarima
  };

  // Sozlamalarni database'dan o'qish
  try {
    const settingsResult = await pool.query(
      `SELECT late_threshold_minutes, penalty_per_minute, max_penalty_per_day 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (settingsResult.rows.length > 0 && settingsResult.rows[0]) {
      const settings = settingsResult.rows[0];
      if (settings.late_threshold_minutes !== null) {
        penaltyConfig.lateThresholdMinutes = settings.late_threshold_minutes;
      }
      if (settings.penalty_per_minute !== null) {
        penaltyConfig.penaltyPerMinute = settings.penalty_per_minute;
      }
      if (settings.max_penalty_per_day !== null) {
        penaltyConfig.maxPenaltyPerDay = settings.max_penalty_per_day;
      }
    }
  } catch (settingsError) {
    console.error('Error loading penalty settings, using defaults:', settingsError);
    // Default qiymatlar ishlatiladi
  }

  let totalPenalty = 0;
  const penaltyDetails = [];

  // Har bir kun uchun kech qolganlikni tekshirish
  const dailyEntries = new Map(); // dateStr -> [entry times]

  attendanceRows.forEach(row => {
    if (row.event_type === 'entry') {
      const eventDate = new Date(row.event_time);
      const dateStr = eventDate.toISOString().split('T')[0];
      const jsDayOfWeek = eventDate.getDay();
      const dayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;

      const schedule = scheduleMap.get(dayOfWeek);
      if (schedule) {
        if (!dailyEntries.has(dateStr)) {
          dailyEntries.set(dateStr, []);
        }
        dailyEntries.get(dateStr).push({
          entryTime: new Date(row.event_time),
          expectedStart: schedule.start_time
        });
      }
    }
  });

  // Har bir kun uchun jarima hisoblash
  for (const [dateStr, entries] of dailyEntries) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const jsDayOfWeek = date.getDay();
    const dayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
    const schedule = scheduleMap.get(dayOfWeek);

    if (!schedule) continue;

    const [startHours, startMins] = schedule.start_time.split(':').map(Number);
    const expectedStartMinutes = startHours * 60 + startMins;

    // Birinchi entry ni topish (eng erta)
    const firstEntry = entries.sort((a, b) => a.entryTime - b.entryTime)[0];
    if (!firstEntry) continue;

    const entryTime = firstEntry.entryTime;
    const entryHours = entryTime.getHours();
    const entryMins = entryTime.getMinutes();
    const entryMinutes = entryHours * 60 + entryMins;

    // Kech qolganlikni hisoblash
    const lateMinutes = entryMinutes - expectedStartMinutes;

    if (lateMinutes > penaltyConfig.lateThresholdMinutes) {
      const dayPenalty = Math.min(
        lateMinutes * penaltyConfig.penaltyPerMinute,
        penaltyConfig.maxPenaltyPerDay
      );
      totalPenalty += dayPenalty;

      penaltyDetails.push({
        date: dateStr,
        lateMinutes: lateMinutes,
        penalty: dayPenalty,
        reason: `Kech qolgan: ${lateMinutes} minut`
      });
    }
  }

  // Agar jarima bo'lsa, database ga yozish
  if (totalPenalty > 0) {
    const checkExisting = await pool.query(
      'SELECT id FROM penalties WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
      [emp.id, period_type, period_date]
    );

    const reason = penaltyDetails.map(p => `${p.date}: ${p.reason}`).join('; ');

    if (checkExisting.rows.length > 0) {
      await pool.query(
        'UPDATE penalties SET amount = $1, reason = $2 WHERE id = $3',
        [totalPenalty, reason, checkExisting.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO penalties (employee_id, amount, penalty_date, reason, period_type, period_date, admin_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emp.id,
          totalPenalty,
          period_date,
          reason,
          period_type,
          period_date,
          emp.admin_id,
          userId
        ]
      );
    }

    console.log(`   ⚠️ Jarima: ${emp.full_name} - ${totalPenalty} so'm (${penaltyDetails.length} kun kech qolgan)`);
  }
}

// ========== KPI HISOBLASH FUNKSIYASI ==========
async function calculateKPI(emp, period_type, period_date, startDate, endDate, scheduleMap, dailyWorkMinutes, totalWorkMinutes, expectedTotalMinutes, userId, role) {
  // KPI hisoblash: ishlagan vaqt / kutilgan vaqt * 100
  let kpiScore = 0;
  let kpiAmount = 0;

  if (expectedTotalMinutes > 0 && totalWorkMinutes > 0) {
    // KPI score: 0-100
    kpiScore = Math.min(100, Math.round((totalWorkMinutes / expectedTotalMinutes) * 100));

    // KPI bonus: score ga qarab
    // 90-100: 10% bonus
    // 80-89: 5% bonus
    // 70-79: 2% bonus
    // 60-69: 1% bonus
    // 60 dan past: bonus yo'q

    // Maoshni olish
    const salaryResult = await pool.query(
      'SELECT amount FROM salaries WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
      [emp.id, period_type, period_date]
    );

    if (salaryResult.rows.length > 0) {
      const salaryAmount = parseFloat(salaryResult.rows[0].amount) || 0;

      if (kpiScore >= 90) {
        kpiAmount = salaryAmount * 0.10; // 10% bonus
      } else if (kpiScore >= 80) {
        kpiAmount = salaryAmount * 0.05; // 5% bonus
      } else if (kpiScore >= 70) {
        kpiAmount = salaryAmount * 0.02; // 2% bonus
      } else if (kpiScore >= 60) {
        kpiAmount = salaryAmount * 0.01; // 1% bonus
      }

      kpiAmount = Math.round(kpiAmount * 100) / 100;
    }
  }

  // Agar KPI score 60 dan yuqori bo'lsa, database ga yozish
  if (kpiScore >= 60) {
    const checkExisting = await pool.query(
      'SELECT id FROM kpi_records WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
      [emp.id, period_type, period_date]
    );

    const reason = `Ishlagan vaqt: ${Math.floor(totalWorkMinutes / 60)}s ${totalWorkMinutes % 60}d / Kutilgan: ${Math.floor(expectedTotalMinutes / 60)}s ${expectedTotalMinutes % 60}d`;

    if (checkExisting.rows.length > 0) {
      await pool.query(
        'UPDATE kpi_records SET score = $1, amount = $2, reason = $3 WHERE id = $4',
        [kpiScore, kpiAmount, reason, checkExisting.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO kpi_records (employee_id, score, amount, kpi_date, reason, period_type, period_date, admin_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          emp.id,
          kpiScore,
          kpiAmount,
          period_date,
          reason,
          period_type,
          period_date,
          emp.admin_id,
          userId
        ]
      );
    }

    if (kpiAmount > 0) {
      console.log(`   ⭐ KPI: ${emp.full_name} - ${kpiScore} ball, ${kpiAmount} so'm bonus`);
    }
  }
}

app.delete('/api/salaries/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const salaryId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(salaryId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri maosh ID'
      });
    }

    let checkQuery = `
      SELECT s.id, e.admin_id 
      FROM salaries s
      JOIN employees e ON s.employee_id = e.id
      WHERE s.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [salaryId, userId] : [salaryId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Maosh topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM salaries WHERE id = $1', [salaryId]);

    res.json({
      success: true,
      message: 'Maosh muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete salary error:', error);
    res.status(500).json({
      success: false,
      message: 'Maoshni o\'chirishda xatolik'
    });
  }
});


app.get('/api/daily-changes', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { date, start_date, end_date, change_type } = req.query;

    let query = `
      SELECT 
        dc.id,
        dc.employee_id,
        dc.change_date,
        dc.change_type,
        dc.old_position,
        dc.new_position,
        dc.substitute_employee_id,
        dc.original_employee_id,
        dc.notes,
        dc.created_at,
        dc.created_by,
        e.full_name as employee_name,
        e.position as employee_position,
        sub_e.full_name as substitute_employee_name,
        orig_e.full_name as original_employee_name,
        u.username as created_by_username
      FROM daily_changes dc
      JOIN employees e ON dc.employee_id = e.id
      LEFT JOIN employees sub_e ON dc.substitute_employee_id = sub_e.id
      LEFT JOIN employees orig_e ON dc.original_employee_id = orig_e.id
      LEFT JOIN users u ON dc.created_by = u.id
    `;

    const params = [];
    let paramIndex = 1;
    const conditions = [];

    // Employee filter
    if (req.query.employee_id) {
      conditions.push(`dc.employee_id = $${paramIndex++}`);
      params.push(parseInt(req.query.employee_id));
    }

    // Admin filter (for non-super_admin)
    if (role !== 'super_admin') {
      conditions.push(`e.admin_id = $${paramIndex++}`);
      params.push(userId);
    }

    // Date filter (backward compatibility)
    if (date) {
      conditions.push(`dc.change_date = $${paramIndex++}`);
      params.push(date);
    }

    // Date range filter (new)
    if (start_date) {
      conditions.push(`dc.change_date >= $${paramIndex++}`);
      params.push(start_date);
    }

    if (end_date) {
      conditions.push(`dc.change_date <= $${paramIndex++}`);
      params.push(end_date);
    }

    // Change type filter
    if (change_type) {
      conditions.push(`dc.change_type = $${paramIndex++}`);
      params.push(change_type);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY dc.change_date DESC, dc.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      changes: result.rows
    });
  } catch (error) {
    console.error('Get daily changes error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunlik o\'zgarishlarni olishda xatolik'
    });
  }
});

app.get('/api/daily-changes/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const changeId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(changeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri o\'zgarish ID'
      });
    }

    let query = `
      SELECT 
        dc.id,
        dc.employee_id,
        dc.change_date,
        dc.change_type,
        dc.old_position,
        dc.new_position,
        dc.substitute_employee_id,
        dc.original_employee_id,
        dc.notes,
        dc.created_at,
        dc.created_by,
        e.full_name as employee_name,
        e.position as employee_position,
        e.admin_id,
        sub_e.full_name as substitute_employee_name,
        orig_e.full_name as original_employee_name
      FROM daily_changes dc
      JOIN employees e ON dc.employee_id = e.id
      LEFT JOIN employees sub_e ON dc.substitute_employee_id = sub_e.id
      LEFT JOIN employees orig_e ON dc.original_employee_id = orig_e.id
      WHERE dc.id = $1
    `;

    const params = [changeId];

    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $2`;
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'O\'zgarish topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    res.json({
      success: true,
      change: result.rows[0]
    });
  } catch (error) {
    console.error('Get daily change error:', error);
    res.status(500).json({
      success: false,
      message: 'O\'zgarishni olishda xatolik'
    });
  }
});

app.post('/api/daily-changes', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const {
      employee_id,
      change_date,
      change_type,
      old_position,
      new_position,
      substitute_employee_id,
      original_employee_id,
      notes
    } = req.body;
    const { userId, role } = req.session;

    if (!employee_id || !change_date || !change_type) {
      return res.status(400).json({
        success: false,
        message: 'Hodim, sana va o\'zgarish turi kiritishingiz kerak'
      });
    }

    if (!['position_change', 'substitute', 'other'].includes(change_type)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri o\'zgarish turi'
      });
    }

    const employeeCheck = await pool.query(
      'SELECT id, admin_id, position FROM employees WHERE id = $1',
      [employee_id]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizning o\'zgarishlarini kiritishingiz mumkin'
      });
    }

    if (change_type === 'substitute' && substitute_employee_id) {
      const subCheck = await pool.query(
        'SELECT id, admin_id FROM employees WHERE id = $1',
        [substitute_employee_id]
      );

      if (subCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'O\'rniga ishlaydigan hodim topilmadi'
        });
      }

      if (role !== 'super_admin' && subCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Siz faqat o\'z hodimlaringizni tanlash mumkin'
        });
      }
    }

    if (change_type === 'substitute' && original_employee_id) {
      const origCheck = await pool.query(
        'SELECT id, admin_id FROM employees WHERE id = $1',
        [original_employee_id]
      );

      if (origCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Asl hodim topilmadi'
        });
      }

      if (role !== 'super_admin' && origCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Siz faqat o\'z hodimlaringizni tanlash mumkin'
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO daily_changes (
        employee_id, change_date, change_type, old_position, new_position, 
        substitute_employee_id, original_employee_id, notes, admin_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING id, employee_id, change_date, change_type, old_position, new_position, 
        substitute_employee_id, original_employee_id, notes, created_at, created_by`,
      [
        employee_id,
        change_date,
        change_type,
        old_position || null,
        new_position || null,
        substitute_employee_id || null,
        original_employee_id || null,
        notes || null,
        employeeCheck.rows[0].admin_id,
        userId
      ]
    );

    res.json({
      success: true,
      message: 'Kunlik o\'zgarish muvaffaqiyatli qo\'shildi',
      change: result.rows[0]
    });
  } catch (error) {
    console.error('Create daily change error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunlik o\'zgarish qo\'shishda xatolik'
    });
  }
});

app.put('/api/daily-changes/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const changeId = parseInt(req.params.id);
    const {
      employee_id,
      change_date,
      change_type,
      old_position,
      new_position,
      substitute_employee_id,
      original_employee_id,
      notes
    } = req.body;
    const { userId, role } = req.session;

    if (isNaN(changeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri o\'zgarish ID'
      });
    }

    let checkQuery = `
      SELECT dc.id, e.admin_id 
      FROM daily_changes dc
      JOIN employees e ON dc.employee_id = e.id
      WHERE dc.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [changeId, userId] : [changeId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'O\'zgarish topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (employee_id !== undefined) {
      const empCheck = await pool.query('SELECT id, admin_id FROM employees WHERE id = $1', [employee_id]);
      if (empCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Hodim topilmadi' });
      }
      if (role !== 'super_admin' && empCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({ success: false, message: 'Siz faqat o\'z hodimlaringizni tanlash mumkin' });
      }
      updateFields.push(`employee_id = $${paramIndex++}`);
      updateValues.push(parseInt(employee_id));
    }

    if (change_date !== undefined) {
      updateFields.push(`change_date = $${paramIndex++}`);
      updateValues.push(change_date);
    }

    if (change_type !== undefined) {
      if (!['position_change', 'substitute', 'other'].includes(change_type)) {
        return res.status(400).json({ success: false, message: 'Noto\'g\'ri o\'zgarish turi' });
      }
      updateFields.push(`change_type = $${paramIndex++}`);
      updateValues.push(change_type);
    }

    if (old_position !== undefined) {
      updateFields.push(`old_position = $${paramIndex++}`);
      updateValues.push(old_position || null);
    }

    if (new_position !== undefined) {
      updateFields.push(`new_position = $${paramIndex++}`);
      updateValues.push(new_position || null);
    }

    if (substitute_employee_id !== undefined) {
      if (substitute_employee_id) {
        const subCheck = await pool.query('SELECT id, admin_id FROM employees WHERE id = $1', [substitute_employee_id]);
        if (subCheck.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'O\'rniga ishlaydigan hodim topilmadi' });
        }
        if (role !== 'super_admin' && subCheck.rows[0].admin_id !== userId) {
          return res.status(403).json({ success: false, message: 'Siz faqat o\'z hodimlaringizni tanlash mumkin' });
        }
      }
      updateFields.push(`substitute_employee_id = $${paramIndex++}`);
      updateValues.push(substitute_employee_id || null);
    }

    if (original_employee_id !== undefined) {
      if (original_employee_id) {
        const origCheck = await pool.query('SELECT id, admin_id FROM employees WHERE id = $1', [original_employee_id]);
        if (origCheck.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Asl hodim topilmadi' });
        }
        if (role !== 'super_admin' && origCheck.rows[0].admin_id !== userId) {
          return res.status(403).json({ success: false, message: 'Siz faqat o\'z hodimlaringizni tanlash mumkin' });
        }
      }
      updateFields.push(`original_employee_id = $${paramIndex++}`);
      updateValues.push(original_employee_id || null);
    }

    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      updateValues.push(notes || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateValues.push(changeId);
    const updateQuery = `
      UPDATE daily_changes 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, employee_id, change_date, change_type, old_position, new_position, 
        substitute_employee_id, original_employee_id, notes, created_at, created_by
    `;

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      message: 'Kunlik o\'zgarish muvaffaqiyatli yangilandi',
      change: result.rows[0]
    });
  } catch (error) {
    console.error('Update daily change error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunlik o\'zgarishni yangilashda xatolik'
    });
  }
});

app.delete('/api/daily-changes/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const changeId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(changeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri o\'zgarish ID'
      });
    }

    let checkQuery = `
      SELECT dc.id, e.admin_id 
      FROM daily_changes dc
      JOIN employees e ON dc.employee_id = e.id
      WHERE dc.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [changeId, userId] : [changeId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'O\'zgarish topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM daily_changes WHERE id = $1', [changeId]);

    res.json({
      success: true,
      message: 'Kunlik o\'zgarish muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete daily change error:', error);
    res.status(500).json({
      success: false,
      message: 'Kunlik o\'zgarishni o\'chirishda xatolik'
    });
  }
});


app.get('/api/salary-rates', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { employee_id } = req.query;

    let query = `
      SELECT 
        sr.id,
        sr.employee_id,
        sr.position_name,
        sr.amount,
        sr.period_type,
        sr.notes,
        sr.created_at,
        sr.updated_at,
        sr.created_by,
        e.full_name as employee_name,
        e.position as employee_position
      FROM salary_rates sr
      LEFT JOIN employees e ON sr.employee_id = e.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (employee_id) {
      query += ` AND sr.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }

    if (role !== 'super_admin') {
      query += ` AND sr.admin_id = $${paramIndex++}`;
      params.push(userId);
    }

    query += ` ORDER BY sr.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      rates: result.rows
    });
  } catch (error) {
    console.error('Get salary rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish haqqi belgilanishlarini olishda xatolik'
    });
  }
});

app.get('/api/salary-rates/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const rateId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(rateId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri ish haqqi ID'
      });
    }

    let query = `
      SELECT 
        sr.id,
        sr.employee_id,
        sr.position_name,
        sr.amount,
        sr.period_type,
        sr.notes,
        sr.created_at,
        sr.updated_at,
        sr.created_by,
        e.full_name as employee_name,
        e.position as employee_position,
        e.admin_id
      FROM salary_rates sr
      LEFT JOIN employees e ON sr.employee_id = e.id
      WHERE sr.id = $1
    `;

    const params = [rateId];

    if (role !== 'super_admin') {
      query += ` AND sr.admin_id = $2`;
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ish haqqi belgilanishi topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    res.json({
      success: true,
      rate: result.rows[0]
    });
  } catch (error) {
    console.error('Get salary rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish haqqi belgilanishini olishda xatolik'
    });
  }
});

app.post('/api/salary-rates', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id, position_name, amount, period_type, notes } = req.body;
    const { userId, role } = req.session;

    if (!amount || !period_type) {
      return res.status(400).json({
        success: false,
        message: 'Summa va davr turi kiritishingiz kerak'
      });
    }

    if (!employee_id && !position_name) {
      return res.status(400).json({
        success: false,
        message: 'Hodim yoki lavozim tanlashingiz kerak'
      });
    }

    if (employee_id && position_name) {
      return res.status(400).json({
        success: false,
        message: 'Faqat hodim yoki faqat lavozim tanlashingiz mumkin'
      });
    }

    if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
      return res.status(400).json({
        success: false,
        message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Summa musbat son bo\'lishi kerak'
      });
    }

    if (employee_id) {
      const employeeCheck = await pool.query(
        'SELECT id, admin_id, position FROM employees WHERE id = $1',
        [employee_id]
      );

      if (employeeCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Hodim topilmadi'
        });
      }

      if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Siz faqat o\'z hodimlaringizga ish haqqi belgilay olasiz'
        });
      }

      const employee = employeeCheck.rows[0];

      // MUHIM: Bitta hodim uchun faqat bir xil ish haqqi bo'lishi kerak
      // Avval barcha period_type'lar uchun tekshirish
      const allExistingCheck = await pool.query(
        'SELECT id, period_type FROM salary_rates WHERE employee_id = $1',
        [employee_id]
      );

      if (allExistingCheck.rows.length > 0) {
        // Agar boshqa period_type bilan ish haqqi mavjud bo'lsa, xatolik
        const existingRate = allExistingCheck.rows[0];
        if (existingRate.period_type !== period_type) {
          return res.status(400).json({
            success: false,
            message: `Bu hodim uchun ${existingRate.period_type === 'daily' ? 'kunlik' : existingRate.period_type === 'weekly' ? 'haftalik' : 'oylik'} ish haqqi allaqachon mavjud. Bitta hodim uchun faqat bir xil ish haqqi bo'lishi mumkin. Avval eski ish haqqini o'chiring yoki tahrirlang.`
          });
        }

        // Agar bir xil period_type bo'lsa, yangilash
        const updateResult = await pool.query(
          `UPDATE salary_rates 
           SET amount = $1, notes = $2, updated_at = CURRENT_TIMESTAMP, created_by = $3
           WHERE id = $4
           RETURNING id, employee_id, position_name, amount, period_type, notes, created_at, updated_at, created_by`,
          [parseFloat(amount), notes || null, userId, existingRate.id]
        );

        return res.json({
          success: true,
          message: 'Ish haqqi muvaffaqiyatli yangilandi',
          rate: updateResult.rows[0]
        });
      }

      // MUHIM: Agar hodim uchun maxsus ish haqqi belgilashga harakat qilinsa,
      // shu hodimning lavozimi uchun lavozim ish haqqi mavjud bo'lsa ham, bu ruxsat beriladi
      // (chunki maxsus ish haqqi ustun bo'ladi va lavozim ish haqqi e'tiborsiz qoldiriladi)
      // Lekin foydalanuvchiga xabar beramiz
      if (employee.position) {
        const positionRateCheck = await pool.query(
          `SELECT id, amount, period_type FROM salary_rates 
           WHERE position_name = $1 AND period_type = $2 AND admin_id = $3`,
          [employee.position, period_type, employee.admin_id]
        );

        if (positionRateCheck.rows.length > 0) {
          // Xatolik emas, lekin foydalanuvchiga xabar beramiz
          console.log(`⚠️ Hodim uchun maxsus ish haqqi belgilash: "${employee.position}" lavozimi uchun lavozim ish haqqi mavjud (${positionRateCheck.rows[0].amount} so'm), lekin maxsus ish haqqi ustun bo'ladi.`);
        }
      }
    }

    // Determine admin_id (funksiya boshida e'lon qilish)
    let adminIdForRate = userId;

    if (position_name) {
      let positionCheckQuery = 'SELECT name, admin_id FROM positions WHERE name = $1';
      let positionCheckParams = [position_name];

      if (role !== 'super_admin') {
        positionCheckQuery += ' AND admin_id = $2';
        positionCheckParams.push(userId);
      }

      const positionCheck = await pool.query(positionCheckQuery, positionCheckParams);

      if (positionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Lavozim topilmadi yoki ruxsatingiz yo\'q'
        });
      }

      adminIdForRate = positionCheck.rows[0].admin_id;

      // Lavozim uchun faqat bir marta ish haqqi belgilash mumkin (period_type dan qat'iy nazar)
      const existingCheck = await pool.query(
        'SELECT id FROM salary_rates WHERE position_name = $1 AND admin_id = $2',
        [position_name.trim(), adminIdForRate]
      );

      if (existingCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Bu lavozim uchun ish haqqi allaqachon belgilangan. O\'zgartirish uchun tahrirlash tugmasini bosing.'
        });
      }

      // MUHIM: Agar lavozim uchun ish haqqi belgilashga harakat qilinsa,
      // shu lavozimdagi ba'zi hodimlar uchun maxsus ish haqqi mavjud bo'lsa,
      // bu ruxsat beriladi (chunki maxsus ish haqqi ustun bo'ladi va lavozim ish haqqi e'tiborsiz qoldiriladi)
      // Lekin foydalanuvchiga xabar beramiz
      const employeesWithCustomRate = await pool.query(
        `SELECT e.id, e.full_name, sr.amount, sr.period_type
         FROM employees e
         INNER JOIN salary_rates sr ON sr.employee_id = e.id
         WHERE e.position = $1 AND e.admin_id = $2 AND sr.period_type = $3`,
        [position_name.trim(), adminIdForRate, period_type]
      );

      if (employeesWithCustomRate.rows.length > 0) {
        // Xatolik emas, lekin foydalanuvchiga xabar beramiz
        const employeeNames = employeesWithCustomRate.rows.map(e => e.full_name).join(', ');
        console.log(`⚠️ Lavozim uchun ish haqqi belgilash: "${position_name}" lavozimidagi ${employeesWithCustomRate.rows.length} ta hodim uchun maxsus ish haqqi mavjud (${employeeNames}). Maxsus ish haqqi ustun bo'ladi va lavozim ish haqqi bu hodimlar uchun qo'llanmaydi.`);
      }
    }

    // Determine admin_id (agar hali belgilanmagan bo'lsa)
    if (employee_id && adminIdForRate === userId) {
      const empCheck = await pool.query('SELECT admin_id FROM employees WHERE id = $1', [employee_id]);
      if (empCheck.rows.length > 0) {
        adminIdForRate = empCheck.rows[0].admin_id;
      }
    } else if (position_name && adminIdForRate === userId) {
      const posCheck = await pool.query('SELECT admin_id FROM positions WHERE name = $1', [position_name]);
      if (posCheck.rows.length > 0) {
        adminIdForRate = posCheck.rows[0].admin_id;
      }
    }

    const result = await pool.query(
      `INSERT INTO salary_rates (employee_id, position_name, amount, period_type, notes, admin_id, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, employee_id, position_name, amount, period_type, notes, created_at, updated_at, created_by`,
      [employee_id || null, position_name || null, parseFloat(amount), period_type, notes || null, adminIdForRate, userId]
    );

    res.json({
      success: true,
      message: 'Ish haqqi muvaffaqiyatli belgilandi',
      rate: result.rows[0]
    });
  } catch (error) {
    console.error('Create salary rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish haqqi belgilashda xatolik'
    });
  }
});

app.put('/api/salary-rates/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const rateId = parseInt(req.params.id);
    const { amount, period_type, notes } = req.body;
    const { userId, role } = req.session;

    if (isNaN(rateId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri ish haqqi ID'
      });
    }

    let checkQuery = `
      SELECT sr.id, sr.employee_id, e.admin_id 
      FROM salary_rates sr
      LEFT JOIN employees e ON sr.employee_id = e.id
      WHERE sr.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND (sr.employee_id IS NULL OR e.admin_id = $2)`;
    }

    const checkParams = role !== 'super_admin' ? [rateId, userId] : [rateId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ish haqqi belgilanishi topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const oldRate = checkResult.rows[0];

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (amount !== undefined) {
      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Summa musbat son bo\'lishi kerak'
        });
      }
      updateFields.push(`amount = $${paramIndex++}`);
      updateValues.push(parseFloat(amount));
    }

    if (period_type !== undefined) {
      if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
        return res.status(400).json({
          success: false,
          message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
        });
      }

      // Agar period_type o'zgarmoqchi bo'lsa va employee_id bo'lsa, eski period_type bilan yangi period_type bir xil employee_id uchun muammo bo'lmasligi uchun
      // Avval eski period_type ni olish va yangi period_type bilan bir xil employee_id uchun boshqa ish haqqi bor-yo'qligini tekshirish
      if (oldRate.employee_id && period_type !== oldRate.period_type) {
        // Eski period_type bilan yangi period_type bir xil employee_id uchun boshqa ish haqqi bor-yo'qligini tekshirish
        const duplicateCheck = await pool.query(
          'SELECT id FROM salary_rates WHERE employee_id = $1 AND period_type = $2 AND id != $3',
          [oldRate.employee_id, period_type, rateId]
        );

        if (duplicateCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Bu hodim uchun ${period_type === 'daily' ? 'kunlik' : period_type === 'weekly' ? 'haftalik' : 'oylik'} ish haqqi allaqachon mavjud. Avval eski ish haqqini o'chiring yoki tahrirlang.`
          });
        }
      }

      updateFields.push(`period_type = $${paramIndex++}`);
      updateValues.push(period_type);
    }

    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      updateValues.push(notes || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(rateId);

    const updateQuery = `
      UPDATE salary_rates 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, employee_id, position_name, amount, period_type, notes, created_at, updated_at, created_by
    `;

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      message: 'Ish haqqi muvaffaqiyatli yangilandi',
      rate: result.rows[0]
    });
  } catch (error) {
    console.error('Update salary rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish haqqi yangilashda xatolik'
    });
  }
});

app.delete('/api/salary-rates/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const rateId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(rateId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri ish haqqi ID'
      });
    }

    let checkQuery = `
      SELECT sr.id, sr.employee_id, e.admin_id 
      FROM salary_rates sr
      LEFT JOIN employees e ON sr.employee_id = e.id
      WHERE sr.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND (sr.employee_id IS NULL OR e.admin_id = $2)`;
    }

    const checkParams = role !== 'super_admin' ? [rateId, userId] : [rateId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ish haqqi belgilanishi topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM salary_rates WHERE id = $1', [rateId]);

    res.json({
      success: true,
      message: 'Ish haqqi belgilanishi muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete salary rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Ish haqqi o\'chirishda xatolik'
    });
  }
});

// Superadmin: Admin obunasini yangilash
app.post('/api/users/:id/subscription', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const { due_date, price } = req.body;

    if (isNaN(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri admin ID'
      });
    }

    if (!due_date) {
      return res.status(400).json({
        success: false,
        message: 'Muddat (sana) kiritilishi shart'
      });
    }

    // Adminni tekshirish
    const checkUser = await pool.query(
      'SELECT id, role FROM users WHERE id = $1 AND role = \'admin\'',
      [adminId]
    );

    if (checkUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin topilmadi'
      });
    }

    // Obunani yangilash va adminni faollashtirish (agar o'chirilgan bo'lsa)
    const updateResult = await pool.query(
      `UPDATE users 
       SET subscription_due_date = $1, 
           subscription_price = $2,
           is_active = true 
       WHERE id = $3 
       RETURNING id, username, subscription_due_date, subscription_price, is_active`,
      [due_date, price || 0, adminId]
    );

    console.log(`✅ Admin obunasi yangilandi: ${updateResult.rows[0].username}, ${due_date}`);

    res.json({
      success: true,
      message: 'Obuna muvaffaqiyatli yangilandi va admin faollashtirildi',
      user: updateResult.rows[0]
    });

  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Obunani yangilashda xatolik'
    });
  }
});


app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const { userId } = req.session;
    const result = await pool.query(
      'SELECT id, username, role, is_active, permissions, subscription_due_date, subscription_price, organization_name, logo_path FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    const user = result.rows[0];

    // Agar foydalanuvchi to'xtatilgan bo'lsa
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Sizning hisobingiz to\'xtatilgan. Iltimos, administratorga murojaat qiling.'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
        permissions: user.permissions || {},
        subscription_due_date: user.subscription_due_date,
        subscription_price: user.subscription_price,
        organization_name: user.organization_name,
        logo_path: user.logo_path
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Ma\'lumotlarni olishda xatolik'
    });
  }
});

app.get('/api/me-employee', requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.session;

    // Foydalanuvchi statusini tekshirish
    const userCheck = await pool.query(
      'SELECT is_active FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi'
      });
    }

    if (!userCheck.rows[0].is_active) {
      return res.status(403).json({
        success: false,
        message: 'Sizning hisobingiz to\'xtatilgan. Iltimos, administratorga murojaat qiling.'
      });
    }

    if (role === 'employee') {
      const result = await pool.query(`
        SELECT 
          e.id,
          e.user_id,
          e.admin_id,
          e.full_name,
          e.position,
          e.phone,
          e.email,
          e.created_at,
          u.username,
          u.role,
          admin_u.organization_name,
          admin_u.logo_path
        FROM employees e
        JOIN users u ON e.user_id = u.id
        LEFT JOIN users admin_u ON e.admin_id = admin_u.id
        WHERE e.user_id = $1
      `, [userId]);

      if (result.rows.length > 0) {
        return res.json({
          success: true,
          user: {
            id: result.rows[0].id,
            user_id: result.rows[0].user_id,
            admin_id: result.rows[0].admin_id,
            full_name: result.rows[0].full_name,
            position: result.rows[0].position,
            phone: result.rows[0].phone,
            email: result.rows[0].email,
            created_at: result.rows[0].created_at,
            username: result.rows[0].username,
            role: result.rows[0].role,
            organization_name: result.rows[0].organization_name || '',
            logo_path: result.rows[0].logo_path || ''
          }
        });
      }
    } else {
      const result = await pool.query(
        'SELECT id, username, role, is_active, organization_name, logo_path, created_at FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return res.json({
          success: true,
          user: {
            id: result.rows[0].id,
            username: result.rows[0].username,
            role: result.rows[0].role,
            is_active: result.rows[0].is_active,
            organization_name: result.rows[0].organization_name || '',
            logo_path: result.rows[0].logo_path || '',
            created_at: result.rows[0].created_at
          }
        });
      }
    }

    res.status(404).json({
      success: false,
      message: 'Foydalanuvchi topilmadi'
    });

  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Ma\'lumotlarni olishda xatolik'
    });
  }
});

// Employee dashboard data (for employee role only)
app.get('/api/employee/dashboard', requireAuth, requireRole('employee'), async (req, res) => {
  try {
    const { userId } = req.session;

    // Find employee by logged-in user_id
    const empRes = await pool.query(
      `SELECT e.id, e.admin_id, e.full_name, e.position, e.phone, e.email, e.created_at, u.username
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.user_id = $1`,
      [userId]
    );

    if (empRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hodim topilmadi' });
    }

    const employee = empRes.rows[0];
    const employeeId = employee.id;

    // Work schedules
    let schedules = [];
    try {
      const schedRes = await pool.query(
        `SELECT day_of_week, start_time, end_time, is_active
         FROM work_schedules
         WHERE employee_id = $1 AND is_active = true
         ORDER BY day_of_week`,
        [employeeId]
      );
      // Map is_active to has_schedule for frontend compatibility
      schedules = (schedRes.rows || []).map(row => ({
        day_of_week: row.day_of_week,
        start_time: row.start_time,
        end_time: row.end_time,
        has_schedule: row.is_active === true
      }));
    } catch (e) {
      console.error('Work schedule query error:', e);
      // work_schedules table might not exist in some setups; ignore gracefully
      schedules = [];
    }

    // Date ranges
    const now = new Date();
    const start30 = new Date(now);
    start30.setDate(start30.getDate() - 30);
    start30.setHours(0, 0, 0, 0);

    // One week ago for weekly attendance
    const start7 = new Date(now);
    start7.setDate(start7.getDate() - 7);
    start7.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthStart.setHours(0, 0, 0, 0);
    monthEnd.setHours(23, 59, 59, 999);

    // Attendance (last 30 days): take latest entry/exit per day
    let attendanceDays = [];
    try {
      const attRes = await pool.query(
        `SELECT event_time, event_type
         FROM attendance_logs
         WHERE employee_id = $1 AND event_time >= $2
         ORDER BY event_time ASC`,
        [employeeId, start30.toISOString()]
      );

      const dayMap = new Map();
      for (const row of attRes.rows) {
        const d = new Date(row.event_time);
        const key = d.toISOString().slice(0, 10);
        if (!dayMap.has(key)) {
          dayMap.set(key, {
            date: key,
            first_entry: null,
            last_exit: null,
            events: [] // Store all events for this day
          });
        }
        const obj = dayMap.get(key);
        // Keep first entry and last exit for display
        if (row.event_type === 'entry') {
          if (!obj.first_entry || d < obj.first_entry) obj.first_entry = d;
        }
        if (row.event_type === 'exit') {
          if (!obj.last_exit || d > obj.last_exit) obj.last_exit = d;
        }
        // Store all events
        obj.events.push({
          time: d.toISOString(),
          type: row.event_type
        });
      }

      attendanceDays = Array.from(dayMap.values()).map(d => ({
        date: d.date,
        entry_time: d.first_entry ? d.first_entry.toISOString() : null,
        exit_time: d.last_exit ? d.last_exit.toISOString() : null,
        events: d.events // Include all events for detailed display
      }));
    } catch (e) {
      console.error('Attendance query error:', e);
      attendanceDays = [];
    }

    // Weekly attendance (last 7 days)
    let weeklyAttendance = [];
    try {
      const weeklyAttRes = await pool.query(
        `SELECT event_time, event_type
         FROM attendance_logs
         WHERE employee_id = $1 AND event_time >= $2
         ORDER BY event_time ASC`,
        [employeeId, start7.toISOString()]
      );

      const weeklyDayMap = new Map();
      for (const row of weeklyAttRes.rows) {
        const d = new Date(row.event_time);
        const key = d.toISOString().slice(0, 10);
        if (!weeklyDayMap.has(key)) weeklyDayMap.set(key, { date: key, entry: null, exit: null });
        const obj = weeklyDayMap.get(key);
        if (row.event_type === 'entry') obj.entry = d;
        if (row.event_type === 'exit') obj.exit = d;
      }

      // Generate all 7 days (even if no attendance)
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const key = date.toISOString().slice(0, 10);
        const dayData = weeklyDayMap.get(key) || { date: key, entry: null, exit: null };

        weeklyAttendance.push({
          date: dayData.date,
          entry_time: dayData.entry ? dayData.entry.toISOString() : null,
          exit_time: dayData.exit ? dayData.exit.toISOString() : null,
          day_of_week: date.getDay() === 0 ? 7 : date.getDay() // Convert 0-6 to 1-7
        });
      }
    } catch (e) {
      weeklyAttendance = [];
    }

    // Compute worked hours + late minutes using schedules (if exist)
    const scheduleByDay = new Map(); // 1..7
    for (const s of schedules) {
      scheduleByDay.set(Number(s.day_of_week), s);
    }

    let totalWorkHours = 0;
    let totalLateMinutes = 0;

    // Get all attendance events for accurate work hours calculation (multiple entries/exits per day)
    const allAttendanceEvents = await pool.query(
      `SELECT event_time, event_type
       FROM attendance_logs
       WHERE employee_id = $1 AND event_time >= $2
       ORDER BY event_time ASC`,
      [employeeId, start30.toISOString()]
    );

    // Group events by date and calculate work hours for each day
    const eventsByDate = new Map();
    for (const row of allAttendanceEvents.rows) {
      const d = new Date(row.event_time);
      const key = d.toISOString().slice(0, 10);
      if (!eventsByDate.has(key)) {
        eventsByDate.set(key, []);
      }
      eventsByDate.get(key).push({
        time: d,
        type: row.event_type
      });
    }

    // Calculate work hours for each day (sum of all entry-exit pairs)
    for (const [dateKey, events] of eventsByDate) {
      let dayWorkHours = 0;
      let pendingEntry = null;

      // Process events in chronological order
      for (const event of events) {
        if (event.type === 'entry') {
          // If there's a pending entry without exit, ignore it (orphaned entry)
          // Start new entry period
          pendingEntry = event.time;
        } else if (event.type === 'exit' && pendingEntry) {
          // Calculate hours between entry and exit
          const hours = (event.time.getTime() - pendingEntry.getTime()) / (1000 * 60 * 60);
          if (hours > 0) {
            dayWorkHours += hours;
          }
          pendingEntry = null; // Reset pending entry
        }
      }

      // If there's a pending entry without exit, don't count it (employee still at work)
      // We could count until current time, but for 30-day calculation, we'll skip it

      totalWorkHours += dayWorkHours;
    }

    // Calculate late minutes (only for first entry of each day)
    for (const d of attendanceDays) {
      if (!d.entry_time) continue;
      const entry = new Date(d.entry_time);

      // late minutes - only first entry of the day counts for lateness
      const jsDow = entry.getDay(); // 0..6 (0=Sunday, 1=Monday, ...)
      const dow = jsDow === 0 ? 7 : jsDow; // Convert to 1..7 (1=Monday, 7=Sunday)
      const sched = scheduleByDay.get(dow);

      if (sched && sched.has_schedule === true && sched.start_time) {
        try {
          // Parse start_time (TIME format: HH:mm:ss or HH:mm)
          const startTimeStr = String(sched.start_time);
          const timeParts = startTimeStr.split(':');
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1] || '0', 10);

          // Create date object for the same day as entry
          const start = new Date(entry);
          start.setHours(hours, minutes, 0, 0);

          if (entry > start) {
            const lateMs = entry.getTime() - start.getTime();
            const lateMins = lateMs / (1000 * 60);
            totalLateMinutes += lateMins;
          }
        } catch (e) {
          // Silent error handling for late calculation
        }
      }
    }

    // Salaries / Bonuses / Penalties (current month totals + recent)
    const salariesRes = await pool.query(
      `SELECT id, amount, period_type, period_date, work_position, notes, created_at
       FROM salaries
       WHERE employee_id = $1 AND period_date BETWEEN $2 AND $3
       ORDER BY period_date DESC, created_at DESC`,
      [employeeId, monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10)]
    );

    let bonuses = [];
    try {
      const bonusRes = await pool.query(
        `SELECT id, amount, bonus_date, reason, period_type, period_date, created_at
         FROM bonuses
         WHERE employee_id = $1 AND period_date BETWEEN $2 AND $3
         ORDER BY period_date DESC, created_at DESC`,
        [employeeId, monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10)]
      );
      bonuses = bonusRes.rows || [];
    } catch (e) {
      bonuses = [];
    }

    let penalties = [];
    try {
      const penRes = await pool.query(
        `SELECT id, amount, penalty_date, reason, period_type, period_date, created_at
         FROM penalties
         WHERE employee_id = $1 AND period_date BETWEEN $2 AND $3
         ORDER BY period_date DESC, created_at DESC`,
        [employeeId, monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10)]
      );
      penalties = penRes.rows || [];
    } catch (e) {
      penalties = [];
    }

    const totalSalary = (salariesRes.rows || []).reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
    const totalBonus = bonuses.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    const totalPenalty = penalties.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const netAmount = totalSalary + totalBonus - totalPenalty;

    const responseData = {
      success: true,
      employee: {
        id: employeeId,
        username: employee.username,
        full_name: employee.full_name,
        position: employee.position,
        phone: employee.phone,
        email: employee.email,
        created_at: employee.created_at
      },
      range: {
        attendance_from: start30.toISOString().slice(0, 10),
        attendance_to: now.toISOString().slice(0, 10),
        month_from: monthStart.toISOString().slice(0, 10),
        month_to: monthEnd.toISOString().slice(0, 10)
      },
      work_schedule: schedules,
      attendance_days: attendanceDays,
      weekly_attendance: weeklyAttendance,
      totals: {
        total_work_hours_30d: Math.round(totalWorkHours * 100) / 100,
        total_late_minutes_30d: Math.round(totalLateMinutes),
        total_salary_month: totalSalary,
        total_bonus_month: totalBonus,
        total_penalty_month: totalPenalty,
        net_amount_month: netAmount
      },
      salaries: salariesRes.rows || [],
      bonuses,
      penalties
    };

    res.json(responseData);
  } catch (error) {
    console.error('Employee dashboard error:', error);
    res.status(500).json({ success: false, message: 'Ma\'lumotlarni olishda xatolik' });
  }
});


app.get('/api/terminals', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;

    let query = `
      SELECT 
        t.id,
        t.name,
        t.ip_address,
        t.terminal_type,
        t.username,
        t.is_active,
        t.admin_id,
        t.location,
        t.notes,
        t.created_at,
        t.updated_at
      FROM terminals t
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role !== 'super_admin') {
      query += ` AND t.admin_id = $${paramIndex++}`;
      params.push(userId);
    }

    query += ` ORDER BY t.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      terminals: result.rows
    });
  } catch (error) {
    console.error('Get terminals error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminallarni olishda xatolik'
    });
  }
});

app.get('/api/terminals/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let query = `
      SELECT 
        t.id,
        t.name,
        t.ip_address,
        t.terminal_type,
        t.username,
        t.is_active,
        t.admin_id,
        t.location,
        t.notes,
        t.created_at,
        t.updated_at
      FROM terminals t
      WHERE t.id = $1
    `;

    const params = [terminalId];

    if (role !== 'super_admin') {
      query += ` AND t.admin_id = $2`;
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi'
      });
    }

    const terminal = { ...result.rows[0] };
    delete terminal.password;

    res.json({
      success: true,
      terminal: terminal
    });
  } catch (error) {
    console.error('Get terminal error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminal ma\'lumotlarini olishda xatolik'
    });
  }
});

app.post('/api/terminals', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { name, ip_address, terminal_type, username, password, location, notes } = req.body;
    const { userId } = req.session;

    if (!name || !ip_address || !terminal_type) {
      return res.status(400).json({
        success: false,
        message: 'Nom, IP manzil va terminal turi kiritishingiz kerak'
      });
    }

    if (!['entry', 'exit'].includes(terminal_type)) {
      return res.status(400).json({
        success: false,
        message: 'Terminal turi "entry" yoki "exit" bo\'lishi kerak'
      });
    }

    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip_address)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri IP manzil format'
      });
    }

    const result = await pool.query(
      `INSERT INTO terminals (name, ip_address, terminal_type, username, password, admin_id, location, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, name, ip_address, terminal_type, username, is_active, admin_id, location, notes, created_at, updated_at`,
      [name, ip_address, terminal_type, username || null, password || null, userId, location || null, notes || null]
    );

    // CORS cache'ni yangilash (yangi terminal IP manzili qo'shildi)
    await updateCorsOrigins();

    res.json({
      success: true,
      message: 'Terminal muvaffaqiyatli qo\'shildi',
      terminal: result.rows[0]
    });
  } catch (error) {
    console.error('Create terminal error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        message: 'Bu IP manzil bilan terminal allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Terminal yaratishda xatolik'
    });
  }
});

app.put('/api/terminals/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { name, ip_address, terminal_type, username, password, location, notes, is_active } = req.body;
    const { userId, role } = req.session;

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let checkQuery = 'SELECT id, admin_id FROM terminals WHERE id = $1';
    const checkParams = [terminalId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    if (terminal_type && !['entry', 'exit'].includes(terminal_type)) {
      return res.status(400).json({
        success: false,
        message: 'Terminal turi "entry" yoki "exit" bo\'lishi kerak'
      });
    }

    if (ip_address) {
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ip_address)) {
        return res.status(400).json({
          success: false,
          message: 'Noto\'g\'ri IP manzil format'
        });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }
    if (ip_address !== undefined) {
      updateFields.push(`ip_address = $${paramIndex++}`);
      updateValues.push(ip_address);
    }
    if (terminal_type !== undefined) {
      updateFields.push(`terminal_type = $${paramIndex++}`);
      updateValues.push(terminal_type);
    }
    if (username !== undefined) {
      updateFields.push(`username = $${paramIndex++}`);
      updateValues.push(username || null);
    }
    if (password !== undefined) {
      updateFields.push(`password = $${paramIndex++}`);
      updateValues.push(password || null);
    }
    if (location !== undefined) {
      updateFields.push(`location = $${paramIndex++}`);
      updateValues.push(location || null);
    }
    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      updateValues.push(notes || null);
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramIndex++}`);
      updateValues.push(is_active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(terminalId);

    const updateQuery = `
      UPDATE terminals 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, name, ip_address, terminal_type, username, is_active, admin_id, location, notes, created_at, updated_at
    `;

    const result = await pool.query(updateQuery, updateValues);

    // CORS cache'ni yangilash (terminal IP manzili o'zgardi)
    await updateCorsOrigins();

    res.json({
      success: true,
      message: 'Terminal muvaffaqiyatli yangilandi',
      terminal: result.rows[0]
    });
  } catch (error) {
    console.error('Update terminal error:', error);

    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Bu IP manzil bilan terminal allaqachon mavjud'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Terminalni yangilashda xatolik'
    });
  }
});

app.delete('/api/terminals/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let checkQuery = 'SELECT id, admin_id FROM terminals WHERE id = $1';
    const checkParams = [terminalId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM terminals WHERE id = $1', [terminalId]);

    // CORS cache'ni yangilash (terminal o'chirildi)
    await updateCorsOrigins();

    res.json({
      success: true,
      message: 'Terminal muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete terminal error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminalni o\'chirishda xatolik'
    });
  }
});


app.post('/api/terminals/:id/test', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let checkQuery = 'SELECT * FROM terminals WHERE id = $1';
    const checkParams = [terminalId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const terminal = checkResult.rows[0];

    if (!hikvisionManager) {
      return res.status(500).json({
        success: false,
        message: 'Hikvision Manager yuklanmagan'
      });
    }

    try {
      const testResult = await hikvisionManager.testTerminal(terminalId);
      res.json({
        success: true,
        message: 'Terminal bilan aloqa muvaffaqiyatli',
        details: {
          deviceInfo: testResult
        }
      });
    } catch (error) {
      res.json({
        success: false,
        message: error.message || 'Terminal bilan aloqa o\'rnatilmadi',
        details: {
          error: error.message
        }
      });
    }
  } catch (error) {
    console.error('Test terminal connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminal bilan aloqani test qilishda xatolik: ' + error.message
    });
  }
});

app.post('/api/terminals/:id/fetch-users', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { userId, role } = req.session;
    const { save_to_db = false } = req.body; // Option to save to database

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let checkQuery = 'SELECT * FROM terminals WHERE id = $1';
    const checkParams = [terminalId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const terminal = checkResult.rows[0];

    if (!terminal.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Terminal faol emas'
      });
    }

    const HikvisionISAPIService = require('./services/hikvision-isapi');
    const hikvisionService = new HikvisionISAPIService({
      ip_address: terminal.ip_address,
      username: terminal.username,
      password: terminal.password
    });

    const result = await hikvisionService.getUsersAndFaces();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message || 'Terminaldan foydalanuvchilarni olishda xatolik',
        users: []
      });
    }

    let savedCount = 0;
    if (save_to_db && result.users && result.users.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const user of result.users) {
          if (!user.employeeNoString && !user.employeeNo) continue;

          const employeeNo = user.employeeNoString || user.employeeNo;

          let employeeId = null;

          const numericId = parseInt(employeeNo);
          if (!isNaN(numericId) && numericId > 0) {
            const empCheck = await client.query(
              'SELECT id FROM employees WHERE id = $1',
              [numericId]
            );
            if (empCheck.rows.length > 0) {
              employeeId = empCheck.rows[0].id;
            }
          }

          if (!employeeId && user.name) {
            const nameCheck = await client.query(
              'SELECT id FROM employees WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) LIMIT 1',
              [user.name]
            );
            if (nameCheck.rows.length > 0) {
              employeeId = nameCheck.rows[0].id;
            }
          }

          if (employeeId) {
            // Get admin_id from employee
            const adminResult = await client.query(
              'SELECT admin_id FROM employees WHERE id = $1',
              [employeeId]
            );
            const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].admin_id : null;

            if (adminId) {
              await client.query(
                `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id, admin_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (employee_id, terminal_id) 
                 DO UPDATE SET 
                   face_template_id = EXCLUDED.face_template_id,
                   admin_id = EXCLUDED.admin_id,
                   updated_at = CURRENT_TIMESTAMP`,
                [employeeId, terminalId, employeeNo, adminId]
              );
              savedCount++;
            }
          }
        }

        await client.query('COMMIT');
        client.release();
      } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('Error saving users to database:', error);
      }
    }

    let message = `${result.total} ta foydalanuvchi topildi`;
    if (!result.faceTemplatesAvailable) {
      message += ' (face template\'lar bu terminal modelida mavjud emas)';
    }
    if (save_to_db) {
      message += `, ${savedCount} ta saqlandi`;
    }

    res.json({
      success: true,
      message: message,
      users: result.users,
      total: result.total,
      userCount: result.userCount,
      faceCount: result.faceCount,
      faceTemplatesAvailable: result.faceTemplatesAvailable,
      saved: save_to_db ? savedCount : 0
    });
  } catch (error) {
    console.error('Fetch terminal users error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminaldan foydalanuvchilarni olishda xatolik: ' + error.message
    });
  }
});

app.post('/api/terminals/:id/sync', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const terminalId = parseInt(req.params.id);
    const { userId, role } = req.session;
    const { start_date, end_date } = req.body;

    if (isNaN(terminalId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri terminal ID'
      });
    }

    let checkQuery = 'SELECT * FROM terminals WHERE id = $1';
    const checkParams = [terminalId];

    if (role !== 'super_admin') {
      checkQuery += ' AND admin_id = $2';
      checkParams.push(userId);
    }

    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const terminal = checkResult.rows[0];

    if (!terminal.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Terminal faol emas'
      });
    }

    const endDate = end_date ? new Date(end_date) : new Date();
    const startDate = start_date ? new Date(start_date) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (!hikvisionManager) {
      return res.status(500).json({
        success: false,
        message: 'Hikvision Manager yuklanmagan'
      });
    }

    try {
      let syncResult;
      if (start_date && end_date) {
        syncResult = await hikvisionManager.manualSyncHistorical(terminalId, startDate, endDate);
      } else {
        syncResult = await hikvisionManager.manualSync(terminalId);
      }

      res.json({
        success: true,
        message: `Sinxronlash tugadi: ${syncResult.saved || 0} ta saqlandi, ${syncResult.duplicates || 0} ta duplikat`,
        ...syncResult
      });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Sinxronlashtirishda xatolik'
      });
    }
  } catch (error) {
    console.error('Sync terminal attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminal yozuvlarini sinxronlashda xatolik: ' + error.message
    });
  }
});

app.post('/api/terminals/sync-all', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;

    let terminalsQuery = 'SELECT * FROM terminals WHERE is_active = true';
    const terminalsParams = [];

    if (role !== 'super_admin') {
      terminalsQuery += ' AND admin_id = $1';
      terminalsParams.push(userId);
    }

    const terminalsResult = await pool.query(terminalsQuery, terminalsParams);
    const terminals = terminalsResult.rows;

    if (terminals.length === 0) {
      return res.json({
        success: true,
        message: 'Faol terminallar topilmadi',
        totalTerminals: 0,
        synced: 0,
        totalSaved: 0,
        totalDuplicates: 0,
        results: []
      });
    }

    if (hikvisionManager) {
      const results = [];
      let totalSaved = 0;
      let totalDuplicates = 0;

      for (const terminal of terminals) {
        try {
          const syncResult = await hikvisionManager.manualSync(terminal.id, null, null);
          results.push({
            terminalId: terminal.id,
            terminalName: terminal.name,
            saved: syncResult.saved || 0,
            duplicates: syncResult.duplicates || 0,
            success: true
          });
          totalSaved += syncResult.saved || 0;
          totalDuplicates += syncResult.duplicates || 0;
        } catch (error) {
          console.error(`❌ Terminal ${terminal.name} sync xatolik:`, error.message);

          // Terminal bloklangani haqida ma'lumotni tekshirish
          const isAccountLocked = error.isAccountLocked === true;
          const unlockTimeSeconds = error.unlockTimeSeconds || 0;

          results.push({
            terminalId: terminal.id,
            terminalName: terminal.name,
            saved: 0,
            duplicates: 0,
            success: false,
            error: error.message,
            isAccountLocked: isAccountLocked,
            unlockTimeSeconds: unlockTimeSeconds,
            ipAddress: terminal.ip_address,
            username: terminal.username || 'admin'
          });
        }
      }

      return res.json({
        success: true,
        message: `Barcha terminallar sinxronlashdi: ${totalSaved} ta yangi, ${totalDuplicates} ta duplikat`,
        totalTerminals: terminals.length,
        synced: results.filter(r => r.success).length,
        totalSaved: totalSaved,
        totalDuplicates: totalDuplicates,
        results: results
      });
    }

    return res.status(503).json({
      success: false,
      message: 'Sinxronlash funksiyasi mavjud emas'
    });
  } catch (error) {
    console.error('Sync all terminals error:', error);
    res.status(500).json({
      success: false,
      message: 'Terminallarni sinxronlashda xatolik: ' + error.message
    });
  }
});


app.get('/api/attendance', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { employee_id, terminal_id, event_type, start_date, end_date, limit = 100 } = req.query;

    let query = `
      SELECT 
        al.id,
        al.employee_id,
        t.id as terminal_id,
        COALESCE(al.event_type, 'entry')::VARCHAR as event_type,
        al.event_time,
        NULL::DECIMAL as face_match_score,
        al.verification_mode,
        al.created_at,
        al.employee_name,
        e.position as employee_position,
        al.terminal_name,
        COALESCE(t.terminal_type, 'entry')::VARCHAR as terminal_type,
        COALESCE(t.location, '')::VARCHAR as terminal_location,
        al.picture_url
      FROM attendance_logs al
      LEFT JOIN terminals t ON t.name = al.terminal_name
      LEFT JOIN employees e ON al.employee_id = e.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Always filter by admin_id for non-super_admin users
    if (role !== 'super_admin') {
      query += ` AND (al.employee_id IS NULL OR e.admin_id = $${paramIndex++})`;
      params.push(userId);

      // Also filter by terminal's admin_id if no employee_id
      query += ` AND (al.employee_id IS NOT NULL OR t.admin_id = $${paramIndex++})`;
      params.push(userId);
    }

    if (employee_id) {
      query += ` AND al.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }

    if (terminal_id) {
      query += ` AND al.terminal_name = (
        SELECT name FROM terminals WHERE id = $${paramIndex++}
      )`;
      params.push(parseInt(terminal_id));
    }

    if (start_date) {
      query += ` AND al.event_time >= $${paramIndex++}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND al.event_time <= $${paramIndex++}`;
      params.push(end_date);
    }

    // Limit'ni cheklash - maksimal 10000 (barcha eventlarni ko'rsatish uchun)
    // Agar limit ko'rsatilmagan bo'lsa, default 1000 (barcha eventlarni ko'rsatish uchun)
    const requestedLimit = parseInt(limit);
    const safeLimit = requestedLimit ? Math.min(requestedLimit, 10000) : 1000;
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    query += ` ORDER BY al.event_time DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(safeLimit, offset);

    const result = await pool.query(query, params);

    // Total count uchun alohida query (faqat kerak bo'lsa)
    let totalCount = null;
    if (req.query.include_total === 'true') {
      let countQuery = `SELECT COUNT(*) as total FROM attendance_logs al LEFT JOIN employees e ON al.employee_id = e.id LEFT JOIN terminals t ON t.name = al.terminal_name WHERE 1=1`;
      const countParams = [];
      let countParamIndex = 1;

      if (role !== 'super_admin') {
        countQuery += ` AND (al.employee_id IS NULL OR e.admin_id = $${countParamIndex++})`;
        countParams.push(userId);
        countQuery += ` AND (al.employee_id IS NOT NULL OR t.admin_id = $${countParamIndex++})`;
        countParams.push(userId);
      }

      if (employee_id) {
        countQuery += ` AND al.employee_id = $${countParamIndex++}`;
        countParams.push(parseInt(employee_id));
      }

      if (terminal_id) {
        countQuery += ` AND al.terminal_name = (SELECT name FROM terminals WHERE id = $${countParamIndex++})`;
        countParams.push(parseInt(terminal_id));
      }

      if (start_date) {
        countQuery += ` AND al.event_time >= $${countParamIndex++}`;
        countParams.push(start_date);
      }

      if (end_date) {
        countQuery += ` AND al.event_time <= $${countParamIndex++}`;
        countParams.push(end_date);
      }

      const countResult = await pool.query(countQuery, countParams);
      totalCount = parseInt(countResult.rows[0].total);
    }

    res.json({
      success: true,
      attendance: result.rows,
      pagination: totalCount !== null ? {
        total: totalCount,
        limit: safeLimit,
        offset,
        hasMore: offset + result.rows.length < totalCount
      } : undefined
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Keldi-ketdi yozuvlarini olishda xatolik'
    });
  }
});

app.get('/api/attendance/today-stats', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let employeesQuery = `
      SELECT e.id, e.full_name, e.position
      FROM employees e
      WHERE 1=1
    `;
    const employeesParams = [];
    let paramIndex = 1;

    if (role !== 'super_admin') {
      employeesQuery += ` AND e.admin_id = $${paramIndex++}`;
      employeesParams.push(userId);
    }

    const employeesResult = await pool.query(employeesQuery, employeesParams);
    const allEmployees = employeesResult.rows;

    let logsQuery = `
      SELECT 
        al.employee_id,
        COALESCE(al.employee_id::text, al.employee_name) as employee_key,
        al.employee_name,
        MIN(CASE 
          WHEN al.event_type = 'entry' THEN al.event_time
          WHEN al.event_type IS NULL AND al.event_time::time < '14:00:00'::time THEN al.event_time
          ELSE NULL
        END) as first_entry,
        MAX(CASE 
          WHEN al.event_type = 'exit' THEN al.event_time
          WHEN al.event_type IS NULL AND al.event_time::time >= '14:00:00'::time THEN al.event_time
          ELSE NULL
        END) as last_exit,
        COALESCE(
          (SELECT al2.picture_url 
           FROM attendance_logs al2 
           WHERE (al2.employee_id = al.employee_id OR (al2.employee_id IS NULL AND al2.employee_name = al.employee_name))
             AND al2.event_time >= $1 AND al2.event_time < $2
             AND al2.picture_url IS NOT NULL
           ORDER BY al2.event_time DESC
           LIMIT 1
          ),
          (SELECT al3.picture_url 
           FROM attendance_logs al3 
           WHERE (al3.employee_id = al.employee_id OR (al3.employee_id IS NULL AND al3.employee_name = al.employee_name))
             AND al3.picture_url IS NOT NULL
           ORDER BY al3.event_time DESC
           LIMIT 1
          )
        ) as picture_url
      FROM attendance_logs al
      WHERE al.event_time >= $1 AND al.event_time < $2
    `;
    const logsParams = [today, tomorrow];

    if (role !== 'super_admin') {
      logsQuery += ` AND (al.employee_id IS NULL OR al.employee_id IN (
        SELECT id FROM employees WHERE admin_id = $${logsParams.length + 1}
      ))`;
      logsParams.push(userId);
    }

    logsQuery += ` GROUP BY al.employee_id, al.employee_name`;

    const logsResult = await pool.query(logsQuery, logsParams);
    const attendanceMap = new Map();

    logsResult.rows.forEach(row => {
      const key = row.employee_id || row.employee_name;
      attendanceMap.set(key, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        first_entry: row.first_entry,
        last_exit: row.last_exit,
        picture_url: row.picture_url || null
      });
    });

    const jsDayOfWeek = today.getDay();
    const todayDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
    const schedulesResult = await pool.query(
      `SELECT ws.employee_id, ws.start_time, ws.end_time, e.full_name
       FROM work_schedules ws
       JOIN employees e ON ws.employee_id = e.id
       WHERE ws.day_of_week = $1 AND ws.is_active = true
       ${role !== 'super_admin' ? `AND e.admin_id = $2` : ''}`,
      role !== 'super_admin' ? [todayDayOfWeek, userId] : [todayDayOfWeek]
    );

    const scheduleMap = new Map();
    schedulesResult.rows.forEach(row => {
      scheduleMap.set(row.employee_id, {
        start_time: row.start_time,
        end_time: row.end_time
      });
    });

    const cameEmployees = [];
    const didNotComeEmployees = [];
    const lateEmployees = [];

    // First, try to update attendance_logs with missing employee_id
    // This helps link existing records by matching employee_name with full_name or username
    const updateQuery = `
      UPDATE attendance_logs al
      SET employee_id = e.id
      FROM employees e
      JOIN users u ON e.user_id = u.id
      WHERE al.employee_id IS NULL
        AND al.event_time >= $1 AND al.event_time < $2
        AND (
          LOWER(TRIM(al.employee_name)) = LOWER(TRIM(e.full_name))
          OR LOWER(TRIM(al.employee_name)) = LOWER(TRIM(u.username))
          OR al.employee_name = e.id::text
        )
        ${role !== 'super_admin' ? `AND e.admin_id = $3` : ''}
    `;
    try {
      const updateParams = [today, tomorrow];
      if (role !== 'super_admin') {
        updateParams.push(userId);
      }
      const updateResult = await pool.query(updateQuery, updateParams);
      if (updateResult.rowCount > 0) {
        console.log(`✅ Updated ${updateResult.rowCount} attendance_logs records with employee_id`);
        // Re-fetch logs after update
        const updatedLogsResult = await pool.query(logsQuery, logsParams);
        attendanceMap.clear();
        updatedLogsResult.rows.forEach(row => {
          const key = row.employee_id || row.employee_name;
          attendanceMap.set(key, {
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            first_entry: row.first_entry,
            last_exit: row.last_exit
          });
        });
      }
    } catch (updateError) {
      console.error('Error updating attendance_logs employee_id:', updateError);
      // Continue even if update fails
    }

    // Strategy 2: Positional matching for numeric employee_name (1, 2, 3...)
    // This matches terminal IDs with employees by their position in sorted list
    try {
      const unmatchedLogsQuery = `
        SELECT DISTINCT al.employee_name, al.terminal_name
        FROM attendance_logs al
        WHERE al.employee_id IS NULL
          AND al.event_time >= $1 AND al.event_time < $2
          AND al.employee_name ~ '^[0-9]+$'
        ${role !== 'super_admin' ? `
          AND al.terminal_name IN (
            SELECT t.name FROM terminals t
            WHERE t.admin_id = $3 OR EXISTS (
              SELECT 1 FROM employees e WHERE e.admin_id = $3
            )
          )
        ` : ''}
      `;
      const unmatchedParams = [today, tomorrow];
      if (role !== 'super_admin') {
        unmatchedParams.push(userId);
      }
      const unmatchedLogs = await pool.query(unmatchedLogsQuery, unmatchedParams);

      if (unmatchedLogs.rows.length > 0) {
        // Get all employees sorted by ID
        const employeesQuery = `
          SELECT e.id, e.full_name, u.username
          FROM employees e
          JOIN users u ON e.user_id = u.id
          WHERE 1=1 ${role !== 'super_admin' ? `AND e.admin_id = $1` : ''}
          ORDER BY e.id ASC
        `;
        const employeesParams = role !== 'super_admin' ? [userId] : [];
        const allEmployeesSorted = await pool.query(employeesQuery, employeesParams);

        // Get terminal IDs
        const terminalsQuery = `
          SELECT id, name FROM terminals
          ${role !== 'super_admin' ? `WHERE admin_id = $1` : ''}
        `;
        const terminalsResult = await pool.query(terminalsQuery, role !== 'super_admin' ? [userId] : []);
        const terminalMap = new Map();
        terminalsResult.rows.forEach(row => {
          terminalMap.set(row.name, row.id);
        });

        // Match each numeric employee_name with employees by position
        for (const log of unmatchedLogs.rows) {
          const numericIndex = parseInt(log.employee_name);
          const terminalId = terminalMap.get(log.terminal_name);

          if (!isNaN(numericIndex) && numericIndex > 0 && numericIndex <= allEmployeesSorted.rows.length && terminalId) {
            const matchedEmployee = allEmployeesSorted.rows[numericIndex - 1];

            // First, create/update employee_faces mapping
            // Get admin_id from employee (matchedEmployee should have admin_id from query)
            const empAdminResult = await pool.query(
              'SELECT admin_id FROM employees WHERE id = $1',
              [matchedEmployee.id]
            );
            const adminId = empAdminResult.rows.length > 0 ? empAdminResult.rows[0].admin_id : null;

            if (adminId) {
              await pool.query(
                `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id, admin_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (employee_id, terminal_id) 
                 DO UPDATE SET face_template_id = EXCLUDED.face_template_id, admin_id = EXCLUDED.admin_id`,
                [matchedEmployee.id, terminalId, log.employee_name, adminId]
              );
            }

            // Then update attendance_logs
            const updatePositionalQuery = `
              UPDATE attendance_logs
              SET employee_id = $1
              WHERE employee_id IS NULL
                AND employee_name = $2
                AND terminal_name = $3
                AND event_time >= $4 AND event_time < $5
            `;
            const updateResult = await pool.query(updatePositionalQuery, [
              matchedEmployee.id,
              log.employee_name,
              log.terminal_name,
              today,
              tomorrow
            ]);

            if (updateResult.rowCount > 0) {
              console.log(`✅ Positional match: "${log.employee_name}" -> employee_id=${matchedEmployee.id} (${matchedEmployee.full_name}), updated ${updateResult.rowCount} records`);
            }
          }
        }
      }
    } catch (positionalError) {
      console.error('Error in positional matching:', positionalError);
      // Continue even if positional matching fails
    }

    // Re-fetch logs after all updates
    try {
      const updatedLogsResult = await pool.query(logsQuery, logsParams);
      attendanceMap.clear();
      updatedLogsResult.rows.forEach(row => {
        const key = row.employee_id || row.employee_name;
        attendanceMap.set(key, {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          first_entry: row.first_entry,
          last_exit: row.last_exit,
          picture_url: row.picture_url
        });
      });
    } catch (refetchError) {
      console.error('Error re-fetching logs:', refetchError);
    }

    // Get usernames for employees to help with matching
    const employeesWithUsernames = await pool.query(
      `SELECT e.id, e.full_name, u.username
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE 1=1 ${role !== 'super_admin' ? `AND e.admin_id = $1` : ''}`,
      role !== 'super_admin' ? [userId] : []
    );
    const employeeUsernameMap = new Map();
    employeesWithUsernames.rows.forEach(row => {
      employeeUsernameMap.set(row.id, { full_name: row.full_name, username: row.username });
    });

    // Faqat bugun ishga keladigan hodimlarni hisobga olish (schedule bor)
    const employeesWithSchedule = allEmployees.filter(emp => scheduleMap.has(emp.id));

    employeesWithSchedule.forEach(emp => {
      let attendance = attendanceMap.get(emp.id);
      if (!attendance) {
        // Try to match by full_name, username, or id
        const empInfo = employeeUsernameMap.get(emp.id);
        for (const [key, value] of attendanceMap.entries()) {
          if (value.employee_name === emp.full_name ||
            (empInfo && value.employee_name === empInfo.username) ||
            value.employee_name === emp.id.toString()) {
            attendance = value;
            break;
          }
        }
      }

      const schedule = scheduleMap.get(emp.id);

      if (attendance && attendance.first_entry) {
        const entryTime = new Date(attendance.first_entry);
        const entryTimeStr = entryTime.toTimeString().split(' ')[0].substring(0, 5); // HH:mm format

        let isLate = false;
        let lateMinutes = 0;

        if (schedule && schedule.start_time) {
          const scheduleStart = schedule.start_time.substring(0, 5); // HH:mm format
          const entryDate = new Date(`2000-01-01T${entryTimeStr}:00`);
          const scheduleDate = new Date(`2000-01-01T${scheduleStart}:00`);
          const diffMs = entryDate.getTime() - scheduleDate.getTime();
          lateMinutes = Math.max(0, Math.floor(diffMs / 60000));
          isLate = lateMinutes > 0;
        }

        cameEmployees.push({
          ...emp,
          entry_time: attendance.first_entry,
          exit_time: attendance.last_exit,
          expected_start: schedule?.start_time || null,
          expected_end: schedule?.end_time || null,
          is_late: isLate,
          late_minutes: lateMinutes,
          picture_url: attendance.picture_url || null
        });
      } else {
        didNotComeEmployees.push({
          ...emp,
          expected_start: schedule?.start_time || null
        });
      }
    });

    cameEmployees.forEach(emp => {
      if (emp.is_late) {
        lateEmployees.push(emp);
      }
    });

    const allWorkSchedules = [];
    // Faqat bugun ishga keladigan hodimlar uchun schedule ma'lumotlarini qaytarish
    employeesWithSchedule.forEach(emp => {
      const schedule = scheduleMap.get(emp.id);
      allWorkSchedules.push({
        employee_id: emp.id,
        start_time: schedule?.start_time || null,
        end_time: schedule?.end_time || null,
        has_schedule: !!schedule
      });
    });

    res.json({
      success: true,
      date: today.toISOString().split('T')[0],
      total_employees: employeesWithSchedule.length, // Faqat bugun ishga keladigan hodimlar soni
      came: cameEmployees.length,
      did_not_come: didNotComeEmployees.length,
      late: lateEmployees.length,
      came_employees: cameEmployees,
      did_not_come_employees: didNotComeEmployees,
      late_employees: lateEmployees,
      work_schedules: allWorkSchedules
    });
  } catch (error) {
    console.error('Get today stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Statistikani olishda xatolik'
    });
  }
});

app.get('/api/attendance/employee/:id/daily', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { date } = req.query; // Date in YYYY-MM-DD format, defaults to today
    const { userId, role } = req.session;

    if (isNaN(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri hodim ID'
      });
    }

    let targetDate;
    let nextDate;
    if (date) {
      // Date string formatida kelsa (YYYY-MM-DD), uni PostgreSQL DATE formatida ishlatish
      // PostgreSQL DATE comparison uchun to'g'ridan-to'g'ri string yuboramiz
      targetDate = date; // 'YYYY-MM-DD' formatida
      // Keyingi kunning sana stringini olish
      const [year, month, day] = date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      dateObj.setDate(dateObj.getDate() + 1);
      const nextYear = dateObj.getFullYear();
      const nextMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
      const nextDay = String(dateObj.getDate()).padStart(2, '0');
      nextDate = `${nextYear}-${nextMonth}-${nextDay}`;
    } else {
      // Bugungi sana - mahalliy vaqt zonasida
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      targetDate = `${year}-${month}-${day}`;

      // Keyingi kunning sana stringini olish
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextYear = tomorrow.getFullYear();
      const nextMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const nextDay = String(tomorrow.getDate()).padStart(2, '0');
      nextDate = `${nextYear}-${nextMonth}-${nextDay}`;
    }

    let employeeQuery = 'SELECT id, full_name, position, admin_id FROM employees WHERE id = $1';
    let employeeParams = [employeeId];

    if (role !== 'super_admin') {
      employeeQuery += ' AND admin_id = $2';
      employeeParams.push(userId);
    }

    const employeeResult = await pool.query(employeeQuery, employeeParams);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    const employee = employeeResult.rows[0];

    let logsQuery = `
      SELECT 
        al.id,
        al.employee_id,
        al.employee_name,
        al.terminal_name,
        al.event_time,
        al.event_type,
        al.verification_mode,
        al.serial_no,
        al.picture_url,
        COALESCE(t.location, '')::VARCHAR as terminal_location
       FROM attendance_logs al
       LEFT JOIN terminals t ON t.name = al.terminal_name
       WHERE (al.employee_id = $1 OR al.employee_name = $2)
         AND DATE(al.event_time AT TIME ZONE 'Asia/Tashkent') >= $3::DATE
         AND DATE(al.event_time AT TIME ZONE 'Asia/Tashkent') < $4::DATE
    `;
    let logsParams = [employeeId, employee.full_name, targetDate, nextDate];

    if (role !== 'super_admin') {
      logsQuery += ` AND al.admin_id = $5`;
      logsParams.push(userId);
    }

    logsQuery += ` ORDER BY al.event_time ASC`;

    const logsResult = await pool.query(logsQuery, logsParams);

    const events = logsResult.rows.map(row => ({
      id: row.id,
      event_time: row.event_time,
      terminal_name: row.terminal_name,
      terminal_location: row.terminal_location,
      verification_mode: row.verification_mode,
      serial_no: row.serial_no,
      picture_url: row.picture_url,
      event_type: row.event_type || (new Date(row.event_time).getHours() < 14 ? 'entry' : 'exit') // Use stored event_type, fallback to time-based
    }));

    res.json({
      success: true,
      employee: employee,
      date: targetDate, // targetDate allaqachon 'YYYY-MM-DD' formatida string
      events: events,
      total_events: events.length
    });
  } catch (error) {
    console.error('Get employee daily attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Hodimning keldi-ketdi yozuvlarini olishda xatolik'
    });
  }
});

// ============================================
// HIKVISION EVENT ENDPOINT - QAYTA YOZILGAN
// ============================================
// Soddalashtirilgan va ishonchli versiya
// Faqat asosiy formatlarni qo'llab-quvvatlaydi:
// - JSON (multipart/form-data ichida)
// - AccessControllerEvent format
// ============================================

// Webhook uchun rate limiting
const webhookRequests = new Map();
const WEBHOOK_RATE_LIMIT = 100; // daqiqasiga maksimal so'rovlar soni
const WEBHOOK_RATE_WINDOW = 60 * 1000; // 1 daqiqa

function checkWebhookRateLimit(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const now = Date.now();

  if (!webhookRequests.has(clientIp)) {
    webhookRequests.set(clientIp, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW });
    return next();
  }

  const record = webhookRequests.get(clientIp);
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + WEBHOOK_RATE_WINDOW;
    return next();
  }

  if (record.count >= WEBHOOK_RATE_LIMIT) {
    console.warn(`⚠️  Webhook rate limit oshib ketdi: ${clientIp}`);
    return res.status(429).json({
      success: false,
      message: 'Juda ko\'p so\'rovlar. Iltimos, keyinroq qayta urinib ko\'ring.'
    });
  }

  record.count++;
  next();
}

// IP whitelist (ixtiyoriy - .env faylida sozlash mumkin)
const ALLOWED_WEBHOOK_IPS = process.env.WEBHOOK_ALLOWED_IPS
  ? process.env.WEBHOOK_ALLOWED_IPS.split(',').map(ip => ip.trim())
  : [];

function checkWebhookIP(req, res, next) {
  if (ALLOWED_WEBHOOK_IPS.length === 0) {
    return next(); // IP whitelist sozlanmagan bo'lsa, barcha IP'larni qabul qiladi
  }

  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  if (!ALLOWED_WEBHOOK_IPS.includes(clientIp)) {
    console.warn(`⚠️  Webhook so'rovi ruxsatsiz IP'dan: ${clientIp}`);
    return res.status(403).json({
      success: false,
      message: 'Ruxsat berilmagan'
    });
  }

  next();
}

// Hikvision event endpoint uchun maxsus CORS (terminal webhook'lar uchun barcha origin'larni ruxsat berish)
app.post('/api/hikvision/event', cors({
  origin: true, // Barcha origin'larni ruxsat berish (terminal webhook'lar uchun)
  credentials: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Content-Length', 'Accept', 'Authorization']
}), checkWebhookIP, checkWebhookRateLimit, upload.any(), async (req, res) => {
  try {
    // Initialize eventType at the very beginning to avoid temporal dead zone issues
    let eventType = null;
    let eventTypeSource = null;

    console.log('📥 HIKVISION EVENT KELDI');
    console.log('==========================================');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', req.body ? Object.keys(req.body) : 'null');
    console.log('Body sample:', req.body ? JSON.stringify(req.body).substring(0, 500) : 'null');
    console.log('Files:', req.files ? req.files.length : 0);
    if (req.files && req.files.length > 0) {
      console.log('Files details:', req.files.map(f => ({ fieldname: f.fieldname, filename: f.filename, size: f.size })));
    }
    console.log('==========================================');

    const contentType = req.headers['content-type'] || '';

    // 1. HeartBeat eventlarini darhol o'tkazib yuborish
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      if (bodyStr.includes('"eventType":"heartBeat"') || bodyStr.includes('"eventDescription":"heartBeat"')) {
        return res.status(200).send('OK (HeartBeat)');
      }
    }

    // 2. Event ma'lumotlarini extract qilish
    let eventData = null;
    let displayName = null; // Terminal'dan kelgan hodim nomi

    // Multipart/form-data formatida kelgan ma'lumotlar
    if (contentType.includes('multipart/form-data')) {
      // Form field'lardan JSON ma'lumotlarni qidirish
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string') {
          // HeartBeat tekshiruvi (parse qilishdan oldin)
          if (value.includes('"eventType":"heartBeat"') ||
            value.includes('"eventDescription":"heartBeat"') ||
            value.includes('"eventType":\t"heartBeat"') ||
            value.includes('"eventDescription":\t"heartBeat"')) {
            console.log('ℹ️  HeartBeat event o\'tkazib yuborildi (multipart/form-data)');
            return res.status(200).send('OK (HeartBeat)');
          }

          // JSON parse qilish
          if (value.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(value);
              if (parsed.eventType === 'heartBeat' || parsed.eventDescription === 'heartBeat') {
                console.log('ℹ️  HeartBeat event o\'tkazib yuborildi (parsed JSON)');
                return res.status(200).send('OK (HeartBeat)');
              }
              eventData = parsed;
              break;
            } catch (e) {
              // JSON emas, davom etish
            }
          }
        }
      }

      // Agar hech narsa topilmasa, barcha field'larni object sifatida qabul qilish
      if (!eventData && req.body && typeof req.body === 'object') {
        eventData = req.body;
      }
    } else {
      // Oddiy JSON format
      eventData = req.body;
    }

    if (!eventData) {
      return res.status(200).send('OK (No data)');
    }

    // 3. AccessControllerEvent formatini parse qilish
    let employeeNoString = null;
    let deviceName = null;
    let ipAddress = null;
    let eventTime = null;
    let verifyMode = null;
    let serialNo = null;
    let pictureURL = null;
    let direction = null;
    // eventType and eventTypeSource are already declared at the top of the try block

    // AccessControllerEvent formatini tekshirish
    if (eventData.AccessControllerEvent) {
      let ac = null;
      let parsedEventData = eventData;

      // Agar AccessControllerEvent string bo'lsa, uni parse qilish
      if (typeof eventData.AccessControllerEvent === 'string') {
        try {
          parsedEventData = JSON.parse(eventData.AccessControllerEvent);
          ac = parsedEventData.AccessControllerEvent || parsedEventData;
        } catch (parseError) {
          ac = {};
          parsedEventData = eventData;
        }
      } else if (typeof eventData.AccessControllerEvent === 'object') {
        ac = eventData.AccessControllerEvent;
        parsedEventData = eventData;
      } else {
        ac = {};
        parsedEventData = eventData;
      }

      // Agar ac bo'sh bo'lsa, parsedEventData ni tekshirish
      if (!ac || Object.keys(ac).length === 0) {
        ac = parsedEventData;
      }

      // Metadata eventlarni o'tkazib yuborish
      if (!ac.employeeNoString && !ac.employeeNo && !ac.name) {
        return res.status(200).send('OK (Metadata event)');
      }

      // Hodim nomini olish (terminaldagi name maydoni)
      if (ac.name && typeof ac.name === 'string' && ac.name.trim().length > 0) {
        displayName = ac.name.trim();
      } else if (parsedEventData.name && typeof parsedEventData.name === 'string' && parsedEventData.name.trim().length > 0) {
        displayName = parsedEventData.name.trim();
      }

      ipAddress = parsedEventData.ipAddress || null;
      deviceName = parsedEventData.deviceID || parsedEventData.deviceName || ac.deviceName || null;
      employeeNoString = ac.employeeNoString || ac.employeeNo || ac.name || null;
      eventTime = parsedEventData.dateTime || ac.dateTime || ac.time || null;
      verifyMode = ac.currentVerifyMode || ac.verifyMode || parsedEventData.verifyMode || null;
      serialNo = (ac.serialNo !== undefined && ac.serialNo !== null) ? String(ac.serialNo) : (parsedEventData.shortSerialNumber || null);
      direction = ac.direction || parsedEventData.direction || null;

      // subEventType yoki minorCode ni olish (75 = entry, 76 = exit)
      const acSubEventType = ac.subEventType || parsedEventData.subEventType || null;
      const acMinorCode = ac.minorCode || parsedEventData.minorCode || parsedEventData.minor || null;

      // Debug: subEventType/minorCode ni ko'rsatish
      if (acSubEventType !== null || acMinorCode !== null) {
        console.log(`📋 AccessControllerEvent subEventType/minorCode: subEventType=${acSubEventType}, minorCode=${acMinorCode}`);
      }

      // Event type'ni subEventType/minorCode orqali aniqlash (eng ishonchli)
      if (acSubEventType === 75 || acMinorCode === 75) {
        eventType = 'entry';
        eventTypeSource = 'subEventType/minorCode=75';
      } else if (acSubEventType === 76 || acMinorCode === 76) {
        eventType = 'exit';
        eventTypeSource = 'subEventType/minorCode=76';
      }
    } else if (eventData.employeeNoString || eventData.deviceName) {
      // To'g'ridan-to'g'ri field'lar
      employeeNoString = eventData.employeeNoString || eventData.employeeNo || eventData.employee_id;
      deviceName = eventData.deviceName || eventData.deviceID || eventData.terminal_name || eventData.terminal_id;
      direction = eventData.direction || eventData.event_direction;
      eventTime = eventData.time || eventData.event_time || eventData.timestamp || eventData.dateTime;
      verifyMode = eventData.verifyMode || eventData.verification_mode;
      serialNo = eventData.serialNo || eventData.serial_no || eventData.event_id;
      pictureURL = eventData.pictureURL || eventData.picture_url || eventData.image_url;
      ipAddress = eventData.ipAddress || null;
      if (typeof eventData.name === 'string' && eventData.name.trim().length > 0) {
        displayName = eventData.name.trim();
      }
    }

    // Multipart orqali rasm kelgan bo'lsa
    if ((!pictureURL || pictureURL === null) && Array.isArray(req.files) && req.files.length > 0) {
      const pic = req.files.find(f => (f.fieldname || '').toLowerCase().includes('picture')) || req.files[0];
      if (pic?.filename) {
        pictureURL = `/uploads/logos/${pic.filename}`;
      }
    }

    // Event type'ni aniqlash (kirish/chiqish)
    // eventType va eventTypeSource allaqachon e'lon qilingan
    // Agar AccessControllerEvent ichida aniqlanmagan bo'lsa, boshqa usullarni sinab ko'ramiz

    // 1. Agar hali aniqlanmagan bo'lsa, eventData dan to'g'ridan-to'g'ri qidirish
    if (!eventType) {
      const subEventType = eventData.subEventType || (eventData.AccessControllerEvent && typeof eventData.AccessControllerEvent === 'object' ? eventData.AccessControllerEvent.subEventType : null);
      const minorCode = eventData.minorCode || eventData.minor || (eventData.AccessControllerEvent && typeof eventData.AccessControllerEvent === 'object' ? eventData.AccessControllerEvent.minorCode : null);

      if (subEventType === 75 || minorCode === 75) {
        eventType = 'entry';
        eventTypeSource = 'eventData.subEventType/minorCode=75';
      } else if (subEventType === 76 || minorCode === 76) {
        eventType = 'exit';
        eventTypeSource = 'eventData.subEventType/minorCode=76';
      }
    }

    // 2. Direction orqali (1 = entry, 0 = exit)
    if (!eventType) {
      if (direction === '1' || direction === 1 || direction === 'in' || direction === 'entry') {
        eventType = 'entry';
        eventTypeSource = 'direction=1/in';
      } else if (direction === '0' || direction === 0 || direction === 'out' || direction === 'exit') {
        eventType = 'exit';
        eventTypeSource = 'direction=0/out';
      }
    }

    // 3. Parsed event data ichidan tekshirish (agar hali aniqlanmagan bo'lsa)
    if (!eventType && eventData.AccessControllerEvent) {
      let ac = null;
      if (typeof eventData.AccessControllerEvent === 'string') {
        try {
          const parsed = JSON.parse(eventData.AccessControllerEvent);
          ac = parsed.AccessControllerEvent || parsed;
          console.log(`📋 Parsed AccessControllerEvent keys: ${Object.keys(ac).join(', ')}`);
          console.log(`📋 Parsed AccessControllerEvent subEventType: ${ac.subEventType}, minorCode: ${ac.minorCode}`);
        } catch (e) {
          console.warn('⚠️  AccessControllerEvent parse qilishda xatolik:', e.message);
          ac = {};
        }
      } else {
        ac = eventData.AccessControllerEvent;
      }

      if (ac && (ac.subEventType === 75 || ac.minorCode === 75)) {
        eventType = 'entry';
        eventTypeSource = 'AccessControllerEvent.subEventType/minorCode=75';
      } else if (ac && (ac.subEventType === 76 || ac.minorCode === 76)) {
        eventType = 'exit';
        eventTypeSource = 'AccessControllerEvent.subEventType/minorCode=76';
      }
    }

    // 4. Terminalni topish
    if (!employeeNoString || (!deviceName && !ipAddress)) {
      console.warn('⚠️  Event ma\'lumotlari to\'liq emas:', { employeeNoString, deviceName, ipAddress });
      return res.status(200).send('OK (Incomplete data)');
    }

    let terminalResult;
    // Avval IP orqali topish (eng ishonchli)
    if (ipAddress) {
      terminalResult = await pool.query(
        'SELECT id, name, admin_id, terminal_type, ip_address FROM terminals WHERE ip_address = $1 AND is_active = true',
        [ipAddress]
      );
      if (terminalResult.rows.length > 0) {
        console.log(`✅ Terminal topildi (IP): ${terminalResult.rows[0].name} (${ipAddress})`);
      }
    }

    // Agar IP orqali topilmasa, deviceName orqali topish
    if (!terminalResult || terminalResult.rows.length === 0) {
      if (deviceName) {
        terminalResult = await pool.query(
          'SELECT id, name, admin_id, terminal_type, ip_address FROM terminals WHERE name = $1 AND is_active = true',
          [deviceName]
        );
        if (terminalResult.rows.length > 0) {
          console.log(`✅ Terminal topildi (name): ${terminalResult.rows[0].name}`);
        }
      }
    }

    // Agar hali ham topilmasa, IP orqali faol bo'lmagan terminallarni ham qidirish
    if (!terminalResult || terminalResult.rows.length === 0) {
      if (ipAddress) {
        terminalResult = await pool.query(
          'SELECT id, name, admin_id, terminal_type, ip_address FROM terminals WHERE ip_address = $1',
          [ipAddress]
        );
        if (terminalResult.rows.length > 0) {
          console.warn(`⚠️  Terminal topildi, lekin faol emas: ${terminalResult.rows[0].name} (${ipAddress})`);
        }
      }
    }

    if (!terminalResult || terminalResult.rows.length === 0) {
      console.error(`❌ Terminal topilmadi: IP=${ipAddress}, deviceName=${deviceName}`);
      console.error('💡 Terminalni database\'ga qo\'shing yoki terminal HTTP webhook sozlamalarini tekshiring');
      return res.status(200).send('OK (Terminal not found)');
    }

    const terminal = terminalResult.rows[0];
    const terminalId = terminal.id;
    const terminalName = terminal.name;
    const adminId = terminal.admin_id;
    const terminalType = terminal.terminal_type;

    // MUHIM: Terminal turi asosiy - terminal turiga qarab barcha eventlar o'sha turda yuritiladi
    // Agar terminal turi "kirish" bo'lsa, barcha eventlar "kirish" deb yuritiladi
    // Agar terminal turi "chiqish" bo'lsa, barcha eventlar "chiqish" deb yuritiladi
    if (terminalType === 'entry') {
      // Terminal turi "kirish" bo'lsa, barcha eventlar "kirish" deb yuritiladi
      eventType = 'entry';
      if (eventTypeSource && !eventTypeSource.includes('terminal_type')) {
        console.log(`🔄 Terminal "${terminalName}" turi "entry" - event type "${eventTypeSource}" -> "entry" ga o'zgartirildi (terminal turi asosiy)`);
      }
      eventTypeSource = 'terminal_type=entry (asosiy)';
    } else if (terminalType === 'exit') {
      // Terminal turi "chiqish" bo'lsa, barcha eventlar "chiqish" deb yuritiladi
      eventType = 'exit';
      if (eventTypeSource && !eventTypeSource.includes('terminal_type')) {
        console.log(`🔄 Terminal "${terminalName}" turi "exit" - event type "${eventTypeSource}" -> "exit" ga o'zgartirildi (terminal turi asosiy)`);
      }
      eventTypeSource = 'terminal_type=exit (asosiy)';
    } else if (!eventType) {
      // Agar terminal type ham yo'q bo'lsa, vaqtga qarab aniqlash (fallback)
      const eventTimeObj = eventTime ? new Date(eventTime) : new Date();
      const hours = eventTimeObj.getHours();
      eventType = hours < 14 ? 'entry' : 'exit';
      eventTypeSource = eventTypeSource || `time-based (${hours}:00 ${hours < 14 ? '<' : '>='} 14:00)`;
    }

    // Debug log
    if (eventTypeSource) {
      console.log(`📋 Event type aniqlandi: ${eventType} (${eventTypeSource})`);
    }

    // 5. Employee'ni topish yoki yaratish
    let employeeId = null;
    let employeeName = displayName || null;

    // 5.1. employee_faces orqali topish (asosiy usul)
    const empResult = await pool.query(
      `SELECT e.id, e.full_name, u.username 
       FROM employees e
       JOIN users u ON e.user_id = u.id
       JOIN employee_faces ef ON e.id = ef.employee_id
       WHERE ef.face_template_id = $1 
         AND ef.terminal_id = $2 
         AND e.admin_id = $3
         AND ef.admin_id = $3
       LIMIT 1`,
      [employeeNoString, terminalId, adminId]
    );

    if (empResult.rows.length > 0) {
      employeeId = empResult.rows[0].id;
      employeeName = empResult.rows[0].full_name || empResult.rows[0].username;
    } else {
      // 5.2. Agar employee topilmasa va displayName mavjud bo'lsa, avtomatik yaratish
      if (displayName && displayName.trim().length > 0 && displayName !== 'Noma\'lum' && !displayName.includes('Noma')) {
        try {
          // Employee mavjudligini tekshirish (name orqali)
          const existingCheck = await pool.query(
            `SELECT id FROM employees 
             WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND admin_id = $2
             LIMIT 1`,
            [displayName, adminId]
          );

          if (existingCheck.rows.length > 0) {
            employeeId = existingCheck.rows[0].id;
            employeeName = displayName;

            // employee_faces mapping yaratish
            await pool.query(
              `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id, admin_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (employee_id, terminal_id) 
               DO UPDATE SET face_template_id = EXCLUDED.face_template_id, admin_id = EXCLUDED.admin_id`,
              [employeeId, terminalId, employeeNoString, adminId]
            );
          } else {
            // Yangi employee yaratish
            const client = await pool.connect();
            try {
              await client.query('BEGIN');

              // Username yaratish
              const baseUsername = `employee_${displayName.replace(/\s+/g, '_').toLowerCase()}`;
              let finalUsername = baseUsername;
              let counter = 1;
              while (true) {
                const userCheck = await client.query(
                  'SELECT id FROM users WHERE username = $1',
                  [finalUsername]
                );
                if (userCheck.rows.length === 0) {
                  break;
                }
                finalUsername = `${baseUsername}_${counter}`;
                counter++;
              }

              // User yaratish
              const userResult = await client.query(
                'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
                [finalUsername, '$2b$10$dummy', 'employee', true]
              );

              const newUserId = userResult.rows[0].id;

              // Employee yaratish
              const empResult = await client.query(
                `INSERT INTO employees (user_id, admin_id, full_name, position) 
                 VALUES ($1, $2, $3, $4) 
                 RETURNING id`,
                [newUserId, adminId, displayName, 'Terminal foydalanuvchisi']
              );

              employeeId = empResult.rows[0].id;
              employeeName = displayName;

              // employee_faces mapping yaratish
              await client.query(
                `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id, admin_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (employee_id, terminal_id) 
                 DO UPDATE SET face_template_id = EXCLUDED.face_template_id, admin_id = EXCLUDED.admin_id`,
                [employeeId, terminalId, employeeNoString, adminId]
              );

              await client.query('COMMIT');
              console.log(`✅ Yangi employee yaratildi: "${displayName}", employee_id=${employeeId}`);
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          }
        } catch (error) {
          console.error(`❌ Employee yaratishda xatolik ("${displayName}"):`, error.message);
        }
      }
    }

    // 6. Event time'ni parse qilish
    let parsedEventTime = new Date();
    if (eventTime) {
      try {
        parsedEventTime = new Date(eventTime);
        if (isNaN(parsedEventTime.getTime())) {
          const customDate = eventTime.replace(/[T ]/, ' ').trim();
          parsedEventTime = new Date(customDate);
          if (isNaN(parsedEventTime.getTime())) {
            parsedEventTime = new Date();
          }
        }
        // 3 soat qo'shish
        parsedEventTime = new Date(parsedEventTime.getTime() + 3 * 60 * 60 * 1000);
      } catch (timeError) {
        parsedEventTime = new Date();
      }
    }

    // 7. Serial number
    const finalSerialNo = serialNo || `hikvision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 8. Duplicate tekshirish
    // 8.1. Serial number + terminal + admin
    if (finalSerialNo) {
      const duplicateCheck1 = await pool.query(
        `SELECT id FROM attendance_logs 
         WHERE serial_no = $1 
           AND terminal_name = $2 
           AND admin_id = $3
         LIMIT 1`,
        [finalSerialNo, terminalName, adminId]
      );

      if (duplicateCheck1.rows.length > 0) {
        return res.status(200).send('OK (Duplicate)');
      }
    }

    // 8.2. Employee + Terminal + Event Type + Vaqt (3 soniya ichida)
    const finalEmployeeName = employeeName || displayName || `Employee ${employeeNoString}`;
    if (employeeId && eventType) {
      const duplicateCheck2 = await pool.query(
        `SELECT id FROM attendance_logs 
         WHERE employee_id = $1
           AND terminal_name = $2
           AND admin_id = $3
           AND event_type = $4
           AND ABS(EXTRACT(EPOCH FROM (event_time - $5::timestamp))) <= 3
         LIMIT 1`,
        [employeeId, terminalName, adminId, eventType, parsedEventTime]
      );

      if (duplicateCheck2.rows.length > 0) {
        return res.status(200).send('OK (Duplicate)');
      }
    }

    // 8.3. Employee Name + Terminal + Event Type + Vaqt (3 soniya ichida)
    if (eventType) {
      const duplicateCheck3 = await pool.query(
        `SELECT id FROM attendance_logs 
         WHERE employee_name = $1
           AND terminal_name = $2
           AND admin_id = $3
           AND event_type = $4
           AND ABS(EXTRACT(EPOCH FROM (event_time - $5::timestamp))) <= 3
         LIMIT 1`,
        [finalEmployeeName, terminalName, adminId, eventType, parsedEventTime]
      );

      if (duplicateCheck3.rows.length > 0) {
        return res.status(200).send('OK (Duplicate)');
      }
    }

    // 9. Event saqlash
    const insertResult = await pool.query(
      `INSERT INTO attendance_logs 
       (employee_id, employee_name, terminal_name, event_time, event_type, verification_mode, serial_no, picture_url, admin_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING id`,
      [
        employeeId,
        finalEmployeeName,
        terminalName,
        parsedEventTime,
        eventType,
        verifyMode || null,
        finalSerialNo,
        pictureURL || null,
        adminId
      ]
    );

    console.log('✅ Hikvision event saqlandi:', {
      id: insertResult.rows[0].id,
      employeeId: employeeId || 'NULL',
      employee: finalEmployeeName,
      terminal: terminalName,
      eventType: eventType,
      time: parsedEventTime,
      serialNo: finalSerialNo
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Hikvision event error:', error);
    res.status(500).send('Error');
  }
});

// /api/attendance/webhook endpoint o'chirildi - /api/hikvision/event ishlatiladi

app.post('/api/attendance', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id, terminal_id, event_type, event_time, verification_mode } = req.body;
    const { userId, role } = req.session;

    if (!employee_id || !terminal_id || !event_type) {
      return res.status(400).json({
        success: false,
        message: 'Hodim, terminal va voqea turi kiritishingiz kerak'
      });
    }

    if (!['entry', 'exit'].includes(event_type)) {
      return res.status(400).json({
        success: false,
        message: 'Voqea turi "entry" yoki "exit" bo\'lishi kerak'
      });
    }

    const employeeCheck = await pool.query(
      'SELECT id, admin_id, full_name FROM employees WHERE id = $1',
      [employee_id]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizning yozuvlarini yaratishingiz mumkin'
      });
    }

    const terminalCheck = await pool.query(
      'SELECT name FROM terminals WHERE id = $1',
      [terminal_id]
    );

    if (terminalCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Terminal topilmadi'
      });
    }

    const terminalName = terminalCheck.rows[0].name;
    const employeeName = employeeCheck.rows[0].full_name;
    const adminId = employeeCheck.rows[0].admin_id;
    const serialNo = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = await pool.query(
      `INSERT INTO attendance_logs 
       (employee_id, employee_name, terminal_name, event_time, verification_mode, serial_no, admin_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, employee_id, employee_name, terminal_name, event_time, verification_mode, created_at`,
      [
        employee_id,
        employeeName,
        terminalName,
        event_time || new Date(),
        verification_mode || null,
        serialNo,
        adminId
      ]
    );

    res.json({
      success: true,
      message: 'Keldi-ketdi yozuvi muvaffaqiyatli qo\'shildi',
      record: result.rows[0]
    });
  } catch (error) {
    console.error('Create attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Keldi-ketdi yozuvini yaratishda xatolik'
    });
  }
});

// Proxy endpoint for Hikvision terminal images (to avoid CORS issues)
app.get('/api/attendance/image-proxy', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ success: false, message: 'URL talab qilinadi' });
    }

    // Extract path from URL
    let imagePath = url;

    // Remove @WEB... suffix if present
    if (imagePath.includes('@')) {
      imagePath = imagePath.split('@')[0];
    }

    // Extract path from full URL
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      try {
        const urlObj = new URL(imagePath);
        imagePath = urlObj.pathname;
        const terminalIp = urlObj.hostname;

        // Find terminal by IP
        const terminalResult = await pool.query(
          'SELECT * FROM terminals WHERE ip_address = $1 AND is_active = true',
          [terminalIp]
        );

        if (terminalResult.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Terminal topilmadi' });
        }

        const terminal = terminalResult.rows[0];
        const HikvisionISAPIService = require('./services/hikvision-isapi');
        const service = new HikvisionISAPIService(terminal);

        // Download image temporarily
        const tempPath = path.join(__dirname, 'public', 'uploads', 'faces', `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
        const downloadResult = await service.downloadImage(imagePath, tempPath);

        if (downloadResult.success) {
          // Send image file
          res.sendFile(tempPath, (err) => {
            // Clean up temp file after sending
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
            if (err) {
              console.error('Error sending image:', err);
            }
          });
        } else {
          res.status(404).json({ success: false, message: 'Rasm yuklab olinmadi' });
        }
      } catch (error) {
        console.error('Image proxy error:', error);
        res.status(500).json({ success: false, message: 'Rasm yuklab olinmadi' });
      }
    } else {
      res.status(400).json({ success: false, message: 'Noto\'g\'ri URL format' });
    }
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ success: false, message: 'Xatolik: ' + error.message });
  }
});

// Download and save existing face images from URLs
app.post('/api/attendance/download-images', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { limit = 100, terminal_id } = req.body;

    // Get attendance logs with HTTP URLs that haven't been downloaded yet
    let query = `
      SELECT al.id, al.picture_url, al.terminal_name, al.serial_no, t.id as terminal_id, t.ip_address, t.username, t.password
      FROM attendance_logs al
      LEFT JOIN terminals t ON t.name = al.terminal_name
      WHERE al.picture_url IS NOT NULL 
        AND (al.picture_url LIKE 'http://%' OR al.picture_url LIKE 'https://%')
        AND al.picture_url NOT LIKE '/uploads/faces/%'
    `;

    const params = [];
    let paramIndex = 1;

    if (role !== 'super_admin') {
      query += ` AND al.admin_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (terminal_id) {
      query += ` AND t.id = $${paramIndex++}`;
      params.push(parseInt(terminal_id));
    }

    query += ` ORDER BY al.event_time DESC LIMIT $${paramIndex++}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    const logs = result.rows;

    if (logs.length === 0) {
      return res.json({
        success: true,
        message: 'Yuklab olish kerak bo\'lgan rasm topilmadi',
        downloaded: 0,
        failed: 0,
        skipped: 0
      });
    }

    console.log(`📥 ${logs.length} ta rasm yuklab olinmoqda...`);

    const facesDir = path.join(__dirname, 'public', 'uploads', 'faces');
    if (!fs.existsSync(facesDir)) {
      fs.mkdirSync(facesDir, { recursive: true });
    }

    let downloaded = 0;
    let failed = 0;
    let skipped = 0;

    for (const log of logs) {
      try {
        if (!log.terminal_id || !log.ip_address) {
          console.warn(`⚠️  Terminal ma'lumotlari yo'q (log ID: ${log.id}), o'tkazib yuborildi`);
          skipped++;
          continue;
        }

        // Extract path from URL
        let imagePath = log.picture_url;

        // Remove @WEB... suffix if present
        if (imagePath.includes('@')) {
          imagePath = imagePath.split('@')[0];
        }

        // Extract path from full URL
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
          try {
            const url = new URL(imagePath);
            imagePath = url.pathname;
          } catch (e) {
            // If URL parsing fails, try to extract path manually
            const match = imagePath.match(/\/LOCALS\/[^@]+/);
            if (match) {
              imagePath = match[0];
            } else {
              console.warn(`⚠️  Path ajratib bo'lmadi (log ID: ${log.id}): ${log.picture_url}`);
              failed++;
              continue;
            }
          }
        }

        if (!imagePath || !imagePath.startsWith('/')) {
          console.warn(`⚠️  Noto'g'ri path format (log ID: ${log.id}): ${imagePath}`);
          failed++;
          continue;
        }

        // Create terminal config for download
        const terminalConfig = {
          id: log.terminal_id,
          ip_address: log.ip_address,
          username: log.username || 'admin',
          password: log.password || 'admin12345',
          name: log.terminal_name
        };

        const HikvisionISAPIService = require('./services/hikvision-isapi');
        const service = new HikvisionISAPIService(terminalConfig);

        // Generate unique filename
        const timestamp = Date.now();
        const serialNo = log.serial_no || 'unknown';
        const ext = path.extname(imagePath) || '.jpg';
        const filename = `face_${log.terminal_id}_${serialNo}_${timestamp}${ext}`;
        const savePath = path.join(facesDir, filename);

        console.log(`📥 Downloading: ${imagePath} -> ${filename}`);

        // Download image
        const downloadResult = await service.downloadImage(imagePath, savePath);

        if (downloadResult.success) {
          // Update database with local path
          const localPath = `/uploads/faces/${filename}`;
          await pool.query(
            'UPDATE attendance_logs SET picture_url = $1 WHERE id = $2',
            [localPath, log.id]
          );
          downloaded++;
          console.log(`✅ Downloaded and updated: ${localPath}`);
        } else {
          console.warn(`⚠️  Failed to download (log ID: ${log.id}): ${downloadResult.error}`);
          failed++;
        }
      } catch (error) {
        console.error(`❌ Error processing log ID ${log.id}:`, error.message);
        failed++;
      }
    }

    res.json({
      success: true,
      message: `Yuklab olish tugadi: ${downloaded} ta muvaffaqiyatli, ${failed} ta xatolik, ${skipped} ta o'tkazib yuborildi`,
      downloaded: downloaded,
      failed: failed,
      skipped: skipped,
      total: logs.length
    });
  } catch (error) {
    console.error('Download images error:', error);
    res.status(500).json({
      success: false,
      message: 'Rasmlarni yuklab olishda xatolik: ' + error.message
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/employee-login', (req, res) => {
  res.redirect('/');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/employee-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'employee-dashboard.html'));
});

// Hikvision Manager - faqat manual sync uchun (admin panel orqali)
// Auto-initialization o'chirilgan - terminallar webhook orqali event yuboradi
let hikvisionManager = null;
try {
  hikvisionManager = require('./hikvision-integration');
  console.log('✅ Hikvision Manager yuklandi (faqat manual sync uchun)');
} catch (error) {
  console.warn('⚠️  Hikvision Manager yuklanmadi:', error.message);
}


// KPI Endpoints
app.get('/api/kpi', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, period_date, kpi_date } = req.query;

    let query = `
      SELECT 
        k.id,
        k.employee_id,
        k.score,
        k.amount,
        k.kpi_date,
        k.reason,
        k.period_type,
        k.period_date,
        k.created_at,
        e.full_name,
        e.position
      FROM kpi_records k
      JOIN employees e ON k.employee_id = e.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (role !== 'super_admin') {
      query += ` AND e.admin_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (employee_id) {
      query += ` AND k.employee_id = $${paramIndex++}`;
      params.push(parseInt(employee_id));
    }

    if (period_type && ['daily', 'weekly', 'monthly'].includes(period_type)) {
      query += ` AND k.period_type = $${paramIndex++}`;
      params.push(period_type);
    }

    if (period_date) {
      query += ` AND k.period_date = $${paramIndex++}`;
      params.push(period_date);
    }

    query += ` ORDER BY k.period_date DESC, k.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      kpi: result.rows
    });
  } catch (error) {
    console.error('Get KPI error:', error);
    res.status(500).json({
      success: false,
      message: 'KPI ma\'lumotlarini olishda xatolik'
    });
  }
});

// Penalties Endpoints
app.get('/api/penalties', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, period_date, penalty_date } = req.query;

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

    // Pagination qo'shish - default limit 100 (xavfsizlik uchun parameterize qilindi)
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      penalties: result.rows
    });
  } catch (error) {
    console.error('Get penalties error:', error);
    res.status(500).json({
      success: false,
      message: 'Jarimalarni olishda xatolik'
    });
  }
});

// Bonuses Endpoints
app.get('/api/bonuses', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { userId, role } = req.session;
    const { period_type, employee_id, period_date, bonus_date } = req.query;

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

    query += ` ORDER BY b.period_date DESC, b.created_at DESC`;

    // Pagination qo'shish - default limit 100 (xavfsizlik uchun parameterize qilindi)
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      bonuses: result.rows
    });
  } catch (error) {
    console.error('Get bonuses error:', error);
    res.status(500).json({
      success: false,
      message: 'Bonuslarni olishda xatolik'
    });
  }
});

// Manual Bonus Creation
app.post('/api/bonuses', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id, amount, bonus_date, reason, period_type, period_date } = req.body;
    const { userId, role } = req.session;

    if (!employee_id || !amount || !bonus_date || !period_type || !period_date) {
      return res.status(400).json({
        success: false,
        message: 'Hodim, summa, sana va davr turi kiritishingiz kerak'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Summa musbat son bo\'lishi kerak'
      });
    }

    const employeeCheck = await pool.query(
      'SELECT id, admin_id FROM employees WHERE id = $1',
      [employee_id]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizga bonus berishingiz mumkin'
      });
    }

    const result = await pool.query(
      `INSERT INTO bonuses (employee_id, amount, bonus_date, reason, period_type, period_date, admin_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, employee_id, amount, bonus_date, reason, period_type, period_date, created_at`,
      [
        employee_id,
        parseFloat(amount),
        bonus_date,
        reason || null,
        period_type,
        period_date,
        employeeCheck.rows[0].admin_id,
        userId
      ]
    );

    res.json({
      success: true,
      bonus: result.rows[0],
      message: 'Bonus muvaffaqiyatli qo\'shildi'
    });
  } catch (error) {
    console.error('Add bonus error:', error);
    res.status(500).json({
      success: false,
      message: 'Bonus qo\'shishda xatolik'
    });
  }
});

// Manual Penalty Creation
app.post('/api/penalties', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id, amount, penalty_date, reason, period_type, period_date } = req.body;
    const { userId, role } = req.session;

    if (!employee_id || !amount || !penalty_date || !period_type || !period_date) {
      return res.status(400).json({
        success: false,
        message: 'Hodim, summa, sana va davr turi kiritishingiz kerak'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Summa musbat son bo\'lishi kerak'
      });
    }

    const employeeCheck = await pool.query(
      'SELECT id, admin_id FROM employees WHERE id = $1',
      [employee_id]
    );

    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hodim topilmadi'
      });
    }

    if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Siz faqat o\'z hodimlaringizga jarima berishingiz mumkin'
      });
    }

    const result = await pool.query(
      `INSERT INTO penalties (employee_id, amount, penalty_date, reason, period_type, period_date, admin_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, employee_id, amount, penalty_date, reason, period_type, period_date, created_at`,
      [
        employee_id,
        parseFloat(amount),
        penalty_date,
        reason || null,
        period_type,
        period_date,
        employeeCheck.rows[0].admin_id,
        userId
      ]
    );

    res.json({
      success: true,
      penalty: result.rows[0],
      message: 'Jarima muvaffaqiyatli qo\'shildi'
    });
  } catch (error) {
    console.error('Add penalty error:', error);
    res.status(500).json({
      success: false,
      message: 'Jarima qo\'shishda xatolik'
    });
  }
});

// Update Bonus
app.put('/api/bonuses/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  console.log('PUT /api/bonuses/:id called with id:', req.params.id);
  console.log('Request body:', req.body);
  try {
    const bonusId = parseInt(req.params.id);
    const { employee_id, amount, bonus_date, reason, period_type, period_date } = req.body;
    const { userId, role } = req.session;

    if (isNaN(bonusId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri bonus ID'
      });
    }

    let checkQuery = `
      SELECT b.id, e.admin_id 
      FROM bonuses b
      JOIN employees e ON b.employee_id = e.id
      WHERE b.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [bonusId, userId] : [bonusId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bonus topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    // If employee_id is being updated, check if new employee exists and user has access
    if (employee_id !== undefined) {
      const employeeCheck = await pool.query(
        'SELECT id, admin_id FROM employees WHERE id = $1',
        [employee_id]
      );

      if (employeeCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Hodim topilmadi'
        });
      }

      if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Siz faqat o\'z hodimlaringizga bonus berishingiz mumkin'
        });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (employee_id !== undefined) {
      updateFields.push(`employee_id = $${paramIndex++}`);
      updateValues.push(parseInt(employee_id));
    }

    if (amount !== undefined) {
      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Summa musbat son bo\'lishi kerak'
        });
      }
      updateFields.push(`amount = $${paramIndex++}`);
      updateValues.push(parseFloat(amount));
    }

    if (bonus_date !== undefined) {
      updateFields.push(`bonus_date = $${paramIndex++}`);
      updateValues.push(bonus_date);
    }

    if (reason !== undefined) {
      updateFields.push(`reason = $${paramIndex++}`);
      updateValues.push(reason || null);
    }

    if (period_type !== undefined) {
      if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
        return res.status(400).json({
          success: false,
          message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
        });
      }
      updateFields.push(`period_type = $${paramIndex++}`);
      updateValues.push(period_type);
    }

    if (period_date !== undefined) {
      updateFields.push(`period_date = $${paramIndex++}`);
      updateValues.push(period_date);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateValues.push(bonusId);
    const updateQuery = `
      UPDATE bonuses 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, employee_id, amount, bonus_date, reason, period_type, period_date, created_at
    `;

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      bonus: result.rows[0],
      message: 'Bonus muvaffaqiyatli yangilandi'
    });
  } catch (error) {
    console.error('Update bonus error:', error);
    res.status(500).json({
      success: false,
      message: 'Bonusni yangilashda xatolik'
    });
  }
});

// Delete Bonus
app.delete('/api/bonuses/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const bonusId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(bonusId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri bonus ID'
      });
    }

    let checkQuery = `
      SELECT b.id, e.admin_id 
      FROM bonuses b
      JOIN employees e ON b.employee_id = e.id
      WHERE b.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [bonusId, userId] : [bonusId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bonus topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM bonuses WHERE id = $1', [bonusId]);

    res.json({
      success: true,
      message: 'Bonus muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete bonus error:', error);
    res.status(500).json({
      success: false,
      message: 'Bonusni o\'chirishda xatolik'
    });
  }
});

// Update Penalty
app.put('/api/penalties/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const penaltyId = parseInt(req.params.id);
    const { employee_id, amount, penalty_date, reason, period_type, period_date } = req.body;
    const { userId, role } = req.session;

    if (isNaN(penaltyId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri jarima ID'
      });
    }

    let checkQuery = `
      SELECT p.id, e.admin_id 
      FROM penalties p
      JOIN employees e ON p.employee_id = e.id
      WHERE p.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [penaltyId, userId] : [penaltyId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jarima topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    // If employee_id is being updated, check if new employee exists and user has access
    if (employee_id !== undefined) {
      const employeeCheck = await pool.query(
        'SELECT id, admin_id FROM employees WHERE id = $1',
        [employee_id]
      );

      if (employeeCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Hodim topilmadi'
        });
      }

      if (role !== 'super_admin' && employeeCheck.rows[0].admin_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Siz faqat o\'z hodimlaringizga jarima berishingiz mumkin'
        });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (employee_id !== undefined) {
      updateFields.push(`employee_id = $${paramIndex++}`);
      updateValues.push(parseInt(employee_id));
    }

    if (amount !== undefined) {
      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Summa musbat son bo\'lishi kerak'
        });
      }
      updateFields.push(`amount = $${paramIndex++}`);
      updateValues.push(parseFloat(amount));
    }

    if (penalty_date !== undefined) {
      updateFields.push(`penalty_date = $${paramIndex++}`);
      updateValues.push(penalty_date);
    }

    if (reason !== undefined) {
      updateFields.push(`reason = $${paramIndex++}`);
      updateValues.push(reason || null);
    }

    if (period_type !== undefined) {
      if (!['daily', 'weekly', 'monthly'].includes(period_type)) {
        return res.status(400).json({
          success: false,
          message: 'Davr turi kunlik, haftalik yoki oylik bo\'lishi kerak'
        });
      }
      updateFields.push(`period_type = $${paramIndex++}`);
      updateValues.push(period_type);
    }

    if (period_date !== undefined) {
      updateFields.push(`period_date = $${paramIndex++}`);
      updateValues.push(period_date);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yangilash uchun ma\'lumot kiritishingiz kerak'
      });
    }

    updateValues.push(penaltyId);
    const updateQuery = `
      UPDATE penalties 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, employee_id, amount, penalty_date, reason, period_type, period_date, created_at
    `;

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      penalty: result.rows[0],
      message: 'Jarima muvaffaqiyatli yangilandi'
    });
  } catch (error) {
    console.error('Update penalty error:', error);
    res.status(500).json({
      success: false,
      message: 'Jarimani yangilashda xatolik'
    });
  }
});

// Delete Penalty
app.delete('/api/penalties/:id', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const penaltyId = parseInt(req.params.id);
    const { userId, role } = req.session;

    if (isNaN(penaltyId)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri jarima ID'
      });
    }

    let checkQuery = `
      SELECT p.id, e.admin_id 
      FROM penalties p
      JOIN employees e ON p.employee_id = e.id
      WHERE p.id = $1
    `;

    if (role !== 'super_admin') {
      checkQuery += ` AND e.admin_id = $2`;
    }

    const checkParams = role !== 'super_admin' ? [penaltyId, userId] : [penaltyId];
    const checkResult = await pool.query(checkQuery, checkParams);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jarima topilmadi yoki ruxsatingiz yo\'q'
      });
    }

    await pool.query('DELETE FROM penalties WHERE id = $1', [penaltyId]);

    res.json({
      success: true,
      message: 'Jarima muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    console.error('Delete penalty error:', error);
    res.status(500).json({
      success: false,
      message: 'Jarimani o\'chirishda xatolik'
    });
  }
});

// Employee Salary Report Endpoint
app.get('/api/employees/salary-report', requireAuth, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { employee_id } = req.query;
    const { userId, role } = req.session;

    // Get employees
    let employeesQuery = `
      SELECT 
        e.id,
        e.full_name,
        e.position,
        e.admin_id,
        u.username
      FROM employees e
      JOIN users u ON e.user_id = u.id
      WHERE 1=1
    `;
    const employeesParams = [];

    if (role !== 'super_admin') {
      employeesQuery += ` AND e.admin_id = $1`;
      employeesParams.push(userId);
    }

    if (employee_id) {
      employeesQuery += ` AND e.id = $${employeesParams.length + 1}`;
      employeesParams.push(parseInt(employee_id));
    }

    employeesQuery += ` ORDER BY e.full_name`;

    const employeesResult = await pool.query(employeesQuery, employeesParams);

    // Get detailed data for each employee
    const reportData = [];

    for (const emp of employeesResult.rows) {
      // Get salaries
      const salariesQuery = `
        SELECT 
          s.amount,
          s.period_type,
          s.period_date,
          s.work_position,
          s.notes
        FROM salaries s
        WHERE s.employee_id = $1
        ORDER BY s.period_date DESC, s.created_at DESC
      `;
      const salariesResult = await pool.query(salariesQuery, [emp.id]);

      // Get bonuses
      const bonusesQuery = `
        SELECT 
          b.amount,
          b.bonus_date,
          b.period_type,
          b.period_date,
          b.reason
        FROM bonuses b
        WHERE b.employee_id = $1
        ORDER BY b.period_date DESC, b.created_at DESC
      `;
      const bonusesResult = await pool.query(bonusesQuery, [emp.id]);

      // Get penalties
      const penaltiesQuery = `
        SELECT 
          p.amount,
          p.penalty_date,
          p.period_type,
          p.period_date,
          p.reason
        FROM penalties p
        WHERE p.employee_id = $1
        ORDER BY p.period_date DESC, p.created_at DESC
      `;
      const penaltiesResult = await pool.query(penaltiesQuery, [emp.id]);

      // Get attendance data for work hours calculation
      const attendanceQuery = `
        SELECT 
          al.event_time,
          al.event_type,
          ws.start_time,
          ws.end_time,
          ws.day_of_week
        FROM attendance_logs al
        LEFT JOIN work_schedules ws ON al.employee_id = ws.employee_id 
          AND EXTRACT(DOW FROM al.event_time) = ws.day_of_week
        WHERE al.employee_id = $1
          AND al.event_time >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY al.event_time DESC
      `;
      const attendanceResult = await pool.query(attendanceQuery, [emp.id]);

      // Calculate work hours and late minutes
      let totalWorkHours = 0;
      let totalLateMinutes = 0;
      const attendanceMap = new Map();

      attendanceResult.rows.forEach(log => {
        const date = new Date(log.event_time).toISOString().split('T')[0];
        if (!attendanceMap.has(date)) {
          attendanceMap.set(date, { entry: null, exit: null, start_time: log.start_time });
        }
        const dayData = attendanceMap.get(date);
        if (log.event_type === 'entry') {
          dayData.entry = new Date(log.event_time);
        } else if (log.event_type === 'exit') {
          dayData.exit = new Date(log.event_time);
        }
      });

      attendanceMap.forEach((dayData, date) => {
        if (dayData.entry && dayData.exit) {
          const workMs = dayData.exit - dayData.entry;
          const workHours = workMs / (1000 * 60 * 60);
          totalWorkHours += workHours;

          // Calculate late minutes
          if (dayData.start_time && dayData.entry) {
            const startTime = new Date(`${date}T${dayData.start_time}`);
            const entryTime = dayData.entry;
            if (entryTime > startTime) {
              const lateMs = entryTime - startTime;
              const lateMinutes = lateMs / (1000 * 60);
              totalLateMinutes += lateMinutes;
            }
          }
        }
      });

      // Calculate totals
      const totalSalary = salariesResult.rows.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
      const totalBonus = bonusesResult.rows.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
      const totalPenalty = penaltiesResult.rows.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
      const netAmount = totalSalary + totalBonus - totalPenalty;

      reportData.push({
        employee_id: emp.id,
        full_name: emp.full_name,
        username: emp.username,
        position: emp.position,
        total_work_hours: Math.round(totalWorkHours * 100) / 100,
        total_late_minutes: Math.round(totalLateMinutes),
        total_salary: totalSalary,
        total_bonus: totalBonus,
        total_penalty: totalPenalty,
        net_amount: netAmount,
        salaries: salariesResult.rows,
        bonuses: bonusesResult.rows,
        penalties: penaltiesResult.rows
      });
    }

    res.json({
      success: true,
      report: reportData
    });
  } catch (error) {
    console.error('Get salary report error:', error);
    res.status(500).json({
      success: false,
      message: 'Hisobotni olishda xatolik'
    });
  }
});

// Error handling middleware (barcha route'lardan keyin, 404 handler'dan oldin)
app.use((err, req, res, next) => {
  console.error('Xatolik:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress
  });

  // Ichki xatolik tafsilotlarini client'ga ko'rsatmaslik
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode === 500
    ? (process.env.NODE_ENV === 'production'
      ? 'Server xatosi. Iltimos, keyinroq qayta urinib ko\'ring.'
      : err.message)
    : err.message;

  res.status(statusCode).json({
    success: false,
    message: message
  });
});

// 404 handler - barcha route'lardan keyin
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint topilmadi'
  });
});

const server = app.listen(PORT, async () => {
  console.log(`✅ Server ${PORT} portda ishlamoqda`);
  console.log(`🌐 http://localhost:${PORT} manzilini oching`);
  if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Production mode');
  } else {
    console.log('🔧 Development mode');
  }

  // Hikvision Manager auto-initialization o'chirilgan
  // VPS arxitekturasida terminallar webhook orqali event yuboradi
  // Server terminalni chaqirmaydi, terminal o'zi serverga event yuboradi
  console.log('ℹ️  Hikvision Manager auto-initialization o\'chirilgan');
  console.log('ℹ️  Terminallar HTTP webhook orqali event yuboradi: /api/hikvision/event');
  console.log('ℹ️  Manual sync admin panel orqali mavjud');

  // CORS origins'ni dastlabki yuklash
  await updateCorsOrigins();

  // CORS origins'ni har 5 daqiqada yangilash (yangi terminal qo'shilganda yoki IP o'zgarganda)
  setInterval(async () => {
    await updateCorsOrigins();
  }, CORS_CACHE_TTL);

  // Server ishga tushganda terminaldan o'tgan eventlarni avtomatik yuklab olish
  // Agar server ishlamay qolgan bo'lsa, lekin terminal ishlayotgan bo'lsa
  setTimeout(async () => {
    try {
      console.log('🔄 Server ishga tushganda terminaldan missing eventlarni yuklab olish boshlanmoqda...');

      // Database ulanishini tekshirish
      try {
        await pool.query('SELECT 1');
      } catch (dbError) {
        console.error('❌ Database ulanish xatolik, missing events sync o\'tkazib yuborildi:', dbError.message);
        return;
      }

      // Barcha faol terminallarni olish
      let terminalsResult;
      try {
        terminalsResult = await pool.query(
          'SELECT * FROM terminals WHERE is_active = true ORDER BY id'
        );
      } catch (queryError) {
        console.error('❌ Terminallarni olishda xatolik:', queryError.message);
        return;
      }

      const terminals = terminalsResult.rows;

      if (terminals.length === 0) {
        console.log('ℹ️  Faol terminallar topilmadi');
        return;
      }

      console.log(`📡 ${terminals.length} ta faol terminal topildi`);

      // AttendanceSyncService yaratish
      let AttendanceSyncService;
      let syncService;
      try {
        AttendanceSyncService = require('./services/attendance-sync');
        syncService = new AttendanceSyncService(pool);
      } catch (requireError) {
        console.error('❌ AttendanceSyncService yuklashda xatolik:', requireError.message);
        console.error('   Stack:', requireError.stack);
        return;
      }

      // Barcha terminallardan missing eventlarni yuklab olish
      let syncResult;
      try {
        syncResult = await syncService.syncAllMissingEvents(terminals);
      } catch (syncError) {
        console.error('❌ syncAllMissingEvents xatolik:', syncError.message);
        console.error('   Stack:', syncError.stack);
        return;
      }

      if (syncResult) {
        console.log('✅ Missing events sync tugadi:');
        console.log(`   Jami saqlandi: ${syncResult.totalSaved || 0} ta`);
        console.log(`   Jami duplikat: ${syncResult.totalDuplicates || 0} ta`);
        console.log(`   Jami xatolar: ${syncResult.totalErrors || 0} ta`);

        if (syncResult.totalSaved > 0) {
          console.log(`🎉 ${syncResult.totalSaved} ta yangi event yuklab olindi!`);
        }
      }
    } catch (error) {
      console.error('❌ Missing events sync umumiy xatolik:', error.message);
      console.error('   Stack:', error.stack);
      // Xatolik bo'lsa ham server ishlashda davom etadi
    }
  }, 5000); // 5 soniyadan keyin ishga tushadi (server to'liq yuklangandan keyin)
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

