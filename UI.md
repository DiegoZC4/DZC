# UI Patterns

Reusable interface patterns for this personal website. These are preferred local conventions when a page needs the same kind of control again.

## Smooth Sliding Pill Toggle

Use when choosing exactly one option from a small set, especially 2 to 4 options. This is the preferred segmented-control style for modes, score views, display options, and other repeated settings.

Source:
- `EarTraining.html`
- CSS: `.pill-toggle`, `.pill-toggle-group`, `.pill-thumb`, `.pill-option`
- JS: `syncPillThumb(groupEl, activeButton)` and `animatePillGroup(groupEl, updateFn)`

Structure:

```html
<div class="pill-toggle">
  <div class="pill-toggle-group" role="tablist" aria-label="Mode">
    <span class="pill-thumb" aria-hidden="true"></span>
    <button class="pill-option" type="button">One</button>
    <button class="pill-option" type="button">Two</button>
    <button class="pill-option" type="button">Three</button>
  </div>
</div>
```

Behavior:
- The active button gets `.is-active`.
- `.pill-thumb` slides underneath the active button instead of each button drawing its own active background.
- The thumb should be measured from the actual active button with `offsetLeft`, `offsetTop`, `offsetWidth`, and `offsetHeight`, so it works for uneven label widths and wrapped/four-mode layouts.
- Wrap state updates in `animatePillGroup(...)` when the active option changes.

Style notes:
- Capsule track, small internal padding, active thumb in a light fill.
- Text color changes only on active/inactive states.
- For four options that need two rows, use the `EarTraining.html` `.is-fourmode` pattern.

## Joined Color Picker Pill

Use when two related colors or states form one conceptual pair, such as On/Off beads, foreground/background, or start/end color.

Source:
- `soroban.html`
- CSS: `.color-pair`, `.color-swatch`, `.color-swatch-on`, `.color-swatch-off`

Structure:

```html
<div class="color-pair" aria-label="Bead colors">
  <label class="color-swatch color-swatch-on">
    <span>On</span>
    <input type="color" id="on">
  </label>
  <label class="color-swatch color-swatch-off">
    <span>Off</span>
    <input type="color" id="off">
  </label>
</div>
```

Behavior:
- Each half is a label containing a real native `input[type="color"]`.
- The color input is invisible but absolutely positioned to cover the whole half.
- The visible swatch uses CSS variables such as `var(--on)` and `var(--off)`.
- Existing color input event listeners should continue to target the native input IDs.

Style notes:
- One shared rounded capsule, split by a single center divider.
- Each half uses the actual selected color as its background.
- Label text sits in a small white chip so it stays readable against saturated colors.
- Prefer this over separate square browser-native color controls when the two colors are semantically paired.

## Draggable Number Control

Use for bounded numeric settings where typing is unnecessary and pointer dragging is enough, such
as columns, digits, level, count, or a touch-first volume percentage.

Source:
- `soroban.html`
- CSS: `.drag-number-control`, `.drag-number-value`
- JS: `NumSlider`

Structure:

```html
<label class="drag-number-control">
  <span>columns</span>
  <button class="drag-number-value" type="button">5</button>
</label>
```

Behavior:
- Dragging up increases the value and dragging down decreases it. Ignore horizontal displacement
  entirely, so a touch user can slide their finger sideways to uncover and inspect the displayed
  value without changing it.
- Use `cursor: ns-resize` to communicate the vertical gesture.
- Clamp to the allowed range and snap to the configured step.
- The configured step may depend on the active representation when the underlying renderers respond
  differently. For choir-practice score stretch, use uniform 5% steps in pitchbar view while
  retaining the coarser AlphaTab-oriented stops in standard notation; preserve an existing value
  when switching representations even if it is not one of the new view's normal stops.
- Scale drag sensitivity to the range: wider ranges such as 0–100 need fewer pixels per step so the
  full range remains reachable in one practical phone gesture.
- Store the value in `data-value`, display the same value as button text, and emit an `input` event
  only when the snapped value changes. Pointer movement that remains within the current step must
  not emit; otherwise no-op drags can trigger expensive downstream renders.
- On every pointer move, apply `startValue + verticalDelta * step`, including when the vertical
  delta is zero. Do not return early for a zero delta: dragging away and then back to the starting
  height must restore the previously set value instead of skipping over it by one step.

Style notes:
- Compact row with label on the left and the numeric value button on the right.
- Numeric button should feel clickable/draggable, not like a text field.
- Give related percentage readouts one explicit fixed width that fits `100%`
  without resizing. Use tabular numerals, and include that fixed value width in
  the parent grid so labels and value edges align across neighboring rows.
- Prefer this over typing for narrow ranges.

## Draggable Rotary Pan Ring

Use for bipolar stereo-pan controls where left/right direction matters more than displaying an
exact number. Prefer this to a draggable number for pan.

Source:
- `/Users/diego/Desktop/Music/nature-boy-web/app.js`
- CSS: `.part-pan-knob`, `.part-pan-ring`, `.part-pan-indicator`
- JS: `createPanKnob(...)`

Structure:

```html
<button class="part-pan-knob" type="button" role="slider"
  aria-label="Soprano 1 pan" aria-orientation="horizontal"
  aria-valuemin="-100" aria-valuemax="100">
  <span class="part-pan-ring" aria-hidden="true">
    <span class="part-pan-cap">
      <span class="part-pan-indicator"></span>
    </span>
  </span>
</button>
```

Behavior:
- Use a 270-degree sweep with center at twelve o'clock, hard left at the lower-left endpoint, and
  hard right at the lower-right endpoint.
- Drag horizontally: right increases toward the right channel and left decreases toward the left
  channel. Keep the pointer-start value as the drag anchor so returning to the start restores the
  original value.
- Snap to a configurable step; five percentage points is the preferred default for compact mixers.
- Double-click or press `0` to center. Support Arrow keys, Home for hard left, and End for hard right.
- Use pointer capture, cancel cleanly on `pointercancel` or lost capture, and use `touch-action:
  pan-y` so vertical page scrolling remains available while horizontal gestures control pan.
- Preserve the underlying numeric value in `data-value`, emit `input` when it changes, and expose
  spoken slider values such as “55 percent left,” “Center,” and “Hard right.”

Style notes:
- Draw the inactive sweep, colored active arc, center detent, and pointer as one compact geometry;
  integrate the center detent into the sweep and have the pointer meet the ring. Do not add a second
  outlined circle inside the value arc or show a persistent numeric readout.
