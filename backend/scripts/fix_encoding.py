import os

file_path = r'c:\Users\USER\ocr\ocr\frontend\src\app\ocr-work\page.tsx'
with open(file_path, 'r', encoding='utf-16' if os.path.getsize(file_path) > 1000 and open(file_path, 'rb').read(2) == b'\xff\xfe' else 'utf-8') as f:
    content = f.read()

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
