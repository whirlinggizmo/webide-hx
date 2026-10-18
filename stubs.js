// JS implementations of the C primitives the Haxe compiler reaches on a plain JS build.
// threads: the compiler runs single-threaded here; locks are no-ops
//Provides: caml_thread_initialize
function caml_thread_initialize(unit) { return 0; }
//Provides: caml_thread_cleanup
function caml_thread_cleanup(unit) { return 0; }
//Provides: caml_thread_self
function caml_thread_self(unit) { return 0; }
//Provides: caml_thread_id
function caml_thread_id(t) { return 0; }
//Provides: caml_thread_yield
function caml_thread_yield(unit) { return 0; }
//Provides: caml_thread_exit
function caml_thread_exit(unit) { return 0; }
//Provides: caml_thread_uncaught_exception
function caml_thread_uncaught_exception(e) { return 0; }
//Provides: caml_thread_new
function caml_thread_new(clos) { throw new Error("threads aren't available in the browser build"); }
//Provides: caml_thread_join
function caml_thread_join(t) { return 0; }
//Provides: caml_mutex_new
function caml_mutex_new(unit) { return 0; }
//Provides: caml_mutex_lock
function caml_mutex_lock(m) { return 0; }
//Provides: caml_mutex_try_lock
function caml_mutex_try_lock(m) { return 1; }
//Provides: caml_mutex_unlock
function caml_mutex_unlock(m) { return 0; }
//Provides: caml_condition_new
function caml_condition_new(unit) { return 0; }
//Provides: caml_condition_wait
function caml_condition_wait(c, m) { return 0; }
//Provides: caml_condition_signal
function caml_condition_signal(c) { return 0; }
//Provides: caml_condition_broadcast
function caml_condition_broadcast(c) { return 0; }

// pcre2: the module's initialisation reads the library's configuration
//Provides: pcre2_ocaml_init
function pcre2_ocaml_init(unit) { return 0; }
//Provides: pcre2_version_stub
//Requires: caml_string_of_jsstring
function pcre2_version_stub(unit) { return caml_string_of_jsstring("10.42 (js)"); }
//Provides: pcre2_config_unicode_stub
function pcre2_config_unicode_stub(unit) { return 1; }
//Provides: pcre2_config_newline_stub
function pcre2_config_newline_stub(unit) { return 10; }
//Provides: pcre2_config_link_size_stub_bc
function pcre2_config_link_size_stub_bc(unit) { return 2; }
//Provides: pcre2_config_match_limit_stub_bc
function pcre2_config_match_limit_stub_bc(unit) { return 10000000; }
//Provides: pcre2_config_depth_limit_stub_bc
function pcre2_config_depth_limit_stub_bc(unit) { return 10000000; }
//Provides: pcre2_config_stackrecurse_stub
function pcre2_config_stackrecurse_stub(unit) { return 0; }
//Provides: pcre2_set_imp_match_limit_stub_bc
function pcre2_set_imp_match_limit_stub_bc(a, b) { return a; }
//Provides: pcre2_set_imp_depth_limit_stub_bc
function pcre2_set_imp_depth_limit_stub_bc(a, b) { return a; }

// extc: paths and time. Pure JS: a page has no path or fs module
//Provides: hx_resolve_path
function hx_resolve_path(p) {
  var cwd = (globalThis.process && globalThis.process.cwd) ? globalThis.process.cwd() : "/";
  var abs = p.charAt(0) === "/" ? p : cwd.replace(/\/+$/, "") + "/" + p;
  var out = [];
  abs.split("/").forEach(function (seg) {
    if (seg === "" || seg === ".") return;
    if (seg === "..") { out.pop(); return; }
    out.push(seg);
  });
  return "/" + out.join("/");
}
// a page reads the compiler's output back out of the pseudo filesystem through this
// set up once per runtime: each run of the bundle is a new one, with its own copy of this
//Provides: hx_exposed
var hx_exposed = { done: false, clock: 1 };
//Provides: hx_expose
//Requires: hx_exposed, caml_read_file_content, caml_jsbytes_of_string, hx_std_device
//Requires: caml_string_of_jsbytes, caml_string_of_jsstring, caml_named_value, caml_callback
//Requires: resolve_fs_device, caml_create_file, hx_mtimes, hx_fake_stat
function hx_expose() {
  if (hx_exposed.done) return;
  hx_exposed.done = true;
  globalThis.hx_read_file = function (name) { return caml_jsbytes_of_string(caml_read_file_content(name)); };
  // a file written (or replaced) in the in-memory filesystem, with a new modification
  // time, so a resident compiler sees it changed. `text` is a string of bytes (latin1)
  globalThis.hx_write_file = function (name, text) {
    var root = resolve_fs_device(caml_string_of_jsstring(name));
    var dev = root.device, rest = root.rest;
    var isNew = !(dev.content && dev.content[rest]);
    if (!isNew) delete dev.content[rest];
    caml_create_file(caml_string_of_jsstring(name), caml_string_of_jsbytes(text));
    // a time that only goes up, one step per write: two saves in the same second differ
    var t = hx_exposed.clock = Math.max(hx_exposed.clock + 1, Math.floor(Date.now() / 1000));
    hx_mtimes[name] = t;
    // a new file changes its directory, which is how the server notices it
    if (isNew) hx_mtimes[name.replace(/\/[^\/]*$/, "")] = t;
  };
  // one request to a resident compiler (started with --wait stdio and HAXE_RESIDENT=1):
  // the hxml, and what a connection would be sent back (\x01 before stdout lines, a
  // \x02 line when the build failed, messages otherwise)
  globalThis.hx_request = function (hxml) {
    var f = caml_named_value("haxe_resident_request");
    if (!f) throw new Error("no resident compiler: start it with --wait stdio and HAXE_RESIDENT=1");
    return caml_jsbytes_of_string(caml_callback(f, [caml_string_of_jsbytes(hxml)]));
  };
}
//Provides: get_full_path
//Requires: caml_string_of_jsstring, caml_jsstring_of_string, hx_resolve_path, hx_expose
function get_full_path(p) { hx_expose(); return caml_string_of_jsstring(hx_resolve_path(caml_jsstring_of_string(p))); }
//Provides: get_real_path
//Requires: caml_string_of_jsstring, caml_jsstring_of_string, hx_resolve_path
function get_real_path(p) { return caml_string_of_jsstring(hx_resolve_path(caml_jsstring_of_string(p))); }
//Provides: executable_path
//Requires: caml_string_of_jsstring, hx_expose
function executable_path(unit) { hx_expose(); return caml_string_of_jsstring("/haxe/haxe"); }
//Provides: sys_time
//Requires: hx_expose
function sys_time(unit) { hx_expose(); return Date.now() / 1000; }
//Provides: hx_mtimes
var hx_mtimes = {};
//Provides: sys_filetime
//Requires: caml_jsstring_of_string, hx_mtimes
function sys_filetime(p) {
  var path = caml_jsstring_of_string(p);
  if (Object.prototype.hasOwnProperty.call(hx_mtimes, path)) return hx_mtimes[path];
  if (typeof require === "function" && globalThis.process && globalThis.process.versions) {
    try { return require("fs").statSync(path).mtimeMs / 1000; } catch (e) {}
  }
  return 1;
}
//Provides: sys_getch
function sys_getch(echo) { return 0; }
//Provides: ml_objsize
function ml_objsize(v) { return 0; }

