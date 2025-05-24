// db-adapter.js - adapter สำหรับแปลง PostgreSQL calls เป็น Supabase REST API
const supabase = require('./supabase-client');

// Helper function เพื่อแปลง SQL-like queries เป็น Supabase REST calls
class DatabaseAdapter {
  
  // แปลง query แบบเดิมเป็น Supabase calls
  async query(sql, params = []) {
    console.log('🔄 Converting SQL to Supabase REST:', sql, params);
    
    try {
      // เช็คว่าเป็น query แบบไหน
      const sqlLower = sql.toLowerCase().trim();
      
      // SELECT queries
      if (sqlLower.startsWith('select')) {
        return await this.handleSelect(sql, params);
      }
      
      // INSERT queries  
      if (sqlLower.startsWith('insert')) {
        return await this.handleInsert(sql, params);
      }
      
      // UPDATE queries
      if (sqlLower.startsWith('update')) {
        return await this.handleUpdate(sql, params);
      }
      
      // DELETE queries
      if (sqlLower.startsWith('delete')) {
        return await this.handleDelete(sql, params);
      }
      
      // CREATE TABLE (ignore in production, tables should exist)
      if (sqlLower.includes('create table')) {
        console.log('⚠️ CREATE TABLE ignored - use Supabase dashboard');
        return { rows: [], rowCount: 0 };
      }
      
      // Special cases
      if (sqlLower.includes('select now()')) {
        return { rows: [{ now: new Date().toISOString() }] };
      }
      
      console.warn('❓ Unsupported query type:', sql);
      return { rows: [], rowCount: 0 };
      
    } catch (error) {
      console.error('❌ Query conversion error:', error);
      throw error;
    }
  }

  async handleSelect(sql, params) {
    // ตัวอย่างการแปลง SELECT queries ที่ใช้บ่อย
    const sqlLower = sql.toLowerCase();
    
    // SELECT * FROM employees WHERE emp_code = $1 OR full_name = $1
    if (sqlLower.includes('from employees') && sqlLower.includes('emp_code')) {
      const empCodeOrName = params[0];
      
      // ลองหาด้วย emp_code ก่อน
      let result = await supabase.select('employees', {
        eq: { emp_code: empCodeOrName },
        select: 'id,emp_code,full_name,position,department,status'
      });
      
      // ถ้าไม่เจอ ลองหาด้วย full_name
      if (result.success && result.data.length === 0) {
        result = await supabase.select('employees', {
          eq: { full_name: empCodeOrName },
          select: 'id,emp_code,full_name,position,department,status'
        });
      }
      
      return { rows: result.success ? result.data : [] };
    }
    
    // SELECT COUNT(*) as count FROM employees
    if (sqlLower.includes('count(*)') && sqlLower.includes('from employees')) {
      const result = await supabase.select('employees', { select: 'id' });
      return { rows: [{ count: result.success ? result.data.length : 0 }] };
    }
    
    // SELECT * FROM employees WHERE status = $1
    if (sqlLower.includes('from employees') && sqlLower.includes('status')) {
      const status = params[0];
      const result = await supabase.select('employees', {
        eq: { status },
        select: 'id,emp_code,full_name,position,department,status,created_at'
      });
      return { rows: result.success ? result.data : [] };
    }
    
    // SELECT full_name FROM employees WHERE status = $1
    if (sqlLower.includes('select full_name from employees')) {
      const status = params[0];
      const result = await supabase.select('employees', {
        eq: { status },
        select: 'full_name'
      });
      return { rows: result.success ? result.data : [] };
    }
    
    // SELECT id FROM time_logs WHERE employee_id = $1 AND DATE(clock_in) = $2
    if (sqlLower.includes('from time_logs') && sqlLower.includes('date(clock_in)')) {
      const employeeId = params[0];
      const date = params[1];
      
      const result = await supabase.select('time_logs', {
        eq: { employee_id: employeeId },
        select: 'id,clock_in'
      });
      
      // Filter by date on client side (เนื่องจาก Supabase REST API ไม่รองรับ DATE() function)
      if (result.success) {
        const filtered = result.data.filter(log => {
          const logDate = new Date(log.clock_in).toISOString().split('T')[0];
          return logDate === date;
        });
        return { rows: filtered };
      }
      
      return { rows: [] };
    }
    
    // Time logs with employee data
    if (sqlLower.includes('time_logs t') && sqlLower.includes('join employees e')) {
      // ใช้ separate queries แทน JOIN
      const timeLogsResult = await supabase.select('time_logs', {
        select: 'id,employee_id,clock_in,clock_out,note,status,latitude_in,longitude_in,latitude_out,longitude_out',
        order: 'clock_in.desc',
        limit: params.length > 0 ? params[params.length - 1] : 100
      });
      
      if (timeLogsResult.success && timeLogsResult.data.length > 0) {
        // Get employee data
        const employeeIds = [...new Set(timeLogsResult.data.map(log => log.employee_id))];
        const employeesResult = await supabase.select('employees', {
          select: 'id,emp_code,full_name,position,department'
        });
        
        if (employeesResult.success) {
          // Combine data
          const employees = employeesResult.data.reduce((acc, emp) => {
            acc[emp.id] = emp;
            return acc;
          }, {});
          
          const combinedData = timeLogsResult.data.map(log => ({
            ...log,
            emp_code: employees[log.employee_id]?.emp_code,
            full_name: employees[log.employee_id]?.full_name,
            position: employees[log.employee_id]?.position,
            department: employees[log.employee_id]?.department
          })).filter(log => log.emp_code); // Only include logs with valid employee data
          
          return { rows: combinedData };
        }
      }
      
      return { rows: [] };
    }
    
    // Settings queries
    if (sqlLower.includes('from settings')) {
      const result = await supabase.select('settings', {
        select: 'id,setting_name,setting_value,description'
      });
      
      // Filter by setting_name if specified
      if (sqlLower.includes('setting_name =') && params.length > 0) {
        if (result.success) {
          const filtered = result.data.filter(setting => setting.setting_name === params[0]);
          return { rows: filtered };
        }
      }
      
      return { rows: result.success ? result.data : [] };
    }
    
    // Fallback
    console.warn('❓ Unhandled SELECT query:', sql);
    return { rows: [] };
  }

