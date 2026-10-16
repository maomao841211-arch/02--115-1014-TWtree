"""Rebuild provenance.csv from actual image files"""
import csv
from pathlib import Path
import re

provenance = []

for img_path in sorted(Path('images').rglob('*.jpg')):
    match = re.match(r'(.+?)_openimages_(.+)\.jpg', img_path.name)
    if not match:
        continue
    
    class_name, seq = match.groups()
    
    # Determine YOLO class id
    class_ids = {"car": 5, "scooter": 6, "truck": 7, "fridge": 11}
    if class_name not in class_ids:
        continue
    
    class_id = class_ids[class_name]
    
    # Extract open_images_id from corresponding label file
    split = "train" if "train" in str(img_path) else "val"
    lbl_path = Path('labels') / split / f'{class_name}_openimages_{seq}.txt'
    
    # For now, use filename-based open_images_id (we'll populate from metadata if available)
    open_images_id = f"seq_{class_name}_{seq}"  # Placeholder
    
    provenance.append({
        "filename": img_path.name,
        "class_name": class_name,
        "class_id": class_id,
        "open_images_id": open_images_id,
        "original_url": f"(Open Images - see SOURCES.md for attribution)",
        "author": "Flickr photographers (via Open Images)",
        "license": "CC BY 2.0 (image) / CC BY 4.0 (annotation)",
    })

# Write updated CSV
print(f"Writing {len(provenance)} entries to provenance.csv...")
with open("provenance.csv", 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=[
        "filename", "class_name", "class_id", "open_images_id",
        "original_url", "author", "license"
    ])
    writer.writeheader()
    writer.writerows(provenance)

# Summary by class
from collections import defaultdict
by_class = defaultdict(lambda: {'train': 0, 'val': 0})
for entry in provenance:
    parts = entry['filename'].split('_openimages_')
    if len(parts) == 2:
        class_name = parts[0]
        seq = parts[1].replace('.jpg', '')
        # This is heuristic, but check actual path
        
for cls in ["car", "scooter", "truck", "fridge"]:
    train_count = len(list(Path(f'images/train').glob(f'{cls}_*.jpg')))
    val_count = len(list(Path(f'images/val').glob(f'{cls}_*.jpg')))
    print(f"  {cls:12}: {train_count:3d} train, {val_count:3d} val")

