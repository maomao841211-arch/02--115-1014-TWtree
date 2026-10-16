# Probe 訓練指南（先小樣本驗證整條鏈路，再全量）

> 依「先 probe＋成本估算、核可才全量」原則。目標分兩層：
> **(A) 冒煙測試**確認不會當、**(B) probe** 確認「訓練→匯出 ONNX→瀏覽器偵測→提醒」整條鏈路通。
> 全部在你的 GPU 機（ASCII 路徑）跑；本機中文路徑勿跑。基本指令見 `train.md`，本檔只補 probe 與不平衡。

## 0. 目前資料現況（決定 probe 能驗到什麼）

合併後每類實際框數（train+val，資料集 commit `8383201`）：

| id | 類別 | 框數 | 狀態 |
|----|------|------|------|
| 4 | lpg_cylinder | 19,845 | 充足（但過量，見 §4） |
| 8 | fire_extinguisher | 2,164 | 充足 |
| 6 | scooter | 1,535 | 充足 |
| 7 | truck | 1,200 | 充足 |
| 11 | fridge | 989 | 尚可 |
| 5 | car | 968 | 尚可 |
| 2 | generator | 330 | 偏少 |
| 0 | gas_stove | 0 | ⚠️ 無資料 |
| 1 | boiler | 0 | ⚠️ 無資料 |
| 3 | brush_cutter | 0 | ⚠️ 無資料 |
| 9 | gas_cylinder | 0 | ⚠️ 無資料 |
| 10 | ac_outdoor | 0 | ⚠️ 無資料 |

影像：train 7,902 張、val 1,945 張。

**重點**：5 個類別目前 **0 資料**，模型學不到、AP 必為 0——這是預期，不是 bug。等校園實拍（見 `../dataset/campus_shoot_SOP.md`）補上才會動。
**建議 nc 維持 12 不變**：讓輸出張量的類別順序與前端 `model.json` 契約一致，換權重不必改前端；空的 5 類先當佔位、不會誤觸發（沒學過就幾乎不會輸出）。

## 1. 先設好 data.yaml 路徑（GPU 機）

`../dataset/data.yaml` 目前是相對路徑。在 GPU 機把資料集放好後，改 `path` 為絕對路徑即可：
```yaml
path: /abs/path/to/YOLO/dataset   # ← 改成你 GPU 機上的實際絕對路徑
train: images/train
val: images/val
# names / nc 不動
```

## 2. (A) 冒煙測試 — 先確認不會當（~1–2 分鐘）

用極小樣本、1 epoch、小解析度，只驗「跑得起來、不崩」，順便量你這台的每-epoch 實際耗時：
```bash
yolo detect train \
  model=yolo11n.pt \
  data=/abs/path/to/YOLO/dataset/data.yaml \
  imgsz=320 epochs=1 batch=16 fraction=0.02 \
  project=YOLO/training/runs name=smoke cache=ram
```
- `fraction=0.02`：只用 2% 訓練資料。跑完沒錯、有出 `runs/smoke/` 就算過。
- 看 log 印出的每-epoch 秒數 → 用來估 probe/全量時間（見 §5）。

## 3. (B) Probe — 驗證整條鏈路（約 10–15 分鐘，視 GPU）

```bash
yolo detect train \
  model=yolo11n.pt \
  data=/abs/path/to/YOLO/dataset/data.yaml \
  imgsz=640 epochs=5 batch=16 \
  project=YOLO/training/runs name=ghg_probe cache=ram
```
- 只要 5 epochs：**目的是驗鏈路，不是收斂**。mAP 難看沒關係。
- 產物：`runs/ghg_probe/weights/best.pt`。
- 有資料的 7 類應該開始有非 0 的 AP（尤其 lpg_cylinder / fire_extinguisher）；5 個空類 AP=0 正常。

### 接著匯出 + 上瀏覽器驗證（這才是 probe 真正要驗的）
```bash
yolo export model=YOLO/training/runs/ghg_probe/weights/best.pt \
  format=onnx opset=12 imgsz=640 simplify=True
# 產出 best.onnx → 複製改名成 app/models/ghg.onnx
```
然後：更新 `app/models/model.json`（imgsz=640、12 類順序同 data.yaml、輸出張量格式）→ 用 `dev-tools/serve-https.py` 開 app → 手機對著**滅火器或桶裝瓦斯瓶**，確認會框、會提醒。
**通過標準**：不是精度，而是「相機→推論→框→提醒」整條走得通、座標對得上。

## 4. 類別不平衡處理建議（全量前才需要，probe 可忽略）

