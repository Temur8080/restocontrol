const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function createTables() {
  try {
    console.log('🚀 Creating penalties, bonuses, and kpi_records tables...\n');
    
    const migrationPath = path.join(__dirname, 'migrations', 'create-penalties-bonuses-kpi.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Running migration: create-penalties-bonuses-kpi.sql');
    await pool.query(sql);
    
    console.log('✅ Tables created successfully!');
    console.log('   - penalties table');
    console.log('   - bonuses table');
    console.log('   - kpi_records table');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

createTables();
