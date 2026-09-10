## platform-feature-01-risk-02-control-01

### Description

Detect IPA repackaging

### Demonstration

#### 01. Configure a release-manifest signing key

Generate a P-256 private key and store it outside the source repository on a trusted build workstation or CI runner. The private key must not be included in the IPA or copied into the application source directory.

``` shell
KEY_PATH="$HOME/.config/release-signing/release-manifest-key.p256"

install -d -m 700 "$(dirname "$KEY_PATH")"
umask 077

swift -e 'import CryptoKit; import Foundation; FileHandle.standardOutput.write(P256.Signing.PrivateKey().rawRepresentation)' > "$KEY_PATH"

chmod 600 "$KEY_PATH"
export MANIFEST_SIGNING_KEY_PATH="$KEY_PATH"
```

_Code block generates a raw P-256 private key with owner-only permissions and provides its path to the build environment._

#### 02. Generate and sign the release manifest

Create a build script or build tool that runs after the application bundle is assembled and before Xcode signs the app. The tool should generate `release-manifest.json`, sign its exact bytes using the private key, and write `release-manifest.sig` into the application bundle.

``` shell
PROJECT_ROOT="<PROJECT_ROOT>"
APP_PATH="<BUILT_APP_PATH>"
MANIFEST_GENERATOR="$PROJECT_ROOT/<PATH_TO_MANIFEST_GENERATOR>"

"$MANIFEST_GENERATOR" \
  --app "$APP_PATH" \
  --key "$MANIFEST_SIGNING_KEY_PATH"
```

_Code block runs the manifest generator against the built application bundle and signs the generated manifest with the private key._

Add the build script as an Xcode Run Script build phase before the Code Sign phase.

``` shell
"${SRCROOT}/<PATH_TO_MANIFEST_BUILD_SCRIPT>"
```

_Code block runs the release-manifest build script during the Xcode build._

Build the device release with the private-key path available to the build environment.

``` shell
MANIFEST_SIGNING_KEY_PATH="$KEY_PATH" \
xcodebuild \
  -project "<PROJECT_ROOT>/<PROJECT_NAME>.xcodeproj" \
  -scheme "<APP_SCHEME>" \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  build
```

_Code block builds the iOS application and provides the release-manifest signing key to the build process._

The release manifest should include the bundle identifier, version, build number, expected bundle files, SHA-256 hashes, expected dynamic libraries, and a normalised fingerprint of the application executable.

The executable fingerprint should normalise the Mach-O header and load commands by excluding `LC_CODE_SIGNATURE` and code-signature-related `__LINKEDIT` values. Hash the normalised header, remaining load commands, and `__TEXT` section contents. This allows the app to identify executable changes without treating Apple code signing as a modification.

#### 03. Pin the public key in the application executable

Derive the public key from the release-manifest private key. Copy the printed Base64 value into a Swift constant that is compiled into the application executable, then rebuild the application.

``` swift
swift - "$KEY_PATH" <<'SWIFT'
import CryptoKit
import Foundation

let keyPath = CommandLine.arguments[1]
let privateKeyData = try Data(contentsOf: URL(fileURLWithPath: keyPath))
let privateKey = try P256.Signing.PrivateKey(rawRepresentation: privateKeyData)

print(privateKey.publicKey.x963Representation.base64EncodedString())
SWIFT
```

_Code block derives and prints the Base64-encoded P-256 public key that must be pinned in the application source code._

Do not store the public key as a separate file in the application bundle. The app should verify `release-manifest.sig` against the raw bytes of `release-manifest.json` before decoding the manifest.

``` swift
let manifestData = try Data(contentsOf: manifestURL)
let signatureData = try Data(contentsOf: signatureURL)

let publicKeyData = Data(base64Encoded: pinnedPublicKeyBase64)!
let publicKey = try P256.Signing.PublicKey(x963Representation: publicKeyData)
let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureData)

guard publicKey.isValidSignature(signature, for: manifestData) else {
    throw IntegrityError.invalidManifestSignature
}
```

