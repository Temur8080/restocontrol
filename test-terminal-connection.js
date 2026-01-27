// Terminal aloqasini test qilish script
const { Pool } = require('pg');
const HikvisionISAPIService = require('./services/hikvision-isapi');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function testTerminalConnection() {
  console.log('============================================');
  console.log('Terminal Aloqasini Test Qilish');
  console.log('============================================\n');

  try {
    // 1. Database'dan terminallarni olish
    console.log('1. Database'dan terminallarni olish...');
    const result = await pool.query(
      'SELECT id, name, ip_address, username, password, is_active FROM terminals ORDER BY id'
    );

    if (result.rows.length === 0) {
      console.log('❌ Database'da terminallar topilmadi!');
      console.log('\n💡 Terminal qo'shish:');
      console.log('   - Admin panel → Terminallar → Yangi terminal qo'shish');
      await pool.end();
      return;
    }

    console.log(`✅ ${result.rows.length} ta terminal topildi\n`);

    // 2. Har bir terminalni test qilish
    for (const terminal of result.rows) {
      console.log(`\n📡 Terminal: ${terminal.name} (ID: ${terminal.id})`);
      console.log(`   IP: ${terminal.ip_address}`);
      console.log(`   Status: ${terminal.is_active ? '✅ Faol' : '❌ Nofaol'}`);

      if (!terminal.is_active) {
        console.log('   ⚠️  Terminal nofaol, test o'tkazilmaydi\n');
        continue;
      }

      // 3. Network connectivity test
      console.log('   🔄 Network connectivity tekshirilmoqda...');
      try {
        const http = require('http');
        const url = require('url');
        const terminalUrl = `http://${terminal.ip_address}`;
        
        await new Promise((resolve, reject) => {
          const req = http.get(terminalUrl, { timeout: 5000 }, (res) => {
            console.log(`   ✅ Network ulanishi mavjud (Status: ${res.statusCode})`);
            resolve();
          });
          
          req.on('error', (err) => {
            console.log(`   ❌ Network ulanishi yo'q: ${err.message}`);
            reject(err);
          });
          
          req.on('timeout', () => {
            req.destroy();
            console.log('   ❌ Network timeout (5 soniya)');
            reject(new Error('Timeout'));
          });
        });
      } catch (networkError) {
        console.log(`   ❌ Network xatosi: ${networkError.message}`);
        console.log('   💡 Tekshiring:');
        console.log('      - Terminal IP to\'g\'riligini');
        console.log('      - Terminal va server bir xil tarmoqda ekanligini');
        console.log('      - Firewall portlari ochiqligini');
        continue;
      }

      // 4. Hikvision ISAPI test
      console.log('   🔄 Hikvision ISAPI test qilinmoqda...');
      try {
        const service = new HikvisionISAPIService({
          ip_address: terminal.ip_address,
          username: terminal.username || 'admin',
          password: terminal.password || 'admin12345'
        });

        // Test connection
        const testResult = await service.getUsersAndFaces();
        
        if (testResult.success) {
          console.log(`   ✅ Hikvision ISAPI ulanishi muvaffaqiyatli`);
          console.log(`   📊 Terminal'da ${testResult.users?.length || 0} ta foydalanuvchi topildi`);
        } else {
          console.log(`   ❌ Hikvision ISAPI xatosi: ${testResult.error || 'Noma'lum xatolik'}`);
          console.log('   💡 Tekshiring:');
          console.log('      - Terminal username va password');
          console.log('      - Terminal ISAPI xizmati yoqilganligini');
        }
      } catch (apiError) {
        console.log(`   ❌ Hikvision ISAPI xatosi: ${apiError.message}`);
        console.log('   💡 Tekshiring:');
        console.log('      - Terminal autentifikatsiya ma\'lumotlari');
        console.log('      - Terminal ISAPI xizmati yoqilganligini');
        console.log('      - Terminal versiyasi (eski versiyalar ISAPI qo\'llab-quvvatlamasligi mumkin)');
      }
    }

    console.log('\n============================================');
    console.log('✅ Test yakunlandi');
    console.log('============================================\n');

  } catch (error) {
    console.error('\n❌ Xatolik:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Terminal IP va credentials bilan to'g'ridan-to'g'ri test
async function testDirectConnection(ip, username = 'admin', password = 'admin12345') {
  console.log('============================================');
  console.log('To\'g\'ridan-to\'g\'ri Terminal Test');
  console.log('============================================\n');
  console.log(`IP: ${ip}`);
  console.log(`Username: ${username}`);
  console.log(`Password: ${password ? '***' : 'not set'}\n`);

  try {
    const service = new HikvisionISAPIService({
      ip_address: ip,
      username: username,
      password: password
    });

    const result = await service.getUsersAndFaces();
    
    if (result.success) {
      console.log('✅ Terminal bilan aloqa muvaffaqiyatli!');
      console.log(`📊 Foydalanuvchilar soni: ${result.users?.length || 0}`);
    } else {
      console.log('❌ Terminal bilan aloqa xatosi:', result.error);
    }
  } catch (error) {
    console.error('❌ Xatolik:', error.message);
  }
}

// Command line argumentlar
const args = process.argv.slice(2);

if (args.length >= 1) {
  // To'g'ridan-to'g'ri test
  const ip = args[0];
  const username = args[1] || 'admin';
  const password = args[2] || 'admin12345';
  testDirectConnection(ip, username, password);
} else {
  // Database'dan terminallarni test qilish
  testTerminalConnection();
}
