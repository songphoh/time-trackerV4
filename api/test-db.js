// api/test-db.js - ทดสอบการเชื่อมต่อฐานข้อมูลใน Vercel
const { Pool } = require('pg');

module.exports = async (req, res) => {
  // ตั้งค่า CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    console.log('🔍 Starting database connection test...');
    
    // ตรวจสอบ Environment Variables
    const databaseUrl = process.env.DATABASE_URL;
    console.log('DATABASE_URL exists:', !!databaseUrl);
    console.log('DATABASE_URL preview:', databaseUrl ? databaseUrl.substring(0, 50) + '...' : 'NOT_SET');
    
    if (!databaseUrl) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_URL not set',
        env_check: {
          NODE_ENV: process.env.NODE_ENV,
          DATABASE_URL_EXISTS: false
        }
      });
    }

    // สร้าง connection pool
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined
      },
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 5000
    });

    console.log('🔄 Testing database connection...');
    
    // ทดสอบการเชื่อมต่อ
    const client = await pool.connect();
    
    try {
      // ทดสอบ query พื้นฐาน
      const timeResult = await client.query('SELECT NOW() as current_time');
      console.log('✅ Database connection successful');
      
      // ตรวจสอบตารางที่มีอยู่
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      
      const tables = tablesResult.rows.map(row => row.table_name);
      console.log('📋 Tables found:', tables);
      
      // ตรวจสอบจำนวนข้อมูลในตารางหลัก
      let tableStats = [];
      
      if (tables.includes('employees')) {
        const empCount = await client.query('SELECT COUNT(*) as count FROM employees');
        tableStats.push({ table: 'employees', count: parseInt(empCount.rows[0].count) });
      }
      
      if (tables.includes('time_logs')) {
        const logCount = await client.query('SELECT COUNT(*) as count FROM time_logs');
        tableStats.push({ table: 'time_logs', count: parseInt(logCount.rows[0].count) });
      }
      
      if (tables.includes('settings')) {
        const settingsCount = await client.query('SELECT COUNT(*) as count FROM settings');
        tableStats.push({ table: 'settings', count: parseInt(settingsCount.rows[0].count) });
      }
      
      res.status(200).json({
        success: true,
        message: 'Database connection successful',
        data: {
          server_time: timeResult.rows[0].current_time,
          tables_found: tables,
          table_stats: tableStats,
          connection_info: {
            host: pool.options.host || 'from_connection_string',
            database: pool.options.database || 'from_connection_string',
            ssl_enabled: !!pool.options.ssl
          },
          env_info: {
            NODE_ENV: process.env.NODE_ENV,
            DATABASE_URL_EXISTS: !!process.env.DATABASE_URL
          }
        }
      });
      
    } finally {
      client.release();
      await pool.end();
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      error_code: error.code,
      error_details: {
        name: error.name,
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint
      },
      env_info: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL_EXISTS: !!process.env.DATABASE_URL
      }
    });
  }
};