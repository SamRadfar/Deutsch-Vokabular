# Audio: pronunciation and locked-screen shadowing (v2.0.2)

## 1. Live pronunciation (Web Speech API)

`src/features/pronunciation/speechService.ts` drives `window.speechSynthesis` for the 🔊 buttons in
Vocabulary, Flashcards and the "live speech" Shadowing mode.

### Why playback was sometimes silent (root causes found in v2.0.1)

| # | Cause | Effect | Fix |
|---|-------|--------|-----|
| 1 | The utterance object was not referenced after `speak()`. Chrome garbage-collects unreferenced utterances and then never fires `end`. | The button stayed in "speaking" state; the **next tap on the same button only stopped** (toggle) → nothing audible. | The active utterance is kept referenced; every utterance ends exactly once (end, error, replaced, or watchdog). |
| 2 | No watchdog in the buttons: a lost `end`/`error` (also on some Android engines) left the state stuck for good. | Same as 1. | Start watchdog (5 s, "no-start") and end watchdog (length-based). |
| 3 | `cancel()` was called before *every* `speak()`, also on an idle engine. Safari/iOS can drop an utterance queued right after `cancel()`. | Occasional silent taps, mostly iOS. | `cancel()` only when the engine is busy; a dropped utterance (engine idle, never started) is spoken once more after 700 ms. |
| 4 | A paused engine (Chrome/Android after the page was in the background) was never resumed. | Everything silent until reload. | `resume()` before speaking. |
| 5 | The first German voice in the list was used, including remote "Google Deutsch" voices (network, 15 s cut-off on desktop Chrome). | Silent or cut-off sentences offline / for long examples. | Voice choice prefers exact `de-DE`, on-device, default voices; long sentences on remote voices get a pause/resume keep-alive. |
| 6 | Shadowing waited for asynchronously loading voices *after* the click, so the first utterance was outside the user gesture. | iOS Safari may refuse the first utterance. | `unlock()` speaks a silent empty utterance inside the click. |
| 7 | No feedback. | Silence with no explanation. | A message (`speech-notice`) for: unsupported browser, blocked by the browser, nothing played (volume / iPhone silent switch / Bluetooth / missing German voice), German voice not installed. |

Platform notes: desktop Chrome/Edge load voices asynchronously and need sticky user activation;
Android Chrome uses the system TTS engine (Settings → Text-to-speech; German data must be installed);
iOS Safari speaks only after a gesture-started utterance and **is muted by the silent switch**.

## 1a. iPhone / iPad: pronunciation as media (v2.0.2, second round)

Owner report: desktop fine, **no sound at all on iPhone**. What the app can and cannot observe:

* Safari's Web Speech output follows the ring/silent switch (reports on Apple's developer forums and
  WebKit bugs); in silent mode `start` and `end` still fire, so **the page cannot detect the
  silence** — the earlier "no sound" message could never appear in exactly this case.
* An `<audio>` element is media playback: heard with the silent switch on, routed like music
  (speaker / headphones / Bluetooth), and it reports real `playing` / `ended` / errors.

Implementation:

* `audio/mediaOutput.ts` — one shared `<audio>` element, **unlocked synchronously inside the tap**
  (a 60 ms silent clip), so it may start the synthesized clip a moment later; Safari's
  `navigator.audioSession.type = 'playback'` where available.
* `audio/deviceSpeech.ts` — a `SpeechService` on the on-device voice: text → WAV in the worker →
  shared `<audio>`; clip cache in memory; `start` only when the element really plays.
* `audio/routedSpeech.ts` — per-utterance routing. `auto` (default): iPhone/iPad use the on-device
  voice once it is downloaded; other devices use browser speech and fall back to the on-device
  voice when browser speech reports a failure. User choice in **تنظیمات و آزمایش صدا**.
* The same routing serves the 🔊 buttons (words, examples), flashcards, live shadowing and the
  sound test; the lock-screen mode always uses media.
* Before the voice is downloaded, the first tap on iPhone explains the silent switch once and links
  to the sound settings (the silence itself is undetectable).
* Sound settings dialog: three real tests with the browser's own event times — a tone (media), the
  sample sentence with browser speech, and with the on-device voice — plus a copyable report.

## 2. Shadowing with the screen locked ("پخش با صفحهٔ قفل")

`speechSynthesis` cannot be relied on with a locked screen: browsers suspend page timers and
JavaScript, and speech is not treated as background media. So this mode does not use it.

**Architecture (free, on-device, private):**

