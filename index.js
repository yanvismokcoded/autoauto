const config = require('./config');
const store = require('./store');
const Userbot = require('./userbot');
const Tapper = require('./tapper');
const setupBot = require('./bot');
const parser = require('./parser');
const bigInt = require('big-integer');
const { NewMessage } = require('telegram/events');
const { utils } = require('telegram');

// --- разбор фраз -----------------------------------------------------------

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

// "тап после вас", "тапну после вас", "тапаю после вас"
const AFTER_YOU_RE = /тап\S*\s+после\s+вас/;

// "вз" как отдельное слово (не "взял", "взгляд") или "взаимка/взаимно"
const VZ_WORD_RE = /(?<![а-яa-z])вз(?![а-яa-z])|взаимк|взаимн/;

const AFTER_YOU_REPLY_DEFAULT = 'тап, сообщите';

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

  function getReplyToId(msg) {
    return msg.replyToMsgId ?? msg.replyTo?.replyToMsgId ?? msg.replyToMessageId ?? null;
  }

  // --- список слушаемых чатов ----------------------------------------------
  // Раньше список чатов фиксировался при старте, и новые чаты (/add_chat,
  // /add_folder) работали только после перезапуска. Теперь он пересобирается
  // сам, как только меняется config.data.chats.

  const watched = new Set(); // id чатов в "размеченном" виде (-100...), строками
  const resolvedRefs = new Map(); // ref -> [id, ...]
  let watchedSig = null;
  let watchedAt = 0;
  let refreshing = null;

  async function resolveChatIds(ref) {
    // id, который сохранил /add_chat по инвайту (без -100) — вычисляем без запросов
    if (/^-?\d+$/.test(ref)) {
      if (ref.startsWith('-')) return [ref];
      const n = bigInt(ref);
      return [
        bigInt('-1000000000000').subtract(n).toString(), // канал / супергруппа
        bigInt(0).subtract(n).toString() // обычная группа
      ];
    }
    try {
      const entity = await client.getEntity(ref);
      return [String(utils.getPeerId(entity))];
    } catch (e) {
      console.log('Не удалось найти чат', ref, e.errorMessage || e.message);
      return null;
    }
  }

  async function rebuildWatched() {
    const next = new Set();
    for (const ref of config.data.chats) {
      let ids = resolvedRefs.get(ref);
      if (!ids) {
        ids = await resolveChatIds(ref);
        if (ids) resolvedRefs.set(ref, ids);
      }
      if (ids) ids.forEach((id) => next.add(id));
    }
    watched.clear();
    next.forEach((id) => watched.add(id));
    console.log(`Слушаю чатов: ${config.data.chats.length} (распознано id: ${watched.size})`);
  }

  function ensureWatched() {
    const sig = config.data.chats.join('|');
    const stale = Date.now() - watchedAt > 5 * 60 * 1000; // раз в 5 минут повторяем неудавшиеся
    if (!refreshing && (sig !== watchedSig || stale)) {
      watchedSig = sig;
      watchedAt = Date.now();
      refreshing = rebuildWatched()
        .catch((e) => console.log('watched refresh error', e.message))
        .finally(() => { refreshing = null; });
    }
    return refreshing || Promise.resolve();
  }

  // --- тап + ответ ----------------------------------------------------------

  async function tapAndReply(ctx, chatId, replyToMsgId, replyText) {
    try {
      const result = await tapper.tap(ctx.link, ctx.username, ctx.count || config.data.defaultVotes);
      await client.sendMessage(chatId, { message: replyText, replyTo: replyToMsgId });
      await log(`✅ Тап выполнен: @${ctx.username} | ${ctx.link} | каналов: ${result.total} | чат: ${chatId}`);
      await log(`📤 Отчёт: "${replyText}" в чат ${chatId}`);
    } catch (e) {
      await log(`❌ Ошибка тапа: ${e.message}`);
    }
  }

  // --- разбор предложения вз ------------------------------------------------
  // 1) ссылка и юз прямо в тексте (в любой форме)
  // 2) "вз? <ссылка на сообщение в публичном чате>": берём то сообщение и ищем
  //    ссылку и юз уже в нём. Если там ничего нет — просто игнор.

  async function parseOffer(text, isReplyToOwnPost) {
    const direct = parser.parseVzMessage(text, isReplyToOwnPost);
    if (direct) return { parsed: direct, via: null };

    if (!VZ_WORD_RE.test(norm(text))) return null;
    const ref = parser.parseMessageLink(text);
    if (!ref) return null;

    try {
      const [linked] = await client.getMessages(ref.peer, { ids: [ref.id] });
      if (!linked) return null;
      const parsed = parser.parseVzMessage(parser.messageToText(linked), false);
      return parsed ? { parsed, via: ref.link } : null;
    } catch (e) {
      console.log('linked message error', ref.link, e.errorMessage || e.message);
      return null;
    }
  }

  // --- входящие сообщения ---------------------------------------------------

  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || msg.out) return;

    await ensureWatched();
    const chatId = msg.chatId;
    if (!watched.has(String(chatId))) return;

    const text = msg.text || '';
    const replyToId = getReplyToId(msg);
    // ключ с id чата: у разных чатов номера сообщений пересекаются
    const ctxKey = replyToId ? `${chatId}_${replyToId}` : null;

    console.log('event: chatId=', chatId, 'msgId=', msg.id, 'replyToId=', replyToId, 'text=', text, 'contextsHasReply=', ctxKey ? store.contexts.has(ctxKey) : null, 'contextsKeys=', [...store.contexts.keys()]);

    // Ответ на наше сообщение: тапаем
    if (ctxKey) {
      const ctx = store.contexts.get(ctxKey);
      if (ctx) {
        const t = norm(text);
        const confirm = norm(config.data.confirmKeyword);
        let replyText = null;

        if (AFTER_YOU_RE.test(t)) {
          // "тап после вас": тапаем первыми, потом отвечаем "тап, сообщите"
          replyText = config.data.afterYouReply || AFTER_YOU_REPLY_DEFAULT;
        } else if (confirm && t.includes(confirm)) {
          // "сообщите" и "тап, сообщите": тапаем и отчитываемся
          replyText = config.data.doneKeyword;
        }

        if (replyText) {
          store.contexts.delete(ctxKey); // сначала удаляем, чтобы не тапнуть дважды
          await tapAndReply(ctx, chatId, msg.id, replyText);
          return;
        }
      }
    }

    // Новое предложение вз — отвечаем "сообщите"
    const isReplyToOwnPost = !!(replyToId && store.ownPosts.has(`${chatId}_${replyToId}`));
    const offer = await parseOffer(text, isReplyToOwnPost);
    if (offer) {
      const { parsed, via } = offer;
      try {
        const replyMsg = await client.sendMessage(chatId, {
          message: config.data.confirmKeyword,
          replyTo: msg.id
        });
        store.contexts.set(`${chatId}_${replyMsg.id}`, {
          chatId,
          authorId: msg.senderId,
          username: parsed.username,
          link: parsed.link,
          count: parsed.count || config.data.defaultVotes
        });
        await log(`💬 Ответил "${config.data.confirmKeyword}" в чат ${chatId} на предложение @${parsed.username} | ${parsed.link}${via ? ` (из сообщения ${via})` : ''}`);
      } catch (e) {
        console.log('reply error', e.message);
      }
    }
  }, new NewMessage({}));

  await ensureWatched();

  setupBot(config.data.botToken, userbot, tapper, config, store, log);
  console.log('VZ bot started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
