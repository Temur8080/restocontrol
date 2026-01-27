// Terminal ulanish muammolarini aniqlash va tuzatish
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function checkDatabaseTables() {
  console.log('============================================');
  console.log('Database Jadval Tekshirish');
  console.log('============================================\n');

  try {
    // Terminals jadvalini tekshirish
    console.log('1. Terminals jadvalini tekshirish...');
    const terminalsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'terminals'
      );
    `);

    if (!terminalsCheck.rows[0].exists) {
      console.log('❌ Terminals jadvali mavjud emas!');
      console.log('   Migration'ni ishga tushiring: npm run migrate');
      return false;
    }
    console.log('✅ Terminals jadvali mavjud');

    // Attendance_logs jadvalini tekshirish
    console.log('\n2. Attendance_logs jadvalini tekshirish...');
    const logsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'attendance_logs'
      );
    `);

    if (!logsCheck.rows[0].exists) {
      console.log('❌ Attendance_logs jadvali mavjud emas!');
      console.log('   Migration'ni ishga tushiring: npm run migrate');
      return false;
    }
    console.log('✅ Attendance_logs jadvali mavjud');

    // Terminallar ro'yxatini olish
    console.log('\n3. Terminallar ro'yxati...');
    const terminals = await pool.query(`
      SELECT id, name, ip_address, username, is_active, password IS NOT NULL as has_password
      FROM terminals
      ORDER BY id
    `);

    if (terminals.rows.length === 0) {
      console.log('⚠️  Database'da terminallar yo'q!');
      console.log('   Terminal qo'shish kerak');
      return false;
    }

    console.log(`✅ ${terminals.rows.length} ta terminal topildi:\n`);
    terminals.rows.forEach(term => {
      console.log(`   - ${term.name} (ID: ${term.id})`);
      console.log(`     IP: ${term.ip_address}`);
      console.log(`     Username: ${term.username || 'N/A'}`);
      console.log(`     Password: ${term.has_password ? '✅ Mavjud' : '❌ Yo\'q'}`);
      console.log(`     Status: ${term.is_active ? '✅ Faol' : '❌ Nofaol'}`);
      console.log('');
    });

    return true;
  } catch (error) {
    console.error('❌ Database xatosi:', error.message);
    if (error.code === '42P01') {
      console.error('   Jadval topilmadi! Migration\'ni ishga tushiring.');
    }
    return false;
  }
}

async function testTerminalConnection(terminal) {
  console.log(`\n📡 ${terminal.name} terminalini tekshirish...`);
  console.log(`   IP: ${terminal.ip_address}`);

  // Network ping
  const http = require('http');
  const url = require('url');

  return new Promise((resolve) => {
    const timeout = 5000;
    const startTime = Date.now();

    const req = http.get(`http://${terminal.ip_address}`, { 
      timeout: timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      const duration = Date.now() - startTime;
      console.log(`   ✅ Network ulanishi mavjud (${duration}ms, Status: ${res.statusCode})`);
      resolve({ success: true, network: true });
    });

    req.on('error', (err) => {
      console.log(`   ❌ Network ulanishi yo'q: ${err.message}`);
      resolve({ success: false, network: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`   ❌ Network timeout (${timeout}ms)`);
      resolve({ success: false, network: false, error: 'Timeout' });
    });
  });
}

async function checkTerminalConfig() {
  console.log('\n============================================');
  console.log('Terminal Konfiguratsiya Tekshirish');
  console.log('============================================\n');

  try {
    const terminals = await pool.query(`
      SELECT id, name, ip_address, username, password, is_active
      FROM terminals
      WHERE is_active = true
      ORDER BY id
    `);

    if (terminals.rows.length === 0) {
      console.log('⚠️  Faol terminallar topilmadi!');
      return;
    }

    console.log(`${terminals.rows.length} ta faol terminal topildi\n`);

    for (const terminal of terminals.rows) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Terminal: ${terminal.name} (ID: ${terminal.id})`);
      console.log(`${'='.repeat(50)}`);

      // IP manzil tekshirish
      if (!terminal.ip_address || terminal.ip_address.trim() === '') {
        console.log('❌ IP manzil kiritilmagan!');
        continue;
      }

      // Username tekshirish
      if (!terminal.username || terminal.username.trim() === '') {
        console.log('⚠️  Username kiritilmagan (default: admin ishlatiladi)');
      }

      // Password tekshirish
      if (!terminal.password || terminal.password.trim() === '') {
        console.log('❌ Password kiritilmagan!');
        console.log('   Terminal bilan aloqa qilish uchun password kerak!');
        continue;
      }

      // Network test
      const networkTest = await testTerminalConnection(terminal);

      if (!networkTest.network) {
        console.log('\n💡 Yechimlar:');
        console.log('   1. Terminal quvvatlanganligini tekshiring');
        console.log('   2. Network kabel ulanmaganligini tekshiring');
        console.log('   3. IP manzil to\'g\'riligini tekshiring');
        console.log('   4. Firewall ping\'ga ruxsat berilganligini tekshiring');
        continue;
      }

      // Hikvision ISAPI test
      console.log('\n   🔄 Hikvision ISAPI ulanishi tekshirilmoqda...');
      try {
        const HikvisionISAPIService = require('./services/hikvision-isapi');
        const service = new HikvisionISAPIService({
          id: terminal.id,
          name: terminal.name,
          ip_address: terminal.ip_address,
          username: terminal.username || 'admin',
          password: terminal.password
        });

        // Test connection
        const testResult = await service.getUsersAndFaces();
        
        if (testResult.success) {
          console.log(`   ✅ Hikvision ISAPI ulanishi muvaffaqiyatli`);
          if (testResult.users) {
            console.log(`   📊 Terminal'da ${testResult.users.length} ta foydalanuvchi topildi`);
          }
        } else {
          console.log(`   ❌ Hikvision ISAPI xatosi: ${testResult.error || 'Noma\'lum xatolik'}`);
          console.log('\n💡 Yechimlar:');
          console.log('   1. Username va password to\'g\'riligini tekshiring');
          console.log('   2. Terminal\'da ISAPI yoqilganligini tekshiring');
          console.log('   3. Terminal\'da Digest Authentication yoqilganligini tekshiring');
        }
      } catch (apiError) {
        console.log(`   ❌ Hikvision ISAPI xatosi: ${apiError.message}`);
        console.log('\n💡 Yechimlar:');
        console.log('   1. Terminal konfiguratsiyasini tekshiring');
        console.log('   2. Network ulanishini tekshiring');
        console.log('   3. Terminal\'da ISAPI yoqilganligini tekshiring');
      }
    }

  } catch (error) {
    console.error('❌ Xatolik:', error.message);
  }
}

