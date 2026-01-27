

module.exports = {
  
  initialSyncDays: 30, 

  
  enablePollingFallback: true, 
  pollingInterval: 30000, 
  incrementalSyncMinutes: 5, 

  
  enableRealTimeStream: true, 

  
  connectionTimeout: 30000, 
  maxReconnectAttempts: 5, 
  reconnectDelay: 5000, 

  
  eventBatchSize: 100, 
  processDelay: 100 
};


