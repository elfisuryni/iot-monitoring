/* ════════════════════════════════════════════
   IoT Dashboard — SMK SIJA UKK 2025/2026
   Pembuat : Elfi Suryani Kusuma Dewi
   Broker  : HiveMQ Cloud (WSS port 8884)
   Topics  : smk/iot/sensor (RX) | smk/iot/control (TX)
   ════════════════════════════════════════════ */

/* ── CLOCK & DATE ── */
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('id-ID', { hour12: false });
  document.getElementById('date-display').textContent =
    now.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

/* ── TOAST ── */
let toastTimer;
function showToast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ════════════════════════════════════════════
   MQTT CONFIG
   PENTING:
   - Broker : HiveMQ Cloud cluster
   - Port   : 8884  (WebSocket Secure / WSS)
   - Path   : /mqtt
   - SSL    : true
   - User   : ElfiUKK
   ════════════════════════════════════════════ */
const BROKER        = '21ef246c7d5b4eb98f3223161246e024.s1.eu.hivemq.cloud';
const PORT          = 8884;
const WS_PATH       = '/mqtt';
const MQTT_USER     = 'ElfiUKK';
const MQTT_PASS     = 'Elfistecu13';
const TOPIC_SENSOR  = 'smk/iot/sensor';
const TOPIC_CONTROL = 'smk/iot/control';
const MAX_LOG       = 30;

let client = null;
let logRows = [], rowNum = 0;
let ldrRows = [], ldrRowNum = 0;
const relayState = [false, false, false, false];

/* ════════════════════════════════════════════
   MQTT CONNECT
   ════════════════════════════════════════════ */
