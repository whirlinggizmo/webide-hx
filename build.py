#!/usr/bin/env python3
"""
Builds web/haxe.js: the Haxe compiler as JavaScript, for a page or node.

    python3 build.py                         Haxe 4.3.7 from GitHub, std embedded
    python3 build.py --haxe-src ~/src/haxe   a local checkout instead (copied, then patched)
    python3 build.py --embed DIR:/lib/name   embed more files in the bundle's filesystem
    python3 build.py --hotreload ~/projects/github/whirlinggizmo/hotreload-hx
                                             embed hotreload-hx at /lib/hotreload (the page's
                                             parity test needs it)

Needs the opam switch described in the README (OCaml 4.14, Haxe's dependencies,
js_of_ocaml), cmake and a C compiler. Everything else is fetched into build/.
"""
import argparse, glob, os, re, shutil, subprocess, sys, tarfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
HAXE_TAG = "4.3.7"
HAXE_URL = "https://github.com/HaxeFoundation/haxe.git"
MBEDTLS_URL = "https://github.com/Mbed-TLS/mbedtls/archive/refs/tags/v2.28.9.tar.gz"


def run(cmd, cwd=None, env=None, quiet=False):
    print("  $", " ".join(cmd) if len(" ".join(cmd)) < 160 else cmd[0] + " ...")
    r = subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE if quiet else None, stderr=subprocess.STDOUT if quiet else None, text=True)
    if r.returncode != 0:
        if quiet:
            print(r.stdout[-4000:])
        sys.exit(f"failed: {cmd[0]}")
    return r


def opam_env(switch):
    """the switch's environment, as `opam env` prints it"""
    out = subprocess.run(["opam", "env", f"--switch={switch}", "--set-switch", "--shell=sh"], capture_output=True, text=True, check=True).stdout
    env = dict(os.environ)
    for k, v in re.findall(r"^(\w+)='([^']*)'; export", out, re.M):
        env[k] = v
    return env


def mbedtls(env):
    """mbedtls 2.28 headers and static libraries, built here (Haxe's ssl binding needs them to compile)"""
    prefix = os.path.join(BUILD, "mbedtls-install")
    if os.path.exists(os.path.join(prefix, "lib", "libmbedtls.a")):
        return prefix
    dl = os.path.join(BUILD, "mbedtls-dl")
    os.makedirs(dl, exist_ok=True)
    tgz = os.path.join(dl, "mbedtls.tar.gz")
    if not os.path.exists(tgz):
        print("downloading mbedtls")
        urllib.request.urlretrieve(MBEDTLS_URL, tgz)
    with tarfile.open(tgz) as t:
        t.extractall(dl)
    src = glob.glob(os.path.join(dl, "mbedtls-*", "CMakeLists.txt"))[0]
    src = os.path.dirname(src)
    run(["cmake", "-S", src, "-B", os.path.join(src, "build"), "-DCMAKE_BUILD_TYPE=Release", "-DENABLE_TESTING=OFF", "-DENABLE_PROGRAMS=OFF",
         "-DCMAKE_POSITION_INDEPENDENT_CODE=ON", f"-DCMAKE_INSTALL_PREFIX={prefix}"], quiet=True)
    run(["cmake", "--build", os.path.join(src, "build"), "-j", str(os.cpu_count() or 4)], quiet=True)
    run(["cmake", "--install", os.path.join(src, "build")], quiet=True)
    return prefix


def haxe_source(args):
    """build/haxe: the compiler's source at HAXE_TAG (or a copy of --haxe-src), patched"""
    dst = os.path.join(BUILD, "haxe")
    if os.path.exists(os.path.join(dst, ".patched")):
        return dst
    shutil.rmtree(dst, ignore_errors=True)
    if args.haxe_src:
        print(f"copying {args.haxe_src}")
        shutil.copytree(args.haxe_src, dst, ignore=shutil.ignore_patterns("_build", ".git"), symlinks=True)
    else:
        run(["git", "clone", "-q", "--depth", "1", "--branch", HAXE_TAG, HAXE_URL, dst])
    for p in sorted(glob.glob(os.path.join(HERE, "patches", "*.patch"))):
        if os.path.isdir(os.path.join(dst, ".git")):
            run(["git", "-C", dst, "apply", p], quiet=True)
        else:
            run(["patch", "-p1", "-d", dst, "-i", p], quiet=True)
    open(os.path.join(dst, ".patched"), "w").write(HAXE_TAG)
    return dst


