# Troubleshooting

## "This part cannot be molded as drawn"

The part has surfaces that no two-part mold could ever release — hidden from *both* the
up-pull and the down-pull. The red faces in the viewport are the culprits.

Things that genuinely cannot be molded in two parts:

- **An enclosed void.** Nothing can reach it. (Try the "Sealed void" sample.)
- **Two handles in perpendicular planes.** Any axis that frees one traps the other.
- **A re-entrant groove** wrapping around the part.

Things that *look* impossible but are not — let the search find the axis:

- **A handle.** It parts perpendicular to the loop, straight through the hole.
- **A torus.** It parts at the equator.

If it is genuinely undercut, your options are to change the part, or to split it into
pieces that are each castable and join them in the greenware.

## "This mesh could not be made watertight"

Your exporter produced something that is not a solid. Common causes:

- **You exported surfaces, not a solid body.** The app says *"encloses no volume"* for
  this. Check your CAD tool is exporting a closed solid.
- **Self-intersections** — two bodies overlapping without being unioned. Boolean them
  together in CAD first.
- **A very coarse export** that left cracks.

Re-export at a finer tolerance. STEP tends to be cleaner than STL, because it carries
exact surfaces rather than a triangulation.

## The mold is enormous

Check your import units first. Then check the plaster thickness — 25 mm around a large
part adds up quickly. The Instructions tab tells you whether every piece fits common
printer beds.

## The cast will not release, or the mold drags

Look at the draft bar in the corner. If a lot of the surface is amber, your part has
near-vertical walls. Add a degree or two of taper in CAD.

The tool will not add draft for you. Silently changing the shape of someone's design is
not a favour.

## The mold will not absorb; the cast never builds a wall

Almost always the plaster mix. It has to be **weighed**, not judged by eye. Too little
water gives a dense mold that cannot drink — and absorbency is the entire mechanism.

Also: **a new plaster mold is wet.** Let it dry thoroughly — days, not hours — before
the first cast.

## Bubbles and pits on the cast surface

Air trapped against the core when you poured. Tap the tray on the bench for a full
minute afterwards. Every bubble becomes a pit on the face of every pot that mold ever
makes.

## The halves will not seat, or the seam steps

Key clearance. 0.3 mm is the default. If the halves bind, increase it; if the mold
rocks, decrease it.

## It is slow on a big part

The boolean kernel is single-threaded WASM — that is the price of hosting free with no
server (see [architecture.md](architecture.md)). Decimate very heavy meshes before
importing; a mold does not need 500,000 triangles of surface detail, because plaster
will not reproduce them anyway.
