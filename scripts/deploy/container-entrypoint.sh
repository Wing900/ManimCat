#!/bin/sh
set -eu

# The outer user/mount/PID namespace is required for the server-side render
# sandbox. Some hosts block unprivileged user namespaces. Operators may set
# MANIMCAT_CONTAINER_SANDBOX=disabled to run browser-only on such a host.
# This is explicit, never a silent fallback: the server-side renderer still
# refuses to execute submitted code unless bubblewrap can start.
mode="${MANIMCAT_CONTAINER_SANDBOX:-required}"
case "$mode" in
  required)
    exec /usr/bin/unshare --user --map-root-user --mount --mount-proc \
      --propagation private --pid --fork --kill-child=KILL -- "$@"
    ;;
  disabled)
    echo "WARN: MANIMCAT_CONTAINER_SANDBOX=disabled; outer user namespace skipped." >&2
    echo "WARN: Server-side rendering remains disabled unless bubblewrap can create namespaces." >&2
    exec "$@"
    ;;
  *)
    echo "ERROR: MANIMCAT_CONTAINER_SANDBOX must be 'required' or 'disabled'." >&2
    exit 1
    ;;
esac
