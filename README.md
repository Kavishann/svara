# Svara

A Mac desktop prototype for browsing through Sinhala speech. Svara controls a separate Chrome window, organizes the page into reading lists, and reads selected content aloud. Web content stays in its original language unless the user requests Sinhala.

## Run on this Mac

Requires macOS, Google Chrome, and Node.js 22 or newer for development.

```sh
npm ci
npm start
```

Choose **Try practice mode** to explore the local sample page without API credentials. Practice mode has fictional content and cloud speech is off. It supports typed navigation, reader controls, headings, article passages, links, and tabs. It does not simulate successful speech recognition, translation, or AI decisions.

Open **Connections** to configure the live services. The packaged app does not require Node.js, but still needs Google Chrome installed. A separate browser profile is kept under the app's user-data directory, rather than attaching to your everyday Chrome session.

## Agreed service responsibilities

| Responsibility | Service/model |
| --- | --- |
| Recorded Sinhala or English speech → text | Google Cloud Speech-to-Text V2, `chirp_2` |
| Sinhala command → English for Jev; requested content translation | Gemini `gemini-3.8-flash` |
| Choose an allowed browser action and target | TypeSafe `jev-1.13.0` |
| Execute and inspect the browser | Playwright + Chrome |
| Prepared text → spoken output, exclusively | Google Cloud TTS `gemini-2.5-flash-tts` |

Gemini 3.8 is restricted to language handling in this application. Gemini 2.5 Flash TTS receives only prepared text and a speaking-style instruction. Jev cannot generate arbitrary browser code. Familiar fixed commands and explicit UI controls run locally; natural-language requests use the translation and Jev pipeline.

## Connect Google and TypeSafe

1. Create or choose a Google Cloud project with billing. Enable **Cloud Speech-to-Text**, **Cloud Text-to-Speech**, and **Agent Platform / Vertex AI API** (`aiplatform.googleapis.com`). Gemini speech depends on the AI Platform API even when requested through Cloud Text-to-Speech.
2. Provide Google credentials either by selecting a service-account JSON file in Connections, or by configuring Application Default Credentials on the Mac. For local development, `gcloud auth application-default login` and `gcloud auth application-default set-quota-project YOUR_PROJECT` are supported outside the app.
3. The identity needs Speech recognition permissions (for example `roles/speech.client`) and the permissions required by Gemini-TTS, including `aiplatform.endpoints.predict` (provided by `roles/aiplatform.user`). Ensure the relevant API and model are accessible in the selected project. The app never creates projects, changes billing, or changes IAM permissions.
4. Enter the project ID and select a Chirp 2 region. Default: **Singapore (`asia-southeast1`)**. TTS uses the global Cloud TTS endpoint separately.
5. Add a Google AI Studio Gemini API key with access to `gemini-3.8-flash`, and a TypeSafe key with access to `jev-1.13.0`.
6. Save, check connections, and choose **Try Sinhala voice**. Connection checks make four small live requests: generated silence to Chirp 2, a Sinhala greeting to Gemini speech, a greeting translation to Gemini 3.8, and a harmless Jev decision. No microphone recording or browser content is used for these checks. They verify API and model access, report service-specific failures, and use the providers' normal quota and billing. A real recording and the voice test additionally verify microphone capture and local playback.

If speech reports a disabled API, enable the named API in the same project and allow a few minutes for propagation. Valid credentials alone do not verify API enablement, permissions, or available quota. An AI Platform permission error requires `aiplatform.endpoints.predict`; changing the TypeSafe key cannot repair a Google speech error.

Environment variables can also supply `GEMINI_API_KEY`, `TYPESAFE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_APPLICATION_CREDENTIALS` when launching from a terminal. `.env.example` is a reference; `.env` files are not automatically loaded.

API keys are encrypted with Electron `safeStorage` backed by macOS secure storage. Only presence indicators are returned to the renderer. The chosen Google credential file stays in its original location; Svara stores its path. Cloud API keys are never exposed to the controlled browser. An existing environment variable can supply a key again on restart even after removing its saved copy.

## Controls

| Action | Control |
| --- | --- |
| Start/finish recording | **Control + Option + Space**, or Start speaking |
| Stop reading/cancel a recording | **Escape** in Svara; **Control + Option + Escape** anywhere |
| Read a section | Results, Headings, Page text, or Links |
| Navigate reading items | Previous, Next, Read again, or numbered list buttons |
| Activate selected link | Open this item |
| Translate selected passage | Read this in Sinhala; Read the original switches back |
| Continue automatically | Keep reading the next item |
| Change speaking speed | Speed slider; implemented in audio playback |

