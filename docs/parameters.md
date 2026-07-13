# Parameters

Every knob, what it means, and when to change it.

## Import

| Parameter | Default | Notes |
|---|---|---|
| **Units** | mm | What the numbers in the file mean. The app warns if the model's size suggests you have this wrong — a 90 mm cup exported in metres arrives 0.09 units tall. |

## Shrink for clay

| Parameter | Default | Notes |
|---|---|---|
| **Clay shrinkage** | 13% | Total, drying **plus** firing. Stoneware and porcelain run 10–15%, earthenware 5–10%. Ask your clay supplier, or fire a test bar and measure it. |

The mold is cut oversize by `1 / (1 − shrinkage)`, so 13% gives a **1.149×** mold —
not 1.13×. Getting this wrong does not fail loudly. It just gives you pots that are
quietly the wrong size, and you find out after the kiln.

## Pull direction

| Parameter | Default | Notes |
|---|---|---|
| **Pull direction** | Find it for me | The axis the mold halves come apart along. The search finds an axis with no undercuts, which is **not always the obvious one** — a mug parts through its handle, not along its own axis. |
| **Minimum draft** | 2° | Faces with less taper than this are flagged amber. They still release; they just drag against the plaster. |

## Mold block

| Parameter | Default | Notes |
|---|---|---|
| **Plaster thickness** | 25 mm | Thin molds crack. Thick molds are heavy, slow to dry, and slow to cast. 20–30 mm suits most work. |
| **Block shape** | Rectangular | *Conformal* hugs the part and saves plaster, at the cost of a mold that is less pleasant to stack and clamp. |
| **Outer draft** | 2° | Taper on the outside walls so a printed tray lifts off the set plaster instead of suctioning onto it. |

## Pour spare

| Parameter | Default | Notes |
|---|---|---|
| **Pour hole** | 30 mm | Too narrow and the slip will not flow. Too wide and you waste clay and leave a big scar to trim. |
| **Reservoir height** | 40 mm | The head of slip that keeps feeding the cast as the plaster draws water out and the level drops. Too short and the rim comes out starved. |

## Split

| Parameter | Default | Notes |
|---|---|---|
| **Two-part mold** | On | Off gives a single open mold, which is all a simple tapered form needs — and it is one less seam to clean off every cast. |

## Registration keys

| Parameter | Default | Notes |
|---|---|---|
| **Keys** | 4 | Natches. Zero is legal, and occasionally right for a one-piece mold. |
| **Key size** | 12 mm | |
| **Key clearance** | 0.3 mm | The gap between cone and socket. Zero and the halves bind on plaster that has swollen a hair; too much and the mold rocks, and the seam steps. |

## Printable pieces

| Parameter | Default | Notes |
|---|---|---|
| **What to print** | Trays | See [workflows.md](workflows.md). |
| **Tray wall** | 3 mm | Enough to hold a few kilos of wet plaster without bowing. |

## Plaster consistency

Not exposed in the UI yet; fixed at **70** — parts water per 100 parts plaster, by
weight, which is standard for pottery plaster.

It is the single most consequential number in mold making. Too little water gives a
mold too dense to absorb, and a mold that cannot absorb does not cast at all.
