const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Ocultar qué tecnología usamos en las cabeceras por seguridad
app.disable('x-powered-by');

// Ruta principal (El Index)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Ruta encriptada/limpia para 360 Home
app.get('/ecosistema/360-home', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', '360-home.html'));
});

// Ruta encriptada/limpia para Nexus Core
app.get('/ecosistema/nexus-core', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'nexus-core.html'));
});

// Ruta para el Modal de Login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`[NeoGreenNexus] Servidor activo y seguro en http://localhost:${PORT}`);
});