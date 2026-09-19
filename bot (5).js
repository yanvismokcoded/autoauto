const { Telegraf } = require('telegraf');
const { Api } = require('telegram');

function setupBot(botToken, userbot, tapper, config, store, log) {
  const bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply(
      'VZ бот. Команды:\n' +
      '/login — авторизация\n' +
      '/code <код> — ввод кода\n' +
      '/password <пароль> — 2FA\n' +
      '/add_chat <ссылка> — добавить вз-чат\n' +
      '/chats — список вз-чатов\n' +
      '/del_chat <ссылка> — удалить вз-чат\n' +
      '/add_channel <ссылка> — добавить канал для тапов\n' +
      '/channels — список каналов\n' +
      '/del_channel <ссылка> — удалить канал\n' +
      '/create_channel <название> — создать канал\n' +
      '/post <текст> — разослать предложение по вз-чатам\n' +
      '/status — статус'
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

  bot.command('add_chat', async (ctx) => {
    const ref = ctx.message.text.split(' ')[1];
    if (!ref) return ctx.reply('Укажи ссылку или username чата');
    try {
      const inviteMatch = ref.match(/(?:t\.me\/\+|t\.me\/joinchat\/)([\w-]+)/);
      if (inviteMatch) {
        try {
          await userbot.client.invoke(new Api.messages.ImportChatInvite({ hash: inviteMatch[1] }));
        } catch (e) {
          if (e.errorMessage !== 'USER_ALREADY_PARTICIPANT') throw e;
        }
      } else {
        await userbot.client.getEntity(ref);
      }
    } catch (e) {
      return ctx.reply(`Не удалось вступить/найти чат: ${e.message}`);
    }
    if (!config.data.chats.includes(ref)) {
      config.data.chats.push(ref);
      config.save();
    }
    ctx.reply(`Чат добавлен: ${ref}`);
  });

  bot.command('chats', (ctx) => {
    ctx.reply(config.data.chats.length ? config.data.chats.join('\n') : 'Список пуст');
  });

  bot.command('del_chat', async (ctx) => {
    const ref = ctx.message.text.split(' ')[1];
    config.data.chats = config.data.chats.filter((c) => c !== ref);
    config.save();
    ctx.reply(`Удалено: ${ref}`);
  });

  bot.command('add_channel', async (ctx) => {
    const ref = ctx.message.text.split(' ')[1];
    if (!ref) return ctx.reply('Укажи ссылку или username канала');
    if (!config.data.channels.includes(ref)) {
      config.data.channels.push(ref);
      config.save();
    }
    ctx.reply(`Канал добавлен: ${ref}`);
  });

  bot.command('channels', (ctx) => {
    ctx.reply(config.data.channels.length ? config.data.channels.join('\n') : 'Список пуст');
  });

  bot.command('del_channel', async (ctx) => {
    const ref = ctx.message.text.split(' ')[1];
    config.data.channels = config.data.channels.filter((c) => c !== ref);
    config.save();
    ctx.reply(`Удалено: ${ref}`);
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

  bot.command('post', async (ctx) => {
    const text = ctx.message.text.replace('/post', '').trim();
    if (!text) return ctx.reply('Укажи текст');
    if (!config.data.chats.length) return ctx.reply('Нет вз-чатов');
    let sent = 0;
    for (const chat of config.data.chats) {
      try {
        await userbot.client.sendMessage(chat, { message: text });
        sent++;
      } catch (e) {
        console.log('post error', chat, e.message);
      }
    }
    ctx.reply(`Разослано в ${sent} чатов`);
  });

  bot.command('status', async (ctx) => {
    const auth = await userbot.isAuthorized();
    ctx.reply(
      `Авторизован: ${auth}\n` +
      `Вз-чатов: ${config.data.chats.length}\n` +
      `Каналов для тапов: ${config.data.channels.length}\n` +
      `Лог-канал: ${config.data.logsChannel || 'не указан'}`
    );
  });

  bot.launch();
  return bot;
}

module.exports = setupBot;
