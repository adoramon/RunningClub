const round = value => Math.round(value * 100) / 100

const members = [
  { memberId: 'review-demo-1', displayName: '晨跑小熊', actualKm: 82.4, targetKm: 60, pct: 137, toneClass: 'tone-deep-green', ringStyle: 'background:conic-gradient(#166C43 100%,#EAF1EC 0);' },
  { memberId: 'review-demo-2', displayName: '山风', actualKm: 68.2, targetKm: 60, pct: 114, toneClass: 'tone-light-green', ringStyle: 'background:conic-gradient(#65A36F 100%,#EAF1EC 0);' },
  { memberId: 'review-demo-3', displayName: '橙子', actualKm: 51.6, targetKm: 50, pct: 103, toneClass: 'tone-light-green', ringStyle: 'background:conic-gradient(#65A36F 100%,#EAF1EC 0);' },
  { memberId: 'review-demo-4', displayName: '长街', actualKm: 46.8, targetKm: 60, pct: 78, toneClass: 'tone-light-yellow', ringStyle: 'background:conic-gradient(#E7C668 78%,#EAF1EC 0);' }
]

function demoDashboard() {
  return {
    isReviewDemo: true, summaryMonth: '演示月份', completionPct: 109, summaryRingStyle: 'background:conic-gradient(#A9ECA9 100%,rgba(255,255,255,.16) 0);',
    targetMemberCount: 4, actualMemberCount: 4, totalActualText: '249.00', totalTargetText: '230.00', fundBalanceText: '126.00', fundAddedLastMonthText: '0.00',
    myLastMonthSubmitted: true, myPendingFundPayment: null, isAdmin: false,
    lifetime: { totalKmText: '8,426.50', operatingText: '演示数据', comparisons: [{ label: '相当于绕赤道', value: '0.21 圈' }, { label: '相当于北京—上海往返', value: '3.51 趟' }, { label: '相当于北京—广州往返', value: '2.01 趟' }, { label: '相当于北京—拉萨往返', value: '1.12 趟' }] },
    ranking: members.map((member, index) => ({ ...member, targetText: String(member.targetKm), actualText: String(member.actualKm), actualNote: member.pct >= 100 ? '已达成目标' : '已缴纳公积金', actualNoteClass: member.pct >= 100 ? 'status-completed' : 'status-paid', registered: true, isMe: index === 0 }))
  }
}

function monthTile(year, monthNumber, actualKm, targetKm) {
  if (actualKm === null) return { month: `${year}-${String(monthNumber).padStart(2, '0')}`, monthNumber, placeholder: true }
  const pct = Math.round(actualKm / targetKm * 100)
  const achieved = pct >= 100
  return { month: `${year}-${String(monthNumber).padStart(2, '0')}`, monthNumber, actualText: String(actualKm), statusTop: achieved ? '达成' : '已缴', statusBottom: achieved ? '目标' : '基金', statusClass: achieved ? 'status-achieved' : 'status-fund', completionPct: pct, ringTextClass: pct >= 100 ? 'ring-text-wide' : '', ringStyle: `background:conic-gradient(${achieved ? '#3E9962' : '#D3A12A'} ${Math.min(100, pct)}%,rgba(255,255,255,.7) 0);` }
}

function demoProfile(memberId) {
  const member = members.find(item => item.memberId === memberId) || members[0]
  const points = [48, 52, 61, 58, 65, 54, 67, 72, 60, 75, 69, 76, 82, 70, 79, 85, 74, 91, 80, 88, 94, 76, 83, member.actualKm]
  const months = [64, 58, 71, 66, 74, 62, member.actualKm, null, null, null, null, null].map((value, index) => monthTile(2026, index + 1, value, member.targetKm))
  return { memberId: member.memberId, alias: member.displayName, displayName: member.displayName, avatarFileId: '', registered: true, latestTargetKm: member.targetKm, latestTargetMonth: '2026-07', averageActualKm: round(points.reduce((sum, value) => sum + value, 0) / points.length), bestActualKm: Math.max(...points), totalActualKm: 1824.6, totalFundAmountText: member.pct >= 100 ? '0.00' : '39.00', recentTrend: points.map((actualKm, index) => ({ month: `202${index < 5 ? 5 : 6}-${String((index % 12) + 1).padStart(2, '0')}`, label: `${String(24 + Math.floor(index / 12)).padStart(2, '0')}/${String((index % 12) + 1).padStart(2, '0')}`, actualKm })), historyYears: [{ year: 2026, months }], monthlyEvaluation: { title: `${member.displayName}，稳稳向前 ✨`, content: `这是审核体验演示数据：本月完成 ${member.actualKm} km，目标 ${member.targetKm} km。坚持记录、循序渐进，跑步会慢慢成为生活里可靠的小伙伴。🏃`, month: '演示', source: 'review_demo' } }
}

module.exports = { demoDashboard, demoProfile }
