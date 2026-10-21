// What stubs.wat asks of JavaScript, for the wasm build: wasm_of_ocaml links these in as
// its "js" imports. Strings come and go as JS strings of their bytes (latin1), paths as
// text. In a worker the filesystem is web/hxfs.js's (globalThis.hx_fs); in node, the disk.

// never called: wasm_of_ocaml drops a Callback.register whose name no runtime file looks
// up, and finds the lookups by this text in its JavaScript files (stubs.wat's own lookup
// isn't seen), so this keeps the resident compiler's registration
//Provides: hx_w_named_values
function hx_w_named_values() { return caml_named_value("haxe_resident_request"); }

// the resident compiler's request function, as hx_request(hxml) -> reply (latin1 both)
//Provides: hx_w_expose
function hx_w_expose(request) {
  globalThis.hx_request = function (hxml) {
    var reply = request(hxml);
    if (reply === null) throw new Error("no resident compiler: start it with --wait stdio and HAXE_RESIDENT=1");
    return reply;
  };
}
//Provides: hx_w_now
function hx_w_now() { return Date.now() / 1000; }
//Provides: hx_w_filetime
function hx_w_filetime(path) {
  if (globalThis.hx_fs) return globalThis.hx_fs.mtime(path);
  try { return globalThis.require("node:fs").statSync(path).mtimeMs / 1000; } catch (e) { return 1; }
}
//Provides: hx_w_full_path
function hx_w_full_path(p) {
  var cwd = globalThis.process && globalThis.process.cwd ? globalThis.process.cwd() : "/";
  var out = [];
  (p.charAt(0) === "/" ? p : cwd.replace(/\/+$/, "") + "/" + p).split("/").forEach(function (seg) {
    if (seg === "" || seg === ".") return;
    if (seg === "..") out.pop(); else out.push(seg);
  });
  return "/" + out.join("/");
}

// sha1, in plain JS (a worker has no synchronous digest)
//Provides: hx_w_sha1_init
function hx_w_sha1_init() { return { parts: [] }; }
//Provides: hx_w_sha1_update
function hx_w_sha1_update(ctx, s) { ctx.parts.push(s); }
//Provides: hx_w_sha1_final
function hx_w_sha1_final(ctx) {
  var bytes = ctx.parts.join(""), n = bytes.length, words = [];
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
//Provides: hx_w_hex
function hx_w_hex(b) {
  var out = "";
  for (var i = 0; i < b.length; i++) out += (b.charCodeAt(i) + 256).toString(16).substr(1);
  return out;
}

// pcre2 on RegExp: a compiled pattern is {re, groups, error}
//Provides: hx_w_regexp
function hx_w_regexp(src, f) {
  var flags = "gd";
  if (f & 0x8) flags += "i";          // PCRE2_CASELESS
  if (f & 0x400) flags += "m";        // PCRE2_MULTILINE
  if (f & 0x20) flags += "s";         // PCRE2_DOTALL
  var re;
  try { re = new RegExp(src, flags); } catch (e) { return { error: "pcre2 (RegExp): " + e.message + " in /" + src + "/" }; }
  var groups = 0;
  try { groups = new RegExp(src + "|").exec("").length - 1; } catch (e) {}
  return { re: re, groups: groups, error: null };
}
//Provides: hx_w_regexp_error
function hx_w_regexp_error(r) { return r.error; }
//Provides: hx_w_regexp_groups
function hx_w_regexp_groups(r) { return r.groups; }
// a match from pos: each group's start and end in one array (-1 for one that didn't take part), or null
//Provides: hx_w_regexp_exec
function hx_w_regexp_exec(r, s, pos) {
  r.re.lastIndex = pos;
  var m = r.re.exec(s);
  if (m === null) return null;
  var out = [];
  for (var i = 0; i <= r.groups; i++) {
    var ix = m.indices[i];
    out.push(ix ? ix[0] : -1, ix ? ix[1] : -1);
  }
  return out;
}
//Provides: hx_w_index
function hx_w_index(a, i) { return a[i]; }
