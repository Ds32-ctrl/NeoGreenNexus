// scripts/upload-apk.js
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const OWNER = 'Ds32-ctrl';
const REPO = 'NeoGreenNexus';
const TOKEN = process.env.GH_TOKEN;
const TAG_NAME = `v${packageJson.version}`;

const ASSETS = [
  {
    name: 'NexusCore-Setup.exe',
    path: path.join(__dirname, '..', 'dist-desktop', 'NexusCore-Setup.exe'),
    contentType: 'application/vnd.microsoft.portable-executable'
  },
  {
    name: 'latest.yml',
    path: path.join(__dirname, '..', 'dist-desktop', 'latest.yml'),
    contentType: 'text/yaml'
  },
  {
    name: 'ngn-360-home.apk',
    path: path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    contentType: 'application/vnd.android.package-archive'
  }
];

if (!TOKEN) {
  console.error('Error: La variable GH_TOKEN no está definida en la terminal.');
  process.exit(1);
}

async function publishReleaseAndAssets() {
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'User-Agent': 'NeoGreenNexus-Deployer',
    'Accept': 'application/vnd.github+json'
  };

  console.log(`1. Verificando o creando el release ${TAG_NAME} en GitHub...`);
  let release;

  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG_NAME}`, { headers });
  
  if (getRes.ok) {
    release = await getRes.json();
    console.log(`   -> Release ${TAG_NAME} encontrado.`);
  } else if (getRes.status === 404) {
    console.log(`   -> El release ${TAG_NAME} no existe aún. Creándolo oficialmente...`);
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: TAG_NAME,
        name: packageJson.version,
        body: `Lanzamiento oficial automatizado de NeoGreenNexus ${TAG_NAME} (Desktop & Android APK).`,
        draft: false,
        prerelease: false
      })
    });

    if (!createRes.ok) {
      throw new Error(`Error al crear release ${TAG_NAME}: ${createRes.status} ${await createRes.text()}`);
    }
    release = await createRes.json();
    console.log(`   -> Release ${TAG_NAME} creado con éxito.`);
  } else {
    throw new Error(`Error al consultar GitHub: ${getRes.status} ${await getRes.text()}`);
  }

  // Subir cada archivo de forma secuencial
  for (const asset of ASSETS) {
    if (!fs.existsSync(asset.path)) {
      console.warn(`   [!] Omitiendo ${asset.name} (no se encontró en ${asset.path})`);
      continue;
    }

    const existing = (release.assets || []).find(a => a.name === asset.name);
    if (existing) {
      console.log(`2. Eliminando versión previa de ${asset.name}...`);
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers
      });
    }

    const fileBuffer = fs.readFileSync(asset.path);
    const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`3. Subiendo ${asset.name} (${sizeMB} MB) al release ${TAG_NAME}...`);

    const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(asset.name)}`);
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': asset.contentType,
        'Content-Length': String(fileBuffer.length)
      },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      throw new Error(`Error subiendo ${asset.name}: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    console.log(`   ✓ ${asset.name} publicado correctamente.`);
  }

  console.log(`\n✓ Todos los instaladores están publicados en el release ${TAG_NAME}.`);
}

publishReleaseAndAssets().catch(err => {
  console.error(err);
  process.exit(1);
});