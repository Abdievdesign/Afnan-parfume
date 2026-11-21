// Buyurtmani Telegram'ga yuboruvchi Netlify funksiyasi.
// Token va chat ID faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

// Narxlar serverda ham saqlanadi, shunda brauzerdan soxta narx yuborib bo'lmaydi.
// index.html dagi "products" ro'yxati o'zgarsa, bu ro'yxatni ham xuddi shu tartibda yangilang.
const CATALOG = [
  { name: 'Dr. Rashel Penka', price: 35000 },
  { name: 'Trichup qora xina', price: 15000 },
  { name: 'Mixit Shampoo', price: 75000 },
  { name: 'Trichup Shampoo', price: 34000 },
];

const LIMITS = { name: 60, phone: 20, comment: 500, body: 5000, items: 20, qty: 99 };
const MIN_FILL_MS = 2000;            // formani 2 soniyadan tez to'ldirish — bot belgisi
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;                  // bir IP dan 10 daqiqada 5 tagacha buyurtma
const hits = new Map();              // oddiy, har bir funksiya nusxasi uchun alohida

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const fmt = n => n.toLocaleString('ru-RU').replace(/\s/g, ' ') + ' so‘m';
const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim() : '');

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Faqat POST so‘rov qabul qilinadi.' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan');
    return json(500, { ok: false, error: 'Server sozlanmagan.' });
  }

  const raw = await req.text();
  if (raw.length > LIMITS.body) return json(413, { ok: false, error: 'So‘rov juda katta.' });
  let data;
  try { data = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'Noto‘g‘ri so‘rov.' }); }

  // Spamdan himoya: yashirin maydon to'ldirilgan yoki forma juda tez yuborilgan bo'lsa
  if (clean(data.website)) return json(200, { ok: true });
  if (!(Number(data.elapsed) >= MIN_FILL_MS)) return json(400, { ok: false, error: 'Iltimos, formani qaytadan yuboring.' });

  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (rateLimited(ip)) return json(429, { ok: false, error: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.' });

  const name = clean(data.name);
  const phone = clean(data.phone);
  const comment = clean(data.comment);
  const digits = phone.replace(/\D/g, '');

  if (name.length < 2 || name.length > LIMITS.name) return json(400, { ok: false, error: 'Ismni to‘g‘ri kiriting.' });
  if (phone.length > LIMITS.phone || !/^[\d\s()+-]+$/.test(phone) || digits.length < 9 || digits.length > 13)
    return json(400, { ok: false, error: 'Telefon raqamini to‘g‘ri kiriting.' });
  if (comment.length > LIMITS.comment) return json(400, { ok: false, error: 'Izoh juda uzun.' });

  if (!Array.isArray(data.items) || !data.items.length || data.items.length > LIMITS.items)
    return json(400, { ok: false, error: 'Savat bo‘sh.' });

  const lines = [];
  let total = 0;
  for (const it of data.items) {
    const p = CATALOG[it?.i];
    const q = Number(it?.q);
    if (!p || !Number.isInteger(q) || q < 1 || q > LIMITS.qty) return json(400, { ok: false, error: 'Savatda xato bor.' });
    total += p.price * q;
    lines.push(`• ${p.name} — ${q} dona × ${fmt(p.price)} = ${fmt(p.price * q)}`);
  }

  const text = [
    '🛍 Yangi buyurtma — Afnan parfume',
    '',
    ...lines,
    '',
    `Jami: ${fmt(total)}`,
    '',
    `👤 Ism: ${name}`,
    `📞 Telefon: ${phone}`,
    `📝 Manzil / izoh: ${comment || '—'}`,
  ].join('\n');

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!r.ok) {
      console.error('Telegram xatosi', r.status, await r.text());
      return json(502, { ok: false, error: 'Buyurtmani yuborib bo‘lmadi.' });
    }
  } catch (e) {
    console.error('Telegram bilan bog‘lanishda xato', e);
    return json(502, { ok: false, error: 'Buyurtmani yuborib bo‘lmadi.' });
  }

  return json(200, { ok: true });
};

export const config = { path: '/api/order' };
