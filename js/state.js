/*
 * Game state: construction, staff generation, save/load, and the small
 * derived getters that both the simulation and the UI need.
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  var D = NS.DATA;
  var SAVE_KEY = 'autoshop.save.v1';

  var XP_FOR_LEVEL = [0, 0, 240, 700, 1600, 3200];

  function levelFromXp(xp) {
    var lvl = 1;
    for (var i = 2; i < XP_FOR_LEVEL.length; i++) {
      if (xp >= XP_FOR_LEVEL[i]) lvl = i;
    }
    return lvl;
  }

  function xpProgress(xp) {
    var lvl = levelFromXp(xp);
    if (lvl >= 5) return { level: 5, pct: 1, next: null };
    var floorXp = XP_FOR_LEVEL[lvl];
    var nextXp = XP_FOR_LEVEL[lvl + 1];
    return { level: lvl, pct: (xp - floorXp) / (nextXp - floorXp), next: nextXp };
  }

  var uidCounter = 1;
  function uid(prefix) {
    return prefix + '_' + (uidCounter++);
  }

  function randomName(rng) {
    return rng.pick(D.FIRST_NAMES) + ' ' + rng.pick(D.LAST_NAMES);
  }

  function makeTech(rng, level) {
    var specCount = level >= 4 ? 2 : (level >= 2 && rng.chance(0.55) ? 1 : 0);
    var specs = [];
    var pool = D.TECH_SPECIALTIES.filter(function (s) { return s !== 'general'; });
    rng.shuffle(pool);
    for (var i = 0; i < specCount; i++) specs.push(pool[i]);
    var wage = D.TECH_WAGE[level] * rng.float(0.92, 1.12);
    return {
      id: uid('tech'),
      name: randomName(rng),
      level: level,
      xp: XP_FOR_LEVEL[level],
      specialties: specs,
      wage: Math.round(wage * 100) / 100,
      morale: rng.float(0.68, 0.86),
      fatigue: 0,
      efficiencyBonus: rng.float(-0.04, 0.06),
      qualityBonus: rng.float(-0.05, 0.10),
      trainingId: null,
      trainingDaysLeft: 0,
      outDays: 0,
      courses: [],
      hiredDay: 0,
      hoursWorked: 0,
      billedHours: 0,
      signingBonus: level >= 4 ? Math.round(level * 900) : (level >= 3 ? 750 : 0)
    };
  }

  function makeWriter(rng, level) {
    var salary = D.WRITER_SALARY[level] * rng.float(0.94, 1.10);
    return {
      id: uid('adv'),
      name: randomName(rng),
      level: level,
      xp: XP_FOR_LEVEL[level],
      salary: Math.round(salary),
      closeBonus: rng.float(-0.03, 0.05),
      upsellBonus: rng.float(-0.03, 0.05),
      capacityBonus: 0,
      retentionBonus: 0,
      csiBonus: rng.float(-0.05, 0.10),
      fleetBonus: 0,
      morale: rng.float(0.7, 0.88),
      trainingId: null,
      trainingDaysLeft: 0,
      outDays: 0,
      courses: [],
      hiredDay: 0,
      roHandled: 0,
      signingBonus: level >= 4 ? Math.round(level * 700) : 0
    };
  }

  function makeBay(index, tools, active) {
    return {
      id: 'bay' + index,
      name: 'Bay ' + index,
      active: active !== false,
      tools: tools,
      condition: 1.0,
      downDays: 0,
      hoursUsed: 0
    };
  }

  function emptyTools() {
    var t = {};
    D.TOOL_ORDER.forEach(function (id) { t[id] = 0; });
    return t;
  }

  function newGame(opts) {
    opts = opts || {};
    var diff = D.DIFFICULTY[opts.difficulty || 'normal'];
    var seed = opts.seed !== undefined && opts.seed !== '' ? opts.seed : String(Date.now());
    var rng = new NS.Rng(NS.hashString(String(seed)) + 7919);
    uidCounter = 1;

    /* Bay 3 is deliberately bare: the first real decision is what to put in it. */
    var bay1 = emptyTools();
    bay1.lift = 1; bay1.handtools = 1; bay1.press = 1;
    var bay2 = emptyTools();
    bay2.lift = 1; bay2.handtools = 1; bay2.scanner = 1;
    var bay3 = emptyTools();
    bay3.handtools = 1;

    var inventory = {};
    var partPrices = {};
    D.PART_CATEGORIES.forEach(function (c) {
      inventory[c.id] = c.id === 'tires' ? 900 : 520;
      partPrices[c.id] = 1.0;
    });

    var marketing = {};
    var adStock = {};
    D.CHANNELS.forEach(function (c) { marketing[c.id] = 0; adStock[c.id] = 0; });
    marketing.lsa = 40;

    var state = {
      version: 1,
      seed: String(seed),
      difficulty: diff.id,
      shopName: opts.shopName || 'Redline Auto Service',
      day: 1,
      dow: 0,
      month: D.CONFIG.startDateMonth,
      dateDay: D.CONFIG.startDateDay,
      year: 1,

      cash: diff.cash,
      reputation: diff.repStart,
      loan: { principal: diff.loan, apr: D.CONFIG.loanInterestApr },
      credit: { balance: 0, apr: D.CONFIG.lineOfCreditApr, limit: 25000 },
      taxes: { accrued: 0, monthNet: 0, paidToDate: 0 },
      receivables: [],
      pendingBills: [],
      pendingOffers: [],

      overhead: {
        rent: Math.round(196 * diff.costMult),
        utilities: Math.round(46 * diff.costMult),
        insurance: Math.round(38 * diff.costMult),
        software: Math.round(18 * diff.costMult),
        supplies: Math.round(22 * diff.costMult)
      },

      pricing: {
        laborRate: 118,
        partsMarkup: 0.42,
        diagFee: 89,
        couponPct: 0
      },

      policy: {
        shiftHours: 8,
        openSaturday: false,
        allowOvertime: false,
        scheduling: 'balanced',   // fifo | quick | profit | balanced
        overbook: 1.0,            // 0.8 conservative .. 1.3 pack the board
        emergencyParts: true,
        autoReorder: false,
        autoReorderDays: 6
      },

      bays: [makeBay(1, bay1), makeBay(2, bay2), makeBay(3, bay3)],
      techs: [makeTech(rng, 2), makeTech(rng, 3)],
      writers: [makeWriter(rng, 2)],
      parking: { spaces: D.CONFIG.startingParkingSpaces },

      inventory: inventory,
      incomingParts: [],
      partsOrderedToday: 0,

      marketing: marketing,
      adStock: adStock,
      mailQueue: [],
      fleetAccounts: [],

      upgrades: {},          // id -> tier owned (1-based)
      customers: { retained: 240 * diff.demandMult },
      wip: [],               // repair orders carried overnight
      appointments: [],      // sold work waiting for its scheduled day
      bookedHours: {},       // absolute day -> book hours already sold
      carsOnLot: 0,

      market: {
        competitorPressure: opts.difficulty === 'hard' ? 0.18 : 0.06,
        partPrices: partPrices,
        evShare: 0.04,
        laborRate: D.CONFIG.marketLaborRate
      },

      modifiers: [],
      weather: null,
      tomorrowWeather: null,

      candidates: { techs: [], writers: [], refreshDay: 0 },
      milestones: {},
      history: [],
      log: [],
      lastReport: null,
      stats: { aro30: 0, efficiency30: 0, closeRate30: 0, carCount30: 0, gpPct30: 0 },
      gameOver: null,
      demandMult: diff.demandMult,
      costMult: diff.costMult,
      totals: { revenue: 0, profit: 0, cars: 0, ros: 0 }
    };

    state.techs.forEach(function (t) { t.signingBonus = 0; });
    state.writers.forEach(function (w) { w.signingBonus = 0; });

    var wrng = new NS.Rng(NS.hashString(String(seed)) + 101);
    state.weather = rollWeather(state, wrng);
    state.tomorrowWeather = rollWeather(state, wrng);
    refreshCandidates(state, rng);
    pushLog(state, 'Day 1. ' + state.shopName + ' opens with ' + state.bays.length +
      ' bays, ' + state.techs.length + ' techs and ' + state.writers.length + ' advisor.');
    return state;
  }

  function rollWeather(state, rng) {
    var table = D.WEATHER_TABLE[state.month];
    var ids = Object.keys(table);
    var id = rng.weighted(ids, function (k) { return table[k]; });
    return id;
  }

  function refreshCandidates(state, rng) {
    var r = rng || new NS.Rng(NS.hashString(state.seed + ':cand:' + state.day));
    var rep = state.reputation;
    // Better shops attract better applicants.
    function drawLevel() {
      var roll = r.float(0, 1) + (rep - 3) * 0.08;
      if (roll > 0.93) return 5;
      if (roll > 0.78) return 4;
      if (roll > 0.52) return 3;
      if (roll > 0.24) return 2;
      return 1;
    }
    state.candidates = {
      techs: [makeTech(r, drawLevel()), makeTech(r, drawLevel()), makeTech(r, drawLevel())],
      writers: [makeWriter(r, drawLevel()), makeWriter(r, drawLevel())],
      refreshDay: state.day
    };
  }

  function pushLog(state, text, kind) {
    state.log.unshift({ day: state.day, text: text, kind: kind || 'info' });
    if (state.log.length > 260) state.log.length = 260;
  }

  /* ------------------------------------------------------------- accessors */

  function upgradeTier(state, id) {
    return state.upgrades[id] || 0;
  }

  /** Summed numeric effect of every owned upgrade tier for a given key. */
  function upgradeEffect(state, key) {
    var total = 0;
    D.UPGRADES.forEach(function (u) {
      var tier = upgradeTier(state, u.id);
      if (!tier) return;
      var t = u.tiers[tier - 1];
      if (t && typeof t[key] === 'number') total += t[key];
    });
    return total;
  }

  function upgradeUpkeep(state) {
    return upgradeEffect(state, 'upkeep');
  }

  function inventoryValue(state) {
    var total = 0;
    D.PART_CATEGORIES.forEach(function (c) { total += state.inventory[c.id] || 0; });
    return total;
  }

  function inventoryCapacity(state) {
    return 7000 + upgradeEffect(state, 'capacity');
  }

  function equipmentValue(state) {
    var total = 0;
    state.bays.forEach(function (b) {
      D.TOOL_ORDER.forEach(function (t) {
        var lvl = b.tools[t] || 0;
        for (var i = 1; i <= lvl; i++) total += D.TOOLS[t].levels[i].cost * 0.55;
      });
    });
    D.UPGRADES.forEach(function (u) {
      var tier = upgradeTier(state, u.id);
      for (var i = 0; i < tier; i++) total += u.tiers[i].cost * 0.4;
    });
    total += state.bays.filter(function (b) { return b.active; }).length * 22000;
    total += state.parking.spaces * 1400;
    return total;
  }

  function receivablesTotal(state) {
    return state.receivables.reduce(function (a, r) { return a + r.amount; }, 0);
  }

  function activeBays(state) {
    return state.bays.filter(function (b) { return b.active && b.downDays <= 0; });
  }

  function availableTechs(state) {
    return state.techs.filter(function (t) { return t.trainingDaysLeft <= 0 && t.outDays <= 0; });
  }

  function availableWriters(state) {
    return state.writers.filter(function (w) { return w.trainingDaysLeft <= 0 && w.outDays <= 0; });
  }

  function dailyLaborCost(state) {
    var techs = state.techs.reduce(function (a, t) {
      return a + t.wage * state.policy.shiftHours;
    }, 0);
    var writers = state.writers.reduce(function (a, w) { return a + w.salary; }, 0);
    return (techs + writers) * (1 + D.CONFIG.payrollTaxRate);
  }

  function dailyOverhead(state) {
    var o = state.overhead;
    return o.rent + o.utilities + o.insurance + o.software + o.supplies + upgradeUpkeep(state);
  }

  function dailyAdSpend(state) {
    var total = 0;
    D.CHANNELS.forEach(function (c) { total += state.marketing[c.id] || 0; });
    return total;
  }

  function dailyBreakEven(state) {
    return dailyLaborCost(state) + dailyOverhead(state) + dailyAdSpend(state);
  }

  /* ------------------------------------------------------------ save / load */

  function save(state) {
    try {
      var payload = JSON.stringify(state);
      globalThis.localStorage.setItem(SAVE_KEY, payload);
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      var raw = globalThis.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var state = JSON.parse(raw);
      if (!state || state.version !== 1) return null;
      // Keep uid generation from colliding with a restored save.
      var maxId = 0;
      state.techs.concat(state.writers).forEach(function (p) {
        var n = parseInt(String(p.id).split('_')[1], 10);
        if (n > maxId) maxId = n;
      });
      uidCounter = maxId + 1;
      return state;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try { globalThis.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  NS.State = {
    SAVE_KEY: SAVE_KEY,
    XP_FOR_LEVEL: XP_FOR_LEVEL,
    levelFromXp: levelFromXp,
    xpProgress: xpProgress,
    newGame: newGame,
    makeTech: makeTech,
    makeWriter: makeWriter,
    makeBay: makeBay,
    emptyTools: emptyTools,
    refreshCandidates: refreshCandidates,
    rollWeather: rollWeather,
    pushLog: pushLog,
    upgradeTier: upgradeTier,
    upgradeEffect: upgradeEffect,
    upgradeUpkeep: upgradeUpkeep,
    inventoryValue: inventoryValue,
    inventoryCapacity: inventoryCapacity,
    equipmentValue: equipmentValue,
    receivablesTotal: receivablesTotal,
    activeBays: activeBays,
    availableTechs: availableTechs,
    availableWriters: availableWriters,
    dailyLaborCost: dailyLaborCost,
    dailyOverhead: dailyOverhead,
    dailyAdSpend: dailyAdSpend,
    dailyBreakEven: dailyBreakEven,
    save: save,
    load: load,
    clearSave: clearSave,
    uid: uid
  };
})(AutoShop);
