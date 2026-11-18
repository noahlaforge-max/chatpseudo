const http = require('http');
const fs = require('fs');

const ADMIN_CODE = "9999";

let users = {}; // { pseudo: { code: "1234", ip: "...", banned: false } }
let history = []; // Historique complet pour l'admin
let liveFeed = []; // Flux temps réel (messages, système, appels)

const server = http.createServer((req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Servir la page HTML
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync('index.html'));
    }

    // Toutes les actions passent par /api en POST
    if (req.method === 'POST' && req.url === '/api') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });

                // 1. Connexion / Création de compte
                if (data.type === 'login') {
                    const { pseudo, code } = data;
                    if (!pseudo || !code) return res.end(JSON.stringify({ ok: false, msg: 'Champs manquants.' }));

                    if (users[pseudo]) {
                        if (users[pseudo].banned) return res.end(JSON.stringify({ ok: false, msg: 'Compte banni.' }));
                        if (users[pseudo].code !== code) return res.end(JSON.stringify({ ok: false, msg: 'Code secret incorrect.' }));
                        users[pseudo].ip = clientIp;
                    } else {
                        users[pseudo] = { code: code, ip: clientIp, banned: false };
                    }

                    const eventId = Date.now() + Math.random();
                    liveFeed.push({ id: eventId, kind: 'system', text: `${pseudo} a rejoint la messagerie.` });
                    if (liveFeed.length > 100) liveFeed.shift();

                    return res.end(JSON.stringify({ ok: true, pseudo: pseudo, lastEventId: eventId }));
                }

                // 2. Synchronisation (Poll toutes les 1.5s)
                if (data.type === 'sync') {
                    const { pseudo, sinceId } = data;
                    if (users[pseudo]?.banned) return res.end(JSON.stringify({ banned: true }));
                    const newEvents = liveFeed.filter(e => e.id > sinceId);
                    return res.end(JSON.stringify({ events: newEvents, currentName: pseudo }));
                }

                // 3. Envoi message, photo ou vidéo
                if (data.type === 'message') {
                    const { author, msgType, content } = data;
                    if (!author || users[author]?.banned) return res.end(JSON.stringify({ ok: false }));

                    const msgObj = {
                        id: Date.now() + Math.random(),
                        kind: 'message',
                        author: author,
                        ip: users[author].ip,
                        msgType: msgType,
                        content: content,
                        time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    };
                    history.push(msgObj);
                    liveFeed.push(msgObj);
                    if (liveFeed.length > 100) liveFeed.shift();
                    return res.end(JSON.stringify({ ok: true }));
                }

                // 4. Signalisation Appels Audio / Visio
                if (data.type === 'webrtc') {
                    const eventObj = { id: Date.now() + Math.random(), kind: 'webrtc', ...data };
                    liveFeed.push(eventObj);
                    if (liveFeed.length > 100) liveFeed.shift();
                    return res.end(JSON.stringify({ ok: true }));
                }

                // 5. Console Administrateur (/admin)
                if (data.type === 'admin_auth') {
                    if (data.code === ADMIN_CODE) {
                        return res.end(JSON.stringify({ ok: true, users: users, history: history }));
                    }
                    return res.end(JSON.stringify({ ok: false, msg: 'Code Admin invalide !' }));
                }

                if (data.type === 'admin_action' && data.code === ADMIN_CODE) {
                    if (data.action === 'rename' && users[data.oldName] && !users[data.newName]) {
                        users[data.newName] = users[data.oldName];
                        delete users[data.oldName];
                        history.forEach(m => { if (m.author === data.oldName) m.author = data.newName; });
                        liveFeed.push({ id: Date.now() + Math.random(), kind: 'rename', oldName: data.oldName, newName: data.newName });
                    }
                    if (data.action === 'ban' && users[data.target]) {
                        users[data.target].banned = !users[data.target].banned;
                    }
                    return res.end(JSON.stringify({ ok: true, users: users, history: history }));
                }

            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false }));
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur HTTP actif sur le port ' + PORT));
