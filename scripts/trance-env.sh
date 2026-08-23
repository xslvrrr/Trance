#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: pin the build toolchain for this shell.
#
#   source scripts/trance-env.sh
#
# Zen pins Node 22 (.nvmrc), Python 3.11 (.python-version) and Rust 1.94.1
# (.rust-toolchain). mach does not support Python 3.14, so a newer system
# python3 on PATH will break `npm run import` and `npm run build`.
#
# This script is additive and shell-local: it changes nothing outside the
# current shell and installs nothing.

set -u

_trance_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

# --- Python 3.11 -------------------------------------------------------------
# Homebrew's python@3.11 keg is not linked as `python3`; its libexec/bin is.
_trance_py311="/opt/homebrew/opt/python@3.11/libexec/bin"
if [ -x "$_trance_py311/python3" ]; then
  export PATH="$_trance_py311:$PATH"
elif command -v pyenv >/dev/null 2>&1; then
  eval "$(pyenv init -)"
else
  echo "trance-env: no Python 3.11 found." >&2
  echo "            brew install python@3.11   (or use pyenv/mise)" >&2
fi

# --- Node 22 -----------------------------------------------------------------
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || echo "trance-env: nvm use failed; run 'nvm install' once." >&2
fi

# --- Rust --------------------------------------------------------------------
# Note: rustup only auto-reads `rust-toolchain` / `rust-toolchain.toml`. Zen's
# pin lives in `.rust-toolchain` (dotted), which rustup ignores, so select it
# explicitly from the file rather than relying on an override.
if command -v rustup >/dev/null 2>&1 && [ -f "$_trance_root/.rust-toolchain" ]; then
  _trance_rust="$(tr -d '[:space:]' < "$_trance_root/.rust-toolchain")"
  if rustup toolchain list 2>/dev/null | grep -q "^${_trance_rust}"; then
    export RUSTUP_TOOLCHAIN="$_trance_rust"
  else
    echo "trance-env: rust $_trance_rust not installed -> rustup toolchain install $_trance_rust" >&2
  fi
  unset _trance_rust
fi

# --- Native build dependencies ----------------------------------------------
# surfer unpacks the Firefox tarball with GNU tar; macOS bsdtar is not enough
# and the failure only surfaces minutes into `npm run download`.
for _trance_dep in gtar; do
  command -v "$_trance_dep" >/dev/null 2>&1 || \
    echo "trance-env: missing '$_trance_dep' -> brew install gnu-tar" >&2
done
unset _trance_dep

# --- Report ------------------------------------------------------------------
printf 'trance-env: python %s | node %s | rustc %s\n' \
  "$(python3 -V 2>&1 | awk '{print $2}')" \
  "$(node -v 2>/dev/null || echo '-')" \
  "$(rustc -V 2>/dev/null | awk '{print $2}' || echo '-')"

unset _trance_root _trance_py311
set +u
