# Shop Floor — an auto repair business simulator

A day-by-day management sim for an independent auto repair shop. Same shape as a
coffee-shop tycoon game — set your prices, buy your supplies, open the doors, see what
the day did — but modelled on how a real repair shop actually makes or loses money.

Open `index.html` in a browser. No build step, no dependencies, no server required.

```
git clone <this repo> && cd rain-glh
xdg-open index.html          # or: npx http-server -p 8080 .
```

The game autosaves to `localStorage` after every simulated day.

---

## The loop

Between days you set prices, order parts, staff the shop, buy equipment and buy demand.
Then you press **Open the Shop** and one day runs:

1. **Who is here** — techs in training or out sick don't work; bays that broke stay down.
2. **Demand** — reputation, weather, season, day of week, competition, your price level
   and each advertising channel produce a number of opportunities.
3. **The counter** — advisors work as many of those as they can, quote them, find a slot
   on the appointment book, close some, upsell some, and lose the rest.
4. **The floor** — bays and techs burn clock hours, parts come off the shelf, cars get
   delivered or carried overnight.
5. **Close-out** — payroll, overhead, advertising, interest, parts, taxes, reputation,
   morale, random events.

You get a full report with a P&L, a counter breakdown, a floor breakdown, every car
delivered with its satisfaction score, and a list of the work you had to turn away.

## What's modelled

**Bays and tooling.** Each bay holds its own equipment: lift, air and power tools,
diagnostic scanner, tire changer, alignment rack, A/C machine, press. A bay can only do
work its own tools support — no tire changer means every tire customer is turned away —
and better tools do the same job in fewer clock hours. The Bays tab shows exactly which
services you can't sell and what each one is worth.

**Technicians.** Level 1–5 (Lube Tech → Master Diagnostician), each with specialties,
an hourly wage, morale, fatigue and XP. Efficiency is skill × specialty match × tools ×
morale × fatigue. Training courses (ASE certifications, advanced driveability, EV/hybrid
high-voltage, workflow, quality control) cost money and take the tech out of the bay for
days. Techs who level up and don't get a raise get poached or quit.

**Service advisors.** The counter is a hard throughput limit — an advisor can only work
so many repair orders a day. Their skill drives closing ratio and upsell rate. Advanced
sales training (menu selling, digital inspection presentation, objection handling, phone
skills, follow-up, fleet prospecting) each move a specific number.

**The appointment book.** Sold work is scheduled against real sellable hours. Customers
who can't be seen inside their tolerance go somewhere else. You choose how tightly to
book — conservative through packed — and trade satisfaction against utilization.

**Parking.** The lot caps how many cars can be on the property. Unfinished cars sleep in
your spaces and block tomorrow's intake.

**Parts.** Eleven categories with independent supplier price indexes that drift with
events. Order in bulk for a discount, one day of lead time. Empty shelves stall the car
on your lot or force a same-day emergency order at a 35% premium.

**Pricing.** Labor rate, parts markup, diagnostic fee and a standing coupon. Each one
moves closing ratio, average ticket, margin and how price-shoppy your traffic is. The
Pricing tab prices out sample jobs against the market so you can see the effect.

**Advertising.** Eight channels — Local Services, PPC, SEO, social, direct mail, radio,
referral, fleet outreach — each with its own saturation curve, cost per lead, lead
intent and price sensitivity. SEO and radio build a stock that compounds and decays;
radio brand awareness lifts every other channel; mail delivers over several days and
brings coupon shoppers. Buying more demand than the counter can answer or the bays can
build is the fastest way to lose money in this game.

**Money.** Daily P&L and a balance sheet. SBA loan, revolving line of credit, monthly
income tax, fleet receivables at net 15, payroll tax, inventory shrink. Run out of cash
for three straight days with the credit line maxed and you're out of business.

**The world.** Weather by month, seasonal demand curves per service (A/C in July,
batteries in January, tires in November), day-of-week traffic, and twenty random events:
layoffs, road construction, a franchise opening down the street, viral reviews, tool
failures, supplier price moves, fleet offers, poaching, utility spikes.

## Metrics the game tracks

The same ones a real shop watches: average repair order, closing ratio, car count,
technician efficiency (billed hours ÷ clock hours), productivity, bay utilization, gross
profit percentage, comeback rate, effective labor rate, days of parts supply, and how
many days out you're booked.

## Difficulty

| | Starting cash | Debt | Reputation |
|---|---|---|---|
| Owner-Operator | $68,000 | none | 3.6 ★ |
| First Shop | $45,000 | $60,000 | 3.0 ★ |
| Turnaround | $22,000 | $95,000 | 2.2 ★ |

Everything is deterministic from the seed, so the same decisions on the same seed always
play out identically.

## Single-file build

```
node tools/build-single.js              # dist/shop-floor.html, one shareable file
node tools/build-single.js --fragment   # body-only, for hosts with their own shell
```

Inlines the stylesheet and all seven scripts into one HTML document. The only external
request is the Google Fonts stylesheet; the type stack degrades to a condensed system
face if that is blocked.

## Layout

```
index.html          markup shell
css/styles.css      all styling
js/rng.js           seeded RNG (mulberry32) with poisson/normal/weighted draws
js/data.js          catalogs: jobs, tools, training, upgrades, channels, events
js/state.js         state construction, staff generation, save/load, derived getters
js/sim.js           the day simulation
js/actions.js       everything the player can do between days
js/ui.js            rendering and interaction
js/main.js          bootstrap
tools/build-single.js  bundles everything into one HTML file
tests/sim.test.js   headless checks
```

## Tests

```
node tests/sim.test.js
```

Covers catalog integrity, determinism, 200-day stability across all three difficulties,
closed-day handling, the accounting identity, that price and advertising levers move the
numbers in the right direction, capacity limits, every player action, tooling gates,
save/load round trips, and that the balance lands in believable bands.
