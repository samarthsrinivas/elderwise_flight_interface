# macOS code signing & notarization setup

Step-by-step runbook for wiring the Apple signing secrets into this repo so
releases ship signed and notarized. The secrets are shared with the
pulsewise repo and were copied into this one.

## Current state

- The [`release`](../.github/workflows/release.yml) workflow already supports
  the full signed path (since #37). It gates on two job-level flags:
  - `HAS_APPLE_CERT` — true only when **all four** signing secrets are
    non-empty (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
    `KEYCHAIN_PASSWORD`, `APPLE_SIGNING_IDENTITY`);
  - `HAS_NOTARY_KEY` — true only when **all three** notarization secrets are
    non-empty (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT`).
- The repository secrets are configured. The
  [`signing-preflight`](../.github/workflows/signing-preflight.yml) workflow
  validates both the Developer ID certificate and the App Store Connect
  notarization credentials on `macos-15` before a release tag needs them.
- Forks or local copies without the secrets still build **unsigned**. With all
  seven secrets present, release tags ship signed + notarized with **zero code
  changes**.
- The signing identity is pinned in
  [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json):
  `Developer ID Application: AJENTIK AI PTE. LTD. (6SJY3B6C35)`.

---

## Part 1 — Developer ID Application certificate

*~10 minutes. Requires the **Account Holder** role on Apple Developer team
`6SJY3B6C35` — no other role can create Developer ID certificates.*

1. **Create a CSR** on a Mac: **Keychain Access → Certificate Assistant →
   Request a Certificate From a Certificate Authority…**
   - User email: yours; Common Name: anything (e.g. `Elderwise CI`);
     CA email: leave empty; select **"Saved to disk"**.
   - Save `CertificateSigningRequest.certSigningRequest`. This also creates
     the private key in your login keychain.
2. **Create the certificate** at
   [developer.apple.com/account/resources/certificates/add](https://developer.apple.com/account/resources/certificates/add):
   - Under *Software*, pick **Developer ID Application** (this option only
     appears for the Account Holder).
   - Upload the CSR, download `developerID_application.cer`.
3. **Install it**: double-click the `.cer` — it lands in the **login**
   keychain and pairs with the private key from step 1.
4. **Verify the pairing**:

   ```sh
   security find-identity -v -p codesigning
   ```

   The output must list
   `Developer ID Application: AJENTIK AI PTE. LTD. (6SJY3B6C35)` as valid.
   If it shows *"not trusted"*, install Apple's **Developer ID G2**
   intermediate certificate from
   [apple.com/certificateauthority](https://www.apple.com/certificateauthority/)
   and re-check.
5. **Export the `.p12`**: Keychain Access → **My Certificates** tab →
   right-click the certificate → **Export** → format `.p12` → set a
   **non-empty password**.
   - ⚠️ Use the **My Certificates** tab, not "Certificates" — the row must
     have a disclosure triangle showing the private key, or the export will
     not contain it and CI signing will fail.
   - ⚠️ Export with Keychain Access, **not** `openssl` — OpenSSL 3.x's
     default PKCS#12 ciphers are not readable by `security import` on the CI
     runner.

## Part 2 — App Store Connect API key (notarization)

*~5 minutes. Requires Admin (or Account Holder) on App Store Connect.*

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) →
   **Users and Access → Integrations → App Store Connect API → Team Keys →
   Generate API Key**.
2. Name it (e.g. `Elderwise notarization`); role: **Developer** is
   sufficient.
3. Record two values from that page:
   - the **Issuer ID** — the UUID shown at the top;
   - the key's **Key ID** — e.g. `A1B2C3D4E5`.
4. **Download the `.p8` file.**
   - ⚠️ It can be downloaded **exactly once**. Store it somewhere safe
     (password manager / secrets vault).

## Part 3 — Set the 7 repository secrets

*~2 minutes, from the repo directory. Names must be exact.*

```sh
cd /path/to/elderwise-hbs

# Signing — all four required, or the workflow falls back to unsigned
gh secret set APPLE_CERTIFICATE          --body "$(base64 -i /path/to/DeveloperID.p12)"
gh secret set APPLE_CERTIFICATE_PASSWORD --body 'the-p12-export-password'
gh secret set APPLE_SIGNING_IDENTITY     --body 'Developer ID Application: AJENTIK AI PTE. LTD. (6SJY3B6C35)'
gh secret set KEYCHAIN_PASSWORD          --body "$(openssl rand -base64 24)"

# Notarization — all three required, or the build signs but skips notarization
gh secret set APPLE_API_ISSUER      --body '<the Issuer ID UUID>'
gh secret set APPLE_API_KEY         --body '<the Key ID, e.g. A1B2C3D4E5>'
gh secret set APPLE_API_KEY_CONTENT < /path/to/AuthKey_<KEYID>.p8
```

Notes:

- `APPLE_API_KEY_CONTENT` is the **contents of the `.p8` file** (the whole
  `-----BEGIN PRIVATE KEY-----` block). The workflow writes it to disk on the
  runner at build time. There is **no** `APPLE_API_KEY_PATH` secret — that
  was the broken design removed in #37.
- `KEYCHAIN_PASSWORD` is any random string; it only unlocks the throwaway CI
  keychain.
- Verify with `gh secret list` — all seven `APPLE_*`/`KEYCHAIN_*` names
  should be present.

## Part 4 — Optional preflight (burns no release)

Validate the repository secrets end-to-end before trusting a tag to them:

```sh
gh workflow run signing-preflight.yml --ref main
gh run watch <run-id> --exit-status
```

For local verification against files on your Mac:

```sh
# Signs locally: tauri picks up the signingIdentity from your login keychain
bun run tauri build

# Submit the local dmg for notarization with the new API key
xcrun notarytool submit src-tauri/target/release/bundle/dmg/elderwise_*.dmg \
  --key /path/to/AuthKey_<KEYID>.p8 \
  --key-id <KEYID> \
  --issuer '<the Issuer ID UUID>' \
  --wait
```

`status: Accepted` means both credentials work.

## Part 5 — Signed release verification

1. Cut the next release as usual (version bump PR → merge → push tag). With
   the current repository secrets, the workflow uses the signed + notarized
   path automatically.
2. Verify the shipped artifact the way Gatekeeper does:

   ```sh
   curl -sLo elderwise.dmg https://elderwise.yanok.workers.dev/downloads/elderwise-apple-silicon.dmg
   hdiutil attach elderwise.dmg -nobrowse
   codesign -dv --verbose=2 /Volumes/elderwise/elderwise.app   # Authority=Developer ID Application: AJENTIK AI PTE. LTD.
   spctl -a -vv /Volumes/elderwise/elderwise.app               # accepted, source=Notarized Developer ID
   hdiutil detach /Volumes/elderwise
   ```

3. Done.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `security import ... invalid parameters` in CI | The `.p12` is empty or cert-only — re-export from **My Certificates** with the private key, or the base64 secret got mangled (regenerate with `base64 -i`). |
| `security import ... MAC verification failed` | Wrong `APPLE_CERTIFICATE_PASSWORD`, or the `.p12` was exported with OpenSSL 3.x ciphers — re-export via Keychain Access. |
| Build succeeds but unsigned | One of the four signing secrets is missing/empty — `HAS_APPLE_CERT` requires all four. Check `gh secret list` for typos in names. |
| Signed but not notarized | One of the three `APPLE_API_*` secrets is missing/empty (`HAS_NOTARY_KEY` requires all three), or the key's role is insufficient. |
| `codesign` can't find the identity locally | The cert isn't in the login keychain, or the private key didn't pair — redo Part 1 steps 3–4. |
| Notarization `status: Invalid` | Run `xcrun notarytool log <submission-id> --key ... --key-id ... --issuer ...` for the itemized report. |
