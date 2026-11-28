'use strict';
/**
 * Battery / power-station runtime from an energy capacity in Wh.
 * Pure and deterministic: no DOM, no storage, no network, no clock.
 *
 *   availableWh = capacityWh × (chargePercent / 100) × (usablePercent / 100)
 *   averageW    = W                          mode 'w'        (already an average)
 *               = kWh/day  × 1000 / 24       mode 'kwh_day'  (measured energy per day)
 *               = kWh/year × 1000 / 8760     mode 'kwh_year' (energy label, 365 × 24 h)
 *   hours       = availableWh / averageW
 *
 * usablePercent is an EDITABLE ESTIMATE that allows for conversion losses. It is
 * not a certified efficiency and not a universal constant. A measured kWh/day or
 * a label kWh/year already contains the appliance's on/off cycling, so no duty
 * cycle is applied here and losses are applied exactly once.
 *
 * This module answers "how long", never "will it start": output type, continuous
 * power and start-up surge are outside its scope.
 *
 * The UI only reads the result of calculateBatteryRuntime(): numbers, the
 * validation errors and every user-facing string are produced here.
 *
 * TEXT LANGUAGE: the optional second argument of calculateBatteryRuntime() and
 * describeDuration() selects the language of the strings only. Omitted (or
 * anything but 'en') gives the original Polish text, byte for byte, so every
 * existing caller is unchanged; 'en' gives the English text shown by the form.
 * Numbers, codes, fields and every non-text member are identical in both.
 */

const HOURS_PER_DAY = 24;
const HOURS_PER_YEAR = 365 * 24;

const MODES = Object.freeze(['w', 'kwh_day', 'kwh_year']);
const MODE_UNITS = Object.freeze({ w: 'W', kwh_day: 'kWh/dobę', kwh_year: 'kWh/rok' });
/** The same units in English, used only by the 'en' text. */
const MODE_UNITS_EN = Object.freeze({ w: 'W', kwh_day: 'kWh/day', kwh_year: 'kWh/year' });

/** Field values of an untouched calculator. Capacity and consumption are deliberately blank. */
const DEFAULTS = Object.freeze({
  capacityWh: '', consumptionMode: 'w', consumption: '', chargePercent: '100', usablePercent: '85',
});

/** Illustrative example only — NOT the specification of any real refrigerator and never a default. */
const EXAMPLE_FRIDGE = Object.freeze({
  capacityWh: '1000', consumptionMode: 'kwh_year', consumption: '365', chargePercent: '100', usablePercent: '85',
});

/** Practical bounds. Anything beyond them is rejected instead of being rendered as a huge or non-finite number. */
const LIMITS = Object.freeze({
  maxCapacityWh: 10000000, // 10 MWh
  maxAverageW: 1000000, //    1 MW average
  maxHours: 876000, //        100 years
});

/** Whole value only: digits with at most one decimal comma or dot. No exponent, no grouping, no trailing text. */
const NUMBER_RE = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;

/**
 * Strict decimal parsing of one field.
 * Accepts a finite number, or a string such as "1000", "1.2", "1,2", ".5".
 * @returns {{ok: true, value: number} | {ok: false, code: 'REQUIRED'|'INVALID_NUMBER'|'OUT_OF_RANGE'}}
 */
function parseDecimal(raw) {
  if (raw === undefined || raw === null) return { ok: false, code: 'REQUIRED' };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { ok: true, value: raw + 0 } : { ok: false, code: 'INVALID_NUMBER' };
  }
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_NUMBER' };
  const text = raw.trim();
  if (text === '') return { ok: false, code: 'REQUIRED' };
  if (!NUMBER_RE.test(text)) return { ok: false, code: 'INVALID_NUMBER' };
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value: value + 0 }; // + 0 turns -0 into 0
}

/** Display formatting with a decimal comma: 41.6667 -> "41,67", 850 -> "850", 0.0125 -> "0,013". */
function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs < 0.001) return '< 0,001';
  let text = abs < 1 ? abs.toFixed(3) : abs.toFixed(2);
  if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return (value < 0 ? '-' : '') + text.replace('.', ',');
}

