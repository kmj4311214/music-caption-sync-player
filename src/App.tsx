import {
  AlignLeft,
  BadgeCheck,
  Clock3,
  Download,
  FileAudio,
  Gauge,
  ListMusic,
  ListRestart,
  Mic2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScissorsLineDashed,
  SkipForward,
  Square,
  Trash2,
  Undo2,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoFitCaptionText } from './AutoFitCaptionText';
import { isSupabaseConfigured, ownerKey, supabase } from './lib/supabase';
import { closeCaption, replayCaptionIndex, roundTime, stampCaption } from './lib/captionSync';
import { AUDIO_BUCKET, ensureAudioStored, errorMessage, MAX_AUDIO_BYTES } from './lib/projectStorage';
import type { CaptionCue, ProjectRecord, SaveState } from './types';

const initialText = `첫 번째 문장을 여기에 입력하세요.
오디오를 재생하면서 현재 시간에 맞춰 줄을 찍습니다.
큰 화면에서는 현재 문장만 또렷하게 보입니다.`;

type SyncSnapshot = {
  timings: Pick<CaptionCue, 'id' | 'start' | 'end'>[];
  displayIndex: number;
  recordingIndex: number | null;
  mode: 'edit' | 'playback';
  time: number;
};

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
      start: old?.start ?? 0,
      end: old?.end ?? 0,
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
  const audioBlobRef = useRef<Blob | null>(null);
  const projectTaskRef = useRef(false);
  const revisionRef = useRef(0);
  const [title, setTitle] = useState('Jumprope Caption Session');
  const [artist, setArtist] = useState('');
  const [rawText, setRawText] = useState(initialText);
  const [cues, setCues] = useState<CaptionCue[]>(() => parseText(initialText));
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncSnapshot[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [status, setStatus] = useState('');
  const [theater, setTheater] = useState(false);
  const [mode, setMode] = useState<'edit' | 'playback'>('edit');
  const [projectTask, setProjectTask] = useState<'save' | 'load' | 'delete' | null>(null);

  const activeIndex = mode === 'playback'
    ? replayCaptionIndex(cues, currentTime)
    : Math.min(displayIndex, Math.max(0, cues.length - 1));
  const isBusy = projectTask !== null;
  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    setSaveState('idle');
  }, []);

  const activeCue = cues[activeIndex];
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const completedLines = cues.filter((cue) => cue.end > cue.start).length;
  const nextCue = cues[activeIndex + 1];
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
  }, [setStatus, setProjects]);

  const rememberSync = useCallback((rewindTime?: number) => {
    const time = clampTime(rewindTime ?? audioRef.current?.currentTime ?? 0);
    const snapshot: SyncSnapshot = {
      timings: cues.map(({ id, start, end }) => ({ id, start, end })),
      displayIndex: mode === 'playback' ? replayCaptionIndex(cues, time) : displayIndex,
      recordingIndex,
      mode,
      time,
    };
    setSyncHistory((history) => [...history.slice(-99), snapshot]);
  }, [cues, displayIndex, recordingIndex, mode]);

  const stopSyncRecording = useCallback((time: number, captureHistory = true) => {
    if (recordingIndex === null) {
      return;
    }

    if (captureHistory) {
      rememberSync(cues[recordingIndex]?.start ?? time);
    }
    setCues((current) => closeCaption(current, recordingIndex, time));
    setRecordingIndex(null);
    markDirty();
    setStatus('싱크 기록 완료');
  }, [recordingIndex, cues, rememberSync, markDirty, setStatus]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    let frame = 0;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const tick = () => {
      updateTime();
      if (!audio.paused && !audio.ended) {
        frame = requestAnimationFrame(tick);
      }
    };
    const updatePlaying = () => {
      setIsPlaying(true);
      cancelAnimationFrame(frame);
      tick();
    };
    const updatePaused = () => {
      setIsPlaying(false);
      cancelAnimationFrame(frame);
      updateTime();
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('play', updatePlaying);
    audio.addEventListener('pause', updatePaused);
    audio.addEventListener('ended', updatePaused);

    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('play', updatePlaying);
      audio.removeEventListener('pause', updatePaused);
      audio.removeEventListener('ended', updatePaused);
    };
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const finishRecording = () => stopSyncRecording(audio.currentTime);
    audio.addEventListener('ended', finishRecording);
    return () => audio.removeEventListener('ended', finishRecording);
  }, [audioUrl, stopSyncRecording]);

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
    setRecordingIndex(null);
    setDisplayIndex(0);
    setSyncHistory([]);
    setMode('edit');
    markDirty();
  };

  const handleAudioChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    event.target.value = '';
    if (file.size > MAX_AUDIO_BYTES) {
      setStatus('음원은 50MB 이하 파일을 선택해주세요. 기존 기록은 유지됩니다.');
      return;
    }

    audioRef.current?.pause();
    audioBlobRef.current = file;
    setAudioName(file.name);
    setAudioPath(null);
    setAudioUrl(URL.createObjectURL(file));
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setRecordingIndex(null);
    setDisplayIndex(0);
    setSyncHistory([]);
    setStatus(`${file.name} 선택됨`);
    markDirty();
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      fileInputRef.current?.click();
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setStatus('음원을 재생할 수 없습니다. 다른 오디오 파일을 선택해주세요.');
      }
    } else {
      audio.pause();
    }
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      return;
    }

    setRecordingIndex(null);
    audio.currentTime = clampTime(value);
    setCurrentTime(audio.currentTime);
  };

  const updateCue = (index: number, patch: Partial<CaptionCue>) => {
    if (patch.start !== undefined || patch.end !== undefined) {
      rememberSync();
    }
    setCues((current) =>
      current.map((cue, cueIndex) => (cueIndex === index ? { ...cue, ...patch } : cue)),
    );
    markDirty();
  };

  const stampCue = (index: number, advance = false) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl || !cues[index]) {
      return;
    }
    const time = roundTime(audio.currentTime);
    let nextCues: CaptionCue[];
    try {
      nextCues = stampCaption(cues, index, time, advance);
    } catch (error) {
      setStatus(errorMessage(error));
      return;
    }

    rememberSync(advance ? cues[activeIndex]?.start ?? 0 : undefined);
    setCues(nextCues);
    setCurrentTime(time);
    if (advance) {
      setRecordingIndex(index);
      setDisplayIndex(index);
    }
    markDirty();
    setStatus(`${index + 1}번 자막 ${formatTime(time)} 싱크 기록`);
  };

  const stampNext = () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      setStatus('먼저 음원을 선택해주세요.');
      return;
    }
    if (audio.paused) {
      setStatus('음원을 재생한 뒤 싱크를 찍어주세요.');
      return;
    }
    if (nextCue) {
      stampCue(activeIndex + 1, true);
    }
  };

  const finishCue = () => {
    const time = roundTime(audioRef.current?.currentTime ?? currentTime);
    if (recordingIndex !== null) {
      stopSyncRecording(time);
      return;
    }
    if (!activeCue || time <= activeCue.start) {
      return;
    }
    rememberSync();
    setCues((current) => closeCaption(current, activeIndex, time));
    markDirty();
    setStatus(`${activeIndex + 1}번 자막 끝 시간 기록`);
  };

  const resetCaptions = () => {
    rememberSync();
    stopSyncRecording(audioRef.current?.currentTime ?? currentTime, false);
    seekTo(0);
    setDisplayIndex(0);
    setStatus('1번 자막');
  };

  const undoSync = () => {
    const snapshot = syncHistory[syncHistory.length - 1];
    if (!snapshot) {
      return;
    }

    const audio = audioRef.current;
    audio?.pause();
    if (audio && audioUrl) {
      audio.currentTime = snapshot.time;
    }
    const timings = new Map(snapshot.timings.map((timing) => [timing.id, timing]));
    setCues((current) => current.map((cue) => {
      const timing = timings.get(cue.id);
      return timing ? { ...cue, start: timing.start, end: timing.end } : cue;
    }));
    setDisplayIndex(snapshot.displayIndex);
    setMode(snapshot.mode);
    setRecordingIndex(snapshot.recordingIndex);
    setCurrentTime(audio && audioUrl ? audio.currentTime : 0);
    setIsPlaying(false);
    setSyncHistory((history) => history.slice(0, -1));
    markDirty();
    setStatus(`이전 싱크 취소: ${snapshot.displayIndex + 1}번 자막`);
  };

  const resetAllSync = () => {
    if (!cues.length) {
      return;
    }
    rememberSync();
    const audio = audioRef.current;
    audio?.pause();
    if (audio && audioUrl) {
      audio.currentTime = 0;
    }
    setCues((current) => current.map((cue) => ({ ...cue, start: 0, end: 0 })));
    setDisplayIndex(0);
    setMode('edit');
    setRecordingIndex(null);
    setCurrentTime(0);
    setIsPlaying(false);
    markDirty();
    setStatus('전체 싱크 리셋 완료');
  };

  const spreadEvenly = () => {
    rememberSync();
    const baseDuration = duration || cues.length * 3;
    const step = baseDuration / Math.max(cues.length, 1);
    setCues((current) =>
      current.map((cue, index) => ({
        ...cue,
        start: Number((step * index).toFixed(2)),
        end: Number((step * (index + 1) - 0.08).toFixed(2)),
      })),
    );
    setRecordingIndex(null);
    markDirty();
  };

  const shiftCues = (delta: number) => {
    rememberSync();
    setCues((current) =>
      current.map((cue) => ({
        ...cue,
        start: clampTime(cue.start + delta),
        end: clampTime(cue.end + delta),
      })),
    );
    markDirty();
  };

  const saveProject = async () => {
    if (projectTaskRef.current) {
      return;
    }
    if (!supabase) {
      setStatus('Supabase 환경변수가 필요합니다.');
      setSaveState('error');
      return;
    }

    projectTaskRef.current = true;
    setProjectTask('save');
    const savedRevision = revisionRef.current;
    const projectId = activeProjectId ?? makeId();
    const savedCues = closeCaption(cues, recordingIndex, audioRef.current?.currentTime ?? currentTime);
    setActiveProjectId(projectId);
    setCues(savedCues);
    setSaveState('saving');
    setStatus('저장 중');

    try {
      const uploadedPath = await ensureAudioStored(supabase, {
        owner: ownerKey, path: audioPath, source: audioBlobRef.current, name: audioName, makeId,
      });
      setAudioPath(uploadedPath);
      const payload = {
        id: projectId,
        owner_key: ownerKey,
        title: title.trim() || 'Untitled Session',
        artist: artist.trim() || null,
        audio_path: uploadedPath,
        audio_name: audioName,
        duration: roundTime(duration),
        raw_text: rawText,
        cues: savedCues,
        notes: savedCues.reduce<Record<string, string>>((memo, cue) => {
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
      const unchanged = revisionRef.current === savedRevision;
      setSaveState(unchanged ? 'saved' : 'idle');
      setStatus(unchanged ? 'Supabase 저장 완료' : '구간 저장 완료 · 이후 변경 사항은 다시 저장해주세요.');
    } catch (error) {
      setStatus(`저장 실패: ${errorMessage(error)}`);
      setSaveState('error');
    } finally {
      projectTaskRef.current = false;
      setProjectTask(null);
    }
  };

  const loadProject = async (project: ProjectRecord) => {
    if (projectTaskRef.current) {
      return;
    }
    projectTaskRef.current = true;
    setProjectTask('load');
    audioRef.current?.pause();
    audioBlobRef.current = null;
    setAudioUrl('');
    setIsPlaying(false);
    setRecordingIndex(null);
    setDisplayIndex(0);
    setSyncHistory([]);
    setCurrentTime(0);
    setMode('playback');
    setActiveProjectId(project.id);
    setTitle(project.title);
    setArtist(project.artist ?? '');
    setRawText(project.raw_text);
    setCues(project.cues?.length ? project.cues : parseText(project.raw_text));
    setAudioPath(project.audio_path);
    setAudioName(project.audio_name);
    setDuration(Number(project.duration ?? 0));
    setSaveState('saved');
    setStatus('프로젝트 불러오는 중');

    try {
      if (!supabase || !project.audio_path) {
        setStatus(project.audio_name ? '연결된 음원이 없습니다. 원래 음원을 다시 선택하고 저장해주세요.' : `${project.title} 불러옴`);
        return;
      }
      const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(project.audio_path);
      if (error) {
        throw error;
      }
      audioBlobRef.current = data;
      setAudioUrl(URL.createObjectURL(data));
      setStatus(`${project.title} 불러옴`);
    } catch (error) {
      setSaveState('error');
      setStatus(`음원 불러오기 실패: ${errorMessage(error)}. 원래 음원을 다시 선택하면 자막 기록을 유지하고 복구할 수 있습니다.`);
    } finally {
      projectTaskRef.current = false;
      setProjectTask(null);
    }
  };

  const deleteProject = async (project: ProjectRecord) => {
    if (projectTaskRef.current || !supabase || !window.confirm(`${project.title} 삭제할까요?`)) {
      return;
    }
    projectTaskRef.current = true;
    setProjectTask('delete');
    try {
      const { error } = await supabase.from('music_caption_projects').delete().eq('id', project.id);
      if (error) {
        throw error;
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (activeProjectId === project.id) {
        setActiveProjectId(null);
        setAudioPath(null);
        markDirty();
      }
      if (project.audio_path) {
        const { data: references, error: referenceError } = await supabase
          .from('music_caption_projects').select('id').eq('audio_path', project.audio_path).limit(1);
        if (referenceError) {
          throw referenceError;
        }
        if (!references?.length) {
          const { error: audioError } = await supabase.storage.from(AUDIO_BUCKET).remove([project.audio_path]);
          if (audioError) {
            throw audioError;
          }
        }
      }
      setStatus('삭제 완료');
    } catch (error) {
      setStatus(`삭제 처리 오류: ${errorMessage(error)}`);
    } finally {
      projectTaskRef.current = false;
      setProjectTask(null);
    }
  };

  const newProject = () => {
    if (projectTaskRef.current) {
      return;
    }
    audioRef.current?.pause();
    audioBlobRef.current = null;
    setActiveProjectId(null);
    setTitle('Jumprope Caption Session');
    setArtist('');
    setRawText(initialText);
    setCues(parseText(initialText));
    setAudioPath(null);
    setAudioName(null);
    setAudioUrl('');
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setMode('edit');
    setDisplayIndex(0);
    setRecordingIndex(null);
    setSyncHistory([]);
    markDirty();
    setStatus('새 프로젝트');
  };

  const switchMode = (nextMode: 'edit' | 'playback') => {
    if (mode === nextMode) {
      return;
    }
    const audio = audioRef.current;
    const time = audio?.currentTime ?? currentTime;
    audio?.pause();
    if (recordingIndex !== null) {
      stopSyncRecording(time);
    }
    setDisplayIndex(nextMode === 'edit' ? activeIndex : 0);
    setMode(nextMode);
    setIsPlaying(false);
    setCurrentTime(time);
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
    projectTask === 'save' ? '저장 중' : saveState === 'saved' ? '저장됨' : '저장';

  return (
    <main className={theater ? 'app theater' : 'app'}>
      <header className="topbar">
        <div>
          <p className="eyebrow">JUMPROPE PLAYER by SEOLIN</p>
          <h1>Caption Sync Player</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={newProject} title="새 프로젝트" disabled={isBusy}>
            <Plus size={19} />
          </button>
          <button className="gold-button" type="button" onClick={saveProject} disabled={isBusy}>
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
                <button type="button" onClick={() => void loadProject(project)} disabled={isBusy}>
                  <strong>{project.title}</strong>
                  <span>{project.audio_name ?? '오디오 없음'}</span>
                </button>
                <button
                  className="ghost-icon"
                  type="button"
                  onClick={() => void deleteProject(project)}
                  title="삭제"
                  disabled={isBusy}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {projects.length === 0 && <div className="empty">저장된 항목 없음</div>}
          </div>
          <div className="status-line" role="status">{isSupabaseConfigured ? status || '연결됨' : '환경변수 필요'}</div>
        </aside>

        <section className="stage-column">
          <div className="sync-mode" role="group" aria-label="싱크 모드">
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => switchMode('edit')} disabled={projectTask === 'load'}>싱크 편집</button>
            <button type="button" aria-pressed={mode === 'playback'} onClick={() => switchMode('playback')} disabled={projectTask === 'load'}>싱크 재생</button>
          </div>
          <div className="caption-stage">
            <div className="stage-meta">
              <span>{formatTime(currentTime)}</span>
              <span className="recording-label">{mode === 'playback' ? '싱크 재생' : recordingIndex !== null ? '기록 중' : '자막'} {cues.length ? activeIndex + 1 : 0}/{cues.length}</span>
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
            <button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
              <FileAudio size={18} />
              오디오
            </button>
            <button className="play-button" type="button" onClick={() => void togglePlay()} title={isPlaying ? '일시정지' : '재생'} disabled={projectTask === 'load'}>
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <input
              className="time-slider"
              aria-label="재생 위치"
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

          <div className="live-sync-controls">
            <button className="gold-button" type="button" onClick={stampNext} disabled={!nextCue || mode !== 'edit' || projectTask === 'load'}>
              <SkipForward size={18} />
              싱크 찍기
            </button>
            <button className="tool-button" type="button" onClick={finishCue} disabled={!audioUrl || !activeCue || mode !== 'edit' || projectTask === 'load'}>
              <Square size={16} />
              싱크 종료
            </button>
            <button className="icon-button" type="button" onClick={undoSync} title="이전 취소" disabled={syncHistory.length === 0}>
              <Undo2 size={18} />
            </button>
            <button className="icon-button" type="button" onClick={resetCaptions} title="처음 자막으로" disabled={!activeCue}>
              <RotateCcw size={17} />
            </button>
            <button className="icon-button" type="button" onClick={resetAllSync} title="전체 리셋" disabled={!activeCue}>
              <ListRestart size={18} />
            </button>
            <div className="sync-target">
              <span>{nextCue ? `다음 자막 ${activeIndex + 2}/${cues.length}` : activeCue ? '마지막 자막' : '자막 없음'}</span>
              <strong>{nextCue?.text ?? activeCue?.text ?? ''}</strong>
            </div>
          </div>

          <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" onError={() => {
            if (audioUrl) {
              setStatus('음원을 재생할 수 없습니다. 원래 음원을 다시 선택해주세요. 자막 기록은 유지됩니다.');
            }
          }} />

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
              <input value={title} onChange={(event) => { setTitle(event.target.value); markDirty(); }} />
            </label>
            <label>
              <span>아티스트</span>
              <input value={artist} onChange={(event) => { setArtist(event.target.value); markDirty(); }} />
            </label>
          </div>

          <label className="lyrics-box">
            <span>가사 / 자막</span>
            <textarea value={rawText} onChange={(event) => handleTextChange(event.target.value)} />
          </label>

          <div className="sync-toolbar">
            <button className="tool-button" type="button" onClick={finishCue} disabled={mode !== 'edit' || !audioUrl || projectTask === 'load'}>
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
                <span className="cue-number">
                  {index + 1}
                </span>
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
                <button className="ghost-icon" type="button" onClick={() => stampCue(index)} title="이 자막 시간 찍기">
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
