#!/usr/bin/env bash
# Puts DECLARACION-RESPONSABLE.md (in the current directory) on the GitHub Release for
# $GITHUB_REF_NAME, so the declaration is public before npm publish runs.
set -euo pipefail

tag="$GITHUB_REF_NAME"
file=DECLARACION-RESPONSABLE.md
here="$(cd "$(dirname "$0")" && pwd)"
view_err="$RUNNER_TEMP/release-view.err"
if view=$(gh release view "$tag" --json isDraft,assets --jq '.isDraft, .assets[].name' 2>"$view_err"); then
  # A draft is not public: uploading to it would let npm publish while the declaration is hidden.
  if [ "$(printf '%s\n' "$view" | head -n 1)" != false ]; then
    echo "::error::The Release for $tag is a draft, so $file would not be public. Publish the draft Release, or delete it, then re-run this job."
    exit 1
  fi
  assets=$(printf '%s\n' "$view" | tail -n +2)
  if printf '%s\n' "$assets" | grep -Fqx "$file"; then
    published="$RUNNER_TEMP/published"
    gh release download "$tag" --pattern "$file" --dir "$published"
    if ! cmp "$file" "$published/$file"; then
      echo "::error::The Release for $tag already holds a different $file; a published declaration never changes."
      exit 1
    fi
  else
    gh release upload "$tag" "$file"
  fi
elif grep -Fq "release not found" "$view_err"; then
  node "$here/declaration.mjs" changelog "${tag#v}" --root . >"$RUNNER_TEMP/notes.md"
  gh release create "$tag" "$file" --verify-tag --title "$tag" --notes-file "$RUNNER_TEMP/notes.md"
else
  cat "$view_err" >&2
  exit 1
fi
