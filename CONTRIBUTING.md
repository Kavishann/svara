# Contributing

Svara is an early macOS project focused on browser access for blind Sinhala speakers.

Start with the setup and controls in [README.md](README.md). Development needs macOS, Google Chrome, Node.js 22 or newer, and Xcode Command Line Tools. `npm ci` installs dependencies; `npm start` builds the native helpers and opens Svara.

Practice mode and automated tests work without cloud credentials. English practice reading and number announcements use the local Mac voice; non-English practice speech stays off.

Before submitting a change, run:

```sh
npm run check
npm test
npm run test:ui
```

Include the problem, the new behavior, and relevant test results. For reader changes, test English, Sinhala, and mixed-language content, keyboard-only use, interrupted playback, AJAX updates, and focus after navigation. Testing with blind Sinhala speakers is especially valuable; automated accessibility checks are not a substitute.

Use fictional or public test content. Keep private credentials, recordings, browser profiles, and screenshots out of commits. Report vulnerabilities according to [SECURITY.md](SECURITY.md).

Project contributions are under the [MIT license](LICENSE). Dependencies and reference projects retain their own licenses and notices.
