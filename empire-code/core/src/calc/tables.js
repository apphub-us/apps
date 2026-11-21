// NEC/NYCEC data tables — the single source of truth.
//
// Bootstrapped by extraction from mobile.html, now maintained HERE. The app
// aliases these via the injected engine, so a change lands in production by
// running `npm run build`.
//
// AMP_TEMP_LOOKUP was corrected against the complete NEC 2020
// Table 310.15(B)(1); the extracted original was missing 7 of its 16 bands.

const AMP_CU = {
  '14':  {t60:15,  t75:20,  t90:25},
  '12':  {t60:20,  t75:25,  t90:30},
  '10':  {t60:30,  t75:35,  t90:40},
  '8':   {t60:40,  t75:50,  t90:55},
  '6':   {t60:55,  t75:65,  t90:75},
  '4':   {t60:70,  t75:85,  t90:95},
  '3':   {t60:85,  t75:100, t90:115},
  '2':   {t60:95,  t75:115, t90:130},
  '1':   {t60:110, t75:130, t90:145},
  '1/0': {t60:125, t75:150, t90:170},
  '2/0': {t60:145, t75:175, t90:195},
  '3/0': {t60:165, t75:200, t90:225},
  '4/0': {t60:195, t75:230, t90:260},
  '250': {t60:215, t75:255, t90:290},
  '300': {t60:240, t75:285, t90:320},
  '350': {t60:260, t75:310, t90:350},
  '400': {t60:280, t75:335, t90:380},
  '500': {t60:320, t75:380, t90:430},
  '600': {t60:355, t75:420, t90:475},
  '700': {t60:385, t75:460, t90:520},
  '750': {t60:400, t75:475, t90:535}
};

const AMP_AL = {
  '12':  {t60:15,  t75:20,  t90:25},
  '10':  {t60:25,  t75:30,  t90:35},
  '8':   {t60:30,  t75:40,  t90:45},
  '6':   {t60:40,  t75:50,  t90:55},
  '4':   {t60:55,  t75:65,  t90:75},
  '3':   {t60:65,  t75:75,  t90:85},
  '2':   {t60:75,  t75:90,  t90:100},
  '1':   {t60:85,  t75:100, t90:115},
  '1/0': {t60:100, t75:120, t90:135},
  '2/0': {t60:115, t75:135, t90:150},
  '3/0': {t60:130, t75:155, t90:175},
  '4/0': {t60:150, t75:180, t90:205},
  '250': {t60:170, t75:205, t90:230},
  '300': {t60:190, t75:230, t90:255},
  '350': {t60:210, t75:250, t90:280},
  '400': {t60:225, t75:270, t90:305},
  '500': {t60:260, t75:310, t90:350},
  '600': {t60:285, t75:340, t90:385},
  '700': {t60:310, t75:375, t90:420},
  '750': {t60:320, t75:385, t90:435}
};

const AMP_TEMP_LOOKUP = {
  // NEC 2020 Table 310.15(B)(1) — Ambient Temperature Correction Factors
  // based on 30°C (86°F). COMPLETE table, 5°C bands.
  // Key = INCLUSIVE UPPER BOUND of the band, °F. Lookup must select the first
  // band whose bound >= ambient, never the nearest key.
  // null = no factor published for that conductor rating at that ambient:
  // the conductor rating is not permitted there. This is NOT the same as the
  // ambient being off the end of the table.
  // Values verified against NEC Equation 310.15(B): sqrt((Tc - Ta) / (Tc - 30)).
  50:  { c: 10, band: '10°C or less / 50°F or less', f60: 1.29, f75: 1.20, f90: 1.15 },
  59:  { c: 15, band: '11-15°C / 51-59°F',   f60: 1.22, f75: 1.15, f90: 1.12 },
  68:  { c: 20, band: '16-20°C / 60-68°F',   f60: 1.15, f75: 1.11, f90: 1.08 },
  77:  { c: 25, band: '21-25°C / 69-77°F',   f60: 1.08, f75: 1.05, f90: 1.04 },
  86:  { c: 30, band: '26-30°C / 78-86°F',   f60: 1.00, f75: 1.00, f90: 1.00 },
  95:  { c: 35, band: '31-35°C / 87-95°F',   f60: 0.91, f75: 0.94, f90: 0.96 },
  104: { c: 40, band: '36-40°C / 96-104°F',  f60: 0.82, f75: 0.88, f90: 0.91 },
  113: { c: 45, band: '41-45°C / 105-113°F', f60: 0.71, f75: 0.82, f90: 0.87 },
  122: { c: 50, band: '46-50°C / 114-122°F', f60: 0.58, f75: 0.75, f90: 0.82 },
  131: { c: 55, band: '51-55°C / 123-131°F', f60: 0.41, f75: 0.67, f90: 0.76 },
  140: { c: 60, band: '56-60°C / 132-140°F', f60: null, f75: 0.58, f90: 0.71 },
  149: { c: 65, band: '61-65°C / 141-149°F', f60: null, f75: 0.47, f90: 0.65 },
  158: { c: 70, band: '66-70°C / 150-158°F', f60: null, f75: 0.33, f90: 0.58 },
  167: { c: 75, band: '71-75°C / 159-167°F', f60: null, f75: null, f90: 0.50 },
  176: { c: 80, band: '76-80°C / 168-176°F', f60: null, f75: null, f90: 0.41 },
  185: { c: 85, band: '81-85°C / 177-185°F', f60: null, f75: null, f90: 0.29 }
};

