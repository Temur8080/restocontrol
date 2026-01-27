

const { DigestClient } = require('digest-fetch');
const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class HikvisionISAPIService extends EventEmitter {
  constructor(terminalConfig) {
    super();
    this.terminal = terminalConfig;
    this.baseUrl = `http://${terminalConfig.ip_address}`;
    this.client = null;
    this.isStreaming = false;
    this.streamAbortController = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; 
    
    // Terminal IP manzilini tekshirish va diagnostika
    this.validateTerminalConfig();
    
    this.initClient();
  }
  
  // Terminal konfiguratsiyasini tekshirish
  validateTerminalConfig() {
    if (!this.terminal.ip_address) {
      console.error(`❌ Terminal ${this.terminal.name || this.terminal.id || 'unknown'}: IP manzil ko'rsatilmagan!`);
      return false;
    }
    
    const ip = this.terminal.ip_address.trim();
    
    // IP manzil formatini tekshirish
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipPattern.test(ip)) {
      console.error(`❌ Terminal ${this.terminal.name || this.terminal.id || 'unknown'}: Noto'g'ri IP manzil formati: ${ip}`);
      return false;
    }
    
    // Ichki IP manzillarni aniqlash
    const isPrivateIP = ip.startsWith('192.168.') || 
                       ip.startsWith('10.') || 
                       ip.startsWith('172.16.') ||
                       ip.startsWith('172.17.') ||
                       ip.startsWith('172.18.') ||
                       ip.startsWith('172.19.') ||
                       ip.startsWith('172.20.') ||
                       ip.startsWith('172.21.') ||
                       ip.startsWith('172.22.') ||
                       ip.startsWith('172.23.') ||
                       ip.startsWith('172.24.') ||
                       ip.startsWith('172.25.') ||
                       ip.startsWith('172.26.') ||
                       ip.startsWith('172.27.') ||
                       ip.startsWith('172.28.') ||
                       ip.startsWith('172.29.') ||
                       ip.startsWith('172.30.') ||
                       ip.startsWith('172.31.') ||
                       ip === '127.0.0.1' ||
                       ip === 'localhost';
    
    if (isPrivateIP) {
      console.warn(`⚠️  Terminal ${this.terminal.name || this.terminal.id || 'unknown'}:`);
      console.warn(`   IP manzil ichki tarmoqda: ${ip}`);
      console.warn(`   Server va terminal bir xil tarmoqda bo'lishi kerak`);
      console.warn(`   Yoki VPN/tunnel orqali ulangan bo'lishi kerak`);
      console.warn(`   Yoki terminal HTTP webhook orqali ma'lumot yuborishi kerak`);
    }
    
    // Username va password tekshirish
    if (!this.terminal.username || !this.terminal.password) {
      console.warn(`⚠️  Terminal ${this.terminal.name || this.terminal.id || 'unknown'}:`);
      console.warn(`   Username yoki password ko'rsatilmagan`);
    }
    
    return true;
  }

  
  initClient() {
    const username = this.terminal.username || 'admin';
    const password = this.terminal.password || 'admin12345';
    this.client = new DigestClient(username, password, { algorithm: 'MD5' });
  }

  
  createDigestAuthHeader(method, path, realm, nonce, username, password, qop = 'auth', cnonce, nc = '00000001') {
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${path}`).digest('hex');
    const response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex');
    
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${path}", qop="${qop}", nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  }

  
  async makeXMLRequest(endpoint, method = 'POST', xmlBody, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      const username = this.terminal.username || 'admin';
      const password = this.terminal.password || 'admin12345';
      
      let nonce = '';
      let realm = '';
      let qop = 'auth';
      const cnonce = crypto.randomBytes(8).toString('hex');
      const nc = '00000001';
      
      const makeRequest = (authHeader = null, sendBody = false) => {
        const options = {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: sendBody ? method : 'POST', 
          headers: {
            'Accept': 'application/xml, application/json',
            'Connection': 'close'
          },
          timeout: timeout
        };

        
        if (sendBody) {
          options.headers['Content-Type'] = 'application/xml; charset=UTF-8';
          options.headers['Content-Length'] = Buffer.byteLength(xmlBody, 'utf8');
        } else {
          
          options.headers['Content-Length'] = '0';
        }

        if (authHeader) {
          options.headers['Authorization'] = authHeader;
        }

        const req = http.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk.toString();
          });
          
          res.on('end', () => {
            if (res.statusCode === 401 && !authHeader) {
              
              const authHeaderValue = res.headers['www-authenticate'] || res.headers['WWW-Authenticate'];
              if (authHeaderValue && authHeaderValue.startsWith('Digest')) {
                
                const params = {};
                authHeaderValue.replace(/Digest\s+/, '').split(',').forEach(param => {
                  const parts = param.trim().split('=');
                  if (parts.length === 2) {
                    params[parts[0].trim()] = parts[1].trim().replace(/"/g, '').replace(/\s+/g, '');
                  }
                });
                realm = params.realm || '';
                nonce = params.nonce || '';
                qop = params.qop ? params.qop.split(',')[0].trim() : 'auth';
                
                console.log(`🔐 Terminal ${this.terminal.name} Digest Auth challenge olindi (realm: ${realm}, nonce: ${nonce.substring(0, 10)}...)`);
                
                
                const digestHeader = this.createDigestAuthHeader(method, url.pathname, realm, nonce, username, password, qop, cnonce, nc);
                makeRequest(digestHeader, true); 
              } else {
                reject(new Error('Digest Auth challenge topilmadi'));
              }
            } else if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                statusCode: res.statusCode,
                data: data,
                headers: res.headers
              });
            } else {
              
              let errorMessage = `HTTP ${res.statusCode}`;
              if (data.includes('<ResponseStatus>')) {
                const statusMatch = data.match(/<statusString>([^<]+)<\/statusString>/);
                const subStatusMatch = data.match(/<subStatusCode>([^<]+)<\/subStatusCode>/);
                if (statusMatch) errorMessage += `: ${statusMatch[1]}`;
                if (subStatusMatch) errorMessage += ` (${subStatusMatch[1]})`;
              }
              const error = new Error(errorMessage);
              error.statusCode = res.statusCode;
              error.responseText = data;
              reject(error);
            }
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        
        if (sendBody) {
          req.write(xmlBody, 'utf8');
        }
        req.end();
      };

      
      
      
      makeRequest(null, false);
    });
  }

  
  async makeRequest(endpoint, method = 'GET', body = null, timeout = 30000, contentType = 'application/json') {
    
    if (contentType.includes('xml') && typeof body === 'string') {
      return await this.makeXMLRequest(endpoint, method, body, timeout);
    }

    
    const url = `${this.baseUrl}${endpoint}`;
    
    const options = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': contentType
      }
    };

    if (body) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      const response = await this.client.fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        let isAccountLocked = false;
        let unlockTimeSeconds = 0;
        
        try {
          // Account qulfini tekshirish (userCheck XML format)
          if (errorText.includes('<userCheck')) {
            const lockStatusMatch = errorText.match(/<lockStatus>([^<]+)<\/lockStatus>/);
            const unlockTimeMatch = errorText.match(/<unlockTime>([^<]+)<\/unlockTime>/);
            
            if (lockStatusMatch && lockStatusMatch[1] === 'lock') {
              isAccountLocked = true;
              if (unlockTimeMatch) {
                unlockTimeSeconds = parseInt(unlockTimeMatch[1]) || 0;
                const unlockMinutes = Math.ceil(unlockTimeSeconds / 60);
                errorMessage = `HTTP ${response.status}: Terminal accounti qulflangan`;
                if (unlockTimeSeconds > 0) {
                  errorMessage += ` (${unlockMinutes} daqiqadan keyin ochiladi)`;
                }
                console.error(`🔒 Terminal ${this.terminal.name} accounti qulflangan!`);
                console.error(`   Unlock vaqti: ${unlockMinutes} daqiqa (${unlockTimeSeconds} soniya)`);
                console.error(`   Username: ${this.terminal.username || 'admin'}`);
                console.error(`   ⚠️  Terminalni fizik jihatdan qayta ishga tushiring yoki ${unlockMinutes} daqiqa kuting`);
              }
            }
            
            const statusStringMatch = errorText.match(/<statusString>([^<]+)<\/statusString>/);
            if (statusStringMatch && !isAccountLocked) {
              errorMessage += `: ${statusStringMatch[1]}`;
            }
          } else if (errorText.includes('<ResponseStatus>')) {
            const statusMatch = errorText.match(/<statusString>([^<]+)<\/statusString>/);
            const subStatusMatch = errorText.match(/<subStatusCode>([^<]+)<\/subStatusCode>/);
            if (statusMatch) errorMessage += `: ${statusMatch[1]}`;
            if (subStatusMatch) errorMessage += ` (${subStatusMatch[1]})`;
          } else {
            const errorJson = JSON.parse(errorText);
            if (errorJson.ResponseStatus?.statusString) {
              errorMessage = errorJson.ResponseStatus.statusString;
            } else if (errorJson.statusString) {
              errorMessage += `: ${errorJson.statusString}`;
            } else if (errorJson.message) {
              errorMessage += `: ${errorJson.message}`;
            }
          }
        } catch (parseError) {
          errorMessage += `: ${errorText.substring(0, 500)}`;
        }

        // Debug: error response ni ko'rsatish (faqat account qulflanmagan bo'lsa)
        if (!isAccountLocked) {
          console.error(`   Error response (${response.status}):`, errorText.substring(0, 1000));
        }

        const error = new Error(errorMessage);
        error.statusCode = response.status;
        error.responseText = errorText;
        error.isAccountLocked = isAccountLocked;
        error.unlockTimeSeconds = unlockTimeSeconds;
        throw error;
      }

      const data = await response.text();
      return {
        statusCode: response.status,
        data: data,
        headers: Object.fromEntries(response.headers.entries())
      };
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        const timeoutError = new Error('Request timeout');
        timeoutError.errorCode = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || 
          error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT') ||
          error.message.includes('ECONNRESET') || error.message.includes('EHOSTUNREACH')) {
        
        // Batafsil xatolik ma'lumotlari
        console.error(`\n❌ ============================================`);
        console.error(`❌ Terminal ${this.terminal.name || this.terminal.id || 'unknown'} ulanib bo'lmadi`);
        console.error(`❌ ============================================`);
        console.error(`   IP manzil: ${this.terminal.ip_address}`);
        console.error(`   URL: ${this.baseUrl}`);
        console.error(`   Xatolik: ${error.message}`);
        console.error(`   Xatolik kodi: ${error.errorCode || error.code || 'ECONNREFUSED'}`);
        
        // IP manzil ichki tarmoqda bo'lsa, tavsiya berish
        const ip = this.terminal.ip_address.trim();
        const isPrivateIP = ip.startsWith('192.168.') || ip.startsWith('10.') || 
                           (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31);
        
        if (isPrivateIP) {
          console.error(`\n   💡 YECHIM:`);
          console.error(`   1. Server va terminal bir xil tarmoqda (WiFi/LAN) bo'lishi kerak`);
          console.error(`   2. Yoki VPN/tunnel orqali ulanish sozlash kerak`);
          console.error(`   3. Yoki terminal HTTP webhook orqali ma'lumot yuborish sozlash`);
          console.error(`   4. Yoki terminal IP manzilini public IP'ga o'zgartirish (agar mumkin bo'lsa)`);
          console.error(`\n   📋 Terminal HTTP webhook sozlamalari:`);
          console.error(`      IP: restocontrol.uz`);
          console.error(`      URL: /api/hikvision/event`);
          console.error(`      Port: 443 (yoki 8000 - server portiga qarab)`);
          console.error(`      Protocol: HTTPS (yoki HTTP - server sozlamasiga qarab)`);
        } else {
          console.error(`\n   💡 YECHIM:`);
          console.error(`   1. Terminal IP manzilini tekshiring (to'g'ri bo'lishi kerak)`);
          console.error(`   2. Terminal yoqilgan va tarmoqda ekanligini tekshiring`);
          console.error(`   3. Firewall sozlamalarini tekshiring (port 80 ochiq bo'lishi kerak)`);
          console.error(`   4. Terminal va server bir xil tarmoqda bo'lishi kerak`);
        }
        console.error(`❌ ============================================\n`);
        
        const networkError = new Error(`Terminal ${this.terminal.name || this.terminal.id || 'unknown'} ulanib bo'lmadi`);
        networkError.errorCode = error.errorCode || error.code || 'ECONNREFUSED';
        networkError.isPrivateIP = isPrivateIP;
        networkError.terminalIP = this.terminal.ip_address;
        throw networkError;
      }

      throw error;
    }
  }

  
  escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  
  buildXMLPayload(searchParams) {
    const {
      searchID = `search_${Date.now()}`,
      searchResultPosition = 0,
      maxResults = 100,
      startTime = null,
      endTime = null,
      major = 5, 
      minor = null 
    } = searchParams;

    
    
    let xml = `<AcsEventCond version="2.0" xmlns="http:
    <searchID>${this.escapeXml(searchID)}</searchID>
    <searchResultPosition>${searchResultPosition}</searchResultPosition>
    <maxResults>${maxResults}</maxResults>
    <major>${major}</major>`;

    
    if (minor !== null) {
      xml += `\n    <minor>${minor}</minor>`;
    }

    
    if (startTime) {
      xml += `\n    <StartTime>${this.escapeXml(startTime)}</StartTime>`;
    }
    if (endTime) {
      xml += `\n    <EndTime>${this.escapeXml(endTime)}</EndTime>`;
    }

    xml += '\n</AcsEventCond>';
    return xml;
  }

  
  parseXMLResponse(xmlString) {
    const events = [];
    let hasMore = false;
    let totalMatches = 0;
    let searchID = '';

    try {
      
      const eventMatches = xmlString.match(/<AcsEvent[^>]*>([\s\S]*?)<\/AcsEvent>/g);
      if (eventMatches) {
        for (const eventXml of eventMatches) {
          const event = {};
          
          
          const serialMatch = eventXml.match(/<serialNo>([^<]+)<\/serialNo>/);
          if (serialMatch) event.serialNo = serialMatch[1];
          
          
          const majorMatch = eventXml.match(/<major>([^<]+)<\/major>/);
          const minorMatch = eventXml.match(/<minor>([^<]+)<\/minor>/);
          if (majorMatch) event.major = parseInt(majorMatch[1]);
          if (minorMatch) event.minor = parseInt(minorMatch[1]);
          
          
          const acsEventInfoMatch = eventXml.match(/<acsEventInfo>([\s\S]*?)<\/acsEventInfo>/);
          if (acsEventInfoMatch) {
            const acsInfo = acsEventInfoMatch[1];
            event.acsEventInfo = {};
            
            
            const empMatch = acsInfo.match(/<employeeNoString>([^<]+)<\/employeeNoString>/);
            if (empMatch) event.acsEventInfo.employeeNoString = empMatch[1];
            
            
            const timeMatch = acsInfo.match(/<time>([^<]+)<\/time>/);
            if (timeMatch) event.acsEventInfo.time = timeMatch[1];
            
            
            const doorMatch = acsInfo.match(/<doorNo>([^<]+)<\/doorNo>/);
            if (doorMatch) event.acsEventInfo.doorNo = parseInt(doorMatch[1]);
            
            const dirMatch = acsInfo.match(/<direction>([^<]+)<\/direction>/);
            if (dirMatch) event.acsEventInfo.direction = dirMatch[1];
            
            
            const verifyMatch = acsInfo.match(/<verifyMode>([^<]+)<\/verifyMode>/);
            if (verifyMatch) event.acsEventInfo.verifyMode = verifyMatch[1];
            
            
            const picMatch = acsInfo.match(/<pictureURL>([^<]+)<\/pictureURL>/);
            if (picMatch) event.acsEventInfo.pictureURL = picMatch[1];
          }
          
          events.push(event);
        }
      }
      
      
      const statusMatch = xmlString.match(/<ResponseStatus[^>]*>([\s\S]*?)<\/ResponseStatus>/);
      if (statusMatch) {
        const statusXml = statusMatch[1];
        const moreMatch = statusXml.match(/<responseStatusStrg>([^<]+)<\/responseStatusStrg>/);
        if (moreMatch && moreMatch[1] === 'MORE') {
          hasMore = true;
        }
        
        const totalMatch = statusXml.match(/<totalMatches>([^<]+)<\/totalMatches>/);
        if (totalMatch) {
          totalMatches = parseInt(totalMatch[1]);
        }
      }
      
      
      const searchIdMatch = xmlString.match(/<searchID>([^<]+)<\/searchID>/);
      if (searchIdMatch) {
        searchID = searchIdMatch[1];
      }
      
    } catch (parseError) {
      console.warn(`⚠️  XML parse xatolik: ${parseError.message}`);
    }
    
    return { events, hasMore, totalMatches, searchID };
  }

  
  async searchEvents(searchParams = {}) {
    const {
      searchID = `search_${Date.now()}`,
      searchResultPosition = 0,
      maxResults = 100,
      startTime = null,
      endTime = null
    } = searchParams;

    
    const xmlPayload = this.buildXMLPayload({
      searchID,
      searchResultPosition,
      maxResults,
      startTime,
      endTime
    });

    try {
      
      
      console.log(`📤 Terminal ${this.terminal.name} XML so'rov yuborilmoqda...`);
      console.log(`   XML payload (${xmlPayload.length} bytes):`);
      console.log(xmlPayload);
      
      const response = await this.makeRequest(
        '/ISAPI/AccessControl/AcsEvent', 
        'POST',
        xmlPayload,
        30000,
        'application/xml; charset=UTF-8' 
      );

      
      console.log(`✅ Terminal ${this.terminal.name} XML javob olindi (${response.data.length} bytes)`);
      
      
      const { events, hasMore, totalMatches, searchID: responseSearchID } = this.parseXMLResponse(response.data);

      return {
        events: events,
        hasMore: hasMore,
        totalMatches: totalMatches || events.length,
        searchID: responseSearchID || searchID
      };
    } catch (error) {
      console.error(`❌ Terminal ${this.terminal.name} event search xatolik:`, error.message);
      if (error.statusCode) {
        console.error(`   Status: ${error.statusCode}, Response: ${error.responseText?.substring(0, 300)}`);
      }
      throw error;
    }
  }

  
  parseEvent(rawEvent) {
    // Faqat Access Control eventlarini qayta ishlaymiz (major=5)
    // Door eventlari boshqa major code da bo'lishi mumkin, lekin hozircha faqat major=5 ni qo'llab-quvvatlaymiz
    if (rawEvent.major !== 5) {
      return null; 
    }

    // Parse serial number early for debug logging
    const serialNoNum = rawEvent.serialNo ? parseInt(rawEvent.serialNo) : 0;

    // Handle both XML and JSON format events
    let acsEventInfo = rawEvent.acsEventInfo || {};
    
    // For JSON format, acsEventInfo might be directly in the event
    if (!acsEventInfo || Object.keys(acsEventInfo).length === 0) {
      // Try to extract from JSON structure
      if (rawEvent.acsEventInfo) {
        acsEventInfo = rawEvent.acsEventInfo;
      } else if (rawEvent.Info) {
        acsEventInfo = rawEvent.Info;
      } else {
        // Use rawEvent itself if it has the fields
        acsEventInfo = rawEvent;
      }
    }
    
    // Debug: log acsEventInfo structure for first few events
    if (serialNoNum <= 5) {
      console.log(`🔍 parseEvent debug (serialNo: ${rawEvent.serialNo}):`);
      console.log(`   rawEvent keys: ${Object.keys(rawEvent).join(', ')}`);
      console.log(`   acsEventInfo keys: ${Object.keys(acsEventInfo).join(', ')}`);
      if (rawEvent.acsEventInfo) {
        console.log(`   rawEvent.acsEventInfo type: ${typeof rawEvent.acsEventInfo}`);
      }
    }
    
    
    
    const employeeNoString = acsEventInfo.employeeNoString || 
                            rawEvent.employeeNoString || 
                            acsEventInfo.cardNo ||
                            rawEvent.cardNo ||
                            acsEventInfo.employeeNo ||
                            rawEvent.employeeNo ||
                            null;

    if (!employeeNoString) {
      
      console.warn(`⚠️  Event serialNo ${rawEvent.serialNo} da employee identifier yo'q`);
      
    }

    
    
    
    
    
    let eventTime;
    let timeSource = null;
    let originalTime = null;
    
    
    const ensureTimezone = (timeStr) => {
      if (!timeStr || typeof timeStr !== 'string') return timeStr;
      
      if (!timeStr.match(/[+-]\d{2}:\d{2}$/) && !timeStr.endsWith('Z')) {
        
        if (timeStr.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
          return timeStr + '+05:00';
        }
      }
      return timeStr;
    };
    
    if (acsEventInfo.time) {
      originalTime = acsEventInfo.time;
      timeSource = ensureTimezone(originalTime);
      eventTime = new Date(timeSource);
    } else if (rawEvent.time) {
      originalTime = rawEvent.time;
      timeSource = ensureTimezone(originalTime);
      eventTime = new Date(timeSource);
    } else if (rawEvent.timeLocal) {
      originalTime = rawEvent.timeLocal;
      timeSource = ensureTimezone(originalTime);
      eventTime = new Date(timeSource);
    } else {
      eventTime = new Date(); 
    }
    
    
    if (!(eventTime instanceof Date) || isNaN(eventTime.getTime())) {
      console.warn(`⚠️  Event serialNo ${rawEvent.serialNo} da noto'g'ri vaqt: "${timeSource}"`);
      eventTime = new Date(); 
    }
    
    
    const shouldLogTime = serialNoNum <= 5 || serialNoNum % 100 === 0;
    if (shouldLogTime && originalTime && timeSource) {
      console.log(`🔍 Time parse debug - SerialNo: ${rawEvent.serialNo}`);
      console.log(`   Original: "${originalTime}"`);
      console.log(`   Final: "${timeSource}"`);
      console.log(`   ISO: ${eventTime.toISOString()}`);
      console.log(`   Local: ${eventTime.toString()}`);
    }

    
    
    // ============================================
    // EVENT TYPE DETERMINATION - NEW CLEAN LOGIC
    // ============================================
    let eventType = null;
    let eventTypeSource = null;

    // METHOD 1: Minor code (most reliable - 75 = entry, 76 = exit)
    let minorCode = null;
    
    // Check all possible locations for minor code (in priority order)
    const minorSources = [
      rawEvent.minor,
      acsEventInfo?.minor,
      rawEvent.Minor,
      acsEventInfo?.Minor
    ];
    
    for (const source of minorSources) {
      if (source !== undefined && source !== null && source !== '') {
        // Try to parse as number
        const parsed = typeof source === 'number' ? source : parseInt(source);
        if (!isNaN(parsed) && (parsed === 75 || parsed === 76)) {
          minorCode = parsed;
          break; // Found valid minor code, stop searching
        }
      }
    }

    // Use minor code to determine event type
    if (minorCode === 75) {
      eventType = 'entry';
      eventTypeSource = 'minor=75';
    } else if (minorCode === 76) {
      eventType = 'exit';
      eventTypeSource = 'minor=76';
    }

    // METHOD 2: Direction field (1 = in/entry, 0 = out/exit)
    if (!eventType) {
      let direction = null;
      
      if (acsEventInfo.direction !== undefined && acsEventInfo.direction !== null) {
        direction = acsEventInfo.direction;
      } else if (rawEvent.direction !== undefined && rawEvent.direction !== null) {
        direction = rawEvent.direction;
      }

      if (direction !== null) {
        const directionNum = parseInt(direction);
        const directionStr = String(direction).toLowerCase().trim();
        
        if (directionNum === 1 || directionStr === '1' || directionStr === 'in' || directionStr === 'entry') {
          eventType = 'entry';
          eventTypeSource = 'direction=in';
        } else if (directionNum === 0 || directionStr === '0' || directionStr === 'out' || directionStr === 'exit') {
          eventType = 'exit';
          eventTypeSource = 'direction=out';
        }
      }
    }

    // METHOD 3: Type field (check for 'in' or 'out' keywords)
    if (!eventType && acsEventInfo.type) {
      const typeStr = String(acsEventInfo.type).toLowerCase();
      if (typeStr.includes('in') || typeStr === 'trafficin' || typeStr === 'trafficinnormal' || typeStr === 'entry') {
        eventType = 'entry';
        eventTypeSource = `type=${acsEventInfo.type}`;
      } else if (typeStr.includes('out') || typeStr === 'trafficout' || typeStr === 'trafficoutnormal' || typeStr === 'exit') {
        eventType = 'exit';
        eventTypeSource = `type=${acsEventInfo.type}`;
      }
    }

    // METHOD 4: Time-based fallback (14:00 dan oldin = entry, keyin = exit)
    if (!eventType) {
      const hours = eventTime.getHours();
      if (hours < 14) {
        eventType = 'entry';
        eventTypeSource = `time-based (${hours}:00 < 14:00)`;
      } else {
        eventType = 'exit';
        eventTypeSource = `time-based (${hours}:00 >= 14:00)`;
      }
      
      if (serialNoNum <= 10) {
        console.warn(`⚠️  Event serialNo ${rawEvent.serialNo || 'unknown'} da eventType vaqtga qarab aniqlandi: ${eventType}`);
      }
    }

    // Get serialNo string for debug logging
    const serialNo = rawEvent.serialNo || `${Date.now()}_${Math.random()}`;

    // Debug logging - show event type determinations (first 30 events or all exit events)
    const shouldLog = serialNoNum <= 30 || eventType === 'exit' || minorCode === 76;
    
    if (shouldLog) {
      console.log(`📋 Event parse - SerialNo: ${serialNo}`);
      console.log(`   RawEvent.minor: ${rawEvent.minor} | acsEventInfo.minor: ${acsEventInfo?.minor || 'N/A'}`);
      console.log(`   Parsed minorCode: ${minorCode} ${minorCode === 75 ? '(entry)' : minorCode === 76 ? '(exit)' : '(unknown)'}`);
      console.log(`   Direction: ${acsEventInfo?.direction || rawEvent.direction || 'N/A'} | Type: ${acsEventInfo?.type || rawEvent.type || 'N/A'}`);
      console.log(`   ✅ Result: ${eventType} (source: ${eventTypeSource || 'unknown'})`);
      console.log(`   Employee: ${employeeNoString || 'N/A'} | Time: ${eventTime.toISOString()}`);
      
      if (minorCode === 76 && eventType !== 'exit') {
        console.error(`   ❌ XATOLIK: minor=76 (exit) lekin eventType=${eventType}!`);
      }
      if (minorCode === 75 && eventType !== 'entry') {
        console.error(`   ❌ XATOLIK: minor=75 (entry) lekin eventType=${eventType}!`);
      }
    }

    
    
    // Try multiple ways to get pictureURL FIRST (before verificationMode, as it's used in fallback)
    const pictureUrl = acsEventInfo.pictureURL || 
                      rawEvent.pictureURL || 
                      acsEventInfo.pictureUrl ||
                      rawEvent.pictureUrl ||
                      acsEventInfo.picture_url ||
                      rawEvent.picture_url ||
                      // Try nested structures
                      (rawEvent.acsEventInfo && rawEvent.acsEventInfo.pictureURL) ||
                      (rawEvent.acsEventInfo && rawEvent.acsEventInfo.pictureUrl) ||
                      (rawEvent.Info && rawEvent.Info.pictureURL) ||
                      (rawEvent.Info && rawEvent.Info.pictureUrl) ||
                      null;

    // Try to get verification mode from multiple sources (including nested structures)
    let verificationMode = acsEventInfo.verifyMode || 
                         rawEvent.verifyMode || 
                         rawEvent.currentVerifyMode ||  // NEW: Check currentVerifyMode from rawEvent
                         acsEventInfo.cardReaderKind || 
                         rawEvent.cardReaderKind ||
                         acsEventInfo.verifyModeDesc ||
                         rawEvent.verifyModeDesc ||
                         acsEventInfo.verifyType ||
                         rawEvent.verifyType ||
                         acsEventInfo.verificationMode ||
                         rawEvent.verificationMode ||
                         // Try nested structures
                         (rawEvent.acsEventInfo && rawEvent.acsEventInfo.verifyMode) ||
                         (rawEvent.Info && rawEvent.Info.verifyMode) ||
                         (rawEvent.acsEventInfo && rawEvent.acsEventInfo.cardReaderKind) ||
                         (rawEvent.Info && rawEvent.Info.cardReaderKind) ||
                         null;

    // Debug: log verification mode sources for ALL events (to find the issue)
    console.log(`🔍 Verification Mode debug (serialNo: ${rawEvent.serialNo}):`);
    console.log(`   acsEventInfo.verifyMode: ${acsEventInfo.verifyMode || 'null'}`);
    console.log(`   rawEvent.verifyMode: ${rawEvent.verifyMode || 'null'}`);
    console.log(`   rawEvent.currentVerifyMode: ${rawEvent.currentVerifyMode || 'null'}`);  // NEW
    console.log(`   acsEventInfo.cardReaderKind: ${acsEventInfo.cardReaderKind || 'null'}`);
    console.log(`   rawEvent.cardReaderKind: ${rawEvent.cardReaderKind || 'null'}`);
    console.log(`   acsEventInfo.verifyModeDesc: ${acsEventInfo.verifyModeDesc || 'null'}`);
    console.log(`   rawEvent.verifyModeDesc: ${rawEvent.verifyModeDesc || 'null'}`);
    console.log(`   acsEventInfo.cardNo: ${acsEventInfo.cardNo || 'null'}`);
    console.log(`   rawEvent.cardNo: ${rawEvent.cardNo || 'null'}`);
    console.log(`   acsEventInfo.faceLibType: ${acsEventInfo.faceLibType || 'null'}`);
    console.log(`   rawEvent.faceLibType: ${rawEvent.faceLibType || 'null'}`);
    console.log(`   pictureUrl: ${pictureUrl ? 'mavjud' : 'null'}`);
    console.log(`   All acsEventInfo keys: ${Object.keys(acsEventInfo).join(', ')}`);
    console.log(`   All rawEvent keys: ${Object.keys(rawEvent).join(', ')}`);
    
    // Log full rawEvent structure for first 3 events to see what we're working with
    if (serialNoNum <= 3) {
      console.log(`   📋 Full rawEvent structure:`, JSON.stringify(rawEvent, null, 2));
    }
    
    if (verificationMode !== null && verificationMode !== undefined) {
      // Handle numeric values directly (before converting to string)
      if (typeof verificationMode === 'number') {
        if (verificationMode === 1) {
          verificationMode = 'Face';
        } else if (verificationMode === 2) {
          verificationMode = 'Card';
        } else if (verificationMode === 3) {
          verificationMode = 'Fingerprint';
        } else if (verificationMode === 4) {
          verificationMode = 'Password';
        } else {
          verificationMode = String(verificationMode);
        }
      }
      
      const modeStr = String(verificationMode).toLowerCase();
      
      // Check for face recognition
      if (modeStr.includes('face') || modeStr === '1' || modeStr === 'faceid' || modeStr === 'faceidrecognition') {
        verificationMode = 'Face';
      } 
      // Check for card/RFID
      else if (modeStr.includes('card') || modeStr === '2' || modeStr.includes('rfid') || modeStr.includes('nfc') || modeStr.includes('iccard')) {
        verificationMode = 'Card';
      } 
      // Check for fingerprint
      else if (modeStr.includes('finger') || modeStr.includes('fp') || modeStr === '3' || modeStr.includes('fingerprint')) {
        verificationMode = 'Fingerprint';
      } 
      // Check for password
      else if (modeStr.includes('password') || modeStr.includes('pwd') || modeStr === '4') {
        verificationMode = 'Password';
      } 
      // Check for combined modes
      else if (modeStr.includes('face') && modeStr.includes('card')) {
        verificationMode = 'Face+Card';
      } else if (modeStr.includes('face') && modeStr.includes('finger')) {
        verificationMode = 'Face+Fingerprint';
      } 
      // Try to parse numeric values
      else if (!isNaN(parseInt(modeStr))) {
        const numValue = parseInt(modeStr);
        if (numValue === 1) {
          verificationMode = 'Face';
        } else if (numValue === 2) {
          verificationMode = 'Card';
        } else if (numValue === 3) {
          verificationMode = 'Fingerprint';
        } else if (numValue === 4) {
          verificationMode = 'Password';
        } else {
          verificationMode = String(verificationMode).charAt(0).toUpperCase() + String(verificationMode).slice(1).toLowerCase();
        }
      } 
      // Default: capitalize first letter
      else {
        verificationMode = String(verificationMode).charAt(0).toUpperCase() + String(verificationMode).slice(1).toLowerCase();
      }
    } else {
      // Fallback: try to determine from other fields
      // Method 1: Check for cardNo (indicates Card)
      if (acsEventInfo.cardNo || rawEvent.cardNo) {
        verificationMode = 'Card';
        console.log(`   ✅ Verification mode aniqlandi: Card (cardNo mavjud)`);
      } 
      // Method 2: Check for faceLibType (indicates Face)
      else if (acsEventInfo.faceLibType || rawEvent.faceLibType) {
        verificationMode = 'Face';
        console.log(`   ✅ Verification mode aniqlandi: Face (faceLibType mavjud)`);
      } 
      // Method 3: Check for pictureURL (if picture exists, likely Face recognition)
      else if (pictureUrl) {
        verificationMode = 'Face';
        console.log(`   ✅ Verification mode aniqlandi: Face (pictureURL mavjud)`);
      }
      // Method 4: Check for employeeNoString format (Face ID usually has numeric ID)
      else if (employeeNoString && !isNaN(parseInt(employeeNoString))) {
        // If employeeNoString is numeric, it's likely from Face ID system
        verificationMode = 'Face';
        console.log(`   ✅ Verification mode aniqlandi: Face (employeeNoString raqamli: ${employeeNoString})`);
      }
      // Method 5: Default to Unknown
      else {
        verificationMode = 'Unknown';
        console.log(`   ⚠️  Verification mode aniqlanmadi: Unknown`);
        console.log(`   💡 Yordam: cardNo=${!!(acsEventInfo.cardNo || rawEvent.cardNo)}, faceLibType=${!!(acsEventInfo.faceLibType || rawEvent.faceLibType)}, pictureUrl=${!!pictureUrl}, employeeNoString=${employeeNoString || 'null'}`);
      }
    }
    
    // Log final verification mode for all events
    console.log(`   ✅ Final verificationMode: ${verificationMode}`);

    // Debug: log pictureURL extraction - always log for first few events
    if (pictureUrl) {
      console.log(`📷 PictureURL topildi (serialNo: ${rawEvent.serialNo}): ${pictureUrl}`);
    } else {
      // Log for first few events or every 50th event to debug
      if (serialNoNum <= 10 || serialNoNum % 50 === 0) {
        console.log(`⚠️  PictureURL topilmadi (serialNo: ${rawEvent.serialNo})`);
        console.log(`   acsEventInfo.pictureURL: ${acsEventInfo.pictureURL || 'null'}`);
        console.log(`   rawEvent.pictureURL: ${rawEvent.pictureURL || 'null'}`);
        console.log(`   acsEventInfo.pictureUrl: ${acsEventInfo.pictureUrl || 'null'}`);
        console.log(`   rawEvent.pictureUrl: ${rawEvent.pictureUrl || 'null'}`);
        console.log(`   acsEventInfo keys: ${Object.keys(acsEventInfo).join(', ')}`);
        console.log(`   rawEvent keys: ${Object.keys(rawEvent).join(', ')}`);
        
        // Try to find pictureURL in nested structures
        if (rawEvent.acsEventInfo && typeof rawEvent.acsEventInfo === 'object') {
          const nestedKeys = Object.keys(rawEvent.acsEventInfo);
          const picKey = nestedKeys.find(k => k.toLowerCase().includes('picture') || k.toLowerCase().includes('pic'));
          if (picKey) {
            console.log(`   🔍 Found potential picture key in acsEventInfo: ${picKey} = ${rawEvent.acsEventInfo[picKey]}`);
          }
        }
      }
    }
    
    // Use serialNo from above or generate new one
    const finalSerialNo = rawEvent.serialNo || serialNo || `${Date.now()}_${Math.random()}`;
    const finalEmployeeNo = employeeNoString || `UNKNOWN_${finalSerialNo}`;

    return {
      serialNo: finalSerialNo, 
      employeeNoString: finalEmployeeNo,
      eventTime: eventTime,
      eventType: eventType,
      verificationMode: verificationMode,
      pictureUrl: pictureUrl,
      rawEvent: rawEvent 
    };
  }

  
  async startRealTimeStream() {
    if (this.isStreaming) {
      console.log(`ℹ️  Terminal ${this.terminal.name} stream allaqachon ishlamoqda`);
      return;
    }

    this.isStreaming = true;
    this.reconnectAttempts = 0;
    await this._connectStream();
  }

  
  async _connectStream() {
    const url = `${this.baseUrl}/ISAPI/Event/notification/alertStream`;
    
    this.streamAbortController = new AbortController();
    
    const options = {
      method: 'GET',
      headers: {
        'Accept': 'application/json, application/xml',
        'Connection': 'keep-alive'
      },
      signal: this.streamAbortController.signal
    };

    try {
      console.log(`📡 Terminal ${this.terminal.name} real-time stream ulanishi boshlanmoqda...`);
      
      const response = await this.client.fetch(url, options);

      if (!response.ok) {
        throw new Error(`Stream HTTP ${response.status}: ${await response.text()}`);
      }

      console.log(`✅ Terminal ${this.terminal.name} stream ulandi`);
      this.reconnectAttempts = 0; 

      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isStreaming) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`⚠️  Terminal ${this.terminal.name} stream yopildi`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; 

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            
            let eventData;
            if (trimmed.startsWith('{')) {
              eventData = JSON.parse(trimmed);
              
              // Stream eventlarida minor kodni qo'shamiz (agar yo'q bo'lsa)
              if (eventData && typeof eventData === 'object') {
                // Event object dan minor kodni topish
                let minorFromEvent = null;
                
                // Check various locations for minor code
                if (eventData.minor !== undefined && eventData.minor !== null) {
                  minorFromEvent = parseInt(eventData.minor);
                } else if (eventData.acsEventInfo?.minor !== undefined && eventData.acsEventInfo.minor !== null) {
                  minorFromEvent = parseInt(eventData.acsEventInfo.minor);
                } else if (eventData.Minor !== undefined && eventData.Minor !== null) {
                  minorFromEvent = parseInt(eventData.Minor);
                } else if (eventData.acsEventInfo?.Minor !== undefined && eventData.acsEventInfo.Minor !== null) {
                  minorFromEvent = parseInt(eventData.acsEventInfo.Minor);
                }
                
                // Agar minor kod topilmasa yoki noto'g'ri bo'lsa, event ma'lumotlariga qarab aniqlashga harakat qilamiz
                if (!minorFromEvent || (minorFromEvent !== 75 && minorFromEvent !== 76)) {
                  // Direction yoki type field orqali minor kodni aniqlashga harakat qilamiz
                  const direction = eventData.acsEventInfo?.direction ?? eventData.direction;
                  const type = eventData.acsEventInfo?.type ?? eventData.type;
                  
                  if (direction === 1 || direction === '1' || (typeof type === 'string' && type.toLowerCase().includes('in'))) {
                    minorFromEvent = 75; // entry
                  } else if (direction === 0 || direction === '0' || (typeof type === 'string' && type.toLowerCase().includes('out'))) {
                    minorFromEvent = 76; // exit
                  }
                }
                
                // Minor kodni event objectga qo'shamiz
                if (minorFromEvent === 75 || minorFromEvent === 76) {
                  eventData.minor = minorFromEvent;
                  if (eventData.acsEventInfo) {
                    eventData.acsEventInfo = { ...eventData.acsEventInfo, minor: minorFromEvent };
                  } else {
                    eventData.acsEventInfo = { minor: minorFromEvent };
                  }
                }
              }
            } else if (trimmed.includes('<?xml') || trimmed.includes('<CMSMessage>')) {
              
              continue;
            } else {
              continue;
            }

            
            if (eventData) {
              const parsedEvent = this.parseEvent(eventData);
              if (parsedEvent) {
                this.emit('event', parsedEvent);
              }
            }
          } catch (parseError) {
            
            console.warn(`⚠️  Terminal ${this.terminal.name} stream parse xatolik:`, parseError.message);
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        
        return;
      }

      console.error(`❌ Terminal ${this.terminal.name} stream xatolik:`, error.message);
      this.emit('error', error);

      
      if (this.isStreaming && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`🔄 Terminal ${this.terminal.name} ${delay}ms dan keyin qayta ulaniladi (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        
        setTimeout(() => {
          if (this.isStreaming) {
            this._connectStream();
          }
        }, delay);
      } else if (this.isStreaming) {
        console.error(`❌ Terminal ${this.terminal.name} stream qayta ulanib bo'lmadi. Fallback to polling.`);
        this.isStreaming = false;
        this.emit('streamFailed');
      }
    }
  }

  
  stopRealTimeStream() {
    if (!this.isStreaming) return;

    console.log(`⏹️  Terminal ${this.terminal.name} stream to'xtatilmoqda...`);
    this.isStreaming = false;
    
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
  }

  
  async getAllEventsJSON(maxResults = 1000, batchSize = 100) {
    try {
      const allEvents = [];
      let searchResultPosition = 0;
      let hasMore = true;
      const searchID = `all_events_${Date.now()}_${this.terminal.id}`;
      
      console.log(`📤 Terminal ${this.terminal.name} JSON so'rov yuborilmoqda (barcha hodisalar, pagination bilan)...`);
      
      // JSON formatda minor MAJBURIY talab qilinadi, shuning uchun ikki so'rov yuboramiz
      // 1. minor=75 (entry events)
      // 2. minor=76 (exit events)
      // Note: API minor parametrini talab qiladi, shuning uchun null qo'shish mumkin emas
      const minorCodes = [75, 76];
      
      console.log(`🔄 ${minorCodes.length} ta minor kod uchun so'rovlar yuborilmoqda: ${minorCodes.join(', ')}`);
      
      for (const minorCode of minorCodes) {
        let position = 0;
        let hasMoreForMinor = true;
        let loopCount = 0;
        const maxLoops = 100; // Infinite loop oldini olish uchun
        
        while (hasMoreForMinor && allEvents.length < maxResults && loopCount < maxLoops) {
          loopCount++;
          const currentBatchSize = Math.min(batchSize, maxResults - allEvents.length);
          
          const payload = {
            AcsEventCond: {
              searchID: `${searchID}_minor${minorCode}`,
              searchResultPosition: position,
              maxResults: currentBatchSize,
              major: 5,
              minor: minorCode
            }
          };

          // Debug: payload ni ko'rsatish (faqat birinchi so'rovda har bir minor kod uchun)
          if (position === 0) {
            console.log(`   📤 Payload (minor=${minorCode}, position=${position}, loop=${loopCount}):`, JSON.stringify(payload, null, 2));
          }

          const response = await this.makeRequest(
            '/ISAPI/AccessControl/AcsEvent?format=json',
            'POST',
            payload,
            30000,
            'application/json'
          );

          const data = JSON.parse(response.data);
          
          if (data && data.AcsEvent) {
            // Check if there are more results
            if (data.AcsEvent.responseStatusStrg === 'MORE' || data.AcsEvent.responseStatusStrg === 'OK') {
              if (data.AcsEvent.InfoList) {
                let events = Array.isArray(data.AcsEvent.InfoList) 
                  ? data.AcsEvent.InfoList 
                  : [data.AcsEvent.InfoList];
                
                // JSON formatdan kelgan eventlarga minor kodni HAR DOIM qo'shamiz
                // parseEvent funksiyasi minor kodga asoslanadi
                events = events.map((event, eventIndex) => {
                  // Event object bo'lmasa, object qilamiz
                  if (typeof event !== 'object' || event === null) {
                    return event;
                  }
                  // Yangi object yaratamiz (immutability uchun)
                  const enrichedEvent = { ...event };
                  
                  // Minor kodni HAR DOIM qo'shamiz (oldingi qiymatni e'tiborsiz qoldiramiz)
                  enrichedEvent.minor = minorCode;
                  
                  // acsEventInfo ni yaratamiz yoki yangilaymiz
                  if (enrichedEvent.acsEventInfo && typeof enrichedEvent.acsEventInfo === 'object') {
                    enrichedEvent.acsEventInfo = { ...enrichedEvent.acsEventInfo, minor: minorCode };
                  } else {
                    enrichedEvent.acsEventInfo = { minor: minorCode };
                  }
                  
                  // Debug: first 5 events for each minor code
                  if (eventIndex < 5) {
                    console.log(`   ✅ Enriched event ${eventIndex + 1} (minor=${minorCode}):`, {
                      serialNo: enrichedEvent.serialNo,
                      minor: enrichedEvent.minor,
                      acsEventInfo_minor: enrichedEvent.acsEventInfo?.minor,
                      original_minor: event.minor
                    });
                  }
                  
                  return enrichedEvent;
                });
                
                // Debug: minor kod bo'yicha statistika
                console.log(`📊 Terminal ${this.terminal.name}: ${events.length} ta event yuklandi minor=${minorCode} uchun (jami: ${allEvents.length + events.length})`);
                
                allEvents.push(...events);
                position += events.length;
                
                console.log(`📊 Terminal ${this.terminal.name}: Jami ${allEvents.length} ta event (minor=${minorCode}, hasMore: ${data.AcsEvent.responseStatusStrg === 'MORE'})`);
                
                hasMoreForMinor = data.AcsEvent.responseStatusStrg === 'MORE';
                
                // Small delay between requests
                if (hasMoreForMinor) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              } else {
                hasMoreForMinor = false;
              }
            } else {
              hasMoreForMinor = false;
            }
          } else {
            hasMoreForMinor = false;
          }
        }
        
        // Debug: har bir minor kod uchun statistika
        const minorEvents = allEvents.filter(e => e.minor === minorCode || e.acsEventInfo?.minor === minorCode);
        if (loopCount >= maxLoops) {
          console.warn(`⚠️  Minor kod ${minorCode} uchun loop maksimal takrorlanish soniga yetdi (${maxLoops}). Loop to'xtatildi.`);
        }
        console.log(`✅ Terminal ${this.terminal.name}: minor=${minorCode} tugadi - ${minorEvents.length} ta event topildi (final position: ${position}, loops: ${loopCount})`);
      }
      
      // Debug: entry va exit eventlar sonini hisoblash
      const entryEvents = allEvents.filter(e => e.minor === 75 || e.acsEventInfo?.minor === 75).length;
      const exitEvents = allEvents.filter(e => e.minor === 76 || e.acsEventInfo?.minor === 76).length;
      
      console.log(`✅ Terminal ${this.terminal.name}: Jami ${allEvents.length} ta event olindi`);
      console.log(`   Entry (minor=75): ${entryEvents} ta`);
      console.log(`   Exit (minor=76): ${exitEvents} ta`);
      
      return allEvents;
    } catch (error) {
      console.error(`❌ Terminal ${this.terminal.name} getAllEventsJSON xatolik:`, error.message);
      if (error.responseText) {
        console.error(`   Response: ${error.responseText.substring(0, 500)}`);
      }
      if (error.statusCode) {
        console.error(`   Status Code: ${error.statusCode}`);
      }
      throw error;
    }
  }

  
  async getLatestEventsJSON(lastSerial = 0, maxResults = 100, batchSize = 100) {
    try {
      const allEvents = [];
      const searchID = `latest_${Date.now()}_${this.terminal.id}`;
      
      console.log(`📤 Terminal ${this.terminal.name} JSON so'rov yuborilmoqda (yangi hodisalar, lastSerial: ${lastSerial}, pagination bilan)...`);
      
      // Note: serialNoGreaterThan JSON API tomonidan qo'llab-quvvatlanmaydi
      // Shuning uchun barcha eventlarni yuklab, client tomonida filtrlash qilamiz
      if (lastSerial > 0) {
        console.log(`⚠️  serialNoGreaterThan qo'llab-quvvatlanmaydi, barcha eventlarni yuklab, filtrlash...`);
      }
      
      // JSON formatda minor talab qilinishi mumkin, shuning uchun ikkita so'rov yuboramiz
      // 1. minor=75 (entry events)
      // 2. minor=76 (exit events)
      const minorCodes = [75, 76];
      
      for (const minorCode of minorCodes) {
        let position = 0;
        let hasMoreForMinor = true;
        let loopCount = 0;
        const maxLoops = 100; // Infinite loop oldini olish uchun
        
        while (hasMoreForMinor && allEvents.length < maxResults && loopCount < maxLoops) {
          loopCount++;
          const currentBatchSize = Math.min(batchSize, maxResults - allEvents.length);
          
          const payload = {
            AcsEventCond: {
              searchID: `${searchID}_minor${minorCode === null ? 'all' : minorCode}`,
              searchResultPosition: position,
              maxResults: currentBatchSize,
              major: 5
            }
          };
          
          // minor kodni faqat agar null emas bo'lsa qo'shamiz
          if (minorCode !== null) {
            payload.AcsEventCond.minor = minorCode;
          }

          // Debug: payload ni ko'rsatish (faqat birinchi so'rovda har bir minor kod uchun)
          if (position === 0) {
            const minorDesc = minorCode === null ? 'all' : minorCode;
            console.log(`   📤 Payload (minor=${minorDesc}, position=${position}, loop=${loopCount}):`, JSON.stringify(payload, null, 2));
          }

          const response = await this.makeRequest(
            '/ISAPI/AccessControl/AcsEvent?format=json',
            'POST',
            payload,
            30000,
            'application/json'
          );

          const data = JSON.parse(response.data);
          
          if (data && data.AcsEvent) {
            // Check if there are more results
            if (data.AcsEvent.responseStatusStrg === 'MORE' || data.AcsEvent.responseStatusStrg === 'OK') {
              if (data.AcsEvent.InfoList) {
                let events = Array.isArray(data.AcsEvent.InfoList) 
                  ? data.AcsEvent.InfoList 
                  : [data.AcsEvent.InfoList];
                
                // JSON formatdan kelgan eventlarga minor kodni qo'shamiz
                // parseEvent funksiyasi minor kodga asoslanadi
                events = events.map((event, eventIndex) => {
                  // Event object bo'lmasa, object qilamiz
                  if (typeof event !== 'object' || event === null) {
                    return event;
                  }
                  // Yangi object yaratamiz (immutability uchun)
                  const enrichedEvent = { ...event };
                  
                  // Minor kodni HAR DOIM qo'shamiz (API dan kelgan minor kodni saqlaymiz)
                  enrichedEvent.minor = minorCode;
                  
                  // acsEventInfo ni yaratamiz yoki yangilaymiz
                  if (enrichedEvent.acsEventInfo && typeof enrichedEvent.acsEventInfo === 'object') {
                    enrichedEvent.acsEventInfo = { ...enrichedEvent.acsEventInfo, minor: minorCode };
                  } else {
                    enrichedEvent.acsEventInfo = { minor: minorCode };
                  }
                  
                  // Debug: first 5 events for each minor code
                  if (eventIndex < 5) {
                    console.log(`   ✅ Latest event ${eventIndex + 1} (minor=${minorCode}):`, {
                      serialNo: enrichedEvent.serialNo,
                      minor: enrichedEvent.minor,
                      acsEventInfo_minor: enrichedEvent.acsEventInfo?.minor,
                      type: enrichedEvent.acsEventInfo?.type || enrichedEvent.type || 'N/A'
                    });
                  }
                  
                  return enrichedEvent;
                });
                
                // Position ni FILTRDAN OLDIN yangilaymiz (chunki API dan kelgan barcha eventlarni o'qishimiz kerak)
                const eventsCountBeforeFilter = events.length;
                position += eventsCountBeforeFilter;
                
                // Debug: minor kod bo'yicha statistika (filtrdan oldin)
                if (eventsCountBeforeFilter > 0) {
                  console.log(`📊 Terminal ${this.terminal.name}: ${eventsCountBeforeFilter} ta event yuklandi minor=${minorCode} uchun (position: ${position})`);
                }
                
                // Client tomonida filtrlash: faqat lastSerial dan katta eventlar
                if (lastSerial > 0) {
                  events = events.filter(event => {
                    const eventSerial = parseInt(event.serialNo || event.serialno || 0);
                    return eventSerial > lastSerial;
                  });
                }
                
                // Debug: filtrdan keyin statistika
                if (events.length > 0) {
                  console.log(`   ✅ ${events.length} ta event filtrdan o'tdi (minor=${minorCode})`);
                }
                
                allEvents.push(...events);
                
                // hasMoreForMinor ni API javobiga qarab belgilaymiz
                hasMoreForMinor = data.AcsEvent.responseStatusStrg === 'MORE';
                
                // Small delay between requests
                if (hasMoreForMinor) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              } else {
                hasMoreForMinor = false;
              }
            } else {
              hasMoreForMinor = false;
            }
          } else {
            hasMoreForMinor = false;
          }
        }
          
          // Debug: har bir minor kod uchun statistika
          const minorEvents = allEvents.filter(e => e.minor === minorCode || e.acsEventInfo?.minor === minorCode);
          const finalLoopCount = typeof loopCount !== 'undefined' ? loopCount : 0;
          if (finalLoopCount >= maxLoops) {
            console.warn(`⚠️  Minor kod ${minorCode} uchun loop maksimal takrorlanish soniga yetdi (${maxLoops}). Loop to'xtatildi.`);
          }
          console.log(`✅ Terminal ${this.terminal.name}: minor=${minorCode} tugadi - ${minorEvents.length} ta event topildi (final position: ${position}, loops: ${finalLoopCount})`);
        }
        
        // Debug: entry va exit eventlar sonini hisoblash
        const entryEvents = allEvents.filter(e => e.minor === 75 || e.acsEventInfo?.minor === 75).length;
        const exitEvents = allEvents.filter(e => e.minor === 76 || e.acsEventInfo?.minor === 76).length;
        
        console.log(`✅ Terminal ${this.terminal.name}: Jami ${allEvents.length} ta yangi event olindi`);
        console.log(`   Entry (minor=75): ${entryEvents} ta`);
        console.log(`   Exit (minor=76): ${exitEvents} ta`);
        
        return allEvents;
    } catch (error) {
      console.error(`❌ Terminal ${this.terminal.name} getLatestEventsJSON xatolik:`, error.message);
      if (error.responseText) {
        console.error(`   Response: ${error.responseText.substring(0, 500)}`);
      }
      if (error.statusCode) {
        console.error(`   Status Code: ${error.statusCode}`);
      }
      throw error;
    }
  }

  
  async getAllEvents(startTime, endTime, batchSize = 100) {
    const allEvents = [];
    let searchResultPosition = 0;
    let hasMore = true;
    const searchID = `sync_${Date.now()}_${this.terminal.id}`;

    while (hasMore) {
      try {
        const result = await this.searchEvents({
          searchID: searchID,
          searchResultPosition: searchResultPosition,
          maxResults: batchSize,
          startTime: startTime,
          endTime: endTime
        });

        allEvents.push(...result.events);
        hasMore = result.hasMore;
        searchResultPosition += result.events.length;

        console.log(`📊 Terminal ${this.terminal.name}: ${allEvents.length} ta event topildi (hasMore: ${hasMore})`);

        
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ Terminal ${this.terminal.name} getAllEvents xatolik:`, error.message);
        
        console.log(`⚠️  XML format xatolik, JSON format bilan sinab ko'ramiz...`);
        try {
          const jsonEvents = await this.getAllEventsJSON(1000);
          return jsonEvents;
        } catch (jsonError) {
          throw error; 
        }
      }
    }

    return allEvents;
  }

  
  async testConnection() {
    try {
      const response = await this.makeRequest('/ISAPI/System/deviceInfo', 'GET', null, 10000);
      const deviceInfo = JSON.parse(response.data);
      
      return {
        success: true,
        message: 'Terminal bilan aloqa muvaffaqiyatli',
        deviceInfo: {
          deviceName: deviceInfo.DeviceInfo?.deviceName,
          model: deviceInfo.DeviceInfo?.model,
          firmwareVersion: deviceInfo.DeviceInfo?.firmwareVersion,
          serialNumber: deviceInfo.DeviceInfo?.serialNumber
        }
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        errorCode: error.errorCode || error.statusCode
      };
    }
  }

  
  async getUserList() {
    try {
      const payload = {
        UserInfoSearchCond: {
          searchID: `user_search_${Date.now()}`,
          searchResultPosition: 0,
          maxResults: 1000
        }
      };

      const response = await this.makeRequest('/ISAPI/AccessControl/UserInfo/Search?format=json', 'POST', JSON.stringify(payload), 30000);
      const data = JSON.parse(response.data);
      
      const users = [];
      if (data.UserInfoSearch && data.UserInfoSearch.UserInfo) {
        const userList = Array.isArray(data.UserInfoSearch.UserInfo) 
          ? data.UserInfoSearch.UserInfo 
          : [data.UserInfoSearch.UserInfo];
        
        userList.forEach(user => {
          users.push({
            employeeNo: user.employeeNo || user.employeeNoString || null,
            employeeNoString: user.employeeNoString || user.employeeNo || null,
            name: user.name || null,
            userType: user.userType || null,
            valid: user.valid !== false, 
            doorNo: user.doorNo || null
          });
        });
      }

      return {
        success: true,
        users: users,
        total: users.length
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        errorCode: error.errorCode || error.statusCode,
        users: []
      };
    }
  }

  
  async getFaceTemplates() {
    try {
      
      const endpoints = [
        '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
        '/ISAPI/AccessControl/FaceDataRecord?format=json',
        '/ISAPI/FDLib/FaceDataRecord?format=json'
      ];

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const payload = {
            FaceDataRecordSearchCond: {
              searchID: `face_search_${Date.now()}`,
              searchResultPosition: 0,
              maxResults: 1000
            }
          };

          const response = await this.makeRequest(endpoint, 'POST', JSON.stringify(payload), 30000);
          const data = JSON.parse(response.data);
          
          const faces = [];
          if (data.FaceDataRecord && data.FaceDataRecord.FaceLibType && data.FaceDataRecord.FaceDataRecord) {
            const faceList = Array.isArray(data.FaceDataRecord.FaceDataRecord) 
              ? data.FaceDataRecord.FaceDataRecord 
              : [data.FaceDataRecord.FaceDataRecord];
            
            faceList.forEach(face => {
              faces.push({
                employeeNo: face.employeeNo || face.employeeNoString || null,
                employeeNoString: face.employeeNoString || face.employeeNo || null,
                faceLibType: data.FaceDataRecord.FaceLibType || null,
                faceURL: face.faceURL || null,
                faceLibID: face.faceLibID || null
              });
            });
          }

          return {
            success: true,
            faces: faces,
            total: faces.length
          };
        } catch (error) {
          lastError = error;
          
          continue;
        }
      }

      
      throw lastError || new Error('Face templates endpoint not available');
    } catch (error) {
      
      
      console.warn('Face templates endpoint not available on this terminal model:', error.message);
      return {
        success: false,
        message: 'Face templates endpoint mavjud emas (bu terminal modelida qo\'llab-quvvatlanmaydi)',
        errorCode: error.errorCode || error.statusCode,
        faces: []
      };
    }
  }

  
  async getUsersAndFaces() {
    
    const userResult = await this.getUserList();
    
    
    let faceResult = { success: false, faces: [] };
    try {
      faceResult = await this.getFaceTemplates();
    } catch (error) {
      
      console.warn('Could not fetch face templates:', error.message);
    }

    
    const combined = userResult.users.map(user => {
      
      const matchingFace = faceResult.faces && faceResult.faces.length > 0
        ? faceResult.faces.find(face => 
            (face.employeeNoString && user.employeeNoString && face.employeeNoString === user.employeeNoString) ||
            (face.employeeNo && user.employeeNo && face.employeeNo === user.employeeNo)
          )
        : null;

      return {
        employeeNo: user.employeeNo || user.employeeNoString,
        employeeNoString: user.employeeNoString || user.employeeNo,
        name: user.name,
        userType: user.userType,
        valid: user.valid,
        faceLibType: matchingFace?.faceLibType || null,
        faceURL: matchingFace?.faceURL || null,
        faceLibID: matchingFace?.faceLibID || null
      };
    });

    return {
      success: userResult.success, 
      users: combined,
      total: combined.length,
      userCount: userResult.users.length,
      faceCount: faceResult.faces ? faceResult.faces.length : 0,
      faceTemplatesAvailable: faceResult.success
    };
  }

  /**
   * Download image from Hikvision terminal using Digest Auth
   * @param {string} imagePath - Path to image on terminal (e.g., /LOCALS/pic/acsLinkCap/202601_00/02_081324_30075_0.jpeg)
   * @param {string} savePath - Local path to save the image
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  async downloadImage(imagePath, savePath) {
    try {
      if (!imagePath) {
        return { success: false, error: 'Image path is required' };
      }

      // Ensure save directory exists
      const saveDir = path.dirname(savePath);
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      // Remove @WEB... suffix if present
      let cleanPath = imagePath;
      if (cleanPath.includes('@')) {
        cleanPath = cleanPath.split('@')[0];
      }

      const url = `${this.baseUrl}${cleanPath}`;
      console.log(`📥 Downloading image from: ${url}`);

      // Use digest-fetch client with proper configuration
      // Create a new client instance for this request to ensure fresh auth
      const username = this.terminal.username || 'admin';
      const password = this.terminal.password || 'admin12345';
      const client = new DigestClient(username, password, { 
        algorithm: 'MD5',
        logger: console // Enable logging for debugging
      });
      
      try {
        const response = await client.fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'image/*, */*',
            'User-Agent': 'Hikvision-ISAPI-Client'
          }
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`❌ Image download failed: HTTP ${response.status} ${response.statusText}`);
          console.error(`   Response: ${errorText.substring(0, 200)}`);
          return { 
            success: false, 
            error: `HTTP ${response.status}: ${response.statusText}` 
          };
        }

        // Get response as array buffer for binary data
        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        if (imageBuffer.length === 0) {
          console.error(`❌ Downloaded image is empty`);
          return {
            success: false,
            error: 'Downloaded image is empty'
          };
        }

        // Check if it's actually an image (not XML error)
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('xml') || imageBuffer.toString('utf8', 0, 50).includes('<?xml')) {
          const errorText = imageBuffer.toString('utf8', 0, 500);
          console.error(`❌ Image download failed: Server returned XML instead of image`);
          console.error(`   Response: ${errorText}`);
          return {
            success: false,
            error: 'Server returned XML error instead of image'
          };
        }

        // Save image to file
        fs.writeFileSync(savePath, imageBuffer);
        console.log(`✅ Image saved: ${savePath} (${imageBuffer.length} bytes)`);

        return {
          success: true,
          path: savePath
        };
      } catch (fetchError) {
        console.error(`❌ Image download fetch error:`, fetchError.message);
        console.error(`   Stack:`, fetchError.stack);
        return {
          success: false,
          error: fetchError.message
        };
      }
    } catch (error) {
      console.error(`❌ Image download error (${imagePath}):`, error.message);
      console.error(`   Stack:`, error.stack);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = HikvisionISAPIService;

