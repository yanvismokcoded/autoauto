const { Api, utils } = require('telegram');
const bigInt = require('big-integer');

function randomId() {
  return bigInt(Date.now()).shiftLeft(20).add(bigInt(Math.floor(Math.random() * 0xfffff)));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Tapper {
  constructor(client, config, store) {
    this.client = client;
    this.config = config;
    this.store = store;
  }

  async resolveLink(link) {
    const cMatch = link.match(/t\.me\/c\/(\d+)\/(\d+)/);
    if (cMatch) {
      const chatId = -100 + parseInt(cMatch[1]);
      const postId = parseInt(cMatch[2]);
      const entity = await this.client.getEntity(chatId);
      return { entity, postId };
    }

    const uMatch = link.match(/t\.me\/([a-zA-Z0-9_]+)(?:\/(\d+))?/);
    if (uMatch) {
      const username = uMatch[1];
      const postId = uMatch[2] ? parseInt(uMatch[2]) : null;
      const entity = await this.client.getEntity(username);
      return { entity, postId };
    }

    throw new Error('Не удалось распознать ссылку');
  }

  async tap(link, username, count) {
    const { entity, postId } = await this.resolveLink(link);

    let post;
    if (postId) {
      const msgs = await this.client.getMessages(entity, { ids: [postId] });
      post = msgs[0];
    } else {
      const msgs = await this.client.getMessages(entity, { limit: 1 });
      post = msgs[0];
    }
    if (!post) throw new Error('Пост не найден');

    const discussionResult = await this.client.invoke(new Api.messages.GetDiscussionMessage({
      peer: entity,
      msgId: post.id
    }));
    const discussionMsg = discussionResult.messages && discussionResult.messages[0];
    if (!discussionMsg) throw new Error('Обсуждение не найдено');
    const discussion = {
      chatId: utils.getPeerId(discussionMsg.peerId),
      id: discussionMsg.id
    };

    const key = `${entity.id}_${post.id}`;
    const usedBefore = this.store.data.tapped[key] || [];
    const usedChannels = [];

    try {
      const sendAsResult = await this.client.invoke(new Api.channels.GetSendAs({ peer: discussion.chatId }));
      const validIds = sendAsResult.peers.map((p) => utils.getPeerId(p.peer || p));
      console.log('Разрешённые send-as для этой группы:', validIds);
      console.log('Ваши каналы (для сравнения):', await Promise.all(
        this.config.data.channels.map(async (ref) => {
          try {
            const e = await this.client.getEntity(ref);
            return `${ref} -> ${utils.getPeerId(e)}`;
          } catch {
            return `${ref} -> не резолвится`;
          }
        })
      ));
    } catch (e) {
      console.log('Не удалось получить список send-as:', e.errorMessage || e.message);
    }

    const peer = await this.client.getInputEntity(discussion.chatId);

    for (const channelRef of this.config.data.channels) {
      if (usedBefore.includes(channelRef)) continue;

      let channelEntity;
      try {
        channelEntity = await this.client.getEntity(channelRef);
      } catch (e) {
        console.log('Не удалось получить канал', channelRef, e.errorMessage || e.message);
        continue;
      }

      const doSend = async () => {
        const sendAsPeer = await this.client.getInputEntity(channelEntity);
        await this.client.invoke(new Api.messages.SendMessage({
          peer,
          message: '@' + username,
          randomId: randomId(),
          replyTo: new Api.InputReplyToMessage({ replyToMsgId: discussion.id }),
          sendAs: sendAsPeer
        }));
      };

      try {
        await doSend();
        usedChannels.push(channelRef);
        await sleep(2000 + Math.random() * 3000);
      } catch (e) {
        console.log('sendAs 1-я попытка не удалась', channelRef, e.errorMessage || e.message);
        try {
          await this.client.joinChannel(entity);
          await doSend();
          usedChannels.push(channelRef);
          await sleep(2000 + Math.random() * 3000);
        } catch (e2) {
          console.log('Не удалось тапнуть каналом', channelRef, e2.errorMessage || e2.message);
        }
      }
    }

    if (usedChannels.length > 0) {
      this.store.data.tapped[key] = [...new Set([...usedBefore, ...usedChannels])];
      this.store.save();
    }

    return { usedChannels, total: usedChannels.length };
  }
}

module.exports = Tapper;
