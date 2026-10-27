# Talio Mira personality and execution parity

## Implemented locally

- Shared standalone personality mirrors Talio Mira: concise helpful answers,
  context continuity, feminine Hindi grammar, proportionate expressive speech,
  no waiting fillers and no unverified action claims. Existing coding, projects,
  browser inspection, document/media tools and research are preserved.
- Direct DeepSeek streaming remains the voice response generator. The existing
  microphone transcription service is retained. When `ELEVENLABS_API_KEY` is set
  **on the server**, speech uses the selected Talio curated voice and full
  `eleven_v4` through the proven text-to-speech streaming API. Only supported
  stability/similarity fields are sent; `[fast]` controls delivery, not pitch-
  changing playback-rate tricks. No provider credential was copied from Talio.
- Current English/Hindi language is persisted under the user's existing profile
  preferences. A meaningful language switch overrides a stale transcription
  hint. Short ambiguous fragments retain the current language.
- Spoken conversation closure is a model intent decision using a private
  control marker. The marker is not spoken or displayed. Delivery cues drive
  corresponding existing avatar expressions.
- Runtime-aware `computer.task` is available in compatible **macOS 14+** builds.
  DeepSeek selects it with the complete user goal and prior corrections; the
  existing vision service grounds the next native input from a fresh screenshot
  and accessibility targets. It prefers installed applications, supports guarded
  predictable 2–4-input batches, retries from fresh observations and requires a
  fresh final screen plus native-state verification before completion.
- Desktop control requires OS Accessibility + Screen Recording and a clear
  first-use application approval. Screen text is untrusted. Password/security
  applications and generated shell commands are not operated. Main-process IPC
  retains the existing trusted-origin/main-frame checks. Native sessions expire
  after five minutes, at most 32 inputs, with Command+Shift+Escape emergency stop
  and a Preferences revoke button. Native helper source is rebuilt before Mac
  packaging for the target architecture and unpacked from ASAR.
- Planning preserves explicit prior-step dependencies; failed prerequisites
  block dependent work. Transient generation errors really retry with bounded
  backoff. Inline tool orchestration carries actual receipts into follow-up tool
  calls, normalizes failed/uncertain results, allows bounded read retries and
  prevents identical write replay. Fragmented provider tool calls are assembled
  once before execution, including in voice mode.
- `reminder.create/list/update` and `activity.feed` use device-local storage
  scoped to the signed-in UID. The Activity panel supports manual creation,
  quiet hours/category opt-in, snooze/dismiss/complete, notification deduplication
  via Web Locks and overdue catch-up on reopen/focus/reconnect. Explicit requested
  reminders alert regardless of proactive opt-in or quiet hours. Events follow
  the shared Talio schema and are reference data, never instructions.

## Explicit boundaries

- This is **not full Talio workplace parity**: no standalone authenticated Talio
  account link exists. Employee/task/meeting/transcript data must not be inferred
  from an email match or copied session. A production connector needs Talio's
  authenticated scoped token-exchange/data APIs and a user-initiated linking flow.
- Email, calendar, WhatsApp and calls are not connected. The UI and model context
  say so. Future adapters can insert verified events through `addProactiveEvent`
  only after authenticating the source account. No private event data is placed
  in the repository's existing unauthenticated Firebase REST paths.
- Standalone reminders are **one-time and device-local**, not synchronized
  background OS alarms. Keep the main app open for timely delivery. Reopening
  catches overdue reminders. Recurring schedules and delivery while completely
  closed require a server/native scheduler and are not claimed here.
- General Windows/Linux native input control is not advertised. Existing browser
  and workspace tools remain available. Adding unsupported capability flags would
  be misleading; these platforms require their own bounded native backend.
- Existing standalone camera/desktop companion features are preserved; Talio's
  notch preview and wake-word platform implementation have not been transferred.
- Server credentials and provider access are deployment prerequisites, not proof
  of activation. No live standalone synthesis, private screenshot upload or
  native desktop input test was performed in this change. Mac UI inspection was
  blocked because the Mac was locked.

## Validation

Use Node >=22.12.0:

```sh
npm test
npm run build
node -e 'require("./desktop/buildComputerControl.cjs")({electronPlatformName:"darwin",arch:3})'
node -e 'require("./desktop/buildComputerControl.cjs")({electronPlatformName:"darwin",arch:1})'
```

The native compile commands require macOS and Xcode command-line tools. Both
architectures were compiled from the checked-in source. Focused tests cover
consent/OS grants, stale screen and manual-input guards, protected apps, messaging
channel mismatch, bounded batching, revocation/cancellation, fresh completion,
provider tool fragments, V4 transport settings, English/Hindi switching, reminder
isolation/delivery/dedup/snooze and safe follow-up tool recovery.

Provider compatibility references:

- [ElevenLabs model overview](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs official voice settings guidance](https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md)
- [DeepSeek function calling](https://api-docs.deepseek.com/guides/function_calling)

No commits, deployment changes or release publication are performed by these
validation commands.
