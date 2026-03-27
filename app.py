# app.py
import os
import time
from datetime import datetime, timedelta

import cv2
from flask import Flask, render_template, Response, jsonify, send_from_directory, request
from ultralytics import YOLO

from config import FIREBASE_WEB_CONFIG, RTDB_PATH, THRESHOLDS
import firebase_admin
from firebase_admin import credentials, db
import json
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import atexit

app = Flask(__name__)

# Initialize Firebase Admin SDK (optional)
try:
    # Initialize with default application credentials if available
    firebase_admin.initialize_app(options={
        'databaseURL': 'https://waterdtection-default-rtdb.firebaseio.com'
    })
    firebase_ref = db.reference(RTDB_PATH)
    print("Firebase Admin SDK initialized successfully")
except Exception as e:
    print(f"Firebase Admin SDK initialization failed (using fallback): {e}")
    firebase_ref = None

# Manual Controls State
manual_controls = {
    "feeder": False,
    "water": False, 
    "lights": True,
    "ventilation": False,
    "heater": False,
    "last_feeding": None
}

# Feeding Schedule State
feeding_schedule = {
    "enabled": True,
    "schedules": [
        {"time": "07:00", "duration": 30, "enabled": True},
        {"time": "12:00", "duration": 30, "enabled": True},
        {"time": "18:00", "duration": 30, "enabled": True}
    ]
}

# Initialize scheduler
scheduler = BackgroundScheduler()
scheduler.start()
atexit.register(lambda: scheduler.shutdown())

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "chicken.pt")
SNAP_DIR = os.path.join(BASE_DIR, "snapshots")
os.makedirs(SNAP_DIR, exist_ok=True)

# -----------------------------
# YOLO
# -----------------------------
model = YOLO(MODEL_PATH)

# Your model names: {0:'clusterchicken', 1:'deadchicken', 2:'stansingchicken', 3:'walkingchicken'}
RAW_NAMES = model.names  # dict {id: name}

# Normalize any raw label to canonical dashboard label
def norm_label(raw: str) -> str:
    s = (raw or "").lower().strip()
    if "dead" in s:
        return "DEAD"
    if "walk" in s:
        return "WALKING"
    if "cluster" in s:
        return "CLUSTERING"
    if "stan" in s:  # handles "stansingchicken" typo
        return "STANDING"
    return s.upper() if s else "N/A"

# Colors for canonical labels (BGR)
CLASS_COLORS = {
    "STANDING":   (255, 255, 0),    # cyan
    "WALKING":    (0, 255, 0),      # green
    "CLUSTERING": (255, 0, 255),    # magenta
    "DEAD":       (0, 0, 255),      # red
}

# Tune these for your model
MIN_CONF = {
    "STANDING": 0.35,
    "WALKING": 0.35,
    "CLUSTERING": 0.35,
    "DEAD": 0.50
}

PRIORITY = {"DEAD": 4, "WALKING": 3, "CLUSTERING": 2, "STANDING": 1, "N/A": 0}

# -----------------------------
# Camera
# -----------------------------
CAM_INDEX = 0
cap = cv2.VideoCapture(CAM_INDEX)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

latest_ai = {
    "label": "N/A",
    "confidence": 0.0,
    "counts": {"STANDING": 0, "WALKING": 0, "CLUSTERING": 0, "DEAD": 0},
    "last_snapshot": None
}

last_snapshot_time = 0
SNAPSHOT_COOLDOWN_SEC = 5

