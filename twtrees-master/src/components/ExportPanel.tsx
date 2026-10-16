import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { exportTreesToCsv, exportTreesToJson } from '../export'

/** 匯出面板：離線、零後端，把所有樹木資料匯出成 CSV / JSON 檔案下載。 */
function ExportPanel() {
  const [isExporting, setIsExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const treeCount = useLiveQuery(() => db.trees.count(), [])

  async function handleExport(kind: 'csv' | 'json') {
    setIsExporting(true)
    setMessage(null)
    try {
      if (kind === 'csv') {
        await exportTreesToCsv()
      } else {
        await exportTreesToJson()
      }
      setMessage('匯出完成，請至瀏覽器的下載內容確認檔案。')
    } catch (err) {
      console.error(err)
      setMessage('匯出失敗，請稍後再試。')
    } finally {
      setIsExporting(false)
    }
  }

  const hasTrees = Boolean(treeCount)

  return (
    <div className="export-panel">
      <h2>匯出資料</h2>
      <p className="hint-text">
        {treeCount === undefined
          ? '載入中...'
          : `目前共有 ${treeCount} 棵樹的資料，可匯出成 CSV 或 JSON 檔案，離線即可使用、不需要網路。`}
      </p>
      <div className="export-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleExport('csv')}
          disabled={isExporting || !hasTrees}
        >
          匯出 CSV
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleExport('json')}
          disabled={isExporting || !hasTrees}
        >
          匯出 JSON
        </button>
      </div>
      {message && <p className="hint-text">{message}</p>}
    </div>
  )
}

export default ExportPanel
