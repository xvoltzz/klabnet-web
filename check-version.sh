#!/bin/sh
# Every css/js URL in index.html must carry ?v=<KLABNET_VERSION>.
#
# There is no build step here, so both the const and the query strings are
# hand-edited literals and it is very easy to bump one and not the other.
# The failure mode is nasty and silent: index.html is never cached, so a
# deploy ships new markup immediately, but the ?v= URLs are unchanged and
# therefore still cache hits -- new HTML wired to old behaviour. That is
# what "the new chat rail renders but clicking a person still starts a
# listening party" was, and only Ctrl+Shift+R cleared it.
#
# Run before every deploy: ./check-version.sh
set -e
cd "$(dirname "$0")"
VER=$(sed -n "s/.*KLABNET_VERSION = '\([^']*\)'.*/\1/p" index.html)
[ -n "$VER" ] || { echo "FAIL: no KLABNET_VERSION in index.html"; exit 1; }
BAD=$(grep -o '?v=[^"]*' index.html | grep -v "^?v=$VER$" || true)
if [ -n "$BAD" ]; then
  echo "FAIL: asset URLs disagree with KLABNET_VERSION ($VER):"
  echo "$BAD" | sort -u | sed 's/^/  /'
  exit 1
fi
N=$(grep -c "?v=$VER" index.html)
echo "OK: $VER on all $N asset URLs"
