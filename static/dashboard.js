// static/dashboard.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const firebaseConfig = window.__FIREBASE_CONFIG__;
const RTDB_PATH = window.__RTDB_PATH__;
const TH = window.__THRESHOLDS__;

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// UI
const connBadge = document.getElementById("connBadge");
const lastUpdate = document.getElementById("lastUpdate");

const kTemp = document.getElementById("kTemp");
const kHum = document.getElementById("kHum");
const kGas = document.getElementById("kGas");
const kWater = document.getElementById("kWater");

const tRange = document.getElementById("tRange");
const hRange = document.getElementById("hRange");
const gRange = document.getElementById("gRange");
const wRange = document.getElementById("wRange");

const aiLabel = document.getElementById("aiLabel");
const aiConf = document.getElementById("aiConf");
const aiCounts = document.getElementById("aiCounts");

const aiLabelSide = document.getElementById("aiLabelSide");
const aiConfSide = document.getElementById("aiConfSide");
const aiCountsSide = document.getElementById("aiCountsSide");

const alertsList = document.getElementById("alertsList");
const snapGrid = document.getElementById("snapGrid");

const btnSnapshot = document.getElementById("btnSnapshot");
const toggleIndividuals = document.getElementById("toggleIndividuals");
const individualCharts = document.getElementById("individualCharts");

const toast = document.getElementById("toast");

// Threshold text
tRange.textContent = `${TH.TEMP_LOW} – ${TH.TEMP_HIGH}`;
hRange.textContent = `${TH.HUM_LOW} – ${TH.HUM_HIGH}`;
gRange.textContent = `>= ${TH.GAS_HIGH}`;
wRange.textContent = `<= ${TH.WATER_LOW}`;

// Toast + Alerts
const alertHistory = [];
function showToast(msg, level = "warn") {
  toast.classList.remove("hidden");
  toast.textContent = msg;
  toast.dataset.level = level;
  setTimeout(() => toast.classList.add("hidden"), 3000);
}
function addAlert(title, message, level) {
  alertHistory.unshift({ t: new Date().toLocaleString(), title, message, level });
  if (alertHistory.length > 40) alertHistory.pop();
  renderAlerts();
  showToast(`${title}: ${message}`, level);
}
function renderAlerts() {
  alertsList.innerHTML = "";
  for (const a of alertHistory.slice(0, 14)) {
    const div = document.createElement("div");
    div.className = `alert ${a.level}`;
    div.innerHTML = `<div class="t">${a.title}</div>
                     <div class="m">${a.message}</div>
                     <div class="m">${a.t}</div>`;
    alertsList.appendChild(div);
  }
}

// Charts
const MAX_POINTS = 80;
const labels = [];
const buf = { temp: [], hum: [], gas: [], water: [] };

function nowLabel() { return new Date().toLocaleTimeString(); }
function pushLabel() { labels.push(nowLabel()); if (labels.length > MAX_POINTS) labels.shift(); }
function pushPoint(arr, v) { arr.push(v); if (arr.length > MAX_POINTS) arr.shift(); }

function makeLineChart(canvasId, datasets, dualAxis = false) {
  const el = document.getElementById(canvasId);
  if (!el) return null;

  return new Chart(el, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: "#eaf0ff" } } },
      scales: {
        x: { ticks: { color: "#96a3c7" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#96a3c7" }, grid: { color: "rgba(255,255,255,0.06)" } },
        ...(dualAxis ? {
          y1: { position: "right", ticks: { color: "#96a3c7" }, grid: { drawOnChartArea: false } }
        } : {})
      }
    }
  });
}

const combinedChart = makeLineChart("combinedChart", [
  { label: "Temp (°C)", data: buf.temp, tension: 0.25, yAxisID: "y" },
  { label: "Humidity (%)", data: buf.hum, tension: 0.25, yAxisID: "y" },
  { label: "Water (%)", data: buf.water, tension: 0.25, yAxisID: "y" },
  { label: "Gas", data: buf.gas, tension: 0.25, yAxisID: "y1" },
], true);

const tChart = makeLineChart("tChart", [{ label: "Temp (°C)", data: buf.temp, tension: 0.25 }]);
const hChart = makeLineChart("hChart", [{ label: "Humidity (%)", data: buf.hum, tension: 0.25 }]);
const gChart = makeLineChart("gChart", [{ label: "Gas", data: buf.gas, tension: 0.25 }]);
const wChart = makeLineChart("wChart", [{ label: "Water (%)", data: buf.water, tension: 0.25 }]);

function refreshCharts() {
  combinedChart && combinedChart.update("none");
  tChart && tChart.update("none");
  hChart && hChart.update("none");
  gChart && gChart.update("none");
  wChart && wChart.update("none");
}

