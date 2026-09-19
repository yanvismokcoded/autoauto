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