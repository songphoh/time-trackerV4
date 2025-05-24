// supabase-client.js - แก้ไขให้ใช้ Environment Variables
const axios = require('axios');

// ใช้ Environment Variables หรือ fallback เป็นค่าเดิม
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ofzfxbhzkvrumsgrgogq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9memZ4Ymh6a3ZydW1zZ3Jnb2dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5MTg2MjYsImV4cCI6MjA2MzQ5NDYyNn0._vs26Dbiig2iqqLj9rbBcOzMIaA6SZeFUPwgvDwc7r4';

class SupabaseClient {
  constructor() {
    this.baseURL = SUPABASE_URL;
    this.headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    
    console.log('🔌 Supabase client initialized');
    console.log('📍 URL:', SUPABASE_URL);
    console.log('🔑 Key length:', SUPABASE_ANON_KEY?.length || 0);
  }

  // GET - ดึงข้อมูล
  async select(table, options = {}) {
    try {
      let url = `${this.baseURL}/rest/v1/${table}`;
      const params = [];
      
      if (options.select) params.push(`select=${options.select}`);
      if (options.eq) {
        Object.entries(options.eq).forEach(([key, value]) => {
          params.push(`${key}=eq.${value}`);
        });
      }
      if (options.like) {
        Object.entries(options.like).forEach(([key, value]) => {
          params.push(`${key}=like.${value}`);
        });
      }
      if (options.order) params.push(`order=${options.order}`);
      if (options.limit) params.push(`limit=${options.limit}`);
      if (options.offset) params.push(`offset=${options.offset}`);
      
      if (params.length > 0) {
        url += '?' + params.join('&');
      }
      
      console.log('🔍 Supabase SELECT:', url);
      const response = await axios.get(url, { headers: this.headers });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('❌ Supabase select error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // POST - เพิ่มข้อมูล
  async insert(table, data) {
    try {
      const url = `${this.baseURL}/rest/v1/${table}`;
      console.log('➕ Supabase INSERT:', table, data);
      
      const response = await axios.post(url, data, { headers: this.headers });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('❌ Supabase insert error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // PATCH - แก้ไขข้อมูล
  async update(table, filter, data) {
    try {
      let url = `${this.baseURL}/rest/v1/${table}`;
      
      // สร้าง filter parameters
      if (typeof filter === 'object') {
        const params = Object.entries(filter).map(([key, value]) => `${key}=eq.${value}`);
        url += '?' + params.join('&');
      } else {
        // backward compatibility: assume filter is ID
        url += `?id=eq.${filter}`;
      }
      
      console.log('✏️ Supabase UPDATE:', url, data);
      const response = await axios.patch(url, data, { headers: this.headers });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('❌ Supabase update error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // DELETE - ลบข้อมูล
  async delete(table, filter) {
    try {
      let url = `${this.baseURL}/rest/v1/${table}`;
      
      if (typeof filter === 'object') {
        const params = Object.entries(filter).map(([key, value]) => `${key}=eq.${value}`);
        url += '?' + params.join('&');
      } else {
        url += `?id=eq.${filter}`;
      }
      
      console.log('🗑️ Supabase DELETE:', url);
      const response = await axios.delete(url, { headers: this.headers });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('❌ Supabase delete error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // ตรวจสอบการเชื่อมต่อ
  async testConnection() {
    try {
      const result = await this.select('employees', { limit: 1 });
      return { success: true, message: 'Supabase connection OK', data: result.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // เลียนแบบ query function สำหรับ backward compatibility
  async query(sql, params = []) {
    console.warn('⚠️ Direct SQL queries not supported. Use REST methods instead.');
    return { success: false, error: 'Use REST API methods instead of direct SQL' };
  }
}

module.exports = new SupabaseClient();