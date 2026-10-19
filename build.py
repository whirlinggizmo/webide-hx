#!/usr/bin/env python3
"""
Builds web/haxe.js: the Haxe compiler as JavaScript, for a page or node.

    python3 build.py                         Haxe from robknopf/haxe's 4.3-js_of_ocaml branch
    python3 build.py --haxe-src ~/src/haxe   a local checkout of that branch instead (copied)
    python3 build.py --embed DIR:/lib/name   embed more files in the bundle's filesystem
    python3 build.py --hotreload ~/projects/github/whirlinggizmo/hotreload-hx
                                             embed hotreload-hx at /lib/hotreload (the page's
                                             parity test needs it)
    python3 build.py --embed-std             the standard library inside the bundle (7.8 MB)
                                             instead of fetched on demand from web/std
    python3 build.py --toolchain             only the toolchain below (the Dockerfile's
                                             first step, cached apart from the source)

Self-contained: opam, OCaml 4.14, Haxe's OCaml dependencies and js_of_ocaml are
installed under build/ the first time (about ten minutes). From the system it needs
git, cmake, make, a C compiler, libpcre2-dev and zlib1g-dev (and bubblewrap, or opam's
sandboxing is turned off), and node with npm for the IDE's editor.
"""
import argparse, filecmp, glob, gzip, json, os, re, shutil, subprocess, sys, tarfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
# Haxe 4.3.7 with what a browser build needs, as commits on a branch of Rob's fork: the
# server's linear skip reasons (haxe#13058, in Haxe 5), eval's case tables as array
# literals (haxe#13067, in Haxe 5), the server's resident mode, and a bytecode build
HAXE_URL = "https://github.com/robknopf/haxe.git"
HAXE_REF = "4.3-js_of_ocaml"
MBEDTLS_URL = "https://github.com/Mbed-TLS/mbedtls/archive/refs/tags/v2.28.9.tar.gz"
OPAM_VERSION = "2.3.0"
OCAML = "ocaml-base-compiler.4.14.2"
SWITCH = "haxe"
# Haxe 4.3's haxe.opam, minus conf-neko (tests only); dune 3.24 builds it despite the < 3.16 there
HAXE_DEPS = ["camlp5.8.03.04", "ocamlfind.1.9.1", "dune", "sedlex", "xml-light", "extlib", "ptmap", "sha", "camlp-streams",
             "conf-libpcre2-8", "conf-zlib", "luv.0.5.13"]
JSOO = ["js_of_ocaml-compiler", "js_of_ocaml"]


def run(cmd, cwd=None, env=None, quiet=False):
    print("  $", " ".join(cmd) if len(" ".join(cmd)) < 160 else cmd[0] + " ...")
    r = subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE if quiet else None, stderr=subprocess.STDOUT if quiet else None, text=True)
    if r.returncode != 0:
        if quiet:
            print(r.stdout[-4000:])
        sys.exit(f"failed: {cmd[0]}")
    return r