def haxe_bytecode(src, env, prefix):
    """_build/default/src/haxe.bc: the compiler as OCaml bytecode"""
    env = dict(env, CPATH=os.path.join(prefix, "include"), LIBRARY_PATH=os.path.join(prefix, "lib"))
    bc = os.path.join(src, "_build", "default", "src", "haxe.bc")
    run(["dune", "build", "--workspace", "dune-workspace.dev", "src-prebuild/prebuild.exe"], cwd=src, env=env, quiet=True)
    prebuild = os.path.join(src, "_build", "default", "src-prebuild", "prebuild.exe")
    libparams = ["-cclib", "-lpcre2-8", "-cclib", "-lz", "-cclib", "-lmbedtls", "-cclib", "-lmbedx509", "-cclib", "-lmbedcrypto"]
    open(os.path.join(src, "lib.sexp"), "w").write(subprocess.run([prebuild, "libparams"] + libparams, capture_output=True, text=True, check=True).stdout)
    open(os.path.join(src, "src", "compiler", "version.ml"), "w").write(
        subprocess.run([prebuild, "version", "", HAXE_TAG, "js_of_ocaml"], capture_output=True, text=True, check=True).stdout)
    run(["dune", "build", "--workspace", "dune-workspace.dev", "src/haxe.bc"], cwd=src, env=env, quiet=True)
    return bc


def bundle(src, bc, env, embeds):
    """web/haxe.js: js_of_ocaml over the bytecode, with stubs.js for the C libraries and the
    JS-relevant standard library in the pseudo filesystem at /haxe/std"""
    std = os.path.join(src, "std")
    files = []
    for f in sorted(glob.glob(os.path.join(std, "*.hx"))):
        files.append(f"--file={f}:/haxe/std/{os.path.basename(f)}")
    for d in ["haxe", "js", "sys", "eval"]:
        files.append(f"--file={os.path.join(std, d)}:/haxe/std/{d}")
    for e in embeds:
        s, _, d = e.partition(":")
        files.append(f"--file={os.path.abspath(os.path.expanduser(s))}:{d}")
    out = os.path.join(HERE, "web", "haxe.js")
    run(["js_of_ocaml", os.path.join(HERE, "stubs.js")] + files + [bc, "-o", out], env=env, quiet=True)
    # the remaining missing primitives are the dummies we mean to leave out (ssl, sockets, zlib...)
    print(f"  {out}: {os.path.getsize(out) / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--switch", default="wasm", help="the opam switch (default: wasm)")
    ap.add_argument("--haxe-src", help="a local Haxe checkout to copy instead of cloning the tag")
    ap.add_argument("--embed", action="append", default=[], metavar="SRC:DEST", help="a file or directory to embed in the bundle's filesystem")
    ap.add_argument("--hotreload", metavar="DIR", help="embed hotreload-hx from DIR at /lib/hotreload")
    args = ap.parse_args()
    if args.hotreload:
        d = os.path.expanduser(args.hotreload)
        args.embed += [f"{d}/src:/lib/hotreload/src", f"{d}/extraParams.hxml:/lib/hotreload/extraParams.hxml"]
    os.makedirs(BUILD, exist_ok=True)
    env = opam_env(args.switch)
    print("mbedtls"); prefix = mbedtls(env)
    print("haxe source"); src = haxe_source(args)
    print("haxe bytecode"); bc = haxe_bytecode(src, env, prefix)
    print("bundle"); bundle(src, bc, env, args.embed)
    print("done: python3 web/serve.py 8765 web/report.json, then http://127.0.0.1:8765/")


if __name__ == "__main__":
    main()
