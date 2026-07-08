document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const joinBtn = document.getElementById('joinBtn');
  const codeInput = document.getElementById('codeInput');

  function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  startBtn.addEventListener('click', () => {
    const code = generateCode();
    window.location.href = `/share/${code}`;
  });

  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      alert('Please enter a valid 6-character meeting code (letters and numbers).');
      return;
    }
    window.location.href = `/view/${code}`;
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
});
