

const { Pool } = require('pg');
const AttendanceSyncService = require('./attendance-sync');

class HikvisionManager {
  constructor(dbPool, config = {}) {
    this.db = dbPool;
    this.syncService = new AttendanceSyncService(dbPool);
    this.config = {
      initialSyncDays: config.initialSyncDays || 7,
      pollingInterval: config.pollingInterval || 30000, 
      incrementalSyncMinutes: config.incrementalSyncMinutes || 5,
      enableRealTimeStream: config.enableRealTimeStream !== false, 
      enablePollingFallback: config.enablePollingFallback !== false, 
      ...config
    };
    
    this.pollingIntervalId = null;
    this.isInitialized = false;
  }

  // Private IP manzilini tekshirish (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // IPv4 formatini tekshirish
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return false;
    }
    
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 127.0.0.0/8 (localhost)
    if (parts[0] === 127) return true;
    
    return false;
  }

  // Terminallarni filtrlash: faqat public IP'li terminallar uchun polling/streaming
  filterTerminalsForPolling(terminals) {
    const publicTerminals = [];
    const privateTerminals = [];
    
    for (const terminal of terminals) {
      if (this.isPrivateIP(terminal.ip_address)) {
        privateTerminals.push(terminal);
      } else {
        publicTerminals.push(terminal);
      }
    }
    
    if (privateTerminals.length > 0) {
      console.log(`ℹ️  ${privateTerminals.length} ta private IP terminal topildi (polling/streaming o'chiriladi, webhook orqali ishlaydi):`);
      privateTerminals.forEach(t => {
        console.log(`   - ${t.name} (${t.ip_address})`);
      });
    }
    
    return publicTerminals;
  }

  
  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  Hikvision Manager allaqachon ishga tushirilgan');
      return;
    }

    console.log('🚀 Hikvision Manager ishga tushmoqda...');
    console.log(`   Config: Real-time=${this.config.enableRealTimeStream}, Polling=${this.config.enablePollingFallback}, Interval=${this.config.pollingInterval}ms`);

    try {
      
      const allTerminals = await this.loadActiveTerminals();

      if (allTerminals.length === 0) {
        console.log('ℹ️  Faol terminallar topilmadi');
        this.isInitialized = true;
        return;
      }

      console.log(`📡 ${allTerminals.length} ta faol terminal topildi`);

      // Private IP'li terminallarni filtrlash (ular webhook orqali ishlaydi)
      const terminals = this.filterTerminalsForPolling(allTerminals);

      if (terminals.length === 0) {
        console.log('ℹ️  Barcha terminallar private IP\'da (webhook orqali ishlaydi, polling/streaming o\'chirilgan)');
        this.isInitialized = true;
        return;
      }

      console.log(`🔄 ${terminals.length} ta public IP terminal uchun polling/streaming ishga tushmoqda...`);

      
      try {
        await this.syncService.initialFullSyncJSON(terminals);
      } catch (error) {
        console.log(`⚠️  JSON format xatolik, XML format bilan sinab ko'ramiz...`);
        await this.syncService.initialFullSync(terminals, this.config.initialSyncDays);
      }

      
      if (this.config.enableRealTimeStream) {
        await this.syncService.startRealTimeStreaming(terminals);
      }

      
      if (this.config.enablePollingFallback) {
        this.startPollingFallback();
      }

      this.isInitialized = true;
      console.log('✅ Hikvision Manager ishga tushdi');
    } catch (error) {
      console.error('❌ Hikvision Manager initialization xatolik:', error);
      throw error;
    }
  }

  
  async loadActiveTerminals() {
    const result = await this.db.query(
      'SELECT * FROM terminals WHERE is_active = true ORDER BY id'
    );
    return result.rows;
  }

  
  startPollingFallback() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }

    console.log(`🔄 Polling fallback ishga tushdi (${this.config.pollingInterval}ms interval)`);

    this.pollingIntervalId = setInterval(async () => {
      try {
        const allTerminals = await this.loadActiveTerminals();
        const terminals = this.filterTerminalsForPolling(allTerminals);
        if (terminals.length > 0) {
          await this.syncService.incrementalSync(terminals, this.config.incrementalSyncMinutes);
        }
      } catch (error) {
        console.error('❌ Polling fallback xatolik:', error.message);
      }
    }, this.config.pollingInterval);

    
    setTimeout(async () => {
      try {
        const allTerminals = await this.loadActiveTerminals();
        const terminals = this.filterTerminalsForPolling(allTerminals);
        if (terminals.length > 0) {
          await this.syncService.incrementalSync(terminals, this.config.incrementalSyncMinutes);
        }
      } catch (error) {
        console.error('❌ Initial polling xatolik:', error.message);
      }
    }, 5000); 
  }

  
  stopPollingFallback() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
      console.log('⏹️  Polling fallback to\'xtatildi');
    }
  }

  
  async shutdown() {
    console.log('🛑 Hikvision Manager to\'xtatilmoqda...');

    this.stopPollingFallback();
    await this.syncService.stopRealTimeStreaming();

    this.isInitialized = false;
    console.log('✅ Hikvision Manager to\'xtatildi');
  }

  
  async manualSync(terminalId, startDate = null, endDate = null) {
    const terminalResult = await this.db.query(
      'SELECT * FROM terminals WHERE id = $1',
      [terminalId]
    );

    if (terminalResult.rows.length === 0) {
      throw new Error('Terminal topilmadi');
    }

    const terminal = terminalResult.rows[0];

    
    return await this.syncService.syncLatestEvents(terminal);
  }
  
  
  async manualSyncHistorical(terminalId, startDate, endDate) {
    const terminalResult = await this.db.query(
      'SELECT * FROM terminals WHERE id = $1',
      [terminalId]
    );

    if (terminalResult.rows.length === 0) {
      throw new Error('Terminal topilmadi');
    }

    const terminal = terminalResult.rows[0];

    const startTimeStr = startDate.toISOString().replace('Z', '').split('.')[0];
    const endTimeStr = endDate.toISOString().replace('Z', '').split('.')[0];

    return await this.syncService.syncHistoricalEvents(terminal, startTimeStr, endTimeStr);
  }

  
  async testTerminal(terminalId) {
    const terminalResult = await this.db.query(
      'SELECT * FROM terminals WHERE id = $1',
      [terminalId]
    );

    if (terminalResult.rows.length === 0) {
      throw new Error('Terminal topilmadi');
    }

    const terminal = terminalResult.rows[0];
    const service = await this.syncService.initTerminal(terminal);
    
    return await service.testConnection();
  }

  
  getSyncService() {
    return this.syncService;
  }
}

module.exports = HikvisionManager;


