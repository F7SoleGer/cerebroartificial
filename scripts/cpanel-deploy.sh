#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# cpanel-deploy.sh — sobe o site estático para o HostGator via cPanel API
# ════════════════════════════════════════════════════════════════════
# Variáveis obrigatórias (esperadas no ambiente):
#   CPANEL_HOST         ex.: sh00140.hostgator.com.br
#   CPANEL_USERNAME     ex.: frank631
#   CPANEL_API_TOKEN    token gerado em cPanel → Manage API Tokens
#   CPANEL_DEPLOY_DIR   pasta do domínio relativa ao homedir (ex.: ca.franklingmendes.com)
#
# Como executar localmente:
#   export CPANEL_HOST=...
#   export CPANEL_USERNAME=...
#   export CPANEL_API_TOKEN=...
#   export CPANEL_DEPLOY_DIR=...
#   bash scripts/cpanel-deploy.sh
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

: "${CPANEL_HOST:?CPANEL_HOST não definido}"
: "${CPANEL_USERNAME:?CPANEL_USERNAME não definido}"
: "${CPANEL_API_TOKEN:?CPANEL_API_TOKEN não definido}"
: "${CPANEL_DEPLOY_DIR:?CPANEL_DEPLOY_DIR não definido}"

API_BASE="https://${CPANEL_HOST}:2083/execute"
AUTH_HDR="Authorization: cpanel ${CPANEL_USERNAME}:${CPANEL_API_TOKEN}"
REMOTE_ROOT="/${CPANEL_DEPLOY_DIR}"

# Arquivos/diretórios deste site estático que sobem para o servidor
ROOT_FILES=(index.html 404.html .htaccess CNAME)
DIRS=(assets conceito metodo ferramentas aplicacoes produtos cadastro checkout)

# Helper: chama UAPI e falha se status != 1
api() {
  local endpoint="$1"; shift
  local resp
  resp=$(curl -fsS -X POST "${API_BASE}/${endpoint}" -H "$AUTH_HDR" "$@")
  python3 - "$resp" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("status") != 1:
    print("FAIL", json.dumps(data, indent=2)); sys.exit(1)
PY
}

# Cria diretório no servidor (idempotente — ignora "already exists")
mkdir_remote() {
  local path="$1"
  local parent name
  parent="$(dirname "$path")"
  name="$(basename "$path")"
  curl -fsS -X POST "${API_BASE}/Fileman/mkdir" \
    -H "$AUTH_HDR" \
    --data-urlencode "path=${parent}" \
    --data-urlencode "name=${name}" >/dev/null 2>&1 || true
}

# Sobe um arquivo para uma pasta remota
upload_file() {
  local local_path="$1"
  local remote_dir="$2"
  printf '  ↑ %-60s → %s\n' "$local_path" "$remote_dir"
  api "Fileman/upload_files" \
    -F "dir=${remote_dir}" \
    -F "file-1=@${local_path}"
}

echo "── garantindo diretório raiz ${REMOTE_ROOT} ──"
mkdir_remote "${REMOTE_ROOT}"

echo "── arquivos da raiz ──"
for f in "${ROOT_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    upload_file "$f" "${REMOTE_ROOT}"
  fi
done

echo "── árvores de diretórios ──"
for d in "${DIRS[@]}"; do
  [[ -d "$d" ]] || continue
  # cria todos os subdiretórios primeiro (no servidor)
  while IFS= read -r sub; do
    mkdir_remote "${REMOTE_ROOT}/${sub}"
  done < <(find "$d" -type d)
  # depois sobe os arquivos
  while IFS= read -r f; do
    rel_dir="$(dirname "$f")"
    upload_file "$f" "${REMOTE_ROOT}/${rel_dir}"
  done < <(find "$d" -type f)
done

echo "── deploy concluído ──"
