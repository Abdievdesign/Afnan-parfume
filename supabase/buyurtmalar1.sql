-- «buyurtmalar1» jadvali. Supabase → SQL Editor'da bir marta ishga tushiring.
create table if not exists public.buyurtmalar1 (
  id          bigint generated always as identity primary key,
  yaratilgan  timestamptz not null default now(),
  ism         text        not null,
  telefon     text        not null,
  izoh        text,
  mahsulotlar jsonb       not null,   -- [{ "nomi", "soni", "narxi", "summa" }]
  jami        integer     not null,   -- so'mda
  rozilik     boolean     not null default false
);

-- RLS yoqiladi va hech qanday siyosat qo'shilmaydi: brauzerdagi ochiq kalit bilan
-- jadvalni o'qib ham, yozib ham bo'lmaydi. Netlify funksiyasidagi maxfiy kalit RLS'ni chetlab o'tadi.
alter table public.buyurtmalar1 enable row level security;

-- Yangi Supabase loyihalarida jadvallarga API rollari uchun huquq avtomatik berilmaydi.
-- Busiz Netlify funksiyasi "permission denied for table buyurtmalar1" (403) xatosini oladi.
grant select, insert on table public.buyurtmalar1 to service_role;

-- Maxfiylik siyosatidagi saqlash muddati (12 oy) o'tgan buyurtmalarni o'chirish:
-- delete from public.buyurtmalar1 where yaratilgan < now() - interval '12 months';