1. **Voice download (once, ~96 MB, user-initiated):** the Piper voice `de_DE-thorsten-medium`
   (MIT), ONNX Runtime Web's WebAssembly binary and the espeak-ng phonemizer
   (`src/features/audio/voiceAssets.ts`). Pinned URLs (exact Hugging Face revision, exact npm
   versions on jsDelivr), **SHA-256 verified** before they are stored in Cache Storage
   (`tts-voice-v1`, origin-private; removable in the UI). Not served from Firebase Hosting, so the
   Spark transfer quota is not used. Only these public files are fetched — no vocabulary is sent.
2. **Synthesis on the device** in a Web Worker (`piper.worker.ts`): text → phonemes (espeak-ng
   WASM) → audio (VITS model, ONNX Runtime WASM, single-threaded). No network, no third-party TTS.
3. **Rendering** (`audioSession/render.ts`): every distinct word/sentence is synthesized once;
   repetitions and learner pauses (incl. "pause extended by the sentence length") are laid out as
   real silence into **one 16-bit mono WAV** in memory (Blob URL). Nothing is stored or uploaded;
   the audio is released when the session ends.
4. **Playback** (`audioSession/audioSessionPlayer.ts`): an `HTMLAudioElement` plus the **Media
   Session API** (lock screen / notification / headset: play, pause, next, previous, seek). The
   lock screen shows only "Shadowing · Wort n / N" — no vocabulary. Item, step and progress are
   derived from the audio position, so after the page was suspended the state catches up as soon as
   scripts run again; skipped items are not counted as practised.

Limits: speed is fixed when the session is prepared; preparation takes time (desktop ≈ 1 s per
sentence; phones slower) and memory (≈ 2.6 MB per minute of session audio).

### What is verified

* `npm test`: state machine of speech fallbacks, rendering (WAV format, timing, silence), session
  player (position → item/step, catch-up after suspension, Media Session handlers, blocked start).
* `node scripts/audio-check.mjs` (real Chromium, **no mocks**, network for the first download):
  download + checksum, synthesis is audible (RMS), the WAV decodes in the browser at full length,
  speech in speak steps / silence in pauses, plays to the end, all items counted, Media Session set.
* Playwright (desktop + Pixel 7 emulation): buttons speak, "no sound" message, mode UI, safe area.

### What only real devices can show (see release notes for the device test results)

* Audible output on the owner's phones.
* Android Chrome / installed PWA: continues with the screen locked, notification controls.
* iPhone Safari / home-screen app: continues with the screen locked, lock-screen controls. iOS has
  historically been less reliable for background audio of **installed** home-screen web apps than of
  Safari tabs; if the home-screen app stops when locked, use the Safari tab.

## 3. Sound test

Shadowing setup → "آزمایش صدا": shows the selected browser voice and plays a neutral sample
sentence with the browser voice and (when downloaded) with the on-device voice.

## 4. Floating player ("پنجره شناور") — Document Picture-in-Picture

Shadowing → «پنجره شناور» opens a real **Document Picture-in-Picture** window (Chrome / Edge 116+
on desktop): a separate, always-on-top window of ≈ 340 × 420 px that stays visible when the main
browser window is minimized or another application is in front. Code: `features/shadowing/floating/`.

* **One session:** the card is a React portal of the running session (same player, same audio, no
  second playback). Controls in the window (▶/⏸, ⏮, ⏭; Space / ← / →) drive that session.
* **Timing while minimized:** the live-speech player's pauses are timed with the floating window's
  timers (`MovableTimers`; that document stays visible, the minimized one may be throttled); pending
  timers move back when the window closes. Audio sessions ("پخش با صفحهٔ قفل") are driven by the
  audio timeline anyway. Live speech is not paused when the page is hidden while the window is open.
* **Lifecycle:** opening twice reuses the window; closing it keeps the session; ending the session,
  leaving shadowing, signing out or switching accounts closes it (no vocabulary left on screen).
  The main window is never focused or restored by the app.
* **Other browsers** (Firefox, Safari, phones): a compact in-page card that says plainly that it does
  not stay above other applications.

Verified on Windows 11 with headed Chrome 155 and Edge 155 (`npm run test:desktop`, real windows,
state read from Windows): floating window has the always-on-top flag, the main window stays
minimized and never becomes the foreground window, the card advances with the session (1/5 → 3/5)
while minimized, pause/play from the window work, and the real speech engine keeps running while
minimized (silent test utterances). Not automated: how it looks and sounds on the owner's screen,
and very long sessions (> 5 min minimized).
