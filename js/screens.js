/*
 * Torque & Turnover — the day, in three acts.
 *
 *   Morning   plan the day, with a recommended value beside every input
 *   Day       watch it play out on the shop clock, 7am to close
 *   Evening   read the outcome and make the decisions it forces
 *
 * The eight detail screens still exist, demoted to an Office you drill into
 * from whichever morning step raised the question.
 */
(function (root) {
  'use strict';

  var D = root.AutoShopData;
  var E = root.AutoShopEngine;
  var A = root.AutoShopAdvice;

  var S = {};                 // this module
  var UI = null;              // resolved at boot, once ui.js has registered
  var h = null;               // shared render helpers

  var STEPS = [
    { key: 'brief', name: 'Brief', blurb: 'What happened, and what today looks like.' },
    { key: 'price', name: 'Pricing', blurb: 'What you charge for an hour and for a part.' },
    { key: 'ads', name: 'Advertising', blurb: 'How many cars come looking for you.' },
    { key: 'parts', name: 'Parts', blurb: 'What is on the shelf when the work sells.' },
    { key: 'crew', name: 'Crew', blurb: 'Who is here and for how long.' },
    { key: 'open', name: 'Open Up', blurb: 'Check the plan and unlock the door.' }
  ];

  /* ---------------------------------------------------------------- *
   * Small shared pieces
   * ---------------------------------------------------------------- */

  /* The recommendation chip that sits beside an input. */
  function rec(text, why, action, applied) {
    return '<div class="rec' + (applied ? ' applied' : '') + '">' +
      '<div class="rec-head"><span class="rec-tag">Recommended</span>' +
      '<b>' + text + '</b>' +
      (action && !applied ? '<button class="btn sm" ' + action + '>Use it</button>'
        : applied ? '<span class="tag ok">Set</span>' : '') +
      '</div>' +
      (why ? '<p class="rec-why">' + h.esc(why) + '</p>' : '') +
      '</div>';
  }

  function stepRail(state) {
    return '<ol class="steprail">' + STEPS.map(function (st, i) {
      var cls = i === state.step ? 'now' : i < state.step ? 'done' : '';
      return '<li class="' + cls + '"><button data-act="gostep" data-step="' + i + '">' +
        '<span class="n">' + (i < state.step ? '✓' : i + 1) + '</span>' +
        '<span class="t">' + st.name + '</span>' +
        '<span class="b">' + st.blurb + '</span></button></li>';
    }).join('') + '</ol>';
  }

  function stepNav(state) {
    var last = state.step >= STEPS.length - 1;
    return '<div class="stepnav">' +
      (state.step > 0
        ? '<button class="btn ghost" data-act="prevstep">← ' + STEPS[state.step - 1].name + '</button>'
        : '<span></span>') +
      (last
        ? '<button class="btn primary" data-act="openshop">Open The Shop →</button>'
        : '<button class="btn primary" data-act="nextstep">' + STEPS[state.step + 1].name + ' →</button>') +
      '</div>';
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 1: the brief
   * ---------------------------------------------------------------- */
  function stepBrief(state) {
    var f = E.forecast(state);
    var head = A.headline(state);
    var last = UI.lastResult;
    var html = '';

    html += '<div class="panel hero">' +
      '<div class="hero-date">' + f.cal.dayName + ' · ' + f.cal.monthName + ' ' + f.cal.date +
        ' · ' + f.cal.season + '</div>' +
      '<h2 class="hero-h">' + (f.cal.dow === 5 ? 'Saturday — half day, full overhead'
        : f.cal.dow === 0 ? 'Monday. The weekend&rsquo;s breakdowns are calling.'
          : 'Day ' + state.day + ' at the shop') + '</h2>' +
      '<div class="grid g3" style="margin-top:12px">' +
        h.tile('Cash on hand', h.money(state.cash), state.debt ? h.money(state.debt) + ' drawn on credit' : 'no debt',
          state.cash < 6000 ? 'bad' : '') +
        h.tile('Expected calls', h.num(f.opportunities, 0),
          'advisors can handle ' + h.num(f.advisorCapacity, 0)) +
        h.tile('Cars on the lot', E.carsOnSite(state) + ' / ' + state.parking,
          state.openROs.length ? 'carried over from yesterday' : 'empty and ready') +
      '</div></div>';

    if (last && !last.closed) {
      html += '<div class="panel"><h2>Yesterday</h2><div class="grid g3">' +
        h.tile('Cars delivered', last.cars, h.money(last.revenue) + ' in sales') +
        h.tile('Net profit', h.money(last.net), last.net >= 0 ? 'in the black' : 'in the red',
          last.net >= 0 ? 'good' : 'bad') +
        h.tile('Closing ratio', last.presented ? h.pct(last.won / last.presented) : '—',
          last.won + ' of ' + last.presented + ' presented') +
        '</div></div>';
    }

    html += '<div class="panel coach"><h2>What needs your attention</h2>' +
      '<div class="coach-head">' + h.esc(head.title) + '</div>' +
      '<p class="coach-body">' + h.esc(head.detail) + '</p>' +
      (head.goto ? '<button class="btn sm" data-act="office" data-tab="' + head.goto +
        '">Open the ' + officeName(head.goto) + ' screen</button>' : '') +
      '</div>';

    var pri = A.priorities(state).slice(1, 4);
    if (pri.length) {
      html += '<div class="panel"><h2>Also worth knowing</h2>' +
        pri.map(function (p) {
          return '<div class="issue"><b>' + h.esc(p.title) + '</b>' +
            '<p>' + h.esc(p.detail) + '</p>' +
            '<p class="fix">' + h.esc(p.fix) + '</p>' +
            '<button class="btn sm ghost" data-act="office" data-tab="' + p.goto + '">' +
            officeName(p.goto) + ' →</button></div>';
        }).join('') + '</div>';
    }

    html += '<div class="panel"><h2>Today&rsquo;s demand</h2>' +
      '<p class="sub">Multipliers stack. A rainy Monday in November is not the same shop as a ' +
      'Saturday in July.</p>' +
      '<table>' +
      '<tr><td>Day of week</td><td class="num">' + h.num(f.dowMult, 2) + '×</td></tr>' +
      '<tr><td>Season (' + f.cal.season + ')</td><td class="num">' + h.num(f.monthMult, 2) + '×</td></tr>' +
      '<tr><td>Your reputation (' + state.reputation.toFixed(2) + ' stars)</td><td class="num">' +
        h.num(f.repMult, 2) + '×</td></tr>' +
      '<tr><td>Service menu coverage (' + h.pct(f.coverage) + ' of jobs)</td><td class="num">' +
        h.num(f.coverageMult, 2) + '×</td></tr>' +
      (Math.abs(f.eventMult - 1) > 0.01
        ? '<tr><td>Active events</td><td class="num">' + h.num(f.eventMult, 2) + '×</td></tr>' : '') +
      '</table></div>';

    return html;
  }

  function officeName(key) {
    return ({ dash: 'Dashboard', floor: 'Shop Floor', crew: 'Crew', parts: 'Parts Room',
      price: 'Pricing', marketing: 'Marketing', upgrades: 'Facility', books: 'Books' })[key] || key;
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 2: pricing
   * ---------------------------------------------------------------- */
  function stepPrice(state) {
    var r = A.prices(state);
    var pi = E.priceIndex(state), tol = E.priceTolerance(state);
    var over = pi - tol;

    function row(label, key, min, max, step, fmt, r1) {
      var cur = state.prices[key];
      return '<div class="card decision">' +
        '<label class="field"><span class="lab">' + label + ' <b>' + fmt(cur) + '</b></span>' +
        '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + cur +
        '" data-act="price" data-key="' + key + '">' +
        '<input type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + cur +
        '" data-act="price" data-key="' + key + '" style="margin-top:6px"></label>' +
        rec(fmt(r1.value), r1.why,
          'data-act="applyprice" data-key="' + key + '" data-value="' + r1.value + '"',
          Math.abs(cur - r1.value) < (key === 'partsMarkup' ? 0.03 : 0.51)) +
        '</div>';
    }

    return '<div class="panel"><h2>Pricing</h2>' +
      '<p class="sub">Every point of door rate is close to pure profit — and every point above what ' +
      'this town tolerates costs you closing ratio and stars. The market charges ' +
      h.money(D.TOWN.marketLaborRate) + '/hr and marks parts up ' +
      h.num(D.TOWN.marketPartsMarkup, 2) + '×.</p>' +
      '<div class="grid g2">' +
        row('Door rate per billed hour', 'laborRate', 90, 260, 5,
          function (v) { return h.money(v) + '/hr'; }, r.laborRate) +
        row('Parts markup (matrix base)', 'partsMarkup', 1.2, 2.8, 0.05,
          function (v) { return h.num(v, 2) + '×'; }, r.partsMarkup) +
        row('Diagnostic fee', 'diagFee', 0, 320, 5, h.money, r.diagFee) +
        row('Coupon / discount', 'coupon', 0, 40, 1,
          function (v) { return v + '% off'; }, r.coupon) +
      '</div>' +
      '<div class="alert ' + (over > 0.12 ? 'bad' : over > 0.03 ? '' : over > -0.06 ? 'good' : '') +
        '" style="margin-top:12px"><b>Price index ' + h.num(pi, 2) + '</b> against a customer ' +
        'tolerance of ' + h.num(tol, 2) + '. ' +
        (over > 0.12 ? 'Well above what this town will bear. Expect walkouts.'
          : over > 0.03 ? 'A little rich. You are losing some price shoppers.'
            : over > -0.06 ? 'Priced right in the pocket.'
              : 'Money on the table. Raising the rate is almost pure profit.') + '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn" data-act="applyallprice">Use every recommendation on this step</button>' +
        '<button class="btn ghost sm" data-act="office" data-tab="price">Margin math &amp; example tickets →</button>' +
      '</div></div>';
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 3: advertising
   * ---------------------------------------------------------------- */
  function stepAds(state) {
    var current = Object.keys(state.adSpend).reduce(function (a, k) { return a + state.adSpend[k]; }, 0);
    var level = UI.adLevel || 'standard';
    var r = A.ads(state, level);
    var f = E.forecast(state);

    var html = '<div class="panel"><h2>Advertising</h2>' +
      '<p class="sub">Pick a spending posture and the budget gets split across channels by whichever ' +
      'returns the most for the next dollar. Adjust any channel afterward.</p>' +
      '<div class="levels">' + Object.keys(A.AD_LEVELS).map(function (k) {
        var L = A.AD_LEVELS[k];
        return '<button class="level' + (k === level ? ' on' : '') + '" data-act="adlevel" data-level="' + k + '">' +
          '<b>' + L.name + '</b><span>' + Math.round(L.pct * 100) + '% of sales</span>' +
          '<em>' + h.esc(L.note) + '</em></button>';
      }).join('') + '</div>' +
      rec(h.money(r.total) + '/day total', r.why, 'data-act="applyads"',
        Math.abs(current - r.total) < 6) +
      '</div>';

    html += '<div class="panel"><h2>By Channel</h2><div class="grid g2">' +
      D.AD_CHANNELS.map(function (c) {
        var spend = state.adSpend[c.key] || 0;
        var leads = E.channelLeads(state, c) * f.coverageMult;
        var rc = r.channels[c.key];
        return '<div class="card decision">' +
          '<div class="spread"><h3>' + h.esc(c.name) + '</h3>' +
            '<span class="tag ' + (c.lag > 2 ? 'warn' : 'info') + '">' +
            (c.lag ? c.lag + '-day lag' : 'same day') + '</span></div>' +
          '<div class="note">' + h.esc(c.note) + '</div>' +
          '<label class="field"><span class="lab">Daily budget <b>' + h.money(spend) + '</b></span>' +
            '<input type="range" min="0" max="' + Math.round(c.halfSpend * 4) + '" step="5" value="' + spend +
            '" data-act="ad" data-key="' + c.key + '"></label>' +
          '<div class="small muted">Expected calls per normal day: <b class="money">' +
            h.num(leads, 1) + '</b> · lead quality ' + h.num(c.intent, 2) + '× close</div>' +
          rec(h.money(rc.value) + '/day', rc.why,
            'data-act="applyad" data-key="' + c.key + '" data-value="' + rc.value + '"',
            spend === rc.value) +
          '</div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn" data-act="applyads">Apply the whole recommended budget</button>' +
        '<button class="btn ghost sm" data-act="office" data-tab="marketing">Channel performance detail →</button>' +
      '</div></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 4: parts
   * ---------------------------------------------------------------- */
  function stepParts(state) {
    var r = A.parts(state, 7);
    var used = E.storageUsed(state);
    var prog = D.ORDER_PROGRAMS[state.orderProgram];

    var html = '<div class="panel"><h2>Parts</h2>' +
      '<p class="sub">Work you sold and cannot start is a car sitting in a parking space with an ' +
      'unhappy owner. The recommended column covers seven days at your current pace, with a cushion ' +
      'for upsells.</p>' +
      '<table><tr><th>Category</th><th class="num">On Hand</th>' +
      '<th class="num col-secondary">Inbound</th>' +
      '<th class="num">Recommended</th><th class="num col-secondary">Cost</th>' +
      '<th class="col-why">Why</th><th class="num">Order</th></tr>' +
      r.rows.map(function (row) {
        var cat = D.partByKey[row.cat];
        var low = row.have + row.coming < row.want * 0.5;
        return '<tr><td><div>' + h.esc(cat.name) + '</div>' +
          '<div class="small muted">' + h.esc(cat.note) + '</div>' +
          '<div class="small muted whyfold">' + h.esc(row.why) +
            (row.cost ? ' · ' + h.money(row.cost) : '') + '</div></td>' +
          '<td class="num ' + (low ? 'neg' : '') + '">' + row.have + '</td>' +
          '<td class="num muted col-secondary">' + (row.coming || '—') + '</td>' +
          '<td class="num"><b>' + row.order + '</b></td>' +
          '<td class="num col-secondary">' + (row.cost ? h.money(row.cost) : '—') + '</td>' +
          '<td class="small muted col-why">' + h.esc(row.why) + '</td>' +
          '<td class="num"><input type="number" min="0" step="1" value="' + row.order +
            '" data-role="qty" data-cat="' + row.cat + '" style="width:70px"></td></tr>';
      }).join('') + '</table>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn primary" data-act="orderall">Order everything recommended · ' +
          h.money(r.total) + '</button>' +
        '<span class="small muted">Cash after: ' + h.money(state.cash - r.total) + ' · arrives day ' +
          (state.day + prog.days) + '</span>' +
      '</div>' +
      '<div class="spread" style="margin-top:14px"><span class="small muted">Parts room storage</span>' +
        '<span class="money small">' + h.num(used, 0) + ' / ' + state.storage + ' units</span></div>' +
        h.bar(used / state.storage, used / state.storage > 0.9 ? 'bad' : '') +
      '</div>';

    if (state.onOrder.length) {
      html += '<div class="panel"><h2>Already On The Way</h2><table>' +
        '<tr><th>Category</th><th class="num">Units</th><th class="num">Arrives</th></tr>' +
        state.onOrder.map(function (o) {
          return '<tr><td>' + h.esc(D.partByKey[o.cat].name) + '</td><td class="num">' + o.units +
            '</td><td class="num">Day ' + o.arriveDay + ' (' +
            Math.max(0, o.arriveDay - state.day) + 'd)</td></tr>';
        }).join('') + '</table></div>';
    }

    html += '<div class="panel"><h2>Buying Program</h2><div class="grid g2">' +
      '<label class="field"><span class="lab">Parts quality tier</span>' +
        '<select data-act="supplier">' + Object.keys(D.SUPPLIERS).map(function (k) {
          var x = D.SUPPLIERS[k];
          return '<option value="' + k + '"' + (k === state.supplier ? ' selected' : '') + '>' +
            h.esc(x.name) + ' (' + h.num(x.costMult, 2) + '× cost)</option>';
        }).join('') + '</select>' +
        '<span class="small muted">' + h.esc(D.SUPPLIERS[state.supplier].note) + '</span></label>' +
      '<label class="field"><span class="lab">Ordering program</span>' +
        '<select data-act="program">' + Object.keys(D.ORDER_PROGRAMS).map(function (k) {
          var x = D.ORDER_PROGRAMS[k];
          return '<option value="' + k + '"' + (k === state.orderProgram ? ' selected' : '') + '>' +
            h.esc(x.name) + ' (' + h.num(x.costMult, 2) + '× cost)</option>';
        }).join('') + '</select>' +
        '<span class="small muted">' + h.esc(prog.note) + '</span></label>' +
      '</div></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 5: crew
   * ---------------------------------------------------------------- */
  function stepCrew(state) {
    var r = A.schedule(state);
    var html = '<div class="panel"><h2>Who Is Working Today</h2>' +
      '<p class="sub">Technicians are paid flat rate against a ' + D.FINANCE.techGuaranteeHours +
      '-hour daily guarantee, so a scheduled hour nobody bills is money out the door. Scheduling ' +
      'short leaves cars on the lot overnight.</p>' +
      rec(r.value + ' hours each', r.why, 'data-act="applysched" data-value="' + r.value + '"') +
      '<div class="grid g2" style="margin-top:12px">' +
      state.techs.map(function (t) {
        var busy = t.trainingUntil > state.day;
        var best = D.SKILL_AREAS.slice().sort(function (a, b) {
          return t.skills[b.key] - t.skills[a.key];
        })[0];
        return '<div class="card decision">' +
          '<div class="spread"><h3>' + h.esc(t.name) + '</h3>' +
            '<span class="money small">$' + t.flatRate + '/hr flat</span></div>' +
          (busy ? '<div class="tag warn">In class: ' + h.esc(t.trainingName) +
            ' — back day ' + t.trainingUntil + '</div>'
            : '<div class="note">Strongest at ' + best.name.toLowerCase() + ' · productivity ' +
              h.pct(t.lifetimeActual ? t.lifetimeBilled / t.lifetimeActual : t.efficiency) +
              ' · quality ' + h.pct(t.quality) + '</div>') +
          (busy ? '' :
            '<label class="field"><span class="lab">Scheduled today <b>' + t.scheduledHours + 'h</b></span>' +
            '<input type="range" min="0" max="' + E.shiftHours(state) + '" step="1" value="' +
            t.scheduledHours + '" data-act="schedule" data-id="' + t.id + '"></label>' +
            '<div class="small muted">Guarantee costs you ' +
            h.money(D.FINANCE.techGuaranteeHours * t.flatRate * (1 + D.FINANCE.payrollTaxRate)) +
            ' whether or not there is work.</div>') +
          '</div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn ghost sm" data-act="office" data-tab="crew">Training, certifications &amp; hiring →</button>' +
      '</div></div>';

    var counter = '<div class="panel"><h2>The Front Counter</h2>' +
      '<div class="grid g3">' +
      h.tile('Customers handled/day', h.num(E.advisorCapacity(state), 0),
        state.advisors.length + ' advisor(s) on duty') +
      h.tile('Estimated closing ratio', h.pct(E.estimateCloseRate(state, 1)), 'of everyone they talk to') +
      h.tile('Expected calls today', h.num(E.forecast(state).opportunities, 0),
        E.forecast(state).opportunities > E.advisorCapacity(state)
          ? 'more than they can answer' : 'within capacity') +
      '</div></div>';

    return html + counter;
  }

  /* ---------------------------------------------------------------- *
   * Morning — step 6: open up
   * ---------------------------------------------------------------- */
  function stepOpen(state) {
    var f = E.forecast(state);
    var expectedCars = Math.min(f.opportunities, f.advisorCapacity) * E.estimateCloseRate(state, 1);
    var aro = state.stats.aro30 || 460;
    var adTotal = Object.keys(state.adSpend).reduce(function (a, k) { return a + state.adSpend[k]; }, 0);
    var sched = state.techs.reduce(function (a, t) {
      return a + (t.trainingUntil > state.day ? 0 : t.scheduledHours);
    }, 0);
    var guarantee = state.techs.reduce(function (a, t) {
      return a + D.FINANCE.techGuaranteeHours * t.flatRate;
    }, 0) * (1 + D.FINANCE.payrollTaxRate);
    var fixed = E.dailyFixedCost(state);
    var advPay = state.advisors.reduce(function (a, x) { return a + x.salary; }, 0) *
      (1 + D.FINANCE.payrollTaxRate);

    var warn = [];
    if (sched === 0 && state.techs.length) warn.push('Nobody is scheduled to turn a wrench.');
    if (E.carsOnSite(state) >= state.parking) warn.push('The lot is already full — you cannot take a car in.');
    A.parts(state, 3).rows.forEach(function (row) {
      if (row.have === 0 && row.want > 0) {
        warn.push('You are out of ' + D.partByKey[row.cat].name.toLowerCase() +
          '. Those jobs will pay hot-shot prices or sit.');
      }
    });
    if (adTotal === 0) warn.push('No advertising running. Only walk-ins and repeat customers today.');
    if (state.cash < fixed * 3) warn.push('Cash covers less than three days of overhead.');

    return '<div class="panel"><h2>Today&rsquo;s Plan</h2>' +
      '<div class="grid g3">' +
        h.tile('Expected cars', h.num(expectedCars, 0), 'from ' + h.num(f.opportunities, 0) + ' calls') +
        h.tile('Projected sales', h.money(expectedCars * aro), 'at your ' + h.money(aro) + ' average ticket') +
        h.tile('Committed cost', h.money(adTotal + guarantee + fixed + advPay),
          'ads, guarantees, salaries and overhead') +
      '</div>' +
      '<table style="margin-top:14px">' +
      '<tr><th>The plan you just set</th><th class="num"></th></tr>' +
      '<tr><td>Door rate</td><td class="num">' + h.money(state.prices.laborRate) + '/hr</td></tr>' +
      '<tr><td>Parts markup</td><td class="num">' + h.num(state.prices.partsMarkup, 2) + '×</td></tr>' +
      '<tr><td>Diagnostic fee</td><td class="num">' + h.money(state.prices.diagFee) + '</td></tr>' +
      (state.prices.coupon ? '<tr><td>Coupon</td><td class="num">' + state.prices.coupon + '% off</td></tr>' : '') +
      '<tr><td>Advertising</td><td class="num">' + h.money(adTotal) + '/day</td></tr>' +
      '<tr><td>Technician hours scheduled</td><td class="num">' + sched + '</td></tr>' +
      '<tr><td>Parts arriving today</td><td class="num">' +
        (state.onOrder.filter(function (o) { return o.arriveDay <= state.day; })
          .reduce(function (a, o) { return a + o.units; }, 0) || '—') + '</td></tr>' +
      '</table></div>' +

      (warn.length ? '<div class="panel"><h2>Before You Unlock The Door</h2>' +
        warn.map(function (w) { return '<div class="alert">' + h.esc(w) + '</div>'; }).join('') +
        '</div>' : '<div class="panel"><div class="alert good">The plan looks sound. Open up.</div></div>') +

      '<div class="panel">' +
      '<button class="btn primary run" data-act="openshop">Open The Shop</button>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn ghost sm" style="flex:1" data-act="fastforward" data-days="6">Skip 6 days</button>' +
        '<button class="btn ghost sm" style="flex:1" data-act="fastforward" data-days="30">Skip 30 days</button>' +
      '</div>' +
      '<p class="small muted" style="margin:8px 0 0">Skipping keeps today&rsquo;s plan, auto-orders parts ' +
      'to a seven-day target, and hands you the summary at the end.</p></div>';
  }

  /* ---------------------------------------------------------------- *
   * Act two — the day, on the clock
   * ---------------------------------------------------------------- */
  function dayScreen(state) {
    var p = UI.play;
    if (!p) return '';
    var t = p.t;
    var res = p.res;
    var shown = res.timeline.filter(function (e) { return e.t <= t; });

    var cars = 0, sold = 0, billed = 0, sales = 0, lost = 0;
    shown.forEach(function (e) {
      if (e.kind === 'arrive') { cars++; }
      if (e.kind === 'deliver') { sold++; sales += e.amount || 0; }
      if (e.kind === 'work') billed += e.billed || 0;
      if (e.kind === 'lost') lost++;
    });

    var open = E.SHOP_OPEN, close = E.shopClose(state);
    var frac = (t - open) / (close - open);

    var html = '<div class="panel dayhead">' +
      '<div class="spread">' +
        '<div><div class="k">Shop clock</div><div class="bigclock">' + E.clock(Math.min(t, close)) + '</div></div>' +
        '<div class="playctl">' +
          '<button class="btn sm" data-act="playpause">' + (p.playing ? '❚❚ Pause' : '▶ Play') + '</button>' +
          [1, 2, 4].map(function (sp) {
            return '<button class="btn sm ' + (p.speed === sp ? 'primary' : 'ghost') +
              '" data-act="speed" data-speed="' + sp + '">' + sp + '×</button>';
          }).join('') +
          '<button class="btn sm ghost" data-act="skipday">Skip to close</button>' +
        '</div>' +
      '</div>' +
      h.bar(Math.max(0, Math.min(1, frac))) +
      '<div class="grid g3" style="margin-top:12px">' +
        h.tile('Cars taken in', cars, lost + ' opportunities lost') +
        h.tile('Cars delivered', sold, h.money(sales) + ' collected') +
        h.tile('Hours billed', h.num(billed), 'so far today') +
      '</div></div>';

    /* What each bay is doing right now. */
    html += '<div class="panel"><h2>The Floor</h2><div class="bays">' +
      state.bays.map(function (b) {
        var busyWith = null;
        res.timeline.forEach(function (e) {
          if (e.kind === 'work' && e.bayId === b.id && e.start <= t && e.end > t) busyWith = e;
        });
        var down = b.readyDay > state.day || b.downUntil > state.day;
        return '<div class="baycard' + (busyWith ? ' busy' : down ? ' down' : '') + '">' +
          '<div class="bayname">' + h.esc(b.name) + '</div>' +
          (down ? '<div class="baystate">Out of service</div>'
            : busyWith
              ? '<div class="baystate on">' + h.esc(busyWith.jobName) + '</div>' +
                '<div class="baysub">' + h.esc(techName(state, busyWith.techId)) + ' · until ' +
                E.clock(busyWith.end) + '</div>' +
                h.bar((t - busyWith.start) / Math.max(0.1, busyWith.end - busyWith.start))
              : '<div class="baystate idle">Empty</div>' +
                '<div class="baysub">No car on the lift</div>') +
          '</div>';
      }).join('') + '</div></div>';

    html += '<div class="panel"><h2>As It Happened</h2>' +
      (shown.length
        ? '<ol class="feed">' + shown.slice().reverse().map(function (e) {
          return '<li class="fe ' + e.kind + ' ' + (e.tone || '') + '">' +
            '<span class="ft">' + E.clock(e.t) + '</span>' +
            '<span class="fb"><b>' + h.esc(e.title) + '</b>' +
            (e.detail ? '<span>' + h.esc(e.detail) + '</span>' : '') + '</span></li>';
        }).join('') + '</ol>'
        : '<p class="sub">Waiting on the first car.</p>') +
      '</div>';

    return html;
  }

  function techName(state, id) {
    var t = state.techs.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : 'Technician';
  }

  /* ---------------------------------------------------------------- *
   * Act three — the evening
   * ---------------------------------------------------------------- */
  function eveningScreen(state) {
    var r = UI.lastResult;
    if (!r) return '<div class="panel"><p class="sub">Nothing to report.</p></div>';

    var html = '<div class="panel hero">' +
      '<div class="hero-date">' + r.cal.label + '</div>' +
      '<h2 class="hero-h">' + (r.closed ? 'Closed for the day'
        : r.net >= 0 ? 'You made money today' : 'You lost money today') + '</h2>' +
      '<div class="grid g3" style="margin-top:12px">' +
        h.tile('Cars delivered', r.cars, r.carryover + ' still on the lot') +
        h.tile('Sales', h.money(r.revenue), r.cars ? h.money(r.revenue / r.cars) + ' per car' : '—') +
        h.tile('Net profit', h.money(r.net), '', r.net >= 0 ? 'good' : 'bad') +
      '</div></div>';

    if (!r.closed) {
      html += '<div class="grid g2">' +
        '<div class="panel"><h2>The Money</h2>' + h.plTable(r) + '</div>' +
        '<div class="panel"><h2>The Day</h2><table>' +
        '<tr><td>Opportunities</td><td class="num">' + r.opportunities + '</td></tr>' +
        '<tr><td>Handled by advisors</td><td class="num">' + r.presented + '</td></tr>' +
        '<tr><td>Sold</td><td class="num">' + r.won + ' (' +
          (r.presented ? h.pct(r.won / r.presented) : '—') + ')</td></tr>' +
        '<tr><td>Hours billed</td><td class="num">' + h.num(r.billedHours) + '</td></tr>' +
        '<tr><td>Hours on the clock</td><td class="num">' + h.num(r.actualHours) + '</td></tr>' +
        '<tr><td>Productivity</td><td class="num">' +
          (r.actualHours ? h.pct(r.billedHours / r.actualHours) : '—') + '</td></tr>' +
        '<tr><td>Bay utilization</td><td class="num">' +
          (r.bayHoursAvail ? h.pct(r.bayHoursUsed / r.bayHoursAvail) : '—') + '</td></tr>' +
        '<tr><td>Average satisfaction</td><td class="num">' + (r.avgSat || '—') + '</td></tr>' +
        '</table></div></div>';

      var leaks = [];
      if (r.turnedAwayCapacity) leaks.push(['Calls nobody answered', r.turnedAwayCapacity,
        'Hire an advisor or buy phone-skills training.', 'crew']);
      if (r.turnedAwayParking) leaks.push(['Turned away — lot full', r.turnedAwayParking,
        'Pave more parking, or finish cars faster so they leave.', 'upgrades']);
      if (r.lostCapability) leaks.push(['Work you cannot perform', r.lostCapability,
        'Tooling and certifications widen the menu.', 'floor']);
      if (r.comebacks) leaks.push(['Comebacks', r.comebacks,
        'Free labor you already paid for. Quality training or better parts.', 'crew']);
      if (r.hotshotCount) leaks.push(['Hot-shot parts runs', r.hotshotCount,
        'Order deeper so the shelf covers the work you sell.', 'parts']);
      if (leaks.length) {
        html += '<div class="panel"><h2>What Today Cost You</h2>' +
          '<table><tr><th>Leak</th><th class="num">Today</th><th>What fixes it</th><th></th></tr>' +
          leaks.map(function (l) {
            return '<tr><td>' + l[0] + '</td><td class="num neg">' + l[1] + '</td>' +
              '<td class="small muted">' + l[2] + '</td>' +
              '<td class="right"><button class="btn sm ghost" data-act="office" data-tab="' + l[3] +
              '">Fix</button></td></tr>';
          }).join('') + '</table></div>';
      }

      if (r.reviews.length) {
        html += '<div class="panel"><h2>Reviews That Landed</h2>' +
          r.reviews.map(function (v) {
            return '<div class="alert ' + (v.stars >= 4 ? 'good' : v.stars <= 2 ? 'bad' : '') + '">' +
              '<span class="stars">' + h.stars(v.stars) + '</span> ' + v.stars.toFixed(1) +
              ' — ' + h.esc(v.customer) + '</div>';
          }).join('') + '</div>';
      }
    }

    r.events.forEach(function (e) {
      html += '<div class="panel"><h2>' + h.esc(e.name) + '</h2><p class="sub">' + h.esc(e.text) + '</p></div>';
    });
    if (r.notes.length) {
      html += '<div class="panel"><h2>Notes</h2>' +
        r.notes.map(function (n) { return '<div class="alert">' + h.esc(n) + '</div>'; }).join('') + '</div>';
    }

    /* Decisions the day forced on you. */
    html += '<div class="panel"><h2>Tonight&rsquo;s Decisions</h2>';
    if (state.pendingChoice) {
      html += '<div class="issue"><b>' + h.esc(state.pendingChoice.name) + '</b>' +
        '<p>' + h.esc(state.pendingChoice.text) + '</p>' +
        '<div class="row wrap">' + state.pendingChoice.options.map(function (o) {
          return '<button class="btn" data-act="choice" data-key="' + o.key + '">' +
            h.esc(o.label) + '</button>';
        }).join('') + '</div></div>';
    }
    var top = A.priorities(state)[0];
    if (top) {
      html += '<div class="issue"><b>' + h.esc(top.title) + '</b>' +
        '<p>' + h.esc(top.detail) + '</p><p class="fix">' + h.esc(top.fix) + '</p>' +
        '<button class="btn sm" data-act="office" data-tab="' + top.goto + '">' +
        'Open ' + officeName(top.goto) + '</button></div>';
    }
    html += '<p class="small muted">Anything you buy tonight — tooling, training, a hire, a new bay — ' +
      'starts working tomorrow morning.</p>' +
      '<div class="row wrap" style="margin-top:8px">' +
      ['floor', 'crew', 'upgrades', 'books'].map(function (k) {
        return '<button class="btn sm ghost" data-act="office" data-tab="' + k + '">' +
          officeName(k) + '</button>';
      }).join('') + '</div></div>';

    html += '<div class="panel">' +
      (state.pendingChoice
        ? '<div class="alert">Settle the decision above before you plan tomorrow.</div>'
        : '<button class="btn primary run" data-act="tomorrow">Plan Tomorrow →</button>') +
      '</div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Shell
   * ---------------------------------------------------------------- */
  function phaseNav(state) {
    var phases = [['morning', 'Before', 'Plan the day'],
      ['day', 'During', 'Watch it run'],
      ['evening', 'After', 'Read the outcome']];
    var order = { morning: 0, day: 1, evening: 2 };
    return '<nav class="phases">' + phases.map(function (p) {
      var cls = state.phase === p[0] ? 'now' : order[state.phase] > order[p[0]] ? 'done' : '';
      return '<div class="phase ' + cls + '"><b>' + p[1] + '</b><span>' + p[2] + '</span></div>';
    }).join('') + '</nav>';
  }

  function render() {
    var state = UI.state;
    if (!state.phase) state.phase = 'morning';
    if (state.step === undefined) state.step = 0;

    document.getElementById('header').innerHTML = UI.renderHeader(UI.office);

    var body = document.getElementById('body');
    var rail = document.getElementById('rail');
    var wrap = document.querySelector('.main');

    if (UI.office) {
      wrap.classList.add('office');
      body.innerHTML = '<div class="officebar"><button class="btn" data-act="closeoffice">' +
        '← Back to ' + (state.phase === 'evening' ? 'tonight' : state.phase === 'day' ? 'the floor' : 'the morning plan') +
        '</button><span class="small muted">Detail screens. Anything you change here applies immediately.</span></div>' +
        (UI.tabs[UI.office] ? UI.tabs[UI.office]() : '');
      rail.innerHTML = '';
      rail.style.display = 'none';
    } else {
      wrap.classList.remove('office');
      rail.style.display = '';
      if (state.phase === 'morning') {
        body.innerHTML = phaseNav(state) +
          '<div class="stepwrap">' +
            (({ brief: stepBrief, price: stepPrice, ads: stepAds,
              parts: stepParts, crew: stepCrew, open: stepOpen })[STEPS[state.step].key])(state) +
            stepNav(state) +
          '</div>';
        rail.innerHTML = '<div class="panel"><h2>This Morning</h2>' + stepRail(state) + '</div>' +
          UI.railLog(state);
      } else if (state.phase === 'day') {
        body.innerHTML = phaseNav(state) + dayScreen(state);
        rail.innerHTML = '<div class="panel"><h2>Watching</h2>' +
          '<p class="sub">The shop runs 7am to ' + E.clock(E.shopClose(state)) +
          '. Every car, every job and every missed call in the order it happened.</p></div>' +
          UI.railLog(state);
      } else {
        body.innerHTML = phaseNav(state) + eveningScreen(state);
        rail.innerHTML = UI.railLog(state);
      }
    }

    UI.wrapTables(body);
    UI.wrapTables(rail);

    if (state.gameOver && !UI.modal) {
      UI.showModal('Out Of Business — Day ' + state.gameOver.day,
        '<p>' + h.esc(state.gameOver.reason) + '</p>' +
        '<p class="muted">You served ' + state.stats.carsServed + ' cars and booked ' +
        h.money(state.stats.revenueTotal) + ' in sales along the way.</p>',
        '<button class="btn primary" data-act="newgame">Start over</button>', false);
    }
  }

  /* ---------------------------------------------------------------- *
   * Playback driver
   * ---------------------------------------------------------------- */
  function startDay() {
    var state = UI.state;
    if (state.pendingChoice) { UI.choiceModal(); return; }
    if (state.gameOver) return;

    var snapshot = {
      cash: state.cash, debt: state.debt, rep: state.reputation,
      customers: state.customerBase, onSite: E.carsOnSite(state)
    };
    var res = E.runDay(state);
    if (!res) return;
    UI.lastResult = res;
    state.phase = 'day';

    if (res.closed) { finishDay(); return; }

    UI.play = {
      res: res, t: E.SHOP_OPEN, playing: true, speed: 2,
      close: E.shopClose(state), timer: null, snapshot: snapshot
    };
    render();
    tick();
  }

  function tick() {
    var p = UI.play;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.playing) return;
    p.timer = setTimeout(function () {
      p.t += 0.09 * p.speed;
      if (p.t >= p.close) {
        p.t = p.close;
        p.playing = false;
        render();
        setTimeout(finishDay, 700);
        return;
      }
      render();
      tick();
    }, 70);
  }

  function finishDay() {
    var p = UI.play;
    if (p) { clearTimeout(p.timer); }
    UI.play = null;
    UI.state.phase = 'evening';
    render();
    UI.save(true);
  }

  /* ---------------------------------------------------------------- *
   * Actions this module owns
   * ---------------------------------------------------------------- */
  function registerActions(ACTIONS) {
    ACTIONS.nextstep = function () {
      UI.state.step = Math.min(STEPS.length - 1, UI.state.step + 1);
      render(); window.scrollTo(0, 0);
    };
    ACTIONS.prevstep = function () {
      UI.state.step = Math.max(0, UI.state.step - 1);
      render(); window.scrollTo(0, 0);
    };
    ACTIONS.gostep = function (el) {
      UI.state.step = parseInt(el.getAttribute('data-step'), 10) || 0;
      render(); window.scrollTo(0, 0);
    };
    ACTIONS.office = function (el) {
      UI.office = el.getAttribute('data-tab');
      if (UI.play) { UI.play.playing = false; clearTimeout(UI.play.timer); }
      render(); window.scrollTo(0, 0);
    };
    ACTIONS.closeoffice = function () {
      UI.office = null;
      render(); window.scrollTo(0, 0);
    };
    ACTIONS.tab = function (el) {
      UI.office = el.getAttribute('data-tab');
      render(); window.scrollTo(0, 0);
    };

    ACTIONS.applyprice = function (el) {
      E.setPrice(UI.state, el.getAttribute('data-key'), el.getAttribute('data-value'));
      render();
    };
    ACTIONS.applyallprice = function () {
      var r = A.prices(UI.state);
      Object.keys(r).forEach(function (k) { E.setPrice(UI.state, k, r[k].value); });
      UI.toast('Pricing set to the recommendation.');
      render();
    };
    ACTIONS.adlevel = function (el) {
      UI.adLevel = el.getAttribute('data-level');
      render();
    };
    ACTIONS.applyad = function (el) {
      E.setAdSpend(UI.state, el.getAttribute('data-key'), el.getAttribute('data-value'));
      render();
    };
    ACTIONS.applyads = function () {
      var r = A.ads(UI.state, UI.adLevel || 'standard');
      Object.keys(r.channels).forEach(function (k) {
        E.setAdSpend(UI.state, k, r.channels[k].value);
      });
      UI.toast('Advertising budget set to ' + h.money(r.total) + '/day.');
      render();
    };
    ACTIONS.applysched = function (el) {
      var v = el.getAttribute('data-value');
      UI.state.techs.forEach(function (t) { E.setSchedule(UI.state, t.id, v); });
      UI.toast('Everyone scheduled for ' + v + ' hours.');
      render();
    };

    ACTIONS.openshop = function () { startDay(); };
    ACTIONS.playpause = function () {
      if (!UI.play) return;
      UI.play.playing = !UI.play.playing;
      render();
      if (UI.play.playing) tick();
    };
    ACTIONS.speed = function (el) {
      if (!UI.play) return;
      UI.play.speed = parseInt(el.getAttribute('data-speed'), 10) || 1;
      render();
    };
    ACTIONS.skipday = function () {
      if (!UI.play) return;
      UI.play.playing = false;
      clearTimeout(UI.play.timer);
      finishDay();
    };
    ACTIONS.tomorrow = function () {
      UI.state.phase = 'morning';
      UI.state.step = 0;
      render(); window.scrollTo(0, 0);
      UI.save(true);
    };
    ACTIONS.fastforward = function (el) {
      var n = parseInt(el.getAttribute('data-days'), 10) || 6;
      UI.runDays(n);
      UI.state.phase = 'evening';
      render();
    };
  }

  S.render = render;
  S.registerActions = registerActions;
  S.STEPS = STEPS;
  S.attach = function (ui) { UI = ui; h = ui.h; };

  root.AutoShopScreens = S;
})(window);
