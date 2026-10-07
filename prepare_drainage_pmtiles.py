import os
import sys
import time
import urllib.parse
import subprocess
import pyogrio

def fix_url(u):
    if not u or not isinstance(u, str):
        return ""
    # Fix old directory structure
    u = u.replace('/dbase/fichiers/', '/api/fichiers/')
    prefix = 'https://www.info-sols.ca/api/fichiers/'
    if u.startswith(prefix):
        rel_path = u[len(prefix):]
        parts = rel_path.split('/')
        # Safely unquote first (in case partially encoded), then quote each segment
        encoded_parts = [urllib.parse.quote(urllib.parse.unquote(p)) for p in parts]
        return prefix + '/'.join(encoded_parts)
    return u

def main():
    src_fgb = r'C:\Users\cedbo\Downloads\drainage_plans_drainage.fgb'
    out_dir = os.path.dirname(os.path.abspath(__file__))
    fixed_fgb = os.path.join(out_dir, 'data', 'drainage_plans_corrected.fgb')
    out_pmtiles_local = os.path.join(out_dir, 'plans_drainage.pmtiles')
    out_pmtiles_downloads = r'C:\Users\cedbo\Downloads\plans_drainage.pmtiles'
    
    os.makedirs(os.path.join(out_dir, 'data'), exist_ok=True)
    
    print(f"1. Lecture de {src_fgb}...")
    t0 = time.time()
    gdf = pyogrio.read_dataframe(src_fgb)
    print(f"   {len(gdf)} entités chargées en {time.time()-t0:.2f}s")
    
    print("2. Correction des URLs brisées (/dbase/ -> /api/ + encodage)...")
    old_sample = gdf['url'].iloc[0]
    gdf['url'] = gdf['url'].apply(fix_url)
    new_sample = gdf['url'].iloc[0]
    print(f"   Exemple avant : {old_sample}")
    print(f"   Exemple après : {new_sample}")
    
    # Vérification
    broken_dbase = gdf['url'].str.contains('/dbase/fichiers/', na=False).sum()
    spaces = gdf['url'].str.contains(' ', na=False).sum()
    print(f"   Restant avec /dbase/: {broken_dbase}, Restant avec espaces: {spaces}")
    
    print(f"3. Écriture du fichier FlatGeobuf corrigé temporaire : {fixed_fgb}...")
    t1 = time.time()
    pyogrio.write_dataframe(gdf, fixed_fgb, layer='plans_drainage', driver='FlatGeobuf')
    print(f"   Écrit en {time.time()-t1:.2f}s ({os.path.getsize(fixed_fgb)/(1024*1024):.1f} MB)")
    
    print(f"4. Génération du PMTiles : {out_pmtiles_local}...")
    t2 = time.time()
    cmd = [
        'ogr2ogr',
        '-f', 'PMTiles',
        out_pmtiles_local,
        fixed_fgb,
        '-dsco', 'MINZOOM=8',
        '-dsco', 'MAXZOOM=14',
        '-lco', 'NAME=plans_drainage'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("Erreur ogr2ogr:", res.stderr)
        sys.exit(1)
        
    size_mb = os.path.getsize(out_pmtiles_local) / (1024 * 1024)
    print(f"   PMTiles généré avec succès en {time.time()-t2:.2f}s ({size_mb:.2f} MB)")
    
    # Copie dans Downloads pour faciliter l'envoi de l'utilisateur
    import shutil
    shutil.copy2(out_pmtiles_local, out_pmtiles_downloads)
    print(f"5. Copié dans {out_pmtiles_downloads}")
    
    # Nettoyage fichier fgb temporaire si désiré ou conservation
    print("Terminé avec succès !")

if __name__ == '__main__':
    main()
