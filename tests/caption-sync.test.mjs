import assert from 'node:assert/strict';
import test from 'node:test';
import { closeCaption, replayCaptionIndex, roundTime, stampCaption } from '../src/lib/captionSync.ts';

const cue = (id, start = 0, end = 0) => ({ id, text: id, start, end, note: 'keep note' });

test('successive live stamps close the previous cue and keep future cues unrecorded', () => {
  const initial = [cue('one'), cue('two'), cue('three')];
  const second = stampCaption(initial, 1, 7.81345, true);
  assert.deepEqual(second.map(c => [c.start, c.end]), [[0, 7.813], [7.813, 0], [0, 0]]);
  const third = stampCaption(second, 2, 11.08021, true);
  assert.deepEqual(third.map(c => [c.start, c.end]), [[0, 7.813], [7.813, 11.08], [11.08, 0]]);
  assert.deepEqual(initial.map(c => [c.start, c.end]), [[0, 0], [0, 0], [0, 0]]);
  assert.ok(third.every(c => c.note === 'keep note'));
});

test('saving an in-progress section closes a snapshot without mutating live data', () => {
  const live = [cue('one', 0, 5), cue('two', 5, 0), cue('three')];
  const saved = closeCaption(live, 1, 9.34567);
  assert.equal(saved[1].end, 9.346);
  assert.equal(live[1].end, 0);
  assert.deepEqual(closeCaption(live, null, 12), live);
  assert.deepEqual(closeCaption(live, 1, 4), live);
});

test('replay follows exact boundaries, seeks backwards and holds the last recorded cue', () => {
  const saved = [cue('one', 0, 5), cue('two', 5, 9), cue('three', 9, 12), cue('unrecorded')];
  for (const [time, index] of [[0, 0], [4.999, 0], [5, 1], [8.999, 1], [9, 2], [30, 2], [2, 0]]) {
    assert.equal(replayCaptionIndex(saved, time), index);
  }
  assert.equal(replayCaptionIndex([cue('one'), cue('two')], 100), 0);
});

test('legacy overlapping end times do not prevent recorded starts from replaying', () => {
  const saved = [cue('one', 0, 60), cue('two', 5, 60), cue('three', 12, 60)];
  assert.equal(replayCaptionIndex(saved, 6), 1);
  assert.equal(replayCaptionIndex(saved, 13), 2);
});

test('invalid backwards or duplicate stamps preserve the previous data', () => {
  const saved = [cue('one', 0, 5), cue('two', 5, 9), cue('three')];
  assert.throws(() => stampCaption(saved, 2, 4, true));
  assert.throws(() => stampCaption(saved, 2, 5, true));
  assert.equal(saved[1].end, 9);
});

test('direct start edits retain a valid existing end and times are rounded safely', () => {
  const saved = [cue('one', 0, 5), cue('two', 5, 9)];
  assert.equal(stampCaption(saved, 1, 6, false)[1].end, 9);
  assert.equal(roundTime(-1), 0);
  assert.equal(roundTime(NaN), 0);
  assert.equal(roundTime(91.99746), 91.997);
});
