import { createClient } from '@supabase/supabase-js';

const OWNER_KEY_STORAGE = 'music-caption-owner-key';

function createOwnerKey() {
  if ('crypto' in window && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOwnerKey() {
  const existing = localStorage.getItem(OWNER_KEY_STORAGE);
  if (existing) {
    return existing;
  }

  const next = createOwnerKey();
  localStorage.setItem(OWNER_KEY_STORAGE, next);
  return next;
}

export const ownerKey = getOwnerKey();

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      global: {
        headers: {
          'x-music-caption-owner': ownerKey,
        },
      },
    })
  : null;
