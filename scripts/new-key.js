// Prints a new random access key for the /v1 API.
// Usage: node scripts/new-key.js
const { randomBytes } = require('node:crypto');
console.log(`bz-${randomBytes(24).toString('base64url')}`);
