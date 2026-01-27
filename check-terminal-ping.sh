#!/bin/bash
# Terminal ping va status tekshirish script

echo "============================================"
echo "Terminal Ping va Status Tekshirish"
echo "============================================"
echo ""

cd /var/www/restocontrol

echo "1. Node.js script orqali tekshirish..."
node check-terminal-status.js

echo ""
echo "2. Database'dan terminal ma'lumotlari..."
psql -U postgres -d hodim_nazorati -c "
SELECT 
    id, 
    name, 
    ip_address, 
    is_active,
    created_at
FROM terminals
ORDER BY id;
"

echo ""
echo "3. Oxirgi event'lar (har bir terminal uchun)..."
psql -U postgres -d hodim_nazorati -c "
SELECT 
    t.name as terminal_name,
    COUNT(al.id) as event_count,
    MAX(al.event_time) as last_event_time,
    EXTRACT(EPOCH FROM (NOW() - MAX(al.event_time)))/60 as minutes_ago
FROM terminals t
LEFT JOIN attendance_logs al ON t.id = al.terminal_id
WHERE t.is_active = true
GROUP BY t.id, t.name
ORDER BY t.id;
"

echo ""
echo "4. Network ping test (faol terminallar)..."
psql -U postgres -d hodim_nazorati -t -c "
SELECT ip_address 
FROM terminals 
WHERE is_active = true
ORDER BY id;
" | while read ip; do
    if [ ! -z "$ip" ]; then
        echo "   Ping $ip..."
        ping -c 2 -W 2 $ip > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "   ✅ $ip - ulanish mavjud"
        else
            echo "   ❌ $ip - ulanish yo'q"
        fi
    fi
done

echo ""
echo "============================================"
echo "✅ Tekshirish yakunlandi"
echo "============================================"
