const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAGE_SIZE = 100

function previousMonth() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function subtractMonths(month, count) {
  const [year, monthNumber] = String(month).split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 - count, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function evidenceFileIdsFor(record) {
  return [...new Set([
    ...(Array.isArray(record && record.evidenceFileIds) ? record.evidenceFileIds : []),
    ...(Array.isArray(record && record.previousEvidenceFileIds) ? record.previousEvidenceFileIds : []),
    record && record.evidenceFileId
  ].filter(fileId => String(fileId || '').startsWith('cloud://')))]
}

async function deleteEvidenceFiles(record) {
  const fileList = evidenceFileIdsFor(record)
  if (!fileList.length) return 0
  const result = await cloud.deleteFile({ fileList })
  const failed = (result.fileList || []).filter(item => Number(item.status) !== 0 && !/not\s*exist|nosuchkey|不存在/i.test(String(item.errMsg || '')))
  if (failed.length) throw new Error(`记录 ${record._id} 有 ${failed.length} 张截图删除失败`)
  return fileList.length
}

async function purgeRecord(record, cutoffMonth) {
  const deletedFiles = await deleteEvidenceFiles(record)
  await db.collection('activity_records').doc(record._id).update({ data: {
    evidenceFileId: '', evidenceFileIds: [], previousEvidenceFileIds: [],
    evidencePurgedReason: 'retention_3_months', evidenceRetentionCutoffMonth: cutoffMonth,
    evidencePurgedAt: db.serverDate(), updatedAt: db.serverDate()
  } })
  return deletedFiles
}

exports.main = async () => {
  const latestSubmissionMonth = previousMonth()
  // 包含最近三个提交月份：本月对应的上月、再往前两个月。
  const cutoffMonth = subtractMonths(latestSubmissionMonth, 2)
  let offset = 0
  let scannedRecords = 0
  let purgedRecords = 0
  let deletedFiles = 0
  const failures = []

  while (true) {
    const page = await db.collection('activity_records').orderBy('_id', 'asc').skip(offset).limit(PAGE_SIZE).get()
    scannedRecords += page.data.length
    const expired = page.data.filter(record => /^\d{4}-\d{2}$/.test(String(record.month || '')) && record.month < cutoffMonth && evidenceFileIdsFor(record).length)
    for (const record of expired) {
      try {
        deletedFiles += await purgeRecord(record, cutoffMonth)
        purgedRecords += 1
      } catch (error) {
        failures.push({ recordId: record._id, error: String(error && error.message || error).slice(0, 160) })
      }
    }
    if (page.data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log('历史运动截图清理完成', { latestSubmissionMonth, cutoffMonth, scannedRecords, purgedRecords, deletedFiles, failureCount: failures.length })
  return { latestSubmissionMonth, cutoffMonth, scannedRecords, purgedRecords, deletedFiles, failures: failures.slice(0, 20) }
}
