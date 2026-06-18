## platform-feature-01
### Description
The Android platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that protects application secrets stored on the device by encrypting them at rest when the app uses Android-backed key management correctly.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
| Storage backend | EncryptedSharedPreferences |
Perform the following steps to enable Secure Storage:
1. Configure the app to create or load an Android-managed encryption key to protect stored secrets
2. Update the storage layer to write credentials through encrypted storage to protect them at rest