const CF_AREA = {
  emt:   {'0.5':{t:0.304,f40:0.122,f31:0.094,f53:0.161},'0.75':{t:0.533,f40:0.213,f31:0.165,f53:0.283},'1':{t:0.864,f40:0.346,f31:0.268,f53:0.458},'1.25':{t:1.496,f40:0.598,f31:0.464,f53:0.793},'1.5':{t:2.036,f40:0.814,f31:0.631,f53:1.079},'2':{t:3.356,f40:1.342,f31:1.040,f53:1.778},'2.5':{t:5.858,f40:2.343,f31:1.816,f53:3.105},'3':{t:8.846,f40:3.538,f31:2.742,f53:4.688},'3.5':{t:11.545,f40:4.618,f31:3.579,f53:6.119},'4':{t:14.753,f40:5.901,f31:4.573,f53:7.819}},
  imc:   {'0.5':{t:0.342,f40:0.137,f31:0.106,f53:0.181},'0.75':{t:0.586,f40:0.235,f31:0.182,f53:0.311},'1':{t:0.959,f40:0.384,f31:0.297,f53:0.508},'1.25':{t:1.647,f40:0.659,f31:0.511,f53:0.873},'1.5':{t:2.225,f40:0.890,f31:0.690,f53:1.179},'2':{t:3.630,f40:1.452,f31:1.125,f53:1.924},'2.5':{t:5.135,f40:2.054,f31:1.592,f53:2.722},'3':{t:7.922,f40:3.169,f31:2.456,f53:4.199},'3.5':{t:10.584,f40:4.234,f31:3.281,f53:5.609},'4':{t:13.631,f40:5.452,f31:4.226,f53:7.224}},
  rmc:   {'0.5':{t:0.314,f40:0.125,f31:0.097,f53:0.166},'0.75':{t:0.549,f40:0.220,f31:0.170,f53:0.291},'1':{t:0.887,f40:0.355,f31:0.275,f53:0.470},'1.25':{t:1.526,f40:0.610,f31:0.473,f53:0.809},'1.5':{t:2.071,f40:0.828,f31:0.642,f53:1.098},'2':{t:3.408,f40:1.363,f31:1.056,f53:1.806},'2.5':{t:4.866,f40:1.946,f31:1.508,f53:2.579},'3':{t:7.499,f40:3.000,f31:2.325,f53:3.974},'3.5':{t:10.010,f40:4.004,f31:3.103,f53:5.305},'4':{t:12.882,f40:5.153,f31:3.993,f53:6.827}},
  ent:   {'0.5':{t:0.285,f40:0.114,f31:0.088,f53:0.151},'0.75':{t:0.508,f40:0.203,f31:0.157,f53:0.269},'1':{t:0.832,f40:0.333,f31:0.258,f53:0.441},'1.25':{t:1.453,f40:0.581,f31:0.450,f53:0.770},'1.5':{t:1.986,f40:0.794,f31:0.616,f53:1.053},'2':{t:3.291,f40:1.316,f31:1.020,f53:1.744}},
  pvc40: {'0.5':{t:0.285,f40:0.114,f31:0.088,f53:0.151},'0.75':{t:0.508,f40:0.203,f31:0.157,f53:0.269},'1':{t:0.832,f40:0.333,f31:0.258,f53:0.441},'1.25':{t:1.453,f40:0.581,f31:0.450,f53:0.770},'1.5':{t:1.986,f40:0.794,f31:0.616,f53:1.053},'2':{t:3.291,f40:1.316,f31:1.020,f53:1.744},'2.5':{t:4.695,f40:1.878,f31:1.455,f53:2.488},'3':{t:7.268,f40:2.907,f31:2.253,f53:3.852},'3.5':{t:9.737,f40:3.895,f31:3.018,f53:5.161},'4':{t:12.554,f40:5.022,f31:3.892,f53:6.654}},
  pvc80: {'0.5':{t:0.217,f40:0.087,f31:0.067,f53:0.115},'0.75':{t:0.409,f40:0.164,f31:0.127,f53:0.217},'1':{t:0.688,f40:0.275,f31:0.213,f53:0.365},'1.25':{t:1.237,f40:0.495,f31:0.383,f53:0.656},'1.5':{t:1.711,f40:0.684,f31:0.530,f53:0.907},'2':{t:2.874,f40:1.150,f31:0.891,f53:1.523},'2.5':{t:4.119,f40:1.648,f31:1.277,f53:2.183},'3':{t:6.442,f40:2.577,f31:1.997,f53:3.414},'3.5':{t:8.688,f40:3.475,f31:2.693,f53:4.605},'4':{t:11.258,f40:4.503,f31:3.490,f53:5.967}}
};

const CF_WIRE = {
  thhn: {'14':0.0097,'12':0.0133,'10':0.0211,'8':0.0366,'6':0.0507,'4':0.0824,'3':0.0973,'2':0.1158,'1':0.1562,'1/0':0.1855,'2/0':0.2223,'3/0':0.2679,'4/0':0.3237,'250':0.3970,'300':0.4608,'350':0.5242,'400':0.5863,'500':0.7073},
  thw:  {'14':0.0139,'12':0.0181,'10':0.0243,'8':0.0437,'6':0.0726,'4':0.1087,'3':0.1263,'2':0.1473,'1':0.1901,'1/0':0.2223,'2/0':0.2624,'3/0':0.3117,'4/0':0.3718,'250':0.4596,'300':0.5281,'350':0.5958,'400':0.6619,'500':0.7901},
  xhhw: {'14':0.0097,'12':0.0133,'10':0.0211,'8':0.0366,'6':0.0590,'4':0.0814,'3':0.0962,'2':0.1146,'1':0.1534,'1/0':0.1825,'2/0':0.2190,'3/0':0.2642,'4/0':0.3197,'250':0.3904,'300':0.4536,'350':0.5166,'400':0.5782,'500':0.6984}
};

