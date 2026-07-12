document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const joinBtn = document.getElementById('joinBtn');
  const codeInput = document.getElementById('codeInput');

  function generateCode(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
  }

  startBtn.addEventListener('click', () => { window.location.href = `/share/${generateCode()}`; });
  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) {
      codeInput.setCustomValidity('Enter a 6–12 character code.');
      codeInput.reportValidity();
      return;
    }
    window.location.href = `/view/${code}`;
  });
  codeInput.addEventListener('input', () => {
    codeInput.setCustomValidity('');
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  });
  codeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinBtn.click(); });
});
