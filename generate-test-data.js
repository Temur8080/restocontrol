require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const ADMIN_ID = 63;

// Test data
const positions = [
  { name: 'Dasturchi', description: 'Dasturiy ta\'minot ishlab chiqish' },
  { name: 'Dizayner', description: 'Grafik va veb dizayn' },
  { name: 'Marketing menejeri', description: 'Marketing strategiyasi va reklama' },
  { name: 'HR menejeri', description: 'Kadrlar bo\'limi' },
  { name: 'Muhandis', description: 'Texnik ishlar' },
  { name: 'Buxgalter', description: 'Moliya va hisob-kitob' },
  { name: 'Manager', description: 'Proyekt boshqaruvi' }
];

const employees = [
  { full_name: 'Ali Valiyev', position: 'Dasturchi', phone: '+998901234567', email: 'ali.valiyev@example.com', period_type: 'monthly' },
  { full_name: 'Hasan Hasanov', position: 'Dasturchi', phone: '+998901234568', email: 'hasan.hasanov@example.com', period_type: 'monthly' },
  { full_name: 'Dilshod Karimov', position: 'Dizayner', phone: '+998901234569', email: 'dilshod.karimov@example.com', period_type: 'weekly' },
  { full_name: 'Fotima Qodirova', position: 'Dizayner', phone: '+998901234570', email: 'fotima.qodirova@example.com', period_type: 'weekly' },
  { full_name: 'Sardor Toshmatov', position: 'Marketing menejeri', phone: '+998901234571', email: 'sardor.toshmatov@example.com', period_type: 'monthly' },
  { full_name: 'Gulnora Usmonova', position: 'HR menejeri', phone: '+998901234572', email: 'gulnora.usmonova@example.com', period_type: 'monthly' },
  { full_name: 'Javohir Rahimov', position: 'Muhandis', phone: '+998901234573', email: 'javohir.rahimov@example.com', period_type: 'daily' },
  { full_name: 'Nigora Akramova', position: 'Muhandis', phone: '+998901234574', email: 'nigora.akramova@example.com', period_type: 'daily' },
  { full_name: 'Bobur Ismoilov', position: 'Buxgalter', phone: '+998901234575', email: 'bobur.ismoilov@example.com', period_type: 'monthly' },
  { full_name: 'Malika Nurmatova', position: 'Buxgalter', phone: '+998901234576', email: 'malika.nurmatova@example.com', period_type: 'monthly' },
  { full_name: 'Shoxrux Yuldashev', position: 'Manager', phone: '+998901234577', email: 'shoxrux.yuldashev@example.com', period_type: 'monthly' },
  { full_name: 'Dilbar Abdurahimova', position: 'Manager', phone: '+998901234578', email: 'dilbar.abdurahimova@example.com', period_type: 'weekly' },
  { full_name: 'Temur Alimov', position: 'Dasturchi', phone: '+998901234579', email: 'temur.alimov@example.com', period_type: 'daily' },
  { full_name: 'Madina To\'rayeva', position: 'Dizayner', phone: '+998901234580', email: 'madina.torayeva@example.com', period_type: 'weekly' },
  { full_name: 'Jahongir Mamatov', position: 'Marketing menejeri', phone: '+998901234581', email: 'jahongir.mamatov@example.com', period_type: 'monthly' }
];

// Salary rates (ish haqqi stavkalari)
const salaryRates = {
  'daily': { 'Dasturchi': 150000, 'Dizayner': 120000, 'Marketing menejeri': 130000, 'HR menejeri': 110000, 'Muhandis': 100000, 'Buxgalter': 110000, 'Manager': 140000 },
  'weekly': { 'Dasturchi': 900000, 'Dizayner': 700000, 'Marketing menejeri': 750000, 'HR menejeri': 650000, 'Muhandis': 600000, 'Buxgalter': 650000, 'Manager': 850000 },
  'monthly': { 'Dasturchi': 3500000, 'Dizayner': 2800000, 'Marketing menejeri': 3000000, 'HR menejeri': 2500000, 'Muhandis': 2300000, 'Buxgalter': 2500000, 'Manager': 3300000 }
};

