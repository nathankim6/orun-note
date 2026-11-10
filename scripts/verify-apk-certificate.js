const fs = require('fs');
const EXPECTED = 'b8124585d937d4f63d546f5f648976a5e79670726788a753938e45b1fff87096';
function signerCertificates(text) {
  // SDK versions label signers as "Signer #1" or "V2 Signer". Do not confuse the public-key/stamp digest with the signing certificate.
  const found = [...text.matchAll(/^\s*(?:Signer #\d+|V\d+(?:\.\d+)? Signer):?\s*certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/gim)].map(m => m[1].toLowerCase());
  return [...new Set(found)];
}
function verifyCertificate(text, expected = EXPECTED) {
  const found = signerCertificates(text);
  if (found.length !== 1 || found[0] !== expected.toLowerCase()) throw new Error('Expected existing release signing certificate was not verified');
  return true;
}
module.exports = { EXPECTED, signerCertificates, verifyCertificate };
if (require.main === module) {
  try { verifyCertificate(fs.readFileSync(process.argv[2], 'utf8')); console.log('Existing release signing certificate verified.'); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
