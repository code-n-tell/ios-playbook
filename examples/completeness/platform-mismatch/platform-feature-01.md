## platform-feature-01
### Description
The iOS platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that protects application secrets by storing them in the iOS Keychain.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
| Credential store | iOS Keychain |
Perform the following steps to enable Secure Storage:
1. Configure the app to save credentials into the iOS Keychain to protect them at rest
2. Read the credentials back from the iOS Keychain to confirm they persist across launches
