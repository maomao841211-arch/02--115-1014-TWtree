#!/usr/bin/env python3
"""
Merge YOLObank datasets into main YOLO dataset.
Idempotent: re-running does not duplicate files.
"""

import os
import shutil
from pathlib import Path
from collections import defaultdict

# Configuration
DATASETS = [
    {
        'name': 'Fire-Extinguisher.v1i',
        'src': r'C:\Users\yjchang\Google 雲端硬碟\2026年計畫\應用學門\Cmytree\YOLObank\Fire-Extinguisher.v1i',
        'prefix': 'fireext_',
        'class_map': {0: 8},  # All class 0 → 8
    },
    {
        'name': 'GENERATOR.v1i',
        'src': r'C:\Users\yjchang\Google 雲端硬碟\2026年計畫\應用學門\Cmytree\YOLObank\GENERATOR.v1i',
        'prefix': 'generator_',
        'class_map': {0: 2},  # All class 0 → 2
    },
    {
        'name': 'GasC_test.v9-2023-08-29-all_classes',
        'src': r'C:\Users\yjchang\Google 雲端硬碟\2026年計畫\應用學門\Cmytree\YOLObank\GasC_test.v9-2023-08-29-all_classes',
        'prefix': 'gasc_',
        'class_map': 'default_4',  # All non-8/20 → 4, discard 8/20
    },
]

DST_BASE = r'C:\Users\yjchang\Google 雲端硬碟\2026年計畫\應用學門\Cmytree\YOLO\dataset'
DST_IMAGES = DST_BASE + r'\images'
DST_LABELS = DST_BASE + r'\labels'


def remap_class(line, dataset_name, class_map):
    """
    Remap class in a YOLO label line.
    Format: cls x y w h
    Returns: modified line or None if should be discarded.
    """
    line = line.strip()
    if not line:
        return None

    parts = line.split()
    if len(parts) < 5:
        return None

    cls_str = parts[0]
    try:
        cls = int(cls_str)
    except ValueError:
        return None

    coords = ' '.join(parts[1:5])

    if class_map == 'default_4':
        # GasC_test: discard 8 and 20, map others to 4
        if cls in (8, 20):
            return None  # Discard this line
        new_cls = 4
    else:
        # Standard mapping dict
        new_cls = class_map.get(cls, cls)

    return f"{new_cls} {coords}"


