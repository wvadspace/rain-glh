/* ==========================================================================
   state.js — game state, persistence, money helpers and pricing math.
   ========================================================================== */
(function (root) {
  'use strict';
  var AS = root.AS = root.AS || {};
  var C = AS.CONFIG;

  var SAVE_KEY = 'torque_profit_save_v1';
  var nextId = 1;
  function uid(p) { return (p || 'x') + (nextId++); }

  /* ---------------- construction ---------------- */

  AS.newTech = function (lvl, name) {
    return {
      id: uid('t'), name: name || AS.randomName(), lvl: lvl || 1,
      morale: 78, fatigue: 0, training: 0, hired: 0,
      lifetimeHours: 0, lifetimeBilled: 0, comebacks: 0, bayId: null
    };
  };

  AS.newAdvisor = function (lvl, name) {
    return {
      id: uid('a'), name: name || AS.randomName(), lvl: lvl || 1,
      morale: 78, training: 0,
      lifetimeRO: 0, lifetimeSold: 0, lifetimeQuoted: 0, lifetimeUpsells: 0
    };
  };

  AS.newBay = function (lvl) {
    return { id: uid('b'), lvl: lvl || 1, down: 0, name: null, lifetimeHours: 0 };
  };

  AS.newGame = function (shopName) {
    nextId = 1; usedNames = {};
    var s = {
      version: 1,
      shopName: shopName || 'Torque & Profit Auto',
      day: 1, dow: 1, month: 2, year: 1,       // start on a Monday in March
      cash: C.startCash,
      loan: 0,
      reputation: C.startRep,
      customerBase: C.startBase,
      locIndex: 0,
      partsStock: 2600,
      partsAutoOrder: 3000,

      bays: [AS.newBay(3), AS.newBay(2)],
      techs: [AS.newTech(3), AS.newTech(2)],
      advisors: [AS.newAdvisor(2)],

      pricing: {
        laborRate: 118,
        partsStrategy: 'standard',
        oilPrice: 69.95,
        diagFee: C.diagFeeDefault,
        supplyFee: true
      },
      adSpend: { search: 45, social: 0, mailer: 0, radio: 0, reviews: 0, loyalty: 0 },
      channels: {},

      spaces: 8,
      wip: [],            // jobs carried overnight
      booked: [],         // appointments scheduled for tomorrow
      modifiers: [],
      milestones: {},
      pendingCost: 0,
      pendingEvent: null,

      history: [],        // one record per day
      log: [],            // narrative feed
      stats: {
        bestWeekRevenue: 0, bestARO: 0, bestUtil: 0, bestDayProfit: 0,
        totalCars: 0, totalRevenue: 0, totalProfit: 0, totalComebacks: 0,
        lifetimeAdSpend: 0, daysOpen: 0
      },
      settings: { autoAssign: true },
      seed: (Math.random() * 1e9) | 0,
      gameOver: null
    };
    AS.CHANNELS.forEach(function (c) { s.channels[c.id] = { stock: 0, spend: 0, leads: 0, sold: 0, revenue: 0 }; });
    s.channels.search.stock = 1.2;
    return s;
  };

  /* ---------------- names ---------------- */
  var FIRST = ['Marcus','Dee','Rosa','Hank','Tony','Luis','Sam','Priya','Jesse','Cody','Wanda','Otis','Nina','Rafe','Beto','Gus','Kira','Dale','Mo','Trish','Ken','Vic','Ada','Reggie','Juno','Cliff','Mel','Sonia','Bud','Ivy'];
  var LAST  = ['Alvarez','Boone','Castillo','Duran','Ellis','Fontaine','Grady','Hollis','Ibarra','Jessup','Kowalski','Lampkin','Moreau','Nakamura','Ortega','Pruitt','Quinn','Ramos','Sotelo','Tarver','Ulrich','Vance','Whitlock','Xiong','Yates','Zamora'];
  /* Names must be unique on the floor — you have to be able to tell your
     people apart on the station report. */
  var usedNames = {};
  AS.randomName = function () {
    for (var i = 0; i < 200; i++) {
      var n = FIRST[(Math.random() * FIRST.length) | 0] + ' ' + LAST[(Math.random() * LAST.length) | 0];
      if (!usedNames[n]) { usedNames[n] = 1; return n; }
    }
    return FIRST[(Math.random() * FIRST.length) | 0] + ' ' + LAST[(Math.random() * LAST.length) | 0] + ' ' + (nextId);
  };
  AS.reserveNames = function (s) {
    usedNames = {};
    [].concat(s.techs || [], s.advisors || []).forEach(function (p) { usedNames[p.name] = 1; });
  };

  /* ---------------- derived getters ---------------- */

  AS.location = function (s) { return AS.LOCATIONS[s.locIndex]; };
  AS.techLevel = function (t) { return AS.TECH_LEVELS[t.lvl - 1]; };
  AS.advisorLevel = function (a) { return AS.ADVISOR_LEVELS[a.lvl - 1]; };
  AS.equip = function (b) { return AS.EQUIP[b.lvl - 1]; };

  AS.partsStrategy = function (s) {
    return C.partsStrategies.filter(function (p) { return p.id === s.pricing.partsStrategy; })[0] || C.partsStrategies[1];
  };

  /* Sliding-scale parts markup. */
  AS.matrixMult = function (cost) {
    for (var i = 0; i < C.partsMatrix.length; i++) {
      if (cost <= C.partsMatrix[i].max) return C.partsMatrix[i].mult;
    }
    return 1.35;
  };

  AS.partsPrice = function (s, cost) {
    if (cost <= 0) return 0;
    return cost * AS.matrixMult(cost) * AS.partsStrategy(s).mult;
  };

  /* Full customer-facing price for one job. */
  AS.quote = function (s, job, opts) {
    opts = opts || {};
    var p = s.pricing;
    var partsCost = job.parts * (opts.partsCostMult || 1);
    var labor;
    if (job.id === 'oil') {
      labor = Math.max(0, p.oilPrice - AS.partsPrice(s, partsCost));
    } else if (job.diag) {
      labor = Math.max(p.diagFee, job.hours * p.laborRate);
    } else {
      labor = job.hours * p.laborRate;
    }
    var parts = AS.partsPrice(s, partsCost);
    var supplies = p.supplyFee ? Math.min(labor * C.supplyFeeRate, C.supplyFeeCap) : 0;
    var total = labor + parts + supplies;
    var discount = (opts.coupon || 0) * total;
    return {
      labor: labor, parts: parts, supplies: supplies,
      partsCost: partsCost, discount: discount,
      total: Math.max(0, total - discount)
    };
  };

  /* The same job priced at town-average rates — the customer's mental anchor. */
  AS.marketQuote = function (s, job) {
    var partsCost = job.parts;
    var labor = job.id === 'oil' ? Math.max(0, C.marketOilPrice - partsCost * AS.matrixMult(partsCost))
              : job.diag ? Math.max(C.diagFeeDefault, job.hours * C.marketLaborRate)
              : job.hours * C.marketLaborRate;
    return labor + partsCost * AS.matrixMult(partsCost) + Math.min(labor * C.supplyFeeRate, C.supplyFeeCap);
  };

  /* Daily fixed overhead, before wages and marketing. */
  AS.dailyOverhead = function (s) {
    var f = C.dailyFixed;
    var rent = AS.location(s).rent;
    var upkeep = s.bays.reduce(function (n, b) { return n + AS.equip(b).upkeep; }, 0);
    var interest = s.loan * C.loanAPR / 365;
    return {
      rent: rent, insurance: f.insurance, software: f.software,
      utilities: f.utilities + s.bays.length * 6,
      upkeep: upkeep, interest: interest,
      total: rent + f.insurance + f.software + f.utilities + s.bays.length * 6 + upkeep + interest
    };
  };

  AS.dailyPayroll = function (s, hours) {
    var techPay = 0;
    s.techs.forEach(function (t) {
      if (t.training > 0) { techPay += AS.techLevel(t).wage * hours * 0.5; return; }
      techPay += AS.techLevel(t).wage * hours;
    });
    var advPay = s.advisors.reduce(function (n, a) { return n + AS.advisorLevel(a).wage; }, 0);
    return { tech: techPay, advisor: advPay, total: techPay + advPay };
  };

  AS.creditLimit = function (s) {
    var equity = s.bays.reduce(function (n, b) { return n + AS.equip(b).cost * 0.55; }, 0)
               + s.spaces * C.spaceCost * 0.3
               + AS.location(s).cost * 0.25;
    return Math.max(C.creditFloor, Math.round(equity + C.creditFloor));
  };

  AS.bayBuildCost = function (s) {
    return Math.round(C.bayBuildBase * Math.pow(C.bayBuildGrowth, s.bays.length - 2));
  };

  AS.modifier = function (s, key) {
    return s.modifiers.reduce(function (n, m) { return n * (m[key] != null ? m[key] : 1); }, 1);
  };

  AS.money = function (n) {
    var neg = n < 0;
    var v = Math.abs(Math.round(n)).toLocaleString('en-US');
    return (neg ? '-$' : '$') + v;
  };
  AS.money2 = function (n) {
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  AS.pct = function (n, d) { return (n * 100).toFixed(d == null ? 1 : d) + '%'; };

  AS.dateLabel = function (s) {
    return AS.DAYS[s.dow] + ', ' + AS.MONTHS[s.month] + ' ' + (((s.day - 1) % 28) + 1) + ' — Year ' + s.year;
  };

  /* ---------------- persistence ---------------- */

  AS.save = function (s) {
    try {
      var copy = JSON.parse(JSON.stringify(s));
      copy.log = copy.log.slice(-60);
      copy.history = copy.history.slice(-180);
      root.localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
      return true;
    } catch (e) { return false; }
  };

  AS.load = function () {
    try {
      var raw = root.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1) return null;
      // keep uid counter ahead of anything restored
      var ids = [].concat(s.bays, s.techs, s.advisors).map(function (o) { return parseInt(String(o.id).slice(1), 10) || 0; });
      nextId = Math.max.apply(null, [0].concat(ids)) + 1;
      AS.reserveNames(s);
      return s;
    } catch (e) { return null; }
  };

  AS.hasSave = function () {
    try { return !!root.localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  AS.clearSave = function () {
    try { root.localStorage.removeItem(SAVE_KEY); } catch (e) {}
  };

  AS.exportSave = function (s) { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); };
  AS.importSave = function (str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str.trim())))); } catch (e) { return null; }
  };

})(typeof window !== 'undefined' ? window : globalThis);