function mqttConnect() {
  if (typeof Paho === 'undefined') {
    showToast('❌ Library Paho MQTT belum termuat, reload halaman');
    return;
  }

  document.getElementById('btn-connect').disabled = true;
  showToast('⏳ Menghubungkan ke HiveMQ Cloud…');

  const clientId = 'iot_web_' + Math.random().toString(36).substring(2, 9);

  /* Paho.MQTT.Client(host, port, path, clientId) */
  client = new Paho.MQTT.Client(BROKER, PORT, WS_PATH, clientId);

  client.onConnectionLost = (res) => {
    setConnected(false);
    setRelayButtonsDisabled(true);
    showToast('⚠️ Koneksi terputus: ' + (res.errorMessage || 'unknown'), 4000);
  };

  client.onMessageArrived = (msg) =>
    handleMessage(msg.destinationName, msg.payloadString);

  client.connect({
    useSSL:   true,          // wajib untuk port 8884
    timeout:  15,
    userName: MQTT_USER,
    password: MQTT_PASS,
    keepAliveInterval: 30,
    cleanSession: true,
    onSuccess: () => {
      setConnected(true);
      client.subscribe(TOPIC_SENSOR, { qos: 1 });
      setRelayButtonsDisabled(false);
      showToast('✅ Terhubung ke HiveMQ Cloud!');
      /* Aktifkan tombol export */
      ['btn-export-all', 'btn-export-sensor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      });
    },
    onFailure: (err) => {
      setConnected(false);
      document.getElementById('btn-connect').disabled = false;
      showToast('❌ Gagal terhubung: ' + (err.errorMessage || 'timeout'), 5000);
      console.error('[MQTT] Connect failure:', err);
    }
  });
}

/* ════════════════════════════════════════════
   MQTT DISCONNECT
   ════════════════════════════════════════════ */
function mqttDisconnect() {
  if (client && client.isConnected()) client.disconnect();
  setConnected(false);
  setRelayButtonsDisabled(true);
  showToast('🔌 Koneksi diputus');
}

/* ════════════════════════════════════════════
   HANDLE PESAN DARI ESP32
   Format JSON dari publishData():
   { "temp":28.5, "humi":65.0, "ldr":1,
     "mode":"MANUAL", "r":[1,0,0,0] }
   ════════════════════════════════════════════ */
function handleMessage(topic, payload) {
  if (topic !== TOPIC_SENSOR) return;

  let data;
  try { data = JSON.parse(payload); }
  catch (e) { showToast('⚠️ Format JSON tidak valid'); return; }

  const suhu = parseFloat(data.temp ?? NaN);
  const hum  = parseFloat(data.humi ?? NaN);
  const ldr  = (data.ldr !== undefined) ? parseInt(data.ldr) : -1;
  const rArr = Array.isArray(data.r) ? data.r : null;
  const mode = data.mode;   // "AUTO" | "MANUAL" dari ESP32

  /* Sync mode dari ESP32 (jika ada) */
  if (mode === 'AUTO' && notifMode !== 'auto') {
    notifMode = 'auto';
    applyNotifMode(false); /* false = jangan showToast */
  } else if (mode === 'MANUAL' && notifMode !== 'manual') {
    notifMode = 'manual';
    applyNotifMode(false);
  }

  /* Update sensor cards */
  if (!isNaN(suhu) || !isNaN(hum)) {
    updateCards(suhu, hum);
    updateLED(suhu);
  }

  /* Update LDR card */
  if (ldr !== -1) updateLDR(ldr);

  /* Log gabungan */
  addLogRow(suhu, hum, ldr !== -1 ? ldr : undefined);

  /* Push ke grafik realtime */
  pushChartData(suhu, hum, ldr !== -1 ? ldr : null);

  /* Update LIVE badge & last-update timestamp */
  bumpLive();

  /* Sync relay UI dari feedback ESP32 */
  if (rArr) {
    rArr.forEach((val, i) => {
      if (i < 4) {
        relayState[i] = (val === 1 || val === true);
        updateRelayUI(i + 1);
      }
    });
  }

  /* Tampilkan info relay auto di indikator jika mode AUTO */
  if (notifMode === 'auto' && ldr !== -1) {
    const r4info = ldr === 0 ? ' · Relay 4 ON (Gelap)' : ' · Relay 4 OFF (Terang)';
    const desc = document.getElementById('ind-desc');
    if (desc && desc.textContent && !desc.textContent.includes('belum')) {
      if (!desc.textContent.includes('Relay 4')) desc.textContent += r4info;
      else desc.textContent = desc.textContent.replace(/ · Relay 4.*$/, r4info);
    }
  }
}

/* ════════════════════════════════════════════
   KIRIM PERINTAH RELAY
   ════════════════════════════════════════════ */
function sendCmd(cmd) {
  if (!client || !client.isConnected()) {
    showToast('❌ Tidak terhubung ke broker'); return false;
  }
  const msg = new Paho.MQTT.Message(cmd);
  msg.destinationName = TOPIC_CONTROL;
  msg.qos = 1;
  client.send(msg);
  return true;
}

function toggleRelay(num) {
  const idx      = num - 1;
  const newState = !relayState[idx];
  if (!sendCmd(`R${num}_${newState ? 'ON' : 'OFF'}`)) return;
  relayState[idx] = newState;
  updateRelayUI(num);
  showToast(`Relay ${num} → ${newState ? 'ON ✅' : 'OFF ⬛'}`);
}
function allRelayOn()  { if (!sendCmd('ALL_ON'))  return; for(let i=0;i<4;i++){relayState[i]=true;  updateRelayUI(i+1);} showToast('Semua Relay → ON ✅'); }
function allRelayOff() { if (!sendCmd('ALL_OFF')) return; for(let i=0;i<4;i++){relayState[i]=false; updateRelayUI(i+1);} showToast('Semua Relay → OFF ⬛'); }
function resetRelay()  { if (!sendCmd('RESET'))   return; for(let i=0;i<4;i++){relayState[i]=false; updateRelayUI(i+1);} showToast('↺ RESET — Semua Relay OFF'); }

function updateRelayUI(num) {
  const btn = document.getElementById('relay-btn-' + num);
  const lbl = document.getElementById('relay-status-' + num);
  if (!btn || !lbl) return;
  const on = relayState[num - 1];
  btn.classList.toggle('on', on);
  lbl.textContent = on ? 'ON' : 'OFF';
}

function setRelayButtonsDisabled(dis) {
  const forceOff = (notifMode === 'auto');
  const disabled = dis || forceOff;
  for (let i = 1; i <= 4; i++) {
    const b = document.getElementById('relay-btn-' + i);
    if (b) {
      b.disabled = disabled;
      b.title = forceOff && !dis ? '🤖 Mode AUTO — relay dikendalikan ESP32' : '';
    }
  }
  ['btn-all-on', 'btn-all-off', 'btn-reset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = disabled;
      el.title = forceOff && !dis ? '🤖 Mode AUTO' : '';
    }
  });
}

