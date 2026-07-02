# CAO Desktop Design

## Direction

CAO Desktop uses a Codex-inspired dark glass interface: quiet, dense, terminal-first, and macOS-native in feeling. The app should feel like a focused desktop workbench, not a marketing page or a generic web dashboard.

Reference the attached Codex screenshot only for material language, color mood, spacing density, and frosted-glass treatment. Do not copy its product features, navigation model, or chat layout.

## Visual Principles

- Dark surfaces are the default. The app should never open onto a light page or a flat white panel.
- Glass is used for structural containers: sidebar, top bar, modals, notices, and drag overlays.
- Contrast should be soft but legible. Primary text is near white; secondary text fades through opacity rather than switching to bright grays.
- Orange is the single warm accent for loading, focus, warning, and important affordances.
- Layout should stay operational and compact. Avoid oversized decorative sections, floating card stacks, or marketing-style hero composition.
- The terminal is the primary workspace. UI chrome should frame it without competing with it.

## Color Tokens

### Background

- `bg.base`: `#0f0f10`
- `bg.main`: `#111112`
- `bg.deep`: `#080808`
- `bg.sidebar-solid`: `#262628`
- `bg.sidebar-glass`: `rgba(35, 35, 38, 0.74)`
- `bg.topbar-glass`: `rgba(16, 16, 17, 0.58)`
- `bg.terminal-glass`: `rgba(20, 20, 21, 0.74)`
- `bg.modal-glass`: `rgba(42, 42, 44, 0.82)`
- `bg.notice-glass`: `rgba(44, 44, 46, 0.72)`
- `bg.overlay`: `rgba(7, 7, 8, 0.54)`
- `bg.drop-overlay`: `rgba(9, 9, 10, 0.72)`

### Text

- `text.primary`: `#f4f4f5`
- `text.strong`: `rgba(255, 255, 255, 0.94)`
- `text.default`: `rgba(247, 247, 248, 0.92)`
- `text.secondary`: `rgba(255, 255, 255, 0.58)`
- `text.muted`: `rgba(255, 255, 255, 0.38)`
- `text.disabled`: `rgba(255, 255, 255, 0.32)`
- `text.inverse`: `#18181a`

### Borders And Separators

- `border.sidebar`: `rgba(255, 255, 255, 0.13)`
- `border.subtle`: `rgba(255, 255, 255, 0.12)`
- `border.hairline`: `rgba(255, 255, 255, 0.07)`
- `border.hover`: `rgba(255, 255, 255, 0.11)`
- `border.selected`: `rgba(255, 255, 255, 0.08)`
- `border.drop`: `rgba(255, 255, 255, 0.20)`

### Accent And State

- `accent.orange`: `#ff7a30`
- `accent.orange-hover`: `#ff9a5c`
- `accent.orange-soft`: `rgba(255, 122, 48, 0.12)`
- `accent.orange-border`: `rgba(255, 122, 48, 0.24)`
- `accent.orange-focus`: `rgba(255, 122, 48, 0.72)`
- `accent.orange-focus-ring`: `rgba(255, 122, 48, 0.16)`
- `state.success`: `#3ddc84`
- `state.warning`: `#ff7a30`
- `state.danger`: `#ff5d55`
- `state.muted`: `rgba(255, 255, 255, 0.36)`

## Materials

### App Background

Use layered darkness rather than a single solid fill:

- A near-black base.
- A subtle diagonal dark gradient.
- One restrained warm radial glow around the upper-left or mid-left area.

The glow should remain ambient and low contrast. Do not add decorative gradient orbs, bokeh blobs, or colorful backgrounds.

### Glass Surfaces

Glass panels should combine transparency, blur, soft borders, and subtle inset highlights.

- Sidebar: `backdrop-filter: blur(34px) saturate(1.25)`.
- Top bar: `backdrop-filter: blur(24px)`.
- Modal card: `backdrop-filter: blur(28px) saturate(1.2)`.
- Notices: `backdrop-filter: blur(18px)`.
- Overlays: `backdrop-filter: blur(22px)` to `blur(24px)`.

Glass should look like a dark translucent surface, not a bright acrylic pane.

## Typography

