const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const ADMIN_CODE = "9999";

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync('index.html'));
});

const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });

let users = {};
let history = []; // Historique conservé uniquement pour l'admin
let activeClients = new Map();

function broadcast(data, excludeWs = null) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    ws.on('message', (raw) => {
        const data = JSON.parse(raw);

        if (data.type === 'login') {
            const { pseudo, code } = data;
            if (!pseudo || !code) return;

            if (users[pseudo]) {
                if (users[pseudo].banned) return ws.send(JSON.stringify({ type: 'login_error', msg: 'Ce compte est banni.' }));
                if (users[pseudo].code !== code) return ws.send(JSON.stringify({ type: 'login_error', msg: 'Code secret incorrect.' }));
                users[pseudo].ip = clientIp;
            } else {
                users[pseudo] = { code: code, ip: clientIp, banned: false };
            }

            activeClients.set(ws, pseudo);
            // On ne renvoie plus l'historique à l'utilisateur
            ws.send(JSON.stringify({ type: 'login_success', pseudo: pseudo }));
            broadcast({ type: 'system', text: `${pseudo} a rejoint la messagerie.` });
        }

        if (data.type === 'message') {
            const author = activeClients.get(ws);
            if (!author || users[author]?.banned) return;

            const msgObj = {
                id: Date.now(),
                author: author,
                ip: users[author].ip,
                msgType: data.msgType,
                content: data.content,
                time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            };
            history.push(msgObj); // Sauvegarde secrète pour l'admin
            broadcast({ type: 'new_message', message: msgObj });
        }

        if (data.type === 'webrtc') {
            data.from = activeClients.get(ws);
            broadcast(data, ws);
        }

        if (data.type === 'admin_auth') {
            if (data.code === ADMIN_CODE) {
                ws.send(JSON.stringify({ type: 'admin_data', users: users, history: history }));
            } else {
                ws.send(JSON.stringify({ type: 'admin_error', msg: 'Code Admin invalide !' }));
            }
        }

        if (data.type === 'admin_action' && data.code === ADMIN_CODE) {
            if (data.action === 'rename' && users[data.oldName] && !users[data.newName]) {
                users[data.newName] = users[data.oldName];
                delete users[data.oldName];
                history.forEach(m => { if (m.author === data.oldName) m.author = data.newName; });
                for (let [clientWs, p] of activeClients.entries()) {
                    if (p === data.oldName) {
                        activeClients.set(clientWs, data.newName);
                        clientWs.send(JSON.stringify({ type: 'renamed', newName: data.newName }));
                    }
                }
            }
            if (data.action === 'ban' && users[data.target]) {
                users[data.target].banned = !users[data.target].banned;
            }
            ws.send(JSON.stringify({ type: 'admin_data', users: users, history: history }));
        }
    });

    ws.on('close', () => {
        const pseudo = activeClients.get(ws);
        if (pseudo) {
            activeClients.delete(ws);
            broadcast({ type: 'system', text: `${pseudo} a quitté la discussion.` });
        }
    });
});

server.listen(3000, '0.0.0.0', () => console.log('Serveur actif sur http://localhost:3000'));
