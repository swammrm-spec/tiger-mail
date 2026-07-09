[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [Parameter(Mandatory = $true)]
  [string]$UserName,

  [Parameter(Mandatory = $true)]
  [string]$RemotePath,

  [ValidateSet("pm2", "systemd", "node")]
  [string]$RestartMode = "pm2",

  [string]$Pm2Process = "emailarray-outlook",
  [string]$SystemdService = "emailarray-outlook",
  [string]$SshKeyPath = "",
  [string]$AppUrl = "https://techno-grp--com.w.emailarray.com",
  [string]$ReleaseId = "",
  [switch]$ListOnly,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on this machine."
  }
}

Require-Command "ssh"

if (-not $ListOnly -and -not $Force) {
  throw "Rollback changes the active release. Re-run with -Force to execute, or use -ListOnly to inspect available releases first."
}

$remoteTarget = "$UserName@$HostName"
$sshArgs = @()
if ($SshKeyPath) {
  $sshArgs += @("-i", $SshKeyPath)
}

$listOnlyFlag = if ($ListOnly) { "1" } else { "0" }

function Convert-ToBashSingleQuoted {
  param([string]$Value)
  return ($Value -replace "'", "'\''")
}

$remoteScriptTemplate = @'
set -euo pipefail

REMOTE_PATH='__REMOTE_PATH__'
RESTART_MODE='__RESTART_MODE__'
PM2_PROCESS='__PM2_PROCESS__'
SYSTEMD_SERVICE='__SYSTEMD_SERVICE__'
APP_URL='__APP_URL__'
RELEASE_ID='__RELEASE_ID__'
LIST_ONLY='__LIST_ONLY__'

RELEASES_DIR="\$REMOTE_PATH/releases"
CURRENT_LINK="\$REMOTE_PATH/current"

if [[ ! -d "\$RELEASES_DIR" ]]; then
  echo "ERROR: Releases directory not found: \$RELEASES_DIR"
  exit 1
fi

if command -v readlink >/dev/null 2>&1; then
  CURRENT_TARGET="\$(readlink -f "\$CURRENT_LINK" || true)"
else
  CURRENT_TARGET=""
fi

mapfile -t RELEASES < <(find "\$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)

if [[ \${#RELEASES[@]} -eq 0 ]]; then
  echo "ERROR: No releases were found under \$RELEASES_DIR"
  exit 1
fi

echo "Available releases:"
for RELEASE in "\${RELEASES[@]}"; do
  FULL_PATH="\$RELEASES_DIR/\$RELEASE"
  MARKER=""
  if [[ "\$FULL_PATH" == "\$CURRENT_TARGET" ]]; then
    MARKER=" (current)"
  fi
  echo " - \$RELEASE\$MARKER"
done

if [[ "\$LIST_ONLY" == "1" ]]; then
  exit 0
fi

TARGET_RELEASE=""
if [[ -n "\$RELEASE_ID" ]]; then
  TARGET_RELEASE="\$RELEASE_ID"
else
  for RELEASE in "\${RELEASES[@]}"; do
    FULL_PATH="\$RELEASES_DIR/\$RELEASE"
    if [[ "\$FULL_PATH" != "\$CURRENT_TARGET" ]]; then
      TARGET_RELEASE="\$RELEASE"
      break
    fi
  done
fi

if [[ -z "\$TARGET_RELEASE" ]]; then
  echo "ERROR: Could not determine rollback target."
  exit 1
fi

TARGET_PATH="\$RELEASES_DIR/\$TARGET_RELEASE"
if [[ ! -d "\$TARGET_PATH" ]]; then
  echo "ERROR: Target release not found: \$TARGET_PATH"
  exit 1
fi

if [[ "\$TARGET_PATH" == "\$CURRENT_TARGET" ]]; then
  echo "ERROR: Target release is already active."
  exit 1
fi

ln -sfn "\$TARGET_PATH" "\$CURRENT_LINK"
cd "\$CURRENT_LINK"

case "\$RESTART_MODE" in
  pm2)
    if pm2 describe "\$PM2_PROCESS" >/dev/null 2>&1; then
      pm2 restart "\$PM2_PROCESS" --update-env
    else
      pm2 start server/index.js --name "\$PM2_PROCESS"
    fi
    pm2 save || true
    ;;
  systemd)
    sudo systemctl restart "\$SYSTEMD_SERVICE"
    sudo systemctl status "\$SYSTEMD_SERVICE" --no-pager -l || true
    ;;
  node)
    pkill -f "node server/index.js" || true
    nohup npm start > app.log 2>&1 &
    sleep 3
    ;;
  *)
    echo "Unsupported restart mode: \$RESTART_MODE"
    exit 1
    ;;
esac

echo ""
echo "Rollback completed."
echo "Active release: \$TARGET_RELEASE"
echo "Current symlink: \$CURRENT_LINK -> \$TARGET_PATH"

if command -v curl >/dev/null 2>&1; then
  echo ""
  echo "Post-rollback HTTP check:"
  curl -fsS "\${APP_URL%/}/api/health" || true
  echo ""
fi
'@

$remoteScript = $remoteScriptTemplate.
  Replace("__REMOTE_PATH__", (Convert-ToBashSingleQuoted $RemotePath)).
  Replace("__RESTART_MODE__", (Convert-ToBashSingleQuoted $RestartMode)).
  Replace("__PM2_PROCESS__", (Convert-ToBashSingleQuoted $Pm2Process)).
  Replace("__SYSTEMD_SERVICE__", (Convert-ToBashSingleQuoted $SystemdService)).
  Replace("__APP_URL__", (Convert-ToBashSingleQuoted $AppUrl)).
  Replace("__RELEASE_ID__", (Convert-ToBashSingleQuoted $ReleaseId)).
  Replace("__LIST_ONLY__", (Convert-ToBashSingleQuoted $listOnlyFlag))

Write-Host "Connecting to $remoteTarget ..."
& ssh @sshArgs $remoteTarget $remoteScript
