#!/usr/bin/env bash
set -euo pipefail

# Usage: .github/draft-releases.sh
# Run by .github/workflows/draft-releases.yml after each push to main.
# For every extension whose manifest.json version has no tag
# <extension-directory>-v<version> yet, replaces the extension's draft
# releases with one draft for that version: its packages, and its
# CHANGELOG.md section as the notes. Publishing a draft creates its tag,
# so later runs leave that version alone. Needs gh, logged in through
# GH_TOKEN, and GITHUB_SHA, the commit the drafts point at. Errors are
# GitHub Actions annotations, so they show on the run's summary page.
# With CWS_UPLOAD_PRIVATE_KEY and CWS_UPLOAD_KEY_PASSPHRASE set, each
# draft also carries the Chrome package signed for the Chrome Web Store's
# verified uploads; without them, as in a fork, it has the zips alone.

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CHROMIUM_MANIFEST="manifest.json"
DIST_DIR="dist"

: "${GITHUB_SHA:?GITHUB_SHA must name the commit the drafts point at.}"

# Only the signer gets the key; build.sh, release-notes.sh and gh do not.
signing_key="${CWS_UPLOAD_PRIVATE_KEY:-}"
signing_passphrase="${CWS_UPLOAD_KEY_PASSPHRASE:-}"
unset CWS_UPLOAD_PRIVATE_KEY CWS_UPLOAD_KEY_PASSPHRASE

if [ -z "$signing_key" ]; then
    echo "::warning::CWS_UPLOAD_PRIVATE_KEY is not set, so the drafts have no signed Chrome package."
fi

cd "$REPO_ROOT"

# Read a string field from a manifest file, as build.sh does.
read_manifest_field() {
    local manifest="$1"
    local field="$2"
    sed -n \
        "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" \
        "$manifest" \
        | head -n 1
}

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT

# Extensions whose draft could not be made; the others still get theirs.
failed=()

# Tags of the draft releases; a draft's tag exists only once it is published.
drafts=$(gh release list --limit 1000 --json tagName,isDraft \
    --jq '.[] | select(.isDraft) | .tagName')

for manifest in */"$CHROMIUM_MANIFEST"; do
    extension=$(dirname "$manifest")
    name=$(read_manifest_field "$extension/$CHROMIUM_MANIFEST" "name")
    version=$(read_manifest_field "$extension/$CHROMIUM_MANIFEST" "version")

    if [ -z "$name" ] || [ -z "$version" ]; then
        echo "::error::Could not read name or version from $extension/$CHROMIUM_MANIFEST."
        exit 1
    fi

    tag="$extension-v$version"

    if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
        echo "$tag is already released."
        continue
    fi

    if ! ./release-notes.sh "$extension" >"$notes" || ! ./build.sh "$extension"; then
        failed+=("$tag")
        continue
    fi

    packages=("$extension/$DIST_DIR"/*.zip)

    # The Chrome Web Store takes only uploads signed with the key it has.
    if [ -n "$signing_key" ]; then
        chrome_zips=("$extension/$DIST_DIR"/*-chrome-v*.zip)
        chrome_crx="${chrome_zips[0]%.zip}.crx"
        if ! CWS_UPLOAD_PRIVATE_KEY="$signing_key" \
            CWS_UPLOAD_KEY_PASSPHRASE="$signing_passphrase" \
            node .github/sign-chrome-crx.mjs "${chrome_zips[0]}" "$chrome_crx"; then
            failed+=("$tag")
            continue
        fi
        packages+=("$chrome_crx")
    fi

    # Drafts of an older version, or of this one from an earlier push.
    while read -r draft; do
        if [[ "$draft" =~ ^"$extension"-v[0-9][0-9.]*$ ]]; then
            gh release delete "$draft" --yes
        fi
    done <<<"$drafts"

    gh release create "$tag" "${packages[@]}" \
        --draft \
        --latest=false \
        --target "$GITHUB_SHA" \
        --title "$name $version" \
        --notes-file "$notes"
    echo "Drafted $tag."
done

if [ "${#failed[@]}" -gt 0 ]; then
    echo "::error::No draft for ${failed[*]}; the log above says why."
    exit 1
fi
