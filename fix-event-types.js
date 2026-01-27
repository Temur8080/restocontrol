require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const ADMIN_ID = 63;

async function fixEventTypes() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔄 Event type larni to\'g\'rilash...');
    
    // Avval event_type column mavjudligini tekshirish
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_logs' AND column_name = 'event_type'
    `);
    
    if (columnCheck.rows.length === 0) {
      console.log('⚠️  event_type column mavjud emas. Avval add-event-type-column.js ni ishga tushiring.');
      await client.query('ROLLBACK');
      return;
    }
    
    // Terminal nomiga qarab event_type ni yangilash
    // "Kirish" yoki "entry" bo'lsa -> 'entry'
    // "Chiqish" yoki "exit" bo'lsa -> 'exit'
    const updateQuery = `
      UPDATE attendance_logs
      SET event_type = CASE
        WHEN terminal_name LIKE '%Kirish%' OR terminal_name LIKE '%entry%' OR terminal_name ILIKE '%kirish%' THEN 'entry'
        WHEN terminal_name LIKE '%Chiqish%' OR terminal_name LIKE '%exit%' OR terminal_name ILIKE '%chiqish%' THEN 'exit'
        WHEN event_time::time < '14:00:00'::time THEN 'entry'
        ELSE 'exit'
      END
      WHERE admin_id = $1 AND (event_type IS NULL OR event_type = '')
    `;
    
    const result = await client.query(updateQuery, [ADMIN_ID]);
    
    await client.query('COMMIT');
    
    console.log(`✅ ${result.rowCount} ta event type yangilandi`);
    
    // Statistikani ko'rsatish
    const statsQuery = `
      SELECT event_type, COUNT(*) as count
      FROM attendance_logs
      WHERE admin_id = $1
      GROUP BY event_type
      ORDER BY event_type
    `;
    
    const statsResult = await client.query(statsQuery, [ADMIN_ID]);
    console.log('\n📊 Event type statistikasi:');
    statsResult.rows.forEach(row => {
      console.log(`   ${row.event_type || 'NULL'}: ${row.count} ta`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Xatolik:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixEventTypes()
  .then(() => {
    console.log('\n✅ Dastur yakunlandi');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Dastur xatolik bilan yakunlandi:', error);
    process.exit(1);
  });
