#!/usr/bin/env bash
# Runs the native auditor on each fixture and compares grade + findings with expected.json,
# which is produced by the web audit (web/src/lib/audit.ts).
set -euo pipefail
cd "$(dirname "$0")"
BIN=${1:-../target/release/oath-audit}
fail=0
for f in broken first insolvent kept noalloc nobond selfpay; do
  "$BIN" < "$f.json" > "/tmp/oath-audit-$f.json"
  python3 - "$f" <<'PY' || fail=1
import json, sys
f = sys.argv[1]
o = json.load(open(f"/tmp/oath-audit-{f}.json"))
e = json.load(open("expected.json"))[f + ".json"]
got = {"grade": o["grade"], "findings": [x["id"] + ":" + x["severity"] for x in o["findings"]]}
print(f, "match" if got == e else f"DIFF {got} != {e}")
sys.exit(0 if got == e else 1)
PY
done
exit $fail
