# Torque & Turnover

A day-by-day management simulator for an independent auto repair shop. Same shape
as a coffee-shop simulator — you get a day, a set of resources, a price, and some
traffic — but the resources are the ones that actually govern a repair shop:
bays, tooling, technicians, service advisors, parts inventory, parking spaces,
price, and advertising.

**Play it:** open `index.html` in any browser. No build step, no dependencies, no
server. Progress saves to `localStorage` automatically.

**Single file:** `node build.js` writes `dist/torque-and-turnover.html` — the
whole game inlined into one page you can email, host anywhere, or open offline.

---

## The day, in three acts

**Before — the morning plan.** Six steps, each with a recommended value and one
sentence saying why beside every input, so you can accept your way through a
whole morning without knowing what a normal number looks like:

| Step | What you decide |
|---|---|
| Brief | Nothing — it tells you what happened, what today looks like, and what is currently costing you the most money |
| Pricing | Door rate, parts markup, diagnostic fee, coupon |
| Advertising | A spending posture (Paused / Lean / Standard / Growth) that splits a budget across channels by marginal return, then per-channel overrides |
| Parts | What to order, sized to seven days of expected demand |
| Crew | Who is scheduled and for how long |
| Open Up | The plan you just built, the warnings it raises, and the door |

**During — the shop clock.** The day plays out 7am to 6pm: cars arriving, jobs
going up on lifts, hot-shot parts runs, comebacks, deliveries, and every call
that went to voicemail, in the order it happened. A live floor board shows what
each bay is doing right now. Play, pause, 1×/2×/4×, or skip to close.

**After — the outcome.** A P&L, the day's funnel, the reviews that landed, a
leak table with a Fix button next to each line, and whatever decision the day
forced on you. Then *Plan Tomorrow*.

The eight detail screens — Shop Floor, Crew & Training, Parts Room, Pricing,
Marketing, Facility, Books, Dashboard — live in an **Office** you drill into
from whichever step raised the question. Nothing was removed; it is one level
deeper than the decision that sends you there.

Fast-forward from the Open Up step with **Skip 6 days** or **Skip 30 days** —
those keep your current plan and auto-order parts to a seven-day target.

## The recommendations

Every number the game suggests is derived, not hard-coded:

- **Door rate** is solved backward from your customers' price tolerance, which
  rises with objection-handling training and a financing program — then capped
  until your rating has earned it.
- **Ad budget** is a share of expected sales, handed out $5 at a time to
  whichever channel returns the most gross profit for the next dollar, then
  swept so nothing sits under a channel's minimum spend doing nothing.
- **Parts** cover seven days of the job mix your bays can actually perform, at
  your current closing ratio, with a cushion for upsells.
- **Scheduled hours** come from the book hours already on the lot plus what you
  expect to sell, divided by how fast your technicians actually work.
- **What to fix next** is ranked by dollars: each leak is scored by what it cost
  you over the last two weeks, and the biggest one leads the morning brief.

## What the simulation actually models

### Demand funnel

```
opportunities = walk-ins + repeat customers + paid leads
              × day-of-week × season × reputation × active events
              × service-menu coverage

  → advisor capacity gate      (the rest go to voicemail)
  → closing ratio              (advisor training, price vs market, reputation)
  → parking gate               (no space, no sale)
  → capability gate            (no tooling or no certified tech, no sale)
  → repair order               (primary job + inspection upsells)
```

Every gate is reported back to you — on the evening screen for today, and on the
Dashboard under *Where The Business Is Leaking* for the life of the shop — with
the specific fix for each.

### The clock

Production is dispatched on a real timeline, not a pool of hours. Each bay and
each technician has a "free from" time; a job cannot start before its car
arrives, before a suitable bay opens up, or before a qualified technician is
free, and nothing new starts after close. Cars arrive on a realistic curve —
about a third before 9am, a trickle after lunch — which is why an afternoon
drop-off rolls over to tomorrow and why a night-drop box is worth paying for.
Dispatch trades a little waiting for a lot of skill: a master an hour from free
beats a rookie who is free now.

### Bays and tooling

Four bay types — general repair, tire & wheel, alignment rack, diagnostic — each
with five tool packages. Tooling does three things: unlocks job types (you cannot
recharge an A/C without an A/C machine, cannot calibrate ADAS without a
calibration frame), multiplies technician speed in that bay, and cuts comebacks.
A bay under construction earns nothing; a bay with nobody to staff it earns
nothing either.

### Technicians

Eight skill areas (maintenance, brakes, suspension, tires & alignment,
electrical, engine, HVAC, diagnostics) each 1–5, plus certifications that gate
work outright: EPA 609/A7 for refrigerant, A9 light diesel, ADAS calibration,
and HV/EV safety.