- Give each part's ring and pointer the same identifying color used elsewhere in its mixer column.
- Make the whole cell the drag target even when the visible ring is smaller, and retain a clear
  keyboard focus outline.
- Use `cursor: ew-resize` so the control's gesture direction is explicit.

## Infinite Vertical Pager

Use instead of a dropdown when choosing one value from a short, cyclic list and direct touch
navigation is more useful than opening a menu. This is the preferred style for compact mobile
settings such as display modes, representations, sound presets, and other options that make sense
to page through repeatedly.

Source:
- `ToddleTime.html`
- `/Users/diego/Desktop/Music/mobile-motion-music/src/infinite-pager.js`
- CSS: `.representation-pager`, `.pager-layer`
- JS: `renderPager()`, `layoutPager(...)`, `animatePagerTo(...)`

Structure:

```html
<div class="infinite-pager" role="spinbutton" tabindex="0"
  aria-label="Key labels"></div>
```

Behavior:
- Keep three recycled layers: previous, current, and next.
- Dragging up selects the next option; dragging down selects the previous option.
- Wrap indices in both directions so the pager never reaches a dead end.
- While the pointer is held, move all three layers continuously and exactly with the pointer. Do
  not use a motion dead zone, animate toward a value, commit a value, or snap during the drag.
- Recycle layers without a visible discontinuity after each full-height move.
- Only after release, animate to whichever value center is nearest. Move to an adjacent value only
  when the released position is more than halfway there; at the halfway point, retain the current
  value.
- A stationary tap retains the current value.
- Support vertical mouse-wheel input and Arrow Up/Arrow Down keyboard input.
- Use pointer capture, cancel cleanly on `pointercancel` or lost capture, and prevent page scrolling
  while the control is active.
- Update `data-value`, `aria-valuenow`, and `aria-valuetext`, then emit an `input` event whenever
  the committed value changes.
- Honor reduced-motion preferences and keep the release animation brief, around 100ms otherwise.

Style notes:
- Show one centered value at rest; adjacent layers enter from above or below during interaction.
- When options have established semantic colors, put each option's tint and text color on its own
  recycled layer rather than recoloring only the pager container after commit. Add a restrained
  one-pixel trailing-edge seam so two colored pages remain visibly distinct while crossing the
  viewport; the moving page areas then provide the natural continuous color transition.
- If nearby previews depend on the selected page, keep their DOM nodes stable and transition their
  dimensions when the pager commits. Replacing the preview markup at every snap defeats CSS
  interpolation and makes the linked state appear to jump.
- Use a stable clipped height, `touch-action: none`, and a grab/grabbing or vertical-resize cursor.
- Match neighboring compact controls rather than styling the pager as a separate decorative card.
- Prefer this over a `select` for short cyclic choices on touch-first interfaces.
- Keep a normal dropdown for long, searchable, or non-cyclic option lists.

## Binary Note-Label Toggle

Use one switch when a keyboard or pitch surface can either show labels or remain unlabelled.

Source:
- `/Users/diego/Desktop/Music/mobile-motion-music/src/main.js`

Behavior:
- Off hides every note label.
- On labels every chromatic pitch, including black keys.
- Do not introduce a C-only or other pitch-class-specific middle state unless the product explicitly
  requires that analytical distinction.
- Treat a legacy partial-label preference as labels enabled when migrating to this binary control.
- Prefer a switch over a pager, segmented control, or dropdown when these are the only two states.

## Whole-Button Binary Toggle

Use when a named feature has exactly two states and its opposite is the intuitive absence of that
feature, such as **Unique lyrics** on/off or personal **Notes** visible/hidden.

Behavior:
- Make the entire labeled button the toggle instead of placing a miniature switch beside a static
  label. Keep the feature name stable while clicking alternates enabled and disabled states.
- Give the button `aria-pressed`, and update its accessible action label or tooltip so assistive
  technology can distinguish “Enable” from “Disable.”
- Define the normal/default state explicitly. Use the standard selected highlight when enabled and
  the ordinary control surface when disabled; do not rely on text or color alone for accessibility.
- Keep a segmented pill when both values are distinct, useful named modes—such as
  **Vertical/Horizontal**—because hiding one name would discard meaningful information rather than
  merely removing an obvious feature.

Style notes:
- Match the height and width tracks of neighboring compact controls so replacing a separate label
  and switch also improves edge alignment.
- Do not append “On” or “Off” to the visible feature name unless the state remains genuinely
  ambiguous after selected styling and accessible labeling.

## Hierarchical Contextual Reset

Use when a dense settings panel has meaningful control, row, and section scopes and one global
reset would make it unclear which state will be lost.

Behavior:
- Right-click a leaf control to restore only that control to its score- or app-defined default.
- Right-click a row label to reset that row. For a part matrix, **See** shows every part, **Hear**
  enables every part, **Vol** restores the configured volumes, and **Pan** restores configured pan.
- Right-click a section label to reset only the settings contained in that section. Do not let a
  section reset affect sibling groups.
- Use the same action from touch with a 600ms long-press that cancels after more than 8px of pointer
  movement. Suppress the ordinary click after the hold so a reset does not immediately toggle the
  control again.
- Support the keyboard Context Menu key and `Shift+F10` on the same targets. Make otherwise static
  row and section labels focusable and give them a reset description.
- Suppress the browser context menu only on registered reset targets. Preserve normal context menus
  everywhere else.
- Show the completed scope in a short toast and offer one-step **Undo**. Capture the state before the
  gesture begins so long-pressing a control that normally reacts on pointer-down can still undo to
  the true previous state.
- Keep existing double-click reset gestures for draggable numbers and pan rings as secondary
  shortcuts, but resolve their defaults from the same configuration as contextual reset.
- A settings reset must not move playback, erase personal notes, or clear unrelated device data.
  Treat transport position and authored content as separate from preferences.

Style notes:
- Remove a global refresh/reset utility once hierarchical reset covers the panel; its scope is too
  ambiguous for a multi-section rehearsal toolbar.
- Keep the ordinary cursor on resettable static labels; the platform's context-menu cursor adds an
  intrusive icon that makes ordinary inspection feel like a pending reset. Retain a restrained
  keyboard focus outline, and do not replace the labels with visible reset icons or permanent copy.

## Lightweight Procedural Sound Presets

Prefer parameterized Web Audio timbres when a touch instrument needs many sounds without sample
downloads.

Source:
- `/Users/diego/Desktop/Music/lightweight-midi/instrument-bank.config.js`
- `/Users/diego/Desktop/Music/lightweight-midi/src/catalog.js`
- Shared browser module: `/assets/js/lightweight-midi.js`
- Searchable planner: `/MidiInstrumentPlanner.html`

