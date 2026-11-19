// Aparcar IEB: sends the app's emails from your own Gmail, for free.
// Setup: script.google.com → New project → paste this file → change SECRET →
// Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone" → Deploy.
// Copy the Web app URL into Render as GOOGLE_SCRIPT_URL and SECRET as GOOGLE_SCRIPT_SECRET.

const SECRET = 'CHANGE-ME-to-a-long-random-text';
// Only university addresses can receive emails, so the script can't be abused for spam.
const ALLOWED_DOMAINS = ['ieb.es', 'alumni-ieb.es'];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return reply({ ok: false, error: 'forbidden' });
    const to = String(d.to || '').trim().toLowerCase();
    const domain = to.split('@')[1] || '';
    if (!ALLOWED_DOMAINS.includes(domain)) return reply({ ok: false, error: 'recipient not allowed' });
    MailApp.sendEmail({ to: to, subject: String(d.subject || '').slice(0, 200), body: String(d.text || '').slice(0, 5000), name: 'Aparcar IEB' });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

// Run this once from the editor (select "authorize" and click Run) to give the script permission to send email.
function authorize() {
  MailApp.getRemainingDailyQuota();
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
