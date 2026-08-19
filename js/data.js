/*
 * Static catalogs: jobs, equipment, staff templates, training, upgrades,
 * marketing channels, random events and the global balance constants.
 * Nothing in here mutates during play.
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  /* ---------------------------------------------------------------- config */

  var CONFIG = {
    startDateMonth: 2,          // 0-indexed: March
    startDateDay: 2,
    shopOpenHour: 8,
    marketLaborRate: 142,       // what the shop across town charges per hour
    marketPartsMarkup: 0.48,
    laborRateMin: 60,
    laborRateMax: 260,
    partsMarkupMin: 0.05,
    partsMarkupMax: 1.20,
    diagFeeMin: 0,
    diagFeeMax: 260,
    payrollTaxRate: 0.098,      // employer side: FICA, unemployment, comp
    incomeTaxRate: 0.21,
    loanInterestApr: 0.115,
    lineOfCreditApr: 0.229,
    baseWalkInTraffic: 4.2,     // people who find you with zero marketing
    signageTraffic: 1.4,
    repeatVisitRate: 0.011,     // share of the retained customer base per day
    retentionBase: 0.34,
    customerDecay: 0.004,
    reputationInertia: 0.055,
    priceElasticity: 1.55,
    comebackBase: 0.055,
    partsLeadTimeDays: 1,
    emergencyPartsPremium: 0.35,
    emergencyPartsDelayHours: 1.4,
    overtimeMultiplier: 1.5,
    maxShiftHours: 11,
    inventoryHoldingCostRate: 0.00035,  // shrink/obsolescence per day
    quarterlyRentEscalator: 0.0,
    startingParkingSpaces: 12,
    parkingSpaceCost: 3200,
    bayBuildCost: 46000,
    weekLength: 7
  };

  var DIFFICULTY = {
    easy: {
      id: 'easy', label: 'Owner-Operator (Easy)', cash: 68000, loan: 0,
      demandMult: 1.15, costMult: 0.92, repStart: 3.6,
      note: 'You bought a shop with a book of business. Forgiving costs.'
    },
    normal: {
      id: 'normal', label: 'First Shop (Normal)', cash: 45000, loan: 60000,
      demandMult: 1.0, costMult: 1.0, repStart: 3.0,
      note: 'SBA loan on the building, three bays, and something to prove.'
    },
    hard: {
      id: 'hard', label: 'Turnaround (Hard)', cash: 22000, loan: 95000,
      demandMult: 0.86, costMult: 1.09, repStart: 2.2,
      note: 'The previous owner burned the reputation and left the debt.'
    }
  };

  /* Monthly demand curves, January .. December. */
  var SEASON = {
    flat:      [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
    summer:    [0.45, 0.50, 0.70, 1.05, 1.45, 1.95, 2.20, 2.05, 1.35, 0.85, 0.55, 0.45],
    winter:    [1.85, 1.65, 1.15, 0.80, 0.60, 0.50, 0.50, 0.55, 0.75, 1.15, 1.55, 1.90],
    roadtrip:  [0.75, 0.80, 1.00, 1.20, 1.35, 1.45, 1.40, 1.20, 1.05, 0.95, 1.10, 1.15],
    tires:     [1.25, 1.05, 0.95, 0.95, 0.90, 0.90, 0.95, 0.95, 1.05, 1.55, 1.85, 1.40],
    inspect:   [1.30, 0.95, 1.05, 0.95, 1.00, 1.00, 0.95, 1.05, 1.00, 0.95, 1.00, 1.30]
  };

  /* --------------------------------------------------------------- tooling */
  /* Level 0 means "not installed". speed multiplies job throughput. */

  var TOOLS = {
    lift: {
      id: 'lift', name: 'Vehicle Lift', short: 'Lift',
      desc: 'Nothing happens under a car sitting on the ground.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: '2-Post 9,000 lb', cost: 4600, speed: 1.00 },
        { label: '4-Post + Rolling Jacks', cost: 9200, speed: 1.09 },
        { label: 'Heavy-Duty 12,000 lb', cost: 16500, speed: 1.16 }
      ]
    },
    handtools: {
      id: 'handtools', name: 'Air & Power Tools', short: 'Tools',
      desc: 'Impacts, torque tools, lighting, a compressor that keeps up.',
      levels: [
        { label: 'Borrowed Hand Tools', cost: 0, speed: 0.86 },
        { label: 'Basic Air Setup', cost: 3100, speed: 1.00 },
        { label: 'Cordless + Torque Kit', cost: 6400, speed: 1.08 },
        { label: 'Full Pro Cart & Lighting', cost: 11800, speed: 1.15 }
      ]
    },
    scanner: {
      id: 'scanner', name: 'Diagnostic Scanner', short: 'Scan',
      desc: 'Code readers guess. Bidirectional scan tools diagnose.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: 'Generic OBD-II Reader', cost: 1200, speed: 0.90 },
        { label: 'Bidirectional Scan Tool', cost: 7400, speed: 1.10 },
        { label: 'OEM Software + Scope', cost: 18500, speed: 1.24 }
      ]
    },
    tire: {
      id: 'tire', name: 'Tire Changer & Balancer', short: 'Tire',
      desc: 'Tires are a loss leader that fills the lot with future work.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: 'Manual Changer', cost: 5200, speed: 0.94 },
        { label: 'Touchless + Road Force', cost: 15800, speed: 1.18 }
      ]
    },
    align: {
      id: 'align', name: 'Alignment Rack', short: 'Align',
      desc: 'The highest-margin hour in the building once it is paid off.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: 'Used Rack + Camera', cost: 15800, speed: 1.00 },
        { label: 'Imaging Rack w/ ADAS Prep', cost: 36000, speed: 1.22 }
      ]
    },
    ac: {
      id: 'ac', name: 'A/C Recovery Machine', short: 'A/C',
      desc: 'Pays for itself in one July if you let it.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: 'R-134a Machine', cost: 4300, speed: 1.00 },
        { label: 'Dual R-134a / R-1234yf', cost: 11200, speed: 1.14 }
      ]
    },
    press: {
      id: 'press', name: 'Press & Specialty Tools', short: 'Press',
      desc: 'Bearings, bushings, pullers, engine support.',
      levels: [
        { label: 'None', cost: 0, speed: 0.0 },
        { label: '20-Ton Press + Pullers', cost: 3800, speed: 1.00 },
        { label: 'Full Specialty Wall', cost: 9600, speed: 1.12 }
      ]
    }
  };

  var TOOL_ORDER = ['lift', 'handtools', 'scanner', 'tire', 'align', 'ac', 'press'];

  /* ------------------------------------------------------------------ jobs */
  /*
   * bookHours  - what the labor guide says, and what the customer is billed
   * partsCost  - your cost, before markup
   * requires   - minimum installed tool level to perform the job at all
   * skill      - specialty tag; techs are faster inside their specialty
   * weight     - relative frequency among all incoming work
   * ticket     - 'quick' jobs are expected back same day, 'major' are not
   */
  var JOBS = [
    { id: 'oil_change', name: 'Oil & Filter Service', cat: 'fluids', skill: 'general',
      bookHours: 0.5, partsCost: 26, requires: { lift: 1, handtools: 0 }, weight: 20,
      season: 'flat', ticket: 'quick', gateway: true, sensitivity: 1.45 },

    { id: 'tire_rotation', name: 'Tire Rotation & Balance', cat: 'tires', skill: 'tires',
      bookHours: 0.6, partsCost: 4, requires: { lift: 1, tire: 1 }, weight: 8,
      season: 'tires', ticket: 'quick', gateway: true, sensitivity: 1.35 },

    { id: 'state_inspection', name: 'State Safety Inspection', cat: 'misc', skill: 'general',
      bookHours: 0.5, partsCost: 2, requires: { lift: 1 }, weight: 9,
      season: 'inspect', ticket: 'quick', gateway: true, sensitivity: 0.4,
      priceMode: 'fixed', fixedPrice: 32 },

    { id: 'wiper_blades', name: 'Wiper Blades', cat: 'misc', skill: 'general',
      bookHours: 0.2, partsCost: 24, requires: {}, weight: 3,
      season: 'winter', ticket: 'quick', sensitivity: 1.5 },

    { id: 'cabin_filter', name: 'Cabin & Engine Air Filters', cat: 'filters', skill: 'general',
      bookHours: 0.4, partsCost: 32, requires: {}, weight: 4,
      season: 'flat', ticket: 'quick', sensitivity: 1.5 },

    { id: 'brake_front', name: 'Front Brake Pads & Rotors', cat: 'brakes', skill: 'brakes',
      bookHours: 1.7, partsCost: 118, requires: { lift: 1, handtools: 1 }, weight: 12,
      season: 'flat', ticket: 'sameday', sensitivity: 1.15 },

    { id: 'brake_full', name: 'Four-Wheel Brake Job', cat: 'brakes', skill: 'brakes',
      bookHours: 3.0, partsCost: 236, requires: { lift: 1, handtools: 1 }, weight: 6,
      season: 'flat', ticket: 'sameday', sensitivity: 1.05 },

    { id: 'brake_fluid', name: 'Brake Fluid Exchange', cat: 'fluids', skill: 'brakes',
      bookHours: 0.8, partsCost: 34, requires: { lift: 1 }, weight: 4,
      season: 'flat', ticket: 'quick', sensitivity: 1.3 },

    { id: 'battery', name: 'Battery Test & Replace', cat: 'batteries', skill: 'electrical',
      bookHours: 0.6, partsCost: 168, requires: {}, weight: 7,
      season: 'winter', ticket: 'quick', sensitivity: 1.25 },

    { id: 'alternator', name: 'Alternator Replacement', cat: 'electrical', skill: 'electrical',
      bookHours: 2.4, partsCost: 288, requires: { lift: 1, handtools: 1 }, weight: 4,
      season: 'flat', ticket: 'sameday', sensitivity: 0.95 },

    { id: 'starter', name: 'Starter Replacement', cat: 'electrical', skill: 'electrical',
      bookHours: 2.0, partsCost: 232, requires: { lift: 1, handtools: 1 }, weight: 4,
      season: 'winter', ticket: 'sameday', sensitivity: 0.95 },

    { id: 'check_engine', name: 'Check Engine Diagnosis', cat: 'misc', skill: 'electrical',
      bookHours: 1.0, partsCost: 0, requires: { scanner: 1 }, weight: 11,
      season: 'flat', ticket: 'quick', diag: true, sensitivity: 1.1 },

    { id: 'o2_sensor', name: 'Oxygen Sensor', cat: 'electrical', skill: 'electrical',
      bookHours: 1.1, partsCost: 124, requires: { lift: 1, scanner: 1 }, weight: 3,
      season: 'flat', ticket: 'sameday', sensitivity: 1.0 },

    { id: 'evap_diag', name: 'EVAP Leak Diagnosis', cat: 'misc', skill: 'electrical',
      bookHours: 1.5, partsCost: 6, requires: { scanner: 2 }, weight: 3,
      season: 'flat', ticket: 'sameday', diag: true, sensitivity: 1.0 },

    { id: 'spark_plugs', name: 'Spark Plugs & Coils', cat: 'engine', skill: 'engine',
      bookHours: 1.9, partsCost: 148, requires: { handtools: 1 }, weight: 5,
      season: 'flat', ticket: 'sameday', sensitivity: 1.05 },

    { id: 'serpentine', name: 'Serpentine Belt & Tensioner', cat: 'engine', skill: 'engine',
      bookHours: 1.1, partsCost: 86, requires: { lift: 1, handtools: 1 }, weight: 4,
      season: 'roadtrip', ticket: 'quick', sensitivity: 1.1 },

    { id: 'coolant_flush', name: 'Coolant Exchange', cat: 'fluids', skill: 'general',
      bookHours: 1.0, partsCost: 52, requires: { lift: 1 }, weight: 4,
      season: 'summer', ticket: 'quick', sensitivity: 1.3 },

    { id: 'radiator', name: 'Radiator Replacement', cat: 'engine', skill: 'engine',
      bookHours: 2.9, partsCost: 318, requires: { lift: 1, handtools: 1 }, weight: 3,
      season: 'summer', ticket: 'major', sensitivity: 0.9 },

    { id: 'water_pump', name: 'Water Pump', cat: 'engine', skill: 'engine',
      bookHours: 3.6, partsCost: 212, requires: { lift: 1, handtools: 1, press: 1 }, weight: 3,
      season: 'summer', ticket: 'major', sensitivity: 0.9 },

    { id: 'timing_belt', name: 'Timing Belt & Water Pump Kit', cat: 'engine', skill: 'engine',
      bookHours: 5.2, partsCost: 392, requires: { lift: 1, handtools: 2, press: 1 }, weight: 2,
      season: 'roadtrip', ticket: 'major', sensitivity: 0.85 },

    { id: 'head_gasket', name: 'Head Gasket / Major Engine', cat: 'engine', skill: 'engine',
      bookHours: 9.5, partsCost: 685, requires: { lift: 2, handtools: 2, press: 1 }, weight: 1,
      season: 'summer', ticket: 'major', sensitivity: 0.8 },

    { id: 'ac_service', name: 'A/C Evacuate & Recharge', cat: 'hvac', skill: 'hvac',
      bookHours: 1.4, partsCost: 96, requires: { ac: 1 }, weight: 6,
      season: 'summer', ticket: 'quick', sensitivity: 1.15 },

    { id: 'ac_compressor', name: 'A/C Compressor & Drier', cat: 'hvac', skill: 'hvac',
      bookHours: 3.8, partsCost: 468, requires: { lift: 1, ac: 1, handtools: 1 }, weight: 2,
      season: 'summer', ticket: 'major', sensitivity: 0.85 },

    { id: 'heater_core', name: 'Heater Core', cat: 'hvac', skill: 'hvac',
      bookHours: 6.5, partsCost: 248, requires: { lift: 1, handtools: 2 }, weight: 1,
      season: 'winter', ticket: 'major', sensitivity: 0.8 },

    { id: 'tires_set', name: 'Set of Four Tires', cat: 'tires', skill: 'tires',
      bookHours: 1.3, partsCost: 548, requires: { lift: 1, tire: 1 }, weight: 7,
      season: 'tires', ticket: 'sameday', sensitivity: 1.4 },

    { id: 'flat_repair', name: 'Flat Repair / TPMS', cat: 'tires', skill: 'tires',
      bookHours: 0.5, partsCost: 18, requires: { tire: 1 }, weight: 6,
      season: 'tires', ticket: 'quick', gateway: true, sensitivity: 1.45 },

    { id: 'alignment', name: 'Four-Wheel Alignment', cat: 'misc', skill: 'tires',
      bookHours: 1.2, partsCost: 8, requires: { align: 1 }, weight: 9,
      season: 'tires', ticket: 'quick', sensitivity: 1.2 },

    { id: 'struts', name: 'Struts & Shocks', cat: 'suspension', skill: 'brakes',
      bookHours: 3.6, partsCost: 432, requires: { lift: 1, handtools: 1, press: 1 }, weight: 3,
      season: 'flat', ticket: 'major', sensitivity: 0.9 },

    { id: 'wheel_bearing', name: 'Wheel Bearing / Hub', cat: 'suspension', skill: 'brakes',
      bookHours: 2.1, partsCost: 168, requires: { lift: 1, handtools: 1, press: 1 }, weight: 3,
      season: 'flat', ticket: 'sameday', sensitivity: 0.95 },

    { id: 'control_arm', name: 'Control Arm & Ball Joint', cat: 'suspension', skill: 'brakes',
      bookHours: 2.6, partsCost: 246, requires: { lift: 1, handtools: 1, press: 1 }, weight: 2,
      season: 'flat', ticket: 'sameday', sensitivity: 0.9 },

    { id: 'exhaust', name: 'Exhaust Repair', cat: 'exhaust', skill: 'general',
      bookHours: 1.6, partsCost: 152, requires: { lift: 1, handtools: 1 }, weight: 3,
      season: 'winter', ticket: 'sameday', sensitivity: 1.05 },

    { id: 'trans_service', name: 'Transmission Service', cat: 'fluids', skill: 'general',
      bookHours: 1.6, partsCost: 142, requires: { lift: 1 }, weight: 4,
      season: 'roadtrip', ticket: 'quick', sensitivity: 1.15 },

    { id: 'fuel_pump', name: 'Fuel Pump / Delivery', cat: 'engine', skill: 'engine',
      bookHours: 3.2, partsCost: 356, requires: { lift: 1, handtools: 1, scanner: 1 }, weight: 2,
      season: 'flat', ticket: 'major', sensitivity: 0.85 },

    { id: 'pre_purchase', name: 'Pre-Purchase Inspection', cat: 'misc', skill: 'general',
      bookHours: 1.0, partsCost: 0, requires: { lift: 1 }, weight: 3,
      season: 'roadtrip', ticket: 'quick', sensitivity: 1.2 }
  ];

  var JOBS_BY_ID = {};
  JOBS.forEach(function (j) { JOBS_BY_ID[j.id] = j; });

  /* Work a service writer can add once the car is already on the lift. */
  var UPSELLS = [
    'cabin_filter', 'wiper_blades', 'brake_fluid', 'coolant_flush', 'trans_service',
    'alignment', 'serpentine', 'brake_front', 'battery', 'flat_repair', 'spark_plugs'
  ];

  var PART_CATEGORIES = [
    { id: 'fluids', name: 'Fluids & Lubricants', volatility: 0.06 },
    { id: 'filters', name: 'Filters', volatility: 0.05 },
    { id: 'brakes', name: 'Brake Components', volatility: 0.09 },
    { id: 'tires', name: 'Tires & TPMS', volatility: 0.12 },
    { id: 'batteries', name: 'Batteries', volatility: 0.10 },
    { id: 'electrical', name: 'Electrical & Sensors', volatility: 0.11 },
    { id: 'engine', name: 'Engine & Cooling', volatility: 0.10 },
    { id: 'suspension', name: 'Steering & Suspension', volatility: 0.09 },
    { id: 'hvac', name: 'HVAC & Refrigerant', volatility: 0.14 },
    { id: 'exhaust', name: 'Exhaust', volatility: 0.08 },
    { id: 'misc', name: 'Shop Supplies & Misc', volatility: 0.05 }
  ];

  var BULK_TIERS = [
    { min: 6000, discount: 0.11, label: 'Pallet program -11%' },
    { min: 3000, discount: 0.075, label: 'Stocking order -7.5%' },
    { min: 1200, discount: 0.04, label: 'Volume order -4%' },
    { min: 0, discount: 0, label: 'Counter price' }
  ];

  /* ----------------------------------------------------------------- staff */

  var TECH_SPECIALTIES = ['general', 'brakes', 'engine', 'electrical', 'hvac', 'tires'];

  var TECH_TITLES = ['Lube Tech', 'B-Tech', 'A-Tech', 'Master Tech', 'Master Diagnostician'];

  var FIRST_NAMES = ['Marcus', 'Dana', 'Ruben', 'Kelsey', 'Ty', 'Priya', 'Omar', 'Jess',
    'Leo', 'Nadia', 'Cody', 'Imani', 'Sasha', 'Devon', 'Rosa', 'Hank', 'Mika', 'Cyrus',
    'Bianca', 'Grant', 'Tomas', 'Ada', 'Jules', 'Nico'];
  var LAST_NAMES = ['Alvarez', 'Boone', 'Castillo', 'Duval', 'Ellison', 'Farah', 'Gentry',
    'Hollis', 'Iyer', 'Jergens', 'Koval', 'Lindqvist', 'Mabry', 'Nakamura', 'Oyelaran',
    'Petrov', 'Quiroz', 'Rowe', 'Salas', 'Tran', 'Ubina', 'Vasquez', 'Whitlock', 'Zamora'];

  /* Hourly wage by tech level, before payroll tax. */
  var TECH_WAGE = [0, 19, 26, 34, 43, 52];
  /* Daily salary by writer level. */
  var WRITER_SALARY = [0, 165, 205, 250, 305, 365];

  var TECH_TRAINING = [
    { id: 'workflow', name: 'Shop Workflow & Efficiency', cost: 750, days: 1,
      effect: { efficiency: 0.05 }, desc: '+5% efficiency. One day out of the bay.' },
    { id: 'quality', name: 'Quality Control Discipline', cost: 680, days: 1,
      effect: { quality: 0.28 }, desc: 'Cuts this tech\'s comeback rate by 28%.' },
    { id: 'ase_brakes', name: 'ASE A5 - Brakes & Chassis', cost: 900, days: 2,
      effect: { spec: 'brakes', xp: 1 }, desc: 'Adds a brakes/suspension specialty.' },
    { id: 'ase_electrical', name: 'ASE A6 - Electrical Systems', cost: 1250, days: 3,
      effect: { spec: 'electrical', xp: 1 }, desc: 'Adds an electrical specialty.' },
    { id: 'ase_engine', name: 'ASE A8 - Engine Performance', cost: 1400, days: 3,
      effect: { spec: 'engine', xp: 1 }, desc: 'Adds an engine specialty.' },
    { id: 'ase_hvac', name: 'ASE A7 - Heating & A/C', cost: 950, days: 2,
      effect: { spec: 'hvac', xp: 1 }, desc: 'Adds an HVAC specialty (609 certified).' },
    { id: 'adv_diag', name: 'Advanced Driveability & Scope', cost: 2600, days: 4,
      effect: { xp: 2, efficiency: 0.04 }, minLevel: 3, requiresTool: { scanner: 2 },
      desc: 'Big level push. Needs a bidirectional scan tool in the shop.' },
    { id: 'ev_hybrid', name: 'EV / Hybrid High-Voltage Safety', cost: 3200, days: 4,
      effect: { xp: 2, efficiency: 0.03 }, minLevel: 3,
      desc: 'Opens the door to the newest cars in town.' }
  ];

  var WRITER_TRAINING = [
    { id: 'phone', name: 'Phone Skills & Appointment Setting', cost: 620, days: 1,
      effect: { capacity: 2 }, desc: 'Handles 2 more repair orders a day.' },
    { id: 'menu', name: 'Menu Selling', cost: 950, days: 1,
      effect: { upsell: 0.07 }, desc: '+7 points of upsell rate.' },
    { id: 'dvi', name: 'Digital Inspection Presentation', cost: 1350, days: 2,
      effect: { upsell: 0.09, close: 0.04 }, requiresUpgrade: 'dvi',
      desc: 'Photos and video sell the work. Needs DVI software.' },
    { id: 'objection', name: 'Objection Handling', cost: 1150, days: 2,
      effect: { close: 0.07 }, desc: '+7 points of closing ratio.' },
    { id: 'retention', name: 'Follow-Up & Retention Process', cost: 880, days: 1,
      effect: { retention: 0.06, csi: 0.15 }, desc: 'More customers come back.' },
    { id: 'fleet', name: 'Fleet & Commercial Prospecting', cost: 1600, days: 2,
      effect: { fleet: 0.035 }, desc: 'Daily chance to land a fleet account.' },
    { id: 'advisor_pro', name: 'Advanced Service Advisor Certification', cost: 2800, days: 3,
      effect: { xp: 1, close: 0.05, upsell: 0.05 }, minLevel: 3,
      desc: 'Levels the advisor up outright.' }
  ];

  /* --------------------------------------------------------------- upgrades */

  var UPGRADES = [
    { id: 'signage', name: 'Street Signage & Lighting', tiers: [
      { cost: 4200, upkeep: 2, label: 'Lit monument sign', traffic: 1.6 },
      { cost: 11000, upkeep: 5, label: 'LED marquee + wrap', traffic: 3.4 }
    ], desc: 'Pulls walk-in traffic off the road every single day.' },

    { id: 'lounge', name: 'Customer Lounge', tiers: [
      { cost: 5600, upkeep: 9, label: 'Clean seating, coffee, wifi', csi: 0.18, close: 0.03 },
      { cost: 14500, upkeep: 18, label: 'Workstations, glass to the shop', csi: 0.34, close: 0.06 }
    ], desc: 'Waiting customers who are comfortable approve more work.' },

    { id: 'dvi', name: 'Digital Vehicle Inspection Software', tiers: [
      { cost: 3900, upkeep: 14, label: 'DVI with photo/video', upsell: 0.08, csi: 0.12, trust: 0.04 }
    ], desc: 'Texting a photo of the cracked belt closes the job by itself.' },

    { id: 'sms', name: 'Shop Management System', tiers: [
      { cost: 4800, upkeep: 12, label: 'Cloud SMS + estimating', writerCapacity: 3, efficiency: 0.03 },
      { cost: 12500, upkeep: 26, label: 'SMS + integrated parts ordering', writerCapacity: 6, efficiency: 0.06, partsDiscount: 0.03 }
    ], desc: 'Fewer dropped calls, faster estimates, cleaner parts ordering.' },

    { id: 'booking', name: 'Online Booking & Review Requests', tiers: [
      { cost: 2600, upkeep: 8, label: 'Book online, auto review asks', leadConv: 0.08, repGain: 0.04 }
    ], desc: 'Converts more of the leads your marketing already paid for.' },

    { id: 'loaners', name: 'Loaner Fleet & Shuttle', tiers: [
      { cost: 9800, upkeep: 34, label: 'Two loaners + shuttle', majorClose: 0.10, csi: 0.16 },
      { cost: 24000, upkeep: 72, label: 'Five-car loaner fleet', majorClose: 0.18, csi: 0.28 }
    ], desc: 'The reason a customer says yes to a three-day job.' },

    { id: 'partsroom', name: 'Parts Room & Racking', tiers: [
      { cost: 3400, upkeep: 4, label: 'Racked stock room', capacity: 14000 },
      { cost: 8900, upkeep: 9, label: 'Organized warehouse + bin system', capacity: 34000, shrink: -0.4 }
    ], desc: 'Raises how much inventory you can hold without losing it.' },

    { id: 'training_room', name: 'In-House Training Program', tiers: [
      { cost: 7200, upkeep: 11, label: 'Training bench + subscriptions', trainingDiscount: 0.25, moraleGain: 0.02 }
    ], desc: 'Cuts course costs and keeps good techs from leaving.' },

    { id: 'warranty', name: '3-Year / 36k Nationwide Warranty', tiers: [
      { cost: 2900, upkeep: 16, label: 'Nationwide warranty program', close: 0.05, csi: 0.14, trust: 0.05 }
    ], desc: 'Removes the "what if it breaks again" objection.' }
  ];

  var UPGRADES_BY_ID = {};
  UPGRADES.forEach(function (u) { UPGRADES_BY_ID[u.id] = u; });

  /* -------------------------------------------------------------- marketing */
  /*
   * saturation - dollars per day beyond which spend mostly wastes
   * cpl        - dollars per lead at the efficient part of the curve
   * intent     - multiplier on closing ratio for leads from this channel
   * price      - how price-shoppy those leads are (>1 = cheaper crowd)
   */
  var CHANNELS = [
    { id: 'lsa', name: 'Google Local Services / Maps', saturation: 260, cpl: 34,
      intent: 1.16, price: 0.95, ticket: 1.05, mode: 'instant',
      desc: 'Highest intent clicks in town. Expensive and capped by search volume.' },
    { id: 'ppc', name: 'Search Ads (PPC)', saturation: 340, cpl: 27,
      intent: 1.05, price: 1.05, ticket: 1.0, mode: 'instant',
      desc: 'Turn it on, get cars. Turn it off, they stop the same day.' },
    { id: 'seo', name: 'SEO & Content', saturation: 120, cpl: 0,
      intent: 1.12, price: 0.98, ticket: 1.03, mode: 'stock', stockGain: 0.85, decay: 0.012,
      desc: 'Slow to build, compounds, and keeps producing after you stop paying.' },
    { id: 'social', name: 'Social & Community', saturation: 90, cpl: 46,
      intent: 0.9, price: 1.1, ticket: 0.95, mode: 'stock', stockGain: 0.5, decay: 0.05,
      repGain: 0.006,
      desc: 'Cheap reach, soft intent, small reputation tailwind.' },
    { id: 'mail', name: 'Direct Mail & Coupons', saturation: 220, cpl: 62,
      intent: 0.82, price: 1.35, ticket: 0.8, mode: 'delayed', delayDays: 4,
      desc: 'Fills bays with coupon shoppers. Watch your average ticket.' },
    { id: 'radio', name: 'Radio & Local Sponsorship', saturation: 200, cpl: 0,
      intent: 1.0, price: 1.0, ticket: 1.05, mode: 'brand', stockGain: 0.6, decay: 0.02,
      desc: 'Buys brand awareness that lifts every other channel.' },
    { id: 'referral', name: 'Referral & Loyalty Program', saturation: 110, cpl: 24,
      intent: 1.25, price: 0.88, ticket: 1.1, mode: 'referral',
      desc: 'Scales with your reputation and your existing customer base.' },
    { id: 'fleet_outreach', name: 'Fleet & Commercial Outreach', saturation: 150, cpl: 0,
      intent: 1.0, price: 0.9, ticket: 1.2, mode: 'fleet',
      desc: 'Buys a daily shot at a contract account that never price shops.' }
  ];

  var CHANNELS_BY_ID = {};
  CHANNELS.forEach(function (c) { CHANNELS_BY_ID[c.id] = c; });

  /* ---------------------------------------------------------------- weather */

  var WEATHER = [
    { id: 'clear', name: 'Clear', demand: 1.0, icon: '☀️' },
    { id: 'cloudy', name: 'Overcast', demand: 0.98, icon: '☁️' },
    { id: 'rain', name: 'Rain', demand: 0.87, icon: '🌧️', boost: { tires: 1.2, misc: 1.1 } },
    { id: 'heat', name: 'Heat Advisory', demand: 0.95, icon: '🔥', boost: { hvac: 2.1, engine: 1.4, fluids: 1.2 } },
    { id: 'cold', name: 'Hard Freeze', demand: 0.9, icon: '❄️', boost: { batteries: 2.4, electrical: 1.3, hvac: 1.3 } },
    { id: 'snow', name: 'Snow / Ice', demand: 0.62, icon: '🌨️', boost: { tires: 1.7, batteries: 1.5, suspension: 1.2 } },
    { id: 'storm', name: 'Severe Storms', demand: 0.55, icon: '⛈️', boost: { electrical: 1.2 } }
  ];

  var WEATHER_BY_ID = {};
  WEATHER.forEach(function (w) { WEATHER_BY_ID[w.id] = w; });

  /* Probability of each weather type by month (Jan..Dec) for a temperate US town. */
  var WEATHER_TABLE = [
    { clear: 0.28, cloudy: 0.24, rain: 0.10, cold: 0.22, snow: 0.14, storm: 0.02, heat: 0.00 },
    { clear: 0.30, cloudy: 0.24, rain: 0.12, cold: 0.20, snow: 0.12, storm: 0.02, heat: 0.00 },
    { clear: 0.34, cloudy: 0.24, rain: 0.22, cold: 0.10, snow: 0.05, storm: 0.05, heat: 0.00 },
    { clear: 0.40, cloudy: 0.22, rain: 0.24, cold: 0.03, snow: 0.01, storm: 0.08, heat: 0.02 },
    { clear: 0.44, cloudy: 0.18, rain: 0.20, cold: 0.00, snow: 0.00, storm: 0.10, heat: 0.08 },
    { clear: 0.42, cloudy: 0.14, rain: 0.14, cold: 0.00, snow: 0.00, storm: 0.10, heat: 0.20 },
    { clear: 0.38, cloudy: 0.12, rain: 0.12, cold: 0.00, snow: 0.00, storm: 0.10, heat: 0.28 },
    { clear: 0.38, cloudy: 0.14, rain: 0.12, cold: 0.00, snow: 0.00, storm: 0.09, heat: 0.27 },
    { clear: 0.44, cloudy: 0.20, rain: 0.18, cold: 0.01, snow: 0.00, storm: 0.07, heat: 0.10 },
    { clear: 0.42, cloudy: 0.24, rain: 0.20, cold: 0.08, snow: 0.01, storm: 0.03, heat: 0.02 },
    { clear: 0.34, cloudy: 0.26, rain: 0.16, cold: 0.16, snow: 0.06, storm: 0.02, heat: 0.00 },
    { clear: 0.28, cloudy: 0.26, rain: 0.12, cold: 0.20, snow: 0.12, storm: 0.02, heat: 0.00 }
  ];

  /* Monday .. Sunday */
  var DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DOW_DEMAND = [1.14, 1.05, 1.00, 1.02, 1.10, 0.72, 0.30];

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* ------------------------------------------------------------------ events */
  /*
   * Each event returns a patch the sim applies. `apply` may mutate state and
   * must return a human-readable line for the day's report.
   */
  var EVENTS = [
    { id: 'factory_layoff', weight: 3, minDay: 20,
      name: 'Layoffs at the plant',
      text: 'The distribution center laid off 200 people. Customers are deferring repairs.',
      apply: function (s) { s.modifiers.push({ id: 'layoff', label: 'Local layoffs', days: 14, demand: -0.16, approve: -0.05 }); } },

    { id: 'road_work', weight: 3, minDay: 12,
      name: 'Road construction out front',
      text: 'The city tore up the entrance lane. Drive-by traffic is a mess for two weeks.',
      apply: function (s) { s.modifiers.push({ id: 'roadwork', label: 'Road construction', days: 12, demand: -0.22 }); } },

    { id: 'competitor_open', weight: 2, minDay: 30,
      name: 'A franchise chain opened nearby',
      text: 'A national chain opened two miles away with a $19.99 oil change banner.',
      apply: function (s) { s.market.competitorPressure += 0.12; s.modifiers.push({ id: 'newcomp', label: 'New competitor', days: 30, demand: -0.10 }); } },

    { id: 'competitor_close', weight: 2, minDay: 40,
      name: 'The shop on 5th closed',
      text: 'An old competitor retired and closed. Their customers need somewhere to go.',
      apply: function (s) { s.market.competitorPressure = Math.max(0, s.market.competitorPressure - 0.14); s.modifiers.push({ id: 'compclosed', label: 'Competitor closed', days: 25, demand: 0.14 }); } },

    { id: 'viral_review', weight: 3, minDay: 8,
      name: 'A review went around town',
      text: 'A customer posted a glowing review with photos and it got shared everywhere.',
      apply: function (s) { s.reputation = Math.min(5, s.reputation + 0.16); s.modifiers.push({ id: 'viral', label: 'Word of mouth', days: 8, demand: 0.14 }); } },

    { id: 'bad_review', weight: 3, minDay: 8,
      name: 'One-star review',
      text: 'Someone posted a one-star review about a bill they did not expect.',
      apply: function (s) { s.reputation = Math.max(1, s.reputation - 0.14); } },

    { id: 'tech_sick', weight: 5, minDay: 3,
      name: 'A tech called out',
      text: null,
      apply: function (s, rng) {
        var pool = s.techs.filter(function (t) { return t.trainingDaysLeft <= 0; });
        if (!pool.length) return null;
        var t = rng.pick(pool);
        t.outDays = Math.max(t.outDays, rng.int(1, 2));
        return t.name + ' called out sick for ' + t.outDays + ' day(s).';
      } },

    { id: 'tool_breakdown', weight: 4, minDay: 10,
      name: 'Equipment failure',
      text: null,
      apply: function (s, rng) {
        var bays = s.bays.filter(function (b) { return b.active; });
        if (!bays.length) return null;
        var bay = rng.pick(bays);
        var installed = Object.keys(bay.tools).filter(function (k) { return bay.tools[k] > 0; });
        if (!installed.length) return null;
        var tool = rng.pick(installed);
        var cost = Math.round(NS.DATA.TOOLS[tool].levels[bay.tools[tool]].cost * 0.11 + 180);
        bay.downDays = Math.max(bay.downDays, rng.int(1, 2));
        s.pendingBills.push({ label: bay.name + ': ' + NS.DATA.TOOLS[tool].name + ' repair', amount: cost });
        return bay.name + ' is down: the ' + NS.DATA.TOOLS[tool].name.toLowerCase() +
          ' failed. Repair billed at $' + cost + '.';
      } },

    { id: 'parts_inflation', weight: 3, minDay: 15,
      name: 'Supplier price increase',
      text: null,
      apply: function (s, rng) {
        var cat = rng.pick(NS.DATA.PART_CATEGORIES);
        var pct = rng.float(0.05, 0.14);
        s.market.partPrices[cat.id] *= (1 + pct);
        return cat.name + ' costs jumped ' + Math.round(pct * 100) + '% from the supplier.';
      } },

    { id: 'parts_deal', weight: 2, minDay: 15,
      name: 'Supplier promotion',
      text: null,
      apply: function (s, rng) {
        var cat = rng.pick(NS.DATA.PART_CATEGORIES);
        var pct = rng.float(0.06, 0.15);
        s.market.partPrices[cat.id] *= (1 - pct);
        return 'Your jobber is dumping ' + cat.name.toLowerCase() + ': ' +
          Math.round(pct * 100) + '% off cost.';
      } },

    { id: 'fleet_offer', weight: 3, minDay: 25,
      name: 'Fleet contract offer',
      text: null,
      apply: function (s, rng) {
        if (s.reputation < 3.2) return null;
        var size = rng.int(4, 14);
        s.pendingOffers.push({
          id: 'fleet_' + s.day, type: 'fleet', vehicles: size,
          discount: 0.15, label: size + '-vehicle contractor fleet',
          text: 'A local contractor with ' + size + ' trucks wants a service agreement at 15% off labor.'
        });
        return 'A ' + size + '-vehicle fleet wants to talk. Check the Marketing tab to accept.';
      } },

    { id: 'insurance_hike', weight: 2, minDay: 30,
      name: 'Insurance renewal',
      text: null,
      apply: function (s, rng) {
        var pct = rng.float(0.06, 0.18);
        s.overhead.insurance *= (1 + pct);
        return 'Garage liability renewed ' + Math.round(pct * 100) + '% higher.';
      } },

    { id: 'holiday_rush', weight: 3, minDay: 14,
      name: 'Holiday travel week',
      text: 'Everyone is getting their car looked at before a long drive.',
      apply: function (s) { s.modifiers.push({ id: 'holiday', label: 'Holiday travel', days: 4, demand: 0.26, ticket: 0.06 }); } },

    { id: 'tax_refunds', weight: 2, minDay: 5,
      name: 'Tax refund season',
      text: 'Refund checks landed. Deferred repairs are getting approved.',
      apply: function (s) { s.modifiers.push({ id: 'refunds', label: 'Tax refunds', days: 10, approve: 0.09, ticket: 0.08 }); } },

    { id: 'poaching', weight: 3, minDay: 35,
      name: 'A dealer is recruiting',
      text: null,
      apply: function (s, rng) {
        var pool = s.techs.filter(function (t) { return t.level >= 3; });
        if (!pool.length) return null;
        var t = rng.pick(pool);
        if (t.morale > 0.72) {
          return 'The dealership tried to poach ' + t.name + '. They turned it down.';
        }
        s.pendingOffers.push({
          id: 'retain_' + t.id + '_' + s.day, type: 'retain', techId: t.id,
          raise: Math.round(TECH_WAGE[t.level] * 0.15),
          label: 'Counter-offer for ' + t.name,
          text: t.name + ' has a dealership offer. A $' + Math.round(TECH_WAGE[t.level] * 0.15) +
            '/hr raise keeps them.'
        });
        return t.name + ' got an offer from the dealership. Decide on the Crew tab.';
      } },

    { id: 'utility_spike', weight: 3, minDay: 20,
      name: 'Utility bill spike',
      text: null,
      apply: function (s, rng) {
        var amt = Math.round(rng.float(280, 900));
        s.pendingBills.push({ label: 'Utility true-up', amount: amt });
        return 'The power company trued up your bill: $' + amt + '.';
      } },

    { id: 'ev_wave', weight: 2, minDay: 45,
      name: 'EVs are showing up',
      text: 'More hybrids and EVs in the bay. Shops without HV training are turning them away.',
      apply: function (s) { s.market.evShare = Math.min(0.26, s.market.evShare + 0.04); } },

    { id: 'inspection_deadline', weight: 3, minDay: 10,
      name: 'Inspection sticker deadline',
      text: 'End-of-month stickers expire. The phone will not stop ringing for inspections.',
      apply: function (s) { s.modifiers.push({ id: 'stickers', label: 'Inspection rush', days: 3, demand: 0.20, jobBias: { state_inspection: 3.5 } }); } },

    { id: 'shop_flood', weight: 1, minDay: 40,
      name: 'Water line let go',
      text: null,
      apply: function (s, rng) {
        var amt = Math.round(rng.float(1400, 4200));
        s.pendingBills.push({ label: 'Emergency plumbing & cleanup', amount: amt });
        var bay = s.bays.filter(function (b) { return b.active; })[0];
        if (bay) bay.downDays = Math.max(bay.downDays, 1);
        return 'A supply line let go overnight. $' + amt + ' in cleanup and a bay down for a day.';
      } }
  ];

  var MILESTONES = [
    { id: 'first_10k', label: 'Bank $10,000 in cash', test: function (s) { return s.cash >= 10000; }, reward: 0 },
    { id: 'rep4', label: 'Reach a 4.0 star reputation', test: function (s) { return s.reputation >= 4.0; } },
    { id: 'aro300', label: 'Hit a $300 average repair order', test: function (s) { return s.stats.aro30 >= 300; } },
    { id: 'fourbays', label: 'Run four active bays', test: function (s) { return s.bays.filter(function (b) { return b.active; }).length >= 4; } },
    { id: 'eff100', label: 'Get shop efficiency over 100%', test: function (s) { return s.stats.efficiency30 >= 1.0; } },
    { id: 'debtfree', label: 'Pay off the loan', test: function (s) { return s.loan.principal <= 0 && s.day > 5; } },
    { id: 'net250', label: 'Build $250,000 in net worth', test: function (s) { return NS.Sim.netWorth(s) >= 250000; } },
    { id: 'fleet3', label: 'Sign three fleet accounts', test: function (s) { return s.fleetAccounts.length >= 3; } },
    { id: 'master', label: 'Employ a Master Diagnostician', test: function (s) { return s.techs.some(function (t) { return t.level >= 5; }); } },
    { id: 'rep47', label: 'Reach a 4.7 star reputation', test: function (s) { return s.reputation >= 4.7; } }
  ];

  NS.DATA = {
    CONFIG: CONFIG,
    DIFFICULTY: DIFFICULTY,
    SEASON: SEASON,
    TOOLS: TOOLS,
    TOOL_ORDER: TOOL_ORDER,
    JOBS: JOBS,
    JOBS_BY_ID: JOBS_BY_ID,
    UPSELLS: UPSELLS,
    PART_CATEGORIES: PART_CATEGORIES,
    BULK_TIERS: BULK_TIERS,
    TECH_SPECIALTIES: TECH_SPECIALTIES,
    TECH_TITLES: TECH_TITLES,
    TECH_WAGE: TECH_WAGE,
    WRITER_SALARY: WRITER_SALARY,
    TECH_TRAINING: TECH_TRAINING,
    WRITER_TRAINING: WRITER_TRAINING,
    UPGRADES: UPGRADES,
    UPGRADES_BY_ID: UPGRADES_BY_ID,
    CHANNELS: CHANNELS,
    CHANNELS_BY_ID: CHANNELS_BY_ID,
    WEATHER: WEATHER,
    WEATHER_BY_ID: WEATHER_BY_ID,
    WEATHER_TABLE: WEATHER_TABLE,
    DOW_NAMES: DOW_NAMES,
    DOW_DEMAND: DOW_DEMAND,
    MONTH_NAMES: MONTH_NAMES,
    EVENTS: EVENTS,
    MILESTONES: MILESTONES,
    FIRST_NAMES: FIRST_NAMES,
    LAST_NAMES: LAST_NAMES
  };
})(AutoShop);
