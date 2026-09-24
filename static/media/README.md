# Video files

Copy the final MP4 files into this exact layout:

```text
static/media/
├── maya/
│   ├── idle.mp4
│   ├── welcome.mp4
│   ├── story-1.mp4  # Staying well
│   ├── story-2.mp4  # Spotting something early
│   └── story-3.mp4  # Guide me
├── mo/
│   ├── idle.mp4
│   ├── welcome.mp4
│   ├── story-1.mp4  # Living well
│   ├── story-2.mp4  # Planned treatment
│   └── story-3.mp4  # Urgent care
└── mary/
    ├── idle.mp4
    ├── welcome.mp4
    ├── story-1.mp4  # Recover and rehabilitate
    ├── story-2.mp4  # Age well
    └── story-3.mp4  # Supported living
```

These paths are already configured in the project-level `content.json`. The optimised 1080 × 1920 MP4 files are tracked by Git, so a pull or application update installs the same media on each Pi. The separate `media-originals-4k` backup remains excluded from Git.

A missing or unreadable file displays a warning and falls back to its timed animated placeholder, keeping the interaction testable while files are being installed.

For the Raspberry Pi 4, use portrait 1080 × 1920 H.264 video with AAC audio in an MP4 container. After copying or replacing files, restart the kiosk service and reload the kiosk page.
