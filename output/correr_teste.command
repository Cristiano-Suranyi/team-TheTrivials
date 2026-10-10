#!/bin/bash
cd "$(dirname "$0")/.."
LOG=output/run_log.txt
{
  echo "=== $(date) ==="
  python3 submission/anonymize.py
  echo "EXIT=$?"
} 2>&1 | tee "$LOG"
echo "Concluído. Podes fechar esta janela."
