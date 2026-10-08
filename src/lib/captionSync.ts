import type { CaptionCue } from '../types';

export const roundTime = (value: number) =>
  Number(Math.max(0, Number.isFinite(value) ? value : 0).toFixed(3));

export function replayCaptionIndex(cues: CaptionCue[], time: number) {
  let index = 0;
  let latestStart = -1;
  cues.forEach((cue, cueIndex) => {
    if (cue.end > cue.start && cue.start <= time && cue.start >= latestStart) {
      index = cueIndex;
      latestStart = cue.start;
    }
  });
  return index;
}

export function closeCaption(cues: CaptionCue[], index: number | null, time: number) {
  const end = roundTime(time);
  return cues.map((cue, cueIndex) =>
    cueIndex === index && end > cue.start ? { ...cue, end } : cue,
  );
}

export function stampCaption(cues: CaptionCue[], index: number, time: number, advance: boolean) {
  const start = roundTime(time);
  const previousStart = advance && index === 1 ? 0 : cues[index - 1]?.start;
  if (!cues[index] || (previousStart !== undefined && start <= previousStart)) {
    throw new Error('이전 자막의 시작 시간 이후에 찍어주세요. 다시 찍으려면 이전 취소를 눌러주세요.');
  }
  return cues.map((cue, cueIndex) => {
    if (cueIndex === index) {
      return { ...cue, start, end: !advance && cue.end > start ? cue.end : 0 };
    }
    if (cueIndex === index - 1) {
      return { ...cue, start: previousStart ?? cue.start, end: start };
    }
    return cue;
  });
}
