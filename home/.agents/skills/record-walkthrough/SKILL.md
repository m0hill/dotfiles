---
name: record-walkthrough
description: Record browser demos, feature walkthroughs, and bug reproductions as shareable videos using the installed Agent Browser CLI. Use when the user asks for a video showing an actual web workflow or evidence for a PR.
---

# Record Walkthrough

Use the installed `agent-browser` CLI to capture real browser interactions directly to video. Keep the default workflow small: rehearse, record, inspect, deliver. Add editing only when it improves the requested demonstration.

## Prepare and rehearse

1. Load the installed instructions with `agent-browser skills get core`; check `agent-browser record --help` for version-specific recording options. Use `agent-browser` directly, rather than fetching another copy with `npx`.
2. Use a unique named session for this task and pass `--session <name>` on every browser command. Reuse an existing session only when the user identifies it. Agent Browser controls its own browser or a supported attached browser; it does not automatically capture Codex's in-app browser.
3. Infer the URL, required scenes, and final visible result from the request. Ask only for missing information that prevents progress. Put recordings outside the application repository, such as `~/Movies/<demo-name>/`, unless the user chooses another location.
4. Check the recorder with `agent-browser doctor --offline --quick`. Resolve missing Chrome or FFmpeg before recording; avoid unrelated cleanup or blanket `doctor --fix` repairs.
5. Rehearse the complete requested flow, including its final success or expected failure. Use snapshots and actual visible controls to verify the result. If rehearsal exposes an application bug, report it and keep code changes within the user's authorization.
6. Prepare demo data and authentication. Record any original settings that must be restored after the demonstration, and reset rehearsal side effects before the take. Keep credentials and authentication-state files out of videos and deliverables.

## Record

Choose a fixed viewport before rehearsal; use 1280×800 and 30 fps as practical defaults. Use 60 fps when animation or dragging is the subject. Prefer one page for the walkthrough, including navigation between the admin and application. For separate tabs or sessions, record separate clips and join them if one video is requested; verify each clip rather than assuming recording follows tab switches.

Example setup, using the same session name and output directory throughout:

```bash
agent-browser --session walkthrough-example open <url>
agent-browser --session walkthrough-example set viewport 1280 800
agent-browser --session walkthrough-example snapshot -i
# Rehearse, then return to the intended opening state.
agent-browser --session walkthrough-example record start <absolute-output-dir>/raw.mp4 --fps 30 --cursor --contact-sheet
# Perform the verified UI actions, taking fresh snapshots as the page changes.
agent-browser --session walkthrough-example record stop
```

Starting without a URL records the current page in place. Set up the opening state first so recording does not restart navigation or authentication.

- Show cause and effect through visible clicks, typing, and the application's response. Use UI actions for the demonstrated behavior; reserve APIs or scripts for authorized setup and verification.
- Wait for the expected element, text, or URL to confirm completion. Short presentation pauses around important results help a viewer follow the flow; they do not replace those checks.
- Batch known actions once rehearsed so reasoning time does not become dead air. Keep meaningful errors and timing evidence when they are the subject of the demo.
- For long cooldowns or background work, capture the actual behavior, then trim idle time and label elapsed time. Disclose a shortened demo setting. Do not imply that a manually reset timer or edited result happened naturally.
- On an interrupted or failed take, stop recording to flush the file before troubleshooting. Use a new filename for the next take.

## Finish and verify

1. Stop recording before closing the browser. Restore temporary demo settings and verify the restoration. Close only the session created for this task.
2. Keep the raw take. Use it directly when it already tells the story clearly; otherwise produce a separate final MP4 with only the cuts, captions, or joins needed. Keep dimensions and aspect ratio consistent across clips.
3. Inspect the recording's contact sheet and representative frames, including the opening, required scenes, and final result. Listen if audio is present. Verify the entire file decodes:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate -show_entries format=duration,size -of json <video.mp4>
ffmpeg -v error -i <video.mp4> -f null -
```

4. Deliver the final video with an absolute local path, its duration, and a short account of what it shows. State any skipped steps, edited waits, or unresolved failures. A recording request alone does not authorize uploading it or posting to a PR.

For additional recording details, read `references/video-recording.md` under the directory returned by `agent-browser skills path core`, or consult the [official recording documentation](https://agent-browser.dev/recording).
