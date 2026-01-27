/**
 * Migration script to add event_type column to attendance_logs table
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'hodim_nazorati',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function addEventTypeColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Adding event_type column to attendance_logs...');
    
    await client.query('BEGIN');
    
    // Check if column exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_logs' AND column_name = 'event_type'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✅ event_type column already exists');
      await client.query('COMMIT');
      return;
    }
    
    // Add event_type column
    await client.query(`
      ALTER TABLE attendance_logs 
      ADD COLUMN event_type VARCHAR(20) CHECK (event_type IN ('entry', 'exit'))
    `);
    
    // Update existing records based on time (14:00 as threshold)
    const updateQuery = `
      UPDATE attendance_logs
      SET event_type = CASE
        WHEN event_time::time < '14:00:00'::time THEN 'entry'
        ELSE 'exit'
      END
      WHERE event_type IS NULL
    `;
    
    const updateResult = await client.query(updateQuery);
    
    await client.query('COMMIT');
    
    console.log(`✅ Successfully added event_type column`);
    console.log(`✅ Updated ${updateResult.rowCount} existing records`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error adding event_type column:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
addEventTypeColumn()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });

