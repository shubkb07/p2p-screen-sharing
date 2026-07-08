(function () {
  const code = window.location.pathname.split('/').pop().toUpperCase();
  const remoteVideo = document.getElementById('remoteVideo');
  const statusMessage = document.getElementById('statusMessage');
  const endCallBar = document.getElementById('endCallBar');
  const endCallBtn = document.getElementById('endCallBtn');

  let ws = null;
  let pc = null;
  let myViewerId = null;

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', role: 'view', code }));
    });

    ws.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'offer':
          myViewerId = data.viewerId;
          await handleOffer(data.sdp);
          break;
        case 'ice-candidate':
          if (pc && data.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              /* ignore */
            }
          }
          break;
        case 'share-stopped':
          showStatus('The sharer stopped sharing.');
          clearVideo();
          break;
        case 'sharer-left':
          showStatus('The sharer has left.');
          clearVideo();
          break;
        case 'sharer-unavailable':
          showStatus('Waiting for the sharer to start...');
          break;
      }
    });

    ws.addEventListener('close', () => {
      showStatus('Connection lost. Reconnecting...');
      setTimeout(connectWS, 2000);
    });
  }

  async function handleOffer(sdp) {
    if (pc) pc.close();
    pc = new RTCPeerConnection(rtcConfig);

    pc.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
      hideStatus();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
  }

  function clearVideo() {
    remoteVideo.srcObject = null;
    if (pc) {
      pc.close();
      pc = null;
    }
  }

  function showStatus(msg) {
    statusMessage.textContent = msg;
    statusMessage.style.display = 'block';
  }
  function hideStatus() {
    statusMessage.style.display = 'none';
  }

  endCallBtn.addEventListener('click', () => {
    clearVideo();
    if (ws) ws.close();
    window.location.href = '/';
  });

  // Auto-hide the End Call bar after 5s of no mouse/touch activity
  let hideTimeout = null;
  function showControls() {
    endCallBar.classList.add('visible');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      endCallBar.classList.remove('visible');
    }, 5000);
  }

  document.addEventListener('mousemove', showControls);
  document.addEventListener('touchstart', showControls);
  showControls();

  connectWS();
})();
