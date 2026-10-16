# -*- coding: utf-8 -*-
"""
下載公開資料集影像並轉成本專案所需的格式。

策略：
1. 優先試 fiftyone 連結 Open Images V7（無 API key，自動下載標籤+框）
2. 若 fiftyone 不可用，改用 Roboflow Universe 的預標註公開資料集（car, motorcycle, truck, fire extinguisher 等）
3. 輸出到 dataset/raw/<class>/ 與 dataset/labels/

使用範例：
    python fetch_public.py --classes car --limit 50
    python fetch_public.py --classes car motorcycle truck --limit 30 --split train
"""

import argparse
import os
import sys
import json
import urllib.request
import urllib.error
import shutil
import yaml
from pathlib import Path

# 類別對應：本專案 YOLO class_id → 公開資料集名稱
CLASS_MAPPING = {
    'car': {
        'oi_names': ['Car'],  # Open Images 標籤
        'yolo_id': 5,
    },
    'scooter': {
        'oi_names': ['Motorcycle'],  # Open Images 可能分為 Motorcycle, Bicycle
        'yolo_id': 6,
    },
    'truck': {
        'oi_names': ['Truck', 'Pickup truck'],
        'yolo_id': 7,
    },
    'fire_extinguisher': {
        'oi_names': ['Fire extinguisher'],
        'yolo_id': 8,
    },
    'fridge': {
        'oi_names': ['Refrigerator'],
        'yolo_id': 11,
    },
    'ac_outdoor': {
        'oi_names': ['Air conditioner'],  # Open Images 可能有此標籤
        'yolo_id': 10,
    },
}

# 校園特有類別（無公開資料集對應，需改用校園實拍）
CAMPUS_ONLY_CLASSES = [
    'gas_stove', 'boiler', 'generator', 'brush_cutter', 'lpg_cylinder', 'gas_cylinder'
]


def check_fiftyone_available():
    """檢查 fiftyone 是否可用。"""
    try:
        import fiftyone
        print("[OK] fiftyone found")
        return True
    except ImportError:
        print("[SKIP] fiftyone not installed. Install with: pip install fiftyone opencv-python")
        return False


