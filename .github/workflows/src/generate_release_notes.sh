#!/usr/bin/env bash
set -euo pipefail

RELEASE_NOTES_URL="https://raw.githubusercontent.com/zen-browser/www/refs/heads/main/src/release-notes/stable.json"

printf '%s\n' "Fetching release notes from GitHub..."
RELEASE_NOTES_JSON=$(curl -fsSL --retry 5 --retry-delay 5 "$RELEASE_NOTES_URL")
if [ -z "$RELEASE_NOTES_JSON" ]; then
  echo "Error: Failed to fetch release notes from GitHub" >&2
  exit 1
fi

LATEST_RELEASE=$(echo "$RELEASE_NOTES_JSON" | jq -r 'last')
EXTRA_NOTES=$(echo "$LATEST_RELEASE" | jq -r '.extra // ""')

{
  echo "# Trance Release"
  echo "$EXTRA_NOTES"

  if echo "$LATEST_RELEASE" | jq -e '.security != null and .security != ""' >/dev/null; then
    echo
    echo "## Security"
    echo "$LATEST_RELEASE" | jq -r 'if (.security | type) == "string" then "- " + .security else .security[] | "- " + . end'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.features // []) | length > 0' >/dev/null; then
    echo
    echo "## New Features"
    echo "$LATEST_RELEASE" | jq -r '.features[] | "- " + .'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.fixes // []) | length > 0' >/dev/null; then
    echo
    echo "## Fixes"
    echo "$LATEST_RELEASE" | jq -r '.fixes[] | if type == "object" then "- " + .description + " ([#" + (.issue|tostring) + "](https://github.com/xslvrrr/Trance/issues/" + (.issue|tostring) + "))" else "- " + . end'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.breakingChanges // []) | length > 0' >/dev/null; then
    echo
    echo "## Breaking Changes"
    echo "$LATEST_RELEASE" | jq -r '.breakingChanges[] | if type == "string" then "- " + . else "- " + .description + " [Learn more](" + .link + ")" end'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.themeChanges // []) | length > 0' >/dev/null; then
    echo
    echo "## Theme Changes"
    echo "$LATEST_RELEASE" | jq -r '.themeChanges[] | "- " + .'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.changes // []) | length > 0' >/dev/null; then
    echo
    echo "## Changes"
    echo "$LATEST_RELEASE" | jq -r '.changes[] | "- " + .'
  fi

  if echo "$LATEST_RELEASE" | jq -e '(.knownIssues // []) | length > 0' >/dev/null; then
    echo
    echo "## Known Issues"
    echo "$LATEST_RELEASE" | jq -r '.knownIssues[] | "- " + .'
  fi
} > release_notes.md

echo "Release notes generated: release_notes.md"
