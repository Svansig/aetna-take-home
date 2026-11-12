# Production deployment: aetna-test.budarz.dev

How the Movie Services API runs in production, and how to operate it. CI and image
publication are described in the [README](../README.md#continuous-integration).

```
 GitHub                         Proxmox LXC (Debian, Docker)                  Cloudflare
 ──────                         ────────────────────────────                  ──────────
 push to main                   aetna-update.timer (every 60 s)
   └─ CI ─ success              └─ aetna-update ── resolve :production ──►  GHCR (public, anonymous)
       └─ Publish ─► GHCR          pull by digest, validate, replace,
          :<sha>, :production      health + smoke test, else roll back
                                     │
                                     ▼
                                 [aetna-api]  ◄── network "aetna-origin" (internal) ──┐
                                 read-only rootfs, non-root,                          │
                                 /srv/aetna/data/v1/*.db mounted read-only    [aetna-cloudflared] ── outbound ──► edge
                                                                              (separate Compose project)       aetna-test.budarz.dev
```

- **Pull-based.** The host makes every connection: it polls GHCR and pulls the
  image. GitHub never connects to the host; there is no SSH, self-hosted runner,
  Watchtower or Portainer.
- **Immutable.** The container always runs `ghcr.io/svansig/aetna-take-home@sha256:…`.
  The moving `production` tag is only used to discover new releases.
- **Private origin.** The API publishes no ports. It's reachable only on the
  internal Docker network `aetna-origin`, shared with the tunnel connector. No
  router port is opened and nothing on Proxmox or Docker is exposed.
- **Rollback is per image.** Databases live on the host and are never changed by a
  deployment or rollback.

## Contents

1. [Provision the LXC](#1-provision-the-lxc)
2. [Install Docker and prerequisites](#2-install-docker-and-prerequisites)
3. [Install the deployment files](#3-install-the-deployment-files)
4. [Place the SQLite datasets](#4-place-the-sqlite-datasets)
5. [Configuration and secrets](#5-configuration-and-secrets)
6. [Create the Cloudflare Tunnel](#6-create-the-cloudflare-tunnel)
7. [First deployment and acceptance](#7-first-deployment-and-acceptance)
8. [Automatic updates](#8-automatic-updates)
9. [Day-2 operations](#9-day-2-operations)
10. [Replacing datasets and V2](#10-replacing-datasets-and-v2)
11. [Known limitations](#11-known-limitations)
12. [Test evidence](#12-test-evidence)

## 1. Provision the LXC

Create a new, dedicated **unprivileged** container on Proxmox VE 8 or later from
a **Debian 13 (trixie)** template (Debian 12 also works; both are supported by
Docker Engine). Docker in an unprivileged LXC needs only the `nesting` and
`keyctl` features. Don't make the container privileged, and don't add raw
`lxc.apparmor`, `lxc.cap.drop` or device passthrough settings.

On the Proxmox host (adjust the ID, storage, bridge and template version):

```sh
pveam update
pveam available --section system | grep debian-13
pveam download local debian-13-standard_13.1-1_amd64.tar.zst

pct create 240 local:vztmpl/debian-13-standard_13.1-1_amd64.tar.zst \
  --hostname aetna-test \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp,firewall=1 \
  --onboot 1 \
  --ssh-public-keys ~/.ssh/authorized_keys
pct start 240
pct enter 240
```

- **Architecture:** `amd64`. The image is published for `linux/amd64` only.
- **Storage:** 16 GB holds the OS, Docker images (~250 MB each; old ones are
  pruned, see [9](#9-day-2-operations)) and the ~32 MB V1 datasets. LVM-thin or
  directory storage with ext4/xfs works with Docker's overlayfs. ZFS-backed root
  filesystems need OpenZFS ≥ 2.2 (Proxmox VE ≥ 8.1) for overlayfs.
- **Network:** outbound DNS and HTTPS (443) to `ghcr.io`, `pkg-containers.githubusercontent.com`,
  `download.docker.com`, `deb.debian.org` and `registry-1.docker.io`; outbound
  **7844/UDP and 7844/TCP** to Cloudflare (`region1.v2.argotunnel.com`,
  `region2.v2.argotunnel.com`) and 443 to `api.cloudflare.com`. **No inbound
  ports.** With the Proxmox firewall enabled on `net0`, set the input policy to
  DROP (allow SSH from your admin LAN only, if you want SSH at all).
- **systemd** is the init system of the Debian template; nothing extra is needed.

**Stop rule.** After installing Docker (step 2), `docker info` must show
`Storage Driver: overlayfs` (containerd image store) or `overlay2`, and
`docker run --rm hello-world` must succeed. If Docker only works with the `vfs`
driver, fails with AppArmor or `sysctl ... permission denied` errors (a known
interaction between some runc releases and LXC AppArmor profiles on older
Proxmox builds), first update the Proxmox host (`apt full-upgrade`, which
updates `lxc-pve` and its AppArmor profiles) and use ext4/xfs-backed rootfs
storage. If it still fails, **stop and document the exact error and the change
you are considering**; don't switch to a privileged container or disable
AppArmor to get past it.

## 2. Install Docker and prerequisites

Inside the LXC, as root, from Docker's official apt repository
([docs](https://docs.docker.com/engine/install/debian/)):

```sh
apt-get update
apt-get install -y ca-certificates curl gnupg jq sqlite3 git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

docker info --format '{{.Driver}} {{.SecurityOptions}}'
docker run --rm hello-world
```

The updater needs `docker` with the Compose plugin (≥ 2.24), `curl`, `jq`,
`sqlite3`, `flock`, `timeout` and `sha256sum` (the last three are in Debian's
base system). Node.js is **not** installed on the host; smoke tests run inside
the API container.

## 3. Install the deployment files

```sh
git clone https://github.com/Svansig/aetna-take-home.git /root/aetna-take-home
/root/aetna-take-home/deploy/install.sh
```

`install.sh` is idempotent. It never touches datasets, the tunnel token, running
containers, or an existing `/etc/aetna/aetna.env`, and it doesn't enable the
timers. Re-run it after `git pull` to update the updater, Compose files or units.
The deployment files are deliberately **not** updated by image releases: a
change to them is an operator action.

Host layout:

| Path                                          | Owner / mode                   | Contents                                                                                                  |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `/opt/aetna/compose.production.yaml`          | root 0644                      | API service ([source](../deploy/compose.production.yaml))                                                 |
| `/opt/aetna/compose.tunnel.yaml`              | root 0644                      | cloudflared ([source](../deploy/compose.tunnel.yaml))                                                     |
| `/opt/aetna/smoke-test.js`                    | root 0644                      | Functional checks ([source](../deploy/smoke-test.js))                                                     |
| `/opt/aetna/bin/aetna-update`                 | root 0755                      | Updater; also `/usr/local/bin/aetna-update`                                                               |
| `/opt/aetna/bin/aetna-public-check`           | root 0755                      | Public-route monitor                                                                                      |
| `/etc/aetna/aetna.env`                        | root 0644                      | Configuration, no secrets ([example](../deploy/aetna.env.example))                                        |
| `/etc/aetna/tunnel-token`                     | 65532:65532 0400               | Cloudflare Tunnel token (secret)                                                                          |
| `/srv/aetna/data/v1/{movies,ratings}.db`      | root 0444, directory root 0755 | V1 datasets, mounted read-only                                                                            |
| `/srv/aetna/data/v2/`                         | root                           | Future V2 dataset (see [10](#10-replacing-datasets-and-v2))                                               |
| `/var/lib/aetna/`                             | root 0700                      | Updater state: `current.digest`, `previous.digest`, `rollback.digest`, `blocked/`, `hold`, `releases.log` |
| `/etc/systemd/system/aetna-*.{service,timer}` | root 0644                      | [Units](../deploy/systemd/)                                                                               |

## 4. Place the SQLite datasets

Production copies are provisioned once, independently of image releases. Copy
them from a trusted checkout (they're the files in the repository's `db/`), then
make them read-only:

```sh
install -m 0444 /root/aetna-take-home/db/movies.db  /srv/aetna/data/v1/movies.db
install -m 0444 /root/aetna-take-home/db/ratings.db /srv/aetna/data/v1/ratings.db
cd /srv/aetna/data/v1 && sha256sum movies.db ratings.db | tee SHA256SUMS
sqlite3 -readonly movies.db 'PRAGMA quick_check; SELECT count(*) FROM movies;'   # ok / 45430
sqlite3 -readonly ratings.db 'PRAGMA quick_check; SELECT count(*) FROM ratings;'  # ok / …
```

The files must be world-readable because the container runs as uid 1000
(`node`). They're bind-mounted read-only, and the container's root filesystem is
read-only too. Before every deployment the updater checks that both files exist,
are non-empty and world-readable, pass `PRAGMA quick_check`, and contain rows. A
missing or invalid file fails the deployment **before** the running container is
touched.

## 5. Configuration and secrets

`/etc/aetna/aetna.env` (from [`deploy/aetna.env.example`](../deploy/aetna.env.example))
holds the image repository, release tag, data directory, log level, health
timeout and public URL. It contains no secrets. The updater accepts only known
`KEY=value` lines. The application's own environment (paths, `NODE_ENV`, port)
is fixed in `compose.production.yaml`, the same as in the repository's `compose.yaml`.

The only secret is the **Cloudflare Tunnel token**:

```sh
umask 077
read -rsp 'Tunnel token: ' TOKEN && printf '%s' "$TOKEN" > /etc/aetna/tunnel-token && unset TOKEN
chown 65532:65532 /etc/aetna/tunnel-token   # cloudflared's non-root user
chmod 0400 /etc/aetna/tunnel-token
```

It is mounted into cloudflared as a Compose secret and passed as `TUNNEL_TOKEN_FILE`,
so it never appears in the environment, in `docker inspect`, in Git, or in any image.
To rotate it: refresh the token in the Cloudflare dashboard, rewrite the file,
then run `docker compose -f /opt/aetna/compose.tunnel.yaml up -d --force-recreate`.

GHCR needs no credentials: the package is public and pulls are anonymous (see
[Making the package public](../README.md#making-the-package-public-one-time)).

## 6. Create the Cloudflare Tunnel

A new, **remotely managed** tunnel dedicated to this service:

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel →
   Cloudflared**. Name it `aetna-test`.
2. On the install page, choose **Docker** and copy only the token (the long
   string after `--token`). Store it as in [step 5](#5-configuration-and-secrets).
   Don't run the suggested command.
3. **Public hostnames → Add**: subdomain `aetna-test`, domain `budarz.dev`, path
   empty, service type **HTTP**, URL **`aetna-api:3000`**. This is the API's
   alias on the internal Docker network. `127.0.0.1` or `localhost` would mean
   the cloudflared container itself. Cloudflare creates the proxied DNS record.
4. Don't add other public hostnames or private network routes to this tunnel, and
   don't route the Proxmox UI or Docker through it. No Access policy is attached,
   because the API is intentionally public and unauthenticated.
5. Start the connector:

   ```sh
   docker compose -f /opt/aetna/compose.tunnel.yaml up -d
   docker logs aetna-cloudflared 2>&1 | grep -i 'registered tunnel connection'
   docker inspect -f '{{.State.Health.Status}}' aetna-cloudflared   # healthy
   ```

   The dashboard should show the tunnel **Healthy**. Until the API is deployed,
   the public hostname returns a Cloudflare 502.

The connector is its own Compose project (`aetna-tunnel`) with
`restart: unless-stopped`. The updater only ever touches the `api` service of
project `aetna-api`, so deployments and rollbacks never restart the tunnel.
During the few seconds the API container is replaced, the tunnel stays up and
requests get a 502.

## 7. First deployment and acceptance

Prerequisites: at least one successful Publish run on `main`, and the GHCR
package made public.

```sh
aetna-update check            # first deployment: resolve, pull, validate, start, verify
aetna-update status
systemctl enable --now aetna-update.timer aetna-public-check.timer
```

If no release has been deployed yet and the first one fails verification, there's
nothing to roll back to. The API is stopped and the failure is logged at `crit`.

**Acceptance.** Local checks run automatically on every deployment. Run the
public checks once from the LXC (the API container has no outbound network, so
use a throwaway Node container):

```sh
docker run --rm -i node:26.13.0-slim node --input-type=module - https://aetna-test.budarz.dev \
  < /opt/aetna/smoke-test.js
```

or, from any machine with Node.js and a checkout: `node deploy/smoke-test.js https://aetna-test.budarz.dev`.
This covers `/health`, `/openapi.json`, `/docs/` and its assets,
`/api/v1/movies`, `/api/v1/movies/11`, `/api/v1/movies/year/1999` and
`/api/v1/movies/genre/28`. Then, in a browser, open
<https://aetna-test.budarz.dev/docs>, confirm Swagger UI loads (no failed assets
in the browser console), expand **GET /api/v1/movies/{movieId}**, choose
**Try it out** with `11`, and check that the request goes to
`https://aetna-test.budarz.dev/api/v1/movies/11` and returns 200. The OpenAPI
document's server URL is relative (`/`), so Swagger UI uses the page's own origin.

## 8. Automatic updates

`aetna-update.timer` starts `aetna-update.service` (`aetna-update check`) 60 s
after each run starts. Every run:

1. Takes a non-blocking `flock` lock, so a second run (timer or operator) exits
   immediately.
2. Exits if updates are paused (`/var/lib/aetna/hold`).
3. Resolves `ghcr.io/svansig/aetna-take-home:production` to its manifest digest
   with one anonymous registry `HEAD` request.
4. Exits silently if the digest equals `current.digest` (the last successful
   deployment), or if it's in `blocked/` (failed before).
5. Pulls the candidate by digest. A pull failure changes nothing and is retried
   next minute.
6. **Preflight**, with the running container untouched: required datasets (from
   the image label `dev.budarz.aetna.datasets`, default `v1`) are present and
   valid, the `aetna-origin` network exists, and the Compose configuration
   renders. A failure here blocks the candidate.
7. Saves the rollback target to `rollback.digest`, then recreates only the `api`
   service of project `aetna-api` with the candidate digest (`--no-deps --pull never`).
8. Waits up to `AETNA_HEALTH_TIMEOUT` (120 s) for Docker health `healthy`, failing
   early on `unhealthy`, exit or any restart. Checks that the container's image
   is exactly the candidate reference.
9. Runs `smoke-test.js` inside the container against `http://127.0.0.1:3000`.
10. On success it writes `current.digest` (and `previous.digest`) and logs
    `result=deployed`. On failure it logs the reason and the last 30 container
    log lines, **blocks** the candidate, and redeploys the previous digest with
    the same health and smoke checks (`result=rolled-back`). If that fails too it
    logs `result=ROLLBACK-FAILED` at `crit` and exits 2. A failure never
    overwrites `current.digest`.

A blocked digest stays blocked until a new digest is published to `production`
(which is simply a different candidate) or an operator runs `aetna-update retry`.
The tunnel's public reachability isn't part of this decision; it's monitored
separately by `aetna-public-check.timer` (every 5 minutes, warnings only).

## 9. Day-2 operations

### Which commit and digest is running?

```sh
aetna-update status
# release tag, what it resolves to now, current/previous digests with commit,
# the container's image reference and health, pause state, blocked digests

docker inspect aetna-api --format '{{.Config.Image}}'
docker inspect aetna-api --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

The commit links to `https://github.com/Svansig/aetna-take-home/commit/<revision>`,
and the Publish run summary for that commit shows the same digest.

### Logs

```sh
journalctl -u aetna-update -f                     # updater: every deployment, rollback, failure
journalctl -u aetna-update -p warning --since today   # only rollbacks, blocks and failures
journalctl -u aetna-public-check --since -1h      # public-route monitor
systemctl list-timers 'aetna-*'                   # last and next runs
cat /var/lib/aetna/releases.log                   # one line per deployment outcome
docker logs -f aetna-api                          # application JSON logs (pino)
docker logs -f aetna-cloudflared                  # tunnel connector
```

Updater lines carry `candidate=`, `previous=`, `revision=`, `result=` and
`reason=`, and are written with journal priorities: `notice` for deployments,
`warning` for rollbacks and blocks, `err` for failures, `crit` for a failed
rollback.

### Manual deployment, rollback, pause

| Command                             | Effect                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aetna-update check`                | Run one automatic cycle now.                                                                                                                                   |
| `aetna-update rollback`             | Redeploy `previous.digest` (with health and smoke checks), then block the digest rolled back from so the timer doesn't redeploy it. Rolls back the image only. |
| `aetna-update deploy sha256:<hex>`  | Deploy a specific digest of the repository, with verification and automatic rollback. **Pauses** automatic updates.                                            |
| `aetna-update retry [sha256:<hex>]` | Unblock a digest (default: what `production` resolves to now) and deploy it.                                                                                   |
| `aetna-update pause` / `resume`     | Stop or restart automatic updates. The timer keeps running but does nothing while paused.                                                                      |

To find a digest for an older commit: `docker buildx imagetools inspect ghcr.io/svansig/aetna-take-home:<commit-sha>`,
or the Publish run summary.

### Recovering from a failed deployment

1. `aetna-update status` and `journalctl -u aetna-update -p warning` show what
   failed and why (`reason=`), and whether the rollback succeeded.
2. **Rolled back** (`result=rolled-back`): production is serving the previous
   release, and nothing else is needed for availability. Fix the problem in the
   code and merge; the new release is a new digest and deploys automatically. If
   the failure was environmental (for example a dataset problem you have since
   fixed), run `aetna-update retry`.
3. **Preflight failed** (`result=preflight-failed`): the running release was
   never touched. Fix the host problem named in `reason=` (dataset, network,
   Compose file), then run `aetna-update retry`.
4. **Rollback failed** (`result=ROLLBACK-FAILED`) or **no previous release**:
   the API is down or unhealthy. Look at `docker logs aetna-api` and
   `docker ps -a`. The usual causes are host-side: missing or unreadable
   datasets, a missing `aetna-origin` network (`install.sh` recreates it), or a
   full disk. Fix the cause, then redeploy a known-good digest with
   `aetna-update deploy sha256:<known-good>` (this pauses updates), and later
   `aetna-update resume`.
5. If the updater itself is broken, deploy by hand. This is the same command the
   updater runs:

   ```sh
   API_IMAGE=ghcr.io/svansig/aetna-take-home@sha256:<digest> \
     docker compose -f /opt/aetna/compose.production.yaml --env-file /etc/aetna/aetna.env \
     up -d --no-deps --force-recreate api
   echo sha256:<digest> > /var/lib/aetna/current.digest
   ```

### Housekeeping

Old images accumulate, one per release. `docker image prune -a --filter until=168h`
removes unused images older than a week. The updater re-pulls a rollback target
by digest if it was pruned. Container logs are rotated by Docker (5 × 10 MB per
container).

To upgrade cloudflared, change the pinned tag and digest in
`deploy/compose.tunnel.yaml`, `git pull`, run `install.sh`, then run
`docker compose -f /opt/aetna/compose.tunnel.yaml up -d`.

## 10. Replacing datasets and V2

Datasets are **not** part of image releases and are never changed by
`aetna-update`. Rollback restores the image, not the data.

**Replacing a V1 file** (for example, restoring a corrupted copy) is a planned
operator action with brief downtime:

```sh
aetna-update pause
install -m 0444 /path/to/new/movies.db /srv/aetna/data/v1/movies.db.new
sqlite3 -readonly /srv/aetna/data/v1/movies.db.new 'PRAGMA quick_check; SELECT count(*) FROM movies;'
mv /srv/aetna/data/v1/movies.db.new /srv/aetna/data/v1/movies.db   # atomic rename
aetna-update retry "$(cat /var/lib/aetna/current.digest)"             # restart + full verification
aetna-update resume
```

The container holds the old file open, and a single-file bind mount keeps
pointing at the old inode after a rename. The retry recreates the container,
which then sees the new file. Keep the previous file until the new one is
verified.

**V2** (not implemented yet) uses a separately versioned dataset directory,
coordinated with the application version that needs it:

- Provision `/srv/aetna/data/v2/` with `movies.db`, a `VERSION` file (for example
  `2025-01-r1`) and `SHA256SUMS`, **before** the V2 release is merged.
- The V2 release declares what it needs in its Dockerfile:
  `LABEL dev.budarz.aetna.datasets="v1 v2" dev.budarz.aetna.dataset.v2="2025-01-r1"`.
- Enable the commented read-only `/app/data/v2` mount in
  `deploy/compose.production.yaml`, then `git pull && install.sh`.
- The updater then refuses to deploy that release (preflight failure, running
  release untouched) unless the v2 directory exists, the mount is enabled and
  read-only, `sha256sum -c SHA256SUMS` passes, `VERSION` matches the image label,
  and `movies.db` passes `quick_check` and has rows.

Images without the label are V1-only, so existing releases are unaffected.

## 11. Known limitations

- **Brief downtime on every deployment and rollback** (single replica, stop then
  start): Cloudflare returns 502 for the few seconds until the new container is
  healthy (about 5–15 s in local tests). Accepted by design.
- **Detection latency** is up to ~60 s after the `production` tag moves, plus
  pull and verification time.
- **Smoke tests are V1-data-specific** (for example, movie 11 must be Star Wars).
  A release that intentionally changes those responses must update
  `deploy/smoke-test.js` in the same change. The host runs its installed copy
  (`/opt/aetna/smoke-test.js`), so re-run `install.sh` when the smoke test changes.
- **Deployment files aren't auto-updated** (Compose files, updater, units). That's
  intentional (the host trusts only images, by digest), but changes need
  `git pull && install.sh`.
- **A failed first deployment has no rollback target**, so the API is stopped.
- **Blocking is per digest.** Rebuilding the same commit gives a new digest,
  which is a new candidate.
- **Transient registry or network errors** are retried every minute and logged
  at `err` each time until they clear.
- **External monitoring is log-only.** `aetna-public-check` writes to the
  journal; there's no paging or alerting integration.
- **The anonymous pull** depends on the GHCR package staying public.
- **`production` only moves forward along `main`.** After a history rewrite on
  `main`, the publish workflow refuses to move it, and an operator must retag by
  hand (`docker buildx imagetools create -t ghcr.io/svansig/aetna-take-home:production ghcr.io/svansig/aetna-take-home@sha256:…`
  with a token that has `write:packages`).

## 12. Test evidence

**Validated locally** (Docker 29.9 on Linux amd64, 2026-11-12). Not on Proxmox:

- CI commands pass on the current tree (format, lint, typecheck, 472 tests,
  build). Each fails with a non-zero exit for an intentionally failing test, a
  type error, a formatting violation, and a broken build configuration.
  `actionlint` 1.7.12 (with shellcheck) passes for both workflows; shellcheck
  0.11.0 passes for every script.
- The publish workflow's build, content-check, refuse-to-start-without-databases
  and smoke-test steps, run locally against a `linux/amd64` build: the image runs
  as `node`, holds no `.db` or `.env` files and no dev dependencies, exits
  without its databases, and becomes healthy and passes 8/8 smoke checks with
  read-only databases and a read-only root filesystem.
- The updater end to end, against a local OCI registry standing in for GHCR
  (same anonymous-token code path, with `http` for the local registry), the real
  `compose.production.yaml`, the internal `aetna-origin` network, and a stand-in
  container in another project playing the tunnel:
  - first deployment → `result=deployed`. Container: digest reference, image
    health check inherited, read-only rootfs, `cap_drop ALL`,
    `no-new-privileges`, no published ports, both databases mounted `rw=false`;
    reachable from the stand-in at `http://aetna-api:3000`.
  - unchanged tag → silent no-op, exit 0.
  - upgrade → `result=deployed`, `previous` recorded.
  - broken candidate that is healthy but serves the wrong API → smoke test
    fails (1/8) → blocked → `result=rolled-back`; the restored API serves movie
    11 through the stand-in tunnel network. Three further polls: exit 0, no
    redeploy (API start time unchanged).
  - crash-looping candidate → `reason="container restarted (crash loop)"` →
    blocked → `result=rolled-back`.
  - missing `ratings.db` and a corrupted `movies.db` → `result=preflight-failed`,
    running container untouched (same start time); after the data was fixed,
    `retry` → `result=deployed`.
  - concurrent run → "another aetna-update run is in progress; skipping".
  - `rollback` → previous restored, rolled-back digest blocked, next poll no-op.
  - `deploy <digest>` → deployed and paused, poll no-op, `resume`.
  - rollback target also broken (run as a systemd unit) → `result=ROLLBACK-FAILED`
    at `crit`, unit exit 2, `current.digest` unchanged; visible with
    `journalctl -p err`.
  - The tunnel stand-in's start time and restart count were unchanged across all
    of the above.
- systemd units pass `systemd-analyze verify`, and both Compose files pass
  `docker compose config`.

**Not validated (infrastructure unavailable during implementation):** the
workflows on GitHub (not pushed), GHCR publication and anonymous pull, the
Proxmox LXC (unprivileged Docker, storage driver), the Cloudflare Tunnel and
public hostname (`aetna-test.budarz.dev` doesn't resolve yet), and Swagger UI
through the public hostname. Steps 1–7 above are the acceptance procedure for
these.