/* ════════════════════════════════════════════
   SENSOR CARDS
   ════════════════════════════════════════════ */
function tempClass(t) {
  // FIXED: sesuai autoControlRelay ESP32
  if (t >= 20 && t <= 25.9) return 'green';   // Relay 1 → Normal
  if (t >= 26 && t <= 30.9) return 'yellow';  // Relay 2 → Hangat
  if (t >= 31)               return 'red';    // Relay 3 → Panas
  return '';
}

function updateCards(suhu, hum) {
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
  if (!isNaN(suhu)) {
    document.getElementById('card-temp').className  = 'card temp-' + tempClass(suhu);
    document.getElementById('val-temp').innerHTML   = suhu.toFixed(1) + '<span class="card-unit">°C</span>';
    document.getElementById('bar-temp').style.width = Math.min(100, Math.max(0, ((suhu-15)/30)*100)) + '%';
    document.getElementById('sub-temp').textContent = 'Update: ' + now;
  }
  if (!isNaN(hum)) {
    document.getElementById('val-hum').innerHTML   = hum.toFixed(1) + '<span class="card-unit">%</span>';
    document.getElementById('bar-hum').style.width = Math.min(100, hum) + '%';
    document.getElementById('sub-hum').textContent = 'Update: ' + now;
  }
}

/* ════════════════════════════════════════════
   LED INDICATOR
   ════════════════════════════════════════════ */
function updateLED(suhu) {
  if (isNaN(suhu)) return;
  const led   = document.getElementById('led');
  const title = document.getElementById('ind-title');
  const desc  = document.getElementById('ind-desc');
  led.className = 'indicator-led';
  if      (suhu >= 20 && suhu <= 25.9) { led.classList.add('green');  title.textContent = 'LED MERAH — Normal';      desc.textContent = `Suhu ${suhu.toFixed(1)}°C · Kondisi ideal (20–25.9°C) · Relay 1 ON`; }
  else if (suhu >= 26 && suhu <= 30.9) { led.classList.add('yellow'); title.textContent = 'LED MERAH — Perhatian';  desc.textContent = `Suhu ${suhu.toFixed(1)}°C · Mulai hangat (26–30.9°C) · Relay 2 ON`; }
  else if (suhu >= 31)                 { led.classList.add('red');    title.textContent = 'LED MERAH — Peringatan!'; desc.textContent = `Suhu ${suhu.toFixed(1)}°C · Terlalu panas (≥31°C) · Relay 3 ON`; }
  else                                 {                               title.textContent = 'LED — Di luar rentang';   desc.textContent = `Suhu ${suhu.toFixed(1)}°C`; }
}

/* ════════════════════════════════════════════
   LDR CARD
   ldr: 1=Terang(LGT), 0=Gelap(DRK)
   ════════════════════════════════════════════ */
function ldrInfo(v) {
  return v === 1
    ? { cls: 'terang', label: '☀️ Terang (LGT)', badge: 'Cahaya Terdeteksi' }
    : { cls: 'gelap',  label: '🌑 Gelap (DRK)',  badge: 'Ruangan Gelap' };
}

