

const { Pool } = require('pg');
const HikvisionISAPIService = require('./hikvision-isapi');
const fs = require('fs');
const path = require('path');

class AttendanceSyncService {
  constructor(dbPool) {
    this.db = dbPool;
    this.terminalServices = new Map(); 
    this.isRunning = false;
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

  
  async initTerminal(terminal) {
    if (this.terminalServices.has(terminal.id)) {
      return this.terminalServices.get(terminal.id);
    }

    const service = new HikvisionISAPIService(terminal);
    
    
    service.on('event', (parsedEvent) => {
      this.handleStreamEvent(terminal.id, parsedEvent);
    });

    service.on('error', (error) => {
      console.error(`❌ Terminal ${terminal.name} stream error:`, error.message);
    });

    service.on('streamFailed', () => {
      console.log(`⚠️  Terminal ${terminal.name} stream failed, falling back to polling`);
      
    });

    this.terminalServices.set(terminal.id, service);
    return service;
  }

  
  async storeEvent(terminalId, parsedEvent) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      
      // Duplicate tekshirish - vaqtni ham hisobga olgan holda (bir xil vaqtda bir xil event kelib qolmasligi uchun)
      // Avval terminal ma'lumotlarini olish (vaqtni tekshirish uchun kerak)
      const terminalResult = await client.query(
        'SELECT name, terminal_type, admin_id FROM terminals WHERE id = $1',
        [terminalId]
      );

      if (terminalResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { saved: false, reason: 'terminal_not_found' };
      }

      const terminalName = terminalResult.rows[0].name;
      const terminalType = terminalResult.rows[0].terminal_type; // 'entry' or 'exit'
      const terminalAdminId = terminalResult.rows[0].admin_id; // Terminal'ning admin_id
      
      let employeeId = null;
      let employeeUsername = null;
      let employeeFullName = null;
      
      
      if (parsedEvent.employeeNoString) {
        // Terminal'ning admin_id ni olish (ma'lumotlar aralashib ketmasligi uchun)
        const terminalAdminResult = await client.query(
          'SELECT admin_id FROM terminals WHERE id = $1',
          [terminalId]
        );
        
        const terminalAdminId = terminalAdminResult.rows.length > 0 ? terminalAdminResult.rows[0].admin_id : null;
        
        if (!terminalAdminId) {
          console.warn(`⚠️  Terminal admin_id topilmadi: terminalId=${terminalId}`);
        }
        
        // Employee'ni topish - admin_id bo'yicha izolyatsiya
        const employeeMapping = await client.query(
          `SELECT e.id, e.full_name, u.username 
           FROM employees e
           JOIN users u ON e.user_id = u.id
           JOIN employee_faces ef ON e.id = ef.employee_id
           WHERE ef.face_template_id = $1 
             AND ef.terminal_id = $2
             ${terminalAdminId ? 'AND e.admin_id = $3 AND ef.admin_id = $3' : ''}`,
          terminalAdminId ? [parsedEvent.employeeNoString, terminalId, terminalAdminId] : [parsedEvent.employeeNoString, terminalId]
        );

        if (employeeMapping.rows.length > 0) {
          employeeId = employeeMapping.rows[0].id;
          employeeUsername = employeeMapping.rows[0].username;
          employeeFullName = employeeMapping.rows[0].full_name;
          console.log(`✅ Employee found via employee_faces: ID=${employeeId}, Username=${employeeUsername}, TemplateID=${parsedEvent.employeeNoString}`);
        }
      }
      
      
      // First try: Match by user_id directly (employeeNoString = user_id)
      // MUHIM: admin_id bo'yicha izolyatsiya
      if (!employeeId && parsedEvent.employeeNoString) {
        const numericId = parseInt(parsedEvent.employeeNoString);
        if (!isNaN(numericId) && numericId > 0) {
          // Terminal'ning admin_id ni olish
          const terminalAdminResult = await client.query(
            'SELECT admin_id FROM terminals WHERE id = $1',
            [terminalId]
          );
          
          const terminalAdminId = terminalAdminResult.rows.length > 0 ? terminalAdminResult.rows[0].admin_id : null;
          
          // Try matching employeeNoString with user_id - admin_id bo'yicha filtrlash
          const userMatch = await client.query(
            `SELECT e.id, e.full_name, u.username, u.id as user_id FROM employees e
             JOIN users u ON e.user_id = u.id
             WHERE u.id = $1 ${terminalAdminId ? 'AND e.admin_id = $2' : ''}`,
            terminalAdminId ? [numericId, terminalAdminId] : [numericId]
          );
          if (userMatch.rows.length > 0) {
            employeeId = userMatch.rows[0].id;
            employeeUsername = userMatch.rows[0].username;
            employeeFullName = userMatch.rows[0].full_name;
            console.log(`✅ Employee found via user_id match: user_id=${numericId} -> employee_id=${employeeId}, Username=${employeeUsername}`);
          }
        }
      }
      
      // Second try: Match by employee.id (if employeeNoString is employee ID)
      // MUHIM: admin_id bo'yicha izolyatsiya
      if (!employeeId && parsedEvent.employeeNoString) {
        const numericId = parseInt(parsedEvent.employeeNoString);
        if (!isNaN(numericId) && numericId > 0) {
          // Terminal'ning admin_id ni olish
          const terminalAdminResult = await client.query(
            'SELECT admin_id FROM terminals WHERE id = $1',
            [terminalId]
          );
          
          const terminalAdminId = terminalAdminResult.rows.length > 0 ? terminalAdminResult.rows[0].admin_id : null;
          
          const directMatch = await client.query(
            `SELECT e.id, e.full_name, u.username FROM employees e
             JOIN users u ON e.user_id = u.id
             WHERE e.id = $1 ${terminalAdminId ? 'AND e.admin_id = $2' : ''}`,
            terminalAdminId ? [numericId, terminalAdminId] : [numericId]
          );
          if (directMatch.rows.length > 0) {
            employeeId = directMatch.rows[0].id;
            employeeUsername = directMatch.rows[0].username;
            employeeFullName = directMatch.rows[0].full_name;
            console.log(`✅ Employee found via direct ID match: ID=${employeeId}, Username=${employeeUsername}`);
          }
        }
      }
      
      
      // Name match - admin_id bo'yicha izolyatsiya
      if (!employeeId && parsedEvent.employeeNoString) {
        // Terminal'ning admin_id ni olish
        const terminalAdminResult = await client.query(
          'SELECT admin_id FROM terminals WHERE id = $1',
          [terminalId]
        );
        
        const terminalAdminId = terminalAdminResult.rows.length > 0 ? terminalAdminResult.rows[0].admin_id : null;
        
        const nameMatch = await client.query(
          `SELECT e.id, e.full_name, u.username FROM employees e
           JOIN users u ON e.user_id = u.id
           WHERE LOWER(TRIM(e.full_name)) = LOWER(TRIM($1)) 
           ${terminalAdminId ? 'AND e.admin_id = $2' : ''}
           LIMIT 1`,
          terminalAdminId ? [parsedEvent.employeeNoString, terminalAdminId] : [parsedEvent.employeeNoString]
        );
        if (nameMatch.rows.length > 0) {
          employeeId = nameMatch.rows[0].id;
          employeeUsername = nameMatch.rows[0].username;
          employeeFullName = nameMatch.rows[0].full_name;
          console.log(`✅ Employee found via name match: ID=${employeeId}, Username=${employeeUsername}`);
        }
      }
      
      
      // Username match - admin_id bo'yicha izolyatsiya
      if (!employeeId && parsedEvent.employeeNoString) {
        // Terminal'ning admin_id ni olish
        const terminalAdminResult = await client.query(
          'SELECT admin_id FROM terminals WHERE id = $1',
          [terminalId]
        );
        
        const terminalAdminId = terminalAdminResult.rows.length > 0 ? terminalAdminResult.rows[0].admin_id : null;
        
        const usernameMatch = await client.query(
          `SELECT e.id, e.full_name, u.username FROM employees e
           JOIN users u ON e.user_id = u.id
           WHERE u.username = $1 
           ${terminalAdminId ? 'AND e.admin_id = $2' : ''}
           LIMIT 1`,
          terminalAdminId ? [parsedEvent.employeeNoString, terminalAdminId] : [parsedEvent.employeeNoString]
        );
        if (usernameMatch.rows.length > 0) {
          employeeId = usernameMatch.rows[0].id;
          employeeUsername = usernameMatch.rows[0].username;
          employeeFullName = usernameMatch.rows[0].full_name;
          console.log(`✅ Employee found via username match: ID=${employeeId}, Username=${employeeUsername}`);
        }
      }
      
      
      // Agar employeeId topilgan bo'lsa, full_name ni olish (agar hali olmagan bo'lsak)
      if (employeeId && !employeeFullName) {
        const fullNameResult = await client.query(
          'SELECT full_name FROM employees WHERE id = $1',
          [employeeId]
        );
        if (fullNameResult.rows.length > 0) {
          employeeFullName = fullNameResult.rows[0].full_name;
        }
      }
      
      if (!employeeId) {
        employeeUsername = parsedEvent.employeeNoString || 'Noma\'lum';
        employeeFullName = parsedEvent.employeeNoString || 'Noma\'lum';
      } else {
        // If employeeId was found via other methods, ensure employee_faces mapping exists
        if (parsedEvent.employeeNoString) {
          const faceMappingCheck = await client.query(
            `SELECT id FROM employee_faces 
             WHERE employee_id = $1 AND terminal_id = $2`,
            [employeeId, terminalId]
          );
          
          if (faceMappingCheck.rows.length === 0) {
            // Create mapping automatically
            // Get admin_id from employee
            const adminResult = await client.query(
              'SELECT admin_id FROM employees WHERE id = $1',
              [employeeId]
            );
            const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].admin_id : null;
            
            if (adminId) {
              await client.query(
                `INSERT INTO employee_faces (employee_id, terminal_id, face_template_id, admin_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (employee_id, terminal_id) 
                 DO UPDATE SET face_template_id = EXCLUDED.face_template_id, admin_id = EXCLUDED.admin_id`,
                [employeeId, terminalId, parsedEvent.employeeNoString, adminId]
              );
              console.log(`✅ Auto-created employee_faces mapping: employee_id=${employeeId}, face_template_id="${parsedEvent.employeeNoString}"`);
            }
          }
        }
      }

      
      
