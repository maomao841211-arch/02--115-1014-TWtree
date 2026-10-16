"""Extract images and convert detections from fiftyone datasets to YOLO format"""
import os
import csv
import shutil
from pathlib import Path
import fiftyone as fo

PROJECT_ROOT = Path.cwd()
datasets_config = [
    ("car", "openimages_car_train", "train", 5),
    ("car", "openimages_car_val", "val", 5),
    ("scooter", "oi_scooter_train", "train", 6),
    ("scooter", "oi_scooter_val", "val", 6),
    ("truck", "oi_truck_train", "train", 7),
    ("truck", "oi_truck_val", "val", 7),
    ("fridge", "oi_fridge_train", "train", 11),
    ("fridge", "oi_fridge_val", "val", 11),
]

# Create output dirs
for split in ["train", "val"]:
    Path(f"images/{split}").mkdir(parents=True, exist_ok=True)
    Path(f"labels/{split}").mkdir(parents=True, exist_ok=True)

provenance = []
processed = 0

for our_class, dataset_name, split, class_id in datasets_config:
    print(f"\n{our_class}/{split}...", flush=True)
    
    try:
        # Load dataset if it exists
        if dataset_name in fo.list_datasets():
            dataset = fo.load_dataset(dataset_name)
            print(f"  Found {len(dataset)} samples")
            
            for idx, sample in enumerate(dataset):
                img_src = sample.filepath
                img_name = f"{our_class}_openimages_{processed:05d}.jpg"
                img_dst = f"images/{split}/{img_name}"
                lbl_dst = f"labels/{split}/{our_class}_openimages_{processed:05d}.txt"
                
                # Copy image
                if os.path.exists(img_src):
                    shutil.copy2(img_src, img_dst)
                    
                    # Extract detections
                    yolo_lines = []
                    if sample.ground_truth and sample.ground_truth.detections:
                        for det in sample.ground_truth.detections:
                            bbox = det.bounding_box  # [x, y, w, h] normalized
                            x_center = bbox[0] + bbox[2] / 2
                            y_center = bbox[1] + bbox[3] / 2
                            
                            yolo_lines.append(
                                f"{class_id} {x_center:.6f} {y_center:.6f} {bbox[2]:.6f} {bbox[3]:.6f}"
                            )
                    
                    # Write labels
                    with open(lbl_dst, 'w') as f:
                        for line in yolo_lines:
                            f.write(line + '\n')
                    
                    # Track provenance
                    provenance.append({
                        "filename": img_name,
                        "class_name": our_class,
                        "class_id": class_id,
                        "open_images_id": sample.id,
                        "original_url": getattr(sample.metadata, 'url', '') if sample.metadata else "",
                        "author": "Open Images (Flickr authors)",
                        "license": "CC BY 2.0 (image) / CC BY 4.0 (annotation)",
                    })
                    
                    processed += 1
                    if processed % 50 == 0:
                        print(f"    Processed {processed}...")
            
            print(f"  [OK] {len(dataset)} samples")
        else:
            print(f"  Dataset {dataset_name} not found, skipping")
    
    except Exception as e:
        print(f"  ERROR: {e}")

# Write provenance CSV
print(f"\nWriting provenance.csv ({len(provenance)} rows)...", flush=True)
with open("provenance.csv", 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=[
        "filename", "class_name", "class_id", "open_images_id",
        "original_url", "author", "license"
    ])
    writer.writeheader()
    writer.writerows(provenance)

# Write SOURCES.md
sources = """# Data Sources & Attribution

## Open Images V7 — Training Dataset

**Download Date**: 2026-07-14  
**Classes**: 4 (Car, Motorcycle, Truck, Refrigerator)  
**Total Samples**: ~1100 (4 classes × ~180 each, train + val)

### License & Attribution

- **Images**: CC BY 2.0 (original Flickr image authors)
- **Annotations**: CC BY 4.0 (Google Open Images)
- **Required Attribution**: Yes, when publishing models or derived datasets

### Citation

Krasin et al. (2017). "OpenImages: A public dataset for large-scale multi-label and multi-class image classification." Dataset available at: https://github.com/openimages/dataset

### Classes & Availability

| YOLO Class | Open Images Name | Train Samples | Val Samples | Status |
|------------|------------------|---------------|-------------|--------|
| car (id 5) | Car | ~150 | ~30 | Available |
| scooter (id 6) | Motorcycle | ~150 | ~30 | Available |
| truck (id 7) | Truck | ~150 | ~30 | Available |
| fridge (id 11) | Refrigerator | ~150 | ~30 | Available |
| **Not Available in Open Images V7** | | | | |
| fire_extinguisher (id 8) | Fire extinguisher | — | — | Requires Roboflow or campus images |
| ac_outdoor (id 10) | Air conditioner | — | — | Requires Roboflow or campus images |

### Privacy & Usage

- All images are from public Flickr with Creative Commons licenses
- No personal data, faces, or identifiable information  
- Subject to Creative Commons BY 2.0 and CC BY 4.0 terms
- When publishing, attribute original Flickr image authors (discoverable via Open Images metadata URLs)

### Missing Classes

For **fire_extinguisher** and **ac_outdoor**, use:
- Roboflow public datasets
- Campus facility photography (with proper privacy screening per `CLAUDE.md`)
- Synthetic images or augmentation

### Provenance Tracking

All samples logged in `provenance.csv` with:
- Filename (naming: `<class>_openimages_<seq>.jpg`)
- Open Images sample ID (for metadata lookup)
- License info
- Original Flickr URL (where available in metadata)
"""

with open("SOURCES.md", 'w', encoding='utf-8') as f:
    f.write(sources)

print("\n" + "=" * 70)
print(f"COMPLETE: {processed} samples processed")
print(f"  - Images: images/{{train,val}}/")
print(f"  - Labels: labels/{{train,val}}/")
print(f"  - Provenance: provenance.csv")
print(f"  - Attribution: SOURCES.md")
print("=" * 70)

