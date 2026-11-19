// Optional Telegram alerts (free). Set TELEGRAM_BOT_TOKEN (from @BotFather) to turn it on.
// Students link their account once: the app gives them a t.me/<bot>?start=<code> link, Telegram
// sends "/start <code>" to our webhook, and we remember their chat id.
const crypto = require('node:crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org') + '/bot' + TOKEN;
const enabled = Boolean(TOKEN);
// Secret path + header so only Telegram can call the webhook.
const WEBHOOK_SECRET = TOKEN ? crypto.createHash('sha256').update('tg-webhook:' + TOKEN).digest('hex').slice(0, 40) : '';
let botUsername = process.env.TELEGRAM_BOT_USERNAME || '';

async function call(method, body) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.error('telegram', method, 'failed:', data.description || res.status);
    return data.ok ? data.result : null;
  } catch (err) {
    console.error('telegram', method, 'failed:', err.message);
    return null;
  }
}

async function setup(appUrl) {
  if (!enabled) return;
  if (!botUsername) {
    const me = await call('getMe');
    if (me) botUsername = me.username;
  }
  if (appUrl.startsWith('https://')) {
    await call('setWebhook', {
      url: `${appUrl}/api/telegram/webhook/${WEBHOOK_SECRET}`,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
    });
  }
  console.log(`Telegram alerts on (@${botUsername || '?'})`);
}

const linkUrl = (code) => (botUsername ? `https://t.me/${botUsername}?start=${code}` : null);

function sendAlert(chatId, alertId, text) {
  return call('sendMessage', {
    chat_id: chatId, text,
    reply_markup: { inline_keyboard: [[
      { text: '🚶 Voy de camino', callback_data: `coming:${alertId}` },
      { text: '✅ Ya lo he movido', callback_data: `moved:${alertId}` },
    ]] },
  });
}
const sendText = (chatId, text) => call('sendMessage', { chat_id: chatId, text });

module.exports = { enabled, WEBHOOK_SECRET, setup, linkUrl, sendAlert, sendText, call, get botUsername() { return botUsername; } };