function updateLDR(val) {
  const now  = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const info = ldrInfo(val);
  const card = document.getElementById('card-ldr');
  if (!card) return;
  card.className  = 'card ldr-' + info.cls;
  document.getElementById('val-ldr').innerHTML =
    info.label + `<span class="card-unit" style="font-size:.78rem;margin-left:8px">raw=${val}</span>`;
  document.getElementById('bar-ldr').style.width = (val === 1 ? 92 : 12) + '%';
  document.getElementById('sub-ldr').textContent = 'Update: ' + now;
  const bdg = document.getElementById('ldr-badge');
  bdg.textContent = info.badge;
  bdg.className   = 'ldr-badge ' + info.cls;

  /* Simpan ke ldrRows untuk export */
  ldrRowNum++;
  ldrRows.unshift({ num: ldrRowNum, time: now, val, cls: info.cls, label: info.label });
  if (ldrRows.length > MAX_LOG) ldrRows.pop();
}

/* ════════════════════════════════════════════
   LOG GABUNGAN (Sensor + LDR)
   ════════════════════════════════════════════ */
function addLogRow(suhu, hum, ldrVal) {
  rowNum++;
  const now    = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const cls    = isNaN(suhu) ? '' : tempClass(suhu);
  const labels = { green:'Normal (R1)', yellow:'Hangat (R2)', red:'Panas (R3)' };
  const badge  = cls
    ? `<span class="badge ${cls}">${labels[cls]}</span>`
    : '<span class="badge">—</span>';
  logRows.unshift({
    num: rowNum, time: now,
    suhu: isNaN(suhu) ? '—' : suhu.toFixed(1),
    hum:  isNaN(hum)  ? '—' : hum.toFixed(1),
    badge, cls,
    ldr: (ldrVal !== undefined && ldrVal !== -1) ? ldrVal : null
  });
  if (logRows.length > MAX_LOG) logRows.pop();
  renderLog();
}

