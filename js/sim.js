/* ==========================================================================
   sim.js — the day simulation.

   One "day" runs hour by hour. Cars arrive from organic traffic and from
   each advertising channel, get written up by an advisor (or turned away
   because the lot is full or the counter is buried), get closed or lost on
   price, then get dispatched to a station (a bay paired with a technician)
   that has both the equipment and the skill to do the work.
   ========================================================================== */
(function (root) {
  'use strict';
  var AS = root.AS = root.AS || {};
  var C = AS.CONFIG;

  /* ---------- seeded RNG so a day is reproducible ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function poisson(rand, lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) { // normal approximation
      var u1 = Math.max(1e-9, rand()), u2 = rand();
      var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }

  function pick(rand, list, weightFn) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += Math.max(0, weightFn(list[i]));
    if (total <= 0) return null;
    var r = rand() * total;
    for (i = 0; i < list.length; i++) {
      r -= Math.max(0, weightFn(list[i]));
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- weather ---------- */
  function rollWeather(rand, month) {
    var pool = AS.WEATHER.filter(function (w) { return !w.season || w.season.indexOf(month) >= 0; });
    return pick(rand, pool, function (w) { return w.w; });
  }

  /* ---------- stations: pair the best techs with the best bays ---------- */
  AS.buildStations = function (s, openHours) {
    var bays = s.bays.filter(function (b) { return !b.down; })
      .slice().sort(function (a, b) { return b.lvl - a.lvl; });
    var techs = s.techs.filter(function (t) { return t.training <= 0; })
      .slice().sort(function (a, b) { return b.lvl - a.lvl; });

    var stations = [], n = Math.min(bays.length, techs.length);
    for (var i = 0; i < n; i++) {
      var bay = bays[i], tech = techs[i];
      var tl = AS.techLevel(tech), eq = AS.equip(bay);
      var fatigue = 1 - clamp(tech.fatigue, 0, 40) / 240;      // tired techs slow down
      var morale = 0.9 + clamp(tech.morale, 0, 100) / 500;      // 0.9 .. 1.1
      stations.push({
        bay: bay, tech: tech,
        equip: bay.lvl, skill: tech.lvl,
        eff: tl.eff * eq.eff * fatigue * morale,
        comeback: tl.comeback,
        capacity: openHours, used: 0, billed: 0, jobs: 0
      });
    }
    return {
      stations: stations,
      idleBays: Math.max(0, bays.length - n),
      idleTechs: Math.max(0, techs.length - n)
    };
  };

  /* Cheapest station that can legally do the job and still has clock left. */
  function dispatch(stations, job, minShare) {
    var best = null, bestScore = 1e9;
    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];
      if (st.equip < job.equip || st.skill < job.skill) continue;
      var left = st.capacity - st.used;
      var need = job.hours / st.eff;
      if (left < Math.min(need * minShare, 0.5)) continue;
      // prefer the least over-qualified station with the most room
      var score = (st.equip - job.equip) * 2 + (st.skill - job.skill) * 2 - left * 0.35;
      if (score < bestScore) { bestScore = score; best = st; }
    }
    return best;
  }

  /* ---------- traffic ---------- */
  AS.computeTraffic = function (s, weather) {
    var loc = AS.location(s);
    var week = AS.WEEK[s.dow];
    var repMult = 0.55 + (s.reputation / 100) * 0.95;                 // 0.55 .. 1.50
    var season = AS.SEASON_TRAFFIC[s.month];
    var modTraffic = AS.modifier(s, 'traffic');

    // Price posture: a shop well above town rate loses walk-in interest.
    var priceIdx = C.marketLaborRate / Math.max(40, s.pricing.laborRate);
    var priceMult = clamp(Math.pow(priceIdx, 0.45), 0.72, 1.24);

    var organic = loc.base * repMult * season * week.traffic * weather.traffic * modTraffic * priceMult;

    // Repeat customers coming back on their own service interval.
    var retention = C.baseVisitRate + (s.channels.loyalty.stock > 0 ? AS.CHANNEL_BY_ID.loyalty.retention * Math.min(3, s.channels.loyalty.stock) : 0);
    var repeat = s.customerBase * retention * week.traffic * season * modTraffic;

    var sources = [{ id: 'organic', leads: organic, quality: 1.0, coupon: 0, mix: null },
                   { id: 'repeat',  leads: repeat,  quality: 1.28, coupon: 0, mix: null }];

    AS.CHANNELS.forEach(function (ch) {
      var st = s.channels[ch.id];
      var leads = st.stock * ch.pull * week.traffic * weather.traffic * modTraffic;
      if (leads > 0.01) sources.push({ id: ch.id, leads: leads, quality: ch.quality, coupon: ch.coupon || 0, mix: ch.mix });
    });
    return sources;
  };

  /* Advance each channel's awareness stock by today's spend. */
  function advanceChannels(s) {
    var spent = 0;
    AS.CHANNELS.forEach(function (ch) {
      var st = s.channels[ch.id];
      var spend = Math.max(0, s.adSpend[ch.id] || 0);
      st.spend = spend; spent += spend;
      var impulse = spend > 0 ? Math.pow(spend / ch.scale, 0.62) : 0;
      st.stock = st.stock * ch.decay + impulse;
      st.leads = 0;
    });
    return spent;
  }

  /* ---------- job selection ---------- */
  function jobWeight(s, job, month, weather, mix) {
    var w = job.weight;
    if (job.season && job.season[month] != null) w *= job.season[month];
    if (weather.bias && weather.bias[job.cat]) w *= weather.bias[job.cat];
    if (mix) w *= (job.cat === 'Maintenance' ? (mix.maint || 1) : (mix.repair || 1));
    return w;
  }

  /* ---------- the day ---------- */
  AS.runDay = function (s) {
    var rand = mulberry32((s.seed + s.day * 7919) | 0);
    var week = AS.WEEK[s.dow];
    var openHours = week.hours;
    var day = {
      day: s.day, dow: s.dow, month: s.month, year: s.year,
      weather: null, hourly: [], log: [],
      cars: 0, ros: 0, quoted: 0, closed: 0, lost: 0, turnedAway: 0, balked: 0,
      declined: 0, declinedValue: 0, declinedNeed: {},
      upsells: 0, comebacks: 0, carryover: 0, booked: 0, stockouts: 0,
      revLabor: 0, revParts: 0, revSupplies: 0, discounts: 0,
      partsCost: 0, billedHours: 0, clockHours: 0, capacityHours: 0,
      bySource: {}, byJob: {}, byAdvisor: {}, byStation: []
    };

    /* Sunday / closed day: pay the bills, restock, go home. */
    if (!week.open) {
      day.isClosed = true;
      var ohC = AS.dailyOverhead(s);
      var adC = advanceChannels(s);
      day.overhead = ohC.total; day.payroll = 0; day.adSpend = adC;
      day.expenses = ohC.total + adC;
      day.net = -day.expenses;
      s.cash -= day.expenses;
      s.stats.lifetimeAdSpend += adC;
      day.log.push({ h: null, type: 'info', text: 'Closed Sunday. Overhead and advertising still ran: ' + AS.money(day.expenses) + '.' });
      s.techs.forEach(function (t) { t.fatigue = Math.max(0, t.fatigue - 14); t.morale = clamp(t.morale + 3, 0, 100); });
      finishDay(s, day, rand);
      return day;
    }

    var weather = rollWeather(rand, s.month);
    day.weather = weather;

    /* ----- capacity ----- */
    var built = AS.buildStations(s, openHours);
    var stations = built.stations;
    var capMod = AS.modifier(s, 'capacity');
    stations.forEach(function (st) { st.capacity *= capMod; });
    day.capacityHours = stations.reduce(function (n, st) { return n + st.capacity * st.eff; }, 0);
    day.idleBays = built.idleBays; day.idleTechs = built.idleTechs;

    if (!stations.length) {
      day.log.push({ h: null, type: 'bad', text: 'No station could open — you need at least one working bay AND one available technician.' });
    }

    /* ----- the parking lot, tracked hour by hour -----
       A car holds a space from the moment it lands until the tech hands the
       keys back. When the bays fall behind, the lot fills and you physically
       cannot take the next car. */
    var lot = [];
    for (var li = 0; li <= openHours + 1; li++) lot.push(0);
    function occupy(from, to) {
      var a = Math.max(0, Math.floor(from)), b = Math.min(lot.length - 1, Math.ceil(to));
      for (var t = a; t <= b; t++) lot[t]++;
    }

    /* ----- overnight work in process gets the first bite of the clock ----- */
    var finishedToday = [];
    s.wip.forEach(function (w) {
      var job = AS.JOB_BY_ID[w.jobId];
      var st = dispatch(stations, job, 0.15);
      if (!st) { occupy(0, openHours); day.carryover++; return; }
      var need = w.remaining;
      var spend = Math.min(need, st.capacity - st.used);
      st.used += spend; w.remaining -= spend;
      if (w.remaining <= 0.001) {
        finishedToday.push(w);
        occupy(0, st.used);
        day.log.push({ h: 1, type: 'good', text: 'Finished carryover: ' + job.name + ' for ' + w.customer + '.' });
      } else {
        occupy(0, openHours);
        day.carryover++;
      }
    });
    s.wip = s.wip.filter(function (w) { return finishedToday.indexOf(w) < 0; });

    /* ----- comebacks: yesterday's mistakes eat today's hours for free ----- */
    (s.comebackQueue || []).forEach(function (cb) {
      var job = AS.JOB_BY_ID[cb.jobId];
      var st = dispatch(stations, job, 0.1);
      var hrs = job.hours * 0.5;
      if (st) {
        st.used += hrs / st.eff;
        day.comebacks++;
        day.log.push({ h: 1, type: 'bad', text: 'Comeback: ' + cb.customer + ' brought the ' + job.name + ' back. ' + hrs.toFixed(1) + ' hours redone at no charge.' });
      }
    });
    s.comebackQueue = [];

    /* ----- yesterday's appointments are on the schedule -----
       A customer will wait a couple of days for you. After that they go
       somewhere else, and the schedule cannot silently pile up forever. */
    var scheduled = [];
    s.booked.forEach(function (a) {
      a.age = (a.age || 0) + 1;
      if (a.age > C.appointmentPatience) {
        day.cancellations = (day.cancellations || 0) + 1;
        day.lost++;
        return;
      }
      scheduled.push(a);
    });
    s.booked = [];
    if (day.cancellations) {
      day.log.push({ h: null, type: 'bad', text: day.cancellations + ' customer' + (day.cancellations > 1 ? 's' : '') + ' who had been waiting on you cancelled and went elsewhere.' });
    }

    /* ----- traffic for the day ----- */
    var sources = AS.computeTraffic(s, weather);
    var totalLeads = sources.reduce(function (n, x) { return n + x.leads; }, 0);
    day.leads = totalLeads;
    sources.forEach(function (src) { day.bySource[src.id] = { leads: 0, ros: 0, revenue: 0, gp: 0, spend: s.adSpend[src.id] || 0 }; });

    /* arrival curve across the open hours */
    var curve = [];
    for (var h = 0; h < openHours; h++) {
      var x = h / Math.max(1, openHours - 1);
      curve.push(0.75 + 0.9 * Math.exp(-Math.pow((x - 0.15) * 2.4, 2)) + 0.55 * Math.exp(-Math.pow((x - 0.72) * 2.6, 2)));
    }
    var curveSum = curve.reduce(function (a, b) { return a + b; }, 0);

    var advisors = s.advisors.filter(function (a) { return a.training <= 0; });
    var advState = advisors.map(function (a) {
      var lv = AS.advisorLevel(a);
      return { adv: a, lv: lv, cap: Math.round(lv.roCap * (openHours / 9) * (0.9 + a.morale / 500)), used: 0, ros: 0, sold: 0, quoted: 0, ups: 0 };
    });
    advState.forEach(function (a) { day.byAdvisor[a.adv.id] = a; });

    var strategy = AS.partsStrategy(s);
    var partsCostMult = AS.modifier(s, 'partsCost');
    var repFactor = 0.68 + (s.reputation / 100) * 0.52;
    var waitPenalty = 0;

    function priceCompare(job, q) {
      var market = AS.marketQuote(s, job);
      return market / Math.max(1, q.total);
    }

    function writeUp(hour, src, job, advisorSlot, isAppointment) {
      day.cars++;
      var q = AS.quote(s, job, { coupon: src.coupon, partsCostMult: partsCostMult });
      day.quoted += q.total;
      advisorSlot.quoted += q.total;

      var value = priceCompare(job, q);
      var closeP = advisorSlot.lv.close
        * Math.pow(clamp(value, 0.45, 1.9), job.sens * 0.85)
        * repFactor * src.quality
        * (1 + job.urg * 0.22)
        * (isAppointment ? 1.12 : 1)
        * (1 - waitPenalty);
      closeP = clamp(closeP, 0.03, 0.97);

      if (rand() > closeP) {
        day.lost++;
        if (value < 0.92) day.lostOnPrice = (day.lostOnPrice || 0) + 1;
        day.log.push({ h: hour, type: 'warn', text: 'Lost estimate: ' + job.name + ' at ' + AS.money(q.total) + (value < 0.9 ? ' — customer said the shop down the road is cheaper.' : ' — customer wants to think about it.') });
        return null;
      }

      var ro = { customer: AS.randomName(), jobs: [], source: src.id, advisor: advisorSlot.adv.id, hour: hour };
      ro.jobs.push({ job: job, q: q });

      /* Upsell: the tech finds it, the advisor sells it. */
      if (job.upsells && job.upsells.length) {
        var upChance = advisorSlot.lv.upsell * (0.75 + (stations.length ? stations[0].skill : 1) * 0.06) * repFactor;
        if (rand() < upChance) {
          var addId = job.upsells[(rand() * job.upsells.length) | 0];
          var add = AS.JOB_BY_ID[addId];
          if (add) {
            var aq = AS.quote(s, add, { coupon: src.coupon, partsCostMult: partsCostMult });
            var acc = clamp(0.62 * Math.pow(clamp(priceCompare(add, aq), 0.5, 1.8), 0.9) * repFactor, 0.05, 0.95);
            day.quoted += aq.total;
            advisorSlot.quoted += aq.total;
            if (rand() < acc) {
              ro.jobs.push({ job: add, q: aq });
              day.upsells++; advisorSlot.ups++;
              day.log.push({ h: hour, type: 'good', text: advisorSlot.adv.name + ' sold an add-on: ' + add.name + ' (+' + AS.money(aq.total) + ').' });
            }
          }
        }
      }
      return ro;
    }

    function startJob(hour, ro, entry) {
      var job = entry.job, q = entry.q;

      /* Parts on the shelf? If not, the counter can still get them from the
         supplier today — at a rush premium. Only when there is neither stock
         nor cash does the job actually slip a day. */
      if (q.partsCost > s.partsStock) {
        var short = q.partsCost - s.partsStock;
        var rush = short * C.rushPremium;
        if (s.cash - (short + rush) > -AS.creditLimit(s)) {
          s.cash -= (short + rush);
          s.partsStock += short;
          day.rushParts = (day.rushParts || 0) + short;
          day.rushFees = (day.rushFees || 0) + rush;
        } else {
          day.stockouts++;
          if (rand() < (job.urg < 0.5 ? 0.45 : 0.18)) {
            day.lost++;
            day.log.push({ h: hour, type: 'bad', text: 'Could not get parts for ' + job.name + ' and the customer would not wait. Sale lost.' });
            return false;
          }
          s.booked.push({ jobId: job.id, customer: ro.customer, source: ro.source, advisor: ro.advisor, reason: 'parts', age: 0 });
          day.booked++;
          day.log.push({ h: hour, type: 'warn', text: 'No parts and no money to buy them. ' + job.name + ' pushed to tomorrow.' });
          return true;
        }
      }

      var st = dispatch(stations, job, 0.25);
      if (!st) {
        occupy(hour, hour);
        // no capable clock left today — book it or lose it
        var willWait = rand() < (0.78 - job.urg * 0.25);
        var capable = stations.some(function (x) { return x.equip >= job.equip && x.skill >= job.skill; });
        if (!capable) {
          day.lost++;
          day.log.push({ h: hour, type: 'bad', text: 'Turned down ' + job.name + ' — no bay with the equipment and no tech with the ticket to do it.' });
          return false;
        }
        if (willWait) {
          s.booked.push({ jobId: job.id, customer: ro.customer, source: ro.source, advisor: ro.advisor, reason: 'capacity', age: 0 });
          day.booked++;
          day.log.push({ h: hour, type: 'info', text: 'Booked ' + ro.customer + ' for tomorrow — every bay is buried.' });
        } else {
          day.lost++;
          day.log.push({ h: hour, type: 'warn', text: ro.customer + ' would not wait for an opening and went elsewhere.' });
        }
        return true;
      }

      /* consume parts, run the clock */
      s.partsStock -= q.partsCost;
      day.partsCost += q.partsCost;
      var need = job.hours / st.eff;
      var left = st.capacity - st.used;
      var spend = Math.min(need, left);
      st.used += spend; st.jobs++;
      day.clockHours += spend;

      occupy(hour, finished_estimate(hour, st));
      var finished = spend >= need - 0.001;
      if (finished) {
        recognize(ro, entry, st, hour);
        // comeback risk
        var cbP = job.diff * st.comeback * 3.1 * (1 - clamp(st.tech.morale, 0, 100) / 400);
        if (rand() < cbP) {
          s.comebackQueue = s.comebackQueue || [];
          s.comebackQueue.push({ jobId: job.id, customer: ro.customer });
          st.tech.comebacks++;
        }
      } else {
        s.wip.push({
          jobId: job.id, customer: ro.customer, remaining: need - spend,
          q: q, source: ro.source, advisor: ro.advisor, stationSkill: st.skill
        });
        day.carryover++;
        day.log.push({ h: hour, type: 'info', text: job.name + ' for ' + ro.customer + ' will finish tomorrow. Car stays on the lot overnight.' });
      }
      return true;
    }

    /* When will this car be ready? The bay's cumulative clock says so. */
    function finished_estimate(hour, st) {
      return Math.min(openHours, Math.max(hour, st.used));
    }

    function recognize(ro, entry, st, hour) {
      var q = entry.q, job = entry.job;
      day.revLabor += q.labor; day.revParts += q.parts;
      day.revSupplies += q.supplies; day.discounts += q.discount;
      day.billedHours += job.hours;
      st.billed += job.hours;
      st.tech.lifetimeBilled += job.hours;
      st.bay.lifetimeHours += job.hours;
      day.byJob[job.id] = day.byJob[job.id] || { count: 0, revenue: 0, hours: 0 };
      day.byJob[job.id].count++;
      day.byJob[job.id].revenue += q.total;
      day.byJob[job.id].hours += job.hours;
      var bs = day.bySource[ro.source] || (day.bySource[ro.source] = { leads: 0, ros: 0, revenue: 0, gp: 0, spend: 0 });
      bs.revenue += q.total;
      bs.gp += q.total - q.partsCost;
    }

    /* ---- appointments first thing in the morning ---- */
    scheduled.forEach(function (appt) {
      var job = AS.JOB_BY_ID[appt.jobId];
      if (!job) return;
      if (lot[0] >= s.spaces) { day.turnedAway++; return; }
      var slot = advState.filter(function (a) { return a.used < a.cap; })[0];
      if (!slot) { s.booked.push(appt); day.deferred = (day.deferred || 0) + 1; return; }
      slot.used++; slot.ros++; day.ros++;
      var q = AS.quote(s, job, { partsCostMult: partsCostMult });
      var ro = { customer: appt.customer, jobs: [{ job: job, q: q }], source: appt.source, advisor: slot.adv.id, hour: 0 };
      day.cars++;
      day.bySource[appt.source] = day.bySource[appt.source] || { leads: 0, ros: 0, revenue: 0, gp: 0, spend: 0 };
      day.bySource[appt.source].ros++;
      day.closed++;
      startJob(0, ro, ro.jobs[0]);
    });

    /* ---- the walk-in day, hour by hour ---- */
    for (var hr = 0; hr < openHours; hr++) {
      var lambda = totalLeads * (curve[hr] / curveSum);
      var arrivals = poisson(rand, lambda);
      var hourRec = { hour: hr, arrivals: arrivals, ros: 0, revenue: 0 };

      for (var k = 0; k < arrivals; k++) {
        var src = pick(rand, sources, function (x) { return x.leads; }) || sources[0];
        day.bySource[src.id].leads++;
        s.channels[src.id] && (s.channels[src.id].leads++);

        if (lot[hr] >= s.spaces) {
          day.turnedAway++;
          if (day.turnedAway <= 3) {
            day.log.push({ h: hr, type: 'bad', text: 'Lot is full — turned a car away. Nowhere to park it.' });
          }
          continue;
        }

        var slot2 = null, minLoad = 1e9;
        advState.forEach(function (a) {
          if (a.used < a.cap && a.used < minLoad) { minLoad = a.used; slot2 = a; }
        });
        if (!slot2) {
          day.balked++;
          waitPenalty = Math.min(0.35, waitPenalty + 0.02);
          if (day.balked <= 2) {
            day.log.push({ h: hr, type: 'warn', text: 'Nobody at the counter — a customer waited, then left. Your advisors are maxed out.' });
          }
          continue;
        }

        var job2 = pick(rand, AS.JOBS, function (j) { return jobWeight(s, j, s.month, weather, src.mix); });
        if (!job2) continue;

        /* Work you simply cannot perform: no bay with the tooling, or no
           tech with the ticket. Track it — this is your upgrade shopping list. */
        var capable = stations.some(function (x) { return x.equip >= job2.equip && x.skill >= job2.skill; });
        if (!capable) {
          var dq = AS.quote(s, job2, { partsCostMult: partsCostMult });
          day.declined++;
          day.declinedValue += dq.total;
          var needKey = (!stations.some(function (x) { return x.equip >= job2.equip; }) ? 'equip' : 'skill') + job2[!stations.some(function (x) { return x.equip >= job2.equip; }) ? 'equip' : 'skill'];
          day.declinedNeed[needKey] = (day.declinedNeed[needKey] || 0) + 1;
          if (day.declined <= 3) {
            day.log.push({ h: hr, type: 'warn', text: 'Referred out ' + job2.name + ' (' + AS.money(dq.total) + ') — ' + (needKey.indexOf('equip') === 0 ? 'no bay equipped for it.' : 'no technician qualified for it.') });
          }
          continue;
        }

        slot2.used++;
        var ro2 = writeUp(hr, src, job2, slot2, false);
        if (!ro2) { occupy(hr, hr); continue; }

        slot2.ros++; day.ros++; day.closed++;
        day.bySource[src.id].ros++;
        hourRec.ros++;

        var ok = true;
        for (var ji = 0; ji < ro2.jobs.length; ji++) {
          ok = startJob(hr, ro2, ro2.jobs[ji]) && ok;
        }
        ro2.jobs.forEach(function (e) { hourRec.revenue += e.q.total; });
        slot2.sold += ro2.jobs.reduce(function (n, e) { return n + e.q.total; }, 0);
      }
      hourRec.lot = lot[hr];
      day.hourly.push(hourRec);
      waitPenalty = Math.max(0, waitPenalty - 0.01);
    }

    /* ---- station report ---- */
    day.byStation = stations.map(function (st) {
      return {
        bay: st.bay.id, bayLvl: st.bay.lvl, tech: st.tech.name, techLvl: st.tech.lvl,
        clock: st.used, capacity: st.capacity, billed: st.billed,
        productivity: st.capacity > 0 ? st.used / st.capacity : 0,
        efficiency: st.used > 0 ? st.billed / st.used : 0
      };
    });
    day.peakLot = Math.max.apply(null, lot.slice(0, Math.max(1, openHours)));
    day.usedHours = stations.reduce(function (n, st) { return n + st.used; }, 0);
    day.stationHours = stations.reduce(function (n, st) { return n + st.capacity; }, 0);
    day.utilization = day.stationHours > 0 ? day.usedHours / day.stationHours : 0;

    /* ---- money ---- */
    var revenue = day.revLabor + day.revParts + day.revSupplies;
    var oh = AS.dailyOverhead(s);
    var payroll = AS.dailyPayroll(s, openHours);
    var commission = advState.reduce(function (n, a) {
      return n + a.sold * a.lv.comm;
    }, 0);
    var adSpend = advanceChannels(s);
    var extra = (s.pendingCost || 0) + (day.rushFees || 0); s.pendingCost = 0;

    day.revenue = revenue;
    day.grossProfit = revenue - day.partsCost;
    day.overhead = oh.total;
    day.payroll = payroll.total;
    day.commission = commission;
    day.adSpend = adSpend;
    day.otherCost = extra;
    day.expenses = oh.total + payroll.total + commission + adSpend + extra;
    day.net = day.grossProfit - day.expenses;
    day.aro = day.ros > 0 ? revenue / day.ros : 0;
    day.elr = day.billedHours > 0 ? day.revLabor / day.billedHours : 0;
    day.closeRate = (day.closed + day.lost) > 0 ? day.closed / (day.closed + day.lost) : 0;
    day.laborGP = day.revLabor > 0 ? 1 : 0;
    day.partsGP = day.revParts > 0 ? (day.revParts - day.partsCost) / day.revParts : 0;
    day.effProd = day.stationHours > 0 ? day.billedHours / day.stationHours : 0;

    /* Parts leave the account when they are bought, never as COGS. Rush parts
       and their premium already came out of cash inside startJob, so the
       premium is added back here to avoid charging it twice. */
    day.cashFlow = revenue - day.expenses + (day.rushFees || 0);
    s.cash += day.cashFlow;
    s.stats.lifetimeAdSpend += adSpend;

    /* ---- reputation, loyalty, people ---- */
    var repDelta = 0;
    repDelta += day.ros * 0.055 * (0.5 + s.reputation / 200);
    /* Being turned away hurts in proportion to how often it happens, not in
       raw headcount — otherwise a busy shop is punished for being busy. */
    var handled = Math.max(4, day.ros + day.turnedAway + day.balked);
    repDelta -= 2.2 * (day.turnedAway + day.balked * 0.5 + day.declined * 0.08) / handled;
    repDelta -= day.comebacks * 0.55;
    repDelta -= day.carryover * 0.06;
    repDelta -= (day.cancellations || 0) * 0.30;
    repDelta += strategy.repShift * 0.05;
    var rateRatio = C.marketLaborRate / Math.max(40, s.pricing.laborRate);
    repDelta += (rateRatio - 1) * 1.4;
    if (s.adSpend.reviews > 0) repDelta += AS.CHANNEL_BY_ID.reviews.repGain * Math.min(4, s.channels.reviews.stock);
    repDelta += (C.repDecayToward - s.reputation) * C.repDecayRate;
    s.reputation = clamp(s.reputation + repDelta, 1, 100);
    day.repDelta = repDelta;

    var gained = day.ros * (0.42 + s.reputation / 260) - day.turnedAway * 0.5;
    s.customerBase = Math.max(0, s.customerBase * (1 - C.baseChurn) + gained);
    day.baseDelta = gained;

    s.techs.forEach(function (t) {
      if (t.training > 0) { t.training--; if (t.training === 0) { t.lvl = Math.min(5, t.lvl + 1); day.log.push({ h: null, type: 'good', text: t.name + ' finished training and is now a ' + AS.TECH_LEVELS[t.lvl - 1].title + '.' }); } return; }
      t.fatigue = clamp(t.fatigue + (day.utilization > 0.85 ? 7 : day.utilization > 0.6 ? 3 : -3), 0, 60);
      var mor = day.net > 0 ? 0.5 : -0.6;
      if (day.utilization > 0.92) mor -= 1.2;
      if (day.utilization < 0.3) mor -= 0.8;   // flat-rate techs hate an empty shop
      t.morale = clamp(t.morale + mor, 10, 100);
    });
    s.advisors.forEach(function (a) {
      if (a.training > 0) { a.training--; if (a.training === 0) { a.lvl = Math.min(5, a.lvl + 1); day.log.push({ h: null, type: 'good', text: a.name + ' completed sales training and is now a ' + AS.ADVISOR_LEVELS[a.lvl - 1].title + '.' }); } return; }
      var st2 = day.byAdvisor[a.id];
      a.lifetimeRO += st2 ? st2.ros : 0;
      a.lifetimeSold += st2 ? st2.sold : 0;
      a.lifetimeQuoted += st2 ? st2.quoted : 0;
      a.lifetimeUpsells += st2 ? st2.ups : 0;
      a.morale = clamp(a.morale + (day.ros > 0 ? 0.6 : -1), 10, 100);
    });
    s.bays.forEach(function (b) { if (b.down > 0) { b.down--; if (b.down === 0) day.log.push({ h: null, type: 'info', text: 'A bay is back in service after repairs.' }); } });

    finishDay(s, day, rand);
    return day;
  };

  /* ---------- shared end-of-day bookkeeping ---------- */
  function finishDay(s, day, rand) {
    /* Restock overnight, but never spend the shop into a position where it
       cannot make tomorrow's payroll. */
    if (s.partsStock < s.partsAutoOrder) {
      var reserve = Math.max(2500, AS.dailyPayroll(s, 9).total + AS.dailyOverhead(s).total);
      var want = s.partsAutoOrder - s.partsStock;
      var afford = Math.max(0, Math.min(want, s.cash - reserve));
      if (afford > 0) { s.partsStock += afford; s.cash -= afford; day.partsOrdered = afford; }
    }

    /* expire modifiers */
    s.modifiers = s.modifiers.filter(function (m) { m.days--; return m.days > 0; });

    /* stats */
    s.stats.daysOpen += day.isClosed ? 0 : 1;
    s.stats.totalCars += day.ros || 0;
    s.stats.totalRevenue += day.revenue || 0;
    s.stats.totalProfit += day.net || 0;
    s.stats.totalComebacks += day.comebacks || 0;
    if ((day.aro || 0) > s.stats.bestARO && day.ros >= 4) s.stats.bestARO = day.aro;
    if ((day.utilization || 0) > s.stats.bestUtil) s.stats.bestUtil = day.utilization;
    if ((day.net || 0) > s.stats.bestDayProfit) s.stats.bestDayProfit = day.net;

    s.history.push({
      open: !day.isClosed,
      day: s.day, revenue: day.revenue || 0, net: day.net || 0, cars: day.ros || 0,
      aro: day.aro || 0, util: day.utilization || 0, rep: s.reputation, cash: s.cash,
      billed: day.billedHours || 0, gp: day.grossProfit || 0
    });
    var lastSeven = s.history.slice(-7).reduce(function (n, h) { return n + h.revenue; }, 0);
    if (lastSeven > s.stats.bestWeekRevenue) s.stats.bestWeekRevenue = lastSeven;
    day.weekRevenue = lastSeven;

    /* milestones */
    day.milestones = [];
    AS.MILESTONES.forEach(function (m) {
      if (!s.milestones[m.id] && m.test(s)) {
        s.milestones[m.id] = s.day;
        s.cash += m.reward;
        day.milestones.push(m);
      }
    });

    /* random event, at most one per day, never on day 1 */
    day.event = null;
    if (s.day > 3 && rand() < 0.17) {
      var ev = pickEvent(rand);
      if (ev) {
        day.event = { id: ev.id, name: ev.name, blurb: ev.blurb, choice: !!ev.choice };
        if (ev.choice) s.pendingEvent = ev.id;
        else if (ev.apply) ev.apply(s, { rand: rand });
      }
    }

    /* roll the calendar */
    s.day++;
    s.dow = (s.dow + 1) % 7;
    if ((s.day - 1) % 28 === 0) {
      s.month = (s.month + 1) % 12;
      if (s.month === 0) s.year++;
    }

    /* bankruptcy check */
    if (s.cash < -AS.creditLimit(s)) {
      s.gameOver = { reason: 'You ran out of money and credit. The landlord changed the locks.', day: s.day };
    }
    s.log = s.log.concat(day.log.slice(-25)).slice(-200);
  }

  function pickEvent(rand) {
    var total = AS.EVENTS.reduce(function (n, e) { return n + e.w; }, 0);
    var r = rand() * total;
    for (var i = 0; i < AS.EVENTS.length; i++) {
      r -= AS.EVENTS[i].w;
      if (r <= 0) return AS.EVENTS[i];
    }
    return null;
  }

  /* Player-facing resolution of the two "choice" events. */
  AS.resolveEvent = function (s, id, accept) {
    if (id === 'fleet') {
      if (accept) {
        s.modifiers.push({ id: 'fleet', label: 'Fleet account', days: 60, traffic: 1.14 });
        s.customerBase += 140;
        s.pricing.laborRate = Math.round(s.pricing.laborRate * 0.94);
        return 'Fleet account signed. Steady volume for 60 days, but you gave up 6% on your labor rate.';
      }
      return 'You passed on the fleet account. Your rate holds.';
    }
    if (id === 'poach') {
      var best = s.techs.slice().sort(function (a, b) { return b.lvl - a.lvl; })[0];
      if (!best) return 'Nobody to poach.';
      if (accept) {
        s.cash -= 4200;
        best.morale = Math.min(100, best.morale + 28);
        return 'You matched the offer. ' + best.name + ' is staying. That cost you $4,200.';
      }
      if (best.lvl >= 3 && Math.random() < 0.55) {
        s.techs = s.techs.filter(function (t) { return t.id !== best.id; });
        return best.name + ' took the dealership job. You are down a ' + AS.TECH_LEVELS[best.lvl - 1].title + '.';
      }
      best.morale = Math.max(10, best.morale - 18);
      return best.name + ' stayed, but morale took a hit.';
    }
    return '';
  };

})(typeof window !== 'undefined' ? window : globalThis);
