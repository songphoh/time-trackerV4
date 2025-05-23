// db-pool-optimized.js - แทนที่ไฟล์เดิม
const { Pool } = require('pg');

let pool = null;

function createPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || 
      "postgresql://postgres.ofzfxbhzkvrumsgrgogq:%40Songphon544942@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    
    console.log('🚀 Creating new database pool...');
    
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined
      },
      // ⭐ ปรับค่าสำหรับ production
      max: 20,                    // เพิ่มจาก 1 เป็น 20
      min: 2,                     // รักษา connection ขั้นต่ำ
      idleTimeoutMillis: 30000,   // timeout ของ idle connection
      connectionTimeoutMillis: 15000, // timeout สำหรับสร้าง connection ใหม่
      statement_timeout: 30000,   // timeout สำหรับ query
      query_timeout: 30000,       // query timeout
      application_name: 'time-tracker',
      
      // เพิ่มการตั้งค่า timezone
      timezone: 'Asia/Bangkok'
    });

    // Error handling
    pool.on('error', (err, client) => {
      console.error('❌ Unexpected error on idle client:', err);
      process.exit(-1);
    });
    
    pool.on('connect', (client) => {
      console.log('✅ New client connected to database');
    });
    
    pool.on('acquire', (client) => {
      console.log('🔄 Client acquired from pool');
    });
    
    pool.on('release', (client) => {
      console.log('↩️ Client released back to pool');
    });
    
    // Test connection
    pool.query('SELECT NOW()')
      .then(() => {
        console.log('✅ Database pool initialized successfully');
      })
      .catch(err => {
        console.error('❌ Failed to initialize database pool:', err);
      });
  }
  
  return pool;
}

// Helper function สำหรับ transaction
async function withTransaction(callback) {
  const client = await createPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Prepared statements cache
const preparedStatements = {
  GET_EMPLOYEE_BY_CODE: 'SELECT id, full_name FROM employees WHERE emp_code = $1 OR full_name = $1',
  CHECK_CLOCK_IN_TODAY: 'SELECT id FROM time_logs WHERE employee_id = $1 AND DATE(clock_in) = $2',
  GET_ACTIVE_EMPLOYEES: 'SELECT emp_code, full_name FROM employees WHERE status = $1',
  GET_EMPLOYEE_NAMES: 'SELECT full_name FROM employees WHERE status = $1',
  INSERT_TIME_LOG: `INSERT INTO time_logs 
    (employee_id, clock_in, note, latitude_in, longitude_in, line_name, line_picture)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  UPDATE_CLOCK_OUT: `UPDATE time_logs SET 
    clock_out = $1, latitude_out = $2, longitude_out = $3, line_name = $4, line_picture = $5
    WHERE id = $6`,
  GET_TODAY_RECORD: `SELECT id, clock_out FROM time_logs 
    WHERE employee_id = $1 AND DATE(clock_in) = $2 ORDER BY clock_in DESC LIMIT 1`
};

// Export singleton pool และ helper functions
module.exports = {
  query: (text, params) => createPool().query(text, params),
  getClient: () => createPool().connect(),
  pool: createPool(),
  withTransaction,
  preparedStatements
};