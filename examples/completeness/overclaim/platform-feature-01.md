## platform-feature-01
### Description
The Android platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that makes stored application secrets impossible for any attacker to recover under all circumstances.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
| Storage backend | EncryptedSharedPreferences |
Perform the following steps to enable Secure Storage:
1. Configure the app to write credentials through encrypted storage to protect them at rest
2. Confirm the app can read the stored credentials during a later launch to continue the session
