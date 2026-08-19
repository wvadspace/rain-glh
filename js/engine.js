/* engine.js — the simulation. No DOM access lives in here, so the model can be
   run headless for balance testing. */
(function (G) {
  'use strict';

  var D = G.DATA;
  var RNG = G.RNG;
  var E = {};

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function sum(arr, fn) { var t = 0; for (var i = 0; i < arr.length; i++) t += fn(arr[i]); return t; }

  E.clamp = clamp;

  /* ================================================================ setup */

  var nextId = 1;
  function uid(p) { return p + (nextId++); }

  function makeName(rng) {
    return rng.pick(D.FIRST) + ' ' + rng.pick(D.LAST);
  }

  function makeTech(rng, level, certs) {
    var t = D.TECH_LEVELS[level - 1];
    return {
      id: uid('T'), name: makeName(rng), level: level, xp: t.xp,
      certs: certs.slice(), morale: 78, fatigue: 0,
      outUntil: 0, training: null, hiredDay: 1,
      lifetimeHours: 0, lifetimeComebacks: 0, lifetimeJobs: 0, otHours: 0
    };
  }

  function makeWriter(rng, level, courses) {
    return {
      id: uid('W'), name: makeName(rng), level: level, xp: 0,
      courses: courses.slice(), outUntil: 0, training: null, hiredDay: 1,
      lifetimeRO: 0, lifetimeSold: 0, lifetimeWritten: 0
    };
  }

  function makeBay(name, toolLevel, equip) {
    return { id: uid('B'), name: name, toolLevel: toolLevel, equip: equip.slice(), downUntil: 0 };
  }

  E.newGame = function (seed, shopName) {
    nextId = 1;
    var rng = new RNG(seed);
    var s = {
      version: 1,
      seed: seed,
      shopName: shopName || 'Rain Street Auto',
      day: 0,                    // incremented to 1 by the first endDay()
      dow: 6,                    // so day 1 lands on Monday
      season: 'spring',
      gameOver: null,

      cash: 55000,
      loan: { balance: 120000, rate: 0.089 },
      credit: { balance: 0, rate: 0.24 },

      /* pricing levers */
      laborRate: 128,
      partsMarkup: 1.80,
      diagFee: 110,
      lofPrice: 59,
      dispatch: 'promise',       // promise | profit | fifo
      overtime: 0,               // extra paid hours per tech per day

      reputation: 55,
      customerBase: 1600,
      fleetAccounts: [],

      bays: [
        makeBay('Bay 1', 1, ['lift']),
        makeBay('Bay 2', 1, ['lift']),
        makeBay('Bay 3', 2, ['lift', 'scan'])
      ],
      parking: 8,
      techs: [],
      writers: [],
      upgrades: {},

      inventory: {}, stockTarget: {}, incoming: [],
      channels: {},

      wip: [],                   // work orders still in the shop
      queue: [],                 // comebacks / appointments arriving on a future day
      modifiers: {},             // active event modifiers -> days remaining

      candidates: { techs: [], writers: [] },

      history: [],               // per-day KPI records
      ledgerYTD: null,
      lifetime: { revenue: 0, gp: 0, cars: 0, hours: 0, comebacks: 0, adSpend: 0 },
      log: []
    };

    Object.keys(D.PART_CATS).forEach(function (k) {
      s.inventory[k] = k === 'fluids' ? 900 : 500;
      s.stockTarget[k] = k === 'fluids' ? 1200 : 800;
    });
    D.CHANNELS.forEach(function (c) { s.channels[c.id] = { spend: 0, stock: 0 }; });

    s.techs.push(makeTech(rng, 3, ['maint', 'brakes', 'drive']));
    s.techs.push(makeTech(rng, 2, ['maint', 'brakes']));
    s.writers.push(makeWriter(rng, 2, ['phone']));

    s.rngState = rng.state;
    s._rng = rng;
    refreshCandidates(s, rng);
    return s;
  };

  /* Applied the morning a course finishes. */
  function applyTraining(s, p) {
    var tr = p.training;
    if (!tr) return;
    if (tr.type === 'cert') {
      if (p.certs.indexOf(tr.id) < 0) p.certs.push(tr.id);
      p.morale = clamp(p.morale + 6, 0, 100);
    } else if (tr.type === 'sales') {
      if (p.courses.indexOf(tr.id) < 0) p.courses.push(tr.id);
    }
  }

  /* Candidates refresh every few days so the labor market feels alive. */
  function refreshCandidates(s, rng) {
    s.candidates.techs = [];
    s.candidates.writers = [];
    var n = rng.int(2, 4), i;
    for (i = 0; i < n; i++) {
      var lvl = rng.weighted([1, 2, 3, 4, 5], function (l) { return [30, 26, 20, 10, 4][l - 1]; });
      var pool = ['maint', 'brakes', 'drive', 'elec', 'hvac', 'trans', 'ev'];
      var certs = ['maint'];
      for (var c = 0; c < pool.length; c++) {
        if (pool[c] === 'maint') continue;
        if (rng.chance(0.10 + lvl * 0.11)) certs.push(pool[c]);
      }
      var t = makeTech(rng, lvl, certs);
      t.askWage = Math.round(D.TECH_LEVELS[lvl - 1].wage * rng.range(0.92, 1.16));
      t.signing = Math.round(t.askWage * rng.range(28, 95));
      s.candidates.techs.push(t);
    }
    var m = rng.int(1, 3);
    for (i = 0; i < m; i++) {
      var wl = rng.weighted([1, 2, 3, 4], function (l) { return [34, 32, 20, 8][l - 1]; });
      var courses = [];
      Object.keys(D.SALES_COURSES).forEach(function (k) {
        if (rng.chance(0.05 + wl * 0.09)) courses.push(k);
      });
      var w = makeWriter(rng, wl, courses);
      w.askWage = Math.round(D.WRITER_LEVELS[wl - 1].wage * rng.range(0.93, 1.15));
      w.signing = Math.round(w.askWage * rng.range(24, 80));
      s.candidates.writers.push(w);
    }
  }
  E.refreshCandidates = refreshCandidates;

  /* ============================================================= derived */

  E.shopCerts = function (s) {
    var set = {};
    s.techs.forEach(function (t) { t.certs.forEach(function (c) { set[c] = true; }); });
    return set;
  };

  /* A job is only sellable if ONE bay carries every tool it needs and one tech
     holds the certification. Equipment spread across separate bays does not
     combine — you cannot put a car on two lifts at once. */
  E.bayCanHost = function (bay, job) {
    for (var i = 0; i < job.equip.length; i++) {
      if (bay.equip.indexOf(job.equip[i]) < 0) return false;
    }
    return true;
  };

  E.canDoJob = function (s, job, certSet) {
    certSet = certSet || E.shopCerts(s);
    if (!certSet[job.cert]) return false;
    for (var i = 0; i < s.bays.length; i++) {
      if (E.bayCanHost(s.bays[i], job)) return true;
    }
    return false;
  };

  /* Which single bay would you have to equip to unlock this job? */
  E.missingEquipFor = function (s, job) {
    var best = null;
    s.bays.forEach(function (b) {
      var miss = job.equip.filter(function (e) { return b.equip.indexOf(e) < 0; });
      if (!best || miss.length < best.miss.length) best = { bay: b, miss: miss };
    });
    return best;
  };

  E.writerStats = function (s, w) {
    var base = D.WRITER_LEVELS[w.level - 1];
    var close = base.close, upsell = 1.0, csi = base.csi, fleet = false;
    w.courses.forEach(function (id) {
      var c = D.SALES_COURSES[id];
      if (!c) return;
      close += c.close; upsell += c.upsell; csi += c.csi;
      if (c.fleet) fleet = true;
    });
    if (s.upgrades.dvi) { upsell += 0.12; close += 0.03; }
    if (s.upgrades.scheduler) { close += 0.02; csi += 2; }
    return {
      close: clamp(close, 0.15, 0.92), upsell: upsell, csi: csi,
      capacity: base.capacity + (s.upgrades.scheduler ? 3 : 0), fleet: fleet,
      wage: base.wage
    };
  };

  E.techEfficiency = function (s, t) {
    var base = D.TECH_LEVELS[t.level - 1].eff;
    var moraleF = 0.86 + (t.morale / 100) * 0.20;
    var fatigueF = 1 - clamp(t.fatigue, 0, 1) * 0.16;
    return base * moraleF * fatigueF;
  };

  E.techWage = function (t) { return t.wageOverride || D.TECH_LEVELS[t.level - 1].wage; };
  E.writerWage = function (w) { return w.wageOverride || D.WRITER_LEVELS[w.level - 1].wage; };

  E.priceIndex = function (s) {
    /* Weighted the way a customer reads an estimate: roughly half labor,
       half parts. Customers absolutely do price-shop the parts line. */
    var laborIdx = s.laborRate / D.MARKET_LABOR_RATE;
    var partsIdx = s.partsMarkup / D.MARKET_MARKUP;
    return laborIdx * 0.55 + partsIdx * 0.45;
  };

  /* Elasticity of demand with respect to price. Repairs are non-discretionary,
     so it is low near the going rate and steepens sharply once you are the
     most expensive shop in town. */
  E.elasticity = function (pIdx) {
    return 0.42 + Math.max(0, pIdx - 1.08) * 3.0;
  };

  E.rating = function (s) {
    return Math.round((2.6 + (s.reputation / 100) * 2.4) * 10) / 10;
  };

  E.OVERHEAD = [
    { name: 'Rent & property tax', mo: 6500 },
    { name: 'Utilities & compressed air', mo: 1400 },
    { name: 'Insurance (garage keepers, liability, comp)', mo: 1150 },
    { name: 'Shop management system, labor guide, catalogs', mo: 750 },
    { name: 'Waste oil, uniforms, licensing', mo: 900 },
    { name: 'Accounting, legal, banking', mo: 450 },
    { name: "Owner's draw", mo: 5500 }
  ];

  E.dailyFixedCosts = function (s) {
    var base = 0;
    E.OVERHEAD.forEach(function (o) { base += o.mo / D.DAYS_PER_MONTH; });
    base += Math.max(0, s.bays.length - 3) * D.BAY_RENT_PER_DAY;
    base += Math.max(0, s.parking - 8) * D.PARKING_RENT_PER_DAY;
    Object.keys(s.upgrades).forEach(function (k) {
      if (s.upgrades[k] && D.UPGRADES[k]) base += D.UPGRADES[k].upkeep;
    });
    return base;
  };

  E.jobPrice = function (s, job) {
    var labor;
    if (job.id === 'lof') labor = s.lofPrice - job.parts * s.partsMarkup;
    else if (job.cat === 'Diagnostics') labor = s.diagFee * job.hours;
    else labor = job.hours * s.laborRate;
    return Math.max(0, labor) + job.parts * s.partsMarkup;
  };

  /* ============================================================== demand */

  function seasonOf(day) {
    var d = ((day - 1) % 360);
    if (d < 90) return 'spring';
    if (d < 180) return 'summer';
    if (d < 270) return 'fall';
    return 'winter';
  }
  E.seasonOf = seasonOf;

  function jobWeight(s, job, season, intent, mods) {
    if (job.upsellOnly) return 0;
    var w = job.w;
    if (job.season && job.season !== season) w *= 0.22;
    if (job.season && job.season === season) w *= 2.4;
    /* Low-intent traffic skews to cheap maintenance; high intent skews to repair. */
    var ticket = job.hours * s.laborRate + job.parts * s.partsMarkup;
    var bigness = clamp(ticket / 600, 0.2, 3.2);
    w *= Math.pow(intent, bigness * 0.9);
    if (mods.potholes && (job.cat === 'Suspension' || job.cat === 'Tires' || job.cat === 'Alignment')) w *= 2.3;
    if (mods.heat_wave && job.cat === 'HVAC') w *= 3.0;
    if (mods.cold_snap && (job.id === 'battery' || job.cat === 'HVAC' || job.cat === 'Tires')) w *= 2.6;
    return w;
  }

  function computeLeads(s, mods) {
    var chan = {}, adLeads = 0;
    D.CHANNELS.forEach(function (c) {
      var st = s.channels[c.id];
      var effSpend = st.stock * (1 - c.decay);
      var leads = c.max * (1 - Math.exp(-effSpend / (c.cpl * c.max)));
      if (c.fleet && !E.hasFleetWriter(s)) leads = 0;
      chan[c.id] = { leads: leads, effSpend: effSpend, stock: st.stock };
      adLeads += leads;
    });

    var repF = 0.20 + 1.30 * Math.pow(clamp(s.reputation, 0, 100) / 100, 1.6);
    var organic = 6.0 * repF;
    var retention = 1 + (s.channels.loyalty.stock > 0 ? D.CHANNELS.find(function (c) { return c.id === 'loyalty'; }).retain * Math.min(3, s.channels.loyalty.stock / 40) : 0);
    var returns = (s.customerBase / 200) * retention * (0.40 + 0.80 * (s.reputation / 100));

    /* Weighted intent of today's traffic. */
    var intentNum = organic * 1.0 + returns * 1.28, intentDen = organic + returns;
    D.CHANNELS.forEach(function (c) {
      intentNum += chan[c.id].leads * c.intent; intentDen += chan[c.id].leads;
    });
    var intent = intentDen > 0 ? intentNum / intentDen : 1;

    var raw = organic + returns + adLeads;
    var pIdx = E.priceIndex(s);
    var priceMult = Math.pow(clamp(pIdx, 0.55, 1.9), -E.elasticity(pIdx));
    var dow = D.DOW_FACTOR[s.dow];
    var mult = dow * priceMult;
    if (mods.storm) mult *= 0.42;
    if (mods.competitor) mult *= 0.84;
    if (mods.competitor_closed) mult *= 1.20;
    if (mods.review_spike) mult *= 1.16;
    var season = s.season;
    if (season === 'summer') mult *= 1.06;
    if (season === 'winter') mult *= 1.02;
    if (season === 'fall') mult *= 0.97;

    return {
      lambda: raw * mult, intent: intent, byChannel: chan,
      organic: organic, returns: returns, adLeads: adLeads, priceMult: priceMult
    };
  }
  E.computeLeads = computeLeads;

  E.hasFleetWriter = function (s) {
    return s.writers.some(function (w) { return E.writerStats(s, w).fleet; });
  };

  /* ========================================================== work orders */

  function newRO(s, rng, job, intent, fleet) {
    return {
      id: uid('RO'), customer: makeName(rng),
      vehicle: rng.pick(D.VEHICLES),
      jobs: [], day: s.day, daysInShop: 0,
      rushed: false, partsDelay: false, comeback: false,
      fleet: !!fleet, intent: intent, revenue: 0, partsCost: 0, billedHours: 0
    };
  }

  function addLine(s, ro, job, opts) {
    opts = opts || {};
    var partsCost = job.parts * (opts.partsPremium || 1);
    ro.jobs.push({
      jobId: job.id, book: job.hours, remaining: job.hours,
      partsCost: partsCost, warranty: !!opts.warranty, done: false, techId: null
    });
  }

  /* Pull parts for a line. Returns true if the parts were on the shelf. */
  function pullParts(s, cat, cost, day) {
    if (cost <= 0) return true;
    if (s.inventory[cat] >= cost) { s.inventory[cat] -= cost; return true; }
    var short = cost - Math.max(0, s.inventory[cat]);
    s.inventory[cat] = Math.max(0, s.inventory[cat] - cost);
    var premium = short * (1 + D.EMERGENCY_PREMIUM * (s.upgrades.parts_room ? 0.6 : 1));
    s.cash -= premium;
    s._day.partsBought += premium;
    s._day.emergencyParts += premium;
    return false;
  }

  /* ============================================================ the day */

  E.endDay = function (s) {
    if (s.gameOver) return null;
    var rng = s._rng || (s._rng = new RNG(s.rngState));

    s.day += 1;
    s.dow = (s.dow + 1) % 7;
    s.season = seasonOf(s.day);

    var day = s._day = {
      day: s.day, dow: D.DOW[s.dow], season: s.season,
      opportunities: 0, turnedAway: 0, lostNoCapability: 0, declined: 0,
      rosOpened: 0, rosClosed: 0, carsOut: 0,
      billedHours: 0, availableHours: 0, bayHours: 0,
      laborSales: 0, partsSales: 0, partsCost: 0, partsBought: 0, emergencyParts: 0,
      wages: 0, adSpend: 0, fixed: 0, other: 0, revenue: 0,
      comebacks: 0, comebackHours: 0, upsellsSold: 0, upsellsOffered: 0,
      csiScores: [], events: [], notes: [], invoices: [], carryover: 0, missedJobs: {}
    };

    var closed = s.dow === 6; // Sunday

    /* ---- 1. morning housekeeping -------------------------------------- */
    tickModifiers(s);
    var mods = s.modifiers;

    /* stocking orders land */
    var late = mods.parts_late ? 1 : 0;
    s.incoming = s.incoming.filter(function (o) {
      if (o.day + late <= s.day) { s.inventory[o.cat] += o.amt; return false; }
      return true;
    });

    /* training completes */
    s.techs.concat(s.writers).forEach(function (p) {
      if (p.training && s.day >= p.outUntil) {
        applyTraining(s, p);
        day.notes.push(p.name + ' finished ' + p.training.name + '.');
        p.training = null;
      }
    });

    /* comebacks and appointments arrive */
    var arriving = [];
    s.queue = s.queue.filter(function (q) {
      if (q.day <= s.day) { arriving.push(q.ro); return false; }
      return true;
    });

    if (!closed) rollEvent(s, rng, day);
    mods = s.modifiers;

    /* ---- 2. capacity --------------------------------------------------- */
    var techPool = [], bayPool = [];
    if (!closed) {
      s.techs.forEach(function (t) {
        if (s.day < t.outUntil) return;
        if (mods.sickTech === t.id) { day.notes.push(t.name + ' called in sick.'); return; }
        var hrs = D.SHOP_HOURS + (s.overtime || 0);
        if (mods.inspection) hrs *= 0.5;
        techPool.push({ t: t, left: hrs, cap: hrs, eff: E.techEfficiency(s, t) });
        day.availableHours += hrs;
      });
      s.bays.forEach(function (b) {
        if (s.day < b.downUntil) return;
        var speed = D.TOOL_LEVELS[b.toolLevel - 1].speed;
        var hrs = D.SHOP_HOURS + (s.overtime || 0);
        if (mods.inspection) hrs *= 0.5;
        bayPool.push({ b: b, left: hrs, cap: hrs, speed: speed, equip: b.equip });
        day.bayHours += hrs;
      });
      if (s.upgrades.lube_lane) {
        bayPool.push({ b: { id: 'EXPRESS', name: 'Express Lane', equip: ['lift'], toolLevel: 2 }, left: D.SHOP_HOURS, speed: 1.25, equip: ['lift'], express: true });
        day.bayHours += D.SHOP_HOURS;
      }
    }

    /* ---- 3. demand ----------------------------------------------------- */
    var certSet = E.shopCerts(s);
    var lead = computeLeads(s, mods);
    day.leadInfo = lead;

    var writers = s.writers.filter(function (w) { return s.day >= w.outUntil; });
    var writerCap = sum(writers, function (w) { return E.writerStats(s, w).capacity; });
    var avgWriter = writers.length
      ? writers.map(function (w) { return E.writerStats(s, w); })
        .reduce(function (a, b) {
          return { close: a.close + b.close / writers.length, upsell: a.upsell + b.upsell / writers.length, csi: a.csi + b.csi / writers.length };
        }, { close: 0, upsell: 0, csi: 0 })
      : { close: 0.12, upsell: 0.9, csi: -12 };

    /* Cars parked overnight hold a space all day; everything else turns over as
       vehicles are finished and picked up, so a space handles more than one car. */
    var LOT_TURNOVER = 1.7;
    var lotCapacity = s.parking * LOT_TURNOVER;
    var lotUsed = s.wip.length + arriving.length;
    day.lotCapacity = lotCapacity;
    var newROs = [];

    if (!closed) {
      var count = rng.poisson(lead.lambda);
      day.opportunities = count;

      /* Fleet accounts deliver guaranteed units at a discounted labor rate. */
      s.fleetAccounts.forEach(function (f) {
        var units = rng.int(f.min, f.max);
        for (var k = 0; k < units; k++) {
          if (lotUsed >= lotCapacity) { day.turnedAway++; continue; }
          var fj = rng.weighted(D.JOBS, function (j) { return jobWeight(s, j, s.season, 1.05, mods); });
          if (!E.canDoJob(s, fj, certSet)) { day.lostNoCapability++; continue; }
          var fro = newRO(s, rng, fj, 1.05, true);
          fro.customer = f.name;
          addLine(s, fro, fj);
          newROs.push(fro); lotUsed++;
          day.rosOpened++; day.rosClosed++;
        }
      });

      var pi = E.priceIndex(s);
      var priceCloseMult = Math.pow(clamp(pi, 0.55, 1.9), -(0.30 + Math.max(0, pi - 1.05) * 3.2));
      var repClose = 0.80 + 0.40 * (s.reputation / 100);

      for (var i = 0; i < count; i++) {
        var job = rng.weighted(D.JOBS, function (j) { return jobWeight(s, j, s.season, lead.intent, mods); });

        if (!E.canDoJob(s, job, certSet)) {
          day.lostNoCapability++;
          day.missedJobs[job.id] = (day.missedJobs[job.id] || 0) + 1;
          continue;
        }
        if (lotUsed >= lotCapacity) {
          day.turnedAway++;
          s.customerBase = Math.max(80, s.customerBase - 0.35);  // they went somewhere else
          continue;
        }

        var overCap = day.rosOpened >= writerCap;
        if (overCap && rng.chance(0.35)) { day.declined++; continue; }  // call goes unanswered

        var ticket = E.jobPrice(s, job);
        var sizePenalty = clamp(1 - Math.log10(1 + ticket / 340) * 0.30, 0.45, 1);
        var closeP = avgWriter.close * priceCloseMult * repClose * sizePenalty *
          clamp(lead.intent, 0.5, 1.5) * (overCap ? 0.6 : 1) *
          (s.upgrades.shuttle && job.hours > 4 ? 1.18 : 1);
        closeP = clamp(closeP, 0.03, 0.95);

        day.rosOpened++;
        if (!rng.chance(closeP)) { day.declined++; continue; }

        var ro = newRO(s, rng, job, lead.intent, false);
        ro.rushed = overCap;
        addLine(s, ro, job);

        /* Digital inspection findings and the upsell attempt. */
        var findings = rng.poisson(s.upgrades.dvi ? 1.5 : 0.8);
        for (var f2 = 0; f2 < findings; f2++) {
          var uid2 = rng.pick(D.UPSELL_POOL);
          if (uid2 === job.id) continue;
          var uj = D.JOB_BY_ID[uid2];
          if (!E.canDoJob(s, uj, certSet)) continue;
          if (ro.jobs.some(function (l) { return l.jobId === uj.id; })) continue;
          day.upsellsOffered++;
          var uTicket = E.jobPrice(s, uj);
          /* Additional work is discretionary today, so it closes well below the
             rate of the job the customer actually came in for. */
          var uP = clamp(0.62 * avgWriter.close * avgWriter.upsell * priceCloseMult *
            clamp(1 - Math.log10(1 + uTicket / 260) * 0.34, 0.30, 1) * repClose, 0.02, 0.70);
          if (ro.jobs.length < 5 && rng.chance(uP)) { addLine(s, ro, uj); day.upsellsSold++; }
        }

        newROs.push(ro); lotUsed++;
        day.rosClosed++;
      }
    }

    /* Pull parts for every newly written line. */
    newROs.forEach(function (ro) {
      ro.jobs.forEach(function (l) {
        var j = D.JOB_BY_ID[l.jobId];
        if (l.partsCost <= 0) return;
        var ok = pullParts(s, j.pc, l.partsCost, s.day);
        if (!ok) { ro.partsDelay = true; l.delayed = true; }
      });
    });
    arriving.forEach(function (ro) {
      ro.jobs.forEach(function (l) {
        var j = D.JOB_BY_ID[l.jobId];
        if (l.partsCost > 0) pullParts(s, j.pc, l.partsCost, s.day);
      });
    });

    /* ---- 4. dispatch --------------------------------------------------- */
    var board = s.wip.concat(arriving, newROs);
    board.forEach(function (ro) { if (ro.day < s.day) ro.daysInShop++; });

    if (!closed) { dispatch(s, board, techPool, bayPool, day, rng); subletStranded(s, board, day); }
    day.techUse = techPool.map(function (tp) {
      return { id: tp.t.id, name: tp.t.name, used: tp.cap - tp.left, cap: tp.cap };
    });
    day.bayUse = bayPool.map(function (bp) {
      return { name: bp.b.name, used: bp.cap - bp.left, cap: bp.cap };
    });
    /* Work sitting on the lot, grouped by what it is waiting on. */
    day.waiting = { cert: {}, equip: {}, hours: 0 };
    board.forEach(function (ro) {
      ro.jobs.forEach(function (l) {
        if (l.done) return;
        var j = D.JOB_BY_ID[l.jobId];
        day.waiting.hours += l.remaining;
        var techs = s.techs.filter(function (t) { return t.certs.indexOf(j.cert) >= 0; });
        if (!techs.length) day.waiting.cert[j.cert] = (day.waiting.cert[j.cert] || 0) + l.remaining;
        var bays = s.bays.filter(function (b) { return E.bayCanHost(b, j); });
        if (!bays.length) day.waiting.equip[j.id] = (day.waiting.equip[j.id] || 0) + l.remaining;
      });
    });
    board.forEach(function (ro) { ro.jobs.forEach(function (l) { l.delayed = false; }); });

    /* ---- 5. invoice completed work ------------------------------------- */
    var stillOpen = [];
    board.forEach(function (ro) {
      var allDone = ro.jobs.every(function (l) { return l.done; });
      if (!allDone) { stillOpen.push(ro); return; }
      invoice(s, ro, day, rng, avgWriter);
    });
    s.wip = stillOpen;
    day.carryover = stillOpen.length;

    /* ---- 6. money ------------------------------------------------------ */
    settleFinances(s, day, techPool, writers, closed);

    /* ---- 7. reputation, retention, morale ------------------------------ */
    updateStanding(s, day, rng);

    /* ---- 8. wrap ------------------------------------------------------- */
    autoStock(s, day);
    if (s.day % 5 === 0) refreshCandidates(s, rng);
    s.rngState = rng.state;

    s._lastDetail = { waiting: day.waiting, techUse: day.techUse, bayUse: day.bayUse };
    day.cash = s.cash;
    day.reputation = s.reputation;
    day.rating = E.rating(s);
    day.netWorth = E.netWorth(s);
    s.history.push(compactDay(day));
    if (s.history.length > 800) s.history.shift();

    checkGameOver(s, day);
    return day;
  };

  /* --------------------------------------------------------- dispatching */

  function lineCanRunInBay(job, bay) {
    for (var i = 0; i < job.equip.length; i++) {
      if (job.equip[i] === 'lift') { if (bay.equip.indexOf('lift') < 0) return false; continue; }
      if (bay.equip.indexOf(job.equip[i]) < 0) return false;
    }
    return true;
  }

  /* Anything the shop physically cannot finish gets sublet to an outside vendor
     rather than sitting on the lot forever. You keep the customer and lose most
     of the margin — which is exactly what happens in real life. */
  function subletStranded(s, board, day) {
    board.forEach(function (ro) {
      if (ro.daysInShop < 2) return;
      ro.jobs.forEach(function (line) {
        if (line.done) return;
        var job = D.JOB_BY_ID[line.jobId];
        var hasBay = s.bays.some(function (b) { return s.day >= b.downUntil && E.bayCanHost(b, job); });
        var hasTech = s.techs.some(function (t) { return s.day >= t.outUntil && t.certs.indexOf(job.cert) >= 0; });
        if (hasBay && hasTech) return;
        var retail = E.jobPrice(s, job) - line.partsCost * s.partsMarkup;
        var fee = retail * 0.72;
        s.cash -= fee;
        day.sublet = (day.sublet || 0) + fee;
        line.done = true; line.remaining = 0; line.sublet = true;
        day.notes.push('Sublet ' + job.name + ' on ' + ro.vehicle + ' — $' + Math.round(fee).toLocaleString() + ' to an outside shop.');
      });
    });
  }

  function dispatch(s, board, techPool, bayPool, day, rng) {
    var order = board.slice();
    if (s.dispatch === 'profit') {
      order.sort(function (a, b) { return roValue(s, b) - roValue(s, a); });
    } else if (s.dispatch === 'fifo') {
      order.sort(function (a, b) { return a.day - b.day; });
    } else { /* promise-time first: oldest cars out the door first, then smallest */
      order.sort(function (a, b) {
        if (b.daysInShop !== a.daysInShop) return b.daysInShop - a.daysInShop;
        return roHours(a) - roHours(b);
      });
    }

    order.forEach(function (ro) {
      ro.jobs.forEach(function (line) {
        if (line.done) return;
        var job = D.JOB_BY_ID[line.jobId];
        /* Parts that had to be hot-shot in cannot start until midday, so the
           line only gets part of a shift no matter how much capacity is free. */
        var lineClockLeft = line.delayed ? D.SHOP_HOURS * 0.55 : Infinity;

        while (line.remaining > 0.001 && lineClockLeft > 0.02) {
          var bay = null, tech = null, i;
          for (i = 0; i < bayPool.length; i++) {
            if (bayPool[i].left <= 0.02) continue;
            if (bayPool[i].express && job.hours > 0.75) continue;
            if (!lineCanRunInBay(job, bayPool[i])) continue;
            if (!bay || bayPool[i].left > bay.left) bay = bayPool[i];
          }
          if (!bay) return;
          for (i = 0; i < techPool.length; i++) {
            var tp = techPool[i];
            if (tp.left <= 0.02) continue;
            if (tp.t.certs.indexOf(job.cert) < 0) continue;
            /* Prefer the least-qualified tech who can still do it — that is how a
               real dispatcher protects the A-tech's time for the gravy work. */
            if (!tech) { tech = tp; continue; }
            var better = (tp.t.level >= job.diff) && (tech.t.level < job.diff);
            var cheaper = (tp.t.level >= job.diff) === (tech.t.level >= job.diff) && tp.t.level < tech.t.level;
            if (better || cheaper) tech = tp;
          }
          if (!tech) return;

          var speed = tech.eff * bay.speed;
          var clockNeeded = line.remaining / speed;
          var budget = Math.min(bay.left, tech.left, clockNeeded, lineClockLeft);
          if (budget <= 0.02) return;

          var bookDone = budget * speed;
          line.remaining -= bookDone;
          bay.left -= budget;
          tech.left -= budget;
          tech.t.lifetimeHours += bookDone;
          line.techId = tech.t.id;
          day.billedHours += line.warranty ? 0 : bookDone;
          if (line.warranty) day.comebackHours += bookDone;
          lineClockLeft -= budget;

          if (line.remaining <= 0.001) {
            line.done = true;
            line.remaining = 0;
            tech.t.lifetimeJobs++;
            tech.t.xp += job.hours * (1 + job.diff * 0.18);
            /* Comeback roll — skill gap, tooling quality and fatigue drive it. */
            var toolMult = D.TOOL_LEVELS[(bay.b.toolLevel || 1) - 1].comeback;
            var p = 0.028 * (1 + 0.45 * (job.diff - tech.t.level)) * toolMult *
              (tech.t.fatigue > 0.65 ? 1.35 : 1) * (ro.rushed ? 1.2 : 1);
            p = clamp(p, 0.003, 0.40);
            if (!line.warranty && rng.chance(p)) {
              line.causedComeback = true;
              tech.t.lifetimeComebacks++;
            }
            break;
          }
        }
      });
    });
  }

  function roHours(ro) { return sum(ro.jobs, function (l) { return l.done ? 0 : l.remaining; }); }
  function roValue(s, ro) {
    return sum(ro.jobs, function (l) {
      if (l.done || l.warranty) return 0;
      var j = D.JOB_BY_ID[l.jobId];
      return E.jobPrice(s, j) - l.partsCost;
    });
  }

  /* ------------------------------------------------------------ invoicing */

  function invoice(s, ro, day, rng, avgWriter) {
    var labor = 0, parts = 0, cost = 0, hours = 0;
    ro.jobs.forEach(function (l) {
      var j = D.JOB_BY_ID[l.jobId];
      hours += l.book;
      if (l.warranty) { cost += l.partsCost; return; }
      var price = E.jobPrice(s, j);
      if (l.sublet) { /* billed to the customer as normal, cost booked as sublet */ }
      var partsRetail = l.partsCost * s.partsMarkup;
      labor += price - partsRetail;
      parts += partsRetail;
      cost += l.partsCost;
    });
    if (ro.fleet) { labor *= 0.86; parts *= 0.94; }   // negotiated fleet pricing

    var rev = labor + parts;
    ro.revenue = rev;
    day.laborSales += labor;
    day.partsSales += parts;
    day.partsCost += cost;
    day.carsOut++;
    day.invoices.push({
      customer: ro.customer, vehicle: ro.vehicle, total: rev, hours: hours,
      lines: ro.jobs.map(function (l) { return D.JOB_BY_ID[l.jobId].name + (l.warranty ? ' (warranty)' : ''); }),
      days: ro.daysInShop
    });

    /* Customer satisfaction for this ticket. */
    var csi = 82 + avgWriter.csi;
    /* Nobody expects a 13-hour engine job back the same afternoon, but they do
       expect a brake job back today. Roughly a day of grace per six book hours. */
    var allowance = Math.max(1, Math.ceil(roHoursTotal(ro) / 6)) - 1;
    if (s.upgrades.shuttle) allowance += 1;
    csi -= Math.max(0, ro.daysInShop - allowance) * 8;
    if (ro.partsDelay) csi -= 6;
    if (ro.rushed) csi -= 8;
    if (ro.comeback) csi -= 34;
    if (s.upgrades.lounge) csi += 3;
    if (s.upgrades.scheduler) csi += 2;
    if (s.upgrades.shuttle && ro.daysInShop >= 1) csi += 5;
    /* Feeling gouged is the single fastest way to earn a one-star review, and
       it accelerates the further over market you go. */
    csi -= Math.pow(Math.max(0, E.priceIndex(s) - 1.02), 1.5) * 190;
    csi = clamp(csi, 0, 100);
    day.csiScores.push(csi);

    /* Schedule any comebacks this ticket earned. */
    ro.jobs.forEach(function (l) {
      if (!l.causedComeback) return;
      var j = D.JOB_BY_ID[l.jobId];
      var back = {
        id: uid('RO'), customer: ro.customer, vehicle: ro.vehicle,
        jobs: [{ jobId: j.id, book: j.hours * 0.75, remaining: j.hours * 0.75, partsCost: l.partsCost * 0.5, warranty: true, done: false, techId: null }],
        day: s.day, daysInShop: 0, rushed: false, partsDelay: false, comeback: true,
        fleet: ro.fleet, revenue: 0
      };
      s.queue.push({ day: s.day + rng.int(2, 9), ro: back });
      day.comebacks++;
      s.lifetime.comebacks++;
    });

    /* Retention: happy customers become part of the base. */
    if (!ro.comeback) {
      if (csi >= 85) s.customerBase += 1.0;
      else if (csi >= 70) s.customerBase += 0.55;
      else if (csi >= 50) s.customerBase += 0.1;
      else s.customerBase -= 1.6;
    } else {
      s.customerBase -= 1.4;
    }
    s.lifetime.cars++;
    s.lifetime.hours += hours;
  }

  function roHoursTotal(ro) { return sum(ro.jobs, function (l) { return l.book; }); }

  /* ------------------------------------------------------------- finances */

  function settleFinances(s, day, techPool, writers, closed) {
    var burden = 1 + D.PAYROLL_BURDEN;

    day.techWages = 0; day.writerWages = 0;
    if (!closed) {
      techPool.forEach(function (tp) {
        var wage = E.techWage(tp.t);
        var ot = Math.max(0, (s.overtime || 0));
        day.techWages += (D.SHOP_HOURS * wage + ot * wage * 1.5) * burden;
      });
      writers.forEach(function (w) {
        day.writerWages += D.SHOP_HOURS * E.writerWage(w) * burden;
      });
      /* Advisors run on a small commission of shop gross profit. */
      if (writers.length) day.writerWages += Math.max(0, day.laborSales + day.partsSales - day.partsCost) * 0.03;
    }
    day.wages = day.techWages + day.writerWages;

    day.fixed = E.dailyFixedCosts(s);

    D.CHANNELS.forEach(function (c) {
      var st = s.channels[c.id];
      var spend = st.spend || 0;
      if (c.fleet && !E.hasFleetWriter(s)) spend = 0;
      day.adSpend += spend;
      st.stock = st.stock * c.decay + spend;
    });
    s.lifetime.adSpend += day.adSpend;

    day.revenue = day.laborSales + day.partsSales;
    var supplies = day.laborSales * D.SHOP_SUPPLY_RATE;
    var cardFees = day.revenue * 0.026;
    var carrying = 0;
    Object.keys(D.PART_CATS).forEach(function (k) { carrying += s.inventory[k] * D.PART_CATS[k].carry; });
    day.other = supplies + cardFees + carrying;

    /* Debt service. */
    var loanInt = s.loan.balance * s.loan.rate / 365;
    var loanPay = s.loan.balance > 0 ? Math.min(s.loan.balance + loanInt, 1512 / 30) : 0;
    s.loan.balance = Math.max(0, s.loan.balance + loanInt - loanPay);
    var creditInt = s.credit.balance * s.credit.rate / 365;
    s.credit.balance += creditInt;
    day.debtService = loanPay + creditInt;

    var cashIn = day.revenue;
    var cashOut = day.wages + day.fixed + day.adSpend + day.other + loanPay;
    s.cash += cashIn - cashOut;

    /* Auto-draw on the line of credit rather than hard-failing mid-day. */
    if (s.cash < 0) {
      var need = -s.cash;
      s.credit.balance += need;
      s.cash = 0;
      day.notes.push('Drew $' + Math.round(need).toLocaleString() + ' on the line of credit.');
    } else if (s.credit.balance > 0 && s.cash > 12000) {
      var pay = Math.min(s.credit.balance, s.cash - 12000);
      s.credit.balance -= pay; s.cash -= pay;
    }

    /* Shop-standard presentation: parts cost, technician labor cost and sublet
       are cost of sales; everything else is overhead. */
    day.costOfSales = day.partsCost + day.techWages + (day.sublet || 0);
    day.gp = day.revenue - day.costOfSales;
    day.gpPct = day.revenue ? day.gp / day.revenue : 0;
    day.laborGP = day.laborSales - day.techWages;
    day.laborGPPct = day.laborSales ? day.laborGP / day.laborSales : 0;
    day.partsGP = day.partsSales - day.partsCost;
    day.partsGPPct = day.partsSales ? day.partsGP / day.partsSales : 0;
    day.overhead = day.writerWages + day.fixed + day.adSpend + day.other + day.debtService;
    day.netProfit = day.gp - day.overhead;
    day.aro = day.carsOut ? day.revenue / day.carsOut : 0;
    day.effectiveLaborRate = day.billedHours ? day.laborSales / day.billedHours : 0;
    day.productivity = day.availableHours ? day.billedHours / day.availableHours : 0;
    day.bayUtil = day.bayHours ? (day.billedHours + day.comebackHours) / day.bayHours : 0;
    day.closeRate = day.rosOpened ? day.rosClosed / day.rosOpened : 0;

    s.lifetime.revenue += day.revenue;
    s.lifetime.gp += day.gp;
  }

  /* ---------------------------------------------------- standing / morale */

  function updateStanding(s, day, rng) {
    if (day.csiScores.length) {
      var avg = day.csiScores.reduce(function (a, b) { return a + b; }, 0) / day.csiScores.length;
      day.csi = avg;
      var weight = clamp(0.035 + day.csiScores.length * 0.004, 0.035, 0.10);
      /* The better you are known, the higher the bar customers hold you to. */
      var expectation = (s.reputation - 52) * 0.30;
      s.reputation = s.reputation * (1 - weight) + (avg - expectation) * weight;
    } else {
      day.csi = null;
      s.reputation = s.reputation * 0.9985 + 50 * 0.0015;  // silence drifts toward average
    }
    var revCh = D.CHANNELS.find(function (c) { return c.id === 'reviews'; });
    if (s.channels.reviews.spend > 0) {
      s.reputation += revCh.rep * Math.min(3, s.channels.reviews.stock / 30) * (day.carsOut > 0 ? 1 : 0.3);
    }
    if (s.modifiers.review_spike) s.reputation += 0.30;
    if (s.modifiers.comeback_storm) s.reputation -= 0.55;
    s.reputation = clamp(s.reputation, 3, 99);

    /* Customer base decays without contact. */
    s.customerBase = Math.max(80, s.customerBase * 0.9985);

    /* Morale & fatigue. */
    var loadRatio = day.availableHours ? (day.billedHours + day.comebackHours) / day.availableHours : 0;
    s.techs.forEach(function (t) {
      if (s.dow === 6) { t.fatigue = Math.max(0, t.fatigue - 0.35); t.morale = clamp(t.morale + 1.5, 0, 100); return; }
      if (s.day < t.outUntil) return;
      t.fatigue = clamp(t.fatigue + (loadRatio > 0.92 ? 0.10 : loadRatio > 0.7 ? 0.03 : -0.06) + (s.overtime > 0 ? 0.06 : 0), 0, 1);
      var pay = loadRatio;                  // flat-rate techs want hours
      var m = 0;
      if (pay < 0.45) m -= 1.6;             // starving on the board
      else if (pay > 0.95) m -= 0.7;        // buried
      else m += 0.8;
      if (t.fatigue > 0.75) m -= 1.0;
      if (s.reputation > 70) m += 0.3;
      t.morale = clamp(t.morale + m, 0, 100);

      /* Promotion readiness. */
      var nxt = D.TECH_LEVELS[t.level];
      t.readyToPromote = !!(nxt && t.xp >= nxt.xp);

      /* Quitting. */
      if (t.morale < 22 && rng.chance(0.07)) {
        day.notes.push(t.name + ' quit. Morale was in the floor.');
        s.techs = s.techs.filter(function (x) { return x.id !== t.id; });
      }
    });
    s.writers.forEach(function (w) {
      w.xp += day.rosClosed;
      var nxt = D.WRITER_LEVELS[w.level];
      w.readyToPromote = !!(nxt && w.xp >= [0, 180, 520, 1150][w.level]);
    });
  }

  /* ---------------------------------------------------------- inventory */

  function autoStock(s, day) {
    Object.keys(D.PART_CATS).forEach(function (k) {
      var target = s.stockTarget[k] || 0;
      var onHand = s.inventory[k] + sum(s.incoming.filter(function (o) { return o.cat === k; }), function (o) { return o.amt; });
      if (onHand < target * 0.72) {
        var qty = target - onHand;
        var price = qty * (1 - D.STOCK_DISCOUNT - (s.upgrades.parts_room ? 0.04 : 0));
        if (s.cash - price < -20000) return;
        s.cash -= price;
        day.partsBought += price;
        s.incoming.push({ cat: k, amt: qty, day: s.day + D.PART_CATS[k].lead });
      }
    });
  }

  /* ------------------------------------------------------------- events */

  function tickModifiers(s) {
    Object.keys(s.modifiers).forEach(function (k) {
      if (typeof s.modifiers[k] === 'number') {
        s.modifiers[k] -= 1;
        if (s.modifiers[k] <= 0) delete s.modifiers[k];
      } else if (k === 'sickTech') {
        delete s.modifiers[k];
      }
    });
  }

  function rollEvent(s, rng, day) {
    if (!rng.chance(0.26)) return;
    var pool = D.EVENTS.filter(function (e) { return !e.season || e.season === s.season; });
    var ev = rng.weighted(pool, function (e) { return e.w; });
    var m = s.modifiers;
    switch (ev.id) {
      case 'sick':
        if (!s.techs.length) return;
        var t = rng.pick(s.techs); m.sickTech = t.id;
        day.events.push({ name: ev.name, text: t.name + ' ' + ev.text, bad: true });
        return;
      case 'tow_in':
        var big = rng.pick(['headgasket', 'trans_rebuild', 'timing', 'ac_compressor', 'alternator']);
        var j = D.JOB_BY_ID[big];
        if (!E.canDoJob(s, j)) { day.events.push({ name: 'Tow-in refused', text: 'A big job came in on a hook and you had to send it away — you cannot do ' + j.name + '.', bad: true }); return; }
        var ro = newRO(s, rng, j, 1.4, false);
        addLine(s, ro, j);
        s.queue.push({ day: s.day, ro: ro });
        day.events.push({ name: ev.name, text: ev.text + ' (' + j.name + ', ' + j.hours + ' hrs)', bad: false });
        return;
      case 'equip_fail':
        var b = rng.pick(s.bays); b.downUntil = s.day + rng.int(1, 3);
        var repair = rng.int(600, 2600); s.cash -= repair;
        day.events.push({ name: ev.name, text: b.name + ' is down for repairs. $' + repair.toLocaleString() + ' to fix.', bad: true });
        return;
      case 'inspection':
        var fine = rng.int(400, 2200); s.cash -= fine; m.inspection = 1;
        day.events.push({ name: ev.name, text: ev.text + ' $' + fine.toLocaleString() + ' in fines.', bad: true });
        return;
      case 'fleet_offer':
        if (!E.hasFleetWriter(s)) return;
        if (s.fleetAccounts.length >= 4) return;
        var acct = { name: rng.pick(['Vantage Plumbing', 'Rio Grande Landscaping', 'Meridian Couriers', 'Halcyon Electric', 'Cardinal HVAC']) + ' Fleet', min: 1, max: rng.int(2, 4) };
        s.pendingFleet = acct;
        day.events.push({ name: ev.name, text: acct.name + ' wants to move ' + acct.min + '-' + acct.max + ' units a day to you at fleet pricing.', bad: false, choice: 'fleet' });
        return;
      case 'poach':
        var target = s.techs.filter(function (x) { return x.level >= 3; });
        if (!target.length) return;
        var vt = rng.pick(target);
        if (vt.morale > 68) { day.events.push({ name: ev.name, text: vt.name + ' turned down a dealership offer. Loyalty is worth something.', bad: false }); return; }
        vt.morale = clamp(vt.morale - 12, 0, 100);
        day.events.push({ name: ev.name, text: 'The dealership is courting ' + vt.name + '. Morale is slipping — a raise or a promotion would help.', bad: true });
        return;
      default:
        m[ev.id] = ev.id === 'competitor' ? rng.int(10, 25) : rng.int(1, 4);
        day.events.push({ name: ev.name, text: ev.text, bad: ['comeback_storm', 'storm', 'parts_late', 'competitor'].indexOf(ev.id) >= 0 });
    }
  }

  /* --------------------------------------------------- bottleneck report */
  /* Names the single constraint costing the shop the most right now, so the
     player knows where the next dollar belongs. */
  E.bottleneck = function (s) {
    var h = s.history.slice(-10);
    if (!h.length) return null;
    var n = h.length, avg = function (k) { return h.reduce(function (a, b) { return a + (b[k] || 0); }, 0) / n; };
    var d = s._lastDetail;
    var cands = [];

    if (avg('turnedAway') > 0.4) {
      cands.push({ score: avg('turnedAway') * 3, key: 'parking',
        title: 'Parking', detail: 'You are turning away ' + avg('turnedAway').toFixed(1) +
        ' customers a day because the lot is full. Those customers do not come back.',
        fix: 'Add parking spaces, or get cars finished and picked up faster.' });
    }
    if (avg('lostNoCapability') > 0.4) {
      cands.push({ score: avg('lostNoCapability') * 2.6, key: 'capability',
        title: 'Capability', detail: 'You refuse ' + avg('lostNoCapability').toFixed(1) +
        ' jobs a day that you are not equipped or certified to do.',
        fix: 'Check the menu board for what you are turning down, then buy the tool or send a tech to school.' });
    }
    if (d && d.waiting) {
      var certKeys = Object.keys(d.waiting.cert);
      if (certKeys.length) {
        var worst = certKeys.sort(function (a, b) { return d.waiting.cert[b] - d.waiting.cert[a]; })[0];
        cands.push({ score: d.waiting.cert[worst] * 1.5, key: 'cert',
          title: 'Certification', detail: Math.round(d.waiting.cert[worst] * 10) / 10 +
          ' hours of sold work is parked because nobody on the floor holds a ' + D.CERTS[worst].name + ' certification.',
          fix: 'Send a technician to school, or hire one who already holds it.' });
      }
      var eqKeys = Object.keys(d.waiting.equip);
      if (eqKeys.length) {
        var wj = D.JOB_BY_ID[eqKeys.sort(function (a, b) { return d.waiting.equip[b] - d.waiting.equip[a]; })[0]];
        var miss = E.missingEquipFor(s, wj);
        cands.push({ score: 30, key: 'equip',
          title: 'Equipment', detail: 'Sold work is stuck because no single bay carries ' +
          miss.miss.map(function (x) { return D.EQUIPMENT[x].name; }).join(' and ') + '.',
          fix: 'Install it in one bay. Equipment split across two bays does not combine.' });
      }
    }
    if (d && d.techUse && d.techUse.length) {
      var used = d.techUse.reduce(function (a, b) { return a + b.used; }, 0);
      var cap = d.techUse.reduce(function (a, b) { return a + b.cap; }, 0);
      if (cap > 0 && used / cap > 0.90 && s.wip.length > s.techs.length) {
        cands.push({ score: 55, key: 'techs', title: 'Technician hours',
          detail: 'Your technicians ran ' + Math.round(used / cap * 100) + '% of their clock hours and there are still ' +
          s.wip.length + ' cars on the lot.',
          fix: 'Hire another technician, promote the ones you have, or run overtime.' });
      }
    }
    if (d && d.bayUse && d.bayUse.length) {
      var bu = d.bayUse.reduce(function (a, b) { return a + b.used; }, 0);
      var bc = d.bayUse.reduce(function (a, b) { return a + b.cap; }, 0);
      if (bc > 0 && bu / bc > 0.88) {
        cands.push({ score: 50, key: 'bays', title: 'Bay space',
          detail: 'Every bay ran ' + Math.round(bu / bc * 100) + '% full. Technicians cannot work without somewhere to put the car.',
          fix: 'Build another bay, or add an express lane so oil changes stop tying up repair bays.' });
      }
    }
    if (s.techs.length > s.bays.length + (s.upgrades.lube_lane ? 1 : 0)) {
      cands.push({ score: 60, key: 'bays', title: 'More technicians than bays',
        detail: 'You employ ' + s.techs.length + ' technicians and have ' + s.bays.length +
        ' bays. A technician with nowhere to put a car is paid to stand still.',
        fix: 'Build another bay before you hire anyone else.' });
    }
    var cap2 = s.writers.reduce(function (t, w) { return t + E.writerStats(s, w).capacity; }, 0);
    if (avg('opportunities') > cap2 * 1.05) {
      cands.push({ score: 45, key: 'writers', title: 'Front counter',
        detail: 'You see about ' + avg('opportunities').toFixed(1) + ' customers a day and your writers can properly handle ' + cap2 +
        '. The overflow gets rushed, and rushed estimates do not close.',
        fix: 'Hire or promote a service writer, or add online scheduling.' });
    }
    var totalAds = D.CHANNELS.reduce(function (t, c) { return t + s.channels[c.id].spend; }, 0);
    if (!cands.length) {
      var prod = avg('productivity');
      if (prod < 0.70) {
        cands.push({ score: 20, key: 'demand', title: 'Not enough cars',
          detail: 'Your technicians are only ' + Math.round(prod * 100) + '% productive. You are paying for capacity you are not selling.',
          fix: totalAds < 30 ? 'You are barely advertising. Buy some traffic — you have the room to serve it.'
            : 'Raise your marketing budget, sharpen your prices, or work on reputation.' });
      }
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands[0] || null;
  };

  /* --------------------------------------------------------- game over */

  E.netWorth = function (s) {
    var equip = 0;
    s.bays.forEach(function (b) {
      equip += 30000;
      for (var i = 1; i < b.toolLevel; i++) equip += D.TOOL_LEVELS[i].cost * 0.6;
      b.equip.forEach(function (e) { equip += (D.EQUIPMENT[e] ? D.EQUIPMENT[e].cost : 0) * 0.6; });
    });
    Object.keys(s.upgrades).forEach(function (k) { if (s.upgrades[k] && D.UPGRADES[k]) equip += D.UPGRADES[k].cost * 0.5; });
    var inv = 0; Object.keys(s.inventory).forEach(function (k) { inv += s.inventory[k]; });
    equip += s.parking * 2000;
    return Math.round(s.cash + inv + equip - s.loan.balance - s.credit.balance);
  };

  function checkGameOver(s, day) {
    if (s.credit.balance > 180000) {
      s.gameOver = { win: false, reason: 'The line of credit hit $180,000 and the bank called the note. The shop is closed.' };
    }
    if (!s.techs.length && s.cash < 3000 && s.credit.balance > 60000) {
      s.gameOver = { win: false, reason: 'No technicians, no cash, no way to turn a wrench. The doors are locked.' };
    }
    if (E.netWorth(s) >= 2000000) {
      s.gameOver = { win: true, reason: 'Net worth crossed $2,000,000. You built a real business.' };
    }
  }

  function compactDay(d) {
    return {
      day: d.day, dow: d.dow, revenue: d.revenue, gp: d.gp, netProfit: d.netProfit,
      cars: d.carsOut, aro: d.aro, hours: d.billedHours, csi: d.csi, cash: d.cash,
      rep: d.reputation, opportunities: d.opportunities, closeRate: d.closeRate,
      productivity: d.productivity, bayUtil: d.bayUtil, adSpend: d.adSpend,
      turnedAway: d.turnedAway, comebacks: d.comebacks, netWorth: d.netWorth,
      carryover: d.carryover, lostNoCapability: d.lostNoCapability
    };
  }

  /* ============================================================= actions */

  E.actions = {
    hireTech: function (s, id) {
      var c = s.candidates.techs.find(function (x) { return x.id === id; });
      if (!c) return 'Candidate is gone.';
      if (s.cash < c.signing) return 'Not enough cash for the signing bonus.';
      s.cash -= c.signing;
      c.wageOverride = c.askWage; c.hiredDay = s.day;
      s.techs.push(c);
      s.candidates.techs = s.candidates.techs.filter(function (x) { return x.id !== id; });
      return null;
    },
    hireWriter: function (s, id) {
      var c = s.candidates.writers.find(function (x) { return x.id === id; });
      if (!c) return 'Candidate is gone.';
      if (s.cash < c.signing) return 'Not enough cash for the signing bonus.';
      s.cash -= c.signing;
      c.wageOverride = c.askWage; c.hiredDay = s.day;
      s.writers.push(c);
      s.candidates.writers = s.candidates.writers.filter(function (x) { return x.id !== id; });
      return null;
    },
    fire: function (s, id) {
      var p = s.techs.find(function (x) { return x.id === id; }) || s.writers.find(function (x) { return x.id === id; });
      if (!p) return 'Not on the payroll.';
      var sev = (p.wageOverride || 30) * 40;
      s.cash -= sev;
      s.techs = s.techs.filter(function (x) { return x.id !== id; });
      s.writers = s.writers.filter(function (x) { return x.id !== id; });
      return null;
    },
    raise: function (s, id, amount) {
      var p = s.techs.find(function (x) { return x.id === id; }) || s.writers.find(function (x) { return x.id === id; });
      if (!p) return 'Not on the payroll.';
      p.wageOverride = (p.wageOverride || E.techWage(p)) + amount;
      p.morale = clamp(p.morale + amount * 3.5, 0, 100);
      return null;
    },
    trainCert: function (s, techId, certId) {
      var t = s.techs.find(function (x) { return x.id === techId; });
      var c = D.CERTS[certId];
      if (!t || !c) return 'Unknown course.';
      if (t.certs.indexOf(certId) >= 0) return 'Already certified.';
      if (t.training) return t.name + ' is already in a class.';
      var disc = s.upgrades.training_room ? 0.5 : 1;
      var cost = Math.round(c.cost * disc), days = Math.max(1, Math.round(c.days * disc));
      if (s.cash < cost) return 'Not enough cash.';
      s.cash -= cost;
      t.training = { type: 'cert', id: certId, name: c.name };
      t.outUntil = s.day + days;
      t.morale = clamp(t.morale + 4, 0, 100);
      return null;
    },
    promoteTech: function (s, techId) {
      var t = s.techs.find(function (x) { return x.id === techId; });
      if (!t) return 'Not on the payroll.';
      if (t.level >= 5) return 'Already at the top of the ladder.';
      var nxt = D.TECH_LEVELS[t.level];
      if (t.xp < nxt.xp) return 'Needs ' + Math.ceil(nxt.xp - t.xp) + ' more experience.';
      var cost = D.TECH_PROMOTION_COST[t.level];
      if (s.upgrades.training_room) cost = Math.round(cost * 0.5);
      if (s.cash < cost) return 'Not enough cash for the certification program.';
      s.cash -= cost;
      t.level++;
      t.wageOverride = Math.max(t.wageOverride || 0, D.TECH_LEVELS[t.level - 1].wage);
      t.morale = clamp(t.morale + 12, 0, 100);
      return null;
    },
    salesCourse: function (s, writerId, courseId) {
      var w = s.writers.find(function (x) { return x.id === writerId; });
      var c = D.SALES_COURSES[courseId];
      if (!w || !c) return 'Unknown course.';
      if (w.courses.indexOf(courseId) >= 0) return 'Already completed.';
      if (w.training) return w.name + ' is already in a class.';
      var disc = s.upgrades.training_room ? 0.5 : 1;
      var cost = Math.round(c.cost * disc), days = Math.max(1, Math.round(c.days * disc));
      if (s.cash < cost) return 'Not enough cash.';
      s.cash -= cost;
      w.training = { type: 'sales', id: courseId, name: c.name };
      w.outUntil = s.day + days;
      return null;
    },
    promoteWriter: function (s, writerId) {
      var w = s.writers.find(function (x) { return x.id === writerId; });
      if (!w) return 'Not on the payroll.';
      if (w.level >= 4) return 'Already a Service Manager.';
      if (w.xp < [0, 180, 520, 1150][w.level]) return 'Needs more repair orders under their belt.';
      var cost = D.WRITER_PROMOTION_COST[w.level];
      if (s.cash < cost) return 'Not enough cash.';
      s.cash -= cost;
      w.level++;
      w.wageOverride = Math.max(w.wageOverride || 0, D.WRITER_LEVELS[w.level - 1].wage);
      return null;
    },
    buyBay: function (s) {
      var cost = D.BAY_COST(s.bays.length);
      if (s.cash < cost) return 'Not enough cash. This one runs $' + cost.toLocaleString() + '.';
      s.cash -= cost;
      s.bays.push(makeBay('Bay ' + (s.bays.length + 1), 1, ['lift']));
      return null;
    },
    upgradeTools: function (s, bayId) {
      var b = s.bays.find(function (x) { return x.id === bayId; });
      if (!b) return 'No such bay.';
      if (b.toolLevel >= 5) return 'That bay already has OEM special tooling.';
      var nxt = D.TOOL_LEVELS[b.toolLevel];
      if (s.cash < nxt.cost) return 'Not enough cash.';
      s.cash -= nxt.cost;
      b.toolLevel++;
      return null;
    },
    buyEquipment: function (s, bayId, equipId) {
      var b = s.bays.find(function (x) { return x.id === bayId; });
      var e = D.EQUIPMENT[equipId];
      if (!b || !e) return 'Unknown equipment.';
      if (b.equip.indexOf(equipId) >= 0) return 'Already installed in that bay.';
      if (s.cash < e.cost) return 'Not enough cash.';
      s.cash -= e.cost;
      b.equip.push(equipId);
      return null;
    },
    buyParking: function (s, n) {
      var cost = D.PARKING_COST * n;
      if (s.cash < cost) return 'Not enough cash.';
      s.cash -= cost; s.parking += n;
      return null;
    },
    buyUpgrade: function (s, id) {
      var u = D.UPGRADES[id];
      if (!u) return 'Unknown upgrade.';
      if (s.upgrades[id]) return 'Already installed.';
      if (s.cash < u.cost) return 'Not enough cash.';
      s.cash -= u.cost; s.upgrades[id] = true;
      return null;
    },
    setSpend: function (s, channelId, amount) {
      var c = D.CHANNELS.find(function (x) { return x.id === channelId; });
      if (!c) return 'Unknown channel.';
      if (s.day < c.unlock) return 'Not available until day ' + c.unlock + '.';
      s.channels[channelId].spend = clamp(Math.round(amount), 0, c.cap);
      return null;
    },
    setStockTarget: function (s, cat, amount) {
      s.stockTarget[cat] = Math.max(0, Math.round(amount));
      return null;
    },
    borrow: function (s, amount) {
      amount = Math.round(amount);
      if (amount <= 0) return 'Enter an amount.';
      if (s.loan.balance + amount > 400000) return 'The bank will not go past $400,000 of term debt.';
      s.loan.balance += amount; s.cash += amount;
      return null;
    },
    repay: function (s, amount) {
      amount = Math.min(Math.round(amount), s.cash, s.loan.balance);
      if (amount <= 0) return 'Nothing to repay.';
      s.loan.balance -= amount; s.cash -= amount;
      return null;
    },
    acceptFleet: function (s) {
      if (!s.pendingFleet) return 'No offer on the table.';
      s.fleetAccounts.push(s.pendingFleet);
      s.pendingFleet = null;
      return null;
    },
    declineFleet: function (s) { s.pendingFleet = null; return null; }
  };

  /* Restore a saved game: the RNG and the id counter live outside the JSON. */
  E.rehydrate = function (s) {
    s._rng = new RNG(s.rngState);
    var max = 0;
    function scan(list) {
      (list || []).forEach(function (o) {
        var n = parseInt(String(o.id).replace(/^[A-Za-z]+/, ''), 10);
        if (n > max) max = n;
      });
    }
    scan(s.bays); scan(s.techs); scan(s.writers); scan(s.wip);
    scan(s.candidates && s.candidates.techs); scan(s.candidates && s.candidates.writers);
    scan((s.queue || []).map(function (q) { return q.ro; }));
    nextId = max + 1;
    return s;
  };

  E.DATA = D;
  G.ENGINE = E;
})(typeof window !== 'undefined' ? window : globalThis);
