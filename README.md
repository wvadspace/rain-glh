# Torque & Tally — Auto Repair Shop Simulator

A day-by-day business simulation of running an independent auto repair shop. You inherit
three bays, two technicians, one service writer, eight parking spaces and a bank loan, and
you decide every morning what to charge, what to buy, who to hire, who to train and how
much traffic to go out and purchase.

Open `index.html` in any browser. No build step, no dependencies, no server.

## The loop

Each day you set your levers, click **Open the Shop**, and the simulation runs:

1. Marketing awareness converts into leads, blended with organic traffic and your repeat
   customer list.
2. Customers who cannot park leave permanently. Jobs you are not equipped or certified for
   get refused.
3. Service writers convert what is left into estimates, then look for additional work.
4. The dispatcher assigns each line to a bay that carries the right tools and a technician
   who holds the right certification.
5. Cars are invoiced, satisfaction is scored, comebacks are scheduled, and the books close.

You then get a day report showing the whole funnel — who called, who was turned away, who
declined, what sold, what shipped and what it earned.

## What you control

| Lever | What it does |
| --- | --- |
| **Labor rate** | You bill flat-rate book time, not clock hours. A faster technician bills the same hours in less time. |
| **Parts matrix** | Markup on parts cost. Customers do compare parts prices. |
| **Diagnostic fee** | Charge nothing and you give away your most skilled labor. |
| **Oil change price** | The classic loss leader — cheap oil changes buy inspections, and inspections find the real work. |
| **Advertising** | Eight channels with different cost per lead, saturation, response lag and traffic quality. |
| **Bays** | Each additional bay costs more and carries rent. |
| **Tools** | Five levels per bay. Higher levels are faster and produce fewer comebacks. |
| **Equipment** | Tire changer, alignment rack, scan tool, A/C machine, heavy-duty lift, ADAS targets, EV package. Installed *per bay*. |
| **Parking** | Cars you cannot park are customers who go somewhere else. |
| **Technicians** | Five skill levels and seven certifications. Certifications decide what you may sell; level decides speed and comeback rate. |
| **Service writers** | Four levels plus six advanced sales courses covering phone skills, menu presentation, digital inspection selling, objection handling, declined-work follow-up and commercial selling. |
| **Shop investments** | DVI software, online scheduling, shuttle and loaners, lounge remodel, express lube lane, parts room, training room, tow truck. |
| **Dispatch policy** | Promise-time, gross-profit, or first-in-first-out. |
| **Overtime, stocking levels, borrowing** | Capacity, parts availability and cash flow. |

## How the model behaves

Some deliberate design choices, all of which show up in play:

- **Repairs are non-discretionary.** Demand is fairly inelastic near the market rate, so a
  premium usually pays — until you are far enough over market that customers feel gouged,
  at which point reviews turn and the loss compounds through reputation.
- **A job runs in one bay.** Equipment split across two bays does not combine. An alignment
  rack in Bay 2 does not help the ADAS targets in Bay 1.
- **Certifications gate revenue.** Sold work with no certified technician available sits on
  the lot aging, which is usually the real reason a shop's numbers collapse.
- **Advertising channels differ in kind, not just price.** Search ads land tomorrow and stop
  when you stop paying. Radio and direct mail take weeks to build and keep working after you
  stop. Buying traffic you have no capacity to serve destroys money and reputation at once.
- **Retention is the whole business.** Most of your car count comes from customers you
  already served. Turning someone away or handing back a comeback removes them from that list.
- **Overhead is real.** Rent, utilities, insurance, software, waste disposal, accounting and
  an owner's draw are charged whether or not a car comes in.

The **Dashboard** names your single binding constraint each day — parking, bays,
technician hours, a specific certification, a missing tool, or the front counter — and tells
you where the next dollar belongs.

## Winning

Reach $2,000,000 in net worth. A well-run shop gets there in roughly two to three in-game
years by growing to seven or eight bays. Let the line of credit reach $180,000 and the bank
closes you down.

## Files

```
index.html      page shell
styles.css      dark shop-management theme
js/rng.js       seeded RNG — the same seed replays the same year
js/data.js      job menu, certifications, equipment, staff tiers, ad channels, events
js/engine.js    the simulation; no DOM access, so it can be run headless
js/ui.js        rendering
js/main.js      wiring, autosave to localStorage
```

Progress autosaves after every day. Entering the same seed on a new game replays identical
weather, walk-ins and breakdowns, so you can test a different strategy against the same year.
