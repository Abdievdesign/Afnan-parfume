// Telegram bot webhook'i: /api/telegram
// Faqat Telegram'dan kelgan so'rovlarni qabul qiladi — X-Telegram-Bot-Api-Secret-Token sarlavhasi
// TELEGRAM_BOT_TOKEN ning sha256 xeshidan birinchi 32 belgiga teng bo'lishi shart
// (webhook'ni telegram-setup funksiyasi shu belgi bilan o'rnatadi).
// Buyurtmalar faqat TELEGRAM_CHAT_ID dagi chatga ko'rsatiladi.
// Kalitlar faqat muhit o'zgaruvchilaridan: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SECRET_KEY

import { createHash, timingSafeEqual } from 'node:crypto';

// Sayt buyurtmalarni shu jadvalga yozadi (netlify/functions/order.mjs).
const TABLE = 'buyurtmalar1';
const TZ = 'Asia/Tashkent';
const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // Toshkent: UTC+5, yozgi vaqt yo'q

const MENU_HINT = 'Buyurtma berish uchun pastdagi «Menyu» tugmasini bosing';
const HELP = [
  'Afnan parfume — buyurtmalar boti',
  '',
  '/bugun — bugungi buyurtmalar soni va jami summasi',
  '/buyurtmalar — oxirgi 10 ta buyurtma',
  '/start — buyruqlar ro‘yxati',
].join('\n');

const env = k => (process.env[k] || '').trim();
const fmt = n => Number(n || 0).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' so‘m';
const ok = () => new Response('ok');

const secretFor = token => createHash('sha256').update(token).digest('hex').slice(0, 32);

function sameSecret(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function supabase(query) {
  const strip = v => v.replace(/^["']|["']$/g, '').trim();
  const url = strip(env('SUPABASE_URL')).replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = strip(env('SUPABASE_SECRET_KEY'));
  if (!url || !key) throw new Error('SUPABASE_URL yoki SUPABASE_SECRET_KEY sozlanmagan');
  const headers = { apikey: key };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${url}/rest/v1/${TABLE}?${query}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function today() {
  // Toshkent vaqti bo'yicha bugungi kun boshi (UTC'da)
  const start = new Date(Math.floor((Date.now() + TZ_OFFSET_MS) / 86400000) * 86400000 - TZ_OFFSET_MS);
  const rows = await supabase(`select=jami&yaratilgan=gte.${encodeURIComponent(start.toISOString())}`);
  const sum = rows.reduce((s, r) => s + Number(r.jami || 0), 0);
  const date = start.toLocaleDateString('ru-RU', { timeZone: TZ });
  return `📅 Bugun (${date})\n\nBuyurtmalar soni: ${rows.length} ta\nJami summa: ${fmt(sum)}`;
}

async function latest() {
  const rows = await supabase('select=yaratilgan,ism,telefon,jami&order=yaratilgan.desc&limit=10');
  if (!rows.length) return 'Hozircha buyurtmalar yo‘q.';
  const time = iso => new Date(iso).toLocaleString('ru-RU', {
    timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
  return ['🧾 Oxirgi buyurtmalar', ...rows.map((r, n) =>
    `${n + 1}. ${time(r.yaratilgan)} — ${r.ism}\n📞 ${r.telefon} · ${fmt(r.jami)}`)].join('\n\n');
}

export default async req => {
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });

  const token = env('TELEGRAM_BOT_TOKEN');
  const ownerChat = env('TELEGRAM_CHAT_ID');
  if (!token || !ownerChat) {
    console.error('TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan');
    return new Response('Server sozlanmagan', { status: 500 });
  }
  if (!sameSecret(req.headers.get('x-telegram-bot-api-secret-token'), secretFor(token)))
    return new Response('Forbidden', { status: 403 });

  let update;
  try { update = await req.json(); } catch { return ok(); }
  const message = update?.message;
  const chatId = message?.chat?.id;
  if (!chatId) return ok();

  let text;
  if (String(chatId) !== ownerChat) {
    text = MENU_HINT;
  } else {
    const cmd = (message.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    try {
      if (cmd === '/bugun') text = await today();
      else if (cmd === '/buyurtmalar') text = await latest();
      else text = HELP;
    } catch (e) {
      console.error('Bot buyrug‘ida xato', e);
      text = 'Ma’lumotlarni olib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.';
    }
  }

  // Javob to'g'ridan-to'g'ri webhook javobi orqali yuboriladi — alohida so'rov kerak emas.
  return Response.json({ method: 'sendMessage', chat_id: chatId, text, disable_web_page_preview: true });
};

export const config = { path: '/api/telegram' };
