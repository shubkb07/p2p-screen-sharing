(function () {
  const code = window.location.pathname.split('/').pop().toUpperCase();
  document.getElementById('codeText').textContent = code;

  const localVideo = document.getElementById('localVideo');
  const blackOverlay = document.getElementById('blackOverlay');
  const stopBtn = document.getElementById('stopBtn');
  const resumeShareBtn = document.getElementById('resumeShareBtn');
  const copyBtn = document.getElementById('copyBtn');

  let localStream = null;
  let ws = null;
  const peers = new Map(); // viewerId -> RTCPeerConnection

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', role: 'share', code }));
    });

    ws.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'viewer-joined':
          await createOfferForViewer(data.viewerId);
          break;
        case 'answer':
          await handleAnswer(data.viewerId, data.sdp);
          break;
        case 'ice-candidate':
          await handleRemoteIce(data.viewerId, data.candidate);
          break;
        case 'viewer-left':
          closePeer(data.viewerId);
          break;
      }
    });

    ws.addEventListener('close', () => {
      setTimeout(connectWS, 2000);
    });
  }

  async function createOfferForViewer(viewerId) {
    if (!localStream) return; // nothing to share yet, ignore until sharing starts

    closePeer(viewerId);
    const pc = new RTCPeerConnection(rtcConfig);
    peers.set(viewerId, pc);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate, viewerId }));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', sdp: offer, viewerId }));
  }

  async function handleAnswer(viewerId, sdp) {
    const pc = peers.get(viewerId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async function handleRemoteIce(viewerId, candidate) {
    const pc = peers.get(viewerId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        /* ignore */
      }
    }
  }

  function closePeer(viewerId) {
    const pc = peers.get(viewerId);
    if (pc) {
      pc.close();
      peers.delete(viewerId);
    }
  }

  async function startShare() {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      localVideo.srcObject = localStream;
      blackOverlay.style.display = 'none';
      localVideo.style.display = 'block';

      // Fires when the user stops sharing via the browser's own UI
      localStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopShare();
      });

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resume-share' }));
      }
    } catch (err) {
      console.error('Error starting screen share', err);
    }
  }

  function stopShare() {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    localVideo.srcObject = null;
    localVideo.style.display = 'none';
    blackOverlay.style.display = 'flex';

    peers.forEach((pc) => pc.close());
    peers.clear();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop-share' }));
    }
  }

  stopBtn.addEventListener('click', stopShare);
  resumeShareBtn.addEventListener('click', startShare);

  copyBtn.addEventListener('click', () => {
    const link = `${window.location.origin}/view/${code}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = original), 1500);
      })
      .catch(() => {
        prompt('Copy this link:', link);
      });
  });

  window.addEventListener('beforeunload', () => {
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
  });

  connectWS();
  startShare();
})();