def draw_box(img, x1, y1, x2, y2, label, conf):
    color = CLASS_COLORS.get(label, (255, 255, 255))
    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

    txt = f"{label} {conf:.2f}"
    (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
    y0 = max(0, y1 - th - 10)
    cv2.rectangle(img, (x1, y0), (x1 + tw + 10, y1), color, -1)
    cv2.putText(img, txt, (x1 + 5, y1 - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 0), 2)

def detect_and_annotate(frame):
    global latest_ai, last_snapshot_time

    # Better inference settings
    r = model.predict(
        frame,
        verbose=False,
        conf=0.65,     # base conf; per-class min_conf below
        iou=0.45,
        imgsz=640
    )[0]

    boxes = r.boxes
    counts = {"STANDING": 0, "WALKING": 0, "CLUSTERING": 0, "DEAD": 0}

    top_label = "N/A"
    top_conf = 0.0

    if boxes is not None and len(boxes) > 0:
        for b in boxes:
            cls_id = int(b.cls[0])
            conf = float(b.conf[0])

            raw = RAW_NAMES.get(cls_id, f"cls_{cls_id}")
            label = norm_label(raw)

            if conf < MIN_CONF.get(label, 0.35):
                continue

            counts[label] = counts.get(label, 0) + 1

            x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
            draw_box(frame, x1, y1, x2, y2, label, conf)

            if (PRIORITY.get(label, 0) > PRIORITY.get(top_label, 0)) or (label == top_label and conf > top_conf):
                top_label = label
                top_conf = conf

        # Auto snapshot if anything detected
        if sum(counts.values()) > 0:
            now = time.time()
            if (now - last_snapshot_time) >= SNAPSHOT_COOLDOWN_SEC:
                last_snapshot_time = now
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                fname = f"{ts}_{top_label}.jpg"
                fpath = os.path.join(SNAP_DIR, fname)
                cv2.imwrite(fpath, frame)

                latest_ai["last_snapshot"] = {
                    "file": fname,
                    "label": top_label,
                    "confidence": round(top_conf, 3),
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }

    latest_ai["label"] = top_label
    latest_ai["confidence"] = round(top_conf, 3)
    latest_ai["counts"] = counts

    banner = f"AI: {top_label} ({top_conf:.2f}) | S:{counts['STANDING']} W:{counts['WALKING']} C:{counts['CLUSTERING']} D:{counts['DEAD']}"
    cv2.rectangle(frame, (0, 0), (frame.shape[1], 44), (0, 0, 0), -1)
    cv2.putText(frame, banner, (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    return frame

def gen_video():
    while True:
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.05)
            continue

        annotated = detect_and_annotate(frame)
        ret, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ret:
            continue

        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")

@app.route("/")
def index():
    return render_template(
        "index.html",
        firebase_config=FIREBASE_WEB_CONFIG,
        rtdb_path=RTDB_PATH,
        thresholds=THRESHOLDS
    )

@app.route("/video_feed")
def video_feed():
    return Response(gen_video(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/api/ai_status")
def ai_status():
    return jsonify(latest_ai)

@app.route("/api/snapshots")
def list_snapshots():
    files = [f for f in os.listdir(SNAP_DIR) if f.lower().endswith((".jpg", ".png"))]
    files.sort(reverse=True)
    data = [{"file": f, "url": f"/snapshots/{f}"} for f in files[:60]]
    return jsonify(data)

@app.route("/snapshots/<path:filename>")
def serve_snapshot(filename):
    return send_from_directory(SNAP_DIR, filename)

@app.route("/api/snapshot_now", methods=["POST"])
def snapshot_now():
    ok, frame = cap.read()
    if not ok:
        return jsonify({"ok": False, "error": "Camera read failed"}), 500

    annotated = detect_and_annotate(frame)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"{ts}_MANUAL.jpg"
    cv2.imwrite(os.path.join(SNAP_DIR, fname), annotated)
    return jsonify({"ok": True, "file": fname, "url": f"/snapshots/{fname}"})

# Manual Controls API
@app.route("/api/controls", methods=["GET"])
def get_controls():
    return jsonify(manual_controls)

@app.route("/api/controls", methods=["POST"])
def update_controls():
    global manual_controls
    data = request.get_json()
    
    for key, value in data.items():
        if key in manual_controls:
            manual_controls[key] = value
            
            # Send to Firebase
            if firebase_ref:
                try:
                    firebase_ref.child('controls').child(key).set(value)
                except Exception as e:
                    print(f"Firebase update failed: {e}")
            
            # Handle special actions
            if key == "feeder" and value:
                manual_controls["last_feeding"] = datetime.now().isoformat()
                if firebase_ref:
                    try:
                        firebase_ref.child('controls').child('last_feeding').set(manual_controls["last_feeding"])
                    except:
                        pass
    
    return jsonify({"ok": True, "controls": manual_controls})

# Feeding Schedule API
@app.route("/api/schedule", methods=["GET"])
def get_schedule():
    return jsonify(feeding_schedule)

@app.route("/api/schedule", methods=["POST"])
def update_schedule():
    global feeding_schedule
    data = request.get_json()
    
    if "enabled" in data:
        feeding_schedule["enabled"] = data["enabled"]
    
    if "schedules" in data:
        feeding_schedule["schedules"] = data["schedules"]
    
    # Update scheduler
    update_feeding_scheduler()
    
    return jsonify({"ok": True, "schedule": feeding_schedule})

def update_feeding_scheduler():
    # Clear existing jobs
    for job in scheduler.get_jobs():
        scheduler.remove_job(job.id)
    
    if not feeding_schedule["enabled"]:
        return
    
    # Add new jobs
    for i, schedule in enumerate(feeding_schedule["schedules"]):
        if schedule["enabled"]:
            time_parts = schedule["time"].split(":")
            hour, minute = int(time_parts[0]), int(time_parts[1])
            
            scheduler.add_job(
                func=auto_feed,
                trigger=CronTrigger(hour=hour, minute=minute),
                id=f"feed_{i}",
                args=[schedule["duration"]],
                replace_existing=True
            )

def auto_feed(duration=30):
    """Automatic feeding function triggered by scheduler"""
    global manual_controls
    
    # Activate feeder
    manual_controls["feeder"] = True
    manual_controls["last_feeding"] = datetime.now().isoformat()
    
    # Send to Firebase
    if firebase_ref:
        try:
            firebase_ref.child('controls').update({
                'feeder': True,
                'last_feeding': manual_controls["last_feeding"]
            })
        except Exception as e:
            print(f"Firebase auto-feed update failed: {e}")
    
    # Schedule feeder to turn off after duration
    def stop_feeding():
        manual_controls["feeder"] = False
        if firebase_ref:
            try:
                firebase_ref.child('controls').child('feeder').set(False)
            except:
                pass
    
    scheduler.add_job(
        func=stop_feeding,
        trigger='date',
        run_date=datetime.now() + timedelta(seconds=duration),
        id=f"stop_feed_{datetime.now().timestamp()}"
    )

# Initialize feeding scheduler on startup
update_feeding_scheduler()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
