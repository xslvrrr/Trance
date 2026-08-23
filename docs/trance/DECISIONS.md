# Trance decision log

Append-only. Newest at the bottom. One entry per decision that a future session would
otherwise re-litigate. Anything here supersedes `TRANCE.md` if they conflict — and if that
happens, update `TRANCE.md` too.

Format:

```
## ADR-NNN — Title
**Date:** YYYY-MM-DD · **Status:** accepted | superseded by ADR-MMM
**Context:** why this came up
**Decision:** what we do
**Consequences:** what this costs / forecloses
```

---

## ADR-001 — Fork lineage reconstructed from upstream/dev rather than a tag

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The local source drop had no `.git`. It matched `zen-browser/desktop` at
`upstream/dev` HEAD (`ed0a6fd`), byte-identical across every tracked path, rather than the
`1.21.15b` release tag.

**Decision:** `git init`, add `upstream` remote, point `main` at `ed0a6fd`. Track `dev`, not
release tags.

**Consequences:** Trance follows Zen's development branch. Faster access to fixes, more churn,
and rebases must be frequent (weekly) or they get expensive. Release-tag stability is available
later by branching from a tag if we ever want a slower channel.

---

## ADR-002 — Reimplement mod features natively instead of bundling mods

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The user's pain (visual artifacts, power drain) is structural: N independent
stylesheets, N observers, N blur layers, N timers. Bundling the mods preserves all of it.
Separately, 2 of 23 mods are GPL-3.0 and 12 have no license at all.

**Decision:** Trance reimplements the *behaviours* in Trance-owned source under
`src/zen/trance/`, on a shared foundation layer (tokens, scheduler, observer hub). No third-party
mod code is vendored except from MIT/Apache-2.0 sources, with attribution.

**Consequences:** Much more work up front. Visual fidelity to the originals is approximate, not
pixel-exact. In exchange: conflicts are impossible by construction, the power budget is
enforceable, licensing is clean, and there is one upstream sync surface instead of 23.

---

## ADR-003 — Extensions installed via enterprise policy, not vendored XPIs

**Date:** 2026-08-24 · **Status:** accepted

**Context:** Five of the seven required extensions are GPL/LGPL. Vendoring their XPIs into an
MPL-2.0 distribution creates licensing entanglement and freezes their versions.

**Decision:** Ship `distribution/policies.json` with `ExtensionSettings` entries using
`installation_mode: normal_installed` and AMO `install_url`s.

**Consequences:** First run needs network. Extensions auto-update from AMO and remain
user-removable. No third-party binaries in the repo. A first-run status panel is required so a
failed install is visible rather than silent.

---

## ADR-004 — Zen's native mods system stays in place

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `src/zen/mods/` is upstream code (JS + C++ + IDL + actors). Removing it would
significantly widen the upstream diff surface for no functional gain.

**Decision:** Keep it untouched and functional. Mods that Trance reimplements are simply not
installed by default, and the first-run panel explains that Trance's built-ins replace them.

**Consequences:** Users can still install Zen mods and thereby recreate the exact conflicts
Trance exists to solve. Acceptable — it is their browser. Document the risk, do not block it.

---

## ADR-005 — Host on the existing public fork `xslvrrr/Trance`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The original intent was a private repo. Two things made that expensive:

- GitHub cannot convert a fork to private, and `xslvrrr/Trance` was already a public fork of
  `zen-browser/desktop` — the source this working copy came from.
- Pushing Zen's full 6,951-commit history (5.6 GB) to a *fresh* repo over HTTPS fails: GitHub
  returns HTTP 500 on packs above roughly a thousand commits, so it needs ~30 sequential chunked
  pushes. SSH would avoid this, but there is no key on the machine and the `gh` token lacks
  `admin:public_key`.

A fork already shares GitHub's object store with its parent, so pushing there uploads only the
new commits.

**Decision:** `origin` = `https://github.com/xslvrrr/Trance.git`, default branch `main`.
Accept public visibility during pre-branding development.

**Consequences:**
- Pushes are effectively instant for as long as Trance's own diff stays small.
- The repo is public while it still carries Zen branding. Acceptable for now, but **Phase 1
  branding is on the critical path** for anything resembling a release or promotion — see §7.4.
- Being a GitHub fork, the PR UI defaults its base to `zen-browser/desktop`. Check the base
  branch on every PR.
- `xslvrrr/trance-browser` (private, ~1.5k commits of partial history) is now an unused
  leftover. Delete it when convenient — it holds nothing unique.
