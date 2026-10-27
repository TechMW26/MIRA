import test from 'node:test';
import assert from 'node:assert/strict';
import { addProactiveEvent, buildProactiveContext, claimDueProactiveEvents, createReminder, dueProactiveEvents, isQuietTime, readProactiveStore, updateProactiveEvent, updateProactiveSettings } from './proactiveEvents.js';
import { executeHostTool } from './toolExecutor.js';

function memoryStorage() { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; }
const now = new Date(2026, 9, 28, 23, 30).getTime();
test('reminders are durable, account scoped and duplicate-safe without cloud access', () => {
  const storage = memoryStorage(), options = { storage, now };
  const first = createReminder('alice', { title: 'Check drawing', dueAt: now + 120_000 }, options);
  const duplicate = createReminder('alice', { title: 'check drawing', dueAt: now + 120_000 }, options);
  assert.equal(duplicate.id, first.id);
  assert.equal(readProactiveStore('alice', options).events.length, 1);
  assert.equal(readProactiveStore('bob', options).events.length, 0);
  assert.throws(() => updateProactiveEvent('bob', first.id, 'dismiss', options), /current account/);
  assert.throws(() => createReminder('', { title: 'Test', dueAt: now + 60_000 }, options), /Sign in/);
});
test('invalid/past/ambiguous reminder times cannot be reported as saved', () => {
  const options = { storage: memoryStorage(), now };
  assert.throws(() => createReminder('alice', { title: 'Past', dueAt: now - 1 }, options), /future reminder/);
  assert.throws(() => createReminder('alice', { title: 'No zone', dueAt: '2026-10-29T10:00:00' }, options), /timezone/);
  assert.throws(() => createReminder('alice', { title: '', dueAt: now + 1 }, options), /title/);
  assert.throws(() => createReminder('alice', { title: 'Test', dueAt: now + 1 }, { ...options, storage: { getItem: () => '', setItem: () => { throw new Error('Quota exceeded'); } } }), /Quota/);
});
test('explicit reminders alert in quiet hours without proactive opt-in and catch up after reopen', () => {
  const storage = memoryStorage(), options = { storage, now };
  createReminder('alice', { title: 'Requested reminder', dueAt: now + 60_000 }, options);
  assert.equal(claimDueProactiveEvents('alice', options).length, 0);
  const later = { storage, now: now + 90_000 };
  assert.equal(isQuietTime(readProactiveStore('alice', options).settings, later.now), true);
  assert.equal(claimDueProactiveEvents('alice', later).length, 1);
  assert.equal(claimDueProactiveEvents('alice', later).length, 0);
});
test('proactive category opt-in, quiet hours, expiry and dedup are enforced', () => {
  const storage = memoryStorage(), options = { storage, now };
  const event = { type: 'meeting_followup', source: 'test-adapter', title: 'How did the meeting go?', dueAt: now, reference: 'meeting-1' };
  addProactiveEvent('alice', event, options); addProactiveEvent('alice', event, options);
  assert.equal(readProactiveStore('alice', options).events.length, 1);
  assert.equal(claimDueProactiveEvents('alice', options).length, 0);
  updateProactiveSettings('alice', { enabled: true }, options);
  assert.equal(claimDueProactiveEvents('alice', options).length, 0); // still quiet
  updateProactiveSettings('alice', { quietHours: { enabled: false }, categories: { meeting_followup: false } }, options);
  assert.equal(claimDueProactiveEvents('alice', options).length, 0);
  updateProactiveSettings('alice', { categories: { meeting_followup: true } }, options);
  assert.equal(claimDueProactiveEvents('alice', options).length, 1);
  addProactiveEvent('alice', { type: 'call', title: 'Expired', dueAt: now - 2000, expiresAt: now - 1000 }, options);
  assert.equal(claimDueProactiveEvents('alice', options).length, 0);
});
test('snooze redelivers only at the new time; dismiss and complete suppress alerts', () => {
  const storage = memoryStorage(), options = { storage, now };
  const event = createReminder('alice', { title: 'Take a break', dueAt: now + 1 }, options);
  claimDueProactiveEvents('alice', { storage, now: now + 2 });
  updateProactiveEvent('alice', event.id, 'snooze', { storage, now: now + 3, until: now + 1000 });
  assert.equal(claimDueProactiveEvents('alice', { storage, now: now + 999 }).length, 0);
  assert.equal(claimDueProactiveEvents('alice', { storage, now: now + 1000 }).length, 1);
  updateProactiveEvent('alice', event.id, 'dismiss', { storage, now: now + 1001 });
  assert.equal(dueProactiveEvents(readProactiveStore('alice', options), now + 2000).length, 0);
});
test('context exposes real local reminders and honest connection/delivery limits', () => {
  const storage = memoryStorage(), options = { storage, now };
  createReminder('alice', { title: 'Meeting followup', dueAt: now + 60_000 }, options);
  const context = buildProactiveContext('alice', options);
  assert.match(context, /Meeting followup/);
  assert.match(context, /untrusted reference data/);
  assert.match(context, /NOT CONNECTED/);
  assert.match(context, /stored on this device/);
  assert.doesNotMatch(buildProactiveContext('bob', options), /Meeting followup/);
});
test('host reminder tool uses authenticated UI scope, never the model supplied account', async () => {
  const previous = globalThis.localStorage; globalThis.localStorage = memoryStorage();
  try {
    const result = JSON.parse(await executeHostTool({ name: 'reminder.create', arguments: { userId: 'bob', title: 'Private reminder', dueAt: new Date(Date.now() + 60_000).toISOString() } }, { userId: 'alice' }));
    assert.equal(result.saved, true);
    assert.equal(readProactiveStore('alice').events.length, 1);
    assert.equal(readProactiveStore('bob').events.length, 0);
    await assert.rejects(executeHostTool({ name: 'reminder.list' }), /Sign in/);
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
});
