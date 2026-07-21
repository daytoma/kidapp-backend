const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'security_system.sqlite');
const db = new sqlite3.Database(dbPath);

// Límite de medios (fotos o audios) que se conservan por incidente.
// Si se supera, se descarta el más antiguo (ventana deslizante).
const MAX_MEDIA_PER_TYPE = 20;

const initDB = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Tabla de Incidentes (Una entrada por cada pulsación de SOS)
            db.run(`
                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
                    latitude REAL,
                    longitude REAL,
                    status TEXT DEFAULT 'OPEN'
                )
            `);

            // Tabla de Media (Múltiples fotos/audios por incidente)
            db.run(`
                CREATE TABLE IF NOT EXISTS incident_media (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    incident_id INTEGER,
                    frame_id INTEGER,
                    media_type TEXT, -- 'image' o 'audio'
                    media_data TEXT,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(incident_id) REFERENCES incidents(id)
                )
            `);

            // Índice para acelerar búsquedas por incidente + tipo
            db.run(`
                CREATE INDEX IF NOT EXISTS idx_media_incident_type
                ON incident_media (incident_id, media_type, captured_at)
            `, (err) => {
                if (err) reject(err);
                else {
                    // Try to add column if it doesn't exist (for seamless upgrade)
                    db.run(`ALTER TABLE incident_media ADD COLUMN frame_id INTEGER`, () => {
                        console.log('[DB] Esquema de Incidentes Agrupados inicializado.');
                        resolve();
                    });
                }
            });
        });
    });
};

// Buscar incidente activo (últimos 2 minutos) para este dispositivo
const getOrCreateActiveIncident = (deviceId, lat, lon) => {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id FROM incidents 
             WHERE device_id = ? 
             AND last_update > strftime('%Y-%m-%d %H:%M:%S', 'now', '-2 minutes') 
             AND status = 'OPEN' 
             ORDER BY last_update DESC LIMIT 1`, 
            [deviceId], 
            (err, row) => {
                if (err) return reject(err);
                
                if (row) {
                    // Actualizar tiempo del incidente existente
                    db.run(`UPDATE incidents SET last_update = CURRENT_TIMESTAMP, latitude = ?, longitude = ? WHERE id = ?`, [lat, lon, row.id]);
                    resolve(row.id);
                } else {
                    // Crear nuevo incidente
                    db.run(
                        `INSERT INTO incidents (device_id, latitude, longitude) VALUES (?, ?, ?)`,
                        [deviceId, lat, lon],
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        }
                    );
                }
            }
        );
    });
};

const saveMedia = (incidentId, type, data, frameId = 0) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Ventana deslizante: si ya hay MAX_MEDIA_PER_TYPE registros de este tipo,
            // borramos el más antiguo antes de insertar el nuevo.
            db.get(
                `SELECT COUNT(*) as c FROM incident_media WHERE incident_id = ? AND media_type = ?`,
                [incidentId, type],
                (err, row) => {
                    if (err) return reject(err);

                    const doInsert = () => {
                        db.run(
                            `INSERT INTO incident_media (incident_id, frame_id, media_type, media_data) VALUES (?, ?, ?, ?)`,
                            [incidentId, frameId, type, data],
                            (err) => { if (err) reject(err); else resolve(); }
                        );
                    };

                    if (row && row.c >= MAX_MEDIA_PER_TYPE) {
                        // Borrar el más antiguo de este tipo para este incidente
                        db.run(
                            `DELETE FROM incident_media WHERE id = (
                                SELECT id FROM incident_media
                                WHERE incident_id = ? AND media_type = ?
                                ORDER BY captured_at ASC LIMIT 1
                            )`,
                            [incidentId, type],
                            (err) => { if (err) return reject(err); doInsert(); }
                        );
                    } else {
                        doInsert();
                    }
                }
            );
        });
    });
};

const getRecentIncidents = (limit = 20) => {
    return new Promise((resolve, reject) => {
        // Obtenemos incidentes y la PRIMERA foto para la miniatura
        const query = `
            SELECT i.*, 
                   (SELECT media_data FROM incident_media WHERE incident_id = i.id AND media_type = 'image' LIMIT 1) as thumbnail,
                   (SELECT COUNT(*) FROM incident_media WHERE incident_id = i.id) as media_count
            FROM incidents i
            ORDER BY i.last_update DESC
            LIMIT ?
        `;
        db.all(query, [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getIncidentDetails = (incidentId) => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM incident_media WHERE incident_id = ? ORDER BY media_type ASC, frame_id ASC LIMIT 50`, [incidentId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getIncidentCount = () => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as count FROM incidents`, (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
};

module.exports = {
    initDB,
    getOrCreateActiveIncident,
    saveMedia,
    getRecentIncidents,
    getIncidentDetails,
    getIncidentCount,
    instance: db
};