      // Event time'ni aniq vaqt bilan parse qilish - timezone konvertatsiyasi bilan
      // MUHIM: 3 soat qo'shishni olib tashlash - terminal allaqachon timezone offset bilan yuboradi
      let eventTime = parsedEvent.eventTime;
      let parsedEventTime = null;
      
      if (eventTime instanceof Date) {
        // Agar Date object bo'lsa, to'g'ridan-to'g'ri ishlatish (timezone allaqachon konvertatsiya qilingan)
        parsedEventTime = eventTime;
        console.log(`🕐 Event time (Date object): ${parsedEventTime.toISOString()}`);
      } else if (typeof eventTime === 'string' && eventTime.trim()) {
        // String formatini parse qilish
        try {
          // ISO 8601 formatini parse qilish (timezone offset bilan)
          // Format: "2026-01-20T22:33:26+08:00" yoki "2026-01-20T22:33:26"
          parsedEventTime = new Date(eventTime);
          
          // Agar parse qilish muvaffaqiyatsiz bo'lsa, custom formatni sinab ko'rish
          if (isNaN(parsedEventTime.getTime())) {
            // Custom format: "2026-01-20 22:33:26" yoki "2026-01-20T22:33:26"
            const customDate = eventTime.replace(/[T ]/, ' ').trim();
            parsedEventTime = new Date(customDate);
            
            if (isNaN(parsedEventTime.getTime())) {
              console.warn(`⚠️  Event time parse qilinmadi: "${eventTime}", hozirgi vaqt ishlatilmoqda`);
              parsedEventTime = new Date();
            }
          }
          
          // Timezone offset mavjud bo'lsa, Date object avtomatik UTC ga konvertatsiya qiladi
          // Agar timezone offset yo'q bo'lsa, UTC deb hisoblaymiz
          if (eventTime.includes('+') || (eventTime.includes('-') && eventTime.match(/[+-]\d{2}:\d{2}$/))) {
            console.log(`🕐 Event time parsed (with timezone): ${eventTime} -> ${parsedEventTime.toISOString()}`);
          } else {
            console.log(`🕐 Event time parsed (no timezone, UTC): ${eventTime} -> ${parsedEventTime.toISOString()}`);
          }
        } catch (timeError) {
          console.error(`❌ Event time parse error: ${timeError.message}, hozirgi vaqt ishlatilmoqda`);
          parsedEventTime = new Date();
        }
      } else if (eventTime) {
        // Boshqa format
        try {
          parsedEventTime = new Date(eventTime);
          if (isNaN(parsedEventTime.getTime())) {
            parsedEventTime = new Date();
          }
        } catch (e) {
          parsedEventTime = new Date();
        }
      } else {
        // Event time yo'q bo'lsa, hozirgi vaqtni ishlatish
        parsedEventTime = new Date();
        console.log(`ℹ️  Event time yo'q, hozirgi vaqt ishlatilmoqda: ${parsedEventTime.toISOString()}`);
      }
      
      // Final event time (UTC formatda database'ga saqlanadi)
      // MUHIM: 3 soat qo'shish (Toshkent vaqti uchun UTC+5, terminal UTC+8 dan keladi)
      // Terminal yuboradi: "2026-01-21T01:33:20+08:00" (UTC+8) -> UTC: "2026-01-20T17:33:20Z"
      // 3 soat qo'shamiz: "2026-01-20T20:33:20Z" (Toshkent vaqti uchun)
      parsedEventTime = new Date(parsedEventTime.getTime() + 3 * 60 * 60 * 1000);
      console.log(`🕐 Event time 3 soat qo'shildi: ${parsedEventTime.toISOString()} (UTC)`);
      
      eventTime = parsedEventTime;
      
      // MUHIM: Terminal turi asosiy - terminal turiga qarab barcha eventlar o'sha turda yuritiladi
      // Agar terminal turi "kirish" bo'lsa, barcha eventlar "kirish" deb yuritiladi
      // Agar terminal turi "chiqish" bo'lsa, barcha eventlar "chiqish" deb yuritiladi
      let finalEventType;
      
