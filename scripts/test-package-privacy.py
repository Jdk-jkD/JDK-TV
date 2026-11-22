import json,subprocess,sys,tempfile,unittest,zipfile
from pathlib import Path
from urllib.parse import quote

class PortablePrivacyTest(unittest.TestCase):
 def test_generated_build_paths_and_private_files_are_excluded(self):
  root=Path(__file__).resolve().parents[1]
  with tempfile.TemporaryDirectory(prefix="private-build-") as tmp:
   base=Path(tmp);build=base/"private-source";node=base/"node";out=base/"out"
   app=build/".next/standalone";app.mkdir(parents=True)
   version=json.loads((root/"package.json").read_text(encoding="utf-8-sig"))["version"]
   (app/"package.json").write_text(json.dumps({"version":version}))
   (app/"server.js").write_text("const config="+json.dumps({"root":str(build),"module":str(build/"src/page.tsx"),"loader":quote(str(build),safe="")})+";",encoding="utf8")
   (app/".env.local").write_text("PASSWORD=must-not-be-in-archive")
   (app/"debug.log").write_text("private-log")
   (build/".next/static").mkdir()
   node.mkdir();(node/"node.exe").write_bytes(b"fixture-only");(node/"LICENSE").write_text("fixture")
   subprocess.run([sys.executable,str(root/"scripts/package-portable.py"),"--node-dir",str(node),"--output",str(out),"--build-dir",str(build)],check=True,capture_output=True)
   with zipfile.ZipFile(next(out.glob("*-windows-x64.zip"))) as z:
    server=z.read(next(n for n in z.namelist() if n.endswith("/app/server.js")))
    self.assertNotIn(str(build).encode(),server)
    self.assertNotIn(json.dumps(str(build))[1:-1].encode(),server)
    self.assertNotIn(quote(str(build),safe="").encode(),server)
    self.assertIn(b'"root": "."',server)
    self.assertFalse(any(Path(n).name in {".env.local","debug.log"} for n in z.namelist()))

if __name__=="__main__":unittest.main()
