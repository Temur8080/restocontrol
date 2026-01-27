/**
 * Migration script to fix missing employee_id in attendance_logs
 * This script matches attendance_logs records with employees by:
 * 1. employee_name = full_name
 * 2. employee_name = username
 * 3. employee_name = employee id (as string)
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

async function fixAttendanceEmployeeIds() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting to fix attendance_logs employee_id...');
    
    // First, show what we have
    const sampleLogsQuery = `
      SELECT DISTINCT employee_name, employee_id, terminal_name
      FROM attendance_logs
      WHERE employee_id IS NULL
      LIMIT 10
    `;
    const sampleLogs = await client.query(sampleLogsQuery);
    console.log('\n📋 Sample attendance_logs without employee_id:');
    sampleLogs.rows.forEach(row => {
      console.log(`   employee_name: "${row.employee_name}", terminal_name: "${row.terminal_name}", employee_id: ${row.employee_id}`);
    });
    
    const sampleEmployeesQuery = `
      SELECT e.id, e.full_name, u.username
      FROM employees e
      JOIN users u ON e.user_id = u.id
      LIMIT 10
    `;
    const sampleEmployees = await client.query(sampleEmployeesQuery);
    console.log('\n📋 Sample employees:');
    sampleEmployees.rows.forEach(row => {
      console.log(`   id: ${row.id}, full_name: "${row.full_name}", username: "${row.username}"`);
    });
    
    const sampleFacesQuery = `
      SELECT ef.employee_id, ef.face_template_id, ef.terminal_id, t.name as terminal_name, e.full_name
      FROM employee_faces ef
      JOIN terminals t ON ef.terminal_id = t.id
      JOIN employees e ON ef.employee_id = e.id
      LIMIT 10
    `;
    const sampleFaces = await client.query(sampleFacesQuery);
    console.log('\n📋 Sample employee_faces:');
    sampleFaces.rows.forEach(row => {
      console.log(`   employee_id: ${row.employee_id}, face_template_id: "${row.face_template_id}", terminal: "${row.terminal_name}", employee: "${row.full_name}"`);
    });
    
    await client.query('BEGIN');
    
    // Strategy 1: Match via employee_faces table (face_template_id)
    console.log('\n🔍 Strategy 1: Matching via employee_faces (face_template_id)...');
    const updateViaFacesQuery = `
      UPDATE attendance_logs al
      SET employee_id = ef.employee_id
      FROM employee_faces ef
      JOIN terminals t ON ef.terminal_id = t.id
      WHERE al.employee_id IS NULL
        AND al.terminal_name = t.name
        AND al.employee_name = ef.face_template_id::text
    `;
    const resultViaFaces = await client.query(updateViaFacesQuery);
    console.log(`   Updated ${resultViaFaces.rowCount} records via employee_faces`);
    
    // Strategy 1.5: If employee_faces is empty, try to create mappings from attendance_logs
    if (resultViaFaces.rowCount === 0) {
      console.log('\n🔍 Strategy 1.5: Creating employee_faces mappings from attendance_logs...');
      
      // Get all terminals
      const terminalsQuery = await client.query('SELECT id, name FROM terminals');
      const terminalsMap = new Map();
      terminalsQuery.rows.forEach(row => {
        terminalsMap.set(row.name, row.id);
      });
      
      // Get unique employee_name values from attendance_logs grouped by terminal
      const uniqueNamesQuery = await client.query(`
        SELECT DISTINCT employee_name, terminal_name, COUNT(*) as event_count
        FROM attendance_logs
        WHERE employee_id IS NULL
        GROUP BY employee_name, terminal_name
        ORDER BY event_count DESC
      `);
      
      console.log(`   Found ${uniqueNamesQuery.rows.length} unique employee_name values`);
      
      // Get all employees
      const allEmployeesQuery = await client.query(`
        SELECT e.id, e.full_name, u.username
        FROM employees e
        JOIN users u ON e.user_id = u.id
        ORDER BY e.id
      `);
      
      console.log(`   Found ${allEmployeesQuery.rows.length} employees`);
      
      // For each unique employee_name, try to match with employees
      for (const row of uniqueNamesQuery.rows) {
        const employeeName = row.employee_name;
        const terminalName = row.terminal_name;
        const terminalId = terminalsMap.get(terminalName);
        
        if (!terminalId) {
          console.log(`   ⚠️  Terminal "${terminalName}" topilmadi, o'tkazib yuborildi`);
          continue;
        }
        
        // Try to match as numeric ID first
        let matchedEmployeeId = null;
        const numericId = parseInt(employeeName);
        if (!isNaN(numericId) && numericId > 0) {
          const empCheck = await client.query(
            'SELECT id FROM employees WHERE id = $1',
            [numericId]
          );
          if (empCheck.rows.length > 0) {
            matchedEmployeeId = empCheck.rows[0].id;
            console.log(`   ✅ Found direct match: employee_name="${employeeName}" -> employee_id=${matchedEmployeeId}`);
          }
        }
        
        // If no direct match and we have employees, try to match by order
        // This is a fallback - match first employee_name with first employee, etc.
        if (!matchedEmployeeId && allEmployeesQuery.rows.length > 0) {
          // Try to match by position in list (if employee_name is "1", match with first employee, etc.)
          const nameIndex = parseInt(employeeName);
          if (!isNaN(nameIndex) && nameIndex > 0 && nameIndex <= allEmployeesQuery.rows.length) {
            matchedEmployeeId = allEmployeesQuery.rows[nameIndex - 1].id;
            console.log(`   ⚠️  Using positional match: employee_name="${employeeName}" (position ${nameIndex}) -> employee_id=${matchedEmployeeId} (${allEmployeesQuery.rows[nameIndex - 1].full_name})`);
          }
        }
        
        if (matchedEmployeeId) {
          // Insert into employee_faces
          await client.query(
            `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (employee_id, terminal_id) 
             DO UPDATE SET face_template_id = EXCLUDED.face_template_id`,
            [matchedEmployeeId, terminalId, employeeName]
          );
          console.log(`   ✅ Created mapping: employee_id=${matchedEmployeeId}, face_template_id="${employeeName}", terminal="${terminalName}"`);
        } else {
          console.log(`   ❌ Could not match employee_name="${employeeName}" with any employee`);
        }
      }
      
      // Now try to update attendance_logs again
      const resultViaFaces2 = await client.query(updateViaFacesQuery);
      console.log(`   Updated ${resultViaFaces2.rowCount} records via employee_faces (after creating mappings)`);
      resultViaFaces.rowCount = resultViaFaces2.rowCount;
    }
    
    // Strategy 2: Match via direct employee_id (if employee_name is numeric and matches employee id)
    console.log('\n🔍 Strategy 2: Matching via direct employee_id...');
    const updateViaIdQuery = `
      UPDATE attendance_logs al
      SET employee_id = e.id
      FROM employees e
      WHERE al.employee_id IS NULL
        AND al.employee_name ~ '^[0-9]+$'
        AND al.employee_name::integer = e.id
    `;
    const resultViaId = await client.query(updateViaIdQuery);
    console.log(`   Updated ${resultViaId.rowCount} records via direct employee_id`);
    
    // Strategy 3: Match via full_name or username
    console.log('\n🔍 Strategy 3: Matching via full_name or username...');
    const updateViaNameQuery = `
      UPDATE attendance_logs al
      SET employee_id = e.id
      FROM employees e
      JOIN users u ON e.user_id = u.id
      WHERE al.employee_id IS NULL
        AND (
          LOWER(TRIM(al.employee_name)) = LOWER(TRIM(e.full_name))
          OR LOWER(TRIM(al.employee_name)) = LOWER(TRIM(u.username))
        )
    `;
    const resultViaName = await client.query(updateViaNameQuery);
    console.log(`   Updated ${resultViaName.rowCount} records via full_name/username`);
    
    const totalUpdated = resultViaFaces.rowCount + resultViaId.rowCount + resultViaName.rowCount;
    
    await client.query('COMMIT');
    
    console.log(`\n✅ Successfully updated ${totalUpdated} attendance_logs records with employee_id`);
    
    // Show statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_logs,
        COUNT(employee_id) as logs_with_employee_id,
        COUNT(*) - COUNT(employee_id) as logs_without_employee_id
      FROM attendance_logs
    `;
    
    const stats = await client.query(statsQuery);
    console.log('\n📊 Statistics:');
    console.log(`   Total logs: ${stats.rows[0].total_logs}`);
    console.log(`   With employee_id: ${stats.rows[0].logs_with_employee_id}`);
    console.log(`   Without employee_id: ${stats.rows[0].logs_without_employee_id}`);
    
    // Show unmatched logs
    if (stats.rows[0].logs_without_employee_id > 0) {
      const unmatchedQuery = `
        SELECT DISTINCT al.employee_name, al.terminal_name, COUNT(*) as count
        FROM attendance_logs al
        WHERE al.employee_id IS NULL
        GROUP BY al.employee_name, al.terminal_name
        ORDER BY count DESC
        LIMIT 10
      `;
      const unmatched = await client.query(unmatchedQuery);
      console.log('\n⚠️  Unmatched employee_name values:');
      unmatched.rows.forEach(row => {
        console.log(`   employee_name: "${row.employee_name}", terminal: "${row.terminal_name}" (${row.count} records)`);
      });
      
      console.log('\n💡 Yechim:');
      console.log('   1. Terminaldan foydalanuvchilarni yuklash kerak:');
      console.log('      - Admin panelida "Terminallar" bo\'limiga o\'ting');
      console.log('      - Terminal ustiga bosing va "Foydalanuvchilarni yuklash" tugmasini bosing');
      console.log('      - Bu "employee_faces" jadvalini to\'ldiradi');
      console.log('   2. Keyin bu scriptni qayta ishga tushiring');
      console.log('   3. Yoki terminaldan kelgan "employee_name" ni qo\'lda "employee_faces" jadvaliga qo\'shing');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error fixing attendance_logs employee_id:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
fixAttendanceEmployeeIds()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });

