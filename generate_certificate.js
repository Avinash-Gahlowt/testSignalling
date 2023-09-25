const fs = require('fs');
const forge = require('node-forge');

const BASE_DIR = __dirname;
const OUT_DIR = process.argv[2] || '';

const keys = forge.pki.rsa.generateKeyPair(4096);
const cert = forge.pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
    { name: 'commonName', value: 'example.com' },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'State' },
    { name: 'localityName', value: 'City' },
    { name: 'organizationName', value: 'Organization' },
    { shortName: 'OU', value: 'Unit' },
];

cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
    {
        name: 'basicConstraints',
        cA: true,
    },
    {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
    },
    {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        emailProtection: true,
        timeStamping: true,
    },
    {
        name: 'nsCertType',
        sslCA: true,
        emailCA: true,
        objCA: true,
    },
]);

// Self-sign the certificate
cert.sign(keys.privateKey);

const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
const pemCert = forge.pki.certificateToPem(cert);

const keyPath = `${OUT_DIR}key.pem`;
const certPath = `${OUT_DIR}cert.pem`;

fs.writeFileSync(keyPath, pemKey);
fs.writeFileSync(certPath, pemCert);

console.log(`Generated key.pem and cert.pem in ${OUT_DIR}`);
