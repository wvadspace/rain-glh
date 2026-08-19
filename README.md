# Torque &amp; Profit — Auto Repair Shop Simulator

A day-by-day management simulator for an independent auto repair shop. You start with
two bays, two technicians, one service advisor and a lot with eight spaces. Every
morning you set your labor rate, your advertising and your parts order. Every day cars
show up — and what you can actually *sell* depends on the tooling bolted to your bay
floors, the tickets your technicians hold, and how well your counter closes.

Runs entirely in the browser. No build step, no dependencies, no server required.

## Play

Open `index.html` in a browser. That is the whole install.

For a local server instead (some browsers restrict `file://`):

```
npx http-server -p 8080 .
# then open http://localhost:8080
```

Progress saves to `localStorage` after every simulated day. The Manual tab inside the
game explains every mechanic and every number; the Menu has save export/import.

## The model

### The day

Cars arrive hour by hour from drive-by traffic, returning customers and each ad channel
you fund. Each arrival runs a gauntlet:

1. **Parking.** A car holds a space from arrival until the keys go back. Lot occupancy
   is tracked hour by hour — when the bays fall behind, the lot fills and cars get
   turned away at the driveway.
2. **The counter.** An advisor writes the estimate. Advisors have a hard daily customer
   cap; overflow customers wait, then leave.
3. **The close.** Approval probability is driven by the advisor's sales training, your
   price against the town average (with a per-job price-sensitivity exponent), your
   reputation, the lead's intent, and how badly the car needs the work.
4. **The upsell.** The tech finds it and the advisor sells it — a second job onto the
   same repair order.
5. **Dispatch.** Approved work goes to a **station**: a bay paired with a technician.
   The bay must have the equipment level; the tech must have the skill level. The
   dispatcher picks the *least over-qualified* station with clock left, so the heavy-line
   bay is not burned on oil changes.
6. **The clock.** Work is billed in **book hours** and consumes **clock hours** at
   `book hours ÷ efficiency`. Unfinished work carries overnight, occupies a parking
   space and eats tomorrow's hours first.

### The four constraints

Parking spaces, service advisors, bays (and their tooling), and technicians (and their
skills). Whichever is tightest is the only one worth spending money on — buying a fifth
bay when you have three technicians just adds upkeep.

### Levers

| Lever | Effect |
|---|---|
| Labor rate | Close rate, walk-in interest and reputation drift, all at once |
| Oil change price | A traffic purchase. Only pays off if the counter converts the inspection |
| Diagnostic fee | Protects your best tech's hours from free-estimate shoppers |
| Parts matrix | Sliding-scale markup (cheap parts marked up hard, expensive parts lightly), with Value / Standard / Premium postures |
| Shop supplies fee | Percentage of labor, capped |
| Parts inventory target | Too little means rush-order premiums; too much ties up cash |
| Bay equipment (5 levels) | Flat Stall → Two-Post Lift → Diagnostic Bay → Tire &amp; Alignment → Heavy Line. Gates which of the 32 job types are physically possible |
| Technician training (5 levels) | Lube → C → B → A → Master. Gates job difficulty, sets flat-rate efficiency (0.68× to 1.45×) and comeback risk |
| Advanced sales training (5 levels) | Counterperson → Master Advisor. Raises close rate, upsell rate and daily customer throughput |
| Advertising (6 channels) | Each builds a decaying awareness stock with diminishing returns |
| Location (4 tiers) | The biggest single driver of raw traffic, and the most expensive |
| Financing | Borrow against equipment and location at 8.9% APR |

### Advertising

Each channel accumulates an awareness stock: `stock = stock × decay + (spend ÷ scale)^0.62`.

- **Google Search &amp; LSA** — 34% carries overnight. Stop paying and the phone stops today. High intent, skews to repairs.
- **Social Media Ads** — 71% carries. Cheap reach, softer intent, skews to maintenance.
- **Direct Mail Coupons** — 80% carries. Arrives with a 15% discount you must honor.
- **Local Radio &amp; Outdoor** — 89% carries. Wasteful in small doses, powerful when sustained.
- **Review &amp; Reputation Program** — buys no leads; raises reputation, which lifts all organic traffic.
- **Loyalty &amp; Reminder Program** — buys no leads; shortens the return interval of customers you already earned.

Channels are judged on gross-profit return on spend, not lead count.

### What else is modeled

Seasonality by month and weather by day (both shifting the job mix — heat waves sell
A/C, cold snaps sell batteries), day-of-week traffic, Saturday half-days, Sundays closed
with the bills still running, comebacks that redo work for free, technician fatigue and
morale, appointment scheduling with a two-day patience limit, rush-order parts premiums,
random operational events (two of which are player decisions), 14 milestones, and
bankruptcy when cash falls past your credit limit.

## Metrics reported

Car count, ARO, effective labor rate, close rate, billed vs. available hours, bay
utilization, per-station productivity (how busy) and efficiency (how fast), parts gross
margin, per-source lead volume and return on ad spend, per-job revenue mix, and a
"where the money leaked" breakdown covering cars turned away, customers who left
unserved, work referred out for missing capability, rush parts, comebacks and
cancellations.

## Layout

```
index.html        markup shell
css/styles.css    theme
js/data.js        job catalog, equipment/staff ladders, channels, events, milestones
js/state.js       state construction, pricing math, persistence
js/sim.js         the day simulation
js/ui.js          view rendering
js/main.js        actions and wiring
```

`js/data.js` is where the balance lives — job book times, parts costs, wage and training
tables, channel coefficients and location traffic are all data, not code.
