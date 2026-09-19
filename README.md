# Svara

A Mac desktop prototype for browsing through Sinhala speech. Svara controls a separate Chrome window, organizes the page into reading lists, and reads selected content aloud. Web content stays in its original language unless the user requests Sinhala.

## Run on this Mac

Requires macOS 13 or newer, Google Chrome, Node.js 22 or newer, and Xcode Command Line Tools for development (`xcode-select --install`). The current packaged build is for Apple Silicon; Intel builds have not been verified.

```sh
npm ci
npm start
```

Choose **Try practice mode** to explore the local sample page without API credentials. Practice mode has fictional content and cloud speech is off. It supports typed navigation, reader controls, headings, article passages, links, and tabs. It does not simulate successful speech recognition, translation, or AI decisions.

Open **Connections** to configure the live services. The packaged app does not require Node.js, but still needs Google Chrome installed. Live browsing uses the Svara Chrome companion in an ordinary Chrome window, with the installed Chrome profile’s normal sign-in. Svara controls only its dedicated window. Playwright remains for local practice and development tests.

## Agreed service responsibilities

| Responsibility | Service/model |
| --- | --- |
| Recorded Sinhala or English speech → text | Google Cloud Speech-to-Text V2, `chirp_2` |
| Sinhala command → English for Jev; requested content translation | Gemini `gemini-3.8-flash` |
| Choose an allowed browser action and target | TypeSafe `jev-1.13.0` |
| Execute and inspect the browser | Chrome extension + native messaging (Playwright for practice/tests) |
| English reading and item numbers | Apple local speech, Samantha voice |
| Non-English and mixed-language speech | Google Cloud TTS `gemini-2.5-flash-tts` |
| Detect reading language | Apple Natural Language, locally |

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
| Record a command | Hold your speaking shortcut (initially **Control + Option + Space**) or the **Hold to speak** button. Speak after the tone; release to send. |
| Stop voice and cancel pending voice work | **Stop voice** button, **Escape** in Svara, **Control + Option + Escape** anywhere, or a custom Stop key |
| Read a section | Results, Headings, Page text, or Links |
| Move between titles | **↑ / ↓** (or **← / →**) while Page Reader is focused; Previous/Next buttons or custom keys |
| Read the selected item | **R** in the focused reading list, **Read item**, or your custom Read key. Moving speaks only the item number in English, using the Mac’s built-in Samantha voice. |
| Activate selected link | **Enter**, click its title, **Open this item**, or your custom Open key |
| Translate selected passage | Read this in Sinhala; Read the original switches back |
| Read five options | **Read first 5**, or say “read first five” / “මුල් පහ කියවන්න”. Reads from item 1 to at most item 5, then stops, even if continuous reading is enabled. |
| Continue automatically | Keep reading the next item |
| Change speaking speed | Speed slider; applies to the next reading passage |
| Configure keyboard shortcuts | **Keyboard shortcuts** in the sidebar, or **Command + K** in Svara |

Each new page or active tab brings Page Reader forward and selects its first title. YouTube Results contain video titles without channel names, view counts, or durations. Other pages prefer linked headings, then headings or readable text. “Read titles as I move” is off by default; moving announces just the item number using Apple speech, with no translation, internet connection, or API request. Enable the switch to read full titles instead. Rapid moves replace the previous number; Stop, Read item, and starting a recording interrupt it. A short tone is used if local speech is unavailable. Page updates preserve the selected link when it is still present. Svara leaves Connections and Keyboard shortcuts open while you edit them.

At the last item, Svara looks for more results by scrolling or using a recognized Load more control. Moving past the end follows a recognized Next-page link or pagination button. New titles become available without a manual refresh. Site-specific controls, consent pages, or slow loading can still require manual help or another Next press.

In **Keyboard shortcuts**, choose a key and optional extra keys for Results, Headings, Page text, Links, selected-item reading, first-five reading, Sinhala/original reading, speaking, previous, next, opening, and stopping voice. **Use single keys · F2–F12** selects F2 Results, F3 Headings, F4 Page text, F5 Links, F6 Previous, F7 Next, F8 Speak, F9 Open, F10 Read, F11 First five, and F12 Stop. Sinhala/original reading keys are available to assign separately. Existing saved keys are preserved; new actions initially appear as Not assigned. Choose **Save and use shortcuts** to apply the choices immediately and return Home. Your choices are saved on this Mac and restored at startup; existing API connections are preserved. Home and spoken Help show the saved keys.

Releasing the speaking key (or a required modifier) finishes recording and processes the command automatically. Escape cancels without sending. A release before the microphone is ready cancels that attempt; hold again after granting microphone permission. Each recording is limited to 45 seconds.

