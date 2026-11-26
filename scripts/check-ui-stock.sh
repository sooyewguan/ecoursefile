#!/usr/bin/env bash
# Fails when a file in src/components/ui differs from the shadcn registry. Each component is
# checked on its own with `shadcn add --dry-run`, because a dry run of several at once can report a
# shared dependency as changed when it is not.
set -u
cd "$(dirname "$0")/.."
changed=()
for file in src/components/ui/*.tsx; do
  name=$(basename "$file" .tsx)
  if ! npx shadcn add "$name" --dry-run 2>&1 | grep -q "ui/$name.tsx *skip (identical)"; then
    changed+=("$name")
  fi
done
if [ ${#changed[@]} -gt 0 ]; then
  echo "Not stock shadcn: ${changed[*]}"
  echo "See the changes with: npx shadcn add <name> --diff"
  exit 1
fi
echo "All $(ls src/components/ui/*.tsx | wc -l) components in src/components/ui are stock shadcn."
