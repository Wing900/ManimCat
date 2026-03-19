# LICENSE POLICY

This file defines the binding license scope for the ManimCat repository.

## 1) Priority

1. `LICENSE_POLICY.md` (Chinese policy) and this English mirror define file/path-level boundaries.
2. `LICENSES/MIT.txt` and `LICENSES/ManimCat-NC.txt` provide full license texts.
3. Files not listed in the MIT list in `LICENSE_POLICY.md` are treated as `ManimCat-NC` (Non-Commercial) by default.

## 2) MIT List (Commercial Use Allowed)

The following files/paths are under MIT (because they include upstream-related parts or highly similar derivative chains):

- `src/services/manim-templates.ts` (because it includes upstream-related template and matching chains)
- `src/services/manim-templates/**` (because it includes upstream-related template and matching chains)
- `src/services/openai-client.ts` (because it includes upstream-related call chains)
- `src/services/job-store.ts` (because it includes upstream-related interface chains)
- `src/utils/logger.ts` (because it includes upstream-related logging structures)
- `src/middlewares/error-handler.ts` (because it includes upstream-related error-handling chains)

Third-party notices:
- `THIRD_PARTY_NOTICES.md`
- `THIRD_PARTY_NOTICES.zh-CN.md`

## 3) Non-Commercial Scope (Default)

Except for the MIT list above, all other files in this repository default to `LICENSES/ManimCat-NC.txt`.

## 4) Separate Commercial Licensing

If you want to use files in the non-commercial scope for commercial purposes, a separate written license from the author is required.

## 5) Historical Versions

This policy defines the scope for current and future versions of this repository. If historical versions were released under different terms, refer to the license statement in those versions.
