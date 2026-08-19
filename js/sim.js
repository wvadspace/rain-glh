/*
 * The day simulation.
 *
 * A day runs in five passes:
 *   1. open()        - who is here, which bays work, what the weather did
 *   2. demand()      - how many opportunities the marketing and reputation bought
 *   3. counter()     - advisors quote, close and upsell them into repair orders
 *   4. floor()       - bays and techs consume hours, parts get burned, cars finish
 *   5. close()       - payroll, overhead, reputation, morale, events, accounting
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  var D = NS.DATA;
  var S = NS.State;

  /* Overall traffic curve for the year, independent of job mix. */
  var SEASON_OVERALL = [0.87, 0.90, 1.00, 1.06, 1.10, 1.12, 1.09, 1.06, 1.04, 1.02, 0.97, 0.91];

  var PSEUDO_CHANNELS = {
    walkin: { id: 'walkin', name: 'Walk-in / drive-by', intent: 0.94, price: 1.12, ticket: 0.95 },
    repeat: { id: 'repeat', name: 'Repeat customer', intent: 1.30, price: 0.82, ticket: 1.12 },
    fleet: { id: 'fleet', name: 'Fleet account', intent: 1.55, price: 0.55, ticket: 1.25 }
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ----------------------------------------------------- appointment book */

  function dowFor(state, day) {
    return ((state.dow + (day - state.day)) % 7 + 7) % 7;
  }

  function isOpenDay(state, day) {
    var dow = dowFor(state, day);
    if (dow === 6) return false;
    if (dow === 5 && !state.policy.openSaturday) return false;
    return true;
  }

  /** Average book hours the crew turns out per clock hour, right now. */
  function shopEfficiency(state) {
    var techs = S.availableTechs(state);
    if (!techs.length) techs = state.techs;
    if (!techs.length) return 0.8;
    var generic = { skill: 'general', requires: {} };
    var effSum = 0;
    techs.forEach(function (t) { effSum += techEfficiency(state, t, generic); });
    var bays = S.activeBays(state);
    var speedSum = 0;
    bays.forEach(function (b) { speedSum += bayToolSpeed(b, generic); });
    var speed = bays.length ? speedSum / bays.length : 1;
    return (effSum / techs.length) * speed;
  }

  /** Sellable book hours on a given future day. */
  function capacityFor(state, day) {
    if (!isOpenDay(state, day)) return 0;
    var bays = S.activeBays(state).length;
    var techs = day === state.day ? S.availableTechs(state).length : state.techs.length;
    var stations = Math.min(bays, techs);
    if (stations <= 0) return 0;
    var otCap = state.policy.allowOvertime
      ? Math.max(0, D.CONFIG.maxShiftHours - state.policy.shiftHours) * 0.5 : 0;
    return stations * (state.policy.shiftHours + otCap) * shopEfficiency(state);
  }

  function bookedOn(state, day) {
    return state.bookedHours[day] || 0;
  }

  /** Cars physically on the property on a given day. */
  function lotLoad(state, day) {
    var n = 0;
    state.wip.forEach(function () { n++; });
    state.appointments.forEach(function (a) { if (a.scheduledDay === day) n++; });
    return n;
  }

  /**
   * Find the first day this repair order can be promised. Returns null when the
   * shop is booked past what the customer will tolerate.
   */
  function findSlot(state, hours, tolerance) {
    var overbook = state.policy.overbook || 1.0;
    for (var d = state.day; d <= state.day + tolerance; d++) {
      if (!isOpenDay(state, d)) continue;
      var cap = capacityFor(state, d) * overbook;
      if (cap <= 0) continue;
      if (bookedOn(state, d) + hours > cap) continue;
      if (lotLoad(state, d) >= Math.round(state.parking.spaces * (d === state.day ? 1.7 : 1.2))) continue;
      return d;
    }
    return null;
  }

  function bookHours(state, day, hours) {
    state.bookedHours[day] = (state.bookedHours[day] || 0) + hours;
  }

  /** How many days out the shop is currently selling. */
  function bookedOutDays(state) {
    for (var d = state.day; d <= state.day + 21; d++) {
      if (!isOpenDay(state, d)) continue;
      var cap = capacityFor(state, d) * (state.policy.overbook || 1);
      if (cap > 0 && bookedOn(state, d) < cap * 0.92) return d - state.day;
    }
    return 21;
  }

  /* ------------------------------------------------------------- valuation */

  function netWorth(state) {
    return state.cash
      + S.inventoryValue(state)
      + S.receivablesTotal(state)
      + S.equipmentValue(state)
      - state.loan.principal
      - state.credit.balance
      - state.taxes.accrued;
  }

  /* ------------------------------------------------------------ capability */

  function bayCanDo(bay, job) {
    var req = job.requires || {};
    for (var k in req) {
      if (!req[k]) continue;
      if ((bay.tools[k] || 0) < req[k]) return false;
    }
    return true;
  }

  function shopCanDo(state, job) {
    return S.activeBays(state).some(function (b) { return bayCanDo(b, job); });
  }

  /** Throughput multiplier from the tooling actually installed in the bay. */
  function bayToolSpeed(bay, job) {
    var speed = D.TOOLS.handtools.levels[bay.tools.handtools || 0].speed;
    var req = job.requires || {};
    for (var k in req) {
      if (!req[k] || k === 'handtools') continue;
      var lvl = bay.tools[k] || 0;
      speed *= D.TOOLS[k].levels[lvl].speed;
    }
    return speed;
  }

  function techEfficiency(state, tech, job) {
    var base = 0.62 + 0.10 * tech.level;
    var spec;
    if (tech.specialties.indexOf(job.skill) >= 0) spec = 1.14;
    else if (job.skill === 'general') spec = 1.0;
    else spec = 0.90;
    var fatigueMult = 1 - tech.fatigue * 0.18;
    var moraleMult = 0.88 + tech.morale * 0.18;
    var shopBonus = S.upgradeEffect(state, 'efficiency');
    return Math.max(0.35, base * spec * (1 + tech.efficiencyBonus + shopBonus) * fatigueMult * moraleMult);
  }

  /* ---------------------------------------------------------------- pricing */

  function partsCostFor(state, job) {
    return job.partsCost * (state.market.partPrices[job.cat] || 1);
  }

  function quoteLine(state, job, discount) {
    var cost = partsCostFor(state, job);
    var partsPrice = cost * (1 + state.pricing.partsMarkup);
    var laborPrice;
    if (job.priceMode === 'fixed') {
      laborPrice = job.fixedPrice;
      partsPrice = 0;
    } else if (job.diag) {
      laborPrice = state.pricing.diagFee * job.bookHours;
    } else {
      laborPrice = state.pricing.laborRate * job.bookHours;
    }
    var d = (discount || 0) + state.pricing.couponPct;
    laborPrice *= (1 - d);
    partsPrice *= (1 - d * 0.4);
    return {
      jobId: job.id,
      name: job.name,
      cat: job.cat,
      bookHours: job.bookHours,
      partsCost: cost,
      partsPrice: partsPrice,
      laborPrice: laborPrice,
      total: laborPrice + partsPrice
    };
  }

  function fairPrice(state, job) {
    var cost = partsCostFor(state, job);
    if (job.priceMode === 'fixed') return job.fixedPrice;
    var labor = job.diag ? 128 * job.bookHours : state.market.laborRate * job.bookHours;
    return labor + cost * (1 + D.CONFIG.marketPartsMarkup);
  }

  /* ----------------------------------------------------------- modifiers */

  function modSum(state, key) {
    var total = 0;
    state.modifiers.forEach(function (m) {
      if (typeof m[key] === 'number') total += m[key];
    });
    return total;
  }

  function jobBias(state, jobId) {
    var mult = 1;
    state.modifiers.forEach(function (m) {
      if (m.jobBias && m.jobBias[jobId]) mult *= m.jobBias[jobId];
    });
    return mult;
  }

  /* ------------------------------------------------------------- marketing */

  function saturate(spend, sat) {
    if (spend <= 0) return 0;
    return sat * (1 - Math.exp(-spend / sat));
  }

  /**
   * Returns { total, breakdown, brandLift, mix } where mix is a weighted list of
   * {channel, count} used to give each arriving customer a provenance.
   */
  function computeDemand(state, rng, weatherId, forReal) {
    var month = state.month;
    var weather = D.WEATHER_BY_ID[weatherId];
    var breakdown = {};
    var leads = [];

    /* Brand awareness from radio lifts every other channel. */
    var radioStock = state.adStock.radio || 0;
    var brandLift = 1 + Math.min(0.34, Math.sqrt(radioStock) / 62);

    var bookingBonus = 1 + S.upgradeEffect(state, 'leadConv');

    D.CHANNELS.forEach(function (ch) {
      var spend = state.marketing[ch.id] || 0;
      var n = 0;
      if (ch.mode === 'instant') {
        n = saturate(spend, ch.saturation) / ch.cpl * brandLift * bookingBonus;
      } else if (ch.mode === 'stock') {
        var stock = state.adStock[ch.id] || 0;
        var k = ch.id === 'seo' ? 0.62 : 0.30;
        n = Math.sqrt(Math.max(0, stock)) * k * brandLift * bookingBonus;
      } else if (ch.mode === 'brand') {
        n = Math.sqrt(Math.max(0, state.adStock[ch.id] || 0)) * 0.10;
      } else if (ch.mode === 'delayed') {
        n = 0; // delivered out of the mail queue below
      } else if (ch.mode === 'referral') {
        var potential = state.customers.retained * 0.0042 * Math.max(0, state.reputation - 2.2);
        n = Math.min(potential, saturate(spend, ch.saturation) / ch.cpl) * bookingBonus;
      }
      if (n > 0.0001) {
        breakdown[ch.id] = n;
        leads.push({ channel: ch, count: n });
      }
    });

    /* Direct mail drops land over several days. */
    var mailToday = 0;
    state.mailQueue.forEach(function (m) {
      if (m.daysLeft > 0) mailToday += m.perDay;
    });
    if (mailToday > 0) {
      breakdown.mail = mailToday;
      leads.push({ channel: D.CHANNELS_BY_ID.mail, count: mailToday });
    }

    var walkIn = (D.CONFIG.baseWalkInTraffic + S.upgradeEffect(state, 'traffic'));
    breakdown.walkin = walkIn;
    leads.push({ channel: PSEUDO_CHANNELS.walkin, count: walkIn });

    var repeatCust = state.customers.retained * D.CONFIG.repeatVisitRate *
      (0.72 + state.reputation / 5 * 0.6);
    breakdown.repeat = repeatCust;
    leads.push({ channel: PSEUDO_CHANNELS.repeat, count: repeatCust });

    var fleetJobs = 0;
    state.fleetAccounts.forEach(function (f) { fleetJobs += f.jobsPerDay; });
    if (fleetJobs > 0) {
      breakdown.fleet = fleetJobs;
      leads.push({ channel: PSEUDO_CHANNELS.fleet, count: fleetJobs });
    }

    /* Market-level multipliers. */
    var repMult = 0.62 + (state.reputation - 1) / 4 * 0.76;
    var dowMult = D.DOW_DEMAND[state.dow];
    var seasonMult = SEASON_OVERALL[month];
    var weatherMult = weather.demand;
    var compMult = 1 - clamp(state.market.competitorPressure, 0, 0.6);
    var modMult = 1 + modSum(state, 'demand');
    var priceMult = Math.pow(
      state.market.laborRate / Math.max(40, state.pricing.laborRate * (1 - state.pricing.couponPct)),
      0.42
    );
    priceMult = clamp(priceMult, 0.62, 1.42);

    var envMult = repMult * dowMult * seasonMult * weatherMult * compMult * modMult *
      priceMult * state.demandMult;

    var total = 0;
    leads.forEach(function (l) {
      // Fleet work is contracted; it does not care about weather or reputation.
      l.expected = l.channel.id === 'fleet' ? l.count * dowMult : l.count * envMult;
      total += l.expected;
    });

    var actual = forReal ? rng.poisson(total) : Math.round(total);

    return {
      expected: total,
      count: actual,
      leads: leads,
      breakdown: breakdown,
      mults: {
        reputation: repMult, dayOfWeek: dowMult, season: seasonMult, weather: weatherMult,
        competition: compMult, modifiers: modMult, price: priceMult, brand: brandLift
      }
    };
  }

  /* ------------------------------------------------------------- job choice */

  function pickJob(state, rng, weatherId, channel) {
    var weather = D.WEATHER_BY_ID[weatherId];
    var month = state.month;
    return rng.weighted(D.JOBS, function (job) {
      var w = job.weight * D.SEASON[job.season][month] * jobBias(state, job.id);
      if (weather.boost && weather.boost[job.cat]) w *= weather.boost[job.cat];
      // Fleet vehicles skew to maintenance and wear items, not one-off diag.
      if (channel.id === 'fleet') {
        w *= (job.cat === 'fluids' || job.cat === 'brakes' || job.cat === 'tires' ||
          job.cat === 'filters') ? 1.9 : 0.7;
      }
      if (channel.ticket && channel.ticket < 1 && job.bookHours > 3) w *= 0.55;
      return w;
    });
  }

  function pickUpsell(state, rng, primary, weatherId) {
    var weather = D.WEATHER_BY_ID[weatherId];
    var pool = D.UPSELLS.filter(function (id) {
      return id !== primary.id && shopCanDo(state, D.JOBS_BY_ID[id]);
    });
    if (!pool.length) return null;
    var id = rng.weighted(pool, function (jid) {
      var job = D.JOBS_BY_ID[jid];
      var w = job.weight * D.SEASON[job.season][state.month];
      if (weather.boost && weather.boost[job.cat]) w *= weather.boost[job.cat];
      return w;
    });
    return D.JOBS_BY_ID[id];
  }

  /* ---------------------------------------------------------- staff ratings */

  function writerClose(state, w) {
    return 0.028 * (w.level - 2) + w.closeBonus +
      (w.courses.indexOf('objection') >= 0 ? 0.07 : 0) +
      (w.courses.indexOf('dvi') >= 0 ? 0.04 : 0) +
      (w.courses.indexOf('advisor_pro') >= 0 ? 0.05 : 0);
  }

  function writerUpsell(state, w) {
    return 0.16 + 0.035 * (w.level - 2) + w.upsellBonus +
      (w.courses.indexOf('menu') >= 0 ? 0.07 : 0) +
      (w.courses.indexOf('dvi') >= 0 ? 0.09 : 0) +
      (w.courses.indexOf('advisor_pro') >= 0 ? 0.05 : 0);
  }

  function writerCapacity(state, w) {
    return 9.5 + 1.7 * w.level + (w.courses.indexOf('phone') >= 0 ? 2 : 0);
  }

  /* -------------------------------------------------------------- the day */

  function runDay(state) {
    if (state.gameOver) return state.lastReport;

    var rng = new NS.Rng(NS.hashString(state.seed + ':day:' + state.day));
    var weatherId = state.weather;
    var weather = D.WEATHER_BY_ID[weatherId];
    var repBefore = state.reputation;

    var report = {
      day: state.day,
      dateLabel: dateLabel(state),
      dow: D.DOW_NAMES[state.dow],
      weather: weather,
      open: true,
      closedReason: null,
      demand: null,
      counter: {
        opportunities: 0, handled: 0, missedCalls: 0, turnedAwayLot: 0, noCapability: 0,
        quoted: 0, approved: 0, declined: 0, upsells: 0, quotedValue: 0, approvedValue: 0,
        rushed: 0, lostToBacklog: 0, bookedAhead: 0, bookedOutDays: 0, sameDay: 0,
        lostValue: 0, noTooling: 0, noEvTraining: 0, missedWork: {}
      },
      shop: {
        bayHours: 0, bayHoursUsed: 0, techHours: 0, techHoursUsed: 0, billedHours: 0,
        completed: 0, carryover: 0, comebacks: 0, partsWaits: 0, emergencyOrders: 0,
        overtimeHours: 0, efficiency: 0, productivity: 0, utilization: 0
      },
      revenue: { labor: 0, parts: 0, total: 0, receivable: 0, collected: 0 },
      cogs: { parts: 0, emergencyPremium: 0 },
      expenses: {
        techPay: 0, writerPay: 0, payrollTax: 0, overhead: 0, upkeep: 0, marketing: 0,
        interest: 0, training: 0, bills: 0, tax: 0, partsPurchased: 0, shrink: 0, total: 0
      },
      profit: { gross: 0, grossPct: 0, net: 0 },
      csi: 0,
      repBefore: repBefore,
      repAfter: repBefore,
      events: [],
      completedList: [],
      notes: []
    };

    var isSunday = state.dow === 6;
    var isSaturday = state.dow === 5;
    var open = !isSunday && (!isSaturday || state.policy.openSaturday);
    report.open = open;
    if (!open) report.closedReason = isSunday ? 'Closed Sunday' : 'Closed Saturday';

    /* ---------------------------------------------------- 1. who is working */

    var bays = S.activeBays(state);
    var techs = open ? S.availableTechs(state) : [];
    var writers = open ? S.availableWriters(state) : [];
    var shiftHours = state.policy.shiftHours;
    var otCap = state.policy.allowOvertime ? Math.max(0, D.CONFIG.maxShiftHours - shiftHours) : 0;

    var bayPool = bays.map(function (b) {
      return { bay: b, hours: open ? shiftHours + otCap : 0, used: 0 };
    });
    var techPool = techs.map(function (t) {
      return { tech: t, hours: shiftHours + otCap, regular: shiftHours, used: 0, billed: 0 };
    });

    report.shop.bayHours = bays.length * (open ? shiftHours : 0);
    report.shop.techHours = techs.length * (open ? shiftHours : 0);

    /* ------------------------------------------------------------ 2. demand */

    var demand = computeDemand(state, rng, weatherId, true);
    report.demand = demand;
    var arrivals = open ? demand.count : 0;
    report.counter.opportunities = arrivals;

    /* ----------------------------------------------------------- 3. counter */

    var capacity = 0;
    writers.forEach(function (w) { capacity += writerCapacity(state, w); });
    capacity += S.upgradeEffect(state, 'writerCapacity');

    var handled = arrivals;
    var rushed = 0;
    if (arrivals > capacity) {
      var over = arrivals - capacity;
      handled = Math.floor(capacity + over * 0.32);
      rushed = handled - Math.floor(capacity);
      report.counter.missedCalls = arrivals - handled;
    }
    report.counter.handled = handled;
    report.counter.rushed = Math.max(0, rushed);

    /* Today's remaining room: WIP eats into it before the doors open. */
    var wipHoursRemaining = 0;
    state.wip.forEach(function (ro) {
      wipHoursRemaining += ro.started ? ro.hoursRemaining * shopEfficiency(state) : ro.bookHours;
    });
    state.bookedHours[state.day] = (state.bookedHours[state.day] || 0) + wipHoursRemaining;

    var newOrders = [];
    var avgWriterClose = 0;
    var avgWriterUpsell = 0;
    var avgWriterCsi = 0;
    if (writers.length) {
      writers.forEach(function (w) {
        avgWriterClose += writerClose(state, w);
        avgWriterUpsell += writerUpsell(state, w);
        avgWriterCsi += w.csiBonus + (w.courses.indexOf('retention') >= 0 ? 0.15 : 0);
      });
      avgWriterClose /= writers.length;
      avgWriterUpsell /= writers.length;
      avgWriterCsi /= writers.length;
    }

    var closeUpgrades = S.upgradeEffect(state, 'close') + S.upgradeEffect(state, 'trust');
    var majorCloseBonus = S.upgradeEffect(state, 'majorClose');
    var modApprove = modSum(state, 'approve');
    var evTrained = state.techs.some(function (t) { return t.courses.indexOf('ev_hybrid') >= 0; });

    for (var i = 0; i < handled; i++) {
      var lead = rng.weighted(demand.leads, function (l) { return l.expected; });
      var channel = lead.channel;

      if (!evTrained && channel.id !== 'fleet' && rng.chance(state.market.evShare * 0.6)) {
        report.counter.noCapability++;
        report.counter.noEvTraining++;
        continue;
      }

      var job = pickJob(state, rng, weatherId, channel);
      if (!shopCanDo(state, job)) {
        report.counter.noCapability++;
        report.counter.noTooling++;
        recordMissed(report, state, job, fairPrice(state, job));
        continue;
      }

      var isFleet = channel.id === 'fleet';
      var discount = isFleet ? (state.fleetAccounts[0] ? state.fleetAccounts[0].discount : 0.15) : 0;
      var line = quoteLine(state, job, discount);
      var fair = fairPrice(state, job);
      var ratio = fair > 0 ? line.total / fair : 1;

      report.counter.quoted++;
      report.counter.quotedValue += line.total;

      /* "When can you get me in?" The answer sells the job or loses it. */
      var tolerance = job.ticket === 'quick' ? rng.int(0, 3) : rng.int(1, 6);
      if (isFleet) tolerance += 3;
      if (state.reputation >= 4.2) tolerance += 1;   // people wait for a shop they trust
      var slot = findSlot(state, job.bookHours, tolerance);
      if (slot === null) {
        report.counter.lostToBacklog++;
        report.counter.lostValue += line.total;
        if (lotLoad(state, state.day) >= Math.round(state.parking.spaces * 1.7)) {
          report.counter.turnedAwayLot++;
        }
        continue;
      }
      var leadDays = slot - state.day;

      var p = 0.60
        + avgWriterClose
        + closeUpgrades
        + (state.reputation - 3.4) * 0.065
        + (channel.intent - 1) * 0.30
        + modApprove
        - Math.max(0, leadDays - 1) * 0.035
        - (ratio - 1) * D.CONFIG.priceElasticity * (job.sensitivity || 1) * (channel.price || 1);
      if (job.ticket === 'major') p += majorCloseBonus - 0.10;
      if (rushed > 0 && i >= handled - rushed) p -= 0.09;
      if (isFleet) p = 0.97;
      p = clamp(p, 0.04, 0.97);

      if (!rng.chance(p)) {
        report.counter.declined++;
        // A declined estimate still costs a little goodwill when it felt gouged.
        if (ratio > 1.25) state.customers.retained = Math.max(0, state.customers.retained - 0.4);
        continue;
      }

      var ro = {
        id: 'ro' + state.day + '_' + newOrders.length,
        channel: channel.id,
        fleet: isFleet,
        lines: [line],
        arrivedDay: state.day,
        scheduledDay: slot,
        leadDays: leadDays,
        ticket: job.ticket,
        skill: job.skill,
        requires: job.requires,
        bookHours: job.bookHours,
        hoursRemaining: 0,
        started: false,
        partsTaken: false,
        waitedParts: false,
        rushed: rushed > 0 && i >= handled - rushed,
        priceRatio: ratio,
        comeback: false,
        csi: 5
      };

      /* Upsell: the car is already here and on the lift. */
      var upsellChance = avgWriterUpsell + S.upgradeEffect(state, 'upsell') +
        (job.gateway ? 0.16 : 0) + (state.reputation - 3.4) * 0.03;
      var upsellsAdded = 0;
      while (upsellsAdded < 2 && rng.chance(clamp(upsellChance - upsellsAdded * 0.22, 0, 0.85))) {
        var up = pickUpsell(state, rng, job, weatherId);
        if (!up) break;
        var upLine = quoteLine(state, up, discount);
        var upFair = fairPrice(state, up);
        var upRatio = upFair > 0 ? upLine.total / upFair : 1;
        var upP = clamp(0.66 + avgWriterClose - (upRatio - 1) * 1.1, 0.05, 0.95);
        if (!rng.chance(upP)) break;
        ro.lines.push(upLine);
        ro.bookHours += up.bookHours;
        if (D.JOBS_BY_ID[up.id].ticket === 'major') ro.ticket = 'major';
        upsellsAdded++;
        report.counter.upsells++;
      }

      var roTotal = ro.lines.reduce(function (a, l) { return a + l.total; }, 0);
      report.counter.approved++;
      report.counter.approvedValue += roTotal;
      if (leadDays === 0) report.counter.sameDay++;
      else report.counter.bookedAhead++;
      bookHours(state, slot, ro.bookHours);
      state.appointments.push(ro);
      newOrders.push(ro);
    }
    report.counter.bookedOutDays = bookedOutDays(state);

    /* ----------------------------------------------------- 4. the shop floor */

    /* Cars scheduled for today roll in; everything else stays on the book. */
    var arrivedToday = [];
    state.appointments = state.appointments.filter(function (a) {
      if (open && a.scheduledDay <= state.day) { arrivedToday.push(a); return false; }
      if (!open && a.scheduledDay <= state.day) a.scheduledDay = state.day + 1;
      return true;
    });

    var queue = state.wip.slice();
    queue.forEach(function (ro) { ro.priority = 0; });
    arrivedToday.forEach(function (ro) { ro.priority = 1; });
    var policy = state.policy.scheduling;

    function gpPerHour(ro) {
      var rev = 0;
      var cost = 0;
      ro.lines.forEach(function (l) { rev += l.total; cost += l.partsCost; });
      return (rev - cost) / Math.max(0.3, ro.bookHours);
    }

    var pending = queue.concat(arrivedToday);
    pending.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;  // WIP first
      if (a.comeback !== b.comeback) return a.comeback ? -1 : 1;      // then fix your mistakes
      if (policy === 'quick') return a.bookHours - b.bookHours;
      if (policy === 'profit') return gpPerHour(b) - gpPerHour(a);
      if (policy === 'balanced') {
        var sa = gpPerHour(a) / Math.pow(a.bookHours, 0.35);
        var sb = gpPerHour(b) / Math.pow(b.bookHours, 0.35);
        return sb - sa;
      }
      return 0; // fifo
    });

    var completed = [];
    var stillWip = [];
    var csiScores = [];
    var comebackQueue = [];

    for (var q = 0; q < pending.length; q++) {
      var order = pending[q];

      /* Find the best bay/tech pair that can take this work right now. */
      var bestBay = null;
      for (var bi = 0; bi < bayPool.length; bi++) {
        var bslot = bayPool[bi];
        if (bslot.hours <= 0.05) continue;
        if (!bayCanDo(bslot.bay, { requires: order.requires })) continue;
        if (!bestBay || bslot.hours > bestBay.hours) bestBay = bslot;
      }
      var bestTech = null;
      var bestScore = -Infinity;
      for (var ti = 0; ti < techPool.length; ti++) {
        var tslot = techPool[ti];
        if (tslot.hours <= 0.05) continue;
        var match = tslot.tech.specialties.indexOf(order.skill) >= 0 ? 1 : 0;
        var score = match * 100 + tslot.hours + tslot.tech.level * 2;
        if (score > bestScore) {
          bestTech = tslot;
          bestScore = score;
        }
      }

      if (!bestBay || !bestTech) {
        order.priority = 0;
        stillWip.push(order);
        continue;
      }

      /* Parts have to be in the building before the wrench turns. */
      if (!order.partsTaken) {
        var need = {};
        order.lines.forEach(function (l) {
          need[l.cat] = (need[l.cat] || 0) + l.partsCost;
        });
        var short = 0;
        for (var cat in need) {
          var have = state.inventory[cat] || 0;
          if (have < need[cat]) short += need[cat] - have;
        }
        if (short > 0.5) {
          var premium = short * D.CONFIG.emergencyPartsPremium;
          if (state.policy.emergencyParts && state.cash >= short + premium) {
            state.cash -= (short + premium);
            report.expenses.partsPurchased += short + premium;
            report.cogs.emergencyPremium += premium;
            report.shop.emergencyOrders++;
            for (var c2 in need) {
              var h2 = state.inventory[c2] || 0;
              if (h2 < need[c2]) state.inventory[c2] = need[c2];
            }
            order.emergencyHours = D.CONFIG.emergencyPartsDelayHours;
          } else {
            // Order it on tonight's truck; the car sits on the lot.
            if (state.cash >= short) {
              state.cash -= short;
              report.expenses.partsPurchased += short;
              state.incomingParts.push({ day: state.day + 1, cat: dominantCat(need), amount: short });
            }
            order.waitedParts = true;
            order.priority = 0;
            report.shop.partsWaits++;
            stillWip.push(order);
            continue;
          }
        }
        /*
         * Parts leave the shelf now but are costed against the sale when the
         * car is delivered, so the daily gross margin actually means something.
         */
        order.partsConsumed = 0;
        for (var c3 in need) {
          state.inventory[c3] = Math.max(0, (state.inventory[c3] || 0) - need[c3]);
          order.partsConsumed += need[c3];
        }
        order.partsTaken = true;
      }

      /* Convert book hours into real clock hours for this bay/tech pair. */
      if (!order.started) {
        var eff = techEfficiency(state, bestTech.tech, {
          skill: order.skill, requires: order.requires
        });
        var toolSpeed = bayToolSpeed(bestBay.bay, { requires: order.requires });
        order.hoursRemaining = order.bookHours / Math.max(0.3, eff * toolSpeed) +
          (order.emergencyHours || 0);
        order.techId = bestTech.tech.id;
        order.efficiencyAtStart = eff * toolSpeed;
        order.started = true;
      }

      var alloc = Math.min(bestBay.hours, bestTech.hours, order.hoursRemaining);
      if (alloc <= 0.05) {
        order.priority = 0;
        stillWip.push(order);
        continue;
      }
      bestBay.hours -= alloc;
      bestBay.used += alloc;
      bestTech.hours -= alloc;
      bestTech.used += alloc;
      order.hoursRemaining -= alloc;

      /* Book hours are earned as the work happens, not all on completion day. */
      var earned = Math.min(alloc * order.efficiencyAtStart,
        order.bookHours - (order.bookCredited || 0));
      order.bookCredited = (order.bookCredited || 0) + earned;
      if (!order.comeback) {
        bestTech.billed += earned;
        report.shop.billedHours += earned;
      }

      if (order.hoursRemaining > 0.05) {
        order.priority = 0;
        stillWip.push(order);
        continue;
      }

      /* --------- the car is done --------- */
      var tech = bestTech.tech;
      var revenue = 0;
      var partsRev = 0;
      var laborRev = 0;
      order.lines.forEach(function (l) {
        laborRev += l.laborPrice;
        partsRev += l.partsPrice;
        revenue += l.total;
      });

      if (order.comeback) {
        revenue = 0; laborRev = 0; partsRev = 0;   // the shop eats a comeback
      }

      report.revenue.labor += laborRev;
      report.revenue.parts += partsRev;
      report.revenue.total += revenue;
      report.cogs.parts += order.partsConsumed || 0;
      report.shop.completed++;

      if (order.fleet) {
        state.receivables.push({ dueDay: state.day + 15, amount: revenue, label: 'Fleet invoice' });
        report.revenue.receivable += revenue;
      } else {
        state.cash += revenue;
        report.revenue.collected += revenue;
      }

      /* Comeback risk: rushed work with dull tools by a green tech. */
      var quality = D.CONFIG.comebackBase
        * (1.35 - 0.13 * tech.level)
        * (1 - clamp(tech.qualityBonus + (tech.courses.indexOf('quality') >= 0 ? 0.28 : 0), -0.3, 0.7))
        * (order.rushed ? 1.3 : 1)
        * (bestTech.used > shiftHours ? 1.25 : 1)
        * (1 - Math.min(0.3, (bayToolSpeed(bestBay.bay, { requires: order.requires }) - 1) * 0.6));
      if (!order.comeback && rng.chance(clamp(quality, 0.004, 0.4))) {
        comebackQueue.push(order);
      }

      /* Customer satisfaction on this repair order. */
      var daysHeld = state.day - (order.scheduledDay || order.arrivedDay);
      var allowed = order.ticket === 'major' ? 1 : 0;
      var csi = 5;
      csi -= Math.max(0, daysHeld - allowed) * 0.85;
      csi -= Math.max(0, (order.leadDays || 0) - 2) * 0.14;
      if (order.waitedParts) csi -= 0.7;
      if (order.rushed) csi -= 0.45;
      if (order.comeback) csi -= 2.4;
      csi -= Math.max(0, order.priceRatio - 1.12) * 3.0;
      csi += avgWriterCsi + S.upgradeEffect(state, 'csi');
      csi += (tech.level - 2) * 0.05;
      csi = clamp(csi, 1, 5);
      order.csi = csi;
      csiScores.push(csi);

      completed.push({
        id: order.id,
        names: order.lines.map(function (l) { return l.name; }),
        revenue: revenue,
        hours: order.bookHours,
        tech: tech.name,
        bay: bestBay.bay.name,
        csi: csi,
        comeback: order.comeback,
        fleet: order.fleet,
        channel: order.channel
      });

      /* Retention: a good experience buys the next visit. */
      var retention = D.CONFIG.retentionBase + (csi - 3.5) * 0.10 +
        S.upgradeEffect(state, 'repGain') +
        (writers.some(function (w) { return w.courses.indexOf('retention') >= 0; }) ? 0.06 : 0);
      if (!order.comeback && rng.chance(clamp(retention, 0, 0.92))) {
        state.customers.retained += 1;
      }
      tech.xp += order.bookHours * 3.4;
    }

    /* Rework goes on tomorrow's board at the shop's expense. */
    comebackQueue.forEach(function (orig) {
      stillWip.push({
        id: orig.id + '_cb',
        channel: orig.channel,
        fleet: orig.fleet,
        lines: orig.lines.map(function (l) {
          return {
            jobId: l.jobId, name: l.name + ' (comeback)', cat: l.cat,
            bookHours: l.bookHours * 0.6, partsCost: l.partsCost * 0.35,
            partsPrice: 0, laborPrice: 0, total: 0
          };
        }),
        arrivedDay: state.day + 1,
        scheduledDay: state.day + 1,
        leadDays: 0,
        ticket: 'quick',
        skill: orig.skill,
        requires: orig.requires,
        bookHours: orig.bookHours * 0.6,
        hoursRemaining: 0,
        started: false,
        partsTaken: false,
        waitedParts: false,
        rushed: false,
        priority: 0,
        comeback: true,
        priceRatio: 1,
        csi: 5
      });
      report.shop.comebacks++;
      state.reputation = Math.max(1, state.reputation - 0.03);
    });

    state.wip = stillWip;
    report.shop.carryover = stillWip.length;
    report.completedList = completed;

    bayPool.forEach(function (s2) { report.shop.bayHoursUsed += s2.used; });
    techPool.forEach(function (t2) {
      report.shop.techHoursUsed += t2.used;
      if (t2.used > t2.regular) report.shop.overtimeHours += t2.used - t2.regular;
      t2.tech.hoursWorked = t2.used;
      t2.tech.billedHours = t2.billed;
    });

    report.shop.efficiency = report.shop.techHoursUsed > 0
      ? report.shop.billedHours / report.shop.techHoursUsed : 0;
    report.shop.productivity = report.shop.techHours > 0
      ? report.shop.techHoursUsed / report.shop.techHours : 0;
    report.shop.utilization = report.shop.bayHours > 0
      ? report.shop.bayHoursUsed / report.shop.bayHours : 0;

    /* ---------------------------------------------------------- 5. closing */

    closeOut(state, report, rng, csiScores, techPool, writers, open);
    return report;
  }

  /** Remember what the shop had to say no to, and what it was worth. */
  function recordMissed(report, state, job, value) {
    var m = report.counter.missedWork[job.id];
    if (!m) {
      var missing = [];
      for (var t in (job.requires || {})) {
        if (!job.requires[t]) continue;
        var have = S.activeBays(state).some(function (b) {
          return (b.tools[t] || 0) >= job.requires[t];
        });
        if (!have) missing.push(D.TOOLS[t].levels[job.requires[t]].label);
      }
      m = report.counter.missedWork[job.id] = {
        name: job.name, count: 0, value: 0,
        reason: missing.length ? 'no ' + missing.join(' + ') : 'no capable bay free'
      };
    }
    m.count++;
    m.value += value;
    return m;
  }

  function dominantCat(need) {
    var best = null;
    var bestV = -1;
    for (var k in need) {
      if (need[k] > bestV) { bestV = need[k]; best = k; }
    }
    return best || 'misc';
  }

  /* ------------------------------------------------------------- close-out */

  function closeOut(state, report, rng, csiScores, techPool, writers, open) {
    var e = report.expenses;

    /* Payroll. Techs are paid whether or not there was work for them. */
    state.techs.forEach(function (t) {
      var slot = null;
      for (var i = 0; i < techPool.length; i++) {
        if (techPool[i].tech.id === t.id) { slot = techPool[i]; break; }
      }
      var hours = open && t.outDays <= 0 ? state.policy.shiftHours : 0;
      var ot = slot && slot.used > state.policy.shiftHours ? slot.used - state.policy.shiftHours : 0;
      e.techPay += hours * t.wage + ot * t.wage * D.CONFIG.overtimeMultiplier;
    });
    state.writers.forEach(function (w) {
      if (open && w.outDays <= 0) e.writerPay += w.salary;
    });
    e.payrollTax = (e.techPay + e.writerPay) * D.CONFIG.payrollTaxRate;

    /* Fixed costs run whether the doors are open or not. */
    var o = state.overhead;
    e.overhead = o.rent + o.utilities + o.insurance + o.software + (open ? o.supplies : 0);
    e.upkeep = S.upgradeUpkeep(state);
    e.marketing = S.dailyAdSpend(state);

    /* Marketing spend: stock channels bank it, mail queues it, rest is spent. */
    D.CHANNELS.forEach(function (ch) {
      var spend = state.marketing[ch.id] || 0;
      if (ch.mode === 'stock' || ch.mode === 'brand') {
        state.adStock[ch.id] = (state.adStock[ch.id] || 0) * (1 - ch.decay) + spend * ch.stockGain;
      } else if (ch.mode === 'delayed' && spend > 0) {
        var leads = saturate(spend, ch.saturation) / ch.cpl;
        state.mailQueue.push({ perDay: leads / ch.delayDays, daysLeft: ch.delayDays });
      } else if (ch.mode === 'fleet' && spend > 0) {
        var chance = Math.min(0.10, spend / 2100) * (state.reputation / 5) *
          (1 + state.writers.reduce(function (a, w) {
            return a + (w.courses.indexOf('fleet') >= 0 ? 0.9 : 0);
          }, 0));
        if (rng.chance(chance)) {
          var vehicles = rng.int(3, 12);
          var acct = {
            id: 'fleet' + state.day,
            name: rng.pick(['Northside Plumbing', 'Cedar Landscaping', 'Volt Electric',
              'Harbor Courier', 'Prime HVAC', 'Ridgeline Builders', 'City Cab Co-op',
              'Sunrise Bakery Delivery']),
            vehicles: vehicles,
            discount: 0.15,
            jobsPerDay: vehicles * 0.055,
            signedDay: state.day
          };
          state.fleetAccounts.push(acct);
          report.events.push('Signed ' + acct.name + ' (' + vehicles + ' vehicles) as a fleet account.');
          S.pushLog(state, 'Fleet account signed: ' + acct.name, 'good');
        }
      }
    });
    state.mailQueue.forEach(function (m) { m.daysLeft--; });
    state.mailQueue = state.mailQueue.filter(function (m) { return m.daysLeft > 0; });

    /* Debt service. */
    var loanInterest = state.loan.principal * state.loan.apr / 365;
    var creditInterest = state.credit.balance * state.credit.apr / 365;
    state.loan.principal += loanInterest;
    state.credit.balance += creditInterest;
    e.interest = loanInterest + creditInterest;

    /* Bills triggered by events. */
    state.pendingBills.forEach(function (b) { e.bills += b.amount; });
    state.pendingBills = [];

    /* Inventory shrink and obsolescence. */
    var shrinkRate = D.CONFIG.inventoryHoldingCostRate * (1 + S.upgradeEffect(state, 'shrink'));
    D.PART_CATEGORIES.forEach(function (c) {
      var loss = (state.inventory[c.id] || 0) * shrinkRate;
      state.inventory[c.id] = Math.max(0, (state.inventory[c.id] || 0) - loss);
      e.shrink += loss;
    });

    /* Parts delivered on tonight's truck. */
    var arrived = [];
    state.incomingParts = state.incomingParts.filter(function (p) {
      if (p.day <= state.day) { arrived.push(p); return false; }
      return true;
    });
    arrived.forEach(function (p) {
      state.inventory[p.cat] = (state.inventory[p.cat] || 0) + p.amount;
    });
    if (arrived.length) {
      report.notes.push('Parts delivery received: $' +
        Math.round(arrived.reduce(function (a, p) { return a + p.amount; }, 0)).toLocaleString());
    }

    /* Receivables. */
    var collected = 0;
    state.receivables = state.receivables.filter(function (r) {
      if (r.dueDay <= state.day) { collected += r.amount; return false; }
      return true;
    });
    if (collected > 0) {
      state.cash += collected;
      report.notes.push('Collected $' + Math.round(collected).toLocaleString() + ' in fleet receivables.');
    }

    var cashCosts = e.techPay + e.writerPay + e.payrollTax + e.overhead + e.upkeep +
      e.marketing + e.bills + e.training;
    state.cash -= cashCosts;

    e.total = cashCosts + e.interest + e.shrink;
    report.profit.gross = report.revenue.total - report.cogs.parts;
    report.profit.grossPct = report.revenue.total > 0
      ? report.profit.gross / report.revenue.total : 0;
    report.profit.net = report.revenue.total - report.cogs.parts - e.techPay - e.writerPay -
      e.payrollTax - e.overhead - e.upkeep - e.marketing - e.interest - e.bills -
      e.training - e.shrink;

    state.taxes.monthNet += report.profit.net;

    /* Reputation drifts toward the day's service quality. */
    var avgCsi = csiScores.length
      ? csiScores.reduce(function (a, b) { return a + b; }, 0) / csiScores.length
      : null;
    report.csi = avgCsi;
    if (avgCsi !== null) {
      state.reputation += (avgCsi - state.reputation) * D.CONFIG.reputationInertia;
    }
    /* Turning people away costs goodwill, but it is mostly lost revenue. */
    state.reputation -= Math.min(0.05,
      report.counter.turnedAwayLot * 0.004 + report.counter.missedCalls * 0.0012);
    state.reputation += S.upgradeEffect(state, 'repGain') * 0.05;
    D.CHANNELS.forEach(function (ch) {
      if (ch.repGain && (state.marketing[ch.id] || 0) > 0) {
        state.reputation += ch.repGain * Math.min(1, state.marketing[ch.id] / ch.saturation);
      }
    });
    state.reputation = clamp(state.reputation, 1, 5);
    report.repAfter = state.reputation;

    /* Customer base erodes without a reason to come back. */
    state.customers.retained *= (1 - D.CONFIG.customerDecay);

    /* Staff condition. */
    techPool.forEach(function (slot) {
      var t = slot.tech;
      var load = slot.used / Math.max(1, state.policy.shiftHours);
      t.fatigue = clamp(t.fatigue + (load - 0.78) * 0.09, 0, 1);
    });
    state.techs.forEach(function (t) {
      var working = techPool.some(function (s2) { return s2.tech.id === t.id; });
      if (!working) t.fatigue = clamp(t.fatigue - 0.16, 0, 1);
      var marketWage = D.TECH_WAGE[t.level];
      var wageRatio = marketWage > 0 ? t.wage / marketWage : 1;
      var target = 0.58 + (wageRatio - 1) * 0.9
        + S.upgradeEffect(state, 'moraleGain') * 10
        + (state.reputation - 3) * 0.035
        - t.fatigue * 0.24
        - (report.shop.overtimeHours > 0 ? 0.04 : 0);
      t.morale = clamp(t.morale + (clamp(target, 0.1, 0.98) - t.morale) * 0.10, 0.05, 1);
      t.level = Math.max(t.level, S.levelFromXp(t.xp));
    });
    state.writers.forEach(function (w) {
      w.xp += report.counter.handled / Math.max(1, writers.length) * 1.9;
      w.level = Math.max(w.level, S.levelFromXp(w.xp));
    });

    /* Training clocks. */
    state.techs.concat(state.writers).forEach(function (p) {
      if (p.trainingDaysLeft > 0) {
        p.trainingDaysLeft--;
        if (p.trainingDaysLeft === 0) {
          finishTraining(state, p, report);
        }
      }
      if (p.outDays > 0) p.outDays--;
    });
    state.bays.forEach(function (b) { if (b.downDays > 0) b.downDays--; });

    /* Warn before somebody walks. Underpaid usually means they leveled up. */
    state.techs.forEach(function (t) {
      if (t.morale < 0.42) {
        var market = D.TECH_WAGE[t.level];
        var why = t.wage < market * 0.95
          ? 'a ' + D.TECH_TITLES[t.level - 1] + ' is worth about $' + market + '/hr'
          : (t.fatigue > 0.5 ? 'they are burned out' : 'the shop is a grind right now');
        report.notes.push('Morale warning: ' + t.name + ' is unhappy - ' + why + '.');
      }
    });

    /* Somebody walks out if morale bottoms out. */
    for (var ti = state.techs.length - 1; ti >= 0; ti--) {
      var tq = state.techs[ti];
      if (tq.morale < 0.3 && rng.chance(0.16)) {
        state.techs.splice(ti, 1);
        report.events.push(tq.name + ' quit. Morale was in the floor.');
        S.pushLog(state, tq.name + ' quit.', 'bad');
      }
    }

    /* Modifiers age out. */
    state.modifiers.forEach(function (m) { m.days--; });
    state.modifiers = state.modifiers.filter(function (m) { return m.days > 0; });

    /* Random event, roughly one every four days. */
    if (rng.chance(0.26)) {
      var pool = D.EVENTS.filter(function (ev) { return state.day >= (ev.minDay || 0); });
      if (pool.length) {
        var chosen = rng.weighted(pool, function (ev) { return ev.weight; });
        var line = chosen.apply(state, rng);
        var text = line || chosen.text;
        if (text) {
          report.events.push(text);
          S.pushLog(state, text, 'event');
        }
      }
    }

    /* Fleet accounts churn if service slips. */
    for (var fi = state.fleetAccounts.length - 1; fi >= 0; fi--) {
      if (state.reputation < 2.8 && rng.chance(0.05)) {
        var lost = state.fleetAccounts.splice(fi, 1)[0];
        report.events.push(lost.name + ' cancelled their fleet agreement.');
      }
    }

    /* Month roll: taxes, rent escalation, candidate refresh. */
    advanceCalendar(state, report, rng);

    /* Overdraft handling. */
    if (state.cash < 0) {
      var draw = Math.min(-state.cash, state.credit.limit - state.credit.balance);
      if (draw > 0) {
        state.credit.balance += draw;
        state.cash += draw;
        report.notes.push('Drew $' + Math.round(draw).toLocaleString() + ' on the line of credit.');
      }
    }
    if (state.cash < 0) {
      state.negativeDays = (state.negativeDays || 0) + 1;
      report.notes.push('Cash is negative and the credit line is maxed (' +
        state.negativeDays + ' day(s)).');
      if (state.negativeDays >= 3) {
        state.gameOver = {
          day: state.day,
          reason: 'Insolvent. Three straight days with no cash and no credit left.'
        };
      }
    } else {
      state.negativeDays = 0;
    }

    /* Rolling 30-day KPIs. */
    state.history.push({
      day: report.day,
      revenue: report.revenue.total,
      profit: report.profit.net,
      cars: report.shop.completed,
      billed: report.shop.billedHours,
      worked: report.shop.techHoursUsed,
      quoted: report.counter.quoted,
      approved: report.counter.approved,
      gross: report.profit.gross,
      cash: state.cash,
      rep: state.reputation,
      netWorth: netWorth(state)
    });
    if (state.history.length > 400) state.history.shift();
    updateRollingStats(state);

    state.totals.revenue += report.revenue.total;
    state.totals.profit += report.profit.net;
    state.totals.cars += report.shop.completed;
    state.totals.ros += report.counter.approved;

    /* Milestones. */
    D.MILESTONES.forEach(function (m) {
      if (!state.milestones[m.id] && m.test(state)) {
        state.milestones[m.id] = state.day;
        report.events.push('Milestone reached: ' + m.label + '.');
        S.pushLog(state, 'Milestone: ' + m.label, 'good');
      }
    });

    state.carsOnLot = state.wip.length;
    state.lastReport = report;

    /* Advance the clock and roll tomorrow's weather. */
    state.day++;
    state.dow = (state.dow + 1) % 7;
    state.dateDay++;
    var dim = daysInMonth(state.month);
    if (state.dateDay > dim) {
      state.dateDay = 1;
      state.month = (state.month + 1) % 12;
      if (state.month === 0) state.year++;
    }
    state.weather = state.tomorrowWeather;
    state.tomorrowWeather = S.rollWeather(state, rng);
    state.partsOrderedToday = 0;

    /* Yesterday's page of the appointment book is history. */
    for (var bd in state.bookedHours) {
      if (Number(bd) < state.day) delete state.bookedHours[bd];
    }
  }

  function daysInMonth(m) {
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
  }

  function advanceCalendar(state, report, rng) {
    var tomorrowIsFirst = state.dateDay + 1 > daysInMonth(state.month);
    if (tomorrowIsFirst) {
      // Income tax on the month's profit.
      if (state.taxes.monthNet > 0) {
        var tax = state.taxes.monthNet * D.CONFIG.incomeTaxRate;
        state.cash -= tax;
        state.taxes.paidToDate += tax;
        report.expenses.tax += tax;
        report.notes.push('Quarterly estimated tax accrual paid: $' +
          Math.round(tax).toLocaleString() + '.');
      }
      state.taxes.monthNet = 0;

      // Mandatory loan payment.
      if (state.loan.principal > 0) {
        var pay = Math.min(state.loan.principal, Math.max(700, state.loan.principal * 0.021));
        state.cash -= pay;
        state.loan.principal -= pay;
        report.notes.push('Loan payment: $' + Math.round(pay).toLocaleString() + '.');
      }
      if (state.credit.balance > 0) {
        var cpay = Math.min(state.credit.balance, Math.max(300, state.credit.balance * 0.06));
        if (state.cash > cpay) {
          state.cash -= cpay;
          state.credit.balance -= cpay;
        }
      }
    }
    if (state.day - state.candidates.refreshDay >= 7) {
      S.refreshCandidates(state, rng);
    }
  }

  function finishTraining(state, person, report) {
    var isTech = state.techs.indexOf(person) >= 0;
    var catalog = isTech ? D.TECH_TRAINING : D.WRITER_TRAINING;
    var course = null;
    catalog.forEach(function (c) { if (c.id === person.trainingId) course = c; });
    if (!course) { person.trainingId = null; return; }
    var eff = course.effect;
    if (eff.efficiency) person.efficiencyBonus += eff.efficiency;
    if (eff.quality) person.qualityBonus += eff.quality;
    if (eff.spec && person.specialties.indexOf(eff.spec) < 0) person.specialties.push(eff.spec);
    if (eff.xp) person.xp += S.XP_FOR_LEVEL[Math.min(5, person.level + 1)] - person.xp +
      (eff.xp - 1) * 200;
    if (eff.close) person.closeBonus += eff.close;
    if (eff.upsell) person.upsellBonus += eff.upsell;
    if (eff.capacity) person.capacityBonus += eff.capacity;
    if (eff.retention) person.retentionBonus += eff.retention;
    if (eff.csi) person.csiBonus += eff.csi;
    if (eff.fleet) person.fleetBonus += eff.fleet;
    person.level = Math.max(person.level, S.levelFromXp(person.xp));
    person.courses.push(course.id);
    person.morale = clamp(person.morale + 0.06, 0, 1);
    person.trainingId = null;
    if (report) {
      report.events.push(person.name + ' completed ' + course.name + '.');
    }
    S.pushLog(state, person.name + ' completed ' + course.name + '.', 'good');
  }

  function updateRollingStats(state) {
    var h = state.history.slice(-30);
    if (!h.length) return;
    var rev = 0, cars = 0, billed = 0, worked = 0, quoted = 0, approved = 0, gross = 0;
    h.forEach(function (d) {
      rev += d.revenue; cars += d.cars; billed += d.billed; worked += d.worked;
      quoted += d.quoted; approved += d.approved; gross += d.gross;
    });
    state.stats.aro30 = cars > 0 ? rev / cars : 0;
    state.stats.efficiency30 = worked > 0 ? billed / worked : 0;
    state.stats.closeRate30 = quoted > 0 ? approved / quoted : 0;
    state.stats.carCount30 = cars;
    state.stats.gpPct30 = rev > 0 ? gross / rev : 0;
    state.stats.revenue30 = rev;
  }

  /* -------------------------------------------------------------- forecast */

  /** Non-mutating look at tomorrow, for the planning screen. */
  function forecast(state) {
    var rng = new NS.Rng(NS.hashString(state.seed + ':fc:' + state.day));
    var demand = computeDemand(state, rng, state.weather, false);
    var isSunday = state.dow === 6;
    var isSaturday = state.dow === 5;
    var open = !isSunday && (!isSaturday || state.policy.openSaturday);
    var bays = S.activeBays(state).length;
    var techs = S.availableTechs(state).length;
    var writers = S.availableWriters(state);
    var capacity = writers.reduce(function (a, w) { return a + writerCapacity(state, w); }, 0)
      + S.upgradeEffect(state, 'writerCapacity');
    var hours = Math.min(bays, techs) * state.policy.shiftHours;

    var usage = partsUsageForecast(state);
    var wipHours = 0;
    state.wip.forEach(function (ro) {
      wipHours += ro.started ? ro.hoursRemaining * shopEfficiency(state) : ro.bookHours;
    });
    var todayAppts = state.appointments.filter(function (a) {
      return a.scheduledDay <= state.day;
    });
    var book = [];
    for (var d = state.day; d < state.day + 7; d++) {
      book.push({
        day: d,
        dow: D.DOW_NAMES[dowFor(state, d)],
        open: isOpenDay(state, d),
        capacity: capacityFor(state, d),
        booked: bookedOn(state, d) + (d === state.day ? wipHours : 0),
        cars: state.appointments.filter(function (a) { return a.scheduledDay === d; }).length +
          (d === state.day ? state.wip.length : 0)
      });
    }
    return {
      open: open,
      expectedCars: open ? demand.expected : 0,
      demand: demand,
      counterCapacity: capacity,
      bayHours: bays * state.policy.shiftHours,
      techHours: techs * state.policy.shiftHours,
      effectiveHours: hours,
      capacityBookHours: capacityFor(state, state.day),
      shopEfficiency: shopEfficiency(state),
      breakEven: S.dailyBreakEven(state),
      wip: state.wip.length,
      wipHours: wipHours,
      appointmentsToday: todayAppts.length,
      appointmentsAhead: state.appointments.length - todayAppts.length,
      bookedOutDays: bookedOutDays(state),
      book: book,
      lot: state.parking.spaces,
      lotUsed: state.wip.length + todayAppts.length,
      partsDays: usage
    };
  }

  /** Days of supply per parts category based on the last 14 days of use. */
  function partsUsageForecast(state) {
    var out = {};
    var days = Math.min(14, state.history.length) || 1;
    var revPerDay = state.history.slice(-14).reduce(function (a, d) {
      return a + d.revenue;
    }, 0) / days;
    if (revPerDay <= 0) revPerDay = 900;
    D.PART_CATEGORIES.forEach(function (c) {
      // Rough share of parts spend by category, scaled from typical mix.
      var share = { fluids: 0.07, filters: 0.04, brakes: 0.16, tires: 0.22, batteries: 0.08,
        electrical: 0.11, engine: 0.15, suspension: 0.09, hvac: 0.05, exhaust: 0.02,
        misc: 0.01 }[c.id] || 0.05;
      var burn = revPerDay * 0.30 * share;
      out[c.id] = {
        burn: burn,
        days: burn > 0 ? (state.inventory[c.id] || 0) / burn : 99
      };
    });
    return out;
  }

  NS.Sim = {
    runDay: runDay,
    forecast: forecast,
    computeDemand: computeDemand,
    netWorth: netWorth,
    quoteLine: quoteLine,
    fairPrice: fairPrice,
    bayCanDo: bayCanDo,
    shopCanDo: shopCanDo,
    bayToolSpeed: bayToolSpeed,
    techEfficiency: techEfficiency,
    writerCapacity: writerCapacity,
    writerClose: writerClose,
    writerUpsell: writerUpsell,
    partsUsageForecast: partsUsageForecast,
    capacityFor: capacityFor,
    shopEfficiency: shopEfficiency,
    bookedOutDays: bookedOutDays,
    isOpenDay: isOpenDay,
    dowFor: dowFor,
    finishTraining: finishTraining,
    updateRollingStats: updateRollingStats,
    daysInMonth: daysInMonth,
    SEASON_OVERALL: SEASON_OVERALL,
    PSEUDO_CHANNELS: PSEUDO_CHANNELS,
    clamp: clamp,
    round2: round2
  };

  function dateLabel(state) {
    return D.DOW_NAMES[state.dow] + ', ' + D.MONTH_NAMES[state.month] + ' ' + state.dateDay;
  }
  NS.Sim.dateLabel = dateLabel;
})(AutoShop);