Behavior:
- Treat the shared `lightweight-midi` package as the canonical sound source for small standalone
  music pages; do not copy preset arrays into each HTML file.
- Choose the shared site bank and its ordering in `instrument-bank.config.js`, then run
  `npm run build:site` from `/Users/diego/Desktop/Music/lightweight-midi`.
- Use the searchable planner to compare exact recipe bytes and complete-module gzip totals before
  changing the shared profile.
- Keep optional catalog entries separate from the configured production bank; adding a candidate to
  the catalog must not make every music page download it automatically.
- Import the generated browser module from `/assets/js/lightweight-midi.js` so pages share one
  cacheable download.
- Prefer a useful shared bank around 5 kB gzip over duplicating heavily pared-down inline banks.
- Keep individual General MIDI string programs available: Violin, Viola, Cello, Contrabass,
  Tremolo Strings, Pizzicato Strings, and Orchestral Harp.
- Keep each preset below 500 serialized bytes and free of embedded or remote audio samples.
- Enforce configured limits for the complete bank and generated module during the build.
- Cap each preset at five oscillator partials per note for mobile polyphony.
- Put reusable capabilities such as oscillator waveform and held sustain in the shared engine
  instead of duplicating logic in each preset.
- Use natural-decay envelopes for struck or plucked sounds and held sustain envelopes for organs,
  strings, winds, brass, pads, and sustained basses.
- For chord and individual-note auditions, start on pointer-down and sustain only while held,
  rather than playing a fixed-duration clip after a click. Release with a short click-free fade on
  pointer-up (including outside the target), cancellation, lost capture, window blur, or reflow.
  Support holding Space or Enter on a focused target, and cancel pending audio initialization on
  release so a delayed resume cannot start a chord after the gesture has ended.
- Generate pager values and labels from the same preset registry used by the audio engine.
- Measure the longest visible preset label at every toolbar breakpoint and allocate stable width so
  it is not clipped.

## Direct Manipulation Mode Toggle

Use when the same large interactive surface needs two incompatible touch gestures, such as playing
a piano and repositioning its key range. Prefer a single explicit mode toggle over a separate
miniature pager for every row.

Source:
- `/Users/diego/Desktop/Music/mobile-motion-music/src/main.js`
- CSS state: `.piano-app[data-range-move="true"]`

Structure:

```html
<button type="button" aria-label="Move keyboard ranges"
  aria-pressed="false" title="Move keyboard ranges">
  <!-- familiar horizontal-move icon -->
</button>
```

Behavior:
- Default to the primary-use mode after every load. Do not persist the editing mode.
- When the toggle is inactive, touches perform only the surface's primary action.
- When the toggle is active, suppress the primary action completely and let users directly drag
  the surface being repositioned.
- While repositioning a pitch surface, temporarily show every chromatic note label without changing
  the saved label preference. Restore the normal label visibility when repositioning ends.
- For multi-row surfaces, dragging a row changes only that row.
- Keep movement continuously proportional to the visual units on the surface; one piano-key width
  should move the range by one white key without snapping at intermediate positions.
- Let bounded content be partially visible at an edge while moving. Do not force the viewport to
  align to whole items when smooth inspection is more useful.
- Clamp bounded physical ranges instead of wrapping them.
- Returning a drag to its starting point must restore the original value.
- Release active primary interactions when entering edit mode so notes or other actions cannot
  remain stuck.
- Use `aria-pressed` and a clear selected style on the mode icon.

Style notes:
- Group performance modes and keyboard-geometry controls on the left side of the toolbar.
- Group sound, volume, display/accessibility settings, and window actions on the right.
- Show the editing state through the selected icon and a restrained highlight on editable surfaces.
- Use a familiar move/pan icon with a tooltip; do not add visible instructional text.
- Put compact settings directly in the toolbar when they fit. At narrower logical widths, replace
  those controls with one Settings icon and expose the same synchronized controls in a modal.

## Compact Tool Panel

Use for utility controls beside a visual or interactive main surface.

Source:
- `soroban.html`

Style notes:
- A restrained translucent panel is better than a decorative card stack.
- Keep workflow controls grouped by purpose: primary actions, mode controls, problem controls, settings.
- When a panel contains several unrelated controls, divide it into compact, visibly labeled semantic
  groups rather than presenting one undifferentiated row. Use one understated border per group and
  integrate the small label into that border so categorization adds very little height.
- Put adjustable controls that affect the same output in the same group. For score display, keep
  notation mode, vertical/horizontal direction, vertical scale, and horizontal scale together.
- Group controls by the object they operate on even when they are icon-only: put fullscreen with
  score Display controls and annotation creation with Practice tools. When Download would be the
  only remaining general action, put it beside Fullscreen in Display's narrow utility column and
  omit the orphan Actions group. Use a global reset icon only when its scope is unambiguous; prefer
  hierarchical contextual reset for dense settings panels.
- When an adjacent control matrix has four rows and Actions has exactly four utilities, stack those
  utilities vertically and match the matrix row height instead of widening the toolbar with one
  horizontal action strip.
- Let category groups and their contents wrap independently as soon as space runs out; do not wait
  for a device-width breakpoint to reorganize them.
- Keep a compact settings toggle available at every viewport size. On first use, default the panel
  open on desktop and closed on coarse-touch/mobile devices; after the user changes it, persist that
  choice per tool in local storage so resizing or rotating never overrides it. Apply the overlay
  drawer layout to coarse-touch devices regardless of CSS width so landscape phones do not expose
  a full desktop settings strip that covers the main surface.
- Do not show every metric in every mode. Hide timer/streak/problem controls in a free-use workspace mode if they are not relevant.
- Use compact controls and stable dimensions so the main interactive surface remains the visual focus.
- In a compact rehearsal toolbar, group relative tempo and metronome volume as one narrow column.
  Center a familiar metronome SVG above the column to establish the shared tempo context, then put
  aligned **Speed** and **Vol** draggable-number rows beneath it. Keep their accessible names explicit
  as relative speed and “Metronome volume”; the icon is decorative rather than a substitute for
  either row label. This stays compact without falling back to the ambiguous word “Click.”
- Align neighboring control stacks to shared visual rows instead of vertically centering unequal
  stacks independently. In the rehearsal Practice group, align the part pager with the metronome
  heading, the Learn/Check preset row with **Speed**, and Annotate with metronome **Vol**.
