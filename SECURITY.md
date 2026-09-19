# Security reports

Svara is a pre-release prototype. A public security support schedule has not been established.

For a vulnerability, use the repository's **Security → Report a vulnerability** option if the maintainer has enabled private vulnerability reporting. If it is unavailable, open an issue asking for a private reporting channel without including the exploit, credentials, or private data. Do not post service-account files or API keys.

Useful reports include the app version, macOS version, a minimal reproduction on a non-sensitive test page, expected behavior, and observed behavior. Remove personal information from logs and screenshots.

## Boundaries

Web content and model responses are untrusted. Svara allows fixed browser operations, verifies targets before activation, and asks before ordinary non-link actions and potentially consequential links. These checks do not guarantee the safety of every website. The renderer is sandboxed, with context isolation and restricted IPC. Shell commands are not an available model action.

Credentials are supplied by each user. Do not distribute shared Google or TypeSafe credentials in code or release assets. macOS signing and notarization are required release work for a trustworthy downloadable distribution; local development builds are not distribution-signed.
