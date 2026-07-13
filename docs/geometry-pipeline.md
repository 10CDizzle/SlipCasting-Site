# The geometry pipeline

What happens between "drop an STL" and "here are your STLs". Every stage lives in
`packages/engine/src/`, is testable in isolation, and runs identically in the
browser and in Node.

```
import → repair → shrink → pull direction → undercut analysis
       → parting plane → block → spare → split → keys → output
```

---

## 1. Import (`io.ts`)

STL, OBJ, PLY, 3MF natively; STEP and IGES via OpenCascade compiled to WASM, loaded
lazily so the 10 MB module only downloads if someone actually drops a STEP file.

Two details worth knowing:

**Binary vs ASCII STL is detected by arithmetic, not by the header.** A binary STL's
length is exactly `84 + 50 × triangleCount`. Plenty of binary STLs begin with the
word `solid`, which is supposed to mean ASCII — trusting that gives you a parser
that fails on real files from real exporters.

**Units are sniffed.** A 90 mm cup exported in metres arrives 0.09 units tall. Left
alone, you would generate a mold for a thimble and find out at the printer.

## 2. Repair (`repair.ts`)

The highest-risk module. Everything downstream — every boolean, every volume, every
mold — assumes a watertight solid. Real STLs frequently are not.

The tiers, cheapest first:

1. **Weld.** STL has no concept of a shared vertex: every triangle carries its own
   three copies, so *every edge reads as open*. Welding is the entire fix for the
   overwhelming majority of real files.
2. **Fill holes.** Chain the remaining open edges into loops and cap them.
3. **Fix winding.** A closed mesh wound inside-out has negative signed volume, and
   Manifold would read it as a void rather than a solid — inverting every boolean
   downstream.
4. **Rebuild.** Last resort: resample the shape as a signed-distance field off a BVH
   and re-extract the surface. Guaranteed watertight, because a level set always is;
   the shape just gets rounded off at the voxel scale.
5. **Refuse.** If it still is not a solid, say so and stop.

### The solidity gate

Watertight is not the same as solid, and this distinction bit us during development.

Cap a loose triangle with a centroid fan and you get a mesh that is *topologically
closed* and encloses **zero volume**. Every check passes. A mold cut from it is
silent nonsense wearing the costume of success. Surface models exported as sheets
land in exactly the same trap.

So repair also checks that the result encloses a meaningful volume relative to its
bounding box, and names the failure out loud: *"this mesh encloses no volume — it is
a surface or a sheet, not a solid."*

## 3. Shrink (`mold.ts`)

`master = part × 1/(1 − shrinkage)`. See the [primer](slip-casting-primer.md) for
why it is the reciprocal and not `1 + shrinkage`.

Everything downstream is built from the scaled master, so the mold, the block, the
keys and the spare are all in the same enlarged world.

## 4. Pull direction (`analysis.ts`)

**This is the part that makes the tool worth using.**

A mold half pulled along **+d** can be removed if and only if every surface it
touches is visible from **+d**. So a face is an **undercut** when it is occluded
from **+d** *and* from **−d** — no half of a two-part mold could ever free it, and
moving the parting plane cannot help.

That is *global accessibility*, and it is not the same as the sign of a face's
normal. Judging by normals gets a donut and a mug both backwards.

The search sweeps ~128 directions over a hemisphere (Fibonacci-distributed, plus the
principal axes) and ranks them by, in strict order:

1. **Undercut area.** Any undercut disqualifies the direction outright. There is no
   such thing as a mold that mostly comes off.
2. **Where the seam lands.** Prefer a parting plane at an extreme of the part, which
   gives a single open mold rather than two halves to clamp and clean. This is the
   term that makes a cup part at its rim.
3. **Shallow draft** — deliberately weighted *lightly*. Weighted heavily it starts
   *choosing the parting axis*, tilting the pull a few degrees off a part's natural
   axis purely to give its flat top and bottom some draft. That trades a clean,
   clampable seam on the symmetry plane for a diagonal one, which is a bad bargain
   at the bench.
4. **Block volume** — how much plaster it burns.

### Two subtleties that cost real debugging time

**Count only *entering* hits.** A triangle's centroid on a curved surface sits
slightly *inside* the true surface — an artifact of faceting. A ray fired nearly
tangent to the surface (which is every face along the silhouette, where the normal
is perpendicular to the pull axis) therefore starts a hair inside the solid and
immediately strikes the solid's own *exit* face. Counting that as an obstruction
condemns the entire silhouette band of every part as undercut. Leaving through your
own back face means you started inside; *entering* another piece of solid is what
actually blocks a mold.

**Ignore obstructions closer than ~0.1 mm.** Boolean seams shed near-tangent sliver
triangles whose rays graze immediately-adjacent geometry. The cutoff is physical,
not merely numerical: plaster cannot form a wall that thin, so a gap smaller than
that is not a mold feature under any circumstances.

## 5. Parting plane

The height along the pull axis where the part's silhouette is widest. Cut anywhere
else and the mold half above the cut has to travel past a wider part of the model to
escape — an undercut created purely by a bad parting plane.

## 6. Block (`block.ts`)

A bounding block plus the plaster wall thickness, or a conformal hull offset that
hugs the part and saves plaster. The outer walls get a couple of degrees of draft so
a printed tray lifts off the set plaster instead of suctioning onto it.

## 7. Spare (`spare.ts`)

The pour channel and its reservoir.

It sits over the part's **summit**, not the centre of its bounding box. Those
coincide for an upright cup — which is why the bug hid — and diverge completely for
anything else. A mug parts through its handle, so the pipeline lays it on its side,
and directly above the bounding-box centre there is nothing but air. The channel
never met the part: a mold with a pour hole that dead-ends and a cavity sealed inside
solid plaster. It would have looked perfect right up until someone printed it,
poured it, and waited an hour.

The engine now asserts that the spare intersects the part, and refuses if it does not.

## 8. Split (`split.ts`) — and the golden test

`plaster = block − (master ∪ spare)`, cut at the parting plane.

The identity that has to hold, and which one test asserts:

```
vol(upper) + vol(lower) + vol(block ∩ cavity) == vol(block)
```

Plaster, plus the space the part occupies, equals the block it was cut from. Nothing
vanishes and nothing is created. **Almost every way a boolean pipeline can be wrong
— an inverted operand, a missed intersection, a solid silently emptied — shows up as
a violation of that one line.**

## 9. Keys (`keys.ts`)

Cones on one parting face, sockets in the other, placed by insetting the block's
cross-section and subtracting the cavity's footprint so a key can never break into
the cast. Spread by farthest-point sampling, because keys bunched on one side let
the halves pivot about them.

Keys deliberately **break** the golden identity, by exactly the clearance volume —
sockets are larger than the cones that seat in them, and that gap is what lets the
halves close on plaster that has swollen a hair. So there is a second test asserting
the deficit is positive and grows with the clearance. If it ever came out negative,
the sockets would be tighter than the cones and the mold would never shut.

## 10. Output (`shells.ts`, `positive.ts`)

The two workflows. See [workflows.md](workflows.md).
