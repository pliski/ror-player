# Todos for ror-trainer

- [X] how to debug the the avg Delta and drift ? How can I produce a sound that is right on the spot for a simpler partition to validate the the app is correct? can I exploit the speakers feedback into the mic? This would be an auto-calibration step.
- [X] add speed selector as in "Listen" feature (with a reset button)
- [X] restyle UX  (Session 9, 5 commits `e6fa4b0`..`816bb35` — see `.stash/requirements/2026-05-28-trainer-restyle-design.md` + plan)
- [X] **Multi-line partition v2** (Session 9, `0b1c7b6` — see `.stash/requirements/2026-05-28-trainer-multiline-v2-design.md` + plan): balanced rows, column alignment, label-free, ResizeObserver-driven.
- [ ] i18n : Do we need to translate any label for the new feature?
- [~] Update the guide (https://player-docs.rhythms-of-resistance.org/)
        * [X] Train page added in ror-player-docs (`8bb5924`, branch `ror-trainer`): full feature walkthrough incl. qualitative score explainer + the latency↔drift note (a constant drift can be cancelled by an equal latency offset — correct calibration only if the drift comes from the audio path, not your playing). Spec/plan: `.stash/requirements|plans/2026-05-29-trainer-docs-page-*.md`. Ships when both ror-trainer branches merge.
        * [ ] Any other guide pages that need trainer cross-links / updates.
- [ ] deploy on VPS / add to https://ror.quaidubas30.ch (new website with shhetbook-generator and ror-player )

## refactor counters — DONE (Session 10, `47f6232`..`45972b7`; spec `.stash/requirements/2026-05-29-trainer-counters-refactor-design.md`)
- [X] counter are inversed → misses is now a monotonic Start→Stop total (no jump-up-then-tick-down); hits is a plain count (denominator dropped)
- [X] explain me the counters and the score, particularly:
        * why "hits" is xxx/yyy ? → was hits/expectedTotal (expectedTotal jumped each loop). Denominator removed; hits is a plain count. Accuracy lives in the score's 60% term.
        * Laterncy = lag, ok but latency = drift? → latency offset shifts every hit uniformly; drift is the average signed error, so a constant drift CAN be cancelled by an equal latency. Cheating only if the drift is your playing, not your audio path (→ docs follow-up under "Update the guide").
        * How the score is calculated? → 60 × (hits/expected) + 40 × (1 − avg|Δ|/offTolerance), clamped 0–100. avg|Δ| relabelled "Timing" (±N ms), all live values are session totals (caption added).

## Smoke test

- [ ] Do a general smoke test on mobile

## Known edge cases (deferred)

- [ ] **Loop-boundary bucketing double-count** (Session 11). When the *next* loop's downbeat is hit early enough that its onset is detected *before* the loop-wrap event fires ("race lost"), the engine buckets that hit into the *previous* loop. The circular matcher (`fix(trainer): score slightly-early downbeats…`, `1061301`) counts it as a hit, but if that previous loop also had its own on-time downbeat, the final tally shows 1 hit + 1 extra + 1 miss instead of 2 hits. Mild scoring blip only; the live cell highlight is unaffected.
  - **Why deferred:** real-world frequency is unmeasured — onset-detection latency likely makes the early hit land in the *correct* (next) bucket most of the time ("race won"). Need evidence before investing.
  - **Why it's not a scorer-only fix:** the engine's always-positive modulo at `trainerEngine.ts:127` collapses pre-wrap (`+980`) and post-wrap (`−20`) into the same `980`, destroying the info the scorer would need to tell "carry me forward" hits from "already correct" ones. A sound fix needs a companion engine change (preserve signed pre/post-wrap time) — see Session 11 analysis for options A (continuous-time loop assignment) / B (carry-forward + signed time) / C (global match).

## Maybe later

- [ ] add an onboarding with the same infos.
- [ ] add signs