// pcre2 on JS RegExp: byte strings (latin1), so offsets are byte offsets as PCRE2 gives them.
// Enough for the compiler's own regexes and simple EReg use; named groups, callouts and
// the DFA matcher aren't provided.
//Provides: pcre2_compile_stub_bc
//Requires: caml_jsbytes_of_string, caml_int64_to_int32, caml_failwith
function pcre2_compile_stub_bc(iflags, tables, pattern) {
  var f = caml_int64_to_int32(iflags);
  var flags = "gd";
  if (f & 0x8) flags += "i";          // PCRE2_CASELESS
  if (f & 0x400) flags += "m";        // PCRE2_MULTILINE
  if (f & 0x20) flags += "s";         // PCRE2_DOTALL
  var src = caml_jsbytes_of_string(pattern);
  var re;
  try { re = new RegExp(src, flags); } catch (e) { caml_failwith("pcre2 (RegExp): " + e.message + " in /" + src + "/"); }
  var groups = 0;
  try { groups = new RegExp(src + "|").exec("").length - 1; } catch (e) {}
  return { re: re, src: src, groups: groups, flags: f };
}
//Provides: pcre2_capturecount_stub_bc
function pcre2_capturecount_stub_bc(rex) { return rex.groups; }
//Provides: pcre2_argoptions_stub_bc
//Requires: caml_int64_of_int32
function pcre2_argoptions_stub_bc(rex) { return caml_int64_of_int32(rex.flags); }
//Provides: pcre2_size_stub_bc
function pcre2_size_stub_bc(rex) { return 0; }
//Provides: pcre2_backrefmax_stub_bc
function pcre2_backrefmax_stub_bc(rex) { return 0; }
//Provides: pcre2_namecount_stub_bc
function pcre2_namecount_stub_bc(rex) { return 0; }
//Provides: pcre2_nameentrysize_stub_bc
function pcre2_nameentrysize_stub_bc(rex) { return 0; }
//Provides: pcre2_names_stub
function pcre2_names_stub(rex) { return [0]; }
//Provides: pcre2_match_stub_bc
//Requires: caml_jsbytes_of_string, caml_raise_not_found
function pcre2_match_stub_bc(iflags, rex, pos, subj_start, subj, ovector, callout) {
  var s = caml_jsbytes_of_string(subj);
  var re = rex.re;
  re.lastIndex = pos;
  var m = re.exec(s);
  if (m === null) caml_raise_not_found();
  var n = rex.groups + 1;
  for (var i = 0; i < n; i++) {
    var ix = m.indices[i];
    ovector[1 + 2 * i] = ix ? ix[0] : -1;
    ovector[2 + 2 * i] = ix ? ix[1] : -1;
  }
  return 0;
}
//Provides: pcre2_get_stringnumber_stub_bc
//Requires: caml_failwith
function pcre2_get_stringnumber_stub_bc(rex, name) { caml_failwith("pcre2 (RegExp): named groups aren't supported"); }

