
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))


from main import app


with open('scratch/celery_test_results.txt', 'w') as f:
    f.write("Celery Test Results:\n")
    try:
        import celery
        f.write(f"Celery imported successfully: {celery.__version__}\n")
    except ImportError as e:
        f.write(f"Failed to import celery: {e}\n")
    except Exception as e:
        f.write(f"Error testing celery: {e}\n")



print("Registered Routes:")
for route in app.routes:
    if hasattr(route, 'methods') and hasattr(route, 'path'):
        print(f"{route.methods} {route.path}")
    elif hasattr(route, 'path'):
        print(f"MOUNT {route.path}")
    else:
        print(f"OTHER {type(route)}")
