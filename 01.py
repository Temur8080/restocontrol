import requests
from requests.auth import HTTPDigestAuth
from datetime import datetime

# ===== TERMINAL MA'LUMOTLARI =====
DEVICE_IP = "192.168.1.12"
PORT = 80
USERNAME = "admin"
PASSWORD = "A112233a"

# ===== ISAPI ENDPOINT =====
url = f"http://{DEVICE_IP}:{PORT}/ISAPI/AccessControl/AcsEvent?format=json"

# ===== QIDIRUV SHARTI =====
payload = {
    "AcsEventCond": {
        "searchID": "1",
        "searchResultPosition": 0,
        "maxResults": 50,
        "major": 5,
        "minor": 75,
        "startTime": "2026-01-01T00:00:00",
        "endTime": "2026-12-31T23:59:59"
    }
}

response = requests.post(
    url,
    json=payload,
    auth=HTTPDigestAuth(USERNAME, PASSWORD),
    timeout=15
)

if response.status_code == 200:
    data = response.json()
    events = data.get("AcsEvent", {}).get("InfoList", [])

    print("\n📋 Kirish–chiqish loglari:\n")

    for e in events:
        emp_id = e.get("employeeNoString")
        name = e.get("name", "Noma'lum")
        time = e.get("time")
        door = e.get("doorName", "Asosiy eshik")
        event = e.get("eventType")

        print(f"👤 Hodim ID: {emp_id}")
        print(f"📛 Ism: {name}")
        print(f"🕒 Vaqt: {time}")
        print(f"🚪 Eshik: {door}")
        print(f"📌 Hodisa: {event}")
        print("-" * 40)
else:
    print("❌ Xatolik:", response.status_code)
    print(response.text)
