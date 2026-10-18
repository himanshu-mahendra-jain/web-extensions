#!/usr/bin/env bash
set -euo pipefail

# Usage: ./release-notes.sh <extension-directory>
# Prints the section of the extension's CHANGELOG.md headed
# "## [<version>] - <date>" (or "## [<version>]"), where <version> is the
# version in its manifest.json. Fails when the changelog or that section
# is missing or empty.

CHROMIUM_MANIFEST="manifest.json"
CHANGELOG="CHANGELOG.md"

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <extension-directory>" >&2
    exit 1
fi

extension="${1%/}"

if [ ! -f "$extension/$CHROMIUM_MANIFEST" ]; then
    echo "Error: $extension/$CHROMIUM_MANIFEST not found." >&2
    exit 1
fi

version=$(
    sed -n \
        's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$extension/$CHROMIUM_MANIFEST" \
        | head -n 1
)

if [ -z "$version" ]; then
    echo "Error: could not read the version from $extension/$CHROMIUM_MANIFEST." >&2
    exit 1
fi

if [ ! -f "$extension/$CHANGELOG" ]; then
    echo "Error: $extension/$CHANGELOG not found." >&2
    exit 1
fi

# Collect the lines between the version's heading and the next "## " heading.
# sed drops the leading blank lines; $(...) drops the trailing ones.
notes=$(
    awk -v heading="## [$version]" '
        $0 == heading || index($0, heading " - ") == 1 { found = 1; next }
        found && /^## / { exit }
        found { print }
    ' "$extension/$CHANGELOG" \
        | sed -e '/./,$!d'
)

if [ -z "$notes" ]; then
    echo "Error: $extension/$CHANGELOG has no entries under \"## [$version]\"." >&2
    exit 1
fi

printf '%s\n' "$notes"
