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

Use for small bounded integer settings where typing is unnecessary and pointer dragging is enough, such as columns, digits, level, or count.

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
- Dragging up/right increases the value.
- Dragging down/left decreases the value.
- Use `cursor: nesw-resize` to communicate that diagonal direction.
- Clamp to the allowed range and snap to the configured step.
- Store the value in `data-value`, display the same value as button text, and emit an `input` event when it changes.

Style notes:
- Compact row with label on the left and the numeric value button on the right.
- Numeric button should feel clickable/draggable, not like a text field.
- Prefer this over typing for narrow ranges.

## Compact Tool Panel

Use for utility controls beside a visual or interactive main surface.

Source:
- `soroban.html`

Style notes:
- A restrained translucent panel is better than a decorative card stack.
- Keep workflow controls grouped by purpose: primary actions, mode controls, problem controls, settings.
- Do not show every metric in every mode. Hide timer/streak/problem controls in a free-use workspace mode if they are not relevant.
- Use compact controls and stable dimensions so the main interactive surface remains the visual focus.

## Future Request Phrases

Useful shorthand:
- "Use the smooth sliding pill toggle from `UI.md`."
- "Use the joined color picker pill from `UI.md`."
- "Use the draggable number control from `UI.md`."
- "Make this a compact tool panel using `UI.md` conventions."
