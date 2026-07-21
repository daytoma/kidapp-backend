const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./auth');
const url = require('url');

let wss;

function init(server) {
    wss = new WebSocket.Server({ 
        server,
        verifyClient: (info, done) => {
            const parsedUrl = new url.URL('http://localhost' + info.req.url);
            const token = parsedUrl.searchParams.get('token');

            if (!token) {
                console.log('[WS] Bloqueado: Sin Token');
                return done(false, 401, 'Unauthorized');
            }

            jwt.verify(token, SECRET_KEY, (err, decoded) => {
                if (err) {
                    console.log('[WS] Bloqueado: Token Inválido');
                    return done(false, 401, 'Unauthorized');
                }
                console.log(`[WS] Autorizado: DNI ${decoded.dni}`);
                info.req.user = decoded;
                done(true);
            });
        }
    });

    console.log('[WS] Servidor WebSocket integrado en puerto 3005');

    wss.on('connection', (ws, req) => {
        console.log(`[WS] Dashboard conectado (DNI: ${req.user.dni})`);
        ws.on('close', () => console.log(`[WS] Dashboard desconectado`));
    });

    // Añadir método broadcast
    wss.broadcast = function broadcast(data) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    };

    return wss;
}

module.exports = { init };
