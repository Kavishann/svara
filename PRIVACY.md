# Data and services

Svara is an early macOS browser prototype. This document describes the current code, not the cloud providers' retention policies.

- **On your Mac:** Live browsing uses your ordinary Chrome profile and a dedicated Svara window. The companion reads pages only in that window; Google account sign-in pages are excluded. Practice mode uses a separate profile. Svara saves settings, shortcut choices, and a credential-file path. API keys are encrypted with macOS-backed Electron secure storage. Raw microphone recordings and command history are held in memory, not deliberately saved by Svara. Reports or screenshots you create may contain page information.
- **Local speech:** Item numbers and passages identified as English use Apple's installed Samantha voice. Language detection also runs on the Mac. These operations send no text to a cloud speech or translation provider.
- **Google Speech:** A recording is sent only when you release the speaking control after recording starts. Cancel discards the recording. Recognition, non-English speech synthesis, and connection tests use your configured Google account.
- **Reused speech:** Completed cloud-generated audio stays in a bounded memory-only cache (up to 120 passages / 24 MiB) until the app closes or older entries are evicted. Replaying an identical cached passage needs no new speech-generation request. Voice or connection changes clear the cache. Audio is not saved to disk; unfinished or failed generation is not retained in the cache. Requested translation can still make its own cloud request.
- **Gemini:** Non-local commands are sent for language interpretation. Selected text is sent for translation when you ask for Sinhala. Mixed and non-English reading passages use Google Cloud TTS.
- **TypeSafe Jev:** Natural-language browser decisions send the command and a bounded snapshot of page elements and the reading list. Password/payment input fields and form values are excluded, but ordinary page text can still be private. Use care on sensitive pages.
- **Websites:** Chrome sends normal requests to the websites you visit. Those sites and each cloud provider have their own data practices.

There is no Svara account, analytics collector, or shared hosted backend in this repository. Each user supplies their own provider access and pays their own provider usage. Stop prevents subsequent playback and actions; it cannot retract a cloud request already sent.

Remove saved API keys in Connections to clear Svara's stored copies. Credentials supplied through environment variables can reappear at startup. A selected service-account JSON remains in its original location. Removing the application alone does not remove its macOS application-support directory or your normal Chrome profile. The native messaging registration and companion can be removed separately; removing Svara does not sign you out of Chrome.

Never attach credential files, API keys, raw recordings, or private browsing data to a public issue. Read [SECURITY.md](SECURITY.md) for reporting guidance.