  async handleInsert(sql, params) {
    const sqlLower = sql.toLowerCase();
    
    // INSERT INTO time_logs
    if (sqlLower.includes('into time_logs')) {
      const data = {
        employee_id: params[0],
        clock_in: params[1],
        note: params[2],
        latitude_in: params[3],
        longitude_in: params[4],
        line_name: params[5],
        line_picture: params[6]
      };
      
      const result = await supabase.insert('time_logs', data);
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    // INSERT INTO employees
    if (sqlLower.includes('into employees')) {
      const data = {
        emp_code: params[0],
        full_name: params[1],
        position: params[2],
        department: params[3],
        status: params[4] || 'active'
      };
      
      const result = await supabase.insert('employees', data);
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    // INSERT INTO settings
    if (sqlLower.includes('into settings')) {
      const data = {
        setting_name: params[0],
        setting_value: params[1],
        description: params[2]
      };
      
      const result = await supabase.insert('settings', data);
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    console.warn('❓ Unhandled INSERT query:', sql);
    return { rows: [], rowCount: 0 };
  }

  async handleUpdate(sql, params) {
    const sqlLower = sql.toLowerCase();
    
    // UPDATE time_logs SET clock_out = $1 WHERE id = $6
    if (sqlLower.includes('update time_logs') && sqlLower.includes('clock_out')) {
      const data = {
        clock_out: params[0],
        latitude_out: params[1],
        longitude_out: params[2],
        line_name: params[3],
        line_picture: params[4]
      };
      const timeLogId = params[5];
      
      const result = await supabase.update('time_logs', { id: timeLogId }, data);
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    // UPDATE employees
    if (sqlLower.includes('update employees')) {
      // Extract parameters based on query structure
      const employeeId = params[params.length - 1]; // Usually last parameter
      const data = {};
      
      if (sqlLower.includes('full_name')) data.full_name = params[0];
      if (sqlLower.includes('position')) data.position = params[1];
      if (sqlLower.includes('department')) data.department = params[2];
      if (sqlLower.includes('status')) data.status = params[3];
      
      const result = await supabase.update('employees', { id: employeeId }, data);
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    // UPDATE settings
    if (sqlLower.includes('update settings')) {
      const settingValue = params[0];
      const settingName = params[1];
      
      const result = await supabase.update('settings', { setting_name: settingName }, {
        setting_value: settingValue
      });
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    console.warn('❓ Unhandled UPDATE query:', sql);
    return { rows: [], rowCount: 0 };
  }

  async handleDelete(sql, params) {
    const sqlLower = sql.toLowerCase();
    
    // DELETE FROM time_logs WHERE id = $1
    if (sqlLower.includes('from time_logs')) {
      const timeLogId = params[0];
      const result = await supabase.delete('time_logs', { id: timeLogId });
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    // DELETE FROM employees WHERE id = $1
    if (sqlLower.includes('from employees')) {
      const employeeId = params[0];
      const result = await supabase.delete('employees', { id: employeeId });
      return { rows: result.success ? result.data : [], rowCount: result.success ? 1 : 0 };
    }
    
    console.warn('❓ Unhandled DELETE query:', sql);
    return { rows: [], rowCount: 0 };
  }

  // Compatibility methods
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {} // No-op for REST API
    };
  }

  async testConnection() {
    return await supabase.testConnection();
  }
}

module.exports = new DatabaseAdapter();