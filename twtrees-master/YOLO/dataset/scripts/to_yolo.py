# -*- coding: utf-8 -*-
"""
將常見標註格式（COCO JSON, Pascal VOC XML）轉換為 YOLO txt 格式。

輸入格式：
  - COCO JSON: annotations 欄位含 images, annotations, categories (id, name)
  - Pascal VOC XML: 每張圖一個 .xml 檔

輸出格式：
  - YOLO txt: dataset/labels/ 內 <image>.txt，每行：
    <class_id> <x_center> <y_center> <width> <height>
    其中座標為相對整張圖的比例 (0~1)
  - 並自動 train/val 8/2 隨機切分

使用範例：
    python to_yolo.py --input coco.json --format coco
    python to_yolo.py --input voc_dir/ --format voc
    python to_yolo.py --input coco.json --val-ratio 0.2
"""

import argparse
import json
import os
import sys
import yaml
from pathlib import Path
from xml.etree import ElementTree as ET
import random


def load_data_yaml(yaml_path='dataset/data.yaml'):
    """讀入 data.yaml，取得類別 id ↔ 名稱映射。"""
    try:
        with open(yaml_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        # 建立 class_name -> class_id 對應
        class_name_to_id = {v: int(k) for k, v in data['names'].items()}
        return class_name_to_id
    except Exception as e:
        print(f"[ERROR] Error reading {yaml_path}: {e}")
        return {}


def convert_coco_to_yolo(coco_json_path, output_dir, class_name_to_id, val_ratio=0.2):
    """
    COCO JSON → YOLO txt
    假設 coco_json_path 的同目錄有所有影像檔。
    """
    print(f"\n[COCO] Reading {coco_json_path}...")

    try:
        with open(coco_json_path, 'r', encoding='utf-8') as f:
            coco_data = json.load(f)
    except Exception as e:
        print(f"[ERROR] Error reading COCO JSON: {e}")
        # M1 修正:main() 用 success, train_list, val_list = convert_coco_to_yolo(...) 解包,
        # 回傳單一 bool 會炸 "cannot unpack non-iterable bool";三值回傳與 VOC 分支一致。
        return False, [], []

    # 建立 category_id -> class_name 與 category_id -> class_id
    cat_to_name = {}
    cat_to_yolo_id = {}

    for cat in coco_data.get('categories', []):
        cat_name = cat['name'].lower().replace(' ', '_')
        cat_id = cat['id']
        cat_to_name[cat_id] = cat_name

        # 查找 YOLO 類別 id
        if cat_name in class_name_to_id:
            cat_to_yolo_id[cat_id] = class_name_to_id[cat_name]
        else:
            print(f"  [SKIP] COCO category '{cat_name}' not in data.yaml")

    # 將 annotations 分組依 image_id
    img_to_boxes = {}
    for ann in coco_data.get('annotations', []):
        img_id = ann['image_id']
        cat_id = ann['category_id']
        bbox = ann['bbox']  # [x, y, w, h] 絕對座標

        if cat_id not in cat_to_yolo_id:
            continue

        if img_id not in img_to_boxes:
            img_to_boxes[img_id] = []

        img_to_boxes[img_id].append({
            'class_id': cat_to_yolo_id[cat_id],
            'bbox': bbox,
        })

    # 逐圖像轉換
    train_list, val_list = [], []
    converted_count = 0

    for img_info in coco_data.get('images', []):
        img_id = img_info['id']
        img_name = img_info['file_name']
        img_h = img_info['height']
        img_w = img_info['width']

        if img_id not in img_to_boxes:
            # 沒有標註框，可視為負樣本（空 txt 或不建檔）
            continue

        # 轉換框
        lines = []
        for box_info in img_to_boxes[img_id]:
            class_id = box_info['class_id']
            x, y, w, h = box_info['bbox']

            # 轉為中心點 + 比例座標
            x_center = (x + w / 2) / img_w
            y_center = (y + h / 2) / img_h
            w_norm = w / img_w
            h_norm = h / img_h

            # 確保在 [0, 1] 範圍內
            x_center = max(0, min(1, x_center))
            y_center = max(0, min(1, y_center))
            w_norm = max(0, min(1, w_norm))
            h_norm = max(0, min(1, h_norm))

            lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}\n")

        # 寫入標籤檔
        label_name = Path(img_name).stem + '.txt'
        label_path = output_dir / label_name

        with open(label_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        # 隨機分配 train/val
        if random.random() < val_ratio:
            val_list.append(img_name)
        else:
            train_list.append(img_name)

        converted_count += 1

    print(f"  [OK] Converted {converted_count} images")
    print(f"    Train: {len(train_list)}, Val: {len(val_list)}")

    return True, train_list, val_list


def convert_voc_to_yolo(voc_dir, output_dir, class_name_to_id, val_ratio=0.2):
    """
    Pascal VOC XML → YOLO txt
    voc_dir 應含 *.xml 標註檔，同目錄或 JPEGImages/ 子目錄為影像。
    """
    print(f"\n[VOC] Reading from {voc_dir}...")

    xml_dir = Path(voc_dir)
    xml_files = list(xml_dir.glob('*.xml'))

    if not xml_files:
        print(f"  [ERROR] No XML files found in {voc_dir}")
        return False, [], []

    train_list, val_list = [], []
    converted_count = 0

    for xml_file in xml_files:
        try:
            tree = ET.parse(xml_file)
            root = tree.getroot()

            # 取得影像大小
            size_elem = root.find('size')
            img_w = int(size_elem.find('width').text)
            img_h = int(size_elem.find('height').text)

            # 取得影像檔名
            img_name = root.find('filename').text

            # 逐物件轉換
            lines = []
            for obj in root.findall('object'):
                class_name = obj.find('name').text.lower().replace(' ', '_')

                if class_name not in class_name_to_id:
                    print(f"    [SKIP] '{class_name}' not in data.yaml")
                    continue

                class_id = class_name_to_id[class_name]

                bbox = obj.find('bndbox')
                xmin = int(bbox.find('xmin').text)
                ymin = int(bbox.find('ymin').text)
                xmax = int(bbox.find('xmax').text)
                ymax = int(bbox.find('ymax').text)

                # 轉為中心點 + 比例座標
                x_center = (xmin + xmax) / 2 / img_w
                y_center = (ymin + ymax) / 2 / img_h
                w_norm = (xmax - xmin) / img_w
                h_norm = (ymax - ymin) / img_h

                # 確保在 [0, 1] 範圍內
                x_center = max(0, min(1, x_center))
                y_center = max(0, min(1, y_center))
                w_norm = max(0, min(1, w_norm))
                h_norm = max(0, min(1, h_norm))

                lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}\n")

            if not lines:
                continue

            # 寫入標籤檔
            label_name = Path(img_name).stem + '.txt'
            label_path = output_dir / label_name

            with open(label_path, 'w', encoding='utf-8') as f:
                f.writelines(lines)

            # 隨機分配 train/val
            if random.random() < val_ratio:
                val_list.append(img_name)
            else:
                train_list.append(img_name)

            converted_count += 1

        except Exception as e:
            print(f"    [ERROR] {xml_file.name}: {e}")

    print(f"  [OK] Converted {converted_count} images")
    print(f"    Train: {len(train_list)}, Val: {len(val_list)}")

    return True, train_list, val_list


