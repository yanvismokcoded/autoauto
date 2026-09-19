function parseVzMessage(text, allowStarFormat = false) {
  if (!text) return null;

  const linkMatch = text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([^\s]+)/i);
  if (!linkMatch) return null;

  let link = linkMatch[0];
  if (!link.startsWith('http')) link = 'https://' + link;

  let username = null;
  const usernameMatch = text.match(/@([a-zA-Z0-9_]{5,})/);
  if (usernameMatch) {
    username = usernameMatch[1];
  } else {
    // "вз? ссылка * юз" — юзер после звёздочки, @ не обязателен
    const starMatch = text.match(/\*\s*@?([a-zA-Z0-9_]{5,})/);
    if (starMatch) username = starMatch[1];
  }
  if (!username) return null;

  let count = null;
  const countMatch = text.match(/(\d+)\s*(?:голос|тап|вз)/i) || text.match(/вз\s+(\d+)/i);
  if (countMatch) count = parseInt(countMatch[1]);

  return { link, username, count };
}

module.exports = { parseVzMessage };