with open('build_carte.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, l in enumerate(lines):
    if 'map.on("click", "parcelles-fill"' in l or "map.on('click', 'parcelles-fill'" in l:
        print(f"Line {i+1}:")
        for j in range(max(0, i-5), min(len(lines), i+45)):
            print(f"  {j+1}: {lines[j].rstrip()}")
        break
