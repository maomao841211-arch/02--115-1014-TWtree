# -*- coding: utf-8 -*-
"""
對校園實拍影像進行人臉偵測與打碼（高斯模糊）。

隱私保護：校園照片常含學生/教職員人臉，須在標註前先模糊。
原始檔案不動，輸出新資料夾。

使用範例：
    python blur_faces.py --in dataset/raw/campus_photos/ --out dataset/raw/campus_photos_blurred/
    python blur_faces.py --in photo.jpg --out photo_blurred.jpg
    python blur_faces.py --in photo.jpg --out photo_blurred.jpg --kernel 51 --scale-cascade 1.1
"""

import argparse
import os
import sys
import cv2
from pathlib import Path


# Haar Cascade 路徑（OpenCV 內建，若需 DNN 可另下載）
HAARCASCADE_PATH = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'


def detect_and_blur_faces(image_path, output_path, cascade_path, kernel_size=31, scale_factor=1.1):
    """
    讀入影像 → 人臉偵測 → 高斯模糊 → 輸出

    Args:
        image_path: 輸入影像路徑
        output_path: 輸出影像路徑
        cascade_path: Haar Cascade 分類器路徑
        kernel_size: 模糊核心大小（必須奇數，默認 31）
        scale_factor: 級聯分類器縮放因子（默認 1.1）

    Returns:
        (blur_count, total_faces): 模糊人臉數、偵測總數
    """

    try:
        img = cv2.imread(str(image_path))
        if img is None:
            print(f"    [SKIP] Cannot read {image_path}")
            return 0, 0
    except Exception as e:
        print(f"    [ERROR] {image_path}: {e}")
        return 0, 0

    # 載入分類器
    try:
        face_cascade = cv2.CascadeClassifier(cascade_path)
        if face_cascade.empty():
            print(f"    [ERROR] Cannot load cascade: {cascade_path}")
            return 0, 0
    except Exception as e:
        print(f"    [ERROR] {e}")
        return 0, 0

    # 轉灰度進行偵測
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 人臉偵測
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=scale_factor,
        minNeighbors=5,
        minSize=(30, 30),
    )

    # 高斯模糊每個偵測到的人臉
    blur_count = 0
    for (x, y, w, h) in faces:
        roi = img[y:y+h, x:x+w]
        blurred_roi = cv2.GaussianBlur(roi, (kernel_size, kernel_size), 0)
        img[y:y+h, x:x+w] = blurred_roi
        blur_count += 1

    # 寫出
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), img)
    except Exception as e:
        print(f"    [ERROR] {output_path}: {e}")
        return blur_count, len(faces)

    return blur_count, len(faces)


def check_output_safety(input_path, output_path):
    """
    M2 修正:防止 --out 等於或落在 --in 之內,避免就地覆蓋原始(可能含臉)檔案,
    違反隱私紅線「原始檔案不動,輸出新資料夾」。用 resolve() 後的絕對路徑比較,
    避開相對路徑/符號連結造成誤判。

    Returns:
        (ok, error_message)
    """
    input_resolved = Path(input_path).resolve()
    output_resolved = Path(output_path).resolve()

    if output_resolved == input_resolved:
        return False, f"--out 不可與 --in 相同(會就地覆蓋原始檔):{output_resolved}"

    if input_resolved.is_dir():
        try:
            output_resolved.relative_to(input_resolved)
            return False, (
                f"--out 不可落在 --in 目錄內(會與原始檔混在一起、有覆蓋風險):"
                f"in={input_resolved}, out={output_resolved}"
            )
        except ValueError:
            pass  # output 不在 input 目錄內,安全

    return True, None


