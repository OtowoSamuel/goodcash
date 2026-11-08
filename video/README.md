# GoodCash 45-second product demo

A Remotion project. It draws the app's own look (the styles are copied from `apps/web/src/styles.css`) with example numbers, adds a voiceover and sound effects, and renders a 1080p video. Everything runs locally.

## Render

```bash
cd video
npm install
npx remotion render GoodCashDemo out/goodcash-demo.mp4 --codec=h264 --crf=18 --audio-codec=aac --audio-bitrate=192k
```

Preview while editing: `npx remotion studio`.

## What is in it

- `src/Video.tsx`: the six scenes (hook, cash out, tracker, add G$, money ready, outro) and their timing. Scene lengths add up to 45 s.
- `src/ui.tsx`: the phone and the screens, built from the app's own classes.
- `public/vo/s1..s6.wav`: voiceover, made with the Mac's built-in `say` voice (Samantha), then cleaned with ffmpeg.
- `public/sfx/*.wav`: sound effects generated with ffmpeg tones and noise. Nothing downloaded.

## Remake the voiceover or sounds

The lines are in `src/Video.tsx` captions. To redo a line, run `say -v Samantha -r 172 -o sN.aiff "text"` and clean it with ffmpeg (high-pass, light EQ, compression, loudnorm to about -16 LUFS). If a line gets longer, lengthen its scene in `SCENES`.

## Notes

- Amounts are examples, and the last frame says so.
- Add CELO is not shown, because it is not live yet.
