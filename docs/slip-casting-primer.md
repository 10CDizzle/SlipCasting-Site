# A primer on slip casting

Written for the engineer who has been handed this problem and has never touched clay.
If you already make molds for a living, skip to [workflows.md](workflows.md).

## The process

Slip is liquid clay. You pour it into a plaster mold, and the plaster — which is
porous — drinks water out of the slip touching its surface. A skin of stiffening
clay builds inward from the mold wall. When that skin is as thick as you want the
pot to be, you tip the mold up and pour the still-liquid middle back out. What is
left is a hollow pot, sitting inside the mold, shrinking away from the plaster as
it dries until it drops free.

That is *drain casting*, and it is how nearly every ceramic mug, vase and sink you
have ever seen was made.

**The mold is the machine.** Everything this tool does is in service of producing a
plaster negative that (a) can physically come off the cast, and (b) absorbs water.

## The four things that have to be right

### 1. Shrinkage — the mold must be *bigger* than the pot

Clay shrinks when it dries and shrinks again when it fires. Total shrinkage is
typically 10–15% for stoneware and porcelain, 5–10% for earthenware.

This is the mistake that costs people a kiln load: **13% shrinkage does not mean a
1.13× mold.** The fired pot is 87% of the mold, so the mold must be

$$\text{scale} = \frac{1}{1 - 0.13} = 1.149$$

A mold built at 1.13× yields pots that are consistently a size too small, and the
error does not announce itself — it just comes out of the kiln wrong. The engine
does this arithmetic in `shrinkageScale()`, and there is a test whose only job is
to fail if anyone ever "simplifies" it.

### 2. Undercuts — the mold has to come off

A mold half pulled in some direction can only be removed if *every surface it
touches* is visible from that direction. A face hidden from both the up-pull and
the down-pull is an **undercut**: no two-part mold can ever release it, and moving
the parting line does not help.

Two examples that make the point, and that most naive tools get backwards:

- A **donut** has no undercuts if you part it at its equator. Each half is a ring
  bump. Real donut molds are two-part for exactly this reason.
- A **mug** is a hopeless undercut along its own axis — the inside of the handle is
  hidden from both above and below. But part it *perpendicular to the handle's
  loop*, pulling straight through the hole, and every surface is reachable. That is
  precisely where a pottery puts the seam on a mug mold.

This tool searches for that axis rather than assuming the obvious one. See
[geometry-pipeline.md](geometry-pipeline.md).

### 3. Draft — it has to come off *easily*

A wall exactly parallel to the pull direction has zero draft. It will release, but
it drags along its entire length, wearing the mold and scuffing the cast. A degree
or two of taper makes the difference. The tool flags shallow-draft surfaces amber
and tells you how much of the part is affected — it does not stop you, because a
zero-draft cylinder is a perfectly normal thing to cast.

### 4. Plaster consistency — the mold has to *drink*

Plaster is mixed by **weight**, to a ratio called the *consistency*: parts water per
100 parts plaster. Pottery plaster runs at about 70.

Mix it by eye and you get one of two failures. Too little water gives a dense, hard
mold that cannot absorb — and a mold that cannot absorb *does not cast at all*. Too
much gives a mold so soft it crumbles when you demold. The absorbency is not a nice
property of the mold; it is the entire mechanism.

The tool converts your mold's volume into kilograms of plaster and litres of water,
and puts it in the corner of the screen where Onshape would put mass properties —
because that is the number you actually need.

## The vocabulary

| Term | What it means |
|---|---|
| **Slip** | Liquid clay, about the consistency of double cream. |
| **The positive** | Your part. The shape you want to end up with. |
| **The negative** | The plaster mold: the void your part leaves behind. |
| **Spare** | The funnel and reservoir you pour into. It also feeds extra slip as the level drops, so the rim does not come out starved. |
| **Natch / key** | The cones and sockets that make the mold halves seat identically every time. Without them, every cast has a stepped seam. |
| **Cottle** | The walls you build around a model before pouring plaster. |
| **Parting line** | Where the mold halves meet, on the cast. |
| **Draft** | Taper, so the mold releases. |
| **Drain casting** | Pour full, wait, tip out. Gives a hollow pot. |

## Why this tool exists

Designing a mold by hand means: work out the parting line, bed the model in clay up
to it, build a cottle, pour, flip, dig out the clay, carve natches with a coin, soap
the face, pour again. It takes an afternoon, it is only as accurate as your thumbs,
and every error in it shows up on *every pot the mold ever makes*.

If you can print the part, you can skip almost all of that. Which is the point.
