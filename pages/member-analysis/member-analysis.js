const { getMemberHistoricalProfile, generateMonthlyEvaluation } = require('../../services/cloud')

Page({
  data: { profile: null, profileName: '', historyYears: [], average: '—', best: '—', trendHasData: false, evaluationLoading: false, loading: true },
  async onLoad(options) {
    const memberId = options.memberId ? decodeURIComponent(options.memberId) : ''
    if (!memberId) {
      wx.showToast({ title: '成员信息无效', icon: 'none' })
      return
    }
    try {
      const profile = await getMemberHistoricalProfile(memberId)
      const recentTrend = profile.recentTrend || []
      this.setData({
        profile,
        profileName: profile.displayName || profile.alias,
        historyYears: profile.historyYears || [],
        average: profile.averageActualKm === null ? '—' : profile.averageActualKm,
        best: profile.bestActualKm === null ? '—' : profile.bestActualKm,
        trendHasData: recentTrend.some(item => typeof item.actualKm === 'number'),
        loading: false
      }, () => this.drawTrend(recentTrend))
      wx.setNavigationBarTitle({ title: `${profile.displayName || profile.alias}的分析` })
      if (profile.isMe && !profile.monthlyEvaluation) this.loadMonthlyEvaluation()
    } catch (error) {
      console.error('读取成员历史失败', error)
      this.setData({ loading: false })
      wx.showToast({ title: '成员数据读取失败', icon: 'none' })
    }
  }

  ,async loadMonthlyEvaluation() {
    this.setData({ evaluationLoading: true })
    try {
      const { evaluation } = await generateMonthlyEvaluation()
      if (evaluation) this.setData({ 'profile.monthlyEvaluation': evaluation })
    } catch (error) {
      console.warn('读取阶段性评价失败', error)
    } finally {
      this.setData({ evaluationLoading: false })
    }
  }

  ,drawTrend(points) {
    if (!points.some(item => typeof item.actualKm === 'number')) return
    wx.nextTick(() => {
      wx.createSelectorQuery().select('#trendCanvas').fields({ node: true, size: true }).exec(result => {
        const canvasInfo = result[0]
        if (!canvasInfo || !canvasInfo.node) return
        const { node: canvas, width, height } = canvasInfo
        const context = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr
        context.scale(dpr, dpr)
        context.clearRect(0, 0, width, height)

        const padding = { left: 16, right: 12, top: 18, bottom: 32 }
        const chartWidth = width - padding.left - padding.right
        const chartHeight = height - padding.top - padding.bottom
        const values = points.filter(item => typeof item.actualKm === 'number').map(item => item.actualKm)
        const maxValue = Math.max(20, Math.ceil(Math.max(...values) / 20) * 20)
        const xFor = index => padding.left + chartWidth * index / (points.length - 1)
        const yFor = value => padding.top + chartHeight * (1 - value / maxValue)

        context.save()
        context.strokeStyle = 'rgba(31,111,84,0.12)'
        context.lineWidth = 1
        context.setLineDash([3, 4])
        for (let index = 0; index < 3; index += 1) {
          const y = padding.top + chartHeight * index / 2
          context.beginPath()
          context.moveTo(padding.left, y)
          context.lineTo(width - padding.right, y)
          context.stroke()
        }
        context.restore()

        const segments = []
        let segment = []
        points.forEach((item, index) => {
          if (typeof item.actualKm === 'number') segment.push({ x: xFor(index), y: yFor(item.actualKm), value: item.actualKm })
          else if (segment.length) { segments.push(segment); segment = [] }
        })
        if (segment.length) segments.push(segment)

        segments.forEach(items => {
          if (items.length > 1) {
            const area = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight)
            area.addColorStop(0, 'rgba(62,153,98,0.30)')
            area.addColorStop(1, 'rgba(62,153,98,0.02)')
            context.beginPath()
            context.moveTo(items[0].x, padding.top + chartHeight)
            items.forEach(item => context.lineTo(item.x, item.y))
            context.lineTo(items[items.length - 1].x, padding.top + chartHeight)
            context.closePath()
            context.fillStyle = area
            context.fill()
          }
          context.beginPath()
          items.forEach((item, index) => index ? context.lineTo(item.x, item.y) : context.moveTo(item.x, item.y))
          context.strokeStyle = '#247346'
          context.lineWidth = 2.5
          context.lineJoin = 'round'
          context.lineCap = 'round'
          context.stroke()
          items.forEach(item => {
            context.beginPath()
            context.arc(item.x, item.y, 3.3, 0, Math.PI * 2)
            context.fillStyle = '#FFFFFF'
            context.fill()
            context.beginPath()
            context.arc(item.x, item.y, 2, 0, Math.PI * 2)
            context.fillStyle = '#3E9962'
            context.fill()
          })
        })

        context.fillStyle = '#9BAAA0'
        context.font = '10px sans-serif'
        context.textAlign = 'center'
        ;[0, 7, 15, 23].forEach(index => context.fillText(points[index].label, xFor(index), height - 10))
        context.textAlign = 'right'
        context.fillStyle = '#78A088'
        context.font = '9px sans-serif'
        context.fillText(`${maxValue} km`, width - padding.right, padding.top - 5)
      })
    })
  }
})
