import os
import sys
import json
from datetime import datetime

# 프로젝트 루트 및 backend 경로 추가
sys.path.append(os.getcwd())
sys.path.append(os.path.join(os.getcwd(), 'backend'))

try:
    from backend.database import SessionLocal, Job, DocumentMetadataValue
    db = SessionLocal()
    
    # 1. 문서 찾기
    job = db.query(Job).filter(Job.original_filename.like('%포천시청%')).first()
    if not job:
        print("Error: Target job not found.")
        sys.exit(1)
        
    print(f"Target Job Found: {job.job_id} ({job.original_filename})")
    
    # 2. JSON 데이터 수정
    fields = []
    if job.extracted_fields:
        fields = json.loads(job.extracted_fields)
    
    found = False
    for f in fields:
        if f.get('entity_type_ko') == '날짜' or f.get('key') == 'date' or f.get('entity_type') == 'DATE':
            print(f"Updating date from {f.get('value')} to 2024-08-14")
            f['value'] = '2024-08-14'
            found = True
            
    if not found:
        print("Adding new date field...")
        fields.append({
            "key": "date",
            "value": "2024-08-14",
            "entity_type": "DATE",
            "entity_type_ko": "날짜"
        })
        
    job.extracted_fields = json.dumps(fields, ensure_ascii=False)
    
    # 3. 신규 테이블 동기화
    db.query(DocumentMetadataValue).filter_by(job_id=job.job_id).delete()
    for f in fields:
        db.add(DocumentMetadataValue(
            job_id=job.job_id,
            field_key=f.get('key') or f.get('entity_type') or "",
            label=f.get('entity_type_ko') or f.get('key') or "",
            field_value=f.get('value')
        ))
        
    db.commit()
    print("Database Fix Applied Successfully.")
    
except Exception as e:
    print(f"Unexpected Error: {e}")
    db.rollback()
finally:
    db.close()
