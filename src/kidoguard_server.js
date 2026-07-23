// KIDAPP.ORG BACKEND SERVER (Node.js + Express + WebSockets)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = 'kidapp-super-secret-key-2026';

app.use(cors());
app.use(express.json());

// Serve static PWA frontend files
app.use(express.static(path.join(__dirname, '../../kidoguard')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const fs = require('fs');
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// IN-MEMORY DATABASE FOR PROTOTYPE / MVP
const db = {
  parents: [],
  children: [
    {
      id: 'child_1',
      name: 'Lucas',
      age: 12,
      device: 'Galaxy S22',
      battery: 78,
      status: 'online',
      isLocked: false,
      remainingMinutes: 45,
      gps: { lat: 40.4168, lng: -3.7038, location: 'Colegio Cervantes' }
    }
  ],
  qrTokens: new Map(), // pairing tokens
  aiRequests: [
    {
      id: 'req_101',
      childId: 'child_1',
      childName: 'Lucas',
      requestedMinutes: 15,
      reason: 'Hola papá, necesito 15 min más en WhatsApp porque estamos organizando el trabajo de Historia.',
      aiEvaluation: 'El motivo es académico y legítimo. Lucas ha cumplido con su horario de lectura. Se sugiere APROBAR.',
      status: 'pending',
      timestamp: new Date().toISOString()
    }
  ],
  eventLog: []
};

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
  db.qrTokens.set(tokenCode, { createdAt: Date.now(), status: 'pending' });

  res.json({
    pairingCode: tokenCode,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(tokenCode)}`,
    expiresInSeconds: 300
  });
});

// 3. Pair Child Device via QR Code
app.post('/api/devices/pair', (req, res) => {
  const { pairingCode, deviceName, childName, childAge } = req.body;
  if (!db.qrTokens.has(pairingCode)) {
    return res.status(404).json({ error: 'Código de emparejamiento inválido o expirado' });
  }

  const newChild = {
    id: `child_${Date.now()}`,
    name: childName || 'Nuevo Hijo',
    age: childAge || 10,
    device: deviceName || 'Smartphone',
    battery: 100,
    status: 'online',
    isLocked: false,
    remainingMinutes: 60,
    gps: { lat: 40.4168, lng: -3.7038, location: 'En casa' }
  };

  db.children.push(newChild);
  db.qrTokens.delete(pairingCode);

  broadcastToSockets({ type: 'DEVICE_PAIRED', child: newChild });
  res.json({ message: 'Dispositivo emparejado con éxito', child: newChild });
});

// 4. Toggle Global Lock (Pausar Internet)
app.post('/api/lock/toggle', (req, res) => {
  const { childId, isLocked, reason } = req.body;
  const child = db.children.find(c => c.id === (childId || 'child_1'));

  if (!child) return res.status(404).json({ error: 'Hijo no encontrado' });

  child.isLocked = isLocked !== undefined ? isLocked : !child.isLocked;

  const logEntry = {
    type: 'lock',
    title: child.isLocked ? 'PAUSA FAMILIAR ACTIVADA' : 'Dispositivo Reanudado',
    time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };
  db.eventLog.unshift(logEntry);

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
      childId: 'child_1',
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
  const child = db.children.find(c => c.id === (childId || 'child_1'));

  const newReq = {
    id: `req_${Date.now()}`,
    childId: child ? child.id : 'child_1',
    childName: child ? child.name : 'Lucas',
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
    aiRequests: db.aiRequests.filter(r => r.status === 'pending'),
    eventLog: db.eventLog
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Mensaje WebSocket recibido:', data);

      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      } else if (data.type === 'GPS_UPDATE') {
        // Actualizar coordenadas en la base de datos en memoria y retransmitir a la PWA
        const child = db.children.find(c => c.id === 'child_1');
        if (child) {
          child.gps = {
            lat: data.lat,
            lng: data.lng,
            speed: data.speed || '0 km/h',
            timestamp: data.timestamp || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          };
        }
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

// START SERVER
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 SERVIDOR KIDAPP.ORG CORRIENDO EN PORT ${PORT}`);
  console.log(`🌐 PWA disponible en: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket Server listo en ws://localhost:${PORT}`);
  console.log(`===================================================`);
});