function renderLog() {
  const tbody = document.getElementById('log-body');
  if (!logRows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Belum ada data</td></tr>';
    return;
  }
  document.getElementById('log-count').textContent = logRows.length + ' entri';
  const cmap = { green:'var(--green)', yellow:'var(--yellow-2)', red:'var(--red)' };
  tbody.innerHTML = logRows.map(r => {
    let ldrRaw  = '<td style="color:#94a3b8">—</td>';
    let ldrCond = '<td style="color:#94a3b8">—</td>';
    if (r.ldr !== null && r.ldr !== undefined) {
      const info  = ldrInfo(r.ldr);
      const col   = r.ldr === 1 ? 'var(--yellow-2)' : 'var(--purple)';
      ldrRaw  = `<td style="font-weight:700;color:${col};font-family:monospace">${r.ldr}</td>`;
      ldrCond = `<td><span class="ldr-badge ${info.cls}" style="font-size:.66rem;padding:2px 8px">${info.badge}</span></td>`;
    }
    return `<tr>
      <td>${r.num}</td><td>${r.time}</td>
      <td class="temp-val" style="color:${cmap[r.cls]||'var(--text)'}">${r.suhu}</td>
      <td>${r.hum}</td>
      ${ldrRaw}${ldrCond}
      <td>${r.badge}</td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════
   EXPORT CSV
   ════════════════════════════════════════════ */
function downloadCSV(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('📥 ' + filename + ' berhasil diunduh');
}
function ts() { return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); }

function exportSensorCSV() {
  if (!logRows.length) { showToast('Belum ada data'); return; }
  const hdr  = 'No,Waktu,Suhu (C),Kelembapan (%),LDR Raw,Kondisi Cahaya,Status Suhu\n';
  const body = [...logRows].reverse().map(r => {
    const st   = r.cls === 'green' ? 'Normal (R1)' : r.cls === 'yellow' ? 'Hangat (R2)' : r.cls === 'red' ? 'Panas (R3)' : '-';
    const lrw  = r.ldr !== null ? r.ldr : '-';
    const lcond= r.ldr === 1 ? 'Terang (LGT)' : r.ldr === 0 ? 'Gelap (DRK)' : '-';
    return `${r.num},${r.time},${r.suhu},${r.hum},${lrw},${lcond},${st}`;
  }).join('\n');
  downloadCSV(`sensor_ldr_${ts()}.csv`, hdr + body);
}

function exportAllCSV() { exportSensorCSV(); }

/* ════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════ */
function setConnected(yes) {
  document.getElementById('status-dot').className     = 'dot' + (yes ? ' connected' : '');
  document.getElementById('status-label').className   = yes ? 'connected' : '';
  document.getElementById('status-label').textContent = yes ? 'CONNECTED' : 'DISCONNECTED';
  document.getElementById('btn-connect').disabled     = yes;
  document.getElementById('btn-disconnect').disabled  = !yes;
  if (!yes) {
    ['btn-export-all','btn-export-sensor'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }
}

/* ════════════════════════════════════════════
   NOTIFIKASI AUTO / MANUAL
   ════════════════════════════════════════════ */
let notifMode = 'manual';

function toggleNotifMode() {
  notifMode = notifMode === 'manual' ? 'auto' : 'manual';
  applyNotifMode(true);
  /* Kirim perintah ke ESP32 agar sync */
  sendCmd(notifMode === 'auto' ? 'AUTO_ON' : 'AUTO_OFF');
}

function applyNotifMode(doToast = true) {
  const isAuto = notifMode === 'auto';
  document.getElementById('relay-mode-toggle').classList.toggle('is-auto', isAuto);
  const badge = document.getElementById('relay-mode-badge');
  badge.textContent = isAuto ? 'Auto' : 'Manual';
  badge.classList.toggle('is-auto', isAuto);
  document.getElementById('relay-mode-label-m').classList.toggle('active-m', !isAuto);
  document.getElementById('relay-mode-label-a').classList.toggle('active-a', isAuto);

  const isConn = client && client.isConnected();
  setRelayButtonsDisabled(!isConn);
  document.querySelector('.relay-section').classList.toggle('relay-auto-locked', isAuto);

  if (doToast) showToast(isAuto
    ? '🤖 Mode AUTO — relay dikendalikan ESP32, tombol nonaktif'
    : '✋ Mode MANUAL — relay bisa dikontrol dari web');
}

/* ════════════════════════════════════════════
   GRAFIK REALTIME — Chart.js
   ════════════════════════════════════════════ */
const MAX_CHART = 20;  // maksimal titik di grafik
const chartData = {
  labels: [],
  temp:   [],
  hum:    [],
  ldr:    []
};

let realtimeChart = null;
let chartMode = 'all';

function initChart() {
  const ctx = document.getElementById('realtimeChart').getContext('2d');
  realtimeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label: 'Suhu (°C)',
          data: chartData.temp,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#8b5cf6',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Kelembapan (%)',
          data: chartData.hum,
          borderColor: '#5b8dee',
          backgroundColor: 'rgba(91,141,238,.10)',
          borderWidth: 2.5,
          pointBackgroundColor: '#5b8dee',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'LDR (0/1)',
          data: chartData.ldr,
          borderColor: '#f6c343',
          backgroundColor: 'rgba(246,195,67,.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#f6c343',
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0,
          stepped: true,
          fill: true,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,.95)',
          borderColor: 'rgba(139,92,246,.3)',
          borderWidth: 1.5,
          titleColor: '#1e1b4b',
          bodyColor: '#475569',
          titleFont: { family: 'Space Mono', size: 11 },
          bodyFont:  { family: 'Nunito', size: 12, weight: '700' },
          padding: 12,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label.includes('LDR'))
                return ` LDR: ${ctx.parsed.y === 1 ? '☀️ Terang → R4 OFF' : '🌑 Gelap → R4 ON'}`;
              return ` ${ctx.dataset.label}: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(139,92,246,.07)', drawTicks: false },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Space Mono', size: 9 },
            maxTicksLimit: 8, maxRotation: 0
          }
        },
        y: {
          position: 'left',
          grid: { color: 'rgba(139,92,246,.07)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Space Mono', size: 9 },
            callback: v => v + ''
          },
          title: {
            display: true, text: '°C / %',
            color: '#94a3b8',
            font: { family: 'Nunito', size: 10, weight: '700' }
          }
        },
        y2: {
          position: 'right',
          min: -0.2, max: 1.5,
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#f6c343',
            font: { family: 'Space Mono', size: 9 },
            callback: v => v === 1 ? '☀️' : v === 0 ? '🌑' : ''
          }
        }
      }
    }
  });
}

