const { Telegraf } = require('telegraf');
const { Api } = require('telegram');
const bigInt = require('big-integer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Все аргументы после команды: через пробел, запятую, ; или с новой строки
function parseArgs(ctx) {
  return ctx.message.text.split(/[\s,;]+/).slice(1).filter(Boolean);
}

// Автопост: границы частоты рассылки (в минутах)
const MIN_INTERVAL_MIN = 10;
const MAX_INTERVAL_MIN = 30 * 24 * 60;

// "30", "30м", "30 мин", "2ч", "2h", "1.5ч", "1д" -> минуты (или null)
function parseInterval(str) {
  const m = String(str || '').trim().toLowerCase().replace(',', '.')
    .match(/^(\d+(?:\.\d+)?)\s*(м|мин\S*|m|min\S*|ч|час\S*|h|hr|hour\S*|д|дн\S*|день|d|day\S*)?$/);
  if (!m) return null;
  const unit = m[2] || 'м';
  let mult = 1;
  if (/^(ч|час|h)/.test(unit)) mult = 60;
  else if (/^(д|дн|день|d)/.test(unit)) mult = 1440;
  const minutes = Math.round(parseFloat(m[1]) * mult);
  return minutes > 0 ? minutes : null;
}

// 90 -> "1 ч 30 мин", 1440 -> "1 д"
function fmtMinutes(total) {
  total = Math.max(0, Math.round(total));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts = [];
  if (d) parts.push(`${d} д`);
  if (h) parts.push(`${h} ч`);
  if (m || !parts.length) parts.push(`${m} мин`);
  return parts.join(' ');
}

// Telegram ограничивает сообщение 4096 символами — режем длинные ответы
async function replyLong(ctx, text) {
  const MAX = 4000;
  let rest = text;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf('\n', MAX);
    if (cut <= 0) cut = MAX;
    await ctx.reply(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) await ctx.reply(rest);
}

function setupBot(botToken, userbot, tapper, config, store, log) {
  const bot = new Telegraf(botToken);

  function ensureClient() {
    if (!userbot.client) throw new Error('Юзербот не подключён — сначала /login');
    return userbot.client;
  }

  // Вступает в чат (если нужно) и возвращает ссылку/id, которую храним в конфиге
  async function resolveChat(ref) {
    const client = ensureClient();
    const inviteMatch = ref.match(/(?:t\.me\/\+|t\.me\/joinchat\/)([\w-]+)/);
    console.log('resolveChat: ref=', ref, 'inviteMatch=', inviteMatch && inviteMatch[1]);
    if (!inviteMatch) {
      await client.getEntity(ref);
      return ref;
    }
    let chat;
    try {
      const res = await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteMatch[1] }));
      console.log('resolveChat: ImportChatInvite ok, chats=', res.chats);
      chat = res.chats && res.chats[0];
    } catch (e) {
      console.log('resolveChat: ImportChatInvite error:', e.errorMessage || e.message);
      if (e.errorMessage !== 'USER_ALREADY_PARTICIPANT') throw e;
      const info = await client.invoke(new Api.messages.CheckChatInvite({ hash: inviteMatch[1] }));
      console.log('resolveChat: CheckChatInvite result:', info);
      chat = info.chat;
    }
    if (!chat) throw new Error('Не удалось получить данные чата после вступления');
    const storeRef = chat.id.toString();
    console.log('resolveChat: resolved storeRef=', storeRef);
    return storeRef;
  }

  // Вступает в папку по ссылке t.me/addlist/... и возвращает { title, refs }
  async function importFolder(ref) {
    const client = ensureClient();
    const m = ref.match(/t\.me\/addlist\/([\w-]+)/);
    if (!m) throw new Error('Это не ссылка на папку (нужна t.me/addlist/...)');
    const slug = m[1];

    const info = await client.invoke(new Api.chatlists.CheckChatlistInvite({ slug }));
    const already = info.className === 'chatlists.ChatlistInviteAlready';
    const allPeers = already ? [...info.alreadyPeers, ...info.missingPeers] : info.peers;
    const toJoin = already ? info.missingPeers : info.peers;

    const byId = new Map(info.chats.map((c) => [c.id.toString(), c]));
    const peerId = (p) => (p.channelId ?? p.chatId ?? p.userId).toString();
    const toInputPeer = (p) => {
      const chat = byId.get(peerId(p));
      if (!chat) return null;
      if (p.className === 'PeerChannel') {
        return new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash });
      }
      if (p.className === 'PeerChat') return new Api.InputPeerChat({ chatId: chat.id });
      return null;
    };

    const inputPeers = toJoin.map(toInputPeer).filter(Boolean);
    if (inputPeers.length) {
      await client.invoke(new Api.chatlists.JoinChatlistInvite({ slug, peers: inputPeers }));
    }

    const refs = allPeers
      .filter((p) => p.className === 'PeerChannel' || p.className === 'PeerChat')
      .map(peerId);

    // id папки в аккаунте юзербота нужен, чтобы потом её удалить
    let filterId = already ? info.filterId : null;
    if (filterId == null) {
      const after = await client.invoke(new Api.chatlists.CheckChatlistInvite({ slug }));
      if (after.className === 'chatlists.ChatlistInviteAlready') filterId = after.filterId;
    }
    return { slug, title: info.title || slug, refs, filterId };
  }

  // Удаляет папку из аккаунта юзербота (сами чаты остаются, из них он не выходит)
  async function deleteFolderInAccount(filterId) {
    const client = ensureClient();
    await client.invoke(new Api.chatlists.LeaveChatlist({
      chatlist: new Api.InputChatlistDialogFilter({ filterId }),
      peers: []
    }));
  }

  function getFolders() {
    if (!Array.isArray(config.data.folders)) config.data.folders = [];
    return config.data.folders;
  }

  bot.start((ctx) => {
    ctx.reply(
      'VZ бот. Команды:\n' +
      '/login — авторизация\n' +
      '/code <код> — ввод кода\n' +
      '/password <пароль> — 2FA\n' +
      '/add_chat <ссылка> [ссылка ...] — добавить вз-чаты (можно несколько)\n' +
      '/add_folder <t.me/addlist/...> [...] — добавить все чаты из папки\n' +
      '/folders — список добавленных папок\n' +
      '/del_folder <номер|ссылка> — удалить папку и её чаты из вз-списка\n' +
      '/chats — список вз-чатов\n' +
      '/del_chat <ссылка> [ссылка ...] — удалить вз-чаты\n' +
      '/del_all_chats — удалить все вз-чаты (с подтверждением)\n' +
      '/add_channel <ссылка> [ссылка ...] — добавить каналы для тапов (можно несколько)\n' +
      '/channels — список каналов\n' +
      '/del_channel <ссылка> [ссылка ...] — удалить каналы\n' +
      '/create_channel <название> — создать канал\n' +
      '/post <текст> — разослать предложение по вз-чатам\n' +
      '/autopost — автопостинг: статус и настройка\n' +
      '/autopost_text <текст> — текст автопоста\n' +
      '/autopost_every <30м|2ч|1д> — частота\n' +
      '/autopost_on, /autopost_off — включить / выключить\n' +
      '/autopost_now — разослать один раз сейчас\n' +
      '/status — статус\n\n' +
      'Несколько ссылок можно писать через пробел или с новой строки.'
    );
  });

  bot.command('login', async (ctx) => {
    if (!config.data.phone) return ctx.reply('Укажи phone в config.json');
    try {
      await userbot.connect();
      await userbot.sendCode(config.data.phone);
      ctx.reply('Код отправлен. Введи: /code <код>');
    } catch (e) {
      console.error('login error:', e);
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command('code', async (ctx) => {
    const code = ctx.message.text.split(' ').slice(1).join('');
    if (!code) return ctx.reply('Формат: /code 12345');
    try {
      const res = await userbot.signIn(config.data.phone, code);
      if (res.twofa) return ctx.reply('Нужен пароль 2FA: /password <пароль>');
      ctx.reply('✅ Авторизован');
    } catch (e) {
      console.error('code error:', e);
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command('password', async (ctx) => {
    const pwd = ctx.message.text.split(' ')[1];
    if (!pwd) return ctx.reply('Формат: /password пароль');
    try {
      await userbot.checkPassword(pwd);
      ctx.reply('✅ Авторизован');
    } catch (e) {
      console.error('password error:', e);
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  // ---------- Чаты ----------

  bot.command('add_chat', async (ctx) => {
    const refs = parseArgs(ctx);
    if (!refs.length) return ctx.reply('Укажи одну или несколько ссылок/username чатов');

    const lines = [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      try {
        const storeRef = await resolveChat(ref);
        if (config.data.chats.includes(storeRef)) {
          lines.push(`• уже в списке: ${storeRef}`);
        } else {
          config.data.chats.push(storeRef);
          lines.push(`✅ ${storeRef}`);
        }
      } catch (e) {
        console.error('add_chat error:', ref, e);
        lines.push(`❌ ${ref}: ${e.errorMessage || e.message}`);
      }
      if (i < refs.length - 1) await sleep(1500); // пауза, чтобы не поймать FLOOD_WAIT
    }
    config.save();
    await replyLong(ctx, lines.join('\n'));
  });

  bot.command('add_folder', async (ctx) => {
    const refs = parseArgs(ctx);
    if (!refs.length) return ctx.reply('Укажи ссылку на папку: /add_folder https://t.me/addlist/...');

    for (const ref of refs) {
      try {
        const { slug, title, refs: chatRefs, filterId } = await importFolder(ref);
        const newlyAdded = [];
        for (const c of chatRefs) {
          if (!config.data.chats.includes(c)) {
            config.data.chats.push(c);
            newlyAdded.push(c);
          }
        }

        // запоминаем папку, чтобы её можно было удалить вместе с её чатами
        const folders = getFolders();
        const existing = folders.find((f) => f.slug === slug);
        if (existing) {
          existing.chats = chatRefs;
          existing.added = [...new Set([...(existing.added || []), ...newlyAdded])];
          if (filterId != null) existing.filterId = filterId;
        } else {
          folders.push({ slug, title, filterId, chats: chatRefs, added: newlyAdded });
        }
        config.save();

        await ctx.reply(
          `📁 Папка «${title}»: чатов в папке ${chatRefs.length}, ` +
          `новых добавлено ${newlyAdded.length}, уже были ${chatRefs.length - newlyAdded.length}`
        );
      } catch (e) {
        console.error('add_folder error:', ref, e);
        await ctx.reply(`❌ ${ref}: ${e.errorMessage || e.message}`);
      }
    }
  });

  bot.command('folders', (ctx) => {
    const folders = getFolders();
    if (!folders.length) return ctx.reply('Папок нет');
    replyLong(ctx, folders
      .map((f, i) => `${i + 1}. «${f.title}» — чатов: ${f.chats.length}\n   t.me/addlist/${f.slug}`)
      .join('\n'));
  });

  // /del_folder <номер из /folders | ссылка t.me/addlist/...>
  bot.command('del_folder', async (ctx) => {
    const args = parseArgs(ctx);
    if (!args.length) return ctx.reply('Укажи номер из /folders или ссылку на папку');
    const folders = getFolders();

    // сначала находим все папки, чтобы номера не сдвигались после удаления
    const targets = [];
    for (const arg of args) {
      let folder;
      if (/^\d+$/.test(arg)) {
        folder = folders[Number(arg) - 1];
      } else {
        const m = arg.match(/t\.me\/addlist\/([\w-]+)/);
        folder = folders.find((f) => f.slug === (m ? m[1] : arg));
      }
      if (!folder) {
        await ctx.reply(`❌ Папка не найдена: ${arg}`);
      } else if (!targets.includes(folder)) {
        targets.push(folder);
      }
    }

    for (const folder of targets) {

      // 1) убираем из списка вз-чатов те чаты, которые добавила эта папка
      //    (кроме тех, что есть в других папках)
      const others = folders.filter((f) => f !== folder);
      const keep = new Set(others.flatMap((f) => f.chats));
      const toRemove = (folder.added || []).filter((c) => !keep.has(c));
      config.data.chats = config.data.chats.filter((c) => !toRemove.includes(c));

      // 2) удаляем папку в аккаунте юзербота (чаты остаются, юзербот из них не выходит)
      let warn = '';
      if (folder.filterId != null) {
        try {
          await deleteFolderInAccount(folder.filterId);
        } catch (e) {
          console.error('del_folder error:', e);
          warn = `\n⚠️ Из списка бота убрана, но в аккаунте удалить не вышло: ${e.errorMessage || e.message}`;
        }
      } else {
        warn = '\n⚠️ id папки в аккаунте неизвестен — удали её в Telegram вручную';
      }

      // 3) убираем папку из конфига
      folders.splice(folders.indexOf(folder), 1);
      config.save();
      await ctx.reply(`🗑 Папка «${folder.title}» удалена, чатов убрано из вз-списка: ${toRemove.length}${warn}`);
    }
  });

  bot.command('chats', (ctx) => {
    replyLong(ctx, config.data.chats.length
      ? `Вз-чатов: ${config.data.chats.length}\n` + config.data.chats.join('\n')
      : 'Список пуст');
  });

  bot.command('del_chat', async (ctx) => {
    const refs = parseArgs(ctx);
    if (!refs.length) return ctx.reply('Укажи ссылку/id чата (см. /chats)');
    const before = config.data.chats.length;
    config.data.chats = config.data.chats.filter((c) => !refs.includes(c));
    config.save();
    ctx.reply(`Удалено: ${before - config.data.chats.length} из ${refs.length}`);
  });

  // /del_all_chats — очищает весь список вз-чатов (нужно подтверждение: /del_all_chats да)
  bot.command('del_all_chats', async (ctx) => {
    const count = config.data.chats.length;
    if (!count) return ctx.reply('Список уже пуст');

    const arg = (parseArgs(ctx)[0] || '').toLowerCase();
    if (!['да', 'yes', 'confirm'].includes(arg)) {
      return ctx.reply(`Будет удалено вз-чатов: ${count}.\nПодтверди: /del_all_chats да`);
    }

    config.data.chats = [];
    config.save();
    ctx.reply(`🗑 Удалено вз-чатов: ${count}`);
  });

  // ---------- Каналы ----------

  bot.command('add_channel', async (ctx) => {
    const refs = parseArgs(ctx);
    if (!refs.length) return ctx.reply('Укажи одну или несколько ссылок/username каналов');

    const lines = [];
    for (const ref of refs) {
      if (config.data.channels.includes(ref)) {
        lines.push(`• уже в списке: ${ref}`);
      } else {
        config.data.channels.push(ref);
        lines.push(`✅ ${ref}`);
      }
    }
    config.save();
    await replyLong(ctx, lines.join('\n'));
  });

  bot.command('channels', (ctx) => {
    replyLong(ctx, config.data.channels.length
      ? `Каналов: ${config.data.channels.length}\n` + config.data.channels.join('\n')
      : 'Список пуст');
  });

  bot.command('del_channel', async (ctx) => {
    const refs = parseArgs(ctx);
    if (!refs.length) return ctx.reply('Укажи ссылку/username канала (см. /channels)');
    const before = config.data.channels.length;
    config.data.channels = config.data.channels.filter((c) => !refs.includes(c));
    config.save();
    ctx.reply(`Удалено: ${before - config.data.channels.length} из ${refs.length}`);
  });

  bot.command('create_channel', async (ctx) => {
    const title = ctx.message.text.replace('/create_channel', '').trim();
    if (!title) return ctx.reply('Укажи название');
    try {
      const result = await userbot.client.invoke(new Api.channels.CreateChannel({
        title,
        about: 'vz',
        broadcast: true,
        megagroup: false
      }));
      const channel = result.chats[0];
      const ref = channel.username || channel.id;
      config.data.channels.push(ref);
      config.save();
      ctx.reply(`Канал создан: @${channel.username} (${channel.id})`);
    } catch (e) {
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  // ---------- Рассылка ----------

  // Текст после "/команда " и кастом-эмодзи из него (офсеты сдвинуты на длину команды)
  function extractPayload(ctx) {
    const full = ctx.message.text;
    const m = full.match(/^\/\S+\s*/);
    const prefixLen = m ? m[0].length : full.length;
    const text = full.slice(prefixLen).trimEnd();
    const entities = (ctx.message.entities || [])
      .filter((e) => e.type === 'custom_emoji' && e.offset >= prefixLen && e.offset < prefixLen + text.length)
      .map((e) => ({ offset: e.offset - prefixLen, length: e.length, documentId: String(e.custom_emoji_id) }));
    return { text, entities };
  }

  // Рассылка по всем вз-чатам. Между чатами пауза, чтобы не ловить flood-лимит.
  async function broadcast(text, entities) {
    const client = ensureClient();
    const formattingEntities = (entities || []).map((e) => new Api.MessageEntityCustomEmoji({
      offset: e.offset,
      length: e.length,
      documentId: bigInt(e.documentId)
    }));
    const chats = [...config.data.chats];
    let sent = 0;
    for (let i = 0; i < chats.length; i++) {
      try {
        const sentMsg = await client.sendMessage(chats[i], { message: text, formattingEntities });
        store.ownPosts.add(`${sentMsg.chatId}_${sentMsg.id}`);
        sent++;
      } catch (e) {
        console.log('post error', chats[i], e.errorMessage || e.message);
      }
      if (i < chats.length - 1) await sleep(1500 + Math.random() * 1500);
    }
    return { sent, total: chats.length };
  }

  bot.command('post', async (ctx) => {
    const { text, entities } = extractPayload(ctx);
    if (!text) return ctx.reply('Укажи текст');
    if (!config.data.chats.length) return ctx.reply('Нет вз-чатов');
    console.log('post: text=', text, 'entities=', JSON.stringify(entities));
    try {
      const { sent, total } = await broadcast(text, entities);
      ctx.reply(sent === total ? `Разослано в ${sent} чатов` : `Разослано в ${sent} из ${total} чатов`);
    } catch (e) {
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  // ---------- Автопост ----------
  // Состояние хранится в config.data.autopost, поэтому переживает перезапуск.

  function getAutopost() {
    if (!config.data.autopost || typeof config.data.autopost !== 'object') {
      config.data.autopost = { enabled: false, text: '', entities: [], intervalMin: null, lastAt: null, nextAt: null };
    }
    return config.data.autopost;
  }

  function autopostStatus() {
    const ap = getAutopost();
    const preview = ap.text ? (ap.text.length > 200 ? ap.text.slice(0, 200) + '…' : ap.text) : 'не задан';
    const lines = [
      `📣 Автопост: ${ap.enabled ? 'включён' : 'выключен'}`,
      `Частота: ${ap.intervalMin ? 'каждые ' + fmtMinutes(ap.intervalMin) : 'не задана'}`,
      `Текст: ${preview}`,
      `Вз-чатов: ${config.data.chats.length}`
    ];
    if (ap.enabled && ap.nextAt) lines.push(`Следующая рассылка: через ${fmtMinutes((ap.nextAt - Date.now()) / 60000)}`);
    if (ap.lastAt) {
      lines.push(`Последняя: ${fmtMinutes((Date.now() - ap.lastAt) / 60000)} назад${ap.lastResult ? ` (${ap.lastResult})` : ''}`);
    }
    return lines.join('\n');
  }

  bot.command('autopost', (ctx) => {
    ctx.reply(
      autopostStatus() + '\n\n' +
      'Настройка:\n' +
      '/autopost_text <текст> — текст рассылки\n' +
      '/autopost_every <30м | 2ч | 1д> — частота (минимум ' + MIN_INTERVAL_MIN + ' мин)\n' +
      '/autopost_on — включить\n' +
      '/autopost_off — выключить\n' +
      '/autopost_now — разослать один раз прямо сейчас'
    );
  });

  bot.command('autopost_text', (ctx) => {
    const { text, entities } = extractPayload(ctx);
    if (!text) return ctx.reply('Формат: /autopost_text <текст рассылки>');
    const ap = getAutopost();
    ap.text = text;
    ap.entities = entities;
    config.save();
    ctx.reply(`Текст автопоста сохранён (${text.length} симв.)`);
  });

  bot.command('autopost_every', (ctx) => {
    const arg = parseArgs(ctx).join('');
    if (!arg) return ctx.reply(`Формат: /autopost_every 30м | 2ч | 1д (минимум ${MIN_INTERVAL_MIN} мин)`);
    const minutes = parseInterval(arg);
    if (!minutes) return ctx.reply('Не понял интервал. Примеры: 30м, 2ч, 1.5ч, 1д');
    if (minutes < MIN_INTERVAL_MIN) return ctx.reply(`Слишком часто: минимум ${MIN_INTERVAL_MIN} мин`);
    if (minutes > MAX_INTERVAL_MIN) return ctx.reply('Слишком редко: максимум 30 дней');

    const ap = getAutopost();
    ap.intervalMin = minutes;
    if (ap.enabled) ap.nextAt = Date.now() + minutes * 60000; // при смене частоты отсчёт идёт заново
    config.save();
    ctx.reply(`Частота: каждые ${fmtMinutes(minutes)}` + (ap.enabled ? `. Следующая рассылка через ${fmtMinutes(minutes)}` : ''));
  });

  bot.command('autopost_on', (ctx) => {
    const ap = getAutopost();
    if (!ap.text) return ctx.reply('Сначала задай текст: /autopost_text <текст>');
    if (!ap.intervalMin) return ctx.reply('Сначала задай частоту: /autopost_every 2ч');
    if (!config.data.chats.length) return ctx.reply('Нет вз-чатов');
    ap.enabled = true;
    ap.nextAt = Date.now() + ap.intervalMin * 60000;
    config.save();
    ctx.reply(
      `✅ Автопост включён: каждые ${fmtMinutes(ap.intervalMin)}. ` +
      `Первая рассылка через ${fmtMinutes(ap.intervalMin)}. Разослать сразу — /autopost_now`
    );
  });

  bot.command('autopost_off', (ctx) => {
    const ap = getAutopost();
    ap.enabled = false;
    ap.nextAt = null;
    config.save();
    ctx.reply('⏹ Автопост выключен');
  });

  let autopostBusy = false;

  async function runAutopost() {
    const ap = getAutopost();
    autopostBusy = true;
    try {
      const { sent, total } = await broadcast(ap.text, ap.entities);
      ap.lastAt = Date.now();
      ap.lastResult = `${sent}/${total}`;
      config.save();
      return { sent, total };
    } finally {
      autopostBusy = false;
    }
  }

  // Разовая рассылка сейчас, расписание не сдвигается
  bot.command('autopost_now', async (ctx) => {
    const ap = getAutopost();
    if (!ap.text) return ctx.reply('Сначала задай текст: /autopost_text <текст>');
    if (!config.data.chats.length) return ctx.reply('Нет вз-чатов');
    if (autopostBusy) return ctx.reply('Рассылка уже идёт');
    await ctx.reply('Рассылаю…');
    try {
      const { sent, total } = await runAutopost();
      ctx.reply(`Разослано в ${sent} из ${total} чатов`);
    } catch (e) {
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  async function autopostTick() {
    const ap = getAutopost();
    if (!ap.enabled || autopostBusy || !ap.text || !ap.intervalMin) return;
    if (Date.now() < (ap.nextAt || 0)) return;

    // следующий запуск планируем заранее, чтобы перезапуск посреди рассылки не вызвал повтор
    ap.nextAt = Date.now() + ap.intervalMin * 60000;
    config.save();
    try {
      const { sent, total } = await runAutopost();
      ap.nextAt = Date.now() + ap.intervalMin * 60000; // отсчёт от конца рассылки
      config.save();
      await log(`📣 Автопост: разослано в ${sent} из ${total} чатов | следующий через ${fmtMinutes(ap.intervalMin)}`);
    } catch (e) {
      await log(`❌ Ошибка автопоста: ${e.message}`);
    }
  }

  setInterval(autopostTick, 30 * 1000);

  bot.command('status', async (ctx) => {
    const auth = await userbot.isAuthorized();
    const ap = getAutopost();
    ctx.reply(
      `Авторизован: ${auth}\n` +
      `Вз-чатов: ${config.data.chats.length}\n` +
      `Каналов для тапов: ${config.data.channels.length}\n` +
      `Автопост: ${ap.enabled ? 'каждые ' + fmtMinutes(ap.intervalMin) : 'выключен'}\n` +
      `Лог-канал: ${config.data.logsChannel || 'не указан'}`
    );
  });

  bot.launch();
  return bot;
}

module.exports = setupBot;
