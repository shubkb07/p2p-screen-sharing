# P2P Screen Share

A small WebRTC screen-sharing app. Each viewer receives a direct encrypted media connection from the sharer; the Node server only relays signaling messages and never receives screen content.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. Create a room, click **Choose screen**, then send the viewer link. Screen capture works on localhost; public deployments must use HTTPS (and therefore secure WebSockets).

## Reliable internet connections (TURN)

STUN is enough for many networks, but it cannot connect peers behind some corporate, mobile, or symmetric NAT firewalls. For reliable use, run a TURN service such as coturn and provide its credentials:

```bash
ICE_SERVERS='[{"urls":["stun:turn.example.com:3478"]},{"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],"username":"user","credential":"secret"}]' npm start
```

TURN relays only when a direct connection is unavailable. WebRTC media remains DTLS-SRTP encrypted through the relay. Use short-lived TURN credentials in a public deployment.

## Security notes

- WebRTC mandates encrypted media (DTLS-SRTP). Neither the signaling server nor a TURN relay can decrypt it.
- Serve the app over HTTPS in production. Plain HTTP is suitable only for localhost development.
- Viewer links are bearer access to a room. Share them privately. New room codes use 40 bits of randomness and ambiguous characters are omitted.
- This is one-to-many P2P: the sharer's upload and CPU usage grows per viewer. For larger audiences, an SFU is the appropriate architecture.

Environment variables: `PORT` (default `3000`) and `ICE_SERVERS` (JSON array of `RTCIceServer` objects).