function pushChartData(suhu, hum, ldr) {
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });

  chartData.labels.push(now);
  chartData.temp.push(isNaN(suhu) ? null : suhu);
  chartData.hum.push(isNaN(hum)   ? null : hum);
  chartData.ldr.push(ldr !== undefined && ldr !== null ? ldr : null);

  /* Batasi jumlah titik */
  if (chartData.labels.length > MAX_CHART) {
    chartData.labels.shift();
    chartData.temp.shift();
    chartData.hum.shift();
    chartData.ldr.shift();
  }

  /* Sembunyikan placeholder */
  document.getElementById('chart-empty').classList.add('hidden');
  document.getElementById('chart-live-pill').classList.add('active');

  applyChartMode();
  if (realtimeChart) realtimeChart.update('active');
}

function setChartMode(mode) {
  chartMode = mode;
  ['all','temp','hum','ldr'].forEach(m => {
    document.getElementById('tab-' + m).classList.toggle('active', m === mode);
  });
  applyChartMode();
  if (realtimeChart) realtimeChart.update();
}

function applyChartMode() {
  if (!realtimeChart) return;
  const ds = realtimeChart.data.datasets;
  if (chartMode === 'all')  { ds[0].hidden = false; ds[1].hidden = false; ds[2].hidden = false; }
  if (chartMode === 'temp') { ds[0].hidden = false; ds[1].hidden = true;  ds[2].hidden = true;  }
  if (chartMode === 'hum')  { ds[0].hidden = true;  ds[1].hidden = false; ds[2].hidden = true;  }
  if (chartMode === 'ldr')  { ds[0].hidden = true;  ds[1].hidden = true;  ds[2].hidden = false; }
}

function clearChart() {
  chartData.labels.length = 0;
  chartData.temp.length   = 0;
  chartData.hum.length    = 0;
  chartData.ldr.length    = 0;
  if (realtimeChart) realtimeChart.update();
  document.getElementById('chart-empty').classList.remove('hidden');
  document.getElementById('chart-live-pill').classList.remove('active');
  showToast('↺ Grafik direset');
}

/* ── Init chart saat halaman siap ── */
window.addEventListener('DOMContentLoaded', initChart);

/* ════════════════════════════════════════════
   LIVE BADGE & LAST UPDATE
   ════════════════════════════════════════════ */
let freshTimer = null;
function bumpLive() {
  const lu  = document.getElementById('last-update');
  const lbg = document.getElementById('live-badge');
  if (!lu || !lbg) return;

  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
  lu.textContent = 'Update terakhir: ' + now;
  lu.classList.add('fresh');
  lbg.classList.add('visible');

  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => lu.classList.remove('fresh'), 2500);
}

/* ── Init ── */
if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
setRelayButtonsDisabled(true);
['btn-export-all','btn-export-sensor'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.disabled = true;
});
applyNotifMode(false);

/* ══ DEMO MODE — hapus komentar untuk test tanpa hardware
let _dl = 1;
setInterval(() => {
  _dl = _dl === 1 ? 0 : 1;
  handleMessage(TOPIC_SENSOR, JSON.stringify({
    temp: +(24+Math.random()*9).toFixed(1),
    humi: +(55+Math.random()*20).toFixed(1),
    ldr:  _dl,
    mode: notifMode === 'auto' ? 'AUTO' : 'MANUAL',
    r:    [1,0,0,0].map(()=>Math.random()>.5?1:0)
  }));
}, 4000);
*/
