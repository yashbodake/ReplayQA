# Background Music

Place royalty-free audio files here. The `BackgroundMusicManager` auto-discovers
all `.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg` files in this directory and shuffles
one per narration run.

## Bundled tracks

- **wholesome-ambient.mp3** — Kevin MacLeod (incompetech.com), licensed under Creative Commons
- **hidden-wonders.mp3** — Kevin MacLeod (incompetech.com), licensed under Creative Commons

## Getting more music

Download royalty-free tracks from:
- **Pixabay Music** — https://pixabay.com/music/search/corporate%20ambient/
- **Incompetech** — https://incompetech.com/music/royalty-free/
- **Free Music Archive** — https://freemusicarchive.org/genre/Ambient/

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `NARRATION_MUSIC` | `false` | Enable background music |
| `NARRATION_MUSIC_VOLUME` | `0.3` | Music volume (0–1, subtle under narration) |
| `NARRATION_MUSIC_SHUFFLE` | `true` | Shuffle track selection |