const BF_VOL = { '14':2.00, '12':2.25, '10':2.50, '8':3.00, '6':5.00 };

/* EC-CALC-1 — Box Fill capacities. Standard (unmarked) metal boxes carry NEC
 * 2020 Table 314.16(A) minimum volumes; 'marked' rows are marked-volume
 * presets (not table entries) valid only when the actual box marking
 * matches. Keys are stable identities and are never repurposed. The
 * dropdown and the reference tables are generated from THIS data.
 * Ledger of corrections: docs/box-fill-contract.md §4. */
const BF_BOXES = {
  // EC-CALC-1B: `family` is accessory-compatibility metadata only (BF_ACCESSORIES.compatibleFamily). No volume changed.
  sq_4x1_25:      { label:'4" Square 1-1/4"',         vol:18.0, kind:'metal',  group:'4" Square',   source:'NEC 2020 T.314.16(A) 100x32 sq', family:'metal_square_4' },
  sq_4x1_5:       { label:'4" Square 1-1/2"',         vol:21.0, kind:'metal',  group:'4" Square',   source:'NEC 2020 T.314.16(A) 100x38 sq', family:'metal_square_4' },
  sq_4x2_125:     { label:'4" Square 2-1/8"',         vol:30.3, kind:'metal',  group:'4" Square',   source:'NEC 2020 T.314.16(A) 100x54 sq', family:'metal_square_4' },
  sq_4_11_16x1_5: { label:'4-11/16" Square 1-1/2"',  vol:29.5, kind:'metal',  group:'4-11/16" Square', source:'NEC 2020 T.314.16(A) 120x38 sq', family:'metal_square_4_11_16' },
  sq_4_11_16x2_125:{ label:'4-11/16" Square 2-1/8"', vol:42.0, kind:'metal',  group:'4-11/16" Square', source:'NEC 2020 T.314.16(A) 120x54 sq', family:'metal_square_4_11_16' },
  oct_4x1_25:     { label:'4" Octagon 1-1/4"',        vol:12.5, kind:'metal',  group:'4" Octagon',  source:'NEC 2020 T.314.16(A) 100x32 round/oct', family:'metal_octagon_4' },
  oct_4x1_5:      { label:'4" Octagon 1-1/2"',        vol:15.5, kind:'metal',  group:'4" Octagon',  source:'NEC 2020 T.314.16(A) 100x38 round/oct', family:'metal_octagon_4' },
  oct_4x2_125:    { label:'4" Octagon 2-1/8"',        vol:21.5, kind:'metal',  group:'4" Octagon',  source:'NEC 2020 T.314.16(A) 100x54 round/oct', family:'metal_octagon_4' },
  dev_3x2x1_5:    { label:'Device 3×2×1-1/2"',        vol:7.5,  kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x38 device' },
  dev_3x2x2:      { label:'Device 3×2×2"',            vol:10.0, kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x50 device' },
  dev_3x2x2_25:   { label:'Device 3×2×2-1/4"',        vol:10.5, kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x57 device' },
  dev_3x2x2_5:    { label:'Device 3×2×2-1/2"',        vol:12.5, kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x65 device' },
  dev_3x2x2_75:   { label:'Device 3×2×2-3/4"',        vol:14.0, kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x70 device' },
  dev_3x2x3_5:    { label:'Device 3×2×3-1/2"',        vol:18.0, kind:'metal',  group:'Device Box',   source:'NEC 2020 T.314.16(A) 75x50x90 device' },
  handy_1_5:      { label:'Handy Box 1-1/2"',          vol:10.3, kind:'metal',  group:'Handy Box',    source:'NEC 2020 T.314.16(A) 100x54x38 device' },
  handy_1_875:    { label:'Handy Box 1-7/8"',          vol:13.0, kind:'metal',  group:'Handy Box',    source:'NEC 2020 T.314.16(A) 100x54x48 device' },
  pl_sg_14:       { label:'Plastic 1-Gang 14 cu in',   vol:14.0, kind:'marked', group:'Plastic 1-Gang (marked)', source:'marked volume — verify box marking' },
  pl_sg_18:       { label:'Plastic 1-Gang 18 cu in',   vol:18.0, kind:'marked', group:'Plastic 1-Gang (marked)', source:'marked volume — verify box marking' },
  pl_sg_20:       { label:'Plastic 1-Gang 20 cu in',   vol:20.0, kind:'marked', group:'Plastic 1-Gang (marked)', source:'marked volume — verify box marking' },
  pl_sg_22:       { label:'Plastic 1-Gang 22 cu in',   vol:22.0, kind:'marked', group:'Plastic 1-Gang (marked)', source:'marked volume — verify box marking' },
  pl_dg_30:       { label:'Plastic 2-Gang 30 cu in',   vol:30.0, kind:'marked', group:'Plastic 2-Gang (marked)', source:'marked volume — verify box marking' },
  pl_dg_34:       { label:'Plastic 2-Gang 34 cu in',   vol:34.0, kind:'marked', group:'Plastic 2-Gang (marked)', source:'marked volume — verify box marking' },
  pl_dg_40:       { label:'Plastic 2-Gang 40 cu in',   vol:40.0, kind:'marked', group:'Plastic 2-Gang (marked)', source:'marked volume — verify box marking' },
  pl_tg_42:       { label:'Plastic 3-Gang 42 cu in',   vol:42.0, kind:'marked', group:'Plastic 3-Gang (marked)', source:'marked volume — verify box marking' },
  pl_tg_50:       { label:'Plastic 3-Gang 50 cu in',   vol:50.0, kind:'marked', group:'Plastic 3-Gang (marked)', source:'marked volume — verify box marking' },
  pl_oct_15:      { label:'Plastic Round/Oct 15 cu in',vol:15.0, kind:'marked', group:'Plastic Round/Oct (marked)', source:'marked volume — verify box marking' },
  pl_oct_20:      { label:'Plastic Round/Oct 20 cu in',vol:20.0, kind:'marked', group:'Plastic Round/Oct (marked)', source:'marked volume — verify box marking' },
  /* EC-CALC-1B — exact RACO metal multigang boxes (kind 'listed_product'): manufacturer
   * catalog capacities from the locked seed EC-CALC-1B-catalog-seed.json (checked
   * 2026-09-06, source RACO_MULTIGANG in BF_CATALOG_SOURCES). These are exact products,
   * not a universal "N-gang volume". Ledger: docs/box-fill-catalog.md. */
  raco_951: { label:'2-Gang · 1-5/8" deep · RACO 951', vol:47.0,  kind:'listed_product', group:'RACO Multigang · 1-5/8" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'951', gangs:2, depthIn:1.625, status:'verified' },
  raco_952: { label:'3-Gang · 1-5/8" deep · RACO 952', vol:60.0,  kind:'listed_product', group:'RACO Multigang · 1-5/8" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'952', gangs:3, depthIn:1.625, status:'verified' },
  raco_953: { label:'4-Gang · 1-5/8" deep · RACO 953', vol:72.8,  kind:'listed_product', group:'RACO Multigang · 1-5/8" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'953', gangs:4, depthIn:1.625, status:'verified' },
  raco_954: { label:'5-Gang · 1-5/8" deep · RACO 954', vol:85.8,  kind:'listed_product', group:'RACO Multigang · 1-5/8" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'954', gangs:5, depthIn:1.625, status:'verified' },
  raco_955: { label:'6-Gang · 1-5/8" deep · RACO 955', vol:98.5,  kind:'listed_product', group:'RACO Multigang · 1-5/8" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'955', gangs:6, depthIn:1.625, status:'verified' },
  raco_941: { label:'2-Gang · 2-1/2" deep · RACO 941', vol:70.0,  kind:'listed_product', group:'RACO Multigang · 2-1/2" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'941', gangs:2, depthIn:2.5,   status:'verified' },
  raco_942: { label:'3-Gang · 2-1/2" deep · RACO 942', vol:90.0,  kind:'listed_product', group:'RACO Multigang · 2-1/2" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'942', gangs:3, depthIn:2.5,   status:'verified' },
  raco_943: { label:'4-Gang · 2-1/2" deep · RACO 943', vol:110.0, kind:'listed_product', group:'RACO Multigang · 2-1/2" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'943', gangs:4, depthIn:2.5,   status:'verified' },
  raco_944: { label:'5-Gang · 2-1/2" deep · RACO 944', vol:130.0, kind:'listed_product', group:'RACO Multigang · 2-1/2" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'944', gangs:5, depthIn:2.5,   status:'verified' },
  raco_945: { label:'6-Gang · 2-1/2" deep · RACO 945', vol:150.0, kind:'listed_product', group:'RACO Multigang · 2-1/2" deep', source:'RACO_MULTIGANG', family:'raco_multigang', manufacturer:'RACO', catalogNumber:'945', gangs:6, depthIn:2.5,   status:'verified' }
};

/* EC-CALC-1B — Box Fill field catalog: verified ring / raised-cover / extension-ring
 * capacities. Based EXACTLY on `accessoriesVerified` in the locked seed
 * EC-CALC-1B-catalog-seed.json (schemaVersion 1, checked 2026-09-06, scope RACO).
 * Only status:'verified' records may auto-populate `extensionVolume`; the UI resolves
 * ONE of these numbers (or a Custom entry) and the engine still does every calculation.
 * Compatibility: a non-empty `compatibleBoxKeys` is exact and authoritative (no
 * cross-size inference); otherwise `compatibleFamily` must equal BF_BOXES[key].family.
 * `label` is the field-first display text: opening count · raised height / depth ·
 * auto-added in³ · catalog number. Ledger and sources: docs/box-fill-catalog.md. */
const BF_ACCESSORIES = {
  // 4" square — single-device mud rings (source RACO_4IN_SINGLE)
  raco_4sq_1g_025:  { id:'raco_4sq_1g_025',  manufacturer:'RACO', catalogNumbers:['771','8771'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.25,  addedVolumeIn3:1.5,  label:'1-device · 1/4" raised · +1.5 in³ · RACO 771/8771',   source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_050:  { id:'raco_4sq_1g_050',  manufacturer:'RACO', catalogNumbers:['772','8772'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.5,   addedVolumeIn3:3.5,  label:'1-device · 1/2" raised · +3.5 in³ · RACO 772/8772',   source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_0625: { id:'raco_4sq_1g_0625', manufacturer:'RACO', catalogNumbers:['768','8768'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.625, addedVolumeIn3:4.5,  label:'1-device · 5/8" raised · +4.5 in³ · RACO 768/8768',   source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_075:  { id:'raco_4sq_1g_075',  manufacturer:'RACO', catalogNumbers:['773','8773'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.75,  addedVolumeIn3:5.5,  label:'1-device · 3/4" raised · +5.5 in³ · RACO 773/8773',   source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_100:  { id:'raco_4sq_1g_100',  manufacturer:'RACO', catalogNumbers:['774'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.0,   addedVolumeIn3:7.5,  label:'1-device · 1" raised · +7.5 in³ · RACO 774',          source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_125:  { id:'raco_4sq_1g_125',  manufacturer:'RACO', catalogNumbers:['775','8775'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.25,  addedVolumeIn3:9.5,  label:'1-device · 1-1/4" raised · +9.5 in³ · RACO 775/8775', source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_150:  { id:'raco_4sq_1g_150',  manufacturer:'RACO', catalogNumbers:['785'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.5,   addedVolumeIn3:11.3, label:'1-device · 1-1/2" raised · +11.3 in³ · RACO 785',     source:'RACO_4IN_SINGLE', status:'verified' },
  raco_4sq_1g_200:  { id:'raco_4sq_1g_200',  manufacturer:'RACO', catalogNumbers:['786'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:2.0,   addedVolumeIn3:14.5, label:'1-device · 2" raised · +14.5 in³ · RACO 786',         source:'RACO_4IN_SINGLE', status:'verified' },
  // 4" square — two-device mud rings (source RACO_4IN_TWO)
  raco_4sq_2g_025:  { id:'raco_4sq_2g_025',  manufacturer:'RACO', catalogNumbers:['777','8777-0'], type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.25,  addedVolumeIn3:3.0,  label:'2-device · 1/4" raised · +3.0 in³ · RACO 777/8777-0', source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_050:  { id:'raco_4sq_2g_050',  manufacturer:'RACO', catalogNumbers:['778','8778'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.5,   addedVolumeIn3:5.5,  label:'2-device · 1/2" raised · +5.5 in³ · RACO 778/8778',   source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_0625: { id:'raco_4sq_2g_0625', manufacturer:'RACO', catalogNumbers:['769','8769'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.625, addedVolumeIn3:7.3,  label:'2-device · 5/8" raised · +7.3 in³ · RACO 769/8769',   source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_075:  { id:'raco_4sq_2g_075',  manufacturer:'RACO', catalogNumbers:['779','8779'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.75,  addedVolumeIn3:8.8,  label:'2-device · 3/4" raised · +8.8 in³ · RACO 779/8779',   source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_100:  { id:'raco_4sq_2g_100',  manufacturer:'RACO', catalogNumbers:['780'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.0,   addedVolumeIn3:12.0, label:'2-device · 1" raised · +12.0 in³ · RACO 780',         source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_125:  { id:'raco_4sq_2g_125',  manufacturer:'RACO', catalogNumbers:['781','8781'],   type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.25,  addedVolumeIn3:15.0, label:'2-device · 1-1/4" raised · +15.0 in³ · RACO 781/8781',source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_150:  { id:'raco_4sq_2g_150',  manufacturer:'RACO', catalogNumbers:['795'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.5,   addedVolumeIn3:15.5, label:'2-device · 1-1/2" raised · +15.5 in³ · RACO 795',     source:'RACO_4IN_TWO', status:'verified' },
  raco_4sq_2g_200:  { id:'raco_4sq_2g_200',  manufacturer:'RACO', catalogNumbers:['796'],          type:'mud_ring', compatibleFamily:'metal_square_4', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:2.0,   addedVolumeIn3:20.5, label:'2-device · 2" raised · +20.5 in³ · RACO 796',         source:'RACO_4IN_TWO', status:'verified' },
  // 4-11/16" square — single-device mud rings (source RACO_41116)
  raco_41116_1g_050:  { id:'raco_41116_1g_050',  manufacturer:'RACO', catalogNumbers:['837','8837'], type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.5,   addedVolumeIn3:3.5,  label:'1-device · 1/2" raised · +3.5 in³ · RACO 837/8837',  source:'RACO_41116', status:'verified' },
  raco_41116_1g_0625: { id:'raco_41116_1g_0625', manufacturer:'RACO', catalogNumbers:['843'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.625, addedVolumeIn3:4.5,  label:'1-device · 5/8" raised · +4.5 in³ · RACO 843',       source:'RACO_41116', status:'verified' },
  raco_41116_1g_075:  { id:'raco_41116_1g_075',  manufacturer:'RACO', catalogNumbers:['838'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:0.75,  addedVolumeIn3:5.5,  label:'1-device · 3/4" raised · +5.5 in³ · RACO 838',       source:'RACO_41116', status:'verified' },
  raco_41116_1g_100:  { id:'raco_41116_1g_100',  manufacturer:'RACO', catalogNumbers:['839'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.0,   addedVolumeIn3:7.5,  label:'1-device · 1" raised · +7.5 in³ · RACO 839',         source:'RACO_41116', status:'verified' },
  raco_41116_1g_125:  { id:'raco_41116_1g_125',  manufacturer:'RACO', catalogNumbers:['842'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.25,  addedVolumeIn3:9.5,  label:'1-device · 1-1/4" raised · +9.5 in³ · RACO 842',     source:'RACO_41116', status:'verified' },
  raco_41116_1g_150:  { id:'raco_41116_1g_150',  manufacturer:'RACO', catalogNumbers:['898'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:1.5,   addedVolumeIn3:11.0, label:'1-device · 1-1/2" raised · +11.0 in³ · RACO 898',    source:'RACO_41116', status:'verified' },
  raco_41116_1g_200:  { id:'raco_41116_1g_200',  manufacturer:'RACO', catalogNumbers:['899'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:1, raisedHeightIn:2.0,   addedVolumeIn3:16.0, label:'1-device · 2" raised · +16.0 in³ · RACO 899',        source:'RACO_41116', status:'verified' },
  // 4-11/16" square — two-device mud rings (source RACO_41116)
  raco_41116_2g_050:  { id:'raco_41116_2g_050',  manufacturer:'RACO', catalogNumbers:['841'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.5,   addedVolumeIn3:5.5,  label:'2-device · 1/2" raised · +5.5 in³ · RACO 841',       source:'RACO_41116', status:'verified' },
  raco_41116_2g_0625: { id:'raco_41116_2g_0625', manufacturer:'RACO', catalogNumbers:['818'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.625, addedVolumeIn3:7.3,  label:'2-device · 5/8" raised · +7.3 in³ · RACO 818',       source:'RACO_41116', status:'verified' },
  raco_41116_2g_075:  { id:'raco_41116_2g_075',  manufacturer:'RACO', catalogNumbers:['840'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:0.75,  addedVolumeIn3:8.8,  label:'2-device · 3/4" raised · +8.8 in³ · RACO 840',       source:'RACO_41116', status:'verified' },
  raco_41116_2g_100:  { id:'raco_41116_2g_100',  manufacturer:'RACO', catalogNumbers:['819'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.0,   addedVolumeIn3:12.0, label:'2-device · 1" raised · +12.0 in³ · RACO 819',        source:'RACO_41116', status:'verified' },
  raco_41116_2g_125:  { id:'raco_41116_2g_125',  manufacturer:'RACO', catalogNumbers:['820'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.25,  addedVolumeIn3:15.0, label:'2-device · 1-1/4" raised · +15.0 in³ · RACO 820',    source:'RACO_41116', status:'verified' },
  raco_41116_2g_150:  { id:'raco_41116_2g_150',  manufacturer:'RACO', catalogNumbers:['885'],        type:'mud_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:2, raisedHeightIn:1.5,   addedVolumeIn3:15.5, label:'2-device · 1-1/2" raised · +15.5 in³ · RACO 885',    source:'RACO_41116', status:'verified' },
  // RACO multigang raised covers — EXACT base boxes only (source RACO_MULTIGANG). 821 (2-gang) is in BF_ACCESSORY_UNRESOLVED.
  raco_mg_822_075: { id:'raco_mg_822_075', manufacturer:'RACO', catalogNumbers:['822'], type:'raised_cover', compatibleFamily:'raco_multigang', compatibleBoxKeys:['raco_952','raco_942'], openingGangs:3, raisedHeightIn:0.75, addedVolumeIn3:15.3, label:'3-Gang cover · 3/4" raised · +15.3 in³ · RACO 822', source:'RACO_MULTIGANG', status:'verified' },
  raco_mg_823_075: { id:'raco_mg_823_075', manufacturer:'RACO', catalogNumbers:['823'], type:'raised_cover', compatibleFamily:'raco_multigang', compatibleBoxKeys:['raco_953','raco_943'], openingGangs:4, raisedHeightIn:0.75, addedVolumeIn3:20.3, label:'4-Gang cover · 3/4" raised · +20.3 in³ · RACO 823', source:'RACO_MULTIGANG', status:'verified' },
  raco_mg_824_075: { id:'raco_mg_824_075', manufacturer:'RACO', catalogNumbers:['824'], type:'raised_cover', compatibleFamily:'raco_multigang', compatibleBoxKeys:['raco_954','raco_944'], openingGangs:5, raisedHeightIn:0.75, addedVolumeIn3:25.5, label:'5-Gang cover · 3/4" raised · +25.5 in³ · RACO 824', source:'RACO_MULTIGANG', status:'verified' },
  raco_mg_825_075: { id:'raco_mg_825_075', manufacturer:'RACO', catalogNumbers:['825'], type:'raised_cover', compatibleFamily:'raco_multigang', compatibleBoxKeys:['raco_955','raco_945'], openingGangs:6, raisedHeightIn:0.75, addedVolumeIn3:30.5, label:'6-Gang cover · 3/4" raised · +30.5 in³ · RACO 825', source:'RACO_MULTIGANG', status:'verified' },
  // extension rings, 1-1/2" deep (sources RACO_4IN_EXT_201, RACO_41116_EXT_250, RACO_OCT_EXT_128)
  raco_4sq_ext_201_150:   { id:'raco_4sq_ext_201_150',   manufacturer:'RACO', catalogNumbers:['201'], type:'extension_ring', compatibleFamily:'metal_square_4',       compatibleBoxKeys:[], openingGangs:null, raisedHeightIn:1.5, addedVolumeIn3:22.5, label:'Extension ring · 1-1/2" deep · +22.5 in³ · RACO 201', source:'RACO_4IN_EXT_201',   status:'verified' },
  raco_41116_ext_250_150: { id:'raco_41116_ext_250_150', manufacturer:'RACO', catalogNumbers:['250'], type:'extension_ring', compatibleFamily:'metal_square_4_11_16', compatibleBoxKeys:[], openingGangs:null, raisedHeightIn:1.5, addedVolumeIn3:29.5, label:'Extension ring · 1-1/2" deep · +29.5 in³ · RACO 250', source:'RACO_41116_EXT_250', status:'verified' },
  raco_oct4_ext_128_150:  { id:'raco_oct4_ext_128_150',  manufacturer:'RACO', catalogNumbers:['128'], type:'extension_ring', compatibleFamily:'metal_octagon_4',      compatibleBoxKeys:[], openingGangs:null, raisedHeightIn:1.5, addedVolumeIn3:15.5, label:'Extension ring · 1-1/2" deep · +15.5 in³ · RACO 128', source:'RACO_OCT_EXT_128',   status:'verified' }
};

/* EC-CALC-1B — known manufacturer conflict, preserved as data so the UI can explain it.
 * NOT a selectable auto-volume record: `addedVolumeIn3` is null and `status` is not
 * 'verified', so no resolver may ever produce 10.0 or 10.3 from it. The two published
 * values are kept only as provenance for the conflict note and the tests. */
const BF_ACCESSORY_UNRESOLVED = {
  raco_mg_821_075: {
    id:'raco_mg_821_075', manufacturer:'RACO', catalogNumbers:['821'], type:'raised_cover', compatibleFamily:'raco_multigang',
    compatibleBoxKeys:['raco_951','raco_941'], openingGangs:2, raisedHeightIn:0.75, addedVolumeIn3:null,
    status:'blocked_source_conflict',
    conflictingValues:[ { addedVolumeIn3:10.0, source:'RACO_MULTIGANG', note:'Current full catalog table' }, { addedVolumeIn3:10.3, source:'RACO_821_SPEC', note:'Dedicated specification sheet REV 4/2025' } ],
    implementationRule:'Do NOT auto-add either value. UI must route to Custom/verified marked volume until the manufacturer conflict is resolved.',
    uiNote:'RACO 821 3/4" cover: automatic volume unavailable because current manufacturer sources conflict. Verify the actual product data and use Custom.'
  }
};

/* EC-CALC-1B — where each catalog record was checked (seed `sources`, 2026-09-06). Offline provenance only; never fetched at runtime. */
const BF_CATALOG_SOURCES = {
  RACO_FULL:          { title:'RACO / TayMac / Bell Full Product Catalog', url:'https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'Current manufacturer catalog; mud rings, multigang boxes/covers.' },
  RACO_STEEL_CURRENT: { title:'STEEL BOXES, COVERS, AND ACCESSORIES', url:'https://hubbellcdn.com/catalogfull/HES-MULTI-CAT-EN-03988_A.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'Current manufacturer catalog tables for square covers and multigang covers.' },
  RACO_4IN_SINGLE:    { title:'Steel Boxes, Covers and Accessories — 4 in. Square Single Device Covers', url:'https://hubbellcdn.com/catalogfull/RTB_Steel%20Boxes-Covers-Acc.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'4 in. Square Single Device Covers, printed A21' },
  RACO_4IN_TWO:       { title:'STEEL BOXES, COVERS, AND ACCESSORIES — 4 in. Square Two Device and Tile Covers', url:'https://hubbellcdn.com/catalogpage/RTB_A24_CatalogPage.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'printed A24' },
  RACO_41116:         { title:'RACO / TayMac / Bell Full Product Catalog — 4-11/16 in. Square Covers', url:'https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'4-11/16 in. Square Single Device and Two Device cover tables' },
  RACO_MULTIGANG:     { title:'RACO / TayMac / Bell Full Product Catalog — Multigang Boxes and Covers', url:'https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'Multigang Boxes (951–955, 941–945) and raised covers (821–825)' },
  RACO_821_SPEC:      { title:'RACO 821 Specification Sheet', url:'https://hubbellcdn.com/specsheet/RACO_CA-821-SPEC-EN.pdf', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'REV 4/2025; Cubic Capacity field' },
  RACO_4IN_EXT_201:   { title:'RACO 201 — 4 in. Square Extension Ring, 1-1/2 in. Deep', url:'https://www.hubbell.com/hubbell/en/products/4-in-square-extension-ring-drawn-1-12-in-deep-with-twelve-12-in-kos/p/19464454', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'' },
  RACO_41116_EXT_250: { title:'RACO 250 — 4-11/16 in. Square Extension Ring, 1-1/2 in. Deep', url:'https://www.hubbell.com/raco/en/products/4-1116-in-square-extension-ring-drawn-1-12-in-deep-with-eight-12-and-four-34-in-kos/p/19464589', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'' },
  RACO_OCT_EXT_128:   { title:'RACO 128 — 4 in. Octagon Extension Ring, 1-1/2 in. Deep', url:'https://www.hubbell.com/raco/en/products/4-in-octagon-extension-ring-drawn-1-12-in-deep-four-12-in-kos/p/19464426', publisher:'Hubbell / RACO', checked:'2026-09-06', locator:'' }
};

const VD_CM = {
  '14':   4110,   '12':   6530,   '10':  10380,  '8':   16510,
  '6':   26240,   '4':   41740,   '3':   52620,  '2':   66360,
  '1':   83690,   '1/0': 105600,  '2/0': 133100, '3/0': 167800,
  '4/0': 211600,  '250': 250000,  '300': 300000, '350': 350000,
  '400': 400000,  '500': 500000,  '600': 600000, '700': 700000,
  '750': 750000
};

const VD_K = { cu: 12.9, al: 21.2 };

const MT_FLC_1PH = {
  '1/6':[4.4,2.5,2.4,2.2], '1/4':[5.8,3.3,3.2,2.9], '1/3':[7.2,4.1,4.0,3.6],
  '1/2':[9.8,5.6,5.4,4.9], '3/4':[13.8,7.9,7.6,6.9], '1':[16,9.2,8.8,8.0],
  '1.5':[20,11.5,11.0,10], '2':[24,13.8,13.2,12], '3':[34,19.6,18.7,17],
  '5':[56,32.2,30.8,28], '7.5':[80,46.0,44.0,40], '10':[100,57.5,55.0,50]
};

const MT_V_1PH = ['115','200','208','230'];

const MT_FLC_3PH = {
  '1/2':[4.4,2.5,2.4,2.2,1.1,0.9], '3/4':[6.4,3.7,3.5,3.2,1.6,1.3],
  '1':[8.4,4.8,4.6,4.2,2.1,1.7],   '1.5':[12,6.9,6.6,6,3,2.4],
  '2':[13.6,7.8,7.5,6.8,3.4,2.7],  '3':[null,11,10.6,9.6,4.8,3.9],
  '5':[null,17.5,16.7,15.2,7.6,6.1],'7.5':[null,25.3,24.2,22,11,9],
  '10':[null,32.2,30.8,28,14,11],  '15':[null,48.3,46.2,42,21,17],
  '20':[null,62.1,59.4,54,27,22],  '25':[null,78.2,74.8,68,34,27],
  '30':[null,92,88,80,40,32],      '40':[null,120,114,104,52,41],
  '50':[null,150,143,130,65,52],   '60':[null,177,169,154,77,62],
  '75':[null,221,211,192,96,77],   '100':[null,285,273,248,124,99],
  '125':[null,359,343,312,156,125],'150':[null,414,396,360,180,144],
  '200':[null,552,528,480,240,192]
};

const MT_V_3PH = ['115','200','208','230','460','575'];

const MT_PCT = {
  designB: { nontd:300, dual:175, inst:1100, inverse:250 },
  other:   { nontd:300, dual:175, inst:800,  inverse:250 },
  wound:   { nontd:150, dual:150, inst:800,  inverse:150 },
  dc:      { nontd:150, dual:150, inst:250,  inverse:150 }
};

const MT_STD = [15,20,25,30,35,40,45,50,60,70,80,90,100,110,125,150,175,200,225,250,
              300,350,400,450,500,600,700,800,1000,1200,1600,2000,2500,3000,4000,5000,6000];

const GND_EGC = [
  [15,'14','12'], [20,'12','10'], [60,'10','8'], [100,'8','6'], [200,'6','4'],
  [300,'4','2'], [400,'3','1'], [500,'2','1/0'], [600,'1','2/0'], [800,'1/0','3/0'],
  [1000,'2/0','4/0'], [1200,'3/0','250'], [1600,'4/0','350'], [2000,'250','400'],
  [2500,'350','600'], [3000,'400','600'], [4000,'500','750'], [5000,'700','1200'],
  [6000,'800','1250']
];

const GND_CM = {
  '14':4110,'12':6530,'10':10380,'8':16510,'6':26240,'4':41740,'3':52620,'2':66360,
  '1':83690,'1/0':105600,'2/0':133100,'3/0':167800,'4/0':211600,'250':250000,
  '300':300000,'350':350000,'400':400000,'500':500000,'600':600000,'700':700000,
  '750':750000,'900':900000,'1000':1000000,'1100':1100000,'1200':1200000,
  '1250':1250000,'1750':1750000
};

const GND_GEC_CU = [
  [66360,'8','6'], [105600,'6','4'], [167800,'4','2'], [350000,'2','1/0'],
  [600000,'1/0','3/0'], [1100000,'2/0','4/0'], [Infinity,'3/0','250']
];

const GND_GEC_AL = [
  [105600,'8','6'], [167800,'6','4'], [250000,'4','2'], [500000,'2','1/0'],
  [900000,'1/0','3/0'], [1750000,'2/0','4/0'], [Infinity,'3/0','250']
];

const GND_SIZES = ['14','12','10','8','6','4','3','2','1','1/0','2/0','3/0','4/0',
                 '250','300','350','400','500','600','700','750'];

const WW_AREAS = {
  thhn: {'14':0.0097,'12':0.0133,'10':0.0211,'8':0.0366,'6':0.0507,'4':0.0824,'3':0.0973,'2':0.1158,'1':0.1562,'1/0':0.1855,'2/0':0.2223,'3/0':0.2660,'4/0':0.3237,'250':0.3970,'300':0.4608,'350':0.5242,'500':0.7073},
  thw:  {'14':0.0097,'12':0.0133,'10':0.0211,'8':0.0437,'6':0.0590,'4':0.0814,'3':0.0962,'2':0.1146,'1':0.1534,'1/0':0.1825,'2/0':0.2190,'3/0':0.2642,'4/0':0.3197,'250':0.3904,'300':0.4536,'350':0.5166,'500':0.6939},
  xhhw: {'14':0.0097,'12':0.0133,'10':0.0211,'8':0.0366,'6':0.0507,'4':0.0824,'3':0.0973,'2':0.1158,'1':0.1562,'1/0':0.1855,'2/0':0.2223,'3/0':0.2660,'4/0':0.3237,'250':0.3970,'300':0.4608,'350':0.5242,'500':0.7073}
};

module.exports = { AMP_CU, AMP_AL, AMP_TEMP_LOOKUP, CF_AREA, CF_WIRE, BF_VOL, BF_BOXES, BF_ACCESSORIES, BF_ACCESSORY_UNRESOLVED, BF_CATALOG_SOURCES, VD_CM, VD_K, MT_FLC_1PH, MT_V_1PH, MT_FLC_3PH, MT_V_3PH, MT_PCT, MT_STD, GND_EGC, GND_CM, GND_GEC_CU, GND_GEC_AL, GND_SIZES, WW_AREAS };
