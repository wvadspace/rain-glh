/*
 * Everything the owner can do between days. Each action validates, mutates
 * state, and returns { ok, msg } so the UI can show one consistent toast.
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  var D = NS.DATA;
  var S = NS.State;

  function ok(msg) { return { ok: true, msg: msg }; }
  function no(msg) { return { ok: false, msg: msg }; }

  function money(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  function spend(state, amount, label) {
    if (state.cash < amount) {
      var room = state.credit.limit - state.credit.balance;
      if (state.cash + room < amount) {
        return false;
      }
      var draw = amount - state.cash;
      state.credit.balance += draw;
      state.cash += draw;
      S.pushLog(state, 'Drew ' + money(draw) + ' on the credit line for ' + label + '.', 'warn');
    }
    state.cash -= amount;
    return true;
  }

  /* ---------------------------------------------------------------- pricing */

  function setLaborRate(state, v) {
    state.pricing.laborRate = Math.round(NS.Sim.clamp(v, D.CONFIG.laborRateMin, D.CONFIG.laborRateMax));
    return ok('Labor rate set to $' + state.pricing.laborRate + '/hr.');
  }

  function setPartsMarkup(state, v) {
    state.pricing.partsMarkup = NS.Sim.clamp(v, D.CONFIG.partsMarkupMin, D.CONFIG.partsMarkupMax);
    return ok('Parts markup set to ' + Math.round(state.pricing.partsMarkup * 100) + '%.');
  }

  function setDiagFee(state, v) {
    state.pricing.diagFee = Math.round(NS.Sim.clamp(v, D.CONFIG.diagFeeMin, D.CONFIG.diagFeeMax));
    return ok('Diagnostic fee set to $' + state.pricing.diagFee + '.');
  }

  function setCoupon(state, v) {
    state.pricing.couponPct = NS.Sim.clamp(v, 0, 0.35);
    return ok('Standing discount set to ' + Math.round(state.pricing.couponPct * 100) + '%.');
  }

  function setPolicy(state, key, value) {
    state.policy[key] = value;
    return ok('Policy updated.');
  }

  /* -------------------------------------------------------------- marketing */

  function setChannelSpend(state, channelId, amount) {
    var ch = D.CHANNELS_BY_ID[channelId];
    if (!ch) return no('Unknown channel.');
    state.marketing[channelId] = Math.max(0, Math.round(amount));
    return ok(ch.name + ' set to ' + money(state.marketing[channelId]) + '/day.');
  }

  /* ------------------------------------------------------------------ parts */

  function bulkDiscount(total) {
    for (var i = 0; i < D.BULK_TIERS.length; i++) {
      if (total >= D.BULK_TIERS[i].min) return D.BULK_TIERS[i];
    }
    return D.BULK_TIERS[D.BULK_TIERS.length - 1];
  }

  /** orders: { categoryId: dollarsOfInventory } */
  function orderParts(state, orders) {
    var total = 0;
    for (var k in orders) {
      var amt = Math.max(0, Math.round(orders[k] || 0));
      if (amt > 0) total += amt;
    }
    if (total <= 0) return no('Nothing on the order.');

    var incoming = state.incomingParts.reduce(function (a, p) { return a + p.amount; }, 0);
    var cap = S.inventoryCapacity(state);
    if (S.inventoryValue(state) + incoming + total > cap) {
      return no('Parts room only holds ' + money(cap) + '. Clear space or upgrade the stock room.');
    }

    var tier = bulkDiscount(total);
    var discount = tier.discount + S.upgradeEffect(state, 'partsDiscount');
    var cost = total * (1 - discount);
    if (!spend(state, cost, 'a parts order')) {
      return no('Not enough cash or credit for a ' + money(cost) + ' order.');
    }

    for (var cat in orders) {
      var a = Math.max(0, Math.round(orders[cat] || 0));
      if (a > 0) {
        state.incomingParts.push({ day: state.day + D.CONFIG.partsLeadTimeDays, cat: cat, amount: a });
      }
    }
    state.partsOrderedToday += total;
    S.pushLog(state, 'Ordered ' + money(total) + ' in parts for ' + money(cost) +
      ' (' + tier.label + '). Arrives tomorrow morning.');
    return ok('Ordered ' + money(total) + ' in parts for ' + money(cost) + ' (' + tier.label + ').');
  }

  /** Fill every category up to N days of forecast supply. */
  function autoStock(state, days) {
    var usage = NS.Sim.partsUsageForecast(state);
    var orders = {};
    D.PART_CATEGORIES.forEach(function (c) {
      var target = usage[c.id].burn * days;
      var have = state.inventory[c.id] || 0;
      var incoming = state.incomingParts.reduce(function (a, p) {
        return a + (p.cat === c.id ? p.amount : 0);
      }, 0);
      var need = target - have - incoming;
      if (need > 25) orders[c.id] = Math.round(need);
    });
    if (!Object.keys(orders).length) return no('Stock levels already cover ' + days + ' days.');
    return orderParts(state, orders);
  }

  /* ----------------------------------------------------------------- tools */

  function upgradeTool(state, bayId, toolId) {
    var bay = state.bays.filter(function (b) { return b.id === bayId; })[0];
    if (!bay) return no('No such bay.');
    var tool = D.TOOLS[toolId];
    var current = bay.tools[toolId] || 0;
    if (current >= tool.levels.length - 1) return no(tool.name + ' is already maxed in ' + bay.name + '.');
    var next = tool.levels[current + 1];
    if (!spend(state, next.cost, tool.name)) return no('Need ' + money(next.cost) + '.');
    bay.tools[toolId] = current + 1;
    S.pushLog(state, bay.name + ': installed ' + next.label + ' (' + money(next.cost) + ').');
    return ok(bay.name + ': ' + next.label + ' installed.');
  }

  function repairBay(state, bayId) {
    var bay = state.bays.filter(function (b) { return b.id === bayId; })[0];
    if (!bay || bay.downDays <= 0) return no('Nothing to repair.');
    var cost = 450 * bay.downDays;
    if (!spend(state, cost, 'an emergency repair')) return no('Need ' + money(cost) + '.');
    bay.downDays = 0;
    return ok(bay.name + ' back online for ' + money(cost) + '.');
  }

  function buildBay(state) {
    var cost = Math.round(D.CONFIG.bayBuildCost * (1 + state.bays.length * 0.06));
    if (!spend(state, cost, 'a new bay')) return no('A new bay costs ' + money(cost) + '.');
    var bay = S.makeBay(state.bays.length + 1, S.emptyTools());
    state.bays.push(bay);
    state.overhead.rent += 44;
    state.overhead.utilities += 9;
    S.pushLog(state, 'Built ' + bay.name + ' for ' + money(cost) + '. Rent went up.', 'good');
    return ok(bay.name + ' is framed and poured. It has no tools in it yet.');
  }

  function toggleBay(state, bayId) {
    var bay = state.bays.filter(function (b) { return b.id === bayId; })[0];
    if (!bay) return no('No such bay.');
    bay.active = !bay.active;
    return ok(bay.name + ' is now ' + (bay.active ? 'open' : 'mothballed') + '.');
  }

  function addParking(state, spaces) {
    spaces = Math.max(1, Math.round(spaces || 1));
    var cost = spaces * D.CONFIG.parkingSpaceCost;
    if (!spend(state, cost, 'parking')) return no('Need ' + money(cost) + '.');
    state.parking.spaces += spaces;
    state.overhead.rent += spaces * 3;
    return ok('Paved ' + spaces + ' more space(s). Lot holds ' + state.parking.spaces + '.');
  }

  /* -------------------------------------------------------------- upgrades */

  function buyUpgrade(state, id) {
    var up = D.UPGRADES_BY_ID[id];
    if (!up) return no('Unknown upgrade.');
    var tier = S.upgradeTier(state, id);
    if (tier >= up.tiers.length) return no(up.name + ' is fully upgraded.');
    var t = up.tiers[tier];
    if (!spend(state, t.cost, up.name)) return no('Need ' + money(t.cost) + '.');
    state.upgrades[id] = tier + 1;
    S.pushLog(state, 'Installed ' + up.name + ': ' + t.label + ' (' + money(t.cost) + ').', 'good');
    return ok(up.name + ' - ' + t.label + ' is live.');
  }

  /* ----------------------------------------------------------------- staff */

  function hire(state, kind, candidateId) {
    var pool = kind === 'tech' ? state.candidates.techs : state.candidates.writers;
    var idx = -1;
    pool.forEach(function (c, i) { if (c.id === candidateId) idx = i; });
    if (idx < 0) return no('That applicant already took another job.');
    var person = pool[idx];
    var upfront = person.signingBonus + (kind === 'tech' ? 400 : 300); // bonus + onboarding
    if (!spend(state, upfront, 'hiring')) return no('Hiring costs ' + money(upfront) + ' up front.');
    person.hiredDay = state.day;
    if (kind === 'tech') {
      state.techs.push(person);
    } else {
      state.writers.push(person);
    }
    pool.splice(idx, 1);
    S.pushLog(state, 'Hired ' + person.name + ' (' +
      (kind === 'tech' ? D.TECH_TITLES[person.level - 1] : 'Level ' + person.level + ' advisor') +
      ').', 'good');
    return ok('Hired ' + person.name + '.');
  }

  function fire(state, kind, personId) {
    var list = kind === 'tech' ? state.techs : state.writers;
    var idx = -1;
    list.forEach(function (p, i) { if (p.id === personId) idx = i; });
    if (idx < 0) return no('Not on the payroll.');
    var person = list[idx];
    var severance = kind === 'tech' ? person.wage * 40 : person.salary * 5;
    if (!spend(state, severance, 'severance')) return no('Severance is ' + money(severance) + '.');
    list.splice(idx, 1);
    // The crew notices.
    state.techs.forEach(function (t) { t.morale = Math.max(0.05, t.morale - 0.05); });
    S.pushLog(state, 'Let ' + person.name + ' go. Severance ' + money(severance) + '.', 'warn');
    return ok(person.name + ' is off the payroll.');
  }

  function raise(state, kind, personId, amount) {
    var list = kind === 'tech' ? state.techs : state.writers;
    var person = list.filter(function (p) { return p.id === personId; })[0];
    if (!person) return no('Not on the payroll.');
    if (kind === 'tech') {
      person.wage = Math.round((person.wage + amount) * 100) / 100;
    } else {
      person.salary = Math.round(person.salary + amount);
    }
    person.morale = NS.Sim.clamp(person.morale + 0.14, 0, 1);
    return ok(person.name + ' got a raise. Morale is up.');
  }

  function startTraining(state, kind, personId, courseId) {
    var list = kind === 'tech' ? state.techs : state.writers;
    var catalog = kind === 'tech' ? D.TECH_TRAINING : D.WRITER_TRAINING;
    var person = list.filter(function (p) { return p.id === personId; })[0];
    var course = catalog.filter(function (c) { return c.id === courseId; })[0];
    if (!person || !course) return no('Unknown course or employee.');
    if (person.trainingDaysLeft > 0) return no(person.name + ' is already in a class.');
    if (person.courses.indexOf(courseId) >= 0) return no(person.name + ' already holds that certification.');
    if (course.minLevel && person.level < course.minLevel) {
      return no(course.name + ' needs a level ' + course.minLevel + ' employee.');
    }
    if (course.requiresTool) {
      var okTool = false;
      for (var t in course.requiresTool) {
        okTool = state.bays.some(function (b) { return (b.tools[t] || 0) >= course.requiresTool[t]; });
      }
      if (!okTool) return no(course.name + ' requires better equipment in the shop first.');
    }
    if (course.requiresUpgrade && !S.upgradeTier(state, course.requiresUpgrade)) {
      return no(course.name + ' requires the ' +
        D.UPGRADES_BY_ID[course.requiresUpgrade].name + ' first.');
    }
    var cost = Math.round(course.cost * (1 - S.upgradeEffect(state, 'trainingDiscount')));
    if (!spend(state, cost, 'training')) return no('That course costs ' + money(cost) + '.');
    person.trainingId = courseId;
    person.trainingDaysLeft = course.days;
    S.pushLog(state, person.name + ' enrolled in ' + course.name + ' (' + course.days +
      ' day(s), ' + money(cost) + ').');
    return ok(person.name + ' starts ' + course.name + ' tomorrow. Out ' + course.days + ' day(s).');
  }

  function recruit(state) {
    var fee = 900;
    if (!spend(state, fee, 'a recruiter')) return no('The recruiter wants ' + money(fee) + '.');
    S.refreshCandidates(state);
    return ok('New applicants on the board.');
  }

  /* ------------------------------------------------------------------ money */

  function borrow(state, amount) {
    amount = Math.max(0, Math.round(amount));
    var maxLoan = Math.max(0, NS.Sim.netWorth(state) * 0.6 + 30000 - state.loan.principal);
    if (amount > maxLoan) {
      return no('The bank will lend at most ' + money(maxLoan) + ' against this business.');
    }
    state.loan.principal += amount;
    state.cash += amount;
    S.pushLog(state, 'Borrowed ' + money(amount) + ' at ' +
      Math.round(state.loan.apr * 1000) / 10 + '% APR.');
    return ok('Borrowed ' + money(amount) + '.');
  }

  function repayLoan(state, amount) {
    amount = Math.min(Math.max(0, Math.round(amount)), state.loan.principal, state.cash);
    if (amount <= 0) return no('Nothing to pay, or no cash to pay it with.');
    state.loan.principal -= amount;
    state.cash -= amount;
    return ok('Paid ' + money(amount) + ' against the note.');
  }

  function repayCredit(state, amount) {
    amount = Math.min(Math.max(0, Math.round(amount)), state.credit.balance, state.cash);
    if (amount <= 0) return no('Nothing to pay, or no cash to pay it with.');
    state.credit.balance -= amount;
    state.cash -= amount;
    return ok('Paid ' + money(amount) + ' on the line of credit.');
  }

  /* ----------------------------------------------------------------- offers */

  function resolveOffer(state, offerId, accept) {
    var idx = -1;
    state.pendingOffers.forEach(function (o, i) { if (o.id === offerId) idx = i; });
    if (idx < 0) return no('That offer expired.');
    var offer = state.pendingOffers.splice(idx, 1)[0];
    if (!accept) {
      if (offer.type === 'retain') {
        var t = state.techs.filter(function (x) { return x.id === offer.techId; })[0];
        if (t) {
          state.techs = state.techs.filter(function (x) { return x.id !== offer.techId; });
          S.pushLog(state, t.name + ' took the dealership job.', 'bad');
          return ok(t.name + ' left for the dealership.');
        }
      }
      return ok('Passed on it.');
    }
    if (offer.type === 'fleet') {
      state.fleetAccounts.push({
        id: offer.id, name: offer.label, vehicles: offer.vehicles,
        discount: offer.discount, jobsPerDay: offer.vehicles * 0.055, signedDay: state.day
      });
      S.pushLog(state, 'Signed ' + offer.label + '.', 'good');
      return ok('Signed ' + offer.label + '.');
    }
    if (offer.type === 'retain') {
      var tech = state.techs.filter(function (x) { return x.id === offer.techId; })[0];
      if (!tech) return no('They already left.');
      tech.wage += offer.raise;
      tech.morale = NS.Sim.clamp(tech.morale + 0.25, 0, 1);
      return ok(tech.name + ' is staying at $' + tech.wage.toFixed(2) + '/hr.');
    }
    return ok('Done.');
  }

  NS.Actions = {
    money: money,
    setLaborRate: setLaborRate,
    setPartsMarkup: setPartsMarkup,
    setDiagFee: setDiagFee,
    setCoupon: setCoupon,
    setPolicy: setPolicy,
    setChannelSpend: setChannelSpend,
    bulkDiscount: bulkDiscount,
    orderParts: orderParts,
    autoStock: autoStock,
    upgradeTool: upgradeTool,
    repairBay: repairBay,
    buildBay: buildBay,
    toggleBay: toggleBay,
    addParking: addParking,
    buyUpgrade: buyUpgrade,
    hire: hire,
    fire: fire,
    raise: raise,
    startTraining: startTraining,
    recruit: recruit,
    borrow: borrow,
    repayLoan: repayLoan,
    repayCredit: repayCredit,
    resolveOffer: resolveOffer
  };
})(AutoShop);
