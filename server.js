const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.static('public'));
app.use(express.json());

const apiId = 32110255; // ЗАМЕНИ НА СВОЙ
const apiHash = '3f409cb35e20eb421b8818cd14751c91'; // ЗАМЕНИ НА СВОЙ

const SESSION_FILE = 'session.txt';
let client = null;
let sessionString = '';

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

// Шаг 1: отправка кода
app.get('/auth', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) {
    return res.status(400).json({ error: 'Укажи ?phone=номер' });
  }

  try {
    const c = getClient();
    await c.connect();
    const result = await c.sendCode({ apiId, apiHash }, phone);
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

    await c.invoke(new Api.auth.SignIn({
      phoneNumber: global.pendingPhone,
      phoneCodeHash: global.phoneCodeHash,
      phoneCode: code,
    }));

    sessionString = c.session.save();
    fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
    global.pendingPhone = null;

    res.json({ ok: true, message: 'Авторизация успешна' });
  } catch (e) {
    if (e.message.includes('TwoFactor') || e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      res.status(400).json({ error: 'Требуется пароль: /auth/password?password=...' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Шаг 3: 2FA
app.get('/auth/password', async (req, res) => {
  const password = req.query.password;
  if (!password || !global.pendingPhone) {
    return res.status(400).json({ error: 'Сначала /auth?phone=...' });
  }

  try {
    const c = getClient();
    await c.connect();

    const passwordInfo = await c.invoke(new Api.account.GetPassword({}));
    const srpCheck = await computeCheck(passwordInfo, password);

    await c.invoke(new Api.auth.CheckPassword({ password: srpCheck }));

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
    await c.connect();

    if (!(await c.isUserAuthorized())) {
      return res.status(401).json({ error: 'Не авторизован. Сначала /auth?phone=...' });
    }

    await c.sendMessage(chatId, message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ПОРТ ====

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[+] Сервер на порту ${PORT}`));
