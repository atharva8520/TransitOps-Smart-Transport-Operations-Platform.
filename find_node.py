import os
import sys

def find_file(filename, search_paths):
    found = []
    for root_path in search_paths:
        if not os.path.exists(root_path):
            continue
        print(f"Scanning {root_path}...", flush=True)
        for root, dirs, files in os.walk(root_path):
            # Avoid traversing very deep and irrelevant directories
            if any(p in root.lower() for p in ['appdata\\local\\temp', 'windows\\winsxs', 'git\\usr\\share']):
                dirs.clear() # don't recurse
                continue
            if filename in files:
                filepath = os.path.join(root, filename)
                print(f"Found: {filepath}", flush=True)
                found.append(filepath)
    return found

if __name__ == '__main__':
    search_dirs = [
        r"C:\Program Files",
        r"C:\Program Files (x86)",
        r"C:\ProgramData",
        r"C:\Users\YOGESH"
    ]
    print("Searching for node.exe...", flush=True)
    find_file("node.exe", search_dirs)
    print("\nSearching for npm.cmd...", flush=True)
    find_file("npm.cmd", search_dirs)
    print("Search complete.", flush=True)
