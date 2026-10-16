// deviceId.ts
// 產生並保存「匿名裝置代碼」：第一次啟動時建立一次，之後存在 localStorage，
// 每次啟動沿用同一組代碼。純亂數，不含任何個資（不記姓名、帳號等）。
// 用途：老師端彙整全班/全場資料時，用來區分「這筆資料是哪一支手機/裝置量測的」。

const DEVICE_ID_KEY = 'cmytrees_device_id'

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback：極少數不支援 crypto.randomUUID 的瀏覽器，退而求其次用亂數＋時間戳。
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 取得本機裝置的匿名代碼；若尚未建立過，會自動產生並存入 localStorage。 */
export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }
  const id = generateDeviceId()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}
