const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const { computeCheck } = require('telegram/Password');

class Userbot {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.client = null;
    this.phoneCodeHash = null;
  }

  init() {
    const session = this.config.data.session || '';
    this.client = new TelegramClient(
      new StringSession(session),
      this.config.data.apiId,
      this.config.data.apiHash,
      { connectionRetries: 5 }
    );
    return this.client;
  }

  async connect() {
    if (!this.client) this.init();
    await this.client.connect();
    return this.client;
  }

  async sendCode(phone) {
    const result = await this.client.sendCode(
      { apiId: this.config.data.apiId, apiHash: this.config.data.apiHash },
      phone
    );
    console.log('sendCode result:', JSON.stringify(result));
    this.phoneCodeHash = result.phoneCodeHash;
    return result;
  }

  async signIn(phone, code) {
    const cleanCode = String(code).replace(/\D/g, '');
    try {
      await this.client.invoke(new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCode: cleanCode,
        phoneCodeHash: this.phoneCodeHash
      }));
    } catch (e) {
      if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return { twofa: true };
      }
      throw e;
    }
    this.saveSession();
    return { twofa: false };
  }

  async checkPassword(password) {
    const pwd = await this.client.invoke(new Api.account.GetPassword());
    const computed = await computeCheck(pwd, password);
    await this.client.invoke(new Api.auth.CheckPassword({ password: computed }));
    this.saveSession();
  }

  saveSession() {
    const session = this.client.session.save();
    this.config.data.session = session;
    this.config.save();
  }

  async isAuthorized() {
    try {
      await this.client.getMe();
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = Userbot;
