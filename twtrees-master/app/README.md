# TwTrees 碳盤查 App — 說明與技術文件

開發單位：臺北市立大學永續環境研究室

> 一個對標 [C My Trees](https://www.ripponleaestate.com.au/c-my-trees-app/)（ArborSafe／Civica）的
> 樹木碳盤查 App。用手機量樹、算碳、建清單、看全場域碳總量，資料留在本機。

---

## 1. 這是什麼

一個**單一自包含的網頁 App（PWA）**，跑在手機瀏覽器，可「加入主畫面」當成一般 App、離線也能開。
核心用途：走到一棵樹前，用手機量出它的**樹高、胸徑**，記錄**GPS 位置**，即時算出**碳儲存量（CO₂e）**，
存進本機清單，並看到整個場域所有樹的**碳儲存總量**。

**選擇單一 HTML 的理由**：免建置、免後端、單一檔案好部署，也剛好避開本機開發環境的一個
Node 當機問題（見第 8 節）。整個 App 就是 `app/` 這個資料夾。

---

## 2. 功能

| 功能 | 說明 |
|------|------|
| 相機導引量測 | 相機即時畫面 + 疊加準星／導引線，一步步引導量樹基、樹頂、胸徑 |
| 樹高量測 | 傾角三角法（見第 4 節），已真機驗證 |
| 胸徑（DBH）量測 | 凍結一張樹幹照片，拖兩條線對齊樹皮兩緣，換算直徑；可手動覆寫（輪徑尺量到的值） |
| GPS 記錄 | 記錄每棵樹的經緯度與定位精度 |
| 碳匯計算 | 由樹種＋胸徑＋樹高估算碳儲存與 CO₂e（**目前為示意佔位公式，見第 5 節**） |
| 樹木清單 | 列出已存樹木，可改名、刪除 |
| 全場域碳總量 | 即時加總所有已存樹木的 CO₂e |
| 本機儲存 | 資料存在手機瀏覽器 localStorage，重開仍在 |
| PWA | 可安裝到主畫面、離線可用 |

---

## 3. 怎麼跑（本機測試）

手機要用感測器／相機／GPS，瀏覽器規定必須是 **HTTPS**（尤其 iOS）。本專案附一個自簽憑證的
HTTPS 小伺服器，讓手機（同一個 WiFi）連進來測試。

```bash
# 在專案根目錄執行
python dev-tools/serve-https.py
```

- 啟動後會印出網址，例如 `https://<你的電腦區網IP>:8443/app/index.html`。
- 手機連**同一個 WiFi**，用瀏覽器開該網址（或掃指揮官提供的 QR）。
- 第一次會出現「憑證不受信任」→ 點「繼續／仍要前往」（自簽憑證，安全）。
- 若手機連不上：多半是 **Windows 防火牆**首次詢問時未允許 Python 於「私人網路」通訊；或兩者不在同一 WiFi。

> 測試工具頁（開發用）仍在 `https://<IP>:8443/dev-tools/ar-measure.html`、
> `.../dev-tools/height-clinometer.html`。

### 正式部署
因為是純靜態檔，把 `app/` 資料夾放到**任何 HTTPS 靜態空間**（GitHub Pages、Netlify、Vercel…）即可，
使用者用手機開網址就能用、也能加入主畫面。**唯一硬性要求是 HTTPS**。

---

## 4. 量測方法與原理

### 樹高：傾角三角法（免量距離）
用手機加速度計融合後的傾角當測角器。定義帶號仰角 θ（水平為 0、往上為正、往下為負）：

1. 使用者輸入**眼睛/手機離地高度 h**（預設 1.5 m）。
2. 對準**樹基**得俯角 θ_base（<0）→ 推算水平距離 **D = −h / tan(θ_base)**。
3. 對準**樹頂**得仰角 θ_top → 樹高 **H = h + D × tan(θ_top)**。

好處：不用捲尺量距離，站在平地、看得到樹基即可。
**校正**：不同手機傾角零點/正負不一，App 提供「對準水平線校正歸零」與「反轉方向」開關
（本專案測試裝置需**反轉方向為開**）。站在離樹約一個樹高、角度落 30–45° 時最準。

### 胸徑（DBH）：相機像素 × 距離（針孔模型）
1. 拍一張樹幹靜態照（`video.pause()` 凍結，避免手震）。
2. 拖兩條垂直線對齊胸高（約 1.3 m）處樹皮兩緣，得像素間距 p。
3. **DBH = p × D / f_px**，f_px 為鏡頭焦距（像素）。距離 D 沿用樹基推算值。
4. **FOV / 焦距校正**（提升精度）：用已知寬度 W、距離 L 的物體拍一張、拖線得 p_cal，
   則 **f_px = p_cal × L / W**，存在裝置上。未校正時用預設 HFOV≈66° 推估，並標「粗估」。
5. 可**手動覆寫** DBH（用輪徑尺／皮尺實測的值最準）。

### 碳匯（CO₂e）
計算鏈（詳見第 5 節）：DBH＋樹高＋樹種 → 生物量 → 含碳量 → CO₂ 當量。

---

## 5. ⚠️ 碳計算為「示意佔位公式」（重要聲明）

目前的碳計算是**刻意簡化、明確標註為佔位（PLACEHOLDER）**的估算鏈，僅供讓流程跑通與教學/測試展示，
**未經科學驗證，不可直接用於正式盤查或對外宣稱**：

```
地上生物量 AGB(kg) = a · DBH^b · H^c        // 佔位係數（依樹種）
全株生物量        = AGB · (1 + 根莖比)       // 佔位根莖比
含碳量(kg)        = 生物量 · 0.5            // 碳分率 ~0.5（IPCC 慣用預設）
CO₂ 當量(kg)      = 含碳量 · 3.67           // C→CO₂ 分子量比 44/12
```

正式使用前，應將公式與係數替換為**文獻級異速生長方程式**（如 i-Tree Eco 物種對應方程式、
Chave et al. 2014 通用式），並更新各樹種係數。程式已把碳公式集中隔離，替換時 UI 不需改動。

同理，GPS「等效汽油公升數」等說明性換算係數亦為佔位值。

---

## 6. 技術棧

| 層面 | 採用 | 說明 |
|------|------|------|
| 形態 | PWA（單一 HTML） | `app/index.html` 內含全部 HTML/CSS/JS，無外部相依、無建置步驟 |
| 語言 | 原生 HTML + CSS + JavaScript（ES5/ES6，vanilla） | 不使用框架，降低維護成本 |
| 感測器 | `DeviceOrientationEvent`（傾角）| iOS 13+ 需按鈕手勢呼叫 `requestPermission()` |
| 相機 | `getUserMedia({video:{facingMode:'environment'}})` + `<canvas>` 疊圖層 | 準星/導引線畫在透明 canvas 上（video 當視覺、canvas 當覆蓋層） |
| 定位 | `navigator.geolocation.getCurrentPosition`（高精度、單次） | 記錄經緯度與精度 |
| 儲存 | `localStorage`（key `cmytrees.trees`，JSON 陣列） | 純前端本機儲存，無後端 |
| 離線/安裝 | Service Worker（`app/sw.js`）＋ `manifest.webmanifest` | HTML 走 network-first（改版收得到）、靜態資源 cache-first |
| 測試伺服器 | Python 自簽憑證 HTTPS（`dev-tools/serve-https.py`） | 供手機於區網 HTTPS 測試感測器 |

### 檔案結構
```
TwTrees/
├── app/                        ← 正式 App（就是這個資料夾）
│   ├── index.html              #   全部程式（HTML/CSS/JS 內嵌）
│   ├── manifest.webmanifest    #   PWA 設定
│   ├── sw.js                   #   Service Worker（離線/安裝）
│   ├── icons/                  #   App 圖示（佔位圖，待替換）
│   └── README.md               #   本文件
├── dev-tools/
│   ├── ar-measure.html         #   相機導引量測「測試頁」（開發驗證用，保留）
│   ├── height-clinometer.html  #   純樹高傾角「測試頁」
│   └── serve-https.py          #   本機 HTTPS 測試伺服器
└── (另有一份早期 React 版原型於 src/，非目前主線)
```

---

## 7. 資料與隱私

- 所有樹木資料（樹種、胸徑、樹高、CO₂e、GPS、名稱、時間）**只存在使用者手機的 localStorage**，
  不上傳任何伺服器、無帳號、無追蹤。
- GPS 屬敏感資料；App 僅在使用者主動按「記錄目前位置」時取得單次座標，不做背景追蹤。
- 清除瀏覽器資料或解除安裝會一併刪除本機資料（目前無雲端備份）。

---

## 8. 已知限制

1. **碳數字為佔位公式**，未經科學驗證（見第 5 節）——正式用途前必須替換。
2. **胸徑相機量測為約估**（誤差可能 10–20%），準度取決於 FOV 校正與距離估計；最準仍是輪徑尺實測後手動輸入。
3. **iOS 必須 HTTPS** 才能使用感測器/相機/GPS。
4. **傾角正負號因裝置而異**，需用「反轉方向」開關校正（本專案測試機為「開」）。
5. **本機開發環境限制**：此電腦的專案路徑含中文（`Google 雲端硬碟\2026年計畫…`），
   Node 22.9.0 在此路徑會 Segmentation fault，故早期 React 版無法在原路徑建置；
   單一 HTML 版不需 Node/建置，不受此問題影響。
6. 圖示 `app/icons/` 為佔位圖，正式發佈前建議替換。

---

## 9. 後續可擴充（尚未實作）

### 規劃中的主要方向：雲端匯集
目前為**本機測試版**（資料只在各自手機）。未來規劃**開設伺服器、讓多位使用者上雲**，
由主持人**匯集所有人量測的樹木資料**，做跨場域/跨人員的碳盤查彙整。

這版的資料模型已為此鋪路——每棵樹是一筆結構化紀錄
（`id, name, species, dbhCm, heightM, co2eKg, lat, lng, accuracy, createdAt`）。
往雲端演進時的最小改動：
1. 把目前的 `localStorage` 存取層換成「本機 + 雲端 API」雙寫（離線先存本機、連線再同步）。
2. 後端存每筆紀錄並標記上傳者；主持人端做彙整與地圖。
3. 依使用者的隱私紅線：GPS 與可識別欄位需明確同意才上傳，最小化蒐集、只留必要欄位。
（建議選型另議：低成本可用 Supabase／Firebase 之類的 BaaS 快速起步。）

### 其他可加
- 碳中和目標：輸入能源使用與期間，比較排放 vs 樹木碳儲存（原 C My Trees 有此功能）。
- QR code 分享：產生連到場域即時碳資料的 QR（需上面的雲端後端才能「即時共享」給他人）。
- 地圖檢視：用已記錄的 GPS 在地圖上標出每棵樹。
- 匯出：把清單匯出成 CSV（UTF-8 with BOM）備份。
- 以文獻級方程式替換佔位碳公式。


---

## 10. MongoDB 紀錄

除了既有的 Google 試算表同步，App 另外把「樹的結果 + 量測過程」雙送到伺服器端的 MongoDB，供研究分析。
兩條路徑**各自獨立**：一邊失敗不會擋另一邊；Google 試算表送出的內容與格式完全沒變。

### 資料流

```
存檔（或開啟 App／恢復連線／按「立即同步」）
  └─ 已同意上傳？ 否 → 什麼都不送（GPS、樹資料都留在本機）
                 是 ↓
     ├─ Google 試算表：POST Apps Script（內容同舊版，不含 measure）→ 成功寫 tree.syncedAt
     └─ MongoDB：POST 同源 /api/records（含 measure）→ 成功寫 localStorage「cmytrees.mongoSynced」
                  └─ server.cjs 驗證後以 (deviceId, id) upsert 到 MongoDB（重送不會重複）
```

- `/api/records` 與整個網站同樣受 Basic Auth 門禁保護。**注意：`DISABLE_AUTH` 開啟時，門禁整個停用，`/api/records` 也會對所有人公開（任何人都能寫入）**，此時只靠限流（請求數 `RATE_LIMIT_PER_MIN` + 筆數 `RECORDS_PER_MIN`）擋濫用，不另加寫入閘。僅限短期測試，**測試結束請執行 `heroku config:unset DISABLE_AUTH`**。
- 伺服器沒設 `MONGODB_URI` 時回 `503 {"error":"mongo-not-configured"}`，App 視為「未啟用」，
  本次開啟期間不再重試，也不會對學生顯示錯誤。網路失敗／429／5xx 則下次同步時機再試。
- 設定頁會顯示「雲端資料庫：已上傳 N/M 筆（K 筆格式不符未收）」或「未啟用」。
- 伺服器逐筆驗證：頂層欄位（`id`、`createdAt`、數值範圍等）不合格只拒該筆，回應為 `{ok:true, saved:N, rejected:[{id, reason}]}`；`measure` 內的欄位型別錯誤或超出範圍則改存 null，不拒收。整批結構壞掉（JSON 壞、缺 `deviceId`、`records` 非陣列、超過 100 筆）才回 400。
- App 把成功與被拒的 id 都記入 `cmytrees.mongoSynced`（被拒者記成 `rejected:<原因>`），不再重送；整批 413（過大）時改以對半縮小的批次重試，單筆仍被拒就標 `rejected:http413` 略過；整包 400／415 則停止本輪、顯示錯誤、不標記。`rejected` 標記是永久的（不會自動重送），僅在 `APP_VERSION` 改變時清除原因為 `http` 開頭者（記錄在 `cmytrees.mongoSyncedVer`）。分批依 UTF-8 位元組估算，單批 ≤ 190KB 且 ≤ 100 筆。
- 改名會讓該筆重送（以 upsert 更新雲端）；**刪除只影響本機，不會同步刪除雲端紀錄**。
- `GET /api/health` 回 `{ok, mongo: "not-configured" | "configured" | "connected"}`，不含任何機密。

### 欄位表（collection `trees`）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `deviceId` | string | 匿名裝置代碼（與 `id` 組成唯一鍵） |
| `id` | string | 樹紀錄 id（App 產生） |
| `session` | string | 場次標籤（設定頁填的） |
| `name`、`species`、`notes` | string | 名稱／編號、樹種 key、備註（目前為空字串） |
| `dbhCm`、`heightM`、`co2eKg` | number/null | 胸徑、樹高、碳儲存量 |
| `lat`、`lng`、`accuracy` | number/null | GPS（lat -90~90、lng -180~180；未記錄為 null） |
| `createdAt` | Date | 存檔時間 |
| `formulaVersion` | number/null | 碳公式版本（舊紀錄為 null） |
| `dSource` | string/null | 距離來源：`manual`／`estimated` |
| `measure` | object/null | 量測過程（見下表；舊紀錄沒有則為 null） |
| `serverReceivedAt` | Date | 伺服器最近一次收到的時間 |
| `firstReceivedAt` | Date | 伺服器第一次收到的時間 |
| `studyPhase` | string | 研究階段（環境變數 `STUDY_PHASE`，預設 `dev`） |
| `appVersion` | string/null | App 版本（取自 `measure.appVersion`） |

`measure` 子欄位：

| 欄位 | 說明 |
|------|------|
| `thetaBaseDeg`、`thetaTopDeg` | 鎖定的樹基／樹頂角度（度） |
| `eyeHeightM` | 眼睛／手機離地高度 h（公尺） |
| `distanceM` | 計算採用的水平距離 D（公尺） |
| `dSource` | `manual`（實測輸入）／`estimated`（俯角推算） |
| `heightRangeM` | ±1° 誤差下的樹高範圍 `{lo, hi}`（算不出為 null） |
| `dbhSource` | `camera`（相機估算）／`manual`（手動輸入）／null |
| `pTrunkPx`、`fPx`、`fovCalibrated` | 相機估算 DBH 時的樹幹兩線像素距離、等效焦距 px、焦距是否已校正（非相機估算為 null） |
| `zeroRef`、`invert` | 水平校正零點、角度方向是否反轉（未校正時 `zeroRef` 為 null） |
| `calOrient`、`calSavedAt` | 校正當下手機方向、校正儲存時間 |
| `userAgent` | 瀏覽器識別字串（截斷至 300 字） |
| `appVersion` | App 版本（`index.html` 頂部 `APP_VERSION`） |

索引：`(deviceId, id)` 唯一、`createdAt`、`session`。

### 環境變數（設在 Heroku Config Vars，不要寫進程式或 repo）

| 變數 | 預設 | 說明 |
|------|------|------|
| `MONGODB_URI` | （無） | MongoDB 連線字串。未設定則 `/api/records` 回 503，其餘功能照常 |
| `MONGODB_DB` | `twtrees` | 資料庫名稱（collection 固定為 `trees`） |
| `RATE_LIMIT_PER_MIN` | `300` | 每個 IP 每分鐘請求上限，超過回 429 |
| `RECORDS_PER_MIN` | `2000` | 每個 IP 每分鐘收錄筆數上限，超過回 429 |
| `STUDY_PHASE` | `dev` | 研究階段標籤，寫進每筆紀錄 |

伺服器端限制：`Content-Type` 必須是 `application/json`（否則 415）；請求內容上限 256KB（超過回 413 並中斷連線）、每次最多 100 筆；`id`／`deviceId` 超長直接拒絕、其餘字串截斷；唯一索引建立失敗時寫入回 503，下次請求再嘗試建立。

### 隱私說明

- 只有在學生按下「我同意」之後才會上傳；未同意或按「不同意」時，樹資料與 GPS 都只留在本機，Google 試算表與 MongoDB 都不送。
- 上傳內容為匿名裝置代碼、場次標籤、樹的量測結果與量測過程、瀏覽器識別字串；不含姓名、帳號等個資。
- 「匯出 JSON」的檔案會包含每筆的 `measure`（含瀏覽器識別字串 `userAgent`），分享該檔時請留意。
- 同意提示已說明會上傳瀏覽器／手機型號資訊（用於分析量測誤差）。
- 伺服器不保存來源 IP（限流只在記憶體內計數）；錯誤 log 只記錯誤名稱，不印連線字串。

### 已知風險（PI 已知悉並接受）

- 全班共用同一組門禁帳密，且以 `(deviceId, id)` 為 upsert 鍵：知道他人 `deviceId` 與 `id` 的人，理論上可覆寫該筆雲端紀錄。`deviceId` 為隨機 UUID、不對外顯示於清單，風險低，目前不處理。
- 刪除只影響本機，雲端紀錄需由研究者在資料庫端處理。
