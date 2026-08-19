/*
 * Torque & Turnover — static game data.
 *
 * Everything in here is tuned against real-world independent-shop economics:
 * door rates in the $150-$190/hr range, 55-62% gross profit on labor,
 * 45-55% gross on parts, ~$400-$600 average repair order, 1.4-2.2 hours
 * of billed labor per repair order, and 60-75% closing ratios on
 * presented work.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Market / town
   * ------------------------------------------------------------------ */
  var TOWN = {
    name: 'Cedar Ridge',
    population: 46000,
    registeredVehicles: 38000,
    // Cars in the market needing service on an average Wednesday.
    marketDailyOpportunities: 240,
    // What the established shops down the road charge.
    marketLaborRate: 165,
    marketPartsMarkup: 1.85,
    marketDiagFee: 149
  };

  /* ------------------------------------------------------------------ *
   * Parts inventory
   * Each category is stocked in "units". A unit is one job's worth for
   * that category (one axle set of brakes, one tire, one battery...).
   * ------------------------------------------------------------------ */
  var PART_CATEGORIES = [
    { key: 'fluids', name: 'Filters & Fluids', unit: 'kit', cost: 24, shelf: 1,
      note: 'Oil, filters, ATF, coolant, wipers' },
    { key: 'brakes', name: 'Brake Components', unit: 'axle set', cost: 92, shelf: 2,
      note: 'Pads, rotors, hardware, calipers' },
    { key: 'tires', name: 'Tires', unit: 'tire', cost: 118, shelf: 3, maxMarkup: 1.45,
      note: 'Mid-line all-season, common sizes' },
    { key: 'electrical', name: 'Batteries & Electrical', unit: 'unit', cost: 138, shelf: 2,
      note: 'Batteries, alternators, starters, sensors' },
    { key: 'cooling', name: 'Belts, Hoses & Cooling', unit: 'unit', cost: 96, shelf: 2,
      note: 'Water pumps, thermostats, belts, hoses' },
    { key: 'suspension', name: 'Suspension & Steering', unit: 'unit', cost: 148, shelf: 3,
      note: 'Struts, control arms, tie rods, bearings' },
    { key: 'hvac', name: 'HVAC & Refrigerant', unit: 'unit', cost: 78, shelf: 1,
      note: 'R-1234yf, driers, expansion valves' },
    { key: 'engine', name: 'Engine & Drivetrain', unit: 'unit', cost: 188, shelf: 3,
      note: 'Timing kits, injectors, mounts, clutches' },
    { key: 'supplies', name: 'Shop Supplies', unit: 'pack', cost: 7, shelf: 0.4, maxMarkup: 3.2,
      note: 'Rags, cleaner, fasteners, sealant, gloves' }
  ];

  /* Supplier tiers change cost, comeback risk, and customer perception. */
  var SUPPLIERS = {
    economy: { key: 'economy', name: 'Economy / White Box', costMult: 0.72,
      qualityMod: -0.16, csiMod: -0.22,
      note: 'Cheapest parts on the shelf. Higher comeback rate, and customers notice.' },
    aftermarket: { key: 'aftermarket', name: 'Quality Aftermarket', costMult: 1.0,
      qualityMod: 0, csiMod: 0,
      note: 'The industry default. Solid margin, solid reliability.' },
    oe: { key: 'oe', name: 'OE / Dealer', costMult: 1.42,
      qualityMod: 0.12, csiMod: 0.18,
      note: 'Fits right the first time. Thin margin unless you price for it.' }
  };

  /* Ordering programs: how you buy parts. */
  var ORDER_PROGRAMS = {
    jobber: { key: 'jobber', name: 'Local Jobber (next morning)', days: 1, costMult: 1.08,
      note: 'On the shelf tomorrow at 7am. You pay for the convenience.' },
    warehouse: { key: 'warehouse', name: 'Warehouse Distributor (2 days)', days: 2, costMult: 1.0,
      note: 'Standard two-day freight. The baseline price.' },
    bulk: { key: 'bulk', name: 'Bulk Program (4 days)', days: 4, costMult: 0.87,
      note: 'Order deep, save 13%. Ties up cash and shelf space.' }
  };

  /* Emergency same-day hot-shot when you run out mid-job. */
  var HOTSHOT_MULT = 1.55;

  /* ------------------------------------------------------------------ *
   * Bays and tooling
   * ------------------------------------------------------------------ */
  var BAY_TYPES = {
    general: { key: 'general', name: 'General Repair Bay', buildCost: 34000, buildDays: 6,
      note: 'Two-post lift. Handles the widest range of work.' },
    tire: { key: 'tire', name: 'Tire & Wheel Bay', buildCost: 27000, buildDays: 5,
      note: 'Changer and balancer. Fast turns, thin margin, great door-opener.' },
    align: { key: 'align', name: 'Alignment Rack', buildCost: 46000, buildDays: 8,
      note: 'Imaging alignment rack. High margin, sells suspension work.' },
    diag: { key: 'diag', name: 'Diagnostic Bay', buildCost: 39000, buildDays: 7,
      note: 'Scan tools, scope, power supply. Where the real money hides.' }
  };

  /*
   * Tool packages per bay type. Index 0 is what the bay ships with.
   * `speed` multiplies technician output in that bay.
   * `quality` reduces comeback probability.
   * `unlocks` are job tags that become possible in that bay.
   */
  var TOOL_PACKAGES = {
    general: [
      { level: 1, name: 'Hand Tools & 2-Post Lift', cost: 0, days: 0, speed: 1.00, quality: 0.00, unlocks: [] },
      { level: 2, name: 'Air Tools, Press & Torque Program', cost: 7500, days: 2, speed: 1.08, quality: 0.03, unlocks: ['suspension'] },
      { level: 3, name: 'A/C Machine, Coolant Exchanger, Brake Lathe', cost: 16500, days: 3, speed: 1.14, quality: 0.05, unlocks: ['hvac', 'cooling'] },
      { level: 4, name: 'Engine Support, Timing Kits, Injector Service', cost: 24000, days: 4, speed: 1.20, quality: 0.07, unlocks: ['engine', 'fuel'] },
      { level: 5, name: 'HV/EV Insulated Tooling & Battery Lift Table', cost: 41000, days: 5, speed: 1.25, quality: 0.09, unlocks: ['ev'] }
    ],
    tire: [
      { level: 1, name: 'Manual Changer & Bubble Balancer', cost: 0, days: 0, speed: 1.00, quality: 0.00, unlocks: [] },
      { level: 2, name: 'Touchless Changer & Road-Force Balancer', cost: 19000, days: 3, speed: 1.22, quality: 0.06, unlocks: ['tirepro'] },
      { level: 3, name: 'TPMS Programmer & Nitrogen Station', cost: 9500, days: 2, speed: 1.30, quality: 0.09, unlocks: ['tpms'] },
      { level: 4, name: 'Wheel Lift & Flat-Rate Tire Carousel', cost: 14000, days: 2, speed: 1.38, quality: 0.10, unlocks: [] },
      { level: 5, name: 'Robotic Mount/Balance Cell', cost: 32000, days: 4, speed: 1.50, quality: 0.12, unlocks: [] }
    ],
    align: [
      { level: 1, name: 'Basic Rack & Target Heads', cost: 0, days: 0, speed: 1.00, quality: 0.00, unlocks: ['align'] },
      { level: 2, name: 'Imaging Alignment System', cost: 21000, days: 3, speed: 1.18, quality: 0.06, unlocks: [] },
      { level: 3, name: 'ADAS Calibration Frame & Targets', cost: 38000, days: 5, speed: 1.24, quality: 0.08, unlocks: ['adas'] },
      { level: 4, name: 'Heavy-Duty Lift Kit (3/4 & 1-Ton)', cost: 17000, days: 3, speed: 1.30, quality: 0.09, unlocks: ['hd'] },
      { level: 5, name: 'Drive-Through Diagnostic Alignment', cost: 29000, days: 4, speed: 1.38, quality: 0.11, unlocks: [] }
    ],
    diag: [
      { level: 1, name: 'Entry Scan Tool & Multimeter', cost: 0, days: 0, speed: 1.00, quality: 0.00, unlocks: ['diag'] },
      { level: 2, name: 'Bi-Directional Scanner & Lab Scope', cost: 13500, days: 2, speed: 1.16, quality: 0.06, unlocks: ['diagpro'] },
      { level: 3, name: 'OEM Subscriptions & J2534 Programming', cost: 22000, days: 3, speed: 1.24, quality: 0.09, unlocks: ['program'] },
      { level: 4, name: 'Smoke Machine, Pico & Current Clamps', cost: 11000, days: 2, speed: 1.30, quality: 0.11, unlocks: ['electrical'] },
      { level: 5, name: 'HV Diagnostic Suite & Insulation Tester', cost: 26000, days: 3, speed: 1.36, quality: 0.13, unlocks: ['evdiag'] }
    ]
  };

  /* ------------------------------------------------------------------ *
   * Jobs (repair order line items)
   * bookHours  - what you bill (flat-rate guide time)
   * parts      - units consumed by category
   * bays       - which bay types can perform it
   * tags       - tooling unlocks required (all must be present in the bay)
   * certs      - technician certifications required
   * skill      - which technician skill area drives speed & quality
   * difficulty - 1 (oil change) to 5 (hybrid battery)
   * weight     - relative frequency in the market
   * upsell     - can be added to another RO as additional sold work
   * ------------------------------------------------------------------ */
  var JOBS = [
    { key: 'oil', name: 'Oil & Filter Service', bookHours: 0.5, parts: { fluids: 1, supplies: 1 },
      bays: ['general', 'tire'], tags: [], certs: [], skill: 'maintenance', difficulty: 1, weight: 22, upsell: false,
      season: { winter: 1.0, spring: 1.0, summer: 1.05, fall: 1.0 } },
    { key: 'inspection', name: 'Safety / Emissions Inspection', bookHours: 0.5, parts: { supplies: 1 },
      bays: ['general', 'tire', 'diag'], tags: [], certs: [], skill: 'maintenance', difficulty: 1, weight: 8, upsell: false,
      season: { winter: 1.0, spring: 1.15, summer: 1.0, fall: 1.0 } },
    { key: 'rotate', name: 'Tire Rotation & Balance', bookHours: 0.7, parts: { supplies: 1 },
      bays: ['tire', 'general'], tags: [], certs: [], skill: 'tires', difficulty: 1, weight: 9, upsell: true,
      season: { winter: 1.0, spring: 1.1, summer: 1.0, fall: 1.0 } },
    { key: 'tires4', name: 'Four Tires Mounted & Balanced', bookHours: 1.3, parts: { tires: 4, supplies: 1 },
      bays: ['tire'], tags: [], certs: [], skill: 'tires', difficulty: 2, weight: 7, upsell: false,
      season: { winter: 1.35, spring: 1.05, summer: 0.9, fall: 1.2 } },
    { key: 'tpms', name: 'TPMS Sensor Service', bookHours: 0.8, parts: { electrical: 1, supplies: 1 },
      bays: ['tire'], tags: ['tpms'], certs: [], skill: 'tires', difficulty: 2, weight: 4, upsell: true,
      season: { winter: 1.4, spring: 0.9, summer: 0.9, fall: 1.1 } },
    { key: 'align', name: 'Four-Wheel Alignment', bookHours: 1.0, parts: { supplies: 1 },
      bays: ['align'], tags: ['align'], certs: [], skill: 'tires', difficulty: 2, weight: 7, upsell: true,
      season: { winter: 1.0, spring: 1.25, summer: 1.0, fall: 1.0 } },
    { key: 'brakes', name: 'Brake Pads & Rotors (per axle)', bookHours: 1.8, parts: { brakes: 1, supplies: 1 },
      bays: ['general'], tags: [], certs: [], skill: 'brakes', difficulty: 2, weight: 13, upsell: true,
      season: { winter: 1.15, spring: 1.0, summer: 0.95, fall: 1.05 } },
    { key: 'battery', name: 'Battery Test & Replacement', bookHours: 0.6, parts: { electrical: 1, supplies: 1 },
      bays: ['general', 'tire', 'diag'], tags: [], certs: [], skill: 'electrical', difficulty: 1, weight: 7, upsell: true,
      season: { winter: 1.9, spring: 0.8, summer: 1.15, fall: 0.9 } },
    { key: 'charging', name: 'Alternator / Starter Replacement', bookHours: 2.3, parts: { electrical: 1, supplies: 1 },
      bays: ['general', 'diag'], tags: [], certs: [], skill: 'electrical', difficulty: 3, weight: 5, upsell: false,
      season: { winter: 1.4, spring: 0.9, summer: 1.05, fall: 0.95 } },
    { key: 'diag', name: 'Check Engine Light Diagnostic', bookHours: 1.0, parts: { supplies: 1 },
      bays: ['diag'], tags: ['diag'], certs: [], skill: 'diagnostics', difficulty: 3, weight: 11, upsell: false,
      season: { winter: 1.1, spring: 1.0, summer: 1.05, fall: 1.0 } },
    { key: 'driveability', name: 'Driveability / Misfire Diagnosis', bookHours: 2.4, parts: { supplies: 2 },
      bays: ['diag'], tags: ['diagpro'], certs: [], skill: 'diagnostics', difficulty: 4, weight: 5, upsell: false,
      season: { winter: 1.2, spring: 1.0, summer: 1.0, fall: 1.0 } },
    { key: 'parasitic', name: 'Electrical / Parasitic Draw Diagnosis', bookHours: 2.6, parts: { supplies: 2 },
      bays: ['diag'], tags: ['electrical'], certs: [], skill: 'diagnostics', difficulty: 4, weight: 4, upsell: false,
      season: { winter: 1.3, spring: 0.95, summer: 1.0, fall: 0.95 } },
    { key: 'program', name: 'Module Programming / Key Coding', bookHours: 1.6, parts: { supplies: 1 },
      bays: ['diag'], tags: ['program'], certs: [], skill: 'diagnostics', difficulty: 4, weight: 3, upsell: true,
      season: { winter: 1.0, spring: 1.0, summer: 1.0, fall: 1.0 } },
    { key: 'cooling', name: 'Water Pump & Coolant Service', bookHours: 3.4, parts: { cooling: 1, fluids: 1, supplies: 1 },
      bays: ['general'], tags: ['cooling'], certs: [], skill: 'engine', difficulty: 3, weight: 6, upsell: false,
      season: { winter: 1.1, spring: 0.95, summer: 1.45, fall: 0.95 } },
    { key: 'timing', name: 'Timing Belt / Chain Service', bookHours: 5.6, parts: { engine: 2, cooling: 1, supplies: 2 },
      bays: ['general'], tags: ['engine'], certs: [], skill: 'engine', difficulty: 5, weight: 3, upsell: false,
      season: { winter: 0.95, spring: 1.05, summer: 1.1, fall: 1.0 } },
    { key: 'fuel', name: 'Fuel System & Injector Service', bookHours: 3.0, parts: { engine: 1, supplies: 2 },
      bays: ['general'], tags: ['fuel'], certs: [], skill: 'engine', difficulty: 4, weight: 3, upsell: false,
      season: { winter: 1.2, spring: 1.0, summer: 0.95, fall: 1.0 } },
    { key: 'acrecharge', name: 'A/C Performance Service & Recharge', bookHours: 1.5, parts: { hvac: 1, supplies: 1 },
      bays: ['general'], tags: ['hvac'], certs: ['hvac'], skill: 'hvac', difficulty: 2, weight: 6, upsell: true,
      season: { winter: 0.35, spring: 1.3, summer: 2.4, fall: 0.6 } },
    { key: 'accomp', name: 'A/C Compressor Replacement', bookHours: 4.2, parts: { hvac: 2, engine: 1, supplies: 2 },
      bays: ['general'], tags: ['hvac'], certs: ['hvac'], skill: 'hvac', difficulty: 4, weight: 3, upsell: false,
      season: { winter: 0.25, spring: 1.2, summer: 2.6, fall: 0.5 } },
    { key: 'struts', name: 'Strut Assembly Replacement (pair)', bookHours: 3.1, parts: { suspension: 2, supplies: 1 },
      bays: ['general'], tags: ['suspension'], certs: [], skill: 'suspension', difficulty: 3, weight: 5, upsell: false,
      season: { winter: 1.05, spring: 1.25, summer: 0.95, fall: 1.0 } },
    { key: 'steering', name: 'Tie Rods / Ball Joints & Alignment', bookHours: 2.6, parts: { suspension: 1, supplies: 1 },
      bays: ['general'], tags: ['suspension'], certs: [], skill: 'suspension', difficulty: 3, weight: 4, upsell: true,
      season: { winter: 1.15, spring: 1.2, summer: 0.9, fall: 1.0 } },
    { key: 'trans', name: 'Transmission Fluid & Filter Service', bookHours: 1.5, parts: { fluids: 2, supplies: 1 },
      bays: ['general'], tags: [], certs: [], skill: 'maintenance', difficulty: 2, weight: 5, upsell: true,
      season: { winter: 1.0, spring: 1.0, summer: 1.1, fall: 1.0 } },
    { key: 'exhaust', name: 'Exhaust & Catalytic Repair', bookHours: 2.7, parts: { engine: 1, supplies: 2 },
      bays: ['general'], tags: [], certs: [], skill: 'engine', difficulty: 3, weight: 3, upsell: false,
      season: { winter: 1.2, spring: 1.0, summer: 0.9, fall: 1.0 } },
    { key: 'hd', name: 'Heavy-Duty Truck Service (3/4 & 1-Ton)', bookHours: 3.6, parts: { fluids: 2, brakes: 1, supplies: 2 },
      bays: ['align', 'general'], tags: ['hd'], certs: ['diesel'], skill: 'engine', difficulty: 4, weight: 4, upsell: false,
      season: { winter: 1.2, spring: 1.05, summer: 1.0, fall: 1.1 } },
    { key: 'adas', name: 'ADAS Camera & Radar Calibration', bookHours: 1.7, parts: { supplies: 1 },
      bays: ['align'], tags: ['adas'], certs: ['adas'], skill: 'diagnostics', difficulty: 4, weight: 5, upsell: true,
      season: { winter: 1.1, spring: 1.05, summer: 1.0, fall: 1.0 } },
    { key: 'evservice', name: 'EV / Hybrid HV System Service', bookHours: 3.2, parts: { electrical: 2, supplies: 2 },
      bays: ['general'], tags: ['ev'], certs: ['ev'], skill: 'electrical', difficulty: 5, weight: 4, upsell: false,
      season: { winter: 1.25, spring: 1.0, summer: 1.05, fall: 1.0 } },
    { key: 'evdiag', name: 'EV Battery & Inverter Diagnosis', bookHours: 2.8, parts: { supplies: 2 },
      bays: ['diag'], tags: ['evdiag'], certs: ['ev'], skill: 'diagnostics', difficulty: 5, weight: 3, upsell: false,
      season: { winter: 1.3, spring: 1.0, summer: 1.0, fall: 1.0 } }
  ];

  /* ------------------------------------------------------------------ *
   * Technician skills, training, certifications
   * ------------------------------------------------------------------ */
  var SKILL_AREAS = [
    { key: 'maintenance', name: 'Maintenance & Service' },
    { key: 'brakes', name: 'Brakes' },
    { key: 'suspension', name: 'Suspension & Steering' },
    { key: 'tires', name: 'Tires & Alignment' },
    { key: 'electrical', name: 'Electrical' },
    { key: 'engine', name: 'Engine & Drivetrain' },
    { key: 'hvac', name: 'HVAC' },
    { key: 'diagnostics', name: 'Diagnostics' }
  ];

  var CERTS = {
    hvac: { key: 'hvac', name: 'EPA 609 / ASE A7 (HVAC)' },
    diesel: { key: 'diesel', name: 'ASE A9 Light Diesel' },
    adas: { key: 'adas', name: 'ADAS Calibration Certification' },
    ev: { key: 'ev', name: 'HV / EV Safety Certification' }
  };

  /*
   * Technician training courses.
   * days   - technician is out of the shop this many days
   * effect - what it grants
   */
  var TECH_TRAINING = [
    { key: 't_maint', name: 'Lube, Tire & Maintenance Certification', cost: 900, days: 1,
      skill: 'maintenance', gain: 1, note: 'Fundamentals. Fastest payback for a new hire.' },
    { key: 't_brakes', name: 'ASE A5 Brakes & ABS', cost: 1600, days: 2,
      skill: 'brakes', gain: 1, note: 'Brake work is your bread and butter. Make it fast and clean.' },
    { key: 't_susp', name: 'ASE A4 Steering & Suspension', cost: 1700, days: 2,
      skill: 'suspension', gain: 1, note: 'Strut and steering work, plus better alignment sales.' },
    { key: 't_tires', name: 'TIA Advanced Tire & Alignment', cost: 1400, days: 2,
      skill: 'tires', gain: 1, note: 'Road-force balancing and alignment angles.' },
    { key: 't_elec', name: 'ASE A6 Electrical / Electronic Systems', cost: 2200, days: 3,
      skill: 'electrical', gain: 1, note: 'Charging, starting, body electrical.' },
    { key: 't_engine', name: 'ASE A1 Engine Repair', cost: 2400, days: 3,
      skill: 'engine', gain: 1, note: 'Timing, cooling, internal engine work.' },
    { key: 't_hvac', name: 'EPA 609 + ASE A7 HVAC', cost: 1500, days: 2,
      skill: 'hvac', gain: 1, cert: 'hvac', note: 'Required to legally handle refrigerant.' },
    { key: 't_diag', name: 'Advanced Driveability & Scan Data', cost: 3200, days: 4,
      skill: 'diagnostics', gain: 1, note: 'The highest-margin skill in the building.' },
    { key: 't_diesel', name: 'ASE A9 Light Diesel', cost: 2600, days: 3,
      skill: 'engine', gain: 1, cert: 'diesel', note: 'Opens up the truck crowd.' },
    { key: 't_adas', name: 'ADAS Calibration Certification', cost: 3400, days: 3,
      skill: 'diagnostics', gain: 1, cert: 'adas', note: 'Every windshield and alignment becomes a calibration.' },
    { key: 't_ev', name: 'HV / EV Safety & Service Certification', cost: 4200, days: 4,
      skill: 'electrical', gain: 1, cert: 'ev', note: 'The work nobody in town can do yet.' },
    { key: 't_lean', name: 'Lean Workflow & Flat-Rate Efficiency', cost: 2000, days: 2,
      efficiency: 0.08, note: 'Turns book hours into billed hours faster. +8% productivity.' },
    { key: 't_quality', name: 'Comeback Prevention & Quality Control', cost: 1800, days: 2,
      quality: 0.10, note: 'Fewer comebacks, better reviews. +10% quality.' }
  ];

  /*
   * Service advisor training tracks. Each level costs more and does less,
   * exactly like real sales training.
   */
  var ADVISOR_TRACKS = [
    { key: 'phone', name: 'Phone Skills & Appointment Setting', max: 5,
      baseCost: 1200, costStep: 700,
      effect: 'capacity', per: 2.2,
      note: '+2.2 customers handled per day per level. Fewer calls go to voicemail.' },
    { key: 'menu', name: 'Menu Presentation & Value Building', max: 5,
      baseCost: 1600, costStep: 900,
      effect: 'close', per: 0.035,
      note: '+3.5% closing ratio per level. Presenting good/better/best instead of a price.' },
    { key: 'dvi', name: 'Digital Vehicle Inspection Presentation', max: 5,
      baseCost: 1900, costStep: 1100,
      effect: 'upsell', per: 0.055,
      note: '+5.5% chance of additional sold work per level. Photos sell what words cannot.' },
    { key: 'objection', name: 'Objection Handling & Price Framing', max: 5,
      baseCost: 1800, costStep: 1000,
      effect: 'priceTolerance', per: 0.055,
      note: 'Customers tolerate 5.5% higher pricing per level before walking.' },
    { key: 'followup', name: 'Declined Service Follow-Up', max: 5,
      baseCost: 1400, costStep: 800,
      effect: 'recapture', per: 0.05,
      note: 'Recaptures 5% per level of the work customers declined earlier.' },
    { key: 'csi', name: 'CSI, Handoff & Retention', max: 5,
      baseCost: 1500, costStep: 850,
      effect: 'csi', per: 0.09,
      note: '+0.09 stars of customer satisfaction per level, and better retention.' }
  ];

  /* ------------------------------------------------------------------ *
   * Advertising channels
   *
   * maxLeads   - the most opportunities per day this channel can ever give
   * halfSpend  - daily spend that gets you ~63% of maxLeads (saturation)
   * intent     - multiplier on closing ratio for leads from this channel
   * decay      - adstock carryover; 0.9 means yesterday's awareness mostly holds
   * lag        - days before spend starts producing
   * aro        - multiplier on the size of the repair order it produces
   * ------------------------------------------------------------------ */
  var AD_CHANNELS = [
    { key: 'lsa', name: 'Google Local Services & Search Ads', maxLeads: 15, halfSpend: 130,
      intent: 1.18, decay: 0.35, lag: 0, aro: 1.05, minSpend: 20,
      note: 'Highest intent in town: they are searching "brake repair near me" right now.' },
    { key: 'meta', name: 'Meta / Instagram Local Campaign', maxLeads: 12, halfSpend: 95,
      intent: 0.86, decay: 0.62, lag: 1, aro: 0.92, minSpend: 15,
      note: 'Cheap reach, weaker intent. Great for coupons and brand recall.' },
    { key: 'mail', name: 'Direct Mail (oil change coupon)', maxLeads: 9, halfSpend: 210,
      intent: 0.78, decay: 0.80, lag: 3, aro: 0.80, minSpend: 60,
      note: 'Slow to hit, sticks around for weeks. Brings price shoppers who become regulars.' },
    { key: 'radio', name: 'Radio & Streaming Audio', maxLeads: 8, halfSpend: 260,
      intent: 0.70, decay: 0.90, lag: 2, aro: 1.0, minSpend: 75,
      note: 'Pure awareness. Does almost nothing for a month, then everyone knows your name.' },
    { key: 'seo', name: 'Website & Local SEO Retainer', maxLeads: 14, halfSpend: 90,
      intent: 1.10, decay: 0.965, lag: 5, aro: 1.08, minSpend: 25,
      note: 'Compounds. The slowest lever to move and the hardest for competitors to take away.' },
    { key: 'community', name: 'Community Sponsorship & Events', maxLeads: 5, halfSpend: 120,
      intent: 0.95, decay: 0.93, lag: 4, aro: 1.02, minSpend: 25,
      note: 'Little league banners and church bulletins. Slow burn, builds real reputation.' },
    { key: 'referral', name: 'Referral & Loyalty Program', maxLeads: 7, halfSpend: 85,
      intent: 1.25, decay: 0.75, lag: 1, aro: 1.06, minSpend: 15,
      note: 'Pays your existing customers to bring you new ones. Scales with your customer base.' }
  ];

  /* ------------------------------------------------------------------ *
   * Facility upgrades
   * ------------------------------------------------------------------ */
  var UPGRADES = [
    { key: 'parking', name: 'Pave & Stripe Additional Parking', cost: 12000, days: 4, repeatable: true,
      effect: { parking: 6 }, note: '+6 parking spaces. Cars you cannot park are cars you cannot fix.' },
    { key: 'shelving', name: 'Parts Room Shelving & Racking', cost: 6500, days: 2, repeatable: true,
      effect: { storage: 60 }, note: '+60 units of parts storage.' },
    { key: 'lobby', name: 'Customer Lounge Remodel', cost: 18000, days: 5, repeatable: false,
      effect: { csi: 0.18, close: 0.03 }, note: 'Coffee, wifi, clean bathroom. Customers wait happier and buy more.' },
    { key: 'loaners', name: 'Loaner Car Fleet (3 vehicles)', cost: 42000, days: 3, repeatable: false,
      effect: { csi: 0.22, close: 0.06, waitTolerance: 1.2 }, upkeep: 38,
      note: 'Kills the "I need it back today" objection. $38/day to run.' },
    { key: 'shuttle', name: 'Courtesy Shuttle', cost: 16000, days: 2, repeatable: false,
      effect: { csi: 0.10, close: 0.03, waitTolerance: 0.5 }, upkeep: 22,
      note: 'Cheaper than loaners, half the benefit.' },
    { key: 'dvi', name: 'Digital Vehicle Inspection Tablets', cost: 7800, days: 1, repeatable: false,
      effect: { upsell: 0.10, csi: 0.08 }, upkeep: 9,
      note: 'Photos and videos of the actual problem. Single biggest ARO lever in the shop.' },
    { key: 'sms', name: 'Shop Management Software & Two-Way Texting', cost: 9500, days: 2, repeatable: false,
      effect: { advisorCapacity: 4, csi: 0.06, close: 0.02 }, upkeep: 14,
      note: 'Advisors stop drowning in phone calls. +4 customers/day per advisor.' },
    { key: 'financing', name: 'Customer Financing Program', cost: 4500, days: 1, repeatable: false,
      effect: { close: 0.05, aro: 0.07, priceTolerance: 0.06 }, upkeep: 11,
      note: 'Turns a $2,100 estimate into $89/month. Big repairs stop getting declined.' },
    { key: 'nightdrop', name: 'Night Drop & Early-Bird Key Box', cost: 3200, days: 1, repeatable: false,
      effect: { throughputStart: 0.6 }, note: 'Cars are on the lift at 7am instead of 9am.' },
    { key: 'signage', name: 'Lighted Building Sign & Road Banner', cost: 14000, days: 3, repeatable: false,
      effect: { organic: 2.2 }, note: '+2.2 walk-ins per day, forever. Cheapest permanent traffic.' },
    { key: 'secondshift', name: 'Second Shift Lighting & Security', cost: 11000, days: 3, repeatable: false,
      effect: { shiftHours: 2 }, upkeep: 26,
      note: 'Lets you schedule technicians up to 10 hours a day.' }
  ];

  /* ------------------------------------------------------------------ *
   * Fixed operating costs (monthly, charged daily as 1/30th)
   * ------------------------------------------------------------------ */
  var FIXED_COSTS = {
    rent: 7200,
    utilities: 1650,
    insurance: 1150,
    software: 480,
    misc: 750
  };

  var FINANCE = {
    startingCash: 42000,
    creditLimit: 75000,
    apr: 0.095,
    payrollTaxRate: 0.121,
    incomeTaxRate: 0.21,
    advisorCommissionOnGP: 0.05,
    techGuaranteeHours: 6,   // paid whether or not there is work
    warrantyReserveRate: 0.012
  };

  /* ------------------------------------------------------------------ *
   * Calendar
   * ------------------------------------------------------------------ */
  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // Index matches DAY_NAMES. Sunday closed.
  var DOW_TRAFFIC = [1.16, 1.05, 1.0, 1.02, 1.12, 0.72, 0];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  // Seasonality of total repair demand by month index.
  var MONTH_TRAFFIC = [0.98, 0.94, 1.05, 1.08, 1.06, 1.04, 1.02, 1.03, 1.07, 1.10, 1.02, 0.92];
  var MONTH_SEASON = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];

  /* ------------------------------------------------------------------ *
   * Random events
   * weight - relative chance; `test` gates when it can fire
   * ------------------------------------------------------------------ */
  var EVENTS = [
    { key: 'coldsnap', name: 'Hard Freeze Warning', weight: 6, season: ['winter'],
      text: 'A hard freeze rolls in overnight. Half the town has a dead battery in the driveway.',
      effect: { trafficMult: 1.35, jobBoost: { battery: 3.0, charging: 1.8 }, days: 2 } },
    { key: 'heatwave', name: 'Heat Wave', weight: 6, season: ['summer'],
      text: 'Triple digits all week. Every A/C in a ten-mile radius just gave up.',
      effect: { trafficMult: 1.28, jobBoost: { acrecharge: 2.4, accomp: 2.0 }, days: 3 } },
    { key: 'potholes', name: 'Pothole Season', weight: 5, season: ['winter', 'spring'],
      text: 'The freeze-thaw cycle destroyed Route 9. Bent wheels and blown struts everywhere.',
      effect: { trafficMult: 1.22, jobBoost: { struts: 2.2, align: 2.4, tires4: 1.6, steering: 1.8 }, days: 3 } },
    { key: 'roadtrip', name: 'Holiday Travel Rush', weight: 4, season: ['summer', 'fall'],
      text: 'Everyone suddenly wants their car "checked over" before a long drive.',
      effect: { trafficMult: 1.30, jobBoost: { oil: 1.5, inspection: 1.8, cooling: 1.5 }, days: 2 } },
    { key: 'competitor_open', name: 'National Chain Opens Across Town', weight: 3,
      text: 'A big-box chain opened on the highway with $19.99 oil changes and a wall of TV ads.',
      effect: { trafficMult: 0.80, days: 10 } },
    { key: 'competitor_close', name: 'Competitor Closes Its Doors', weight: 2,
      text: 'The shop on 4th Street retired and closed. Their customers need a new home.',
      effect: { trafficMult: 1.20, customerBase: 40, days: 14 } },
    { key: 'fleet_offer', name: 'Fleet Account Opportunity', weight: 3, minDay: 25,
      text: 'A local plumbing company wants a fleet contract: 14 vans, discounted labor, steady work.',
      choice: 'fleet' },
    { key: 'viral_review', name: 'A Review Goes Viral', weight: 3, minRep: 4.4,
      text: 'A customer posted a glowing review with photos of your digital inspection. It spread.',
      effect: { reputationBump: 0.12, trafficMult: 1.18, days: 6 } },
    { key: 'bad_review', name: 'Angry One-Star Review', weight: 4, maxRep: 4.3,
      text: 'A customer who waited three days for a part left a very public one-star review.',
      effect: { reputationBump: -0.15, trafficMult: 0.9, days: 5 } },
    { key: 'tool_break', name: 'Equipment Failure', weight: 4,
      text: 'A lift failed inspection. That bay is red-tagged until the repair is paid for.',
      effect: { bayDown: 1, days: 2, cost: 3800 } },
    { key: 'supplier_backorder', name: 'Supplier Backorder', weight: 4,
      text: 'Your warehouse distributor is backordered. Deliveries run a day late this week.',
      effect: { orderDelay: 1, days: 5 } },
    { key: 'tech_poached', name: 'A Competitor Is Recruiting', weight: 4, minDay: 30,
      text: 'The dealership is dangling a signing bonus at one of your technicians.',
      choice: 'poach' },
    { key: 'insurance_hike', name: 'Insurance Renewal', weight: 3, minDay: 45,
      text: 'Your garage-keepers policy renewed. The premium went up.',
      effect: { insuranceDelta: 220 } },
    { key: 'walkin_fleet', name: 'Municipal Bid Won', weight: 2, minDay: 60,
      text: 'The city awarded you their light-vehicle maintenance bid for the month.',
      effect: { trafficMult: 1.15, customerBase: 25, days: 20 } }
  ];

  /* Hiring pool name banks. */
  var FIRST_NAMES = ['Marcus', 'Dana', 'Luis', 'Tasha', 'Kyle', 'Priya', 'Ray', 'Jo',
    'Devon', 'Ingrid', 'Omar', 'Casey', 'Hank', 'Renee', 'Tyrell', 'Micah',
    'Sasha', 'Curtis', 'Nadia', 'Bo', 'Elena', 'Wes', 'Farrah', 'Dale'];
  var LAST_NAMES = ['Alvarez', 'Boone', 'Chandra', 'Doyle', 'Ellison', 'Fontaine',
    'Grady', 'Hollis', 'Ibarra', 'Jessup', 'Kowalski', 'Lemieux', 'Mbeki',
    'Novak', 'Okafor', 'Pratt', 'Quintero', 'Rasmussen', 'Silva', 'Tran',
    'Ueda', 'Vance', 'Whitaker', 'Yarborough'];

  var MILESTONES = [
    { key: 'first10k', name: 'First $10,000 Week', test: function (s) { return s.stats.bestWeekRevenue >= 10000; } },
    { key: 'fourstar', name: '4.5 Stars', test: function (s) { return s.reputation >= 4.5 && s.reviewCount >= 25; } },
    { key: 'sixbays', name: 'Six Bays Under Roof', test: function (s) { return s.bays.length >= 6; } },
    { key: 'aro600', name: '$600 Average Repair Order', test: function (s) { return s.stats.aro30 >= 600; } },
    { key: 'hundredk', name: '$100,000 in the Bank', test: function (s) { return s.cash >= 100000; } },
    { key: 'evshop', name: 'The Only EV Shop In Town', test: function (s) {
      return s.techs.some(function (t) { return t.certs.indexOf('ev') >= 0; }) &&
        s.bays.some(function (b) { return b.type === 'general' && b.toolLevel >= 5; });
    } },
    { key: 'thousandcars', name: '1,000 Cars Serviced', test: function (s) { return s.stats.carsServed >= 1000; } },
    { key: 'milliondollar', name: '$1,000,000 Annual Run Rate', test: function (s) { return s.stats.revenue30 * 12 >= 1000000; } }
  ];

  var DATA = {
    TOWN: TOWN,
    PART_CATEGORIES: PART_CATEGORIES,
    SUPPLIERS: SUPPLIERS,
    ORDER_PROGRAMS: ORDER_PROGRAMS,
    HOTSHOT_MULT: HOTSHOT_MULT,
    BAY_TYPES: BAY_TYPES,
    TOOL_PACKAGES: TOOL_PACKAGES,
    JOBS: JOBS,
    SKILL_AREAS: SKILL_AREAS,
    CERTS: CERTS,
    TECH_TRAINING: TECH_TRAINING,
    ADVISOR_TRACKS: ADVISOR_TRACKS,
    AD_CHANNELS: AD_CHANNELS,
    UPGRADES: UPGRADES,
    FIXED_COSTS: FIXED_COSTS,
    FINANCE: FINANCE,
    DAY_NAMES: DAY_NAMES,
    DOW_TRAFFIC: DOW_TRAFFIC,
    MONTH_NAMES: MONTH_NAMES,
    MONTH_TRAFFIC: MONTH_TRAFFIC,
    MONTH_SEASON: MONTH_SEASON,
    EVENTS: EVENTS,
    FIRST_NAMES: FIRST_NAMES,
    LAST_NAMES: LAST_NAMES,
    MILESTONES: MILESTONES
  };

  DATA.jobByKey = {};
  JOBS.forEach(function (j) { DATA.jobByKey[j.key] = j; });
  DATA.partByKey = {};
  PART_CATEGORIES.forEach(function (p) { DATA.partByKey[p.key] = p; });

  root.AutoShopData = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
