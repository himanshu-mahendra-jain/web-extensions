#!/usr/bin/env bash
set -euo pipefail

# Usage: ./check.sh [extension-directory ...]
# Builds the extensions, checks their changelogs, lints their Firefox
# packages and runs their tests, for the commit that is checked out.
# Without arguments, every directory next to this script that contains
# manifest.json is checked. The Firefox for Android tests run on the
# device FIREFOX_ANDROID_DEVICE names, or on arc:5555 when it is
# connected; see test-support/android-device.js.

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHROMIUM_MANIFEST="manifest.json"
FIREFOX_MANIFEST="manifest-firefox.json"
DIST_DIR="dist"

cd "$REPO_ROOT"

for command in node npx web-ext unzip; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Error: $command is not installed."
        exit 1
    fi
done

# A result belongs to a commit only when nothing else is in the tree.
if [ -n "$(git status --porcelain)" ]; then
    echo "Error: commit or remove these changes first:"
    echo
    git status --short
    exit 1
fi

commit=$(git rev-parse HEAD)

if [ "$#" -gt 0 ]; then
    extensions=()
    for extension in "$@"; do
        extension="${extension%/}"
        if [ ! -f "$extension/$CHROMIUM_MANIFEST" ]; then
            echo "Error: $extension is not an extension directory in $REPO_ROOT."
            exit 1
        fi
        extensions+=("$extension")
    done
else
    extensions=()
    for manifest in */"$CHROMIUM_MANIFEST"; do
        if [ -f "$manifest" ]; then
            extensions+=("$(dirname "$manifest")")
        fi
    done
fi

echo "== Build"
echo
./build.sh "${extensions[@]}"

echo "== Changelogs"
echo
for extension in "${extensions[@]}"; do
    ./release-notes.sh "$extension" >/dev/null
    echo "  $extension"
done
echo

# Each package calls only its browser's namespace, through extension-api.js.
echo "== Namespaces"
echo
for extension in "${extensions[@]}"; do
    if [ ! -f "$extension/$FIREFOX_MANIFEST" ]; then
        continue
    fi

    for package in "$extension/$DIST_DIR"/*.zip; do
        case "$package" in
            *-firefox-v*) own="browser" other="chrome" ;;
            *) own="chrome" other="browser" ;;
        esac

        if ! unzip -p "$package" src/extension-api.js | grep -qx "globalThis.extensionApi = $own;"; then
            echo "Error: $package's src/extension-api.js does not name $own."
            exit 1
        fi
        if unzip -p "$package" '*.js' | grep -nE "\\b$other\\.[A-Za-z]"; then
            echo "Error: $package calls $other.*, another browser's namespace."
            exit 1
        fi
        echo "  $package"
    done
done
echo

echo "== Lint"
echo
for extension in "${extensions[@]}"; do
    # Extensions without a Firefox manifest have no Firefox package.
    if [ ! -f "$extension/$FIREFOX_MANIFEST" ]; then
        continue
    fi

    packages=("$extension/$DIST_DIR"/*-firefox-v*.zip)
    if [ "${#packages[@]}" -ne 1 ] || [ ! -f "${packages[0]}" ]; then
        echo "Error: expected one Firefox package in $extension/$DIST_DIR."
        exit 1
    fi
    echo "  ${packages[0]}"
    # web-ext exits non-zero on errors; lint-report.js decides from the report.
    if ! { web-ext lint --source-dir "${packages[0]}" --output json || true; } \
        | node test-support/lint-report.js; then
        echo
        echo "Error: web-ext lint reported a problem."
        exit 1
    fi
done
echo

echo "== Tests"
echo
# Resolve the device once, so the tests and the closing line agree.
FIREFOX_ANDROID_DEVICE=$(node --input-type=module -e '
    import { androidDevice } from "./test-support/android-device.js";
    process.stdout.write(androidDevice());
')
export FIREFOX_ANDROID_DEVICE
if [ "$#" -gt 0 ]; then
    npx playwright test "${extensions[@]}"
else
    npx playwright test
fi
echo

# The tests write only ignored files, so a change now came from elsewhere.
if [ "$(git rev-parse HEAD)" != "$commit" ] || [ -n "$(git status --porcelain)" ]; then
    echo "Error: the tree changed during the check, so the result belongs to no commit."
    exit 1
fi

echo "Checked $(git log -1 --format='%h %s' "$commit")"
if [ -n "$FIREFOX_ANDROID_DEVICE" ]; then
    echo "Firefox for Android was tested on $FIREFOX_ANDROID_DEVICE."
else
    echo "Firefox for Android was not tested: FIREFOX_ANDROID_DEVICE is not set and arc:5555 is not connected."
fi
