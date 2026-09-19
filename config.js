const fs = require('fs');
const path = require('path');

const VOLUME_DIR = process.env.CONFIG_DIR || '/app/data';
const file = path.join(VOLUME_DIR, 'config.json');
const seedFile = path.join(__dirname, 'config.json');
let data = {};

try {
  if (!fs.existsSync(VOLUME_DIR)) {
    fs.mkdirSync(VOLUME_DIR, { recursive: true });
  }
  if (!fs.existsSync(file)) {
    // Первый запуск: на volume ещё нет конфига — берём стартовый из репозитория
    if (fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, file);
      console.log('config.js: seeded config.json onto volume at', file);
    } else {
      fs.writeFileSync(file, JSON.stringify({}, null, 2));
    }
  }
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('config.json не найден или битый:', e.message);
  process.exit(1);
}

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { data, save };
