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

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CHROMIUM_MANIFEST="manifest.json"
DIST_DIR="dist"

: "${GITHUB_SHA:?GITHUB_SHA must name the commit the drafts point at.}"

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

    # Drafts of an older version, or of this one from an earlier push.
    while read -r draft; do
        if [[ "$draft" =~ ^"$extension"-v[0-9][0-9.]*$ ]]; then
            gh release delete "$draft" --yes
        fi
    done <<<"$drafts"

    gh release create "$tag" "$extension/$DIST_DIR"/*.zip \
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
