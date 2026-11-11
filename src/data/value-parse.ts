/** Reading single cell values (pure): numbers in the usual notations, dates, yes/no. Fast paths first, because a file can hold hundreds of millions of cells. */

const NUMBER_PLAIN = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;
const NUMBER_US = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const NUMBER_EU = /^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const NUMBER_SPACED = /^[+-]?\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?$/;

/** Plain digits with at most one decimal separator (the bulk of real data) without a regular expression; null when the cell needs the full rules. */
function quickNumber(cell: string, from: number): number | null {
  let digits = 0, separators = 0;
  for (let index = from; index < cell.length; index++) {
    const code = cell.charCodeAt(index);
    if (code >= 48 && code <= 57) digits++;
    else if (code === 46 || code === 44) separators++;
    else return code === 101 || code === 69 || code === 32 || code === 160 || code === 8239 ? null : NaN;
  }
  if (digits === 0) return NaN;
  if (separators === 0) return Number(cell);
  if (separators > 1) return null;
  const last = cell.charCodeAt(cell.length - 1);
  return last >= 48 && last <= 57 ? Number(cell.replace(",", ".")) : NaN;
}

/** The number a cell holds, or NaN. Accepts 12, -3.5, 3,5, 1,234.50, 1.234,50, 1 234,5 and 1e6; never an empty cell or text. */
export function parseNumber(cell: string): number {
  const length = cell.length;
  const first = cell.charCodeAt(0);
  // Digits, signs and decimal points only: everything else (the common case for text columns) is rejected at once.
  if (length > 40 || !((first >= 48 && first <= 57) || first === 43 || first === 45 || first === 46 || first === 44)) return NaN;
  const quick = quickNumber(cell, first === 43 || first === 45 ? 1 : 0);
  if (quick !== null) return quick;
  const text = cell.trim();
  if (NUMBER_PLAIN.test(text)) return Number(text.replace(",", "."));
  if (NUMBER_US.test(text)) return Number(text.replace(/,/g, ""));
  if (NUMBER_EU.test(text)) return Number(text.replace(/\./g, "").replace(",", "."));
  if (NUMBER_SPACED.test(text)) return Number(text.replace(/[   ]/g, "").replace(",", "."));
  return NaN;
}

const DATE_ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/;

const MS_PER_DAY = 86_400_000;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day number (days since 1970-01-01, UTC) of a calendar date, or NaN when the date does not exist. Plain arithmetic: no Date objects, because dates are parsed by the million. */
function dayOf(year: number, month: number, day: number): number {
  if (month < 1 || month > 12 || day < 1 || year < 1000) return NaN;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (day > (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1])) return NaN;
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400), yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear - 719468;
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** YYYY-MM-DD (or with /) at the start of the cell, with nothing or a time after it: no regular expression. undefined when the cell is in another shape. */
function quickDay(cell: string): number | undefined {
  if (cell.length < 10) return undefined;
  const at = (index: number) => cell.charCodeAt(index);
  const separator = at(4);
  if ((separator !== 45 && separator !== 47) || at(7) !== separator) return undefined;
  if (!isDigit(at(0)) || !isDigit(at(1)) || !isDigit(at(2)) || !isDigit(at(3)) || !isDigit(at(5)) || !isDigit(at(6)) || !isDigit(at(8)) || !isDigit(at(9))) return undefined;
  if (cell.length > 10 && at(10) !== 32 && at(10) !== 84) return undefined;
  const digit = (index: number) => at(index) - 48;
  const year = digit(0) * 1000 + digit(1) * 100 + digit(2) * 10 + digit(3);
  const day = dayOf(year, digit(5) * 10 + digit(6), digit(8) * 10 + digit(9));
  return cell.length > 10 && day !== day ? undefined : day;
}

/** The day number of a date cell (2024-03-15, 2024-03-15 08:30, 15.03.2024, 15/03/2024), or NaN. Time of day is ignored. */
export function parseDay(cell: string): number {
  const first = cell.charCodeAt(0);
  if (first < 48 || first > 57 || cell.length < 8 || cell.length > 35) return NaN;
  const quick = quickDay(cell);
  if (quick !== undefined) return quick;
  const text = cell.trim();
  const iso = DATE_ISO.exec(text);
  if (iso) return dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DATE_DMY.exec(text);
  return dmy ? dayOf(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) : NaN;
}

/** The ISO date (YYYY-MM-DD) of a day number. */
export function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

const TRUE_WORDS = new Set(["true", "yes", "tak", "y", "t"]);
const FALSE_WORDS = new Set(["false", "no", "nie", "n", "f"]);

/** True or false for a yes/no word (true/false, yes/no, tak/nie), null for any other cell. Digits are numbers, not booleans. */
export function parseBoolean(cell: string): boolean | null {
  if (cell.length > 5) return null;
  if (TRUE_WORDS.has(cell)) return true;
  if (FALSE_WORDS.has(cell)) return false;
  const word = cell.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  return FALSE_WORDS.has(word) ? false : null;
}

/** A number for the screen: grouping spaces, at most `digits` significant decimals, exponent form for the very large and very small. */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-4)) return value.toExponential(2);
  const rounded = Number(value.toFixed(abs >= 1000 ? 0 : digits));
  return rounded.toLocaleString("pl-PL", { maximumFractionDigits: abs >= 1000 ? 0 : digits });
}
