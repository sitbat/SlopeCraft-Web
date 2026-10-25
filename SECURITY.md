# Security policy

This policy covers the independent
[SlopeCraft Web repository](https://github.com/sitbat/SlopeCraft-Web), whose history
starts with the initial Web snapshot. Source attribution and the upstream
baseline are documented in [UPSTREAM.md](UPSTREAM.md). The original SlopeCraft
project and its authors retain ownership of their upstream code;
report issues in separately distributed upstream applications to that project's
maintainers.

## Supported code

Security fixes for the Web port target the current default branch.
Older snapshots may need to be updated rather than patched in
place. This policy is not a promise of a response or resolution deadline.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** option when private
vulnerability reporting is available. Otherwise, use a private contact channel
publicly provided by the repository owner. Do not assume the original author's
contact details are a reporting channel for this port.

Include the affected revision or release, browser/runtime and operating system,
steps to reproduce, observed impact, and a minimal non-sensitive input when
possible. Keep working exploit details and private image/world data out of public
issues while a report is being coordinated. Ordinary UI and conversion bugs can
use the public issue tracker.

## Relevant boundaries

- Images, custom block ZIPs, PNG textures and imported settings/cache bytes are
  untrusted input. Report parser memory-safety problems, unexpected execution or
  access outside the intended browser/file boundaries.
- Conversion and export run locally in a browser Worker and WebAssembly module.
  No image-upload or remote computation backend is part of the Web application.
- The build requires actual WebAssembly Memory64, shared 64-bit linear memory,
  SIMD and pthread support; no wasm32 or single-thread fallback is shipped.
  Its current shared linear-memory maximum is 16 GiB. The metadata-provided
  128–16384 MiB calculation budget (1536 MiB by default) is an estimated per-task
  preflight check, not a total-memory hard limit or proof of available RAM.
  Source images, previews and downloaded files also consume JavaScript memory.
  Large or malicious inputs can still exhaust browser/device resources.
- Native pointers cross the JavaScript boundary as BigInt values. Preserve
  checked pointer/length conversions, bounds checks and bounded UTF-8 decoding;
  truncating an address to 32 bits can corrupt access above 4 GiB.
- Browser snapshots and conversion history do not constitute a saved project.
  Reloading the engine or clearing the corresponding cache invalidates native
  variants; page reload does not restore source images. Preview storage is
  separately limited to 256 MiB and 24 LRU entries, while resident native
  estimates are limited to half the applied calculation budget.
- The pthread build requires a secure context and confirmed cross-origin
  isolation. Existing server COOP/COEP headers can provide it directly. On an
  HTTPS static site, a same-directory Service Worker may add those headers to
  controlled responses, with a first-load reload before the engine starts.
- Keep `coi-serviceworker.js`, `static-bootstrap.js` and
  `browser-environment.js` as trusted application files served with JavaScript
  MIME types. For the static bootstrap path, the browser must permit Service
  Workers and `sessionStorage`.
  Use a separate same-origin application directory with no competing Worker
  control; startup must not replace another application's Service Worker.
  Direct `file://` access is unsupported, and there is no single-thread fallback.
- The Service Worker path does not replace hosting access controls or production
  network/certificate responsibilities. Those remain with the deployer;
  server-configured isolation headers are still a supported alternative, and
  the local preview script is a development tool.
- Dependency downloads are checked against `web/dependency-lock.json` during
  the Web build. Review changes to pinned dependencies, SDK revisions and CI
  action commits as part of source review.

Static release manifests record file sizes and SHA-256 hashes for integrity
checks. A manifest does not replace verifying where an artifact came from.
