import {
  AlignLeft,
  BadgeCheck,
  ChevronRight,
  Clock3,
  Download,
  FileAudio,
  Gauge,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScissorsLineDashed,
  SkipForward,
  Trash2,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoFitCaptionText } from './AutoFitCaptionText';
import { AUDIO_BUCKET, isSupabaseConfigured, ownerKey, supabase } from './lib/supabase';
import type { CaptionCue, ProjectRecord, SaveState } from './types';

const initialText = `첫 번째 문장을 여기에 입력하세요.
오디오를 재생하면서 현재 시간에 맞춰 줄을 찍습니다.
큰 화면에서는 현재 문장만 또렷하게 보입니다.`;

const makeId = () => {
  if ('crypto' in window && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clampTime = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

const formatTime = (seconds: number) => {
  const safe = clampTime(seconds);
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${minutes}:${rest.toString().padStart(2, '0')}.${tenths}`;
};

const parseText = (text: string, previous: CaptionCue[] = []) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const old = previous[index];
    return {
      id: old?.id ?? makeId(),
      text: line,
      start: old?.start ?? index * 3,
      end: old?.end ?? index * 3 + 2.8,
      note: old?.note ?? '',
    };
  });
};

const normalizeFileName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('Jumprope Caption Session');
  const [artist, setArtist] = useState('');
  const [rawText, setRawText] = useState(initialText);
  const [cues, setCues] = useState<CaptionCue[]>(() => parseText(initialText));
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncIndex, setSyncIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [status, setStatus] = useState('');
  const [theater, setTheater] = useState(false);

  const activeIndex = useMemo(() => {
    const found = cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end);
    if (found >= 0) {
      return found;
    }

    return cues.reduce((closest, cue, index) => {
      const previousDistance = Math.abs((cues[closest]?.start ?? 0) - currentTime);
      const nextDistance = Math.abs(cue.start - currentTime);
      return nextDistance < previousDistance ? index : closest;
    }, 0);
  }, [cues, currentTime]);

  const activeCue = cues[activeIndex];
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const completedLines = cues.filter((cue) => cue.end > cue.start).length;
  const totalWords = useMemo(
    () => rawText.split(/\s+/).filter(Boolean).length,
    [rawText],
  );

  const loadProjects = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const { data, error } = await supabase
      .from('music_caption_projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      setStatus(`불러오기 실패: ${error.message}`);
      return;
    }

    setProjects((data ?? []) as ProjectRecord[]);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration || 0);
    const updatePlaying = () => setIsPlaying(!audio.paused);
    const updatePaused = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('play', updatePlaying);
    audio.addEventListener('pause', updatePaused);
    audio.addEventListener('ended', updatePaused);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('play', updatePlaying);
      audio.removeEventListener('pause', updatePaused);
      audio.removeEventListener('ended', updatePaused);
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleTextChange = (value: string) => {
    setRawText(value);
    setCues((current) => parseText(value, current));
    setSaveState('idle');
  };

  const handleAudioChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(audioUrl);
    }

    setAudioFile(file);
    setAudioName(file.name);
    setAudioPath(null);
    setAudioUrl(URL.createObjectURL(file));
    setStatus(`${file.name} 선택됨`);
    setSaveState('idle');
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      fileInputRef.current?.click();
      return;
    }

    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = clampTime(value);
    setCurrentTime(audio.currentTime);
  };

  const updateCue = (index: number, patch: Partial<CaptionCue>) => {
    setCues((current) =>
      current.map((cue, cueIndex) => (cueIndex === index ? { ...cue, ...patch } : cue)),
    );
    setSaveState('idle');
  };

  const stampCue = (index: number) => {
    const time = currentTime;
    setCues((current) =>
      current.map((cue, cueIndex) => {
        if (cueIndex === index) {
          const nextStart = current[cueIndex + 1]?.start;
          return {
            ...cue,
            start: time,
            end: nextStart && nextStart > time ? nextStart : time + 2.5,
          };
        }

        if (cueIndex === index - 1) {
          return { ...cue, end: Math.max(cue.start + 0.1, time) };
        }

        return cue;
      }),
    );
    setSyncIndex(Math.min(index + 1, cues.length - 1));
    setSaveState('idle');
  };

  const stampNext = () => {
    stampCue(syncIndex);
  };

  const finishCue = () => {
    setCues((current) =>
      current.map((cue, index) => (index === syncIndex ? { ...cue, end: currentTime } : cue)),
    );
    setSyncIndex((index) => Math.min(index + 1, cues.length - 1));
    setSaveState('idle');
  };

  const spreadEvenly = () => {
    const baseDuration = duration || cues.length * 3;
    const step = baseDuration / Math.max(cues.length, 1);
    setCues((current) =>
      current.map((cue, index) => ({
        ...cue,
        start: Number((step * index).toFixed(2)),
        end: Number((step * (index + 1) - 0.08).toFixed(2)),
      })),
    );
    setSyncIndex(0);
    setSaveState('idle');
  };

  const shiftCues = (delta: number) => {
    setCues((current) =>
      current.map((cue) => ({
        ...cue,
        start: clampTime(cue.start + delta),
        end: clampTime(cue.end + delta),
      })),
    );
    setSaveState('idle');
  };

  const uploadAudio = async () => {
    if (!supabase || !audioFile) {
      return audioPath;
    }

    const safeName = normalizeFileName(audioFile.name) || `audio-${Date.now()}`;
    const path = `${ownerKey}/${makeId()}-${safeName}`;
    const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, audioFile, {
      cacheControl: '3600',
      contentType: audioFile.type || 'audio/mpeg',
      upsert: false,
    });

    if (error) {
      throw error;
    }

    setAudioPath(path);
    return path;
  };

  const saveProject = async () => {
    if (!supabase) {
      setStatus('Supabase 환경변수가 필요합니다.');
      setSaveState('error');
      return;
    }

    setSaveState('saving');
    setStatus('저장 중');

    try {
      const uploadedPath = await uploadAudio();
      const payload = {
        id: activeProjectId ?? undefined,
        owner_key: ownerKey,
        title: title.trim() || 'Untitled Session',
        artist: artist.trim() || null,
        audio_path: uploadedPath,
        audio_name: audioName,
        duration,
        raw_text: rawText,
        cues,
        notes: cues.reduce<Record<string, string>>((memo, cue) => {
          if (cue.note.trim()) {
            memo[cue.id] = cue.note;
          }
          return memo;
        }, {}),
        settings: { theater },
      };

      const { data, error } = await supabase
        .from('music_caption_projects')
        .upsert(payload)
        .select()
        .single();

      if (error) {
        throw error;
      }

      const saved = data as ProjectRecord;
      setActiveProjectId(saved.id);
      setProjects((current) => {
        const others = current.filter((project) => project.id !== saved.id);
        return [saved, ...others];
      });
      setSaveState('saved');
      setStatus('Supabase 저장 완료');
      setAudioFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      setStatus(`저장 실패: ${message}`);
      setSaveState('error');
    }
  };

  const loadProject = async (project: ProjectRecord) => {
    setActiveProjectId(project.id);
    setTitle(project.title);
    setArtist(project.artist ?? '');
    setRawText(project.raw_text);
    setCues(project.cues?.length ? project.cues : parseText(project.raw_text));
    setAudioPath(project.audio_path);
    setAudioName(project.audio_name);
    setDuration(Number(project.duration ?? 0));
    setSaveState('saved');
    setStatus(`${project.title} 불러옴`);

    if (!supabase || !project.audio_path) {
      setAudioUrl('');
      return;
    }

    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(project.audio_path);
    if (error) {
      setStatus(`오디오 불러오기 실패: ${error.message}`);
      setAudioUrl('');
      return;
    }

    if (audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(URL.createObjectURL(data));
  };

  const deleteProject = async (project: ProjectRecord) => {
    if (!supabase || !window.confirm(`${project.title} 삭제할까요?`)) {
      return;
    }

    const { error } = await supabase.from('music_caption_projects').delete().eq('id', project.id);
    if (error) {
      setStatus(`삭제 실패: ${error.message}`);
      return;
    }

    if (project.audio_path) {
      await supabase.storage.from(AUDIO_BUCKET).remove([project.audio_path]);
    }

    setProjects((current) => current.filter((item) => item.id !== project.id));
    if (activeProjectId === project.id) {
      setActiveProjectId(null);
    }
    setStatus('삭제 완료');
  };

  const newProject = () => {
    setActiveProjectId(null);
    setTitle('Jumprope Caption Session');
    setArtist('');
    setRawText(initialText);
    setCues(parseText(initialText));
    setAudioFile(null);
    setAudioPath(null);
    setAudioName(null);
    setAudioUrl('');
    setDuration(0);
    setCurrentTime(0);
    setSyncIndex(0);
    setSaveState('idle');
    setStatus('새 프로젝트');
  };

  const downloadJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            title,
            artist,
            audioName,
            duration,
            rawText,
            cues,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${normalizeFileName(title) || 'caption-sync'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveButtonLabel =
    saveState === 'saving' ? '저장 중' : saveState === 'saved' ? '저장됨' : '저장';

  return (
    <main className={theater ? 'app theater' : 'app'}>
      <header className="topbar">
        <div>
          <p className="eyebrow">JUMPROPE PLAYER by SEOLIN</p>
          <h1>Caption Sync Player</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={newProject} title="새 프로젝트">
            <Plus size={19} />
          </button>
          <button className="gold-button" type="button" onClick={saveProject} disabled={saveState === 'saving'}>
            {saveState === 'saved' ? <BadgeCheck size={18} /> : <Save size={18} />}
            {saveButtonLabel}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="project-rail">
          <div className="panel-heading">
            <ListMusic size={18} />
            <span>프로젝트</span>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <article
                className={project.id === activeProjectId ? 'project-card active' : 'project-card'}
                key={project.id}
              >
                <button type="button" onClick={() => void loadProject(project)}>
                  <strong>{project.title}</strong>
                  <span>{project.audio_name ?? '오디오 없음'}</span>
                </button>
                <button
                  className="ghost-icon"
                  type="button"
                  onClick={() => void deleteProject(project)}
                  title="삭제"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {projects.length === 0 && <div className="empty">저장된 항목 없음</div>}
          </div>
          <div className="status-line">{isSupabaseConfigured ? status || '연결됨' : '환경변수 필요'}</div>
        </aside>

        <section className="stage-column">
          <div className="caption-stage">
            <div className="stage-meta">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="caption-stack">
              <p className="caption-side">
                <AutoFitCaptionText text={cues[activeIndex - 1]?.text ?? ''} expanded={theater} />
              </p>
              <h2>
                <AutoFitCaptionText text={activeCue?.text ?? '오디오와 자막을 준비하세요'} expanded={theater} />
              </h2>
              <p className="caption-side">
                <AutoFitCaptionText text={cues[activeIndex + 1]?.text ?? ''} expanded={theater} />
              </p>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="transport">
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept="audio/*"
              onChange={handleAudioChange}
            />
            <button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <FileAudio size={18} />
              오디오
            </button>
            <button className="play-button" type="button" onClick={() => void togglePlay()} title="재생">
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <input
              className="time-slider"
              type="range"
              min="0"
              max={duration || 0}
              step="0.01"
              value={currentTime}
              onChange={(event) => seekTo(Number(event.target.value))}
            />
            <button className="tool-button" type="button" onClick={() => setTheater((value) => !value)}>
              <Mic2 size={18} />
              화면
            </button>
          </div>

          <audio ref={audioRef} src={audioUrl} preload="metadata" />

          <div className="metrics">
            <div>
              <Clock3 size={17} />
              <strong>{formatTime(duration)}</strong>
              <span>길이</span>
            </div>
            <div>
              <AlignLeft size={17} />
              <strong>{cues.length}</strong>
              <span>줄</span>
            </div>
            <div>
              <Gauge size={17} />
              <strong>{completedLines}</strong>
              <span>싱크</span>
            </div>
            <div>
              <WandSparkles size={17} />
              <strong>{totalWords}</strong>
              <span>단어</span>
            </div>
          </div>
        </section>

        <section className="editor-column">
          <div className="identity-row">
            <label>
              <span>제목</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>아티스트</span>
              <input value={artist} onChange={(event) => setArtist(event.target.value)} />
            </label>
          </div>

          <label className="lyrics-box">
            <span>가사 / 자막</span>
            <textarea value={rawText} onChange={(event) => handleTextChange(event.target.value)} />
          </label>

          <div className="sync-toolbar">
            <button className="gold-button" type="button" onClick={stampNext}>
              <ChevronRight size={18} />
              다음 줄
            </button>
            <button className="tool-button" type="button" onClick={finishCue}>
              <SkipForward size={18} />
              끝점
            </button>
            <button className="tool-button" type="button" onClick={spreadEvenly}>
              <ScissorsLineDashed size={18} />
              균등
            </button>
            <button className="icon-button" type="button" onClick={() => shiftCues(-0.2)} title="-0.2초">
              <RefreshCw size={17} />
            </button>
            <button className="icon-button" type="button" onClick={() => shiftCues(0.2)} title="+0.2초">
              <RefreshCw className="flip" size={17} />
            </button>
            <button className="icon-button" type="button" onClick={downloadJson} title="JSON 내보내기">
              <Download size={17} />
            </button>
          </div>

          <div className="cue-list">
            {cues.map((cue, index) => (
              <article className={index === activeIndex ? 'cue-row active' : 'cue-row'} key={cue.id}>
                <button className="cue-number" type="button" onClick={() => setSyncIndex(index)}>
                  {index + 1}
                </button>
                <button className="cue-text" type="button" onClick={() => seekTo(cue.start)}>
                  {cue.text}
                </button>
                <label>
                  <span>시작</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={cue.start}
                    onChange={(event) => updateCue(index, { start: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>끝</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={cue.end}
                    onChange={(event) => updateCue(index, { end: Number(event.target.value) })}
                  />
                </label>
                <button className="ghost-icon" type="button" onClick={() => stampCue(index)} title="현재 시간 입력">
                  <UploadCloud size={16} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="under-panel">
        <div className="reading-panel">
          <div className="panel-heading">
            <WandSparkles size={18} />
            <span>이해 노트</span>
          </div>
          <p>{activeCue?.text ?? ''}</p>
          <div className="keyword-row">
            {(activeCue?.text.match(/[가-힣A-Za-z0-9']+/g) ?? []).slice(0, 10).map((word) => (
              <span key={`${activeCue?.id}-${word}`}>{word}</span>
            ))}
          </div>
          <textarea
            value={activeCue?.note ?? ''}
            onChange={(event) => activeCue && updateCue(activeIndex, { note: event.target.value })}
            placeholder="현재 줄 메모"
          />
        </div>
      </section>
    </main>
  );
}

export default App;
