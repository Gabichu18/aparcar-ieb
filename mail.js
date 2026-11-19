// Email sending. Three modes, picked from environment variables:
// - BREVO_API_KEY set: send through Brevo's free HTTP API (works on Render's free plan,
//   which blocks normal SMTP ports). MAIL_FROM must be a sender verified in Brevo.
// - SMTP_URL set: send through any SMTP server (e.g. on your own computer or a paid host).
// - neither: test mode, emails are printed in the logs.
const MAIL_FROM = process.env.MAIL_FROM || 'Aparcar IEB <no-reply@example.com>';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SMTP_URL = process.env.SMTP_URL || '';
const mailMode = BREVO_API_KEY ? 'brevo' : SMTP_URL ? 'smtp' : 'console';

function parseFrom(from) {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'Aparcar IEB', email: m[2] } : { name: 'Aparcar IEB', email: from.trim() };
}

let smtp = null;

// Returns true when the email was handed to the provider (or printed in test mode).
async function sendMail(to, subject, text) {
  try {
    if (mailMode === 'console') {
      console.log(`\n[TEST EMAIL] to=${to}\nSubject: ${subject}\n${text}\n`);
      return true;
    }
    if (mailMode === 'brevo') {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(MAIL_FROM), to: [{ email: to }], subject, textContent: text }),
      });
      if (!res.ok) {
        console.error('email failed (brevo)', res.status, await res.text().catch(() => ''));
        return false;
      }
      return true;
    }
    smtp = smtp || require('nodemailer').createTransport(SMTP_URL);
    await smtp.sendMail({ from: MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error('email failed', err.message);
    return false;
  }
}

module.exports = { sendMail, mailMode };