Custom shortcuts work across applications while Svara runs. Single letters, arrows, Space, and Enter therefore also intercept normal typing; switch custom shortcuts off in the editor when needed. Function keys may require Fn depending on your Mac keyboard settings. Keys are paused while the editor is open so you can use its controls. Command + K opens the editor from Svara, and Command + Q remains available to quit. Duplicate or unavailable keys cannot be saved, and a failed change keeps the previous shortcuts. The Open shortcut uses the currently selected reading item and retains normal target verification and confirmation.

Commands include `open YouTube`, `search YouTube for ...`, `new tab`, `go back`, `read results`, `next`, `previous`, `repeat`, `read in Sinhala`, `read original`, `where am I`, `play`, `pause`, and `stop`. Sinhala fixed phrases are listed under Help & commands. Conversational Sinhala and mixed-language phrases are translated by Gemini before Jev evaluates them.

In **Keyboard shortcuts → Pause / resume media**, choose a key and select **Save and use shortcuts**. The key starts unassigned to preserve existing choices. Press once to pause the current page's playing video or music, then press again to resume the same players. Holding the key does not toggle repeatedly. Play, Pause, and this shortcut use short English feedback through the Mac voice without translation or a cloud speech request. These controls cover standard video/audio elements in the main page, not other tabs, embedded frames, or Web Audio players. **Stop voice** stops Svara's reading; media does not automatically pause when recording begins.

To sign in to YouTube, choose **Show browser** and use the normal Google sign-in page in Chrome. Google sign-in pages are excluded from page reading and automated field entry. Type passwords and verification codes directly on the website. Svara does not copy cookies from the old automated profile. Video playback and sign-in still depend on the website and your Chrome profile; an extension is not a guarantee that every YouTube error is resolved.

Recordings are capped at 45 seconds and submitted after the user finishes. This is not word-by-word streaming recognition: Sinhala is not listed in Chirp 2's documented streaming-language set. Select the expected input language in Connections. Mixed Sinhala–English accuracy needs evaluation with actual speakers.

English reading is detected locally from the actual text, including on pages whose language label is wrong. Latin-script text identified as English uses Apple speech; Sinhala, mixed scripts, other detected languages, and unidentified text use the cloud path. Very short names, mixed Latin-script languages, and romanized Sinhala can be ambiguous and still need evaluation with users. English practice reading works offline; non-English practice speech remains off.

## Behavior and boundaries

- Search terms and dictated text must remain an exact substring of the original transcript. Translation that changes the payload is rejected.
- Search results retain their link identity. Before clicking, the app checks document identity, URL, element ID, label, role, and destination. A changed page or result requires refreshing the list.
- Ordinary non-link clicks and potentially consequential links need confirmation. Recognized Load more and pagination controls are handled directly by reader navigation; form controls and obvious account/payment destinations are excluded from automatic pagination. Confirmation expires after 60 seconds and revalidates the target. Cancelling invalidates in-flight model responses. These rules reduce mistakes; they cannot establish every possible website side effect.
- Page content is passed as untrusted data. Only fixed browser operations exist. Sensitive input fields, including passwords and payment codes, are excluded from the snapshot, and form values are not collected.
- The renderer has no Node.js access. IPC checks the calling window and frame. Navigation and remote windows from the app UI are blocked; browsing happens in a separate sandboxed browser process.
- Raw recordings and command transcripts are kept in memory, not saved by Svara. Chrome keeps its ordinary profile and website sessions; local practice uses a separate profile. Cloud providers apply their own retention policies.
- Original-language reading is the default. Sinhala translation applies to the selected reading mode until “read original” is used.
- Speech requests are split into small UTF-8-bounded passages, then played in sequence. Gemini 2.5 Flash TTS streams 24 kHz PCM audio, which starts playing before the passage finishes generating. Stop immediately drops queued playback and cancels unfinished speech requests. First-five reading advances only after the current item's audio finishes playing.
- Completed cloud audio is reused in memory during the app session, keyed by exact text, language, voice, model, and Google connection. The cache holds at most 120 passages / 24 MiB and removes older entries as needed. Interrupted or failed generation is not cached. Changing the voice or connection clears the cache; quitting clears all cached audio. A first reading still waits for Google's first audio, and requested translation is a separate step.

## Current limitations

This is a working prototype, not a complete replacement for assistive technology. Cloud speech and language quality must be tested with blind Sinhala speakers. Sinhala Gemini-TTS support is listed as Preview by Google. First-time OS permission dialogs and service setup may need assistance.

The page collector covers the main document and loaded content. Iframes, shadow DOM content, image-only text, inaccessible custom widgets, downloads/uploads, CAPTCHA, password entry, and complex forms are outside the first version. Snapshots include at most 140 Jev action candidates, 500 results/links, 300 headings, and 160 article passages. Reader links remain directly clickable beyond Jev’s candidate limit. Very long lists beyond the collector limits and unrecognized pagination need further work. YouTube's changing layout may require adapter updates. Website consent screens and anti-automation restrictions can interrupt navigation.

System microphone permission and keyboard shortcuts are used for the browser app; there is no Finder or general macOS automation. Use headphones when trying live speech with media playback. Stop and retry if browser audio is mistaken for your command.

