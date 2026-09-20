const fs = require('fs');
const path = require('path');

const VOLUME_DIR = process.env.CONFIG_DIR || '/app/data';
const file = path.join(VOLUME_DIR, 'config.json');
const seedFile = path.join(__dirname, 'config.json');
let data = {};

console.log('config.js: VOLUME_DIR=', VOLUME_DIR, 'file=', file);
try {
  console.log('config.js: VOLUME_DIR exists?', fs.existsSync(VOLUME_DIR));
  if (fs.existsSync(VOLUME_DIR)) {
    console.log('config.js: VOLUME_DIR contents:', fs.readdirSync(VOLUME_DIR));
  } else {
    fs.mkdirSync(VOLUME_DIR, { recursive: true });
  }
  const fileExists = fs.existsSync(file);
  console.log('config.js: config.json on volume exists?', fileExists);
  if (!fileExists) {
    // Первый запуск: на volume ещё нет конфига — берём стартовый из репозитория
    if (fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, file);
      console.log('config.js: seeded config.json onto volume at', file);
    } else {
      fs.writeFileSync(file, JSON.stringify({}, null, 2));
    }
  } else {
    const stat = fs.statSync(file);
    console.log('config.js: existing file size/mtime:', stat.size, stat.mtime);
  }
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('config.js: loaded session length =', (data.session || '').length);

  // Новые настройки: если их ещё нет в config.json на volume — дописываем один раз.
  // false = бот отвечает только на ответы на свои сообщения, а не на все общие предложения в чате.
  // Чтобы вернуть прежнее поведение, поменяй значение на true прямо в config.json на volume.
  if (data.answerGeneralOffers === undefined) {
    data.answerGeneralOffers = false;
    save();
    console.log('config.js: added answerGeneralOffers=false');
  }
} catch (e) {
  console.error('config.json не найден или битый:', e.message);
  process.exit(1);
}

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('config.js: save() wrote to', file, '- session length =', (data.session || '').length);
}

module.exports = { data, save };
