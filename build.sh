#!/usr/bin/env bash
set -euo pipefail

# Usage: ./build.sh [extension-directory ...]
# Without arguments, every directory next to this script that contains
# manifest.json is built. Packages go to each extension's dist/: Chrome
# and Edge always, and Firefox when manifest-firefox.json exists.

# Repository root containing this script and the extension directories.
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Distribution directory, relative to each extension directory.
DIST_DIR="dist"
CHROMIUM_MANIFEST="manifest.json"
FIREFOX_MANIFEST="manifest-firefox.json"
FIREFOX_EXCLUDE="firefox-exclude.txt"

# Check whether zip is installed.
if ! command -v zip >/dev/null 2>&1; then
    echo "Error: zip is not installed."
    echo
    echo "Install it using your system package manager:"
    echo
    echo "Debian/Ubuntu: sudo apt install zip"
    exit 1
fi

# Read a string field from a manifest file.
read_manifest_field() {
    local manifest="$1"
    local field="$2"
    sed -n \
        "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" \
        "$manifest" \
        | head -n 1
}

# Convert an extension name into a filename-friendly slug.
make_slug() {
    printf '%s' "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//'
}

# Remove Firefox-specific variant files from a directory tree.
# Example: background-firefox.js
remove_firefox_variants() {
    local directory="$1"
    [ -d "$directory" ] || return
    find "$directory" \
        -type f \
        -name '*-firefox.*' \
        -delete
}

# Apply Firefox-specific variants recursively.
# Example: background-firefox.js replaces background.js in the Firefox package.
apply_firefox_variants() {
    local source_directory="$1"
    local stage_directory="$2"
    [ -d "$source_directory" ] || return

    while IFS= read -r -d '' variant_file; do
        local relative_path relative_directory filename target_filename target_path
        relative_path="${variant_file#"$source_directory"/}"
        relative_directory=$(dirname "$relative_path")
        filename=$(basename "$relative_path")
        target_filename="${filename%-firefox.*}.${filename##*.}"

        if [ "$relative_directory" = "." ]; then
            target_path="$stage_directory/$target_filename"
        else
            target_path="$stage_directory/$relative_directory/$target_filename"
        fi

        mkdir -p "$(dirname "$target_path")"
        cp "$variant_file" "$target_path"
    done < <(
        find "$source_directory" \
            -type f \
            -name '*-firefox.*' \
            -print0
    )
}

