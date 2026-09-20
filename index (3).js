const config = require('./config');
const store = require('./store');
const Userbot = require('./userbot');
const Tapper = require('./tapper');
const setupBot = require('./bot');
const parser = require('./parser');
const { NewMessage } = require('telegram/events');

async function main() {
  const userbot = new Userbot(config, store);
  await userbot.connect();
  const client = userbot.client;
  const tapper = new Tapper(client, config, store);

  async function log(text) {
    console.log(text);
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

    console.log('event: chatId=', chatId, 'msgId=', msg.id, 'replyToMessageId=', msg.replyToMessageId, 'text=', text, 'contextsHasReply=', msg.replyToMessageId ? store.contexts.has(msg.replyToMessageId) : null, 'contextsKeys=', [...store.contexts.keys()]);

    // Ответ "сообщите" на наше сообщение — тапаем
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
        } catch (e) {
          await log(`❌ Ошибка тапа: ${e.message}`);
        }
        store.contexts.delete(msg.replyToMessageId);
        return;
      }
    }

    // Новое предложение вз — отвечаем "сообщите"
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
      } catch (e) {
        console.log('reply error', e.message);
      }
    }
  }, new NewMessage({ chats: config.data.chats }));

  setupBot(config.data.botToken, userbot, tapper, config, store, log);
  console.log('VZ bot started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
