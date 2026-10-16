# 校園溫室氣體排放源掃描器 — 計畫書與技術文件

> 一個手機／平板網頁（PWA）：**開相機掃描校園，YOLO 即時認出溫室氣體排放源物件，
> 偵測到就提醒（震動／聲音＋畫面閃爍），畫面上有浮動按鍵操作。**
> 排放源類別對應「臺北市校園簡易碳盤查表格.xlsx」的範疇一工作表。

---

## 1. 這是什麼、為什麼

**用途**：把碳盤查表格裡抽象的「排放源清單」變成**走一圈校園、用相機掃出來**的互動流程——
師生拿手機掃到瓦斯爐、發電機、冷氣室外機、滅火器…就被提醒「這裡有一個排放源，登記一下」，
降低盤查門檻、兼具教學性。

**和碳盤查表格的關係**：模型負責「**找到並清點**」可見的排放源物件；
精確的燃料/冷媒種類與用量，仍回到原表格由人工填（見第 3 節限制）。

**和隔壁 CMyTrees 的關係**：兩者是姊妹專案、共用同一套前端底子
（相機即時畫面＋透明 canvas 疊圖＋浮動按鍵，已在 `../app` 與 `../dev-tools/ar-measure.html` 驗證）。

---

## 2. 偵測類別（12 類）

對應工作表 **2-1 固定 / 2-2 移動 / 2-3(2) 滅火器·鋼瓶 / 2-3(3) 冷媒**；
化糞池 2-3(1) 因埋於地下、相機不可見而不納入。完整定義與標註規範見
[`dataset/classes.md`](dataset/classes.md)，機器可讀清單見 [`dataset/data.yaml`](dataset/data.yaml)。

`gas_stove` 瓦斯爐、`boiler` 鍋爐、`generator` 發電機、`brush_cutter` 除草機、
`lpg_cylinder` 桶裝瓦斯桶、`car` 汽車、`scooter` 機車、`truck` 貨車、
`fire_extinguisher` 滅火器、`gas_cylinder` 實驗室氣體鋼瓶、`ac_outdoor` 冷氣室外機、`fridge` 冰箱/冷凍櫃。

---

## 3. ⚠️ 兩個科學限制（先講清楚）

1. **相機看不到氣體本身**。溫室氣體無色透明，模型偵測的是「排放源的**可見物件**」當代理，
   不是氣體。要「看見」氣體需熱像／紅外／高光譜相機，一般手機沒有。
2. **視覺分不出化學種類**。冷氣室外機是 R-32 還是 R-410A、滅火器是 CO₂ 還是乾粉——外觀相同。
   模型只到「有一台室外機／一支滅火器」；**種類與用量仍人工填**。這也界定了本工具的定位：
   **輔助尋找與清點**，不是碳量化工具。

---

## 4. 系統架構

```
[手機/平板瀏覽器 (HTTPS)]
   相機串流 getUserMedia
        │每幀抽樣
        ▼
   前處理 (letterbox 640, 正規化)
        │
        ▼
   YOLO 推論 (onnxruntime-web, WASM/WebGPU 端上)
        │輸出框+類別+信心
        ▼
   後處理 (NMS) → 疊框到透明 canvas + 浮動按鍵
        │偵測到目標
        ▼
   提醒: navigator.vibrate() (Android) ／ 聲音+畫面閃爍 (iOS 後備)
        │使用者按浮動鍵
        ▼
   登記該排放源 (localStorage；未來同步雲端，比照 CMyTrees)
```

- **端上推論、無後端**：影像不上傳，純前端跑模型，隱私友善、離線可用。
- **模型契約**：前端只認 `app/models/model.json`（記錄 `imgsz`、類別順序、輸出張量格式）＋權重檔；
  換模型不改前端程式（見 `training/train.md` 第 3 節）。

---

## 5. 技術棧與選型

| 層面 | 採用 | 理由 |
|------|------|------|
| 形態 | PWA 單一 HTML（比照 CMyTrees） | 免建置、好部署、避開本機 Node 中文路徑當機問題 |
| 端上推論 | **onnxruntime-web**（WASM，優先偵測 WebGPU） | 跨 iOS/Android 相容性最好；Ultralytics 直接匯出 ONNX |
| 相機/疊圖 | `getUserMedia` + 透明 `<canvas>` | 沿用 ar-measure.html 已驗證的凍結/疊線/浮動鍵模式 |
| 提醒 | `navigator.vibrate()` + 聲音(WebAudio) + 畫面閃爍 | **iOS Safari 不支援震動**，故 iOS 走聲音＋閃爍後備 |
| 儲存 | `localStorage`（比照 CMyTrees 資料模型） | 純前端；未來可雙寫雲端 |
| 離線/安裝 | Service Worker + manifest | 可裝主畫面、離線可用 |
| 訓練 | Ultralytics YOLO11n/v8n（你在 GPU 機跑） | 小模型適合端上即時；見 `training/train.md` |
| 測試伺服器 | 沿用 `../dev-tools/serve-https.py`（HTTPS） | iOS 需 HTTPS 才給相機/感測器 |

