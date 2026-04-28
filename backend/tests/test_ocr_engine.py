import sys
sys.path.append('c:/Users/USER/ocr/ocr/backend')
try:
    from utils.ocr_engine import get_ocr_engine
    engine = get_ocr_engine()
    print('SUCCESS')
except Exception as e:
    import traceback
    traceback.print_exc()
