const express = require('express');
const cors = require('cors');
const dgram = require('dgram');
const http = require('http');
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./auth');
const wss_module = require('./ws_server');
const db = require('./db');

// Inicializar DB
db.initDB();

const path = require('path');

// Configuración Express (API)
const app = express();
const server = http.createServer(app);

// Iniciar WebSocket sobre el mismo servidor HTTP (Puerto 3005)
const wss = wss_module.init(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../frontend')));

// API: Historial
app.get('/api/incidents/history', async (req, res) => {
    try {
        const history = await db.getRecentIncidents(20);
        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Info de un incidente
// API: Mock Verify (LLave Maestra)
app.post('/api/mock-verify', (req, res) => {
    const token = jwt.sign({ dni: '12345678A' }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ success: true, token });
});

app.get('/api/incidents/:id', async (req, res) => {
    try {
        const query = `SELECT * FROM incidents WHERE id = ?`;
        db.instance.get(query, [req.params.id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: "No encontrado" });
            res.json(row);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Detalles (20 fotos + audios)
app.get('/api/incidents/:id/details', async (req, res) => {
    try {
        const details = await db.getIncidentDetails(req.params.id);
        res.json(details);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(3005, () => {
    console.log('[SYSTEM] API Táctica integrada en puerto 3005');
});

const udpServer = dgram.createSocket('udp4');
const PORT = 9005;

// key: deviceId_payloadType_frameId -> { chunks: [], received: 0, total: X, timestamp: Y, type: Z }
const frameBuffers = new Map();

const HEADER_SIZE = 28;

udpServer.on('message', (msg, rinfo) => {
    if (msg.length < HEADER_SIZE) return; // Tamaño mínimo de la cabecera

    const deviceId = msg.readUInt32LE(0);
    const timestamp = msg.readUInt32LE(4);
    const frameId = msg.readUInt32LE(8);
    const totalChunks = msg.readUInt16LE(12);
    const chunkIdx = msg.readUInt16LE(14);
    const payloadLen = msg.readUInt16LE(16);
    const payloadType = msg.readUInt8(18); // 0=IMG, 1=AUDIO
    const padding = msg.readUInt8(19);
    const latitude = msg.readFloatLE(20);
    const longitude = msg.readFloatLE(24);
    
    const payload = msg.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);
    const streamKey = `${deviceId}_${payloadType}_${frameId}`;

    if (!frameBuffers.has(streamKey)) {
        frameBuffers.set(streamKey, {
            chunks: new Array(totalChunks),
            received: 0,
            total: totalChunks,
            timestamp: timestamp,
            type: payloadType,
            lat: latitude,
            lon: longitude
        });
        
        // Limpiar buffer incompleto tras 30s
        setTimeout(() => {
            if (frameBuffers.has(streamKey)) {
                frameBuffers.delete(streamKey);
            }
        }, 30000);
    }

    const frame = frameBuffers.get(streamKey);
    if (!frame.chunks[chunkIdx]) {
        frame.chunks[chunkIdx] = payload;
        frame.received++;

        if (frame.received === frame.total) {
            const fullPayload = Buffer.concat(frame.chunks);
            frameBuffers.delete(streamKey);
            
            // Guardar en DB (agrupado por Incidente) y broadcast
            (async () => {
                try {
                    const incidentId = await db.getOrCreateActiveIncident(deviceId, frame.lat, frame.lon);
                    const totalAlerts = await db.getIncidentCount();
                    
                    const broadcastData = {
                        device: deviceId,
                        lat: frame.lat,
                        lon: frame.lon,
                        incidentId: incidentId,
                        totalAlerts: totalAlerts,
                        timestamp: Date.now()
                    };

                    if (frame.type === 0) { // IMAGEN
                        const base64Image = `data:image/jpeg;base64,${fullPayload.toString('base64')}`;
                        await db.saveMedia(incidentId, 'image', base64Image, frame.id);
                        
                        broadcastData.type = 'image';
                        broadcastData.image = base64Image;
                        broadcastData.lat = frame.lat; // Asegurar coordenadas
                        broadcastData.lon = frame.lon;
                        wss.broadcast(broadcastData);
                        console.log(`[UDP/DB] Foto añadida al Incidente ${incidentId} (Device: ${deviceId})`);
                    } else if (frame.type === 1) { // AUDIO
                        const base64Audio = `data:audio/raw;base64,${fullPayload.toString('base64')}`;
                        await db.saveMedia(incidentId, 'audio', base64Audio, frame.id);
                        
                        broadcastData.type = 'audio';
                        broadcastData.audio = base64Audio;
                        broadcastData.lat = frame.lat; // Asegurar coordenadas
                        broadcastData.lon = frame.lon;
                        wss.broadcast(broadcastData);
                        console.log(`[UDP/DB] Audio añadido al Incidente ${incidentId} (Device: ${deviceId})`);
                    }
                } catch (e) {
                    console.error('[DB ERROR]', e.message);
                }
            })();
        }
    }
});

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`[UDP] Servidor escuchando en ${address.address}:${address.port}`);
});

udpServer.bind(PORT);
