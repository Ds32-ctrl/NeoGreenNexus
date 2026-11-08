// scripts/upload-apk.js
const fs = require('fs');
const path = require('path');

const OWNER = 'Ds32-ctrl';
const REPO = 'NeoGreenNexus';
const TOKEN = process.env.GH_TOKEN;
const APK_PATH = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const ASSET_NAME = 'ngn-360-home.apk';

if (!TOKEN) {
  console.error('Error: La variable de entorno GH_TOKEN no está definida en la terminal.');
  process.exit(1);
}

if (!fs.existsSync(APK_PATH)) {
  console.error(`Error: No se encontró el APK compilado en: ${APK_PATH}`);
  process.exit(1);
}

async function uploadApk() {
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'User-Agent': 'NeoGreenNexus-Deployer',
    'Accept': 'application/vnd.github+json'
  };

  console.log('1. Conectando con GitHub para localizar el release más reciente...');
  const relRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, { headers });
  if (!relRes.ok) {
    throw new Error(`No se pudo obtener el release activo: ${relRes.status} ${await relRes.text()}`);
  }
  const release = await relRes.json();

  // Si ya existía un APK previo en esta versión, lo eliminamos para sobrescribir limpiamente
  const existingAsset = release.assets.find(a => a.name === ASSET_NAME);
  if (existingAsset) {
    console.log(`2. Removiendo versión previa de ${ASSET_NAME} en GitHub...`);
    await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existingAsset.id}`, {
      method: 'DELETE',
      headers
    });
  }

  // Subir el archivo binario
  console.log(`3. Subiendo ${ASSET_NAME} al release ${release.tag_name}...`);
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${ASSET_NAME}`);
  const apkBuffer = fs.readFileSync(APK_PATH);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': apkBuffer.length
    },
    body: apkBuffer
  });

  if (!uploadRes.ok) {
    throw new Error(`Error en la carga a GitHub: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  console.log(`✓ APK publicado con éxito como ${ASSET_NAME} en GitHub Releases.`);
}

uploadApk().catch(err => {
  console.error(err);
  process.exit(1);
});