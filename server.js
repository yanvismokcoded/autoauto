const express = require('express');
const path = require('path');
const fs = require('fs');
const { TelegramClient } = require('gramjs');
const { StringSession } = require('gramjs/sessions');
const { Api } = require('gramjs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {
      settings: { votes: 21, frequency: 10, copyPaste: '' },
      channelId: null,
      pendingChannel: false
    };
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
let db = readData();

const apiId = Number(process.env.API_ID || 0);
const apiHash = process.env.API_HASH || '';
const savedSession = process.env.STRING_SESSION || '';

let client = null;
let authState = null;

async function startClient() {
  if (!apiId || !apiHash) {
    console.error('Задай API_ID и API_HASH в переменных окружения');
    return;
  }

  const stringSession = new StringSession(savedSession);
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  if (savedSession) {
    await client.connect();
    const me = await client.getMe();
    console.log('Авторизован как', me.username || me.phone);
    setupHandler();
  } else {
    console.log('Нет сессии. Авторизация через /auth');
  }
}

function setupHandler() {
  client.addEventHandler(async (event) => {
    if (event.className !== 'NewMessage') return;

    const msg = event.message;
    const text = msg.text || '';
    const chatId = msg.chatId;

    // Личные сообщения (избранное) — команды владельца
    if (msg.isPrivate && msg.out) {
      if (text.startsWith('/setchannel')) {
        db.pendingChannel = true;
        writeData(db);
        await client.sendMessage('me', { message: 'Перешли мне сообщение из канала.' });
        return;
      }

      if (msg.fwdFrom && db.pendingChannel) {
        const fromId = msg.fwdFrom.fromId;
        if (fromId) {
          if (fromId.className === 'PeerChannel') db.channelId = fromId.channelId;
          else if (fromId.className === 'PeerChat') db.channelId = fromId.chatId;
          db.pendingChannel = false;
          writeData(db);
          await client.sendMessage('me', { message: 'Канал установлен ✅' });
          return;
        }
      }

      if (!text.startsWith('/')) {
        db.settings.copyPaste = text;
        writeData(db);
        await client.sendMessage('me', { message: 'Копипаста сохранена ✅' });
        return;
      }
    }

    // Групповые чаты
    if (msg.isGroup) {
      const reportKeywords = ['готово', 'сделал', 'тапнул', 'выполнил', 'отправил', 'голоса', 'вз выполнен', 'сделано'];
      const wzKeywords = ['вз', 'взаимка', 'взаимные', 'ищу', 'обмен', 'голоса'];
      const lower = text.toLowerCase();

      if (reportKeywords.some(kw => lower.includes(kw))) {
        if (db.channelId) {
          try {
            await client.forwardMessages(db.channelId, { fromPeer: chatId, id: [msg.id] });
            console.log('Отчёт переслан в канал');
          } catch (e) {
            console.error('Не удалось переслать отчёт:', e);
          }
        }
      }

      if (wzKeywords.some(kw => lower.includes(kw)) && db.settings.copyPaste) {
        const delay = (db.settings.frequency || 10) * 1000;
        setTimeout(async () => {
          try {
            await client.sendMessage(chatId, { message: db.settings.copyPaste });
          } catch (e) {
            console.error('Ошибка отправки копипасты:', e);
          }
        }, delay);
      }
    }
  });
}

// API для мини-аппа
app.get('/api/settings', (req, res) => {
  res.json(db.settings);
});

app.post('/api/settings', (req, res) => {
  const { votes, frequency, copyPaste } = req.body;
  if (votes !== undefined) db.settings.votes = parseInt(votes) || 21;
  if (frequency !== undefined) db.settings.frequency = parseInt(frequency) || 10;
  if (copyPaste !== undefined) db.settings.copyPaste = copyPaste;
  writeData(db);
  res.json({ ok: true });
});

// Веб-авторизация
app.get('/auth', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Авторизация</title>
    </head>
    <body style="font-family:sans-serif;background:#0e1621;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
      <div style="background:#17212b;padding:30px;border-radius:12px;max-width:350px;width:100%">
        <h2>Вход в аккаунт</h2>
        <form id="form">
          <input id="phone" placeholder="+79991234567" style="width:100%;padding:10px;margin-bottom:10px;border-radius:8px;border:1px solid #2b3d4e;background:#0e1621;color:#fff">
          <button type="submit" style="width:100%;padding:12px;background:#2ea6ff;border:none;border-radius:8px;color:#fff;font-size:16px;cursor:pointer">Отправить код</button>
        </form>
        <div id="confirm" style="display:none;margin-top:10px">
          <input id="code" placeholder="Код из Telegram" style="width:100%;padding:10px;margin-bottom:10px;border-radius:8px;border:1px solid #2b3d4e;background:#0e1621;color:#fff">
          <button id="confirmBtn" style="width:100%;padding:12px;background:#4caf50;border:none;border-radius:8px;color:#fff;font-size:16px;cursor:pointer">Подтвердить</button>
        </div>
        <div id="status"></div>
      </div>
      <script>
        const form = document.getElementById('form');
        const confirmDiv = document.getElementById('confirm');
        const statusDiv = document.getElementById('status');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const phone = document.getElementById('phone').value;
          const res = await fetch('/auth/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ phone })
          });
          const data = await res.json();
          if (data.ok) {
            confirmDiv.style.display = 'block';
            statusDiv.textContent = 'Код отправлен. Введи его ниже.';
          } else {
            statusDiv.textContent = 'Ошибка: ' + data.error;
          }
        });
        document.getElementById('confirmBtn').addEventListener('click', async () => {
          const phone = document.getElementById('phone').value;
          const code = document.getElementById('code').value;
          const res = await fetch('/auth/confirm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ phone, code })
          });
          const data = await res.json();
          if (data.ok) {
            statusDiv.textContent = '✅ Авторизован! Скопируй сессию:';
            const sessionDiv = document.createElement('div');
            sessionDiv.textContent = data.sessionString;
            sessionDiv.style.wordBreak = 'break-all';
            sessionDiv.style.fontSize = '12px';
            sessionDiv.style.background = '#1e2c3a';
            sessionDiv.style.padding = '10px';
            sessionDiv.style.borderRadius = '8px';
            sessionDiv.style.marginTop = '10px';
            statusDiv.appendChild(sessionDiv);
          } else {
            statusDiv.textContent = 'Ошибка: ' + data.error;
          }
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/auth/start', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!client) {
      const stringSession = new StringSession('');
      client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
      await client.connect();
    }
    const result = await client.sendCode({ phoneNumber: phone }, apiId, apiHash);
    authState = { phone, phoneCodeHash: result.phoneCodeHash };
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/auth/confirm', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!authState || authState.phone !== phone) {
      return res.json({ ok: false, error: 'Сначала отправь код' });
    }
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash: authState.phoneCodeHash,
      phoneCode: code
    }));
    const sessionString = client.session.save();
    fs.writeFileSync('session.txt', sessionString);
    console.log('STRING_SESSION:', sessionString);
    setupHandler();
    res.json({ ok: true, sessionString });
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return res.json({ ok: false, error: 'Включена 2FA. Добавь поддержку пароля или отключи 2FA.' });
    }
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Сервер запущен на порту', PORT);
  try {
    await startClient();
  } catch (e) {
    console.error('Ошибка запуска клиента:', e);
  }
});
