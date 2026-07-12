const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
const rooms = new Map();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'display-capture=(self), fullscreen=(self)',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/share/:code', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'share.html')));
app.get('/view/:code', (_req, res) => res.sendFile(path.join(__dirname, 'views', 'view.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/rtc-config', (_req, res) => {
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (process.env.ICE_SERVERS) {
    try {
      const configured = JSON.parse(process.env.ICE_SERVERS);
      if (Array.isArray(configured) && configured.length) iceServers = configured;
    } catch (error) {
      console.error('ICE_SERVERS must be a JSON array:', error.message);
    }
  }
  res.set('Cache-Control', 'no-store').json({ iceServers });
});

function validCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{6,12}$/.test(code);
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function leave(ws) {
  if (!ws.code) return;
  const room = rooms.get(ws.code);
  if (!room) return;
  if (ws.role === 'share' && room.sharer === ws) {
    room.sharer = null;
    for (const viewer of room.viewers.values()) send(viewer, { type: 'sharer-left' });
  } else if (ws.role === 'view' && room.viewers.delete(ws.id)) {
    send(room.sharer, { type: 'viewer-left', viewerId: ws.id });
  }
  if (!room.sharer && room.viewers.size === 0) rooms.delete(ws.code);
  ws.code = null;
  ws.role = null;
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomBytes(12).toString('hex');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message' }); }

    if (data.type === 'join') {
      const code = String(data.code || '').toUpperCase();
      if (!validCode(code) || !['share', 'view'].includes(data.role)) return send(ws, { type: 'error', message: 'Invalid room request' });
      leave(ws);
      let room = rooms.get(code);
      if (!room) { room = { sharer: null, viewers: new Map() }; rooms.set(code, room); }
      if (data.role === 'share') {
        if (room.sharer && room.sharer.readyState === WebSocket.OPEN) return send(ws, { type: 'error', message: 'This room already has a sharer' });
        ws.role = 'share'; ws.code = code; room.sharer = ws;
        send(ws, { type: 'joined', role: 'share', viewerCount: room.viewers.size });
        for (const viewerId of room.viewers.keys()) send(ws, { type: 'viewer-joined', viewerId });
      } else {
        ws.role = 'view'; ws.code = code; room.viewers.set(ws.id, ws);
        send(ws, { type: 'joined', role: 'view' });
        room.sharer ? send(room.sharer, { type: 'viewer-joined', viewerId: ws.id }) : send(ws, { type: 'sharer-unavailable' });
      }
      return;
    }

    if (!ws.code || !ws.role) return send(ws, { type: 'error', message: 'Join a room first' });
    const room = rooms.get(ws.code);
    if (!room) return;
    if (data.type === 'offer' && ws.role === 'share' && typeof data.viewerId === 'string') {
      send(room.viewers.get(data.viewerId), { type: 'offer', sdp: data.sdp });
    } else if (data.type === 'answer' && ws.role === 'view') {
      send(room.sharer, { type: 'answer', sdp: data.sdp, viewerId: ws.id });
    } else if (data.type === 'ice-candidate') {
      if (ws.role === 'share') send(room.viewers.get(data.viewerId), { type: 'ice-candidate', candidate: data.candidate });
      else send(room.sharer, { type: 'ice-candidate', candidate: data.candidate, viewerId: ws.id });
    } else if (data.type === 'stop-share' && ws.role === 'share') {
      for (const viewer of room.viewers.values()) send(viewer, { type: 'share-stopped' });
    } else if (data.type === 'resume-share' && ws.role === 'share') {
      for (const viewerId of room.viewers.keys()) send(ws, { type: 'viewer-joined', viewerId });
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);
heartbeat.unref();

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Screen share listening on http://localhost:${PORT}`));

module.exports = { app, server };