def toolchain():
    """build/opam: an opam root of our own with OCaml and the libraries in it; the
    environment to build with. The PATH is only the system's and our own bin: a
    directory named `install` on the user's PATH (~/.bun has one) breaks `make install`"""
    bindir = os.path.join(BUILD, "bin")
    root = os.path.join(BUILD, "opam")
    opam = os.path.join(bindir, "opam")
    env = dict(os.environ, OPAMROOT=root, OPAMYES="1", OPAMNOAUTOUPGRADE="1",
               PATH=os.pathsep.join([bindir, "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]))
    if not os.path.exists(opam):
        os.makedirs(bindir, exist_ok=True)
        arch = {"x86_64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}[os.uname().machine]
        url = f"https://github.com/ocaml/opam/releases/download/{OPAM_VERSION}/opam-{OPAM_VERSION}-{arch}-linux"
        print(f"  downloading {url}")
        urllib.request.urlretrieve(url, opam)
        os.chmod(opam, 0o755)
    if not os.path.exists(os.path.join(root, "config")):
        sandbox = [] if shutil.which("bwrap") else ["--disable-sandboxing"]
        run(["opam", "init", "--bare", "-n"] + sandbox, env=env, quiet=True)
    switch_bin = os.path.join(root, SWITCH, "bin")
    if not os.path.exists(os.path.join(switch_bin, "ocaml")):
        print("  compiling OCaml (a few minutes)")
        run(["opam", "switch", "create", SWITCH, OCAML], env=env, quiet=True)
    out = subprocess.run(["opam", "env", f"--switch={SWITCH}", "--set-switch", "--shell=sh"], env=env, capture_output=True, text=True, check=True).stdout
    for k, v in re.findall(r"^(\w+)='([^']*)'; export", out, re.M):
        env[k] = v
    if not os.path.exists(os.path.join(switch_bin, "camlp5o")):
        print("  installing Haxe's OCaml dependencies (a few minutes)")
        run(["opam", "install"] + HAXE_DEPS, env=env, quiet=True)
    if not os.path.exists(os.path.join(switch_bin, "js_of_ocaml")):
        run(["opam", "install"] + JSOO, env=env, quiet=True)
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
    """build/haxe: the compiler's source, HAXE_REF of HAXE_URL (kept up to date with it), or
    a copy of --haxe-src"""
    dst = os.path.join(BUILD, "haxe")
    marker = os.path.join(dst, ".source")
    want = args.haxe_src or f"{HAXE_URL}#{HAXE_REF}"
    if not os.path.exists(marker) or open(marker).read() != want:
        shutil.rmtree(dst, ignore_errors=True)
    if args.haxe_src:
        # every build, since the checkout is being worked on: its tracked files as they are
        # now (edits included, build output not), copying only what changed, so dune
        # rebuilds only that
        src = os.path.expanduser(args.haxe_src)
        names = subprocess.run(["git", "-C", src, "ls-files", "--recurse-submodules"], capture_output=True, text=True, check=True).stdout.splitlines()
        copied = 0
        for name in names:
            a, b = os.path.join(src, name), os.path.join(dst, name)
            if not os.path.isfile(a) or (os.path.exists(b) and filecmp.cmp(a, b, shallow=False)):
                continue
            os.makedirs(os.path.dirname(b), exist_ok=True)
            if os.path.exists(b):
                os.chmod(b, 0o644)
            shutil.copy2(a, b)
            copied += 1
        print(f"  {copied} files from {src}")
    elif not os.path.exists(dst):
        run(["git", "clone", "-q", "--depth", "1", "--branch", HAXE_REF, "--recurse-submodules", "--shallow-submodules", HAXE_URL, dst])
    else:
        # the branch moved on: fetch it; dune rebuilds what changed
        run(["git", "-C", dst, "fetch", "-q", "--depth", "1", "origin", HAXE_REF], quiet=True)
        run(["git", "-C", dst, "checkout", "-q", "FETCH_HEAD"], quiet=True)
    open(marker, "w").write(want)
    return dst


def commit_of(src):
    r = subprocess.run(["git", "-C", src, "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else "local"


def haxe_bytecode(src, env, prefix):
    """_build/default/src/haxe.bc: the compiler as OCaml bytecode"""
    env = dict(env, CPATH=os.path.join(prefix, "include"), LIBRARY_PATH=os.path.join(prefix, "lib"))
    bc = os.path.join(src, "_build", "default", "src", "haxe.bc")
    run(["dune", "build", "--workspace", "dune-workspace.dev", "src-prebuild/prebuild.exe"], cwd=src, env=env, quiet=True)
    prebuild = os.path.join(src, "_build", "default", "src-prebuild", "prebuild.exe")
    libparams = ["-cclib", "-lpcre2-8", "-cclib", "-lz", "-cclib", "-lmbedtls", "-cclib", "-lmbedx509", "-cclib", "-lmbedcrypto"]
    open(os.path.join(src, "lib.sexp"), "w").write(subprocess.run([prebuild, "libparams"] + libparams, capture_output=True, text=True, check=True).stdout)
    open(os.path.join(src, "src", "compiler", "version.ml"), "w").write(
        subprocess.run([prebuild, "version", "", HAXE_REF, commit_of(src)], capture_output=True, text=True, check=True).stdout)
    run(["dune", "build", "--workspace", "dune-workspace.dev", "src/haxe.bc"], cwd=src, env=env, quiet=True)
    return bc


STD_DIRS = ["haxe", "js", "sys", "eval"]  # the standard library's JS-relevant part, plus its root classes


def std_files(std):
    """the standard library's files for a JS build, relative to std/"""
    out = [os.path.basename(f) for f in sorted(glob.glob(os.path.join(std, "*.hx")))]
    for d in STD_DIRS:
        for root, _, names in os.walk(os.path.join(std, d)):
            for n in sorted(names):
                if n.endswith(".hx"):
                    out.append(os.path.relpath(os.path.join(root, n), std))
    return sorted(out)


def std_on_demand(src):
    """web/std/: the standard library's files next to the page, and manifest.json listing
    them, for the bundle to fetch one by one as the compiler opens them; and web/std.json.gz,
    all of them in one download, which the IDE's worker takes instead (one request rather
    than hundreds, each a round trip over the internet). In it, each file's bytes as a
    latin1 string, which is what the bundle reads files as"""
    std = os.path.join(src, "std")
    dst = os.path.join(HERE, "web", "std")
    shutil.rmtree(dst, ignore_errors=True)
    names = std_files(std)
    for n in names:
        os.makedirs(os.path.dirname(os.path.join(dst, n)), exist_ok=True)
        shutil.copy2(os.path.join(std, n), os.path.join(dst, n))
    with open(os.path.join(dst, "manifest.json"), "w") as f:
        json.dump(names, f)
    print(f"  web/std: {len(names)} files")
    every = {n: open(os.path.join(std, n), "rb").read().decode("latin1") for n in names}
    packed = os.path.join(HERE, "web", "std.json.gz")
    with gzip.GzipFile(packed, "wb", mtime=0) as f:  # no timestamp: the same files, the same bytes
        f.write(json.dumps(every, separators=(",", ":"), sort_keys=True).encode("ascii"))
    print(f"  web/std.json.gz: {os.path.getsize(packed) / 1e6:.1f} MB")


def bundle(src, bc, env, embeds, embed_std):
    """web/haxe.js: js_of_ocaml over the bytecode, with stubs.js for the C libraries. The
    standard library is fetched on demand from web/std (see stubs.js), or embedded in the
    pseudo filesystem at /haxe/std with --embed-std"""
    std = os.path.join(src, "std")
    files = []
    if embed_std:
        for n in std_files(std):
            files.append(f"--file={os.path.join(std, n)}:/haxe/std/{n}")
    else:
        std_on_demand(src)
    for e in embeds:
        s, _, d = e.partition(":")
        files.append(f"--file={os.path.abspath(os.path.expanduser(s))}:{d}")
    out = os.path.join(HERE, "web", "haxe.js")
    run(["js_of_ocaml", os.path.join(HERE, "stubs.js")] + files + [bc, "-o", out], env=env, quiet=True)
    # the remaining missing primitives are the dummies we mean to leave out (ssl, sockets, zlib...)
    print(f"  {out}: {os.path.getsize(out) / 1e6:.1f} MB")


def editor():
    """web/vendor/: the IDE's libraries, from editor/ (pinned in its package-lock.json),
    bundled with esbuild: codemirror.js (the editor) and fs.js (ZenFS and fflate, for the
    project's files). Needs node and npm on the PATH"""
    d = os.path.join(HERE, "editor")
    npm = shutil.which("npm")
    if npm is None:
        sys.exit("npm not found: the IDE's editor is built with it (node 18 or later)")
    if not os.path.exists(os.path.join(d, "node_modules", ".package-lock.json")):
        run([npm, "ci", "--no-audit", "--no-fund"], cwd=d, quiet=True)
    esbuild = os.path.join(d, "node_modules", ".bin", "esbuild")
    for entry, name in (("entry.js", "codemirror.js"), ("fs.js", "fs.js")):
        out = os.path.join(HERE, "web", "vendor", name)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        run([esbuild, entry, "--bundle", "--format=esm", "--minify", "--log-level=warning", "--outfile=" + out], cwd=d)
        print(f"  {out}: {os.path.getsize(out) / 1e3:.0f} KB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--haxe-src", help="a local Haxe checkout (of the 4.3-js_of_ocaml branch) to copy instead of cloning it")
    ap.add_argument("--embed", action="append", default=[], metavar="SRC:DEST", help="a file or directory to embed in the bundle's filesystem")
    ap.add_argument("--hotreload", metavar="DIR", help="embed hotreload-hx from DIR at /lib/hotreload")
    ap.add_argument("--embed-std", action="store_true", help="embed the standard library in the bundle instead of serving it from web/std")
    ap.add_argument("--toolchain", action="store_true", help="only install the toolchain (opam, OCaml, Haxe's libraries, js_of_ocaml, mbedtls) under build/")
    args = ap.parse_args()
    if args.toolchain:
        os.makedirs(BUILD, exist_ok=True)
        print("toolchain"); env = toolchain()
        print("mbedtls"); mbedtls(env)
        return
    if args.hotreload:
        d = os.path.expanduser(args.hotreload)
        args.embed += [f"{d}/src:/lib/hotreload/src", f"{d}/extraParams.hxml:/lib/hotreload/extraParams.hxml"]
        # its hello example, for the IDE (web/index.html) to edit and run
        hello = os.path.join(HERE, "web", "hello")
        shutil.rmtree(hello, ignore_errors=True)
        for sub in ["src", "assets"]:
            shutil.copytree(os.path.join(d, "examples", "hello", sub), os.path.join(hello, sub))
        # and its build files: the page builds from web-build.hxml, the one that targets JS
        for f in glob.glob(os.path.join(d, "examples", "hello", "*.hxml")):
            shutil.copy(f, hello)
        listing = sorted(os.path.relpath(os.path.join(r, f), hello).replace(os.sep, "/")
                         for r, _, fs in os.walk(hello) for f in fs)
        with open(os.path.join(hello, "files.json"), "w") as f:
            json.dump(listing, f)
    os.makedirs(BUILD, exist_ok=True)
    print("toolchain"); env = toolchain()
    print("mbedtls"); prefix = mbedtls(env)
    print("haxe source"); src = haxe_source(args)
    print("haxe bytecode"); bc = haxe_bytecode(src, env, prefix)
    print("bundle"); bundle(src, bc, env, args.embed, args.embed_std)
    print("editor"); editor()
    print("done: python3 tools/serve.py, then http://127.0.0.1:8765/")


if __name__ == "__main__":
    main()
