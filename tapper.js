const { Api } = require('telegram');

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
      const chatId = parseInt('-100' + cMatch[1]);
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

    const discussion = await this.client.getDiscussionMessage(entity, post.id);
    if (!discussion) throw new Error('Обсуждение не найдено');

    const key = `${entity.id}_${post.id}`;
    const usedBefore = this.store.data.tapped[key] || [];
    const usedChannels = [];

    for (const channelRef of this.config.data.channels) {
      if (usedBefore.includes(channelRef)) continue;

      try {
        const channelEntity = await this.client.getEntity(channelRef);
        await this.client.sendMessage(discussion.chatId, {
          message: '@' + username,
          replyTo: discussion.id,
          sendAs: channelEntity
        });
        usedChannels.push(channelRef);
        await sleep(2000 + Math.random() * 3000);
      } catch (e) {
        try {
          await this.client.joinChannel(entity);
          await this.client.sendMessage(discussion.chatId, {
            message: '@' + username,
            replyTo: discussion.id,
            sendAs: channelEntity
          });
          usedChannels.push(channelRef);
          await sleep(2000 + Math.random() * 3000);
        } catch (e2) {
          console.log('Не удалось тапнуть каналом', channelRef, e2.message);
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
