const fs = require('fs')
const path = require('path')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'history-data.json'), 'utf8'))

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

async function upsertMany(collectionName, records) {
  for (const group of chunks(records, 25)) {
    await Promise.all(group.map(async record => {
      const { _id, ...data } = record
      await db.collection(collectionName).doc(_id).set({ data })
    }))
  }
}

exports.main = async () => {
  const batchId = `legacy-import-${data.checksum.slice(0, 16)}`
  const members = data.members.map(member => ({ _id: member.legacyMemberKey, ...member, importBatchId: batchId }))
  const records = data.records.map(record => ({ _id: record.legacyRecordKey, ...record, importBatchId: batchId }))
  await db.collection('history_import_batches').doc(batchId).set({
    data: { sourceFileName: data.sourceFileName, sourceSheet: data.sourceSheet, periodCount: data.periods.length, memberCount: members.length, recordCount: records.length, checksum: data.checksum, status: 'importing', createdAt: db.serverDate() }
  })
  await upsertMany('historical_members', members)
  await upsertMany('historical_monthly_records', records)
  await db.collection('fund_ledger').doc('legacy-opening-2026-07').set({ data: { month: '2026-07', entryType: 'opening_balance', amount: -257, status: 'confirmed', note: '历史期末余额结转', importBatchId: batchId, occurredAt: db.serverDate() } })
  await db.collection('history_import_batches').doc(batchId).update({ data: { status: 'completed', completedAt: db.serverDate() } })
  return { batchId, members: members.length, periods: data.periods.length, records: records.length, checksum: data.checksum }
}
