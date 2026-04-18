#!/usr/bin/env bash
# Patch the Cactus Python FFI in the server venv so it:
#   1. Loads libcactus.dylib from the source-built dylib path (not brew's
#      bundled path which resolves via __file__). This lets us pin to a
#      freshly-built dylib with post-v1.14 Gemma-4 fixes.
#   2. Marshalls pcm_data via from_buffer_copy rather than unpacking every
#      byte as a ctypes arg — the original FFI path does 960 000 per-byte
#      ctypes conversions for a 30-second voice turn, which adds seconds
#      of Python-level overhead per call.
#
# Run AFTER `cactus build --python` in the adjacent cactus clone and AFTER
# creating server/.venv. Idempotent — safe to re-run.
#
# Usage: bash scripts/patch-cactus-ffi.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACTUS_SRC="${REPO_ROOT}/../cactus"
VENV_SITE="${REPO_ROOT}/server/.venv/lib/python3.14/site-packages"
SRC_CACTUS_PY="${CACTUS_SRC}/python/src/cactus.py"
SRC_DYLIB="${CACTUS_SRC}/cactus/build/libcactus.dylib"
SYMLINK_TARGET="/opt/homebrew/lib/cactus/build/libcactus.dylib"
VENV_CACTUS_PY="${VENV_SITE}/cactus.py"

if [ ! -f "${SRC_CACTUS_PY}" ]; then
  echo "ERROR: source cactus.py not found at ${SRC_CACTUS_PY}" >&2
  echo "  Did you clone cactus adjacent to this repo?" >&2
  exit 1
fi

if [ ! -f "${SRC_DYLIB}" ]; then
  echo "ERROR: source dylib not found at ${SRC_DYLIB}" >&2
  echo "  Run:  cd ../cactus && source venv/bin/activate && cactus build --python" >&2
  exit 1
fi

if [ ! -d "${VENV_SITE}" ]; then
  echo "ERROR: server venv not found at ${REPO_ROOT}/server/.venv" >&2
  echo "  Run:  python3.14 -m venv server/.venv --system-site-packages" >&2
  exit 1
fi

echo "==> Symlink ${SYMLINK_TARGET} -> ${SRC_DYLIB}"
sudo mkdir -p "$(dirname "${SYMLINK_TARGET}")"
sudo ln -sf "${SRC_DYLIB}" "${SYMLINK_TARGET}"

echo "==> Copy source cactus.py into venv site-packages (overrides brew's)"
cp "${SRC_CACTUS_PY}" "${VENV_CACTUS_PY}"

echo "==> Hard-pin _LIB_PATH to the brew symlink (which points at source build)"
python3 - <<PY
from pathlib import Path
p = Path("${VENV_CACTUS_PY}")
src = p.read_text()
marker = "_DIR = Path(__file__).parent.parent.parent"
if marker not in src:
    raise SystemExit("FFI already patched or source layout changed — bailing.")
old_block = (
    "_DIR = Path(__file__).parent.parent.parent\n"
    "if platform.system() == \"Darwin\":\n"
    "    _LIB_PATH = _DIR / \"cactus\" / \"build\" / \"libcactus.dylib\"\n"
    "else:\n"
    "    _LIB_PATH = _DIR / \"cactus\" / \"build\" / \"libcactus.so\"\n"
)
new_block = (
    "# HAL 9000 fork: hard-pinned to the symlink that points at the\n"
    "# source-built libcactus.dylib (see scripts/patch-cactus-ffi.sh).\n"
    "_LIB_PATH = Path(\"${SYMLINK_TARGET}\")\n"
)
if old_block not in src:
    raise SystemExit("Expected _LIB_PATH block not found verbatim — bailing.")
src = src.replace(old_block, new_block)

# Patch PCM marshalling. Replace (c_uint8 * N)(*pcm_data) — which unpacks
# every byte as a ctypes arg — with from_buffer_copy for a single memcpy.
old_marshal = "(ctypes.c_uint8 * len(pcm_data))(*pcm_data)"
new_marshal = "(ctypes.c_uint8 * len(pcm_data)).from_buffer_copy(bytes(pcm_data))"
if old_marshal not in src:
    raise SystemExit("PCM marshalling pattern not found — bailing.")
count = src.count(old_marshal)
src = src.replace(old_marshal, new_marshal)
p.write_text(src)
print(f"   patched {count} PCM marshalling call sites")
PY

echo "==> Verify FFI loads from venv"
"${REPO_ROOT}/server/.venv/bin/python" -c "
import cactus, sys
assert 'server/.venv' in cactus.__file__, f'venv FFI not winning: {cactus.__file__}'
assert str(cactus._LIB_PATH) == '${SYMLINK_TARGET}', cactus._LIB_PATH
print('   cactus.py ->', cactus.__file__)
print('   _LIB_PATH ->', cactus._LIB_PATH)
"

echo ""
echo "Cactus FFI patched. Ready for: uvicorn server:app --app-dir server"
