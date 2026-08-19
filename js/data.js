/* data.js — static game data: jobs, certifications, equipment, staff tiers,
   marketing channels, parts categories, upgrades, random events. */
(function (G) {
  'use strict';

  var D = {};

  /* ---------------------------------------------------------------- world */
  D.SHOP_HOURS = 9;              // productive hours per bay per day
  D.PAYROLL_BURDEN = 0.145;      // employer taxes, comp, benefits
  D.SHOP_SUPPLY_RATE = 0.055;    // shop supplies as % of labor sales (billed back at 0 for simplicity)
  D.MARKET_LABOR_RATE = 152;     // what the competition charges per hour
  D.MARKET_MARKUP = 1.85;        // typical parts matrix multiplier
  D.WARRANTY_DAYS = 24;          // months*? — used only for flavor text
  D.DAYS_PER_MONTH = 30;

  /* -------------------------------------------------------- certifications */
  D.CERTS = {
    maint: { id: 'maint', name: 'Maintenance / LOF', short: 'MAINT', cost: 400, days: 1 },
    brakes: { id: 'brakes', name: 'Brakes & Suspension', short: 'BRK', cost: 1200, days: 2 },
    drive: { id: 'drive', name: 'Engine Performance', short: 'ENG', cost: 2200, days: 3 },
    elec: { id: 'elec', name: 'Electrical & Diagnostics', short: 'ELEC', cost: 2800, days: 3 },
    hvac: { id: 'hvac', name: 'HVAC / Climate Control', short: 'HVAC', cost: 1500, days: 2 },
    trans: { id: 'trans', name: 'Transmission & Driveline', short: 'TRANS', cost: 3400, days: 4 },
    ev: { id: 'ev', name: 'Hybrid / EV High Voltage', short: 'EV', cost: 4200, days: 4 }
  };

  /* ------------------------------------------------------------- equipment */
  /* Equipment is installed *into a bay*. A job can only be dispatched to a bay
     that carries every piece of equipment it requires. */
  D.EQUIPMENT = {
    lift: { id: 'lift', name: 'Two-Post Lift', cost: 0, note: 'Included with every bay.' },
    tire: { id: 'tire', name: 'Tire Changer & Road-Force Balancer', cost: 22000, note: 'Unlocks tire sales — the highest-volume category there is.' },
    align: { id: 'align', name: 'Alignment Rack', cost: 38000, note: 'Alignments are pure labor. Best gross profit in the building.' },
    scan: { id: 'scan', name: 'Factory Scan Tool & Lab Scope', cost: 12500, note: 'Required for driveability and electrical diagnosis.' },
    ac: { id: 'ac', name: 'A/C Recovery / Recharge Machine', cost: 9500, note: 'R-1234yf capable. Seasonal money printer.' },
    heavy: { id: 'heavy', name: 'Heavy-Duty Lift (12k lb)', cost: 26000, note: 'Opens up 3/4-ton trucks, vans and fleet work.' },
    adas: { id: 'adas', name: 'ADAS Calibration Target System', cost: 34000, note: 'Every modern windshield, alignment and bumper job needs it.' },
    evtool: { id: 'evtool', name: 'EV Service Package', cost: 41000, note: 'Insulated tooling, battery lift table, HV lockout.' }
  };

  /* Bay tool level: shop-quality hand/air/specialty tooling inside the bay.
     Raises effective speed and cuts comebacks. */
  D.TOOL_LEVELS = [
    { lvl: 1, name: 'Starter Roll-Away', cost: 0, speed: 1.00, comeback: 1.00 },
    { lvl: 2, name: 'Full Air Tool Set', cost: 6500, speed: 1.06, comeback: 0.93 },
    { lvl: 3, name: 'Pro Specialty Tooling', cost: 15000, speed: 1.12, comeback: 0.85 },
    { lvl: 4, name: 'Master Tool Program', cost: 31000, speed: 1.19, comeback: 0.76 },
    { lvl: 5, name: 'OEM Special Service Tools', cost: 62000, speed: 1.27, comeback: 0.66 }
  ];

  D.BAY_COST = function (existingBays) {
    /* Each additional bay costs more — you run out of cheap real estate. */
    return Math.round(48000 * Math.pow(1.22, Math.max(0, existingBays - 3)));
  };
  D.BAY_RENT_PER_DAY = 62;   // added fixed cost per bay beyond the original 3
  D.PARKING_COST = 5200;     // per additional striped space (paving, lease)
  D.PARKING_RENT_PER_DAY = 4.5;

  /* ------------------------------------------------------------ technicians */
  D.TECH_LEVELS = [
    { lvl: 1, title: 'Lube Tech', eff: 0.72, wage: 19, xp: 0 },
    { lvl: 2, title: 'B Technician', eff: 0.92, wage: 26, xp: 120 },
    { lvl: 3, title: 'A Technician', eff: 1.08, wage: 34, xp: 340 },
    { lvl: 4, title: 'Master Technician', eff: 1.22, wage: 43, xp: 760 },
    { lvl: 5, title: 'Diagnostic Specialist', eff: 1.36, wage: 54, xp: 1500 }
  ];
  D.TECH_PROMOTION_COST = [0, 2600, 5400, 11000, 21000];  // indexed by current level

  /* --------------------------------------------------------- service writers */
  D.WRITER_LEVELS = [
    { lvl: 1, title: 'Counter Greeter', close: 0.44, capacity: 11, csi: -3, wage: 20 },
    { lvl: 2, title: 'Service Advisor', close: 0.55, capacity: 15, csi: 0, wage: 26 },
    { lvl: 3, title: 'Senior Advisor', close: 0.64, capacity: 19, csi: 3, wage: 32 },
    { lvl: 4, title: 'Service Manager', close: 0.72, capacity: 24, csi: 6, wage: 39 }
  ];
  D.WRITER_PROMOTION_COST = [0, 2200, 4800, 9600];

  /* Advanced sales training — stacking courses bought per writer. */
  D.SALES_COURSES = {
    phone: { id: 'phone', name: 'Phone Skills & Appointment Setting', cost: 1400, days: 1, close: 0.05, upsell: 0.00, csi: 1, desc: 'Converts more of the calls that already ring in.' },
    menu: { id: 'menu', name: 'Menu Presentation', cost: 1900, days: 1, close: 0.02, upsell: 0.10, csi: 0, desc: 'Presents maintenance as a package instead of a line item.' },
    dvi: { id: 'dvi', name: 'DVI Story-Telling', cost: 2400, days: 2, close: 0.03, upsell: 0.14, csi: 2, desc: 'Photos and video with the estimate. Sells the hard stuff.' },
    objection: { id: 'objection', name: 'Objection Handling', cost: 2800, days: 2, close: 0.08, upsell: 0.05, csi: -1, desc: 'Fewer "let me think about it" write-offs.' },
    followup: { id: 'followup', name: 'Declined-Work Follow-Up', cost: 2100, days: 1, close: 0.03, upsell: 0.08, csi: 2, desc: 'Calls back the jobs the customer put off.' },
    fleet: { id: 'fleet', name: 'Fleet & Commercial Selling', cost: 5200, days: 3, close: 0.02, upsell: 0.04, csi: 0, fleet: true, desc: 'Unlocks the ability to land fleet accounts.' }
  };

  /* -------------------------------------------------------- parts inventory */
  D.PART_CATS = {
    fluids: { id: 'fluids', name: 'Oil, Filters & Fluids', lead: 0, carry: 0.0006 },
    brake: { id: 'brake', name: 'Brake & Chassis', lead: 1, carry: 0.0009 },
    tire: { id: 'tire', name: 'Tires & TPMS', lead: 1, carry: 0.0011 },
    elec: { id: 'elec', name: 'Batteries & Electrical', lead: 1, carry: 0.0009 },
    engine: { id: 'engine', name: 'Engine & Cooling', lead: 2, carry: 0.0012 },
    hvac: { id: 'hvac', name: 'A/C & Heating', lead: 2, carry: 0.0012 },
    driveline: { id: 'driveline', name: 'Driveline & Exhaust', lead: 2, carry: 0.0014 }
  };
  D.EMERGENCY_PREMIUM = 0.34;   // hot-shot delivery from the dealer costs more
  D.STOCK_DISCOUNT = 0.08;      // buying to a stocking level earns a jobber discount

  /* -------------------------------------------------------------- job menu */
  /* hours = flat-rate book time (what you bill). parts = your cost.
     diff  = 1..5 technical difficulty. */
  function J(o) { return o; }
  D.JOBS = [
    J({ id: 'lof', name: 'Oil Change & Inspection', cat: 'Maintenance', hours: 0.5, parts: 31, cert: 'maint', diff: 1, equip: ['lift'], pc: 'fluids', w: 190, gateway: true }),
    J({ id: 'inspect', name: 'State Safety Inspection', cat: 'Maintenance', hours: 0.4, parts: 0, cert: 'maint', diff: 1, equip: ['lift'], pc: 'fluids', w: 70, gateway: true }),
    J({ id: 'rotate', name: 'Tire Rotation & Balance', cat: 'Tires', hours: 0.5, parts: 0, cert: 'maint', diff: 1, equip: ['lift', 'tire'], pc: 'tire', w: 55 }),
    J({ id: 'wiper', name: 'Wipers & Bulbs', cat: 'Maintenance', hours: 0.3, parts: 22, cert: 'maint', diff: 1, equip: ['lift'], pc: 'fluids', w: 40, upsellOnly: true }),
    J({ id: 'cabin', name: 'Cabin & Engine Air Filters', cat: 'Maintenance', hours: 0.4, parts: 34, cert: 'maint', diff: 1, equip: ['lift'], pc: 'fluids', w: 45, upsellOnly: true }),
    J({ id: 'coolflush', name: 'Coolant Exchange', cat: 'Maintenance', hours: 1.0, parts: 58, cert: 'maint', diff: 2, equip: ['lift'], pc: 'engine', w: 30, upsellOnly: true }),
    J({ id: 'brakefluid', name: 'Brake Fluid Exchange', cat: 'Maintenance', hours: 0.8, parts: 36, cert: 'brakes', diff: 2, equip: ['lift'], pc: 'brake', w: 28, upsellOnly: true }),
    J({ id: 'tuneup', name: 'Plugs & Tune-Up', cat: 'Engine', hours: 1.8, parts: 176, cert: 'drive', diff: 3, equip: ['lift'], pc: 'engine', w: 34 }),

    J({ id: 'brakes_axle', name: 'Brake Pads & Rotors (1 axle)', cat: 'Brakes', hours: 1.6, parts: 108, cert: 'brakes', diff: 2, equip: ['lift'], pc: 'brake', w: 95 }),
    J({ id: 'brakes_full', name: 'Brake Job — Four Wheel', cat: 'Brakes', hours: 2.9, parts: 204, cert: 'brakes', diff: 3, equip: ['lift'], pc: 'brake', w: 42 }),
    J({ id: 'caliper', name: 'Caliper & Hose Replacement', cat: 'Brakes', hours: 2.1, parts: 168, cert: 'brakes', diff: 3, equip: ['lift'], pc: 'brake', w: 22 }),
    J({ id: 'struts', name: 'Struts & Springs', cat: 'Suspension', hours: 3.4, parts: 352, cert: 'brakes', diff: 3, equip: ['lift'], pc: 'brake', w: 30 }),
    J({ id: 'control_arm', name: 'Control Arm / Ball Joint', cat: 'Suspension', hours: 2.6, parts: 214, cert: 'brakes', diff: 3, equip: ['lift'], pc: 'brake', w: 26 }),
    J({ id: 'wheelbear', name: 'Wheel Bearing / Hub', cat: 'Suspension', hours: 2.0, parts: 178, cert: 'brakes', diff: 3, equip: ['lift'], pc: 'brake', w: 24 }),

    J({ id: 'tires4', name: 'Set of Four Tires', cat: 'Tires', hours: 1.3, parts: 546, cert: 'maint', diff: 2, equip: ['lift', 'tire'], pc: 'tire', w: 78 }),
    J({ id: 'tire_repair', name: 'Flat Repair / TPMS', cat: 'Tires', hours: 0.6, parts: 28, cert: 'maint', diff: 1, equip: ['lift', 'tire'], pc: 'tire', w: 46 }),
    J({ id: 'align', name: 'Four-Wheel Alignment', cat: 'Alignment', hours: 1.1, parts: 0, cert: 'brakes', diff: 3, equip: ['align'], pc: 'brake', w: 62 }),
    J({ id: 'adas_cal', name: 'ADAS Static Calibration', cat: 'Alignment', hours: 1.8, parts: 0, cert: 'elec', diff: 4, equip: ['align', 'adas'], pc: 'elec', w: 20 }),

    J({ id: 'battery', name: 'Battery & Charging Test', cat: 'Electrical', hours: 0.6, parts: 168, cert: 'maint', diff: 1, equip: ['lift'], pc: 'elec', w: 68 }),
    J({ id: 'alternator', name: 'Alternator Replacement', cat: 'Electrical', hours: 2.1, parts: 296, cert: 'elec', diff: 3, equip: ['lift', 'scan'], pc: 'elec', w: 26 }),
    J({ id: 'starter', name: 'Starter Replacement', cat: 'Electrical', hours: 1.9, parts: 248, cert: 'elec', diff: 3, equip: ['lift'], pc: 'elec', w: 22 }),
    J({ id: 'diag', name: 'Check Engine Light Diagnosis', cat: 'Diagnostics', hours: 1.0, parts: 0, cert: 'drive', diff: 4, equip: ['scan'], pc: 'elec', w: 86, gateway: true }),
    J({ id: 'elec_diag', name: 'Electrical Fault Diagnosis', cat: 'Diagnostics', hours: 1.5, parts: 0, cert: 'elec', diff: 5, equip: ['scan'], pc: 'elec', w: 34, gateway: true }),
    J({ id: 'sensor', name: 'Sensor / Ignition Coil Repair', cat: 'Engine', hours: 1.3, parts: 152, cert: 'drive', diff: 3, equip: ['lift', 'scan'], pc: 'engine', w: 40 }),
    J({ id: 'evap', name: 'EVAP Leak Repair', cat: 'Engine', hours: 1.7, parts: 118, cert: 'drive', diff: 4, equip: ['lift', 'scan'], pc: 'engine', w: 24 }),

    J({ id: 'ac_service', name: 'A/C Evacuate & Recharge', cat: 'HVAC', hours: 1.4, parts: 116, cert: 'hvac', diff: 2, equip: ['ac'], pc: 'hvac', w: 52, season: 'summer' }),
    J({ id: 'ac_compressor', name: 'A/C Compressor & Drier', cat: 'HVAC', hours: 3.6, parts: 468, cert: 'hvac', diff: 4, equip: ['lift', 'ac'], pc: 'hvac', w: 24, season: 'summer' }),
    J({ id: 'heater_core', name: 'Heater Core / Blend Door', cat: 'HVAC', hours: 6.5, parts: 322, cert: 'hvac', diff: 4, equip: ['lift'], pc: 'hvac', w: 12, season: 'winter' }),

    J({ id: 'waterpump', name: 'Water Pump & Thermostat', cat: 'Engine', hours: 3.1, parts: 236, cert: 'drive', diff: 3, equip: ['lift'], pc: 'engine', w: 28 }),
    J({ id: 'timing', name: 'Timing Belt / Chain Service', cat: 'Engine', hours: 5.2, parts: 412, cert: 'drive', diff: 4, equip: ['lift'], pc: 'engine', w: 18 }),
    J({ id: 'exhaust', name: 'Exhaust & Catalytic Converter', cat: 'Driveline', hours: 2.2, parts: 384, cert: 'drive', diff: 3, equip: ['lift'], pc: 'driveline', w: 22 }),
    J({ id: 'axle', name: 'CV Axle / Driveshaft', cat: 'Driveline', hours: 2.0, parts: 186, cert: 'trans', diff: 3, equip: ['lift'], pc: 'driveline', w: 24 }),
    J({ id: 'trans_service', name: 'Transmission Fluid Service', cat: 'Driveline', hours: 1.5, parts: 158, cert: 'trans', diff: 2, equip: ['lift'], pc: 'driveline', w: 30 }),
    J({ id: 'clutch', name: 'Clutch Replacement', cat: 'Driveline', hours: 7.5, parts: 742, cert: 'trans', diff: 4, equip: ['lift', 'heavy'], pc: 'driveline', w: 9 }),
    J({ id: 'headgasket', name: 'Head Gasket / Engine Teardown', cat: 'Engine', hours: 13.0, parts: 918, cert: 'drive', diff: 5, equip: ['lift', 'heavy'], pc: 'engine', w: 7 }),
    J({ id: 'trans_rebuild', name: 'Transmission R&R', cat: 'Driveline', hours: 12.0, parts: 2380, cert: 'trans', diff: 5, equip: ['lift', 'heavy'], pc: 'driveline', w: 8 }),
    J({ id: 'hv_battery', name: 'Hybrid Battery Service', cat: 'EV', hours: 4.5, parts: 1850, cert: 'ev', diff: 5, equip: ['lift', 'evtool', 'scan'], pc: 'elec', w: 11 }),
    J({ id: 'ev_service', name: 'EV Inverter / Coolant Service', cat: 'EV', hours: 2.4, parts: 288, cert: 'ev', diff: 4, equip: ['lift', 'evtool'], pc: 'elec', w: 13 })
  ];

  D.JOB_BY_ID = {};
  D.JOBS.forEach(function (j) { D.JOB_BY_ID[j.id] = j; });

  /* Which jobs a digital inspection tends to find on a vehicle already in a bay. */
  D.UPSELL_POOL = ['cabin', 'wiper', 'coolflush', 'brakefluid', 'brakes_axle', 'align',
    'battery', 'tire_repair', 'tires4', 'rotate', 'struts', 'trans_service',
    'wheelbear', 'sensor', 'ac_service', 'tuneup', 'control_arm'];

  /* ---------------------------------------------------------- ad channels */
  /* eff    = awareness generated per $100 spent
     decay  = fraction of awareness stock carried to the next day
     intent = quality of the traffic (drives close rate and repair mix)
     min    = minimum useful daily spend */
  D.CHANNELS = [
    { id: 'lsa', name: 'Google Local Services Ads', cpl: 26, max: 9, decay: 0.40, intent: 1.22, cap: 400, unlock: 0,
      desc: 'Pay-per-lead, top of the page. The highest-intent traffic there is — and it stops the day you stop paying.' },
    { id: 'ppc', name: 'Google Search Ads', cpl: 34, max: 11, decay: 0.46, intent: 1.12, cap: 500, unlock: 0,
      desc: '"Brake repair near me." Expensive clicks, but they are buying today.' },
    { id: 'social', name: 'Facebook / Instagram', cpl: 14, max: 7, decay: 0.80, intent: 0.60, cap: 350, unlock: 0,
      desc: 'Cheap reach. Coupon shoppers and tire-kickers, but it builds a base.' },
    { id: 'mailer', name: 'Direct Mail / EDDM', cpl: 22, max: 6, decay: 0.87, intent: 0.88, cap: 300, unlock: 0,
      desc: 'Slow to build, slow to fade. Owns the neighborhood right around you.' },
    { id: 'radio', name: 'Local Radio & Billboard', cpl: 30, max: 8, decay: 0.94, intent: 0.58, cap: 450, unlock: 12,
      desc: 'Pure brand. Takes three weeks to matter, then it compounds and keeps paying.' },
    { id: 'reviews', name: 'Review Generation Program', cpl: 18, max: 3, decay: 0.91, intent: 1.30, cap: 150, unlock: 5, rep: 0.09,
      desc: 'Texts every happy customer a review link. Raises your rating as well as your car count.' },
    { id: 'loyalty', name: 'Loyalty & Service Reminders', cpl: 11, max: 5, decay: 0.94, intent: 1.35, cap: 200, unlock: 20, retain: 0.055,
      desc: 'Markets to the list you already own. The cheapest car you will ever buy.' },
    { id: 'fleetads', name: 'Fleet & Commercial Outreach', cpl: 40, max: 4, decay: 0.90, intent: 1.15, cap: 250, unlock: 30, fleet: true,
      desc: 'Lands contract accounts. Useless without a writer trained in commercial selling.' }
  ];

  /* ------------------------------------------------------------- upgrades */
  D.UPGRADES = {
    dvi: { id: 'dvi', name: 'Digital Vehicle Inspection Software', cost: 6800, upkeep: 9, desc: 'Techs send photos and video with every estimate. More findings, higher close rate.' },
    scheduler: { id: 'scheduler', name: 'Online Scheduling & Text-to-Pay', cost: 4200, upkeep: 6, desc: 'Fewer abandoned calls, faster checkout, better CSI.' },
    shuttle: { id: 'shuttle', name: 'Shuttle Van & Loaner Car', cost: 24000, upkeep: 38, desc: 'Customers accept multi-day jobs instead of declining them.' },
    lounge: { id: 'lounge', name: 'Customer Lounge Remodel', cost: 15000, upkeep: 7, desc: 'Wi-Fi, coffee, clean bathroom. Waiting no longer feels like punishment.' },
    lube_lane: { id: 'lube_lane', name: 'Express Lube Lane', cost: 34000, upkeep: 26, desc: 'Dedicated quick-service position. Oil changes stop clogging the repair bays.' },
    parts_room: { id: 'parts_room', name: 'Parts Room & Delivery Contract', cost: 11000, upkeep: 12, desc: 'Better jobber pricing and next-morning stock replenishment.' },
    training_room: { id: 'training_room', name: 'In-House Training Room', cost: 18000, upkeep: 10, desc: 'Cuts every training course cost and downtime in half.' },
    tow: { id: 'tow', name: 'Tow Truck & Roadside Contract', cost: 52000, upkeep: 55, desc: 'Breakdowns get towed to you instead of the shop down the street.' }
  };

  /* --------------------------------------------------------------- events */
  D.EVENTS = [
    { id: 'sick', w: 10, name: 'Tech called in sick', text: 'is out today. Nothing you can do about it.' },
    { id: 'tow_in', w: 9, name: 'Big tow-in', text: 'A tow truck dropped off a no-start. Big ticket if you can get to it.' },
    { id: 'comeback_storm', w: 4, name: 'Angry customer', text: 'A repeat comeback went public. Your rating took a hit.' },
    { id: 'parts_late', w: 7, name: 'Parts truck delayed', text: 'The jobber truck broke down. Stocking orders arrive a day late.' },
    { id: 'equip_fail', w: 5, name: 'Equipment failure', text: 'A lift failed inspection. One bay is down until it is repaired.' },
    { id: 'heat_wave', w: 6, name: 'Heat wave', text: 'A/C work is pouring in.', season: 'summer' },
    { id: 'cold_snap', w: 6, name: 'Cold snap', text: 'Batteries are dying all over town.', season: 'winter' },
    { id: 'storm', w: 5, name: 'Severe weather', text: 'Nobody is driving today. Car count is way down.' },
    { id: 'potholes', w: 5, name: 'Pothole season', text: 'Bent wheels and blown struts everywhere.', season: 'spring' },
    { id: 'competitor', w: 4, name: 'Competitor opened', text: 'A national chain opened two blocks over. Traffic is softer for a while.' },
    { id: 'competitor_closed', w: 3, name: 'Competitor closed', text: 'The shop down the road shut its doors. Their customers need somewhere to go.' },
    { id: 'review_spike', w: 6, name: 'Great review went viral', text: 'A five-star review got shared around town.' },
    { id: 'fleet_offer', w: 4, name: 'Fleet inquiry', text: 'A local contractor is shopping their fleet. Requires a commercially trained writer.' },
    { id: 'inspection', w: 3, name: 'State inspection audit', text: 'Regulators dropped in. Fines and a half day of lost production.' },
    { id: 'poach', w: 4, name: 'Poaching attempt', text: 'The dealership is trying to hire one of your A-techs.' }
  ];

  /* ------------------------------------------------------------ name pools */
  D.FIRST = ['Marcus', 'Dale', 'Rosa', 'Tyler', 'Jimmy', 'Andre', 'Kelly', 'Sam', 'Vic', 'Owen',
    'Luis', 'Rick', 'Nina', 'Chuck', 'Devon', 'Pete', 'Maya', 'Gus', 'Hank', 'Cesar',
    'Tanya', 'Wes', 'Omar', 'Brody', 'Faye', 'Jorge', 'Kim', 'Dre', 'Sal', 'Ivy'];
  D.LAST = ['Hollis', 'Vega', 'Okafor', 'Brandt', 'Ruiz', 'Kaminski', 'Doyle', 'Nakamura', 'Pryor',
    'Delgado', 'Whitfield', 'Barros', 'Mancini', 'Sowell', 'Ferris', 'Achebe', 'Lund',
    'Castellano', 'Trask', 'Bhatt', 'Ramos', 'Keene', 'Solberg', 'Ibarra'];

  D.VEHICLES = ['2013 Honda Accord', '2016 Ford F-150', '2011 Toyota Camry', '2019 Subaru Outback',
    '2008 Chevy Silverado', '2017 Nissan Rogue', '2015 Jeep Grand Cherokee', '2020 Toyota RAV4',
    '2012 BMW 328i', '2018 Ram 1500', '2014 Hyundai Sonata', '2021 Tesla Model 3',
    '2010 Dodge Caravan', '2019 Kia Telluride', '2007 Lexus RX350', '2022 Ford Escape Hybrid',
    '2016 Volkswagen Jetta', '2009 Mercedes C300', '2018 Chevy Equinox', '2013 Mazda CX-5'];

  D.SEASONS = ['winter', 'spring', 'summer', 'fall'];
  D.DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  /* Monday and the day after a weekend are heavy; Saturday is short; Sunday closed. */
  D.DOW_FACTOR = [1.18, 1.04, 0.98, 1.02, 1.10, 0.68, 0];

  G.DATA = D;
})(typeof window !== 'undefined' ? window : globalThis);