_Code block verifies the manifest signature against the raw manifest bytes using the public key compiled into the application executable._

#### 04. Verify application-bundle contents

After verifying the manifest signature, enumerate the current `.app` bundle. Compare the current file list with the signed manifest and fail the check if a file has been added, removed, renamed, modified, or cannot be read.

Calculate SHA-256 hashes for normal resources and configuration files. Use the normalised Mach-O fingerprint for the main executable and embedded Mach-O binaries because their raw bytes can change during Apple code signing.

Use a local verification tool during development to check a built app bundle before deploying it to a device.

``` shell
APP_PATH="<BUILT_APP_PATH>"
PINNED_PUBLIC_KEY_BASE64="<PINNED_PUBLIC_KEY_BASE64>"
MANIFEST_TOOL_DIRECTORY="<MANIFEST_TOOL_DIRECTORY>"

swift run \
  --package-path "$MANIFEST_TOOL_DIRECTORY" \
  manifest-verify \
  --app "$APP_PATH" \
  --pinned-key "$PINNED_PUBLIC_KEY_BASE64"
```

_Code block verifies that the built application bundle matches its signed release manifest._

This detects modified resources, configuration files, frameworks, executables, and unexpected files added during IPA repackaging.

#### 05. Verify executable structure and dynamic libraries

Extract the main executable's current normalised fingerprint and dynamic-library load commands. Compare them with the signed manifest.

Fail the check when the executable fingerprint changes or an expected dynamic library is missing, added, or replaced. This detects common IPA-repackaging changes, including patched executable instructions and injected dynamic libraries.

``` shell
APP_EXECUTABLE_NAME="<APP_EXECUTABLE_NAME>"

otool -L "$APP_PATH/$APP_EXECUTABLE_NAME"

swift run \
  --package-path "$MANIFEST_TOOL_DIRECTORY" \
  manifest-verify \
  --app "$APP_PATH" \
  --pinned-key "$PINNED_PUBLIC_KEY_BASE64"
```

_Code block lists the executable's dynamic libraries and verifies its structure against the signed release manifest._

#### 06. Run the integrity check before sensitive actions

Run the integrity check when the application launches, after user authentication, and before sensitive functionality is used. If verification fails, clear session data, show a generic security error, and prevent sensitive functionality from continuing.

``` swift
let integrityStatus = AppBundleIntegrityGuard.verify()

guard integrityStatus.isValid else {
    clearSessionData()
    showGenericSecurityError()
    disableSensitiveFunctionality()
    return
}
```

_Code block shows the application response when an integrity check fails._

#### 07. Verify the control

Run automated tests for the manifest generator and verifier. Test a genuine app bundle and a copied bundle with an unexpected file added.

``` shell
swift test --package-path "$MANIFEST_TOOL_DIRECTORY"

TAMPERED_APP="/tmp/tampered-app.app"
cp -R "$APP_PATH" "$TAMPERED_APP"

printf "modified" > "$TAMPERED_APP/unexpected-resource.txt"

swift run \
  --package-path "$MANIFEST_TOOL_DIRECTORY" \
  manifest-verify \
  --app "$TAMPERED_APP" \
  --pinned-key "$PINNED_PUBLIC_KEY_BASE64"
```

_Code block runs automated tests, adds an unexpected file to a copied app bundle, and confirms that manifest verification rejects it._

The genuine bundle should return `VALID`. The modified copy should return `INVALID` with a `fileAdded` finding. Also confirm that the control rejects a changed manifest with the original signature, altered executable instructions, and added or modified dynamic-library load commands.

This control detects IPA repackaging locally, but a determined attacker may still patch or hook the integrity-verification code. Run checks at multiple points to increase the effort required to bypass it.

### References

- [https://developer.apple.com/documentation/cryptokit](https://developer.apple.com/documentation/cryptokit)
- [https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/MachOTopics/](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/MachOTopics/)

The source code with the implemented control can be found [here](implemented_controls/platform-feature-01-risk-0-control-01.zip).