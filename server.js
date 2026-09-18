const { TelegramClient } = require('gramjs');
const { StringSession } = require('gramjs/sessions');
const express = require('express');

const app = express();
app.use(express.static('public'));

// Сюда свои api_id, api_hash и session (можно получить на my.telegram.org)
const apiId = 123456;
const apiHash = 'твой_api_hash';
const session = new StringSession(''); // если сессии нет — оставь пустым

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

// Подключаемся ПРИ СТАРТЕ
(async () => {
  await client.connect();
  console.log('[+] Telegram client connected');
})();

app.get('/send', async (req, res) => {
  const { chatId, message } = req.query;
  if (!chatId || !message) {
    return res.status(400).json({ error: 'chatId и message обязательны' });
  }

  try {
    // Гарантируем подключение перед отправкой
    if (!client.connected) {
      await client.connect();
    }

    await client.sendMessage(chatId, { message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => console.log('[+] Веб-сервер на http://localhost:3000'));
