process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression'); // ⭐ เพิ่ม compression
const path = require('path');
const axios = require('axios');

// ใช้ optimized db pool
const db = require('./db-adapter');

// กำหนดโซนเวลา
process.env.TZ = 'Asia/Bangkok';

console.log('Server Timezone:', process.env.TZ);
console.log('Current server time:', new Date().toString());
console.log('Current server time (ISO):', new Date().toISOString());
console.log('Current server time (Locale):', new Date().toLocaleString('th-TH'));

const app = express();
const port = process.env.PORT || 3000;

// ⭐ เพิ่ม compression middleware
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// ⭐ Performance monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 2000) {
      console.warn(`🐌 Slow request: ${req.method} ${req.url} took ${duration}ms`);
    } else if (duration > 1000) {
      console.log(`⚠️ Long request: ${req.method} ${req.url} took ${duration}ms`);
    }
  });
  
  next();
});

// Debug router
const debugRouter = require('./debug');
app.use('/debug', debugRouter);

// Basic middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// ตรวจสอบ log
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.url}`);
  next();
});

// ⭐ Cache สำหรับข้อมูลที่ไม่เปลี่ยนแปลงบ่อย
let employeeCache = null;
let employeeCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 นาที

async function getEmployeesFromCache() {
  const now = Date.now();
  if (!employeeCache || (now - employeeCacheTime) > CACHE_DURATION) {
    console.log('🔄 Refreshing employee cache...');
    const result = await const db = require('./db-adapter');(db.preparedStatements.GET_ACTIVE_EMPLOYEES, ['active']);
    employeeCache = result.rows.map(e => [e.full_name, e.emp_code]);
    employeeCacheTime = now;
  }
  return employeeCache;
}

// ⭐ ฟังก์ชันล้าง cache
function clearEmployeeCache() {
  employeeCache = null;
  employeeCacheTime = 0;
}

// เตรียมฐานข้อมูล
async function initializeDatabase() {
  console.log('🚀 กำลังตรวจสอบและสร้างตาราง...');
  
  try {
    await db.withTransaction(async (client) => {
      // สร้างตาราง employees
      await client.query(`
        CREATE TABLE IF NOT EXISTS employees (
          id SERIAL PRIMARY KEY,
          emp_code TEXT NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          position TEXT,
          department TEXT,
          line_id TEXT,
          line_name TEXT,
          line_picture TEXT,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('ตาราง employees สร้างหรือมีอยู่แล้ว');

      // สร้างตาราง time_logs
      await client.query(`
        CREATE TABLE IF NOT EXISTS time_logs (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL,
          clock_in TIMESTAMP,
          clock_out TIMESTAMP,
          note TEXT,
          latitude_in REAL,
          longitude_in REAL,
          latitude_out REAL,
          longitude_out REAL,
          line_id TEXT,
          line_name TEXT,
          line_picture TEXT,
          status TEXT DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
      `);
      console.log('ตาราง time_logs สร้างหรือมีอยู่แล้ว');

      // สร้างตาราง settings
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          id SERIAL PRIMARY KEY,
          setting_name TEXT NOT NULL UNIQUE,
          setting_value TEXT,
          description TEXT
        )
      `);
      console.log('ตาราง settings สร้างหรือมีอยู่แล้ว');

      // ⭐ สร้าง indexes สำหรับ performance
      await client.query(`
        -- Index สำหรับการค้นหาพนักงาน
        CREATE INDEX IF NOT EXISTS idx_employees_emp_code ON employees(emp_code);
        CREATE INDEX IF NOT EXISTS idx_employees_full_name ON employees(full_name);
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
        
        -- Index สำหรับการค้นหา time logs
        CREATE INDEX IF NOT EXISTS idx_time_logs_employee_id ON time_logs(employee_id);
        CREATE INDEX IF NOT EXISTS idx_time_logs_clock_in_date ON time_logs(DATE(clock_in));
        CREATE INDEX IF NOT EXISTS idx_time_logs_employee_date ON time_logs(employee_id, DATE(clock_in));
        
        -- Index สำหรับ settings
        CREATE INDEX IF NOT EXISTS idx_settings_name ON settings(setting_name);
      `);
      
      console.log('✅ Database tables and indexes created');
    });
    
    await addInitialSettings();
    await addSampleEmployees();
    
    console.log('✅ เตรียมฐานข้อมูลเสร็จสมบูรณ์');
  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
  }
}

// เพิ่มข้อมูลการตั้งค่าเริ่มต้น
async function addInitialSettings() {
  try {
    const countResult = await db.query('SELECT COUNT(*) as count FROM settings');
    
    if (parseInt(countResult.rows[0].count) === 0) {
      console.log('📝 กำลังเพิ่มการตั้งค่าเริ่มต้น...');
      
      const settings = [
        { name: 'organization_name', value: 'องค์การบริหารส่วนตำบลหัวนา', desc: 'ชื่อหน่วยงาน' },
        { name: 'work_start_time', value: '08:30', desc: 'เวลาเริ่มงาน' },
        { name: 'work_end_time', value: '16:30', desc: 'เวลาเลิกงาน' },
        { name: 'allowed_ip', value: '', desc: 'IP Address ที่อนุญาต' },
        { name: 'telegram_bot_token', value: '', desc: 'Token สำหรับ Telegram Bot' },
        { name: 'telegram_groups', value: '[{"name":"กลุ่มหลัก","chat_id":"","active":true}]', desc: 'กลุ่มรับการแจ้งเตือน Telegram' },
        { name: 'notify_clock_in', value: '1', desc: 'แจ้งเตือนเมื่อลงเวลาเข้า' },
        { name: 'notify_clock_out', value: '1', desc: 'แจ้งเตือนเมื่อลงเวลาออก' },
        { name: 'admin_username', value: 'admin', desc: 'ชื่อผู้ใช้สำหรับแอดมิน' },
        { name: 'admin_password', value: 'admin123', desc: 'รหัสผ่านสำหรับแอดมิน' },
        { name: 'liff_id', value: '2001032478-VR5Akj0k', desc: 'LINE LIFF ID' },
        { name: 'time_offset', value: '420', desc: 'ค่าชดเชยเวลา (นาที)' },
        { name: 'gas_web_app_url', value: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', desc: 'URL ของ Google Apps Script Web App' },
        { name: 'use_gas_for_telegram', value: '1', desc: 'ใช้ Google Apps Script สำหรับส่งข้อความไป Telegram (1=ใช้, 0=ไม่ใช้)' }
      ];
      
      for (const setting of settings) {
        await db.query(
          'INSERT INTO settings (setting_name, setting_value, description) VALUES ($1, $2, $3)',
          [setting.name, setting.value, setting.desc]
        );
      }
      
      console.log('✅ เพิ่มการตั้งค่าเริ่มต้นเรียบร้อยแล้ว');
    } else {
      // เพิ่ม settings ใหม่หากยังไม่มี
      const newSettings = [
        { name: 'gas_web_app_url', value: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', desc: 'URL ของ Google Apps Script Web App' },
        { name: 'use_gas_for_telegram', value: '1', desc: 'ใช้ Google Apps Script สำหรับส่งข้อความไป Telegram (1=ใช้, 0=ไม่ใช้)' }
      ];
      
      for (const setting of newSettings) {
        const checkResult = await db.query('SELECT setting_name FROM settings WHERE setting_name = $1', [setting.name]);
        
        if (checkResult.rows.length === 0) {
          await db.query(
            'INSERT INTO settings (setting_name, setting_value, description) VALUES ($1, $2, $3)',
            [setting.name, setting.value, setting.desc]
          );
          console.log(`เพิ่มการตั้งค่า ${setting.name} เรียบร้อยแล้ว`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error adding initial settings:', err.message);
  }
}

// เพิ่มข้อมูลพนักงานตัวอย่าง
async function addSampleEmployees() {
  try {
    const countResult = await db.query('SELECT COUNT(*) as count FROM employees');
    
    if (parseInt(countResult.rows[0].count) === 0) {
      console.log('👥 กำลังเพิ่มพนักงานตัวอย่าง...');
      
      const employees = [
        { code: '001', name: 'สมชาย ใจดี', position: 'ผู้จัดการ', department: 'บริหาร' },
        { code: '002', name: 'สมหญิง รักเรียน', position: 'เจ้าหน้าที่', department: 'ธุรการ' }
      ];
      
      for (const emp of employees) {
        await db.query(
          'INSERT INTO employees (emp_code, full_name, position, department) VALUES ($1, $2, $3, $4)',
          [emp.code, emp.name, emp.position, emp.department]
        );
      }
      
      console.log('✅ เพิ่มพนักงานตัวอย่างเรียบร้อยแล้ว');
    }
  } catch (err) {
    console.error('❌ Error adding sample employees:', err.message);
  }
}

// เรียกใช้ฟังก์ชันเตรียมฐานข้อมูล
initializeDatabase();

// ฟังก์ชันปรับเวลาที่ได้รับจากไคลเอ็นต์
function adjustClientTime(clientTime) {
  try {
    const clientDate = new Date(clientTime);
    if (isNaN(clientDate.getTime())) {
      return new Date().toISOString();
    }
    return clientDate.toISOString();
  } catch (error) {
    console.error('❌ Error adjusting client time:', error);
    return new Date().toISOString();
  }
}

// ฟังก์ชันปรับเวลาสำหรับ Admin
function processAdminDateTime(timeString) {
  if (!timeString) return null;
  
  console.log('🕐 Processing admin time input:', timeString);
  
  try {
    let resultDate;
    
    // กรณี datetime-local จาก HTML input (YYYY-MM-DDTHH:MM)
    if (timeString.includes('T') && timeString.length === 16) {
      const fullDateTime = timeString + ':00';
      console.log('📝 Full datetime string:', fullDateTime);
      
      resultDate = new Date(fullDateTime);
      
      if (isNaN(resultDate.getTime())) {
        throw new Error('Invalid date object created');
      }
      
      console.log('📅 Local date object:', resultDate.toString());
      console.log('🌍 Local time (Thai assumed):', resultDate.toLocaleString('th-TH'));
      
      // แปลงเป็น UTC โดยลบ 7 ชั่วโมง
      const utcDate = new Date(resultDate.getTime() - (7 * 60 * 60 * 1000));
      console.log('🌐 UTC date object:', utcDate.toString());
      console.log('📤 Final UTC ISO:', utcDate.toISOString());
      
      return utcDate.toISOString();
    }
    
    // กรณีที่มี timezone info แล้ว
    if (timeString.includes('Z') || timeString.includes('+') || timeString.includes('-')) {
      resultDate = new Date(timeString);
      if (isNaN(resultDate.getTime())) {
        throw new Error('Invalid date with timezone info');
      }
      console.log('✅ Already has timezone info, using as-is:', resultDate.toISOString());
      return resultDate.toISOString();
    }
    
    // กรณีอื่นๆ - ลองแปลงโดยตรง
    resultDate = new Date(timeString);
    if (isNaN(resultDate.getTime())) {
      throw new Error('Cannot parse date string: ' + timeString);
    }
    
    // สมมติว่าเป็นเวลาไทยและแปลงเป็น UTC
    const utcDate = new Date(resultDate.getTime() - (7 * 60 * 60 * 1000));
    console.log('🔄 General conversion to UTC:', utcDate.toISOString());
    return utcDate.toISOString();
    
  } catch (error) {
    console.error('❌ Error processing time:', error.message);
    console.error('📋 Input was:', timeString);
    
    const fallbackTime = new Date().toISOString();
    console.log('🆘 Using fallback time (current time):', fallbackTime);
    return fallbackTime;
  }
}

// คำนวณระยะเวลาทำงาน
function calculateDuration(startDate, endDate) {
  const diff = Math.abs(endDate - startDate);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} ชั่วโมง ${minutes} นาที`;
}