## Chrome companion setup

1. Install and open Svara. It opens ordinary Google Chrome automatically.
2. In **Connections**, choose **Set up Chrome**.
3. In Chrome’s Extensions page, turn on **Developer mode**, choose **Load unpacked**, and select the **chrome-extension** folder revealed in Finder.
4. Return to Svara and choose **Connect Chrome**.

The extension stays in the app’s Application Support folder; do not delete that folder. Each Mac needs this one-time setup. The current preview is loaded locally and has not been published to the Chrome Web Store. After upgrading Svara, use Reload on the companion in Chrome’s Extensions page if it was already installed. API keys remain in the Mac app.

The app installs an exact-extension native messaging registration at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.svara.browser.json`. A private local socket connects the extension to the running app. No network listening port, browser debugging port, or automation launch flags are used for live browsing. Browser operations are a fixed set of commands; web pages cannot send arbitrary browser or system commands.

The companion requests HTTP/HTTPS page access for browsing arbitrary sites, but injects only into Svara’s dedicated window. It does not request cookies, passwords, history, or debugger access. Closing Svara disconnects controls and leaves your Chrome windows open. To remove the connection, remove the companion in Chrome and delete its native-host registration. Legacy `browser-profile` data is left untouched.

## Verification and packaging

```sh
npm run check
npm test
npm run test:ui
npm run build:mac
```

Core tests cover payload preservation, safe URLs, confidence handling, action confirmation, cancellation, encrypted settings, and actual Google request serialization. Real headless Chrome tests cover page extraction, Sinhala form text, sensitive-field omission, stale targets, practice navigation, and tabs. Desktop tests launch Electron and exercise the interface with isolated temporary settings, including automated WCAG A/AA checks on Home, Reader, and Connections; screenshots are saved in `artifacts/`. These automated checks do not replace testing with blind users.

Reader regression tests use local fixtures for YouTube title layouts, AJAX replacement/appends, infinite scrolling, pagination, and cancellation. Speech tests cover streamed PCM before completion, chunk boundaries, session reuse, bounded cache eviction, cancellation, late chunks, and first-five playback completion. UI tests use simulated audio and isolated settings, without microphone recording or paid service requests. Live speech quality and unusual website layouts still need testing with users.

`npm run build:mac` creates an app in `dist/`. `npm run dist:mac` creates a disk image. Both commands apply an ad-hoc signature to the complete app, including its helpers, before packaging. The build verifies the signature, sealed resources, and native helper architectures; `npm run verify:mac` repeats this check on an existing app. No publishing is performed by these scripts.

The default preview build is **not Developer ID signed or notarized**. macOS may require the user to approve a downloaded preview through **System Settings → Privacy & Security → Open Anyway** after trying to launch it. Only approve a copy obtained from this project's intended release. Do not disable Gatekeeper system-wide. Versions up to 0.6.0 were packaged without a complete app signature and can produce “Svara is damaged”; replace those downloads with 0.6.1 or newer. Signature verification on the build Mac does not establish that another Mac will accept the download automatically.

For a public download without these manual approval steps, configure a Developer ID Application certificate and Apple notarization credentials, override `mac.identity` with that certificate and `mac.notarize` with `true`, then validate the notarized download on a clean Mac. The ad-hoc preview requires library-validation exceptions for Electron and its native modules; review entitlements when configuring Developer ID distribution. See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) and [Apple's app-opening guidance](https://support.apple.com/en-us/102445).

## Sources and inspiration

- [Jev voice-browser reference](https://github.com/moritzkremb/jev-voice-browser)
- [TypeSafe typed questions](https://docs.typesafe.ai/primitives)
- [Chirp 2 language and recognition-method support](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-2)
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Google Cloud Gemini-TTS setup, permissions, and languages](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)

See `THIRD_PARTY_NOTICES.md` for reference attribution.

Hold-to-talk uses a bundled Node-API module built with Xcode Command Line Tools by `npm start` and the Mac build scripts. It pairs the Carbon press and release events for Electron’s registered shortcut ID. It does not poll ordinary keyboard state, capture typed text, or install a global keyboard event tap. The release handler is refreshed after shortcut registration or editing changes. The native regression test uses events inside its own process; it does not generate system keyboard input.

## Open-source release

Licensed under [MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md), [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md). Provider access is supplied separately by each user; this project does not include free hosted speech or shared credentials.

Publish as an early macOS prototype until keyboard-only setup, physical hold-to-talk, Sinhala/mixed-language quality, and common websites have been tested by blind Sinhala users on clean Macs. Before opening the repository, review staged files and history and remove private issue attachments. Verify GitHub secret protection settings, review any [secret-scanning alerts](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning), and enable private vulnerability reporting. Before uploading an app binary, [sign and notarize it](https://developer.apple.com/developer-id/), verify the packaged notices and native helpers, and test installation on a Mac without the development environment.