// sha1 (the `sha` library), in plain JS (a worker has no synchronous digest)
//Provides: hx_sha1
function hx_sha1(bytes) {
  // bytes: a latin1 string; returns the 20-byte digest as a latin1 string
  var n = bytes.length, words = [];
  for (var i = 0; i < n; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
  words[(((n + 8) >> 6) << 4) + 15] = n * 8;
  var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, w = [];
  for (var b = 0; b < words.length; b += 16) {
    var a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (var t = 0; t < 80; t++) {
      if (t < 16) w[t] = words[b + t] | 0;
      else { var x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
      var f, k;
      if (t < 20) { f = (bb & c) | (~bb & d); k = 0x5A827999; }
      else if (t < 40) { f = bb ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = bb ^ c ^ d; k = 0xCA62C1D6; }
      var tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  var out = "";
  [h0, h1, h2, h3, h4].forEach(function (h) {
    for (var s = 24; s >= 0; s -= 8) out += String.fromCharCode((h >>> s) & 0xff);
  });
  return out;
}
//Provides: stub_sha1_init
function stub_sha1_init(unit) { return { parts: [] }; }
//Provides: stub_sha1_update
//Requires: caml_jsbytes_of_string
function stub_sha1_update(ctx, s, pos, len) { ctx.parts.push(caml_jsbytes_of_string(s).substr(pos, len)); return 0; }
//Provides: stub_sha1_copy
function stub_sha1_copy(ctx) { return { parts: ctx.parts.slice() }; }
//Provides: stub_sha1_finalize
//Requires: caml_string_of_jsbytes, hx_sha1
function stub_sha1_finalize(ctx) { return caml_string_of_jsbytes(hx_sha1(ctx.parts.join(""))); }
//Provides: stub_sha1_to_bin
function stub_sha1_to_bin(t) { return t; }
//Provides: stub_sha1_of_bin
function stub_sha1_of_bin(b) { return b; }
//Provides: stub_sha1_to_hex
//Requires: caml_jsbytes_of_string, caml_string_of_jsbytes
function stub_sha1_to_hex(t) {
  var b = caml_jsbytes_of_string(t), out = "";
  for (var i = 0; i < b.length; i++) out += (b.charCodeAt(i) + 256).toString(16).substr(1);
  return caml_string_of_jsbytes(out);
}
//Provides: stub_sha1_of_hex
//Requires: caml_jsbytes_of_string, caml_string_of_jsbytes
function stub_sha1_of_hex(s) {
  var h = caml_jsbytes_of_string(s), out = "";
  for (var i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return caml_string_of_jsbytes(out);
}
//Provides: stub_sha1_equal
//Requires: caml_string_equal
function stub_sha1_equal(a, b) { return caml_string_equal(a, b); }

// constants read when their modules load
//Provides: luv_set_once_callback
function luv_set_once_callback(f) { return 0; }
//Provides: ctypes_typeof_clock_t
function ctypes_typeof_clock_t(u) { return 3; }
//Provides: ctypes_typeof_dev_t
function ctypes_typeof_dev_t(u) { return 7; }
//Provides: ctypes_typeof_ino_t
function ctypes_typeof_ino_t(u) { return 7; }
//Provides: ctypes_typeof_mode_t
function ctypes_typeof_mode_t(u) { return 6; }
//Provides: ctypes_typeof_nlink_t
function ctypes_typeof_nlink_t(u) { return 7; }
//Provides: ctypes_typeof_off_t
function ctypes_typeof_off_t(u) { return 3; }
//Provides: ctypes_typeof_pid_t
function ctypes_typeof_pid_t(u) { return 2; }
//Provides: ctypes_typeof_ssize_t
function ctypes_typeof_ssize_t(u) { return 3; }
//Provides: ctypes_typeof_time_t
function ctypes_typeof_time_t(u) { return 3; }
//Provides: ctypes_typeof_useconds_t
function ctypes_typeof_useconds_t(u) { return 6; }
//Provides: ctypes_sizeof_sigset_t
function ctypes_sizeof_sigset_t(u) { return 128; }
//Provides: ctypes_alignmentof_sigset_t
function ctypes_alignmentof_sigset_t(u) { return 8; }
//Provides: integers_ushort_size
function integers_ushort_size(u) { return 2; }
//Provides: integers_uint_size
function integers_uint_size(u) { return 4; }
//Provides: integers_ulong_size
function integers_ulong_size(u) { return 8; }
//Provides: integers_ulonglong_size
function integers_ulonglong_size(u) { return 8; }

// the integers library: UInt32 as a JS number, UInt64 as a BigInt
//Provides: integers_unsigned_init
function integers_unsigned_init(u) { return 0; }
//Provides: integers_size_t_size
function integers_size_t_size(u) { return 8; }
//Provides: integers_uint8_of_string
//Requires: caml_jsbytes_of_string
function integers_uint8_of_string(s) { return parseInt(caml_jsbytes_of_string(s), 10) & 0xff; }
//Provides: integers_uint16_of_string
//Requires: caml_jsbytes_of_string
function integers_uint16_of_string(s) { return parseInt(caml_jsbytes_of_string(s), 10) & 0xffff; }
//Provides: integers_uint32_add
function integers_uint32_add(a, b) { return (a + b) >>> 0; }
//Provides: integers_uint32_sub
function integers_uint32_sub(a, b) { return (a - b) >>> 0; }
//Provides: integers_uint32_mul
function integers_uint32_mul(a, b) { return Number((BigInt(a) * BigInt(b)) & 0xffffffffn); }
//Provides: integers_uint32_div
//Requires: caml_raise_zero_divide
function integers_uint32_div(a, b) { if (b === 0) caml_raise_zero_divide(); return Math.floor(a / b) >>> 0; }
//Provides: integers_uint32_rem
//Requires: caml_raise_zero_divide
function integers_uint32_rem(a, b) { if (b === 0) caml_raise_zero_divide(); return (a % b) >>> 0; }
//Provides: integers_uint32_logand
function integers_uint32_logand(a, b) { return (a & b) >>> 0; }
//Provides: integers_uint32_logor
function integers_uint32_logor(a, b) { return (a | b) >>> 0; }
//Provides: integers_uint32_logxor
function integers_uint32_logxor(a, b) { return (a ^ b) >>> 0; }
//Provides: integers_uint32_shift_left
function integers_uint32_shift_left(a, n) { return n >= 32 ? 0 : (a << n) >>> 0; }
//Provides: integers_uint32_shift_right
function integers_uint32_shift_right(a, n) { return n >= 32 ? 0 : a >>> n; }
//Provides: integers_uint32_of_string
//Requires: caml_jsbytes_of_string
function integers_uint32_of_string(s) { return Number(BigInt(caml_jsbytes_of_string(s).trim()) & 0xffffffffn); }
//Provides: integers_uint32_to_string
//Requires: caml_string_of_jsbytes
function integers_uint32_to_string(a) { return caml_string_of_jsbytes(String(a >>> 0)); }
//Provides: integers_uint32_to_hexstring
//Requires: caml_string_of_jsbytes
function integers_uint32_to_hexstring(a) { return caml_string_of_jsbytes((a >>> 0).toString(16)); }
//Provides: integers_uint32_of_int
function integers_uint32_of_int(i) { return i >>> 0; }
//Provides: integers_uint32_to_int
function integers_uint32_to_int(a) { return a | 0; }
//Provides: integers_uint32_of_int32
function integers_uint32_of_int32(i) { return i >>> 0; }
//Provides: integers_int32_of_uint32
function integers_int32_of_uint32(a) { return a | 0; }
//Provides: integers_uint32_of_int64
//Requires: caml_int64_to_int32
function integers_uint32_of_int64(x) { return caml_int64_to_int32(x) >>> 0; }
//Provides: integers_uint32_to_int64
//Requires: caml_int64_of_float
function integers_uint32_to_int64(a) { return caml_int64_of_float(a >>> 0); }
//Provides: integers_uint32_max
function integers_uint32_max(u) { return 0xffffffff; }
// UInt64 as BigInt; OCaml's int64 is jsoo's 24/24/16-bit object
//Provides: integers_big_of_int64
function integers_big_of_int64(x) { return (BigInt(x.hi) << 48n | BigInt(x.mi) << 24n | BigInt(x.lo)) & 0xffffffffffffffffn; }
//Provides: integers_int64_of_big
//Requires: caml_int64_create_lo_mi_hi
function integers_int64_of_big(b) {
  b = BigInt.asUintN(64, b);
  return caml_int64_create_lo_mi_hi(Number(b & 0xffffffn), Number((b >> 24n) & 0xffffffn), Number((b >> 48n) & 0xffffn));
}
//Provides: integers_uint64_of_uint32
function integers_uint64_of_uint32(a) { return BigInt(a >>> 0); }
//Provides: integers_uint32_of_uint64
function integers_uint32_of_uint64(b) { return Number(b & 0xffffffffn); }
//Provides: integers_uint64_add
function integers_uint64_add(a, b) { return BigInt.asUintN(64, a + b); }
//Provides: integers_uint64_sub
function integers_uint64_sub(a, b) { return BigInt.asUintN(64, a - b); }
//Provides: integers_uint64_mul
function integers_uint64_mul(a, b) { return BigInt.asUintN(64, a * b); }
//Provides: integers_uint64_div
//Requires: caml_raise_zero_divide
function integers_uint64_div(a, b) { if (b === 0n) caml_raise_zero_divide(); return a / b; }
//Provides: integers_uint64_rem
//Requires: caml_raise_zero_divide
function integers_uint64_rem(a, b) { if (b === 0n) caml_raise_zero_divide(); return a % b; }
//Provides: integers_uint64_logand
function integers_uint64_logand(a, b) { return a & b; }
//Provides: integers_uint64_logor
function integers_uint64_logor(a, b) { return a | b; }
//Provides: integers_uint64_logxor
function integers_uint64_logxor(a, b) { return a ^ b; }
//Provides: integers_uint64_shift_left
function integers_uint64_shift_left(a, n) { return BigInt.asUintN(64, a << BigInt(n)); }
//Provides: integers_uint64_shift_right
function integers_uint64_shift_right(a, n) { return a >> BigInt(n); }
//Provides: integers_uint64_of_int
function integers_uint64_of_int(i) { return BigInt.asUintN(64, BigInt(i)); }
//Provides: integers_uint64_to_int
function integers_uint64_to_int(b) { return Number(BigInt.asIntN(32, b)); }
//Provides: integers_uint64_of_string
//Requires: caml_jsbytes_of_string
function integers_uint64_of_string(s) { return BigInt.asUintN(64, BigInt(caml_jsbytes_of_string(s).trim())); }
//Provides: integers_uint64_to_string
//Requires: caml_string_of_jsbytes
function integers_uint64_to_string(b) { return caml_string_of_jsbytes(b.toString()); }
//Provides: integers_uint64_to_hexstring
//Requires: caml_string_of_jsbytes
function integers_uint64_to_hexstring(b) { return caml_string_of_jsbytes(b.toString(16)); }
//Provides: integers_uint64_of_int64
//Requires: integers_big_of_int64
function integers_uint64_of_int64(x) { return integers_big_of_int64(x); }
//Provides: integers_uint64_to_int64
//Requires: integers_int64_of_big
function integers_uint64_to_int64(b) { return integers_int64_of_big(b); }
//Provides: integers_uint64_max
function integers_uint64_max(u) { return 0xffffffffffffffffn; }
// C type sizes, as on x86-64 Linux
//Provides: integers_intptr_t_size
function integers_intptr_t_size(u) { return 8; }
//Provides: integers_ptrdiff_t_size
function integers_ptrdiff_t_size(u) { return 8; }
//Provides: integers_uintptr_t_size
function integers_uintptr_t_size(u) { return 8; }

// libuv (eval's sockets, timers, processes): nothing here; every call is a no-op returning 0
//Provides: luv_stub_100_uv_pipe_open
function luv_stub_100_uv_pipe_open() { return 0; }
//Provides: luv_stub_101_uv_pipe_connect
function luv_stub_101_uv_pipe_connect() { return 0; }
//Provides: luv_stub_102_uv_pipe_connect2_byte6
function luv_stub_102_uv_pipe_connect2_byte6() { return 0; }
//Provides: luv_stub_103_uv_pipe_getsockname
function luv_stub_103_uv_pipe_getsockname() { return 0; }
//Provides: luv_stub_104_uv_pipe_getpeername
function luv_stub_104_uv_pipe_getpeername() { return 0; }
//Provides: luv_stub_105_uv_pipe_pending_instances
function luv_stub_105_uv_pipe_pending_instances() { return 0; }
//Provides: luv_stub_106_uv_pipe_pending_count
function luv_stub_106_uv_pipe_pending_count() { return 0; }
//Provides: luv_stub_107_uv_pipe_pending_type
function luv_stub_107_uv_pipe_pending_type() { return 0; }
//Provides: luv_stub_108_uv_pipe_chmod
function luv_stub_108_uv_pipe_chmod() { return 0; }
//Provides: luv_stub_109_uv_tty_init
function luv_stub_109_uv_tty_init() { return 0; }
//Provides: luv_stub_10_uv_default_loop
function luv_stub_10_uv_default_loop() { return 0; }
//Provides: luv_stub_110_uv_tty_set_mode
function luv_stub_110_uv_tty_set_mode() { return 0; }
//Provides: luv_stub_111_uv_tty_reset_mode
function luv_stub_111_uv_tty_reset_mode() { return 0; }
//Provides: luv_stub_112_uv_tty_get_winsize
function luv_stub_112_uv_tty_get_winsize() { return 0; }
//Provides: luv_stub_113_uv_tty_set_vterm_state
function luv_stub_113_uv_tty_set_vterm_state() { return 0; }
//Provides: luv_stub_114_uv_tty_get_vterm_state
function luv_stub_114_uv_tty_get_vterm_state() { return 0; }
//Provides: luv_stub_115_uv_udp_init
function luv_stub_115_uv_udp_init() { return 0; }
//Provides: luv_stub_116_uv_udp_init_ex
function luv_stub_116_uv_udp_init_ex() { return 0; }
//Provides: luv_stub_117_uv_udp_open
function luv_stub_117_uv_udp_open() { return 0; }
//Provides: luv_stub_118_uv_udp_bind
function luv_stub_118_uv_udp_bind() { return 0; }
//Provides: luv_stub_119_uv_udp_connect
function luv_stub_119_uv_udp_connect() { return 0; }
//Provides: luv_stub_11_uv_loop_alive
function luv_stub_11_uv_loop_alive() { return 0; }
//Provides: luv_stub_120_uv_udp_getpeername
function luv_stub_120_uv_udp_getpeername() { return 0; }
//Provides: luv_stub_121_uv_udp_getsockname
function luv_stub_121_uv_udp_getsockname() { return 0; }
//Provides: luv_stub_122_uv_udp_set_membership
function luv_stub_122_uv_udp_set_membership() { return 0; }
//Provides: luv_stub_123_uv_udp_set_source_membership
function luv_stub_123_uv_udp_set_source_membership() { return 0; }
//Provides: luv_stub_124_uv_udp_set_multicast_loop
function luv_stub_124_uv_udp_set_multicast_loop() { return 0; }
//Provides: luv_stub_125_uv_udp_set_multicast_ttl
function luv_stub_125_uv_udp_set_multicast_ttl() { return 0; }
//Provides: luv_stub_126_uv_udp_set_multicast_interface
function luv_stub_126_uv_udp_set_multicast_interface() { return 0; }
//Provides: luv_stub_127_uv_udp_set_broadcast
function luv_stub_127_uv_udp_set_broadcast() { return 0; }
//Provides: luv_stub_128_uv_udp_set_ttl
function luv_stub_128_uv_udp_set_ttl() { return 0; }
//Provides: luv_stub_129_luv_get_send_trampoline
function luv_stub_129_luv_get_send_trampoline() { return 0; }
//Provides: luv_stub_12_uv_stop
function luv_stub_12_uv_stop() { return 0; }
//Provides: luv_stub_130_uv_udp_send_byte6
function luv_stub_130_uv_udp_send_byte6() { return 0; }
//Provides: luv_stub_131_uv_udp_try_send
function luv_stub_131_uv_udp_try_send() { return 0; }
//Provides: luv_stub_132_luv_get_recv_trampoline
function luv_stub_132_luv_get_recv_trampoline() { return 0; }
//Provides: luv_stub_133_luv_udp_recv_start
function luv_stub_133_luv_udp_recv_start() { return 0; }
//Provides: luv_stub_134_uv_udp_recv_stop
function luv_stub_134_uv_udp_recv_stop() { return 0; }
//Provides: luv_stub_135_uv_udp_using_recvmmsg
function luv_stub_135_uv_udp_using_recvmmsg() { return 0; }
//Provides: luv_stub_136_uv_udp_get_send_queue_size
function luv_stub_136_uv_udp_get_send_queue_size() { return 0; }
//Provides: luv_stub_137_uv_udp_get_send_queue_count
function luv_stub_137_uv_udp_get_send_queue_count() { return 0; }
//Provides: luv_stub_138_luv_get_exit_trampoline
function luv_stub_138_luv_get_exit_trampoline() { return 0; }
//Provides: luv_stub_139_luv_null_exit_trampoline
function luv_stub_139_luv_null_exit_trampoline() { return 0; }
//Provides: luv_stub_13_uv_backend_fd
function luv_stub_13_uv_backend_fd() { return 0; }
//Provides: luv_stub_140_uv_disable_stdio_inheritance
function luv_stub_140_uv_disable_stdio_inheritance() { return 0; }
//Provides: luv_stub_141_luv_spawn_byte16
function luv_stub_141_luv_spawn_byte16() { return 0; }
//Provides: luv_stub_142_uv_process_kill
function luv_stub_142_uv_process_kill() { return 0; }
//Provides: luv_stub_143_uv_kill
function luv_stub_143_uv_kill() { return 0; }
//Provides: luv_stub_144_uv_process_get_pid
function luv_stub_144_uv_process_get_pid() { return 0; }
//Provides: luv_stub_145_luv_get_fs_event_trampoline
function luv_stub_145_luv_get_fs_event_trampoline() { return 0; }
//Provides: luv_stub_146_uv_fs_event_init
function luv_stub_146_uv_fs_event_init() { return 0; }
//Provides: luv_stub_147_luv_fs_event_start
function luv_stub_147_luv_fs_event_start() { return 0; }
//Provides: luv_stub_148_uv_fs_event_stop
function luv_stub_148_uv_fs_event_stop() { return 0; }
//Provides: luv_stub_149_luv_get_fs_poll_trampoline
function luv_stub_149_luv_get_fs_poll_trampoline() { return 0; }
//Provides: luv_stub_14_uv_backend_timeout
function luv_stub_14_uv_backend_timeout() { return 0; }
//Provides: luv_stub_150_uv_fs_poll_init
function luv_stub_150_uv_fs_poll_init() { return 0; }
//Provides: luv_stub_151_luv_fs_poll_start
function luv_stub_151_luv_fs_poll_start() { return 0; }
//Provides: luv_stub_152_uv_fs_poll_stop
function luv_stub_152_uv_fs_poll_stop() { return 0; }
//Provides: luv_stub_153_luv_get_getaddrinfo_trampoline
function luv_stub_153_luv_get_getaddrinfo_trampoline() { return 0; }
//Provides: luv_stub_154_uv_getaddrinfo_byte6
function luv_stub_154_uv_getaddrinfo_byte6() { return 0; }
//Provides: luv_stub_155_uv_freeaddrinfo
function luv_stub_155_uv_freeaddrinfo() { return 0; }
//Provides: luv_stub_156_luv_get_getnameinfo_trampoline
function luv_stub_156_luv_get_getnameinfo_trampoline() { return 0; }
//Provides: luv_stub_157_luv_getnameinfo
function luv_stub_157_luv_getnameinfo() { return 0; }
//Provides: luv_stub_158_uv_dlopen
function luv_stub_158_uv_dlopen() { return 0; }
//Provides: luv_stub_159_uv_dlclose
function luv_stub_159_uv_dlclose() { return 0; }
//Provides: luv_stub_15_uv_now
function luv_stub_15_uv_now() { return 0; }
//Provides: luv_stub_160_uv_dlsym
function luv_stub_160_uv_dlsym() { return 0; }
//Provides: luv_stub_161_luv_dlerror
function luv_stub_161_luv_dlerror() { return 0; }
//Provides: luv_stub_162_uv_get_osfhandle
function luv_stub_162_uv_get_osfhandle() { return 0; }
//Provides: luv_stub_163_uv_open_osfhandle
function luv_stub_163_uv_open_osfhandle() { return 0; }
//Provides: luv_stub_164_luv_is_invalid_handle_value
function luv_stub_164_luv_is_invalid_handle_value() { return 0; }
//Provides: luv_stub_165_luv_is_invalid_socket_value
function luv_stub_165_luv_is_invalid_socket_value() { return 0; }
//Provides: luv_stub_166_memcpy
function luv_stub_166_memcpy() { return 0; }
//Provides: luv_stub_167_memcpy
function luv_stub_167_memcpy() { return 0; }
//Provides: luv_stub_168_luv_get_work_trampoline
function luv_stub_168_luv_get_work_trampoline() { return 0; }
//Provides: luv_stub_169_luv_get_after_work_trampoline
function luv_stub_169_luv_get_after_work_trampoline() { return 0; }
//Provides: luv_stub_16_uv_update_time
function luv_stub_16_uv_update_time() { return 0; }
//Provides: luv_stub_170_luv_get_c_work_trampoline
function luv_stub_170_luv_get_c_work_trampoline() { return 0; }
//Provides: luv_stub_171_luv_get_after_c_work_trampoline
function luv_stub_171_luv_get_after_c_work_trampoline() { return 0; }
//Provides: luv_stub_172_luv_add_c_function_and_argument
function luv_stub_172_luv_add_c_function_and_argument() { return 0; }
//Provides: luv_stub_173_uv_queue_work
function luv_stub_173_uv_queue_work() { return 0; }
//Provides: luv_stub_174_luv_get_thread_trampoline
function luv_stub_174_luv_get_thread_trampoline() { return 0; }
//Provides: luv_stub_175_uv_thread_create_ex
function luv_stub_175_uv_thread_create_ex() { return 0; }
//Provides: luv_stub_176_luv_thread_create_c
function luv_stub_176_luv_thread_create_c() { return 0; }
//Provides: luv_stub_177_uv_thread_self
function luv_stub_177_uv_thread_self() { return 0; }
//Provides: luv_stub_178_uv_thread_equal
function luv_stub_178_uv_thread_equal() { return 0; }
//Provides: luv_stub_179_uv_thread_setpriority
function luv_stub_179_uv_thread_setpriority() { return 0; }
//Provides: luv_stub_17_uv_loop_fork
function luv_stub_17_uv_loop_fork() { return 0; }
//Provides: luv_stub_180_uv_thread_getpriority
function luv_stub_180_uv_thread_getpriority() { return 0; }
//Provides: luv_stub_181_uv_cpumask_size
function luv_stub_181_uv_cpumask_size() { return 0; }
//Provides: luv_stub_182_uv_thread_setaffinity
function luv_stub_182_uv_thread_setaffinity() { return 0; }
//Provides: luv_stub_183_uv_thread_getaffinity
function luv_stub_183_uv_thread_getaffinity() { return 0; }
//Provides: luv_stub_184_uv_thread_getcpu
function luv_stub_184_uv_thread_getcpu() { return 0; }
//Provides: luv_stub_185_uv_key_create
function luv_stub_185_uv_key_create() { return 0; }
//Provides: luv_stub_186_uv_key_delete
function luv_stub_186_uv_key_delete() { return 0; }
//Provides: luv_stub_187_uv_key_get
function luv_stub_187_uv_key_get() { return 0; }
//Provides: luv_stub_188_uv_key_set
function luv_stub_188_uv_key_set() { return 0; }
//Provides: luv_stub_189_luv_get_once_trampoline
function luv_stub_189_luv_get_once_trampoline() { return 0; }
//Provides: luv_stub_18_uv_library_shutdown
function luv_stub_18_uv_library_shutdown() { return 0; }
//Provides: luv_stub_190_luv_once_init
function luv_stub_190_luv_once_init() { return 0; }
//Provides: luv_stub_191_uv_once
function luv_stub_191_uv_once() { return 0; }
//Provides: luv_stub_192_uv_mutex_init
function luv_stub_192_uv_mutex_init() { return 0; }
//Provides: luv_stub_193_uv_mutex_init_recursive
function luv_stub_193_uv_mutex_init_recursive() { return 0; }
//Provides: luv_stub_194_uv_mutex_destroy
function luv_stub_194_uv_mutex_destroy() { return 0; }
//Provides: luv_stub_195_uv_mutex_trylock
function luv_stub_195_uv_mutex_trylock() { return 0; }
//Provides: luv_stub_196_uv_mutex_unlock
function luv_stub_196_uv_mutex_unlock() { return 0; }
//Provides: luv_stub_197_uv_rwlock_init
function luv_stub_197_uv_rwlock_init() { return 0; }
//Provides: luv_stub_198_uv_rwlock_destroy
function luv_stub_198_uv_rwlock_destroy() { return 0; }
//Provides: luv_stub_199_uv_rwlock_tryrdlock
function luv_stub_199_uv_rwlock_tryrdlock() { return 0; }
//Provides: luv_stub_19_luv_get_close_trampoline
function luv_stub_19_luv_get_close_trampoline() { return 0; }
//Provides: luv_stub_1_uv_strerror_r
function luv_stub_1_uv_strerror_r() { return 0; }
//Provides: luv_stub_200_uv_rwlock_rdunlock
function luv_stub_200_uv_rwlock_rdunlock() { return 0; }
//Provides: luv_stub_201_uv_rwlock_trywrlock
function luv_stub_201_uv_rwlock_trywrlock() { return 0; }
//Provides: luv_stub_202_uv_rwlock_wrunlock
function luv_stub_202_uv_rwlock_wrunlock() { return 0; }
//Provides: luv_stub_203_uv_sem_init
function luv_stub_203_uv_sem_init() { return 0; }
//Provides: luv_stub_204_uv_sem_destroy
function luv_stub_204_uv_sem_destroy() { return 0; }
//Provides: luv_stub_205_uv_sem_post
function luv_stub_205_uv_sem_post() { return 0; }
//Provides: luv_stub_206_uv_sem_trywait
function luv_stub_206_uv_sem_trywait() { return 0; }
//Provides: luv_stub_207_uv_cond_init
function luv_stub_207_uv_cond_init() { return 0; }
//Provides: luv_stub_208_uv_cond_destroy
function luv_stub_208_uv_cond_destroy() { return 0; }
//Provides: luv_stub_209_uv_cond_signal
function luv_stub_209_uv_cond_signal() { return 0; }
//Provides: luv_stub_20_luv_get_alloc_trampoline
function luv_stub_20_luv_get_alloc_trampoline() { return 0; }
//Provides: luv_stub_210_uv_cond_broadcast
function luv_stub_210_uv_cond_broadcast() { return 0; }
//Provides: luv_stub_211_uv_barrier_init
function luv_stub_211_uv_barrier_init() { return 0; }
//Provides: luv_stub_212_uv_barrier_destroy
function luv_stub_212_uv_barrier_destroy() { return 0; }
//Provides: luv_stub_213_uv_ip4_addr
function luv_stub_213_uv_ip4_addr() { return 0; }
//Provides: luv_stub_214_uv_ip6_addr
function luv_stub_214_uv_ip6_addr() { return 0; }
//Provides: luv_stub_215_uv_ip4_name
function luv_stub_215_uv_ip4_name() { return 0; }
//Provides: luv_stub_216_uv_ip6_name
function luv_stub_216_uv_ip6_name() { return 0; }
//Provides: luv_stub_217_memcpy
function luv_stub_217_memcpy() { return 0; }
//Provides: luv_stub_218_ntohs
function luv_stub_218_ntohs() { return 0; }
//Provides: luv_stub_219_luv_sa_family_to_int
function luv_stub_219_luv_sa_family_to_int() { return 0; }
//Provides: luv_stub_21_uv_is_active
function luv_stub_21_uv_is_active() { return 0; }
//Provides: luv_stub_220_uv_resident_set_memory
function luv_stub_220_uv_resident_set_memory() { return 0; }
//Provides: luv_stub_221_uv_uptime
function luv_stub_221_uv_uptime() { return 0; }
//Provides: luv_stub_222_uv_loadavg
function luv_stub_222_uv_loadavg() { return 0; }
//Provides: luv_stub_223_uv_get_free_memory
function luv_stub_223_uv_get_free_memory() { return 0; }
//Provides: luv_stub_224_uv_get_total_memory
function luv_stub_224_uv_get_total_memory() { return 0; }
//Provides: luv_stub_225_uv_get_constrained_memory
function luv_stub_225_uv_get_constrained_memory() { return 0; }
//Provides: luv_stub_226_uv_get_available_memory
function luv_stub_226_uv_get_available_memory() { return 0; }
//Provides: luv_stub_227_uv_os_getpriority
function luv_stub_227_uv_os_getpriority() { return 0; }
//Provides: luv_stub_228_uv_os_setpriority
function luv_stub_228_uv_os_setpriority() { return 0; }
//Provides: luv_stub_229_uv_getrusage
function luv_stub_229_uv_getrusage() { return 0; }
//Provides: luv_stub_22_uv_is_closing
function luv_stub_22_uv_is_closing() { return 0; }
//Provides: luv_stub_230_uv_os_getpid
function luv_stub_230_uv_os_getpid() { return 0; }
//Provides: luv_stub_231_uv_os_getppid
function luv_stub_231_uv_os_getppid() { return 0; }
//Provides: luv_stub_232_uv_available_parallelism
function luv_stub_232_uv_available_parallelism() { return 0; }
//Provides: luv_stub_233_uv_cpu_info
function luv_stub_233_uv_cpu_info() { return 0; }
//Provides: luv_stub_234_uv_free_cpu_info
function luv_stub_234_uv_free_cpu_info() { return 0; }
//Provides: luv_stub_235_uv_interface_addresses
function luv_stub_235_uv_interface_addresses() { return 0; }
//Provides: luv_stub_236_uv_free_interface_addresses
function luv_stub_236_uv_free_interface_addresses() { return 0; }
//Provides: luv_stub_237_uv_if_indextoname
function luv_stub_237_uv_if_indextoname() { return 0; }
//Provides: luv_stub_238_uv_if_indextoiid
function luv_stub_238_uv_if_indextoiid() { return 0; }
//Provides: luv_stub_239_uv_os_gethostname
function luv_stub_239_uv_os_gethostname() { return 0; }
//Provides: luv_stub_23_uv_close
function luv_stub_23_uv_close() { return 0; }
//Provides: luv_stub_240_uv_exepath
function luv_stub_240_uv_exepath() { return 0; }
//Provides: luv_stub_241_uv_cwd
function luv_stub_241_uv_cwd() { return 0; }
//Provides: luv_stub_242_uv_chdir
function luv_stub_242_uv_chdir() { return 0; }
//Provides: luv_stub_243_uv_os_homedir
function luv_stub_243_uv_os_homedir() { return 0; }
//Provides: luv_stub_244_uv_os_tmpdir
function luv_stub_244_uv_os_tmpdir() { return 0; }
//Provides: luv_stub_245_uv_os_get_passwd
function luv_stub_245_uv_os_get_passwd() { return 0; }
//Provides: luv_stub_246_uv_os_get_passwd2
function luv_stub_246_uv_os_get_passwd2() { return 0; }
//Provides: luv_stub_247_uv_os_free_passwd
function luv_stub_247_uv_os_free_passwd() { return 0; }
//Provides: luv_stub_248_uv_os_get_group
function luv_stub_248_uv_os_get_group() { return 0; }
//Provides: luv_stub_249_uv_os_free_group
function luv_stub_249_uv_os_free_group() { return 0; }
//Provides: luv_stub_24_uv_ref
function luv_stub_24_uv_ref() { return 0; }
//Provides: luv_stub_250_uv_os_getenv
function luv_stub_250_uv_os_getenv() { return 0; }
//Provides: luv_stub_251_uv_os_setenv
function luv_stub_251_uv_os_setenv() { return 0; }
//Provides: luv_stub_252_uv_os_unsetenv
function luv_stub_252_uv_os_unsetenv() { return 0; }
//Provides: luv_stub_253_uv_os_environ
function luv_stub_253_uv_os_environ() { return 0; }
//Provides: luv_stub_254_uv_os_free_environ
function luv_stub_254_uv_os_free_environ() { return 0; }
//Provides: luv_stub_255_luv_os_uname
function luv_stub_255_luv_os_uname() { return 0; }
//Provides: luv_stub_256_uv_gettimeofday
function luv_stub_256_uv_gettimeofday() { return 0; }
//Provides: luv_stub_257_uv_hrtime
function luv_stub_257_uv_hrtime() { return 0; }
//Provides: luv_stub_258_uv_clock_gettime
function luv_stub_258_uv_clock_gettime() { return 0; }
//Provides: luv_stub_259_luv_get_random_trampoline
function luv_stub_259_luv_get_random_trampoline() { return 0; }
//Provides: luv_stub_25_uv_unref
function luv_stub_25_uv_unref() { return 0; }
//Provides: luv_stub_260_luv_null_random_trampoline
function luv_stub_260_luv_null_random_trampoline() { return 0; }
//Provides: luv_stub_261_uv_random_byte6
function luv_stub_261_uv_random_byte6() { return 0; }
//Provides: luv_stub_262_uv_metrics_idle_time
function luv_stub_262_uv_metrics_idle_time() { return 0; }
//Provides: luv_stub_263_uv_metrics_info
function luv_stub_263_uv_metrics_info() { return 0; }
//Provides: luv_stub_264_luv_utf16_length_as_wtf8
function luv_stub_264_luv_utf16_length_as_wtf8() { return 0; }
//Provides: luv_stub_265_luv_utf16_to_wtf8
function luv_stub_265_luv_utf16_to_wtf8() { return 0; }
//Provides: luv_stub_266_uv_wtf8_length_as_utf16
function luv_stub_266_uv_wtf8_length_as_utf16() { return 0; }
//Provides: luv_stub_267_uv_wtf8_to_utf16
function luv_stub_267_uv_wtf8_to_utf16() { return 0; }
//Provides: luv_stub_268_free
function luv_stub_268_free() { return 0; }
//Provides: luv_stub_26_uv_has_ref
function luv_stub_26_uv_has_ref() { return 0; }
//Provides: luv_stub_27_uv_send_buffer_size
function luv_stub_27_uv_send_buffer_size() { return 0; }
//Provides: luv_stub_28_uv_recv_buffer_size
function luv_stub_28_uv_recv_buffer_size() { return 0; }
//Provides: luv_stub_29_uv_fileno
function luv_stub_29_uv_fileno() { return 0; }
//Provides: luv_stub_2_uv_err_name_r
function luv_stub_2_uv_err_name_r() { return 0; }
//Provides: luv_stub_30_uv_handle_get_loop
function luv_stub_30_uv_handle_get_loop() { return 0; }
//Provides: luv_stub_31_uv_handle_get_data
function luv_stub_31_uv_handle_get_data() { return 0; }
//Provides: luv_stub_32_uv_handle_set_data
function luv_stub_32_uv_handle_set_data() { return 0; }
//Provides: luv_stub_33_uv_cancel
function luv_stub_33_uv_cancel() { return 0; }
//Provides: luv_stub_34_uv_req_get_data
function luv_stub_34_uv_req_get_data() { return 0; }
//Provides: luv_stub_35_uv_req_set_data
function luv_stub_35_uv_req_set_data() { return 0; }
//Provides: luv_stub_36_luv_get_timer_trampoline
function luv_stub_36_luv_get_timer_trampoline() { return 0; }
//Provides: luv_stub_37_uv_timer_init
function luv_stub_37_uv_timer_init() { return 0; }
//Provides: luv_stub_38_uv_timer_start
function luv_stub_38_uv_timer_start() { return 0; }
//Provides: luv_stub_39_uv_timer_stop
function luv_stub_39_uv_timer_stop() { return 0; }
//Provides: luv_stub_3_uv_translate_sys_error
function luv_stub_3_uv_translate_sys_error() { return 0; }
//Provides: luv_stub_40_uv_timer_again
function luv_stub_40_uv_timer_again() { return 0; }
//Provides: luv_stub_41_uv_timer_set_repeat
function luv_stub_41_uv_timer_set_repeat() { return 0; }
//Provides: luv_stub_42_uv_timer_get_repeat
function luv_stub_42_uv_timer_get_repeat() { return 0; }
//Provides: luv_stub_43_uv_timer_get_due_in
function luv_stub_43_uv_timer_get_due_in() { return 0; }
//Provides: luv_stub_44_luv_get_prepare_trampoline
function luv_stub_44_luv_get_prepare_trampoline() { return 0; }
//Provides: luv_stub_45_uv_prepare_init
function luv_stub_45_uv_prepare_init() { return 0; }
//Provides: luv_stub_46_uv_prepare_start
function luv_stub_46_uv_prepare_start() { return 0; }
//Provides: luv_stub_47_uv_prepare_stop
function luv_stub_47_uv_prepare_stop() { return 0; }
//Provides: luv_stub_48_luv_get_check_trampoline
function luv_stub_48_luv_get_check_trampoline() { return 0; }
//Provides: luv_stub_49_uv_check_init
function luv_stub_49_uv_check_init() { return 0; }
//Provides: luv_stub_4_luv_version_suffix
function luv_stub_4_luv_version_suffix() { return 0; }
//Provides: luv_stub_50_uv_check_start
function luv_stub_50_uv_check_start() { return 0; }
//Provides: luv_stub_51_uv_check_stop
function luv_stub_51_uv_check_stop() { return 0; }
//Provides: luv_stub_52_luv_get_idle_trampoline
function luv_stub_52_luv_get_idle_trampoline() { return 0; }
//Provides: luv_stub_53_uv_idle_init
function luv_stub_53_uv_idle_init() { return 0; }
//Provides: luv_stub_54_uv_idle_start
function luv_stub_54_uv_idle_start() { return 0; }
//Provides: luv_stub_55_uv_idle_stop
function luv_stub_55_uv_idle_stop() { return 0; }
//Provides: luv_stub_56_luv_get_async_trampoline
function luv_stub_56_luv_get_async_trampoline() { return 0; }
//Provides: luv_stub_57_uv_async_init
function luv_stub_57_uv_async_init() { return 0; }
//Provides: luv_stub_58_uv_async_send
function luv_stub_58_uv_async_send() { return 0; }
//Provides: luv_stub_59_luv_get_poll_trampoline
function luv_stub_59_luv_get_poll_trampoline() { return 0; }
//Provides: luv_stub_5_uv_version
function luv_stub_5_uv_version() { return 0; }
//Provides: luv_stub_60_uv_poll_init
function luv_stub_60_uv_poll_init() { return 0; }
//Provides: luv_stub_61_uv_poll_init_socket
function luv_stub_61_uv_poll_init_socket() { return 0; }
//Provides: luv_stub_62_uv_poll_start
function luv_stub_62_uv_poll_start() { return 0; }
//Provides: luv_stub_63_uv_poll_stop
function luv_stub_63_uv_poll_stop() { return 0; }
//Provides: luv_stub_64_luv_get_signal_trampoline
function luv_stub_64_luv_get_signal_trampoline() { return 0; }
//Provides: luv_stub_65_uv_signal_init
function luv_stub_65_uv_signal_init() { return 0; }
//Provides: luv_stub_66_uv_signal_start
function luv_stub_66_uv_signal_start() { return 0; }
//Provides: luv_stub_67_uv_signal_start_oneshot
function luv_stub_67_uv_signal_start_oneshot() { return 0; }
//Provides: luv_stub_68_uv_signal_stop
function luv_stub_68_uv_signal_stop() { return 0; }
//Provides: luv_stub_69_luv_get_connect_trampoline
function luv_stub_69_luv_get_connect_trampoline() { return 0; }
//Provides: luv_stub_6_luv_version_string
function luv_stub_6_luv_version_string() { return 0; }
//Provides: luv_stub_70_luv_get_shutdown_trampoline
function luv_stub_70_luv_get_shutdown_trampoline() { return 0; }
//Provides: luv_stub_71_luv_get_write_trampoline
function luv_stub_71_luv_get_write_trampoline() { return 0; }
//Provides: luv_stub_72_luv_get_connection_trampoline
function luv_stub_72_luv_get_connection_trampoline() { return 0; }
//Provides: luv_stub_73_luv_get_read_trampoline
function luv_stub_73_luv_get_read_trampoline() { return 0; }
//Provides: luv_stub_74_uv_shutdown
function luv_stub_74_uv_shutdown() { return 0; }
//Provides: luv_stub_75_uv_listen
function luv_stub_75_uv_listen() { return 0; }
//Provides: luv_stub_76_uv_accept
function luv_stub_76_uv_accept() { return 0; }
//Provides: luv_stub_77_luv_read_start
function luv_stub_77_luv_read_start() { return 0; }
//Provides: luv_stub_78_uv_read_stop
function luv_stub_78_uv_read_stop() { return 0; }
//Provides: luv_stub_79_uv_write2_byte6
function luv_stub_79_uv_write2_byte6() { return 0; }
//Provides: luv_stub_7_uv_loop_init
function luv_stub_7_uv_loop_init() { return 0; }
//Provides: luv_stub_80_uv_try_write
function luv_stub_80_uv_try_write() { return 0; }
//Provides: luv_stub_81_uv_try_write2
function luv_stub_81_uv_try_write2() { return 0; }
//Provides: luv_stub_82_uv_is_readable
function luv_stub_82_uv_is_readable() { return 0; }
//Provides: luv_stub_83_uv_is_writable
function luv_stub_83_uv_is_writable() { return 0; }
//Provides: luv_stub_84_uv_stream_set_blocking
function luv_stub_84_uv_stream_set_blocking() { return 0; }
//Provides: luv_stub_85_uv_stream_get_write_queue_size
function luv_stub_85_uv_stream_get_write_queue_size() { return 0; }
//Provides: luv_stub_86_uv_tcp_init
function luv_stub_86_uv_tcp_init() { return 0; }
//Provides: luv_stub_87_uv_tcp_init_ex
function luv_stub_87_uv_tcp_init_ex() { return 0; }
//Provides: luv_stub_88_uv_tcp_open
function luv_stub_88_uv_tcp_open() { return 0; }
//Provides: luv_stub_89_uv_socketpair
function luv_stub_89_uv_socketpair() { return 0; }
//Provides: luv_stub_8_uv_loop_configure
function luv_stub_8_uv_loop_configure() { return 0; }
//Provides: luv_stub_90_uv_tcp_nodelay
function luv_stub_90_uv_tcp_nodelay() { return 0; }
//Provides: luv_stub_91_uv_tcp_keepalive
function luv_stub_91_uv_tcp_keepalive() { return 0; }
//Provides: luv_stub_92_uv_tcp_simultaneous_accepts
function luv_stub_92_uv_tcp_simultaneous_accepts() { return 0; }
//Provides: luv_stub_93_uv_tcp_bind
function luv_stub_93_uv_tcp_bind() { return 0; }
//Provides: luv_stub_94_uv_tcp_getsockname
function luv_stub_94_uv_tcp_getsockname() { return 0; }
//Provides: luv_stub_95_uv_tcp_getpeername
function luv_stub_95_uv_tcp_getpeername() { return 0; }
//Provides: luv_stub_96_uv_tcp_connect
function luv_stub_96_uv_tcp_connect() { return 0; }
//Provides: luv_stub_97_uv_tcp_close_reset
function luv_stub_97_uv_tcp_close_reset() { return 0; }
//Provides: luv_stub_98_uv_pipe_init
function luv_stub_98_uv_pipe_init() { return 0; }
//Provides: luv_stub_99_uv_pipe
function luv_stub_99_uv_pipe() { return 0; }
//Provides: luv_stub_9_uv_loop_close
function luv_stub_9_uv_loop_close() { return 0; }
//Provides: luv_stub_blocking_10_uv_fs_write_byte7
function luv_stub_blocking_10_uv_fs_write_byte7() { return 0; }
//Provides: luv_stub_blocking_11_uv_fs_unlink
function luv_stub_blocking_11_uv_fs_unlink() { return 0; }
//Provides: luv_stub_blocking_12_uv_fs_mkdir
function luv_stub_blocking_12_uv_fs_mkdir() { return 0; }
//Provides: luv_stub_blocking_13_uv_fs_mkdtemp
function luv_stub_blocking_13_uv_fs_mkdtemp() { return 0; }
//Provides: luv_stub_blocking_14_uv_fs_mkstemp
function luv_stub_blocking_14_uv_fs_mkstemp() { return 0; }
//Provides: luv_stub_blocking_15_uv_fs_rmdir
function luv_stub_blocking_15_uv_fs_rmdir() { return 0; }
//Provides: luv_stub_blocking_16_uv_fs_opendir
function luv_stub_blocking_16_uv_fs_opendir() { return 0; }
//Provides: luv_stub_blocking_17_uv_fs_closedir
function luv_stub_blocking_17_uv_fs_closedir() { return 0; }
//Provides: luv_stub_blocking_18_uv_fs_readdir
function luv_stub_blocking_18_uv_fs_readdir() { return 0; }
//Provides: luv_stub_blocking_19_uv_fs_scandir
function luv_stub_blocking_19_uv_fs_scandir() { return 0; }
//Provides: luv_stub_blocking_1_uv_run
function luv_stub_blocking_1_uv_run() { return 0; }
//Provides: luv_stub_blocking_20_uv_fs_scandir_next
function luv_stub_blocking_20_uv_fs_scandir_next() { return 0; }
//Provides: luv_stub_blocking_21_uv_fs_stat
function luv_stub_blocking_21_uv_fs_stat() { return 0; }
//Provides: luv_stub_blocking_22_uv_fs_lstat
function luv_stub_blocking_22_uv_fs_lstat() { return 0; }
//Provides: luv_stub_blocking_23_uv_fs_fstat
function luv_stub_blocking_23_uv_fs_fstat() { return 0; }
//Provides: luv_stub_blocking_24_uv_fs_statfs
function luv_stub_blocking_24_uv_fs_statfs() { return 0; }
//Provides: luv_stub_blocking_25_uv_fs_rename
function luv_stub_blocking_25_uv_fs_rename() { return 0; }
//Provides: luv_stub_blocking_26_uv_fs_fsync
function luv_stub_blocking_26_uv_fs_fsync() { return 0; }
//Provides: luv_stub_blocking_27_uv_fs_fdatasync
function luv_stub_blocking_27_uv_fs_fdatasync() { return 0; }
//Provides: luv_stub_blocking_28_uv_fs_ftruncate
function luv_stub_blocking_28_uv_fs_ftruncate() { return 0; }
//Provides: luv_stub_blocking_29_uv_fs_copyfile_byte6
function luv_stub_blocking_29_uv_fs_copyfile_byte6() { return 0; }
//Provides: luv_stub_blocking_2_uv_pipe_bind
function luv_stub_blocking_2_uv_pipe_bind() { return 0; }
//Provides: luv_stub_blocking_30_uv_fs_sendfile_byte7
function luv_stub_blocking_30_uv_fs_sendfile_byte7() { return 0; }
//Provides: luv_stub_blocking_31_uv_fs_access
function luv_stub_blocking_31_uv_fs_access() { return 0; }
//Provides: luv_stub_blocking_32_uv_fs_chmod
function luv_stub_blocking_32_uv_fs_chmod() { return 0; }
//Provides: luv_stub_blocking_33_uv_fs_fchmod
function luv_stub_blocking_33_uv_fs_fchmod() { return 0; }
//Provides: luv_stub_blocking_34_uv_fs_utime_byte6
function luv_stub_blocking_34_uv_fs_utime_byte6() { return 0; }
//Provides: luv_stub_blocking_35_uv_fs_futime_byte6
function luv_stub_blocking_35_uv_fs_futime_byte6() { return 0; }
//Provides: luv_stub_blocking_36_uv_fs_lutime_byte6
function luv_stub_blocking_36_uv_fs_lutime_byte6() { return 0; }
//Provides: luv_stub_blocking_37_uv_fs_link
function luv_stub_blocking_37_uv_fs_link() { return 0; }
//Provides: luv_stub_blocking_38_uv_fs_symlink_byte6
function luv_stub_blocking_38_uv_fs_symlink_byte6() { return 0; }
//Provides: luv_stub_blocking_39_uv_fs_readlink
function luv_stub_blocking_39_uv_fs_readlink() { return 0; }
//Provides: luv_stub_blocking_3_uv_pipe_bind2
function luv_stub_blocking_3_uv_pipe_bind2() { return 0; }
//Provides: luv_stub_blocking_40_uv_fs_realpath
function luv_stub_blocking_40_uv_fs_realpath() { return 0; }
//Provides: luv_stub_blocking_41_uv_fs_chown_byte6
function luv_stub_blocking_41_uv_fs_chown_byte6() { return 0; }
//Provides: luv_stub_blocking_42_uv_fs_fchown_byte6
function luv_stub_blocking_42_uv_fs_fchown_byte6() { return 0; }
//Provides: luv_stub_blocking_43_uv_fs_lchown_byte6
function luv_stub_blocking_43_uv_fs_lchown_byte6() { return 0; }
//Provides: luv_stub_blocking_44_uv_fs_get_result
function luv_stub_blocking_44_uv_fs_get_result() { return 0; }
//Provides: luv_stub_blocking_45_uv_fs_get_ptr
function luv_stub_blocking_45_uv_fs_get_ptr() { return 0; }
//Provides: luv_stub_blocking_46_uv_fs_get_ptr
function luv_stub_blocking_46_uv_fs_get_ptr() { return 0; }
//Provides: luv_stub_blocking_47_luv_fs_get_path
function luv_stub_blocking_47_luv_fs_get_path() { return 0; }
//Provides: luv_stub_blocking_48_uv_fs_get_statbuf
function luv_stub_blocking_48_uv_fs_get_statbuf() { return 0; }
//Provides: luv_stub_blocking_49_uv_thread_join
function luv_stub_blocking_49_uv_thread_join() { return 0; }
//Provides: luv_stub_blocking_4_luv_get_fs_trampoline
function luv_stub_blocking_4_luv_get_fs_trampoline() { return 0; }
//Provides: luv_stub_blocking_50_uv_mutex_lock
function luv_stub_blocking_50_uv_mutex_lock() { return 0; }
//Provides: luv_stub_blocking_51_uv_rwlock_rdlock
function luv_stub_blocking_51_uv_rwlock_rdlock() { return 0; }
//Provides: luv_stub_blocking_52_uv_rwlock_wrlock
function luv_stub_blocking_52_uv_rwlock_wrlock() { return 0; }
//Provides: luv_stub_blocking_53_uv_sem_wait
function luv_stub_blocking_53_uv_sem_wait() { return 0; }
//Provides: luv_stub_blocking_54_uv_cond_wait
function luv_stub_blocking_54_uv_cond_wait() { return 0; }
//Provides: luv_stub_blocking_55_uv_cond_timedwait
function luv_stub_blocking_55_uv_cond_timedwait() { return 0; }
//Provides: luv_stub_blocking_56_uv_barrier_wait
function luv_stub_blocking_56_uv_barrier_wait() { return 0; }
//Provides: luv_stub_blocking_57_uv_sleep
function luv_stub_blocking_57_uv_sleep() { return 0; }
//Provides: luv_stub_blocking_58_uv_random_byte6
function luv_stub_blocking_58_uv_random_byte6() { return 0; }
//Provides: luv_stub_blocking_5_luv_null_fs_callback_pointer
function luv_stub_blocking_5_luv_null_fs_callback_pointer() { return 0; }
//Provides: luv_stub_blocking_6_uv_fs_req_cleanup
function luv_stub_blocking_6_uv_fs_req_cleanup() { return 0; }
//Provides: luv_stub_blocking_7_uv_fs_close
function luv_stub_blocking_7_uv_fs_close() { return 0; }
//Provides: luv_stub_blocking_8_uv_fs_open_byte6
function luv_stub_blocking_8_uv_fs_open_byte6() { return 0; }
//Provides: luv_stub_blocking_9_uv_fs_read_byte7
function luv_stub_blocking_9_uv_fs_read_byte7() { return 0; }
// ctypes: enough for the generated luv glue to start up
//Provides: ctypes_string_of_cstring
//Requires: caml_string_of_jsbytes
function ctypes_string_of_cstring(p) { return caml_string_of_jsbytes(typeof p === "string" ? p : ""); }
//Provides: ctypes_cstring_of_string
//Requires: caml_jsbytes_of_string
function ctypes_cstring_of_string(s) { return caml_jsbytes_of_string(s); }
//Provides: ctypes_allocate
function ctypes_allocate(count, size) { return { bytes: new Uint8Array(count * size) }; }
//Provides: ctypes_block_address
function ctypes_block_address(b) { return b; }
//Provides: ctypes_bigarray_address
function ctypes_bigarray_address(b) { return b; }
//Provides: ctypes_bigarray_view
function ctypes_bigarray_view(k, dims, p, t) { return 0; }
//Provides: ctypes_read
function ctypes_read(t, p) { return 0; }
//Provides: ctypes_write
function ctypes_write(t, v, p) { return 0; }
//Provides: ctypes_read_pointer
function ctypes_read_pointer(p) { return 0; }
//Provides: ctypes_write_pointer
function ctypes_write_pointer(v, p) { return 0; }
//Provides: ctypes_memcpy
function ctypes_memcpy(d, s, n) { return 0; }
//Provides: ctypes_caml_roots_create
function ctypes_caml_roots_create(v) { return { v: v }; }
//Provides: ctypes_caml_roots_get
function ctypes_caml_roots_get(r) { return r.v; }
//Provides: ctypes_caml_roots_release
function ctypes_caml_roots_release(r) { return 0; }
// mbedtls flag tables (eval's sys.ssl), read at startup
//Provides: hx_get_ssl_authmode_flags
function hx_get_ssl_authmode_flags(u) { return [0]; }
//Provides: hx_get_ssl_endpoint_flags
function hx_get_ssl_endpoint_flags(u) { return [0]; }
//Provides: hx_get_ssl_preset_flags
function hx_get_ssl_preset_flags(u) { return [0]; }
//Provides: hx_get_ssl_transport_flags
function hx_get_ssl_transport_flags(u) { return [0]; }

// The standard library on demand. When a page sets globalThis.HX_STD before the bundle
// loads, /haxe/std/ is a device that knows the library's file list (its manifest) and
// fetches a file's text the first time the compiler opens it: a synchronous XHR, which a
// Web Worker is allowed. Nothing is embedded in the bundle then.
//   HX_STD = { url: "std/" }                      fetch url + "manifest.json", then files
//   HX_STD = { read: path => text|null, manifest: [paths] }   your own loader (node tests)
//Provides: hx_std_device
//Always
//Requires: jsoo_mount_point, MlFakeDevice, caml_string_of_jsbytes, caml_string_of_jsstring
var hx_std_device = (function () {
  var cfg = globalThis.HX_STD;
  if (!cfg) return null;
  function fetchText(url) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.overrideMimeType("text/plain; charset=x-user-defined"); // bytes, as latin1 chars
    xhr.send(null);
    return xhr.status === 200 ? xhr.responseText : null;
  }
  var read = cfg.read || function (path) { return fetchText(cfg.url + path); };
  var manifest = cfg.manifest || JSON.parse(cfg.url ? fetchText(cfg.url + "manifest.json") : "[]");
  var files = new Set(manifest), dirs = new Set([""]);
  manifest.forEach(function (p) {
    var parts = p.split("/");
    for (var i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
  });
  var missing = new Set();
  var dev = new MlFakeDevice("/haxe/std/", function (root, name) {
    var path = name.c !== undefined ? name.c : String(name); // an OCaml string's bytes
    if (!files.has(path) || missing.has(path)) return 0;
    var text = read(path);
    if (text === null) { missing.add(path); return 0; }
    return [0, caml_string_of_jsbytes(text)];
  });
  var slash = function (n) { return /\/$/.test(n) ? n : n + "/"; };
  dev.is_dir = function (name) { return name === "" || dirs.has(slash(name)) || (this.content[slash(name)] ? 1 : 0); };
  var exists = dev.exists;
  dev.exists = function (name, do_not_lookup) {
    if (name === "" || dirs.has(slash(name))) return 1;
    if (files.has(name) && !missing.has(name)) return 1;
    return exists.call(this, name, do_not_lookup);
  };
  dev.readdir = function (name) {
    var prefix = name === "" ? "" : slash(name), seen = new Set(), out = [];
    manifest.concat(Object.keys(this.content)).forEach(function (p) {
      if (!p.startsWith(prefix) || p === prefix) return;
      var rest = p.slice(prefix.length), cut = rest.indexOf("/");
      var entry = cut < 0 ? rest : rest.slice(0, cut);
      if (entry && !seen.has(entry)) { seen.add(entry); out.push(entry); }
    });
    return out;
  };
  dev.loaded = function () { return Object.keys(this.content).filter(function (k) { return !/\/$/.test(k); }).length; };
  jsoo_mount_point.push({ path: "/haxe/std/", device: dev });
  globalThis.hx_std_loaded = function () { return dev.loaded(); };
  return dev;
})();

// Unix.stat on the in-memory filesystem, which js_of_ocaml leaves out. The compilation
// server stats class-path directories to notice new files, and files for their size.
// Times come from hx_mtimes (hx_write_file stamps what it writes), else 1.
//Provides: hx_fake_stat
//Always
//Requires: MlFakeDevice, caml_raise_no_such_file, caml_int64_of_float, hx_mtimes
var hx_fake_stat = (function () {
  function stat(name, large, raise_unix) {
    if (!this.exists(name)) caml_raise_no_such_file(this.nm(name), raise_unix, "stat");
    var dir = this.is_dir(name) ? true : false, size = 0;
    if (!dir) {
      if (this.lookup) this.lookup(name);
      var f = this.content[name];
      size = f ? f.length() : 0;
    }
    var full = this.nm(name).replace(/\/+$/, "");
    var t = Object.prototype.hasOwnProperty.call(hx_mtimes, full) ? hx_mtimes[full] : 1;
    return [0, 0, 0, dir ? 1 : 0, dir ? 493 : 420, 1, 0, 0, 0, large ? caml_int64_of_float(size) : size, t, t, t];
  }
  MlFakeDevice.prototype.stat = stat;
  MlFakeDevice.prototype.lstat = stat;
  return stat;
})();
