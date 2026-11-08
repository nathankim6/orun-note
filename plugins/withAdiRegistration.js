// Android developer verification (Android Developer Console, account 1517638952433186261): proves this signing key
// owns com.paperly.study. The console checks for this exact file in the APK's assets folder.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const SNIPPET = 'CUH3ZFRBCN25KAAAAAAAAAAAAA';
module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, ['android', async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adi-registration.properties'), SNIPPET);
    return c;
  }]);
};
