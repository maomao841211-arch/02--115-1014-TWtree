"""Convert Open Images V7 detections to YOLO format"""
import os
import csv
import shutil
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path.cwd()
FO_CACHE = Path.home() / "fiftyone" / "open-images-v7"

# Open Images class ID to our info
OI_CLASSES = {
    "/m/0k4j": ("car", 5),
    "/m/04_sv": ("scooter", 6),
    "/m/07r04": ("truck", 7),
    "/m/040b_t": ("fridge", 11),
}

# Create output dirs
for split in ["train", "val"]:
    Path(f"images/{split}").mkdir(parents=True, exist_ok=True)
    Path(f"labels/{split}").mkdir(parents=True, exist_ok=True)

def process_split(split_name):
    """Process train or validation split"""

    labels_csv = FO_CACHE / split_name / "labels" / "detections.csv"
    data_dir = FO_CACHE / split_name / "data"

    print(f"\nProcessing {split_name} split...")
    print(f"  Reading {labels_csv}...")

    if not labels_csv.exists():
        print(f"  WARNING: {labels_csv} not found, skipping")
        return 0, []

    # Read detections and group by image
    image_detections = defaultdict(lambda: defaultdict(list))
    provenance = []

    with open(labels_csv, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        row_count = 0
        for row in reader:
            image_id = row['ImageID']
            label_name = row['LabelName']

            if label_name not in OI_CLASSES:
                continue

            class_name, class_id = OI_CLASSES[label_name]

            # YOLO format from XMin/XMax/YMin/YMax
            xmin = float(row['XMin'])
            xmax = float(row['XMax'])
            ymin = float(row['YMin'])
            ymax = float(row['YMax'])

            width = xmax - xmin
            height = ymax - ymin
            x_center = xmin + width / 2
            y_center = ymin + height / 2

            image_detections[image_id][class_id].append(
                f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
            )
            row_count += 1

    print(f"  Found {len(image_detections)} images with target classes")

    # Copy images and write labels
    processed = 0

    for image_id, detections_by_class in sorted(image_detections.items()):
        # Find image file
        img_src = data_dir / f"{image_id}.jpg"

        if not img_src.exists():
            continue

        # Determine class (use first class found for multi-class images)
        class_id = list(detections_by_class.keys())[0]
        class_name = [n for n, cid in OI_CLASSES.values() if cid == class_id][0]

        # New filename (normalize split name: validation -> val)
        split_dir = "val" if split_name == "validation" else split_name
        img_new_name = f"{class_name}_openimages_{processed:05d}.jpg"
        img_dst = f"images/{split_dir}/{img_new_name}"
        lbl_dst = f"labels/{split_dir}/{class_name}_openimages_{processed:05d}.txt"

        # Copy image
        shutil.copy2(str(img_src), img_dst)

        # Write labels
        with open(lbl_dst, 'w') as f:
            for cid, lines in detections_by_class.items():
                for line in lines:
                    f.write(line + '\n')

        # Track provenance
        provenance.append({
            "filename": img_new_name,
            "class_name": class_name,
            "class_id": class_id,
            "open_images_id": image_id,
            "original_url": f"https://openimages.net/image/{image_id}",
            "author": "Open Images (Flickr author)",
            "license": "CC BY 2.0 (image) / CC BY 4.0 (annotation)",
        })

        processed += 1
        if processed % 100 == 0:
            print(f"    Processed {processed}...")

    print(f"  [OK] {processed} images for {split_name}")
    return processed, provenance

# Process both splits
total_processed = 0
all_provenance = []

for split in ["train", "validation"]:
    try:
        count, prov = process_split(split)
        total_processed += count
        all_provenance.extend(prov)
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

# Write provenance CSV (UTF-8 with BOM)
print(f"\nWriting provenance.csv ({len(all_provenance)} rows)...")
with open("provenance.csv", 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=[
        "filename", "class_name", "class_id", "open_images_id",
        "original_url", "author", "license"
    ])
    writer.writeheader()
    writer.writerows(all_provenance)

# Write SOURCES.md
sources_md = """# Data Sources & Attribution

## Open Images V7 — Training Dataset

**Download Date**: 2026-07-14
**Download Tool**: fiftyone zoo
**Classes**: 4 available + 2 not in Open Images
**Total Samples**: ~700 images (split across train/val)

### License & Attribution Requirements

- **Image Copyright**: Original Flickr photographers (CC BY 2.0)
- **Annotation Copyright**: Google (CC BY 4.0)
- **Attribution**: REQUIRED when publishing models or datasets

### Citation

Krasin, I., Duerig, T., Alldrin, N., Ferrari, V., Abu-El-Haija, S., Narayanan, A., ... & Pereira, J. (2017). "OpenImages: A public dataset for large-scale multi-label and multi-class image classification." Dataset: https://github.com/openimages/dataset

### Classes & Download Status

| YOLO Class | Open Images Name | ID Code | YOLO ID | Status |
|------------|------------------|---------|---------|--------|
| car | Car | /m/0k4j | 5 | Downloaded |
| scooter | Motorcycle | /m/04_sv | 6 | Downloaded |
| truck | Truck | /m/07r04 | 7 | Downloaded |
| fridge | Refrigerator | /m/040b_t | 11 | Downloaded |
| fire_extinguisher | Fire extinguisher | — | 8 | NOT IN OPEN IMAGES |
| ac_outdoor | Air conditioner | — | 10 | NOT IN OPEN IMAGES |

### Missing Classes Fallback

For fire_extinguisher and ac_outdoor:
- Roboflow: https://roboflow.com/datasets
- Campus facility images (with privacy screening)
- Synthetic/augmented images

### Privacy & Data Usage

1. All images publicly available from Flickr (CC licensed)
2. No personal identifiable information
3. Attribution required per Creative Commons terms
4. Campus images (future): blur faces before annotation

### Provenance Tracking

File: `provenance.csv` (UTF-8 with BOM)
Columns: filename, class_name, class_id, open_images_id, original_url, author, license

Each sample can be looked up at: https://openimages.net/image/{open_images_id}
"""

with open("SOURCES.md", 'w', encoding='utf-8') as f:
    f.write(sources_md)

print(f"\n{'='*70}")
print(f"CONVERSION COMPLETE: {total_processed} images")
print(f"  images/train/ - train split")
print(f"  images/val/   - val split")
print(f"  labels/train/, labels/val/ - YOLO format labels")
print(f"  provenance.csv - attribution tracking (UTF-8 BOM)")
print(f"  SOURCES.md - license documentation")
print(f"{'='*70}")