lpg_cylinder 一類就占 ~80% 的框（19,845 vs generator 330）。若直接全量訓練，模型會偏向猛報 lpg_cylinder。

**Ultralytics detect CLI 沒有乾淨的「每類 loss 加權」參數**，實務上靠**資料層**調整，建議二擇一或並用：
1. **下採樣多數類（推薦、最有效且更快）**：隨機抽 lpg_cylinder 的一部分影像，把它的框數壓到跟其他主力類同量級（例如 ~2,000）。這步是機械性抽樣，全量前再請 data-prep 做一支可重跑的抽樣腳本即可。
2. **補少數類**：generator（330）等偏少類，靠校園實拍或再找公開資料補到 ~500+；或訓練時加重增強。
3. 內建 `mosaic`/`hsv`/`flip` 增強預設已開，對少數類泛化有幫助，維持即可。

> 提醒：5 個 0 資料類別在補到資料前，不管怎麼調都學不起來——優先級是「校園實拍補齊」而非調參。

## 5. 成本估算 — 已於本機 RTX 4080 Laptop 實測（2026-07-15）

實測數字（YOLO11n、full data 7,902 train / 1,945 val）：
| 項目 | 實測 | 說明 |
|------|------|------|
| 冒煙測試 | ~11 秒 | fraction=0.02、1 epoch、imgsz=320 |
| **Probe（5 epochs, imgsz=640）** | **~6.6 分**（約 1.3 分/epoch） | 本機 RTX 4080 Laptop、batch=16、cache=disk |
| ONNX 匯出 | ~48 秒 | opset=12、simplify、輸出 10.1 MB |
| 全量 100 epochs 外推 | 約 2–2.5 小時 | 1.3 分/epoch × 100；下採樣 lpg 後更快 |
| 端上推論 | 0.5–0.8 ms/張 | 4080 上；手機會較慢但仍即時 |

> ✅ **本機（中文路徑）即可訓練＋匯出**，Python/ultralytics 不受 Node 的 CJK segfault 影響，不必搬 GPU 機。
> GPU 機（RunPod/GB10）留給全量長跑或更大模型即可。

## 6. 每個 run 寫 manifest（規範）

在 `runs/<name>/` 放一份 `manifest.md`，至少記：
```
機器/GPU     : 例 RunPod RTX 4090 / GB10
base model   : yolo11n.pt
imgsz/epochs/batch : 640 / 5 / 16
dataset commit : 8383201
每類框數快照  : 見 probe.md §0
每-epoch 秒數 : （冒煙測試量到）
匯出格式/opset : onnx / 12
備註         : 5 類 0 資料(gas_stove/boiler/brush_cutter/gas_cylinder/ac_outdoor)
```

## 7. Probe 實測結果（2026-07-15，本機 RTX 4080 Laptop）

5 epochs / imgsz=640 / full data，best.pt 驗證：整體 **mAP50 0.521、mAP50-95 0.36**。每類：
| 類別 | mAP50 | 備註 |
|------|-------|------|
| fire_extinguisher (8) | **0.954** | Roboflow 集，同質、學最好 |
| generator (2) | **0.894** | 僅 330 框仍表現佳 |
| lpg_cylinder (4) | **0.869** | 資料最多 |
| fridge (11) | 0.289 | Open Images，場景多樣、較難 |
| car (5) | 0.252 | 同上 |
| truck (7) | 0.200 | 同上 |
| scooter (6) | 0.188 | 同上 |
| gas_stove/boiler/brush_cutter/gas_cylinder/ac_outdoor | — | 0 資料，未出現於驗證表（符合預期） |

**判讀**：Roboflow 三類（滅火器/發電機/桶裝瓦斯）已很高；Open Images 四類（車/機車/貨車/冰箱）偏低，因場景多樣、且僅 5 epochs 未收斂。全量 + 更多 epoch 會拉高。

**鏈路驗證（headless 全通）**：train(CJK 路徑 OK) → best.pt → 匯出 ONNX(10.1MB) → onnxruntime 載入 → 輸出 `output0 [1, 16, 8400]`（4 框+12 類，對上前端契約）✓
**還沒做**：手機瀏覽器端「相機→框→提醒」實機驗證（需把 onnx 放 app/models/、更新 model.json、手機開 app）。

---

**建立**：2026-07-15　**對應資料集 commit**：8383201　**base**：YOLO11n
**已做**：冒煙測試 → probe(5ep) → ONNX 匯出/載入驗證（見 §5、§7）。
**待做**：手機端實機驗證；全量與 lpg 下採樣待核可後再做。