def process_directory(input_dir, output_dir, cascade_path, kernel_size=31, scale_factor=1.1):
    """
    處理目錄內所有影像檔。
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)

    if not input_path.is_dir():
        print(f"[ERROR] Not a directory: {input_dir}")
        return False

    # 支援的影像格式
    image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff'}

    image_files = [
        f for f in input_path.iterdir()
        if f.is_file() and f.suffix.lower() in image_extensions
    ]

    if not image_files:
        print(f"[ERROR] No image files found in {input_dir}")
        return False

    print(f"Processing {len(image_files)} images from {input_dir}...")

    total_blur = 0
    total_faces = 0

    for i, img_file in enumerate(image_files, 1):
        out_file = output_path / img_file.name
        blur_cnt, face_cnt = detect_and_blur_faces(
            img_file, out_file, cascade_path, kernel_size, scale_factor
        )

        if face_cnt > 0:
            print(f"  [{i:3d}/{len(image_files)}] {img_file.name}: {blur_cnt} faces blurred")
        else:
            print(f"  [{i:3d}/{len(image_files)}] {img_file.name}: no faces")

        total_blur += blur_cnt
        total_faces += face_cnt

    print(f"\n[OK] Processing complete")
    print(f"  Total faces detected: {total_faces}")
    print(f"  Total faces blurred: {total_blur}")
    print(f"  Output directory: {output_path}")

    return True


def process_single_image(input_file, output_file, cascade_path, kernel_size=31, scale_factor=1.1):
    """
    處理單一影像檔。
    """
    input_path = Path(input_file)
    output_path = Path(output_file)

    if not input_path.is_file():
        print(f"[ERROR] Input file not found: {input_file}")
        return False

    print(f"Processing {input_file}...")

    blur_cnt, face_cnt = detect_and_blur_faces(
        input_path, output_path, cascade_path, kernel_size, scale_factor
    )

    print(f"  Faces detected: {face_cnt}")
    print(f"  Faces blurred: {blur_cnt}")
    print(f"  Output: {output_path}")

    # M3 修正:detect_and_blur_faces() 在「成功處理但沒偵測到人臉(最理想情況)」與
    # 「讀圖/載入分類器/寫檔失敗」兩種情況都回傳 (0, 0),blur_cnt/face_cnt 無法區分
    # 成功與失敗。改成直接檢查輸出檔是否真的被寫出來:寫成功才算成功,有沒有人臉
    # 只是資訊、不代表處理失敗。
    return output_path.exists()


def main():
    parser = argparse.ArgumentParser(
        description="Detect and blur faces in images for privacy protection"
    )
    parser.add_argument(
        '--in',
        dest='input_path',
        required=True,
        help='Input image or directory',
    )
    parser.add_argument(
        '--out',
        dest='output_path',
        required=True,
        help='Output image or directory',
    )
    parser.add_argument(
        '--kernel',
        type=int,
        default=31,
        help='Gaussian blur kernel size (must be odd, default: 31)',
    )
    parser.add_argument(
        '--scale-cascade',
        type=float,
        default=1.1,
        help='Cascade classifier scale factor (default: 1.1)',
    )
    parser.add_argument(
        '--cascade',
        default=HAARCASCADE_PATH,
        help='Path to Haar Cascade XML (default: OpenCV built-in)',
    )

    args = parser.parse_args()

    # 驗證 kernel 為奇數
    if args.kernel % 2 == 0:
        print(f"[ERROR] Kernel size must be odd, got {args.kernel}")
        return 1

    # 檢查輸入
    input_p = Path(args.input_path)
    if not input_p.exists():
        print(f"[ERROR] Input path not found: {args.input_path}")
        return 1

    # M2:防止 --out 等於或落在 --in 之內,避免就地覆蓋原始(可能含臉)檔案
    output_safe, output_safe_err = check_output_safety(input_p, Path(args.output_path))
    if not output_safe:
        print(f"[ERROR] {output_safe_err}")
        return 1

    # 檢查 cascade 檔案
    if not Path(args.cascade).exists():
        print(f"[ERROR] Cascade file not found: {args.cascade}")
        print(f"  OpenCV built-in path: {HAARCASCADE_PATH}")
        return 1

    # 處理目錄或單一檔案
    if input_p.is_dir():
        success = process_directory(
            args.input_path,
            args.output_path,
            args.cascade,
            args.kernel,
            args.scale_cascade,
        )
    else:
        success = process_single_image(
            args.input_path,
            args.output_path,
            args.cascade,
            args.kernel,
            args.scale_cascade,
        )

    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
