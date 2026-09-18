const votesInput = document.getElementById('votes');
const frequencyInput = document.getElementById('frequency');
const copyPasteTextarea = document.getElementById('copyPaste');
const minusVotes = document.getElementById('minusVotes');
const plusVotes = document.getElementById('plusVotes');
const minusFreq = document.getElementById('minusFreq');
const plusFreq = document.getElementById('plusFreq');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');

// Загрузка настроек
fetch('/api/settings')
  .then(res => res.json())
  .then(data => {
    votesInput.value = data.votes || 21;
    frequencyInput.value = data.frequency || 10;
    copyPasteTextarea.value = data.copyPaste || '';
  });

// Степперы
minusVotes.addEventListener('click', () => {
  votesInput.value = Math.max(1, parseInt(votesInput.value) - 1);
});
plusVotes.addEventListener('click', () => {
  votesInput.value = Math.min(100, parseInt(votesInput.value) + 1);
});
minusFreq.addEventListener('click', () => {
  frequencyInput.value = Math.max(1, parseInt(frequencyInput.value) - 1);
});
plusFreq.addEventListener('click', () => {
  frequencyInput.value = Math.min(300, parseInt(frequencyInput.value) + 1);
});

// Сохранение
saveBtn.addEventListener('click', async () => {
  const payload = {
    votes: parseInt(votesInput.value),
    frequency: parseInt(frequencyInput.value),
    copyPaste: copyPasteTextarea.value
  };
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    statusDiv.textContent = '✅ Настройки сохранены';
    setTimeout(() => statusDiv.textContent = '', 2000);
  } else {
    statusDiv.textContent = '❌ Ошибка сохранения';
  }
});