Technicians are paid flat rate — they earn the hours they bill, against a
six-hour daily guarantee. Skill drives how fast book hours get produced and how
often a job comes back. Thirteen training courses raise skills, grant
certifications, or improve raw productivity and quality. A technician in class is
out of the shop and still costs you half their guarantee.

### Service advisors

The front counter is its own bottleneck. Each advisor handles a finite number of
customers a day; everything past that is a call nobody answered. Six training
tracks, five levels each, with escalating cost and diminishing returns:

| Track | What it moves |
|---|---|
| Phone Skills & Appointment Setting | customers handled per day |
| Menu Presentation & Value Building | closing ratio |
| Digital Vehicle Inspection Presentation | additional sold work per RO |
| Objection Handling & Price Framing | how far above market you can price |
| Declined Service Follow-Up | recaptures work customers said no to |
| CSI, Handoff & Retention | satisfaction, reviews, repeat business |

### Parts

Nine inventory categories with real lead times. Three quality tiers (economy /
quality aftermarket / OE) that trade cost against comeback rate and customer
perception, and three buying programs (next-morning jobber, two-day warehouse,
four-day bulk) that trade cost against how much cash and shelf space you tie up.
Run out mid-job and you either pay a 55% hot-shot premium or the car sits on your
lot with an unhappy owner attached to it.

Parts are priced off a matrix, not a flat multiplier: cheap parts carry a fat
markup, expensive ones a thin one, and tires are capped near commodity margin
because that is how tires work.

### Advertising

Seven channels, each with its own saturation curve, lag, adstock decay, lead
quality, and effect on repair order size:

| Channel | Speed | Character |
|---|---|---|
| Google Local Services & Search | same day | Highest intent, turns off the moment you stop paying |
| Meta / Instagram | 1-day lag | Cheap reach, weaker intent |
| Direct mail | 3-day lag | Slow to hit, sticks for weeks, brings price shoppers |
| Radio & streaming audio | 2-day lag | Pure awareness, ~10% daily decay |
| Website & local SEO | 5-day lag | Compounds; ~29-day time constant, hardest to take away |
| Community sponsorship | 4-day lag | Slow burn, builds reputation |
| Referral & loyalty | 1-day lag | Highest intent; scales with your customer base |

Doubling spend never doubles calls. Slow channels do almost nothing for a month
and then keep producing after you pause them.

### Money

Flat-rate payroll with a 12.1% burden, 5% advisor commission on gross profit,
monthly fixed overhead (rent, utilities, insurance, software), per-day upkeep on
loaners and software, a warranty reserve, monthly estimated income tax, and a
$75,000 line of credit at 9.5% APR that auto-draws on shortfalls and auto-sweeps
on surplus. Run out of both cash and credit and you are done.

### Everything else

Eleven facility upgrades (parking, shelving, lounge, loaners, shuttle, DVI
tablets, shop management software, customer financing, night drop, signage,
second shift), fourteen random events including seasonal spikes and two that make
you choose, seasonal and day-of-week demand curves, a review-driven reputation
that multiplies every traffic source, a customer base that compounds when you
treat people well, comebacks that arrive days later as free labor, and eight
milestones to chase.

## Where to start

Prices and one advertising channel on day one. Watch the leak table. When
"calls nobody answered" is your biggest number, the answer is an advisor or phone
training — not more advertising. When "work you cannot perform" leads, buy
tooling. When your lot is full and turnaround is stretching, you have sold more
work than you can produce, and the fix is capacity, not sales.

## Layout

```
index.html      page shell
styles.css      theme
js/data.js      every tunable number: jobs, parts, tooling, training, channels
js/engine.js    the simulation — pure state in / state out, no DOM
js/advice.js    the recommendations: what a normal number looks like, and why
js/ui.js        shared render helpers and the eight Office screens
js/screens.js   the three-act shell: morning plan, day playback, evening review
build.js        bundles everything into dist/torque-and-turnover.html
```

`js/engine.js` runs headless under node, which is how the balance was tuned:

```js
global.AutoShopData = require('./js/data.js');
const E = require('./js/engine.js');
let s = E.newGame(12345);
E.setAdSpend(s, 'lsa', 150);
for (let d = 0; d < 90; d++) {
  E.suggestOrder(s, 7).forEach(o => o.order > 0 && E.orderParts(s, o.cat, o.order));
  const r = E.runDay(s);
  console.log(r.day, r.cars, Math.round(r.revenue), Math.round(r.net));
}
```

The simulation is seeded, so the same seed and the same decisions replay
identically.
