# Sprint 13.2 & 13.3 — Production Hardening: TranscriptHero + CaptionBar Performance

**Date**: 2026-06-29
**Model**: Claude Opus 4.6
**Tasks**: 13.2 (TranscriptHero framer-motion optimization) + 13.3 (CaptionBar Karaoke DOM optimization)

## Task 13.2: TranscriptHero framer-motion optimization

### Problem
Long sessions (200+ transcription results) cause O(n) framer-motion `layout` animation recalc per render frame. Every old result entry gets a `motion.article` with `layout` prop, adding unnecessary per-frame cost.

### Solution
Cap animation overhead while keeping all content visible (no virtualizer dependency):
- **MAX_MOTION_ITEMS = 50**: Only the last 50 results are wrapped in `<motion.article>`
- **MAX_LAYOUT_ITEMS = 5**: Only the last 5 motion items get `layout` prop
- Older results render as plain `<article>` elements (zero animation overhead)
- `AnimatePresence initial={false}` prevents entrance animation on initial batch
- `data-performance` attribute on `.transcript-stream` exposes `motion=X,layout=Y,visible=Z`

### Performance impact
- 200 results: 150 items at `data-motion="off"` (0 motion overhead), 45 items with motion but without layout, 5 items with full layout animation
- rAF cost drops from O(200) layout calcs to O(5) per frame

### Files changed
- `client/src/components/TranscriptHero.tsx` — motion gate logic + `renderItemContent()` helper
- `client/src/__tests__/TranscriptHero.perf.test.tsx` — 7 new tests covering all scenarios

## Task 13.3: CaptionBar Karaoke DOM optimization

### Problem
Every rAF frame calls `renderKaraoke()` which returns 100+ React elements mutated by React and fed to the DOM, destroying and recreating span trees every 16ms. This is O(n_words) per frame.

### Solution
Retain-mode DOM updates: React builds spans once via `useMemo`, rAF tick only swaps attributes.
- **useMemo** creates stable `<span data-word-index={i}>` elements keyed by index
- **rAF tick** directly updates DOM attributes:
  - `karaoke[data-active-idx]` — current word index on wrapper
  - `karaoke[data-progress]` — global progress on wrapper
  - `.transcript-word.is-active` / `.is-past` class swaps (only on idx change)
  - `activeEl.style.setProperty('--progress', ...)` — CSS variable for same-frame transition
  - `.word-progress.style.width` — direct inline width update
- Gap/jump handling: when `idx` jumps by >1, intermediate words get `is-past` class

### Performance impact
- From O(n_words) React reconciliation + DOM creation per rAF frame to O(1) attribute swaps
- Span elements are reused across frames; only one `querySelector` for the active word

### Files changed
- `client/src/components/CaptionBar.tsx` — replaced `renderKaraoke()` + React-state-driven rAF with `useMemo` + direct DOM manipulation
- `client/src/__tests__/CaptionBar.karaoke.test.tsx` — added 5 new tests for DOM optimization
- `client/src/styles.css` — simplified `.word-progress` width to use `--speaker-color`

## Test coverage

### Task 13.2 tests (7 total)
1. Renders all 200 results as articles
2. First 150 `data-motion="off"`, last 50 `data-motion="on"`
3. Items 150-194 have `data-layout="off"`, 195-199 have `data-layout="on"`
4. Fewer than 50 results: all `data-motion="on"`
5. `data-performance` attribute contains `motion=50,layout=5,visible=75`
6. `data-performance` updates on rerender
7. `AnimatePresence initial={false}` prevents entrance animation

### Task 13.3 tests (5 added, 11 total)
1. (existing) Renders words as span.transcript-word sequence ✓
2. (existing) Marks active word is-active on rAF ✓
3. (existing) K key toggles karaoke off ✓
4. (new) Karaoke wrapper has data-active-idx and data-progress attributes
5. (new) Span elements have stable data-word-index attribute
6. (new) Only attributes change between frames, not DOM structure
7. (new) Active word gets data-progress attribute for CSS transitions
8. (new) Past words get is-past class when active advances

## Backward compatibility
- `TranscriptHero` public interface unchanged
- `CaptionBar` public interface unchanged
- e2e test (`e2eKaraokeCaption.test.tsx`) passes without modification
- `.word-progress` span still present in DOM for existing test selectors