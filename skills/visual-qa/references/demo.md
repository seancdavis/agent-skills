# The demo video

`capture --demo` doesn't film the browser. It takes screenshots at the moments that matter, then draws the video from them. A recording of a headless browser has no cursor and no sign of what was clicked. It also plays every page load and wait as dead time, and its text comes out soft. A drawn video has none of those problems, and it can be restyled without opening the site again.

## How the keyframes are taken

The recorder runs inside the after side's guarded context, after sign-in, alongside the scenario's steps (`scripts/demo.mjs`, `DemoRecorder`). Every keyframe is a Playwright screenshot of the viewport. Playwright screenshots never include a mouse pointer, so the drawn cursor is the only one in the video.

- **`start`**: the start page, with the mouse parked off the page at (-1, -1) so nothing is hovered.
- **`hover`**: before a `click` or `fill`, the target is scrolled into view and its box is read. The mouse moves to the box's center, and after 150 ms the hover state is captured. The box's center is where the drawn cursor goes.
- **`result`**: after a `click` or `fill`, once the page settles. That means the load event, any `wait` or `waitFor` steps that follow, and then 800 ms more. The mouse is still on the target, so the clicked row still looks hovered, as it would for a person.
- **`idle`**: just before the cursor moves on, the mouse is parked again and the page is captured with nothing hovered. In the video, the hover ends the moment the cursor leaves.
- **`changed`**: after a `press`, `goto`, `wait`, or `waitFor` that wasn't part of a click, the settled page fades in.
- **`scroll`**: a `scroll` step finds the list (or page) that holds its target. It works out where the target sits in the middle, then scrolls there in 8 to 30 steps of about 40 px, with one screenshot each. The drawn cursor rests on the middle of that list while it scrolls.

The keyframes and `timeline.json` (the events, in order) are written to `<scenario dir>/demo/`. A failed step on the after side means there is no demo, because the video would show a broken flow.

## How the video is drawn

`renderDemo` turns the timeline into timed tracks (`planDemo`): screens with crossfades, cursor moves, clicks, captions, and scrolls. It then draws each frame on a canvas in a new Playwright page, where every request is aborted. Keyframes arrive as data URLs read from the run folder, and captions and the window title are drawn as canvas text, never as HTML. Frames go to ffmpeg as JPEGs and come out as H.264 `demo.mp4`.

What it draws:

- A dark gradient background and a window with a title bar that shows the preview's host.
- The screenshots inside the window, crossfading after each click (0.35 s by default).
- A black macOS-style arrow with a white edge, gliding between targets on a slight arc with eased speed, and pressing slightly on each click.
- A ripple at each click point.
- Scrolling, eased, with neighboring scroll frames blended so the motion is smooth.
- Captions centered under the window, crossfading as each one replaces the last, and shrunk to fit when long.

## Writing a scenario that makes a good demo

- One scenario per change, kept short: about 15 to 30 seconds once drawn.
- Give each step that shows something a caption saying what the viewer is looking at, in plain words: "A pull request an agent run opened opens the run". The scenario's own `caption` shows from the start.
- Use a `scroll` step to reach anything below the fold. A click on an off-screen target still works, but the page jumps instead of scrolling.
- After a click that loads something slow, add a `waitFor` on what appears. Otherwise the `result` keyframe may show a spinner.
- End on a `screenshot` step to hold the final state.

```json
{
  "name": "open-agent-run",
  "start": "/projects/docs/overview",
  "viewport": { "width": 1200, "height": 800 },
  "steps": [
    {
      "do": "click",
      "target": "role=button[name=\"[WIP] Content updates\"]",
      "caption": "A pull request someone opened opens its preview"
    },
    { "do": "waitFor", "target": "text=deploy-preview-1054" },
    {
      "do": "click",
      "target": "role=link[name=\"Improved review experience\"]",
      "caption": "A pull request an agent run opened opens the run"
    },
    { "do": "waitFor", "target": "text=Agent pull request" },
    { "do": "click", "target": "role=link[name=\"Versions\"]" },
    {
      "do": "scroll",
      "target": "text=Published",
      "caption": "Merged pull requests work the same way"
    },
    { "do": "click", "target": "role=link[name=\"Update Netlify forms\"]" },
    { "do": "screenshot", "name": "merged-run" }
  ]
}
```

## Changing the look

Put a JSON file of overrides in `~/.claude/visual-qa/demo-style.json` (used by every `capture --demo` and `render-demo`), or pass `--style <file>`. Then re-draw an existing run without opening the site again:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/visual-qa/scripts/visual-qa.mjs" render-demo --run <run dir>/<scenario name> --style my-style.json
```

Only these keys are accepted, with the same types. An unknown key or a wrong type is refused (exit 2). Numbers are seconds or pixels.

| Key                                    | Default                  | What it is                                      |
| -------------------------------------- | ------------------------ | ----------------------------------------------- |
| `fps`                                  | `30`                     | Frames per second, 10-60                        |
| `quality`                              | `0.95`                   | JPEG quality of each frame before encoding      |
| `padding`                              | `80`                     | Space around the window                         |
| `captionSpace`                         | `110`                    | Space under the window, when there are captions |
| `background`                           | `["#0a262e", "#020a0e"]` | Top and bottom of the background gradient       |
| `window.bar`                           | `34`                     | Title bar height; `0` hides the bar             |
| `window.barColor`, `window.titleColor` | `#162227`, `#8c9ea4`     | Title bar and title text colors                 |
| `window.radius`, `window.shadow`       | `12`, `28`               | Corner radius and shadow blur; `0` for none     |
| `caption.size`, `caption.color`        | `30`, `#ecf4f5`          | Caption size and color                          |
| `caption.font`                         | system UI font           | Any CSS font family list                        |
| `cursor.scale`                         | `1.45`                   | Cursor size                                     |
| `ripple`                               | `#32e6e2`                | Click ripple color                              |
| `timing.start`                         | `1.2`                    | Hold on the start page                          |
| `timing.moveBase`, `timing.movePerPx`  | `0.45`, `0.00067`        | Cursor travel time: base plus per pixel         |
| `timing.hover`                         | `0.35`                   | Pause on a target before clicking               |
| `timing.click`                         | `0.12`                   | Press before the page responds                  |
| `timing.fade`                          | `0.35`                   | Crossfade into a click's result                 |
| `timing.afterClick`                    | `1.9`                    | Hold on a click's result                        |
| `timing.changed`                       | `0.6`                    | Hold after a key press, navigation, or wait     |
| `timing.scroll`                        | `1.3`                    | Length of each scroll                           |
| `timing.screenshot`, `timing.end`      | `1.5`, `2`               | Hold at a `screenshot` step, and at the end     |

For example, a lighter frame with slower pacing:

```json
{
  "background": ["#f4f6f7", "#dde3e6"],
  "window": { "barColor": "#e9edef", "titleColor": "#5b6b71" },
  "caption": { "color": "#12262c" },
  "timing": { "afterClick": 2.6 }
}
```
