import type { SupabaseClient } from '@supabase/supabase-js';

export const AUDIO_BUCKET = 'music-caption-audio';
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return typeof error === 'string' ? error : '연결을 확인한 뒤 다시 시도해주세요.';
}

export function audioContentType(name: string, type: string) {
  const extensions: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', webm: 'audio/webm',
  };
  return extensions[name.split('.').pop()?.toLowerCase() ?? ''] || type || 'audio/mpeg';
}

type AudioUpload = {
  owner: string;
  path: string | null;
  source: Blob | null;
  name: string | null;
  makeId: () => string;
};

export async function ensureAudioStored(client: SupabaseClient, audio: AudioUpload) {
  const bucket = client.storage.from(AUDIO_BUCKET);
  if (audio.path) {
    const { data, error } = await bucket.exists(audio.path);
    if (data) {
      return audio.path;
    }
    const status = error && 'status' in error ? Number(error.status) : 0;
    if (error && ![400, 404].includes(status)) {
      throw error;
    }
  }
  if (!audio.source) {
    if (audio.path || audio.name) {
      throw new Error('저장된 음원이 없습니다. 원래 음원을 다시 선택하고 저장해주세요. 자막 기록은 유지됩니다.');
    }
    return null;
  }
  if (audio.source.size > MAX_AUDIO_BYTES) {
    throw new Error('음원은 50MB 이하 파일을 선택해주세요.');
  }
  const safeName = (audio.name || 'audio')
    .normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const path = `${audio.owner}/${audio.makeId()}-${safeName || 'audio'}`;
  const { error } = await bucket.upload(path, audio.source, {
    cacheControl: '3600',
    contentType: audioContentType(audio.name || '', audio.source.type),
    upsert: false,
  });
  if (error) {
    throw error;
  }
  return path;
}
