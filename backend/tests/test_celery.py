from celery_app import celery_app
import time

@celery_app.task(name='test.ping')
def ping():
    return "pong"

if __name__ == "__main__":
    print("Sending ping task...")
    result = celery_app.send_task('test.ping')
    print(f"Task sent: {result.id}")
    
    # Wait for result (optional, but good for testing)
    # result.get(timeout=10)
