const { getMemberHistoricalProfile } = require('../../services/cloud')
const { buildPresentation, numberText } = require('../../services/profile-presentation')
const reviewDemo = require('../../services/review-demo')

Page({
  data: { profile: null, historyYears: [], trendPoints: [], loading: true, selectedMonth: null },
  async onLoad(options = {}) {
    const memberId = options.memberId ? decodeURIComponent(options.memberId) : ''
    if (!memberId) { this.setData({ loading: false }); return }
    try {
      const session = getApp().globalData.session
      const profile = session && session.user && session.user.reviewAccess && !session.user.historicalMemberId
        ? reviewDemo.demoProfile(memberId) : await getMemberHistoricalProfile(memberId)
      const presentation = buildPresentation(profile)
      this.setData({ profile, profileName: profile.displayName || profile.alias, ...presentation,
        average: numberText(profile.averageActualKm), best: numberText(profile.bestActualKm),
        target: numberText(profile.latestTargetKm), loading: false
      }, () => this.drawTrend())
      wx.setNavigationBarTitle({ title: `${profile.displayName || profile.alias}的分析` })
    } catch (error) {
      console.error('读取成员历史失败', error)
      this.setData({ loading: false })
      wx.showToast({ title: '成员数据读取失败', icon: 'none' })
    }
  },
  onResize() { this.drawTrend() },
  toggleYear(event) {
    const year = Number(event.currentTarget.dataset.year)
    this.setData({ historyYears: this.data.historyYears.map(item => item.year === year ? { ...item, expanded: !item.expanded } : item) })
  },
  showMonth(event) {
    const month = event.currentTarget.dataset.month
    const record = this.data.historyYears.flatMap(year => year.months).find(item => item.month === month && !item.placeholder)
    if (record) this.setData({ selectedMonth: { ...record,
      pctText: record.actualText !== '—' && Number(record.targetText) > 0 ? String(record.completionPct) + '%' : '—',
      reviewLabel: record.reviewLabel || '历史台账记录' } })
  },
  closeMonth() { this.setData({ selectedMonth: null }) },
  stopTap() {},
  selectTrend(event) {
    const point = event.touches && event.touches[0] || event.detail
    wx.createSelectorQuery().in(this).select('#trendCanvas').boundingClientRect(rect => {
      if (!rect || !this.data.trendPoints.length) return
      const x = typeof point.x === 'number' ? point.x : point.clientX - rect.left
      const index = Math.max(0, Math.min(this.data.trendPoints.length - 1,
        Math.round((x - 32) / Math.max(1, rect.width - 44) * Math.max(1, this.data.trendPoints.length - 1))))
      this.setData({ selectedTrend: this.data.trendPoints[index] }, () => this.drawTrend())
    }).exec()
  },
  drawTrend() {
    const points = this.data.trendPoints
    if (!points.length) return
    wx.nextTick(() => wx.createSelectorQuery().in(this).select('#trendCanvas').fields({ node: true, size: true }).exec(result => {
      const info = result[0]
      if (!info || !info.node) return
      const { node: canvas, width, height } = info
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)
      const left = 32, top = 18, bottom = height - 28, right = width - 12
      const max = Math.max(20, Math.ceil(Math.max(...points.map(p => Math.max(p.actualKm, p.targetKm || 0))) / 20) * 20)
      const x = i => left + (right - left) * i / Math.max(1, points.length - 1)
      const y = value => bottom - (bottom - top) * value / max
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'right'
      for (let i = 0; i <= 2; i++) {
        const value = max * i / 2
        ctx.fillStyle = '#8A9C90'
        ctx.fillText(String(value), left - 7, y(value) + 3)
        ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.strokeStyle = '#E3ECE5'
        ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke()
      }
      ctx.setLineDash([])
      const fill = ctx.createLinearGradient(0, top, 0, bottom)
      fill.addColorStop(0, 'rgba(63,151,106,.23)'); fill.addColorStop(1, 'rgba(63,151,106,.01)')
      ctx.beginPath(); ctx.moveTo(left, bottom)
      points.forEach((p,i) => ctx.lineTo(x(i), y(p.actualKm)))
      ctx.lineTo(right,bottom); ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
      ctx.beginPath(); ctx.strokeStyle = '#247557'; ctx.lineWidth = 2.3; ctx.lineJoin = 'round'
      points.forEach((p,i) => i ? ctx.lineTo(x(i),y(p.actualKm)) : ctx.moveTo(x(i),y(p.actualKm)))
      ctx.stroke()
      ctx.beginPath(); ctx.strokeStyle = '#9BBBA6'; ctx.lineWidth = 1.5; ctx.setLineDash([5,4])
      let connected = false
      points.forEach((p,i) => {
        if (typeof p.targetKm !== 'number') { connected = false; return }
        if (connected) ctx.lineTo(x(i),y(p.targetKm)); else ctx.moveTo(x(i),y(p.targetKm))
        connected = true
      })
      ctx.stroke(); ctx.setLineDash([])
      points.forEach((p,i) => {
        ctx.beginPath(); ctx.arc(x(i),y(p.actualKm),p.hasActual ? 2 : 3.3,0,Math.PI*2)
        ctx.fillStyle = p.hasActual ? '#247557' : '#FFFFFF'
        ctx.fill(); ctx.strokeStyle = p.statusClass === 'status-leave' ? '#CF8A51' : p.hasActual ? '#247557' : '#C96357'
        ctx.lineWidth = 1.5; ctx.stroke()
      })
      const selected = points.findIndex(p => this.data.selectedTrend && p.month === this.data.selectedTrend.month)
      if (selected >= 0) {
        ctx.beginPath(); ctx.moveTo(x(selected),top); ctx.lineTo(x(selected),bottom)
        ctx.strokeStyle = '#B2CBB9'; ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(x(selected),y(points[selected].actualKm),4,0,Math.PI*2)
        ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#246C50'; ctx.stroke()
      }
      ctx.fillStyle = '#8A9C90'; ctx.textAlign = 'center'
      ;[...new Set([0,Math.round((points.length-1)/3),Math.round((points.length-1)*2/3),points.length-1])].forEach(i => {
        ctx.textAlign = i === 0 ? 'left' : i === points.length-1 ? 'right' : 'center'
        ctx.fillText(points[i].label || points[i].month.slice(2),x(i),height-8)
      })
    }))
  }
})
