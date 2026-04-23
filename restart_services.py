import os
import subprocess
import time
import yaml
import sys

def kill_by_port(port):
    try:
        # Get PID using netstat
        cmd = f'netstat -ano | findstr LISTENING | findstr :{port}'
        output = subprocess.check_output(cmd, shell=True).decode()
        pids = set()
        for line in output.strip().split('\n'):
            parts = line.split()
            if parts:
                pids.add(parts[-1])
        for pid in pids:
            if pid == '0' or pid == str(os.getpid()):
                continue
            print(f"Stopping process {pid} on port {port}")
            subprocess.run(f"taskkill /F /PID {pid}", shell=True)
    except Exception:
        pass

def start_backend(python_exe):
    print("Starting backend...")
    env = os.environ.copy()
    env["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    
    # Ensure logs dir exists
    if not os.path.exists("logs"):
        os.makedirs("logs")
        
    log_path = os.path.abspath("logs/backend.log")
    with open(log_path, "a") as log:
        # Start uvicorn
        # We use creationflags to detach it
        subprocess.Popen(
            [python_exe, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "6015"],
            cwd="backend",
            env=env,
            stdout=log,
            stderr=log,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )

def start_worker(python_exe):
    print("Starting worker...")
    env = os.environ.copy()
    env["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    
    log_path = os.path.abspath("logs/worker.log")
    with open(log_path, "a") as log:
        subprocess.Popen(
            [python_exe, "-m", "celery", "-A", "ocr_worker", "worker", "-Q", "ocr", "--loglevel=info", "--pool=solo"],
            cwd="backend",
            env=env,
            stdout=log,
            stderr=log,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )

if __name__ == "__main__":
    python_exe = sys.executable
    print(f"Using python: {python_exe}")
    
    # Stop existing backend
    kill_by_port(6015)
    
    # Kill celery workers and any other python processes from this app
    print("Killing existing python processes (backend/worker)...")
    try:
        # Kill python processes by image name. 
        # Note: This might kill other python apps, but it's the most reliable way on Windows without more complex PID tracking.
        subprocess.run('taskkill /F /IM python.exe /T', shell=True, capture_output=True)
    except Exception:
        pass
    
    time.sleep(2)

    
    # Start
    start_backend(python_exe)
    start_worker(python_exe)
    print("Backend and Worker restart initiated.")
