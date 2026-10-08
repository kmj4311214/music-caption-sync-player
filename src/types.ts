export type CaptionCue = {
  id: string;
  text: string;
  start: number;
  end: number;
  note: string;
};

export type ProjectRecord = {
  id: string;
  owner_key: string;
  title: string;
  artist: string | null;
  audio_path: string | null;
  audio_name: string | null;
  duration: number | null;
  raw_text: string;
  cues: CaptionCue[];
  notes: Record<string, string>;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
