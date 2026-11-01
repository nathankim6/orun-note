const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // pdf-lib's ESM build pulls tslib's ESM wrapper which Metro cannot interop; use the CJS builds instead.
  if (moduleName === 'pdf-lib') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules/pdf-lib/cjs/index.js') };
  if (moduleName === 'tslib') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules/tslib/tslib.js') };
  return prev ? prev(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
