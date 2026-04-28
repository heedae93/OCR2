import requests
import sys

job_id = "5f9845da-c70b-4cb4-bf0a-5184c0683dff"
url = f"http://127.0.0.1:6015/api/process/{job_id}"

print(f"Triggering job {job_id} via {url}...")
try:
    response = requests.post(url)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
except Exception as e:
    print(f"Error: {e}")