/**
 * Human duration for a finite, non-negative number of hours.
 *   0                 -> "0 h"                (kind 'zero')
 *   below one minute  -> "Mniej niż 1 min"    (kind 'under_minute'; never shown as 0 h)
 *   below 48 h        -> "Około 20 h 24 min"  (kind 'hours_minutes', nearest minute)
 *   48 h and longer   -> "Około 3 dni 5 h"    (kind 'days_hours', nearest hour)
 * With lang 'en' only the text differs: "Less than 1 min", "About 20 h 24 min", "About 3 d 5 h".
 */
function describeDuration(hours, lang) {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return null;
  const en = lang === 'en';
  const about = en ? 'About ' : 'Około ';
  if (hours === 0) return { kind: 'zero', days: 0, hours: 0, minutes: 0, text: '0 h' };
  const exactMinutes = hours * 60;
  if (exactMinutes < 1) return { kind: 'under_minute', days: 0, hours: 0, minutes: 0, text: en ? 'Less than 1 min' : 'Mniej niż 1 min' };
  const totalMinutes = Math.round(exactMinutes);
  if (totalMinutes < 48 * 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return { kind: 'hours_minutes', days: 0, hours: h, minutes: m, text: h === 0 ? about + m + ' min' : about + h + ' h ' + m + ' min' };
  }
  const totalHours = Math.round(hours);
  const d = Math.floor(totalHours / HOURS_PER_DAY);
  const rest = totalHours % HOURS_PER_DAY;
  return { kind: 'days_hours', days: d, hours: rest, minutes: 0, text: about + d + (en ? ' d ' : ' dni ') + rest + ' h' };
}

function toAverageW(mode, consumption) {
  if (mode === 'w') return consumption;
  if (mode === 'kwh_day') return (consumption * 1000) / HOURS_PER_DAY;
  if (mode === 'kwh_year') return (consumption * 1000) / HOURS_PER_YEAR;
  return NaN;
}

const FIELD_LABEL = Object.freeze({
  capacityWh: 'Pojemność', consumption: 'Zużycie', chargePercent: 'Naładowanie', usablePercent: 'Energia użyteczna',
});
const FIELD_LABEL_EN = Object.freeze({
  capacityWh: 'Capacity', consumption: 'Consumption', chargePercent: 'Charge', usablePercent: 'Usable energy',
});

function err(field, code, message) { return { field, code, message }; }

/** English text of the same parse errors; same fields and codes as the Polish branch below. */
function parseErrorEn(field, code, unit) {
  if (code === 'REQUIRED') {
    if (field === 'capacityWh') return err(field, code, 'Enter the battery capacity in Wh.');
    if (field === 'consumption') return err(field, code, unit ? 'Enter the consumption in ' + unit + '.' : 'Enter the consumption.');
    if (field === 'chargePercent') return err(field, code, 'Enter the charge in % (0–100).');
    return err(field, code, 'Enter the usable energy in % (e.g. 85).');
  }
  if (code === 'OUT_OF_RANGE') return err(field, code, FIELD_LABEL_EN[field] + ': the number is outside the supported range.');
  const example = (field === 'chargePercent' || field === 'usablePercent') ? '85' : '1000 or 1.2';
  return err(field, 'INVALID_NUMBER', FIELD_LABEL_EN[field] + ': enter just a number, e.g. ' + example + '.');
}

function parseError(field, code, unit, en) {
  if (en) return parseErrorEn(field, code, unit);
  if (code === 'REQUIRED') {
    if (field === 'capacityWh') return err(field, code, 'Wpisz pojemność baterii w Wh.');
    if (field === 'consumption') return err(field, code, unit ? 'Wpisz zużycie w ' + unit + '.' : 'Wpisz zużycie.');
    if (field === 'chargePercent') return err(field, code, 'Wpisz naładowanie w % (0–100).');
    return err(field, code, 'Wpisz energię użyteczną w % (np. 85).');
  }
  if (code === 'OUT_OF_RANGE') return err(field, code, FIELD_LABEL[field] + ': liczba poza obsługiwanym zakresem.');
  const example = (field === 'chargePercent' || field === 'usablePercent') ? '85' : '1000 albo 1,2';
  return err(field, 'INVALID_NUMBER', FIELD_LABEL[field] + ': wpisz samą liczbę, np. ' + example + '.');
}

