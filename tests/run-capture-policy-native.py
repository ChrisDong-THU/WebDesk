"""Compile isolated capture tests with the prepared GN toolchain and objects.

Does not regenerate GN, modify BUILD files, or build/link libwebrtc.dll.
Run after the normal desktop capture regression dependencies were built once.
"""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENGINE = ROOT / ".tools/webrtc-build/src"
OUT = ENGINE / "out-webdesk"
DEST = ROOT / ".tools/capture-policy-native-tests"
DEST.mkdir(exist_ok=True)
NINJA = (OUT / "obj/webdesk-tests/desktop_capture_regression.ninja").read_text()
RULES = (OUT / "toolchain.ninja").read_text()
variables = {}
for line in NINJA.splitlines():
    match = re.match(r"^\s*(defines|include_dirs|cflags|cflags_cc|libs|ldflags) = (.*)$", line)
    if match:
        variables[match[1]] = match[2].replace("$:", ":").replace("$$", "$")
cxx = re.search(r"rule cxx\n  command = (.+)", RULES)[1]
system = cxx.split(" /nologo", 1)[1].split(" ${defines}", 1)[0].replace("/showIncludes:user", "")
sources = [ROOT / "tests/desktop-capture-policy-regression.cc",
           ENGINE / "libwebrtc/src/rtc_desktop_capturer_impl.cc",
           ENGINE / "libwebrtc/src/rtc_video_frame_impl.cc",
           ENGINE / "libwebrtc/src/rtc_desktop_media_list_impl.cc",
           ENGINE / "libwebrtc/src/internal/jpeg_util.cc",
           ENGINE / "libwebrtc/src/internal/video_capturer.cc",
           ENGINE / "libwebrtc/src/base/portable.cc"]
objects = []
for source in sources:
    obj = DEST / (source.stem + ".obj")
    rsp = DEST / (source.stem + ".rsp")
    args = f'/c "{source}" /Fo"{obj}" /nologo {system} -DMANGLE_JPEG_NAMES -I../third_party/libjpeg_turbo/src ' + " ".join(
        variables[key] for key in ["defines", "include_dirs", "cflags", "cflags_cc"])
    rsp.write_text(args, encoding="utf8")
    result = subprocess.run([str(ENGINE / "third_party/llvm-build/Release+Asserts/bin/clang-cl.exe"),
                             "@" + str(rsp)], cwd=OUT, capture_output=True, text=True)
    print(source.name, result.returncode, flush=True)
    print(result.stdout + result.stderr, end="", flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
    objects.append(str(obj))
line = next(line for line in NINJA.splitlines() if line.startswith("build ./desktop_capture_regression.exe "))
inputs = line.split(": link ", 1)[1].split(" |", 1)[0].split()
replaced = {"desktop-capture-regression.obj", "rtc_desktop_capturer_impl.obj",
            "rtc_video_frame_impl.obj", "video_capturer.obj", "portable.obj"}
inputs = [path for path in inputs if path.rsplit("/", 1)[-1] not in replaced]
missing = [path for path in inputs if not (OUT / path).exists()]
if missing:
    raise RuntimeError(f"Build desktop_capture_regression dependencies first: {missing[:5]}")
link = re.search(r"rule link\n  command = (.+)", RULES)[1]
prefix = link[link.index("/nologo"):link.index(" /MACHINE:X64") + len(" /MACHINE:X64")]
rsp = DEST / "link.rsp"
exe = DEST / "capture-policy-tests.exe"
rsp.write_text(" ".join('"' + path + '"' for path in objects + inputs) + " " +
               variables["libs"] + " " + variables["ldflags"] +
               f' /OUT:"{exe}" /PDB:"{DEST}/capture-policy-tests.pdb"', encoding="utf8")
result = subprocess.run(str(ENGINE / "third_party/llvm-build/Release+Asserts/bin/lld-link.exe") +
                        " " + prefix + ' "@' + str(rsp) + '"', cwd=OUT, capture_output=True, text=True)
print("link", result.returncode, result.stdout + result.stderr, flush=True)
if result.returncode:
    raise SystemExit(result.returncode)
result = subprocess.run([str(exe)], capture_output=True, text=True)
print(result.stdout + result.stderr, end="", flush=True)
raise SystemExit(result.returncode)