      if (terminalType === 'entry') {
        // Terminal turi "kirish" bo'lsa, barcha eventlar "kirish" deb yuritiladi (event ma'lumotlaridan qat'iy nazar)
        finalEventType = 'entry';
        if (parsedEvent.eventType && parsedEvent.eventType !== 'entry') {
          console.log(`🔄 Terminal "${terminalName}" turi "entry" - event type "${parsedEvent.eventType}" -> "entry" ga o'zgartirildi (terminal turi asosiy, minor: ${parsedEvent.rawEvent?.minor || 'N/A'})`);
        }
      } else if (terminalType === 'exit') {
        // Terminal turi "chiqish" bo'lsa, barcha eventlar "chiqish" deb yuritiladi (event ma'lumotlaridan qat'iy nazar)
        finalEventType = 'exit';
        if (parsedEvent.eventType && parsedEvent.eventType !== 'exit') {
          console.log(`🔄 Terminal "${terminalName}" turi "exit" - event type "${parsedEvent.eventType}" -> "exit" ga o'zgartirildi (terminal turi asosiy, minor: ${parsedEvent.rawEvent?.minor || 'N/A'})`);
        }
      } else {
        // Agar terminal type yo'q bo'lsa, event ma'lumotlaridan olish (fallback)
        finalEventType = parsedEvent.eventType || 'entry';
        if (!parsedEvent.eventType) {
          console.warn(`⚠️  Terminal "${terminalName}" da terminal_type yo'q va eventType ham yo'q, fallback: "entry"`);
        }
      }
      
      // Debug logging - barcha eventlar uchun eventType ni ko'rsatish
      const serialNoNum = parsedEvent.serialNo ? parseInt(parsedEvent.serialNo) : 0;
      
      // Always log exit events for debugging
      const shouldLog = serialNoNum <= 30 || !parsedEvent.eventType || parsedEvent.eventType === 'exit' || finalEventType !== parsedEvent.eventType;
      
      if (shouldLog) {
        if (!parsedEvent.eventType) {
          console.warn(`⚠️  Event serialNo ${parsedEvent.serialNo} da eventType yo'q! Fallback: ${finalEventType}`);
        } else {
          const eventTypeEmoji = finalEventType === 'entry' ? '✅' : finalEventType === 'exit' ? '🚪' : '❓';
          const originalEmoji = parsedEvent.eventType === 'entry' ? '✅' : parsedEvent.eventType === 'exit' ? '🚪' : '❓';
          if (finalEventType !== parsedEvent.eventType) {
            console.log(`${eventTypeEmoji} Storing event - SerialNo: ${parsedEvent.serialNo}, Original: ${parsedEvent.eventType} ${originalEmoji} -> Final: ${finalEventType} ${eventTypeEmoji} (Terminal: ${terminalName}, Type: ${terminalType}), employee: ${employeeUsername}`);
          } else {
            console.log(`${eventTypeEmoji} Storing event - SerialNo: ${parsedEvent.serialNo}, eventType: ${finalEventType}, employee: ${employeeUsername}`);
          }
        }
      }
      
      // Get admin_id - MUHIM: Terminal'ning admin_id ni birinchi navbatda ishlatish
      // (ma'lumotlar aralashib ketmasligi uchun - har bir terminal'ning o'z admin_id si bor)
      let adminId = terminalAdminId; // Terminal'ning admin_id dan boshlash
      
      if (employeeId) {
        const adminResult = await client.query(
          'SELECT admin_id FROM employees WHERE id = $1',
          [employeeId]
        );
        if (adminResult.rows.length > 0) {
          const employeeAdminId = adminResult.rows[0].admin_id;
          
          // Employee va terminal'ning admin_id mos kelishi kerak (ma'lumotlar izolyatsiyasi)
          if (adminId && employeeAdminId !== adminId) {
            console.warn(`⚠️  Employee va terminal'ning admin_id mos kelmaydi: employee.admin_id=${employeeAdminId}, terminal.admin_id=${adminId}`);
            console.warn(`   Terminal'ning admin_id ishlatilmoqda: ${adminId} (terminal source of truth)`);
            // Terminal'ning admin_id ni ishlatish (terminal source of truth - ma'lumotlar aralashib ketmasligi uchun)
          } else if (!adminId) {
            adminId = employeeAdminId;
          }
        }
      }
      
      // If still no admin_id, this is an error case - we need admin_id
      if (!adminId) {
        await client.query('ROLLBACK');
        console.error(`❌ Cannot determine admin_id for attendance log - terminalId: ${terminalId}, employeeId: ${employeeId}`);
        return { saved: false, reason: 'admin_id_not_found' };
      }
      
      // Admin_id ni log qilish (ma'lumotlar izolyatsiyasini tekshirish uchun)
      console.log(`🔐 Admin ID aniqlandi: ${adminId} (terminal: ${terminalId}, employee: ${employeeId || 'NULL'})`);
      
      // Duplicate tekshirish - vaqtni ham hisobga olgan holda (bir xil vaqtda bir xil event kelib qolmasligi uchun)
      // MUHIM: eventTime va finalEventType aniqlanganidan keyin duplicate check qilishimiz kerak
      // 1) Serial number + terminal + admin + vaqt (1 soniya ichida) - asosiy check
      const duplicateCheck1 = await client.query(
        `SELECT id FROM attendance_logs 
         WHERE serial_no = $1 
           AND terminal_name = $2
           AND admin_id = $3
           AND ABS(EXTRACT(EPOCH FROM (event_time - $4::timestamp))) < 1`,
        [parsedEvent.serialNo, terminalName, adminId, eventTime]
      );
      
      if (duplicateCheck1.rows.length > 0) {
        await client.query('ROLLBACK');
        console.log(`ℹ️  Duplicate event o'tkazib yuborildi (serial_no+time match): serialNo="${parsedEvent.serialNo}", terminal="${terminalName}", time=${eventTime.toISOString()}`);
        return { saved: false, reason: 'duplicate' };
      }
      
      // 2) Employee + Terminal + Event Type + Vaqt (1 soniya ichida) - ISHONCHLI
      // Bir xil vaqtda, bir xil employee, bir xil terminal, bir xil event type uchun faqat bitta event
      if (employeeId && finalEventType) {
        const duplicateCheck2 = await client.query(
          `SELECT id FROM attendance_logs 
           WHERE employee_id = $1
             AND terminal_name = $2
             AND admin_id = $3
             AND event_type = $4
             AND ABS(EXTRACT(EPOCH FROM (event_time - $5::timestamp))) < 1`,
          [employeeId, terminalName, adminId, finalEventType, eventTime]
        );
        
        if (duplicateCheck2.rows.length > 0) {
          await client.query('ROLLBACK');
          console.log(`ℹ️  Duplicate event o'tkazib yuborildi (employee+eventType+time match): employeeId=${employeeId}, terminal="${terminalName}", eventType="${finalEventType}", time=${eventTime.toISOString()}`);
          return { saved: false, reason: 'duplicate' };
        }
      }
      
      // 3) Employee Name + Terminal + Event Type + Vaqt (1 soniya ichida) - fallback
      // Employee topilmasa ham, bir xil vaqtda bir xil employee_name uchun duplicate check
      if (finalEventType) {
        const employeeName = employeeFullName || employeeUsername || parsedEvent.employeeNoString || 'Noma\'lum';
        const duplicateCheck3 = await client.query(
          `SELECT id FROM attendance_logs 
           WHERE employee_name = $1
             AND terminal_name = $2
             AND admin_id = $3
             AND event_type = $4
             AND ABS(EXTRACT(EPOCH FROM (event_time - $5::timestamp))) < 1`,
          [employeeName, terminalName, adminId, finalEventType, eventTime]
        );
        
        if (duplicateCheck3.rows.length > 0) {
          await client.query('ROLLBACK');
          console.log(`ℹ️  Duplicate event o'tkazib yuborildi (employeeName+eventType+time match): employeeName="${employeeName}", terminal="${terminalName}", eventType="${finalEventType}", time=${eventTime.toISOString()}`);
          return { saved: false, reason: 'duplicate' };
        }
      }
      
