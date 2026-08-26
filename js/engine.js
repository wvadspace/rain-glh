/*
 * Torque & Turnover — simulation engine.
 *
 * The engine is pure state-in / state-out so it can be unit tested in node
 * without a DOM. UI code never mutates state directly; it calls the action
 * helpers exported at the bottom.
 */
(function (root) {
  'use strict';

  var D = root.AutoShopData || (typeof require === 'function' ? require('./data.js') : null);

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* Deterministic PRNG so a saved game replays identically. */
  function rng(state) {
    state.seed = (state.seed + 0x6D2B79F5) | 0;
    var t = state.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rnd(state, lo, hi) { return lo + rng(state) * (hi - lo); }
  function rndInt(state, lo, hi) { return Math.floor(rnd(state, lo, hi + 1)); }
  function pick(state, arr) { return arr[Math.floor(rng(state) * arr.length)]; }
  function chance(state, p) { return rng(state) < p; }
  /* Poisson-ish integer draw around a mean, without the long tail. */
  function around(state, mean) {
    if (mean <= 0) return 0;
    var v = mean + (rng(state) + rng(state) + rng(state) - 1.5) * Math.sqrt(mean) * 1.15;
    return Math.max(0, Math.round(v));
  }

  /* ------------------------------------------------------------------ *
   * Calendar helpers. Day 1 = Monday, March 2nd (year 1).
   * ------------------------------------------------------------------ */
  var MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function calendar(day) {
    // Start on day 1 = Monday, month index 2 (March), date 2.
    var dow = (day - 1) % 7;                 // 0 = Monday
    var elapsed = day - 1;
    var m = 2, date = 2, year = 1;
    while (elapsed > 0) {
      date++;
      if (date > MONTH_LENGTHS[m]) { date = 1; m++; if (m > 11) { m = 0; year++; } }
      elapsed--;
    }
    return {
      dow: dow, dayName: D.DAY_NAMES[dow], month: m, monthName: D.MONTH_NAMES[m],
      date: date, year: year, season: D.MONTH_SEASON[m],
      label: D.DAY_NAMES[dow] + ', ' + D.MONTH_NAMES[m] + ' ' + date + ' (Yr ' + year + ')'
    };
  }

  /* Jobs billed on a diagnostic fee rather than straight door rate. */
  var DIAG_BILLED = { diag: 1, driveability: 1, parasitic: 1, evdiag: 1 };

  /* ------------------------------------------------------------------ *
   * New game
   * ------------------------------------------------------------------ */
  function makeTech(state, opts) {
    opts = opts || {};
    var skills = {};
    D.SKILL_AREAS.forEach(function (s) { skills[s.key] = opts.baseSkill || 1; });
    if (opts.skills) Object.keys(opts.skills).forEach(function (k) { skills[k] = opts.skills[k]; });
    return {
      id: 'T' + (state.nextId++),
      kind: 'tech',
      name: opts.name || (pick(state, D.FIRST_NAMES) + ' ' + pick(state, D.LAST_NAMES)),
      skills: skills,
      certs: opts.certs ? opts.certs.slice() : [],
      efficiency: opts.efficiency || 1.0,   // flat-rate productivity multiplier
      quality: opts.quality || 0.5,         // 0..1, reduces comebacks
      flatRate: opts.flatRate || 32,        // $ per billed hour
      morale: 0.8,
      fatigue: 0,
      scheduledHours: 8,
      trainingUntil: 0,
      trainingName: '',
      hiredDay: state.day || 1,
      lifetimeBilled: 0,
      lifetimeActual: 0
    };
  }

  function makeAdvisor(state, opts) {
    opts = opts || {};
    var tracks = {};
    D.ADVISOR_TRACKS.forEach(function (t) { tracks[t.key] = opts.tracks && opts.tracks[t.key] || 0; });
    return {
      id: 'A' + (state.nextId++),
      kind: 'advisor',
      name: opts.name || (pick(state, D.FIRST_NAMES) + ' ' + pick(state, D.LAST_NAMES)),
      tracks: tracks,
      experience: opts.experience || 1,     // 1..5, natural talent
      // The owner works the counter for free, so 0 has to survive the default.
      salary: opts.salary === undefined ? 210 : opts.salary,   // per working day
      morale: 0.8,
      trainingUntil: 0,
      trainingName: '',
      hiredDay: state.day || 1,
      lifetimeSold: 0,
      lifetimePresented: 0
    };
  }

  function makeBay(state, type, toolLevel) {
    return {
      id: 'B' + (state.nextId++),
      type: type,
      name: D.BAY_TYPES[type].name,
      toolLevel: toolLevel || 1,
      downUntil: 0,
      readyDay: 0,
      utilization: 0
    };
  }

  function newGame(seed) {
    var state = {
      version: 1,
      seed: (seed === undefined ? Math.floor(Math.random() * 1e9) : seed) | 0,
      startSeed: 0,
      day: 1,
      nextId: 1,
      shopName: 'Torque & Turnover Auto',
      cash: D.FINANCE.startingCash,
      debt: 0,
      reputation: 3.6,
      reviewCount: 8,
      customerBase: 55,       // households that consider you their shop
      parking: 12,
      storage: 190,
      bays: [],
      techs: [],
      advisors: [],
      inventory: {},
      invCost: {},            // moving-average cost paid per unit
      onOrder: [],
      openROs: [],
      completedToday: [],
      declinedPool: 0,        // dollars of declined work available to recapture
      comebacks: [],
      prices: { laborRate: 155, partsMarkup: 1.85, diagFee: 129, coupon: 0 },
      supplier: 'aftermarket',
      orderProgram: 'warehouse',
      autoHotshot: true,
      adSpend: {},
      adStock: {},
      adSpendHistory: {},
      upgrades: {},
      construction: [],       // { kind, label, readyDay, payload }
      activeEvents: [],
      pendingChoice: null,
      hiringPool: { techs: [], advisors: [], refreshedDay: 0 },
      fixedCosts: Object.assign({}, D.FIXED_COSTS),
      history: [],
      log: [],
      milestones: {},
      gameOver: null,
      stats: {
        carsServed: 0, revenueTotal: 0, profitTotal: 0, revenue30: 0, aro30: 0,
        bestWeekRevenue: 0, closeRate: 0, techEfficiency: 1, bayUtilization: 0,
        lostNoCapacity: 0, lostNoParking: 0, lostNoCapability: 0, comebackCount: 0
      }
    };
    state.startSeed = state.seed;

    D.PART_CATEGORIES.forEach(function (p) {
      state.inventory[p.key] = 0;
      state.invCost[p.key] = p.cost;
    });
    // A modest opening stock so day one is playable.
    state.inventory.fluids = 20;
    state.inventory.brakes = 6;
    state.inventory.supplies = 60;
    state.inventory.electrical = 4;
    state.inventory.tires = 8;

    D.AD_CHANNELS.forEach(function (c) {
      state.adSpend[c.key] = 0;
      state.adStock[c.key] = 0;
      state.adSpendHistory[c.key] = [];
    });

    state.bays.push(makeBay(state, 'general', 1));
    state.bays.push(makeBay(state, 'general', 1));
    state.bays.push(makeBay(state, 'tire', 1));

    state.techs.push(makeTech(state, {
      name: 'Ray Gutierrez',
      skills: { maintenance: 3, brakes: 3, suspension: 2, tires: 3, electrical: 2, engine: 2, hvac: 1, diagnostics: 1 },
      efficiency: 1.02, quality: 0.62, flatRate: 34
    }));
    state.techs.push(makeTech(state, {
      name: 'Casey Boone',
      skills: { maintenance: 2, brakes: 2, suspension: 1, tires: 2, electrical: 1, engine: 1, hvac: 1, diagnostics: 1 },
      efficiency: 0.92, quality: 0.48, flatRate: 26
    }));
    state.advisors.push(makeAdvisor(state, { name: 'You (Owner / Advisor)', experience: 2, salary: 0 }));

    refreshHiringPool(state, true);
    logLine(state, 'Day 1. You signed the lease on a three-bay shop in ' + D.TOWN.name +
      '. ' + fmtMoney(state.cash) + ' in the bank and a phone that is not ringing yet.');
    return state;
  }

  function fmtMoney(v) {
    var neg = v < 0;
    var s = '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
    return neg ? '-' + s : s;
  }

  function logLine(state, text, kind) {
    state.log.unshift({ day: state.day, text: text, kind: kind || 'info' });
    if (state.log.length > 240) state.log.pop();
  }

  /* ------------------------------------------------------------------ *
   * Derived values
   * ------------------------------------------------------------------ */
  function shiftHours(state) { return state.upgrades.secondshift ? 10 : 8; }

  function upgradeEffect(state, key) {
    var total = 0;
    D.UPGRADES.forEach(function (u) {
      var count = state.upgrades[u.key] || 0;
      if (count && u.effect[key]) total += u.effect[key] * (u.repeatable ? count : 1);
    });
    return total;
  }

  function bayTools(bay) { return D.TOOL_PACKAGES[bay.type][bay.toolLevel - 1]; }

  function bayTags(bay) {
    var tags = {};
    var pkgs = D.TOOL_PACKAGES[bay.type];
    for (var i = 0; i < bay.toolLevel; i++) {
      pkgs[i].unlocks.forEach(function (t) { tags[t] = true; });
    }
    return tags;
  }

  function baySpeed(bay) {
    var pkgs = D.TOOL_PACKAGES[bay.type];
    return pkgs[bay.toolLevel - 1].speed;
  }
  function bayQuality(bay) {
    return D.TOOL_PACKAGES[bay.type][bay.toolLevel - 1].quality;
  }

  /* Which jobs can this shop physically perform right now? */
  function capabilities(state) {
    var out = {};
    D.JOBS.forEach(function (job) {
      var bayOk = state.bays.some(function (b) {
        if (job.bays.indexOf(b.type) < 0) return false;
        if (b.readyDay > state.day) return false;
        var tags = bayTags(b);
        return job.tags.every(function (t) { return tags[t]; });
      });
      var certOk = job.certs.length === 0 || state.techs.some(function (t) {
        return job.certs.every(function (c) { return t.certs.indexOf(c) >= 0; });
      });
      out[job.key] = { ok: bayOk && certOk, bay: bayOk, cert: certOk };
    });
    return out;
  }

  function advisorCapacity(state) {
    var base = 0;
    state.advisors.forEach(function (a) {
      // Sales training happens in the evenings and on Saturdays: the advisor is
      // still at the counter, just distracted.
      var focus = a.trainingUntil > state.day ? 0.65 : 1;
      var c = (11 + a.experience * 1.6 + (a.tracks.phone || 0) * 2.2) * focus;
      c += upgradeEffect(state, 'advisorCapacity') * focus;
      c *= 0.9 + a.morale * 0.2;
      base += c;
    });
    return base;
  }

  function advisorAvg(state, track) {
    if (!state.advisors.length) return 0;
    var sum = 0;
    state.advisors.forEach(function (a) { sum += a.tracks[track] || 0; });
    return sum / state.advisors.length;
  }
  function advisorAvgExp(state) {
    if (!state.advisors.length) return 0;
    var sum = 0;
    state.advisors.forEach(function (a) { sum += a.experience; });
    return sum / state.advisors.length;
  }

  function priceIndex(state) {
    var labor = state.prices.laborRate / D.TOWN.marketLaborRate;
    var parts = state.prices.partsMarkup / D.TOWN.marketPartsMarkup;
    var diag = state.prices.diagFee / D.TOWN.marketDiagFee;
    var idx = labor * 0.58 + parts * 0.32 + diag * 0.10;
    return idx * (1 - state.prices.coupon / 100 * 0.6);
  }

  function priceTolerance(state) {
    return 1 + advisorAvg(state, 'objection') * 0.055 + upgradeEffect(state, 'priceTolerance');
  }

  function carsOnSite(state) {
    return state.openROs.length;
  }

  /*
   * A real shop prices parts off a matrix, not a flat multiplier: cheap
   * parts carry a fat markup, expensive parts a thin one. `partsMarkup`
   * is the shop's overall aggressiveness; the tier factor shapes it.
   * Commodity categories (tires) carry their own hard ceiling.
   */
  function partsMarkupFor(state, unitCost, catKey) {
    var base = state.prices.partsMarkup;
    var tierMult = unitCost < 25 ? 1.55
      : unitCost < 75 ? 1.24
        : unitCost < 150 ? 1.05
          : unitCost < 400 ? 0.90 : 0.78;
    var m = Math.max(1.05, base * tierMult);
    var cat = catKey && D.partByKey[catKey];
    if (cat && cat.maxMarkup) m = Math.min(m, cat.maxMarkup);
    return m;
  }

  function unitCostFor(state, catKey) {
    var cat = D.partByKey[catKey];
    return cat.cost * D.SUPPLIERS[state.supplier].costMult;
  }

  function storageUsed(state) {
    var used = 0;
    D.PART_CATEGORIES.forEach(function (p) { used += (state.inventory[p.key] || 0) * p.shelf; });
    return used;
  }

  function dailyFixedCost(state) {
    var monthly = 0;
    Object.keys(state.fixedCosts).forEach(function (k) { monthly += state.fixedCosts[k]; });
    var daily = monthly / 30;
    D.UPGRADES.forEach(function (u) {
      if (u.upkeep && state.upgrades[u.key]) daily += u.upkeep * (u.repeatable ? state.upgrades[u.key] : 1);
    });
    return daily;
  }

  /* ------------------------------------------------------------------ *
   * Demand model
   * ------------------------------------------------------------------ */
  function reputationMultiplier(rep) {
    return clamp(0.40 + (rep - 2.5) * 0.36, 0.30, 1.62);
  }

  function eventTrafficMult(state) {
    var m = 1;
    state.activeEvents.forEach(function (e) {
      if (e.effect && e.effect.trafficMult) m *= e.effect.trafficMult;
    });
    return m;
  }
  function eventJobBoost(state, jobKey) {
    var m = 1;
    state.activeEvents.forEach(function (e) {
      if (e.effect && e.effect.jobBoost && e.effect.jobBoost[jobKey]) m *= e.effect.jobBoost[jobKey];
    });
    return m;
  }

  function channelLeads(state, ch) {
    var stock = state.adStock[ch.key] || 0;
    if (stock <= 0) return 0;
    var maxLeads = ch.maxLeads;
    if (ch.key === 'referral') maxLeads *= clamp(0.35 + state.customerBase / 320, 0.35, 2.2);
    if (ch.key === 'seo') maxLeads *= clamp(0.7 + state.reputation / 10, 0.7, 1.25);
    return maxLeads * (1 - Math.exp(-stock / ch.halfSpend));
  }

  /*
   * How much of the town's repair demand can this shop actually serve?
   * A shop that only changes oil never gets the phone call about a
   * timing belt, so coverage scales the leads you receive.
   */
  function menuCoverage(state) {
    var caps = capabilities(state);
    var cal = calendar(state.day);
    var total = 0, doable = 0;
    D.JOBS.forEach(function (j) {
      var w = j.weight * (j.season[cal.season] || 1);
      total += w;
      if (caps[j.key].ok) doable += w;
    });
    return total ? doable / total : 0;
  }

  function forecast(state) {
    var cal = calendar(state.day);
    var dow = D.DOW_TRAFFIC[cal.dow];
    var month = D.MONTH_TRAFFIC[cal.month];
    var rep = reputationMultiplier(state.reputation);
    var evt = eventTrafficMult(state);
    var coverage = menuCoverage(state);
    var covMult = 0.58 + 0.42 * coverage;
    var base = (3.6 + upgradeEffect(state, 'organic')) * rep * dow * month * evt * covMult;
    // A household that considers you "their shop" comes in roughly three
    // times a year, so each customer has a ~1/110 chance of calling today.
    var loyal = state.customerBase * (1 / 110) * dow * month * evt *
      clamp(0.7 + state.reputation / 8, 0.7, 1.3) * covMult;
    var paid = [];
    var paidTotal = 0;
    D.AD_CHANNELS.forEach(function (c) {
      var l = channelLeads(state, c) * dow * evt * covMult;
      paidTotal += l;
      paid.push({ key: c.key, name: c.name, leads: l });
    });
    var total = base + loyal + paidTotal;
    var cap = D.TOWN.marketDailyOpportunities * 0.30;
    return {
      cal: cal, dowMult: dow, monthMult: month, repMult: rep, eventMult: evt,
      coverage: coverage, coverageMult: covMult,
      organic: base, loyal: loyal, paid: paid, paidTotal: paidTotal,
      opportunities: Math.min(total, cap), capped: total > cap,
      advisorCapacity: advisorCapacity(state),
      closeRate: estimateCloseRate(state, 1)
    };
  }

  function estimateCloseRate(state, intent) {
    var close = 0.50;
    close += advisorAvg(state, 'menu') * 0.035;
    close += (advisorAvgExp(state) - 1) * 0.022;
    close += upgradeEffect(state, 'close');
    close *= clamp(0.84 + (state.reputation - 4.0) * 0.11, 0.6, 1.16);
    var pi = priceIndex(state), tol = priceTolerance(state);
    close *= clamp(1 - (pi - tol) * 1.35, 0.30, 1.22);
    close *= intent;
    return clamp(close, 0.10, 0.94);
  }

  /* ------------------------------------------------------------------ *
   * Parts handling
   * ------------------------------------------------------------------ */
  function takeParts(state, job, res) {
    var need = job.parts, k;
    var short = [];
    for (k in need) {
      if ((state.inventory[k] || 0) < need[k]) short.push(k);
    }
    if (short.length) {
      if (!state.autoHotshot) return false;
      var cost = 0;
      for (var i = 0; i < short.length; i++) {
        k = short[i];
        var qty = need[k] - (state.inventory[k] || 0);
        cost += qty * unitCostFor(state, k) * D.HOTSHOT_MULT;
      }
      if (cost > state.cash + (D.FINANCE.creditLimit - state.debt)) return false;
      for (var j = 0; j < short.length; j++) {
        k = short[j];
        var q = need[k] - (state.inventory[k] || 0);
        state.inventory[k] = (state.inventory[k] || 0) + q;
        // hot-shot parts enter inventory at their premium price
        var newCost = unitCostFor(state, k) * D.HOTSHOT_MULT;
        state.invCost[k] = (state.invCost[k] * (state.inventory[k] - q) + newCost * q) / state.inventory[k];
      }
      res.hotshotCost += cost;
      res.hotshotCount++;
      state.cash -= cost;
    }
    var partsCost = 0;
    for (k in need) {
      state.inventory[k] -= need[k];
      partsCost += need[k] * state.invCost[k];
    }
    return partsCost;
  }

  /* ------------------------------------------------------------------ *
   * The day
   * ------------------------------------------------------------------ */
  function runDay(state) {
    if (state.gameOver) return null;
    var cal = calendar(state.day);
    var res = {
      day: state.day, cal: cal, closed: cal.dow === 6,
      opportunities: 0, presented: 0, closed: 0, sold: 0, cars: 0, turnedAwayParking: 0,
      turnedAwayCapacity: 0, lostCapability: 0, laborRevenue: 0, partsRevenue: 0,
      partsCost: 0, hotshotCost: 0, hotshotCount: 0, revenue: 0, grossProfit: 0,
      payroll: 0, adSpend: 0, fixed: 0, interest: 0, taxes: 0, expenses: 0, net: 0,
      billedHours: 0, actualHours: 0, bayHoursAvail: 0, bayHoursUsed: 0,
      completed: 0, carryover: 0, comebacks: 0, reviews: [], events: [],
      newCustomers: 0, jobsDone: {}, notes: [], avgSat: 0
    };

    // --- 1. Overnight: deliveries, training returns, construction ------
    receiveOrders(state, res);
    finishConstruction(state, res);

    // --- 2. Expire events, maybe fire a new one ------------------------
    state.activeEvents = state.activeEvents.filter(function (e) { return e.until > state.day; });
    maybeEvent(state, res);

    // --- 3. Advertising: spend money, build adstock --------------------
    var adToday = 0;
    D.AD_CHANNELS.forEach(function (c) {
      var spend = state.adSpend[c.key] || 0;
      if (spend > 0 && spend < c.minSpend) spend = 0;
      state.adSpendHistory[c.key].push(spend);
      if (state.adSpendHistory[c.key].length > 60) state.adSpendHistory[c.key].shift();
      adToday += spend;
      var hist = state.adSpendHistory[c.key];
      var effective = hist.length > c.lag ? hist[hist.length - 1 - c.lag] : 0;
      state.adStock[c.key] = state.adStock[c.key] * c.decay + effective * (1 - c.decay);
    });
    res.adSpend = adToday;
    state.cash -= adToday;

    if (res.closed) {
      // Sunday: closed, but the bills keep coming.
      finishFinances(state, res);
      pushHistory(state, res);
      state.day++;
      logLine(state, 'Sunday. Shop closed. Fixed costs still ran ' + fmtMoney(res.fixed) + '.');
      return res;
    }

    // --- 4. Demand -----------------------------------------------------
    var f = forecast(state);
    var sources = [];
    var organic = around(state, f.organic);
    var loyal = around(state, f.loyal);
    sources.push({ key: 'organic', intent: 1.0, aro: 1.0, count: organic });
    sources.push({ key: 'loyal', intent: 1.22, aro: 1.05, count: loyal });
    f.paid.forEach(function (p) {
      var ch = D.AD_CHANNELS.filter(function (c) { return c.key === p.key; })[0];
      var n = around(state, p.leads);
      if (n > 0) sources.push({ key: p.key, intent: ch.intent, aro: ch.aro, count: n });
    });
    // Declined-work recapture from advisor follow-up training.
    var recaptureRate = advisorAvg(state, 'followup') * 0.05;
    var recaptured = 0;
    if (state.declinedPool > 0 && recaptureRate > 0) {
      recaptured = Math.min(state.declinedPool, state.declinedPool * recaptureRate);
      state.declinedPool -= recaptured;
    }

    var totalOpps = sources.reduce(function (a, s) { return a + s.count; }, 0);
    res.opportunities = totalOpps;

    // --- 5. Advisors: capacity, then closing ---------------------------
    var capacity = advisorCapacity(state);
    var handled = 0;
    var caps = capabilities(state);
    var newROs = [];
    var spaceLeft = state.parking - carsOnSite(state);

    for (var si = 0; si < sources.length; si++) {
      var src = sources[si];
      for (var i = 0; i < src.count; i++) {
        if (handled >= capacity) { res.turnedAwayCapacity++; state.stats.lostNoCapacity++; continue; }
        handled++;
        res.presented++;
        var closeRate = estimateCloseRate(state, src.intent);
        if (!chance(state, closeRate)) continue;
        res.closed++;
        if (spaceLeft <= 0) { res.turnedAwayParking++; state.stats.lostNoParking++; continue; }
        var ro = buildRO(state, src, caps, res);
        if (!ro) { res.lostCapability++; state.stats.lostNoCapability++; continue; }
        spaceLeft--;
        newROs.push(ro);
        res.sold++;
      }
    }
    // Recaptured declined work rides along as extra sold labor on existing cars.
    if (recaptured > 0 && newROs.length) {
      res.notes.push('Follow-up calls recaptured ' + fmtMoney(recaptured) + ' of previously declined work.');
    }
    res.recaptured = recaptured;

    state.openROs = state.openROs.concat(newROs);

    // --- 6. Comebacks come back ----------------------------------------
    var due = state.comebacks.filter(function (c) { return c.day <= state.day; });
    state.comebacks = state.comebacks.filter(function (c) { return c.day > state.day; });
    due.forEach(function (c) {
      var job = D.jobByKey[c.jobKey];
      state.openROs.push({
        id: 'RO' + (state.nextId++), customer: c.customer, soldDay: state.day,
        source: 'comeback', isComeback: true, sat: 3.0, aroMult: 1,
        jobs: [{ key: job.key, name: job.name + ' (comeback)', bookHours: job.bookHours * 0.6,
          remaining: job.bookHours * 0.6, parts: {}, partsCost: 0, done: false, waitingParts: false }]
      });
      res.comebacks++;
      state.stats.comebackCount++;
    });

    // --- 7. Production --------------------------------------------------
    produce(state, res);

    // --- 8. Deliver finished cars ---------------------------------------
    deliver(state, res, recaptured);

    // --- 9. Money --------------------------------------------------------
    payroll(state, res);
    finishFinances(state, res);
    pushHistory(state, res);
    checkMilestones(state, res);

    state.day++;
    return res;
  }

  /* Build a repair order from an opportunity. */
  function buildRO(state, src, caps, res) {
    var cal = calendar(state.day);
    var season = cal.season;
    var pool = [];
    var totalW = 0;
    D.JOBS.forEach(function (j) {
      var w = j.weight * (j.season[season] || 1) * eventJobBoost(state, j.key);
      totalW += w;
      pool.push({ job: j, w: totalW });
    });
    var r = rng(state) * totalW;
    var chosen = null;
    for (var i = 0; i < pool.length; i++) { if (r <= pool[i].w) { chosen = pool[i].job; break; } }
    if (!chosen) chosen = D.JOBS[0];
    if (!caps[chosen.key].ok) {
      // The advisor usually finds something you *can* do on the same car.
      // Sometimes the customer only needed the one thing you cannot touch.
      if (!chance(state, 0.7)) return null;
      var doable = D.JOBS.filter(function (j) { return caps[j.key].ok; });
      if (!doable.length) return null;
      var dw = 0, dpool = [];
      doable.forEach(function (j) {
        dw += j.weight * (j.season[season] || 1) * eventJobBoost(state, j.key);
        dpool.push({ job: j, w: dw });
      });
      var r2 = rng(state) * dw;
      chosen = doable[doable.length - 1];
      for (var z = 0; z < dpool.length; z++) { if (r2 <= dpool[z].w) { chosen = dpool[z].job; break; } }
    }

    var jobs = [makeROJob(chosen)];

    // Upsell: additional sold work found during inspection.
    var upsellChance = 0.20 + advisorAvg(state, 'dvi') * 0.055 + upgradeEffect(state, 'upsell') +
      (advisorAvgExp(state) - 1) * 0.02;
    upsellChance *= clamp(0.75 + (state.reputation - 3.5) * 0.14, 0.6, 1.25);
    upsellChance = clamp(upsellChance, 0, 0.85);
    var upsellPool = D.JOBS.filter(function (j) { return j.upsell && j.key !== chosen.key && caps[j.key].ok; });
    var tries = 2;
    while (tries-- > 0 && upsellPool.length && chance(state, upsellChance)) {
      var add = weightedJob(state, upsellPool, season);
      if (!add || jobs.some(function (x) { return x.key === add.key; })) break;
      jobs.push(makeROJob(add));
      upsellChance *= 0.45;
    }
    // Work presented but declined goes into the follow-up pool.
    if (chance(state, 0.45)) {
      var declined = pick(state, D.JOBS);
      state.declinedPool += declined.bookHours * state.prices.laborRate * 0.6;
    }

    return {
      id: 'RO' + (state.nextId++),
      customer: pick(state, D.FIRST_NAMES) + ' ' + pick(state, D.LAST_NAMES),
      soldDay: state.day,
      source: src.key,
      aroMult: src.aro,
      isComeback: false,
      sat: 4.65,
      jobs: jobs
    };
  }

  /* Weighted pick across a job list, using market frequency and season. */
  function weightedJob(state, list, season) {
    var total = 0, acc = [];
    list.forEach(function (j) {
      total += j.weight * (j.season[season] || 1) * eventJobBoost(state, j.key);
      acc.push(total);
    });
    if (total <= 0) return null;
    var r = rng(state) * total;
    for (var i = 0; i < acc.length; i++) { if (r <= acc[i]) return list[i]; }
    return list[list.length - 1];
  }

  function makeROJob(job) {
    return {
      key: job.key, name: job.name, bookHours: job.bookHours, remaining: job.bookHours,
      parts: job.parts, partsCost: 0, done: false, waitingParts: false, quality: 1
    };
  }

  /* Dispatch open work to bays and technicians. */
  function produce(state, res) {
    var hoursPerBay = shiftHours(state) + upgradeEffect(state, 'throughputStart');
    var bayHours = state.bays.map(function (b) {
      if (b.readyDay > state.day || b.downUntil > state.day) return 0;
      return hoursPerBay;
    });
    res.bayHoursAvail = bayHours.reduce(function (a, b) { return a + b; }, 0);

    var techHours = state.techs.map(function (t) {
      if (t.trainingUntil > state.day) return 0;
      return Math.min(t.scheduledHours, shiftHours(state));
    });
    var techBilled = state.techs.map(function () { return 0; });
    var techActual = state.techs.map(function () { return 0; });

    // Oldest promised work first — that is how a real dispatch board runs.
    var queue = state.openROs.slice().sort(function (a, b) { return a.soldDay - b.soldDay; });

    for (var qi = 0; qi < queue.length; qi++) {
      var ro = queue[qi];
      for (var ji = 0; ji < ro.jobs.length; ji++) {
        var job = ro.jobs[ji];
        if (job.done) continue;
        var jobDef = D.jobByKey[job.key];

        // Parts first.
        if (!job.partsTaken) {
          var pc = takeParts(state, { parts: job.parts }, res);
          if (pc === false) { job.waitingParts = true; continue; }
          job.waitingParts = false;
          job.partsTaken = true;
          job.partsCost = pc;
        }

        var guard = 0;
        while (!job.done && guard++ < 30) {
          var bi = findBay(state, jobDef, bayHours);
          if (bi < 0) break;
          var ti = findTech(state, jobDef, techHours);
          if (ti < 0) break;
          var tech = state.techs[ti];
          var bay = state.bays[bi];
          var rate = productionRate(tech, bay, jobDef);
          var needActual = job.remaining / rate;
          var avail = Math.min(bayHours[bi], techHours[ti]);
          var spend = Math.min(needActual, avail);
          if (spend <= 0.01) break;
          var progress = spend * rate;
          job.remaining -= progress;
          bayHours[bi] -= spend;
          techHours[ti] -= spend;
          techBilled[ti] += progress;
          techActual[ti] += spend;
          res.billedHours += progress;
          res.actualHours += spend;
          res.bayHoursUsed += spend;
          if (job.remaining <= 0.005) {
            job.remaining = 0;
            job.done = true;
            job.techId = tech.id;
            job.bayId = bay.id;
            job.quality = qualityRoll(state, tech, bay, jobDef);
            res.jobsDone[job.key] = (res.jobsDone[job.key] || 0) + 1;
          }
        }
      }
    }

    state.techs.forEach(function (t, i) {
      t.lifetimeBilled += techBilled[i];
      t.lifetimeActual += techActual[i];
      t._todayBilled = techBilled[i];
      t._todayActual = techActual[i];
      var worked = techActual[i];
      t.fatigue = clamp(t.fatigue * 0.75 + (worked > 8 ? 0.18 : worked > 6 ? 0.06 : -0.05), 0, 1);
      t.morale = clamp(t.morale + (techBilled[i] > 5 ? 0.012 : -0.010) - t.fatigue * 0.008, 0.2, 1);
    });
    state.bays.forEach(function (b, i) {
      var avail = (b.readyDay > state.day || b.downUntil > state.day) ? 0 : hoursPerBay;
      b.utilization = avail > 0 ? clamp((avail - bayHours[i]) / avail, 0, 1) : 0;
    });
  }

  function findBay(state, jobDef, bayHours) {
    var best = -1, bestSpeed = 0;
    for (var i = 0; i < state.bays.length; i++) {
      if (bayHours[i] <= 0.01) continue;
      var b = state.bays[i];
      if (jobDef.bays.indexOf(b.type) < 0) continue;
      var tags = bayTags(b);
      if (!jobDef.tags.every(function (t) { return tags[t]; })) continue;
      var sp = baySpeed(b);
      if (sp > bestSpeed) { bestSpeed = sp; best = i; }
    }
    return best;
  }

  function findTech(state, jobDef, techHours) {
    var best = -1, bestScore = -1;
    for (var i = 0; i < state.techs.length; i++) {
      if (techHours[i] <= 0.01) continue;
      var t = state.techs[i];
      if (!jobDef.certs.every(function (c) { return t.certs.indexOf(c) >= 0; })) continue;
      var skill = t.skills[jobDef.skill] || 1;
      var score = skill * 2 + t.efficiency;
      if (skill + 1 < jobDef.difficulty) score -= 4;   // last resort
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function productionRate(tech, bay, jobDef) {
    var skill = tech.skills[jobDef.skill] || 1;
    var skillMult = 0.68 + skill * 0.095;
    if (skill + 1 < jobDef.difficulty) skillMult *= 0.72;         // in over their head
    var fatigueMult = 1 - tech.fatigue * 0.12;
    var moraleMult = 0.9 + tech.morale * 0.15;
    return Math.max(0.25, tech.efficiency * skillMult * baySpeed(bay) * fatigueMult * moraleMult);
  }

  function qualityRoll(state, tech, bay, jobDef) {
    var skill = tech.skills[jobDef.skill] || 1;
    var gap = Math.max(0, jobDef.difficulty - skill);
    var p = 0.075 + gap * 0.055 - tech.quality * 0.06 - bayQuality(bay) -
      D.SUPPLIERS[state.supplier].qualityMod * 0.5 + tech.fatigue * 0.03;
    p = clamp(p, 0.004, 0.42);
    if (chance(state, p)) {
      state.comebacks.push({
        day: state.day + rndInt(state, 2, 7), jobKey: jobDef.key,
        customer: 'Comeback', techId: tech.id
      });
      return 0;   // flagged: this one is coming back
    }
    return 1;
  }

  /* Finish and hand back every RO whose work is complete. */
  function deliver(state, res, recaptured) {
    var still = [];
    var satSum = 0, satCount = 0;
    var extraLabor = recaptured || 0;

    state.openROs.forEach(function (ro) {
      var allDone = ro.jobs.every(function (j) { return j.done; });
      if (!allDone) {
        // Turnaround itself is scored at delivery; this is the extra sting of
        // telling a customer their car is stuck waiting on a part.
        if (ro.jobs.some(function (j) { return j.waitingParts; })) ro.sat -= 0.30;
        still.push(ro);
        return;
      }
      var labor = 0, partsCost = 0, partsRev = 0, hasComeback = false;
      ro.jobs.forEach(function (j) {
        var def = D.jobByKey[j.key];
        if (DIAG_BILLED[j.key]) {
          labor += state.prices.diagFee + Math.max(0, j.bookHours - 1) * state.prices.laborRate;
        } else {
          labor += j.bookHours * state.prices.laborRate;
        }
        partsCost += j.partsCost || 0;
        var k;
        for (k in j.parts) {
          var unit = state.invCost[k];
          partsRev += j.parts[k] * unit * partsMarkupFor(state, unit, k);
        }
        if (j.quality === 0) hasComeback = true;
      });
      if (ro.isComeback) { labor = 0; partsRev = 0; }
      labor *= ro.aroMult;
      var coupon = state.prices.coupon / 100;
      labor *= (1 - coupon);
      partsRev *= (1 - coupon * 0.4);

      var turnaround = state.day - ro.soldDay;
      var waitTol = 1 + upgradeEffect(state, 'waitTolerance');
      var sat = ro.sat;
      sat -= Math.max(0, turnaround - waitTol) * 0.42;
      sat += upgradeEffect(state, 'csi');
      sat += advisorAvg(state, 'csi') * 0.09;
      sat += D.SUPPLIERS[state.supplier].csiMod;
      var pi = priceIndex(state), tol = priceTolerance(state);
      sat -= Math.max(0, pi - tol) * 2.4;
      sat += Math.max(0, tol - pi) * 0.8;
      if (hasComeback) sat -= 0.9;
      if (ro.isComeback) sat -= 1.4;
      sat = clamp(sat, 1, 5);
      satSum += sat; satCount++;

      res.laborRevenue += labor;
      res.partsRevenue += partsRev;
      res.partsCost += partsCost;
      res.cars++;
      res.completed++;
      state.stats.carsServed++;

      // Reviews
      var reviewP = 0.16 + advisorAvg(state, 'csi') * 0.02 + (sat >= 4.7 ? 0.10 : 0) + (sat <= 2.5 ? 0.28 : 0);
      if (chance(state, reviewP)) {
        var stars = clamp(Math.round(sat * 2) / 2, 1, 5);
        state.reviewCount++;
        state.reputation = state.reputation + (stars - state.reputation) * (2.6 / (state.reviewCount + 12));
        res.reviews.push({ customer: ro.customer, stars: stars, sat: round2(sat) });
      }
      // Retention: happy customers become "your" customers.
      var retain = clamp((sat - 3.2) * 0.34 + advisorAvg(state, 'csi') * 0.04, -0.25, 0.55);
      if (chance(state, Math.abs(retain))) {
        if (retain > 0) { state.customerBase += 1; res.newCustomers++; }
        else state.customerBase = Math.max(0, state.customerBase - 1);
      }
    });

    if (extraLabor > 0 && res.cars > 0) {
      res.laborRevenue += extraLabor;
    }
    state.openROs = still;
    res.carryover = still.length;
    res.avgSat = satCount ? round2(satSum / satCount) : 0;
    res.revenue = res.laborRevenue + res.partsRevenue;
    res.grossProfit = res.revenue - res.partsCost;
    state.cash += res.revenue;
  }

  function payroll(state, res) {
    var techPay = 0, advisorPay = 0;
    state.techs.forEach(function (t) {
      if (t.trainingUntil > state.day) {
        // Half guarantee while they are sitting in a classroom you paid for.
        techPay += D.FINANCE.techGuaranteeHours * t.flatRate * 0.5;
        return;
      }
      var billed = t._todayBilled || 0;
      techPay += Math.max(billed, D.FINANCE.techGuaranteeHours) * t.flatRate;
    });
    state.advisors.forEach(function (a) {
      advisorPay += a.salary;
      advisorPay += Math.max(0, res.grossProfit) * D.FINANCE.advisorCommissionOnGP /
        Math.max(1, state.advisors.length);
    });
    var burden = 1 + D.FINANCE.payrollTaxRate;
    res.techPay = techPay * burden;
    res.advisorPay = advisorPay * burden;
    res.payroll = res.techPay + res.advisorPay;
    state.cash -= res.payroll;
  }

  function finishFinances(state, res) {
    res.fixed = dailyFixedCost(state);
    state.cash -= res.fixed;

    res.interest = state.debt * D.FINANCE.apr / 365;
    state.cash -= res.interest;
    state.debt += 0;

    // Warranty reserve for comeback labor.
    var reserve = res.laborRevenue * D.FINANCE.warrantyReserveRate;
    state.cash -= reserve;
    res.warranty = reserve;

    res.expenses = res.payroll + res.fixed + res.adSpend + res.interest + res.partsCost +
      res.hotshotCost + reserve;
    res.gpAfterLabor = res.grossProfit - (res.techPay || 0);
    res.net = res.revenue - (res.payroll + res.fixed + res.adSpend + res.interest + res.partsCost + reserve);

    // Monthly income tax on trailing profit.
    if (state.day % 30 === 0) {
      var profit30 = state.history.slice(-30).reduce(function (a, h) { return a + h.net; }, 0) + res.net;
      if (profit30 > 0) {
        var tax = profit30 * D.FINANCE.incomeTaxRate;
        state.cash -= tax;
        res.taxes = tax;
        res.notes.push('Quarterly estimated tax payment: ' + fmtMoney(tax) + '.');
      }
    }

    // Credit line auto-draw.
    if (state.cash < 0) {
      var need = -state.cash;
      var room = D.FINANCE.creditLimit - state.debt;
      if (need <= room) {
        state.debt += need;
        state.cash = 0;
        res.notes.push('Drew ' + fmtMoney(need) + ' on the line of credit (balance ' + fmtMoney(state.debt) + ').');
      } else {
        state.debt += room;
        state.cash += room;
        state.gameOver = {
          day: state.day,
          reason: 'You ran out of cash and credit. The landlord changed the locks.'
        };
      }
    } else if (state.debt > 0 && state.cash > 12000) {
      // Sweep surplus cash against the line.
      var pay = Math.min(state.debt, state.cash - 12000);
      state.debt -= pay;
      state.cash -= pay;
      res.debtPaid = pay;
    }

    state.stats.revenueTotal += res.revenue;
    state.stats.profitTotal += res.net;
  }

  function pushHistory(state, res) {
    state.history.push({
      day: res.day, revenue: res.revenue, net: res.net, cars: res.cars,
      gp: res.grossProfit, billed: res.billedHours, actual: res.actualHours,
      cash: state.cash, rep: state.reputation, sold: res.sold, closed: res.closed, presented: res.presented,
      aro: res.cars ? res.revenue / res.cars : 0, adSpend: res.adSpend,
      util: res.bayHoursAvail ? res.bayHoursUsed / res.bayHoursAvail : 0
    });
    if (state.history.length > 800) state.history.shift();

    var last30 = state.history.slice(-30);
    var rev = 0, cars = 0, billed = 0, actual = 0, util = 0, closed = 0, pres = 0;
    last30.forEach(function (h) {
      rev += h.revenue; cars += h.cars; billed += h.billed; actual += h.actual;
      util += h.util; closed += (h.closed || 0); pres += h.presented;
    });
    state.stats.revenue30 = rev / Math.max(1, last30.length) * 30;
    state.stats.aro30 = cars ? rev / cars : 0;
    state.stats.techEfficiency = actual ? billed / actual : 1;
    state.stats.bayUtilization = last30.length ? util / last30.length : 0;
    state.stats.closeRate = pres ? closed / pres : 0;

    var last7 = state.history.slice(-7);
    var week = last7.reduce(function (a, h) { return a + h.revenue; }, 0);
    if (week > state.stats.bestWeekRevenue) state.stats.bestWeekRevenue = week;
  }

  function checkMilestones(state, res) {
    D.MILESTONES.forEach(function (m) {
      if (state.milestones[m.key]) return;
      if (m.test(state)) {
        state.milestones[m.key] = state.day;
        res.notes.push('Milestone reached: ' + m.name + '.');
        logLine(state, 'Milestone: ' + m.name + '.', 'good');
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Overnight housekeeping
   * ------------------------------------------------------------------ */
  function receiveOrders(state, res) {
    var delay = 0;
    state.activeEvents.forEach(function (e) { if (e.effect && e.effect.orderDelay) delay += e.effect.orderDelay; });
    var still = [];
    state.onOrder.forEach(function (o) {
      if (o.arriveDay + (o.delayed ? 0 : delay) <= state.day) {
        var have = state.inventory[o.cat] || 0;
        var unit = o.cost / o.units;
        state.invCost[o.cat] = have + o.units > 0
          ? (state.invCost[o.cat] * have + unit * o.units) / (have + o.units)
          : unit;
        state.inventory[o.cat] = have + o.units;
        res.notes.push('Received ' + o.units + ' × ' + D.partByKey[o.cat].name + '.');
      } else {
        if (delay && !o.delayed) { o.arriveDay += delay; o.delayed = true; }
        still.push(o);
      }
    });
    state.onOrder = still;
  }

  function finishConstruction(state, res) {
    var still = [];
    state.construction.forEach(function (c) {
      if (c.readyDay <= state.day) {
        applyConstruction(state, c, res);
      } else still.push(c);
    });
    state.construction = still;
  }

  function applyConstruction(state, c, res) {
    if (c.kind === 'bay') {
      var bay = state.bays.filter(function (b) { return b.id === c.bayId; })[0];
      if (bay) bay.readyDay = state.day;
      res.notes.push('New ' + c.label + ' is open for business.');
    } else if (c.kind === 'tool') {
      var b2 = state.bays.filter(function (b) { return b.id === c.bayId; })[0];
      if (b2) b2.toolLevel = c.level;
      res.notes.push(c.label + ' installed.');
    } else if (c.kind === 'upgrade') {
      var u = D.UPGRADES.filter(function (x) { return x.key === c.key; })[0];
      state.upgrades[c.key] = (state.upgrades[c.key] || 0) + 1;
      if (u.effect.parking) state.parking += u.effect.parking;
      if (u.effect.storage) state.storage += u.effect.storage;
      res.notes.push(u.name + ' complete.');
    }
    logLine(state, (res.notes[res.notes.length - 1] || c.label), 'good');
  }

  function maybeEvent(state, res) {
    if (state.pendingChoice) return;
    if (state.day < 6) return;
    if (!chance(state, 0.16)) return;
    var cal = calendar(state.day);
    var pool = D.EVENTS.filter(function (e) {
      if (e.season && e.season.indexOf(cal.season) < 0) return false;
      if (e.minDay && state.day < e.minDay) return false;
      if (e.minRep && state.reputation < e.minRep) return false;
      if (e.maxRep && state.reputation > e.maxRep) return false;
      return true;
    });
    if (!pool.length) return;
    var totalW = pool.reduce(function (a, e) { return a + e.weight; }, 0);
    var r = rng(state) * totalW, acc = 0, chosen = null;
    for (var i = 0; i < pool.length; i++) {
      acc += pool[i].weight;
      if (r <= acc) { chosen = pool[i]; break; }
    }
    if (!chosen) return;

    if (chosen.choice) {
      state.pendingChoice = makeChoice(state, chosen);
      res.events.push({ name: chosen.name, text: chosen.text, choice: true });
      logLine(state, chosen.name + ': ' + chosen.text, 'event');
      return;
    }
    var e = chosen.effect || {};
    var until = state.day + (e.days || 1);
    state.activeEvents.push({ key: chosen.key, name: chosen.name, until: until, effect: e });
    if (e.reputationBump) state.reputation = clamp(state.reputation + e.reputationBump, 1, 5);
    if (e.customerBase) state.customerBase += e.customerBase;
    if (e.cost) { state.cash -= e.cost; }
    if (e.insuranceDelta) state.fixedCosts.insurance += e.insuranceDelta;
    if (e.bayDown) {
      var live = state.bays.filter(function (b) { return b.readyDay <= state.day && b.downUntil <= state.day; });
      if (live.length) {
        var b = pick(state, live);
        b.downUntil = state.day + (e.days || 2);
      }
    }
    res.events.push({ name: chosen.name, text: chosen.text });
    logLine(state, chosen.name + ': ' + chosen.text, 'event');
  }

  function makeChoice(state, evt) {
    if (evt.choice === 'fleet') {
      return {
        key: 'fleet', name: evt.name, text: evt.text,
        options: [
          { key: 'accept', label: 'Sign the contract (-18% labor rate on their work, +45 loyal customers)',
            apply: function (s) {
              s.customerBase += 45;
              s.fleetContract = true;
              s.activeEvents.push({ key: 'fleet', name: 'Fleet Account', until: s.day + 120,
                effect: { trafficMult: 1.14 } });
              logLine(s, 'You signed the fleet account. Steady volume, thinner margin.', 'good');
            } },
          { key: 'decline', label: 'Pass — your bays are worth more at retail rates',
            apply: function (s) { logLine(s, 'You passed on the fleet account.'); } }
        ]
      };
    }
    if (evt.choice === 'poach') {
      var target = state.techs.length ? state.techs[state.techs.length - 1] : null;
      return {
        key: 'poach', name: evt.name, text: evt.text + (target ? ' (' + target.name + ')' : ''),
        options: [
          { key: 'raise', label: 'Give a $4/hr flat-rate raise to keep them',
            apply: function (s) {
              if (target) { target.flatRate += 4; target.morale = clamp(target.morale + 0.2, 0, 1);
                logLine(s, target.name + ' took the raise and stayed.', 'good'); }
            } },
          { key: 'let', label: 'Let them walk',
            apply: function (s) {
              if (target) {
                s.techs = s.techs.filter(function (t) { return t.id !== target.id; });
                logLine(s, target.name + ' left for the dealership.', 'bad');
              }
            } }
        ]
      };
    }
    return null;
  }

  function resolveChoice(state, optionKey) {
    if (!state.pendingChoice) return;
    var opt = state.pendingChoice.options.filter(function (o) { return o.key === optionKey; })[0];
    if (opt) opt.apply(state);
    state.pendingChoice = null;
  }

  /* ------------------------------------------------------------------ *
   * Player actions
   * ------------------------------------------------------------------ */
  function orderParts(state, catKey, units) {
    units = Math.max(0, Math.floor(units));
    if (!units) return { ok: false, msg: 'Nothing ordered.' };
    var cat = D.partByKey[catKey];
    var prog = D.ORDER_PROGRAMS[state.orderProgram];
    var unitCost = cat.cost * D.SUPPLIERS[state.supplier].costMult * prog.costMult;
    var cost = unitCost * units;
    if (cost > state.cash + (D.FINANCE.creditLimit - state.debt))
      return { ok: false, msg: 'Not enough cash or credit for that order.' };
    var incoming = state.onOrder.reduce(function (a, o) { return a + o.units * D.partByKey[o.cat].shelf; }, 0);
    if (storageUsed(state) + incoming + units * cat.shelf > state.storage)
      return { ok: false, msg: 'Not enough parts-room storage. Add shelving.' };
    state.cash -= cost;
    state.onOrder.push({ cat: catKey, units: units, cost: cost, arriveDay: state.day + prog.days });
    logLine(state, 'Ordered ' + units + ' × ' + cat.name + ' for ' + fmtMoney(cost) +
      ' (' + prog.name + ').');
    return { ok: true, msg: 'Ordered ' + units + ' ' + cat.unit + ' for ' + fmtMoney(cost) + '.' };
  }

  function buildBay(state, type) {
    var t = D.BAY_TYPES[type];
    if (state.bays.length >= 12) return { ok: false, msg: 'The building is full. No room for another bay.' };
    if (t.buildCost > state.cash) return { ok: false, msg: 'Not enough cash.' };
    state.cash -= t.buildCost;
    var bay = makeBay(state, type, 1);
    bay.readyDay = state.day + t.buildDays;
    state.bays.push(bay);
    state.construction.push({ kind: 'bay', bayId: bay.id, label: t.name, readyDay: bay.readyDay });
    logLine(state, 'Broke ground on a new ' + t.name + '. Ready in ' + t.buildDays + ' days.');
    return { ok: true, msg: t.name + ' under construction (' + t.buildDays + ' days).' };
  }

  function upgradeTools(state, bayId) {
    var bay = state.bays.filter(function (b) { return b.id === bayId; })[0];
    if (!bay) return { ok: false, msg: 'No such bay.' };
    if (state.construction.some(function (c) { return c.kind === 'tool' && c.bayId === bayId; }))
      return { ok: false, msg: 'Tooling is already on order for that bay.' };
    var pkgs = D.TOOL_PACKAGES[bay.type];
    if (bay.toolLevel >= pkgs.length) return { ok: false, msg: 'That bay is fully tooled.' };
    var next = pkgs[bay.toolLevel];
    if (next.cost > state.cash) return { ok: false, msg: 'Not enough cash for ' + next.name + '.' };
    state.cash -= next.cost;
    state.construction.push({ kind: 'tool', bayId: bayId, level: next.level,
      label: next.name, readyDay: state.day + next.days });
    logLine(state, 'Ordered ' + next.name + ' for ' + bay.name + '.');
    return { ok: true, msg: next.name + ' arrives in ' + next.days + ' days.' };
  }

  function buyUpgrade(state, key) {
    var u = D.UPGRADES.filter(function (x) { return x.key === key; })[0];
    if (!u) return { ok: false, msg: 'Unknown upgrade.' };
    if (!u.repeatable && state.upgrades[key]) return { ok: false, msg: 'Already installed.' };
    if (state.construction.some(function (c) { return c.kind === 'upgrade' && c.key === key; }))
      return { ok: false, msg: 'Already in progress.' };
    if (u.cost > state.cash) return { ok: false, msg: 'Not enough cash.' };
    state.cash -= u.cost;
    state.construction.push({ kind: 'upgrade', key: key, label: u.name, readyDay: state.day + u.days });
    logLine(state, 'Bought ' + u.name + ' for ' + fmtMoney(u.cost) + '.');
    return { ok: true, msg: u.name + ' in ' + u.days + ' day(s).' };
  }

  function trainTech(state, techId, courseKey) {
    var tech = state.techs.filter(function (t) { return t.id === techId; })[0];
    var course = D.TECH_TRAINING.filter(function (c) { return c.key === courseKey; })[0];
    if (!tech || !course) return { ok: false, msg: 'Not found.' };
    if (tech.trainingUntil > state.day) return { ok: false, msg: tech.name + ' is already in training.' };
    if (course.skill && tech.skills[course.skill] >= 5 && !course.cert)
      return { ok: false, msg: tech.name + ' has maxed that skill.' };
    if (course.cert && tech.certs.indexOf(course.cert) >= 0)
      return { ok: false, msg: 'Already certified.' };
    if (course.cost > state.cash) return { ok: false, msg: 'Not enough cash.' };
    state.cash -= course.cost;
    tech.trainingUntil = state.day + course.days;
    tech.trainingName = course.name;
    if (course.skill) tech.skills[course.skill] = Math.min(5, tech.skills[course.skill] + (course.gain || 1));
    if (course.cert) tech.certs.push(course.cert);
    if (course.efficiency) tech.efficiency = round2(tech.efficiency + course.efficiency);
    if (course.quality) tech.quality = clamp(tech.quality + course.quality, 0, 1);
    tech.morale = clamp(tech.morale + 0.08, 0, 1);
    logLine(state, tech.name + ' enrolled in ' + course.name + ' (' + course.days + ' days out of the shop).');
    return { ok: true, msg: tech.name + ' is in class for ' + course.days + ' day(s).' };
  }

  function advisorTrainingCost(track, level) {
    return track.baseCost + track.costStep * level;
  }

  function trainAdvisor(state, advisorId, trackKey) {
    var adv = state.advisors.filter(function (a) { return a.id === advisorId; })[0];
    var track = D.ADVISOR_TRACKS.filter(function (t) { return t.key === trackKey; })[0];
    if (!adv || !track) return { ok: false, msg: 'Not found.' };
    var level = adv.tracks[trackKey] || 0;
    if (level >= track.max) return { ok: false, msg: 'That track is maxed out.' };
    if (adv.trainingUntil > state.day) return { ok: false, msg: adv.name + ' is already in training.' };
    var cost = advisorTrainingCost(track, level);
    if (cost > state.cash) return { ok: false, msg: 'Not enough cash.' };
    state.cash -= cost;
    adv.tracks[trackKey] = level + 1;
    adv.trainingUntil = state.day + 1;
    adv.trainingName = track.name + ' L' + (level + 1);
    logLine(state, adv.name + ' completed ' + track.name + ' level ' + (level + 1) + '.');
    return { ok: true, msg: adv.name + ' → ' + track.name + ' L' + (level + 1) + '.' };
  }

  function refreshHiringPool(state, free) {
    if (!free) {
      if (state.cash < 600) return { ok: false, msg: 'Recruiting ads cost $600.' };
      state.cash -= 600;
    }
    state.hiringPool.techs = [];
    state.hiringPool.advisors = [];
    var n = 3;
    for (var i = 0; i < n; i++) {
      var tier = rng(state);
      var lvl = tier < 0.45 ? 1 : tier < 0.78 ? 2 : tier < 0.94 ? 3 : 4;
      var skills = {};
      var focus = pick(state, D.SKILL_AREAS).key;
      D.SKILL_AREAS.forEach(function (s) {
        skills[s.key] = clamp(lvl + (s.key === focus ? 1 : 0) - (rng(state) < 0.5 ? 1 : 0), 1, 5);
      });
      var certs = [];
      if (lvl >= 3 && chance(state, 0.45)) certs.push('hvac');
      if (lvl >= 4 && chance(state, 0.30)) certs.push(pick(state, ['diesel', 'adas', 'ev']));
      var t = makeTech(state, {
        skills: skills, certs: certs,
        efficiency: round2(0.82 + lvl * 0.07 + rnd(state, -0.05, 0.08)),
        quality: round2(clamp(0.32 + lvl * 0.12 + rnd(state, -0.08, 0.10), 0.1, 0.95)),
        flatRate: Math.round(20 + lvl * 6.5 + rnd(state, -2, 4))
      });
      t.focus = focus;
      t.signingBonus = lvl >= 3 ? Math.round(rnd(state, 800, 3200)) : 0;
      state.hiringPool.techs.push(t);
    }
    for (var j = 0; j < 2; j++) {
      var exp = rndInt(state, 1, 4);
      var tracks = {};
      D.ADVISOR_TRACKS.forEach(function (tr) { tracks[tr.key] = exp >= 3 && chance(state, 0.4) ? 1 : 0; });
      var a = makeAdvisor(state, {
        experience: exp, tracks: tracks,
        salary: Math.round(150 + exp * 42 + rnd(state, -10, 25))
      });
      a.signingBonus = exp >= 3 ? Math.round(rnd(state, 500, 2000)) : 0;
      state.hiringPool.advisors.push(a);
    }
    state.hiringPool.refreshedDay = state.day;
    return { ok: true, msg: 'New candidates posted.' };
  }

  function hire(state, id) {
    var t = state.hiringPool.techs.filter(function (x) { return x.id === id; })[0];
    if (t) {
      if ((t.signingBonus || 0) > state.cash) return { ok: false, msg: 'Cannot cover the signing bonus.' };
      state.cash -= (t.signingBonus || 0);
      t.hiredDay = state.day;
      state.techs.push(t);
      state.hiringPool.techs = state.hiringPool.techs.filter(function (x) { return x.id !== id; });
      logLine(state, 'Hired technician ' + t.name + ' at $' + t.flatRate + '/flat-rate hour.', 'good');
      return { ok: true, msg: 'Hired ' + t.name + '.' };
    }
    var a = state.hiringPool.advisors.filter(function (x) { return x.id === id; })[0];
    if (a) {
      if ((a.signingBonus || 0) > state.cash) return { ok: false, msg: 'Cannot cover the signing bonus.' };
      state.cash -= (a.signingBonus || 0);
      a.hiredDay = state.day;
      state.advisors.push(a);
      state.hiringPool.advisors = state.hiringPool.advisors.filter(function (x) { return x.id !== id; });
      logLine(state, 'Hired service advisor ' + a.name + ' at ' + fmtMoney(a.salary) + '/day.', 'good');
      return { ok: true, msg: 'Hired ' + a.name + '.' };
    }
    return { ok: false, msg: 'Candidate is gone.' };
  }

  function fire(state, id) {
    var t = state.techs.filter(function (x) { return x.id === id; })[0];
    if (t) {
      var sev = Math.round(t.flatRate * 40);
      if (sev > state.cash) return { ok: false, msg: 'Severance is ' + fmtMoney(sev) + '. Not enough cash.' };
      state.cash -= sev;
      state.techs = state.techs.filter(function (x) { return x.id !== id; });
      state.techs.forEach(function (o) { o.morale = clamp(o.morale - 0.08, 0, 1); });
      logLine(state, 'Let ' + t.name + ' go. Severance ' + fmtMoney(sev) + '.', 'bad');
      return { ok: true, msg: t.name + ' is gone.' };
    }
    var a = state.advisors.filter(function (x) { return x.id === id; })[0];
    if (a) {
      if (state.advisors.length <= 1) return { ok: false, msg: 'Somebody has to write the tickets.' };
      state.cash -= a.salary * 10;
      state.advisors = state.advisors.filter(function (x) { return x.id !== id; });
      logLine(state, 'Let ' + a.name + ' go.', 'bad');
      return { ok: true, msg: a.name + ' is gone.' };
    }
    return { ok: false, msg: 'Not found.' };
  }

  function setPrice(state, key, value) {
    value = Number(value);
    if (isNaN(value)) return;
    if (key === 'laborRate') state.prices.laborRate = clamp(Math.round(value), 60, 400);
    if (key === 'partsMarkup') state.prices.partsMarkup = clamp(round2(value), 1.0, 3.5);
    if (key === 'diagFee') state.prices.diagFee = clamp(Math.round(value), 0, 500);
    if (key === 'coupon') state.prices.coupon = clamp(Math.round(value), 0, 40);
  }

  function setAdSpend(state, key, value) {
    value = Math.max(0, Math.round(Number(value) || 0));
    state.adSpend[key] = value;
  }

  function setSchedule(state, techId, hours) {
    var t = state.techs.filter(function (x) { return x.id === techId; })[0];
    if (t) t.scheduledHours = clamp(Math.round(Number(hours) || 0), 0, shiftHours(state));
  }

  function borrow(state, amount) {
    amount = Math.max(0, Math.round(Number(amount) || 0));
    var room = D.FINANCE.creditLimit - state.debt;
    if (amount > room) return { ok: false, msg: 'Your credit line tops out at ' + fmtMoney(D.FINANCE.creditLimit) + '.' };
    state.debt += amount;
    state.cash += amount;
    logLine(state, 'Drew ' + fmtMoney(amount) + ' on the line of credit.');
    return { ok: true, msg: 'Drew ' + fmtMoney(amount) + '.' };
  }

  function repay(state, amount) {
    amount = Math.max(0, Math.round(Number(amount) || 0));
    amount = Math.min(amount, state.debt, state.cash);
    state.debt -= amount;
    state.cash -= amount;
    return { ok: true, msg: 'Paid down ' + fmtMoney(amount) + '.' };
  }

  /* Suggested parts order to cover the next `days` of expected demand. */
  function suggestOrder(state, days) {
    days = days || 7;
    var f = forecast(state);
    var expectedCars = f.opportunities * estimateCloseRate(state, 1) * days;
    var caps = capabilities(state);
    var cal = calendar(state.day);
    var need = {};
    var totalW = 0;
    var live = D.JOBS.filter(function (j) { return caps[j.key].ok; });
    live.forEach(function (j) { totalW += j.weight * (j.season[cal.season] || 1) * eventJobBoost(state, j.key); });
    live.forEach(function (j) {
      var share = (j.weight * (j.season[cal.season] || 1) * eventJobBoost(state, j.key)) / (totalW || 1);
      var count = expectedCars * share * 1.25;   // upsell allowance
      for (var k in j.parts) need[k] = (need[k] || 0) + j.parts[k] * count;
    });
    var out = [];
    D.PART_CATEGORIES.forEach(function (p) {
      var want = Math.ceil(need[p.key] || 0);
      var have = state.inventory[p.key] || 0;
      var coming = state.onOrder.filter(function (o) { return o.cat === p.key; })
        .reduce(function (a, o) { return a + o.units; }, 0);
      var order = Math.max(0, want - have - coming);
      out.push({ cat: p.key, name: p.name, have: have, coming: coming, want: want, order: order });
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Save / load
   * ------------------------------------------------------------------ */
  function serialize(state) {
    var copy = JSON.parse(JSON.stringify(state, function (k, v) {
      return typeof v === 'function' ? undefined : v;
    }));
    copy.pendingChoice = state.pendingChoice ? { key: state.pendingChoice.key } : null;
    return JSON.stringify(copy);
  }

  function deserialize(json) {
    var s = JSON.parse(json);
    if (s.pendingChoice && s.pendingChoice.key) {
      var evt = D.EVENTS.filter(function (e) { return e.choice === s.pendingChoice.key; })[0];
      s.pendingChoice = evt ? makeChoice(s, evt) : null;
    }
    return s;
  }

  var ENGINE = {
    newGame: newGame,
    runDay: runDay,
    forecast: forecast,
    channelLeads: channelLeads,
    menuCoverage: menuCoverage,
    calendar: calendar,
    capabilities: capabilities,
    advisorCapacity: advisorCapacity,
    advisorAvg: advisorAvg,
    estimateCloseRate: estimateCloseRate,
    priceIndex: priceIndex,
    priceTolerance: priceTolerance,
    carsOnSite: carsOnSite,
    storageUsed: storageUsed,
    dailyFixedCost: dailyFixedCost,
    shiftHours: shiftHours,
    bayTools: bayTools,
    bayTags: bayTags,
    baySpeed: baySpeed,
    unitCostFor: unitCostFor,
    partsMarkupFor: partsMarkupFor,
    upgradeEffect: upgradeEffect,
    advisorTrainingCost: advisorTrainingCost,
    productionRate: productionRate,
    orderParts: orderParts,
    suggestOrder: suggestOrder,
    buildBay: buildBay,
    upgradeTools: upgradeTools,
    buyUpgrade: buyUpgrade,
    trainTech: trainTech,
    trainAdvisor: trainAdvisor,
    refreshHiringPool: refreshHiringPool,
    hire: hire,
    fire: fire,
    setPrice: setPrice,
    setAdSpend: setAdSpend,
    setSchedule: setSchedule,
    borrow: borrow,
    repay: repay,
    resolveChoice: resolveChoice,
    serialize: serialize,
    deserialize: deserialize,
    fmtMoney: fmtMoney,
    clamp: clamp,
    DIAG_BILLED: DIAG_BILLED
  };

  root.AutoShopEngine = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