def main():
    parser = argparse.ArgumentParser(
        description="Convert annotation formats to YOLO txt"
    )
    parser.add_argument(
        '--input',
        required=True,
        help='Input file (COCO JSON) or directory (VOC XML)',
    )
    parser.add_argument(
        '--format',
        choices=['coco', 'voc'],
        required=True,
        help='Input format',
    )
    parser.add_argument(
        '--output',
        default='dataset/labels',
        help='Output labels directory (default: dataset/labels)',
    )
    parser.add_argument(
        '--val-ratio',
        type=float,
        default=0.2,
        help='Validation split ratio (default: 0.2)',
    )
    parser.add_argument(
        '--yaml',
        default='dataset/data.yaml',
        help='Path to data.yaml (default: dataset/data.yaml)',
    )

    args = parser.parse_args()

    # 讀入類別映射
    class_name_to_id = load_data_yaml(args.yaml)
    if not class_name_to_id:
        print("[ERROR] Failed to load class mapping from data.yaml")
        return 1

    # 建立輸出目錄
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Class mapping: {class_name_to_id}")

    # 轉換
    if args.format == 'coco':
        success, train_list, val_list = convert_coco_to_yolo(
            args.input, output_dir, class_name_to_id, args.val_ratio
        )
    elif args.format == 'voc':
        success, train_list, val_list = convert_voc_to_yolo(
            args.input, output_dir, class_name_to_id, args.val_ratio
        )

    if not success:
        return 1

    # 輸出 train/val 清單（可選，用於 YOLO 訓練）
    with open(output_dir / 'train.txt', 'w', encoding='utf-8') as f:
        f.writelines(f"{img}\n" for img in train_list)

    with open(output_dir / 'val.txt', 'w', encoding='utf-8') as f:
        f.writelines(f"{img}\n" for img in val_list)

    print(f"\n[OK] Conversion complete")
    print(f"  Labels: {output_dir}/")
    print(f"  Train list: {output_dir}/train.txt")
    print(f"  Val list: {output_dir}/val.txt")

    return 0


if __name__ == '__main__':
    sys.exit(main())
