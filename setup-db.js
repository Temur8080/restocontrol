
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'T1187877t',
  port: process.env.DB_PORT || 5432,
});

async function setupDatabase() {
  try {
    console.log('Database ga ulanmoqda...');
    
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'employee',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_username ON users(username);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_role ON users(role);
    `);

    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        full_name VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_user_id ON employees(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_position ON employees(position);
    `);

    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_position_name ON positions(name);
    `);
    
    console.log('Jadval yaratildi/yoki mavjud.');
    
    
    const username = process.argv[2] || 'admin';
    const password = process.argv[3] || 'admin123';
    
    console.log(`\nUser yaratilmoqda: ${username}`);
    
    const hash = await bcrypt.hash(password, 10);
    
    
    const requestedRole = process.argv[4] || 'admin';
    const role = (requestedRole === 'super_admin') ? 'super_admin' : 'admin';

    const result = await pool.query(
      `INSERT INTO users (username, password, role, is_active) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (username) DO UPDATE SET password = $2, role = $3, is_active = $4
       RETURNING id, username, role`,
      [username, hash, role, true]
    );
    
    console.log('\n✅ Muvaffaqiyatli!');
    console.log(`Username: ${result.rows[0].username}`);
    console.log(`Role: ${result.rows[0].role}`);
    console.log(`Password: ${password}`);
    console.log('\nEndi login qilishingiz mumkin.\n');
    
  } catch (error) {
    console.error('Xatolik:', error.message);
  } finally {
    await pool.end();
  }
}

setupDatabase();

