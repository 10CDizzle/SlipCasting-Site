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

## 4. Pull direction and parting plane (`analysis.ts`)

**This is the part that makes the tool worth using, and it is the part I got wrong
twice.** Both mistakes are worth recording, because both produced molds that *looked*
fine and could never have opened.

### The criterion

A mold half is only removable if every surface it touches is reachable along the
direction it travels. So there are **two** conditions on each face, and you need both:

- **Local.** The face's normal must not point *against* the pull. Mold material resting
  on a face that leans away from you cannot be dragged toward you — it would have to
  pass through the part. This is pure arithmetic: `n · d ≥ 0`.
- **Global.** Nothing else may be in the way. This is a ray cast.

### Mistake 1: I only checked reachability from *either* pole

I asked "can this face see `+d` **or** `−d`?" That is necessary but **not sufficient**.
A two-part mold also needs the parting *plane* to **separate** the two sets:

> Every face **above** the plane is touched by the upper half and must be reachable
> from **+d**. Every face **below** is touched by the lower half and must be reachable
> from **−d**.

Without that, each half can end up clamped around geometry it can never release. The
mold passes every check and physically will not open.

On a mug this was not subtle. The seam settled ~26° off the plane of symmetry, which
puts the **whole handle inside one half with its hole trapped**. The tool reported it
green. The parting plane is now chosen by sweeping it and minimising the surface the
mold would trap, and the pull-direction search scores each axis *on its best plane* —
so a mug now parts exactly on its symmetry plane, bisecting the handle, which is where
a pottery puts the seam.

### Mistake 2: the graze tolerance ate the local condition

I relied on rays alone and skipped the local test. Rays from a cup's flat top, fired
downward, re-enter the solid **immediately** — and "immediately" is inside the graze
tolerance that exists to swallow boolean slivers. So the tolerance ate the evidence,
and a cup's lid read as reachable from *underneath*, which is nonsense. Local first,
then the ray.

### Search

Sweep ~128 directions over a hemisphere, **seeded with the part's own principal axes**.
That seeding matters: a fixed sample grid never contains the exact axis of a part that
arrived rotated, and "nearly the axis" is not good enough, because a pull a few degrees
off a surface of revolution turns its walls into undercuts. Nobody exports their model
conveniently aligned.

Ranked by, in strict order:

1. **Undercut area** at the direction's best parting plane. Disqualifying.
2. **Where the seam lands** — prefer an extreme, which gives a one-piece mold.
3. **Shallow draft** — weighted *lightly*. Heavy, it starts *choosing the parting axis*,
   tilting the pull off a part's natural axis purely to give its flat faces some draft.
   That trades a clean seam on the plane of symmetry for a diagonal one.
4. **Block volume** — how much plaster it burns.

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

## 5. Block (`block.ts`)

A bounding block plus the plaster wall thickness, or a conformal hull offset that hugs
the part and saves plaster. The outer walls get a couple of degrees of draft so a
printed tray lifts off the set plaster instead of suctioning onto it.

**A one-piece mold is cut off at the parting plane.** That plane is its open *mouth*,
and the part lifts straight out of what is left. Building the block over the top of the
part instead entombs it — a sphere cannot be extracted from a closed lump of plaster,
and neither can a cup. The engine used to do exactly that and call it moldable, because
it never asked whether the mold could get out of its own way.

## 6. The pour axis — *not* the pull axis (`spare.ts`)

**These are two different questions and conflating them is a real mistake.**

- The **pull axis** is how the mold *opens*.
- The **pour axis** is which way is *up* when it stands on the bench being filled.

For a plain cup they coincide, and the distinction never surfaces. For a **mug** they
are perpendicular: the mold opens *sideways* through the handle, but it stands upright
and is filled *from the rim*. Assume the pour hole belongs at the top of the pull axis
— as this engine originally did — and you put the spare on the **side of the mug**,
where slip would run straight back out onto the bench.

The mold frame therefore carries both axes: pull onto +Z (so the parting plane is
horizontal and everything downstream can say "above" and "below"), pour into the XZ
plane (so the channel runs out through a *face* of the block rather than a corner).

The pour axis defaults to the part's own **+Z**, because people model pots standing up.

## 7. Spare placement

The channel comes down the pour axis onto the part. You can click the part to place it;
otherwise it sits at the part's highest point measured up the pour axis — the rim.

Wherever it goes, the channel starts from the surface **beneath that point**, not from
the part's global extreme. Those coincide only at the summit. Anywhere else, starting
from the extreme leaves the channel hanging in mid-air above the chosen spot, connected
to nothing: a mold with a pour hole that dead-ends and a cavity sealed inside solid
plaster. It looks perfect right up until someone prints it, pours it, and waits an hour.

The engine asserts that the spare intersects the part, and refuses if it does not.

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
