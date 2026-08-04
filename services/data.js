const PROFILE_KEY = 'run_club_profile'
const SUBMISSIONS_KEY = 'run_club_submissions'

const monthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const demoMembers = [
  { name: '林晨', target: 100, actual: 82 },
  { name: '周野', target: 80, actual: 76 },
  { name: '安然', target: 60, actual: 61 },
  { name: '陈屿', target: 120, actual: 90 }
]

function getProfile() { return wx.getStorageSync(PROFILE_KEY) || null }
function saveProfile(profile) { wx.setStorageSync(PROFILE_KEY, profile) }
function getSubmissions() { return wx.getStorageSync(SUBMISSIONS_KEY) || [] }
function submitRecord(record) {
  const list = getSubmissions().filter(item => item.month !== record.month)
  list.unshift(record)
  wx.setStorageSync(SUBMISSIONS_KEY, list)
}
function currentSubmission() { return getSubmissions().find(item => item.month === monthKey()) }
function getDashboard() {
  const profile = getProfile()
  const own = currentSubmission()
  const members = [...demoMembers]
  if (profile) members.unshift({ name: profile.name, target: Number(profile.target), actual: own ? Number(own.distance) : 0, isMe: true })
  const totalActual = members.reduce((sum, item) => sum + item.actual, 0)
  const totalTarget = members.reduce((sum, item) => sum + item.target, 0)
  return { month: monthKey(), profile, own, members: members.sort((a, b) => b.actual - a.actual), totalActual, totalTarget }
}

module.exports = { monthKey, getProfile, saveProfile, getSubmissions, submitRecord, currentSubmission, getDashboard }
