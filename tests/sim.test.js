/*
 * Headless checks for the simulation. Run with: node tests/sim.test.js
 *
 * The browser build uses classic scripts sharing one global, so the test
 * loads the same files into a single vm context and drives the sim directly.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/rng.js', 'js/data.js', 'js/state.js', 'js/sim.js', 'js/actions.js'];

const store = {};
const sandbox = {
  console,
  Math,
  JSON,
  Date,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const NS = sandbox.AutoShop;

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}
function section(name) { console.log('\n' + name); }
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

/* ------------------------------------------------------------------ setup */

section('catalog integrity');
{
  const D = NS.DATA;
  const ids = new Set();
  D.JOBS.forEach((j) => {
    check('job id unique: ' + j.id, !ids.has(j.id));
    ids.add(j.id);
    check(j.id + ' has a season curve', !!D.SEASON[j.season], j.season);
    check(j.id + ' has positive book hours', j.bookHours > 0);
    check(j.id + ' has a known parts category',
      D.PART_CATEGORIES.some((c) => c.id === j.cat), j.cat);
    Object.keys(j.requires || {}).forEach((t) => {
      check(j.id + ' requires a real tool: ' + t, !!D.TOOLS[t]);
      check(j.id + ' requires an existing tool level: ' + t,
        j.requires[t] < D.TOOLS[t].levels.length);
    });
  });
  D.UPSELLS.forEach((id) => check('upsell " ' + id + '" is a real job', !!D.JOBS_BY_ID[id]));
  D.TECH_TRAINING.concat(D.WRITER_TRAINING).forEach((c) => {
    check('course has cost/days: ' + c.id, c.cost > 0 && c.days > 0);
  });
  D.WEATHER_TABLE.forEach((row, m) => {
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    check('weather probabilities sum to ~1 for month ' + m, Math.abs(sum - 1) < 0.001, sum);
    Object.keys(row).forEach((k) => check('weather id exists: ' + k, !!NS.DATA.WEATHER_BY_ID[k]));
  });
}

section('determinism');
{
  const a = NS.State.newGame({ seed: 'abc', difficulty: 'normal' });
  const b = NS.State.newGame({ seed: 'abc', difficulty: 'normal' });
  for (let i = 0; i < 40; i++) { NS.Sim.runDay(a); NS.Sim.runDay(b); }
  check('same seed produces same cash', Math.abs(a.cash - b.cash) < 1e-6, a.cash + ' vs ' + b.cash);
  check('same seed produces same reputation', Math.abs(a.reputation - b.reputation) < 1e-9);
  const c = NS.State.newGame({ seed: 'xyz', difficulty: 'normal' });
  for (let i = 0; i < 40; i++) NS.Sim.runDay(c);
  check('different seed diverges', Math.abs(a.cash - c.cash) > 0.01);
}

section('long run stability');
for (const diff of ['easy', 'normal', 'hard']) {
  const s = NS.State.newGame({ seed: 'run-' + diff, difficulty: diff });
  let sawOpenDay = false;
  let sawCompleted = false;
  for (let i = 0; i < 200; i++) {
    const r = NS.Sim.runDay(s);
    if (s.gameOver) break;
    if (r.open) sawOpenDay = true;
    if (r.shop.completed > 0) sawCompleted = true;
    check(diff + ' d' + r.day + ' cash finite', finite(s.cash), s.cash);
    check(diff + ' d' + r.day + ' revenue finite', finite(r.revenue.total), r.revenue.total);
    check(diff + ' d' + r.day + ' net finite', finite(r.profit.net), r.profit.net);
    check(diff + ' d' + r.day + ' reputation in range',
      s.reputation >= 1 && s.reputation <= 5, s.reputation);
    check(diff + ' d' + r.day + ' efficiency sane',
      r.shop.efficiency >= 0 && r.shop.efficiency < 3, r.shop.efficiency);
    check(diff + ' d' + r.day + ' inventory non-negative',
      NS.DATA.PART_CATEGORIES.every((c) => s.inventory[c.id] >= -1e-9));
    check(diff + ' d' + r.day + ' wip bounded', s.wip.length < 200, s.wip.length);
    check(diff + ' d' + r.day + ' netWorth finite', finite(NS.Sim.netWorth(s)));
  }
  check(diff + ': shop opened at least once', sawOpenDay);
  check(diff + ': cars got finished', sawCompleted);
  console.log('  ' + diff + ': day ' + s.day + ', cash $' + Math.round(s.cash) +
    ', rep ' + s.reputation.toFixed(2) + ', net worth $' + Math.round(NS.Sim.netWorth(s)) +
    (s.gameOver ? ' [GAME OVER: ' + s.gameOver.reason + ']' : ''));
}

