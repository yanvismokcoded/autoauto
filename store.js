const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'store.json');
let data = { tapped: {} };

if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = { tapped: {} };
  }
}

const contexts = new Map();

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { data, save, contexts };
