class Hello {
	static function main() {
		var xs = [for (i in 0...5) i * i];
		trace('hello from a compiler in the browser: ${xs.join(",")}');
		var m = new Map<String, Int>();
		m.set("a", 1);
		trace(m.exists("a"), Std.string(Math.PI).substr(0, 4));
	}
}