async function main() {
  console.log('🚀 Terminal Ulanish Muammolarini Tekshirish\n');

  // Database jadvallarni tekshirish
  const dbOk = await checkDatabaseTables();
  
  if (!dbOk) {
    console.log('\n❌ Database muammolari bor. Avval ularni tuzating.');
    await pool.end();
    return;
  }

  // Terminal konfiguratsiyasini tekshirish
  await checkTerminalConfig();

  // Oxirgi event'larni tekshirish
  console.log('\n============================================');
  console.log('Oxirgi Event\'lar');
  console.log('============================================\n');

  try {
    const eventsResult = await pool.query(`
      SELECT 
        t.name as terminal_name,
        COUNT(al.id) as event_count,
        MAX(al.event_time) as last_event_time,
        EXTRACT(EPOCH FROM (NOW() - MAX(al.event_time)))/60 as minutes_ago
      FROM terminals t
      LEFT JOIN attendance_logs al ON t.id = al.terminal_id
      WHERE t.is_active = true
      GROUP BY t.id, t.name
      ORDER BY t.id
    `);

    if (eventsResult.rows.length > 0) {
      eventsResult.rows.forEach(stat => {
        console.log(`${stat.terminal_name}:`);
        console.log(`   Event'lar soni: ${stat.event_count || 0}`);
        if (stat.last_event_time) {
          const minutesAgo = Math.floor(stat.minutes_ago);
          const status = minutesAgo < 5 ? '✅' : minutesAgo < 30 ? '⚠️' : '❌';
          console.log(`   Oxirgi event: ${status} ${minutesAgo} daqiqa oldin`);
          console.log(`   Vaqt: ${new Date(stat.last_event_time).toLocaleString()}`);
        } else {
          console.log(`   Oxirgi event: ❌ Hali yo'q`);
        }
        console.log('');
      });
    }
  } catch (error) {
    console.error('❌ Event\'larni olishda xatolik:', error.message);
  }

  console.log('============================================');
  console.log('✅ Tekshirish yakunlandi');
  console.log('============================================\n');

  await pool.end();
}

main().catch(console.error);
