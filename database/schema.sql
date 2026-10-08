create extension if not exists pgcrypto with schema extensions;

create or replace function public.music_caption_request_owner_key()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    (
      case
        when nullif(current_setting('request.headers', true), '') is null then '{}'::jsonb
        else current_setting('request.headers', true)::jsonb
      end
    ) ->> 'x-music-caption-owner',
    ''
  );
$$;

create table if not exists public.music_caption_projects (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  title text not null default 'Untitled Session',
  artist text,
  audio_path text,
  audio_name text,
  duration numeric(12, 3) not null default 0,
  raw_text text not null default '',
  cues jsonb not null default '[]'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint music_caption_owner_key_length check (char_length(owner_key) between 16 and 128),
  constraint music_caption_cues_array check (jsonb_typeof(cues) = 'array'),
  constraint music_caption_notes_object check (jsonb_typeof(notes) = 'object'),
  constraint music_caption_settings_object check (jsonb_typeof(settings) = 'object')
);

create index if not exists music_caption_projects_owner_updated_idx
  on public.music_caption_projects (owner_key, updated_at desc);

create or replace function public.set_music_caption_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_music_caption_projects_updated_at on public.music_caption_projects;
create trigger set_music_caption_projects_updated_at
before update on public.music_caption_projects
for each row execute function public.set_music_caption_updated_at();

alter table public.music_caption_projects enable row level security;

grant select, insert, update, delete on table public.music_caption_projects to anon, authenticated;
grant execute on function public.music_caption_request_owner_key() to anon, authenticated;

drop policy if exists "music_caption_projects_select_own" on public.music_caption_projects;
drop policy if exists "music_caption_projects_insert_own" on public.music_caption_projects;
drop policy if exists "music_caption_projects_update_own" on public.music_caption_projects;
drop policy if exists "music_caption_projects_delete_own" on public.music_caption_projects;

create policy "music_caption_projects_select_own"
on public.music_caption_projects
for select
to anon, authenticated
using (owner_key = public.music_caption_request_owner_key());

create policy "music_caption_projects_insert_own"
on public.music_caption_projects
for insert
to anon, authenticated
with check (owner_key = public.music_caption_request_owner_key());

create policy "music_caption_projects_update_own"
on public.music_caption_projects
for update
to anon, authenticated
using (owner_key = public.music_caption_request_owner_key())
with check (owner_key = public.music_caption_request_owner_key());

create policy "music_caption_projects_delete_own"
on public.music_caption_projects
for delete
to anon, authenticated
using (owner_key = public.music_caption_request_owner_key());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music-caption-audio',
  'music-caption-audio',
  false,
  52428800,
  array[
    'audio/aac',
    'audio/flac',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/wave',
    'audio/webm',
    'audio/x-flac',
    'audio/x-wav'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "music_caption_audio_select_own" on storage.objects;
drop policy if exists "music_caption_audio_insert_own" on storage.objects;
drop policy if exists "music_caption_audio_update_own" on storage.objects;
drop policy if exists "music_caption_audio_delete_own" on storage.objects;

create policy "music_caption_audio_select_own"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'music-caption-audio'
  and (storage.foldername(name))[1] = public.music_caption_request_owner_key()
);

create policy "music_caption_audio_insert_own"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'music-caption-audio'
  and (storage.foldername(name))[1] = public.music_caption_request_owner_key()
);

create policy "music_caption_audio_update_own"
on storage.objects
for update
to anon, authenticated
using (
  bucket_id = 'music-caption-audio'
  and (storage.foldername(name))[1] = public.music_caption_request_owner_key()
)
with check (
  bucket_id = 'music-caption-audio'
  and (storage.foldername(name))[1] = public.music_caption_request_owner_key()
);

create policy "music_caption_audio_delete_own"
on storage.objects
for delete
to anon, authenticated
using (
  bucket_id = 'music-caption-audio'
  and (storage.foldername(name))[1] = public.music_caption_request_owner_key()
);
