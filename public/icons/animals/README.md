# Animal avatars

A player's avatar is the animal they pick on the account page — there is no photo
upload. The art lives here, one PNG per animal, named after the animal in
lowercase:

```
bear.png   cat.png   dog.png   duck.png   elephant.png
fox.png    giraffe.png   koala.png   lion.png   penguin.png
```

Transparent background, around 256×256. For scale, the largest other asset in this
repo is `icon-512.png` at 18.7 KB.

**What matters is the artwork's own proportions, not the canvas.** `Avatar` draws
these with `object-contain` on a neutral circle, so nothing is ever cropped — but a
subject wider than it is tall fits to the width and letterboxes, rendering smaller
than a compact one.

A square canvas does *not* fix this. `dog.png` and `elephant.png` were re-exported
from 274×200 and 280×200 onto square 304×304 and 320×320 canvases, and both render
exactly as they did before: the transparent padding moved from the file's edges to
the middle of the frame, and the subject still occupies about 67% of the height.

Measured fill (share of the rendered box the opaque art covers, tallest dimension):

| animal | canvas | art | fills |
| --- | --- | --- | --- |
| duck | 200×200 | 166×187 | 94% |
| fox | 200×200 | 191×185 | 93% |
| penguin | 200×200 | 181×179 | 90% |
| cat | 200×200 | 175×170 | 85% |
| bear | 200×200 | 182×165 | 83% |
| dog | 304×304 | 289×204 | 67% |
| elephant | 320×320 | 313×215 | 67% |
| koala | 256×200 | 242×162 | 63% |

The wide three are wide because of their ears, which is intrinsic to the drawing.
Getting them to match means scaling the subject until it fills the frame vertically
and letting the ear tips run to the edges — an art change, not a file-dimensions one.

Check a new animal before committing it:

```bash
node scripts/animal-art-fill.mjs
```

It prints the table above from whatever is in this folder and flags anything that
will read noticeably small next to the rest.

**Adding an animal is two steps:** drop the PNG here, then add the entry to
`ANIMAL_AVATARS` in `src/lib/profile/animals.ts`. An animal absent from that map is
still selectable and simply renders the initials mark, which is how the eight
undrawn animals behave today.

**This directory must stay under `public/icons/`.** The service worker's runtime
cache accepts only `/_next/static/` and `/icons/` (`src/app/sw.js/route.ts`), so art
anywhere else would refetch on every load and go missing offline.

`src/lib/profile/animals.test.ts` fails if a mapped path has no file here — worth
knowing, because a missing file just falls back to initials in the browser and looks
exactly like an animal nobody picked.
