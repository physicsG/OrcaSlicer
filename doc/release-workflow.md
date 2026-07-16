# Manual release workflow

## Purpose

The `Manual Release Build` GitHub Actions workflow builds downloadable
Snapmaker Orca release artifacts from a selected branch, tag, or commit.

Build, signing, and publication are separate stages:

1. Validate the request and selected source revision.
2. Optionally run the Linux CI test gate.
3. Build the selected platforms with read-only repository permissions.
4. Optionally sign and notarize the macOS application.
5. Upload workflow artifacts with checksums and build manifests.
6. Optionally publish those existing artifacts through a protected job.

The default mode is `artifacts-only`. It never creates or updates a GitHub
release.

## Running a build

Open **Actions**, select **Manual Release Build**, and choose **Run workflow**.

The workflow accepts these inputs:

| Input | Description |
| --- | --- |
| `source_ref` | Branch, tag, or full commit SHA to build. |
| `build_linux` | Build the Ubuntu 24.04 AppImage. |
| `build_windows` | Build the Windows installer and portable archive. |
| `build_macos` | Build the macOS universal DMG. |
| `run_full_tests` | Run the Linux CI test gate before packaging. |
| `sign_artifacts` | Sign and notarize the macOS artifact. |
| `publish_mode` | Upload artifacts only, or create a protected release. |
| `version_label` | Optional safe label used in artifact and release names. |

At least one platform must be selected. Signing currently applies to macOS and
requires `build_macos`.

When `version_label` is empty, the workflow derives a label from the selected
tag or from the project version and commit SHA.

## Publication modes

### Artifacts only

`artifacts-only` builds the selected platforms and uploads workflow artifacts.
It does not request repository write permission and does not create a release.

Use this mode for development, QA, branch snapshots, and unsigned builds.

### Draft release

`draft-release` creates a draft GitHub release after all selected build jobs
succeed. Publication runs through the `release-publication` environment.

The workflow refuses to overwrite an existing release with the same tag.

### Prerelease

`prerelease` creates a published GitHub prerelease through the
`release-publication` environment.

Enable `run_full_tests` for externally distributed prereleases.

### Production release

`production-release` requires all of the following:

- Linux, Windows, and macOS are selected.
- The full Linux CI test gate succeeds.
- `source_ref` resolves to an annotated Git tag.
- The tag version matches `Snapmaker_VERSION` in `version.inc`.
- `version_label` matches the selected tag.
- The `production-release` environment grants approval.

For example, when `Snapmaker_VERSION` is `2.3.5`, create and push an annotated
tag such as:

```bash
git tag -a V2.3.5 -m "Snapmaker Orca 2.3.5"
git push origin V2.3.5
```

Select `V2.3.5` as `source_ref`. The version label may be left empty because it
will be derived from the tag.

## Platform artifacts

### Linux

The Ubuntu 24.04 job uploads:

```text
Snapmaker_Orca_Linux_AppImage_Ubuntu2404_<label>.AppImage
```

### Windows

The Windows Server 2022 job uploads:

```text
Snapmaker_Orca_Windows_Installer_<label>.exe
Snapmaker_Orca_Windows_<label>_portable.zip
```

When PDB files are present, it also uploads:

```text
Debug_PDB_<label>_for_developers_only.7z
```

### macOS

Unsigned builds upload:

```text
Snapmaker_Orca_Mac_universal_<label>_unsigned.dmg
```

Signed and notarized builds upload:

```text
Snapmaker_Orca_Mac_universal_<label>.dmg
```

## Checksums and manifests

Every platform bundle includes a SHA-256 sidecar for each distributable file
and a JSON build manifest:

```text
<artifact>.sha256
build-manifest-<platform>.json
```

The manifest records:

- repository and commit;
- selected source ref;
- project version and artifact label;
- platform and architecture;
- dependency cache key;
- workflow run URL;
- test result state;
- signing state;
- file sizes and SHA-256 digests.

The publication job verifies manifests and checksums before creating a release.

## Protected environments

Create these environments under the repository's Actions settings.

### `release-signing`

Use this environment for macOS signing and notarization. Configure required
reviewers and add these environment secrets:

| Secret | Purpose |
| --- | --- |
| `BUILD_CERTIFICATE_BASE64` | Base64-encoded Developer ID certificate. |
| `P12_PASSWORD` | Password for the certificate archive. |
| `KEYCHAIN_PASSWORD` | Temporary CI keychain password. |
| `MACOS_CERTIFICATE_ID` | Codesigning certificate identity. |
| `APPLE_DEV_ACCOUNT` | Apple developer account used by `notarytool`. |
| `TEAM_ID` | Apple developer team identifier. |
| `APP_PWD` | App-specific Apple account password. |

The signing job runs only when `sign_artifacts` is explicitly enabled.

### `release-publication`

Use this environment to approve draft and prerelease publication. It requires
no custom secrets; GitHub's job token receives repository write permission only
inside the publication workflow.

### `production-release`

Use this environment for final releases. Configure required reviewers and
restrict deployment branches or tags according to the repository's release
policy.

## Trust boundary

The workflow checks out release-control scripts from the workflow revision and
the selected source into separate directories.

The selected source supplies the application code and version metadata, but
protected signing and publication jobs execute only trusted control scripts.
Checkout credentials are not persisted in either source tree.

Reusable build workflows have read-only repository permissions and are checked
by CI for prohibited publication, tag mutation, Sentry upload, and direct push
behavior.

## Legacy scheduled builds

The existing `Build all` schedule remains available as a compatibility build.
It now uploads workflow artifacts only. It no longer deploys nightly release
assets, force-pushes tags, uploads symbols, signs automatically, or inherits
release credentials.