toggleIndividuals?.addEventListener("change", () => {
  if (toggleIndividuals.checked) individualCharts.classList.remove("hidden");
  else individualCharts.classList.add("hidden");

  setTimeout(() => {
    combinedChart && combinedChart.resize();
    tChart && tChart.resize();
    hChart && hChart.resize();
    gChart && gChart.resize();
    wChart && wChart.resize();
  }, 120);
});

// Firebase read (expects keys: Temp, Hum, Gas, Water under RTDB_PATH)
const rootRef = ref(db, RTDB_PATH);

let lastAlertState = { tempHigh:false,tempLow:false,gasHigh:false,waterLow:false,humHigh:false,humLow:false };

onValue(rootRef, (snap) => {
  connBadge.className = "pill ok";
  connBadge.innerHTML = `<i class="fa-solid fa-wifi"></i> Connected`;

  const data = snap.val() || {};
  const temp = Number(data.Temp ?? 0);
  const hum  = Number(data.Hum ?? 0);
  const gas  = Number(data.Gas ?? 0);
  const water= Number(data.Water ?? 0);

  kTemp.textContent = temp ? temp.toFixed(1) : "--";
  kHum.textContent  = hum ? hum.toFixed(1) : "--";
  kGas.textContent  = Number.isFinite(gas) ? gas.toFixed(0) : "--";
  kWater.textContent= Number.isFinite(water) ? water.toFixed(0) : "--";

  lastUpdate.textContent = "Last update: " + new Date().toLocaleString();

  pushLabel();
  pushPoint(buf.temp, temp);
  pushPoint(buf.hum, hum);
  pushPoint(buf.gas, gas);
  pushPoint(buf.water, water);
  refreshCharts();

  if (temp >= TH.TEMP_HIGH && !lastAlertState.tempHigh) { addAlert("Temperature High", `Temp=${temp}°C`, "bad"); lastAlertState.tempHigh = true; }
  if (temp < TH.TEMP_HIGH) lastAlertState.tempHigh = false;

  if (temp <= TH.TEMP_LOW && !lastAlertState.tempLow) { addAlert("Temperature Low", `Temp=${temp}°C`, "warn"); lastAlertState.tempLow = true; }
  if (temp > TH.TEMP_LOW) lastAlertState.tempLow = false;

  if (gas >= TH.GAS_HIGH && !lastAlertState.gasHigh) { addAlert("Gas High", `Gas=${gas}`, "bad"); lastAlertState.gasHigh = true; }
  if (gas < TH.GAS_HIGH) lastAlertState.gasHigh = false;

  if (water <= TH.WATER_LOW && !lastAlertState.waterLow) { addAlert("Water Low", `Water=${water}%`, "warn"); lastAlertState.waterLow = true; }
  if (water > TH.WATER_LOW) lastAlertState.waterLow = false;

  if (hum >= TH.HUM_HIGH && !lastAlertState.humHigh) { addAlert("Humidity High", `Hum=${hum}%`, "warn"); lastAlertState.humHigh = true; }
  if (hum < TH.HUM_HIGH) lastAlertState.humHigh = false;

  if (hum <= TH.HUM_LOW && !lastAlertState.humLow) { addAlert("Humidity Low", `Hum=${hum}%`, "warn"); lastAlertState.humLow = true; }
  if (hum > TH.HUM_LOW) lastAlertState.humLow = false;

}, (err) => {
  connBadge.className = "pill bad";
  connBadge.innerHTML = `<i class="fa-solid fa-wifi"></i> Disconnected`;
  addAlert("Firebase Error", String(err?.message || err), "bad");
});

// AI poll
let lastDeadAlert = false;
async function pollAI() {
  try {
    const r = await fetch("/api/ai_status");
    const a = await r.json();

    const label = a.label ?? "--";
    const conf = (a.confidence ?? 0);

    aiLabel.textContent = label;
    aiConf.textContent = conf.toFixed(3);

    aiLabelSide.textContent = label;
    aiConfSide.textContent = conf.toFixed(3);

    const c = a.counts || {};
    const deadCount = c.DEAD || 0;
    const countsText = `S:${c.STANDING || 0} W:${c.WALKING || 0} C:${c.CLUSTERING || 0} D:${deadCount}`;
    aiCounts.textContent = countsText;
    aiCountsSide.textContent = countsText;

    if (deadCount > 0 && !lastDeadAlert) {
      addAlert("Dead Chicken Detected", `DEAD count=${deadCount}`, "bad");
      lastDeadAlert = true;
    }
    if (deadCount === 0) lastDeadAlert = false;
  } catch (e) {}
  setTimeout(pollAI, 1000);
}
pollAI();

// snapshots
async function loadSnaps() {
  try {
    const r = await fetch("/api/snapshots");
    const list = await r.json();
    snapGrid.innerHTML = "";
    for (const s of list.slice(0, 24)) {
      const div = document.createElement("div");
      div.className = "snap";
      div.innerHTML = `<a href="${s.url}" target="_blank"><img src="${s.url}"></a>`;
      snapGrid.appendChild(div);
    }
  } catch (e) {}
  setTimeout(loadSnaps, 2500);
}
loadSnaps();

