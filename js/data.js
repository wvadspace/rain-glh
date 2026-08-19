/* ==========================================================================
   TORQUE & PROFIT — Auto Repair Shop Simulator
   data.js — static game data: jobs, equipment, staff ladders, marketing,
             seasonality, events and upgrade costs.
   All money is USD. All labor times are "book hours" (flat-rate billing),
   which is how real independent repair shops bill.
   ========================================================================== */
(function (root) {
  'use strict';
  var AS = root.AS = root.AS || {};

  /* ---------------------------------------------------------------------
     BAY EQUIPMENT LEVELS
     A bay can only perform jobs whose `equip` requirement is <= its level.
     Higher levels also work slightly faster (better tooling = less fumbling).
     --------------------------------------------------------------------- */
  AS.EQUIP = [
    { lvl: 1, name: 'Flat Stall',        blurb: 'Floor jack, stands, hand tools, drain pan.',                        eff: 0.82, upkeep: 4,  cost: 0 },
    { lvl: 2, name: 'Two-Post Lift',     blurb: '10k lift, air tools, press-fit basics, torque gear.',               eff: 1.00, upkeep: 12, cost: 11500 },
    { lvl: 3, name: 'Diagnostic Bay',    blurb: 'Bi-directional scan tool, lab scope, battery/charging tester.',     eff: 1.05, upkeep: 26, cost: 21000 },
    { lvl: 4, name: 'Tire & Alignment',  blurb: 'Alignment rack, road-force balancer, tire changer, TPMS tools.',    eff: 1.07, upkeep: 44, cost: 39000 },
    { lvl: 5, name: 'Heavy Line',        blurb: 'A/C machine, 20-ton press, engine hoist, trans jack, welder.',      eff: 1.12, upkeep: 68, cost: 58000 }
  ];

  /* ---------------------------------------------------------------------
     TECHNICIAN LADDER
     `skill` gates which jobs a tech may perform. `eff` is flat-rate
     proficiency: hours billed / hours actually spent.
     --------------------------------------------------------------------- */
  AS.TECH_LEVELS = [
    { lvl: 1, title: 'Lube Tech',      eff: 0.68, wage: 18, comeback: 0.070, trainCost: 3200,  trainDays: 2, hireCost: 2000 },
    { lvl: 2, title: 'C Technician',   eff: 0.86, wage: 24, comeback: 0.048, trainCost: 6000,  trainDays: 3, hireCost: 3800 },
    { lvl: 3, title: 'B Technician',   eff: 1.00, wage: 30, comeback: 0.032, trainCost: 11000, trainDays: 3, hireCost: 7000 },
    { lvl: 4, title: 'A Technician',   eff: 1.20, wage: 38, comeback: 0.020, trainCost: 19000, trainDays: 4, hireCost: 13500 },
    { lvl: 5, title: 'Master Tech',    eff: 1.45, wage: 49, comeback: 0.011, trainCost: 0,     trainDays: 0, hireCost: 24000 }
  ];

  /* ---------------------------------------------------------------------
     SERVICE ADVISOR LADDER (the "front counter")
     Advisors gate how many repair orders can be written per day, how often
     an estimate is approved, and how much extra work is sold per car.
     --------------------------------------------------------------------- */
  AS.ADVISOR_LEVELS = [
    { lvl: 1, title: 'Counterperson',    close: 0.42, upsell: 0.12, roCap: 14, hireCost: 2400, wage: 165, comm: 0.02, trainCost: 2200,  trainDays: 1 },
    { lvl: 2, title: 'Service Advisor',  close: 0.52, upsell: 0.22, roCap: 17, hireCost: 4600, wage: 195, comm: 0.03, trainCost: 4200,  trainDays: 2 },
    { lvl: 3, title: 'Senior Advisor',   close: 0.60, upsell: 0.32, roCap: 20, hireCost: 8200, wage: 235, comm: 0.04, trainCost: 7800,  trainDays: 2 },
    { lvl: 4, title: 'Sales Pro',        close: 0.67, upsell: 0.42, roCap: 24, hireCost: 15000, wage: 285, comm: 0.05, trainCost: 14000, trainDays: 3 },
    { lvl: 5, title: 'Master Advisor',   close: 0.74, upsell: 0.52, roCap: 28, hireCost: 26000, wage: 345, comm: 0.06, trainCost: 0,     trainDays: 0 }
  ];

  /* ---------------------------------------------------------------------
     JOB CATALOG
       hours      book hours (what the customer is billed for)
       parts      your cost for parts, before markup
       equip      minimum bay equipment level
       skill      minimum technician level
       weight     relative share of incoming demand
       sens       price sensitivity exponent (higher = shops around more)
       urg        urgency 0..1 (a no-start closes far better than a flush)
       diff       difficulty, drives comeback risk
       diag       billed at the diagnostic fee floor
       tags       season / upsell hooks
     --------------------------------------------------------------------- */
  AS.JOBS = [
    { id:'oil',        name:'Lube, Oil & Filter',          cat:'Maintenance', hours:0.5,  parts:24,   equip:1, skill:1, weight:21, sens:1.9, urg:0.30, diff:0.10, upsells:['airfilter','wiper','rotate','coolflush','brakes','battery','tires'] },
    { id:'inspect',    name:'Courtesy / State Inspection', cat:'Maintenance', hours:0.4,  parts:0,    equip:1, skill:1, weight:6,  sens:1.6, urg:0.55, diff:0.08, upsells:['brakes','tires','align','suspension','battery'] },
    { id:'wiper',      name:'Wiper Blades',                cat:'Maintenance', hours:0.2,  parts:26,   equip:1, skill:1, weight:2,  sens:1.4, urg:0.35, diff:0.05, season:{ 11:1.5, 0:1.4, 1:1.3 } },
    { id:'airfilter',  name:'Engine & Cabin Filters',      cat:'Maintenance', hours:0.3,  parts:32,   equip:1, skill:1, weight:3,  sens:1.4, urg:0.30, diff:0.06 },
    { id:'rotate',     name:'Tire Rotation & Balance',     cat:'Tires',       hours:0.6,  parts:6,    equip:2, skill:1, weight:6,  sens:1.5, urg:0.35, diff:0.10, upsells:['tires','align','brakes'] },
    { id:'battery',    name:'Battery & Charging Service',  cat:'Electrical',  hours:0.5,  parts:168,  equip:1, skill:2, weight:5,  sens:1.2, urg:0.88, diff:0.14, season:{ 0:1.9, 1:1.7, 11:1.6, 6:1.2, 7:1.2 } },
    { id:'brakes',     name:'Brake Pads & Rotors',         cat:'Brakes',      hours:2.2,  parts:186,  equip:2, skill:2, weight:10, sens:1.5, urg:0.72, diff:0.22, upsells:['brakefluid','rotate','align','suspension'] },
    { id:'brakefluid', name:'Brake Fluid Exchange',        cat:'Brakes',      hours:0.7,  parts:28,   equip:2, skill:2, weight:2,  sens:1.5, urg:0.25, diff:0.12 },
    { id:'coolflush',  name:'Coolant Flush',               cat:'Maintenance', hours:0.8,  parts:48,   equip:2, skill:2, weight:3,  sens:1.5, urg:0.28, diff:0.14 },
    { id:'trans',      name:'Transmission Service',        cat:'Driveline',   hours:1.2,  parts:126,  equip:2, skill:3, weight:3,  sens:1.4, urg:0.30, diff:0.20 },
    { id:'tuneup',     name:'Tune-Up: Plugs & Coils',      cat:'Engine',      hours:1.9,  parts:184,  equip:2, skill:3, weight:4,  sens:1.3, urg:0.60, diff:0.26 },
    { id:'tires',      name:'Four Tire Replacement',       cat:'Tires',       hours:1.5,  parts:640,  equip:4, skill:2, weight:7,  sens:2.1, urg:0.55, diff:0.16, upsells:['align','rotate','tpms'], season:{ 9:1.3, 10:1.5, 11:1.4 } },
    { id:'tpms',       name:'TPMS Sensor Service',         cat:'Tires',       hours:0.8,  parts:96,   equip:4, skill:2, weight:2,  sens:1.4, urg:0.45, diff:0.16 },
    { id:'align',      name:'Four-Wheel Alignment',        cat:'Tires',       hours:1.2,  parts:0,    equip:4, skill:3, weight:5,  sens:1.7, urg:0.45, diff:0.18 },
    { id:'cel',        name:'Check Engine Light Diag',     cat:'Diagnostics', hours:1.0,  parts:0,    equip:3, skill:3, weight:9,  sens:1.3, urg:0.78, diff:0.24, diag:true, upsells:['sensor','tuneup','fuelinj','vacuum'] },
    { id:'elecdiag',   name:'Electrical Diagnosis',        cat:'Diagnostics', hours:1.6,  parts:0,    equip:3, skill:4, weight:3,  sens:1.2, urg:0.85, diff:0.34, diag:true, upsells:['alt','starter','battery'] },
    { id:'sensor',     name:'O2 / MAF Sensor Repair',      cat:'Engine',      hours:1.2,  parts:196,  equip:3, skill:3, weight:4,  sens:1.2, urg:0.70, diff:0.24 },
    { id:'vacuum',     name:'Vacuum / EVAP Leak Repair',   cat:'Engine',      hours:1.6,  parts:88,   equip:3, skill:4, weight:2,  sens:1.2, urg:0.65, diff:0.30 },
    { id:'fuelinj',    name:'Fuel System Service',         cat:'Engine',      hours:1.0,  parts:62,   equip:3, skill:2, weight:3,  sens:1.5, urg:0.35, diff:0.16 },
    { id:'alt',        name:'Alternator Replacement',      cat:'Electrical',  hours:1.8,  parts:318,  equip:2, skill:3, weight:3,  sens:1.2, urg:0.90, diff:0.24 },
    { id:'starter',    name:'Starter Replacement',         cat:'Electrical',  hours:1.7,  parts:268,  equip:2, skill:3, weight:2,  sens:1.2, urg:0.92, diff:0.26 },
    { id:'waterpump',  name:'Water Pump & Thermostat',     cat:'Engine',      hours:3.2,  parts:214,  equip:2, skill:3, weight:3,  sens:1.2, urg:0.86, diff:0.34, season:{ 6:1.4, 7:1.5, 8:1.3 } },
    { id:'radiator',   name:'Radiator / Cooling Repair',   cat:'Engine',      hours:2.6,  parts:296,  equip:2, skill:3, weight:2,  sens:1.2, urg:0.88, diff:0.30, season:{ 6:1.4, 7:1.5 } },
    { id:'suspension', name:'Struts & Shocks',             cat:'Chassis',     hours:3.4,  parts:436,  equip:2, skill:3, weight:4,  sens:1.5, urg:0.50, diff:0.32, upsells:['align'] },
    { id:'bearing',    name:'Wheel Bearing / Hub',         cat:'Chassis',     hours:2.0,  parts:188,  equip:2, skill:3, weight:2,  sens:1.3, urg:0.80, diff:0.28 },
    { id:'exhaust',    name:'Exhaust & Converter',         cat:'Chassis',     hours:2.0,  parts:392,  equip:2, skill:2, weight:2,  sens:1.5, urg:0.60, diff:0.24 },
    { id:'ac',         name:'A/C Service & Recharge',      cat:'HVAC',        hours:1.5,  parts:98,   equip:5, skill:3, weight:5,  sens:1.4, urg:0.70, diff:0.24, season:{ 4:1.8, 5:2.4, 6:2.6, 7:2.4, 8:1.6, 0:0.3, 1:0.3, 11:0.3 } },
    { id:'accomp',     name:'A/C Compressor Replacement',  cat:'HVAC',        hours:3.6,  parts:548,  equip:5, skill:4, weight:2,  sens:1.3, urg:0.75, diff:0.36, season:{ 5:2.0, 6:2.2, 7:2.0, 0:0.3, 11:0.3 } },
    { id:'timing',     name:'Timing Belt / Chain',         cat:'Engine',      hours:5.5,  parts:432,  equip:5, skill:4, weight:2,  sens:1.2, urg:0.65, diff:0.44, upsells:['waterpump','coolflush'] },
    { id:'headgasket', name:'Head Gasket Repair',          cat:'Engine',      hours:9.0,  parts:880,  equip:5, skill:5, weight:1,  sens:1.1, urg:0.80, diff:0.52 },
    { id:'transrr',    name:'Transmission R&R',            cat:'Driveline',   hours:12.0, parts:2450, equip:5, skill:5, weight:1,  sens:1.1, urg:0.82, diff:0.50 },
    { id:'engine',     name:'Engine Replacement',          cat:'Engine',      hours:16.0, parts:3850, equip:5, skill:5, weight:0.7,sens:1.1, urg:0.80, diff:0.55 }
  ];

  AS.JOB_BY_ID = {};
  AS.JOBS.forEach(function (j) { AS.JOB_BY_ID[j.id] = j; });

  /* ---------------------------------------------------------------------
     ADVERTISING CHANNELS
       scale   dollars that buy one unit of "reach impulse" (diminishing)
       decay   how much awareness carries to the next day
       pull    leads per unit of awareness stock
       quality multiplies close rate (intent of the traffic)
       mix     shifts the job mix this channel brings in
       coupon  discount the channel promises (you must honor it)
     --------------------------------------------------------------------- */
  AS.CHANNELS = [
    { id:'search',  name:'Google Search & LSA', blurb:'High intent, in-market right now. Expensive per lead, works same day.',
      scale:44,  decay:0.34, pull:1.00, quality:1.14, coupon:0.00, mix:{ repair:1.25, maint:0.85 } },
    { id:'social',  name:'Social Media Ads',    blurb:'Cheap reach, softer intent. Builds a pipeline over a week or two.',
      scale:26,  decay:0.71, pull:0.56, quality:0.86, coupon:0.05, mix:{ repair:0.80, maint:1.30 } },
    { id:'mailer',  name:'Direct Mail Coupons', blurb:'Coupon shoppers. Steady maintenance traffic, thinner tickets.',
      scale:62,  decay:0.80, pull:0.60, quality:0.94, coupon:0.15, mix:{ repair:0.65, maint:1.55 } },
    { id:'radio',   name:'Local Radio & Outdoor', blurb:'Brand awareness. Wasteful in small doses, powerful when sustained.',
      scale:130, decay:0.89, pull:0.34, quality:0.92, coupon:0.00, mix:{ repair:1.05, maint:1.00 } },
    { id:'reviews', name:'Review & Reputation Program', blurb:'Follow-up texts and review asks. Lifts reputation and organic traffic.',
      scale:30,  decay:0.86, pull:0.10, quality:1.10, coupon:0.00, mix:{ repair:1.00, maint:1.00 }, repGain:0.055 },
    { id:'loyalty', name:'Loyalty & Reminder Program', blurb:'Service reminders and a rewards card. Brings your own customers back sooner.',
      scale:34,  decay:0.90, pull:0.08, quality:1.16, coupon:0.08, mix:{ repair:0.95, maint:1.20 }, retention:0.0022 }
  ];
  AS.CHANNEL_BY_ID = {};
  AS.CHANNELS.forEach(function (c) { AS.CHANNEL_BY_ID[c.id] = c; });

  /* --------------------------------------------------------------------- */
  AS.MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  AS.DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  /* Seasonal traffic index by month (0 = January). */
  AS.SEASON_TRAFFIC = [0.92, 0.90, 1.05, 1.08, 1.10, 1.12, 1.10, 1.06, 1.04, 1.06, 1.02, 0.88];

  /* Day-of-week traffic index and open hours. Sunday is closed. */
  AS.WEEK = [
    { open: false, hours: 0,  traffic: 0.00 },  // Sun
    { open: true,  hours: 9,  traffic: 1.18 },  // Mon
    { open: true,  hours: 9,  traffic: 1.06 },  // Tue
    { open: true,  hours: 9,  traffic: 1.00 },  // Wed
    { open: true,  hours: 9,  traffic: 1.02 },  // Thu
    { open: true,  hours: 9,  traffic: 1.10 },  // Fri
    { open: true,  hours: 5,  traffic: 0.72 }   // Sat
  ];

  /* Weather rolls. `bias` nudges the job mix toward certain categories. */
  AS.WEATHER = [
    { id:'clear',    name:'Clear',            w:34, traffic:1.00, note:'Normal day on the lot.' },
    { id:'hot',      name:'Heat Wave',        w:10, traffic:1.05, note:'A/C and cooling systems are letting go all over town.',
      bias:{ HVAC:2.2, Engine:1.25 }, season:[4,5,6,7,8] },
    { id:'cold',     name:'Cold Snap',        w:10, traffic:1.04, note:'No-starts and dead batteries before sunrise.',
      bias:{ Electrical:2.3, Engine:1.15 }, season:[10,11,0,1,2] },
    { id:'rain',     name:'Heavy Rain',       w:16, traffic:0.86, note:'Rain kept the walk-ins home. Wipers and brakes sold well.',
      bias:{ Brakes:1.25, Maintenance:1.15 } },
    { id:'storm',    name:'Storm Warning',    w:6,  traffic:0.62, note:'Storm warning. Half the appointments no-showed.' },
    { id:'snow',     name:'Snow & Ice',       w:8,  traffic:0.70, note:'Snow and ice. Slow morning, then a run of tow-ins.',
      bias:{ Tires:1.8, Chassis:1.3, Electrical:1.4 }, season:[10,11,0,1,2] },
    { id:'perfect',  name:'Perfect Weather',  w:16, traffic:1.14, note:'Beautiful day. Road-trip season checks rolled in.',
      bias:{ Maintenance:1.2, Tires:1.15 } }
  ];

  /* ---------------------------------------------------------------------
     LOCATIONS — the biggest single driver of raw traffic. Moving is a
     capital decision: you pay key money and your rent goes up.
     --------------------------------------------------------------------- */
  AS.LOCATIONS = [
    { id:'alley',    name:'Back Alley Garage',   base: 11.0, rent: 78,  maxBays: 3, maxSpaces: 10, cost: 0,      blurb:'Nobody drives past. Everything you get, you buy or you earn.' },
    { id:'sidest',   name:'Side Street Shop',    base: 17.0, rent: 132, maxBays: 5, maxSpaces: 16, cost: 42000,  blurb:'A block off the main road. Locals can find you.' },
    { id:'main',     name:'Main Street Corner',  base: 26.0,rent: 235, maxBays: 8, maxSpaces: 26, cost: 145000, blurb:'Signage that 12,000 cars a day drive past.' },
    { id:'highway',  name:'Highway Service Rd',  base: 38.0,rent: 385, maxBays: 12,maxSpaces: 40, cost: 340000, blurb:'Commuter corridor. Volume, fleet accounts and tow-ins.' }
  ];

  /* --------------------------------------------------------------------- */
  AS.CONFIG = {
    startCash: 42000,
    startRep: 55,
    startBase: 260,           // loyal customer count
    marketLaborRate: 128,     // town average, used for value comparisons
    marketOilPrice: 79.95,
    laborRateMin: 60,
    laborRateMax: 260,
    partsStrategies: [
      { id:'value',    name:'Value Pricing',    mult:0.86, repShift: 0.9,  blurb:'Thin parts margin. Customers notice, competitors hate you.' },
      { id:'standard', name:'Standard Matrix',  mult:1.00, repShift: 0.0,  blurb:'Industry-normal sliding scale markup.' },
      { id:'premium',  name:'Premium Matrix',   mult:1.16, repShift:-1.0,  blurb:'Fat parts gross. Expect more price objections and worse reviews.' }
    ],
    /* Sliding-scale parts markup, exactly how a real matrix works. */
    partsMatrix: [
      { max: 2,    mult: 5.0 }, { max: 10,   mult: 3.4 }, { max: 25,   mult: 2.7 },
      { max: 50,   mult: 2.3 }, { max: 100,  mult: 2.0 }, { max: 200,  mult: 1.80 },
      { max: 500,  mult: 1.62 },{ max: 1500, mult: 1.48 },{ max: 1e9,  mult: 1.38 }
    ],
    supplyFeeRate: 0.07, supplyFeeCap: 48,
    diagFeeDefault: 145,
    bayBuildBase: 46000, bayBuildGrowth: 1.28,
    spaceCost: 3600,
    hireTechFee: 1200, hireAdvisorFee: 1500,
    dailyFixed: { insurance: 34, software: 21, utilities: 46 },
    loanAPR: 0.089, creditFloor: 25000,
    partsMarkupOnStock: 1.0,   // inventory purchased at cost
    stockoutDelayDays: 1,
    rushPremium: 0.14,          // supplier surcharge for same-day parts you did not stock
    appointmentPatience: 2,     // days a booked customer will wait before cancelling
    repDecayToward: 62, repDecayRate: 0.012,
    baseVisitRate: 0.0072,     // fraction of the loyal base that returns each day
    baseChurn: 0.0035
  };

  /* ---------------------------------------------------------------------
     MILESTONES — the progression ladder.
     --------------------------------------------------------------------- */
  AS.MILESTONES = [
    { id:'m1',  name:'Open For Business',       test:function(s){ return s.day > 1; },                              reward:0,     blurb:'Survive your first day.' },
    { id:'m2',  name:'First $5k Week',          test:function(s){ return s.stats.bestWeekRevenue >= 5000; },        reward:1000,  blurb:'Bill $5,000 in a rolling week.' },
    { id:'m3',  name:'Three Bays Turning',      test:function(s){ return s.bays.length >= 3; },                     reward:1500,  blurb:'Run three service bays.' },
    { id:'m4',  name:'ARO Over $400',           test:function(s){ return s.stats.bestARO >= 400; },                 reward:2000,  blurb:'Average repair order above $400.' },
    { id:'m5',  name:'Four-Star Shop',          test:function(s){ return s.reputation >= 75; },                     reward:2500,  blurb:'Reputation of 75 or better.' },
    { id:'m6',  name:'Master Under the Hood',   test:function(s){ return s.techs.some(function(t){return t.lvl>=5;}); }, reward:3000, blurb:'Develop a Master Technician.' },
    { id:'m7',  name:'Heavy Line Certified',    test:function(s){ return s.bays.some(function(b){return b.lvl>=5;}); },  reward:3000, blurb:'Build a Heavy Line bay.' },
    { id:'m8',  name:'Closer On The Counter',   test:function(s){ return s.advisors.some(function(a){return a.lvl>=4;}); }, reward:3000, blurb:'Develop a Sales Pro advisor.' },
    { id:'m9',  name:'70% Bay Utilization',     test:function(s){ return s.stats.bestUtil >= 0.70; },               reward:3500,  blurb:'Sell 70% of your available bay hours in a day.' },
    { id:'m10', name:'$25k Week',               test:function(s){ return s.stats.bestWeekRevenue >= 25000; },       reward:6000,  blurb:'Bill $25,000 in a rolling week.' },
    { id:'m11', name:'Main Street',             test:function(s){ return s.locIndex >= 2; },                        reward:5000,  blurb:'Move the shop to Main Street or better.' },
    { id:'m12', name:'Debt Free & Fat',         test:function(s){ return s.loan <= 0 && s.cash >= 150000; },        reward:10000, blurb:'No debt and $150,000 in the bank.' },
    { id:'m13', name:'Five-Star Institution',   test:function(s){ return s.reputation >= 92 && s.customerBase >= 2500; }, reward:15000, blurb:'92 reputation with 2,500 loyal customers.' },
    { id:'m14', name:'Regional Powerhouse',     test:function(s){ return s.stats.bestWeekRevenue >= 75000 && s.bays.length >= 8; }, reward:25000, blurb:'$75,000 weeks out of eight-plus bays.' }
  ];

  /* Random operational events. Fired at most one per day. */
  AS.EVENTS = [
    { id:'comp_open',  name:'New Competitor',      w:5, blurb:'A national chain opened two blocks over and is running $29 oil changes.',
      apply:function(s){ s.modifiers.push({ id:'comp', label:'Competitor price war', days:14, traffic:0.88 }); } },
    { id:'fleet',      name:'Fleet Account Offer',  w:5, blurb:'A local contractor wants a fleet account: steady work, discounted labor.',
      choice:true },
    { id:'lift_fail',  name:'Equipment Failure',    w:6, blurb:'A lift failed its annual inspection and is red-tagged until repaired.',
      apply:function(s, sim){ var b = s.bays[Math.floor(sim.rand()*s.bays.length)]; if(b){ b.down = 2; } } },
    { id:'inspector',  name:'State Inspector Visit', w:4, blurb:'A surprise state inspection. Your paperwork held up, but it ate a bay for the morning.',
      apply:function(s){ s.modifiers.push({ id:'insp', label:'Inspection day', days:1, capacity:0.9 }); } },
    { id:'viral',      name:'Viral Review',         w:5, blurb:'A customer posted a glowing repair story that got shared all over town.',
      apply:function(s){ s.reputation = Math.min(100, s.reputation + 4); s.channels.search.stock += 2.2; } },
    { id:'badreview',  name:'One-Star Review',      w:6, blurb:'Someone posted a scathing one-star review about a price quote.',
      apply:function(s){ s.reputation = Math.max(0, s.reputation - 4); } },
    { id:'partsup',    name:'Parts Price Increase', w:5, blurb:'Your supplier raised prices across the board this quarter.',
      apply:function(s){ s.modifiers.push({ id:'pcost', label:'Parts cost surge', days:21, partsCost:1.09 }); } },
    { id:'poach',      name:'Poaching Attempt',     w:4, blurb:'The dealership is recruiting your best technician with a signing bonus.',
      choice:true },
    { id:'boom',       name:'Road Construction',    w:4, blurb:'The county tore up the road out front. Traffic is detoured for two weeks.',
      apply:function(s){ s.modifiers.push({ id:'road', label:'Road construction', days:12, traffic:0.72 }); } },
    { id:'towrush',    name:'Multi-Car Pileup',     w:4, blurb:'A pileup on the highway sent a run of collision-adjacent mechanical work your way.',
      apply:function(s){ s.modifiers.push({ id:'tow', label:'Tow-in surge', days:3, traffic:1.30 }); } },
    { id:'warranty',   name:'Warranty Claim',       w:5, blurb:'A part you installed last month failed. You are eating the redo.',
      apply:function(s){ s.pendingCost = (s.pendingCost||0) + 380; s.reputation = Math.max(0, s.reputation-1.5); } },
    { id:'awardt',     name:'Best Of The County',   w:3, blurb:'The local paper named you Best Auto Repair in the county.',
      apply:function(s){ s.reputation = Math.min(100, s.reputation + 6); s.customerBase += 90; } }
  ];

})(typeof window !== 'undefined' ? window : globalThis);