/**
 * @param {{capacityWh: *, consumptionMode: string, consumption: *, chargePercent?: *, usablePercent?: *}} input
 *   Raw field values (strings as typed, or numbers). chargePercent / usablePercent fall back to DEFAULTS only
 *   when the key is undefined; an empty string is a missing required value.
 * @param {string} [lang] 'en' for English text; omitted or anything else keeps the original Polish text.
 *   Only strings (error messages, data.text, data.duration.text, data.consumptionUnit) depend on it.
 * @returns {{ok: true, errors: [], data: object} | {ok: false, errors: {field, code, message}[], data: null}}
 */
function calculateBatteryRuntime(input, lang) {
  const src = input && typeof input === 'object' ? input : {};
  const en = lang === 'en';
  const errors = [];

  const capacity = parseDecimal(src.capacityWh);
  if (!capacity.ok) errors.push(parseError('capacityWh', capacity.code, undefined, en));
  else if (!(capacity.value > 0)) errors.push(err('capacityWh', 'NOT_POSITIVE', en ? 'Capacity must be greater than 0 Wh.' : 'Pojemność musi być większa od 0 Wh.'));
  else if (capacity.value > LIMITS.maxCapacityWh) errors.push(err('capacityWh', 'OUT_OF_RANGE', en ? 'Capacity is out of range (max. 10,000,000 Wh).' : 'Pojemność poza zakresem (maks. 10 000 000 Wh).'));

  const mode = src.consumptionMode;
  const modeOk = typeof mode === 'string' && MODES.indexOf(mode) !== -1;
  const unit = modeOk ? (en ? MODE_UNITS_EN : MODE_UNITS)[mode] : null;
  if (!modeOk) errors.push(err('consumptionMode', 'INVALID_MODE', en ? 'Choose how the consumption is given: W, kWh/day or kWh/year.' : 'Wybierz sposób podania zużycia: W, kWh/dobę albo kWh/rok.'));

  const consumption = parseDecimal(src.consumption);
  let averageW = null;
  if (!consumption.ok) errors.push(parseError('consumption', consumption.code, unit, en));
  else if (!(consumption.value > 0)) errors.push(err('consumption', 'NOT_POSITIVE', (en ? 'Consumption must be greater than 0' : 'Zużycie musi być większe od 0') + (unit ? ' ' + unit : '') + '.'));
  else if (modeOk) {
    averageW = toAverageW(mode, consumption.value);
    if (!Number.isFinite(averageW) || !(averageW > 0) || averageW > LIMITS.maxAverageW) {
      averageW = null;
      errors.push(err('consumption', 'OUT_OF_RANGE', en ? 'Consumption is outside the supported range (max. 1,000,000 W on average).' : 'Zużycie poza obsługiwanym zakresem (średnio maks. 1 000 000 W).'));
    }
  }

  const charge = parseDecimal(src.chargePercent === undefined ? DEFAULTS.chargePercent : src.chargePercent);
  if (!charge.ok) errors.push(parseError('chargePercent', charge.code, undefined, en));
  else if (charge.value < 0 || charge.value > 100) errors.push(err('chargePercent', 'OUT_OF_RANGE', en ? 'Charge must be between 0 and 100%.' : 'Naładowanie musi być w zakresie 0–100%.'));

  const usable = parseDecimal(src.usablePercent === undefined ? DEFAULTS.usablePercent : src.usablePercent);
  if (!usable.ok) errors.push(parseError('usablePercent', usable.code, undefined, en));
  else if (!(usable.value > 0) || usable.value > 100) errors.push(err('usablePercent', 'OUT_OF_RANGE', en ? 'Usable energy must be greater than 0% and not more than 100%.' : 'Energia użyteczna musi być większa od 0% i nie większa niż 100%.'));

  if (errors.length) return { ok: false, errors, data: null };

  const availableWh = capacity.value * (charge.value / 100) * (usable.value / 100);
  const hours = availableWh / averageW;
  if (!Number.isFinite(availableWh) || availableWh < 0 || !Number.isFinite(hours) || hours < 0) {
    return { ok: false, errors: [err('consumption', 'RESULT_NOT_FINITE', en ? 'The result cannot be calculated from these values.' : 'Nie można policzyć wyniku z tych wartości.')], data: null };
  }
  if (hours > LIMITS.maxHours) {
    return { ok: false, errors: [err('consumption', 'RUNTIME_OUT_OF_RANGE', en ? 'The result is over 100 years — check the consumption and its unit.' : 'Wynik ponad 100 lat — sprawdź zużycie i jego jednostkę.')], data: null };
  }

  const duration = describeDuration(hours, lang);
  if (en) {
    // English text of the same result. The decimal comma of formatNumber() becomes a decimal point; nothing is recalculated.
    const num = (value) => formatNumber(value).replace(',', '.');
    const ce = num(consumption.value);
    return {
      ok: true,
      errors: [],
      data: {
        capacityWh: capacity.value,
        chargePercent: charge.value,
        usablePercent: usable.value,
        consumptionMode: mode,
        consumption: consumption.value,
        consumptionUnit: unit,
        availableWh,
        averageW,
        hours,
        duration,
        text: {
          duration: duration.kind === 'zero' ? '0 h — battery empty' : duration.text,
          availableWh: num(availableWh) + ' Wh',
          availableBasis: num(capacity.value) + ' Wh × ' + num(charge.value) + '% × ' + num(usable.value) + '%',
          averageW: num(averageW) + ' W',
          averageBasis: mode === 'w' ? 'stated average power'
            : mode === 'kwh_day' ? ce + ' kWh/day × 1000 ÷ 24 h'
              : ce + ' kWh/year × 1000 ÷ 8760 h',
          assumptions: 'Assumptions: charge ' + num(charge.value) + '%, usable energy ' + num(usable.value)
            + '% (editable loss estimate), constant average draw ' + num(averageW) + ' W.',
        },
      },
    };
  }
  const c = formatNumber(consumption.value);
  const averageBasis = mode === 'w' ? 'podana średnia moc'
    : mode === 'kwh_day' ? c + ' kWh/dobę × 1000 ÷ 24 h'
      : c + ' kWh/rok × 1000 ÷ 8760 h';

  return {
    ok: true,
    errors: [],
    data: {
      capacityWh: capacity.value,
      chargePercent: charge.value,
      usablePercent: usable.value,
      consumptionMode: mode,
      consumption: consumption.value,
      consumptionUnit: unit,
      availableWh,
      averageW,
      hours,
      duration,
      text: {
        duration: duration.kind === 'zero' ? '0 h — bateria rozładowana' : duration.text,
        availableWh: formatNumber(availableWh) + ' Wh',
        availableBasis: formatNumber(capacity.value) + ' Wh × ' + formatNumber(charge.value) + '% × ' + formatNumber(usable.value) + '%',
        averageW: formatNumber(averageW) + ' W',
        averageBasis,
        assumptions: 'Założenia: naładowanie ' + formatNumber(charge.value) + '%, energia użyteczna ' + formatNumber(usable.value)
          + '% (edytowalny szacunek strat), stały średni pobór ' + formatNumber(averageW) + ' W.',
      },
    },
  };
}

module.exports = {
  HOURS_PER_DAY, HOURS_PER_YEAR, MODES, MODE_UNITS, MODE_UNITS_EN, DEFAULTS, EXAMPLE_FRIDGE, LIMITS,
  parseDecimal, formatNumber, describeDuration, calculateBatteryRuntime,
};