- In four-row rehearsal Practice groups, use three aligned logical columns of two base units each.
  Put the part pager, Learn/Check preview, and Annotate in the first; metronome/Speed/Vol in the second;
  and Pitchbar View/Mic/Erase in the third. Let the loop row span the second and third logical columns,
  keeping the first column visually unified around part-specific practice actions.
  Preserve compact buttons inside those cells instead of stretching every icon to the full track.
- Always honor written dynamics in rehearsal playback. Do not expose a dynamics bypass: practicing
  a flattened version teaches an interpretation the singer must later unlearn.
- Define compact-toolbar row height and vertical gap once on the settings-strip container and reuse
  them in every four-row group. Use 24px rows with 3px gaps as the rehearsal-toolbar baseline, so
  Parts and Display have identical 27px center-to-center rhythm and equal total height.
- Treat the Parts matrix's 48×24px cell with a 3px gutter as the rehearsal toolbar's base unit.
  Use that same 48px track for the Parts row-label column rather than a narrower content-sized
  track, so the matrix establishes one consistent column rhythm. Build the other groups from whole
  units: Display is three columns when it includes a Fullscreen /
  Download / opt-in Help utility rail, and the Practice grid is six base columns grouped as three 99px logical
  columns. A two-column span is 99px. Keep
  labels, numeric controls, pagers, and icon buttons on those tracks instead of accumulating
  unrelated content-driven widths.
- Use the same font size for the Parts matrix's row labels as for visible labels in the other
  rehearsal-toolbar groups. Center **See**, **Hear**, **Vol**, and **Pan** inside their full base-unit
  cells because each label governs the complete matrix row; do not inherit the right alignment used
  for ordinary label/control pairs in other groups. Weight or color may distinguish hierarchy;
  smaller type should not.
- Use Practice columns 3–6 as **Loop | Start | route | End** on the loop row. Start and End are both
  one 48×24px unit and therefore remain identical when their text changes to a measure number.
- In a part matrix, pair the notation and audio rows as **See** and **Hear** rather than “Score” and
  “Hear,” so both labels read as direct actions.
- For clean rehearsal scores, show every measure number, emphasize chapter starts by making their
  existing measure numbers visibly heavier, and show device-local personal notes whenever they
  exist. Do not add a Guides visibility menu by default; add score-specific visibility controls
  only if real notation clutter later demonstrates a need for them. Keep playback cursors and
  highlights always visible.

For responsive score surfaces:
- Name the two reading directions **Vertical** and **Horizontal**. Both directions scroll; do not
  describe one as “scroll” and the other as “wrap.”
- In a compact rehearsal toolbar, label the direction row **Scroll** in the left column and use
  standard two-headed vertical and horizontal arrow icons in its pill. Preserve explicit “Vertical
  scrolling” and “Horizontal scrolling” accessible names and hover titles. When the Display utility
  rail leaves its first row free, let this pill span both remaining base columns and divide that
  width evenly between the two directions.
- Arrange compact score display controls as aligned rows: the Vertical/Horizontal direction selector,
  **Scale** with the overall notation-size percentage, and **Stretch** with the horizontal-spacing
  percentage, with **Lyrics** as a fourth row when needed. Keep visible labels in one fixed column
  and controls in the other; the icon-only direction pill still occupies the control column.
- When these rows need to be maximally compact, use the shared 3px unit-grid gutter between the
  right-aligned labels and left-aligned controls. Keep any surplus
  width after the control, not between the two; zero gap makes the label and control read as one
  cramped object, while `justify-content: space-between` makes the separation unnecessarily wide.
- On touch devices, support two-finger pinch directly on the score to change its visual scale while
  preserving one-finger document scrolling.
- Use the score itself as a playback scrubber in every notation view, but do not seek on pointer-down.
  Stage the candidate position, commit an ordinary tap only on release, and cancel navigation once a
  one-finger vertical drag passes an 8px threshold so mobile score scrolling never moves playback.
  In vertical reading mode, a clearly horizontal drag may enter live scrubbing; bias ambiguous
  diagonals toward scrolling. In horizontal reading mode, preserve native score scrolling in both
  axes and treat only an unmoved tap as navigation. Quantize both the playback state and the visible
  line to the same musically useful grid (an eighth note by default), so the cursor visibly steps
  between valid landing points instead of appearing continuous while a hidden seek value snaps
  elsewhere. Keep standard notation and pitchbar behavior identical, and suppress native text/SVG
  selection only after scrubbing begins so measure numbers and engraved symbols never become
  highlighted. Exclude annotation controls and other interactive overlays from score scrubbing.
- Reflow vertical notation from the score surface's actual available width, including after drawer,
  orientation, split-view, or browser-chrome changes rather than relying only on device breakpoints.
- When a renderer clears its live surface during Scale, Stretch, direction, or part-visibility
  changes, retain the last complete score frame while the replacement renders invisibly. Coalesce
  rapid changes so only the latest pending state renders next, then reveal the completed frame with
  a brief crossfade after the renderer's finished event. Freeze the old score box during the work
  so transient empty or partial geometry cannot move the page. This double buffering masks render
  latency; it does not justify rerendering for audio-only state. Skip the fade under reduced motion.
- Scope renderer loading status to the notation surface it belongs to. Background engraving may
  continue while an alternate pitchbar surface is active, but its status must never cover or block
  that usable surface. Give each engraving attempt a finite timeout; when an unusually compressed
  Stretch value stalls, retry the next higher allowed value, reflect and persist that value in the
  control, and clear the status with a concise error if every allowed value fails.
- Clip playback measure highlights and beat lines to the outermost visible staff lines in the active
  system. Do not shade lyrics, rehearsal marks above the staff, or inter-system whitespace; recompute
  the clip after reflow, scaling, direction changes, and part visibility changes.
- After a score reflow completes, resubmit the unchanged playback position so renderer-owned measure
  and beat cursor layers are recreated against the new geometry; then recompute their clipping for
  several animation frames because the final SVG surface can attach after the finished event.

### Opt-In Setting Help

Use when a compact toolbar contains unfamiliar controls but persistent tooltips would become noisy.

Behavior:
- Put a standard circled **i** icon in the toolbar's last available utility cell. Help is off on every
  load and is not a saved preference; its purpose is temporary inspection, not an application mode.
- While help is off, do not attach native `title` tooltips to settings. While it is on, show custom
  tooltips for interactive settings, including dynamically generated matrix controls, draggable
  values, pan rings, and presets.
- Keep each tooltip under ten words and describe only the control's distinctive behavior. Do not add
  reset instructions to every tooltip or give section and row labels redundant help text.