# Remove the paths listed in firefox-exclude.txt from the Firefox package.
# One path per line, as it is in the package; # starts a comment.
remove_firefox_excludes() {
    local stage_directory="$1"
    local line
    local path

    if [ ! -f "$FIREFOX_EXCLUDE" ]; then
        return
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        path=$(printf '%s' "${line%%#*}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s:/*$::')

        if [ -z "$path" ]; then
            continue
        fi

        if [[ "$path" == /* || "/$path/" == */../* ]]; then
            echo "Error: $FIREFOX_EXCLUDE lists $path, which is outside the package."
            exit 1
        fi

        if [ ! -e "$stage_directory/$path" ]; then
            echo "Error: $FIREFOX_EXCLUDE lists $path, which the Firefox package does not contain."
            exit 1
        fi

        rm -rf "${stage_directory:?}/$path"
    done < "$FIREFOX_EXCLUDE"
}

# Package one extension directory into its own dist/ directory.
# Runs in a subshell so the cd and the per-extension variables stay local.
# _locales/, when the extension has one, goes into every package as it is,
# except that the Firefox package names Norwegian Bokmål nb instead of no.
build_extension() {
    local extension_directory="$1"
    (
        cd "$extension_directory"

        # Check required files and directories.
        for path in \
            "$CHROMIUM_MANIFEST" \
            "icons" \
            "options" \
            "src"
        do
            if [ ! -e "$path" ]; then
                echo "Error: $extension_directory/$path not found."
                exit 1
            fi
        done

        # An extension without a Firefox manifest ships for Chrome and Edge only.
        BUILD_FIREFOX=false
        if [ -f "$FIREFOX_MANIFEST" ]; then
            BUILD_FIREFOX=true
        fi

        # Read Chromium manifest metadata.
        CHROMIUM_NAME=$(read_manifest_field "$CHROMIUM_MANIFEST" "name")
        CHROMIUM_VERSION=$(read_manifest_field "$CHROMIUM_MANIFEST" "version")

        # Validate manifest metadata.
        if [ -z "$CHROMIUM_NAME" ] || [ -z "$CHROMIUM_VERSION" ]; then
            echo "Error: Could not read name or version from $extension_directory/$CHROMIUM_MANIFEST."
            exit 1
        fi

        # Define output filenames from filename-safe extension names.
        CHROMIUM_SLUG=$(make_slug "$CHROMIUM_NAME")
        CHROME_ZIP="$DIST_DIR/${CHROMIUM_SLUG}-chrome-v${CHROMIUM_VERSION}.zip"
        EDGE_ZIP="$DIST_DIR/${CHROMIUM_SLUG}-edge-v${CHROMIUM_VERSION}.zip"
        PACKAGES=("$CHROME_ZIP" "$EDGE_ZIP")

        if [ "$BUILD_FIREFOX" = true ]; then
            FIREFOX_NAME=$(read_manifest_field "$FIREFOX_MANIFEST" "name")
            FIREFOX_VERSION=$(read_manifest_field "$FIREFOX_MANIFEST" "version")

            if [ -z "$FIREFOX_NAME" ] || [ -z "$FIREFOX_VERSION" ]; then
                echo "Error: Could not read name or version from $extension_directory/$FIREFOX_MANIFEST."
                exit 1
            fi

            FIREFOX_SLUG=$(make_slug "$FIREFOX_NAME")
            FIREFOX_ZIP="$DIST_DIR/${FIREFOX_SLUG}-firefox-v${FIREFOX_VERSION}.zip"
            PACKAGES+=("$FIREFOX_ZIP")
        elif [ -f "$FIREFOX_EXCLUDE" ]; then
            echo "Error: $extension_directory/$FIREFOX_EXCLUDE needs $FIREFOX_MANIFEST."
            exit 1
        fi

        # Define temporary staging directories.
        CHROMIUM_STAGE="$DIST_DIR/.chromium"
        FIREFOX_STAGE="$DIST_DIR/.firefox"

        # Create a clean distribution directory.
        rm -rf "$DIST_DIR"
        mkdir -p \
            "$CHROMIUM_STAGE" \
            "$FIREFOX_STAGE"

        # Prepare Chromium package files.
        cp "$CHROMIUM_MANIFEST" "$CHROMIUM_STAGE/manifest.json"
        cp -R "icons" "$CHROMIUM_STAGE/icons"
        if [ -d "_locales" ]; then
            cp -R "_locales" "$CHROMIUM_STAGE/_locales"
        fi
        if [ ! -f "options/placeholder" ]; then
            cp -R "options" "$CHROMIUM_STAGE/options"
        fi
        cp -R "src" "$CHROMIUM_STAGE/src"

        # Remove Firefox-specific files from Chromium package.
        remove_firefox_variants "$CHROMIUM_STAGE/src"
        if [ -d "$CHROMIUM_STAGE/options" ]; then
            remove_firefox_variants "$CHROMIUM_STAGE/options"
        fi

        if [ "$BUILD_FIREFOX" = true ]; then
            # Prepare Firefox package files.
            cp "$FIREFOX_MANIFEST" "$FIREFOX_STAGE/manifest.json"
            cp -R "icons" "$FIREFOX_STAGE/icons"
            if [ -d "_locales" ]; then
                cp -R "_locales" "$FIREFOX_STAGE/_locales"
                # Chrome looks Norwegian Bokmål up under no, Firefox under nb.
                if [ -d "$FIREFOX_STAGE/_locales/no" ]; then
                    mv "$FIREFOX_STAGE/_locales/no" "$FIREFOX_STAGE/_locales/nb"
                fi
            fi
            if [ ! -f "options/placeholder" ]; then
                cp -R "options" "$FIREFOX_STAGE/options"
            fi
            cp -R "src" "$FIREFOX_STAGE/src"

            # Remove Firefox variant source filenames from Firefox package.
            remove_firefox_variants "$FIREFOX_STAGE/src"
            if [ -d "$FIREFOX_STAGE/options" ]; then
                remove_firefox_variants "$FIREFOX_STAGE/options"
            fi

            # Apply Firefox-specific source file variants.
            apply_firefox_variants "src" "$FIREFOX_STAGE/src"
            # Apply Firefox-specific options file variants.
            if [ -d "$FIREFOX_STAGE/options" ]; then
                apply_firefox_variants "options" "$FIREFOX_STAGE/options"
            fi

            # Leave out files only Chrome and Edge use.
            remove_firefox_excludes "$FIREFOX_STAGE"
        fi

        # Create Chrome package.
        (
            cd "$CHROMIUM_STAGE"
            zip -qr "../$(basename "$CHROME_ZIP")" .
        )

        # Create Edge package.
        (
            cd "$CHROMIUM_STAGE"
            zip -qr "../$(basename "$EDGE_ZIP")" .
        )

        # Create Firefox package.
        if [ "$BUILD_FIREFOX" = true ]; then
            (
                cd "$FIREFOX_STAGE"
                zip -qr "../$(basename "$FIREFOX_ZIP")" .
            )
        fi

        # Remove temporary staging directories.
        rm -rf \
            "$CHROMIUM_STAGE" \
            "$FIREFOX_STAGE"

        echo "Build complete: $extension_directory"
        echo
        for package in "${PACKAGES[@]}"; do
            echo "  $extension_directory/$package"
        done
        echo
    )
}

# Build the extensions given as arguments, or every extension in the repository.
if [ "$#" -gt 0 ]; then
    extensions=("$@")
else
    cd "$REPO_ROOT"
    extensions=()
    for manifest in */"$CHROMIUM_MANIFEST"; do
        if [ -f "$manifest" ]; then
            extensions+=("$(dirname "$manifest")")
        fi
    done
    if [ "${#extensions[@]}" -eq 0 ]; then
        echo "Error: no extensions with $CHROMIUM_MANIFEST found in $REPO_ROOT."
        exit 1
    fi
fi

for extension in "${extensions[@]}"; do
    if [ ! -d "$extension" ]; then
        echo "Error: $extension is not a directory."
        exit 1
    fi
    build_extension "${extension%/}"
done
