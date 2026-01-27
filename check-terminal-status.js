// Terminal status va ping tekshirish script
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

async function checkTerminalStatus() {
  console.log('============================================');
  console.log('Terminal Status va Ping Tekshirish');
  console.log('============================================\n');

  try {
    // 1. Database'dan terminallarni olish
    console.log('1. Database'dan terminallarni olish...');
    const terminalsResult = await pool.query(
      'SELECT id, name, ip_address, username, is_active, created_at FROM terminals ORDER BY id'
    );

    if (terminalsResult.rows.length === 0) {
      console.log('❌ Database'da terminallar topilmadi!');
      await pool.end();
      return;
    }

    console.log(`✅ ${terminalsResult.rows.length} ta terminal topildi\n`);

    // 2. Har bir terminalni tekshirish
    for (const terminal of terminalsResult.rows) {
      console.log(`\n📡 Terminal: ${terminal.name} (ID: ${terminal.id})`);
      console.log(`   IP: ${terminal.ip_address}`);
      console.log(`   Status: ${terminal.is_active ? '✅ Faol' : '❌ Nofaol'}`);

      if (!terminal.is_active) {
        console.log('   ⚠️  Terminal nofaol, test o'tkazilmaydi\n');
        continue;
      }

      // 3. Network ping test
      console.log('   🔄 Network ping tekshirilmoqda...');
      try {
        const http = require('http');
        const url = require('url');
        
        await new Promise((resolve, reject) => {
          const req = http.get(`http://${terminal.ip_address}`, { 
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0'
            }
          }, (res) => {
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
        continue;
      }

      // 4. Hikvision ISAPI test
      console.log('   🔄 Hikvision ISAPI ulanishi tekshirilmoqda...');
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
        }
      } catch (apiError) {
        console.log(`   ❌ Hikvision ISAPI xatosi: ${apiError.message}`);
      }

      // 5. Oxirgi event'larni tekshirish
      console.log('   🔄 Oxirgi event'lar tekshirilmoqda...');
      try {
        const eventsResult = await pool.query(
          `SELECT COUNT(*) as count, MAX(event_time) as last_event 
           FROM attendance_logs 
           WHERE terminal_id = $1`,
          [terminal.id]
        );
        
        if (eventsResult.rows.length > 0) {
          const count = parseInt(eventsResult.rows[0].count);
          const lastEvent = eventsResult.rows[0].last_event;
          console.log(`   📊 Database'da ${count} ta event mavjud`);
          if (lastEvent) {
            const lastEventDate = new Date(lastEvent);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastEventDate) / 1000 / 60);
            console.log(`   ⏰ Oxirgi event: ${diffMinutes} daqiqa oldin (${lastEventDate.toLocaleString()})`);
            
            if (diffMinutes > 60) {
              console.log(`   ⚠️  Oxirgi event 1 soatdan ko'p vaqt oldin!`);
            } else if (diffMinutes > 30) {
              console.log(`   ⚠️  Oxirgi event 30 daqiqadan ko'p vaqt oldin!`);
            } else {
              console.log(`   ✅ Event'lar yangi kelmoqda`);
            }
          } else {
            console.log(`   ⚠️  Hali event'lar yo'q`);
          }
        }
      } catch (dbError) {
        console.log(`   ❌ Database xatosi: ${dbError.message}`);
      }
    }

    // 6. Umumiy statistika
    console.log('\n============================================');
    console.log('Umumiy Statistika');
    console.log('============================================');
    
    const statsResult = await pool.query(`
      SELECT 
        t.id,
        t.name,
        COUNT(al.id) as event_count,
        MAX(al.event_time) as last_event_time
      FROM terminals t
      LEFT JOIN attendance_logs al ON t.id = al.terminal_id
      WHERE t.is_active = true
      GROUP BY t.id, t.name
      ORDER BY t.id
    `);
    
    if (statsResult.rows.length > 0) {
      console.log('\n📊 Faol Terminallar Statistikasi:\n');
      statsResult.rows.forEach(stat => {
        console.log(`   ${stat.name}:`);
        console.log(`      Event'lar soni: ${stat.event_count || 0}`);
        if (stat.last_event_time) {
          const lastEvent = new Date(stat.last_event_time);
          const now = new Date();
          const diffMinutes = Math.floor((now - lastEvent) / 1000 / 60);
          console.log(`      Oxirgi event: ${diffMinutes} daqiqa oldin`);
        } else {
          console.log(`      Oxirgi event: Hali yo'q`);
        }
        console.log('');
      });
    }

    console.log('============================================');
    console.log('✅ Tekshirish yakunlandi');
    console.log('============================================\n');

  } catch (error) {
    console.error('\n❌ Xatolik:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Real-time monitoring
async function monitorTerminals() {
  console.log('============================================');
  console.log('Terminal Real-time Monitoring');
  console.log('============================================\n');
  console.log('Monitoring ishga tushmoqda... (Ctrl+C bilan to\'xtatish)\n');

  const checkInterval = setInterval(async () => {
    const now = new Date();
    console.log(`\n[${now.toLocaleTimeString()}] Tekshirilmoqda...`);
    
    try {
      const result = await pool.query(`
        SELECT 
          t.id,
          t.name,
          t.ip_address,
          COUNT(al.id) as event_count,
          MAX(al.event_time) as last_event_time
        FROM terminals t
        LEFT JOIN attendance_logs al ON t.id = al.terminal_id
        WHERE t.is_active = true
        GROUP BY t.id, t.name, t.ip_address
        ORDER BY t.id
      `);
      
      result.rows.forEach(terminal => {
        let status = '❌';
        if (terminal.last_event_time) {
          const lastEvent = new Date(terminal.last_event_time);
          const diffMinutes = Math.floor((now - lastEvent) / 1000 / 60);
          if (diffMinutes < 5) {
            status = '✅';
          } else if (diffMinutes < 30) {
            status = '⚠️';
          }
          console.log(`   ${status} ${terminal.name}: ${terminal.event_count} event, oxirgisi ${diffMinutes} daqiqa oldin`);
        } else {
          console.log(`   ${status} ${terminal.name}: Event'lar yo'q`);
        }
      });
    } catch (error) {
      console.error('   ❌ Xatolik:', error.message);
    }
  }, 30000); // Har 30 soniyada

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(checkInterval);
    console.log('\n\nMonitoring to\'xtatildi.');
    pool.end();
    process.exit(0);
  });
}

// Command line argumentlar
const args = process.argv.slice(2);

if (args[0] === 'monitor') {
  monitorTerminals();
} else {
  checkTerminalStatus();
}
