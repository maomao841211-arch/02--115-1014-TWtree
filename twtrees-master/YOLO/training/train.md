# 訓練與匯出指令（你自己在 GPU 機器上跑）

> 你已有 YOLO 訓練經驗，這裡只列本專案的具體參數與**匯出成瀏覽器可用格式**的關鍵步驟。
> ⚠️ 不要在本機（Windows 中文路徑）跑 Python 重工——已知 Node/工具在中文路徑會出事；
> 建議在你的 GPU 機（RunPod／GB10 等 ASCII 路徑環境）訓練。

## 0. 環境
```bash
pip install ultralytics onnx onnxruntime onnxslim
# 匯出 TF.js 才需要（二選一，見下方選型）：
# pip install tensorflow tensorflowjs
```

## 1. 訓練（建議 YOLO11n / YOLOv8n — 小、適合手機端）
```bash
yolo detect train \
  model=yolo11n.pt \
  data=/abs/path/YOLO/dataset/data.yaml \
  imgsz=640 epochs=100 batch=16 \
  project=YOLO/training/runs name=ghg_v1
```
- 端上要即時，**優先用 n（nano）系列**；若精度不足再升 s。
- 資料少時：`epochs` 可拉高並開早停；善用內建增強（mosaic/flip/hsv）。
- 產物：`YOLO/training/runs/ghg_v1/weights/best.pt`

## 2. 匯出成瀏覽器格式（本專案採 ONNX，見 README 選型）
```bash
# ONNX（給 onnxruntime-web 用；opset 12、動態關閉以利 web 端）
yolo export model=YOLO/training/runs/ghg_v1/weights/best.pt \
  format=onnx opset=12 imgsz=640 simplify=True
# 產出 best.onnx → 複製/改名放到 app/models/ghg.onnx
```
- 前端讀取的類別順序、`imgsz`、輸出張量形狀必須和這裡一致（見 README「模型契約」）。
- 若日後改走 TF.js：`format=tfjs`，產出資料夾放 `app/models/`。

## 3. 交接給前端
把 `ghg.onnx`（或 tfjs 資料夾）與一份 `model.json`（記錄 imgsz / 類別順序 / 輸出格式）
放進 `YOLO/app/models/`（權重已 gitignore，另行傳檔）。前端 `index.html` 只認這個契約，
換模型時**不改前端程式**，只換權重＋更新 `model.json`。

## 4. 驗收
- `yolo detect val ...` 看 mAP50；每類 AP 太低的先補資料。
- 端到端：把 best.onnx 放進 app，手機開相機對著真實物件，確認會框、會提醒。
