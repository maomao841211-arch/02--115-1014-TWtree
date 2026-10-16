// export.ts
// 離線、零後端的匯出功能：把所有樹木資料匯出成 CSV（UTF-8 with BOM，
// 讓 Excel 開啟不會亂碼）與 JSON，皆用 Blob 觸發瀏覽器下載，完全不需要網路。

import { db } from './db'
import { SPECIES } from './species'
import { estimateCarbon } from './carbon'

// CSV 公式注入防護：Excel／Google 試算表開啟 CSV 時，若某欄位以這些字元開頭，
// 可能被誤判成公式並執行（例如 =HYPERLINK(...) 之類的攻擊手法）。
// 只要開頭是這些字元，就前置一個單引號 '，讓它被當成純文字，不會被當公式執行。
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r']

function neutralizeFormula(str: string): string {
  if (str.length > 0 && FORMULA_TRIGGER_CHARS.includes(str[0])) {
    return `'${str}`
  }
  return str
}

/**
 * CSV 欄位值轉換：先中和開頭可能觸發公式執行的字元，
 * 再視需要（含逗號、雙引號、換行 \n、\r）用雙引號包起來並轉義內部雙引號。
 */
function toCsvField(value: string | number): string {
  const str = neutralizeFormula(String(value))
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 匯出所有樹木資料成 CSV 檔並觸發下載（UTF-8 with BOM）。 */
export async function exportTreesToCsv(): Promise<void> {
  const trees = await db.trees.orderBy('createdAt').toArray()

  const headers = [
    'id',
    'name',
    'species',
    'dbhCm',
    'heightM',
    'biomassKg',
    'carbonKg',
    'co2eKg',
    'notes',
    // 標明 UTC，避免老師在 Excel 看到 ISO 字串時誤以為是本地時間。
    'createdAt(UTC)'
  ]

  const rows = trees.map((tree) => {
    const { biomassKg, carbonKg, co2eKg } = estimateCarbon(tree)
    const speciesLabel = SPECIES[tree.species]?.label ?? tree.species
    return [
      tree.id,
      tree.name ?? '',
      speciesLabel,
      tree.dbhCm,
      tree.heightM,
      biomassKg.toFixed(2),
      carbonKg.toFixed(2),
      co2eKg.toFixed(2),
      tree.notes ?? '',
      new Date(tree.createdAt).toISOString()
    ]
  })

  const csvContent = [headers, ...rows]
    .map((row) => row.map(toCsvField).join(','))
    .join('\r\n')

  // U+FEFF = UTF-8 BOM，確保 Excel 等軟體開啟時中文不會亂碼。
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `twtrees-${timestampForFilename()}.csv`)
}

/** 匯出所有樹木資料成 JSON 檔並觸發下載（UTF-8）。 */
export async function exportTreesToJson(): Promise<void> {
  const trees = await db.trees.orderBy('createdAt').toArray()

  const enriched = trees.map((tree) => {
    const carbon = estimateCarbon(tree)
    return {
      ...tree,
      speciesLabel: SPECIES[tree.species]?.label ?? tree.species,
      biomassKg: carbon.biomassKg,
      carbonKg: carbon.carbonKg,
      co2eKg: carbon.co2eKg,
      // 標明 UTC，避免與 createdAt（本機時間戳，毫秒）混淆或被誤讀成本地時間。
      createdAtUtc: new Date(tree.createdAt).toISOString()
    }
  })

  const blob = new Blob([JSON.stringify(enriched, null, 2)], {
    type: 'application/json;charset=utf-8;'
  })
  downloadBlob(blob, `twtrees-${timestampForFilename()}.json`)
}
