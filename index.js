const config = require('./config');
const store = require('./store');
const Userbot = require('./userbot');
const Tapper = require('./tapper');
const setupBot = require('./bot');
const parser = require('./parser');
const { NewMessage } = require('telegram/events');

function isTrackedChat(chatId, chat, chats) {
  if (!chats || !chats.length) return false;
  const chatIdStr = String(chatId);
  const normalized = chatIdStr.replace(/^-/, '');
  return chats.some((ref) => {
    if (!ref) return false;
    const refStr = String(ref).replace(/^@/, '').replace(/^-/, '');
    if (refStr === normalized) return true;
    if (chat && chat.username && (refStr === chat.username || refStr === chatIdStr)) return true;
    return false;
  });
}

async function main() {
  const userbot = new Userbot(config, store);
  await userbot.connect();
  const client = userbot.client;
  const tapper = new Tapper(client, config, store);

  async function log(text) {
    if (!config.data.logsChannel) return;
    try {
      await client.sendMessage(config.data.logsChannel, { message: text });
    } catch (e) {
      console.log('log error', e.message);
    }
  }

  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || msg.out) return;
    const text = msg.text || '';
    const chatId = msg.chatId;
    const chat = msg.chat;

    if (!isTrackedChat(chatId, chat, config.data.chats)) return;

    // Подтверждение реплаем "сообщите" — тап, если контекст ещё жив
    if (msg.replyToMessageId) {
      const ctx = store.contexts.get(msg.replyToMessageId);
      if (ctx && text.toLowerCase().includes(config.data.confirmKeyword)) {
        try {
          const result = await tapper.tap(ctx.link, ctx.username, ctx.count || config.data.defaultVotes);
          await client.sendMessage(chatId, {
            message: config.data.doneKeyword,
            replyTo: msg.id
          });
          await log(`✅ Тап выполнен: @${ctx.username} | ${ctx.link} | каналов: ${result.total} | чат: ${chatId}`);
          await log(`📤 Отчёт: "${config.data.doneKeyword}" в чат ${chatId}`);
          store.contexts.delete(msg.replyToMessageId);
        } catch (e) {
          console.log('TAP ERROR:', e.message);
          console.log(e.stack);
          await log(`❌ Ошибка тапа: ${e.message}`);
        }
        return;
      }
    }

    // Новое "вз? ссылка * юз" — отвечаем "сообщите" и сразу тапаем
    const isReplyToOwnPost = !!(msg.replyToMessageId && store.ownPosts.has(`${chatId}_${msg.replyToMessageId}`));
    const parsed = parser.parseVzMessage(text, isReplyToOwnPost);
    if (parsed) {
      try {
        const replyMsg = await client.sendMessage(chatId, {
          message: config.data.confirmKeyword,
          replyTo: msg.id
        });
        store.contexts.set(replyMsg.id, {
          chatId,
          authorId: msg.senderId,
          username: parsed.username,
          link: parsed.link,
          count: parsed.count || config.data.defaultVotes
        });
        await log(`💬 Ответил "${config.data.confirmKeyword}" в чат ${chatId} на предложение @${parsed.username} | ${parsed.link}`);

        try {
          const result = await tapper.tap(parsed.link, parsed.username, parsed.count || config.data.defaultVotes);
          await client.sendMessage(chatId, {
            message: config.data.doneKeyword,
            replyTo: replyMsg.id
          });
          await log(`✅ Тап выполнен: @${parsed.username} | ${parsed.link} | каналов: ${result.total} | чат: ${chatId}`);
          store.contexts.delete(replyMsg.id);
        } catch (e) {
          console.log('TAP ERROR:', e.message);
          console.log(e.stack);
          await log(`❌ Ошибка тапа: ${e.message}`);
        }
      } catch (e) {
        console.log('reply error', e.message);
      }
    }
  }, new NewMessage());

  setupBot(config.data.botToken, userbot, tapper, config, store, log);
  console.log('VZ bot started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
