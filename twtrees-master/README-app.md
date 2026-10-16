# TwTrees 樹木碳盤查（v1）

一個離線可用的 PWA：輸入樹木的樹種、胸徑（DBH）與樹高，即時計算並顯示每棵樹的碳儲存與全場域碳總量，資料存在本機瀏覽器的 IndexedDB，重開頁面資料仍在。

## 快速開始

```bash
npm install
npm run dev       # 開發模式，預設 http://localhost:5173
npm run build      # 型別檢查 + 打包成 dist/
npm run preview    # 本地預覽 build 後的成果（可測試 PWA 離線行為）
```

## 重要聲明：碳數字為示意佔位公式

**v1 的碳數字為示意佔位公式，未經科學驗證，正式用途前需替換為文獻級異速生長方程式。**

計算鏈（見 `src/carbon.ts`，公式與係數皆已於程式碼中標註 `// PLACEHOLDER` 與 `TODO`）：

```
量測 (DBH cm, 樹高 H m, 樹種)
 → 地上生物量 AGB(kg) = a · DBH^b · H^c        （a, b, c 係數見 src/species.ts，皆為佔位值）
 → 全株生物量        = AGB · (1 + rootShootRatio)  （根莖比為佔位值）
 → 含碳量(kg)        = 生物量 · 0.5             （碳分率 ~0.5，IPCC 慣用預設值）
 → CO2e(kg)          = 含碳量 · 3.67            （C→CO2 分子量比 44/12，此比值為精確值，非佔位）
```

正式使用前，請將 `src/species.ts` 各樹種的 `a, b, c, rootShootRatio` 換成查文獻（如 i-Tree Eco 物種對應方程式、Chave et al. 2014 通用方程式，或臺灣本地樹種實測方程式）得出的數值。UI 元件不會碰公式細節，因此只需改 `src/carbon.ts` 與 `src/species.ts`，其他程式碼不需變動。

`src/components/SiteSummary.tsx` 內「約等於燃燒 X 公升汽油排放」的等效係數（`CO2_PER_LITER_GASOLINE_KG`）也是佔位值，正式使用前請換成有出處的官方排放係數。

## 圖示（icons）為佔位圖，需替換

`public/icons/icon-192.png` 與 `public/icons/icon-512.png` 是程式產生的簡易樹形佔位圖（深綠底、綠色樹冠、棕色樹幹），僅供 PWA manifest 能正確顯示與安裝之用。正式上線前請替換成正式設計的圖示。

## 技術棧

- Vite + React + TypeScript
- vite-plugin-pwa（manifest + service worker，可安裝、離線可用）
- Dexie + dexie-react-hooks（IndexedDB 封裝，`useLiveQuery` 讓全場域碳總量即時更新）
- 手寫 CSS（教科書風、大字體）

## 資料模型

Dexie 資料庫 `cmytrees`（目前 schema version 2），`trees` 表欄位：

- `id`：自動遞增主鍵
- `name`：樹木名稱/編號（可選）
- `species`：樹種 key（對應 `src/species.ts`）
- `dbhCm`：胸徑，公分
- `heightM`：樹高，公尺
- `notes`：備註（可選）
- `createdAt`：建立時間（timestamp）
- `deviceId`（v2 新增，可選）：本機裝置匿名代碼，首次啟動時自動產生並存於 localStorage，不含個資
- `sessionLabel`（v2 新增，可選）：建立當下的場次/班級標籤，來自「同步」面板的設定
- `syncedAt`（v2 新增，可選）：同步到 Google 試算表成功的時間戳；`undefined` 表示尚未同步

v1 → v2 只新增欄位、不更動既有欄位，既有資料升級後可直接使用。

## 匯出與同步（離線優先）

- **匯出**：在畫面下方「匯出資料」區塊可把目前所有樹木資料匯出成 CSV（UTF-8 with BOM，
  Excel 開啟不亂碼）或 JSON，兩者皆用瀏覽器下載、完全離線可用，不需要網路。
- **同步到 Google 試算表**：在「同步」面板可設定場次/班級標籤與 Apps Script Web App 網址，
  按「立即同步」會把尚未同步的紀錄以 `fetch` POST 給該網址，成功後標記 `syncedAt`。
  - 同步網址**不會硬編**在程式碼中，來源優先序為：畫面上手動輸入的網址 → 建置時的
    `VITE_SYNC_URL` 環境變數（見 `.env.example`）→ 皆空則同步鈕會清楚提示尚未設定。
  - Apps Script 端範例程式碼與部署步驟見 `dev-tools/apps-script-sync.gs` 檔頭說明，
    需由使用者自行用自己的 Google 帳號部署。
  - 離線時新增/編輯資料完全不受影響；恢復網路連線（`online` 事件）會自動嘗試同步一次。

## 範圍（v1 只做這些）

- 樹木新增/編輯/刪除、即時碳計算、全場域碳總量。
- 不含：碳中和目標設定、QR 分享、導覽功能。

樹高可手動輸入或用手機傾角量測；iOS 需以 HTTPS 提供才可使用感測器（本機測試見 dev-tools/serve-https.py）。
