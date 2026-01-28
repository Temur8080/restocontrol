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
    return { success: true, skipped: false };
  } catch (error) {
    // Agar migration allaqachon bajarilgan bo'lsa (IF NOT EXISTS, IF EXISTS kabi), bu xato emas
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('already exists') || 
        errorMessage.includes('duplicate') ||
        errorMessage.includes('does not exist')) {
      console.log(`   ⏭️  Migration skipped (already applied): ${path.basename(filePath)}`);
      return { success: true, skipped: true };
    }
    console.error(`❌ Error running migration ${path.basename(filePath)}:`, error.message);
    return { success: false, skipped: false };
  }
}

async function runAllMigrations() {
  console.log('🚀 Starting database migrations...\n');
  
  const migrationsDir = path.join(__dirname, 'migrations');
  
  // Barcha migration fayllarini to'g'ri tartibda
  const migrationFiles = [
    'create-penalties-bonuses-kpi.sql',
    'create-attendance-logs.sql',
    'create-work-schedules.sql',
    'add-organization-fields.sql',
    'add-admin-id-to-all-tables.sql',
    'add-admin-permissions.sql',
    'add-penalty-settings.sql',
    'add-subscription-fields.sql',
    'migrate-day-of-week-to-1-7.sql'
  ];
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    if (fs.existsSync(filePath)) {
      const result = await runMigration(filePath);
      if (result.success) {
        if (result.skipped) {
          skippedCount++;
        } else {
          successCount++;
        }
      } else {
        failCount++;
      }
    } else {
      console.log(`⚠️  Migration file not found: ${file}`);
      skippedCount++;
    }
  }
  
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
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
