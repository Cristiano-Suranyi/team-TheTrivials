#!/bin/bash
# End-to-end test of the extension flow against the real backend + Gemini.
cd "$(dirname "$0")/.."
LOG=/tmp/hidden_e2e_log.txt
ORIGIN="chrome-extension://lfnbhbifaakkolphooipdoinpknmacnf"
API=http://127.0.0.1:8787
{
echo "=== $(date) ==="
python3 run_app.py > /tmp/hidden_e2e_server.txt 2>&1 &
SERVER=$!
for i in $(seq 1 90); do curl -s $API/api/health >/dev/null && break; sleep 1; done
echo "health: $(curl -s -H "Origin: $ORIGIN" $API/api/health)"
echo "--- step 2: upload"
RESP=$(curl -s -H "Origin: $ORIGIN" -F "file=@raw_data/document_to_anonymize.pdf;type=application/pdf" $API/api/public/sessions/upload)
echo "$RESP" | head -c 300; echo
SID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
echo "--- step 3: poll $SID"
for i in $(seq 1 120); do
  S=$(curl -s -H "Origin: $ORIGIN" $API/api/public/sessions/$SID | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'],d['progress'],d['stage'],d.get('error',''))")
  echo "$S"; case "$S" in ready*|failed*) break;; esac; sleep 2
done
echo "--- step 5a: masked.pdf"
curl -s -H "Origin: $ORIGIN" -o /tmp/hidden_e2e_masked.pdf -w "HTTP %{http_code} %{content_type} %{size_download} bytes\n" $API/api/public/sessions/$SID/masked.pdf
echo "--- step 5b: review page"
curl -s -o /dev/null -w "HTTP %{http_code}\n" $API/review/$SID
echo "--- step 7: export with review choices, no file"
curl -s $API/api/public/sessions/$SID > /tmp/hidden_e2e_session.json
python3 - <<'P' > /tmp/hidden_e2e_review.json
import json
d=json.load(open('/tmp/hidden_e2e_session.json'))
print(json.dumps({'lines':[[{'text':t['text'],'masked':bool(t.get('category'))} for t in line] for line in d['lines']]}))
P
curl -s -F "review=</tmp/hidden_e2e_review.json" -o /tmp/hidden_e2e_final.pdf -w "HTTP %{http_code} %{content_type} %{size_download} bytes\n" $API/api/public/sessions/$SID/export/pdf
pkill -f "run_app.py" ; sleep 1
echo "EXIT=done"
} 2>&1 | tee "$LOG"
