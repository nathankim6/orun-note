// Prints identifier-type entitlement keys/values (bundle ids only, no secrets) from an otool __entitlements dump.
import fs from 'node:fs';
import { sectionXml } from './native-ios-signing.mjs';
try {
  const xml = sectionXml(fs.readFileSync(process.argv[2], 'utf8'));
  const rows = [...xml.matchAll(/<key>(application-identifier|keychain-access-groups|get-task-allow|com\.apple\.developer\.team-identifier)<\/key>\s*(<[^>]+>[^<]*<\/[^>]+>|<array>[\s\S]*?<\/array>|<true\/>|<false\/>)/g)]
    .map(r => r[1] + '=' + r[2].replace(/\s+/g, ' ').slice(0, 160));
  console.log('ios_embedded_entitlements ' + JSON.stringify(rows));
} catch (error) { console.log('ios_embedded_entitlements_unreadable ' + (error?.message ?? '')); }