      // Download and save face image if pictureUrl exists
      let savedImagePath = parsedEvent.pictureUrl || null;
      
      // Debug: log pictureUrl
      if (parsedEvent.pictureUrl) {
        console.log(`📷 PictureUrl mavjud: ${parsedEvent.pictureUrl}`);
      } else {
        console.log(`⚠️  PictureUrl mavjud emas yoki null`);
      }
      
      if (parsedEvent.pictureUrl) {
        try {
          const service = this.terminalServices.get(terminalId);
          if (!service) {
            console.warn(`⚠️  Terminal service topilmadi terminalId=${terminalId}`);
            savedImagePath = parsedEvent.pictureUrl;
          } else {
            // Extract path from URL if it's a full URL
            // Format: http://192.168.1.10/LOCALS/pic/acsLinkCap/202601_00/07_051227_30075_0.jpeg@WEB000000000118
            // Or: /LOCALS/pic/acsLinkCap/202601_00/07_051227_30075_0.jpeg@WEB000000000118
            let imagePath = parsedEvent.pictureUrl;
            
            // Remove @WEB... suffix if present
            if (imagePath.includes('@')) {
              imagePath = imagePath.split('@')[0];
            }
            
            // Extract path from full URL
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
              try {
                const url = new URL(imagePath);
                imagePath = url.pathname;
              } catch (e) {
                // If URL parsing fails, try to extract path manually
                const match = imagePath.match(/\/LOCALS\/[^@]+/);
                if (match) {
                  imagePath = match[0];
                }
              }
            }
            
            // Only proceed if we have a valid path
            if (imagePath && imagePath.startsWith('/')) {
              // Create faces directory if it doesn't exist
              const facesDir = path.join(__dirname, '..', 'public', 'uploads', 'faces');
              if (!fs.existsSync(facesDir)) {
                fs.mkdirSync(facesDir, { recursive: true });
                console.log(`📁 Faces directory yaratildi: ${facesDir}`);
              }
              
              // Generate unique filename
              const timestamp = Date.now();
              const serialNo = parsedEvent.serialNo || 'unknown';
              const ext = path.extname(imagePath) || '.jpg';
              const filename = `face_${terminalId}_${serialNo}_${timestamp}${ext}`;
              const savePath = path.join(facesDir, filename);
              
              console.log(`📥 Rasm yuklab olinmoqda: ${imagePath} -> ${savePath}`);
              
              // Download image
              const downloadResult = await service.downloadImage(imagePath, savePath);
              
              if (downloadResult.success) {
                // Use relative path for database (accessible via /uploads/faces/filename)
                savedImagePath = `/uploads/faces/${filename}`;
                console.log(`✅ Face image saved: ${savedImagePath}`);
              } else {
                console.warn(`⚠️  Failed to download face image: ${downloadResult.error}`);
                // Keep original URL if download fails
                savedImagePath = parsedEvent.pictureUrl;
              }
            } else {
              console.log(`ℹ️  PictureUrl format not supported: ${parsedEvent.pictureUrl} -> extracted: ${imagePath} (must start with /)`);
              savedImagePath = parsedEvent.pictureUrl;
            }
          }
        } catch (error) {
          console.error(`❌ Error downloading face image:`, error);
          console.error(`   Error stack:`, error.stack);
          // Keep original URL if download fails
          savedImagePath = parsedEvent.pictureUrl;
        }
      }
      
      const insertResult = await client.query(
        `INSERT INTO attendance_logs (
          employee_id, employee_name, terminal_name, event_time, 
          event_type, verification_mode, serial_no, picture_url, admin_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (serial_no, terminal_name, admin_id) DO NOTHING
        RETURNING id`,
        [
          employeeId,
          employeeFullName || employeeUsername || parsedEvent.employeeNoString || 'Noma\'lum', // employee_name uchun full_name ishlatish
          terminalName,
          eventTime,
          finalEventType,
          parsedEvent.verificationMode,
          parsedEvent.serialNo,
          savedImagePath,
          adminId
        ]
      );
      
      // Agar duplikat bo'lsa, hech narsa qilmaymiz
      if (!insertResult.rows || insertResult.rows.length === 0) {
        await client.query('COMMIT');
        return { saved: false, reason: 'duplicate' };
      }

      await client.query('COMMIT');

      // Cleanup old face images for this employee (keep only last 10)
      if (employeeId && savedImagePath && savedImagePath.startsWith('/uploads/faces/')) {
        // Run cleanup asynchronously after commit
        this.cleanupOldFaceImages(employeeId).catch(err => {
          console.error(`⚠️  Error cleaning up old face images for employee ${employeeId}:`, err.message);
        });
      }

      return {
        saved: true,
        id: insertResult.rows[0].id,
        employeeId: employeeId,
        employeeName: employeeFullName || employeeUsername
      };
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Unique constraint xatoligini maxsus qayta ishlash
      if (error.code === '23505' && error.constraint === 'attendance_logs_serial_no_terminal_name_key') {
        // Bu duplikat event - xatolik emas, faqat log qilamiz
        console.log(`ℹ️  Duplikat event o'tkazib yuborildi (serialNo: ${parsedEvent.serialNo}, terminal: ${terminalName || 'unknown'})`);
        return { saved: false, reason: 'duplicate' };
      }
      
      console.error(`❌ Store event xatolik (serialNo: ${parsedEvent.serialNo}):`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cleanup old face images for an employee, keeping only the last 10 images
   * @param {number} employeeId - Employee ID
   */
  async cleanupOldFaceImages(employeeId) {
    const client = await this.db.connect();
    
    try {
      // Get all attendance logs with picture_url for this employee, ordered by event_time DESC
      const result = await client.query(
        `SELECT id, picture_url, event_time 
         FROM attendance_logs 
         WHERE employee_id = $1 
           AND picture_url IS NOT NULL 
           AND picture_url LIKE '/uploads/faces/%'
         ORDER BY event_time DESC`,
        [employeeId]
      );

      const logs = result.rows;
      
      // If we have more than 10 images, delete the old ones
      if (logs.length > 10) {
        const logsToDelete = logs.slice(10); // Skip first 10 (most recent), delete the rest
        const facesDir = path.join(__dirname, '..', 'public', 'uploads', 'faces');
        
        let deletedCount = 0;
        let fileDeletedCount = 0;
        
        for (const log of logsToDelete) {
          try {
            // Delete file from filesystem
            if (log.picture_url && log.picture_url.startsWith('/uploads/faces/')) {
              const filename = log.picture_url.replace('/uploads/faces/', '');
              const filePath = path.join(facesDir, filename);
              
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                fileDeletedCount++;
                console.log(`🗑️  Deleted old face image file: ${filename}`);
              }
            }
            
            // Update database: set picture_url to NULL
            await client.query(
              'UPDATE attendance_logs SET picture_url = NULL WHERE id = $1',
              [log.id]
            );
            deletedCount++;
            
          } catch (error) {
            console.error(`⚠️  Error deleting old image for log ID ${log.id}:`, error.message);
          }
        }
        
        if (deletedCount > 0) {
          console.log(`🧹 Cleaned up ${deletedCount} old face images for employee ${employeeId} (${fileDeletedCount} files deleted, keeping last 10)`);
        }
      }
    } catch (error) {
      console.error(`❌ Error in cleanupOldFaceImages for employee ${employeeId}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  
  async handleStreamEvent(terminalId, parsedEvent) {
    try {
      const result = await this.storeEvent(terminalId, parsedEvent);
      
      if (result.saved) {
        console.log(`✅ Event saqlandi: ${result.employeeName} - ${parsedEvent.eventType} (serialNo: ${parsedEvent.serialNo})`);
      } else if (result.reason === 'duplicate') {
        
      } else {
        console.warn(`⚠️  Event saqlanmadi: ${result.reason}`);
      }
    } catch (error) {
      console.error(`❌ Stream event saqlashda xatolik:`, error.message);
    }
  }

  
  async syncHistoricalEvents(terminal, startTime, endTime) {
    // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
    if (this.isPrivateIP(terminal.ip_address)) {
      console.log(`ℹ️  Terminal ${terminal.name} (${terminal.ip_address}) private IP - historical sync o'tkazib yuborildi (webhook orqali ishlaydi)`);
      return { success: false, reason: 'private_ip', message: 'Terminal private IP\'da, webhook orqali ishlaydi' };
    }

    try {
      const service = await this.initTerminal(terminal);
      
      console.log(`🔄 Terminal ${terminal.name} historical sync boshlanmoqda...`);
      console.log(`   Sana oralig'i: ${startTime} - ${endTime}`);

      const allEvents = await service.getAllEvents(startTime, endTime);
      
      console.log(`📊 Terminal ${terminal.name}: ${allEvents.length} ta event topildi`);

      let savedCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      for (const rawEvent of allEvents) {
        const parsedEvent = service.parseEvent(rawEvent);
        
        if (!parsedEvent) {
          continue; 
        }

        try {
          const result = await this.storeEvent(terminal.id, parsedEvent);
          
          if (result.saved) {
            savedCount++;
          } else if (result.reason === 'duplicate') {
            duplicateCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Event saqlashda xatolik:`, error.message);
        }
      }

      console.log(`✅ Terminal ${terminal.name} sync tugadi:`);
      console.log(`   Saqlandi: ${savedCount} ta`);
      console.log(`   Duplikat: ${duplicateCount} ta`);
      console.log(`   Xatolar: ${errorCount} ta`);

      return {
        totalFound: allEvents.length,
        saved: savedCount,
        duplicates: duplicateCount,
        errors: errorCount
      };
    } catch (error) {
      console.error(`❌ Terminal ${terminal.name} historical sync xatolik:`, error.message);
      throw error;
    }
  }

  
  async startRealTimeStreaming(terminals) {
    console.log(`🚀 Real-time streaming ishga tushmoqda (${terminals.length} ta terminal)...`);

    for (const terminal of terminals) {
      if (!terminal.is_active) {
        console.log(`⏭️  Terminal ${terminal.name} faol emas, o'tkazib yuborildi`);
        continue;
      }

      // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
      if (this.isPrivateIP(terminal.ip_address)) {
        console.log(`ℹ️  Terminal ${terminal.name} (${terminal.ip_address}) private IP - streaming o'tkazib yuborildi (webhook orqali ishlaydi)`);
        continue;
      }

      try {
        const service = await this.initTerminal(terminal);
        await service.startRealTimeStream();
      } catch (error) {
        console.error(`❌ Terminal ${terminal.name} stream ishga tushirishda xatolik:`, error.message);
      }
    }

    this.isRunning = true;
  }

  
  async stopRealTimeStreaming() {
    console.log(`⏹️  Barcha streamlar to'xtatilmoqda...`);

    for (const [terminalId, service] of this.terminalServices) {
      try {
        service.stopRealTimeStream();
      } catch (error) {
        console.error(`❌ Terminal ${terminalId} stream to'xtatishda xatolik:`, error.message);
      }
    }

    this.isRunning = false;
  }

  
  async initialFullSync(terminals, daysBack = 7) {
    console.log(`🔄 Initial full sync boshlanmoqda (oxirgi ${daysBack} kun)...`);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - daysBack * 24 * 60 * 60 * 1000);

    
    const startTimeStr = startTime.toISOString().replace('Z', '').split('.')[0];
    const endTimeStr = endTime.toISOString().replace('Z', '').split('.')[0];

    for (const terminal of terminals) {
      if (!terminal.is_active) {
        continue;
      }

      try {
        await this.syncHistoricalEvents(terminal, startTimeStr, endTimeStr);
      } catch (error) {
        console.error(`❌ Terminal ${terminal.name} initial sync xatolik:`, error.message);
      }
    }

    console.log(`✅ Initial full sync tugadi`);
  }

  
  async incrementalSync(terminals, minutesBack = 5) {
    for (const terminal of terminals) {
      if (!terminal.is_active) {
        continue;
      }

      // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
      if (this.isPrivateIP(terminal.ip_address)) {
        continue; // Skip private IP terminals
      }

      try {
        const service = await this.initTerminal(terminal);
        
        
        const lastSerialResult = await this.db.query(
          `SELECT MAX(CASE WHEN serial_no ~ '^[0-9]+$' THEN CAST(serial_no AS INTEGER) ELSE 0 END) as last_serial 
           FROM attendance_logs WHERE terminal_name = $1`,
          [terminal.name]
        );
        
        const lastSerial = parseInt(lastSerialResult.rows[0]?.last_serial) || 0;
        
        
        let newEvents = [];
        try {
          newEvents = await service.getLatestEventsJSON(lastSerial, 5000, 100);
        } catch (error) {
          // Account qulfini tekshirish
          if (error.statusCode === 401 && error.isAccountLocked) {
            const unlockMinutes = Math.ceil(error.unlockTimeSeconds / 60);
            console.error(`\n🔒 ============================================`);
            console.error(`🔒 Terminal ${terminal.name} accounti QULFLANGAN!`);
            console.error(`🔒 ============================================`);
            console.error(`   Username: ${terminal.username || 'admin'}`);
            console.error(`   IP: ${terminal.ip_address}`);
            console.error(`   Qulf vaqti: ${unlockMinutes} daqiqa (${error.unlockTimeSeconds} soniya)`);
            console.error(`\n   ✅ YECHIM:`);
            console.error(`   1. Terminalni fizik jihatdan qayta ishga tushiring, YOKI`);
            console.error(`   2. ${unlockMinutes} daqiqa kutib turing, YOKI`);
            console.error(`   3. Terminal Web interfeysida account qulfini oching`);
            console.error(`🔒 ============================================\n`);
            continue; // Keyingi terminalga o'tish
          }
          
          console.log(`⚠️  Terminal ${terminal.name}: serialNoGreaterThan qo'llab-quvvatlanmaydi, fallback...`);
          try {
            const allEvents = await service.getAllEventsJSON(5000, 100);
            
            newEvents = allEvents.filter(event => {
              const eventSerialNo = parseInt(event.serialNo || event.acsEventInfo?.serialNo || 0);
              return eventSerialNo > lastSerial;
            });
          } catch (fallbackError) {
            // Account qulfini tekshirish (fallback'da ham)
            if (fallbackError.statusCode === 401 && fallbackError.isAccountLocked) {
              const unlockMinutes = Math.ceil(fallbackError.unlockTimeSeconds / 60);
              console.error(`\n🔒 ============================================`);
              console.error(`🔒 Terminal ${terminal.name} accounti QULFLANGAN! (Fallback)`);
              console.error(`🔒 ============================================`);
              console.error(`   Username: ${terminal.username || 'admin'}`);
              console.error(`   IP: ${terminal.ip_address}`);
              console.error(`   Qulf vaqti: ${unlockMinutes} daqiqa (${fallbackError.unlockTimeSeconds} soniya)`);
              console.error(`\n   ✅ YECHIM:`);
              console.error(`   1. Terminalni fizik jihatdan qayta ishga tushiring, YOKI`);
              console.error(`   2. ${unlockMinutes} daqiqa kutib turing, YOKI`);
              console.error(`   3. Terminal Web interfeysida account qulfini oching`);
              console.error(`🔒 ============================================\n`);
            }
            
            // Network muammosini tekshirish
            if (fallbackError.errorCode === 'ECONNREFUSED' || fallbackError.errorCode === 'ENOTFOUND' || 
                fallbackError.errorCode === 'ETIMEDOUT' || fallbackError.errorCode === 'EHOSTUNREACH') {
              console.error(`\n⚠️  ============================================`);
              console.error(`⚠️  Terminal ${terminal.name} bilan aloqa yo'q!`);
              console.error(`⚠️  ============================================`);
              console.error(`   IP: ${terminal.ip_address}`);
              console.error(`   Xatolik: ${fallbackError.message}`);
              console.error(`\n   💡 YECHIM (TAVSIYA ETILADI):`);
              console.error(`   Terminal HTTP Webhook orqali ma'lumot yuborish sozlash:`);
              console.error(`   - Terminal Web interfeysida: "Система и обслуживание" → "Сеть" →`);
              console.error(`     "Сетевая служба" → "HTTP(S)" → "Мониторинг HTTP"`);
              console.error(`   - IP: restocontrol.uz`);
              console.error(`   - URL: /api/hikvision/event`);
              console.error(`   - Port: 443 (yoki 8000 - server portiga qarab)`);
              console.error(`   - Protocol: HTTPS (yoki HTTP - server sozlamasiga qarab)`);
              console.error(`\n   Terminal o'zi ma'lumot yuboradi va server ulanmasdan oladi!`);
              console.error(`⚠️  ============================================\n`);
            }
            // Network muammosini tekshirish
        if (error.errorCode === 'ECONNREFUSED' || error.errorCode === 'ENOTFOUND' || 
            error.errorCode === 'ETIMEDOUT' || error.errorCode === 'EHOSTUNREACH') {
          console.error(`\n⚠️  ============================================`);
          console.error(`⚠️  Terminal ${terminal.name} bilan aloqa yo'q!`);
          console.error(`⚠️  ============================================`);
          console.error(`   IP: ${terminal.ip_address}`);
          console.error(`   Xatolik: ${error.message}`);
          console.error(`\n   💡 YECHIM (TAVSIYA ETILADI):`);
          console.error(`   Terminal HTTP Webhook orqali ma'lumot yuborish sozlash:`);
          console.error(`   - Terminal Web interfeysida: "Система и обслуживание" → "Сеть" →`);
          console.error(`     "Сетевая служба" → "HTTP(S)" → "Мониторинг HTTP"`);
          console.error(`   - IP: restocontrol.uz`);
          console.error(`   - URL: /api/attendance/webhook`);
          console.error(`   - Port: 8000`);
          console.error(`   - Protocol: HTTP`);
          console.error(`\n   Terminal o'zi ma'lumot yuboradi va server ulanmasdan oladi!`);
          console.error(`⚠️  ============================================\n`);
        }
        
        console.log(`⚠️  Terminal ${terminal.name} incremental sync xatolik: ${error.message}`);
            continue; 
          }
        }
        
        if (newEvents.length > 0) {
          console.log(`📊 Terminal ${terminal.name}: ${newEvents.length} ta yangi event topildi (serialNo > ${lastSerial})`);
          
          let savedCount = 0;
          let duplicateCount = 0;
          let entryCount = 0;
          let exitCount = 0;
          let unknownCount = 0;
          
          for (const rawEvent of newEvents) {
            const parsedEvent = service.parseEvent(rawEvent);
            
            if (!parsedEvent) {
              continue; 
            }

            // Count event types
            if (parsedEvent.eventType === 'entry') {
              entryCount++;
            } else if (parsedEvent.eventType === 'exit') {
              exitCount++;
            } else {
              unknownCount++;
            }

            try {
              const result = await this.storeEvent(terminal.id, parsedEvent);
              
              if (result.saved) {
                savedCount++;
              } else if (result.reason === 'duplicate') {
                duplicateCount++;
              }
            } catch (error) {
              console.error(`❌ Event saqlashda xatolik:`, error.message);
            }
          }
          
          console.log(`✅ Terminal ${terminal.name} incremental sync: ${savedCount} ta saqlandi, ${duplicateCount} ta duplikat`);
          console.log(`   Entry: ${entryCount} ta | Exit: ${exitCount} ta | Unknown: ${unknownCount} ta`);
        }
      } catch (error) {
        
        console.log(`⚠️  Terminal ${terminal.name} incremental sync xatolik: ${error.message}`);
      }
    }
  }

  
  /**
   * Terminaldan oxirgi saqlangan event vaqtidan keyingi barcha eventlarni yuklab olish
   * Server ishga tushganda chaqiriladi - terminal ishlayotgan bo'lsa, lekin server ishlamay qolgan bo'lsa
   */
  async syncMissingEventsFromTerminal(terminal) {
    // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
    if (this.isPrivateIP(terminal.ip_address)) {
      console.log(`ℹ️  Terminal ${terminal.name} (${terminal.ip_address}) private IP - missing events sync o'tkazib yuborildi (webhook orqali ishlaydi)`);
      return { success: false, reason: 'private_ip', message: 'Terminal private IP\'da, webhook orqali ishlaydi' };
    }

    try {
      // Terminaldan oxirgi saqlangan event vaqtini topish
      const lastEventResult = await this.db.query(
        `SELECT MAX(event_time) as last_event_time 
         FROM attendance_logs 
         WHERE terminal_name = $1 AND admin_id = (SELECT admin_id FROM terminals WHERE id = $2)`,
        [terminal.name, terminal.id]
      );

      const lastEventTime = lastEventResult.rows[0]?.last_event_time;
      
      // Agar hech qanday event bo'lmasa, oxirgi 7 kundagi eventlarni yuklab olish
      let startTime;
      let endTime = new Date();
      
      if (lastEventTime) {
        // Oxirgi event vaqtidan keyingi eventlarni yuklab olish
        startTime = new Date(lastEventTime);
        // 1 daqiqa oldinroqdan boshlash (vaqt farqi uchun buffer)
        startTime.setMinutes(startTime.getMinutes() - 1);
        console.log(`🔄 Terminal ${terminal.name}: Oxirgi event vaqti: ${lastEventTime}, ${startTime.toISOString()} dan keyingi eventlarni yuklab olinmoqda...`);
      } else {
        // Hech qanday event bo'lmasa, oxirgi 7 kundagi eventlarni yuklab olish
        startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        console.log(`🔄 Terminal ${terminal.name}: Hech qanday event topilmadi, oxirgi 7 kundagi eventlarni yuklab olinmoqda...`);
      }

      const startTimeStr = startTime.toISOString().replace('Z', '').split('.')[0];
      const endTimeStr = endTime.toISOString().replace('Z', '').split('.')[0];

      return await this.syncHistoricalEvents(terminal, startTimeStr, endTimeStr);
    } catch (error) {
      console.error(`❌ Terminal ${terminal.name} missing events sync xatolik:`, error.message);
      throw error;
    }
  }

  /**
   * Barcha terminallardan missing eventlarni yuklab olish
   * Server ishga tushganda chaqiriladi
   */
  async syncAllMissingEvents(terminals) {
    console.log(`🔄 Barcha terminallardan missing eventlarni yuklab olish boshlanmoqda...`);
    
    let totalSaved = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;
    const results = [];

    for (const terminal of terminals) {
      if (!terminal.is_active) {
        continue;
      }

      try {
        const result = await this.syncMissingEventsFromTerminal(terminal);
        
        if (result && result.saved !== undefined) {
          totalSaved += result.saved || 0;
          totalDuplicates += result.duplicates || 0;
          totalErrors += result.errors || 0;
          
          results.push({
            terminal: terminal.name,
            saved: result.saved || 0,
            duplicates: result.duplicates || 0,
            errors: result.errors || 0,
            totalFound: result.totalFound || 0
          });
        }
      } catch (error) {
        console.error(`❌ Terminal ${terminal.name} missing events sync xatolik:`, error.message);
        totalErrors++;
        results.push({
          terminal: terminal.name,
          error: error.message
        });
      }
    }

    console.log(`✅ Missing events sync tugadi:`);
    console.log(`   Jami saqlandi: ${totalSaved} ta`);
    console.log(`   Jami duplikat: ${totalDuplicates} ta`);
    console.log(`   Jami xatolar: ${totalErrors} ta`);

    return {
      totalSaved,
      totalDuplicates,
      totalErrors,
      results
    };
  }

  async initialFullSyncJSON(terminals) {
    console.log(`🔄 Initial full sync boshlanmoqda (JSON format)...`);

    for (const terminal of terminals) {
      if (!terminal.is_active) {
        continue;
      }

      // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
      if (this.isPrivateIP(terminal.ip_address)) {
        console.log(`ℹ️  Terminal ${terminal.name} (${terminal.ip_address}) private IP - o'tkazib yuborildi (webhook orqali ishlaydi)`);
        continue;
      }

      try {
        const service = await this.initTerminal(terminal);
        
        let allEvents;
        try {
          allEvents = await service.getAllEventsJSON(5000, 100);
        } catch (error) {
          // Account qulfini tekshirish
          if (error.statusCode === 401 && error.isAccountLocked) {
            const unlockMinutes = Math.ceil(error.unlockTimeSeconds / 60);
            console.error(`\n🔒 ============================================`);
            console.error(`🔒 Terminal ${terminal.name} accounti QULFLANGAN!`);
            console.error(`🔒 ============================================`);
            console.error(`   Username: ${terminal.username || 'admin'}`);
            console.error(`   IP: ${terminal.ip_address}`);
            console.error(`   Qulf vaqti: ${unlockMinutes} daqiqa (${error.unlockTimeSeconds} soniya)`);
            console.error(`\n   ✅ YECHIM:`);
            console.error(`   1. Terminalni fizik jihatdan qayta ishga tushiring, YOKI`);
            console.error(`   2. ${unlockMinutes} daqiqa kutib turing, YOKI`);
            console.error(`   3. Terminal Web interfeysida account qulfini oching`);
            console.error(`🔒 ============================================\n`);
            continue; // Keyingi terminalga o'tish
          }
          throw error;
        }
        
        console.log(`📊 Terminal ${terminal.name}: ${allEvents.length} ta event topildi`);

        let savedCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;

        for (const rawEvent of allEvents) {
          // Debug: birinchi 5 ta eventni ko'rsatish
          const serialNo = rawEvent.serialNo || rawEvent.acsEventInfo?.serialNo || 'unknown';
          const serialNoNum = parseInt(serialNo) || 0;
          if (serialNoNum <= 5) {
            console.log(`🔍 JSON Event structure - SerialNo: ${serialNo}`);
            console.log(`   rawEvent.minor: ${rawEvent.minor}, rawEvent.Minor: ${rawEvent.Minor}`);
            console.log(`   rawEvent.acsEventInfo:`, rawEvent.acsEventInfo ? 'exists' : 'null');
            if (rawEvent.acsEventInfo) {
              console.log(`   acsEventInfo.minor: ${rawEvent.acsEventInfo.minor}, acsEventInfo.Minor: ${rawEvent.acsEventInfo.Minor}`);
            }
            console.log(`   Full rawEvent (first 5):`, JSON.stringify(rawEvent, null, 2));
          }
          
          const parsedEvent = service.parseEvent(rawEvent);
          
          if (!parsedEvent) {
            continue; 
          }
          
          // Debug: parse qilingan event
          if (serialNoNum <= 5) {
            console.log(`✅ Parsed event - SerialNo: ${parsedEvent.serialNo}, eventType: ${parsedEvent.eventType}`);
          }

          try {
            const result = await this.storeEvent(terminal.id, parsedEvent);
            
            if (result.saved) {
              savedCount++;
            } else if (result.reason === 'duplicate') {
              duplicateCount++;
            } else {
              errorCount++;
            }
          } catch (error) {
            errorCount++;
            console.error(`❌ Event saqlashda xatolik:`, error.message);
          }
        }

        console.log(`✅ Terminal ${terminal.name} sync tugadi (JSON):`);
        console.log(`   Saqlandi: ${savedCount} ta`);
        console.log(`   Duplikat: ${duplicateCount} ta`);
        console.log(`   Xatolar: ${errorCount} ta`);
      } catch (error) {
        console.error(`❌ Terminal ${terminal.name} initial sync xatolik:`, error.message);
      }
    }

    console.log(`✅ Initial full sync tugadi`);
  }

  
  async syncLatestEvents(terminal) {
    // Private IP terminallarni o'tkazib yuborish (webhook orqali ishlaydi)
    if (this.isPrivateIP(terminal.ip_address)) {
      console.log(`ℹ️  Terminal ${terminal.name} (${terminal.ip_address}) private IP - sync o'tkazib yuborildi (webhook orqali ishlaydi)`);
      return { success: false, reason: 'private_ip', message: 'Terminal private IP\'da, webhook orqali ishlaydi' };
    }

    try {
      const service = await this.initTerminal(terminal);
      
      
      const lastSerialResult = await this.db.query(
        `SELECT MAX(CASE WHEN serial_no ~ '^[0-9]+$' THEN CAST(serial_no AS INTEGER) ELSE 0 END) as last_serial 
         FROM attendance_logs WHERE terminal_name = $1`,
        [terminal.name]
      );
      
      const lastSerial = parseInt(lastSerialResult.rows[0]?.last_serial) || 0;
      
      console.log(`🔄 Terminal ${terminal.name} yangi eventlar yuklanmoqda (lastSerial: ${lastSerial})...`);
      
      
      let newEvents = [];
      try {
        newEvents = await service.getLatestEventsJSON(lastSerial, 5000, 100);
      } catch (error) {
        // Account qulfini tekshirish
        if (error.statusCode === 401 && error.isAccountLocked) {
          const unlockMinutes = Math.ceil(error.unlockTimeSeconds / 60);
          console.error(`\n🔒 ============================================`);
          console.error(`🔒 Terminal ${terminal.name} accounti QULFLANGAN!`);
          console.error(`🔒 ============================================`);
          console.error(`   Username: ${terminal.username || 'admin'}`);
          console.error(`   IP: ${terminal.ip_address}`);
          console.error(`   Qulf vaqti: ${unlockMinutes} daqiqa (${error.unlockTimeSeconds} soniya)`);
          console.error(`\n   ✅ YECHIM:`);
          console.error(`   1. Terminalni fizik jihatdan qayta ishga tushiring, YOKI`);
          console.error(`   2. ${unlockMinutes} daqiqa kutib turing, YOKI`);
          console.error(`   3. Terminal Web interfeysida account qulfini oching`);
          console.error(`🔒 ============================================\n`);
          throw error;
        }
        
        console.log(`⚠️  serialNoGreaterThan qo'llab-quvvatlanmaydi, barcha eventlarni yuklab, filtrlash...`);
        try {
          const allEvents = await service.getAllEventsJSON(5000, 100);
          
          newEvents = allEvents.filter(event => {
            const eventSerialNo = parseInt(event.serialNo || event.acsEventInfo?.serialNo || 0);
            return eventSerialNo > lastSerial;
          });
        } catch (fallbackError) {
          // Account qulfini tekshirish (fallback'da ham)
          if (fallbackError.statusCode === 401 && fallbackError.isAccountLocked) {
            const unlockMinutes = Math.ceil(fallbackError.unlockTimeSeconds / 60);
            console.error(`\n🔒 ============================================`);
            console.error(`🔒 Terminal ${terminal.name} accounti QULFLANGAN! (Fallback)`);
            console.error(`🔒 ============================================`);
            console.error(`   Username: ${terminal.username || 'admin'}`);
            console.error(`   IP: ${terminal.ip_address}`);
            console.error(`   Qulf vaqti: ${unlockMinutes} daqiqa (${fallbackError.unlockTimeSeconds} soniya)`);
            console.error(`\n   ✅ YECHIM:`);
            console.error(`   1. Terminalni fizik jihatdan qayta ishga tushiring, YOKI`);
            console.error(`   2. ${unlockMinutes} daqiqa kutib turing, YOKI`);
            console.error(`   3. Terminal Web interfeysida account qulfini oching`);
            console.error(`🔒 ============================================\n`);
          }
          console.error(`❌ Fallback ham ishlamadi:`, fallbackError.message);
          
          // Network muammosini tekshirish
          if (fallbackError.errorCode === 'ECONNREFUSED' || fallbackError.errorCode === 'ENOTFOUND' || 
              fallbackError.errorCode === 'ETIMEDOUT' || fallbackError.errorCode === 'EHOSTUNREACH') {
            console.error(`\n⚠️  ============================================`);
            console.error(`⚠️  Terminal ${terminal.name} bilan aloqa yo'q!`);
            console.error(`⚠️  ============================================`);
            console.error(`   IP: ${terminal.ip_address}`);
            console.error(`   Xatolik: ${fallbackError.message}`);
            console.error(`\n   💡 YECHIM (TAVSIYA ETILADI):`);
            console.error(`   Terminal HTTP Webhook orqali ma'lumot yuborish sozlash:`);
            console.error(`   - Terminal Web interfeysida: "Система и обслуживание" → "Сеть" →`);
            console.error(`     "Сетевая служба" → "HTTP(S)" → "Мониторинг HTTP"`);
            console.error(`   - IP: restocontrol.uz`);
            console.error(`   - URL: /api/attendance/webhook`);
            console.error(`   - Port: 8000`);
            console.error(`   - Protocol: HTTP`);
            console.error(`\n   Terminal o'zi ma'lumot yuboradi va server ulanmasdan oladi!`);
            console.error(`⚠️  ============================================\n`);
          }
          
          throw fallbackError; 
        }
      }
      
      console.log(`📊 Terminal ${terminal.name}: ${newEvents.length} ta yangi event topildi (serialNo > ${lastSerial})`);
      
      let savedCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      let entryCount = 0;
      let exitCount = 0;
      let unknownCount = 0;
      
      for (const rawEvent of newEvents) {
        // Debug: birinchi 5 ta eventni yoki barcha exit eventlarni ko'rsatish
        const serialNo = rawEvent.serialNo || rawEvent.acsEventInfo?.serialNo || 'unknown';
        const serialNoNum = parseInt(serialNo) || 0;
        const isExitEvent = rawEvent.minor === 76 || rawEvent.acsEventInfo?.minor === 76;
        
        if (serialNoNum <= 5 || isExitEvent) {
          console.log(`🔍 JSON Event structure - SerialNo: ${serialNo}`);
          console.log(`   rawEvent.minor: ${rawEvent.minor}, rawEvent.Minor: ${rawEvent.Minor}`);
          console.log(`   rawEvent.acsEventInfo:`, rawEvent.acsEventInfo ? 'exists' : 'null');
          if (rawEvent.acsEventInfo) {
            console.log(`   acsEventInfo.minor: ${rawEvent.acsEventInfo.minor}, acsEventInfo.Minor: ${rawEvent.acsEventInfo.Minor}`);
            console.log(`   acsEventInfo keys: ${Object.keys(rawEvent.acsEventInfo).join(', ')}`);
            // Check for pictureURL in acsEventInfo
            if (rawEvent.acsEventInfo.pictureURL || rawEvent.acsEventInfo.pictureUrl) {
              console.log(`   📷 PictureURL found in acsEventInfo: ${rawEvent.acsEventInfo.pictureURL || rawEvent.acsEventInfo.pictureUrl}`);
            }
          }
          // Check for pictureURL in rawEvent
          if (rawEvent.pictureURL || rawEvent.pictureUrl) {
            console.log(`   📷 PictureURL found in rawEvent: ${rawEvent.pictureURL || rawEvent.pictureUrl}`);
          }
          if (isExitEvent) {
            console.log(`   ⚠️  EXIT EVENT DETECTED! Full rawEvent:`, JSON.stringify(rawEvent, null, 2));
          }
        }
        
        const parsedEvent = service.parseEvent(rawEvent);
        
        if (!parsedEvent) {
          continue; 
        }

        // Debug: parse qilingan event
        if (serialNoNum <= 5 || parsedEvent.eventType === 'exit') {
          const eventTypeEmoji = parsedEvent.eventType === 'entry' ? '✅' : parsedEvent.eventType === 'exit' ? '🚪' : '❓';
          console.log(`${eventTypeEmoji} Parsed event - SerialNo: ${parsedEvent.serialNo}, eventType: ${parsedEvent.eventType}`);
          
          if (isExitEvent && parsedEvent.eventType !== 'exit') {
            console.error(`   ❌ XATOLIK: Exit event (minor=76) lekin parsed eventType=${parsedEvent.eventType}!`);
          }
        }
        
        // Count event types
        if (parsedEvent.eventType === 'entry') {
          entryCount++;
        } else if (parsedEvent.eventType === 'exit') {
          exitCount++;
        } else {
          unknownCount++;
        }

        try {
          const result = await this.storeEvent(terminal.id, parsedEvent);
          
          if (result.saved) {
            savedCount++;
          } else if (result.reason === 'duplicate') {
            duplicateCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Event saqlashda xatolik:`, error.message);
        }
      }
      
      console.log(`✅ Terminal ${terminal.name} sync tugadi:`);
      console.log(`   Saqlandi: ${savedCount} ta`);
      console.log(`   Duplikat: ${duplicateCount} ta`);
      console.log(`   Xatolar: ${errorCount} ta`);
      console.log(`   Entry: ${entryCount} ta | Exit: ${exitCount} ta | Unknown: ${unknownCount} ta`);
      
      return {
        totalFound: newEvents.length,
        saved: savedCount,
        duplicates: duplicateCount,
        errors: errorCount,
        entryCount: entryCount,
        exitCount: exitCount
      };
    } catch (error) {
      console.error(`❌ Terminal ${terminal.name} latest events sync xatolik:`, error.message);
      throw error;
    }
  }

  
  getTerminalService(terminalId) {
    return this.terminalServices.get(terminalId);
  }
}

module.exports = AttendanceSyncService;


