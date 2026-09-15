# Video files

Place the final video files in this directory (subdirectories are fine), then set each `src` in the project-level `content.json`.

Example:

```json
"src": "/static/media/maya/story-1.mp4"
```

An empty `src` uses the timed animated placeholder. A missing or unreadable file displays a warning and falls back to the same placeholder so the interaction remains testable.

For the Raspberry Pi 4, use portrait 1080 × 1920 H.264 video with AAC audio in an MP4 container.
