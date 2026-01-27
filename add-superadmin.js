// Superadmin qo'shish script
// Foydalanish: node add-superadmin.js username password

const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function addSuperAdmin() {
  try {
    // Parametrlarni olish
    const username = process.argv[2] || 'superadmin';
    const password = process.argv[3] || 'superadmin123';
    
    console.log('========================================');
    console.log('Superadmin Qo\'shish');
    console.log('========================================');
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log('========================================\n');
    
    // Parolni hash qilish
    const hash = await bcrypt.hash(password, 10);
    
    // Superadmin qo'shish
    const result = await pool.query(
      `INSERT INTO users (username, password, role, is_active) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (username) DO UPDATE 
       SET password = EXCLUDED.password, 
           role = EXCLUDED.role, 
           is_active = EXCLUDED.is_active
       RETURNING id, username, role, is_active, created_at`,
      [username, hash, 'super_admin', true]
    );
    
    if (result.rows.length > 0) {
      console.log('✅ Superadmin muvaffaqiyatli qo\'shildi!');
      console.log('\n📋 Ma\'lumotlar:');
      console.log(`   ID: ${result.rows[0].id}`);
      console.log(`   Username: ${result.rows[0].username}`);
      console.log(`   Role: ${result.rows[0].role}`);
      console.log(`   Status: ${result.rows[0].is_active ? 'Aktiv' : 'Nofaol'}`);
      console.log(`   Yaratilgan: ${result.rows[0].created_at}`);
      console.log(`\n🔑 Password: ${password}`);
      console.log('\n🎉 Endi login qilishingiz mumkin!\n');
    }
    
  } catch (error) {
    console.error('❌ Xatolik:', error.message);
    console.error('Detail:', error.detail);
  } finally {
    await pool.end();
  }
}

addSuperAdmin();
