#!/bin/bash
# Usage: sudo bash activate-release.sh VERSION ARCHIVE SHA256
# Optional: WEBDESK_PRUNE_RELEASES=1 removes old releases after successful activation.
set -Eeuo pipefail
version=${1:?version required}
archive=${2:?archive required}
digest=${3:?sha256 required}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$digest" =~ ^[0-9a-f]{64}$ ]]
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check
[[ -d /opt/webdesk/releases && ! -L /opt/webdesk/releases ]]
id webdesk > /dev/null
exec 9>/opt/webdesk/release.lock
flock -n 9
previous=''
if [[ -e /opt/webdesk/current ]]; then
  previous=$(readlink -f /opt/webdesk/current)
  [[ -d "$previous" && "$(dirname "$previous")" == /opt/webdesk/releases ]]
fi
release=$(mktemp -d "/opt/webdesk/releases/${version}-XXXXXX")
activated=0
activate() {
  ln -s "$1" /opt/webdesk/current.next
  mv -Tf /opt/webdesk/current.next /opt/webdesk/current
  systemctl restart webdesk
}
on_error() {
  local status=$?
  trap - ERR
  if [[ "$activated" == 1 && -n "$previous" ]]; then
    activate "$previous" || echo 'Restore failed; inspect systemctl status webdesk' >&2
  elif [[ "$activated" == 1 ]]; then
    systemctl stop webdesk || true
    rm -f -- /opt/webdesk/current
  fi
  echo "Deployment failed; staged files retained for inspection: $release" >&2
  exit "$status"
}
trap on_error ERR
chmod 755 "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
cd "$release"
node --check server/index.mjs
node --check server/billd/signaling.mjs
node -e 'if(JSON.parse(require("fs").readFileSync("package.json")).version!==process.argv[1])process.exit(1)' "$version"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
chown -R root:webdesk "$release"
activated=1
activate "$release"
curl --fail --silent --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:4300/health |
  node -e 'let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>{const h=JSON.parse(text);if(h.status!=="ok"||h.version!==process.argv[1])process.exit(1);console.log(text)})' "$version"
systemctl is-active webdesk
trap - ERR
if [[ "${WEBDESK_PRUNE_RELEASES:-0}" == 1 ]]; then
  while IFS= read -r -d '' obsolete; do
    [[ "$obsolete" == "$release" ]] && continue
    [[ ! -L "$obsolete" && "$(realpath -m "$obsolete")" == "$obsolete" && "$(dirname "$obsolete")" == /opt/webdesk/releases ]]
    rm -rf -- "$obsolete"
  done < <(find /opt/webdesk/releases -mindepth 1 -maxdepth 1 -type d -print0)
fi
echo "DEPLOYED=$version RELEASE=$release"
