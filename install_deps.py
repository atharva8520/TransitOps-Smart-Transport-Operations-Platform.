import os
import urllib.request
import tarfile
import subprocess

def download_and_extract_npm():
    url = "https://registry.npmjs.org/npm/-/npm-10.8.2.tgz"
    tar_path = "npm.tgz"
    extract_dir = "npm_temp"
    
    print(f"Downloading npm from {url}...", flush=True)
    urllib.request.urlretrieve(url, tar_path)
    print("Download complete. Extracting...", flush=True)
    
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(path=extract_dir)
    print(f"Extraction complete to {extract_dir}.", flush=True)
    
    # Cleanup tar file
    os.remove(tar_path)

def run_npm_install():
    cursor_helper_dir = r"C:\Users\YOGESH\AppData\Local\Programs\cursor\resources\app\resources\helpers"
    node_path = os.path.join(cursor_helper_dir, "node.exe")
    npm_cli_path = os.path.abspath(r"npm_temp\package\bin\npm-cli.js")
    
    # Update PATH environment variable so postinstall scripts can find 'node'
    env = os.environ.copy()
    env["PATH"] = cursor_helper_dir + os.pathsep + env.get("PATH", "")
    
    print(f"Running npm install using {node_path} and {npm_cli_path}...", flush=True)
    cmd = [node_path, npm_cli_path, "install"]
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    
    print("STDOUT:", flush=True)
    print(result.stdout, flush=True)
    print("STDERR:", flush=True)
    print(result.stderr, flush=True)
    
    if result.returncode == 0:
        print("npm install completed successfully!", flush=True)
    else:
        print(f"npm install failed with code {result.returncode}", flush=True)

if __name__ == "__main__":
    if not os.path.exists("npm_temp"):
        download_and_extract_npm()
    run_npm_install()
