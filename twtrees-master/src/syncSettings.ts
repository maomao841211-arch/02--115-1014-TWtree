// syncSettings.ts
// 同步功能的可設定項目：Apps Script Web App 網址、場次/班級標籤。
// 皆存在 localStorage，離線也能讀寫；網址「絕不硬編」在程式碼中。

const SYNC_URL_KEY = 'cmytrees_sync_url'
const SESSION_LABEL_KEY = 'cmytrees_session_label'

/** 使用者在「同步」面板手動輸入的網址（可能為空字串） */
export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) ?? ''
}

export function setSyncUrl(url: string): void {
  const trimmed = url.trim()
  if (trimmed) {
    localStorage.setItem(SYNC_URL_KEY, trimmed)
  } else {
    localStorage.removeItem(SYNC_URL_KEY)
  }
}

/**
 * 實際同步要打的網址：優先採用使用者於畫面上設定的網址，
 * 若使用者沒設定，退回建置時的環境變數 VITE_SYNC_URL（也可能未設定）。
 * 兩者皆空時回傳空字串，呼叫端應據此提示使用者尚未設定同步網址。
 */
export function getEffectiveSyncUrl(): string {
  const fromSettings = getSyncUrl()
  if (fromSettings) return fromSettings
  const fromEnv = import.meta.env.VITE_SYNC_URL
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/** 目前預設的場次/班級標籤（可選，用於新增樹木時自動蓋上） */
export function getSessionLabel(): string {
  return localStorage.getItem(SESSION_LABEL_KEY) ?? ''
}

export function setSessionLabel(label: string): void {
  const trimmed = label.trim()
  if (trimmed) {
    localStorage.setItem(SESSION_LABEL_KEY, trimmed)
  } else {
    localStorage.removeItem(SESSION_LABEL_KEY)
  }
}
