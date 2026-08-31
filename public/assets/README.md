# assets/

Everything the game *draws* is still procedural, and every sound effect is
still synthesised at runtime with the Web Audio API. This directory holds the
one exception.

## ambience-night.mp3

The night jungle bed under the whole mission — the only recorded audio in the
project.

**Provenance and licence: UNVERIFIED.** The file arrived as a download titled
"Free Sounds — Jungle Night Ambience (1 Minute Long)" with a 2.5 MB video
thumbnail embedded in its ID3 tag, which is the signature of a YouTube rip,
not of a licensed download. "Free to use" in a video title is not a licence.
Before this game is published anywhere public, either

  * find the original recording and record its actual licence here, or
  * replace it with something whose terms are written down — Freesound
    filtered to CC0 is the least friction — or
  * record it. Malaysian jungle at night is the actual subject, and a phone
    left outside for a minute beats any stock library for authenticity.

The stripped tag is why this file is 470 KB rather than 3.0 MB; 84% of what
was downloaded was cover art.

## Swapping the file

`Audio2.AMBIENCE` in `src/audio.js` points here. Any clip works: it is trimmed
of leading and trailing silence, crossfaded into a seamless loop and levelled
to a target RMS at load time, so a different recording needs no retuning. Aim
for 60 s or longer — the ear locks onto individual insects and starts hearing
the repeat in anything shorter.

The load is fetched, so it is blocked when `index.html` is opened straight off
the disk. That failure is silent and the game plays normally without it; serve
the directory over HTTP to hear the jungle.
