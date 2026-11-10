#!/usr/bin/env bash
set -euo pipefail
# Never leave the QA root installed, including on build failure. Run only in a disposable QA checkout.
[[ "${NATIVE_SMOKE_QA:-}" == 1 ]] || { echo 'NATIVE_SMOKE_QA=1 required'; exit 2; }
[[ -f index.ts && ! -e qa/.index-backup ]] || exit 2
cp index.ts qa/.index-backup
restore() { cp qa/.index-backup index.ts; rm -f qa/.index-backup; }
trap restore EXIT INT TERM
printf "import './qa/entry';\n" > index.ts
node scripts/native-generate-pdf.mjs
"$@"
