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
- The pthread build requires a secure context and cross-origin isolation.
  Hosting responses and access controls are the deployer's responsibility;
  the local preview script is a development tool.
- Dependency downloads are checked against `web/dependency-lock.json` during
  the Web build. Review changes to pinned dependencies, SDK revisions and CI
  action commits as part of source review.

Static release manifests record file sizes and SHA-256 hashes for integrity
checks. A manifest does not replace verifying where an artifact came from.
