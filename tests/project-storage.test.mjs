import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import test from 'node:test';
import { AUDIO_BUCKET, MAX_AUDIO_BYTES, audioContentType, ensureAudioStored, errorMessage } from '../src/lib/projectStorage.ts';

function fixture(info = { data: { size: 5 }, error: null }, uploadError = null) {
  const calls = [];
  const client = { storage: { from: bucket => {
    assert.equal(bucket, AUDIO_BUCKET);
    return {
      info: async path => { calls.push({ kind: 'info', path }); return info; },
      upload: async (path, source, options) => {
        calls.push({ kind: 'upload', path, source, options });
        return { error: uploadError };
      },
    };
  } } };
  const audio = { owner: 'owner', path: 'owner/deleted.mp3', name: 'Music.mp3', source: new Blob(['audio'], { type: 'audio/mp3' }), makeId: () => 'new-id' };
  return { client, audio, calls };
}

test('repeated section saves reuse an existing audio object', async () => {
  const { client, audio, calls } = fixture();
  assert.equal(await ensureAudioStored(client, audio), audio.path);
  assert.equal(await ensureAudioStored(client, audio), audio.path);
  assert.ok(calls.every(c => c.kind === 'info'));
});

test('saving after deletion restores the retained audio under a fresh path', async () => {
  const { client, audio, calls } = fixture({ data: false, error: { status: 404, message: 'Object not found' } });
  assert.equal(await ensureAudioStored(client, audio), 'owner/new-id-music.mp3');
  assert.equal(calls[1].kind, 'upload');
  assert.equal(calls[1].options.contentType, 'audio/mpeg');
  assert.equal(calls[1].options.upsert, false);
  assert.equal(calls[1].source, audio.source);
});

test('a missing object without a local copy cannot be reported as saved', async () => {
  const { client, audio, calls } = fixture({ data: false, error: { status: 400, message: 'Object not found' } });
  await assert.rejects(ensureAudioStored(client, { ...audio, source: null }));
  assert.equal(calls.length, 1);
});

test('transient storage errors are not mistaken for missing audio', async () => {
  const error = { status: 503, message: 'Storage temporarily unavailable' };
  const { client, audio, calls } = fixture({ data: false, error });
  await assert.rejects(ensureAudioStored(client, audio), e => e === error);
  assert.equal(calls.length, 1);
});

test('uploads fail before database saving and oversized audio is rejected', async () => {
  const error = { message: 'Upload failed' };
  const { client, audio } = fixture(undefined, error);
  await assert.rejects(ensureAudioStored(client, { ...audio, path: null }), e => e === error);
  await assert.rejects(ensureAudioStored(client, { ...audio, path: null, source: { size: MAX_AUDIO_BYTES + 1 } }));
});

test('text-only projects remain supported and object errors retain their messages', async () => {
  const { client, audio, calls } = fixture();
  assert.equal(await ensureAudioStored(client, { ...audio, path: null, name: null, source: null }), null);
  assert.equal(calls.length, 0);
  assert.equal(errorMessage({ message: 'network unavailable' }), 'network unavailable');
  assert.equal(audioContentType('song.M4A', ''), 'audio/mp4');
});
