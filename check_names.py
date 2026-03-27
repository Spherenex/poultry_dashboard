from ultralytics import YOLO

m = YOLO("models/chicken.pt")
print("TASK:", m.task)
print("NAMES:", m.names)
