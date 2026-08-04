const FUND_RATE_STEP = 3

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

function assertNonNegative(value, label) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${label} 必须是非负数字`)
}

function toEquivalentKm({ activityType, rawValue, conversionFactor }) {
  assertNonNegative(rawValue, '运动量')
  const value = Number(rawValue)
  const factors = { running: 1, cycling: 1 / 3, swimming: 5, jump_rope: 1 / 100, elevation: 0.02 }
  const factor = activityType === 'custom' ? Number(conversionFactor) : factors[activityType]
  if (!Number.isFinite(factor) || factor < 0) throw new Error('不支持的运动类型或换算系数')
  return round(value * factor)
}

function settleMonth({ targetKm, equivalentKm, previousFailureStreak = 0 }) {
  assertNonNegative(targetKm, '承诺跑量')
  assertNonNegative(equivalentKm, '等效跑量')
  if (!Number.isInteger(Number(previousFailureStreak)) || Number(previousFailureStreak) < 0) throw new Error('连续未达标次数必须是非负整数')

  const target = Number(targetKm)
  const actual = Number(equivalentKm)
  if (actual >= target) return { targetKm: target, equivalentKm: actual, shortfallKm: 0, isCompleted: true, failureStreak: 0, fundRatePerKm: 0, fundDue: 0 }

  const failureStreak = Number(previousFailureStreak) + 1
  const shortfallKm = round(target - actual)
  const fundRatePerKm = FUND_RATE_STEP * failureStreak
  return { targetKm: target, equivalentKm: actual, shortfallKm, isCompleted: false, failureStreak, fundRatePerKm, fundDue: round(shortfallKm * fundRatePerKm) }
}

function calculateFundBalance(openingBalance, entries) {
  if (!Number.isFinite(Number(openingBalance))) throw new Error('期初公积金余额必须是数字')
  const total = entries.reduce((sum, entry) => {
    if (!Number.isFinite(Number(entry.amount))) throw new Error('公积金流水金额必须是数字')
    return sum + Number(entry.amount)
  }, Number(openingBalance))
  return round(total)
}

module.exports = { FUND_RATE_STEP, toEquivalentKm, settleMonth, calculateFundBalance }
