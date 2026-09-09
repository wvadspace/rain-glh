/*
 * Torque & Turnover — the service manager who tells you what a normal
 * number looks like.
 *
 * Every morning decision gets a recommended value and one plain sentence
 * saying why, so somebody who has never run a shop can accept their way
 * through the day and still be roughly right. None of this is required to
 * play; it is a default, not a rail.
 */
(function (root) {
  'use strict';

  var D = root.AutoShopData || (typeof require === 'function' ? require('./data.js') : null);
  var E = root.AutoShopEngine || (typeof require === 'function' ? require('./engine.js') : null);

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function money(v) { return E.fmtMoney(v); }

  /* Averages over the last n recorded days. */
  function recent(state, key, n) {
    var h = state.history.slice(-(n || 14));
    if (!h.length) return 0;
    var sum = 0;
    h.forEach(function (d) { sum += (d[key] || 0); });
    return sum / h.length;
  }

  /* ------------------------------------------------------------------ *
   * Pricing
   * ------------------------------------------------------------------ */
  function prices(state) {
    var tol = E.priceTolerance(state);
    var rep = state.reputation;

    // Aim just under what your customers will tolerate.
    var target = tol - 0.02;
    if (rep < 4.0) target = Math.min(target, 1.0);        // unproven shops price at market
    if (rep < 3.4) target = Math.min(target, 0.94);       // or a little under it

    var markup = rep >= 4.4 ? 1.95 : D.TOWN.marketPartsMarkup;
    var diagLevel = Math.max.apply(null, state.bays.map(function (b) {
      return b.type === 'diag' ? b.toolLevel : 0;
    }).concat([0]));
    var diag = Math.round((D.TOWN.marketDiagFee * (1 + diagLevel * 0.06)) / 5) * 5;

    // Solve the price index back to a door rate, holding the other two at
    // their recommendations. Index = .58·labor + .32·parts + .10·diag.
    var partsPart = 0.32 * (markup / D.TOWN.marketPartsMarkup);
    var diagPart = 0.10 * (diag / D.TOWN.marketDiagFee);
    var labor = D.TOWN.marketLaborRate * (target - partsPart - diagPart) / 0.58;
    labor = clamp(Math.round(labor / 5) * 5, 110, 260);

    var util = state.stats.bayUtilization;
    var idle = util > 0 && util < 0.45 && E.carsOnSite(state) < state.parking * 0.6;
    var coupon = idle ? 10 : 0;

    var objLevel = E.advisorAvg(state, 'objection');
    return {
      laborRate: {
        value: labor,
        why: labor > D.TOWN.marketLaborRate
          ? 'Market is ' + money(D.TOWN.marketLaborRate) + '/hr. Your rating and objection-handling ' +
            'training support charging above it.'
          : labor < D.TOWN.marketLaborRate
            ? 'Market is ' + money(D.TOWN.marketLaborRate) + '/hr, but at a ' + rep.toFixed(1) +
              ' rating you have not earned it yet. Price under the market until the reviews catch up.'
            : 'Right at the market rate of ' + money(D.TOWN.marketLaborRate) + '/hr. ' +
              (objLevel < 1 ? 'Objection-handling training is what lets you go higher.' : '')
      },
      partsMarkup: {
        value: markup,
        why: markup > D.TOWN.marketPartsMarkup
          ? 'A ' + rep.toFixed(1) + ' rating buys you a little more room on parts.'
          : 'The standard matrix. Cheap parts still carry a fat markup, expensive ones a thin one.'
      },
      diagFee: {
        value: diag,
        why: diagLevel >= 2
          ? 'Your scan tooling is worth more than the going rate of ' + money(D.TOWN.marketDiagFee) + '.'
          : 'The going rate in town. Charging nothing for diagnosis trains customers to expect it free.'
      },
      coupon: {
        value: coupon,
        why: coupon
          ? 'Your bays ran ' + Math.round(util * 100) + '% full. A discount buys volume you have room for.'
          : 'No discount. You have all the work you can handle — a coupon would just cost margin.'
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Advertising
   *
   * Budget is a share of expected sales, then allocated greedily to
   * whichever channel returns the most gross profit for the next $5.
   * ------------------------------------------------------------------ */
  var AD_LEVELS = {
    off: { key: 'off', name: 'Paused', pct: 0, note: 'Coast on reputation and repeat customers.' },
    lean: { key: 'lean', name: 'Lean', pct: 0.04, note: 'About 4% of sales. Keeps the phone warm.' },
    standard: { key: 'standard', name: 'Standard', pct: 0.07, note: 'About 7% of sales. What a healthy shop spends.' },
    grow: { key: 'grow', name: 'Growth', pct: 0.11, note: 'About 11% of sales. Buy share; watch your capacity.' }
  };

  /* Extra leads the next dollar in this channel would buy. */
  function marginalValue(state, ch, spend) {
    var maxLeads = ch.maxLeads;
    if (ch.key === 'referral') maxLeads *= clamp(0.35 + state.customerBase / 320, 0.35, 2.2);
    if (ch.key === 'seo') maxLeads *= clamp(0.7 + state.reputation / 10, 0.7, 1.25);
    var slope = (maxLeads / ch.halfSpend) * Math.exp(-spend / ch.halfSpend);
    var aro = state.stats.aro30 || 460;
    return slope * E.estimateCloseRate(state, ch.intent) * aro * ch.aro * 0.5;
  }

  function ads(state, levelKey) {
    var level = AD_LEVELS[levelKey] || AD_LEVELS.standard;
    var f = E.forecast(state);
    var expectedSales = Math.max(
      state.stats.revenue30 / 30,
      f.opportunities * E.estimateCloseRate(state, 1) * (state.stats.aro30 || 460)
    );
    var budget = Math.round(expectedSales * level.pct / 5) * 5;

    var spend = {};
    D.AD_CHANNELS.forEach(function (c) { spend[c.key] = 0; });

    /* Hand out the budget $5 at a time to whichever channel pays best next. */
    function allocate(amount, eligible) {
      var left = amount, guard = 0;
      while (left >= 5 && guard++ < 600) {
        var best = null, bestVal = 0;
        D.AD_CHANNELS.forEach(function (c) {
          if (eligible && !eligible(c)) return;
          if (spend[c.key] >= c.halfSpend * 2.2) return;
          var v = marginalValue(state, c, spend[c.key]);
          if (v > bestVal) { bestVal = v; best = c; }
        });
        if (!best) break;
        spend[best.key] += 5;
        left -= 5;
      }
      return left;
    }

    var left = allocate(budget, null);

    /*
     * A budget under a channel's minimum buys literally nothing, so sweep
     * those up and put the money back to work in the channels that cleared
     * their minimum. A small budget should fund one or two channels properly
     * rather than seven channels uselessly.
     */
    for (var pass = 0; pass < 4; pass++) {
      var freed = 0;
      D.AD_CHANNELS.forEach(function (c) {
        if (spend[c.key] > 0 && spend[c.key] < c.minSpend) {
          freed += spend[c.key];
          spend[c.key] = 0;
        }
      });
      if (!freed) break;
      left = allocate(freed + left, function (c) { return spend[c.key] >= c.minSpend; }) ;
    }
    if (left >= 5) {
      // Nothing cleared a minimum yet — back the single best channel outright.
      var pick = null, pickVal = 0;
      D.AD_CHANNELS.forEach(function (c) {
        if (c.minSpend > left + spend[c.key]) return;
        var v = marginalValue(state, c, spend[c.key]);
        if (v > pickVal) { pickVal = v; pick = c; }
      });
      if (pick) { spend[pick.key] += left; left = 0; }
    }

    var out = { total: 0, level: level, budget: budget, channels: {} };
    D.AD_CHANNELS.forEach(function (c) {
      out.total += spend[c.key];
      out.channels[c.key] = {
        value: spend[c.key],
        why: spend[c.key] === 0
          ? 'Your money works harder in another channel right now.'
          : (c.lag >= 4
            ? 'Slow burn — it will not show up for ' + c.lag + ' days, then it compounds.'
            : c.intent >= 1.1
              ? 'Highest-intent traffic you can buy today.'
              : 'Cheap reach to keep your name in front of the town.')
      };
    });
    out.why = level.pct === 0
      ? 'Nothing budgeted. Reputation and repeat customers carry the day.'
      : money(budget) + '/day is about ' + Math.round(level.pct * 100) +
        '% of expected sales, weighted toward whichever channel returns the most per dollar today.';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Technician scheduling
   * ------------------------------------------------------------------ */
  function schedule(state) {
    var f = E.forecast(state);
    var wip = 0;
    state.openROs.forEach(function (ro) {
      ro.jobs.forEach(function (j) { if (!j.done) wip += j.remaining; });
    });
    var expectedCars = Math.min(f.opportunities, f.advisorCapacity) * E.estimateCloseRate(state, 1);
    var expectedBook = expectedCars * 1.35;
    var needBook = wip + expectedBook;

    var available = state.techs.filter(function (t) { return t.trainingUntil <= state.day; });
    var avgRate = 1;
    if (available.length) {
      var sum = 0;
      available.forEach(function (t) { sum += t.efficiency; });
      avgRate = sum / available.length;
    }
    var needClock = needBook / Math.max(0.5, avgRate);
    var perTech = available.length ? needClock / available.length : 0;
    var hours = clamp(Math.ceil(perTech), 4, E.shiftHours(state));

    return {
      value: hours,
      needBook: needBook,
      wip: wip,
      expectedBook: expectedBook,
      why: available.length === 0
        ? 'Nobody is available — every technician you have is in training today.'
        : Math.round(wip) + ' book hours already on the lot plus about ' + Math.round(expectedBook) +
          ' expected in. Across ' + available.length + ' technician(s) that is roughly ' +
          hours + ' hours each. Scheduling under it leaves work sitting; over it just pays the ' +
          'guarantee for an empty bay.'
    };
  }

  /* ------------------------------------------------------------------ *
   * Parts
   * ------------------------------------------------------------------ */
  function parts(state, days) {
    var rows = E.suggestOrder(state, days || 7);
    var prog = D.ORDER_PROGRAMS[state.orderProgram];
    var cost = 0;
    rows.forEach(function (r) {
      r.cost = r.order * E.unitCostFor(state, r.cat) * prog.costMult;
      cost += r.cost;
      r.why = r.order === 0
        ? 'You have enough on the shelf.'
        : r.have === 0
          ? 'You are out. Any job needing these pays a ' +
            Math.round((D.HOTSHOT_MULT - 1) * 100) + '% hot-shot premium.'
          : 'Covers about ' + (days || 7) + ' days at your current pace.';
    });
    return {
      rows: rows, total: cost,
      why: 'Sized to ' + (days || 7) + ' days of expected demand with a cushion for upsells. ' +
        'Arrives in ' + prog.days + ' day(s) on your ' + prog.name.toLowerCase().replace(/ \(.*\)/, '') + '.'
    };
  }

  /* ------------------------------------------------------------------ *
   * What to fix next — ranked by what is actually costing you money.
   * ------------------------------------------------------------------ */
  function priorities(state) {
    var out = [];
    var f = E.forecast(state);
    var aro = state.stats.aro30 || 460;
    var days = Math.min(14, state.history.length) || 1;

    var lostCall = recent(state, 'lostCall', 14);
    var lostPark = recent(state, 'lostPark', 14);
    var lostCap = recent(state, 'lostCap', 14);
    var comebacks = recent(state, 'comebacks', 14);

    if (lostCall >= 1) {
      out.push({
        key: 'advisor', severity: lostCall * aro * 0.55,
        title: 'Calls are going to voicemail',
        detail: Math.round(lostCall * 10) / 10 + ' a day, worth roughly ' +
          money(lostCall * aro * 0.55) + ' of gross profit you never got to bid on.',
        fix: 'Hire a second service advisor, buy Phone Skills training, or install shop management software.',
        goto: 'crew'
      });
    }
    if (lostPark >= 1) {
      out.push({
        key: 'parking', severity: lostPark * aro * 0.55,
        title: 'The lot is full',
        detail: Math.round(lostPark * 10) / 10 + ' cars a day turned away because there was nowhere ' +
          'to put them.',
        fix: 'Pave more parking — or add production so cars leave faster instead of stacking up.',
        goto: 'upgrades'
      });
    }
    if (f.coverage < 0.85) {
      out.push({
        key: 'coverage', severity: (1 - f.coverage) * 1400 + lostCap * aro * 0.5,
        title: 'Your service menu has holes in it',
        detail: 'You can perform ' + Math.round(f.coverage * 100) + '% of the work this town needs, ' +
          'which holds your incoming calls to ' + Math.round(f.coverageMult * 100) + '% of what they could be.',
        fix: 'Tooling upgrades and certifications open up job types. Diagnostics and A/C are usually the ' +
          'fastest payback.',
        goto: 'floor'
      });
    }
    if (state.stats.bayUtilization > 0.88) {
      out.push({
        key: 'bays', severity: 900,
        title: 'Your bays are maxed out',
        detail: 'Bays ran ' + Math.round(state.stats.bayUtilization * 100) + '% full. More sales will ' +
          'just stretch turnaround and cost you stars.',
        fix: 'Build another bay, or add a technician to a bay that is standing empty part of the day.',
        goto: 'floor'
      });
    }
    if (state.stats.bayUtilization > 0 && state.stats.bayUtilization < 0.45) {
      out.push({
        key: 'demand', severity: 700,
        title: 'You are paying for bays nobody is filling',
        detail: 'Bays ran only ' + Math.round(state.stats.bayUtilization * 100) + '% full. Technicians ' +
          'still draw their guarantee.',
        fix: 'Put money behind advertising, or run a coupon to buy volume you have the capacity to absorb.',
        goto: 'marketing'
      });
    }
    if (comebacks >= 0.5) {
      out.push({
        key: 'quality', severity: comebacks * 420,
        title: 'Cars are coming back',
        detail: Math.round(comebacks * 10) / 10 + ' a day. Comebacks are labor you already paid for, ' +
          'done again for free, in front of an angry customer.',
        fix: 'Quality training, better tooling in the bay doing the work, or step up from economy parts.',
        goto: 'crew'
      });
    }
    if (state.reputation < 3.9 && state.reviewCount > 10) {
      out.push({
        key: 'rep', severity: (4.3 - state.reputation) * 1600,
        title: 'Your rating is holding back every other lever',
        detail: 'At ' + state.reputation.toFixed(2) + ' stars your traffic multiplier is ' +
          f.repMult.toFixed(2) + '×. At 4.5 it would be about ' +
          (0.40 + (4.5 - 2.5) * 0.36).toFixed(2) + '×.',
        fix: 'Shorten turnaround, stop over-selling past your capacity, and buy CSI training for the counter.',
        goto: 'crew'
      });
    }
    if (state.cash < 8000) {
      out.push({
        key: 'cash', severity: 2000,
        title: 'Cash is thin',
        detail: money(state.cash) + ' on hand against roughly ' + money(E.dailyFixedCost(state)) +
          ' a day of fixed cost before anybody gets paid.',
        fix: 'Trim advertising, hold off on parts orders beyond a few days, and do not start construction.',
        goto: 'upgrades'
      });
    }
    if (E.priceIndex(state) < E.priceTolerance(state) - 0.10) {
      out.push({
        key: 'underpriced', severity: 800,
        title: 'You are priced below what this town will pay',
        detail: 'Your price index is ' + E.priceIndex(state).toFixed(2) + ' against a tolerance of ' +
          E.priceTolerance(state).toFixed(2) + '. Rate increases are almost pure profit.',
        fix: 'Raise the door rate toward the recommendation on the pricing step.',
        goto: 'price'
      });
    }

    out.sort(function (a, b) { return b.severity - a.severity; });
    return out;
  }

  /* One-line coaching for the top of the morning page. */
  function headline(state) {
    var p = priorities(state);
    if (!p.length) {
      return {
        title: 'Nothing is obviously broken',
        detail: 'No leak is costing you real money today. Push on whichever lever you want to grow.'
      };
    }
    return { title: p[0].title, detail: p[0].detail + ' ' + p[0].fix, goto: p[0].goto };
  }

  var ADVICE = {
    prices: prices,
    ads: ads,
    AD_LEVELS: AD_LEVELS,
    schedule: schedule,
    parts: parts,
    priorities: priorities,
    headline: headline,
    recent: recent
  };

  root.AutoShopAdvice = ADVICE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ADVICE;
})(typeof window !== 'undefined' ? window : globalThis);
