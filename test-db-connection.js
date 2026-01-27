// Database ulanishini test qilish script
const { Pool } = require('pg');
require('dotenv').config();

console.log('========================================');
console.log('Database Ulanish Test');
console.log('========================================\n');

// Environment variable'larni ko'rsatish
console.log('Environment Variables:');
console.log('  DB_HOST:', process.env.DB_HOST || 'localhost (default)');
console.log('  DB_PORT:', process.env.DB_PORT || '5432 (default)');
console.log('  DB_NAME:', process.env.DB_NAME || 'hodim_nazorati (default)');
console.log('  DB_USER:', process.env.DB_USER || 'postgres (default)');
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? '*** (set)' : 'NOT SET!');
console.log('');

// Database ulanishini test qilish
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function testConnection() {
  try {
    console.log('🔄 Database\'ga ulanish sinanmoqda...\n');
    
    const result = await pool.query('SELECT version(), current_database(), current_user');
    
    console.log('✅ Database\'ga muvaffaqiyatli ulandi!');
    console.log('\n📋 Database Ma\'lumotlari:');
    console.log('  Database:', result.rows[0].current_database);
    console.log('  User:', result.rows[0].current_user);
    console.log('  PostgreSQL Version:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
    
    // Users jadvalini tekshirish
    const usersTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (usersTable.rows[0].exists) {
      console.log('\n✅ Users jadvali mavjud');
      
      // Foydalanuvchilar sonini ko'rsatish
      const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
      console.log(`   Foydalanuvchilar soni: ${userCount.rows[0].count}`);
      
      // Adminlarni ko'rsatish
      const admins = await pool.query(`
        SELECT id, username, role, is_active 
        FROM users 
        WHERE role IN ('admin', 'super_admin')
        ORDER BY role, username
      `);
      
      if (admins.rows.length > 0) {
        console.log('\n👥 Adminlar:');
        admins.rows.forEach(admin => {
          console.log(`   - ${admin.username} (${admin.role}) - ${admin.is_active ? 'Aktiv' : 'Nofaol'}`);
        });
      } else {
        console.log('\n⚠️  Adminlar topilmadi!');
        console.log('   Admin yaratish: npm run setup-db admin admin123 admin');
      }
    } else {
      console.log('\n⚠️  Users jadvali mavjud emas!');
      console.log('   Schema yuklash: psql -U postgres -d hodim_nazorati -f schema.sql');
    }
    
  } catch (error) {
    console.error('\n❌ Xatolik:', error.message);
    console.error('   Code:', error.code);
    
    if (error.code === '28P01') {
      console.error('\n💡 Maslahat:');
      console.error('   - .env faylida DB_PASSWORD to\'g\'ri ekanligini tekshiring');
      console.error('   - PostgreSQL parolini to\'g\'ri kiriting');
      console.error('   - .env fayl mavjudligini tekshiring: cat .env');
    } else if (error.code === '3D000') {
      console.error('\n💡 Maslahat:');
      console.error('   - Database yaratilmagan!');
      console.error('   - Database yaratish: CREATE DATABASE hodim_nazorati;');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Maslahat:');
      console.error('   - PostgreSQL ishlamayapti!');
      console.error('   - PostgreSQL status: sudo systemctl status postgresql');
      console.error('   - PostgreSQL ishga tushirish: sudo systemctl start postgresql');
    }
  } finally {
    await pool.end();
  }
}

testConnection();
