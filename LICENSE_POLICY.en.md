# LICENSE POLICY

This file defines the file/path-level license boundaries for the current versions of the ManimCat repository.

## 1) Priority

1. `LICENSE_POLICY.md` (this file and its Chinese counterpart) defines file/path-level license boundaries.
2. `LICENSES/MIT.txt` and `LICENSES/AGPL-3.0.txt` provide the full license texts.
3. Files not listed in the MIT retention list below default to `AGPL-3.0-or-later` for current versions.

## 2) MIT retention list

The following files/paths remain under MIT, generally because they contain original upstream project material or a clearly continuing derivative chain from that material:

- `src/services/manim-templates.ts`
- `src/services/manim-templates/**`
- `src/services/openai-client.ts`
- `src/services/job-store.ts`
- `src/utils/logger.ts`
- `src/middlewares/error-handler.ts`

Third-party notices:
- `THIRD_PARTY_NOTICES.md`
- `THIRD_PARTY_NOTICES.zh-CN.md`

## 3) AGPL scope (default)

Except for the MIT retention list above, all other files in the current versions of this repository default to `AGPL-3.0-or-later`.

## 4) Historical versions

- Historical releases remain governed by the license terms that were published with those versions.
- This file does not retroactively rewrite license statements for already-published historical versions.

## 5) CLA status

- This project no longer requires contributors to sign or agree to a CLA.
- Future contributions are no longer gated on a centralized commercial-authorization CLA workflow.
