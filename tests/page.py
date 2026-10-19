#!/usr/bin/env python3
"""
Runs play.html's own test (?test) headless and prints its report: serves web/ on PORT,
opens play.html?test in a throwaway browser profile, waits for the report the page POSTs,
then stops the browser and the server (by PID).

    python3 tests/page.py brave [PORT]      Brave (/opt/brave.com/brave/brave, not the
                                            brave-browser wrapper, so the kill reaches it)
    python3 tests/page.py firefox [PORT]

Exits 1 if a step fails, the test stopped on an error, or no report came.
"""
import json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), "web")
BROWSERS = {
    "brave": lambda profile, url: ["/opt/brave.com/brave/brave", "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={profile}", url],
    "firefox": lambda profile, url: ["firefox", "--headless", "--new-instance", "--profile", profile, url],
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in BROWSERS:
        sys.exit(__doc__)
    browser, port = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "8790"
    work = tempfile.mkdtemp(prefix="haxe-page-test-")
    report = os.path.join(work, "report.json")
    server = subprocess.Popen([sys.executable, os.path.join(WEB, "serve.py"), port, report], stdout=subprocess.DEVNULL)
    time.sleep(1)
    profile = os.path.join(work, "profile")
    os.makedirs(profile)
    b = subprocess.Popen(BROWSERS[browser](profile, f"http://127.0.0.1:{port}/play.html?test"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(360):
            if os.path.exists(report) and os.path.getsize(report):
                break
            time.sleep(0.5)
        time.sleep(0.3)
        if not os.path.exists(report):
            print("no report (the page didn't finish in 3 minutes)")
            return 1
        r = json.load(open(report))
    finally:
        b.kill(); server.kill(); b.wait(); server.wait()
        shutil.rmtree(work, ignore_errors=True)
    for s in r["steps"]:
        detail = "" if s.get("detail") is None else "  " + json.dumps(s["detail"], ensure_ascii=False)[:240]
        print(("  ok   " if s["ok"] else "  FAIL ") + s["name"] + detail)
    if r.get("error"):
        print("  ERROR", r["error"])
    print("  all ok" if r["ok"] else "  NOT ok", f"({r.get('ms')} ms; reload builds {r.get('reloadMs')} ms; folder opened in {r.get('folderOpenMs')} ms)")
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
