-- Supabase SQL Editor에서 전체 실행하세요.
create table if not exists public.albums (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 80),
  cover_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  album_id uuid not null references public.albums(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.albums enable row level security;
alter table public.photos enable row level security;

drop policy if exists "Public can read albums" on public.albums;
create policy "Public can read albums" on public.albums for select to anon, authenticated using (true);
drop policy if exists "Public can read photos" on public.photos;
create policy "Public can read photos" on public.photos for select to anon, authenticated using (true);

-- 공개 읽기만 허용합니다. 쓰기는 비밀번호를 검사하는 Edge Function(service role)만 수행합니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 6291456, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=6291456, allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Public can view photo files" on storage.objects;
create policy "Public can view photo files" on storage.objects for select to anon, authenticated using (bucket_id='photos');
