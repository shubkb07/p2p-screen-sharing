const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/share/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'share.html'));
});

app.get('/view/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'view.html'));
});

// ---------- Room / Signaling state ----------
// rooms: Map<code, { sharer: WebSocket|null, viewers: Map<viewerId, WebSocket> }>
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { sharer: null, viewers: new Map() });
  }
  return rooms.get(code);
}

function cleanupRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (room && !room.sharer && room.viewers.size === 0) {
    rooms.delete(code);
  }
}

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {
  ws.id = genId();
  ws.role = null; // 'share' | 'view'
  ws.code = null;

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }

    switch (data.type) {
      // A client (sharer or viewer) joins a room
      case 'join': {
        const { role, code } = data;
        if (!code || !/^[A-Z0-9]{6}$/.test(code)) {
          safeSend(ws, { type: 'error', message: 'Invalid meeting code' });
          return;
        }

        ws.role = role;
        ws.code = code;
        const room = getRoom(code);

        if (role === 'share') {
          room.sharer = ws;
          // Tell the sharer about viewers who are already waiting
          for (const viewerId of room.viewers.keys()) {
            safeSend(ws, { type: 'viewer-joined', viewerId });
          }
        } else if (role === 'view') {
          ws.viewerId = ws.id;
          room.viewers.set(ws.id, ws);
          if (room.sharer) {
            safeSend(room.sharer, { type: 'viewer-joined', viewerId: ws.id });
          } else {
            safeSend(ws, { type: 'sharer-unavailable' });
          }
        }
        break;
      }

      // Sharer -> specific viewer
      case 'offer': {
        const room = rooms.get(ws.code);
        if (!room) return;
        const viewerWs = room.viewers.get(data.viewerId);
        safeSend(viewerWs, { type: 'offer', sdp: data.sdp, viewerId: data.viewerId });
        break;
      }

      // Viewer -> sharer
      case 'answer': {
        const room = rooms.get(ws.code);
        if (!room) return;
        safeSend(room.sharer, { type: 'answer', sdp: data.sdp, viewerId: ws.viewerId });
        break;
      }

      // Either side -> the other side of a specific pair
      case 'ice-candidate': {
        const room = rooms.get(ws.code);
        if (!room) return;
        if (ws.role === 'share') {
          const viewerWs = room.viewers.get(data.viewerId);
          safeSend(viewerWs, { type: 'ice-candidate', candidate: data.candidate, viewerId: data.viewerId });
        } else if (ws.role === 'view') {
          safeSend(room.sharer, { type: 'ice-candidate', candidate: data.candidate, viewerId: ws.viewerId });
        }
        break;
      }

      // Sharer paused sharing -> tell all viewers
      case 'stop-share': {
        const room = rooms.get(ws.code);
        if (!room) return;
        for (const viewerWs of room.viewers.values()) {
          safeSend(viewerWs, { type: 'share-stopped' });
        }
        break;
      }

      // Sharer resumed sharing -> re-trigger offer flow for existing viewers
      case 'resume-share': {
        const room = rooms.get(ws.code);
        if (!room) return;
        for (const viewerId of room.viewers.keys()) {
          safeSend(ws, { type: 'viewer-joined', viewerId });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;

    if (ws.role === 'share' && room.sharer === ws) {
      room.sharer = null;
      for (const viewerWs of room.viewers.values()) {
        safeSend(viewerWs, { type: 'sharer-left' });
      }
    } else if (ws.role === 'view') {
      room.viewers.delete(ws.id);
      if (room.sharer) {
        safeSend(room.sharer, { type: 'viewer-left', viewerId: ws.id });
      }
    }

    cleanupRoomIfEmpty(ws.code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
