# Running on a Linux server

The bridge as a systemd service: it starts at boot, restarts if it crashes, and
logs to the journal. Written for Debian / Ubuntu / Raspberry Pi OS; any distro
with systemd works the same way.

What the service needs from the machine is small: outbound HTTP to WLED,
outbound WebSocket to Home Assistant, and inbound TCP on `PORT` (8000) for the
editor (step 6).

The server runs a `git` checkout. Deploying a new version is `git pull` and a
restart (see "Updating"). The two files that hold the server's own state,
`.env` and `panel.config.json`, are gitignored, so a pull never touches them.

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

A system user with no login and no home, which only runs the service. The
checkout belongs to you, so you `git pull` with your own credentials. Its group
is the service user's:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin wled-bridge
```

```bash
sudo install -d -o "$USER" -g wled-bridge -m 2775 /opt/wled-ha-bridge
```

The directory has to be group-writable. A save writes `panel.config.json.tmp`
and renames it over the original, and both of those need write access to the
directory itself, not just to the file. The setgid bit (the `2` in `2775`)
gives everything created in it the `wled-bridge` group, so the service can read
what you check out and you can read what it saves.

## 3. Clone the code

Clone from wherever you push this repository. For a private repository, give
your server user read access first, for example a read-only deploy key on
GitHub.

```bash
git clone <repo-url> /opt/wled-ha-bridge
```

```bash
ls -ld /opt/wled-ha-bridge
```

That should still show `drwxrwsr-x you wled-bridge`. If the clone reset it, run
`sudo chmod 2775 /opt/wled-ha-bridge && sudo chgrp wled-bridge /opt/wled-ha-bridge`.

## 4. Configure

Write `/opt/wled-ha-bridge/.env` from `.env.example` and fill in `HA_BASE_URL`,
`HA_TOKEN` and `WLED_IP`. Make a fresh long-lived token for the server rather
than reusing your laptop's, so either can be revoked alone. Mode `640` lets the
service read it through its group, and nobody else read it at all.

```bash
cp /opt/wled-ha-bridge/.env.example /opt/wled-ha-bridge/.env
```

```bash
chmod 640 /opt/wled-ha-bridge/.env
```

```bash
nano /opt/wled-ha-bridge/.env
```

`panel.config.json` is seeded from `.env` on first start. To keep the flow you
have already built instead, copy your current one across before starting
(`scp panel.config.json you@server:/opt/wled-ha-bridge/`). An older file
version is fine; it is upgraded as it is read.

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

The server listens on every interface, so the editor is at
`http://<server>:8000` from anywhere on the LAN. Saves land in
`/opt/wled-ha-bridge/panel.config.json` and apply immediately, with no restart.

`PUT /api/config` has no authentication, so anyone who can reach that port can
rewrite the panel. On a home LAN that may be fine. If it isn't, firewall the
port to loopback (for example `sudo ufw deny 8000`) and use an SSH tunnel from
your machine instead:

```bash
ssh -N -L 8000:127.0.0.1:8000 you@server
```

and browse to http://127.0.0.1:8000.

## Updating

Push from your machine, then on the server:

```bash
git -C /opt/wled-ha-bridge pull --ff-only
```

```bash
sudo systemctl restart wled-ha-bridge
```

`.env` and `panel.config.json` are in `.gitignore`, so the pull leaves them
alone: the editor's saved flow and the server's token survive every deploy.
`--ff-only` refuses to merge, so a server checkout that has drifted stops
with an error instead of making a merge commit. Never edit tracked files on
the server. If a pull refuses because of local changes, `git status` names
them, and `git checkout -- <file>` discards them.

If you ever copy a `panel.config.json` over by hand, restart afterwards; the
service only reads it at start-up.

If the update changes `deploy/wled-ha-bridge.service`, copy it to
`/etc/systemd/system/` again and run `sudo systemctl daemon-reload` before
restarting.

### Switching over from an rsync install

An `/opt/wled-ha-bridge` copied in with `rsync` is not a checkout. Keep its two
state files, put a clone in its place, and put them back:

```bash
sudo systemctl stop wled-ha-bridge
```

```bash
sudo cp /opt/wled-ha-bridge/.env /opt/wled-ha-bridge/panel.config.json ~/
```

```bash
sudo mv /opt/wled-ha-bridge /opt/wled-ha-bridge.old
```

Then do steps 2 (the `install -d` line only) and 3, and:

```bash
sudo install -o "$USER" -g wled-bridge -m 640 ~/.env ~/panel.config.json /opt/wled-ha-bridge/
```

```bash
sudo systemctl start wled-ha-bridge
```

Once it is running, delete `/opt/wled-ha-bridge.old` and the two copies in your
home directory. The copy of `.env` holds the token.

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
- **`ProtectSystem=strict` makes everything read-only for the service except
  `/opt/wled-ha-bridge` and the cache directory.** If you move the install,
  change `WorkingDirectory` and `ReadWritePaths` together, or the editor's saves
  fail with a permission error while everything else looks fine.
- **The macOS Local Network Privacy note in the main README does not apply
  here.** A `No route to host` on Linux is a real network or firewall problem.
