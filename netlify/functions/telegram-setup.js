// Botni sozlash sahifasi: /api/telegram-setup
// Ochilganda: webhook'ni shu saytdagi /api/telegram ga o'rnatadi, buyruqlar ro'yxatini va
// «Afnan parfumes» tugmasini (saytni Telegram Mini App sifatida ochadi) sozlaydi, natijani o'zbekcha ko'rsatadi.
// Token sahifada hech qachon ko'rsatilmaydi.

import { createHash } from 'node:crypto';

const COMMANDS = [
  { command: 'start', description: 'Buyruqlar ro‘yxati' },
  { command: 'bugun', description: 'Bugungi buyurtmalar soni va summasi' },
  { command: 'buyurtmalar', description: 'Oxirgi 10 ta buyurtma' },
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async req => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const hide = s => (token ? String(s).split(token).join('***') : String(s));
  const origin = new URL(req.url).origin.replace(/^http:/, 'https:');
  const steps = [];

  async function tg(method, body, label) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}), signal: AbortSignal.timeout(8000),
      });
      const data = await r.json().catch(() => ({}));
      steps.push({ label, ok: !!data.ok, note: data.ok ? '' : hide(data.description || `HTTP ${r.status}`) });
      return data.ok ? data.result : null;
    } catch (e) {
      steps.push({ label, ok: false, note: hide(e?.message || e) });
      return null;
    }
  }

  let bot = null;
  if (!token) {
    steps.push({ label: 'TELEGRAM_BOT_TOKEN', ok: false, note: 'Netlify muhit o‘zgaruvchilarida topilmadi.' });
  } else {
    bot = await tg('getMe', {}, 'Bot tokenini tekshirish');
    if (bot) {
      const secret = createHash('sha256').update(token).digest('hex').slice(0, 32);
      await tg('setWebhook', {
        url: `${origin}/api/telegram`, secret_token: secret, allowed_updates: ['message'],
      }, `Webhook o‘rnatish → ${origin}/api/telegram`);
      await tg('setMyCommands', { commands: COMMANDS }, 'Buyruqlar ro‘yxatini sozlash (/start, /bugun, /buyurtmalar)');
      await tg('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Afnan parfumes', web_app: { url: `${origin}/` } },
      }, `«Afnan parfumes» tugmasi → ${origin}/`);
    }
  }
  if (!(process.env.TELEGRAM_CHAT_ID || '').trim())
    steps.push({ label: 'TELEGRAM_CHAT_ID', ok: false, note: 'Netlify muhit o‘zgaruvchilarida topilmadi — buyurtma buyruqlari hech kimga ishlamaydi.' });

  const allOk = steps.every(s => s.ok);
  const html = `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Bot sozlamasi — Afnan parfume</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F7F4EA;color:#132F18;padding:32px 16px}
  main{max-width:620px;margin:0 auto;background:#fff;border-radius:24px;padding:28px;box-shadow:0 18px 40px -28px rgba(19,47,24,.35)}
  h1{font-size:1.4rem;margin:0 0 6px}
  .lead{margin:0 0 22px;color:#5d6b5f}
  ul{list-style:none;padding:0;margin:0}
  li{padding:14px 0;border-top:1px solid rgba(19,47,24,.12);display:flex;gap:12px}
  .i{flex-shrink:0;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:.85rem}
  .ok .i{background:#132F18;color:#E5DA80}.no .i{background:#b3261e;color:#fff}
  small{display:block;color:#5d6b5f;margin-top:4px;word-break:break-word}
  .sum{margin-top:18px;padding:14px 16px;border-radius:16px;background:${allOk ? '#132F18' : '#fbe9e7'};color:${allOk ? '#E5DA80' : '#b3261e'};font-weight:600}
</style></head><body><main>
<h1>Telegram bot sozlamasi</h1>
<p class="lead">${bot ? `Bot: @${esc(bot.username)}` : 'Bot topilmadi'}</p>
<ul>${steps.map(s => `<li class="${s.ok ? 'ok' : 'no'}"><span class="i">${s.ok ? '✓' : '!'}</span><span>${esc(s.label)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span></li>`).join('')}</ul>
<div class="sum">${allOk
    ? 'Hammasi sozlandi. Botga /start yozib tekshiring.'
    : 'Ba’zi qadamlar bajarilmadi. Yuqoridagi xatolarni tuzatib, sahifani yangilang.'}</div>
</main></body></html>`;

  return new Response(html, {
    status: allOk ? 200 : 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};

export const config = { path: '/api/telegram-setup' };