const terminals = [
  { name: 'Kirish terminali 1', ip_address: '192.168.1.100', terminal_type: 'entry', location: 'Asosiy kirish', username: 'admin', password: 'admin123' },
  { name: 'Chiqish terminali 1', ip_address: '192.168.1.101', terminal_type: 'exit', location: 'Asosiy chiqish', username: 'admin', password: 'admin123' },
  { name: 'Kirish terminali 2', ip_address: '192.168.1.102', terminal_type: 'entry', location: 'Orqa kirish', username: 'admin', password: 'admin123' }
];

async function generateTestData() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log(`📦 Admin ID ${ADMIN_ID} uchun test ma'lumotlari yaratilmoqda...`);
    
    // 1. Admin mavjudligini tekshirish
    const adminCheck = await client.query('SELECT id, username FROM users WHERE id = $1', [ADMIN_ID]);
    if (adminCheck.rows.length === 0) {
      throw new Error(`Admin ID ${ADMIN_ID} topilmadi! Avval admin yarating.`);
    }
    console.log(`✅ Admin topildi: ${adminCheck.rows[0].username}`);
    
    // 2. Lavozimlarni yaratish
    console.log('\n📋 Lavozimlar yaratilmoqda...');
    const createdPositions = {};
    for (const pos of positions) {
      try {
        const result = await client.query(
          `INSERT INTO positions (name, description, admin_id) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (name, admin_id) DO UPDATE SET description = EXCLUDED.description
           RETURNING id, name`,
          [pos.name, pos.description, ADMIN_ID]
        );
        createdPositions[pos.name] = result.rows[0].id;
        console.log(`  ✅ ${pos.name}`);
      } catch (error) {
        if (error.code !== '23505') { // Unique violation - already exists
          console.error(`  ❌ ${pos.name} xatolik:`, error.message);
        } else {
          const existing = await client.query('SELECT id FROM positions WHERE name = $1 AND admin_id = $2', [pos.name, ADMIN_ID]);
          createdPositions[pos.name] = existing.rows[0].id;
          console.log(`  ⚠️  ${pos.name} (mavjud)`);
        }
      }
    }
    
    // 3. Hodimlarni yaratish
    console.log('\n👥 Hodimlar yaratilmoqda...');
    const createdEmployees = [];
    const defaultPassword = await bcrypt.hash('1234', 10);
    
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      try {
        // Username yaratish
        const usernameBase = emp.full_name.toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
        let username = `${usernameBase}_${ADMIN_ID}`;
        let counter = 1;
        
        // Username unikalini tekshirish
        while (true) {
          const userCheck = await client.query('SELECT id FROM users WHERE username = $1', [username]);
          if (userCheck.rows.length === 0) break;
          username = `${usernameBase}_${ADMIN_ID}_${counter}`;
          counter++;
        }
        
        // User yaratish
        const userResult = await client.query(
          'INSERT INTO users (username, password, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
          [username, defaultPassword, 'employee', true]
        );
        
        const userId = userResult.rows[0].id;
        
        // Employee yaratish
        const empResult = await client.query(
          `INSERT INTO employees (user_id, admin_id, full_name, position, phone, email) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING id, full_name, position`,
          [userId, ADMIN_ID, emp.full_name, emp.position, emp.phone, emp.email]
        );
        
        createdEmployees.push({
          ...empResult.rows[0],
          username: username,
          period_type: emp.period_type
        });
        
        console.log(`  ✅ ${emp.full_name} (${emp.position}) - ${username}`);
      } catch (error) {
        console.error(`  ❌ ${emp.full_name} xatolik:`, error.message);
      }
    }
    
    // 4. Ish haqqi stavkalarini yaratish
    console.log('\n💰 Ish haqqi stavkalari yaratilmoqda...');
    for (const emp of createdEmployees) {
      const periodType = emp.period_type;
      const position = emp.position;
      const amount = salaryRates[periodType][position];
      
      if (amount) {
        try {
          await client.query(
            `INSERT INTO salary_rates (employee_id, position_name, amount, period_type, admin_id, created_by) 
             VALUES ($1, NULL, $2, $3, $4, $4)
             ON CONFLICT DO NOTHING`,
            [emp.id, amount, periodType, ADMIN_ID]
          );
          console.log(`  ✅ ${emp.full_name}: ${amount.toLocaleString()} so'm (${periodType === 'daily' ? 'Kunlik' : periodType === 'weekly' ? 'Haftalik' : 'Oylik'})`);
        } catch (error) {
          if (error.code !== '23505') {
            console.error(`  ❌ ${emp.full_name} ish haqqi xatolik:`, error.message);
          }
        }
      }
    }
    
    // Position bo'yicha ish haqqi stavkalari (qo'shimcha)
    console.log('\n📊 Lavozim bo\'yicha ish haqqi stavkalari yaratilmoqda...');
    for (const periodType of ['daily', 'weekly', 'monthly']) {
      for (const [position, amount] of Object.entries(salaryRates[periodType])) {
        try {
          await client.query(
            `INSERT INTO salary_rates (employee_id, position_name, amount, period_type, admin_id, created_by) 
             VALUES (NULL, $1, $2, $3, $4, $4)
             ON CONFLICT DO NOTHING`,
            [position, amount, periodType, ADMIN_ID]
          );
        } catch (error) {
          // Ignore conflicts
        }
      }
    }
    console.log('  ✅ Barcha lavozimlar uchun ish haqqi stavkalari qo\'shildi');
    
    // 5. Terminallarni yaratish
    console.log('\n🖥️  Terminallar yaratilmoqda...');
    const createdTerminals = [];
    for (const term of terminals) {
      try {
        const result = await client.query(
          `INSERT INTO terminals (name, ip_address, terminal_type, location, username, password, is_active, admin_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (ip_address) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location
           RETURNING id, name`,
          [term.name, term.ip_address, term.terminal_type, term.location, term.username, term.password, true, ADMIN_ID]
        );
        createdTerminals.push(result.rows[0]);
        console.log(`  ✅ ${term.name} (${term.ip_address})`);
      } catch (error) {
        if (error.code !== '23505') {
          console.error(`  ❌ ${term.name} xatolik:`, error.message);
        } else {
          const existing = await client.query('SELECT id, name FROM terminals WHERE ip_address = $1', [term.ip_address]);
          createdTerminals.push(existing.rows[0]);
          console.log(`  ⚠️  ${term.name} (mavjud)`);
        }
      }
    }
    
    // 6. Ish jadvalini yaratish (har bir hodim uchun)
    console.log('\n📅 Ish jadvallari yaratilmoqda...');
    for (const emp of createdEmployees) {
      // Dushanbadan Jumagacha (1-5)
      for (let day = 1; day <= 5; day++) {
        try {
          await client.query(
            `INSERT INTO work_schedules (employee_id, day_of_week, start_time, end_time, is_active, admin_id) 
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (employee_id, day_of_week) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
            [emp.id, day, '09:00:00', '18:00:00', true, ADMIN_ID]
          );
        } catch (error) {
          // Ignore conflicts
        }
      }
    }
    console.log(`  ✅ ${createdEmployees.length} ta hodim uchun ish jadvali yaratildi (Dushanba-Juma, 09:00-18:00)`);
    
    // 7. Attendance events yaratish (so'nggi 30 kun)
    console.log('\n📝 Attendance events yaratilmoqda...');
    const today = new Date();
    let eventCount = 0;
    
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const eventDate = new Date(today);
      eventDate.setDate(today.getDate() - dayOffset);
      
      // Faqat ish kunlari (Dushanba-Juma)
      const dayOfWeek = eventDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Yakshanba yoki Shanba
      
      for (const emp of createdEmployees) {
        // Kirish eventi (08:30 - 09:30 oralig'ida)
        const entryHour = 8 + Math.floor(Math.random() * 2); // 8 yoki 9
        const entryMinute = Math.floor(Math.random() * 60);
        const entryTime = new Date(eventDate);
        entryTime.setHours(entryHour, entryMinute, 0, 0);
        
        if (createdTerminals.length > 0) {
          const entryTerminals = createdTerminals.filter(t => t.name.includes('Kirish'));
          if (entryTerminals.length > 0) {
            const terminal = entryTerminals[Math.floor(Math.random() * entryTerminals.length)];
            try {
              const serialNo = `TEST_${emp.id}_${eventDate.getTime()}_ENTRY`;
              await client.query(
                `INSERT INTO attendance_logs (employee_id, employee_name, terminal_name, event_time, verification_mode, serial_no, event_type, admin_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (serial_no, terminal_name) DO NOTHING`,
                [emp.id, emp.full_name, terminal.name, entryTime, 'face', serialNo, 'entry', ADMIN_ID]
              );
              eventCount++;
            } catch (error) {
              // Ignore conflicts
            }
          }
        }
        
        // Chiqish eventi (17:30 - 19:00 oralig'ida) - 80% ehtimollik bilan
        if (Math.random() > 0.2 && createdTerminals.length > 1) {
          const exitHour = 17 + Math.floor(Math.random() * 2); // 17 yoki 18
          const exitMinute = Math.floor(Math.random() * 60);
          const exitTime = new Date(eventDate);
          exitTime.setHours(exitHour, exitMinute, 0, 0);
          
          const exitTerminals = createdTerminals.filter(t => t.name.includes('Chiqish'));
          if (exitTerminals.length > 0) {
            const terminal = exitTerminals[Math.floor(Math.random() * exitTerminals.length)];
            try {
              const serialNo = `TEST_${emp.id}_${eventDate.getTime()}_EXIT`;
              await client.query(
                `INSERT INTO attendance_logs (employee_id, employee_name, terminal_name, event_time, verification_mode, serial_no, event_type, admin_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (serial_no, terminal_name) DO NOTHING`,
                [emp.id, emp.full_name, terminal.name, exitTime, 'face', serialNo, 'exit', ADMIN_ID]
              );
              eventCount++;
            } catch (error) {
              // Ignore conflicts
            }
          }
        }
      }
    }
    console.log(`  ✅ ${eventCount} ta attendance event yaratildi (so'nggi 30 kun)`);
    
    // 8. Ba'zi maoshlar yaratish (so'nggi 3 oy)
    console.log('\n💵 Maoshlar yaratilmoqda...');
    let salaryCount = 0;
    
    for (const emp of createdEmployees) {
      const periodType = emp.period_type;
      
      // Har bir davr uchun 2-3 ta maosh yaratish
      const periods = periodType === 'daily' ? 10 : periodType === 'weekly' ? 4 : 3;
      
      for (let i = 0; i < periods; i++) {
        const periodDate = new Date(today);
        
        if (periodType === 'daily') {
          periodDate.setDate(today.getDate() - (i * 1));
        } else if (periodType === 'weekly') {
          periodDate.setDate(today.getDate() - (i * 7));
          // Haftaning birinchi kuniga o'tkazish (Dushanba)
          const dayOfWeek = periodDate.getDay();
          const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          periodDate.setDate(periodDate.getDate() + diff);
        } else { // monthly
          periodDate.setMonth(today.getMonth() - i);
          periodDate.setDate(1);
        }
        
        // Faqat ish kunlari
        if (periodDate > today) continue;
        
        const amount = salaryRates[periodType][emp.position];
        
        try {
          const result = await client.query(
            `INSERT INTO salaries (employee_id, amount, period_type, period_date, work_position, admin_id, created_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $6)
             RETURNING id`,
            [emp.id, amount, periodType, periodDate.toISOString().split('T')[0], emp.position, ADMIN_ID]
          );
          if (result.rows.length > 0) {
            salaryCount++;
          }
        } catch (error) {
          // Ignore conflicts (may already exist)
          if (error.code !== '23505') {
            // Only log non-conflict errors
            if (!error.message.includes('уникальности') && !error.message.includes('unique')) {
              console.error(`  ⚠️  ${emp.full_name} maosh xatolik:`, error.message);
            }
          }
        }
      }
    }
    console.log(`  ✅ ${salaryCount} ta maosh yaratildi`);
    
    await client.query('COMMIT');
    
    console.log('\n✨ Test ma\'lumotlari muvaffaqiyatli yaratildi!');
    console.log(`\n📊 Statistikalar:`);
    console.log(`   - Lavozimlar: ${positions.length}`);
    console.log(`   - Hodimlar: ${createdEmployees.length}`);
    console.log(`   - Terminallar: ${createdTerminals.length}`);
    console.log(`   - Attendance events: ${eventCount}`);
    console.log(`   - Maoshlar: ${salaryCount}`);
    console.log(`\n🔑 Barcha hodimlar paroli: 1234`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Xatolik yuz berdi:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

generateTestData()
  .then(() => {
    console.log('\n✅ Dastur yakunlandi');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Dastur xatolik bilan yakunlandi:', error);
    process.exit(1);
  });