def remap_fiftyone_labels(raw_dir, class_name, oi_names, yolo_id):
    """
    M4 修正:fiftyone 的 YOLOv5DatasetExportFormat 會依它自己掃到的類別清單
    重新從 0 開始編號 class id,不等於本專案 CLASS_MAPPING 裡固定的 yolo_id
    (例如 car=5)。若直接把匯出結果當最終標籤使用,id 會跟 dataset/data.yaml
    的 12 類編號錯位,訓練出來的模型類別會全部對錯。

    做法:讀取匯出目錄下含 names 欄位的 yaml(YOLOv5/Ultralytics 匯出慣例的
    dataset.yaml),用「類別名稱」把 fiftyone 的 local id 對回本專案的 yolo_id,
    強制重寫每個 labels/*.txt 的第一欄(class id)。找不到可信的 names 對照表,
    或對照表裡沒有這個類別對應的 Open Images 標籤名稱,就直接判定失敗
    ——寧可擋住整批匯出,不冒 id 錯位卻沒人發現的風險。

    注意:此函式假設的匯出檔案配置(dataset.yaml + labels/*.txt)是 fiftyone
    YOLOv5 匯出格式的常見慣例,實機需 fiftyone 套件才能真正跑到這段,目前
    環境未安裝、無法上機驗證;若正式串接時發現目錄結構不同,請調整這個函式,
    不影響 to_yolo.py / blur_faces.py 等其他腳本。
    """
    raw_path = Path(raw_dir)
    yaml_candidates = sorted(raw_path.rglob("*.yaml")) + sorted(raw_path.rglob("*.yml"))

    names_map = None
    for yaml_path in yaml_candidates:
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception:
            continue
        if isinstance(data, dict) and "names" in data:
            names_map = data["names"]
            break

    if names_map is None:
        print(
            f"    [ERROR] 找不到 fiftyone 匯出的 class yaml(names 對照表),"
            f"無法安全重映射 class id,已中止(避免 id 與 data.yaml 錯位):{raw_path}"
        )
        return False

    # names 可能是 dict({0: 'Car', ...}) 或 list(['Car', ...]);統一成 {local_id(int): name}
    try:
        if isinstance(names_map, dict):
            local_id_to_name = {int(k): v for k, v in names_map.items()}
        else:
            local_id_to_name = dict(enumerate(names_map))
    except Exception as e:
        print(f"    [ERROR] names 對照表格式無法解析: {e}")
        return False

    local_id_to_yolo_id = {
        local_id: yolo_id
        for local_id, name in local_id_to_name.items()
        if name in oi_names
    }

    if not local_id_to_yolo_id:
        print(
            f"    [ERROR] fiftyone 匯出的 names 對照表({local_id_to_name})中找不到 "
            f"{class_name} 對應的公開資料集標籤 {oi_names},無法重映射,已中止。"
        )
        return False

    label_files = [p for p in raw_path.rglob("*.txt") if p.name not in ("train.txt", "val.txt")]

    rewritten = 0
    dropped_lines = 0
    for label_path in label_files:
        try:
            with open(label_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except Exception as e:
            print(f"    [ERROR] 讀取 {label_path} 失敗: {e}")
            return False

        new_lines = []
        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue
            try:
                local_id = int(parts[0])
            except ValueError:
                dropped_lines += 1
                continue
            if local_id not in local_id_to_yolo_id:
                # 不是這次要的目標類別(例如同張圖裡混到其他 Open Images 類別),捨棄該框
                dropped_lines += 1
                continue
            parts[0] = str(local_id_to_yolo_id[local_id])
            new_lines.append(" ".join(parts) + "\n")

        try:
            with open(label_path, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
        except Exception as e:
            print(f"    [ERROR] 寫回 {label_path} 失敗: {e}")
            return False
        rewritten += 1

    print(
        f"    [OK] 已重映射 {rewritten} 個標籤檔至本專案 yolo_id={yolo_id}"
        f"(捨棄 {dropped_lines} 行非目標類別的框)"
    )
    return True


def download_via_fiftyone(classes_list, limit_per_class, split):
    """
    使用 fiftyone 從 Open Images V7 下載資料。
    (Placeholder: 實際實現需網路 + fiftyone 可用)
    """
    try:
        import fiftyone as fo
        import fiftyone.zoo as foz
    except ImportError:
        return False

    print(f"\n[FiftyOne] Downloading from Open Images V7...")

    for class_name in classes_list:
        if class_name not in CLASS_MAPPING:
            print(f"  ⚠ {class_name}: not in public dataset map (campus-only?)")
            continue

        oi_names = CLASS_MAPPING[class_name]['oi_names']
        yolo_id = CLASS_MAPPING[class_name]['yolo_id']

        print(f"  Downloading {class_name} (OI labels: {oi_names})...")

        try:
            # 下載指定類別的 Open Images 子集
            # 此處為簡化示意；實際 fiftyone.zoo.load_zoo_dataset() 有複雜參數
            dataset = foz.load_zoo_dataset(
                "open-images-v7",
                split=split,
                label_types=["detections"],
                classes=oi_names,
                max_samples=limit_per_class,
            )

            # 拼裝輸出路徑
            raw_dir = Path("dataset") / "raw" / class_name
            raw_dir.mkdir(parents=True, exist_ok=True)

            # 匯出 YOLO 格式（fiftyone 有內建轉換）
            dataset.export(
                export_dir=str(raw_dir),
                export_format=fo.types.YOLOv5DatasetExportFormat,
                label_field="detections",
            )

            print(f"    [OK] Downloaded {len(dataset)} samples to {raw_dir}")

            # M4 修正:fiftyone 匯出的 class id 是它自己的編號,不等於 CLASS_MAPPING
            # 的 yolo_id,強制在這裡重映射,不讓未對齊的 id 流入 dataset/labels
            if not remap_fiftyone_labels(raw_dir, class_name, oi_names, yolo_id):
                print(f"    [FAILED] {class_name}: class id 重映射失敗,已中止(避免髒資料)。")
                return False

        except Exception as e:
            print(f"    [ERROR] {e}")
            return False

    return True


def download_via_roboflow(classes_list, limit_per_class):
    """
    備用方案：從 Roboflow Universe 下載公開資料集。
    (Roboflow 預標註的公開資料集無需 API key)
    """
    print("\n[Roboflow Universe] Downloading public datasets...")
    print("  [WARNING] Roboflow download 仍需登入或手動存取權限。")
    print("  建議改用線上標註平台（如 Label Studio + Open Images 自動標籤）。")
    return False


def create_dummy_probe(classes_list, limit_per_class):
    """
    測試環境：建立假 probe 資料（2 張假圖 + 1 假標籤）以驗證流程。
    """
    print("\n[Dummy Probe] Creating test images + labels...")

    for class_name in classes_list:
        if class_name not in CLASS_MAPPING:
            continue

        yolo_id = CLASS_MAPPING[class_name]['yolo_id']
        raw_dir = Path("dataset") / "raw" / class_name
        raw_dir.mkdir(parents=True, exist_ok=True)

        # 建立 2 張假 JPG（最小有效大小）
        try:
            import cv2
            import numpy as np

            for i in range(2):
                img = np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8)
                fname = raw_dir / f"{class_name}_dummy_{i:03d}.jpg"
                cv2.imwrite(str(fname), img)
                print(f"    Created {fname.name}")
        except Exception as e:
            print(f"    [ERROR] {e}")
            return False

        # 建立對應的 YOLO 標籤（每張假圖一個框，中心 + 隨機大小）
        labels_dir = Path("dataset") / "labels"
        labels_dir.mkdir(parents=True, exist_ok=True)

        for i in range(2):
            label_path = labels_dir / f"{class_name}_dummy_{i:03d}.txt"
            # YOLO format: class_id x_center y_center width height (all 0~1)
            with open(label_path, 'w') as f:
                f.write(f"{yolo_id} 0.5 0.5 0.3 0.3\n")
            print(f"    Created {label_path.name}")

    print("  [OK] Dummy probe ready (for testing pipeline)")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Download public dataset images and convert to YOLO format"
    )
    parser.add_argument(
        '--classes',
        nargs='+',
        required=True,
        help='Class names to download (e.g., car scooter truck)',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=50,
        help='Max images per class (default: 50)',
    )
    parser.add_argument(
        '--split',
        choices=['train', 'val', 'test', 'all'],
        default='train',
        help='Dataset split (default: train)',
    )
    parser.add_argument(
        '--method',
        choices=['auto', 'fiftyone', 'roboflow', 'dummy'],
        default='auto',
        help='Download method. auto: try fiftyone, fallback to dummy (default: auto)',
    )

    args = parser.parse_args()

    # 驗證類別
    invalid_classes = [c for c in args.classes if c not in CLASS_MAPPING]
    if invalid_classes:
        print(f"\n[ERROR] Invalid classes: {invalid_classes}")
        print(f"Available: {list(CLASS_MAPPING.keys())}")
        print(f"Campus-only (need manual capture): {CAMPUS_ONLY_CLASSES}")
        return 1

    print(f"Fetching {len(args.classes)} classes, max {args.limit} images each, split={args.split}")

    # 選擇下載方法
    success = False
    if args.method == 'auto':
        if check_fiftyone_available():
            success = download_via_fiftyone(args.classes, args.limit, args.split)
        else:
            print("\nFalling back to dummy probe (install fiftyone for real download):")
            print("  pip install fiftyone opencv-python")
            success = create_dummy_probe(args.classes, args.limit)
    elif args.method == 'fiftyone':
        if not check_fiftyone_available():
            print("fiftyone not available. Install: pip install fiftyone")
            return 1
        success = download_via_fiftyone(args.classes, args.limit, args.split)
    elif args.method == 'roboflow':
        success = download_via_roboflow(args.classes, args.limit)
    elif args.method == 'dummy':
        success = create_dummy_probe(args.classes, args.limit)

    if success:
        print("\n[OK] Download complete")
        print(f"  Images: dataset/raw/<class>/")
        print(f"  Labels: dataset/labels/")
        return 0
    else:
        print("\n[FAILED] Download failed")
        return 1


if __name__ == '__main__':
    sys.exit(main())
