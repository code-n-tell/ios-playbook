## platform-feature-01
### Description
The iOS platform provides IPA acquisition feature.
### Additional context
IPA acquisition is a feature that allows an IPA file to be obtained from Apple Configurator on macOS, enabling security testers to inspect the application’s structure, configuration, permissions, and entitlements.
### Demonstration
Set up a physical iOS device with the following configuration:
| Configuration | Detail            |
| ------------- | ----------------- |
| Device model  | iPhone 15         |
| iOS Version   | 17.6              |
| Device State  | Non-Jailbroken    |
| App Used      | Singpass  v26.0.4 |

Perform the following steps to enable IPA acquisition:
1. Install the target app on your iPhone to ensure the app is already associated with your Apple ID.

2. Open Apple Configurator on your Mac to prepare for downloading the app IPA through Apple’s app installation flow. Confirm that the Apple ID signed in on the iPhone is the same Apple ID used on your Mac.

3. Open Terminal on your Mac and run a script to monitor Apple Configurator’s temporary IPA cache folder, copying any downloaded .ipa file to a local ipa_tmp folder.

```
mkdir ipa_tmp

while true; do
	find ~/Library/Group\ Containers/K36BKF7T3D.group.com.apple.configurator/Library/Caches/Assets/TemporaryItems/MobileApps/ -name "*.ipa" -exec cp {} ipa_tmp/ \;
	sleep 0.3
done
```

4. In Apple Configurator, select your connected iOS device to manage apps on that device. Double-click the iOS device to open the device management screen. Click Add (+) → Apps from the top menu bar to search for and add the app through Apple Configurator.

5. Select the target app to trigger Apple Configurator to download the IPA from Apple and install it on your iPhone. When the reinstall prompt appears, choose Replace to continue the installation flow. While Apple Configurator downloads and installs the app, the IPA file should temporarily appear in the below directory.

```
~/Library/Group Containers/K36BKF7T3D.group.com.apple.configurator/Library/Caches/Assets/TemporaryItems/MobileApps/)
```

6. After the script copies the IPA, open the ipa_tmp folder to confirm that the .ipa file was captured successfully.

Because the iOS platform provides IPA acquisition feature, your app is at risk of:
- [platform-feature-01-risk-01](platform-feature-01-risk-01.md)
- [platform-feature-01-risk-02](platform-feature-01-risk-02.md)
