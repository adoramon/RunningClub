const assert = require('node:assert/strict')
const { toEquivalentKm, settleMonth, calculateFundBalance } = require('../services/rules')

assert.equal(toEquivalentKm({ activityType: 'cycling', rawValue: 30 }), 10)
assert.equal(toEquivalentKm({ activityType: 'swimming', rawValue: 2 }), 10)
assert.equal(toEquivalentKm({ activityType: 'jump_rope', rawValue: 1600 }), 16)
assert.equal(toEquivalentKm({ activityType: 'elevation', rawValue: 800 }), 16)

assert.deepEqual(settleMonth({ targetKm: 60, equivalentKm: 60 }), { targetKm: 60, equivalentKm: 60, shortfallKm: 0, isCompleted: true, failureStreak: 0, fundRatePerKm: 0, fundDue: 0 })
assert.equal(settleMonth({ targetKm: 60, equivalentKm: 30, previousFailureStreak: 0 }).fundDue, 90)
assert.equal(settleMonth({ targetKm: 60, equivalentKm: 20, previousFailureStreak: 1 }).fundDue, 240)
assert.equal(settleMonth({ targetKm: 60, equivalentKm: 50, previousFailureStreak: 2 }).fundDue, 90)
assert.equal(settleMonth({ targetKm: 60, equivalentKm: 65, previousFailureStreak: 3 }).failureStreak, 0)
assert.equal(calculateFundBalance(-257, [{ amount: 90 }, { amount: -30 }]), -197)

console.log('规则测试通过')
