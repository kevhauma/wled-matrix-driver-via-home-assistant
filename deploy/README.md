# Running on a Linux server

The bridge as a systemd service: it starts at boot, restarts if it crashes, and
logs to the journal. Written for Debian / Ubuntu / Raspberry Pi OS; any distro
with systemd works the same way.

What the service needs from the machine is small: outbound HTTP to WLED,
outbound WebSocket to Home Assistant, and nothing inbound. The editor stays on
loopback and you reach it over SSH (step 6).

## 1. Install Deno

System-wide, so the service user can run it. Pin the version you develop on
(`deno --version` on your machine):

```bash
curl -fsSL https://deno.land/install.sh | sudo DENO_INSTALL=/usr/local sh -s v2.5.6
```

```bash
/usr/local/bin/deno --version
```

## 2. Create the service user and directory

A system user with no login and no home. It must own the project directory,
not just `panel.config.json`: a save writes `panel.config.json.tmp` and renames
it over the original, and both need write access to the directory.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin wled-bridge
```

```bash
sudo install -d -o wled-bridge -g wled-bridge -m 750 /opt/wled-ha-bridge
```

## 3. Copy the code

From your machine, in `wled-ha-bridge/`. This stages the code in your home
directory on the server; `.env` and `panel.config.json` are excluded because
they are the server's own state from here on (see "Updating").

```bash
rsync -av --delete --exclude .git --exclude .env --exclude 'panel.config.json*' ./ you@server:wled-ha-bridge/
```

Then on the server, move it into place:

```bash
sudo rsync -a --delete --exclude .env --exclude 'panel.config.json*' --chown=wled-bridge:wled-bridge ~/wled-ha-bridge/ /opt/wled-ha-bridge/
```

Do not `git clone` the repository onto the server as it stands: `.env`, with a
real Home Assistant token in it, is committed.

## 4. Configure

Write `/opt/wled-ha-bridge/.env` from `.env.example` and fill in `HA_BASE_URL`,
`HA_TOKEN` and `WLED_IP`. Make a fresh long-lived token for the server rather
than reusing your laptop's, so either can be revoked alone.

```bash
sudo -u wled-bridge cp /opt/wled-ha-bridge/.env.example /opt/wled-ha-bridge/.env
```

```bash
sudo -u wled-bridge chmod 600 /opt/wled-ha-bridge/.env
```

```bash
sudo -u wled-bridge nano /opt/wled-ha-bridge/.env
```

`panel.config.json` is seeded from `.env` on first start. To keep the flow you
have already built instead, copy your current one across before starting
(`scp panel.config.json you@server:` then
`sudo install -o wled-bridge -g wled-bridge -m 640 ~/panel.config.json /opt/wled-ha-bridge/`).
An older file version is fine; it is upgraded as it is read.

Then check the connection before involving systemd. `doctor` names the failing
step if there is one:

```bash
cd /opt/wled-ha-bridge && sudo -u wled-bridge DENO_DIR=/tmp/deno-doctor deno task doctor
```

## 5. Install and start the service

```bash
sudo cp /opt/wled-ha-bridge/deploy/wled-ha-bridge.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now wled-ha-bridge
```

`enable` is what makes it survive a reboot; `--now` also starts it. Check it:

```bash
systemctl status wled-ha-bridge
```

```bash
journalctl -u wled-ha-bridge -f
```

You should see the same start-up banner as `deno task start` prints locally,
then `live` once Home Assistant's snapshot lands. Prove the reboot path once:

```bash
sudo reboot
```

and after it comes back, `systemctl status wled-ha-bridge` should say
`active (running)` without you doing anything.

## 6. Reach the editor

The server binds `127.0.0.1` on purpose — `PUT /api/config` has no
authentication — so open an SSH tunnel from your machine:

```bash
ssh -N -L 8000:127.0.0.1:8000 you@server
```

and browse to http://127.0.0.1:8000 as usual. Saves land in
`/opt/wled-ha-bridge/panel.config.json` and apply immediately; no restart.

Exposing the editor on the LAN instead means changing the hard-coded
`hostname` in `server.ts` *and* putting authentication in front of it (a
reverse proxy with basic auth, at least). Don't do the first without the
second.

## Updating

Repeat step 3 (both `rsync` commands), then:

```bash
sudo systemctl restart wled-ha-bridge
```

The excludes are what protect the server's state: `--delete` never removes an
excluded file, so `.env` and the editor's saved `panel.config.json` survive.
If you ever copy a `panel.config.json` over by hand, restart afterwards; the
service only reads it at start-up.

If you change `deploy/wled-ha-bridge.service`, copy it to `/etc/systemd/system/`
again and run `sudo systemctl daemon-reload` before restarting.

## How it behaves

- **Lost connections do not restart the process.** Home Assistant going away is
  handled inside it, with a backing-off reconnect up to a cap, and a fresh
  subscription is the catch-up. So the service also starts fine at boot before
  Home Assistant is up.
- **A configuration error does.** A bad `.env` or hand-edited
  `panel.config.json` exits 1 with the validator's message. systemd retries
  five times in two minutes and then gives up with the unit `failed`; fix the
  file and `sudo systemctl restart wled-ha-bridge` (or
  `sudo systemctl reset-failed wled-ha-bridge` first if it refuses).
- **`systemctl stop` is clean.** systemd sends SIGTERM to the whole process
  group, which reaches the Deno process under `deno task` and runs its own
  shutdown.

## Things that bite

- **The working directory matters.** Deno's read/write grants are relative to
  it, which is why the unit sets `WorkingDirectory` and runs `deno task start`
  rather than a bare `deno run` with an absolute path.
- **Logs may not survive a reboot.** On distros where journald keeps logs in
  memory only, `journalctl -u wled-ha-bridge -b -1` shows nothing for the last
  boot. `sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald`
  makes them persistent. The bridge logs a line per panel change, which the
  journal's own size cap handles.
- **`ProtectSystem=strict` makes everything read-only except
  `/opt/wled-ha-bridge` and the cache directory.** If you move the install,
  change `WorkingDirectory` and `ReadWritePaths` together, or the editor's saves
  fail with a permission error while everything else looks fine.
- **The macOS Local Network Privacy note in the main README does not apply
  here.** A `No route to host` on Linux is a real network or firewall problem.