> **iOS 震動限制**是硬限制，非 bug：Safari 未實作 Vibration API。iPhone/iPad 一律以
> 「提示音＋畫面紅框閃爍」代替震動；Android Chrome 才有真震動（兩者都做，依平台自動切換）。

### 檔案結構
```
YOLO/
├── README.md                 ← 本計畫書
├── .gitignore                ← 資料集/權重/個資 一律排除
├── app/                      ← 前端 PWA（掃描＋提醒＋登記）
│   ├── index.html            #   相機 + YOLO 推論 + 浮動鍵 + 提醒 + 清單
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── models/               #   放 ghg.onnx + model.json（權重 gitignore，另行傳）
│   └── icons/
├── dataset/
│   ├── data.yaml             #   12 類定義（YOLO 用）
│   ├── classes.md            #   類別↔工作表對照 + 標註規範 + 隱私紅線
│   ├── scripts/              #   下載/轉檔/去識別化腳本（data-prep 產出）
│   ├── raw/ images/ labels/  #   gitignore
├── training/
│   └── train.md              #   訓練＋匯出 ONNX 指令（你在 GPU 機跑）
└── _local/                   ← gitignore：校園實拍/含臉原始檔絕不進 repo
```

---

## 6. 資料集策略（混合，先小樣本 probe）

分兩種來源（詳見 `dataset/classes.md`）：
- **公開資料集 bootstrap**：常見類別（car/scooter/truck/fridge/滅火器/冷氣室外機）
  從 Open Images / Roboflow Universe 抓，用腳本轉成 YOLO 格式。
- **校園實地拍**：校園特有類別（鍋爐/發電機/桶裝瓦斯/實驗鋼瓶）自拍最準、最貼近部署場域。

**分階段量**：probe 每類 ~50 → MVP 150–300 → 正式 500+（校園實拍為主）。
**流程**：先跑 probe（1 類約 50 張）驗證「下載→轉檔→訓練→匯出→瀏覽器」整條鏈路與授權，
確認可行＋成本估算後，我再擴充全量。腳本放 `dataset/scripts/`。

**隱私**：校園照片常入鏡學生人臉 → 一律先 `blur_faces.py` 打碼；原始/含臉檔只放 `_local/`，
絕不進 public repo。

---

## 7. 怎麼跑（本機測試）

前端純靜態，沿用 CMyTrees 的 HTTPS 測試伺服器（同一支即可服務兩個 app）：
```bash
python dev-tools/serve-https.py
# 手機同一 WiFi 開 https://<電腦區網IP>:8443/YOLO/app/index.html
```
- iOS 需 HTTPS 才給相機權限；第一次憑證警告點「繼續」。
- 模型權重（`app/models/ghg.onnx`）因 gitignore，需另行放入才能真正偵測；
  骨架階段先掛一個現成預訓練模型驗證「掃描→提醒」鏈路。

---

## 8. 開發分工與現況

比照本 repo 多模型分工（指揮官 → coder → 雙複核）：
- **指揮官**：規劃、類別對照、計畫書（本檔）、資料集規範。
- **coder**：`app/` 前端骨架（相機＋YOLO 推論管線＋浮動鍵＋iOS 後備提醒）。
- **data-prep**：`dataset/scripts/` 下載/轉檔/去識別化腳本，並跑 probe。
- **reviewer(Opus)**：coder 產出後、commit 前獨立複核。
- **你**：在 GPU 機訓練與匯出模型（`training/train.md`）。

## 9. 已知限制與待辦
1. 相機看不到氣體、視覺分不出化學種類（第 3 節）——本工具定位為「尋找／清點」。
2. **iOS 無震動**，以聲音＋閃爍代替。
3. 端上推論 FPS 受手機效能影響；必要時降輸入解析度或抽幀。
4. 化糞池不可偵測，留在原表格人工計算。
5. 模型精度取決於資料量與標註品質，尤其校園特有類別需足量實拍。
6. 待辦：正式權重交接、雲端登記同步（比照 CMyTrees 未來規劃）、與碳盤查表格的資料串接。
