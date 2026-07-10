#!/usr/bin/env bash
# cli.sh — Universal Browser Remote Control CLI
# Wraps curl calls to the bridge server for easy command-line control.
#
# Usage:
#   ./cli.sh ping
#   ./cli.sh list-tabs [chrome|firefox]
#   ./cli.sh switch-tab <id> [chrome|firefox]
#   ./cli.sh open-tab <url> [chrome|firefox]
#   ./cli.sh close-tab <id> [chrome|firefox]
#   ./cli.sh navigate <url> [chrome|firefox]
#   ./cli.sh go-back [chrome|firefox]
#   ./cli.sh go-forward [chrome|firefox]
#   ./cli.sh refresh [chrome|firefox]
#   ./cli.sh scroll <direction> [amount] [chrome|firefox]
#   ./cli.sh get-text [chrome|firefox]
#   ./cli.sh get-url [chrome|firefox]
#   ./cli.sh get-title [chrome|firefox]
#   ./cli.sh check-login [chrome|firefox]
#   ./cli.sh extract-jobs [chrome|firefox]
#   ./cli.sh eval-js <code> [chrome|firefox]
#   ./cli.sh page-info [chrome|firefox]
#   ./cli.sh status

set -euo pipefail

BRIDGE="${BRIDGE_URL:-http://127.0.0.1:18923}"
TIMEOUT=15

# ── Helpers ──────────────────────────────────────────────────────────

post_cmd() {
  local browser="$1"
  local action="$2"
  shift 2
  local extra="{}"

  # Build extra params from remaining args
  if [ $# -gt 0 ]; then
    local pairs=()
    while [ $# -gt 0 ]; do
      local key="$1"
      local val="$2"
      # Remove surrounding quotes if present
      val="${val#\"}"
      val="${val%\"}"
      val="${val#\'}"
      val="${val%\'}"
      pairs+=("\"$key\":\"$val\"")
      shift 2
    done
    extra="{$(IFS=,; echo "${pairs[*]}")}"
  fi

  local payload="{\"action\":\"$action\",\"browser\":\"$browser\"}"
  # Merge extra fields (simple string replacement for top-level keys)
  if [ "$extra" != "{}" ]; then
    payload="{\"action\":\"$action\",\"browser\":\"$browser\"$(echo "$extra" | sed 's/^{//;s/}$//' | sed 's/^/,/')}"
  fi

  # Send command
  curl -s -X POST "$BRIDGE/cmd?browser=$browser" \
    -H 'Content-Type: application/json' \
    -d "$payload" > /dev/null

  # Poll for result (up to TIMEOUT seconds)
  local elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    sleep 0.5
    elapsed=$((elapsed + 1))
    local result
    result=$(curl -s "$BRIDGE/result?browser=$browser")
    if echo "$result" | grep -q '"waiting":true'; then
      continue
    fi
    echo "$result" | python3 -m json.tool 2>/dev/null || echo "$result"
    return 0
  done

  echo '{"error": "timeout waiting for response"}'
  return 1
}

# ── Commands ─────────────────────────────────────────────────────────

ACTION="${1:-help}"
shift 2>/dev/null || true

case "$ACTION" in

  ping)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "ping"
    ;;

  list-tabs|list_tabs)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "list_tabs"
    ;;

  switch-tab|switch_tab)
    TAB_ID="${1:?Usage: cli.sh switch-tab <id> [browser]}"
    BROWSER="${2:-chrome}"
    post_cmd "$BROWSER" "switch_tab" "id" "$TAB_ID"
    ;;

  open-tab|open_tab)
    URL="${1:?Usage: cli.sh open-tab <url> [browser]}"
    BROWSER="${2:-chrome}"
    post_cmd "$BROWSER" "open_tab" "url" "$URL"
    ;;

  close-tab|close_tab)
    TAB_ID="${1:?Usage: cli.sh close-tab <id> [browser]}"
    BROWSER="${2:-chrome}"
    post_cmd "$BROWSER" "close_tab" "id" "$TAB_ID"
    ;;

  navigate)
    URL="${1:?Usage: cli.sh navigate <url> [browser]}"
    BROWSER="${2:-chrome}"
    post_cmd "$BROWSER" "navigate" "url" "$URL"
    ;;

  go-back|go_back)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "go_back"
    ;;

  go-forward|go_forward)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "go_forward"
    ;;

  refresh)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "refresh"
    ;;

  scroll)
    DIR="${1:?Usage: cli.sh scroll <down|up|left|right> [amount] [browser]}"
    AMOUNT="${2:-500}"
    # Check if 3rd arg is a number (amount) or browser name
    if [[ "$AMOUNT" =~ ^[0-9]+$ ]]; then
      BROWSER="${3:-chrome}"
    else
      BROWSER="$AMOUNT"
      AMOUNT=500
    fi
    post_cmd "$BROWSER" "scroll" "direction" "$DIR" "amount" "$AMOUNT"
    ;;

  get-text|get_text)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "get_text"
    ;;

  get-url|get_url)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "get_url"
    ;;

  get-title|get_title)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "get_title"
    ;;

  check-login|check_login)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "check_login"
    ;;

  extract-jobs|extract_jobs)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "extract_jobs"
    ;;

  eval-js|eval_js)
    CODE="${1:?Usage: cli.sh eval-js <code> [browser]}"
    BROWSER="${2:-chrome}"
    post_cmd "$BROWSER" "eval_js" "code" "$CODE"
    ;;

  page-info|page_info)
    BROWSER="${1:-chrome}"
    post_cmd "$BROWSER" "page_info"
    ;;

  status)
    curl -s "$BRIDGE/status" | python3 -m json.tool 2>/dev/null || curl -s "$BRIDGE/status"
    ;;

  help|--help|-h)
    cat <<'EOF'
Universal Browser Remote Control CLI

Usage: ./cli.sh <command> [args...]

Tab Management:
  list-tabs [browser]                    List all tabs
  switch-tab <id> [browser]              Switch to tab by ID
  open-tab <url> [browser]               Open URL in new tab
  close-tab <id> [browser]               Close tab by ID

Navigation:
  navigate <url> [browser]               Navigate active tab to URL
  go-back [browser]                      Go back in history
  go-forward [browser]                   Go forward in history
  refresh [browser]                      Refresh current page

Page Interaction:
  scroll <direction> [amount] [browser]  Scroll (down/up/left/right)
  get-text [browser]                     Get full page text
  get-url [browser]                      Get current URL
  get-title [browser]                    Get page title
  check-login [browser]                  Check BOSS直聘 login status

Content Extraction:
  extract-jobs [browser]                 Extract BOSS直聘 job cards
  eval-js <code> [browser]               Execute JavaScript in page
  page-info [browser]                    Get page info summary

System:
  ping [browser]                         Health check
  status                                 Bridge server status

Browser can be: chrome (default), firefox

Environment:
  BRIDGE_URL    Override bridge URL (default: http://127.0.0.1:18923)

Examples:
  ./cli.sh navigate "https://www.zhipin.com"
  ./cli.sh list-tabs firefox
  ./cli.sh scroll down 800
  ./cli.sh extract-jobs
  ./cli.sh eval-js "document.querySelectorAll('a').length"
EOF
    ;;

  *)
    echo "Unknown command: $ACTION"
    echo "Run './cli.sh help' for usage."
    exit 1
    ;;
esac