- On desktop, reveal help on hover or keyboard focus. On touch—or when a pointer clicks a setting in
  help mode—show its explanation without activating or changing that setting. Escape or the circled
  **i** turns help off.
- Render the tooltip in a fixed page-level portal so compact group overflow cannot crop it. Retain
  accessible names regardless of help state and associate the visible tooltip with its setting via
  `aria-describedby`.

Style notes:
- Reuse the standard one-unit icon-button geometry and the selected binary-control treatment for the
  active help button. Do not widen the toolbar or create a separate Help group.
- In the three-column rehearsal Display group, put Fullscreen in utility row 2, Download in row 3,
  and Help in row 4. Move the two-unit **Unique lyrics** control to columns 1–2 so Help occupies the
  bottom-right cell without adding a row.

## Canonical Utility Icons

Use familiar, established SVG artwork for icon-only actions such as copying a link, resetting state,
entering full screen, undoing, or refreshing.

Source:
- `sequences-audio.html`
- CSS: `.week-link svg`, `.moment-link svg`
- SVG library: [Lucide](https://lucide.dev/icons/)
- Specialized musical silhouettes: [Phosphor Icons](https://phosphoricons.com/)

Behavior:
- Reuse an SVG already present elsewhere on the personal site when it expresses the same action.
- Otherwise use the exact SVG from a maintained icon library such as Lucide. Do not improvise
  familiar utility icons with CSS geometry or substitute a platform-dependent Unicode glyph.
- Inline the small SVG into standalone pages so the icon remains available offline without a CDN or
  runtime icon library.
- Keep the SVG decorative with `aria-hidden="true"` and `focusable="false"`; put the accessible
  name and tooltip on the containing button.

Style notes:
- For Lucide-style controls, use `viewBox="0 0 24 24"`, no fill, `currentColor` stroke, a
  2-unit stroke width, and rounded line caps and joins.
- Keep icons optically centered and consistently sized within neighboring toolbar buttons.

## Return To Active Playback

Use when synchronized audio, narration, notation, or another moving playback target normally
follows the viewport but the reader may deliberately scroll elsewhere.

Source:
- `sequences-audio.html`
- CSS: `.narration-return`
- JS: `updateNarrationReturn(...)` and `scrollToNarration(...)`

Behavior:
- Follow playback while the reader remains with the active content.
- Treat a deliberate scroll away as detachment and stop all automatic viewport reclamation.
- When the active target is outside the viewport, show one fixed circular return button near the
  bottom center rather than forcefully scrolling back.
- Point the arrow toward the active target and describe its direction in the accessible label and
  tooltip.
- Clicking the button smoothly centers the current target, hides the button, and resumes normal
  playback following.
- Hide the button when the target is visible again, playback has no active target, or the control
  is irrelevant. Remove hidden controls from the tab order and expose `aria-hidden="true"`.
- Distinguish programmatic following from user scrolling so the app's own scroll animation cannot
  immediately mark the reader as detached.
- In horizontally continuous content, apply the same pattern for left/right detachment as well as
  above/below detachment.
- In vertically paged notation, predict the next system transition while the current system is
  still visible. Measure the minimum scroll distance that will make the next system readable,
  derive a bounded animation duration from that distance, and begin when the remaining musical
  time is no greater than that duration plus a small scheduling buffer. Use a deterministic
  animation rather than browser-native smooth scrolling so arrival time is controllable.
- Do not pre-scroll when the next system already fits, playback will loop before reaching it, the
  reader is detached, or horizontal continuous view is active. Cancel a predictive scroll as soon
  as the reader starts a pointer, wheel, score-scrub, or seek interaction.

Style notes:
- Reuse the compact blurred circular button and Lucide arrow from `sequences-audio.html`.
- Keep it above primary content but below transient notifications, and respect the bottom safe-area
  inset.
- Rotate one canonical arrow for direction rather than inventing separate icon artwork.
- Honor reduced-motion preferences.

## Segmented Chapter Scrubber

Use when a playback timeline exposes phrase or chapter boundaries as seek destinations.

Behavior:
- Draw chapter boundaries inside the timeline track and keep them visible on both sides of the
  playhead. Paint the base and played-progress fill below a separate non-interactive divider layer;
  an opaque progress fill must not erase the already-played chapter boundaries.
- Derive divider positions and snap destinations from the same playback-time values so rubato or
  tempo changes cannot make the visible break disagree with the snapped position.
- Snap the range value during `input`, not only on `change`, and move the visible thumb and score
  cursor immediately so the destination is known before the pointer is released.
- Keep ordinary scrubbing continuous. Snap to a chapter only while the unsnapped musical position
  is within one measure before or after that chapter start; derive this window in score ticks and
  convert its bounds through the tempo map rather than using a fixed number of seconds or pixels.
- Align timestamps, chapter dividers, played progress, and loop bands to the center of the native
  range thumb. Inset the shared visual track by half the thumb diameter at both ends and size every
  timeline overlay inside that same track; do not map guides across the input's full outer width,
  which leaves the thumb circle extending to one side of the selected timestamp.
- Include the beginning and end as snap destinations. When the scrubber has keyboard focus, Arrow
  keys move to the preceding or following chapter and Home/End move to the timeline endpoints.

Style notes:
- Keep dividers high-contrast against both played and unplayed track fills without drawing tick
  labels outside the track.
- Keep the native range thumb above the divider layer and leave that layer pointer-transparent.
- In the notation itself, mark the corresponding chapter start by making its existing measure
  number bold. Do not add colored vertical chapter lines across the staves; they are too easily
  confused with the playback cursor, selection boundary, barline, or a personal note marker.
- Make chapter-start numbers unmistakably heavier than ordinary measure numbers; if the renderer's
  bold face is too subtle, add a restrained same-color SVG text stroke rather than increasing the
  label size or adding another guide shape.

## Part-Focused Practice Mix Presets

Use when a multitrack rehearsal player already exposes per-part volume controls but singers also
need quick, repeatable starting points.

Source:
- `/Users/diego/Desktop/Music/choir-practice-builder/template/app.js`
- UI: `.practice-mix`, `.part-picker`, `.mix-preset-buttons`

Behavior:
- Let the singer choose their part once and persist that choice as local practice state.
- For a short voice list, use the compact infinite vertical pager rather than a dropdown. Before a
  choice is made, show a non-value placeholder; do not insert “Choose part” or another prompt into
  the cyclic option list. Do not guess globally, but allow an individual score config to name an
  intentional default practice part.
- Provide a Learn preset that sets the chosen part to 100% and every other part to 20%.
- Provide a Check preset that sets the chosen part to 20% and every other part to 100%.
- Applying either preset turns every part's audio on, updates the ordinary per-part volume controls,
  and uses the same smooth gain transition as manual mixer edits.
- Treat audibility, volume, pan, tempo, metronome, loop, and practice-part changes as
  audio or practice-state updates only. They must not rerender notation. Invalidate score geometry
  only for visible-part, notation-mode, direction, scale, stretch, lyric-data, or actual surface-width
  changes; initialize width observers from the current width so their first callback is not a late
  redundant render.
- On the first preset activation, snapshot the existing Hear and Vol state. Switching between Learn
  and Check must keep that original snapshot; activating the already-selected preset again restores
  the snapshot and deselects the preset.
- Persist the preset session and its snapshot with the other device-local practice state so a reload
  does not strand the singer in a preset mix without a way back.
- Show the active preset only while the current mixer state exactly matches it. A later volume or
  audibility edit, or changing the chosen practice part, ends the preset session and returns the
  buttons to a neutral state; the next preset activation snapshots that newly edited mix.
- Prompt once when a preset is used without a selected or score-configured default part.

Style notes:
- Treat Learn and Check as compact one-click presets directly below the part selector, matching its
  width, so the whole part-focused control forms one efficient column. When space is tight, show each
  preset as a miniature level chart rather than text: one colored bar per part in score order, with
  the selected part tall and all others short for Learn, and the selected part short and all others
  tall for Check. Update the outlier when the pager changes, preserve full accessible labels and
  tooltips, and use the same part palette as the mixer.
- Give the active preset the same semantic fill used for a selected measure in the score, with a
  restrained matching border for legibility. Do not substitute the darker generic accent-soft fill,
  especially in dark mode, where it makes the selected preset recede.
- Keep them within the Practice category rather than adding another full mixer row.
- Once a part is selected, give the pager the same identifying border, tint, and text color used for
  that part in the Parts matrix; keep the unselected placeholder neutral.
- Omit a visible “Part” label when the surrounding Practice group and the pager's accessible name
  already establish what is being selected.

## Exact-Position Score Notes

Use when readers need personal rehearsal marks such as section boundaries, tricky entrances, or
reminders that relate two separated passages.

Source:
- `/Users/diego/Desktop/Music/choir-practice-builder/template/app.js`
- CSS: `.score-note-layer`, `.score-note-pin`, `.score-note-box`, `.score-note-editor`

Behavior:
- Label the visible pencil action **Annotate**, not “Note”; “note” is overloaded in a music-reading
  interface. Use annotation terminology in its tooltips, editor labels, and status messages too.
- Use the same location-first order as other score actions: click the score to establish the current
  musical position, then press Annotate to open the editor there. Do not make annotations the one
  tool that requires selecting a mode before selecting the location.
- Treat a score click as both a time selection and a part selection. Among the rendered parts in the
  selected measure, choose the staff region closest to the click's vertical position; do not require
  a separate part picker for annotations.
- Store annotation text locally under a score-specific key. Do not put personal annotations in share URLs or
  erase them when ordinary practice settings are reset.
- Show saved personal annotations whenever they exist. Do not add a toolbar visibility toggle by default;
  Annotate remains the place to create, edit, or delete them.
- Store the score tick and part index rather than only the measure index. Anchor a clicked beat or
  subdivision to that part's exact renderer coordinate, with proportional position inside the
  measure only as a fallback for legacy or non-beat locations. Migrate older partless notes instead
  of discarding them.
- Label positions as `measure.beat.fraction`, with one-based measure and beat numbers followed by a
  trimmed decimal fraction of that beat. Retain `.0` at a beat onset; for example, `4.2.75` is
  measure 4, beat 2, three quarters through the beat (the fourth sixteenth-note position).
- Edit in place: the pencil action creates a WYSIWYG textbox above the selected staff at the exact
  tick where the finished note will remain. Do not open a modal, popover, expandable menu, or remote
  form. Saving on blur keeps the interaction lightweight; Command/Ctrl+Enter commits immediately,
  Escape cancels, and saving an empty box deletes the note. Leave the field visually blank rather
  than filling it with an “Annotation for [part]” placeholder; the insertion cursor already makes
  its purpose clear.
- Never soft-wrap annotation text. Let each line grow rightward to its full measured width, and
  create additional lines only from explicit Return characters. Grow multiline boxes upward so the
  block's bottom edge remains fixed immediately above the annotated staff; typing must not make text
  bleed down across that staff or oscillate between wrapped and unwrapped heights.
- Show each saved note as the same compact box with its decimal address and a short part-colored pin
  to the staff. Clicking an existing box edits it in place.
- Treat the decimal `measure.beat.fraction` address as the annotation's drag handle. Horizontal
  dragging moves the stored musical tick continuously within or across measures, while vertical
  dragging assigns the closest visible part; recompute the box from renderer bounds throughout and
  persist the resulting tick and part rather than any screen coordinates.
- Give every saved note a compact, canonical X button that deletes it directly; offer the existing
  one-step toast Undo so deletion stays quick without becoming fragile. Keep the same X visible
  while its inline textbox is being edited; pressing it must delete the saved annotation (or cancel
  a not-yet-saved empty annotation) without first committing the field on blur. Order the compact
  box as X, decimal position, then text so the delete target never moves as text is entered.
- After a score click, retain the ordinary full-measure selection but add a slightly stronger,
  part-colored highlight over the selected staff region. Move that staff highlight with the current
  measure during playback so creating a note never surprises the singer about which voice owns it.
- Recompute that selected-staff highlight from renderer bounds after every score reflow. A cache key
  based only on measure and part is insufficient because Scale, Stretch, wrapping, and visibility
  can change its pixel geometry without changing either musical identifier.
- Rebuild annotation positions after every score reflow from musical ticks and renderer bounds rather
  than storing pixels, so notes survive wrapping, scaling, part visibility, and continuous view.
- Migrate older measure-indexed notes to their measure downbeats.

Style notes:
- Keep annotation overlays above notation but below sticky app chrome and transient messages.
- Use text content and native controls so note text is escaped automatically and remains keyboard
  accessible.
- Use the simple Lucide Pencil icon for the toolbar action; a paper-and-pencil composite is too
  detailed at this compact size.

## Location-First Measure Loop

Use when a score toolbar creates a measure-snapped practice loop.

Source:
- `/Users/diego/Desktop/Music/choir-practice-builder/template/app.js`
- UI: `.loop-controls`, `.loop-route`, `.loop-point`

Behavior:
- Click the score first to establish the current measure, then press Start, End, or Notes. Keep this
  location-first order consistent across actions rather than mixing location-first and tool-first
  interactions.
- Start and End set or move their endpoint to the selected measure; clearing is a separate centered
  action, so clicking an already-set endpoint does not silently delete it.
- Once an endpoint exists, replace the visible Start or End text with only its one-based measure
  number. Preserve Start/End semantics in the accessible description and tooltip.
- Enable looping only while both endpoints are valid and ordered from start through end.

Style notes:
- Arrange Start and End as the two endpoints of a compact route. Draw a solid arrow from Start to End
  above the route and a dotted return arrow below it, with the clear “x” centered between the endpoint
  buttons.
- Give Start and End identical fixed widths sized to hold at least a three-digit measure number, so
  setting an endpoint never shifts the route. Do not use differing content-driven minimum widths.
- Curve the two route arrows above and below the centered clear button; neither path nor arrowhead
  should intersect the button.
- Keep the two directions separated at their endpoints: the solid forward arrow connects the upper
  inside corners of Start and End, while the dotted return arrow connects their lower inside corners.
  Use smooth cubic curves with continuous-looking tangents rather than a curved-straight-curved path
  with visible shoulders.
- Keep incomplete routes restrained; emphasize the arrows and endpoint buttons once both ends exist.

## Async Dropdown Switch

Use when choosing an item from a native dropdown triggers backend work, such as changing the active
project, workspace, model, or data source.

Behavior:
- Keep the dropdown's option nodes stable while polling. Rebuilding an open native dropdown closes
  or flashes its menu and can prevent a selection from committing.
- After one committed selection, disable the dropdown, set `aria-busy="true"`, and immediately show
  a specific live-region message such as `Switching to Cm7…`.
- Re-enable the dropdown only when the selected target is ready or the switch has failed with a
  useful error message.
- Cancel obsolete client polls when a new selection is committed.
- Keep read-only status polling separate from the explicit backend command that changes the active
  target, so stale responses cannot undo a newer selection.
- Persist the committed selection when users expect it to survive reloads.

## Transition-Only Score Lyrics

Use when a rehearsal score repeats a neutral syllable such as “doo” on many
successive notes and the repetition makes the notation harder to scan.

Behavior:
- Label consecutive duplicate lyric elements during MusicXML normalization,
  tracking each score part and lyric verse independently.
- Keep the first syllable in a run. Hide only later verbatim copies until a
  different lyric occurs; if the original syllable returns after other words,
  show it again as a meaningful transition.
- Notes or rests without lyrics do not interrupt a lyric run.
- Preserve the original lyric data and playback. Use a whole-button **Unique lyrics** toggle
  rather than permanently editing the score: pressed hides later verbatim copies in each run, and
  unpressed restores the complete lyric text.
- Put the button in the Display group with other score-reading controls and persist the selected
  state locally.

Style notes:
- Keep the visible button label **Unique lyrics** stable; it accurately describes showing the first
  syllable in each repeated run. Let it fill and center within its full two-unit rectangle so it
  remains aligned with the rehearsal toolbar's standardized unit grid. In a three-column Display
  grid with opt-in Help in the bottom-right utility cell, place that two-unit rectangle in columns
  1–2. Selected styling means
  condensation is active, while its accessible action switches between showing only unique lyrics
  and showing all lyrics.
- Do not special-case a particular syllable such as “doo”; derive duplicate
  labels programmatically so the same behavior works for future scores.

## Pitchbar Practice View And Intonation Trace

Use as an alternate score view when singers benefit from seeing exact pitch height, voice-leading,
and recorded intonation more directly than standard notation provides.

Behavior:
- Keep standard notation as the default and offer **Pitchbar View** as a whole-button binary toggle;
  its unpressed state is ordinary notation. Do not call this “Diatonic notation”: the view removes
  enharmonic spelling but still maps pitches chromatically by semitone. Both views use the same
  score ticks, playback position, loop, visible parts, Scale, Stretch, and Vertical/Horizontal
  scrolling state.
- Draw all visible parts together as color-coded horizontal bars. Crop each system to the pitches
  actually used on that line, but always label a harmonically meaningful reference pitch with its
  octave number so compact ranges remain unambiguous. Label the tonic nearest the vertical center
  whenever the displayed span contains a tonic; only otherwise use the fifth, then the third. If a
  narrow span contains none of those pitch classes, expand it by the minimum amount needed to show
  the nearest tonic, fifth, or third, using that order to break equal-distance ties. Never fall back
  to labeling an arbitrary sung pitch.
- Draw key-relative tonic, dominant, and third guides with decreasing emphasis. Keep the tonic
  strongest, the dominant lighter, and the third dashed; infer these from the score's key rather
  than hard-coding one song's pitch classes.
- Mark immediate re-articulation of the same pitch with a narrow background-colored cut through the
  bar. Render this cut above the microphone trace so a sung contour can never erase the rhythmic
  boundary. Different successive pitches need no extra cut.
- Let the Parts visibility matrix continue to control every colored part shown in Pitchbar View,
  but take the lyric source exclusively from the part selected in the Practice pager. Show that
  part's lyrics even when several parts are visible; the singer is expected to follow the selected
  line among them. Center the visual midpoint of the lyric's first real letter beneath its pitchbar
  onset, then let the rest of the word extend normally to the right; account for any leading
  punctuation when measuring the offset. Support the same transition-only lyric setting as the
  notation view.
- Match pitch-view typography to standard notation at the same Scale: use 11px measure numbers and
  14px lyrics at 100%, scale both proportionally with the score, and enlarge lyric lanes with the
  text so successive verses cannot collide. Override AlphaTab's standard-notation lyric resource to
  the same 14px baseline before rendering rather than relying on a CSS post-process.
- Keep measure numbers visible and make chapter-start numbers substantially bolder; do not add
  colored chapter lines that can be confused with the playhead or a note boundary.
- Clicking the pitch score seeks to the exact horizontal score position. Infer the selected part
  from the nearest active colored bar so part-specific notes remain attached to the intended voice.
- Disable Annotate in Pitchbar View because its WYSIWYG staff attachment exists only in standard
  notation; give the disabled control an explicit tooltip instead of silently accepting a no-op.

For microphone feedback:
- Inline a lightweight pitch detector in downloadable standalone files. Never require a CDN, a
  SoundFont, or a server round-trip for pitch analysis.
- Ask for microphone access only after an explicit click. Keep an acquired stream reusable while
  the page remains open, and resume an armed microphone after tab visibility changes instead of
  forcing the user to re-enable it.
- Use confidence and temporal consistency rather than an adaptive amplitude noise floor. Choir
  practice can contain long uninterrupted singing, so a rolling window must not reinterpret the
  singer as ambient noise.
- Sample at roughly 15 Hz, with a 10 Hz fallback on overloaded devices. Store accepted contour
  points locally; overwriting a passage replaces only time windows containing a newly accepted
  pitch, never holes where no pitch was detected.
- Quantize accepted contour data to a fixed one-slot-per-1/64-note grid. Store absolute pitch cents
  in a preallocated `Uint16` grid and stroke discontinuities in a compact break bitset; confidence
  is acceptance-time evidence and should not be persisted after a sample passes the detector.
- During live capture, patch only the SVG edges neighboring bins that were added, replaced, or
  cleared. Reserve full contour reconstruction for initial load, score reflow, view changes, and
  whole-trace clearing; never rebuild every historical SVG segment for each accepted sample.
- Grade intonation against the nearest visible target pitch. During a notated rest, retain the most
  recently completed visible note as the reference so alternating sung notes and written rests do
  not turn an otherwise steady contour red. Keep ordinary vocal fluctuation bright green through
  10 cents, then interpolate directly in RGB to bright red at 50 cents or more. At 50 cents the
  detected pitch is already equally close to the intended note and its neighboring semitone, so a
  100-cent red endpoint is too forgiving. Never blend in a part-palette or neutral color; before the
  first visible target note, retain the contour and grade it red because no previous pitch reference
  exists.
- Group samples into separate strokes across pauses, seeks, loops, implausible jumps, or large time
  gaps. Add an explicit whole-score erase action so a singer can start a clearly new take.
- Do not auto-enable the microphone on reload. Keep the confidence threshold as an internal,
  score-independent detector constant and persist the recorded trace, but leave
  permission-producing actions under direct user control.
- Once the microphone is armed, trace automatically while playback is running and pause capture
  when playback stops. Keep the existing trace visible while paused; do not expose separate Trace
  or confidence controls.

Style notes:
- Group **Pitchbar View**, microphone capture, and whole-score trace erase in the third aligned logical
  column of **Practice**. Label the destructive row **Erase**, not “Trace”: the visible label should
  name the button's action, while its tooltip can specify “Erase pitch contour.” They describe how
  the singer practices and records a take; keep **Display** for direction, Scale, Stretch, lyric
  presentation, and its compact Fullscreen / Download utility rail.
- Keep the live contour behind re-articulation cuts and the playhead above both. Use a subtle
  background-colored halo around the contour so green/red grading remains legible in light and dark
  palettes without obscuring the colored part bars.

## Automatic Light And Dark Themes

Use for standalone personal-site tools and reading surfaces that may stay open for long sessions.

Behavior:
- Follow `prefers-color-scheme` automatically unless the product explicitly needs a manual theme
  override; do not add a permanent toolbar toggle by default.
- Declare `color-scheme: light dark`, provide matching light/dark browser theme colors, and keep
  native controls consistent with the active palette.
- Theme semantic color variables rather than scattering one-off dark-mode overrides across controls.
- Verify panels, focus rings, dialogs, overlays, cursor/highlight layers, and disabled states in both
  palettes—not just the page background and body text.
- For music notation or other renderer-owned black artwork, provide a deliberate dark rendering
  treatment while preserving meaningful accent colors. Restore unfiltered black-on-white output in
  print media so a dark system setting cannot invert printed content.

Style notes:
- Dark mode should make the primary content surface genuinely dark; avoid a glaring white document
  floating inside otherwise dark chrome unless the document itself must preserve paper color.
- Keep the light theme as an independently specified palette, not a reverse filter of dark mode.
- When a small category label interrupts a bordered group edge, its backing color must match the
  fill immediately outside and inside that edge. In dark toolbars, use one shared seam fill for the
  settings strip, group surface, and label backing so the rectangular cutout never shows.

## Standalone Save Action

Use when a standalone browser tool offers a self-download action.

Behavior:
- On secure Chromium contexts, prefer `showSaveFilePicker()` so the user chooses the filename and
  location. Request the file handle immediately from the click gesture, before fetching or assembling
  the file, so transient user activation is preserved.
- Treat picker cancellation as cancellation: do not follow it with an automatic download.
- Fall back to an ordinary Blob-backed `download` link when the picker API is unsupported or cannot
  open. Keep this fallback so the same standalone file remains useful in Safari and Firefox.
- Suggest a short, filesystem-safe `.html` filename and restrict the primary picker type to HTML.
- Bake the current validated settings and personal annotations into a versioned JSON script inside
  the downloaded HTML. Do not include microphone pitch traces by default; they are larger and more
  personally revealing than ordinary rehearsal settings.
- Treat embedded portable state as a first-open seed only. Existing local storage for the opened
  copy wins; when no local value exists, import the matching score-fingerprint snapshot and persist
  it locally so subsequent edits belong to that copy.
- Persist an explicit empty annotation record after the last annotation is deleted. Removing the
  storage key would make the next reload mistake deletion for a first open and resurrect the baked
  annotations.
- When a portable copy downloads itself again, replace its original snapshot with the current state.
  Escape `<` and Unicode line separators in embedded JSON so annotation text cannot terminate the
  script element or corrupt the standalone document.

## Playback-Focused Keyboard Control

Use for score trainers, audio practice tools, and other interfaces where transport control is the
primary ongoing action.

Behavior:
- Treat Space as global play/pause everywhere except an actual text input, textarea, or editable
  text region. Handle it during keyboard capture, prevent the browser's page-scroll default, and
  stop a focused button from consuming the same keystroke.
- Prevent held-key repeat from rapidly toggling playback, while still suppressing repeated Space
  events so they never scroll the page.
- After a pointer or touch interaction with a toolbar control, release that control's focus once its
  interaction completes. This prevents the next Space press from reactivating the last button.
- Do not blur controls activated from the keyboard; retain normal focus visibility and keyboard
  navigation for users who are deliberately tabbing through the interface.
- Preserve normal spaces while typing WYSIWYG notes or other text.

## Future Request Phrases

Useful shorthand:
- "Use the smooth sliding pill toggle from `UI.md`."
- "Use the joined color picker pill from `UI.md`."
- "Use the draggable number control from `UI.md`."
- "Use the infinite vertical pager from `UI.md`."
- "Use the direct manipulation mode toggle from `UI.md`."
- "Make this a compact tool panel using `UI.md` conventions."
- "Use the async dropdown switch from `UI.md`."