Commands include `open YouTube`, `search YouTube for ...`, `new tab`, `go back`, `read results`, `next`, `previous`, `repeat`, `read in Sinhala`, `read original`, `where am I`, `play`, `pause`, and `stop`. Sinhala fixed phrases are listed under Help & commands. Conversational Sinhala and mixed-language phrases are translated by Gemini before Jev evaluates them.

Recordings are capped at 45 seconds and submitted after the user finishes. This is not word-by-word streaming recognition: Sinhala is not listed in Chirp 2's documented streaming-language set. Select the expected input language in Connections. Mixed Sinhala–English accuracy needs evaluation with actual speakers.

## Behavior and boundaries

- Search terms and dictated text must remain an exact substring of the original transcript. Translation that changes the payload is rejected.
- Search results retain their link identity. Before clicking, the app checks document identity, URL, element ID, label, role, and destination. A changed page or result requires refreshing the list.
- Every non-link click and potentially consequential link needs confirmation. Confirmation expires after 60 seconds and revalidates the target. Cancelling invalidates in-flight model responses. These rules reduce mistakes; they cannot establish every possible website side effect.
- Page content is passed as untrusted data. Only fixed browser operations exist. Sensitive input fields, including passwords and payment codes, are excluded from the snapshot, and form values are not collected.
- The renderer has no Node.js access. IPC checks the calling window and frame. Navigation and remote windows from the app UI are blocked; browsing happens in a separate sandboxed browser process.
- Raw recordings and command transcripts are kept in memory, not saved by Svara. Chrome maintains its separate browser profile. Cloud providers apply their own retention policies.
- Original-language reading is the default. Sinhala translation applies to the selected reading mode until “read original” is used.
- Speech requests are split into small UTF-8-bounded passages, then played in sequence. This version uses synchronous Cloud TTS per passage, with immediate local interruption; it does not yet stream audio bytes while a passage is generated.

## Current limitations

This is a working prototype, not a complete replacement for assistive technology. Cloud speech and language quality must be tested with blind Sinhala speakers. Sinhala Gemini-TTS support is listed as Preview by Google. First-time OS permission dialogs and service setup may need assistance.

The page collector covers the main document and loaded content. Iframes, shadow DOM content, image-only text, inaccessible custom widgets, downloads/uploads, CAPTCHA, password entry, and complex forms are outside the first version. At most 140 interactive candidates, 100 results/headings, and 160 article passages are collected. Long pages need further scrolling and refreshed lists. YouTube's changing layout may require adapter updates. Website consent screens and anti-automation restrictions can interrupt navigation.

System microphone permission and keyboard shortcuts are used for the browser app; there is no Finder or general macOS automation. Use headphones when trying live speech with media playback. Stop and retry if browser audio is mistaken for your command.

## Verification and packaging

```sh
npm run check
npm test
npm run test:ui
npm run build:mac
```

Core tests cover payload preservation, safe URLs, confidence handling, action confirmation, cancellation, encrypted settings, and actual Google request serialization. Real headless Chrome tests cover page extraction, Sinhala form text, sensitive-field omission, stale targets, practice navigation, and tabs. Desktop tests launch Electron and exercise the interface with isolated temporary settings, including automated WCAG A/AA checks on Home, Reader, and Connections; screenshots are saved in `artifacts/`. These automated checks do not replace testing with blind users.

During the initial build, a live anonymous YouTube search also successfully produced linked reading results. Google STT/TTS, Gemini, and Jev live calls have not yet been validated with user credentials.

`npm run build:mac` creates an app in `dist/`. `npm run dist:mac` creates a disk image. Local builds are unsigned/ad hoc unless a developer signing identity is configured. Notarization and signed distribution are separate release steps. No publishing is performed by these scripts.

## Sources and inspiration

- [Jev voice-browser reference](https://github.com/moritzkremb/jev-voice-browser)
- [TypeSafe typed questions](https://docs.typesafe.ai/primitives)
- [Chirp 2 language and recognition-method support](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-2)
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Google Cloud Gemini-TTS setup, permissions, and languages](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)

See `THIRD_PARTY_NOTICES.md` for reference attribution.
