// KIDAPP.ORG BACKEND SERVER (Node.js + Express + WebSockets)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');

// CONFIGURACIÓN DE CLAVES VAPID PARA NOTIFICACIONES WEB PUSH DE FONDO
const VAPID_PUBLIC_KEY = 'BK8xywDfDCgi5DlBZwwj8reoJaFwWfAzbgLrwXaBZ9cWo5BJD_Mm6eHaONi-TAy9dSH2ADzA7VKq6Tc--NvH_dk';
const VAPID_PRIVATE_KEY = '53jSNH5chFTHNUGI0XhhFCTihvyZ68EyQJfMMbBLynU';
webPush.setVapidDetails(
  'mailto:soporte@kidapp.org',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = 'kidapp-super-secret-key-2026';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Serve static PWA frontend files
app.use(express.static(path.join(__dirname, '../../kidoguard')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const fs = require('fs');
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const childrenFilePath = path.join(uploadsDir, 'children.json');
const zonesFilePath = path.join(uploadsDir, 'zones.json');
const choresFilePath = path.join(uploadsDir, 'chores.json');
const routinesFilePath = path.join(uploadsDir, 'routines.json');
const subscriptionsFilePath = path.join(uploadsDir, 'subscriptions.json');

// IN-MEMORY DATABASE FOR PROTOTYPE / MVP
const db = {
  parents: [],
  children: [],
  zones: [],
  chores: [],
  routines: [],
  pushSubscriptions: [],
  qrTokens: new Map(),
  aiRequests: [],
  eventLog: []
};

// Cargar datos guardados inicialmente si existen en disco
function loadDbFromFile() {
  try {
    if (fs.existsSync(childrenFilePath)) {
      db.children = JSON.parse(fs.readFileSync(childrenFilePath, 'utf8'));
      db.children.forEach(c => {
        if (!c.appLimits) {
          c.appLimits = {
            'com.roblox.client': '1h30m',
            'com.zhiliaoapp.musically': '45m',
            'com.whatsapp': 'allowed',
            'com.google.android.youtube': '1h',
            'com.instagram.android': 'allowed',
            'com.supercell.brawlstars': 'allowed'
          };
        }
        if (!c.appUsage) {
          c.appUsage = {
            'com.roblox.client': 0,
            'com.zhiliaoapp.musically': 0,
            'com.whatsapp': 0,
            'com.google.android.youtube': 0,
            'com.instagram.android': 0,
            'com.supercell.brawlstars': 0
          };
        }
      });
      console.log('📂 Servidor: Cargados hijos desde disco:', db.children.length);
    }
    if (fs.existsSync(zonesFilePath)) {
      db.zones = JSON.parse(fs.readFileSync(zonesFilePath, 'utf8'));
      console.log('📂 Servidor: Cargadas zonas desde disco:', db.zones.length);
    }
    if (fs.existsSync(choresFilePath)) {
      db.chores = JSON.parse(fs.readFileSync(choresFilePath, 'utf8'));
      console.log('📂 Servidor: Cargadas tareas desde disco:', db.chores.length);
    }
    if (fs.existsSync(routinesFilePath)) {
      db.routines = JSON.parse(fs.readFileSync(routinesFilePath, 'utf8'));
      console.log('📂 Servidor: Cargadas rutinas desde disco:', db.routines.length);
    }
    if (fs.existsSync(subscriptionsFilePath)) {
      db.pushSubscriptions = JSON.parse(fs.readFileSync(subscriptionsFilePath, 'utf8'));
      console.log('📂 Servidor: Cargadas suscripciones push desde disco:', db.pushSubscriptions.length);
    }
  } catch (e) {
    console.error('Error cargando DB desde disco:', e);
  }
}

function saveDbToFile() {
  try {
    fs.writeFileSync(childrenFilePath, JSON.stringify(db.children, null, 2));
    fs.writeFileSync(zonesFilePath, JSON.stringify(db.zones, null, 2));
    fs.writeFileSync(choresFilePath, JSON.stringify(db.chores, null, 2));
    fs.writeFileSync(routinesFilePath, JSON.stringify(db.routines, null, 2));
    fs.writeFileSync(subscriptionsFilePath, JSON.stringify(db.pushSubscriptions, null, 2));
    console.log('💾 Servidor: Datos persistidos en disco.');
  } catch (e) {
    console.error('Error escribiendo DB a disco:', e);
  }
}

loadDbFromFile();

// HTTP REST API ENDPOINTS

// 1. Parent Register / Login
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const existing = db.parents.find(p => p.email === email);
  if (existing) return res.status(400).json({ error: 'El email ya está registrado' });

  const parent = { id: `parent_${Date.now()}`, email, password, name: name || 'Familia García' };
  db.parents.push(parent);

  const token = jwt.sign({ parentId: parent.id, email: parent.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ message: 'Registro exitoso', token, parent: { id: parent.id, name: parent.name, email: parent.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const parent = db.parents.find(p => p.email === email && p.password === password);
  if (!parent) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign({ parentId: parent.id, email: parent.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ message: 'Login exitoso', token, parent: { id: parent.id, name: parent.name, email: parent.email } });
});

// 2. Generate QR Pairing Token (60s Onboarding)
app.get('/api/devices/qr-generate', (req, res) => {
  const tokenCode = `KIDO-${Math.floor(1000 + Math.random() * 9000)}`;
  db.qrTokens.set(tokenCode, { 
    createdAt: Date.now(), 
    status: 'pending',
    childId: req.query.childId // Guardar la asociación del hijo que solicitó el QR
  });

  res.json({
    pairingCode: tokenCode,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(tokenCode)}`,
    expiresInSeconds: 300
  });
});

// 3. Pair Child Device via QR Code
app.post('/api/devices/pair', (req, res) => {
  const { pairingCode, deviceName, childName, childAge, batteryLevel } = req.body;
  if (!db.qrTokens.has(pairingCode)) {
    return res.status(404).json({ error: 'Código de emparejamiento inválido o expirado' });
  }

  const tokenInfo = db.qrTokens.get(pairingCode);
  let targetChild = null;

  // Intentar buscar el perfil del hijo real asociado a este código QR
  if (tokenInfo && tokenInfo.childId) {
    targetChild = db.children.find(c => c.id === tokenInfo.childId);
  }

  // Fallback al primer hijo si no se encuentra por tokenInfo
  if (!targetChild) {
    targetChild = db.children[0];
  }

  if (targetChild) {
    // Si existe el perfil, lo actualizamos con los datos del móvil escaneado
    targetChild.device = deviceName || 'Smartphone';
    targetChild.battery = batteryLevel || 85;
    targetChild.status = 'online';
  } else {
    // Si no existe, creamos el perfil (fallback legado)
    targetChild = {
      id: `child_${Date.now()}`,
      name: childName || 'Nuevo Hijo',
      age: childAge || 10,
      device: deviceName || 'Smartphone',
      battery: 100,
      status: 'online',
      isLocked: false,
      remainingMinutes: 60,
      gps: { lat: 40.4168, lng: -3.7038, location: 'En casa' },
      appLimits: {
        'com.roblox.client': '1h30m',
        'com.zhiliaoapp.musically': '45m',
        'com.whatsapp': 'allowed',
        'com.google.android.youtube': '1h',
        'com.instagram.android': 'allowed',
        'com.supercell.brawlstars': 'allowed'
      },
      appUsage: {
        'com.roblox.client': 0,
        'com.zhiliaoapp.musically': 0,
        'com.whatsapp': 0,
        'com.google.android.youtube': 0,
        'com.instagram.android': 0,
        'com.supercell.brawlstars': 0
      }
    };
    db.children.push(targetChild);
  }

  db.qrTokens.delete(pairingCode);
  saveDbToFile();

  broadcastToSockets({ type: 'DEVICE_PAIRED', child: targetChild });
  res.json({ message: 'Dispositivo emparejado con éxito', child: targetChild });
});

// 3b. Central Children Management endpoints for Parent PWA (multi-device sync)
app.get('/api/children', (req, res) => {
  res.json(db.children);
});

app.post('/api/children', (req, res) => {
  const { child } = req.body;
  if (!child) return res.status(400).json({ error: 'Datos de hijo vacíos' });

  // Evitar duplicados
  const exists = db.children.some(c => c.id === child.id);
  if (!exists) {
    db.children.push(child);
    saveDbToFile();
    broadcastToSockets({ type: 'CHILD_ADDED', child });
  }
  res.json({ success: true, children: db.children });
});

app.delete('/api/children/:id', (req, res) => {
  const childId = req.params.id;
  db.children = db.children.filter(c => c.id !== childId);
  saveDbToFile();
  broadcastToSockets({ type: 'CHILD_DELETED', childId });
  res.json({ success: true, children: db.children });
});

// 3c. Safe Zones (Geofences) Management endpoints (multi-device sync)
app.get('/api/zones', (req, res) => {
  res.json(db.zones || []);
});

app.post('/api/zones', (req, res) => {
  const { zone } = req.body;
  if (!zone) return res.status(400).json({ error: 'Datos de zona vacíos' });

  // Evitar duplicados
  const exists = db.zones.some(z => z.id === zone.id);
  if (!exists) {
    db.zones.push(zone);
    saveDbToFile();
    broadcastToSockets({ type: 'ZONE_ADDED', zone });
  }
  res.json({ success: true, zones: db.zones });
});

app.delete('/api/zones/:id', (req, res) => {
  const zoneId = req.params.id;
  db.zones = db.zones.filter(z => z.id !== zoneId);
  saveDbToFile();
  broadcastToSockets({ type: 'ZONE_DELETED', zoneId });
  res.json({ success: true, zones: db.zones });
});

// Toggle safe zone enabled/disabled state
app.post('/api/zones/:id/toggle', (req, res) => {
  const zoneId = req.params.id;
  const { enabled } = req.body;
  const zone = db.zones.find(z => z.id === zoneId);
  if (zone) {
    zone.enabled = enabled;
    saveDbToFile();
    broadcastToSockets({ type: 'ZONE_TOGGLED', zoneId, enabled });
    res.json({ success: true, zone });
  } else {
    res.status(404).json({ error: 'Zona no encontrada' });
  }
});

// 3d. Chores (Missions) Management endpoints (multi-device real-time sync)
app.get('/api/chores', (req, res) => {
  res.json(db.chores || []);
});

app.post('/api/chores', (req, res) => {
  const { chore } = req.body;
  if (!chore) return res.status(400).json({ error: 'Datos de tarea vacíos' });

  // Evitar duplicados
  const exists = db.chores.some(c => c.id === chore.id);
  if (!exists) {
    db.chores.push(chore);
    saveDbToFile();
    broadcastToSockets({ type: 'CHORE_ADDED', chore });
  }
  res.json({ success: true, chores: db.chores });
});

app.post('/api/chores/:id/approve', (req, res) => {
  const choreId = req.params.id;
  const chore = db.chores.find(c => c.id === choreId);

  if (!chore) return res.status(404).json({ error: 'Tarea no encontrada' });

  chore.completed = true;
  saveDbToFile();
  broadcastToSockets({ type: 'CHORE_APPROVED', choreId, reward: chore.reward });
  res.json({ success: true, chore });
});

// 3e. Routines Management endpoints
app.get('/api/routines', (req, res) => {
  res.json(db.routines || []);
});

app.post('/api/routines', (req, res) => {
  const { routines } = req.body;
  if (!Array.isArray(routines)) return res.status(400).json({ error: 'Formato incorrecto' });
  db.routines = routines;
  saveDbToFile();
  broadcastToSockets({ type: 'ROUTINES_UPDATED', routines: db.routines });
  res.json({ success: true, routines: db.routines });
});

// 3f. Web Push Subscription endpoint
app.post('/api/push/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'Suscripción vacía' });

  // Evitar duplicar la misma suscripción (comparando por endpoint)
  const exists = db.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
  if (!exists) {
    db.pushSubscriptions.push(subscription);
    saveDbToFile();
    console.log('🔔 Servidor: Nueva suscripción Push registrada (Total:', db.pushSubscriptions.length, ')');
  }
  res.json({ success: true });
});

// Helper para enviar notificaciones Push a todos los padres registrados
function sendPushNotificationToAll(title, body) {
  console.log(`📡 Enviando Web Push de fondo: [${title}] ${body}`);
  const payload = JSON.stringify({ title, body, icon: './icon.jpg' });

  const promises = db.pushSubscriptions.map(sub => {
    return webPush.sendNotification(sub, payload)
      .catch(err => {
        // Si el endpoint ha expirado o el navegador lo ha rechazado (410/404), limpiamos la suscripción
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log('🧹 Limpiando suscripción push caducada:', sub.endpoint.substring(0, 45) + '...');
          db.pushSubscriptions = db.pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
          saveDbToFile();
        } else {
          console.error('Error enviando notificación push:', err);
        }
      });
  });

  return Promise.all(promises);
}

// 4. Toggle Global Lock (Pausar Internet)
app.post('/api/lock/toggle', (req, res) => {
  const { childId, isLocked, reason } = req.body;
  // Mapea dinámicamente al primer hijo o busca por ID
  const child = db.children[0] || db.children.find(c => c.id === childId);

  if (!child) return res.status(404).json({ error: 'Hijo no encontrado' });

  child.isLocked = isLocked !== undefined ? isLocked : !child.isLocked;
  child.lockedByRoutine = null; // Si el padre interviene manualmente, anulamos el bloqueo automático de rutina

  const logEntry = {
    type: 'lock',
    title: child.isLocked ? 'PAUSA FAMILIAR ACTIVADA' : 'Dispositivo Reanudado',
    time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };
  db.eventLog.unshift(logEntry);
  saveDbToFile(); // Persistir el estado del bloqueo en disco

  broadcastToSockets({
    type: 'GLOBAL_LOCK_UPDATE',
    childId: child.id,
    isLocked: child.isLocked,
    reason: reason || 'Pausa familiar activada desde la PWA del padre'
  });

  res.json({ message: 'Estado de bloqueo actualizado', child });
});

// 5. Trigger Loud Signal (Señal Fuerte a máximo volumen)
app.post('/api/signal/loud', (req, res) => {
  const { childId } = req.body;
  broadcastToSockets({
    type: 'TRIGGER_LOUD_SIGNAL',
    childId: childId || 'child_1'
  });
  res.json({ message: 'Señal Fuerte enviada con éxito' });
});

// 5e. SOS Alert Endpoint (Llamado de pánico del hijo)
app.post('/api/child/sos', (req, res) => {
  const { childId } = req.body;
  const child = db.children[0] || db.children.find(c => c.id === childId);
  const childName = child ? child.name : 'Tu hijo';
  const messageText = `🚨 ¡ALERTA S.O.S.! ${childName} ha pulsado el botón de auxilio desde el móvil bloqueado.`;
  
  // 1. Registrar en el historial de eventos
  const event = {
    type: 'sos_alert',
    message: messageText,
    time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };
  db.eventLog.push(event);
  saveDbToFile();

  // 2. Retransmitir a la PWA del padre
  broadcastToSockets({
    type: 'SOS_ALERT',
    childId: childId,
    childName: childName,
    message: messageText,
    event: event
  });

  // 3. Enviar notificación push de fondo al padre
  sendPushNotificationToAll('🚨 ALERTA S.O.S.', `${childName} necesita ayuda urgente.`);

  res.json({ message: 'Alerta SOS procesada y emitida con éxito' });
});

// 5c. Upload Ambient Audio File from Child Device
app.post('/api/audio/upload', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const filename = `ambient_${Date.now()}.3gp`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, req.body);
    const audioUrl = `/uploads/${filename}`;

    console.log(`🎙️ Nuevo audio ambiental guardado en el servidor: ${filePath}`);

     broadcastToSockets({
      type: 'NEW_AMBIENT_AUDIO',
      childId: db.children[0] ? db.children[0].id : 'child_temp',
      audioUrl: audioUrl,
      timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    });

    res.json({ message: 'Audio recibido y notificado a la PWA', audioUrl });
  } catch (err) {
    console.error('Error guardando audio:', err);
    res.status(500).json({ error: 'Error procesando audio' });
  }
});

// 6. AI Mediator: Child Requests Extra Time
app.post('/api/ai/request-time', (req, res) => {
  const { childId, minutes, reason } = req.body;
  const child = db.children[0] || db.children.find(c => c.id === childId);

  const newReq = {
    id: `req_${Date.now()}`,
    childId: child ? child.id : 'child_temp',
    childName: child ? child.name : 'Hijo',
    requestedMinutes: minutes || 15,
    reason: reason || 'Solicitud de tiempo extra para tareas escolares',
    aiEvaluation: 'Solicitud recibida. La IA considera que el comportamiento del día ha sido adecuado. Se sugiere APROBAR.',
    status: 'pending',
    timestamp: new Date().toISOString()
  };

  db.aiRequests.unshift(newReq);
  broadcastToSockets({ type: 'NEW_AI_REQUEST', request: newReq });

  res.json({ message: 'Solicitud enviada al mediador IA', request: newReq });
});

// 6. AI Mediator: Parent Resolves Request (Approve / Deny)
app.post('/api/ai/resolve-time', (req, res) => {
  const { requestId, action } = req.body;
  const reqObj = db.aiRequests.find(r => r.id === requestId);

  if (!reqObj) return res.status(404).json({ error: 'Solicitud no encontrada' });

  reqObj.status = action === 'approve' ? 'approved' : 'denied';

  if (action === 'approve') {
    const child = db.children.find(c => c.id === reqObj.childId);
    if (child) child.remainingMinutes += reqObj.requestedMinutes;
  }

  broadcastToSockets({ type: 'AI_REQUEST_RESOLVED', request: reqObj, action });
  res.json({ message: `Solicitud ${reqObj.status}`, request: reqObj });
});

// CREATE HTTP SERVER & WEBSOCKET SERVER
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log('⚡ Nuevo cliente WebSocket conectado (PWA o Móvil)');

  // Send current state to newly connected client
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    children: db.children,
    zones: db.zones,
    chores: db.chores,
    routines: db.routines,
    aiRequests: db.aiRequests.filter(r => r.status === 'pending'),
    eventLog: db.eventLog
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Mensaje WebSocket recibido:', data);

      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      } else if (data.type === 'CHORE_ADDED') {
        // Guardar tarea y retransmitir a todos los clientes
        const exists = db.chores.some(c => c.id === data.chore.id);
        if (!exists) {
          db.chores.push(data.chore);
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'CHORE_APPROVED') {
        // Marcar tarea como completada y retransmitir
        const chore = db.chores.find(c => c.id === data.choreId);
        if (chore) {
          chore.completed = true;
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'ROUTINES_UPDATED') {
        // Guardar rutinas actualizadas y retransmitir
        if (Array.isArray(data.routines)) {
          db.routines = data.routines;
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'GPS_UPDATE') {
        // Actualizar coordenadas del primer hijo de la lista (ej: Mateo) y retransmitir
        const child = db.children[0];
        if (child) {
          child.gps = {
            lat: data.lat,
            lng: data.lng,
            speed: data.speed || '0 km/h',
            timestamp: data.timestamp || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          };
          if (data.battery !== undefined) {
            child.battery = data.battery;
          }
          data.childId = child.id;

          // EVALUAR ZONAS SEGURAS (GEOFENCING) EN EL SERVIDOR
          if (Array.isArray(db.zones)) {
            db.zones.forEach(zone => {
              if (zone.enabled === false) return; // Ignorar si la zona está desactivada

              const distance = getDistanceMeters(data.lat, data.lng, zone.lat, zone.lng);
              const isCurrentlyInside = distance <= zone.radius;

              // Inicializar si no está definido
              if (zone.isInside === undefined) {
                zone.isInside = isCurrentlyInside;
              }

              // Detectar transición (entró o salió)
              if (zone.isInside !== isCurrentlyInside) {
                zone.isInside = isCurrentlyInside;
                
                const childName = child.name || 'El menor';
                const statusText = isCurrentlyInside ? 'ha entrado en' : 'ha salido de';
                const emoji = isCurrentlyInside ? '🟢' : '🔴';
                const message = `${emoji} ${childName} ${statusText} la zona segura: ${zone.name}`;
                
                // Enviar notificación Push de fondo a los padres registrados
                sendPushNotificationToAll('Alerta de Ubicación', message);
                
                // Registrar en el historial de eventos del servidor
                db.eventLog.push({
                  type: isCurrentlyInside ? 'gps_inside' : 'gps_outside',
                  message: message,
                  time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                });
              }
            });
          }

          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'APP_LIMITS_UPDATE') {
        const child = db.children.find(c => c.id === data.childId) || db.children[0];
        if (child) {
          data.childId = child.id;
          child.appLimits = data.appLimits;
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'INSTALLED_APPS_REPORT') {
        const child = db.children.find(c => c.id === data.childId) || db.children[0];
        if (child) {
          data.childId = child.id;
          child.installedApps = data.apps;
          if (!child.appLimits) child.appLimits = {};
          if (!child.appUsage) child.appUsage = {};
          data.apps.forEach(app => {
            if (!child.appLimits[app.packageName]) {
              if (app.appName.toLowerCase().includes("roblox")) {
                child.appLimits[app.packageName] = "1h30m";
              } else if (app.appName.toLowerCase().includes("tiktok")) {
                child.appLimits[app.packageName] = "45m";
              } else if (app.appName.toLowerCase().includes("youtube")) {
                child.appLimits[app.packageName] = "1h";
              } else {
                child.appLimits[app.packageName] = "allowed";
              }
            }
            if (child.appUsage[app.packageName] === undefined) {
              child.appUsage[app.packageName] = 0;
            }
          });
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'APP_USAGE_UPDATE') {
        const child = db.children.find(c => c.id === data.childId) || db.children[0];
        if (child) {
          data.childId = child.id;
          if (!child.appUsage) child.appUsage = {};
          const key = data.packageName || data.appName;
          if (key) {
            child.appUsage[key] = data.seconds;
          }
          saveDbToFile();
        }
        broadcastToSockets(data);
      } else if (data.type === 'SOS_ALERT') {
        const child = db.children[0] || db.children.find(c => c.id === data.childId);
        const childName = child ? child.name : 'Tu hijo';
        const messageText = `🚨 ¡ALERTA S.O.S.! ${childName} ha pulsado el botón de auxilio desde el móvil bloqueado.`;

        // Registrar en historial
        const event = {
          type: 'sos_alert',
          message: messageText,
          time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        };
        db.eventLog.push(event);
        saveDbToFile();

        // Enviar a la PWA de los padres y notificación push de fondo
        broadcastToSockets({
          type: 'SOS_ALERT',
          childId: data.childId,
          childName: childName,
          message: messageText,
          event: event
        });
        sendPushNotificationToAll('🚨 ALERTA S.O.S.', `${childName} necesita ayuda urgente.`);
      } else {
        // Retransmitir cualquier otro mensaje de control (como REQUEST_HIGH_ACCURACY_GPS, etc.)
        broadcastToSockets(data);
      }
    } catch (e) {
      console.error('Error parseando WebSocket msg:', e);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log('Cliente WebSocket desconectado');
  });
});

function broadcastToSockets(payload) {
  const messageStr = JSON.stringify(payload);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// PLANIFICADOR AUTOMÁTICO DE RUTINAS (MODO COLEGIO / MODO NOCHE)
function checkRoutinesScheduler() {
  if (!Array.isArray(db.routines) || !Array.isArray(db.children) || db.children.length === 0) return;

  const now = new Date();
  
  // Obtener el día de la semana en la zona horaria de España (Europe/Madrid)
  const dayFormatter = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short' });
  const dayStr = dayFormatter.format(now).replace('.', '').toLowerCase().trim();
  const dayMappingShort = {
    'lun': 'L',
    'mar': 'M',
    'mié': 'X',
    'jue': 'J',
    'vie': 'V',
    'sáb': 'S',
    'dom': 'D'
  };
  const currentDayChar = dayMappingShort[dayStr] || 'L';

  // Obtener la hora actual en la zona horaria de España (Europe/Madrid) en formato "HH:MM"
  const timeFormatter = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
  const currentHHMM = timeFormatter.format(now);

  console.log(`[⏰ Rutinas Debug] Hora local España: ${currentHHMM}, Día España: ${currentDayChar}`);

  // Buscar si hay alguna rutina activa y en curso en este momento exacto
  const activeRoutine = db.routines.find(routine => {
    if (routine.active !== true) return false;
    if (!Array.isArray(routine.days) || !routine.days.includes(currentDayChar)) return false;

    const start = routine.start;
    const end = routine.end;

    // Controlar rutinas nocturnas que pasan de medianoche (ej. de 22:00 a 07:00)
    if (start <= end) {
      return (currentHHMM >= start && currentHHMM < end);
    } else {
      return (currentHHMM >= start || currentHHMM < end);
    }
  });

  // Procesar las transiciones de estado para cada hijo
  db.children.forEach(child => {
    const prevRoutineId = child.activeRoutineId || null;
    const newRoutineId = activeRoutine ? activeRoutine.id : null;

    // Solo actuar si hay un cambio o transición de rutina activa
    if (newRoutineId !== prevRoutineId) {
      console.log(`[⏰ Rutinas] Hijo ${child.name}: Transición de rutina ${prevRoutineId} a ${newRoutineId}`);
      
      if (newRoutineId) {
        // TRANSICIÓN: ¡Ha comenzado una rutina!
        if (!child.isLocked) {
          child.isLocked = true;
          child.lockedByRoutine = newRoutineId; // Recordar qué rutina activó el bloqueo

          db.eventLog.unshift({
            type: 'lock',
            title: `🔒 RUTINA ACTIVADA`,
            message: `Dispositivo bloqueado automáticamente por la rutina: "${activeRoutine.name}"`,
            time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          });

          broadcastToSockets({
            type: 'GLOBAL_LOCK_UPDATE',
            childId: child.id,
            isLocked: true,
            reason: `Bloqueado por rutina: ${activeRoutine.name}`
          });
        }
      } else {
        // TRANSICIÓN: ¡La rutina ha finalizado!
        // Solo desbloquear si el dispositivo fue bloqueado por la rutina y no manualmente por el padre
        if (child.isLocked && child.lockedByRoutine === prevRoutineId) {
          child.isLocked = false;
          child.lockedByRoutine = null;

          db.eventLog.unshift({
            type: 'lock', // Icono del candado
            title: `🔓 RUTINA FINALIZADA`,
            message: `Dispositivo desbloqueado automáticamente al finalizar la rutina anterior`,
            time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          });

          broadcastToSockets({
            type: 'GLOBAL_LOCK_UPDATE',
            childId: child.id,
            isLocked: false,
            reason: 'Rutina finalizada'
          });
        }
      }

      child.activeRoutineId = newRoutineId;
      saveDbToFile();
    }
  });
}

// Ejecutar el comprobador de rutinas cada 30 segundos
setInterval(checkRoutinesScheduler, 30000);

// START SERVER
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 SERVIDOR KIDAPP.ORG CORRIENDO EN PORT ${PORT}`);
  console.log(`🌐 PWA disponible en: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket Server listo en ws://localhost:${PORT}`);
  console.log(`===================================================`);
});
