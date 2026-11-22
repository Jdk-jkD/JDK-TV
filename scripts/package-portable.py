import argparse,hashlib,json,shutil,zipfile
from pathlib import Path
from urllib.parse import quote

def remove_build_paths(app_root, build_root):
 """Remove build-machine directory prefixes from generated text metadata."""
 variants={str(build_root.resolve()), build_root.resolve().as_posix()}
 for _ in range(4):
  variants.update(v.replace("\\", "\\\\") for v in tuple(variants))
 variants.update(quote(v,safe="") for v in tuple(variants))
 prefixes=sorted((v.encode("utf8") for v in variants), key=len, reverse=True)
 changed=0
 for p in app_root.rglob("*"):
  if not p.is_file() or p.suffix.lower() not in {".js",".cjs",".mjs",".json",".map",".html",".txt"}:
   continue
  original=p.read_bytes();clean=original
  for prefix in prefixes:
   clean=clean.replace(prefix,b".")
  if clean!=original:
   p.write_bytes(clean);changed+=1
 return changed

ap=argparse.ArgumentParser(description="Build JDK TV portable ZIP from a verified standalone build")
ap.add_argument("--node-dir",type=Path,required=True)
ap.add_argument("--output",type=Path,required=True)
ap.add_argument("--build-dir",type=Path)
args=ap.parse_args()
root=Path(__file__).resolve().parents[1]
build=args.build_dir.resolve() if args.build_dir else root
version=json.loads((root/"package.json").read_text(encoding="utf-8-sig"))["version"]
app=build/".next/standalone"
assert (app/"server.js").is_file(),"Run DOCKER_BUILD=1 npm run build first"
assert json.loads((app/"package.json").read_text(encoding="utf-8-sig"))["version"]==version
assert (args.node_dir/"node.exe").is_file() and (args.node_dir/"LICENSE").is_file()
output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
name=f"JDK-TV-{version}-windows-x64"
dest=output/name
assert not dest.exists(),"Output folder already exists"
shutil.copytree(app,dest/"app",ignore=shutil.ignore_patterns(".env",".env.*","*.log"))
shutil.copytree(build/".next/static",dest/"app/.next/static")
shutil.copytree(root/"public",dest/"app/public",dirs_exist_ok=True)
print("Removed build-machine paths from",remove_build_paths(dest/"app",build),"generated files")
shutil.copytree(root/"desktop",dest,dirs_exist_ok=True)
(dest/"runtime").mkdir()
shutil.copy2(args.node_dir/"node.exe",dest/"runtime/node.exe")
shutil.copy2(args.node_dir/"LICENSE",dest/"runtime/LICENSE")
for n in ("LICENSE","NOTICE.md","README.md","CHANGELOG.md"):
 shutil.copy2(root/n,dest/n)
(dest/"SOURCE.txt").write_text("Corresponding source: https://github.com/Jdk-jkD/JDK-TV\nRelease source ZIP accompanies this binary.\nUpstream: https://github.com/LibreSpark/LibreTV (AGPL-3.0-or-later)\n",encoding="utf8")
licenses=dest/"THIRD-PARTY-LICENSES";licenses.mkdir()
for p in (dest/"app/node_modules").rglob("*"):
 if p.is_file() and (p.name.lower().startswith(("license","licence","copying","notice")) or p.name=="package.json"):
  relative=p.relative_to(dest/"app/node_modules")
  target=licenses/relative;target.parent.mkdir(parents=True,exist_ok=True)
  shutil.copy2(p,target)
excluded={".git","node_modules",".next","dist","releases","runtime","config","logs","temp","browser-profile"}
def source_files():
 for p in root.rglob("*"):
  if not p.is_file():continue
  rel=p.relative_to(root)
  if any(part in excluded for part in rel.parts) or p.name.endswith((".log",".tsbuildinfo")):continue
  if p.name.startswith(".env") and p.name!=".env.example":continue
  yield p,rel
source=output/f"JDK-TV-{version}-source.zip"
with zipfile.ZipFile(source,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p,rel in source_files():z.write(p,Path("JDK-TV")/rel)
portable=output/(name+".zip")
with zipfile.ZipFile(portable,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in dest.rglob("*"):
  if p.is_file():z.write(p,Path(name)/p.relative_to(dest))
forbidden={"browser-profile","config","logs","temp"}
with zipfile.ZipFile(portable) as z:
 assert not any((len(Path(n).parts) > 1 and Path(n).parts[1] in forbidden) or Path(n).name.startswith(".env") for n in z.namelist())
checksum=output/"SHA256SUMS.txt"
checksum.write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest()+"  "+p.name+"\n" for p in [portable,source]),encoding="ascii")
print(json.dumps({"portable":str(portable),"source":str(source),"checksums":str(checksum)},ensure_ascii=False))
