// The wasm compiler's filesystem (haxe-wasm.js, from wasm_of_ocaml): what node's `fs` gives
// its runtime, synchronous, in memory, for a worker. The runtime does every file operation
// through these methods (openSync, readSync, statSync, readdirSync...), so the compiler
// sees a filesystem like the bundle's (stubs.js): the project under /static, the standard
// library under /haxe/std, read the first time a file is opened, and what the build
// writes. Errors are thrown as node's are (`code` ENOENT...), which the runtime turns into
// Sys_error and Unix_error.
//
//   hxfs.create({ files: {path: latin1 text}, std: { manifest: [paths], read: path => latin1 text | null },
//                 cwd: () => the working directory, which a relative path is from })
//
// gives the fs, with the page's operations on it too: write(path, text) and remove(path)
// (each with a new modification time, and its folder's), read(path) (latin1 text), and
// mtime(path) (seconds, for the compiler's sys_filetime).
var hxfs = (function () {
  // node's constants on Linux: the runtime maps OCaml's open flags through these
  var constants = {
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOCTTY: 256, O_TRUNC: 512, O_APPEND: 1024,
    O_NONBLOCK: 2048, O_DSYNC: 4096, O_SYNC: 1052672, F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
  };
  function fail(code, errno, syscall, path) {
    var messages = { ENOENT: "no such file or directory", EEXIST: "file already exists", ENOTDIR: "not a directory",
                     EISDIR: "illegal operation on a directory", ENOTEMPTY: "directory not empty", EBADF: "bad file descriptor",
                     EINVAL: "invalid argument", ENOSYS: "function not implemented" };
    var e = new Error(code + ": " + messages[code] + ", " + syscall + (path !== undefined ? " '" + path + "'" : ""));
    e.code = code; e.errno = errno; e.syscall = syscall;
    if (path !== undefined) e.path = path;
    throw e;
  }
  function normalPath(p) {
    var out = [];
    String(p).split("/").forEach(function (s) {
      if (s === "" || s === ".") return;
      if (s === "..") out.pop(); else out.push(s);
    });
    return "/" + out.join("/");
  }
  var parentOf = function (p) { var i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); };
  var latin1 = function (bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  };
  var bytesOf = function (text) {
    var b = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
    return b;
  };

  function create(opts) {
    var std = opts.std || null, STD = "/haxe/std";
    var cwd = opts.cwd || function () { return "/"; };
    var normal = function (p) { p = String(p); return normalPath(p.charAt(0) === "/" ? p : cwd() + "/" + p); };
    // path -> { data: Uint8Array, size, mtime } for a file, { dir: true, mtime } for a folder
    var nodes = new Map([["/", { dir: true, mtime: 1 }]]);
    // a modification time that only goes up, one step per change: two saves in the same
    // second differ, which is how the compilation server notices an edit
    var clock = 1;
    var tick = function () { return (clock = Math.max(clock + 1, Math.floor(Date.now() / 1000))); };
    function addDirs(p, t) {
      for (var d = parentOf(p); !nodes.has(d); d = parentOf(d)) nodes.set(d, { dir: true, mtime: t });
    }
    function putFile(p, data, t) {
      var isNew = !nodes.has(p);
      addDirs(p, t);
      nodes.set(p, { data: data, size: data.length, mtime: t });
      if (isNew) nodes.get(parentOf(p)).mtime = t;
    }
    // the standard library: its folders from the manifest, a file read when it's first wanted
    var stdFiles = new Set();
    if (std) {
      std.manifest.forEach(function (rel) {
        var p = STD + "/" + rel;
        stdFiles.add(p);
        addDirs(p, 1);
      });
    }
    function node(p) {
      var n = nodes.get(p);
      if (n) return n;
      if (stdFiles.has(p)) {
        var text = std.read(p.slice(STD.length + 1));
        stdFiles.delete(p);
        if (text === null) return null;
        n = { data: bytesOf(text), size: text.length, mtime: 1 };
        nodes.set(p, n);
        return n;
      }
      return null;
    }
    // without reading a library file: a stat of one not read yet
    function peek(p) {
      var n = nodes.get(p);
      if (n) return n;
      if (stdFiles.has(p)) return node(p);
      return null;
    }
    Object.keys(opts.files || {}).forEach(function (k) { putFile(normal(k), bytesOf(opts.files[k]), 1); });

    function stats(n) {
      return {
        dev: 1, ino: 0, mode: n.dir ? 0o40755 : 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0,
        size: n.dir ? 0 : n.size, atimeMs: n.mtime * 1000, mtimeMs: n.mtime * 1000, ctimeMs: n.mtime * 1000,
        isFile: function () { return !n.dir; }, isDirectory: function () { return !!n.dir; },
        isCharacterDevice: function () { return false; }, isBlockDevice: function () { return false; },
        isSymbolicLink: function () { return false; }, isFIFO: function () { return false; }, isSocket: function () { return false; },
      };
    }
    function lookup(p, syscall) {
      var n = peek(normal(p));
      if (!n) fail("ENOENT", -2, syscall, p);
      return n;
    }
    function list(p) {
      var dir = normal(p), prefix = dir === "/" ? "/" : dir + "/", seen = new Set();
      var take = function (k) {
        if (!k.startsWith(prefix) || k === dir) return;
        var rest = k.slice(prefix.length), cut = rest.indexOf("/");
        seen.add(cut < 0 ? rest : rest.slice(0, cut));
      };
      nodes.forEach(function (v, k) { take(k); });
      stdFiles.forEach(take);
      seen.delete("");
      return Array.from(seen);
    }

    // open files: fd -> { path, node, pos, append, write }
    var fds = new Map(), nextFd = 3;
    // what the compiler prints to stdout or stderr itself (its replies come back as a
    // request's result, not through here)
    var out = { 1: "", 2: "" };
    function grow(n, size) {
      if (n.data.length >= size) return;
      var b = new Uint8Array(Math.max(size, n.data.length * 2, 256));
      b.set(n.data.subarray(0, n.size));
      n.data = b;
    }
    function fdOf(fd, syscall) {
      var f = fds.get(fd);
      if (!f) fail("EBADF", -9, syscall);
      return f;
    }
    function remove(path) {
      var p = normal(path);
      if (!nodes.has(p)) return false;
      nodes.delete(p);
      stdFiles.delete(p);
      var d = nodes.get(parentOf(p));
      if (d) d.mtime = tick();
      return true;
    }

    var fs = {
      constants: constants,
      // the page's operations
      write: function (path, text) { putFile(normal(path), bytesOf(text), tick()); },
      remove: function (path) { remove(path); },
      read: function (path) { var n = node(normal(path)); if (!n || n.dir) fail("ENOENT", -2, "open", path); return latin1(n.data.subarray(0, n.size)); },
      mtime: function (path) { var n = peek(normal(path)); return n ? n.mtime : 1; },
      takeOutput: function () { var o = { stdout: out[1], stderr: out[2] }; out[1] = out[2] = ""; return o; },
      // node's
      existsSync: function (p) { return !!peek(normal(p)); },
      accessSync: function (p) { lookup(p, "access"); },
      statSync: function (p, o) {
        var n = peek(normal(p));
        if (!n) { if (o && o.throwIfNoEntry === false) return undefined; fail("ENOENT", -2, "stat", p); }
        return stats(n);
      },
      lstatSync: function (p, o) { return fs.statSync(p, o); },
      fstatSync: function (fd, o) {
        var s = stats(fdOf(fd, "fstat").node);
        if (o && o.bigint) s.size = BigInt(s.size);
        return s;
      },
      openSync: function (path, flags, mode) {
        var p = normal(path), n = node(p), acc = flags & 3;
        if (n && n.dir && acc !== 0) fail("EISDIR", -21, "open", path);
        if (n && (flags & constants.O_CREAT) && (flags & constants.O_EXCL)) fail("EEXIST", -17, "open", path);
        if (!n) {
          if (!(flags & constants.O_CREAT)) fail("ENOENT", -2, "open", path);
          var d = peek(parentOf(p));
          if (!d) fail("ENOENT", -2, "open", path);
          if (!d.dir) fail("ENOTDIR", -20, "open", path);
          putFile(p, new Uint8Array(0), tick());
          n = nodes.get(p);
        } else if ((flags & constants.O_TRUNC) && acc !== 0) {
          n.size = 0; n.mtime = tick();
        }
        var fd = nextFd++;
        fds.set(fd, { path: p, node: n, pos: 0, append: !!(flags & constants.O_APPEND), write: acc !== 0 });
        return fd;
      },
      closeSync: function (fd) { if (fd > 2) { fdOf(fd, "close"); fds.delete(fd); } },
      readSync: function (fd, buf, off, len, pos) {
        var f = fdOf(fd, "read"), n = f.node;
        if (n.dir) fail("EISDIR", -21, "read");
        var at = pos === null || pos === undefined ? f.pos : Number(pos);
        var k = Math.max(0, Math.min(len, n.size - at));
        if (k > 0) buf.set(n.data.subarray(at, at + k), off);
        if (pos === null || pos === undefined) f.pos = at + k;
        return k;
      },
      writeSync: function (fd, buf, off, len, pos) {
        if (fd === 1 || fd === 2) {
          out[fd] += typeof buf === "string" ? buf : latin1(buf.subarray(off || 0, (off || 0) + (len === undefined ? buf.length : len)));
          return len === undefined ? buf.length : len;
        }
        var f = fdOf(fd, "write"), n = f.node;
        if (typeof buf === "string") { buf = bytesOf(buf); off = 0; len = buf.length; }
        var at = f.append ? n.size : pos === null || pos === undefined ? f.pos : Number(pos);
        grow(n, at + len);
        n.data.set(buf.subarray(off, off + len), at);
        n.size = Math.max(n.size, at + len);
        n.mtime = tick();
        if (pos === null || pos === undefined || f.append) f.pos = at + len;
        return len;
      },
      fsyncSync: function (fd) { fdOf(fd, "fsync"); },
      ftruncateSync: function (fd, l) { var n = fdOf(fd, "ftruncate").node; grow(n, l || 0); n.size = l || 0; n.mtime = tick(); },
      truncateSync: function (p, l) { var n = lookup(p, "truncate"); grow(n, l || 0); n.size = l || 0; n.mtime = tick(); },
      readdirSync: function (p) {
        var n = lookup(p, "scandir");
        if (!n.dir) fail("ENOTDIR", -20, "scandir", p);
        return list(p);
      },
      opendirSync: function (p) {
        var names = fs.readdirSync(p);
        return { readSync: function () { return names.length ? { name: names.shift() } : null; }, closeSync: function () {} };
      },
      mkdirSync: function (p) {
        var q = normal(p);
        if (peek(q)) fail("EEXIST", -17, "mkdir", p);
        var d = peek(parentOf(q));
        if (!d) fail("ENOENT", -2, "mkdir", p);
        var t = tick();
        nodes.set(q, { dir: true, mtime: t });
        d.mtime = t;
      },
      rmdirSync: function (p) {
        var n = lookup(p, "rmdir");
        if (!n.dir) fail("ENOTDIR", -20, "rmdir", p);
        if (list(p).length) fail("ENOTEMPTY", -39, "rmdir", p);
        remove(p);
      },
      unlinkSync: function (p) {
        var n = lookup(p, "unlink");
        if (n.dir) fail("EISDIR", -21, "unlink", p);
        remove(p);
      },
      renameSync: function (from, to) {
        var a = normal(from), b = normal(to), n = lookup(from, "rename");
        if (n.dir) {
          var moved = [];
          nodes.forEach(function (v, k) { if (k === a || k.startsWith(a + "/")) moved.push([k, v]); });
          moved.forEach(function (e) { nodes.delete(e[0]); });
          moved.forEach(function (e) { nodes.set(b + e[0].slice(a.length), e[1]); });
        } else {
          nodes.delete(a);
          addDirs(b, n.mtime);
          nodes.set(b, n);
        }
        var t = tick();
        nodes.get(parentOf(a)).mtime = t;
        nodes.get(parentOf(b)).mtime = t;
      },
      utimesSync: function (p, a, m) { lookup(p, "utime").mtime = Number(m); },
      chmodSync: function (p) { lookup(p, "chmod"); },
      fchmodSync: function (fd) { fdOf(fd, "fchmod"); },
      readlinkSync: function (p) { lookup(p, "readlink"); fail("EINVAL", -22, "readlink", p); },
      linkSync: function (a) { fail("ENOSYS", -38, "link", a); },
      symlinkSync: function (a) { fail("ENOSYS", -38, "symlink", a); },
    };
    return fs;
  }
  return { create: create, normal: normalPath };
})();
