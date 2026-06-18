## platform-feature-01
### Description
The Android platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that protects application secrets stored on the device by encrypting them at rest.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
| Storage backend | EncryptedSharedPreferences |
Perform the following steps to enable Secure Storage:
1. Disable all storage encryption to leave credentials in plaintext on disk
2. Store the credentials unencrypted to confirm the feature remains disabled
