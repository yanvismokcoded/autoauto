const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'config.json');
let data = {};

try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('config.json не найден или битый');
  process.exit(1);
}

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { data, save };
