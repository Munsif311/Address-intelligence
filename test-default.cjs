console.log("Testing default app context");
console.log("process.versions.electron:", process.versions.electron);
console.log("Module._resolveFilename:", require('module')._resolveFilename.toString().slice(0, 200));

try {
  const electron = require('electron');
  console.log("require('electron'):", typeof electron);
  console.log("electron.app:", typeof electron.app);
} catch (e) {
  console.log("require('electron') error:", e.message);
}