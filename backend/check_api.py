
import requests
import json

try:
    r = requests.get('http://127.0.0.1:6015/api/metadata-v3/categories?user_id=user001', timeout=5)
    print(f"Status: {r.status_code}")
    print(f"Data: {json.dumps(r.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")
