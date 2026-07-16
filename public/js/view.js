(async function () {
  const code = location.pathname.split('/').pop().toUpperCase();
  const video = document.getElementById('remoteVideo');
  const status = document.getElementById('statusMessage');
  const playbackPrompt = document.getElementById('playbackPrompt');
  const startPlaybackBtn = document.getElementById('startPlaybackBtn');
  const bar = document.getElementById('endCallBar');
  let ws = null, pc = null, reconnectTimer = null, hideTimer = null;
  let ended = false, pendingIce = [], rtcConfig = { iceServers: [] };
  let playbackStarted = false;
  try { rtcConfig = await fetch('/api/rtc-config').then((r) => r.json()); } catch { showStatus('Could not load network configuration'); }

  function send(message) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  function showStatus(message) { status.textContent = message; status.hidden = false; }
  function clearPeer() { pc?.close(); pc = null; pendingIce = []; video.srcObject = null; playbackPrompt.hidden = true; }

  async function startPlayback() {
    if (!video.srcObject) return;
    try {
      await video.play();
      playbackStarted = true;
      playbackPrompt.hidden = true;
      status.hidden = true;
    } catch (error) {
      if (error.name === 'NotAllowedError') playbackPrompt.hidden = false;
      else if (error.name !== 'AbortError') console.warn('Playback could not start', error);
    }
  }

  async function handleOffer(sdp) {
    clearPeer(); pc = new RTCPeerConnection(rtcConfig);
    pc.ontrack = ({ streams }) => {
      video.srcObject = streams[0];
      status.hidden = true;
      startPlayback();
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ type: 'ice-candidate', candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed') showStatus('Peer connection failed. Check TURN configuration or retry.');
      else if (pc?.connectionState === 'disconnected') showStatus('Connection interrupted…');
    };
    await pc.setRemoteDescription(sdp);
    for (const candidate of pendingIce) await pc.addIceCandidate(candidate);
    pendingIce = [];
    await pc.setLocalDescription(await pc.createAnswer());
    send({ type: 'answer', sdp: pc.localDescription });
  }

  async function onMessage(event) {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    try {
      if (data.type === 'offer') await handleOffer(data.sdp);
      else if (data.type === 'ice-candidate' && data.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate); else pendingIce.push(data.candidate);
      } else if (data.type === 'share-stopped') { clearPeer(); showStatus('The sharer stopped sharing. Waiting for them to resume…'); }
      else if (data.type === 'sharer-left') { clearPeer(); showStatus('The sharer disconnected. Waiting for reconnection…'); }
      else if (data.type === 'sharer-unavailable') showStatus('Waiting for the sharer to start…');
      else if (data.type === 'error') showStatus(data.message);
    } catch (error) { console.error('Signaling error', error); showStatus('Connection negotiation failed'); }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { showStatus('Waiting for the secure peer connection…'); send({ type: 'join', role: 'view', code }); };
    ws.onmessage = onMessage;
    ws.onclose = () => { if (!ended) { clearPeer(); showStatus('Signaling disconnected. Reconnecting…'); reconnectTimer = setTimeout(connect, 1500); } };
  }

  document.getElementById('endCallBtn').addEventListener('click', () => { ended = true; clearTimeout(reconnectTimer); clearPeer(); ws?.close(); location.href = '/'; });
  document.getElementById('fullscreenBtn').addEventListener('click', () => document.documentElement.requestFullscreen?.());
  startPlaybackBtn.addEventListener('click', startPlayback);
  video.addEventListener('pause', () => { if (playbackStarted && video.srcObject) startPlayback(); });
  function showControls() { bar.classList.add('visible'); clearTimeout(hideTimer); hideTimer = setTimeout(() => bar.classList.remove('visible'), 4000); }
  document.addEventListener('pointermove', showControls); document.addEventListener('pointerdown', showControls); showControls(); connect();
})();
