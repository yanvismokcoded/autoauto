const { TelegramClient } = require('gramjs');
const { StringSession } = require('gramjs/sessions');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.static('public'));
app.use(express.json());

const apiId = 123456; // замени на свой
const apiHash = 'твой_api_hash'; // замени на свой

const SESSION_FILE = 'session.txt';
let client = null;
let sessionString = '';

// Загружаем сессию при старте
if (fs.existsSync(SESSION_FILE)) {
  sessionString = fs.readFileSync(SESSION_FILE, 'utf8').trim();
}

function getClient() {
  if (!client) {
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 5,
    });
  }
  return client;
}

// ==== АВТОРИЗАЦИЯ ====

// Шаг 1: отправка кода на телефон
app.get('/auth', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) {
    return res.status(400).json({ error: 'Укажи ?phone=номер' });
  }

  try {
    const c = getClient();
    await c.connect();
    const result = await c.sendCode(phone);
    // Сохраняем phone в глобальной переменной, чтобы использовать на шаге 2
    global.pendingPhone = phone;
    global.phoneCodeHash = result.phoneCodeHash;
    res.json({ ok: true, message: 'Код отправлен' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Шаг 2: подтверждение кода
app.get('/auth/confirm', async (req, res) => {
  const code = req.query.code;
  if (!code || !global.pendingPhone) {
    return res.status(400).json({ error: 'Сначала вызови /auth?phone=...' });
  }

  try {
    const c = getClient();
    await c.connect();
    await c.invoke({
      _: 'auth.signIn',
      phoneNumber: global.pendingPhone,
      phoneCodeHash: global.phoneCodeHash,
      phoneCode: code,
    });

    // Сохраняем сессию
    sessionString = c.session.save();
    fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
    global.pendingPhone = null;

    res.json({ ok: true, message: 'Авторизация успешна' });
  } catch (e) {
    // Если пароль (2FA) — запросить отдельно
    if (e.message.includes('TwoFactor')) {
      res.status(400).json({ error: 'Требуется пароль: /auth/password?password=...' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Шаг 3 (если включена 2FA)
app.get('/auth/password', async (req, res) => {
  const password = req.query.password;
  if (!password || !global.pendingPhone) {
    return res.status(400).json({ error: 'Сначала /auth?phone=...' });
  }

  try {
    const c = getClient();
    await c.connect();
    await c.invoke({
      _: 'auth.checkPassword',
      password: { _: 'inputCheckPasswordSRP', srpId: 0, A: Buffer.alloc(0), M1: Buffer.alloc(0) },
    });

    sessionString = c.session.save();
    fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
    global.pendingPhone = null;

    res.json({ ok: true, message: 'Авторизация с 2FA успешна' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ОТПРАВКА СООБЩЕНИЙ ====

app.get('/send', async (req, res) => {
  const { chatId, message } = req.query;
  if (!chatId || !message) {
    return res.status(400).json({ error: 'chatId и message обязательны' });
  }

  try {
    const c = getClient();
    if (!c.connected) await c.connect();

    // Если сессия пустая — авторизация не пройдена
    if (!c.session.isAuthorized) {
      return res.status(401).json({ error: 'Не авторизован. Сначала /auth?phone=...' });
    }

    await c.sendMessage(chatId, { message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => console.log('[+] Сервер на http://localhost:3000'));