def process_dataset(config, stats):
    """Process one YOLObank dataset."""
    name = config['name']
    src = config['src']
    prefix = config['prefix']
    class_map = config['class_map']

    dataset_stats = {
        'train_copied': 0,
        'val_copied': 0,
        'empty_labels_skipped': 0,
        'discard_8_20_count': 0,  # For GasC_test
    }

    src_path = Path(src)
    if not src_path.exists():
        print(f"[WARN] Skipping {name}: source not found")
        return dataset_stats

    # Process train, valid, test splits
    splits_map = {
        'train': 'train',
        'valid': 'val',
        'test': 'val',
    }

    for src_split, dst_split in splits_map.items():
        src_images = src_path / src_split / 'images'
        src_labels = src_path / src_split / 'labels'

        if not src_images.exists():
            continue

        dst_img_dir = Path(DST_IMAGES) / dst_split
        dst_lbl_dir = Path(DST_LABELS) / dst_split
        dst_img_dir.mkdir(parents=True, exist_ok=True)
        dst_lbl_dir.mkdir(parents=True, exist_ok=True)

        image_files = list(src_images.glob('*.*'))

        for img_file in image_files:
            basename = img_file.stem
            img_ext = img_file.suffix
            label_file = src_labels / (basename + '.txt')

            new_basename = prefix + basename
            dst_img_path = dst_img_dir / (new_basename + img_ext)
            dst_lbl_path = dst_lbl_dir / (new_basename + '.txt')

            # Skip if already copied (idempotent)
            if dst_img_path.exists() and dst_lbl_path.exists():
                if dst_split == 'train':
                    dataset_stats['train_copied'] += 1
                else:
                    dataset_stats['val_copied'] += 1
                continue

            # Process label file
            if label_file.exists():
                with open(label_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()

                new_lines = []
                for line in lines:
                    new_line = remap_class(line, name, class_map)
                    if new_line is None:
                        if class_map == 'default_4':
                            dataset_stats['discard_8_20_count'] += 1
                    else:
                        new_lines.append(new_line + '\n')

                # Skip image+label if all annotations were discarded
                if not new_lines:
                    dataset_stats['empty_labels_skipped'] += 1
                    continue

                # Write new label (UTF-8 with LF line endings)
                with open(dst_lbl_path, 'w', encoding='utf-8', newline='') as f:
                    f.writelines(new_lines)
            else:
                # No label file (unusual but handle gracefully)
                # Create empty label
                with open(dst_lbl_path, 'w', encoding='utf-8') as f:
                    pass

            # Copy image
            shutil.copy2(str(img_file), str(dst_img_path))

            if dst_split == 'train':
                dataset_stats['train_copied'] += 1
            else:
                dataset_stats['val_copied'] += 1

    return dataset_stats


def main():
    stats = defaultdict(lambda: {
        'train_copied': 0,
        'val_copied': 0,
        'empty_labels_skipped': 0,
        'discard_8_20_count': 0,
    })

    print("Merging YOLObank datasets...")
    print("=" * 60)

    for config in DATASETS:
        dataset_stats = process_dataset(config, stats)
        stats[config['name']] = dataset_stats
        print(f"{config['name']}:")
        print(f"  train: {dataset_stats['train_copied']} copied")
        print(f"  val: {dataset_stats['val_copied']} copied (valid + test)")
        if dataset_stats['empty_labels_skipped'] > 0:
            print(f"  skipped (empty labels): {dataset_stats['empty_labels_skipped']}")
        if dataset_stats['discard_8_20_count'] > 0:
            print(f"  discarded boxes (class 8/20): {dataset_stats['discard_8_20_count']}")

    # Count final totals
    dst_train_img = list((Path(DST_IMAGES) / 'train').glob('*.*'))
    dst_val_img = list((Path(DST_IMAGES) / 'val').glob('*.*'))
    dst_train_lbl = list((Path(DST_LABELS) / 'train').glob('*.txt'))
    dst_val_lbl = list((Path(DST_LABELS) / 'val').glob('*.txt'))

    print("\n" + "=" * 60)
    print("Final totals in destination:")
    print(f"  images/train: {len(dst_train_img)} files")
    print(f"  images/val: {len(dst_val_img)} files")
    print(f"  labels/train: {len(dst_train_lbl)} files")
    print(f"  labels/val: {len(dst_val_lbl)} files")

    # Detect image/label mismatch
    train_imgs = set(f.stem for f in (Path(DST_IMAGES) / 'train').glob('*.*'))
    train_lbls = set(f.stem for f in (Path(DST_LABELS) / 'train').glob('*.txt'))
    val_imgs = set(f.stem for f in (Path(DST_IMAGES) / 'val').glob('*.*'))
    val_lbls = set(f.stem for f in (Path(DST_LABELS) / 'val').glob('*.txt'))

    img_only_train = train_imgs - train_lbls
    lbl_only_train = train_lbls - train_imgs
    img_only_val = val_imgs - val_lbls
    lbl_only_val = val_lbls - val_imgs

    print("\n" + "=" * 60)
    print("Image/label pairing check:")
    if img_only_train or lbl_only_train or img_only_val or lbl_only_val:
        print("[MISMATCH DETECTED]")
        if img_only_train:
            print(f"  train: {len(img_only_train)} images without labels")
        if lbl_only_train:
            print(f"  train: {len(lbl_only_train)} labels without images")
        if img_only_val:
            print(f"  val: {len(img_only_val)} images without labels")
        if lbl_only_val:
            print(f"  val: {len(lbl_only_val)} labels without images")
    else:
        print("[OK] All images have corresponding labels (no pairing issues from merge)")

    return stats


if __name__ == '__main__':
    main()
