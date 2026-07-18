function daysInMonthOf(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// First-month fee prorated to days remaining in the month from the join date.
function proratedFirstMonthFee(joinDate, monthlyFee) {
  const d = new Date(joinDate);
  const dim = daysInMonthOf(d);
  const remaining = dim - d.getDate() + 1;
  return { amount: Math.round((monthlyFee / dim) * remaining), remaining, dim };
}

// ₹25/day fine for any payment made after the 5th of the month.
function lateFineFor(date) {
  const d = new Date(date);
  const day = d.getDate();
  return day > 5 ? (day - 5) * 25 : 0;
}

function lastDayOfMonthISO(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

// Days remaining until the 1st of next month — used for the vacate-notice refund rule.
function daysUntilNextMonthStart(date) {
  const d = new Date(date);
  const nextMonthStart = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return Math.ceil((nextMonthStart - d) / (1000 * 60 * 60 * 24));
}

const ADVANCE_REFUND = 300;
const SEAT_CHANGE_FEE = 100;

module.exports = { daysInMonthOf, proratedFirstMonthFee, lateFineFor, lastDayOfMonthISO, daysUntilNextMonthStart, ADVANCE_REFUND, SEAT_CHANGE_FEE };
