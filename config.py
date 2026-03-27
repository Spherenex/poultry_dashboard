# config.py

FIREBASE_WEB_CONFIG = {
    "apiKey": "AIzaSyB9ererNsNonAzH0zQo_GS79XP0yCoMxr4",
    "authDomain": "waterdtection.firebaseapp.com",
    "databaseURL": "https://waterdtection-default-rtdb.firebaseio.com",
    "projectId": "waterdtection",
    "storageBucket": "waterdtection.firebasestorage.app",
    "messagingSenderId": "690886375729",
    "appId": "1:690886375729:web:172c3a47dda658e4e1810",
    "measurementId": "G-TXF33Y6XY0"
}

# Root node in RTDB
RTDB_PATH = "Poultry_Monitoring"

# Thresholds
THRESHOLDS = {
    "TEMP_HIGH": 33.0,
    "TEMP_LOW": 20.0,
    "HUM_HIGH": 85.0,
    "HUM_LOW": 30.0,
    "GAS_HIGH": 400,
    "WATER_LOW": 30
}
