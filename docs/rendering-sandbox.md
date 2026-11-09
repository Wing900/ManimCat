# Rendering sandbox

All submitted ManimGX and Matplotlib source runs inside a mandatory Linux
[bubblewrap](https://github.com/containers/bubblewrap) sandbox. There is no
`no-sandbox` flag or unsandboxed Python fallback.

## Required host capability

- Linux with unprivileged user namespaces enabled.
- `bwrap` installed (`apt install bubblewrap`). The Docker image includes it.
- No host `bwrap` setuid helper is required for the default deployment.

At startup the server runs a small trusted probe using the same mandatory
sandbox flags as a render. If `bwrap` is missing, the kernel denies user
namespaces, or the container runtime blocks the required namespace operations,
**all server startup fails**, not only rendering. Render entrypoints also
re-check the capability before staging or executing source, returning a failure
instead of running Python outside the sandbox.

On Debian/Ubuntu hosts, inspect the relevant kernel policy rather than assuming
a universal value:

```bash
cat /proc/sys/kernel/unprivileged_userns_clone
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
```

Interpret those values with your distribution, container runtime and security
policy. If user namespaces are restricted, deploy on a host/runtime that permits
the namespaces needed by this service, or use a reviewed, narrowly-scoped
AppArmor/seccomp profile for this workload. Do not disable AppArmor globally, set
`apparmor_restrict_unprivileged_userns=0`, or switch to an unconfined profile
just to make rendering work.

## What is mounted

For each render, only these paths are visible:

- read-only system/runtime paths: `/usr`, `/usr/local`, `/lib`, `/lib64`,
  `/bin`, `/sbin`, the exact render Python virtualenv, `/etc/ld.so.cache`,
  `/etc/fonts`, and `/etc/localtime`;
- read-only exact server runner files under `/runner`;
- the per-render input staging directory at `/input` (read-only);
- per-render scratch at `/work` and private output at `/output` (writable).

`/sys` is not mounted by default. Add only a narrowly justified path if a
specific renderer requires it, and keep the host root and broad device trees out
of the sandbox.

The host root, `/app`, `/data`, home directories, workspaces, Redis/media data,
and host `/etc` are not mounted. The sandbox has a new user/mount/PID/IPC/UTS/
network namespace, new `/proc`, new `/dev`, dropped capabilities, no host
sockets, and a cleared environment with an explicit allowlist. Submitted code
has no network access. Nested user-namespace creation is disabled inside the
sandbox (`--disable-userns`, plus `--assert-userns-disabled` when the installed
bwrap supports it).

Narration assets are copied into `/input` and the staged manifest is rewritten
to sandbox paths, so parent/workspace paths never enter the renderer. Returned
artifacts are re-validated as regular, non-symlink files and copied by the
server; sandbox directories are never exposed as public output.

## Containers and nested containers

Unprivileged user namespaces must be allowed in both the host kernel and the
container runtime. Some container platforms, AppArmor profiles, seccomp
profiles, or nested-container configurations deny `clone`/`unshare` for
unprivileged users. In that case the app fails closed.

Do **not** work around this with `--privileged`, `--security-opt
seccomp=unconfined`, `--security-opt apparmor=unconfined`, a globally disabled
AppArmor policy, or a setuid `bwrap` helper. Deploy on a host/runtime that
permits unprivileged user namespaces, or use a reviewed, narrowly-scoped runtime
policy that preserves the isolation above. A deployment that cannot create the
sandbox must not serve renders.

## Resource limits and residual risk

This sandbox adds **no new CPU, memory, disk or process-count quotas**. Existing
render timeouts and memory monitoring are operational safeguards, not hard
resource limits. Apply container or host-level limits and monitoring if renders
are untrusted.

bubblewrap shares the host kernel; it is not a virtual machine. A kernel or
runtime vulnerability could still allow an escape. Keep the host kernel,
container runtime and bubblewrap patched, and treat the sandbox as one layer of
defence rather than an absolute boundary.

## Runtime selection

`MANIMGX_PYTHON` selects the ManimGX interpreter. If unset, the project `.venv`
is used when present, then `python3`/`python` from `PATH`. `MATPLOTLIB_PYTHON`
optionally selects a separate Matplotlib interpreter; when it is unset,
Matplotlib uses the same runtime selected by `MANIMGX_PYTHON`. A virtualenv is
mounted as one exact read-only directory; its parent is not mounted.

## Verification before deployment

On a Linux host that supports the required namespaces, with the rendering Python
dependencies installed, require the real isolation and rendering tests:

```bash
MANIMCAT_REQUIRE_SANDBOX_TESTS=1 npm run test:workflow
```

This checks host-file, environment, process and network isolation, read-only
inputs, Matplotlib output, and ManimGX image/narrated-video rendering. Missing
sandbox capabilities or rendering dependencies fail these tests instead of
silently skipping them. In ordinary development runs these integration tests
report explicit skips when prerequisites are unavailable; those skips do not
constitute deployment acceptance.