btnSnapshot?.addEventListener("click", async () => {
  const r = await fetch("/api/snapshot_now", { method: "POST" });
  const j = await r.json();
  if (j.ok) addAlert("Snapshot Saved", j.file, "ok");
  else addAlert("Snapshot Failed", j.error || "unknown", "bad");
});

// Manual Controls & Feeding Schedule
document.addEventListener('DOMContentLoaded', function() {
  initializeControls();
  initializeFeedingSchedule();
});

function initializeControls() {
  // Load current controls state
  fetch('/api/controls')
    .then(response => response.json())
    .then(data => {
      updateControlsUI(data);
    })
    .catch(error => {
      console.error('Error loading controls:', error);
    });

  // Setup control toggle listeners
  const controls = ['feeder', 'water', 'lights', 'ventilation', 'heater'];
  
  controls.forEach(control => {
    const toggle = document.getElementById(`${control}Toggle`);
    if (toggle) {
      toggle.addEventListener('change', function() {
        updateControl(control, this.checked);
      });
    }
  });
}

function updateControl(control, value) {
  const data = {};
  data[control] = value;
  
  fetch('/api/controls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(data => {
    if (data.ok) {
      updateControlsUI(data.controls);
      showToast(`${control.charAt(0).toUpperCase() + control.slice(1)} ${value ? 'activated' : 'deactivated'}`, 'success');
    } else {
      showToast(`Failed to update ${control}`, 'error');
    }
  })
  .catch(error => {
    console.error('Error updating control:', error);
    showToast(`Error updating ${control}`, 'error');
  });
}

function updateControlsUI(controls) {
  Object.keys(controls).forEach(key => {
    if (key !== 'last_feeding') {
      const toggle = document.getElementById(`${key}Toggle`);
      const status = document.getElementById(`${key}Status`);
      
      if (toggle) {
        toggle.checked = controls[key];
      }
      
      if (status) {
        status.textContent = controls[key] ? 'ON' : 'OFF';
        status.className = `control-status ${controls[key] ? 'active' : ''}`;
      }
    }
  });
  
  // Update last feeding time
  const lastFeedTime = document.getElementById('lastFeedTime');
  if (lastFeedTime && controls.last_feeding) {
    const feedTime = new Date(controls.last_feeding);
    lastFeedTime.textContent = feedTime.toLocaleString();
  }
}

function initializeFeedingSchedule() {
  // Setup schedule listeners
  const scheduleEnabled = document.getElementById('scheduleEnabled');
  if (scheduleEnabled) {
    scheduleEnabled.addEventListener('change', function() {
      updateScheduleEnabled(this.checked);
    });
  }

  const feedNowBtn = document.getElementById('feedNowBtn');
  if (feedNowBtn) {
    feedNowBtn.addEventListener('click', function() {
      feedNow();
    });
  }

  const updateScheduleBtn = document.getElementById('updateScheduleBtn');
  if (updateScheduleBtn) {
    updateScheduleBtn.addEventListener('click', function() {
      updateSchedule();
    });
  }
}

function updateScheduleEnabled(enabled) {
  fetch('/api/schedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled: enabled })
  })
  .then(response => response.json())
  .then(data => {
    if (data.ok) {
      showToast(`Schedule ${enabled ? 'enabled' : 'disabled'}`, 'success');
    }
  })
  .catch(error => {
    console.error('Error updating schedule:', error);
  });
}

function feedNow() {
  updateControl('feeder', true);
  showToast('Feeding started - will auto stop in 30 seconds', 'info');
  
  // Auto turn off after 30 seconds
  setTimeout(() => {
    updateControl('feeder', false);
  }, 30000);
}

function updateSchedule() {
  const schedules = [];
  
  for (let i = 1; i <= 3; i++) {
    const timeEl = document.getElementById(`schedule${i}Time`);
    const durationEl = document.getElementById(`schedule${i}Duration`);
    const enabledEl = document.getElementById(`schedule${i}Enabled`);
    
    if (timeEl && durationEl && enabledEl) {
      schedules.push({
        time: timeEl.value,
        duration: parseInt(durationEl.value),
        enabled: enabledEl.checked
      });
    }
  }
  
  fetch('/api/schedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ schedules: schedules })
  })
  .then(response => response.json())
  .then(data => {
    if (data.ok) {
      showToast('Schedule updated successfully', 'success');
    }
  })
  .catch(error => {
    console.error('Error updating schedule:', error);
    showToast('Failed to update schedule', 'error');
  });
}

// Poll controls state every 30 seconds
setInterval(() => {
  fetch('/api/controls')
    .then(response => response.json())
    .then(data => {
      updateControlsUI(data);
    })
    .catch(error => {
      console.error('Error polling controls:', error);
    });
}, 30000);
