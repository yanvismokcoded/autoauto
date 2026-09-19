function parseVzMessage(text) {
  if (!text) return null;

  const linkMatch = text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([^\s]+)/i);
  if (!linkMatch) return null;

  let link = linkMatch[0];
  if (!link.startsWith('http')) link = 'https://' + link;

  const usernameMatch = text.match(/@([a-zA-Z0-9_]{5,})/);
  if (!usernameMatch) return null;

  const username = usernameMatch[1];

  let count = null;
  const countMatch = text.match(/(\d+)\s*(?:голос|тап|вз)/i) || text.match(/вз\s+(\d+)/i);
  if (countMatch) count = parseInt(countMatch[1]);

  return { link, username, count };
}

module.exports = { parseVzMessage };