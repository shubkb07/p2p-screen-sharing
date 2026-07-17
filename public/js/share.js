(async function () {
  const code = location.pathname.split('/').pop().toUpperCase();
  const localVideo = document.getElementById('localVideo');
  const overlay = document.getElementById('blackOverlay');
  const stopBtn = document.getElementById('stopBtn');
  const shareBtn = document.getElementById('resumeShareBtn');
  const copyBtn = document.getElementById('copyBtn');
  const status = document.getElementById('shareStatus');
  const viewerCount = document.getElementById('viewerCount');
  const audioInput = document.getElementById('shareAudio');
  document.getElementById('codeText').textContent = code;

  let stream = null;
  let ws = null;
  let reconnectTimer = null;
  let stopped = false;
  let rtcConfig = { iceServers: [] };
  const peers = new Map();
  const pendingIce = new Map();
  const MAX_VIDEO_BITRATE = 45_000_000;
  const MAX_VIDEO_FRAMERATE = 60;

  try { rtcConfig = await fetch('/api/rtc-config').then((r) => r.json()); } catch { status.textContent = 'Could not load network configuration'; }

  function send(message) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
  function updateCount() { viewerCount.textContent = `${peers.size} viewer${peers.size === 1 ? '' : 's'}`; }
  function closePeer(id) { peers.get(id)?.close(); peers.delete(id); pendingIce.delete(id); updateCount(); }

  function preferScreenShareCodecs(transceiver) {
    if (!transceiver?.setCodecPreferences || !RTCRtpSender.getCapabilities) return;
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
    const order = ['video/VP9', 'video/AV1', 'video/H264', 'video/VP8'];
    const ranked = codecs.slice().sort((a, b) => {
      const aRank = order.indexOf(a.mimeType);
      const bRank = order.indexOf(b.mimeType);
      return (aRank < 0 ? order.length : aRank) - (bRank < 0 ? order.length : bRank);
    });
    try { transceiver.setCodecPreferences(ranked); } catch (error) { console.warn('Could not set codec preference', error); }
  }

  async function optimizeVideoSender(sender) {
    if (!sender || sender.track?.kind !== 'video') return;
    const parameters = sender.getParameters();
    parameters.degradationPreference = 'maintain-resolution';
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    Object.assign(parameters.encodings[0], {
      // This is a quality ceiling, not a fixed rate. WebRTC's congestion
      // controller automatically sends less when the connection needs it.
      maxBitrate: MAX_VIDEO_BITRATE,
      maxFramerate: MAX_VIDEO_FRAMERATE,
      scaleResolutionDownBy: 1,
    });
    try { await sender.setParameters(parameters); } catch (error) { console.warn('Could not apply high-quality sender settings', error); }
  }

  async function offer(id) {
    if (!stream || !id) return;
    closePeer(id);
    const pc = new RTCPeerConnection(rtcConfig);
    peers.set(id, pc); updateCount();
    const senders = stream.getTracks().map((track) => {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') preferScreenShareCodecs(pc.getTransceivers().find((item) => item.sender === sender));
      return sender;
    });
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ type: 'ice-candidate', candidate, viewerId: id }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) closePeer(id);
      else if (pc.connectionState === 'connected') status.textContent = 'Sharing securely';
    };
    await Promise.all(senders.map(optimizeVideoSender));
    await pc.setLocalDescription(await pc.createOffer());
    send({ type: 'offer', sdp: pc.localDescription, viewerId: id });
  }

  async function onMessage(event) {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    try {
      if (data.type === 'viewer-joined') await offer(data.viewerId);
      else if (data.type === 'answer') {
        const pc = peers.get(data.viewerId); if (!pc) return;
        await pc.setRemoteDescription(data.sdp);
        for (const candidate of pendingIce.get(data.viewerId) || []) await pc.addIceCandidate(candidate);
        pendingIce.delete(data.viewerId);
      } else if (data.type === 'ice-candidate') {
        const pc = peers.get(data.viewerId); if (!pc) return;
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingIce.set(data.viewerId, [...(pendingIce.get(data.viewerId) || []), data.candidate]);
      } else if (data.type === 'viewer-left') closePeer(data.viewerId);
      else if (data.type === 'error') status.textContent = data.message;
    } catch (error) { console.error('Signaling error', error); status.textContent = 'Connection negotiation failed'; }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { status.textContent = stream ? 'Ready for viewers' : 'Choose a screen to begin'; send({ type: 'join', role: 'share', code }); };
    ws.onmessage = onMessage;
    ws.onclose = () => { if (!stopped) { status.textContent = 'Reconnecting…'; reconnectTimer = setTimeout(connect, 1500); } };
  }

  async function startShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) { status.textContent = 'Screen sharing is not supported by this browser'; return; }
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: MAX_VIDEO_FRAMERATE, max: MAX_VIDEO_FRAMERATE },
          width: { ideal: 3840, max: 3840 },
          height: { ideal: 2160, max: 2160 },
          displaySurface: 'monitor',
          logicalSurface: true,
        },
        audio: Boolean(audioInput.checked),
      });
      stopShare(false);
      stream = next; localVideo.srcObject = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if ('contentHint' in videoTrack) videoTrack.contentHint = 'detail';
      localVideo.hidden = false; overlay.hidden = true; stopBtn.disabled = false;
      videoTrack.addEventListener('ended', () => stopShare(true), { once: true });
      status.textContent = 'Ready for viewers'; send({ type: 'resume-share' });
    } catch (error) {
      status.textContent = error.name === 'NotAllowedError' ? 'Screen selection was cancelled' : `Could not share: ${error.message}`;
    }
  }

  function stopShare(notify = true) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null; localVideo.srcObject = null; localVideo.hidden = true;
    overlay.hidden = false; stopBtn.disabled = true;
    [...peers.keys()].forEach(closePeer);
    status.textContent = 'Sharing stopped'; if (notify) send({ type: 'stop-share' });
  }

  shareBtn.addEventListener('click', startShare);
  stopBtn.addEventListener('click', () => stopShare(true));
  copyBtn.addEventListener('click', async () => {
    const link = `${location.origin}/view/${code}`;
    try { await navigator.clipboard.writeText(link); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy viewer link'; }, 1500); }
    catch { window.prompt('Copy this link:', link); }
  });
  addEventListener('beforeunload', () => { stopped = true; clearTimeout(reconnectTimer); stream?.getTracks().forEach((track) => track.stop()); });
  connect();
})();
