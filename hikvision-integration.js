

const { Pool } = require('pg');
const HikvisionManager = require('./services/hikvision-manager');
require('dotenv').config();


const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});


let config = {};
try {
  config = require('./config/hikvision-config.js');
} catch (error) {
  console.log('ℹ️  Custom config topilmadi, default config ishlatilmoqda');
}


const hikvisionManager = new HikvisionManager(pool, config);


async function start() {
  try {
    await hikvisionManager.initialize();
  } catch (error) {
    console.error('❌ Hikvision integration initialization xatolik:', error);
    process.exit(1);
  }
}


process.on('SIGINT', async () => {
  console.log('\n⚠️  Shutdown signal olingan...');
  await hikvisionManager.shutdown();
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Termination signal olingan...');
  await hikvisionManager.shutdown();
  await pool.end();
  process.exit(0);
});


if (require.main === module) {
  start();
}


module.exports = hikvisionManager;


