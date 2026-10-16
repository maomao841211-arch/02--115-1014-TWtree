// sync.ts
// 把尚未同步的樹木紀錄送到使用者自行部署的 Google Apps Script Web App，
// 成功後在本機標記 syncedAt。全程「離線優先」：沒有網路或尚未設定網址時，
// 資料仍完整留在本機 IndexedDB，不會遺失，只是還沒同步而已。

import { db } from './db'
import { getDeviceId } from './deviceId'
import { getEffectiveSyncUrl, getSessionLabel } from './syncSettings'

export interface SyncResult {
  ok: boolean
  syncedCount: number
  message: string
}

/** Apps Script doPost() 回傳的 JSON 內容（見 dev-tools/apps-script-sync.gs）。 */
interface AppsScriptSyncResponseBody {
  ok?: boolean
  error?: string
  receivedCount?: number
  appendedCount?: number
}

/** 尚未同步（syncedAt 未設定）的樹木筆數 */
export async function countPendingSync(): Promise<number> {
  return db.trees.filter((tree) => !tree.syncedAt).count()
}

// 模組層級的「同步進行中」旗標：防止手動按「立即同步」與 online 事件自動觸發
// 兩者同時執行，各自讀到同一批 pending 各 POST 一次，導致試算表出現重複列。
let isSyncInFlight = false

/**
 * 同步一次：把尚未同步的紀錄整批 POST 給 Apps Script Web App。
 *
 * CORS 注意：呼叫 Apps Script Web App 時故意用 `Content-Type: text/plain`，
 * 避免瀏覽器對這個跨網域請求送出 CORS 預檢（OPTIONS）。Apps Script 端請用
 * `e.postData.contents` 讀出原始字串後自行 `JSON.parse()`（見
 * dev-tools/apps-script-sync.gs 範例）。
 *
 * 成功判定：`response.ok`（HTTP 狀態）只代表「請求有送達、Apps Script 有回應」，
 * 不代表「資料真的寫進試算表」——Apps Script 內部發生例外時，doPost() 仍會回
 * HTTP 200，但 body 是 `{ ok: false, error: ... }`。因此這裡一定要再解析回應
 * body，只有 `body.ok === true` 才視為成功並標記 syncedAt；body 解析失敗（非
 * JSON）或 `body.ok !== true` 都當作失敗處理，不標記，讓資料保持「待同步」。
 */
export async function syncPendingTrees(): Promise<SyncResult> {
  if (isSyncInFlight) {
    return {
      ok: false,
      syncedCount: 0,
      message: '已有另一個同步作業正在進行中，請稍候再試。'
    }
  }

  isSyncInFlight = true
  try {
    const url = getEffectiveSyncUrl()
    if (!url) {
      return {
        ok: false,
        syncedCount: 0,
        message:
          '尚未設定同步網址，請在下方「Apps Script Web App 網址」欄位填入網址（或請系統管理者於建置時設定 VITE_SYNC_URL）。'
      }
    }

    const pending = await db.trees.filter((tree) => !tree.syncedAt).toArray()
    if (pending.length === 0) {
      return { ok: true, syncedCount: 0, message: '目前沒有待同步的紀錄，資料都已同步。' }
    }

    const deviceId = getDeviceId()
    const sessionLabel = getSessionLabel()

    const records = pending.map((tree) => ({
      id: tree.id,
      name: tree.name ?? '',
      species: tree.species,
      dbhCm: tree.dbhCm,
      heightM: tree.heightM,
      notes: tree.notes ?? '',
      createdAt: new Date(tree.createdAt).toISOString(),
      deviceId: tree.deviceId ?? deviceId,
      session: tree.sessionLabel ?? sessionLabel
    }))

    try {
      const response = await fetch(url, {
        method: 'POST',
        // 刻意用 text/plain：避免 CORS 預檢，Apps Script doPost 端自行 JSON.parse。
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ deviceId, session: sessionLabel, records })
      })

      if (!response.ok) {
        return {
          ok: false,
          syncedCount: 0,
          message: `同步失敗：伺服器回應狀態碼 ${response.status}，資料仍安全保存在本機，稍後可再試一次。`
        }
      }

      // HTTP 200 不代表 Apps Script 內部真的成功，必須再檢查 body.ok。
      const rawText = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch (parseErr) {
        console.error('同步回應不是合法 JSON', parseErr, rawText)
        return {
          ok: false,
          syncedCount: 0,
          message: '同步失敗：伺服器回應格式異常，資料仍安全保存在本機，稍後可再試一次。'
        }
      }

      // JSON.parse('null') 或陣列/數字等雖是合法 JSON，但不是我們期待的物件形狀，
      // 一併當成格式異常處理，不可誤判為成功。
      if (typeof parsed !== 'object' || parsed === null) {
        console.error('同步回應 JSON 形狀異常', parsed)
        return {
          ok: false,
          syncedCount: 0,
          message: '同步失敗：伺服器回應格式異常，資料仍安全保存在本機，稍後可再試一次。'
        }
      }

      const body = parsed as AppsScriptSyncResponseBody

      if (body.ok !== true) {
        return {
          ok: false,
          syncedCount: 0,
          message: `同步失敗：伺服器回報錯誤${body.error ? `（${body.error}）` : ''}，資料仍安全保存在本機，稍後可再試一次。`
        }
      }

      const now = Date.now()
      await db.trees.bulkUpdate(
        pending.map((tree) => ({ key: tree.id, changes: { syncedAt: now } }))
      )

      return {
        ok: true,
        syncedCount: pending.length,
        message: `已成功同步 ${pending.length} 筆紀錄。`
      }
    } catch (err) {
      console.error('同步失敗', err)
      return {
        ok: false,
        syncedCount: 0,
        message: '同步失敗，請確認網路連線或同步網址是否正確；資料仍安全保存在本機，之後可再試一次。'
      }
    }
  } finally {
    isSyncInFlight = false
  }
}
