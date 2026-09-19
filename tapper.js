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
