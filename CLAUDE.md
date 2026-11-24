# CLAUDE.md — Romans World (Roman's Shadow Academy)

Project-specific operating canon for every Claude Code session in this repository.
Scope: this repository only. Nothing here changes global Claude Code settings or any other Prompt Haus project.

## What this project is

Romans World is the studio home of **Roman's Shadow Academy**: an original, offline-capable
kindergarten reading and math practice game aligned to California kindergarten standards
(CA RF.K, K.CC, K.OA, K.NBT, K.G). The player is a young child. Every decision is judged first
by whether it is safe, clear and encouraging for that child.

### Architecture (current)

- Plain HTML/CSS/JavaScript progressive web app. No build step, no framework, no dependencies.
- `index.html` loads three scripts in order: `src/curriculum.js` → `src/voice.js` → `src/app.js`.
- `src/curriculum.js` — `window.ShadowCurriculum`: letter, CVC, rhyme, sight-word and shape data;
  the `MODULES` list (id, domain, standard, prerequisites, question count); question generators.
- `src/voice.js` — `window.ShadowVoice`: spoken prompts via device speech synthesis, with an
  optional premium endpoint (`/api/speech`). Settings key: `romanShadowVoiceSettingsV1`.
- `src/app.js` — routes (`home`, `modules`, `mission`, `dashboard`, `settings`), mastery tracking,
  XP and medals. Progress key: `romanShadowAcademyCurriculumV1` in `localStorage`.
- `sw.js` — network-first service worker; bump `CACHE` when shipped files change.
- `images/` — hero and villain pictures supplied by the family (see `images/README.md`).

### Save-data rule

Never rename or restructure `romanShadowAcademyCurriculumV1` or `romanShadowVoiceSettingsV1`
without a migration that preserves the child's existing progress. Losing progress is a defect.

## Canon Update 03 — Fable-first development (in force)

Authorized by Gerald. Overrides earlier model-selection instructions in the project kit.
Full policy: [`docs/studio/MODEL_POLICY.md`](docs/studio/MODEL_POLICY.md).

- **Primary development model:** Fable 5.2, or the latest Fable on Gerald's account.
- **Default thinking effort** for architecture and major development: **High**.
- **Studio Director:** Fable.
- **Fable:** complex engineering, gameplay implementation, creative craftsmanship,
  educational systems, architectural decisions.
- **Opus:** independent reviews, difficult debugging, safety evaluations.
- **Sonnet:** routine maintenance, minor changes, straightforward content implementation.
- **Specialist agents** inherit the session model unless their assigned task explicitly
  requires another model (for example, an independent Opus review).

Priority order: craftsmanship, reliability, maintainability, child-friendly design and
extensibility — over minimizing model usage alone.

Increased model availability is **not** permission to expand scope, activate unnecessary agents,
skip testing or bypass approval gates.

## Standing law (preserved, unchanged by Canon 03)

Canon 03 changes model selection only. Everything below remains binding.
Items 2–6 are working summaries written at studio initialization, because the canonical
project-kit text is not yet in this repository. When the canonical text arrives, it replaces
these summaries word for word.

1. **The Seven Laws.** Preserved in full. Canonical text lives in the Prompt Haus project kit;
   see `docs/studio/CANON.md` for the register. Where the text is not in this repository,
   ask Gerald rather than paraphrase from memory.
2. **Private content separation.** Family photos, Roman's personal details, and any private
   Prompt Haus material stay out of public code, commits, logs, artifacts and third-party
   services. `robots.txt` and the `noindex` meta tag stay in place.
3. **Source Fidelity.** Curriculum claims cite the real standard they map to. Content is
   original; nothing is copied from commercial programs. Never invent a standard code.
4. **Parsing Integrity.** Read source documents and instructions exactly as written. Never
   silently drop, merge or reinterpret a requirement; flag ambiguity instead of guessing.
5. **Work Order discipline.** No implementation begins without an approved Work Order. One Work
   Order at a time, scoped explicitly, tested, then reported before the next begins.
6. **Existing Prompt Haus infrastructure.** Reuse what exists. Do not replace, migrate or
   duplicate established tools, repositories or conventions without approval.

## Engineering standards for this repo

- Keep the zero-build, zero-dependency architecture unless a Work Order approves otherwise.
- Test every change in a real browser (Playwright is available in cloud sessions) at phone
  and tablet widths before reporting it done. Report failures plainly.
- Child-facing copy: short sentences, encouraging, never shaming, never time-pressured.
- Accessibility: large tap targets, spoken prompts for every question, no reliance on reading
  to navigate.
- Branch discipline: develop on the session's assigned `claude/*` branch. No pull request unless
  Gerald asks for one.
- Never put a model identifier in commits, code comments or pushed files beyond this canon
  and the model policy.

## Hard exclusions

- Never reference "Domenica Keys" or any variant.
- Never output copyrighted lyrics or copyrighted characters, art or music.
- Brand palette for Prompt Haus-facing surfaces: red, black, white. No neon, no generic startup look.
  (The child-facing game palette is governed by its own Work Orders.)