section('closed days');
{
  const s = NS.State.newGame({ seed: 'sunday', difficulty: 'normal' });
  while (s.dow !== 6) NS.Sim.runDay(s);
  const r = NS.Sim.runDay(s);
  check('Sunday is closed', r.open === false);
  check('no revenue on a closed day', r.revenue.total === 0, r.revenue.total);
  check('rent still accrues', r.expenses.overhead > 0);
  check('no tech pay on a closed day', r.expenses.techPay === 0, r.expenses.techPay);
}

section('accounting identity');
{
  const s = NS.State.newGame({ seed: 'books', difficulty: 'normal' });
  for (let i = 0; i < 25; i++) {
    const before = s.cash;
    const beforeCredit = s.credit.balance;
    const r = NS.Sim.runDay(s);
    const cashCosts = r.expenses.techPay + r.expenses.writerPay + r.expenses.payrollTax +
      r.expenses.overhead + r.expenses.upkeep + r.expenses.marketing + r.expenses.bills +
      r.expenses.training + r.expenses.partsPurchased + r.expenses.tax;
    // Everything else that touches cash on a normal day is reported.
    const explained = r.revenue.collected - cashCosts;
    const actual = s.cash - before - (s.credit.balance - beforeCredit);
    const unexplained = actual - explained;
    // Receivables collections, loan payments and credit paydowns also move cash;
    // allow those but assert they are not wild.
    check('day ' + r.day + ' cash movement explained within tolerance',
      Math.abs(unexplained) < 20000, unexplained.toFixed(2));
    check('day ' + r.day + ' gross profit = revenue - parts',
      Math.abs(r.profit.gross - (r.revenue.total - r.cogs.parts)) < 1e-6);
  }
}

section('pricing responds to the lever');
{
  function run(rate, seed) {
    const s = NS.State.newGame({ seed: seed, difficulty: 'normal' });
    NS.Actions.setLaborRate(s, rate);
    let approved = 0;
    let quoted = 0;
    let revenue = 0;
    for (let i = 0; i < 60; i++) {
      const r = NS.Sim.runDay(s);
      approved += r.counter.approved;
      quoted += r.counter.quoted;
      revenue += r.revenue.total;
    }
    return { close: quoted ? approved / quoted : 0, revenue: revenue };
  }
  const cheap = run(85, 'price');
  const dear = run(240, 'price');
  check('a higher labor rate lowers the closing ratio',
    dear.close < cheap.close, cheap.close.toFixed(3) + ' -> ' + dear.close.toFixed(3));
}

section('advertising moves traffic');
{
  function traffic(spend, seed) {
    const s = NS.State.newGame({ seed: seed, difficulty: 'normal' });
    NS.Actions.setChannelSpend(s, 'lsa', spend);
    NS.Actions.setChannelSpend(s, 'ppc', spend);
    let opps = 0;
    for (let i = 0; i < 45; i++) opps += NS.Sim.runDay(s).counter.opportunities;
    return opps;
  }
  const none = traffic(0, 'ads');
  const lots = traffic(220, 'ads');
  check('ad spend increases opportunities', lots > none * 1.25, none + ' -> ' + lots);
}

section('capacity limits throughput');
{
  const s = NS.State.newGame({ seed: 'cap', difficulty: 'easy' });
  NS.Actions.setChannelSpend(s, 'lsa', 260);
  NS.Actions.setChannelSpend(s, 'ppc', 340);
  let maxBilled = 0;
  for (let i = 0; i < 60; i++) {
    const r = NS.Sim.runDay(s);
    if (r.open) maxBilled = Math.max(maxBilled, r.shop.techHoursUsed);
    check('tech hours never exceed the shift',
      r.shop.techHoursUsed <= r.shop.techHours + 0.001 ||
      s.policy.allowOvertime, r.shop.techHoursUsed + '/' + r.shop.techHours);
  }
  check('the shop actually got busy', maxBilled > 5, maxBilled);
}

