// Buyurtmani Telegram'ga yuboruvchi Netlify funksiyasi.
// Buyurtma avval Supabase'dagi "buyurtmalar1" jadvaliga yoziladi, keyin Telegram'ga yuboriladi.
// Barcha kalitlar faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SECRET_KEY
// Supabase'ga yozib bo'lmasa ham Telegram xabari yuboriladi, xato faqat logga yoziladi.

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

// Muhit o'zgaruvchilaridagi tez-tez uchraydigan xatolarni tuzatadi:
// bo'sh joy, qo'shtirnoq, oxiridagi "/" yoki "/rest/v1".
function supabaseConfig() {
  const strip = v => (v || '').trim().replace(/^["']|["']$/g, '').trim();
  const url = strip(process.env.SUPABASE_URL).replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = strip(process.env.SUPABASE_SECRET_KEY);
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // Eski JWT ko'rinishidagi kalitlar Authorization sarlavhasini ham talab qiladi; yangi sb_secret_ kalitlar — yo'q.
  if (key && !key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return { url, key, headers };
}

// Kalit turini aniqlaydi (kalitning o'zini oshkor qilmasdan).
function keyKind(key) {
  if (!key) return 'yo‘q';
  if (key.startsWith('sb_secret_')) return 'sb_secret (to‘g‘ri)';
  if (key.startsWith('sb_publishable_')) return 'sb_publishable (NOTO‘G‘RI — secret kalit kerak)';
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    return role === 'service_role' ? 'service_role JWT (to‘g‘ri)' : `${role} JWT (NOTO‘G‘RI — service_role kerak)`;
  } catch { return 'noma’lum format (NOTO‘G‘RI)'; }
}

// Buyurtmani Supabase'ga yozadi. Hech qachon xato tashlamaydi — faqat logga yozadi.
async function saveToSupabase(row) {
  const { url, key, headers } = supabaseConfig();
  if (!url || !key) {
    console.error('SUPABASE_URL yoki SUPABASE_SECRET_KEY sozlanmagan — buyurtma bazaga yozilmadi');
    return;
  }
  try {
    const r = await fetch(`${url}/rest/v1/buyurtmalar1`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(row), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error('Supabase xatosi', r.status, await r.text());
  } catch (e) {
    console.error('Supabase bilan bog‘lanishda xato', e);
  }
}

// /api/order?tekshir — Supabase sozlamasini tekshiradi. Jadvalga hech narsa yozmaydi,
// kalitlarning o'zini ko'rsatmaydi.
async function checkSupabase() {
  const { url, key, headers } = supabaseConfig();
  const res = {
    SUPABASE_URL: url ? url.replace(/^https?:\/\//, '') : 'yo‘q',
    SUPABASE_SECRET_KEY: keyKind(key),
    TELEGRAM: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? 'sozlangan' : 'yo‘q',
  };
  if (!url || !key) return { ...res, natija: 'Netlify funksiyasi Supabase o‘zgaruvchilarini ko‘rmayapti. Scope’da “Functions” belgilanganini tekshiring va qayta deploy qiling.' };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    res.ogohlantirish = 'SUPABASE_URL https://<loyiha-id>.supabase.co ko‘rinishida bo‘lishi kerak (Project Settings → API / Data API).';
  try {
    const cols = 'id,yaratilgan,ism,telefon,izoh,mahsulotlar,jami,rozilik';
    const r = await fetch(`${url}/rest/v1/buyurtmalar1?select=${cols}&limit=1`, { headers, signal: AbortSignal.timeout(5000) });
    const body = await r.text();
    res.supabase_status = r.status;
    if (r.ok) res.natija = 'Hammasi joyida: jadval topildi, kalit ishlayapti.';
    else res.natija = 'Supabase xato qaytardi', res.supabase_javobi = body.slice(0, 400);
  } catch (e) {
    res.natija = 'Supabase manziliga ulanib bo‘lmadi — SUPABASE_URL noto‘g‘ri.';
    res.xato = String(e?.cause?.code || e?.message || e).slice(0, 200);
  }
  return res;
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}

export default async (req, context) => {
  if (req.method === 'GET' && new URL(req.url).searchParams.has('tekshir')) return json(200, await checkSupabase());
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
  if (data.rozilik !== true) return json(400, { ok: false, error: 'Buyurtma berish uchun rozilik belgisini qo‘ying.' });

  if (!Array.isArray(data.items) || !data.items.length || data.items.length > LIMITS.items)
    return json(400, { ok: false, error: 'Savat bo‘sh.' });

  const lines = [];
  const mahsulotlar = [];
  let total = 0;
  for (const it of data.items) {
    const p = CATALOG[it?.i];
    const q = Number(it?.q);
    if (!p || !Number.isInteger(q) || q < 1 || q > LIMITS.qty) return json(400, { ok: false, error: 'Savatda xato bor.' });
    total += p.price * q;
    mahsulotlar.push({ nomi: p.name, soni: q, narxi: p.price, summa: p.price * q });
    lines.push(`• ${p.name} — ${q} dona × ${fmt(p.price)} = ${fmt(p.price * q)}`);
  }

  await saveToSupabase({ ism: name, telefon: phone, izoh: comment || null, mahsulotlar, jami: total, rozilik: true });

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
