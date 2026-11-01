// Sets the user-visible app name to 옳은Note on Android (strings.xml) while keeping the
// native project name ASCII ("Paperly") so Xcode/Gradle paths and CI stay stable.
const { withStringsXml, AndroidConfig } = require('expo/config-plugins');
module.exports = function withAppDisplayName(config, { name }) {
  return withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem([{ $: { name: 'app_name' }, _: name }], c.modResults);
    return c;
  });
};
