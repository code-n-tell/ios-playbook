## platform-feature-01-risk-02-control-02

### Description

Detect IPA repackaging.

### Demonstration

#### 01. Obtain the expected signing Team ID

Obtain the Team ID (the `Application Identifier Prefix`) from the build system that signs the app. The Team ID identifies the Apple Developer account whose signing certificate the build is configured to use, so read it from the project's signing configuration on the build machine rather than from a distributed copy.

``` shell
xcodebuild -project "<PROJECT_NAME>.xcodeproj" -showBuildSettings 2>/dev/null \
    | grep -m1 "DEVELOPMENT_TEAM"
```

_Code block prints the `DEVELOPMENT_TEAM` (Team ID) configured for signing on the build system._

The same value is shown in Xcode under Signing & Capabilities and in the Apple Developer portal under Membership. Copy the resulting 10-character value and treat it as the expected signing Team ID.

``` text
<EXPECTED_TEAM_ID>
```

#### 02. Store the expected Team ID

Add the expected Team ID to the app as a constant so the runtime check has a reference value. Keep the value in the application rather than downloading it at runtime. The Team ID is not a secret; its purpose is to provide an expected value for the comparison.

``` swift
private let expectedTeamID = "<EXPECTED_TEAM_ID>"
```

_Code block stores the expected signing Team ID compiled into the application executable._

#### 03. Read the running app's Team ID

Use the keychain to store the `TeamID`. A keychain item added without an explicit access group is placed in the app's default access group, whose name is `"<TeamID>.<BundleID>"`. 

``` swift
import Security

func readSigningTeamID() -> String? {
    let probe: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "signing-identity-probe",
        kSecAttrAccount as String: "signing-identity-probe"
    ]

    var query = probe
    query[kSecReturnAttributes as String] = kCFBooleanTrue as Any
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    var status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
        SecItemAdd(probe as CFDictionary, nil)
        status = SecItemCopyMatching(query as CFDictionary, &item)
    }

    guard status == errSecSuccess,
          let attributes = item as? [String: Any],
          let accessGroup = attributes[kSecAttrAccessGroup as String] as? String,
          let teamID = accessGroup.split(separator: ".").first else {
        return nil
    }
    return String(teamID)
}
```

_Code block reads the access group the OS assigns to the app and returns its Team ID prefix._

#### 04. Compare the Team IDs

Compare the Team ID read from the running app with the expected Team ID stored in the app. Treat a missing Team ID as a failed check, so the control fails closed rather than passing when the signing identity cannot be determined.

``` swift
guard let currentTeamID = readSigningTeamID(), !currentTeamID.isEmpty else {
    throw IntegrityError.signingInformationUnavailable
}

guard currentTeamID == expectedTeamID else {
    throw IntegrityError.unexpectedSigningIdentity
}
```

_Code block fails the check when the Team ID cannot be read or does not match the expected value._

Treat a mismatch as an indication that the app is running under a different signing identity and may have been repackaged and re-signed.

#### 05. Block the repackaged app

Run the check immediately when the application launches. If verification fails, clear session data, show a generic security error, and prevent sensitive functionality from continuing.

``` swift
do {
    try verifySigningIdentity()
    enableSensitiveFeatures()
} catch {
    clearSessionData()
    showGenericSecurityError()
    disableSensitiveFeatures()
}
```

_Code block shows the application response when the signing-identity check fails._

### References

- [https://developer.apple.com/documentation/security/keychain-services](https://developer.apple.com/documentation/security/keychain-services)
- [https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
- [https://developer.apple.com/documentation/devicecheck/dcappattestservice](https://developer.apple.com/documentation/devicecheck/dcappattestservice)

The source code with the implemented control can be found [here](implemented_controls/platform-feature-01-risk-02-control-02.zip).
