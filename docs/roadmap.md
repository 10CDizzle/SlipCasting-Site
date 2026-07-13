# What this deliberately does not do

Stated plainly, so nobody discovers it the hard way.

## Not in v1

**Curved or stepped parting surfaces.** The parting surface is always a plane. Parts
that a skilled mold-maker would part along a curve get reported as undercut here. This
is the single biggest limitation, and it is an open research problem rather than an
oversight.

**Three-or-more-piece molds.** Two halves, or one open mold. A part needing a side core
— a teapot spout, say — cannot be handled. The tool will tell you so rather than guess.

**Automatic undercut removal.** If your part is undercut, the tool says so and shows you
where. It will not silently modify your geometry to make its own life easier. Quietly
changing the shape of someone's design is not a favour.

**Splitting pieces that exceed the print bed.** The Instructions tab tells you whether
each piece fits common printers. It will not cut them up for you — your slicer will.

**Accounts, sharing, a server.** Everything lives in your browser. Sharing means sending
someone the file.

## Deliberate translations from Onshape

`UI-UX.md` describes Onshape. Parts of it have no analogue here, and are **not faked**:

- **Sketch Mode.** There is nothing to sketch — you bring a solid.
- **Assembly mates.** The mold pieces have exactly one way to fit together, and the
  tool already knows what it is.
- **Drawings.** A mold does not need a 2D manufacturing print. It needs an STL and a
  plaster recipe, which is what the Instructions tab is.

Onshape's **Mass Properties** corner *is* translated — into the plaster and slip
calculator. Mass is not the number you need at a plaster bench; kilograms of plaster and
litres of water are.

One honest oddity: the workspace shows your part **rotated onto the pull axis**, not in
the orientation you drew it. That is the mold's frame, and it is the frame everything
downstream lives in — but it does mean a mug appears lying on its side, because that is
genuinely how its mold is parted.

## Possible later

- Curved parting surfaces that follow the silhouette.
- Plaster consistency as a parameter.
- A batch mode: N molds of the same part, nested for the print bed.
- Multi-cavity molds — several parts in one block.
- Dragging the parting plane directly in the viewport, rather than trusting the
  automatic one.