// ⭐ API - ดึงรายชื่อพนักงานสำหรับ autocomplete (ใช้ cache)
app.post('/api/getdata', async (req, res) => {
  console.log('📋 API: getdata - ดึงรายชื่อพนักงานสำหรับ autocomplete');
  
  try {
    const result = await db.query(db.preparedStatements.GET_EMPLOYEE_NAMES, ['active']);
    const names = result.rows.map(e => e.full_name);
    res.json(names);
  } catch (err) {
    console.error('❌ Error in getdata:', err.message);
    return res.json({ error: err.message });
  }
});

// ⭐ API - ดึงรายชื่อพนักงานทั้งหมด (ใช้ cache)
app.post('/api/getemployee', async (req, res) => {
  console.log('👥 API: getemployee - ดึงรายชื่อพนักงานทั้งหมด');
  
  try {
    const employees = await getEmployeesFromCache();
    res.json(employees);
  } catch (err) {
    console.error('❌ Error in getemployee:', err.message);
    return res.json({ error: err.message });
  }
});

// ⭐ API - บันทึกเวลาเข้า (ปรับปรุงประสิทธิภาพ)
app.post('/api/clockin', async (req, res) => {
  console.log('⏰ API: clockin - บันทึกเวลาเข้า', req.body);
  
  try {
    const { 
      employee, 
      userinfo, 
      lat, 
      lon, 
      line_name, 
      line_picture, 
      client_time 
    } = req.body;
    
    if (!employee) {
      return res.json({ msg: 'กรุณาระบุชื่อพนักงาน' });
    }
    
    // ใช้ prepared statement
    const empResult = await db.query(db.preparedStatements.GET_EMPLOYEE_BY_CODE, [employee]);
    
    if (empResult.rows.length === 0) {
      return res.json({ msg: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const emp = empResult.rows[0];
    const today = new Date().toISOString().split('T')[0];
    
    // ตรวจสอบการลงเวลาซ้ำ
    const checkExistingResult = await db.query(db.preparedStatements.CHECK_CLOCK_IN_TODAY, [emp.id, today]);
    
    if (checkExistingResult.rows.length > 0) {
      return res.json({ 
        msg: 'คุณได้ลงเวลาเข้าแล้ววันนี้', 
        employee
      });
    }
    
    const now = client_time ? adjustClientTime(client_time) : new Date().toISOString();
    
    // บันทึกเวลาเข้า
    await db.query(db.preparedStatements.INSERT_TIME_LOG, [
      emp.id, now, userinfo || null, lat || null, lon || null, line_name || null, line_picture || null
    ]);
    
    // ส่งแจ้งเตือน (ไม่รอผลลัพธ์)
    setImmediate(async () => {
      try {
        await sendNotification('clock_in', employee, now, userinfo, lat, lon, line_name);
      } catch (error) {
        console.error('❌ Notification error:', error);
      }
    });
    
    // ปรับเวลาเป็นเวลาไทย
    const date = new Date(now);
    const hours = String(date.getUTCHours() + 7).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const returnDate = `${hours}:${minutes}:${seconds}`;
    
    return res.json({
      msg: 'SUCCESS',
      employee,
      return_date: returnDate,
      return_date_utc: now
    });
  } catch (error) {
    console.error('❌ Error in clockin:', error);
    return res.json({ msg: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - บันทึกเวลาออก (ปรับปรุงประสิทธิภาพ)
app.post('/api/clockout', async (req, res) => {
  console.log('🏃 API: clockout - บันทึกเวลาออก', req.body);
  
  try {
    const { 
      employee, 
      lat, 
      lon, 
      line_name, 
      line_picture, 
      client_time 
    } = req.body;
    
    if (!employee) {
      return res.json({ msg: 'กรุณาระบุชื่อพนักงาน' });
    }
    
    const empResult = await db.query(db.preparedStatements.GET_EMPLOYEE_BY_CODE, [employee]);
    
    if (empResult.rows.length === 0) {
      return res.json({ msg: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const emp = empResult.rows[0];
    const today = new Date().toISOString().split('T')[0];
    
    const recordResult = await db.query(db.preparedStatements.GET_TODAY_RECORD, [emp.id, today]);
    
    if (recordResult.rows.length === 0) {
      return res.json({ 
        msg: 'คุณยังไม่ได้ลงเวลาเข้าวันนี้', 
        employee
      });
    }
    
    const record = recordResult.rows[0];
    
    if (record.clock_out) {
      return res.json({ 
        msg: 'คุณได้ลงเวลาออกแล้ววันนี้', 
        employee
      });
    }
    
    const now = client_time ? adjustClientTime(client_time) : new Date().toISOString();
    
    // บันทึกเวลาออก
    await db.query(db.preparedStatements.UPDATE_CLOCK_OUT, [
      now, lat || null, lon || null, line_name || null, line_picture || null, record.id
    ]);
    
    // ส่งแจ้งเตือน (ไม่รอผลลัพธ์)
    setImmediate(async () => {
      try {
        await sendNotification('clock_out', employee, now, null, lat, lon, line_name);
      } catch (error) {
        console.error('❌ Notification error:', error);
      }
    });
    
    const date = new Date(now);
    const hours = String(date.getUTCHours() + 7).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const returnDate = `${hours}:${minutes}:${seconds}`;
    
    return res.json({
      msg: 'SUCCESS',
      employee,
      return_date: returnDate,
      return_date_utc: now
    });
  } catch (error) {
    console.error('❌ Error in clockout:', error);
    return res.json({ msg: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ส่งแจ้งเตือน Telegram
app.post('/api/sendnotify', async (req, res) => {
  console.log('📢 API: sendnotify - ส่งแจ้งเตือน Telegram', req.body);
  
  try {
    const { message, token, chat_id, lat, lon } = req.body;
    
    if (!token || !chat_id || !message) {
      return res.json({ success: false, msg: 'ข้อมูลไม่ครบถ้วน' });
    }
    
    let notifyMessage = message;
    
    if (lat && lon) {
      notifyMessage += `\nพิกัด: https://www.google.com/maps?q=${lat},${lon}`;
    }
    
    console.log('Sending Telegram message:', notifyMessage);
    
    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chat_id,
          text: notifyMessage
        },
        { timeout: 10000 }
      );
      
      console.log('Telegram response:', response.data);
      res.json({ success: true });
    } catch (error) {
      console.error('Error sending Telegram message:', error.response?.data || error.message);
      res.json({ success: false, error: error.response?.data?.message || error.message });
    }
  } catch (error) {
    console.error('Error in sendnotify:', error);
    res.json({ success: false, error: error.message });
  }
});

// ⭐ ฟังก์ชันส่งแจ้งเตือนที่ปรับปรุงแล้ว
async function sendNotification(type, employee, timestamp, userinfo, lat, lon, line_name) {
  try {
    const notifySettingResult = await db.query(
      'SELECT setting_value FROM settings WHERE setting_name = $1',
      [type === 'clock_in' ? 'notify_clock_in' : 'notify_clock_out']
    );

    if (notifySettingResult.rows.length === 0 || notifySettingResult.rows[0].setting_value !== '1') {
      return;
    }

    const date = new Date(timestamp);
    const thaiFormatter = new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const thaiDate = thaiFormatter.format(date);

    const hours = String(date.getUTCHours() + 7).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const returnDate = `${hours}:${minutes}:${seconds}`;

    const location = lat && lon ? `${lat}, ${lon}` : "ไม่มีข้อมูล";

    let message = type === 'clock_in' 
      ? `⏱ ลงเวลาเข้างาน\n`
      : `⏱ ลงเวลาออกงาน\n`;
    
    message += `👤 ชื่อ-นามสกุล: *${employee}*\n`;
    message += `📅 วันที่: *${thaiDate}*\n`;
    message += `🕒 เวลา: *${returnDate}*\n`;
    
    if (line_name) message += `💬 ชื่อไลน์: *${line_name}*\n`;
    if (userinfo && type === 'clock_in') message += `📝 หมายเหตุ: *${userinfo}*\n`;
    if (lat && lon) {
      message += `📍 พิกัด: *${location}*\n`;
      message += `🗺 แผนที่: [ดูแผนที่](https://www.google.com/maps/place/${lat},${lon})`;
    } else {
      message += "📍 พิกัด: *ไม่มีข้อมูล*";
    }

    await sendTelegramToAllGroups(message, lat, lon, employee);
  } catch (error) {
    console.error('❌ Error in sendNotification:', error);
  }
}

// ⭐ ฟังก์ชันส่ง Telegram ที่ปรับปรุงแล้ว (ต่อจากส่วนที่ 1)
async function sendTelegramToAllGroups(message, lat, lon, employee) {
  try {
    const [tokenResult, gasUrlResult, groupsResult] = await Promise.all([
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['telegram_bot_token']),
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['gas_web_app_url']),
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['telegram_groups'])
    ]);
    
    if (tokenResult.rows.length === 0 || !tokenResult.rows[0].setting_value) {
      console.error('❌ Error getting Telegram token or token not set');
      return;
    }
    
    let gasUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
    if (gasUrlResult.rows.length > 0 && gasUrlResult.rows[0].setting_value) {
      gasUrl = gasUrlResult.rows[0].setting_value.trim();
    } else {
      console.log('ไม่พบ URL ของ GSA ในฐานข้อมูล ใช้ค่าเริ่มต้น');
    }
    
    if (groupsResult.rows.length === 0 || !groupsResult.rows[0].setting_value) {
      console.error('❌ No Telegram groups configured');
      return;
    }
    
    const token = tokenResult.rows[0].setting_value;
    
    try {
      const groups = JSON.parse(groupsResult.rows[0].setting_value);
      
      // ส่งแจ้งเตือนแบบ parallel
      const promises = groups
        .filter(group => group.active && group.chat_id)
        .map(async (group) => {
          try {
            console.log(`Sending message to ${group.name} (${group.chat_id}) via GSA`);
            
            const jsonData = {
              message: message,
              chatId: group.chat_id,
              token: token
            };
            
            if (lat && lon) {
              jsonData.lat = lat;
              jsonData.lon = lon;
            }
            
            const encodedData = encodeURIComponent(JSON.stringify(jsonData));
            const urlWithParams = `${gasUrl}?opt=sendToTelegram&data=${encodedData}`;
            
            console.log('Sending request to GSA:', urlWithParams);
            
            const response = await axios.get(urlWithParams, { timeout: 10000 });
            
            console.log(`✅ Message sent to ${group.name} via GSA successfully:`, response.data);
            return response.data;
          } catch (error) {
            console.error(`❌ Error sending message to ${group.name} via GSA:`, error.message);
            console.error('Error details:', error.response?.data || error);
            return null;
          }
        });
    
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('❌ Error parsing Telegram groups:', error.message);
    }
  } catch (error) {
    console.error('❌ Error in sendTelegramToAllGroups:', error.message);
  }
}

// API สำหรับตั้งค่า URL ของ Google Apps Script
app.post('/api/admin/set-gas-url', async (req, res) => {
  console.log('🔧 API: admin/set-gas-url - ตั้งค่า URL ของ GSA', req.body);
  
  try {
    const { gas_url } = req.body;
    
    if (!gas_url) {
      return res.json({ success: false, message: 'กรุณาระบุ URL' });
    }
    
    await db.query(
      'INSERT INTO settings (setting_name, setting_value, description) VALUES ($1, $2, $3) ON CONFLICT (setting_name) DO UPDATE SET setting_value = $2',
      ['gas_web_app_url', gas_url, 'URL ของ Google Apps Script Web App']
    );
    
    console.log('GAS URL updated:', gas_url);
    res.json({ success: true, message: 'บันทึก URL เรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error setting GAS URL:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ทดสอบการส่งข้อความผ่าน GSA
app.post('/api/admin/test-gas', async (req, res) => {
  console.log('🧪 API: admin/test-gas - ทดสอบการส่งข้อความผ่าน GSA', req.body);
  
  try {
    const { message, lat, lon, gasUrl } = req.body;
    
    if (!message) {
      return res.json({ success: false, message: 'กรุณาระบุข้อความ' });
    }
    
    let useGasUrl = gasUrl;
    
    if (!useGasUrl) {
      const gasUrlResult = await db.query(
        'SELECT setting_value FROM settings WHERE setting_name = $1',
        ['gas_web_app_url']
      );
      
      if (gasUrlResult.rows.length === 0 || !gasUrlResult.rows[0].setting_value) {
        return res.json({ success: false, message: 'ไม่พบ URL ของ GSA กรุณาตั้งค่าก่อน' });
      }
      
      useGasUrl = gasUrlResult.rows[0].setting_value.trim();
    } else {
      useGasUrl = useGasUrl.trim();
    }
    
    if (!useGasUrl.startsWith('https://')) {
      return res.json({ success: false, message: 'URL ของ GSA ต้องขึ้นต้นด้วย https://' });
    }
    
    console.log('ใช้ URL GSA สำหรับทดสอบ:', useGasUrl);
    
    const [tokenResult, groupsResult] = await Promise.all([
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['telegram_bot_token']),
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['telegram_groups'])
    ]);
    
    if (tokenResult.rows.length === 0 || !tokenResult.rows[0].setting_value) {
      return res.json({ success: false, message: 'ไม่พบ Token ของ Telegram กรุณาตั้งค่าก่อน' });
    }
    
    if (groupsResult.rows.length === 0 || !groupsResult.rows[0].setting_value) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลกลุ่ม Telegram กรุณาตั้งค่าก่อน' });
    }
    
    const token = tokenResult.rows[0].setting_value;
    const groups = JSON.parse(groupsResult.rows[0].setting_value);
    const activeGroup = groups.find(g => g.active && g.chat_id);
    
    if (!activeGroup) {
      return res.json({ success: false, message: 'ไม่พบกลุ่ม Telegram ที่เปิดใช้งาน' });
    }
    
    const jsonData = {
      message: message,
      chatId: activeGroup.chat_id,
      token: token
    };
    
    if (lat && lon) {
      jsonData.lat = lat;
      jsonData.lon = lon;
    }
    
    console.log('ข้อมูลที่ส่งไป GSA:', JSON.stringify(jsonData));
    
    const encodedData = encodeURIComponent(JSON.stringify(jsonData));
    const urlWithParams = `${useGasUrl}?opt=sendToTelegram&data=${encodedData}`;
    
    console.log('URL ที่เรียก:', urlWithParams);
    
    const response = await axios.get(urlWithParams, { timeout: 15000 });
    
    console.log('การตอบกลับจาก GSA:', response.data);
    res.json({ 
      success: true, 
      message: 'ส่งข้อความทดสอบเรียบร้อยแล้ว', 
      response: response.data 
    });
  } catch (error) {
    console.error('Error testing GAS:', error);
    console.error('Error details:', error.response?.data || error);
    res.json({ 
      success: false, 
      message: 'เกิดข้อผิดพลาด: ' + error.message,
      error: error.response?.data || error.message
    });
  }
});

// ตรวจสอบการตั้งค่าว่าใช้ GSA หรือไม่
async function isUsingGasForTelegram() {
  try {
    const result = await db.query(
      'SELECT setting_value FROM settings WHERE setting_name = $1',
      ['use_gas_for_telegram']
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].setting_value === '1';
    }
    
    return true; // ค่าเริ่มต้นคือใช้ GSA
  } catch (error) {
    console.error('Error checking if using GAS for Telegram:', error.message);
    return true;
  }
}

// --- API สำหรับระบบแอดมิน ---

// ตรวจสอบการเข้าสู่ระบบแอดมิน
app.post('/api/admin/login', async (req, res) => {
  console.log('🔐 API: admin/login - ตรวจสอบการเข้าสู่ระบบแอดมิน', req.body);
  
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    
    console.log(`Login attempt: ${username}`);
    
    // ตรวจสอบด้วยค่าเริ่มต้น admin/admin123 ก่อน
    if (username === 'admin' && password === 'admin123') {
      console.log('Admin login successful with default credentials');
      return res.json({ success: true });
    }
    
    // ตรวจสอบกับข้อมูลในฐานข้อมูล
    const [adminUserResult, adminPassResult] = await Promise.all([
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['admin_username']),
      db.query('SELECT setting_value FROM settings WHERE setting_name = $1', ['admin_password'])
    ]);
    
    if (adminUserResult.rows.length === 0 || adminPassResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลผู้ดูแลระบบ' });
    }
    
    if (username === adminUserResult.rows[0].setting_value && 
        password === adminPassResult.rows[0].setting_value) {
      console.log('Admin login successful with database credentials');
      return res.json({ success: true });
    }
    
    console.log('Admin login failed: invalid credentials');
    return res.json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  } catch (error) {
    console.error('Error in admin login:', error);
    return res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - ดึงข้อมูลการลงเวลาทั้งหมด (ปรับปรุงประสิทธิภาพ)
app.get('/api/admin/time-logs', async (req, res) => {
  console.log('📊 API: admin/time-logs - ดึงข้อมูลการลงเวลาทั้งหมด', req.query);
  
  try {
    const { from_date, to_date, employee_id, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT t.id, e.emp_code, e.full_name, e.position, e.department, 
             t.clock_in, t.clock_out, t.note, t.status,
             t.latitude_in, t.longitude_in, t.latitude_out, t.longitude_out
      FROM time_logs t
      JOIN employees e ON t.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (from_date) {
      query += ` AND DATE(t.clock_in) >= $${paramIndex++}`;
      params.push(from_date);
    }
    
    if (to_date) {
      query += ` AND DATE(t.clock_in) <= $${paramIndex++}`;
      params.push(to_date);
    }
    
    if (employee_id) {
      query += ` AND t.employee_id = $${paramIndex++}`;
      params.push(employee_id);
    }
    
    query += ` ORDER BY t.clock_in DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    console.log('Running query:', query, 'with params:', params);
    
    const result = await db.query(query, params);
    
    console.log(`Found ${result.rows.length} time logs`);
    
    // ปรับรูปแบบวันที่เวลาให้อ่านง่าย
    const formattedLogs = result.rows.filter(log => log && log.clock_in).map(log => {
      const clockInDate = new Date(new Date(log.clock_in).getTime() + (7 * 60 * 60 * 1000));
      const clockOutDate = log.clock_out ? new Date(new Date(log.clock_out).getTime() + (7 * 60 * 60 * 1000)) : null;
      
      return {
        ...log,
        clock_in_date: clockInDate.toLocaleDateString('th-TH'),
        clock_in_time: clockInDate.toLocaleTimeString('th-TH'),
        clock_out_date: clockOutDate ? clockOutDate.toLocaleDateString('th-TH') : '',
        clock_out_time: clockOutDate ? clockOutDate.toLocaleTimeString('th-TH') : '',
        duration: clockOutDate ? calculateDuration(new Date(log.clock_in), new Date(log.clock_out)) : ''
      };
    });
    
    res.json({ success: true, logs: formattedLogs });
  } catch (error) {
    console.error('Error getting time logs:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - ดึงข้อมูลพนักงานทั้งหมด (ปรับปรุงประสิทธิภาพ)
app.get('/api/admin/employees', async (req, res) => {
  console.log('👥 API: admin/employees - ดึงข้อมูลพนักงานทั้งหมด');
  
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const result = await db.query(`
      SELECT id, emp_code, full_name, position, department, 
             line_id, line_name, status, created_at
      FROM employees
      ORDER BY emp_code
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    console.log(`Found ${result.rows.length} employees`);
    res.json({ success: true, employees: result.rows });
  } catch (error) {
    console.error('Error getting employees:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - เพิ่มข้อมูลการลงเวลาใหม่ (ปรับปรุงประสิทธิภาพ)
app.post('/api/admin/time-logs', async (req, res) => {
  console.log('➕ API: admin/time-logs POST - เพิ่มข้อมูลการลงเวลาใหม่', req.body);
  
  try {
    const { employee_id, clock_in, clock_out, note, skip_notification } = req.body;
    
    if (!employee_id || !clock_in) {
      return res.json({ success: false, message: 'กรุณาระบุข้อมูลที่จำเป็น' });
    }
    
    const empResult = await db.query('SELECT id, full_name FROM employees WHERE id = $1', [employee_id]);
    
    if (empResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const employee = empResult.rows[0];
    
    console.log('🚀 Starting time processing...');
    
    const adjustedClockIn = processAdminDateTime(clock_in);
    const adjustedClockOut = clock_out ? processAdminDateTime(clock_out) : null;
    
    console.log('✅ Time processing completed');
    console.log('📊 Final times for database:');
    console.log('   Clock In (UTC):', adjustedClockIn);
    console.log('   Clock Out (UTC):', adjustedClockOut);
    
    if (adjustedClockIn) {
      const testDisplay = new Date(adjustedClockIn);
      const thaiDisplay = new Date(testDisplay.getTime() + (7 * 60 * 60 * 1000));
      console.log('🇹🇭 Will display as Thai time:', thaiDisplay.toLocaleString('th-TH'));
    }
    
    const insertQuery = `
      INSERT INTO time_logs (employee_id, clock_in, clock_out, note, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    
    const result = await db.query(insertQuery, [
      employee_id, 
      adjustedClockIn, 
      adjustedClockOut, 
      note || null,
      'manual'
    ]);
    
    const newId = result.rows[0].id;
    console.log(`✅ Added new time log with ID: ${newId}`);
    
    // ส่งแจ้งเตือนถ้าไม่ได้ข้ามการแจ้งเตือน
    if (!skip_notification) {
      setImmediate(async () => {
        try {
          const notifySettingResult = await db.query(
            'SELECT setting_value FROM settings WHERE setting_name = $1',
            ['notify_clock_in']
          );
          
          if (notifySettingResult.rows.length > 0 && notifySettingResult.rows[0].setting_value === '1') {
            const clockInForNotify = new Date(adjustedClockIn);
            const thaiTimeForNotify = new Date(clockInForNotify.getTime() + (7 * 60 * 60 * 1000));
            
            const thaiDate = thaiTimeForNotify.toLocaleDateString('th-TH');
            const timeStr = thaiTimeForNotify.toLocaleTimeString('th-TH');
            
            let message =
              `⏱ ลงเวลาเข้างาน (บันทึกโดยแอดมิน)\n` +
              `👤 ชื่อ-นามสกุล: *${employee.full_name}*\n` +
              `📅 วันที่: *${thaiDate}*\n` +
              `🕒 เวลา: *${timeStr}*\n` +
              (note ? `📝 หมายเหตุ: *${note}*\n` : "");
            
            await sendTelegramToAllGroups(message, null, null, employee.full_name);
          }
          
          if (adjustedClockOut) {
            const notifyOutSettingResult = await db.query(
              'SELECT setting_value FROM settings WHERE setting_name = $1',
              ['notify_clock_out']
            );
            
            if (notifyOutSettingResult.rows.length > 0 && notifyOutSettingResult.rows[0].setting_value === '1') {
              const clockOutForNotify = new Date(adjustedClockOut);
              const thaiTimeForNotify = new Date(clockOutForNotify.getTime() + (7 * 60 * 60 * 1000));
              
              const thaiDate = thaiTimeForNotify.toLocaleDateString('th-TH');
              const timeStr = thaiTimeForNotify.toLocaleTimeString('th-TH');
              
              let message =
                `⏱ ลงเวลาออกงาน (บันทึกโดยแอดมิน)\n` +
                `👤 ชื่อ-นามสกุล: *${employee.full_name}*\n` +
                `📅 วันที่: *${thaiDate}*\n` +
                `🕒 เวลา: *${timeStr}*\n`;
              
              await sendTelegramToAllGroups(message, null, null, employee.full_name);
            }
          }
        } catch (notifyError) {
          console.error('⚠️ Error sending notification:', notifyError.message);
        }
      });
    }
    
    res.json({ success: true, message: 'เพิ่มข้อมูลการลงเวลาเรียบร้อยแล้ว', id: newId });
    
  } catch (error) {
    console.error('❌ Error adding time log:', error);
    console.error('📋 Stack trace:', error.stack);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - แก้ไขข้อมูลการลงเวลา
app.put('/api/admin/time-logs/:id', async (req, res) => {
  console.log('✏️ API: admin/time-logs/:id PUT - แก้ไขข้อมูลการลงเวลา', req.params, req.body);
  
  try {
    const { id } = req.params;
    const { clock_in, clock_out, note } = req.body;
    
    const checkResult = await db.query('SELECT id FROM time_logs WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลการลงเวลา' });
    }
    
    console.log('🚀 Starting time processing for update...');
    
    const adjustedClockIn = processAdminDateTime(clock_in);
    const adjustedClockOut = clock_out ? processAdminDateTime(clock_out) : null;
    
    console.log('✅ Time processing for update completed');
    console.log('📊 Final times for database update:');
    console.log('   Clock In (UTC):', adjustedClockIn);
    console.log('   Clock Out (UTC):', adjustedClockOut);
    
    const updateQuery = `
      UPDATE time_logs SET 
      clock_in = $1, 
      clock_out = $2, 
      note = $3
      WHERE id = $4
    `;
    
    await db.query(updateQuery, [adjustedClockIn, adjustedClockOut, note, id]);
    
    console.log(`✅ Updated time log ID: ${id}`);
    res.json({ success: true, message: 'แก้ไขข้อมูลการลงเวลาเรียบร้อยแล้ว' });
    
  } catch (error) {
    console.error('❌ Error updating time log:', error);
    console.error('📋 Stack trace:', error.stack);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - ลบข้อมูลการลงเวลา
app.delete('/api/admin/time-logs/:id', async (req, res) => {
  console.log('🗑️ API: admin/time-logs/:id DELETE - ลบข้อมูลการลงเวลา', req.params);
  
  try {
    const { id } = req.params;
    
    const checkResult = await db.query('SELECT id FROM time_logs WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลการลงเวลา' });
    }
    
    await db.query('DELETE FROM time_logs WHERE id = $1', [id]);
    
    console.log(`Deleted time log ID: ${id}`);
    res.json({ success: true, message: 'ลบข้อมูลการลงเวลาเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error deleting time log:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// ⭐ API - เพิ่มพนักงานใหม่ (ล้าง cache)
app.post('/api/admin/employees', async (req, res) => {
  console.log('➕ API: admin/employees POST - เพิ่มพนักงานใหม่', req.body);
  
  try {
    const { emp_code, full_name, position, department } = req.body;
    
    if (!emp_code || !full_name) {
      return res.json({ success: false, message: 'กรุณาระบุรหัสพนักงานและชื่อ-นามสกุล' });
    }
    
    const checkResult = await db.query('SELECT id FROM employees WHERE emp_code = $1', [emp_code]);
    
    if (checkResult.rows.length > 0) {
      return res.json({ success: false, message: 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว' });
    }
    
    const insertResult = await db.query(
      `INSERT INTO employees (emp_code, full_name, position, department, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [emp_code, full_name, position || null, department || null, 'active']
    );
    
    // ล้าง cache
    clearEmployeeCache();
    
    const newId = insertResult.rows[0].id;
    
    console.log(`เพิ่มพนักงานใหม่สำเร็จ ID: ${newId}`);
    res.json({ 
      success: true, 
      message: 'เพิ่มพนักงานเรียบร้อยแล้ว',
      id: newId
    });
    
  } catch (error) {
    console.error('Error adding employee:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - แก้ไขข้อมูลพนักงาน
app.put('/api/admin/employees/:id', async (req, res) => {
  console.log('API: admin/employees/:id PUT - แก้ไขข้อมูลพนักงาน', req.params, req.body);
  
  try {
    const { id } = req.params;
    const { emp_code, full_name, position, department, status } = req.body;
    
    if (!emp_code || !full_name) {
      return res.json({ success: false, message: 'กรุณาระบุรหัสพนักงานและชื่อ-นามสกุล' });
    }
    
    // ตรวจสอบว่ามีพนักงานนี้ในระบบหรือไม่
    const checkResult = await db.query('SELECT id FROM employees WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    // ตรวจสอบว่ารหัสพนักงานซ้ำกับคนอื่นหรือไม่ (ยกเว้นตัวเอง)
    const duplicateResult = await db.query(
      'SELECT id FROM employees WHERE emp_code = $1 AND id != $2',
      [emp_code, id]
    );
    
    if (duplicateResult.rows.length > 0) {
      return res.json({ success: false, message: 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว' });
    }
    
    // แก้ไขข้อมูลพนักงาน
    const updateQuery = `
      UPDATE employees SET 
      emp_code = $1, 
      full_name = $2, 
      position = $3, 
      department = $4,
      status = $5
      WHERE id = $6
    `;
    
    await db.query(updateQuery, [
      emp_code, 
      full_name, 
      position || null, 
      department || null,
      status || 'active',
      id
    ]);
    
    console.log(`แก้ไขข้อมูลพนักงาน ID: ${id} เรียบร้อยแล้ว`);
    res.json({ success: true, message: 'แก้ไขข้อมูลพนักงานเรียบร้อยแล้ว' });
    
  } catch (error) {
    console.error('Error updating employee:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ลบพนักงาน (soft delete)
app.delete('/api/admin/employees/:id', async (req, res) => {
  console.log('API: admin/employees DELETE - ลบพนักงาน', req.params);
  
  try {
    const { id } = req.params;
    
    // ตรวจสอบว่าพนักงานมีในระบบหรือไม่
    const employeeResult = await db.query(
      'SELECT id, full_name FROM employees WHERE id = $1',
      [id]
    );
    
    if (employeeResult.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const employee = employeeResult.rows[0];
    
    // ลบพนักงาน
    await db.query(
      'DELETE FROM employees WHERE id = $1',
      [id]
    );
    
    console.log('Permanently deleted employee with ID:', id, '(', employee.full_name, ')');
    res.json({ success: true, message: 'ลบพนักงานเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ดึงการตั้งค่าทั้งหมด
app.get('/api/admin/settings', async (req, res) => {
  console.log('API: admin/settings - ดึงการตั้งค่าทั้งหมด');
  
  try {
    const result = await db.query('SELECT * FROM settings');
    
    // ซ่อนรหัสผ่านแอดมิน
    const filteredSettings = result.rows.map(setting => {
      if (setting.setting_name === 'admin_password') {
        return { ...setting, setting_value: '' };
      }
      return setting;
    });
    
    console.log(`Found ${result.rows.length} settings`);
    res.json({ success: true, settings: filteredSettings });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - บันทึกการตั้งค่า
app.post('/api/admin/settings', async (req, res) => {
  console.log('API: admin/settings POST - บันทึกการตั้งค่า', req.body);
  
  try {
    const { settings } = req.body;
    
    if (!Array.isArray(settings) || settings.length === 0) {
      return res.json({ success: false, message: 'ข้อมูลไม่ถูกต้อง' });
    }
    
    const client = await pool.connect();
    
    try {
      // เริ่มต้น transaction
      await client.query('BEGIN');
      
      // บันทึกการตั้งค่าทีละรายการ
      for (const setting of settings) {
        if (setting.name && setting.value !== undefined) {
          await client.query(
            'UPDATE settings SET setting_value = $1 WHERE setting_name = $2',
            [setting.value, setting.name]
          );
        }
      }
      
      await client.query('COMMIT');
      console.log('Settings updated successfully');
      res.json({ success: true, message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error updating settings:', err);
      res.json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า: ' + err.message });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating settings:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ดึงข้อมูลรายงานสรุป
app.get('/api/admin/dashboard', async (req, res) => {
  console.log('API: admin/dashboard - ดึงข้อมูลรายงานสรุป');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // จำนวนพนักงานทั้งหมด
    const totalEmployeesResult = await db.query(
      'SELECT COUNT(*) as count FROM employees WHERE status = $1',
      ['active']
    );
    const totalEmployees = parseInt(totalEmployeesResult.rows[0].count);
    
    // จำนวนพนักงานที่ลงเวลาวันนี้
    const checkedInTodayResult = await db.query(
      `SELECT COUNT(DISTINCT employee_id) as count 
       FROM time_logs 
       WHERE DATE(clock_in) = $1`,
      [today]
    );
    const checkedInToday = parseInt(checkedInTodayResult.rows[0].count);
    
    // จำนวนพนักงานที่ยังไม่ลงเวลาออกวันนี้
    const notCheckedOutTodayResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM time_logs 
       WHERE DATE(clock_in) = $1 AND clock_out IS NULL`,
      [today]
    );
    const notCheckedOutToday = parseInt(notCheckedOutTodayResult.rows[0].count);
    
    // ข้อมูลการลงเวลาล่าสุด 10 รายการ
    const recentLogsResult = await db.query(
      `SELECT t.id, e.emp_code, e.full_name, t.clock_in, t.clock_out, t.note
       FROM time_logs t
       JOIN employees e ON t.employee_id = e.id
       ORDER BY t.clock_in DESC
       LIMIT 10`
    );
    
    // ปรับรูปแบบวันที่เวลา และตรวจสอบค่า null
    const formattedLogs = recentLogsResult.rows.filter(log => log && log.clock_in).map(log => {
      // ปรับเวลาให้เป็นเวลาไทย
      const clockInDate = new Date(new Date(log.clock_in).getTime() + (7 * 60 * 60 * 1000));
      const clockOutDate = log.clock_out ? new Date(new Date(log.clock_out).getTime() + (7 * 60 * 60 * 1000)) : null;
      
      return {
        ...log,
        clock_in_date: clockInDate.toLocaleDateString('th-TH'),
        clock_in_time: clockInDate.toLocaleTimeString('th-TH'),
        clock_out_time: clockOutDate ? clockOutDate.toLocaleTimeString('th-TH') : ''
      };
    });
    
    console.log('Dashboard data fetched successfully');
    
    res.json({
      success: true,
      dashboard: {
        totalEmployees,
        checkedInToday,
        notCheckedOutToday,
        recentLogs: formattedLogs
      }
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API พิเศษสำหรับรีเซ็ตข้อมูลแอดมิน
app.get('/api/reset-admin', async (req, res) => {
  console.log('API: reset-admin - รีเซ็ตข้อมูลแอดมิน');
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // ลบข้อมูลเดิม (ถ้ามี)
      await client.query(
        'DELETE FROM settings WHERE setting_name = $1 OR setting_name = $2',
        ['admin_username', 'admin_password']
      );
      
      // เพิ่มข้อมูลใหม่
      await client.query(
        'INSERT INTO settings (setting_name, setting_value, description) VALUES ($1, $2, $3)',
        ['admin_username', 'admin', 'ชื่อผู้ใช้สำหรับแอดมิน']
      );
      
      await client.query(
        'INSERT INTO settings (setting_name, setting_value, description) VALUES ($1, $2, $3)',
        ['admin_password', 'admin123', 'รหัสผ่านสำหรับแอดมิน']
      );
      
      await client.query('COMMIT');
      console.log('Admin credentials reset successfully');
      res.json({ success: true, message: 'รีเซ็ตข้อมูลแอดมินเรียบร้อยแล้ว' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error resetting admin credentials:', err);
      res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error resetting admin:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ดึง LIFF ID
app.get('/api/getLiffId', async (req, res) => {
  console.log('API: getLiffId - ดึง LIFF ID');
  
  try {
    const result = await db.query(
      'SELECT setting_value FROM settings WHERE setting_name = $1',
      ['liff_id']
    );
    
    if (result.rows.length > 0) {
      return res.json({ success: true, liffId: result.rows[0].setting_value });
    } else {
      // ถ้าไม่พบ LIFF ID ในฐานข้อมูล ให้ใช้ค่าเริ่มต้น
      return res.json({ success: true, liffId: '2001032478-VR5Akj0k' });
    }
  } catch (error) {
    console.error('Error getting LIFF ID:', error);
    return res.json({ success: false, error: error.message });
  }
});

// API - ทดสอบการลงเวลาเข้า (สำหรับการทดสอบโดยไม่ต้องผ่าน LIFF)
app.post('/api/test-clockin', async (req, res) => {
  console.log('API: test-clockin - ทดสอบการลงเวลาเข้า', req.body);
  
  try {
    const { employee, userinfo } = req.body;
    
    // ตรวจสอบว่ามีชื่อพนักงาน
    if (!employee) {
      return res.json({ msg: 'กรุณาระบุชื่อพนักงาน' });
    }
    
    // ค้นหาพนักงานจากชื่อหรือรหัส
    const empResult = await db.query('SELECT id FROM employees WHERE emp_code = $1 OR full_name = $1', [employee]);
    
    if (empResult.rows.length === 0) {
      return res.json({ msg: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const emp = empResult.rows[0];
    
    // ตรวจสอบว่าลงเวลาเข้าซ้ำหรือไม่
    const today = new Date().toISOString().split('T')[0];
    
    const checkExistingResult = await db.query(
      'SELECT id FROM time_logs WHERE employee_id = $1 AND DATE(clock_in) = $2',
      [emp.id, today]
    );
    
    if (checkExistingResult.rows.length > 0) {
      return res.json({ 
        msg: 'คุณได้ลงเวลาเข้าแล้ววันนี้', 
        employee
      });
    }
    
    // บันทึกเวลาเข้า
    const now = new Date().toISOString();
    
    await db.query(
      `INSERT INTO time_logs 
      (employee_id, clock_in, note, latitude_in, longitude_in)
      VALUES ($1, $2, $3, $4, $5)`,
      [emp.id, now, userinfo || null, 13.7563 || null, 100.5018 || null]
    );
    
    // ปรับเวลาเป็นเวลาไทย
    const utcTime = new Date(now);
    const thaiTime = new Date(utcTime.getTime() + (7 * 60 * 60 * 1000));
    const returnDate = thaiTime.toLocaleTimeString('th-TH');
    
    return res.json({
      msg: 'SUCCESS',
      employee,
      return_date: returnDate,
      return_date_utc: now
    });
  } catch (error) {
    console.error('Error in test clockin:', error);
    return res.json({ msg: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ทดสอบการลงเวลาออก (สำหรับการทดสอบโดยไม่ต้องผ่าน LIFF)
app.post('/api/test-clockout', async (req, res) => {
  console.log('API: test-clockout - ทดสอบการลงเวลาออก', req.body);
  
  try {
    const { employee } = req.body;
    
    // ตรวจสอบว่ามีชื่อพนักงาน
    if (!employee) {
      return res.json({ msg: 'กรุณาระบุชื่อพนักงาน' });
    }
    
    // ค้นหาพนักงานจากชื่อหรือรหัส
    const empResult = await db.query(
      'SELECT id FROM employees WHERE emp_code = $1 OR full_name = $1',
      [employee]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ msg: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const emp = empResult.rows[0];
    
    // ตรวจสอบว่าลงเวลาเข้าวันนี้หรือไม่
    const today = new Date().toISOString().split('T')[0];
    
    const recordResult = await db.query(
      'SELECT id, clock_out FROM time_logs WHERE employee_id = $1 AND DATE(clock_in) = $2 ORDER BY clock_in DESC LIMIT 1',
      [emp.id, today]
    );
    
    if (recordResult.rows.length === 0) {
      return res.json({ 
        msg: 'คุณยังไม่ได้ลงเวลาเข้าวันนี้', 
        employee
      });
    }
    
    const record = recordResult.rows[0];
    
    if (record.clock_out) {
      return res.json({ 
        msg: 'คุณได้ลงเวลาออกแล้ววันนี้', 
        employee
      });
    }
    
    // บันทึกเวลาออก
    const now = new Date().toISOString();
    
    await db.query(
      `UPDATE time_logs SET 
      clock_out = $1, latitude_out = $2, longitude_out = $3
      WHERE id = $4`,
      [now, 13.7563 || null, 100.5018 || null, record.id]
    );
    
    // ปรับเวลาเป็นเวลาไทย
    const utcTime = new Date(now);
    const thaiTime = new Date(utcTime.getTime() + (7 * 60 * 60 * 1000));
    const returnDate = thaiTime.toLocaleTimeString('th-TH');
    
    return res.json({
      msg: 'SUCCESS',
      employee,
      return_date: returnDate,
      return_date_utc: now
    });
  } catch (error) {
    console.error('Error in test clockout:', error);
    return res.json({ msg: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ดึงข้อมูลบันทึกเวลาเฉพาะรายการ
app.get('/api/admin/time-logs/:id', async (req, res) => {
  console.log('API: admin/time-logs/:id - ดึงข้อมูลการลงเวลาเฉพาะรายการ', req.params);
  
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT t.id, t.employee_id, e.emp_code, e.full_name, e.position, e.department, 
             t.clock_in, t.clock_out, t.note, t.status
      FROM time_logs t
      JOIN employees e ON t.employee_id = e.id
      WHERE t.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลการลงเวลา' });
    }
    
    const log = result.rows[0];
    
    res.json({ success: true, log });
  } catch (error) {
    console.error('Error getting time log:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// เพิ่ม API สำหรับดึงค่าชดเชยเวลา
app.get('/api/getTimeOffset', async (req, res) => {
  console.log('API: getTimeOffset - ดึงค่าชดเชยเวลา');
  
  try {
    const result = await db.query(
      'SELECT setting_value FROM settings WHERE setting_name = $1',
      ['time_offset']
    );
    
    if (result.rows.length > 0) {
      return res.json({ success: true, time_offset: result.rows[0].setting_value });
    } else {
      // ถ้าไม่พบค่าชดเชยเวลาในฐานข้อมูล ให้ใช้ค่าเริ่มต้น
      return res.json({ success: true, time_offset: 420 }); // ตั้งค่าเริ่มต้นเป็น 7 ชั่วโมง (420 นาที)
    }
  } catch (error) {
    console.error('Error getting time offset:', error);
    return res.json({ success: false, error: error.message });
  }
});

// API - นำเข้ารายชื่อพนักงานจาก Excel/CSV
app.post('/api/admin/import-employees', async (req, res) => {
  console.log('API: admin/import-employees - นำเข้ารายชื่อพนักงานจากไฟล์', req.body);
  
  try {
    const { employees, skipExisting } = req.body;
    
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.json({ success: false, message: 'ไม่มีข้อมูลที่จะนำเข้า' });
    }
    
    // ตรวจสอบว่าข้อมูลมีรูปแบบถูกต้องหรือไม่
    for (const emp of employees) {
      if (!emp.emp_code || !emp.full_name) {
        return res.json({ 
          success: false, 
          message: 'ข้อมูลไม่ถูกต้อง ต้องมีรหัสพนักงานและชื่อพนักงาน' 
        });
      }
    }
    
    // เตรียมข้อมูลสำหรับส่งกลับ
    const result = {
      success: true,
      total: employees.length,
      imported: 0,
      skipped: 0,
      errors: []
    };
    
    // เริ่มการนำเข้าข้อมูล
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const emp of employees) {
        try {
          // ตรวจสอบว่ามีรหัสพนักงานนี้ในระบบแล้วหรือไม่
          const checkResult = await client.query(
            'SELECT id FROM employees WHERE emp_code = $1',
            [emp.emp_code]
          );
          
          if (checkResult.rows.length > 0) {
            // ถ้ามีรหัสพนักงานนี้แล้ว
            if (skipExisting) {
              // ข้ามรายการนี้ถ้าตั้งค่าให้ข้าม
              result.skipped++;
              continue;
            } else {
              // อัปเดตข้อมูลพนักงานถ้าไม่ข้าม
              await client.query(
                `UPDATE employees 
                 SET full_name = $1, position = $2, department = $3, status = $4
                 WHERE emp_code = $5`,
                [
                  emp.full_name,
                  emp.position || null,
                  emp.department || null,
                  emp.status || 'active',
                  emp.emp_code
                ]
              );
              
              result.imported++;
            }
          } else {
            // เพิ่มพนักงานใหม่
            await client.query(
              `INSERT INTO employees 
               (emp_code, full_name, position, department, status)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                emp.emp_code,
                emp.full_name,
                emp.position || null,
                emp.department || null,
                emp.status || 'active'
              ]
            );
            
            result.imported++;
          }
        } catch (error) {
          console.error('Error importing employee:', emp, error);
          
          // เก็บข้อผิดพลาดสำหรับรายการนี้
          result.errors.push({
            emp_code: emp.emp_code,
            full_name: emp.full_name,
            error: error.message
          });
        }
      }
      
      // บันทึกการเปลี่ยนแปลงทั้งหมด
      await client.query('COMMIT');
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in transaction:', error);
      
      return res.json({
        success: false,
        message: 'เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ' + error.message
      });
    } finally {
      client.release();
    }
    
    console.log('Import result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error importing employees:', error);
    res.json({
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + error.message
    });
  }
});

// API - เคลียร์ข้อมูลประวัติการลงเวลาตามช่วงเวลา
app.post('/api/admin/cleanup-time-logs', async (req, res) => {
  console.log('API: admin/cleanup-time-logs - เคลียร์ข้อมูลประวัติการลงเวลา', req.body);
  
  try {
    const { date_before, employee_id, export_before_delete, cleanup_type } = req.body;
    
    if (!date_before && !cleanup_type) {
      return res.json({ success: false, message: 'กรุณาระบุข้อมูลสำหรับการลบ เช่น วันที่หรือประเภทการลบ' });
    }
    
    let query = 'SELECT t.id, t.employee_id, e.emp_code, e.full_name, t.clock_in, t.clock_out, t.note, t.status FROM time_logs t JOIN employees e ON t.employee_id = e.id WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    // เงื่อนไขตามช่วงเวลา
    if (date_before) {
      query += ` AND DATE(t.clock_in) < $${paramIndex++}`;
      params.push(date_before);
    }
    
    // เงื่อนไขตามพนักงาน
    if (employee_id) {
      query += ` AND t.employee_id = $${paramIndex++}`;
      params.push(employee_id);
    }
    
    // เงื่อนไขตามประเภทการลบ
    if (cleanup_type === 'last_month') {
      // ลบข้อมูลเดือนที่แล้ว
      const lastMonthDate = new Date();
      lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
      const firstDayLastMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1);
      const lastDayLastMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0);
      
      query += ` AND DATE(t.clock_in) >= $${paramIndex++} AND DATE(t.clock_in) <= $${paramIndex++}`;
      params.push(firstDayLastMonth.toISOString().split('T')[0]);
      params.push(lastDayLastMonth.toISOString().split('T')[0]);
      
    } else if (cleanup_type === 'last_year') {
      // ลบข้อมูลปีที่แล้ว
      const lastYearDate = new Date();
      lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
      const firstDayLastYear = new Date(lastYearDate.getFullYear(), 0, 1);
      const lastDayLastYear = new Date(lastYearDate.getFullYear(), 11, 31);
      
      query += ` AND DATE(t.clock_in) >= $${paramIndex++} AND DATE(t.clock_in) <= $${paramIndex++}`;
      params.push(firstDayLastYear.toISOString().split('T')[0]);
      params.push(lastDayLastYear.toISOString().split('T')[0]);
      
    } else if (cleanup_type === 'older_than_6_months') {
      // ลบข้อมูลเก่ากว่า 6 เดือน
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      query += ` AND DATE(t.clock_in) < $${paramIndex++}`;
      params.push(sixMonthsAgo.toISOString().split('T')[0]);
      
    } else if (cleanup_type === 'older_than_1_year') {
      // ลบข้อมูลเก่ากว่า 1 ปี
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      query += ` AND DATE(t.clock_in) < $${paramIndex++}`;
      params.push(oneYearAgo.toISOString().split('T')[0]);
    }
    
    query += ' ORDER BY t.clock_in DESC';
    
    // ดึงข้อมูลที่จะลบ
    const dataToDelete = await db.query(query, params);
    
    // ถ้าไม่มีข้อมูลที่ตรงเงื่อนไข
    if (dataToDelete.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลที่ตรงตามเงื่อนไข' });
    }
    
    // ส่งออกข้อมูลก่อนลบถ้าต้องการ
    let exportData = null;
    if (export_before_delete) {
      exportData = dataToDelete.rows.map(row => {
        const clockInDate = new Date(new Date(row.clock_in).getTime() + (7 * 60 * 60 * 1000));
        const clockOutDate = row.clock_out ? new Date(new Date(row.clock_out).getTime() + (7 * 60 * 60 * 1000)) : null;
        
        return {
          emp_code: row.emp_code,
          full_name: row.full_name,
          clock_in_date: clockInDate.toLocaleDateString('th-TH'),
          clock_in_time: clockInDate.toLocaleTimeString('th-TH'),
          clock_out_date: clockOutDate ? clockOutDate.toLocaleDateString('th-TH') : '',
          clock_out_time: clockOutDate ? clockOutDate.toLocaleTimeString('th-TH') : '',
          note: row.note || '',
          status: row.status
        };
      });
    }
    
    // ลบข้อมูล
    const idsToDelete = dataToDelete.rows.map(row => row.id);
    
    // ใช้ IN clause สำหรับการลบ (สำหรับข้อมูลจำนวนมาก ควรแบ่งชุดละไม่เกิน 1000 รายการ)
    const batchSize = 1000;
    const totalRecords = idsToDelete.length;
    let deletedCount = 0;
    
    for (let i = 0; i < totalRecords; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      
      // สร้าง placeholders สำหรับ IN clause
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');
      
      // ลบข้อมูลในแต่ละชุด
      const deleteResult = await db.query(
        `DELETE FROM time_logs WHERE id IN (${placeholders})`,
        batch
      );
      
      deletedCount += deleteResult.rowCount;
    }
    
    console.log(`ลบข้อมูลทั้งหมด ${deletedCount} รายการ`);
    
    // ส่งผลลัพธ์กลับ
    res.json({
      success: true,
      message: `ลบข้อมูลเรียบร้อยแล้ว ${deletedCount} รายการ`,
      deleted_count: deletedCount,
      export_data: exportData
    });
    
  } catch (error) {
    console.error('Error cleaning up time logs:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ล้างข้อมูลพนักงานที่ไม่ได้ใช้งาน
app.post('/api/admin/cleanup-inactive-employees', async (req, res) => {
  console.log('API: admin/cleanup-inactive-employees - ล้างข้อมูลพนักงานที่ไม่ได้ใช้งาน', req.body);
  
  try {
    const { include_logs, export_before_delete } = req.body;
    
    // ค้นหาพนักงานที่มีสถานะไม่ใช้งาน
    const inactiveEmployees = await db.query(
      'SELECT id, emp_code, full_name FROM employees WHERE status = $1',
      ['inactive']
    );
    
    if (inactiveEmployees.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบพนักงานที่มีสถานะไม่ใช้งาน' });
    }
    
    // ส่งออกข้อมูลก่อนลบถ้าต้องการ
    let exportData = null;
    if (export_before_delete) {
      exportData = {
        employees: inactiveEmployees.rows.map(emp => ({
          id: emp.id,
          emp_code: emp.emp_code,
          full_name: emp.full_name
        }))
      };
      
      // ถ้าต้องการส่งออกข้อมูลการลงเวลาด้วย
      if (include_logs) {
        const employeeIds = inactiveEmployees.rows.map(emp => emp.id);
        const placeholders = employeeIds.map((_, idx) => `$${idx + 1}`).join(', ');
        
        const timeLogs = await db.query(
          `SELECT t.id, t.employee_id, e.emp_code, e.full_name, t.clock_in, t.clock_out, t.note 
           FROM time_logs t 
           JOIN employees e ON t.employee_id = e.id 
           WHERE t.employee_id IN (${placeholders})
           ORDER BY t.clock_in DESC`,
          employeeIds
        );
        
        exportData.time_logs = timeLogs.rows.map(log => {
          const clockInDate = new Date(new Date(log.clock_in).getTime() + (7 * 60 * 60 * 1000));
          const clockOutDate = log.clock_out ? new Date(new Date(log.clock_out).getTime() + (7 * 60 * 60 * 1000)) : null;
          
          return {
            id: log.id,
            emp_code: log.emp_code,
            full_name: log.full_name,
            clock_in_date: clockInDate.toLocaleDateString('th-TH'),
            clock_in_time: clockInDate.toLocaleTimeString('th-TH'),
            clock_out_date: clockOutDate ? clockOutDate.toLocaleDateString('th-TH') : '',
            clock_out_time: clockOutDate ? clockOutDate.toLocaleTimeString('th-TH') : '',
            note: log.note || ''
          };
        });
      }
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let deletedLogCount = 0;
      
      // ลบข้อมูลการลงเวลาของพนักงานที่ไม่ใช้งานถ้าต้องการ
      if (include_logs) {
        const employeeIds = inactiveEmployees.rows.map(emp => emp.id);
        
        // แบ่งเป็นชุดเพื่อป้องกันปัญหากับข้อมูลจำนวนมาก
        const batchSize = 100;
        
        for (let i = 0; i < employeeIds.length; i += batchSize) {
          const batchIds = employeeIds.slice(i, i + batchSize);
          const placeholders = batchIds.map((_, idx) => `$${idx + 1}`).join(', ');
          
          const deleteLogsResult = await client.query(
            `DELETE FROM time_logs WHERE employee_id IN (${placeholders})`,
            batchIds
          );
          
          deletedLogCount += deleteLogsResult.rowCount;
        }
      }
      
      // ลบข้อมูลพนักงานที่ไม่ใช้งาน
      const employeeIds = inactiveEmployees.rows.map(emp => emp.id);
      const placeholders = employeeIds.map((_, idx) => `$${idx + 1}`).join(', ');
      
      const deleteEmployeesResult = await client.query(
        `DELETE FROM employees WHERE id IN (${placeholders})`,
        employeeIds
      );
      
      await client.query('COMMIT');
      
      console.log(`ลบพนักงานทั้งหมด ${deleteEmployeesResult.rowCount} คน และข้อมูลการลงเวลา ${deletedLogCount} รายการ`);
      
      // ส่งผลลัพธ์กลับ
      res.json({
        success: true,
        message: `ลบพนักงานเรียบร้อยแล้ว ${deleteEmployeesResult.rowCount} คน และข้อมูลการลงเวลา ${deletedLogCount} รายการ`,
        deleted_employees: deleteEmployeesResult.rowCount,
        deleted_logs: deletedLogCount,
        export_data: exportData
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error cleaning up inactive employees:', error);
      res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error cleaning up inactive employees:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - สำรองข้อมูลไฟล์ฐานข้อมูล (สำหรับระบบ PostgreSQL บน Render.com ควรใช้วิธีสำรองผ่าน dashboard ของ Render)
app.get('/api/admin/backup-database', async (req, res) => {
  console.log('API: admin/backup-database - สำรองข้อมูลฐานข้อมูล');
  
  try {
    // ดึงข้อมูลทั้งหมดจากตาราง employees และ time_logs
    const employeesResult = await db.query('SELECT * FROM employees ORDER BY id');
    const timeLogsResult = await db.query('SELECT * FROM time_logs ORDER BY id');
    const settingsResult = await db.query('SELECT * FROM settings ORDER BY id');
    
    // สร้าง object ข้อมูลสำรอง
    const backupData = {
      timestamp: new Date().toISOString(),
      employees: employeesResult.rows,
      time_logs: timeLogsResult.rows,
      settings: settingsResult.rows.filter(s => s.setting_name !== 'admin_password') // ไม่รวมรหัสผ่านในข้อมูลสำรอง
    };
    
    // แปลงเป็น JSON
    const backupJSON = JSON.stringify(backupData, null, 2);
    
    // ส่งไฟล์ JSON กลับไปยังผู้ใช้
    res.setHeader('Content-Disposition', `attachment; filename=time_tracker_backup_${new Date().toISOString().split('T')[0]}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.send(backupJSON);
    
  } catch (error) {
    console.error('Error backing up database:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ส่งออกข้อมูลการลงเวลาเป็น CSV
app.post('/api/admin/export-time-logs', async (req, res) => {
  console.log('API: admin/export-time-logs - ส่งออกข้อมูลการลงเวลา', req.body);
  
  try {
    const { from_date, to_date, employee_id, format } = req.body;
    
    let query = `
      SELECT e.emp_code, e.full_name, e.position, e.department, 
             t.clock_in, t.clock_out, t.note, t.status,
             t.latitude_in, t.longitude_in, t.latitude_out, t.longitude_out
      FROM time_logs t
      JOIN employees e ON t.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (from_date) {
      query += ` AND DATE(t.clock_in) >= $${paramIndex++}`;
      params.push(from_date);
    }
    
    if (to_date) {
      query += ` AND DATE(t.clock_in) <= $${paramIndex++}`;
      params.push(to_date);
    }
    
    if (employee_id) {
      query += ` AND t.employee_id = $${paramIndex++}`;
      params.push(employee_id);
    }
    
    query += ' ORDER BY t.clock_in DESC';
    
    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลที่ตรงตามเงื่อนไข' });
    }
    
    // ปรับรูปแบบข้อมูลให้อ่านง่าย
    const formattedLogs = result.rows.map(log => {
      const clockInDate = new Date(new Date(log.clock_in).getTime() + (7 * 60 * 60 * 1000));
      const clockOutDate = log.clock_out ? new Date(new Date(log.clock_out).getTime() + (7 * 60 * 60 * 1000)) : null;
      
      return {
        "รหัสพนักงาน": log.emp_code,
        "ชื่อ-นามสกุล": log.full_name,
        "ตำแหน่ง": log.position || '',
        "แผนก": log.department || '',
        "วันที่เข้างาน": clockInDate.toLocaleDateString('th-TH'),
        "เวลาเข้างาน": clockInDate.toLocaleTimeString('th-TH'),
        "วันที่ออกงาน": clockOutDate ? clockOutDate.toLocaleDateString('th-TH') : '',
        "เวลาออกงาน": clockOutDate ? clockOutDate.toLocaleTimeString('th-TH') : '',
        "หมายเหตุ": log.note || '',
        "สถานะ": log.status,
        "พิกัดเข้า": log.latitude_in && log.longitude_in ? `${log.latitude_in}, ${log.longitude_in}` : '',
        "พิกัดออก": log.latitude_out && log.longitude_out ? `${log.latitude_out}, ${log.longitude_out}` : ''
      };
    });
    
    // ส่งข้อมูลกลับในรูปแบบที่ต้องการ
    res.json({
      success: true,
      data: formattedLogs,
      count: formattedLogs.length
    });
    
  } catch (error) {
    console.error('Error exporting time logs:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ลบพนักงานทั้งหมด
app.post('/api/admin/delete-all-employees', async (req, res) => {
  console.log('API: admin/delete-all-employees - ลบพนักงานทั้งหมด', req.body);
  
  try {
    const { confirm } = req.body;
    
    if (!confirm) {
      return res.json({ success: false, message: 'ต้องยืนยันการลบข้อมูล' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // ลบข้อมูลการลงเวลาทั้งหมดก่อน เนื่องจากมี foreign key
      const deleteLogsResult = await client.query('DELETE FROM time_logs');
      
      // ลบข้อมูลพนักงานทั้งหมด
      const deleteEmployeesResult = await client.query('DELETE FROM employees');
      
      await client.query('COMMIT');
      
      console.log(`ลบพนักงานทั้งหมด ${deleteEmployeesResult.rowCount} คน และข้อมูลการลงเวลา ${deleteLogsResult.rowCount} รายการ`);
      
      res.json({
        success: true,
        message: 'ลบพนักงานทั้งหมดเรียบร้อยแล้ว',
        deleted_count: deleteEmployeesResult.rowCount,
        deleted_logs: deleteLogsResult.rowCount
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting all employees:', error);
      res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error deleting all employees:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// API - ดึงข้อมูลพนักงานเฉพาะรายการ
app.get('/api/admin/employees/:id', async (req, res) => {
  console.log('API: admin/employees/:id - ดึงข้อมูลพนักงานเฉพาะรายการ', req.params);
  
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT id, emp_code, full_name, position, department, 
             line_id, line_name, status, created_at
      FROM employees
      WHERE id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }
    
    const employee = result.rows[0];
    
    res.json({ success: true, employee });
  } catch (error) {
    console.error('Error getting employee:', error);
    res.json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
});

// เพิ่ม route สำหรับหน้าแอดมิน
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', req.path));
});

// เริ่มเซิร์ฟเวอร์
// Export for Vercel
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}