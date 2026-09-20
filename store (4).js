const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'store.json');
let data = { tapped: {}, users: {}, pendingKeys: {} };

if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = { tapped: {}, users: {}, pendingKeys: {} };
  }
}

// На случай если store.json уже существовал, но без новых полей
if (!data.users) data.users = {};
if (!data.pendingKeys) data.pendingKeys = {};

const contexts = new Map();
const ownPosts = new Set();

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { data, save, contexts, ownPosts };
