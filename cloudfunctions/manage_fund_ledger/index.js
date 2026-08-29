const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ADMIN_MEMBER_IDS = new Set(['legacy-member-001', 'legacy-member-023'])
const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const roundMoney = value => Math.round(Number(value) * 100) / 100

function currentMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return `${chinaNow.getUTCFullYear()}-${String(chinaNow.getUTCMonth() + 1).padStart(2, '0')}`
}

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  const result = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = result.data[0]
  if (!user || !user.historicalMemberId) throw new Error('请先完成历史艺名认领')
  return user
}

function publicEntry(entry) {
  const amount = roundMoney(entry.amount || 0)
  const typeLabel = {
    opening_balance: '历史结转余额', member_payment: '成员缴纳公积金', admin_withdrawal: '管理员支取',
    legacy_monthly_income: '历史月度收入', legacy_expense: '历史支取',
    expense: '跑团支出', refund: '公积金返还', adjustment: '余额调整'
  }[entry.entryType] || '公积金流水'
  const date = entry.occurredAt instanceof Date ? entry.occurredAt : null
  return {
    entryId: entry._id, month: entry.month || '',
    dateLabel: date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : (entry.month || '历史记录'),
    entryType: entry.entryType, typeLabel, amount, amountText: `${amount > 0 ? '+' : ''}${amount.toFixed(2)}`,
    direction: amount > 0 ? 'income' : amount < 0 ? 'expense' : 'neutral',
    purpose: entry.purpose || entry.note || '—', operatorAlias: entry.withdrawnByAlias || entry.confirmedByAlias || ''
  }
}

async function confirmedEntries(source = db) {
  const result = await source.collection('fund_ledger').where({ status: 'confirmed' }).limit(100).get()
  return result.data
}

function summarize(entries) {
  const balance = roundMoney(entries.reduce((sum, entry) => sum + (isNumber(entry.amount) ? entry.amount : 0), 0))
  const income = roundMoney(entries.filter(entry => entry.entryType !== 'opening_balance' && isNumber(entry.amount) && entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0))
  const withdrawal = roundMoney(entries.filter(entry => entry.entryType !== 'opening_balance' && isNumber(entry.amount) && entry.amount < 0).reduce((sum, entry) => sum + Math.abs(entry.amount), 0))
  return { balance, income, withdrawal }
}

function monthLabel(month) { return month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月` : '历史记录' }

function buildMonthlyYears(entries) {
  const months = [...new Set(entries.map(entry => entry.month).filter(Boolean))].sort()
  if (!months.length) return []
  const firstMonth = months[0]
  const lastMonth = months[months.length - 1]
  const entriesByMonth = new Map()
  entries.forEach(entry => {
    if (!entry.month) return
    const list = entriesByMonth.get(entry.month) || []
    list.push(entry)
    entriesByMonth.set(entry.month, list)
  })
  const [firstYear] = firstMonth.split('-').map(Number)
  const [lastYear] = lastMonth.split('-').map(Number)
  let balance = 0
  const summaries = new Map()
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`
      if (key < firstMonth || key > lastMonth) continue
      const records = entriesByMonth.get(key) || []
      const opening = records.filter(entry => entry.entryType === 'opening_balance').reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      const income = records.filter(entry => entry.entryType !== 'opening_balance' && Number(entry.amount || 0) > 0).reduce((sum, entry) => sum + Number(entry.amount), 0)
      const expense = records.filter(entry => entry.entryType !== 'opening_balance' && Number(entry.amount || 0) < 0).reduce((sum, entry) => sum + Math.abs(Number(entry.amount)), 0)
      balance = roundMoney(balance + records.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
      summaries.set(key, { month: key, monthNumber: month, hasData: records.length > 0, openingText: opening ? `${opening > 0 ? '+' : ''}${opening.toFixed(0)}` : '', incomeText: income ? `+${income.toFixed(0)}` : '—', expenseText: expense ? `-${expense.toFixed(0)}` : '—', balanceText: balance.toFixed(0), toneClass: balance < 0 ? 'status-deficit' : 'status-surplus' })
    }
  }
  const years = []
  for (let year = lastYear; year >= firstYear; year -= 1) {
    const yearMonths = Array.from({ length: 12 }, (_, index) => summaries.get(`${year}-${String(index + 1).padStart(2, '0')}`) || { month: `${year}-${String(index + 1).padStart(2, '0')}`, monthNumber: index + 1, placeholder: true })
    if (yearMonths.some(item => !item.placeholder)) years.push({ year, months: yearMonths })
  }
  return years
}

async function listLedger(user) {
  const entries = await confirmedEntries()
  const summary = summarize(entries)
  const items = entries.map(publicEntry).sort((a, b) => String(b.month).localeCompare(String(a.month)) || b.entryId.localeCompare(a.entryId))
  const recentMonth = [...new Set(entries.map(entry => entry.month).filter(Boolean))].sort().pop() || ''
  return {
    isAdmin: ADMIN_MEMBER_IDS.has(user.historicalMemberId), balance: summary.balance, balanceText: summary.balance.toFixed(2),
    incomeText: summary.income.toFixed(2), withdrawalText: summary.withdrawal.toFixed(2),
    recentMonth, recentMonthLabel: monthLabel(recentMonth), recentEntries: items.filter(item => item.month === recentMonth), monthlyYears: buildMonthlyYears(entries)
  }
}

exports.main = async (event = {}) => {
  const user = await currentUser()
  const action = String(event.action || 'list')
  if (action === 'list') return listLedger(user)
  if (action !== 'withdraw') throw new Error('不支持的公积金操作')
  if (!ADMIN_MEMBER_IDS.has(user.historicalMemberId)) throw new Error('仅管理员高翔或元可提取公积金')

  const amount = roundMoney(event.amount)
  const purpose = String(event.purpose || '').trim().replace(/\s+/g, ' ')
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('请输入 0 到 100,000 之间的有效提取金额')
  if (purpose.length < 2 || purpose.length > 100) throw new Error('请填写 2 到 100 字的提取用途')
  const operatorAlias = user.historicalMemberId === 'legacy-member-023' ? '高翔' : '元'

  await db.runTransaction(async transaction => {
    const entries = await confirmedEntries(transaction)
    const { balance } = summarize(entries)
    if (amount > balance) throw new Error(`当前可支取公积金仅 ¥${balance.toFixed(2)}`)
    await transaction.collection('fund_ledger').add({ data: {
      month: currentMonth(), entryType: 'admin_withdrawal', amount: -amount, status: 'confirmed', purpose,
      note: `管理员支取：${purpose}`, withdrawnByUserId: user._id, withdrawnByAlias: operatorAlias,
      occurredAt: db.serverDate(), createdAt: db.serverDate()
    } })
  })
  return { withdrawn: true, amount, purpose }
}
