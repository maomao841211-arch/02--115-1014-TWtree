import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDeviceId } from '../deviceId'
import {
  getSessionLabel,
  setSessionLabel as saveSessionLabel,
  getSyncUrl,
  setSyncUrl as saveSyncUrl
} from '../syncSettings'
import { countPendingSync, syncPendingTrees } from '../sync'

/**
 * 同步面板：把尚未同步的樹木資料送到使用者自行部署的 Google Apps Script Web App。
 * 離線優先——沒有網路或尚未設定網址時，資料仍完整留在本機，只是同步鈕會清楚提示。
 */
function SyncPanel() {
  const [sessionLabel, setSessionLabelState] = useState(() => getSessionLabel())
  const [syncUrl, setSyncUrlState] = useState(() => getSyncUrl())
  const [isSyncing, setIsSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const deviceId = getDeviceId()

  const pendingCount = useLiveQuery(() => countPendingSync(), [])

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    setMessage(null)
    try {
      const result = await syncPendingTrees()
      setMessage(result.message)
    } finally {
      setIsSyncing(false)
    }
  }, [])

  // 恢復網路連線時自動嘗試同步一次；若尚未設定網址，syncPendingTrees 會回報清楚提示，
  // 不會靜默失敗。
  useEffect(() => {
    function handleOnline() {
      void handleSync()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [handleSync])

  return (
    <div className="sync-panel">
      <h2>同步到 Google 試算表</h2>
      <p className="hint-text">
        本裝置代碼：<code>{deviceId}</code>
        （亂數產生、不含個資，僅用於老師端彙整時區分不同裝置）
      </p>

      <div className="form-row">
        <label htmlFor="sync-session">場次/班級（可選，將作為之後新增樹木的預設標籤）</label>
        <input
          id="sync-session"
          type="text"
          value={sessionLabel}
          onChange={(e) => {
            const value = e.target.value
            setSessionLabelState(value)
            saveSessionLabel(value)
          }}
          placeholder="例如：三年一班 / 7/18 上午場"
        />
      </div>

      <div className="form-row">
        <label htmlFor="sync-url">Apps Script Web App 網址（可選，留空則使用建置時的設定）</label>
        <input
          id="sync-url"
          type="url"
          value={syncUrl}
          onChange={(e) => {
            const value = e.target.value
            setSyncUrlState(value)
            saveSyncUrl(value)
          }}
          placeholder="https://script.google.com/macros/s/.../exec"
        />
      </div>

      <p className="hint-text">
        {pendingCount === undefined
          ? '載入中...'
          : pendingCount === 0
          ? '所有紀錄皆已同步。'
          : `尚有 ${pendingCount} 筆紀錄未同步。`}
      </p>

      <button type="button" className="btn btn-primary" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? '同步中...' : '立即同步'}
      </button>

      {message && <p className="hint-text">{message}</p>}

      <p className="hint-text sync-panel-note">
        說明：同步需要網路連線，且需請老師先自行部署好 Apps Script Web App 並取得網址（部署步驟見
        專案內 <code>dev-tools/apps-script-sync.gs</code> 檔頭說明）。離線時新增/編輯資料完全不受影響，
        恢復連線後可再按「立即同步」，或等待自動嘗試。
      </p>
    </div>
  )
}

export default SyncPanel
