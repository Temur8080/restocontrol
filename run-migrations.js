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

async function runMigration(filePath) {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`\n📄 Running migration: ${path.basename(filePath)}`);
    await pool.query(sql);
    console.log(`✅ Migration completed: ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`❌ Error running migration ${path.basename(filePath)}:`, error.message);
    return false;
  }
}

async function runAllMigrations() {
  console.log('🚀 Starting database migrations...\n');
  
  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = [
    'create-penalties-bonuses-kpi.sql',
    'add-organization-fields.sql',
    'add-admin-permissions.sql'
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    if (fs.existsSync(filePath)) {
      const success = await runMigration(filePath);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } else {
      console.log(`⚠️  Migration file not found: ${file}`);
      failCount++;
    }
  }
  
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  
  await pool.end();
  
  if (failCount === 0) {
    console.log('\n🎉 All migrations completed successfully!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some migrations failed. Please check the errors above.');
    process.exit(1);
  }
}

runAllMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