- Primary font: `"Open Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Mono font: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.
- Letter spacing: `0`.
- Root size: `16px`.

Use these common sizes:

- Section labels: `11px`, uppercase, `700`, muted.
- Paths and subtitles: `12px`, muted.
- Navigation rows: `14px`.
- Topbar title: `15px`, `650`.
- Modal title: `18px`, `650`.
- Brand lockup: `20px`, `650`.
- Empty-state question: `clamp(34px, 4vw, 54px)`, line-height `1.05`, weight `520`.

## Layout

### Window

- Minimum size: `980px` by `640px`.
- Main shell fills the whole viewport.
- App root is draggable for macOS titlebar behavior.
- Interactive controls, lists, modals, and terminal surfaces must opt out of dragging.

### Sidebar

- Fixed width: `320px`.
- Top padding: `58px` to leave room for macOS traffic lights and titlebar.
- Section padding: `16px 20px`.
- Toolbar padding: `0 18px 0 28px`.
- Section separators use low-opacity white borders.

### Main Area

- Topbar height: `58px`.
- Content padding: `34px`.
- Terminal view should consume the full right content space with no decorative frame.
- Empty states should consume the available space and may keep centered padding.
- Avoid nested cards. The terminal shell, modal, notice, and repeated rows are the only framed surfaces.

## Shape And Spacing

- Navigation row radius: `10px`.
- Icon button radius: `9px`.
- Field radius: `13px`.
- Notice radius: `22px`.
- Modal radius: `26px`.
- Drop card radius: `28px`.
- Pill radius: `999px`.

Common spacing values:

- Tight gap: `4px`.
- Row gap: `10px`.
- Control horizontal padding: `20px`.
- Sidebar horizontal padding: `20px` to `28px`.
- Content padding: `34px`.
- Empty-state padding: `64px`.

## Components

### Navigation Rows

Rows are transparent by default, then lift through low-opacity white fills.

- Default: transparent background, `text.default` around 74% opacity.
- Hover: `rgba(255, 255, 255, 0.07)`.
- Selected: `rgba(255, 255, 255, 0.105)` with a subtle inset border.
- Radius: `10px`.
- Min height: `40px`; agent rows use `46px`.

Status icons should use the state colors above and remain small, inline, and scannable.

### Buttons

Buttons are compact pills.

- Primary button: near-white fill, dark text, subtle white border.
- Secondary button: translucent dark fill, low-opacity white border, white text.
- Hover can translate up by `-1px`.
- Icon buttons are square `30px` controls with `9px` radius.

Avoid rectangular text buttons where a known icon communicates the action clearly.

### Fields

Fields use dark translucent fills.

- Height: `42px`.
- Radius: `13px`.
- Background: `rgba(18, 18, 19, 0.62)`.
- Border: `rgba(255, 255, 255, 0.13)`.
- Focus border: orange.
- Focus ring: soft orange glow.

### Terminal Shell

The terminal is the dominant content surface and should render directly inside the right content area.

- Radius: `0`.
- Background: `#111112`.
- Border: none.
- Shadow: none.
- Backdrop blur: none.
- Xterm padding: `16px`.

### Modals

Modals are centered glass panels over a blurred dark backdrop.

- Width: `480px`.
- Padding: `18px`.
- Radius: `26px`.
- Backdrop: `rgba(7, 7, 8, 0.54)` with blur.

### Drag Overlay

Directory drag-over should cover the entire app with a dark blurred layer.

- Overlay: `rgba(9, 9, 10, 0.72)`.
- Card: radius `28px`, glass fill, strong shadow, `28px` text.

### Loading And Runtime State

Loading should be visible near the active workspace context, not as a full-page blocking state.

- Use an orange loading pill with `accent.orange-soft` background.
- Workspace rows can show state icons.
- Retry actions should restart the existing workspace server attempt, not ask the user to choose the directory again.

## Interaction Rules

- Opening a directory should immediately add the workspace to the sidebar.
- Long-running startup work should appear as inline loading beside the workspace or topbar context.
- The window must remain draggable after workspace changes.
- Buttons and list items must remain clickable in draggable regions by setting `-webkit-app-region: no-drag`.
- Runtime failures should be recoverable from the current workspace context.

## Avoid

- Do not use a light theme.
- Do not add large purple, blue, beige, brown, or orange-dominated gradients.
- Do not use bright frosted glass that reads as white.
- Do not create landing-page hero layouts.
- Do not put cards inside cards.
- Do not expose internal port-range controls in primary settings.
- Do not copy Codex chat features from the visual reference.
