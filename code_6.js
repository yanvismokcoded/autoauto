const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

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
    const result = await this.client.sendCode(phone, this.config.data.apiId, this.config.data.apiHash);
    this.phoneCodeHash = result.phoneCodeHash;
    return result;
  }

  async signIn(phone, code) {
    try {
      await this.client.invoke(new Api.Auth.SignIn({
        phoneNumber: phone,
        phoneCode: code,
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
    const pwd = await this.client.invoke(new Api.Account.GetPassword());
    const computed = await this.client.utils.computeCheck(pwd, password);
    await this.client.invoke(new Api.Auth.CheckPassword({ password: computed }));
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