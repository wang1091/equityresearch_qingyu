#!/usr/bin/env bash

set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_HOST="${DEPLOY_HOST:-ubuntu@98.83.226.138}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/smartnews_sri.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/Equity-Research-new}"
PM2_APP="${PM2_APP:-EquityResearch-backend-new}"
PUSH_LOCAL=false

usage() {
  cat <<EOF
Usage: ./deploy.sh [options]

Deploy a git branch to the Equity Research EC2 app.

Options:
  --branch <name>       Branch to deploy (default: ${BRANCH})
  --push                Push the current local branch before deploying
  --host <user@host>    SSH host (default: ${DEPLOY_HOST})
  --key <path>          SSH private key path (default: ${DEPLOY_KEY})
  --remote-dir <path>   App directory on EC2 (default: ${REMOTE_DIR})
  --pm2-app <name>      PM2 process name (default: ${PM2_APP})
  -h, --help            Show this help

Examples:
  ./deploy.sh
  ./deploy.sh --push
  ./deploy.sh --branch feature/rumor-check-api-integration --push
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --push)
      PUSH_LOCAL=true
      shift
      ;;
    --host)
      DEPLOY_HOST="$2"
      shift 2
      ;;
    --key)
      DEPLOY_KEY="$2"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --pm2-app)
      PM2_APP="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "Error: run this script inside the git repository." >&2
  exit 1
fi

cd "${REPO_ROOT}"

if [[ ! -f "${DEPLOY_KEY}" ]]; then
  echo "Error: SSH key not found at ${DEPLOY_KEY}" >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

if [[ "${PUSH_LOCAL}" == "true" ]]; then
  if [[ "${CURRENT_BRANCH}" != "${BRANCH}" ]]; then
    echo "Error: current branch is '${CURRENT_BRANCH}', but --branch is '${BRANCH}'." >&2
    echo "Checkout '${BRANCH}' first, or omit --push." >&2
    exit 1
  fi

  echo "Pushing '${BRANCH}' to origin..."
  git push origin "${BRANCH}"
fi

echo "Deploying branch '${BRANCH}' to ${DEPLOY_HOST}"
echo "Remote dir: ${REMOTE_DIR}"
echo "PM2 app: ${PM2_APP}"

ssh -i "${DEPLOY_KEY}" "${DEPLOY_HOST}" \
  "BRANCH='${BRANCH}' REMOTE_DIR='${REMOTE_DIR}' PM2_APP='${PM2_APP}' bash -s" <<'EOF'
set -euo pipefail

cd "${REMOTE_DIR}"

# Machine-local secrets/config, preserved across git reset --hard (gitignored).
# The app reads a single .env (server/index.ts); legacy layered files are no
# longer read, so they are not preserved here.
ENV_FILES=(
  .env
  python-services/performance/.env
  python-services/valuation/.env
)

ENV_BACKUP="$(mktemp -d)"
cleanup_env_backup() { rm -rf "${ENV_BACKUP}"; }
trap cleanup_env_backup EXIT

for f in "${ENV_FILES[@]}"; do
  if [[ -f "${f}" ]]; then
    mkdir -p "${ENV_BACKUP}/$(dirname "${f}")"
    cp -a "${f}" "${ENV_BACKUP}/${f}"
  fi
done

git fetch origin "${BRANCH}"

if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git checkout "${BRANCH}"
else
  git checkout -b "${BRANCH}" "origin/${BRANCH}"
fi

# Match origin exactly (avoids pull failing when the server has stray local edits).
git reset --hard "origin/${BRANCH}"

for f in "${ENV_FILES[@]}"; do
  if [[ -f "${ENV_BACKUP}/${f}" ]]; then
    mkdir -p "$(dirname "${f}")"
    cp -a "${ENV_BACKUP}/${f}" "${f}"
  fi
done

# The app reads ONLY .env. If it is missing the process boots with no secrets /
# upstream config — warn loudly (legacy .env.*.local are no longer read).
if [[ ! -f .env ]]; then
  echo "⚠️  WARNING: no .env in ${REMOTE_DIR} — the app reads ONLY .env now." >&2
  echo "⚠️  Create it (cp .env.example .env, fill secrets) before this restart, or the app starts unconfigured." >&2
fi

npm install
npm run build
if sudo pm2 describe "${PM2_APP}" >/dev/null 2>&1; then
  sudo pm2 restart "${PM2_APP}"
else
  sudo pm2 start ecosystem.config.cjs
  sudo pm2 save
fi
sudo pm2 status "${PM2_APP}"
EOF

echo "Deployment complete."