section('player actions');
{
  const s = NS.State.newGame({ seed: 'acts', difficulty: 'easy' });
  check('order parts', NS.Actions.orderParts(s, { brakes: 800 }).ok);
  const cashBefore = s.cash;
  check('buy a lift', NS.Actions.upgradeTool(s, 'bay3', 'lift').ok);
  check('lift cost cash', s.cash < cashBefore);
  check('bay3 now has a lift', s.bays[2].tools.lift === 1);
  check('buy an upgrade', NS.Actions.buyUpgrade(s, 'dvi').ok);
  check('upgrade recorded', NS.State.upgradeTier(s, 'dvi') === 1);
  check('dvi upsell effect reaches the sim',
    NS.State.upgradeEffect(s, 'upsell') > 0);
  check('hire a tech', NS.Actions.hire(s, 'tech', s.candidates.techs[0].id).ok);
  const tech = s.techs[s.techs.length - 1];
  check('training starts', NS.Actions.startTraining(s, 'tech', tech.id, 'workflow').ok);
  check('tech is out of the bay', tech.trainingDaysLeft === 1);
  NS.Sim.runDay(s);
  check('training completed', tech.courses.indexOf('workflow') >= 0, tech.courses.join(','));
  check('cannot repeat a course',
    !NS.Actions.startTraining(s, 'tech', tech.id, 'workflow').ok);
  check('borrow works', NS.Actions.borrow(s, 5000).ok);
  check('repay works', NS.Actions.repayLoan(s, 5000).ok);
  check('build a bay', NS.Actions.buildBay(s).ok);
  check('bay count grew', s.bays.length === 4);
  check('add parking', NS.Actions.addParking(s, 2).ok);
  check('parking grew', s.parking.spaces === NS.DATA.CONFIG.startingParkingSpaces + 2);
}

section('tooling gates work');
{
  const s = NS.State.newGame({ seed: 'tools', difficulty: 'normal' });
  const align = NS.DATA.JOBS_BY_ID.alignment;
  check('no alignment rack means no alignments', !NS.Sim.shopCanDo(s, align));
  NS.Actions.upgradeTool(s, 'bay1', 'align');
  check('rack installed unlocks alignments', NS.Sim.shopCanDo(s, align));
  const bay = s.bays[0];
  const before = NS.Sim.bayToolSpeed(bay, NS.DATA.JOBS_BY_ID.oil_change);
  NS.Actions.upgradeTool(s, 'bay1', 'handtools');
  const after = NS.Sim.bayToolSpeed(bay, NS.DATA.JOBS_BY_ID.oil_change);
  check('better tools are faster', after > before, before + ' -> ' + after);
}

section('save / load round trip');
{
  const s = NS.State.newGame({ seed: 'save', difficulty: 'normal' });
  for (let i = 0; i < 12; i++) NS.Sim.runDay(s);
  check('save succeeds', NS.State.save(s));
  const loaded = NS.State.load();
  check('loaded state matches day', loaded.day === s.day);
  check('loaded state matches cash', Math.abs(loaded.cash - s.cash) < 1e-9);
  const r1 = NS.Sim.runDay(s);
  const r2 = NS.Sim.runDay(loaded);
  check('a loaded save replays identically',
    Math.abs(r1.revenue.total - r2.revenue.total) < 1e-9,
    r1.revenue.total + ' vs ' + r2.revenue.total);
}

section('balance sanity (normal, played passively)');
{
  const s = NS.State.newGame({ seed: 'balance', difficulty: 'normal' });
  NS.Actions.setLaborRate(s, 135);
  NS.Actions.setPartsMarkup(s, 0.55);
  NS.Actions.setChannelSpend(s, 'lsa', 90);
  for (let i = 0; i < 90; i++) {
    if (i % 5 === 0) NS.Actions.autoStock(s, 8);
    NS.Sim.runDay(s);
    if (s.gameOver) break;
  }
  const h = s.history.slice(-30);
  const rev = h.reduce((a, d) => a + d.revenue, 0) / h.length;
  const profit = h.reduce((a, d) => a + d.profit, 0) / h.length;
  console.log('  passive play: avg daily revenue $' + Math.round(rev) +
    ', avg daily net $' + Math.round(profit) +
    ', ARO $' + Math.round(s.stats.aro30) +
    ', close ' + Math.round(s.stats.closeRate30 * 100) + '%' +
    ', eff ' + Math.round(s.stats.efficiency30 * 100) + '%' +
    ', rep ' + s.reputation.toFixed(2) +
    ', cars/30d ' + s.stats.carCount30);
  check('a competently priced shop books real revenue', rev > 700, rev);
  check('ARO lands in a believable band',
    s.stats.aro30 > 120 && s.stats.aro30 < 1400, s.stats.aro30);
  check('closing ratio is believable',
    s.stats.closeRate30 > 0.25 && s.stats.closeRate30 < 0.98, s.stats.closeRate30);
  check('gross margin is believable',
    s.stats.gpPct30 > 0.3 && s.stats.gpPct30 < 0.95, s.stats.gpPct30);
}

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ': ' + (checks - failures) +
  '/' + checks + ' checks passed.');
process.exit(failures === 0 ? 0 : 1);
